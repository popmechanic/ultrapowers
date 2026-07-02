#!/usr/bin/env python3
"""Deterministic pre-merge gate checks for /ultrapowers (SKILL.md Step 5).

The orchestrator saves the workflow's report JSON verbatim to disk and runs
this script; the verdict JSON on stdout and the exit code are the gate.
Exit 0 = PASS, 2 = NEEDS_ACK (operator must acknowledge the listed items
before Approve), 1 = BLOCKED (do not Approve).

Fail-closed by construction: git is the ground truth the report is checked
AGAINST, so a corrupted or hand-edited report can only produce BLOCKED,
never a false PASS. This script does not administer acceptance (that is
run_acceptance.sh, per disposition) and does not release locks or sweep
worktrees (explicit orchestrator actions on this verdict).
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def sh(cmd, cwd):
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)


def emit(checks, acks):
    blocked = any(not c["ok"] for c in checks)
    verdict = "BLOCKED" if blocked else ("NEEDS_ACK" if acks else "PASS")
    print(json.dumps({"verdict": verdict, "checks": checks, "acks": acks}, indent=2))
    return 1 if blocked else (2 if acks else 0)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--run-id", required=True)
    ap.add_argument("--branch", required=True)
    ap.add_argument("--report", required=True, type=Path)
    ap.add_argument("--repo", type=Path, default=Path.cwd())
    a = ap.parse_args(argv)

    checks, acks = [], []

    def check(name, ok, detail=""):
        checks.append({"name": name, "ok": bool(ok), "detail": detail})
        return bool(ok)

    try:
        report = json.loads(a.report.read_text())
        if not isinstance(report, dict):
            raise ValueError("report is not a JSON object")
    except Exception as e:  # unreadable, unparseable, wrong shape — all BLOCKED
        check("report-parse", False, "report unreadable or malformed: " + str(e))
        return emit(checks, acks)
    check("report-parse", True)

    r = sh(["bash", str(HERE / "run_lock.sh"), "check", a.run_id], cwd=a.repo)
    check("lock", r.returncode == 0,
          "" if r.returncode == 0 else
          "RUN_LOCK does not hold " + a.run_id +
          " — a concurrent run may have replaced it; do not Approve")

    r = sh(["git", "status", "--porcelain"], cwd=a.repo)
    dirty = r.stdout.strip()
    ok = r.returncode == 0 and not dirty
    check("clean-tree", ok,
          "" if ok else
          "session checkout is dirty — a role wrote outside the worktree "
          "discipline (#32); that work is unreviewed by construction:\n" + dirty)

    wm = report.get("waveMerges")
    shape_ok = (isinstance(wm, list) and wm and isinstance(wm[-1], dict)
                and wm[-1].get("headSha"))
    check("wave-merges", shape_ok,
          "" if shape_ok else
          "merge-sha guard unavailable — result lacks waveMerges[last].headSha "
          "(budget-exhausted or SKIPPED-only run); inspect and redirect/re-run")

    if shape_ok:
        expected = wm[-1]["headSha"]
        r = sh(["git", "rev-parse", "--verify", a.branch], cwd=a.repo)
        actual = r.stdout.strip()
        ok = r.returncode == 0 and actual == expected
        check("head-match", ok,
              "" if ok else
              "integration branch " + a.branch + " is at " +
              (actual or "<unresolvable>") + " but the report recorded " +
              str(expected) + " — the tree on disk is not the one the run "
              "produced (checkout drift, #29)")
    else:
        check("head-match", False, "skipped — no recorded merge headSha to compare")

    check("git-verified", report.get("gitVerified") is True,
          "" if report.get("gitVerified") is True else
          "gitVerified is not true — the completeness critic could not confirm "
          "it reviewed the recorded merge HEAD; the review is unverified")

    misses = report.get("ancestryMisses") or []
    check("ancestry", not misses,
          "" if not misses else
          "tasks reported merged but absent from the integration ancestry "
          "(silent drop, #70): " + json.dumps(misses))

    missing = report.get("missingDeliverables") or []
    check("deliverables", not missing,
          "" if not missing else
          "failed/blocked tasks left declared deliverables unproduced: " +
          json.dumps(missing))

    cov = report.get("coverage") or {}
    if cov.get("complete") is False:
        acks.append({"type": "coverage",
                     "detail": "green suite but " + str(cov.get("tasks_merged")) +
                               "/" + str(cov.get("tasks_planned")) +
                               " tasks merged — a passing suite over an "
                               "incomplete merge is a false-green"})
    for d in (report.get("deferredVerification") or []):
        d = d or {}
        acks.append({"type": "deferred:" + str(d.get("reason", "unknown")),
                     "detail": str(d.get("deliverable", "?")) + " — " +
                               str(d.get("why", "")) +
                               (" [structural false-green: sandbox could not "
                                "execute it against the target]"
                                if d.get("reason") in ("runtime", "external")
                                else "")})
    return emit(checks, acks)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception as e:  # any unexpected fault fails closed
        print(json.dumps({"verdict": "BLOCKED",
                          "checks": [{"name": "internal", "ok": False,
                                      "detail": str(e)}],
                          "acks": []}))
        sys.exit(1)
