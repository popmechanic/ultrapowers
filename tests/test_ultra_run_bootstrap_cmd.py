"""run-66 (2026-09-03): `knob-validate-failed` before wave 1 — the smoke repo's
suite was RED at BASE because nothing ran `bun install`. The driver had a
`bootstrapCmd` knob all along (rehearsed in a probe worktree, provisioned in
every clone, handed to the gate) but nothing DERIVED it.

`ultra_run.derive_bootstrap_cmd(root)` is that derivation — one table, in
Python, beside the test-command ladder it mirrors. It is the DEFAULT for the
knob: an explicit `--bootstrap-cmd` wins, `--bootstrap-cmd ''` disables.
`fleet/run-main.mjs` forwards the knob as given (the '' included) and derives
nothing itself.

Offline: every rung is file presence in `tmp_path`; the PEP 668 probe is
monkeypatched where its answer is the leg; the end-to-end legs spawn the
real driver against a throwaway git repo with a PATH-front `npm` shim.
"""
import json
import os
import pathlib
import stat
import subprocess
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "skills/ultrapowers/scripts"
RUN = SCRIPTS / "ultra_run.py"
sys.path.insert(0, str(SCRIPTS))
import ultra_run  # noqa: E402
from ultra_run import derive_bootstrap_cmd, derive_regenerate_cmd  # noqa: E402

FLEET_ENV = dict(os.environ, ULTRAPOWERS_FLEET_RUN="run-test")

# A one-task claims-v1 plan — the only grammar the compiler speaks. Nothing
# here is about the plan: it is the smallest body the compile stage accepts.
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


def make_repo(tmp_path, files):
    repo = tmp_path / "repo"
    repo.mkdir()
    sh(["git", "init", "-q", "-b", "main"], cwd=repo)
    sh(["git", "config", "user.email", "t@t"], cwd=repo)
    sh(["git", "config", "user.name", "t"], cwd=repo)
    (repo / ".gitignore").write_text(".claude/\nnode_modules/\n")
    write_plan(repo)
    for name, text in files.items():
        (repo / name).write_text(text)
    sh(["git", "add", "."], cwd=repo)
    sh(["git", "commit", "-qm", "base"], cwd=repo)
    return repo


def run_driver(repo, *extra, env=None):
    return sh([sys.executable, str(RUN), "plan.md", "--stamp", "t1", *extra],
              cwd=repo, env=env or FLEET_ENV)


# --- the table, one leg per rung -------------------------------------------

def test_no_manifest_derives_nothing(tmp_path):
    assert derive_bootstrap_cmd(tmp_path) == (None, None)


@pytest.mark.parametrize("lockfile", ["bun.lock", "bun.lockb"])
def test_bun_lockfile_rung(tmp_path, lockfile):
    (tmp_path / "package.json").write_text("{}")
    (tmp_path / lockfile).write_text("")
    assert derive_bootstrap_cmd(tmp_path) == (
        "bun install --frozen-lockfile", "bun-lockfile")


def test_pnpm_lockfile_rung(tmp_path):
    (tmp_path / "package.json").write_text("{}")
    (tmp_path / "pnpm-lock.yaml").write_text("")
    assert derive_bootstrap_cmd(tmp_path) == (
        "pnpm install --frozen-lockfile", "pnpm-lockfile")


def test_npm_lockfile_rung(tmp_path):
    (tmp_path / "package.json").write_text("{}")
    (tmp_path / "package-lock.json").write_text("{}")
    assert derive_bootstrap_cmd(tmp_path) == ("npm ci", "npm-lockfile")


def test_bare_package_json_rung_does_not_write_a_lockfile(tmp_path):
    # validate_knobs reads any tree mutation as a red bootstrap; a plain
    # `npm install` writes package-lock.json and would fail its own rehearsal.
    (tmp_path / "package.json").write_text("{}")
    cmd, rule = derive_bootstrap_cmd(tmp_path)
    assert (cmd, rule) == ("npm install --no-package-lock", "package-json")


def test_js_precedence_mirrors_detect_test_cmd(tmp_path):
    # pnpm over bun over npm — the same order the test-command ladder uses,
    # so a tree with two lockfiles installs with the runner its suite runs
    # under. A lockfile without package.json is not a JS project.
    (tmp_path / "bun.lock").write_text("")
    (tmp_path / "pnpm-lock.yaml").write_text("")
    (tmp_path / "package-lock.json").write_text("{}")
    assert derive_bootstrap_cmd(tmp_path) == (None, None)
    (tmp_path / "package.json").write_text("{}")
    assert derive_bootstrap_cmd(tmp_path)[1] == "pnpm-lockfile"
    (tmp_path / "pnpm-lock.yaml").unlink()
    assert derive_bootstrap_cmd(tmp_path)[1] == "bun-lockfile"
    (tmp_path / "bun.lock").unlink()
    assert derive_bootstrap_cmd(tmp_path)[1] == "npm-lockfile"


