// fleet/drive.mjs — drive one remote run end to end and produce the §W1d gate
// read.
//
// This is the W1 integration point: start the orchestrator, provision a
// sandbox, watch the synced store until the run resolves, then answer the five
// pre-registered questions the W1 gate asks and write them to disk.
//
// Every side effect that leaves this process rides the injected `exec(cmd)`
// seam (via the provisioner) or the orchestrator's injected `actions`, so the
// whole driver is exercisable with no VMs and no credentials in reach. The
// sandbox's store token is minted inside `provisionRun` and delivered over
// ssh, and this module only ever handles the resulting record (a hash and an
// expiry). The one credential it reads itself is the orchestrator's GitHub
// token (#368), for the publish leg at the very end — handed to `git push`
// and `gh` as an env var through `exec(cmd, {env})`, never logged, never in
// `detail`.
import fs from 'node:fs'
import path from 'node:path'
import { startOrchestrator, FLEET_PATH } from './orchestrator.mjs'
import { provisionRun, destroySandbox, SANDBOX_SSH_OPTS, sandboxGitSsh } from './provision.mjs'
import { isSafeBranchName, isSafeRepoPath, isSafeSha, sandboxIdFor, MANIFEST_PATH } from './shim-main.mjs'
import { claimState, totalSpent } from './store.mjs'
import { assessHeadlessFitness } from './fitness.mjs'
import { mintToken } from './tokens.mjs'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Statuses the driver stops watching on. `folded` is not reachable in W1 (the
// fold happens above the run) but is terminal wherever it appears.
const TERMINAL = new Set(['gate-green', 'parked', 'revoked', 'folded'])

const isNonEmptyString = (value) => typeof value === 'string' && value.length > 0

/**
 * The evidence-before-teardown pull (#197), as proven in the live run: tar the
 * SMALL sandbox artifacts — shim.log, the delivered assignment, the engine's
 * session transcripts (`~/.claude/projects`), and the gitignored
 * `.claude/ultrapowers/run-*` dirs inside the repo — back to the orchestrator
 * as one archive. Never the repo itself. Every diagnosis in the live run
 * depended on exactly these files, and they die with the VM.
 */
export const sandboxLogPullCommand = ({ vmName, dest }) =>
  `ssh -o BatchMode=yes -o ConnectTimeout=10 ${SANDBOX_SSH_OPTS} ${vmName}.exe.xyz ` +
  // --exclude the one-driver run tree's clones/ (run-main.mjs): they are full
  // repo copies — N tasks + integration, .git included — and "never the repo
  // itself" is this command's whole rule. Everything else in the run dir
  // (events.jsonl, patches, workers, receipts, the claude/ transcripts) IS
  // the evidence.
  `'cd /home/exedev && tar czf - --exclude="repo/.claude/ultrapowers/run-*/clones" shim.log fleet-run.json .claude/projects ` +
  `$(cd repo && ls -d .claude/ultrapowers/run-*/ 2>/dev/null | sed "s|^|repo/|") 2>/dev/null' ` +
  `> ${dest}`

/**
 * The VM names this module is willing to interpolate into a shell. `vmName`
 * comes back from `provisionRun` (which derives it as `fleet-<runId>`), so it
 * is not sandbox-authored — but it IS interpolated into ssh command strings, so
 * it is validated here rather than trusted, and a mismatch refuses the command
 * loudly instead of running it.
 */
export const isSafeVmName = (value) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value)

/**
 * What to do with a `destroySandbox(target)` the orchestrator's sweep asked
 * for. PURE, and exported, because it is the decision that stands between a
 * reaper and someone else's running VM — it should be readable and tested on
 * its own, not buried in a closure inside `driveOne`.
 *
 * `own`    — our sandbox: teardown owns it start to finish (it pulls logs first
 *            and is idempotent against the `finally` teardown).
 * `reap`   — another run's leftover; destroy it.
 * `refuse` — with a reason, recorded in the run's errors.
 *
 * @param {object} o
 * @param {string|undefined} o.target      the claim holder the sweep named
 * @param {string|null} o.vmName           our provisioned VM, null before step 2
 * @param {string} o.entryVmName           `fleet-<runId>` — ours from entry, always
 */
export const reapDecision = ({ target, vmName, entryVmName }) => {
  if (target === undefined || target === vmName) return { action: 'own' }
  // NEVER the VM name this drive is responsible for, even before it exists.
  // `vmName` is null until provisioning, and the startup sweep runs BEFORE
  // that: on a re-drive of a runId whose old claim is stale, the reaper would
  // fire an unawaited `rm fleet-<runId>` ~200ms before we `cp` a fresh VM into
  // exactly that name — and the rm can land after the cp and destroy the
  // sandbox we just made, leaving the run waiting on a VM that no longer
  // exists. `entryVmName` is derived at entry precisely so this check works
  // during the window when `vmName` is still null.
  if (target === entryVmName) {
    return { action: 'refuse', reason: `reap refused for ${target}: this drive owns that VM name` }
  }
  // `target` is a claim HOLDER read out of the synced CRDT — sandbox-authored,
  // unlike the engine-derived `vmName` this module validates at :363 and :585 —
  // and it is interpolated straight into `ssh exe.dev "rm ${...} --json"`.
  // Validate before the shell, never after.
  if (!isSafeVmName(target)) {
    return { action: 'refuse', reason: `reap refused for ${JSON.stringify(target)}: fails isSafeVmName` }
  }
  return { action: 'reap' }
}

// --- the publish leg (#368) -------------------------------------------------
// After a run resolves, the orchestrator — not the laptop — pushes the fetched
// integration branch to GitHub and opens the PR whose body is the gate receipt.
// Green run → a normal PR; parked-with-publish → a DRAFT PR titled `[parked] …`
// with the ack list first (the park card IS the draft PR; the operator acks by
// marking it ready). Merge stays the human's: nothing here enables auto-merge.

/** Where the orchestrator keeps its GitHub token (0600, orchestrator only). */
export const GITHUB_TOKEN_PATH = '/home/exedev/.fleet/github-token'

/** Single-quote a string for `/bin/sh -c`. Never applied to sandbox-authored data. */
export const shellQuote = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`

/**
 * The plan's `Closes` convention. No plan in the repo carried one before
 * #368 (titles name issues as `(#318 #319)`, `**Spec:**` names them in prose —
 * neither is a close), so this is the convention from here on: in the plan
 * HEADER (everything before the first `## ` section), a `**Closes:** #N, #M`
 * line or a bare `Closes #N` line. Every `#N` on such a line becomes a
 * `Closes #N` line in the PR body; the rest of the plan is never scanned.
 */
