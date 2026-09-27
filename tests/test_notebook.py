"""The operator notebook: words that worked, words that failed, what lands."""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CLI = ROOT / "skills/ultrawrite/stories/notebook.py"


def run(tmp_path, *args):
    env = {"ULTRAPOWERS_HOME": str(tmp_path), "PATH": "/usr/bin:/bin"}
    return subprocess.run([sys.executable, str(CLI), *args], capture_output=True, text=True, env=env)


def test_show_creates_the_seeded_notebook(tmp_path):
    res = run(tmp_path, "show")
    assert res.returncode == 0
    text = (tmp_path / "notebook.md").read_text(encoding="utf-8")
    assert text == res.stdout
    for heading in ("## Words that worked", "## Words that failed", "## Explanations that land",
                    "## The author decides", "## Retired questions", "## Plan readings"):
        assert heading in text
    assert "A concrete before-and-after example lands where abstract words didn't." in text


def test_add_appends_under_its_section(tmp_path):
    run(tmp_path, "show")
    assert run(tmp_path, "add", "failed", "'table' → say 'list'").returncode == 0
    text = (tmp_path / "notebook.md").read_text(encoding="utf-8")
    failed = text.split("## Words that failed")[1].split("## ")[0]
    assert "'table' → say 'list'" in failed


def test_an_unknown_section_is_refused(tmp_path):
    res = run(tmp_path, "add", "misc", "x")
    assert res.returncode == 2 and "section must be one of" in res.stderr


def test_log_records_a_plan_reading(tmp_path):
    run(tmp_path, "log", "p1", "--rounds", "3", "--marks", "5", "--explains", "1", "--edits", "2")
    text = (tmp_path / "notebook.md").read_text(encoding="utf-8")
    assert "p1: rounds 3, marks 5, please-explain 1, stories edited after preview 2" in text
