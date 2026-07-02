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


def test_drain_arms_js_gate_with_base():
    # The suite-gate only runs the harness .mjs sims when the drain passes the
    # integration-line base to diff against (issue #79). Pin that it is documented.
    assert "--base" in SKILL


def test_triage_records_rationale_in_notes():
    # #74: triage rationale is durable — recorded in the **Notes:** field, which
    # survives lifecycle transitions, rather than packed into the Score line.
    assert "**Notes:**" in SKILL


def test_triage_does_not_guess_disposition():
    # #74: disposition is decided at planning (sweep step 3), never guessed at triage.
    low = SKILL.lower()
    assert "do not guess" in low and "disposition" in low
    assert "decided at planning" in low
