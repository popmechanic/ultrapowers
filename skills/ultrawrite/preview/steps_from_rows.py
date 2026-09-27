#!/usr/bin/env python3
"""Turn the preview's `steps` db rows (as ArtifactData `list` returned them)
into steps.jsonl: per story, the latest session wins.

`rows` may be a directory — ArtifactData `list ... out_dir=...` writes one
flat JSON document per row to `<out_dir>/<doc_id>.json` — or a JSON file: a
list of rows, or an object with a `documents`/`docs` list, as before. A row
shaped `{"id", "data": {...}, "version", ...}` is unwrapped to its `data`.

    steps_from_rows.py <rows.json|rows-dir> <steps.jsonl>"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "stories"))
import steps as steps_mod  # noqa: E402

DB_ONLY = ("id", "session", "at")


def _unwrap(row):
    if isinstance(row, dict) and isinstance(row.get("data"), dict):
        return row["data"]
    return row


def load_rows(path):
    """Read `rows` (a directory of one-JSON-document-per-row files, or a JSON
    file holding a list or a `documents`/`docs`-keyed object) into a list of
    row dicts. Anything else exits 2 with a named error."""
    if os.path.isdir(path):
        names = sorted(n for n in os.listdir(path) if n.endswith(".json"))
        rows = []
        for name in names:
            item_path = os.path.join(path, name)
            with open(item_path, encoding="utf-8") as fh:
                try:
                    rows.append(_unwrap(json.load(fh)))
                except json.JSONDecodeError as exc:
                    print("steps_from_rows: unrecognized rows input %s: %s" % (item_path, exc), file=sys.stderr)
                    sys.exit(2)
        return rows
    if os.path.isfile(path):
        with open(path, encoding="utf-8") as fh:
            try:
                data = json.load(fh)
            except json.JSONDecodeError as exc:
                print("steps_from_rows: unrecognized rows input %s: %s" % (path, exc), file=sys.stderr)
                sys.exit(2)
        if isinstance(data, list):
            return [_unwrap(r) for r in data]
        if isinstance(data, dict):
            return [_unwrap(r) for r in data.get("documents", data.get("docs", []))]
    print("steps_from_rows: unrecognized rows input %s" % path, file=sys.stderr)
    sys.exit(2)


def rows_to_steps(rows):
    latest = {}
    for r in rows:
        cur = latest.get(r["story"])
        if cur is None or r["at"] > cur[1]:
            latest[r["story"]] = (r["session"], r["at"])
    out = [{k: v for k, v in r.items() if k not in DB_ONLY}
           for r in rows if latest[r["story"]][0] == r["session"]]
    return sorted(out, key=lambda r: (r["story"], r["step"]))


def merge_steps(existing, new_rows):
    """`existing`'s stories, with every story `new_rows` carries replaced by
    `new_rows`'s own lines for that story — every other story's lines untouched.
    Sorted by (story, step)."""
    new_by_story = steps_mod.stories_of(new_rows)
    out = [r for r in existing if r["story"] not in new_by_story]
    for srows in new_by_story.values():
        out.extend(srows)
    return sorted(out, key=lambda r: (r["story"], r["step"]))


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("usage: steps_from_rows.py <rows.json|rows-dir> <steps.jsonl>")
    rows = load_rows(sys.argv[1])
    got = rows_to_steps(rows)
    out_path = sys.argv[2]
    if os.path.exists(out_path):
        got = merge_steps(steps_mod.load_steps(out_path), got)
    errs = [e for srows in steps_mod.stories_of(got).values() for e in steps_mod.validate_story(srows)]
    steps_mod.dump_steps(got, out_path)
    for e in errs:
        print(e)
    sys.exit(2 if errs else 0)
