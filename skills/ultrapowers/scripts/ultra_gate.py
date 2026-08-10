#!/usr/bin/env python3
"""Deterministic gate driver for /ultrapowers (SKILL.md Step 5 mechanics).

Gate mode (--result): unwrap the Workflow tool envelope (gate fields live
under result.* — report-format.md), save the report verbatim, run
gate_check.py, then administer acceptance per the disposition recorded in the
ultra_run receipt. Exit 0 PASS / 2 NEEDS_ACK / 1 BLOCKED; a failed acceptance
always forces 1. The driver never decides — the orchestrator renders the
receipt and owns Approve/Salvage/Redirect. Gate mode moves no checkout: the
verdict is checkout-position-independent (head-match resolves branch refs and
the suite-gate runs in its own detached worktree), so wherever the operator
has parked, the gate reads the same tree and leaves them there (#104).

--approve: checkout the integration branch, sweep every recorded wf run id
plus wf_<stamp> (wf-runs.json ∪ --wf-run), release the lock; a sweep that
exits non-zero is reported in sweepFailures and fails approve. --teardown:
release the lock on any terminal non-relaunch exit, keeping worktrees as
triage evidence.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent

# Engine worktree branches are `worktree-wf_<runId>-<n>`. Deriving the id set
# from the report's branches is what makes approve-time sweep coverage total
# without an orchestrator-threaded id list (requirement 1, vibes.diy
# 2026-07-31 post-mortem). The pattern is deliberately STRUCTURAL, not a pin on
# today's `wf_<8 hex>-<3 alnum>` shape: that shape is minted by the Workflow
# runtime, and pinning it would mean a runtime drift silently skips every
# branch and approve sweeps nothing — the exact leak this closes. Non-matching
# branches are skipped. The integration worktree (`worktree-wf_<stamp>-…`,
# which a hyphenated stamp also matches) is excluded: approve always sweeps
# wf_<stamp> anyway, so recording it would only add noise.
WF_RUN_RE = re.compile(r"^worktree-(wf_[0-9A-Za-z]+-[0-9A-Za-z]+)-")


def load_wf_runs(run_dir):
    """Returns (ids, unreadable). `unreadable` is True when wf-runs.json
    exists but cannot be parsed — silently treating that as an empty record
    would make approve under-sweep with a full-looking receipt, the same
    invisible-leak shape this file exists to end, so every caller surfaces it."""
    path = run_dir / "wf-runs.json"
    if not path.is_file():
        return [], False
    try:
        return [str(x) for x in json.loads(path.read_text())], False
    except Exception:
        return [], True


def record_wf_runs(run_dir, report, stamp):
    known, unreadable = load_wf_runs(run_dir)
    ids = set(known)
    for task in report.get("tasks") or []:
        if isinstance(task, dict):
            m = WF_RUN_RE.match(str(task.get("branch") or ""))
            if m and m.group(1) != "wf_" + str(stamp):
                ids.add(m.group(1))
    if ids:
        (run_dir / "wf-runs.json").write_text(json.dumps(sorted(ids), indent=2))
    return sorted(ids), unreadable


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
                    help="extra wf_<runId> to sweep (belt; the recorded "
                         "wf-runs.json set is always swept)")
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
               "wfRuns": (wf := load_wf_runs(run_dir))[0],
               **({"wfRunsUnreadable": True} if wf[1] else {}),
               "sweep": "bash " + str(HERE / "sweep_worktrees.sh") +
                        " --run <id>  # for each of wfRuns plus wf_" + a.stamp +
                        " — worktrees kept as triage evidence"}
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
        # Sweep every run id the pipeline ever minted (recorded at each gate)
        # plus the wf_<stamp> integration worktree — one call, total coverage.
        ids, wf_unreadable = load_wf_runs(run_dir)
        if a.wf_run and a.wf_run not in ids:
            ids.append(a.wf_run)
        integration_id = "wf_" + a.stamp
        if integration_id not in ids:
            ids.append(integration_id)
        # Each sweep's EXIT CODE is kept, not just its chatter: a sweep that
        # failed would otherwise render as an empty summary under a 0 exit —
        # an invisible leak, which is the failure mode this task exists to end.
        swept = {}
        failures = []
        for rid in ids:
            r = sh(["bash", str(HERE / "sweep_worktrees.sh"), "--run", rid],
                   cwd=root)
            swept[rid] = {"exit": r.returncode,
                          "output": (r.stdout + r.stderr).strip()[-2000:]}
            if r.returncode != 0:
                failures.append(rid)
        rel = sh(lock + ["release", a.stamp], cwd=root)
        out = {"mode": "approve", "stamp": a.stamp, "branch": branch,
               "swept": swept, "lockReleased": rel.returncode == 0}
        if failures:
            out["sweepFailures"] = failures
        # A corrupt record file means sweep coverage is UNKNOWN — fail loud
        # rather than let a full-looking receipt stand in for total coverage.
        if wf_unreadable:
            out["wfRunsUnreadable"] = True
        print(json.dumps(out, indent=2))
        ok = rel.returncode == 0 and not failures and not wf_unreadable
        return 0 if ok else 1

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
    # Record before gate_check runs, so even a BLOCKED verdict leaves this
    # launch's runtime id on disk for the eventual Approve-time sweep.
    receipt["wfRuns"], wf_unreadable = record_wf_runs(run_dir, report, a.stamp)
    if wf_unreadable:
        receipt["wfRunsUnreadable"] = True
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
        test_cmd = run_receipt.get("testCmd") or ""
        if not test_cmd:
            return blocked(receipt, "receipt lacks testCmd — the gate derives its "
                           "inputs from the receipt (#96); re-run the ultra_run.py "
                           "preflight so testCmd is stamped before gating")
        cmd = ["bash", str(HERE / "run_acceptance.sh"), "--suite-gate",
               "--branch", str(branch), "--run", test_cmd,
               "--base", run_receipt.get("baseBranch", "main")]
        if run_receipt.get("bootstrapCmd"):
            cmd += ["--bootstrap", run_receipt["bootstrapCmd"]]
        r = sh(cmd, cwd=root)
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
