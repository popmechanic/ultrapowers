#!/usr/bin/env python3
"""Deterministic compiler for Superpowers plans carrying ultraplan markers.

Parses a plan into tasks (fence-aware), classifies each per the plan-markers
contract (explicit **Type:** trusted; heuristics otherwise, flagged
"heuristic": true), builds the dependency DAG (marker edges + file-overlap
inference + read-after-write + prose-reference + write-after-write whose
overlap set covers writes union Test: paths + ambiguous-files serialization +
explicit text, with explicit/semantic edges taking precedence so
document-order heuristics yield by reachability to any opposing earlier
path), runs Kahn layering with cycle detection, and emits the Step-3
transparency block as JSON on stdout.

The orchestrating agent runs this instead of hand-deriving waves; its
judgment is reserved for heuristic-flagged classifications and the derived
run knobs (testCmd / baseBranch / tiers / review depth), which stay with
the agent per dependency-analysis.md.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

TASK_HEAD = re.compile(r"^### Task ([A-Za-z0-9]+):\s*(.*)$")
FENCE = re.compile(r"^(`{3,}|~{3,})")
MARKER_TYPE = re.compile(r"^\*\*Type:\*\*\s*([a-z]+)\s*$")
# Marker-shaped: bold-prefixed type/depends-on label in ANY colon position —
# `**Type:**`, `**type:**`, `**Type :**`, and the colon-outside form `**Type**:`
# all count, so a near-miss never silently degrades to prose.
MARKER_ISH = re.compile(r"^\*\*\s*(type|depends[-\s]on)\s*(?:\*\*)?\s*:", re.I)
MARKER_DEPS = re.compile(r"^\*\*Depends-on:\*\*\s*(.+?)\s*$")
FILE_LINE = re.compile(r"^-\s*(Create|Modify|Test):\s*(.+)$")
# Files-entry near-misses (`- Modify : x`, `- create: x`, `* Modify: x`) inside an open Files
# block would otherwise drop silently — losing a write path and with it the
# overlap edge that prevents a same-wave write race.
FILE_ISH = re.compile(r"^[-*+]\s*(create|modify|test)\s*:", re.I)
FILES_ISH = re.compile(r"^\*\*\s*files\s*(?:\*\*)?\s*:", re.I)
PATH_RE = re.compile(r"`([^`]+)`")
TEXT_DEP = re.compile(r"(?:depends\s+on|after|requires)[\s:*]+Task\s+([A-Za-z0-9]+)", re.I)
# Plural conjunction/comma lists ("depends on Tasks 1 and 3", "after Tasks
# 1, 2 and 3") parse into one text edge per listed id. A `Tasks` mention the
# list regex cannot parse (e.g. "after Tasks above") still surfaces as a
# conflict so ordering intent is never silently lost.
TEXT_DEP_LIST = re.compile(
    r"(?:depends\s+on|after|requires)[\s:*]+Tasks\s+"
    r"((?:[A-Za-z0-9]+)(?:\s*(?:,|and|&)\s*[A-Za-z0-9]+)*)", re.I)
LIST_SPLIT = re.compile(r"\s*(?:,|\band\b|&)\s*", re.I)
# Plural prose that does NOT form a parseable id list — surface it so the
# author can fix the ordering intent instead of losing it silently.
TEXT_DEP_PLURAL = re.compile(r"(?:depends\s+on|after|requires)[\s:*]+Tasks\b", re.I)
GLOB_CHARS = re.compile(r"[*?\[{]")
# Whether a Files-entry token names a file, vs a bare identifier (function name),
# a dotted attribute reference (`schema.User`), or a route. Files entries are
# declared to list paths, so the rule keeps real paths and rejects identifier-
# shaped tokens; admitting an identifier as a write fabricates spurious
# write-after-write overlap between unrelated tasks.
EXT_RE = re.compile(r"\.[a-z0-9]{1,8}$")  # real extensions are lowercase/digits


def _is_pathlike(tok):
    t = tok.strip().rstrip(",;").split(":", 1)[0].strip()  # drop a :line-range
    if not t:
        return False
    if "/" in t:
        return True                       # a relative/absolute path
    if EXT_RE.search(t):
        return True                       # a filename with a lowercase extension
    # A bare extensionless filename by convention is Capitalized or ALL-CAPS with
    # no dot and no underscore (Makefile, Dockerfile, LICENSE, README, Jenkinsfile)
    # — distinct from snake_case identifiers (cmd_apply_create, _build_parser) and
    # dotted attribute refs (schema.User, Foo.Bar), which are dropped.
    if "." not in t and "_" not in t and t[:1].isalpha() and (t[0].isupper() or t.isupper()):
        return True
    return False


def _nonpath_near_miss(line, dropped):
    """Single source for the 'non-path token(s) ignored' Files diagnostic so the
    inline-header and bulleted branches surface dropped identifiers identically."""
    return (line + "  <non-path token(s) ignored (" + ", ".join(dropped[:3])
            + ") — Files entries list paths, not identifiers like function names>")


def match_head(line):
    """The single source of truth for task headings: TASK_HEAD on the
    stripped text, accepting CommonMark's up-to-3 leading spaces. Used by
    BOTH split_tasks and the malformed-heading net so a heading can never
    pass one and fail the other (a raw/stripped mismatch silently folded
    indented tasks into their predecessor)."""
    if len(line) - len(line.lstrip(" ")) > 3:
        return None
    return TASK_HEAD.match(line.strip())

TYPES = ("implementation", "gate", "release", "manual")
RELEASE_EV = re.compile(
    r"(git push|git checkout main|git merge (?:main|master)\b|\bssh\b|\bscp\b"
    r"|systemctl|after the branch merges)", re.I)
MANUAL_EV = re.compile(
    r"(the owner runs|cannot be done from this machine|on the deployment)", re.I)
GATE_EV = re.compile(
    r"(pytest|npm test|bun test|cargo test|go test|ruff|eslint|git status|git log)", re.I)


def _fence_aware_lines(text):
    """Yield (line, in_fence) — a heading inside an open fence is content.

    Maintains a stack of open fence runs so nested examples survive: per
    CommonMark a fence closes only on a run of the SAME character at least as
    long as the opener AND with no info string (the closer line is nothing but
    the fence run). An info-stringed run inside an open fence — e.g. ```bash
    nested in an outer ``` block — is a NESTED OPENER, not a closer, so the
    example's own fences stay content. Closers are matched against the
    INNERMOST open frame (stack[-1]), not the outermost: a tilde wrapper
    (~~~) around a backtick example pops the inner ``` first, then the outer
    ~~~, instead of leaving the wrapper open forever and swallowing the rest
    of the document.
    """
    stack = []  # open fence runs, innermost last; empty when not in a fence
    for line in text.splitlines():
        m = FENCE.match(line.strip())
        if m:
            run = m.group(1)
            if stack:
                inner = stack[-1]
                is_closer = (run[0] == inner[0] and len(run) >= len(inner)
                             and line.strip() == run)
                if is_closer:
                    stack.pop()
                else:
                    stack.append(run)  # nested opener (info string or diff char)
            else:
                stack.append(run)  # opening fence; info strings allowed
            yield line, True
            continue
        yield line, bool(stack)


def split_tasks(text):
    lines = list(_fence_aware_lines(text))
    heads = []
    for i, (line, fenced) in enumerate(lines):
        if fenced:
            continue
        h = match_head(line)
        if h:
            heads.append((h.group(1), h.group(2).strip(), i))
    tasks = []
    for n, (tid, title, start) in enumerate(heads):
        end = heads[n + 1][2] if n + 1 < len(heads) else len(lines)
        body = "\n".join(l for l, _ in lines[start:end]).strip()
        tasks.append({"id": tid, "title": title, "body": body, "order": n})
    return tasks


def parse_task(t):
    ttype = None
    type_unparsed = []
    deps, deps_none, deps_mixed = [], False, False
    late_markers = []
    dup_types = []
    near_miss = []
    creates, modifies, reads = [], [], []
    files_near_miss = []
    in_files = False
    files_entries_seen = False
    # The marker contract places **Type:**/**Depends-on:** "immediately after
    # the task heading". The header block is therefore the CONTIGUOUS run of
    # blank lines and marker(-shaped) lines that directly follows the heading;
    # the first other line — a description paragraph, the **Files:** line, a
    # checkbox step, anything — ends it. Marker-shaped lines after that are
    # recorded and surfaced as conflicts instead of being TRUSTED: an unfenced
    # example deep in a prose-only task must never silently reclassify the task
    # with heuristic=false or fabricate a trusted marker edge.
    in_header = True
    for line, fenced in _fence_aware_lines(t["body"]):
        if fenced:
            # A fence is "other" content: a fenced example sitting immediately
            # after the heading ends the header block, so markers following it
            # are demoted to conflicts instead of trusted.
            in_header = False
            continue
        s = line.strip()
        if TASK_HEAD.match(s):
            continue  # the task's own heading line
        is_markerish = bool(MARKER_ISH.match(s))
        if in_header and not s:
            continue  # blank lines inside the header block are fine
        if in_header and not is_markerish:
            in_header = False  # first non-marker, non-blank line ends the header
        # Check for **Type:** lines
        if s.startswith("**Type:**"):
            if not in_header:
                late_markers.append(s)
            else:
                m = MARKER_TYPE.match(s)
                val = m.group(1) if m else None
                if val in TYPES:
                    if ttype is None:
                        ttype = val
                    elif val != ttype:
                        # A second, DIFFERENT valid Type marker: first wins, but
                        # a direct contradiction between trusted markers must
                        # never vanish silently.
                        dup_types.append(val)
                else:
                    # Unparseable, unrecognized, or empty value — recorded
                    # regardless of whether a valid Type already won.
                    type_unparsed.append(s[len("**Type:**"):].strip() or "<empty>")
        elif (m := MARKER_DEPS.match(s)):
            if not in_header:
                late_markers.append(s)
            else:
                # Accumulate across repeated **Depends-on:** lines — first-wins
                # silently dropped declared prerequisites. `none` combined with
                # concrete ids (across lines OR inline, `none, A`) is
                # contradictory: ids win, surfaced as a conflict.
                tokens = [d.strip() for d in m.group(1).split(",") if d.strip()]
                id_tokens = [d for d in tokens if d.lower() != "none"]
                has_none = len(id_tokens) != len(tokens)
                if has_none:
                    if deps or id_tokens:
                        deps_mixed = True
                    deps_none = True
                if id_tokens:
                    if deps_none and not has_none:
                        deps_mixed = True
                    deps.extend(id_tokens)
        elif is_markerish and s.rstrip() == "**Depends-on:**":
            # Exact marker, missing value — a spelling diagnosis would mislead;
            # outside the header it is a placement violation like any late marker.
            (near_miss if in_header else late_markers).append(s + "  <missing value>")
        elif is_markerish:
            # Near-miss spellings (`**type:**`, `**Depends-On:**`, `**Type**:`)
            # would otherwise silently degrade to heuristics with no feedback —
            # inside the header they surface as spelling conflicts, after it as
            # late markers, so every marker-shaped line is accounted for.
            (near_miss if in_header else late_markers).append(s)
        if s.startswith("**Files:**"):
            in_files = True
            files_entries_seen = False
            # Inline header values: `**Files:** \`a.py\` \`b.py\`` carries the
            # paths on the header line itself. Backticked paths are honored as
            # writes (conservative: inline form does not distinguish
            # Create/Modify/Test, and a write is the safe assumption). A
            # non-backticked remainder surfaces a conflict instead of silently
            # falling to ambiguous-files with no pointer.
            rest = s[len("**Files:**"):].strip()
            if rest:
                inline, nonpaths = [], []
                for p in PATH_RE.findall(rest):
                    if not p:
                        continue
                    (inline if _is_pathlike(p) else nonpaths).append(p.split(":")[0])
                if inline:
                    modifies.extend(inline)
                    files_entries_seen = True
                    if nonpaths:
                        files_near_miss.append(_nonpath_near_miss(s, nonpaths))
                elif nonpaths:
                    # There WERE backticked tokens, just none path-like — say so,
                    # rather than the misleading "no backticked paths".
                    files_near_miss.append(_nonpath_near_miss(s, nonpaths))
                elif not rest.lower().startswith("none"):
                    # "none" (with or without trailing prose) is a valid value
                    # (common for gates); other prose without backticked paths
                    # surfaces a conflict
                    files_near_miss.append(
                        s + "  <inline Files value has no backticked paths — "
                        "backtick each path or use - Create/Modify/Test bullets>")
            continue
        if FILES_ISH.match(s):
            # `**Files**:` / `**files:**` never opens the block — every entry
            # under it would drop to ambiguous serialization with no pointer
            # to the typo.
            files_near_miss.append(s + "  <Files header not recognized>")
            continue
        if in_files:
            # A blank line closes the Files section — but only once at least one
            # entry has been parsed: `**Files:**` followed by a blank line before
            # its entries is legal formatting, and closing there would silently
            # discard the whole block (empty writes -> ambiguous serialization,
            # or worse a gate reclassification). After the first entry, blanks
            # close the section so a later dash bullet ("- Test: run the suite
            # manually") cannot fabricate phantom paths via the first-token
            # fallback below.
            if not s:
                if files_entries_seen:
                    in_files = False
                continue
            # A checkbox step closes the Files section. Without this, a prose
            # step shaped like a Files line (e.g. "- Modify: nothing in `b.txt`
            # should change yet") that sits AFTER a checkbox would keep parsing
            # as a Files entry and over-serialize the task. Checkbox lines start
            # with "- [": close, then fall through to normal processing.
            if s.startswith("- ["):
                in_files = False
            f = FILE_LINE.match(s) if in_files else None
            if in_files and not f and re.match(r"^[-*+]\s", s):
                # TOTAL rule: ANY bullet inside an open Files block that is not a
                # checkbox and fails FILE_LINE is a near-miss — colon-less
                # natural English, unknown labels (Read:/Delete:), wrong case or
                # bullet char — surfaced, and the block stays open so valid
                # entries after it survive.
                files_near_miss.append(s)
                continue
            if f:
                # Prefer backticked paths; otherwise take the first
                # whitespace-delimited token so an unbackticked line like
                # "src/app.py — the new module" yields "src/app.py", not the
                # whole prose tail. Paths containing spaces MUST be backticked.
                backticked = PATH_RE.findall(f.group(2))
                if backticked:
                    # Keep only path-like backticked tokens. A Modify line naming a
                    # function (`cmd_apply_create`) or a dotted attribute ref
                    # (`schema.User`) is not a file; admitting it as a write invents
                    # overlap edges to unrelated tasks. Partition once and surface
                    # the dropped tokens so the author can fix the line.
                    paths, dropped = [], []
                    for b in backticked:
                        (paths if _is_pathlike(b) else dropped).append(b)
                    if dropped:
                        files_near_miss.append(_nonpath_near_miss(s, dropped))
                else:
                    tokens = f.group(2).strip().split()
                    first = tokens[0].rstrip(",;")
                    # First token only, and only if it LOOKS like a path (same
                    # _is_pathlike rule as backticked tokens, so backtick presence
                    # never flips a token's classification) — a prose value ("run
                    # pytest manually") must not fabricate a phantom path that
                    # defeats the conservative ambiguous-files fallback.
                    if _is_pathlike(first):
                        paths = [first]
                        if len(tokens) > 1:
                            files_near_miss.append(
                                s + "  <only the first path is used — backtick each path>")
                    else:
                        paths = []
                        files_near_miss.append(
                            s + "  <value is prose, not a path — backtick real paths>")
                paths = [p.split(":")[0] for p in paths if p]  # drop :line-range
                if paths:
                    files_entries_seen = True
                if f.group(1) == "Create":
                    creates.extend(paths)
                elif f.group(1) == "Modify":
                    modifies.extend(paths)
                elif f.group(1) == "Test":
                    reads.extend(paths)
            elif s and not s.startswith("-"):
                in_files = False

    all_paths = creates + modifies + reads
    glob_paths = [p for p in all_paths if GLOB_CHARS.search(p)]
    files_ambiguous = (
        (not creates and not modifies and not reads) or
        bool(glob_paths)
    )

    # Fence-stripped prose: classification evidence and text-dependency scanning
    # run over this, not the raw body, so a fenced example (e.g. a bash snippet
    # with `git push origin main`, or prose that says "runs after Task A") does
    # not reclassify a task or fabricate a dependency edge.
    #
    # Fix C: also drop the task's own `### Task N: <title>` heading line. The
    # heading is metadata, not prose — dependency-analysis.md promises task
    # titles are NOT matched, but split_tasks folds the heading into body, so a
    # task TITLED "cleanup after Task 1 lands" would otherwise fabricate a real
    # text edge. Prose BETWEEN headings still folds into the preceding task's
    # body and stays scanned; only the heading line itself is excluded.
    prose = "\n".join(line for line, fenced in _fence_aware_lines(t["body"])
                      if not fenced and not TASK_HEAD.match(line))

    t.update(marker_type=ttype, type_unparsed=type_unparsed,
             # ids win over a contradictory `none` (the none assertion is void
             # once concrete prerequisites are declared; surfaced via deps_mixed)
             depends_on=deps, depends_none=deps_none and not deps,
             deps_mixed=deps_mixed, late_markers=late_markers,
             dup_types=dup_types, near_miss=near_miss,
             files_near_miss=files_near_miss, glob_paths=sorted(set(glob_paths)),
             creates=sorted(set(creates)), modifies=sorted(set(modifies)),
             reads=sorted(set(reads)),
             writes=sorted(set(creates) | set(modifies)),
             files_ambiguous=files_ambiguous, prose=prose)
    return t


