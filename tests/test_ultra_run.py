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
from ultra_run import prune_run_dirs  # noqa: E402
from ultra_run import detect_test_cmd  # noqa: E402

PLAN = (
    "# P\n\n**Acceptance:** waived — test fixture\n\n"
    "### Task 1: A\n\n**Type:** implementation\n**Depends-on:** none\n\n"
    "**Files:**\n- Create: `a.py`\n\n- [ ] **Step 1: do**\n\n"
    "### Task 2: B\n\n**Type:** implementation\n**Depends-on:** 1\n\n"
    "**Files:**\n- Create: `b.py`\n\n- [ ] **Step 1: do**\n"
)


def sh(cmd, cwd=None, check=True):
    return subprocess.run(cmd, cwd=cwd, check=check, capture_output=True, text=True)


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
              cwd=repo, check=False)


def test_happy_path_receipt(tmp_path):
    repo = make_repo(tmp_path)
    r = run_driver(repo)
    assert r.returncode == 0, r.stdout + r.stderr
    receipt = json.loads(r.stdout)
    assert receipt["ok"] is True
    assert receipt["lockId"] == "t1"          # the stamp IS the lock id
    assert all(s["ok"] for s in receipt["stages"])
    stage_names = [s["stage"] for s in receipt["stages"]]
    for expected in ("git-repo", "worktree-probe", "engine-skew",
                     "superpowers-compat", "compile", "disk-headroom",
                     "test-command", "install",
                     "lock", "dirty-baseline"):
        assert expected in stage_names
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
    # lock + dirty-baseline actually happened, with the dirty set recorded
    assert (repo / ".claude/ultrapowers/RUN_LOCK").read_text() == "t1"
    assert (repo / ".claude/ultrapowers/DIRTY_SNAPSHOT").is_file()
    # the checkout-position half of the retired family records nothing (#104)
    assert not (repo / ".claude/ultrapowers/CHECKOUT_SNAPSHOT").exists()
    # probe contract pre-computed for the orchestrator
    assert receipt["probe"]["assert"] == {"echoWaves": 1, "echoFirstId": "probe-1"}
    assert receipt["workflowName"] == "ultrapowers-run"
    assert receipt["testCmd"] == "python3 -m pytest"


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


def test_not_a_git_repo_fails_first_stage(tmp_path):
    bare = tmp_path / "not-a-repo"
    bare.mkdir()
    (bare / "plan.md").write_text(PLAN)
    r = sh([sys.executable, str(RUN), "plan.md", "--stamp", "t1"],
           cwd=bare, check=False)
    assert r.returncode != 0
    receipt = json.loads(r.stdout)
    assert receipt["ok"] is False
    assert receipt["stages"][-1]["stage"] == "git-repo"


def test_worktree_isolated_launch_fails_closed(tmp_path):
    """#129: a session launched from inside .claude/worktrees/ (EnterWorktree
    isolation) passes every later stage but cannot execute the run — the
    session Bash guard refuses the engine's integration worktree. Preflight
    must fail closed with the remedy, before any cost is spent."""
    repo = make_repo(tmp_path)
    wt = repo / ".claude/worktrees/session-wt"
    sh(["git", "worktree", "add", "-q", str(wt), "HEAD"], cwd=repo)
    (wt / "plan.md").write_text(PLAN)
    r = sh([sys.executable, str(RUN), "plan.md", "--stamp", "t1"],
           cwd=wt, check=False)
    assert r.returncode != 0
    receipt = json.loads(r.stdout)
    assert receipt["ok"] is False
    assert receipt["stages"][-1]["stage"] == "launch-checkout"
    assert receipt["stages"][-1]["ok"] is False
    assert "repo root" in receipt["stages"][-1]["detail"]


def test_primary_checkout_launch_passes_launch_checkout_stage(tmp_path):
    repo = make_repo(tmp_path)
    r = run_driver(repo)
    receipt = json.loads(r.stdout)
    stage = [s for s in receipt["stages"] if s["stage"] == "launch-checkout"][0]
    assert stage["ok"] is True


def test_held_lock_fails_lock_stage(tmp_path):
    repo = make_repo(tmp_path)
    sh(["bash", str(SCRIPTS / "run_lock.sh"), "acquire", "other-run"], cwd=repo)
    r = run_driver(repo)
    assert r.returncode != 0
    receipt = json.loads(r.stdout)
    assert receipt["stages"][-1]["stage"] == "lock"
    assert receipt["stages"][-1]["ok"] is False


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


