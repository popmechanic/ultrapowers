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

// --- transport liveness (#288) ----------------------------------------------
// tinybase's createWsSynchronizer resolves SILENTLY when the ws handshake
// fails: a connection refused AND a 401 handshake rejection both leave the
// socket at readyState CLOSED with no error ever thrown — so a run can
// execute end-to-end, invoke the engine, and finish, with zero of its store
// writes ever reaching the orchestrator. Every socket the shim opens goes
// through `connectOpenWs`, which resolves only an OPEN socket or rejects with
// a legible reason; nothing downstream is built on an unverified connection.
// `deliverAndClose` closes the matching gap on the way OUT: a socket that was
// open at connect time but died mid-run (the exact #288 shape) still has to
// get the terminal status write out via one rescue reconnect.

export const CONNECT_TIMEOUT_MS = 30_000
export const RENEW_CAP_MS = 5 * 60_000
export const FLUSH_TIMEOUT_MS = 5_000
export const FLUSH_SETTLE_MS = 250

/**
 * The renew cadence for a claim's TTL — normally a third of the TTL, but
 * capped at RENEW_CAP_MS so a long-TTL run still renews often enough to
 * notice a dropped connection well before its lease would expire. An
 * explicit override always wins.
 */
export const renewIntervalFor = (ttlMs, renewEveryMs) =>
  renewEveryMs ?? Math.min(Math.floor(ttlMs / 3), RENEW_CAP_MS)

/**
 * Resolve only an OPEN ws — never a socket mid-handshake, and never one
 * that's dead on arrival. Both known #288 failure shapes (connection refused,
 * 401 handshake rejection) surface here as a REJECTION with a legible reason,
 * instead of as a resolved-but-CLOSED socket a caller might sync against
 * anyway. A connection that never resolves either way (a TCP accept with no
 * HTTP upgrade ever sent) is bounded by `timeoutMs`.
 */
export const connectOpenWs = (url, { timeoutMs = CONNECT_TIMEOUT_MS, log = console.error } = {}) =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    const timer = setTimeout(() => {
      try {
        ws.terminate()
      } catch {}
      reject(new Error(`ws connect timeout after ${timeoutMs}ms`))
    }, timeoutMs)
    ws.once('open', () => {
      clearTimeout(timer)
      ws.on('close', (code) => log(`fleet: ws closed (code ${code})`))
      ws.on('error', (err) => log(`fleet: ws error — ${err?.message ?? err}`))
      resolve(ws)
    })
    ws.once('error', (err) => {
      clearTimeout(timer)
      reject(new Error(`ws connect failed: ${err?.message ?? err}`))
    })
    ws.once('close', (code) => {
      clearTimeout(timer)
      reject(new Error(`ws closed during connect (code ${code})`))
    })
  })

/** Save the store, then wait for the socket's write buffer to drain (or time out). */
export const flushSynchronizer = async (synchronizer, ws) => {
  // A request to a peer that cannot answer burns the synchronizer's full
  // request timeout (TinyBase docs: requestTimeoutSeconds, default 1 s) with
  // zero chance of delivery — the drive-test timer census counted these in
  // the dozens per file. Decline to ask a closed socket; the caller's
  // rescue-reconnect path (deliverAndClose) owns delivery in that state.
  if (ws.readyState !== WebSocket.OPEN) return
  await synchronizer.save()
  const deadline = Date.now() + FLUSH_TIMEOUT_MS
  while (Date.now() < deadline && ws.bufferedAmount > 0) await new Promise((r) => setTimeout(r, 25))
  await new Promise((r) => setTimeout(r, FLUSH_SETTLE_MS))
}

/**
 * Deliver whatever the store holds and tear down — the shim's ONLY exit path.
 *
 * If the socket the shim has been syncing over is still OPEN, flush over it.
 * If it has died since the last observation (the #288 shape: a mid-run drop
 * that leaves readyState CLOSED with no error the shim ever saw), the write
 * that matters most — the terminal status transition — is sitting unsynced in
 * local store state. One rescue reconnect, over the SAME store, is what gets
 * it out. A rescue that itself fails to connect or flush is logged and
 * reported as non-delivery; the caller's teardown still runs either way.
 */
