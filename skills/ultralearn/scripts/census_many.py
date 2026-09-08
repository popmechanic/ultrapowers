#!/usr/bin/env python3
"""ultralearn many-run census — one table, one row per run directory.

The laptop's single-run `census.py` answers "what did this run cost?"; an
operator comparing a season of runs wants that answer thirty times over, side
by side, in run order. This is the tracked sibling that does it: point it at
run directories (or a tree holding them) and it emits one row per run under a
fixed 31-column schema, as CSV or as a Markdown pipe table.

A run directory is any directory holding at least one of `events.jsonl`,
`report.json`, `status.json`. A run whose log was never written still gets its
row — what its receipt (`report.json`) and status (`status.json`) say, and the
empty string everywhere the log would have spoken. Blank means "nothing to
read", never "zero": a run with no `events.jsonl` shows `""` for its role
minutes, while a run whose log carries no examiner shows `0.0`.

Read-only and advisory: an unreadable record costs its own columns, not the
table. The event log is read through `fleet_events.read_events` (id-sorted,
malformed lines skipped) — the parser lives there, never here.
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _outcome import swallow  # noqa: E402  (marks every deliberate skip)
from fleet_events import read_events  # noqa: E402

# The table's schema, in order. The exam pins both the names and the order, and
# the CSV header, the Markdown header and every row dict are all built from
# this one tuple so they cannot drift apart.
COLUMNS = (
    "run", "era", "engine", "terminus", "tasks", "width", "minutes_total",
    "cost_usd", "start", "setup_min", "wave_min", "fold_min", "critic_min",
    "gate_min", "publish_min", "min_examiner", "usd_examiner",
    "min_implementer", "usd_implementer", "min_reviewer", "usd_reviewer",
    "min_critic", "usd_critic", "min_resolver", "usd_resolver",
    "longest_chain_min", "fix_rounds", "launched_at", "pr", "merged",
    "status_min")

# Holding any one of these makes a directory a run; a directory with none of
# them is scaffolding (the fixture root itself is such a directory) and yields
# no row.
RUN_FILES = ("events.jsonl", "report.json", "status.json")

# The roles that get a `min_`/`usd_` column pair. `writeSide` workers are real
# but have no column, so their minutes land only in `minutes_total`.
ROLES = ("examiner", "implementer", "reviewer", "critic", "resolver")

# Worker label prefixes that name a task: the label's second colon-field is the
# task id, so `review:1:2:1` and `fix:1:1` both belong to task `1`.
TASK_PREFIXES = ("exam", "impl", "fix", "review")

_RUN_NUMBER = re.compile(r"^run-(\d+)")

_PUBLISH_KINDS = ("publish:pr", "publish:merge", "publish:hold")
_TERMINAL_KINDS = ("driver:approved", "driver:fail")


# --- formatting ------------------------------------------------------------
#
# Every cell is a string. A rule whose inputs are missing yields the empty
# string rather than a zero, so "not measured" never reads as "measured zero".

def _number(value):
    """The value as a float, or None when it is not a usable number.

    `True` is an `int` in Python and would otherwise sum as 1; reject it."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def _minutes(ms):
    return "%.1f" % (ms / 60000.0)


def _dollars(usd):
    return "%.2f" % usd


def _span_min(start_ts, end_ts):
    """`end - start` as minutes, or the empty string when either end is
    missing — a half-known interval is not a duration."""
    a, b = _number(start_ts), _number(end_ts)
    if a is None or b is None:
        return ""
    return _minutes(b - a)


def _iso(ts):
    """A millisecond epoch as the engine's ISO UTC spelling."""
    value = _number(ts)
    if value is None:
        return ""
    return datetime.fromtimestamp(value / 1000.0, timezone.utc).strftime(
        "%Y-%m-%dT%H:%M:%SZ")


def _parse_iso(text):
    """A status timestamp as a datetime, or None. Tolerates the fractional
    seconds a real `updatedAt` sometimes carries."""
    if not isinstance(text, str) or not text.strip():
        return None
    try:
        return datetime.fromisoformat(text.strip().replace("Z", "+00:00"))
    except ValueError as exc:
        swallow("status timestamp is not an ISO instant; its span stays empty",
                exc)
        return None


