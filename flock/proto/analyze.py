#!/usr/bin/env python3
"""PROTOTYPE (map #1292, ticket 4). Read one or more Flock runs into the gap readings.

  python3 flock/proto/analyze.py flock/proto/runs/<run> [...]
"""
import collections, json, os, sys


def rows(run):
    with open(os.path.join(run, "events.jsonl")) as f:
        return [json.loads(l) for l in f if l.strip()]


def flipbacks(snaps):
    """Lines (by path and text) that left the merged code and later came back."""
    n = 0
    seen_gone = collections.defaultdict(set)
    prev = {}
    for s in snaps:
        cur = {p: collections.Counter(t.split("\n")) for p, t in s["files"].items()}
        for p, c in cur.items():
            before = prev.get(p, collections.Counter())
            for line in before - c:
                seen_gone[p].add(line)
            for line in c - before:
                if line in seen_gone[p] and line.strip():
                    n += 1
                    seen_gone[p].discard(line)
        prev = cur
    return n


def one(run):
    ev = rows(run)
    summ = json.load(open(os.path.join(run, "summary.json")))
    snaps = json.load(open(os.path.join(run, "snapshots.json")))
    by = collections.defaultdict(list)
    for r in ev:
        by[r["kind"]].append(r)
    proofs = by["proof"]
    red_proofs = [p for p in proofs if any(x != 0 for x in p["exits"])]
    causes = collections.Counter(c["cause"].split(":")[0] for p in red_proofs for c in p["causes"])
    tests = by["test"]
    test_causes = collections.Counter((t.get("cause") or {}).get("cause", "unknown").split(":")[0] for t in tests if t["red"])
    edits = by["edit"]
    last_pub = max([r["t"] for r in by["publish"] + by["session:end"]] or [0])
    return {
        "run": os.path.basename(run),
        "settled": bool(summ["settled"]), "wall_s": round(summ["wall_ms"] / 1000),
        "settle_after_last_publish_s": round((summ["settled"]["t"] - last_pub) / 1000) if summ["settled"] else None,
        "final_green": summ["final"] and summ["final"]["green"],
        "sessions": summ["sessions"], "reopens": len(by["reopen"]), "releases": sum(1 for r in by["session:end"] if r.get("released")),
        "snapshots": summ["snapshots"], "flipbacks": flipbacks(snaps),
        "edits": len(edits), "edit_how": dict(collections.Counter(e["how"] for e in edits)),
        "edits_touching_peer_lines": sum(1 for e in edits if e["peer_lines"]),
        "fallbacks": len(by["fallback"]),
        "proof_runs": len(proofs), "proof_red": len(red_proofs), "proof_red_causes": dict(causes),
        "test_runs": len(tests), "test_red": sum(1 for t in tests if t["red"]), "test_red_causes": dict(test_causes),
        "pulls": len(by["pull"]), "pull_conflicts": sum(1 for p in by["pull"] for c in p["changed"] if c["conflict"]),
        "beliefs": summ["beliefs"], "board_ops": summ["board_ops"],
        "tokens": summ["tokens"],
        **second_pass(by, summ),
    }


def err_class(e):
    """A red proof's last exception line, reduced to what kind of wait it was."""
    if not e:
        return "assert/exit"
    if "NotImplementedError" in e:
        return "stub not yet written"
    if "has no attribute 'amount'" in e or "has no attribute 'quantity'" in e or "unexpected keyword argument 'amount'" in e:
        return "rename not yet landed"
    if "ImportError" in e or "cannot import name" in e:
        return "symbol not yet written"
    return e.split(":")[0]


def second_pass(by, summ):
    """Ticket 4, second pass (additive): conflicts, edit-location errors, red kinds, board."""
    red = [p for p in by["proof"] if any(x != 0 for x in p["exits"])]
    return {
        "conflicts_opened": len(by["conflict:open"]), "conflicts_closed": len(by["conflict:close"]),
        "conflict_unions": len(by["conflict:union"]), "resolve_tasks": len(by["resolve-task"]),
        "edit_failures": len(by["edit:fail"]),
        "edit_fail_kinds": dict(collections.Counter(e["kind"] for e in by["edit:fail"])),
        "peer_lines_touched": sum(e["peer_lines"] for e in by["edit"]),
        "shell_write_denied": len(by["deny:shell-write"]),
        "proof_red_kinds": dict(collections.Counter(err_class(e) for p in red for e in p.get("errs", []))),
        "output_tokens": summ["tokens"]["output"],
        "board": summ.get("board", "standin"),
        "board_writes_per_s": summ.get("board_writes_per_s"),
        "board_peak_writes_per_s": summ.get("board_peak_writes_per_s"),
        "board_by_op": summ.get("board_by_op"),
    }


if __name__ == "__main__":
    for run in sys.argv[1:]:
        print(json.dumps(one(run), indent=1))
