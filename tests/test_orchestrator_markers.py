"""The saved-workflow registry resolves by the harness's meta.name — this pins
that the shipped harness literal (not just the skill's prose) matches what
SKILL.md promises."""
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
ORCHESTRATOR = ROOT / "skills/ultrapowers/SKILL.md"


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
