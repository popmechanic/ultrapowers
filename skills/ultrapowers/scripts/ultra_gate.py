#!/usr/bin/env python3
"""Deterministic gate driver for /ultrapowers (run on the sandbox by fleet/run-main.mjs).

Gate mode (--result): read the engine's report (bare since 0.3.0; the
pre-0.3.0 Workflow-tool envelope with the report under result.* is still
accepted — report-format.md), save the report verbatim, run gate_check.py,
then read the suite result the run already recorded in the report's `tests`
block. Exit 0 PASS / 2 NEEDS_ACK / 1 BLOCKED; a red suite always forces 1.
The gate runs no suite of its own. The driver never decides — the
orchestrator renders the receipt and applies the two-move rule. Gate mode
moves no checkout: the verdict is checkout-position-independent (#104).

--approve: checkout the integration branch and print the approve receipt
({mode, stamp, branch}); the orchestrator saves that JSON verbatim to
run-<stamp>/approve-receipt.json. No lock release, no sweep — the sandbox is
disposable (One Driver Phase 0, rows 1–2).
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
    """Accept a bare report (0.3.0+) or the legacy Workflow envelope ({... result: {report}})."""
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
    a = ap.parse_args(argv)

    r = sh(["git", "rev-parse", "--show-toplevel"], cwd=a.repo)
    if r.returncode != 0:
        return blocked({"stamp": a.stamp}, "not inside a git repository")
    root = Path(r.stdout.strip())
    run_dir = root / ".claude/ultrapowers" / ("run-" + a.stamp)

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
        print(json.dumps({"mode": "approve", "stamp": a.stamp, "branch": branch},
                         indent=2))
        return 0

    # ── gate mode ────────────────────────────────────────────────────────
    receipt = {"mode": "gate", "stamp": a.stamp}
    if a.result is None:
        return blocked(receipt, "--result <workflow result JSON> is required")

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

    # The suite result the run already recorded — the gate reads it, it does
    # not run a suite of its own.
    tests = report.get("tests")
    if not isinstance(tests, dict):
        return blocked(receipt, "report carries no tests block — the engine "
                                "records the integrated suite there")
    receipt["suite"] = {"passed": bool(tests.get("passed")),
                        "output": str(tests.get("output", ""))[-4000:]}
    acc_pass = receipt["suite"]["passed"]

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
