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
    # ('ultrapowers-run'), NOT the installed filename ('waves.js') — launching
    # as 'waves' fails with "not found". The workflow is named 'ultrapowers-run'
    # (not 'ultrapowers') so the engine's auto-registered /<meta.name> command
    # cannot shadow the /ultrapowers skill — see
    # docs/bugs/2026-06-15-ultrapowers-command-collision.md.
    text = ORCHESTRATOR.read_text()
    assert "`meta.name`" in text
    assert "not found" in text   # the failure mode is named, not just implied
    workflow = (ROOT / "skills/ultrapowers/harnesses/waves.js").read_text()
    assert "name: 'ultrapowers-run'" in workflow   # the name Step 4b promises


def test_preflight_distinguishes_not_found_from_engine_drift():
    # Regression for the fresh-checkout "Workflow 'ultrapowers-probe' not found"
    # failure: a not-found probe means the registry snapshot predates the
    # install (cured by a NEW session), NOT engine drift. The skill must name
    # the restart cure and must NOT route this case to the sequential fallback,
    # or the parallel path silently dies on every first run.
    text = ORCHESTRATOR.read_text()
    preflight = text[text.index("**4a½"):text.index("**4b")]
    assert "not found" in preflight.lower()
    assert "session" in preflight.lower()          # the restart cure is named
    assert "session start" in preflight.lower()    # registry-snapshot timing explained
    # The hook is the load-bearing install, documented in Step 4a.
    assert "SessionStart hook" in text


def test_orchestrator_restores_session_checkout_at_step_5():
    # The workflow's setup agent leaves the session checkout on the
    # integration branch; Step 5 must switch back before presenting the
    # report or the work looks prematurely merged at the human gate.
    text = ORCHESTRATOR.read_text()
    assert "restore the session checkout" in text
    assert "git checkout <baseBranch>" in text


def test_orchestrator_wires_the_hardening():
    text = ORCHESTRATOR.read_text()
    assert (re.search(r"Tested with superpowers \d+\.\d+\.\d+", text) or
            re.search(r"vendored Superpowers v6 snapshot \(dev \w+\)", text))
    assert "scripts/compile_plan.py" in text       # Step 2 runs the compiler
    assert "ultrapowers-probe" in text             # Step 4 preflight
    assert "edges" in text                          # Step 4b passes structured pairs
    assert "tests.passed" in text                   # Step 5 gates the finishing handoff
    assert "git checkout <integrationBranch>" in text  # finishing verifies the right tree


def test_step3_render_documents_zero_marker_flag():
    # The all-heuristic surface ("0 markers — all dispositions inferred") must be
    # documented for the operator. THIS task owns skills/ultraplan/SKILL.md (the
    # authoring skill), where the flag is described; the orchestrator Step-3
    # render lives in skills/ultrapowers/SKILL.md — a SIBLING-owned file this
    # task must not modify. Accept the flag documented in either surface so the
    # pin is green in isolation and remains green after integration.
    texts = [(ROOT / "skills/ultraplan/SKILL.md").read_text()]
    orchestrator = ROOT / "skills/ultrapowers/SKILL.md"
    if orchestrator.exists():
        texts.append(orchestrator.read_text())
    assert any("all dispositions inferred" in t or "0 markers" in t for t in texts)
