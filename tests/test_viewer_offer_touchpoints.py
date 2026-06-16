"""Wiring guard: the orchestrator-facing docs must offer the viewer at launch and
the gate via serve_viewer.py, and render_viewer.py must point manual users at it.
"""
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
SKILL = ROOT / "skills/ultrapowers/SKILL.md"
REPORT_FMT = ROOT / "skills/ultrapowers/references/report-format.md"
SCRIPTS = ROOT / "skills/ultrapowers/scripts"
PLAN = ROOT / "tests/fixtures/marked-plan.md"


def test_skill_offers_viewer_at_launch_and_gate():
    text = SKILL.read_text()
    # launch offer (Step 4, live progress) + gate offer (Step 5, audit drawer)
    assert text.count("serve_viewer.py") >= 2, "expected a serve_viewer offer at both launch and gate"
    assert "--watch" in text, "launch offer should use the live-progress --watch mode"
    assert "--transcripts" in text, "gate offer should use the audit-drawer --transcripts mode"


def test_report_format_mentions_transcript_offer():
    assert "serve_viewer.py" in REPORT_FMT.read_text(), "report presentation order must include the transcript-read offer"


def test_render_viewer_prints_serve_viewer_pointer(tmp_path):
    out = subprocess.run(
        [sys.executable, str(SCRIPTS / "render_viewer.py"), str(PLAN), "--out", str(tmp_path)],
        check=True, capture_output=True, text=True)
    assert "serve_viewer.py" in out.stdout, "render_viewer should point at the one-command helper"
