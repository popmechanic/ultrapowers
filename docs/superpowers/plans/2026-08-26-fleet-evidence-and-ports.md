# Fleet Evidence & Ports Implementation Plan (#269, #250, #212, #215, #216)

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the fleet suite concurrency-safe (ephemeral ports), kill the settle-sleep CI flake, move run evidence out of the wiped store dir and capture sandbox stat + credit spend before teardown, and plumb per-run sandbox sizing knobs.

**Architecture:** Four fleet-only changes. The port fix runs alone in wave 1 because until it lands the fleet tests bind fixed ports and same-wave concurrent suite runs would collide; the other three tasks fork from a base that carries it. `driveOne`/`provisionRun`/`startOrchestrator` gain small additive options with safe defaults; all ssh-interpolated values are validated first; parsers are pinned against JSON shapes captured from the live exe.dev account (2026-08-26), never guessed.

**Tech Stack:** Node 22 ESM (`fleet/*.mjs`), TinyBase MergeableStore + ws, exe.dev CLI over ssh, pytest wrapper (`tests/test_fleet_suite.py`, 120 s per file, sentinel `ALL TESTS PASSED`).

**Spec:** `docs/superpowers/specs/2026-08-26-fleet-evidence-and-ports.md`

**Acceptance:** suite — default disposition; fleet is not plugin machinery, no seal, no release required for these changes.

## Global Constraints