def test_uv_lock_rung(tmp_path):
    (tmp_path / "uv.lock").write_text("")
    assert derive_bootstrap_cmd(tmp_path) == ("uv sync", "uv-lock")


def test_pyproject_tool_uv_rung(tmp_path):
    (tmp_path / "pyproject.toml").write_text("[project]\nname='x'\n[tool.uv]\n")
    assert derive_bootstrap_cmd(tmp_path) == ("uv sync", "pyproject-uv")
    (tmp_path / "pyproject.toml").write_text("[project]\nname='x'\n")
    assert derive_bootstrap_cmd(tmp_path) == (None, None)


def test_requirements_txt_rung_when_pip_is_free(tmp_path, monkeypatch):
    monkeypatch.setattr(ultra_run, "_pip_externally_managed", lambda: False)
    (tmp_path / "requirements.txt").write_text("requests\n")
    assert derive_bootstrap_cmd(tmp_path) == (
        "python3 -m pip install -r requirements.txt", "requirements-txt")


def test_requirements_txt_refused_under_pep_668(tmp_path, monkeypatch):
    # A distro python3 (the sandbox's) refuses `pip install` outside a venv;
    # deriving one would make the bootstrap the thing that reddens preflight.
    # The rule still names the manifest so the receipt can say why.
    monkeypatch.setattr(ultra_run, "_pip_externally_managed", lambda: True)
    (tmp_path / "requirements.txt").write_text("requests\n")
    assert derive_bootstrap_cmd(tmp_path) == (
        None, "requirements-txt-externally-managed")


def test_uv_wins_over_requirements_txt(tmp_path, monkeypatch):
    monkeypatch.setattr(ultra_run, "_pip_externally_managed", lambda: False)
    (tmp_path / "requirements.txt").write_text("requests\n")
    (tmp_path / "uv.lock").write_text("")
    assert derive_bootstrap_cmd(tmp_path) == ("uv sync", "uv-lock")


def test_pep_668_probe_asks_the_path_python3(tmp_path):
    """The probe consults the `python3` on PATH — the interpreter a derived
    `python3 -m pip` would run — and fails closed when it cannot answer."""
    assert ultra_run._pip_externally_managed() in (True, False)
    fb = tmp_path / "fakebin"
    fb.mkdir()
    stub = fb / "python3"
    stub.write_text("#!/bin/sh\nexit 7\n")
    stub.chmod(stub.stat().st_mode | stat.S_IEXEC)
    saved = os.environ.get("PATH", "")
    os.environ["PATH"] = str(fb) + os.pathsep + saved
    try:
        assert ultra_run._pip_externally_managed() is True
    finally:
        os.environ["PATH"] = saved


# --- the knob: derived by default, explicit wins, '' disables ---------------

def test_preflight_derives_the_bootstrap_by_default(tmp_path):
    repo = make_repo(tmp_path, {"package.json": '{"scripts": {"test": "bun test"}}',
                                "bun.lock": ""})
    r = run_driver(repo)
    assert r.returncode == 0, r.stdout + r.stderr
    receipt = json.loads(r.stdout)
    assert receipt["testCmd"] == "bun run test"            # #600, same rung
    assert receipt["bootstrapCmd"] == "bun install --frozen-lockfile"
    assert receipt["bootstrapCmdSource"] == "detected:bun-lockfile"
    stage = [s for s in receipt["stages"] if s["stage"] == "bootstrap-command"][0]
    assert stage["ok"] is True
    assert stage["detail"] == "bun install --frozen-lockfile (detected:bun-lockfile)"
    args = json.loads((repo / ".claude/ultrapowers/run-t1/args.json").read_text())
    assert args["bootstrapCmd"] == "bun install --frozen-lockfile"


def test_explicit_bootstrap_cmd_wins_over_derivation(tmp_path):
    repo = make_repo(tmp_path, {"package.json": "{}", "bun.lock": ""})
    r = run_driver(repo, "--test-cmd", "true", "--bootstrap-cmd", "make deps")
    assert r.returncode == 0, r.stdout + r.stderr
    receipt = json.loads(r.stdout)
    assert receipt["bootstrapCmd"] == "make deps"
    assert receipt["bootstrapCmdSource"] == "knob"
    args = json.loads((repo / ".claude/ultrapowers/run-t1/args.json").read_text())
    assert args["bootstrapCmd"] == "make deps"


