#!/usr/bin/env python3
"""Parse a claims-v1 plan markdown file to its grammar shape.

Usage: python3 plan_parse.py <plan.md>

Prints exactly one JSON object on stdout with keys `tasks`, `dag_edges`,
`launch_waves`, `checks`, `bootstrapCmd` and `publish`, and exits 0 -- reading no file but the plan
itself, whether or not a `<stem>.gate-verdicts.json` sits beside it.

Each task's files is the sorted set of its Create, Modify and Delete paths.

This is a grammar parser, not the old semantic compiler
(`compile_plan.py`, deleted at cut B, 2026-09-21): it refuses (exit 2, one
stderr line) only what it cannot parse -- no `### Task <id>:` heading found,
a duplicate task id, or a cycle in the derived dependency edges. Everything
else the old compiler would treat as a semantic violation (missing gate
verdicts, slot-shape complaints, disjointness, clause citations, ...) is not
this parser's business.
"""

import json
import re
import sys


class Refusal(Exception):
    """Raised for the three grammar-level refusals (M5)."""


# --------------------------------------------------------------------------- #
# Fence-aware line scanning: track a stack of open ``` / ~~~ fences so
# headings and labels inside code blocks are never mistaken for real
# structure.
# --------------------------------------------------------------------------- #

_FENCE_RE = re.compile(r'^(`{3,}|~{3,})\s*.*$')


def _fence_aware_lines(text):
    """Yield (line, fenced) for each line of text, `fenced` True when the
    line is itself a fence marker or lies inside an open fence."""
    stack = []  # stack of fence marker strings, e.g. "```" or "~~~~"
    out = []
    for line in text.splitlines():
        s = line.strip()
        m = _FENCE_RE.match(s)
        if m:
            run = m.group(1)
            if stack and run[0] == stack[-1][0] and len(run) >= len(stack[-1]):
                stack.pop()
            else:
                stack.append(run)
            out.append((line, True))
            continue
        out.append((line, bool(stack)))
    return out


def _leading_spaces(line):
    return len(line) - len(line.lstrip(' '))


TASK_HEAD = re.compile(r'^### Task ([A-Za-z0-9]+):\s*(.*)$')
H2_HEAD = re.compile(r'^##\s')

FILE_BULLET = re.compile(r'^-\s*(Create|Modify|Delete)\s*:\s*(.+)$', re.I)
IFACE_BULLET = re.compile(r'^-\s*(Consumes|Produces)\s*:\s*(.+)$', re.I)
PROOF_RUN_BULLET = re.compile(r'^-\s*Run\s*:\s*(.+)$', re.I)

# A Proof `Run:` bullet's citation tag (the old compiler's
# RUN_CITE_RE exactly): the same bracket shape a Legs bullet's own citation
# carries (`[M2]`, `[M1, M3]`), anchored at the END of the value after
# whitespace -- a tag mid-command is part of the command, not a tag.
RUN_CITE_RE = re.compile(r"\s*\[\s*(M\d+(?:\s*,\s*M\d+)*)\s*\]\s*$")


def _claims_run_cites(value):
    """Split a Proof `Run:` value into (command text, sorted clause ids),
    exactly as the old compiler's `_claims_run_cites` did. Untagged, the
    value rides back whole with `[]`. Tagged, the tag is cut off FIRST --
    before any backtick-wrapper stripping -- and its ids are returned
    sorted by number."""
    m = RUN_CITE_RE.search(value)
    if not m:
        return value, []
    cites = sorted({c.strip() for c in m.group(1).split(",")},
                   key=lambda c: int(c[1:]))
    return value[:m.start()], cites


TYPE_LINE = re.compile(r'^\*\*Type:\*\*\s*(.+?)\s*$', re.I)
BOOTSTRAP_LINE = re.compile(r'^\*\*Bootstrap:\*\*\s*(.+?)\s*$', re.I)
PUBLISH_LINE = re.compile(r'^\*\*Publish:\*\*\s*(.+?)\s*$', re.I)
VERIFY_LINE = re.compile(r'^\*\*Verify:\*\*\s*(.+?)\s*$', re.I)
ROLLBACK_LINE = re.compile(r'^\*\*Rollback:\*\*\s*(.+?)\s*$', re.I)
BACKTICK_PATH_RE = re.compile(r'`([^`]+)`')
GLOBAL_CONSTRAINTS_H2 = re.compile(r'^##\s*Global Constraints\s*$', re.I)
CHECK_BULLET = re.compile(r'^-\s*Check\s*:\s*(.+)$', re.I)
MINOR_SUFFIX_RE = re.compile(r'\s*\(minor\)\s*$', re.I)

