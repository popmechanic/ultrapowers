#!/usr/bin/env node
/**
 * fleet/janitor.mjs — reap finished runs; report stale ones.
 *
 *   node fleet/janitor.mjs [--age 1h] [--dry-run] [--config <path>] [--json]
 *
 * It reads `fleet-runs`, never a VM: `git pull`, then for every
 * `runs/<N>/status.json` in `done|parked|failed` whose `updatedAt` is older
 * than `--age` (1 h), `ls 'fleet-r<N>-*' --json` and `rm <vm> --json` for each
 * row. The hour is for the operator to read a status page before it goes.
 *
 * Then the stale report: every `ls 'fleet-r*' --json` row whose N has had no
 * status update in six hours — a boot that never committed, an engine that
 * stopped writing — is printed, never removed: a stuck VM is evidence. Age is
 * `updatedAt`, or the plan commit's date when no status was ever committed;
 * `created_at` on the `ls` row is undocumented and never consulted.
 *
 * `--dry-run` issues every read and no `rm`. There is no grant sweep:
 * attachments carry `--for` and lapse by themselves.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  Refusal,
  defaultExec,
  ensureFleetRuns,
  git,
  listCommittedStatuses,
  listVms,
  loadFleetConfig,
  lobby,
  parseArgs,
  parseDuration,
  runCli,
  runOfVmName,
  vmPatternFor
} from './lobby.mjs'

export const USAGE = 'usage: node fleet/janitor.mjs [--age 1h] [--dry-run] [--config <path>] [--json]'

export const usage = () => USAGE

/** States that mean the run is over and its VM is ballast. */
export const REAPABLE_STATES = Object.freeze(['done', 'parked', 'failed'])
/** How long a finished run keeps its VM, so its status page can still be read. */
export const DEFAULT_AGE = '1h'
/** No status update for this long is a stale run, reported and left alone. */
export const STALE_MS = 6 * 60 * 60 * 1000

/** When `plans/run-<N>.md` was committed — the launch's own durable timestamp. */
async function planCommittedAt (exec, fleetRunsDir, run) {
  const res = await git(exec, fleetRunsDir, ['log', '-1', '--format=%cI', '--', `plans/run-${run}.md`])
  const at = Date.parse(String(res.stdout).trim())
  return res.code === 0 && Number.isFinite(at) ? at : null
}

/** Everything the janitor does, with the exec seam and the clock injected. */
export async function janitor ({ argv = [], exec = defaultExec, config, now = () => new Date() }) {
  const { opts } = parseArgs(argv, { flags: ['dry-run', 'json'] })
  const dryRun = opts['dry-run'] === true
  const age = opts.age === undefined || opts.age === true ? DEFAULT_AGE : String(opts.age)
  const ageMs = parseDuration(age)
  if (ageMs === null) throw new Refusal(`janitor: --age must look like 1h or 30m, got ${JSON.stringify(age)}`)
  const settings = config ?? await loadFleetConfig({ path: opts.config })

  const fleetRunsDir = await ensureFleetRuns(exec, settings.fleetRuns)
  const statuses = await listCommittedStatuses(fleetRunsDir)
  const nowMs = now().getTime()

  // ── Reap: finished, and finished long enough ago. ─────────────────────────
  const actions = []
  const reaped = new Set()
  for (const { run, status } of statuses) {
    if (!REAPABLE_STATES.includes(status.state)) continue
    const updated = Date.parse(status.updatedAt)
    if (!Number.isFinite(updated) || nowMs - updated < ageMs) continue
    for (const row of await listVms(exec, vmPatternFor(run))) {
      const command = `rm ${row.name} --json`
      actions.push({ kind: 'rm', vm: row.name, run, state: status.state, updatedAt: status.updatedAt, command, applied: !dryRun })
      reaped.add(row.name)
      if (!dryRun) await lobby(exec, command)
    }
  }

  // ── Report: alive, but silent for six hours. ──────────────────────────────
  const byRun = new Map(statuses.map(({ run, status }) => [run, status]))
  const stale = []
  for (const row of await listVms(exec)) {
    if (reaped.has(row.name)) continue
    const run = runOfVmName(row.name)
    if (run === null) continue
    const status = byRun.get(run) ?? null
    const last = status ? Date.parse(status.updatedAt) : await planCommittedAt(exec, fleetRunsDir, run)
    // An age nobody recorded is not six hours; it is unknown, and left alone.
    if (!Number.isFinite(last) || nowMs - last < STALE_MS) continue
    stale.push({
      vm: row.name,
      run,
      state: status?.state ?? null,
      lastUpdate: new Date(last).toISOString(),
      from: status ? 'status.json' : `plans/run-${run}.md`
    })
  }

  return { dryRun, age, actions, stale }
}

export const renderJanitor = (result) => {
  const lines = [
    ...result.actions.map((a) => `${result.dryRun ? 'would ' : ''}rm ${a.vm}  run=${a.run} ${a.state} since ${a.updatedAt}`),
    ...result.stale.map((s) => `stale ${s.vm}  run=${s.run} state=${s.state ?? 'none'} last update ${s.lastUpdate} (${s.from}) — look before you rm`)
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
