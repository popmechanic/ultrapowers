#!/usr/bin/env python3
"""Turn the preview's `steps` db rows (as ArtifactData `list` returned them,
saved to a JSON file) into steps.jsonl: per story, the latest session wins.

    steps_from_rows.py <rows.json> <steps.jsonl>"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "stories"))
import steps as steps_mod  # noqa: E402

DB_ONLY = ("id", "session", "at")


def rows_to_steps(rows):
    latest = {}
    for r in rows:
        cur = latest.get(r["story"])
        if cur is None or r["at"] > cur[1]:
            latest[r["story"]] = (r["session"], r["at"])
    out = [{k: v for k, v in r.items() if k not in DB_ONLY}
           for r in rows if latest[r["story"]][0] == r["session"]]
    return sorted(out, key=lambda r: (r["story"], r["step"]))


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("usage: steps_from_rows.py <rows.json> <steps.jsonl>")
    with open(sys.argv[1], encoding="utf-8") as fh:
        data = json.load(fh)
    rows = data if isinstance(data, list) else data.get("documents", data.get("docs", []))
    got = rows_to_steps(rows)
    errs = [e for srows in steps_mod.stories_of(got).values() for e in steps_mod.validate_story(srows)]
    steps_mod.dump_steps(got, sys.argv[2])
    for e in errs:
        print(e)
    sys.exit(2 if errs else 0)
