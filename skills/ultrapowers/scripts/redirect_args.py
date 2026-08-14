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
import shutil
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
    run_dir = a.out_dir or os.path.dirname(os.path.abspath(a.receipt))
    # The args (and their FULL waves) always come from the original argsFile —
    # emitted waves are a per-round subset, so a prior round's args cannot
    # serve as the base. Launch BODIES chain through the prior round's
    # redirect-launch.json when one exists: re-deriving bodies from the
    # pristine launch would silently discard that round's amendments
    # (adversarial-review catch, 2026-08-07 drain).
    args_path = receipt.get("argsFile")
    if not (isinstance(args_path, str) and os.path.isfile(args_path)):
        die("receipt has no readable argsFile: %r" % args_path)
    args = load_json(args_path, "argsFile")
    prior_launch = os.path.join(run_dir, "redirect-launch.json")
    launch_path = (prior_launch if os.path.isfile(prior_launch)
                   else args.get("wavesPath"))
    if not (isinstance(launch_path, str) and os.path.isfile(launch_path)):
        die("args has no readable wavesPath: %r" % launch_path)
    launch = load_json(launch_path, "launch file")
    branch = a.integration_branch or (args.get("integrationBranch") or None)
    if not branch:
        # "next to the receipt" (per the error below) — never --out-dir
        gr_path = os.path.join(os.path.dirname(os.path.abspath(a.receipt)),
                               "gate-receipt.json")
        if os.path.isfile(gr_path):
            gr = load_json(gr_path, "gate receipt") or {}
            # #153: real receipts (ultra_gate.py) store the branch under
            # "branch"; hand-built/legacy fixtures use "integrationBranch".
            branch = gr.get("integrationBranch") or gr.get("branch")
    if not branch:
        die("no integration branch: pass --integration-branch or provide "
            "gate-receipt.json next to the receipt")

    findings = load_json(a.findings, "findings")
    if not (isinstance(findings, list) and findings):
        die("findings must be a non-empty JSON list of amend entries")

    raw_tasks = launch.get("tasks")
    # compile_plan.py --emit-launch emits tasks as a LIST of {id,...} objects;
    # accept the dict-keyed shape too (unit fixtures, hand-built files). The
    # id-keyed view holds references, so amendments land in the original
    # structure and the emitted copy preserves the input shape.
    if isinstance(raw_tasks, dict):
        tasks = {str(k): v for k, v in raw_tasks.items()}
    elif isinstance(raw_tasks, list):
        tasks = {str(t.get("id")): t for t in raw_tasks if isinstance(t, dict)}
    else:
        die("launch file has no tasks list/object")
    entries = {e.get("id"): e for wave in (args.get("waves") or []) for e in wave}
    amended = set()
    for i, f in enumerate(findings):
        tid = str(f.get("task") or "")
        if tid not in tasks or tid not in entries:
            die("finding %d names unknown task %r" % (i, tid))
        amended.add(tid)
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
    # The honest cost contract: only the amended tasks relaunch (the engine
    # resumes on the same integration branch; merged prior work is already
    # there). Empty waves are dropped; edges narrow to the amended set.
    out["waves"] = [w for w in ([e for e in wave if e.get("id") in amended]
                                for wave in (args.get("waves") or [])) if w]
    out["edges"] = [e for e in (args.get("edges") or [])
                    if len(e) == 2 and e[0] in amended and e[1] in amended]
    out.update({"resume": True, "integrationBranch": branch,
                "wavesPath": new_launch_path})
    new_args_path = os.path.join(run_dir, "redirect-args.json")
    with open(new_args_path, "w") as f:
        json.dump(out, f, indent=2)
    # #131: the relaunch renumbers waves 1..k, so a prior launch's higher
    # wave-<n> slot would win the critic's highest-numbered-slot detach rule.
    # The slots' shas are already durable in the finalized report and the task
    # branches; deleting AFTER a successful emit (never on a validation death)
    # makes the stale-slot state inexpressible for the relaunch.
    heads_dir = os.path.join(os.path.dirname(os.path.abspath(a.receipt)), "heads")
    if os.path.isdir(heads_dir):
        shutil.rmtree(heads_dir)
        print("redirect_args: cleared prior launch's heads/ sidecars", file=sys.stderr)
    print(new_args_path)


if __name__ == "__main__":
    main()
