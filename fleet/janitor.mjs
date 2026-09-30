#!/usr/bin/env node
/**
 * fleet/janitor.mjs — reap finished runs; write the deaths; report stale ones.
 *
 *   node fleet/janitor.mjs [--age 1h] [--target <owner>/<repo>] [--dry-run] [--json] [--help]
 *
 * The contract is `fleet/CONTRACT.md` §Janitor: what a pass reads (the hub
 * first, the evidence repository when the hub is dark), what it removes (a
 * finished run's VM after `--age`, an integration branch nothing merged), what
 * it writes (a dead or orphaned run's end, then the seal) and what it only
 * reports (`kept`, `unknown`, `stale`). This header does not restate it (#1444);
 * the comments below say why the code is shaped the way it is.
 *
 * Nothing schedules it: `fleet/launch.mjs` runs it before every launch, and it
 * is run by hand after the laptop has been asleep. `--dry-run` issues every
 * read and no write.
 */

import { Buffer } from 'node:buffer'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { projectNamed, runIssueOf } from './kata-client.mjs'
import {
  DEFAULT_CONFIG_PATH,
  PLAN_FILE,
  Refusal,
  defaultExec,
  evidenceUrlFor,
  git,
  hubFromEnv,
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
  runTagFor,
  targetSlug
} from './lobby.mjs'

export const USAGE = 'usage: node fleet/janitor.mjs [--age 1h] [--target <owner>/<repo>] [--dry-run] [--json] [--help]'

export const usage = () => USAGE

/**
 * The states that mean the run is over and its VM is ballast — the same three
 * words wherever a run's finish is read: the status page's `state`, and the run
 * issue's own `work.state` (#964).
 */
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
 * The comment that takes a VM out of the reap. The hub's own comment is
 * `kata hub — persistent service, do not reap`, and `fleet/kata-hub.mjs` writes
 * it; the guard matches this substring, case-sensitively, so any row someone
 * marks by hand is kept the same way.
 */
const NEVER_REAP = 'do not reap'
/** The actor every hub write of the janitor's carries. */
const HUB_ACTOR = 'janitor'
/** The idempotency key of the one hub write: a re-driven death is the same patch. */
const deathKeyFor = (run) => `janitor:run-${run}:death`

/**
 * The three keys a run's issue carries about itself, spelled as kata stores
 * them: FLAT, dotted name and all (#960). `metadata.work.state` reads nothing —
 * there is no `work` object — so every read and every write here goes through
 * `metadata['work.state']`.
 */
const STATE_KEY = 'work.state'
const ATTENTION_KEY = 'work.attention'
const ATTENTION_MSG_KEY = 'work.attention_msg'
/** What a death writes into those keys: the state, and the hand it raises. */
const DEATH_STATE = 'failed'
const DEATH_ATTENTION = 'needs-human'

// ── The hub: the run's state, asked of kata ─────────────────────────────────

/**
 * The hub as the janitor holds it: `client` (null when there is none), `host`
 * (the ssh destination, for the report) and `dark` — null while the hub is
 * answering, else the first reason it could not, kept for the pass. An
 * injected `kata` is the client (`null` for "no hub" outright — a sim's, or the
 * launcher's); with none, `~/.ultrapowers/kata-hub.env`
 * is read and the client built on its host, exactly as the launcher builds
 * its own. An env file that is absent or names no host is not a refusal here:
 * a reaper with no hub reads the target, and says so.
 */
async function openHub ({ exec, kata, kataEnvPath }) {
  if (kata !== undefined) return { client: kata, host: kata?.host ?? null, dark: null }
  const hub = await hubFromEnv({ exec, actor: HUB_ACTOR, kataEnvPath })
  if (hub.client === null) return { client: null, host: null, dark: hub.dark }
  return { client: hub.client, host: hub.host, dark: null }
}

/** The first line of what went wrong, for a report line and nothing longer. */
const reasonOf = (error) => String(error?.message ?? error).split('\n')[0].trim()

/**
 * The finish an OPEN issue carries about itself, or null when it carries none:
 * `work.state`, read flat, and only when it names one of the three states that
 * mean the run is over. Anything else there — a run in flight's own word, a
 * value nobody here knows — is not a finish, and the row is read as open.
 */
const markedFinishOf = (issue) => {
  const value = issue?.metadata?.[STATE_KEY]
  return typeof value === 'string' && REAPABLE_STATES.includes(value) ? value : null
}

