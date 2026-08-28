"""Pin: SKILL.md's §Engine (the sandbox gate) must invoke finalize_report.py
BEFORE ultra_gate.py, in that same section. This wiring (Task1<->Task3 from the
#123 docket) was previously unpinned prose only -- an edit could silently drop
the finalize call, or reorder it after the gate, and nothing would catch it.
Text pin on SKILL.md; no subprocess."""
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
SKILL = ROOT / "skills/ultrapowers/SKILL.md"

FINALIZE_NEEDLE = "finalize_report.py"
GATE_NEEDLE = "ultra_gate.py"


def _engine_body(text):
    """Return the SKILL.md text spanning '## Engine' up to (not including)
    the next top-level '## ' heading — the sandbox session's gate lives there."""
    m = re.search(r"^## Engine.*$", text, flags=re.MULTILINE)
    assert m, "skills/ultrapowers/SKILL.md has no '## Engine' heading"
    start = m.end()
    nxt = re.search(r"^## ", text[start:], flags=re.MULTILINE)
    end = start + nxt.start() if nxt else len(text)
    return text[start:end]


def _assert_finalize_precedes_gate(text):
    finalize_idx = text.find(FINALIZE_NEEDLE)
    gate_idx = text.find(GATE_NEEDLE)
    assert finalize_idx != -1, "finalize_report.py invocation not found in §Engine"
    assert gate_idx != -1, "ultra_gate.py invocation not found in §Engine"
    assert finalize_idx < gate_idx, (
        "finalize_report.py must be invoked BEFORE ultra_gate.py in §Engine -- "
        f"finalize at index {finalize_idx}, gate at index {gate_idx}"
    )


def test_engine_invokes_finalize_report():
    assert FINALIZE_NEEDLE in _engine_body(SKILL.read_text())


def test_engine_invokes_ultra_gate():
    assert GATE_NEEDLE in _engine_body(SKILL.read_text())


def test_finalize_report_precedes_ultra_gate_in_engine():
    _assert_finalize_precedes_gate(_engine_body(SKILL.read_text()))
