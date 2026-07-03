# Authored review depth + loop hardening

**Date:** 2026-07-03
**Origin:** 2026-07-03 ultralearn sense pass (runs `acd2b024c36dbc5d` home /
`a4cf14b548134306` foreign, both engine 0.0.30) distilled structural-first;
executes issue #87 (the cycle's deletion candidate) plus four hardening
proposals and the exemplar docs. Operator approved the posture: delete the
heuristics, the plan author marks depth.
**Acceptance:** suite

## Problem

Review depth is the last per-task knob the engine derives by heuristic. The
subsystem (`RISK_PATH` lexicon + `isRiskSurface()` + the sonnet floor,
`waves.js` ~626–666) is a five-generation guard chain in which each generation
manufactured the next one's edge cases (issue #87). Fresh evidence from the
2026-07-03 sense pass:

- **The render lies.** The home run's Step-3 render told the operator Tasks
  1+2 would get adversarial review; the engine gave Task 6 adversarial and
  1–5 lean. The orchestrating LLM cannot predict the heuristic, so the launch
  render — the operator's audit trail — was wrong, and nobody noticed until
  the blind sense pass caught it.
- **Verdicts are uniformly clean.** Across 18+ harvested runs the layers with
  demonstrated disjoint blocking catches are the sealed exam, the completeness
  critic, and the holistic review — not the adversarial second pass.
- **Review is the largest discretionary spend.** 35% (home) to 48% (foreign)
  of run output tokens, all most-capable, including two-pass review of tasks
  whose plan bodies dictate the exact diff.

The plan author already reasons about per-task risk while marking the plan.
Review depth should be an authored plan property — deterministic *and*
human-visible — like `Type:` and `Depends-on:`.

Four smaller findings ride along (details under Hardening): harvester metadata
gaps, the emergent deferredVerification contract, the critic's byte-compare
anti-gaming pattern, and unvalidated launch knobs.

## Design

### 1. The `Review:` marker (ultraplan)

ultraplan gains one optional per-task marker:

```
Review: adversarial
```

Valid values: `adversarial` | `lean`. Unmarked tasks are lean. The authoring
rules gain a rubric line: while marking the plan, decide explicitly which
tasks carry risk that earns a second independent review pass (auth, payments,
migrations, data integrity, public API, hard-to-verify behavior — the same
list the routing rubric uses); mark those `Review: adversarial`. The marker is
additive: sequential executors ignore it.

`references/plan-markers.md` is the source of truth; `ultraplan/SKILL.md`
mirrors it (existing pin applies).

### 2. Compiler slot emission (`compile_plan.py`)

The compiler reads the marker and pre-emits a `review` slot per task in the
launch skeleton, exactly as the 0.0.31 tier slots are emitted: the value
appears in `--emit-launch`/`--emit-args` output, the orchestrator fills
nothing, and the Step-3 render reports a value the engine will actually use.
Unmarked tasks emit `review: "lean"` explicitly — no absent-field ambiguity.
An invalid marker value is a compile error naming the task and the two valid
values.

### 3. Heuristic deletion (`waves.js`)

Delete three things:

- the `RISK_PATH` lexicon,
- `isRiskSurface()` (including contract-root detection),
- the sonnet-floor reviewer-tier rule — all reviewers ride most-capable
  uniformly. Quality > tokens: never economize on the checker; one uniform
  rule replaces a floor condition.

Keep three things:

- `task.review` honoring at top precedence (now fed by the compiler slot),
- the run-wide `reviewProfile: 'adversarial'` escape hatch,
- the typo-surfacing guard for unknown `review` values.

`taskReviewProfile()` collapses to force-up semantics: a task is adversarial
when either its `review` slot or the run-wide profile says adversarial;
otherwise lean. (First-match precedence would make the run-wide hatch dead
code once the compiler emits an explicit `lean` on every unmarked task.) A
plan with no markers runs every task lean, protected by
the unchanged safety net: per-task lean review, wave-merge suite runs, the
sealed exam, the completeness critic, and the holistic cross-run review.

