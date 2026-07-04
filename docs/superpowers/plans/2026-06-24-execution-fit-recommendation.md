# Execution-Fit Recommendation Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the reflex "Ultrapowers is recommended for marked plans" at the execution handoff with a grounded fit-analysis that tags the single best-fit of the three executors.

**Architecture:** The handoff guidance lives in two lockstep legs — `hooks/session_start.sh` (the reliable, every-session leg) and `skills/ultraplan/SKILL.md` (the detailed leg). Both currently hardcode Ultrapowers. We rewrite ultraplan with the full rubric, the hook with a compact form of the same decision tree, and add a lockstep pin test so the two legs cannot drift. No engine/runtime code changes — this is prompt + test work, verified by committed pins.

**Tech Stack:** Bash (hook), Markdown (skill), Python + pytest (tests).

## Global Constraints

- The bar in the rubric is **T≥4** ("Lean efficient"); the **risk override** is always on. Both legs state the same four-branch tree: `risk → Ultrapowers`; `parallel width and T≥4 → Ultrapowers`; `T≤2 → Inline`; `else → Subagent-Driven`.
- Both legs must carry these tokens verbatim: `Ultrapowers`, `Subagent-Driven`, `Inline`, `parallel width`, `risk override`, `T≥4`.
- The hook must preserve every currently-pinned phrase: `/ultrapowers <plan-path>`, `subagent-driven-development`, `executing-plans`, `authorizes execution`, `no approval pause`. Its emitted output must still start with `<ultrapowers-routing>` and end with `</ultrapowers-routing>`.
- `skills/ultraplan/SKILL.md` must preserve every currently-pinned phrase: `REQUIRED SUB-SKILL`, `ultrapowers:ultrapowers`, `Execution Handoff`, `authorizes execution`, `without a further approval pause`. It must keep passing `skills/ultrapowers/scripts/validate_skill.py` (no new `references/...` or `scripts/...` mentions).
- All three options stay listed at the handoff, parallel-first (Ultrapowers on line 1) regardless of which option won; only the `(recommended)` tag and a one-line analysis move.
- The neither-reflex requirement: the old unconditional string `(recommended for marked plans)` must be **absent** from both legs after the change.

**Acceptance:** suite — building ultrapowers itself (its own skill + hook + tests); author and operator read every diff, and the committed pin tests + the lockstep guard are the verification. No held-out exam applies.

---

### Task 1: Rewrite the ultraplan handoff as a fit-analysis

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultraplan/SKILL.md`
- Test: `tests/test_ultraplan_skill.py`

Files-note — `skills/ultraplan/SKILL.md` (replace the `## Execution Handoff (third option)` section)
Files-note — `tests/test_ultraplan_skill.py` (add one test)

**Interfaces:**
- Consumes: none
- Produces: the detailed-leg rubric in `skills/ultraplan/SKILL.md` carrying the canonical tokens `Ultrapowers`, `Subagent-Driven`, `Inline`, `parallel width`, `risk override`, `T≥4` (a sibling task pins that the hook shares these exact tokens; author them verbatim here).

- [ ] **Step 1: Write the failing test**

Add to the end of `tests/test_ultraplan_skill.py` (the module already defines `ULTRAPLAN = ROOT / "skills/ultraplan/SKILL.md"`):

```python
def test_ultraplan_handoff_analyzes_before_recommending():
    text = ULTRAPLAN.read_text()
    # The reflex crown is gone: no unconditional "recommended for marked plans".
    assert "(recommended for marked plans)" not in text
    # The handoff now runs a fit analysis grounded in the rubric.
    assert "parallel width" in text
    assert "risk override" in text
    assert "T≥4" in text
    # All three lanes are named as recommendable outcomes.
    for lane in ("Ultrapowers", "Subagent-Driven", "Inline"):
        assert lane in text
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python3 -m pytest tests/test_ultraplan_skill.py::test_ultraplan_handoff_analyzes_before_recommending -v`
Expected: FAIL — the current section still contains `(recommended for marked plans)` and lacks `parallel width` / `risk override` / `T≥4`.

