#!/usr/bin/env python3
"""ultrapowers fold census — one row per evidence run: how many conflicts its
folds narrated, by shape, how many parked, how many resolvers were dispatched,
how many of those were retries, and how many conflicts were settled.

The input is a run's evidence directory and nothing else is read: every wave is
a `frontier/wave-<n>/` the run copied there (named `<n>`) or a
`publish-fold/frontier/wave-<a>/` the publish fold copied (named `publish-<a>`),
each holding the `conflicts.json`, `fold_log.jsonl` and `conflict-<i>.txt`
`skills/ultrapowers/kernel/fold_wave.py` writes and the `reply-<i>-<attempt>/`
directories `fleet/run-engine.mjs` writes beside them.

Read-only and advisory in the way a census has to be: a record it cannot read
is one stderr line and a count of zero, never a traceback, because a run whose
evidence was cut off mid-wave is exactly the run worth counting.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _outcome import swallow  # noqa: E402  (marks every deliberate skip)

# The marker grammar of an annotated narration, read off
# `skills/ultrapowers/kernel/hunks.py:18-19`. A segment marker is its kind then
# its side — `<<<<<<< begin added frontier`, `======= begin deleted 2` — so the
# word after the marker is the whole of what a shape is read from.
_BEGIN, _SEP, _END = "<<<<<<< begin ", "======= begin ", ">>>>>>> end conflict"
_SEGMENT_KINDS = ("added", "deleted")

UNCLASSIFIED = "unclassified"

# #728's four buckets, in the order the table prints them.
SHAPES = ("insert-only", "deletion-only", "overlapping", "binary")

# The ten counts a row carries, and the keys of the `--json` `totals` object.
COUNT_COLUMNS = ("waves", "conflicts") + SHAPES + (
    "parked", "dispatches", "retries", "resolved")
COLUMNS = ("run",) + COUNT_COLUMNS

_WAVE_RE = re.compile(r"^wave-(\d+)$")
_REPLY_RE = re.compile(r"^reply-(\d+)-(\d+)$")


def _warn(message):
    print("fold_census: " + message, file=sys.stderr)


# ------------------------------------------------------------------ the shape

def _segment_kinds(narration):
    """The set of segment kinds named by a narration's marker lines."""
    kinds = set()
    for line in (narration or "").splitlines():
        line = line.rstrip()
        if line.startswith(_BEGIN):
            head = line[len(_BEGIN):]
        elif line.startswith(_SEP):
            head = line[len(_SEP):]
        else:
            continue
        kinds.add(head.partition(" ")[0])
    return kinds


def shape_of(kind: str, narration: str) -> str:
    """One of `binary`, `deletion-only`, `insert-only`, `overlapping`,
    `unclassified` for one conflict (M2).

    `kind` settles the two shapes the kernel already knows; every other kind is
    read off the narration's marker lines, and a narration that is missing,
    unreadable or carries no marker line is `unclassified` — an entry nobody
    can bucket, counted in `conflicts` and in none of the four.
    """
    if kind == "binary":
        return "binary"
    if kind == "delete/modify":
        return "deletion-only"
    kinds = _segment_kinds(narration)
    if not kinds:
        return UNCLASSIFIED
    if kinds == {"added"}:
        return "insert-only"
    if kinds == {"deleted"}:
        return "deletion-only"
    if kinds.issuperset(_SEGMENT_KINDS):
        return "overlapping"
    return UNCLASSIFIED


def _anchors(narration):
    """The number of `>>>>>>> end conflict` lines — the conflict's anchors."""
    return sum(1 for line in narration.splitlines() if line.rstrip() == _END)


# ------------------------------------------------------------ reading a wave

def _read_index(path):
    """A wave's `conflicts.json` as a list, or None with one stderr line.

    M5: a missing index and an index that is not a JSON list are the same
    fact to a census — the wave happened, and it narrated nothing readable.
    """
    try:
        data = json.loads(path.read_text())
    except (OSError, ValueError):
        _warn("unreadable conflicts index: %s" % path)
        return None
    if not isinstance(data, list):
        _warn("conflicts index is not a JSON list: %s" % path)
        return None
    return data


def _resolve_epochs(path):
    """`{path: highest resolve epoch}` off a wave's `fold_log.jsonl`.

    Mirrors `fold_wave._current_stop`: an entry is settled when its path
    carries a `resolve` row at-or-after the entry's own epoch.
    """
    top = {}
    try:
        text = path.read_text()
    except FileNotFoundError:
        return top
    except OSError as exc:
        swallow("unreadable fold log %s" % path, exc)
        return top
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            row = json.loads(line)
        except ValueError as exc:
            swallow("malformed fold log row in %s" % path, exc)
            continue
        if not isinstance(row, dict) or row.get("type") != "resolve":
            continue
        epoch, key = row.get("epoch"), row.get("path")
        if isinstance(epoch, int) and isinstance(key, str):
            top[key] = max(top.get(key, epoch), epoch)
    return top


def _reply_attempts(wave_dir):
    """`{i: [attempt, …]}` off the wave's `reply-<i>-<attempt>/` directories."""
    attempts = {}
    try:
        children = sorted(wave_dir.iterdir())
    except OSError as exc:
        swallow("unreadable wave directory %s" % wave_dir, exc)
        return attempts
    for child in children:
        match = _REPLY_RE.match(child.name)
        if match and child.is_dir():
            attempts.setdefault(int(match.group(1)), []).append(
                int(match.group(2)))
    return attempts


