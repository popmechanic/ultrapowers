#!/usr/bin/env python3
"""Deterministic compiler for claims-v1 plans.

Parses a plan into tasks (fence-aware), reads each task's disposition from its
`**Type:**` marker (never guessed from prose), builds the dependency DAG
(interface edges, the one existence edge write-after-create — a task cannot
modify a file another task has yet to create, and the non-text same-file tier),
runs Kahn layering with cycle detection, and emits the Step-3 transparency
block as JSON on stdout.

The compiler speaks ONE grammar: claims-v1, declared by a `**Grammar:**
claims-v1` line in the plan header. A plan carrying no such line is refused
with a `grammar:` line before anything else runs — there is no fallback.

The compiler orders only what a task DECLARES. Two tasks whose declared paths
merely overlap are NOT ordered — the kernel folds their same-file edits at
merge time, and a shared path the kernel cannot fold line-wise (the non-text
tier) is the one exception.

What the compiler cannot see it refuses instead of guessing at: an
implementation task that declares no file paths is invisible to contention
detection, so it is a loud compile error rather than an "ambiguous" task.

The orchestrating agent runs this instead of hand-deriving waves; its
judgment is reserved for the derived run knobs (testCmd / baseBranch / tiers /
review depth), which stay with the agent per dependency-analysis.md.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import string
import subprocess
import sys
from pathlib import Path

# scripts -> ultrapowers -> skills -> plugin root; identical to ultra_run.py's
# PLUGIN_ROOT (HERE.parents[2] from the scripts dir).
PLUGIN_ROOT = Path(__file__).resolve().parents[3]

TASK_HEAD = re.compile(r"^### Task ([A-Za-z0-9]+):\s*(.*)$")
FENCE = re.compile(r"^(`{3,}|~{3,})")
MARKER_TYPE = re.compile(r"^\*\*Type:\*\*\s*([a-z]+)\s*$")
# Marker-shaped: bold-prefixed type/depends-on/review label in ANY colon
# position — `**Type:**`, `**type:**`, `**Type :**`, and the colon-outside
# form `**Type**:` all count, so a near-miss never silently degrades to prose.
MARKER_ISH = re.compile(r"^\*\*\s*(type|depends[-\s]on|review|commutes)\s*(?:\*\*)?\s*:", re.I)
# Authored review-depth marker (ultraplan #87): `**Review:** peer|lean`.
# `adversarial` is the pre-#556 spelling of `peer` — still accepted for one
# release, normalized to `peer` on the emitted wave entry so the engine and
# the report only ever see the documented value. Valid values are enforced
# where it is consumed in parse_task — an invalid or duplicate value is a
# compile-time SystemExit, never a silent default.
MARKER_REVIEW = re.compile(r"^\*\*Review:\*\*\s*([a-z-]+)\s*$")
VALID_REVIEWS = ("peer", "lean")
REVIEW_ALIASES = {"adversarial": "peer"}
FILE_LINE = re.compile(r"^-\s*(Create|Modify|Delete|Test|Test fixture\(s\)|Fixture\(s\)):\s*(.+)$")
# A Proof `Run:` bullet (#589): the task's proof is a COMMAND, not an exam
# file. Deliberately NOT a FILE_LINE alternative — a `Run:` value is never a
# path, so it must never reach the Files parser, the disjointness set, or
# derive_task_test_cmd. It rides verbatim to the engine, which executes it in
# the task's clone through the same `sh` seam as the run-wide test command.
RUN_LINE = re.compile(r"^-\s*Run:\s*(.+)$")
# A Proof `Guard:` bullet (#777): the exam path a task asserts it holds the
# guard on — the file it is answerable for keeping honest. Like `Run:`, it is
# deliberately NOT a FILE_LINE alternative: a `Guard:` names no NEW obligation
# the compiler enforces, so it must never reach proof_tests, derive_task_test_
# cmd, or the disjointness set. It rides to the wave entry as `proofGuards`
# and never earns a `grammar:` refusal.
GUARD_LINE = re.compile(r"^-\s*Guard:\s*(.+)$")
# Files-entry near-misses (`- Modify : x`, `- create: x`, `* Modify: x`) inside an open Files
# block would otherwise drop silently — losing a write path and with it the
# overlap edge that prevents a same-wave write race.
FILE_ISH = re.compile(r"^[-*+]\s*(create|modify|test)\s*:", re.I)
# A Files-block bullet carrying a `Label: value` shape (ANY label, canonical or
# not), used ONLY to feed _files_violations the verbatim (label, rest) pairs.
# A colon-less natural-English bullet ("- Modify the config") does not match and
# stays a soft near-miss; `- none` is filtered by the caller before capture.
FILES_LABEL_LINE = re.compile(r"^[-*+]\s*([A-Za-z][A-Za-z0-9()/ _-]*?)\s*:\s*(.+?)\s*$")
FILES_ISH = re.compile(r"^\*\*\s*files\s*(?:\*\*)?\s*:", re.I)
PATH_RE = re.compile(r"`([^`]+)`")
# Whether a Files-entry token names a file, vs a bare identifier (function name),
# a dotted attribute reference (`schema.User`), or a route. Files entries are
# declared to list paths, so the rule keeps real paths and rejects identifier-
# shaped tokens; admitting an identifier as a write fabricates spurious
# write-after-write overlap between unrelated tasks.
# Real extensions are 1-8 alphanumerics, matched case-insensitively — but ONLY
# when the extension is all-lowercase (`config.yaml`) or all-uppercase
# (`Config.YAML`, `x.SQL`). A mixed-case tail (`schema.User`, `Foo.Bar`) is a
# dotted attribute reference, not a file. Erring toward "path" is the safe
# direction: a false write-set entry costs parallelism (an extra edge); a
# DROPPED write-set entry lets two tasks modify one file in the same wave.
EXT_RE = re.compile(r"\.([A-Za-z0-9]{1,8})$")


def _is_pathlike(tok):
    t = tok.strip().rstrip(",;").split(":", 1)[0].strip()  # drop a :line-range
    if not t:
        return False
    if "/" in t:
        return True                       # a relative/absolute path
    if t.startswith(".") and len(t) > 1 and " " not in t:
        return True                       # dotfile: .gitignore, .dockerignore, .gitattributes
    m = EXT_RE.search(t)
    if m:
        ext = m.group(1)
        if ext == ext.lower() or ext == ext.upper():
            return True                   # real extension (any case), not Mixed.Case
    # A bare extensionless filename by convention is Capitalized or ALL-CAPS with
    # no dot and no underscore (Makefile, Dockerfile, LICENSE, README, Jenkinsfile)
    # — distinct from snake_case identifiers (cmd_apply_create, _build_parser) and
    # dotted attribute refs (schema.User, Foo.Bar), which are dropped.
    if "." not in t and "_" not in t and t[:1].isalpha() and (t[0].isupper() or t.isupper()):
        return True
    return False


def match_head(line):
    """The single source of truth for task headings: TASK_HEAD on the
    stripped text, accepting CommonMark's up-to-3 leading spaces. Used by
    BOTH split_tasks and the malformed-heading net so a heading can never
    pass one and fail the other (a raw/stripped mismatch silently folded
    indented tasks into their predecessor)."""
    if len(line) - len(line.lstrip(" ")) > 3:
        return None
    return TASK_HEAD.match(line.strip())

# The four dispositions a `**Type:**` marker may name. There is no other way
# in: a disposition is READ from the marker, never guessed from prose.
TYPES = ("implementation", "gate", "release", "manual")


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


# A non-`### Task` heading that NAMES a gate/acceptance SECTION (`## Final Gate`,
# `## Acceptance exam`) is a section boundary, not task content: it CLOSES the
# current task so its `**Type:**`/`**Depends-on:**` markers no longer fold into
# the preceding task's body as stray late_markers ([c682212cdeb736ad]). Task
# headings (`### Task N:`) are matched FIRST in split_tasks, so a
# `### Task 4: Suite gate` stays a task and is never treated as a boundary.
GATE_SECTION_HEAD = re.compile(r"^#{1,4}\s+.*\b(gate|acceptance)\b", re.I)


def split_tasks(text):
    lines = list(_fence_aware_lines(text))
    heads, gate_boundaries = [], []
    for i, (line, fenced) in enumerate(lines):
        if fenced:
            continue
        h = match_head(line)
        if h:
            heads.append((h.group(1), h.group(2).strip(), i))
        elif GATE_SECTION_HEAD.match(line.strip()):
            # A recognized non-task gate/acceptance section: captured only as a
            # boundary that ends the preceding task (it writes nothing — its
            # content is excluded from every task body).
            gate_boundaries.append(i)
    tasks = []
    for n, (tid, title, start) in enumerate(heads):
        next_head = heads[n + 1][2] if n + 1 < len(heads) else len(lines)
        # End at the next task heading OR the first gate/acceptance section
        # boundary that opens after this task starts — whichever comes first.
        end = min([next_head] + [b for b in gate_boundaries if start < b < next_head])
        body = "\n".join(l for l, _ in lines[start:end]).strip()
        tasks.append({"id": tid, "title": title, "body": body, "order": n})
    return tasks


# ---------------------------------------------------------------------------
# claims-v1 (spec 2026-08-31 §3-§4). The ONLY grammar the compiler speaks,
# declared by a `**Grammar:** claims-v1` line in the plan header. A plan that
# carries no such line is refused, not parsed some other way: there is no
# second grammar left to fall back to.
#
# Every diagnostic this section can emit is namespaced `grammar:`, the missing
# header's refusal included, so a grammar refusal reads as one wherever it
# surfaces.
# ---------------------------------------------------------------------------
CLAIMS_GRAMMAR = "claims-v1"
# The declaration line, matched on the plan HEADER only (everything before the
# first task heading) and fence-aware, so a plan that merely quotes or fences
# the line — this repo's own spec and plan docs do — is not silently switched
# into a grammar it was not written in.
GRAMMAR_RE = re.compile(r"^\*\*Grammar:\*\*\s*(\S+)\s*$")

# The six body slots, in the one legal order. There is no Steps slot: under
# claims-v1 there is nowhere for procedure to live, which is the point.
CLAIMS_SLOTS = ("Claim", "Authorized-by", "Interfaces", "Context", "Proof",
                "Stale-if")
# A slot label line. Both bold-colon forms are recognized (`**Claim:**` and
# `**Claim**:`) and the name is matched case/space-insensitively, so a
# near-miss label surfaces as a slot-shape refusal instead of degrading into
# prose that silently empties the slot.
SLOT_LABEL_RE = re.compile(
    r"^\*\*\s*(claim|authorized[-\s]?by|interfaces|context|proof|stale[-\s]?if)"
    r"\s*(?::\s*\*\*|\*\*\s*:)\s*(.*)$", re.I)
# The provenance tag closing the Claim's operator sentence: the signature is
# over a quote at signing time (§4.4), so the FORM is the compiler's business
# and resolution is the provenance script's.
# `(derived)` is the third form (#552): the task's sentence descends from the
# plan's ONE elicited operator sentence, so it is signed by that signature and
# there is nothing here to resolve.
CLAIM_PROVENANCE_RE = re.compile(
    r"\((elicited|derived|quoted from #(\d+))\)\s*$", re.I)
# Stale-if is a predicate, not prose — a free sentence here is undecidable and
# is refused (§3).
STALE_PREDICATE_RE = re.compile(
    r"^(path-exists|path-absent|sha-matches|issue-open|issue-closed):")
# The two body tiers claims-v1 does not sign. Ordering is DERIVED (Interfaces,
# Files), never declared, so the lines may not appear at all — matched in the
# same any-colon-position way MARKER_ISH is, so a near-miss cannot slip past.
CLAIMS_REFUSED_MARKERS = (
    ("Depends-on", re.compile(r"^\*\*\s*depends[-\s]on\s*(?:\*\*)?\s*:", re.I),
     "ordering is derived from Interfaces and Files, never declared"),
    ("Commutes", re.compile(r"^\*\*\s*commutes\s*(?:\*\*)?\s*:", re.I),
     "same-path overlap is derived from Files, never declared"),
)
CLAIMS_STEP_RE = re.compile(r"^[-*+]\s*\[[ xX]\]")


def plan_grammar(md_text):
    """The grammar a plan declares — always "claims-v1", or a refusal.

    The header (everything before the first task heading, fence-aware) must
    carry `**Grammar:** claims-v1`. Anything else — no line at all, or a line
    naming another grammar — raises SystemExit with a `grammar:` refusal: the
    legacy grammar is gone, so an undeclared plan is refused here, before any
    task is parsed and before any VM is spent on it."""
    declared = None
    for line, fenced in _fence_aware_lines(md_text):
        if fenced:
            continue
        if match_head(line):
            break  # the header ends at the first task heading
        m = GRAMMAR_RE.match(line.strip())
        if m:
            declared = m.group(1)
            if declared == CLAIMS_GRAMMAR:
                return CLAIMS_GRAMMAR
    raise SystemExit(
        "grammar: the plan header carries no `**Grammar:** %s` line%s — the "
        "compiler speaks %s and nothing else; add the header line above the "
        "first task heading"
        % (CLAIMS_GRAMMAR,
           "" if declared is None else " (it declares %r)" % (declared,),
           CLAIMS_GRAMMAR))


# The plan-level Claim (#552): ONE operator sentence above the first task, in
# the operator's words, about what they will see after the run. It closes
# `(elicited)` when the operator said it to the authoring agent and
# `(quoted from #NNN)` when an issue already carries that sentence verbatim
# (#755) — the same two signing forms a task Claim takes. `(derived)` is not
# among them: there is nothing above the header to descend from.
# The FORM is the compiler's business; resolving `#NNN` is the provenance
# script's (§4.4), exactly as for a task-level quote.
PLAN_CLAIM_PROVENANCE_RE = re.compile(
    r"\((elicited|quoted from #(\d+))\)\s*$", re.I)


def _plan_header_value(md_text, read_label):
    """The value of one bold header line, or None when the header carries none.

    The header is everything before the first task heading (the same fence-aware
    scan `plan_grammar` runs), so a matching line in a task body is not a
    plan-level declaration and neither is one inside a fence. The value may wrap:
    it runs to the next blank line, the next bold marker, or the end of the
    header, and the wrapped lines join on a single space. `read_label` is given
    each stripped header line and returns the value that follows its label, or
    None when the line is not the one being read."""
    value_lines = None
    for line, fenced in _fence_aware_lines(md_text):
        if fenced:
            if value_lines is not None:
                break
            continue
        if match_head(line):
            break  # the header ends at the first task heading
        stripped = line.strip()
        if value_lines is None:
            value = read_label(stripped)
            if value is not None:
                value_lines = [value.strip()]
            continue
        if not stripped or stripped.startswith("**"):
            break
        value_lines.append(stripped)
    if value_lines is None:
        return None
    return re.sub(r"\s+", " ", " ".join(value_lines)).strip()


def _claim_label(stripped):
    m = SLOT_LABEL_RE.match(stripped)
    return m.group(2) if m and _claims_slot_name(m.group(1)) == "Claim" else None


def _plan_claim_raw(md_text):
    """The header `**Claim:**` sentence with its tag still attached, or None."""
    return _plan_header_value(md_text, _claim_label)


def parse_plan_claim(md_text):
    """The plan's one operator sentence, tag stripped, or None when the header
    carries no `**Claim:**` line. A task Claim marked `(derived)` descends from
    this sentence; it is a plan-level fact and is never part of a task's
    gate-input hash."""
    raw = _plan_claim_raw(md_text)
    if raw is None:
        return None
    return PLAN_CLAIM_PROVENANCE_RE.sub("", raw).strip()


def plan_claim_provenance(md_text):
    """The header Claim's provenance string — `"elicited"` or `"quoted:#NNN"`,
    the same shapes a task-level tag parses to — or None when the header
    carries no `**Claim:**` line, or one whose tag this grammar does not know
    (which `plan_claim_violations` refuses)."""
    raw = _plan_claim_raw(md_text)
    if raw is None:
        return None
    m = PLAN_CLAIM_PROVENANCE_RE.search(raw)
    if m is None:
        return None
    return "quoted:#" + m.group(2) if m.group(2) else "elicited"


def plan_claim_violations(md_text):
    """The plan-level Claim's own `grammar:` refusals. Empty when the header
    carries none at all — a plan without a header Claim parses exactly as it
    did before #552."""
    raw = _plan_claim_raw(md_text)
    if raw is None:
        return []
    if not PLAN_CLAIM_PROVENANCE_RE.search(raw):
        return ["grammar: plan-level Claim carries no provenance tag — the one "
                "operator sentence above the first task is elicited or quoted "
                "from an issue, and closes `(elicited)` or "
                "`(quoted from #NNN)`"]
    if not parse_plan_claim(md_text):
        return ["grammar: plan-level Claim carries no operator sentence — the "
                "header Claim is nothing but its `(elicited)` or "
                "`(quoted from #NNN)` tag"]
    return []


# The plan-declared exam command (#644): a project whose exams the built-in
# shape table cannot name still has a runner, and the plan is where its
# operator says so — one header line beside `**Tech Stack:**`, a template whose
# `{paths}` stands for a task's own Proof `Test:` paths. The template is the
# operator's own text (`npx vitest run {paths}`, `go test {paths}`); the
# compiler pins the token count and nothing else about it.
EXAM_COMMAND_LABEL_RE = re.compile(
    r"^\*\*\s*exam[-\s]?command\s*(?::\s*\*\*|\*\*\s*:)\s*(.*)$", re.I)
EXAM_PATHS_TOKEN = "{paths}"

