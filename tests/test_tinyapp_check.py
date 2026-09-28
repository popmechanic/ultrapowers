"""The checker against a known-good todo app and four broken copies of it.
Needs bun, celld and a browser; skips naming whichever is missing."""
import json
import os
import shutil
import signal
import subprocess
import sys
import time

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHECK = os.path.join(ROOT, "factory/stack/tinyapp/check.ts")
FIX = os.path.join(ROOT, "tests/fixtures/tinyapp-todo")
TODO = os.path.join(ROOT, "skills/ultrawrite/catalog/todo")
MAC_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"


def _missing():
    if shutil.which("bun") is None:
        return "bun is not on PATH"
    if not (os.environ.get("CELLD_BIN") or shutil.which("celld")):
        return "celld is not on PATH"
    if not any(os.path.exists(p) for p in (os.environ.get("TINYAPP_BROWSER", ""),
                                            "/headless-shell/headless-shell", MAC_CHROME)):
        return "no browser: set TINYAPP_BROWSER"
    return None


pytestmark = pytest.mark.skipif(_missing() is not None, reason=str(_missing()))


@pytest.fixture(scope="module")
def base(tmp_path_factory):
    app = tmp_path_factory.mktemp("tinyapp") / "app"
    subprocess.run([sys.executable, os.path.join(ROOT, "skills/ultrawrite/stories/scaffold.py"), TODO, str(app)], check=True)
    subprocess.run([sys.executable, os.path.join(ROOT, "skills/ultrawrite/stories/compile.py"), TODO,
                    "--app", str(app), "--plan-id", "p1", "--date", "2026-09-27",
                    "--out", str(app / ".ultrapowers/plan.md")], check=True)
    subprocess.run(["bun", "install"], cwd=app, check=True, timeout=300)
    return app


def variant(base, tmp_path, screen="todo.ts", server=None):
    app = tmp_path / "app"
    shutil.copytree(base, app, ignore=shutil.ignore_patterns("node_modules"))
    os.symlink(base / "node_modules", app / "node_modules")
    shutil.copyfile(os.path.join(FIX, screen), app / "client/src/pieces/todo.ts")
    if server:
        shutil.copyfile(os.path.join(FIX, server), app / "server/index.ts")
    return app


def check(app, clause, *extra, env=None):
    out = app.parent / ("%s.json" % clause)
    r = subprocess.run(["bun", CHECK, "--plan", str(app / ".ultrapowers/plan.md"), "--clause", clause,
                        "--copy", str(app), "--out", str(out), *extra],
                       capture_output=True, text=True, timeout=120, env={**os.environ, **(env or {})})
    return r.returncode, json.loads(out.read_text()), r.stdout + r.stderr


def test_the_good_app_passes_every_step(base, tmp_path):
    app = variant(base, tmp_path)
    for clause in ("S1.1", "S2.2", "S3.1", "S4.2"):
        code, res, out = check(app, clause)
        assert (code, res["stage"]) == (0, "ok"), out


def test_the_good_app_is_steady_at_the_saved_stage(base, tmp_path):
    app = variant(base, tmp_path)
    for _ in range(3):
        code, res, out = check(app, "S1.1")
        assert code == 0, out


def test_the_starting_app_fails_every_step_on_the_screen(base):
    code, res, out = check(base, "S1.1")
    assert (code, res["stage"]) == (1, "do"), out
    assert 'textbox named "New todo"' in res["message"]


def test_an_add_button_that_does_nothing_fails_after(base, tmp_path):
    code, res, _ = check(variant(base, tmp_path, "todo_add_noop.ts"), "S1.1")
    assert (code, res["stage"]) == (1, "after")
    assert "todos row 0: text should be \"buy milk\"" in res["message"]


def test_the_wrong_text_on_screen_fails_see(base, tmp_path):
    code, res, _ = check(variant(base, tmp_path, "todo_wrong_text.ts"), "S1.1")
    assert (code, res["stage"]) == (1, "see")
    assert 'checkbox named "buy milk"' in res["message"]


