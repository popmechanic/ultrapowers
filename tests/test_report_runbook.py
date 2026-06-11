"""report-format.md must present the post-merge runbook at the pre-merge gate
and route it into the finishing handoff on approval."""
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
REPORT = ROOT / "skills/ultrapowers/references/report-format.md"


def test_report_presents_the_runbook():
    text = REPORT.read_text()
    assert "Post-merge runbook" in text
    assert "Step-2" in text   # sourced from compile-time dispositions, not the workflow return
    assert "finishing-a-development-branch" in text
