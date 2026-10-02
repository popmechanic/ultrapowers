"""Jev's screen arranger (skills/ultrawrite/stories/arrange.ts) on a bundle beyond the todo
example (#1524): row controls carry their typed args, row text is templated from the row,
and every card action and seen control gets one. A fake evaluator stands in for Jev, so no
test reaches the network. Needs bun and an offline-installable app."""
import hashlib
import json
import os
import shutil
import subprocess

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STORIES = os.path.join(ROOT, "skills/ultrawrite/stories")
ARRANGE = os.path.join(STORIES, "arrange.ts")
TAGS = os.path.join(ROOT, "skills/ultrawrite/catalog/todo-tags")
TODO = os.path.join(ROOT, "skills/ultrawrite/catalog/todo")
SHOPPING = os.path.join(ROOT, "evals/fixtures/tinyapp-shopping")

PRELUDE = r"""
import {arrange} from %s;
const fake = async ({questions}) => { const answers = {}; for (const [k, q] of Object.entries(questions)) { const keys = Object.keys(q.criteria); let c = keys[0]; if (k.startsWith("select_")) c = keys.find((x) => x.startsWith("use:")) ?? (keys.includes("1") ? "1" : keys[0]); else if (k.startsWith("parent_")) c = keys.find((x) => x.startsWith("node_0")) ?? keys[0]; answers[k] = {choice: c, confidence: 0.9}; } return {answers}; };
const isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const canon = (v) => JSON.stringify(v, (_k, x) => (isObj(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));
const below = (s, id, pred) => (s.elements[id]?.children ?? []).some((c) => pred(s.elements[c]) || below(s, c, pred));
const inRepeat = (s, table, pred) => Object.keys(s.elements).some((id) => s.elements[id].repeat?.statePath === "/tables/" + table && below(s, id, pred));
""" % json.dumps(ARRANGE)


def _app(tmp_path_factory, bundle, name):
    dst = str(tmp_path_factory.mktemp(name) / "app")
    subprocess.run(["bun", os.path.join(STORIES, "scaffold.ts"), bundle, dst],
                   check=True, capture_output=True, text=True)
    r = subprocess.run(["bun", "install", "--offline"], cwd=dst, capture_output=True, text=True, timeout=300)
    if r.returncode:
        pytest.skip("bun install --offline failed: " + r.stderr.strip()[-200:])
    return dst


@pytest.fixture(scope="module")
def bun():
    if not shutil.which("bun"):
        pytest.skip("bun is not installed")


@pytest.fixture(scope="module")
def app(bun, tmp_path_factory):
    return _app(tmp_path_factory, TAGS, "arrange")


def run_js(body, **values):
    """Run PRELUDE + body under bun, with each value bound as a const; parse the JSON it prints."""
    consts = "".join("const %s = %s;\n" % (k, json.dumps(v)) for k, v in values.items())
    r = subprocess.run(["bun", "-e", PRELUDE + consts + body], cwd=ROOT, capture_output=True, text=True, timeout=300)
    assert r.returncode == 0, r.stderr[-2000:]
    return json.loads(r.stdout.strip().splitlines()[-1])


@pytest.fixture(scope="module")
def tagged(app):
    """Every version of each todo-tags piece, arranged by the fake evaluator."""
    return run_js("const r = await arrange({bundle, app, evaluate: fake}); console.log(JSON.stringify(r));",
                  bundle=TAGS, app=app)


def check_versions(app, piece, pred):
    """[version, does the predicate hold] for each version of a piece."""
    return run_js(
        "const r = await arrange({bundle, app, piece, evaluate: fake});\n"
        "console.log(JSON.stringify(Object.entries(r.versions[piece] ?? {}).map(([v, s]) => [v, (%s)(s)])));" % pred,
        bundle=TAGS, app=app, piece=piece)


def test_tag_row_button_carries_the_typed_name(app):
    got = check_versions(app, "tag", """(s) =>
      inRepeat(s, "todos", (e) => e.type === "ActionButton" && e.props.action === "addTag"
        && canon(e.props.args) === canon({todoId: {$item: "id"}, name: {$state: "/draft/name"}})
        && canon(e.props.label) === canon({$template: "Add tag to ${text}"}))
      && inRepeat(s, "todos", (e) => e.type === "DraftInput" && canon(e.props.label) === canon({$template: "Tag for ${text}"})
        && canon(e.props.value) === canon({$bindState: "/draft/name"}))""")
    assert got and all(ok for _, ok in got), "no Add-tag button with name in its args: %s" % got


def test_todo_versions_draw_the_complete_checkbox(app):
    got = check_versions(app, "todo", """(s) =>
      inRepeat(s, "todos", (e) => e.type === "ActionCheckbox" && e.props.action === "completeTodo"
        && canon(e.props.label) === canon({$item: "text"}) && canon(e.props.checked) === canon({$item: "completed"})
        && canon(e.props.args) === canon({id: {$item: "id"}}))""")
    assert got and all(ok for _, ok in got), "no completeTodo checkbox: %s" % got


