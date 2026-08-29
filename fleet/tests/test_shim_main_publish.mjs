// fleet/tests/test_shim_main_publish.mjs — #320: the exit-code mapping is a
// pinned pure function, and main()'s delivered field is the CONJUNCTION of the
// shim's own delivery and the aux publish — an aux flush that never reached
// the orchestrator must read delivered:false even on a gate-green run.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { startOrchestrator, FLEET_PATH } from '../orchestrator.mjs'
import { mintToken } from '../tokens.mjs'
import { main as shimMain, shimExitCode, sandboxIdFor } from '../shim-main.mjs'

let passed = 0
const ok = (label) => {
  passed += 1
  console.log(`ok - ${label}`)
}

// --- 1. the exit-code truth table -------------------------------------------
assert.equal(shimExitCode({ status: 'gate-green', delivered: true }), 0)
assert.equal(shimExitCode({ status: 'gate-green', delivered: false }), 1)
assert.equal(shimExitCode({ status: 'gate-green' }), 1)
assert.equal(shimExitCode({ status: 'failed', delivered: true }), 1)
assert.equal(shimExitCode({ status: 'no-store' }), 1)
assert.equal(shimExitCode(null), 1)
assert.equal(shimExitCode(undefined), 1)
assert.equal(shimExitCode({}), 1)
ok('shimExitCode: gate-green && delivered===true → 0, everything else → 1')

// --- shared harness: a real orchestrator + real main() ----------------------
const runMain = async ({ runId, auxDeliver, planPath, omitInvokeRun, execOverride }) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-aux-'))
  const now = Date.now()
  const { token, record } = mintToken({ sandboxId: sandboxIdFor(runId), ttlMs: 60_000, now })
  const orch = await startOrchestrator({
    port: 0,
    dbDir: path.join(tmp, 'db'),
    tokenRecords: [record],
    actions: { page: () => {}, revokeAndPark: () => {}, destroySandbox: () => {} },
  })
  orch.store.setRow('runs', runId, { planPath: 'p.md', sandboxId: '', status: 'pending', branch: 'fleet-run' })
  const assignmentPath = path.join(tmp, 'fleet-run.json')
  fs.writeFileSync(
    assignmentPath,
    JSON.stringify({
      runId,
      token,
      wsUrl: `ws://127.0.0.1:${orch.port}/${FLEET_PATH}`,
      ttlMs: 60_000,
      ...(planPath ? { planPath } : {}),
    }),
  )
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-aux-repo-'))
  try {
    return await shimMain({
      assignmentPath,
      repoDir,
      exec: execOverride ?? (async () => ({ code: 1, stdout: '' })),
      ...(omitInvokeRun
        ? {}
        : {
            invokeRun: async () => {
              await new Promise((r) => setTimeout(r, 250))
              return { gateGreen: true }
            },
          }),
      readTokens: () => 4200,
      ...(auxDeliver ? { auxDeliver } : {}),
    })
  } finally {
    await orch.stop()
    fs.rmSync(tmp, { recursive: true, force: true })
    fs.rmSync(repoDir, { recursive: true, force: true })
  }
}

// --- 2. aux publish fails ⇒ delivered:false, exit 1 --------------------------
{
  const outcome = await runMain({ runId: 'run-aux-fail', auxDeliver: async () => false })
  assert.deepEqual(outcome, { status: 'gate-green', delivered: false })
  assert.equal(shimExitCode(outcome), 1)
  ok('aux publish failure sinks delivered and the exit code (gate-green notwithstanding)')
}

// --- 3. control: the default aux deliver against a live server → true --------
{
  const outcome = await runMain({ runId: 'run-aux-ok' })
  assert.deepEqual(outcome, { status: 'gate-green', delivered: true })
  assert.equal(shimExitCode(outcome), 0)
  ok('default aux deliver over a live socket keeps delivered:true, exit 0')
}

// --- default invokeRun binding: the join parks fail-closed (#190) -----------
{
  const cmds = []
  const outcome = await runMain({
    runId: 'run-join-1',
    planPath: 'docs/some-plan.md',
    omitInvokeRun: true,
    execOverride: async (cmd) => {
      cmds.push(cmd)
      return { code: 1, stdout: '' }
    },
  })
  // checkout of fleet-base failed => invokeEngineRun refuses before any spawn
  // => runShim parks => status 'failed' (the shim's non-green return shape).
  assert.equal(outcome.status, 'failed')
  assert.ok(
    cmds.some((c) => /git -C \S+ checkout -q fleet-base/.test(c)),
    `the default binding must thread repoDir+exec into invokeEngineRun, got: ${JSON.stringify(cmds)}`,
  )
  ok('default invokeRun binding threads the seams and parks fail-closed')
}

console.log(`\nALL TESTS PASSED (${passed})`)
