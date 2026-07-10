"""The webapp eval fixture stays compilable and layout-conformant."""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "evals/fixtures/webapp"
COMPILER = ROOT / "skills/ultrapowers/scripts/compile_plan.py"


def test_layout():
    assert (FIXTURE / "plan.md").is_file()
    assert (FIXTURE / "project" / "package.json").is_file()


def test_plan_compiles_with_waves():
    out = subprocess.run(
        [sys.executable, str(COMPILER), str(FIXTURE / "plan.md")],
        capture_output=True, text=True)
    assert out.returncode == 0, out.stderr
    result = json.loads(out.stdout)
    assert len(result["waves"]) >= 2          # real dependency structure
    assert any(len(w) >= 2 for w in result["waves"])  # real parallel width
    assert result["acceptance"]["mode"] == "suite"


def test_plan_passes_grammar_check():
    out = subprocess.run(
        [sys.executable, str(COMPILER), "--check", str(FIXTURE / "plan.md")],
        capture_output=True, text=True)
    assert out.returncode == 0, out.stdout + out.stderr
