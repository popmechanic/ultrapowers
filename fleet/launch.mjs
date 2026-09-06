#!/usr/bin/env node
/**
 * fleet/launch.mjs — start one run. The whole client, on the laptop.
 *
 * A run is a number N. There is no image to keep warm and no side repository to
 * keep in sync: the run is created with one plain `new` on exe.dev's default
 * image, and our delta is installed on that box by a first-boot setup script
 * handed to `new` on stdin. The launcher, in this order:
 *
 *   1. validates its own arguments — nothing has been executed yet;
 *   2. reads: that the `--repo` checkout is not shallow, its `origin` (it must
 *      name `--target`), that `--base` is a commit the checkout has and that it
 *      is on the target's default branch, `integrations list --json` (the
 *      target's one GitHub object must exist), `billing plan --json` (one run
 *      must fit the plan's pool), the target's `ultra/*` refs (the run number
 *      is one past the highest N they carry) and the engine tip, and asks
 *      `help <verb>` for every verb of `fleet/exe-verbs.json` — a drift there
 *      is a line on the launch, never a refusal;
 *   3. refreshes the Claude credential the run signs in with, the entry
 *      `--account` names — a refresh failure is a failure before any VM
 *      exists;
 *   4. commits the plan against a temporary index and pushes it to the target
 *      as `ultra/plan-run-N`; that commit's sha is `plan=` in the assignment;
 *   5. issues exactly one mutating lobby verb:
 *
 *        new --name <vm> --tag fleet --comment '<assignment>'
 *            --integration claude-max,gh-<owner>-<repo>
 *            --cpu <cpu> --memory <memory> --setup-script /dev/stdin --json
 *
 *      with the rendered setup script on that call's stdin.
 *
 * Nothing schedules the janitor, so the launcher runs it: one `janitor()` pass
 * between the pool read and the run number, whose reaped VMs the result carries
 * as `reaped`. A reap that fails says so in `reapError` and stops nothing — the
 * run being launched is worth more than the ballast the janitor came for.
 *
 * Nothing waits for ssh and nothing starts the unit: the setup script does
 * both, on the VM. A `new` that answers non-zero is retried — three attempts in
 * all, a freshly minted name each time, because exe.dev reserves a refused name
 * forever — and the failure after the third carries every attempt's output.
 *
 * A `--base` the target's default branch has never seen is a refusal, before
 * the plan is pushed: run-27 was launched off a parked branch and every merge
 * after it was a hand rebase. The read is the origin's own — one `ls-remote
 * --symref origin HEAD` for the branch's name and tip, one `fetch` of that
 * branch, one `merge-base --is-ancestor` — and a shallow checkout, which cannot
 * answer the question at all, is refused before even that.
 *
 * A target with no `gh-<owner>-<repo>` object is a refusal, before the plan is
 * pushed: a public repo would still clone from github.com, but nothing could
 * push its branch or open its PR, and a run that cannot publish is a run nobody
 * asked for. `node fleet/target.mjs <owner>/<repo>` builds the object once.
 *
 * A refusal (exit 2) happens before anything is created, so the account and the
 * target are exactly as they were. A failure after that (exit 1) prints the
 * lobby's own words: exe.dev documents no error envelope, so a refused name or
 * a full account is shown verbatim rather than paraphrased.
 */

import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import {
  CLAUDE_INTEGRATION,
  COMMENT_MAX_BYTES,
  ENGINE_URL,
  EXE_HOST,
  FLEET_DEFAULTS,
  FLEET_TAG,
  LobbyError,
  Refusal,
  buildComment,
  defaultExec,
  evidenceBranchFor,
  git,
  githubIntegrationFor,
  highestRunOnTarget,
  integrationBranchFor,
  isFullSha,
  isRunNumber,
  isSafeSha,
  isSafeTarget,
  isVmName,
  listIntegrations,
  loadFleetConfig,
  lobby,
  output,
  parseArgs,
  parseMemoryGb,
  planBranchFor,
  readPlanCapacity,
  runCli,
  statusUrlFor,
  vmNameFor
} from './lobby.mjs'
import { fleetConfigAccount, verbDrift } from './doctor.mjs'
import { janitor } from './janitor.mjs'
import { readFleetFiles, renderSetupScript } from './setup-script.mjs'

