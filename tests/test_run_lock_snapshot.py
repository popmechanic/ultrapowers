"""run_lock.sh snapshot: records the porcelain dirty set alongside the
branch/sha snapshot, so the gate can block on NEW dirt only."""
import pathlib
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[1]
LOCK = ROOT / "skills/ultrapowers/scripts/run_lock.sh"


def sh(cmd, cwd=None, check=True):
    return subprocess.run(cmd, cwd=cwd, check=check, capture_output=True, text=True)


def make_repo(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    sh(["git", "init", "-q", "-b", "main"], cwd=repo)
    sh(["git", "config", "user.email", "t@t"], cwd=repo)
    sh(["git", "config", "user.name", "t"], cwd=repo)
    (repo / ".gitignore").write_text(".claude/\n")
    (repo / "f.txt").write_text("base\n")
    sh(["git", "add", "."], cwd=repo)
    sh(["git", "commit", "-qm", "base"], cwd=repo)
    return repo


def test_snapshot_records_empty_dirty_set_when_clean(tmp_path):
    repo = make_repo(tmp_path)
    sh(["bash", str(LOCK), "snapshot"], cwd=repo)
    dirty = repo / ".claude/ultrapowers/DIRTY_SNAPSHOT"
    assert dirty.is_file()
    assert dirty.read_text().strip() == ""


def test_snapshot_records_preexisting_dirt(tmp_path):
    repo = make_repo(tmp_path)
    (repo / "f.txt").write_text("modified\n")          # tracked, modified
    (repo / "notes.md").write_text("operator file\n")  # untracked
    sh(["bash", str(LOCK), "snapshot"], cwd=repo)
    recorded = (repo / ".claude/ultrapowers/DIRTY_SNAPSHOT").read_text()
    assert " M f.txt" in recorded
    assert "?? notes.md" in recorded


def test_restore_still_works_after_snapshot(tmp_path):
    repo = make_repo(tmp_path)
    sh(["bash", str(LOCK), "snapshot"], cwd=repo)
    sh(["git", "checkout", "-qb", "other"], cwd=repo)
    sh(["bash", str(LOCK), "restore"], cwd=repo)
    cur = sh(["git", "branch", "--show-current"], cwd=repo).stdout.strip()
    assert cur == "main"
