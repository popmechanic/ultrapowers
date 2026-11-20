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
import {arrange, reshape, writeVersions} from %s;
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


def _copy(app, tmp_path):
    """A copy of the app of its own, its node_modules a link to the shared one."""
    dst = str(tmp_path / "app")
    shutil.copytree(app, dst, symlinks=True, ignore=lambda d, names: ["node_modules"] if d == app else [])
    os.symlink(os.path.join(app, "node_modules"), os.path.join(dst, "node_modules"))
    return dst


def _bundle(tmp_path, edit):
    """A copy of the todo-tags bundle, its page.json passed through edit(page)."""
    b = str(tmp_path / "b")
    shutil.copytree(TAGS, b)
    with open(os.path.join(b, "page.json")) as f:
        page = json.load(f)
    page = edit(page) or page
    with open(os.path.join(b, "page.json"), "w") as f:
        json.dump(page, f)
    return b


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
                for key in ("label", "name"):
                    x = e["props"].get(key)
                    text = x.get("$template") if isinstance(x, dict) else x
                    if isinstance(text, str) and "buy milk" in text:
                        fixed.append("%s %s %s: %s" % (piece, v, id_, text))
    assert not fixed, fixed


def test_versions_pass_screens_and_stories(app, tagged, tmp_path):
    app = _copy(app, tmp_path)
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


REMOVE_LABEL = {"$computed": "format", "args": {
    "template": "Remove ${name} from ${todoId.text}",
    "name": {"$item": "name"},
    "todoId.text": {"$computed": "lookup", "args": {"rows": {"$state": "/tables/todos"}, "id": {"$item": "todoId"}, "column": "text"}},
}}


def test_remove_tag_names_its_own_todo(app, tagged):
    """The Remove button reads the tag's todo through lookup, and on two todos each tag's
    label names its own todo, resolved by json-render with the template's functions (#1524)."""
    labels = [e["props"]["label"] for versions in tagged["versions"].values() for s in versions.values()
              for e in s["elements"].values() if e["props"].get("action") == "removeTag"]
    assert labels and all(l == REMOVE_LABEL for l in labels), labels
    got = run_js(
        "const {resolvePropValue} = await import(app + '/node_modules/@json-render/core/dist/index.mjs');\n"
        "const {functions} = await import(app + '/client/src/screens/functions.ts');\n"
        "const state = {tables: {todos: [{id: '0', text: 'buy milk'}, {id: '1', text: 'walk dog'}],\n"
        "  tags: [{id: '0', todoId: '0', name: 'shop'}, {id: '1', todoId: '1', name: 'pets'}]}};\n"
        "console.log(JSON.stringify(state.tables.tags.map((item, i) => resolvePropValue(label,\n"
        "  {stateModel: state, repeatItem: item, repeatIndex: i, repeatBasePath: '/tables/tags/' + i, functions}))));",
        app=app, label=REMOVE_LABEL)
    assert got == ["Remove shop from buy milk", "Remove pets from walk dog"], got


def test_dropped_versions_leave_no_file(bun, tmp_path):
    screens = str(tmp_path / "screens")
    os.makedirs(screens)
    for f in ("todo.json", "todo.A.json", "todo.B.json", "todo.C.json", "tag.B.json"):
        with open(os.path.join(screens, f), "w") as fh:
            fh.write("{}\n")
    run_js("writeVersions(screens, 'todo', {A: {root: 'r', elements: {}}}); console.log('1');", screens=screens)
    assert sorted(os.listdir(screens)) == ["tag.B.json", "todo.A.json", "todo.json"]


def test_reshape_refuses_a_screen_missing_a_required_control(app):
    got = run_js(
        "const r = await arrange({bundle, app, piece: 'todo', evaluate: fake});\n"
        "let done = false;\n"
        "const drop = async ({questions}) => { const crit = questions.next.criteria;\n"
        "  const gone = Object.keys(crit).find((k) => k.startsWith('remove:') && crit[k].includes('(The list of'));\n"
        "  const c = done || !gone ? 'finish' : gone; done = true;\n"
        "  return {answers: {next: {choice: c, confidence: 0.9}, ...(questions.parent ? {parent: {choice: Object.keys(questions.parent.criteria)[0]}} : {})}}; };\n"
        "try { await reshape({bundle, app, piece: 'todo', spec: r.versions.todo.A, notes: ['drop the list'], evaluate: drop}); console.log(JSON.stringify('kept')); }\n"
        "catch (e) { console.log(JSON.stringify([e.constructor.name, e.message.split(' ').slice(0, 7).join(' ')])); }",
        bundle=TAGS, app=app)
    assert got == ["CouldNotRun", "the reshaped screen left out The list"], got


def test_a_row_label_never_cuts_a_row_id_out(app, tmp_path):
    b = _bundle(tmp_path, lambda page: json.loads(json.dumps(page).replace("Remove shop from buy milk", "Remove shop from buy milk 0")))
    got = run_js(
        "const r = await arrange({bundle, app, piece: 'tag', evaluate: fake});\n"
        "console.log(JSON.stringify([...new Set(Object.values(r.versions.tag).flatMap((s) => Object.values(s.elements)"
        ".filter((e) => e.props.action === 'removeTag').map((e) => e.props.label?.args?.template)))]));",
        bundle=b, app=app)
    assert got == ["Remove ${name} from ${todoId.text} 0"], got


