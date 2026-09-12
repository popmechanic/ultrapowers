#!/usr/bin/env node
/**
 * fleet/janitor.mjs — reap finished runs; write the deaths; report stale ones.
 *
 *   node fleet/janitor.mjs [--age 1h] [--dry-run] [--config <path>] [--json] [--help]
 *
 * The janitor is the expiry. One `ls 'fleet-r*' --json` through the lobby gives
 * the fleet, and every row carries its own assignment comment, so `run=` and
 * `target=` come out of the row itself. The run's STATE is asked of the hub —
 * kata is the live record since #913 — and read off the target's evidence only
 * when the hub cannot answer (#938 item 1).
 *
 * The hub. `~/.ultrapowers/kata-hub.env` names it (`KATA_URL`); it is reached
 * exactly as the launcher reaches it, `fleet/kata-client.mjs`'s `sshTransport`:
 * one `ssh <host> curl … localhost:8000/api/v1/…` per request, the bearer
 * sourced from `/etc/kata/kata.env` ON the hub by the hub's own shell, so the
 * laptop's argv carries the literal `$KATA_AUTH_TOKEN` and never a token. Two
 * reads answer a row: the projects listing, once per pass and only when a row
 * needs it — `GET /api/v1/projects?limit=1000`, matched on `name` against the
 * run's project `<owner>-<repo>-run-<N>` (`kataProjectFor`), because kata
 * addresses a project by integer `id` and a name in the path is a 400 — and
 * that project's issues, `GET /api/v1/projects/<id>/issues?limit=1000`, in
 * which the run issue is the one whose `metadata.run` is N. Its `status` is
 * the verdict: `closed` is a finished run, `closed_reason` (`done`|`wontfix`)
 * its state and `closed_at` its age; `open` is a run in flight, aged from
 * `updated_at`. The sandbox closes the run issue at publish (#937) and the
 * janitor closes it at a death (below), so a row the hub says is open and
 * whose unit is alive is a run still going.
 *
 * The fallback. A hub that cannot be read — the env file absent, ssh or curl
 * failing, any answer that is not an answer — darkens the pass: the first such
 * error is kept, no further hub request is made, and every row from there is
 * read from the target's evidence, the shape the janitor had before the hub:
 *
 *   gh api repos/<target>/contents/.ultrapowers/runs/<N>/status.json?ref=ultra/evidence/run-<N>
 *
 * — the contents envelope, whose base64 `content` is the status page — and, only
 * when the tag answered no envelope, the same path at `?ref=ultra/evidence-run-<N>`:
 * a finished run has been through the boot's `record_tags` and has only the tag,
 * a run in flight has only the branch. A run the hub is up for but has no
 * project or run issue for (launched before the hub, or filed under another
 * name) is read from the evidence the same way, row by row, without darkening
 * the pass. A run with no record anywhere is left alone: there is nothing to
 * decide on. The pass reports which it did — `hub` on the result, and one
 * `hub <host> unreachable` line when it fell back.
 *
 * A finished run whose age is older than `--age` (1 h) is removed with
 * `rm <vm> --json`. The hour is for the operator to read a status page before
 * it goes; the rows are already one per VM, so every incarnation of a finished
 * run is reaped by its own row.
 *
 * Three things are never removed and reported instead:
 *
 *   kept    — a row whose `comment` carries `do not reap`. It is decided on the
 *             raw comment string, before the assignment is parsed, so a comment
 *             that also reads as an assignment is still kept; the row is then
 *             skipped whole, so not one hub or `gh api` read is issued about it.
 *   unknown — a row with no comment, or a comment carrying no `target=`: there
 *             is nothing to read, so there is nothing to decide on.
 *   stale   — a run silent for six hours: the hub's run issue, or the evidence
 *             page, last touched six hours ago. A boot that never committed, an
 *             engine that stopped writing: a stuck VM is evidence, so it is
 *             printed, never removed. The line names where its age was read —
 *             `kata:<project>`, or the evidence ref — because the two mean
 *             different things to the operator.
 *
 * A run the record says is in flight is a claim about a process, and #607
 * lifts the "no ssh into any VM" rule for the one read that checks it: for such
 * a row, and only such a row, the janitor asks the VM about the run's unit —
 *
 *   ssh <ssh_dest> "XDG_RUNTIME_DIR=/run/user/$(id -u) systemctl --user show
 *                   fleet-run@<N>.service -p ActiveState -p SubState -p Result
 *                   -p ExecMainStatus"
 *
 * — and when the unit has failed (or hit its `Result=timeout`) under a record
 * that still says the run is in flight, it writes the death: the unit's journal
 * to `.ultrapowers/runs/<N>/janitor-journal.txt`, then the page itself back
 * with `state` `failed`, both `gh api -X PUT` on the contents API against the
 * evidence BRANCH, when the branch has a page (a hub-read row's page is read
 * then, and only then); and, when the hub answered the row, one `wontfix`
 * close of the run issue under the idempotency key `janitor:run-<N>:death`,
 * so the hub's record says what the page says. The janitor still clones
 * nothing and runs no `git`. Because the close and the page are dated now, the
 * reap does not fire in the same pass: the hour before the `rm` is the
 * operator's window, and the record already holds the journal. A unit that is
 * alive, or that cannot be read at all — a dark VM, an ssh that times out, an
 * empty answer — is left exactly as it was.
 *
 * The reap is the only removal. The janitor merges nothing — an approved run
 * merges its own pull request from the sandbox — and it deletes no branch and
 * no tag, so every action it records is an `rm` and its writes are the
 * death's; the rest of its `gh` surface is reads: the contents API for a
 * fallback page, and #724's two —
 *
 *   gh api repos/<target>/git/matching-refs/heads/ultra/integration-run-
 *   gh api repos/<target>/pulls?state=all&head=<owner>:ultra/integration-run-<N>
 *
 * — one prefix match per distinct target the rows name, and one pull-request
 * listing per head it answers. A branch whose highest-numbered pull request is
 * closed and not merged is reported, last, beside the VMs this pass reaped:
 * nothing merged it and nothing will, so it is the sweep's to delete
 * (`node fleet/retire.mjs --target <t>`) and never the janitor's. The targets
 * come from the rows' own `target=`, because that is the only place the janitor
 * learns a target from — a branch whose every VM is already gone is the sweep's
 * to find.
 *
 * Nothing schedules it: `fleet/launch.mjs` runs it before every launch, handing
 * it the hub client the launch already built, and it is run by hand after the
 * laptop has been asleep.
 *
 * `--dry-run` issues every read and no write: no `rm`, no PUT, no close. There
 * is no attachment sweep: attachments carry `--for` and lapse by themselves.
 */

