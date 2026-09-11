#!/usr/bin/env python3
"""Deterministic pre-merge gate checks for /ultrapowers (SKILL.md Step 5).

The orchestrator saves the workflow's report JSON verbatim to disk and runs
this script; the verdict JSON on stdout and the exit code are the gate.
Exit 0 = PASS, 2 = NEEDS_ACK (operator must acknowledge the listed items
before Approve), 1 = BLOCKED (do not Approve). `notes` carries what did NOT
park: a `satisfied-by-record` entry is a deferral the run's own state-exam
record contradicted (#863), and it gates nothing.

Fail-closed by construction: git is the ground truth the report is checked
AGAINST, so a corrupted or hand-edited report can only produce BLOCKED,
never a false PASS. This script does not judge the suite: ultra_gate.py reads
the suite result from the report's `tests` block.

The clean-tree check compares against the dirty set recorded at snapshot
time (`DIRTY_SNAPSHOT`); with no snapshot it treats all dirt as new.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def sh(cmd, cwd):
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)


def emit(checks, acks, context=None, notes=None):
    blocked = any(not c["ok"] for c in checks)
    verdict = "BLOCKED" if blocked else ("NEEDS_ACK" if acks else "PASS")
    out = {"verdict": verdict, "checks": checks, "acks": acks,
           "notes": list(notes or [])}
    out.update(context or {})
    print(json.dumps(out, indent=2))
    return 1 if blocked else (2 if acks else 0)


def _mentions_render(text):
    return "render" in text.lower()


def _named_tasks(text, task_ids):
    """Task ids the deferral names, as whole words, in its own text."""
    return [t for t in task_ids
            if re.search(r"(?<![\w-])" + re.escape(t) + r"(?![\w-])", text)]


def satisfied_by_record(d, report):
    """#863 — a `deferred:external`/`deferred:browser` item whose subject is the
    render branch, for a task whose state-exam record shows every render
    `ran`, is contradicted by the run's own record: the driver executed those
    exams against the live renderer during the suite. Returns the rows that
    settle it, or [] when the record settles nothing (which parks, as before).

    The rows are the deferral's named task's (`deliverable`/`why` naming a
    task id); a deferral naming no task is read against every task's record.
    One `render: "skipped"` row, or no row at all, is no contradiction.
    """
    if d.get("reason") not in ("external", "browser"):
        return []
    text = str(d.get("deliverable", "")) + " " + str(d.get("why", ""))
    if not _mentions_render(text):
        return []
    tasks = [t for t in (report.get("tasks") or []) if isinstance(t, dict)]
    by_id = {str(t.get("task")): t for t in tasks if t.get("task")}
    named = _named_tasks(text, list(by_id))
    pool = [by_id[t] for t in named] if named else tasks
    rows = []
    for t in pool:
        for e in (t.get("stateExams") or []):
            if isinstance(e, dict):
                rows.append({"task": t.get("task"), "exam": e.get("exam"),
                             "render": e.get("render"),
                             "render_ms": e.get("render_ms")})
    if not rows or not all(r["render"] == "ran" for r in rows):
        return []
    return rows


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--run-id", required=True)
    ap.add_argument("--branch", required=True)
    ap.add_argument("--report", required=True, type=Path)
    ap.add_argument("--repo", type=Path, default=Path.cwd())
    a = ap.parse_args(argv)

    context = {"repo": str(a.repo.resolve())}

    checks, acks, notes = [], [], []

    def check(name, ok, detail=""):
        checks.append({"name": name, "ok": bool(ok), "detail": detail})
        return bool(ok)

    try:
        report = json.loads(a.report.read_text())
        if not isinstance(report, dict):
            raise ValueError("report is not a JSON object")
    except Exception as e:  # unreadable, unparseable, wrong shape — all BLOCKED
        check("report-parse", False, "report unreadable or malformed: " + str(e))
        return emit(checks, acks, context)
    check("report-parse", True)

    r = sh(["git", "status", "--porcelain"], cwd=a.repo)
    lines = {l for l in r.stdout.splitlines() if l.strip()}
    snap = a.repo / ".claude/ultrapowers/DIRTY_SNAPSHOT"
    baseline = ({l for l in snap.read_text().splitlines() if l.strip()}
                if snap.is_file() else set())
    new_dirt = sorted(lines - baseline)
    preexisting = sorted(lines & baseline)
    ok = r.returncode == 0 and not new_dirt
    if not ok:
        detail = ("dirt appeared after the pre-launch snapshot — a role wrote "
                  "outside the worktree discipline (#32); that work is "
                  "unreviewed by construction:\n" + "\n".join(new_dirt))
    elif preexisting:
        detail = ("pre-existing dirt carried through from before launch, not "
                  "gate-relevant: " +
                  ", ".join(p.split(None, 1)[-1] for p in preexisting))
    else:
        detail = ""
    check("clean-tree", ok, detail)

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
        detail = (str(d.get("deliverable", "?")) + " — " + str(d.get("why", "")) +
                  (" [structural false-green: sandbox could not "
                   "execute it against the target]"
                   if d.get("reason") in ("runtime", "external") else ""))
        rows = satisfied_by_record(d, report)
        if rows:
            # The record contradicts the deferral (#863): a note, not a park.
            notes.append({"type": "satisfied-by-record",
                          "downgraded": "deferred:" + str(d.get("reason")),
                          "detail": detail + " — satisfied by the record: " +
                                    ", ".join("task " + str(r["task"]) + " exam " +
                                              str(r["exam"]) + " render ran (" +
                                              str(r["render_ms"]) + " ms)"
                                              for r in rows),
                          "rows": rows})
            continue
        acks.append({"type": "deferred:" + str(d.get("reason", "unknown")),
                     "detail": detail})
    return emit(checks, acks, context, notes)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception as e:  # any unexpected fault fails closed
        print(json.dumps({"verdict": "BLOCKED",
                          "checks": [{"name": "internal", "ok": False,
                                      "detail": str(e)}],
                          "acks": [], "notes": []}))
        sys.exit(1)
