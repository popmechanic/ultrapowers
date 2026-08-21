// fleet/shim.mjs — the sandbox-side run client. Connects to the orchestrator's
// synced store over ws (or, in isolation tests, a bare relay), claims the run,
// keeps the lease alive with periodic renews, invokes the run, and reports the
// outcome (status transition + spend) back onto the store. Meets the
// orchestrator only over the ws protocol — no dependency on T3 internals.
import WebSocket from 'ws'
import { createMergeableStore } from 'tinybase'
import { createWsSynchronizer } from 'tinybase/synchronizers/synchronizer-ws-client'
import { tryClaim, tryRenew, spendRowId, legalTransition } from './store.mjs'

const withToken = (wsUrl, token) => `${wsUrl}${wsUrl.includes('?') ? '&' : '?'}token=${token}`

// Writes runs.<runId>.status only when the transition is legal from whatever
// status is currently synced — a stale/unsynced runs row (or one already at
// the target status) is a silent no-op rather than a crash.
const makeWriteStatus = (store, runId) => (status) => {
  const row = store.getRow('runs', runId)
  if (!row || row.status === status) return
  if (!legalTransition(row.status, status)) return
  store.setRow('runs', runId, { ...row, status })
}

export const runShim = async ({
  wsUrl,
  token,
  sandboxId,
  runId,
  ttlMs,
  invokeRun,
  readReportTokens,
  clock = Date.now,
  renewEveryMs,
}) => {
  const renewInterval = renewEveryMs ?? Math.floor(ttlMs / 3)
  const claimRowId = `claim:${runId}`

  const store = createMergeableStore(sandboxId)
  const synchronizer = await createWsSynchronizer(store, new WebSocket(withToken(wsUrl, token)))
  await synchronizer.startSync()

  const teardown = () => {
    synchronizer.stopSync()
    synchronizer.destroy()
  }

  // --- initial claim ---------------------------------------------------
  const claimAttempt = tryClaim(store.getRow('claims', claimRowId), {
    runId,
    claimant: sandboxId,
    ttlMs,
    now: clock(),
  })
  if (claimAttempt.error) {
    teardown()
    return { status: 'lost-claim' }
  }
  store.setRow('claims', claimRowId, claimAttempt.row)
  const epoch = claimAttempt.row.epoch

  const writeStatus = makeWriteStatus(store, runId)
  writeStatus('claimed')

  // --- spend tracking — DELTAS, sampled per boundary --------------------
  // `readReportTokens()` is the run report's output-token TOTAL: it is
  // CUMULATIVE and rises over the life of the run. The ledger is the opposite
  // shape — `spend` is append-only and readers derive a run's spend by SUMMING
  // its rows (store.mjs `totalSpent`, feeding `remaining`/`mayEnqueueSpend`).
  //
  // So a row must carry the DELTA since the last sample, never the raw
  // reading. Appending raw cumulative readings of 1000, 3000, 7000 would sum
  // to 11000 for a run that actually spent 7000, and the orchestrator would
  // park live runs long before they reached their cap.
  //
  // Sampling at every renew boundary (rather than once at resolution) is what
  // makes an over-spending run visible to the budget check WHILE it runs; the
  // delta keeps that sampling arithmetically sound. A delta of zero — the same
  // total observed twice — appends nothing, so re-observation is idempotent. A
  // negative delta (a report that reset or rolled back) is likewise skipped:
  // the ledger only ever moves forward.
  let lastReportedTokens = 0
  let spendSeq = 0
  const maybeAppendSpend = () => {
    const t = typeof readReportTokens === 'function' ? readReportTokens() : null
    if (typeof t !== 'number' || !Number.isFinite(t)) return
    const delta = t - lastReportedTokens
    if (delta <= 0) return
    spendSeq += 1
    store.setRow('spend', spendRowId(sandboxId, spendSeq), { runId, tokens: delta, at: clock() })
    lastReportedTokens = t
  }

  // --- renew loop ---------------------------------------------------------
  // A renew that fails (stale epoch, expired-and-reclaimed, or revoked) means
  // this sandbox no longer legitimately holds the run. Stop renewing
  // immediately; the outcome resolved below is 'failed' since invokeRun has
  // already started by the time any renew can fail.
  let claimLost = false
  const timer = setInterval(() => {
    const row = store.getRow('claims', claimRowId)
    const result = tryRenew(row, { claimant: sandboxId, epoch, ttlMs, now: clock() })
    if (result.error) {
      claimLost = true
      clearInterval(timer)
      return
    }
    store.setRow('claims', claimRowId, result.row)
    maybeAppendSpend()
  }, renewInterval)

  // --- run ------------------------------------------------------------------
  writeStatus('running')
  let outcome
  try {
    outcome = await invokeRun()
  } catch {
    outcome = { gateGreen: false }
  }
  clearInterval(timer)
  maybeAppendSpend()

  if (claimLost) {
    writeStatus('parked')
    teardown()
    return { status: 'failed' }
  }

  if (outcome && outcome.gateGreen) {
    writeStatus('gate-green')
    teardown()
    return { status: 'gate-green' }
  }

  writeStatus('parked')
  teardown()
  return { status: 'failed' }
}
