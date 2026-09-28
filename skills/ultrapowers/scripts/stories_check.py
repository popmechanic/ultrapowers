#!/usr/bin/env python3
"""The laptop's check of a stories-v1 plan: the signed store module is the one
the plan names, and every probe calls only the tools its tasks list. The
probes themselves were derived by compile.ts from that store; hollowness is
refused there and measured again by the Flock's start-of-run check."""
import hashlib
import os

import probe_block
import stories_parse


def violations(text, plan_path):
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
    actions = {a for t in parsed["tasks"] for a in t["actions"]}
    for t in parsed["tasks"]:
        for p in t["probes"]:
            for name in sorted(probe_block.tools_of(p) - actions):
                out.append("task %s probe %s: names tool %s, which no task's Actions list"
                           % (t["id"], p["clause"], name))
    return out
