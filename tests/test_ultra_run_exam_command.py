"""A per-task `testCmd` the runner table does not know is probed on PATH (#644).

Task 1's exam for the preflight half. Before this task, a `testCmd` matching
none of the three built-in prefixes (`python3 -m pytest`, `node `, `bun test`)
fell through to `{"runner": None, "ok": False}` — so a plan that declares its
own exam command (`npx vitest run …`, `go test …`, `zig test …`) could never
pass `--validate-knobs`. The new rule: the runner is the command's first
whitespace-delimited word, and its verdict is whether that word resolves on
PATH — green when it does, red (and a non-zero exit) when it does not. The
three built-in prefixes still answer the table's own runner label and
`--version` probe argv.

Offline: the case builds its own git repo under `tmp_path`, and `zig` is a
shell stub the test writes — nothing here needs Zig installed.
"""
import json
import os
import pathlib
import shutil
import stat
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
RUN = ROOT / "skills/ultrapowers/scripts/ultra_run.py"
sys.path.insert(0, str(ROOT / "skills/ultrapowers/scripts"))
from ultra_run import runner_for  # noqa: E402

ZIG = "zig test tests/x.zig"


def sh(cmd, cwd=None, env=None):
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, env=env)


def make_repo(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    sh(["git", "init", "-q", "-b", "main"], cwd=repo)
    sh(["git", "config", "user.email", "t@t"], cwd=repo)
    sh(["git", "config", "user.name", "t"], cwd=repo)
    (repo / ".gitignore").write_text(".claude/\n")
    (repo / "a.txt").write_text("a\n")
    sh(["git", "add", "."], cwd=repo)
    sh(["git", "commit", "-qm", "base"], cwd=repo)
    return repo


def write_args(repo, entries):
    """An args file shaped as the compiler emits it: one wave, whose entries
    carry the knob slots the validator already walks plus a `testCmd`."""
    args_path = repo / "args.json"
    args_path.write_text(json.dumps({"waves": [list(entries)]}))
    return args_path


def entry(tid, **extra):
    e = {"id": tid, "tier": None, "review": "lean"}
    e.update(extra)
    return e


def validate(repo, args_path, env=None):
    return sh([sys.executable, str(RUN), "--validate-knobs", str(args_path)],
              cwd=repo, env=env)


def path_with_zig(tmp_path):
    """A PATH whose first entry holds an executable `zig`."""
    bin_dir = tmp_path / "zig-bin"
    bin_dir.mkdir()
    stub = bin_dir / "zig"
    stub.write_text("#!/bin/sh\necho 0.13.0\nexit 0\n")
    stub.chmod(stub.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    return dict(os.environ, PATH=str(bin_dir) + os.pathsep + os.environ["PATH"])


def path_without_zig(tmp_path, tools=("git", "sh", "python3")):
    """A PATH holding only `tools` — so `zig` is genuinely unresolvable while
    the validator's own git still runs."""
    bin_dir = tmp_path / "narrow-bin"
    bin_dir.mkdir()
    for tool in tools:
        real = shutil.which(tool)
        assert real, tool
        (bin_dir / tool).symlink_to(real)
    return dict(os.environ, PATH=str(bin_dir))


def assert_no_probe_left(repo):
    assert not list((repo / ".claude/ultrapowers").glob("wt-knob-*"))


# --- leg (e) [M5]: the declared runner, resolved and unresolved --------------

def test_a_declared_runner_on_path_validates_green(tmp_path):
    repo = make_repo(tmp_path)
    args_path = write_args(repo, [entry("1", testCmd=ZIG)])
    r = validate(repo, args_path, env=path_with_zig(tmp_path))
    assert r.returncode == 0, r.stdout + r.stderr
    v = json.loads(r.stdout)
    assert v["ok"] is True, r.stdout
    assert v["perTaskTestCmds"] == [{"cmd": ZIG, "runner": "zig", "ok": True}]
    assert_no_probe_left(repo)


def test_a_declared_runner_missing_from_path_is_red_and_exits_nonzero(tmp_path):
    repo = make_repo(tmp_path)
    args_path = write_args(repo, [entry("1", testCmd=ZIG)])
    r = validate(repo, args_path, env=path_without_zig(tmp_path))
    assert r.returncode != 0, "a runner that does not resolve must fail the " \
                              "validation\n" + r.stdout + r.stderr
    v = json.loads(r.stdout)
    assert v["ok"] is False, r.stdout
    assert v["perTaskTestCmds"] == [{"cmd": ZIG, "runner": "zig", "ok": False}]
    assert_no_probe_left(repo)


# --- leg (e) [M5]: the built-in table still answers as it did ----------------

def test_runner_for_still_answers_the_table_for_the_three_built_in_prefixes():
    assert runner_for("python3 -m pytest -q tests/x.py") == (
        "python3 -m pytest", ["python3", "-m", "pytest", "--version"])
    assert runner_for("node fleet/tests/test_x.mjs") == (
        "node", ["node", "--version"])
    assert runner_for("bun test tests/a.test.ts") == (
        "bun test", ["bun", "--version"])


def test_runner_for_names_the_first_word_of_an_unlisted_command():
    runner, probe = runner_for(ZIG)
    assert runner == "zig"
    # ... and it is probed for resolution, not for a version.
    assert probe, "an unlisted runner still gets a probe"
    assert "zig" in " ".join(probe)
