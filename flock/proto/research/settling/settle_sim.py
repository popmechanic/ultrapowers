#!/usr/bin/env python3
"""RESEARCH (map #1292, ticket 5). Replay the proposed stability condition over real run records.

  python3 flock/proto/research/settling/settle_sim.py flock/proto/runs/*/ [--json]

For each run it reads events.jsonl (what the host did) and reports:
  - when the prototype actually settled, and when the proposed rule would have settled
    on the same timeline (same agent behaviour, same edge results);
  - the pieces of the wait: first green snapshot, last session end, the 30 s quiet window;
  - whether the edge's fact count ever went backwards (the livelock progress measure);
  - session walls (for the stall horizon);
  - for a run that never settled, which stall kind the proposed rule names and when.

The proposed rule (see the draft comment): a run settles at
  max(last content change, last session end, last conflict close) + D
when no session is live, no task is ready or claimed, the latest snapshot's facts and check
are green, and no conflict region is open. D = max(1 s, 2 x the run's own p90 publish->edge
latency): long enough for the edge to have tested the last hash, and nothing more.
"""
import json, os, statistics, sys


def rows(run):
    return [json.loads(l) for l in open(os.path.join(run, "events.jsonl")) if l.strip()]


def p90(xs):
    s = sorted(xs)
    return s[min(len(s) - 1, int(0.9 * len(s)))] if s else None


def sim(run):
    ev = rows(run)
    start = ev[0]
    quiet = start.get("quiet_ms")
    edges = [e for e in ev if e["kind"] == "edge"]
    ends = [e for e in ev if e["kind"] == "session:end"]
    starts = [e for e in ev if e["kind"] == "session:start"]
    settled = next((e for e in ev if e["kind"] == "settled"), None)
    closes = [e for e in ev if e["kind"] == "conflict:close"]

    # publish -> the edge that tested it (the propagation delay the debounce has to cover)
    lat = []
    for e in ev:
        if e["kind"] == "publish":
            nxt = next((x for x in edges if x["t"] >= e["t"]), None)
            if nxt and nxt["reason"].startswith("publish") and nxt["t"] - e["t"] < 5000:
                lat.append(nxt["t"] - e["t"])
    D = max(1000, 2 * (p90(lat) or 500))

    # fact progress: green facts per edge, in order
    def greens(e):
        return sum(1 for xs in e["perTask"].values() for x in xs if x == 0)
    prog = [greens(e) for e in edges]
    regress = sum(1 for a, b in zip(prog, prog[1:]) if b < a)

    # session walls
    walls = []
    for s in starts:
        e = next((x for x in ends if x["agent"] == s["agent"] and x["t"] >= s["t"]), None)
        if e:
            walls.append(e["t"] - s["t"])

    last_end = max(e["t"] for e in ends)
    first_green = next((e for e in edges if e.get("green")), None)
    out = {
        "run": os.path.basename(os.path.normpath(run)),
        "quiet_s": quiet and quiet / 1000,
        "edges": len(edges),
        "D_s": D / 1000,
        "publish_to_edge_ms": {"n": len(lat), "median": lat and statistics.median(lat), "p90": p90(lat)},
        "facts_green_per_edge": prog, "fact_regressions": regress,
        "session_wall_s": [round(w / 1000, 1) for w in walls],
        "first_green_s": first_green and first_green["t"] / 1000,
        "last_session_end_s": last_end / 1000,
        "actual_settled_s": settled and settled["t"] / 1000,
        "settled_on_first_green": bool(settled and first_green and settled["snap"] == first_green["snap"]),
    }
    if settled and first_green:
        # same timeline, proposed rule: the last state change, then D
        last_change = max(first_green["t"], last_end, max((c["t"] for c in closes), default=0))
        prop = last_change + D
        out["proposed_settled_s"] = round(prop / 1000, 1)
        out["saved_s"] = round((settled["t"] - prop) / 1000, 1)
        out["saved_share_of_wall"] = round((settled["t"] - prop) / settled["t"], 2)
        out["quiet_share_of_wall"] = round((settled["t"] - last_end) / settled["t"], 2)
        out["noop_publish_after_green_s"] = round((last_end - first_green["t"]) / 1000, 1)
    else:
        # never settled: classify on the proposed rule
        last = edges[-1] if edges else None
        all_green = last and all(x == 0 for xs in last["perTask"].values() for x in xs) and last["check"] == 0
        blocking = (last or {}).get("blocking", (last or {}).get("conflicts", []))
        resolves = [e for e in ev if e["kind"] == "resolve-task"]
        same_snap_resolves = [r for r in resolves if last and r["snap"] == last["snap"]]
        if all_green and blocking:
            kind = "stale_block" if same_snap_resolves else "open_conflict_unattended"
        else:
            kind = "unknown"
        plan_ends = [e["t"] for e in ends if not str(e.get("task", "")).startswith("R:")]
        all_done = max(plan_ends)
        r_sessions = [(s_["t"], next(e["t"] for e in ends if e["agent"] == s_["agent"] and e["t"] >= s_["t"]))
                      for s_ in starts if str(s_.get("task", "")).startswith("R:")]
        r_first = (r_sessions[0][1] - r_sessions[0][0]) if r_sessions else None
        out["stall"] = {
            "kind": kind, "latest_snap": last and last["snap"], "facts_and_check_green": bool(all_green),
            "blocking": blocking, "resolve_attempts_on_same_snap": len(same_snap_resolves),
            "resolver_notes": [e.get("done", "")[:160] for e in ends if str(e.get("task", "")).startswith("R:")],
            "all_done_s": all_done / 1000,
            "first_resolve_session_s": r_first and r_first / 1000,
            "record_ends_s": ev[-1]["t"] / 1000, "clock_s": start["clock_ms"] / 1000,
            "proposed": ("a resolve attempt at ~%.0f s (all done + D) instead of after the 30 s window; "
                         "a resolve that changes nothing while every fact is green closes the region" % ((all_done + D) / 1000)
                         + ("; with the resolver's own %.0f s, settled at ~%.0f s" % (r_first / 1000, (all_done + 2 * D + r_first) / 1000) if r_first else
                            "; the resolver's outcome is not on the record")),
        }
    return out


