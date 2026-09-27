"""The starting app a stories-v1 launch builds on: the template plus the
signed store module plus one stub screen per piece."""
import os
import shutil
import subprocess
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCAFFOLD = os.path.join(ROOT, "skills/ultrawrite/stories/scaffold.py")
TODO = os.path.join(ROOT, "skills/ultrawrite/catalog/todo")


def scaffold(dst):
    return subprocess.run([sys.executable, SCAFFOLD, TODO, str(dst)], capture_output=True, text=True)


def test_scaffold_writes_the_given_code(tmp_path):
    r = scaffold(tmp_path / "app")
    assert r.returncode == 0, r.stderr
    app = tmp_path / "app"
    for p in ("package.json", "client/index.html", "client/src/app.ts", "client/src/store.js",
              "client/src/pieces/index.ts", "client/src/pieces/todo.ts",
              "server/index.ts", "server/wrangler.jsonc"):
        assert (app / p).is_file(), p
    assert "import * as todo from './todo';" in (app / "client/src/pieces/index.ts").read_text()
    assert r.stdout.strip() == "SCAFFOLDED %s: pieces todo" % app


def test_scaffold_refuses_a_directory_with_files(tmp_path):
    (tmp_path / "x").mkdir()
    (tmp_path / "x" / "a.txt").write_text("a")
    r = scaffold(tmp_path / "x")
    assert r.returncode == 2 and "is not empty" in r.stdout


def test_the_scaffold_installs_builds_and_typechecks(tmp_path):
    if shutil.which("bun") is None:
        pytest.skip("bun is not on PATH")
    app = tmp_path / "app"
    assert scaffold(app).returncode == 0
    for cmd in (["bun", "install"], ["bun", "run", "typecheck"],
                ["bun", "build", "./client/index.html", "--outdir", str(tmp_path / "dist")]):
        r = subprocess.run(cmd, cwd=app, capture_output=True, text=True, timeout=300)
        assert r.returncode == 0, " ".join(cmd) + "\n" + r.stdout + r.stderr