# What a word of the declared template may be spelled with (#716). The sandbox
# reads the template as ONE RUNNER AND ITS ARGUMENTS: `ultra_run.py`'s
# `runner_for` takes `cmd.split()[0]` for a command its `TASK_RUNNERS` table
# does not know and probes it with `/bin/sh -c 'command -v <word>'`. This class
# admits what a runner and its flags are spelled with (`-q`, `--tb=short`,
# `./...`, `pkg:test`, `a,b`) and excludes every shell operator, quote and
# expansion character — a `;`, `|`, `$(`, `>` or quote anywhere on the line
# means the first word is not necessarily what runs the suite, so the template
# is refused rather than handed to a shell that reads it differently.
EXAM_RUNNER_WORD = re.compile(r"^[A-Za-z0-9_.+/=:@,-]+$")
EXAM_RUNNER_WORD_NOTE = (" is not a command word — the sandbox reads the "
                         "template as one runner and its arguments, probing "
                         "the first word with command -v")


def _exam_command_label(stripped):
    m = EXAM_COMMAND_LABEL_RE.match(stripped)
    return m.group(1) if m else None


def parse_exam_command(md_text):
    """The plan's `**Exam command:**` template, or None when the header carries
    no such line — in which case every task's command derives from the built-in
    shape table exactly as it did before #644."""
    return _plan_header_value(md_text, _exam_command_label)


def _exam_runner_word_violation(template):
    """The first word of the template that is not a command word, or None.

    The rule is word by word over the value split on whitespace: every word is
    the `{paths}` token itself or matches `EXAM_RUNNER_WORD`, and the first
    word is never `{paths}` — a template whose runner is the paths token names
    no runner at all."""
    for index, word in enumerate(template.split()):
        if word == EXAM_PATHS_TOKEN:
            if index == 0:
                return word
            continue
        if not EXAM_RUNNER_WORD.match(word):
            return word
    return None


def exam_command_violations(md_text):
    """The declared template's own refusals, in the order a reader meets them:
    a backtick anywhere (the same species, the same wording, as a `Run:`/
    `Check:` command's — the driver's shell would read it as a command
    substitution), then a word that is not a command word, then the `{paths}`
    count. `{paths}` is the substitution's whole contract: zero occurrences and
    the template runs the same files for every task (or none at all), two and
    the substitution is ambiguous."""
    template = parse_exam_command(md_text)
    if template is None:
        return []
    if "`" in template:
        return [_backtick_command_violation("Exam command", template)]
    offender = _exam_runner_word_violation(template)
    if offender is not None:
        return ["exam-command: %s%s" % (offender, EXAM_RUNNER_WORD_NOTE)]
    if template.count(EXAM_PATHS_TOKEN) != 1:
        return ["exam-command: the template must carry %s exactly once"
                % EXAM_PATHS_TOKEN]
    return []


# The plan-declared dependencies: the packages a run needs are DECLARED by the
# operator on one header line beside `**Tech Stack:**` and `**Exam command:**`,
# never discovered by a task editing a manifest. One line, space-separated
# package specs, the single word `dev:` marking where the development-only
# group begins:
#
#     **Dependencies:** tailwindcss@^4 @tailwindcss/vite dev: eslint @shadcn/lint
#
# Like the exam command, the label is read case-insensitively in both bold
# spellings and the value may wrap (`_plan_header_value` joins it on spaces).
DEPENDENCIES_LABEL_RE = re.compile(
    r"^\*\*\s*dependencies\s*(?::\s*\*\*|\*\*\s*:)\s*(.*)$", re.I)
# The one group marker; every word after it is development-only.
DEPENDENCIES_DEV_MARKER = "dev:"

# What a spec may be spelled with. A spec is `name` or `name@range`, where the
# name carries an optional `@scope/`. Both classes are CLOSED on purpose: the
# engine hands each spec to `bash -lc` as one single-quoted word, so no quote,
# space, `;`, `|`, `$`, `<`, `>`, `*` or backtick may appear in one — which
# refuses a range like `>=1.2` and admits `^4`, `~1.2`, `4.x`, `==1.0`.
DEPENDENCY_NAME_RE = re.compile(r"^(@[A-Za-z0-9_.-]+/)?[A-Za-z0-9_.-]+$")
DEPENDENCY_RANGE_RE = re.compile(r"^[A-Za-z0-9_.^~=+-]+$")


def _dependencies_label(stripped):
    m = DEPENDENCIES_LABEL_RE.match(stripped)
    return m.group(1) if m else None


def parse_dependencies(md_text):
    """The plan's declared packages as `{"runtime": [...], "dev": [...]}`, or
    None when the header carries no `**Dependencies:**` line — in which case
    nothing downstream sees the key at all and the run installs exactly what it
    installed before.

    The words before the first `dev:` word are the runtime group, in order; the
    words after it are the development group, in order; either list is [] when
    its group is empty. A second `dev:` word is a refusal (below), not a second
    split: it stays a word of the development group here so the violation
    names it rather than silently re-partitioning the line."""
    value = _plan_header_value(md_text, _dependencies_label)
    if value is None:
        return None
    words = value.split()
    if DEPENDENCIES_DEV_MARKER in words:
        cut = words.index(DEPENDENCIES_DEV_MARKER)
        return {"runtime": words[:cut],
                "dev": [w for w in words[cut + 1:]
                        if w != DEPENDENCIES_DEV_MARKER]}
    return {"runtime": words, "dev": []}


def dependencies_violations(md_text):
    """The declared line's own refusals, in the order a reader meets them: each
    word that is not a package spec, then a second `dev:` word, then a line
    that names no package at all. Empty for an absent line and for a
    well-formed one — a plan without the line is refused nothing."""
    value = _plan_header_value(md_text, _dependencies_label)
    if value is None:
        return []
    words = value.split()
    violations = [
        "dependencies: %s is not a package spec — a spec is `name` or "
        "`name@range`, and the engine quotes it as one word for the shell, so "
        "no space, quote or shell operator may appear in it" % word
        for word in words
        if word != DEPENDENCIES_DEV_MARKER and not _is_package_spec(word)]
    if words.count(DEPENDENCIES_DEV_MARKER) > 1:
        violations.append(
            "dependencies: a second `dev:` word — the line carries one `dev:` "
            "marker, and every word after it is development-only")
    groups = parse_dependencies(md_text)
    if not groups["runtime"] and not groups["dev"]:
        violations.append(
            "dependencies: the line names no package — a declared line "
            "declares at least one, before the group marker or after it")
    return violations


def _is_package_spec(word):
    """Whether one word of the declared line is `name` or `name@range`.

    The split is on the LAST `@`, and a leading `@` is a scope rather than a
    range separator: `@scope/pkg@^1` is the scoped name `@scope/pkg` at range
    `^1`, and `@scope/pkg` is that name at no range."""
    name, sep, spec_range = word.rpartition("@")
    if not sep or not name:
        name, spec_range = word, None
    if not DEPENDENCY_NAME_RE.match(name):
        return False
    return spec_range is None or bool(DEPENDENCY_RANGE_RE.match(spec_range))


def _claims_slot_name(raw):
    """Canonical slot name for a matched label (`stale if` -> `Stale-if`)."""
    key = re.sub(r"[\s-]+", "-", raw.strip().lower())
    return next(s for s in CLAIMS_SLOTS if s.lower() == key)


def _claims_file_paths(value):
    """The path(s) a Files-style bullet value names: backticked path-like
    tokens, else the first token when it is itself path-like."""
    backticked = [p for p in PATH_RE.findall(value) if _is_pathlike(p)]
    if backticked:
        paths = backticked
    else:
        tokens = value.strip().split()
        first = tokens[0].rstrip(",;") if tokens else ""
        paths = [first] if _is_pathlike(first) else []
    return [p.split(":")[0] for p in paths if p]


# A whole-value backtick wrapper, the one rewrite a `Run:` command undergoes:
# `- Run: `node check.mjs --strict`` names the same command as the bare form.
# The `[^`]+` body is what keeps it a WHOLE-value rule — a command carrying
# backticks inside it (`node -e "console.log(`hi`)"`) does not match and rides
# untouched.
WHOLLY_BACKTICKED = re.compile(r"^`([^`]+)`$")


def _claims_run_command(value):
    """The command a Proof `Run:` bullet names, verbatim.

    Leading and trailing whitespace is stripped and a whole-value backtick
    wrapper removed — as a `Test:` value's backticks are — and nothing else is
    altered. Internal spacing, quoting and shell metacharacters survive
    exactly, because the driver runs this string, not a re-rendering of it."""
    command = value.strip()
    m = WHOLLY_BACKTICKED.match(command)
    return m.group(1).strip() if m else command


def command_names_path(command, path):
    """True when `command` names `path` as a WHOLE token.

    The boundary class is the path alphabet itself — word characters, `.`, `/`
    and `-` — so a command naming `fleet/tests/a.mjs.bak` does not name
    `fleet/tests/a.mjs`, while one naming it inside quotes, a pipeline or a
    `$(...)` does. Deliberately not a shell split: `test "$(grep -c x path)"`
    glues `)"` to the path, and splitting on whitespace would hide it."""
    if not path:
        return False
    return re.search(r"(?<![\w./-])" + re.escape(path) + r"(?![\w./-])",
                     command) is not None


def task_files(t):
    """Every path a task's Files block claims: `Create:`, `Modify:`,
    `Delete:` and `Test:` alike. The `Test:` half counts because a task owns
    the exam it names as surely as the code — a command that runs it is a
    command that waits on that task."""
    return (set(t.get("creates") or []) | set(t.get("modifies") or [])
            | set(t.get("deletes") or []) | set(t.get("reads") or []))


# A backtick SURVIVING that unwrap is not decoration: the driver runs these
# strings through a shell, which reads `...` as a command substitution and
# executes it (#616's comment of 2026-09-04, run-74). The plan cannot mean
# that, so both the Proof `Run:` bullet and the Global-Constraints `- Check:`
# bullet REFUSE it rather than advise about it — one wording, two callers, so
# an author who learns to read one has learned to read the other.
BACKTICK_COMMAND_NOTE = ("; the driver's shell reads it as a command "
                         "substitution (run-74)")


def _backtick_command_violation(kind, command, task_id=None):
    """The `grammar:` line a `Run:`/`Check:` command carrying a backtick draws.

    `kind` is the bullet's own label (`Run` or `Check`); `task_id` is the task
    a `Run:` belongs to, and None for a `Check:`, which is plan-level and
    belongs to no task. The command is quoted to its first 80 characters — long
    enough to name which bullet, short enough to keep the refusal one line."""
    where = "" if task_id is None else "task %s: " % task_id
    return ("grammar: %s: command carries a backtick — %s%s%s"
            % (kind, where, command[:80], BACKTICK_COMMAND_NOTE))


# One claim, one prover: an exam proves its own claim and never spawns a test
# runner over its neighbours, because regression is the fold's one suite run
# per merge (19 of 29 fixture exam files spawned runners; the fold suite grew
# from 2.4 to 19 minutes). A Proof `Run:` that names two exams at once — or the
# bare `tests/state-exams` directory, which names all of them — is that sweep
# written into the plan, so the compiler refuses it where an author can still
# split it. The boundary is `command_names_path`'s alphabet, so a path inside
# quotes, a pipeline or a `$(...)` counts and `tests/state-examsx/a` does not;
# `tests/state-exams/a.test.ts.bak` is its own path, not `a.test.ts`.
STATE_EXAM_PATH_RE = re.compile(
    r"(?<![\w./-])tests/state-exams(?:/[\w./-]*)?(?![\w./-])")
# The two spellings of the directory itself — a sweep over every exam there is.
STATE_EXAM_DIR_TOKENS = ("tests/state-exams", "tests/state-exams/")
# The refusal's own lead-in, named once: `_exam_sweep_run_violation` builds the
# line with it and `--check` finds the line by it, so the wording an author
# reads and the wording the error channel carries cannot drift apart.
EXAM_SWEEP_REFUSAL = "grammar: Run: one Run, one exam"


def _exam_sweep_run_violation(command, task_id):
    """The `grammar:` line a Proof `Run:` sweeping `tests/state-exams/` draws.

    `None` unless the command names, as whole tokens, either two or more
    distinct paths under `tests/state-exams/` or the bare directory. A single
    exam path is the shape this rule exists to leave alone, and `Check:` lines
    are not read by it at all — a sweep the operator wants is written once in
    the owning task's own `Run:`. The command is quoted to its first 80
    characters, as the backtick refusal quotes it."""
    seen = []
    for match in STATE_EXAM_PATH_RE.findall(command):
        if match not in seen:
            seen.append(match)
    bare = any(token in STATE_EXAM_DIR_TOKENS for token in seen)
    files = [token for token in seen if token not in STATE_EXAM_DIR_TOKENS]
    if not bare and len(files) < 2:
        return None
    return ("%s — task %s: %s names %d paths under tests/state-exams/"
            % (EXAM_SWEEP_REFUSAL, task_id, command[:80], len(seen)))


# --- Clause-to-leg citation (#554) -------------------------------------------
# run-51's proof gate rejected 11 of 24 pairs, every one for a gap a parser can
# see: a Machine clause no leg examined, a universal or negation no leg could
# falsify, an enumerated row without its own leg. So the grammar lets the
# Machine line NUMBER its clauses (`M1. … M2. …`) and every Proof leg CITE the
# clause it establishes (`[M2]`). The citation grammar is active for a task
# exactly when its Machine line carries a clause marker; an unnumbered Machine
# line (every plan authored before #554) parses as it always did. Under the
# active grammar the mechanical gaps are refusals — a clause no leg cites, a
# leg citing nothing or a clause that does not exist — and the judgment calls
# beyond them (a universal whose citing legs name nothing that fails, an
# enumerated clause with one citing leg) are the gate agent's to make, with
# the mechanical gaps already closed.
MACHINE_LEAD_RE = re.compile(r"^machine\s*:\s*", re.I)
# A clause marker: `M<n>.` followed by whitespace, not glued to a word or a
# backtick (so `M1.5` in a literal or `xM2.` never marks a clause).
CLAUSE_MARK_RE = re.compile(r"(?<![\w`])M(\d+)\.(?=\s)")
# A leg's citation: `[M2]` or `[M1, M3]`; several brackets per leg all count.
LEG_CITE_RE = re.compile(r"\[\s*(M\d+(?:\s*,\s*M\d+)*)\s*\]")
LEG_LABEL_RE = re.compile(r"\(([a-z])\)")
LEGS_LEAD_RE = re.compile(r"(?m)^[-*+]?\s*legs?\s*:\s*", re.I)
BULLET_RE = re.compile(r"^[-*+]\s+")


def machine_restatement(claim):
    """The Machine half of a Claim slot: the text from the `Machine:` lead-in
    to the end of the slot, lead-in stripped, wrapped lines joined."""
    lines = claim.splitlines()
    for i, line in enumerate(lines):
        if MACHINE_LEAD_RE.match(line.strip()):
            first = MACHINE_LEAD_RE.sub("", line.strip(), count=1)
            return " ".join([first] + [l.strip() for l in lines[i + 1:]]).strip()
    return ""


def parse_machine_clauses(machine):
    """The numbered clauses of a Machine restatement.

    Returns `(clauses, numbering_error)`: `clauses` is a list of
    `{"id": "M1", "text": ...}` in text order, empty when the line carries no
    marker at all (the citation grammar is then inactive); `numbering_error`
    names the markers found when they are not exactly M1, M2, … in order."""
    marks = list(CLAUSE_MARK_RE.finditer(machine))
    if not marks:
        return [], None
    numbers = [int(m.group(1)) for m in marks]
    error = None
    if numbers != list(range(1, len(numbers) + 1)):
        error = ", ".join("M%d" % n for n in numbers)
    clauses = []
    for k, m in enumerate(marks):
        end = marks[k + 1].start() if k + 1 < len(marks) else len(machine)
        clauses.append({"id": "M%d" % numbers[k],
                        "text": machine[m.end():end].strip()})
    return clauses, error


def parse_proof_legs(proof):
    """The legs of a Proof slot, each with the clauses it cites.

    Prose only: fenced code and `Test:` bullets are not legs. Legs are split on
    sequential `(a)`, `(b)`, … labels when the Proof uses them — only the NEXT
    expected label splits, so a leg that says "as (a) but …" is not cut at the
    back-reference — else each bullet is a leg (ordinals `#1`, `#2`), else the
    whole prose is one leg. A leg's `cites` are the sorted distinct ids inside
    its `[M…]` brackets."""
    kept = []
    for line, fenced in _fence_aware_lines(proof):
        if fenced:
            continue
        stripped = line.strip()
        if not stripped:
            continue
        f = FILE_LINE.match(stripped)
        if f and f.group(1) == "Test":
            continue
        # A `Run:` bullet names the proof, it does not argue it (#589) — so it
        # is skipped exactly as a `Test:` bullet is, and the prose legs around
        # it keep numbering from #1.
        if RUN_LINE.match(stripped):
            continue
        kept.append(stripped)
    text = LEGS_LEAD_RE.sub("", "\n".join(kept))
    starts, expected = [], "a"
    for m in LEG_LABEL_RE.finditer(text):
        if m.group(1) == expected:
            starts.append((expected, m.start(), m.end()))
            expected = chr(ord(expected) + 1)
    legs = []
    if starts:
        for k, (label, _, en) in enumerate(starts):
            end = starts[k + 1][1] if k + 1 < len(starts) else len(text)
            legs.append(("(%s)" % label, text[en:end].strip()))
    else:
        bullets = []
        for line in text.splitlines():
            if BULLET_RE.match(line):
                bullets.append(BULLET_RE.sub("", line))
            elif bullets:
                bullets[-1] += " " + line
        if bullets:
            legs = [("#%d" % (i + 1), b.strip()) for i, b in enumerate(bullets)]
        elif text.strip():
            legs = [("#1", text.strip())]
    out = []
    for label, body in legs:
        cites = {c.strip() for m in LEG_CITE_RE.finditer(body)
                 for c in m.group(1).split(",")}
        out.append({"label": label, "text": body,
                    "cites": sorted(cites, key=lambda c: int(c[1:]))})
    return out


def _short(s, n=80):
    s = re.sub(r"\s+", " ", s).strip()
    return s if len(s) <= n else s[:n - 1] + "…"


