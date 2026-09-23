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
from datetime import datetime
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

TICKS_HEADER = ["run", "task", "label", "role", "reading", "elapsed_ms",
               "stuck", "off_track", "needs_human", "done_not_exited",
               "wall_ms", "error", "examExit", "folded"]

OUTCOMES_HEADER = ["role", "reading", "workers", "late", "errored",
                   "median_wall_ms", "ticks", "fired", "fired_late",
                   "fired_errored", "fired_clean"]

DEFAULT_STUCK = 0.8


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


# --- one run's supervisor ticks (--ticks, --outcomes) -----------------------

def _parse_ts(ts):
    """The `ts` string as a UTC `datetime`, or None when it doesn't parse."""
    if not isinstance(ts, str):
        return None
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except ValueError:
        return None


def _elapsed_ms(start_ts, tick_ts):
    """Whole milliseconds from `start_ts` to `tick_ts`, or None when either
    doesn't parse."""
    start = _parse_ts(start_ts)
    tick = _parse_ts(tick_ts)
    if start is None or tick is None:
        return None
    return int(round((tick - start).total_seconds() * 1000))


def _numeric_cell(value):
    """A number read as a plain int/float, or None -- distinct from
    `numeric_of`, which also reads the noul answer shape."""
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return value
    return None


def _load_rows(events_path):
    rows = []
    try:
        handle = open(events_path, encoding="utf-8")
    except OSError:
        return rows
    with handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except ValueError:
                continue
            if isinstance(row, dict):
                rows.append(row)
    return rows


def read_ticks(events_path):
    """One `events.jsonl`'s supervisor ticks -- a `supervisor` row (reading
    `narrated`) or a `supervisor:observed` row that carries `answers`
    (reading `observed`); a `supervisor:observed` row without `answers` (the
    `skipped` shape) is not a tick. Each dict carries the join: the worker's
    `wall_ms`/`error` off the same run+label's last `dispatch:end` row, and
    the task's `examExit`/`folded` off the same run+task's landing row --
    `examExit` reads that row's own `factsExit` when the row carries one
    (a run recorded after the exam left), else its `examExit` (an older
    run's own record). Does not carry `run` -- the caller stamps that on,
    one run at a time."""
    rows = _load_rows(events_path)

    last_end = {}
    for row in rows:
        if row.get("kind") == "dispatch:end":
            last_end[row.get("label")] = row

    last_landing = {}
    for row in rows:
        if row.get("kind") == "landing":
            last_landing[row.get("task")] = row

    ticks = []
    last_start_ts = {}
    for row in rows:
        kind = row.get("kind")
        if kind == "dispatch:start":
            last_start_ts[row.get("label")] = row.get("ts")
            continue
        if kind == "supervisor":
            reading = "narrated"
        elif kind == "supervisor:observed" and isinstance(row.get("answers"), dict):
            reading = "observed"
        else:
            continue

        task = row.get("task")
        label = row.get("label")
        answers = row.get("answers") or {}
        scores = {key: numeric_of(answers.get(key)) for key in
                 ("stuck", "off_track", "needs_human", "done_not_exited")}

        if reading == "observed":
            observed = row.get("observed") or {}
            elapsed_ms = _numeric_cell(observed.get("elapsed_ms"))
        else:
            elapsed_ms = _elapsed_ms(last_start_ts.get(label), row.get("ts"))

        end_row = last_end.get(label)
        wall_ms = None
        error = None
        if end_row is not None:
            wall_ms = _numeric_cell(end_row.get("wall_ms"))
            error = end_row.get("error")

        landing = last_landing.get(task)
        folded = landing is not None
        exam_exit = None
        if landing is not None:
            if "factsExit" in landing:
                exam_exit = _numeric_cell(landing.get("factsExit"))
            else:
                exam_exit = _numeric_cell(landing.get("examExit"))

        ticks.append({
            "task": task,
            "label": label,
            "role": role_of(label),
            "reading": reading,
            "elapsed_ms": elapsed_ms,
            "stuck": scores["stuck"],
            "off_track": scores["off_track"],
            "needs_human": scores["needs_human"],
            "done_not_exited": scores["done_not_exited"],
            "wall_ms": wall_ms,
            "error": error,
            "examExit": exam_exit,
            "folded": folded,
        })
    return ticks


def read_ends(events_path):
    """One `events.jsonl`'s `dispatch:end` rows, each a worker: `role`
    (`role_of(label)`), `wall_ms` (a number or None) and `error`."""
    ends = []
    for row in _load_rows(events_path):
        if row.get("kind") != "dispatch:end":
            continue
        ends.append({
            "role": role_of(row.get("label")),
            "wall_ms": _numeric_cell(row.get("wall_ms")),
            "error": row.get("error"),
        })
    return ends


def _int_or_dash(value):
    return "-" if value is None else str(int(value))


def _score_cell(value):
    return "-" if value is None else "%.2f" % value


def _error_cell(error):
    if error is None:
        return "-"
    text = str(error).replace("\t", " ").replace("\n", " ")
    return text[:60]


