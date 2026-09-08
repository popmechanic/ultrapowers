"""#234: the preflight checks every per-task test command's runner.

`ultra_run.py --validate-knobs <args.json>` probes each distinct per-task
`testCmd` runner once with `--version`, inside the same throwaway probe
worktree the bootstrap knob is rehearsed in — so a task whose tests need a
tool the sandbox lacks fails at preflight instead of mid-wave. A dry run is
impossible (a task's `Test:` files are created by the task and do not exist at
BASE), so `--version` is the parse-check.

Offline: every case builds its own git repo under `tmp_path`, and every probe
is a `--version` call or a shell shim written by the test.
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

NODE_A = "node fleet/tests/test_a.mjs"
NODE_B = "node fleet/tests/test_b.mjs"
PYTEST_B = "python3 -m pytest -q tests/test_b.py"
PYTEST_C = "python3 -m pytest -q tests/test_c.py"

# The BASE line, byte-for-byte: an args file with nothing to validate must
# still print exactly this (#89/#116 contract, additively preserved).
BASE_LINE = {"ok": True, "stage": "knob-validate",
             "detail": "no bootstrapCmd — nothing to validate"}


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


def entry(tid, **extra):
    """A wave entry as the compiler emits it: the knob slots the validator
    already walks, plus whatever this case is pinning."""
    e = {"id": tid, "tier": None, "review": "lean"}
    e.update(extra)
    return e


def write_args(repo, entries, **top):
    args_path = repo / "args.json"
    payload = {"waves": [list(entries)]}
    payload.update(top)
    args_path.write_text(json.dumps(payload))
    return args_path


def validate(repo, args_path, *extra, env=None):
    """The knob verb. `extra` carries the flags a case is pinning — #770's
    `--no-baseline` is passed this way rather than through a second helper."""
    return sh([sys.executable, str(RUN), "--validate-knobs", str(args_path),
               *extra], cwd=repo, env=env)


def worktrees(repo):
    return sh(["git", "worktree", "list"], cwd=repo).stdout.strip().splitlines()


def assert_no_probe_left(repo):
    """Leg (e): the probe worktree is always removed, red or green."""
    assert not list((repo / ".claude/ultrapowers").glob("wt-knob-*"))
    assert len(worktrees(repo)) == 1


def narrow_path(tmp_path, tools=("git", "sh", "python3")):
    """A PATH holding only `tools` — used to make `node` genuinely absent
    while pytest's runner stays reachable."""
    bin_dir = tmp_path / "narrow-bin"
    bin_dir.mkdir()
    for tool in tools:
        real = shutil.which(tool)
        assert real, tool
        (bin_dir / tool).symlink_to(real)
    return dict(os.environ, PATH=str(bin_dir))


