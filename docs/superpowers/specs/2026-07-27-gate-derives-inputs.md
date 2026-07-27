# Spec: the gate derives its inputs from the receipt (#96)

**Status:** approved design — brainstormed 2026-07-27 (docket sweep iteration 1),
expanded from the distill stub. Supersedes #94; absorbs #91 item 1.
Frozen-periphery change: the `run_acceptance.sh`/`ultra_gate.py` half moves only
on the `evals/ab_runner.py` evidence in the Acceptance route below.

## Problem

The pre-merge gate evals two inputs it does not derive:

1. `report.tests.command` — authored by the completeness critic (an LLM),
   stamped verbatim by `waves.js` (`tests: { command: review.command, … }`) and
   eval'd verbatim by `ultra_gate.py` → `run_acceptance.sh --suite-gate`.
   Observed arriving as prose-with-results (bash syntax error → false-red
   BLOCKED) on 2 home runs at 0.1.11 (#94).
2. The suite-gate worktree environment — a fresh detached worktree with no
   dependency install, even when the run receipt carries a Step-2-validated
   `bootstrapCmd`. Observed as module-not-found false-red BLOCKED on genuinely
   green branches in 7 field runs spanning 0.0.29→0.1.11; all five 0.1.x
   sightings post-date 0.1.0 making `suite` the default disposition.

Every observed recovery was an orchestrator hand-editing the recorded command
and re-running until green — disclosed and correct each time (10 runs), but a
standing "gate red → edit gate input → green" precedent (#91 item 7's hazard
class).

A third defect found during design review: if `tests.command` arrives **empty**,
`ultra_gate.py` passes `--run ""` and the suite-gate `eval ""` exits 0 — a
**false-green**. The fix must delete this seam too.

## Design

### The one-derivation chain

Step-2 preflight (`ultra_run.py`) becomes the single point where both gate
inputs are derived and validated; everything downstream consumes its stamps.

```
ultra_run.py preflight
  ├─ bootstrapCmd: operator knob, validated (existing --validate-knobs)
  ├─ testCmd: operator knob, else deterministic detection ladder; miss ⇒ FAIL
  ├─ stamps receipt.json: testCmd, testCmdSource, bootstrapCmd
  └─ injects testCmd into the argsFile skeleton
        │
        ├─ waves.js: report.tests.command = ARGS.testCmd (mechanical);
        │            critic narrative lives only in tests.output
        └─ ultra_gate.py: test_cmd = receipt.testCmd (report.tests.command
             is no longer read); passes --bootstrap receipt.bootstrapCmd
                └─ run_acceptance.sh --suite-gate: provisions the worktree
                     via run_exam()'s existing bootstrap support
```

No agent — implementer, reviewer, critic, or orchestrator — authors or edits a
gate input anywhere on this chain. The edit protocol ceases to exist.

### Engine half (NOT frozen)

**`ultra_run.py`** gains a `test-command` preflight stage:

- The `testCmd` knob wins when supplied.
- Else a deterministic, file-presence detection ladder (no LLM), first match:
  `pytest.ini` / `pyproject.toml [tool.pytest*]` → `python3 -m pytest`;
  `package.json` with a `scripts.test` entry → `npm test` (`pnpm test` /
  `bun test` when the corresponding lockfile is present);
  `Makefile` with a `test` target → `make test`;
  `go.mod` → `go test ./...`; `Cargo.toml` → `cargo test`.
- No match ⇒ the stage **fails loud**, naming the `testCmd` knob as the remedy
  (fail-closed: an unlaunchable run beats a false-green gate). Friendly
  message, never a stack trace.
- Stamps `receipt.testCmd`, `receipt.testCmdSource` (`knob` or
  `detected:<rule>`), and `receipt.bootstrapCmd` (the Step-2-validated value;
  absent key when no knob was supplied).
- Injects the resolved `testCmd` into the argsFile skeleton it already writes,
  so harness, agents, and gate all consume the same value.

**`waves.js`** stamps `report.tests.command = ARGS.testCmd` mechanically at
report assembly; the completeness critic's structured output loses its
`command` field — its narrative lives in `tests.output` (with `testsPassed`
and `findings` unchanged). The critic block in
`references/reviewer-prompts.md` is edited at source and re-baked per
`references/workflow-template.md`; `tests/test_no_prompt_drift.py` stays
green. The prompt's agent-side "detection ladder" fallback clause is deleted
(dead text — the driver now guarantees a test command in args); per-task
`task.testCmd` overrides survive unchanged.

**Sims:** a new `.mjs` scenario proves the mechanical stamp — critic returns
prose → `report.tests.command` still equals `args.testCmd`. Harness sims must
print the `ALL SCENARIOS PASSED` sentinel (suite-gate JS guard).

### Periphery half (FROZEN — moves only on the eval below)

**`run_acceptance.sh --suite-gate`:**

- Accepts `--bootstrap CMD`.
- Routes execution through the existing `run_exam()` core (which already runs
  an optional bootstrap before the run command and classifies a failed
  bootstrap as `EXAM_BOOTSTRAP_ERROR`) — a **shared implementation** with the
  sealed/baseline path, not a copy.
- Preserves every suite-gate specific: the exit-5 "committed suite collected
  no tests" refusal, the harness-JS sims guard after a green suite (with its
  `--base` arming semantics), and redKind vocabulary — a failed bootstrap
  classifies as **environment**, never `assertion`.
