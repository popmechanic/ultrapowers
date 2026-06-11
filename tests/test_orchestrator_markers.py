"""The orchestrator SKILL.md must route the marker contract through its three
human-facing steps: classify at Step 2, approve dispositions at Step 3, render
the post-merge runbook at Step 5."""
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
ORCHESTRATOR = ROOT / "skills/ultrapowers/SKILL.md"


def test_orchestrator_wires_the_contract_through_its_gates():
    text = ORCHESTRATOR.read_text()
    assert "references/plan-markers.md" in text
    assert "Classify first" in text
    assert "post-merge runbook" in text
    assert "dispositions" in text.lower()   # Step 3 approves the interpretation