def classify(t):
    """Returns (disposition, heuristic). Explicit marker wins; else evidence
    in plan-markers.md precedence: release -> manual -> gate -> implementation."""
    if t["marker_type"]:
        return t["marker_type"], False
    prose = t["prose"]  # fence-stripped: examples never drive classification
    if RELEASE_EV.search(prose):
        return "release", True
    if MANUAL_EV.search(prose):
        return "manual", True
    if not t["writes"] and GATE_EV.search(prose):
        return "gate", True
    return "implementation", True


ACCEPT_SEALED = re.compile(
    r"^\*\*Acceptance:\*\*\s*sealed\s+([0-9a-f]{8,40})\s*\(sha256:([0-9a-f]{64})\)\s*$",
    re.I)
ACCEPT_WAIVED = re.compile(r"^\*\*Acceptance:\*\*\s*waived\s*[—–-]\s*(.+?)\s*$", re.I)
ACCEPT_SUITE = re.compile(r"^\*\*Acceptance:\*\*\s*suite\s*[—–-]\s*(.+?)\s*$", re.I)


def parse_acceptance(text):
    """Plan-level sealed-acceptance marker.

    Fence-aware scan of the whole document (the line conventionally sits in
    the plan header, but position is not load-bearing). Returns
    {"mode": "sealed", "sealId", "sha256"} | {"mode": "waived", "reason"}
    | {"mode": "suite", "reason"} | {"mode": "missing"}.
    Spec: docs/superpowers/specs/2026-06-12-sealed-acceptance-design.md
    """
    for line, in_fence in _fence_aware_lines(text):
        if in_fence:
            continue
        s = line.strip()
        m = ACCEPT_SEALED.match(s)
        if m:
            return {"mode": "sealed", "sealId": m.group(1), "sha256": m.group(2)}
        m = ACCEPT_WAIVED.match(s)
        if m:
            return {"mode": "waived", "reason": m.group(1)}
        m = ACCEPT_SUITE.match(s)
        if m:
            return {"mode": "suite", "reason": m.group(1)}
    return {"mode": "missing"}


