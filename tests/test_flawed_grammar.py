"""The flawed fixture's grammar corpus: each file carries exactly one
violation class and --check must name it (issue #85 field bugs).
"""
import subprocess
import sys
from pathlib import Path

SCRIPT = Path("skills/ultrapowers/scripts/compile_plan.py")
CORPUS = Path("evals/fixtures/flawed/grammar")

EXPECT = {
    "annotated-files.md": "annotation",
    "prose-placeholder.md": "symbol",
    "glob.md": "enumerate",
    "unknown-label.md": "unknown files label",
    "double-catch-all.md": "catch-all",
}


def test_every_corpus_file_fails_check_with_its_named_violation():
    for name, needle in EXPECT.items():
        proc = subprocess.run(
            [sys.executable, str(SCRIPT), "--check", str(CORPUS / name)],
            capture_output=True, text=True)
        out = (proc.stdout + proc.stderr).lower()
        assert proc.returncode == 2, name
        assert needle in out, (name, out)


def test_shipping_fixture_plans_are_canonical():
    for fixture in ("wide", "chained", "mixed", "degrade"):
        plan = Path("evals/fixtures") / fixture / "plan.md"
        proc = subprocess.run(
            [sys.executable, str(SCRIPT), "--check", str(plan)],
            capture_output=True, text=True)
        assert proc.returncode == 0, (fixture, proc.stdout, proc.stderr)