- [ ] **Step 3: Replace the Execution Handoff section**

In `skills/ultraplan/SKILL.md`, find this exact block:

~~~markdown
## Execution Handoff (third option)

writing-plans ends by offering two execution options. On a marked plan, offer
three — parallel first:

1. **Ultrapowers (recommended for marked plans)** — `/ultrapowers <plan-path>`:
   parallel waves, worktree isolation, per-task review, one pre-merge human gate.
   Selecting this option authorizes execution: ultrapowers renders its wave plan
   for transparency and launches immediately, without a further approval pause.
2. **Subagent-Driven** — superpowers:subagent-driven-development, sequential,
   review between tasks.
3. **Inline** — superpowers:executing-plans, continuous inline execution (upstream removed batch checkpoints in superpowers 5.0.0; its own handoff text still says otherwise — trust the behavior, not the menu).
~~~

Replace it with:

~~~markdown
## Execution Handoff (analyze, then recommend)

writing-plans ends by offering two execution options. On a marked plan, offer
three — parallel first — but do **not** default to Ultrapowers. First run the
execution-fit analysis below, then tag the single best-fit option as
**(recommended)**. The plugin is named Ultrapowers, but the recommendation is
earned per plan, not granted by reflex — recommending Subagent-Driven or Inline
when the plan does not benefit from parallel waves is the correct, honest
outcome.

### The fit analysis

Read three signals off the marked plan you just authored:

- **T** — the number of `implementation` tasks (`gate` / `release` / `manual`
  tasks do not run in waves and are not counted).
- **parallel width** — yes/no: is there at least one wave with ≥2 independent
  tasks, *after* treating same-file `Modify` pairs as dependencies (this is how
  the compiler nets out file contention, so two tasks colliding on a shared file
  are not width)? Compute it by hand from the `**Depends-on:**` graph plus the
  `**Files:**` blocks.
- **risk** — true if Acceptance is `sealed` (the operator cannot read the diff),
  or the work touches a high-stakes surface (auth, payments, migrations, data
  integrity, public API), or behavior is hard to verify by reading.

Decide with the first branch that matches:

1. **risk → Ultrapowers** — the **risk override**. Independent per-task review,
   the held-out sealed exam, and one pre-merge gate are the value here, not
   speed. Name the specific risk in the rationale.
2. **parallel width and T≥4 → Ultrapowers** — real parallel speedup clears the
   worktree/merge overhead.
3. **T≤2 → Inline** — too small to spin up machinery.
4. **else → Subagent-Driven** — linear chains, or narrow plans where parallel
   benefit does not pay; fresh-context isolation + review between tasks still
   earns its keep.

The bar in branch 2 is deliberately conservative: because the risk override
already carries every quality-critical plan, T≥4 only ever trades away marginal
parallelism on small low-risk plans, never verification. T is a proxy for
effort, so a handful of heavy fully-independent tasks may route to Subagent-Driven
— slower than ideal but still reviewed; accept it rather than lowering the bar.

### Render

Show a one-line analysis citing the signals, then the three options with
**(recommended)** on the analyzed winner. Ultrapowers stays listed first for
discoverability regardless of which option won:

1. **Ultrapowers** — `/ultrapowers <plan-path>`: parallel waves, worktree
   isolation, per-task review, one pre-merge human gate. Selecting this option
   authorizes execution: ultrapowers renders its wave plan for transparency and
   launches immediately, without a further approval pause.
2. **Subagent-Driven** — superpowers:subagent-driven-development, sequential,
   review between tasks.
3. **Inline** — superpowers:executing-plans, continuous inline execution (upstream removed batch checkpoints in superpowers 5.0.0; its own handoff text still says otherwise — trust the behavior, not the menu).

Example analysis lines:

