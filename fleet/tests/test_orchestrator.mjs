// fleet/tests/test_orchestrator.mjs — sentinel-style spec for the orchestrator.
//
// Concurrency-safe by construction: it binds an ephemeral port (`port: 0`) and
// reads the bound port back off `startOrchestrator`'s return, and every byte
// of persisted state lives under an `fs.mkdtemp` directory unique to this
// process. No shared fixtures.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { WebSocket } from 'ws'
import { createMergeableStore } from 'tinybase'
import { createWsSynchronizer } from 'tinybase/synchronizers/synchronizer-ws-client'
import { startOrchestrator, FLEET_PATH } from '../orchestrator.mjs'
import { mintToken } from '../tokens.mjs'
import { totalSpent, tryClaim, spendRowId } from '../store.mjs'

const PORT = 0
const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-orch-'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const settle = () => sleep(300)

// A frozen clock: token expiry and every guard/spend decision in this spec is a
// pure function of the clock, so freezing it removes all wall-clock flake.
const T = 1_000_000
const clock = () => T

const sb1 = mintToken({ sandboxId: 'sb1', ttlMs: 60_000, now: T })
const sb2 = mintToken({ sandboxId: 'sb2', ttlMs: 60_000, now: T })
const tokenRecords = [sb1.record, sb2.record]

// `orch` is hoisted so the actions below can read the live store at
// call-time (see `parkStatusAtRevoke`) — actions fire from inside
// `orch.sweep(...)`, so by the time this module assigns `orch` in the try
// block, every callback closing over it already has the right binding.
let orch

// Set once the first `startOrchestrator` call resolves and read by
// `joinClient` and the bad-token probe below — both run only after `orch` is
// assigned.
let boundPort

// Injected actions — the orchestrator never shells out itself. `actionsLog`
// records only the hard actions so it can be asserted by full equality;
// pages go to their own log for the same reason. `parkStatusAtRevoke`
// captures the run's store status at the instant `revokeAndPark` fires, so
// the ordering guarantee (park lands before the destructive actions run) is
// asserted directly rather than inferred from side effects.
const actionsLog = []
const pageLog = []
const parkStatusAtRevoke = []
const actions = {
  revokeAndPark: (runId, why) => {
    parkStatusAtRevoke.push(orch.store.getRow('runs', runId)?.status)
    actionsLog.push(`revokeAndPark ${runId} ${why}`)
  },
  destroySandbox: (sandboxId) => actionsLog.push(`destroySandbox ${sandboxId}`),
  page: (cls, text) => pageLog.push([cls, text]),
}

const joinClient = async (id, token) => {
  const store = createMergeableStore(id)
  const socket = new WebSocket(`ws://127.0.0.1:${boundPort}/${FLEET_PATH}?token=${token}`)
  const synchronizer = await createWsSynchronizer(store, socket)
  await synchronizer.startSync()
  return { store, synchronizer }
}

const convergeAways = (descriptions) => descriptions.filter((d) => d.startsWith('converge-away'))

const cleanup = () => fs.rmSync(dbDir, { recursive: true, force: true })

