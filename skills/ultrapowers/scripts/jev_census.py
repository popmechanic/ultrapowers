#!/usr/bin/env python3
"""The Jev census — one command over a range of runs that names the
questions Jev answers near 0.5 or barely moves within a role, with the runs
it skipped printed beside its `n`.

The operator's hypothesis this reads for (2026-09-18): a question that
consistently answers near 0.5 is being shown too little state to discriminate
— it is a coin flip. The reading that prompted it (n=88 supervisor rows over
runs 193-196): every examiner read `stuck` at 0.45-0.48 and every referee at
0.16-0.21 -- near-constant within a role, different between roles, so the
score measures the role rather than the state. That second shape is `constant`
below: a role whose answers barely move is not discriminating either, even
when its mean sits far from 0.5.

Each run's `run-<N>/events.jsonl` carries, among other kinds, one `jev` row
per Jev call:

    {"ts": ..., "kind": "jev", "site": "landing", "task": "1",
     "label": "impl:1:0", "keys": ["claim_established", "M1__f0"],
     "values": {"claim_established": {"type": "noul", "noul": 0.9},
                "M1__f0": 0.2},
     "state_bytes": 5120, "ms": 840, "answered": true}

An unanswered call carries `"answered": false` and `"values": null`; its
`keys` still name the question(s) it would have answered, and each counts
toward that question's `unanswered`. A value may also be `{"score": n}` or
`{"choice": ..., "confidence": ...}` -- neither is a band reading, so neither
counts toward `n` or any ratio.

A "question" is `<site>/<key>` with the pairwise families folded: a `__`
splits a key into segments, and each segment has its trailing digits
stripped before rejoining -- `M3__f1` -> `M__f`, `M2__t0` -> `M__t`, and a
bare `g4` (no `__`) -> `g`. A key like `claim_established` carries no
trailing digits on its one segment, so it folds to itself.

A "role" is the row's `label` up to its first `:`, or `-` when `label` is
`null` -- every value a row answers is attributed to that one role.

Read-only and advisory: no model call, no gate. `--fetch` is the only network
use, and it is entirely `catch_counter.fetch_runs`'s own `gh api` reads --
this script never re-implements that fetch.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from catch_counter import fetch_runs  # noqa: E402

RUN_FILE = "events.jsonl"
RUN_DIR_RE = re.compile(r"^run-(\d+)$")
RUNS_RE = re.compile(r"^(\d+)\.\.(\d+)$")

BAND_LOW, BAND_HIGH = 0.35, 0.65
CONSTANT_SD = 0.05
BAND_N_MIN = 5
CONSTANT_N_MIN = 5

HEADER = ["question", "n", "unanswered", "in_band", "share", "mean",
         "role_sd", "flag"]


# --- folding and value reading ----------------------------------------------

def fold_key(key):
    """`<site>/<key>`'s key half, pairwise families folded: split on `__`,
    strip each segment's trailing digits, rejoin."""
    segments = str(key).split("__")
    return "__".join(seg.rstrip("0123456789") for seg in segments)


def role_of(label):
    """The row's role: `label` up to its first `:`, or `-` for `null`."""
    if label is None:
        return "-"
    return str(label).split(":", 1)[0]


def numeric_of(value):
    """The number a value reads as -- a bare number, or an answer's `noul`
    -- or None for a `score`/`choice` shape, which is not a band reading."""
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, dict) and value.get("type") == "noul":
        noul = value.get("noul")
        if isinstance(noul, bool):
            return None
        if isinstance(noul, (int, float)):
            return float(noul)
    return None


# --- one run's events.jsonl --------------------------------------------------

def _new_entry():
    return {"values": [], "role_values": {}, "unanswered": 0}


def read_run(events_path):
    """`(saw_jev, stats)` for one `events.jsonl` -- `stats` maps question to
    its entry; `saw_jev` is False when the file carries no `jev` row at
    all (the run is then skipped whole, per M3)."""
    stats = {}
    saw_jev = False
    try:
        handle = open(events_path, encoding="utf-8")
    except OSError:
        return False, stats
    with handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except ValueError:
                continue
            if not isinstance(row, dict) or row.get("kind") != "jev":
                continue
            saw_jev = True
            site = row.get("site")
            role = role_of(row.get("label"))
            if not row.get("answered"):
                for key in row.get("keys") or []:
                    question = "%s/%s" % (site, fold_key(key))
                    stats.setdefault(question, _new_entry())["unanswered"] += 1
                continue
            values = row.get("values")
            if not isinstance(values, dict):
                continue
            for key, value in values.items():
                question = "%s/%s" % (site, fold_key(key))
                entry = stats.setdefault(question, _new_entry())
                number = numeric_of(value)
                if number is None:
                    continue
                entry["values"].append(number)
                entry["role_values"].setdefault(role, []).append(number)
    return saw_jev, stats


def merge_stats(into, stats):
    for question, entry in stats.items():
        target = into.setdefault(question, _new_entry())
        target["values"].extend(entry["values"])
        target["unanswered"] += entry["unanswered"]
        for role, values in entry["role_values"].items():
            target["role_values"].setdefault(role, []).extend(values)


