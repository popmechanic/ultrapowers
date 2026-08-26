import assert from 'node:assert/strict'
import { WebSocketServer, WebSocket } from 'ws'
import { createMergeableStore } from 'tinybase'
import { createWsServer } from 'tinybase/synchronizers/synchronizer-ws-server'
import { createWsSynchronizer } from 'tinybase/synchronizers/synchronizer-ws-client'
import { runShim } from '../shim.mjs'
import { totalSpent } from '../store.mjs'

// Bare relay — NO orchestrator. This proves the shim works against the plain
// substrate (an orchestrator's guard/sweep is additive, not load-bearing for
// the shim's own claim/renew/spend/status protocol). Per-path rooms isolate
// the three scenarios below even though each narrates the same runId 'r1'.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const wss = new WebSocketServer({ port: 0 })
await new Promise((resolve, reject) => {
  wss.once('listening', resolve)
  wss.once('error', reject)
})
const PORT = wss.address().port
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

  // --- 2b. spend append — RISING readings must not double-count --------------
  // readReportTokens is the run report's output-token TOTAL: it is CUMULATIVE.
  // Readers derive spend by SUMMING rows (store.mjs `totalSpent`), so a row
  // must carry the DELTA since the last sample, never the raw cumulative
  // reading. Appending raw readings at 1000/2000/3000 would sum to 6000 for a
  // run that actually spent 3000 — budget enforcement would over-count and
  // park live runs early. Scenario 2 above holds the reading constant and so
  // exercises only the identical-reading path; this one moves it.
  {
    const helper = await join('t2b', 'helper')
    helper.store.setRow('runs', 'r1', { planPath: 'plans/x.md', status: 'pending' })
    await sleep(300)

    const leaseValues = []
    helper.store.addRowListener('claims', 'claim:r1', () => {
      const row = helper.store.getRow('claims', 'claim:r1')
      if (row && row.leaseExpiresAt !== undefined) leaseValues.push(row.leaseExpiresAt)
    })

    // Strictly rising by exactly 1000 on every sample, so every observation is
    // a fresh boundary and every expected delta is exactly 1000. `readings`
    // records what the shim actually saw; its last entry is the final
    // cumulative total the ledger must agree with.
    const readings = []
    let cumulative = 0
    const readReportTokens = () => {
      cumulative += 1000
      readings.push(cumulative)
      return cumulative
    }

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
      wsUrl: `ws://localhost:${PORT}/t2b`,
      token: 'tok',
      sandboxId: 'sbX',
      runId: 'r1',
      ttlMs: 300,
      renewEveryMs: 80,
      invokeRun,
      readReportTokens,
    })

    assert.equal(result.status, 'gate-green')
    await sleep(300)

    const spendTable = helper.store.getTable('spend')
    const keys = Object.keys(spendTable).sort((a, b) => Number(a.split(':')[1]) - Number(b.split(':')[1]))

    // Guard the guard: if only one row landed, the rising-reading path was
    // never exercised and the sum below would pass vacuously.
    assert.ok(keys.length >= 2, `expected >=2 spend rows across boundaries, got ${keys.length}`)
    assert.deepEqual(
      keys,
      Array.from({ length: keys.length }, (_, i) => `sbX:${i + 1}`),
      'spend rows are writer-namespaced and sequential',
    )
    assert.deepEqual(
      keys.map((k) => spendTable[k].tokens),
      keys.map(() => 1000),
      'each row must carry the DELTA since the last sample, not the cumulative reading',
    )
    assert.deepEqual(
      keys.map((k) => spendTable[k].runId),
      keys.map(() => 'r1'),
    )

    const finalReading = readings[readings.length - 1]
    assert.equal(
      totalSpent(spendTable, 'r1'),
      finalReading,
      `summed ledger must equal the final cumulative reading (${finalReading}), not a multiple of it`,
    )

    helper.close()
  }

  // --- 2c. spend append — non-readings and rollbacks append nothing ----------
  // The contract is `readReportTokens(): number|null`. A null (report not yet
  // written) must be skipped, not coerced. A reading that goes DOWN — a report
  // reset/rollback — must not append a negative row: the ledger only moves
  // forward. A non-number that would sneak past a loose check (`true`) is
  // likewise not a reading.
  {
    const helper = await join('t2c', 'helper')
    helper.store.setRow('runs', 'r1', { planPath: 'plans/x.md', status: 'pending' })
    await sleep(300)

    const leaseValues = []
    helper.store.addRowListener('claims', 'claim:r1', () => {
      const row = helper.store.getRow('claims', 'claim:r1')
      if (row && row.leaseExpiresAt !== undefined) leaseValues.push(row.leaseExpiresAt)
    })

    // >=3 lease writes gate invokeRun, so >=2 renew samples + 1 resolution
    // sample means the script is read at least 3 times; past its end it pins
    // at 5000 (delta 0). Only the 5000 at index 1 may ever append.
    const script = [null, 5000, 4000, true]
    let i = 0
    const readReportTokens = () => (i < script.length ? script[i++] : 5000)

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
      wsUrl: `ws://localhost:${PORT}/t2c`,
      token: 'tok',
      sandboxId: 'sbX',
      runId: 'r1',
      ttlMs: 300,
      renewEveryMs: 80,
      invokeRun,
      readReportTokens,
    })

    assert.equal(result.status, 'gate-green')
    await sleep(300)

    const spendTable = helper.store.getTable('spend')
    assert.deepEqual(Object.keys(spendTable), ['sbX:1'], 'null / rollback / non-number append nothing')
    assert.equal(spendTable['sbX:1'].tokens, 5000)
    assert.equal(totalSpent(spendTable, 'r1'), 5000)

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
