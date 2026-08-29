// fleet/orchestrator.mjs — the one authority in a fleet run.
//
// It owns three things and nothing else:
//   1. the ws-server every sandbox syncs its MergeableStore through, gated at
//      the handshake by the short-TTL store token minted in `tokens.mjs`;
//   2. the guard sweep — the server re-evaluates every row that changed since
//      its last-known-good snapshot against `guardViolation` and converges
//      unauthorized writes away (delRow-then-setRow of the good row);
//   3. out-of-band VM reclamation — the claim-lease reaper, which destroys a
//      sandbox whose claim lease has expired with no drive heartbeat. The
//      trigger is LIVENESS, never spend: the right reason to destroy a VM is
//      "nothing is using it". (The per-run token cap and its spend supervisor
//      were deleted in #400 / Amendment 4: the cap never fired in twelve runs,
//      metered dollars when the scarce resource is the rate window, and was
//      calibrated from size means. The `spend` ledger survives as observation.)
//
// It never shells out. Every side effect that leaves this process — revoking
// and parking a run in the operator's world, destroying a sandbox VM, paging a
// human — is an injected `actions` callback, so the whole authority path is
// testable with no VMs and no credentials in reach.
import fs from 'node:fs'
import path from 'node:path'
import { WebSocketServer, WebSocket } from 'ws'
import { createMergeableStore } from 'tinybase'
import { createWsServer } from 'tinybase/synchronizers/synchronizer-ws-server'
import { createWsSynchronizer } from 'tinybase/synchronizers/synchronizer-ws-client'
import { createSqlite3Persister } from 'tinybase/persisters/persister-sqlite3'
import { claimState, guardViolation } from './store.mjs'
import { mintToken, verifyToken } from './tokens.mjs'

// Every fleet client — sandboxes and the orchestrator's own local client —
// joins this one ws-server path, which is also the persister key.
export const FLEET_PATH = 'fleet'

// The writer id the orchestrator signs its own writes with. It is the only id
// permitted the §W1b supervisory exemption.
export const SUPERVISOR_ID = 'orchestrator'

// The orchestrator's loopback token never leaves this process (it is minted
// here and handed straight to its own in-process WebSocket), so its lifetime
// is the process lifetime rather than the short sandbox TTL.
const LOOPBACK_TOKEN_TTL_MS = 365 * 24 * 60 * 60 * 1000

// Upper bound on how long `stop()` waits for the server client to catch up
// before writing through anyway. A stalled peer delays shutdown, never blocks it.
const FLUSH_TIMEOUT_MS = 2000

// How long past a claim's lease expiry the reaper waits before destroying the
// holder's sandbox. The lease governs RECLAIM (cheap, reversible); destroying a
// billed VM is neither, so a partition that merely delays a renew must not cost
// a live run its sandbox. One further lease-ish period is the margin.
export const REAP_GRACE_MS = 10 * 60_000

// A run in one of these has finished, and `driveOne`'s own teardown already
// destroyed its sandbox. Its claim merely aged out; there is nothing to reclaim.
export const TERMINAL_RUN_STATUSES = ['gate-green', 'folded', 'parked', 'revoked']

const clone = (value) => structuredClone(value)
const sameRow = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

// --- persistence -----------------------------------------------------------
// SQLite via the Node built-in `node:sqlite` driver — no npm dependency beyond
// tinybase + ws. TinyBase's sqlite3 persister drives any object exposing
// node-sqlite3's `all(sql, params, cb)` shape, so a ~15-line adapter is the
// whole bridge.
//
// `node:sqlite` requires Node >= 22.5 (present in Node 22 LTS and 24), and a
// missing driver is a hard startup error rather than a downgrade. The JSON
// file persister was measured as the fallback and dropped: its async read on
// restart races the first client's sync, so ~40% of restarts came back with an
// empty ledger. A silently lossy store under the one component that holds
// spend authority and claim state is strictly worse than refusing to start.

const sqliteAdapter = (db) => ({
  all: (sql, params = [], callback) => {
    try {
      const statement = db.prepare(sql)
      // TinyBase emits `$1`-style placeholders; `node:sqlite` binds those as
      // named parameters, so positional params become a `{1: …, 2: …}` object.
      const bound = params.length ? [Object.fromEntries(params.map((value, i) => [String(i + 1), value]))] : []
      let rows
      try {
        rows = statement.all(...bound)
      } catch (error) {
        if (!/does not return data/i.test(error.message)) throw error
        statement.run(...bound)
        rows = []
      }
      callback(null, rows)
    } catch (error) {
      callback(error)
    }
  },
  // The persister uses these only to watch for out-of-band writes to the
  // database file. Nothing else writes it, so there is nothing to listen for.
  on: () => {},
  off: () => {},
})

