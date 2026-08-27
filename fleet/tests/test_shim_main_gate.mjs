// fleet/tests/test_shim_main_gate.mjs — a self-approved NEEDS_ACK (#281 standing
// directive) must green the fleet shim, but only on THREE legs of evidence read
// from the same run directory as the machine-written gate receipt:
//
//   1. standing-approval.json  — the session declared its intent to self-approve
//      BEFORE running the approve, quoting the standing directive.
//   2. every ack in the receipt is inside the granted class
//      (deferred:runtime / deferred:external) — anything else parks.
//   3. approve-receipt.json    — the approve actually RAN (mode: 'approve',
//      matching stamp), and RUN_LOCK no longer names this run's stamp (the
//      approve's own on-disk side effect: the lock release).
//
// A bare PASS still greens unconditionally; a bare NEEDS_ACK (no sidecars) never
// greens vacuously — every leg is fail-closed.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  readGateGreen,
  GRANTED_ACK_TYPES,
  STANDING_DIRECTIVE,
  runArtifactDirs,
  findReceiptFiles,
  findGateReceiptFile,
  findRunReportFile,
} from '../shim-main.mjs'

let passed = 0
const ok = (label) => {
  passed += 1
  console.log(`ok - ${label}`)
}

const stamp = '20260826-120000'
const mkRun = (t, { verdict, acks = [], standing = null, approve = null, lock = null }) => {
  const runDir = path.join(t, '.claude', 'ultrapowers', `run-${stamp}`)
  fs.mkdirSync(runDir, { recursive: true })
  const receiptFile = path.join(runDir, 'gate-receipt.json')
  fs.writeFileSync(receiptFile, JSON.stringify({ mode: 'gate', stamp, verdict, gateCheck: { verdict, acks } }))
  if (standing) fs.writeFileSync(path.join(runDir, 'standing-approval.json'), JSON.stringify(standing))
  if (approve) fs.writeFileSync(path.join(runDir, 'approve-receipt.json'), JSON.stringify(approve))
  if (lock !== null) fs.writeFileSync(path.join(runDir, '..', 'RUN_LOCK'), lock)
  return receiptFile
}
const EXT = { type: 'deferred:external', detail: 'live shape unverified' }
const RUN = { type: 'deferred:runtime', detail: 'timing-dependent' }
const STANDING = { grantedAt: 'launch directive', instruction: 'x', ackList: [] }
const APPROVE = { mode: 'approve', stamp, branch: 'ultra/integration-x', swept: {} }

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-gate-'))

// --- 1. bare PASS greens unconditionally ------------------------------------
{
  const t1 = tmp()
  assert.equal(readGateGreen(mkRun(t1, { verdict: 'PASS' })), true)
  ok('bare PASS greens')
}

// --- 2. bare BLOCKED never greens --------------------------------------------
{
  const t2 = tmp()
  assert.equal(readGateGreen(mkRun(t2, { verdict: 'BLOCKED' })), false)
  ok('BLOCKED never greens')
}

// --- 3. bare NEEDS_ACK (no sidecars at all) never greens ---------------------
{
  const t3 = tmp()
  assert.equal(readGateGreen(mkRun(t3, { verdict: 'NEEDS_ACK', acks: [EXT] })), false)
  ok('bare NEEDS_ACK never greens')
}

// --- 4. all three legs present → green ---------------------------------------
{
  const t4 = tmp()
  assert.equal(
    readGateGreen(mkRun(t4, { verdict: 'NEEDS_ACK', acks: [EXT, RUN], standing: STANDING, approve: APPROVE })),
    true,
  )
  ok('all three legs present greens')
}

// --- 5. no standing sidecar → parks -------------------------------------------
{
  const t5 = tmp()
  assert.equal(readGateGreen(mkRun(t5, { verdict: 'NEEDS_ACK', acks: [EXT], approve: APPROVE })), false)
  ok('missing standing-approval.json parks')
}

// --- 6. an ack outside the granted class → parks ------------------------------
{
  const t6 = tmp()
  assert.equal(
    readGateGreen(
      mkRun(t6, {
        verdict: 'NEEDS_ACK',
        acks: [EXT, { type: 'deferred:manual', detail: 'operator step' }],
        standing: STANDING,
        approve: APPROVE,
      }),
    ),
    false,
  )
  ok('manual ack outside the grant parks')
}

// --- 7. an unrelated ack type → parks -----------------------------------------
{
  const t7 = tmp()
  assert.equal(
    readGateGreen(
      mkRun(t7, {
        verdict: 'NEEDS_ACK',
        acks: [{ type: 'coverage', detail: 'incomplete' }],
        standing: STANDING,
        approve: APPROVE,
      }),
    ),
    false,
  )
  ok('coverage ack parks')
}

// --- 8. empty acks array never greens vacuously -------------------------------
{
  const t8 = tmp()
  assert.equal(
    readGateGreen(mkRun(t8, { verdict: 'NEEDS_ACK', acks: [], standing: STANDING, approve: APPROVE })),
    false,
  )
  ok('empty acks never green vacuously')
}

