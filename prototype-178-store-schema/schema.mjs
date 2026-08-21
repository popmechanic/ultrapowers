// PROTOTYPE (#178) — pure logic module. No I/O, no terminal code, no TinyBase
// imports: everything here operates on plain row objects so it can be lifted
// into the real fleet module later. The TinyBase wiring lives in the runners.

// ---------------------------------------------------------------------------
// Table shapes (documentation-as-code; TinyBase tables are schemaless)
//
// runs:     rowId = runId (orchestrator-authored: `run-<n>`)
//           { planPath, sandboxId, status, branch }
//           status: pending -> claimed -> running -> gate-green -> folded
//                   (parked and revoked reachable from any active state)
// claims:   rowId = `claim:<runId>` (one claim per run)
//           { runId, holder, leaseExpiresAt, epoch, revoked }
//           `revoked` is EXPLICIT-ONLY — nothing ever sets it on timeout.
// budgets:  rowId = scopeId (runId or docketId)  { capTokens }
// spend:    rowId = `<writerId>:<seq>` (writer-namespaced, APPEND-ONLY)
//           { runId, tokens, at }  — totals are always derived by readers.
// receipts: rowId = `<runId>:<kind>`  kind: gate | exam | fold
//           { sha, path, verdict }
//           sha+path are POINTERS INTO GIT (the authority); `verdict` is a
//           display hint only — never load-bearing (finding F6, see close-out).
// ---------------------------------------------------------------------------

export const RUN_STATUSES = ['pending', 'claimed', 'running', 'gate-green', 'folded', 'parked', 'revoked']

const LEGAL = {
  pending: ['claimed', 'revoked'],
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
// synced store. Returns null if allowed, else a reason string. The plain
// ws-server cannot pre-strip; the runner demonstrates converge-away instead.

export const guardViolation = (table, rowId, newRow, oldRow, writerId, now) => {
  if (table === 'spend') {
    if (!rowId.startsWith(`${writerId}:`)) return `spend row ${rowId} outside writer namespace ${writerId}`
    if (oldRow) return `spend rows are append-only (${rowId} exists)`
    return null
  }
  if (table === 'claims') {
    if (oldRow?.revoked && !newRow?.revoked) return 'cannot un-revoke'
    const state = claimState(oldRow, now)
    if (state === 'held' && oldRow.holder !== writerId) return `claim held by ${oldRow.holder}, writer is ${writerId}`
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