try {
  orch = await startOrchestrator({ port: PORT, dbDir, tokenRecords, actions, clock })
  boundPort = orch.port
  assert.equal(typeof boundPort, 'number', 'startOrchestrator must return the bound port')
  assert.ok(boundPort > 0, 'the bound port must be a real ephemeral port, not 0')

  // -- 1. token gate --------------------------------------------------------
  // A bad token is refused at the handshake (verifyClient parses ?token= and
  // calls verifyToken(token, tokenRecords, clock())); a good token connects
  // and syncs.
  const refused = await new Promise((resolve) => {
    const bad = new WebSocket(`ws://127.0.0.1:${boundPort}/${FLEET_PATH}?token=not-a-real-token`)
    bad.on('error', () => resolve(true))
    bad.on('open', () => {
      bad.close()
      resolve(false)
    })
  })
  assert.equal(refused, true, 'a client presenting an unknown token must be refused')

  const c1 = await joinClient('sb1', sb1.token)
  const c2 = await joinClient('sb2', sb2.token)

  orch.store.setRow('runs', 'r1', {
    planPath: 'docs/superpowers/plans/r1.md',
    sandboxId: 'sb1',
    status: 'running',
    branch: 'claw/r1',
  })
  await settle()
  assert.deepEqual(
    c1.store.getRow('runs', 'r1'),
    { planPath: 'docs/superpowers/plans/r1.md', sandboxId: 'sb1', status: 'running', branch: 'claw/r1' },
    'a good token must connect and sync the orchestrator-authored run row',
  )

  // -- 2. guard sweep -------------------------------------------------------
  // sb1 holds a legitimate claim on r1; sb2 tries to steal it. The sweep must
  // converge the stolen row away and leave sb1 as holder.
  const claimed = tryClaim(undefined, { runId: 'r1', claimant: 'sb1', ttlMs: 60_000, now: T })
  assert.equal(claimed.error, undefined, 'sb1 must be able to take a free claim')
  c1.store.setRow('claims', 'claim:r1', claimed.row)
  await settle()
  assert.deepEqual(convergeAways(orch.sweep(T)), [], 'a legitimate first claim must not be converged away')

  c2.store.setRow('claims', 'claim:r1', {
    runId: 'r1',
    holder: 'sb2',
    leaseExpiresAt: T + 60_000,
    epoch: 2,
    revoked: false,
  })
  await settle()

  const stealSweep = orch.sweep(T)
  assert.ok(stealSweep.length >= 1, `a claim steal must be reported by the sweep, got ${JSON.stringify(stealSweep)}`)
  assert.deepEqual(
    convergeAways(stealSweep),
    ['converge-away claims claim:r1 (claim held by sb1, writer is sb2)'],
    'the sweep must converge away exactly the stolen claim row, naming the guard reason',
  )
  assert.equal(orch.store.getRow('claims', 'claim:r1').holder, 'sb1', 'the claim must re-converge to its rightful holder')
  assert.equal(orch.store.getRow('claims', 'claim:r1').epoch, claimed.row.epoch, 'the rightful epoch must be restored')
  assert.deepEqual(
    pageLog.map(([cls]) => cls),
    ['security'],
    'converging away an unauthorized write must raise exactly one security page',
  )
  await settle()
  assert.equal(c2.store.getRow('claims', 'claim:r1').holder, 'sb1', 'the thief must observe its steal converged away')

  // -- 2b. a write racing a heartbeat ---------------------------------------
  // heartbeat() is a periodic liveness beacon, so writes land between sweeps
  // continuously and a heartbeat firing between an unauthorized write and the
  // next sweep is the common case, not the exotic one. If heartbeat re-baselined
  // the store, this steal would be blessed unjudged and survive untouched.
  c2.store.setRow('claims', 'claim:r1', {
    runId: 'r1',
    holder: 'sb2',
    leaseExpiresAt: T + 60_000,
    epoch: 3,
    revoked: false,
  })
  await settle()
  pageLog.length = 0
  orch.heartbeat(T + 1)

  const racedSweep = orch.sweep(T)
  assert.deepEqual(
    convergeAways(racedSweep),
    ['converge-away claims claim:r1 (claim held by sb1, writer is sb2)'],
    'a heartbeat between the steal and the sweep must not launder it — the sweep still converges it away',
  )
  assert.equal(
    orch.store.getRow('claims', 'claim:r1').holder,
    'sb1',
    'the claim must re-converge to its rightful holder across a heartbeat',
  )
  assert.equal(orch.store.getRow('claims', 'claim:r1').epoch, claimed.row.epoch, 'the rightful epoch must be restored')
  assert.equal(orch.store.getRow('meta', 'heartbeat').at, T + 1, 'the heartbeat itself must still have been written')
  assert.deepEqual(
    pageLog,
    [['security', 'guard sweep converged away 1: converge-away claims claim:r1 (claim held by sb1, writer is sb2)']],
    'the laundered-write sweep must raise exactly one security page — the heartbeat row itself is never a violation',
  )

  // -- 3. spend hard action -------------------------------------------------
  // Overshoot is detected, never prevented: sb1 spends 120 against a cap of
  // 100, and the orchestrator pulls the run out from under it.
  orch.store.setRow('budgets', 'r1', { capTokens: 100 })
  c1.store.setRow('spend', spendRowId('sb1', 1), { runId: 'r1', tokens: 60, at: T })
  c1.store.setRow('spend', spendRowId('sb1', 2), { runId: 'r1', tokens: 60, at: T })
  await settle()

  actionsLog.length = 0
  pageLog.length = 0
  parkStatusAtRevoke.length = 0
  const spendSweep = orch.sweep(T)

  assert.deepEqual(
    actionsLog,
    ['revokeAndPark r1 spend-cap-overshoot 120/100', 'destroySandbox sb1'],
    'the hard actions must fire in order: revoke-and-park the run, then destroy the holding sandbox',
  )
  assert.deepEqual(
    parkStatusAtRevoke,
    ['parked'],
    'the run must already show parked in the store by the time actions.revokeAndPark fires — park lands before the destructive actions',
  )
  assert.deepEqual(
    convergeAways(spendSweep),
    [],
    'legitimate append-only spend rows inside the writer namespace must not be converged away',
  )
  assert.deepEqual(pageLog, [['spend', 'r1 spend-cap-overshoot 120/100']], 'a spend page must be raised, and only that')
  assert.equal(orch.store.getRow('claims', 'claim:r1').revoked, true, 'the claim must be revoked')
  assert.equal(orch.store.getRow('runs', 'r1').status, 'parked', 'the run must be parked')
  assert.equal(
    orch.store.getRow('runs', 'r1').parkedWhy,
    'spend-cap-overshoot 120/100',
    'the park must record why, verbatim',
  )

  // The revoke is the orchestrator's own write and passes its own guard via the
  // supervisory exemption — so the NEXT sweep reports zero converge-aways.
  await settle()
  actionsLog.length = 0
  pageLog.length = 0
  const nextSweep = orch.sweep(T)
  assert.deepEqual(convergeAways(nextSweep), [], 'the supervisor revoke must not be converged away by the next sweep')
  assert.deepEqual(pageLog, [], 'a clean sweep must raise no pages')
  assert.deepEqual(actionsLog, [], 'an already-revoked overshoot must not re-fire the hard actions')

  // -- 3b. spend hard action while the run is still 'pending' --------------
  // A sandbox can burn tokens before ever advancing the run past 'pending'
  // (e.g. spend racing ahead of the claimed/running transition), and the
  // overshoot pull must still park the run — the spend-overshoot edge that
  // makes 'parked' legal from 'pending' in fleet/store.mjs.
  orch.store.setRow('runs', 'r2', {
    planPath: 'docs/superpowers/plans/r2.md',
    sandboxId: 'sb2',
    status: 'pending',
    branch: 'claw/r2',
  })
  const claimedR2 = tryClaim(undefined, { runId: 'r2', claimant: 'sb2', ttlMs: 60_000, now: T })
  assert.equal(claimedR2.error, undefined, 'sb2 must be able to take a free claim on r2')
  c2.store.setRow('claims', 'claim:r2', claimedR2.row)
  orch.store.setRow('budgets', 'r2', { capTokens: 50 })
  c2.store.setRow('spend', spendRowId('sb2', 1), { runId: 'r2', tokens: 40, at: T })
  c2.store.setRow('spend', spendRowId('sb2', 2), { runId: 'r2', tokens: 40, at: T })
  await settle()

  actionsLog.length = 0
  pageLog.length = 0
  parkStatusAtRevoke.length = 0
  const pendingOvershootSweep = orch.sweep(T)

  assert.deepEqual(
    actionsLog,
    ['revokeAndPark r2 spend-cap-overshoot 80/50', 'destroySandbox sb2'],
    'a pending-run overshoot must still fire the hard actions in order',
  )
  assert.deepEqual(
    parkStatusAtRevoke,
    ['parked'],
    'the pending run must already show parked in the store by the time actions.revokeAndPark fires',
  )
  assert.deepEqual(
    convergeAways(pendingOvershootSweep),
    [],
    'the legitimate claim, budget, and spend writes for the pending-run overshoot must not be converged away',
  )
  assert.deepEqual(
    pageLog,
    [['spend', 'r2 spend-cap-overshoot 80/50']],
    'a spend page must be raised, and only that',
  )
  assert.equal(orch.store.getRow('claims', 'claim:r2').revoked, true, "the pending run's claim must be revoked")
  assert.equal(
    orch.store.getRow('runs', 'r2').status,
    'parked',
    'a run still pending at overshoot time must still end parked',
  )
  assert.equal(
    orch.store.getRow('runs', 'r2').parkedWhy,
    'spend-cap-overshoot 80/50',
    'the park reason on a pending-run overshoot must record why, verbatim',
  )

  // The pending -> parked write is the orchestrator's own supervised action,
  // so — like the r1 overshoot above — it must pass the guard cleanly on the
  // NEXT sweep too: zero converge-aways for those writes.
  await settle()
  actionsLog.length = 0
  pageLog.length = 0
  const nextPendingSweep = orch.sweep(T)
  assert.deepEqual(
    convergeAways(nextPendingSweep),
    [],
    'the pending-run overshoot writes (claim revoke + pending->parked) must not be converged away by the next sweep',
  )
  assert.deepEqual(pageLog, [], 'a clean sweep after the pending-run overshoot must raise no pages')
  assert.deepEqual(actionsLog, [], 'an already-revoked pending-run overshoot must not re-fire the hard actions')

  // -- 3c. spend hard action refused when the park is illegal ---------------
  // A run stuck in a terminal state (folded — no legal transitions at all)
  // cannot be parked. The park-first ordering must refuse to revoke the
  // claim or fire any destructive action in that case, leaving both the
  // claim and the sandbox intact for an operator to triage by hand.
  orch.store.setRow('runs', 'r3', {
    planPath: 'docs/superpowers/plans/r3.md',
    sandboxId: 'sb1',
    status: 'folded',
    branch: 'claw/r3',
  })
  const claimedR3 = tryClaim(undefined, { runId: 'r3', claimant: 'sb1', ttlMs: 60_000, now: T })
  assert.equal(claimedR3.error, undefined, 'sb1 must be able to take a free claim on r3')
  c1.store.setRow('claims', 'claim:r3', claimedR3.row)
  orch.store.setRow('budgets', 'r3', { capTokens: 10 })
  c1.store.setRow('spend', spendRowId('sb1', 3), { runId: 'r3', tokens: 20, at: T })
  await settle()

  actionsLog.length = 0
  pageLog.length = 0
  parkStatusAtRevoke.length = 0
  const parkIllegalSweep = orch.sweep(T)

  assert.deepEqual(
    actionsLog,
    [],
    'an overshoot whose park is illegal must take no destructive action at all',
  )
  assert.deepEqual(
    parkStatusAtRevoke,
    [],
    'actions.revokeAndPark must never fire when the park write is refused',
  )
  assert.deepEqual(
    pageLog,
    [['security', 'supervisor park refused for r3: illegal transition folded -> parked']],
    'a park-illegal overshoot must raise exactly one security page naming the refusal',
  )
  assert.deepEqual(
    convergeAways(parkIllegalSweep),
    [],
    'the legitimate claim, budget, and spend writes for r3 must not be converged away',
  )
  assert.equal(orch.store.getRow('runs', 'r3').status, 'folded', 'a run whose park is illegal must keep its status unchanged')
  assert.equal(
    orch.store.getRow('claims', 'claim:r3').revoked,
    false,
    'the claim must be left intact when the park is refused',
  )

  // -- 4. persistence -------------------------------------------------------
  for (const c of [c1, c2]) {
    await c.synchronizer.stopSync()
    await c.synchronizer.destroy()
  }
  // Written with NO settle before stop(): the tail of a run is the part
  // auto-save timing loses, so stop() has to carry it across on its own.
  orch.store.setRow('receipts', 'r1:gate', { sha: 'deadbeef', path: 'docs/gate.md', verdict: 'red' })
  await orch.stop()

  // Restart on the FIRST run's bound port — preserving the persistence
  // semantics under test (the theoretical port-reuse race is accepted;
  // ephemeral ports are effectively never immediately re-grabbed).
  const firstBoundPort = boundPort
  orch = await startOrchestrator({ port: firstBoundPort, dbDir, tokenRecords, actions, clock })
  boundPort = orch.port
  assert.equal(boundPort, firstBoundPort, 'restarting on an explicit port must bind exactly that port')
  await settle()
  assert.equal(totalSpent(orch.store.getTable('spend'), 'r1'), 120, 'the spend ledger must survive a restart')
  assert.equal(orch.store.getRow('claims', 'claim:r1').revoked, true, 'the revoked claim must survive a restart')
  assert.equal(orch.store.getRow('runs', 'r1').status, 'parked', 'the parked run must survive a restart')
  assert.deepEqual(
    orch.store.getRow('receipts', 'r1:gate'),
    { sha: 'deadbeef', path: 'docs/gate.md', verdict: 'red' },
    'a write made immediately before stop() must survive the restart too',
  )

  // -- 5. heartbeat ---------------------------------------------------------
  orch.heartbeat(5000)
  assert.equal(orch.store.getRow('meta', 'heartbeat').at, 5000, 'heartbeat must write meta/heartbeat.at')

  await orch.stop()
  cleanup()
  console.log('ALL TESTS PASSED')
} catch (error) {
  cleanup()
  console.error(error)
  process.exit(1)
}