SLOT_RE = re.compile(
    r'^\*\*\s*(claim|authorized[-\s]?by|interfaces|context|proof|stale[-\s]?if)'
    r'\s*:?\s*\*\*\s*:?\s*(.*)$',
    re.I,
)


def _slot_name(raw):
    key = re.sub(r'[\s-]+', '-', raw.strip().lower())
    return key


# --------------------------------------------------------------------------- #
# Plan-level split: headings, boundaries, header block.
# --------------------------------------------------------------------------- #

def _split_plan(text):
    scanned = _fence_aware_lines(text)
    heads = []       # (id, title, line_idx)
    boundaries = []  # line indices of task headings and h2 headings

    for i, (line, fenced) in enumerate(scanned):
        if fenced:
            continue
        if _leading_spaces(line) > 3:
            continue
        s = line.strip()
        if s.startswith('### Task') and not TASK_HEAD.match(s):
            raise Refusal(
                "plan_parse: a '### Task' line is not a task heading -- "
                "write '### Task <id>: <title>' with the colon right after "
                "the id: " + s
            )
        m = TASK_HEAD.match(s)
        if m:
            heads.append((m.group(1), m.group(2).strip(), i))
            boundaries.append(i)
            continue
        if H2_HEAD.match(s):
            boundaries.append(i)

    if not heads:
        raise Refusal("plan_parse: no '### Task <id>:' heading found")

    seen_ids = {}
    for tid, _title, idx in heads:
        seen_ids.setdefault(tid, []).append(idx)
    dups = sorted(t for t, idxs in seen_ids.items() if len(idxs) > 1)
    if dups:
        raise Refusal(
            "plan_parse: duplicate task id(s) on '### Task' headings: "
            + ", ".join(dups)
        )

    boundaries_sorted = sorted(set(boundaries))
    header_lines = scanned[: heads[0][2]]

    task_bodies = []
    for n, (tid, title, start) in enumerate(heads):
        end = next((b for b in boundaries_sorted if b > start), len(scanned))
        task_bodies.append((tid, title, n, scanned[start:end]))

    return header_lines, task_bodies


def _strip_whole_backticks(val):
    """A whole-value backtick wrapper stripped, exactly as `Check:` strips
    one."""
    bm = re.match(r'^`([^`]+)`$', val)
    return bm.group(1).strip() if bm else val


def _parse_header(header_lines):
    bootstrap_cmd = None
    deploy_cmd = None
    verify_cmd = None
    rollback_cmd = None
    for line, fenced in header_lines:
        if fenced:
            continue
        s = line.strip()
        m = BOOTSTRAP_LINE.match(s)
        if m:
            bootstrap_cmd = m.group(1).strip()
            continue
        m = PUBLISH_LINE.match(s)
        if m:
            deploy_cmd = _strip_whole_backticks(m.group(1).strip())
            continue
        m = VERIFY_LINE.match(s)
        if m:
            verify_cmd = _strip_whole_backticks(m.group(1).strip())
            continue
        m = ROLLBACK_LINE.match(s)
        if m:
            rollback_cmd = _strip_whole_backticks(m.group(1).strip())
            continue

    publish = None
    if deploy_cmd is not None or verify_cmd is not None:
        publish = {
            "deploy": deploy_cmd,
            "verify": verify_cmd,
            "rollback": rollback_cmd,
        }
    return bootstrap_cmd, publish


