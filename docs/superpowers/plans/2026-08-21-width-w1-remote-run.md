# Width W1 — One Remote Run End-to-End Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Phase W1 of the Width Program — the `fleet/` orchestrator, store, run shim, provisioner, and drive-one path that execute a single ultrapowers run in a disposable exe.dev sandbox end to end.

**Architecture:** A plain TinyBase ws-server (SQLite-persisted) in an orchestrator process coordinates via a pointers-only store; a sandbox-resident shim claims/renews a TTL lease and appends spend rows; the orchestrator alone touches git remotes (pull run branches over SSH, push base refs) and enforces the spend hard-cap via a guard supervisory exemption. All model access in sandboxes rides the exe.dev LLM integration — zero secrets on VMs, zero API keys in repo code.

**Tech Stack:** Node ≥20 ESM (`fleet/*.mjs`), `tinybase@^6` + `ws@^8` (fleet-local deps), `node:test`-free hand-rolled sentinel tests (house pattern), pytest wrapper joins them to the committed suite.

**Spec:** `docs/superpowers/specs/2026-08-21-width-program.md` (rev 4, operator-approved) — §W1a–§W1d govern this plan; §Where-it-lives names the deliverables.

**Acceptance:** suite — phase W1 of the approved multi-phase Width Program spec; its held-out verification is the live §W1d gate read (O1 on real infrastructure), which no repo-committed exam can simulate. W2, the program's final integration phase, carries the integration-spanning acceptance per ultraplan doctrine.

## Global Constraints

- **No `anthropic` SDK and no API key anywhere in `fleet/`** (spec §Where-it-lives; the repo-wide no-API-key rule). Sandboxes use `ANTHROPIC_BASE_URL=https://llm.int.exe.xyz` + a dummy `ANTHROPIC_API_KEY`.
- **The frozen verification periphery is untouched**: no edits under `skills/ultrapowers/scripts/` gate files, `skills/ultrapowers/kernel/`, or seal machinery. `harnesses/waves.js` is unchanged in W1.
- **Store rows carry pointers and small scalars only** — receipts are `{sha, path, verdict}` with verdict display-only; no file content in the store.
- **Sandboxes hold no credentials**: no git credentials, no API keys; only the short-TTL store token, SSH-delivered at provision. Transport is orchestrator-initiated in both directions.
- **Fleet tests must be concurrency-safe**: unique port per test file (8151–8159 reserved), `fs.mkdtemp` temp dirs, no shared fixtures.
- **fleet-local npm deps** (`tinybase@^6`, `ws@^8`) live in `fleet/package.json`; `fleet/node_modules` is gitignored. Nothing outside `fleet/` gains a dependency.
- Node ≥ 20; plain ESM; no build step (spec: viewer/kernel no-build convention).

---

### Task 1: Store module — schema, claims, spend, guard (the contract task)

**Type:** implementation
**Depends-on:** none
**Review:** adversarial

**Files:**
- Create: `fleet/store.mjs`
- Create: `fleet/package.json`
- Create: `fleet/.gitignore`
- Create: `fleet/tests/test_store.mjs`
- Create: `tests/test_fleet_suite.py`

