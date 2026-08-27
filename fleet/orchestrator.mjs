// fleet/orchestrator.mjs — the one authority in a fleet run.
//
// It owns three things and nothing else:
//   1. the ws-server every sandbox syncs its MergeableStore through, gated at
//      the handshake by the short-TTL store token minted in `tokens.mjs`;
//   2. the guard sweep — the server re-evaluates every row that changed since
//      its last-known-good snapshot against `guardViolation` and converges
//      unauthorized writes away (delRow-then-setRow of the good row);
//   3. spend authority — overshoot is DETECTED, never prevented, so the
//      orchestrator is the thing that pulls a run out from under a sandbox
//      that blew its cap.
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
import { guardViolation, revoke, totalSpent } from './store.mjs'
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

    // --- spend pass --------------------------------------------------------
    // Authoritative total is always the post-sync ledger sum. A cap that is
    // merely reached is fine; only an overshoot is an incident.
    const spendRows = store.getTable('spend')
    for (const scopeId of Object.keys(store.getTable('budgets'))) {
      const capTokens = store.getCell('budgets', scopeId, 'capTokens')
      if (typeof capTokens !== 'number') continue
      const spent = totalSpent(spendRows, scopeId)
      if (spent <= capTokens) continue

      const claimId = `claim:${scopeId}`
      const claimRow = store.getRow('claims', claimId)
      // Nothing to pull the run out from under, or already pulled.
      if (!claimRow || claimRow.holder === undefined || claimRow.revoked) continue

      const why = `spend-cap-overshoot ${spent}/${capTokens}`

      // The park write is attempted FIRST and gates everything destructive
      // that follows: revoking the claim and tearing down the sandbox cannot
      // be undone, so neither happens unless the run can actually land in
      // 'parked'. A run in a terminal state (folded, say) has no legal path
      // there — that is an operator triage case, not something the
      // orchestrator should rip infrastructure out from under — so it pages
      // and leaves the claim and sandbox exactly as they were.
      // A missing runs row is an explicit refusal, not a silent skip: it must
      // page (once) and leave the claim and sandbox untouched — falling
      // through to revoke + destroy without the park that is supposed to gate
      // them would be a destructive action with nothing gating it (#190).
      //
      // plan-defect: the plan's literal check was `if (!runRow)` after
      // `store.getRow(...)`, but TinyBase's `getRow` returns `{}` (truthy,
      // not undefined) for a nonexistent row — so that check never fires and
      // the missing-row case would silently fall into the park path with an
      // empty `oldRow`. `hasRow` is the real existence check (same pitfall
      // already flagged in this file's own test, line ~118).
      const runRow = store.getRow('runs', scopeId)
      if (!store.hasRow('runs', scopeId)) {
        pageOnce(
          `missing-row:${scopeId}`,
          'security',
          `supervisor park refused for ${scopeId}: missing runs row — leaving claim and sandbox untouched`,
        )
        continue
      }

      const parkedRow = { ...runRow, status: 'parked', parkedWhy: why }
      const parkRefusal = guardViolation('runs', scopeId, parkedRow, runRow, SUPERVISOR_ID, now, { supervisor: true })
      if (parkRefusal) {
        pageOnce(`park-refusal:${scopeId}`, 'security', `supervisor park refused for ${scopeId}: ${parkRefusal}`)
        continue
      }
      store.setRow('runs', scopeId, parkedRow)

      const revokedRow = revoke(claimRow)
      // The orchestrator's own hard action is still put to its own guard —
      // with the §W1b supervisory exemption, which permits a revoke on a claim
      // held by someone else and nothing more. If the guard refuses even that
      // (an un-revoke, say), the write does not happen.
      const revokeRefusal = guardViolation('claims', claimId, revokedRow, claimRow, SUPERVISOR_ID, now, {
        supervisor: true,
      })
      if (revokeRefusal) {
        pageOnce(`revoke-refusal:${scopeId}`, 'security', `supervisor revoke refused for ${scopeId}: ${revokeRefusal}`)
        continue
      }
      store.setRow('claims', claimId, revokedRow)

      descriptions.push(`spend-cap-overshoot ${scopeId} ${spent}/${capTokens}`)
      actions.page('spend', `${scopeId} ${why}`)
      actions.revokeAndPark(scopeId, why)
      actions.destroySandbox(claimRow.holder)
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