@pytest.mark.parametrize("knob", ["", "   "])
def test_empty_bootstrap_cmd_disables_derivation(tmp_path, knob):
    repo = make_repo(tmp_path, {"package.json": "{}", "bun.lock": ""})
    r = run_driver(repo, "--test-cmd", "true", "--bootstrap-cmd", knob)
    assert r.returncode == 0, r.stdout + r.stderr
    receipt = json.loads(r.stdout)
    assert "bootstrapCmd" not in receipt
    assert "bootstrapCmdSource" not in receipt
    stage = [s for s in receipt["stages"] if s["stage"] == "bootstrap-command"][0]
    assert stage["ok"] is True
    assert "disables" in stage["detail"]
    args = json.loads((repo / ".claude/ultrapowers/run-t1/args.json").read_text())
    assert "bootstrapCmd" not in args


def test_receipt_names_the_pep_668_refusal(tmp_path):
    repo = make_repo(tmp_path, {"requirements.txt": "requests\n"})
    fb = tmp_path / "fakebin"
    fb.mkdir()
    # A python3 whose stdlib claims EXTERNALLY-MANAGED: the probe prints 1.
    stub = fb / "python3"
    stub.write_text("#!/bin/sh\ncase \"$*\" in *EXTERNALLY-MANAGED*) echo 1 ;; "
                    "*) exec %s \"$@\" ;; esac\n" % sys.executable)
    stub.chmod(stub.stat().st_mode | stat.S_IEXEC)
    env = dict(FLEET_ENV, PATH=str(fb) + os.pathsep + os.environ.get("PATH", ""))
    r = run_driver(repo, "--test-cmd", "true", env=env)
    assert r.returncode == 0, r.stdout + r.stderr
    receipt = json.loads(r.stdout)
    assert "bootstrapCmd" not in receipt
    stage = [s for s in receipt["stages"] if s["stage"] == "bootstrap-command"][0]
    assert "PEP 668" in stage["detail"]


# --- the derived bootstrap is rehearsed: probe worktree, then the suite -----

def test_derived_bootstrap_runs_in_the_probe_worktree_before_the_suite(tmp_path):
    """run-66's failure mode, end to end: the driver stamps the derived
    `npm ci`, and `--validate-knobs` runs it in the throwaway worktree BEFORE
    the run-wide suite — so a suite that is red until dependencies land is
    green at validation. The `npm` on PATH is a shim that records where it
    was invoked; the suite is a probe for that record."""
    repo = make_repo(tmp_path, {"package.json": "{}", "package-lock.json": "{}"})
    log = tmp_path / "npm-calls.log"
    fb = tmp_path / "fakebin"
    fb.mkdir()
    npm = fb / "npm"
    npm.write_text("#!/bin/sh\necho \"$PWD $*\" >> '%s'\n" % log)
    npm.chmod(npm.stat().st_mode | stat.S_IEXEC)
    env = dict(FLEET_ENV, PATH=str(fb) + os.pathsep + os.environ.get("PATH", ""))
    suite = "test -s '%s'" % log            # red until the bootstrap has run
    r = run_driver(repo, "--test-cmd", suite, env=env)
    assert r.returncode == 0, r.stdout + r.stderr
    receipt = json.loads(r.stdout)
    assert receipt["bootstrapCmd"] == "npm ci"
    assert not log.exists(), "the launch pipeline stamps the knob; it never runs it"

    args_path = pathlib.Path(receipt["argsFile"])
    assert json.loads(args_path.read_text())["bootstrapCmd"] == "npm ci"
    v = sh([sys.executable, str(RUN), "--validate-knobs", str(args_path)],
           cwd=repo, env=env)
    assert v.returncode == 0, v.stdout + v.stderr
    verdict = json.loads(v.stdout)
    assert verdict["ok"] is True
    assert verdict["exit"] == 0 and verdict["treeClean"] is True
    assert verdict["baseline"]["ok"] is True, "the suite ran after the install"
    calls = log.read_text().splitlines()
    assert len(calls) == 1
    cwd, argv = calls[0].split(" ", 1)
    assert argv == "ci"
    assert "/.claude/ultrapowers/wt-knob-" in cwd, cwd   # the probe, never the checkout
    assert not list((repo / ".claude/ultrapowers").glob("wt-knob-*"))


