#!/usr/bin/env python3
"""The laptop's check of a stories-v1 plan: the plan, the app's stories
export and the signed store module must agree. Every probe must be exactly
its recorded step's diff; every signed step has a probe; every older story
has a guard."""
import hashlib
import json
import os

import probe_block
import stories_parse


def _load_rows(path):
    with open(path, encoding="utf-8") as fh:
        return [json.loads(l) for l in fh if l.strip()]


def _split(clause):
    sid, step = clause.rsplit(".", 1)
    return sid, int(step)


def violations(text, plan_path, stories_path=None):
    try:
        parsed = stories_parse.parse_stories_text(text)
    except stories_parse.StoriesRefusal as exc:
        return [str(exc)]
    root = os.path.dirname(os.path.dirname(os.path.abspath(plan_path)))
    out = []
    store = parsed["store"]
    store_file = os.path.join(root, store["path"])
    if not os.path.isfile(store_file):
        out.append("stories: store module %s is missing" % store["path"])
    else:
        with open(store_file, "rb") as fh:
            got = hashlib.sha256(fh.read()).hexdigest()
        if got != store["sha256"]:
            out.append("stories: store module %s changed since it was signed (now sha256:%s, signed sha256:%s)"
                       % (store["path"], got, store["sha256"]))
    export = stories_path or os.path.join(root, "stories", "steps.jsonl")
    if not os.path.isfile(export):
        return out + ["stories: the stories export %s is missing" % export]
    rows = _load_rows(export)
    by_key = {(r["story"], r["step"]): r for r in rows}
    plan_id = parsed["plan_id"]
    actions = {a for t in parsed["tasks"] for a in t["actions"]}
    probed = set()

    def one(p, story, step, label, check_tools):
        r = by_key.get((story, step))
        if r is None:
            out.append("%s: no recorded step %s.%d in the stories export" % (label, story, step))
            return
        probed.add((story, step))
        if p["expect"] != probe_block.checks_for(r["before"], r["after"]):
            out.append("%s: expect differs from the recorded step's diff" % label)
        if probe_block.hollow(p, r["before"]):
            out.append("%s: hollow — every check already holds before the step" % label)
        if check_tools:
            for name in sorted(probe_block.tools_of(p) - actions):
                out.append("%s: names tool %s, which no task's Actions list" % (label, name))

    for t in parsed["tasks"]:
        for p in t["probes"]:
            sid, step = _split(p["clause"])
            one(p, plan_id + "/" + sid, step, "task %s probe %s" % (t["id"], p["clause"]), True)
    for g in parsed["guards"]:
        story, step = _split(g["clause"][2:] if g["clause"].startswith("G:") else g["clause"])
        one(g, story, step, "guard %s" % g["clause"], False)
    for s in parsed["stories"]:
        full = plan_id + "/" + s["id"]
        srows = [r for r in rows if r["story"] == full]
        if not srows:
            out.append("story %s has no recorded steps" % s["id"])
        for r in sorted(srows, key=lambda r: r["step"]):
            if (full, r["step"]) not in probed:
                out.append("story %s step %d has no probe" % (s["id"], r["step"]))
    for r in rows:
        if not r["story"].startswith(plan_id + "/") and (r["story"], r["step"]) not in probed:
            out.append("guard missing: %s.%d is an earlier signed story step with no guard probe"
                       % (r["story"], r["step"]))
    return out
