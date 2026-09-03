/**
 * fleet/tests/test_grant.mjs — the approval.
 *
 * What must hold or the grant is not a gate at all:
 *
 *   1. the run's committed state must be exactly `awaiting-grant`. Any other
 *      state, and a missing status, refuses with no lobby verb issued;
 *   2. the VM is found by pattern, `ls 'fleet-r<N>-*' --json`, and there must
 *      be exactly one: none refuses naming the pattern, two refuse naming both;
 *   3. DETACH the read grant BEFORE attaching the write grant, always; a detach
 *      that finds nothing attached is fine, any other detach failure stops the
 *      attach and prints the lobby's words;
 *   4. `.shared_vms` rows are never the run's VM.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import { grant, renderGrant, DEFAULT_FOR, REQUIRED_STATE } from '../grant.mjs'
import { LobbyError } from '../lobby.mjs'
import {
  answer, cleanup, makeExec, makeFleetRuns, sshRule, tempDir, thrown, vmRow, vmsPayload, writeStatus
} from './_lobby_helpers.mjs'

const TARGET = 'popmechanic/smoke'
const VM = 'fleet-r5-2609032215-a1b2'
const PATTERN = "ls 'fleet-r5-*' --json"
const NOW = new Date('2026-09-03T12:00:00.000Z')
const COMMENT = `run=5 plan=${'a'.repeat(40)} target=${TARGET} base=${'b'.repeat(40)} engine=${'c'.repeat(40)}`

function workspace ({ state = REQUIRED_STATE, run = 5 } = {}) {
  const root = tempDir('fleet-grant-')
  const runs = makeFleetRuns({ root })
  if (state !== null) writeStatus(runs.dir, run, { run: String(run), state, pr: null })
  return {
    root,
    runs,
    config: { golden: 'fleet-golden', fleetRuns: runs.dir, vmTokenPath: path.join(root, 'vm-token') },
    cleanup: () => cleanup(root)
  }
}

const rules = ({
  vms = [vmRow(VM, { comment: COMMENT })],
  shared = [],
  detach = answer('')
} = {}) => [
  sshRule('ls ', vmsPayload(vms, shared)),
  sshRule('integrations detach', detach),
  sshRule('integrations attach', answer(''))
]

const grantIn = (ws, argv = ['5'], exec) => grant({ argv, exec, config: ws.config, now: () => NOW })

// ── 1. The state check ──────────────────────────────────────────────────────
{
  for (const state of ['booting', 'running', 'publishing', 'done', 'parked', 'failed']) {
    const ws = workspace({ state })
    const exec = makeExec({ rules: rules() })
    const error = await thrown(() => grantIn(ws, ['5'], exec))
    assert.equal(error?.exitCode, 2, `(1) state ${state} refuses`)
    assert.match(error.message, new RegExp(`not ${REQUIRED_STATE}`), '(1) and names the state it wanted')
    assert.deepEqual(exec.lobby(), [], `(1) state ${state} issues no lobby verb at all`)
    ws.cleanup()
  }
  const missing = workspace({ state: null })
  const exec = makeExec({ rules: rules() })
  const error = await thrown(() => grantIn(missing, ['5'], exec))
  assert.equal(error?.exitCode, 2, '(1) no committed status refuses')
  assert.match(error.message, /runs\/5\/status\.json/, '(1) and names the file it looked for')
  assert.deepEqual(exec.lobby(), [], '(1) and issues no lobby verb')
  missing.cleanup()

  const ws = workspace()
  const exec2 = makeExec({ rules: rules() })
  const bad = await thrown(() => grantIn(ws, ['nope'], exec2))
  assert.equal(bad?.exitCode, 2, '(1) a non-numeric run refuses')
  assert.equal(exec2.calls.length, 0, '(1) before any exec')
  const badFor = await thrown(() => grantIn(ws, ['5', '--for', 'fifteen'], exec2))
  assert.equal(badFor?.exitCode, 2, '(1) an unparseable --for refuses')
  assert.equal(exec2.calls.length, 0, '(1) before any exec')
  ws.cleanup()
}

// ── 2. The VM by pattern, then detach, then attach ──────────────────────────
{
  const ws = workspace()
  const exec = makeExec({ rules: rules() })
  const result = await grantIn(ws, ['5'], exec)
  assert.deepEqual(exec.lobby(), [
    PATTERN,
    `integrations detach t-popmechanic-smoke-ro vm:${VM}`,
    `integrations attach t-popmechanic-smoke-rw vm:${VM} --for 15m`
  ], '(2) the pattern lookup, detach, attach — in that order, nothing else')
  assert.ok(exec.calls.every((c) => c.cmd !== 'ssh' || c.argv[0] === 'exe.dev'), '(2) no ssh into the VM')
  assert.equal(result.vm, VM, '(2) the VM came from the ls row')
  assert.equal(result.for, DEFAULT_FOR, '(2) the default window is 15m')
  assert.equal(result.expiresAt, '2026-09-03T12:15:00.000Z', '(2) the expiry is now + the window')
  assert.equal(result.target, TARGET, '(2) the target came from the VM comment')
  assert.match(renderGrant(result), new RegExp(`t-popmechanic-smoke-rw attached to vm:${VM} for 15m`), '(2) the printed line')
  ws.cleanup()

  const ws2 = workspace()
  const exec2 = makeExec({ rules: rules() })
  const result2 = await grantIn(ws2, ['5', '--for', '30m'], exec2)
  assert.ok(exec2.lobby().includes(`integrations attach t-popmechanic-smoke-rw vm:${VM} --for 30m`), '(2) --for is honoured')
  assert.equal(result2.expiresAt, '2026-09-03T12:30:00.000Z', '(2) and moves the expiry')
  ws2.cleanup()
}

// ── 2b. Zero rows, two rows ─────────────────────────────────────────────────
{
  const none = workspace()
  const exec = makeExec({ rules: rules({ vms: [] }) })
  const error = await thrown(() => grantIn(none, ['5'], exec))
  assert.equal(error?.exitCode, 2, '(2b) no VM for the pattern refuses')
  assert.match(error.message, /ls 'fleet-r5-\*' --json/, '(2b) naming the pattern it sent')
  assert.deepEqual(exec.mutating(), [], '(2b) nothing was attached or detached')
  none.cleanup()

  const two = workspace()
  const other = 'fleet-r5-2609031100-beef'
  const exec2 = makeExec({ rules: rules({ vms: [vmRow(VM, { comment: COMMENT }), vmRow(other, { comment: COMMENT })] }) })
  const error2 = await thrown(() => grantIn(two, ['5'], exec2))
  assert.equal(error2?.exitCode, 2, '(2b) two incarnations refuse — the grant cannot pick')
  assert.ok(error2.message.includes(VM) && error2.message.includes(other), '(2b) naming both')
  assert.deepEqual(exec2.mutating(), [], '(2b) nothing was attached or detached')
  two.cleanup()
}

// ── 3. Detach answers ───────────────────────────────────────────────────────
{
  const ws = workspace()
  const exec = makeExec({
    rules: rules({ detach: answer('', { code: 1, stderr: `integration not attached to vm:${VM}\n` }) })
  })
  const result = await grantIn(ws, ['5'], exec)
  assert.ok(exec.lobby().includes(`integrations attach t-popmechanic-smoke-rw vm:${VM} --for 15m`),
    '(3) a detach that answers "not attached" is tolerated — the read grant lapsed on its own')
  assert.equal(result.vm, VM, '(3) and the grant completes')
  ws.cleanup()

  const ws2 = workspace()
  const exec2 = makeExec({
    rules: rules({ detach: answer('permission denied for integration t-popmechanic-smoke-ro\n', { code: 1 }) })
  })
  const error = await thrown(() => grantIn(ws2, ['5'], exec2))
  assert.ok(error instanceof LobbyError, '(3) any other detach failure is a failure')
  assert.match(error.message, /exe\.dev integrations failed \(exit 1\):\n/, '(3) the verb named')
  assert.match(error.message, /permission denied for integration/, '(3) the lobby\'s own words')
  assert.ok(!exec2.lobby().some((line) => line.startsWith('integrations attach')), '(3) and the write grant is NOT attached over a read grant that may still stand')
  ws2.cleanup()
}

// ── 4. The target: the comment, or --target ─────────────────────────────────
{
  const ws = workspace()
  const exec = makeExec({ rules: rules({ vms: [vmRow(VM)] }) })
  const error = await thrown(() => grantIn(ws, ['5'], exec))
  assert.equal(error?.exitCode, 2, '(4) a row with no comment refuses rather than crashing')
  assert.match(error.message, /--target/, '(4) and points at the override')
  assert.deepEqual(exec.mutating(), [], '(4) nothing mutated')
  ws.cleanup()

  const ws2 = workspace()
  const exec2 = makeExec({ rules: rules({ vms: [vmRow(VM, { comment: 'run=5' })] }) })
  const result = await grantIn(ws2, ['5', '--target', TARGET], exec2)
  assert.equal(result.target, TARGET, '(4) --target overrides a comment without target=')
  ws2.cleanup()
}

// ── 5. --live reads the VM's own status page with a VM token ────────────────
{
  const ws = workspace({ state: 'running' })
  fs.writeFileSync(path.join(ws.root, 'vm-token'), 'exe1-abc\n')
  const exec = makeExec({
    rules: [...rules(), { when: (cmd) => cmd === 'curl', answer: answer({ run: '5', state: REQUIRED_STATE }) }]
  })
  const result = await grantIn(ws, ['5', '--live'], exec)
  const curl = exec.calls.find((c) => c.cmd === 'curl')
  assert.ok(curl, '(5) --live reads over HTTPS')
  assert.ok(curl.argv.includes(`https://${VM}.exe.xyz/status.json`), '(5) the VM\'s own status URL — so the ls came first')
  assert.ok(curl.argv.includes('X-Exedev-Authorization: Bearer exe1-abc'), '(5) with the VM token')
  assert.equal(result.source, `https://${VM}.exe.xyz/status.json`, '(5) the live page, not the committed file that still says running')
  ws.cleanup()

  const noToken = workspace({ state: 'running' })
  const exec2 = makeExec({ rules: rules() })
  const error = await thrown(() => grantIn(noToken, ['5', '--live'], exec2))
  assert.equal(error?.exitCode, 2, '(5) --live with no token file refuses')
  assert.match(error.message, new RegExp(`ssh-key generate-api-key --vm=${VM}`), '(5) naming the per-VM minting command')
  noToken.cleanup()
}

// ── 6. A shared VM is never the run's ───────────────────────────────────────
{
  const ws = workspace()
  const exec = makeExec({ rules: rules({ vms: [], shared: [vmRow(VM, { comment: COMMENT })] }) })
  const error = await thrown(() => grantIn(ws, ['5'], exec))
  assert.equal(error?.exitCode, 2, '(6) a row under shared_vms is not a fleet VM, however it is named')
  assert.deepEqual(exec.mutating(), [], '(6) and nothing is granted to it')
  ws.cleanup()
}

console.log('ALL TESTS PASSED')
