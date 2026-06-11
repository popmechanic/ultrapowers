#!/usr/bin/env python3
"""Deterministic compiler for Superpowers plans carrying ultraplan markers.

Parses a plan into tasks (fence-aware), classifies each per the plan-markers
contract (explicit **Type:** trusted; heuristics otherwise, flagged
"heuristic": true), builds the dependency DAG (marker edges + file-overlap
inference + read-after-write + ambiguous-files serialization + explicit text),
runs Kahn layering with cycle detection, and emits the Step-3 transparency
block as JSON on stdout.

The orchestrating agent runs this instead of hand-deriving waves; its
judgment is reserved for heuristic-flagged classifications and the derived
run knobs (testCmd / baseBranch / tiers / review depth), which stay with
the agent per dependency-analysis.md.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

TASK_HEAD = re.compile(r"^### Task ([A-Za-z0-9]+):\s*(.*)$")
FENCE = re.compile(r"^(`{3,})")
MARKER_TYPE = re.compile(r"^\*\*Type:\*\*\s*([a-z]+)\s*$")
MARKER_DEPS = re.compile(r"^\*\*Depends-on:\*\*\s*(.+?)\s*$")
FILE_LINE = re.compile(r"^-\s*(Create|Modify|Test):\s*(.+)$")
PATH_RE = re.compile(r"`([^`]+)`")
TEXT_DEP = re.compile(r"(?:depends on|after|requires)\s+Task\s+([A-Za-z0-9]+)", re.I)
GLOB_CHARS = re.compile(r"[*?\[]")

TYPES = ("implementation", "gate", "release", "manual")
RELEASE_EV = re.compile(
    r"(git push|git checkout main|git merge (?:main|master)\b|\bssh\b|\bscp\b"
    r"|systemctl|after the branch merges)", re.I)
MANUAL_EV = re.compile(
    r"(the owner runs|cannot be done from this machine|on the deployment)", re.I)
GATE_EV = re.compile(
    r"(pytest|npm test|bun test|cargo test|go test|ruff|eslint|git status|git log)", re.I)


def _fence_aware_lines(text):
    """Yield (line, in_fence) — a heading inside an open fence is content."""
    fence = None
    for line in text.splitlines():
        m = FENCE.match(line.strip())
        if m:
            tick = m.group(1)
            if fence is None:
                fence = tick
            elif len(tick) >= len(fence):
                fence = None
            yield line, True
            continue
        yield line, fence is not None


def split_tasks(text):
    lines = list(_fence_aware_lines(text))
    heads = []
    for i, (line, fenced) in enumerate(lines):
        if fenced:
            continue
        h = TASK_HEAD.match(line)
        if h:
            heads.append((h.group(1), h.group(2).strip(), i))
    tasks = []
    for n, (tid, title, start) in enumerate(heads):
        end = heads[n + 1][2] if n + 1 < len(heads) else len(lines)
        body = "\n".join(l for l, _ in lines[start:end]).strip()
        tasks.append({"id": tid, "title": title, "body": body, "order": n})
    return tasks


def parse_task(t):
    ttype = None
    type_unparsed = None
    deps, deps_none = [], False
    creates, modifies, reads = [], [], []
    in_files = False
    for line, fenced in _fence_aware_lines(t["body"]):
        if fenced:
            continue
        s = line.strip()
        # Check for **Type:** lines
        if s.startswith("**Type:**"):
            m = MARKER_TYPE.match(s)
            if m and ttype is None and m.group(1) in TYPES:
                ttype = m.group(1)
            elif ttype is None and type_unparsed is None:
                # Unparseable or unrecognized type marker
                remainder = s[len("**Type:**"):].strip()
                if remainder:
                    type_unparsed = remainder
        m = MARKER_DEPS.match(s)
        if m and not deps and not deps_none:
            val = m.group(1).strip()
            if val.lower() == "none":
                deps_none = True
            else:
                deps = [d.strip() for d in val.split(",") if d.strip()]
        if s.startswith("**Files:**"):
            in_files = True
            continue
        if in_files:
            f = FILE_LINE.match(s)
            if f:
                paths = PATH_RE.findall(f.group(2)) or [f.group(2).strip()]
                paths = [p.split(":")[0] for p in paths]  # drop :line-range
                if f.group(1) == "Create":
                    creates.extend(paths)
                elif f.group(1) == "Modify":
                    modifies.extend(paths)
                elif f.group(1) == "Test":
                    reads.extend(paths)
            elif s and not s.startswith("-"):
                in_files = False

    all_paths = creates + modifies + reads
    files_ambiguous = (
        (not creates and not modifies and not reads) or
        any(GLOB_CHARS.search(p) for p in all_paths)
    )

    t.update(marker_type=ttype, type_unparsed=type_unparsed,
             depends_on=deps, depends_none=deps_none,
             creates=sorted(set(creates)), modifies=sorted(set(modifies)),
             reads=sorted(set(reads)),
             writes=sorted(set(creates) | set(modifies)),
             files_ambiguous=files_ambiguous)
    return t


def classify(t):
    """Returns (disposition, heuristic). Explicit marker wins; else evidence
    in plan-markers.md precedence: release -> manual -> gate -> implementation."""
    if t["marker_type"]:
        return t["marker_type"], False
    body = t["body"]
    if RELEASE_EV.search(body):
        return "release", True
    if MANUAL_EV.search(body):
        return "manual", True
    if not t["writes"] and GATE_EV.search(body):
        return "gate", True
    return "implementation", True


def build_edges(impl):
    ids = {t["id"] for t in impl}
    edges, conflicts, seen = [], [], set()

    def add(a, b, why):
        if a in ids and b in ids and a != b and (a, b) not in seen:
            seen.add((a, b))
            edges.append({"from": a, "to": b, "why": why})
            target = next(t for t in impl if t["id"] == b)
            if target["depends_none"] and why != "marker":
                conflicts.append({
                    "task": b,
                    "edge": f"{a} -> {b} ({why})",
                    "note": "Depends-on: none overridden by inferred edge (inferred edge wins)",
                })

    for t in impl:
        for d in t["depends_on"]:
            if d in ids:
                add(d, t["id"], "marker")
            else:
                conflicts.append({
                    "task": t["id"],
                    "edge": d + " -> " + t["id"] + " (marker)",
                    "note": "Depends-on: " + d + " names a task outside the implementation set "
                            "(unknown id or gate/release/manual) — edge dropped",
                })

    for a in impl:
        for b in impl:
            if a["id"] == b["id"]:
                continue
            if set(a["creates"]) & set(b["modifies"]):
                add(a["id"], b["id"], "write-after-create")
            if set(a["writes"]) & set(b["writes"]) and a["order"] < b["order"]:
                add(a["id"], b["id"], "write-after-write")
            # read-after-write: b reads a file that a writes (no order condition)
            if set(a["writes"]) & set(b["reads"]):
                add(a["id"], b["id"], "read-after-write")

    for b in impl:
        for m in TEXT_DEP.finditer(b["body"]):
            if m.group(1) != b["id"]:
                add(m.group(1), b["id"], "text")

    # ambiguous-files: serialize task T at its document position
    for t in impl:
        if t["files_ambiguous"]:
            for u in impl:
                if u["id"] == t["id"]:
                    continue
                if u["order"] < t["order"]:
                    add(u["id"], t["id"], "ambiguous-files")
                elif u["order"] > t["order"]:
                    add(t["id"], u["id"], "ambiguous-files")

    return edges, conflicts


def layer(impl, edges):
    order = [t["id"] for t in impl]
    indeg = {i: 0 for i in order}
    succ = {i: [] for i in order}
    for e in edges:
        succ[e["from"]].append(e["to"])
        indeg[e["to"]] += 1
    waves, done = [], set()
    ready = [i for i in order if indeg[i] == 0]
    while ready:
        waves.append(sorted(ready, key=order.index))
        nxt = []
        for r in ready:
            done.add(r)
            for s in succ[r]:
                indeg[s] -= 1
                if indeg[s] == 0:
                    nxt.append(s)
        ready = nxt
    if len(done) != len(order):
        members = [i for i in order if i not in done]
        print(f"compile_plan: cycle detected among tasks {', '.join(members)} — "
              "revise the plan to break it; refusing to guess an ordering.",
              file=sys.stderr)
        raise SystemExit(1)
    return waves


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("plan", type=Path)
    args = ap.parse_args(argv)
    tasks = [parse_task(t) for t in split_tasks(args.plan.read_text())]
    if not tasks:
        print("compile_plan: no '### Task N:' headings found.", file=sys.stderr)
        raise SystemExit(1)

    # Bug D: detect duplicate task IDs early
    ids = [t["id"] for t in tasks]
    dups = sorted({i for i in ids if ids.count(i) > 1})
    if dups:
        print("compile_plan: duplicate task id(s): " + ", ".join(dups) +
              " — task headings must be unique; refusing to compile.", file=sys.stderr)
        raise SystemExit(1)

    out_tasks = []
    for t in tasks:
        disp, heuristic = classify(t)
        t["disposition"] = disp
        out_tasks.append({"id": t["id"], "title": t["title"], "disposition": disp,
                          "heuristic": heuristic, "writes": t["writes"],
                          "depends_on": t["depends_on"]})

    # Bug E1: surface unparseable type markers as conflicts
    type_conflicts = [
        {"task": t["id"], "edge": "",
         "note": "**Type:** " + repr(t["type_unparsed"]) + " is not a recognized type "
                 "(implementation/gate/release/manual) — marker ignored, heuristic applied"}
        for t in tasks if t.get("type_unparsed")]

    impl = [t for t in tasks if t["disposition"] == "implementation"]
    edges, conflicts = build_edges(impl)
    waves = layer(impl, edges)

    mode, degrade = "parallel", None
    fully_overlapping = (len(impl) > 1 and all(
        set(a["writes"]) & set(b["writes"])
        for a in impl for b in impl if a["id"] != b["id"]))
    if len(impl) <= 2 or fully_overlapping:
        mode = "sequential"
        degrade = f"Sequential mode: {len(impl)} implementation tasks" + (
            ", fully overlapping writes" if fully_overlapping else "")
        # Bug A: flatten already-computed topological layering (not document order)
        waves = [[tid] for wave in waves for tid in wave]

    print(json.dumps({
        "tasks": out_tasks,
        "dag_edges": edges,
        "marker_conflicts": type_conflicts + conflicts,
        "gates": [t["id"] for t in tasks if t["disposition"] == "gate"],
        "post_merge_runbook": [t["id"] for t in tasks
                               if t["disposition"] in ("release", "manual")],
        "waves": waves,
        "mode": mode,
        "degrade_reason": degrade,
    }, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