# Minimum module-stem length for attribute-style prose matching (`schema.User`).
# One- and two-letter stems (`a.txt` -> `a.`) match too much English to trust.
PROSE_REF_MIN_STEM = 3


def prose_references(creator_paths, prose):
    """Backticked tokens in fence-stripped prose that reference a created path:
    the exact path, its basename, or — for stems >= PROSE_REF_MIN_STEM — the
    module stem used as an attribute reference (`schema.User` referencing
    apistub/schema.py). Returns the set of matched created paths."""
    tokens = {t.strip() for t in PATH_RE.findall(prose)}
    hits = set()
    for path in creator_paths:
        base = path.rsplit("/", 1)[-1]
        stem = base.rsplit(".", 1)[0]
        for tok in tokens:
            if tok == path or tok.endswith("/" + path) or tok == base:
                hits.add(path)
            elif (len(stem) >= PROSE_REF_MIN_STEM and tok != base
                  and tok.startswith(stem + ".")):
                hits.add(path)
    return hits


def build_edges(impl):
    # Edge precedence:
    # explicit (marker, text) > semantic order-independent (write-after-create,
    # read-after-write) > document-order heuristics (write-after-write,
    # ambiguous-files), which yield to any opposing earlier PATH (reachability),
    # not just a direct reverse edge.
    # A cycle that survives this precedence is a genuine plan contradiction
    # and stays a loud error.
    ids = {t["id"] for t in impl}
    edges, conflicts, seen = [], [], set()
    # Fix E: maintain the adjacency map incrementally instead of rebuilding it
    # on every would_cycle call inside the O(N^2) pair loops (measured
    # superlinear blowup >= 80 tasks). add() appends to adj as it appends edges.
    adj = {}
    # Fix A: dedupe marker_conflicts on the (task, edge) pair. The marker loop
    # and the text loop share this set so byte-identical drops — e.g. two prose
    # matches "after Task A" / "after Task A is green", or a `Depends-on: 9, 9`
    # naming the same ghost twice — surface exactly once.
    conflict_seen = set()

    # kind separates the two audiences a conflict entry can have:
    #   "conflict"  — a malformed/ambiguous marker the human should fix.
    #   "inference" — a benign edge the compiler inferred correctly (a
    #                 write/prose edge overriding a `Depends-on: none`); it is
    #                 informational, not a problem. SKILL.md renders the two
    #                 buckets separately so genuine conflicts are not drowned out.
    def add_conflict(task, edge, note, kind="conflict"):
        if (task, edge) not in conflict_seen:
            conflict_seen.add((task, edge))
            conflicts.append({"task": task, "edge": edge, "note": note, "kind": kind})

    def add(a, b, why):
        if a in ids and b in ids and a != b and (a, b) not in seen:
            seen.add((a, b))
            edges.append({"from": a, "to": b, "why": why})
            adj.setdefault(a, []).append(b)
            target = next(t for t in impl if t["id"] == b)
            if target["depends_none"] and why != "marker":
                add_conflict(
                    b, f"{a} -> {b} ({why})",
                    "Depends-on: none overridden by a conflicting edge — its why label is in the edge field",
                    kind="inference")

    def would_cycle(a, b):
        """True if adding a -> b would close a cycle (b already reaches a)."""
        stack, visited = [b], set()
        while stack:
            n = stack.pop()
            if n == a:
                return True
            if n in visited:
                continue
            visited.add(n)
            stack.extend(adj.get(n, []))
        return False

    # Tier 1: Explicit — marker edges
    for t in impl:
        for d in t["depends_on"]:
            if d == t["id"]:
                # Self-referential markers no-op inside add() (a != b guard);
                # surface them like every other bad marker instead of dropping
                # silently.
                add_conflict(
                    t["id"], d + " -> " + t["id"] + " (marker)",
                    "self-referential Depends-on — a task cannot depend on "
                    "itself; marker ignored")
            elif d in ids:
                add(d, t["id"], "marker")
            else:
                add_conflict(
                    t["id"], d + " -> " + t["id"] + " (marker)",
                    "Depends-on: " + d + " names a task outside the implementation set "
                    "(unknown id or gate/release/manual) — edge dropped")

    # Tier 1: Explicit — text edges (moved up from bottom to enforce precedence).
    # Scans fence-stripped prose so a fenced example saying "runs after Task A"
    # does not fabricate a real dependency edge.
    for b in impl:
        for m in TEXT_DEP.finditer(b["prose"]):
            if m.group(1) != b["id"]:
                if m.group(1) in ids:
                    add(m.group(1), b["id"], "text")
                else:
                    # Same surfacing as marker edges: a text dependency on a task
                    # outside the implementation set (gate/release/manual/unknown)
                    # drops, but loudly, instead of silently no-opping in add().
                    # add_conflict dedupes so two prose matches on the same ghost
                    # task (e.g. "after Task A" and "after Task A is green") yield
                    # one entry, not two byte-identical ones.
                    add_conflict(
                        b["id"], m.group(1) + " -> " + b["id"] + " (text)",
                        "text dependency names a task outside the implementation set "
                        "(unknown id or gate/release/manual) — edge dropped")
        for m in TEXT_DEP_LIST.finditer(b["prose"]):
            for ref in LIST_SPLIT.split(m.group(1)):
                ref = ref.strip()
                if not ref or ref == b["id"]:
                    continue
                if ref in ids:
                    add(ref, b["id"], "text")
                else:
                    add_conflict(
                        b["id"], ref + " -> " + b["id"] + " (text)",
                        "text dependency names a task outside the implementation set "
                        "(unknown id or gate/release/manual) — edge dropped")

    # Tier 2: Semantic, order-independent — write-after-create and read-after-write
    for a in impl:
        for b in impl:
            if a["id"] == b["id"]:
                continue
            if set(a["creates"]) & set(b["modifies"]):
                add(a["id"], b["id"], "write-after-create")
            # read-after-write: b reads a file that a writes (no order condition)
            if set(a["writes"]) & set(b["reads"]):
                add(a["id"], b["id"], "read-after-write")

    # Tier 2.5: Semantic, order-independent — prose-reference. B's prose names a
    # file A creates (backticked exact path, basename, or module-stem attribute
    # like `schema.User`). Eval run mixed-B-2 (2026-06-13) is the motivating
    # failure: a task spec said "returns a `schema.User`" while declaring
    # Depends-on: none, waved parallel to the task creating apistub/schema.py,
    # and its failure cascade-blocked the rest of the diamond. Prose matching is
    # fuzzier than Files matching, so unlike tier 2 these edges are
    # cycle-guarded like tier 3, and each NEWLY added edge is surfaced in
    # marker_conflicts so the Step-3 gate shows the inference.
    for a in impl:
        if not a["creates"]:
            continue
        for b in impl:
            if a["id"] == b["id"]:
                continue
            hits = prose_references(a["creates"], b["prose"])
            if hits and not would_cycle(a["id"], b["id"]):
                before = len(edges)
                add(a["id"], b["id"], "prose-reference")
                if len(edges) > before:
                    # Use a distinct key ("inferred:" prefix) so this note coexists
                    # with the "Depends-on: none overridden" note that add() may have
                    # emitted for the same edge (both use (task, edge) as the dedup
                    # key; without the prefix the conflict_seen guard would drop one).
                    add_conflict(
                        b["id"],
                        "inferred: " + a["id"] + " -> " + b["id"] + " (prose-reference)",
                        "prose-reference edge inferred: task prose references "
                        + ", ".join(sorted(hits)[:3])
                        + " created by Task " + a["id"]
                        + " — declare **Depends-on:** " + a["id"]
                        + " to make it explicit (or rewrite the mention if it is "
                        "not a real dependency)",
                        kind="inference")

    # Tier 3: Document-order heuristics — yield to any opposing earlier PATH.
    # Each tier-3 edge is reachability-checked against everything added before it
    # (tiers 1-2 plus earlier tier-3 edges), so tier-3 can never close a cycle;
    # any surviving cycle is an explicit/semantic contradiction.
    for a in impl:
        for b in impl:
            if a["id"] == b["id"]:
                continue
            # write-after-write: the overlap set is (writes union reads) on both
            # sides. Upstream TDD semantics make a `Test:` path a WRITE (the task
            # writes the failing test and commits it), so two tasks listing the
            # same `Test:` path must serialize or they guarantee a merge conflict.
            # As accepted conservatism this also serializes two pure readers of one
            # shared fixture. Add only when doc order is forward AND b cannot
            # already reach a (reachability guard, Bug A).
            a_touch = set(a["writes"]) | set(a["reads"])
            b_touch = set(b["writes"]) | set(b["reads"])
            if (a_touch & b_touch
                    and a["order"] < b["order"]
                    and not would_cycle(a["id"], b["id"])):
                add(a["id"], b["id"], "write-after-write")

    # ambiguous-files: serialize task T at its document position, yielding to any
    # opposing earlier path (reachability), not just a direct reverse edge.
    for t in impl:
        if t["files_ambiguous"]:
            for u in impl:
                if u["id"] == t["id"]:
                    continue
                if u["order"] < t["order"] and not would_cycle(u["id"], t["id"]):
                    add(u["id"], t["id"], "ambiguous-files")
                elif u["order"] > t["order"] and not would_cycle(t["id"], u["id"]):
                    add(t["id"], u["id"], "ambiguous-files")

    return edges, conflicts


