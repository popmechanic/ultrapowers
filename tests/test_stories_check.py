"""plan_check.py on a stories-v1 plan: the signed store and the listed tools."""
import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CHECK = ROOT / "skills/ultrapowers/scripts/plan_check.py"
FIXTURE = ROOT / "evals/fixtures/stories/todo"


def compiled(tmp_path):
    app = tmp_path / "app"
    shutil.copytree(FIXTURE, app)
    return app, app / ".ultrapowers/plan.md"


def check(plan):
    return subprocess.run([sys.executable, str(CHECK), str(plan)], capture_output=True, text=True)


def test_a_freshly_compiled_plan_is_ok(tmp_path):
    _, plan = compiled(tmp_path)
    res = check(plan)
    assert res.returncode == 0, res.stdout
    assert res.stdout.strip() == "PLAN OK"


def test_the_store_edited_after_signing_is_refused(tmp_path):  # Review Focus 3
    app, plan = compiled(tmp_path)
    (app / "client/src/store.js").write_text("// edited\n", encoding="utf-8")
    res = check(plan)
    assert res.returncode == 2
    assert "stories: store module client/src/store.js changed since it was signed" in res.stdout




def test_a_probe_naming_an_unlisted_tool_is_refused(tmp_path):
    _, plan = compiled(tmp_path)
    t = plan.read_text(encoding="utf-8").replace("- `addTodo` —", "- `createTodo` —")
    plan.write_text(t, encoding="utf-8")
    res = check(plan)
    assert res.returncode == 2
    assert "task 1 probe S2.2: names tool addTodo, which no task's Actions list" in res.stdout
