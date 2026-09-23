#!/usr/bin/env python3
"""The catch counter — one `catch-count` row per fleet run, derived from
the record the engine already wrote.

A *catch* is the claim of #778: a red that the fix round then turned green by
editing implementation files — never the test, and never by re-run alone. This
script is the mechanical reading of that sentence over a run directory:

    red driver run  →  a `fix:<task>:` worker ended  →  the same run, green

with two disqualifications read off the run's own record — the exam was edited
(`report.json`'s `examEdited`), or the test file was the task's own to write
(`receipt.json`'s `compile.tasks[].writes`) — and two ways a red simply never
became a catch (it stayed red, or nothing ran it again).

Since #1259 the factory's record (`factory/engine.mjs`, every run from 202)
is read by the same sentence: its runs are `run:line`, `check:line`, the
entries of `select:landing.ran[]` and `fold:verify.ran[]`, and `refold:red`;
its fix round is a `dispatch:end` labelled `fix:<task>`; a `catch` row is the
engine's own verdict that a selected test caught a candidate, and credits on
its own; and what a task wrote is its Files block in the run's `plan.md`,
which `--fetch` lands beside the log, since the factory writes no
`receipt.json`. The row's shape is unchanged.

Read-only and advisory: no model call, no git write. The one file it writes is
the ledger named by `--ledger`, and only by appending — beside, under `--fetch`,
the run directories it pulls off the evidence tags into the `--into` directory
the operator names. A missing or unreadable record is an empty record, never a
traceback; a path under which no run directory exists is reported as
`LOOKED-EMPTY:` on stderr and is not an error.

Ordering is the event log's `id` order and nothing else. `iter` does not
distinguish the pass before a fix round from the pass after it (run-44 ran the
exam red at `iter: 0`, fixed, and ran it green at `iter: 0` again), so the
sequence in the log is the only sequence there is.

Every path in a row is the string the record spelled: nothing here normalises,
resolves or globs a path.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import re
import shlex
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _outcome import (FailedLookup, report_looked_empty,  # noqa: E402
                      swallow)
from fleet_events import read_events  # noqa: E402
from plan_parse import parse_plan_full  # noqa: E402

ROW_KIND = "catch-count"

# The three kinds of driver run. A red and its green must be of the SAME kind
# and carry the same `cmd`: an exam that went green says nothing about a proof
# run that is still red.
DRIVER_RUN_KINDS = ("driver:exam-run", "driver:proof-run", "driver:check-run")

# The factory's runs (`factory/engine.mjs`, every run since 202), which writes
# none of the three above: a task's probe is a `run:line` row, a run-wide check
# a `check:line` row, a selected existing test one entry of a `select:landing`
# row's `ran[]`, a fold re-run one entry of a `fold:verify` row's `ran[]` (its
# `exit` a string), and a refold's red a `refold:red` row. `_facts` flattens
# the two `ran[]` shapes into one entry each so the loop below reads every kind
# alike; a selected test's entry carries `path` where the rest carry `cmd`.
FACTORY_RUN_KINDS = ("run:line", "check:line", "select:landing", "fold:verify",
                     "refold:red")
RUN_KINDS = DRIVER_RUN_KINDS + FACTORY_RUN_KINDS

# The factory's own verdicts on a selected test, read beside its red: a `catch`
# row is the engine saying the test was red in the candidate and green at the
# anchor; a `select:red-at-base` row says it was red in both.
CATCH_KIND = "catch"
RED_AT_BASE_KIND = "select:red-at-base"

# A fix round for task K is the `worker:end` of a worker labelled `fix:K:<i>`
# — `fix:2:0` is the proof-driven round, `fix:2:1` the review-driven one, so
# the prefix is what identifies the task, not the whole label — or, on the
# factory, the `dispatch:end` of the worker labelled exactly `fix:K` (no round
# suffix). `fix:1` must not match `fix:10`, so the test is equality or the
# colon-terminated prefix, never a bare `startswith`.
FIX_LABEL = "fix:%s:"
FIX_END_KINDS = ("worker:end", "dispatch:end")


def _is_fix_round(event, task):
    if event.get("kind") not in FIX_END_KINDS:
        return False
    label = str(event.get("label") or "")
    return label == "fix:%s" % task or label.startswith(FIX_LABEL % task)

# M8: a test path is a token of the command matched by this expression, in
# order of appearance. The lookarounds keep it from biting into a longer word
# or a longer path, and `test[\w.-]*` is what makes `fleet/tests/test_x.mjs` a
# test path while `fleet/x.mjs` in the same command is not.
TEST_PATH_RE = re.compile(
    r"(?<![\w./-])((?:[\w.-]+/)*test[\w.-]*\.(?:py|mjs|js|ts))(?![\w.-])")

# The six ways a red ends, named once. `caught` is the only one that credits.
OUTCOMES = ("caught", "exam-edited", "task-writes", "rerun", "stayed-red",
            "no-green")
# ... and the tuple is where the six names come from, so no outcome can be
# spelled here that the vocabulary does not carry.
CAUGHT, EXAM_EDITED, TASK_WRITES, RERUN, STAYED_RED, NO_GREEN = OUTCOMES

# A directory holding this is a run directory; nothing else makes one.
RUN_FILE = "events.jsonl"

# What a run directory is, on the evidence tag and on disk alike: the log the
# counter reads its reds out of, and the three records that judge them
# (`report.json`'s `examEdited`, `receipt.json`'s `compile.tasks[].writes`,
# `status.json`'s `startedAt`). `--fetch` pulls these four names and no other
# — a fifth file on the tag is another reader's business.
RUN_NAMES = (RUN_FILE, "report.json", "receipt.json", "status.json")

# The factory writes no `receipt.json`: what a task wrote is its Files block in
# the plan, which the evidence ref carries at the repository root — a fifth
# read at another path, landed in the run directory under this name.
PLAN_FILE = "plan.md"
PLAN_PATH = ".ultrapowers/plan.md"

# The tag a run's directory lives on. The plan tag carries the plan; the
# evidence tag carries `.ultrapowers/runs/<N>/`.
EVIDENCE_REF = "ultra/evidence/run-%d"


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


def _plan_writes(run_dir):
    """`task id -> files`, over the run directory's `plan.md` as
    `plan_parse.py` reads it, or None when there is no readable plan.

    None, not `{}`: a plan that is absent is no record, where a plan whose
    tasks list no files is a record that says nothing was written."""
    path = Path(run_dir) / PLAN_FILE
    if not os.path.isfile(path):
        return None
    try:
        text = path.read_text(encoding="utf-8")
        parsed = parse_plan_full(text)
    except Exception as exc:  # noqa: BLE001 — advisory: an unreadable plan is no plan
        swallow("plan unreadable; the run counts as having no plan", exc)
        return None
    record = parsed[0] if isinstance(parsed, tuple) else parsed
    tasks = record.get("tasks") if isinstance(record, dict) else None
    out = {}
    for task in tasks if isinstance(tasks, list) else []:
        if isinstance(task, dict) and task.get("id") is not None:
            out[str(task["id"])] = _str_list(task.get("files"))
    return out


# --- the log ---------------------------------------------------------------

def test_paths_of(cmd):
    """Every test path the command names, in order of appearance (M8).

    A command that names none — `git diff --quiet $ULTRA_BASE -- fleet/x.mjs`
    — yields the empty list, and a red running such a command is not a red
    about any test file."""
    return [m.group(1) for m in TEST_PATH_RE.finditer(str(cmd or ""))]


def _exit_int(value):
    """An `exit` as an integer, or None when it is absent or not a number —
    a `fold:verify` entry spells its exit as a string."""
    if value is None or isinstance(value, bool):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _facts(events):
    """The log with the factory's two `ran[]` shapes flattened: one entry per
    selected test of a `select:landing` row and per re-run of a `fold:verify`
    row, each carrying the row's `kind` and `task`, in the row's own place;
    every other row passes through as it is, so the order is still the log's.
    A flattened entry's `exit` is an integer or None."""
    out = []
    for event in events:
        kind = event.get("kind")
        if kind == "select:landing":
            for entry in event.get("ran") if isinstance(event.get("ran"), list) else []:
                if isinstance(entry, dict):
                    out.append({"kind": kind, "task": event.get("task"),
                                "path": entry.get("path"),
                                "exit": _exit_int(entry.get("exit"))})
        elif kind == "fold:verify":
            for entry in event.get("ran") if isinstance(event.get("ran"), list) else []:
                if isinstance(entry, dict):
                    out.append({"kind": kind, "task": event.get("task"),
                                "cmd": entry.get("cmd"),
                                "exit": _exit_int(entry.get("exit"))})
        else:
            out.append(event)
    return out


