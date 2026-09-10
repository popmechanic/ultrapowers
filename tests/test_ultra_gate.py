"""ultra_gate.py: the deterministic gate driver (SKILL.md Step 5 mechanics).
Runs against a throwaway git repo; gate_check.py and the envelope unwrap are
exercised for real.

The gate administers no suite of its own: it reads the result the run already
recorded in the report's `tests` block, so the fixtures here are reports, not
receipts.
"""
import json
import pathlib
import shutil
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "skills/ultrapowers/scripts"
sys.path.insert(0, str(SCRIPTS))
import ultra_gate  # noqa: E402
from ultra_run import write_dirty_baseline  # noqa: E402


def sh(cmd, cwd=None, check=True):
    return subprocess.run(cmd, cwd=cwd, check=check, capture_output=True, text=True)


def make_repo(tmp_path, seed_dirty_baseline=True):
    """Throwaway repo + a scripts dir holding the real driver and gate_check.
    Returns (repo, scripts_dir, head).

    `seed_dirty_baseline=False` reproduces a launch whose DIRTY_SNAPSHOT was
    never written — post-#104 that is an ordinary state the gate must survive,
    not the BLOCKED path the deleted restore step used to produce."""
    repo = tmp_path / "repo"
    repo.mkdir()
    sh(["git", "init", "-q", "-b", "main"], cwd=repo)
    sh(["git", "config", "user.email", "t@t"], cwd=repo)
    sh(["git", "config", "user.name", "t"], cwd=repo)
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

    scripts = tmp_path / "scripts"
    scripts.mkdir()
    for f in ("ultra_gate.py", "gate_check.py"):
        shutil.copy2(SCRIPTS / f, scripts / f)

    if seed_dirty_baseline:
        write_dirty_baseline(repo)
    return repo, scripts, head


def good_report(head, tests_passed=True):
    return {"integrationBranch": "ultra/int", "waves": [["1"]],
            "tasks": [{"task": "1", "status": "done"}],
            "tests": {"command": "x", "passed": tests_passed, "output": "ok"},
            "unfinished": [], "gitVerified": True,
            "waveMerges": [{"wave": 1, "status": "MERGED", "headSha": head}],
            "coverage": {"tasks_merged": 1, "tasks_planned": 1, "complete": True}}


def run_gate(repo, scripts, result_path):
    return sh([sys.executable, str(scripts / "ultra_gate.py"),
               "--stamp", "t1", "--result", str(result_path)],
              cwd=repo, check=False)


def test_envelope_unwrap_and_pass(tmp_path):
    """Gate fields live under result.* in the Workflow envelope — the driver
    unwraps; the orchestrator never probes the top level again."""
    repo, scripts, head = make_repo(tmp_path)
    envelope = {"summary": "done", "agentCount": 3, "logs": [],
                "result": good_report(head)}
    result = tmp_path / "result.json"
    result.write_text(json.dumps(envelope))
    r = run_gate(repo, scripts, result)
    out = json.loads(r.stdout)
    assert r.returncode == 0, r.stdout + r.stderr
    assert out["verdict"] == "PASS"
    assert out["branch"] == "ultra/int"
    saved = repo / ".claude/ultrapowers/run-t1/report.json"
    assert json.loads(saved.read_text())["integrationBranch"] == "ultra/int"
    assert out["suite"] == {"passed": True, "unattributed": [], "output": "ok"}
    assert "wfRuns" not in out


def test_bare_report_also_accepted(tmp_path):
    repo, scripts, head = make_repo(tmp_path)
    result = tmp_path / "result.json"
    result.write_text(json.dumps(good_report(head)))
    r = run_gate(repo, scripts, result)
    assert r.returncode == 0
    assert json.loads(r.stdout)["verdict"] == "PASS"


def test_gate_passes_with_no_snapshot_file_present(tmp_path):
    """#104: gate mode's first act is the result unwrap. With no snapshot file
    on disk the gate reaches a real verdict — the old restore-first step turned
    exactly this state into a BLOCKED with no bearing on the work reviewed."""
    repo, scripts, head = make_repo(tmp_path, seed_dirty_baseline=False)
    assert not (repo / ".claude/ultrapowers/DIRTY_SNAPSHOT").exists()
    assert not (repo / ".claude/ultrapowers/CHECKOUT_SNAPSHOT").exists()
    result = tmp_path / "result.json"
    result.write_text(json.dumps(good_report(head)))
    r = run_gate(repo, scripts, result)
    out = json.loads(r.stdout)
    assert r.returncode == 0, r.stdout + r.stderr
    assert out["verdict"] == "PASS"


def test_gate_leaves_the_session_checkout_where_it_found_it(tmp_path):
    """The property the retired family claimed to protect, now held by the
    gate being checkout-position-independent (#84): head-match resolves the
    branch ref, so the gate reads the same tree from wherever the operator
    parked and never moves them."""
    repo, scripts, head = make_repo(tmp_path)
    sh(["git", "checkout", "-qb", "operator-side-quest"], cwd=repo)
    before = sh(["git", "rev-parse", "HEAD"], cwd=repo).stdout.strip()
    result = tmp_path / "result.json"
    result.write_text(json.dumps(good_report(head)))
    r = run_gate(repo, scripts, result)
    assert json.loads(r.stdout)["verdict"] == "PASS", r.stdout
    assert sh(["git", "branch", "--show-current"],
              cwd=repo).stdout.strip() == "operator-side-quest"
    assert sh(["git", "rev-parse", "HEAD"], cwd=repo).stdout.strip() == before


