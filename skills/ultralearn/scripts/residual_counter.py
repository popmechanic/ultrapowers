#!/usr/bin/env python3
"""ultralearn residual counter — one `residual` ledger row per line of a run's
`residuals.jsonl`, keyed by `(file, normalized text)`.

A *residual* is what a review round left behind: the deferred, the structural,
the nit, the unverified. The reviewer writes them down per run; this script is
the merge of those per-run files into the one accumulated ledger, so that the
same remark made on two runs — or on two files in one run — can be seen as the
repeat it is rather than read twice as news.

The row's identity has two halves and they answer different questions:

    `key`   `(file, normalized text)` — the same remark, wherever it recurs
    `id`    `(runId, kind, key)`      — this run's saying of it, said once

so two runs carrying the same residual text yield two rows with equal `key`
and different `id`: the ledger keeps both sayings, and the report counts them.

Read-only and advisory apart from the ledger, and even that only by appending:
a second pass over the same paths adds nothing, an existing line is never
rewritten, and a malformed line of a `residuals.jsonl` costs its own row and
not the file. A path under which no `residuals.jsonl` exists is reported as
`LOOKED-EMPTY:` on stderr and is not an error.

Every path in a row is the string the record spelled: nothing here normalises,
resolves or globs a path. The text is normalised only for the key — the row
carries the text as written.
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
from _outcome import (FailedLookup, report_looked_empty,  # noqa: E402,F401
                      swallow)
# One ledger reader, shared: `_ledger_ids` is what makes the append idempotent
# against rows this script never wrote. It raises `FailedLookup` for a ledger
# that exists and cannot be read — re-exported here, and deliberately not
# caught: appending blind over an unreadable ledger would duplicate it.
from catch_counter import _ledger_ids  # noqa: E402

ROW_KIND = "residual"

# A directory holding this is a residual directory; nothing else makes one. A
# run that recorded residuals need not have kept anything else beside them.
RESIDUAL_FILE = "residuals.jsonl"

# The row is exactly these keys — no more, no fewer. [M1]
ROW_KEYS = ("id", "kind", "key", "runId", "task", "file", "line",
            "residualKind", "text", "sha")

WHITESPACE = re.compile(r"\s+")


# --- identity --------------------------------------------------------------

def normalize_text(text):
    """The text as the key sees it: whitespace runs collapsed to one space,
    stripped, lowercased. [M2]

    `the exam covers  the success path only` and `The exam covers the success
    path only` are the same remark, and this is the sentence that says so."""
    return WHITESPACE.sub(" ", "" if text is None else str(text)).strip().lower()


def row_key(file, text):
    """The remark's identity across runs: the first 16 hex digits of the
    SHA-256 of `file + "\\n" + normalized text`. [M2]

    A null `file` hashes as the empty string — the residual that names no file
    is one remark, not one per spelling of "nowhere"."""
    material = "%s\n%s" % ("" if file is None else file, normalize_text(text))
    return hashlib.sha256(material.encode("utf-8")).hexdigest()[:16]


def row_id(row):
    """The row's ledger identity: the first 16 hex digits of the SHA-256 of
    `runId + "\\n" + "residual" + "\\n" + key`. [M2]

    The run is in the material, so the same remark on two runs is two rows —
    which is exactly what makes a repeat countable."""
    material = "%s\n%s\n%s" % (row.get("runId"), ROW_KIND, row.get("key"))
    return hashlib.sha256(material.encode("utf-8")).hexdigest()[:16]


# --- the record ------------------------------------------------------------

def _read_residuals(path):
    """Every well-formed line of one `residuals.jsonl`, in file order.

    A malformed line is one `swallow` and the rest of the file still reads; an
    unreadable file is a swallow too, and contributes no rows."""
    try:
        text = Path(path).read_text(encoding="utf-8")
    except OSError as exc:
        swallow("residuals file unreadable; it contributes no rows", exc)
        return []
    out = []
    for line in text.splitlines():
        if not line.strip():
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError as exc:
            swallow("malformed residuals line skipped; the rest of the file "
                    "still reads", exc)
            continue
        if isinstance(record, dict):
            out.append(record)
        else:
            swallow("residuals line is not an object; it contributes no row")
    return out


def residual_row(record):
    """One ledger row from one `residuals.jsonl` line — exactly `ROW_KEYS`.

    `runId` is the line's own `run` and `residualKind` its own `kind`: the
    directory the file was found under names nothing, and the ledger's `kind`
    column is the ledger's, so the residual's own kind moves aside."""
    row = {
        "kind": ROW_KIND,
        "key": row_key(record.get("file"), record.get("text")),
        "runId": record.get("run"),
        "task": record.get("task"),
        "file": record.get("file"),
        "line": record.get("line"),
        "residualKind": record.get("kind"),
        "text": record.get("text"),
        "sha": record.get("sha"),
    }
    row["id"] = row_id(row)
    return row


def derive_residuals(residuals_path):
    """Every row one `residuals.jsonl` carries, in file order. [M1]"""
    return [residual_row(record) for record in _read_residuals(residuals_path)]


def order_rows(rows):
    """The rows in run order, each run's rows in the order its file wrote them.

    The run a residual belongs to is the line's own `run`, and the directory
    that held the file names nothing — a run recorded under `seven/` is still
    `run-7`, and one recorded under `eight/` is still `run-8`. So the ledger's
    order is the runs', not the directory names': the same corpus merges to the
    same sequence however the directories were spelled. Python's sort is
    stable, so a run's own lines keep their file order."""
    return sorted(rows, key=lambda row: str(row.get("runId")))


