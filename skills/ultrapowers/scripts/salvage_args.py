#!/usr/bin/env python3
"""Author salvage relaunch args deterministically (#222).

Sibling of redirect_args.py: reads the run receipt's argsFile, the chained
launch bodies, and the finalized gate report; derives the salvage set
mechanically (every failed task plus every dep-/cascade-blocked unfinished
task, in Step-2 order, edges narrowed); appends a PRIOR ATTEMPT block to
each selected task's body (kept branch + HEAD sha, review verdict,
blocking notes, completeness findings naming the task, and the instruction
to pull correct prior work in with git checkout <sha> -- <path> rather than
reimplement); emits salvage-args.json with resume: true; then rotates the
prior round's artifacts. Never launches anything; never mutates originals.
Budget-deferred unfinished entries are listed on stderr, not salvaged.
"""
import argparse
import re
import sys

import redirect_args as ra

BLOCKED_RE = re.compile(r"^(\S+): (?:blocked — |cascade-blocked by )")


def load_report(path):
    data = ra.load_json(path, "report")
    if isinstance(data, dict) and isinstance(data.get("result"), dict) \
            and "tasks" in data["result"]:
        return data["result"]
    if isinstance(data, dict) and "tasks" in data:
        return data
    ra.die("not a report: %r has no tasks[] (top-level or under result.*)" % path)


def salvage_set(report):
    failed = [t for t in (report.get("tasks") or [])
              if isinstance(t, dict) and t.get("status") == "failed"]
    blocked, skipped = [], []
    for s in (report.get("unfinished") or []):
        m = BLOCKED_RE.match(str(s))
        if m:
            blocked.append((m.group(1), str(s)))
        else:
            skipped.append(str(s))
    return failed, blocked, skipped


def findings_naming(report, tid):
    # Matches "task(s)" followed, within the same sentence (no ".", ";" or
    # newline in between), by the id as a whole word — so "tasks 2 and 3
    # left the guard untested" names BOTH task 2 and task 3, while "task 22"
    # never names id "2" (word-boundary on the id itself).
    pat = re.compile(r"\btasks?\b(?:(?!\.|;|\n)[\s\S])*?\b" + re.escape(tid) + r"\b",
                     re.IGNORECASE)
    return [str(f) for f in (report.get("completenessFindings") or [])
            if pat.search(str(f))]


def prior_attempt(task, findings):
    lines = ["PRIOR ATTEMPT: a prior round of this task failed — amend the kept work, "
             "do not reimplement from scratch."]
    branch, sha = str(task.get("branch") or ""), str(task.get("headSha") or "")
    if branch or sha:
        lines.append("- Kept branch: %s at %s. Pull correct prior work in with "
                     "git checkout %s -- <path> (one path at a time, re-verify each) "
                     "rather than rewriting it." % (branch or "?", sha or "?", sha or branch))
    if task.get("reviewVerdict"):
        lines.append("- Prior review verdict: " + str(task["reviewVerdict"]))
    if task.get("notes"):
        lines.append("- Blocking notes: " + str(task["notes"]))
    for f in findings:
        lines.append("- Completeness finding: " + f)
    return "\n\n" + "\n".join(lines) + "\n"


def not_attempted(unfinished_line, findings):
    lines = ["PRIOR ATTEMPT: not attempted in the prior round — " + unfinished_line]
    for f in findings:
        lines.append("- Completeness finding: " + f)
    return "\n\n" + "\n".join(lines) + "\n"


def main():
    ra.PROG = "salvage_args"
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--receipt", required=True)
    ap.add_argument("--report", required=True,
                    help="finalized report.json or the saved Workflow result envelope")
    ap.add_argument("--integration-branch", default=None)
    ap.add_argument("--out-dir", default=None,
                    help="defaults to the receipt's directory")
    a = ap.parse_args()

    ctx = ra.load_context(a.receipt, a.out_dir, a.integration_branch)
    report = load_report(a.report)
    failed, blocked, skipped = salvage_set(report)
    if not failed and not blocked:
        ra.die("nothing to salvage: no failed tasks and no blocked unfinished entries")
    tasks, entries = ctx["tasks"], ctx["entries"]
    selected = set()
    for t in failed:
        tid = str(t.get("task") or "")
        if tid not in tasks or tid not in entries:
            ra.die("failed task %r is unknown to the launch/args" % tid)
        selected.add(tid)
        tasks[tid]["body"] = tasks[tid].get("body", "") + prior_attempt(
            t, findings_naming(report, tid))
    for tid, line in blocked:
        if tid not in tasks or tid not in entries:
            ra.die("blocked unfinished task %r is unknown to the launch/args" % tid)
        if tid in selected:
            continue
        selected.add(tid)
        tasks[tid]["body"] = tasks[tid].get("body", "") + not_attempted(
            line, findings_naming(report, tid))
    if skipped:
        print("salvage_args: %d unfinished entr%s not salvaged (not failed/blocked — "
              "relaunch by redirect or a fresh launch): %s"
              % (len(skipped), "y" if len(skipped) == 1 else "ies", "; ".join(skipped)),
              file=sys.stderr)
    print(ra.emit_relaunch(ctx, selected, "salvage-args.json"))


if __name__ == "__main__":
    main()