def test_recorded_red_suite_forces_blocked(tmp_path):
    """The recorded suite is the gate's suite: `tests.passed` false BLOCKS
    even with every gate_check green, and the receipt carries the result."""
    repo, scripts, head = make_repo(tmp_path)
    result = tmp_path / "result.json"
    result.write_text(json.dumps(good_report(head, tests_passed=False)))
    r = run_gate(repo, scripts, result)
    out = json.loads(r.stdout)
    assert r.returncode == 1
    assert out["verdict"] == "BLOCKED"
    assert out["suite"] == {"passed": False, "unattributed": [], "output": "ok"}
    saved = json.loads((repo / ".claude/ultrapowers/run-t1/gate-receipt.json")
                       .read_text())
    assert saved["verdict"] == "BLOCKED"


def test_report_without_a_tests_block_is_blocked(tmp_path):
    """No recorded suite, no verdict to read — the gate refuses rather than
    treating a missing block as a green."""
    repo, scripts, head = make_repo(tmp_path)
    report = good_report(head)
    del report["tests"]
    result = tmp_path / "result.json"
    result.write_text(json.dumps(report))
    r = run_gate(repo, scripts, result)
    out = json.loads(r.stdout)
    assert r.returncode == 1
    assert out["verdict"] == "BLOCKED"
    assert "tests" in out["detail"]


def test_gate_check_blocked_propagates(tmp_path):
    repo, scripts, head = make_repo(tmp_path)
    report = good_report(head)
    report["gitVerified"] = False        # trips the git-verified check
    result = tmp_path / "result.json"
    result.write_text(json.dumps(report))
    r = run_gate(repo, scripts, result)
    assert r.returncode == 1
    assert json.loads(r.stdout)["verdict"] == "BLOCKED"


def test_unrecognizable_result_is_blocked(tmp_path):
    repo, scripts, _ = make_repo(tmp_path)
    result = tmp_path / "result.json"
    result.write_text(json.dumps({"nonsense": True}))
    r = run_gate(repo, scripts, result)
    assert r.returncode == 1
    assert json.loads(r.stdout)["verdict"] == "BLOCKED"


def test_approve_checks_out_branch_and_prints_the_approve_receipt(tmp_path):
    """Approve = checkout only (Phase 0 rows 1–2: no lock, no sweep). The
    printed JSON is what the orchestrator saves verbatim to
    run-<stamp>/approve-receipt.json; the shim greens only on a matching stamp."""
    repo, scripts, _ = make_repo(tmp_path)
    r = sh([sys.executable, str(scripts / "ultra_gate.py"),
            "--stamp", "t1", "--approve", "--branch", "ultra/int"],
           cwd=repo, check=False)
    assert r.returncode == 0, r.stdout + r.stderr
    cur = sh(["git", "branch", "--show-current"], cwd=repo).stdout.strip()
    assert cur == "ultra/int"
    assert json.loads(r.stdout) == {"mode": "approve", "stamp": "t1",
                                    "branch": "ultra/int"}
    assert not (repo / ".claude/ultrapowers/RUN_LOCK").exists()


def test_teardown_and_wf_run_flags_are_gone(tmp_path):
    """Rows 1–2: --teardown (lock release) and --wf-run (sweep belt) died
    with the lock and the sweep; argparse refuses them."""
    repo, scripts, _ = make_repo(tmp_path)
    for flag in (["--teardown"], ["--approve", "--branch", "ultra/int",
                                  "--wf-run", "wf_x"]):
        r = sh([sys.executable, str(scripts / "ultra_gate.py"),
                "--stamp", "t1", *flag], cwd=repo, check=False)
        assert r.returncode == 2, flag
        assert "unrecognized arguments" in r.stderr


# ── #104: the restore call is deleted, not made conditional ──────────────
# Stubbing at ultra_gate's own `sh` boundary (git rev-parse and gate_check are
# both subprocesses through it) makes the full call list observable.


class FakeProc:
    def __init__(self, code=0, out="", err=""):
        self.returncode, self.stdout, self.stderr = code, out, err


def test_gate_issues_no_run_lock_restore(tmp_path, monkeypatch):
    """No subprocess the gate issues may name `restore` — the family is gone
    from this path."""
    root = tmp_path / "a"
    root.mkdir(parents=True)
    result = root / "result.json"
    result.write_text(json.dumps({"result": {
        "integrationBranch": "ultra/x",
        "tests": {"command": "x", "passed": True, "output": "ok"}}}))
    calls = []

    def fake_sh(cmd, cwd=None):
        calls.append([str(c) for c in cmd])
        joined = " ".join(str(c) for c in cmd)
        if "rev-parse" in joined:
            return FakeProc(0, str(root) + "\n")
        if "gate_check.py" in joined:
            return FakeProc(0, json.dumps({"verdict": "PASS", "checks": [],
                                           "acks": []}))
        return FakeProc(0, "")

    monkeypatch.setattr(ultra_gate, "sh", fake_sh)
    code = ultra_gate.main(["--stamp", "t1", "--result", str(result),
                            "--repo", str(root)])
    receipt = json.loads((root / ".claude/ultrapowers/run-t1/gate-receipt.json")
                         .read_text())
    assert code == 0 and receipt["verdict"] == "PASS"
    assert calls, "sanity: the driver issued subprocesses"
    assert not [c for c in calls if "restore" in " ".join(c)]
