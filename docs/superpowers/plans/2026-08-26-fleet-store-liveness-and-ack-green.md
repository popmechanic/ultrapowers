# Fleet Store Liveness (#288) + Self-Approved Ack Green (#191) Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a fleet run's store transport verified-and-loud (no more silent dead-socket runs), give long runs a real progress signal, let a legitimately self-approved NEEDS_ACK run count as gate-green, and land the #290/#282/#211 ride-alongs.

**Architecture:** All changes live in `fleet/**` + `fleet/RUNBOOK.md`. The shim gains a verified ws connect (fail-fast before tokens burn), a verified publish (flush + one rescue reconnect), and a capped renew cadence; the driver gains a claim deadline and live progress lines; `readGateGreen` becomes verdict-shaped with a three-leg NEEDS_ACK evidence contract. No engine surface, no FROZEN-periphery file is touched.

**Tech Stack:** Node ESM (`fleet/*.mjs`), tinybase 6 MergeableStore + ws synchronizers, sims in `fleet/tests/test_*.mjs` (auto-discovered by `tests/test_fleet_suite.py`, 120 s cap per file, must print `ALL TESTS PASSED`).

**Spec:** `docs/superpowers/specs/2026-08-26-fleet-store-liveness-and-ack-green.md`

**Acceptance:** suite — the committed fleet sims plus the full pytest suite are the verification; no seal requested.

## Global Constraints

- Only `fleet/**`, `fleet/RUNBOOK.md`, this plan's spec, and fleet tests may change. `skills/ultrapowers/scripts/*`, `harnesses/waves.js`, `skills/ultrapowers/references/*` are off-limits (FROZEN periphery / parallel session's lane).
- Every `fleet/tests/test_*.mjs` exits 0 printing `ALL TESTS PASSED` within 120 s; all test servers bind ephemeral ports (`port: 0`) and unique temp dirs — never a fixed port or shared fixture.
- No new npm dependencies (`fleet/package.json` stays `tinybase ^6`, `ws ^8`).
- Sandbox-authored values are validated before shell interpolation (existing `isSafe*` posture); no `Date.now()`-independent logic regressions — `clock` stays an input to decisions, wall time to timeouts.
- Lobby commands (`ssh exe.dev "…"`) keep the default ssh config; only sandbox-bound (`fleet-<runId>.exe.xyz`) commands get the no-pin host-key flags.

---

### Task 1: Verified ws transport + verified publish + renew cadence cap

**Type:** implementation
**Depends-on:** none
**Review:** adversarial

**Files:**
- Modify: `fleet/shim.mjs`
- Modify: `fleet/shim-main.mjs`
- Create: `fleet/tests/test_shim_transport.mjs`

**Interfaces:**
- Consumes: `tryClaim`, `tryRenew`, `spendRowId`, `legalTransition` (fleet/store.mjs, unchanged).
- Produces (all exported from `fleet/shim.mjs`):
  - `connectOpenWs(url: string, {timeoutMs?: number, log?: (s)=>void}): Promise<WebSocket>` — resolves an OPEN socket with logging `close`/`error` listeners attached, or rejects with a legible reason.
  - `renewIntervalFor(ttlMs: number, renewEveryMs?: number): number`
  - `RENEW_CAP_MS = 300_000`, `CONNECT_TIMEOUT_MS = 30_000`, `FLUSH_TIMEOUT_MS = 5_000`, `FLUSH_SETTLE_MS = 250`
  - `flushSynchronizer(synchronizer, ws): Promise<void>`
  - `deliverAndClose({store, synchronizer, ws, url, openSocket?, log?}): Promise<boolean>` — flush if OPEN, else one rescue reconnect over the same store; always tears down; returns whether delivery happened.
  - `runShim(opts)` gains `openSocket = connectOpenWs` and `log = console.error` params and a new terminal `{status: 'no-store', error}` outcome.

**Parallelization rationale:** transport/publish mechanics are self-contained in the shim pair; Tasks 2–4 touch disjoint functions and fold at merge.

