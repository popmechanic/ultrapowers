"""The orchestrator SKILL.md must route the marker contract through its three
human-facing steps: classify at Step 2, render dispositions at Step 3, render
the post-merge runbook at Step 5."""
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
ORCHESTRATOR = ROOT / "skills/ultrapowers/SKILL.md"


def test_orchestrator_wires_the_contract_through_its_gates():
    text = ORCHESTRATOR.read_text()
    assert "references/plan-markers.md" in text
    assert "Classify first" in text
    assert "post-merge runbook" in text
    assert "dispositions" in text.lower()   # Step 3 renders the interpretation


def test_orchestrator_step3_renders_without_pausing():
    # Feature decision 2026-06-12: selecting ultrapowers at the planning
    # handoff (or invoking /ultrapowers) IS the authorization — Step 3 renders
    # the wave plan for transparency and launches immediately. Guard against
    # the approval pause drifting back in.
    text = ORCHESTRATOR.read_text()
    assert "do not ask for approval" in text
    assert "Get Approval" not in text        # the old Step-3 heading
    step5 = text[text.index("## Step 5"):]
    assert "Approve" in step5                # the pre-merge gate still asks


def test_orchestrator_launches_by_meta_name():
    # The saved-workflow registry resolves by the script's meta.name
    # ('ultrapowers'), NOT the installed filename ('ultrapowers-run.js') —
    # confirmed live 2026-06-10: launching as 'ultrapowers-run' fails.
    text = ORCHESTRATOR.read_text()
    assert "`meta.name`" in text
    assert "not found" in text   # the failure mode is named, not just implied
    workflow = (ROOT / "skills/ultrapowers/workflow.js").read_text()
    assert "name: 'ultrapowers'" in workflow   # the name Step 4b promises


def test_orchestrator_restores_session_checkout_at_step_5():
    # The workflow's setup agent leaves the session checkout on the
    # integration branch; Step 5 must switch back before presenting the
    # report or the work looks prematurely merged at the human gate.
    text = ORCHESTRATOR.read_text()
    assert "restore the session checkout" in text
    assert "git checkout <baseBranch>" in text


def test_orchestrator_wires_the_hardening():
    text = ORCHESTRATOR.read_text()
    assert re.search(r"Tested with superpowers \d+\.\d+\.\d+", text)
    assert "scripts/compile_plan.py" in text       # Step 2 runs the compiler
    assert "ultrapowers-probe" in text             # Step 4 preflight
    assert "edges" in text                          # Step 4b passes structured pairs
    assert "tests.passed" in text                   # Step 5 gates the finishing handoff
    assert "git checkout <integrationBranch>" in text  # finishing verifies the right tree