**Accepted trade (operator decision 2026-07-03):** the old heuristic would
escalate a risk-lexicon task even when the author forgot. That backstop moves
to authoring time — the ultraplan rubric line and the operator's plan review.

Prompt text changes ride the anti-drift process: edit
`references/reviewer-prompts.md`, re-bake, keep `test_no_prompt_drift.py`
green. Because `waves.js` changes, the suite-gate requires a covering `.mjs`
sim: extend (or add) a harness sim proving marker-driven depth — a task with
`review: "adversarial"` gets two independent passes, an unmarked task gets
one, and the render economics match the receipts. The sim must print the
`ALL SCENARIOS PASSED` sentinel.

### 4. Hardening bundle

**4a. Receipt harvesting (ultralearn).** `harvest_runs.py` reads
`.claude/ultrapowers/run-<stamp>/gate-receipt.json` (written by `ultra_gate.py`
since 0.0.31) as the bundle's `gateReport`; fall back to the current null only
when absent. `audit_run.py` learns the completeness-critic and setup-actor
prompt shapes so no agent lands as role `unknown`. Evidence: both 0.0.30
bundles carried `gateReport: null` despite fully administered gates, plus two
`unknown` roles each.

**4b. deferredVerification checklist (finishing).** The gate's
`deferredVerification` array becomes a first-class post-merge checklist:
after merge, the orchestrator attempts closure of each item where tooling
exists and reports per-item status — `closed` / `still-open` / `needs-human`
— in the finishing summary. Tracking and reporting only; it authorizes no new
autonomous actions. Seal-author guidance gains one line: declared exam
exclusions flow into `deferredVerification`. Surfaces:
`references/finishing-notes.md`, `references/report-format.md`, seal-author
prompt. Evidence: the foreign run's session discharged its four acks
end-to-end unprompted (the behavior worth formalizing); the home run's
un-exercised SKEW branch survived only as a memory note (the failure mode
this fixes).

**4c. Byte-compare rule (review).** One line in
`references/reviewer-prompts.md`, re-baked: when a task commits a generated
artifact, regenerate it and byte-compare against the committed copy; do not
eyeball. Evidence: the home run's critic did exactly this unprompted for
`complexity-baseline.json`, closing the hand-edited-baseline false-green path
a diff review cannot catch.

**4d. Knob pre-validation (`ultra_run.py`).** When the launch carries a
`bootstrapCmd`, a pre-launch stage executes it once against the session
checkout and requires a clean no-op (exit 0, no tree change); failure blocks
launch and shows the output. No `bootstrapCmd`, no stage.
A bad knob otherwise fails inside every worktree simultaneously. Evidence:
the foreign run's orchestrator did this by hand, citing a lockfile-drift
gotcha.

### 5. Exemplar docs (one task)

- ultraplan guidance: the shrink-budget pattern (a quantified ratchet target
  stated in the task body is an acceptance criterion, not advice — home run
  Task 6 hit 1785 words / 55 concepts under a hard ceiling), and
  escalation-prone task tiering (large single-file refactors tier
  most-capable up front; foreign run escalated exactly such a task after a
  ~19K-token standard-tier StructuredOutput cascade).
- README / design rationale: the operator-arc exemplar — planning decisions +
  gate vouching + one physical-world check was the entire human surface of a
  7-task foreign run.

## Complexity effect

Simplification (issue #87 is the cycle's mandatory deletion candidate).
standingConcepts loses the risk-surface cluster (RISK_PATH, isRiskSurface,
sonnet floor); the `Review:` marker adds one authored concept. Net ratchet
expectation: down. Run `complexity_metric.py --baseline` in the finishing
pass and record the new baseline if the plan touches gate-spec surfaces.

## Out of scope

- Reviewer-tier economization for plan-verbatim tasks (the 35–48% figure is
  now a recorded baseline; revisit only with catch-rate data).
- Grammar validation of the new marker (spec B, the same day's
  `plan-grammar-check` design, ships `--check` and validates `Review:` there).
- Closing issue #74 and ledger stale-marking (bookkeeping, deliberately not
  selected this cycle).
