"""Compiling a signed bundle into a stories-v1 plan."""
import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "skills/ultrawrite/stories"))
import bundle  # noqa: E402
import compile as comp  # noqa: E402
import steps  # noqa: E402

TODO = ROOT / "skills/ultrawrite/catalog/todo"
CLI = ROOT / "skills/ultrawrite/stories/compile.py"


def probes_in(text):
    out, lines = [], text.splitlines()
    for i, line in enumerate(lines):
        if line.strip() == "```probe":
            out.append(json.loads(lines[i + 1]))
    return out


def test_compile_the_catalog_todo():
    text = comp.compile_plan(bundle.load_bundle(TODO), "p1", [])
    assert "**Grammar:** stories-v1" in text and "**Plan-id:** p1" in text
    assert "### Task 1: The todo piece" in text
    ps = probes_in(text)
    assert [p["clause"] for p in ps] == ["S1.1", "S2.1", "S2.2", "S3.1", "S4.1", "S4.2"]
    s22 = ps[2]
    assert s22["given"] == [{"tool": "addTodo", "args": {"text": "buy milk"}}]
    assert s22["do"] == [{"click": {"name": "buy milk", "role": "checkbox"}}]
    assert s22["expect"] == [{"table": "todos", "row": "0", "cell": "completed", "eq": True}]
    s31 = ps[3]
    assert s31["expect"] == [{"unchanged": True}] and s31["holds_before"] is True


def test_quotes_and_unicode_survive_the_fence(tmp_path):  # Review Focus 2
    d = tmp_path / "b"; shutil.copytree(TODO, d)
    t = (d / "steps.jsonl").read_text(encoding="utf-8").replace("buy milk", 'Buy \\"milk\\" ☕')
    (d / "steps.jsonl").write_text(t, encoding="utf-8")
    ps = probes_in(comp.compile_plan(bundle.load_bundle(d), "p1", []))
    assert ps[0]["expect"] == [{"table": "todos", "row": "0", "cell": "text", "eq": 'Buy "milk" ☕'}]


def run_cli(bundle_dir, app, plan_id):
    out = app / ".ultrapowers" / "plan.md"
    out.parent.mkdir(parents=True, exist_ok=True)
    return subprocess.run([sys.executable, str(CLI), str(bundle_dir), "--app", str(app),
                           "--plan-id", plan_id, "--date", "2026-09-27", "--out", str(out)],
                          capture_output=True, text=True), out


def test_cli_writes_plan_export_and_store(tmp_path):
    app = tmp_path / "app"; app.mkdir()
    res, out = run_cli(TODO, app, "p1")
    assert res.returncode == 0, res.stdout + res.stderr
    assert "COMPILED p1: 1 task(s), 6 probe(s), 0 guard(s)" in res.stdout
    rows = steps.load_steps(app / "stories/steps.jsonl")
    assert {r["story"] for r in rows} == {"p1/S1", "p1/S2", "p1/S3", "p1/S4"}
    assert all(r["plan"] == "p1" and r["signed"] == "2026-09-27" for r in rows)
    assert rows[0]["sentence"].startswith("You ")
    assert (app / "client/src/store.js").read_bytes() == (TODO / "store.js").read_bytes()


def test_a_second_plan_turns_the_first_into_guards(tmp_path):
    app = tmp_path / "app"; app.mkdir()
    run_cli(TODO, app, "p1")
    res, out = run_cli(TODO, app, "p2")
    assert res.returncode == 0
    assert "6 guard(s)" in res.stdout
    text = out.read_text(encoding="utf-8")
    assert "## Guards" in text and '"clause": "G:p1/S2.2"' in text
    stories = {r["story"] for r in steps.load_steps(app / "stories/steps.jsonl")}
    assert {"p1/S1", "p2/S1"} <= stories


def test_cli_refuses_a_bad_bundle(tmp_path):
    d = tmp_path / "b"; shutil.copytree(TODO, d)
    page = json.loads((d / "page.json").read_text()); page["stories"] = []
    (d / "page.json").write_text(json.dumps(page))
    res, _ = run_cli(d, tmp_path / "app", "p1")
    assert res.returncode == 2
    assert "page: a behaviour plan needs at least one story" in res.stdout
