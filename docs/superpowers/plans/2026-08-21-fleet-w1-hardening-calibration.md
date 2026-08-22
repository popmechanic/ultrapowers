# Fleet W1 Hardening — Calibration Run Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land three of the #190 "hardening (any time)" residuals in `fleet/` — the ones that fail closed today but have no covering test or no latch — as the first real plan driven through a fleet sandbox (W1 Task 10's calibration run).

**Architecture:** Every task is a small additive change inside `fleet/` plus a sentinel `fleet/tests/test_*.mjs` in the house pattern (hand-rolled asserts, prints `ALL TESTS PASSED`, unique port in 8151–8159 if a ws relay is needed). `tests/test_fleet_suite.py` globs `fleet/tests/test_*.mjs`, so a new test file joins the committed suite with no registration. Nothing under `skills/ultrapowers/` is touched.

**Tech Stack:** Node ≥20 ESM (`fleet/*.mjs`), `tinybase@^6` + `ws@^8` (already in `fleet/package.json`), `node:assert/strict`.

**Spec:** Issue #190 (fleet W1 residuals), items "park-refusal page latch", "main()'s default invokeRun binding has no covering test", "findGateReceiptFile not scoped / newest-wins assertion missing".

**Acceptance:** suite — three small hardening changes in `fleet/` whose verification is their own sentinel tests joining the committed suite via `tests/test_fleet_suite.py`; this plan is also the W1 Task 10 calibration run, whose held-out verification is the live §W1d gate read.

## Global Constraints

- **No `anthropic` SDK and no API key anywhere in `fleet/`** (repo-wide no-API-key rule).
- **The frozen verification periphery is untouched** — nothing under `skills/ultrapowers/scripts/`, `skills/ultrapowers/kernel/`, `harnesses/`.
- **Fleet tests must be concurrency-safe**: a new test file that opens a ws relay picks an unused port in 8151–8159 (8152 = test_shim, 8151/8153–8159 — check `grep -rn "PORT = " fleet/tests/` before choosing); use `fs.mkdtempSync` temp dirs; no shared fixtures.
- **Every new test prints `ALL TESTS PASSED` on success and exits 0** — `tests/test_fleet_suite.py` asserts both.
- Existing fleet tests (`fleet/tests/test_*.mjs`) and the full `python3 -m pytest` suite stay green.

---

