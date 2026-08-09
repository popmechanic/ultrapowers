"""Tests for run_lock.sh — the acquire/check/release lock primitives.

Mirrors the subprocess + temp-git-repo idiom used by test_sweep_worktrees.py.

The snapshot/restore family was retired in #104: since #84 the engine never
touches the session checkout, so there is nothing to snapshot or restore. The
lock proper is untouched by that subtraction — the pins below hold it intact
and hold the retired subcommands retired.
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


def test_unknown_command_exits_nonzero(tmp_path):
    repo = _repo(tmp_path)
    p = _run(repo, "frobnicate")
    assert p.returncode != 0 and "usage" in (p.stdout + p.stderr).lower()


def _branch(repo):
    return subprocess.run(["git", "-C", str(repo), "branch", "--show-current"],
                          capture_output=True, text=True).stdout.strip()


def test_snapshot_and_restore_are_retired(tmp_path):
    """#104: both subcommands are gone, so both hit the usage branch (exit 2).
    A deletion, not a deprecation — no flag, no shim, no silent no-op."""
    repo = _repo(tmp_path)
    for retired in ("snapshot", "restore"):
        p = _run(repo, retired)
        assert p.returncode == 2, retired
        assert "usage" in (p.stdout + p.stderr).lower()
    assert not (repo / ".claude/ultrapowers/CHECKOUT_SNAPSHOT").exists()
    assert not (repo / ".claude/ultrapowers/DIRTY_SNAPSHOT").exists()


def test_usage_line_advertises_only_the_lock(tmp_path):
    """The usage line is the script's own contract statement — it must not
    keep offering a family that no longer exists."""
    repo = _repo(tmp_path)
    p = _run(repo, "frobnicate")
    msg = p.stdout + p.stderr
    assert "acquire|check|release" in msg
    assert "snapshot" not in msg and "restore" not in msg


def test_retired_subcommands_never_move_the_checkout(tmp_path):
    """The family's one recorded action was destructive (0.0.35 incident).
    Invoking the retired names must leave the tree exactly where it was."""
    repo = _repo(tmp_path)
    _git(repo, "checkout", "-b", "feature")
    _run(repo, "snapshot")
    _git(repo, "checkout", "-b", "ultra/integration")
    _run(repo, "restore")
    assert _branch(repo) == "ultra/integration"