def test_state_dir_self_ignores_and_prunes_old_runs(tmp_path):
    repo = make_repo(tmp_path)
    state = repo / ".claude/ultrapowers"
    state.mkdir(parents=True)
    # 12 stale stamp-format run dirs; the 2 oldest must be pruned (keep 10).
    for day in range(10, 22):
        (state / f"run-202601{day:02d}-000000").mkdir()
    # Decoys that the prune must NEVER touch: non-matching names.
    (state / "scratch").mkdir()
    (state / "pending-abc123def456").mkdir()
    (state / "run-keepme").mkdir()          # prefix collides, format does not
    r = run_driver(repo)
    assert r.returncode == 0, r.stdout + r.stderr
    survivors = sorted(d.name for d in state.iterdir()
                       if d.name.startswith("run-2026"))
    assert len(survivors) == 10
    assert survivors[0] == "run-20260112-000000"   # the 2 oldest are gone
    assert (state / "scratch").is_dir()
    assert (state / "pending-abc123def456").is_dir()
    assert (state / "run-keepme").is_dir()
    assert (state / "run-t1").is_dir()             # the current run, untouched
    assert (state / ".gitignore").read_text() == "*\n"
    receipt = json.loads(r.stdout)
    assert any(s["stage"] == "scratch-hygiene" and s["ok"]
               for s in receipt["stages"])


def test_check_rejects_run_dir(tmp_path):
    repo = make_repo(tmp_path)
    r = sh([sys.executable, str(SCRIPTS / "compile_plan.py"), "plan.md",
            "--check", "--run-dir", str(tmp_path / "rd")], cwd=repo, check=False)
    assert r.returncode != 0
    out = r.stdout + r.stderr
    assert "--check is mutually exclusive" in out
    assert "--run-dir" in out


def test_prune_run_dirs_keeps_newest_including_a_live_run(tmp_path):
    # Direct unit test of prune_run_dirs: the driver-level test's "run-t1"
    # stamp can never match RUN_DIR_RE, so it proves nothing about a real
    # run dir surviving the prune. Seed 12 stale dirs plus a newest dir
    # standing in for the current run.
    state = tmp_path / "state"
    state.mkdir()
    stale = [f"run-202601{day:02d}-000000" for day in range(10, 22)]  # 12
    for name in stale:
        (state / name).mkdir()
    current = "run-20260122-000000"          # newest — stands in for a live run
    (state / current).mkdir()
    # Decoys the prune must NEVER touch.
    (state / "scratch").mkdir()
    (state / "pending-abc123def456").mkdir()
    (state / "run-keepme").mkdir()

    removed = prune_run_dirs(state, keep=10)

    survivors = sorted(d.name for d in state.iterdir()
                       if d.name.startswith("run-2026"))
    assert current in survivors
    assert len(survivors) == 10
    expected_pruned = stale[:3]              # the 3 oldest of the 13 stamped dirs
    assert sorted(removed) == sorted(expected_pruned)
    for name in expected_pruned:
        assert not (state / name).exists()
    assert (state / "scratch").is_dir()
    assert (state / "pending-abc123def456").is_dir()
    assert (state / "run-keepme").is_dir()


def test_detect_test_cmd_ladder(tmp_path):
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


@pytest.mark.parametrize("lockfile", ["bun.lock", "bun.lockb"])
def test_detect_test_cmd_bun_rung(tmp_path, lockfile):
    # The bun rung had zero coverage: the ladder test above walks
    # cargo->go->make->npm->pnpm->pytest and never plants a bun lockfile, so a
    # deleted or renamed bun branch stayed green. Both lockfile spellings the
    # ladder accepts (text `bun.lock`, binary `bun.lockb`) are pinned.
    (tmp_path / "package.json").write_text('{"scripts": {"test": "bun test"}}')
    (tmp_path / lockfile).write_text("")
    cmd, rule = detect_test_cmd(tmp_path)
    assert (cmd, rule) == ("bun test", "package-json-bun")


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
    assert receipt["testCmd"] == "python3 -m pytest"
    assert receipt["testCmdSource"] == "detected:pytest-ini"
    assert "bootstrapCmd" not in receipt
    args = json.loads((repo / ".claude/ultrapowers/run-t1/args.json").read_text())
    assert args["testCmd"] == "python3 -m pytest"
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
           cwd=plain, check=False)
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


# --- #95 item 2: the prune failure branch must stay honest ---

