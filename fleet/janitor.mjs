#!/usr/bin/env node
/**
 * fleet/janitor.mjs — reap finished runs; write the deaths; report stale ones.
 *
 *   node fleet/janitor.mjs [--age 1h] [--dry-run] [--config <path>] [--json]
 *
 * The janitor is the expiry. It reads the *target* and never a side repository:
 * one `ls 'fleet-r*' --json` through the lobby gives the fleet, and every row
 * carries its own assignment comment, so `run=` and `target=` come out of the
 * row itself. The run's state comes from the target's evidence branch, read on
 * the laptop with the same `gh` everything else uses:
 *
 *   gh api repos/<target>/contents/.ultrapowers/runs/<N>/status.json?ref=ultra/evidence-run-<N>
 *
 * — the contents envelope, whose base64 `content` is the status page. A row in
 * `done|parked|failed` whose `updatedAt` is older than `--age` (1 h) is removed
 * with `rm <vm> --json`. The hour is for the operator to read a status page
 * before it goes; the rows are already one per VM, so every incarnation of a
 * finished run is reaped by its own row.
 *
 * Three things are never removed and reported instead:
 *
 *   unknown — a row with no comment, or a comment carrying no `target=`: there
 *             is nothing to read, so there is nothing to decide on.
 *   stale   — a live run silent for six hours, and a run with no evidence at
 *             all whose `ultra/plan-run-<N>` commit is over six hours old. A
 *             boot that never committed, an engine that stopped writing: a
 *             stuck VM is evidence, so it is printed, never removed.
 *
 * Age is the evidence page's `updatedAt`, else the plan commit's committer
 * date; `created_at` on the `ls` row is undocumented and never consulted.
 *
 * A page in `booting|running|publishing` is a claim about a process, and #607
 * lifts the "no ssh into any VM" rule for the one read that checks it: for such
 * a row, and only such a row, the janitor asks the VM about the run's unit —
 *
 *   ssh <ssh_dest> "XDG_RUNTIME_DIR=/run/user/$(id -u) systemctl --user show
 *                   fleet-run@<N>.service -p ActiveState -p SubState -p Result
 *                   -p ExecMainStatus"
 *
 * — and when the unit has failed (or hit its `Result=timeout`) under a page
 * that still says the run is in flight, it writes the death: the unit's journal
 * to `.ultrapowers/runs/<N>/janitor-journal.txt`, then the page itself back
 * with `state` `failed`. Both writes are `gh api -X PUT` on the contents API;
 * the janitor still clones nothing and runs no `git`. Because the written page's
 * `updatedAt` is now, the reap does not fire in the same pass: the hour before
 * the `rm` is the operator's window, and the record already holds the journal.
 * A unit that is alive, or that cannot be read at all — a dark VM, an ssh that
 * times out, an empty answer — is left exactly as it was.
 *
 * The reap is the only removal. The janitor merges nothing — an approved run
 * merges its own pull request from the sandbox — so its `gh` surface is the
 * contents API and nothing else, and every action it records is an `rm`.
 *
 * Nothing schedules it: `fleet/launch.mjs` runs it before every launch, and it
 * is run by hand after the laptop has been asleep.
 *
 * `--dry-run` issues every read and no `rm`. There is no attachment sweep:
 * attachments carry `--for` and lapse by themselves.
 */

import { Buffer } from 'node:buffer'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  Refusal,
  defaultExec,
  evidenceBranchFor,
  isRunNumber,
  isSafeTarget,
  isVmName,
  listVms,
  loadFleetConfig,
  lobby,
  parseArgs,
  parseComment,
  parseDuration,
  parseJson,
  planBranchFor,
  runCli,
  runOfVmName
} from './lobby.mjs'

export const USAGE = 'usage: node fleet/janitor.mjs [--age 1h] [--dry-run] [--config <path>] [--json]'

export const usage = () => USAGE

/** States that mean the run is over and its VM is ballast. */
export const REAPABLE_STATES = Object.freeze(['done', 'parked', 'failed'])
/** States whose page claims the run is still in flight — the ones worth a probe. */
export const LIVE_STATES = Object.freeze(['booting', 'running', 'publishing'])
/** How long a finished run keeps its VM, so its status page can still be read. */
export const DEFAULT_AGE = '1h'
/** No status update for this long is a stale run, reported and left alone. */
export const STALE_MS = 6 * 60 * 60 * 1000

