#!/usr/bin/env python3
"""The live transcript/version readers, shared by the fleet harvester and the
per-worker slicer. Read-only and advisory: malformed or missing input is
skipped, and every skip is a marked `swallow(...)` rather than a silence.

These bodies came from the Workflow-era `harvest_runs.py`, which detected runs
by an actual `Workflow` tool call. Fleet runs carry an `events.jsonl` instead,
so that harvester went — but these eight names outlived it, and they live here
now, public, with no detector attached."""
from __future__ import annotations

import functools
import json
import subprocess
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _outcome import swallow  # noqa: E402  (marks every deliberate skip)

SLICE_KEYWORDS = ("wave", "integrationbranch", "/ultrapowers", "gate",
                  "transcript dir", "recommended", "depends-on")
SLICE_TURN_MAX = 4000  # chars; a pasted-file user turn beyond this is elided


def block_text(block):
    """Flatten a content block's text (handles nested tool_result content)."""
    if not isinstance(block, dict):
        return ""
    t = block.get("text")
    if isinstance(t, str):
        return t
    c = block.get("content")
    if isinstance(c, str):
        return c
    if isinstance(c, list):
        return "\n".join(block_text(b) for b in c)
    return ""


def iter_blocks_indexed(records):
    """Yield `(index, record, block)` for every content block, including each
    record's position in `records` — needed wherever "later in the transcript"
    matters (the slice envelope's launch anchor and tail cut)."""
    for idx, r in enumerate(records):
        content = (r.get("message") or {}).get("content")
        if isinstance(content, str):
            # #137: short CLI prompts arrive as plain string content — the
            # API-equivalent of a single text block. Without this, the
            # operator's one-word acks are structurally invisible to every
            # consumer (the slicer dropped a salvage "yes", manufacturing a
            # false proceeded-without-ack observation).
            yield idx, r, {"type": "text", "text": content}
        elif isinstance(content, list):
            for b in content:
                yield idx, r, b


def records(session_path):
    out = []
    for line in Path(session_path).read_text().splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError as exc:
            swallow("unparseable transcript line skipped; the session still "
                    "reads", exc)
            continue
    return out


def _repo_root():
    return Path(__file__).resolve().parents[3]


def _to_dt(s):
    """Parse an ISO8601 string (with 'Z' or numeric offset) to a tz-aware
    datetime; None on failure. Needed because run timestamps are UTC 'Z' while
    git %cI carries a numeric offset — string compare across them is wrong."""
    if not isinstance(s, str):
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError as exc:
        swallow("timestamp will not parse; the row has no comparable date", exc)
        return None


@functools.lru_cache(maxsize=1)
def release_timeline():
    """(iso_datetime, version) pairs, oldest-first, from the repo's
    .claude-plugin/plugin.json history — the authoritative version-over-time map
    (handles the 0.x → 0.0.x reset because it is date-ordered, not semver).
    Advisory: returns () on any error (no git / not a repo)."""
    root = _repo_root()
    try:
        log = subprocess.run(
            ["git", "-C", str(root), "log", "--format=%H%x09%cI",
             "--", ".claude-plugin/plugin.json"],
            capture_output=True, text=True, timeout=30)
        if log.returncode != 0:
            return ()
        rows = []
        for line in log.stdout.splitlines():
            h, _, dt = line.partition("\t")
            if not h:
                continue
            show = subprocess.run(
                ["git", "-C", str(root), "show", f"{h}:.claude-plugin/plugin.json"],
                capture_output=True, text=True, timeout=30)
            if show.returncode != 0:
                continue
            try:
                ver = json.loads(show.stdout).get("version")
            except json.JSONDecodeError as exc:
                swallow("plugin.json is not JSON at this commit; the row has "
                        "no version", exc)
                ver = None
            if ver:
                rows.append((dt, ver))
        rows.sort()  # oldest-first by ISO date
        return collapse_timeline(rows)
    except (OSError, subprocess.SubprocessError) as exc:
        swallow("git will not walk the version history; report an empty "
                "timeline", exc)
        return ()


def collapse_timeline(rows):
    """Collapse CONSECUTIVE runs of one version, keeping the first of each run.

    Not a global uniquify: this repo shipped 0.3.0 on 2026-06-10 and again at
    the One Driver cutover on 2026-08-29, and keeping only the first appearance
    discarded the cutover — dating every post-0.3.0 run to 0.2.26, the wrong
    era, on the field the ledger uses to tell eras apart."""
    timeline, last = [], None
    for dt, ver in rows:
        if ver != last:
            timeline.append((dt, ver))
            last = ver
    return tuple(timeline)


def engine_epoch_at(ts, origin, timeline=None, cache_version=None):
    """Resolve {epoch, asOf, basis} for a run from a bare timestamp.

    A fleet run has no transcript to date itself from; its `run:open` event
    carries the clock. `origin` is "home" or "foreign": home dates against the
    repo's own release timeline, foreign treats that date as an upper bound.
    A foreign run whose plugin cache path names a version prefers it, in which
    case foreign returns it with basis "plugin-cache-path". Home ignores
    `cache_version` so the home ledger baseline keeps its date semantics.
    `epoch` is None if unknown."""
    if timeline is None:
        timeline = release_timeline()
    if cache_version and origin == "foreign":
        return {"epoch": cache_version, "asOf": ts, "basis": "plugin-cache-path"}
    basis = "home-repo-date" if origin == "home" else "foreign-date-upper-bound"
    run_dt = _to_dt(ts)
    if run_dt is None or not timeline:
        return {"epoch": None, "asOf": ts, "basis": basis if run_dt else "unknown"}
    epoch = None
    for dt, ver in timeline:              # oldest-first
        rel_dt = _to_dt(dt)
        if rel_dt is None:
            continue
        if rel_dt <= run_dt:
            epoch = ver
        else:
            break
    return {"epoch": epoch, "asOf": ts, "basis": basis}
