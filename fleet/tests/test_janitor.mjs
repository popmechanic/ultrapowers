/**
 * fleet/tests/test_janitor.mjs — the reaper.
 *
 * What is pinned:
 *
 *   1. `rm` fires ONLY on a committed `done|parked|failed` whose `updatedAt`
 *      is older than the age (1 h, `--age`); a younger finished run, a running
 *      one and a status-less VM are left alone. The VMs are found by pattern,
 *      every incarnation of the run goes;
 *   2. a run silent for six hours is reported and never removed; the age is
 *      the status's `updatedAt` or the plan commit, never `created_at`;
 *   3. `--dry-run` issues every read and no `rm`; no ssh into any VM, ever;
 *   4. `.shared_vms` rows are never reaped.
 */

import assert from 'node:assert/strict'

import { janitor, renderJanitor } from '../janitor.mjs'
import {
  answer, cleanup, makeExec, makeFleetRuns, sshRule, tempDir, thrown, vmRow, vmsPayload, writeStatus
} from './_lobby_helpers.mjs'

const NOW = new Date('2026-09-03T12:00:00.000Z')
const hoursAgo = (h) => new Date(NOW.getTime() - h * 3600 * 1000).toISOString()
const vm = (n, rand = 'a1b2') => `fleet-r${n}-2609030900-${rand}`

function workspace (statuses = {}) {
  const root = tempDir('fleet-janitor-')
  const runs = makeFleetRuns({ root })
  for (const [run, status] of Object.entries(statuses)) writeStatus(runs.dir, run, status)
  return {
    root,
    runs,
    config: { golden: 'fleet-golden', fleetRuns: runs.dir, vmTokenPath: `${root}/vm-token` },
    cleanup: () => cleanup(root)
  }
}

/** `ls '<pattern>'` answers the fleet rows whose names match the pattern —
 *  what the server does — so the exam holds one fleet and the tool asks. */
const rules = (fleet, shared = []) => [
  sshRule('ls ', (cmd, argv) => {
    const pattern = /^ls '([^']+)'/.exec(argv[1])[1]
    const re = new RegExp(`^${pattern.replace(/\*/g, '.*')}$`)
    return vmsPayload(fleet.filter((row) => re.test(row.vm_name)), shared.filter((row) => re.test(row.vm_name)))
  }),
  sshRule('rm ', answer(''))
]

const janitorIn = (ws, argv = [], exec) => janitor({ argv, exec, config: ws.config, now: () => NOW })

// ── 1. rm only on finished + old enough, by pattern, every incarnation ──────
{
  const ws = workspace({
    1: { state: 'done', updatedAt: hoursAgo(2) },
    2: { state: 'parked', updatedAt: hoursAgo(2) },
    3: { state: 'failed', updatedAt: hoursAgo(2) },
    4: { state: 'done', updatedAt: hoursAgo(0.5) },
    5: { state: 'running', updatedAt: hoursAgo(2) },
    6: { state: 'awaiting-grant', updatedAt: hoursAgo(2) }
  })
  const fleet = [
    vmRow(vm(1)), vmRow(vm(1, 'dead')), vmRow(vm(2)), vmRow(vm(3)), vmRow(vm(4)), vmRow(vm(5)),
    vmRow(vm(6)), vmRow(vm(7)), vmRow('fleet-golden')
  ]
  const exec = makeExec({ rules: rules(fleet) })
  const result = await janitorIn(ws, [], exec)
  assert.deepEqual(exec.lobby(), [
    "ls 'fleet-r1-*' --json",
    `rm ${vm(1)} --json`,
    `rm ${vm(1, 'dead')} --json`,
    "ls 'fleet-r2-*' --json",
    `rm ${vm(2)} --json`,
    "ls 'fleet-r3-*' --json",
    `rm ${vm(3)} --json`,
    "ls 'fleet-r*' --json"
  ], '(1) done, parked and failed older than an hour are reaped, every incarnation; run 4 is too young, 5 and 6 are alive, 7 has no status, the golden is not a run')
  assert.deepEqual(result.actions.map((a) => [a.run, a.vm]), [[1, vm(1)], [1, vm(1, 'dead')], [2, vm(2)], [3, vm(3)]], '(1) four rm actions')
  assert.ok(result.actions.every((a) => a.applied), '(1) applied')
  assert.deepEqual(exec.vm(), [], '(1) no ssh into any VM')
  ws.cleanup()

  // --age moves the bar: at 10 minutes, run 4 (30 minutes old) goes too.
  const ws2 = workspace({ 4: { state: 'done', updatedAt: hoursAgo(0.5) } })
  const exec2 = makeExec({ rules: rules([vmRow(vm(4))]) })
  await janitorIn(ws2, ['--age', '10m'], exec2)
  assert.ok(exec2.lobby().includes(`rm ${vm(4)} --json`), '(1) --age 10m reaps a 30-minute-old finished run')
  const exec3 = makeExec({ rules: rules([vmRow(vm(4))]) })
  await janitorIn(ws2, ['--age', '2h'], exec3)
  assert.ok(!exec3.lobby().some((line) => line.startsWith('rm ')), '(1) --age 2h does not')
  const bad = await thrown(() => janitorIn(ws2, ['--age', 'soon'], makeExec({ rules: rules([]) })))
  assert.equal(bad?.exitCode, 2, '(1) an unparseable --age refuses')
  ws2.cleanup()
}

