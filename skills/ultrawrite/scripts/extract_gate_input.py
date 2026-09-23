#!/usr/bin/env python3
"""Build the proof gate's diet for one claims-v1 task — mechanically capped.

The gate's judgment is not mechanizable; what it READS is (spec 2026-08-31 §4,
"deterministic input, non-deterministic judgment"). This script is that cap: it
parses the plan with the sandbox's own parser (`plan_parse.py`) and prints exactly the
task's Claim and Proof, plus the hash the gate's verdict is keyed on. Context,
Authorized-by, Interfaces, Stale-if and every sibling task stay out — not by the
reader's restraint but because they never reach the reader.

    extract_gate_input.py <plan.md> --task <id>

prints `{"task", "claim", "proof", "hash"}` where hash is
`sha256(claim + "\\x00" + proof)` — the same value `plan_check.py` recomputes
when it checks `<plan-stem>.gate-verdicts.json` (§4.5). `verdicts_path` is
re-exported here so gate tooling has one import for both halves of the contract.

    extract_gate_input.py <plan.md> --task <id> --base <sha|dir>

adds one top-level key, `base` (#989): a capped excerpt of what the task's
Files and the paths its Proof names hold at that base — present or absent,
line count, headings or test names, and the lines carrying the diet's own
literals — so the reader can say "a test already pins the opposite" or "the
section this leg names does not exist" instead of judging shape alone. The
hash does not change: it is over the Claim and Proof only, so a moved base
never stales a verdict (the base a verdict was read against is the tally's).

    extract_gate_input.py <plan.md> --plan

is the plan-level diet (#552): the header's ONE operator sentence and every
task's Machine restatement, so the gate can ask whether the machine halves add
up to what the operator signed. No task's Claim, Proof or Context rides here,
and the header sentence never rides in a task's diet — the two hashes are over
disjoint text.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

# scripts -> ultrawrite -> skills; `plan_parse.py` owns the grammar and this
# script never re-implements it.
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "ultrapowers/scripts"))

from plan_check import (  # noqa: E402
    _BANNER_RE,
    _CASE_LINE_RE,
    _LITERAL_MIN,
    _RULE_RE,
    _path_referent,
    BaseTree,
    PATH_RE,
    base_flag_refusal,
    gate_input_hash,
    verdicts_path,
)
from plan_parse import (  # noqa: E402
    CLAIMS_GRAMMAR,
    Refusal,
    machine_restatement,
    parse_plan_claim,
    parse_plan_full,
    plan_grammar,
)

__all__ = ["base_excerpt", "gate_input", "gate_input_hash", "plan_input",
           "verdicts_path", "main"]

# The excerpt's caps (#989): three times the largest excerpt measured on the
# four tasks of the 2026-09-15 authoring-cost plan (6,216 bytes for one file,
# 9,542 for one task), so a normal task's files reach the reader whole.
EXCERPT_FILE_CAP = 8000
EXCERPT_TOTAL_CAP = 24000
# A carrier line rides with the two lines before it and the two after.
EXCERPT_MARGIN = 2

_FILES_BULLET = re.compile(r"^-\s*(Create|Modify|Delete):\s*(.+)$")
_RUN_PATH_TOKEN = re.compile(r"^[^\s]*/[^\s]*\.[A-Za-z0-9]{1,8}$")


def _claims_text(plan_path):
    """The plan's text, or a refusal when it is not written in claims-v1."""
    text = Path(plan_path).read_text()
    if plan_grammar(text) != CLAIMS_GRAMMAR:
        raise SystemExit(
            "extract_gate_input: %s declares no `**Grammar:** %s` header — the "
            "proof gate reads claims-v1 plans only." % (plan_path, CLAIMS_GRAMMAR))
    return text


def _tasks(plan_path, text):
    """Every task of the plan, as `plan_parse.py` reads it."""
    try:
        return parse_plan_full(text)[1]
    except Refusal as exc:
        raise SystemExit("extract_gate_input: %s — %s" % (plan_path, exc))


