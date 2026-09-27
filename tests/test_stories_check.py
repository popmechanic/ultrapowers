"""plan_check.py on a stories-v1 plan: the plan, the export and the store agree."""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
COMPILE = ROOT / "skills/ultrawrite/stories/compile.py"
CHECK = ROOT / "skills/ultrapowers/scripts/plan_check.py"
TODO = ROOT / "skills/ultrawrite/catalog/todo"


def compiled(tmp_path):
    app = tmp_path / "app"
    out = app / ".ultrapowers/plan.md"
    out.parent.mkdir(parents=True)
    res = subprocess.run([sys.executable, str(COMPILE), str(TODO), "--app", str(app), "--plan-id", "p1",
                          "--date", "2026-09-27", "--out", str(out)], capture_output=True, text=True)
    assert res.returncode == 0, res.stdout + res.stderr
    return app, out


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


def test_a_hand_edited_expect_is_refused(tmp_path):
    _, plan = compiled(tmp_path)
    t = plan.read_text(encoding="utf-8").replace('"eq": true', '"eq": false', 1)
    plan.write_text(t, encoding="utf-8")
    res = check(plan)
    assert res.returncode == 2
    assert "task 1 probe S2.2: expect differs from the recorded step's diff" in res.stdout


def test_a_step_with_no_probe_and_a_story_with_no_steps(tmp_path):
    app, plan = compiled(tmp_path)
    lines = plan.read_text(encoding="utf-8").splitlines()
    i = next(n for n, l in enumerate(lines) if '"clause": "S4.2"' in l)
    del lines[i - 1:i + 2]
    lines.insert(lines.index("- S4: You delete \"buy milk\"; it is gone from the list.") + 1,
                 "- S5: You undo a delete.")
    plan.write_text("\n".join(lines) + "\n", encoding="utf-8")
    res = check(plan)
    assert "story S4 step 2 has no probe" in res.stdout
    assert "story S5 has no recorded steps" in res.stdout


def test_a_probe_naming_an_unlisted_tool_is_refused(tmp_path):
    _, plan = compiled(tmp_path)
    t = plan.read_text(encoding="utf-8").replace("- `addTodo` —", "- `createTodo` —")
    plan.write_text(t, encoding="utf-8")
    res = check(plan)
    assert res.returncode == 2
    assert "task 1 probe S2.2: names tool addTodo, which no task's Actions list" in res.stdout


def test_an_older_story_without_a_guard_is_refused(tmp_path):
    app, plan = compiled(tmp_path)
    export = app / "stories/steps.jsonl"
    rows = [json.loads(l) for l in export.read_text(encoding="utf-8").splitlines()]
    extra = dict(rows[0], story="p0/S1", plan="p0")
    export.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows + [extra]) + "\n",
                      encoding="utf-8")
    res = check(plan)
    assert "guard missing: p0/S1.1 is an earlier signed story step with no guard probe" in res.stdout