def render_tick(tick):
    """One `--ticks` line for a tick dict carrying `run` (stamped on by the
    caller) plus every key `read_ticks` produces."""
    return "\t".join([
        str(tick["run"]),
        str(tick["task"]),
        str(tick["label"]),
        str(tick["role"]),
        tick["reading"],
        _int_or_dash(tick["elapsed_ms"]),
        _score_cell(tick["stuck"]),
        _score_cell(tick["off_track"]),
        _score_cell(tick["needs_human"]),
        _score_cell(tick["done_not_exited"]),
        _int_or_dash(tick["wall_ms"]),
        _error_cell(tick["error"]),
        _int_or_dash(tick["examExit"]),
        "1" if tick["folded"] else "0",
    ])


def outcome_rows(ticks, ends, stuck=DEFAULT_STUCK):
    """One `--outcomes` line per (role, reading) pair, for every role seen on
    a `dispatch:end` row (`ends`) and both readings, sorted role then
    reading."""
    workers = {}
    walls_by_role = {}
    errored_count = {}
    for end in ends:
        role = end["role"]
        workers[role] = workers.get(role, 0) + 1
        if end["wall_ms"] is not None:
            walls_by_role.setdefault(role, []).append(end["wall_ms"])
        if end.get("error") is not None:
            errored_count[role] = errored_count.get(role, 0) + 1

    median = {role: statistics.median(vals)
             for role, vals in walls_by_role.items()}

    late_count = {}
    for end in ends:
        role = end["role"]
        m = median.get(role)
        if m is not None and end["wall_ms"] is not None and end["wall_ms"] > 2 * m:
            late_count[role] = late_count.get(role, 0) + 1

    empty_entry = {"ticks": 0, "fired": 0, "fired_late": 0,
                   "fired_errored": 0, "fired_clean": 0}
    tick_stats = {}
    for tick in ticks:
        key = (tick["role"], tick["reading"])
        entry = tick_stats.setdefault(key, dict(empty_entry))
        entry["ticks"] += 1
        stuck_val = tick["stuck"]
        if stuck_val is None or stuck_val < stuck:
            continue
        entry["fired"] += 1
        m = median.get(tick["role"])
        is_late = (m is not None and tick["wall_ms"] is not None
                  and tick["wall_ms"] > 2 * m)
        is_errored = tick["error"] is not None
        if is_late:
            entry["fired_late"] += 1
        elif is_errored:
            entry["fired_errored"] += 1
        else:
            entry["fired_clean"] += 1

    rows = []
    for role in sorted(workers):
        for reading in ("narrated", "observed"):
            entry = tick_stats.get((role, reading), empty_entry)
            m = median.get(role)
            median_cell = "-" if m is None else str(int(round(m)))
            rows.append("\t".join([
                role, reading,
                str(workers.get(role, 0)),
                str(late_count.get(role, 0)),
                str(errored_count.get(role, 0)),
                median_cell,
                str(entry["ticks"]),
                str(entry["fired"]),
                str(entry["fired_late"]),
                str(entry["fired_errored"]),
                str(entry["fired_clean"]),
            ]))
    return rows


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
    parser.add_argument("--ticks", action="store_true",
                        help="print one line per supervisor tick, joined to "
                             "its worker's end and its task's landing")
    parser.add_argument("--outcomes", action="store_true",
                        help="print one line per role/reading, reading the "
                             "alarms against late and errored workers")
    parser.add_argument("--stuck", type=float, default=DEFAULT_STUCK,
                        metavar="N",
                        help="the stuck score that arms a tick for "
                             "--outcomes (default %.1f)" % DEFAULT_STUCK)
    args = parser.parse_args(argv)

    if args.ticks and args.outcomes:
        print("jev-census: --ticks and --outcomes are two tables; ask for one",
              file=sys.stderr)
        return 2

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
    all_ticks, all_ends = [], []
    read, skipped = [], []
    for number, directory in entries:
        if directory is None:
            skipped.append("%d(no events.jsonl)" % number)
            continue
        events_path = Path(directory) / RUN_FILE
        if not events_path.is_file():
            skipped.append("%d(no events.jsonl)" % number)
            continue
        if args.ticks or args.outcomes:
            read.append(number)
            run_ticks = read_ticks(events_path)
            for tick in run_ticks:
                tick["run"] = number
            all_ticks.extend(run_ticks)
            if args.outcomes:
                all_ends.extend(read_ends(events_path))
            continue
        saw_jev, stats = read_run(events_path)
        if not saw_jev:
            skipped.append("%d(no jev rows)" % number)
            continue
        read.append(number)
        merge_stats(merged, stats)

    if args.ticks:
        print("\t".join(TICKS_HEADER))
        for tick in all_ticks:
            print(render_tick(tick))
    elif args.outcomes:
        print("\t".join(OUTCOMES_HEADER))
        for row in outcome_rows(all_ticks, all_ends, stuck=args.stuck):
            print(row)
    else:
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