def _parse_checks(header_lines):
    """`- Check:` bullets under the `## Global Constraints` heading in the
    plan header, in order; a trailing `(minor)` marks `minor` true and is
    stripped from `cmd`."""
    checks = []
    in_section = False
    for line, fenced in header_lines:
        if fenced:
            continue
        s = line.strip()
        if H2_HEAD.match(s):
            in_section = bool(GLOBAL_CONSTRAINTS_H2.match(s))
            continue
        if not in_section:
            continue
        m = CHECK_BULLET.match(s)
        if not m:
            continue
        val = m.group(1).strip()
        minor = False
        mm = MINOR_SUFFIX_RE.search(val)
        if mm:
            minor = True
            val = val[:mm.start()].rstrip()
        bm = re.match(r'^`([^`]+)`$', val)
        if bm:
            val = bm.group(1).strip()
        checks.append({"cmd": val, "minor": minor})
    return checks


# --------------------------------------------------------------------------- #
# Task-body parsing.
# --------------------------------------------------------------------------- #

def _slot_spans(body_lines):
    """`[(start, end, name, inline)]` for each unfenced slot label after the
    heading line, in written order, duplicates kept: the label's line index,
    the next label's (or the body's end), its canonical name, and the label
    line's remainder, stripped."""
    heads = []
    for i, (line, fenced) in enumerate(body_lines):
        if fenced or i == 0:
            continue
        m = SLOT_RE.match(line.strip())
        if m:
            heads.append((i, _slot_name(m.group(1)), m.group(2).strip()))
    ends = [i for i, _, _ in heads[1:]] + [len(body_lines)]
    return [(i, end, name, inline)
            for (i, name, inline), end in zip(heads, ends)]


def _span_text(body_lines, span):
    """A slot's raw text, label stripped: the label line's remainder and every
    line to the next label, stripped once as a whole. `plan_check.py`'s gate
    hash is over two of these (`sha256(claim + NUL + proof)`), so the recipe
    is byte-for-byte the one every recorded verdict was signed under."""
    start, end, _name, inline = span
    return "\n".join(([inline] if inline else [])
                     + [l for l, _ in body_lines[start + 1:end]]).strip()


def _pre_slot(body_lines):
    """The task body's lines between its heading and its first slot label --
    the region its `**Type:**` line and Files bullets are read from."""
    spans = _slot_spans(body_lines)
    return body_lines[1:spans[0][0] if spans else len(body_lines)]


def _file_bullets(lines):
    """`(label, paths)` for each unfenced `Create:`/`Modify:`/`Delete:`
    bullet of `lines`, in written order, label lower-cased."""
    for line, fenced in lines:
        m = None if fenced else FILE_BULLET.match(line.strip())
        if m:
            yield m.group(1).lower(), BACKTICK_PATH_RE.findall(m.group(2))


def _parse_task_body(body_lines):
    """body_lines is the fence-aware (line, fenced) list from the task's
    heading line through (but not including) the next boundary."""
    spans = _slot_spans(body_lines)
    pre_slot = _pre_slot(body_lines)

    def slot_lines(name):
        out = []
        for start, end, n, _ in spans:
            if n == name:
                out.extend(body_lines[start:end])
        return out

    def slot_text(name):
        """First occurrence wins; "" when the slot is absent."""
        span = next((sp for sp in spans if sp[2] == name), None)
        return "" if span is None else _span_text(body_lines, span)

    # Stale-if: one predicate per line, bullet optional.
    stale_if_entries = [e for e in (re.sub(r'^[-*+]\s+', '', l.strip())
                                    for l in slot_text("stale-if").splitlines())
                        if e]

    # Type marker.
    ttype = None
    for line, fenced in pre_slot:
        if fenced:
            continue
        m = TYPE_LINE.match(line.strip())
        if m:
            ttype = m.group(1).strip().lower()
            break

    # Files block.
    files = {"create": [], "modify": [], "delete": []}
    for label, paths in _file_bullets(pre_slot):
        files[label].extend(paths)

    # Interfaces slot.
    interfaces = {"consumes": [], "produces": []}
    for line, fenced in slot_lines("interfaces"):
        m = None if fenced else IFACE_BULLET.match(line.strip())
        if m:
            interfaces[m.group(1).lower()].append(m.group(2).strip())

    # Proof slot.
    proof_slot_lines = slot_lines("proof")
    proof_runs = []
    proof_run_clauses = []
    for line, fenced in proof_slot_lines:
        if fenced:
            continue
        s = line.strip()
        m = PROOF_RUN_BULLET.match(s)
        if m:
            val = m.group(1).strip()
            val, clauses = _claims_run_cites(val)
            bm = re.match(r'^`([^`]*)`$', val)
            if bm:
                val = bm.group(1)
            proof_runs.append(val)
            proof_run_clauses.append(clauses)

    return {
        "type": ttype,
        "creates": files["create"],
        "modifies": files["modify"],
        "deletes": files["delete"],
        "interfaces": interfaces,
        "proofRuns": proof_runs,
        "proofRunClauses": proof_run_clauses,
        "claim": slot_text("claim"),
        "authorized_by": slot_text("authorized-by"),
        "proof": slot_text("proof"),
        "stale_if_entries": stale_if_entries,
    }


