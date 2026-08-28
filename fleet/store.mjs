// fleet/store.mjs — pure logic module. No I/O, no terminal code, no TinyBase
// imports: everything here operates on plain row objects so it can be shared
// by every fleet process (orchestrator, shim, driver) that talks to the same
// synced store. The TinyBase wiring lives in the runners.

// ---------------------------------------------------------------------------
// Table shapes (documentation-as-code; TinyBase tables are schemaless)
//
// runs:     rowId = runId (orchestrator-authored: `run-<n>`)
//           { planPath, sandboxId, status, branch }
//           + pullRequestUrl (driver-stamped after the run, #368: the PR the
//             orchestrator opened on the fetched branch; absent until then)
//           status: pending -> claimed -> running -> gate-green -> folded
//                   (parked and revoked reachable from any active state)
// claims:   rowId = `claim:<runId>` (one claim per run)
//           { runId, holder, leaseExpiresAt, epoch, revoked }
//           `revoked` is EXPLICIT-ONLY — nothing ever sets it on timeout.
// budgets:  rowId = scopeId (runId or docketId)  { capTokens }
// spend:    rowId = `<writerId>:<seq>` (writer-namespaced, APPEND-ONLY)
//           { runId, tokens, at }  — totals are always derived by readers.
// admission:      PLANNED (one-driver stage 3, #403) — rowId = `<writerId>:<seq>`
//                 (writer-namespaced, APPEND-ONLY, same shape as `spend`)
//                 { runId, waveIndex, decision, apiRetries, maxRetryDelayMs, at }
//                 Fed by N workers; a grow-only set, never a cell. Records only —
//                 `decision` is always `observed` in 0.3.0 (the gate is 0.3.1's).
// judgmentCalls:  PLANNED (one-driver stage 3, #403) — rowId = `<writerId>:<seq>`
//                 (writer-namespaced, APPEND-ONLY)
//                 { runId, taskId, kind, question, taken, rationale }
//                 The operator adjudicates these at the PR, so a lost one is a
//                 silently weakened receipt — which is exactly why it is a row.
// receipts: rowId = `<runId>:<kind>`  kind: gate | exam | fold
//           { sha, path, verdict }
//           sha+path are POINTERS INTO GIT (the authority); `verdict` is a
//           display hint only — never load-bearing.
//
// --- THE ROW/CELL AXIS RULE (read before adding any table) ------------------
//
// The convergence engine is TinyBase's MergeableStore, synced through the
// orchestrator's ws-server. TinyBase's own docs: "acts as a Conflict-Free
// Replicated Data Type (CRDT) ... using Hybrid Logical Clocks for causality
// tracking." Every value is stored as a stamp — [thing, hlc, hash] — and merge
// happens PER SLOT, where a slot is one `table.rowId.cellId`. On sync, the
// higher HLC stamp wins that slot. Deterministically, on every replica.
//
// That is correct behaviour, and it is why WHICH AXIS you put concurrency on
// decides whether data survives:
//
//   ROW AXIS   two writers, two rowIds -> two slots -> nothing to resolve.
//              BOTH SURVIVE. This is a union, i.e. a grow-only set; a total is
//              a fold over the rows at read time (see `totalSpent`).
//
//   CELL AXIS  two writers, one rowId+cellId -> one slot -> HLC picks one.
//              THE OTHER VALUE IS DISCARDED, not merged.
//
// The CRDT does not know your number is a sum. It converges the slot, which is
// its job. **If a sum lives in one slot, correct convergence destroys addends.**
//
// So:  STATUS IS A REGISTER (cell, LWW — `runs.status`, `claims.holder`).
//      EVIDENCE IS A SET    (row, union — `spend`, and anything that accumulates).
//      TOTALS ARE FOLDS     (derived by readers, never stored in a cell).
//
// `spend` is the worked example and `guardViolation` enforces it: the rowId must
// start with `<writerId>:` (two writers CANNOT pick the same key) and a row that
// exists cannot be rewritten (append-only). Together those give safety by
// construction rather than by care — and idempotence for free, since a duplicate
// delivery after a reconnect is refused as already-existing. They also sidestep
// clock skew: HLC uses Date.now(), so across VMs "who wins" depends on wall
// clocks — but on the row axis nothing competes, so skew cannot cost data. On the
// cell axis it can, which is why `runs.status` is fenced by `legalTransition`
// instead of trusted to stamps.
//
// `runs.reportedTokens` is the counter-example kept deliberately in view: an
// accumulated number in a CELL. That is why a `reported == ledger` check has to
// exist at all — one quantity maintained two ways, then reconciled. Under the
// one-driver port both sides come from the driver reading the same envelope, so
// the check degenerates to comparing a value to itself (see the one-driver spec
// §9). Do not add another cell like it.
//
// THREE LAYERS, THREE MERGES — do not cross them (CLAUDE.md §Wayfinding):
//   file content -> Manyana        (merges VALUES; never LWW a weave payload)
//   run evidence -> TinyBase rows  (union)
//   current status -> TinyBase cells (LWW)
// ---------------------------------------------------------------------------

