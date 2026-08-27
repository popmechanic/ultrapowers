// fleet/tests/test_shim_transport.mjs — #288: tinybase's createWsSynchronizer
// resolves SILENTLY when the ws handshake fails (connection refused AND a 401
// rejection both leave readyState CLOSED with no thrown error), so a run can
// execute end-to-end with zero store writes ever reaching the orchestrator.
// This proves the fix: a verified connect (connectOpenWs), a verified publish
// (deliverAndClose's rescue reconnect when the socket died mid-run), and a
// capped renew cadence (renewIntervalFor).
import assert from 'node:assert/strict'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { WebSocketServer, WebSocket } from 'ws'
import { createMergeableStore } from 'tinybase'
import { createWsServer } from 'tinybase/synchronizers/synchronizer-ws-server'
import { createWsSynchronizer } from 'tinybase/synchronizers/synchronizer-ws-client'
import { runShim, connectOpenWs, renewIntervalFor } from '../shim.mjs'
import { main as shimMain } from '../shim-main.mjs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Bare relay — same shape as test_shim.mjs. Scenarios 5 and 6 (the ones that
// need a live orchestrator-shaped server) share it via per-path rooms;
// scenarios 2-4 stand up their own throwaway servers because they need to
// control the handshake itself (refused / rejected / hung).
const wss = new WebSocketServer({ port: 0 })
await new Promise((resolve, reject) => {
  wss.once('listening', resolve)
  wss.once('error', reject)
})
const PORT = wss.address().port

// The path-scoped store-sync wiring, named so a throwaway server can get the
// SAME handler as the shared `wss` without a duplicated handler body (scenario
// 9 stands up its own server precisely so it can kill it for good).
const installSyncHandler = (wsServer) => createWsServer(wsServer)

const server = installSyncHandler(wss)

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

let passed = 0
const ok = (label) => {
  passed += 1
  console.log(`ok - ${label}`)
}

