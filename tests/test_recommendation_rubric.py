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