def _is_driver_run(event):
    return event.get("kind") in RUN_KINDS


def _is_selected_test(event):
    return event.get("kind") == "select:landing"


def _paths_of(event):
    """The test paths one run entry names: a selected test's entry names its
    one `path`; every other entry names what its `cmd` names."""
    if _is_selected_test(event):
        path = event.get("path")
        return [str(path)] if path else []
    return test_paths_of(event.get("cmd"))


def _is_red(event):
    """`exit` ≠ 0, and present. An event with no `exit` at all reports no
    verdict, so it is not a red — and it does not close a red's pair either,
    since only a literal `exit == 0` does that."""
    return event.get("exit") not in (0, None)


def _same_run(a, b):
    """Two driver-run events that are the same run of the same command for the
    same task — the pair M1 reads a red and its green out of."""
    return (a.get("kind") == b.get("kind")
            and str(a.get("task")) == str(b.get("task"))
            and a.get("cmd") == b.get("cmd")
            and a.get("path") == b.get("path"))


def _next_same_run(events, start, red):
    """The index of the next same-kind, same-`cmd` event for the red's task,
    or None. Only the NEXT one decides the outcome (M5): a second green after
    a still-red re-run does not retroactively make the red a catch."""
    for pos in range(start + 1, len(events)):
        if _is_driver_run(events[pos]) and _same_run(red, events[pos]):
            return pos
    return None


