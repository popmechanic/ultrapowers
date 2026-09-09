#!/usr/bin/env python3
"""ultralearn catch counter — one `catch-count` row per fleet run, derived from
the record the engine already wrote.

A *catch* is the claim of #778: a red that the fix round then turned green by
editing implementation files — never the test, and never by re-run alone. This
script is the mechanical reading of that sentence over a run directory:

    red driver run  →  a `fix:<task>:` worker ended  →  the same run, green

with two disqualifications read off the run's own record — the exam was edited
(`report.json`'s `examEdited`), or the test file was the task's own to write
(`receipt.json`'s `compile.tasks[].writes`) — and two ways a red simply never
became a catch (it stayed red, or nothing ran it again).

Read-only and advisory: no model call, no network, no git write. The one file
it writes is the ledger named by `--ledger`, and only by appending. A missing
or unreadable record is an empty record, never a traceback; a path under which
no run directory exists is reported as `LOOKED-EMPTY:` on stderr and is not an
error.

Ordering is the event log's `id` order and nothing else. `iter` does not
distinguish the pass before a fix round from the pass after it (run-44 ran the
exam red at `iter: 0`, fixed, and ran it green at `iter: 0` again), so the
sequence in the log is the only sequence there is.

Every path in a row is the string the record spelled: nothing here normalises,
resolves or globs a path.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _outcome import (FailedLookup, report_looked_empty,  # noqa: E402
                      swallow)
from fleet_events import read_events  # noqa: E402

ROW_KIND = "catch-count"

# The three kinds of driver run. A red and its green must be of the SAME kind
# and carry the same `cmd`: an exam that went green says nothing about a proof
# run that is still red.
DRIVER_RUN_KINDS = ("driver:exam-run", "driver:proof-run", "driver:check-run")

# A fix round for task K is the `worker:end` of a worker labelled `fix:K:<i>`
# — `fix:2:0` is the proof-driven round, `fix:2:1` the review-driven one, so
# the prefix is what identifies the task, not the whole label.
FIX_LABEL = "fix:%s:"

# M8: a test path is a token of the command matched by this expression, in
# order of appearance. The lookarounds keep it from biting into a longer word
# or a longer path, and `test[\w.-]*` is what makes `fleet/tests/test_x.mjs` a
# test path while `fleet/x.mjs` in the same command is not.
TEST_PATH_RE = re.compile(
    r"(?<![\w./-])((?:[\w.-]+/)*test[\w.-]*\.(?:py|mjs|js|ts))(?![\w.-])")

# The six ways a red ends, named once. `caught` is the only one that credits.
OUTCOMES = ("caught", "exam-edited", "task-writes", "rerun", "stayed-red",
            "no-green")
# ... and read back out of that tuple, so every outcome `_outcome_of` returns
# is a member of `OUTCOMES` by construction and there is no seventh spelling.
CAUGHT, EXAM_EDITED, TASK_WRITES, RERUN, STAYED_RED, NO_GREEN = OUTCOMES

# A directory holding this is a run directory; nothing else makes one.
RUN_FILE = "events.jsonl"


# --- the record ------------------------------------------------------------

def _read_json(path):
    """One JSON record from the run directory, or None.

    Missing, unreadable and malformed are all the same advisory answer: an
    empty record. The counter still emits its row."""
    if not os.path.isfile(path):
        return None                     # a normal absence, not a failure
    try:
        with open(path, encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, ValueError) as exc:
        swallow("run record unreadable; the run counts as having no record",
                exc)
        return None


def _str_list(value):
    """A record's path list as strings, exactly as the record spelled them."""
    return [str(item) for item in value] if isinstance(value, list) else []


def _exam_edited(report):
    """`task -> examEdited`, over `report.json`'s `tasks[]`.

    An absent `examEdited` is `[]`: the field is present only when an exam was
    recorded, and "no exam recorded" is not "the exam moved"."""
    rows = report.get("tasks") if isinstance(report, dict) else None
    out = {}
    for row in rows if isinstance(rows, list) else []:
        if isinstance(row, dict) and row.get("task") is not None:
            out[str(row["task"])] = _str_list(row.get("examEdited"))
    return out


def _writes(receipt):
    """`task id -> writes`, over `receipt.json`'s `compile.tasks[]` — the
    task's Create + Modify paths, which may well include a test file."""
    compiled = receipt.get("compile") if isinstance(receipt, dict) else None
    entries = compiled.get("tasks") if isinstance(compiled, dict) else None
    out = {}
    for entry in entries if isinstance(entries, list) else []:
        if isinstance(entry, dict) and entry.get("id") is not None:
            out[str(entry["id"])] = _str_list(entry.get("writes"))
    return out


# --- the log ---------------------------------------------------------------

def test_paths_of(cmd):
    """Every test path the command names, in order of appearance (M8).

    A command that names none — `git diff --quiet $ULTRA_BASE -- fleet/x.mjs`
    — yields the empty list, and a red running such a command is not a red
    about any test file."""
    return [m.group(1) for m in TEST_PATH_RE.finditer(str(cmd or ""))]