def clause_citation_violations(task_id, clauses, numbering_error, legs):
    """The `grammar:` refusals the citation grammar draws for one task; []
    when the grammar is inactive (no clause marker on the Machine line)."""
    v = []
    if numbering_error:
        v.append("grammar: Machine clauses must be numbered M1, M2, … "
                 "consecutively — task %s: found %s" % (task_id, numbering_error))
    if not clauses:
        return v
    ids = {c["id"] for c in clauses}
    span = "M1" if len(clauses) == 1 else "M1–M%d" % len(clauses)
    for leg in legs:
        if not leg["cites"]:
            v.append("grammar: Proof leg cites no Machine clause — task %s, leg "
                     "%s: %s; end the leg with the clause it establishes "
                     "(`[M1]`)" % (task_id, leg["label"], _short(leg["text"])))
        for c in leg["cites"]:
            if c not in ids:
                v.append("grammar: Proof leg cites an unknown clause — task %s, "
                         "leg %s cites %s; the Machine line numbers %s"
                         % (task_id, leg["label"], c, span))
    cited = {c for leg in legs for c in leg["cites"]}
    for c in clauses:
        if c["id"] not in cited:
            v.append("grammar: Machine clause %s has no citing Proof leg — task "
                     "%s: %s" % (c["id"], task_id, _short(c["text"])))
    return v


def parse_claims_body(body, task_id, plan_claim=None):
    """Parse one claims-v1 task body into its six slots.

    `plan_claim` is the plan's header Claim (`parse_plan_claim`) or None. It is
    the ONLY thing this function knows about the document around the body, and
    it decides exactly one question: whether a `(derived)` tag has a signature
    to descend from. The header sentence itself never enters a slot, so it
    never reaches `gate_input_hash`.

    Returns the slot texts under the keys `claim`, `authorized_by`,
    `interfaces`, `context`, `proof`, `stale_if` (each the slot's raw text,
    label stripped), the `claim_provenance` tag ("elicited" | "quoted:#NNN" |
    None), the parsed `stale_if_entries` / `proof_tests`, and every grammar
    `violations` message the body earns. The function is pure: it reads the
    body and nothing else (§4.4 keeps the compiler a pure function — anchor
    and quote RESOLUTION is the provenance script's job, not this one's)."""
    lines = list(_fence_aware_lines(body))
    violations = []

    found = []  # (line index, canonical name, inline remainder)
    for i, (line, fenced) in enumerate(lines):
        if fenced:
            continue
        m = SLOT_LABEL_RE.match(line.strip())
        if m:
            found.append((i, _claims_slot_name(m.group(1)), m.group(2).strip()))

    slots, ranges = {}, {}
    for n, (i, name, inline) in enumerate(found):
        end = found[n + 1][0] if n + 1 < len(found) else len(lines)
        text = "\n".join(([inline] if inline else [])
                         + [l for l, _ in lines[i + 1:end]]).strip()
        # First occurrence wins; a duplicate label is caught as a slot-shape
        # violation below rather than silently overwriting a filled slot.
        slots.setdefault(name, text)
        ranges.setdefault(name, (i, end))

    # Slot shape: exactly six, in order, none empty.
    seen = [name for _, name, _ in found]
    for idx, expected in enumerate(CLAIMS_SLOTS):
        actual = seen[idx] if idx < len(seen) else None
        if actual != expected:
            violations.append(
                "grammar: expected slot **%s:** in task %s, %s — the body is "
                "exactly %s, in that order"
                % (expected, task_id,
                   "found **%s:**" % actual if actual else "slot missing",
                   ", ".join(CLAIMS_SLOTS)))
            break
    else:
        if len(seen) > len(CLAIMS_SLOTS):
            violations.append(
                "grammar: expected slot list to end at **Stale-if:** in task "
                "%s, found a further **%s:** — the body is exactly %s, in that "
                "order" % (task_id, seen[len(CLAIMS_SLOTS)],
                           ", ".join(CLAIMS_SLOTS)))
    for name in CLAIMS_SLOTS:
        if name in slots and not slots[name]:
            violations.append(
                "grammar: expected slot **%s:** in task %s to carry content, "
                "found it empty" % (name, task_id))

    # No Steps: procedure is unsayable under claims-v1 (§7 Fate A).
    step = next((line.strip() for line, fenced in lines
                 if not fenced and CLAIMS_STEP_RE.match(line.strip())), None)
    if step is not None:
        violations.append(
            "grammar: Steps are not a slot — task %s carries a checkbox step "
            "(%s); claims-v1 has no Steps slot" % (task_id, step))

    # The two refused body markers.
    for label, pattern, why in CLAIMS_REFUSED_MARKERS:
        if any(pattern.match(line.strip()) for line, fenced in lines
               if not fenced):
            violations.append(
                "grammar: %s is not signed under claims-v1 — task %s: %s"
                % (label, task_id, why))

    # Fences are legal in Proof and nowhere else: Proof is the exam, every
    # other slot is prose the gate reads.
    proof_start, proof_end = ranges.get("Proof", (len(lines), len(lines)))
    stray = next((i for i, (line, _) in enumerate(lines)
                  if FENCE.match(line.strip())
                  and not proof_start <= i < proof_end), None)
    if stray is not None:
        violations.append(
            "grammar: code fences are legal only in Proof — task %s, body line "
            "%d (%s)" % (task_id, stray + 1, lines[stray][0].strip()))

    # Provenance tag FORM on the Claim's operator sentence — the tag CLOSES
    # that sentence, which may wrap over several lines, so every line up to
    # the machine restatement is a candidate (and all of them when the pair
    # carries no `Machine:` lead-in).
    claim = slots.get("Claim", "")
    provenance = None
    operator_lines = []
    for line in claim.splitlines():
        if re.match(r"^machine\s*:", line.strip(), re.I):
            break
        operator_lines.append(line)
    # Search whitespace-normalized operator text, not per-line: a tag the
    # author's editor wrapped — `(quoted\nfrom #NNN)` — is still a tag
    # (2026-09-01 papercut: it silently vanished, and only check_provenance's
    # quote count betrayed it).
    normalized = re.sub(r"\s+", " ", " ".join(operator_lines)).strip()
    m = CLAIM_PROVENANCE_RE.search(normalized)
    if m:
        if m.group(2) is not None:
            provenance = "quoted:#" + m.group(2)
        elif m.group(1).lower() == "derived":
            provenance = "derived"
            if not plan_claim:
                violations.append(
                    "grammar: Claim is marked (derived) but the plan carries no "
                    "plan-level Claim — task %s; a derived claim descends from "
                    "the operator's one elicited sentence above the first task"
                    % task_id)
        else:
            provenance = "elicited"
    elif claim:
        violations.append(
            "grammar: Claim carries no provenance tag — task %s; the operator "
            "sentence ends `(elicited)`, `(derived)` or `(quoted from #NNN)`"
            % task_id)

    # Stale-if: one predicate per line, bullet optional.
    stale_entries = []
    for line in slots.get("Stale-if", "").splitlines():
        entry = re.sub(r"^[-*+]\s+", "", line.strip())
        if not entry:
            continue
        stale_entries.append(entry)
        if not STALE_PREDICATE_RE.match(entry):
            violations.append(
                "grammar: Stale-if entry is not a predicate — task %s: %r; use "
                "path-exists:/path-absent:/sha-matches:/issue-open:/"
                "issue-closed:" % (task_id, entry))

    # Proof/implementation path disjointness: the exam is a distinct artifact
    # (#447), so a Proof-referenced `Test:` path may not be one the task itself
    # creates or modifies.
    impl_paths = set()
    for line, fenced in lines[:found[0][0] if found else len(lines)]:
        f = None if fenced else FILE_LINE.match(line.strip())
        if f and f.group(1) in ("Create", "Modify"):
            impl_paths.update(_claims_file_paths(f.group(2)))
    # Two views of the same paths: the sorted set the disjointness check and
    # every existing consumer read, and the Proof-ORDER list the task-scoped
    # test command derives from (#515 — the exam runs in the order the Proof
    # bullets name, which sorting would silently reshuffle).
    proof_tests = set()
    proof_tests_ordered = []
    # The third view: the Proof's `Run:` commands in Proof order (#589). A
    # command is not a path — it is not deduplicated against the test paths,
    # not sorted, and not checked for existence. The same command named twice
    # is two runs, because running it twice is what the Proof asked for.
    proof_runs = []
    # The fourth view: the Proof's `Guard:` paths in Proof order (#777). A
    # guard is a path like a `Test:` value and is read by the same reader, but
    # it is deduplicated (first occurrence kept) because naming the same guard
    # twice is one guard named twice, not two.
    proof_guards = []
    for line, fenced in lines[proof_start:proof_end]:
        stripped = line.strip()
        f = None if fenced else FILE_LINE.match(stripped)
        r = None if fenced else RUN_LINE.match(stripped)
        g = None if fenced else GUARD_LINE.match(stripped)
        if f and f.group(1) == "Test":
            for path in _claims_file_paths(f.group(2)):
                if path not in proof_tests:
                    proof_tests_ordered.append(path)
                proof_tests.add(path)
        elif g:
            for path in _claims_file_paths(g.group(1)):
                if path not in proof_guards:
                    proof_guards.append(path)
        elif r:
            command = _claims_run_command(r.group(1))
            proof_runs.append(command)
            if "`" in command:
                violations.append(
                    _backtick_command_violation("Run", command, task_id))
            sweep = _exam_sweep_run_violation(command, task_id)
            if sweep is not None:
                violations.append(sweep)
    for path in sorted(proof_tests & impl_paths):
        violations.append(
            "grammar: Proof test paths must be disjoint from implementation "
            "paths — task %s: `%s` is both a Proof `Test:` path and a "
            "`Create:`/`Modify:` path" % (task_id, path))

    # Clause-to-leg citation (#554): active exactly when the Machine line
    # numbers its clauses; every refusal it draws is a `grammar:` line like
    # the rest, so both channels refuse it.
    machine_clauses, numbering_error = parse_machine_clauses(
        machine_restatement(claim))
    proof_legs = parse_proof_legs(slots.get("Proof", ""))
    violations.extend(clause_citation_violations(
        task_id, machine_clauses, numbering_error, proof_legs))

    return {"claim": claim,
            "authorized_by": slots.get("Authorized-by", ""),
            "interfaces": slots.get("Interfaces", ""),
            "context": slots.get("Context", ""),
            "proof": slots.get("Proof", ""),
            "stale_if": slots.get("Stale-if", ""),
            "claim_provenance": provenance,
            "stale_if_entries": stale_entries,
            "proof_tests": sorted(proof_tests),
            "proof_tests_ordered": proof_tests_ordered,
            "proof_runs": proof_runs,
            "proof_guards": proof_guards,
            "machine_clauses": machine_clauses,
            "proof_legs": proof_legs,
            "violations": violations}


# Task-scoped exams (#515): the implementer's red->green loop runs its OWN
# Proof, not the whole suite. Only two path shapes are runnable that way — a
# node test file under `fleet/tests/`, and any pytest file under `tests/`.
# Anything else (a doc, a fixture, a directory, a body whose Proof names no
# test) derives nothing, and the engine falls back to the run-wide command; the
# full suite still runs at the integration head and the gate.
MJS_PROOF_TEST_RE = re.compile(r"^fleet/tests/test_[^/]*\.mjs$")
PY_PROOF_TEST_RE = re.compile(r"^tests/(?:[^/]+/)*[^/]+\.py$")
# The greenfield stack's exam shape (Bun + TypeScript, `bun test <file>`).
# Without it a Bun target's Proof `Test:` paths derived no task command, and
# the engine dispatches the examiner only when one exists — so no Bun target
# ever got a peer-written exam, `Review: peer` or not (walk 3, 2026-09-04:
# runs 74 and 1 both report `exam: null` on every task).
BUN_PROOF_TEST_RE = re.compile(r"^tests/(?:[^/]+/)*[^/]+\.test\.ts$")


def _known_proof_shape(path):
    """Whether the built-in table can name a runner for one `Test:` path."""
    return bool(MJS_PROOF_TEST_RE.match(path) or PY_PROOF_TEST_RE.match(path)
                or BUN_PROOF_TEST_RE.match(path))


def derive_task_test_cmd(proof_tests, exam_command=None):
    """The task-scoped test command a Proof's `Test:` paths derive, or None.

    `exam_command` is the plan's declared template (#644) when it carries one:
    it wins over the built-in table for every task naming at least one path,
    and its `{paths}` becomes those paths space-joined in Proof order. A task
    naming none has nothing to substitute and keeps its None either way.

    `proof_tests` is the task's Proof `Test:` paths in PROOF ORDER. Every path
    must match one of the three runnable shapes or the whole command is None —
    a partial command would quietly drop an exam the Proof named, which is
    worse than falling back to the run-wide suite. The `.mjs` paths become one
    `node <path>` each, in Proof order; the `.py` paths collapse into a single
    `python3 -m pytest -q <paths>` (also Proof order), and the `.test.ts`
    paths into a single `bun test <paths>`, each appended after the node
    parts, because one process over N files beats N processes.
    """
    if not proof_tests:
        return None
    if exam_command:
        return exam_command.replace(EXAM_PATHS_TOKEN, " ".join(proof_tests))
    node_paths, py_paths, bun_paths = [], [], []
    for path in proof_tests:
        if MJS_PROOF_TEST_RE.match(path):
            node_paths.append(path)
        elif PY_PROOF_TEST_RE.match(path):
            py_paths.append(path)
        elif BUN_PROOF_TEST_RE.match(path):
            bun_paths.append(path)
        else:
            return None
    parts = ["node " + path for path in node_paths]
    if py_paths:
        parts.append("python3 -m pytest -q " + " ".join(py_paths))
    if bun_paths:
        parts.append("bun test " + " ".join(bun_paths))
    return " && ".join(parts)


def exam_shape_violations(md_text, tasks):
    """Peer review the fleet cannot examine, refused before launch (#644).

    A `**Review:** peer` task promises a second reader AND an examiner, and the
    examiner is dispatched only when the task has a command to run. When the
    plan declares no `**Exam command:**` line and a task's Proof names a
    `Test:` path in none of the three built-in shapes, that promise is silently
    half-kept — so it is a refusal instead. A peer task whose Proof names no
    `Test:` path at all never had an exam to lose and is left alone."""
    if parse_exam_command(md_text) is not None:
        return []  # the plan named its own runner; every shape is runnable
    violations = []
    for t in tasks:
        if (t.get("review") or "lean") != "peer":
            continue
        proof_tests = (t.get("claims") or {}).get("proof_tests_ordered", [])
        unknown = [p for p in proof_tests if not _known_proof_shape(p)]
        if not unknown:
            continue
        violations.append(
            "exam-shape: task %s — Review: peer, but no exam command derives "
            "from %s; name an **Exam command:** line in the plan header or use "
            "a shape the table knows" % (t["id"], ", ".join(unknown)))
    return violations


def _apply_claims_grammar(t, plan_claim=None):
    """Overlay the claims-v1 body grammar on a task whose head markers and
    **Interfaces:** block the head pass has already parsed (§3 keeps them
    signed and unchanged). The two tiers claims-v1 does not sign are not read
    at all: a **Depends-on:**/**Commutes:** line contributes nothing and is a
    refusal recorded in `grammar_violations`."""
    claims = parse_claims_body(t["body"], t["id"], plan_claim)
    t.update(claims=claims,
             claim_provenance=claims["claim_provenance"],
             grammar_violations=claims["violations"])
    return t


# The proof gate's verdict is an ARTIFACT, not a memory (spec §4.5): the gate
# writes `<plan-stem>.gate-verdicts.json` beside the plan and claims-v1 refuses
# to compile a plan whose record is missing, stale, or failing. The compiler
# only ever READS this file — `tally` is the production canary (§8) and belongs
# to the gate tooling alone.
GATE_VERDICTS_SUFFIX = ".gate-verdicts.json"
GATE_VERDICT_VALUES = ("pass", "fail")


def verdicts_path(plan_path):
    """The gate-verdict artifact sibling to a plan: `<stem>.gate-verdicts.json`."""
    p = Path(plan_path)
    return p.with_name(p.stem + GATE_VERDICTS_SUFFIX)


def gate_input_hash(claim, proof):
    """The signed pair's identity: sha256 of Claim, NUL, Proof.

    NUL separates because it is the one byte no slot can carry, so no edit that
    merely moves text across the boundary can collide."""
    return hashlib.sha256(
        (claim + "\x00" + proof).encode("utf-8")).hexdigest()


def gate_verdict_violations(plan_path, tasks):
    """Every gate-verdict refusal a claims-v1 plan earns, `grammar:`-namespaced.

    Keyed on the LIVE hash of each task's (Claim, Proof) pair, so an edited
    claim or proof goes stale and re-dispatches rather than riding an old
    verdict."""
    path = verdicts_path(plan_path)
    if not path.exists():
        return ["grammar: gate verdicts missing — expected `%s` beside the "
                "plan; the proof gate's verdict is an artifact, not a memory "
                "(spec \u00a74.5). Run the gate and commit its record."
                % path.name]
    try:
        record = json.loads(path.read_text())
        entries = record["tasks"]
        if not isinstance(entries, dict):
            raise TypeError("tasks")
    except (ValueError, TypeError, KeyError) as exc:
        return ["grammar: gate verdicts unreadable — `%s`: %s; the record is "
                '{"tasks": {id: {"hash", "verdict", "reason"}}, "tally": '
                '{"dispatched", "rejected"}}' % (path.name, exc)]

    violations = []
    for t in tasks:
        claims = t.get("claims")
        if claims is None:
            continue
        entry = entries.get(t["id"])
        if not isinstance(entry, dict):
            violations.append(
                "grammar: gate verdict missing for task %s — `%s` carries no "
                "entry for it; every task is dispatched to the gate."
                % (t["id"], path.name))
            continue
        live = gate_input_hash(claims["claim"], claims["proof"])
        if entry.get("hash") != live:
            violations.append(
                "grammar: gate verdict stale for task %s — the record signs "
                "%s, the plan's Claim/Proof pair hashes to %s; re-dispatch the "
                "task to the gate."
                % (t["id"], entry.get("hash"), live))
            continue
        verdict = entry.get("verdict")
        if verdict == "fail":
            violations.append(
                "grammar: gate verdict fail for task %s — %s"
                % (t["id"], entry.get("reason") or "no reason recorded"))
        elif verdict != "pass":
            violations.append(
                "grammar: gate verdict unreadable for task %s — verdict %r is "
                "not one of %s" % (t["id"], verdict,
                                   ", ".join(GATE_VERDICT_VALUES)))
    return violations


