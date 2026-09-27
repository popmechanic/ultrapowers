#!/usr/bin/env python3
"""Jev's authoring checks: ambiguity in the operator's words, one purpose
per piece, no two pieces with one purpose, a main story that rules out its
near-miss, and no action that reads the wording of typed text. Every check
is a live experiment (policy.json); a flag is for the author to act on.

    jev_checks.py <bundle> [--ask-file <raw ask.txt>]"""
import argparse
import itertools
import json
import os
import re
import sys
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from bundle import load_bundle  # noqa: E402

URL = "https://api.typesafe.ai/v1/systemone"
MODEL = "jev-latest"
Q = json.load(open(os.path.join(HERE, "questions.json"), encoding="utf-8"))
POLICY = json.load(open(os.path.join(HERE, "policy.json"), encoding="utf-8"))["flag_at"]


def _key():
    home = os.environ.get("ULTRAPOWERS_HOME", os.path.expanduser("~/.ultrapowers"))
    with open(os.path.join(home, "typesafe.env"), encoding="utf-8") as fh:
        return dict(l.strip().split("=", 1) for l in fh if "=" in l)["TYPESAFE_API_KEY"]


def default_ask(state, questions):
    try:
        body = json.dumps({"state": state, "model": MODEL, "questions": questions}).encode()
        req = urllib.request.Request(URL, data=body, headers={
            "Authorization": "Bearer " + _key(), "Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read()).get("answers")
    except (urllib.error.URLError, OSError, ValueError, KeyError):
        return None


def _noul(answers, key):
    if not isinstance(answers, dict):
        return None
    a = answers.get(key)
    v = a if isinstance(a, (int, float)) else (a or {}).get("noul")
    return v if isinstance(v, (int, float)) else None


def sentences(text):
    return [s for s in re.split(r"(?<=[.!?])\s+", text.strip()) if s]


def run_jev_checks(b, ask, ask_text=None):
    flags, reads = [], 0
    cards = b["cards"]
    stories = {s["id"]: s["sentence"] for s in b["page"].get("stories", [])}

    def one(state, questions, label):
        nonlocal reads
        reads += 1
        answers = ask(state, questions)
        if answers is None:
            flags.append("JEV unread: %s" % label)
        return answers

    if ask_text:
        for s in sentences(ask_text):
            a = one({"ask": ask_text, "sentence": s}, Q["ambiguity"], 'ambiguity of "%s"' % s)
            v = _noul(a, "two_apps")
            if v is not None and v >= POLICY["two_apps"]:
                flags.append('JEV flag: ambiguous: "%s" (two_apps %.2f) — show both readings side by side' % (s, v))

    for c in cards:
        piece = {"name": c["piece"], "purpose": c["purpose"],
                 "actions": [{"name": a["name"], "description": a["description"]} for a in c["actions"]]}
        a = one({"piece": piece}, Q["coherence"], "piece %s coherence" % c["piece"])
        v = _noul(a, "one_need")
        if v is not None and v < POLICY["one_need_below"]:
            flags.append("JEV flag: piece %s: its purpose reads as more than one need (one_need %.2f)" % (c["piece"], v))
        v = _noul(a, "same_people")
        if v is not None and v < POLICY["same_people_below"]:
            flags.append("JEV flag: piece %s: its actions serve different people (same_people %.2f)" % (c["piece"], v))
        v = _noul(a, "actions_conflict")
        if v is not None and v >= POLICY["actions_conflict"]:
            flags.append("JEV flag: piece %s: two actions can work against each other (actions_conflict %.2f)" % (c["piece"], v))

        state = {"piece": {"name": c["piece"], "purpose": c["purpose"]},
                 "story": stories.get(c.get("main_story"), ""), "near_miss": c.get("near_miss", "")}
        a = one(state, Q["near_miss"], "piece %s near-miss" % c["piece"])
        v = _noul(a, "story_passes_near_miss")
        if v is not None and v >= POLICY["story_passes_near_miss"]:
            flags.append("JEV flag: piece %s: main story %s does not rule out its near-miss (story_passes_near_miss %.2f)"
                         % (c["piece"], c.get("main_story"), v))

        for act in c["actions"]:
            state = {"action": {"name": act["name"], "description": act["description"]},
                     "store_module": b["store_text"][:20000]}
            a = one(state, Q["content_branch"], "action %s" % act["name"])
            v = _noul(a, "branches_on_text")
            if v is not None and v >= POLICY["branches_on_text"]:
                flags.append("JEV flag: piece %s: %s may act on the wording of typed text (branches_on_text %.2f)"
                             % (c["piece"], act["name"], v))

    for x, y in itertools.combinations(cards, 2):
        state = {"a": {"name": x["piece"], "purpose": x["purpose"]}, "b": {"name": y["piece"], "purpose": y["purpose"]}}
        a = one(state, Q["redundancy"], "pieces %s and %s" % (x["piece"], y["piece"]))
        v = _noul(a, "same_need")
        if v is not None and v >= POLICY["same_need"]:
            flags.append("JEV flag: pieces %s and %s serve the same need (same_need %.2f)" % (x["piece"], y["piece"], v))
    return flags, reads


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("bundle")
    ap.add_argument("--ask-file")
    args = ap.parse_args(argv)
    ask_text = open(args.ask_file, encoding="utf-8").read() if args.ask_file else None
    flags, reads = run_jev_checks(load_bundle(args.bundle), default_ask, ask_text)
    for f in flags:
        print(f)
    print("JEV read: %d call(s), %d flag(s)" % (reads, sum(f.startswith("JEV flag") for f in flags)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