def _is_driver_run(event):
    return event.get("kind") in DRIVER_RUN_KINDS


def _is_red(event):
    """`exit` ≠ 0. An event with no `exit` at all reports no verdict, so it is
    no red — and no green either: only a literal `exit` 0 closes a pair."""
    return event.get("exit") not in (0, None)


def _same_run(a, b):
    """Two driver-run events that are the same run of the same command for the
    same task — the pair M1 reads a red and its green out of."""
    return (a.get("kind") == b.get("kind")
            and str(a.get("task")) == str(b.get("task"))
            and a.get("cmd") == b.get("cmd"))


def _next_same_run(events, start, red):
    """The index of the next same-kind, same-`cmd` event for the red's task,
    or None. Only the NEXT one decides the outcome (M5): a second green after
    a still-red re-run does not retroactively make the red a catch."""
    for pos in range(start + 1, len(events)):
        if _is_driver_run(events[pos]) and _same_run(red, events[pos]):
            return pos
    return None


def _after_a_red(events, pos, run):
    """True when the previous same-kind, same-`cmd` event for this task was
    itself red — this run is the still-red re-run that red was already judged
    `stayed-red` by.

    The chain `red → red → nothing` is one red that stayed red: the first
    red's `stayed-red` already says the run never went green, so the tail adds
    no second entry. A tail that something DOES run again is judged on its own
    — it may yet be a catch."""
    for prev in range(pos - 1, -1, -1):
        if _is_driver_run(events[prev]) and _same_run(run, events[prev]):
            return _is_red(events[prev])
    return False


def _fix_round_between(events, start, stop, task):
    """The label of the LAST fix round for `task` that ended between the red
    and the green, or None when no fix round lies between them.

    The label is what identifies the round, so two reds turned green by one
    `fix:1:0` credit their path once (M6)."""
    label = None
    for pos in range(start + 1, stop):
        event = events[pos]
        if event.get("kind") != "worker:end":
            continue
        if str(event.get("label") or "").startswith(FIX_LABEL % task):
            label = str(event.get("label"))
    return label


def _outcome_of(events, pos, red, task, path, exam_edited, writes,
                have_record=True):
    """`(outcome, fix label)` for one red and one of the test paths it names,
    always a member of `OUTCOMES`.

    The fix label is None unless the outcome is `caught`; it is the credit's
    other half — one credit per path per fix round.

    The record gates the outcome, not the red: `have_record` is False when
    neither `report.json` nor `receipt.json` was readable, and a run with
    nothing to read the credit's two disqualifications out of falls through to
    `rerun` — never `exam-edited`, `task-writes` or `caught`."""
    green = _next_same_run(events, pos, red)
    if green is None:
        return NO_GREEN, None
    if events[green].get("exit") != 0:
        return STAYED_RED, None         # only a literal 0 closes the pair
    label = _fix_round_between(events, pos, green, task)
    if label is None:
        return RERUN, None              # green again with nothing edited
    if not have_record:
        return RERUN, None              # nothing readable to credit against
    if path in exam_edited.get(task, []):
        return EXAM_EDITED, None        # the exam moved under the claim
    if path in writes.get(task, []):
        return TASK_WRITES, None        # the test was the task's own to write
    return CAUGHT, label


def derive_catches(run_dir):
    """The run's `catch-count` row: exactly `kind`, `runId`, `driverRuns`,
    `catches`, `reds`, `touched`, `exercises` (M7).

    `catches[T]` counts the distinct fix rounds that turned a red naming `T`
    green without editing `T`; `reds` carries every judged red, credited or
    not, with the outcome that judged it.

    Every red that names a test path is judged, record or no record — save
    the tail of a red→red chain, whose verdict the first red's `stayed-red`
    has already given and which `_after_a_red` therefore drops. The gate is
    the outcome, not the red. A run with no record at all — neither
    `report.json` nor `receipt.json` readable — has nothing to credit a catch
    against, so its reds read `stayed-red`, `rerun` or `no-green` and never
    `caught`, `exam-edited` or `task-writes`.

    `exercises` holds a key only where some task's writes stand behind it: an
    empty union is dropped rather than recorded, so a test path no record
    speaks for carries no entry here. Naming such a file `unobserved` is the
    report's job — `catch_report.py`'s tree walk over the working tree is the
    one source of those rows, and this counter never invents one."""
    run_dir = Path(run_dir)
    events = read_events(run_dir)
    report = _read_json(run_dir / "report.json")
    receipt = _read_json(run_dir / "receipt.json")
    # `_read_json` answers None for missing, unreadable and malformed alike,
    # so "neither readable" is exactly "both None".
    have_record = report is not None or receipt is not None
    exam_edited = _exam_edited(report)
    writes = _writes(receipt)

    opened = next((e for e in events if e.get("kind") == "run:open"), None)

    driver_runs = 0
    exercised = {}                      # test path -> set of writes paths
    reds = []
    credits = {}                        # test path -> set of crediting rounds
    for pos, event in enumerate(events):
        if not _is_driver_run(event):
            continue
        driver_runs += 1
        task = str(event.get("task"))
        paths = test_paths_of(event.get("cmd"))
        for path in dict.fromkeys(paths):
            # M7: a task exercises every test path its runs name, red or green.
            exercised.setdefault(path, set()).update(writes.get(task, []))
        if not _is_red(event):
            continue
        for path in dict.fromkeys(paths):
            outcome, label = _outcome_of(events, pos, event, task, path,
                                         exam_edited, writes, have_record)
            if outcome == NO_GREEN and _after_a_red(events, pos, event):
                continue                # the tail of a chain already judged
            reds.append({"task": task, "kind": event.get("kind"),
                         "path": path, "cmd": event.get("cmd"),
                         "outcome": outcome})
            if outcome == CAUGHT:
                credits.setdefault(path, set()).add(label)

    touched = sorted({path for paths in writes.values() for path in paths})
    return {
        "kind": ROW_KIND,
        "runId": opened.get("runId") if isinstance(opened, dict) else None,
        "driverRuns": driver_runs,
        "catches": {path: len(rounds) for path, rounds in credits.items()},
        "reds": reds,
        "touched": touched,
        # A path no task's writes stand behind carries no entry: an empty union
        # is nothing exercised, and a run with no receipt exercises nothing.
        "exercises": {path: sorted(paths)
                      for path, paths in exercised.items() if paths},
    }


