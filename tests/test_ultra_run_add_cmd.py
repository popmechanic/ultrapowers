"""Task 2: the launcher derives the installer's add command beside the
bootstrap, and stamps it only when the plan declares packages.

Claim: launch a plan that declares packages against a target whose tree says
which package manager it uses; the run's arguments name that manager's add
command, for runtime and for development packages, read off the same
lockfile-or-manifest ladder that already picks the install command — and a
plan that declares none leaves the arguments exactly as they are today.

M1. `derive_add_cmds(root)` is file presence only, never runs anything, and
    returns `((add, add_dev), rule)` on the bootstrap ladder's own rungs and
    precedence.
M2. `add_command_stage(args_file, receipt, stage, root)` decides on the args
    file's `dependencies` key alone: absent or both groups empty -> one
    `add-command` row, ok True, `no dependencies declared`, writes nothing,
    returns True; at least one spec and a derived pair -> stamps `addCmd`/
    `addDevCmd` on the args file and `addCmd`/`addDevCmd`/`addCmdSource` on
    the receipt, row ok True, returns True; at least one spec and no pair ->
    row ok False naming the rule (or `no lockfile or manifest`), writes
    nothing, returns False.
M3. `main` calls `add_command_stage` directly after the `bootstrap-command`
    stage and before `dirty-baseline`, and bails when it returns False.

Offline: every M1 rung is file presence in `tmp_path`; the M2 legs call the
stage function in-process against an args file this file writes; the M3 legs
spawn the real driver against a throwaway git repo. The declaring M3 legs
reach the driver without Task 1's compiler through the one seam the driver
has — `sys.executable HERE/compile_plan.py` (`ultra_run.py` 593) — by copying
the driver beside a stub compiler that execs the real one and adds the
`dependencies` key to what it emitted.
"""
import json
import os
import pathlib
import shutil
import subprocess
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "skills/ultrapowers/scripts"
RUN = SCRIPTS / "ultra_run.py"
COMPILER = SCRIPTS / "compile_plan.py"
sys.path.insert(0, str(SCRIPTS))
import ultra_run  # noqa: E402
from ultra_run import add_command_stage, derive_add_cmds  # noqa: E402

FLEET_ENV = dict(os.environ, ULTRAPOWERS_FLEET_RUN="run-test")

# The shared literal Task 1's compiler writes onto the args file, quoted from
# this task's Context: the exam's stub compiler and its in-process args files
# both carry exactly this.
DEPENDENCIES = {"runtime": ["tailwindcss@^4", "@tailwindcss/vite"],
                "dev": ["eslint", "@shadcn/lint"]}

# A one-task claims-v1 plan with no `**Dependencies:**` line — the only
# grammar the compiler speaks, and the smallest body the compile stage
# accepts. Nothing here is about the plan.
PLAN = (
    "# P\n\n**Grammar:** claims-v1\n\n"
    "**Acceptance:** waived — test fixture\n\n"
    "**Claim:** An operator gets an `a` module. (elicited)\n\n"
    "### Task 1: A\n\n**Type:** implementation\n\n"
    "**Files:**\n- Create: `a.py`\n- Test: `tests/test_a.py`\n\n"
    "**Claim:** An operator importing `a` gets its one entry point. (derived)\n"
    "Machine: M1. `a.run()` returns `\"a\"`.\n\n"
    "**Authorized-by:** #1\n\n"
    "**Interfaces:**\n- Consumes: nothing\n- Produces: `run() -> str`\n\n"
    "**Context:** `a.py` is a new one-function module with no registry to update.\n\n"
    "**Proof:**\n- Test: `tests/test_a.py`\n"
    "- The suite asserts `a.run() == \"a\"`. [M1]\n\n"
    "**Stale-if:**\n- path-exists: `a.py`\n"
)

sys.path.insert(0, str(ROOT / "skills/ultrawrite/scripts"))
from extract_gate_input import gate_input, verdicts_path  # noqa: E402


def write_plan(directory, name="plan.md"):
    """Land PLAN and the gate-verdict artifact a claims-v1 plan compiles
    against (spec §4.5), hashed by the gate's own extractor."""
    plan = directory / name
    plan.write_text(PLAN)
    verdicts_path(plan).write_text(json.dumps(
        {"tasks": {"1": {"hash": gate_input(plan, "1")["hash"],
                         "verdict": "pass", "reason": "fixture"}},
         "tally": {"dispatched": 1, "rejected": 0}}))
    return plan


