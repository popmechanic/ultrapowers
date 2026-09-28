#!/usr/bin/env python3
"""Score the state-probe checker against a good todo app and broken copies of
it: the seed of story-planning part 4's broken-copy kit. Not a test: nothing
runs it automatically; run it when factory/stack/tinyapp/ changes.

    python3 evals/readings/checker_kit.py

Needs bun, celld and a browser (TINYAPP_BROWSER, /headless-shell, or the
Mac's Chrome). Prints one row per case, expected against got, and exits 0 only
when every case lands where it should."""
import json
import os
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CHECK = os.path.join(ROOT, "factory/stack/tinyapp/check.ts")
FIX = os.path.join(ROOT, "evals/fixtures/tinyapp-todo")
TODO = os.path.join(ROOT, "skills/ultrawrite/catalog/todo")

# (case, screen, server, clause, extra env, plan edit, expected exit, expected stage)
CASES = [
    ("good app, S1.1", "todo.ts", None, "S1.1", {}, None, 0, "ok"),
    ("good app, S2.2", "todo.ts", None, "S2.2", {}, None, 0, "ok"),
    ("good app, S3.1", "todo.ts", None, "S3.1", {}, None, 0, "ok"),
    ("good app, S4.2", "todo.ts", None, "S4.2", {}, None, 0, "ok"),
    ("starting app (nothing built)", None, None, "S1.1", {}, None, 1, "do"),
    ("Add button does nothing", "todo_add_noop.ts", None, "S1.1", {}, None, 1, "after"),
    ("wrong text on screen", "todo_wrong_text.ts", None, "S1.1", {}, None, 1, "see"),
    ("server never saves", "todo.ts", "server_no_persister.ts", "S1.1", {}, None, 1, "saved"),
    ("hollow step", "todo.ts", None, "S1.1", {}, "hollow", 1, "before"),
    ("no browser", "todo.ts", None, "S1.1", {"TINYAPP_BROWSER": "/nonexistent"}, None, 2, "env"),
]


def run(cmd, **kw):
    return subprocess.run(cmd, check=True, capture_output=True, text=True, **kw)


def make_base(dst):
    run([sys.executable, os.path.join(ROOT, "skills/ultrawrite/stories/scaffold.py"), TODO, dst])
    run([sys.executable, os.path.join(ROOT, "skills/ultrawrite/stories/compile.py"), TODO, "--app", dst,
         "--plan-id", "p1", "--date", "2026-09-27", "--out", os.path.join(dst, ".ultrapowers/plan.md")])
    run(["bun", "install"], cwd=dst, timeout=300)


def make_copy(base, dst, screen, server, edit):
    shutil.copytree(base, dst, ignore=shutil.ignore_patterns("node_modules"))
    os.symlink(os.path.join(base, "node_modules"), os.path.join(dst, "node_modules"))
    if screen:
        shutil.copyfile(os.path.join(FIX, screen), os.path.join(dst, "client/src/pieces/todo.ts"))
    if server:
        shutil.copyfile(os.path.join(FIX, server), os.path.join(dst, "server/index.ts"))
    if edit == "hollow":
        plan = os.path.join(dst, ".ultrapowers/plan.md")
        lines = open(plan).read().splitlines()
        i = next(n for n, l in enumerate(lines) if l.startswith("{") and '"clause": "S1.1"' in l)
        p = json.loads(lines[i])
        p["given"] = [{"tool": "addTodo", "args": {"text": "buy milk"}}]
        lines[i] = json.dumps(p, sort_keys=True)
        open(plan, "w").write("\n".join(lines) + "\n")


def main():
    work = tempfile.mkdtemp(prefix="checker-kit-", dir="/tmp")
    try:
        base = os.path.join(work, "base")
        make_base(base)
        misses = 0
        for n, (name, screen, server, clause, env, edit, want_exit, want_stage) in enumerate(CASES):
            app = os.path.join(work, "case%d" % n, "app")
            os.makedirs(os.path.dirname(app))
            make_copy(base, app, screen, server, edit)
            out = os.path.join(os.path.dirname(app), "result.json")
            r = subprocess.run(["bun", CHECK, "--plan", os.path.join(app, ".ultrapowers/plan.md"), "--clause", clause,
                                "--copy", app, "--out", out], capture_output=True, text=True, timeout=120,
                               env={**os.environ, **env})
            stage = json.load(open(out))["stage"] if os.path.exists(out) else "?"
            ok = (r.returncode, stage) == (want_exit, want_stage)
            misses += not ok
            print("%-4s %-30s want %d/%-7s got %d/%s" % ("ok" if ok else "MISS", name, want_exit, want_stage,
                                                       r.returncode, stage))
        print("%d/%d cases landed where they should" % (len(CASES) - misses, len(CASES)))
        return 1 if misses else 0
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