# --------------------------------------------------------------------------- #
# The authoring record (#988): what the sitting that produced the plan cost    #
# --------------------------------------------------------------------------- #
# A top-level `authoring` object in `<stem>.gate-verdicts.json`, beside `tasks`
# and `tally`, records the sitting's own cost: the wall-clock minutes to
# `PLAN OK`, the hub probes made, which branch of the handoff rule fired and
# which lane the operator picked, and one row per AskUserQuestion. The compiler
# only READS it — it is written by the authoring skill, never by a compile.
#
# Two rules, and no third: a record whose `authoring` object is malformed is a
# `grammar:` refusal on the same footing as the gate verdicts, and a record
# with no `authoring` key at all is read exactly as it was before this existed.
# Extra keys are tolerated everywhere (the skill's own "any extra key … is
# tolerated"), because the record is a log the authoring side grows.
AUTHORING_KEY = "authoring"
AUTHORING_BRANCHES = ("risk", "width", "inline", "subagent")
AUTHORING_LANES = ("ultrapowers", "subagent", "inline")
_AUTHORING_BAD = "grammar: authoring record unreadable — "


def _authoring_object(plan_path):
    """The record's `authoring` value, or None when there is nothing to read.

    None covers all three ways this reader declines to speak: no verdicts file
    (that is `gate_verdict_violations`'s one `gate verdicts missing` refusal,
    and adding a second would double-report a single fact), a file that is not
    readable JSON (likewise already refused there), and a record carrying no
    `authoring` key — the plan that never recorded its cost."""
    path = verdicts_path(plan_path)
    if not path.exists():
        return None
    try:
        record = json.loads(path.read_text())
    except ValueError:
        return None
    if not isinstance(record, dict):
        return None
    return record.get(AUTHORING_KEY)


def _authoring_tally(plan_path):
    """The record's `tally`, as a dict — `{}` when absent or unreadable."""
    path = verdicts_path(plan_path)
    try:
        record = json.loads(path.read_text())
    except (OSError, ValueError):
        return {}
    tally = record.get("tally") if isinstance(record, dict) else None
    return tally if isinstance(tally, dict) else {}


def _nonneg_int(value):
    """A JSON non-negative integer. `True` is an `int` in Python and is not
    one of these; `"12"` is a string the record's writer did not convert."""
    return (isinstance(value, int) and not isinstance(value, bool)
            and value >= 0)


def authoring_record_violations(plan_path):
    """Every refusal the `authoring` object earns, `grammar:`-namespaced.

    One line per offending field, each naming the field it is about. A record
    with no `authoring` key earns nothing at all — this function is the only
    thing in the compiler that reads the key, so a plan from before the record
    existed compiles exactly as it did.

    Each question's checks short-circuit on `options`: a question whose option
    list is unusable cannot say anything further about which of those options
    was picked or recommended, so the malformation is reported once, at the
    field that caused it."""
    auth = _authoring_object(plan_path)
    if auth is None:
        return []
    name = verdicts_path(plan_path).name
    out = []

    def bad(field, detail):
        out.append("%s`%s`: %s: %s" % (_AUTHORING_BAD, name, field, detail))

    if not isinstance(auth, dict):
        bad("authoring", "must be an object, got %s"
            % type(auth).__name__)
        return out

    if not _nonneg_int(auth.get("minutes")):
        bad("minutes", "must be a non-negative integer, got %r"
            % (auth.get("minutes"),))
    if not _nonneg_int(auth.get("probes")):
        bad("probes", "must be a non-negative integer, got %r"
            % (auth.get("probes"),))

    routing = auth.get("routing")
    if not isinstance(routing, dict):
        bad("routing", "must be an object carrying `branch` and `lane`, got %r"
            % (routing,))
    else:
        if routing.get("branch") not in AUTHORING_BRANCHES:
            bad("routing.branch", "must be one of %s, got %r"
                % (", ".join(AUTHORING_BRANCHES), routing.get("branch")))
        if routing.get("lane") not in AUTHORING_LANES:
            bad("routing.lane", "must be one of %s, got %r"
                % (", ".join(AUTHORING_LANES), routing.get("lane")))

    questions = auth.get("questions", [])
    if not isinstance(questions, list):
        bad("questions", "must be a list, one row per question, got %r"
            % (questions,))
        return out
    for i, q in enumerate(questions):
        where = "questions[%d]" % i
        if not isinstance(q, dict):
            bad(where, "must be an object, got %r" % (q,))
            continue
        options = q.get("options")
        if not isinstance(options, list) or len(options) < 2:
            bad(where + ".options",
                "must be a list of at least 2 entries, got %r" % (options,))
            continue
        if q.get("picked") not in options:
            bad(where + ".picked", "must be one of %r, got %r"
                % (options, q.get("picked")))
        recommended = q.get("recommended")
        if recommended is not None and recommended not in options:
            bad(where + ".recommended", "must be null or one of %r, got %r"
                % (options, recommended))
    return out


def authoring_fact_line(plan_path):
    """The `AUTHORING fact:` line(s) a `--check --base` compile prints.

    `AUTHORING fact: none recorded` only when the record carries no
    `authoring` key. A record the reader above refuses prints one
    `AUTHORING fact: refused — <key>: <rule>` line per violation instead —
    the `<key>: <rule>` text of that violation's own `grammar:` line — so a
    malformed record is never read as an absent one (#1029: a `minutes: null`
    printed `none recorded` beside its violation and cost a re-read of this
    script). The compile is a refusal either way; this is the fact line's
    reading of why."""
    auth = _authoring_object(plan_path)
    if auth is None:
        return "AUTHORING fact: none recorded"
    violations = authoring_record_violations(plan_path)
    if violations:
        name = verdicts_path(plan_path).name
        head = "%s`%s`: " % (_AUTHORING_BAD, name)
        return "\n".join("AUTHORING fact: refused — " + v[len(head):]
                         for v in violations)
    tally = _authoring_tally(plan_path)
    # `-` reads as "the record does not say", which is what an absent tally
    # key means — distinct from a recorded 0.
    dispatched = tally.get("dispatched", "-")
    rejected = tally.get("rejected", "-")
    questions = auth.get("questions", [])
    with_rec = [q for q in questions if q.get("recommended") is not None]
    picked = [q for q in with_rec if q.get("picked") == q.get("recommended")]
    return ("AUTHORING fact: %s min to PLAN OK, %s hub probes, "
            "%s gate dispatches, %s rejected, routing %s->%s, "
            "%d questions, %d/%d recommended picked"
            % (auth["minutes"], auth["probes"], dispatched, rejected,
               auth["routing"]["branch"], auth["routing"]["lane"],
               len(questions), len(picked), len(with_rec)))


def parse_task(t, raise_on_marker_error=True, plan_claim=None):
    """Parse one task's body. raise_on_marker_error controls how a marker-VALUE
    validation failure (currently: an invalid or duplicate **Review:** value)
    is reported: True (the normal compile path, default) raises SystemExit
    immediately, so main() dies loudly at the first one found; False (the
    --check collecting mode, #85) records the same message into the returned
    task's `marker_violations` list instead, so collect_violations can gather
    every task's violations in one pass rather than aborting at the first.

    The head markers (**Type:**/**Files:**/**Review:**) and the
    **Interfaces:** block are what spec 2026-08-31 §3 keeps signed; the
    six-slot body grammar is then overlaid by _apply_claims_grammar, which also
    refuses the two body tiers claims-v1 does not sign
    (**Depends-on:**/**Commutes:**).

    `plan_claim` is the plan's header Claim, threaded to the body parser so a
    `(derived)` task Claim can be checked against the signature it descends
    from (#552)."""
    ttype = None
    late_markers = []
    marker_violations = []
    creates, modifies, reads, deletes = [], [], [], []
    # Verbatim (label, rest) for every `Label: value` Files bullet (canonical or
    # not) — the strict-grammar input to _files_violations (#85). Unknown-label
    # lines are CAPTURED here, not dropped, so they surface as loud violations.
    files_raw = []
    in_files = False
    files_entries_seen = False
    # v6 `**Interfaces:**` block (spec 2026-06-16): opens on `**Interfaces:**`
    # AFTER the Files block, before the first `- [ ]` step. `- Consumes:` /
    # `- Produces:` sub-lines are captured verbatim after the label. Optional —
    # absent leaves both lists empty (the v5 case).
    consumes, produces = [], []
    in_interfaces = False
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
                if val in TYPES and ttype is None:
                    # First valid Type wins; a later or unrecognized value is
                    # ignored (the marker degrades to the heuristic classifier).
                    ttype = val
        elif (m := MARKER_REVIEW.match(s)):
            if not in_header:
                late_markers.append(s)
            else:
                val = REVIEW_ALIASES.get(m.group(1), m.group(1))
                if val not in VALID_REVIEWS:
                    msg = ("Task {}: invalid **Review:** value {!r} "
                           "(valid: peer, adversarial, lean)".format(
                               t["id"], m.group(1)))
                    if raise_on_marker_error:
                        raise SystemExit(msg)
                    marker_violations.append(msg)
                elif t.get("review"):
                    msg = "Task {}: duplicate **Review:** marker".format(t["id"])
                    if raise_on_marker_error:
                        raise SystemExit(msg)
                    marker_violations.append(msg)
                else:
                    t["review"] = val
        elif is_markerish and s.rstrip() == "**Depends-on:**":
            # Exact marker, missing value. Wherever it sits the claims-v1 body
            # grammar refuses the line outright (CLAIMS_REFUSED_MARKERS);
            # outside the header it is ALSO a placement violation, surfaced
            # like any late marker.
            if not in_header:
                late_markers.append(s + "  <missing value>")
        elif is_markerish:
            # A marker-shaped line that is not a trusted marker (`**type:**`,
            # `**Depends-On:**`, `**Type**:`, `**Commutes:**`). The two tiers
            # claims-v1 does not sign are refused by the body grammar; after
            # the header any of them also surfaces as a late marker.
            if not in_header:
                late_markers.append(s)
        if s.startswith("**Files:**"):
            in_files = True
            files_entries_seen = False
            # Inline header values: `**Files:** \`a.py\` \`b.py\`` carries the
            # paths on the header line itself. Backticked path-like tokens are
            # honored as writes (conservative: inline form does not distinguish
            # Create/Modify/Test, and a write is the safe assumption). A
            # non-path remainder contributes nothing, so a marked
            # implementation task written that way is refused as Files-less.
            rest = s[len("**Files:**"):].strip()
            if rest:
                inline = [p.split(":")[0] for p in PATH_RE.findall(rest)
                          if p and _is_pathlike(p)]
                if inline:
                    modifies.extend(inline)
                    files_entries_seen = True
            continue
        if FILES_ISH.match(s):
            # `**Files**:` / `**files:**` never opens the block — entries under
            # it contribute no paths, so a marked implementation task written
            # that way is refused by the Files-less rule in _files_violations.
            continue
        if s.startswith("**Interfaces:**"):
            # Opening the Interfaces block closes any open Files block cleanly,
            # so its `- Consumes:`/`- Produces:` sub-lines are never run through
            # the Files near-miss rule below.
            in_files = False
            in_interfaces = True
            continue
        if in_interfaces:
            if not s:
                continue  # blank lines inside the Interfaces block are fine
            if s.startswith("- [") or TASK_HEAD.match(s):
                in_interfaces = False  # a checkbox step (or next heading) ends it
            else:
                mi = re.match(r"^[-*+]\s*(Consumes|Produces)\s*:\s*(.+?)\s*$", s, re.I)
                if mi:
                    (consumes if mi.group(1).lower() == "consumes"
                     else produces).append(mi.group(2).strip())
                    continue
                # Any other line ends the Interfaces block; fall through so a
                # following marker/Files/step line is processed normally.
                in_interfaces = False
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
            # as a Files entry and over-order the task. Checkbox lines start
            # with "- [": close, then fall through to normal processing.
            if s.startswith("- ["):
                in_files = False
            f = FILE_LINE.match(s) if in_files else None
            # Strict-grammar capture (#85): record EVERY `Label: value` Files
            # bullet — canonical or not — so _files_violations can flag annotated
            # lines, unknown labels, and globs. `- none` is an explicit empty
            # declaration (never a violation) and is not captured.
            if in_files and s.lstrip("-*+ ").strip().lower() != "none":
                mlabel = FILES_LABEL_LINE.match(s)
                if mlabel:
                    files_raw.append((mlabel.group(1).strip(),
                                      mlabel.group(2).strip()))
            if in_files and not f and re.match(r"^[-*+]\s", s):
                # A non-canonical bullet inside an open Files block — a bare
                # `- None` empty declaration, colon-less natural English, an
                # unknown label, or a wrong bullet char — contributes no write.
                # The block stays open so valid entries after it survive.
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
                    # overlap edges to unrelated tasks.
                    paths = [b for b in backticked if _is_pathlike(b)]
                else:
                    tokens = f.group(2).strip().split()
                    first = tokens[0].rstrip(",;")
                    # First token only, and only if it LOOKS like a path (same
                    # _is_pathlike rule as backticked tokens, so backtick presence
                    # never flips a token's classification) — a prose value ("run
                    # pytest manually") must not fabricate a phantom path that
                    # buys a marked implementation task past the Files-less refusal.
                    paths = [first] if _is_pathlike(first) else []
                paths = [p.split(":")[0] for p in paths if p]  # drop :line-range
                if paths:
                    files_entries_seen = True
                if f.group(1) == "Create":
                    creates.extend(paths)
                elif f.group(1) == "Delete":
                    # A file the task removes (#896). A write for overlap
                    # purposes — two tasks touching one path still share a
                    # wave and fold — and, under `--check --base`, the path
                    # the compiler describes as a BASE fact before anyone
                    # signs a sentence about what the file holds.
                    deletes.extend(paths)
                elif f.group(1) in ("Modify", "Test fixture(s)", "Fixture(s)"):
                    # A declared test fixture is a file the task OWNS and writes
                    # (test data committed alongside the code) — treat it as a
                    # write so two tasks touching the same fixture overlap.
                    modifies.extend(paths)
                else:  # Test — the suite the task reads/runs, not a write
                    reads.extend(paths)
            elif s and not s.startswith("-"):
                in_files = False

    t.update(marker_type=ttype,
             # Ordering is DERIVED (Interfaces, Files), never declared: a
             # **Depends-on:** line is a refusal, not an input, so the emitted
             # key is always empty. Same for **Commutes:** — same-path overlap
             # is derived from Files — and so its conflict list is empty too.
             depends_on=[],
             commutes=[],
             commutes_conflicts=[],
             late_markers=late_markers,
             # Marker-VALUE validation failures collected instead of raised
             # (only populated when raise_on_marker_error=False — the --check
             # CLI mode, #85); empty in the normal compile path since a
             # violation there raises SystemExit immediately instead.
             marker_violations=marker_violations,
             files_raw=files_raw,
             creates=sorted(set(creates)), modifies=sorted(set(modifies)),
             deletes=sorted(set(deletes)),
             reads=sorted(set(reads)),
             writes=sorted(set(creates) | set(modifies) | set(deletes)),
             interfaces={"consumes": consumes, "produces": produces})
    _apply_claims_grammar(t, plan_claim)
    return t


def disposition(t):
    """The task's disposition, READ from its `**Type:**` marker.

    There is no prose classifier left to fall back on: a task carrying no
    marker (or one whose value is outside TYPES, which parse_task refuses to
    trust) is `implementation`, the disposition that puts it in the wave plan
    where a human will see it, rather than a guess that quietly drops it out."""
    return t["marker_type"] or "implementation"


# Top-level `## Global Constraints` section (v6, spec 2026-06-16). Fence-aware
# whole-document scan: capture the verbatim body between the `## Global
# Constraints` heading and the next heading of the same-or-shallower level (a
# `#`/`##` line) or end of document. Optional — absent returns "" (the v5 case),
# which must never warn. A trailing `---` rule or trailing blank lines are
# trimmed so the body is the constraints text only, not the section framing.
GLOBAL_CONSTRAINTS_HEAD = re.compile(r"^##\s+Global\s+Constraints\s*$", re.I)
SECTION_BREAK = re.compile(r"^#{1,2}\s+\S")  # next `#`/`##` heading ends the section

# Constraints come in two kinds (2026-09-04 grilling, decision 1). Most are
# sentences a reviewer reads; a `- Check: <command>` bullet is a COMMAND the
# driver runs. Same bullet shape as a Proof `Run:`, read the same way, and
# lifted out of the prose body so no referee is ever handed a shell line to
# argue about.
CHECK_LINE = re.compile(r"^-\s*Check:\s*(.+)$")

# A trailing `(minor)` marks a check whose failure does not sink the run.
# Case-insensitive, with optional whitespace inside and around the parens, and
# stripped from the command — the driver runs the command, not the annotation.
MINOR_SUFFIX = re.compile(r"\s*\(\s*minor\s*\)\s*$", re.I)


def _global_constraints_section(text):
    """The section body's `(line, in_fence)` pairs, untrimmed.

    The single scan `parse_global_constraints` and `parse_constraint_checks`
    share, so the two can never disagree about which lines the section holds —
    and so every line one of them claims is a line the other drops."""
    lines = list(_fence_aware_lines(text))
    start = None
    for i, (line, in_fence) in enumerate(lines):
        if not in_fence and GLOBAL_CONSTRAINTS_HEAD.match(line.strip()):
            start = i + 1
            break
    if start is None:
        return []
    body = []
    for line, in_fence in lines[start:]:
        # The section ends at the next #/## heading OR the first task heading —
        # plans commonly go straight from Global Constraints to `### Task 1:`,
        # and without this stop the section swallows every task body.
        if not in_fence and (SECTION_BREAK.match(line.strip()) or match_head(line)):
            break
        body.append((line, in_fence))
    return body


