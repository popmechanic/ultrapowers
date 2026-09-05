#!/usr/bin/env node
/**
 * fleet/janitor.mjs — reap finished runs; report stale ones.
 *
 *   node fleet/janitor.mjs [--age 1h] [--dry-run] [--config <path>] [--json]
 *
 * The janitor is the expiry. It reads the *target*, never a side repository and
 * never a VM: one `ls 'fleet-r*' --json` through the lobby gives the fleet, and
 * every row carries its own assignment comment, so `run=` and `target=` come
 * out of the row itself. The run's state comes from the target's evidence, read
 * on the laptop with the same `gh` everything else uses — at the evidence tag
 * first, because a finished run's boot tags its evidence head and deletes the
 * branch in the same push:
 *
 *   gh api repos/<target>/contents/.ultrapowers/runs/<N>/status.json?ref=ultra/evidence/run-<N>
 *   gh api repos/<target>/contents/.ultrapowers/runs/<N>/status.json?ref=ultra/evidence-run-<N>
 *
 * — the contents envelope, whose base64 `content` is the status page; the
 * contents API resolves `?ref=` to a tag or a branch alike, so the second path
 * is the same read one ref over. The branch is tried only while the tag is
 * missing: a run still in flight, a run that ended `failed`, and every run from
 * before the tags keep their branches until the one-time sweep. A row in
 * `done|parked|failed` whose `updatedAt` is older than `--age` (1 h) is removed
 * with `rm <vm> --json`, whichever ref the page came from. The hour is for the
 * operator to read a status page before it goes; the rows are already one per
 * VM, so every incarnation of a finished run is reaped by its own row.
 *
 * Three things are never removed and reported instead:
 *
 *   unknown — a row with no comment, or a comment carrying no `target=`: there
 *             is nothing to read, so there is nothing to decide on.
 *   stale   — a live run silent for six hours, and a run with no evidence at
 *             all whose plan commit is over six hours old. A boot that never
 *             committed, an engine that stopped writing: a stuck VM is
 *             evidence, so it is printed, never removed.
 *
 * Age is the evidence page's `updatedAt`, else the plan commit's committer
 * date — the commit `ultra/plan/run-<N>` points at, else, while that tag is
 * missing, `ultra/plan-run-<N>`'s head. `created_at` on the `ls` row is
 * undocumented and never consulted. Every `stale` row says which of the four
 * refs it was read from, because a run reaped or held on a ref nobody named is
 * a verdict nobody can check.
 *
 * The reap is the whole of it. The janitor merges nothing — an approved run
 * merges its own pull request from the sandbox — so its only `gh` commands are
 * `gh api` reads, and every action it records is an `rm`.
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
  evidenceTagFor,
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
  planTagFor,
  runCli,
  runOfVmName
} from './lobby.mjs'

export const USAGE = 'usage: node fleet/janitor.mjs [--age 1h] [--dry-run] [--config <path>] [--json]'

export const usage = () => USAGE

/** States that mean the run is over and its VM is ballast. */
export const REAPABLE_STATES = Object.freeze(['done', 'parked', 'failed'])
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
 * The run's status page at one ref. The answer is the contents envelope —
 * base64 under `content` — and nothing else is accepted: a bare status document
 * would mean `gh` answered something other than the contents API, and guessing
 * there is how a janitor reaps on a payload it never read.
 */
async function readStatusAt (exec, target, run, ref) {
  const payload = await ghApi(
    exec, `repos/${target}/contents/.ultrapowers/runs/${run}/status.json?ref=${ref}`)
  if (!payload || typeof payload.content !== 'string') return null
  const decoded = parseJson(Buffer.from(payload.content, 'base64').toString('utf8'))
  return decoded && typeof decoded === 'object' ? decoded : null
}

/**
 * The run's status page, and the ref it came off. The evidence tag is read
 * first — a finished run has its page there and no branch — and the branch is
 * read only while that tag answers no envelope, which is exactly while the
 * sweep is pending. A page on the tag ends the row's reads.
 */
async function readEvidence (exec, target, run) {
  for (const from of [evidenceTagFor(run), evidenceBranchFor(run)]) {
    const status = await readStatusAt(exec, target, run, from)
    if (status !== null) return { status, from }
  }
  return null
}

/**
 * When the run's plan was committed — the launch's own durable timestamp, and
 * the only age a run with no evidence has. The tag `ultra/plan/run-<N>` is the
 * durable pointer: its ref document carries the sha, and the commit carries the
 * date one level shallower than the branches endpoint does. Only while the tag
 * is missing is `ultra/plan-run-<N>` read instead.
 */
async function planCommittedAt (exec, target, run) {
  const tag = planTagFor(run)
  const ref = await ghApi(exec, `repos/${target}/git/ref/tags/${tag}`)
  const sha = typeof ref?.object?.sha === 'string' ? ref.object.sha : null
  if (sha !== null) {
    const commit = await ghApi(exec, `repos/${target}/commits/${sha}`)
    const at = Date.parse(String(commit?.commit?.committer?.date ?? ''))
    return Number.isFinite(at) ? { at, from: tag } : null
  }
  const branch = planBranchFor(run)
  const payload = await ghApi(exec, `repos/${target}/branches/${branch}`)
  const at = Date.parse(String(payload?.commit?.commit?.committer?.date ?? ''))
  return Number.isFinite(at) ? { at, from: branch } : null
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
  for (const row of rows) {
    const assignment = assignmentOf(row)
    if (assignment === null) {
      unknown.push({ vm: row.name, comment: row.comment })
      continue
    }
    const { run, target } = assignment
    const evidence = await readEvidence(exec, target, run)

    if (evidence === null) {
      // No evidence on either ref: the plan commit is the only age there is.
      const planned = await planCommittedAt(exec, target, run)
      if (planned !== null && nowMs - planned.at >= STALE_MS) {
        stale.push({
          vm: row.name,
          run,
          state: null,
          lastUpdate: new Date(planned.at).toISOString(),
          from: planned.from
        })
      }
      continue
    }

    const { status, from } = evidence
    const state = typeof status.state === 'string' ? status.state : null

    const updatedAt = typeof status.updatedAt === 'string' ? status.updatedAt : null
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
        from
      })
    }
  }

  // ── Then the one mutation there is: the reap, through the lobby. ──────────
  if (!dryRun) {
    for (const action of actions) await lobby(exec, action.command)
  }

  return { dryRun, age, actions, stale, unknown }
}

const renderAction = (a, dryRun) =>
  `${dryRun ? 'would ' : ''}rm ${a.vm}  run=${a.run} ${a.state} since ${a.updatedAt}`

export const renderJanitor = (result) => {
  const lines = [
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
