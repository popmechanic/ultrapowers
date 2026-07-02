"""gate_check.py: the deterministic pre-merge gate checks (SKILL.md Step 5).
Every check is exercised against a throwaway git repo; git is ground truth,
so a corrupted report can only yield BLOCKED, never a false PASS."""
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "skills/ultrapowers/scripts"
GATE = SCRIPTS / "gate_check.py"


def sh(cmd, cwd=None, check=True):
    return subprocess.run(cmd, cwd=cwd, check=check, capture_output=True, text=True)


def make_repo(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    sh(["git", "init", "-q", "-b", "main"], cwd=repo)
    sh(["git", "config", "user.email", "t@t"], cwd=repo)
    sh(["git", "config", "user.name", "t"], cwd=repo)
    # .claude/ holds RUN_LOCK (untracked); ignore it or the clean-tree check
    # sees the lock file itself as dirt — mirrors the real repo's .gitignore.
    (repo / ".gitignore").write_text(".claude/\n")
    (repo / "f.txt").write_text("base\n")
    sh(["git", "add", "."], cwd=repo)
    sh(["git", "commit", "-qm", "base"], cwd=repo)
    sh(["git", "checkout", "-qb", "ultra/int"], cwd=repo)
    (repo / "f.txt").write_text("work\n")
    sh(["git", "add", "."], cwd=repo)
    sh(["git", "commit", "-qm", "work"], cwd=repo)
    head = sh(["git", "rev-parse", "HEAD"], cwd=repo).stdout.strip()
    sh(["git", "checkout", "-q", "main"], cwd=repo)
    sh(["bash", str(SCRIPTS / "run_lock.sh"), "acquire", "wf_test"], cwd=repo)
    return repo, head


def good_report(head):
    return {
        "waveMerges": [{"wave": 1, "status": "MERGED", "headSha": head, "branches": ["A"]}],
        "gitVerified": True,
        "ancestryMisses": [],
        "missingDeliverables": [],
        "coverage": {"tasks_merged": 1, "tasks_planned": 1, "complete": True},
        "deferredVerification": [],
    }


def run_gate(repo, report, run_id="wf_test", branch="ultra/int"):
    # The report lives OUTSIDE the repo — an untracked report.json inside it
    # would (correctly) trip the clean-tree check this suite is testing.
    rp = repo.parent / "report.json"
    rp.write_text(json.dumps(report) if isinstance(report, dict) else report)
    p = subprocess.run(
        [sys.executable, str(GATE), "--run-id", run_id, "--branch", branch,
         "--report", str(rp), "--repo", str(repo)],
        capture_output=True, text=True)
    return p, json.loads(p.stdout)


def check_named(out, name):
    return next(c for c in out["checks"] if c["name"] == name)


def test_all_green_is_pass_exit_0(tmp_path):
    repo, head = make_repo(tmp_path)
    p, out = run_gate(repo, good_report(head))
    assert p.returncode == 0 and out["verdict"] == "PASS", p.stdout
    assert all(c["ok"] for c in out["checks"]) and out["acks"] == []


def test_lock_mismatch_blocks(tmp_path):
    repo, head = make_repo(tmp_path)
    p, out = run_gate(repo, good_report(head), run_id="wf_other")
    assert p.returncode == 1 and out["verdict"] == "BLOCKED"
    assert not check_named(out, "lock")["ok"]


def test_dirty_tree_blocks(tmp_path):
    repo, head = make_repo(tmp_path)
    (repo / "stray.txt").write_text("leak\n")
    p, out = run_gate(repo, good_report(head))
    assert p.returncode == 1 and not check_named(out, "clean-tree")["ok"]
    assert "stray.txt" in check_named(out, "clean-tree")["detail"]


def test_empty_wave_merges_blocks_with_named_guard(tmp_path):
    repo, head = make_repo(tmp_path)
    r = good_report(head)
    r["waveMerges"] = []
    p, out = run_gate(repo, r)
    assert p.returncode == 1
    assert "merge-sha guard unavailable" in check_named(out, "wave-merges")["detail"]


def test_head_mismatch_blocks(tmp_path):
    repo, head = make_repo(tmp_path)
    r = good_report(head)
    r["waveMerges"][-1]["headSha"] = "0" * 40
    p, out = run_gate(repo, r)
    assert p.returncode == 1 and not check_named(out, "head-match")["ok"]


def test_unverified_critic_blocks(tmp_path):
    repo, head = make_repo(tmp_path)
    r = good_report(head)
    r["gitVerified"] = False
    p, out = run_gate(repo, r)
    assert p.returncode == 1 and not check_named(out, "git-verified")["ok"]


def test_ancestry_miss_blocks(tmp_path):
    repo, head = make_repo(tmp_path)
    r = good_report(head)
    r["ancestryMisses"] = [{"task": "A", "headSha": "dead"}]
    p, out = run_gate(repo, r)
    assert p.returncode == 1 and not check_named(out, "ancestry")["ok"]


def test_missing_deliverables_block(tmp_path):
    repo, head = make_repo(tmp_path)
    r = good_report(head)
    r["missingDeliverables"] = [{"task": "B", "files": ["b.py"]}]
    p, out = run_gate(repo, r)
    assert p.returncode == 1 and not check_named(out, "deliverables")["ok"]


def test_incomplete_coverage_needs_ack_exit_2(tmp_path):
    repo, head = make_repo(tmp_path)
    r = good_report(head)
    r["coverage"] = {"tasks_merged": 1, "tasks_planned": 2, "complete": False}
    p, out = run_gate(repo, r)
    assert p.returncode == 2 and out["verdict"] == "NEEDS_ACK"
    assert any(a["type"] == "coverage" for a in out["acks"])


def test_deferred_runtime_needs_ack(tmp_path):
    repo, head = make_repo(tmp_path)
    r = good_report(head)
    r["deferredVerification"] = [
        {"deliverable": "worker deploy", "reason": "runtime", "why": "no deploy target"}]
    p, out = run_gate(repo, r)
    assert p.returncode == 2
    assert any(a["type"] == "deferred:runtime" for a in out["acks"])


def test_malformed_report_blocks(tmp_path):
    repo, _ = make_repo(tmp_path)
    p, out = run_gate(repo, "{not json")
    assert p.returncode == 1 and out["verdict"] == "BLOCKED"
    assert not check_named(out, "report-parse")["ok"]
