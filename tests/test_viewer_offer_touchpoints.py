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


def test_skill_offers_one_live_readable_viewer():
    text = SKILL.read_text()
    assert "serve_viewer.py" in text, "the live viewer must be offered"
    # ONE launch command now streams transcripts during the run: both flags together
    assert "--transcripts" in text and "--watch" in text, "live viewer uses both --transcripts and --watch"
    import re
    # the launch offer threads --transcripts and --watch into a single serve_viewer invocation
    assert re.search(r"serve_viewer\.py[^\n]*--transcripts[^\n]*--watch", text), \
        "launch offer must combine --transcripts and --watch in one command"
    assert text.count("serve_viewer.py") >= 2, "still expect the offer + its --stop teardown line"


def test_report_format_mentions_transcript_offer():
    assert "serve_viewer.py" in REPORT_FMT.read_text(), "report presentation order must include the transcript-read offer"


def test_render_viewer_prints_serve_viewer_pointer(tmp_path):
    out = subprocess.run(
        [sys.executable, str(SCRIPTS / "render_viewer.py"), str(PLAN), "--out", str(tmp_path)],
        check=True, capture_output=True, text=True)
    assert "serve_viewer.py" in out.stdout, "render_viewer should point at the one-command helper"