def test_a_seen_name_is_never_matched_by_a_row_id(app, tmp_path):
    def edit(page):
        page["stories"] = [s for s in page["stories"] if s["id"] not in ("S3", "S7")]
        page["stories"][1]["steps"][1]["see"] = [{"role": "button", "name": "Remove tag 0", "count": 1}]
    b = _bundle(tmp_path, edit)
    got = run_js(
        "const r = await arrange({bundle, app, piece: 'tag', evaluate: fake});\n"
        "console.log(JSON.stringify([...new Set(Object.values(r.versions.tag).flatMap((s) => Object.values(s.elements)"
        ".filter((e) => e.props.action === 'removeTag').map((e) => e.props.label)))]));",
        bundle=b, app=app)
    assert got == ["Take this tag off its todo."], got


TAG_ALL = """  },
  {
    name: 'tagAll', piece: 'tag', description: 'Tag every todo with a word.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    run: (store, { name }) => {
      for (const t of store.getRowIds('todos')) store.addRow('tags', { todoId: t, name: String(name) })
      return true
    }
  },
  {
    name: 'clearTags', piece: 'tag', description: 'Take every tag off every todo.',
    inputSchema: { type: 'object', properties: {} },
    run: (store) => { store.delTable('tags'); return true }
  }
]
"""


@pytest.fixture(scope="module")
def tag_all(app, tmp_path_factory):
    """The tag piece with two more actions: tagAll types a name, as addTag does, and
    clearTags (no args) empties the tags, the second of the piece's two lists."""
    tmp = tmp_path_factory.mktemp("tagall")
    a = _copy(app, tmp)
    store = os.path.join(a, "client/src/store.js")
    with open(store) as f:
        text = f.read()
    assert text.count("  }\n]\n") == 1
    with open(store, "w") as f:
        f.write(text.replace("  }\n]\n", TAG_ALL))

    def edit(page):
        page["stories"] += [
            {"id": "S8", "sentence": "You tag every todo home.", "steps": [
                {"tool": "addTodo", "args": {"text": "buy milk"}, "layer": "store"},
                {"tool": "tagAll", "args": {"name": "home"}, "layer": "ui", "ui": [
                    {"type": {"role": "textbox", "name": "Tag every todo", "text": "home"}},
                    {"click": {"role": "button", "name": "Tag all"}}]}]},
            {"id": "S9", "sentence": "You clear the tags.", "steps": [
                {"tool": "addTodo", "args": {"text": "buy milk"}, "layer": "store"},
                {"tool": "addTag", "args": {"todoId": "0", "name": "shop"}, "layer": "store"},
                {"tool": "clearTags", "args": {}, "layer": "ui", "ui": [{"click": {"role": "button", "name": "Clear tags"}}]}]}]
    b = _bundle(tmp, edit)
    with open(os.path.join(b, "cards.json")) as f:
        cards = json.load(f)
    tag = next(c for c in cards if c["piece"] == "tag")
    tag["actions"] += [
        {"name": "tagAll", "description": "Tag every todo with a word.",
         "inputSchema": {"type": "object", "properties": {"name": {"type": "string"}}, "required": ["name"]}},
        {"name": "clearTags", "description": "Take every tag off every todo.", "inputSchema": {"type": "object", "properties": {}}}]
    with open(os.path.join(b, "cards.json"), "w") as f:
        json.dump(cards, f)
    r = run_js("const r = await arrange({bundle, app, piece: 'tag', evaluate: fake}); console.log(JSON.stringify(r));", bundle=b, app=a)
    assert r["dropped"] == {} and r["versions"]["tag"], r["dropped"]
    return r["versions"]["tag"]


def test_two_actions_typing_one_field_keep_their_own_drafts(tag_all):
    for v, s in tag_all.items():
        els = s["elements"].values()
        boxes = sorted(e["props"]["value"]["$bindState"] for e in els if e["type"] == "DraftInput")
        reads = sorted((e["props"]["action"], e["props"]["args"]["name"]["$state"]) for e in els
                       if e["type"] == "ActionButton" and "name" in (e["props"].get("args") or {}))
        assert (boxes, reads) == (["/draft/addTag.name", "/draft/tagAll.name"],
                                  [("addTag", "/draft/addTag.name"), ("tagAll", "/draft/tagAll.name")]), v


def test_a_whole_list_button_sits_beside_its_own_list(tag_all):
    for v, s in tag_all.items():
        els = s["elements"]
        parent = {c: p for p, e in els.items() for c in e.get("children", [])}
        mover = next(i for i, e in els.items() if e["props"].get("action") == "clearTags")
        while parent.get(mover) not in (None, s["root"]) and len(els[parent[mover]]["children"]) == 1:
            mover = parent[mover]
        tags = next(i for i, e in els.items() if (e.get("repeat") or {}).get("statePath") == "/tables/tags")
        kids = els[parent[tags]]["children"]
        assert mover in kids and abs(kids.index(mover) - kids.index(tags)) == 1, (v, kids)


def test_compile_copies_no_screen_into_an_app_without_the_catalog(app, tmp_path):
    a = _copy(app, tmp_path)
    os.remove(os.path.join(a, "client/src/screens/catalog.ts"))
    shutil.rmtree(os.path.join(a, "client/src/pieces"))
    b = _bundle(tmp_path, lambda page: None)
    os.makedirs(os.path.join(b, "screens"), exist_ok=True)
    with open(os.path.join(b, "screens/todo.json"), "w") as f:
        f.write('{"root": "r", "elements": {}}\n')
    r = subprocess.run(["bun", os.path.join(STORIES, "compile.ts"), b, "--app", a, "--plan-id", "p1",
                        "--date", "2026-10-01", "--out", os.path.join(a, ".ultrapowers/plan.md")],
                       capture_output=True, text=True, timeout=120)
    assert r.returncode == 0, r.stdout + r.stderr
    assert not os.path.exists(os.path.join(a, "client/src/pieces/todo.json"))