def sh(cmd, cwd=None, env=None):
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, env=env)


def make_repo(tmp_path, files, name="repo"):
    repo = tmp_path / name
    repo.mkdir()
    sh(["git", "init", "-q", "-b", "main"], cwd=repo)
    sh(["git", "config", "user.email", "t@t"], cwd=repo)
    sh(["git", "config", "user.name", "t"], cwd=repo)
    (repo / ".gitignore").write_text(".claude/\nnode_modules/\n")
    write_plan(repo)
    for fname, text in files.items():
        (repo / fname).write_text(text)
    sh(["git", "add", "."], cwd=repo)
    sh(["git", "commit", "-qm", "base"], cwd=repo)
    return repo


def run_driver(repo, *extra, env=None, driver=RUN):
    return sh([sys.executable, str(driver), "plan.md", "--stamp", "t1", *extra],
              cwd=repo, env=env or FLEET_ENV)


def run_dir_files(repo, stamp="t1"):
    """The two files a green run leaves: the args file the engine reads and
    the receipt written to disk (distinct from the driver's stdout copy)."""
    run_dir = repo / ".claude/ultrapowers" / ("run-" + stamp)
    return (json.loads((run_dir / "args.json").read_text()),
            json.loads((run_dir / "receipt.json").read_text()))


def recorder():
    """A `stage` callable of the driver's own shape (`ultra_run.py` 537–540)
    and the rows it appends: `{"stage", "ok", "detail"}`."""
    rows = []

    def stage(name, ok, success="", failure=""):
        rows.append({"stage": name, "ok": bool(ok),
                     "detail": str(success if ok else failure).strip()[-2000:]})
        return bool(ok)

    return stage, rows


def write_args(tmp_path, dependencies="omit", name="args.json"):
    """An args file in the shape the compile stage emits: the keys the
    compiler always writes, plus (unless omitted) the `dependencies` key."""
    obj = {"waves": [], "testCmd": "python3 -m pytest"}
    if dependencies != "omit":
        obj["dependencies"] = dependencies
    path = tmp_path / name
    path.write_text(json.dumps(obj, indent=2))
    return path


def tree(tmp_path, files, name="d"):
    d = tmp_path / name
    d.mkdir()
    for fname, text in files.items():
        (d / fname).write_text(text)
    return d


# === M1: the ladder =========================================================
#
# leg (a): the four JS rungs, one parametrized case each, beside package.json.

@pytest.mark.parametrize("lockfile, pair, rule", [
    ("pnpm-lock.yaml", ("pnpm add", "pnpm add -D"), "pnpm-lockfile"),
    ("bun.lock", ("bun add", "bun add -d"), "bun-lockfile"),
    ("bun.lockb", ("bun add", "bun add -d"), "bun-lockfile"),
    ("package-lock.json", ("npm install --save", "npm install --save-dev"),
     "npm-lockfile"),
])
def test_js_lockfile_rungs(tmp_path, lockfile, pair, rule):
    # [M1, leg a] each JS lockfile beside a package.json derives that
    # manager's runtime/dev add pair and names its rung.
    (tmp_path / "package.json").write_text("{}")
    (tmp_path / lockfile).write_text("")
    assert derive_add_cmds(tmp_path) == (pair, rule)


def test_uv_lock_rung(tmp_path):
    # [M1, leg b] uv.lock alone — no package.json — is the uv rung.
    (tmp_path / "uv.lock").write_text("")
    assert derive_add_cmds(tmp_path) == (("uv add", "uv add --dev"), "uv-lock")


def test_pyproject_tool_uv_rung(tmp_path):
    # [M1, leg b] a pyproject carrying `[tool.uv]` is a uv project with no
    # uv.lock yet — the same `[tool.uv` substring read the bootstrap ladder
    # makes, answering the same pair under its own rule.
    (tmp_path / "pyproject.toml").write_text("[project]\nname='x'\n[tool.uv]\n")
    assert derive_add_cmds(tmp_path) == (
        ("uv add", "uv add --dev"), "pyproject-uv")


def test_bare_package_json_derives_no_pair_but_names_the_rule(tmp_path):
    # [M1, leg c] a lockfile-less package.json names no manager: no pair, and
    # the rule still says which manifest was read.
    (tmp_path / "package.json").write_text("{}")
    assert derive_add_cmds(tmp_path) == (None, "package-json")


