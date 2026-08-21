// PROTOTYPE (#178) — the substrate check: same schema logic, but synced through
// a REAL plain tinybase ws-server (the locked v1 substrate). Exits cleanly.
// Run: npm run proto:ws
import { WebSocketServer, WebSocket } from 'ws'
import { createMergeableStore } from 'tinybase'
import { createWsServer } from 'tinybase/synchronizers/synchronizer-ws-server'
import { createWsSynchronizer } from 'tinybase/synchronizers/synchronizer-ws-client'
import { spendRowId, totalSpent, tryClaim, claimState } from './schema.mjs'

const PORT = 8047
const PATH = 'docket-2026-08-21'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const main = async () => {
  const wss = new WebSocketServer({ port: PORT })
  const server = createWsServer(wss)
  console.log(`ws-server up on :${PORT} (plain relay, per-path rooms)`)

  const join = async (id) => {
    const store = createMergeableStore(id)
    const synchronizer = await createWsSynchronizer(store, new WebSocket(`ws://localhost:${PORT}/${PATH}`))
    await synchronizer.startSync()
    return { store, synchronizer }
  }

  const orch = await join('orch')
  const sbA = await join('sbA')
  const sbB = await join('sbB')

  // orchestrator seeds a run + budget; sandboxes claim and spend over the wire
  const now = Date.now()
  orch.store.setRow('runs', 'run-ws', { planPath: 'plans/ws.md', status: 'pending' })
  orch.store.setRow('budgets', 'run-ws', { capTokens: 100 })
  await sleep(300)

  const claim = tryClaim(sbA.store.getRow('claims', 'claim:run-ws'), { runId: 'run-ws', claimant: 'sbA', ttlMs: 60000, now })
  sbA.store.setRow('claims', 'claim:run-ws', claim.row)
  sbA.store.setRow('spend', spendRowId('sbA', 1), { runId: 'run-ws', tokens: 40, at: now })
  sbB.store.setRow('spend', spendRowId('sbB', 1), { runId: 'run-ws', tokens: 25, at: now })
  await sleep(300)

  const total = totalSpent(orch.store.getTable('spend'), 'run-ws')
  const state = claimState(orch.store.getRow('claims', 'claim:run-ws'), now)
  console.log(`orch sees over the wire: claim=${state} holder=${orch.store.getRow('claims', 'claim:run-ws')?.holder} spend=${total}/100`)
  console.log(total === 65 && state === 'held' ? 'SUBSTRATE OK — MergeableStore semantics hold through the plain ws-server' : `SURPRISE — total=${total} state=${state}`)

  for (const c of [orch, sbA, sbB]) { c.synchronizer.stopSync(); c.synchronizer.destroy() }
  server.destroy()
  wss.close()
  process.exit(total === 65 && state === 'held' ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