# === Task A: the launcher derives the regenerator beside the bootstrap ======
#
# Every JS rung of `derive_bootstrap_cmd` above is FROZEN (`--frozen-lockfile`,
# `npm ci`), which is why rebuilding a lockfile from merged manifests is a
# SECOND command and not the bootstrap re-run. `derive_regenerate_cmd(root)`
# is that second ladder: the same rungs, the same precedence, file presence
# only, returning `(command, rule)`.
#
# M1. `derive_regenerate_cmd(root)` answers by file presence alone, mirroring
#     `derive_bootstrap_cmd`'s rungs and precedence.
# M2. The preflight writes `regenerateCmd` into the args file, and
#     `regenerateCmd` + `regenerateCmdSource` (`detected:<rule>`) into
#     `receipt.json`, exactly when a command was derived — neither key when
#     none was, and none derived at all when `--bootstrap-cmd ''` disabled
#     bootstrap derivation.


def run_dir_files(repo, stamp="t1"):
    """The two files M2 stamps, read off disk. The leg names `receipt.json`,
    so this reads the written receipt rather than the driver's stdout copy."""
    run_dir = repo / ".claude/ultrapowers" / ("run-" + stamp)
    return (json.loads((run_dir / "args.json").read_text()),
            json.loads((run_dir / "receipt.json").read_text()))


# --- leg (a) [M1]: the six derived rungs, one tree each ---------------------

def test_regenerate_pnpm_lockfile_rung(tmp_path):
    # [M1, leg a] package.json + pnpm-lock.yaml -> the unfrozen pnpm install.
    (tmp_path / "package.json").write_text("{}")
    (tmp_path / "pnpm-lock.yaml").write_text("")
    assert derive_regenerate_cmd(tmp_path) == (
        "pnpm install --no-frozen-lockfile", "pnpm-lockfile")


@pytest.mark.parametrize("lockfile", ["bun.lock", "bun.lockb"])
def test_regenerate_bun_lockfile_rung(tmp_path, lockfile):
    # [M1, leg a] both bun lockfile spellings are the same rung: `bun install`
    # with no --frozen-lockfile, which rewrites the lockfile from package.json.
    (tmp_path / "package.json").write_text("{}")
    (tmp_path / lockfile).write_text("")
    assert derive_regenerate_cmd(tmp_path) == ("bun install", "bun-lockfile")


def test_regenerate_npm_lockfile_rung(tmp_path):
    # [M1, leg a] package-lock.json -> the lockfile-only npm install.
    (tmp_path / "package.json").write_text("{}")
    (tmp_path / "package-lock.json").write_text("{}")
    assert derive_regenerate_cmd(tmp_path) == (
        "npm install --package-lock-only", "npm-lockfile")


def test_regenerate_uv_lock_rung(tmp_path):
    # [M1, leg a] no package.json, uv.lock present -> `uv lock`.
    (tmp_path / "uv.lock").write_text("")
    assert derive_regenerate_cmd(tmp_path) == ("uv lock", "uv-lock")


def test_regenerate_pyproject_tool_uv_rung(tmp_path):
    # [M1, leg a] a pyproject carrying [tool.uv] is a uv project even with no
    # uv.lock yet — the same `[tool.uv` sniff the bootstrap ladder uses.
    (tmp_path / "pyproject.toml").write_text("[project]\nname='x'\n[tool.uv]\n")
    assert derive_regenerate_cmd(tmp_path) == ("uv lock", "pyproject-uv")


# --- leg (b) [M1]: the rows that derive no command -------------------------

def test_regenerate_bare_package_json_derives_nothing_but_names_the_rule(tmp_path):
    # [M1, leg b] a lockfile-less package.json has no lockfile to rebuild —
    # the bootstrap's own `--no-package-lock` rung says as much. The rule is
    # still named, so a receipt could answer why nothing was derived.
    (tmp_path / "package.json").write_text("{}")
    assert derive_regenerate_cmd(tmp_path) == (None, "package-json")


def test_regenerate_empty_tree_derives_nothing(tmp_path):
    # [M1, leg b] no manifest at all: both halves None.
    assert derive_regenerate_cmd(tmp_path) == (None, None)


def test_regenerate_requirements_txt_tree_derives_nothing(tmp_path):
    # [M1, leg b] requirements.txt is not a lockfile and pins no resolution —
    # it is a (None, None) tree here even though the bootstrap ladder has a
    # requirements rung. No PEP 668 probe is involved on this ladder.
    (tmp_path / "requirements.txt").write_text("requests\n")
    assert derive_regenerate_cmd(tmp_path) == (None, None)