def test_requirements_txt_derives_no_pair_but_names_the_rule(tmp_path):
    # [M1, leg c] requirements.txt has no add command; the rule names it.
    (tmp_path / "requirements.txt").write_text("requests\n")
    assert derive_add_cmds(tmp_path) == (None, "requirements-txt")


def test_empty_tree_derives_nothing_at_all(tmp_path):
    # [M1, leg c] no manifest: both halves None.
    assert derive_add_cmds(tmp_path) == (None, None)


def test_js_lockfile_without_a_package_json_is_not_a_js_project(tmp_path):
    # [M1, leg c] a lockfile on its own is not a manifest — the same reading
    # `derive_bootstrap_cmd` makes of the same tree.
    (tmp_path / "bun.lock").write_text("")
    assert derive_add_cmds(tmp_path) == (None, None)


def test_js_precedence_is_pnpm_then_bun_then_npm(tmp_path):
    """[M1, leg d] pnpm over bun over npm — the bootstrap ladder's own
    precedence, so a tree carrying several lockfiles adds packages with the
    manager it installs and tests under."""
    (tmp_path / "package.json").write_text("{}")
    (tmp_path / "pnpm-lock.yaml").write_text("")
    (tmp_path / "bun.lock").write_text("")
    (tmp_path / "package-lock.json").write_text("{}")
    assert derive_add_cmds(tmp_path) == (
        ("pnpm add", "pnpm add -D"), "pnpm-lockfile")

    (tmp_path / "pnpm-lock.yaml").unlink()
    assert derive_add_cmds(tmp_path) == (("bun add", "bun add -d"), "bun-lockfile")

    (tmp_path / "bun.lock").unlink()
    assert derive_add_cmds(tmp_path) == (
        ("npm install --save", "npm install --save-dev"), "npm-lockfile")


def test_the_ladder_never_runs_anything(tmp_path, monkeypatch):
    """[M1] "file presence only, never runs anything": the requirements rung
    is where the bootstrap ladder probes PEP 668, and this ladder must not —
    both the probe and subprocess itself are rigged to explode."""
    def boom(*a, **k):
        raise AssertionError("derive_add_cmds ran a subprocess")

    monkeypatch.setattr(ultra_run, "_pip_externally_managed", boom)
    monkeypatch.setattr(ultra_run.subprocess, "run", boom)
    (tmp_path / "requirements.txt").write_text("requests\n")
    assert derive_add_cmds(tmp_path) == (None, "requirements-txt")
    (tmp_path / "package.json").write_text("{}")
    (tmp_path / "bun.lock").write_text("")
    assert derive_add_cmds(tmp_path) == (("bun add", "bun add -d"), "bun-lockfile")


# === M2: the stage, in process against a real args file =====================

def test_declared_specs_stamp_both_commands(tmp_path):
    """[M2, leg e] the args file carries the shared `dependencies` literal and
    the tree carries package.json + bun.lock: the stage stamps both commands
    on the args file, the three keys on the receipt, and records one green
    `add-command` row naming both commands and the rule."""
    args_file = write_args(tmp_path, DEPENDENCIES)
    before = json.loads(args_file.read_text())
    d = tree(tmp_path, {"package.json": "{}", "bun.lock": ""})
    receipt = {"ok": False, "stamp": "t1"}
    stage, rows = recorder()

    assert add_command_stage(args_file, receipt, stage, d) is True

    after = json.loads(args_file.read_text())
    assert after["addCmd"] == "bun add"
    assert after["addDevCmd"] == "bun add -d"
    # ...and nothing else on the args file moved.
    assert set(after) - set(before) == {"addCmd", "addDevCmd"}
    assert {k: after[k] for k in before} == before
    assert after["dependencies"] == DEPENDENCIES
    assert after["waves"] == []

    assert receipt["addCmd"] == "bun add"
    assert receipt["addDevCmd"] == "bun add -d"
    assert receipt["addCmdSource"] == "detected:bun-lockfile"

    assert len(rows) == 1
    assert rows[0]["stage"] == "add-command"
    assert rows[0]["ok"] is True
    assert "bun add" in rows[0]["detail"]
    assert "bun add -d" in rows[0]["detail"]
    assert "bun-lockfile" in rows[0]["detail"]


