#!/usr/bin/env python3
"""A story's recorded steps: the text export (one JSON object per line) and
the checks that keep a story honest: numbered 1..n, starting from the empty
app, each step starting where the last one ended."""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                "..", "..", "ultrapowers", "scripts"))
from probe_block import EMPTY, is_ui_call  # noqa: E402

LAYERS = ("store", "ui", "saved")


def load_steps(path):
    rows = []
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            if line.strip():
                rows.append(json.loads(line))
    return rows


def dump_steps(rows, path):
    with open(path, "w", encoding="utf-8") as fh:
        for r in rows:
            fh.write(json.dumps(r, sort_keys=True, ensure_ascii=False) + "\n")


def _is_content(v):
    return (isinstance(v, list) and len(v) == 2
            and isinstance(v[0], dict) and isinstance(v[1], dict))


def validate_step(r):
    where = "step %s.%s" % (r.get("story"), r.get("step"))
    errs = []
    if not isinstance(r.get("story"), str) or not r.get("story"):
        errs.append(where + ": story must be a non-empty string")
    if not isinstance(r.get("step"), int) or isinstance(r.get("step"), bool) or r["step"] < 1:
        errs.append(where + ": step must be a whole number from 1")
    if not isinstance(r.get("piece"), str) or not r.get("piece"):
        errs.append(where + ": piece must be a non-empty string")
    if not isinstance(r.get("tool"), str) or not r.get("tool"):
        errs.append(where + ": tool must name the action that ran")
    if not isinstance(r.get("args", {}), dict):
        errs.append(where + ": args must be an object")
    if r.get("layer") not in LAYERS:
        errs.append(where + ": layer must be one of store, ui, saved")
    ui = r.get("ui")
    if r.get("layer") == "ui":
        if not (isinstance(ui, list) and ui and all(is_ui_call(g) for g in ui)):
            errs.append(where + ": a ui step needs ui = a list of click/type/key gestures")
    elif ui is not None:
        errs.append(where + ": only a ui step carries ui")
    for k in ("before", "after"):
        if not _is_content(r.get(k)):
            errs.append(where + ": %s must be [tables, values]" % k)
    return errs


def validate_story(rows):
    """Errors for one story's rows, which may arrive in any order."""
    rows = sorted(rows, key=lambda r: r.get("step") if isinstance(r.get("step"), int) else 0)
    errs = []
    for r in rows:
        errs += validate_step(r)
    if errs:
        return errs
    sid = rows[0]["story"]
    if [r["step"] for r in rows] != list(range(1, len(rows) + 1)):
        return ["story %s: steps must be numbered 1..%d without gaps" % (sid, len(rows))]
    if rows[0]["before"] != EMPTY:
        errs.append("story %s: step 1 must start from the empty app" % sid)
    for prev, cur in zip(rows, rows[1:]):
        if cur["before"] != prev["after"]:
            errs.append("story %s: step %d does not start where step %d ended"
                        % (sid, cur["step"], prev["step"]))
    return errs


def stories_of(rows):
    out = {}
    for r in rows:
        out.setdefault(r["story"], []).append(r)
    for k in out:
        out[k].sort(key=lambda r: r["step"])
    return dict(sorted(out.items()))
