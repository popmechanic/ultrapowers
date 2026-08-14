"""Pin: SKILL.md's Step 5 (pre-merge gate) must invoke finalize_report.py
BEFORE ultra_gate.py, in that same step. This wiring (Task1<->Task3 from the
#123 docket) was previously unpinned prose only -- an edit could silently drop
the finalize call, or reorder it after the gate, and nothing would catch it.
Text pin on SKILL.md; no subprocess."""
import pathlib
import re

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SKILL = ROOT / "skills/ultrapowers/SKILL.md"

FINALIZE_NEEDLE = "finalize_report.py"
GATE_NEEDLE = "ultra_gate.py"


def _step_5_body(text):
    """Return the SKILL.md text spanning '## Step 5' up to (not including)
    the next top-level '## ' heading."""
    m = re.search(r"^## Step 5 .*$", text, flags=re.MULTILINE)
    assert m, "skills/ultrapowers/SKILL.md has no '## Step 5' heading"
    start = m.end()
    nxt = re.search(r"^## ", text[start:], flags=re.MULTILINE)
    end = start + nxt.start() if nxt else len(text)
    return text[start:end]


def _assert_finalize_precedes_gate(text):
    """Shared presence+ordering assertion body: both the needles must be
    present, and finalize_report.py must appear before ultra_gate.py. Used by
    both the green pin test and the red-check mutations below so the same
    assertion logic is what's proven load-bearing."""
    finalize_idx = text.find(FINALIZE_NEEDLE)
    gate_idx = text.find(GATE_NEEDLE)
    assert finalize_idx != -1, "finalize_report.py invocation not found in Step 5"
    assert gate_idx != -1, "ultra_gate.py invocation not found in Step 5"
    assert finalize_idx < gate_idx, (
        "finalize_report.py must be invoked BEFORE ultra_gate.py in Step 5 -- "
        f"finalize at index {finalize_idx}, gate at index {gate_idx}"
    )


def test_step_5_invokes_finalize_report():
    step5 = _step_5_body(SKILL.read_text())
    assert FINALIZE_NEEDLE in step5, (
        "SKILL.md Step 5 must invoke finalize_report.py before the gate driver"
    )


def test_step_5_invokes_ultra_gate():
    step5 = _step_5_body(SKILL.read_text())
    assert GATE_NEEDLE in step5, (
        "SKILL.md Step 5 must invoke ultra_gate.py"
    )


def test_finalize_report_precedes_ultra_gate_in_step_5():
    step5 = _step_5_body(SKILL.read_text())
    _assert_finalize_precedes_gate(step5)


def test_pin_goes_red_if_finalize_call_is_reordered_after_gate():
    """Sanity-check the pin's own load-bearing-ness: move the finalize
    invocation to after the gate invocation in a text copy and confirm the
    ORDERING assertion is what fires (the presence assert must pass on the
    mutated text -- both needles are still present, just reordered)."""
    step5 = _step_5_body(SKILL.read_text())
    without_finalize = step5.replace(FINALIZE_NEEDLE, "", 1)
    assert FINALIZE_NEEDLE not in without_finalize
    gate_idx = without_finalize.find(GATE_NEEDLE)
    assert gate_idx != -1, "ultra_gate.py invocation not found in Step 5"
    # Re-insert the finalize needle immediately after the gate needle so both
    # needles are present but finalize now comes AFTER gate.
    insert_at = gate_idx + len(GATE_NEEDLE)
    mutated = (
        without_finalize[:insert_at]
        + FINALIZE_NEEDLE
        + without_finalize[insert_at:]
    )
    assert FINALIZE_NEEDLE in mutated
    assert GATE_NEEDLE in mutated
    assert mutated.find(FINALIZE_NEEDLE) > mutated.find(GATE_NEEDLE), (
        "test setup bug: mutation must place finalize AFTER gate"
    )
    with pytest.raises(AssertionError, match="must be invoked BEFORE"):
        _assert_finalize_precedes_gate(mutated)


def test_pin_goes_red_if_finalize_call_is_dropped():
    """Sanity-check the pin's own load-bearing-ness: strip the finalize
    invocation out of a text copy and confirm the PRESENCE assertion fails."""
    step5 = _step_5_body(SKILL.read_text())
    mutated = step5.replace(FINALIZE_NEEDLE, "")
    assert FINALIZE_NEEDLE not in mutated
    with pytest.raises(AssertionError, match="finalize_report.py invocation not found"):
        _assert_finalize_precedes_gate(mutated)
