"""Jev's page arranger (skills/ultrawrite/stories/arrange.ts): the whole page from the cards
and the store alone, never a story's `ui` or `see`. Row controls carry their typed args and sit
in the one list of their table, whichever piece owns them; their words come from the card's
`label` and `x-label`, row cells templated in (#1524). A fake evaluator stands in for Jev, so no
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


def _bundle(tmp_path, edit, name="page.json", src=TAGS):
    """A copy of a bundle (todo-tags by default), its page.json (or another file) passed through edit."""
    b = str(tmp_path / "b")
    shutil.copytree(src, b)
    with open(os.path.join(b, name)) as f:
        doc = json.load(f)
    doc = edit(doc) or doc
    with open(os.path.join(b, name), "w") as f:
        json.dump(doc, f)
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
    """Every version of the todo-tags page, arranged by the fake evaluator."""
    return run_js("const r = await arrange({bundle, app, evaluate: fake}); console.log(JSON.stringify(r));",
                  bundle=TAGS, app=app)


def check_versions(app, pred, bundle=TAGS):
    """[version, does the predicate hold] for each version of the page."""
    return run_js(
        "const r = await arrange({bundle, app, evaluate: fake});\n"
        "console.log(JSON.stringify(Object.entries(r.versions).map(([v, s]) => [v, (%s)(s)])));" % pred,
        bundle=bundle, app=app)


def test_tag_row_button_carries_the_typed_name(app):
    got = check_versions(app, """(s) =>
      inRepeat(s, "todos", (e) => e.type === "ActionButton" && e.props.action === "addTag"
        && canon(e.props.args) === canon({todoId: {$item: "id"}, name: {$state: "/draft/name"}})
        && canon(e.props.label) === canon({$template: "Add tag to ${text}"}))
      && inRepeat(s, "todos", (e) => e.type === "DraftInput" && canon(e.props.label) === canon({$template: "Tag for ${text}"})
        && canon(e.props.value) === canon({$bindState: "/draft/name"}))""")
    assert got and all(ok for _, ok in got), "no Add-tag button with name in its args: %s" % got


def test_todo_versions_draw_the_complete_checkbox(app):
    got = check_versions(app, """(s) =>
      inRepeat(s, "todos", (e) => e.type === "ActionCheckbox" && e.props.action === "completeTodo"
        && canon(e.props.label) === canon({$item: "text"}) && canon(e.props.checked) === canon({$item: "completed"})
        && canon(e.props.args) === canon({id: {$item: "id"}}))""")
    assert got and all(ok for _, ok in got), "no completeTodo checkbox: %s" % got


def test_pieces_on_one_table_share_one_list(tagged):
    for v, s in tagged["versions"].items():
        els = s["elements"]
        lists = [i for i, e in els.items() if (e.get("repeat") or {}).get("statePath") == "/tables/todos"]
        assert len(lists) == 1, (v, lists)
        under, todo = set(), [lists[0]]
        while todo:
            for c in els[todo.pop()].get("children", []):
                under.add(c)
                todo.append(c)
        acts = sorted(els[i]["props"].get("action") for i in under if els[i]["props"].get("action"))
        assert acts == ["addTag", "completeTodo", "deleteTodo"], (v, acts)


def test_no_fixed_row_text(tagged):
    fixed = []
    for v, s in tagged["versions"].items():
        for id_, e in s["elements"].items():
            for key in ("label", "name"):
                x = e["props"].get(key)
                text = x.get("$template") if isinstance(x, dict) else x
                if isinstance(text, str) and "buy milk" in text:
                    fixed.append("%s %s: %s" % (v, id_, text))
    assert not fixed, fixed


def test_the_stories_ui_and_see_are_never_read(app, tagged, tmp_path):
    def strip(page):
        for story in page["stories"]:
            for step in story["steps"]:
                step.pop("ui", None)
                step.pop("see", None)
    b = _bundle(tmp_path, strip)
    got = run_js("const r = await arrange({bundle, app, evaluate: fake}); console.log(JSON.stringify(r));", bundle=b, app=app)
    assert got["versions"] == tagged["versions"]


def test_an_unlabelled_action_is_named_by_its_description(app, tmp_path):
    def unlabel(cards):
        a = next(x for x in cards[0]["actions"] if x["name"] == "completeTodo")
        del a["label"], a["control"]
    b = _bundle(tmp_path, unlabel, "cards.json")
    got = run_js(
        "const r = await arrange({bundle, app, evaluate: fake});\n"
        "console.log(JSON.stringify(Object.entries(r.versions).map(([v, s]) => "
        "[v, Object.values(s.elements).filter((e) => e.props.action === 'completeTodo').map((e) => [e.type, e.props.label])])));",
        bundle=b, app=app)
    assert got and all(controls == [["ActionButton", "Mark this todo as done."]] for _, controls in got), "got %s" % got


def test_the_card_words_name_the_controls(app, tmp_path):
    def words(cards):
        a = next(x for x in cards[0]["actions"] if x["name"] == "addTodo")
        a["label"] = "Put on list"
        a["inputSchema"]["properties"]["text"]["x-label"] = "Thing to do"
        d = next(x for x in cards[0]["actions"] if x["name"] == "deleteTodo")
        d["label"] = "Bin ${text} now"
    b = _bundle(tmp_path, words, "cards.json")
    got = check_versions(app, """(s) => { const es = Object.values(s.elements);
      return es.some((e) => e.type === "ActionButton" && e.props.action === "addTodo" && e.props.label === "Put on list")
        && es.some((e) => e.type === "DraftInput" && e.props.label === "Thing to do")
        && inRepeat(s, "todos", (e) => e.props.action === "deleteTodo" && canon(e.props.label) === canon({$template: "Bin ${text} now"})); }""", b)
    assert got and all(ok for _, ok in got), got


@pytest.mark.parametrize("bundle,want", [
    (TODO, "4358a8efbb1640edaf63462a38c3a3cf61ad7013093b7d11fafcb21679a6535c"),
    (SHOPPING, "b2e4a2e76241992820eec192d2deba531987d58e69452e749374ea26e094922f"),
])
def test_todo_and_shopping_output_unchanged(bun, tmp_path_factory, bundle, want):
    a = _app(tmp_path_factory, bundle, "guard")
    r = run_js("const r = await arrange({bundle, app, evaluate: fake}); console.log(JSON.stringify({versions: JSON.stringify(r.versions), dropped: r.dropped}));",
               bundle=bundle, app=a)
    assert r["dropped"] == {}
    assert hashlib.sha256(r["versions"].encode()).hexdigest() == want


REMOVE_LABEL = {"$computed": "format", "args": {
    "template": "Remove ${name} from ${todoId.text}",
    "name": {"$item": "name"},
    "todoId.text": {"$computed": "lookup", "args": {"rows": {"$state": "/tables/todos"}, "id": {"$item": "todoId"}, "column": "text"}},
}}


def test_remove_tag_names_its_own_todo(app, tagged):
    """The Remove button reads the tag's todo through lookup, and on two todos each tag's
    label names its own todo, resolved by json-render with the template's functions (#1524)."""
    labels = [e["props"]["label"] for s in tagged["versions"].values()
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
    for f in ("screen.json", "screen.A.json", "screen.B.json", "screen.C.json", "todo.B.json"):
        with open(os.path.join(screens, f), "w") as fh:
            fh.write("{}\n")
    run_js("writeVersions(screens, {A: {root: 'r', elements: {}}}); console.log('1');", screens=screens)
    assert sorted(os.listdir(screens)) == ["screen.A.json", "screen.json", "todo.B.json"]


def test_pick_copies_the_version_and_piece_is_refused(app, tmp_path):
    b = _bundle(tmp_path, lambda page: None)
    os.makedirs(os.path.join(b, "screens"))
    with open(os.path.join(b, "screens/screen.B.json"), "w") as f:
        f.write('{"root": "x",  "elements": {}}\n')
    r = subprocess.run(["bun", ARRANGE, b, "--app", app, "--pick", "B"], capture_output=True, text=True, timeout=120)
    assert r.returncode == 0, r.stdout + r.stderr
    with open(os.path.join(b, "screens/screen.json")) as f:
        assert f.read() == '{"root": "x",  "elements": {}}\n'
    r = subprocess.run(["bun", ARRANGE, b, "--app", app, "--piece", "todo", "--pick", "B"], capture_output=True, text=True, timeout=120)
    assert r.returncode == 2 and r.stdout.startswith("usage:"), r.stdout


def test_reshape_refuses_a_screen_missing_a_required_control(app):
    got = run_js(
        "const r = await arrange({bundle, app, evaluate: fake});\n"
        "let done = false;\n"
        "const drop = async ({questions}) => { const crit = questions.next.criteria;\n"
        "  const gone = Object.keys(crit).find((k) => k.startsWith('remove:') && crit[k].includes('(The list of'));\n"
        "  const c = done || !gone ? 'finish' : gone; done = true;\n"
        "  return {answers: {next: {choice: c, confidence: 0.9}, ...(questions.parent ? {parent: {choice: Object.keys(questions.parent.criteria)[0]}} : {})}}; };\n"
        "try { await reshape({bundle, app, spec: r.versions.A, notes: ['drop the list'], evaluate: drop}); console.log(JSON.stringify('kept')); }\n"
        "catch (e) { console.log(JSON.stringify([e.constructor.name, e.message.split(' ').slice(0, 7).join(' ')])); }",
        bundle=TAGS, app=app)
    assert got == ["CouldNotRun", "the reshaped screen left out The list"], got


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
    """The todo-tags page with two more tag actions, on its card alone: tagAll types a name,
    as addTag does, and clearTags (no args) empties the tags, the second of the page's two lists."""
    tmp = tmp_path_factory.mktemp("tagall")
    a = _copy(app, tmp)
    store = os.path.join(a, "client/src/store.js")
    with open(store) as f:
        text = f.read()
    assert text.count("  }\n]\n") == 1
    with open(store, "w") as f:
        f.write(text.replace("  }\n]\n", TAG_ALL))

    def edit(cards):
        tag = next(c for c in cards if c["piece"] == "tag")
        tag["actions"] += [
            {"name": "tagAll", "description": "Tag every todo with a word.", "label": "Tag all",
             "inputSchema": {"type": "object", "properties": {"name": {"type": "string", "x-label": "Tag every todo"}}, "required": ["name"]}},
            {"name": "clearTags", "description": "Take every tag off every todo.", "label": "Clear tags", "inputSchema": {"type": "object", "properties": {}}}]
    b = _bundle(tmp, edit, "cards.json")
    r = run_js("const r = await arrange({bundle, app, evaluate: fake}); console.log(JSON.stringify(r));", bundle=b, app=a)
    assert r["dropped"] == {} and r["versions"], r["dropped"]
    return r["versions"]


def test_two_actions_typing_one_field_keep_their_own_drafts(tag_all):
    for v, s in tag_all.items():
        els = s["elements"].values()
        boxes = sorted(e["props"]["value"]["$bindState"] for e in els if e["type"] == "DraftInput")
        reads = sorted((e["props"]["action"], e["props"]["args"]["name"]["$state"]) for e in els
                       if e["type"] == "ActionButton" and "name" in (e["props"].get("args") or {}))
        assert (boxes, reads) == (["/draft/addTag.name", "/draft/tagAll.name", "/draft/text"],
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
