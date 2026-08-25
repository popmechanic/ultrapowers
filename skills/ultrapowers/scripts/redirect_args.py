#!/usr/bin/env python3
"""Author redirect relaunch args deterministically (#115, rotation #222).

Reads the run receipt's argsFile and its launch file (wavesPath), applies
amend-only findings (body REDIRECT append, file-scope union (#223), tier
right-size) to COPIES, and emits redirect-args.json with resume: true and the
explicit integrationBranch the resume path requires. The orchestrator authors
findings.json from the gate report; this helper validates and applies that
judgment — it never launches anything and never mutates the originals.

#222: after a successful emit, the prior round's report.json and heads/ are
ROTATED (copied/renamed to report-<n>.json / heads-<n>/) rather than deleted
— every round's artifacts stay on disk, keyed by round number.
"""
import argparse
import json
import os
import re
import shutil
import sys

import compile_plan  # same scripts dir: the compiler's own path-token rule

PROG = "redirect_args"
CHAIN_LAUNCH = "relaunch-launch.json"
_ROUND_RE = re.compile(r"^(?:report|heads)-(\d+)(?:\.json)?$")


def die(msg):
    print(PROG + ": " + msg, file=sys.stderr)
    sys.exit(1)


def load_json(path, what):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError, TypeError) as e:
        die("unreadable %s %r (%s)" % (what, path, e))


def next_round(run_dir):
    """1 + the highest round number already on disk (report-<n>.json or
    heads-<n>); 1 when the run dir holds no round artifacts yet."""
    highest = 0
    names = os.listdir(run_dir) if os.path.isdir(run_dir) else []
    for name in names:
        m = _ROUND_RE.match(name)
        if m:
            highest = max(highest, int(m.group(1)))
    return highest + 1


def rotate_round_artifacts(run_dir):
    """#222: key the prior round's artifacts by round number instead of
    deleting them. report.json is COPIED to report-<n>.json (the next gate
    overwrites the live file); heads/ is RENAMED to heads-<n>/ so the
    relaunch's merge writes a fresh heads/ and a stale higher wave-<n> slot
    can no longer win the critic's detach rule (the #131 reason, kept).
    Nothing is ever deleted."""
    n = next_round(run_dir)
    out = {"round": n, "report": None, "heads": None}
    report = os.path.join(run_dir, "report.json")
    if os.path.isfile(report):
        dst = os.path.join(run_dir, "report-%d.json" % n)
        shutil.copy2(report, dst)
        out["report"] = dst
    heads = os.path.join(run_dir, "heads")
    if os.path.isdir(heads):
        dst = os.path.join(run_dir, "heads-%d" % n)
        os.rename(heads, dst)
        out["heads"] = dst
    return out


def load_context(receipt_path, out_dir=None, branch_flag=None):
    """Everything a relaunch composer needs, loaded once. The args (and
    their FULL waves) always come from the original argsFile — emitted waves
    are a per-round subset. Launch BODIES chain through the prior round's
    relaunch-launch.json when one exists: re-deriving bodies from the
    pristine launch would silently discard that round's amendments."""
    receipt = load_json(receipt_path, "receipt")
    receipt_dir = os.path.dirname(os.path.abspath(receipt_path))
    run_dir = out_dir or receipt_dir
    args_path = receipt.get("argsFile")
    if not (isinstance(args_path, str) and os.path.isfile(args_path)):
        die("receipt has no readable argsFile: %r" % args_path)
    args = load_json(args_path, "argsFile")
    prior_launch = os.path.join(run_dir, CHAIN_LAUNCH)
    launch_path = (prior_launch if os.path.isfile(prior_launch)
                   else args.get("wavesPath"))
    if not (isinstance(launch_path, str) and os.path.isfile(launch_path)):
        die("args has no readable wavesPath: %r" % launch_path)
    launch = load_json(launch_path, "launch file")
    branch = branch_flag or (args.get("integrationBranch") or None)
    if not branch:
        # "next to the receipt" (per the error below) — never --out-dir
        gr_path = os.path.join(receipt_dir, "gate-receipt.json")
        if os.path.isfile(gr_path):
            gr = load_json(gr_path, "gate receipt") or {}
            # #153: real receipts (ultra_gate.py) store the branch under
            # "branch"; hand-built/legacy fixtures use "integrationBranch".
            branch = gr.get("integrationBranch") or gr.get("branch")
    if not branch:
        die("no integration branch: pass --integration-branch or provide "
            "gate-receipt.json next to the receipt")
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
    return {"receipt_dir": receipt_dir, "run_dir": run_dir, "args": args,
            "launch": launch, "tasks": tasks, "entries": entries,
            "branch": branch}


