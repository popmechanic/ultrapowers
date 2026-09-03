/**
 * fleet/tests/test_grant.mjs — the approval.
 *
 * Three things must hold or the grant is not a gate at all:
 *
 *   1. the run's state must be exactly `awaiting-grant`. Any other state — and
 *      a missing status — refuses, with no integration touched;
 *   2. DETACH the read grant BEFORE attaching the write grant, always. The two
 *      must never overlap on one VM, because `github.int.exe.xyz` resolves one
 *      credential per repository;
 *   3. a `-ro` object that rides `tag:fleet` cannot be detached per VM. The
 *      grant says so and proceeds rather than pretending, or dying.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import { grant, renderGrant, DEFAULT_FOR, REQUIRED_STATE } from '../grant.mjs'
import {
  answer, cleanup, makeExec, makeFleetRuns, sshRule, tempDir, thrown, writeStatus
} from './_lobby_helpers.mjs'

const TARGET = 'popmechanic/smoke'
const VM = 'fleet-run-5'
const NOW = new Date('2026-09-03T12:00:00.000Z')

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
  comment = `run=5 plan=${'a'.repeat(40)} target=${TARGET} base=${'b'.repeat(40)} engine=${'c'.repeat(40)}`,
  integrations = [
    { name: 't-popmechanic-smoke-ro', attachments: [`vm:${VM}`] },
    { name: 't-popmechanic-smoke-rw', attachments: [] }
  ],
  detach = answer('')
} = {}) => [
  sshRule('ls --json', answer([{ name: VM, comment }])),
  sshRule('integrations list --json', answer(integrations)),
  sshRule('integrations detach', detach),
  sshRule('integrations attach', answer(''))
]

// ── 1. The state check ──────────────────────────────────────────────────────
{
  for (const state of ['running', 'booting', 'publishing', 'done', 'parked', 'failed']) {
    const ws = workspace({ state })
    const exec = makeExec({ rules: rules() })
    const error = await thrown(() => grant({ argv: ['5'], exec, config: ws.config, now: () => NOW }))
    assert.equal(error?.exitCode, 2, `(1) state ${state} refuses`)
    assert.match(error.message, new RegExp(`not ${REQUIRED_STATE}`), `(1) and names the state it wanted`)
    assert.deepEqual(exec.mutating(), [], `(1) state ${state} touches no integration`)
    ws.cleanup()
  }
  const missing = workspace({ state: null })
  const exec = makeExec({ rules: rules() })
  const error = await thrown(() => grant({ argv: ['5'], exec, config: missing.config, now: () => NOW }))
  assert.equal(error?.exitCode, 2, '(1) no committed status refuses')
  assert.match(error.message, /runs\/5\/status\.json/, '(1) and names the file it looked for')
  assert.deepEqual(exec.mutating(), [], '(1) and touches no integration')
  missing.cleanup()
}
{
  const exec = makeExec({ rules: rules() })
  const ws = workspace()
  const error = await thrown(() => grant({ argv: ['nope'], exec, config: ws.config }))
  assert.equal(error?.exitCode, 2, '(1) a non-numeric run refuses')
  assert.equal(exec.calls.length, 0, '(1) before any exec')
  ws.cleanup()
}

// ── 2. Detach, then attach ──────────────────────────────────────────────────
{
  const ws = workspace()
  const exec = makeExec({ rules: rules() })
  const result = await grant({ argv: ['5'], exec, config: ws.config, now: () => NOW })
  assert.deepEqual(exec.lobby(), [
    'ls --json',
    'integrations list --json',
    `integrations detach t-popmechanic-smoke-ro vm:${VM}`,
    `integrations attach t-popmechanic-smoke-rw vm:${VM} --for=15m`
  ], '(2) status, target, detach, attach — in that order')
  assert.equal(result.for, DEFAULT_FOR, '(2) the default window is 15m')
  assert.equal(result.expiresAt, '2026-09-03T12:15:00.000Z', '(2) the expiry is now + the window')
  assert.equal(result.target, TARGET, '(2) the target came from the VM comment')
  assert.deepEqual(result.warnings, [], '(2) a per-VM read grant needs no warning')
  assert.match(renderGrant(result), /t-popmechanic-smoke-rw attached to vm:fleet-run-5 for 15m/, '(2) the printed line')
  ws.cleanup()
}
{
  const ws = workspace()
  const exec = makeExec({ rules: rules() })
  const result = await grant({ argv: ['5', '--for', '30m'], exec, config: ws.config, now: () => NOW })
  assert.ok(exec.lobby().includes(`integrations attach t-popmechanic-smoke-rw vm:${VM} --for=30m`), '(2) --for is honoured')
  assert.equal(result.expiresAt, '2026-09-03T12:30:00.000Z', '(2) and moves the expiry')
  ws.cleanup()
}
{
  const ws = workspace()
  const exec = makeExec({ rules: rules() })
  const error = await thrown(() => grant({ argv: ['5', '--for', 'fifteen'], exec, config: ws.config }))
  assert.equal(error?.exitCode, 2, '(2) an unparseable --for refuses')
  assert.equal(exec.calls.length, 0, '(2) before any exec')
  ws.cleanup()
}

// ── 3. The tag-attached read grant, and a detach that finds nothing ─────────
{
  const ws = workspace()
  const exec = makeExec({
    rules: rules({
      integrations: [
        { name: 't-popmechanic-smoke-ro', attachments: ['tag:fleet'] },
        { name: 't-popmechanic-smoke-rw', attachments: [] }
      ]
    })
  })
  const result = await grant({ argv: ['5'], exec, config: ws.config, now: () => NOW })
  assert.ok(
    !exec.lobby().some((line) => line.startsWith('integrations detach')),
    '(3) a tag attachment is not detached per VM — it cannot be'
  )
  assert.equal(result.warnings.length, 1, '(3) but the operator is warned')
  assert.match(result.warnings[0], /rides tag:fleet/, '(3) that read access remains')
  assert.ok(exec.lobby().includes(`integrations attach t-popmechanic-smoke-rw vm:${VM} --for=15m`), '(3) and the write grant still lands')
  assert.match(renderGrant(result), /^warning: /, '(3) the warning is printed first')
  ws.cleanup()
}
{
  const ws = workspace()
  const exec = makeExec({
    rules: rules({ detach: answer('', { code: 1, stderr: 'integration not attached to vm:fleet-run-5' }) })
  })
  const result = await grant({ argv: ['5'], exec, config: ws.config, now: () => NOW })
  assert.ok(exec.lobby().includes(`integrations attach t-popmechanic-smoke-rw vm:${VM} --for=15m`),
    '(3) a detach that answers "not attached" is tolerated — the grant may have lapsed')
  assert.equal(result.vm, VM, '(3) and the grant completes')
  ws.cleanup()
}

// ── 4. No writable object, and no target to be had ──────────────────────────
{
  const ws = workspace()
  const exec = makeExec({
    rules: rules({ integrations: [{ name: 't-popmechanic-smoke-ro', attachments: [] }] })
  })
  const error = await thrown(() => grant({ argv: ['5'], exec, config: ws.config }))
  assert.equal(error?.exitCode, 2, '(4) a missing -rw object refuses')
  assert.match(error.message, /node fleet\/target\.mjs add popmechanic\/smoke/,
    '(4) and names the command that makes one')
  assert.deepEqual(exec.mutating(), [], '(4) nothing was attached or detached')
  ws.cleanup()
}
{
  const ws = workspace()
  const exec = makeExec({ rules: rules({ comment: 'run=5 state=expired' }) })
  const error = await thrown(() => grant({ argv: ['5'], exec, config: ws.config }))
  assert.equal(error?.exitCode, 2, '(4) a comment with no target= refuses')
  assert.match(error.message, /--target/, '(4) and points at the override')
  ws.cleanup()

  const ws2 = workspace()
  const exec2 = makeExec({ rules: rules({ comment: 'run=5 state=expired' }) })
  const result = await grant({
    argv: ['5', '--target', TARGET], exec: exec2, config: ws2.config, now: () => NOW
  })
  assert.equal(result.target, TARGET, '(4) --target overrides the comment')
  ws2.cleanup()
}

// ── 5. --live reads the status page with a VM token ────────────────────────
{
  const ws = workspace({ state: 'running' })
  fs.writeFileSync(path.join(ws.root, 'vm-token'), 'exe1-abc\n')
  const exec = makeExec({
    rules: [
      ...rules(),
      {
        when: (cmd) => cmd === 'curl',
        answer: answer({ run: '5', state: REQUIRED_STATE })
      }
    ]
  })
  const result = await grant({ argv: ['5', '--live'], exec, config: ws.config, now: () => NOW })
  const curl = exec.calls.find((c) => c.cmd === 'curl')
  assert.ok(curl, '(5) --live reads over HTTPS')
  assert.ok(curl.argv.includes('https://fleet-run-5.exe.xyz/status.json'), '(5) the run\'s own status URL')
  assert.ok(curl.argv.includes('X-Exedev-Authorization: Bearer exe1-abc'), '(5) with the VM token')
  assert.equal(result.source, 'https://fleet-run-5.exe.xyz/status.json',
    '(5) and the live page — not the committed file, which still says running')
  ws.cleanup()

  const noToken = workspace({ state: 'running' })
  const exec2 = makeExec({ rules: rules() })
  const error = await thrown(() => grant({ argv: ['5', '--live'], exec: exec2, config: noToken.config }))
  assert.equal(error?.exitCode, 2, '(5) --live with no token file refuses')
  assert.match(error.message, /ssh-key generate-api-key --vm=fleet-run-5/,
    '(5) and names the per-VM minting command, because VM tokens are per VM')
  noToken.cleanup()
}

// (6) `ls --json` is `{ shared_vms, vms }`; the rows are every array, not the
// first one — run-69 was invisible behind the one shared VM.
{
  const { jsonRows } = await import('../lobby.mjs')
  const rows = jsonRows({ shared_vms: [{ vm_name: 'snw-build' }], vms: [{ vm_name: 'fleet-run-69' }] })
  assert.deepEqual(rows.map((r) => r.vm_name), ['snw-build', 'fleet-run-69'], '(6) every envelope array is rows')
}

console.log('ALL TESTS PASSED')

