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


# --- #150 mode (c), writer side: the `stamp` subcommand mirrors a drain-
# administered gate outcome to a teardown-surviving record. THIS WRITER IS
# THE SCHEMA AUTHORITY — the harvester's tests invoke it to generate their
# fixtures, so the assertions here pin the exact record shape.

def stamp_record(repo, stamp, entry, verdict="PASS", exit_code=0,
                 branch="ultra/entry-x", base="ultra/docket-x"):
    return subprocess.run(
        [sys.executable, str(SCRIPT), "stamp", stamp, entry,
         "--verdict", verdict, "--exit-code", str(exit_code),
         "--branch", branch, "--base", base],
        cwd=repo, capture_output=True, text=True)


def test_stamp_mode_writes_mirror_record(tmp_path):
    repo = make_repo(tmp_path)
    r = stamp_record(repo, "20260814-120000", "146", verdict="PASS", exit_code=0)
    assert r.returncode == 0, r.stderr
    path = repo / ".claude/ultrapowers/receipts/20260814-120000-146.json"
    obj = json.loads(path.read_text())
    assert obj["mode"] == "drain-stamp"
    assert obj["stamp"] == "20260814-120000" and obj["entry"] == "146"
    assert obj["verdict"] == "PASS" and obj["gateExit"] == 0
    assert obj["branch"] == "ultra/entry-x" and obj["base"] == "ultra/docket-x"
    assert isinstance(obj["recordedAt"], str) and obj["recordedAt"]
    assert set(obj) == {"mode", "stamp", "entry", "verdict", "gateExit",
                        "branch", "base", "recordedAt"}


def _commit_on_branch(repo, branch):
    subprocess.run(["git", "-C", str(repo), "checkout", "-q", "-b", branch], check=True)
    (repo / "f.txt").write_text("x\n")
    subprocess.run(["git", "-C", str(repo), "-c", "user.name=t",
                    "-c", "user.email=t@t", "add", "f.txt"], check=True)
    subprocess.run(["git", "-C", str(repo), "-c", "user.name=t",
                    "-c", "user.email=t@t", "commit", "-q", "-m", "w"], check=True)
    return subprocess.run(["git", "-C", str(repo), "rev-parse", "HEAD"],
                          capture_output=True, text=True).stdout.strip()


def test_stamp_mode_derives_headsha_when_branch_resolvable(tmp_path):
    repo = make_repo(tmp_path)
    sha = _commit_on_branch(repo, "ultra/entry-x")     # matches stamp_record's default --branch
    r = stamp_record(repo, "s1", "e1")
    assert r.returncode == 0, r.stderr
    rec = json.loads((repo / ".claude/ultrapowers/receipts/s1-e1.json").read_text())
    assert rec["headSha"] == sha
    assert set(rec) == {"mode", "stamp", "entry", "verdict", "gateExit",
                        "branch", "base", "recordedAt", "headSha"}


def test_stamp_mode_omits_headsha_and_warns_on_unresolvable_branch(tmp_path):
    repo = make_repo(tmp_path)                          # no commits: branch cannot resolve
    r = stamp_record(repo, "s1", "e1")
    assert r.returncode == 0, r.stderr                  # recording still succeeds
    rec = json.loads((repo / ".claude/ultrapowers/receipts/s1-e1.json").read_text())
    assert "headSha" not in rec
    assert "headSha" in r.stderr                        # loud, named, non-fatal


def test_stamp_mode_re_record_overwrites_last_write_wins(tmp_path):
    # A re-gate after a fix round replaces the file — the final verdict is
    # the record.
    repo = make_repo(tmp_path)
    assert stamp_record(repo, "20260814-120000", "146",
                        verdict="BLOCKED", exit_code=1).returncode == 0
    assert stamp_record(repo, "20260814-120000", "146",
                        verdict="PASS", exit_code=0).returncode == 0
    path = repo / ".claude/ultrapowers/receipts/20260814-120000-146.json"
    obj = json.loads(path.read_text())
    assert obj["verdict"] == "PASS" and obj["gateExit"] == 0


def test_stamp_mode_leaves_run_id_mode_untouched(tmp_path):
    # Both modes on one stamp: the stamp record never touches wf-runs.json,
    # and the legacy run-id mode round-trips through the frozen reader
    # exactly as before.
    repo = make_repo(tmp_path)
    assert record(repo, "d9", "wf_zzz-9").returncode == 0
    assert stamp_record(repo, "d9", "146").returncode == 0
    ids, unreadable = load_wf_runs(repo / ".claude/ultrapowers/run-d9")
    assert ids == ["wf_zzz-9"] and not unreadable


def test_stamp_mode_rejects_path_separator_in_names(tmp_path):
    repo = make_repo(tmp_path)
    assert stamp_record(repo, "20260814-120000", "a/b").returncode == 2
    assert stamp_record(repo, "a/b", "146").returncode == 2


def test_stamp_mode_missing_required_flag_exits_2(tmp_path):
    repo = make_repo(tmp_path)
    r = subprocess.run([sys.executable, str(SCRIPT), "stamp", "s", "e"],
                       cwd=repo, capture_output=True, text=True)
    assert r.returncode == 2


def test_stamp_mode_outside_git_repo_exits_1(tmp_path):
    # #156 item 7 pin: a non-git cwd is a loud exit 1, never a silent write.
    r = subprocess.run(
        [sys.executable, str(SCRIPT), "stamp", "s", "e",
         "--verdict", "PASS", "--exit-code", "0", "--branch", "b", "--base", "m"],
        cwd=tmp_path, capture_output=True, text=True)
    assert r.returncode == 1
    assert "not inside a git repository" in r.stderr