def _is_implementation(ttype):
    return ttype is None or ttype == "implementation"


# --------------------------------------------------------------------------- #
# M3: the Interfaces-bullet token rule.
# --------------------------------------------------------------------------- #

_DECL_KEYWORDS = {"def", "function", "class", "const", "let", "var", "export", "async"}


def _interface_token(text):
    text = text.strip()
    if not text:
        return None
    m = BACKTICK_PATH_RE.search(text)
    if m:
        span = m.group(1)
        words = span.split()
        while words and words[0] in _DECL_KEYWORDS:
            words = words[1:]
        if not words:
            return None
        first = words[0]
        cuts = [i for i in (first.find('('), first.find(':')) if i != -1]
        if cuts:
            first = first[:min(cuts)]
        if first.lower() in ("none", "nothing"):
            return None
        return first or None
    tokens = text.split()
    if len(tokens) != 1:
        return None
    word = tokens[0]
    if word.lower() in ("none", "nothing"):
        return None
    return word


# --------------------------------------------------------------------------- #
# M4: the edge-building algorithm.
# --------------------------------------------------------------------------- #

_RUN_SPLIT_RE = re.compile(r'&&|\|\||[;()|\s]+')

# Python `from <dotted> import ...` -- captures the dotted module only; the
# whole match (including the imported names) is later blanked out of the
# command before the bare-`import` regex runs, so `x` in `from pkg import x`
# is never mistaken for a module of its own.
_PY_FROM_IMPORT_RE = re.compile(
    r'\bfrom\s+([\w.]+)\s+import\s+[\w.]+(?:\s*,\s*[\w.]+)*'
)
# Python bare `import <dotted>[, <dotted> ...]`.
_PY_IMPORT_RE = re.compile(r'\bimport\s+([\w.]+(?:\s*,\s*[\w.]+)*)')

# JavaScript/TypeScript import forms: `import ... from '<spec>'`,
# `import('<spec>')`, `require('<spec>')` -- single or double quotes.
_JS_SPEC_RE = re.compile(
    r"""\bimport\s+[^'";]*?\bfrom\s+(['"])(?P<spec1>[^'"]+)\1"""
    r"""|\bimport\(\s*(['"])(?P<spec2>[^'"]+)\3\s*\)"""
    r"""|\brequire\(\s*(['"])(?P<spec3>[^'"]+)\5\s*\)"""
)

_JS_EXTS = ('.ts', '.mjs', '.js', '.tsx')
_JS_INDEXES = ('/index.ts', '/index.mjs', '/index.js')


def _py_module_candidates(dotted):
    path = dotted.replace('.', '/')
    return [path + '.py', path + '/__init__.py']


def _js_spec_candidates(spec):
    stripped = spec[2:] if spec.startswith('./') else spec
    candidates = [stripped]
    base = stripped.rsplit('/', 1)[-1]
    if '.' not in base:
        candidates.extend(stripped + ext for ext in _JS_EXTS)
        candidates.extend(stripped + idx for idx in _JS_INDEXES)
    return candidates


def _import_paths(cmd):
    """Candidate module/file paths named by any import in `cmd`, Python or
    JavaScript. A candidate that no task's Files carry costs nothing --
    `_build_edges` only fires on an actual intersection."""
    out = []

    for m in _PY_FROM_IMPORT_RE.finditer(cmd):
        out.extend(_py_module_candidates(m.group(1)))

    stripped_cmd = _PY_FROM_IMPORT_RE.sub(' ', cmd)
    for m in _PY_IMPORT_RE.finditer(stripped_cmd):
        for dotted in m.group(1).split(','):
            out.extend(_py_module_candidates(dotted.strip()))

    for m in _JS_SPEC_RE.finditer(cmd):
        spec = m.group('spec1') or m.group('spec2') or m.group('spec3')
        if spec is None:
            continue
        if not (spec.startswith('./') or spec.startswith('../')):
            continue
        out.extend(_js_spec_candidates(spec))

    return out