const main = async () => {
  // --- 1. renewIntervalFor is capped ---------------------------------------
  {
    assert.equal(renewIntervalFor(14_400_000), 300_000, '4h ttl -> 5 min cadence (capped)')
    assert.equal(renewIntervalFor(300), 100, 'small ttl -> ttl/3, uncapped')
    assert.equal(renewIntervalFor(14_400_000, 80), 80, 'explicit override always wins')
    ok('renewIntervalFor caps at RENEW_CAP_MS and honors an explicit override')
  }

  // --- 2. connection refused -> no-store, engine never invoked -------------
  {
    const deadServer = new WebSocketServer({ port: 0 })
    await new Promise((resolve, reject) => {
      deadServer.once('listening', resolve)
      deadServer.once('error', reject)
    })
    const deadPort = deadServer.address().port
    await new Promise((resolve) => deadServer.close(resolve))

    let invoked = false
    const result = await runShim({
      wsUrl: `ws://127.0.0.1:${deadPort}/x`,
      token: 't',
      sandboxId: 'sb',
      runId: 'r1',
      ttlMs: 300,
      invokeRun: () => {
        invoked = true
        return Promise.resolve({ gateGreen: true })
      },
      readReportTokens: () => null,
      openSocket: (url) => connectOpenWs(url, { timeoutMs: 2_000, log: () => {} }),
    })

    assert.equal(result.status, 'no-store')
    assert.ok(typeof result.error === 'string' && result.error.length > 0)
    assert.equal(invoked, false)
    ok('connection refused -> no-store, engine never invoked')
  }

  // --- 3. 401 handshake rejection -> no-store -------------------------------
  {
    const rejectServer = new WebSocketServer({ port: 0, verifyClient: () => false })
    await new Promise((resolve, reject) => {
      rejectServer.once('listening', resolve)
      rejectServer.once('error', reject)
    })
    const port = rejectServer.address().port

    let invoked = false
    const result = await runShim({
      wsUrl: `ws://127.0.0.1:${port}/x`,
      token: 't',
      sandboxId: 'sb',
      runId: 'r1',
      ttlMs: 300,
      invokeRun: () => {
        invoked = true
        return Promise.resolve({ gateGreen: true })
      },
      readReportTokens: () => null,
      openSocket: (url) => connectOpenWs(url, { timeoutMs: 2_000, log: () => {} }),
    })

    assert.equal(result.status, 'no-store')
    assert.ok(typeof result.error === 'string' && result.error.length > 0)
    assert.equal(invoked, false)

    await new Promise((resolve) => rejectServer.close(resolve))
    ok('401 handshake rejection -> no-store, engine never invoked')
  }

  // --- 4. connect timeout -> no-store ---------------------------------------
  // A raw TCP server that accepts the connection and never upgrades it — the
  // ws handshake just hangs, so only connectOpenWs's own timeout can resolve
  // this.
  {
    const acceptedSockets = []
    const tcpServer = net.createServer((socket) => {
      // accept and do nothing — never send an HTTP response
      socket.on('error', () => {})
      acceptedSockets.push(socket)
    })
    await new Promise((resolve) => tcpServer.listen(0, resolve))
    const port = tcpServer.address().port

    let invoked = false
    const result = await runShim({
      wsUrl: `ws://127.0.0.1:${port}/x`,
      token: 't',
      sandboxId: 'sb',
      runId: 'r1',
      ttlMs: 300,
      invokeRun: () => {
        invoked = true
        return Promise.resolve({ gateGreen: true })
      },
      readReportTokens: () => null,
      openSocket: (url) => connectOpenWs(url, { timeoutMs: 300, log: () => {} }),
    })

    assert.equal(result.status, 'no-store')
    assert.ok(/timeout/.test(result.error), `expected a timeout error, got: ${result.error}`)
    assert.equal(invoked, false)

    // `server.close()`'s callback only fires once every connection has ended
    // — the accepted socket above never closes on its own (that's the whole
    // point of this scenario), so it must be destroyed before the server can.
    for (const socket of acceptedSockets) socket.destroy()
    await new Promise((resolve) => tcpServer.close(resolve))
    ok('connect timeout -> no-store')
  }

  // --- 5. dead-socket-at-terminal rescue — THE #288 shape -------------------
  // The shim's own socket dies mid-run (server-side terminate, exactly what a
  // dropped connection looks like). The terminal status write lands only in
  // local store state until deliverAndClose's rescue reconnect gets it out.
  {
    const helper = await join('t5', 'helper')
    helper.store.setRow('runs', 'r1', { planPath: 'plans/x.md', status: 'pending' })
    await sleep(300)

    // Taken after the helper joined and before runShim's own socket connects,
    // so it names exactly the helper's server-side connection.
    const wssClientsBefore = new Set(wss.clients)

    const invokeRun = async () => {
      // The shim's server-side socket is whichever member of wss.clients is
      // NOT in the pre-runShim snapshot — found here, right before killing it,
      // so the diff is computed against the connection state as of "now".
      let shimSocket
      for (let attempt = 0; attempt < 50 && !shimSocket; attempt++) {
        shimSocket = [...wss.clients].find((c) => !wssClientsBefore.has(c))
        if (!shimSocket) await sleep(20)
      }
      assert.ok(shimSocket, 'expected to find the shim server-side socket')
      shimSocket.terminate()
      await sleep(150)
      return { gateGreen: true }
    }

    const result5 = await runShim({
      wsUrl: `ws://localhost:${PORT}/t5`,
      token: 'tok',
      sandboxId: 'sbX',
      runId: 'r1',
      ttlMs: 300,
      renewEveryMs: 80,
      invokeRun,
      readReportTokens: () => null,
    })

    assert.equal(result5.status, 'gate-green')
    assert.equal(result5.delivered, true)

    const deadline = Date.now() + 3_000
    let statusSeen
    while (Date.now() < deadline) {
      statusSeen = helper.store.getRow('runs', 'r1')?.status
      if (statusSeen === 'gate-green') break
      await sleep(50)
    }
    assert.equal(statusSeen, 'gate-green', 'terminal status must arrive via the rescue reconnect')

    helper.close()
    ok('dead-socket-at-terminal rescue delivers status via reconnect')
  }

  // --- 6. live-socket flush --------------------------------------------------
  {
    const helper = await join('t6', 'helper')
    helper.store.setRow('runs', 'r1', { planPath: 'plans/x.md', status: 'pending' })
    await sleep(300)

    const invokeRun = () => Promise.resolve({ gateGreen: true })

    const result = await runShim({
      wsUrl: `ws://localhost:${PORT}/t6`,
      token: 'tok',
      sandboxId: 'sbX',
      runId: 'r1',
      ttlMs: 300,
      renewEveryMs: 80,
      invokeRun,
      readReportTokens: () => null,
    })

    assert.equal(result.status, 'gate-green')

    const deadline = Date.now() + 1_000
    let statusSeen
    while (Date.now() < deadline) {
      statusSeen = helper.store.getRow('runs', 'r1')?.status
      if (statusSeen === 'gate-green') break
      await sleep(25)
    }
    assert.equal(statusSeen, 'gate-green', 'live-socket flush must deliver within 1s of runShim resolving')

    helper.close()
    ok('live-socket flush delivers gate-green within 1s')
  }

  // --- 7. shim-main.mjs main() fails fast when the aux socket can't connect -
  // The fail-fast contract (aux connectOpenWs failure => the engine never
  // launches) is exercised in-process against the REAL `main()`, not just
  // `runShim` in isolation — a connection-refused port is enough (fast,
  // deterministic rejection; no timeout knob needed).
  {
    const deadServer = new WebSocketServer({ port: 0 })
    await new Promise((resolve, reject) => {
      deadServer.once('listening', resolve)
      deadServer.once('error', reject)
    })
    const deadPort = deadServer.address().port
    await new Promise((resolve) => deadServer.close(resolve))

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-main-transport-'))
    const assignmentPath = path.join(tmpDir, 'fleet-run.json')
    fs.writeFileSync(
      assignmentPath,
      JSON.stringify({ runId: 'r1', token: 't', wsUrl: `ws://127.0.0.1:${deadPort}/x`, ttlMs: 300 }),
    )
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-main-repo-'))

    let invoked = false
    const invokeRun = () => {
      invoked = true
      return Promise.resolve({ gateGreen: true })
    }
    // Never expected to run — readStamp (which uses this) sits behind the aux
    // connectOpenWs call, which is expected to reject first.
    const exec = () => Promise.resolve({ code: 1, stdout: '' })

    let rejected = false
    let errMessage = ''
    try {
      await shimMain({ assignmentPath, repoDir, exec, invokeRun })
    } catch (error) {
      rejected = true
      errMessage = String(error?.message ?? error)
    }

    assert.equal(rejected, true, 'main() must reject when the aux connectOpenWs call fails')
    assert.ok(
      /connect|closed|timeout/i.test(errMessage),
      `expected a connect/closed/timeout error, got: ${errMessage}`,
    )
    assert.equal(invoked, false, 'invokeRun must never be called when the aux transport is dead')

    fs.rmSync(tmpDir, { recursive: true, force: true })
    fs.rmSync(repoDir, { recursive: true, force: true })
    ok("main() fails fast when the aux socket can't connect — engine never launches")
  }

  // --- 8. mid-run reconnect (#299) — a dropped socket is re-opened by the
  // renew loop, so renews and spend resume flowing BEFORE the terminal write.
  {
    const helper = await join('t8', 'helper')
    helper.store.setRow('runs', 'r1', { planPath: 'plans/x.md', status: 'pending' })
    await sleep(300)

    const wssClientsBefore = new Set(wss.clients)
    let tokens = 0
    const invokeRun = async () => {
      let shimSocket
      for (let attempt = 0; attempt < 50 && !shimSocket; attempt++) {
        shimSocket = [...wss.clients].find((c) => !wssClientsBefore.has(c))
        if (!shimSocket) await sleep(20)
      }
      assert.ok(shimSocket, 'expected to find the shim server-side socket')
      shimSocket.terminate()
      // Spend appended AFTER the drop must reach the helper BEFORE the run
      // resolves — that is what "reconnected" means observably.
      tokens = 4200
      const deadline = Date.now() + 5_000
      for (;;) {
        const spendRows = Object.values(helper.store.getTable('spend')).filter((r) => r.runId === 'r1')
        if (spendRows.length > 0) break
        assert.ok(Date.now() < deadline, 'spend row must arrive mid-run via the reconnected socket')
        await sleep(50)
      }
      return { gateGreen: true }
    }

    const result8 = await runShim({
      wsUrl: `ws://localhost:${PORT}/t8`,
      token: 'tok',
      sandboxId: 'sbX',
      runId: 'r1',
      ttlMs: 300,
      renewEveryMs: 80,
      invokeRun,
      readReportTokens: () => tokens,
      log: () => {},
    })

    assert.equal(result8.status, 'gate-green')
    assert.equal(result8.delivered, true, 'a reconnected run must report delivery')

    const deadline8 = Date.now() + 3_000
    let statusSeen8
    while (Date.now() < deadline8) {
      statusSeen8 = helper.store.getRow('runs', 'r1')?.status
      if (statusSeen8 === 'gate-green') break
      await sleep(50)
    }
    assert.equal(statusSeen8, 'gate-green')
    helper.close()
    ok('mid-run reconnect restores sync before the terminal write')
  }

  // --- 9. delivered:false — the server is gone for good at publish ----------
  // A dedicated server (so closing it cannot disturb the shared wss): the shim
  // connects, the server dies entirely mid-run, every reconnect and the
  // terminal rescue fail, and the outcome says so.
  {
    const soloServer = new WebSocketServer({ port: 0 })
    await new Promise((resolve, reject) => {
      soloServer.once('listening', resolve)
      soloServer.once('error', reject)
    })
    installSyncHandler(soloServer) // same handler wiring the shared wss uses
    const soloPort = soloServer.address().port

    const invokeRun = async () => {
      for (const client of soloServer.clients) client.terminate()
      await new Promise((resolve) => soloServer.close(resolve))
      await sleep(200)
      return { gateGreen: true }
    }

    const result9 = await runShim({
      wsUrl: `ws://localhost:${soloPort}/t9`,
      token: 'tok',
      sandboxId: 'sbY',
      runId: 'r9',
      ttlMs: 300,
      renewEveryMs: 80,
      invokeRun,
      readReportTokens: () => null,
      openSocket: (url) => connectOpenWs(url, { timeoutMs: 500, log: () => {} }),
      log: () => {},
    })

    assert.equal(result9.status, 'gate-green')
    assert.equal(result9.delivered, false, 'an undeliverable outcome must say so')
    ok('dead-forever server reads delivered:false')
  }
}

main()
  .then(() => {
    server.destroy()
    wss.close()
    console.log(`\nALL TESTS PASSED (${passed})`)
    process.exit(0)
  })
  .catch((e) => {
    console.error(e)
    server.destroy()
    wss.close()
    process.exit(1)
  })
