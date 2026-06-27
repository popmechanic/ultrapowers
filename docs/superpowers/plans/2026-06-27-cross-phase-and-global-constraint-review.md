# Cross-Phase & Global-Constraint Review Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the two non-runtime halves of ultralearn's false-green theme — give the completeness critic the global constraints it needs to catch cross-cutting violations (P3), and teach multi-plan efforts to end in an integration-spanning acceptance (P2).

**Architecture:** Two independent changes on disjoint files. P3 is an engine/prompt change: thread the already-captured `globalConstraints` into the completeness-critic prompt (baked from `references/wave-merge.md`) and instruct it to verify each constraint across the integrated tree — the holistic check worktree-isolated per-task reviewers structurally cannot do. P2 is documentation: an ultraplan guidance subsection (no new marker, per the G1 consolidation governor) directing that the final plan of a multi-plan effort carry an integration-spanning acceptance.

**Tech Stack:** The `waves.js` Dynamic Workflow (Node) + its baked-prompt sources (`references/*.md`), the `test_no_prompt_drift` pin, pytest, and Markdown skill docs.

**Acceptance:** suite — engine/prompt/doc development. Author and operator read the diffs; the committed pytest suite, the prompt-drift pins, and per-task review are the verification. No held-out exam (`acceptance.passed === tests.passed`). The `tests/*.mjs` sims are not in CI — run the named one manually.

## Global Constraints

- **Versioning stays `0.0.x`; this plan ships no release** — no `plugin.json`/`marketplace.json` bump.
- **The completeness-critic prompt is BAKED.** Its source is the `<!-- BAKE:COMPLETENESS_PROMPT -->` block in `skills/ultrapowers/references/wave-merge.md`, baked into `skills/ultrapowers/harnesses/waves.js`, pinned by `tests/test_no_prompt_drift.py::test_wave_prompt_is_baked[COMPLETENESS_PROMPT]`. **Edit the source and re-bake the copy together — never edit only one.** (This is the exact fact the prior deferred-verification plan got wrong.)
- **No new variable for P3.** `globalConstraints` (a module-level `const`, `waves.js:173`) and `globalConstraintsBlock` (`waves.js:535`) already exist and are in scope at the completeness call site; reuse them.
- **No new plan marker for P2** — guidance only (the G1 rubric: structural over additive).
- **No direct Anthropic API calls / no `ANTHROPIC_API_KEY`** in any shipped or dev script.
- **`python3 -m pytest` must be green at the end of every task.**

---

### Task P3: Global constraints reach the completeness critic

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/references/wave-merge.md`
- Modify: `skills/ultrapowers/harnesses/waves.js`
- Test: `tests/sim_workflow.mjs`

**Interfaces:**
- Engine/prompt change confined to the completeness role; reuses the existing `globalConstraints`/`globalConstraintsBlock`. No code symbol crosses to Task P2 (disjoint files), so no interface edge.

- [ ] **Step 1: Add the global-constraints clause to the baked source.** In `skills/ultrapowers/references/wave-merge.md`, inside the `<!-- BAKE:COMPLETENESS_PROMPT -->` block, after the "review the integrated result against the original plan" instruction, add:

```
When GLOBAL CONSTRAINTS are provided, verify each one holds across the whole integrated tree, not task by task — a worktree-isolated per-task reviewer could only confirm its own slice. List any constraint the integrated result violates as a blocking gap.
```

- [ ] **Step 2: Run the drift pin to verify it now fails (the source moved ahead of the baked copy).**

Run: `python3 -m pytest "tests/test_no_prompt_drift.py::test_wave_prompt_is_baked[COMPLETENESS_PROMPT]" -v`
Expected: FAIL — the new clause is in `wave-merge.md` but not yet in `waves.js`.

- [ ] **Step 3: Re-bake the clause and wire the constraints into the prompt.** In `skills/ultrapowers/harnesses/waves.js`, in the `completenessPrompt` string (around line 354, after `'review the integrated result against the original plan. '`), add the same sentence as Step 1, and append the existing constraints block to the prompt. Concretely, change the prompt assembly so the completeness prompt ends with `globalConstraintsBlock` exactly as the implementer/reviewer prompts do (`waves.js:645/677`). The block is empty-string when no constraints were supplied, so behavior is unchanged for plans without a `## Global Constraints` section.

```js
// in completenessPrompt(...) — add the instruction clause to the prose, and ensure
// the returned string includes globalConstraintsBlock (in scope as a module const).
// e.g. the function's returned string concatenation gains:  + globalConstraintsBlock
```

- [ ] **Step 4: Run the drift pin + full suite to verify green.**

Run: `python3 -m pytest tests/test_no_prompt_drift.py -q && python3 -m pytest -q`
Expected: PASS (source and baked copy back in sync; no other test regresses).

