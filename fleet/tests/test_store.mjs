import assert from 'node:assert/strict'
import { RUN_STATUSES, legalTransition, claimState, tryClaim, tryRenew, revoke,
         spendRowId, totalSpent, remaining, guardViolation } from '../store.mjs'

// lease lifecycle: liveness is never an input
const c1 = tryClaim(undefined, { runId: 'r1', claimant: 'sbA', ttlMs: 5000, now: 1000 })
assert.equal(c1.row.epoch, 1)
assert.equal(claimState(c1.row, 4000), 'held')
assert.equal(claimState(c1.row, 6001), 'expired')          // no write happened
assert.ok(tryClaim(c1.row, { runId: 'r1', claimant: 'sbB', ttlMs: 5000, now: 4000 }).error)
const c2 = tryClaim(c1.row, { runId: 'r1', claimant: 'sbB', ttlMs: 5000, now: 6001 })
assert.equal(c2.row.epoch, 2)                               // epoch bumps on reclaim
assert.ok(tryRenew(c2.row, { claimant: 'sbA', epoch: 1, ttlMs: 5000, now: 6100 }).error) // zombie rejected

// revoked is explicit-only, distinct from expired, never claimable
const r = revoke(c2.row)
assert.equal(claimState(r, 999999), 'revoked')
assert.ok(tryClaim(r, { runId: 'r1', claimant: 'sbC', ttlMs: 5000, now: 999999 }).error)
assert.ok(tryRenew(r, { claimant: 'sbB', epoch: 2, ttlMs: 5000, now: 6200 }).error)

// spend: append-only writer-namespaced rows; totals derived
assert.equal(spendRowId('sbA', 3), 'sbA:3')
const rows = { 'orch:1': { runId: 'r1', tokens: 100 }, 'sbA:1': { runId: 'r1', tokens: 50 },
               'sbA:2': { runId: 'r2', tokens: 9 } }
assert.equal(totalSpent(rows, 'r1'), 150)
assert.equal(remaining(200, rows, 'r1'), 50)

// guard: namespace, append-only, transitions, receipt pointer shape
assert.ok(guardViolation('spend', 'sbB:1', { runId: 'r1', tokens: 5 }, undefined, 'sbA', 0))
assert.equal(guardViolation('spend', 'sbA:9', { runId: 'r1', tokens: 5 }, undefined, 'sbA', 0), null)
assert.ok(guardViolation('spend', 'sbA:9', { runId: 'r1', tokens: 6 }, { runId: 'r1', tokens: 5 }, 'sbA', 0)) // append-only
assert.ok(guardViolation('runs', 'r1', { status: 'folded' }, { status: 'claimed' }, 'sbA', 0))
assert.equal(guardViolation('receipts', 'r1:gate', { verdict: 'PASS' }, undefined, 'sbA', 0),
             'receipt must be a git pointer (sha + path)')
assert.equal(guardViolation('receipts', 'r1:gate', { sha: 'abc', path: 'gate-receipt.json' }, undefined, 'sbA', 0), null)

// spend-overshoot edge: a park write must be legal even while the run is
// still 'pending' — the orchestrator can detect an overshoot before a
// sandbox ever advances the run to 'claimed'/'running'.
assert.equal(legalTransition('pending', 'parked'), true)

// the supervisory exemption (spec §W1b): orchestrator revoke of a HELD claim
const held = tryClaim(undefined, { runId: 'r3', claimant: 'sbA', ttlMs: 60000, now: 1000 }).row
const revokedRow = revoke(held)
assert.ok(guardViolation('claims', 'claim:r3', revokedRow, held, 'orch', 2000))                       // non-holder blocked
assert.equal(guardViolation('claims', 'claim:r3', revokedRow, held, 'orch', 2000, { supervisor: true }), null) // exemption
assert.ok(guardViolation('claims', 'claim:r3', held, revokedRow, 'orch', 2000, { supervisor: true })) // un-revoke still blocked

console.log('ALL TESTS PASSED')
