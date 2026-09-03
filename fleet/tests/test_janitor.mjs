/**
 * fleet/tests/test_janitor.mjs — the reaper.
 *
 * What is pinned:
 *
 *   1. `rm` fires ONLY on a committed status of `done` or `failed`. A run with
 *      no status, or a status that says `running`, is left alone — reaping a
 *      live sandbox destroys the run and its evidence;
 *   2. a run with no status at all and older than six hours is marked
 *      `state=expired` on its comment, once, and never removed;
 *   3. `--dry-run` issues every read and no mutation;
 *   4. `--sweep-grants` detaches a write grant left pointing at a dead VM.
 */

import assert from 'node:assert/strict'

import { janitor, renderJanitor, EXPIRED_MARK } from '../janitor.mjs'
import {
  answer, cleanup, makeExec, makeFleetRuns, sshRule, tempDir, writeStatus
} from './_lobby_helpers.mjs'

const NOW = new Date('2026-09-03T12:00:00.000Z')
const hoursAgo = (h) => new Date(NOW.getTime() - h * 3600 * 1000).toISOString()

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

const rules = (vms, integrations = []) => [
  sshRule('ls --json', answer(vms)),
  sshRule('integrations list --json', answer(integrations)),
  sshRule('rm ', answer('')),
  sshRule('comment ', answer('')),
  sshRule('integrations detach', answer(''))
]

// ── 1. rm only on done or failed ────────────────────────────────────────────
{
  const ws = workspace({
    1: { state: 'done' },
    2: { state: 'failed' },
    3: { state: 'running' },
    4: { state: 'awaiting-grant' }
  })
  const vms = [1, 2, 3, 4, 5].map((n) => ({
    name: `fleet-run-${n}`, comment: `run=${n}`, created_at: hoursAgo(1)
  }))
  vms.push({ name: 'fleet-golden', comment: '', created_at: hoursAgo(500) })
  const exec = makeExec({ rules: rules(vms) })
  const result = await janitor({ argv: [], exec, config: ws.config, now: () => NOW })
  assert.deepEqual(exec.lobby(), [
    'ls --json',
    'rm fleet-run-1 --json',
    'rm fleet-run-2 --json'
  ], '(1) done and failed are reaped; running, awaiting-grant, status-less and the golden are not')
  assert.deepEqual(result.actions.map((a) => a.kind), ['rm', 'rm'], '(1) two actions')
  assert.ok(result.actions.every((a) => a.applied), '(1) and they were applied')
  ws.cleanup()
}

// ── 2. Expiry: once, and never a removal ────────────────────────────────────
{
  const ws = workspace()
  const comment = `run=7 plan=${'a'.repeat(40)} target=o/r base=${'b'.repeat(40)} engine=${'c'.repeat(40)}`
  const exec = makeExec({
    rules: rules([
      { name: 'fleet-run-7', comment, created_at: hoursAgo(7) },
      { name: 'fleet-run-8', comment: 'run=8', created_at: hoursAgo(5) }
    ])
  })
  const result = await janitor({ argv: [], exec, config: ws.config, now: () => NOW })
  assert.deepEqual(exec.lobby(), [
    'ls --json',
    `comment fleet-run-7 '${comment} ${EXPIRED_MARK}'`
  ], '(2) seven hours with no status is expired; five hours is not, and neither is removed')
  assert.equal(result.actions[0].kind, 'expired', '(2) the action names itself')
  assert.equal(result.actions[0].ageFrom, 'ls --json', '(2) the age came from the VM row')

  // Second pass: the mark is already on the comment, so nothing is written.
  const exec2 = makeExec({
    rules: rules([{ name: 'fleet-run-7', comment: `${comment} ${EXPIRED_MARK}`, created_at: hoursAgo(9) }])
  })
  const again = await janitor({ argv: [], exec: exec2, config: ws.config, now: () => NOW })
  assert.deepEqual(exec2.lobby(), ['ls --json'], '(2) the expired comment is written exactly once')
  assert.equal(renderJanitor(again), 'nothing to do', '(2) and the second pass says so')
  ws.cleanup()
}

