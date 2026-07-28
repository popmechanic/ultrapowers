"""ultra_gate.py: the deterministic gate driver (SKILL.md Step 5 mechanics).
Runs against a throwaway git repo with a stubbed run_acceptance.sh so
acceptance DISPATCH is tested without a real sealed vault. gate_check.py,
run_lock.sh, and the envelope unwrap are exercised for real.

The second half of the file (#96) pins the suite-disposition contract: the
acceptance command and bootstrap come exclusively from `receipt.json`, never
from `report.tests.command`, and a receipt predating the driver change BLOCKS
loudly instead of running anything.
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


def sh(cmd, cwd=None, check=True):
    return subprocess.run(cmd, cwd=cwd, check=check, capture_output=True, text=True)


def make_repo(tmp_path, acceptance_mode="waived", receipt_extra=None):
    """Throwaway repo + a scripts dir where run_acceptance.sh is a stub that
    records its argv and exits 0. Returns (repo, scripts_dir, head)."""
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
    for f in ("ultra_gate.py", "gate_check.py", "run_lock.sh",
              "sweep_worktrees.sh"):
        shutil.copy2(SCRIPTS / f, scripts / f)
    (scripts / "run_acceptance.sh").write_text(
        "#!/usr/bin/env bash\necho \"STUB $@\"\nexit 0\n")
    (scripts / "run_acceptance.sh").chmod(0o755)

    # the pre-launch state ultra_run would have left behind
    sh(["bash", str(scripts / "run_lock.sh"), "acquire", "t1"], cwd=repo)
    sh(["bash", str(scripts / "run_lock.sh"), "snapshot"], cwd=repo)
    run_dir = repo / ".claude/ultrapowers/run-t1"
    run_dir.mkdir(parents=True)
    acceptance = {"waived": {"mode": "waived", "reason": "test"},
                  "sealed": {"mode": "sealed", "sealId": "abc123",
                             "sha256": "d" * 64},
                  "suite": {"mode": "suite", "reason": "test"}}[acceptance_mode]
    run_receipt = {"ok": True, "stamp": "t1", "baseBranch": "main",
                   "compile": {"acceptance": acceptance}}
    run_receipt.update(receipt_extra or {})
    (run_dir / "receipt.json").write_text(json.dumps(run_receipt))
    return repo, scripts, head


def good_report(head):
    return {"integrationBranch": "ultra/int", "waves": [["1"]],
            "tasks": [{"task": "1", "status": "done"}],
            "tests": {"command": "IGNORED PROSE (553 passed)", "passed": True},
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
    assert out["acceptance"]["disposition"] == "waived"


def test_bare_report_also_accepted(tmp_path):
    repo, scripts, head = make_repo(tmp_path)
    result = tmp_path / "result.json"
    result.write_text(json.dumps(good_report(head)))
    r = run_gate(repo, scripts, result)
    assert r.returncode == 0
    assert json.loads(r.stdout)["verdict"] == "PASS"


def test_sealed_acceptance_dispatch(tmp_path):
    """Sealed disposition invokes run_acceptance.sh with sealId, branch, hash."""
    repo, scripts, head = make_repo(tmp_path, acceptance_mode="sealed")
    result = tmp_path / "result.json"
    result.write_text(json.dumps(good_report(head)))
    r = run_gate(repo, scripts, result)
    out = json.loads(r.stdout)
    assert out["acceptance"]["disposition"] == "sealed"
    assert "abc123 ultra/int " + "d" * 64 in out["acceptance"]["output"]
    assert r.returncode == 0


def test_suite_acceptance_dispatch(tmp_path):
    """Suite disposition invokes the suite-gate with the RECEIPT's test command
    (#96 — never the report's prose) and the receipt's baseBranch."""
    repo, scripts, head = make_repo(tmp_path, acceptance_mode="suite",
                                    receipt_extra={"testCmd": "make check"})
    result = tmp_path / "result.json"
    result.write_text(json.dumps(good_report(head)))
    r = run_gate(repo, scripts, result)
    out = json.loads(r.stdout)
    assert out["acceptance"]["disposition"] == "suite"
    assert "--suite-gate" in out["acceptance"]["output"]
    assert "--run make check" in out["acceptance"]["output"]
    assert "IGNORED PROSE" not in out["acceptance"]["output"]
    assert "--base main" in out["acceptance"]["output"]


def test_failed_acceptance_forces_blocked(tmp_path):
    repo, scripts, head = make_repo(tmp_path, acceptance_mode="sealed")
    (scripts / "run_acceptance.sh").write_text(
        "#!/usr/bin/env bash\necho RED\nexit 1\n")
    (scripts / "run_acceptance.sh").chmod(0o755)
    result = tmp_path / "result.json"
    result.write_text(json.dumps(good_report(head)))
    r = run_gate(repo, scripts, result)
    assert r.returncode == 1
    assert json.loads(r.stdout)["verdict"] == "BLOCKED"


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


def test_teardown_releases_lock_keeps_worktrees(tmp_path):
    repo, scripts, _ = make_repo(tmp_path)
    r = sh([sys.executable, str(scripts / "ultra_gate.py"),
            "--stamp", "t1", "--teardown"], cwd=repo, check=False)
    assert r.returncode == 0
    out = json.loads(r.stdout)
    assert out["lockReleased"] is True
    assert "sweep" in out
    assert not (repo / ".claude/ultrapowers/RUN_LOCK").exists()


def test_approve_checks_out_branch_and_releases(tmp_path):
    repo, scripts, _ = make_repo(tmp_path)
    r = sh([sys.executable, str(scripts / "ultra_gate.py"),
            "--stamp", "t1", "--approve", "--branch", "ultra/int"],
           cwd=repo, check=False)
    assert r.returncode == 0, r.stdout + r.stderr
    cur = sh(["git", "branch", "--show-current"], cwd=repo).stdout.strip()
    assert cur == "ultra/int"
    assert not (repo / ".claude/ultrapowers/RUN_LOCK").exists()


# ── #96: suite acceptance derives its inputs from the receipt ────────────
# These stub at the ultra_gate.sh boundary ONLY (git rev-parse, run_lock
# restore, gate_check and run_acceptance are all subprocesses through sh()),
# so the exact argv handed to run_acceptance.sh is observable.


class FakeProc:
    def __init__(self, code=0, out="", err=""):
        self.returncode, self.stdout, self.stderr = code, out, err


def _run_gate(root, monkeypatch, receipt_extra):
    """Drive ultra_gate.main in gate mode against a synthesized run_dir whose
    receipt carries acceptance.mode 'suite' plus receipt_extra. Returns
    (exit_code, gate_receipt_dict_or_None, run_acceptance_argv_or_None)."""
    root.mkdir(parents=True, exist_ok=True)
    run_dir = root / ".claude/ultrapowers/run-t1"
    run_dir.mkdir(parents=True)
    rcpt = {"compile": {"acceptance": {"mode": "suite"}}, "baseBranch": "main"}
    rcpt.update(receipt_extra)
    (run_dir / "receipt.json").write_text(json.dumps(rcpt))
    result = root / "result.json"
    result.write_text(json.dumps({"result": {
        "integrationBranch": "ultra/x",
        "tests": {"command": "IGNORED PROSE (553 passed)", "passed": True,
                  "output": "ok"}}}))
    calls = []

    def fake_sh(cmd, cwd=None):
        calls.append([str(c) for c in cmd])
        joined = " ".join(str(c) for c in cmd)
        if "rev-parse" in joined:
            return FakeProc(0, str(root) + "\n")
        if "run_lock.sh" in joined:
            return FakeProc(0, "")
        if "gate_check.py" in joined:
            return FakeProc(0, json.dumps({"verdict": "PASS", "checks": [],
                                           "acks": []}))
        if "run_acceptance.sh" in joined:
            return FakeProc(0, json.dumps({"sealId": "(suite)", "status": "OK",
                                           "passed": True, "exitCode": 0,
                                           "output": "ok"}))
        return FakeProc(0, "")

    monkeypatch.setattr(ultra_gate, "sh", fake_sh)
    code = ultra_gate.main(["--stamp", "t1", "--result", str(result),
                            "--repo", str(root)])
    gate_receipt_path = run_dir / "gate-receipt.json"
    gate_receipt = (json.loads(gate_receipt_path.read_text())
                    if gate_receipt_path.is_file() else None)
    ra = [c for c in calls if any("run_acceptance.sh" in x for x in c)]
    return code, gate_receipt, (ra[0] if ra else None)


def test_suite_acceptance_command_comes_from_receipt(tmp_path, monkeypatch):
    code, receipt, ra = _run_gate(tmp_path / "a", monkeypatch,
                                  {"testCmd": "make check"})
    assert ra is not None
    assert ra[ra.index("--run") + 1] == "make check"
    assert all("IGNORED PROSE" not in x for x in ra)
    assert code == 0 and receipt["verdict"] == "PASS"


def test_bootstrap_passed_through_when_receipt_has_it(tmp_path, monkeypatch):
    _, _, ra = _run_gate(tmp_path / "a", monkeypatch,
                         {"testCmd": "npm test", "bootstrapCmd": "npm install"})
    assert ra[ra.index("--bootstrap") + 1] == "npm install"
    _, _, ra2 = _run_gate(tmp_path / "b", monkeypatch, {"testCmd": "npm test"})
    assert "--bootstrap" not in ra2


def test_missing_receipt_testcmd_blocks_loudly(tmp_path, monkeypatch, capsys):
    code, _, ra = _run_gate(tmp_path / "a", monkeypatch, {})
    assert code == 1
    assert ra is None, "run_acceptance must never run without a receipt testCmd"
    printed = json.loads(capsys.readouterr().out)
    assert printed["verdict"] == "BLOCKED"
    assert "receipt lacks testCmd" in printed["detail"]


def test_empty_receipt_testcmd_blocks_loudly(tmp_path, monkeypatch, capsys):
    """An empty command evals to exit 0 — the driver refuses it as a false
    green rather than handing it to the suite-gate."""
    code, _, ra = _run_gate(tmp_path / "a", monkeypatch, {"testCmd": ""})
    assert code == 1 and ra is None
    assert "receipt lacks testCmd" in json.loads(capsys.readouterr().out)["detail"]
