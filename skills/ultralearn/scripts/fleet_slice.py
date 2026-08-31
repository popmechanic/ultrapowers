#!/usr/bin/env python3
"""Per-worker slice builder for fleet runs — assemble one budgeted markdown
bundle from an event timeline plus each worker's transcript and envelope.
Read-only and advisory: malformed or missing input is skipped with a
diagnostic, never raised."""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import harvest_runs  # noqa: E402  (provides _records()/_iter_blocks_indexed())

# A run's 14 worker transcripts sliced whole totalled 564,293 chars on run-30
# (~140k tokens) — past what one reader carries, and there are eight runs. At
# 12,000 chars/worker a run lands near 160k chars (~40k tokens). Head 8,000 +
# tail 4,000: the brief is at the top, the conclusion at the bottom, and the
# middle is the part a lens least often needs.
WORKER_BUDGET: int = 12000

# The envelope is small and dense: across run-32's 14 workers the chosen field
# (structured_output, else result) totals ~54,000 chars — a third of the
# transcript budget for the part a lens actually wants. 6,000 keeps the
# integration critic's 12.7k verdict readable head-and-tail while capping the
# outlier.
ENVELOPE_BUDGET: int = 6000

# Envelope scalars worth a line each. `permission_denials` and the verdict are
# handled separately; everything else here is one-line context for the cost and
# friction lenses.
ENVELOPE_SCALARS = ("stop_reason", "num_turns", "is_error", "subtype",
                    "terminal_reason", "total_cost_usd", "duration_ms")


def _elide(text, budget):
    """Head-and-tail elision with an explicit marker, or `text` if it fits."""
    if len(text) <= budget:
        return text
    head = budget * 2 // 3
    tail = budget - head
    return (text[:head] + f"\n\n…[elided {len(text) - head - tail} chars]…\n\n"
            + text[-tail:])


def find_transcript(projects_root, session_id):
    """First `<projects_root>/*/<session_id>.jsonl`, else None."""
    try:
        return next(Path(projects_root).glob(f"*/{session_id}.jsonl"))
    except StopIteration:
        return None
    except OSError as exc:
        print(f"fleet_slice: cannot search {projects_root}: {exc}", file=sys.stderr)
        return None


def find_envelope(workers_root, session_id, label=None):
    """The `envelope.json` under `workers_root` whose `session_id` matches.

    Session id is the join, not the directory name: the driver names a worker
    dir per DISPATCH (`run-worker.mjs`), so a retried label owns two dirs and
    only the session distinguishes them. `label` is a fallback for envelopes
    written without a session id — the dir is the label with `:` -> `_`.
    """
    if workers_root is None:
        return None
    root = Path(workers_root)
    try:
        candidates = sorted(root.glob("*/envelope.json"))
    except OSError as exc:
        print(f"fleet_slice: cannot search {root} for envelopes: {exc}",
              file=sys.stderr)
        return None
    fallback = None
    for path in candidates:
        try:
            payload = json.loads(path.read_text())
        except (OSError, ValueError) as exc:
            print(f"fleet_slice: cannot read envelope {path}: {exc}",
                  file=sys.stderr)
            continue
        if not isinstance(payload, dict):
            print(f"fleet_slice: envelope {path} is not an object", file=sys.stderr)
            continue
        if session_id and payload.get("session_id") == session_id:
            return payload
        if label and path.parent.name == label.replace(":", "_"):
            fallback = payload
    return fallback


def envelope_section(envelope, budget=ENVELOPE_BUDGET):
    """The worker's own output, rendered for a reader — or "" if there is none.

    #415: the verdict does not live in a transcript text block. An implementer's
    `concerns` and a reviewer's findings are the process's STRUCTURED result, and
    `permission_denials` is the honest denial record — run-32's 14 envelopes
    carried 20 denials where `confine-denials.jsonl` recorded 3, because the
    hook's ledger only sees what the hook itself refused.
    """
    if not isinstance(envelope, dict):
        return ""
    lines = []
    scalars = [f"{k}={envelope[k]!r}" for k in ENVELOPE_SCALARS if k in envelope]
    if scalars:
        lines.append("  ".join(scalars))
    # structured_output is the parsed form of result; carrying both doubles the
    # cost for nothing (run-32: 107,745 chars combined, ~half redundant).
    verdict = envelope.get("structured_output")
    if verdict is not None:
        rendered = json.dumps(verdict, indent=1, sort_keys=True, default=str)
    else:
        rendered = envelope.get("result")
        rendered = rendered if isinstance(rendered, str) else None
    if rendered:
        lines.append(_elide(rendered, budget))
    denials = envelope.get("permission_denials")
    if denials:
        lines.append("permission_denials: "
                     + _elide(json.dumps(denials, default=str), budget))
    if not lines:
        return ""
    return "**envelope:**\n\n```\n" + "\n\n".join(lines) + "\n```"


