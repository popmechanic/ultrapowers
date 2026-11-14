#!/usr/bin/env node
/**
 * fleet/janitor.mjs — reap finished runs; write the deaths; report stale ones.
 *
 *   node fleet/janitor.mjs [--age 1h] [--target <owner>/<repo>] [--dry-run] [--json] [--help]
 *
 * The contract is `fleet/CONTRACT.md` §Janitor: what a pass reads (the run's
 * status page in the evidence repository), what
 * it removes (a finished run's VM after `--age`, an integration branch nothing
 * merged), what it writes (a dead or orphaned run's end, then the seal; the
 * seal alone for a run that ended without one) and what it only reports
 * (`kept`, `unknown`, `unread`, `stale`). This header does not restate it
 * (#1444); the comments below say why the code is shaped the way it is.
 *
 * Nothing schedules it: `fleet/launch.mjs` runs it before every launch, and it
 * is run by hand after the laptop has been asleep. `--dry-run` issues every
 * read and no write.
 */

import { Buffer } from 'node:buffer'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  DEFAULT_CONFIG_PATH,
  PLAN_FILE,
  Refusal,
  defaultExec,
  evidenceUrlFor,
  git,
  integrationBranchFor,
  isFullSha,
  isRunNumber,
  isSafeTarget,
  isVmName,
  listVms,
  liveBranchFor,
  lobby,
  LobbyError,
  output,
  parseArgs,
  parseComment,
  parseDuration,
  parseJson,
  readEvidenceSetting,
  runCli,
  runFolderFor,
  runOfBranch,
  runOfEvidenceRef,
  runOfVmName,
  runTagFor
} from './lobby.mjs'

export const USAGE = 'usage: node fleet/janitor.mjs [--age 1h] [--target <owner>/<repo>] [--dry-run] [--json] [--help]'

export const usage = () => USAGE

/** The states of a status page that mean the run is over and its VM is ballast. */
export const REAPABLE_STATES = Object.freeze(['done', 'parked', 'failed'])
/** Page states that claim the run is still in flight — the ones worth a probe. */
const LIVE_STATES = Object.freeze(['booting', 'running', 'publishing'])
/** How long a finished run keeps its VM, so its status page can still be read. */
const DEFAULT_AGE = '1h'
/** No status update for this long is a stale run, reported and left alone. */
const STALE_MS = 6 * 60 * 60 * 1000
/**
 * The hour is for the operator to read a status page before the run is
 * reaped: `reapPlan({finished, updatedAt, nowMs, ageMs})` names the moment a
 * finished run crosses it, without mutating anything. `updatedAt` that does
 * not parse, or a run not yet `finished`, answers `none` — there is nothing
 * to name a time for.
 */
const reapPlan = ({ finished, updatedAt, nowMs, ageMs }) => {
  const updated = Date.parse(String(updatedAt))
  if (!Number.isFinite(updated) || finished !== true) return { action: 'none', reapableAt: null }
  const at = updated + ageMs
  return nowMs >= at
    ? { action: 'rm', reapableAt: new Date(at).toISOString() }
    : { action: 'pending', reapableAt: new Date(at).toISOString() }
}
/**
 * The comment that takes a VM out of the reap: the hub VM's own comment ends
 * `persistent service, do not reap`. The guard matches this substring,
 * case-sensitively, so any row someone marks by hand is kept the same way.
 */
const NEVER_REAP = 'do not reap'
// ── The record: the run's page, read off the evidence repository ────────────

/**
 * One `gh api <path>` on the laptop, through the exec seam. An absent file is
 * exit 1 with `HTTP 404`, which is an answer and not a failure — every reader
 * here gets `null` for it and decides for itself what an absence means.
 */
export const ghApi = async (exec, apiPath) => {
  const res = await exec('gh', ['api', apiPath])
  return res.code === 0 ? parseJson(res.stdout) : null
}

/**
 * A list read that follows every page: `--paginate --slurp` answers an array
 * of pages, flattened here into one array. A one-page answer (or a stub's bare
 * array) flattens to itself; anything that is not an array is null, as above.
 */
const ghList = async (exec, apiPath) => {
  const res = await exec('gh', ['api', '--paginate', '--slurp', apiPath])
  const payload = res.code === 0 ? parseJson(res.stdout) : null
  return Array.isArray(payload) ? payload.flat() : null
}

/**
 * One file of a run's evidence, as the contents API addresses it: in the
 * operator's evidence repository (#1395), under the TARGET's run folder.
 */
const contentsPath = (evidence, target, run, file) =>
  `repos/${evidence}/contents/${runFolderFor(target, run)}/${file}`

/**
 * The run's status page at one ref. The answer is the contents envelope —
 * base64 under `content` — and nothing else is accepted: a bare status
 * document would mean `gh` answered something other than the contents API, and
 * guessing there is how a janitor reaps on a payload it never read. A missing
 * envelope is `null`, which is what sends the reader on to the next ref; an
 * envelope whose content is not a JSON object is an answer all the same, and
 * carries a null `page` so no second ref is read behind a ref that spoke.
 */