/**
 * One `gh api <path>` on the laptop, through the exec seam. An absent file is
 * exit 1 with `HTTP 404`, which is an answer and not a failure — every reader
 * here gets `null` for it and decides for itself what an absence means.
 */
const ghApi = async (exec, apiPath) => {
  const res = await exec('gh', ['api', apiPath])
  return res.code === 0 ? parseJson(res.stdout) : null
}

/**
 * The run's status page off its evidence branch. The answer is the contents
 * envelope — base64 under `content` — and nothing else is accepted: a bare
 * status document would mean `gh` answered something other than the contents
 * API, and guessing there is how a janitor reaps on a payload it never read.
 */
async function readEvidence (exec, target, run) {
  const apiPath = `${contentsPath(target, run, 'status.json')}?ref=${evidenceBranchFor(run)}`
  const payload = await ghApi(exec, apiPath)
  if (!payload || typeof payload.content !== 'string') return null
  const decoded = parseJson(Buffer.from(payload.content, 'base64').toString('utf8'))
  if (!decoded || typeof decoded !== 'object') return null
  // The envelope's `sha` is the blob as it sits on the branch, and a write of
  // this file needs it: the page alone cannot be put back.
  return { page: decoded, sha: typeof payload.sha === 'string' ? payload.sha : null }
}

/** One file of a run's evidence, as the contents API addresses it. */
const contentsPath = (target, run, file) =>
  `repos/${target}/contents/.ultrapowers/runs/${run}/${file}`

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
 * When `ultra/plan-run-<N>` was committed — the launch's own durable timestamp,
 * and the only age a run with no evidence has.
 */
