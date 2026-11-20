"""The TinyApp screens check (factory/stack/tinyapp/screens.ts): what a screen's root draws,
and every element's props against the catalog. Needs bun and an offline-installable app."""
import json
import os
import shutil
import subprocess

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCREENS = os.path.join(ROOT, "factory/stack/tinyapp/screens.ts")
FIX = os.path.join(ROOT, "evals/fixtures/tinyapp-todo")
TODO = os.path.join(ROOT, "skills/ultrawrite/catalog/todo")

MISSING = ["SCREENS todo: no element runs addTodo", "SCREENS todo: no element runs completeTodo",
           "SCREENS todo: no element runs deleteTodo"]
CASES = [
    ("todo.json", 0, ["SCREENS ok: todo"]),
    ("todo_buttons_outside.json", 1, MISSING + ["SCREENS exit 1: 3 finding(s)"]),
    ("todo_root_missing.json", 1, ['SCREENS todo: root "nope" is no element',
                                    'SCREENS todo: form: child "ghost" is no element'] + MISSING
     + ["SCREENS exit 1: 5 finding(s)"]),
    ("todo_props_missing.json", 1, ["SCREENS todo: add: ActionButton needs prop label",
                                     "SCREENS todo: heading: Heading needs prop text",
                                     "SCREENS exit 1: 2 finding(s)"]),
    ("todo_root_hidden.json", 1, MISSING + ["SCREENS exit 1: 3 finding(s)"]),
]


@pytest.fixture(scope="module")
def app(tmp_path_factory):
    if not shutil.which("bun"):
        pytest.skip("bun is not installed")
    dst = str(tmp_path_factory.mktemp("screens") / "app")
    subprocess.run(["bun", os.path.join(ROOT, "skills/ultrawrite/stories/scaffold.ts"), TODO, dst],
                   check=True, capture_output=True, text=True)
    r = subprocess.run(["bun", "install", "--offline"], cwd=dst, capture_output=True, text=True, timeout=300)
    if r.returncode:
        pytest.skip("bun install --offline failed: " + r.stderr.strip()[-200:])
    return dst


@pytest.mark.parametrize("fixture,want_exit,want_lines", CASES)
def test_screens_check(app, fixture, want_exit, want_lines):
    shutil.copyfile(os.path.join(FIX, fixture), os.path.join(app, "client/src/pieces/todo.json"))
    r = subprocess.run(["bun", SCREENS, "--bundle", TODO, "--copy", app],
                       capture_output=True, text=True, timeout=120)
    assert (r.returncode, r.stdout.splitlines()) == (want_exit, want_lines)


def _screens(app, spec):
    with open(os.path.join(app, "client/src/pieces/todo.json"), "w") as f:
        json.dump(spec, f)
    r = subprocess.run(["bun", SCREENS, "--bundle", TODO, "--copy", app], capture_output=True, text=True, timeout=120)
    return r.returncode, r.stdout.splitlines()


def _todo():
    with open(os.path.join(FIX, "todo.json")) as f:
        return json.load(f)


def test_a_bind_item_writes_outside_draft(app):
    spec = _todo()
    spec["elements"]["new"]["props"]["value"] = {"$bindItem": "text"}
    code, lines = _screens(app, spec)
    assert code == 1 and "SCREENS todo: new: $bindItem text is outside /draft/" in lines, lines


def test_validate_form_without_a_state_path_writes_outside_draft(app):
    spec = _todo()
    spec["elements"]["add"]["on"]["press"] = [spec["elements"]["add"]["on"]["press"], {"action": "validateForm"}]
    code, lines = _screens(app, spec)
    assert (code, lines) == (1, ["SCREENS todo: add: on validateForm writes /formValidation, which is outside /draft/",
                                 "SCREENS exit 1: 1 finding(s)"])


def test_a_props_issue_with_no_path_names_the_element(app, tmp_path):
    a = str(tmp_path / "app")
    shutil.copytree(app, a, symlinks=True, ignore=lambda d, names: ["node_modules"] if d == app else [])
    os.symlink(os.path.join(app, "node_modules"), os.path.join(a, "node_modules"))
    with open(os.path.join(a, "client/src/screens/catalog.ts"), "a") as f:
        f.write("\ncomponents.Separator.props = components.Separator.props.refine(() => false, {message: 'never'})\n")
    spec = _todo()
    spec["elements"]["sep"] = {"type": "Separator", "props": {}, "children": []}
    spec["elements"][spec["root"]]["children"].append("sep")
    code, lines = _screens(a, spec)
    assert code == 1 and "SCREENS todo: sep: Separator props: never" in lines, lines
    assert not [l for l in lines if "undefined" in l], lines


def test_a_checkout_path_with_a_space_still_finds_the_parser(app, tmp_path):
    home = tmp_path / "a checkout"
    (home / "factory/stack/tinyapp").mkdir(parents=True)
    shutil.copyfile(SCREENS, home / "factory/stack/tinyapp/screens.ts")
    os.symlink(os.path.join(ROOT, "skills"), home / "skills")
    shutil.copyfile(os.path.join(FIX, "todo.json"), os.path.join(app, "client/src/pieces/todo.json"))
    r = subprocess.run(["bun", str(home / "factory/stack/tinyapp/screens.ts"), "--plan",
                        os.path.join(ROOT, "evals/fixtures/stories/todo/.ultrapowers/plan.md"), "--copy", app],
                       capture_output=True, text=True, timeout=120)
    assert (r.returncode, r.stdout.splitlines()) == (0, ["SCREENS ok: todo"])