export async function readContentsAt (exec, evidence, target, run, ref) {
  const payload = await ghApi(exec, `${contentsPath(evidence, target, run, 'status.json')}?ref=${ref}`)
  if (!payload || typeof payload.content !== 'string') return null
  const decoded = parseJson(Buffer.from(payload.content, 'base64').toString('utf8'))
  const page = decoded && typeof decoded === 'object' ? decoded : null
  // The envelope's `sha` is the blob as it sits on that ref, and a write of
  // this file needs it: the page alone cannot be put back.
  return { page, sha: typeof payload.sha === 'string' ? payload.sha : null, from: ref }
}

/**
 * The run's status page as the row loop reads it: the run's tag first, its
 * live branch only behind a tag that answered no envelope. Null when neither
 * ref has a page, and null without a read when there is no evidence
 * repository to read.
 */
async function evidenceReading (exec, evidence, target, run) {
  if (evidence === null) return null
  const found = await readContentsAt(exec, evidence, target, run, runTagFor(target, run)) ??
    await readContentsAt(exec, evidence, target, run, liveBranchFor(target, run))
  if (found === null || found.page === null) return null
  const state = typeof found.page.state === 'string' ? found.page.state : null
  return {
    finished: REAPABLE_STATES.includes(state),
    live: LIVE_STATES.includes(state),
    state,
    updatedAt: typeof found.page.updatedAt === 'string' ? found.page.updatedAt : null,
    from: found.from,
    page: found.page,
    sha: found.sha
  }
}

/**
 * One `gh api -X PUT <contents path>` — the contents API's update, whose body
 * is `message`, `content` (base64), `branch` and, for a file that already
 * exists, the `sha` it was read at. `-f` is gh's string-field flag, one field
 * per pair, so the path stays the first argv element beginning `repos/`.
 */
const ghPut = (exec, apiPath, { branch, message, content, sha = null }) => {
  const argv = [
    'api', '-X', 'PUT', apiPath,
    '-f', `branch=${branch}`,
    '-f', `message=${message}`,
    '-f', `content=${Buffer.from(content, 'utf8').toString('base64')}`
  ]
  // A new file carries no `sha`; sending one for a file that is not there is a
  // 422, and omitting one for a file that is is the other 422.
  if (sha !== null) argv.push('-f', `sha=${sha}`)
  return exec('gh', argv)
}

/**
 * A row's assignment: the run, the target, and the plan its comment carries
 * (`null` when the comment names none, or names something other than a
 * 40-hex sha), or null when the comment is absent or says nothing this tool
 * can read. The comment's `run=` is the run; the name's is the fallback,
 * since the name is only where the run is running this time. The plan is how
 * the janitor tells a colliding launch's abandoned run issue from the run
 * that actually won the number (#1036, `runIssueOf`).
 */
function assignmentOf (row) {
  if (!isVmName(row.name)) return null
  const fields = parseComment(row.comment)
  const run = isRunNumber(fields.run) ? Number(fields.run) : runOfVmName(row.name)
  const target = isSafeTarget(fields.target) ? fields.target : null
  if (run === null || target === null) return null
  const plan = isFullSha(fields.plan) ? fields.plan : null
  return { run, target, plan }
}

/**
 * Is this row's comment the operator's "leave it alone"? The raw string is
 * read, not the parsed fields: the sentence is prose a person wrote, and a row
 * that also carries `run=` and `target=` is kept all the same.
 */
const saysNeverReap = (row) => String(row?.comment ?? '').includes(NEVER_REAP)

// ── The one VM read: is the run's unit still there? ─────────────────────────

/** The systemd user unit one run is, on its own VM. */
const unitOf = (run) => `fleet-run@${run}.service`

/** The four properties that say whether a unit is alive, done or dead. */
const UNIT_PROPERTIES = Object.freeze(['ActiveState', 'SubState', 'Result', 'ExecMainStatus'])

/**
 * `$(id -u)` is expanded by the VM's shell, not the laptop's, so it travels as
 * text: the janitor never spawns a shell, and `exec` hands this whole string to
 * `ssh` as one argv element.
 */
const showUnitCommand = (run) =>
  `XDG_RUNTIME_DIR=/run/user/$(id -u) systemctl --user show ${unitOf(run)} ` +
  UNIT_PROPERTIES.map((p) => `-p ${p}`).join(' ')

/** The contract's own journal literal: a field match asks the journal directly. */
const journalCommand = (run) => `journalctl _SYSTEMD_USER_UNIT=${unitOf(run)} --no-pager -n 200`

