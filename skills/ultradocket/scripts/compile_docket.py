#!/usr/bin/env python3
"""Compile queued docket entries into a collision-aware execution order plus a
could-have-parallelized projection (recorded, not executed — the v2 seam).

A plan's write-set comes from the authoritative compiler: run
skills/ultrapowers/scripts/compile_plan.py <plan> and union tasks[].writes.
Spec: docs/superpowers/specs/2026-06-12-docket-design.md
"""
import argparse
import json
import pathlib
import subprocess
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import docket_lib  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[3]
COMPILE_PLAN = ROOT / "skills/ultrapowers/scripts/compile_plan.py"


def plan_writes(plan_path):
    """Authoritative write-set of a plan: union of its tasks' writes."""
    out = subprocess.run([sys.executable, str(COMPILE_PLAN), str(plan_path)],
                         capture_output=True, text=True, check=True).stdout
    data = json.loads(out)
    writes = set()
    for t in data.get("tasks", []):
        writes.update(t.get("writes", []))
    return writes


def compile_docket(docket_text, writes_resolver=plan_writes, budget_usd=None):
    entries = [e for e in docket_lib.parse_docket(docket_text) if e.state == "queued"]
    by_score = sorted(entries, key=lambda e: -float(e.score.split()[0]))
    wsets = {e.plan: set(writes_resolver(e.plan)) for e in entries}

    collisions = []
    for i, a in enumerate(by_score):
        for b in by_score[i + 1:]:
            shared = wsets[a.plan] & wsets[b.plan]
            if shared:
                collisions.append({"plans": [a.plan, b.plan], "shared": sorted(shared)})

    order = [e.plan for e in by_score]

    remaining = list(order)
    groups = []
    while remaining:
        group, used = [], set()
        for p in list(remaining):
            if not (wsets[p] & used):
                group.append(p)
                used |= wsets[p]
                remaining.remove(p)
        groups.append(group)
    projection = {
        "groups": groups,
        "max_concurrent": max(len(g) for g in groups) if groups else 0,
        "critical_path_len": len(groups),
    }

    return {"order": order, "collisions": collisions,
            "budget_usd": budget_usd, "could_have_parallelized": projection}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("docket", help="path to docket.md")
    ap.add_argument("--budget-usd", type=float, default=None)
    args = ap.parse_args()
    text = pathlib.Path(args.docket).read_text()
    print(json.dumps(compile_docket(text, budget_usd=args.budget_usd), indent=2))


if __name__ == "__main__":
    main()