def test_one_non_empty_group_stamps_both_commands(tmp_path):
    """[M2, leg e] both keys are always written together when either group is
    non-empty — the engine chooses which to run from the groups, never from
    which key is present."""
    args_file = write_args(tmp_path, {"runtime": [], "dev": ["eslint"]})
    d = tree(tmp_path, {"package.json": "{}", "bun.lock": ""})
    receipt = {"ok": False, "stamp": "t1"}
    stage, rows = recorder()

    assert add_command_stage(args_file, receipt, stage, d) is True

    after = json.loads(args_file.read_text())
    assert after["addCmd"] == "bun add"
    assert after["addDevCmd"] == "bun add -d"
    assert receipt["addCmd"] == "bun add"
    assert receipt["addDevCmd"] == "bun add -d"
    assert receipt["addCmdSource"] == "detected:bun-lockfile"
    assert [r["stage"] for r in rows] == ["add-command"]
    assert rows[0]["ok"] is True


@pytest.mark.parametrize("dependencies", ["omit", {"runtime": [], "dev": []}])
def test_no_declared_specs_writes_nothing(tmp_path, dependencies):
    """[M2, leg f] no `dependencies` key, or both groups empty: the stage is a
    green no-op — the args file's bytes and the receipt's keys are exactly
    what they were, whatever the tree would have derived."""
    args_file = write_args(tmp_path, dependencies)
    before = args_file.read_bytes()
    d = tree(tmp_path, {"package.json": "{}", "bun.lock": ""})
    receipt = {"ok": False, "stamp": "t1"}
    stage, rows = recorder()

    assert add_command_stage(args_file, receipt, stage, d) is True

    assert args_file.read_bytes() == before
    for key in ("addCmd", "addDevCmd", "addCmdSource"):
        assert key not in receipt
    assert len(rows) == 1
    assert rows[0]["stage"] == "add-command"
    assert rows[0]["ok"] is True
    assert "no dependencies declared" in rows[0]["detail"]


def test_declared_specs_with_no_derivable_pair_refuse(tmp_path):
    """[M2, leg g] a plan declaring packages against a tree no rung can add
    to: the stage is red, names the rule it read, and writes nothing."""
    args_file = write_args(tmp_path, DEPENDENCIES)
    before = args_file.read_bytes()
    d = tree(tmp_path, {"package.json": "{}"})
    receipt = {"ok": False, "stamp": "t1"}
    stage, rows = recorder()

    assert add_command_stage(args_file, receipt, stage, d) is False

    assert args_file.read_bytes() == before
    for key in ("addCmd", "addDevCmd", "addCmdSource"):
        assert key not in receipt
    assert len(rows) == 1
    assert rows[0]["stage"] == "add-command"
    assert rows[0]["ok"] is False
    assert "package-json" in rows[0]["detail"]


def test_declared_specs_against_a_manifest_less_tree_refuse(tmp_path):
    """[M2, leg g] the same refusal with no manifest at all to name: the
    detail says so instead of naming a rule."""
    args_file = write_args(tmp_path, DEPENDENCIES)
    before = args_file.read_bytes()
    d = tree(tmp_path, {})
    receipt = {"ok": False, "stamp": "t1"}
    stage, rows = recorder()

    assert add_command_stage(args_file, receipt, stage, d) is False

    assert args_file.read_bytes() == before
    for key in ("addCmd", "addDevCmd", "addCmdSource"):
        assert key not in receipt
    assert len(rows) == 1
    assert rows[0]["stage"] == "add-command"
    assert rows[0]["ok"] is False
    assert "no lockfile or manifest" in rows[0]["detail"]


# === M3: the driver ========================================================
#
# The declaring legs need an args file carrying the `dependencies` key Task 1's
# compiler writes — absent from this clone. The driver's one seam is
# `sh([sys.executable, str(HERE / "compile_plan.py")] + compile_argv(...))`
# (`ultra_run.py` 593, `HERE` is the driver file's own directory and has no
# other use), so the driver is copied beside a stub compiler that execs the
# real one by absolute path with the same argv and then adds the literal to
# the args file it emitted and to the JSON it printed.

STUB_COMPILER = '''#!/usr/bin/env python3
"""Stands in for Task 1's compiler: runs the real one, then declares."""
import json
import subprocess
import sys

REAL = %r
DEPENDENCIES = %s

argv = sys.argv[1:]
r = subprocess.run([sys.executable, REAL, *argv], capture_output=True, text=True)
sys.stderr.write(r.stderr)
if r.returncode != 0:
    sys.stdout.write(r.stdout)
    sys.exit(r.returncode)

args_path = argv[argv.index("--emit-args") + 1]
obj = json.loads(open(args_path).read())
obj["dependencies"] = DEPENDENCIES
open(args_path, "w").write(json.dumps(obj, indent=2))

printed = json.loads(r.stdout)
printed["dependencies"] = DEPENDENCIES
print(json.dumps(printed, indent=2))
'''


