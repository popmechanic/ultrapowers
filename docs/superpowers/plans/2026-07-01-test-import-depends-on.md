# Declare test-only dependencies as explicit Depends-on (#71) — Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the residual where a dependency that lives *only* in a test file's `import` of a sibling symbol — invisible to the marker-based compiler by design — cascade-blocks a wave. Fix at the authoring layer, not by teaching the compiler to parse test source.

**Architecture:** `compile_plan.py` infers edges from declared markers (`Test:` path overlap, read-after-write, prose-reference, write-after-write) but never reads source/test *file contents*. So an edge expressed only inside a test's `import` statement is structurally out of scope — by design. The cheapest, correct fix is authoring guidance in the two mirrored ultraplan surfaces: **when a task's test imports a symbol owned by another task, declare that as an explicit `Depends-on`.** A prose-contract test guards the guidance in both mirrors so it cannot silently regress.

**Tech Stack:** Markdown (`references/plan-markers.md`, `skills/ultraplan/SKILL.md`), Python/pytest (a new prose-contract test).

## Global Constraints

- **Mirror both surfaces consistently** — `references/plan-markers.md` is the source; `skills/ultraplan/SKILL.md` mirrors it. Keep existing drift pins (`tests/test_recommendation_rubric.py`) green; the new guidance is additive and outside the shared execution-fit rubric text.
- **Doc-only** — no compiler change; the compiler's marker-only scope is intended.
- **No version bump, no direct Anthropic API calls, worktree-pure.**

---

### Task 1: Test-import Depends-on authoring guidance

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/references/plan-markers.md`
- Modify: `skills/ultraplan/SKILL.md`
- Test: `tests/test_test_import_guidance.py`

**Interfaces:**
- Consumes: the existing `Depends-on` section in `plan-markers.md` (the "additive" paragraph, ~line 48) and its mirror in `ultraplan/SKILL.md` (~line 238).
- Produces: a paragraph in both surfaces stating that a dependency living only in a test's `import` of a sibling's symbol is invisible to the compiler and MUST be declared as an explicit `Depends-on`; plus `tests/test_test_import_guidance.py` asserting the guidance is present in both files.

- [ ] **Step 1: Write the failing prose-contract test**

Create `tests/test_test_import_guidance.py`:

```python
"""The test-import Depends-on guidance (#71) must live in BOTH ultraplan mirrors
so a test-only import edge is declared, not left to cascade-block a wave."""
import pathlib
ROOT = pathlib.Path(__file__).resolve().parents[1]
MARKERS = (ROOT / "skills/ultrapowers/references/plan-markers.md").read_text().lower()
SKILL = (ROOT / "skills/ultraplan/SKILL.md").read_text().lower()

def test_markers_document_test_import_dependency():
    assert "import" in MARKERS and "depends-on" in MARKERS
    # the guidance ties a test's import of a sibling symbol to an explicit Depends-on
    assert "test" in MARKERS and "sibling" in MARKERS

def test_skill_mirrors_test_import_guidance():
    assert "import" in SKILL and "depends-on" in SKILL and "test" in SKILL
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python3 -m pytest tests/test_test_import_guidance.py -q`
Expected: FAIL — the guidance (test-import → explicit Depends-on) is not yet present.

- [ ] **Step 3: Add the guidance to both mirrors**

In `references/plan-markers.md`, after the `Depends-on` "additive" paragraph, add: a task whose **test** imports a symbol owned by another task has a real dependency the compiler cannot see (it parses markers, not test source); declare it as an explicit `**Depends-on:**` so the two tasks don't run in parallel off a base where the imported sibling does not yet exist. In `skills/ultraplan/SKILL.md`, add the mirrored sentence near the existing `Consumes`/`Depends-on` guidance (~line 238). Keep the wording aligned across both.

- [ ] **Step 4: Run the test to verify it passes**

Run: `python3 -m pytest tests/test_test_import_guidance.py -q`
Expected: PASS. Also run `python3 -m pytest tests/test_recommendation_rubric.py -q` to confirm the shared-rubric drift pins stay green.

- [ ] **Step 5: Commit**

```bash
git add skills/ultrapowers/references/plan-markers.md skills/ultraplan/SKILL.md tests/test_test_import_guidance.py
git commit -m "docs(ultraplan): declare test-only import dependencies as explicit Depends-on (#71)"
```

---

### Task 2: Full-suite gate

**Type:** gate

**Files:** none — verification only.

- [ ] **Step 1: Run the full suite**

Run: `python3 -m pytest`
Expected: PASS — all green, including the new prose-contract test and the unchanged drift pins.

---

## Acceptance

**Acceptance:** suite — doc-only ultraplan guidance, verified by the committed suite (a prose-contract test asserting the guidance in both mirrors + the unchanged `test_recommendation_rubric.py` drift pins) plus adversarial diff review; no held-out exam.
