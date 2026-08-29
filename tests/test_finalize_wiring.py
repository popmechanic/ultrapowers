"""Pin: the engine (fleet/run-main.mjs since 0.3.0 — the invoker is code, not
SKILL prose) must invoke finalize_report.py BEFORE ultra_gate.py. This wiring
(Task1<->Task3 from the #123 docket) was previously unpinned -- an edit could
silently drop the finalize call, or reorder it after the gate, and nothing
would catch it. Text pin on the driver source; no subprocess."""
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
ENGINE = ROOT / "fleet/run-main.mjs"

# Match the exec CALL SITES, not prose: both script names appear first in the
# module's header comment, so a bare find() would pin the comment and let the
# real invocations reorder unseen (review finding 4).
FINALIZE_NEEDLE = "join(scripts, 'finalize_report.py')"
GATE_NEEDLE = "join(scripts, 'ultra_gate.py')"


def test_engine_invokes_finalize_report():
    assert FINALIZE_NEEDLE in ENGINE.read_text()


def test_engine_invokes_ultra_gate():
    assert GATE_NEEDLE in ENGINE.read_text()


def test_finalize_report_precedes_ultra_gate_in_engine():
    text = ENGINE.read_text()
    finalize_idx = text.find(FINALIZE_NEEDLE)
    gate_idx = text.find(GATE_NEEDLE)
    assert finalize_idx != -1 and gate_idx != -1
    assert finalize_idx < gate_idx, (
        "finalize_report.py must be invoked BEFORE ultra_gate.py in run-main -- "
        f"finalize at index {finalize_idx}, gate at index {gate_idx}"
    )
