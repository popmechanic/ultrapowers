# Cross-phase integration review before the final PR (#69) — Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a sanctioned holistic cross-phase review to the finishing handoff — one critic over the fully-integrated tree, evaluated against the *combined* plan, gated before the final PR — closing the seam that per-task, per-wave, and per-phase reviews are all structurally blind to.

**Architecture:** Per-task and per-wave (and per-phase, in multi-run pipelines) reviews certify *local* correctness; none looks at the integrated whole across phases against the combined plan. Evidence: six green per-phase sealed gates still let ~21 cross-phase integration bugs (incl. a crash) through, caught only by a holistic review. The fix reuses the existing **completeness-critic role** as a new finishing-handoff invocation — NOT a new harness or subsystem: at the finishing handoff for a multi-phase/multi-run pipeline, run one critic over the integrated tree against the combined plan, gated before the PR is opened. This tightens the existing finishing path (Step 5 / `finishing-notes.md`) and the report format; it is prose + report-schema guidance, not net-new engine code (ratchet: `engineLoc` near baseline).

**Tech Stack:** Markdown (`skills/ultrapowers/SKILL.md` Step 5 finishing handoff, `references/finishing-notes.md`, `references/report-format.md`), Python/pytest (a prose-contract test).

## Global Constraints

- **Reuse, don't add a subsystem** — the holistic review is a new *invocation* of the completeness-critic role at the finishing handoff, not a new harness.
- **Scope to multi-phase/multi-run pipelines** — the single-run engine already runs one completeness critic over its integrated tree; #69 covers the cross-*phase* seam.
- **No version bump, no direct Anthropic API calls, worktree-pure.**

---

### Task 1: Holistic cross-phase review in the finishing handoff

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/SKILL.md`
- Modify: `skills/ultrapowers/references/finishing-notes.md`
- Modify: `skills/ultrapowers/references/report-format.md`
- Test: `tests/test_cross_phase_review.py`

**Interfaces:**
- Consumes: the Step 5 pre-merge report / finishing handoff (`SKILL.md`, ~line 393); `finishing-notes.md`; the completeness-critic role already described for the single-run integration review.
- Produces: finishing-handoff prose sanctioning a holistic cross-phase review (one critic over the integrated tree, evaluated against the combined plan, gated before the PR) for multi-phase/multi-run pipelines; a `report-format.md` line for where its findings land; a prose-contract test asserting the handoff documents it.

- [ ] **Step 1: Write the failing prose-contract test**

Create `tests/test_cross_phase_review.py`:

```python
"""#69: the finishing handoff must sanction a holistic cross-phase review over the
integrated tree against the combined plan, before the final PR."""
import pathlib
ROOT = pathlib.Path(__file__).resolve().parents[1]
SKILL = (ROOT / "skills/ultrapowers/SKILL.md").read_text().lower()
NOTES = (ROOT / "skills/ultrapowers/references/finishing-notes.md").read_text().lower()

def test_finishing_handoff_documents_cross_phase_review():
    blob = SKILL + "\n" + NOTES
    assert "cross-phase" in blob or "cross phase" in blob
    assert "holistic" in blob
    # gated before the final PR
    assert "pr" in blob
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python3 -m pytest tests/test_cross_phase_review.py -q`
Expected: FAIL — the cross-phase/holistic review is not yet documented.

- [ ] **Step 3: Add the finishing-handoff prose**

In `skills/ultrapowers/SKILL.md` (Step 5 / finishing handoff) and `references/finishing-notes.md`, add: for a multi-phase or multi-run pipeline, before opening the final PR, run one **holistic cross-phase review** — the completeness-critic role over the fully-integrated tree, evaluated against the *combined* plan (not any single phase's slice) — and gate the PR on it; findings that span phase seams are the target this review exists to catch. In `references/report-format.md`, add a line noting where cross-phase review findings are recorded in the report. Keep it a tightening of the existing completeness role, not net-new engine code.

- [ ] **Step 4: Run the test to verify it passes**

Run: `python3 -m pytest tests/test_cross_phase_review.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add skills/ultrapowers/SKILL.md skills/ultrapowers/references/finishing-notes.md skills/ultrapowers/references/report-format.md tests/test_cross_phase_review.py
git commit -m "docs(engine): holistic cross-phase review at the finishing handoff before the final PR (#69)"
```

---

### Task 2: Full-suite gate

**Type:** gate

**Files:** none — verification only.

- [ ] **Step 1: Run the full suite**

Run: `python3 -m pytest`
Expected: PASS — all green, including the new prose-contract test.

---

## Acceptance

**Acceptance:** suite — doc/prose change to the finishing handoff, verified by the committed suite (a prose-contract test asserting the handoff documents the cross-phase holistic review) plus adversarial diff review; no held-out exam.