def test_prune_failure_absent_from_removed_list_and_named_in_stage_detail(
        tmp_path, monkeypatch, capsys):
    # Task 4 / #95 item 2: a single doomed dir whose rmtree is selectively
    # neutered (monkeypatched to a no-op for that path only — every other
    # candidate is genuinely removed) must be honestly reported on BOTH
    # surfaces: (a) prune_run_dirs's own return value never lists it as
    # removed, and (b) the driver's scratch-hygiene stage detail names it
    # in the "; N removal failed:" wording rather than silently counting it
    # as pruned (the old report-the-doomed-list behavior would do neither).
    import ultra_run
    repo = make_repo(tmp_path)
    state = repo / ".claude/ultrapowers"
    state.mkdir(parents=True)
    doomed_name = "run-20260101-000000"
    doomed = state / doomed_name
    doomed.mkdir()
    for i in range(2, 12):          # 10 more -> 11 total; KEEP_RUNS=10 -> 1 doomed
        (state / ("run-202601%02d-000000" % i)).mkdir()

    real_rmtree = ultra_run.shutil.rmtree

    def selective_noop(path, *a, **k):
        if pathlib.Path(path) == doomed:
            return None      # this one refuses to go — no-op just for it
        return real_rmtree(path, *a, **k)

    monkeypatch.setattr(ultra_run.shutil, "rmtree", selective_noop)

    # (a) direct check on prune_run_dirs's own return value.
    removed = ultra_run.prune_run_dirs(state, keep=10)
    assert doomed_name not in removed
    assert doomed.exists()                    # it really did survive

    # (b) the driver-level scratch-hygiene stage detail must name it.
    rc = ultra_run.main(["plan.md", "--stamp", "t1", "--repo", str(repo)])
    receipt = json.loads(capsys.readouterr().out)
    assert rc == 0
    s = next(x for x in receipt["stages"] if x["stage"] == "scratch-hygiene")
    assert s["ok"] is True                    # hygiene never blocks a run
    assert "; 1 removal failed: %s" % doomed_name in s["detail"]
    assert doomed.exists()                    # still there after the driver run too


# --- requirement 3: janitor advisory surfaced at preflight (vibes.diy 2026-07-31) ---

def test_preflight_surfaces_worktree_audit_without_blocking(tmp_path):
    """Requirement 3: concluded-run leftovers surface at the NEXT run's
    preflight instead of relying on the operator's memory — advisory only."""
    repo = make_repo(tmp_path)
    stale = repo / ".claude" / "worktrees" / "wf_deadrun-1"
    sh(["git", "worktree", "add", "-b", "worktree-wf_deadrun-1", str(stale)],
       cwd=repo)
    old = time.time() - 3 * 86400
    os.utime(stale, (old, old))

    r = run_driver(repo)
    assert r.returncode == 0, r.stdout + r.stderr        # never blocks
    receipt = json.loads(r.stdout)
    audit = [s for s in receipt["stages"] if s["stage"] == "worktree-audit"]
    assert len(audit) == 1
    assert audit[0]["ok"] is True
    assert "wf_deadrun-1" in audit[0]["detail"]
    assert stale.exists()                                # advisory: untouched


def test_preflight_audit_is_clean_on_a_clean_repo(tmp_path):
    repo = make_repo(tmp_path)
    r = run_driver(repo)
    assert r.returncode == 0, r.stdout + r.stderr
    receipt = json.loads(r.stdout)
    audit = [s for s in receipt["stages"] if s["stage"] == "worktree-audit"]
    assert len(audit) == 1 and audit[0]["ok"] is True
    assert "audit: clean" in audit[0]["detail"]


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


# --- #151: disk-headroom preflight stage (the cycle's one budgeted guard) ---
# free vs estimate = widest_wave_width x 1.5 GiB (hardcoded, no env knob).
# warn stays ok:true (advisory; a tight-but-sufficient host must not
# false-block); block only when free < min(2 GiB, estimate), so a narrow
# run on a small host is never refused by a floor larger than its own need.

GIB = 1024 ** 3

# Two INDEPENDENT tasks -> one wave of width 2 -> estimate 3.0 GiB, floor 2 GiB.
WIDE_PLAN = (
    "# P\n\n**Acceptance:** waived — test fixture\n\n"
    "### Task 1: A\n\n**Type:** implementation\n**Depends-on:** none\n\n"
    "**Files:**\n- Create: `a.py`\n\n- [ ] **Step 1: do**\n\n"
    "### Task 2: B\n\n**Type:** implementation\n**Depends-on:** none\n\n"
    "**Files:**\n- Create: `b.py`\n\n- [ ] **Step 1: do**\n"
)


def make_wide_repo(tmp_path):
    repo = make_repo(tmp_path)
    (repo / "plan.md").write_text(WIDE_PLAN)
    sh(["git", "add", "plan.md"], cwd=repo)
    sh(["git", "commit", "-qm", "wide plan"], cwd=repo)
    return repo


def run_main_with_free(repo, monkeypatch, capsys, free_bytes):
    """Drive ultra_run.main in-process with shutil.disk_usage faked."""
    import ultra_run

    class Usage:
        def __init__(self, free):
            self.free = free

    monkeypatch.setattr(ultra_run.shutil, "disk_usage",
                        lambda path: Usage(free_bytes))
    rc = ultra_run.main(["plan.md", "--stamp", "t1", "--repo", str(repo)])
    return rc, json.loads(capsys.readouterr().out)


def headroom_stage(receipt):
    return next(s for s in receipt["stages"] if s["stage"] == "disk-headroom")