/** One string, so a docs check that reads the first `usage` literal sees every
 *  flag the launch line may carry. */
export const USAGE = `usage: node fleet/launch.mjs <plan.md> --target <owner>/<repo> --base <40-hex>
                             [--repo <dir>] [--engine <40-hex>]
                             [--overlap fold|serialize] [--tier standard|mostCapable]
                             [--implementer-effort low|medium|high] [--hold]
                             [--cpu <n>] [--memory <n>GB]
                             [--run <N>] [--config <path>] [--account <name>] [--json]`

export const usage = () => USAGE

/** The three enumerated flags, with the exact spellings the comment carries. */
export const OVERLAP_VALUES = Object.freeze(['fold', 'serialize'])
export const TIER_VALUES = Object.freeze(['standard', 'mostCapable'])
/** The effort the implementers (and their fix rounds) work at; every judge
 *  keeps its own. The CLI also takes `xhigh` and `max`; the knob turns effort
 *  DOWN, so it offers the lower three and refuses the rest. */
export const EFFORT_VALUES = Object.freeze(['low', 'medium', 'high'])

/**
 * The keychain entry a run signs in with when neither `--account` nor the
 * config names one — the entry every laptop that walked the first run has.
 * `ACCOUNT_NAME` is `fleet/claude-token.mjs`'s own rule, copied rather than
 * imported: the launcher refuses a name the credential tool would refuse, and
 * it refuses it before anything is executed.
 */
export const DEFAULT_ACCOUNT = 'ultrapowers'
const ACCOUNT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/** The lobby-verb record the preflight compares the live lobby against. */
const VERBS_PATH = new URL('./exe-verbs.json', import.meta.url).pathname

/** Where the plan lands in the commit the launcher pushes. */
export const PLAN_PATH = '.ultrapowers/plan.md'
export const VERDICTS_PATH = '.ultrapowers/gate-verdicts.json'

/**
 * What a base off the default branch is told to do. The parked branch is not
 * lost and nothing here takes a patch: decision 5 of #715 asks the operator to
 * re-drive that work as a plan on `main`, which is procedure and not a flag.
 */
export const BASE_OFF_MAIN_FIX =
  'relaunch from main; a parked branch is re-driven as a plan on main, not as a base'

/** What a shallow launch checkout is told to do — by hand, never by the
 *  launcher: unshallowing an operator's clone is not a launch's business. */
export const SHALLOW_FIX = 'is a shallow clone — unshallow it by hand and relaunch'

/**
 * How many `new` lines a launch may issue, and the window it sleeps in between
 * them. A name exe.dev refused stays reserved, so each attempt mints its own.
 */
export const NEW_ATTEMPTS = 3
export const RETRY_MIN_MS = 1_000
export const RETRY_MAX_MS = 3_000

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** A positive decimal integer — what `--cpu` and the config's `cpu` must be. */
const isPositiveInt = (value) => isRunNumber(value)

/**
 * What `--memory` and the config's `memory` must be: `<int>GB`, the spelling
 * the lobby's `--memory` takes verbatim. `parseMemoryGb` also reads `16 G`,
 * which would put a space inside the `new` line, so the shape is pinned here
 * before the number is taken off it.
 */
const isMemorySize = (value) => /^[1-9][0-9]*GB$/.test(String(value))

/**
 * The four spellings a checkout's `origin` may carry for one GitHub target.
 * Anything else answers null, and the refusal names what it saw rather than
 * guessing a repository out of it.
 */
const ORIGIN_SPELLINGS = Object.freeze([
  /^https:\/\/github\.com\/(.+?)(?:\.git)?\/?$/,
  /^git@github\.com:(.+?)(?:\.git)?\/?$/,
  /^ssh:\/\/git@github\.com\/(.+?)(?:\.git)?\/?$/
])

