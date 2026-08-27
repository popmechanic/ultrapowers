# Shrink-Budget Deltas + Ceiling Pin Implementation Plan (#248)

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Acceptance:** suite — one doc bullet + one new self-contained test file.

**Goal:** Ultraplan states shrink budgets as computable deltas, and the absolute ceilings move into one release-pinned test.

**Architecture:** Replace the "Shrink budgets" bullet in ultraplan SKILL.md with the spec's pinned delta-form text; add `tests/test_skill_budget.py` pinning both SKILL.md word counts at their merge-time values.

**Tech Stack:** Python 3 + pytest; markdown.

**Spec:** docs/superpowers/specs/2026-08-26-shrink-budget-deltas.md

## Global Constraints

- FROZEN periphery untouched.
- **Merge-order obligation:** this plan merges LAST among slate plans touching either SKILL.md; the N constants are measured on the final rebase immediately before merge.
- `python3 -m pytest` green.

---

### Task 1: Delta bullet + ceiling pin

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultraplan/SKILL.md`
- Create: `tests/test_skill_budget.py`
- Test: `tests/test_skill_budget.py`

**Interfaces:**
- Produces: `tests/test_skill_budget.py::test_skill_word_ceilings`

- [ ] **Step 1: Replace the ultraplan bullet.** In `skills/ultraplan/SKILL.md`, replace the bullet beginning `- **Shrink budgets are acceptance criteria.**` (through `it forces net simplification.`) with exactly:

```markdown
- **Shrink budgets are acceptance criteria — stated as deltas.** When a
  task edits a complexity-ratcheted surface (SKILL.md, gate-spec docs),
  state the net word delta its own diff implies (`net delta ≤ +N words`,
  or `≤ −N`) — computable from the task's fenced replacement blocks minus
  the text they replace, and verified at task end as word-count(file
  after) − word-count(file before) over the task's own diff. Never state
  an absolute ceiling: it needs the file's current size plus every
  sibling task's delta, and a plan-authored number is a second, unpinned
  copy that drifts — the absolute lives in `tests/test_skill_budget.py`.
```

Net delta of this edit: ≤ +65 words on `skills/ultraplan/SKILL.md`.

- [ ] **Step 2: Write the failing test.** Create `tests/test_skill_budget.py`:

```python
"""Release-pinned word ceilings for the complexity-ratcheted SKILL.md files
(#248). The ratchet contract: each N is the file's word count at the release
that set it; a release that shrinks the file lowers its N; N is NEVER raised
without the `chore(release)` commit body stating the new N and what pays for
it (this repo's release artifact — there are no separate release notes).
Plans state per-task shrink budgets as DELTAS (see ultraplan SKILL.md
"Shrink budgets"); this pin owns the absolutes."""
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]

# file -> ceiling N (word count == len(text.split()), identical to wc -w)
CEILINGS = {
    "skills/ultrapowers/SKILL.md": 0,  # measured at merge (Step 3)
    "skills/ultraplan/SKILL.md": 0,    # measured at merge (Step 3)
}


def test_skill_word_ceilings():
    for rel, ceiling in CEILINGS.items():
        words = len((ROOT / rel).read_text().split())
        assert words <= ceiling, (
            f"{rel} is {words} words, over its pinned ceiling {ceiling}. "
            "Pay for growth with deletion elsewhere, or (release-only) raise N "
            "in the chore(release) commit body naming what pays for it.")
```

Run: `python3 -m pytest tests/test_skill_budget.py -q` → FAIL (ceilings 0).

- [ ] **Step 3: Measure and set N.** On the final pre-merge rebase: `wc -w skills/ultrapowers/SKILL.md skills/ultraplan/SKILL.md`; set each `CEILINGS` value to the measured count. Run the test → PASS. Sanity: raising either file by one word (`echo x >>`) flips it RED (then `git checkout --` the file).

- [ ] **Step 4: Commit**

```bash
git add skills/ultraplan/SKILL.md tests/test_skill_budget.py
git commit -m "feat(ultraplan): shrink budgets stated as deltas; release-pinned SKILL.md word ceilings (#248)"
```

### Task 2: Suite gate

**Type:** gate
**Depends-on:** 1

`python3 -m pytest` green (adds 1: ≥1170).

## Operator smoke

- do: `python3 -m pytest tests/test_skill_budget.py -q`
- see: 1 passed — both ceilings hold at merge-time counts.
- do: append a word to `skills/ultrapowers/SKILL.md` and rerun the test
- see: RED with the pay-for-growth message; revert the word.
- do: `grep -A3 "stated as deltas" skills/ultraplan/SKILL.md | head -4`
- see: the delta-form instruction (no absolute-ceiling instruction remains).