// ── 2b. No creation time on the row: the plan commit is the clock ───────────
{
  const ws = workspace()
  const exec = makeExec({ rules: rules([{ name: 'fleet-run-3', comment: 'run=3' }]) })
  // `plans/run-3.md` does not exist in this checkout, so there is no honest age
  // and the janitor leaves the VM alone rather than guessing.
  const result = await janitor({ argv: [], exec, config: ws.config, now: () => NOW })
  assert.deepEqual(exec.lobby(), ['ls --json'], '(2b) an unknown age is never expired')
  assert.deepEqual(result.actions, [], '(2b) and no action is recorded')

  // With the plan committed long ago, the commit date answers the question.
  const past = '2026-01-01T00:00:00+00:00'
  ws.runs.git(['-c', `user.name=t`, '-c', 'user.email=t@e.invalid', 'commit', '--allow-empty', '-m', 'seed2'])
  const fs = await import('node:fs')
  fs.writeFileSync(`${ws.runs.dir}/plans/run-3.md`, '# three\n')
  ws.runs.git(['add', 'plans/run-3.md'])
  const env = { ...process.env, GIT_AUTHOR_DATE: past, GIT_COMMITTER_DATE: past }
  const { spawnSync } = await import('node:child_process')
  spawnSync('git', ['-C', ws.runs.dir, 'commit', '-m', 'plan run-3'], { env, encoding: 'utf8' })
  const exec2 = makeExec({ rules: rules([{ name: 'fleet-run-3', comment: 'run=3' }]) })
  const dated = await janitor({ argv: [], exec: exec2, config: ws.config, now: () => NOW })
  assert.equal(dated.actions[0]?.kind, 'expired', '(2b) a plan committed in January is long expired')
  assert.equal(dated.actions[0].ageFrom, 'plans/run-3.md', '(2b) and the age names its source')
  ws.cleanup()
}

// ── 3. --dry-run mutates nothing ────────────────────────────────────────────
{
  const ws = workspace({ 1: { state: 'done' } })
  const exec = makeExec({
    rules: rules([
      { name: 'fleet-run-1', comment: 'run=1', created_at: hoursAgo(1) },
      { name: 'fleet-run-2', comment: 'run=2', created_at: hoursAgo(9) }
    ])
  })
  const result = await janitor({ argv: ['--dry-run'], exec, config: ws.config, now: () => NOW })
  assert.deepEqual(exec.mutating(), [], '(3) --dry-run issues no mutating verb')
  assert.deepEqual(result.actions.map((a) => a.kind), ['rm', 'expired'], '(3) but reports both')
  assert.ok(result.actions.every((a) => a.applied === false), '(3) marked unapplied')
  assert.match(renderJanitor(result), /^would rm fleet-run-1/, '(3) and prints them as "would"')
  ws.cleanup()
}

// ── 4. --sweep-grants ───────────────────────────────────────────────────────
{
  const ws = workspace()
  const exec = makeExec({
    rules: rules(
      [{ name: 'fleet-run-9', comment: 'run=9', created_at: hoursAgo(1) }],
      [
        { name: 't-o-r-rw', attachments: ['vm:fleet-run-9', 'vm:fleet-run-4'] },
        { name: 't-o-r-ro', attachments: ['tag:fleet', 'vm:fleet-run-4'] },
        { name: 'claude-max', attachments: ['vm:fleet-run-4'] }
      ]
    )
  })
  const result = await janitor({ argv: ['--sweep-grants'], exec, config: ws.config, now: () => NOW })
  assert.deepEqual(exec.lobby(), [
    'ls --json',
    'integrations list --json',
    'integrations detach t-o-r-rw vm:fleet-run-4'
  ], '(4) only the write grant on the dead VM is detached — the live one and the -ro object are left')
  assert.equal(result.sweepGrants, true, '(4) the result says the sweep ran')
  ws.cleanup()

  const off = workspace()
  const exec2 = makeExec({ rules: rules([], [{ name: 't-o-r-rw', attachments: ['vm:gone'] }]) })
  await janitor({ argv: [], exec: exec2, config: off.config, now: () => NOW })
  assert.deepEqual(exec2.lobby(), ['ls --json'], '(4) without the flag, integrations are not even listed')
  off.cleanup()
}

console.log('ALL TESTS PASSED')