import { Buffer } from 'node:buffer'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { makeKataClient, sshTransport } from './kata-client.mjs'
import {
  KATA_HUB_FIX,
  Refusal,
  defaultExec,
  defaultKataEnvPath,
  evidenceBranchFor,
  evidenceTagFor,
  integrationBranchFor,
  isRunNumber,
  isSafeTarget,
  isVmName,
  kataHostOf,
  kataProjectFor,
  listVms,
  loadFleetConfig,
  lobby,
  parseArgs,
  parseComment,
  parseDuration,
  parseJson,
  parseKataEnv,
  runCli,
  runOfBranch,
  runOfVmName
} from './lobby.mjs'

export const USAGE = 'usage: node fleet/janitor.mjs [--age 1h] [--dry-run] [--config <path>] [--json] [--help]'

export const usage = () => USAGE

/** Page states that mean the run is over and its VM is ballast. */
export const REAPABLE_STATES = Object.freeze(['done', 'parked', 'failed'])
/** Page states that claim the run is still in flight — the ones worth a probe. */
export const LIVE_STATES = Object.freeze(['booting', 'running', 'publishing'])
/** How long a finished run keeps its VM, so its status page can still be read. */
export const DEFAULT_AGE = '1h'
/** No status update for this long is a stale run, reported and left alone. */
export const STALE_MS = 6 * 60 * 60 * 1000
/**
 * The comment that takes a VM out of the reap. The hub's own comment is
 * `kata hub — persistent service, do not reap`, and `fleet/kata-hub.mjs` writes
 * it; the guard matches this substring, case-sensitively, so any row someone
 * marks by hand is kept the same way.
 */
export const NEVER_REAP = 'do not reap'
/** The actor every hub write of the janitor's carries. */
export const HUB_ACTOR = 'janitor'
/** The idempotency key of the one hub write: a re-driven death is the same close. */
export const deathKeyFor = (run) => `janitor:run-${run}:death`