def shim_env(tmp_path, name, log, exit_code=0, only_args=None):
    """Put a logging stand-in for `name` first on PATH. Every invocation
    appends `<physical cwd>\\t<argv>` to `log`. With `only_args`, the shim
    exits `exit_code` for that exact argv and execs the real tool otherwise;
    without it, every invocation exits `exit_code`."""
    bin_dir = tmp_path / ("shim-" + name)
    bin_dir.mkdir()
    real = shutil.which(name)
    assert real, name
    lines = ["#!/bin/sh",
             "printf '%s\\t%s\\n' \"$(pwd -P)\" \"$*\" >> " + json.dumps(str(log))]
    if only_args is None:
        lines.append("exit " + str(exit_code))
    else:
        lines.append('if [ "$*" = ' + json.dumps(only_args) + " ]; then exit "
                     + str(exit_code) + "; fi")
        lines.append('exec ' + json.dumps(real) + ' "$@"')
    shim = bin_dir / name
    shim.write_text("\n".join(lines) + "\n")
    shim.chmod(shim.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    return dict(os.environ, PATH=str(bin_dir) + os.pathsep + os.environ["PATH"])


def calls(log):
    """(cwd, argv) per shim invocation, in order."""
    if not log.exists():
        return []
    return [tuple(line.split("\t", 1)) for line in log.read_text().splitlines()]


# --- leg (a): both runners probed, a null slot skipped -----------------------

def test_two_runners_probe_green_and_a_null_slot_is_skipped(tmp_path):
    repo = make_repo(tmp_path)
    args_path = write_args(repo, [entry("1", testCmd=NODE_A),
                                  entry("2", testCmd=PYTEST_B),
                                  entry("3", testCmd=None)])
    r = validate(repo, args_path)
    assert r.returncode == 0, r.stdout + r.stderr
    v = json.loads(r.stdout)
    assert v["ok"] is True
    assert v["perTaskTestCmds"] == [
        {"cmd": NODE_A, "runner": "node", "ok": True},
        {"cmd": PYTEST_B, "runner": "python3 -m pytest", "ok": True},
    ]
    assert_no_probe_left(repo)


# --- leg (b): a command matching neither prefix is red -----------------------

def test_an_unrecognised_runner_fails_the_line(tmp_path):
    repo = make_repo(tmp_path)
    args_path = write_args(repo, [entry("1", testCmd="weird-runner tests/x")])
    r = validate(repo, args_path)
    assert r.returncode == 1, r.stdout + r.stderr
    v = json.loads(r.stdout)
    assert v["ok"] is False
    # #644 named the runner of a command the table does not know — it is the
    # first word, probed for resolution on PATH. `weird-runner` resolves
    # nowhere, so this leg's verdict is the red it always was.
    assert v["perTaskTestCmds"] == [
        {"cmd": "weird-runner tests/x", "runner": "weird-runner", "ok": False},
    ]
    assert_no_probe_left(repo)


# --- leg (c): a runner the sandbox lacks is red, the other stays green -------

def test_a_missing_node_is_red_while_pytest_stays_green(tmp_path):
    repo = make_repo(tmp_path)
    args_path = write_args(repo, [entry("1", testCmd=NODE_A),
                                  entry("2", testCmd=PYTEST_B)])
    r = validate(repo, args_path, env=narrow_path(tmp_path))
    assert r.returncode == 1, r.stdout + r.stderr
    v = json.loads(r.stdout)
    assert v["ok"] is False
    assert v["perTaskTestCmds"] == [
        {"cmd": NODE_A, "runner": "node", "ok": False},
        {"cmd": PYTEST_B, "runner": "python3 -m pytest", "ok": True},
    ]
    assert_no_probe_left(repo)


# --- leg (d): no per-task command -> the BASE line, byte-identical -----------

def test_no_test_cmd_key_prints_exactly_the_base_line(tmp_path):
    repo = make_repo(tmp_path)
    args_path = write_args(repo, [entry("1"), entry("2")])
    r = validate(repo, args_path)
    assert r.returncode == 0, r.stdout + r.stderr
    assert json.loads(r.stdout) == BASE_LINE
    assert_no_probe_left(repo)


def test_all_null_test_cmds_print_exactly_the_base_line(tmp_path):
    repo = make_repo(tmp_path)
    args_path = write_args(repo, [entry("1", testCmd=None),
                                  entry("2", testCmd=None)])
    r = validate(repo, args_path)
    assert r.returncode == 0, r.stdout + r.stderr
    assert json.loads(r.stdout) == BASE_LINE
    assert_no_probe_left(repo)


# --- legs (f)+(g): one probe per distinct runner, run in the probe worktree --

def test_distinct_commands_share_a_single_runner_probe(tmp_path):
    repo = make_repo(tmp_path)
    log = tmp_path / "node-calls.log"
    env = shim_env(tmp_path, "node", log)
    args_path = write_args(repo, [entry("1", testCmd=NODE_A),
                                  entry("2", testCmd=NODE_A),
                                  entry("3", testCmd=NODE_B),
                                  entry("4", testCmd=PYTEST_C)])
    r = validate(repo, args_path, env=env)
    assert r.returncode == 0, r.stdout + r.stderr
    v = json.loads(r.stdout)
    assert v["ok"] is True
    assert v["perTaskTestCmds"] == [
        {"cmd": NODE_A, "runner": "node", "ok": True},
        {"cmd": NODE_B, "runner": "node", "ok": True},
        {"cmd": PYTEST_C, "runner": "python3 -m pytest", "ok": True},
    ]
    assert [argv for _cwd, argv in calls(log)] == ["--version"]
    assert_no_probe_left(repo)


def test_the_runner_probe_runs_in_the_probe_worktree(tmp_path):
    repo = make_repo(tmp_path)
    log = tmp_path / "node-cwd.log"
    env = shim_env(tmp_path, "node", log)
    args_path = write_args(repo, [entry("1", testCmd=NODE_A)])
    r = validate(repo, args_path, env=env)
    assert r.returncode == 0, r.stdout + r.stderr
    recorded = calls(log)
    assert len(recorded) == 1
    cwd = pathlib.Path(recorded[0][0])
    assert cwd.parent == (repo / ".claude/ultrapowers").resolve()
    assert cwd.name.startswith("wt-knob-")
    assert cwd != repo.resolve()
    assert_no_probe_left(repo)


# --- leg (h): a runner that exits non-zero is red ----------------------------

def test_a_node_runner_that_exits_nonzero_is_red(tmp_path):
    repo = make_repo(tmp_path)
    log = tmp_path / "node-red.log"
    env = shim_env(tmp_path, "node", log, exit_code=3)
    args_path = write_args(repo, [entry("1", testCmd=NODE_A),
                                  entry("2", testCmd=PYTEST_B)])
    r = validate(repo, args_path, env=env)
    assert r.returncode == 1, r.stdout + r.stderr
    v = json.loads(r.stdout)
    assert v["ok"] is False
    assert v["perTaskTestCmds"] == [
        {"cmd": NODE_A, "runner": "node", "ok": False},
        {"cmd": PYTEST_B, "runner": "python3 -m pytest", "ok": True},
    ]
    assert_no_probe_left(repo)


# --- leg (i): the pytest runner is probed once, as `-m pytest --version` -----

def test_a_pytest_runner_that_exits_nonzero_is_red_and_probed_once(tmp_path):
    repo = make_repo(tmp_path)
    log = tmp_path / "python3-red.log"
    env = shim_env(tmp_path, "python3", log, exit_code=3,
                   only_args="-m pytest --version")
    args_path = write_args(repo, [entry("1", testCmd=NODE_A),
                                  entry("2", testCmd=PYTEST_B),
                                  entry("3", testCmd=PYTEST_C)])
    r = validate(repo, args_path, env=env)
    assert r.returncode == 1, r.stdout + r.stderr
    v = json.loads(r.stdout)
    assert v["ok"] is False
    assert v["perTaskTestCmds"] == [
        {"cmd": NODE_A, "runner": "node", "ok": True},
        {"cmd": PYTEST_B, "runner": "python3 -m pytest", "ok": False},
        {"cmd": PYTEST_C, "runner": "python3 -m pytest", "ok": False},
    ]
    assert [argv for _cwd, argv in calls(log)] == ["-m pytest --version"]
    assert_no_probe_left(repo)


# --- the third runner: `bun test` (the greenfield stack's exam) --------------
# Grep found the compiler's consumer of the shape (#642) and not this table:
# run-2 on ultrapowers-walk (2026-09-04) died at preflight, every `bun test`
# command `"runner": null, "ok": false`. A stub `bun` keeps this offline and
# green on a CI runner that has no Bun.

BUN_A = "bun test tests/count.test.ts"
BUN_B = "bun test tests/reverse.test.ts tests/palindrome.test.ts"


def stub_bun(tmp_path, log, exit_code=0):
    bin_dir = tmp_path / "stub-bun"
    bin_dir.mkdir()
    stub = bin_dir / "bun"
    stub.write_text("#!/bin/sh\n"
                    "printf '%s\\t%s\\n' \"$(pwd -P)\" \"$*\" >> " + json.dumps(str(log)) + "\n"
                    "echo 1.4.0\nexit " + str(exit_code) + "\n")
    stub.chmod(stub.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    return dict(os.environ, PATH=str(bin_dir) + os.pathsep + os.environ["PATH"])


def test_bun_test_commands_probe_bun_version_once(tmp_path):
    repo = make_repo(tmp_path)
    log = tmp_path / "bun.log"
    args_path = write_args(repo, [entry("1", testCmd=BUN_A), entry("2", testCmd=BUN_B)])
    r = validate(repo, args_path, env=stub_bun(tmp_path, log))
    assert r.returncode == 0, r.stdout + r.stderr
    v = json.loads(r.stdout)
    assert v["ok"] is True
    assert v["perTaskTestCmds"] == [
        {"cmd": BUN_A, "runner": "bun test", "ok": True},
        {"cmd": BUN_B, "runner": "bun test", "ok": True},
    ]
    assert [argv for _, argv in calls(log)] == ["--version"], "one probe for two commands"
    assert_no_probe_left(repo)


def test_a_bun_that_will_not_start_is_red_and_the_node_slot_stays_green(tmp_path):
    repo = make_repo(tmp_path)
    log = tmp_path / "bun.log"
    args_path = write_args(repo, [entry("1", testCmd=BUN_A), entry("2", testCmd=NODE_A)])
    r = validate(repo, args_path, env=stub_bun(tmp_path, log, exit_code=1))
    assert r.returncode == 1, r.stdout + r.stderr
    v = json.loads(r.stdout)
    assert v["ok"] is False
    assert v["perTaskTestCmds"] == [
        {"cmd": BUN_A, "runner": "bun test", "ok": False},
        {"cmd": NODE_A, "runner": "node", "ok": True},
    ]
    assert_no_probe_left(repo)


# --- Task 1 / #770: the run-wide testCmd's runner, under `--no-baseline` -----
# With the flag the preflight stops running the run-wide test command and
# probes its runner instead — the same `runner_for` table and the same probe
# worktree #234 already uses, reported under its own key `testCmdRunner`
# (one object, not a list: it is one command) and never merged into
# `perTaskTestCmds`, whose item count the legs above pin exactly.

NODE_X = "node fleet/tests/test_x.mjs"
ABSENT_RUNNER_CMD = "no-such-runner-770 tests/"


def test_no_baseline_probes_the_run_wide_runner_in_the_probe_worktree(tmp_path):
    """Leg (g) [M2]: `testCmdRunner` is the one {cmd, runner, ok} object, its
    probe is a `--version` call made inside the wt-knob-* worktree, and the
    test command itself is never run."""
    repo = make_repo(tmp_path)
    log = tmp_path / "node-nobaseline.log"
    env = shim_env(tmp_path, "node", log)
    args_path = write_args(repo, [entry("1")], testCmd=NODE_X)
    r = validate(repo, args_path, "--no-baseline", env=env)
    assert r.returncode == 0, r.stdout + r.stderr
    v = json.loads(r.stdout)
    assert v["ok"] is True
    assert isinstance(v["testCmdRunner"], dict), "one object, not a list"
    assert v["testCmdRunner"] == {"cmd": NODE_X, "runner": "node", "ok": True}
    recorded = calls(log)
    assert [argv for _cwd, argv in recorded] == ["--version"]
    cwd = pathlib.Path(recorded[0][0])
    assert cwd.name.startswith("wt-knob-")
    assert cwd.parent == (repo / ".claude/ultrapowers").resolve()
    # M1/M2: the runner was probed, the suite was not run.
    assert not any("test_x.mjs" in line for line in log.read_text().splitlines())
    assert_no_probe_left(repo)                   # leg (l) [M5]


def test_no_baseline_reds_a_run_wide_runner_that_does_not_resolve(tmp_path):
    """Leg (h) [M2]: a runner the table does not know is its first word,
    probed for resolution on PATH; one that resolves nowhere is red and
    carries the line to exit 1."""
    repo = make_repo(tmp_path)
    args_path = write_args(repo, [entry("1")], testCmd=ABSENT_RUNNER_CMD)
    r = validate(repo, args_path, "--no-baseline")
    assert r.returncode == 1, r.stdout + r.stderr
    v = json.loads(r.stdout)
    assert v["ok"] is False
    assert v["testCmdRunner"] == {"cmd": ABSENT_RUNNER_CMD,
                                  "runner": "no-such-runner-770", "ok": False}
    assert_no_probe_left(repo)                   # leg (l) [M5]


def test_no_baseline_reds_a_run_wide_runner_whose_probe_exits_nonzero(tmp_path):
    """Leg (i) [M2]: a runner that resolves but will not start is red too —
    the probe's exit code is the verdict, fail-closed."""
    repo = make_repo(tmp_path)
    log = tmp_path / "node-probe-red.log"
    env = shim_env(tmp_path, "node", log, exit_code=3, only_args="--version")
    args_path = write_args(repo, [entry("1")], testCmd=NODE_X)
    r = validate(repo, args_path, "--no-baseline", env=env)
    assert r.returncode == 1, r.stdout + r.stderr
    v = json.loads(r.stdout)
    assert v["ok"] is False
    assert v["testCmdRunner"]["ok"] is False
    assert v["testCmdRunner"]["cmd"] == NODE_X
    assert v["testCmdRunner"]["runner"] == "node"
    assert_no_probe_left(repo)                   # leg (l) [M5]


def test_no_baseline_without_a_run_wide_test_cmd_carries_no_runner_key(tmp_path):
    """Leg (j) [M2]: `testCmdRunner` is additive — an args file with only
    per-task commands keeps the BASE shape, `perTaskTestCmds` and no more."""
    repo = make_repo(tmp_path)
    args_path = write_args(repo, [entry("1", testCmd=NODE_A),
                                  entry("2", testCmd=PYTEST_B)])
    r = validate(repo, args_path, "--no-baseline")
    assert r.returncode == 0, r.stdout + r.stderr
    v = json.loads(r.stdout)
    assert v["ok"] is True
    assert v["perTaskTestCmds"] == [
        {"cmd": NODE_A, "runner": "node", "ok": True},
        {"cmd": PYTEST_B, "runner": "python3 -m pytest", "ok": True},
    ]
    assert "testCmdRunner" not in v
    assert_no_probe_left(repo)                   # leg (l) [M5]


def test_the_flagless_line_carries_no_run_wide_runner_key(tmp_path):
    """Leg (k) [M4]: the same args file as leg (g), flagless — the BASE path
    runs the baseline and prints no `testCmdRunner`."""
    repo = make_repo(tmp_path)
    log = tmp_path / "node-flagless.log"
    env = shim_env(tmp_path, "node", log)
    args_path = write_args(repo, [entry("1")], testCmd=NODE_X)
    r = validate(repo, args_path, env=env)
    assert r.returncode == 0, r.stdout + r.stderr
    v = json.loads(r.stdout)
    assert "testCmdRunner" not in v
    assert v["baseline"]["ok"] is True
    assert_no_probe_left(repo)                   # leg (l) [M5]
