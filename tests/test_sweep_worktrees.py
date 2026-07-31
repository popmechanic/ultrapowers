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
    assert wt_locked.exists()                       # locked => kept by default
    assert "kept (locked" in p.stdout
    assert not wt_real.exists()
    assert "swept:" in p.stdout          # the summary line printed — no mid-sweep abort


def test_sweep_force_removes_locked_worktree(tmp_path):
    repo = make_repo(tmp_path)
    wt_locked, br = add_engine_worktree(repo, "locked-f", "lf.txt", merge=True)
    git(repo, "worktree", "lock", str(wt_locked))

    p = subprocess.run(["bash", str(SWEEP), "--force"], cwd=repo,
                       capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    assert not wt_locked.exists()
    assert branches(repo) == []


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


def test_sweep_root_survives_separate_git_dir(tmp_path):
    # --separate-git-dir puts the git dir OUTSIDE the repo: dirname(common-dir)
    # resolves to the git dir's parent, and the old derivation died with
    # "fatal: not a git repository".
    repo = tmp_path / "repo"
    repo.mkdir()
    gitdir = tmp_path / "gitdir"
    subprocess.run(["git", "init", "-b", "main", "--separate-git-dir", str(gitdir),
                    str(repo)], check=True, capture_output=True)
    git(repo, "config", "user.email", "sweep@test")
    git(repo, "config", "user.name", "sweep test")
    (repo / "a.txt").write_text("a\n")
    git(repo, "add", ".")
    git(repo, "commit", "-m", "init")
    wt, br = add_engine_worktree(repo, "sep", "s.txt", merge=True)

    p = subprocess.run(["bash", str(SWEEP)], cwd=repo, capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    assert not wt.exists()
    assert branches(repo) == []


def test_sweep_scoped_to_runid_spares_sibling_run(tmp_path):
    repo = make_repo(tmp_path)
    wt_a, _ = add_engine_worktree(repo, "AAA-1", "aaa.txt", merge=False)
    wt_b, _ = add_engine_worktree(repo, "BBB-1", "bbb.txt", merge=False)
    p = subprocess.run(["bash", str(SWEEP), "--run", "AAA", "--force"],
                       cwd=repo, capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    assert not wt_a.exists()
    assert wt_b.exists()  # sibling run survives
    assert any("BBB" in b for b in branches(repo))


def test_sweep_run_accepts_wf_prefixed_runid(tmp_path):
    # The SKILL/run_lock identify a run as the wf_<id> transcript stem, while the
    # globs prepend wf_ themselves; --run must accept BOTH wf_<id> and bare <id>,
    # else a wf_-prefixed scope builds a wf_wf_<id>-* glob that silently sweeps 0.
    repo = make_repo(tmp_path)
    wt_a, _ = add_engine_worktree(repo, "AAA-9", "aaa9.txt", merge=True)
    wt_b, _ = add_engine_worktree(repo, "BBB-9", "bbb9.txt", merge=True)
    p = subprocess.run(["bash", str(SWEEP), "--run", "wf_AAA"],
                       cwd=repo, capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    assert not wt_a.exists()                     # wf_-prefixed scope matched
    assert wt_b.exists()                         # sibling run spared
    assert "1 worktree(s) removed" in p.stdout


def test_sweep_no_scope_is_repo_wide(tmp_path):
    repo = make_repo(tmp_path)
    wt_a, _ = add_engine_worktree(repo, "AAA-2", "aaa2.txt", merge=False)
    wt_b, _ = add_engine_worktree(repo, "BBB-2", "bbb2.txt", merge=False)
    subprocess.run(["bash", str(SWEEP), "--force"], cwd=repo,
                   capture_output=True, text=True)
    assert not wt_a.exists() and not wt_b.exists()  # both removed (back-compat)


def test_scoped_sweep_reports_what_it_left_behind(tmp_path):
    """Finding 1 (vibes.diy 2026-07-31): a scoped sweep silently no-oped on 20
    non-matching wf_* dirs (~23 GB). The sweep must account for every wf_* entry
    it did NOT remove."""
    repo = make_repo(tmp_path)
    add_engine_worktree(repo, "run1-1", "e.txt", merge=True)
    wt_other, _ = add_engine_worktree(repo, "run2-1", "f.txt", merge=False)

    p = subprocess.run(["bash", str(SWEEP), "--run", "run1"], cwd=repo,
                       capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    assert wt_other.exists()                        # out of scope — kept
    assert f"left behind: {wt_other}" in p.stdout   # ...but accounted for
    assert "left behind: 1 worktree(s)" in p.stdout
    assert "d old" in p.stdout                      # age is part of the line


def test_clean_sweep_reports_no_leftovers(tmp_path):
    repo = make_repo(tmp_path)
    add_engine_worktree(repo, "test-9", "g.txt", merge=True)
    p = subprocess.run(["bash", str(SWEEP)], cwd=repo,
                       capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    assert "left behind" not in p.stdout


def test_locked_leftover_is_reported_with_lock_marker(tmp_path):
    """A live run's locked worktree is kept AND shows up in the accounting —
    reported, never an error (exit stays 0)."""
    repo = make_repo(tmp_path)
    wt, _ = add_engine_worktree(repo, "live-1", "i.txt", merge=False)
    git(repo, "worktree", "lock", str(wt))
    p = subprocess.run(["bash", str(SWEEP)], cwd=repo,
                       capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    assert wt.exists()
    assert f"left behind: {wt}" in p.stdout
    assert "locked" in p.stdout


def test_stale_run_lock_fallback_is_loud_and_all_overrides_it(tmp_path):
    """The stale-RUN_LOCK scoping trap: with no --run, a leftover RUN_LOCK
    silently narrowed even an intended repo-wide sweep to one run. Now the
    inherited scope is announced, the skipped dirs are accounted for, and
    --all performs the intended repo-wide sweep."""
    repo = make_repo(tmp_path)
    lockdir = repo / ".claude" / "ultrapowers"
    lockdir.mkdir(parents=True)
    (lockdir / "RUN_LOCK").write_text("stale-run")
    wt, _ = add_engine_worktree(repo, "otherrun-1", "h.txt", merge=True)

    p = subprocess.run(["bash", str(SWEEP)], cwd=repo,
                       capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    assert "scope inherited from RUN_LOCK (stale-run)" in p.stdout
    assert wt.exists()
    assert f"left behind: {wt}" in p.stdout

    p = subprocess.run(["bash", str(SWEEP), "--all"], cwd=repo,
                       capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    assert not wt.exists()
    assert "left behind" not in p.stdout
    assert "scope inherited" not in p.stdout


def test_all_and_run_are_mutually_exclusive(tmp_path):
    repo = make_repo(tmp_path)
    p = subprocess.run(["bash", str(SWEEP), "--all", "--run", "x"], cwd=repo,
                       capture_output=True, text=True)
    assert p.returncode == 2


# GNU coreutils declares -f as --file-system with NO option-argument, so
# `stat -f %m DIR` is parsed as two FILE operands: %m fails (stderr) while DIR
# succeeds and prints a multi-line filesystem block on STDOUT, and stat still
# exits 1. A `stat -f %m … || stat -c %Y …` chain therefore CONCATENATES that
# block with the real epoch on Linux, and the arithmetic that consumes it
# aborts the sweep under `set -euo pipefail` — a macOS-only green.
GNU_STAT_SHIM = r"""#!/bin/sh
# stat(1) with GNU coreutils semantics: -f is --file-system, takes no format.
fsmode=0
fmt=""
while [ $# -gt 0 ]; do
  case "$1" in
    -f) fsmode=1; shift ;;
    -c) fmt="$2"; shift 2 ;;
    --) shift; break ;;
    -*) shift ;;
    *) break ;;
  esac
done
rc=0
for op in "$@"; do
  if [ ! -e "$op" ]; then
    echo "stat: cannot statx '$op': No such file or directory" >&2
    rc=1
    continue
  fi
  if [ "$fsmode" -eq 1 ]; then
    printf '  File: "%s"\n    ID: 9f2c1d0a4b Namelen: 255 Type: ext2/ext3\n' "$op"
  else
    case "$fmt" in
      %Y) echo __MTIME__ ;;
      *)  echo "$fmt" ;;
    esac
  fi
done
exit $rc
"""


def test_leftover_accounting_survives_gnu_stat_semantics(tmp_path):
    """Linux/CI portability: the leftover accounting must still exit 0 and print
    a well-formed report when stat(1) has GNU semantics (`-f` = --file-system,
    no format argument, stdout noise + exit 1)."""
    import os
    import time

    repo = make_repo(tmp_path)
    wt_other, _ = add_engine_worktree(repo, "run2-1", "f.txt", merge=False)

    shim_dir = tmp_path / "gnubin"
    shim_dir.mkdir()
    mtime = int(time.time()) - 3 * 86400 - 60      # 3 days old, comfortably
    shim = shim_dir / "stat"
    shim.write_text(GNU_STAT_SHIM.replace("__MTIME__", str(mtime)))
    shim.chmod(0o755)

    env = dict(os.environ, PATH=f"{shim_dir}:{os.environ['PATH']}")
    p = subprocess.run(["bash", str(SWEEP), "--run", "run1"], cwd=repo,
                       capture_output=True, text=True, env=env)
    assert p.returncode == 0, p.stdout + p.stderr
    # The GNU fallback's epoch is used verbatim — no filesystem-block pollution.
    assert f"left behind: {wt_other} " in p.stdout
    assert "3d old" in p.stdout
    assert "File:" not in p.stdout
    assert "left behind: 1 worktree(s)" in p.stdout


def test_leftover_accounting_survives_unreadable_subdirectory(tmp_path):
    """`du -sk` exits 1 on a permission-denied (or racing, still-live) subtree.
    Under `set -euo pipefail` that must NOT fail the sweep mid-report:
    reporting leftovers is stdout, never a failure."""
    import os

    if os.geteuid() == 0:
        import pytest
        pytest.skip("root ignores directory permissions, so du never fails")

    repo = make_repo(tmp_path)
    wt_other, _ = add_engine_worktree(repo, "run2-1", "f.txt", merge=False)
    blocked = wt_other / "unreadable"
    blocked.mkdir()
    (blocked / "big.bin").write_text("x" * 64)
    os.chmod(blocked, 0o000)
    try:
        p = subprocess.run(["bash", str(SWEEP), "--run", "run1"], cwd=repo,
                           capture_output=True, text=True)
        assert p.returncode == 0, p.stdout + p.stderr
        assert f"left behind: {wt_other} " in p.stdout
        assert "left behind: 1 worktree(s)" in p.stdout
    finally:
        os.chmod(blocked, 0o755)