def test_a_server_that_never_saves_fails_saved(base, tmp_path):
    code, res, _ = check(variant(base, tmp_path, server="server_no_persister.ts"), "S1.1")
    assert (code, res["stage"]) == (1, "saved")


def test_a_hollow_step_fails_before(base, tmp_path):
    app = variant(base, tmp_path)
    plan = app / ".ultrapowers/plan.md"
    text = plan.read_text()
    lines = text.splitlines()
    i = next(n for n, l in enumerate(lines) if l.startswith('{') and '"clause": "S1.1"' in l)
    p = json.loads(lines[i])
    p["given"] = [{"tool": "addTodo", "args": {"text": "buy milk"}}]
    lines[i] = json.dumps(p, sort_keys=True)
    plan.write_text("\n".join(lines) + "\n")
    code, res, _ = check(app, "S1.1")
    assert (code, res["stage"]) == (1, "before")
    assert "hollow" in res["message"]


def test_no_browser_is_the_sandbox_not_the_app(base, tmp_path):
    code, res, _ = check(variant(base, tmp_path), "S1.1", env={"TINYAPP_BROWSER": "/nonexistent"})
    assert (code, res["stage"]) == (2, "env")


def test_a_guard_clauses_slash_becomes_an_underscore_in_the_result_filename(base, tmp_path):
    # A guard clause's id (e.g. G:p0/S2.3) carries a '/'; FLOCK_CHECK_OUT's
    # derived filename is one path segment, not a nested directory.
    app = variant(base, tmp_path)
    check_out = tmp_path / "check-out"
    check_out.mkdir()
    r = subprocess.run(
        ["bun", CHECK, "--plan", str(app / ".ultrapowers/plan.md"), "--clause", "G:p0/S2.3", "--copy", str(app)],
        capture_output=True, text=True, timeout=120,
        env={**os.environ, "FLOCK_CHECK_OUT": str(check_out)})
    assert not (check_out / "G:p0").exists()
    files = list(check_out.iterdir())
    assert len(files) == 1, files
    assert files[0].name == "G:p0_S2.3@app.json", files[0].name
    res = json.loads(files[0].read_text())
    assert res["clause"] == "G:p0/S2.3"


def test_a_timed_out_check_leaves_nothing_running(base, tmp_path):
    # The check's own temp dir, so a celld or browser of a test running beside
    # this one under xdist is not counted; both carry that dir in their argv.
    tmp = tmp_path / "tmp"
    tmp.mkdir()
    code, res, _ = check(variant(base, tmp_path), "S1.1", "--budget-ms", "1000", env={"TMPDIR": str(tmp)})
    assert (code, res["stage"]) == (2, "env")
    left = subprocess.run(["pgrep", "-f", str(tmp)], capture_output=True, text=True).stdout.split()
    assert left == []
    assert [p.name for p in tmp.iterdir()] == []


def test_a_sigterm_stops_the_check_cleanly(base, tmp_path):
    # The Flock's 60 s runFacts timeout sends SIGTERM, not SIGKILL: the check
    # must own its own cleanup on the way out, the same as the budget timeout
    # (same own-its-temp-dir isolation as the timeout test above).
    tmp = tmp_path / "tmp"
    tmp.mkdir()
    out = tmp_path / "S1.1.json"
    app = variant(base, tmp_path)
    proc = subprocess.Popen(
        ["bun", CHECK, "--plan", str(app / ".ultrapowers/plan.md"), "--clause", "S1.1",
         "--copy", str(app), "--out", str(out)],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
        env={**os.environ, "TMPDIR": str(tmp)})
    try:
        time.sleep(3)
        proc.send_signal(signal.SIGTERM)
        stdout, _ = proc.communicate(timeout=30)
    finally:
        if proc.poll() is None:
            proc.kill()
            proc.communicate()
    assert proc.returncode == 2, stdout
    res = json.loads(out.read_text())
    assert res["stage"] == "env"
    assert "stopped" in res["message"]
    left = subprocess.run(["pgrep", "-f", str(tmp)], capture_output=True, text=True).stdout.split()
    assert left == []
    assert [p.name for p in tmp.iterdir()] == []
