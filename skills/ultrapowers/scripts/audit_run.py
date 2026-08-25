#!/usr/bin/env python3
"""Post-run effort audit for ultrapowers workflow transcripts (issue #20).

Reads the engine's per-run transcript directory (the "Transcript dir:" path
printed at Workflow launch), classifies each agent-*.jsonl by role from the
stable baked-prompt phrases, sums assistant turns and output tokens, and
prints a markdown effort table plus escalated-task and thrash signals.

ADVISORY BY CONTRACT: a missing directory, no agent files, or a drifted
layout prints one diagnostic and exits 0 — this script must never block the
Step-5 gate. Read-only: it writes nothing.
"""
from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

TASK_HEAD = re.compile(r"### Task ([A-Za-z0-9]+):")
# The real engine prompt references the task by id rather than an inlined
# header:  …find the object whose "id" is "2"…  (per-task impl/reviewer prompts).
TASK_ID = re.compile(r'"id"\s+is\s+"([A-Za-z0-9]+)"')
# #224: a relaunch-round prompt whose body was inlined without a "### Task N:"
# heading (and no wavesPath "id" sentence) still carries the task's declared
# file scope on one line — the one deterministic key left to join on.
FILES_LINE = re.compile(r"^FILES: (.+)$", re.MULTILINE)
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
    # #188: the resolver prompt (references/wave-merge.md RESOLVER_PROMPT,
    # baked into waves.js) opens with this phrase.
    ("You are a merge-conflict resolver", "resolver"),
    # Bugfix: this marker previously read "What ..." (capital W); the actual
    # baked completeness-critic prompt (references/wave-merge.md's
    # COMPLETENESS_PROMPT block, baked into waves.js's completenessPrompt())
    # reads lowercase "what plan requirement is unmet?" — the capitalized form
    # never matched, so every completeness-critic transcript classified
    # "unknown". Corrected case only; role name and marker phrase unchanged.
    ("what plan requirement is unmet?", "integration"),
]

# Absolute thrash heuristic: an implementer doing many turns for little output. Tuned so
# healthy implementers (~90 tokens/turn) are not flagged; a genuine thrasher
# (<40 tokens/turn over >=30 turns) is.
THRASH_MIN_TURNS = 30
THRASH_MAX_PER_TURN = 40


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


def _files_line_task(text, files_by_task):
    m = FILES_LINE.search(text)
    if not m or not files_by_task:
        return None
    want = {p.strip() for p in m.group(1).split(", ") if p.strip()}
    hits = [tid for tid, files in files_by_task.items()
            if isinstance(files, list) and set(files) == want]
    return hits[0] if len(hits) == 1 else None


def classify(text, files_by_task=None):
    for marker, role in ROLE_MARKERS:
        if marker in text:
            if role in ("impl", "review"):
                m = TASK_ID.search(text) or TASK_HEAD.search(text)
                tid = m.group(1) if m else _files_line_task(text, files_by_task)
                return role + ":" + (tid if tid else "?")
            return role
    return "unknown"


def _parse_ts(ts):
    """ISO 8601 timestamp ('Z' or numeric offset) -> aware datetime, or None."""
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return None


def collect(path):
    """(model, turns, out_tokens, wall_sec, first_ts). wall_sec = last record
    `timestamp` minus first record `timestamp` across the whole transcript
    (any record type), 0.0 when fewer than two parseable timestamps are
    present — a transcript with no `timestamp` field at all never raises.
    first_ts is the transcript's first parseable timestamp (a datetime) or
    None, used to order same-role attempts (#224)."""
    model, turns, out_tokens = "?", 0, 0
    first_ts, last_ts = None, None
    for line in path.read_text().splitlines():
        try:
            d = json.loads(line)
        except json.JSONDecodeError:
            continue
        ts = d.get("timestamp")
        if isinstance(ts, str) and ts:
            dt = _parse_ts(ts)
            if dt is not None:
                if first_ts is None:
                    first_ts = dt
                last_ts = dt
        if d.get("type") != "assistant":
            continue
        turns += 1
        msg = d.get("message", {})
        model = msg.get("model", model)
        out_tokens += (msg.get("usage") or {}).get("output_tokens", 0) or 0
    wall_sec = (last_ts - first_ts).total_seconds() if first_ts is not None and last_ts is not None else 0.0
    return model, turns, out_tokens, wall_sec, first_ts