/**
 * One command on one VM. `BatchMode` refuses to ask for a password and
 * `ConnectTimeout` bounds a dark VM at fifteen seconds — `fleet/launch.mjs`
 * runs the janitor before every launch, and a VM that is off must cost a launch
 * those seconds, not hang it. The destination is the row's own `ssh_dest`,
 * handed to `ssh` as its own argv element and never spliced into a string.
 */
const onVm = (exec, dest, command) =>
  exec('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', dest, command])

/**
 * The run's unit as `systemctl show` reports it, or null when it cannot be
 * read: a non-zero exit (a dark VM, a refused connection, a timeout), an empty
 * answer, or an answer with no `ActiveState` in it. Unreadable is not dead —
 * the row is then left exactly as it would have been without this read.
 */
async function readUnit (exec, dest, run) {
  const res = await onVm(exec, dest, showUnitCommand(run))
  if (res.code !== 0) return null
  const unit = {}
  for (const line of String(res.stdout ?? '').split('\n')) {
    const at = line.indexOf('=')
    if (at === -1) continue
    const key = line.slice(0, at).trim()
    if (UNIT_PROPERTIES.includes(key)) unit[key] = line.slice(at + 1).trim()
  }
  return typeof unit.ActiveState === 'string' && unit.ActiveState !== '' ? unit : null
}

/**
 * The unit is dead when systemd says so — `ActiveState=failed` — or when it was
 * killed by its own runtime budget, which leaves `Result=timeout` behind
 * whatever `ActiveState` the corpse settled into.
 */
const unitIsDead = (unit) => unit.ActiveState === 'failed' || unit.Result === 'timeout'

/** The unit's four properties as one line, in the order `systemctl` names them. */
const unitSummary = (unit) => UNIT_PROPERTIES
  .filter((p) => unit[p] !== undefined)
  .map((p) => `${p}=${unit[p]}`)
  .join(' ')

/** What the written page says happened, in the page's own `error` cell. */
const deathError = (run, unit, state) =>
  `janitor: ${unitOf(run)} ${unitSummary(unit)} while the page said ${state}`

// ── A run's end, written for it ─────────────────────────────────────────────

/** The `error` a close-out writes: a run no VM carries, whose page said live. */
export const CLOSE_OUT_ERROR = 'reaped before the run recorded its end'

/**
 * Seal run `run` of `target` in `evidence`: the tag `<slug>/run-<N>` cut at
 * the live branch's head through GitHub's refs API, read back to verify it
 * names that sha, and only then the live branch deleted. An answer that the
 * reference already exists is the tag being there, and the read-back decides.
 * Any refusal keeps the branch and says so: `{ tagged, deleted, reason? }`.
 */
export async function sealRun ({ exec = defaultExec, evidence, target, run }) {
  const branch = liveBranchFor(target, run)
  const tag = runTagFor(target, run)
  const saidBy = (res) => output(res).split('\n')[0]
  const head = await exec('gh', ['api', `repos/${evidence}/git/ref/heads/${branch}`])
  const sha = head.code === 0 ? parseJson(head.stdout)?.object?.sha : null
  if (typeof sha !== 'string') {
    return { tagged: false, deleted: false, reason: `no head for ${branch}: ${saidBy(head)}` }
  }
  const made = await exec('gh', [
    'api', '-X', 'POST', `repos/${evidence}/git/refs`,
    '-f', `ref=refs/tags/${tag}`,
    '-f', `sha=${sha}`
  ])
  if (made.code !== 0 && !/already exists/i.test(saidBy(made))) {
    return { tagged: false, deleted: false, reason: `tag ${tag} refused: ${saidBy(made)}` }
  }
  const check = await exec('gh', ['api', `repos/${evidence}/git/ref/tags/${tag}`])
  const tagged = check.code === 0 && parseJson(check.stdout)?.object?.sha === sha
  if (!tagged) {
    return { tagged: false, deleted: false, reason: `tag ${tag} does not name ${sha}; ${branch} kept` }
  }
  const gone = await exec('gh', ['api', '-X', 'DELETE', `repos/${evidence}/git/refs/heads/${branch}`])
  if (gone.code !== 0) {
    return { tagged: true, deleted: false, reason: `delete of ${branch} refused: ${saidBy(gone)}` }
  }
  return { tagged: true, deleted: true }
}

/**
 * Write a run's end for it — the one write the death and the close-out share.
 * `found` is the page as read off the live branch (`readContentsAt`): it is put
 * back with `state` `failed`, `updatedAt` `at` and `error`, every other cell
 * kept, then the run is sealed. A `journal`, when given, lands first as
 * `janitor-journal.txt`, so the page's transition is the branch's last commit
 * as the sandbox's own transitions are. Nothing retries a refused PUT: a
 * 409/422 means the sandbox pushed between the read and the write, and the
 * next pass reads the fresh record. Answers `{ written, sealed? , error? }`.
 */
