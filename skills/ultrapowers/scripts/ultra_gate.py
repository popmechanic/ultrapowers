#!/usr/bin/env python3
"""Deterministic gate driver for /ultrapowers (SKILL.md Step 5 mechanics).

Gate mode (--result): restore the pre-launch checkout, unwrap the Workflow
tool envelope (gate fields live under result.* — report-format.md), save the
report verbatim, run gate_check.py, then administer acceptance per the
disposition recorded in the ultra_run receipt. Exit 0 PASS / 2 NEEDS_ACK /
1 BLOCKED; a failed acceptance always forces 1. The driver never decides —
the orchestrator renders the receipt and owns Approve/Salvage/Redirect.

--approve: checkout the integration branch, sweep worktrees (when --wf-run
is given), release the lock. --teardown: release the lock on any terminal
non-relaunch exit, keeping worktrees as triage evidence.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def sh(cmd, cwd=None):
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)


def unwrap(payload):
    """Accept the Workflow envelope ({... result: {report}}) or a bare report."""
    if isinstance(payload, dict):
        inner = payload.get("result")
        if isinstance(inner, dict) and "integrationBranch" in inner:
            return inner
        if "integrationBranch" in payload:
            return payload
    return None


def blocked(receipt, detail):
    receipt.update({"verdict": "BLOCKED", "detail": detail})
    print(json.dumps(receipt, indent=2))
    return 1


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--stamp", required=True)
    ap.add_argument("--result", type=Path, default=None)
    ap.add_argument("--repo", type=Path, default=Path.cwd())
    ap.add_argument("--branch", default=None,
                    help="integration branch override (approve mode, or when "
                         "the report field is absent)")
    ap.add_argument("--approve", action="store_true")
    ap.add_argument("--teardown", action="store_true")
    ap.add_argument("--wf-run", default=None,
                    help="wf_<runId> transcript stem for the worktree sweep")
    a = ap.parse_args(argv)

    r = sh(["git", "rev-parse", "--show-toplevel"], cwd=a.repo)
    if r.returncode != 0:
        return blocked({"stamp": a.stamp}, "not inside a git repository")
    root = Path(r.stdout.strip())
    run_dir = root / ".claude/ultrapowers" / ("run-" + a.stamp)
    lock = ["bash", str(HERE / "run_lock.sh")]

    if a.teardown:
        r = sh(lock + ["release", a.stamp], cwd=root)
        out = {"mode": "teardown", "stamp": a.stamp,
               "lockReleased": r.returncode == 0,
               "sweep": "bash " + str(HERE / "sweep_worktrees.sh") +
                        " --run <wf-runId>  # worktrees kept as triage evidence"}
        print(json.dumps(out, indent=2))
        return 0 if r.returncode == 0 else 1

    if a.approve:
        branch = a.branch
        report_file = run_dir / "report.json"
        if not branch and report_file.is_file():
            branch = json.loads(report_file.read_text()).get("integrationBranch")
        if not branch:
            return blocked({"mode": "approve", "stamp": a.stamp},
                           "no integration branch (--branch or saved report)")
        r = sh(["git", "checkout", branch], cwd=root)
        if r.returncode != 0:
            return blocked({"mode": "approve", "stamp": a.stamp}, r.stderr)
        swept = None
        if a.wf_run:
            swept = sh(["bash", str(HERE / "sweep_worktrees.sh"),
                        "--run", a.wf_run], cwd=root).stdout.strip()
        rel = sh(lock + ["release", a.stamp], cwd=root)
        out = {"mode": "approve", "stamp": a.stamp, "branch": branch,
               "swept": swept, "lockReleased": rel.returncode == 0}
        print(json.dumps(out, indent=2))
        return 0 if rel.returncode == 0 else 1

    # ── gate mode ────────────────────────────────────────────────────────
    receipt = {"mode": "gate", "stamp": a.stamp}
    if a.result is None:
        return blocked(receipt, "--result <workflow result JSON> is required")

    r = sh(lock + ["restore"], cwd=root)
    if r.returncode != 0:
        return blocked(receipt, "checkout restore failed: " + r.stderr)

    try:
        payload = json.loads(a.result.read_text())
    except Exception as e:
        return blocked(receipt, "result unreadable: " + str(e))
    report = unwrap(payload)
    if report is None:
        return blocked(receipt, "result carries no report (neither top-level "
                                "nor under result.*) — do not Approve")
    run_dir.mkdir(parents=True, exist_ok=True)
    report_path = run_dir / "report.json"
    report_path.write_text(json.dumps(report, indent=2))
    branch = a.branch or report.get("integrationBranch")
    receipt.update({"reportPath": str(report_path), "branch": branch})

    r = sh([sys.executable, str(HERE / "gate_check.py"),
            "--run-id", a.stamp, "--branch", str(branch),
            "--report", str(report_path), "--repo", str(root)], cwd=root)
    try:
        gate = json.loads(r.stdout)
    except Exception:
        gate = {"verdict": "BLOCKED", "checks": [], "acks": [],
                "detail": "gate_check emitted no JSON: " + r.stderr}
    receipt.update({"gateCheck": gate, "gateCheckExit": r.returncode})

    # Acceptance, per the disposition ultra_run recorded at compile time.
    run_receipt = {}
    receipt_file = run_dir / "receipt.json"
    if receipt_file.is_file():
        run_receipt = json.loads(receipt_file.read_text())
    acc = (run_receipt.get("compile") or {}).get("acceptance") or {}
    mode = acc.get("mode")
    if mode == "sealed":
        r = sh(["bash", str(HERE / "run_acceptance.sh"),
                str(acc.get("sealId")), str(branch), str(acc.get("sha256"))],
               cwd=root)
        acceptance = {"disposition": "sealed", "exit": r.returncode,
                      "output": (r.stdout + r.stderr)[-4000:]}
        acc_pass = r.returncode == 0
    elif mode == "waived":
        acceptance = {"disposition": "waived", "exit": None,
                      "reason": acc.get("reason", "")}
        acc_pass = True
    else:  # 'suite' and unmarked both bind acceptance to the committed suite
        test_cmd = (report.get("tests") or {}).get("command") or ""
        r = sh(["bash", str(HERE / "run_acceptance.sh"), "--suite-gate",
                "--branch", str(branch), "--run", test_cmd,
                "--base", run_receipt.get("baseBranch", "main")], cwd=root)
        acceptance = {"disposition": "suite", "exit": r.returncode,
                      "output": (r.stdout + r.stderr)[-4000:]}
        acc_pass = r.returncode == 0
    receipt["acceptance"] = acceptance

    gate_exit = receipt["gateCheckExit"]
    if gate_exit == 1 or gate.get("verdict") == "BLOCKED" or not acc_pass:
        receipt["verdict"] = "BLOCKED"
        code = 1
    elif gate_exit == 2:
        receipt["verdict"] = "NEEDS_ACK"
        code = 2
    else:
        receipt["verdict"] = "PASS"
        code = 0
    (run_dir / "gate-receipt.json").write_text(json.dumps(receipt, indent=2))
    print(json.dumps(receipt, indent=2))
    return code


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception as e:  # any unexpected fault fails closed
        print(json.dumps({"verdict": "BLOCKED",
                          "detail": "internal: " + str(e)}))
        sys.exit(1)
