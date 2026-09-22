# Every dispatch:end row carries the model the worker ran on

**Grammar:** claims-v1

**Claim:** Every `dispatch:end` row carries `model`, the id the worker was dispatched with; where the SDK's result reports `modelUsage`, the row carries those ids too. (quoted from #1228)
**Summary:** The referee now runs on Opus 5.5, but no row of a run's record says which model any worker ran on. This plan writes the model onto every worker's end row. Future readings of wall clock and cost per model, and the census, can be taken straight off the record.

**Goal:** #1228: one pure export in `factory/engine.mjs`, `modelCells({ model, result })`, spread into the `dispatch:end` row at both of the file's dispatch sites — the run's own and the re-fold's — so every such row carries `model` (the id the worker was dispatched with) and `models` (the ids the SDK's result reports under `modelUsage`, or `null`). The exam is two legs added to the existing re-fold dispatch sim, one per behaviour.
**Closes:** #1228

**Tech Stack:** Node 24 ESM, no new npm dependency.
**Exam command:** node {paths}
**Spec:** none on disk — issue #1228 is the brief (map #1131; a column of #1132 and the census read), and everything a worker needs is in the Context. The sandbox holds no spec.

## Global Constraints

- Check: git diff --quiet $ULTRA_BASE -- factory/roles factory/union.mjs factory/worker.mjs factory/reverify.mjs factory/judge.mjs factory/questions.json factory/boot.sh fleet/fleet-bootstrap.sh skills/ultrapowers/kernel
- Every existing cell of a `dispatch:end` row keeps its name and value: `task`, `label`, `role`, `error`, and at the run's own site `wall_ms` and `cost_usd`, are exactly what BASE writes; the new cells are added beside them, and no other row kind changes.
- The record stays the one writer's: the cells are read off `opts` and off the worker's answer already in hand at the row site; nothing asks the SDK, the board or the edge a second question to fill them.

### Task 1: The dispatch:end row carries the dispatched model and the ids the result reports

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `factory/engine.mjs`
- Test: `fleet/tests/test_factory_refold_dispatch.mjs`

**Claim:** After a run, every worker's end row in the record says which model it was dispatched on, and which models the SDK reports it actually used, so a reading of wall clock or cost per model is taken off `events.jsonl` and not reconstructed from which engine sha the run cloned. (derived)
Machine: M1. `makeRefoldDispatch({ worker, appendEvent })` from `factory/engine.mjs`, given `opts` with `model: 'm'` and a `worker` that resolves `{ result: null, denials: [] }`: the `dispatch:end` row handed to `appendEvent` carries `model` exactly `'m'` and `models` exactly `null`.
M2. The same dispatch given a `worker` that resolves `{ result: { modelUsage: { 'claude-opus-5-5': { inputTokens: 1 }, 'claude-haiku-5': { inputTokens: 1 } } }, denials: [] }`: the `dispatch:end` row carries `model` exactly `'m'` and `models` deep-equal to `['claude-haiku-5', 'claude-opus-5-5']` — the keys of `modelUsage`, sorted ascending as strings.
M3. `factory/engine.mjs` exports a pure `modelCells({ model, result })` answering `{ model, models }` by the rule in Context, and both `dispatch:end` row sites of the file — the run's own `dispatchOnce` inside `runEngine` and the re-fold's inside `makeRefoldDispatch` — spread that one answer into the row — a shape clause, read against the diff at landing.

**Authorized-by:** #1228 (map #1131; the referee's move to Opus 5.5 in #1223 is the reading this makes possible).

**Interfaces:**
- Consumes: none
- Produces: `modelCells({ model, result }) -> { model, models }`

