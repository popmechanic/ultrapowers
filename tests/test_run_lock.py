"""Tests for run_lock.sh — acquire/check/release/snapshot/restore primitives.

Mirrors the subprocess + temp-git-repo idiom used by test_sweep_worktrees.py.
"""
import subprocess
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
LOCK = ROOT / "skills/ultrapowers/scripts/run_lock.sh"


def _git(repo, *args):
    subprocess.run(["git", "-C", str(repo), *args], check=True,
                   capture_output=True, text=True)


def _repo(tmp_path):
    r = tmp_path / "repo"
    r.mkdir()
    _git(r, "init", "-b", "main")
    _git(r, "config", "user.email", "t@t")
    _git(r, "config", "user.name", "t")
    (r / "f").write_text("x")
    _git(r, "add", ".")
    _git(r, "commit", "-m", "init")
    return r


def _run(repo, *args):
    return subprocess.run(["bash", str(LOCK), *args], cwd=repo,
                          capture_output=True, text=True)


def test_acquire_then_conflicting_acquire_refuses(tmp_path):
    repo = _repo(tmp_path)
    assert _run(repo, "acquire", "AAA").returncode == 0
    assert (repo / ".claude/ultrapowers/RUN_LOCK").read_text().strip() == "AAA"
    p = _run(repo, "acquire", "BBB")
    assert p.returncode != 0 and "AAA" in (p.stdout + p.stderr)
    assert _run(repo, "release", "AAA").returncode == 0
    assert _run(repo, "acquire", "BBB").returncode == 0


def test_snapshot_restore_returns_to_original_branch(tmp_path):
    repo = _repo(tmp_path)
    _git(repo, "checkout", "-b", "feature")
    assert _run(repo, "snapshot").returncode == 0
    _git(repo, "checkout", "-b", "ultra/integration")
    assert _run(repo, "restore").returncode == 0
    cur = subprocess.run(["git", "-C", str(repo), "branch", "--show-current"],
                         capture_output=True, text=True).stdout.strip()
    assert cur == "feature"


def test_acquire_is_idempotent_for_same_runid(tmp_path):
    """Acquiring the same runId twice should succeed (no self-lock)."""
    repo = _repo(tmp_path)
    assert _run(repo, "acquire", "AAA").returncode == 0
    assert _run(repo, "acquire", "AAA").returncode == 0


def test_check_returns_0_when_lock_held(tmp_path):
    repo = _repo(tmp_path)
    _run(repo, "acquire", "AAA")
    assert _run(repo, "check", "AAA").returncode == 0


def test_check_returns_nonzero_when_lock_absent(tmp_path):
    repo = _repo(tmp_path)
    assert _run(repo, "check", "AAA").returncode != 0


def test_release_removes_lock_file(tmp_path):
    repo = _repo(tmp_path)
    _run(repo, "acquire", "AAA")
    _run(repo, "release", "AAA")
    assert not (repo / ".claude/ultrapowers/RUN_LOCK").exists()


def test_release_does_not_remove_lock_held_by_other(tmp_path):
    """release <id> is a no-op if the lock is held by a different runId."""
    repo = _repo(tmp_path)
    _run(repo, "acquire", "AAA")
    _run(repo, "release", "BBB")   # wrong id — should be no-op
    assert (repo / ".claude/ultrapowers/RUN_LOCK").exists()
    assert (repo / ".claude/ultrapowers/RUN_LOCK").read_text().strip() == "AAA"


def test_restore_fails_gracefully_when_no_snapshot(tmp_path):
    repo = _repo(tmp_path)
    p = _run(repo, "restore")
    assert p.returncode != 0


def test_unknown_command_exits_nonzero(tmp_path):
    repo = _repo(tmp_path)
    p = _run(repo, "frobnicate")
    assert p.returncode != 0 and "usage" in (p.stdout + p.stderr).lower()