export function targetOfOriginUrl (url) {
  const text = String(url ?? '').trim()
  for (const pattern of ORIGIN_SPELLINGS) {
    const match = pattern.exec(text)
    if (match && isSafeTarget(match[1])) return match[1]
  }
  return null
}

/**
 * The engine sha, when `--engine` was not given: the tip of the PUBLIC
 * ultrapowers repository, read with `git ls-remote`. The sandbox clones from
 * GitHub at `engine=`, so the only shas that can work are the ones GitHub
 * already has; a local `HEAD` is a sha the sandbox cannot fetch.
 */
async function defaultEngineSha (exec) {
  const res = await exec('git', ['ls-remote', ENGINE_URL, 'HEAD'])
  if (res.code !== 0) {
    throw new Refusal(`engine: git ls-remote ${ENGINE_URL} HEAD failed:\n${output(res)}`)
  }
  const sha = String(res.stdout).trim().split(/\s+/)[0] ?? ''
  if (!isFullSha(sha)) {
    throw new Refusal(
      `engine: git ls-remote ${ENGINE_URL} HEAD answered no 40-hex sha (got ${JSON.stringify(sha.slice(0, 64))}); pass --engine <40-hex>`
    )
  }
  return sha
}

// The Claude Max access token lives at the edge and expires in hours; the
// laptop holds the refresh token. Before a VM exists, rotate it if it is within
// 30 minutes of expiry — a run that outlives its bearer dies in the gate.
// A laptop set up with `claude setup-token` (no keychain record) skips this.
//
// The account is the launch's, so the entry this rotates and installs is the
// one the run signs in with — one entry, chosen per run and never mid-run.
// `spawn` is the second argument for the exam's sake: a spy records the argv
// and the real credential tool, and the keychain behind it, stay untouched.
export function defaultRefreshCredential (account = DEFAULT_ACCOUNT, spawn = spawnSync) {
  const tool = new URL('./claude-token.mjs', import.meta.url).pathname
  const r = spawn(process.execPath, [tool, 'refresh', '--account', account], { encoding: 'utf8' })
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
  if (r.status === 0) return { ok: true, out }
  if (/no refresh token in the keychain/.test(out)) return { ok: true, skipped: true, out }
  return { ok: false, out }
}

/**
 * Everything the launcher does, with the exec seam, the clock, the sleep and
 * the name's random half injected. Answers the launched run's record.
 */
