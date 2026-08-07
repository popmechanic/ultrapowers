# Plan-Defect Lane Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Disclosed fixes of plan-transcribed defects ride the existing fix loop instead of accumulating into gate redirects — with a hard contract carve-out and gate-visible disclosure — per spec `docs/superpowers/specs/2026-08-06-plan-defect-lane-design.md` (issue #112; includes the CLI-spike isolation rider).

**Architecture:** Pure prompt/doc-contract change: two sentences change inside the BAKE-pinned `IMPLEMENTER_PROMPT` and `REVIEWER_PROMPT` blocks (source `references/reviewer-prompts.md`, baked copy `harnesses/waves.js`); one clause lands in report-format.md's judgmentCalls row and Presentation step 8; one rider line lands in the ultraplan authoring rules (plan-markers.md + its SKILL.md mirror). No schemas, loops, severities, or gate scripts change.

**Tech Stack:** Markdown prompt sources, waves.js baked constants, pytest pins, existing .mjs sims.

**Acceptance:** suite — the committed suite (drift pins, prose pins, sims) is the verification; prompt-behavior obedience is runtime-only and lands on the next live run's evidence, per the standing self-host rule.

## Global Constraints

- **Anti-drift:** every prompt edit lands in `skills/ultrapowers/references/reviewer-prompts.md` AND identically in `skills/ultrapowers/harnesses/waves.js`; `tests/test_no_prompt_drift.py` must stay green.
- **Harness sims:** any `harnesses/*.js` change requires the existing `tests/*.mjs` sims to pass with their `ALL (SCENARIOS|TESTS) PASSED` sentinel (suite-gate rule). New sim scenarios only if Task 1's fix-round verification finds a real behavior change (see its Step 4).
- **No new machinery:** no schema changes, no new report fields/kinds/severities, no new loops, no gate-script edits (frozen periphery untouched).
- **Mirror discipline:** `skills/ultraplan/SKILL.md` mirrors `references/plan-markers.md` — the rider line lands in both, identically; any mirror-pin test stays green.
- Suite gate: `python3 -m pytest` green after every task.

---

### Task 1: The lane — reviewer + implementer prompt sentences (source + re-bake)

**Type:** implementation
**Depends-on:** none
**Review:** adversarial

**Files:**
- Modify: `skills/ultrapowers/references/reviewer-prompts.md`
- Modify: `skills/ultrapowers/harnesses/waves.js`
- Test: `tests/test_no_prompt_drift.py`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: the exact `plan-defect:` routing/disclosure sentences (below) present identically in source and baked copy — Task 2's doc clause describes the same convention but shares no files.

**Parallelization rationale:** file-disjoint from Task 2 (prompt sources vs. report/ultraplan docs); the shared `plan-defect:` convention is pinned verbatim in this plan's text, so both tasks build against prose, not each other's files.

Tier: most-capable — baked-prompt coherence work; adversarial review. The
`tests/test_no_prompt_drift.py` pins need no edits (they assert source↔bake
equality, not content) — they are listed under Test so the reviewer runs them.

- [ ] **Step 1: Replace the reviewer routing sentence**

