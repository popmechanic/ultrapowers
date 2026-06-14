#!/usr/bin/env python3
"""Post-run effort audit for ultrapowers workflow transcripts (issue #20).

Reads the engine's per-run transcript directory (the "Transcript dir:" path
printed at Workflow launch), classifies each agent-*.jsonl by role from the
stable baked-prompt phrases, sums assistant turns and output tokens, and
prints a markdown effort table plus tier-misrank candidates: implementers
above 1.5x the median turns of SAME-MODEL peers (transcripts carry resolved
model strings, not tier names — grouping by model stays correct under
tierOverrides remapping).

ADVISORY BY CONTRACT: a missing directory, no agent files, or a drifted
layout prints one diagnostic and exits 0 — this script must never block the
Step-5 gate. Read-only: it writes nothing.
"""
from __future__ import annotations

import json
import re
import statistics
import sys
from pathlib import Path

TASK_HEAD = re.compile(r"### Task ([A-Za-z0-9]+):")
# First phrases of the baked prompts (reviewer-prompts.md / wave-merge.md).
# tests/test_no_prompt_drift.py pins those sources into waves.js, so the
# classifier inherits their stability; an unmatched prompt degrades to
# "unknown", never to an error.
ROLE_MARKERS = [
    ("You are an implementer subagent", "impl"),
    ("You are an independent reviewer", "review"),
    ("You are the setup agent", "setup"),
    ("You are the wave merge agent", "merge"),
    ("You are the reconciliation agent", "reconcile"),
    ("What plan requirement is unmet?", "integration"),
]


def first_user_text(path):
    for line in path.read_text().splitlines():
        try:
            d = json.loads(line)
        except json.JSONDecodeError:
            continue
        if d.get("type") != "user":
            continue
        c = d.get("message", {}).get("content")
        if isinstance(c, str):
            return c
        if isinstance(c, list):
            for block in c:
                if isinstance(block, dict) and block.get("type") == "text":
                    return block.get("text", "")
    return ""


def classify(text):
    for marker, role in ROLE_MARKERS:
        if marker in text:
            if role in ("impl", "review"):
                m = TASK_HEAD.search(text)
                return role + ":" + (m.group(1) if m else "?")
            return role
    return "unknown"


def collect(path):
    model, turns, out_tokens = "?", 0, 0
    for line in path.read_text().splitlines():
        try:
            d = json.loads(line)
        except json.JSONDecodeError:
            continue
        if d.get("type") != "assistant":
            continue
        turns += 1
        msg = d.get("message", {})
        model = msg.get("model", model)
        out_tokens += (msg.get("usage") or {}).get("output_tokens", 0) or 0
    return model, turns, out_tokens


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if len(argv) != 1:
        print("usage: audit_run.py <transcript-dir>  (advisory tool — exits 0 regardless)")
        return 0
    root = Path(argv[0])
    files = sorted(root.glob("agent-*.jsonl")) if root.is_dir() else []
    if not files:
        print(f"audit_run: no agent-*.jsonl under {root} — transcript dir missing "
              "or engine layout drifted; nothing to audit.")
        return 0

    rows = []
    for f in files:
        role = classify(first_user_text(f))
        model, turns, out_tokens = collect(f)
        rows.append((role, model, turns, out_tokens))
    rows.sort(key=lambda r: -r[2])

    print("| role | model | turns | output tokens |")
    print("|---|---|---:|---:|")
    for role, model, turns, out_tokens in rows:
        print(f"| {role} | {model} | {turns} | {out_tokens} |")

    unknown = sum(1 for r in rows if r[0] == "unknown")
    if unknown:
        print(f"\n{unknown} agent file(s) unclassified — baked-prompt phrases may have drifted.")

    impls = [r for r in rows if r[0].startswith("impl:")]
    by_model = {}
    for r in impls:
        by_model.setdefault(r[1], []).append(r)
    flagged = []
    for group in by_model.values():
        if len(group) < 2:
            continue  # single-sample noise: never flag a lone task
        med = statistics.median(r[2] for r in group)
        flagged.extend(r for r in group if med and r[2] > 1.5 * med)
    if flagged:
        print("\n**Tier-misrank candidates** (turns > 1.5x median of same-model implementers):")
        for role, model, turns, _ in sorted(flagged, key=lambda r: -r[2]):
            print(f"- {role} on {model}: {turns} turns — consider a higher tier for tasks like this")
    else:
        print("\nNo tier-misrank candidates (no implementer exceeded 1.5x its same-model median).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