export async function launch ({
  argv, exec = defaultExec, config, now = () => new Date(), sleep = defaultSleep, rand,
  refreshCredential = defaultRefreshCredential, verbsPath = VERBS_PATH
}) {
  const { opts, positional } = parseArgs(argv, { flags: ['json', 'hold'] })

  // ── Local validation. Nothing has been executed at this point, and nothing
  //    will be until every one of these passes. ──────────────────────────────
  const planPath = positional[0]
  if (!planPath) throw new Refusal(`launch: a plan path is required\n${usage()}`)
  const target = opts.target
  if (!isSafeTarget(target)) {
    throw new Refusal(`launch: --target must be <owner>/<repo>, got ${JSON.stringify(target ?? null)}`)
  }
  if (!isFullSha(opts.base)) {
    throw new Refusal(`launch: --base must be a 40-hex commit sha, got ${JSON.stringify(opts.base ?? null)}`)
  }
  if (opts.engine !== undefined && !isFullSha(opts.engine)) {
    throw new Refusal(`launch: --engine must be a 40-hex commit sha, got ${JSON.stringify(opts.engine)}`)
  }
  if (opts.overlap !== undefined && !OVERLAP_VALUES.includes(opts.overlap)) {
    throw new Refusal(`launch: --overlap must be one of ${OVERLAP_VALUES.join('|')}, got ${JSON.stringify(opts.overlap)}`)
  }
  if (opts.tier !== undefined && !TIER_VALUES.includes(opts.tier)) {
    throw new Refusal(`launch: --tier must be one of ${TIER_VALUES.join('|')}, got ${JSON.stringify(opts.tier)}`)
  }
  const implementerEffort = opts['implementer-effort']
  if (implementerEffort !== undefined && !EFFORT_VALUES.includes(implementerEffort)) {
    throw new Refusal(`launch: --implementer-effort must be one of ${EFFORT_VALUES.join('|')}, got ${JSON.stringify(implementerEffort)}`)
  }
  // `--hold` is a bare flag, so `parseArgs` answers `true` for it and a string
  // for any `--hold=<value>` spelling. A string is a refusal here, before the
  // plan is read and before anything is executed: `hold=1` is the only value
  // the sandbox accepts, and a launch that meant to hold must not silently
  // become one that merges.
  if (opts.hold !== undefined && opts.hold !== true) {
    throw new Refusal(`launch: --hold takes no value, got ${JSON.stringify(opts.hold)}`)
  }
  if (opts.run !== undefined && !isRunNumber(opts.run)) {
    throw new Refusal(`launch: --run must be a positive integer, got ${JSON.stringify(opts.run)}`)
  }
  // `--account` reaches `claude-token.mjs refresh` as an argument and the
  // keychain as an item's account, so a name it would refuse is refused here,
  // before the first read — a launch that cannot name its entry has not yet
  // touched exe.dev or the target.
  if (opts.account !== undefined && (opts.account === true || !ACCOUNT_NAME.test(opts.account))) {
    throw new Refusal(
      `launch: --account must be a name matching ${ACCOUNT_NAME.source}, got ${JSON.stringify(opts.account === true ? null : opts.account)}`
    )
  }

  const settings = config ?? await loadFleetConfig({ path: opts.config })
  // Which keychain entry this run signs in with: the flag, else the config's
  // `account`, else the entry the first-run walk builds. `loadFleetConfig`
  // answers only the two keys the pool is sized from, so the file's account is
  // read by `fleetConfigAccount` — and only when no config was injected, so an
  // exam that hands `launch` a config never reads the laptop's own.
  let account = opts.account === undefined ? null : String(opts.account)
  if (account === null) {
    const named = config === undefined || config === null
      ? await fleetConfigAccount({ path: opts.config })
      : config.account
    account = typeof named === 'string' && named !== '' ? named : DEFAULT_ACCOUNT
  }
  const cpu = String(opts.cpu ?? settings.cpu ?? FLEET_DEFAULTS.cpu)
  const memory = String(opts.memory ?? settings.memory ?? FLEET_DEFAULTS.memory)
  if (!isPositiveInt(cpu)) {
    throw new Refusal(`launch: cpu must be a positive integer, got ${JSON.stringify(cpu)}`)
  }
  const memoryGb = isMemorySize(memory) ? parseMemoryGb(memory) : null
  if (memoryGb === null) {
    throw new Refusal(`launch: memory must be a whole number of gigabytes spelled <int>GB, got ${JSON.stringify(memory)}`)
  }

  const repoDir = path.resolve(String(opts.repo ?? process.cwd()))

  let planText
  try {
    planText = await fsp.readFile(planPath, 'utf8')
  } catch (error) {
    throw new Refusal(`launch: cannot read plan ${planPath}: ${error?.message ?? error}`)
  }
  if (planText.trim() === '') throw new Refusal(`launch: plan ${planPath} is empty`)
  let verdictsText = null
  try {
    verdictsText = await fsp.readFile(`${planPath.replace(/\.md$/, '')}.gate-verdicts.json`, 'utf8')
  } catch {
    verdictsText = null
  }

  // The comment's length does not depend on which sha the plan commit gets —
  // every sha is 40 hex — so the ceiling is checked here, before the world is
  // touched, with a placeholder standing in for `plan=`.
  const fields = {
    run: opts.run ?? '0',
    plan: '0'.repeat(40),
    target,
    base: opts.base,
    engine: opts.engine ?? '0'.repeat(40),
    overlap: opts.overlap,
    tier: opts.tier,
    effort: implementerEffort,
    hold: opts.hold === true ? '1' : undefined
  }
  const probeComment = buildComment(fields)
  if (Buffer.byteLength(probeComment, 'utf8') > COMMENT_MAX_BYTES) {
    throw new Refusal(
      `launch: assignment comment would be ${Buffer.byteLength(probeComment, 'utf8')} bytes, over the ${COMMENT_MAX_BYTES}-byte ceiling`
    )
  }

  // ── Reads. Still nothing mutated, on exe.dev or on the target. ────────────

  // A shallow checkout is refused first, before anything is read off the
  // origin: its history is truncated, so no `merge-base` it could answer says
  // anything about where `--base` sits. The launcher does not deepen it — an
  // operator's clone is theirs, and a launch is not the place to rewrite it.
  const shallow = await git(exec, repoDir, ['rev-parse', '--is-shallow-repository'])
  if (shallow.code === 0 && String(shallow.stdout ?? '').trim() === 'true') {
    throw new Refusal(
      `launch: --repo ${repoDir} ${SHALLOW_FIX}: a truncated history cannot answer whether --base ${opts.base} is on ${target}'s default branch`
    )
  }

  const originUrl = await readOriginUrl({ exec, repoDir })
  const originTarget = targetOfOriginUrl(originUrl)
  if (originTarget !== target) {
    throw new Refusal(
      `launch: ${repoDir} has origin ${JSON.stringify(originUrl)}, which does not name ${target}`
    )
  }

  const baseCheck = await git(exec, repoDir, ['rev-parse', '--verify', `${opts.base}^{commit}`])
  if (baseCheck.code !== 0) {
    throw new Refusal(
      `launch: ${repoDir} has no commit ${opts.base}:\n${output(baseCheck)}`
    )
  }

  // ── The base is on the target's default branch, or it is a refusal. The
  //    origin names its own default branch and that branch's tip in one
  //    `ls-remote --symref`; the fetch brings the tip's history into this
  //    checkout, and `merge-base --is-ancestor` answers the question. Every one
  //    of the three is a read of the target, and the only ref any of them
  //    writes is this checkout's `refs/remotes/origin/<default>`: `HEAD`, the
  //    local branches and the working tree are the operator's and stay as they
  //    were.
  const origin = await readDefaultBranch({ exec, repoDir })
  const fetched = await git(exec, repoDir, ['fetch', 'origin', origin.branch])
  // A fetch that answered non-zero is not itself the refusal — a checkout that
  // already has the tip needs nothing from it. What is fatal is not having the
  // tip afterward, because then no ancestry answer means anything.
  const hasTip = await git(exec, repoDir, ['cat-file', '-e', `${origin.tip}^{commit}`])
  if (hasTip.code !== 0) {
    throw new Refusal(
      `launch: ${repoDir} does not have ${target}'s ${origin.branch} tip ${origin.tip} — git fetch origin ${origin.branch} answered exit ${fetched.code}:\n${output(fetched)}`
    )
  }
  // git refreshes `refs/remotes/origin/<default>` on a fetch only when the line
  // named a configured remote and its refspec covers the branch; the launch's
  // one effect on the checkout should not depend on either, so the ref is
  // pointed at the tip the fetch just brought.
  if (fetched.code === 0) {
    await git(exec, repoDir, ['update-ref', `refs/remotes/origin/${origin.branch}`, origin.tip])
  }
  const ancestry = await git(exec, repoDir, ['merge-base', '--is-ancestor', opts.base, origin.tip])
  if (ancestry.code !== 0) {
    throw new Refusal(
      `launch: --base ${opts.base} is not on ${target}'s ${origin.branch} (tip ${origin.tip}) — ${BASE_OFF_MAIN_FIX}`
    )
  }

  const githubName = githubIntegrationFor(target)
  if (!(await listIntegrations(exec)).some((row) => row.name === githubName)) {
    throw new Refusal(
      `launch: no ${githubName} integration — the sandbox could still clone a public ${target} from github.com, but could not push its branch or open its PR. Build it once: node fleet/target.mjs ${target}`
    )
  }

  // ── The verb-drift preflight. `help <verb>` for every verb of the record,
  //    diffed against the flags recorded there. Every read, and every one of
  //    them a `help` line: `exec.mutating()` is untouched by it. A drift, a
  //    `help` that answers non-zero and a record that cannot be read at all
  //    are findings on the launch line and nothing more — the lobby's flags
  //    are exe.dev's to change, and a launch that still works is not a launch
  //    to refuse. So even a `help` seam that throws leaves the outcome alone.
  let drift
  try {
    drift = await verbDrift({
      help: (verb) => exec('ssh', [EXE_HOST, `help ${verb}`]),
      recordPath: verbsPath
    })
  } catch (error) {
    drift = {
      readable: false,
      capturedAt: null,
      findings: [],
      detail: `fleet/exe-verbs.json could not be compared against the lobby: ${error?.message ?? error}`
    }
  }

  // One run must fit the plan's pool. Allocation is over-committable and
  // exe.dev refuses nothing by sum, so this is never a sum over live VMs:
  // contention bounds concurrency, and two plans at once is by design.
  const capacity = await readPlanCapacity(exec)
  if (capacity.maxCpus < Number(cpu)) {
    throw new Refusal(
      `launch: --cpu ${cpu} does not fit the plan — billing plan --json says max_cpus ${capacity.maxCpus}`
    )
  }
  if (capacity.maxMemoryGb < memoryGb) {
    throw new Refusal(
      `launch: --memory ${memory} does not fit the plan — billing plan --json says max_memory_gb ${capacity.maxMemoryGb}`
    )
  }

  // ── The reap. Nothing schedules the janitor, so every launch is where it
  //    runs — before the run number is read, so the fleet a launch joins is
  //    already clear of the VMs of runs that finished over an hour ago.
  //    `settings` is the config loaded above, so the file is read once. A reap
  //    that fails is reported and not fatal: the run being launched is worth
  //    more than the ballast the janitor came for.
  const reaped = []
  let reapError = null
  try {
    const reap = await janitor({ argv: [], exec, config: settings, now })
    for (const action of reap.actions) {
      if (action.kind === 'rm' && action.applied === true) reaped.push(action.vm)
    }
  } catch (error) {
    reapError = String(error?.message ?? error) || 'launch: the reap failed'
  }

  const run = opts.run ? Number(opts.run) : await highestRunOnTarget(exec, repoDir) + 1
  // Where the sha came from, so the launch line can say whether the operator
  // chose this engine or the launcher read whatever `main` happened to be at.
  const engineSource = opts.engine === undefined ? 'main-tip' : 'pinned'
  const engine = opts.engine ?? await defaultEngineSha(exec)

  const cred = refreshCredential(account)
  if (!cred.ok) {
    throw new LobbyError(`launch: the Claude credential could not be refreshed — no VM was created\n${cred.out}`)
  }

  // ── The plan commit, pushed to the target before the VM exists. Plumbing
  //    against a temporary index, so the operator's index and working tree are
  //    never touched. ─────────────────────────────────────────────────────────
  const planBranch = planBranchFor(run)
  const planSha = await commitPlan({ exec, repoDir, base: opts.base, run, planText, verdictsText })
  const commands = []
  const pushArgv = ['-C', repoDir, 'push', 'origin', `${planSha}:refs/heads/${planBranch}`]
  commands.push(`git ${pushArgv.join(' ')}`)
  const push = await exec('git', pushArgv)
  if (push.code !== 0) {
    throw new Refusal(
      `launch: git push origin ${planSha}:refs/heads/${planBranch} failed (exit ${push.code}):\n${output(push)}`
    )
  }

  // ── The one mutating lobby verb. ──────────────────────────────────────────
  const comment = buildComment({ ...fields, run: String(run), plan: planSha, engine })
  const script = renderSetupScript({ run: String(run), ...readFleetFiles() })
  const remoteFor = (vm) =>
    `new --name ${vm} --tag ${FLEET_TAG} --comment '${comment}'` +
    ` --integration ${CLAUDE_INTEGRATION},${githubName}` +
    ` --cpu ${cpu} --memory ${memory} --setup-script /dev/stdin --json`

  const minted = new Set()
  const failures = []
  let vm = null
  for (let attempt = 1; attempt <= NEW_ATTEMPTS; attempt += 1) {
    let name = vmNameFor(run, now(), rand)
    while (minted.has(name)) name = vmNameFor(run, now())
    if (!isVmName(name)) {
      throw new Refusal(`launch: minted VM name ${JSON.stringify(name)} is not fleet-r<N>-<yymmddHHMM>-<4 hex>`)
    }
    minted.add(name)
    const remote = remoteFor(name)
    commands.push(remote)
    try {
      await lobby(exec, remote, { input: script })
      vm = name
      break
    } catch (error) {
      failures.push(`attempt ${attempt} of ${NEW_ATTEMPTS} (${name}):\n${error?.message ?? error}`)
      if (attempt === NEW_ATTEMPTS) {
        throw new LobbyError(
          `launch: exe.dev refused \`new\` on all ${NEW_ATTEMPTS} attempts; run ${run}'s plan is on ${planBranch}\n${failures.join('\n')}`
        )
      }
      await sleep(retryDelay())
    }
  }

  return {
    run,
    runId: `run-${run}`,
    vm,
    statusUrl: statusUrlFor(vm),
    comment,
    plan: planSha,
    planBranch,
    evidenceBranch: evidenceBranchFor(run),
    integrationBranch: integrationBranchFor(run),
    target,
    base: opts.base,
    engine,
    engineSource,
    // The account is the run's, but never the assignment's: `parse_assignment`
    // on the VM refuses a comment key it does not know, and neither
    // `COMMENT_KEYS` nor `buildComment` spells `account`. It lives here and on
    // the launch line instead.
    account,
    verbDrift: drift,
    github: githubName,
    cpu,
    memory,
    launchedAt: now().toISOString(),
    commands,
    reaped,
    reapError
  }
}

