#!/usr/bin/env python3
"""Aggregate eval results into the comparison report.

Reads evals/results/runs.jsonl (+ judgments.jsonl if present) and prints a
markdown report: per fixture x condition medians for cost, clock, acceptance
pass rate, suite green rate, and fix rounds; then judge win rates.
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


def main():
    runs = load("runs.jsonl")
    if not runs:
        raise SystemExit("no runs scored yet")

    cells = defaultdict(list)
    for r in runs:
        cells[(r["fixture"], r["condition"])].append(r)

    fixtures = sorted({f for f, _ in cells})
    conditions = sorted({c for _, c in cells})

    print("# ultrapowers eval report\n")
    print(f"{len(runs)} scored runs across {len(fixtures)} fixtures, "
          f"conditions {', '.join(conditions)}.\n")

    for fixture in fixtures:
        print(f"## {fixture}\n")
        print("| cond | n | median $ | median clock | acceptance | suite green | fix rounds (med) |")
        print("|------|---|----------|--------------|------------|-------------|------------------|")
        for cond in conditions:
            rs = cells.get((fixture, cond))
            if not rs:
                continue
            cost = median([r["cost_usd"] for r in rs])
            clock = median([r["wall_clock_s"] for r in rs])
            acc = [r["acceptance"] for r in rs]
            acc_rate = (sum(a["passed"] for a in acc) /
                        max(1, sum(a["total"] for a in acc)))
            green = sum(1 for r in rs
                        if r["suite"]["failed"] == 0 and r["suite"]["errors"] == 0)
            fixr = median([r["fix_rounds"] for r in rs])
            print(f"| {cond} | {len(rs)} | ${cost:.2f} | {clock/60:.1f}m "
                  f"| {acc_rate:.0%} | {green}/{len(rs)} | {fixr:.0f} |")
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

    # Cross-condition headline (acceptance-weighted): cost per passing
    # acceptance test, the single number that fuses economy and quality.
    print("## Cost per passing acceptance test\n")
    print("| cond | total $ | acceptance passed | $/pass |")
    print("|------|---------|-------------------|--------|")
    by_cond = defaultdict(list)
    for r in runs:
        by_cond[r["condition"]].append(r)
    for cond in conditions:
        rs = by_cond[cond]
        total = sum(r["cost_usd"] for r in rs)
        passed = sum(r["acceptance"]["passed"] for r in rs)
        per = total / passed if passed else float("inf")
        print(f"| {cond} | ${total:.2f} | {passed} | ${per:.2f} |")


if __name__ == "__main__":
    main()
