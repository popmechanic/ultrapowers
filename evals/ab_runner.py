#!/usr/bin/env python3
"""One A/B cell, start to finish (#402 item 6).

    python3 evals/ab_runner.py <fixture> --overlap fold|serialize \\
        [--run-id ID] [--results-dir DIR] [--fixtures-root DIR] [--workspace DIR]

One invocation = one cell = one row. The A/B protocol is those invocations run
serially by hand on the operator's laptop; concurrent /ultrapowers runs corrupt
each other's checkouts (CLAUDE.md), and nothing here ever runs in CI.

The four moves, in order:

    build_cell   (ab_lib)   assemble + commit a throwaway repo from the fixture
    seed_worker_auth (ab_auth)  lift the live token into a COPY of the env
    node fleet/run-main.mjs <plan.md> <runId> --repo <cell> --overlap <arm>
    harvest_row  (ab_lib)   one row appended to results/runs.jsonl

The runner PRINTS where the cell repo and its run dir live and copies neither.
The run dir already holds the events, envelopes and receipts; the old rig
copied them out only to survive OS temp cleanup, and `--workspace` now lets the
operator put the cell somewhere durable instead.

Every subprocess goes through the `run` seam — the engine spawn and the
Keychain probe alike — so the tests can drive the whole path without a real
`claude` or `node` ever starting. The only exception is the git plumbing inside
build_cell, which spawns git and nothing else.

The seeded credential rides ONE subprocess env and never touches os.environ,
this module's messages, or the row.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ab_auth import seed_worker_auth        # noqa: E402
from ab_lib import build_cell, harvest_row  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[1]
ENGINE = "fleet/run-main.mjs"
ARMS = ("fold", "serialize")

# run-main.mjs's own runId shape rule (parseArgs): the runId names the run dir,
# the integration branch and the worktree glob, so the engine rejects anything
# outside this alphabet. Checked here too — a refusal before the spawn costs
# nothing, where the engine's costs a preflight.
RUN_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9-]*$")


class _Refusal(Exception):
    """A bad invocation: report it, spawn nothing, exit 2."""


class _Parser(argparse.ArgumentParser):
    """argparse that refuses instead of calling sys.exit, so `main` stays a
    function returning an int (the tests call it directly)."""

    def error(self, message):
        raise _Refusal("%s\n%s" % (message, self.format_usage().strip()))


def _build_parser():
    parser = _Parser(prog="ab_runner.py", description=__doc__.splitlines()[0])
    parser.add_argument("fixture", help="fixture name under --fixtures-root")
    parser.add_argument("--overlap", required=True, choices=ARMS,
                        help="the arm this cell runs (the A/B dimension)")
    parser.add_argument("--run-id", default=None,
                        help="default: ab-<UTC yyyymmddHHMMSS>")
    parser.add_argument("--results-dir", default=None,
                        help="default: evals/results")
    parser.add_argument("--fixtures-root", default=None,
                        help="default: evals/fixtures (read-only; test seam)")
    parser.add_argument("--workspace", default=None,
                        help="where the cell repo is assembled "
                             "(default: a mkdtemp; pass a durable dir to keep it)")
    return parser


def _default_run_id():
    return "ab-" + datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")


def _engine_ref(run, repo_root):
    """The engine's own commit, for the row. Empty (None) rather than fatal:
    a missing ref is a weaker row, not a reason to skip the cell."""
    result = run(["git", "rev-parse", "--short", "HEAD"], cwd=str(repo_root),
                 capture_output=True, text=True)
    ref = (result.stdout or "").strip()
    return ref if result.returncode == 0 and ref else None


def _append_row(results_dir, row):
    results_dir.mkdir(parents=True, exist_ok=True)
    # Append-only, one JSON object per line: this file carries the 0.1.0
    # baseline rows and is never rewritten.
    with (results_dir / "runs.jsonl").open("a") as handle:
        handle.write(json.dumps(row) + "\n")


def main(argv, run=subprocess.run):
    """Run one cell; return 0 iff the engine exited 0, 2 on a refusal."""
    try:
        args = _build_parser().parse_args(argv)
        run_id = args.run_id or _default_run_id()
        if not RUN_ID_RE.match(run_id):
            raise _Refusal("--run-id must be [A-Za-z0-9-] (got %r)" % run_id)
        fixtures_root = Path(args.fixtures_root) if args.fixtures_root \
            else REPO_ROOT / "evals" / "fixtures"
        fixture_dir = fixtures_root / args.fixture
        # Refuse before anything is spawned or assembled: an unknown fixture
        # is a typo, and the operator finds out in a second, not a preflight.
        if not fixture_dir.is_dir():
            raise _Refusal("unknown fixture: %s" % fixture_dir)
        if not (fixture_dir / "plan.md").is_file():
            raise _Refusal("fixture has no plan.md: %s" % (fixture_dir / "plan.md"))
        if not (fixture_dir / "project").is_dir():
            raise _Refusal("fixture has no project/ tree: %s"
                           % (fixture_dir / "project"))
    except _Refusal as refusal:
        print("ab_runner: %s" % refusal, file=sys.stderr)
        return 2

    results_dir = Path(args.results_dir) if args.results_dir \
        else REPO_ROOT / "evals" / "results"
    workspace = Path(args.workspace) if args.workspace \
        else Path(tempfile.mkdtemp(prefix="ab-cell-"))

    cell = build_cell(args.fixture, REPO_ROOT, workspace,
                      fixtures_root=fixtures_root)
    run_dir = cell / ".claude" / "ultrapowers" / ("run-" + run_id)
    print("ab_runner: cell repo %s" % cell, file=sys.stderr)
    print("ab_runner: run dir   %s" % run_dir, file=sys.stderr)

    # The seeded env is a COPY that goes to this one subprocess. os.environ is
    # never touched, and the token is never printed, logged or harvested.
    try:
        env = seed_worker_auth(os.environ, run=run)
    except SystemExit as exit_request:   # ab_auth's own token-free message
        print("ab_runner: %s" % exit_request, file=sys.stderr)
        return 2

    command = ["node", str(REPO_ROOT / ENGINE), "plan.md", run_id,
               "--repo", str(cell), "--overlap", args.overlap]
    # No timeout: a real cell runs for tens of minutes and the operator is
    # watching it. The engine's own per-role deadlines bound the workers.
    result = run(command, cwd=str(REPO_ROOT), env=env)

    row = harvest_row(run_dir, {
        "fixture": args.fixture,
        "armOverlap": args.overlap,
        "runId": run_id,
        "engineRef": _engine_ref(run, REPO_ROOT),
        "exitCode": result.returncode,
        "cellDir": str(cell),
    })
    # The row is written whatever the engine did: a failed cell is evidence
    # (verdict + invalid say which), and a missing row is not.
    _append_row(results_dir, row)
    print(json.dumps(row))
    return 0 if result.returncode == 0 else 1


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main(sys.argv[1:]))
