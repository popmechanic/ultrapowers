# W2 Entry Slate Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the W2 charter's entry slate — #299 mid-run ws reconnect (+M2 delivered-outcome ride-along), #279 real-plan drive defaults with lease-expiry legibility, the capTokens=500k constant, #290 residual coverage, and #292 fleet-evidence-as-harvest-input — so the first concurrent AFK drain is safe to run.

**Architecture:** All changes live in the fleet drive layer (`fleet/`) and ultralearn instructions (`skills/ultralearn/`). The shim gains a mid-run reconnect in its renew loop (option (a) from #299) and stops discarding `deliverAndClose`'s return; the driver gets real-plan defaults and a legible lease-expiry error; #290's untestable refusal branch becomes testable via a provisioner injection seam; #292 is instruction-only markdown.

**Tech Stack:** Plain Node ESM (no build step), `node:test`-style assert scripts under `fleet/tests/*.mjs`, pytest wrapper `tests/test_fleet_suite.py` as the gate.

**Spec:** `docs/superpowers/specs/2026-08-21-width-program.md` (§W2a–W2d) + the W2 charter recorded on issue #189 (2026-08-27 comment). Issues: #299, #279, #290, #292.

**Acceptance:** suite — W2 charter: the committed fleet suite plus per-task review is the verification; no sealing lane in W2.

## Global Constraints

- Lane is `fleet/**`, `skills/ultralearn/**`, and docs ONLY. Engine surfaces (`skills/ultrapowers/harnesses/waves.js`, `references/reviewer-prompts.md`, `scripts/compile_plan.py`) and the frozen verification periphery (gate scripts, seal subsystem) must not be touched.
- No `anthropic` SDK and no `ANTHROPIC_API_KEY` anywhere in `fleet/` or any shipped script.
- Every `fleet/tests/*.mjs` must stay green within its 120s cap; `python3 -m pytest` is the gate (baseline 1183 + whatever main has gained).
- Per-run `capTokens` default is exactly `500_000` (operator-decided constant from measured burn); `ttlMs` default is exactly `4 * 60 * 60_000` (14_400_000 ms).
- `skills/ultralearn` changes are instruction-only — no harvester or merge-script code changes.
- The ultralearn reader-output JSON contract (`references/reading-lenses.md` § Output format) is unchanged — additions only tell lenses where to look, never change finding fields.

---

### Task 1: Shim mid-run ws reconnect + delivered outcome (#299 + M2)

**Type:** implementation
**Depends-on:** none
**Review:** adversarial

**Files:**
- Modify: `fleet/shim.mjs`
- Modify: `fleet/shim-main.mjs:866-918`
- Modify: `fleet/tests/test_shim_transport.mjs`

**Interfaces:**
- Consumes: nothing from sibling tasks.
- Produces: `runShim(...)` now resolves `{ status: string, delivered: boolean, error?: string }` — the `delivered` field is new on every path (`false` on `no-store`). `main()` in `fleet/shim-main.mjs` resolves the same shape, with `delivered` combining the shim's delivery and the aux publish. No signature changes to `runShim`/`main` inputs.

**Why this shape (from #299):** run-13's engine phase ran 57 min; a socket that drops mid-engine-phase makes every renew a local no-op, the driver sees zero progress, and after `heartbeatTimeoutMs` (30 min) it destroys the sandbox under a still-running engine — the terminal rescue in `deliverAndClose` never gets to run. Option (a): the shim's renew loop detects the dead socket and re-opens + re-syncs over the SAME store, restoring live renews/spend so the driver keeps seeing progress. M2: `deliverAndClose` returns whether delivery happened, but every call site discards it — consume it into the outcome and the process exit code.

- [ ] **Step 1: Write the failing tests** — append two scenarios to `fleet/tests/test_shim_transport.mjs` (reuse the file's existing `wss`/`join`/`ok` helpers; the mid-run-drop mechanics copy test 5's snapshot-diff pattern for finding the shim's server-side socket):

```js
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
    installSyncHandler(soloServer) // same handler wiring the shared wss uses; extract if needed
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
```

Note on `installSyncHandler`: the shared `wss` at the top of the file has connection-handler wiring (path-scoped store sync). Extract that wiring into a small named helper so the solo server in scenario 9 reuses it verbatim — do not duplicate the handler body.

Also update existing scenario 5's assertion block: add `assert.equal(result5.delivered, true)` (with reconnect in place the terminal write may ride the reconnected socket rather than the rescue — the scenario's contract is "the status arrives", which stands either way).

- [ ] **Step 2: Run tests to verify they fail**

Run: `node fleet/tests/test_shim_transport.mjs`
Expected: FAIL — scenario 8 times out waiting for the mid-run spend row (no reconnect exists), and `delivered` asserts fail (`undefined !== true/false`).

- [ ] **Step 3: Implement the reconnect in `fleet/shim.mjs`** — inside `runShim`, make `ws` and `synchronizer` reassignable, add a single-flight reconnect, and consume `deliverAndClose`'s return at all four exit paths:

```js
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
      try {
        const ws2 = await openSocket(url, { log })
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
        log(`fleet: mid-run reconnect failed — ${error?.message ?? error}; retrying at next renew`)
        return false
      } finally {
        reconnectPromise = null
      }
    })()
    return reconnectPromise
  }
```

In the renew `setInterval` callback, replace the `deadLogged` block with:

```js
    if (ws.readyState !== WebSocket.OPEN) {
      if (!deadLogged) {
        deadLogged = true
        log('fleet: ws connection lost mid-run — reconnecting')
      }
      void tryReconnect()
    } else {
      deadLogged = false
    }
```

After `clearInterval(timer)` / final `maybeAppendSpend()` and before any terminal `deliverAndClose`, quiesce an in-flight reconnect so the deliver path never races a swap:

```js
  if (reconnectPromise) await reconnectPromise.catch(() => {})
```

Then consume delivery at every exit path (the `ws`/`synchronizer` arguments now read the CURRENT refs at call time):

```js
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
```

And the early `lost-claim` path becomes:

```js
  if (claimAttempt.error) {
    const delivered = await deliverAndClose({ store, synchronizer, ws, url, openSocket, log })
    return { status: 'lost-claim', delivered }
  }
```

- [ ] **Step 4: Consume delivery in `fleet/shim-main.mjs`** — `main()`'s no-store path returns `{ ...outcome }` (already carries `delivered: false` from Step 3); its final aux publish becomes:

```js
  const auxDelivered = await deliverAndClose({ store, synchronizer, ws, url, log: console.error })
  return { ...outcome, delivered: outcome?.delivered === true && auxDelivered }
```

And the `invokedDirectly` exit-code mapping keys on both status and delivery, so a failed publish is visible beyond shim.log:

```js
    .then((outcome) => {
      console.log(JSON.stringify(outcome))
      process.exit(outcome?.status === 'gate-green' && outcome?.delivered === true ? 0 : 1)
    })
```

- [ ] **Step 5: Run the transport tests**

Run: `node fleet/tests/test_shim_transport.mjs`
Expected: PASS, `ALL TESTS PASSED`-style final line per the file's existing convention.

- [ ] **Step 6: Run the full fleet suite + pytest wrapper**

Run: `node fleet/tests/test_shim.mjs && node fleet/tests/test_shim_main_gate.mjs && node fleet/tests/test_shim_main_tokens.mjs && node fleet/tests/test_drive.mjs && python3 -m pytest tests/test_fleet_suite.py -q`
Expected: PASS. If `test_shim.mjs` or the shim-main tests assert on exact outcome shapes (`{ status: ... }` deep-equals), extend those assertions to include the new `delivered` field — the field is part of the contract now, not noise to work around.

- [ ] **Step 7: Commit**

```bash
git add fleet/shim.mjs fleet/shim-main.mjs fleet/tests/test_shim_transport.mjs fleet/tests/test_shim.mjs fleet/tests/test_shim_main_gate.mjs fleet/tests/test_shim_main_tokens.mjs
git commit -m "feat(fleet): mid-run ws reconnect in the renew loop + delivered consumed into shim outcome (#299)"
```

---

### Task 2: Real-plan drive defaults + lease-expiry legibility (#279, capTokens constant)

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `fleet/drive.mjs:150-151`
- Modify: `fleet/drive.mjs:474-513`
- Modify: `fleet/RUNBOOK.md`
- Test: `fleet/tests/test_drive.mjs`

**Commutes:** `fleet/tests/test_drive.mjs`

**Interfaces:**
- Consumes: nothing from sibling tasks.
- Produces: `driveOne` defaults change to `ttlMs = 4 * 60 * 60_000` and `capTokens = 500_000`; a new named error string `claim expired mid-watch` appears in `detail.errors` on lease expiry. No signature additions.

**Why (from #279 + charter):** the 15-min `ttlMs` default is a smoke-run constant — run-9's real plan had its token expire mid-preflight and the drive read it as a generic heartbeat timeout two stages from the cause. The charter fixes `capTokens` at 500_000 (from run-13's measured 115k burn), replacing the 2M placeholder.

- [ ] **Step 1: Write the failing tests** — append to `fleet/tests/test_drive.mjs`:

Test A (defaults): a scripted never-claiming drive (copy test 17/18's `makeExec(() => {})` + small `claimTimeoutMs` shape) run WITHOUT `ttlMs`/`capTokens` in its options (build the options object by spreading `driveDefaults` and then deleting `ttlMs`, since `driveDefaults` pins one):

```js
  // -- 20. real-plan defaults (#279 + W2 charter): ttlMs 4h, capTokens 500k --
  {
    const runId = 'run-drive-20'
    const exec = makeExec(() => {})
    const opts = { ...driveDefaults, dbDir: path.join(tmp, 'db20'), exec, runId, claimTimeoutMs: 500, heartbeatTimeoutMs: 60_000, tickMs: 50, settleMs: 100 }
    delete opts.ttlMs
    const { detail } = await driveOne(opts)

    assert.equal(detail.capTokens, 500_000, 'capTokens default must be the W2 charter constant')
    assert.equal(exec.delivered.ttlMs, 4 * 60 * 60_000, 'ttlMs default must be real-plan scale (4h), not the 15-min smoke constant')
  }
```

Test B (lease-expiry legibility): reuse the in-process production-shim harness (the `makeExec((assignment) => ...)` + `runShim` pattern of test 10), with a tiny explicit `ttlMs` and a PER-TEST mutable clock (the file's shared `clock` is `const T` — frozen; this test needs to advance time, so it makes its own and passes it to BOTH `driveOne` and the stub shim). The `invokeRun` advances the clock past the claim's expiry and then hangs long enough for the watch loop to observe the expired claim before resolving:

```js
  // -- 21. lease expiry reads as lease expiry, not a generic stall (#279-3) --
  {
    const runId = 'run-drive-21'
    let t21 = 2_000_000
    const clock21 = () => t21
    let sandbox = null
    const exec = makeExec((assignment) => {
      setTimeout(() => {
        sandbox = startStubSandbox({
          assignment,
          runId,
          exec,
          receiptSha: null,
          publish: false,
          clock: clock21,
          invokeRun: async () => {
            t21 += assignment.ttlMs + 1_000 // the claim is now expired on this test's clock
            await sleep(1_500)              // give the watch loop ticks to observe it
            return { gateGreen: false }
          },
        })
      }, 10)
    })

    const { detail } = await driveOne({
      ...driveDefaults,
      dbDir: path.join(tmp, 'db21'),
      exec,
      runId,
      clock: clock21,
      ttlMs: 5_000,
      heartbeatTimeoutMs: 20_000,
      settleMs: 200,
    })
    await sandbox

    assert.ok(
      detail.errors.some((e) => /claim expired mid-watch \(ttlMs=5000\)/.test(e)),
      `expected a named lease-expiry error, got: ${JSON.stringify(detail.errors)}`,
    )
  }
```

If `startStubSandbox` does not currently accept `invokeRun` / `clock` overrides, add those optional parameters (defaulting to its current behavior — the shared frozen `clock` and its existing resolve) as part of this task — test scaffolding, additive only.

- [ ] **Step 2: Run to verify failure**

Run: `node fleet/tests/test_drive.mjs`
Expected: FAIL — `detail.capTokens` is 2_000_000, delivered ttlMs is 900_000, and no `claim expired mid-watch` error exists.

- [ ] **Step 3: Implement in `fleet/drive.mjs`** — change the two defaults in the `driveOne` destructure:

```js
  // #279: ttlMs is the store-token lease TTL delivered to the sandbox. 15 min
  // was a smoke-run constant; a real plan's engine phase runs for hours, and an
  // expired lease surfaces two stages away as a heartbeat timeout. 4h covers
  // any single-plan drain (run-9b precedent).
  ttlMs = 4 * 60 * 60_000,
  // W2 charter constant, from measured burn (run-13: 115_256 on a real
  // drained-issue plan; the engine's fixed floor is ~45k). Replaces the 2M
  // placeholder.
  capTokens = 500_000,
```

Add lease-expiry legibility in the watch loop: declare `let leaseExpiryNoted = false` beside `let timedOut = false`, and immediately after the `observeClaim()` call inside the `for (;;)` watch loop add:

```js
      if (sawExpired && !leaseExpiryNoted) {
        leaseExpiryNoted = true
        const msg = `claim expired mid-watch (ttlMs=${ttlMs}) — lease/token expiry, not an engine stall`
        errors.push(msg)
        note(msg)
      }
```

Do NOT break the loop on expiry — teardown timing is unchanged (breaking early would destroy a sandbox under a possibly-live engine, the exact #299 failure). This item is legibility only.

- [ ] **Step 4: Update `fleet/RUNBOOK.md`** — three edits:
  1. In the driver snippet: `capTokens: 2_000_000,` → `capTokens: 500_000,           // W2 charter constant (from measured burn); raise only on an explicit operator call`.
  2. After the snippet's `ttlMs` line, extend the comment guidance: `ttlMs: 4 * 60 * 60 * 1000,` → keep, and add on the following comment line: `// ttlMs = store-token lease TTL. Size to the plan's expected wall clock with margin: 4h covers any single-plan drain (#279 — a 15-min lease on a real plan expires mid-run and reads as a heartbeat timeout).`
  3. The paragraph beginning `` `driveOne` defaults `runId` to `run-1` and `capTokens` to `2_000_000` `` → rewrite to name the new defaults: `` `driveOne` defaults `runId` to `run-1`, `capTokens` to `500_000` (W2 charter constant), and `ttlMs` to 4h — still pass explicit `runId` (never reuse one, #211) and pass `capTokens`/`ttlMs` explicitly for anything unusual. ``

- [ ] **Step 5: Run tests**

Run: `node fleet/tests/test_drive.mjs && python3 -m pytest tests/test_fleet_suite.py -q`
Expected: PASS. If any existing drive test implicitly asserted the old defaults, fix the test's explicit options rather than weakening the new assertions.

- [ ] **Step 6: Commit**

```bash
git add fleet/drive.mjs fleet/RUNBOOK.md fleet/tests/test_drive.mjs
git commit -m "fix(fleet): real-plan drive defaults — ttlMs 4h, capTokens 500k, named lease-expiry error (#279)"
```

---

### Task 3: #290 residual coverage — provisioner seam + isSafeVmName tests

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `fleet/drive.mjs`
- Test: `fleet/tests/test_drive.mjs`

**Commutes:** `fleet/tests/test_drive.mjs`

**Interfaces:**
- Consumes: nothing from sibling tasks.
- Produces: `driveOne` gains optional `provision = provisionRun` and `destroy = destroySandbox` parameters (defaulting to the real module functions; behavior unchanged when omitted).

**Status of #290's three items:** item 1 (joins inside try) and the guard hoist half of item 2 landed with #297/#298 — verify, don't re-fix. Item 3 (sizing pass-through) is covered by existing test 19. What remains: `isSafeVmName` has ZERO direct test coverage (`grep -c isSafeVmName fleet/tests/test_drive.mjs` → 0 today), and `pullLogsOnce`'s refusal branch is unreachable through the public surface (post-#298, `provisionRun` always derives a safe name) — so it needs an injection seam to be testable at all.

- [ ] **Step 1: Write the failing tests** — append to `fleet/tests/test_drive.mjs` (import `isSafeVmName` from `../drive.mjs` alongside the existing imports):

```js
  // -- 22. isSafeVmName accept/reject rows (#290-2 residual) ------------------
  {
    for (const good of ['fleet-run-14', 'a', 'A1._-b', 'fleet-run13', 'x'.repeat(64)]) {
      assert.equal(isSafeVmName(good), true, `expected accept: ${good}`)
    }
    for (const bad of ['', ' ', 'fleet run', 'a;b', 'a$(x)', '-leading', '.leading', 'a\nb', 'x'.repeat(65), null, undefined, 42]) {
      assert.equal(isSafeVmName(bad), false, `expected reject: ${JSON.stringify(bad)}`)
    }
  }

  // -- 23. pullLogsOnce refusal branch (#290-2): a provisioner that returns a
  // mutated unsafe vmName gets its sandbox-addressed captures REFUSED (no ssh
  // command ever carries the bad name), the refusal lands in detail.errors,
  // the credits capture (interpolates nothing) still runs, and teardown is
  // still invoked.
  {
    const runId = 'run-drive-23'
    const exec = makeExec(() => {})
    const destroyed = []
    const badName = 'evil;name'

    const { detail } = await driveOne({
      ...driveDefaults,
      dbDir: path.join(tmp, 'db23'),
      exec,
      runId,
      claimTimeoutMs: 500,
      heartbeatTimeoutMs: 60_000,
      tickMs: 50,
      settleMs: 100,
      provision: async () => ({ vmName: badName }),
      destroy: async ({ vmName }) => {
        destroyed.push(vmName)
      },
    })

    assert.ok(
      detail.errors.some((e) => /unsafe vm name/.test(e)),
      `expected an unsafe-vm-name refusal in errors, got: ${JSON.stringify(detail.errors)}`,
    )
    assert.ok(
      !exec.cmds.some((c) => c.includes(badName)),
      `no shelled command may carry the unsafe name, got: ${JSON.stringify(exec.cmds.filter((c) => c.includes(badName)))}`,
    )
    assert.ok(
      exec.cmds.some((c) => c.includes('billing credits usage')),
      'the credits capture interpolates nothing and must still run',
    )
    assert.deepEqual(destroyed, [badName], 'teardown must still be invoked exactly once')
  }
```

- [ ] **Step 2: Run to verify failure**

Run: `node fleet/tests/test_drive.mjs`
Expected: FAIL — `driveOne` does not accept `provision`/`destroy` (test 23 provisions for real via scripted exec and never sees the refusal).

- [ ] **Step 3: Add the seam in `fleet/drive.mjs`** — add to the `driveOne` destructure (beside `exec`):

```js
  // Injection seams for the provision/teardown legs — the real module
  // functions by default. They exist so the pullLogsOnce refusal branch
  // (defense in depth against a mid-run vmName mutation; unreachable through
  // the public surface post-#298) is testable at all (#290-2).
  provision = provisionRun,
  destroy = destroySandbox,
```

Then replace the two internal call sites: `await provisionRun({ ... })` → `await provision({ ... })` and `await destroySandbox({ vmName, port: effectivePort, exec })` → `await destroy({ vmName, port: effectivePort, exec })`. No other behavior change.

- [ ] **Step 4: Run tests**

Run: `node fleet/tests/test_drive.mjs && python3 -m pytest tests/test_fleet_suite.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add fleet/drive.mjs fleet/tests/test_drive.mjs
git commit -m "test(fleet): isSafeVmName rows + pullLogsOnce refusal branch via provision/destroy seams (#290)"
```

---

### Task 4: Fleet evidence bundles as harvest input (#292, instruction-only)

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultralearn/SKILL.md`
- Modify: `skills/ultralearn/references/reading-lenses.md`

**Interfaces:**
- Consumes: nothing from sibling tasks. (The `detail` field names below are the CURRENT `fleet/drive.mjs` contract — `errors`, `timedOut`, `neverClaimed`, `publishTimedOut`, `sandboxStat`, `creditSpendUsd` — all already shipped; no dependency on Tasks 1–3.)
- Produces: nothing consumed by sibling tasks.

**Why (from #292):** all four run-9 drive failures reached the tracker only via operator hand-filing; the harvester structurally cannot see the drive layer. Instruction-first per doctrine: name the evidence layout in the harvest brief, point two lenses at the structured detail — no harvester code, no new agent, no live pipe.

- [ ] **Step 1: Extend the Harvest step in `skills/ultralearn/SKILL.md`** — inside item 1 (**Harvest.**), after the sentence ending `record the miss as a ledger finding.`, append this paragraph (same indent, still inside item 1):

```markdown
   **Fleet evidence bundles are harvest bundles** (#292): the drive layer is
   invisible to the detector too, so a fleet run's evidence dir is first-class
   sense input, read the commissioned way. Layout (per run, under the repo's
   `.claude/ultrapowers/fleet-runs-<date>/` or the orchestrator's
   `<dbDir>-evidence/`): `gate-read-<runId>.json` (the §W1d read, verbatim) +
   `gate-read-<runId>.detail.json` (triage detail), `stat.json` + `credits.json`
   (raw control-plane payloads), and `sandbox-logs/<vm>-<stamp>/sandbox-logs.tgz`
   holding `shim.log`, `fleet-run.json`, the engine transcripts
   (`.claude/projects`), and the in-repo `run-*/` dirs. Dispatch one reader per
   fleet run with the bundle contents; readers set `evidenceAbstracted: true`,
   use the fleet `runId` as `runId`, and stamp `engineVersion` from the run's
   version stamp. Pilot corpus: `.claude/ultrapowers/fleet-runs-2026-08-26/`
   (four distinct drive failure modes + one green engine run) and
   `fleet-runs-2026-08-27/` (run-13, green).
```

- [ ] **Step 2: Point the friction and cost lenses at the drive detail in `skills/ultralearn/references/reading-lenses.md`** — extend the two lens definitions (additive sentences; the output JSON contract is untouched):

To lens 1 (**friction**), append:

```markdown
   For a FLEET bundle, read the drive's structured artifact first:
   `detail.errors`, `detail.timedOut`, `detail.neverClaimed`, and
   `detail.publishTimedOut` in `gate-read-<runId>.detail.json` name the
   drive-layer seam (lease expiry, transport death, publish loss) that
   `shim.log` then evidences.
```

To lens 4 (**cost**), append:

```markdown
   For a FLEET bundle, also read `detail.sandboxStat` ({peakCores, meanCores,
   peakMemBytes} — a floor estimate), `detail.creditSpendUsd` (the
   gateway-regression canary: fleet-golden baseline ~$0.78/month; growth =
   flag it), and the raw `stat.json`/`credits.json` beside the gate read —
   the same aggregation W2's spend-tolerance and sandbox-sizing verdicts use.
```

- [ ] **Step 3: Verify nothing pins these files and the suite stays green**

Run: `python3 -m pytest -q`
Expected: PASS (ultralearn SKILL.md is not ceiling-pinned — `tests/test_skill_budget.py` pins only ultrapowers/ultraplan SKILL.md — and no drift test pins reading-lenses.md; if any test DOES fail on these files, stop and surface it rather than adjusting the test).

- [ ] **Step 4: Commit**

```bash
git add skills/ultralearn/SKILL.md skills/ultralearn/references/reading-lenses.md
git commit -m "docs(ultralearn): fleet evidence bundles as harvest input; friction+cost lenses read gate-read detail (#292)"
```

---

### Task 5: Suite gate

**Type:** gate
**Depends-on:** 1, 2, 3, 4

**Files:**
- Test: `tests/test_fleet_suite.py`

- [ ] **Step 1: Full gate**

Run: `python3 -m pytest`
Expected: PASS — baseline 1183+ tests, including `tests/test_fleet_suite.py` which runs every `fleet/tests/*.mjs` within its 120s cap.

---

## Operator smoke

- do: on the orchestrator, run the RUNBOOK driver snippet against a trivial plan WITHOUT passing `ttlMs`/`capTokens`, and read the delivered `fleet-run.json` plus `gate-read-<runId>.detail.json`.
  see: the assignment carries `ttlMs: 14400000` and the detail carries `capTokens: 500000` — the real-plan defaults, no explicit override needed.
- do: during a live run's engine phase, kill the reverse-tunnel ssh process on the orchestrator (simulating a mid-run socket drop), then watch the drive's progress lines.
  see: shim.log logs `ws connection lost mid-run — reconnecting` then `ws reconnected mid-run` once the tunnel is re-established, and the drive keeps printing progress instead of running down the 30-min heartbeat clock.
- do: after any fleet run, read the last line of `shim.log` / the shim's printed outcome JSON.
  see: the outcome now carries a `delivered: true|false` field, and a non-delivered outcome exits non-zero.
- do: run an ultralearn sense pass and hand a reader the `fleet-runs-2026-08-27/` bundle.
  see: findings cite `detail.*` fields (errors/timedOut/creditSpendUsd) rather than only transcript prose.