- `6 implementation tasks, widest wave 3, low risk → Ultrapowers (recommended).`
- `4 tasks, linear chain, touches auth → Ultrapowers (recommended; risk: auth).`
- `4 tasks in a linear chain, low risk → Subagent-Driven (recommended).`
- `2 trivial tasks → Inline (recommended).`
~~~

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m pytest tests/test_ultraplan_skill.py tests/test_validate_skill.py::test_ultraplan_skill_validates -v`
Expected: PASS — the new test passes, and the existing pins (`test_ultraplan_overrides_the_execution_header_and_handoff`, the contract-mirror test, and skill validation) stay green because `authorizes execution`, `without a further approval pause`, `Execution Handoff`, `ultrapowers:ultrapowers`, and `REQUIRED SUB-SKILL` are all preserved.

- [ ] **Step 5: Commit**

```bash
git add skills/ultraplan/SKILL.md tests/test_ultraplan_skill.py
git commit -m "feat(ultraplan): analyze fit, then recommend at the handoff"
```

---

### Task 2: Rewrite the session-hook routing rule as a compact fit-analysis

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `hooks/session_start.sh`
- Test: `tests/test_session_hook.py`

Files-note — `hooks/session_start.sh` (rule 2 inside the `<ultrapowers-routing>` heredoc)
Files-note — `tests/test_session_hook.py` (add one test)

**Interfaces:**
- Consumes: none
- Produces: the reliable-leg compact rubric in `hooks/session_start.sh` carrying the canonical tokens `Ultrapowers`, `Subagent-Driven`, `Inline`, `parallel width`, `risk override`, `T≥4` (a sibling task pins that ultraplan SKILL.md shares these exact tokens; author them verbatim here).

- [ ] **Step 1: Write the failing test**

Add to the end of `tests/test_session_hook.py` (the module already imports `subprocess`, `pathlib`, and defines `ROOT`):

```python
def test_session_start_recommends_by_analysis_not_reflex():
    p = subprocess.run(["bash", str(ROOT / "hooks/session_start.sh")],
                       capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    out = p.stdout
    low = out.lower()
    # The reflex crown is gone — the hook instructs an analysis and forbids
    # defaulting to ultrapowers.
    assert "do not default to ultrapowers" in low
    assert "parallel width" in out
    assert "t≥4" in low
    assert "risk override" in out
    # The old unconditional tag is absent.
    assert "(recommended for marked plans)" not in out
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python3 -m pytest tests/test_session_hook.py::test_session_start_recommends_by_analysis_not_reflex -v`
Expected: FAIL — the current rule 2 still says `(recommended for marked plans)` and contains none of `do NOT default to ultrapowers`, `parallel width`, `T≥4`, `risk override`.

- [ ] **Step 3: Replace rule 2 inside the heredoc**

In `hooks/session_start.sh`, find this exact block (it sits inside the `cat <<'EOF' ... EOF` heredoc):

~~~text
2. At a marked plan's execution handoff, offer THREE options, parallel first:
   1. /ultrapowers <plan-path> (recommended for marked plans) — parallel
      waves, worktree isolation, per-task review, one pre-merge human gate.
      Selecting this option authorizes execution: begin implementation
      immediately after rendering the wave plan, with no approval pause.
   2. superpowers:subagent-driven-development (sequential).
   3. superpowers:executing-plans (inline).
~~~

Replace it with:

~~~text
2. At a marked plan's execution handoff, do NOT default to ultrapowers. First run
   the execution-fit analysis, then offer THREE options, parallel first, tagging
   the single best-fit option "(recommended)". Read three signals off the marked
   plan: T = number of implementation tasks; parallel width = is there a wave with
   ≥2 independent tasks (after treating same-file edits as dependencies); risk =
   sealed acceptance, a high-stakes surface (auth, payments, migrations, data
   integrity, public API), or hard-to-verify behavior. Decide, first match wins:
   risk → Ultrapowers (the risk override); parallel width and T≥4 → Ultrapowers;
   T≤2 → Inline; else → Subagent-Driven. Show a one-line analysis, then:
   1. Ultrapowers — /ultrapowers <plan-path>: parallel waves, worktree isolation,
      per-task review, one pre-merge human gate. Selecting ultrapowers authorizes
      execution: begin implementation immediately after rendering the wave plan,
      with no approval pause.
   2. Subagent-Driven — superpowers:subagent-driven-development (sequential).
   3. Inline — superpowers:executing-plans (inline).
~~~

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m pytest tests/test_session_hook.py -v`
Expected: PASS — the new test passes, and every existing test stays green: the routing-rule test still finds `/ultrapowers <plan-path>`, `subagent-driven-development`, `executing-plans`, `authorizes execution`, and `no approval pause`; the pollution test still sees output starting with `<ultrapowers-routing>` and ending with `</ultrapowers-routing>`.

- [ ] **Step 5: Commit**

```bash
git add hooks/session_start.sh tests/test_session_hook.py
git commit -m "feat(hook): analyze fit, then recommend; no reflex ultrapowers crown"
```

---

### Task 3: Pin the two legs in lockstep

**Type:** implementation
**Depends-on:** 1, 2

**Files:**
- Create: `tests/test_recommendation_rubric.py`

**Interfaces:**
- Consumes: the shared rubric tokens authored into `hooks/session_start.sh` (Task 2) and `skills/ultraplan/SKILL.md` (Task 1)
- Produces: none

This is a lockstep regression guard, not a TDD cycle — the behavior it protects was implemented in Tasks 1 and 2. Here we add the pin that keeps the reliable leg (the hook) and the detailed leg (ultraplan) from drifting apart: every canonical rubric token must appear in both files.

- [ ] **Step 1: Create the lockstep test**

Create `tests/test_recommendation_rubric.py`:

```python
"""Lockstep guard: the execution-fit rubric must live in BOTH legs — the
session hook (the reliable, every-session leg) and ultraplan SKILL.md (the
detailed leg). Editing one without the other makes the two recommendation
menus drift; this pins the shared vocabulary so they cannot."""
import pathlib
import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
HOOK = ROOT / "hooks/session_start.sh"
ULTRAPLAN = ROOT / "skills/ultraplan/SKILL.md"

# Canonical tokens both legs must carry verbatim: the three lane names, the two
# structural-signal phrasings, the override name, and the bar.
SHARED_TOKENS = [
    "Ultrapowers",
    "Subagent-Driven",
    "Inline",
    "parallel width",
    "risk override",
    "T≥4",
]


@pytest.mark.parametrize("token", SHARED_TOKENS)
def test_rubric_token_present_in_both_legs(token):
    hook = HOOK.read_text()
    ultraplan = ULTRAPLAN.read_text()
    assert token in hook, f"hooks/session_start.sh missing rubric token: {token!r}"
    assert token in ultraplan, f"skills/ultraplan/SKILL.md missing rubric token: {token!r}"


def test_neither_leg_reflex_recommends():
    # The pre-feature reflex crown must be gone from both legs.
    assert "(recommended for marked plans)" not in HOOK.read_text()
    assert "(recommended for marked plans)" not in ULTRAPLAN.read_text()
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `python3 -m pytest tests/test_recommendation_rubric.py -v`
Expected: PASS — all six token cases pass for both files (the tokens were authored in Tasks 1 and 2), and neither leg contains the old reflex tag. (Sanity check that the guard bites: temporarily deleting `T≥4` from either file would turn one parametrized case RED; restore it before continuing.)

- [ ] **Step 3: Commit**

```bash
git add tests/test_recommendation_rubric.py
git commit -m "test(rubric): pin the hook and ultraplan legs in lockstep"
```

---

### Task 4: Full-suite verification gate

**Type:** gate

**Files:**
- None (verification only; writes nothing)

The pre-merge gate runs the full Python suite from the repo root and must be green, with no regressions in the existing drift/skill pins.

Suite command: `python3 -m pytest`

Expected: all tests pass — including the three added/extended this plan (`tests/test_recommendation_rubric.py`, `tests/test_session_hook.py::test_session_start_recommends_by_analysis_not_reflex`, `tests/test_ultraplan_skill.py::test_ultraplan_handoff_analyzes_before_recommending`) and the untouched pins (`tests/test_no_prompt_drift.py`, the rest of `tests/test_ultraplan_skill.py`, the rest of `tests/test_session_hook.py`, `tests/test_validate_skill.py`).