async function failRun ({ exec, evidence, target, run, found, at, error, why, journal = null }) {
  const branch = liveBranchFor(target, run)
  if (journal !== null) {
    await ghPut(exec, contentsPath(evidence, target, run, 'janitor-journal.txt'), {
      branch,
      message: `janitor: run ${run} journal at death`,
      content: journal
    })
  }
  const written = { ...found.page, state: 'failed', updatedAt: at, error }
  const res = await ghPut(exec, contentsPath(evidence, target, run, 'status.json'), {
    branch,
    message: `janitor: run ${run} failed — ${why}`,
    content: `${JSON.stringify(written, null, 2)}\n`,
    sha: found.sha
  })
  if (res.code !== 0) return { written: false, error: output(res) }
  // The page now says failed: the run is sealed — tagged at the page just
  // written, its live branch deleted once the tag is verified there.
  return { written: true, sealed: await sealRun({ exec, evidence, target, run }) }
}

/**
 * The death, written: the unit's journal and the page (`failRun`), on the
 * run's live branch in the evidence repository.
 */
async function writeDeath ({ exec, dryRun, row, run, target, evidence, reading, unit, at }) {
  const death = { vm: row.name, run, target, state: reading.state, unit, applied: false }
  // `--dry-run` reads — the unit read above was one — and writes nothing.
  if (dryRun) return death
  const journal = await onVm(exec, row.sshDest, journalCommand(run))
  const out = await failRun({
    exec,
    evidence,
    target,
    run,
    found: reading,
    at,
    error: deathError(run, unit, reading.state),
    why: unitSummary(unit),
    journal: journal.code === 0
      ? String(journal.stdout ?? '')
      : `${journal.stdout ?? ''}${journal.stderr ?? ''}`
  })
  if (out.written) {
    death.applied = true
    death.sealed = out.sealed
  } else {
    death.error = out.error
  }
  return death
}

// ── #724: the integration branches nothing merged — deleted ────────────────

/**
 * Every `ultra/integration-run-<N>` head on a target, in one read. The path's
 * tail is `integrationBranchFor('')`, so the prefix cannot drift from the
 * branch name the rest of the fleet builds. `git/matching-refs/heads/<prefix>`
 * is a prefix match and answers an array of
 * `{ ref: 'refs/heads/ultra/integration-run-<N>', object: { sha } }` — `[]`
 * when the target has none.
 */
const matchingRefsPath = (target) =>
  `repos/${target}/git/matching-refs/heads/${integrationBranchFor('')}`

/**
 * The same prefix match for a target's live branches (#1314), in the evidence
 * repository (#1395): `live/<slug>/run-`.
 */
const evidenceRefsPath = (evidence, target) =>
  `repos/${evidence}/git/matching-refs/heads/${liveBranchFor(target, '')}`

/**
 * The runs those heads name, ascending. A 404 or an answer that is not an
 * array is no branches — an absence is an answer here, as everywhere else the
 * janitor reads — and a ref `runOfBranch` cannot read a run out of is skipped
 * rather than guessed at.
 */
async function integrationRunsOf (exec, target) {
  const payload = await ghList(exec, matchingRefsPath(target))
  if (!Array.isArray(payload)) return []
  const runs = []
  for (const entry of payload) {
    const run = runOfBranch(entry?.ref)
    if (run !== null && !runs.includes(run)) runs.push(run)
  }
  return runs.sort((a, b) => a - b)
}

/**
 * The pull request that speaks for one integration branch: the highest
 * `number` among the rows of `pulls?state=all&head=<owner>:<branch>`, or null
 * when there are none. `head=` matches on the head ref's NAME, which GitHub
 * keeps after the branch is gone, and run numbers restarted at 1 on
 * 2026-09-04 — so one head name carries two runs' pull requests and the rows'
 * order is not the rule. Read on 2026-09-07, `ultra/integration-run-32` on
 * `popmechanic/ultrapowers` answered `#720 closed, merged_at null` and
 * `#463 closed, merged_at 2026-08-31T03:03:48Z`; only #720 is about the branch
 * that is there now.
 */
export async function decidingPull (exec, target, run) {
  const owner = String(target).split('/')[0]
  const payload = await ghList(
    exec,
    `repos/${target}/pulls?state=all&per_page=100&head=${owner}:${integrationBranchFor(run)}`
  )
  const rows = Array.isArray(payload) ? payload : []
  let decider = null
  for (const row of rows) {
    const number = Number(row?.number)
    if (!Number.isFinite(number)) continue
    if (decider === null || number > decider.number) decider = { number, state: row.state, mergedAt: row.merged_at ?? null }
  }
  return decider
}

/**
 * The rule: the highest-numbered pull request decides;
 * `state` `"open"` keeps the branch; `state` `"closed"` with `merged_at` `null`
 * retires it; `merged_at` a string keeps it (delete-on-merge's own); no rows
 * keeps it. The list endpoint's rows carry `merged_at` and no `merged` boolean,
 * so the date is the only thing worth reading.
 */