// ── The hub: the run's state, asked of kata ─────────────────────────────────

/**
 * The hub as the janitor holds it: `client` (null when there is none), `host`
 * (the ssh destination, for the report) and `dark` — null while the hub is
 * answering, else the first reason it could not, kept for the pass. An
 * injected `kata` is the client (`null` for "no hub" outright — a sim's, or the
 * launcher's when it was handed a config); with none, `~/.ultrapowers/kata-hub.env`
 * is read and the client built on its host, exactly as the launcher builds
 * its own. An env file that is absent or names no host is not a refusal here:
 * a reaper with no hub reads the target, and says so.
 */
async function openHub ({ exec, kata, kataEnvPath }) {
  if (kata !== undefined) return { client: kata, host: kata?.host ?? null, dark: null }
  const envPath = kataEnvPath ?? defaultKataEnvPath()
  let text
  try {
    text = await fsp.readFile(envPath, 'utf8')
  } catch (error) {
    return { client: null, host: null, dark: `no kata hub env at ${envPath} (${error?.code ?? error?.message ?? error}) — ${KATA_HUB_FIX}` }
  }
  const env = parseKataEnv(text)
  const host = kataHostOf(env.url)
  if (host === null) {
    return { client: null, host: null, dark: `${envPath} names KATA_URL ${JSON.stringify(env.url)}, not a url with a host — ${KATA_HUB_FIX}` }
  }
  return {
    client: makeKataClient({ transport: sshTransport({ sshHost: host, exec }), actor: HUB_ACTOR }),
    host,
    dark: null
  }
}

/** The first line of what went wrong, for a report line and nothing longer. */
const reasonOf = (error) => String(error?.message ?? error).split('\n')[0].trim()

/**
 * What the hub says about one run, as the row loop reads it: `finished`,
 * `live`, `state`, `updatedAt`, `from`, and the project and issue a death
 * would close. `closed_at` is the age of a finished run and `updated_at` of
 * one in flight — a closed issue's `updated_at` moves with later comments,
 * and the reap's clock is the close.
 */
