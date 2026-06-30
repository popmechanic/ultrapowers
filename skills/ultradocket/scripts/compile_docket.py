#!/usr/bin/env python3
"""Compile queued docket entries into a collision-aware execution order plus a
could-have-parallelized projection (recorded, not executed — the v2 seam).

Execution order (v1): pure score-descending.  The collision graph informs the
could-have-parallelized projection only; it does NOT reorder sequential
execution (sequential execution needs no collision-based reordering).

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


def plan_facts(plan_path):
    """Authoritative (writes, acceptance-mode) of a plan, from ONE compile_plan
    invocation. A missing/uncompilable Plan raises a friendly ValueError naming
    the plan (so the drain parks that entry with a clear reason) rather than a raw
    CalledProcessError stack trace (#34)."""
    try:
        out = subprocess.run([sys.executable, str(COMPILE_PLAN), str(plan_path)],
                             capture_output=True, text=True, check=True).stdout
    except subprocess.CalledProcessError as e:
        detail = (e.stderr or e.stdout or "").strip().splitlines()
        reason = detail[-1] if detail else f"exit {e.returncode}"
        raise ValueError(f"queued plan {plan_path!r} failed to compile: {reason}") from e
    data = json.loads(out)
    writes = set()
    for t in data.get("tasks", []):
        writes.update(t.get("writes", []))
    mode = (data.get("acceptance") or {}).get("mode", "missing")
    return writes, mode


def plan_writes(plan_path):
    """Write-set only (union of task writes), for callers that don't need the
    disposition. Thin wrapper over plan_facts."""
    return plan_facts(plan_path)[0]


def compile_docket(docket_text, facts_resolver=plan_facts, budget_usd=None):
    """Compile queued docket entries into execution order and parallelism
    projection. A Seal is required only for `sealed`-disposition plans; `suite`
    and `waived` plans are verified by the committed suite / operator and carry
    no held-out seal. Order is pure score-descending (v1).

    Raises ValueError for malformed queued entries: missing Plan, missing Seal
    on a sealed-disposition plan, or duplicate Plan paths across entries.
    """
    entries = [e for e in docket_lib.parse_docket(docket_text) if e.state == "queued"]

    missing = [e.issue for e in entries if not e.plan]
    if missing:
        raise ValueError(f"queued docket entries missing a Plan: {missing}")

    # Resolve each plan once: (writes, acceptance mode). Uncompilable -> friendly raise.
    facts = {e.plan: facts_resolver(e.plan) for e in entries}

    no_seal = [e.issue for e in entries if facts[e.plan][1] == "sealed" and not e.seal]
    if no_seal:
        raise ValueError(f"queued sealed-disposition entries missing a Seal: {no_seal}")

    plan_paths = [e.plan for e in entries]
    dupes = sorted({p for p in plan_paths if plan_paths.count(p) > 1})
    if dupes:
        raise ValueError(f"queued docket entries share a Plan path: {dupes}")

    by_score = sorted(entries, key=lambda e: -float(e.score.split()[0]))
    wsets = {e.plan: set(facts[e.plan][0]) for e in entries}

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
