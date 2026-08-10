# tests/test_record_wf_run.py
import json, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "skills/ultradocket/scripts/record_wf_run.py"
sys.path.insert(0, str(ROOT / "skills/ultrapowers/scripts"))
from ultra_gate import load_wf_runs  # the FROZEN reader is the shape authority


def record(repo, stamp, run_id):
    return subprocess.run([sys.executable, str(SCRIPT), stamp, run_id],
                          cwd=repo, capture_output=True, text=True)


def make_repo(tmp_path):
    subprocess.run(["git", "init", "-q", str(tmp_path)], check=True)
    return tmp_path


def test_record_creates_and_merges_idempotently(tmp_path):
    repo = make_repo(tmp_path)
    assert record(repo, "d1", "wf_aaa-1").returncode == 0
    assert record(repo, "d1", "wf_aaa-1").returncode == 0   # same id: no dup
    assert record(repo, "d1", "wf_bbb-2").returncode == 0   # new id: appended
    run_dir = repo / ".claude/ultrapowers/run-d1"
    ids, unreadable = load_wf_runs(run_dir)                  # round-trip through frozen reader
    assert ids == ["wf_aaa-1", "wf_bbb-2"] and not unreadable


def test_record_resolves_run_dir_from_git_toplevel_not_cwd(tmp_path):
    repo = make_repo(tmp_path)
    sub = repo / "docs"
    sub.mkdir()
    r = subprocess.run([sys.executable, str(SCRIPT), "d2", "wf_ccc-3"],
                       cwd=sub, capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    ids, _ = load_wf_runs(repo / ".claude/ultrapowers/run-d2")
    assert ids == ["wf_ccc-3"]


def test_record_refuses_unreadable_existing_file(tmp_path):
    repo = make_repo(tmp_path)
    run_dir = repo / ".claude/ultrapowers/run-d3"
    run_dir.mkdir(parents=True)
    (run_dir / "wf-runs.json").write_text("{corrupt")
    r = record(repo, "d3", "wf_ddd-4")
    assert r.returncode == 1 and "unreadable" in r.stderr.lower()
    assert (run_dir / "wf-runs.json").read_text() == "{corrupt"  # never clobbered
