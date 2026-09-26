#!/usr/bin/env python3
"""PROTOTYPE (map #1292, ticket 4). Read a finished factory run on flock-baseline into the
same readings the laptop side prints: wall, cost by role, dispatches, landings, conflicts."""
import collections, json, subprocess, sys
from datetime import datetime

def show(ref, path):
    return subprocess.run(["git", "-C", sys.argv[1], "show", f"{ref}:{path}"], capture_output=True, text=True).stdout

def ts(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))

repo = sys.argv[1]
for n in sys.argv[2:]:
    subprocess.run(["git", "-C", repo, "fetch", "-q", "origin", f"refs/tags/ultra/evidence/run-{n}:refs/tags/ultra/evidence/run-{n}"])
    ref = f"ultra/evidence/run-{n}"
    st = json.loads(show(ref, f".ultrapowers/runs/{n}/status.json"))
    ev = [json.loads(l) for l in show(ref, f".ultrapowers/runs/{n}/events.jsonl").splitlines() if l.strip()]
    kinds = collections.Counter(r["kind"] for r in ev)
    first = min(ts(r["ts"]) for r in ev if "ts" in r)
    merge = [r for r in ev if r["kind"] == "merge"]
    end = ts(merge[-1]["ts"]) if merge else max(ts(r["ts"]) for r in ev if "ts" in r)
    cost = collections.defaultdict(float)
    walls = collections.defaultdict(int)
    for r in ev:
        if r["kind"] == "dispatch:end":
            cost[r.get("role")] += r.get("cost_usd") or 0
            walls[r.get("role")] += r.get("wall_ms") or 0
    print(json.dumps({
        "run": n, "state": st.get("state"), "merged": st.get("merged"), "pr": st.get("pr"),
        "engine_wall_s": round((end - first).total_seconds()),
        "vm_wall_s": round((ts(st["updatedAt"]) - ts(st["startedAt"])).total_seconds()) if st.get("startedAt") else None,
        "cost_usd": round(sum(cost.values()), 3), "cost_by_role": {k: round(v, 3) for k, v in cost.items()},
        "worker_s_by_role": {k: round(v / 1000) for k, v in walls.items()},
        "dispatches": kinds["dispatch:end"], "landings": [{"task": r["task"], "k": r.get("k"), "factsExit": r.get("factsExit")} for r in ev if r["kind"] == "landing"],
        "fold_verify": kinds["fold:verify"], "fold_red": kinds["fold:red"], "resolver": sum(1 for r in ev if r["kind"] == "dispatch:end" and r.get("role") == "resolve"),
        "referees": kinds["referee"], "redispatch": kinds["redispatch"], "union": kinds["union"],
    }, indent=1))