export const deliverAndClose = async ({
  store,
  synchronizer,
  ws,
  url,
  openSocket = connectOpenWs,
  log = console.error,
}) => {
  if (ws.readyState === WebSocket.OPEN) {
    await flushSynchronizer(synchronizer, ws)
    synchronizer.stopSync()
    synchronizer.destroy()
    return true
  }
  synchronizer.stopSync()
  synchronizer.destroy()
  log('fleet: ws dead at publish — one rescue reconnect')
  try {
    const ws2 = await openSocket(url, { log })
    const sync2 = await createWsSynchronizer(store, ws2)
    await sync2.startSync()
    await flushSynchronizer(sync2, ws2)
    sync2.stopSync()
    sync2.destroy()
    return true
  } catch (error) {
    log(`fleet: publish rescue failed — ${error?.message ?? error}; run outcome not delivered`)
    return false
  }
}

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
  openSocket = connectOpenWs,
  log = console.error,
}) => {
  const renewInterval = renewIntervalFor(ttlMs, renewEveryMs)
  const claimRowId = `claim:${runId}`
  const url = withToken(wsUrl, token)

  let ws
  try {
    ws = await openSocket(url, { log })
  } catch (error) {
    return { status: 'no-store', delivered: false, error: String(error?.message ?? error) }
  }
  const store = createMergeableStore(sandboxId)
  let synchronizer = await createWsSynchronizer(store, ws)
  await synchronizer.startSync()

  // --- mid-run reconnect (#299) -----------------------------------------
  // A socket that dies mid-run turns every renew into a local no-op: the
  // orchestrator sees zero progress and, past heartbeatTimeoutMs, destroys
  // the sandbox under a still-running engine. The renew loop therefore
  // re-opens and re-syncs over the SAME store on drop detection — single
  // flight, retried on the next tick if it fails. The terminal rescue in
  // deliverAndClose stays as the backstop for a drop after the last tick.
  let reconnectPromise = null
  const tryReconnect = () => {
    if (reconnectPromise) return reconnectPromise
    reconnectPromise = (async () => {
      let ws2 = null
      try {
        ws2 = await openSocket(url, { log })
        const sync2 = await createWsSynchronizer(store, ws2)
        await sync2.startSync()
        try {
          synchronizer.stopSync()
          synchronizer.destroy()
        } catch {}
        try {
          ws.terminate()
        } catch {}
        ws = ws2
        synchronizer = sync2
        log('fleet: ws reconnected mid-run — sync restored')
        return true
      } catch (error) {
        // A socket that opened but whose sync-attach then threw must not leak:
        // over a multi-hour engine phase this path retries every renew tick,
        // and each orphaned-but-open socket would otherwise live to run end.
        if (ws2) {
          try {
            ws2.terminate()
          } catch {}
        }
        log(`fleet: mid-run reconnect failed — ${error?.message ?? error}; retrying at next renew`)
        return false
      } finally {
        reconnectPromise = null
      }
    })()
    return reconnectPromise
  }

  // --- initial claim ---------------------------------------------------
  const claimAttempt = tryClaim(store.getRow('claims', claimRowId), {
    runId,
    claimant: sandboxId,
    ttlMs,
    now: clock(),
  })
  if (claimAttempt.error) {
    const delivered = await deliverAndClose({ store, synchronizer, ws, url, openSocket, log })
    return { status: 'lost-claim', delivered }
  }
  store.setRow('claims', claimRowId, claimAttempt.row)
  const epoch = claimAttempt.row.epoch

  const writeStatus = makeWriteStatus(store, runId)
  writeStatus('claimed')

  // --- spend tracking — DELTAS, sampled per boundary --------------------
  // `readReportTokens()` is the run report's output-token TOTAL: it is
  // CUMULATIVE and rises over the life of the run. The ledger is the opposite
  // shape — `spend` is append-only and readers derive a run's spend by SUMMING
  // its rows (store.mjs `totalSpent`). Nothing is enforced against that total —
  // the per-run cap is deleted (#400) — but the ledger is still the run's spend
  // record, and a wrong-shaped row makes it a wrong record.
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
  let deadLogged = false
  const timer = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) {
      if (!deadLogged) {
        deadLogged = true
        log('fleet: ws connection lost mid-run — reconnecting')
      }
      void tryReconnect()
    } else {
      deadLogged = false
    }
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

  // Quiesce an in-flight reconnect so the deliver path never races a swap:
  // deliverAndClose reads `ws`/`synchronizer` at call time, and tearing down a
  // socket that is mid-replacement would drop the terminal write.
  if (reconnectPromise) await reconnectPromise.catch(() => {})

  if (claimLost) {
    writeStatus('parked')
    const delivered = await deliverAndClose({ store, synchronizer, ws, url, openSocket, log })
    return { status: 'failed', delivered }
  }

  if (outcome && outcome.gateGreen) {
    writeStatus('gate-green')
    const delivered = await deliverAndClose({ store, synchronizer, ws, url, openSocket, log })
    return { status: 'gate-green', delivered }
  }

  writeStatus('parked')
  const delivered = await deliverAndClose({ store, synchronizer, ws, url, openSocket, log })
  return { status: 'failed', delivered }
}
