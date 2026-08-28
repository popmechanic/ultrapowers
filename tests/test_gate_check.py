"""gate_check.py: the deterministic pre-merge gate checks (SKILL.md Step 5).
Every check is exercised against a throwaway git repo; git is ground truth,
so a corrupted report can only yield BLOCKED, never a false PASS.

The clean-tree check's new-vs-pre-existing baseline is seeded by the driver's
own writer (`ultra_run.write_dirty_baseline`) — #104 retired the
`run_lock.sh snapshot` subcommand that used to write it, but the
launch-over-operator-dirt workflow it protects is unchanged, so these tests
are re-plumbed rather than deleted."""
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "skills/ultrapowers/scripts"
GATE = SCRIPTS / "gate_check.py"
sys.path.insert(0, str(SCRIPTS))
from ultra_run import write_dirty_baseline  # noqa: E402


def sh(cmd, cwd=None, check=True):
    return subprocess.run(cmd, cwd=cwd, check=check, capture_output=True, text=True)


def make_repo(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    sh(["git", "init", "-q", "-b", "main"], cwd=repo)
    sh(["git", "config", "user.email", "t@t"], cwd=repo)
    sh(["git", "config", "user.name", "t"], cwd=repo)
    # .claude/ is the driver's state dir (untracked); ignore it or the
    # clean-tree check sees the run dir as dirt — mirrors the real repo's
    # .gitignore.
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


def test_preexisting_dirt_passes_with_note(tmp_path):
    """Dirt recorded in DIRTY_SNAPSHOT predates the run — the gate must not
    block on it or accuse a role (2026-07-03 distill: stash-dance class).
    Seeded by the driver's writer, the baseline's only writer since #104."""
    repo, head = make_repo(tmp_path)
    (repo / "operator-notes.md").write_text("deliberately uncommitted\n")
    write_dirty_baseline(repo)
    report = tmp_path / "report.json"
    report.write_text(json.dumps(good_report(head)))
    r = sh([sys.executable, str(GATE), "--run-id", "wf_test",
            "--branch", "ultra/int", "--report", str(report),
            "--repo", str(repo)], check=False)
    out = json.loads(r.stdout)
    clean = [c for c in out["checks"] if c["name"] == "clean-tree"][0]
    assert clean["ok"] is True
    assert "pre-existing" in clean["detail"]
    assert r.returncode in (0, 2)


def test_new_dirt_still_blocks(tmp_path):
    repo, head = make_repo(tmp_path)
    write_dirty_baseline(repo)
    (repo / "smuggled.py").write_text("appeared after the dirty baseline\n")
    report = tmp_path / "report.json"
    report.write_text(json.dumps(good_report(head)))
    r = sh([sys.executable, str(GATE), "--run-id", "wf_test",
            "--branch", "ultra/int", "--report", str(report),
            "--repo", str(repo)], check=False)
    out = json.loads(r.stdout)
    clean = [c for c in out["checks"] if c["name"] == "clean-tree"][0]
    assert clean["ok"] is False
    assert "smuggled.py" in clean["detail"]
    assert r.returncode == 1


def test_no_baseline_falls_back_strict(tmp_path):
    """No DIRTY_SNAPSHOT means no recorded pre-launch dirt: every dirt line
    blocks (fail-closed)."""
    repo, head = make_repo(tmp_path)
    (repo / "any.txt").write_text("dirt\n")
    report = tmp_path / "report.json"
    report.write_text(json.dumps(good_report(head)))
    r = sh([sys.executable, str(GATE), "--run-id", "wf_test",
            "--branch", "ultra/int", "--report", str(report),
            "--repo", str(repo)], check=False)
    out = json.loads(r.stdout)
    clean = [c for c in out["checks"] if c["name"] == "clean-tree"][0]
    assert clean["ok"] is False
    assert r.returncode == 1


def test_verdict_echoes_repo_context_and_no_lock(tmp_path):
    """A wrong-cwd invocation must be self-diagnosing (2026-07-03 distill:
    mislocated gate_check produced a spurious BLOCKED). The lock context key
    died with RUN_LOCK (One Driver Phase 0, row 1)."""
    repo, head = make_repo(tmp_path)
    report = tmp_path / "report.json"
    report.write_text(json.dumps(good_report(head)))
    r = sh([sys.executable, str(GATE), "--run-id", "wf_test",
            "--branch", "ultra/int", "--report", str(report),
            "--repo", str(repo)], check=False)
    out = json.loads(r.stdout)
    assert out["repo"] == str(repo.resolve())
    assert "lock" not in out
    assert [c["name"] for c in out["checks"]] == [
        "report-parse", "clean-tree", "wave-merges", "head-match",
        "git-verified", "ancestry", "deliverables"]
