#!/usr/bin/env python3
"""ultralearn residual report — which residuals repeat, and where.

The ledger's `residual` rows are the record: one row per residual per run, as
`residual_counter.py` merged them. This reads them and answers one question —
which remarks are candidates for a consolidated follow-up, being the ones the
record has seen more than once:

    on two or more runs    the same remark came back after a run ended
    on two or more files   the same remark is about the code, not the file

A remark seen once, on one file, is a remark; it is not a candidate, and this
report does not name it. What it names is one line per candidate theme, for an
operator's sitting to file — never the sandbox's, and never one issue per row.

Grouping is by normalized text alone, not by `key`: `key` carries the file, and
"the same words on two files" is exactly the case two `key`s hold. `key` stays
the row's identity for a reader that wants `(file, text)`.

Read-only: the ledger is read, nothing is written, nothing is resolved or
globbed away. A ledger that does not exist reads as no rows. Paths are
repository-relative exactly as the record spells them, and the text is printed
as first seen — the normalization decides the grouping, never the display.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from merge_ledger import _read_jsonl  # noqa: E402  (one ledger reader, shared)
from residual_counter import ROW_KIND, normalize_text  # noqa: E402

HEADING = "## Residual candidates"
EMPTY = "(none)"

# A candidate is a group at or above this count of distinct runs, or of
# distinct non-null files. Either alone qualifies; neither is a candidate.
THRESHOLD = 2

# A group with no file at all still prints a `files:` column — this is what
# stands in it, so the line's three fields are always three.
NO_FILES = "-"


# --- the record ------------------------------------------------------------
#
# A row is data, not a promise: every field is read through a guard that
# answers the empty shape rather than raising, so one malformed row costs its
# own contribution and not the report.

def _residual_rows(rows):
    """The `residual` rows, in ledger order. Every other row kind — the
    findings rows with no `kind`, the `catch-count` rows — contributes
    nothing. [M4]"""
    return [row for row in rows
            if isinstance(row, dict) and row.get("kind") == ROW_KIND]


def _text(row):
    value = row.get("text")
    return "" if value is None else str(value)


def _string(value):
    """A record field as a string, or None — a null `file` is an absence, and
    a non-string is not a path this report will invent one from."""
    return value if isinstance(value, str) else None


def group_residuals(rows):
    """`{normalized text: {"text", "runs", "files"}}`, over the ledger's
    `residual` rows. [M4]

    `text` is the group's text as first seen — the first row in ledger order
    that carried it, spacing and case as written. `runs` and `files` are the
    distinct values the group's rows carry, `files` without its nulls."""
    groups = {}
    for row in _residual_rows(rows):
        text = _text(row)
        group = groups.setdefault(normalize_text(text),
                                  {"text": text, "runs": set(), "files": set()})
        run = _string(row.get("runId"))
        if run is not None:
            group["runs"].add(run)
        file = _string(row.get("file"))
        if file is not None:
            group["files"].add(file)
    return groups


def is_candidate(group):
    """Seen in ≥2 runs, or on ≥2 files. [M4]"""
    return (len(group["runs"]) >= THRESHOLD
            or len(group["files"]) >= THRESHOLD)


def candidates(groups):
    """The qualifying groups as `(normalized text, group)` pairs, most-repeated
    first: distinct-run count descending, then normalized text ascending — so
    the order is the record's, never the order the rows happened to arrive
    in. [M4]"""
    qualifying = [(key, group) for key, group in groups.items()
                  if is_candidate(group)]
    return sorted(qualifying, key=lambda pair: (-len(pair[1]["runs"]), pair[0]))


# --- rendering -------------------------------------------------------------

def _joined(values, empty):
    return ", ".join(sorted(values)) if values else empty


def candidate_line(group):
    return "- %s | runs: %s | files: %s" % (
        group["text"], _joined(group["runs"], ""),
        _joined(group["files"], NO_FILES))


def report_lines(rows):
    """The whole report: the heading, then one line per candidate — or the one
    line `(none)` when no group qualifies. [M4]"""
    lines = [HEADING]
    listed = [candidate_line(group) for _, group in candidates(group_residuals(rows))]
    return lines + (listed if listed else [EMPTY])


# --- CLI -------------------------------------------------------------------

def main(argv=None):
    parser = argparse.ArgumentParser(
        prog="residual_report.py",
        description="Which residuals repeat across runs or across files.")
    parser.add_argument("--ledger", required=True, metavar="PATH",
                        help="the ultralearn ledger to read (a missing file "
                             "reads as no rows)")
    args = parser.parse_args(argv)

    for line in report_lines(_read_jsonl(args.ledger)):
        print(line)
    return 0


if __name__ == "__main__":
    sys.exit(main())
