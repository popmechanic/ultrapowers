# Shrink budgets: state the delta, pin the ceiling (#248)

**Date:** 2026-08-26
**Issue:** #248 (from the 2026-08-25 drain: #222 Task 4 fix-loop-exhausted on a
plan-stated absolute ceiling its own mandated text made unreachable; same shape
as the 08-11 checksum-contradiction, ledger 1ba01a2a — a plan-authored number
is a second, unpinned copy of the payload and drifts).
**Surfaces:** `skills/ultraplan/SKILL.md` (one bullet),
`tests/test_skill_budget.py` (new).
**Frozen periphery:** untouched.

## Design

Issue changes 1+2 only; change 3 (derive-never-type machinery) is explicitly
deferred unless recurrence survives 1+2.

### 1. Delta form (ultraplan SKILL.md, the "Shrink budgets" bullet)

Replace the bullet with this exact text (the wording IS the payload on a
ratcheted surface — no second unpinned copy in the plan):

> - **Shrink budgets are acceptance criteria — stated as deltas.** When a
>   task edits a complexity-ratcheted surface (SKILL.md, gate-spec docs),
>   state the net word delta its own diff implies (`net delta ≤ +N words`,
>   or `≤ −N`) — computable from the task's fenced replacement blocks minus
>   the text they replace, and verified at task end as word-count(file
>   after) − word-count(file before) over the task's own diff. Never state
>   an absolute ceiling: it needs the file's current size plus every
>   sibling task's delta, and a plan-authored number is a second, unpinned
>   copy that drifts — the absolute lives in `tests/test_skill_budget.py`.

This edit's own net delta on `skills/ultraplan/SKILL.md`: ≤ +65 words
(replacing a ~41-word bullet with a ~105-word one). (#225 used the delta
form and it held.)

### 2. Ceiling pin (`tests/test_skill_budget.py`, new)

`wc -w`-equivalent word counts of `skills/ultrapowers/SKILL.md` and
`skills/ultraplan/SKILL.md` must each be ≤ a constant N per file, set to the
file's count at merge time. **Merge-order obligation:** this plan merges LAST
among slate plans touching either SKILL.md (B and C both touch
ultrapowers/SKILL.md), and N is re-measured on the final rebase before merge
— otherwise a later slate merge trips a fresh pin and forces a day-one N
edit. Comment in the test states the ratchet contract: N is lowered at each
release that shrinks the file and never raised without the `chore(release)`
commit body stating the new N and what pays for it (this repo's release
artifact — it has no separate release notes). Every plan on every surface
inherits the ceiling; growth must be paid for by deletion elsewhere.

Word count is computed in-test as `len(text.split())` (identical to `wc -w`),
so the pin has no shell dependency.

### Canary

Plan-caused redirect rounds whose cause is a plan-stated numeric criterion
(this cycle: 1) — the sense pass reads it per the adopted-proposal
retrospective.

## Out of scope

Change 3 (compile-time ceiling derivation — eval-route if ever, the diagnostic
vocabulary is FROZEN); any shrink of the SKILL.md files themselves (#241 was
the named payback and is NO-GO'd; the ceiling pins today's size).

## Trim review

**Author disclosure — Adds:** delta-form authoring rule, one pinned ceiling
test. **Removes:** plan-authored absolute ceilings (the drifting second
copy).

**Reviewer (fresh-context, 2026-08-26): no deletions proposed (spec
near-minimal, narrower than the issue); 4 under-spec flags; rider verdict
conditional; grade FLAT.** Adopt-or-answer:

- **1a (verification path) — ADOPTED.** The bullet now states how the delta
  is verified at task end.
- **1b (exact replacement text + self-applied delta) — ADOPTED.** Pinned in
  Design §1 with its own stated net delta.
- **2 (name the raise artifact) — ADOPTED.** A raise requires the
  `chore(release)` commit body to state the new N and what pays for it.
- **3 (lowering half has no trigger) — ANSWERED (accepted as manual).** The
  raise-guard is the load-bearing half; no machinery built (hygiene-check
  slack reporting noted as a possible future, not this spec).
- **5 / rider verdict — ADOPTED as standalone-merged-last.** This plan gets
  its own PR, merged after every other SKILL.md-touching slate plan, with N
  measured on the final rebase; per-commit `(#248)` close reference
  preserved.
- **netConceptDelta: flat** (reviewer-graded; the absolute relocates from
  every plan into one pinned test).