def _run_tokens(cmd):
    toks = [t for t in _RUN_SPLIT_RE.split(cmd) if t]
    out = []
    for t in toks:
        if t.startswith("./"):
            t = t[2:]
        out.append(t)
    out.extend(_import_paths(cmd))
    return out


def _build_edges(impl):
    edges = []
    seen = set()
    adj = {}

    def add(a, b, why):
        if a == b or (a, b) in seen:
            return
        seen.add((a, b))
        edges.append({"from": a, "to": b, "why": why})
        adj.setdefault(a, []).append(b)

    def reaches(src, dst):
        stack = [src]
        visited = set()
        while stack:
            n = stack.pop()
            if n == dst:
                return True
            if n in visited:
                continue
            visited.add(n)
            stack.extend(adj.get(n, []))
        return False

    def would_cycle(a, b):
        return reaches(b, a)

    ids = [t["id"] for t in impl]
    by_id = {t["id"]: t for t in impl}

    # Tier 1: write-after-create -- always added, no cycle guard.
    for a in ids:
        for b in ids:
            if a == b:
                continue
            if set(by_id[a]["creates"]) & set(by_id[b]["modifies"]):
                add(a, b, "write-after-create")

    # Tier 2: interface.
    produced_tokens = _produced_tokens_map(impl)
    for b in ids:
        b_consumes = {tok for c in by_id[b]["interfaces"]["consumes"]
                      for tok in [_interface_token(c)] if tok}
        if not b_consumes:
            continue
        for a in ids:
            if a == b:
                continue
            if not (b_consumes & produced_tokens.get(a, set())):
                continue
            if would_cycle(a, b):
                continue
            add(a, b, "interface")

    # Tier 3: proof-run -- fully after tier 2 completes.
    files_of = {t["id"]: set(t["files"]) | set(t.get("deletes", [])) for t in impl}
    for b in ids:
        b_files = files_of[b]
        for cmd in by_id[b]["proofRuns"]:
            tokens = set(_run_tokens(cmd))
            if not tokens:
                continue
            for a in ids:
                if a == b:
                    continue
                a_only = files_of[a] - b_files
                if not (tokens & a_only):
                    continue
                if would_cycle(a, b):
                    continue
                add(a, b, "proof-run")

    return edges


def _produced_tokens_map(impl):
    return {
        t["id"]: {tok for p in t["interfaces"]["produces"]
                  for tok in [_interface_token(p)] if tok}
        for t in impl
    }


# --------------------------------------------------------------------------- #
# M5: Kahn layering and cycle detection.
# --------------------------------------------------------------------------- #

def _find_a_cycle(ids, edges):
    graph = {i: [] for i in ids}
    idset = set(ids)
    for e in edges:
        if e["from"] in idset and e["to"] in idset:
            graph[e["from"]].append(e["to"])

    color = {}
    path = []

    def dfs(u):
        color[u] = 1
        path.append(u)
        for v in graph[u]:
            c = color.get(v, 0)
            if c == 0:
                res = dfs(v)
                if res is not None:
                    return res
            elif c == 1:
                idx = path.index(v)
                return path[idx:]
        color[u] = 2
        path.pop()
        return None

    for i in ids:
        if color.get(i, 0) == 0:
            res = dfs(i)
            if res is not None:
                return res
    return None


def _kahn_layers(ids, edges):
    indegree = {i: 0 for i in ids}
    children = {i: [] for i in ids}
    for e in edges:
        if e["from"] in indegree and e["to"] in indegree:
            indegree[e["to"]] += 1
            children[e["from"]].append(e["to"])

    remaining = set(ids)
    waves = []
    while remaining:
        wave = [i for i in ids if i in remaining and indegree[i] == 0]
        if not wave:
            cyc = _find_a_cycle(ids, edges) or sorted(remaining)
            raise Refusal(
                "plan_parse: dependency cycle among tasks: " + ", ".join(cyc)
            )
        waves.append(wave)
        for i in wave:
            remaining.discard(i)
            for c in children[i]:
                if c in remaining:
                    indegree[c] -= 1
    return waves