const isClosedUnmerged = (pull) =>
  pull !== null && pull.state === 'closed' && pull.mergedAt === null

/**
 * The branches to delete, ascending by target then run. One `matching-refs`
 * read per distinct target — however many of its runs are in the fleet — and
 * one `pulls?` read per head that read answered. Nothing here mutates: the
 * DELETE is the pass's, after the reap, and `--dry-run` issues exactly these
 * same reads.
 */
async function closedUnmergedBranches (exec, targets) {
  const branches = []
  for (const target of [...targets].sort()) {
    for (const run of await integrationRunsOf(exec, target)) {
      const pull = await decidingPull(exec, target, run)
      if (!isClosedUnmerged(pull)) continue
      branches.push({ target, run, branch: integrationBranchFor(run), pr: pull.number, deleted: false })
    }
  }
  return branches
}

// ── #1314: the runs no VM carries, whose live branch is still there ────────

/** Is any VM of the fleet, listed now, carrying this run of this target? */
async function carriedNow (exec, target, run) {
  const vms = await listVms(exec)
  return vms.some((row) => {
    const fields = parseComment(row.comment)
    return fields.run === String(run) && fields.target === target
  })
}

/**
 * One `matching-refs` read per target for its live branches in the evidence
 * repository; for every run no row of this pass carries on that target, its
 * branch page, older than `ageMs`, on a run the fleet still carries no VM for
 * when listed again. Two ends are written here, and answered apart:
 *
 * - `closed`: a page that still says the run is in flight is written failed
 *   and sealed (`failRun`) — `closed` false under `--dry-run`.
 * - `sealed`: a page that says the run ended (`done|parked|failed`) is a run
 *   whose sandbox never cut its tag (flock-baseline run 31, 2026-11-13, n=1:
 *   `done`, no tag, the live branch left). Its page is the sandbox's own last
 *   word and is not rewritten; the run is sealed (`sealRun`: the tag cut at
 *   the branch's head, verified, the branch deleted) — `sealed` false under
 *   `--dry-run` and when the seal is refused, with the reason.
 *
 * No evidence repository, no reads and neither write.
 */
async function closeOutOrphans ({ exec, evidence, targets, carried, nowMs, ageMs, now, dryRun }) {
  const closed = []
  const sealed = []
  if (evidence === null) return { closed, sealed }
  for (const target of [...targets].sort()) {
    const payload = await ghList(exec, evidenceRefsPath(evidence, target))
    if (!Array.isArray(payload)) continue
    const orphans = []
    for (const entry of payload) {
      const run = runOfEvidenceRef(target, entry?.ref)
      if (run === null || orphans.includes(run) || carried.has(`${target}#${run}`)) continue
      orphans.push(run)
    }
    for (const run of orphans.sort((a, b) => a - b)) {
      const found = await readContentsAt(exec, evidence, target, run, liveBranchFor(target, run))
      const page = found?.page ?? null
      if (page === null) continue
      const state = typeof page.state === 'string' ? page.state : null
      const ended = REAPABLE_STATES.includes(state)
      if (!ended && !LIVE_STATES.includes(state)) continue
      const updated = Date.parse(String(page.updatedAt))
      if (!Number.isFinite(updated) || nowMs - updated < ageMs) continue
      // A VM that came up between the pass's listing and now is not an
      // orphan, and there is nothing to report.
      if (await carriedNow(exec, target, run)) continue
      if (ended) {
        if (dryRun) {
          sealed.push({ target, run, state, sealed: false })
          continue
        }
        const out = await sealRun({ exec, evidence, target, run })
        sealed.push({
          target, run, state, sealed: out.tagged && out.deleted, ...(out.reason === undefined ? {} : { reason: out.reason })
        })
        continue
      }
      if (dryRun) {
        closed.push({ target, run, state, closed: false })
        continue
      }
      const out = await failRun({
        exec, evidence, target, run, found, at: now().toISOString(), error: CLOSE_OUT_ERROR, why: CLOSE_OUT_ERROR
      })
      closed.push({ target, run, state, closed: out.written })
    }
  }
  return { closed, sealed }
}

/**
 * Everything the janitor does, with the exec seam and the clock injected.
 * `evidence` is the evidence repository (#1395); handed none, the `evidence`
 * key of `configPath` (default `~/.ultrapowers/fleet.json`) is. With neither,
 * no run can be read and none is reaped — every row is `unread`.
 */