def declaring_driver(tmp_path, dependencies=None, name="driver"):
    """A copy of `ultra_run.py` whose `HERE / "compile_plan.py"` is the stub."""
    d = tmp_path / name
    d.mkdir()
    shutil.copy2(RUN, d / "ultra_run.py")
    (d / "compile_plan.py").write_text(STUB_COMPILER % (
        str(COMPILER),
        json.dumps(DEPENDENCIES if dependencies is None else dependencies)))
    return d / "ultra_run.py"


def row_after(stages, name):
    """The stages row directly after the named one."""
    names = [s["stage"] for s in stages]
    assert name in names, names
    i = names.index(name)
    assert i + 1 < len(stages), names
    return stages[i + 1]


def test_driver_runs_the_stage_on_a_plan_that_declares_nothing(tmp_path):
    """[M3, leg h] the real driver, a plan with no `**Dependencies:**` line:
    the `add-command` row sits directly after `bootstrap-command` and before
    `dirty-baseline` on every run, green and declaring nothing, and not one
    of the three keys is stamped anywhere."""
    repo = make_repo(tmp_path, {"package.json": "{}", "bun.lock": ""})
    r = run_driver(repo, "--test-cmd", "true")
    assert r.returncode == 0, r.stdout + r.stderr
    receipt = json.loads(r.stdout)

    stages = receipt["stages"]
    add = row_after(stages, "bootstrap-command")
    assert add["stage"] == "add-command"
    assert add["ok"] is True
    assert "no dependencies declared" in add["detail"]
    assert row_after(stages, "add-command")["stage"] == "dirty-baseline"

    args, disk_receipt = run_dir_files(repo)
    for key in ("addCmd", "addDevCmd", "addCmdSource"):
        assert key not in args
        assert key not in receipt
        assert key not in disk_receipt


def test_driver_stamps_the_derived_add_commands_for_a_declaring_plan(tmp_path):
    """[M3, leg i] the copied driver beside the stub compiler, against a
    package.json + bun.lock repo: both commands land on the args file the
    engine reads, and all three keys land on the receipt — stdout and disk."""
    repo = make_repo(tmp_path, {"package.json": "{}", "bun.lock": ""})
    driver = declaring_driver(tmp_path)
    r = run_driver(repo, "--test-cmd", "true", driver=driver)
    assert r.returncode == 0, r.stdout + r.stderr
    receipt = json.loads(r.stdout)

    args, disk_receipt = run_dir_files(repo)
    assert args["dependencies"] == DEPENDENCIES, "the stub declared the packages"
    assert args["addCmd"] == "bun add"
    assert args["addDevCmd"] == "bun add -d"

    for obj in (receipt, disk_receipt):
        assert obj["addCmd"] == "bun add"
        assert obj["addDevCmd"] == "bun add -d"
        assert obj["addCmdSource"] == "detected:bun-lockfile"

    add = row_after(receipt["stages"], "bootstrap-command")
    assert add["stage"] == "add-command"
    assert add["ok"] is True
    assert "bun add" in add["detail"]
    assert "bun add -d" in add["detail"]
    assert "bun-lockfile" in add["detail"]


def test_driver_refuses_a_declaring_plan_no_rung_can_add(tmp_path):
    """[M3, leg j] the same copied driver against a bare package.json: the
    run exits non-zero at the `add-command` stage, writes no `receipt.json`,
    and never reaches `dirty-baseline`."""
    repo = make_repo(tmp_path, {"package.json": "{}"})
    driver = declaring_driver(tmp_path)
    r = run_driver(repo, "--test-cmd", "true", driver=driver)
    assert r.returncode != 0, r.stdout + r.stderr

    run_dir = repo / ".claude/ultrapowers/run-t1"
    assert not (run_dir / "receipt.json").exists()

    receipt = json.loads(r.stdout)
    assert receipt["ok"] is False
    stages = receipt["stages"]
    assert stages[-1]["stage"] == "add-command"
    assert stages[-1]["ok"] is False
    assert "package-json" in stages[-1]["detail"]
    assert "dirty-baseline" not in [s["stage"] for s in stages]