**Context:** You see this task body and nothing else. **The gap, at BASE.** `factory/engine.mjs` writes a `dispatch:end` row at exactly two sites (`grep -c "kind: 'dispatch:end'"` answers `2`). The run's own site is inside `runEngine`'s `dispatchOnce` (line 995 opens it; the row is appended at lines 1028–1032): `appendEvent({ kind: 'dispatch:end', task: opts.taskId, label: opts.label, role: opts.role, wall_ms, cost_usd: costUsd, error: (answer && answer.error) || null, ...(opts.retry_of ? { retry_of: opts.retry_of } : {}) })`, where `answer` is what `worker(...)` resolved — or `{ result: null, denials: [], error, turns }` built in the `catch` — and `result` is already read at line 1023 as `const result = answer && answer.result` for the cost tally on the next line. The re-fold's site is inside the exported `makeRefoldDispatch` (line 2257 opens it; the row is appended at lines 2277–2281) with the same shape minus `wall_ms` and `cost_usd`. At both sites the dispatched id is `opts.model` — it is handed to the worker as `model: opts.model` (lines 1005 and 2267) and appears nowhere on either row. On runs 213–216 (2026-09-22) every `dispatch:end` row carries `wall_ms`, `cost_usd` and `error` and nothing about a model. **Where the ids come from.** The worker's answer is `{ result, denials, turns, wall_ms }` from `factory/worker.mjs` line 141, and `result` is the SDK's result message: in `@anthropic-ai/claude-agent-sdk` 0.3.274 (`sdk.d.ts` line 5352) a result carries `modelUsage: Record<string, ModelUsage>` — per-model totals keyed by model id, cumulative for the call — beside the `total_cost_usd` the engine already reads. A worker that threw before its first turn has `result` `null`; a crash result may carry an empty `modelUsage`. **The rule to implement.** Add one exported pure function to `factory/engine.mjs`, in the house style (`export function modelCells ({ model, result }) {`), and add it to the default-export object on the file's last line: it answers `{ model: model ?? null, models }`, where `models` is `Object.keys(result.modelUsage).sort()` when `result` is a non-null object and its `modelUsage` is a non-null object with at least one key, and exactly `null` otherwise — never `[]`, never `undefined`. At each of the two row sites spread `...modelCells({ model: opts.model, result: answer && answer.result })` into the `dispatch:end` object, after `error` and before the `retry_of` spread, so every existing cell keeps its position and value. Touch nothing else in the file: no other row kind, no `dispatch:start` row, no worker argument, no policy. **What already reads the row, unchanged.** `fleet/tests/test_factory_retry.mjs` and the sim this task extends assert named cells of the row (`kind`, `label`, `role`, `task`, `error`, `retry_of`) and never its exact key set; `skills/ultrapowers/scripts/jev_census.py` reads `wall_ms` and `error` off the row (lines 227–234, 298–302). None of them needs an edit. **For the examiner.** The exam extends `fleet/tests/test_factory_refold_dispatch.mjs` (154 lines at BASE, three blocks (a)–(c) under `// ── <letter>. [M<n>] …` comments, `console.log('ALL TESTS PASSED')` on line 154; it already imports `makeRefoldDispatch` and defines `BASE_OPTS` with `model: 'm'`): add the two legs below under one comment naming this task (#1228), above that final line, and edit nothing above the comment. The file is guarded, so it is merged and from then on rides the repository's pytest bridge, which runs it as `node fleet/tests/test_factory_refold_dispatch.mjs` with no network and wants the last line `ALL TESTS PASSED` and exit 0. Keep it hermetic: no child process, no disk write, no network, no other `test_*.mjs` named; every `worker` and `appendEvent` is written in the file. Build each leg's `dispatch` with `makeRefoldDispatch({ worker, appendEvent: (row) => rows.push(row) })` and read `rows[1]` — the `dispatch:end` row; the M2 worker resolves a `result` carrying exactly the two-key `modelUsage` literal M2 names, in that insertion order, so the sorted answer differs from insertion order and the sort is what the leg measures.

**Proof:**
- Test: `fleet/tests/test_factory_refold_dispatch.mjs`
- Guard: `fleet/tests/test_factory_refold_dispatch.mjs`
- Legs: (a) [M1] with `BASE_OPTS` and a worker resolving `{ result: null, denials: [] }`, the second row's `kind` is `dispatch:end`, its `model` is strictly `'m'` and its `models` is strictly `null`; (b) [M2] with `BASE_OPTS` and a worker resolving `{ result: { modelUsage: { 'claude-opus-5-5': { inputTokens: 1 }, 'claude-haiku-5': { inputTokens: 1 } } }, denials: [] }`, the second row's `model` is strictly `'m'` and its `models` deep-equals `['claude-haiku-5', 'claude-opus-5-5']`; (c) [M3] a shape clause with no leg of its own: which export the two row sites spread is read against the diff at landing, and legs (a) and (b) are the computable facts that spread produces on the re-fold path.

**Stale-if:**
- issue-closed: #1228
