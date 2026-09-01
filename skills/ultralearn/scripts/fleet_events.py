#!/usr/bin/env python3
"""ultralearn event-log reader — parse a fleet run's `events.jsonl`, summarize
it into the bundle's `events` field, and render it as a flat timeline.
Read-only and advisory: malformed or missing input is skipped with a
diagnostic, never raised.

Events sort by `id`, never by `ts`. `fleet/run-waves.mjs:272-284` stamps both
from one `Date.now()`; when the monotonic clamp fires on a backwards clock step
"the id stays the sort key, ts stays the wall clock"."""
from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _outcome import swallow  # noqa: E402  (marks every deliberate skip)

# The engine's emitted vocabulary, read off the sources that emit it:
# fleet/run-worker.mjs:468-552, fleet/run-main.mjs:358-548,
# fleet/run-waves.mjs:215-293. An unlisted kind still parses and still renders
# — this set names what is known, it does not filter.
EVENT_KINDS = frozenset({
    "run:open", "engine:log", "engine:phase", "worker:start", "worker:end",
    "worker:refused", "run:fatal", "capture:error", "driver:stage",
    "driver:fail", "driver:auth", "driver:ack-decision", "driver:approved"})

SUMMARY_MAX = 200  # chars of per-event summary in the rendered timeline

# Every worker record carries every key, so consumers never KeyError on a run
# that was cut off mid-wave.
_WORKER_FIELDS = ("role", "sessionId", "cwd", "model", "startId", "startTs",
                  "endId", "endTs", "exitCode", "timedOut", "outcome", "class",
                  "status", "meter", "wallSec", "refused", "refusedDetail")


def _warn(message):
    print("fleet_events: " + message, file=sys.stderr)


def read_events(run_dir):
    """Parse the run directory's `events.jsonl` into records sorted by `id`.

    A missing or unreadable log is an empty list; an unparseable line is
    skipped with a diagnostic. Neither raises."""
    path = Path(run_dir) / "events.jsonl"
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        swallow("event log unreadable; the run keeps its other fields", exc)
        _warn("unreadable event log %s (%s)" % (path, exc))
        return []
    records = []
    for lineno, line in enumerate(text.splitlines(), start=1):
        if not line.strip():
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError as exc:
            swallow("malformed event line skipped; the rest of the log still "
                    "parses", exc)
            _warn("skipping %s:%d — %s" % (path, lineno, exc))
            continue
        if not isinstance(record, dict):
            _warn("skipping %s:%d — not an object" % (path, lineno))
            continue
        records.append(record)
    return sorted(records, key=lambda e: str(e.get("id") or ""))


def _first(events, kind):
    for e in events:
        if e.get("kind") == kind:
            return e
    return None


def _last(events, kinds):
    found = None
    for e in events:
        if e.get("kind") in kinds:
            found = e
    return found


def _wall_sec(start_ts, end_ts):
    if isinstance(start_ts, (int, float)) and isinstance(end_ts, (int, float)):
        return round((end_ts - start_ts) / 1000, 1)
    return None


def _opened_at(events, opened):
    if opened is not None:
        return opened.get("ts")
    return events[0].get("ts") if events else None