/** A whole number of milliseconds in [RETRY_MIN_MS, RETRY_MAX_MS]. */
const retryDelay = () =>
  RETRY_MIN_MS + Math.floor(Math.random() * (RETRY_MAX_MS - RETRY_MIN_MS + 1))

/** The `origin` URL of the checkout a launch runs against, or a refusal. */
async function readOriginUrl ({ exec, repoDir }) {
  const res = await git(exec, repoDir, ['remote', 'get-url', 'origin'])
  if (res.code !== 0) {
    throw new Refusal(
      `launch: --repo ${repoDir} is not a git checkout with an origin remote:\n${output(res)}`
    )
  }
  return String(res.stdout ?? '').trim()
}

/**
 * The origin's default branch and the sha it points at, off one `ls-remote
 * --symref origin HEAD`. That prints two lines — `ref: refs/heads/<name>\tHEAD`
 * and `<sha>\tHEAD` — and the name comes off the first, the tip off the second.
 * A branch name is used in later git lines, so it is pinned to the shape a
 * branch has; anything the launcher cannot read is a refusal, because guessing
 * `main` here is exactly the guess this check exists to stop making.
 */
async function readDefaultBranch ({ exec, repoDir }) {
  const res = await git(exec, repoDir, ['ls-remote', '--symref', 'origin', 'HEAD'])
  if (res.code !== 0) {
    throw new Refusal(
      `launch: git ls-remote --symref origin HEAD in ${repoDir} failed (exit ${res.code}):\n${output(res)}`
    )
  }
  let branch = null
  let tip = null
  for (const line of String(res.stdout ?? '').split('\n')) {
    const symref = /^ref:\s+refs\/heads\/(\S+)\s+HEAD$/.exec(line.trim())
    if (symref) branch ??= symref[1]
    const head = /^([0-9a-f]{40})\s+HEAD$/.exec(line.trim())
    if (head) tip ??= head[1]
  }
  if (branch === null || tip === null || !/^[A-Za-z0-9][A-Za-z0-9._\-/]*$/.test(branch)) {
    throw new Refusal(
      `launch: git ls-remote --symref origin HEAD named no default branch and tip:\n${output(res)}`
    )
  }
  return { branch, tip }
}