def _worker_lines(records):
    """Transcript blocks a fleet lens needs, in order.

    NOT `harvest_runs.slice_transcript`. That function's `SLICE_KEYWORDS` gate
    was written for the single LLM-orchestrator transcript, where 'wave'/'gate'/
    'integrationBranch' mark the interesting turns. Against a WORKER transcript
    it selects almost at random and drops every assistant turn: across fleet
    runs 24-32 the nine slices carried 0,6,0,0,1,0,1,0,0 assistant blocks for 77
    workers. Assistant prose is where a worker says it changed course, and it is
    cheap — run-32's 14 transcripts hold 13,213 chars of it against 870,591
    chars of tool_result. So: user text and assistant text whole, tool_result
    still keyword-gated (it is the bulk, and the patches already carry the
    files).
    """
    lines = []
    for _idx, record, block in harvest_runs._iter_blocks_indexed(records):
        rtype = record.get("type")
        txt = harvest_runs._block_text(block).strip()
        if not txt:
            continue
        btype = block.get("type")
        if btype == "text" and rtype in ("user", "assistant"):
            if len(txt) > harvest_runs.SLICE_TURN_MAX:
                txt = (txt[:harvest_runs.SLICE_TURN_MAX]
                       + f"\n…[truncated {len(txt) - harvest_runs.SLICE_TURN_MAX} chars]")
            lines.append(f"**{rtype}:** {txt}")
        elif any(k in txt.lower() for k in harvest_runs.SLICE_KEYWORDS):
            # #137: tool_result blocks ride user-TYPE records — label them by
            # block type so machine output is never attributed to the human.
            label = "tool_result" if btype == "tool_result" else rtype
            lines.append(f"**{label}:** {txt}")
    return "\n\n".join(lines)


def worker_slice(transcript_path, budget=WORKER_BUDGET):
    """One worker session's transcript, elided to `budget` chars.

    No `terminus` — the approved-tail extension is a Workflow-session concept.
    An unreadable transcript yields "" plus a stderr diagnostic.
    """
    # Wider than OSError, and the slicing is INSIDE the guard:
    #   - `_records` reads strict UTF-8, so a transcript still streaming to disk
    #     whose tail ends mid-multibyte raises UnicodeDecodeError (a ValueError);
    #   - `_records` filters unparseable lines but not non-dict values, and
    #     `_worker_lines` calls `.get()` on each record -> AttributeError.
    # The advisory contract says skip with a diagnostic, never traceback.
    try:
        records = harvest_runs._records(transcript_path)
        text = _worker_lines(records)
    except (OSError, ValueError, AttributeError, TypeError) as exc:
        print(f"fleet_slice: cannot read {transcript_path}: {exc}", file=sys.stderr)
        return ""
    return _elide(text, budget)


def build_slice(timeline_md, workers, projects_root, budget=WORKER_BUDGET,
                workers_root=None, envelope_budget=ENVELOPE_BUDGET):
    """One markdown bundle: the event timeline, then a section per worker.

    `workers` is a list of plain dicts carrying at least `label`, `role` and
    `sessionId` — the builder never parses an event log itself. `workers_root`
    is the run dir's `workers/`; when given, each section also carries that
    worker's envelope. It is optional so a caller with transcripts alone still
    builds a slice.
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
        env = envelope_section(find_envelope(workers_root, session_id, label),
                               budget=envelope_budget)
        if env:
            body = f"{env}\n\n{body}"
        sections.append(f"## {label} ({role}, session {session_id})\n\n{body}")
    return "\n\n".join(sections)
