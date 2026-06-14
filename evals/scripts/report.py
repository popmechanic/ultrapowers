#!/usr/bin/env python3
"""Aggregate eval results into the comparison report.

Reads evals/results/runs.jsonl (+ judgments.jsonl if present) and prints a
markdown report: per fixture x condition x engine-version medians for cost,
clock, acceptance pass rate, suite green rate, plan coverage, and fix rounds;
then judge win rates.

Rows are partitioned by engine plugin_version (sha kept as per-row provenance):
medians are never pooled across engine versions. A cell spanning multiple shas
is flagged '(N shas)'. A cell that is suite-green but has a run with plan
coverage < 100% is flagged (green-but-incomplete).
"""
import json
import pathlib
import statistics
from collections import defaultdict

EVALS = pathlib.Path(__file__).resolve().parents[1]
RESULTS = EVALS / "results"


def load(name):
    path = RESULTS / name
    if not path.exists():
        return []
    return [json.loads(l) for l in path.read_text().splitlines() if l.strip()]


def median(xs):
    return statistics.median(xs) if xs else float("nan")


def engine_key(r):
    """Partition key: the engine PLUGIN VERSION (behavior proxy).

    A behavior change ships as a release version bump, so pooling by
    plugin_version keeps pre/post-hardening runs in separate populations
    while NOT fragmenting one release across the many dev shas its rows were
    scored on. The sha is retained per-row as provenance.
    """
    e = r.get("engine")
    if not e:
        return "unknown"
    return e.get("plugin_version", "?")


def engine_shas(rs):
    return sorted({(r.get("engine") or {}).get("sha", "") for r in rs
                   if (r.get("engine") or {}).get("sha")})


def engine_label(eng, rs):
    n = len(engine_shas(rs))
    return f"{eng} ({n} shas)" if n > 1 else eng


def is_green(r):
    return r["suite"]["failed"] == 0 and r["suite"]["errors"] == 0


def coverage(r):
    """tasks_merged / tasks_planned, or None when not recorded."""
    planned = r.get("tasks_planned")
    merged = r.get("tasks_merged")
    if not planned or merged is None:
        return None
    return merged / planned


def green_but_incomplete(rs):
    """True if any run is suite-green yet merged fewer tasks than planned."""
    return any(is_green(r) and (coverage(r) is not None and coverage(r) < 1.0)
               for r in rs)


def main():
    runs = load("runs.jsonl")
    if not runs:
        raise SystemExit("no runs scored yet")

    cells = defaultdict(list)
    for r in runs:
        cells[(r["fixture"], r["condition"], engine_key(r))].append(r)

    fixtures = sorted({k[0] for k in cells})
    conditions = sorted({k[1] for k in cells})
    engines = sorted({k[2] for k in cells})

    print("# ultrapowers eval report\n")
    print(f"{len(runs)} scored runs across {len(fixtures)} fixtures, "
          f"conditions {', '.join(conditions)}, "
          f"engine versions {', '.join(engines)}.\n")
    print("> Medians are partitioned by engine plugin_version (sha kept as "
          "provenance; a cell spanning multiple shas is flagged '(N shas)'). "
          "⚠ marks a cell that is suite-green but has a run with plan "
          "coverage < 100% (green-but-incomplete).\n")

    for fixture in fixtures:
        print(f"## {fixture}\n")
        print("| cond | engine | n | median API-equiv $ | weekly % (med) "
              "| median clock | acceptance | suite green | coverage (med) "
              "| fix rounds (med) |")
        print("|------|--------|---|--------------------|----------------"
              "|--------------|------------|-------------|----------------"
              "|------------------|")
        for cond in conditions:
            for eng in engines:
                rs = cells.get((fixture, cond, eng))
                if not rs:
                    continue
                cost = median([r["cost_usd"] for r in rs])
                pcts = [r["weekly_pct"] for r in rs
                        if r.get("weekly_pct") is not None]
                pct = f"{median(pcts):.1f}%" if pcts else "-"
                clock = median([r["wall_clock_s"] for r in rs])
                acc = [r["acceptance"] for r in rs]
                acc_rate = (sum(a["passed"] for a in acc) /
                            max(1, sum(a["total"] for a in acc)))
                green = sum(1 for r in rs if is_green(r))
                covs = [c for c in (coverage(r) for r in rs) if c is not None]
                cov = f"{median(covs):.0%}" if covs else "-"
                if green_but_incomplete(rs):
                    cov += " ⚠"
                fixr = median([r["fix_rounds"] for r in rs])
                label = engine_label(eng, rs)
                print(f"| {cond} | {label} | {len(rs)} | ${cost:.2f} | {pct} "
                      f"| {clock/60:.1f}m | {acc_rate:.0%} | {green}/{len(rs)} "
                      f"| {cov} | {fixr:.0f} |")
        print()

    judgments = load("judgments.jsonl")
    if judgments:
        print("## Blinded pairwise judge\n")
        wins = defaultdict(lambda: defaultdict(int))
        run_cond = {r["run_id"]: r["condition"] for r in runs}
        for j in judgments:
            conds = tuple(sorted(run_cond.get(rid, "?") for rid in j["pair"]))
            winner = j["winner_run_id"]
            label = run_cond.get(winner, "tie")
            wins[conds][label] += 1
        print("| matchup | " + " | ".join(conditions + ["tie"]) + " |")
        print("|---------|" + "---|" * (len(conditions) + 1))
        for conds, tally in sorted(wins.items()):
            row = " | ".join(str(tally.get(c, 0)) for c in conditions + ["tie"])
            print(f"| {' vs '.join(conds)} | {row} |")
        print()

    # Cross-condition headlines, also partitioned by engine version so the
    # frozen baseline and a later (hardened) engine never fuse into one figure.
    print("## Cost per passing acceptance test\n")
    print("| cond | engine | total API-equiv $ | acceptance passed | $/pass "
          "| runs/week (Max plan) |")
    print("|------|--------|-------------------|-------------------|--------"
          "|----------------------|")
    by_cond = defaultdict(list)
    for r in runs:
        by_cond[(r["condition"], engine_key(r))].append(r)
    for cond, eng in sorted(by_cond):
        rs = by_cond[(cond, eng)]
        total = sum(r["cost_usd"] for r in rs)
        passed = sum(r["acceptance"]["passed"] for r in rs)
        per = f"${total / passed:.2f}" if passed else "n/a"
        pcts = [r["weekly_pct"] for r in rs if r.get("weekly_pct") is not None]
        rpw = f"~{100 / median(pcts):.0f}" if pcts and median(pcts) > 0 else "-"
        label = engine_label(eng, rs)
        print(f"| {cond} | {label} | ${total:.2f} | {passed} | {per} | {rpw} |")


if __name__ == "__main__":
    main()