def _task(plan_path, task_id):
    tasks = _tasks(plan_path, _claims_text(plan_path))
    task = next((t for t in tasks if t["id"] == task_id), None)
    if task is None:
        raise SystemExit(
            "extract_gate_input: no task %s in %s (found: %s)"
            % (task_id, plan_path, ", ".join(t["id"] for t in tasks) or "none"))
    return task


def gate_input(plan_path, task_id):
    """The (Claim, Proof) diet for one task of a claims-v1 plan, plus its hash."""
    task = _task(plan_path, task_id)
    claim, proof = task["claim"], task["proof"]
    return {"task": task["id"], "claim": claim, "proof": proof,
            "hash": gate_input_hash(claim, proof)}


def _files_in_block_order(body):
    """The task's Files paths as the block lists them — `Create:`, `Modify:`
    and `Delete:` bullets in their written order, first mention wins. The
    reader is shown the author's order."""
    paths = []
    in_files = False
    for line in body.splitlines():
        if line.startswith("**Files:**"):
            in_files = True
            continue
        if in_files and line.startswith("**"):
            break
        if not in_files:
            continue
        m = _FILES_BULLET.match(line.strip())
        if not m:
            continue
        for tok in PATH_RE.findall(m.group(2)):
            ref = _path_referent(tok)
            if ref and ref not in paths:
                paths.append(ref)
    return paths


def _proof_paths(task):
    """Every repository path the Proof names: its backticked tokens that are
    path referents, then every whitespace-separated token of a `Run:` command
    that contains `/` and ends in a dot and 1–8 alphanumerics."""
    paths = []
    for tok in PATH_RE.findall(task["proof"]):
        ref = _path_referent(tok)
        if ref and ref not in paths:
            paths.append(ref)
    for command in task["proofRuns"]:
        for tok in command.split():
            tok = tok.strip("'\"")
            if _RUN_PATH_TOKEN.match(tok) and not tok.startswith(("-", "/", "./", "../")):
                if tok not in paths:
                    paths.append(tok)
    return paths


def _diet_literals(claim, proof):
    """The backticked tokens of the Claim and Proof that are at least
    `_LITERAL_MIN` characters and carry no newline — the words a file line
    must contain, verbatim, to be a carrier."""
    out = []
    for tok in PATH_RE.findall(claim) + PATH_RE.findall(proof):
        if len(tok) >= _LITERAL_MIN and "\n" not in tok and tok not in out:
            out.append(tok)
    return out


def _headings(path, lines):
    """A `.md` file's `#` lines; any other file's test-case lines and section
    banners (`plan_check.py`'s own two shapes), in file order."""
    if path.endswith(".md"):
        return [l for l in lines if l.startswith("#")]
    out = []
    for l in lines:
        if _CASE_LINE_RE.match(l):
            out.append(l)
            continue
        m = _BANNER_RE.match(l)
        if m and not _RULE_RE.match(l):
            out.append(l)
    return out


def _carrier_excerpt(lines, literals):
    """The numbered carrier regions: every line holding a literal, with
    `EXCERPT_MARGIN` lines either side, each line once, ascending."""
    keep = set()
    for i, l in enumerate(lines):
        if any(lit in l for lit in literals):
            for j in range(max(0, i - EXCERPT_MARGIN),
                           min(len(lines), i + EXCERPT_MARGIN + 1)):
                keep.add(j)
    return ["%d: %s" % (j + 1, lines[j]) for j in sorted(keep)]


def _cap(rows, budget):
    """Join `rows` with newlines, cut at a line boundary so the text is at
    most `budget` bytes of UTF-8. (text, truncated)."""
    out = []
    size = 0
    for r in rows:
        add = len(r.encode("utf-8")) + (1 if out else 0)
        if size + add > budget:
            return "\n".join(out), True
        out.append(r)
        size += add
    return "\n".join(out), False