- [ ] **Step 1: Write the failing sims** — create `fleet/tests/test_shim_transport.mjs` following `test_shim.mjs`'s structure (bare relay `createWsServer(new WebSocketServer({port: 0}))`, per-path rooms, `ALL TESTS PASSED` sentinel, `process.exit`). Scenarios:

```js
// 1. renewIntervalFor is capped
assert.equal(renewIntervalFor(14_400_000), 300_000)        // 4 h ttl → 5 min cadence
assert.equal(renewIntervalFor(300), 100)                    // small ttl → ttl/3
assert.equal(renewIntervalFor(14_400_000, 80), 80)          // explicit override wins

// 2. connection refused → no-store, engine never invoked
//    (bind a server, note its port, close it, connect to the dead port)
let invoked = false
const result = await runShim({
  wsUrl: `ws://127.0.0.1:${deadPort}/x`, token: 't', sandboxId: 'sb', runId: 'r1',
  ttlMs: 300, invokeRun: () => { invoked = true; return Promise.resolve({ gateGreen: true }) },
  readReportTokens: () => null,
  openSocket: (url) => connectOpenWs(url, { timeoutMs: 2_000, log: () => {} }),
})
assert.equal(result.status, 'no-store')
assert.ok(typeof result.error === 'string' && result.error.length > 0)
assert.equal(invoked, false)

// 3. 401 handshake rejection → no-store (WebSocketServer({port: 0, verifyClient: () => false}))
// same assertions as scenario 2 against that server's live port

// 4. connect timeout → no-store: a net.createServer that accepts and never
//    upgrades; openSocket override with timeoutMs 300; assert /timeout/.test(result.error)

// 5. dead-socket-at-terminal rescue — THE #288 shape:
//    helper client joins path 't5' first and stays; snapshot wssClientsBefore;
//    runShim on 't5' with invokeRun that (a) finds the shim's server-side socket
//    (the wss.clients member not in the snapshot), (b) socket.terminate()s it,
//    (c) waits 150 ms, (d) resolves { gateGreen: true }.
//    After runShim resolves, poll the helper store up to 3 s:
assert.equal(result5.status, 'gate-green')
//    …poll until:
assert.equal(helper.store.getRow('runs', 'r1').status, 'gate-green',
  'terminal status must arrive via the rescue reconnect')

// 6. live-socket flush: normal gate-green run (as test_shim.mjs scenario 1) but
//    assert the helper store holds status 'gate-green' within 1 s of runShim
//    resolving (poll, no fixed long sleep).
```

- [ ] **Step 2: Run to verify failure** — `node fleet/tests/test_shim_transport.mjs` → fails (`connectOpenWs` not exported).

- [ ] **Step 3: Implement in `fleet/shim.mjs`.** Add exports:

```js
export const CONNECT_TIMEOUT_MS = 30_000
export const RENEW_CAP_MS = 5 * 60_000
export const FLUSH_TIMEOUT_MS = 5_000
export const FLUSH_SETTLE_MS = 250

export const renewIntervalFor = (ttlMs, renewEveryMs) =>
  renewEveryMs ?? Math.min(Math.floor(ttlMs / 3), RENEW_CAP_MS)

export const connectOpenWs = (url, { timeoutMs = CONNECT_TIMEOUT_MS, log = console.error } = {}) =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    const timer = setTimeout(() => {
      try { ws.terminate() } catch {}
      reject(new Error(`ws connect timeout after ${timeoutMs}ms`))
    }, timeoutMs)
    ws.once('open', () => {
      clearTimeout(timer)
      ws.on('close', (code) => log(`fleet: ws closed (code ${code})`))
      ws.on('error', (err) => log(`fleet: ws error — ${err?.message ?? err}`))
      resolve(ws)
    })
    ws.once('error', (err) => { clearTimeout(timer); reject(new Error(`ws connect failed: ${err?.message ?? err}`)) })
    ws.once('close', (code) => { clearTimeout(timer); reject(new Error(`ws closed during connect (code ${code})`)) })
  })