async function planCommittedAt (exec, target, run) {
  const branch = planBranchFor(run)
  const payload = await ghApi(exec, `repos/${target}/branches/${branch}`)
  const at = Date.parse(String(payload?.commit?.commit?.committer?.date ?? ''))
  return Number.isFinite(at) ? at : null
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

/**
 * The death, written: the journal first — so the page's transition is the
 * branch's last commit, as the sandbox's own transitions are — then the page,
 * which is the page as read with three cells changed. Nothing retries a failed
 * PUT: a 409/422 means the sandbox pushed between the read and the write, and
 * the next pass reads the fresh page.
 */
async function writeDeath ({ exec, dryRun, row, run, target, state, page, sha, unit, at }) {
  const death = { vm: row.name, run, state, unit, applied: false }
  // `--dry-run` reads — the unit read above was one — and writes nothing.
  if (dryRun) return death

  const branch = evidenceBranchFor(run)
  const journal = await onVm(exec, row.sshDest, journalCommand(run))
  const log = journal.code === 0
    ? String(journal.stdout ?? '')
    : `${journal.stdout ?? ''}${journal.stderr ?? ''}`
  await ghPut(exec, contentsPath(target, run, 'janitor-journal.txt'), {
    branch,
    message: `janitor: run ${run} journal at death`,
    content: log
  })

  const written = { ...page, state: 'failed', updatedAt: at, error: deathError(run, unit, state) }
  const res = await ghPut(exec, contentsPath(target, run, 'status.json'), {
    branch,
    message: `janitor: run ${run} failed — ${unitSummary(unit)}`,
    content: `${JSON.stringify(written, null, 2)}\n`,
    sha
  })
  if (res.code === 0) return { ...death, applied: true }
  return { ...death, error: `${res.stdout ?? ''}${res.stderr ?? ''}`.trim() }
}

/** Everything the janitor does, with the exec seam and the clock injected. */
export async function janitor ({ argv = [], exec = defaultExec, config, now = () => new Date() }) {
  const { opts } = parseArgs(argv, { flags: ['dry-run', 'json'] })
  const dryRun = opts['dry-run'] === true
  const age = opts.age === undefined || opts.age === true ? DEFAULT_AGE : String(opts.age)
  const ageMs = parseDuration(age)
  if (ageMs === null) throw new Refusal(`janitor: --age must look like 1h or 30m, got ${JSON.stringify(age)}`)
  // The janitor sizes nothing, so it wants no setting; it still reads the
  // config the other CLIs read, because a `--config` it silently ignored would
  // be a lie. `~/.ultrapowers/fleet.json` is the only file under
  // `~/.ultrapowers/` it opens — the run's state lives on the target.
  if (config === undefined) await loadFleetConfig({ path: opts.config })

  const nowMs = now().getTime()
  const rows = await listVms(exec)

  // ── Read first, every row, whatever the verdict: --dry-run reads the same. ─
  const actions = []
  const stale = []
  const unknown = []
  const deaths = []
  const nowIso = new Date(nowMs).toISOString()
  for (const row of rows) {
    const assignment = assignmentOf(row)
    if (assignment === null) {
      unknown.push({ vm: row.name, comment: row.comment })
      continue
    }
    const { run, target } = assignment
    const evidence = await readEvidence(exec, target, run)

    if (evidence === null) {
      // No evidence was ever committed: the plan commit is the only age there is.
      const planned = await planCommittedAt(exec, target, run)
      if (planned !== null && nowMs - planned >= STALE_MS) {
        stale.push({
          vm: row.name,
          run,
          state: null,
          lastUpdate: new Date(planned).toISOString(),
          from: planBranchFor(run)
        })
      }
      continue
    }

    const { page, sha } = evidence
    const state = typeof page.state === 'string' ? page.state : null

    // ── A page that says the run is in flight is cross-checked against the
    //    unit that would be running it. `run` came out of `isRunNumber` (or a
    //    VM name that passed `isVmName`), so nothing unchecked reaches the
    //    remote command string; the destination is the row's own field.
    if (LIVE_STATES.includes(state) && typeof row.sshDest === 'string' && isRunNumber(run)) {
      const unit = await readUnit(exec, row.sshDest, run)
      if (unit !== null && unitIsDead(unit)) {
        deaths.push(await writeDeath({
          exec, dryRun, row, run, target, state, page, sha, unit, at: nowIso
        }))
        // The page now says `failed` as of now: the reap is the next pass's,
        // an hour on, and that hour is the operator's window to ssh in.
        continue
      }
    }

    const updatedAt = typeof page.updatedAt === 'string' ? page.updatedAt : null
    const updated = Date.parse(String(updatedAt))
    // An age nobody recorded is not six hours; it is unknown, and left alone.
    if (!Number.isFinite(updated)) continue

    if (REAPABLE_STATES.includes(state) && nowMs - updated >= ageMs) {
      actions.push({
        kind: 'rm',
        vm: row.name,
        run,
        state,
        updatedAt,
        command: `rm ${row.name} --json`,
        applied: !dryRun
      })
      continue
    }
    if (nowMs - updated >= STALE_MS) {
      stale.push({
        vm: row.name,
        run,
        state,
        lastUpdate: new Date(updated).toISOString(),
        from: evidenceBranchFor(run)
      })
    }
  }

  // ── Then the one mutation there is: the reap, through the lobby. ──────────
  if (!dryRun) {
    for (const action of actions) await lobby(exec, action.command)
  }

  return { dryRun, age, actions, stale, unknown, deaths }
}

const renderAction = (a, dryRun) =>
  `${dryRun ? 'would ' : ''}rm ${a.vm}  run=${a.run} ${a.state} since ${a.updatedAt}`

const renderDeath = (d, dryRun) =>
  `${dryRun ? 'would write death' : 'death'} ${d.vm}  run=${d.run} ` +
  `${d.state} → failed: ${unitSummary(d.unit)} — ${evidenceBranchFor(d.run)}`

export const renderJanitor = (result) => {
  const lines = [
    ...(result.deaths ?? []).map((d) => renderDeath(d, result.dryRun)),
    ...result.actions.map((a) => renderAction(a, result.dryRun)),
    ...result.stale.map((s) => `stale ${s.vm}  run=${s.run} state=${s.state ?? 'none'} last update ${s.lastUpdate} (${s.from}) — look before you rm`),
    ...(result.unknown ?? []).map((u) => `unknown ${u.vm}  no readable assignment — look before you rm`)
  ]
  return lines.length === 0 ? 'nothing to do' : lines.join('\n')
}

async function main (argv) {
  const { opts } = parseArgs(argv, { flags: ['dry-run', 'json'] })
  const result = await janitor({ argv })
  process.stdout.write(opts.json ? `${JSON.stringify(result)}\n` : `${renderJanitor(result)}\n`)
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  await runCli(main, process.argv.slice(2))
}
