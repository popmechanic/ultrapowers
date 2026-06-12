#!/usr/bin/env python3
"""Score a completed eval run.

Runs the fixture's own test suite, then the held-out acceptance suite (copied in
only now — executors never saw it), captures the eval-baseline...HEAD diff for
the judge, and appends one row to evals/results/runs.jsonl.

Usage:
  score_run.py <fixture> <run_dir> --condition B --rep 1 --cost-usd 14.20 \
      [--branch <integration-branch>] [--wall-clock-s N] \
      [--fix-rounds N] [--blocked-tasks N] [--redirects N] [--notes "..."]
"""
import argparse
import json
import pathlib
import shutil
import subprocess
import sys
import tempfile
import time
import xml.etree.ElementTree as ET

EVALS = pathlib.Path(__file__).resolve().parents[1]
RESULTS = EVALS / "results"
DIFFS = RESULTS / "diffs"


def run(cmd, cwd, check=True):
    return subprocess.run(cmd, cwd=cwd, check=check, capture_output=True, text=True)


def pytest_counts(target, cwd):
    """Run pytest on `target`, return (passed, failed, errors, total)."""
    with tempfile.NamedTemporaryFile(suffix=".xml", delete=False) as f:
        junit = f.name
    proc = run([sys.executable, "-m", "pytest", target, "-q", "--tb=no",
                "-p", "no:cacheprovider", f"--junitxml={junit}"], cwd, check=False)
    try:
        suite = ET.parse(junit).getroot()
    except ET.ParseError:
        sys.stderr.write(proc.stdout + proc.stderr)
        raise SystemExit(f"pytest produced no junit xml for {target}")
    finally:
        pathlib.Path(junit).unlink(missing_ok=True)
    if suite.tag == "testsuites":
        suite = suite[0]
    total = int(suite.get("tests", 0))
    failed = int(suite.get("failures", 0))
    errors = int(suite.get("errors", 0))
    skipped = int(suite.get("skipped", 0))
    return total - failed - errors - skipped, failed, errors, total


def main():
    p = argparse.ArgumentParser()
    p.add_argument("fixture")
    p.add_argument("run_dir")
    p.add_argument("--condition", required=True, choices=["A", "B", "C"])
    p.add_argument("--rep", required=True, type=int)
    p.add_argument("--cost-usd", required=True, type=float,
                   help="API-equivalent USD: real API spend, or on a subscription "
                        "plan the simulated figure from token counts x price table "
                        "(see api_equiv.py)")
    p.add_argument("--weekly-pct-before", type=float,
                   help="weekly-limit %% from /usage before the run (Max plans)")
    p.add_argument("--weekly-pct-after", type=float,
                   help="weekly-limit %% from /usage after the run (Max plans)")
    p.add_argument("--branch", help="integration branch to score (default: current HEAD)")
    p.add_argument("--wall-clock-s", type=float,
                   help="override; default = now minus prepare_run timestamp")
    p.add_argument("--fix-rounds", type=int, default=0)
    p.add_argument("--blocked-tasks", type=int, default=0)
    p.add_argument("--redirects", type=int, default=0)
    p.add_argument("--notes", default="")
    args = p.parse_args()

    run_dir = pathlib.Path(args.run_dir).resolve()
    fixture_dir = EVALS / "fixtures" / args.fixture
    acceptance_src = fixture_dir / "acceptance"
    if not acceptance_src.is_dir():
        raise SystemExit(f"no acceptance tests for fixture {args.fixture}")

    if args.branch:
        run(["git", "checkout", args.branch], run_dir)

    head = run(["git", "rev-parse", "HEAD"], run_dir).stdout.strip()

    # 1. The fixture's own suite (what the engines were verifying against).
    s_pass, s_fail, s_err, s_total = pytest_counts("tests/", run_dir)

    # 2. Held-out acceptance suite — copied in only now.
    acc_dir = run_dir / ".acceptance"
    if acc_dir.exists():
        shutil.rmtree(acc_dir)
    shutil.copytree(acceptance_src, acc_dir)
    a_pass, a_fail, a_err, a_total = pytest_counts(".acceptance/", run_dir)
    shutil.rmtree(acc_dir)

    # 3. Wall clock.
    wall = args.wall_clock_s
    if wall is None:
        meta = json.loads((run_dir / ".eval_meta.json").read_text())
        wall = round(time.time() - meta["started_epoch"], 1)

    # 4. Diff for the blinded judge.
    run_id = f"{args.fixture}-{args.condition}-{args.rep}"
    DIFFS.mkdir(parents=True, exist_ok=True)
    diff = run(["git", "diff", "eval-baseline...HEAD", "--",
                ":(exclude).eval_meta.json"], run_dir).stdout
    (DIFFS / f"{run_id}.diff").write_text(diff)

    row = {
        "run_id": run_id,
        "fixture": args.fixture,
        "condition": args.condition,
        "rep": args.rep,
        "head": head,
        "cost_usd": args.cost_usd,
        "weekly_pct": (round(args.weekly_pct_after - args.weekly_pct_before, 2)
                       if args.weekly_pct_before is not None
                       and args.weekly_pct_after is not None else None),
        "wall_clock_s": wall,
        "suite": {"passed": s_pass, "failed": s_fail, "errors": s_err, "total": s_total},
        "acceptance": {"passed": a_pass, "failed": a_fail, "errors": a_err, "total": a_total},
        "fix_rounds": args.fix_rounds,
        "blocked_tasks": args.blocked_tasks,
        "redirects": args.redirects,
        "notes": args.notes,
        "scored_epoch": time.time(),
    }
    RESULTS.mkdir(parents=True, exist_ok=True)
    with open(RESULTS / "runs.jsonl", "a") as f:
        f.write(json.dumps(row) + "\n")

    acc_rate = a_pass / a_total if a_total else 0.0
    print(f"{run_id}: suite {s_pass}/{s_total} green, "
          f"acceptance {a_pass}/{a_total} ({acc_rate:.0%}), "
          f"${args.cost_usd:.2f}, {wall:.0f}s")


if __name__ == "__main__":
    main()