/**
 * What the hub says about one run, as the row loop reads it: `finished`,
 * `live`, `state`, `updatedAt`, `from`, and the project and issue a death
 * would mark. A run is finished when its issue is `closed` OR when an open
 * issue's `work.state` says so — the park is the case that needs the second
 * reading, since a parked run's issue stays open and its VM is ballast all the
 * same (#964). `closed_at` is the age of a closed issue and `updated_at` of
 * every other row — a closed issue's `updated_at` moves with later comments,
 * and the reap's clock is the close; a marked issue's is the mark, which is
 * the last thing that touched it.
 */
const readingOfIssue = (project, issue) => {
  const closed = issue.status === 'closed'
  const marked = closed ? null : markedFinishOf(issue)
  const updatedAt = closed
    ? (typeof issue.closed_at === 'string' ? issue.closed_at : issue.updated_at)
    : issue.updated_at
  return {
    source: 'hub',
    finished: closed || marked !== null,
    // A marked run is not in flight, so no unit is probed for it: the record
    // already says how it ended, and the probe is only ever a cross-check of a
    // record that claims the run is still going.
    live: issue.status === 'open' && marked === null,
    state: closed ? String(issue.closed_reason ?? 'closed') : (marked ?? String(issue.status ?? 'open')),
    updatedAt: typeof updatedAt === 'string' ? updatedAt : null,
    from: `kata:${project.name}`,
    project,
    issue
  }
}

/**
 * The hub reader for one pass. The projects listing is fetched once, on the
 * first row that needs it, and every error darkens the hub for the rest of
 * the pass — one dark read costs one ssh timeout, not one per row. A `null`
 * answer means "not from the hub": the caller reads the evidence for that row.
 */
function hubReader (hub) {
  let listing = null
  const darken = (error) => {
    if (hub.dark === null) hub.dark = reasonOf(error)
  }
  return async (target, run, plan) => {
    if (hub.client === null || hub.dark !== null) return null
    try {
      if (listing === null) listing = await hub.client.listProjects()
      const project = projectNamed(listing, targetSlug(target))
      if (project === null) return null
      const json = await hub.client.listIssues(project.id)
      const issues = Array.isArray(json?.issues) ? json.issues : []
      const issue = runIssueOf(issues, run, plan ?? null)
      return issue === null ? null : readingOfIssue({ id: project.id, uid: project.uid, name: project.name }, issue)
    } catch (error) {
      darken(error)
      return null
    }
  }
}

// ── The fallback: the run's page, read off the evidence repository ──────────

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
    source: 'evidence',
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

/**
 * What the written page says happened, in the page's own `error` cell — and
 * the hub close's message, which kata wants forty characters long. `said` is
 * `page` for a row read off the evidence and `hub` for one the hub answered.
 */
const deathError = (run, unit, state, said) =>
  `janitor: ${unitOf(run)} ${unitSummary(unit)} while the ${said} said ${state}`

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
 * The death, written: the unit's journal and the page (`failRun`), then, for
 * a row the hub answered, the run issue's three keys. A hub-read row's page is
 * fetched here, off the evidence BRANCH, since the death is written where the
 * sandbox writes; a branch with no page (a boot that never committed) gets no
 * PUT and the marking alone. A patch the hub refuses is reported on the entry,
 * never thrown.
 */