def _claimed_by_check(line, in_fence):
    """True for a line `parse_constraint_checks` turns into an entry. A fenced
    one is an EXAMPLE of the grammar, not an instance of it: claimed by
    nothing, so it stays in the verbatim prose body."""
    return not in_fence and bool(CHECK_LINE.match(line.strip()))


def parse_global_constraints(text):
    body = [line for line, in_fence in _global_constraints_section(text)
            if not _claimed_by_check(line, in_fence)]
    while body and not body[0].strip():
        body.pop(0)
    while body and (not body[-1].strip() or body[-1].strip() in ("---", "***", "___")):
        body.pop()
    return "\n".join(body)


def parse_constraint_checks(text):
    """The section's `- Check:` commands, in section order.

    One `{"cmd": <command>, "minor": <bool>}` per bullet. `cmd` is the value
    stripped and unwrapped by `_claims_run_command`'s whole-value backtick
    rule — the same string handling a Proof `Run:` gets, because it is the same
    kind of thing. `minor` is true exactly when the value ended in `(minor)`,
    which is stripped from `cmd`. `[]` when the plan carries no section, or a
    section that names no check."""
    checks = []
    for line, in_fence in _global_constraints_section(text):
        if not _claimed_by_check(line, in_fence):
            continue
        value = CHECK_LINE.match(line.strip()).group(1).strip()
        minor = bool(MINOR_SUFFIX.search(value))
        if minor:
            value = MINOR_SUFFIX.sub("", value)
        checks.append({"cmd": _claims_run_command(value), "minor": minor})
    return checks


def constraint_check_violations(text):
    """The `grammar:` refusals the section's `- Check:` commands draw.

    Plan-level, so the line names no task. Both channels close on these — the
    same footing as a claims-v1 body violation."""
    return [_backtick_command_violation("Check", check["cmd"])
            for check in parse_constraint_checks(text) if "`" in check["cmd"]]


def constraint_check_ownership_violations(text, tasks):
    """The refusals a run-wide `- Check:` draws by naming a path ONE task owns.

    A `Check:` is paid by every task on every pass and is meant to hold for the
    whole plan; a command that runs a file a single implementation task's Files
    own is that task's own proof wearing a run-wide coat — red for every other
    task until that one lands, and green afterwards for reasons no other task
    caused. It belongs in that task's Proof as a `Run:`, so the plan is refused
    rather than filed. `(minor)` changes nothing: the misplacement is the
    fault, not the blocking.

    One violation per (task, path), worded like any other task violation — the
    task id and the path both named, so the author can move the line without
    re-deriving which task owns what."""
    violations = []
    for check in parse_constraint_checks(text):
        for t in tasks:
            if disposition(t) != "implementation":
                continue
            for path in sorted(task_files(t)):
                if not command_names_path(check["cmd"], path):
                    continue
                violations.append(
                    "grammar: task %s: run-wide `- Check: %s` names `%s`, a "
                    "path task %s's Files own — a check one task would turn "
                    "green is not run-wide; move it to that task's Proof as a "
                    "`Run:`." % (t["id"], check["cmd"], path, t["id"]))
    return violations


# Placeholder interface values — 'Consumes: nothing (…)' is authoring prose
# for "no contract", never a producible symbol. Tokenizing them to "" deletes
# the placeholder-pairing edge class at the representation (2026-07-03
# foreign run: 'nothing' paired 'nothing' -> spurious edges -> a wasted wave).
PLACEHOLDER_TOKENS = frozenset({"nothing", "none", "n/a", "na"})


# Interface-token normalization (v6, spec 2026-06-16 §1.3; hardened by the #85
# redirect). A Consumes/Produces entry is matched by EXACT token equality — no
# substring/fuzzy match — and ONLY a symbol-shaped lead yields a token. A prose
# contract description (this repo's established house style for Interfaces) tokens
# to "" and can NEVER pair into an interface edge. The 2026-07-03 live incident
# motivating this: a leading bare word 'the' tokenized identically across two
# prose values, pairing 'Produces: the baked reviewer prompt …' with 'Consumes:
# the reviewer-prompt source layout …' into a spurious edge that over-ordered
# a real run. A symbol lead is either:
#   * a backticked symbol — the FIRST backtick span is the symbol, and any prose
#     tail after the closing backtick is allowed ("`User` dataclass (id, name)"
#     and "`User`" both reduce to "User", "`validate(p)`" to "validate"); OR
#   * a bare identifier standing alone, or immediately followed by a '(' signature,
#     '->', or '=' ("validate_payload(payload) -> list[str]" -> "validate_payload",
#     "User" -> "User").
# A bare word followed by more prose words ("every task object …", the "compiler"
# in "compiler `**Review:**` marker semantics") is documentation, not a symbol —
# it tokens to "". Placeholder normalization stays on top: a leading token in
# PLACEHOLDER_TOKENS (bare or with trailing prose, "nothing (test-data-only
# change)") normalizes to "" so placeholder Consumes/Produces never pair.
_BARE_SYMBOL_LEAD = re.compile(r"([A-Za-z_][\w.\-]*)\s*(?:$|\(|->|=)")


# Declaration keywords that LEAD a signature without being the symbol —
# `class FailedLookup(RuntimeError)` names FailedLookup, not `class`. Without
# this skip, two unrelated `class X` / `class Y` contracts pair on the keyword
# into a FALSE edge, silent and permanent.
_DECL_KEYWORDS = frozenset((
    "class", "def", "async", "function", "const", "let", "var",
    "interface", "type", "struct", "enum", "export", "abstract", "static"))


def _interface_token(entry):
    s = entry.strip()
    if not s:
        return ""
    if s.startswith("`"):
        m = re.match(r"`([^`]+)`", s)
        if not m:
            return ""  # a lone opening backtick with no close — not a symbol
        words = m.group(1).split()
        while words and words[0].lower() in _DECL_KEYWORDS:
            words = words[1:]
        if not words:
            return ""  # keywords all the way down — not a symbol
        token = re.split(r"[(\s:]", " ".join(words), 1)[0].strip("`").strip()
    else:
        m = _BARE_SYMBOL_LEAD.match(s)
        if not m:
            return ""  # a bare word trailed by more prose — documentation
        token = m.group(1)
    return "" if token.lower() in PLACEHOLDER_TOKENS else token


# Strict Files grammar (#85). A Files bullet must be a bare canonical label
# followed by one or more backticked paths and NOTHING else. `Test fixture(s)` /
# `Fixture(s)` remain canonical aliases (used by existing tests/fixtures). Four
# things are loud violations, each carrying a did-you-mean fix:
#   * an UNKNOWN LABEL (Delete/Read/`catch-all`/… or a wrong-case `modify:`),
#   * a GLOB path (`*`, `?`, `[`, `{` — EVERY glob char bails; the brace used to
#     fall through to a soft ambiguous-files serialization, and that tier is gone),
#   * a TRAILING ANNOTATION after the path(s) ("(only the pool init, lines 12-40)"),
#   * an explicitly-marked implementation task that declares NO parseable path.
# A violating line contributes NOTHING silently: it always surfaces here, so a
# same-wave write race can never hide behind a parenthetical (2026-07-03 foreign
# run: the two most contended files silently lost overlap coverage) — nor behind
# a Files-less task the compiler cannot see any contention for at all.
CANONICAL_FILE_LABELS = ("Create", "Modify", "Delete", "Test",
                         "Test fixture(s)", "Fixture(s)")
# `catch-all` was the declared-open-write-set construct (#85). The tier that
# consumed it is gone, so the bullet is now just an unknown label — routed
# through the same did-you-mean rather than parsed into a phantom construct.
_LABEL_SUGGEST = {"remove": "Delete", "read": "Test",
                  "create-or-modify": "Modify", "add": "Create",
                  "catch-all": "Modify"}
_FILES_GLOB_CHARS = "*?[{"


# Dispositions whose Files block is exempt from the strict grammar (#91): a
# gate/manual/release task never enters overlap inference, so its placeholder
# Files text ("- Verify: `(none)`") is structurally inert.
#
# The exemption keys on the EXPLICIT `**Type:**` marker (`marker_type`), never
# on the disposition a marker-less task falls back to. A task with no explicit
# marker stays fully Files-checked.
FILES_EXEMPT_MARKERS = frozenset({"gate", "manual", "release"})


def _files_grammar_exempt(task):
    """True iff the task carries an EXPLICIT non-implementation Type marker."""
    return task.get("marker_type") in FILES_EXEMPT_MARKERS


def _files_violations(task):
    """Grammar violations for one task's Files block, each with a did-you-mean
    fix. Reads the task's recorded `files_raw` — the verbatim (label, rest) pairs
    captured for every `Label: value` Files bullet, canonical or not. Empty list
    == the block is canonical. An unbackticked canonical value ("- Create: a.py,
    b.py") is NOT flagged here: it is handled tolerantly by the existing
    "backtick each path" near-miss, so overlap inference is never blocked by a
    formatting-only miss."""
    out = []
    for label, rest in task.get("files_raw", []):
        paths = PATH_RE.findall(rest)
        if label not in CANONICAL_FILE_LABELS:
            shown = paths[0] if paths else rest.strip()
            suggest = _LABEL_SUGGEST.get(label.lower(), "Create/Modify/Test")
            out.append("Task %s: unknown Files label %r for `%s` — use %s"
                       % (task.get("id"), label, shown, suggest))
            continue
        if not paths:
            continue  # unbackticked value — soft near-miss, not a grammar bail
        globby = [p for p in paths if any(c in p for c in _FILES_GLOB_CHARS)]
        if globby:
            out.append("Task %s: glob `%s` — enumerate the concrete paths"
                       % (task.get("id"), globby[0]))
            continue
        # Anything left after removing the backticked path(s) and list
        # separators is a trailing prose annotation.
        residue = re.sub(r"[\s,;]+", "", PATH_RE.sub("", rest))
        if residue:
            out.append(
                "Task %s: Files line has a trailing annotation.\n"
                "  got:  - %s: %s\n"
                "  fix:  - %s: `%s`   (move the note into the task prose)"
                % (task.get("id"), label, rest, label, paths[0]))
    # A Files-LESS implementation task is invisible to contention detection:
    # with the ambiguous-files tier gone there is no conservative serialization
    # to fall back on, so it would silently share a wave with whatever it
    # actually edits. Refuse instead. Keyed on the EXPLICIT `**Type:**` marker
    # for the same reason `_files_grammar_exempt` is, and a `- none` block
    # reaches here identically: it parses to no paths.
    if (task.get("marker_type") == "implementation"
            and not (task.get("creates") or task.get("modifies")
                     or task.get("deletes")
                     or task.get("reads"))):
        out.append(
            "Task %s: implementation task declares no file paths under Files: "
            "— add Create/Modify/Test paths (a Files-less task is invisible to "
            "contention detection)" % task.get("id"))
    return out


# Malformed task-heading detection, factored out of main() so --check (#85)
# can reuse the exact same net: a heading that LOOKS like a task heading but
# fails TASK_HEAD (e.g. `### Task 1.5:` — non-alphanumeric id) would silently
# fold its whole section into the PREVIOUS task. See main()'s original
# comment (still there, verbatim) for the two-net rationale.
NEAR_HEAD = re.compile(
    r"^(#{3,4}\s*task\b|#{1,6}\s*task\s+(?:[^\s:]*\d[^\s:]*|[^\s:]{1,3})\s*:)",
    re.I)


def _malformed_task_headings(plan_text):
    """Heading lines that LOOK like a task heading but fail TASK_HEAD."""
    return [line.strip() for line, fenced in _fence_aware_lines(plan_text)
            if not fenced and NEAR_HEAD.match(line.strip())
            and not match_head(line)]


def _late_marker_note(task_id, late_markers):
    """The one wording for a marker found outside the header block — shared by
    the transparency render and the --check refusal (#332) so the two never
    drift."""
    return ("Task {}: marker line(s) outside the header block ignored ({}) — "
            "markers go immediately after the task heading".format(
                task_id, "; ".join(sorted(set(late_markers))[:3])))


def collect_violations(plan_path, base_tree=None):
    """Authoring-time grammar check (#85, the --check CLI mode). Runs the same
    parse as main() but collects EVERY violation across the whole plan in one
    pass instead of exiting at the first: Files grammar (_files_violations,
    which also covers the Files-less-implementation rule) and marker-value
    validation (currently **Review:** — parse_task raises immediately in the
    normal compile path; here raise_on_marker_error=False makes it accumulate
    per task instead of aborting on the first task with a bad marker).

    Interface values are NOT grammar-checked: a prose contract description is
    valid documentation and this repo's house style (#85 redirect). The
    tokenizer (_interface_token) makes prose structurally inert — a bare-word
    lead never tokens, so a prose Interfaces line can never pair into an edge —
    so there is nothing to flag.

    A malformed heading, zero task headings, or duplicate task ids abort
    early as a single violation — the rest of the parse cannot proceed
    safely without well-formed, uniquely-identified tasks (same as main()'s
    loud SystemExit for these three cases)."""
    plan_text = plan_path.read_text()

    bad_heads = _malformed_task_headings(plan_text)
    if bad_heads:
        return ["task heading(s) not recognized: " + "; ".join(bad_heads[:3])
                + " — ids must be alphanumeric (`### Task <id>: <title>`); a "
                "malformed heading folds its task into the previous one."]

    raw_tasks = split_tasks(plan_text)
    if not raw_tasks:
        return ["no '### Task N:' headings found."]

    ids = [t["id"] for t in raw_tasks]
    dups = sorted({i for i in ids if ids.count(i) > 1})
    if dups:
        return ["duplicate task id(s): " + ", ".join(dups)
                + " — task headings must be unique."]

    plan_grammar(plan_text)  # refuses a plan that declares no claims-v1 header
    tasks = [parse_task(t, raise_on_marker_error=False,
                        plan_claim=parse_plan_claim(plan_text))
             for t in raw_tasks]

    violations = []
    # claims-v1 body grammar.
    for t in tasks:
        violations.extend(t.get("grammar_violations", []))
    # ... and the gate-verdict record, which is a grammar refusal on the same
    # footing (spec §4.5): both channels close on it, so an author never
    # discovers at dispatch that the gate was never run.
    violations.extend(plan_claim_violations(plan_text))
    violations.extend(gate_verdict_violations(plan_path, tasks))
    # ... and the authoring record beside it (#988), which is a refusal on the
    # same footing for the same reason: a record the compiler cannot read is a
    # record nothing downstream can count. Unconditional, so a bare `--check`
    # refuses one too; a record with no `authoring` key adds nothing.
    violations.extend(authoring_record_violations(plan_path))
    # ... and the Global-Constraints `- Check:` commands, which belong to no
    # task and so are checked once for the whole plan.
    violations.extend(constraint_check_violations(plan_text))
    # ... and the misplaced-`Check:` refusal (#978), which needs the tasks as
    # well as the section: a command naming a path one implementation task's
    # Files own is that task's `Run:`, not a run-wide check.
    violations.extend(constraint_check_ownership_violations(plan_text, tasks))
    # ... and the declared exam command (#644), plan-level for the same reason:
    # the shell that would run it is the plan's, not any one task's.
    violations.extend(exam_command_violations(plan_text))
    violations.extend(exam_shape_violations(plan_text, tasks))
    # ... and the declared packages beside it, plan-level for the same reason:
    # the environment the line describes is the run's, not any one task's.
    violations.extend(dependencies_violations(plan_text))
    for t in tasks:
        violations.extend(t.get("marker_violations", []))
    # A **Commutes:** after the header block is discarded by the runtime
    # compile and surfaced only as a render conflict the author never sees
    # (#332); at authoring time that is a refusal, worded with the render's
    # own late-marker note so no new diagnostic vocabulary enters.
    for t in tasks:
        late = [m for m in t.get("late_markers", [])
                if m.startswith("**Commutes:**")]
        if late:
            violations.append(_late_marker_note(t["id"], late))
    # Files grammar is disposition-scoped (#91): only EXPLICITLY marked
    # gate/manual/release tasks are exempt — see _files_grammar_exempt for why
    # this must never key on anything but the marker.
    for t in tasks:
        if _files_grammar_exempt(t):
            continue
        violations.extend(_files_violations(t))
    # A `Delete:` names a file of the tree the plan launches on; one the base
    # does not have is a plan about some other tree (#896). Only decidable
    # with a base to read, so a bare `--check` leaves it alone.
    if base_tree is not None:
        for t in tasks:
            for rel in t.get("deletes", []):
                if base_tree._blob_mode(rel) is None:
                    violations.append(
                        "grammar: task %s: `- Delete: `%s`` names a path absent "
                        "at BASE — a deleted file must exist at the base the "
                        "plan launches on" % (t["id"], rel))
        # ... and the Stale-if slot, read against the same tree (#538): a
        # predicate that already HOLDS at BASE is a task the plan is stale
        # about. The advisory half of the same read is printed after the
        # verdict by main(), not collected here.
        violations.extend(evaluate_stale_if(tasks, base_tree)[0])
    return violations


# --------------------------------------------------------------------------- #
# Stale-if predicates evaluated at BASE under `--check --base` (#538)          #
# --------------------------------------------------------------------------- #
# A Stale-if entry is a predicate about the tree the plan launches on: it names
# the condition under which the task is already done, already impossible, or
# aimed at a file that is not there. Nothing at runtime re-evaluates one — the
# question is asked once, on the laptop, with a base to read.
#
# A predicate that HOLDS at BASE is a refusal, not a fact: the plan is stale
# before it is dispatched, so it joins the violations and the compile exits 2.
# A predicate the machine cannot DECIDE — an issue `gh` will not answer, an
# argument that is not a predicate's argument at all — is an advisory printed
# after the verdict beside the `BASE fact:` lines: an unreachable network is
# evidence about the laptop, never about the plan.
_STALE_ENTRY_RE = re.compile(
    r"^(path-exists|path-absent|sha-matches|issue-open|issue-closed)\s*:\s*(.*)$")