export const parsePlanCloses = (planText) => {
  const header = String(planText ?? '').split(/\n## /)[0]
  const numbers = new Set()
  for (const line of header.matchAll(/^[ \t]*(?:\*\*)?Closes:?(?:\*\*)?:?[ \t]*(.+)$/gim)) {
    for (const hit of line[1].matchAll(/#(\d+)/g)) numbers.add(Number(hit[1]))
  }
  return [...numbers]
}

/** The plan's H1 (control characters stripped), else its file name. */
export const planTitleFrom = (planText, planPath) => {
  const h1 = String(planText ?? '').match(/^#[ \t]+(.+)$/m)?.[1]
  const raw = h1 && h1.trim().length > 0 ? h1 : path.basename(String(planPath ?? 'plan'))
  return raw.replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200)
}

/** The PR title — `[parked] ` prefixed on the draft path. */
export const pullRequestTitle = ({ runId, planText, planPath, parked }) =>
  `${parked ? '[parked] ' : ''}fleet ${runId}: ${planTitleFrom(planText, planPath)}`

/**
 * The PR body: the gate receipt rendered. `receipt` is the parsed
 * `fleet-receipts/<runId>/gate-receipt.json` from the fetched branch (or null
 * when it could not be read — the body says so rather than pretending).
 * Parked → the acks come FIRST, before the verdict; green → verdict, checks,
 * acks. Then the five §W1d legs, spend, `autoResolved` and the
 * completeness-critic findings when the receipt carries them (they live in
 * the engine's gitignored `report.json`, which is not on the branch — the
 * evidence bundle has it), the receipt pointers, the driver's notes, the
 * `Closes #N` lines, and the standard trailer.
 */
export const renderPullRequestBody = ({
  runId,
  planPath,
  branch,
  vmName,
  parked,
  receipt,
  receiptSource,
  read,
  receipts,
  closes,
  errors,
}) => {
  const gate = receipt?.gateCheck && typeof receipt.gateCheck === 'object' ? receipt.gateCheck : receipt ?? {}
  const verdict = receipt?.verdict ?? gate?.verdict ?? 'unknown'
  const checks = Array.isArray(gate?.checks) ? gate.checks : []
  const acks = Array.isArray(gate?.acks) ? gate.acks : []
  const autoResolved = receipt?.autoResolved ?? gate?.autoResolved
  const findings = receipt?.completenessFindings ?? gate?.completenessFindings
  const lines = []
  const ackLines = () => {
    lines.push(`## Acks${parked ? ' required' : ''} (${acks.length})`)
    if (acks.length === 0) lines.push('- none')
    for (const ack of acks) lines.push(`- **${ack?.type ?? 'ack'}** — ${String(ack?.detail ?? '').trim()}`)
    lines.push('')
  }

  lines.push(`# fleet ${runId} — ${parked ? 'parked gate receipt' : 'gate receipt'}`)
  lines.push('')
  lines.push(`Plan \`${planPath}\` · branch \`${branch}\` · sandbox \`${vmName ?? 'unknown'}\``)
  lines.push('')
  if (parked) {
    lines.push('**Parked.** This draft PR is the park card: review the acks below, then mark it ready to ack. Merge stays yours.')
    lines.push('')
    ackLines()
  }
  lines.push(`## Verdict: ${verdict}`)
  lines.push('')
  if (receipt === null) {
    lines.push(`_gate receipt unreadable (${receiptSource ?? 'no resolved receipt'}) — verdict is the store's word only._`)
    lines.push('')
  }
  lines.push(`## Checks (${checks.length})`)
  if (checks.length === 0) lines.push('- none')
  for (const check of checks) {
    const detail = String(check?.detail ?? '').trim()
    lines.push(`- [${check?.ok ? 'x' : ' '}] ${check?.name ?? 'check'}${detail ? ` — ${detail}` : ''}`)
  }
  lines.push('')
  if (!parked) ackLines()

  lines.push('## §W1d gate read')
  lines.push('')
  lines.push('| leg | value |')
  lines.push('|---|---|')
  for (const leg of ['o1', 'receiptsResolvable', 'leaseContinuity', 'versionStamp']) lines.push(`| ${leg} | ${read?.[leg]} |`)
  const spend = read?.spendObservational ?? {}
  lines.push(`| spendObservational | reported ${spend.reported ?? 'null'} / ledger ${spend.ledger ?? 'null'} |`)
  lines.push('')
  lines.push(`## Spend`)
  lines.push('')
  lines.push(`reported: ${spend.reported ?? 'null'} · ledger: ${spend.ledger ?? 'null'} (output tokens)`)
  lines.push('')
  if (typeof autoResolved === 'number') {
    lines.push(`## autoResolved: ${autoResolved}`)
    lines.push('')
  }
  if (Array.isArray(findings) && findings.length > 0) {
    lines.push(`## Completeness-critic findings (${findings.length})`)
    for (const finding of findings) lines.push(`- ${typeof finding === 'string' ? finding : JSON.stringify(finding)}`)
    lines.push('')
  }
  lines.push(`## Receipts (${receipts.length})`)
  if (receipts.length === 0) lines.push('- none')
  for (const r of receipts) {
    const resolved = r.resolved === undefined ? 'unverified' : r.resolved ? 'resolved' : 'UNRESOLVED'
    lines.push(`- \`${r.sha}\` \`${r.path}\` — ${r.verdict || 'no verdict'}, ${resolved}`)
  }
  lines.push('')
  lines.push('_`autoResolved` and the completeness-critic findings render only when the receipt carries them; otherwise they live in `report.json` inside the evidence bundle, not on this branch._')
  lines.push('')
  if (errors.length > 0) {
    lines.push(`## Driver notes (${errors.length})`)
    for (const e of errors) lines.push(`- ${e}`)
    lines.push('')
  }
  for (const n of closes) lines.push(`Closes #${n}`)
  if (closes.length > 0) lines.push('')
  lines.push('🤖 Generated with [Claude Code](https://claude.com/claude-code)')
  return `${lines.join('\n')}\n`
}

/** The PR number out of `gh pr create`'s output, or null. */
export const parsePullRequestUrl = (output) => {
  const hit = String(output ?? '').match(/https:\/\/github\.com\/\S+?\/pull\/(\d+)/)
  return hit ? { url: hit[0], number: Number(hit[1]) } : null
}

/**
 * The sandbox's own resource samples, pulled from the exe.dev control plane
 * before the VM is destroyed — `stat` is a 10-minute sampler, so the derived
 * peaks are a FLOOR estimate and never a maximum.
 */
export const sandboxStatCommand = ({ vmName }) =>
  `ssh -o BatchMode=yes -o ConnectTimeout=10 exe.dev "stat ${vmName} --json --range=24h"`

/**
 * Reduce a `stat --json` payload to the three numbers the W1 gate reads.
 * Returns null when the payload carries no usable sample.
 */
export const deriveSandboxStat = (statJson) => {
  // Array.isArray guard: a malformed-but-valid payload (points as an object)
  // must degrade to null, never throw past destroyOnce (#280 run-9b critic).
  const pts = (Array.isArray(statJson?.points) ? statJson.points : []).filter((p) => typeof p?.cpu_cores === 'number')
  if (!pts.length) return null
  const cores = pts.map((p) => p.cpu_cores)
  const mems = pts.map((p) => p.mem_used_bytes).filter((m) => typeof m === 'number')
  return {
    peakCores: Math.max(...cores),
    meanCores: cores.reduce((a, b) => a + b, 0) / cores.length,
    peakMemBytes: mems.length ? Math.max(...mems) : null,
  }
}

/**
 * Drive one remote run and return its §W1d gate read.
 *
 * @param {object} opts
 * @param {string} opts.planPath - the plan the sandbox is dispatched to run.
 * @param {string} opts.golden - the golden VM to clone the sandbox from.
 * @param {number} opts.port - port the orchestrator's ws-server binds.
 * @param {string} opts.dbDir - directory for the orchestrator's sqlite store.
 *   It is a PERSISTER dir, kept across runs — every read here is scoped by
 *   `runId`, so prior-run rows do not perturb a new run's gate read.
 * @param {string} [opts.evidenceDir] - where this run's evidence lands
 *   (default `${dbDir}-evidence`). Deliberately OUTSIDE `dbDir`, so wiping the
 *   store for a fresh-store experiment never deletes the evidence.
 * @param {string} opts.repoDir - local checkout the base is pushed from and the
 *   run branch is fetched back into.
 * @param {(cmd: string, opts?: {env?: Record<string,string>}) => Promise<{stdout: string, code: number, stderr?: string}>} opts.exec -
 *   `stdout` is compared byte-for-byte against the working tree by the #337
 *   preflight, so an exec MUST keep stderr off it (#362); `stderr`, when
 *   present, is only joined into diagnostic lines (execDiagnostic). The optional
 *   env is the per-command layered environment the publish leg hands git/gh (#368).
 * @param {() => number} [opts.clock] - the logical clock. Frozen under test; an
 *   input to claim/guard decisions, never to timeouts.
 * @param {number} [opts.publishTimeoutMs] - how long to wait, after the run
 *   reaches a terminal status, for the sandbox to publish what it produced.
 *   Clamped to `heartbeatTimeoutMs`.
 * @param {number} [opts.parkedPublishWaitMs] - the same wait, on the PARKED
 *   path (#318). Tighter than `publishTimeoutMs` on purpose: a parked run that
 *   publishes nothing must not idle out the gate-green bound. Clamped to
 *   `heartbeatTimeoutMs`.
 * @param {Record<string,string>} [opts.engineEnv] - environment the sandbox
 *   engine must see (e.g. `CLAUDE_CODE_OAUTH_TOKEN`, #213); delivered per run
 *   by `provisionRun`, held by the orchestrator, never baked into the golden.
 * @param {number} [opts.sandboxCpu] - number of vCPUs for the cloned sandbox.
 * @param {string} [opts.sandboxMemory] - memory size for the cloned sandbox (e.g. '8GB').
 * @param {string} [opts.sandboxDisk] - disk size for the cloned sandbox (e.g. '30GB').
 * @param {number} [opts.logPullTimeoutMs] - bound on the evidence pull that
 *   precedes teardown. A pull that outruns it is recorded as an error and the
 *   sandbox is destroyed anyway — the pull must never keep a VM alive.
 * @param {number} [opts.claimTimeoutMs] - how long a run may sit `pending`
 *   with no claim row before the drive gives up on it. A sandbox whose ws
 *   transport never connects (or whose shim never starts) produces zero store
 *   writes, so without this bound the only exit is `heartbeatTimeoutMs`
 *   (#288) — this fires first and names the failure instead of reading as a
 *   generic stall.
 * @param {(line: string) => void} [opts.progressLog] - a live, timestamped
 *   line of narration for a long-running drive (#288: a dead run otherwise
 *   produces zero output until it times out). Called at every state
 *   transition the watch loop observes. A throwing `progressLog` is caught
 *   and ignored — narration must never be able to break a drive.
 * @param {boolean} [opts.allowUnfitPlan] - overrides the #322 headless-fitness
 *   preflight, which otherwise throws (before any provisioning) when the plan
 *   at `planPath` carries a task whose only evidence is human judgment. Pass
 *   only with a specific operator pre-authorization; the override is recorded
 *   in `detail.errors`. The plan is read as committed at `baseRef` (#337); an
 *   uncommitted or dirty plan is refused regardless of this flag.
 * @param {string} [opts.githubTokenPath] - the orchestrator's GitHub token
 *   file (#368; default `GITHUB_TOKEN_PATH`). Read here, handed to `git push`
 *   and `gh` ONLY as the `GH_TOKEN` env var through `exec(cmd, {env})` —
 *   never on a command line, never in `detail`. Absent → the run still reads
 *   exactly as it would have; `github-token missing …` lands in
 *   `detail.errors` and no PR is opened.
 * @param {string} [opts.prBase] - the PR's base branch (default `main`).
 *   Operator input that reaches a shell, so it passes `isSafeBranchName` at
 *   entry like `runId` does.
 * @returns {Promise<{read: object, reportPath: string, detailPath: string, detail: object}>}
 */
export const driveOne = async ({
  planPath,
  golden,
  port,
  dbDir,
  repoDir,
  exec,
  clock = Date.now,
  runId,
  branch = 'fleet-run',
  baseRef = 'HEAD',
  // #279: ttlMs is the store-token lease TTL delivered to the sandbox. 15 min
  // was a smoke-run constant; a real plan's engine phase runs for hours, and an
  // expired lease surfaces two stages away as a heartbeat timeout. 4h covers
  // any single-plan drain (run-9b precedent).
  ttlMs = 4 * 60 * 60_000,
  wsHost = '127.0.0.1',
  wsUrl,
  evidenceDir,
  reportPath,
  tickMs = 1_000,
  settleMs = 750,
  heartbeatTimeoutMs = 30 * 60_000,
  publishPollMs = 250,
  publishTimeoutMs = heartbeatTimeoutMs,
  parkedPublishWaitMs = 60_000,
  logPullTimeoutMs = 120_000,
  claimTimeoutMs = 10 * 60_000,
  progressLog = (line) => console.error(`[drive ${new Date().toISOString()}] ${line}`),
  engineEnv,
  sandboxCpu,
  sandboxMemory,
  sandboxDisk,
  // #322: overrides the headless-fitness preflight refusal. Pass only with a
  // specific operator pre-authorization for the manual-judgment task named in
  // the thrown error — never as a standing default.
  allowUnfitPlan = false,
  // Injection seams for the provision/teardown legs — the real module
  // functions by default. They exist so the pullLogsOnce refusal branch
  // (defense in depth against a mid-run vmName mutation; unreachable through
  // the public surface post-#298) is testable at all (#290-2).
  provision = provisionRun,
  destroy = destroySandbox,
  // #368: the publish leg's inputs. The token stays on the orchestrator.
  githubTokenPath = GITHUB_TOKEN_PATH,
  prBase = 'main',
}) => {
  // #368: `prBase` is operator input interpolated into `gh pr create`; refuse
  // an unsafe one at entry, before any command, exactly as `runId` is.
  if (!isSafeBranchName(prBase)) {
    throw new Error(`driveOne: unsafe prBase ${JSON.stringify(prBase)} — fails isSafeBranchName; refusing before any command`)
  }
  // #298: `runId` becomes `fleet-<runId>` and is interpolated into every
  // sandbox-bound ssh/git command string downstream (clone, deliveries,
  // tunnel, shim start, rm, captures, fetch). Validate ONCE at the single
  // choke point, before the orchestrator starts and before any exec call —
  // an unsafe value is an operator input error, refused loudly, never a run
  // outcome. `pullLogsOnce` keeps its own guard as defense in depth.
  // #211: runId is required — never defaulted. A default like the old
  // `'run-1'` invites a second run silently reusing a name, which under
  // host-key/naming rules is a footgun. Refuse before deriving the vm name.
  if (typeof runId !== 'string' || runId.length === 0) {
    throw new Error('driveOne: runId is required — never reuse one (#211)')
  }
  const entryVmName = sandboxIdFor(runId)
  if (!isSafeVmName(entryVmName)) {
    throw new Error(
      `driveOne: unsafe runId ${JSON.stringify(runId)} — derived vm name ${JSON.stringify(entryVmName)} ` +
        `fails isSafeVmName; refusing before any command`,
    )
  }

  const resolvedEvidenceDir = evidenceDir ?? `${dbDir}-evidence`
  const resolvedReportPath = reportPath ?? path.join(resolvedEvidenceDir, `gate-read-${runId}.json`)
  const detailPath = `${resolvedReportPath.replace(/\.json$/, '')}.detail.json`
  // A throwing progressLog must never break the drive — it is narration, not
  // a dependency.
  const note = (line) => {
    try {
      progressLog(line)
    } catch {
      // narration is best-effort
    }
  }

  // Handed to the orchestrator by reference — a token minted mid-run is honored
  // on the next handshake without restarting the server.
  const tokenRecords = []
  const pages = []
  const convergedAway = []
  const receiptChecks = []
  const errors = []

  // #322: headless-fitness preflight. A plan carrying a task whose only
  // evidence is human judgment is GUARANTEED to park an unattended drive —
  // refuse it here, before a sandbox exists, not 200k tokens later.
  //
  // #337: the text assessed is the plan AS COMMITTED AT `baseRef` — the same
  // source `provisionRun` pushes and the sandbox executes — never the working
  // tree. Assessing the working tree let the verdict attach to text that was
  // never dispatched (a spurious refusal on an uncommitted edit; a silent
  // pass of an unfit committed plan). Two divergences are operator errors,
  // refused outright and NOT fitness verdicts, so `allowUnfitPlan` does not
  // cover them: a plan present in the working tree but absent at `baseRef`
  // (uncommitted — the sandbox would receive nothing), and a plan whose
  // working-tree copy differs from the committed one (dirty — nobody can say
  // which text the verdict is about). A plan absent from BOTH skips the check
  // with narration only (the live drive always has the merged plan committed;
  // the in-process tests do not).
  const planFile = path.isAbsolute(planPath) ? planPath : path.join(repoDir, planPath)
  const planRel = path.relative(repoDir, planFile)
  let workingText = null
  try {
    workingText = fs.readFileSync(planFile, 'utf8')
  } catch {
    workingText = null
  }
  let committedText = null
  // Both halves are interpolated into a shell: the ref passes the guard
  // provisionRun applies to it, the path the receipt-pointer guard (same
  // character class, no `..` segment — a path that escapes the checkout can
  // be at no ref). #362: a path that fails its guard is refused AS a path
  // problem, here, before any exec call — not read as "absent at baseRef"
  // and then reported as an uncommitted plan (run-20's critic: misleading,
  // and non-overridable). The ref keeps its guard-miss reading of "absent":
  // the stamp cross-check below skips on it with a narrating errors line.
  if (!isSafeRepoPath(planRel)) {
    throw new Error(
      `driveOne: plan path ${JSON.stringify(planRel)} (from ${planPath}) fails the repo-path guard — ` +
        `[A-Za-z0-9._/-] only, no leading '-', no '..' segment, and inside ${repoDir}; the path is ` +
        `interpolated into 'git show ${baseRef}:<path>' and pushed to the sandbox as-is. Move or rename ` +
        `the plan (#362)`,
    )
  }
  if (isSafeBranchName(baseRef)) {
    try {
      const shown = await exec(`git -C ${repoDir} show ${baseRef}:${planRel}`)
      if (shown?.code === 0 && typeof shown.stdout === 'string') committedText = shown.stdout
    } catch {
      committedText = null
    }
  }
  if (committedText === null && workingText === null) {
    note(`headless-fitness: plan absent at ${baseRef}:${planRel} and unreadable at ${planFile} — check skipped`)
  } else if (committedText === null) {
    throw new Error(
      `driveOne: plan ${planRel} is in the working tree but not committed at ${baseRef} — the sandbox ` +
        `executes the pushed ${baseRef}, never the working tree; commit it, or pass the ref that carries it (#337)`,
    )
  } else if (workingText !== null && workingText !== committedText) {
    throw new Error(
      `driveOne: plan ${planRel} differs between ${baseRef}:${planRel} (what the sandbox executes) and the ` +
        `working tree ${planFile} — commit or discard the edit so the fitness verdict attaches to the ` +
        `dispatched text (#337)`,
    )
  } else {
    const fitness = assessHeadlessFitness(committedText)
    if (!fitness.fit) {
      const summary = fitness.findings.map((f) => `${f.task}: ${f.reason}`).join('; ')
      if (!allowUnfitPlan) {
        throw new Error(
          `driveOne: plan is headless-unfit — ${summary} — rewrite the verification into ` +
            `runtime/external form, route the task to a local drain, or pass allowUnfitPlan: true ` +
            `with a specific operator pre-authorization (#322)`,
        )
      }
      errors.push(`headless-fitness: proceeding on operator override — ${summary}`)
      note('headless-fitness: unfit plan allowed by allowUnfitPlan')
    }
  }

  // #282/#190: what the stamp MUST name — resolved at drive start, from the
  // same ref provisionRun is about to push, so a repo that moves mid-drive
  // cannot shift the expectation. `baseRef` is operator input interpolated into
  // the shell here exactly as `provisionRun` interpolates it, so it passes the
  // same guard first; an unresolvable expectation SKIPS the cross-check (with a
  // narrating errors line) rather than reddening the stamp from the driver's own
  // repo state.
  let expectedStamp = null
  if (isSafeBranchName(baseRef)) {
    try {
      const shaRes = await exec(`git -C ${repoDir} rev-parse ${baseRef}`)
      const manifestRes = await exec(`git -C ${repoDir} show ${baseRef}:${MANIFEST_PATH}`)
      if (shaRes?.code === 0 && manifestRes?.code === 0) {
        const version = JSON.parse(manifestRes.stdout)?.version
        const sha = String(shaRes.stdout ?? '').trim()
        if (isSafeSha(sha) && isNonEmptyString(version)) {
          expectedStamp = { engineSha: sha, pluginVersion: version }
        }
      }
    } catch {
      expectedStamp = null
    }
  }
  if (expectedStamp === null) errors.push(`version cross-check unavailable: could not resolve ${baseRef} locally`)

  let vmName = null
  let destroyed = false
  let pulled = false
  let sandboxLogs = null
  let sandboxStat = null

  // #362-1: the exec seam keeps stderr OFF stdout (the #337 preflight compares
  // stdout byte-for-byte), so a failed command's reason — which git, ssh and
  // gh print on stderr — is joined back in for the diagnostic lines only.
  const execDiagnostic = (result) =>
    [String(result?.stdout ?? '').trim(), String(result?.stderr ?? '').trim()].filter(Boolean).join(' ')

  // One command, bounded by `logPullTimeoutMs`. The bound is PER COMMAND, not
  // shared across the captures: a slow log pull must not eat the budget the
  // `stat` capture still needs, and no capture may outlive its own bound.
  // `opts` (an env for the command, #368) rides through to `exec` untouched.
  const boundedExec = (cmd, opts) => {
    let timer
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve({ code: -1, stdout: `timed out after ${logPullTimeoutMs}ms` }), logPullTimeoutMs)
    })
    return Promise.race([Promise.resolve().then(() => exec(cmd, opts)), timeout]).finally(() => clearTimeout(timer))
  }

  // Separates a failed command's stderr from its (usually empty) stdout in the
  // evidence artifact. Written only on the failure path (#385 item 3).
  const STDERR_TRAILER = '\n--- stderr ---\n'

  // The control-plane capture that must happen while the VM still exists: its
  // resource samples. It writes its RAW stdout to the evidence dir regardless
  // of whether it parses — plus, on failure, stderr under `STDERR_TRAILER` —
  // so BOTH failure shapes are diagnosable from the artifact rather than lost:
  // a payload that changed shape (stdout, unparseable) and a command that
  // refused (stdout empty, reason on stderr).
  //
  // Every failure mode here — refused command, non-zero exit, timeout, invalid
  // JSON, a payload that parses but carries nothing usable — pushes to `errors`
  // and leaves the field null. Nothing propagates: a throw on this path would
  // skip `destroySandbox` and leak a billed VM (#280, run-9b's in-sandbox
  // critic), which is the one outcome teardown exists to prevent.
  const captureJson = async ({ label, cmd, file }) => {
    let raw = null
    try {
      const destination = path.join(resolvedEvidenceDir, file)
      const result = await boundedExec(cmd)
      raw = typeof result?.stdout === 'string' ? result.stdout : ''
      const stderr = typeof result?.stderr === 'string' ? result.stderr : ''
      fs.mkdirSync(resolvedEvidenceDir, { recursive: true })
      // #385 item 3. `raw` is stdout ALONE, and #362 made stdout pure — so a
      // command that failed with its reason on stderr wrote an EMPTY artifact
      // here, which is precisely the failure the artifact exists to diagnose.
      // The FAILURE path appends stderr under a delimiter; the success path is
      // byte-for-byte what it was, so nothing that reads a green artifact as
      // JSON can be broken by this. Only `raw` is ever parsed, so the trailer
      // cannot reach `JSON.parse`.
      const failed = result?.code !== 0
      fs.writeFileSync(destination, failed && stderr ? `${raw}${STDERR_TRAILER}${stderr}` : raw)
      if (failed) {
        errors.push(`${label}: code ${result?.code} ${execDiagnostic(result)}`.trim())
        return null
      }
    } catch (error) {
      errors.push(`${label}: ${error?.message ?? error}`)
      return null
    }
    try {
      return JSON.parse(raw)
    } catch (error) {
      errors.push(`${label} parse: ${error?.message ?? error}`)
      return null
    }
  }

  // Evidence BEFORE teardown (#197). Best-effort and bounded: a failed or slow
  // pull is pushed to `errors` and teardown proceeds — the billing clock is the
  // thing teardown protects, and the pull must not risk leaving a VM alive.
  // Guarded once, like the destroy, because it is wired to every teardown path
  // (the cap-overshoot action and the normal end of run).
  //
  // Evidence lands in `resolvedEvidenceDir`, never in `dbDir`: the store dir is
  // persisted across runs and is the thing an operator wipes for a fresh-store
  // experiment, and evidence must not die with that wipe.
  const pullLogsOnce = async () => {
    if (pulled || !vmName) return
    pulled = true

    // `vmName` is interpolated into BOTH the tar pull and the stat command, so
    // it is validated once, at the very top, before either exists — refused
    // loudly rather than shelled. Hoisted ahead of the tar pull (#290-2): the
    // pull used to run unconditionally, with only the stat call guarded, which
    // left the first vmName interpolation unchecked.
    if (!isSafeVmName(vmName)) {
      errors.push(`unsafe vm name ${JSON.stringify(vmName)} — refusing sandbox-addressed captures`)
    } else {
      try {
        const dir = path.join(resolvedEvidenceDir, 'sandbox-logs', `${vmName}-${Date.now()}`)
        const dest = path.join(dir, 'sandbox-logs.tgz')
        fs.mkdirSync(dir, { recursive: true })
        const result = await boundedExec(sandboxLogPullCommand({ vmName, dest }))
        if (result?.code === 0) sandboxLogs = dest
        else errors.push(`pull sandbox logs: code ${result?.code} ${execDiagnostic(result)}`.trim())
      } catch (error) {
        errors.push(`pull sandbox logs: ${error?.message ?? error}`)
      }

      const statJson = await captureJson({
        label: 'sandbox stat',
        cmd: sandboxStatCommand({ vmName }),
        // runId-qualified (#323): the evidence dir is shared across runs, so an
        // unqualified name is clobbered by the next run — and races a sibling
        // under concurrent drains.
        file: `stat-${runId}.json`,
      })
      if (statJson !== null) {
        // Derivation is wrapped at the CALL SITE: a throw out of a deriver is a
        // parse failure like any other, not a reason to skip teardown.
        try {
          const derived = deriveSandboxStat(statJson)
          if (derived === null) errors.push(`sandbox stat derive: no usable cpu_cores samples in stat-${runId}.json`)
          else sandboxStat = derived
        } catch (error) {
          errors.push(`sandbox stat derive: ${error?.message ?? error}`)
        }
      }
    }
  }

  const destroyOnce = async () => {
    if (destroyed || !vmName) return
    destroyed = true
    await pullLogsOnce()
    await destroy({ vmName, port: effectivePort, exec })
  }

  const actions = {
    page: (cls, text) => pages.push([cls, text]),
    // `revokeAndPark` is DELETED with the spend pass that was its only caller
    // (#400). The claim-lease reaper does not park or revoke: it destroys an
    // unused VM and leaves the run reclaimable.
    //
    // The orchestrator's out-of-band reclamation. Fire-and-forget by contract
    // (the sweep is synchronous).
    //
    // THE ARGUMENT IS NOW LOAD-BEARING. Under the spend pass this handler
    // ignored it and always tore down THIS drive's sandbox, which was correct
    // there — the overshooting run was always our own. The reaper reclaims VMs
    // belonging to runs whose drive is already dead, so the name must be
    // honoured. Our own sandbox goes through `destroyOnce` (which pulls its
    // logs first and is idempotent against the teardown in `finally`); a
    // foreign one is removed directly, with no log pull, because there is no
    // live drive whose evidence dir it would belong in.
    destroySandbox: (target) => {
      const decision = reapDecision({ target, vmName, entryVmName })
      if (decision.action === 'own') {
        void destroyOnce().catch((error) => errors.push(`destroySandbox: ${error?.message ?? error}`))
        return
      }
      if (decision.action === 'refuse') {
        errors.push(decision.reason)
        return
      }
      // No `port`: the reverse tunnel for a foreign VM belongs to the drive
      // process that opened it, which is dead — that is why its VM leaked. The
      // tunnel died with it, and pkill-ing by a port we do not own would be
      // reaching into another run's business.
      void destroy({ vmName: target, exec }).catch((error) =>
        errors.push(`reap ${target}: ${error?.message ?? error}`))
    },
  }

  const orchestrator = await startOrchestrator({ port, dbDir, tokenRecords, actions, clock })
  const { store, sweep, heartbeat, stop } = orchestrator
  const effectivePort = orchestrator.port
  const resolvedWsUrl = wsUrl ?? `ws://${wsHost}:${effectivePort}/${FLEET_PATH}`

  // #421: mint a READ-side observer token and write its coordinates beside the
  // db, so a watch client (fleet/watch.mjs, tunneled or local) can subscribe
  // to the same store the sandboxes sync — live push instead of ssh-tailing a
  // log. Same mint/verify path as sandbox tokens (tokenRecords is read by
  // reference on every handshake); the TTL is the drive's own, so the token
  // dies with the run it observes.
  {
    const { token: observerToken } = (() => {
      const minted = mintToken({ sandboxId: 'observer', ttlMs, now: clock() })
      tokenRecords.push(minted.record)
      return minted
    })()
    try {
      fs.writeFileSync(path.join(dbDir, 'observer.json'), JSON.stringify({
        port: effectivePort,
        path: FLEET_PATH,
        url: `ws://127.0.0.1:${effectivePort}/${FLEET_PATH}?token=${observerToken}`,
        expiresAt: clock() + ttlMs,
      }, null, 2))
    } catch (error) {
      console.error(`drive: observer.json not written (${error?.message ?? error}) — watch client unavailable this run`)
    }
  }

  let sweeping = false
  const runSweep = () => {
    // The sweep writes to the store when it converges a row away or parks a
    // run, which re-enters this listener. The outer sweep re-baselines at its
    // end, so a nested pass has nothing left to judge — skip it rather than
    // recurse.
    if (sweeping) return
    sweeping = true
    try {
      for (const description of sweep(clock())) {
        if (description.startsWith('converge-away')) convergedAway.push(description)
      }
    } finally {
      sweeping = false
    }
  }

  // Sweep on every change, not merely on the tick.
  //
  // The guard judges the NET delta between one sweep and the next, so two legal
  // transitions that land inside a single sweep interval collapse into one
  // illegal hop. `runShim` writes `claimed` and `running` as synchronous
  // neighbours, so a timer-only driver sees `pending -> running`, converges the
  // run back to `pending`, and pages security on a perfectly legal run — no
  // tick rate can separate two writes made in the same tick. Measured against
  // the real orchestrator: with a change listener the sweep observes
  // `pending, claimed, running, running, gate-green` one hop at a time and
  // converges nothing. The tick sweep stays as a floor, for the spend pass and
  // for a store that has gone quiet.
  const sweepListenerId = store.addTablesListener(() => runSweep())

  // --- lease continuity ----------------------------------------------------
  // "No false expiry" is decided by the claim's own history, not by catching a
  // moment: exactly one epoch ever existed (a reclaim increments it), the claim
  // was never observed expired, and it was never revoked. Sampling is a
  // best-effort supplement — the FINAL row is always sampled, so a run that
  // resolves between two polls is still judged.
  const epochs = new Set()
  let sawExpired = false
  let sawRevoked = false
  const observeClaim = () => {
    const row = store.getRow('claims', `claim:${runId}`)
    if (!row || row.holder === undefined) return
    epochs.add(row.epoch)
    const state = claimState(row, clock())
    if (state === 'expired') sawExpired = true
    if (state === 'revoked') sawRevoked = true
  }

  let status = 'unknown'
  let timedOut = false
  let leaseExpiryNoted = false
  let publishTimedOut = false
  let neverClaimed = false
  const startedAt = Date.now()

  // The rows this run published, by the same filter the read uses — so "has it
  // published its receipts yet" and "which receipts am I verifying" can never
  // disagree.
  const receiptsFor = () =>
    Object.entries(store.getTable('receipts'))
      .filter(([rowId, row]) => rowId.startsWith(`${runId}:`) || row.runId === runId)
      .map(([rowId, row]) => ({ rowId, sha: row.sha, path: row.path, verdict: row.verdict }))

  try {
    // 1. Seed the run, and let it reach the server before any
    //    sandbox arrives — `runShim` silently no-ops its status writes against a
    //    runs row it has not synced.
    store.setRow('runs', runId, { planPath, sandboxId: '', status: 'pending', branch })
    // The first sweep is now load-bearing for a reason it was not before: it is
    // where the claim-lease reaper reclaims sandboxes orphaned by an EARLIER
    // drive that died. `dbDir` is shared across runs, so this store already
    // carries their claim rows. It used to be incidental (it followed the
    // budget seed); it is kept deliberately.
    runSweep()
    await sleep(Math.min(settleMs, 200))

    // 2. Provision. The VM's name is claimed BEFORE the attempt, not after it,
    //    so the teardown guarantee survives a provisioner that throws partway
    //    (clone succeeded, ssh never came up) and would otherwise leave a
    //    billed sandbox running with nothing holding its name.
    vmName = sandboxIdFor(runId)
    note(`provisioning ${vmName} from ${golden}`)
    //    The token record reaches the gate via `registerToken` at MINT time,
    //    inside provisionRun — never after it returns. The old post-return
    //    push assumed "one microtask after the shim-start command returns is
    //    well before a remote node can boot and complete a ws handshake";
    //    that assumption was measured false (#302, run-10): the shim-start
    //    ssh backgrounds the whole remote command list and returns while node
    //    is booting, and the sandbox's first connect landed before the push.
    //    `planPath` rides the assignment because the sandbox has no other way
    //    to learn which plan it was dispatched to run — the store row carries
    //    one, but the shim reads its assignment file before it has synced
    //    anything. Without it the engine is launched with a literal
    //    `undefined` plan path.
    const provisioned = await provision({
      golden,
      runId,
      baseRef,
      repoDir,
      ttlMs,
      wsUrl: resolvedWsUrl,
      port: effectivePort,
      planPath,
      engineEnv,
      cpu: sandboxCpu,
      memory: sandboxMemory,
      disk: sandboxDisk,
      // The record reaches the token gate through this callback AT MINT TIME
      // — before the assignment is delivered, the tunnel opened, or the shim
      // started (#302). Pushing after provisionRun returned raced the
      // sandbox's first ws connect on a millisecond margin: the shim-start
      // ssh returns while the remote node is still booting, and run-10 lost
      // that race as an instant 401 (the 9-series lost it silently — #288).
      registerToken: (record) => tokenRecords.push(record),
      exec,
      clock,
    })
    vmName = provisioned.vmName
    store.setRow('runs', runId, { ...store.getRow('runs', runId), sandboxId: vmName })
    note(`provisioned ${vmName}`)

    // 3. Watch until the run resolves, or until nothing has moved for
    //    `heartbeatTimeoutMs`. Progress is any change to the run's status,
    //    claim, spend, or receipts — a live-but-slow run is never timed out.
    //
    //    `watchStartedAt` anchors a SEPARATE, tighter bound: a sandbox whose ws
    //    transport never connects (or whose shim never starts) writes NOTHING
    //    to the store, so it is never "stalled" by the progress-key check above
    //    — it never had any progress to lose. Without `claimTimeoutMs` the only
    //    exit for that sandbox is the full `heartbeatTimeoutMs` (#288), with
    //    zero output along the way to say why.
    const watchStartedAt = Date.now()
    let progressKey = ''
    let lastProgressAt = Date.now()
    for (;;) {
      heartbeat(clock())
      runSweep()
      observeClaim()

      if (sawExpired && !leaseExpiryNoted) {
        leaseExpiryNoted = true
        const msg = `claim expired mid-watch (ttlMs=${ttlMs}) — lease/token expiry, not an engine stall`
        errors.push(msg)
        note(msg)
      }

      status = store.getCell('runs', runId, 'status') ?? 'unknown'
      if (TERMINAL.has(status)) {
        note(`terminal status ${status} reached`)
        break
      }

      // A row with no claim still reads back as `{}`, not `undefined` — the
      // same shape `observeClaim` above already guards against — so presence
      // is decided by `holder`, never by mere truthiness of the row.
      const claimRow = store.getRow('claims', `claim:${runId}`) ?? null
      const hasClaim = claimRow !== null && claimRow.holder !== undefined
      const spendCount = Object.keys(store.getTable('spend')).length
      const receiptsCount = Object.keys(store.getTable('receipts')).length
      const key = JSON.stringify([status, claimRow, spendCount, receiptsCount])
      if (key !== progressKey) {
        progressKey = key
        lastProgressAt = Date.now()
        note(`progress: status=${status} claim=${hasClaim ? claimRow.epoch : 'none'} spend=${spendCount} receipts=${receiptsCount}`)
      }

      if (status === 'pending' && !hasClaim && Date.now() - watchStartedAt > claimTimeoutMs) {
        neverClaimed = true
        const msg = `sandbox never claimed within ${claimTimeoutMs}ms — transport dead or shim failed to start`
        errors.push(msg)
        note(msg)
        break
      }

      if (Date.now() - lastProgressAt > heartbeatTimeoutMs) {
        timedOut = true
        note(`heartbeat timeout after ${heartbeatTimeoutMs}ms with no progress`)
        break
      }
      await sleep(tickMs)
    }

    // 4. Wait for the PUBLISH, not for a nap.
    //
    //    The status flip and the run's output are separate writes: the sandbox
    //    reaches `gate-green` first and only then detects its integration
    //    branch, commits the receipts onto it, and publishes both. A fixed
    //    settle is a bet that all of that fits inside one constant — and it
    //    silently loses that bet on a slow sandbox, reading red for a run that
    //    was merely late. So the driver waits for the signal itself: the branch
    //    cell moved off the fallback AND the receipts table has rows for this
    //    run. The wait is BOUNDED by the heartbeat timeout, and a run that never
    //    publishes inside it reads red with `publish timeout` — fail-closed, and
    //    honest about which failure it was.
    //
    //    #318: a PARKED run publishes too — main() detects the branch and
    //    commits the receipts after runShim returns, whatever the verdict —
    //    and that branch died with the sandbox in run-14. So the wait now
    //    covers parked as well, on its own tighter bound: a parked run that
    //    publishes nothing (parked before the engine ran, cap park) must not
    //    idle out the full gate-green bound, and a cap park has already
    //    destroyed the sandbox, so `destroyed` breaks the wait immediately.
    //    Only the gate-green path can set publishTimedOut — a silent parked
    //    publish is an absence, not a red read.
    if (!timedOut && (status === 'gate-green' || status === 'parked')) {
      const bound =
        status === 'gate-green'
          ? Math.min(publishTimeoutMs, heartbeatTimeoutMs)
          : Math.min(parkedPublishWaitMs, heartbeatTimeoutMs)
      const publishDeadline = Date.now() + bound
      note(`publish wait (${status}): up to ${bound}ms for branch+receipts`)
      for (;;) {
        runSweep()
        observeClaim()
        const published = store.getCell('runs', runId, 'branch')
        if (isNonEmptyString(published) && published !== branch && receiptsFor().length > 0) {
          note(`publish wait: received ${published}`)
          break
        }
        if (status === 'parked' && destroyed) {
          note('publish wait: sandbox already destroyed — nothing will publish')
          break
        }
        if (Date.now() >= publishDeadline) {
          if (status === 'gate-green') {
            publishTimedOut = true
            errors.push('publish timeout')
          }
          note('publish wait: timed out')
          break
        }
        await sleep(publishPollMs)
      }
    }

    // 5. Settle the trailing scalars. `main()` writes the stamp and the token
    //    total AHEAD of the publish signal, so they have normally arrived by
    //    now; this is the margin for their sync round-trip, not the mechanism.
    await sleep(settleMs)
    runSweep()
    observeClaim()
    status = store.getCell('runs', runId, 'status') ?? status
  } catch (error) {
    errors.push(`drive: ${error?.message ?? error}`)
  }

  // --- the read ------------------------------------------------------------
  const reachedGateGreen = status === 'gate-green'

  const receipts = receiptsFor()

  // Receipts resolve only against a branch actually fetched back from the
  // sandbox, and only sha-by-sha. No receipts at all is NOT resolvable: an
  // empty set must never read as vacuously green.
  //
  // The branch is the one the SANDBOX published (the engine integrates to
  // `ultra/integration-<stamp>`, a name nothing on this side chose); `branch` is
  // only a fallback for a run that never published one, and it is expected to
  // fail the fetch rather than quietly resolve against something else.
  //
  // Resolution is three checks, and each closes a way the one before it can be
  // satisfied by something that is not this run's receipt:
  //
  //   exists       `cat-file -e <sha>` — is this object in the local store at
  //                all. Any commit that ever arrived here satisfies it,
  //                including one from an unrelated branch, so it is only an
  //                existence pre-check: it makes "no such commit" legible as
  //                distinct from the failures below.
  //   reachable    `merge-base --is-ancestor <sha> FETCH_HEAD` — is the commit
  //                on the branch this run actually produced.
  //   dereferenced `cat-file -e <sha>:<path>` — does the recorded PATH exist in
  //                the tree at that commit. Without it, a pointer into a
  //                gitignored directory (which is where the engine writes its
  //                receipts) passes both checks above while naming a file no
  //                commit ever contained and nothing can ever fetch.
  //
  // The branch name and both pointer halves are SANDBOX-authored data that this
  // process interpolates into a shell. They are validated here — not quoted,
  // not escaped — and a value that fails validation fails the read without ever
  // reaching `exec`.
  //
  // #318: a parked-with-receipts run resolves the same way — the branch is
  // fetched so a post-hoc human ack can land the work without a ~200k
  // re-drive — but the result lands ONLY in detail.parkedPublish, marked
  // unapproved. The gate read's receiptsResolvable stays a gate-green fact:
  // nothing about a park may brighten the read.
  let receiptsResolvable = false
  let parkedPublish = null
  // #368: the fetched tip, pinned by sha the moment the fetch lands — the
  // publish leg pushes THIS object, so nothing that touches FETCH_HEAD later
  // can change what reaches GitHub, and a folded tip goes up as-is (merge
  // commits included; a linear replay re-creates the overlap the fold
  // unioned — #363).
  let fetchedOk = false
  let fetchedBranch = null
  let fetchedTip = null
  const parkedWithReceipts = status === 'parked' && receipts.length > 0
  if (((reachedGateGreen && !publishTimedOut) || parkedWithReceipts) && receipts.length > 0 && vmName) {
    let resolvable = false
    try {
      const runBranch = store.getCell('runs', runId, 'branch') ?? branch
      if (!isSafeBranchName(runBranch)) {
        errors.push(`unsafe branch name in runs.${runId}.branch — refusing to fetch`)
      } else {
        const fetched = await exec(
          `git -C ${repoDir} -c core.sshCommand="${sandboxGitSsh}" fetch ssh://exedev@${vmName}.exe.xyz/home/exedev/repo ${runBranch}`,
        )
        if (fetched?.code !== 0) {
          errors.push(`fetch ${runBranch} failed (code ${fetched?.code})`)
        } else {
          fetchedOk = true
          fetchedBranch = runBranch
          resolvable = true
          const tip = await exec(`git -C ${repoDir} rev-parse FETCH_HEAD`)
          const tipSha = String(tip?.stdout ?? '').trim()
          if (tip?.code === 0 && isSafeSha(tipSha)) fetchedTip = tipSha
          else errors.push(`rev-parse FETCH_HEAD after fetching ${runBranch} failed (code ${tip?.code}) — nothing to push`)
          for (const receipt of receipts) {
            if (!isSafeSha(receipt.sha) || !isSafeRepoPath(receipt.path)) {
              errors.push(`unsafe receipt pointer in ${receipt.rowId} — refusing to verify`)
              receiptChecks.push({ ...receipt, exists: false, reachable: false, dereferenced: false, resolved: false })
              resolvable = false
              continue
            }
            const seen = await exec(`git -C ${repoDir} cat-file -e ${receipt.sha}`)
            const exists = seen?.code === 0
            let reachable = false
            let dereferenced = false
            if (exists) {
              const ancestry = await exec(`git -C ${repoDir} merge-base --is-ancestor ${receipt.sha} FETCH_HEAD`)
              reachable = ancestry?.code === 0
            }
            if (reachable) {
              const blob = await exec(`git -C ${repoDir} cat-file -e ${receipt.sha}:${receipt.path}`)
              dereferenced = blob?.code === 0
            }
            const resolved = exists && reachable && dereferenced
            receiptChecks.push({ ...receipt, exists, reachable, dereferenced, resolved })
            if (!resolved) resolvable = false
          }
        }
      }
    } catch (error) {
      errors.push(`receipts: ${error?.message ?? error}`)
      resolvable = false
    }
    if (reachedGateGreen) receiptsResolvable = resolvable
    // #336: non-null ⟺ the branch was fetched into repoDir. A failed or
    // refused fetch leaves NOTHING on this side — the branch dies with the
    // sandbox at teardown — so it reads null (RUNBOOK park triage step 2:
    // evidence-diff recovery), never a survived-shaped object carrying
    // `branch: null`. Why it was not fetched is already in `errors`.
    else if (fetchedOk) parkedPublish = { branch: fetchedBranch, fetched: true, receiptsResolvable: resolvable, unapproved: true }
  }

  const leaseContinuity = epochs.size === 1 && epochs.has(1) && !sawExpired && !sawRevoked

  // #282/#190: non-emptiness is necessary but nowhere near sufficient — a
  // sandbox that ran the GOLDEN IMAGE's code instead of the pushed base stamps
  // two perfectly non-empty cells naming the wrong commit. Cross-check them
  // against what the driver itself pushed. When that expectation could not be
  // resolved (`expectedStamp === null`, already narrated above) the check is
  // skipped and the key keeps its old non-emptiness meaning.
  const stampedVersion = store.getCell('runs', runId, 'pluginVersion')
  const stampedSha = store.getCell('runs', runId, 'engineSha')
  let versionStamp = isNonEmptyString(stampedVersion) && isNonEmptyString(stampedSha)
  if (versionStamp && expectedStamp !== null) {
    const match = stampedSha === expectedStamp.engineSha && stampedVersion === expectedStamp.pluginVersion
    if (!match) {
      errors.push(
        `version stamp mismatch: sandbox ran ${stampedVersion}@${stampedSha}, ` +
          `pushed base is ${expectedStamp.pluginVersion}@${expectedStamp.engineSha} — stale golden or wrong base (#282)`,
      )
      versionStamp = false
    }
  }
  // The installed half (#282, distill P5): the two cells above both derive
  // from the pushed ref, so a plugin baked STALE into the golden image passes
  // them. The shim also stamps the version `claude plugin list` reports as
  // (The installed-plugin cross-check died at 0.3.0 with the install it
  // checked: no plugin participates in the run, and comparing the golden's
  // bootstrap plugin to the pushed manifest would go permanently red at the
  // first release bump. versionStamp now attests the checkout stamp alone.)

  const reportedCell = store.getCell('runs', runId, 'reportedTokens')
  const spendObservational = {
    reported: typeof reportedCell === 'number' && Number.isFinite(reportedCell) ? reportedCell : null,
    ledger: totalSpent(store.getTable('spend'), runId),
  }

  const read = {
    // O1: provision -> claim -> run -> gate-green -> receipts, every receipt
    // binding to a real, reachable, dereferenceable pointer on the fetched
    // branch, published inside the bound, and zero store-caused failures
    // (nothing the guard had to converge away).
    o1:
      reachedGateGreen &&
      receipts.length > 0 &&
      receiptsResolvable &&
      convergedAway.length === 0 &&
      !timedOut &&
      !publishTimedOut,
    receiptsResolvable,
    leaseContinuity,
    versionStamp,
    // Observational at n=1 by construction (§W1d, finding F6): the tolerance
    // this read sets is derived from this same run. Pass/fail from W2 on.
    spendObservational,
  }

  const detail = {
    runId,
    planPath,
    vmName,
    status,
    timedOut,
    publishTimedOut,
    neverClaimed,
    elapsedMs: Date.now() - startedAt,
    receipts: receiptChecks.length > 0 ? receiptChecks : receipts,
    // #318: a parked run's published branch, fetched locally but UNAPPROVED —
    // no standing grant covers it; merging it needs an explicit operator ack
    // of the parked gate receipt. null when the park published nothing OR its
    // branch could not be fetched (#336) — `errors` says which.
    parkedPublish,
    convergedAway,
    pages,
    errors,
    epochs: [...epochs],
    // Where the pre-teardown evidence pull landed (`sandbox-logs.tgz`), or
    // null when it failed — the failure is in `errors`.
    sandboxLogs: null,
    // The sandbox's own resource samples, captured before teardown. A FLOOR
    // estimate — `stat` samples every 10 minutes — or null when the capture or
    // its derivation failed (the failure is in `errors`).
    sandboxStat: null,
    // The ultrapowers version the sandbox reported as INSTALLED (#282 image
    // side), or null when the shim did not stamp one.
    // #368: the PR the orchestrator opened — `{number, url, draft, branch}` —
    // or null, with the reason in `errors` (token missing, push or `gh`
    // failed, nothing fetched). Never a gate-read input: green stays green,
    // parked stays parked, whatever happened here.
    pullRequest: null,
    // The orchestrator's actual bound port (`port: 0` binds an ephemeral one) —
    // the read-back channel triage uses when `port` was not pinned.
    effectivePort: null,
  }
  detail.effectivePort = effectivePort

  // Tear down BEFORE the report is written, so a failed teardown — the one
  // failure that keeps costing money after the run is over — is recorded in the
  // detail the operator reads rather than thrown into an empty room. `detail`
  // holds `errors` by reference, so late pushes still serialize below. Each leg
  // is caught separately: a sandbox that will not die must not also stop the
  // orchestrator from shutting down and freeing its port.
  note('teardown start')
  store.delListener(sweepListenerId)
  try {
    await destroyOnce()
  } catch (error) {
    errors.push(`destroySandbox: ${error?.message ?? error}`)
  }
  detail.sandboxLogs = sandboxLogs
  detail.sandboxStat = sandboxStat

  // --- the publish leg (#368) -----------------------------------------------
  // AFTER teardown (the billing clock never waits on GitHub) and BEFORE the
  // store stops (so the PR url is stamped on the runs row). Runs only when the
  // branch is actually in `repoDir` with a pinned tip: a green run whose
  // receipts RESOLVE (a gate-green status with a pointer that does not bind is
  // a defect to diagnose, not a PR to open — RUNBOOK §Gate read), or a park
  // that published (`parkedPublish` non-null; the draft PR is the park card
  // even when a pointer is off, and its body says so). Every failure lands in
  // `errors` and leaves `pullRequest` null — the read above is already final
  // and is never touched. The token is read here, rides ONLY the env of the
  // two commands, is scrubbed from any output that is recorded, and is never
  // logged.
  const publishable = fetchedOk && fetchedTip !== null && ((reachedGateGreen && receiptsResolvable) || parkedPublish !== null)
  if (fetchedOk && reachedGateGreen && !receiptsResolvable) {
    errors.push(`PR not opened: gate-green but receipts unresolvable on ${fetchedBranch} — diagnose before publishing`)
  }
  if (publishable) {
    const parked = !reachedGateGreen
    let token = null
    try {
      token = fs.readFileSync(githubTokenPath, 'utf8').trim()
    } catch {
      token = null
    }
    if (!token) {
      errors.push(`github-token missing at ${githubTokenPath} — PR not opened`)
      note('publish: github-token missing — branch not pushed, PR not opened')
    } else {
      const scrub = (text) => String(text ?? '').split(token).join('<redacted>').trim()
      try {
        // The receipt to render: the run's own `gate` row when it resolved,
        // else the first resolved pointer. Both halves of a resolved pointer
        // already passed isSafeSha/isSafeRepoPath before reaching a shell.
        const resolved = receiptChecks.filter((r) => r.resolved)
        const chosen = resolved.find((r) => r.rowId === `${runId}:gate`) ?? resolved[0] ?? null
        let receipt = null
        let receiptSource = null
        if (chosen) {
          receiptSource = `${chosen.sha}:${chosen.path}`
          const shown = await exec(`git -C ${repoDir} show ${chosen.sha}:${chosen.path}`)
          if (shown?.code === 0) {
            try {
              receipt = JSON.parse(shown.stdout)
            } catch (error) {
              errors.push(`gate receipt ${receiptSource} is not JSON: ${error?.message ?? error}`)
            }
          } else errors.push(`git show ${receiptSource} failed (code ${shown?.code})`)
        }
        const closes = parsePlanCloses(committedText)
        const body = renderPullRequestBody({
          runId,
          planPath,
          branch: fetchedBranch,
          vmName,
          parked,
          receipt,
          receiptSource,
          read,
          receipts: detail.receipts,
          closes,
          errors: [...errors],
        })
        fs.mkdirSync(resolvedEvidenceDir, { recursive: true })
        const bodyFile = path.join(resolvedEvidenceDir, `pr-body-${runId}.md`)
        fs.writeFileSync(bodyFile, body)
        const title = pullRequestTitle({ runId, planText: committedText, planPath, parked })

        // 1. Push the fetched tip AS-IS. `origin` is the orchestrator clone's
        //    https remote; `gh auth git-credential` turns GH_TOKEN into the
        //    push credential with nothing written to disk. No prompt may ever
        //    hang an unattended drive.
        const pushCmd =
          `git -C ${repoDir} -c credential.helper= -c credential.helper='!gh auth git-credential' ` +
          `push origin ${fetchedTip}:refs/heads/${fetchedBranch}`
        const pushed = await boundedExec(pushCmd, { env: { GH_TOKEN: token, GIT_TERMINAL_PROMPT: '0' } })
        if (pushed?.code !== 0) {
          errors.push(`push ${fetchedBranch} to origin failed (code ${pushed?.code}) ${scrub(execDiagnostic(pushed))}`.trim())
          note(`publish: push of ${fetchedBranch} failed`)
        } else {
          note(`publish: pushed ${fetchedBranch} (${fetchedTip}) to origin`)
          // 2. Open the PR. Draft on the parked path — the park card.
          const ghCmd =
            `cd ${shellQuote(repoDir)} && gh pr create --base ${prBase} --head ${fetchedBranch} ` +
            `--title ${shellQuote(title)} --body-file ${shellQuote(bodyFile)}${parked ? ' --draft' : ''}`
          const created = await boundedExec(ghCmd, { env: { GH_TOKEN: token, GH_PROMPT_DISABLED: '1' } })
          const parsed = created?.code === 0 ? parsePullRequestUrl(created.stdout) : null
          if (parsed === null) {
            errors.push(`gh pr create for ${fetchedBranch} failed (code ${created?.code}) ${scrub(execDiagnostic(created))}`.trim())
            note(`publish: gh pr create failed for ${fetchedBranch}`)
          } else {
            detail.pullRequest = { number: parsed.number, url: parsed.url, draft: parked, branch: fetchedBranch }
            store.setCell('runs', runId, 'pullRequestUrl', parsed.url)
            note(`publish: opened ${parked ? 'draft ' : ''}PR #${parsed.number} ${parsed.url}`)
          }
        }
      } catch (error) {
        errors.push(`pull request: ${scrub(error?.message ?? error)}`)
      }
    }
  }

  try {
    await stop()
  } catch (error) {
    errors.push(`stop: ${error?.message ?? error}`)
  }

  fs.mkdirSync(path.dirname(resolvedReportPath), { recursive: true })
  // The report file is EXACTLY the read — it round-trips to it. Triage context
  // lives beside it so the gate read stays the contract it declares.
  fs.writeFileSync(resolvedReportPath, `${JSON.stringify(read, null, 2)}\n`)
  fs.writeFileSync(detailPath, `${JSON.stringify(detail, null, 2)}\n`)
  note(`gate read written to ${resolvedReportPath}`)

  return { read, reportPath: resolvedReportPath, detailPath, detail }
}
