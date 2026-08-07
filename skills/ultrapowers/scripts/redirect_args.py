#!/usr/bin/env python3
"""Author redirect relaunch args deterministically (#115).

Reads the run receipt's argsFile and its launch file (wavesPath), applies
amend-only findings (body REDIRECT append, file-scope narrow, tier
right-size) to COPIES, and emits redirect-args.json with resume: true and the
explicit integrationBranch the resume path requires. The orchestrator authors
findings.json from the gate report; this helper validates and applies that
judgment — it never launches anything and never mutates the originals.
"""
import argparse
import json
import os
import sys


def die(msg):
    print("redirect_args: " + msg, file=sys.stderr)
    sys.exit(1)


def load_json(path, what):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError, TypeError) as e:
        die("unreadable %s %r (%s)" % (what, path, e))


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--receipt", required=True)
    ap.add_argument("--findings", required=True)
    ap.add_argument("--integration-branch", default=None)
    ap.add_argument("--out-dir", default=None,
                    help="defaults to the receipt's directory")
    a = ap.parse_args()

    receipt = load_json(a.receipt, "receipt")
    args_path = receipt.get("argsFile")
    if not (isinstance(args_path, str) and os.path.isfile(args_path)):
        die("receipt has no readable argsFile: %r" % args_path)
    args = load_json(args_path, "argsFile")
    launch_path = args.get("wavesPath")
    if not (isinstance(launch_path, str) and os.path.isfile(launch_path)):
        die("args has no readable wavesPath: %r" % launch_path)
    launch = load_json(launch_path, "launch file")

    run_dir = a.out_dir or os.path.dirname(os.path.abspath(a.receipt))
    branch = a.integration_branch
    if not branch:
        gr_path = os.path.join(run_dir, "gate-receipt.json")
        if os.path.isfile(gr_path):
            branch = (load_json(gr_path, "gate receipt") or {}).get("integrationBranch")
    if not branch:
        die("no integration branch: pass --integration-branch or provide "
            "gate-receipt.json next to the receipt")

    findings = load_json(a.findings, "findings")
    if not (isinstance(findings, list) and findings):
        die("findings must be a non-empty JSON list of amend entries")

    tasks = launch.get("tasks") or {}
    entries = {e.get("id"): e for wave in (args.get("waves") or []) for e in wave}
    for i, f in enumerate(findings):
        tid = str(f.get("task") or "")
        if tid not in tasks or tid not in entries:
            die("finding %d names unknown task %r" % (i, tid))
        instruction = (f.get("instruction") or "").strip()
        if not instruction:
            die("finding %d (task %s) has no instruction" % (i, tid))
        tasks[tid]["body"] = tasks[tid].get("body", "") + "\n\nREDIRECT: " + instruction + "\n"
        if f.get("files"):
            tasks[tid]["files"] = list(f["files"])
            entries[tid]["files"] = list(f["files"])
        if f.get("tier"):
            entries[tid]["tier"] = f["tier"]

    new_launch_path = os.path.join(run_dir, "redirect-launch.json")
    with open(new_launch_path, "w") as f:
        json.dump(launch, f, indent=2)
    out = dict(args)
    out.update({"resume": True, "integrationBranch": branch,
                "wavesPath": new_launch_path})
    new_args_path = os.path.join(run_dir, "redirect-args.json")
    with open(new_args_path, "w") as f:
        json.dump(out, f, indent=2)
    print(new_args_path)


if __name__ == "__main__":
    main()