# `#538`, or the bare number — anything else has no digits to read.
_ISSUE_ARG_RE = re.compile(r"^#?\s*(\d+)$")
# One answer per issue number per process, so a number named by many tasks —
# and asked after by both halves of the read, the refusals inside
# collect_violations and the advisories inside main() — costs one `gh`.
_ISSUE_STATE_CACHE = {}


def _stale_entries(t):
    """A task's Stale-if entries, bullet stripped and text otherwise verbatim.
    `parse_claims_body` puts them under the task's `claims` overlay; the flat
    key is read too, so a caller holding a bare parse result is answered the
    same."""
    entries = (t.get("claims") or {}).get("stale_if_entries")
    if entries is None:
        entries = t.get("stale_if_entries") or []
    return entries


def _stale_argument(text):
    """An entry's argument: the text after the head, whitespace and the
    author's backticks stripped (`- path-exists: \\`fleet/reader.mjs\\`` asks
    about `fleet/reader.mjs`)."""
    return text.strip().strip("`").strip()


def _read_issue_state(repo, number):
    """(state, reason) from one `gh issue view` in `repo` — the shape
    `check_provenance.py` already uses, run with the base repository as its
    working directory so `gh` resolves the repository from that checkout's
    origin."""
    gh = shutil.which("gh")
    if gh is None:
        return None, "gh not on PATH"
    try:
        p = subprocess.run(
            [gh, "issue", "view", number, "--json", "state", "-q", ".state"],
            capture_output=True, text=True, cwd=str(repo))
    except OSError:
        return None, "gh not on PATH"
    if p.returncode != 0:
        first = (p.stderr or "").strip().splitlines()
        return None, ("gh exited %d%s"
                      % (p.returncode, (": " + first[0]) if first else ""))
    state = (p.stdout or "").strip()
    if state not in ("OPEN", "CLOSED"):
        return None, "gh printed %r" % state
    return state, None


def _issue_state(repo, number):
    """`_read_issue_state`, memoized process-wide by issue number."""
    if number not in _ISSUE_STATE_CACHE:
        _ISSUE_STATE_CACHE[number] = _read_issue_state(repo, number)
    return _ISSUE_STATE_CACHE[number]


def _base_entry_exists(base_tree, path):
    """True when `path` is an entry of the tree at BASE. A directory base reads
    the disk, the way `BaseTree.read_text` does; a sha base asks `git ls-tree`,
    whose one read answers existence for a blob and a tree alike."""
    if not path:
        return False
    if not base_tree.is_sha:
        return (base_tree.repo / path).exists()
    return bool(_git(base_tree.repo, "ls-tree", base_tree.rev,
                     "--", path).strip())


def _base_blob_id(base_tree, path):
    """`path`'s object id at BASE when it is a blob there, else None — the
    `git ls-tree` id for a sha base, `git hash-object` of the file on disk for
    a directory one."""
    if not path:
        return None
    if not base_tree.is_sha:
        f = base_tree.repo / path
        if not f.is_file():
            return None
        return _git(base_tree.repo, "hash-object", "--", str(f)).strip() or None
    for line in _git(base_tree.repo, "ls-tree", base_tree.rev,
                     "--", path).splitlines():
        head = line.split("\t", 1)[0].split()
        if len(head) >= 3 and head[1] == "blob":
            return head[2]
    return None


def _stale_entry_holds(head, argument, base_tree):
    """(holds, reason) for one entry. A non-None `reason` means the machine
    could not decide it, and `holds` says nothing."""
    if head in ("path-exists", "path-absent"):
        there = _base_entry_exists(base_tree, _stale_argument(argument))
        return (there if head == "path-exists" else not there), None

    if head == "sha-matches":
        path, sep, want = argument.strip().rpartition("@")
        path, want = _stale_argument(path), _stale_argument(want)
        if not sep or not path or not want:
            return False, "malformed argument"
        blob = _base_blob_id(base_tree, path)
        # A path that is not a blob at BASE cannot match an id — that is the
        # predicate answered, not a read that failed.
        if blob is None:
            return False, None
        return blob.startswith(want.lower()), None

    m = _ISSUE_ARG_RE.match(_stale_argument(argument))
    if m is None:
        return False, "malformed argument"
    state, reason = _issue_state(base_tree.repo, m.group(1))
    if reason is not None:
        return False, reason
    return state == ("OPEN" if head == "issue-open" else "CLOSED"), None


def evaluate_stale_if(tasks, base_tree):
    """The Stale-if slot of every task, answered against the tree at BASE.

    Returns `(refusals, advisories)`: one
    `STALE fact: task <id>: <entry> holds at BASE` line per entry that holds —
    a violation like any other, so the compile exits 2 and prints no
    `PLAN OK` — and one
    `STALE fact: task <id>: <entry> unreadable at BASE — <reason>` line per
    entry the machine cannot decide, printed after the verdict. An entry that
    is decidable and does not hold produces neither line.

    `<entry>` is the Stale-if line exactly as the author wrote it after its
    bullet, backticks and all, so the line the author reads is the line the
    author typed.

    Every task is evaluated, including the ones whose Files grammar is exempt:
    a gate/manual/release task carries the slot and goes stale the same way.
    Called only with a base to read — a bare `--check` and a plain compile
    evaluate no predicate at all."""
    refusals, advisories = [], []
    for t in tasks:
        for entry in _stale_entries(t):
            m = _STALE_ENTRY_RE.match(entry)
            if m is None:
                continue  # not a predicate at all — already a grammar refusal
            holds, reason = _stale_entry_holds(
                m.group(1), m.group(2), base_tree)
            if reason is not None:
                advisories.append(
                    "STALE fact: task %s: %s unreadable at BASE — %s"
                    % (t["id"], entry, reason))
            elif holds:
                refusals.append(
                    "STALE fact: task %s: %s holds at BASE" % (t["id"], entry))
    return refusals, advisories


# --------------------------------------------------------------------------- #
# BASE facts printed under `--check --base` (#896)                             #
# --------------------------------------------------------------------------- #
# Two facts about the tree that an author narrates from memory and gets wrong
# (runs 84, 88, 90 — 2026-09-10): what a file the plan deletes actually holds,
# and which files OUTSIDE a task's Files carry a literal its Machine clauses
# pin. Both are functions of artifacts we hold, so the compiler reads them off
# the tree at BASE and prints them after the verdict. They are facts, not
# advisories: nothing here refuses, and there is no species vocabulary — the
# reader is the author, before a gate reader is dispatched.

# A test case, in the shapes this repository's suites use.
_CASE_LINE_RE = re.compile(r"^\s*(?:test\(|it\(|def test_)")
# A section banner: a comment line that is a shouted heading — mostly capitals,
# at least twelve characters — or a box-drawing rule. What `THE PUBLISH FOLD —
# the exam of …` looks like at the top of a section.
_BANNER_RE = re.compile(
    r"^\s*(?://|#)\s*((?:[A-Z][A-Z0-9'\u2019#,:\-]*\s+){2}[A-Z][A-Z0-9'\u2019#,:\-]*.*?)\s*$")
_BANNER_CAP = 70
_RULE_RE = re.compile(r"^\s*(?://|#)\s*[\u2550\u2500=\-]{20,}\s*$")
# A Machine-clause literal short enough to be everywhere is not a fact worth
# printing; eight characters is where a quoted string starts to name one thing.
_LITERAL_MIN = 8
_LITERAL_FILES_SHOWN = 6
_LITERAL_CARRIERS_MAX = 40


def _file_shape(base_tree, rel):
    """(lines, cases, banners) of `rel` at BASE, or None when unreadable."""
    text = base_tree.read_text(rel)
    if text is None:
        return None
    lines = text.splitlines()
    cases = sum(1 for l in lines if _CASE_LINE_RE.match(l))
    banners = []
    for l in lines:
        m = _BANNER_RE.match(l)
        if m and not _RULE_RE.match(l):
            banners.append(m.group(1).strip()[:_BANNER_CAP])
    return len(lines), cases, banners


def _tree_files_carrying(base_tree, literal):
    """Every path at BASE whose text carries `literal` verbatim, sorted."""
    args = ["grep", "-F", "-l", "-e", literal]
    if base_tree.is_sha:
        out = _git(base_tree.repo, *args, base_tree.rev, "--", ".")
        strip = base_tree.rev + ":"
        paths = [l[len(strip):] if l.startswith(strip) else l
                 for l in out.splitlines()]
    else:
        out = _git(base_tree.repo, *args, "--", ".")
        paths = out.splitlines()
    return sorted(p for p in paths if p)


def _machine_literals(t, base_tree):
    """The backticked literals of a task's Machine clauses, in order, deduped,
    long enough to name one thing, and not a path referent (paths are the
    pinning script's business)."""
    machine = machine_restatement((t.get("claims") or {}).get("claim", ""))
    out = []
    for tok in PATH_RE.findall(machine):
        tok = tok.strip()
        if len(tok) < _LITERAL_MIN or "\n" in tok or tok in out:
            continue
        # A token that IS a path of the tree is a referent, pinned by the
        # pinning script; a path-shaped token the tree does not have
        # (`run_acceptance.sh` after its deletion, run-88) is a literal like
        # any other, and the files that still say it are the fact.
        rel = _path_referent(tok)
        if rel is not None and base_tree._blob_mode(rel) is not None:
            continue
        out.append(tok)
    return out


def base_fact_lines(tasks, base_tree):
    """One line per fact, in task order — empty for a task with nothing to
    say. Printed by `--check --base` after the verdict."""
    lines = []
    for t in tasks:
        if _files_grammar_exempt(t) or "claims" not in t:
            continue
        own = (set(t.get("creates", [])) | set(t.get("modifies", []))
               | set(t.get("reads", [])) | set(t.get("deletes", [])))
        for rel in t.get("deletes", []):
            shape = _file_shape(base_tree, rel)
            if shape is None:
                continue
            n, cases, banners = shape
            shown = "; ".join('"%s"' % b for b in banners[:8])
            if len(banners) > 8:
                shown += "; and %d more" % (len(banners) - 8)
            lines.append(
                "BASE fact: task %s deletes `%s` — %d lines, %d test cases, "
                "%d section banner%s%s"
                % (t["id"], rel, n, cases, len(banners),
                   "" if len(banners) == 1 else "s",
                   (": " + shown) if banners else ""))
        for lit in _machine_literals(t, base_tree):
            carriers = [p for p in _tree_files_carrying(base_tree, lit)
                        if p not in own]
            # A string carried by half the tree pins nothing in particular.
            if not carriers or len(carriers) > _LITERAL_CARRIERS_MAX:
                continue
            head = ", ".join(carriers[:_LITERAL_FILES_SHOWN])
            more = len(carriers) - _LITERAL_FILES_SHOWN
            lines.append(
                "BASE fact: task %s: `%s` is carried at BASE by %s%s — not in "
                "this task's Files"
                % (t["id"], lit, head,
                   (" and %d more" % more) if more > 0 else ""))
    return lines


# Deterministic, meaningful per-wave label. compile_plan is the single source: the
# engine reads these via args.waveLabels (so the live /workflows tree is labeled
# without orchestrator judgment) AND the swarm viewer reads them from build_dag.
# The engine's JS fallback is deliberately minimal (single-task title or
# 'Wave N'); this function is the only rich label source, delivered via
# --emit-args/waveLabels.
TITLE_STOP = {"the", "a", "an", "and", "or", "for", "to", "of", "with", "in",
              "on", "at", "by", "via", "plus"}


def _title_words(s):
    return [w for w in re.findall(r"[a-z][a-z]+", (s or "").lower())
            if len(w) >= 3 and w not in TITLE_STOP]


def _shared_title_noun(tasks):
    """The content word shared by EVERY task title (longest-first), or ''."""
    inter = None
    for t in tasks:
        ws = set(_title_words(t.get("title")))
        inter = ws if inter is None else (inter & ws)
        if not inter:
            return ""
    return sorted(inter, key=lambda w: (-len(w), w))[0] if inter else ""


def _common_file_dir(tasks):
    """The deepest parent directory shared by every file the wave touches, or ''."""
    common = None
    for t in tasks:
        files = [f for f in (t.get("files") or []) if isinstance(f, str) and "/" in f]
        if not files:
            return ""
        for f in files:
            segs = f.split("/")[:-1]
            if common is None:
                common = segs
            else:
                i = 0
                while i < len(common) and i < len(segs) and common[i] == segs[i]:
                    i += 1
                common = common[:i]
            if not common:
                return ""
    return "/".join(common) if common else ""


def derive_wave_label(tasks):
    """A single-task wave is named by its title; a multi-task wave by the noun its
    titles share (pluralized + counted, e.g. '4 Modules'), else the common file
    directory, else a plain count."""
    tasks = [t for t in tasks if t]
    if not tasks:
        return ""

    def clip(s, n=56):
        s = (s or "").strip()
        return (s[:n - 1] + "…") if len(s) > n else s

    if len(tasks) == 1:
        return clip(tasks[0].get("title") or ("Task " + str(tasks[0].get("id", ""))))
    noun = _shared_title_noun(tasks)
    if noun:
        cap = noun[0].upper() + noun[1:]
        return str(len(tasks)) + " " + (cap if cap.endswith("s") else cap + "s")
    d = _common_file_dir(tasks)
    if d:
        return clip(d) + " · " + str(len(tasks)) + " tasks"
    return str(len(tasks)) + " parallel tasks"


# ── the fact sheet (#913 §The prototype, Launch) ───────────────────────────── #
# One object per task, computed HERE and nowhere else: its files, where its
# exam lands, what the driver writes around that landing, and what its
# wave-mates own. Every consumer downstream reads the sheet instead of
# recomputing it, so the landing rule and the own-set rule have exactly one
# spelling in the run (#810 comment of 2026-09-11, decision 3).

# The run id a stamped compile is named for. The same alphabet the run
# directory and the reserved exam directories are spelled in; anything else is
# an input error, refused before a verdict or a payload is printed.
STAMP_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9-]*$")

# `fleet/exam-paths.mjs`, ported. The two spellings must stay identical: the
# engine hands the exam over at the path this computes, and the sheet promises
# the same path to everyone who reads it before the engine runs.
EXAM_ROOTS = ("fleet/tests/", "tests/")  # longest root first
# The one root whose landings are importable Python and therefore need
# `__init__.py` packaging (`ensurePackageInits` in run-engine.mjs); a
# `fleet/tests/` landing gets none.
PY_EXAM_ROOT = "tests/exams/"


def exam_slug(stamp):
    """`run-7` -> `run_7`. Every character outside `[A-Za-z0-9_]` becomes `_`
    so the reserved directory is a Python identifier and the exams under it
    form a real package."""
    return re.sub(r"[^A-Za-z0-9_]", "_", "" if stamp is None else str(stamp))


def reserved_exam_path(p, stamp):
    """Where a Proof path's exam is written TO. A path under neither test root
    — `t1_test.sh` and every plan that puts its tests elsewhere — is answered
    unchanged, and remapping is idempotent."""
    s = "" if p is None else str(p)
    for root in EXAM_ROOTS:
        if not s.startswith(root):
            continue
        d = root + "exams/" + exam_slug(stamp) + "/"
        return s if s.startswith(d) else d + s[len(root):]
    return s


def _placeholder_lead(entry):
    """True when an Interfaces bullet's LEAD WORD is one of the compiler's own
    placeholders — 'nothing', 'none', 'n/a', 'na' — i.e. the bullet names no
    contract at all. The sheet drops such a bullet outright (#911 finding 5) so
    a consumer never has to know the placeholder vocabulary."""
    words = str(entry or "").split()
    if not words:
        return True
    lead = words[0].replace("`", "").strip(string.punctuation).lower()
    return lead in PLACEHOLDER_TOKENS


def _sheet_files(task):
    """The task's own paths for sheet purposes: creates ∪ modifies ∪ reads ∪
    deletes, sorted. Deletes are IN (#911 finding 1) — a file the task removes
    is a file it owns — which is exactly where this differs from the `files`
    key the engine already reads (`_files_for`, deletes excluded, unchanged).

    A task with no parsed claims body has no sheet: every list of its sheet is
    empty, and it contributes nothing to a wave-mate's sibling set either."""
    if not task.get("claims"):
        return []
    return sorted(set(task.get("creates") or []) | set(task.get("modifies") or [])
                  | set(task.get("reads") or []) | set(task.get("deletes") or []))


def factsheet(task, wave, stamp):
    """The task's fact sheet: exactly nine keys, computed once.

    `task` is a parsed task dict; `wave` is the parsed task dicts of the wave
    it was layered into (the task itself included, and ignored); `stamp` is the
    run id `--stamp` named, or None on an unstamped compile — where every exam
    lands at the path its Proof names."""
    claims = task.get("claims") or {}
    files = _sheet_files(task)
    deletes = sorted(set(task.get("deletes") or [])) if claims else []
    guards = list(claims.get("proof_guards", [])) if claims else []
    proof_tests = list(claims.get("proof_tests_ordered", [])) if claims else []

    # A guarded path lands at itself: the whole point of a `Guard:` is that the
    # exam measures the file where the project keeps it (run-engine's
    # `landingOf`). Without a stamp there is no reserved directory to land in,
    # so every path is its own landing.
    landing = {}
    for p in proof_tests:
        landing[p] = (p if (stamp is None or p in guards)
                      else reserved_exam_path(p, stamp))

    # What the DRIVER writes for this task: every landing, plus the package
    # inits a Python landing under the reserved root needs — one at the root
    # and one at every directory between it and the file.
    owned = set(landing.values())
    if stamp is not None:
        root = PY_EXAM_ROOT + exam_slug(stamp)
        for land in landing.values():
            if not land.endswith(".py") or not land.startswith(root + "/"):
                continue
            at = root
            owned.add(at + "/__init__.py")
            for seg in land[len(root) + 1:].split("/")[:-1]:
                at += "/" + seg
                owned.add(at + "/__init__.py")

    sibling = set()
    for other in wave or []:
        if other.get("id") == task.get("id"):
            continue
        sibling.update(_sheet_files(other))

    interfaces = task.get("interfaces") or {}
    return {
        "files": files,
        "deletes": deletes,
        "guards": guards,
        "proofTests": proof_tests,
        "landing": landing,
        "driverOwned": sorted(owned),
        "siblingOwned": sorted(sibling),
        "produces": [b for b in (interfaces.get("produces") or [])
                     if claims and not _placeholder_lead(b)],
        "consumes": [b for b in (interfaces.get("consumes") or [])
                     if claims and not _placeholder_lead(b)],
    }