def _narration(wave_dir, i):
    """A conflict's `conflict-<i>.txt`, or "" when there is none to read."""
    path = wave_dir / ("conflict-%s.txt" % i)
    if not path.is_file():
        return ""                       # M2: a missing narration is unclassified
    try:
        return path.read_text(errors="replace")
    except OSError as exc:
        swallow("unreadable narration %s" % path, exc)
        return ""


def _census_conflict(wave_dir, entry, attempts, resolved_at):
    """One conflict's `--json` object: the eleven keys M4 names, and no other."""
    entry = entry if isinstance(entry, dict) else {}
    i = entry.get("i")
    kind = entry.get("kind")
    narration = "" if kind in ("binary", "delete/modify") else _narration(wave_dir, i)
    shape = shape_of(kind, narration)
    tries = attempts.get(i, []) if isinstance(i, int) else []
    epoch, path = entry.get("epoch"), entry.get("path")
    settled = (isinstance(epoch, int) and isinstance(path, str)
               and resolved_at.get(path, epoch - 1) >= epoch)
    return {
        "i": i,
        "path": path,
        "kind": kind,
        "shape": shape,
        "anchors": 0 if shape == UNCLASSIFIED else _anchors(narration),
        "dispatchable": bool(entry.get("dispatchable")),
        "autoResolved": bool(entry.get("autoResolved")),
        "hunkCount": entry.get("hunkCount"),
        "dispatches": len(tries),
        "retries": sum(1 for a in tries if a >= 2),
        "resolved": bool(settled),
    }


def _census_wave(wave_dir, name):
    """One wave's `{"wave", "conflicts"}` object."""
    index = _read_index(wave_dir / "conflicts.json")
    if index is None:
        return {"wave": name, "conflicts": []}
    attempts = _reply_attempts(wave_dir)
    resolved_at = _resolve_epochs(wave_dir / "fold_log.jsonl")
    return {"wave": name, "conflicts": [
        _census_conflict(wave_dir, entry, attempts, resolved_at)
        for entry in index]}


# -------------------------------------------------------------- a run's waves

def _waves_under(frontier, prefix):
    """`[(name, dir)]` for every `wave-<n>/` under one frontier, `<n>` ascending."""
    try:
        children = list(frontier.iterdir())
    except OSError:
        return []                       # no frontier is no waves, not an error
    found = []
    for child in children:
        match = _WAVE_RE.match(child.name)
        if match and child.is_dir():
            found.append((int(match.group(1)), prefix + match.group(1), child))
    return [(name, path) for _, name, path in sorted(found)]


def _wave_dirs(run_dir):
    """Every wave of a run, the copied frontier first and the publish fold's
    after it — the order the fold itself ran them in."""
    return (_waves_under(run_dir / "frontier", "")
            + _waves_under(run_dir / "publish-fold" / "frontier", "publish-"))


def _totals(waves):
    """The ten counts of a run, summed over its waves."""
    counts = {column: 0 for column in COUNT_COLUMNS}
    counts["waves"] = len(waves)
    for wave in waves:
        for conflict in wave["conflicts"]:
            counts["conflicts"] += 1
            if conflict["shape"] in SHAPES:
                counts[conflict["shape"]] += 1
            if not conflict["dispatchable"]:
                counts["parked"] += 1
            counts["dispatches"] += conflict["dispatches"]
            counts["retries"] += conflict["retries"]
            if conflict["resolved"]:
                counts["resolved"] += 1
    return counts


def census_run(run_dir: str | Path) -> dict:
    """One run directory's census: `run`, `waves` and `totals`, and nothing else.

    This is the `--json` object; the table is rendered off the same dict, so a
    row and its JSON line can never read differently.
    """
    run_dir = Path(run_dir)
    waves = [_census_wave(path, name) for name, path in _wave_dirs(run_dir)]
    name = run_dir.name or run_dir.resolve().name
    return {"run": name, "waves": waves, "totals": _totals(waves)}


# ----------------------------------------------------------------- rendering

def render_header():
    """The table's header: the eleven column names, in order."""
    return "  ".join(COLUMNS)


def render_row(census):
    """One run's row: its basename, then its ten counts in column order."""
    totals = census["totals"]
    return "  ".join([census["run"]] + [str(totals[c]) for c in COUNT_COLUMNS])


def main(argv=None):
    parser = argparse.ArgumentParser(
        prog="fold_census",
        description="Count the conflicts a run's folds narrated, by shape, "
                    "with their parks, dispatches, retries and resolutions.")
    parser.add_argument("run_dir", nargs="*",
                        help="a run's evidence directory (`.ultrapowers/runs/<N>/`)")
    parser.add_argument("--json", action="store_true", dest="as_json",
                        help="print one JSON object per run directory per line, "
                             "with every conflict, instead of the table")
    args = parser.parse_args(argv)

    if not args.as_json:
        print(render_header())
    status = 0
    for run_dir in args.run_dir:
        if not Path(run_dir).is_dir():
            _warn("not a directory: %s" % run_dir)
            status = 2
            continue
        census = census_run(run_dir)
        if args.as_json:
            print(json.dumps(census, sort_keys=True))
        else:
            print(render_row(census))
    return status


if __name__ == "__main__":
    sys.exit(main())