def find_cycle(members, edges):
    """One concrete cycle among `members` as an edge list, or None.
    Iterative DFS over the recorded edges restricted to the unplaced members —
    small by construction (only the Kahn leftovers), so no perf concern."""
    mset = set(members)
    succ = {}
    for e in edges:
        if e["from"] in mset and e["to"] in mset:
            succ.setdefault(e["from"], []).append(e)
    for start in members:
        stack = [(start, [])]
        while stack:
            node, path = stack.pop()
            for e in succ.get(node, []):
                if e["to"] == start:
                    return path + [e]
                if all(p["to"] != e["to"] for p in path):
                    stack.append((e["to"], path + [e]))
    return None


def layer(impl, edges):
    order = [t["id"] for t in impl]
    indeg = {i: 0 for i in order}
    succ = {i: [] for i in order}
    for e in edges:
        succ[e["from"]].append(e["to"])
        indeg[e["to"]] += 1
    waves, done = [], set()
    ready = [i for i in order if indeg[i] == 0]
    while ready:
        waves.append(sorted(ready, key=order.index))
        nxt = []
        for r in ready:
            done.add(r)
            for s in succ[r]:
                indeg[s] -= 1
                if indeg[s] == 0:
                    nxt.append(s)
        ready = nxt
    if len(done) != len(order):
        members = [i for i in order if i not in done]
        cyc = find_cycle(members, edges)
        hint = ""
        if cyc:
            hint = (" One cycle: " + cyc[0]["from"] + " -> "
                    + " -> ".join(f"{e['to']} ({e['why']})" for e in cyc)
                    + " — break the weakest labeled constraint.")
        print(f"compile_plan: cycle detected among tasks {', '.join(members)} — "
              "revise the plan to break it; refusing to guess an ordering." + hint,
              file=sys.stderr)
        raise SystemExit(1)
    return waves


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("plan", type=Path)
    ap.add_argument("--emit-launch", type=Path, default=None, dest="emit_launch",
                    metavar="PATH",
                    help="also write a launch-ready waves file (verbatim, "
                         "fence-aware task bodies) to PATH; waves.js reads bodies "
                         "from it via args.wavesPath so they never ride inline.")
    args = ap.parse_args(argv)
    emit_launch = args.emit_launch
    plan_text = args.plan.read_text()
    # (Runs BEFORE the no-tasks bail so an all-wrong-level plan gets the
    # named diagnostic, not the generic 'no headings found'.)
    # A heading that LOOKS like a task heading but fails TASK_HEAD (e.g.
    # `### Task 1.5:` — non-alphanumeric id) would silently fold its whole
    # section into the PREVIOUS task: the task vanishes from the waves and its
    # files corrupt the previous task's write set. Refuse loudly, like
    # duplicate ids.
    # Two nets: (a) 3-4-hash task-word headings (the contract level, any
    # malformation); (b) ANY heading level carrying the id-colon shape
    # (`## Task 2:`, `##### Task 2:` — wrong level, would fold silently).
    # Section titles like "## Task Structure" or "## Tasks" match neither.
    near_head = re.compile(r"^(#{3,4}\s*task\b|#{1,6}\s*task\s+[^\s:]+:)", re.I)
    bad_heads = [line.strip() for line, fenced in _fence_aware_lines(plan_text)
                 if not fenced and near_head.match(line.strip())
                 and not match_head(line)]
    if bad_heads:
        # Precise "did you mean ###" hint when the ONLY fault is the heading
        # LEVEL (two or four-plus hashes around an otherwise well-formed
        # `Task <id>: <title>`). The caps/dotted-id cases keep the generic
        # message — their level is fine, the id/case is not.
        # \s* (not \s+) between the hashes and Task so a no-space mistake
        # (`####Task 2:`) still gets the precise hint, not just the generic error.
        wrong_level = re.compile(r"^(#{1,2}|#{4,6})\s*Task\s+[A-Za-z0-9]+:", re.I)
        level_hint = ""
        if any(wrong_level.match(h) for h in bad_heads):
            level_hint = (" Task headings use EXACTLY three hashes — did you mean "
                          "'### Task N: …' rather than '##' or '####'?")
        print("compile_plan: task heading(s) not recognized: "
              + "; ".join(bad_heads[:3])
              + " — ids must be alphanumeric (`### Task <id>: <title>`); a "
              "malformed heading folds its task into the previous one. "
              "Refusing to compile." + level_hint, file=sys.stderr)
        raise SystemExit(1)

    tasks = [parse_task(t) for t in split_tasks(plan_text)]
    if not tasks:
        print("compile_plan: no '### Task N:' headings found.", file=sys.stderr)
        raise SystemExit(1)

    # Bug D: detect duplicate task IDs early
    ids = [t["id"] for t in tasks]
    dups = sorted({i for i in ids if ids.count(i) > 1})
    if dups:
        print("compile_plan: duplicate task id(s): " + ", ".join(dups) +
              " — task headings must be unique; refusing to compile.", file=sys.stderr)
        raise SystemExit(1)

    out_tasks = []
    for t in tasks:
        disp, heuristic = classify(t)
        t["disposition"] = disp
        out_tasks.append({"id": t["id"], "title": t["title"], "disposition": disp,
                          "heuristic": heuristic, "writes": t["writes"],
                          "depends_on": t["depends_on"]})

    # Bug E1: surface unparseable type markers as conflicts
    type_conflicts = [
        {"task": t["id"], "edge": "",
         "note": "**Type:** " + ", ".join(repr(v) for v in t["type_unparsed"])
                 + " is not a recognized type "
                 "(implementation/gate/release/manual) — marker ignored, heuristic applied"}
        for t in tasks if t.get("type_unparsed")]
    # Markers found outside the header block (after the Files block or the
    # first checkbox step) are never trusted — surface each task once.
    type_conflicts += [
        {"task": t["id"], "edge": "",
         "note": "marker line(s) outside the header block ignored ("
                 + "; ".join(sorted(set(t["late_markers"]))[:3])
                 + ") — markers go immediately after the task heading"}
        for t in tasks if t.get("late_markers")]
    # Contradictory trusted Type markers: first wins, surfaced loudly.
    type_conflicts += [
        {"task": t["id"], "edge": "",
         "note": "contradictory **Type:** markers (" + t["marker_type"] + " vs "
                 + ", ".join(sorted(set(t["dup_types"]))) + ") — the first one wins"}
        for t in tasks if t.get("dup_types")]
    # Glob-driven ambiguity: conservative full serialization with no pointer to
    # WHY would read as a scheduling bug — name the globby paths.
    type_conflicts += [
        {"task": t["id"], "edge": "",
         "note": "path(s) look like globs (" + ", ".join(t["glob_paths"][:3])
                 + ") — task serialized via ambiguous-files; list concrete files "
                 "to parallelize (a literal [slug]/{x} path also triggers this)"}
        for t in tasks if t.get("glob_paths")]
    # Plural text dependencies that could NOT be parsed into an id list — surface
    # so the ordering intent is not silently lost.
    type_conflicts += [
        {"task": t["id"], "edge": "",
         "note": "plural text dependency ('depends on/after/requires Tasks …') could "
                 "not be parsed into task ids — encode each prerequisite as a "
                 "**Depends-on:** marker"}
        for t in tasks
        if TEXT_DEP_PLURAL.search(t["prose"]) and not TEXT_DEP_LIST.search(t["prose"])]
    # Files-entry near-misses: a dropped write path silently weakens overlap
    # inference — surface per task.
    type_conflicts += [
        {"task": t["id"], "edge": "",
         "note": "Files entr(y/ies) not recognized (check label case/colon: "
                 + "; ".join(sorted(set(t["files_near_miss"]))[:3])
                 + ") — path(s) dropped from overlap inference"}
        for t in tasks if t.get("files_near_miss")]
    # Near-miss marker spellings: degraded to heuristics, but never silently.
    type_conflicts += [
        {"task": t["id"], "edge": "",
         "note": "marker-like line(s) not recognized (check spelling/case, or a missing value: "
                 + "; ".join(sorted(set(t["near_miss"]))[:3])
                 + ") — ignored"
                 + (", heuristics applied" if not t.get("marker_type")
                    else "; classification unaffected (a valid **Type:** won)")}
        for t in tasks if t.get("near_miss")]
    # `Depends-on: none` combined with concrete ids — ids won, none is void.
    type_conflicts += [
        {"task": t["id"], "edge": "",
         "note": "Depends-on: none combined with concrete ids — the ids win; "
                 "the none assertion is ignored"}
        for t in tasks if t.get("deps_mixed")]

    acceptance = parse_acceptance(plan_text)
    marked = any(not t.get("heuristic") for t in out_tasks)
    if acceptance["mode"] == "missing" and marked:
        sys.exit("error: marked plan has no **Acceptance:** line (sealed or waived). "
                 "Seal the exam (ultraplan sealing step) or record an explicit waiver. "
                 "See docs/superpowers/specs/2026-06-12-sealed-acceptance-design.md")
    if acceptance["mode"] == "missing":
        type_conflicts.append({"task": "", "edge": "",
                               "note": "acceptance: missing (unmarked plan — warning only)"})

    impl = [t for t in tasks if t["disposition"] == "implementation"]
    if not impl:
        # Bug D: a gates/release/manual-only plan compiles to waves: [] —
        # waves.js refuses empty waves, so warn loudly while still emitting
        # the JSON (exit 0): the runbook and gates remain meaningful.
        print("compile_plan: no implementation tasks — nothing to wave "
              "(plan is gates/release/manual only); the runbook and gates "
              "still apply.", file=sys.stderr)
    edges, conflicts = build_edges(impl)
    waves = layer(impl, edges)

    mode, degrade = "parallel", None
    fully_overlapping = (len(impl) > 1 and all(
        set(a["writes"]) & set(b["writes"])
        for a in impl for b in impl if a["id"] != b["id"]))
    # Fix B: a gates/release-only plan has waves: [] — there is nothing to
    # sequence, so skip the degrade entirely (the "no implementation tasks"
    # stderr warning above already covers the situation). Without this guard the
    # `len(impl) == 1` trigger still catches zero and emits the misleading
    # `Sequential mode: 0 implementation tasks` against an empty wave list.
    # The single-task trigger is `== 1`, not `<= 2`: a 2-impl-task plan with
    # disjoint writes is genuinely parallelizable into one wave, so degrading it
    # to two single-task waves would be needless serialization.
    if impl and (len(impl) == 1 or fully_overlapping):
        mode = "sequential"
        degrade = f"Sequential mode: {len(impl)} implementation tasks" + (
            ", fully overlapping writes" if fully_overlapping else "")
        # Bug A: flatten already-computed topological layering (not document order)
        waves = [[tid] for wave in waves for tid in wave]

    # Every conflict entry carries a `kind` ("conflict" needs human attention,
    # "inference" is a benign auto-inferred edge). type_conflicts are all genuine
    # conflicts; build_edges already tagged its inference entries.
    marker_conflicts = [{**c, "kind": c.get("kind", "conflict")}
                        for c in (type_conflicts + conflicts)]

    # Launch-ready, single-source-of-truth task objects. The orchestrator passes
    # these THROUGH instead of re-parsing the plan (which would let two parsers
    # drift). `launch_waves` is LIGHT (no body) so the orchestrator can emit it
    # inline as args.waves; the verbatim bodies — which can total tens of KB and
    # must never be transcribed by a model — are written to the --emit-launch
    # file and read by each task agent from disk (see SKILL.md Step 4b / waves.js
    # args.wavesPath). The orchestrator still derives tier / review per task.
    by_id = {t["id"]: t for t in tasks}

    def _files_for(t):
        return sorted(set(t["creates"]) | set(t["modifies"]) | set(t["reads"]))

    launch_waves = [
        [{"id": tid, "title": by_id[tid]["title"], "files": _files_for(by_id[tid]),
          "depends_on": by_id[tid]["depends_on"]} for tid in wave]
        for wave in waves]

    result = {
        "tasks": out_tasks,
        "dag_edges": edges,
        "marker_conflicts": marker_conflicts,
        "gates": [t["id"] for t in tasks if t["disposition"] == "gate"],
        "post_merge_runbook": [t["id"] for t in tasks
                               if t["disposition"] in ("release", "manual")],
        "waves": waves,
        "launch_waves": launch_waves,
        "mode": mode,
        "degrade_reason": degrade,
        "acceptance": acceptance,
    }

    if emit_launch is not None:
        # The launch file carries the FULL, verbatim, fence-aware task bodies
        # (split_tasks already extracted them fence-aware). Each waves.js task
        # agent reads its own entry by id from this file — bodies never ride
        # inline in the Workflow call, and never transit a model.
        launch_payload = {
            "tasks": [{"id": tid, "title": by_id[tid]["title"],
                       "body": by_id[tid]["body"], "files": _files_for(by_id[tid]),
                       "depends_on": by_id[tid]["depends_on"]}
                      for wave in waves for tid in wave],
            "waves": waves,
            "edges": [[e["from"], e["to"]] for e in edges],
            "acceptance": acceptance,
        }
        emit_launch.parent.mkdir(parents=True, exist_ok=True)
        emit_launch.write_text(json.dumps(launch_payload, indent=2))
        result["launch_file"] = str(emit_launch)

    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