**Interfaces:**
- Consumes: nothing (root task).
- Produces (exact, all named-exported from `fleet/store.mjs`):
  - `RUN_STATUSES: string[]` — `['pending','claimed','running','gate-green','folded','parked','revoked']`
  - `legalTransition(from: string, to: string): boolean`
  - `claimState(row: object|undefined, now: number): 'free'|'held'|'expired'|'revoked'`
  - `tryClaim(row, {runId, claimant, ttlMs, now}): {row: object}|{error: string}`
  - `tryRenew(row, {claimant, epoch, ttlMs, now}): {row: object}|{error: string}`
  - `revoke(row): object`
  - `spendRowId(writerId: string, seq: number): string` — `` `${writerId}:${seq}` ``
  - `totalSpent(spendRows: object, runId: string): number`
  - `remaining(capTokens: number, spendRows: object, runId: string): number`
  - `guardViolation(table, rowId, newRow, oldRow, writerId, now, opts?): string|null` — `opts = {supervisor?: boolean}`; **supervisor:true is the §W1b supervisory exemption**: it permits a revoke write on a held claim by a non-holder (the orchestrator's §W1c hard action). All other checks still apply under supervisor.

**Parallelization rationale:** front-loaded contract — orchestrator (T3), shim (T4), and driver (T6) all build against these signatures in parallel; a good engineer extracts this shared module regardless of parallelism (it is the one piece three processes must agree on).

- [ ] **Step 1: `fleet/package.json` + `fleet/.gitignore`**

```json
{
  "name": "ultrapowers-fleet",
  "private": true,
  "type": "module",
  "dependencies": { "tinybase": "^6", "ws": "^8" }
}
```

`.gitignore`: `node_modules/` and `package-lock.json`. Run `cd fleet && npm install --no-audit --no-fund`.

- [ ] **Step 2: Write the failing tests**

`fleet/tests/test_store.mjs` — hand-rolled sentinel style (import `assert` from `node:assert/strict`; a bare script of assertions; print `ALL TESTS PASSED` as the last line on success, exit 1 on any throw). Test cases, exactly:

```js
import assert from 'node:assert/strict'
import { RUN_STATUSES, legalTransition, claimState, tryClaim, tryRenew, revoke,
         spendRowId, totalSpent, remaining, guardViolation } from '../store.mjs'

// lease lifecycle: liveness is never an input
const c1 = tryClaim(undefined, { runId: 'r1', claimant: 'sbA', ttlMs: 5000, now: 1000 })
assert.equal(c1.row.epoch, 1)
assert.equal(claimState(c1.row, 4000), 'held')
assert.equal(claimState(c1.row, 6001), 'expired')          // no write happened
assert.ok(tryClaim(c1.row, { runId: 'r1', claimant: 'sbB', ttlMs: 5000, now: 4000 }).error)
const c2 = tryClaim(c1.row, { runId: 'r1', claimant: 'sbB', ttlMs: 5000, now: 6001 })
assert.equal(c2.row.epoch, 2)                               // epoch bumps on reclaim
assert.ok(tryRenew(c2.row, { claimant: 'sbA', epoch: 1, ttlMs: 5000, now: 6100 }).error) // zombie rejected

// revoked is explicit-only, distinct from expired, never claimable
const r = revoke(c2.row)
assert.equal(claimState(r, 999999), 'revoked')
assert.ok(tryClaim(r, { runId: 'r1', claimant: 'sbC', ttlMs: 5000, now: 999999 }).error)
assert.ok(tryRenew(r, { claimant: 'sbB', epoch: 2, ttlMs: 5000, now: 6200 }).error)

// spend: append-only writer-namespaced rows; totals derived
assert.equal(spendRowId('sbA', 3), 'sbA:3')
const rows = { 'orch:1': { runId: 'r1', tokens: 100 }, 'sbA:1': { runId: 'r1', tokens: 50 },
               'sbA:2': { runId: 'r2', tokens: 9 } }
assert.equal(totalSpent(rows, 'r1'), 150)
assert.equal(remaining(200, rows, 'r1'), 50)

// guard: namespace, append-only, transitions, receipt pointer shape
assert.ok(guardViolation('spend', 'sbB:1', { runId: 'r1', tokens: 5 }, undefined, 'sbA', 0))
assert.equal(guardViolation('spend', 'sbA:9', { runId: 'r1', tokens: 5 }, undefined, 'sbA', 0), null)
assert.ok(guardViolation('spend', 'sbA:9', { runId: 'r1', tokens: 6 }, { runId: 'r1', tokens: 5 }, 'sbA', 0)) // append-only
assert.ok(guardViolation('runs', 'r1', { status: 'folded' }, { status: 'claimed' }, 'sbA', 0))
assert.equal(guardViolation('receipts', 'r1:gate', { verdict: 'PASS' }, undefined, 'sbA', 0),
             'receipt must be a git pointer (sha + path)')
assert.equal(guardViolation('receipts', 'r1:gate', { sha: 'abc', path: 'gate-receipt.json' }, undefined, 'sbA', 0), null)

// the supervisory exemption (spec §W1b): orchestrator revoke of a HELD claim
const held = tryClaim(undefined, { runId: 'r3', claimant: 'sbA', ttlMs: 60000, now: 1000 }).row
const revokedRow = revoke(held)
assert.ok(guardViolation('claims', 'claim:r3', revokedRow, held, 'orch', 2000))                       // non-holder blocked
assert.equal(guardViolation('claims', 'claim:r3', revokedRow, held, 'orch', 2000, { supervisor: true }), null) // exemption
assert.ok(guardViolation('claims', 'claim:r3', held, revokedRow, 'orch', 2000, { supervisor: true })) // un-revoke still blocked

console.log('ALL TESTS PASSED')
```

`tests/test_fleet_suite.py` — the pytest wrapper that joins every fleet test to the committed suite (glob-based, so later tasks add test files without editing it):

```python
import glob, os, subprocess, pytest

FLEET = os.path.join(os.path.dirname(__file__), "..", "fleet")
TESTS = sorted(glob.glob(os.path.join(FLEET, "tests", "test_*.mjs")))

@pytest.mark.parametrize("path", TESTS, ids=[os.path.basename(p) for p in TESTS])
def test_fleet_mjs(path):
    if not os.path.isdir(os.path.join(FLEET, "node_modules")):
        subprocess.run(["npm", "install", "--no-audit", "--no-fund"], cwd=FLEET, check=True, capture_output=True)
    r = subprocess.run(["node", path], capture_output=True, text=True, timeout=120)
    assert r.returncode == 0, r.stdout + r.stderr
    assert "ALL TESTS PASSED" in r.stdout

def test_fleet_has_tests():
    assert TESTS, "fleet/tests/ must contain at least one test_*.mjs"
```

- [ ] **Step 3: Run to verify failure** — `python3 -m pytest tests/test_fleet_suite.py -v` → FAIL (store.mjs missing).

- [ ] **Step 4: Implement `fleet/store.mjs`** — lift from the validated prototype (`git show claw/proto-178-store-schema:prototype-178-store-schema/schema.mjs`) with exactly two deltas: (a) the `opts = {supervisor: false}` seventh parameter on `guardViolation`, where `supervisor: true` skips ONLY the `state === 'held' && oldRow.holder !== writerId` rejection when `newRow.revoked === true && !oldRow.revoked` (a revoke write); the un-revoke check (`oldRow.revoked && !newRow.revoked`) remains unconditional; (b) keep every other prototype behavior byte-compatible with the assertions above. Table-shape documentation comment carries over.

- [ ] **Step 5: Run to verify pass** — `python3 -m pytest tests/test_fleet_suite.py -v` → PASS. Also `python3 -m pytest` fully green.

- [ ] **Step 6: Commit** — `git add fleet/ tests/test_fleet_suite.py && git commit -m "feat(fleet): store module with supervisory-exemption guard (#189)"`

---

### Task 2: Token module — mint and verify short-TTL opaque store tokens

**Type:** implementation
**Depends-on:** none
**Review:** adversarial

**Files:**
- Create: `fleet/tokens.mjs`
- Create: `fleet/tests/test_tokens.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces (named exports from `fleet/tokens.mjs`):
  - `mintToken({sandboxId, ttlMs, now}): {token: string, record: {sandboxId, tokenHash, expiresAt}}` — token is 64 hex chars from `crypto.randomBytes(32)`; `tokenHash` is `sha256(token)` hex; the raw token is returned once and never stored.
  - `verifyToken(token: string, records: Array<record>, now: number): {sandboxId: string}|null` — null on unknown hash or `now >= expiresAt`.
  - `hashToken(token: string): string`

**Parallelization rationale:** independent leaf consumed by both the orchestrator (verify, T3) and provisioner (mint+deliver, T5); isolating it lets both build in parallel against two three-line signatures.

- [ ] **Step 1: Failing test** — `fleet/tests/test_tokens.mjs`, sentinel style:

```js
import assert from 'node:assert/strict'
import { mintToken, verifyToken, hashToken } from '../tokens.mjs'

const { token, record } = mintToken({ sandboxId: 'sb1', ttlMs: 10000, now: 1000 })
assert.match(token, /^[0-9a-f]{64}$/)
assert.equal(record.tokenHash, hashToken(token))
assert.ok(!('token' in record))                                   // raw token never stored
assert.deepEqual(verifyToken(token, [record], 5000), { sandboxId: 'sb1' })
assert.equal(verifyToken(token, [record], 11000), null)           // expired
assert.equal(verifyToken('f'.repeat(64), [record], 5000), null)   // unknown
const two = mintToken({ sandboxId: 'sb1', ttlMs: 10000, now: 1000 })
assert.notEqual(two.token, token)                                 // no reuse across mints
console.log('ALL TESTS PASSED')
```

- [ ] **Step 2: Verify failure** — `node fleet/tests/test_tokens.mjs` → module-not-found.
- [ ] **Step 3: Implement** — `node:crypto` (`randomBytes`, `createHash('sha256')`); ~20 lines, no deps.
- [ ] **Step 4: Verify pass** — `node fleet/tests/test_tokens.mjs` → `ALL TESTS PASSED`; `python3 -m pytest tests/test_fleet_suite.py -v` green.
- [ ] **Step 5: Commit** — `git add fleet/tokens.mjs fleet/tests/test_tokens.mjs && git commit -m "feat(fleet): short-TTL opaque token mint/verify (#189)"`

---

### Task 3: Orchestrator — ws-server, persistence, guard sweep, spend authority

**Type:** implementation
**Depends-on:** 1, 2
**Review:** adversarial

**Files:**
- Create: `fleet/orchestrator.mjs`
- Create: `fleet/tests/test_orchestrator.mjs`

**Interfaces:**
- Consumes: everything Task 1 produces; `verifyToken` (Task 2).
- Produces (named export from `fleet/orchestrator.mjs`):
  - `startOrchestrator({port, dbDir, tokenRecords, actions, clock?}): Promise<Orch>` where `actions = {revokeAndPark(runId, why): void, destroySandbox(sandboxId): void, page(cls: 'stall'|'spend'|'security', text: string): void}` (injected — the orchestrator never shells out itself) and `clock` defaults to `Date.now`.
  - `Orch = {store, sweep(now): string[], heartbeat(now): void, stop(): Promise<void>}` — `store` is the orchestrator's MergeableStore; `sweep` runs one guard + spend pass and returns converge-away/action descriptions; `heartbeat` writes `meta/heartbeat {at: now}`; `stop` closes ws-server, persister, and every socket.

**Parallelization rationale:** none needed beyond the T1/T2 contracts — this is the natural owner of server-side behavior.

- [ ] **Step 1: Failing test** — `fleet/tests/test_orchestrator.mjs` (port **8151**, `fs.mkdtempSync(os.tmpdir()+'/fleet-orch-')` for `dbDir`), sentinel style. Assertions, exactly:

```js
// 1. token gate: a ws client with a bad token is refused; a good token connects and syncs.
//    connect via: new WebSocket(`ws://localhost:8151/fleet?token=${token}`) — the server's
//    verifyClient parses ?token= and calls verifyToken(token, tokenRecords, clock()).
// 2. guard sweep: seed a held claim for run 'r1' holder 'sb1' (via a synced client store);
//    have a second client write a claim-steal row {holder:'sb2', ...}; sync; orch.sweep(now)
//    returns an array whose length is >= 1 and the orchestrator store's claim row holder
//    re-converges to 'sb1' after sync.
// 3. spend hard action: seed budgets r1 capTokens 100; append spend rows totalling 120 from
//    the client; sweep(now) → assert actionsLog contains, in order:
//      ['revokeAndPark r1 spend-cap-overshoot 120/100', 'destroySandbox sb1']
//    and the orchestrator store's claims row for r1 has revoked === true and runs.r1.status === 'parked'.
//    The revoke write itself must pass the guard (supervisor exemption) — assert sweep reports
//    zero converge-aways for it on the NEXT sweep.
// 4. persistence: stop(); startOrchestrator again with same dbDir; assert the spend rows and
//    revoked claim survived (SQLite persister).
// 5. heartbeat: heartbeat(5000) writes meta/heartbeat.at === 5000.
console.log('ALL TESTS PASSED')
```

Write these as real code in the test file: the comments above are the required behaviors and exact assertion values; the wiring (client stores via `createWsSynchronizer` from `tinybase/synchronizers/synchronizer-ws-client`, awaiting sync with ~300ms settles) follows the pattern in `git show claw/proto-178-store-schema:prototype-178-store-schema/ws-run.mjs`.

- [ ] **Step 2: Verify failure** — `node fleet/tests/test_orchestrator.mjs` → module-not-found.
- [ ] **Step 3: Implement `fleet/orchestrator.mjs`** — `WebSocketServer({port, verifyClient})` + `createWsServer(wss, createPersisterForPath-style per-path SQLite persister into dbDir)` per TinyBase docs for `synchronizer-ws-server`; the orchestrator joins its own store as a local client; `sweep(now)`: last-known-good snapshot diff → `guardViolation(...)` per changed row (non-supervisor) → converge-away (delRow-then-setRow, prototype pattern) → then spend pass: for each run with a budget, if `totalSpent > capTokens` and claim not already revoked → write `revoke(row)` (a write the guard exempts via `{supervisor:true}` when evaluating its own actions), set `runs.<id>.status = 'parked'` with `parkedWhy = 'spend-cap-overshoot <spent>/<cap>'`, call `actions.revokeAndPark`, `actions.destroySandbox`.
- [ ] **Step 4: Verify pass** — `node fleet/tests/test_orchestrator.mjs`; then full `python3 -m pytest` green.
- [ ] **Step 5: Commit** — `git add fleet/orchestrator.mjs fleet/tests/test_orchestrator.mjs && git commit -m "feat(fleet): orchestrator ws-server with guard sweep and spend authority (#189)"`

---

### Task 4: Fleet run shim — the sandbox-side client

**Type:** implementation
**Depends-on:** 1

**Files:**
- Create: `fleet/shim.mjs`
- Create: `fleet/tests/test_shim.mjs`

**Interfaces:**
- Consumes: `tryClaim`, `tryRenew`, `spendRowId`, `claimState` (Task 1).
- Produces (named export from `fleet/shim.mjs`):
  - `runShim({wsUrl, token, sandboxId, runId, ttlMs, invokeRun, readReportTokens, clock?, renewEveryMs?}): Promise<{status: 'gate-green'|'failed'|'lost-claim'}>` — `invokeRun(): Promise<{gateGreen: boolean}>` is injected (in production it starts the ultrapowers run; in tests a stub); `readReportTokens(): number|null` reads the run report's output-token total when available; `renewEveryMs` defaults to `Math.floor(ttlMs/3)`.

**Parallelization rationale:** consumes only the T1 contract; independent of T3's internals (it meets the orchestrator only over the ws protocol at integration, T6).

- [ ] **Step 1: Failing test** — `fleet/tests/test_shim.mjs` (port **8152**; run a bare `WebSocketServer` + `createWsServer` relay with NO orchestrator — the shim must work against the plain relay), sentinel style. Required behaviors with exact assertions:

```js
// 1. claim-then-run: seed runs.r1 status 'pending' via a helper client; runShim with a stub
//    invokeRun resolving {gateGreen:true} after 2 renew intervals; on resolve assert:
//    result.status === 'gate-green'; the store's claims['claim:r1'].holder === 'sbX';
//    epoch === 1; runs.r1.status === 'gate-green'; and at least 2 renews happened
//    (leaseExpiresAt strictly increased at least twice — capture values via a store listener).
// 2. spend append: readReportTokens returns 1234 → store gains exactly one row
//    spend['sbX:1'] with {runId:'r1', tokens:1234}; a second identical read does NOT
//    append a second row (idempotent per boundary).
// 3. lost claim: pre-seed claims['claim:r1'] revoked:true → runShim resolves
//    {status:'lost-claim'} without invoking invokeRun (assert stub uncalled).
console.log('ALL TESTS PASSED')
```

- [ ] **Step 2: Verify failure.** — `node fleet/tests/test_shim.mjs`.
- [ ] **Step 3: Implement** — connect `createWsSynchronizer`; claim via `tryClaim` against the synced row (write only on `{row}`); renew timer (`tryRenew` with held epoch; on `{error}` → stop the run signal and resolve `lost-claim` if before invokeRun, else `failed`); on invokeRun resolution write status transition + final spend append; always `clearInterval` + destroy synchronizer before resolving.
- [ ] **Step 4: Verify pass** — shim test + full pytest green.
- [ ] **Step 5: Commit** — `git add fleet/shim.mjs fleet/tests/test_shim.mjs && git commit -m "feat(fleet): sandbox run shim — claim, renew, spend, status (#189)"`

---

### Task 5: Provisioner — golden-VM clone, token delivery, base push, teardown

**Type:** implementation
**Depends-on:** 2

**Files:**
- Create: `fleet/provision.mjs`
- Create: `fleet/tests/test_provision.mjs`

**Interfaces:**
- Consumes: `mintToken` (Task 2).
- Produces (named exports from `fleet/provision.mjs`):
  - `provisionRun({golden, runId, baseRef, repoDir, ttlMs, exec, clock?}): Promise<{vmName, token, record}>` — `exec(cmd: string): Promise<{stdout: string, code: number}>` is injected; `vmName = \`fleet-\${runId}\``.
  - `destroySandbox({vmName, exec}): Promise<void>`
- Command sequence `provisionRun` must issue, in order (the test asserts this exact order by prefix): (1) `ssh exe.dev "cp <golden> <vmName> --json"`; (2) a wait-for-ssh probe `ssh -o BatchMode=yes ... <vmName>.exe.xyz true` retried until code 0; (3) token mint (no command); (4) token+assignment delivery: `ssh <vmName>.exe.xyz 'umask 077 && cat > /home/exedev/fleet-run.json'` with stdin JSON `{runId, token, wsUrl, ttlMs}`; (5) base push: `git -C <repoDir> push ssh://exedev@<vmName>.exe.xyz/home/exedev/repo <baseRef>:refs/heads/fleet-base`; (6) shim start: `ssh <vmName>.exe.xyz 'nohup node /home/exedev/repo/fleet/shim-main.mjs > shim.log 2>&1 &'`.

**Parallelization rationale:** touches only the exec seam and T2's mint — independent of store/orchestrator/shim internals; builds in the same wave as T3/T4.

- [ ] **Step 1: Failing test** — `fleet/tests/test_provision.mjs`, sentinel style: a recording `exec` stub (pushes cmds to an array, returns `{code:0, stdout:'{}'}`; first ssh-probe call returns code 1 then 0 to prove the retry). Assert: the six-step order above by `cmds[i].startsWith(...)`; the delivered JSON parses and carries the minted raw token while the returned `record` carries only its hash; `destroySandbox` issues `ssh exe.dev "rm <vmName> --json"`.
- [ ] **Step 2: Verify failure.**
- [ ] **Step 3: Implement** — pure command assembly over the injected exec; no real ssh in tests; a 500ms backoff between probe retries, max 60.
- [ ] **Step 4: Verify pass** — provision test + full pytest green.
- [ ] **Step 5: Commit** — `git add fleet/provision.mjs fleet/tests/test_provision.mjs && git commit -m "feat(fleet): provisioner — clone, deliver token, push base, teardown (#189)"`

---

### Task 6: Drive-one — the W1 single-run driver and gate-read report

**Type:** implementation
**Depends-on:** 1, 2, 3, 4, 5

**Files:**
- Create: `fleet/drive.mjs`
- Create: `fleet/shim-main.mjs`
- Create: `fleet/tests/test_drive.mjs`

**Interfaces:**
- Consumes: `startOrchestrator` (T3), `provisionRun`/`destroySandbox` (T5), `mintToken` (T2), store reads (T1). `fleet/shim-main.mjs` consumes `runShim` (T4): it reads `/home/exedev/fleet-run.json` and invokes the real run (`claude -p` engine launch) — the sandbox entrypoint the provisioner starts.
- Produces: `driveOne({planPath, golden, port, dbDir, repoDir, exec, clock?}): Promise<{read, reportPath}>` where `read = {o1: boolean, receiptsResolvable: boolean, leaseContinuity: boolean, versionStamp: boolean, spendObservational: {reported: number|null, ledger: number}}` — the §W1d gate read, written as JSON to `reportPath`.

**Parallelization rationale:** none — this is the integration task; it is the wave-2 sink by construction.

- [ ] **Step 1: Failing test** — `fleet/tests/test_drive.mjs` (port **8153**): stub `exec` that simulates the provision sequence and, in place of a real sandbox, runs a local shim (`runShim` against the driver's own orchestrator with a stub `invokeRun` that writes a fake receipt row `{sha:'<real sha from a tmp git repo commit>', path:'gate-receipt.json', verdict:'PASS'}` and resolves gate-green). Build the tmp git repo with one commit in the test so `receiptsResolvable` verifies against a REAL `git cat-file -e <sha>` — assert `read.o1 === true`, `read.receiptsResolvable === true`, `read.leaseContinuity === true`, and the JSON file at `reportPath` round-trips to the same object.
- [ ] **Step 2: Verify failure.**
- [ ] **Step 3: Implement** — `driveOne`: start orchestrator → provision (exec) → watch store until `runs.<id>.status ∈ {gate-green, parked}` or heartbeat timeout → on gate-green: `git -C <repoDir> fetch ssh://.../repo fleet-run-branch` (exec seam), verify each receipts row's sha with `git cat-file -e`, compute the read object, destroy sandbox, stop orchestrator, write JSON. `shim-main.mjs`: ~30 lines — parse `fleet-run.json`, call `runShim` with `invokeRun` = spawn of the engine run and `readReportTokens` reading the run report file; version-stamps the store run row from `.claude-plugin/plugin.json` version + `git rev-parse HEAD`.
- [ ] **Step 4: Verify pass** — drive test + FULL `python3 -m pytest` green.
- [ ] **Step 5: Commit** — `git add fleet/drive.mjs fleet/shim-main.mjs fleet/tests/test_drive.mjs && git commit -m "feat(fleet): drive-one driver with W1 gate-read report (#189)"`

---

### Task 7: Preflight probe — the one unproven transport link

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `fleet/preflight.mjs`
- Create: `fleet/tests/test_preflight.mjs`

**Interfaces:**
- Consumes: nothing (own inline exec injection).
- Produces: `preflight({orchVm, probeVm, exec}): Promise<{sshFetch: boolean, httpsFallback: boolean, verdict: 'ssh'|'https-fallback'|'BLOCKED'}>` — `verdict` is `'ssh'` if sshFetch, else `'https-fallback'` if that leg passes, else `'BLOCKED'`.

**Parallelization rationale:** independent leaf; wave 1 alongside T1/T2.

- [ ] **Step 1: Failing test** — sentinel style, recording exec stub: assert it issues (a) a VM→VM fetch attempt `ssh <orchVm>.exe.xyz 'git -C /home/exedev/repo fetch ssh://exedev@<probeVm>.exe.xyz/home/exedev/repo'` and (b) on simulated failure (code 1), the HTTPS fallback attempt `ssh <orchVm>.exe.xyz 'git ls-remote https://<probeVm>.exe.xyz/repo.git'`; assert verdict mapping for all three cases (0/–, 1/0, 1/1 → `ssh`, `https-fallback`, `BLOCKED`).
- [ ] **Step 2: Verify failure.** — `node fleet/tests/test_preflight.mjs`.
- [ ] **Step 3: Implement.** Command assembly over exec; nothing else.
- [ ] **Step 4: Verify pass** — preflight test + full pytest green.
- [ ] **Step 5: Commit** — `git add fleet/preflight.mjs fleet/tests/test_preflight.mjs && git commit -m "feat(fleet): transport preflight probe (#189)"`

---

### Task 8: Runbook — golden VM build and the live W1 procedure

**Type:** implementation
**Depends-on:** 5, 6, 7

**Files:**
- Create: `fleet/RUNBOOK.md`

**Interfaces:**
- Consumes: the CLI shapes of T5/T6/T7 (command names and argument objects as documented in their Produces blocks).
- Produces: the operator/AFK procedure document — nothing programmatic.

- [ ] **Step 1: Write `fleet/RUNBOOK.md`** with exactly these sections: **Golden VM build** (create `fleet-golden` via `ssh exe.dev "new --name=fleet-golden --cpu=8 --memory=16GB"`; install node LTS; clone the repo to `/home/exedev/repo`; install the ultrapowers plugin; NO superpowers; NO credentials; verify `claude --version` and `nproc` = 8); **LLM integration check** (the §W1a zero-secrets probe: dummy-key `claude -p` through `llm.int.exe.xyz` returns a completion); **Preflight** (`node fleet/preflight.mjs` invocation against the orchestrator VM + a probe clone; on `https-fallback` record it in the gate read; on `BLOCKED` stop); **Live W1 run** (`node fleet/drive.mjs <plan> …` invocation with real exec); **Gate read** (where `reportPath` lands; the §W1d checklist including the observational spend note; the constants this first run sets: anomaly multiple, cap defaults, spend tolerance); **Teardown guarantee** (`ssh exe.dev "rm fleet-<runId> --json"`; `sweep_worktrees.sh` untouched — fleet sandboxes are not worktrees).
- [ ] **Step 2: Verify** — every command in the runbook names a file/flag that exists in this plan's tasks (self-check, no execution).
- [ ] **Step 3: Commit** — `git add fleet/RUNBOOK.md && git commit -m "docs(fleet): W1 runbook (#189)"`

---

### Task 9: Suite gate

**Type:** gate
**Depends-on:** 1, 2, 3, 4, 5, 6, 7, 8

**Files:**
- Test: `tests/`

- [ ] Run `python3 -m pytest` — the full committed suite including `tests/test_fleet_suite.py` over every `fleet/tests/test_*.mjs`. Expected: all green. No harness JS was touched, so no `.mjs` sim obligations fire.

---

### Task 10: Live W1 execution and gate read

**Type:** manual
**Depends-on:** 9

**Files:**
- Test: `fleet/RUNBOOK.md`

- [ ] Operator (or an AFK session with exe.dev access) follows `fleet/RUNBOOK.md` end to end: build `fleet-golden`, run the preflight, execute one real run via `driveOne`, collect the §W1d gate-read JSON, and record O1 + the three W1-set constants (anomaly multiple, cap defaults, spend tolerance) as a comment on #189 and in `evals/frontier/results/` as `2026-MM-DD-width-w1-gate.md`. A red read parks W1 — fix and re-run; the run engine is untouched either way.

---

## Operator smoke

- do: `python3 -m pytest tests/test_fleet_suite.py -v`
  see: every `fleet/tests/test_*.mjs` listed by name, all PASS — the fleet suite is wired into the committed suite, not floating.
- do: `node fleet/tests/test_orchestrator.mjs` directly, then run it again immediately.
  see: `ALL TESTS PASSED` twice — the SQLite persister and port teardown leave nothing behind that breaks a rerun.
- do: open `fleet/RUNBOOK.md` and follow only the "Golden VM build" section's verify line on any existing VM (`claude --version`).
  see: a version prints with no login prompt and no API key anywhere on the VM.
- do: `grep -r "ANTHROPIC_API_KEY\|anthropic" fleet/ --include="*.mjs" -l`
  see: no file sets a real key; the only occurrences are the dummy-key env plumbing named in the spec.
- do: after Task 10's live run, `cat` the gate-read JSON at the reported path.
  see: `"o1": true` and every receipt sha resolvable — machine-written bytes, not narration.
