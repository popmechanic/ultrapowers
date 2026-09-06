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
import _readers  # noqa: E402  (provides records()/iter_blocks_indexed())
from _outcome import swallow  # noqa: E402  (marks every deliberate skip)

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

# The only `tool_use` input keys a slice ever shows: path-shaped scalars, the
# part a lens reads a tool call for. Everything else is file contents by another
# name — `Write`'s `content`, `Edit`'s `new_string`, `Task`'s `prompt` — and the
# patches already carry the files. The restriction is on the RENDERING, so a
# live, unreduced transcript under `projects/` is as safe to slice as a reduced
# one off the evidence branch.
TOOL_USE_INPUT_KEYS = ("file_path", "path", "command", "pattern", "glob",
                       "description")


def _elide(text, budget):
    """Head-and-tail elision with an explicit marker, or `text` if it fits."""
    if len(text) <= budget:
        return text
    head = budget * 2 // 3
    tail = budget - head
    return (text[:head] + f"\n\n…[elided {len(text) - head - tail} chars]…\n\n"
            + text[-tail:])


def _session_of(path):
    """The `sessionId` the first record naming one carries, or None.

    A transcript file is one session, so the first record that names one names
    the file. Advisory like everything else here: an unreadable or unparseable
    file is simply not a match.
    """
    try:
        with Path(path).open(encoding="utf-8", errors="replace") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                except ValueError as exc:
                    swallow("an unparseable line does not name a session; the "
                            "next line still can", exc)
                    continue
                if isinstance(rec, dict) and isinstance(rec.get("sessionId"), str):
                    return rec["sessionId"]
    except OSError as exc:
        swallow("unreadable transcript is simply not a match", exc)
    return None


def find_transcript(projects_root, session_id, run_dir=None):
    """`<run_dir>/transcripts/<session_id>.jsonl` when it is there, else the
    first `<projects_root>/*/<session_id>.jsonl`, else the `transcripts/` file
    whose records carry `session_id`, else None.

    The run dir comes first because a HARVESTED run directory has only what the
    evidence branch carried — the reduced slices under `transcripts/`, and no
    `claude/projects/` at all — while a local sandbox-logs tarball has both, and
    there the two are the same session, one of them already reduced.

    The last rule is the name-free one: the engine names each slice for its
    session, but a name is a convention and the `sessionId` inside the file is
    the fact. A committed slice a lens cannot find reads exactly like a slice
    that was never committed, which is the failure this whole path exists to
    end.
    """
    if run_dir is not None and session_id:
        sliced = Path(run_dir) / "transcripts" / f"{session_id}.jsonl"
        if sliced.is_file():
            return sliced
    try:
        found = next(Path(projects_root).glob(f"*/{session_id}.jsonl"), None)
    except OSError as exc:
        swallow("transcript search failed; this worker's slice carries no "
                "transcript", exc)
        print(f"fleet_slice: cannot search {projects_root}: {exc}", file=sys.stderr)
        found = None
    if found is not None or run_dir is None or not session_id:
        return found
    try:
        candidates = sorted(Path(run_dir).glob("transcripts/*.jsonl"))
    except OSError as exc:
        swallow("transcript search failed; this worker's slice carries no "
                "transcript", exc)
        print(f"fleet_slice: cannot search {run_dir}: {exc}", file=sys.stderr)
        return None
    for path in candidates:
        if _session_of(path) == session_id:
            return path
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
        swallow("envelope search failed; the slice renders without envelopes", exc)
        print(f"fleet_slice: cannot search {root} for envelopes: {exc}",
              file=sys.stderr)
        return None
    fallback = None
    for path in candidates:
        try:
            payload = json.loads(path.read_text())
        except (OSError, ValueError) as exc:
            swallow("unreadable envelope skipped; the other workers' "
                    "envelopes still render", exc)
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


def _tool_use_line(block):
    """One `tool_use` block as `**tool_use:** <name> <kept input>`.

    `block_text` returns "" for a tool_use block — it has no `text` and no
    `content` — so without this a slice showed a worker's prose and its tool
    RESULTS and never what it actually called. `kept` is the six-key
    projection: the call, never its payload.
    """
    src = block.get("input")
    src = src if isinstance(src, dict) else {}
    kept = {k: src[k] for k in TOOL_USE_INPUT_KEYS if k in src}
    return f"**tool_use:** {block.get('name')} {json.dumps(kept, sort_keys=True)}"


def _worker_lines(records):
    """Transcript blocks a fleet lens needs, in order.

    NOT the Workflow-era `slice_transcript`. That function's `SLICE_KEYWORDS` gate
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
    for _idx, record, block in _readers.iter_blocks_indexed(records):
        rtype = record.get("type")
        if isinstance(block, dict) and block.get("type") == "tool_use":
            lines.append(_tool_use_line(block))
            continue
        txt = _readers.block_text(block).strip()
        if not txt:
            continue
        btype = block.get("type")
        if btype == "text" and rtype in ("user", "assistant"):
            if len(txt) > _readers.SLICE_TURN_MAX:
                txt = (txt[:_readers.SLICE_TURN_MAX]
                       + f"\n…[truncated {len(txt) - _readers.SLICE_TURN_MAX} chars]")
            lines.append(f"**{rtype}:** {txt}")
        elif any(k in txt.lower() for k in _readers.SLICE_KEYWORDS):
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
    #   - `records()` reads strict UTF-8, so a transcript still streaming to disk
    #     whose tail ends mid-multibyte raises UnicodeDecodeError (a ValueError);
    #   - `records()` filters unparseable lines but not non-dict values, and
    #     `_worker_lines` calls `.get()` on each record -> AttributeError.
    # The advisory contract says skip with a diagnostic, never traceback.
    try:
        records = _readers.records(transcript_path)
        text = _worker_lines(records)
    except (OSError, ValueError, AttributeError, TypeError) as exc:
        swallow("unreadable transcript yields an empty slice, never a "
                "traceback", exc)
        print(f"fleet_slice: cannot read {transcript_path}: {exc}", file=sys.stderr)
        return ""
    return _elide(text, budget)


def build_slice(timeline_md, workers, projects_root, budget=WORKER_BUDGET,
                workers_root=None, envelope_budget=ENVELOPE_BUDGET, run_dir=None):
    """One markdown bundle: the event timeline, then a section per worker.

    `workers` is a list of plain dicts carrying at least `label`, `role` and
    `sessionId` — the builder never parses an event log itself. `workers_root`
    is the run dir's `workers/`; when given, each section also carries that
    worker's envelope. It is optional so a caller with transcripts alone still
    builds a slice. `run_dir`, likewise optional, is the run directory whose
    `transcripts/` a harvested run carries its slices in — see
    `find_transcript`.
    """
    sections = [f"## Event timeline\n\n```\n{timeline_md}\n```"]
    for w in workers:
        label = w.get("label")
        role = w.get("role")
        session_id = w.get("sessionId")
        path = find_transcript(projects_root, session_id, run_dir=run_dir)
        body = worker_slice(path, budget=budget) if path is not None else ""
        if not body:
            body = "_no transcript found_"
        env = envelope_section(find_envelope(workers_root, session_id, label),
                               budget=envelope_budget)
        if env:
            body = f"{env}\n\n{body}"
        sections.append(f"## {label} ({role}, session {session_id})\n\n{body}")
    return "\n\n".join(sections)
