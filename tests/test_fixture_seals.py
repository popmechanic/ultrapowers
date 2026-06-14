"""Every eval fixture plan carries a sealed Acceptance line whose hash matches
the fixture's acceptance suite as committed in the repo."""
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
HASH = ROOT / "skills/ultrapowers/scripts/seal_hash.py"
FIXTURES = ["wide", "chained", "mixed", "degrade"]
LINE = re.compile(r"\*\*Acceptance:\*\* sealed ([0-9a-f]{12}) \(sha256:([0-9a-f]{64})\)")


def test_fixture_plans_carry_matching_seals():
    for name in FIXTURES:
        plan = (ROOT / "evals/fixtures" / name / "plan.md").read_text()
        m = LINE.search(plan)
        assert m, f"{name}/plan.md has no sealed Acceptance line"
        suite = ROOT / "evals/fixtures" / name / "acceptance"
        digest = subprocess.run([sys.executable, str(HASH), str(suite)],
                                capture_output=True, text=True, check=True).stdout.strip()
        assert m.group(2) == digest, f"{name}: recorded hash != recomputed suite hash"
        assert m.group(1) == digest[:12]
