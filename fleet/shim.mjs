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

  // --- spend tracking — idempotent per boundary -------------------------
  // Sampled at every renew boundary and once more at run resolution. A
  // reading identical to the last one recorded is a no-op: spend rows are
  // append-only, so re-observing the same cumulative total must never
  // produce a duplicate row.
  let lastSpentTokens = null
  let spendSeq = 0
  const maybeAppendSpend = () => {
    const t = typeof readReportTokens === 'function' ? readReportTokens() : null
    if (t === null || t === undefined || t === lastSpentTokens) return
    spendSeq += 1
    store.setRow('spend', spendRowId(sandboxId, spendSeq), { runId, tokens: t, at: clock() })
    lastSpentTokens = t
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