### Task 1: Park-refusal page latch in the orchestrator sweep

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `fleet/orchestrator.mjs`
- Modify: `fleet/tests/test_orchestrator.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: no new exports. Behavioral contract — in `startOrchestrator`'s `sweep`, the `supervisor park refused for <scopeId>: <why>` security page fires **once per (scopeId, refusal text)** while that refusal persists, not on every sweep; the latch clears when the overshoot clears (spent ≤ cap) or the refusal text changes.

- [ ] **Step 1: Write the failing test** in `fleet/tests/test_orchestrator.mjs`, following the existing scenarios' structure (start an orchestrator with a recording `actions.page`, seed `budgets.<scope>.capTokens`, a held `claims.claim:<scope>` row, a `runs.<scope>` row already in a terminal status such as `folded`, and spend rows whose sum exceeds the cap). Call `sweep(now)` three times. Assert exactly **one** `['security', ...]` page whose text contains `supervisor park refused for <scope>` across all three sweeps. Then lower the spend below the cap (or clear the refusal) and raise it again; assert the page fires once more (latch cleared and re-armed).
- [ ] **Step 2: Run `node fleet/tests/test_orchestrator.mjs`** — expect the new assertion to fail (today every sweep pages).
- [ ] **Step 3: Implement the latch** in `fleet/orchestrator.mjs`, inside the spend pass next to the existing `if (parkRefusal) { actions.page('security', ...); continue }` branch: keep a module-local `Map` (e.g. `parkRefusalLatch: scopeId → refusal text`) in `startOrchestrator`'s closure. Page only when the latch has no entry for `scopeId` or its text differs; always `continue` as before. Delete the latch entry for a scope whenever that scope's spend pass finds `spent <= capTokens` (the early `continue`) or when the park write succeeds. Keep the existing behaviour of the `supervisor revoke refused` page unchanged.
- [ ] **Step 4: Run `node fleet/tests/test_orchestrator.mjs` twice** — `ALL TESTS PASSED` both times. Run `python3 -m pytest tests/test_fleet_suite.py -q` — green.
- [ ] **Step 5: Commit** `fix(fleet): latch the park-refusal security page (#190)`.

---

### Task 2: Covering test for `main()`'s default `invokeRun` binding

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `fleet/shim-main.mjs`
- Create: `fleet/tests/test_shim_main_join.mjs`

**Interfaces:**
- Consumes: `main`, `engineArgs`, `ENGINE_COMMAND`, `BASE_REF` from `fleet/shim-main.mjs`; `startOrchestrator` from `fleet/orchestrator.mjs` (or a bare `createWsServer` relay as `fleet/tests/test_shim.mjs` does).
- Produces: `main()` gains one optional, additive option — `spawnEngine` — threaded through to `invokeEngineRun({ repoDir, planPath, exec, spawnEngine })` when no `invokeRun` override is given. Default stays `spawnEngineProcess`; no other signature changes.

- [ ] **Step 1: Write the failing test** `fleet/tests/test_shim_main_join.mjs`: create a temp dir with a fake assignment JSON (`runId`, `token`, `wsUrl`, `ttlMs`, `planPath: 'docs/plan.md'`) and a temp `repoDir`; start a token-accepting ws endpoint on an unused 815x port (either `startOrchestrator` with a token record minted via `fleet/tokens.mjs`, or a bare relay as in `test_shim.mjs`); seed `runs.<runId>` = `pending`. Call `main({ assignmentPath, repoDir, exec, spawnEngine })` with an `exec` stub that records every command and returns `{code: 0, stdout: ''}` for the `git -C <repoDir> checkout -q fleet-base` command (and harmless non-zero for the rest), and a `spawnEngine` stub that records `{command, args, cwd}` and resolves `0`. Assert: `spawnEngine` was called exactly once with `command === ENGINE_COMMAND`, `args` deep-equal to `engineArgs('docs/plan.md')`, `cwd === repoDir`; and `exec` saw the `checkout -q fleet-base` command **before** the engine spawn. The run ends non-green (no receipt file exists) — assert the returned outcome status is `parked` or another non-`gate-green` terminal value, whichever `runShim` produces; do not assert on green.
- [ ] **Step 2: Run `node fleet/tests/test_shim_main_join.mjs`** — expect failure (today `main` ignores a `spawnEngine` option and would try to spawn the real `claude`).
- [ ] **Step 3: Thread `spawnEngine` through `main`** in `fleet/shim-main.mjs`: add `spawnEngine` to `main`'s destructured options and pass it into the default `invokeRun` binding (`invokeEngineRun({ repoDir, planPath, exec, spawnEngine })`). `invokeEngineRun` already accepts `spawnEngine`; nothing else changes.
- [ ] **Step 4: Run the new test twice plus `node fleet/tests/test_shim.mjs`** — `ALL TESTS PASSED` each time; `python3 -m pytest tests/test_fleet_suite.py -q` green.
- [ ] **Step 5: Commit** `test(fleet): cover main()'s default invokeRun join (#190)`.

---

### Task 3: Scope gate-receipt discovery to the run the engine just minted

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `fleet/shim-main.mjs`
- Create: `fleet/tests/test_shim_main_receipts.mjs`

**Interfaces:**
- Consumes: `invokeEngineRun`, `findGateReceiptFile`, `runArtifactDirs`, `RUN_ARTIFACT_DIR`, `GATE_RECEIPT_FILE` from `fleet/shim-main.mjs`.
- Produces: behavioral contract only — `invokeEngineRun` returns `gateGreen: true` **only** when a `PASS` gate receipt exists in a run directory that did **not** exist before the engine was spawned; a pre-existing (stale) receipt in the image can no longer green a run whose engine minted nothing. `findGateReceiptFile` keeps its newest-wins semantics (now asserted by a test).

- [ ] **Step 1: Write the failing test** `fleet/tests/test_shim_main_receipts.mjs` with temp repo dirs (no ws server needed — `invokeEngineRun` is pure aside from `exec`/`spawnEngine`):
  1. **newest-wins**: create `.claude/ultrapowers/run-20260101000000/gate-receipt.json` (`verdict: BLOCKED`) and `.claude/ultrapowers/run-20260202000000/gate-receipt.json` (`verdict: PASS`); assert `findGateReceiptFile(repoDir)` returns the `run-20260202000000` path.
  2. **stale receipt cannot green**: pre-create a single `run-…/gate-receipt.json` with `verdict: PASS`; call `invokeEngineRun({ repoDir, planPath: 'p.md', exec: stub returning code 0, spawnEngine: stub that creates nothing and resolves 0 })`; assert `gateGreen === false`.
  3. **fresh receipt greens**: same pre-existing stale receipt, but the `spawnEngine` stub writes a **new** `run-<later-stamp>/gate-receipt.json` with `verdict: PASS` into `repoDir` before resolving 0; assert `gateGreen === true`.
  4. **fresh BLOCKED stays red**: as 3 but the new receipt's verdict is `BLOCKED`; assert `false`.
- [ ] **Step 2: Run `node fleet/tests/test_shim_main_receipts.mjs`** — case 2 fails today (the stale PASS greens the run).
- [ ] **Step 3: Implement scoping** in `fleet/shim-main.mjs` `invokeEngineRun`: snapshot `new Set(runArtifactDirs(repoDir))` immediately before `spawnEngine`; after it returns, compute the run dirs that are new relative to the snapshot, and evaluate `readGateGreen` only over the newest receipt among **those** dirs (reuse `findReceiptFiles`/`runArtifactDirs`; add a small exported helper such as `findGateReceiptFileAmong(repoDir, dirNames)` if it keeps `invokeEngineRun` readable). No new run dir → `gateGreen: false`. Leave `findGateReceiptFile`'s own behaviour (newest-wins over all dirs) unchanged — the publish step still uses it.
- [ ] **Step 4: Run the new test twice plus `node fleet/tests/test_shim.mjs` and `node fleet/tests/test_drive.mjs`** — `ALL TESTS PASSED` each; `python3 -m pytest tests/test_fleet_suite.py -q` green.
- [ ] **Step 5: Commit** `fix(fleet): scope gate-receipt discovery to the run the engine minted (#190)`.

---

## Operator smoke

- do: `python3 -m pytest tests/test_fleet_suite.py -v`
  see: the two new `test_shim_main_*.mjs` files listed by name alongside the existing five, all PASS.
- do: `node fleet/tests/test_orchestrator.mjs` twice in a row.
  see: `ALL TESTS PASSED` both times, and the park-refusal scenario reports a single security page.
