#!/usr/bin/env python3
"""Parse, serialize, and lifecycle-transition docket.md entries.

The single source of truth for the docket format. Fail loud on malformed
entries — a dropped issue is silently lost work. Spec:
docs/superpowers/specs/2026-06-12-docket-design.md
"""
import dataclasses
import re

LIFECYCLE = ["triaged", "accepted", "planned", "queued", "executed", "verified"]
TERMINAL = {"verified", "parked"}


class DocketError(Exception):
    pass


@dataclasses.dataclass
class Entry:
    issue: str
    title: str
    state: str
    score: str
    est_files: list
    plan: str = None
    seal: str = None


_HEAD = re.compile(r"^###\s+#(\d+):\s+(.*?)\s*$")
_FIELD = re.compile(r"^\*\*(State|Score|Est-files|Plan|Seal):\*\*\s*(.*?)\s*$")


def parse_docket(text):
    entries = []
    seen = set()
    cur = None
    fields = {}

    def flush():
        if cur is None:
            return
        if "State" not in fields or "Score" not in fields:
            raise DocketError(f"issue #{cur[0]} missing State or Score")
        if not re.match(r"^\s*\d+(\.\d+)?(\s|$)", fields["Score"]):
            raise DocketError(f"issue #{cur[0]} has a non-numeric Score: {fields['Score']!r}")
        if cur[0] in seen:
            raise DocketError(f"duplicate issue #{cur[0]} in docket")
        seen.add(cur[0])
        est = [s.strip() for s in fields.get("Est-files", "").split(",") if s.strip()]
        entries.append(Entry(issue=cur[0], title=cur[1], state=fields["State"],
                             score=fields["Score"], est_files=est,
                             plan=fields.get("Plan") or None, seal=fields.get("Seal") or None))

    for line in text.splitlines():
        if line.startswith("### "):
            flush()
            h = _HEAD.match(line)
            if not h:
                raise DocketError(f"malformed issue header (expected '### #<n>: <title>'): {line!r}")
            title = h.group(2).strip()
            if not title:
                raise DocketError(f"issue #{h.group(1)} has an empty title")
            cur, fields = (h.group(1), title), {}
            continue
        f = _FIELD.match(line)
        if f and cur is not None:
            fields[f.group(1)] = f.group(2)
    flush()
    return entries


def serialize_docket(entries):
    out = ["# Docket", ""]
    for e in entries:
        out.append(f"### #{e.issue}: {e.title}")
        out.append(f"**State:** {e.state}")
        out.append(f"**Score:** {e.score}")
        out.append(f"**Est-files:** {', '.join(e.est_files)}")
        if e.plan:
            out.append(f"**Plan:** {e.plan}")
        if e.seal:
            out.append(f"**Seal:** {e.seal}")
        out.append("")
    return "\n".join(out)


def transition(entry, new_state):
    if new_state == "parked":
        if entry.state in TERMINAL:
            raise DocketError(f"#{entry.issue}: cannot park from terminal {entry.state}")
        return dataclasses.replace(entry, state="parked")
    if entry.state not in LIFECYCLE or new_state not in LIFECYCLE:
        raise DocketError(f"#{entry.issue}: unknown state {entry.state}->{new_state}")
    if LIFECYCLE.index(new_state) != LIFECYCLE.index(entry.state) + 1:
        raise DocketError(f"#{entry.issue}: illegal {entry.state}->{new_state} (must advance one step)")
    return dataclasses.replace(entry, state=new_state)