# --- the ledger ------------------------------------------------------------

def append_rows(rows, ledger_path):
    """Append every row the ledger does not already carry; return
    `{"added": n, "skipped": m}`. [M3]

    Append-only: an existing line is never rewritten, and a second call with
    the same rows adds nothing and leaves the file's bytes unchanged. The
    ledger's parent directories are created when absent."""
    rows = list(rows or [])
    ledger_path = Path(ledger_path)
    seen = _ledger_ids(ledger_path)
    added = []
    for row in rows:
        identity = row.get("id")
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

def find_residual_files(paths):
    """Every `residuals.jsonl` at or under `paths`, each reported once, in a
    deterministic order. [M1]

    A path is a directory holding one, or a tree holding several. A path under
    which none exists is a completed lookup that found nothing — said so on
    stderr, not an error."""
    found, seen = [], set()
    for path in paths:
        hits = 0
        for dirpath, dirnames, filenames in os.walk(path):
            dirnames.sort()
            if RESIDUAL_FILE not in filenames:
                continue
            hits += 1
            key = os.path.realpath(os.path.join(dirpath, RESIDUAL_FILE))
            if key in seen:
                continue
            seen.add(key)
            found.append(os.path.join(dirpath, RESIDUAL_FILE))
        if not hits:
            report_looked_empty("no residuals file (%s) under %s"
                                % (RESIDUAL_FILE, path))
    return found


def main(argv=None):
    parser = argparse.ArgumentParser(
        prog="residual_counter.py",
        description="Merge each run's residuals into the ledger, keyed by "
                    "(file, normalized text).")
    parser.add_argument("paths", nargs="+", metavar="PATH",
                        help="a directory holding %s, or a tree containing them"
                             % RESIDUAL_FILE)
    parser.add_argument("--ledger", dest="ledger", metavar="FILE",
                        help="append the rows to this JSONL ledger")
    args = parser.parse_args(argv)

    files = find_residual_files(args.paths)
    rows = order_rows([row for path in files
                       for row in derive_residuals(path)])
    counts = (append_rows(rows, args.ledger) if args.ledger
              else {"added": 0, "skipped": 0})
    print("%d file(s) counted, %d row(s) appended, %d already recorded"
          % (len(files), counts["added"], counts["skipped"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
