# Global constraints reach the completeness critic — design

**Date:** 2026-06-27 · **Status:** draft design, pre-plan (awaiting operator approval)
**Scope:** thread the plan's `## Global Constraints` block into the completeness
critic's prompt and instruct it to verify each constraint holds **across the
integrated tree** — the holistic check that worktree-isolated per-task reviewers
structurally cannot do (ultralearn P3). Engine/prompt change → **Acceptance:** suite.

---

## 0. TL;DR

ultralearn P3 was framed as "per-task reviewers are blind to global constraints." On
inspection that framing is **wrong**: per-task reviewers already receive the global
constraints as an "attention lens" (`reviewer-prompts.md` §39/§120, wired in
`waves.js:240/275/535`). The real gap is downstream: a per-task reviewer is
**worktree-isolated** and can only confirm *its own slice* complies; the one role that
sees the whole integrated tree — the **completeness critic** — is **never handed the
global constraints**. So a cross-cutting constraint ("every handler uses pattern X", "no
task introduces a second source of truth for Y") falls through: each per-task reviewer
passes its slice, and nothing verifies the constraint *holistically*. Fix: pass
`globalConstraints` into the completeness prompt and instruct it to gate the integrated
tree against every one.

## 1. What I verified (grounding)

- **Per-task reviewers already get global constraints.** `references/reviewer-prompts.md`
  bakes a `GLOBAL CONSTRAINTS` input (§39) and an `Attention lens` instruction (§120):
  "gate the diff against every one of them." Wired in `waves.js` at the implementer
  (645), reviewer (677), and fix (752) prompts via `globalConstraintsBlock` (535).
- **The completeness critic does NOT.** `completenessPrompt(mergeHeadSha, cannotVerifyChecklist)`
  (`waves.js:342–366`, called at `:1155`) reviews against the plan, the cannotVerify
  checklist, missing deliverables, and deferredVerification — `globalConstraints` is
  never referenced.
- **The completeness prompt is BAKED** from `references/wave-merge.md`
  (`<!-- BAKE:COMPLETENESS_PROMPT -->`, line 108), pinned by
  `tests/test_no_prompt_drift.py::test_wave_prompt_is_baked[COMPLETENESS_PROMPT]`. (This
  is the exact fact the deferred-verification plan got wrong; recorded here so this plan
  does not.)
- `globalConstraints` is a module-level `const` in `waves.js` (173), already in scope at
  the completeness call site.

## 2. Why per-task review can't cover it (the structural reason)

A per-task reviewer sees **one task's diff** in **one worktree**. A global constraint that
binds *across* tasks ("all N handlers", "single source of truth", "no new dependency
anywhere") cannot be confirmed from one slice — the reviewer can only say "my slice
complies," not "the constraint holds everywhere." The completeness critic, detached on the
*integrated* tree, is the only role positioned to check it. Today it isn't asked to.

## 3. Design

### 3.1 Source edit — `references/wave-merge.md` (`COMPLETENESS_PROMPT` block)
Add, after the existing plan-review instruction, a global-constraints clause:

> When GLOBAL CONSTRAINTS are provided, verify each one holds **across the whole
> integrated tree**, not task-by-task — a per-task reviewer could only see its own slice.
> List any constraint the integrated result violates as a gap.

### 3.2 Re-bake + wire — `harnesses/waves.js`
- Re-bake the new prose into the `completenessPrompt` string (keep
  `test_no_prompt_drift` green — never edit only the baked copy).
- Append the existing `globalConstraintsBlock` (535) to the completeness prompt, exactly
  as the implementer/reviewer prompts already do. No new variable; `globalConstraints` is
  in scope.

### 3.3 No per-task reviewer change
The per-task `Attention lens` already covers the slice-level check. Adding more there
would be redundant. (Deliberately leaving `reviewer-prompts.md` untouched keeps the change
to one baked block.)

## 4. Complexity accounting

`complexityEffect: structural` (per the G1 rubric). This **completes an existing concept**
(global constraints as a verification lens) by extending it to the role that can actually
enforce it — rather than adding a parallel mechanism. Net standing concepts: **+0** (reuses
`globalConstraints` + `globalConstraintsBlock`); one baked block gains a clause. No new
report field, no new gate disposition.

## 5. Surfaces touched

- `references/wave-merge.md` — `COMPLETENESS_PROMPT` source clause.
- `harnesses/waves.js` — re-bake + append `globalConstraintsBlock` to the completeness prompt.
- `tests/test_no_prompt_drift.py` — stays green (pins the re-bake); the new clause must
  appear in both source and baked copy.
- `tests/sim_workflow.mjs` — add an assertion that, when `globalConstraints` is supplied,
  the completeness prompt contains them (manual sim; mirrors the deferred-verification scenario).

No inner-loop cost: this is the single completeness agent's prompt, run once per run.

## 6. Open questions

- Should a violated global constraint be a **blocking** completeness finding (gate refusal)
  or a surfaced judgment call? Leaning blocking — a known cross-cutting violation that merged
  green is exactly the failure P3 came from. Confirm at plan time.

## 7. Provenance

ultralearn distill 2026-06-27, P3 ("per-task reviewers split on a global design constraint;
the violation merged green" + "isolated reviewers act on false beliefs about integrated state
only the final critic can see"). Sibling: `2026-06-27-cross-phase-integration-acceptance-design.md`.