export const flushSynchronizer = async (synchronizer, ws) => {
  await synchronizer.save()
  const deadline = Date.now() + FLUSH_TIMEOUT_MS
  while (Date.now() < deadline && ws.bufferedAmount > 0) await new Promise((r) => setTimeout(r, 25))
  await new Promise((r) => setTimeout(r, FLUSH_SETTLE_MS))
}

export const deliverAndClose = async ({ store, synchronizer, ws, url, openSocket = connectOpenWs, log = console.error }) => {
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
```

In `runShim`: signature gains `openSocket = connectOpenWs, log = console.error`; `renewInterval` uses `renewIntervalFor(ttlMs, renewEveryMs)`; the socket is opened first —

```js
const url = withToken(wsUrl, token)
let ws
try {
  ws = await openSocket(url, { log })
} catch (error) {
  return { status: 'no-store', error: String(error?.message ?? error) }
}
const store = createMergeableStore(sandboxId)
const synchronizer = await createWsSynchronizer(store, ws)
await synchronizer.startSync()
```

Every teardown site (`lost-claim`, claim-lost `failed`, `gate-green`, parked `failed`) becomes `await deliverAndClose({ store, synchronizer, ws, url, openSocket, log })` in place of the old `teardown()`. In the renew loop, log once if the socket is found dead: `if (ws.readyState !== WebSocket.OPEN && !deadLogged) { deadLogged = true; log('fleet: ws connection lost mid-run — will rescue at publish') }`.

- [ ] **Step 4: Wire `fleet/shim-main.mjs`.** Import `{ runShim, connectOpenWs, deliverAndClose }` from `./shim.mjs`. In `main()`: the aux client's socket comes from `await connectOpenWs(withToken(wsUrl, token), { log: console.error })` — a rejection propagates to the `invokedDirectly` catch (logged `fleet shim-main failed: …`, exit 1) so the engine never launches with a dead aux transport. The trailing `await synchronizer.save(); stopSync; destroy` tail becomes `await deliverAndClose({ store, synchronizer, ws, url: withToken(wsUrl, token), log: console.error })`.

- [ ] **Step 5: Run the new sim and the neighbors** — `node fleet/tests/test_shim_transport.mjs && node fleet/tests/test_shim.mjs && node fleet/tests/test_shim_main_tokens.mjs` → all print `ALL TESTS PASSED`.

- [ ] **Step 6: Commit** — `git add fleet/shim.mjs fleet/shim-main.mjs fleet/tests/test_shim_transport.mjs && git commit -m "fix(fleet): verified ws transport, verified publish, renew cadence cap (#288)"`

---

### Task 2: Verdict-shaped gate green — self-approved NEEDS_ACK counts (#191)

**Type:** implementation
**Depends-on:** none
**Review:** adversarial

**Files:**
- Modify: `fleet/shim-main.mjs`
- Create: `fleet/tests/test_shim_main_gate.mjs`

**Interfaces:**
- Consumes: nothing from sibling tasks (edits `readGateGreen` + `STANDING_DIRECTIVE`, disjoint from Task 1's regions of the same file).
- Produces: `readGateGreen(receiptFile: string): boolean` (same name/arity — semantics extended), `GRANTED_ACK_TYPES: Set<string>` (exported from `fleet/shim-main.mjs`).

**Parallelization rationale:** pure-function verdict logic + fixtures; no shared symbols with Task 1's transport work.

- [ ] **Step 1: Write the failing sims** — `fleet/tests/test_shim_main_gate.mjs`, pure-fs fixtures under `fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-gate-'))`, one fresh dir per scenario shaped `<tmp>/.claude/ultrapowers/run-<stamp>/`. Helper:

```js
const stamp = '20260826-120000'
const mkRun = (t, { verdict, acks = [], standing = null, approve = null, lock = null }) => {
  const runDir = path.join(t, '.claude', 'ultrapowers', `run-${stamp}`)
  fs.mkdirSync(runDir, { recursive: true })
  const receiptFile = path.join(runDir, 'gate-receipt.json')
  fs.writeFileSync(receiptFile, JSON.stringify({ mode: 'gate', stamp, verdict, gateCheck: { verdict, acks } }))
  if (standing) fs.writeFileSync(path.join(runDir, 'standing-approval.json'), JSON.stringify(standing))
  if (approve) fs.writeFileSync(path.join(runDir, 'approve-receipt.json'), JSON.stringify(approve))
  if (lock !== null) fs.writeFileSync(path.join(runDir, '..', 'RUN_LOCK'), lock)
  return receiptFile
}
const EXT = { type: 'deferred:external', detail: 'live shape unverified' }
const RUN = { type: 'deferred:runtime', detail: 'timing-dependent' }
const STANDING = { grantedAt: 'launch directive', instruction: 'x', ackList: [] }
const APPROVE = { mode: 'approve', stamp, branch: 'ultra/integration-x', swept: {} }
```

Assertions (each in its own temp root):

```js
assert.equal(readGateGreen(mkRun(t1, { verdict: 'PASS' })), true)
assert.equal(readGateGreen(mkRun(t2, { verdict: 'BLOCKED' })), false)
assert.equal(readGateGreen(mkRun(t3, { verdict: 'NEEDS_ACK', acks: [EXT] })), false)                       // bare NEEDS_ACK never greens
assert.equal(readGateGreen(mkRun(t4, { verdict: 'NEEDS_ACK', acks: [EXT, RUN], standing: STANDING, approve: APPROVE })), true)  // all three legs
assert.equal(readGateGreen(mkRun(t5, { verdict: 'NEEDS_ACK', acks: [EXT], approve: APPROVE })), false)      // no standing sidecar
assert.equal(readGateGreen(mkRun(t6, { verdict: 'NEEDS_ACK', acks: [EXT, { type: 'deferred:manual', detail: 'operator step' }], standing: STANDING, approve: APPROVE })), false)  // manual ack outside the grant
assert.equal(readGateGreen(mkRun(t7, { verdict: 'NEEDS_ACK', acks: [{ type: 'coverage', detail: 'incomplete' }], standing: STANDING, approve: APPROVE })), false)
assert.equal(readGateGreen(mkRun(t8, { verdict: 'NEEDS_ACK', acks: [], standing: STANDING, approve: APPROVE })), false)          // empty acks never green vacuously
assert.equal(readGateGreen(mkRun(t9, { verdict: 'NEEDS_ACK', acks: [EXT], standing: STANDING })), false)     // approve receipt missing
assert.equal(readGateGreen(mkRun(t10, { verdict: 'NEEDS_ACK', acks: [EXT], standing: STANDING, approve: { ...APPROVE, mode: 'teardown' } })), false)
assert.equal(readGateGreen(mkRun(t11, { verdict: 'NEEDS_ACK', acks: [EXT], standing: STANDING, approve: { ...APPROVE, stamp: '19990101-000000' } })), false)
assert.equal(readGateGreen(mkRun(t12, { verdict: 'NEEDS_ACK', acks: [EXT], standing: STANDING, approve: APPROVE, lock: stamp })), false)   // RUN_LOCK still held by this stamp — approve did not release
assert.equal(readGateGreen(mkRun(t13, { verdict: 'NEEDS_ACK', acks: [EXT], standing: STANDING, approve: APPROVE, lock: 'other-run' })), true) // a different run's lock is not ours
assert.equal(readGateGreen(path.join(t14, 'nope.json')), false)                                              // missing/unreadable receipt
assert.ok(STANDING_DIRECTIVE.includes('approve-receipt.json'), 'directive must instruct saving the approve receipt')
```

- [ ] **Step 2: Run to verify failure** — `node fleet/tests/test_shim_main_gate.mjs` → t4/t13 fail (current code greens only PASS) and the directive assertion fails.

- [ ] **Step 3: Implement in `fleet/shim-main.mjs`.** Replace `readGateGreen`:

```js
/** Ack types inside the #281 standing grant — everything else parks. */
export const GRANTED_ACK_TYPES = new Set(['deferred:runtime', 'deferred:external'])

export const readGateGreen = (receiptFile) => {
  const receipt = readJson(receiptFile)
  if (!receipt) return false
  if (receipt.verdict === 'PASS') return true
  if (receipt.verdict !== 'NEEDS_ACK') return false

  // A self-approved NEEDS_ACK greens only on three legs of evidence, all read
  // from the same run directory as the machine-written receipt. Fail-closed:
  // any missing or malformed leg parks.
  const runDir = path.dirname(receiptFile)
  if (!readJson(path.join(runDir, 'standing-approval.json'))) return false

  const acks = receipt.gateCheck?.acks
  if (!Array.isArray(acks) || acks.length === 0) return false
  if (!acks.every((a) => GRANTED_ACK_TYPES.has(a?.type))) return false

  const approve = readJson(path.join(runDir, 'approve-receipt.json'))
  if (approve?.mode !== 'approve') return false
  if (typeof receipt.stamp !== 'string' || receipt.stamp.length === 0) return false
  if (approve.stamp !== receipt.stamp) return false

  // The approve's own on-disk side effect: run_lock.sh release removes the
  // lock when it holds this stamp. A lock still naming this stamp means the
  // approve never actually ran.
  let lockHolder = null
  try {
    lockHolder = fs.readFileSync(path.join(runDir, '..', 'RUN_LOCK'), 'utf8')
  } catch {
    lockHolder = null
  }
  if (lockHolder === receipt.stamp) return false
  return true
}
```

Amend `STANDING_DIRECTIVE`: after the `standing-approval.json` clause, insert: `Then execute the Approve (ultra_gate.py --approve) and save its JSON output verbatim to run-<stamp>/approve-receipt.json — the fleet shim greens the run only on that receipt.` Keep the rest of the directive byte-identical.

- [ ] **Step 4: Run the sims** — `node fleet/tests/test_shim_main_gate.mjs && node fleet/tests/test_shim_main_tokens.mjs` → `ALL TESTS PASSED` both.

- [ ] **Step 5: Commit** — `git add fleet/shim-main.mjs fleet/tests/test_shim_main_gate.mjs && git commit -m "fix(fleet): self-approved NEEDS_ACK greens on three-leg evidence (#191)"`

---

### Task 3: Driver claim deadline, live progress, #290 teardown residuals

**Type:** implementation
**Depends-on:** none
**Review:** adversarial
**Commutes:** `fleet/tests/test_drive.mjs`

**Files:**
- Modify: `fleet/drive.mjs`
- Modify: `fleet/tests/test_drive.mjs`

**Interfaces:**
- Consumes: `provisionRun`, `destroySandbox` (fleet/provision.mjs, unchanged signatures).
- Produces: `driveOne` gains `claimTimeoutMs = 10 * 60_000` and `progressLog` options; the detail object gains `neverClaimed: boolean`.

**Parallelization rationale:** driver watch-loop + teardown internals; Task 4 edits only command-builder functions in the same files (fold at merge).

- [ ] **Step 1: Write the failing sims** (append to `fleet/tests/test_drive.mjs`, following its existing fake-exec harness):
  - **never-claimed fail-fast:** driveOne with a scripted exec whose shim never writes anything, `claimTimeoutMs: 500`, `heartbeatTimeoutMs: 60_000`, `tickMs: 50`. Assert: returns within a few seconds (not the heartbeat bound); `detail.neverClaimed === true`; `detail.errors` contains a string matching `/never claimed/`; the teardown still ran — the exec log contains the `rm fleet-<runId>` command AND the evidence-pull command (pins #290's teardown-always theme); the report + detail files exist on disk.
  - **progress lines:** same drive with `progressLog: (line) => lines.push(line)`; assert `lines.some(l => /provision/.test(l))` and `lines.some(l => /never claimed/.test(l))`.
  - **unsafe vm name refusal (#290-2):** driveOne with `runId: 'run 1'` (space). Assert `detail.errors` contains a string matching `/unsafe vm name/`, and no executed command contains `stat fleet-run 1` and no evidence-pull `tar` command names `fleet-run 1.exe.xyz` — the guard now precedes every vmName interpolation in the pull path.
  - **sizing pass-through (#290-3):** driveOne with `sandboxCpu: 2, sandboxMemory: '8GB', sandboxDisk: '30GB'` and a scripted exec; assert the executed clone command contains `--cpu=2 --memory=8GB --disk=30GB`.

- [ ] **Step 2: Run to verify failures** — `node fleet/tests/test_drive.mjs` → new scenarios fail.

- [ ] **Step 3: Implement in `fleet/drive.mjs`:**
  - Options: `claimTimeoutMs = 10 * 60_000`, `progressLog = (line) => console.error(`[drive ${new Date().toISOString()}] ${line}`)`.
  - Watch loop: track `const watchStartedAt = Date.now()` (set after provisioning) and `let neverClaimed = false`. Inside the loop, after computing `key`: if `status === 'pending'` and `!store.getRow('claims', \`claim:${runId}\`)` and `Date.now() - watchStartedAt > claimTimeoutMs` → `neverClaimed = true; errors.push(\`sandbox never claimed within ${claimTimeoutMs}ms — transport dead or shim failed to start\`); break`. The break exits into the existing teardown path unchanged (evidence pull, destroy, report write). Add `neverClaimed` to `detail`.
  - `progressLog` calls at: provision start (`provisioning ${vmName} from ${golden}`), provision done, every progress-key change (`progress: status=${status} claims=${…} spend=${…} receipts=${…}`), heartbeat timeout, never-claimed stop, terminal status, publish-wait start/end, teardown start, and the final `gate read written to ${resolvedReportPath}`. Wrap each call site's argument construction so a throwing `progressLog` never breaks the drive: `const note = (line) => { try { progressLog(line) } catch {} }`.
  - **#290-1:** move the `path.join` lines inside their try blocks — in `pullLogsOnce`, `dir`/`dest` computed inside the first `try`; in `captureJson`, `destination` computed inside its `try`.
  - **#290-2:** hoist the `isSafeVmName(vmName)` refusal to the TOP of `pullLogsOnce` (before the tar pull, which also interpolates `vmName`): on refusal push the error once and skip the pull AND the stat capture (the credits capture interpolates nothing and may proceed).

- [ ] **Step 4: Run the sims** — `node fleet/tests/test_drive.mjs` → `ALL TESTS PASSED`.

- [ ] **Step 5: Commit** — `git add fleet/drive.mjs fleet/tests/test_drive.mjs && git commit -m "feat(fleet): claim deadline + live progress in driveOne; #290 teardown residuals (#288, #290)"`

---

### Task 4: Sandbox host-key posture (#211), shim runs fleet-base, RUNBOOK papercuts (#282)

**Type:** implementation
**Depends-on:** none
**Review:** lean

**Files:**
- Modify: `fleet/provision.mjs`
- Modify: `fleet/drive.mjs`
- Modify: `fleet/tests/test_provision.mjs`
- Modify: `fleet/tests/test_drive.mjs`
- Modify: `fleet/RUNBOOK.md`

**Interfaces:**
- Consumes: nothing from sibling tasks.
- Produces: `SANDBOX_SSH_OPTS: string` (exported from `fleet/provision.mjs`), `sandboxGitSsh: string` (the `core.sshCommand` value, exported for the drive-side fetch to reuse).

**Parallelization rationale:** command-builder strings + docs only; Task 3 edits the watch loop/teardown internals of the same files (fold at merge).

- [ ] **Step 1: Write/adjust the failing pins:**
  - `fleet/tests/test_provision.mjs`: update every pinned command string; add asserts that each sandbox-bound command (probe, assignment delivery, env delivery, tunnel, shim start) contains `-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null`; the base-ref push contains `-c core.sshCommand=` with those flags; the lobby clone (`ssh exe.dev "cp …"`) and `destroySandbox`'s `rm` contain NEITHER flag.
  - Shim-start pin (exact shape, `withEngineEnv` false):
    `ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null <vm>.exe.xyz 'git -C /home/exedev/repo checkout -q fleet-base > /home/exedev/shim.log 2>&1 && nohup node /home/exedev/repo/fleet/shim-main.mjs >> /home/exedev/shim.log 2>&1 &'`
    and with `withEngineEnv` true the `set -a && . /home/exedev/fleet-env && set +a && ` prefix sits between `&&` and `nohup`. Assert the checkout precedes `nohup`, is `&&`-gated, truncates the log (`>`), and node appends (`>>`).
  - `fleet/tests/test_drive.mjs`: `sandboxLogPullCommand` and the branch-fetch command contain the two flags; `sandboxStatCommand`/`creditsUsageCommand` (lobby) do not.

- [ ] **Step 2: Run to verify failures** — `node fleet/tests/test_provision.mjs && node fleet/tests/test_drive.mjs`.

- [ ] **Step 3: Implement:**
  - `fleet/provision.mjs`: `export const SANDBOX_SSH_OPTS = '-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null'` and `export const sandboxGitSsh = \`ssh ${SANDBOX_SSH_OPTS}\``. Thread `SANDBOX_SSH_OPTS` into the probe (replacing its lone `StrictHostKeyChecking=no`), assignment delivery, env delivery, `tunnelCommand`, `shimStartCommand`; the push becomes `git -C ${repoDir} -c core.sshCommand="${sandboxGitSsh}" push ssh://…`. `shimStartCommand` adopts the pinned shape above (checkout `fleet-base` first, log-gated). Lobby commands unchanged.
  - `fleet/drive.mjs`: import `SANDBOX_SSH_OPTS`, `sandboxGitSsh` from `./provision.mjs`; `sandboxLogPullCommand` gains the flags; the receipts fetch becomes `git -C ${repoDir} -c core.sshCommand="${sandboxGitSsh}" fetch ssh://…`.
  - `fleet/RUNBOOK.md`: (1) golden-build verify block gains `ssh fleet-golden.exe.xyz 'claude plugin list'` with the note to compare against `.claude-plugin/plugin.json` on the base ref before any drive, and the update command `claude plugin update ultrapowers@ultrapowers` (the bare name fails — #282); (2) the driveOne snippet gains explicit `runId: 'run-<fresh>', capTokens: 2_000_000, ttlMs: 4 * 60 * 60 * 1000, heartbeatTimeoutMs: 30 * 60_000, claimTimeoutMs: 10 * 60_000` lines with a comment that runIds are **unique per account lifetime — never reuse one** (#211); (3) a Transport bullet noting sandbox-bound ssh uses no-pin host-key flags because sandboxes are ephemeral.

- [ ] **Step 4: Run the sims** — `node fleet/tests/test_provision.mjs && node fleet/tests/test_drive.mjs` → `ALL TESTS PASSED` both.

- [ ] **Step 5: Commit** — `git add fleet/provision.mjs fleet/drive.mjs fleet/tests/test_provision.mjs fleet/tests/test_drive.mjs fleet/RUNBOOK.md && git commit -m "fix(fleet): sandbox no-pin host keys (#211), shim runs fleet-base, RUNBOOK papercuts (#282)"`

---

### Task 5: Full-suite gate

**Type:** gate
**Depends-on:** 1, 2, 3, 4

**Files:**
- Test: `tests/`

- [ ] Run `python3 -m pytest` from the repo root: 1169 baseline + the new fleet sims all green (new `test_*.mjs` files are auto-discovered by `tests/test_fleet_suite.py`; each must print `ALL TESTS PASSED` inside its 120 s cap).

## Operator smoke

- do: on the orchestrator VM, start a drive with a bogus `wsUrl` port (or kill the tunnel right after provision) against a throwaway sandbox
  see: the drive log prints a `sandbox never claimed within 600000ms` line and the drive returns in ~10 min, not 30–120; the pulled `shim.log` names the ws failure (`ws connect failed`/`timeout`) instead of being silent
- do: run the next real fleet drive and tail its nohup log
  see: timestamped `[drive …] progress: status=…` lines appear as the run moves — claim within a minute, lease/spend counts ticking at ≤5-min intervals during the engine phase
- do: after a run whose gate printed NEEDS_ACK with only runtime/external acks, check the gate read
  see: `o1: true` — and the pulled run dir contains `standing-approval.json` + `approve-receipt.json`; a run with a `deferred:manual` ack still parks
- do: `grep 'ws closed' shim.log` on any pulled evidence archive
  see: every socket close is logged with its code — no more zero-evidence transports