def _text(value):
    """A record field as a cell: `null` and absent both read as empty."""
    return "" if value is None else str(value)


# --- inputs ----------------------------------------------------------------

def _read_json(path):
    """One JSON record, or None. A missing file is a normal absence; an
    unreadable or malformed one costs its own columns, not the table."""
    if not os.path.isfile(path):
        return None
    try:
        with open(path, encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, ValueError) as exc:
        swallow("run record unreadable; its columns stay empty", exc)
        return None


def find_run_dirs(paths):
    """Every run directory at or under `paths`, each reported once.

    Each path is walked with `os.walk`, so a path may be a run directory or a
    tree holding them. Overlapping arguments do not duplicate a run."""
    found, seen = [], set()
    for path in paths:
        for dirpath, dirnames, filenames in os.walk(path):
            dirnames.sort()
            if not any(name in filenames for name in RUN_FILES):
                continue
            key = os.path.realpath(dirpath)
            if key in seen:
                continue
            seen.add(key)
            found.append(dirpath)
    return found


# --- the log ---------------------------------------------------------------

def _paired_workers(events):
    """`(start, end)` per finished worker, in `worker:end` order.

    A retry reuses its label, so an end pairs with the most recent unmatched
    start of the same label — never with the label's first start, which would
    mix attempt 2's end into attempt 1's span."""
    open_by_label, pairs = {}, []
    for event in events:
        kind = event.get("kind")
        if kind == "worker:start":
            open_by_label.setdefault(str(event.get("label")), []).append(event)
        elif kind == "worker:end":
            stack = open_by_label.get(str(event.get("label")))
            pairs.append((stack.pop() if stack else None, event))
    return pairs


def _duration_ms(start, end):
    if start is None or end is None:
        return None
    a, b = _number(start.get("ts")), _number(end.get("ts"))
    return None if a is None or b is None else b - a


def _cost_usd(end):
    meter = end.get("meter")
    if not isinstance(meter, dict):
        return 0.0
    return _number(meter.get("costUsd")) or 0.0


def _max_width(events):
    """The most workers alive at once.

    Sweep every start and end by `ts`, an end at time `t` before a start at
    time `t` — a worker handed off at the same millisecond is a handoff, not an
    overlap, while two workers *starting* at one millisecond are genuinely
    concurrent."""
    marks = []
    for event in events:
        kind = event.get("kind")
        if kind not in ("worker:start", "worker:end"):
            continue
        ts = _number(event.get("ts"))
        if ts is None:
            continue
        marks.append((ts, 1 if kind == "worker:start" else 0))
    marks.sort(key=lambda m: (m[0], m[1]))
    alive = width = 0
    for _, is_start in marks:
        alive += 1 if is_start else -1
        width = max(width, alive)
    return width


def _task_id(label):
    """The task a worker label names, or None when it names no task."""
    fields = str(label).split(":")
    if len(fields) < 2 or fields[0] not in TASK_PREFIXES:
        return None
    return fields[1]


def _phase_ts(events, predicate, last=False):
    """The `ts` of the first (or last) `engine:phase` whose phase matches."""
    found = None
    for event in events:
        if event.get("kind") != "engine:phase":
            continue
        if not predicate(str(event.get("phase") or "")):
            continue
        found = event.get("ts")
        if not last:
            break
    return found


def _stage_ts(events, stage, last=False):
    """The `ts` of the first (or last) `driver:stage` of that stage."""
    found = None
    for event in events:
        if event.get("kind") == "driver:stage" and event.get("stage") == stage:
            found = event.get("ts")
            if not last:
                break
    return found


def _last_ts(events, kinds):
    found = None
    for event in events:
        if event.get("kind") in kinds:
            found = event.get("ts")
    return found


def _is_wave_phase(phase):
    """`Wave 1`, `Wave 2`… — the phases the engine announces while the waves
    run. #712 left `Wave` as the only spelling an engine emits."""
    return phase.startswith("Wave")


