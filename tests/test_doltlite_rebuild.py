"""The stories export rebuilds into a DoltLite history: a branch per story, a commit per step."""
import sys
from pathlib import Path

import pytest

doltlite = pytest.importorskip("doltlite")
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "skills/ultrawrite/stories"))
import doltlite_rebuild as dr  # noqa: E402
import steps  # noqa: E402


def test_a_commit_per_step_and_a_branch_per_story(tmp_path):
    rows = [dict(r, plan="p1", signed="2026-09-27")
            for r in steps.load_steps(ROOT / "skills/ultrawrite/catalog/todo/steps.jsonl")]
    db = tmp_path / "stories.db"
    assert dr.rebuild(rows, str(db)) == 6
    conn = doltlite.connect(str(db))
    branches = {r[0] for r in conn.execute("SELECT name FROM dolt_branches")}
    assert {"S1", "S2", "S3", "S4"} <= branches
    conn.execute("SELECT dolt_checkout('S2')")
    msgs = [r[0] for r in conn.execute("SELECT message FROM dolt_log")]
    assert msgs[0] == "S2.2 completeTodo plan=p1 signed=2026-09-27"
    got = conn.execute("SELECT value FROM cells WHERE tbl='todos' AND row='0' AND cell='completed'").fetchone()
    assert got[0] == "true"
