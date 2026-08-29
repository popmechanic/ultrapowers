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
import { startOrchestrator, FLEET_PATH, REAP_GRACE_MS } from '../orchestrator.mjs'
import { mintToken } from '../tokens.mjs'
import { totalSpent, tryClaim, spendRowId } from '../store.mjs'

const PORT = 0
const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-orch-'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Bounded poll: every `settle()` call this file used to make was a guess at
// how long a TinyBase CRDT round trip (client -> ws server -> orchestrator,
// or the reverse) takes to converge. `until` polls the actual destination
// store for the row state the next assertion depends on instead, so the
// suite resolves in tens of milliseconds rather than paying a fixed 300ms at
// every barrier, and never flakes under load that makes 300ms too short.
const until = async (fn, what, capMs = 5_000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < capMs) {
    const v = fn()
    if (v) return v
    await sleep(50)
  }
  throw new Error('until: timed out waiting for ' + what)
}

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
  // NOTE (plan-defect): `store.getRow` returns `{}` — not undefined — for a
  // row that doesn't exist yet, so a bare `getRow(...)` predicate is always
  // truthy and `until` returns on its first tick, before the sync has
  // actually landed the row. `hasRow` is the correct existence check.
  await until(() => c1.store.hasRow('runs', 'r1'), 'run r1 to reach client c1')
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
  await until(
    () => orch.store.getRow('claims', 'claim:r1')?.holder === 'sb1',
    'sb1 claim to reach the supervisor store',
  )
  assert.deepEqual(convergeAways(orch.sweep(T)), [], 'a legitimate first claim must not be converged away')

  c2.store.setRow('claims', 'claim:r1', {
    runId: 'r1',
    holder: 'sb2',
    leaseExpiresAt: T + 60_000,
    epoch: 2,
    revoked: false,
  })
  await until(() => orch.store.getRow('claims', 'claim:r1')?.holder === 'sb2',
    'sb2 steal to reach the supervisor store')

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
  await until(
    () => c2.store.getRow('claims', 'claim:r1')?.holder === 'sb1',
    'the converge-away to reach client c2',
  )
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
  await until(
    () => orch.store.getRow('claims', 'claim:r1')?.epoch === 3,
    'the raced steal (epoch 3) to reach the supervisor store',
  )
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

  // -- 3. the claim-lease reaper (#400) -------------------------------------
  // The spend hard action is DELETED: nothing parks, revokes or destroys on a
  // spend number any more. What replaces it is out-of-band VM reclamation on a
  // LIVENESS trigger — the one thing the spend supervisor did that nothing else
  // does. `destroySandbox` reached this action surface at exactly one site,
  // inside that spend pass, so deleting it without a replacement would have
  // left a drive's death leaking a billed VM forever.
  //
  // The claim's lease IS the drive's heartbeat: a live drive renews it, so an
  // expired lease already means "no drive heartbeat for a lease period".

  // 3z. The ledger SURVIVES the cap's deletion. `spend` rows are still written
  //     by sandboxes, still writer-namespaced and append-only, still folded by
  //     `totalSpent` at read time. What is gone is anything that ACTS on the
  //     total. (Section 4 asserts these same rows survive a restart.)
  c1.store.setRow('spend', spendRowId('sb1', 1), { runId: 'r1', tokens: 60, at: T })
  c1.store.setRow('spend', spendRowId('sb1', 2), { runId: 'r1', tokens: 60, at: T })
  await until(
    () => totalSpent(orch.store.getTable('spend'), 'r1') === 120,
    'sb1 spend rows for r1 to reach the supervisor store',
  )
  {
    const before = actionsLog.length
    orch.sweep(T)
    assert.equal(actionsLog.length, before, 'recording spend must take no action at all')
  }

  // 3a. A LIVE claim is never reaped, however much it has spent.
  //     This is the assertion that pins the trigger. The spend rows below would
  //     have blown any cap the old pass could have set; nothing happens, because
  //     spend is not a reason to destroy a VM.
  const REAPER_TTL = 60_000
  const reaped = tryClaim(undefined, { runId: 'r-live', claimant: 'sb-live', ttlMs: REAPER_TTL, now: T }).row
  orch.store.setRow('claims', 'claim:r-live', reaped)
  orch.store.setRow('spend', spendRowId('orch', 900), { runId: 'r-live', tokens: 10_000_000, at: T })
  {
    const before = actionsLog.length
    orch.sweep(T + 1)
    assert.equal(actionsLog.length, before, 'a live claim must never be reaped, whatever it spent')
  }

  // 3b. EXPIRED but inside the grace window: still not reaped. The lease
  //     governs who may RECLAIM (cheap, reversible); destroying a billed VM is
  //     neither, so a partition that merely delays a renew must not cost a live
  //     run its sandbox.
  {
    const before = actionsLog.length
    orch.sweep(T + REAPER_TTL + 1)
    assert.equal(actionsLog.length, before, 'the grace beyond the lease must be real, not decorative')
    orch.sweep(T + REAPER_TTL + REAP_GRACE_MS - 1)
    assert.equal(actionsLog.length, before, 'still inside the grace window')
  }

  // 3c. Past expiry + grace: the sandbox is destroyed, once, with a liveness
  //     reason — and the CLAIM IS LEFT INTACT. Reaping a VM does not license
  //     revoking a claim: `expired` is reclaimable by anyone, `revoked` is
  //     terminal without an operator reset.
  {
    pageLog.length = 0
    actionsLog.length = 0
    const descriptions = orch.sweep(T + REAPER_TTL + REAP_GRACE_MS)
    // BOTH sb-live and sb1 are reaped here, and the second one is the point:
    // sb1's claim was made back in section 2, by a DIFFERENT run, and its lease
    // has long expired. That is precisely the cross-run reclamation the design
    // depends on — there is no long-lived orchestrator process, so a leak is
    // reclaimed by a LATER drive's sweep reading the shared, persisted store.
    // If this only ever reaped the current run's own sandbox it would reap
    // nothing that `drive.mjs`'s own teardown does not already handle.
    assert.deepEqual(
      actionsLog.slice().sort(),
      ['destroySandbox sb-live', 'destroySandbox sb1'].sort(),
      "every expired holder's sandbox must be destroyed, across runs",
    )
    assert.equal(pageLog.length, 2, 'one page per reaped holder')
    for (const [cls, text] of pageLog) {
      assert.equal(cls, 'reap', 'the page class names the reason class')
      assert.match(text, /claim-lease-expired/, 'the recorded reason must be liveness')
      assert.ok(!/spend/.test(text), 'the reason must never be spend')
    }
    assert.ok(
      descriptions.some((d) => /^reap sb-live /.test(d)),
      `the sweep must describe the reap, got: ${JSON.stringify(descriptions)}`,
    )
    const claim = orch.store.getRow('claims', 'claim:r-live')
    assert.equal(claim.revoked, false, 'the run must stay reclaimable — reaping a VM is not revoking a claim')
    assert.equal(claim.holder, 'sb-live', 'the claim row is left exactly as it was')
  }

  // 3d. Idempotent: one dead drive costs one `rm`, not one per sweep.
  {
    actionsLog.length = 0
    pageLog.length = 0
    orch.sweep(T + REAPER_TTL + REAP_GRACE_MS + 1)
    orch.sweep(T + REAPER_TTL + REAP_GRACE_MS + 2)
    assert.deepEqual(actionsLog, [], 'an already-reaped holder must not be destroyed again')
    assert.deepEqual(pageLog, [], 'nor paged again')
  }

  // 3e. A REVOKED claim is never reaped. Revocation is an operator act with its
  //     own teardown; the reaper must not second-guess it.
  {
    const revokedClaim = { ...tryClaim(undefined, { runId: 'r-rev', claimant: 'sb-rev', ttlMs: 1, now: T }).row, revoked: true }
    orch.store.setRow('claims', 'claim:r-rev', revokedClaim)
    actionsLog.length = 0
    orch.sweep(T + REAPER_TTL + REAP_GRACE_MS + 3)
    assert.deepEqual(actionsLog, [], 'a revoked claim must never be reaped')
  }

  // 3f. The deleted subsystem stays deleted: a `budgets` row and overshooting
  //     spend are inert. Nothing reads the table, so nothing can act on it.
  {
    orch.store.setRow('budgets', 'r-live', { capTokens: 1 })
    actionsLog.length = 0
    pageLog.length = 0
    orch.sweep(T + REAPER_TTL + REAP_GRACE_MS + 4)
    assert.deepEqual(actionsLog, [], 'a budgets row must be inert — the cap is deleted, not merely unset')
    assert.deepEqual(pageLog, [], 'and must raise no page')
  }

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
  // Quiescence predicate: poll until the persister has finished loading the
  // pre-restart state back into the fresh store (the revoked r1 claim is the
  // last write from the previous run, so its presence means the load landed).
  await until(
    () => orch.store.getRow('claims', 'claim:r-live')?.holder === 'sb-live',
    'the persisted store to finish loading after restart',
  )
  // The ledger survives the cap's deletion AND a restart. It is a record now,
  // never an authority — which is exactly why it still has to persist.
  assert.equal(totalSpent(orch.store.getTable('spend'), 'r1'), 120, 'the spend ledger must survive a restart')
  assert.equal(
    orch.store.getRow('claims', 'claim:r-live').revoked,
    false,
    'a reaped run must come back RECLAIMABLE, not revoked — this is what makes the reaper safe to run unattended',
  )
  // …and the reaper's in-process latch does NOT survive the restart, by design.
  // A restarted orchestrator may re-issue one `rm` for an already-destroyed VM,
  // which is a no-op at the provider — the cheap direction of the two.
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