def _event_columns(events):
    """Every column the log speaks for, as a dict of strings."""
    cells = {}

    opened = next((e for e in events if e.get("kind") == "run:open"), None)
    if opened is not None and opened.get("runId") not in (None, ""):
        cells["run"] = str(opened.get("runId"))
    cells["start"] = _iso(events[0].get("ts"))

    pairs = _paired_workers(events)

    total_ms = 0.0
    for start, end in pairs:
        span = _duration_ms(start, end)
        if span is not None:
            total_ms += span
    cells["minutes_total"] = _minutes(total_ms)

    total_usd = 0.0
    for event in events:
        if event.get("kind") == "worker:end":
            total_usd += _cost_usd(event)
    cells["cost_usd"] = _dollars(total_usd)

    # A role with no worker on a run that HAS a log is a measured zero, so the
    # accumulators start at zero rather than absent.
    role_ms = {role: 0.0 for role in ROLES}
    role_usd = {role: 0.0 for role in ROLES}
    chain_ms = {}
    for start, end in pairs:
        role = (start or {}).get("role") or end.get("role")
        span = _duration_ms(start, end) or 0.0
        if role in role_ms:
            role_ms[role] += span
            role_usd[role] += _cost_usd(end)
        task = _task_id(end.get("label"))
        if task is not None:
            chain_ms[task] = chain_ms.get(task, 0.0) + span
    for role in ROLES:
        cells["min_" + role] = _minutes(role_ms[role])
        cells["usd_" + role] = _dollars(role_usd[role])
    cells["longest_chain_min"] = _minutes(max(chain_ms.values(), default=0.0))

    tasks = {_task_id(e.get("label")) for e in events
             if e.get("kind") in ("worker:start", "worker:end")}
    tasks.discard(None)
    cells["tasks"] = str(len(tasks))
    cells["width"] = str(_max_width(events))
    cells["fix_rounds"] = str(sum(
        1 for e in events if e.get("kind") == "worker:start"
        and str(e.get("label")).startswith("fix:")))

    setup_at = _phase_ts(events, lambda p: p == "Setup")
    wave_at = _phase_ts(events, _is_wave_phase)
    review_at = _phase_ts(events, lambda p: p == "Integration Review")
    terminal_at = _last_ts(events, _TERMINAL_KINDS)
    cells["setup_min"] = _span_min(setup_at, wave_at)
    cells["wave_min"] = _span_min(wave_at, review_at)
    cells["critic_min"] = _span_min(review_at,
                                    _stage_ts(events, "engine-done", last=True))
    cells["gate_min"] = _span_min(_stage_ts(events, "gate", last=True),
                                  terminal_at)
    cells["fold_min"] = _span_min(
        terminal_at, _last_ts(events, ("driver:publish-fold",)))
    cells["publish_min"] = _span_min(terminal_at,
                                     _last_ts(events, _PUBLISH_KINDS))
    return cells


# --- the record columns ----------------------------------------------------

def _record_columns(report, status, has_events):
    """Every column the receipt and the status speak for.

    `engine` and the status columns are read the same way whether or not the
    run has a log; `tasks` is only the receipt's business when the log is
    absent, since a log counts the tasks that actually ran."""
    cells = {}
    if isinstance(report, dict):
        version = report.get("engineVersion")
        if isinstance(version, str):
            cells["engine"] = version
        if not has_events and isinstance(report.get("tasks"), list):
            cells["tasks"] = str(len(report["tasks"]))
    if isinstance(status, dict):
        cells["terminus"] = _text(status.get("state"))
        cells["launched_at"] = _text(status.get("startedAt"))
        cells["pr"] = _text(status.get("pr"))
        cells["merged"] = _text(status.get("merged"))
        started = _parse_iso(status.get("startedAt"))
        updated = _parse_iso(status.get("updatedAt"))
        if started is not None and updated is not None:
            cells["status_min"] = "%.1f" % (
                (updated - started).total_seconds() / 60.0)
    return cells


