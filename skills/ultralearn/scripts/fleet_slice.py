#!/usr/bin/env python3
"""Per-worker slice builder for fleet runs — assemble one budgeted markdown
bundle from an event timeline plus each worker's transcript. Read-only and
advisory: malformed or missing input is skipped with a diagnostic, never
raised."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import harvest_runs  # noqa: E402  (provides _records()/slice_transcript())

# A run's 14 worker transcripts sliced whole totalled 564,293 chars on run-30
# (~140k tokens) — past what one reader carries, and there are eight runs. At
# 12,000 chars/worker a run lands near 160k chars (~40k tokens). Head 8,000 +
# tail 4,000: the brief is at the top, the conclusion at the bottom, and the
# middle is the part a lens least often needs.
WORKER_BUDGET: int = 12000


def find_transcript(projects_root, session_id):
    """First `<projects_root>/*/<session_id>.jsonl`, else None."""
    try:
        return next(Path(projects_root).glob(f"*/{session_id}.jsonl"))
    except StopIteration:
        return None
    except OSError as exc:
        print(f"fleet_slice: cannot search {projects_root}: {exc}", file=sys.stderr)
        return None


def worker_slice(transcript_path, budget=WORKER_BUDGET):
    """`slice_transcript` of one worker session, elided to `budget` chars.

    No `terminus` — the approved-tail extension is a Workflow-session concept.
    An unreadable transcript yields "" plus a stderr diagnostic.
    """
    # Wider than OSError, and `slice_transcript` is INSIDE the guard:
    #   - `_records` reads strict UTF-8, so a transcript still streaming to disk
    #     whose tail ends mid-multibyte raises UnicodeDecodeError (a ValueError);
    #   - `_records` filters unparseable lines but not non-dict values, and
    #     `slice_transcript` calls `.get()` on each record -> AttributeError.
    # The advisory contract says skip with a diagnostic, never traceback.
    try:
        records = harvest_runs._records(transcript_path)
        text = harvest_runs.slice_transcript(records)
    except (OSError, ValueError, AttributeError, TypeError) as exc:
        print(f"fleet_slice: cannot read {transcript_path}: {exc}", file=sys.stderr)
        return ""
    if len(text) <= budget:
        return text
    head = budget * 2 // 3
    tail = budget - head
    elided = len(text) - head - tail
    return text[:head] + f"\n\n…[elided {elided} chars]…\n\n" + text[-tail:]


def build_slice(timeline_md, workers, projects_root, budget=WORKER_BUDGET):
    """One markdown bundle: the event timeline, then a section per worker.

    `workers` is a list of plain dicts carrying at least `label`, `role` and
    `sessionId` — the builder never parses an event log itself.
    """
    sections = [f"## Event timeline\n\n```\n{timeline_md}\n```"]
    for w in workers:
        label = w.get("label")
        role = w.get("role")
        session_id = w.get("sessionId")
        path = find_transcript(projects_root, session_id)
        body = worker_slice(path, budget=budget) if path is not None else ""
        if not body:
            body = "_no transcript found_"
        sections.append(f"## {label} ({role}, session {session_id})\n\n{body}")
    return "\n\n".join(sections)
