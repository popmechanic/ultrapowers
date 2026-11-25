#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "ultrapowers/scripts"))

from plan_check import (  # noqa: E402
    BaseTree,
    base_flag_refusal,
    gate_input_hash,
    verdicts_path,
)
from plan_parse import (  # noqa: E402
    BACKTICK_PATH_RE as PATH_RE,
    CLAIMS_GRAMMAR,
    Refusal,
    _fence_aware_lines,
    _file_bullets,
    _pre_slot,
    parse_plan_full,
    plan_grammar,
)

EXT_RE = re.compile(r"\.([A-Za-z0-9]{1,8})$")
_CASE_LINE_RE = re.compile(r"^\s*(?:test\(|it\(|def test_)")
_BANNER_RE = re.compile(
    r"^\s*(?://|#)\s*((?:[A-Z][A-Z0-9'’#,:\-]*\s+){2}[A-Z][A-Z0-9'’#,:\-]*.*?)\s*$")
_RULE_RE = re.compile(r"^\s*(?://|#)\s*[═─=\-]{20,}\s*$")
_LITERAL_MIN = 8

_REFERENT_EXTS = frozenset(
    "py js mjs cjs ts tsx jsx md json jsonl sh yml yaml toml txt html css "
    "sql csv lock cfg ini env tgz log".split())
_MIME_RE = re.compile(r"^(text|application|image|audio|video|multipart)/")


def _path_referent(tok):
    t = tok.strip()
    if (not t or any(c in t for c in "*?{}<>$~ ()'\"") or "://" in t
            or t.startswith(("-", "/", "./", "../")) or _MIME_RE.match(t)):
        return None
    t = re.sub(r":\d+(?:-\d+)?$", "", t).rstrip("/")
    if "/" in t:
        return t
    if t.startswith("."):
        return None
    m = EXT_RE.search(t)
    if m and m.group(1).lower() in _REFERENT_EXTS:
        return t
    return None


__all__ = ["base_excerpt", "gate_input", "gate_input_hash", "verdicts_path",
           "main"]

EXCERPT_FILE_CAP = 8000
EXCERPT_TOTAL_CAP = 24000
EXCERPT_MARGIN = 2

_RUN_PATH_TOKEN = re.compile(r"^[^\s]*/[^\s]*\.[A-Za-z0-9]{1,8}$")


def _claims_text(plan_path):
    text = Path(plan_path).read_text()
    try:
        grammar = plan_grammar(text)
    except Refusal as exc:
        raise SystemExit("extract_gate_input: %s" % exc)
    if grammar != CLAIMS_GRAMMAR:
        raise SystemExit(
            "extract_gate_input: %s declares no `**Grammar:** %s` header — the "
            "proof gate reads claims-v1 plans only." % (plan_path, CLAIMS_GRAMMAR))
    return text


def _task(plan_path, task_id):
    try:
        tasks = parse_plan_full(_claims_text(plan_path))[1]
    except Refusal as exc:
        raise SystemExit("extract_gate_input: %s — %s" % (plan_path, exc))
    task = next((t for t in tasks if t["id"] == task_id), None)
    if task is None:
        raise SystemExit(
            "extract_gate_input: no task %s in %s (found: %s)"
            % (task_id, plan_path, ", ".join(t["id"] for t in tasks) or "none"))
    return task


def gate_input(plan_path, task_id):
    task = _task(plan_path, task_id)
    claim, proof = task["claim"], task["proof"]
    return {"task": task["id"], "claim": claim, "proof": proof,
            "hash": gate_input_hash(claim, proof)}


def _files_in_block_order(body):
    paths = []
    for _label, toks in _file_bullets(_pre_slot(_fence_aware_lines(body))):
        for tok in toks:
            ref = _path_referent(tok)
            if ref and ref not in paths:
                paths.append(ref)
    return paths


def _proof_paths(task):
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
    out = []
    for tok in PATH_RE.findall(claim) + PATH_RE.findall(proof):
        if len(tok) >= _LITERAL_MIN and "\n" not in tok and tok not in out:
            out.append(tok)
    return out


def _headings(path, lines):
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
    keep = set()
    for i, l in enumerate(lines):
        if any(lit in l for lit in literals):
            for j in range(max(0, i - EXCERPT_MARGIN),
                           min(len(lines), i + EXCERPT_MARGIN + 1)):
                keep.add(j)
    return ["%d: %s" % (j + 1, lines[j]) for j in sorted(keep)]


def _cap(rows, budget):
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
    task = _task(plan_path, task_id)
    literals = _diet_literals(task["claim"], task["proof"])
    tree = BaseTree.from_flag(base, plan_path)
    paths = _files_in_block_order(task["body"])
    for p in _proof_paths(task):
        if p not in paths:
            paths.append(p)
    own = {}
    for label, listed in (("modify", task["modifies"]), ("delete", task["deletes"])):
        for tok in listed:
            ref = _path_referent(tok)
            if ref and ref not in own:
                own[ref] = label
    files = []
    readable = []
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
        files.append(entry)
        readable.append((entry, lines))
    spent = 0
    exhausted = False
    for entry, lines in sorted(readable, key=lambda el: el[0]["path"] in own):
        if exhausted or spent >= EXCERPT_TOTAL_CAP:
            entry["excerpt"], entry["truncated"] = "", True
        else:
            rows = _carrier_excerpt(lines, literals)
            budget = min(EXCERPT_FILE_CAP, EXCERPT_TOTAL_CAP - spent)
            excerpt, cut = _cap(rows, budget)
            entry["excerpt"], entry["truncated"] = excerpt, cut
            spent += len(excerpt.encode("utf-8"))
            if cut and budget < EXCERPT_FILE_CAP:
                exhausted = True
    for entry in files:
        if entry["path"] in own:
            entry["own"] = own[entry["path"]]
    return {"rev": str(base), "files": files}


def main(argv=None):
    ap = argparse.ArgumentParser(
        description="Print the proof gate's capped input for one claims-v1 "
                    "task.")
    ap.add_argument("plan", type=Path)
    ap.add_argument("--task", metavar="ID", required=True,
                    help="the task id as it appears in `### Task <id>:`")
    ap.add_argument("--base", metavar="SHA|DIR", default=None,
                    help="add a capped excerpt of the task's files at this "
                         "base (a 40-hex commit of the plan's repository, or "
                         "a checkout directory); the hash is unchanged")
    args = ap.parse_args(argv)
    if args.base is not None and base_flag_refusal(args.base) is not None:
        sys.stderr.write("extract: %s\n" % base_flag_refusal(args.base))
        return 2
    payload = gate_input(args.plan, args.task)
    if args.base is not None:
        payload["base"] = base_excerpt(args.plan, args.task, args.base)
    print(json.dumps(payload, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
