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


# The execution-fit decision tree, as ordered branch clauses. SHARED_TOKENS above
# pins token PRESENCE, which is not enough: a future edit could set one leg's bar
# to "T≥3" while the other keeps "T≥4" and both files would still contain the
# token "T≥4" somewhere in prose, so the lockstep would stay green over a real
# semantic divergence. These clauses pin the bar, the lane each condition maps to,
# AND the branch order — so a divergent bar, a reassigned lane, or a reordered
# tree fails red. (Intentionally changing the rubric means updating this list too,
# in lockstep with both legs — that is the point.)
BRANCH_CLAUSES = [
    "risk → Ultrapowers",
    "parallel width and T≥4 → Ultrapowers",
    "T≤2 → Inline",
    "else → Subagent-Driven",
]


@pytest.mark.parametrize("clause", BRANCH_CLAUSES)
def test_branch_clause_present_in_both_legs(clause):
    assert clause in HOOK.read_text(), \
        f"hooks/session_start.sh missing decision-tree branch: {clause!r}"
    assert clause in ULTRAPLAN.read_text(), \
        f"skills/ultraplan/SKILL.md missing decision-tree branch: {clause!r}"


def test_branch_clauses_in_canonical_order_in_both_legs():
    # First-match-wins semantics make ORDER load-bearing; pin it in both legs.
    for leg, text in (("hooks/session_start.sh", HOOK.read_text()),
                      ("skills/ultraplan/SKILL.md", ULTRAPLAN.read_text())):
        positions = [text.find(c) for c in BRANCH_CLAUSES]
        assert all(p >= 0 for p in positions), \
            f"{leg}: missing a decision-tree branch (positions {positions})"
        assert positions == sorted(positions), \
            f"{leg}: decision-tree branches are out of canonical order"