def summarize_events(events):
    """The bundle's `events` field: one deterministic dict per run."""
    events = list(events or [])
    counts = Counter(str(e.get("kind")) for e in events)

    opened = _first(events, "run:open")
    opened_at = _opened_at(events, opened)
    ended_at = events[-1].get("ts") if events else None

    # A retry REUSES its label (`fleet/run-worker.mjs`: only the on-disk worker
    # directory is per-dispatch), so one log can carry two start/end pairs under
    # one label. Keying solely on the label overwrote the first attempt — losing
    # the failed try, and mixing attempt 2's startTs with attempt 1's endTs into
    # a NEGATIVE wallSec that `unpaired` did not flag. Keep every attempt.
    attempts = []                       # every attempt, in first-seen order
    open_by_label = {}                  # label -> the attempt still accepting events

    def worker(label, new_attempt=False):
        key = str(label)
        cur = open_by_label.get(key)
        if cur is None or new_attempt:
            cur = dict({"label": key, "attempt": len(
                [a for a in attempts if a["label"] == key])},
                **{f: None for f in _WORKER_FIELDS})
            attempts.append(cur)
            open_by_label[key] = cur
        return cur

    phases, stages, fatals = [], [], []
    auth_method = None
    for e in events:
        kind = e.get("kind")
        if kind == "engine:phase":
            phases.append({"phase": e.get("phase"), "detail": e.get("detail"),
                           "id": e.get("id"), "ts": e.get("ts")})
        elif kind == "driver:stage":
            stages.append({"stage": e.get("stage"), "detail": e.get("detail"),
                           "id": e.get("id"), "ts": e.get("ts")})
        elif kind == "driver:auth":
            if auth_method is None and e.get("authMethod") is not None:
                auth_method = e.get("authMethod")
        elif kind == "worker:start":
            prev = open_by_label.get(str(e.get("label")))
            w = worker(e.get("label"), new_attempt=prev is not None and prev["startId"])
            w.update(role=e.get("role"), sessionId=e.get("sessionId"),
                     cwd=e.get("cwd"), model=e.get("model"),
                     startId=e.get("id"), startTs=e.get("ts"))
        elif kind == "worker:end":
            prev = open_by_label.get(str(e.get("label")))
            w = worker(e.get("label"), new_attempt=prev is not None and prev["endId"])
            w.update(endId=e.get("id"), endTs=e.get("ts"),
                     exitCode=e.get("exitCode"), timedOut=e.get("timedOut"),
                     outcome=e.get("outcome"), status=e.get("status"),
                     meter=e.get("meter"))
            w["class"] = e.get("class")
            w["wallSec"] = _wall_sec(w["startTs"], e.get("ts"))
            # A worker:end without its start (log truncated at the head) still
            # names its role and session; take them rather than lose them.
            if w["role"] is None:
                w["role"] = e.get("role")
            if w["sessionId"] is None:
                w["sessionId"] = e.get("sessionId")
        elif kind == "worker:refused":
            w = worker(e.get("label"))
            w.update(refused=e.get("why"), refusedDetail=e.get("detail"))
        elif kind in ("run:fatal", "capture:error"):
            fatals.append(e)

    return {
        "runId": opened.get("runId") if opened else None,
        "base": opened.get("base") if opened else None,
        "source": opened.get("source") if opened else None,
        "openedAt": opened_at,
        "endedAt": ended_at,
        "wallSec": _wall_sec(opened_at, ended_at),
        "authMethod": auth_method,
        "eventCount": len(events),
        "counts": dict(sorted(counts.items())),
        "phases": phases,
        "stages": stages,
        "workers": attempts,
        "unpaired": [w["label"] for w in attempts
                     if w["startId"] and not w["endId"]],
        "fatals": fatals,
        "ackDecision": _last(events, ("driver:ack-decision",)),
        "terminal": _last(events, ("driver:approved", "driver:fail")),
    }


def _joined(*parts):
    return " ".join(str(p) for p in parts if p not in (None, ""))


def _dashed(head, detail):
    return "%s — %s" % (head, detail) if detail not in (None, "") else str(head or "")


def _summarize_one(event):
    kind = event.get("kind")
    if kind == "run:open":
        return "runId=%s" % event.get("runId")
    if kind == "driver:stage":
        return _dashed(event.get("stage"), event.get("detail"))
    if kind == "driver:auth":
        if event.get("authMethod") is not None:
            return "authMethod=%s" % event.get("authMethod")
        return str(event.get("detail") or "")
    if kind == "driver:ack-decision":
        return _joined("approve=%s" % event.get("approve"), event.get("reason"))
    if kind == "driver:approved":
        return "stamp=%s branch=%s" % (event.get("stamp"),
                                       event.get("integrationBranch"))
    if kind == "driver:fail":
        return _dashed(event.get("verdict"), event.get("detail"))
    if kind == "engine:phase":
        return str(event.get("phase") or "")
    if kind == "engine:log":
        return str(event.get("line") or "")
    if kind == "worker:start":
        return "%s role=%s model=%s session=%s" % (
            event.get("label"), event.get("role"), event.get("model"),
            event.get("sessionId"))
    if kind == "worker:end":
        meter = event.get("meter") or {}
        return "%s class=%s exit=%s out=%stok cost=$%s" % (
            event.get("label"), event.get("class"), event.get("exitCode"),
            meter.get("output"), meter.get("costUsd"))
    if kind == "worker:refused":
        return _joined(event.get("label"), "why=%s" % event.get("why"),
                       event.get("detail"))
    if kind in ("run:fatal", "capture:error"):
        return _joined(event.get("label"), event.get("detail"))
    # An unrecognized kind is still evidence: render the record itself rather
    # than dropping the line.
    rest = {k: v for k, v in event.items() if k not in ("kind", "id", "ts")}
    return json.dumps(rest)


def render_timeline(events):
    """One line per event: id, seconds since run:open, kind, one-line summary."""
    events = list(events or [])
    opened_at = _opened_at(events, _first(events, "run:open"))
    lines = []
    for e in events:
        ts = e.get("ts")
        rel = ((ts - opened_at) / 1000
               if isinstance(ts, (int, float)) and isinstance(opened_at, (int, float))
               else 0.0)
        summary = _summarize_one(e)
        if len(summary) > SUMMARY_MAX:
            summary = summary[:SUMMARY_MAX - 1] + "…"
        lines.append("%s  +%.1fs  %s  %s" % (e.get("id"), rel, e.get("kind"), summary))
    return "\n".join(lines)


if __name__ == "__main__":
    for run_dir in sys.argv[1:] or ["."]:
        print(render_timeline(read_events(run_dir)))
