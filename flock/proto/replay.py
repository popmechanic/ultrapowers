#!/usr/bin/env python3
"""PROTOTYPE (map #1292, ticket 4). Replay a run's weave-ops.jsonl into a fresh
keeper and show every agent's copy of a path after each pull (or after op N).

  python3 flock/proto/replay.py <run dir> <path> [--after N]
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import weave as W  # noqa: E402


def main():
    run, path = sys.argv[1], sys.argv[2]
    after = int(sys.argv[sys.argv.index("--after") + 1]) if "--after" in sys.argv else None
    k = W.Keeper()
    ops = [json.loads(l) for l in open(os.path.join(run, "weave-ops.jsonl"))]
    for i, o in enumerate(ops):
        o = dict(o)
        t = o.pop("t")
        op = o.pop("op")
        res = getattr(k, "r_" + op)(**o)
        show = (after is not None and i == after) or (after is None and op == "pull" and any(c["path"] == path for c in res.get("changed", [])))
        if op == "edit" and o.get("path") == path:
            print(f"#{i} t={t} edit {o['agent']} [{o['vstart']},{o['vend']}) -> {o['lines']}")
        if show:
            print(f"\n==== #{i} t={t} {op} {o.get('agent','')} ====")
            for n, (line, who) in enumerate(zip(k.lines(o.get("agent", "A"), path), k.r_authors(o.get("agent", "A"), path)["authors"])):
                print(f"{n+1:3} {who:>4} | {line}")
            if res.get("changed"):
                print("  conflict:", [c["conflict"] for c in res["changed"] if c["path"] == path])


if __name__ == "__main__":
    W.fold_wave.run_on_kernel_thread(main)
