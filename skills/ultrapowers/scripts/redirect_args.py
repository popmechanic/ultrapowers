#!/usr/bin/env python3
"""Author redirect relaunch args deterministically (#115, rotation #222).

Reads the run receipt's argsFile and its launch file (wavesPath), applies
amend-only findings (body REDIRECT append, file-scope union (#223), tier
right-size) to COPIES, and emits redirect-args.json with resume: true and the
explicit integrationBranch the resume path requires. The orchestrator authors
findings.json from the gate report; this helper validates and applies that
judgment — it never launches anything and never mutates the originals.

#222: after a successful emit, the prior round's report.json is ROTATED
(copied to report-<n>.json) rather than deleted — every round's report stays
on disk, keyed by round number. A `heads/` dir, if present, is renamed to
heads-<n>/ too, but that is legacy-dir handling for runs created before #259
(docs/superpowers/specs/2026-08-26-fold-over-git-heads.md §4) — new runs
never write `heads/`; headShas are derived from git ancestry at finalize
time instead.
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
LEGACY_CHAIN_LAUNCH = "redirect-launch.json"  # pre-#222 rounds (#244 residual 1)
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
    overwrites the live file). A `heads/` dir, if present, is RENAMED to
    heads-<n>/ — legacy-dir handling for runs created before #259; new runs
    never write `heads/` (headShas are derived from git ancestry at
    finalize time). Nothing is ever deleted."""
    n = next_round(run_dir)
    out = {"round": n, "report": None, "heads": None}
    report = os.path.join(run_dir, "report.json")
    if os.path.isfile(report):
        # #244 residual 4: two composer runs with no gate between them would
        # snapshot the same bytes twice — skip when the live report is
        # byte-identical to the highest existing snapshot. Compare BYTES
        # directly (#304): filecmp.cmp consults its (size, mtime)-keyed cache
        # even with shallow=False, so a same-size rewrite within mtime
        # granularity returned a stale "equal" and silently lost a snapshot
        # on coarse-mtime filesystems.
        highest = os.path.join(run_dir, "report-%d.json" % (n - 1))
        def _same_bytes(a, b):
            with open(a, "rb") as fa, open(b, "rb") as fb:
                return fa.read() == fb.read()
        if not (n > 1 and os.path.isfile(highest)
                and _same_bytes(report, highest)):
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
    # #244 residuals 1+7: probe each chain-file name (current, then the
    # pre-#222 legacy name) in run_dir then receipt_dir, so a legacy round or
    # a mixed --out-dir never silently re-derives pristine bodies.
    launch_path = None
    for name in (CHAIN_LAUNCH, LEGACY_CHAIN_LAUNCH):
        for d in (run_dir, receipt_dir):
            cand = os.path.join(d, name)
            if os.path.isfile(cand):
                launch_path = cand
                break
        if launch_path:
            break
    if launch_path and os.path.basename(launch_path) == LEGACY_CHAIN_LAUNCH:
        print("%s: chaining bodies from legacy %s (pre-#222 round)"
              % (PROG, LEGACY_CHAIN_LAUNCH), file=sys.stderr)
    if launch_path is None:
        launch_path = args.get("wavesPath")
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


def derive_files(task_files, instruction, finding_files, declared=None):
    """#223: files is a footprint — task FILES ∪ instruction paths ∪ the
    finding's files, ordered, deduped. It can only grow; never narrows.
    #261: an instruction-derived candidate must exist on the tree or appear
    in `declared` (the launch's declared-FILES union) — free prose otherwise
    yields fake paths (masks, code fragments, extension lists); dropped
    tokens are reported once on stderr, never silently. `declared=None`
    keeps the guard off for direct/legacy callers. The finding's own files
    stay trusted (orchestrator-authored). Trust nuance: the chained launch's
    task files were grown by prior rounds, so pre-guard leaked tokens can
    self-legitimize in old runs — harmless going forward."""
    kept, dropped = [], []
    for p in instruction_paths(instruction):
        if declared is None or os.path.exists(p) or p in declared:
            kept.append(p)
        else:
            dropped.append(p)
    if dropped:
        print("%s: dropped %d instruction token(s) not on tree or in declared FILES: %s"
              % (PROG, len(dropped), ", ".join(dropped)), file=sys.stderr)
    out = []
    for p in list(task_files or []) + kept + list(finding_files or []):
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
    declared = ({p for t in tasks.values() for p in (t.get("files") or [])}
                | {p for e in entries.values() for p in (e.get("files") or [])})
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
                               instruction, f.get("files"), declared)
        tasks[tid]["files"] = list(derived)
        entries[tid]["files"] = list(derived)
        if f.get("tier"):
            entries[tid]["tier"] = f["tier"]
    print(emit_relaunch(ctx, amended, "redirect-args.json"))


if __name__ == "__main__":
    main()
