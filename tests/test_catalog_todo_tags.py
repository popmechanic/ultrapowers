import os
import shutil
import subprocess
import sys
import tempfile

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


def test_deleting_a_todo_clears_its_tags(tmp_path):
    if shutil.which("bun") is None:
        pytest.skip("bun is not on PATH")
    # Run from a tmp dir outside $HOME: bun resolves a bare import by walking
    # up from cwd looking for the nearest node_modules/package.json, and an
    # unrelated ancestor node_modules under $HOME can shadow that walk and
    # hide tinybase before bun's own auto-install gets a chance to run.
    # pytest's tmp_path lives under the OS temp dir, not $HOME, so it isn't
    # shadowed that way; fall back to /tmp directly if that ever changes.
    home = os.path.realpath(os.path.expanduser("~"))
    work = tmp_path
    made = None
    if os.path.commonpath([os.path.realpath(str(tmp_path)), home]) == home:
        made = tempfile.mkdtemp(dir="/tmp")
        work = made
    try:
        shutil.copyfile(os.path.join(B, "store.js"), os.path.join(str(work), "store.js"))
        js = ("import {TOOLS, makeStore} from './store.js';"
              "const s = makeStore(); const t = Object.fromEntries(TOOLS.map((x) => [x.name, x]));"
              "t.addTodo.run(s, {text: 'buy milk'}); t.addTag.run(s, {todoId: '0', name: 'shop'});"
              "if (t.addTag.run(s, {todoId: '0', name: 'shop'})) throw new Error('duplicate tag accepted');"
              "t.deleteTodo.run(s, {id: '0'}); console.log(JSON.stringify(s.getContent()));")
        env = {k: v for k, v in os.environ.items() if k != "NODE_PATH"}
        r = subprocess.run(["bun", "-e", js], cwd=str(work), capture_output=True, text=True, env=env)
        assert r.returncode == 0, r.stderr
        assert r.stdout.strip() == "[{},{}]"
    finally:
        if made:
            shutil.rmtree(made, ignore_errors=True)
