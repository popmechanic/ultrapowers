import json
import os
import re
import shutil
import subprocess

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STORIES = os.path.join(ROOT, "skills/ultrawrite/stories")
TEMPLATE = os.path.join(STORIES, "tinyapp-template")
TODO = os.path.join(ROOT, "skills/ultrawrite/catalog/todo")
EXACT = re.compile(r"^\d+\.\d+\.\d+$")


def _manifest():
    with open(os.path.join(TEMPLATE, "package.json")) as f:
        return json.load(f)


def _lock():
    with open(os.path.join(TEMPLATE, "bun.lock")) as f:
        return json.loads(re.sub(r",(\s*[}\]])", r"\1", f.read()))


def test_every_template_dependency_is_exact():
    m = _manifest()
    loose = {n: v for k in ("dependencies", "devDependencies")
             for n, v in m.get(k, {}).items() if not EXACT.match(v)}
    assert not loose, "pin these to an exact version: %r" % loose


def test_the_lockfile_matches_the_manifest():
    m, lock = _manifest(), _lock()
    ws = lock["workspaces"][""]
    for k in ("dependencies", "devDependencies"):
        assert ws.get(k, {}) == m.get(k, {}), "bun.lock's %s are stale: re-run bun install" % k
        for n, v in m.get(k, {}).items():
            assert lock["packages"][n][0] == "%s@%s" % (n, v), (n, lock["packages"][n][0])


def test_who_set_after_the_first_snapshot_reaches_session(tmp_path):
    if not shutil.which("bun"):
        pytest.skip("bun is not installed")
    app = str(tmp_path / "app")
    subprocess.run(["bun", os.path.join(STORIES, "scaffold.ts"), TODO, app],
                   check=True, capture_output=True, text=True)
    r = subprocess.run(["bun", "install", "--offline", "--frozen-lockfile"], cwd=app,
                       capture_output=True, text=True, timeout=300)
    if r.returncode:
        pytest.skip("bun install --offline failed: " + r.stderr.strip()[-200:])
    probe = os.path.join(app, "probe.ts")
    with open(probe, "w") as f:
        f.write(
            "import {createMergeableStore} from 'tinybase';\n"
            "import {tinybaseState} from './client/src/screens/state';\n"
            "let who: string | null = null;\n"
            "const state = tinybaseState(createMergeableStore(), () => ({staff: true, who}));\n"
            "let heard = 0; state.subscribe(() => { heard++; });\n"
            "who = 'a@b.c'; state.refresh();\n"
            "console.log(JSON.stringify({who: state.get('/session/who'), heard}));\n")
    r = subprocess.run(["bun", probe], cwd=app, capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, r.stderr
    assert json.loads(r.stdout.strip().splitlines()[-1]) == {"who": "a@b.c", "heard": 1}


def test_scaffold_writes_one_empty_screen(tmp_path):
    if not shutil.which("bun"):
        pytest.skip("bun is not installed")
    app = str(tmp_path / "app")
    subprocess.run(["bun", os.path.join(STORIES, "scaffold.ts"), TODO, app], check=True, capture_output=True, text=True)
    with open(os.path.join(app, "client/src/screen.json")) as f:
        assert json.load(f) == {"root": "page", "elements": {"page": {"type": "Stack", "props": {"gap": 4}, "children": []}}}
    assert not os.path.exists(os.path.join(app, "client/src/pieces"))


def test_the_page_draws_pieces_in_build_order(tmp_path):
    if not shutil.which("bun"):
        pytest.skip("bun is not installed")
    app = str(tmp_path / "app")
    subprocess.run(["bun", os.path.join(STORIES, "scaffold.ts"), os.path.join(ROOT, "skills/ultrawrite/catalog/todo-tags"), app],
                   check=True, capture_output=True, text=True)
    with open(os.path.join(app, "client/src/screens/order.json")) as f:
        assert json.load(f) == {"pieces": ["todo", "tag"]}
    os.remove(os.path.join(app, "client/src/screen.json"))
    os.makedirs(os.path.join(app, "client/src/pieces"))
    for p in ("tag", "todo"):
        with open(os.path.join(app, f"client/src/pieces/{p}.json"), "w") as f:
            json.dump({"root": p, "elements": {p: {"type": "Stack", "props": {}, "children": []}}}, f)
    r = subprocess.run(["bun", "-e", "import {pieceSpecs, screenSpec} from './client/src/screens/pieces.ts';"
                        "console.log(JSON.stringify([screenSpec(), Object.keys(pieceSpecs())]))"],
                       cwd=app, capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, r.stderr
    assert json.loads(r.stdout) == [None, ["todo", "tag"]]