# --------------------------------------------------------------------------- #
# Top-level parse.
def task_sections(text):
    """Each task's own section of the plan text, keyed by task id: its heading
    line without the leading '### ' (so 'Task <id>: <title>'), then everything
    up to the next unfenced task heading, trimmed -- what a builder is shown."""
    scanned = _fence_aware_lines(text)
    heads = [(m.group(1), i) for i, (line, fenced) in enumerate(scanned)
             if not fenced and _leading_spaces(line) <= 3
             for m in [TASK_HEAD.match(line.strip())] if m]
    out = {}
    for n, (tid, start) in enumerate(heads):
        end = heads[n + 1][1] if n + 1 < len(heads) else len(scanned)
        lines = [l for l, _ in scanned[start:end]]
        lines[0] = lines[0].strip()[len('### '):]
        out.setdefault(tid, "\n".join(lines).strip())
    return out


# --------------------------------------------------------------------------- #

def parse_plan_text(text):
    return parse_plan_full(text)[0]


def parse_plan_full(text):
    """`(result, all_tasks)`: the public object `parse_plan_text` answers,
    and beside it every task of the plan -- whatever its `**Type:**` -- with
    the fields the laptop's check and the authoring scripts read and the
    sandbox does not: `body`, `type`, `deletes`, the `claim`,
    `authorized_by` and `proof` slot texts, and `stale_if_entries`."""
    header_lines, task_bodies = _split_plan(text)
    bootstrap_cmd, publish = _parse_header(header_lines)
    checks = _parse_checks(header_lines)
    sections = task_sections(text)

    all_tasks = []
    for tid, title, order, body_lines in task_bodies:
        parsed = _parse_task_body(body_lines)
        all_tasks.append({
            "id": tid,
            "title": title,
            "order": order,
            **parsed,
            "files": sorted(set(parsed["creates"]) | set(parsed["modifies"])),
            "depends_on": [],
            "body": "\n".join(l for l, _ in body_lines).strip(),
        })

    impl = [t for t in all_tasks if _is_implementation(t["type"])]
    ids = [t["id"] for t in impl]

    edges = _build_edges(impl)
    waves_ids = _kahn_layers(ids, edges)

    def public_view(t):
        view = {
            "id": t["id"],
            "title": t["title"],
            # a Delete: path is the task's own too, or the engine's scope rule reads a
            # planned deletion as an amendment (run-263: all 44 amendment rows)
            "files": sorted(set(t["files"]) | set(t["deletes"])),
            "depends_on": t["depends_on"],
            "proofRuns": t["proofRuns"],
            "proofRunClauses": t["proofRunClauses"],
            "interfaces": t["interfaces"],
            "body": sections.get(t["id"], ""),
        }
        return view

    by_id = {t["id"]: t for t in impl}
    tasks_out = [public_view(t) for t in impl]
    dag_edges = [{"from": e["from"], "to": e["to"], "why": e["why"]} for e in edges]
    launch_waves = [[public_view(by_id[i]) for i in wave] for wave in waves_ids]

    return {
        "tasks": tasks_out,
        "dag_edges": dag_edges,
        "launch_waves": launch_waves,
        "checks": checks,
        "bootstrapCmd": bootstrap_cmd,
        "publish": publish,
    }, all_tasks


# --------------------------------------------------------------------------- #
# The Claim's two halves and the plan header -- read by the laptop's check
# and the authoring scripts, never by the sandbox.
# --------------------------------------------------------------------------- #

CLAIMS_GRAMMAR = "claims-v1"
STORIES_GRAMMAR = "stories-v1"
GRAMMARS = (CLAIMS_GRAMMAR, STORIES_GRAMMAR)
GRAMMAR_RE = re.compile(r'^\*\*Grammar:\*\*\s*(\S+)\s*$')
MACHINE_LEAD_RE = re.compile(r'^machine\s*:\s*', re.I)
CLAIM_PROVENANCE_RE = re.compile(
    r'\((elicited|derived|quoted from #(\d+))\)\s*$', re.I)