const loadSqlite = async () => {
  try {
    return (await import('node:sqlite')).DatabaseSync
  } catch {
    throw new Error(
      `fleet orchestrator requires the node:sqlite built-in (Node >= 22.5); this is Node ${process.version}`,
    )
  }
}

// A path id is attacker-influenced (it is the ws URL path), so it never
// reaches the filesystem unsanitized.
const safeName = (pathId) => pathId.replace(/[^A-Za-z0-9_-]/g, '_') || 'default'

// --- writer attribution ----------------------------------------------------
// The store carries no writer column, so the sweep derives the writer from the
// row itself, exactly as the schema defines it: spend rows are namespaced by
// writer id, and a claim write names its own holder. A write that names nobody
// (a deletion, or a claim assigned to someone else) attributes to `''`, which
// no held claim matches — so it fails the guard and is converged away.
const inferWriter = (table, rowId, newRow) => {
  if (table === 'spend') return rowId.split(':')[0]
  if (table === 'claims') return newRow?.holder ?? ''
  return ''
}

export const startOrchestrator = async ({ port, dbDir, tokenRecords, actions, clock = Date.now }) => {
  // Resolved before anything is opened or bound, so an unsupported Node never
  // gets far enough to look like a working orchestrator — and never leaves a
  // half-started server holding the port.
  const DatabaseSync = await loadSqlite()

  fs.mkdirSync(dbDir, { recursive: true })

  const { token: loopbackToken, record: loopbackRecord } = mintToken({
    sandboxId: SUPERVISOR_ID,
    ttlMs: LOOPBACK_TOKEN_TTL_MS,
    now: clock(),
  })

  const wss = new WebSocketServer({
    port,
    // The token gate. `tokenRecords` is read by reference on every handshake so
    // tokens minted after startup (a sandbox provisioned mid-run) are honored
    // without restarting the server.
    verifyClient: ({ req }) => {
      const token = new URL(req.url, 'http://localhost').searchParams.get('token')
      if (!token) return false
      return verifyToken(token, [...tokenRecords, loopbackRecord], clock()) !== null
    },
  })
  await new Promise((resolve, reject) => {
    wss.once('listening', resolve)
    wss.once('error', reject)
  })
  const boundPort = wss.address().port

  const openDbs = []
  const persisters = []
  const createPersisterForPath = async (pathId) => {
    const serverStore = createMergeableStore(`server:${pathId}`)
    const db = new DatabaseSync(path.join(dbDir, `${safeName(pathId)}.db`))
    openDbs.push(db)
    const persister = createSqlite3Persister(serverStore, sqliteAdapter(db), { mode: 'json' })
    persisters.push(persister)
    return persister
  }

  const wsServer = createWsServer(wss, createPersisterForPath)

  // The orchestrator joins its own server as an ordinary local client. That is
  // what makes the sweep honest: it judges the same merged view every sandbox
  // sees, over the same wire, rather than a privileged side channel.
  const store = createMergeableStore(SUPERVISOR_ID)
  const socket = new WebSocket(`ws://127.0.0.1:${boundPort}/${FLEET_PATH}?token=${loopbackToken}`)
  const synchronizer = await createWsSynchronizer(store, socket)
  await synchronizer.startSync()

  // Last-known-good: the merged view as of the end of the previous sweep. Rows
  // that match it are, by definition, already authorized.
  let lastKnownGood = clone(store.getTables())

  // #190: a supervisor refusal (park refused, revoke refused, missing runs
  // row) used to `continue` with no memory, so every subsequent sweep
  // re-detected the same overshoot and re-paged it — a page storm. Each
  // distinct refusal (keyed by scope + kind) pages exactly once for the
  // orchestrator's lifetime.
  const pagedRefusals = new Set()

  // Reaped holders, so one dead drive costs one `rm` and not one per sweep.
  // In-process by design, like `pagedRefusals`: see the reaper's own note.
  const reapedHolders = new Set()

  const convergeAway = (table, rowId, goodRow) => {
    store.delRow(table, rowId)
    if (goodRow !== undefined) store.setRow(table, rowId, goodRow)
  }

  const sweep = (now) => {
    const descriptions = []
    const current = store.getTables()

    const pageOnce = (key, cls, text) => {
      if (pagedRefusals.has(key)) return
      pagedRefusals.add(key)
      actions.page(cls, text)
    }

    // --- guard pass --------------------------------------------------------
    const convergedAway = []
    for (const table of new Set([...Object.keys(lastKnownGood), ...Object.keys(current)])) {
      const goodTable = lastKnownGood[table] ?? {}
      const currentTable = current[table] ?? {}
      for (const rowId of new Set([...Object.keys(goodTable), ...Object.keys(currentTable)])) {
        const goodRow = goodTable[rowId]
        const newRow = currentTable[rowId]
        if (sameRow(goodRow, newRow)) continue
        const why = guardViolation(table, rowId, newRow, goodRow, inferWriter(table, rowId, newRow), now)
        if (!why) continue
        convergeAway(table, rowId, goodRow)
        const description = `converge-away ${table} ${rowId} (${why})`
        descriptions.push(description)
        convergedAway.push(description)
      }
    }
    if (convergedAway.length > 0) {
      actions.page('security', `guard sweep converged away ${convergedAway.length}: ${convergedAway.join('; ')}`)
    }

    // --- claim-lease reaper ------------------------------------------------
    // The one thing the deleted spend supervisor did that nothing else does:
    // OUT-OF-BAND VM RECLAMATION. `destroySandbox` reached this action surface
    // at exactly one site — inside that spend pass — while every other destroy
    // path is `drive.mjs`'s own teardown, running inside the drive process. So
    // a drive that is killed, crashes, or dies mid-run left a billed VM alive
    // with nothing left to reclaim it. `provisionRun` issues a bare
    // `ssh exe.dev "cp <golden> fleet-<runId>"`: there is NO provider-side TTL
    // (the `ttlMs` nearby is the store-token lease, not a VM lifetime), so
    // "alive" means alive until someone runs `rm`.
    //
    // THE TRIGGER IS LIVENESS, NEVER SPEND. The right reason to destroy a VM is
    // "nothing is using it", never "it spent too much" — a cap says nothing
    // about whether the work is still running, and a run that is merely
    // expensive is the operator's call, not the orchestrator's.
    //
    // The predicate is over rows that already exist: a claim's lease IS the
    // drive's heartbeat (a live drive renews it, `tryRenew`), so an expired
    // lease already means "no drive heartbeat for a lease period". No new
    // table, no new timer, no new subsystem.
    //
    // WHAT THIS CAN AND CANNOT PROMISE. There is no long-lived orchestrator
    // process — `drive.mjs` starts one per drive, in-process — so the sweep
    // that would reap a leak dies with the drive that caused it. What saves the
    // reclamation is that `dbDir` is SHARED across runs (`/tmp/fleet-orch-live`)
    // and persisted to SQLite, so the dead run's claim row is still there when
    // the NEXT drive's orchestrator loads the store, and its first sweep reaps
    // the orphan. Reclamation is therefore bounded by **the next drive start**,
    // not by one lease period. A concurrent sibling drive reaps sooner, since
    // its sweep is already running. If no further run is ever launched, nothing
    // reaps — which is why `actions.destroySandbox` stays operator-reachable.
    //
    // GRACE BEYOND THE LEASE, deliberately. The lease governs who may RECLAIM a
    // run — a cheap, reversible act. Destroying a VM is neither, so a partition
    // that merely delays a renew must not cost a live run its sandbox. The
    // reaper waits a further REAP_GRACE_MS past expiry.
    //
    // Idempotence is in-process (`reapedHolders`), the same shape as
    // `pagedRefusals`. A restarted orchestrator may re-issue one `rm` for an
    // already-destroyed VM, which is a no-op at the provider — the cheap
    // direction of the two.
    for (const [claimId, claimRow] of Object.entries(store.getTable('claims'))) {
      const holder = claimRow.holder
      if (!holder || claimRow.revoked) continue
      if (reapedHolders.has(holder)) continue
      if (claimState(claimRow, now) !== 'expired') continue
      if (now < claimRow.leaseExpiresAt + REAP_GRACE_MS) continue

      // AN EXPIRED LEASE IS NOT ENOUGH, and reading it as enough was the
      // defect. NOTHING clears a claim when a run finishes — `shim.mjs` only
      // stops its renew timer — so EVERY successfully completed run leaves a
      // claim that expires `ttlMs` (4h) later and then sits in the shared,
      // persisted db-dir forever. Reaping on expiry alone therefore means the
      // next drive tries to `rm` every run in the history of that db-dir: one
      // failing ssh and one page each, growing without bound, all of them for
      // VMs that teardown destroyed correctly.
      //
      // The run's own status is the discriminator, and it already exists. A run
      // that reached a TERMINAL status is finished and its sandbox is gone; a
      // run still `pending`/`claimed`/`running` with a dead lease is the actual
      // orphan — a drive that died without ever writing a terminal status.
      const runRow = store.getRow('runs', claimRow.runId)
      if (!store.hasRow('runs', claimRow.runId)) {
        // A claim with no runs row: the #190 ghost shape. We cannot tell
        // whether anything is using that VM, and destroying is irreversible, so
        // refuse and page ONCE — the same posture the old supervisor took.
        pageOnce(`reap-no-run:${claimId}`, 'security',
          `reap refused for ${claimId}: no runs row for ${claimRow.runId} — leaving the sandbox untouched`)
        continue
      }
      if (TERMINAL_RUN_STATUSES.includes(runRow.status)) continue

      // The claim row is left exactly as it is: `expired` is reclaimable by
      // anyone, and revoking it would be a destructive second act (revoked
      // never comes back without an operator reset) that reaping a VM does not
      // license. The sandbox goes; the run stays reclaimable.
      reapedHolders.add(holder)
      const why = `claim-lease-expired ${claimId} (no drive heartbeat since ${claimRow.leaseExpiresAt})`
      descriptions.push(`reap ${holder} ${why}`)
      actions.page('reap', `${holder} ${why}`)
      actions.destroySandbox(holder)
    }

    // Everything standing at the end of a sweep — including the orchestrator's
    // own writes above — is authorized, and becomes the next baseline.
    lastKnownGood = clone(store.getTables())
    return descriptions
  }

  // A liveness beacon and nothing more. It must NEVER touch `lastKnownGood`:
  // heartbeats fire on a timer, so a sandbox's unauthorized write frequently
  // lands between one sweep and the next heartbeat. Re-baselining here would
  // promote that unjudged row into the authorized snapshot, and the following
  // sweep would skip it at the `sameRow` short-circuit without ever putting it
  // to `guardViolation` — permanently laundering it. Only `sweep` may advance
  // the baseline, because only `sweep` has judged what it is blessing.
  //
  // Leaving the baseline stale costs nothing: the heartbeat row is judged like
  // any other on the next sweep, and `guardViolation` has no `meta` branch, so
  // it falls through to `null` and is never converged away.
  const heartbeat = (now) => {
    store.setRow('meta', 'heartbeat', { at: now })
  }

  const stop = async () => {
    // Durability at the tail of a run is made explicit here rather than left to
    // auto-save timing. Measured without it: a write immediately followed by
    // stop() was lost 5/5 times, because the ws round-trip carrying it had not
    // reached the server client yet. Pushing (`synchronizer.save`) is not on its
    // own enough either — that resolves when the message is *sent*, not applied
    // — so each server persister is waited to convergence before it writes
    // through. The deadline uses wall time deliberately: `clock` is the
    // orchestrator's logical clock (frozen under test) and is an input to
    // decisions, never to timeouts.
    await synchronizer.save()
    const deadline = Date.now() + FLUSH_TIMEOUT_MS
    for (const persister of persisters) {
      const serverStore = persister.getStore()
      while (Date.now() < deadline && JSON.stringify(serverStore.getTables()) !== JSON.stringify(store.getTables())) {
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      await persister.schedule(persister.save)
    }

    await synchronizer.stopSync()
    await synchronizer.destroy()
    await wsServer.destroy()
    for (const client of wss.clients) client.terminate()
    await new Promise((resolve) => wss.close(() => resolve()))
    for (const db of openDbs) {
      try {
        db.close()
      } catch {
        // Already closed by its persister; nothing to release.
      }
    }
    openDbs.length = 0
  }

  return { store, sweep, heartbeat, stop, port: boundPort }
}