# Two tasks whose declared paths merely overlap are NOT ordered: they share a
# wave and the kernel folds their same-file edits at merge time. That became
# the one disposition after the 2026-08-14 counted A/B (0.640x wall, 1.111x
# tokens, all hard gates green — evals/frontier/results/2026-08-14-t15-ab.md),
# and it is no longer a knob.

# The one same-file tier claims-v1 can justify (spec 2026-08-31 §3 edge-tier
# table). `fold` leaves a mere same-file overlap unordered because the kernel
# merges the two edits line-wise at merge time — an argument that holds for
# TEXT and for nothing else. A non-text file (a raster asset, a compiled blob,
# a symlink whose content is a target rather than lines) has no line-wise
# merge, so two tasks naming one must be ordered. Classifying it needs a tree
# to read, and the compiler is handed one only when the caller provides it;
# with no tree root the pair is left unordered.
_BINARY_SNIFF_BYTES = 8192


def is_binary(tree_root, rel_path):
    """True when `rel_path` under the DIRECTORY `tree_root` is not a line-wise
    mergeable text file: a symlink, or a file whose first 8 KB carry a NUL
    byte. A path that cannot be read — absent, a directory, permission-denied —
    is False: a file that is not there is one a task is about to create, and
    presuming text is the fold-preserving direction.

    This is `BaseTree.is_binary`'s directory half; a sha reader asks the same
    question of a commit's tree (`ls-tree` mode `120000`, then a NUL sniff of
    `git show`) and answers it the same way."""
    p = Path(tree_root) / rel_path
    try:
        if p.is_symlink():
            return True
        with open(p, "rb") as fh:
            return b"\x00" in fh.read(_BINARY_SNIFF_BYTES)
    except OSError:
        return False


def build_edges(impl, tree_root=None):
    """Returns (edges, conflicts).

    Edges are DERIVED ordering only (spec 2026-08-31 §3 edge-tier table):
    the interface tier, the one existence edge write-after-create, and the
    non-text same-file tier. Nothing is read out of prose and nothing is
    declared: a Context slot that says "after Task 1 completes" orders nothing,
    and there is no marker left to say it with.

    Mere same-file overlap orders nothing — the kernel folds the two edits at
    merge time — EXCEPT when the shared path is NON-TEXT under `tree_root`,
    which no fold can merge. `tree_root` is the `BaseTree` the non-text
    classifier reads — a checkout directory or a commit sha, and this tier
    cannot tell which; None (the default) leaves the pair unordered.
    """
    # Edge precedence: semantic order-independent (write-after-create) then the
    # derived tiers, each of which yields to any opposing earlier PATH
    # (reachability), not just a direct reverse edge.
    # A cycle that survives this precedence is a genuine plan contradiction
    # and stays a loud error.
    ids = {t["id"] for t in impl}
    # `conflicts` is always empty and rides only so the caller's
    # `marker_conflicts` merge keeps one shape: every tier below is DERIVED, and
    # a derived edge has no author to blame. Every conflict a plan can still
    # earn — a late marker, a refused **Depends-on:**/**Commutes:** line — is
    # raised where it is read, not here.
    edges, conflicts, seen = [], [], set()
    # Fix E: maintain the adjacency map incrementally instead of rebuilding it
    # on every would_cycle call inside the O(N^2) pair loops (measured
    # superlinear blowup >= 80 tasks). add() appends to adj as it appends edges.
    adj = {}

    def add(a, b, why):
        if a in ids and b in ids and a != b and (a, b) not in seen:
            seen.add((a, b))
            edges.append({"from": a, "to": b, "why": why})
            adj.setdefault(a, []).append(b)

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

    # Tier 2: Semantic, order-independent — write-after-create. The ONE
    # existence edge: a task cannot modify a file another task has yet to
    # create, whatever the document order says.
    for a in impl:
        for b in impl:
            if a["id"] == b["id"]:
                continue
            if set(a["creates"]) & set(b["modifies"]):
                add(a["id"], b["id"], "write-after-create")

    # Interface tier (v6, spec 2026-06-16 §1.3). When B Consumes a symbol A
    # Produces (EXACT normalized-token equality — never fuzzy), B depends on A:
    # add a producer -> consumer edge. The interface signal is the most
    # informative `why` for its pair, so when an earlier tier already recorded
    # the (a, b) pair, its label is PROMOTED to "interface"; otherwise a fresh
    # edge is added. The symbols may not map to files, so it is cycle-guarded.
    # A Consumes with no matching Produces is not an error.
    produced = {a["id"]: {tok for p in a["interfaces"]["produces"]
                          if (tok := _interface_token(p))}
                for a in impl}
    for b in impl:
        b_consumes = {tok for c in b["interfaces"]["consumes"]
                      if (tok := _interface_token(c))}
        if not b_consumes:
            continue
        for a in impl:
            if a["id"] == b["id"]:
                continue
            if not (b_consumes & produced.get(a["id"], set())):
                continue
            existing = next((e for e in edges
                             if e["from"] == a["id"] and e["to"] == b["id"]), None)
            if existing is None and would_cycle(a["id"], b["id"]):
                continue
            if existing is not None:
                # Pair already ordered (an earlier tier): promote its label to
                # the more informative "interface".
                existing["why"] = "interface"
            else:
                add(a["id"], b["id"], "interface")

    # Proof-run tier (#978, the run-127 seam): B's Proof `Run:` command names a
    # path A's Files own and B's do not. B cannot run that file until A has
    # written it, so A comes first — the same existence argument
    # write-after-create makes, read off the command instead of the Files pair.
    # It sits AFTER the interface tier and before non-text-overlap so an
    # interface edge already recorded wins: a pair the interface tier ordered
    # is in `seen` and keeps its own `why`, and an opposing interface PATH
    # trips the cycle guard, so the derived-ordering edge simply does not
    # appear rather than contradicting the signed one.
    for b in impl:
        b_own = task_files(b)
        for cmd in (b.get("claims") or {}).get("proof_runs", []):
            for a in impl:
                if a["id"] == b["id"]:
                    continue
                if (a["id"], b["id"]) in seen:
                    continue
                named = sorted(p for p in task_files(a) - b_own
                               if command_names_path(cmd, p))
                if not named:
                    continue
                if would_cycle(a["id"], b["id"]):
                    continue
                add(a["id"], b["id"], "proof-run")

    # Tier 2b (claims-v1 ONLY): non-text same-file overlap. `fold` leaves a
    # same-file pair unordered because the kernel merges the two edits line-wise
    # — which it cannot do for a raster asset, a compiled blob, or a symlink. So
    # when a tree root is provided and some shared path is non-text there, the
    # pair is ordered in document order, cycle-guarded like every derived tier.
    if tree_root is not None:
        for a in impl:
            for b in impl:
                if a["id"] == b["id"] or a["order"] >= b["order"]:
                    continue
                shared = ((set(a["writes"]) | set(a["reads"]))
                          & (set(b["writes"]) | set(b["reads"])))
                if not any(tree_root.is_binary(p) for p in sorted(shared)):
                    continue
                if (a["id"], b["id"]) in seen or would_cycle(a["id"], b["id"]):
                    continue
                add(a["id"], b["id"], "non-text-overlap")

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


# --------------------------------------------------------------------------- #
# The tree at BASE — every git read of it goes through here.                  #
# --------------------------------------------------------------------------- #


def _git_run(base, *args, binary=False):
    """THE subprocess call every git read of a base tree makes: `git -C <base>`
    in the plan's own repository. Returns (ok, stdout) — ok False on ANY
    failure (missing git, not a checkout, no match, an absent path at a rev),
    so a tree read never raises. `binary=True` returns bytes, for a blob that
    need not decode as text."""
    try:
        p = subprocess.run(["git", "-C", str(base), *args],
                           capture_output=True, text=not binary)
    except OSError:
        return False, (b"" if binary else "")
    return p.returncode == 0, p.stdout


def _git(base, *args):
    """git in `base`; stdout text, or '' on ANY failure (missing git, not a
    checkout, no match) — a tree read never raises. Name and signature are
    load-bearing: `pin_base_facts.py` imports this."""
    ok, out = _git_run(base, *args)
    return out if ok else ""


# `rev` is how a read names the tree it reads. The sentinel "HEAD" is the
# DIRECTORY reader: it passes no tree-ish at all, so a read is of the working
# tree — an author's uncommitted file still resolves, exactly as it did at
# BASE. Any other rev is a commit sha, and every read is of that commit's
# tree, with no file opened off disk.
WORKTREE_REV = "HEAD"


def default_base(plan_path):
    """The git toplevel of the plan's directory, or None outside a checkout."""
    top = _git(Path(plan_path).resolve().parent, "rev-parse", "--show-toplevel").strip()
    return Path(top) if top else None


_SHA40_RE = re.compile(r"[0-9a-f]{40}")


class BaseTree:
    """The one reader every BASE-tree question in this file goes through.

    `--base` names a tree two ways and the difference stops here:

      * a CHECKOUT DIRECTORY — `repo` is the directory `git -C` runs in (a
        checkout, or any directory inside one; the fixture projects under
        `evals/fixtures/*/project` are the latter, and their reads have always
        been relative to the directory itself, so that is what `repo` holds),
        `rev` is the `WORKTREE_REV` sentinel, and a read is the working tree's.
      * a 40-hex SHA — `repo` is the plan's own git toplevel, `rev` is the sha,
        and every read is `git -C <repo> … <sha>`: `git show <sha>:<path>`,
        `git ls-tree <sha>`, `git grep … <sha>`. Nothing is opened off disk,
        because the commit need not be checked out anywhere.

    Both answer the same questions, so no caller below branches on which one it
    was handed — a sha is an input, and every line it produces is a line a
    directory could have produced (#725)."""

    def __init__(self, repo, rev=WORKTREE_REV):
        self.repo = Path(repo)
        self.rev = rev
        self._peeled = {}

    @classmethod
    def from_flag(cls, value, plan_path):
        """The reader a `--base` VALUE names, for the plan at `plan_path`.

        A directory (or any non-sha value, which stays the directory case so
        `<dir> is not a git checkout` remains the answer for a typo'd path) is
        read as itself. A 40-hex sha is resolved in the plan's own repository,
        and a sha that names no commit of it — or a plan that lies outside any
        checkout, so there is no repository to resolve it in — exits with one
        `error:` line naming the sha rather than compiling against a tree the
        caller did not ask for."""
        text = str(value)
        if Path(text).is_dir() or not _SHA40_RE.fullmatch(text):
            return cls(text)
        repo = default_base(plan_path)
        if repo is None:
            sys.exit("error: --base %s: no git checkout found for %s to "
                     "resolve the sha in"
                     % (text, Path(plan_path).resolve().parent))
        tree = cls(repo, text)
        if not tree.resolves_as_commit(text):
            sys.exit("error: --base %s names no commit of %s" % (text, repo))
        return tree

    @property
    def is_sha(self):
        return self.rev != WORKTREE_REV

    def __str__(self):
        """The tree, as a diagnostic names it — the directory or repository the
        reads run in, never a `BaseTree` repr."""
        return str(self.repo)

    def __eq__(self, other):
        """A directory reader IS the directory it was handed, so a caller
        holding that path still recognizes it (the render context's `base` is
        this reader, and BASE's was the path). A sha reader equals only another
        reader of the same repository at the same rev — no path is that tree."""
        if isinstance(other, BaseTree):
            return (self.repo, self.rev) == (other.repo, other.rev)
        if not self.is_sha and isinstance(other, (str, Path)):
            return self.repo == Path(other)
        return NotImplemented

    def __hash__(self):
        return hash(self.repo if not self.is_sha else (self.repo, self.rev))

    # --- the tree, question by question ---------------------------------- #
    def read_text(self, path):
        """`path`'s text at BASE, or None when it is not readable there."""
        if not self.is_sha:
            try:
                return (self.repo / path).read_text(errors="replace")
            except OSError:
                return None
        ok, raw = self._show(path)
        return raw.decode("utf-8", "replace") if ok else None

    def is_binary(self, path):
        """True when `path` is not a line-wise mergeable text file at BASE: a
        symlink, or a blob whose first 8 KB carry a NUL. A path that is not
        there is False — the fold-preserving direction `is_binary` takes."""
        if not self.is_sha:
            return is_binary(self.repo, path)
        mode = self._blob_mode(path)
        if mode is None:
            return False
        if mode == "120000":
            return True
        ok, raw = self._show(path)
        return ok and b"\x00" in raw[:_BINARY_SNIFF_BYTES]

    def resolves_as_commit(self, sha):
        """True when `sha` names a commit of this reader's repository."""
        return bool(self._peel(sha))

    def commit_sha(self):
        """The 40-hex commit this reader reads — the sha itself for a sha
        reader, the checkout's HEAD for a directory one. '' when there is
        none (an empty repository, a directory that is no checkout). The
        identity a generated block of BASE facts is stamped with."""
        return self._peel(self.rev)

    def is_checkout(self):
        """True when the reads can run at all: `repo` resolves to a checkout.
        Always true for a sha reader, which was resolved against one."""
        return bool(_git(self.repo, "rev-parse", "--show-toplevel").strip())

    # --- the two reads with no module-level function of their own --------- #
    def _peel(self, rev):
        """`rev-parse --verify --quiet <rev>^{commit}` prints the peeled sha on
        a hit and nothing on a miss — `cat-file -e` is silent both ways, so it
        cannot be read through `_git`, which returns '' for either outcome.
        Cached: one plan asks after the same sha many times."""
        if rev not in self._peeled:
            self._peeled[rev] = _git(self.repo, "rev-parse", "--verify",
                                     "--quiet", rev + "^{commit}").strip()
        return self._peeled[rev]

    def _show(self, path):
        return _git_run(self.repo, "show", "%s:%s" % (self.rev, path),
                        binary=True)

    def _blob_mode(self, path):
        """The tree entry's mode when `path` is a blob at `rev` (`100644`,
        `100755`, `120000`), None when it is absent or names a tree."""
        for line in _git(self.repo, "ls-tree", self.rev, "--", path).splitlines():
            head = line.split("\t", 1)[0].split()
            if len(head) >= 3 and head[1] == "blob":
                return head[0]
        return None


# Path referents. A backticked token in a task body may name a repo path, and
# `skills/ultrawrite/scripts/pin_base_facts.py` resolves those referents
# against the tree at BASE. It imports the normalizer (`_path_referent`) and
# the body-line selector (`_referent_scan_lines`) from here rather than
# re-implementing either, so what it pins is exactly what the compiler reads.
_REFERENT_EXTS = frozenset(
    "py js mjs cjs ts tsx jsx md json jsonl sh yml yaml toml txt html css "
    "sql csv lock cfg ini env tgz log".split())
_MIME_RE = re.compile(r"^(text|application|image|audio|video|multipart)/")
_FILES_BULLET_RE = re.compile(
    r"^\s*[-*+]\s*(Create|Modify|Delete|Test|Test fixture\(s\)|Fixture\(s\))\s*:")


def _path_referent(tok):
    """The normalized repo path a backticked token names, or None when the
    token is not a repo-path referent (identifier, dotted field, URL, glob,
    template, placeholder, absolute path, import specifier, MIME type)."""
    t = tok.strip()
    if (not t or any(c in t for c in "*?{}<>$~ ()'\"") or "://" in t
            or t.startswith(("-", "/", "./", "../")) or _MIME_RE.match(t)):
        return None
    t = re.sub(r":\d+(?:-\d+)?$", "", t).rstrip("/")
    if "/" in t:
        return t
    if t.startswith("."):
        return None  # a dotfile name alone is not a referent worth resolving
    m = EXT_RE.search(t)
    if m and m.group(1).lower() in _REFERENT_EXTS:
        return t
    return None


def _referent_scan_lines(task):
    """Body lines whose backticked tokens are referents: EVERY line including
    fenced content (a fenced markdown block names paths just as deadly),
    minus the fence markers themselves (their backtick runs mis-pair
    PATH_RE), the Files: bullets (the contract, grammar-checked), and the
    Commutes marker."""
    out = []
    for line, _fenced in _fence_aware_lines(task["body"]):
        s = line.strip()
        if FENCE.match(s) or _FILES_BULLET_RE.match(line) or s.startswith("**Commutes:**"):
            continue
        out.append(line)
    return out


