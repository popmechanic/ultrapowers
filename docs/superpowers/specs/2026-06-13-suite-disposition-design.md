# The `suite` acceptance disposition

**Date:** 2026-06-13
**Addendum to** `2026-06-12-sealed-acceptance-design.md` (part 1 of the
verification-first architecture). Lands on the same PR/integration branch
(`ultra/integration-20260612-150003`) before that work merges to `main`.

## Problem

The sealed-acceptance contract enforces that every **marked** plan carries an
`**Acceptance:**` line — `sealed` (held-out exam) or `waived` (operator opts
out). The completeness critic found that the founding plan itself carries no
such line and would fail compilation under the enforcement it ships. The
problem is wider than one plan: **all eleven** marked plans committed in
`docs/superpowers/plans/` predate the contract and lack the line, so merging
this PR to `main` would make every one of them uncompilable.

Deeper than the breakage is a semantic gap. ultrapowers' own development plans
fit neither shipped disposition honestly. They are not *opting out* of
verification — they are verified by TDD, the full committed pytest suite, the
anti-drift pins, and adversarial review. The verification is real; it simply
cannot be *held-out*, because the implementers' job is editing those very test
files. The held-out-exam model exists for exactly one reason — **the operator
cannot read the code** — and for ultrapowers-on-ultrapowers that premise is
false: the author reads every diff and the operator reviews. Labeling such
plans `waived` would commit, in miniature, the same dishonesty the critic
flagged: it would say "verification skipped" when verification happened, just
differently.

## Decision (brainstorm, 2026-06-13)

Introduce a third, first-class disposition rather than overload `waived`. This
subsystem's purpose is verification *honesty*; it should describe its own
verification truthfully. Nearly every plan this repo will ever produce is
engine-internal, so the disposition pays for itself immediately.

## The `suite` disposition

Marker form (plan-level, outside any task, fence-aware like the others):

```
**Acceptance:** suite — <reason>
```

Semantics: *verification is the project's own committed test suite, not a
held-out exam.*

- **Compiler** (`compile_plan.py`): `parse_acceptance` gains a `suite` branch
  returning `{"mode": "suite", "reason": <text>}`. A `suite` line satisfies
  the marked-plan enforcement exactly as `sealed`/`waived` do. The
  `marker_conflicts`/output behavior is unchanged otherwise.
- **Engine** (`workflow.js`): a `suite` disposition is **load-bearing, not
  cosmetic.** The engine sets
  `acceptance = { mode: 'suite', passed: <review.testsPassed>, reason }`
  — the acceptance signal *is* the committed test result. No held-out exam is
  administered (no vault, no `run_acceptance.sh` call). Because `acceptance.passed`
  mirrors `tests.passed`, a red suite blocks Approve via both the existing
  test gate and the acceptance gate.
- **Gate** (ultrapowers SKILL.md Step 5): the Approve condition is unchanged
  in spirit —
  `tests.passed && (acceptance is null || acceptance.passed || acceptance.mode === 'waived')`.
  A `suite` plan has `acceptance.passed === tests.passed`, so it gates
  correctly with no special case. The report renders the disposition
  (`suite — <reason>`) like the others.

`waived` retains its true, narrower meaning after this change: verification
genuinely skipped, by explicit operator choice.

## The forward rule (ultraplan sealing step)

The sealing step documents which disposition to choose:

- **Feature work against an app the operator cannot read → `sealed`** (the
  default; held-out exam authored from the spec).
- **ultrapowers' own engine / skill / doc / prompt / script development →
  `suite`** (author and operator both read the diffs; the committed pytest
  suite + drift pins + adversarial review are the verification).
- **`waived`** → explicit, reasoned opt-out; neither held-out nor
  suite-covered verification applies.

## Backfill

Every pre-contract marked plan in `docs/superpowers/plans/` is engine-internal
and receives `**Acceptance:** suite — <one-line reason>` immediately after its
header block:

- `2026-06-10-plan-marker-injection.md`
- `2026-06-11-interop-hardening.md`
- `2026-06-11-open-issues-batch.md`
- `2026-06-11-review-cycle-1-fixes.md`
- `2026-06-11-review-cycle-2-fixes.md`
- `2026-06-11-review-cycle-3-fixes.md`
- `2026-06-11-review-cycle-4-fixes.md`
- `2026-06-11-tier-criteria-and-effort-audit.md`
- `2026-06-12-eval-driven-hardening.md`
- `2026-06-12-unified-agent-visualization.md`
- `2026-06-12-sealed-acceptance.md` (the founding plan — its verification is
  `test_run_acceptance.py` plus the compiler tests; a held-out exam would be
  recursive)

This plan's own document also declares `**Acceptance:** suite` — the contract
using its new escape hatch on the work that adds it.

## Verification of this change

A new test asserts that **every** marked plan in `docs/superpowers/plans/`
compiles under the enforcing compiler (i.e. carries a valid disposition) — so
the repo can never again accumulate an uncompilable committed plan. Plus unit
tests for the `suite` branch of `parse_acceptance`, and a sim scenario (or
extension) covering the engine's `suite` acceptance wiring
(`acceptance.passed === tests.passed`, no vault touched).

## Error handling

- A `suite` line with an empty reason → treat as present but the compiler
  emits the reason as `""` (no hard failure; the reason is documentation, not
  load-bearing). The ultraplan guidance asks for a reason; the compiler does
  not police prose quality.
- `suite` and `sealed`/`waived` both present → first match wins by document
  order, consistent with the existing `parse_acceptance` first-match scan;
  not an error (the established precedence rule).

## Non-goals

- No change to how `sealed` or `waived` behave.
- No retroactive sealing of historical plans (they are `suite` by nature).
- No new vault or runner behavior — `suite` administers no exam.