def emit_relaunch(ctx, selected, args_name):
    """Write the chained launch + the narrowed resume args, then rotate the
    prior round's artifacts. Rotation runs LAST, only after a successful
    emit, so a validation death never touches a healthy run's sidecars."""
    launch_path = os.path.join(ctx["run_dir"], CHAIN_LAUNCH)
    with open(launch_path, "w") as f:
        json.dump(ctx["launch"], f, indent=2)
    args = ctx["args"]
    out = dict(args)
    # The honest cost contract: only the selected tasks relaunch (the engine
    # resumes on the same integration branch; merged prior work is already
    # there). Empty waves are dropped; edges narrow to the selected set.
    out["waves"] = [w for w in ([e for e in wave if e.get("id") in selected]
                                for wave in (args.get("waves") or [])) if w]
    out["edges"] = [e for e in (args.get("edges") or [])
                    if len(e) == 2 and e[0] in selected and e[1] in selected]
    out.update({"resume": True, "integrationBranch": ctx["branch"],
                "wavesPath": launch_path})
    args_path = os.path.join(ctx["run_dir"], args_name)
    with open(args_path, "w") as f:
        json.dump(out, f, indent=2)
    rotated = rotate_round_artifacts(ctx["receipt_dir"])
    moved = [p for p in (rotated["report"], rotated["heads"]) if p]
    if moved:
        print("%s: rotated round %d artifacts: %s"
              % (PROG, rotated["round"], ", ".join(os.path.basename(p) for p in moved)),
              file=sys.stderr)
    return args_path


_STRIP = "`'\"()[]{}<>"
_LINE_RANGE = re.compile(r":\d+(?:-\d+)?$")
_NOT_PATHS = {"e.g", "i.e", "etc", "cf", "vs"}


def instruction_paths(instruction):
    """Path-like tokens in a redirect instruction, first-appearance order,
    deduped. Free prose is not a Files: block, so the compiler's _is_pathlike
    rule is narrowed (#223 review): a token with a `/`, a dotfile, or a real
    extension counts on its own; an extensionless bare name (README,
    Makefile) counts ONLY when the instruction backticked it — otherwise every
    sentence-initial Capitalized word would become a file. Quoting/brackets,
    trailing ,;:. punctuation, a ::node pytest selector and a :line-range
    suffix are stripped first."""
    out = []
    for raw in (instruction or "").split():
        backticked = raw.startswith("`")
        tok = raw.strip(_STRIP).rstrip(",;:.").strip(_STRIP)
        tok = _LINE_RANGE.sub("", tok.split("::", 1)[0])
        if not tok or tok.lower() in _NOT_PATHS or not compile_plan._is_pathlike(tok):
            continue
        ext = compile_plan.EXT_RE.search(tok)
        if ext is not None and ext.group(1).isdigit():
            continue                      # v1.2 / 3.4.5: a version, not a file
        bare = "/" not in tok and not tok.startswith(".") and ext is None
        if bare and not backticked:
            continue                      # Restore / Then / PASS: prose, not a path
        if tok not in out:
            out.append(tok)
    return out


def derive_files(task_files, instruction, finding_files):
    """#223: files is a footprint — task FILES ∪ instruction paths ∪ the
    finding's files, ordered, deduped. It can only grow; never narrows."""
    out = []
    for p in list(task_files or []) + instruction_paths(instruction) + list(finding_files or []):
        if p and p not in out:
            out.append(p)
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--receipt", required=True)
    ap.add_argument("--findings", required=True)
    ap.add_argument("--integration-branch", default=None)
    ap.add_argument("--out-dir", default=None,
                    help="defaults to the receipt's directory")
    a = ap.parse_args()

    ctx = load_context(a.receipt, a.out_dir, a.integration_branch)
    findings = load_json(a.findings, "findings")
    if not (isinstance(findings, list) and findings):
        die("findings must be a non-empty JSON list of amend entries")
    tasks, entries = ctx["tasks"], ctx["entries"]
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
        if f.get("files") is not None and not isinstance(f["files"], list):
            die("finding %d (task %s): files must be a list" % (i, tid))
        derived = derive_files(tasks[tid].get("files") or entries[tid].get("files"),
                               instruction, f.get("files"))
        tasks[tid]["files"] = list(derived)
        entries[tid]["files"] = list(derived)
        if f.get("tier"):
            entries[tid]["tier"] = f["tier"]
    print(emit_relaunch(ctx, amended, "redirect-args.json"))


if __name__ == "__main__":
    main()
