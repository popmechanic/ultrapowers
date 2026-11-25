import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PARSER = ROOT / "skills/ultrapowers/scripts/plan_parse.py"
RETIRED = "# P\n\n**Grammar:** stories-v1\n**Stack:** tinyapp\n"


def test_the_parser_refuses_a_stories_plan_by_name(tmp_path):
    plan = tmp_path / "plan.md"
    plan.write_text(RETIRED)
    r = subprocess.run([sys.executable, str(PARSER), str(plan)],
                       capture_output=True, text=True)
    assert r.returncode == 2
    assert r.stderr.strip() == (
        "grammar: stories-v1 was retired on 2026-11-25; "
        "write the plan as claims-v1")
    assert "Traceback" not in r.stderr