// ── 2. Stale: reported, never removed; age from status or plan commit ───────
{
  const ws = workspace({
    5: { state: 'running', updatedAt: hoursAgo(10) },
    6: { state: 'awaiting-grant', updatedAt: hoursAgo(7) },
    9: { state: 'running', updatedAt: hoursAgo(1) }
  })
  ws.runs.commitPlan(7, '2026-01-01T00:00:00+00:00')
  const fleet = [
    vmRow(vm(5)),
    vmRow(vm(6)),
    vmRow(vm(7)),
    // No status, no plan: an age nobody recorded is not six hours.
    vmRow(vm(8)),
    // created_at says ancient; updatedAt says an hour ago. updatedAt wins —
    // created_at is undocumented and never read.
    vmRow(vm(9), { created_at: hoursAgo(100) }),
    vmRow('fleet-golden', { created_at: hoursAgo(500) })
  ]
  const exec = makeExec({ rules: rules(fleet) })
  const result = await janitorIn(ws, [], exec)
  assert.deepEqual(exec.lobby(), ["ls 'fleet-r*' --json"], '(2) one fleet-wide read, and no rm for a stale run')
  assert.deepEqual(exec.mutating(), [], '(2) nothing removed')
  assert.deepEqual(result.stale.map((s) => [s.run, s.vm, s.state, s.from]), [
    [5, vm(5), 'running', 'status.json'],
    [6, vm(6), 'awaiting-grant', 'status.json'],
    [7, vm(7), null, 'plans/run-7.md']
  ], '(2) 5 and 6 are silent for over six hours; 7 never committed a status and its plan is from January; 8 has no age; 9 is fresh; the golden is not a run')
  assert.equal(result.stale[2].lastUpdate, '2026-01-01T00:00:00.000Z', '(2) the plan commit is the age when no status was committed')
  const printed = renderJanitor(result)
  assert.match(printed, new RegExp(`^stale ${vm(5)}  run=5 state=running`, 'm'), '(2) printed, not acted on')
  assert.ok(!/rm /.test(printed), '(2) no rm line')
  ws.cleanup()
}

// ── 3. --dry-run mutates nothing ────────────────────────────────────────────
{
  const ws = workspace({ 1: { state: 'done', updatedAt: hoursAgo(3) } })
  const exec = makeExec({ rules: rules([vmRow(vm(1))]) })
  const result = await janitorIn(ws, ['--dry-run'], exec)
  assert.deepEqual(exec.mutating(), [], '(3) --dry-run issues no rm')
  assert.deepEqual(result.actions.map((a) => [a.kind, a.applied]), [['rm', false]], '(3) but reports it, unapplied')
  assert.match(renderJanitor(result), new RegExp(`^would rm ${vm(1)}`), '(3) and prints it as "would"')
  ws.cleanup()

  const idle = workspace()
  const exec2 = makeExec({ rules: rules([]) })
  assert.equal(renderJanitor(await janitorIn(idle, [], exec2)), 'nothing to do', '(3) an empty fleet says so')
  idle.cleanup()
}

// ── 4. A shared VM is never reaped ──────────────────────────────────────────
{
  const ws = workspace({ 1: { state: 'done', updatedAt: hoursAgo(3) } })
  const exec = makeExec({ rules: rules([], [vmRow(vm(1))]) })
  const result = await janitorIn(ws, [], exec)
  assert.deepEqual(exec.mutating(), [], '(4) a shared_vms row named like run 1 is not run 1')
  assert.deepEqual(result.actions, [], '(4) no action')
  assert.deepEqual(result.stale, [], '(4) and it is not reported either')
  ws.cleanup()
}

console.log('ALL TESTS PASSED')
