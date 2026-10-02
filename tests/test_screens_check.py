"""The TinyApp screens check (factory/stack/tinyapp/screens.ts): what a screen's root draws,
and every element's props against the catalog. Needs bun and an offline-installable app."""
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