# --- leg (c) [M1]: precedence, the same order as the bootstrap ladder -------

def test_regenerate_js_precedence_mirrors_the_bootstrap_ladder(tmp_path):
    """[M1, leg c] pnpm over bun over npm — the same order
    `derive_bootstrap_cmd` answers on the same trees, so a tree carrying two
    lockfiles regenerates with the runner it installs and tests under."""
    (tmp_path / "package.json").write_text("{}")
    (tmp_path / "pnpm-lock.yaml").write_text("")
    (tmp_path / "bun.lock").write_text("")
    (tmp_path / "package-lock.json").write_text("{}")
    assert derive_regenerate_cmd(tmp_path) == (
        "pnpm install --no-frozen-lockfile", "pnpm-lockfile")
    assert derive_regenerate_cmd(tmp_path)[1] == derive_bootstrap_cmd(tmp_path)[1]

    (tmp_path / "pnpm-lock.yaml").unlink()
    assert derive_regenerate_cmd(tmp_path) == ("bun install", "bun-lockfile")
    assert derive_regenerate_cmd(tmp_path)[1] == derive_bootstrap_cmd(tmp_path)[1]


# --- legs (d) and (e) [M2]: what the preflight stamps -----------------------

def test_preflight_stamps_the_derived_regenerate_cmd(tmp_path):
    """[M2, leg d] a repository carrying package.json and bun.lock: the args
    file gets `regenerateCmd` (the key `fleet/run-engine.mjs` reads as
    `args.regenerateCmd`, beside `args.bootstrapCmd`), and receipt.json gets
    `regenerateCmd` with `regenerateCmdSource` naming the rule."""
    repo = make_repo(tmp_path, {"package.json": "{}", "bun.lock": ""})
    r = run_driver(repo, "--test-cmd", "true")
    assert r.returncode == 0, r.stdout + r.stderr
    args, receipt = run_dir_files(repo)
    assert args["regenerateCmd"] == "bun install"
    assert receipt["regenerateCmd"] == "bun install"
    assert receipt["regenerateCmdSource"] == "detected:bun-lockfile"
    # ...beside, not instead of, the frozen bootstrap this run still installs with.
    assert receipt["bootstrapCmd"] == "bun install --frozen-lockfile"


def test_preflight_stamps_no_regenerate_cmd_without_a_lockfile(tmp_path):
    """[M2, leg e] a requirements.txt-only repository derives no regenerator,
    so neither key is written into either file."""
    repo = make_repo(tmp_path, {"requirements.txt": "requests\n"})
    r = run_driver(repo, "--test-cmd", "true")
    assert r.returncode == 0, r.stdout + r.stderr
    args, receipt = run_dir_files(repo)
    assert "regenerateCmd" not in args
    assert "regenerateCmd" not in receipt
    assert "regenerateCmdSource" not in receipt


def test_preflight_stamps_no_regenerate_cmd_for_a_bare_package_json(tmp_path):
    """[M2] the discriminating row for "exactly when a command was derived":
    a bare package.json DOES derive a bootstrap (`npm install
    --no-package-lock`) and does NOT derive a regenerator, so the regenerator
    keys cannot ride on the bootstrap's own truth guard."""
    repo = make_repo(tmp_path, {"package.json": "{}"})
    r = run_driver(repo, "--test-cmd", "true")
    assert r.returncode == 0, r.stdout + r.stderr
    args, receipt = run_dir_files(repo)
    assert receipt["bootstrapCmd"] == "npm install --no-package-lock"
    assert "regenerateCmd" not in args
    assert "regenerateCmd" not in receipt
    assert "regenerateCmdSource" not in receipt


@pytest.mark.parametrize("knob", ["", "   "])
def test_disabled_bootstrap_derives_no_regenerate_cmd(tmp_path, knob):
    """[M2, leg e] `--bootstrap-cmd ''` disables bootstrap derivation, and no
    regenerator is derived or written either — the operator who overrides the
    install owns its lockfile."""
    repo = make_repo(tmp_path, {"package.json": "{}", "bun.lock": ""})
    r = run_driver(repo, "--test-cmd", "true", "--bootstrap-cmd", knob)
    assert r.returncode == 0, r.stdout + r.stderr
    args, receipt = run_dir_files(repo)
    assert "bootstrapCmd" not in receipt
    assert "regenerateCmd" not in args
    assert "regenerateCmd" not in receipt
    assert "regenerateCmdSource" not in receipt
