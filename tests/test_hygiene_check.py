"""hygiene_check.sh (#253): report-only close-of-run git hygiene — one JSON
receipt, exit 0 iff clean; --fix deletes only merged engine branches."""
import json
import pathlib
import subprocess

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / \
    "skills/ultrapowers/scripts/hygiene_check.sh"


def _git(repo, *a):
    return subprocess.run(["git", "-C", str(repo), *a], check=True,
                          capture_output=True, text=True).stdout.strip()


def make_repo(tmp_path):
    """A main-branch repo with a file: origin bare remote, pushed, in sync."""
    origin = tmp_path / "origin.git"
    subprocess.run(["git", "init", "-q", "--bare", "-b", "main", str(origin)],
                   check=True)
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init", "-q", "-b", "main")
    _git(repo, "config", "user.email", "t@t")
    _git(repo, "config", "user.name", "t")
    (repo / "a.txt").write_text("a\n")
    _git(repo, "add", "a.txt")
    _git(repo, "commit", "-q", "-m", "base")
    _git(repo, "remote", "add", "origin", str(origin))
    _git(repo, "push", "-q", "-u", "origin", "main")
    return repo


def run(repo, *extra):
    return subprocess.run(["bash", str(SCRIPT), "--no-fetch", *extra],
                          cwd=str(repo), capture_output=True, text=True)


def receipt(r):
    data = json.loads(r.stdout)
    assert isinstance(data["clean"], bool) and "checks" in data
    return data


def test_clean_repo_exits_zero_with_clean_receipt(tmp_path):
    r = run(make_repo(tmp_path))
    data = receipt(r)
    assert r.returncode == 0, r.stdout + r.stderr
    assert data["clean"] is True
    assert all(c["ok"] for c in data["checks"].values())


def test_dirty_tree_is_named_never_stashed(tmp_path):
    repo = make_repo(tmp_path)
    (repo / "dirt.txt").write_text("x\n")
    r = run(repo)
    data = receipt(r)
    assert r.returncode == 1
    assert data["checks"]["tree"]["ok"] is False
    assert "dirt.txt" in data["checks"]["tree"]["detail"]
    assert (repo / "dirt.txt").exists()          # never auto-stashed
    assert _git(repo, "stash", "list") == ""


def test_wrong_branch_is_red(tmp_path):
    repo = make_repo(tmp_path)
    _git(repo, "checkout", "-q", "-b", "feature")
    r = run(repo)
    assert r.returncode == 1
    assert receipt(r)["checks"]["branch"]["ok"] is False


def test_run_lock_is_red(tmp_path):
    repo = make_repo(tmp_path)
    (repo / ".claude/ultrapowers").mkdir(parents=True)
    (repo / ".claude/ultrapowers/RUN_LOCK").write_text("run-x")
    r = run(repo)
    data = receipt(r)
    assert r.returncode == 1
    assert data["checks"]["run_lock"]["ok"] is False
    assert "run-x" in data["checks"]["run_lock"]["detail"]


def test_out_of_sync_reports_ahead_behind(tmp_path):
    repo = make_repo(tmp_path)
    (repo / "b.txt").write_text("b\n")
    _git(repo, "add", "b.txt")
    _git(repo, "commit", "-q", "-m", "local only")   # ahead 1, not pushed
    r = run(repo)
    data = receipt(r)
    assert r.returncode == 1
    assert data["checks"]["sync"]["ok"] is False
    assert "ahead 1" in data["checks"]["sync"]["detail"]


def test_extra_worktree_and_leftover_dir_are_red(tmp_path):
    repo = make_repo(tmp_path)
    _git(repo, "worktree", "add", "-q", str(tmp_path / "wt"), "-b", "tmp-wt")
    (repo / ".claude/ultrapowers/wt-probe-1").mkdir(parents=True)
    r = run(repo)
    data = receipt(r)
    assert r.returncode == 1
    assert data["checks"]["worktrees"]["ok"] is False
    assert "wt-probe-1" in data["checks"]["worktrees"]["detail"]


def test_merged_engine_branch_listed_then_deleted_by_fix(tmp_path):
    repo = make_repo(tmp_path)
    _git(repo, "branch", "worktree-wf_x")            # merged by construction
    _git(repo, "checkout", "-q", "-b", "ultra/integration-y")
    (repo / "c.txt").write_text("c\n")
    _git(repo, "add", "c.txt")
    _git(repo, "commit", "-q", "-m", "unmerged evidence")
    _git(repo, "checkout", "-q", "main")

    r = run(repo)
    data = receipt(r)
    assert r.returncode == 1
    assert data["checks"]["local_branches"]["ok"] is False
    assert "worktree-wf_x" in data["checks"]["local_branches"]["detail"]

    r2 = run(repo, "--fix")
    data2 = receipt(r2)
    assert r2.returncode == 0, r2.stdout + r2.stderr
    assert any("worktree-wf_x" in f for f in data2["fixed"])
    # the unmerged branch is kept as evidence, reported informationally
    assert "ultra/integration-y" in data2["checks"]["local_branches"]["detail"]
    branches = _git(repo, "branch", "--list")
    assert "worktree-wf_x" not in branches
    assert "ultra/integration-y" in branches


def test_merged_remote_branch_listed_then_deleted_by_fix(tmp_path):
    repo = make_repo(tmp_path)
    _git(repo, "branch", "worktree-wf_z")
    _git(repo, "push", "-q", "origin", "worktree-wf_z")
    _git(repo, "branch", "-D", "worktree-wf_z")      # remote copy remains

    r = run(repo)
    data = receipt(r)
    assert r.returncode == 1
    assert data["checks"]["remote_branches"]["ok"] is False
    assert "worktree-wf_z" in data["checks"]["remote_branches"]["detail"]

    r2 = run(repo, "--fix")
    data2 = receipt(r2)
    assert r2.returncode == 0, r2.stdout + r2.stderr
    assert any("worktree-wf_z" in f for f in data2["fixed"])
    assert "worktree-wf_z" not in _git(repo, "ls-remote", "--heads", "origin")


def test_ci_check_is_informational_only(tmp_path):
    # --no-fetch skips gh; the ci entry must exist as info and never gate exit
    r = run(make_repo(tmp_path))
    data = receipt(r)
    assert data["checks"]["ci"]["state"] == "info"
    assert r.returncode == 0