def _bind_stamp_values(argv):
    """`--stamp -run7` names a --stamp whose VALUE is `-run7`; argparse would
    read the option-like token as another option and die with its own "expected
    one argument". The pair is rewritten `--stamp=-run7` so the value reaches
    STAMP_RE and is refused by the compiler's own `error: --stamp` line, which
    is what M1 promises for every value outside the pattern."""
    out, i, n = [], 0, len(argv)
    while i < n:
        tok = argv[i]
        if tok == "--":  # everything after the separator is positional
            out.extend(argv[i:])
            break
        if tok == "--stamp" and i + 1 < n and argv[i + 1] != "--":
            out.append("--stamp=" + argv[i + 1])
            i += 2
            continue
        out.append(tok)
        i += 1
    return out


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("plan", type=Path)
    ap.add_argument("--emit-launch", type=Path, default=None, dest="emit_launch",
                    metavar="PATH",
                    help="also write a launch-ready waves file (verbatim, "
                         "fence-aware task bodies) to PATH; waves.js reads bodies "
                         "from it via args.wavesPath so they never ride inline.")
    ap.add_argument("--emit-args", type=Path, default=None, dest="emit_args",
                    metavar="PATH",
                    help="also write the complete Workflow launch-args skeleton "
                         "(waves/wavesPath/edges/waveLabels/"
                         "globalConstraints/planPath) to PATH; the orchestrator "
                         "adds only per-task tier/review/testCmd and run knobs. "
                         "Requires --emit-launch.")
    ap.add_argument("--check", action="store_true",
                    help="authoring-time grammar validation only (#85): print "
                         "every violation with a did-you-mean fix and exit 2, "
                         "or print 'PLAN OK' and exit 0 — never emits waves. "
                         "Mutually exclusive with "
                         "--emit-launch/--emit-args/--run-dir.")
    ap.add_argument("--run-dir", type=Path, default=None, dest="run_dir",
                    help="absolute per-run directory; stamped into the args "
                         "skeleton as runDir (with pluginRoot) so the engine "
                         "routes all scratch there")
    ap.add_argument("--base", type=Path, default=None,
                    help="the tree file-level questions resolve against, given "
                         "either as <checkout-dir>, a checkout directory, or "
                         "as <sha>, a 40-hex commit of the plan's own "
                         "repository, which must be present locally: its tree "
                         "is read with git show/ls-tree, never checked out. It "
                         "is the tree the claims-v1 non-text same-file "
                         "classifier reads on a plain compile, where it orders "
                         "the pair. Unset, a claims-v1 same-file pair is left "
                         "unordered.")
    ap.add_argument("--stamp", default=None, metavar="RUN-ID",
                    help="the run id each task's exam landing is named for: "
                         "with it, a Proof `Test:` path under tests/ or "
                         "fleet/tests/ lands in that run's reserved exams "
                         "directory and the fact sheet says so; without it, "
                         "every exam lands at the path its Proof names. Legal "
                         "beside --check and beside the emit flags.")
    args = ap.parse_args(
        _bind_stamp_values(list(sys.argv[1:] if argv is None else argv)))
    emit_launch = args.emit_launch
    emit_args = args.emit_args
    # Refused before any verdict or payload is printed: a stamp outside the
    # alphabet would name a reserved directory nothing else in the run spells.
    if args.stamp is not None and not STAMP_RE.match(args.stamp):
        print("error: --stamp must match %s (got %r)"
              % (STAMP_RE.pattern, args.stamp), file=sys.stderr)
        return 2
    if args.check and (emit_launch is not None or emit_args is not None
                       or args.run_dir is not None):
        sys.exit("error: --check is mutually exclusive with --emit-launch/"
                 "--emit-args/--run-dir (--check only validates grammar; it "
                 "never emits launch files)")
    # One reader for the tree at BASE, built before any verdict is printed: a
    # `--base` sha that names no commit of the plan's repository is an input
    # error, and an input error prints no verdict line at all.
    base_tree = (BaseTree.from_flag(args.base, args.plan)
                 if args.base is not None else None)
    if args.check:
        violations = collect_violations(args.plan, base_tree)
        # The declared-dependencies refusals ride the error channel as well as
        # the verdict list: a spec the engine would hand to a shell is refused
        # on stderr here exactly as a plain compile refuses it, so a caller
        # that reads only the compiler's errors still gets the offending word.
        dependency_refusals = dependencies_violations(args.plan.read_text())
        if dependency_refusals:
            print("\n".join(dependency_refusals), file=sys.stderr)
        # The exam-sweep refusal rides the error channel too, for the same
        # reason: a `Run:` naming two exams at once is a sweep the fold's one
        # suite run already covers, and a caller that reads only the compiler's
        # errors still gets the offending command. The verdict list on stdout
        # is unchanged — this is an echo, not a move.
        sweep_refusals = [line for violation in violations
                          for line in violation.splitlines()
                          if line.startswith(EXAM_SWEEP_REFUSAL)]
        if sweep_refusals:
            print("\n".join(sweep_refusals), file=sys.stderr)
        if violations:
            print("\n\n".join(violations))
            print()
            print(f"{len(violations)} violation(s)")
            rc = 2
        else:
            print("PLAN OK")
            rc = 0
        # The tree's own facts about the plan, after the verdict and only with
        # a tree to read (#896): what a deleted file holds, and which files
        # outside a task's Files carry a literal its clauses pin.
        if base_tree is not None:
            plan_text = args.plan.read_text()
            tasks = [parse_task(t, raise_on_marker_error=False,
                                plan_claim=parse_plan_claim(plan_text))
                     for t in split_tasks(plan_text)]
            for line in base_fact_lines(tasks, base_tree):
                print(line)
            # ... and beside them, the Stale-if entries the machine could not
            # decide (#538). The refusals of the same read already rode in the
            # violations above; these are advisories, so they follow the
            # verdict whichever way it went and change no exit code.
            for line in evaluate_stale_if(tasks, base_tree)[1]:
                print(line)
            # ... and last, what the sitting that wrote this plan cost (#988).
            # Only with a tree to read, like its neighbours above: a bare
            # `--check` prints its verdict and nothing else.
            print(authoring_fact_line(args.plan))
        return rc
    if emit_args is not None and emit_launch is None:
        sys.exit("error: --emit-args requires --emit-launch (task bodies must "
                 "ride via the launch file, so wavesPath is always populated)")
    if args.run_dir is not None and emit_args is None:
        sys.exit("error: --run-dir requires --emit-args (the keys ride the "
                 "launch-args skeleton)")
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
    # (b)'s token must LOOK like a task id — contain a digit, or be <= 3 chars
    # (`2`, `A3`, `C4b`, `IV`) — so prose section headings whose second word is
    # an English word (`## Task tracking: overview`, `## Task list: …`) compile
    # as section boundaries instead of refusing the plan. Residual ambiguity:
    # a <=3-char word (`## Task ids:`) still flags; retitle such sections.
    bad_heads = _malformed_task_headings(plan_text)
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

    plan_grammar(plan_text)  # refuses a plan that declares no claims-v1 header
    plan_claim = parse_plan_claim(plan_text)
    tasks = [parse_task(t, plan_claim=plan_claim)
             for t in split_tasks(plan_text)]
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

    # Strict Files grammar (#85): an annotated Files line, an unknown label, or a
    # glob is a loud compile error — never a silent overlap drop. Collected across
    # every task so the author sees all diagnostics at once, and raised BEFORE
    # edge building so a violating line never reaches overlap inference partially.
    # Dispositions resolve BEFORE the Files gate (#91): Files grammar feeds
    # overlap inference, which only implementation tasks enter — a
    # gate/manual/release task's placeholder Files text is structurally
    # inert and must neither block compile nor warn. The disposition is READ
    # from the `**Type:**` marker, so `heuristic` is always false: there is no
    # guess left to flag. The key stays in the emitted row for consumers that
    # still read it.
    for t in tasks:
        t["disposition"], t["heuristic"] = disposition(t), False

    # claims-v1 body grammar (spec 2026-08-31 §4): a slot-shape, Steps,
    # refused-marker, fence, provenance, Stale-if or Proof-disjointness fault
    # is a loud compile error, raised BEFORE edge building for the same reason
    # the Files gate is — a body the compiler cannot read is a body whose
    # ordering it must not guess at.
    grammar_violations = (plan_claim_violations(plan_text)
                          + [v for t in tasks
                             for v in t.get("grammar_violations", [])]
                          + gate_verdict_violations(args.plan, tasks))
    # Plan-level: a `- Check:` command belongs to no task, so it is collected
    # from the plan text rather than from any task body.
    grammar_violations = (grammar_violations
                          + constraint_check_violations(plan_text)
                          + exam_command_violations(plan_text)
                          + dependencies_violations(plan_text)
                          + exam_shape_violations(plan_text, tasks))
    if grammar_violations:
        print("compile_plan: claims-v1 grammar violation(s) — refusing to "
              "compile:\n" + "\n".join(grammar_violations), file=sys.stderr)
        raise SystemExit(1)

    files_violations = [v for t in tasks
                        if not _files_grammar_exempt(t)
                        for v in _files_violations(t)]
    if files_violations:
        print("compile_plan: Files grammar violation(s) — refusing to compile "
              "(an annotated / unknown-label / glob Files line silently drops "
              "overlap coverage):\n" + "\n".join(files_violations),
              file=sys.stderr)
        raise SystemExit(1)

    # The declared exam command (#644), read once for the whole plan. The
    # refusal above has already run, so this template carries `{paths}` exactly
    # once; None here means every task's command derives from the shape table.
    exam_command = parse_exam_command(plan_text)

    out_tasks = []
    for t in tasks:
        out_tasks.append({"id": t["id"], "title": t["title"],
                          "disposition": t["disposition"],
                          "heuristic": t["heuristic"], "writes": t["writes"],
                          "depends_on": t["depends_on"],
                          "interfaces": t["interfaces"]})

    # Markers found outside the header block (after the Files block or the
    # first checkbox step) are never trusted — surface each task once.
    type_conflicts = [
        {"task": t["id"], "edge": "",
         "note": _late_marker_note(t["id"], t["late_markers"])
                 .split(": ", 1)[1]}
        for t in tasks if t.get("late_markers")]

    global_constraints = parse_global_constraints(plan_text)
    # The other kind of constraint: commands, not sentences. They ride beside
    # `globalConstraints` in all three payloads — the driver runs them, and
    # `fleet/run-main.mjs` spreads the args file into the engine's `args`, so
    # nothing else upstream has to learn the key.
    constraint_checks = parse_constraint_checks(plan_text)

    impl = [t for t in tasks if t["disposition"] == "implementation"]
    if not impl:
        # Bug D: a gates/release/manual-only plan compiles to waves: [] —
        # waves.js refuses empty waves, so warn loudly while still emitting
        # the JSON (exit 0): the per-task dispositions remain meaningful.
        print("compile_plan: no implementation tasks — nothing to wave "
              "(plan is gates/release/manual only); the per-task "
              "dispositions still apply.", file=sys.stderr)
    edges, conflicts = build_edges(impl, tree_root=base_tree)
    waves = layer(impl, edges)

    mode, degrade = "parallel", None
    # Fix B: a gates/release-only plan has waves: [] — there is nothing to
    # sequence, so skip the degrade entirely (the "no implementation tasks"
    # stderr warning above already covers the situation). Without this guard the
    # `len(impl) == 1` trigger still catches zero and emits the misleading
    # `Sequential mode: 0 implementation tasks` against an empty wave list.
    # The single-task trigger is `== 1`, not `<= 2`: a 2-impl-task plan with
    # disjoint writes is genuinely parallelizable into one wave, so degrading it
    # to two single-task waves would be needless serialization. The
    # fully-overlapping-writes trigger retired with the ordering-guess tiers:
    # under `fold` overlapping writes are exactly what SHARES a wave.
    if impl and len(impl) == 1:
        mode = "sequential"
        degrade = f"Sequential mode: {len(impl)} implementation tasks"

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
    # args.wavesPath). The orchestrator still derives tier per task; review is
    # plan-authored.
    by_id = {t["id"]: t for t in tasks}

    def _files_for(t):
        return sorted(set(t["creates"]) | set(t["modifies"]) | set(t["reads"]))

    # The fact sheet, computed once per task and put on BOTH emit sites, so a
    # consumer reading either file sees the same object for a task id.
    sheets = {tid: factsheet(by_id[tid], [by_id[x] for x in wave], args.stamp)
              for wave in waves for tid in wave}

    launch_waves = [
        [{"id": tid, "title": by_id[tid]["title"], "files": _files_for(by_id[tid]),
          "depends_on": by_id[tid]["depends_on"],
          "interfaces": by_id[tid]["interfaces"],
          # Single-channel knob slots (#89): waves.js reads task.tier and
          # task.review from these inline entries — the ONLY channel (workflow
          # scripts cannot read files, so knobs never ride the launch file).
          # The orchestrator fills tier; review is plan-authored (**Review:**
          # marker, "lean" when unmarked, "peer" for both `peer` and the
          # legacy `adversarial`) and never touched.
          "tier": None,
          "review": by_id[tid].get("review") or "lean",
          # Contention-detection inputs (spec §2b): writes is sorted
          # creates ∪ modifies (Test: paths excluded — a task never "writes"
          # what it only reads/runs). commutes is always [] — same-path
          # overlap is DERIVED from Files, never declared — and rides only so
          # the wave-entry shape the engine reads stays unchanged.
          "writes": by_id[tid].get("writes", []),
          "commutes": by_id[tid].get("commutes", []),
          # Task-scoped exam (#515, #553): the Proof `Test:` paths themselves,
          # in Proof order ([] for a body that names none), and the command the
          # implementer iterates against, derived from that same list. The
          # command is None whenever the Proof names nothing runnable, which
          # the engine reads as "use the run-wide command" — the paths still
          # ride, so a reviewer sees the exam a task was assigned even when it
          # is not a shape the runner can invoke.
          "proofTests": list(
              (by_id[tid].get("claims") or {}).get("proof_tests_ordered", [])),
          "testCmd": derive_task_test_cmd(
              (by_id[tid].get("claims") or {}).get("proof_tests_ordered", []),
              exam_command),
          # The Proof `Run:` commands (#589), in Proof order, [] for a task
          # that names none. The driver executes these in the task's clone; no
          # model ever runs one, and they are additive to testCmd, which still
          # derives from `Test:` paths alone.
          "proofRuns": list(
              (by_id[tid].get("claims") or {}).get("proof_runs", [])),
          # The Proof `Guard:` paths (#777), in Proof order, [] for a task that
          # names none. Plain data, not an obligation: the engine reads it with
          # `Array.isArray` and an absent key as [], and no `grammar:` line is
          # ever drawn from it.
          "proofGuards": list(
              (by_id[tid].get("claims") or {}).get("proof_guards", [])),
          # The fact sheet (#913): the task's own paths (deletes included),
          # where its exam lands, what the driver writes around that landing,
          # and what its wave-mates own. Computed once, above.
          "factsheet": sheets[tid]}
         for tid in wave]
        for wave in waves]

    # One deterministic label per wave (same order as waves/launch_waves). The
    # orchestrator threads these into args.waveLabels; the viewer reads them too.
    wave_labels = [derive_wave_label(wave) for wave in launch_waves]

    result = {
        "tasks": out_tasks,
        "dag_edges": edges,
        "marker_conflicts": marker_conflicts,
        "waves": waves,
        "launch_waves": launch_waves,
        "waveLabels": wave_labels,
        "mode": mode,
        "degrade_reason": degrade,
        "globalConstraints": global_constraints,
        "constraintChecks": constraint_checks,
    }

    # The plan's declared packages, the one shared literal every consumer of
    # this compile reads. ABSENT — not null — from both payloads when the
    # header carries no line, so a plan without one compiles byte-for-byte as
    # it did before the line existed.
    dependencies = parse_dependencies(plan_text)
    if dependencies is not None:
        result["dependencies"] = dependencies

    if emit_launch is not None:
        # The launch file carries the FULL, verbatim, fence-aware task bodies
        # (split_tasks already extracted them fence-aware). Each waves.js task
        # agent reads its own entry by id from this file — bodies never ride
        # inline in the Workflow call, and never transit a model.
        launch_payload = {
            # No knob slots here (#89): the engine cannot read this file —
            # tier/review ride the args wave entries. Task agents read only
            # their body + context from this file.
            "tasks": [{"id": tid, "title": by_id[tid]["title"],
                       "body": by_id[tid]["body"], "files": _files_for(by_id[tid]),
                       "depends_on": by_id[tid]["depends_on"],
                       "interfaces": by_id[tid]["interfaces"],
                       # Same contention-detection fields as launch_waves
                       # (spec §2b) — kept in sync so a consumer reading
                       # either file sees the same writes/commutes per task.
                       "writes": by_id[tid].get("writes", []),
                       "commutes": by_id[tid].get("commutes", []),
                       # The same object the wave entry carries (#913) — one
                       # computation, two payloads, never two answers.
                       "factsheet": sheets[tid]}
                      for wave in waves for tid in wave],
            "waves": waves,
            "waveLabels": wave_labels,
            "edges": [[e["from"], e["to"]] for e in edges],
            "globalConstraints": global_constraints,
            "constraintChecks": constraint_checks,
        }
        emit_launch.parent.mkdir(parents=True, exist_ok=True)
        emit_launch.write_text(json.dumps(launch_payload, indent=2))
        result["launch_file"] = str(emit_launch)

    if emit_args is not None:
        # The complete launch-args skeleton: everything deterministic rides
        # from here so the orchestrator never hand-assembles the edges
        # (forgetting args.edges silently disabled dependency blocking).
        args_payload = {
            "waves": launch_waves,
            "wavesPath": str(emit_launch.resolve()),
            "edges": [[e["from"], e["to"]] for e in edges],
            "dependencyEdges": [f"{e['from']} -> {e['to']} ({e['why']})"
                                for e in edges],
            "waveLabels": wave_labels,
            "globalConstraints": global_constraints,
            "constraintChecks": constraint_checks,
            "planPath": str(args.plan.resolve()),
            # The plan's ONE operator sentence (#552), or null when the header
            # carries none — every other key is unchanged.
            "planClaim": plan_claim,
        }
        # The same object the stdout result carries, under the same key and on
        # the same condition — the sandbox reads it back off this file.
        if dependencies is not None:
            args_payload["dependencies"] = dependencies
        if args.run_dir is not None:
            args_payload["pluginRoot"] = str(PLUGIN_ROOT)
            args_payload["runDir"] = str(args.run_dir.resolve())
        emit_args.parent.mkdir(parents=True, exist_ok=True)
        emit_args.write_text(json.dumps(args_payload, indent=2))
        result["args_file"] = str(emit_args)

    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
