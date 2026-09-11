#!/usr/bin/env python3
"""ultralearn catch report — which tests have never caught anything, over how
many runs that actually touched what they exercise.

The ledger's `catch-count` rows are the record: one row per harvested run,
naming the tests that went red (`catches`), the paths the run changed
(`touched`) and, per test, the paths that test exercises (`exercises`). This
reads them and answers three questions in one pass:

    the table   one line per test — catches, touching runs, status
    the curve   how many tests are still at zero catches over N touching runs
    the input   at an operator-chosen N, the deletion candidates themselves

A test's exercised set is the union across rows on purpose: what run A taught
about test T decides whether run B counts as having touched T. A test the
record has never named is `unobserved`, not `zero` — it is never a deletion
candidate, because nothing was measured about it. `--n` is the operator's
choice after reading the curve; this tool never picks it.

Read-only: the ledger is read, nothing is written, nothing is resolved or
globbed away. Paths are repository-relative exactly as the record spells them.
"""
from __future__ import annotations

import argparse
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from merge_ledger import _read_jsonl  # noqa: E402  (one ledger reader, shared)
from _outcome import swallow  # noqa: E402

# The ledger holds the findings rows `merge_ledger.py` writes (no `kind`) in
# the same file. Only this kind is the catch record; everything else is another
# reader's business and contributes nothing here.
CATCH_KIND = "catch-count"

# This repository's two suites: `pytest.ini` collects `tests/`, and
# `tests/test_fleet_suite.py` bridges `fleet/tests/test_*.mjs`. A foreign tree
# passed with `--tree` gets its own two globs, no more.
TEST_GLOBS = ("tests/test_*.py", "fleet/tests/test_*.mjs")

# A test file carrying this line is a RUNNER — it runs other tests (the fleet
# bridge) and never earns a catch of its own. Its status is `runner`: never a
# deletion candidate, never a point on the curve.
RUNNER_MARKER = "# catch-counter: runner"
# Where a test with no adding commit "landed": the epoch, so every stamped row
# is after it and an untracked test's window is the whole record.
EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)
# The report's closing line when rows carry no `startedAt`: they counted
# toward no window, and the operator recounts them (last row per run wins).
NO_STAMP_NOTE = "%d row(s) carry no startedAt — recount them"

HEADER = "| test | catches | touching runs | status |"
# GFM renders a pipe table only when the header is followed by a delimiter row,
# one cell per column — the same row `merge_ledger.py` writes under its own
# header. Without it the whole report reads as one paragraph of pipes.
DELIMITER = "| --- | --- | --- | --- |"
CURVE_HEADING = "## Zero-catch curve"


# --- the record ------------------------------------------------------------
#
# A row is data, not a promise: every field is read through a guard that
# answers the empty shape rather than raising, so one malformed row costs its
# own contribution and not the report.

def _catch_rows(rows):
    """The `catch-count` rows, in order, one per `runId` — the LAST row a run
    has in the ledger is the one read and an earlier row for the same run
    contributes nothing, so a recount supersedes what it recounts. Rows with
    no `runId` are each their own. [M2] [M3]"""
    kept = {}
    order = []
    anonymous = []
    for row in rows:
        if not (isinstance(row, dict) and row.get("kind") == CATCH_KIND):
            continue
        run_id = row.get("runId")
        if run_id is None:
            anonymous.append(row)
            continue
        if run_id not in kept:
            order.append(run_id)
        kept[run_id] = row
    return [kept[run_id] for run_id in order] + anonymous


def _when(value):
    """An ISO-8601 instant as an aware datetime, or None for anything else —
    `2026-09-10T16:28:26Z` and `+00:00` forms alike."""
    if not isinstance(value, str) or not value:
        return None
    text = value[:-1] + "+00:00" if value.endswith("Z") else value
    try:
        when = datetime.fromisoformat(text)
    except ValueError as exc:
        swallow("timestamp not ISO-8601; the row carries no time", exc)
        return None
    return when if when.tzinfo else when.replace(tzinfo=timezone.utc)