def test_no_fixed_row_text(tagged):
    fixed = []
    for piece, versions in tagged["versions"].items():
        for v, s in versions.items():
            for id_, e in s["elements"].items():
                if e["props"].get("action") == "removeTag":
                    continue
                for key in ("label", "name"):
                    x = e["props"].get(key)
                    text = x.get("$template") if isinstance(x, dict) else x
                    if isinstance(text, str) and "buy milk" in text:
                        fixed.append("%s %s %s: %s" % (piece, v, id_, text))
    assert not fixed, fixed


def test_versions_pass_screens_and_stories(app, tagged):
    for p in ("todo", "tag"):
        with open(os.path.join(app, "client/src/pieces/%s.json" % p), "w") as f:
            json.dump(tagged["versions"][p]["A"], f, indent=2)
    r = subprocess.run(["bun", os.path.join(ROOT, "factory/stack/tinyapp/screens.ts"), "--bundle", TAGS, "--copy", app],
                       capture_output=True, text=True, timeout=120)
    assert (r.returncode, r.stdout.splitlines()[-1:]) == (0, ["SCREENS ok: todo, tag"]), r.stdout
    plan = os.path.join(app, ".ultrapowers/plan.md")
    os.makedirs(os.path.dirname(plan), exist_ok=True)
    subprocess.run(["bun", os.path.join(STORIES, "compile.ts"), TAGS, "--app", app, "--plan-id", "p1",
                    "--date", "2026-10-01", "--out", plan], check=True, capture_output=True, text=True, timeout=120)
    for clause in ("S1.1", "S2.2"):
        r = subprocess.run(["bun", os.path.join(ROOT, "factory/stack/tinyapp/check.ts"), "--plan", plan,
                            "--clause", clause, "--copy", app], capture_output=True, text=True, timeout=300)
        if r.returncode == 2:
            pytest.skip("check.ts could not run: " + (r.stdout + r.stderr).strip()[-300:])
        assert r.returncode == 0, "%s: %s" % (clause, (r.stdout + r.stderr)[-2000:])


def test_an_unseen_unnamed_action_still_gets_a_control(app, tmp_path):
    b = str(tmp_path / "b")
    shutil.copytree(TAGS, b)
    with open(os.path.join(b, "page.json")) as f:
        page = json.load(f)
    del page["stories"][0]["steps"][0]["see"]
    with open(os.path.join(b, "page.json"), "w") as f:
        json.dump(page, f)
    got = run_js(
        "const r = await arrange({bundle, app, piece: 'todo', evaluate: fake});\n"
        "console.log(JSON.stringify(Object.entries(r.versions.todo ?? {}).map(([v, s]) => "
        "[v, Object.values(s.elements).filter((e) => e.props.action === 'completeTodo').map((e) => [e.type, e.props.label])])));",
        bundle=b, app=app)
    assert got and all(controls == [["ActionButton", "Mark this todo as done."]] for _, controls in got), "got %s" % got


@pytest.mark.parametrize("bundle,want", [
    (TODO, "040d8fe268559fbe272c8b724065ca1b626678589b3bb97679000a9c29a2319a"),
    (SHOPPING, "6895c5754ea6fcfbf31c29b560351308e5afad4b564f46c07c89e380dbfdaab7"),
])
def test_todo_and_shopping_output_unchanged(bun, tmp_path_factory, bundle, want):
    a = _app(tmp_path_factory, bundle, "guard")
    r = run_js("const r = await arrange({bundle, app, evaluate: fake}); console.log(JSON.stringify({versions: JSON.stringify(r.versions), dropped: r.dropped}));",
               bundle=bundle, app=a)
    assert r["dropped"] == {}
    assert hashlib.sha256(r["versions"].encode()).hexdigest() == want


def test_a_typed_row_action_with_no_click_still_gets_a_button(app, tmp_path):
    b = str(tmp_path / "b")
    shutil.copytree(TAGS, b)
    with open(os.path.join(b, "page.json")) as f:
        page = json.load(f)
    for story in page["stories"]:
        for step in story["steps"]:
            if step["tool"] == "addTag" and "ui" in step:
                step["ui"] = [u for u in step["ui"] if "click" not in u]
    with open(os.path.join(b, "page.json"), "w") as f:
        json.dump(page, f)
    got = run_js(
        "const r = await arrange({bundle, app, piece: 'tag', evaluate: fake});\n"
        "console.log(JSON.stringify(Object.entries(r.versions.tag ?? {}).map(([v, s]) => [v, inRepeat(s, 'todos', (e) => "
        "e.type === 'ActionButton' && e.props.action === 'addTag' && canon(e.props.args?.name) === canon({$state: '/draft/name'}))])));",
        bundle=b, app=app)
    assert got and all(ok for _, ok in got), "no addTag button reading the typed name: %s" % got
