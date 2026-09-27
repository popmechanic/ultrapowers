import os
import shutil
import subprocess
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
B = os.path.join(ROOT, "skills/ultrawrite/catalog/todo-tags")
sys.path.insert(0, os.path.join(ROOT, "skills/ultrawrite/stories"))
sys.path.insert(0, os.path.join(ROOT, "skills/ultrapowers/scripts"))
import bundle  # noqa: E402
import checks  # noqa: E402
import compile as comp  # noqa: E402
from test_stories_compile import probes_in  # noqa: E402


def test_the_bundle_passes_its_checks():
    refusals, _ = checks.run_checks(bundle.load_bundle(B))
    assert refusals == []


def test_two_screen_tasks_and_no_links_task():
    text = comp.compile_plan(bundle.load_bundle(B), "tt1", [])
    assert "### Task 1: The todo piece" in text and "### Task 2: The tag piece" in text
    assert "automatic links" not in text
    assert [p["clause"] for p in probes_in(text)] == ["S1.1", "S4.3", "S2.2", "S3.3"]
    assert "**Depends-on-pieces:** none" in text.split("### Task 2")[1]


def test_deleting_a_todo_clears_its_tags():
    if shutil.which("bun") is None:
        pytest.skip("bun is not on PATH")
    js = ("import {TOOLS, makeStore} from './store.js';"
          "const s = makeStore(); const t = Object.fromEntries(TOOLS.map((x) => [x.name, x]));"
          "t.addTodo.run(s, {text: 'buy milk'}); t.addTag.run(s, {todoId: '0', name: 'shop'});"
          "if (t.addTag.run(s, {todoId: '0', name: 'shop'})) throw new Error('duplicate tag accepted');"
          "t.deleteTodo.run(s, {id: '0'}); console.log(JSON.stringify(s.getContent()));")
    r = subprocess.run(["bun", "-e", js], cwd=B, capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    assert r.stdout.strip() == "[{},{}]"