def unstamped_rows(rows):
    """How many of the rows read carry no usable `startedAt`. [M2]"""
    return sum(1 for row in _catch_rows(rows)
               if _when(row.get("startedAt")) is None)


def _mapping(row, key):
    value = row.get(key)
    return value if isinstance(value, dict) else {}


def _paths(value):
    """A record field as a list of paths — never resolved, never normalised."""
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, str)]


def _count(value):
    """A catch count as an integer. `True` is an `int` in Python and would
    otherwise sum as 1; anything that is not a plain integer counts nothing."""
    if isinstance(value, bool) or not isinstance(value, int):
        return 0
    return value


def _status(catches, exercised, runner=False):
    if runner:
        return "runner"
    if catches > 0:
        return "caught"
    if not exercised:
        return "unobserved"
    return "zero"


def catch_table(rows, tree_tests, landings=None, runners=()):
    """`{test path: {catches, exercised, touchingRuns, status}}`. [M1]

    Keyed over the union of `tree_tests` and every path the record names as a
    test — a key of some row's `catches` or `exercises`. A path that appears
    only as an *exercised* path (`lib/b.py`) is not a test and is not a key.

    `touchingRuns` is counted against the whole union `exercised`, not against
    the one row's own `exercises`: a run touches a test when it changed
    anything any run has said that test exercises — and only a run that
    STARTED AFTER THE TEST LANDED counts: `landings` maps a test path to the
    instant its adding commit landed (`tree_landings`; absent means the epoch),
    and a row with no `startedAt` counts toward no test's window at all. A path
    in `runners` has status `runner` whatever its counts. [M2] [M4]
    """
    rows = _catch_rows(rows)
    landings = landings or {}
    runners = set(runners or ())
    paths = set(tree_tests or [])
    for row in rows:
        paths.update(_mapping(row, "catches"))
        paths.update(_mapping(row, "exercises"))

    touched = [(set(_paths(row.get("touched"))), _when(row.get("startedAt")))
               for row in rows]
    table = {}
    for path in sorted(paths):
        catches = sum(_count(_mapping(row, "catches").get(path))
                      for row in rows)
        exercised = set()
        for row in rows:
            exercised.update(_paths(_mapping(row, "exercises").get(path)))
        landed = landings.get(path, EPOCH)
        touching = sum(1 for changed, started in touched
                       if started is not None and started > landed
                       and changed & exercised) if exercised else 0
        table[path] = {"catches": catches,
                       "exercised": sorted(exercised),
                       "touchingRuns": touching,
                       "status": _status(catches, exercised, path in runners)}
    return table


def _touching(entry):
    return entry.get("touchingRuns", 0)


def _is_runner(entry):
    return entry.get("status") == "runner"


def _is_zero(entry):
    return entry.get("catches", 0) == 0


def max_touching_runs(table):
    """The largest `touchingRuns` in the table — the curve's right edge."""
    return max((_touching(entry) for entry in table.values()), default=0)


def zero_curve(table):
    """`[{"n": N, "files": c}, …]` for N from 1 to the largest `touchingRuns`,
    `c` the entries at zero catches over at least N touching runs. [M3]

    Empty when the largest is 0: a `zero` at N=0 is a real zero — the record
    has simply never run against it — but it is in no N≥1 count.
    """
    curve = []
    for n in range(1, max_touching_runs(table) + 1):
        files = sum(1 for entry in table.values()
                    if _is_zero(entry) and not _is_runner(entry)
                    and _touching(entry) >= n)
        curve.append({"n": n, "files": files})
    return curve


def zero_over(table, n):
    """The deletion candidates at N: zero catches over ≥ N touching runs."""
    return sorted(path for path, entry in table.items()
                  if _is_zero(entry) and not _is_runner(entry)
                  and _touching(entry) >= n)


# --- the tree --------------------------------------------------------------