export async function janitor ({
  argv = [], exec = defaultExec, now = () => new Date(), evidence = null, configPath
}) {
  const { opts } = parseArgs(argv, { flags: ['dry-run', 'json', 'help'] })
  const dryRun = opts['dry-run'] === true
  const age = opts.age === undefined || opts.age === true ? DEFAULT_AGE : String(opts.age)
  const ageMs = parseDuration(age)
  if (ageMs === null) throw new Refusal(`janitor: --age must look like 1h or 30m, got ${JSON.stringify(age)}`)
  // `--target` adds a target to the branch sweep that no VM of this pass names.
  if (opts.target !== undefined && !isSafeTarget(opts.target)) {
    throw new Refusal(`janitor: --target must be <owner>/<repo>, got ${JSON.stringify(opts.target)}`)
  }
  // The janitor sizes nothing, so of `fleet.json` it reads the one key
  // `evidence` — and only when it was handed no repository. The run's state
  // lives in the evidence repository and nowhere else.
  const evidenceRepo = isSafeTarget(evidence)
    ? evidence
    : await readEvidenceSetting({ path: configPath ?? DEFAULT_CONFIG_PATH() })

  const nowMs = now().getTime()
  const rows = await listVms(exec)

  // ── Read first, every row, whatever the verdict: --dry-run reads the same. ─
  const actions = []
  const pending = []
  const stale = []
  const unknown = []
  const deaths = []
  const kept = []
  // The rows whose record answered nothing: left alone, and said so.
  const unread = []
  // Every row that parsed to an assignment, with what its record said — the
  // launcher's duplicate check reads this list instead of listing the fleet a
  // second time (#1036). A row whose record answered nothing is here too, with
  // `live` and `state` null: the seconds after a launch, before any record
  // exists, are exactly when a double launch happens.
  const runs = []
  // The only targets there are: a row's assignment comment is where the
  // janitor learns of one, so a target no row names is nobody's here.
  const targets = new Set()
  // Every `<target>#<run>` a row of this pass carries, kept rows included:
  // the close-out is only for a run no VM carries.
  const carried = new Set()
  const nowIso = new Date(nowMs).toISOString()
  for (const row of rows) {
    // Before anything is parsed and before a single read is issued: a comment
    // that says do not reap ends this row's pass. Nothing is read about it, so
    // it cannot be aged, cannot be probed, and cannot be removed.
    if (saysNeverReap(row)) {
      const held = assignmentOf(row)
      if (held !== null) carried.add(`${held.target}#${held.run}`)
      kept.push({ vm: row.name, comment: row.comment })
      continue
    }
    const assignment = assignmentOf(row)
    if (assignment === null) {
      unknown.push({ vm: row.name, comment: row.comment })
      continue
    }
    const { run, target, plan: planSha } = assignment
    targets.add(target)
    carried.add(`${target}#${run}`)

    const reading = await evidenceReading(exec, evidenceRepo, target, run)
    runs.push({
      vm: row.name,
      run,
      target,
      plan: planSha,
      live: reading?.live ?? null,
      state: reading?.state ?? null
    })
    // No record that could be read — absent, or a read that failed: nothing
    // to decide on and nothing to age it by, so the VM is never touched.
    if (reading === null) {
      unread.push({ vm: row.name, run, target })
      continue
    }

    // ── A record that says the run is in flight is cross-checked against the
    //    unit that would be running it. `run` came out of `isRunNumber` (or a
    //    VM name that passed `isVmName`), so nothing unchecked reaches the
    //    remote command string; the destination is the row's own field.
    if (reading.live && typeof row.sshDest === 'string' && isRunNumber(run)) {
      const unit = await readUnit(exec, row.sshDest, run)
      if (unit !== null && unitIsDead(unit)) {
        deaths.push(await writeDeath({
          exec, dryRun, row, run, target, evidence: evidenceRepo, reading, unit, at: nowIso
        }))
        // The record now says the run died as of now: the reap is the next
        // pass's, an hour on, and that hour is the operator's window to ssh in.
        continue
      }
    }

    const updated = Date.parse(String(reading.updatedAt))
    // An age nobody recorded is not six hours; it is unknown, and left alone.
    if (!Number.isFinite(updated)) continue

    const plan = reapPlan({ finished: reading.finished, updatedAt: reading.updatedAt, nowMs, ageMs })
    if (plan.action === 'rm') {
      actions.push({
        kind: 'rm',
        vm: row.name,
        run,
        state: reading.state,
        updatedAt: reading.updatedAt,
        command: `rm ${row.name} --json`,
        applied: !dryRun
      })
      continue
    }
    if (plan.action === 'pending') {
      pending.push({ vm: row.name, run, state: reading.state, reapableAt: plan.reapableAt })
    }
    if (nowMs - updated >= STALE_MS) {
      stale.push({
        vm: row.name,
        run,
        state: reading.state,
        lastUpdate: new Date(updated).toISOString(),
        from: reading.from
      })
    }
  }

  // ── #724: the last of the reads — the branches nothing merged. They come
  //    after the row loop, so every read order above is unchanged.
  const sweep = opts.target === undefined ? targets : new Set([...targets, opts.target])
  const branches = await closedUnmergedBranches(exec, sweep)
  // ── #1314: beside it, the orphans — the runs no VM carries whose live
  //    branch is still there, on the same targets as the sweep.
  const { closed: closedOut, sealed } = await closeOutOrphans({
    exec, evidence: evidenceRepo, targets: sweep, carried, nowMs, ageMs, now, dryRun
  })

  // ── Then the reap, through the lobby, and the branches nothing merged. ───
  if (!dryRun) {
    for (const action of actions) {
      try {
        await lobby(exec, action.command)
        action.applied = true
      } catch (error) {
        if (!(error instanceof LobbyError)) throw error
        action.applied = false
        action.error = String(error.message ?? error)
      }
    }
    for (const branch of branches) {
      const res = await exec('gh', ['api', '-X', 'DELETE', `repos/${branch.target}/git/refs/heads/${branch.branch}`])
      branch.deleted = res.code === 0
      if (!branch.deleted) branch.error = output(res)
    }
  }

  return {
    dryRun,
    age,
    actions,
    stale,
    unknown,
    unread,
    deaths,
    branches,
    closedOut,
    sealed,
    kept,
    pending,
    runs,
    evidence: evidenceRepo
  }
}

