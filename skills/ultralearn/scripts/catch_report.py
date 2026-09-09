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
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from merge_ledger import _read_jsonl  # noqa: E402  (one ledger reader, shared)

# The ledger holds the findings rows `merge_ledger.py` writes (no `kind`) in
# the same file. Only this kind is the catch record; everything else is another
# reader's business and contributes nothing here.
CATCH_KIND = "catch-count"

# This repository's two suites: `pytest.ini` collects `tests/`, and
# `tests/test_fleet_suite.py` bridges `fleet/tests/test_*.mjs`. A foreign tree
# passed with `--tree` gets its own two globs, no more.
TEST_GLOBS = ("tests/test_*.py", "fleet/tests/test_*.mjs")

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
    """The `catch-count` rows, in order. [M2]"""
    return [row for row in rows
            if isinstance(row, dict) and row.get("kind") == CATCH_KIND]


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


def _status(catches, exercised):
    if catches > 0:
        return "caught"
    if not exercised:
        return "unobserved"
    return "zero"


def catch_table(rows, tree_tests):
    """`{test path: {catches, exercised, touchingRuns, status}}`. [M1]

    Keyed over the union of `tree_tests` and every path the record names as a
    test — a key of some row's `catches` or `exercises`. A path that appears
    only as an *exercised* path (`lib/b.py`) is not a test and is not a key.

    `touchingRuns` is counted against the whole union `exercised`, not against
    the one row's own `exercises`: a run touches a test when it changed
    anything any run has said that test exercises.
    """
    rows = _catch_rows(rows)
    paths = set(tree_tests or [])
    for row in rows:
        paths.update(_mapping(row, "catches"))
        paths.update(_mapping(row, "exercises"))

    touched = [set(_paths(row.get("touched"))) for row in rows]
    table = {}
    for path in sorted(paths):
        catches = sum(_count(_mapping(row, "catches").get(path))
                      for row in rows)
        exercised = set()
        for row in rows:
            exercised.update(_paths(_mapping(row, "exercises").get(path)))
        touching = sum(1 for changed in touched
                       if changed & exercised) if exercised else 0
        table[path] = {"catches": catches,
                       "exercised": sorted(exercised),
                       "touchingRuns": touching,
                       "status": _status(catches, exercised)}
    return table


def _touching(entry):
    return entry.get("touchingRuns", 0)


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
                    if _is_zero(entry) and _touching(entry) >= n)
        curve.append({"n": n, "files": files})
    return curve


def zero_over(table, n):
    """The deletion candidates at N: zero catches over ≥ N touching runs."""
    return sorted(path for path, entry in table.items()
                  if _is_zero(entry) and _touching(entry) >= n)


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


def report_lines(table, n=None):
    """The whole report, in order: table, curve, and — only when the operator
    named an N — the deletion input. [M5]"""
    lines = table_lines(table) + curve_lines(table)
    if n is not None:
        lines.extend(zero_over_lines(table, n))
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

    table = catch_table(_read_jsonl(args.ledger), tree_test_files(args.tree))
    for line in report_lines(table, args.n):
        print(line)
    return 0


if __name__ == "__main__":
    sys.exit(main())