def audit(transcript_dir, files_by_task=None):
    """Structured effort audit for one per-run engine transcript dir.

    Advisory by contract: a missing/empty/drifted dir returns a dict with an
    empty 'agents' list and a 'note' — never raises. `files_by_task` (launch
    task id -> declared files) enables the FILES-line join for prompts that
    carry no task-id line (#224)."""
    d = Path(transcript_dir)
    files = sorted(d.glob("agent-*.jsonl")) if d.is_dir() else []
    if not files:
        return {"agents": [], "totals": {"turns": 0, "outputTokens": 0,
                                         "wallSecByTask": {}, "liveWallSecByTask": {}},
                "escalatedTasks": [], "thrashCandidates": [],
                "note": f"no agent-*.jsonl under {transcript_dir}"}
    agents = []
    for f in files:
        role = classify(first_user_text(f), files_by_task)
        model, turns, out_tokens, wall_sec, first_ts = collect(f)
        agents.append({"role": role, "model": model, "turns": turns,
                       "outputTokens": out_tokens, "wallSec": wall_sec,
                       "file": f.name, "_first": first_ts})
    # attempt: 1-based order among transcripts sharing one impl:/review: role,
    # by first timestamp (unstamped last) then filename — earlier attempts are
    # the escalation/zombie retries a raw sum double-counts (#224).
    by_role = {}
    for a in agents:
        if a["role"].startswith(("impl:", "review:")):
            by_role.setdefault(a["role"], []).append(a)
    for lst in by_role.values():
        lst.sort(key=lambda a: (a["_first"] is None,
                                a["_first"] or datetime.min.replace(tzinfo=timezone.utc),
                                a["file"]))
        for i, a in enumerate(lst, 1):
            a["attempt"] = i
    for a in agents:
        a.pop("_first", None)
    agents.sort(key=lambda a: -a["turns"])
    totals = {"turns": sum(a["turns"] for a in agents),
              "outputTokens": sum(a["outputTokens"] for a in agents)}
    # escalatedTasks: a task with more than one implementer transcript — the
    # auto-escalate retry leaves a second impl:<id> transcript at a higher model.
    impl_by_task = {}
    for a in agents:
        if a["role"].startswith("impl:"):
            impl_by_task.setdefault(a["role"].split(":", 1)[1], []).append(a)
    escalated = sorted(tid for tid, lst in impl_by_task.items() if len(lst) > 1)
    # wallSecByTask: summed wallSec across every impl:<id> transcript (a task
    # that escalated has more than one transcript feeding the same id).
    totals["wallSecByTask"] = {tid: sum(a["wallSec"] for a in lst)
                               for tid, lst in impl_by_task.items()}
    # liveWallSecByTask: wallSec of the highest-attempt (live/final) impl
    # transcript only — the escalation retry chain's real wall-clock cost,
    # not the raw sum which double-counts abandoned zombie attempts (#224).
    totals["liveWallSecByTask"] = {tid: max(lst, key=lambda a: a["attempt"])["wallSec"]
                                   for tid, lst in impl_by_task.items()}
    # thrashCandidates: absolute high-turns/low-output, no same-model peer needed.
    thrash = [a for a in agents
              if a["role"].startswith("impl")
              and a["turns"] >= THRASH_MIN_TURNS
              and (a["outputTokens"] / a["turns"] if a["turns"] else 0) < THRASH_MAX_PER_TURN]
    return {"agents": agents, "totals": totals,
            "escalatedTasks": escalated, "thrashCandidates": thrash}


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
        model, turns, out_tokens, _wall_sec, _first = collect(f)
        rows.append((role, model, turns, out_tokens))
    rows.sort(key=lambda r: -r[2])

    print("| role | model | turns | output tokens |")
    print("|---|---|---:|---:|")
    for role, model, turns, out_tokens in rows:
        print(f"| {role} | {model} | {turns} | {out_tokens} |")

    unknown = sum(1 for r in rows if r[0] == "unknown")
    if unknown:
        print(f"\n{unknown} agent file(s) unclassified — baked-prompt phrases may have drifted.")

    # Peer-free signals (reuse audit(); the duplicate read is advisory and cheap).
    data = audit(root)
    if data.get("escalatedTasks"):
        print("\n**Escalated tasks** (an agent-error triggered a tier retry): " +
              ", ".join(data["escalatedTasks"]))
    if data.get("thrashCandidates"):
        print("\n**Thrash candidates** (high turns / low output — likely wrong tier):")
        for a in data["thrashCandidates"]:
            print(f"- {a['role']} on {a['model']}: {a['turns']} turns, "
                  f"{a['outputTokens']} output tokens")
    return 0


if __name__ == "__main__":
    sys.exit(main())
