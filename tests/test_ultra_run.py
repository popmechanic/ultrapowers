"""ultra_run.py: the deterministic pre-launch driver (SKILL.md Steps 1-4b).
Every stage is exercised against a throwaway git repo; the receipt and exit
code are the contract the orchestrator consumes."""
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "skills/ultrapowers/scripts"
RUN = SCRIPTS / "ultra_run.py"

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
                     "superpowers-compat", "compile", "install",
                     "lock", "snapshot"):
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
    # lock + snapshot actually happened, with the dirty set recorded
    assert (repo / ".claude/ultrapowers/RUN_LOCK").read_text() == "t1"
    assert (repo / ".claude/ultrapowers/DIRTY_SNAPSHOT").is_file()
    # probe contract pre-computed for the orchestrator
    assert receipt["probe"]["assert"] == {"echoWaves": 1, "echoFirstId": "probe-1"}
    assert receipt["workflowName"] == "ultrapowers-run"


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


def test_validate_knobs_passes_a_clean_noop_bootstrap(tmp_path):
    repo = make_repo(tmp_path)
    args_path = repo / "args.json"
    args_path.write_text(json.dumps({"bootstrapCmd": "true"}))
    r = run_validate_knobs(repo, args_path)
    assert r.returncode == 0, r.stdout + r.stderr


def test_validate_knobs_blocks_a_failing_bootstrap(tmp_path):
    repo = make_repo(tmp_path)
    args_path = repo / "args.json"
    args_path.write_text(json.dumps({"bootstrapCmd": "false"}))
    r = run_validate_knobs(repo, args_path)
    assert r.returncode != 0


def test_validate_knobs_blocks_a_tree_dirtying_bootstrap(tmp_path):
    repo = make_repo(tmp_path)
    args_path = repo / "args.json"
    args_path.write_text(json.dumps({"bootstrapCmd": "touch dirt.txt"}))
    r = run_validate_knobs(repo, args_path)
    assert r.returncode != 0


def test_validate_knobs_is_a_noop_without_bootstrap(tmp_path):
    repo = make_repo(tmp_path)
    args_path = repo / "args.json"
    args_path.write_text(json.dumps({"testCmd": "pytest"}))
    r = run_validate_knobs(repo, args_path)
    assert r.returncode == 0, r.stdout + r.stderr


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