def _fix_round_between(events, start, stop, task):
    """The label of the LAST fix round for `task` that ended between the red
    and the green, or None when no fix round lies between them.

    The label is what identifies the round, so two reds turned green by one
    `fix:1:0` credit their path once (M6)."""
    label = None
    for pos in range(start + 1, stop):
        if _is_fix_round(events[pos], task):
            label = str(events[pos].get("label"))
    return label


def _verdict_after(events, pos, kind, task, path):
    """Whether a row of `kind` for `task` naming `path` follows position
    `pos` — the engine's own verdict on a selected test, which it writes
    right after the test's red."""
    for event in events[pos + 1:]:
        if (event.get("kind") == kind and str(event.get("task")) == task
                and event.get("path") == path):
            return True
    return False


def _selected_outcome(events, pos, task, path, writes):
    """One of `OUTCOMES` for a selected test that was red in the candidate.
    The engine judged it already, so nothing here pairs it with a later
    green: a `catch` row is `caught` (unless the test was the task's own to
    write), a `select:red-at-base` row is `stayed-red`, and a red the engine
    wrote no verdict for is `no-green`."""
    if _verdict_after(events, pos, CATCH_KIND, task, path) \
            and path not in writes.get(task, []):
        return CAUGHT
    if path in writes.get(task, []):
        return TASK_WRITES
    if _verdict_after(events, pos, RED_AT_BASE_KIND, task, path):
        return STAYED_RED
    return NO_GREEN