- Rejects an empty `--run` with ERROR (deletes the `eval ""` false-green).

**`ultra_gate.py`:**

- `test_cmd` comes from `receipt.testCmd`; `report.tests.command` is no longer
  read for any decision.
- Passes `--bootstrap <receipt.bootstrapCmd>` when the receipt carries one.
- Errors loudly if the receipt lacks `testCmd` (receipts are per-run
  artifacts; there is no compatibility tail to serve).

## Acceptance route (what unfreezes the periphery)

Deterministic eval cell — no `claude` in the loop; the false-BLOCKED
reproduces mechanically today.

- **Fixture** `evals/fixtures/jsdeps/`: a minimal JS project — one real
  dev-dependency, `node_modules` gitignored, one test that imports the
  dependency, `npm test` as the suite, `bootstrapCmd: npm install`.
- **Cell** (new deterministic mode in `evals/ab_runner.py`): prepare the
  fixture repo with a green branch, synthesize the run receipt, invoke the
  pinned engine copy's `run_acceptance.sh --suite-gate`, record a
  `false_block` counter row to `evals/results/runs.jsonl`.
- **Hard gate** (per subtraction-eval doctrine — mechanical counters, no
  quality judgment): baseline engine (0.1.12) → `false_block = 1`; fixed
  engine → `false_block = 0`; no other cell's counters regress; `python3 -m
  pytest` and the harness `.mjs` sims stay green throughout.

## Error handling

- Detection miss → preflight stage failure naming the `testCmd` knob.
- Bootstrap failure at the gate → environment-classified BLOCKED with the
  bootstrap output attached (never `assertion`).
- Empty command → ERROR on both sides (driver never stamps one; gate rejects
  one anyway — defense in depth across the frozen boundary).

## Testing

- `tests/test_ultra_run.py`: detection ladder (each rule + precedence + miss),
  receipt stamping (`testCmd`/`testCmdSource`/`bootstrapCmd`), argsFile
  injection.
- Gate-side pytest: `ultra_gate.py` reads `receipt.testCmd`, passes
  `--bootstrap`, errors on a receipt without `testCmd`.
- New harness sim scenario (mechanical stamp survives critic prose) with the
  pass sentinel.
- `tests/test_no_prompt_drift.py` re-pinned after the bake.
- The eval cell above is the frozen half's hard gate.

## Non-goals

- No new operator knob; `testCmd`/`bootstrapCmd` already exist — detection
  only fills the unsupplied case.
- No change to sealed/baseline acceptance (already bootstrap-aware).
- No gate-history/audit machinery. #91 item 7 stays in #91: deriving gate
  inputs deletes the edit flow item 7 would audit, so its need is re-judged
  against post-#96 field evidence (machinery earned by recurrence, at family
  level, or not built).

## Evidence index

Distill 2026-07-27 (ledger 1088 rows / 118 runs): suite-gate bootstrap cluster
7 runs (sev 2–3); gate-input edits 10 runs; tests.command prose 2 home runs.
Ledger is local (`docs/superpowers/observations/` gitignored); run IDs live in
the ledger rows tagged with those clusters. The empty-command false-green was
found by code inspection during this design session (no field sighting).