/**
 * The rows of the janitor's `runs` list that carry this launch's plan on this
 * launch's target and whose record does not say the run ended (#1036). The
 * plan's identity is its text's blob sha: the launcher hashes `planText` with
 * `git hash-object --stdin` (no `-w` — nothing is written before the refusal
 * is decided), and reads each candidate row's `runs/<slug>/<N>/plan.md` blob
 * off the run's own live branch, `live/<slug>/run-<N>`, fetched from the
 * evidence repository into `FETCH_HEAD` (no ref of the checkout is written). A
 * fetch or a `rev-parse` that fails means the branch is gone — the run is
 * publishing or has published, and no engine reads its task issues any more —
 * so that row is not a duplicate.
 */
async function liveDuplicatesOf ({ exec, repoDir, target, evidence, planText, runs }) {
  const candidates = runs.filter((r) => r.target === target && r.live !== false && isRunNumber(r.run))
  if (candidates.length === 0) return []
  const hashed = await exec('git', ['-C', repoDir, 'hash-object', '--stdin'], { input: planText })
  if (hashed.code !== 0) return []
  const wanted = String(hashed.stdout ?? '').trim()
  const found = []
  for (const row of candidates) {
    const branch = liveBranchFor(target, row.run)
    const fetched = await git(exec, repoDir, ['fetch', evidenceUrlFor(evidence), `refs/heads/${branch}`])
    if (fetched.code !== 0) continue
    const planFile = `${runFolderFor(target, row.run)}/${PLAN_FILE}`
    const blob = await git(exec, repoDir, ['rev-parse', '--verify', '--quiet', `FETCH_HEAD:${planFile}`])
    if (blob.code !== 0) continue
    if (String(blob.stdout ?? '').trim() === wanted) found.push({ run: row.run, vm: row.vm })
  }
  return found
}

/**
 * A launch's reap and duplicate check (#1437): `fleet/launch.mjs` calls it
 * before the run number is read. Answers
 * `{ reaped, reapError, again }` — the VMs this pass removed, why the pass
 * failed (or null), and the live runs of this plan that `again` let through —
 * or throws the launcher's own refusal.
 *
 * Nothing schedules the janitor, so every launch is where it runs — before
 * the run number is read, so the fleet a launch joins is already clear of the
 * VMs of runs that finished over an hour ago. A reap that fails is reported and not fatal: the run
 * being launched is worth more than the ballast the janitor came for.
 */
export async function preflight ({
  exec = defaultExec, now = () => new Date(), evidence, repoDir, target, planText, again = false
}) {
  const reaped = []
  let reapError = null
  let fleetRuns = null
  try {
    const reap = await janitor({ argv: [], exec, now, evidence })
    fleetRuns = Array.isArray(reap.runs) ? reap.runs : []
    for (const action of reap.actions) {
      if (action.kind === 'rm' && action.applied === true) reaped.push(action.vm)
    }
  } catch (error) {
    reapError = String(error?.message ?? error) || 'launch: the reap failed'
  }

  // A reap that failed leaves no fleet list for the duplicate guard (#1036) to
  // read — refuse rather than launch with the guard silently skipped, unless
  // the operator passed `--again` to launch without it.
  if (fleetRuns === null && again !== true) {
    throw new Refusal(
      `launch: the reap did not answer, so the duplicate guard (#1036) cannot run — ${reapError}; ` +
      'pass --again to launch without it'
    )
  }

  // ── The duplicate check (#1036). A plan that is already live on this target
  //    is refused here, before the run number is read and before anything is
  //    pushed: a second launch of the same plan is two sandboxes building one
  //    change, and two pull requests for it. (Until 2026-11-13 it also killed
  //    the first run, whose task issues on the kata hub the replay re-answered.)
  //    "The same plan" is the plan text's git blob sha,
  //    never the comment's `plan=` commit, which carries the run number in its
  //    subject and so differs on every launch. A row whose record says the run
  //    ended never refuses, however recently; a row with no record yet counts
  //    as live. When the reap itself failed there is no list and no refusal.
  const duplicates = fleetRuns === null
    ? []
    : await liveDuplicatesOf({ exec, repoDir, target, evidence, planText, runs: fleetRuns })
  if (duplicates.length > 0 && again !== true) {
    throw new Refusal(duplicates.map((d) =>
      `launch: run-${d.run} is live on ${target} with this plan (VM ${d.vm}) — nothing was pushed; ` +
      'pass --again to launch it again on purpose (two runs of one plan build the same change twice)'
    ).join('\n'))
  }
  return { reaped, reapError, again: duplicates }
}