def tree_test_files(tree):
    """The tree's test files, relative to it, sorted. [M4]

    Two anchored globs and nothing else: a helper beside a test, an underscore
    file and a test outside the two suite directories are all absent.
    """
    tree = Path(tree)
    found = set()
    for pattern in TEST_GLOBS:
        for path in tree.glob(pattern):
            if path.is_file():
                found.add(path.relative_to(tree).as_posix())
    return sorted(found)


def tree_runners(tree, tests):
    """The tests whose text carries the RUNNER_MARKER line. [M4]"""
    tree = Path(tree)
    out = []
    for rel in tests:
        try:
            lines = (tree / rel).read_text(encoding="utf-8",
                                           errors="replace").splitlines()
        except OSError as exc:
            swallow("test file unreadable; it cannot be a runner", exc)
            continue
        if any(line.strip() == RUNNER_MARKER for line in lines):
            out.append(rel)
    return out


def tree_landings(tree, tests):
    """When each test LANDED: the committer date of the commit that first
    added the file, read from the tree's own history. A file with no such
    commit — untracked, or a tree that is no checkout — lands at the epoch
    and is not in the map. [M2]"""
    tree = Path(tree)
    out = {}
    for rel in tests:
        try:
            proc = subprocess.run(
                ["git", "-C", str(tree), "log", "--diff-filter=A",
                 "--format=%cI", "-1", "--", rel],
                capture_output=True, text=True)
        except OSError as exc:
            swallow("git unavailable; no landing dates for this tree", exc)
            return out
        if proc.returncode != 0:
            continue
        first = proc.stdout.strip().splitlines()
        when = _when(first[0]) if first else None
        if when is not None:
            out[rel] = when
    return out


# --- rendering -------------------------------------------------------------
#
# Plain `print`, one line per fact, nothing coloured, nothing paginated and
# nothing elided — a real report is one line per test and that is the point.

def table_lines(table):
    lines = [HEADER, DELIMITER]
    for path in sorted(table):
        entry = table[path]
        lines.append(f"| {path} | {entry.get('catches', 0)} "
                     f"| {_touching(entry)} | {entry.get('status', '')} |")
    return lines


def curve_lines(table):
    lines = [CURVE_HEADING]
    for point in zero_curve(table):
        lines.append(f"N={point['n']}: {point['files']} file(s)")
    lines.append(f"max touching runs: {max_touching_runs(table)}")
    return lines


def zero_over_lines(table, n):
    return [f"## Zero catches over {n} runs"] + zero_over(table, n)


def report_lines(table, n=None, unstamped=0):
    """The whole report, in order: table, curve, — only when the operator named
    an N — the deletion input, and — only when rows carried no `startedAt` —
    one closing line saying how many, so the report's LAST line is that note
    whichever sections precede it. [M5] [M2]"""
    lines = table_lines(table) + curve_lines(table)
    if n is not None:
        lines.extend(zero_over_lines(table, n))
    if unstamped > 0:
        lines.append(NO_STAMP_NOTE % unstamped)
    return lines


# --- CLI -------------------------------------------------------------------

def main(argv=None):
    parser = argparse.ArgumentParser(
        prog="catch_report.py",
        description="Which tests have never caught anything, over how many "
                    "runs that touched what they exercise.")
    parser.add_argument("--ledger", required=True, metavar="PATH",
                        help="the ultralearn ledger to read (a missing file "
                             "reads as no rows)")
    parser.add_argument("--tree", default=".", metavar="DIR",
                        help="the tree whose tests to list (default: .)")
    parser.add_argument("--n", type=int, metavar="N",
                        help="also list the tests at zero catches over N "
                             "touching runs")
    args = parser.parse_args(argv)

    rows = _read_jsonl(args.ledger)
    tests = tree_test_files(args.tree)
    table = catch_table(rows, tests, landings=tree_landings(args.tree, tests),
                        runners=tree_runners(args.tree, tests))
    for line in report_lines(table, args.n, unstamped_rows(rows)):
        print(line)
    return 0


if __name__ == "__main__":
    sys.exit(main())
