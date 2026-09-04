"""ultra_run.py: the deterministic pre-launch driver (SKILL.md Steps 1-4b).
Every stage is exercised against a throwaway git repo; the receipt and exit
code are the contract the orchestrator consumes."""
import json
import os
import pathlib
import subprocess
import sys
import time

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "skills/ultrapowers/scripts"
RUN = SCRIPTS / "ultra_run.py"
sys.path.insert(0, str(SCRIPTS))
import ultra_run  # noqa: E402
from ultra_run import detect_test_cmd  # noqa: E402
from deadline_slack import deadline_budget  # noqa: E402

# End-to-end receipt tests spawn the real driver, so the pytest command they
# see depends on whether pytest-xdist is installed here (#426). Derive the
# expectation from the same probe; the wiring under test is detect -> receipt.
PYTEST_CMD = "python3 -m pytest -n auto" if ultra_run._xdist_available() else "python3 -m pytest"

# One Driver Phase 0: the launch pipeline refuses unless the shim's env var is
# set. Every driver invocation in this file runs as the engine session.
FLEET_ENV = dict(os.environ, ULTRAPOWERS_FLEET_RUN="run-test")

PLAN = (
    "# P\n\n**Acceptance:** waived — test fixture\n\n"
    "### Task 1: A\n\n**Type:** implementation\n**Depends-on:** none\n\n"
    "**Files:**\n- Create: `a.py`\n\n- [ ] **Step 1: do**\n\n"
    "### Task 2: B\n\n**Type:** implementation\n**Depends-on:** 1\n\n"
    "**Files:**\n- Create: `b.py`\n\n- [ ] **Step 1: do**\n"
)


def sh(cmd, cwd=None, check=True, env=None):
    return subprocess.run(cmd, cwd=cwd, check=check, capture_output=True,
                          text=True, env=env)