const renderAction = (a, dryRun) =>
  `${dryRun ? 'would ' : ''}rm ${a.vm}  run=${a.run} ${a.state} since ${a.updatedAt}` +
  (a.error === undefined ? '' : ` (failed: ${a.error})`)

const renderDeath = (d, dryRun) =>
  `${dryRun ? 'would write death' : 'death'} ${d.vm}  run=${d.run} ` +
  `${d.state} → failed: ${unitSummary(d.unit)} — ${liveBranchFor(d.target, d.run)}`

/** #724: a branch nothing merged, deleted (or, dry, to be). */
const renderBranch = (b, dryRun) =>
  `${dryRun ? 'would delete' : b.deleted ? 'deleted' : 'kept'} branch ${b.branch}  ` +
  `target=${b.target} PR #${b.pr} closed, not merged` +
  (b.error === undefined ? '' : ` (delete failed: ${b.error})`)

/** #1314: a run no VM carried, whose page said live, written (or not) as failed. */
const renderClosedOut = (c, dryRun) =>
  `${dryRun ? 'would close out' : 'closed out'} run=${c.run} target=${c.target} ${c.state} → failed`

/** A run that ended with its live branch left and no seal: sealed, to be, or refused. */
const renderSealed = (s, dryRun) => {
  const what = `run=${s.run} target=${s.target} ${s.state}`
  if (dryRun) return `would seal ${what} — its live branch is still there`
  if (s.sealed) return `sealed ${what} — tag ${runTagFor(s.target, s.run)} cut, live branch deleted`
  return `not sealed ${what} — ${s.reason ?? 'unknown'}`
}

/** A row whose record could not be read: where it was looked for, and that the VM stays. */
const renderUnread = (u, evidence) =>
  `unread ${u.vm}  run=${u.run} ` +
  (evidence === null
    ? 'no evidence repository is set ("evidence" in ~/.ultrapowers/fleet.json)'
    : `no status page in ${evidence} at ${runTagFor(u.target, u.run)} or ${liveBranchFor(u.target, u.run)}`) +
  ' — left alone'

/** A row the reap never touches, and why — the comment itself said so. */
const renderKept = (k) => `kept ${k.vm}  comment says do not reap — never removed`

const renderJanitor = (result) => {
  const lines = [
    ...(result.deaths ?? []).map((d) => renderDeath(d, result.dryRun)),
    ...(result.actions ?? []).map((a) => renderAction(a, result.dryRun)),
    // After every rm and before every stale line: what was removed, then what
    // never will be, then what wants a look.
    ...(result.kept ?? []).map(renderKept),
    ...(result.stale ?? []).map((s) => `stale ${s.vm}  run=${s.run} state=${s.state ?? 'none'} last update ${s.lastUpdate} (${s.from}) — look before you rm`),
    ...(result.pending ?? []).map((p) => `pending ${p.vm}  run=${p.run} state=${p.state ?? 'none'} reapable at ${p.reapableAt}`),
    ...(result.unknown ?? []).map((u) => `unknown ${u.vm}  no readable assignment — look before you rm`),
    ...(result.unread ?? []).map((u) => renderUnread(u, result.evidence ?? null)),
    // Last, after every rm, stale and unknown line: the target's branches,
    // then the evidence repository's close-outs.
    ...(result.branches ?? []).map((b) => renderBranch(b, result.dryRun)),
    ...(result.closedOut ?? []).map((c) => renderClosedOut(c, result.dryRun)),
    ...(result.sealed ?? []).map((s) => renderSealed(s, result.dryRun))
  ]
  return lines.length === 0 ? 'nothing to do' : lines.join('\n')
}

async function main (argv) {
  const { opts } = parseArgs(argv, { flags: ['dry-run', 'json', 'help'] })
  // `--help` prints the usage and reaps nothing: an unknown flag used to be
  // ignored, and a `--help` that ran a live pass is how three VMs went.
  if (opts.help === true) {
    process.stdout.write(`${USAGE}\n`)
    return
  }
  const result = await janitor({ argv })
  process.stdout.write(opts.json ? `${JSON.stringify(result)}\n` : `${renderJanitor(result)}\n`)
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  await runCli(main, process.argv.slice(2))
}