/**
 * The plan commit: `<base>`'s tree plus `.ultrapowers/plan.md` (and the gate
 * verdicts when the plan has a sibling verdicts file), one commit on `<base>`,
 * built entirely with plumbing against a temporary index file. The operator's
 * own index and working tree are never read and never written, so a launch
 * from a dirty checkout is as safe as one from a clean one.
 *
 * A local git failure here is still a refusal: exe.dev has seen nothing but
 * reads, and the target has nothing new on it.
 */
async function commitPlan ({ exec, repoDir, base, run, planText, verdictsText }) {
  const indexDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'fleet-plan-'))
  const env = { ...process.env, GIT_INDEX_FILE: path.join(indexDir, 'index') }
  const plumb = async (argv, options = {}) => {
    const res = await exec('git', ['-C', repoDir, ...argv], { env, ...options })
    if (res.code !== 0) {
      throw new Refusal(`launch: git ${argv.join(' ')} failed (exit ${res.code}):\n${output(res)}`)
    }
    return String(res.stdout ?? '').trim()
  }
  try {
    await plumb(['read-tree', base])
    const entries = [[PLAN_PATH, planText]]
    if (verdictsText !== null) entries.push([VERDICTS_PATH, verdictsText])
    for (const [rel, text] of entries) {
      const blob = await plumb(['hash-object', '-w', '--stdin'], { input: text })
      if (!isSafeSha(blob)) {
        throw new Refusal(`launch: git hash-object answered ${JSON.stringify(blob)}, not an object name`)
      }
      await plumb(['update-index', '--add', '--cacheinfo', `100644,${blob},${rel}`])
    }
    const tree = await plumb(['write-tree'])
    if (!isSafeSha(tree)) {
      throw new Refusal(`launch: git write-tree answered ${JSON.stringify(tree)}, not an object name`)
    }
    const sha = await plumb(['commit-tree', tree, '-p', base, '-m', `ultrapowers plan run-${run}`])
    if (!isFullSha(sha)) {
      throw new Refusal(`launch: git commit-tree answered ${JSON.stringify(sha)}, not a 40-hex sha`)
    }
    return sha
  } finally {
    await fsp.rm(indexDir, { recursive: true, force: true })
  }
}