# --- the ledger ------------------------------------------------------------

def row_id(row):
    """The row's ledger identity (M9): the first 16 hex digits of the SHA-256
    of `runId + "\\n" + "catch-count"`. One row per run, so re-counting a run
    is a skip, not a second line."""
    key = "%s\n%s" % (row.get("runId"), ROW_KIND)
    return hashlib.sha256(key.encode("utf-8")).hexdigest()[:16]


def _ledger_ids(ledger_path):
    """Every `id` the ledger already carries — findings rows included, since
    the counter appends beside them and must not collide with them.

    A ledger that does not exist yet carries nothing; a ledger that exists and
    cannot be read fails loud, because appending blind over it would duplicate
    rows it may already hold."""
    ledger_path = Path(ledger_path)
    if not ledger_path.exists():
        return set()
    try:
        text = ledger_path.read_text(encoding="utf-8")
    except OSError as exc:
        raise FailedLookup("ledger exists but cannot be read: %s" % exc) from exc
    ids = set()
    for line in text.splitlines():
        if not line.strip():
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError as exc:
            swallow("malformed ledger line skipped; the rest of the ledger "
                    "still reads", exc)
            continue
        if isinstance(record, dict) and record.get("id") is not None:
            ids.add(record["id"])
    return ids


def append_rows(rows, ledger_path):
    """Append every row the ledger does not already carry; return
    `{"added": n, "skipped": m}`.

    Append-only: an existing line is never rewritten, and a second call with
    the same rows adds nothing and leaves the file's bytes unchanged. The
    ledger's parent directories are created when absent."""
    rows = list(rows or [])
    ledger_path = Path(ledger_path)
    seen = _ledger_ids(ledger_path)
    added = []
    for row in rows:
        identity = row_id(row)
        row["id"] = identity
        if identity in seen:
            continue
        seen.add(identity)
        added.append(row)
    if added:
        ledger_path.parent.mkdir(parents=True, exist_ok=True)
        with ledger_path.open("a", encoding="utf-8") as handle:
            for row in added:
                handle.write(json.dumps(row, sort_keys=True) + "\n")
    return {"added": len(added), "skipped": len(rows) - len(added)}


# --- CLI -------------------------------------------------------------------

def find_run_dirs(paths):
    """Every directory holding an `events.jsonl` at or under `paths`, each
    reported once, in a deterministic order.

    A path is a run directory or a tree holding several. A path under which
    none exists is a completed lookup that found nothing — said so on stderr,
    not an error."""
    found, seen = [], set()
    for path in paths:
        hits = 0
        for dirpath, dirnames, filenames in os.walk(path):
            dirnames.sort()
            if RUN_FILE not in filenames:
                continue
            hits += 1
            key = os.path.realpath(dirpath)
            if key in seen:
                continue
            seen.add(key)
            found.append(dirpath)
        if not hits:
            report_looked_empty("no run directory (%s) under %s"
                                % (RUN_FILE, path))
    return found


def main(argv=None):
    parser = argparse.ArgumentParser(
        prog="catch_counter.py",
        description="Count each run's catches from its own record.")
    parser.add_argument("paths", nargs="+", metavar="PATH",
                        help="a run directory, or a tree containing them")
    parser.add_argument("--ledger", dest="ledger", metavar="FILE",
                        help="append the rows to this JSONL ledger")
    args = parser.parse_args(argv)

    rows = [derive_catches(run_dir) for run_dir in find_run_dirs(args.paths)]
    counts = (append_rows(rows, args.ledger) if args.ledger
              else {"added": 0, "skipped": 0})
    print("%d run(s) counted, %d row(s) appended, %d already recorded"
          % (len(rows), counts["added"], counts["skipped"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
