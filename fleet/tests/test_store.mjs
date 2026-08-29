import assert from 'node:assert/strict'
import { RUN_STATUSES, legalTransition, claimState, tryClaim, tryRenew, revoke,
         spendRowId, totalSpent, guardViolation } from '../store.mjs'

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
// `remaining`/`mayEnqueueSpend` are deleted with the per-run cap (#400). The
// ledger survives as a RECORD: totals are still folded from rows at read time,
// and nothing is enforced against them.

// guard: namespace, append-only, transitions, receipt pointer shape
assert.ok(guardViolation('spend', 'sbB:1', { runId: 'r1', tokens: 5 }, undefined, 'sbA', 0))
assert.equal(guardViolation('spend', 'sbA:9', { runId: 'r1', tokens: 5 }, undefined, 'sbA', 0), null)
assert.ok(guardViolation('spend', 'sbA:9', { runId: 'r1', tokens: 6 }, { runId: 'r1', tokens: 5 }, 'sbA', 0)) // append-only
assert.ok(guardViolation('runs', 'r1', { status: 'folded' }, { status: 'claimed' }, 'sbA', 0))
assert.equal(guardViolation('receipts', 'r1:gate', { verdict: 'PASS' }, undefined, 'sbA', 0),
             'receipt must be a git pointer (sha + path)')
assert.equal(guardViolation('receipts', 'r1:gate', { sha: 'abc', path: 'gate-receipt.json' }, undefined, 'sbA', 0), null)

// pending -> parked: this edge was WIDENED for the spend-overshoot case, which
// is now deleted (#400) — but it is still load-bearing on its own account,
// because `driveOne`'s neverClaimed path parks a run no sandbox ever claimed.
// Kept, with its real reason.
assert.equal(legalTransition('pending', 'parked'), true)
// boundary anchor: 'pending' must not have quietly gained any other outbound
// transition.
assert.equal(legalTransition('pending', 'running'), false)

// The §W1b supervisory exemption is DELETED with the spend pass that was its
// only caller (#400). The guard is now EXCEPTIONLESS: no writer may revoke a
// claim held by someone else, whoever it is. The reaper does not need it — it
// destroys an unused VM and deliberately leaves the claim reclaimable, rather
// than revoking (which is terminal without an operator reset).
const held = tryClaim(undefined, { runId: 'r3', claimant: 'sbA', ttlMs: 60000, now: 1000 }).row
const revokedRow = revoke(held)
assert.ok(guardViolation('claims', 'claim:r3', revokedRow, held, 'orch', 2000), 'non-holder revoke blocked')
// The old exemption's own call shape, now refused: an extra options argument
// cannot re-open the door, because there is no door.
assert.ok(guardViolation('claims', 'claim:r3', revokedRow, held, 'orch', 2000, { supervisor: true }),
  'no supervisory exemption survives')
assert.ok(guardViolation('claims', 'claim:r3', held, revokedRow, 'orch', 2000), 'un-revoke still blocked')
// The holder itself may still revoke its own claim.
assert.equal(guardViolation('claims', 'claim:r3', revokedRow, held, 'sbA', 2000), null)

console.log('ALL TESTS PASSED')