/**
 * An unpinned engine, named as the tip it is. Only the unpinned case is
 * annotated: a pinned sha is one the operator typed, and the assignment comment
 * already prints `engine=<sha>` either way, so there is nothing a `(pinned)`
 * line would tell them. #636 asks for exactly this — that the tip stop passing
 * for a choice — and `fleet/tests/test_launch.mjs` pins a pinned launch's
 * rendering at its four lines, so an annotation there would break it.
 *
 * The annotation is a rendered line, never part of the comment: the comment's
 * text is pinned byte-for-byte, and a run reading it must not have to strip
 * prose off the sha.
 */
const engineLine = (result) =>
  result.engineSource === 'main-tip'
    ? `engine=${result.engine} (main tip; pass --engine <40-hex> to pin)`
    : null

/**
 * The lines a launched run prints: its id, its VM, where to watch, what it was
 * told, one line per VM this launch's reap removed, which keychain entry it
 * signed in with, what the verb-drift preflight found — and, when nobody
 * pinned one, which engine it happens to have caught. A launch that reaped
 * nothing prints no reap line at all.
 *
 * `account=` is a rendered line and never part of the comment: the comment is
 * the assignment the VM parses, and a key it does not know kills the run at
 * boot. The two launches that differ only in `--account` build the same
 * comment byte for byte and differ on this line.
 */
export const renderLaunch = (result) => [
  result.runId,
  result.vm,
  result.statusUrl,
  result.comment,
  ...(result.reaped ?? []).map((vm) => `reaped ${vm}`),
  result.account === undefined ? null : `account=${result.account}`,
  result.verbDrift === undefined ? null : `verb-drift: ${result.verbDrift.detail}`,
  engineLine(result)
].filter((line) => line !== null).join('\n')

async function main (argv) {
  const { opts } = parseArgs(argv, { flags: ['json', 'hold'] })
  const result = await launch({ argv })
  process.stdout.write(opts.json ? `${JSON.stringify(result)}\n` : `${renderLaunch(result)}\n`)
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  await runCli(main, process.argv.slice(2))
}