def test_disk_headroom_ok_at_estimate_boundary(tmp_path, monkeypatch, capsys):
    # free == estimate -> ok (Free >= estimate is the ok branch).
    repo = make_wide_repo(tmp_path)
    rc, receipt = run_main_with_free(repo, monkeypatch, capsys, 3 * GIB)
    assert rc == 0
    s = headroom_stage(receipt)
    assert s["ok"] is True
    assert s["detail"].startswith("ok: ")
    assert "free 3.0 GiB vs estimate 3.0 GiB (widest wave 2 x 1.5 GiB)" in s["detail"]


def test_disk_headroom_warns_below_estimate_above_floor(tmp_path, monkeypatch, capsys):
    repo = make_wide_repo(tmp_path)
    rc, receipt = run_main_with_free(repo, monkeypatch, capsys, int(2.5 * GIB))
    assert rc == 0                                   # advisory: never blocks here
    s = headroom_stage(receipt)
    assert s["ok"] is True                           # warn-as-ok:true (worktree-audit shape)
    assert s["detail"].startswith("WARN: ")
    assert "free 2.5 GiB vs estimate 3.0 GiB (widest wave 2 x 1.5 GiB)" in s["detail"]


def test_disk_headroom_warn_not_block_at_floor_boundary(tmp_path, monkeypatch, capsys):
    # free == floor (2 GiB) -> still WARN; block is strictly free < floor.
    repo = make_wide_repo(tmp_path)
    rc, receipt = run_main_with_free(repo, monkeypatch, capsys, 2 * GIB)
    assert rc == 0
    s = headroom_stage(receipt)
    assert s["ok"] is True
    assert s["detail"].startswith("WARN: ")


def test_disk_headroom_blocks_below_floor(tmp_path, monkeypatch, capsys):
    repo = make_wide_repo(tmp_path)
    rc, receipt = run_main_with_free(repo, monkeypatch, capsys, 1 * GIB)
    assert rc != 0
    assert receipt["ok"] is False
    s = headroom_stage(receipt)
    assert s["ok"] is False
    assert s["detail"].startswith("BLOCKED: ")
    assert "free 1.0 GiB vs estimate 3.0 GiB (widest wave 2 x 1.5 GiB)" in s["detail"]
    assert "min(2 GiB, estimate)" in s["detail"]
    # Blocked BEFORE anything expensive: no later stage ran.
    names = [x["stage"] for x in receipt["stages"]]
    assert "test-command" not in names and "lock" not in names


def test_disk_headroom_min_floor_narrow_run_not_blocked_by_flat_floor(
        tmp_path, monkeypatch, capsys):
    # The default PLAN chains 1 -> 2: widest wave 1 -> estimate 1.5 GiB,
    # floor min(2 GiB, 1.5 GiB) = 1.5 GiB. free 1.7 GiB >= estimate -> ok.
    # A flat 2 GiB floor would have false-blocked this narrow run.
    repo = make_repo(tmp_path)
    rc, receipt = run_main_with_free(repo, monkeypatch, capsys, int(1.7 * GIB))
    assert rc == 0
    s = headroom_stage(receipt)
    assert s["ok"] is True
    assert s["detail"].startswith("ok: ")
    assert "widest wave 1" in s["detail"]


def test_disk_headroom_min_floor_narrow_run_blocks_below_own_estimate(
        tmp_path, monkeypatch, capsys):
    # Same narrow plan, free 1.4 GiB < floor (= estimate 1.5 GiB) -> block.
    repo = make_repo(tmp_path)
    rc, receipt = run_main_with_free(repo, monkeypatch, capsys, int(1.4 * GIB))
    assert rc != 0
    s = headroom_stage(receipt)
    assert s["ok"] is False
    assert s["detail"].startswith("BLOCKED: ")


def test_disk_headroom_stage_runs_right_after_compile(tmp_path):
    # Real disk_usage (dev/CI hosts have headroom); ordering is the contract.
    repo = make_repo(tmp_path)
    r = run_driver(repo)
    assert r.returncode == 0, r.stdout + r.stderr
    names = [s["stage"] for s in json.loads(r.stdout)["stages"]]
    assert names.index("disk-headroom") == names.index("compile") + 1
    assert names.index("disk-headroom") < names.index("test-command")


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
        deadline = time.time() + 15
        while time.time() < deadline and not _probe_dirs(repo):
            time.sleep(0.1)
        assert _probe_dirs(repo), "probe worktree never appeared"
        proc.terminate()
        proc.wait(timeout=15)
    finally:
        if proc.poll() is None:
            proc.kill()
    assert proc.returncode != 0
    assert _probe_dirs(repo) == []
    wl = sh(["git", "worktree", "list", "--porcelain"], cwd=repo).stdout
    assert "wt-knob-" not in wl