// --- 9. approve receipt missing → parks ---------------------------------------
{
  const t9 = tmp()
  assert.equal(readGateGreen(mkRun(t9, { verdict: 'NEEDS_ACK', acks: [EXT], standing: STANDING })), false)
  ok('missing approve-receipt.json parks')
}

// --- 10. approve receipt wrong mode → parks -----------------------------------
{
  const t10 = tmp()
  assert.equal(
    readGateGreen(
      mkRun(t10, {
        verdict: 'NEEDS_ACK',
        acks: [EXT],
        standing: STANDING,
        approve: { ...APPROVE, mode: 'teardown' },
      }),
    ),
    false,
  )
  ok('approve receipt with wrong mode parks')
}

// --- 11. approve receipt stamp mismatch → parks -------------------------------
{
  const t11 = tmp()
  assert.equal(
    readGateGreen(
      mkRun(t11, {
        verdict: 'NEEDS_ACK',
        acks: [EXT],
        standing: STANDING,
        approve: { ...APPROVE, stamp: '19990101-000000' },
      }),
    ),
    false,
  )
  ok('approve receipt stamp mismatch parks')
}

// --- 12. RUN_LOCK still held by this stamp → approve never actually ran ------
{
  const t12 = tmp()
  assert.equal(
    readGateGreen(
      mkRun(t12, { verdict: 'NEEDS_ACK', acks: [EXT], standing: STANDING, approve: APPROVE, lock: stamp }),
    ),
    false,
  )
  ok('RUN_LOCK still held by this stamp parks')
}

// --- 13. a different run's lock is not ours → still greens --------------------
{
  const t13 = tmp()
  assert.equal(
    readGateGreen(
      mkRun(t13, { verdict: 'NEEDS_ACK', acks: [EXT], standing: STANDING, approve: APPROVE, lock: 'other-run' }),
    ),
    true,
  )
  ok("a different run's RUN_LOCK does not block green")
}

// --- 14. missing/unreadable receipt → parks -----------------------------------
{
  const t14 = tmp()
  assert.equal(readGateGreen(path.join(t14, 'nope.json')), false)
  ok('missing/unreadable receipt parks')
}

// --- 15. the directive must instruct saving the approve receipt --------------
assert.ok(STANDING_DIRECTIVE.includes('approve-receipt.json'), 'directive must instruct saving the approve receipt')
ok('STANDING_DIRECTIVE instructs saving approve-receipt.json')

// --- 16. GRANTED_ACK_TYPES is exactly the #281 granted class ------------------
assert.deepEqual([...GRANTED_ACK_TYPES].sort(), ['deferred:external', 'deferred:runtime'])
ok('GRANTED_ACK_TYPES is exactly {deferred:runtime, deferred:external}')

// --- #190: discovery scoping + newest-wins ---------------------------------
{
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-scope-'))
  const dir = (name) => path.join(repo, '.claude/ultrapowers', name)
  const receipt = (name, verdict) => {
    fs.mkdirSync(dir(name), { recursive: true })
    fs.writeFileSync(path.join(dir(name), 'gate-receipt.json'), JSON.stringify({ verdict, stamp: name }))
  }
  receipt('run-20260101000000', 'PASS')   // the stale pre-run leftover
  receipt('run-20260901000000', 'PASS')   // the run's own
  receipt('run-20260902000000', 'PASS')   // an even newer one

  // newest-wins: the LAST run dir by name sort is the one discovered
  assert.equal(
    findGateReceiptFile(repo),
    path.join(repo, '.claude/ultrapowers/run-20260902000000/gate-receipt.json'),
  )

  // excludeDirs scoping: pre-run dirs are invisible to every discovery reader
  const pre = new Set(['run-20260101000000', 'run-20260901000000', 'run-20260902000000'])
  assert.equal(findGateReceiptFile(repo, undefined, { excludeDirs: pre }), '')
  assert.deepEqual(findReceiptFiles(repo, undefined, { excludeDirs: pre }), [])
  assert.deepEqual(runArtifactDirs(repo, undefined, { excludeDirs: pre }), [])
  assert.equal(findRunReportFile(repo, undefined, { excludeDirs: pre }), '')

  const preOnly = new Set(['run-20260101000000'])
  assert.deepEqual(runArtifactDirs(repo, undefined, { excludeDirs: preOnly }), [
    'run-20260901000000',
    'run-20260902000000',
  ])
  assert.equal(
    findGateReceiptFile(repo, undefined, { excludeDirs: preOnly }),
    path.join(repo, '.claude/ultrapowers/run-20260902000000/gate-receipt.json'),
  )
  fs.rmSync(repo, { recursive: true, force: true })
  ok('discovery scoping excludes pre-run dirs; newest-wins pinned (#190)')
}

console.log(`\nALL TESTS PASSED (${passed})`)
