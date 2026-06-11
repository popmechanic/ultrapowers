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


def test_sweep_survives_stale_dir_and_locked_worktree(tmp_path):
    repo = make_repo(tmp_path)
    # A stale plain directory git does not recognize, sorting BEFORE a real worktree.
    stale = repo / ".claude" / "worktrees" / "wf_aaa-stale"
    stale.mkdir(parents=True)
    (stale / "junk.txt").write_text("junk\n")
    wt_locked, _ = add_engine_worktree(repo, "mmm-locked", "l.txt", merge=True)
    git(repo, "worktree", "lock", str(wt_locked))
    wt_real, _ = add_engine_worktree(repo, "zzz-real", "z.txt", merge=True)

    p = subprocess.run(["bash", str(SWEEP)], cwd=repo, capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    assert not stale.exists()
    assert not wt_locked.exists()
    assert not wt_real.exists()
    assert "swept:" in p.stdout          # the summary line printed — no mid-sweep abort


def test_sweep_force_keeps_checked_out_branch_and_finishes(tmp_path):
    repo = make_repo(tmp_path)
    add_engine_worktree(repo, "other", "o.txt", merge=False)
    # An unmerged worktree-wf_ branch checked out in the MAIN repo: -d and -D both fail.
    git(repo, "checkout", "-b", "worktree-wf_co")
    (repo / "co.txt").write_text("co\n")
    git(repo, "add", ".")
    git(repo, "commit", "-m", "co work")

    p = subprocess.run(["bash", str(SWEEP), "--force"], cwd=repo,
                       capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    assert "kept (cannot delete" in p.stdout
    assert "swept:" in p.stdout                       # summary still printed
    assert branches(repo) == ["worktree-wf_co"]       # the other one was force-deleted


def test_sweep_reports_checked_out_merged_branch_distinctly(tmp_path):
    repo = make_repo(tmp_path)
    git(repo, "checkout", "-b", "worktree-wf_merged-co")   # zero commits: fully merged
    p = subprocess.run(["bash", str(SWEEP)], cwd=repo, capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    assert "kept (merged but undeletable" in p.stdout
    assert "kept (unmerged" not in p.stdout


def test_sweep_rejects_unknown_argument(tmp_path):
    repo = make_repo(tmp_path)
    p = subprocess.run(["bash", str(SWEEP), "--froce"], cwd=repo,
                       capture_output=True, text=True)
    assert p.returncode == 2
    assert "usage" in p.stderr.lower()


def test_sweep_from_inside_a_worktree_still_sweeps(tmp_path):
    repo = make_repo(tmp_path)
    wt_a, _ = add_engine_worktree(repo, "inside", "i.txt", merge=True)
    wt_b, _ = add_engine_worktree(repo, "other", "x.txt", merge=True)

    # cwd INSIDE an engine worktree: ROOT must still resolve to the main repo.
    p = subprocess.run(["bash", str(SWEEP)], cwd=wt_a, capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    assert not wt_a.exists()
    assert not wt_b.exists()
    assert "2 worktree(s) removed" in p.stdout


def test_sweep_warns_but_finishes_when_rm_fails(tmp_path):
    import os
    repo = make_repo(tmp_path)
    stale = repo / ".claude" / "worktrees" / "wf_aaa-protected"
    stale.mkdir(parents=True)
    (stale / "f.txt").write_text("f\n")
    wt_real, _ = add_engine_worktree(repo, "zzz-real", "z.txt", merge=True)
    os.chmod(stale, 0o555)   # contents cannot be unlinked -> rm -rf fails
    try:
        p = subprocess.run(["bash", str(SWEEP)], cwd=repo, capture_output=True, text=True)
        assert p.returncode == 0, p.stderr
        assert "warn: could not fully remove" in p.stderr
        assert not wt_real.exists()          # later worktree still swept
        assert "swept:" in p.stdout          # summary still printed
        assert "1 worktree(s) removed" in p.stdout  # protected stale dir must not be counted
    finally:
        os.chmod(stale, 0o755)               # let pytest clean tmp_path


def test_sweep_warns_when_removing_the_callers_worktree(tmp_path):
    repo = make_repo(tmp_path)
    wt, _ = add_engine_worktree(repo, "cwd", "c.txt", merge=True)
    p = subprocess.run(["bash", str(SWEEP)], cwd=wt, capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    assert not wt.exists()
    assert "current directory" in p.stderr   # the caller is told their cwd is gone