def _outcome_of(events, pos, red, task, path, exam_edited, writes,
                have_record):
    """One of `OUTCOMES` and a fix label, for one red and one of the test paths
    it names.

    Every red is judged, record or no record: the record is what a *credit*
    needs, not what a verdict needs. With neither `report.json` nor
    `receipt.json` readable (`have_record` false) there is no row to credit or
    disqualify the path by, so a green that follows falls through to `rerun` —
    never `exam-edited`, `task-writes` or `caught`.

    The fix label is None unless the outcome is `caught`; it is the credit's
    other half — one credit per path per fix round."""
    green = _next_same_run(events, pos, red)
    if green is None:
        return NO_GREEN, None
    if events[green].get("exit") != 0:
        return STAYED_RED, None         # only a literal 0 closes the pair
    label = _fix_round_between(events, pos, green, task)
    if label is None:
        return RERUN, None              # green again with nothing edited
    if not have_record:
        return RERUN, None              # no record to credit the claim by
    if path in exam_edited.get(task, []):
        return EXAM_EDITED, None        # the exam moved under the claim
    if path in writes.get(task, []):
        return TASK_WRITES, None        # the test was the task's own to write
    return CAUGHT, label


def derive_catches(run_dir):
    """The run's `catch-count` row: exactly `kind`, `runId`, `startedAt`,
    `driverRuns`, `catches`, `reds`, `touched`, `exercises` (M7; `startedAt`
    since the first ratchet).

    `catches[T]` counts the distinct fix rounds that turned a red naming `T`
    green without editing `T`; `reds` carries every judged red, credited or
    not, with the outcome that judged it — every red the log holds is judged,
    whatever record the run kept.

    `exercises` holds a key only where some task's writes stand behind it: the
    empty union is dropped, so a path no receipt entry backs — and every path
    of a run with no receipt at all — carries no entry here. This row is a
    reading of the log, and never invents a row for a file the log is silent
    about: `catch_report.py`'s tree walk over the repository is the only source
    of `unobserved` rows."""
    run_dir = Path(run_dir)
    events = _facts(read_events(run_dir))
    report = _read_json(run_dir / "report.json")
    receipt = _read_json(run_dir / "receipt.json")
    plan_writes = _plan_writes(run_dir)
    # When the run started, as its own status page says — the clock the
    # report's per-test window is measured against (first ratchet, task 2).
    # A run with no page, or a page with no `startedAt`, carries null, and the
    # report counts such a row toward no test's window.
    status = _read_json(run_dir / "status.json")
    started_at = status.get("startedAt") if isinstance(status, dict) else None
    if not isinstance(started_at, str):
        started_at = None
    # "Neither readable" means neither file is a JSON object: `_read_json`
    # returns None for a missing, unreadable or malformed file, and a bare
    # string or list is no record either (#860).
    have_record = (isinstance(report, dict) or isinstance(receipt, dict)
                   or plan_writes is not None)
    exam_edited = _exam_edited(report)
    # The receipt is the wave engine's record of what each task wrote and the
    # plan's Files the factory's; a run that carries both answers with the
    # receipt, the record the engine itself compiled.
    writes = _writes(receipt) if isinstance(receipt, dict) else (plan_writes or {})

    opened = next((e for e in events if e.get("kind") == "run:open"), None)
    # The wave engine opened its log with a `runId`; the factory writes no
    # `run:open`, and its `status.json` carries the number as `run`, so the
    # id is spelled `run-<N>` there — the shape the ledger already holds.
    run_id = opened.get("runId") if isinstance(opened, dict) else None
    if run_id is None and isinstance(status, dict) \
            and isinstance(status.get("run"), (str, int)) \
            and not isinstance(status.get("run"), bool):
        run_id = "run-%s" % status["run"]

    driver_runs = 0
    exercised = {}                      # test path -> set of writes paths
    reds = []
    credits = {}                        # test path -> set of crediting rounds
    for pos, event in enumerate(events):
        task = str(event.get("task"))
        if event.get("kind") in (CATCH_KIND, RED_AT_BASE_KIND):
            # The engine's verdict rows name the test too (M4), and a `catch`
            # is a credit in its own right (M3): one per row, keyed on the
            # row's place in the log, unless the test was the task's to write.
            path = event.get("path")
            if path:
                exercised.setdefault(str(path), set()).update(writes.get(task, []))
                if event.get("kind") == CATCH_KIND \
                        and str(path) not in writes.get(task, []):
                    credits.setdefault(str(path), set()).add("catch:%d" % pos)
            continue
        if not _is_driver_run(event):
            continue
        driver_runs += 1
        paths = _paths_of(event)
        for path in dict.fromkeys(paths):
            # M7: a task exercises every test path its runs name, red or green.
            exercised.setdefault(path, set()).update(writes.get(task, []))
        if not _is_red(event):
            continue
        for path in dict.fromkeys(paths):
            if _is_selected_test(event):
                outcome, label = _selected_outcome(events, pos, task, path,
                                                   writes), None
            else:
                outcome, label = _outcome_of(events, pos, event, task, path,
                                             exam_edited, writes, have_record)
            reds.append({"task": task, "kind": event.get("kind"),
                         "path": path, "cmd": event.get("cmd"),
                         "outcome": outcome})
            if outcome == CAUGHT and label is not None:
                credits.setdefault(path, set()).add(label)

    touched = sorted({path for paths in writes.values() for path in paths})
    return {
        "kind": ROW_KIND,
        "runId": run_id,
        "startedAt": started_at,
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


# --- --fetch: the record off the evidence tags -----------------------------
#
# The runs a release wants counted are on the target, not on this disk: each
# one's directory is `.ultrapowers/runs/<N>/` on `ultra/evidence/run-<N>`, and
# `gh api …/contents/…` is the one read that needs no clone and no checkout.
# What lands under `--into` is a tree of ordinary run directories, which the
# counter then walks exactly as it walks a `PATH` the operator typed.
#
# This mirrors `skills/ultrawrite/scripts/authoring_census.py`'s `_fetch_file`
# and `fetch_runs` rather than importing them: that file belongs to another
# skill, and a skill's script is not a library for its neighbours.

def _contents(target, path, ref):
    """The `gh api` path for one file at one ref."""
    return "repos/%s/contents/%s?ref=%s" % (target, path, ref)


def _fetch_file(gh, target, path, ref):
    """The bytes of one file at one ref, or None when the read does not answer.

    `gh api …/contents/…` answers JSON whose `content` is base64 with embedded
    newlines, so the decode is over the whole string. The call names exactly
    two arguments — `api` and the contents path — so a caller's `--gh` wrapper
    sees the same shape the real binary does. A non-zero exit, an answer that
    is not JSON, an answer with no string `content` and a `content` that is not
    base64 are one answer here: the file did not answer."""
    try:
        proc = subprocess.run(gh + ["api", _contents(target, path, ref)],
                              capture_output=True, text=True)
    except OSError as exc:
        swallow("the gh binary did not run; that file did not answer", exc)
        return None
    if proc.returncode != 0:
        return None
    try:
        answer = json.loads(proc.stdout)
    except ValueError as exc:
        swallow("gh answered no JSON; that file did not answer", exc)
        return None
    content = answer.get("content") if isinstance(answer, dict) else None
    if not isinstance(content, str):
        return None
    try:
        return base64.b64decode(content)
    except (ValueError, TypeError) as exc:
        swallow("gh's content is not base64; that file did not answer", exc)
        return None


def fetch_runs(target, first, last, into, gh="gh"):
    """Fill `into` with `run-<N>/` for each N from `first` to `last` inclusive,
    each holding as many of `RUN_NAMES` as answered; return the runs written.

    `events.jsonl` is what makes a run directory, so a run whose log does not
    answer is SKIPPED WHOLE: one line on stderr naming it, no `run-<N>`
    directory left behind, and nothing for `find_run_dirs` to find. A run whose
    log answers keeps it whatever the other three do — a missing `report.json`,
    `receipt.json` or `status.json` is simply absent, and `derive_catches`
    already reads an absent record as an empty one."""
    into = Path(into)
    # The destination exists whether or not any run answers: a range where
    # every tag is missing is an empty fetch, not a usage error.
    into.mkdir(parents=True, exist_ok=True)
    command = shlex.split(gh) if isinstance(gh, str) else list(gh)
    written = []
    for number in range(int(first), int(last) + 1):
        ref = EVIDENCE_REF % number
        root = ".ultrapowers/runs/%d/" % number
        log = _fetch_file(command, target, root + RUN_FILE, ref)
        if log is None:
            print("catch-counter: run %d has no %s at %s — skipped"
                  % (number, RUN_FILE, ref), file=sys.stderr)
            continue
        directory = into / ("run-%d" % number)
        directory.mkdir(parents=True, exist_ok=True)
        (directory / RUN_FILE).write_bytes(log)
        for name in RUN_NAMES[1:]:
            body = _fetch_file(command, target, root + name, ref)
            if body is not None:
                (directory / name).write_bytes(body)
        # The plan sits at the repository root on the same ref, and lands in
        # the run directory as `plan.md`; one that does not answer is simply
        # absent, like the three above.
        plan = _fetch_file(command, target, PLAN_PATH, ref)
        if plan is not None:
            (directory / PLAN_FILE).write_bytes(plan)
        written.append(number)
    return written


RUNS_RE = re.compile(r"^(\d+)\.\.(\d+)$")


def _fetch_range(runs, into):
    """`(first, last)` for a `--fetch`, or a one-line refusal on stderr and
    None — the census's three refusals, under this script's own name."""
    if not runs or not into:
        print("catch-counter: --fetch needs --runs <A>..<B> and --into <dir>",
              file=sys.stderr)
        return None
    match = RUNS_RE.match(runs)
    if not match:
        print("catch-counter: --runs takes `<A>..<B>`, not `%s`" % runs,
              file=sys.stderr)
        return None
    first, last = int(match.group(1)), int(match.group(2))
    if first > last:
        print("catch-counter: --runs `%s` counts backwards" % runs,
              file=sys.stderr)
        return None
    return first, last


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
    # `nargs="*"`: under `--fetch` the runs come off the tags, so there is no
    # positional to give — and with neither, the refusal below is this
    # script's own one-line usage rather than argparse's.
    parser.add_argument("paths", nargs="*", metavar="PATH",
                        help="a run directory, or a tree containing them")
    parser.add_argument("--ledger", dest="ledger", metavar="FILE",
                        help="append the rows to this JSONL ledger")
    parser.add_argument("--fetch", metavar="OWNER/REPO",
                        help="pull the runs' record off this repository's "
                             "evidence tags into --into, then count it")
    parser.add_argument("--runs", metavar="A..B",
                        help="the inclusive run range to fetch")
    parser.add_argument("--into", metavar="DIR",
                        help="where --fetch writes the runs it reads")
    parser.add_argument("--gh", default="gh", metavar="BIN",
                        help="the gh binary (or command) to run; default `gh`")
    args = parser.parse_args(argv)

    paths = list(args.paths)
    if args.fetch:
        bounds = _fetch_range(args.runs, args.into)
        if bounds is None:
            return 2
        fetch_runs(args.fetch, bounds[0], bounds[1], Path(args.into), args.gh)
        # Counted exactly as a typed PATH is: the fetch's only product is a
        # tree of run directories, and the walk below is the same walk.
        paths.append(args.into)
    elif not paths:
        print("catch-counter: give a PATH, or --fetch <owner>/<repo> with "
              "--runs <A>..<B> and --into <dir>", file=sys.stderr)
        return 2

    rows = [derive_catches(run_dir) for run_dir in find_run_dirs(paths)]
    counts = (append_rows(rows, args.ledger) if args.ledger
              else {"added": 0, "skipped": 0})
    print("%d run(s) counted, %d row(s) appended, %d already recorded"
          % (len(rows), counts["added"], counts["skipped"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