PLAN_CLAIM_PROVENANCE_RE = re.compile(
    r'\((elicited|quoted from #(\d+))\)\s*$', re.I)


def _header_lines(text):
    """The unfenced-or-not `(line, fenced)` pairs above the first task."""
    out = []
    for line, fenced in _fence_aware_lines(text):
        if (not fenced and _leading_spaces(line) <= 3
                and TASK_HEAD.match(line.strip())):
            break
        out.append((line, fenced))
    return out


def plan_grammar(text):
    """`claims-v1` or `stories-v1` when the header declares one, else None."""
    for line, fenced in _header_lines(text):
        m = None if fenced else GRAMMAR_RE.match(line.strip())
        if m and m.group(1) in GRAMMARS:
            return m.group(1)
    return None


def _plan_claim_raw(text):
    """The header `**Claim:**` sentence, tag attached, wrapped lines joined
    on one space -- it runs to the next blank line, bold marker or fence."""
    value = None
    for line, fenced in _header_lines(text):
        s = line.strip()
        if value is None:
            m = None if fenced else SLOT_RE.match(s)
            if m and _slot_name(m.group(1)) == "claim":
                value = [m.group(2).strip()]
            continue
        if fenced or not s or s.startswith("**"):
            break
        value.append(s)
    return None if value is None else re.sub(r'\s+', ' ', " ".join(value)).strip()


def parse_plan_claim(text):
    """The plan's one operator sentence, tag stripped, or None."""
    raw = _plan_claim_raw(text)
    return None if raw is None else PLAN_CLAIM_PROVENANCE_RE.sub("", raw).strip()


def plan_claim_provenance(text):
    """`elicited`, `quoted:#NNN`, or None (no header Claim, or no tag)."""
    m = PLAN_CLAIM_PROVENANCE_RE.search(_plan_claim_raw(text) or "")
    if m is None:
        return None
    return "quoted:#" + m.group(2) if m.group(2) else "elicited"


def operator_lines(claim):
    """A Claim slot's lines above its `Machine:` restatement."""
    out = []
    for line in claim.splitlines():
        if MACHINE_LEAD_RE.match(line.strip()):
            break
        out.append(line)
    return out


def claim_provenance(claim):
    """A task Claim's tag -- `elicited`, `derived`, `quoted:#NNN` or None --
    read off the whitespace-normalized operator sentence, so a tag an editor
    wrapped across two lines is still a tag."""
    m = CLAIM_PROVENANCE_RE.search(
        re.sub(r'\s+', ' ', " ".join(operator_lines(claim))).strip())
    if m is None:
        return None
    if m.group(2) is not None:
        return "quoted:#" + m.group(2)
    return m.group(1).lower() if m.group(1).lower() == "derived" else "elicited"


def machine_restatement(claim):
    """The Machine half of a Claim slot: the text from the `Machine:` lead-in
    to the end of the slot, lead-in stripped, wrapped lines joined."""
    lines = claim.splitlines()
    for i, line in enumerate(lines):
        if MACHINE_LEAD_RE.match(line.strip()):
            first = MACHINE_LEAD_RE.sub("", line.strip(), count=1)
            return " ".join([first] + [l.strip() for l in lines[i + 1:]]).strip()
    return ""


USAGE = "plan_parse: usage: plan_parse.py <plan.md>\n"


def main(argv):
    args = argv[1:]

    if len(args) != 1:
        sys.stderr.write(USAGE)
        return 2

    plan_path = args[0]
    try:
        with open(plan_path, "r", encoding="utf-8") as fh:
            text = fh.read()
    except OSError as exc:
        sys.stderr.write("plan_parse: cannot read plan: %s\n" % (exc,))
        return 2

    try:
        if plan_grammar(text) == STORIES_GRAMMAR:
            import stories_parse
            try:
                result = stories_parse.parse_stories_text(text)
            except stories_parse.StoriesRefusal as exc:
                sys.stderr.write(str(exc) + "\n")
                return 2
        else:
            result = parse_plan_text(text)
    except Refusal as exc:
        sys.stderr.write(str(exc) + "\n")
        return 2

    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
