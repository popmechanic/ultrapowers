"""Prose contract: the docket drain documents all three acceptance dispositions
and the committed-suite gate invocation, so the suite path cannot silently
regress out of the skill.
"""
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
SKILL = (ROOT / "skills/ultradocket/SKILL.md").read_text()


def test_drain_documents_suite_gate_invocation():
    assert "--suite-gate" in SKILL


def test_drain_dispatches_on_all_three_dispositions():
    low = SKILL.lower()
    assert "sealed" in low and "suite" in low and "waived" in low


def test_waived_is_parked_not_auto_merged():
    low = SKILL.lower()
    # waived work is never auto-merged unverified — it parks for the operator.
    assert "waived" in low and "park" in low
