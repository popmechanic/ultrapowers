import assert from 'node:assert/strict'
import { WebSocketServer, WebSocket } from 'ws'
import { createMergeableStore } from 'tinybase'
import { createWsServer } from 'tinybase/synchronizers/synchronizer-ws-server'
import { createWsSynchronizer } from 'tinybase/synchronizers/synchronizer-ws-client'
import { runShim } from '../shim.mjs'

// Bare relay — NO orchestrator. This proves the shim works against the plain
// substrate (an orchestrator's guard/sweep is additive, not load-bearing for
// the shim's own claim/renew/spend/status protocol). Per-path rooms isolate
// the three scenarios below even though each narrates the same runId 'r1'.
const PORT = 8152
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const wss = new WebSocketServer({ port: PORT })
const server = createWsServer(wss)

const join = async (path, id) => {
  const store = createMergeableStore(id)
  const synchronizer = await createWsSynchronizer(store, new WebSocket(`ws://localhost:${PORT}/${path}`))
  await synchronizer.startSync()
  return {
    store,
    close: () => {
      synchronizer.stopSync()
      synchronizer.destroy()
    },
  }
}

const main = async () => {
  // --- 1. claim-then-run ---------------------------------------------------
  // Seed runs.r1 pending; runShim claims, renews across (at least) two
  // renew intervals while invokeRun is pending, then resolves gate-green.
  {
    const helper = await join('t1', 'helper')
    helper.store.setRow('runs', 'r1', { planPath: 'plans/x.md', status: 'pending' })
    await sleep(300)

    // Capture leaseExpiresAt on every claims write via a listener on a
    // client separate from the shim's own store — the initial claim write
    // lands at index 0, each subsequent renew appends a strictly larger
    // value, so >=2 renews means >=3 total captured values.
    const leaseValues = []
    helper.store.addRowListener('claims', 'claim:r1', () => {
      const row = helper.store.getRow('claims', 'claim:r1')
      if (row && row.leaseExpiresAt !== undefined) leaseValues.push(row.leaseExpiresAt)
    })

    const invokeRun = () =>
      new Promise((resolve) => {
        const check = setInterval(() => {
          if (leaseValues.length >= 3) {
            clearInterval(check)
            resolve({ gateGreen: true })
          }
        }, 20)
      })

    const result = await runShim({
      wsUrl: `ws://localhost:${PORT}/t1`,
      token: 'tok',
      sandboxId: 'sbX',
      runId: 'r1',
      ttlMs: 300,
      renewEveryMs: 80,
      invokeRun,
      readReportTokens: () => null,
    })

    assert.equal(result.status, 'gate-green')
    await sleep(300)

    const claimRow = helper.store.getRow('claims', 'claim:r1')
    assert.equal(claimRow.holder, 'sbX')
    assert.equal(claimRow.epoch, 1)

    const runsRow = helper.store.getRow('runs', 'r1')
    assert.equal(runsRow.status, 'gate-green')

    assert.ok(leaseValues.length >= 3, `expected the initial claim + >=2 renews, got ${leaseValues.length} writes`)
    for (let i = 1; i < leaseValues.length; i++) {
      assert.ok(leaseValues[i] > leaseValues[i - 1], 'leaseExpiresAt must strictly increase on every renew')
    }

    helper.close()
  }

  // --- 2. spend append — idempotent per boundary ----------------------------
  // readReportTokens returns a constant 1234 across multiple renew boundaries
  // plus the final check; only the first observation may append a row.
  {
    const helper = await join('t2', 'helper')
    helper.store.setRow('runs', 'r1', { planPath: 'plans/x.md', status: 'pending' })
    await sleep(300)

    const leaseValues = []
    helper.store.addRowListener('claims', 'claim:r1', () => {
      const row = helper.store.getRow('claims', 'claim:r1')
      if (row && row.leaseExpiresAt !== undefined) leaseValues.push(row.leaseExpiresAt)
    })

    const invokeRun = () =>
      new Promise((resolve) => {
        const check = setInterval(() => {
          if (leaseValues.length >= 3) {
            clearInterval(check)
            resolve({ gateGreen: true })
          }
        }, 20)
      })

    const result = await runShim({
      wsUrl: `ws://localhost:${PORT}/t2`,
      token: 'tok',
      sandboxId: 'sbX',
      runId: 'r1',
      ttlMs: 300,
      renewEveryMs: 80,
      invokeRun,
      readReportTokens: () => 1234, // same reading at every boundary
    })

    assert.equal(result.status, 'gate-green')
    await sleep(300)

    const spendTable = helper.store.getTable('spend')
    const keys = Object.keys(spendTable)
    assert.deepEqual(keys, ['sbX:1'], 'a second identical read must not append a second spend row')
    assert.equal(spendTable['sbX:1'].runId, 'r1')
    assert.equal(spendTable['sbX:1'].tokens, 1234)

    helper.close()
  }

  // --- 3. lost claim ---------------------------------------------------------
  // The claim is already revoked before the shim even attempts it — resolve
  // lost-claim immediately, invokeRun never called.
  {
    const helper = await join('t3', 'helper')
    helper.store.setRow('runs', 'r1', { planPath: 'plans/x.md', status: 'pending' })
    helper.store.setRow('claims', 'claim:r1', {
      runId: 'r1',
      holder: 'someoneElse',
      leaseExpiresAt: Date.now() + 999999,
      epoch: 5,
      revoked: true,
    })
    await sleep(300)

    let invoked = false
    const invokeRun = () => {
      invoked = true
      return Promise.resolve({ gateGreen: true })
    }

    const result = await runShim({
      wsUrl: `ws://localhost:${PORT}/t3`,
      token: 'tok',
      sandboxId: 'sbX',
      runId: 'r1',
      ttlMs: 300,
      renewEveryMs: 80,
      invokeRun,
      readReportTokens: () => null,
    })

    assert.equal(result.status, 'lost-claim')
    assert.equal(invoked, false)

    helper.close()
  }
}

main()
  .then(() => {
    server.destroy()
    wss.close()
    console.log('ALL TESTS PASSED')
    process.exit(0)
  })
  .catch((e) => {
    console.error(e)
    server.destroy()
    wss.close()
    process.exit(1)
  })