# --- finding run directories -------------------------------------------------

def find_run_dirs(paths):
    """`{run number: directory}` for every `run-<N>` directory holding an
    `events.jsonl`, at or under any of `paths`."""
    found = {}
    for base in paths:
        for dirpath, dirnames, filenames in os.walk(base):
            dirnames.sort()
            match = RUN_DIR_RE.match(os.path.basename(dirpath.rstrip(os.sep)))
            if match and RUN_FILE in filenames:
                found.setdefault(int(match.group(1)), dirpath)
    return found


# --- the table ---------------------------------------------------------------

def _ratio(value):
    return "-" if value is None else "%.2f" % value


def render_row(question, entry):
    values = entry["values"]
    n = len(values)
    unanswered = entry["unanswered"]
    in_band = sum(1 for v in values if BAND_LOW <= v <= BAND_HIGH)
    share = (in_band / n) if n else None
    mean = (sum(values) / n) if n else None

    qualifying = {role: vals for role, vals in entry["role_values"].items()
                 if len(vals) >= 2}
    role_sd = (max(statistics.pstdev(vals) for vals in qualifying.values())
              if qualifying else None)

    flags = []
    if n >= BAND_N_MIN and share is not None and share >= 0.5:
        flags.append("band")
    if any(len(vals) >= CONSTANT_N_MIN and statistics.pstdev(vals) <= CONSTANT_SD
          for vals in entry["role_values"].values()):
        flags.append("constant")
    flag = ",".join(flags) if flags else "-"

    return "\t".join([
        question, str(n), str(unanswered), str(in_band),
        _ratio(share), _ratio(mean), _ratio(role_sd), flag,
    ])


# --- --fetch -----------------------------------------------------------------

def _fetch_bounds(runs, into):
    """`(first, last)`, or a one-line refusal on stderr and None."""
    if not runs or not into:
        print("jev-census: --fetch needs --runs <A>..<B> and --into <dir>",
              file=sys.stderr)
        return None
    match = RUNS_RE.match(runs)
    if not match:
        print("jev-census: --runs takes `<A>..<B>`, not `%s`" % runs,
              file=sys.stderr)
        return None
    first, last = int(match.group(1)), int(match.group(2))
    if first > last:
        print("jev-census: --runs `%s` counts backwards" % runs,
              file=sys.stderr)
        return None
    return first, last


# --- CLI ----------------------------------------------------------------------

def main(argv=None):
    parser = argparse.ArgumentParser(
        prog="jev_census.py",
        description="Name the questions Jev answers near 0.5 or barely "
                    "moves within a role, over a range of runs.")
    parser.add_argument("paths", nargs="*", metavar="DIR",
                        help="a directory holding run-<N>/events.jsonl, "
                             "or a tree containing them")
    parser.add_argument("--fetch", metavar="OWNER/REPO",
                        help="pull the runs off this repository's evidence "
                             "tags into --into, then census them")
    parser.add_argument("--runs", metavar="A..B",
                        help="the inclusive run range to fetch")
    parser.add_argument("--into", metavar="DIR",
                        help="where --fetch writes the runs it reads")
    parser.add_argument("--gh", default="gh", metavar="BIN",
                        help="the gh binary (or command) to run; default `gh`")
    args = parser.parse_args(argv)

    # entries: an ordered list of (run number, directory-or-None). None marks
    # a run that never produced an events.jsonl at all (M4) -- distinct from
    # one that produced it but carried no jev row (M3).
    if args.fetch:
        bounds = _fetch_bounds(args.runs, args.into)
        if bounds is None:
            return 2
        first, last = bounds
        written = set(fetch_runs(args.fetch, first, last, args.into, args.gh))
        into = Path(args.into)
        entries = [(number,
                   into / ("run-%d" % number) if number in written else None)
                  for number in range(first, last + 1)]
    else:
        if not args.paths:
            print("jev-census: give a PATH, or --fetch <owner>/<repo> with "
                  "--runs <A>..<B> and --into <dir>", file=sys.stderr)
            return 2
        entries = sorted(find_run_dirs(args.paths).items())

    merged = {}
    read, skipped = [], []
    for number, directory in entries:
        if directory is None:
            skipped.append("%d(no events.jsonl)" % number)
            continue
        events_path = Path(directory) / RUN_FILE
        if not events_path.is_file():
            skipped.append("%d(no events.jsonl)" % number)
            continue
        saw_jev, stats = read_run(events_path)
        if not saw_jev:
            skipped.append("%d(no jev rows)" % number)
            continue
        read.append(number)
        merge_stats(merged, stats)

    print("\t".join(HEADER))
    for question in sorted(merged):
        print(render_row(question, merged[question]))
    print("runs: n=%d read=%s skipped=%s" % (
        len(read),
        ",".join(str(n) for n in read),
        ",".join(skipped) if skipped else "none",
    ))
    return 0


if __name__ == "__main__":
    sys.exit(main())