export const RUN_STATUSES = ['pending', 'claimed', 'running', 'gate-green', 'folded', 'parked', 'revoked']

const LEGAL = {
  pending: ['claimed', 'revoked', 'parked'], // 'parked' too: a spend overshoot can be detected before a sandbox ever claims the run
  claimed: ['running', 'parked', 'revoked', 'pending'], // -> pending on lease expiry reclaim
  running: ['gate-green', 'parked', 'revoked'],
  'gate-green': ['folded', 'parked'],
  folded: [],
  parked: ['pending', 'revoked'], // operator drains a park back to pending
  revoked: [],
}

export const legalTransition = (from, to) => (LEGAL[from] ?? []).includes(to)

// --- claims ----------------------------------------------------------------
// The one rule everything hangs on: claim state is a PURE FUNCTION of the row
// and the clock. Socket liveness is not an input and must never become one.

export const claimState = (row, now) => {
  if (!row || row.holder === undefined) return 'free'
  if (row.revoked) return 'revoked'
  if (now >= row.leaseExpiresAt) return 'expired' // reclaimable; NOT revoked
  return 'held'
}

// A claim attempt. Returns the new row or {error}. `expired` is claimable by
// anyone (epoch increments so the stale holder's renews become detectable);
// `revoked` is claimable by NO ONE without an explicit operator reset.
export const tryClaim = (row, { runId, claimant, ttlMs, now }) => {
  const state = claimState(row, now)
  if (state === 'held' && row.holder !== claimant) return { error: `held by ${row.holder} until ${row.leaseExpiresAt}` }
  if (state === 'revoked') return { error: 'revoked — operator reset required' }
  const epoch = (row?.epoch ?? 0) + 1
  return { row: { runId, holder: claimant, leaseExpiresAt: now + ttlMs, epoch, revoked: false } }
}

// Renew keeps the SAME epoch — a renew carrying a stale epoch is the
// signature of a zombie holder (claimed-over after its lease expired).
export const tryRenew = (row, { claimant, epoch, ttlMs, now }) => {
  const state = claimState(row, now)
  if (state === 'revoked') return { error: 'revoked' }
  if (state !== 'held' || row.holder !== claimant || row.epoch !== epoch)
    return { error: `stale renew (state=${state} holder=${row?.holder} epoch=${row?.epoch} vs ${epoch})` }
  return { row: { ...row, leaseExpiresAt: now + ttlMs } }
}

export const revoke = (row) => ({ ...row, revoked: true })

// --- spend ledger ----------------------------------------------------------

export const spendRowId = (writerId, seq) => `${writerId}:${seq}`

export const totalSpent = (spendRows, runId) =>
  Object.values(spendRows).filter((r) => r.runId === runId).reduce((s, r) => s + r.tokens, 0)

export const remaining = (capTokens, spendRows, runId) => capTokens - totalSpent(spendRows, runId)

// Advisory pre-check (a sandbox asks before spending); authoritative answer is
// always the post-sync ledger sum — overshoot is detected, not prevented.
export const mayEnqueueSpend = (capTokens, spendRows, runId, tokens) =>
  remaining(capTokens, spendRows, runId) >= tokens

// --- merge guard -----------------------------------------------------------
// Row-level write authorization, evaluated by the server against its own
// synced store. Returns null if allowed, else a reason string.
//
// `opts.supervisor` (default false) is the §W1b supervisory exemption: it
// permits a revoke write on a HELD claim by a non-holder — the orchestrator's
// §W1c hard action to pull a run out from under a stuck/misbehaving sandbox.
// It skips ONLY the "held by someone else" rejection, and ONLY for a revoke
// write (`newRow.revoked === true && !oldRow.revoked`). The un-revoke check
// remains unconditional — supervisor or not, revoked never comes back.
export const guardViolation = (table, rowId, newRow, oldRow, writerId, now, opts = {}) => {
  const { supervisor = false } = opts
  if (table === 'spend') {
    if (!rowId.startsWith(`${writerId}:`)) return `spend row ${rowId} outside writer namespace ${writerId}`
    if (oldRow) return `spend rows are append-only (${rowId} exists)`
    return null
  }
  if (table === 'claims') {
    if (oldRow?.revoked && !newRow?.revoked) return 'cannot un-revoke'
    const state = claimState(oldRow, now)
    const isRevokeWrite = newRow?.revoked === true && !oldRow?.revoked
    const supervisorExempt = supervisor && isRevokeWrite
    if (state === 'held' && oldRow.holder !== writerId && !supervisorExempt)
      return `claim held by ${oldRow.holder}, writer is ${writerId}`
    if (newRow && newRow.holder !== writerId && !newRow.revoked) return `writer ${writerId} cannot assign claim to ${newRow.holder}`
    return null
  }
  if (table === 'runs') {
    if (oldRow && newRow && oldRow.status !== newRow.status && !legalTransition(oldRow.status, newRow.status))
      return `illegal transition ${oldRow.status} -> ${newRow.status}`
    return null
  }
  if (table === 'receipts') {
    if (newRow && (!newRow.sha || !newRow.path)) return 'receipt must be a git pointer (sha + path)'
    return null
  }
  return null
}