- [ ] **Step 5: Add a sim assertion that the completeness prompt carries the constraints.** In `tests/sim_workflow.mjs`, extend the existing completeness/report scenario so the run is given a non-empty `globalConstraints`, and assert the completeness prompt text contains that constraint string and the new "across the whole integrated tree" instruction. (Mirror how the scenario already asserts the deferred-verification wording.)

Run: `node tests/sim_workflow.mjs`
Expected: ALL SCENARIOS PASSED, including the global-constraints assertion.

- [ ] **Step 6: Commit.**

```bash
git add skills/ultrapowers/references/wave-merge.md skills/ultrapowers/harnesses/waves.js tests/sim_workflow.mjs
git commit -m "feat(engine): thread global constraints into the completeness critic (holistic gate)"
```

---

### Task P2: Cross-phase integration guidance (ultraplan)

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultraplan/SKILL.md`

**Interfaces:**
- Documentation-only guidance; no markers, no symbols, disjoint from Task P3.

- [ ] **Step 1: Add the guidance subsection.** In `skills/ultraplan/SKILL.md`, add a standalone subsection (near the "Shape the decomposition" guidance, but distinct — it is about multi-*plan* efforts, a level above single-plan shaping):

```markdown
## Efforts too large for one plan

When a spec is decomposed into several plans run as separate `/ultrapowers`
invocations, per-phase green does **not** establish integrated green — each run's
completeness critic sees only its own plan's tree, never the seams between phases.
So when you author one plan of a multi-plan effort:

1. Design the decomposition so the **final** plan carries an **integration-spanning
   acceptance** — a sealed exam or suite whose checks exercise behavior that crosses
   the earlier phases, run against a tree that already contains them.
2. Never let N green per-phase gates stand in for one integrated-green gate; an
   integration bug lives precisely *between* phases, where no single-phase exam looks.
3. If the effort genuinely cannot end in an integration acceptance, declare it at the
   final gate as an explicit waiver ("cross-phase integration unverified — phases
   sealed separately"), never silently.
```

- [ ] **Step 2: Validate skill integrity.**

Run: `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultraplan`
Expected: `skill ok`.

- [ ] **Step 3: Run the full suite (confirm no pinned region was disturbed).**

Run: `python3 -m pytest -q`
Expected: PASS. In particular `tests/test_recommendation_rubric.py` stays green — the new subsection is guidance, not the pinned execution-handoff rubric. If it fails, the subsection landed in a pinned region; relocate it outside the rubric and re-run.

- [ ] **Step 4: Commit.**

```bash
git add skills/ultraplan/SKILL.md
git commit -m "docs(ultraplan): guidance for integration-spanning acceptance on multi-plan efforts (P2)"
```

---

## Self-Review

**Spec coverage:**
- P3 spec → Task P3 (source clause + re-bake + wiring + sim assertion). ✓ Reuses `globalConstraints`/`globalConstraintsBlock`; per-task reviewer prompts untouched (already carry the attention lens). ✓
- P2 spec → Task P2 (ultraplan guidance subsection, no marker). ✓

**File-seam / wave check (by hand):**
- P3 files: `wave-merge.md`, `waves.js`, `sim_workflow.mjs`. P2 files: `ultraplan/SKILL.md`. **Disjoint** → P2 ∥ P3, one wave, width 2, no collision.

**Placeholder scan:** the wave-merge.md clause text, the waves.js wiring direction, and both verification commands are concrete. The sim assertion is specified behaviorally against the existing scenario (the executor has the file open). No TBD/TODO.

**Type consistency:** no cross-task symbols (disjoint changes). P3 reuses the exact existing names `globalConstraints` / `globalConstraintsBlock`.

**Acceptance:** `suite` — declared in the header; no sealing step (diffs readable).

---

## Execution Handoff

**Fit analysis:** 2 implementation tasks (P2, P3), independent (widest wave 2), low risk — engine-prompt + doc, `suite` acceptance, diffs readable, no auth/payments/migrations. The marker graph is two parallel tasks, but **T = 2**, so the engine machinery does not pay for itself → **Inline (recommended)**. (Splitting further to manufacture width would violate ultraplan's right-sizing rule.)

1. **Ultrapowers** — `/ultrapowers docs/superpowers/plans/2026-06-27-cross-phase-and-global-constraint-review.md`: parallel waves, worktree isolation, per-task review, one pre-merge human gate.
2. **Subagent-Driven** — superpowers:subagent-driven-development, sequential, review between tasks.
3. **Inline (recommended)** — superpowers:executing-plans: two small, independent diffs with the drift pin as the safety net; fastest path with no worktree overhead.