async function writeDeath ({ exec, dryRun, row, run, target, evidence, reading, unit, at, hub }) {
  const fromHub = reading.source === 'hub'
  const said = fromHub ? 'hub' : 'page'
  const death = { vm: row.name, run, target, state: reading.state, unit, applied: false }
  if (fromHub) death.hubMarked = false
  // `--dry-run` reads — the unit read above was one — and writes nothing.
  if (dryRun) return death

  // No evidence repository: no page to read, and the hub's marking alone.
  const found = evidence === null
    ? null
    : fromHub ? await readContentsAt(exec, evidence, target, run, liveBranchFor(target, run)) : reading
  if ((found?.page ?? null) !== null) {
    const journal = await onVm(exec, row.sshDest, journalCommand(run))
    const out = await failRun({
      exec,
      evidence,
      target,
      run,
      found,
      at,
      error: deathError(run, unit, reading.state, said),
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
  }

  if (fromHub) {
    // The run issue is MARKED, not closed: a close carries a verified outcome
    // and this one is nobody's yet, so the record reads `failed` and raises a
    // hand — the same three keys, spelled the same flat way, that the sandbox
    // writes at a park. No `If-Match`: the janitor reads the hub once a pass
    // and a death is the same three keys however often it is driven, so a
    // revision it held would only turn the second pass into a 412; the key
    // makes a re-driven death the same patch.
    try {
      await hub.client.patchMetadata(
        reading.project.id,
        reading.issue.uid,
        {
          [STATE_KEY]: DEATH_STATE,
          [ATTENTION_KEY]: DEATH_ATTENTION,
          [ATTENTION_MSG_KEY]: deathError(run, unit, reading.state, said)
        },
        undefined,
        { idempotencyKey: deathKeyFor(run) }
      )
      death.hubMarked = true
    } catch (error) {
      death.hubError = reasonOf(error)
    }
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

// ── #1314: the runs no VM carries, whose page still says live ──────────────

/**
 * One `matching-refs` read per target for its live branches in the evidence
 * repository; for every run no row of this pass carries on that target, its
 * branch page. A live page older than `ageMs`, on a run the fleet still
 * carries no VM for when listed again, is written failed and sealed
 * (`failRun`) — `closed` false under `--dry-run`. No evidence repository, no
 * reads and no close-outs.
 */
async function closeOutOrphans ({ exec, evidence, targets, carried, nowMs, ageMs, now, dryRun }) {
  const closed = []
  if (evidence === null) return closed
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
      if (!LIVE_STATES.includes(state)) continue
      const updated = Date.parse(String(page.updatedAt))
      if (!Number.isFinite(updated) || nowMs - updated < ageMs) continue
      // A VM that came up between the pass's listing and now is not an
      // orphan, and there is nothing to report.
      const vms = await listVms(exec)
      if (vms.some((row) => {
        const fields = parseComment(row.comment)
        return fields.run === String(run) && fields.target === target
      })) continue
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
  return closed
}

/**
 * Everything the janitor does, with the exec seam, the clock and the hub
 * injected. `kata` is the hub client (`null`: no hub, read the target);
 * undefined reads `kataEnvPath` (default `~/.ultrapowers/kata-hub.env`) and
 * builds one. `evidence` is the evidence repository (#1395); handed none, the
 * `evidence` key of `configPath` (default `~/.ultrapowers/fleet.json`) is.
 * With neither, nothing is read from any evidence repository and the reap
 * goes on by the hub alone.
 */
export async function janitor ({
  argv = [], exec = defaultExec, now = () => new Date(), kata, kataEnvPath, evidence = null, configPath
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
  // `evidence` — and only when it was handed no repository; `kata-hub.env` is
  // the only other file under `~/.ultrapowers/` it opens. The run's state
  // lives on the hub and in the evidence repository.
  const evidenceRepo = isSafeTarget(evidence)
    ? evidence
    : await readEvidenceSetting({ path: configPath ?? DEFAULT_CONFIG_PATH() })
  const hub = await openHub({ exec, kata, kataEnvPath })
  const fromHub = hubReader(hub)

  const nowMs = now().getTime()
  const rows = await listVms(exec)

  // ── Read first, every row, whatever the verdict: --dry-run reads the same. ─
  const actions = []
  const pending = []
  const stale = []
  const unknown = []
  const deaths = []
  const kept = []
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

    // The hub first; the evidence repository when the hub cannot answer this row.
    const reading = await fromHub(target, run, planSha) ?? await evidenceReading(exec, evidenceRepo, target, run)
    runs.push({
      vm: row.name,
      run,
      target,
      plan: planSha,
      live: reading?.live ?? null,
      state: reading?.state ?? null
    })
    // No record anywhere: nothing to decide on, and nothing to age it by.
    if (reading === null) continue

    // ── A record that says the run is in flight is cross-checked against the
    //    unit that would be running it. `run` came out of `isRunNumber` (or a
    //    VM name that passed `isVmName`), so nothing unchecked reaches the
    //    remote command string; the destination is the row's own field.
    if (reading.live && typeof row.sshDest === 'string' && isRunNumber(run)) {
      const unit = await readUnit(exec, row.sshDest, run)
      if (unit !== null && unitIsDead(unit)) {
        deaths.push(await writeDeath({
          exec, dryRun, row, run, target, evidence: evidenceRepo, reading, unit, at: nowIso, hub
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
  // ── #1314: beside it, the orphans — the runs no VM carries, still live. ───
  const closedOut = await closeOutOrphans({ exec, evidence: evidenceRepo, targets, carried, nowMs, ageMs, now, dryRun })

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

  // `hub` is null for a pass that was told there is no hub; otherwise the host
  // it asked and, when it could not, why — the first reason, kept whole.
  const hubReport = hub.client === null && hub.host === null && hub.dark === null
    ? null
    : { host: hub.host, dark: hub.dark }
  return {
    dryRun, age, actions, stale, unknown, deaths, branches, closedOut, kept, pending, hub: hubReport, runs, evidence: evidenceRepo
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
 * after the hub's ping and before the run number is read. Answers
 * `{ reaped, reapError, again }` — the VMs this pass removed, why the pass
 * failed (or null), and the live runs of this plan that `again` let through —
 * or throws the launcher's own refusal.
 *
 * Nothing schedules the janitor, so every launch is where it runs — before
 * the run number is read, so the fleet a launch joins is already clear of the
 * VMs of runs that finished over an hour ago. `hub` is the client the launch
 * built, so the janitor asks the hub the launch already reached — or, with no
 * hub, reads the target. A reap that fails is reported and not fatal: the run
 * being launched is worth more than the ballast the janitor came for.
 */
export async function preflight ({
  exec = defaultExec, now = () => new Date(), hub, evidence, repoDir, target, planText, again = false
}) {
  const reaped = []
  let reapError = null
  let fleetRuns = null
  try {
    const reap = await janitor({ argv: [], exec, now, kata: hub, evidence })
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
  //    pushed: a second launch of the same plan re-answers the live run's task
  //    issues on the hub and bumps their revision, and the first run dies at
  //    Setup on `kata-revision-mismatch`. "The same plan" is the plan text's
  //    git blob sha — the identity the hub's `Idempotency-Key` is built from —
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
      'pass --again to launch it again on purpose (a byte-identical replay re-answers the live ' +
      "run's task issues on the hub and bumps their revision)"
    ).join('\n'))
  }
  return { reaped, reapError, again: duplicates }
}

const renderAction = (a, dryRun) =>
  `${dryRun ? 'would ' : ''}rm ${a.vm}  run=${a.run} ${a.state} since ${a.updatedAt}` +
  (a.error === undefined ? '' : ` (failed: ${a.error})`)

/** A hub-read death also names the hub: marked, would be marked, or refused. */
const renderDeathHub = (d, dryRun) => {
  if (d.hubMarked === undefined) return ''
  if (d.hubMarked || dryRun) return ' and the hub'
  return ` (hub not marked: ${d.hubError ?? 'unknown'})`
}

const renderDeath = (d, dryRun) =>
  `${dryRun ? 'would write death' : 'death'} ${d.vm}  run=${d.run} ` +
  `${d.state} → failed: ${unitSummary(d.unit)} — ${liveBranchFor(d.target, d.run)}` +
  renderDeathHub(d, dryRun)

/** #724: a branch nothing merged, deleted (or, dry, to be). */
const renderBranch = (b, dryRun) =>
  `${dryRun ? 'would delete' : b.deleted ? 'deleted' : 'kept'} branch ${b.branch}  ` +
  `target=${b.target} PR #${b.pr} closed, not merged` +
  (b.error === undefined ? '' : ` (delete failed: ${b.error})`)

/** #1314: a run no VM carried, whose page said live, written (or not) as failed. */
const renderClosedOut = (c, dryRun) =>
  `${dryRun ? 'would close out' : 'closed out'} run=${c.run} target=${c.target} ${c.state} → failed`

/** A row the reap never touches, and why — the comment itself said so. */
const renderKept = (k) => `kept ${k.vm}  comment says do not reap — never removed`

/** A hub that could not be asked: first, because every line below was read another way. */
const renderHub = (h) =>
  `hub ${h.host ?? 'none'} unreachable (${h.dark}) — every run read from the evidence repository instead`

const renderJanitor = (result) => {
  const lines = [
    ...(result.hub?.dark ? [renderHub(result.hub)] : []),
    ...(result.deaths ?? []).map((d) => renderDeath(d, result.dryRun)),
    ...(result.actions ?? []).map((a) => renderAction(a, result.dryRun)),
    // After every rm and before every stale line: what was removed, then what
    // never will be, then what wants a look.
    ...(result.kept ?? []).map(renderKept),
    ...(result.stale ?? []).map((s) => `stale ${s.vm}  run=${s.run} state=${s.state ?? 'none'} last update ${s.lastUpdate} (${s.from}) — look before you rm`),
    ...(result.pending ?? []).map((p) => `pending ${p.vm}  run=${p.run} state=${p.state ?? 'none'} reapable at ${p.reapableAt}`),
    ...(result.unknown ?? []).map((u) => `unknown ${u.vm}  no readable assignment — look before you rm`),
    // Last, after every rm, stale and unknown line: the target's branches,
    // then the evidence repository's close-outs.
    ...(result.branches ?? []).map((b) => renderBranch(b, result.dryRun)),
    ...(result.closedOut ?? []).map((c) => renderClosedOut(c, result.dryRun))
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
