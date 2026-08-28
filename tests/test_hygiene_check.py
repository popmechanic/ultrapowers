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


def _fake_gh(tmp_path, merged_head):
    """A `gh` on PATH that reports one MERGED PR for `merged_head` and an
    empty CI run list — the two calls hygiene_check.sh makes."""
    bindir = tmp_path / "bin"
    bindir.mkdir()
    gh = bindir / "gh"
    gh.write_text(
        "#!/bin/bash\n"
        "head=''; prev=''\n"
        "for a in \"$@\"; do [ \"$prev\" = --head ] && head=\"$a\"; prev=\"$a\"; done\n"
        "case \"$1 $2\" in\n"
        f"  'pr list') [ \"$head\" = '{merged_head}' ] && echo 1 || echo 0 ;;\n"
        "  *) echo '[]' ;;\n"
        "esac\n")
    gh.chmod(0o755)
    return bindir


def _run_online(repo, bindir, *extra):
    import os
    env = dict(os.environ, PATH=str(bindir) + os.pathsep + os.environ["PATH"])
    return subprocess.run(["bash", str(SCRIPT), *extra], cwd=str(repo),
                          capture_output=True, text=True, env=env)


def test_squash_merged_branch_counts_as_merged_via_gh(tmp_path):
    # #237(e): a squash-merged engine branch is never an ancestor of main, so
    # ancestry reads it as unmerged evidence forever; a MERGED PR settles it.
    repo = make_repo(tmp_path)
    _git(repo, "checkout", "-q", "-b", "worktree-wf_sq")
    (repo / "s.txt").write_text("s\n")
    _git(repo, "add", "s.txt")
    _git(repo, "commit", "-q", "-m", "squashed later")
    _git(repo, "checkout", "-q", "main")
    _git(repo, "merge", "--squash", "worktree-wf_sq")
    _git(repo, "commit", "-q", "-m", "squash-merge worktree-wf_sq")
    _git(repo, "push", "-q", "origin", "main")
    assert subprocess.run(["git", "-C", str(repo), "merge-base", "--is-ancestor",
                           "worktree-wf_sq", "main"]).returncode != 0

    # offline: ancestry only — kept as evidence, never red
    data = receipt(run(repo))
    assert data["checks"]["local_branches"]["ok"] is True
    assert "worktree-wf_sq" in data["checks"]["local_branches"]["detail"]

    # online with a gh that reports the PR merged: stale, deleted under --fix
    bindir = _fake_gh(tmp_path, "worktree-wf_sq")
    r = _run_online(repo, bindir)
    data = receipt(r)
    assert r.returncode == 1
    assert data["checks"]["local_branches"]["ok"] is False
    assert "worktree-wf_sq" in data["checks"]["local_branches"]["detail"]
    r2 = _run_online(repo, bindir, "--fix")
    data2 = receipt(r2)
    assert r2.returncode == 0, r2.stdout + r2.stderr
    assert any("worktree-wf_sq" in f for f in data2["fixed"])
    assert "worktree-wf_sq" not in _git(repo, "branch", "--list")


def test_run_dir_receipt_supplies_the_expected_branch(tmp_path):
    # Fleet-lane runs launch from `fleet-base`, not main; a hardcoded `main`
    # was red on every one of them. --run-dir reads baseBranch from the receipt.
    repo = make_repo(tmp_path)
    run_dir = tmp_path / "run-x"
    run_dir.mkdir()
    (run_dir / "receipt.json").write_text(json.dumps({"baseBranch": "main"}))
    data = receipt(run(repo, "--run-dir", str(run_dir)))
    assert data["checks"]["branch"]["ok"] is True

    (run_dir / "receipt.json").write_text(json.dumps({"baseBranch": "fleet-base"}))
    data = receipt(run(repo, "--run-dir", str(run_dir)))
    assert data["checks"]["branch"]["ok"] is False
    assert "expected 'fleet-base'" in data["checks"]["branch"]["detail"]

    # an explicit --branch wins over the receipt
    data = receipt(run(repo, "--run-dir", str(run_dir), "--branch", "main"))
    assert data["checks"]["branch"]["ok"] is True
