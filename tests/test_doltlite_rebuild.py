"""The stories export rebuilds into a DoltLite history: a branch per story, a commit per step.

doltlite bootstraps by re-execing the interpreter with a replayable
sys.argv[0]; importing it inside the pytest process itself fails (or exits
silently). So this test never imports doltlite directly — it drives the
rebuild CLI and a small verification script, each in its own subprocess.
"""
import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import pytest

if importlib.util.find_spec("doltlite") is None:
    pytest.skip("doltlite is not installed", allow_module_level=True)

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "skills/ultrawrite/stories"))
import steps  # noqa: E402

REBUILD = ROOT / "skills/ultrawrite/stories/doltlite_rebuild.py"

VERIFY_SCRIPT = """\
import doltlite, sqlite3, json, sys

db_path = sys.argv[1]
conn = sqlite3.connect(db_path)
branches = sorted(r[0] for r in conn.execute("SELECT name FROM dolt_branches"))
conn.execute("SELECT dolt_checkout('S2')")
s2_log = [r[0] for r in conn.execute("SELECT message FROM dolt_log")]
got = conn.execute(
    "SELECT value FROM cells WHERE tbl='todos' AND row='0' AND cell='completed'"
).fetchone()
print(json.dumps({"branches": branches, "s2_log": s2_log, "completed": got[0]}))
"""


def test_a_commit_per_step_and_a_branch_per_story(tmp_path):
    rows = [dict(r, plan="p1", signed="2026-09-27")
            for r in steps.load_steps(ROOT / "skills/ultrawrite/catalog/todo/steps.jsonl")]
    steps_path = tmp_path / "steps.jsonl"
    steps.dump_steps(rows, str(steps_path))
    db = tmp_path / "stories.db"

    rebuild_out = subprocess.run(
        [sys.executable, str(REBUILD), str(steps_path), str(db)],
        capture_output=True, text=True, check=True,
    )
    assert rebuild_out.stdout.strip() == "6 commit(s)"

    verify_script = tmp_path / "verify.py"
    verify_script.write_text(VERIFY_SCRIPT, encoding="utf-8")
    verify_out = subprocess.run(
        [sys.executable, str(verify_script), str(db)],
        capture_output=True, text=True, check=True,
    )
    got = json.loads(verify_out.stdout.strip())

    assert {"S1", "S2", "S3", "S4"} <= set(got["branches"])
    assert got["s2_log"][0] == "S2.2 completeTodo plan=p1 signed=2026-09-27"
    assert got["completed"] == "true"
