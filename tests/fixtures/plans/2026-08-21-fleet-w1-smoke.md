# Fleet W1 Smoke — Self-Contained Calibration Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A minimal, fully self-contained addition to `fleet/` — one pure module and its sentinel test — whose entire verification is the committed suite, with no behavior that requires real infrastructure. This is the W1 Task 10 calibration payload: it exists to exercise the fleet run path end to end to a clean `PASS` gate.

**Architecture:** One new pure ESM module `fleet/runid.mjs` exporting two total functions, plus one sentinel `fleet/tests/test_runid.mjs` in the house pattern (hand-rolled `node:assert/strict`, prints `ALL TESTS PASSED`, no ws server, no ports, no temp dirs). `tests/test_fleet_suite.py` globs it in automatically.

**Tech Stack:** Node ≥20 ESM, `node:assert/strict`. No dependencies.

**Spec:** none — this is a calibration payload for the W1 live-run gate read (Task 10), not a tracked feature.

**Acceptance:** suite — one pure module verified entirely by its own sentinel test under the committed `python3 -m pytest` suite. Nothing is deferred; every branch is exercised in-suite.

## Global Constraints

- **No `anthropic` SDK and no API key anywhere in `fleet/`** (repo-wide no-API-key rule).
- **The frozen verification periphery is untouched** — nothing under `skills/ultrapowers/`, `harnesses/`.
- **Fully in-suite verifiable**: no network, no ports, no filesystem, no external infrastructure — the module is pure functions and the test calls them directly.
- The full `python3 -m pytest` suite stays green.

---

### Task 1: `fleet/runid.mjs` — pure run-id helpers

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `fleet/runid.mjs`
- Create: `fleet/tests/test_runid.mjs`

**Interfaces:**
- Consumes: nothing (root, pure).
- Produces (both named-exported from `fleet/runid.mjs`, total and side-effect-free):
  - `isRunId(value: unknown): boolean` — true iff `value` is a string matching `/^run-[0-9]+$/` (e.g. `run-1`, `run-42`), false for everything else (non-strings, empty, `run-`, `run-1a`, `runx-1`).
  - `runSeq(value: unknown): number | null` — the integer after `run-` when `isRunId(value)` is true (`runSeq('run-42') === 42`), else `null`.

- [ ] **Step 1: Write the failing test** `fleet/tests/test_runid.mjs`: import both functions; assert `isRunId('run-1') === true`, `isRunId('run-42') === true`, and `isRunId` is false for `'run-'`, `'run-1a'`, `'runx-1'`, `''`, `'run-01x'`, `42`, `null`, `undefined`, `{}`. Assert `runSeq('run-42') === 42`, `runSeq('run-0') === 0`, and `runSeq` is `null` for `'run-'`, `'abc'`, `7`, `null`. End with `console.log('ALL TESTS PASSED')`.
- [ ] **Step 2: Run `node fleet/tests/test_runid.mjs`** — expect an import failure (module absent).
- [ ] **Step 3: Implement `fleet/runid.mjs`** with the two functions exactly as specified. `isRunId` uses the regex `/^run-(0|[1-9][0-9]*)$/` so leading-zero forms (`run-01`) are rejected — keep the test's cases consistent (drop `run-0`? no: `run-0` is a single zero and matches; `run-01` does not). `runSeq` returns `Number(value.slice(4))` only when `isRunId(value)`, else `null`.
- [ ] **Step 4: Run `node fleet/tests/test_runid.mjs` twice** — `ALL TESTS PASSED` both times. Run `python3 -m pytest tests/test_fleet_suite.py -q` — green.
- [ ] **Step 5: Commit** `feat(fleet): pure run-id helpers (isRunId/runSeq)`.

---

## Operator smoke

- do: `python3 -m pytest tests/test_fleet_suite.py -v`
  see: `test_runid.mjs` listed and PASS alongside the existing fleet tests.