def census_row(run_dir, labels=None):
    """One run directory's row: every one of `COLUMNS`, every value a string."""
    row = {column: "" for column in COLUMNS}
    row["run"] = os.path.basename(os.path.normpath(run_dir))

    events = []
    if os.path.isfile(os.path.join(run_dir, "events.jsonl")):
        events = read_events(run_dir)
    if events:
        row.update(_event_columns(events))
    row.update(_record_columns(_read_json(os.path.join(run_dir, "report.json")),
                               _read_json(os.path.join(run_dir, "status.json")),
                               bool(events)))
    row["era"] = (labels or {}).get(row["run"], "")
    return row


def _run_order(row):
    """Ascending by the `run-<N>` integer, whatever order argv named them.
    A run whose name carries no number sorts after the numbered ones, by name,
    so the order is total and never depends on the walk."""
    match = _RUN_NUMBER.match(row["run"])
    if match:
        return (0, int(match.group(1)), row["run"])
    return (1, 0, row["run"])


def census_rows(paths, labels=None):
    """The whole table: one row dict per run directory found at or under
    `paths`, in run order."""
    rows = [census_row(run_dir, labels) for run_dir in find_run_dirs(paths)]
    rows.sort(key=_run_order)
    return rows


# --- rendering -------------------------------------------------------------

def markdown_table(rows, header=True):
    """The rows as a Markdown pipe table, trailing newline included, so the
    text written to `--md` and the text printed to stdout are the same bytes."""
    lines = []
    if header:
        lines.append("| " + " | ".join(COLUMNS) + " |")
        lines.append("| " + " | ".join(["---"] * len(COLUMNS)) + " |")
    for row in rows:
        lines.append("| " + " | ".join(
            str(row.get(column, "")) for column in COLUMNS) + " |")
    return "".join(line + "\n" for line in lines)


def _appending_to(path, append):
    """True when this write must continue an existing table rather than start
    one — the prior bytes stay, and no second header is written."""
    return bool(append) and os.path.isfile(path) and os.path.getsize(path) > 0


def write_csv(rows, path, append=False):
    continuing = _appending_to(path, append)
    with open(path, "a" if continuing else "w", encoding="utf-8",
              newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(COLUMNS),
                                lineterminator="\n")
        if not continuing:
            writer.writeheader()
        for row in rows:
            writer.writerow({column: row.get(column, "") for column in COLUMNS})


def write_md(rows, path, append=False):
    continuing = _appending_to(path, append)
    with open(path, "a" if continuing else "w", encoding="utf-8") as handle:
        handle.write(markdown_table(rows, header=not continuing))


# --- CLI -------------------------------------------------------------------

def _parse_labels(parser, items):
    labels = {}
    for item in items or []:
        run, separator, text = item.partition("=")
        if not separator or not run:
            parser.error("--label expects RUN=TEXT, got %r" % item)
        labels[run] = text
    return labels


def main(argv=None):
    parser = argparse.ArgumentParser(
        prog="census_many.py",
        description="One row per fleet run, across many run directories.")
    parser.add_argument("paths", nargs="+", metavar="PATH",
                        help="a run directory, or a tree containing them")
    parser.add_argument("--csv", dest="csv_path", metavar="PATH",
                        help="write the table as CSV")
    parser.add_argument("--md", dest="md_path", metavar="PATH",
                        help="write the table as a Markdown pipe table")
    parser.add_argument("--append", action="store_true",
                        help="append rows to an existing table, no new header")
    parser.add_argument("--label", action="append", metavar="RUN=TEXT",
                        default=[], help="fill one run's `era` column")
    args = parser.parse_args(argv)

    rows = census_rows(args.paths, _parse_labels(parser, args.label))
    if args.csv_path:
        write_csv(rows, args.csv_path, args.append)
    if args.md_path:
        write_md(rows, args.md_path, args.append)
    if not args.csv_path and not args.md_path:
        sys.stdout.write(markdown_table(rows))
    return 0


if __name__ == "__main__":
    sys.exit(main())