const readingOfIssue = (project, issue) => {
  const closed = issue.status === 'closed'
  const updatedAt = closed
    ? (typeof issue.closed_at === 'string' ? issue.closed_at : issue.updated_at)
    : issue.updated_at
  return {
    source: 'hub',
    finished: closed,
    live: issue.status === 'open',
    state: closed ? String(issue.closed_reason ?? 'closed') : String(issue.status ?? 'open'),
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
  let byName = null
  const darken = (error) => {
    if (hub.dark === null) hub.dark = reasonOf(error)
  }
  return async (target, run) => {
    if (hub.client === null || hub.dark !== null) return null
    try {
      if (byName === null) {
        const json = await hub.client.listProjects()
        byName = new Map()
        for (const p of Array.isArray(json?.projects) ? json.projects : []) {
          if (typeof p?.name === 'string' && Number.isInteger(p?.id)) byName.set(p.name, p)
        }
      }
      const project = byName.get(kataProjectFor(target, run))
      if (project === undefined) return null
      const json = await hub.client.listIssues(project.id)
      const issues = Array.isArray(json?.issues) ? json.issues : []
      const issue = issues.find((i) => i && typeof i === 'object' && Number(i.metadata?.run) === run) ?? null
      return issue === null ? null : readingOfIssue({ id: project.id, uid: project.uid, name: project.name }, issue)
    } catch (error) {
      darken(error)
      return null
    }
  }
}

// ── The fallback: the run's page, read off the target ───────────────────────

/**
 * One `gh api <path>` on the laptop, through the exec seam. An absent file is
 * exit 1 with `HTTP 404`, which is an answer and not a failure — every reader
 * here gets `null` for it and decides for itself what an absence means.
 */
const ghApi = async (exec, apiPath) => {
  const res = await exec('gh', ['api', apiPath])
  return res.code === 0 ? parseJson(res.stdout) : null
}

/** One file of a run's evidence, as the contents API addresses it. */
const contentsPath = (target, run, file) =>
  `repos/${target}/contents/.ultrapowers/runs/${run}/${file}`

/**
 * The run's status page at one ref. The answer is the contents envelope —
 * base64 under `content` — and nothing else is accepted: a bare status
 * document would mean `gh` answered something other than the contents API, and
 * guessing there is how a janitor reaps on a payload it never read. A missing
 * envelope is `null`, which is what sends the reader on to the next ref; an
 * envelope whose content is not a JSON object is an answer all the same, and
 * carries a null `page` so no second ref is read behind a ref that spoke.
 */
async function readContentsAt (exec, target, run, ref) {
  const payload = await ghApi(exec, `${contentsPath(target, run, 'status.json')}?ref=${ref}`)
  if (!payload || typeof payload.content !== 'string') return null
  const decoded = parseJson(Buffer.from(payload.content, 'base64').toString('utf8'))
  const page = decoded && typeof decoded === 'object' ? decoded : null
  // The envelope's `sha` is the blob as it sits on that ref, and a write of
  // this file needs it: the page alone cannot be put back.
  return { page, sha: typeof payload.sha === 'string' ? payload.sha : null, from: ref }
}

/**
 * The run's status page as the row loop reads it: the evidence tag first, the
 * evidence branch only behind a tag that answered no envelope. Null when
 * neither ref has a page.
 */
async function evidenceReading (exec, target, run) {
  const found = await readContentsAt(exec, target, run, evidenceTagFor(run)) ??
    await readContentsAt(exec, target, run, evidenceBranchFor(run))
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
 * A row's assignment: the run and the target its comment carries, or null when
 * the comment is absent or says nothing this tool can read. The comment's
 * `run=` is the run; the name's is the fallback, since the name is only where
 * the run is running this time.
 */
function assignmentOf (row) {
  if (!isVmName(row.name)) return null
  const fields = parseComment(row.comment)
  const run = isRunNumber(fields.run) ? Number(fields.run) : runOfVmName(row.name)
  const target = isSafeTarget(fields.target) ? fields.target : null
  if (run === null || target === null) return null
  return { run, target }
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

/**
 * The death, written: the journal first — so the page's transition is the
 * branch's last commit, as the sandbox's own transitions are — then the page,
 * which is the page as read with three cells changed, then, for a row the hub
 * answered, the run issue's close. A hub-read row's page is fetched here, off
 * the evidence BRANCH, since the death is written where the sandbox writes;
 * a branch with no page (a boot that never committed) gets no PUT and the
 * close alone. Nothing retries a failed PUT: a 409/422 means the sandbox
 * pushed between the read and the write, and the next pass reads the fresh
 * record. A close the hub refuses is reported on the entry, never thrown.
 */
async function writeDeath ({ exec, dryRun, row, run, target, reading, unit, at, hub }) {
  const fromHub = reading.source === 'hub'
  const said = fromHub ? 'hub' : 'page'
  const death = { vm: row.name, run, state: reading.state, unit, applied: false }
  if (fromHub) death.hubClosed = false
  // `--dry-run` reads — the unit read above was one — and writes nothing.
  if (dryRun) return death

  const branch = evidenceBranchFor(run)
  const found = fromHub ? await readContentsAt(exec, target, run, branch) : reading
  const page = found?.page ?? null
  if (page !== null) {
    const journal = await onVm(exec, row.sshDest, journalCommand(run))
    const log = journal.code === 0
      ? String(journal.stdout ?? '')
      : `${journal.stdout ?? ''}${journal.stderr ?? ''}`
    await ghPut(exec, contentsPath(target, run, 'janitor-journal.txt'), {
      branch,
      message: `janitor: run ${run} journal at death`,
      content: log
    })

    const written = { ...page, state: 'failed', updatedAt: at, error: deathError(run, unit, reading.state, said) }
    const res = await ghPut(exec, contentsPath(target, run, 'status.json'), {
      branch,
      message: `janitor: run ${run} failed — ${unitSummary(unit)}`,
      content: `${JSON.stringify(written, null, 2)}\n`,
      sha: found.sha
    })
    if (res.code === 0) death.applied = true
    else death.error = `${res.stdout ?? ''}${res.stderr ?? ''}`.trim()
  }

  if (fromHub) {
    try {
      await hub.client.close(reading.project.id, reading.issue.uid, {
        reason: 'wontfix',
        message: deathError(run, unit, reading.state, said),
        idempotencyKey: deathKeyFor(run)
      })
      death.hubClosed = true
    } catch (error) {
      death.hubError = reasonOf(error)
    }
  }
  return death
}

// ── #724 Task 2: the branches beside them — reported, never deleted ─────────

/**
 * Every `ultra/integration-run-<N>` head on a target, in one read. The path's
 * tail is `integrationBranchFor('')`, so the prefix cannot drift from the
 * branch name the rest of the fleet builds. `git/matching-refs/heads/<prefix>`
 * is a prefix match and answers an array of
 * `{ ref: 'refs/heads/ultra/integration-run-<N>', object: { sha } }` — `[]`
 * when the target has none. It is paged at GitHub's default of thirty, and no
 * `per_page` rides the path: this is a report whose remedy is the sweep, not a
 * ledger.
 */
const matchingRefsPath = (target) =>
  `repos/${target}/git/matching-refs/heads/${integrationBranchFor('')}`

/**
 * The runs those heads name, ascending. A 404 or an answer that is not an
 * array is no branches — an absence is an answer here, as everywhere else the
 * janitor reads — and a ref `runOfBranch` cannot read a run out of is skipped
 * rather than guessed at.
 */
async function integrationRunsOf (exec, target) {
  const payload = await ghApi(exec, matchingRefsPath(target))
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
async function decidingPull (exec, target, run) {
  const owner = String(target).split('/')[0]
  const payload = await ghApi(
    exec,
    `repos/${target}/pulls?state=all&head=${owner}:${integrationBranchFor(run)}`
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
 * The rule, carried here by literal and never by an import of the sweep — both
 * tools spell it, neither owns it: the highest-numbered pull request decides;
 * `state` `"open"` keeps the branch; `state` `"closed"` with `merged_at` `null`
 * retires it; `merged_at` a string keeps it (delete-on-merge's own); no rows
 * keeps it. The list endpoint's rows carry `merged_at` and no `merged` boolean,
 * so the date is the only thing worth reading.
 */
const isClosedUnmerged = (pull) =>
  pull !== null && pull.state === 'closed' && pull.mergedAt === null

/**
 * The branches to report, ascending by target then run. One `matching-refs`
 * read per distinct target — however many of its runs are in the fleet — and
 * one `pulls?` read per head that read answered. Nothing here mutates: the
 * remedy is the sweep, and `--dry-run` issues exactly these same reads.
 */
async function closedUnmergedBranches (exec, targets) {
  const branches = []
  for (const target of [...targets].sort()) {
    for (const run of await integrationRunsOf(exec, target)) {
      const pull = await decidingPull(exec, target, run)
      if (!isClosedUnmerged(pull)) continue
      branches.push({ target, run, branch: integrationBranchFor(run), pr: pull.number })
    }
  }
  return branches
}

/**
 * Everything the janitor does, with the exec seam, the clock and the hub
 * injected. `kata` is the hub client (`null`: no hub, read the target);
 * undefined reads `kataEnvPath` (default `~/.ultrapowers/kata-hub.env`) and
 * builds one.
 */
export async function janitor ({
  argv = [], exec = defaultExec, config, now = () => new Date(), kata, kataEnvPath
}) {
  const { opts } = parseArgs(argv, { flags: ['dry-run', 'json', 'help'] })
  const dryRun = opts['dry-run'] === true
  const age = opts.age === undefined || opts.age === true ? DEFAULT_AGE : String(opts.age)
  const ageMs = parseDuration(age)
  if (ageMs === null) throw new Refusal(`janitor: --age must look like 1h or 30m, got ${JSON.stringify(age)}`)
  // The janitor sizes nothing, so it wants no setting; it still reads the
  // config the other CLIs read, because a `--config` it silently ignored would
  // be a lie. `fleet.json` and `kata-hub.env` are the only files under
  // `~/.ultrapowers/` it opens — the run's state lives on the hub and the target.
  if (config === undefined) await loadFleetConfig({ path: opts.config })
  const hub = await openHub({ exec, kata, kataEnvPath })
  const fromHub = hubReader(hub)

  const nowMs = now().getTime()
  const rows = await listVms(exec)

  // ── Read first, every row, whatever the verdict: --dry-run reads the same. ─
  const actions = []
  const stale = []
  const unknown = []
  const deaths = []
  const kept = []
  // The only targets there are: a row's assignment comment is where the
  // janitor learns of one, so a target no row names is nobody's here.
  const targets = new Set()
  const nowIso = new Date(nowMs).toISOString()
  for (const row of rows) {
    // Before anything is parsed and before a single read is issued: a comment
    // that says do not reap ends this row's pass. Nothing is read about it, so
    // it cannot be aged, cannot be probed, and cannot be removed.
    if (saysNeverReap(row)) {
      kept.push({ vm: row.name, comment: row.comment })
      continue
    }
    const assignment = assignmentOf(row)
    if (assignment === null) {
      unknown.push({ vm: row.name, comment: row.comment })
      continue
    }
    const { run, target } = assignment
    targets.add(target)

    // The hub first; the target's evidence when the hub cannot answer this row.
    const reading = await fromHub(target, run) ?? await evidenceReading(exec, target, run)
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
          exec, dryRun, row, run, target, reading, unit, at: nowIso, hub
        }))
        // The record now says the run died as of now: the reap is the next
        // pass's, an hour on, and that hour is the operator's window to ssh in.
        continue
      }
    }

    const updated = Date.parse(String(reading.updatedAt))
    // An age nobody recorded is not six hours; it is unknown, and left alone.
    if (!Number.isFinite(updated)) continue

    if (reading.finished && nowMs - updated >= ageMs) {
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

  // ── #724 Task 2: the last of the reads — the branches nothing merged. ─────
  //    They come after the row loop, so every read order above is unchanged.
  const branches = await closedUnmergedBranches(exec, targets)

  // ── Then the one mutation there is: the reap, through the lobby. ──────────
  if (!dryRun) {
    for (const action of actions) await lobby(exec, action.command)
  }

  // `hub` is null for a pass that was told there is no hub; otherwise the host
  // it asked and, when it could not, why — the first reason, kept whole.
  const hubReport = hub.client === null && hub.host === null && hub.dark === null
    ? null
    : { host: hub.host, dark: hub.dark }
  return { dryRun, age, actions, stale, unknown, deaths, branches, kept, hub: hubReport }
}

const renderAction = (a, dryRun) =>
  `${dryRun ? 'would ' : ''}rm ${a.vm}  run=${a.run} ${a.state} since ${a.updatedAt}`

/** A hub-read death also names the hub: closed, would be closed, or refused. */
const renderDeathHub = (d, dryRun) => {
  if (d.hubClosed === undefined) return ''
  if (d.hubClosed || dryRun) return ' and the hub'
  return ` (hub not closed: ${d.hubError ?? 'unknown'})`
}

const renderDeath = (d, dryRun) =>
  `${dryRun ? 'would write death' : 'death'} ${d.vm}  run=${d.run} ` +
  `${d.state} → failed: ${unitSummary(d.unit)} — ${evidenceBranchFor(d.run)}` +
  renderDeathHub(d, dryRun)

/**
 * #724 Task 2: a branch nothing merged, and where the operator goes for it.
 * The janitor deletes nothing here, so the line ends in the sweep's command.
 */
const renderBranch = (b) =>
  `branch ${b.branch}  target=${b.target} PR #${b.pr} closed, not merged — ` +
  `node fleet/retire.mjs --target ${b.target}`

/** A row the reap never touches, and why — the comment itself said so. */
const renderKept = (k) => `kept ${k.vm}  comment says do not reap — never removed`

/** A hub that could not be asked: first, because every line below was read another way. */
const renderHub = (h) =>
  `hub ${h.host ?? 'none'} unreachable (${h.dark}) — every run read from the target's evidence instead`

export const renderJanitor = (result) => {
  const lines = [
    ...(result.hub?.dark ? [renderHub(result.hub)] : []),
    ...(result.deaths ?? []).map((d) => renderDeath(d, result.dryRun)),
    ...(result.actions ?? []).map((a) => renderAction(a, result.dryRun)),
    // After every rm and before every stale line: what was removed, then what
    // never will be, then what wants a look.
    ...(result.kept ?? []).map(renderKept),
    ...(result.stale ?? []).map((s) => `stale ${s.vm}  run=${s.run} state=${s.state ?? 'none'} last update ${s.lastUpdate} (${s.from}) — look before you rm`),
    ...(result.unknown ?? []).map((u) => `unknown ${u.vm}  no readable assignment — look before you rm`),
    // Last, after every rm, stale and unknown line: the reap is the pass's
    // work, and the branch report is what the operator does next.
    ...(result.branches ?? []).map(renderBranch)
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