- All changes confined to `fleet/**` (source, tests, RUNBOOK.md). Zero diff anywhere else — no engine, no skill text, no frozen periphery, no `tests/*.py`.
- Every `fleet/tests/test_*.mjs` exits 0 and prints the literal `ALL TESTS PASSED` on stdout, within the 120-second per-file timeout `tests/test_fleet_suite.py` enforces.
- After wave 2, no fleet test binds a fixed port: `grep -rn "PORT = 81" fleet/tests/` returns no hits (string literals inside stubbed-exec expectations in `test_provision.mjs` are allowed — they bind nothing).
- Validate-before-exec: any new value interpolated into an ssh command string is validated first and refused loudly on mismatch (the module's established posture).
- Best-effort evidence capture never blocks teardown: a failed stat/credits/tar pull pushes to `errors` and leaves detail fields null; `destroySandbox` still runs.

---

### Task 1: Ephemeral ports — orchestrator returns its bound port

**Type:** implementation
**Depends-on:** none
**Review:** adversarial

**Files:**
- Modify: `fleet/orchestrator.mjs`
- Modify: `fleet/drive.mjs`
- Modify: `fleet/tests/test_orchestrator.mjs`
- Modify: `fleet/tests/test_shim.mjs`
- Test: `fleet/tests/test_drive.mjs`

**Interfaces:**
- Produces: `startOrchestrator({port, …})` accepts `port: 0` and returns `{ store, sweep, heartbeat, stop, port }` where `port` is the bound port; `driveOne({port: 0, …})` works and its `detail` gains `effectivePort: number` (the orchestrator's bound port); explicit non-zero ports keep working unchanged.
- Consumes: nothing from other tasks.

**Parallelization rationale:** none — this task deliberately runs alone in wave 1: until it merges, the fleet tests bind fixed ports (8151/8152/8153) and the sibling tasks' concurrent suite runs would EADDRINUSE against each other. Build-order dependency, not authoring order.

- [ ] **Step 1: `fleet/orchestrator.mjs` — bind-port read-back**

Three edits in `startOrchestrator`:

1. After the existing `'listening'` await (~line 136-139), capture the bound port:

```js
  const boundPort = wss.address().port
```

2. The loopback client URL (~line 159) uses it:

```js
  const socket = new WebSocket(`ws://127.0.0.1:${boundPort}/${FLEET_PATH}?token=${loopbackToken}`)
```

3. The return object (~line 308) exposes it:

```js
  return { store, sweep, heartbeat, stop, port: boundPort }
```

No other behavior changes; an explicit `port` value binds exactly as before (`wss.address().port` equals it).

- [ ] **Step 2: `fleet/drive.mjs` — reorder wsUrl derivation after orchestrator start**

Today `resolvedWsUrl` is computed at ~line 91, before `startOrchestrator` at ~line 152. Restructure:

1. Delete the early `const resolvedWsUrl = wsUrl ?? \`ws://${wsHost}:${port}/${FLEET_PATH}\`` (~line 91).
2. Immediately after the `startOrchestrator` call (`const orch = await startOrchestrator({ port, dbDir, … })`), derive:

```js
  const effectivePort = orch.port
  const resolvedWsUrl = wsUrl ?? `ws://${wsHost}:${effectivePort}/${FLEET_PATH}`
```

3. Every downstream consumer of `port` uses `effectivePort`: the `provisionRun({ …, wsUrl: resolvedWsUrl, port: effectivePort, … })` call (~lines 240-252) and `destroySandbox({ vmName, port: effectivePort, exec })` (~line 138). The tunnel command strings in `provision.mjs` are untouched — they already receive the port as an argument.
4. The detail template (~lines 451-453 region, where `sandboxLogs: null` is declared) gains `effectivePort: null`, and it is assigned right after derivation: `detail.effectivePort = effectivePort`. This is the read-back channel the tests (and later triage) use.

- [ ] **Step 3: Convert the three binding test files to port 0**

- `fleet/tests/test_orchestrator.mjs`: `const PORT = 8151` (~line 17) becomes `const PORT = 0`; after each `startOrchestrator({ port: PORT, … })` the test reads `orch.port` and uses it wherever the literal was interpolated (the `joinClient` ws URLs). The restart scenario (~line 348) restarts on the FIRST run's bound port — `startOrchestrator({ port: firstBoundPort, dbDir, … })` — preserving the persistence semantics (the theoretical port-reuse race is accepted; ephemeral ports are effectively never immediately re-grabbed).
- `fleet/tests/test_shim.mjs`: `const PORT = 8152` (~line 13) → bind `new WebSocketServer({ port: 0 })` and read `wss.address().port` into the value the rest of the file interpolates.
- `fleet/tests/test_drive.mjs`: `const PORT = 8153` (~line 74) → `driveDefaults` passes `port: 0` (~line 281). The assertions that interpolated `PORT` (~lines 451, 454, 464 — pkill pattern, tunnel-command equality, `exec.delivered.wsUrl`) read the run's `detail.effectivePort` from the `driveOne` result and interpolate that instead. Update the file-header comment (~line 3) that reserved 8153.
- `fleet/tests/test_provision.mjs` is untouched — its port literals are inert strings inside stubbed-exec expectations; nothing binds.

- [ ] **Step 4: Run the fleet tests — verify green and no fixed binds**

Run: `node fleet/tests/test_orchestrator.mjs && node fleet/tests/test_shim.mjs && node fleet/tests/test_drive.mjs && node fleet/tests/test_provision.mjs`
Expected: each prints `ALL TESTS PASSED`.
Run: `grep -rn "PORT = 81" fleet/tests/`
Expected: no hits.
Concurrency probe — run: `node fleet/tests/test_drive.mjs & node fleet/tests/test_orchestrator.mjs & wait`
Expected: both print `ALL TESTS PASSED` (no EADDRINUSE).

- [ ] **Step 5: Soften the RUNBOOK port note**

In `fleet/RUNBOOK.md` (~line 168) the comment `// pick a port outside the 8151-8159 test range` becomes `// any explicit port works; the fleet tests bind ephemeral ports (port 0)`.

- [ ] **Step 6: Run the suite slice and commit**

Run: `python3 -m pytest tests/test_fleet_suite.py -q`
Expected: PASS.

```bash
git add fleet/orchestrator.mjs fleet/drive.mjs fleet/tests/test_orchestrator.mjs fleet/tests/test_shim.mjs fleet/tests/test_drive.mjs fleet/RUNBOOK.md
git commit -m "fix: fleet tests bind ephemeral ports — orchestrator returns its bound port (#250)"
```

---

### Task 2: Poll-until-predicate settle in test_orchestrator

**Type:** implementation
**Depends-on:** 1

**Files:**
- Test: `fleet/tests/test_orchestrator.mjs`

**Interfaces:**
- Consumes: the task-1 file state of `test_orchestrator.mjs` (port 0 + `orch.port` read-back).
- Produces: nothing consumed by other tasks.

**Parallelization rationale:** independent of tasks 3/4 (different files); waits on task 1 only for suite concurrency-safety and because both edit this file.

- [ ] **Step 1: Add the bounded poll helper next to `sleep` (~line 19)**

```js
const until = async (fn, what, capMs = 5_000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < capMs) {
    const v = fn()
    if (v) return v
    await sleep(50)
  }
  throw new Error('until: timed out waiting for ' + what)
}
```

- [ ] **Step 2: Replace all 11 `settle()` sites (lines ~93, 106, 116, 132, 147, 176, 209, 234, 276, 304, 349) with predicates on the observable each was guessing at**

Each site waits for a TinyBase CRDT round trip; the predicate polls the destination store for the row state the NEXT assertion depends on. The two exemplar conversions, exact:

- Claim-steal barrier (~line 116, before `orch.sweep(T)`):

```js
  await until(() => orch.store.getRow('claims', 'claim:r1')?.holder === 'sb2',
    'sb2 steal to reach the supervisor store')
```

- Orchestrator→client barrier (~line 93, before the `c1.store.getRow('runs','r1')` assertion):

```js
  await until(() => c1.store.getRow('runs', 'r1'), 'run r1 to reach client c1')
```

Absence-shaped sites (settle before asserting a *clean* sweep) use a quiescence predicate — poll until the writer's own just-written rows have converged into the reading store (e.g. `until(() => c1.store.getRow('claims','claim:r1')?.revoked === true, …)`) — never a fixed sleep. Only a site genuinely inexpressible as a predicate may keep a commented `sleep(300)`, decided per site with the reason in the comment; do not default to it. Delete the `settle` const when no site uses it.

- [ ] **Step 3: Verify green, fast, and loop-stable**

Run: `node fleet/tests/test_orchestrator.mjs`
Expected: `ALL TESTS PASSED`, wall time well under 120 s (polls resolve in tens of ms).
Run: `for i in 1 2 3 4 5; do node fleet/tests/test_orchestrator.mjs | tail -1; done`
Expected: five `ALL TESTS PASSED` lines.

- [ ] **Step 4: Commit**

```bash
git add fleet/tests/test_orchestrator.mjs
git commit -m "fix: replace fixed-sleep settle with bounded store-state polls (#269)"
```

---

### Task 3: Evidence lifecycle — evidenceDir, stat + credits capture, dbDir persistence

**Type:** implementation
**Depends-on:** 1
**Review:** adversarial

**Files:**
- Modify: `fleet/drive.mjs`
- Modify: `fleet/RUNBOOK.md`
- Test: `fleet/tests/test_drive.mjs`

**Interfaces:**
- Consumes: `detail.effectivePort` and `driveOne({port: 0})` from Task 1.
- Produces: `driveOne` option `evidenceDir` (default `` `${dbDir}-evidence` ``); evidence artifacts `<evidenceDir>/sandbox-logs/<vm>-<stamp>/sandbox-logs.tgz`, `<evidenceDir>/stat.json`, `<evidenceDir>/credits.json`; gate read defaults `<evidenceDir>/gate-read-<runId>.json` (+ `.detail.json`); `detail.sandboxStat: {peakCores, meanCores, peakMemBytes} | null` and `detail.creditSpendUsd: number | null`.

**Parallelization rationale:** shares `fleet/drive.mjs` with Task 4 by design — stable anchors: this task owns `pullLogsOnce`, the evidence/report paths, and the detail fields; Task 4 touches ONLY the options destructure and the `provisionRun` argument list. Text overlap folds at merge.

- [ ] **Step 1: Write the failing tests in `fleet/tests/test_drive.mjs`**

Four changes/additions (exact assertions; wire them into the existing scenario style with stubbed `exec`):

1. Flip the placement pin (~lines 445-448): the log destination must be under `evidenceDir`, never under `dbDir`:

```js
  assert.ok(dest.startsWith(path.join(tmp, 'db1-evidence')),
    'log destination must be under evidenceDir, never under dbDir: ' + dest)
  assert.ok(!dest.startsWith(path.join(tmp, 'db1', 'sandbox-logs')),
    'evidence must not live inside the persister dir')
```

2. Stat/credits capture scenario: stub `exec` returns, for the stat command, a trimmed copy of the REAL captured shape (2026-08-26):

```js
const STAT_FIXTURE = JSON.stringify({
  name: 'fleet-r1', status: 'running', range: '24h',
  points: [
    { timestamp: '2026-08-25T08:10:56Z', cpu_cores: 0.01, cpu_nominal: 8,
      mem_used_bytes: 1064488960, mem_total_bytes: 17179869184 },
    { timestamp: '2026-08-25T08:20:56Z', cpu_cores: 3.5, cpu_nominal: 8,
      mem_used_bytes: 9064488960, mem_total_bytes: 17179869184 },
  ],
})
const CREDITS_FIXTURE = JSON.stringify({
  group: 'box', month: '2026-08', total_cost_usd: 44.46,
  groups: [
    { box: 'fleet-r1', key: 'fleet-r1', cost_usd: 0.78, cost_microcents: 783905, requests: 11 },
    { box: '(deleted)', key: '(deleted)', cost_usd: 40.03, cost_microcents: 40031119, requests: 988 },
  ],
})
```

Assertions after the drive:

```js
  assert.deepEqual(res.detail.sandboxStat,
    { peakCores: 3.5, meanCores: 1.755, peakMemBytes: 9064488960 })
  assert.equal(res.detail.creditSpendUsd, 0.78)
  assert.ok(fs.existsSync(path.join(evidenceDir, 'stat.json')), 'raw stat.json written')
  assert.ok(fs.existsSync(path.join(evidenceDir, 'credits.json')), 'raw credits.json written')
```

A derive-throw variant: `exec` succeeds but returns a malformed-but-valid payload (`points` as an object, not an array) → `res.detail.sandboxStat === null`, an entry in `res.detail.errors`, raw `stat.json` still written, and the `rm` teardown command still issued. And a degraded variant: `exec` throws on the stat command → `res.detail.sandboxStat === null`, an entry in `res.detail.errors` naming stat, and `destroySandbox` still issued (assert the `rm` command appears in `exec` calls).

3. Credits-absent variant: `CREDITS_FIXTURE` with no `fleet-r1` row → `res.detail.creditSpendUsd === 0` (no row = no spend recorded = flat).

4. dbDir persistence scenario: run `driveOne` twice against the SAME `dbDir` (fresh `evidenceDir` each), second run with a new runId; assert the second run's gate read is scoped to its own runId — `read.spendObservational` sums only run-2 receipts, `read.leaseContinuity` reflects only run-2's claim, and the sweep raises nothing about run-1's rows. If this scenario is red, the fix duty is scoping the aggregation by runId in the closed reader set the spec names (`spendObservational`/`totalSpent` at `drive.mjs:414`, `observeClaim` `:195-202`, `receiptsFor` `:212-215`, sweep spend pass `orchestrator.mjs:201-250`) — never documenting a wipe.

Run: `node fleet/tests/test_drive.mjs`
Expected: FAIL (evidenceDir, stat capture, and detail fields do not exist yet).

- [ ] **Step 2: Implement in `fleet/drive.mjs`**

1. `driveOne` options gain `evidenceDir` with default:

```js
  const resolvedEvidenceDir = evidenceDir ?? `${dbDir}-evidence`
```

2. Report defaults move there (~lines 92-93):

```js
  const resolvedReportPath = reportPath ?? path.join(resolvedEvidenceDir, `gate-read-${runId}.json`)
```

3. `pullLogsOnce` (~lines 113-131): the tar destination becomes `path.join(resolvedEvidenceDir, 'sandbox-logs', `${vmName}-${Date.now()}`)`; after the tar pull (still bounded by `logPullTimeoutMs`), two more best-effort captures, EACH with its own `logPullTimeoutMs` bound (the bound is per command, not shared):

```js
export const sandboxStatCommand = ({ vmName }) =>
  `ssh -o BatchMode=yes -o ConnectTimeout=10 exe.dev "stat ${vmName} --json --range=24h"`
export const creditsUsageCommand = () =>
  `ssh -o BatchMode=yes -o ConnectTimeout=10 exe.dev "billing credits usage --group=box --detail --json"`
```

Write raw stdout to `<evidenceDir>/stat.json` / `<evidenceDir>/credits.json` regardless of parse success. Parse:

```js
export const deriveSandboxStat = (statJson) => {
  // Array.isArray guard: a malformed-but-valid payload (points as an object)
  // must degrade to null, never throw past destroyOnce (#280 run-9b critic).
  const pts = (Array.isArray(statJson?.points) ? statJson.points : [])
    .filter((p) => typeof p?.cpu_cores === 'number')
  if (!pts.length) return null
  const cores = pts.map((p) => p.cpu_cores)
  const mems = pts.map((p) => p.mem_used_bytes).filter((m) => typeof m === 'number')
  return {
    peakCores: Math.max(...cores),
    meanCores: cores.reduce((a, b) => a + b, 0) / cores.length,
    peakMemBytes: mems.length ? Math.max(...mems) : null,
  }
}
export const deriveCreditSpendUsd = (creditsJson, vmName) => {
  const rows = Array.isArray(creditsJson?.groups) ? creditsJson.groups : []
  const row = rows.find((g) => g?.box === vmName)
  return row ? (typeof row.cost_usd === 'number' ? row.cost_usd : null) : 0
}
```

`detail.sandboxStat` / `detail.creditSpendUsd` declared null in the detail template and assigned from the derivations, with **each derive call wrapped in try/catch at the call site** — a throw is a parse failure: push the error, leave the field null, still write the raw file. Nothing on this path may propagate past `destroyOnce`: any capture/parse failure pushes to `errors` and leaves the field null; `destroySandbox` always still runs (the existing `destroyOnce` ordering is unchanged: pull, then destroy). [Amended per #280: run-9b's in-sandbox critic found an unguarded derive throw would skip teardown and leak a billed sandbox.]

4. If Step 1's persistence scenario is red, apply runId scoping inside the named reader set only — no sweep/guard/spend semantic changes beyond scoping.

- [ ] **Step 3: Run the tests — verify green**

Run: `node fleet/tests/test_drive.mjs`
Expected: `ALL TESTS PASSED`.

- [ ] **Step 4: RUNBOOK evidence + dbDir lines**

In `fleet/RUNBOOK.md`: update the two stale path lines — ~line 198 (`<dbDir>/sandbox-logs/…` → `<evidenceDir>/sandbox-logs/…`, naming the `${dbDir}-evidence` default) and ~line 214 (`<dbDir>/gate-read-<runId>.json` → `<evidenceDir>/gate-read-<runId>.json`). Add under the evidence note: "Keep `dbDir` across runs — never `rm` it; a persisted store is test-pinned safe (prior-run rows do not perturb a new run's gate read). Evidence lives outside it in `evidenceDir` (default `<dbDir>-evidence`), so a fresh-store experiment never deletes evidence. `detail.sandboxStat` is a floor estimate — `stat` samples every 10 minutes."

- [ ] **Step 5: Suite slice and commit**

Run: `python3 -m pytest tests/test_fleet_suite.py -q`
Expected: PASS.

```bash
git add fleet/drive.mjs fleet/tests/test_drive.mjs fleet/RUNBOOK.md
git commit -m "feat: fleet evidence lifecycle — evidenceDir + stat/credits capture before teardown (#212, #215)"
```

---

### Task 4: Sandbox sizing knobs on provisionRun

**Type:** implementation
**Depends-on:** 1

**Files:**
- Modify: `fleet/provision.mjs`
- Modify: `fleet/drive.mjs`
- Modify: `fleet/RUNBOOK.md`
- Test: `fleet/tests/test_provision.mjs`

**Interfaces:**
- Produces: `provisionRun({ …, cpu?, memory?, disk? })` — validated, appended to the clone command as `--cpu=<n> --memory=<m> --disk=<d>` when given, golden size when absent; `driveOne({ …, sandboxCpu?, sandboxMemory?, sandboxDisk? })` pass-throughs.
- Consumes: nothing from other tasks (Depends-on 1 is suite concurrency-safety only).

**Parallelization rationale:** shares `fleet/drive.mjs` with Task 3 by design — this task touches ONLY the `driveOne` options destructure and the `provisionRun` argument list (~lines 240-252); Task 3 owns `pullLogsOnce` and the detail/report fields. Text overlap folds at merge.

- [ ] **Step 1: Write the failing tests in `fleet/tests/test_provision.mjs`**

```js
// sized clone: flags appended when given
{
  const exec = makeExec()
  await provisionRun({ golden: 'fleet-golden', runId: 'r6', baseRef: 'refs/heads/main',
    repoDir: '/tmp/repo', ttlMs: 1000, wsUrl: 'ws://127.0.0.1:8151/fleet', port: 8151,
    planPath: 'p.md', exec: exec.fn, cpu: 4, memory: '8GB', disk: '30GB' })
  assert.ok(exec.cmds[0].startsWith('ssh exe.dev "cp fleet-golden fleet-r6 --cpu=4 --memory=8GB --disk=30GB --json"'),
    'sized clone must carry the flags: ' + exec.cmds[0])
}
// unsized clone unchanged
// (existing pin at ~line 48 stays: cp with no size flags when none given)
// refusals: bad values never reach exec
for (const bad of [{ cpu: 'four' }, { cpu: 0 }, { cpu: -2 }, { memory: '8' }, { memory: '8gb; rm -rf /' }, { disk: 'lots' }]) {
  const exec = makeExec()
  await assert.rejects(
    () => provisionRun({ golden: 'fleet-golden', runId: 'r7', baseRef: 'refs/heads/main',
      repoDir: '/tmp/repo', ttlMs: 1000, wsUrl: 'ws://127.0.0.1:8151/fleet', port: 8151,
      planPath: 'p.md', exec: exec.fn, ...bad }),
    /cpu|memory|disk/, 'invalid size knob must be refused: ' + JSON.stringify(bad))
  assert.equal(exec.cmds.length, 0, 'refusal must happen before any exec call')
}
```

(Adapt `makeExec` to the file's existing exec-stub helper; use whatever it is named there. The exec-count pin at ~line 199 — "expected 7 exec calls with engineEnv" — must stay green for the unsized path.)

Run: `node fleet/tests/test_provision.mjs`
Expected: FAIL (options not accepted).

- [ ] **Step 2: Implement in `fleet/provision.mjs`**

Add `cpu`, `memory`, `disk` to the `provisionRun` destructure (~line 84) and validate before any exec:

```js
const sizeFlags = ({ cpu, memory, disk }) => {
  const flags = []
  if (cpu !== undefined) {
    if (!Number.isInteger(cpu) || cpu <= 0) throw new Error(`provisionRun: cpu must be a positive integer, got ${JSON.stringify(cpu)}`)
    flags.push(`--cpu=${cpu}`)
  }
  for (const [name, v] of [['memory', memory], ['disk', disk]]) {
    if (v !== undefined) {
      if (typeof v !== 'string' || !/^\d+GB$/.test(v)) throw new Error(`provisionRun: ${name} must match ^\\d+GB$, got ${JSON.stringify(v)}`)
      flags.push(`--${name}=${v}`)
    }
  }
  return flags.length ? ' ' + flags.join(' ') : ''
}
```

The clone command (~line 91) becomes:

```js
  await exec(`ssh exe.dev "cp ${golden} ${vmName}${sizeFlags({ cpu, memory, disk })} --json"`)
```

In `fleet/drive.mjs`: `driveOne` options gain `sandboxCpu`, `sandboxMemory`, `sandboxDisk`; the `provisionRun` call (~lines 240-252) passes `cpu: sandboxCpu, memory: sandboxMemory, disk: sandboxDisk`.

- [ ] **Step 3: Run the tests — verify green**

Run: `node fleet/tests/test_provision.mjs && node fleet/tests/test_drive.mjs`
Expected: both print `ALL TESTS PASSED`.

- [ ] **Step 4: RUNBOOK driver-snippet guidance**

In the `fleet/RUNBOOK.md` driver snippet (~lines 148-182), add commented options with the derivation guidance:

```js
  // sandboxCpu: <widest wave width> + 2, clamped to the plan's max_cpus — calibrate
  // memory from <evidenceDir>/stat.json once runs carry it (W2); golden 8/16 default.
  // sandboxCpu: 8, sandboxMemory: '16GB',
```

- [ ] **Step 5: Suite slice and commit**

Run: `python3 -m pytest tests/test_fleet_suite.py -q`
Expected: PASS.

```bash
git add fleet/provision.mjs fleet/drive.mjs fleet/tests/test_provision.mjs fleet/RUNBOOK.md
git commit -m "feat: sandbox sizing knobs — provisionRun cpu/memory/disk through cp (#216)"
```

---

### Task 5: Full-suite gate

**Type:** gate
**Depends-on:** 1, 2, 3, 4

**Files:**
- Test: `tests/`

- [ ] **Step 1: Full suite**

Run: `python3 -m pytest -q`
Expected: all green.

- [ ] **Step 2: Fleet-only diff check**

Run: `git diff --name-only origin/main... | grep -v '^fleet/' | grep -v '^docs/'`
Expected: empty output (all code changes confined to `fleet/**`).

---

### Task 6: Resize the live orchestrator VM

**Type:** manual
**Depends-on:** 5

**Files:**
- Modify: `fleet/RUNBOOK.md`

The orchestrator draws ~0.01 cores / 0.95 GB during a run; the live VM is oversized. Operator runs, once, on live infra:

```bash
ssh exe.dev "resize fleet-orchestrator --cpu=1 --memory=2GB"
```

(One command; free win per #216's note. Not automated — live infrastructure mutation stays operator-run.)

## Operator smoke

- do: in two terminals at once, run `node fleet/tests/test_drive.mjs` in both
- see: both print `ALL TESTS PASSED` — no EADDRINUSE.
- do: `grep -rn "PORT = 81" fleet/tests/`
- see: no output.
- do: `node fleet/tests/test_drive.mjs` then `ls /tmp | grep evidence` after any live `driveOne` (or inspect the test's tmp dirs)
- see: `stat.json`, `credits.json`, and `sandbox-logs/` under a `*-evidence` dir, never under the store dir.