def base_excerpt(plan_path, task_id, base):
    """The `base` key (#989): what the task's Files and its Proof's paths hold
    at `base` — a `BaseTree` flag value (40-hex sha of the plan's repository,
    or a checkout directory). Never touches the hash."""
    task = _task(plan_path, task_id)
    literals = _diet_literals(task["claim"], task["proof"])
    tree = BaseTree.from_flag(base, plan_path)
    paths = _files_in_block_order(task["body"])
    for p in _proof_paths(task):
        if p not in paths:
            paths.append(p)
    files = []
    spent = 0
    exhausted = False  # the total cap has cut an entry: nothing later rides
    for path in paths:
        if tree._blob_mode(path) is None:
            files.append({"path": path, "status": "absent"})
            continue
        raw = tree.read_text(path)
        if raw is None:
            files.append({"path": path, "status": "absent"})
            continue
        lines = raw.splitlines()
        entry = {"path": path, "status": "present", "lines": len(lines),
                 "headings": _headings(path, lines)}
        if exhausted or spent >= EXCERPT_TOTAL_CAP:
            entry["excerpt"], entry["truncated"] = "", True
        else:
            rows = _carrier_excerpt(lines, literals)
            budget = min(EXCERPT_FILE_CAP, EXCERPT_TOTAL_CAP - spent)
            excerpt, cut = _cap(rows, budget)
            entry["excerpt"], entry["truncated"] = excerpt, cut
            spent += len(excerpt.encode("utf-8"))
            if cut and budget < EXCERPT_FILE_CAP:
                exhausted = True  # it was the TOTAL that cut this one
        files.append(entry)
    return {"rev": str(base), "files": files}


def plan_input(plan_path):
    """The plan-level diet: the header's operator sentence and every task's
    Machine restatement, keyed by a hash over exactly those two (#552)."""
    text = _claims_text(plan_path)
    claim = parse_plan_claim(text)
    if not claim:
        raise SystemExit(
            "extract_gate_input: %s carries no plan-level Claim — the one "
            "elicited operator sentence sits above the first task." % plan_path)
    entries = [{"id": t["id"], "machine": machine_restatement(t["claim"])}
               for t in _tasks(plan_path, text)]
    machines = "\n".join(e["machine"] for e in entries)
    return {"claim": claim, "tasks": entries,
            "hash": hashlib.sha256(
                (claim + "\x00" + machines).encode("utf-8")).hexdigest()}


def main(argv=None):
    ap = argparse.ArgumentParser(
        description="Print the proof gate's capped input for one claims-v1 "
                    "task, or for the plan.")
    ap.add_argument("plan", type=Path)
    # Exactly one diet per invocation: a task's (Claim, Proof) or the plan's
    # (Claim, Machines). Mixing them would put the header sentence in front of
    # a task gate, which is the one thing the cap exists to prevent.
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--task", metavar="ID",
                      help="the task id as it appears in `### Task <id>:`")
    mode.add_argument("--plan", action="store_true", dest="plan_mode",
                      help="the plan-level diet: header Claim + every Machine")
    ap.add_argument("--base", metavar="SHA|DIR", default=None,
                    help="add a capped excerpt of the task's files at this "
                         "base (a 40-hex commit of the plan's repository, or "
                         "a checkout directory); the hash is unchanged")
    args = ap.parse_args(argv)
    if args.plan_mode and args.base is not None:
        ap.exit(2, "extract_gate_input: --base rides a task diet only; the "
                   "plan-level diet (--plan) reads no tree\n")
    # A base that is neither a checkout directory nor a 40-hex sha is refused
    # here, before the tree reader sees it: that reader treats any non-sha
    # value as a directory on purpose, so an 8-character abbreviation became
    # `git -C <abbrev>` and every file read `absent` — a diet six gate readers
    # were handed on 2026-09-15 (#1025). A 40-hex sha the repository does not
    # have is still the reader's own `error:` refusal.
    if args.base is not None and base_flag_refusal(args.base) is not None:
        sys.stderr.write("extract: %s\n" % base_flag_refusal(args.base))
        return 2
    payload = (plan_input(args.plan) if args.plan_mode
               else gate_input(args.plan, args.task))
    if args.base is not None:
        payload["base"] = base_excerpt(args.plan, args.task, args.base)
    print(json.dumps(payload, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
