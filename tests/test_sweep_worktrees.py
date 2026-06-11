"""End-to-end test for sweep_worktrees.sh — the non-stubbed cleanup check the
completeness critic demanded: a REAL repo, REAL worktrees, and assertions that
removal actually happens (merged branch deleted, unmerged branch kept)."""
import pathlib
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[1]
SWEEP = ROOT / "skills/ultrapowers/scripts/sweep_worktrees.sh"


def git(cwd, *args):
    return subprocess.run(["git", *args], cwd=cwd, check=True,
                          capture_output=True, text=True)


def make_repo(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    git(repo, "init", "-b", "main")
    git(repo, "config", "user.email", "sweep@test")
    git(repo, "config", "user.name", "sweep test")
    (repo / "a.txt").write_text("a\n")
    git(repo, "add", ".")
    git(repo, "commit", "-m", "init")
    return repo


def add_engine_worktree(repo, name, filename, merge):
    """Create an engine-style worktree+branch with one commit; optionally merge it."""
    wt = repo / ".claude" / "worktrees" / f"wf_{name}"
    branch = f"worktree-wf_{name}"
    git(repo, "worktree", "add", "-b", branch, str(wt))
    (wt / filename).write_text(filename + "\n")
    git(wt, "add", ".")
    git(wt, "commit", "-m", f"add {filename}")
    if merge:
        git(repo, "merge", "--no-ff", branch, "-m", f"merge {branch}")
    return wt, branch


def branches(repo):
    out = git(repo, "branch", "--list", "worktree-wf_*",
              "--format=%(refname:short)").stdout.split()
    return sorted(out)


def test_sweep_removes_all_worktrees_deletes_merged_keeps_unmerged(tmp_path):
    repo = make_repo(tmp_path)
    wt_merged, br_merged = add_engine_worktree(repo, "test-1", "b.txt", merge=True)
    wt_failed, br_failed = add_engine_worktree(repo, "test-2", "c.txt", merge=False)

    p = subprocess.run(["bash", str(SWEEP)], cwd=repo, capture_output=True, text=True)
    assert p.returncode == 0, p.stderr

    # Worktree DIRECTORIES always go (branches carry the commits).
    assert not wt_merged.exists()
    assert not wt_failed.exists()
    # Merged branch deleted; unmerged (failed/blocked work) kept for inspection.
    assert branches(repo) == [br_failed]
    assert "kept (unmerged" in p.stdout
    # The kept branch still resolves — the failed work is inspectable.
    git(repo, "rev-parse", br_failed)


def test_sweep_force_deletes_unmerged_after_triage(tmp_path):
    repo = make_repo(tmp_path)
    add_engine_worktree(repo, "test-3", "d.txt", merge=False)

    p = subprocess.run(["bash", str(SWEEP), "--force"], cwd=repo,
                       capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    assert branches(repo) == []


def test_sweep_is_a_noop_on_a_clean_repo(tmp_path):
    repo = make_repo(tmp_path)
    p = subprocess.run(["bash", str(SWEEP)], cwd=repo, capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    assert "0 worktree(s) removed, 0 branch(es) deleted" in p.stdout