In `reviewer-prompts.md` (## Reviewer prompt block, the "Plan-supplied code is not privileged" line) and identically in `waves.js` (the baked copy, currently line ~325), replace the sentence:

> Plan-supplied code is not privileged: when the diff faithfully transcribes code from the approved plan and that code carries a genuine defect, report it rather than waiving it as spec-faithful. Prefix the detail plan-defect: — and when fixing it would mean diverging from explicit plan text, report severity minor so the finding routes to the pre-merge gate for a plan-level decision instead of a fix round the implementer cannot resolve.

with:

> Plan-supplied code is not privileged: when the diff faithfully transcribes code from the approved plan and that code carries a genuine defect, report it rather than waiving it as spec-faithful. Prefix the detail plan-defect: — and route by blast radius. Task-local fix: report the finding at its true severity so the normal fix round applies it, and the fix carries the same plan-defect: disclosure. Cross-task interface surface (anything a sibling task Consumes from this task's Produces), or a boundary you cannot establish from this task's own inputs: report severity minor so it routes to the pre-merge gate — when in doubt, gate. When the diff already diverges from plan text under a disclosed plan-defect: concern, verify the disclosed fix against the criterion's intent and block only if the divergence is wrong or undisclosed — a lawful disclosed divergence is not missing evidence.

- [ ] **Step 2: Add the implementer-lane sentence**

In `reviewer-prompts.md` (## Implementer prompt block, immediately after the plan-fidelity/constraints material and before the self-verify checklist) and identically in `waves.js`, add:

> Plan-supplied code that is genuinely defective: you MAY fix a defect in plan-verbatim code when the fix is task-local — never in a cross-task interface surface a sibling consumes; when in doubt, implement the plan as written and report the defect instead. Disclose every such divergence as a concerns entry prefixed plan-defect: naming the plan text you diverged from and why, and report status DONE_WITH_CONCERNS. An undisclosed divergence is a review-blocking defect.

- [ ] **Step 3: Run the drift pin and the sims**

Run: `python3 -m pytest tests/test_no_prompt_drift.py -v && node tests/sim_workflow.mjs`
Expected: pins green (source and bake edited identically), sim prints its sentinel.

- [ ] **Step 4: Verify the fix-round disclosure path (spec §lane)**

Read the fix-iteration dispatch/result handling in `waves.js` (the fix loop inside `runTask`, and the concerns→judgmentCalls push at ~line 757): confirm a fix-round result's `concerns` reach `judgmentCalls` the same way a first-pass result's do.

- If they already flow (both passes return through the same result path): record the confirmation in the commit message; no code change.
- If fix-round concerns are dropped: extend the concerns→judgmentCalls handling to cover the fix-round result, and add one scenario to the existing sim (`tests/sim_workflow.mjs` pattern) asserting a fix-round `DONE_WITH_CONCERNS` result's `plan-defect:`-prefixed concern appears in the returned report's `judgmentCalls`; the sim must keep printing its `ALL SCENARIOS PASSED` sentinel.

- [ ] **Step 5: Full suite**

Run: `python3 -m pytest`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add skills/ultrapowers/references/reviewer-prompts.md skills/ultrapowers/harnesses/waves.js tests/
git commit -m "feat(#112): plan-defect lane — task-local fixes ride the fix loop with disclosure; contract defects still gate (when in doubt, gate)"
```

---

### Task 2: Gate-visibility clause + ultraplan rider

**Type:** implementation
**Depends-on:** none
**Review:** lean

**Files:**
- Modify: `skills/ultrapowers/references/report-format.md`
- Modify: `skills/ultrapowers/references/plan-markers.md`
- Modify: `skills/ultraplan/SKILL.md`

**Interfaces:**
- Consumes: nothing from other tasks (the `plan-defect:` prefix convention is pinned in this plan's own text).
- Produces: nothing consumed by other tasks.

Tier: cheap.

- [ ] **Step 1: Slot the disclosed divergence into the judgmentCalls disagreement kind**

In `report-format.md`'s `judgmentCalls` table row, extend the **disagreement** kind's parenthetical example list with: `disclosed plan-defect divergence (a plan-defect:-prefixed concern)`. Do not add a new kind — the row's own rule says new cases slot into an existing kind.

- [ ] **Step 2: Add the grouping clause to Presentation step 8**

Amend the existing step-8 sentence ("**Judgment calls** — render entries grouped by kind, leading with `disagreement` and `binding` …") with one clause: `within disagreement, cluster plan-defect: entries together so all plan divergences read as one group`.

- [ ] **Step 3: Add the CLI-spike rider to the ultraplan authoring rules**

In `plan-markers.md`'s authoring-rules material and identically in the mirrored section of `skills/ultraplan/SKILL.md` ("Authoring rules (the worktree-pure contract)" list), add one rule line:

> Spike tasks that spawn the real agent CLI must isolate `CLAUDE_CONFIG_DIR` (or disable session persistence) — a spawned session can otherwise write false memories or session state into the host project.

- [ ] **Step 4: Run the suite (mirror + prose pins included)**

Run: `python3 -m pytest`
Expected: green — in particular any pin asserting the plan-markers/SKILL.md mirror; if a pin fixture quotes the authoring-rules block, update it in the same commit.

- [ ] **Step 5: Commit**

```bash
git add skills/ultrapowers/references/report-format.md skills/ultrapowers/references/plan-markers.md skills/ultraplan/SKILL.md
git commit -m "docs(#112): plan-defect divergences cluster in gate presentation; CLI-spike config-isolation rider"
```
