# ultraplan compile_plan hardening — remainder (#65) — Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the genuine *remainder* of #65 after re-scoping against current `compile_plan.py`. The parser-widening and the description-inferred warning class already shipped (9b9f191+8f5b5ad): `Fixture(s)`/`Test fixture(s)` are in `FILE_LINE`, dotfiles are admitted (`_is_path_token`), and `kind="description-inferred"` warnings exist. The remainder is authoring-layer: make "describe siblings by role, not filename" a *hard write-time* ultraplan rule, add a self-review check that every test-asserted literal traces to prescribed content, and lock the bare `- None` Files edge with a regression test.

**Architecture:** Three surgical touch points. (1) `compile_plan.py` — confirm+lock that a bare `- None` Files entry contributes no writes and fires no near-miss warning (a regression test; fix only if it doesn't already hold). (2) The "sibling-by-role, not-by-filename" guidance is promoted from self-review-only to a hard write-time ultraplan authoring rule in both mirrors (`plan-markers.md` + `ultraplan/SKILL.md`). (3) An ultraplan self-review check: every test-asserted literal must trace to prescribed content in the same task. Prose-contract tests guard (2) and (3); a compiler test guards (1).

**Tech Stack:** Python (`compile_plan.py`, pytest), Markdown (`references/plan-markers.md`, `skills/ultraplan/SKILL.md`).

## Global Constraints

- **Re-scoped to the remainder** — do NOT re-add the already-shipped `Fixture(s)`/dotfile/description-inferred logic; confirm it via tests and build only what's missing.
- **Mirror both ultraplan surfaces** — `plan-markers.md` is the source; `ultraplan/SKILL.md` mirrors. Keep `tests/test_recommendation_rubric.py` drift pins green.
- **No version bump, no direct Anthropic API calls, worktree-pure.**

---

### Task 1: Lock the bare `- None` Files edge

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/scripts/compile_plan.py`
- Test: `tests/test_compile_plan.py`

**Interfaces:**
- Consumes: `_is_path_token` / `FILE_LINE` / the near-miss diagnostic path in `compile_plan.py`.
- Produces: a regression test asserting a gate task with a `Files:` block of `- None` yields no writes and no near-miss/`marker_conflicts` entry for that line; a minimal parser fix only if the assertion fails today.

- [ ] **Step 1: Write the test**

In `tests/test_compile_plan.py`, add `test_bare_none_files_entry_is_silent`: compile a plan whose gate task has a `**Files:**` block containing only `- None`; assert that task contributes no writes and that no `marker_conflicts` entry (or near-miss diagnostic) is raised for the `- None` line.

- [ ] **Step 2: Run the test**

Run: `python3 -m pytest tests/test_compile_plan.py -k bare_none -q`
Expected: If it PASSES, the parser already handles `- None` — proceed to Step 4 (the test becomes a regression lock). If it FAILS, proceed to Step 3.

- [ ] **Step 3: (Only if Step 2 failed) minimal parser fix**

In `compile_plan.py`, treat a bare `None` token on a Files line as an explicit "no files" sentinel: no write, no near-miss warning. Keep the change minimal — do not alter `Fixture(s)`/dotfile handling.

- [ ] **Step 4: Confirm green + commit**

Run: `python3 -m pytest tests/test_compile_plan.py -q`
Expected: PASS.

```bash
git add skills/ultrapowers/scripts/compile_plan.py tests/test_compile_plan.py
git commit -m "test(compile_plan): lock bare '- None' Files entry as silent no-write (#65)"
```

---

### Task 2: Hard write-time "sibling-by-role" rule

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/references/plan-markers.md`
- Modify: `skills/ultraplan/SKILL.md`
- Test: `tests/test_sibling_by_role_rule.py`

**Interfaces:**
- Consumes: the existing `Produces:`/`Consumes:` description guidance in both mirrors.
- Produces: a hard authoring rule — "describe siblings by role, not by filename, in `Produces:`/`Consumes:` descriptions" (backticking a sibling's filename in a description injects a phantom edge) — stated at *write time*, not only in self-review; a prose-contract test asserting the rule in both mirrors.

- [ ] **Step 1: Write the failing prose-contract test**

Create `tests/test_sibling_by_role_rule.py` asserting both `plan-markers.md` and `ultraplan/SKILL.md` contain a write-time rule tying "describe siblings by role / not by filename" to avoiding phantom description edges (check for the phrases `by role` and `description` in both, case-insensitive).

- [ ] **Step 2: Run the test to verify it fails**

Run: `python3 -m pytest tests/test_sibling_by_role_rule.py -q`
Expected: FAIL — the rule lives only in self-review today, not as a hard write-time rule in both mirrors.

- [ ] **Step 3: Add the hard rule to both mirrors**

In `references/plan-markers.md` (near the `Produces:`/`Consumes:` guidance) and `skills/ultraplan/SKILL.md`, add the load-bearing rule: describe siblings by their *role*, not by filename, in interface descriptions; backticking a sibling's filename in a description field injects a phantom serializing edge (compiler warns `description-inferred`, but the author should not write it). Keep the `test_recommendation_rubric.py` drift pins green.

- [ ] **Step 4: Run the test to verify it passes**

Run: `python3 -m pytest tests/test_sibling_by_role_rule.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add skills/ultrapowers/references/plan-markers.md skills/ultraplan/SKILL.md tests/test_sibling_by_role_rule.py
git commit -m "docs(ultraplan): hard write-time rule — describe siblings by role, not filename (#65)"
```

---

### Task 3: Self-review "test-asserted literal traces to prescribed content" check

**Type:** implementation
**Depends-on:** 2

**Files:**
- Modify: `skills/ultraplan/SKILL.md`
- Test: `tests/test_literal_trace_selfreview.py`

**Parallelization rationale:** shares `skills/ultraplan/SKILL.md` with Task 2, so it is honestly serial after it (same-file edit = dependency), not parallel.

**Interfaces:**
- Consumes: the ultraplan self-review checklist (`ultraplan/SKILL.md` ~line 319).
- Produces: a self-review item — every test-asserted literal must trace to prescribed content in the same task (the test/content-contradiction slip from ledger `37eaa67f`); a prose-contract test asserting the item is present.

- [ ] **Step 1: Write the failing prose-contract test**

Create `tests/test_literal_trace_selfreview.py` asserting `ultraplan/SKILL.md` self-review contains a check that every test-asserted literal traces to prescribed content in the same task (check for `test-asserted` / `literal` / `prescribed`-style phrasing, case-insensitive).

- [ ] **Step 2: Run the test to verify it fails**

Run: `python3 -m pytest tests/test_literal_trace_selfreview.py -q`
Expected: FAIL — the check is not yet in the self-review list.

- [ ] **Step 3: Add the self-review check**

In `skills/ultraplan/SKILL.md`'s self-review checklist, add: every literal a task's tests assert must trace to content that same task prescribes (a test asserting a string/behavior the task never produces is a plan contradiction — resolve toward the test as authority and fix the plan).

- [ ] **Step 4: Run the test to verify it passes**

Run: `python3 -m pytest tests/test_literal_trace_selfreview.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add skills/ultraplan/SKILL.md tests/test_literal_trace_selfreview.py
git commit -m "docs(ultraplan): self-review — every test-asserted literal traces to prescribed content (#65)"
```

---

### Task 4: Full-suite gate

**Type:** gate

**Files:** none — verification only.

- [ ] **Step 1: Run the full suite**

Run: `python3 -m pytest`
Expected: PASS — all green, including the three new #65 tests and the unchanged drift pins.

---

## Acceptance

**Acceptance:** suite — Python compiler test + doc guidance, verified by the committed suite (a compiler regression test + two prose-contract tests + the unchanged `test_recommendation_rubric.py` drift pins) plus adversarial diff review; no held-out exam.
