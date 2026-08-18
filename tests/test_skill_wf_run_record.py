"""#159: the /ultrapowers launch and both relaunch lanes record the printed
Workflow Run ID into run-<stamp>/wf-runs.json at launch time (via the
existing ultradocket writer), so un-gated launches are in the approve sweep
set. Containment pin only — two splits, no SKILL.md parser."""
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
SKILL = ROOT / "skills/ultrapowers/SKILL.md"
WRITER = "record_wf_run.py"


def _steps():
    text = SKILL.read_text()
    parts = text.split("\n## Step ")
    return {p.split(" ", 1)[0]: p for p in parts[1:]}   # "4" -> Step 4 text


def test_step4_launch_records_run_id():
    assert WRITER in _steps()["4"]


def test_step5_salvage_and_redirect_record_run_id():
    step5 = _steps()["5"]
    bullets = step5.split("\n- **")
    salvage = [b for b in bullets if b.startswith("Salvage**")]
    redirect = [b for b in bullets if b.startswith("Redirect")]
    assert salvage and WRITER in salvage[0]
    assert redirect and WRITER in redirect[0]


def test_writer_exists_and_is_named_by_plugin_root():
    assert (ROOT / "skills/ultradocket/scripts" / WRITER).is_file()
    assert "${CLAUDE_PLUGIN_ROOT}/skills/ultradocket/scripts/" + WRITER in SKILL.read_text()
