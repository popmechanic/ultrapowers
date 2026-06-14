#!/usr/bin/env python3
"""Mechanically score a completed headless eval run.

Replaces the hand-scoring steps used on the human-gated rep-1 runs: finds the
integration branch, computes cost from transcripts (extract_tokens accounting,
validated against the Claude Code client display), parses fix-rounds and
blocked-tasks from the workflow result, then delegates to score_run.py.

Usage:
  autoscore.py <fixture> <run_dir> --condition B --rep 2 --wall-clock-s 1015
"""
import argparse
import json
import pathlib
import re
import subprocess
import sys

SCRIPTS = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))
from extract_tokens import PRICES, harvest_file, tier  # noqa: E402

PROJECTS = pathlib.Path.home() / ".claude" / "projects"


def integration_branch(run_dir):
    out = subprocess.run(["git", "branch", "--list", "ultra/integration-*",
                          "--format", "%(refname:short)"],
                         cwd=run_dir, capture_output=True, text=True).stdout.strip()
    branches = [b for b in out.splitlines() if b]
    if len(branches) != 1:
        raise SystemExit(f"expected exactly one integration branch, found {branches}")
    return branches[0]


def run_cost(run_dir):
    """Harvest every transcript file under the run's project dirs, deduped."""
    stem = pathlib.Path(run_dir).resolve().name  # e.g. chained-B-2
    files = set()
    for proj in PROJECTS.glob(f"*-eval-runs-{stem}*"):
        files.update(proj.rglob("*.jsonl"))
    if not files:
        raise SystemExit(f"no transcripts found for {stem} under {PROJECTS}")
    acc = {}
    for f in sorted(files):
        harvest_file(str(f), acc)
    total = 0.0
    for model, a in acc.items():
        p_in, p_out = PRICES[model]
        eff = a["in"] + 1.25 * (a["cc_5m"] + a["cc_1h"]) + 0.1 * a["cr"]
        total += eff / 1e6 * p_in + a["out"] / 1e6 * p_out
    return round(total, 2), len(files)


def parse_counters(flat):
    """Pull reliability counters from a de-escaped workflow-result line.

    Returns dict(fixes, blocked, planned, merged), or None if the line carries
    no task entries (a differently-escaped echo must not silently zero them).
    """
    fixes = re.findall(r'fixIterations":\s*(\d+)', flat)
    statuses = re.findall(r'"status":\s*"(\w+)"', flat)
    if not fixes and not statuses:
        return None
    return {
        "fixes": sum(int(m) for m in fixes),
        "blocked": sum(1 for s in statuses if s not in ("done", "MERGED")),
        "planned": len(statuses),
        "merged": sum(1 for s in statuses if s in ("done", "MERGED")),
    }


def reliability_counters(run_dir):
    """Best (last parseable) counters from the workflow result transcript."""
    stem = pathlib.Path(run_dir).resolve().name
    best = None
    for proj in PROJECTS.glob(f"*-eval-runs-{stem}*"):
        for f in proj.glob("*.jsonl"):
            for line in open(f, errors="replace"):
                if "fixIterations" not in line or "integrationBranch" not in line:
                    continue
                c = parse_counters(line.replace("\\", ""))
                if c is not None:
                    best = c
    if best is None:
        return None, "workflow result summary not found in transcript"
    return best, ""


def main():
    p = argparse.ArgumentParser()
    p.add_argument("fixture")
    p.add_argument("run_dir")
    p.add_argument("--condition", required=True, choices=["B", "C"])
    p.add_argument("--rep", required=True, type=int)
    p.add_argument("--wall-clock-s", required=True, type=float)
    args = p.parse_args()

    branch = integration_branch(args.run_dir)
    cost, n_files = run_cost(args.run_dir)
    counters, counter_note = reliability_counters(args.run_dir)
    if counters is None:
        counters = {"fixes": 0, "blocked": 0, "planned": 0, "merged": 0}

    notes = ("automated headless run; gates scripted per approved protocol "
             "amendment; wall clock = headless process duration; cost via "
             f"extract_tokens accounting over {n_files} transcript files; "
             "weekly_pct estimated from tokens (null here, batch-reconciled)")
    if counter_note:
        notes += f"; {counter_note}"

    cmd = [sys.executable, str(SCRIPTS / "score_run.py"),
           args.fixture, args.run_dir,
           "--condition", args.condition, "--rep", str(args.rep),
           "--cost-usd", f"{cost:.2f}",
           "--wall-clock-s", str(args.wall_clock_s),
           "--branch", branch,
           "--fix-rounds", str(counters["fixes"]),
           "--blocked-tasks", str(counters["blocked"]),
           "--tasks-planned", str(counters["planned"]),
           "--tasks-merged", str(counters["merged"]),
           "--redirects", "0",
           "--notes", notes]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    sys.stdout.write(proc.stdout)
    sys.stderr.write(proc.stderr)
    raise SystemExit(proc.returncode)


if __name__ == "__main__":
    main()