def make_repo(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    sh(["git", "init", "-q", "-b", "main"], cwd=repo)
    sh(["git", "config", "user.email", "t@t"], cwd=repo)
    sh(["git", "config", "user.name", "t"], cwd=repo)
    (repo / ".gitignore").write_text(".claude/\n")
    (repo / "plan.md").write_text(PLAN)
    (repo / "pytest.ini").write_text("[pytest]\n")
    sh(["git", "add", "."], cwd=repo)
    sh(["git", "commit", "-qm", "base"], cwd=repo)
    return repo


def run_driver(repo, *extra):
    return sh([sys.executable, str(RUN), "plan.md", "--stamp", "t1", *extra],
              cwd=repo, check=False, env=FLEET_ENV)


def test_happy_path_receipt(tmp_path):
    repo = make_repo(tmp_path)
    r = run_driver(repo)
    assert r.returncode == 0, r.stdout + r.stderr
    receipt = json.loads(r.stdout)
    assert receipt["ok"] is True
    assert all(s["ok"] for s in receipt["stages"])
    # The surviving stages, in order. ('install' — the Workflow-harness copy —
    # died at 0.3.0 with waves.js; the engine is fleet/run-engine.mjs, code.
    # 'superpowers-compat' died at #390: the driver depends on no superpowers
    # install, so there is no contract left to check.)
    assert [s["stage"] for s in receipt["stages"]] == [
        "fleet-run", "git-repo", "worktree-probe",
        "compile", "test-command", "bootstrap-command", "dirty-baseline",
        "base-branch"]
    assert receipt["stages"][0]["detail"] == "fleet run run-test"
    run_dir = repo / ".claude/ultrapowers/run-t1"
    assert (run_dir / "receipt.json").is_file()
    assert (run_dir / "launch.json").is_file()
    assert (run_dir / "args.json").is_file()
    # Knob contract (#89): slots ride the args wave entries the engine reads;
    # the launch file carries bodies + context only.
    launch = json.loads((run_dir / "launch.json").read_text())
    assert all("tier" not in t and "review" not in t for t in launch["tasks"])
    skel = json.loads((run_dir / "args.json").read_text())
    entries = [t for wave in skel["waves"] for t in wave]
    assert entries and all(t["tier"] is None for t in entries)
    assert all(t["review"] in ("lean", "adversarial") for t in entries)
    assert any("waves[][].tier" in d for d in receipt["llmDerives"])
    assert (repo / ".claude/ultrapowers/DIRTY_SNAPSHOT").is_file()
    # the state dir still self-ignores (structural, not the deleted prune)
    assert (repo / ".claude/ultrapowers/.gitignore").read_text() == "*\n"
    # Phase 0 rows 1 and 5: no lock, no probe contract.
    assert not (repo / ".claude/ultrapowers/RUN_LOCK").exists()
    assert "lockId" not in receipt and "probe" not in receipt
    assert receipt["workflowName"] == "ultrapowers-run"
    assert receipt["testCmd"] == PYTEST_CMD


def test_dirty_baseline_stage_records_the_preexisting_dirt(tmp_path):
    """#104 relocation: the driver writes DIRTY_SNAPSHOT itself. Its content is
    `git status --porcelain` at launch — the exact partition key gate_check
    uses to tell operator dirt from dirt a role smuggled in mid-run."""
    repo = make_repo(tmp_path)
    (repo / "pytest.ini").write_text("[pytest]\n# operator edit\n")  # tracked
    (repo / "operator-notes.md").write_text("deliberately uncommitted\n")
    r = run_driver(repo)
    assert r.returncode == 0, r.stdout + r.stderr
    receipt = json.loads(r.stdout)
    stage = [s for s in receipt["stages"] if s["stage"] == "dirty-baseline"][0]
    assert stage["ok"] is True
    recorded = (repo / ".claude/ultrapowers/DIRTY_SNAPSHOT").read_text()
    porcelain = sh(["git", "status", "--porcelain"], cwd=repo).stdout
    assert recorded == porcelain
    assert " M pytest.ini" in recorded
    assert "?? operator-notes.md" in recorded


def test_dirty_baseline_is_empty_on_a_clean_launch(tmp_path):
    """A clean tree records an empty baseline — not a missing file, which
    gate_check would read as 'nothing pre-existed' by a different route."""
    repo = make_repo(tmp_path)
    assert run_driver(repo).returncode == 0
    dirty = repo / ".claude/ultrapowers/DIRTY_SNAPSHOT"
    assert dirty.is_file()
    assert dirty.read_text() == ""


def test_not_a_git_repo_fails_the_git_repo_stage(tmp_path):
    bare = tmp_path / "not-a-repo"
    bare.mkdir()
    (bare / "plan.md").write_text(PLAN)
    r = sh([sys.executable, str(RUN), "plan.md", "--stamp", "t1"],
           cwd=bare, check=False, env=FLEET_ENV)
    assert r.returncode != 0
    receipt = json.loads(r.stdout)
    assert receipt["ok"] is False
    assert receipt["stages"][0]["stage"] == "fleet-run"
    assert receipt["stages"][-1]["stage"] == "git-repo"


def test_uncompilable_plan_fails_compile_stage(tmp_path):
    repo = make_repo(tmp_path)
    (repo / "plan.md").write_text("# not a plan\n\nno tasks here\n")
    r = run_driver(repo)
    assert r.returncode != 0
    receipt = json.loads(r.stdout)
    assert receipt["stages"][-1]["stage"] == "compile"


def run_validate_knobs(repo, args_path):
    return sh([sys.executable, str(RUN), "--validate-knobs", str(args_path)],
              cwd=repo, check=False)


def test_validate_knobs_blocks_a_tree_dirtying_bootstrap(tmp_path):
    repo = make_repo(tmp_path)
    args_path = repo / "args.json"
    args_path.write_text(json.dumps({"bootstrapCmd": "touch dirt.txt"}))
    r = run_validate_knobs(repo, args_path)
    assert r.returncode != 0


def test_validate_knobs_green_testcmd_alone_exits_0(tmp_path):
    # superseded no-op pin (#116): a lone testCmd now runs as the baseline
    # in the probe worktree instead of skipping validation entirely.
    repo = make_repo(tmp_path)
    args_path = repo / "args.json"
    args_path.write_text(json.dumps({"testCmd": "true"}))
    r = run_validate_knobs(repo, args_path)
    assert r.returncode == 0, r.stdout + r.stderr
    assert json.loads(r.stdout)["baseline"]["ok"] is True


def test_validate_knobs_accepts_filled_knob_slots(tmp_path):
    repo = make_repo(tmp_path)
    args_path = repo / "args.json"
    args_path.write_text(json.dumps({"waves": [
        [{"id": "1", "tier": "mostCapable", "review": "adversarial"},
         {"id": "2", "tier": None, "review": "lean"}],
        [{"id": "3", "tier": "most-capable", "review": "lean"}],
    ]}))
    r = run_validate_knobs(repo, args_path)
    assert r.returncode == 0, r.stdout + r.stderr


def test_validate_knobs_rejects_an_unknown_tier(tmp_path):
    repo = make_repo(tmp_path)
    args_path = repo / "args.json"
    args_path.write_text(json.dumps({"waves": [
        [{"id": "1", "tier": "opus", "review": "lean"}]]}))
    r = run_validate_knobs(repo, args_path)
    assert r.returncode != 0
    verdict = json.loads(r.stdout)
    assert verdict["ok"] is False
    assert "task 1" in verdict["detail"] and "tier" in verdict["detail"]


def test_validate_knobs_rejects_a_missing_review(tmp_path):
    repo = make_repo(tmp_path)
    args_path = repo / "args.json"
    args_path.write_text(json.dumps({"waves": [[{"id": "1", "tier": None}]]}))
    r = run_validate_knobs(repo, args_path)
    assert r.returncode != 0
    verdict = json.loads(r.stdout)
    assert "review" in verdict["detail"]


def test_validate_knobs_rejects_a_malformed_wave_entry_with_a_verdict(tmp_path):
    # A malformed entry must produce the JSON verdict contract, not a traceback.
    repo = make_repo(tmp_path)
    args_path = repo / "args.json"
    args_path.write_text(json.dumps({"waves": [["just-a-string-entry"]]}))
    r = run_validate_knobs(repo, args_path)
    assert r.returncode != 0
    verdict = json.loads(r.stdout)
    assert verdict["ok"] is False
    assert "not an object" in verdict["detail"]


def test_validate_knobs_rejects_a_non_object_args_file_with_a_verdict(tmp_path):
    repo = make_repo(tmp_path)
    args_path = repo / "args.json"
    args_path.write_text(json.dumps([1, 2]))
    r = run_validate_knobs(repo, args_path)
    assert r.returncode != 0
    verdict = json.loads(r.stdout)
    assert verdict["ok"] is False
    assert "not a JSON object" in verdict["detail"]


def test_args_skeleton_carries_plugin_root_and_run_dir(tmp_path):
    repo = make_repo(tmp_path)
    r = run_driver(repo)
    assert r.returncode == 0, r.stdout + r.stderr
    skel = json.loads((repo / ".claude/ultrapowers/run-t1/args.json").read_text())
    assert skel["pluginRoot"] == str(ROOT)
    assert skel["runDir"] == str((repo / ".claude/ultrapowers/run-t1").resolve())


def test_run_dir_requires_emit_args(tmp_path):
    repo = make_repo(tmp_path)
    r = sh([sys.executable, str(SCRIPTS / "compile_plan.py"), "plan.md",
            "--run-dir", str(tmp_path / "rd")], cwd=repo, check=False)
    assert r.returncode != 0
    assert "--run-dir requires --emit-args" in (r.stdout + r.stderr)


def test_check_rejects_run_dir(tmp_path):
    repo = make_repo(tmp_path)
    r = sh([sys.executable, str(SCRIPTS / "compile_plan.py"), "plan.md",
            "--check", "--run-dir", str(tmp_path / "rd")], cwd=repo, check=False)
    assert r.returncode != 0
    out = r.stdout + r.stderr
    assert "--check is mutually exclusive" in out
    assert "--run-dir" in out


def test_detect_test_cmd_ladder(tmp_path, monkeypatch):
    # Pin the xdist probe closed so the ladder assertions are environment-free;
    # the -n auto upgrade has its own test below.
    monkeypatch.setattr(ultra_run, "_xdist_available", lambda: False)
    # Miss: empty repo detects nothing.
    assert detect_test_cmd(tmp_path) == (None, None)
    # Each rule, lowest precedence first, then assert higher rules win.
    (tmp_path / "Cargo.toml").write_text("[package]\n")
    assert detect_test_cmd(tmp_path) == ("cargo test", "cargo-toml")
    (tmp_path / "go.mod").write_text("module x\n")
    assert detect_test_cmd(tmp_path) == ("go test ./...", "go-mod")
    (tmp_path / "Makefile").write_text("test:\n\ttrue\n")
    assert detect_test_cmd(tmp_path) == ("make test", "makefile-test")
    (tmp_path / "package.json").write_text('{"scripts": {"test": "node --test"}}')
    assert detect_test_cmd(tmp_path) == ("npm test", "package-json-npm")
    (tmp_path / "pnpm-lock.yaml").write_text("")
    assert detect_test_cmd(tmp_path) == ("pnpm test", "package-json-pnpm")
    (tmp_path / "pyproject.toml").write_text("[tool.pytest.ini_options]\n")
    assert detect_test_cmd(tmp_path) == ("python3 -m pytest", "pyproject-pytest")
    (tmp_path / "pytest.ini").write_text("[pytest]\n")
    assert detect_test_cmd(tmp_path) == ("python3 -m pytest", "pytest-ini")


def test_detect_test_cmd_pytest_upgrades_to_xdist(tmp_path, monkeypatch):
    """#426: when pytest-xdist is importable by the python3 that will run the
    suite, both pytest rules emit `-n auto`; the rule names stay unchanged so
    receipts remain comparable across environments."""
    monkeypatch.setattr(ultra_run, "_xdist_available", lambda: True)
    (tmp_path / "pyproject.toml").write_text("[tool.pytest.ini_options]\n")
    assert detect_test_cmd(tmp_path) == ("python3 -m pytest -n auto", "pyproject-pytest")
    (tmp_path / "pytest.ini").write_text("[pytest]\n")
    assert detect_test_cmd(tmp_path) == ("python3 -m pytest -n auto", "pytest-ini")


def _fake_python3(tmp_path, probe_exit):
    """A PATH-front `python3` stub: answers the xdist probe with probe_exit,
    delegates everything else to the real interpreter. Pins that the probe
    consults the PATH python3 (the interpreter testCmd will invoke), not this
    process's import machinery."""
    fb = tmp_path / "fakebin"
    fb.mkdir(parents=True)
    stub = fb / "python3"
    stub.write_text(
        "#!/bin/sh\n"
        f'if [ "$1" = "-c" ] && [ "$2" = "import xdist" ]; then exit {probe_exit}; fi\n'
        f'exec "{sys.executable}" "$@"\n')
    stub.chmod(0o755)
    return dict(os.environ, PATH=f"{fb}:{os.environ['PATH']}")


def test_xdist_probe_follows_path_python3(tmp_path, monkeypatch):
    ultra_run._xdist_available.cache_clear()
    monkeypatch.setenv("PATH", _fake_python3(tmp_path, 0)["PATH"])
    monkeypatch.delenv("ULTRAPOWERS_XDIST", raising=False)
    assert ultra_run._xdist_available() is True
    ultra_run._xdist_available.cache_clear()


def test_xdist_probe_fails_closed_on_oserror(monkeypatch):
    ultra_run._xdist_available.cache_clear()
    monkeypatch.setattr(ultra_run.subprocess, "run",
                        lambda *a, **k: (_ for _ in ()).throw(OSError("no python3")))
    assert ultra_run._xdist_available() is False
    ultra_run._xdist_available.cache_clear()


def test_xdist_env_opt_out(monkeypatch):
    ultra_run._xdist_available.cache_clear()
    monkeypatch.setenv("ULTRAPOWERS_XDIST", "0")
    assert ultra_run._xdist_available() is False
    ultra_run._xdist_available.cache_clear()


def test_receipt_carries_xdist_cmd_end_to_end(tmp_path):
    """#426 wiring pin, not self-fulfilling: a stub python3 forces the probe
    answer inside the spawned driver, and the receipt must reflect it — both
    directions."""
    for probe_exit, expected in ((0, "python3 -m pytest -n auto"),
                                 (1, "python3 -m pytest")):
        (tmp_path / f"probe{probe_exit}").mkdir()
        repo = make_repo(tmp_path / f"probe{probe_exit}")
        env = _fake_python3(tmp_path / f"bin{probe_exit}", probe_exit)
        env["ULTRAPOWERS_FLEET_RUN"] = "run-test"
        env.pop("ULTRAPOWERS_XDIST", None)
        r = sh([sys.executable, str(RUN), "plan.md", "--stamp", "t1"],
               cwd=repo, check=False, env=env)
        assert r.returncode == 0, r.stdout + r.stderr
        assert json.loads(r.stdout)["testCmd"] == expected


@pytest.mark.parametrize("lockfile", ["bun.lock", "bun.lockb"])
def test_detect_test_cmd_bun_rung(tmp_path, lockfile):
    # The bun rung had zero coverage: the ladder test above walks
    # cargo->go->make->npm->pnpm->pytest and never plants a bun lockfile, so a
    # deleted or renamed bun branch stayed green. Both lockfile spellings the
    # ladder accepts (text `bun.lock`, binary `bun.lockb`) are pinned.
    (tmp_path / "package.json").write_text('{"scripts": {"test": "bun test"}}')
    (tmp_path / lockfile).write_text("")
    cmd, rule = detect_test_cmd(tmp_path)
    assert (cmd, rule) == ("bun run test", "package-json-bun")


def test_bun_rung_runs_the_package_test_script_not_the_literal(tmp_path):
    """#600: the smoke repo's script is `bunx tsc --noEmit && bun test`; the
    literal `bun test` dropped the typecheck and runs 67/69/70/71 parked on
    the exam's tsc leg while the driver's suite read green. Like the npm and
    pnpm rungs, the Bun rung runs the SCRIPT."""
    (tmp_path / "package.json").write_text(
        '{"scripts": {"test": "bunx tsc --noEmit && bun test"}}')
    (tmp_path / "bun.lock").write_text("")
    assert detect_test_cmd(tmp_path) == ("bun run test", "package-json-bun")


def test_bun_rung_falls_back_to_bun_test_without_a_script(tmp_path):
    """No `test` script + a Bun lockfile: `bun test` is the runner's own
    discovery, the fallback #600 names. A lockfile-less package.json without
    a script still derives nothing (below), so this is Bun-specific."""
    (tmp_path / "package.json").write_text('{"scripts": {"build": "x"}}')
    (tmp_path / "bun.lockb").write_text("")
    assert detect_test_cmd(tmp_path) == ("bun test", "bun-lockfile")


def test_detect_test_cmd_bun_vs_pnpm_precedence(tmp_path):
    # Pin the precedence the ladder implements TODAY so a silent reorder fails
    # loudly. pnpm is probed before bun, so pnpm wins when both are present.
    (tmp_path / "package.json").write_text('{"scripts": {"test": "x"}}')
    (tmp_path / "bun.lockb").write_text("")
    (tmp_path / "pnpm-lock.yaml").write_text("")
    assert detect_test_cmd(tmp_path) == ("pnpm test", "package-json-pnpm")


def test_detect_ignores_package_json_without_test_script(tmp_path):
    (tmp_path / "package.json").write_text('{"scripts": {"build": "x"}}')
    assert detect_test_cmd(tmp_path) == (None, None)
    (tmp_path / "package.json").write_text("not json {")
    assert detect_test_cmd(tmp_path) == (None, None)


def test_preflight_stamps_detected_test_cmd(tmp_path):
    repo = make_repo(tmp_path)  # make_repo now writes pytest.ini — see the note below
    r = run_driver(repo)
    assert r.returncode == 0, r.stdout + r.stderr
    receipt = json.loads(r.stdout)
    assert receipt["testCmd"] == PYTEST_CMD
    assert receipt["testCmdSource"] == "detected:pytest-ini"
    assert "bootstrapCmd" not in receipt
    args = json.loads((repo / ".claude/ultrapowers/run-t1/args.json").read_text())
    assert args["testCmd"] == PYTEST_CMD
    assert "bootstrapCmd" not in args


def test_preflight_knob_wins_and_bootstrap_stamped(tmp_path):
    repo = make_repo(tmp_path)
    r = run_driver(repo, "--test-cmd", "make check", "--bootstrap-cmd", "true")
    assert r.returncode == 0, r.stdout + r.stderr
    receipt = json.loads(r.stdout)
    assert receipt["testCmd"] == "make check"
    assert receipt["testCmdSource"] == "knob"
    assert receipt["bootstrapCmd"] == "true"
    args = json.loads((repo / ".claude/ultrapowers/run-t1/args.json").read_text())
    assert args["testCmd"] == "make check"
    assert args["bootstrapCmd"] == "true"


def test_preflight_fails_closed_when_nothing_detected(tmp_path):
    repo = make_repo(tmp_path)
    (repo / "pytest.ini").unlink()
    sh(["git", "add", "-A"], cwd=repo)
    sh(["git", "commit", "-qm", "drop pytest.ini"], cwd=repo)
    r = run_driver(repo)
    assert r.returncode != 0
    receipt = json.loads(r.stdout)
    assert receipt["ok"] is False
    failing = [s for s in receipt["stages"] if not s["ok"]]
    assert failing and failing[-1]["stage"] == "test-command"
    assert "--test-cmd" in failing[-1]["detail"]


# --- #97: stage details state the stage's own verdict ---

FAILURE_PHRASINGS = ("not inside a git repository", "Preparing worktree",
                     "no branch resolvable")


def test_green_stages_never_carry_failure_phrasings(tmp_path):
    # Generic over ALL stages, so stages added by later plans are covered too.
    repo = make_repo(tmp_path)
    r = run_driver(repo)
    assert r.returncode == 0, r.stdout + r.stderr
    receipt = json.loads(r.stdout)
    for s in receipt["stages"]:
        if s["ok"]:
            for phrase in FAILURE_PHRASINGS:
                assert phrase not in s["detail"], (s["stage"], s["detail"])


def test_git_repo_success_detail_is_repo_root(tmp_path):
    repo = make_repo(tmp_path)
    r = run_driver(repo)
    receipt = json.loads(r.stdout)
    s = next(x for x in receipt["stages"] if x["stage"] == "git-repo")
    assert s["detail"] == str(repo.resolve())


def test_worktree_probe_success_detail_is_conclusion(tmp_path):
    repo = make_repo(tmp_path)
    r = run_driver(repo)
    receipt = json.loads(r.stdout)
    s = next(x for x in receipt["stages"] if x["stage"] == "worktree-probe")
    assert s["detail"] == "worktree capability verified (probe cut and removed)"


def test_compile_success_detail_is_summary_not_json(tmp_path):
    repo = make_repo(tmp_path)
    r = run_driver(repo)
    receipt = json.loads(r.stdout)
    s = next(x for x in receipt["stages"] if x["stage"] == "compile")
    assert not s["detail"].startswith("{")
    assert "task(s)" in s["detail"] and "wave(s)" in s["detail"]
    assert (receipt["compile"]["acceptance"] or {}).get("mode", "unmarked") in s["detail"]


def test_failure_details_survive_not_a_repo(tmp_path):
    # The failure path keeps its message — run the driver OUTSIDE any git repo.
    plain = tmp_path / "plain"
    plain.mkdir()
    (plain / "plan.md").write_text("# nothing")
    r = sh([sys.executable, str(RUN), "plan.md", "--stamp", "t9"],
           cwd=plain, check=False, env=FLEET_ENV)
    assert r.returncode != 0
    receipt = json.loads(r.stdout)
    s = next(x for x in receipt["stages"] if x["stage"] == "git-repo")
    assert s["ok"] is False
    assert ("not inside a git repository" in s["detail"]) or ("fatal" in s["detail"])


# --- #100: baseBranch derives from the launched checkout ---

def give_remote_head(repo, default="main"):
    # Synthesize the repo-default pointer a clone would have, no real remote.
    sh(["git", "update-ref", "refs/remotes/origin/" + default, "HEAD"], cwd=repo)
    sh(["git", "symbolic-ref", "refs/remotes/origin/HEAD",
        "refs/remotes/origin/" + default], cwd=repo)


def base_stage(receipt):
    return next(s for s in receipt["stages"] if s["stage"] == "base-branch")


def test_feature_branch_launch_wins_over_repo_default(tmp_path):
    repo = make_repo(tmp_path)
    give_remote_head(repo)
    sh(["git", "checkout", "-q", "-b", "feature"], cwd=repo)
    r = run_driver(repo)
    assert r.returncode == 0, r.stdout + r.stderr
    receipt = json.loads(r.stdout)
    assert receipt["baseBranch"] == "feature"
    s = base_stage(receipt)
    assert s["ok"] is True
    assert s["detail"] == "feature"          # no fallback note on the happy path


def test_detached_head_falls_back_to_repo_default_loudly(tmp_path):
    repo = make_repo(tmp_path)
    give_remote_head(repo)
    sh(["git", "checkout", "-q", "--detach"], cwd=repo)
    r = run_driver(repo)
    assert r.returncode == 0, r.stdout + r.stderr
    receipt = json.loads(r.stdout)
    assert receipt["baseBranch"] == "main"
    s = base_stage(receipt)
    assert s["ok"] is True
    assert s["detail"] == "detached HEAD → fell back to repo default 'main'"


def test_detached_head_without_remote_head_fails_closed(tmp_path):
    repo = make_repo(tmp_path)                 # no remote refs at all
    sh(["git", "checkout", "-q", "--detach"], cwd=repo)
    r = run_driver(repo)
    assert r.returncode != 0
    receipt = json.loads(r.stdout)
    assert receipt["ok"] is False
    s = base_stage(receipt)
    assert s["ok"] is False
    assert s["detail"] == "no branch resolvable"


# --- #99: bootstrapCmd probed in a throwaway worktree, never the checkout ---

def test_destructive_bootstrap_cannot_touch_the_session_checkout(tmp_path):
    # The headline regression: under the old design this command deleted the
    # session repo's file; now the mutation is confined to the probe worktree.
    repo = make_repo(tmp_path)
    args_path = tmp_path / "args.json"   # outside the repo: the clean-tree
    args_path.write_text(json.dumps({"bootstrapCmd": "rm plan.md"}))  # assert below is about the PROBE
    r = run_validate_knobs(repo, args_path)
    assert r.returncode != 0
    verdict = json.loads(r.stdout)
    assert verdict["ok"] is False
    assert verdict["treeClean"] is False
    assert (repo / "plan.md").is_file()          # the session checkout is intact
    assert sh(["git", "status", "--porcelain"], cwd=repo).stdout == ""


def test_noop_bootstrap_leaves_no_probe_worktree_behind(tmp_path):
    repo = make_repo(tmp_path)
    args_path = repo / "args.json"
    args_path.write_text(json.dumps({"bootstrapCmd": "true"}))
    r = run_validate_knobs(repo, args_path)
    assert r.returncode == 0, r.stdout + r.stderr
    assert not list((repo / ".claude/ultrapowers").glob("wt-knob-*"))
    worktrees = sh(["git", "worktree", "list"], cwd=repo).stdout.strip()
    assert len(worktrees.splitlines()) == 1      # only the main checkout


def test_unborn_head_fails_probe_worktree_creation_closed(tmp_path):
    # A repo with no commits cannot cut a worktree from HEAD: fail closed,
    # never fall back to running the command on the session checkout.
    repo = tmp_path / "empty"
    repo.mkdir()
    sh(["git", "init", "-q", "-b", "main"], cwd=repo)
    sh(["git", "config", "user.email", "t@t"], cwd=repo)
    sh(["git", "config", "user.name", "t"], cwd=repo)
    args_path = repo / "args.json"
    args_path.write_text(json.dumps({"bootstrapCmd": "touch dirt.txt"}))
    r = run_validate_knobs(repo, args_path)
    assert r.returncode != 0
    verdict = json.loads(r.stdout)
    assert verdict["ok"] is False
    assert "probe worktree" in verdict["detail"]
    assert not (repo / "dirt.txt").exists()      # the command never ran here


def test_validate_knobs_green_baseline_exits_0(tmp_path):
    repo = make_repo(tmp_path)
    args_path = repo / "args.json"
    args_path.write_text(json.dumps({"bootstrapCmd": "true", "testCmd": "true"}))
    r = run_validate_knobs(repo, args_path)
    assert r.returncode == 0, r.stdout + r.stderr
    out = json.loads(r.stdout)
    assert out["baseline"]["ok"] is True


def test_validate_knobs_red_baseline_exits_3(tmp_path):
    repo = make_repo(tmp_path)
    args_path = repo / "args.json"
    args_path.write_text(json.dumps({"bootstrapCmd": "true",
                                     "testCmd": "echo FAILING-SUITE; false"}))
    r = run_validate_knobs(repo, args_path)
    assert r.returncode == 3
    out = json.loads(r.stdout)
    assert out["baseline"]["ok"] is False
    assert "FAILING-SUITE" in out["baseline"]["output"]


def test_validate_knobs_no_testcmd_skips_baseline(tmp_path):
    repo = make_repo(tmp_path)
    args_path = repo / "args.json"
    args_path.write_text(json.dumps({"bootstrapCmd": "true"}))
    r = run_validate_knobs(repo, args_path)
    assert r.returncode == 0
    out = json.loads(r.stdout)
    assert "baseline" not in out or out.get("baseline") is None


def test_validate_knobs_failed_bootstrap_short_circuits_baseline(tmp_path):
    repo = make_repo(tmp_path)
    args_path = repo / "args.json"
    args_path.write_text(json.dumps({"bootstrapCmd": "false",
                                     "testCmd": "echo NEVER-RAN"}))
    r = run_validate_knobs(repo, args_path)
    assert r.returncode == 1                       # not 3: bootstrap red wins
    assert "NEVER-RAN" not in r.stdout


def test_validate_knobs_test_dirt_does_not_pollute_treeclean(tmp_path):
    # the suite writes a cache file; treeClean is a bootstrap-only verdict
    repo = make_repo(tmp_path)
    args_path = repo / "args.json"
    args_path.write_text(json.dumps({"bootstrapCmd": "true",
                                     "testCmd": "touch .test-cache && true"}))
    r = run_validate_knobs(repo, args_path)
    assert r.returncode == 0, r.stdout + r.stderr
    out = json.loads(r.stdout)
    assert out["treeClean"] is True
    assert out["baseline"]["ok"] is True


def test_validate_knobs_baseline_runs_without_bootstrapcmd(tmp_path):
    # named behavior change: testCmd alone now cuts the worktree
    repo = make_repo(tmp_path)
    args_path = repo / "args.json"
    args_path.write_text(json.dumps({"testCmd": "echo RED; false"}))
    r = run_validate_knobs(repo, args_path)
    assert r.returncode == 3
    assert json.loads(r.stdout)["baseline"]["ok"] is False


def test_validate_knobs_neither_cmd_keeps_early_return(tmp_path):
    repo = make_repo(tmp_path)
    args_path = repo / "args.json"
    args_path.write_text(json.dumps({}))
    r = run_validate_knobs(repo, args_path)
    assert r.returncode == 0
    assert "nothing to validate" in r.stdout


# --- #105: an explicitly-passed empty/whitespace --test-cmd is never silent ---

@pytest.mark.parametrize("cmd", ["   ", "\t", "\n", ""])
def test_explicit_empty_test_cmd_fails_the_stage(tmp_path, cmd):
    """#105 differential pin: BASE stamps a whitespace knob verbatim (the gate
    later evals it to a false green) and silently drops an empty one into
    detection. HEAD fails the test-command stage naming the empty knob — and
    stamps nothing, so the fall-through cannot ride on a detected command."""
    repo = make_repo(tmp_path)          # writes pytest.ini, so detection WOULD succeed
    r = run_driver(repo, "--test-cmd", cmd)
    assert r.returncode != 0, r.stdout + r.stderr
    receipt = json.loads(r.stdout)
    assert receipt["ok"] is False
    assert receipt["stages"][-1]["stage"] == "test-command"
    assert receipt["stages"][-1]["ok"] is False
    assert "--test-cmd" in receipt["stages"][-1]["detail"]
    assert "testCmd" not in receipt


def _probe_dirs(repo):
    return sorted(p.name for p in (repo / ".claude/ultrapowers").glob("wt-knob-*"))


def test_validate_knobs_removes_its_probe_worktree_on_sigterm(tmp_path):
    """#251: a SIGTERM mid-suite (the tool timeout that killed the drain's
    first --validate-knobs) must still run the probe worktree's removal —
    the default SIGTERM disposition skips `finally` and leaked wt-knob-<pid>."""
    repo = make_repo(tmp_path)
    args_path = repo / "args.json"
    args_path.write_text(json.dumps({"testCmd": "sleep 30"}))
    proc = subprocess.Popen([sys.executable, str(RUN), "--validate-knobs",
                             str(args_path)], cwd=repo,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        # Both waits are budgeted, not bare: this file runs under `-n auto`, and
        # the probe worktree's appearance is a process spawn racing the rest of
        # the suite for the machine (#478). See tests/deadline_slack.py.
        deadline = time.time() + deadline_budget(15)
        while time.time() < deadline and not _probe_dirs(repo):
            time.sleep(0.1)
        assert _probe_dirs(repo), "probe worktree never appeared"
        proc.terminate()
        proc.wait(timeout=deadline_budget(15))
    finally:
        if proc.poll() is None:
            proc.kill()
    assert proc.returncode != 0
    assert _probe_dirs(repo) == []
    wl = sh(["git", "worktree", "list", "--porcelain"], cwd=repo).stdout
    assert "wt-knob-" not in wl


# --- One Driver Phase 0 §The one mechanism: fleet-run is the first stage ---

@pytest.mark.parametrize("value", [None, "", "   "])
def test_unset_fleet_run_refuses_before_any_other_stage(tmp_path, value):
    """ULTRAPOWERS_FLEET_RUN unset (or blank) means a laptop session is trying
    to run the engine locally. The first stage refuses; nothing else runs and
    no run dir is minted (replaces the #129 launch-checkout guard, row 9)."""
    repo = make_repo(tmp_path)
    env = {k: v for k, v in os.environ.items() if k != "ULTRAPOWERS_FLEET_RUN"}
    if value is not None:
        env["ULTRAPOWERS_FLEET_RUN"] = value
    r = sh([sys.executable, str(RUN), "plan.md", "--stamp", "t1"],
           cwd=repo, check=False, env=env)
    assert r.returncode != 0
    receipt = json.loads(r.stdout)
    assert receipt["ok"] is False
    assert [s["stage"] for s in receipt["stages"]] == ["fleet-run"]
    assert receipt["stages"][0]["ok"] is False
    detail = receipt["stages"][0]["detail"]
    assert "`/ultrapowers` runs only inside a fleet sandbox" in detail
    assert "launch `drive-one` on the orchestrator" in detail
    assert not (repo / ".claude/ultrapowers/run-t1").exists()


def test_driver_carries_no_superpowers_coupling():
    # #390: the driver never resolves, checks, or invokes superpowers again.
    assert "superpowers" not in RUN.read_text()
