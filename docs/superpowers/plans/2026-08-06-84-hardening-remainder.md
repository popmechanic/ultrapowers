# #84 Hardening Remainder Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the two live #103 seams (GUARD per-task-reviewer location clause; resume-reuse cleanliness contract) and #102's three workflow-template contradictions — per spec `docs/superpowers/specs/2026-08-06-84-hardening-remainder-design.md` (seams 1–2 closed by code evidence, seam 5 + dead-critic parked as watch-items; see the spec's staleness table).

**Architecture:** Two prompt-source sentences (GUARD block in reviewer-prompts.md; resume arm in wave-merge.md), each re-baked identically into waves.js with drift pins green and one assertion added to the existing `scenarioResume`; plus three doc corrections in workflow-template.md. No scripts change; frozen periphery byte-identical.

**Tech Stack:** Markdown prompt sources, waves.js baked constants, existing .mjs sim, pytest drift pins.

**Acceptance:** suite.

## Global Constraints

- **Anti-drift:** every prompt edit lands in its source (`references/reviewer-prompts.md` BAKE:GUARD block / `references/wave-merge.md` setup section) AND identically in `harnesses/waves.js`; `tests/test_no_prompt_drift.py` stays green. The seam-3 edit also normalizes the baked GUARD's dropped em-dash appositive so source and bake match byte-exactly.
- **Harness sims:** the waves.js re-bake means the suite-gate runs the `.mjs` sims — they must pass with their sentinel; `tests/sim_workflow.mjs`'s `scenarioResume` gains exactly one assertion line, no new scenarios, no new test files (the spec's deliberate ~zero-new-test-mass posture).
- Frozen scripts (`gate_check.py`, `run_acceptance.sh`, `ultra_gate.py`, `run_lock.sh`) byte-identical.
- No new dependencies; suite gate `python3 -m pytest` green after every task.

---

### Task 1: GUARD location clause + resume cleanliness sentence (sources + re-bake + sim assertion)

**Type:** implementation
**Depends-on:** none
**Review:** adversarial

**Files:**
- Modify: `skills/ultrapowers/references/reviewer-prompts.md`
- Modify: `skills/ultrapowers/references/wave-merge.md`
- Modify: `skills/ultrapowers/harnesses/waves.js`
- Test: `tests/sim_workflow.mjs`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: nothing consumed by other tasks (Task 2 is doc-only and file-disjoint).

**Parallelization rationale:** file-disjoint from Task 2; both run in wave 1.

Tier: most-capable — GUARD edits touch the engine's sole wrong-repo safety net; prompt-coherence work is the known redirect generator.

- [ ] **Step 1: Add the GUARD location clause (source + bake)**

In the `BAKE:GUARD` block of `reviewer-prompts.md`, insert after the sentence ending "…the single sanctioned exception is the completeness critic's sha-verified git checkout --detach INSIDE the run's dedicated integration worktree, which releases the integration branch for the gate and never touches the session checkout.":

> The per-task reviewer's sanctioned location is the session launch directory itself, non-isolated and read-only, judging from the pre-baked review packet (or the read-only object-store diff fallback) — it claims no worktree of its own.

Make the identical insertion in the baked GUARD constant in `waves.js`, and in the same edit align the baked copy byte-exactly with the source (restoring the em-dash appositive the bake dropped — the #103 nit).

- [ ] **Step 2: Add the resume-reuse cleanliness sentence (source + bake)**

In `wave-merge.md`'s resume setup section and identically in the `SETUP_PROMPT` resume arm in `waves.js`, extend the reuse instruction ("if `<INTEGRATION_WT>` already exists, check out `<integrationBranch>` inside it") with:

> Before that checkout, verify the reused worktree is clean (git status --porcelain); if it is dirty, report BLOCKED with the porcelain output — never absorb pre-existing dirt into the run's diff.

- [ ] **Step 3: Add the scenarioResume assertion**

In `tests/sim_workflow.mjs`, inside the existing `scenarioResume`, add one assertion: the dispatched resume setup prompt contains the fragment `git status --porcelain` (quote the dispatched string, not a paraphrase — the standing sim-assertion rule). No new scenario.

- [ ] **Step 4: Run the pins and sims**

Run: `python3 -m pytest tests/test_no_prompt_drift.py -v && node tests/sim_workflow.mjs`
Expected: drift pins green (byte-exact source↔bake, including the GUARD alignment); sim prints its sentinel with the new assertion passing.

- [ ] **Step 5: Full suite**

Run: `python3 -m pytest`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add skills/ultrapowers/references/reviewer-prompts.md skills/ultrapowers/references/wave-merge.md skills/ultrapowers/harnesses/waves.js tests/sim_workflow.mjs
git commit -m "fix(#103): GUARD names the per-task reviewer's location; resume-reuse gains its cleanliness contract (seams 3+4; em-dash bake alignment)"
```

---

### Task 2: workflow-template.md catches up with #84 (#102)

**Type:** implementation
**Depends-on:** none
**Review:** lean

**Files:**
- Modify: `skills/ultrapowers/references/workflow-template.md`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: nothing consumed by other tasks.

Tier: cheap.

- [ ] **Step 1: Fix the three contradictions**

All three describe the pre-#84 world; rewrite to the shipped choreography (integration in its dedicated worktree, created by setup, released by the critic's detach):

1. Line ~80: "the merge and completeness roles, which test the integrated tree on the session main checkout, keep using the run-wide `testCmd`" → "the merge and completeness roles, which test the integrated tree in the run's dedicated integration worktree, keep using the run-wide `testCmd`".
2. Line ~87: "The non-isolated roles (setup/merge/reconcile/completeness) operate on the session main checkout, which already has its deps, so they do NOT run it." → "The non-isolated roles (setup/merge/reconcile/completeness) operate in the run's dedicated integration worktree; setup runs `bootstrapCmd` there once after creating it, so the later roles do NOT re-run it."
3. Line ~89: "the setup agent checks it out before creating the integration branch (guards against a stale checkout from a previous run)" → "the base ref from which the setup agent cuts the dedicated integration worktree and its branch (`git worktree add … -b <integrationBranch> <baseBranch>`); the session checkout is never moved."

Verify each replacement against the current shipped behavior described in `wave-merge.md`'s setup section before committing — the template is the re-bake manual and must not introduce a fourth contradiction.

- [ ] **Step 2: Run the suite**

Run: `python3 -m pytest`
Expected: green (no pin covers the template; the suite run is the no-collateral check).

- [ ] **Step 3: Commit**

```bash
git add skills/ultrapowers/references/workflow-template.md
git commit -m "docs(#102): workflow-template.md describes the shipped #84 choreography (integration worktree, not session checkout)"
```
