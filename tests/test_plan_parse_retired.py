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


def test_the_probe_runner_refuses_a_stories_plan_by_name(tmp_path):
    plan = tmp_path / "plan.md"
    plan.write_text(RETIRED)
    r = subprocess.run([sys.executable, str(ROOT / "skills/ultrapowers/scripts/run_probes.py"),
                        str(plan)], capture_output=True, text=True)
    assert r.returncode != 0
    assert ("grammar: stories-v1 was retired on 2026-11-25; "
            "write the plan as claims-v1") in r.stdout + r.stderr
    assert "Traceback" not in r.stderr
    assert "cannot read" not in r.stdout + r.stderr


def test_the_routing_reader_refuses_a_stories_plan_by_name(tmp_path):
    plan = tmp_path / "plan.md"
    plan.write_text(RETIRED)
    r = subprocess.run([sys.executable, str(ROOT / "skills/ultrawrite/scripts/routing.py"),
                        str(plan)], capture_output=True, text=True)
    assert r.returncode != 0
    assert ("grammar: stories-v1 was retired on 2026-11-25; "
            "write the plan as claims-v1") in r.stdout + r.stderr
    assert "Traceback" not in r.stderr