def main():
    runs = [a for a in sys.argv[1:] if not a.startswith("--")]
    res = [sim(r) for r in runs]
    if "--json" in sys.argv:
        print(json.dumps(res, indent=1))
        return
    for r in res:
        if "stall" in r:
            s = r["stall"]
            print(f"{r['run'][:34]:34} NEVER SETTLED  kind={s['kind']} green={s['facts_and_check_green']} blocking={s['blocking']} "
                  f"resolves_on_same_snap={s['resolve_attempts_on_same_snap']} all_done={s['all_done_s']}s record_ends={s['record_ends_s']}s clock={s['clock_s']}s\n{'':36}proposed: {s['proposed']}")
        else:
            print(f"{r['run'][:34]:34} quiet={r['quiet_s']}s first_green={r['first_green_s']}s last_end={r['last_session_end_s']}s "
                  f"settled={r['actual_settled_s']}s proposed={r['proposed_settled_s']}s saved={r['saved_s']}s ({r['saved_share_of_wall']:.0%}) "
                  f"on_first_green={r['settled_on_first_green']} D={r['D_s']}s regressions={r['fact_regressions']} facts={r['facts_green_per_edge']}")
    ok = [r for r in res if "saved_s" in r]
    if ok:
        sv = [r["saved_s"] for r in ok]
        qs = [r["quiet_share_of_wall"] for r in ok]
        noop = [r["noop_publish_after_green_s"] for r in ok]
        walls = [w for r in res for w in r["session_wall_s"]]
        print(f"\nsettled runs n={len(ok)}: saved {min(sv)}–{max(sv)} s (median {statistics.median(sv)}); "
              f"quiet window share of wall {min(qs):.0%}–{max(qs):.0%}; settled on the first green snapshot {sum(r['settled_on_first_green'] for r in ok)}/{len(ok)}; "
              f"a no-change publish after green added {min(noop)}–{max(noop)} s; fact regressions {sum(r['fact_regressions'] for r in res)} over {sum(r['edges'] for r in res)} edges")
        print(f"session walls n={len(walls)}: median {statistics.median(walls):.1f} s, p90 {p90(walls):.1f} s, max {max(walls):.1f} s")


if __name__ == "__main__":
    main()
