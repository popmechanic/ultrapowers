#!/usr/bin/env python3
"""Deterministic compiler for Superpowers plans carrying ultraplan markers.

Parses a plan into tasks (fence-aware), classifies each per the plan-markers
contract (explicit **Type:** trusted; heuristics otherwise, flagged
"heuristic": true), builds the dependency DAG (explicit marker and text edges,
interface edges, and the one existence edge write-after-create — a task cannot
modify a file another task has yet to create), runs Kahn layering with cycle
detection, and emits the Step-3 transparency block as JSON on stdout.

The compiler orders only what a task DECLARES. Two tasks whose declared paths
merely overlap are NOT ordered — the kernel folds their same-file edits at
merge time. The one scheduling knob, `--overlap {serialize,fold}` (default
`fold`), is the rollback lever: `serialize`, and only `serialize`, re-enables
the document-order `write-after-write` tier.

What the compiler cannot see it refuses instead of guessing at: an
implementation task that declares no file paths is invisible to contention
detection, so it is a loud compile error rather than a silently serialized
"ambiguous" task.

The orchestrating agent runs this instead of hand-deriving waves; its
judgment is reserved for heuristic-flagged classifications and the derived
run knobs (testCmd / baseBranch / tiers / review depth), which stay with
the agent per dependency-analysis.md.
"""
from __future__ import annotations

import argparse
import fnmatch
import hashlib
import json
import re
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
MARKER_DEPS = re.compile(r"^\*\*Depends-on:\*\*\s*(.+?)\s*$")
# Authored review-depth marker (ultraplan #87): `**Review:** peer|lean`.
# `adversarial` is the pre-#556 spelling of `peer` — still accepted for one
# release, normalized to `peer` on the emitted wave entry so the engine and
# the report only ever see the documented value. Valid values are enforced
# where it is consumed in parse_task — an invalid or duplicate value is a
# compile-time SystemExit, never a silent default.
MARKER_REVIEW = re.compile(r"^\*\*Review:\*\*\s*([a-z-]+)\s*$")
VALID_REVIEWS = ("peer", "lean")
REVIEW_ALIASES = {"adversarial": "peer"}
# Declared order-insensitive additive registrations (spec §2b): comma-separated
# backticked paths the task asserts are safe to auto-union with another
# declaring task's edits to the same path. Validated against the task's own
# Files: block after it closes (see parse_task) — a path outside Files: is a
# rendered marker conflict, never a SystemExit.
MARKER_COMMUTES = re.compile(r"^\*\*Commutes:\*\*\s*(.+?)\s*$")
FILE_LINE = re.compile(r"^-\s*(Create|Modify|Test|Test fixture\(s\)|Fixture\(s\)):\s*(.+)$")
# A Proof `Run:` bullet (#589): the task's proof is a COMMAND, not an exam
# file. Deliberately NOT a FILE_LINE alternative — a `Run:` value is never a
# path, so it must never reach the Files parser, the disjointness set, or
# derive_task_test_cmd. It rides verbatim to the engine, which executes it in
# the task's clone through the same `sh` seam as the run-wide test command.
RUN_LINE = re.compile(r"^-\s*Run:\s*(.+)$")
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
TEXT_DEP = re.compile(r"(?:depends\s+on|after|requires)[\s:*]+Task\s+([A-Za-z0-9]+)", re.I)
# Plural conjunction/comma lists ("depends on Tasks 1 and 3", "after Tasks
# 1, 2 and 3") parse into one text edge per listed id.
TEXT_DEP_LIST = re.compile(
    r"(?:depends\s+on|after|requires)[\s:*]+Tasks\s+"
    r"((?:[A-Za-z0-9]+)(?:\s*(?:,|and|&)\s*[A-Za-z0-9]+)*)", re.I)
LIST_SPLIT = re.compile(r"\s*(?:,|\band\b|&)\s*", re.I)
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

TYPES = ("implementation", "gate", "release", "manual")
RELEASE_EV = re.compile(
    r"(git push|git checkout main|git merge (?:main|master)\b|\bssh\b|\bscp\b"
    r"|systemctl|after the branch merges)", re.I)
MANUAL_EV = re.compile(
    r"(the owner runs|cannot be done from this machine|on the deployment)", re.I)
GATE_EV = re.compile(
    r"(pytest|npm test|bun test|cargo test|go test|ruff|eslint|git status|git log)", re.I)
# Implementation verbs beyond build/QA. A task that writes nothing AND whose
# fence-stripped prose carries none of these is pure verification — the
# EMPTY_WRITES_GATE rule below treats it as a gate.
IMPL_PROSE_EV = re.compile(r"\b(implement|add|create|write|refactor|fix|modify)\b", re.I)
# Positive build/verification/QA evidence. The EMPTY_WRITES_GATE rule fires only
# when this matches, so a prose-only task with no writes AND no build/QA steps
# (e.g. a reference-notes task) is NOT swept into the gate bucket — it stays
# `implementation` for the orchestrator to re-judge. GATE_EV already covers the
# explicit test-runner/lint/git-status idioms; this adds the build/QA verbs those
# miss ("run the full build and the QA acceptance check").
BUILDQA_EV = re.compile(
    r"\b(build|rebuild|compile|verif\w*|acceptance|qa|smoke|sanity|lint)\b", re.I)


def _has_implementation_prose(prose):
    """True when the prose contains an implementation verb beyond build/QA.

    The prose is already fence-stripped (parse_task strips fenced lines), so a
    verb inside a fenced example never counts. Conservative by design: any
    genuine implementation verb keeps an empty-writes task as `implementation`;
    prose that only describes running build/test/QA returns False so
    EMPTY_WRITES_GATE can reclassify it as a gate."""
    return bool(IMPL_PROSE_EV.search(prose))


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
# claims-v1 (spec 2026-08-31 §3-§4). An OPT-IN grammar, declared by a
# `**Grammar:** claims-v1` line in the plan header. Absent, every line below is
# dead code and the compiler parses exactly as it always has — legacy is the
# rollback path and its output is pinned byte-for-byte by the fixture corpus.
#
# Every diagnostic this section can emit is namespaced `grammar:` so a
# claims-v1 refusal is never confused with a legacy one, and no pre-existing
# diagnostic string changes.
# ---------------------------------------------------------------------------
LEGACY_GRAMMAR = "legacy"
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
    """The grammar a plan declares: "claims-v1" or "legacy" (the default)."""
    for line, fenced in _fence_aware_lines(md_text):
        if fenced:
            continue
        if match_head(line):
            break  # the header ends at the first task heading
        m = GRAMMAR_RE.match(line.strip())
        if m and m.group(1) == CLAIMS_GRAMMAR:
            return CLAIMS_GRAMMAR
    return LEGACY_GRAMMAR


# The plan-level Claim (#552): ONE operator sentence above the first task, in
# the operator's words, about what they will see after the run. It is elicited
# — there is no issue to quote a sentence about a run that has not happened —
# so `(elicited)` is the only tag it takes.
PLAN_CLAIM_ELICITED_RE = re.compile(r"\(elicited\)\s*$", re.I)


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
    return PLAN_CLAIM_ELICITED_RE.sub("", raw).strip()


def plan_claim_violations(md_text):
    """The plan-level Claim's own `grammar:` refusals. Empty when the header
    carries none at all — a plan without a header Claim parses exactly as it
    did before #552."""
    raw = _plan_claim_raw(md_text)
    if raw is None:
        return []
    if not PLAN_CLAIM_ELICITED_RE.search(raw):
        return ["grammar: plan-level Claim carries no provenance tag — the one "
                "operator sentence above the first task is elicited, and closes "
                "`(elicited)`"]
    if not parse_plan_claim(md_text):
        return ["grammar: plan-level Claim carries no operator sentence — the "
                "header Claim is nothing but its `(elicited)` tag"]
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


def _exam_command_label(stripped):
    m = EXAM_COMMAND_LABEL_RE.match(stripped)
    return m.group(1) if m else None


def parse_exam_command(md_text):
    """The plan's `**Exam command:**` template, or None when the header carries
    no such line — in which case every task's command derives from the built-in
    shape table exactly as it did before #644."""
    return _plan_header_value(md_text, _exam_command_label)


def exam_command_violations(md_text):
    """The declared template's own refusals. `{paths}` is the whole contract:
    zero occurrences and the template runs the same files for every task (or
    none at all), two and the substitution is ambiguous."""
    template = parse_exam_command(md_text)
    if template is None:
        return []
    if template.count(EXAM_PATHS_TOKEN) != 1:
        return ["exam-command: the template must carry %s exactly once"
                % EXAM_PATHS_TOKEN]
    return []


def _claims_slot_name(raw):
    """Canonical slot name for a matched label (`stale if` -> `Stale-if`)."""
    key = re.sub(r"[\s-]+", "-", raw.strip().lower())
    return next(s for s in CLAIMS_SLOTS if s.lower() == key)


def _claims_file_paths(value):
    """The path(s) a Files-style bullet value names, by the same rule the
    legacy Files parser uses: backticked path-like tokens, else the first
    token when it is itself path-like."""
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


# --- Clause-to-leg citation (#554) -------------------------------------------
# run-51's proof gate rejected 11 of 24 pairs, every one for a gap a parser can
# see: a Machine clause no leg examined, a universal or negation no leg could
# falsify, an enumerated row without its own leg. So the grammar lets the
# Machine line NUMBER its clauses (`M1. … M2. …`) and every Proof leg CITE the
# clause it establishes (`[M2]`). The citation grammar is active for a task
# exactly when its Machine line carries a clause marker; an unnumbered Machine
# line (every plan authored before #554) parses as it always did and draws one
# advisory. Under the active grammar the mechanical gaps are refusals — a clause
# no leg cites, a leg citing nothing or a clause that does not exist — and the
# two judgment species (a universal/negation clause whose citing legs name
# nothing that fails, an enumerated clause with one citing leg) are advisories
# the gate agent reads with the mechanical gaps already closed.
MACHINE_LEAD_RE = re.compile(r"^machine\s*:\s*", re.I)
# A clause marker: `M<n>.` followed by whitespace, not glued to a word or a
# backtick (so `M1.5` in a literal or `xM2.` never marks a clause).
CLAUSE_MARK_RE = re.compile(r"(?<![\w`])M(\d+)\.(?=\s)")
# A leg's citation: `[M2]` or `[M1, M3]`; several brackets per leg all count.
LEG_CITE_RE = re.compile(r"\[\s*(M\d+(?:\s*,\s*M\d+)*)\s*\]")
LEG_LABEL_RE = re.compile(r"\(([a-z])\)")
LEGS_LEAD_RE = re.compile(r"(?m)^[-*+]?\s*legs?\s*:\s*", re.I)
BULLET_RE = re.compile(r"^[-*+]\s+")
# The judgment species. A clause is `universal` on a quantifier, `negation` on
# a negating word; either wants a citing leg that names what FAILS, is ABSENT,
# or is EXACTLY so — the falsifier tokens the ticket lists, plus the near
# synonyms run-51's accepted legs actually used. An `enumerated` clause names
# rows ("for each of node, pytest") and wants one leg per row, which the
# compiler can only approximate as "more than one citing leg".
UNIVERSAL_RE = re.compile(
    r"\b(every|all|each|any|always|only|whole|entire)\b", re.I)
NEGATION_RE = re.compile(
    r"\b(no|none|never|not|nothing|without|neither|nor|unchanged|absent|"
    r"byte-identical|identical)\b", re.I)
FALSIFIER_RE = re.compile(
    r"\b(fails?|failing|absent|exact(?:ly)?|verbatim|no|none|not|never|zero|empty|"
    r"refuses?|refused|identical|unchanged|deep-equals|only|nothing)\b", re.I)
ENUMERATED_RE = re.compile(
    r"\b(each of|for each|every one of|for every|one per)\b", re.I)


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


def clause_citation_advisories(task_id, clauses, legs):
    """The `ADVISORY grammar:` lines of the two judgment species for one task,
    plus the one line an unnumbered Machine line draws."""
    lines = []
    if not clauses:
        lines.append(
            "ADVISORY grammar: Machine line carries no numbered clauses — task "
            "%s; write it `M1. … M2. …` so every Proof leg can cite the clause "
            "it establishes (`[M1]`)" % task_id)
        return lines
    for c in clauses:
        citing = [l for l in legs if c["id"] in l["cites"]]
        species = ("universal" if UNIVERSAL_RE.search(c["text"]) else
                   "negation" if NEGATION_RE.search(c["text"]) else None)
        if species and not any(FALSIFIER_RE.search(l["text"]) for l in citing):
            lines.append(
                "ADVISORY grammar: %s clause %s has no falsifying leg — task "
                "%s: %s; a citing leg should name what fails, is absent, or is "
                "exactly so" % (species, c["id"], task_id, _short(c["text"])))
        if ENUMERATED_RE.search(c["text"]) and len(citing) < 2:
            lines.append(
                "ADVISORY grammar: enumerated clause %s is cited by %d leg — "
                "task %s: %s; each enumerated row needs its own leg"
                % (c["id"], len(citing), task_id, _short(c["text"])))
    return lines


# A Proof leg that quantifies over a path prefix (#536). The six forms the
# check reads: `no|every|each file under|in X` and the negated backticked glob
# (`no `fleet/tests/test_*.mjs` …`), X and the glob backticked. A quantifier
# whose prefix the task's own Files cover is checked BY the task's diff; one
# whose prefix they do not cover is a statement about BASE, and BASE may
# already hold a violator the author never looked for — run-49's Task 6 wrote
# "no `fleet/tests/test_*.mjs` contains more than ten `driveOne(` call sites"
# over a tree where one held 16. Advisory, never a refusal: a universal the
# author has genuinely checked is a good leg, and the line is the prompt.
DIR_QUANT_RE = re.compile(
    r"\b(?:no|every|each)\s+file\s+(?:under|in)\s+`([^`]+)`", re.I)
GLOB_QUANT_RE = re.compile(r"\bno\s+`([^`]*[*?\[][^`]*)`", re.I)
GLOB_CHARS = "*?["


def _glob_prefix(glob):
    """The leading glob-free directory part of a path glob, slash-terminated
    (`fleet/tests/test_*.mjs` -> `fleet/tests/`); the glob itself when its
    first segment already globs (`*.mjs`)."""
    segments = glob.split("/")
    lead = []
    for s in segments:
        if any(c in s for c in GLOB_CHARS):
            break
        lead.append(s)
    return "/".join(lead) + "/" if lead else glob


def _quantified_prefixes(text):
    """Every path prefix the leg `text` quantifies over, in reading order."""
    out = []
    for m in DIR_QUANT_RE.finditer(text):
        raw = m.group(1).strip()
        out.append(_glob_prefix(raw) if any(c in raw for c in GLOB_CHARS)
                   else raw.rstrip("/") + "/")
    for m in GLOB_QUANT_RE.finditer(text):
        out.append(_glob_prefix(m.group(1).strip()))
    return out


def _prefix_covered(prefix, paths):
    """True when one of the task's own Files paths lies under `prefix` (or,
    for a bare glob, matches it)."""
    if prefix.endswith("/"):
        return any(p == prefix.rstrip("/") or p.startswith(prefix)
                   for p in paths)
    return any(fnmatch.fnmatch(p, prefix)
               or fnmatch.fnmatch(p.rsplit("/", 1)[-1], prefix)
               for p in paths)


def directory_quantifier_advisories(task_id, legs, own_paths):
    """One `ADVISORY grammar: Proof leg ` line per (leg, quantified prefix)
    pair whose prefix no path in the task's own Files covers."""
    lines = []
    for leg in legs:
        seen = []
        for prefix in _quantified_prefixes(leg["text"]):
            if prefix in seen:
                continue
            seen.append(prefix)
            if _prefix_covered(prefix, own_paths):
                continue
            lines.append(
                "ADVISORY grammar: Proof leg quantifies over a path prefix "
                "outside the task's Files — task %s, leg %s: `%s`; \"%s\"; a "
                "universal over `%s` is checked against BASE, not against "
                "this task's diff"
                % (task_id, leg["label"], prefix, _short(leg["text"]), prefix))
    return lines


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
    for line, fenced in lines[proof_start:proof_end]:
        stripped = line.strip()
        f = None if fenced else FILE_LINE.match(stripped)
        r = None if fenced else RUN_LINE.match(stripped)
        if f and f.group(1) == "Test":
            for path in _claims_file_paths(f.group(2)):
                if path not in proof_tests:
                    proof_tests_ordered.append(path)
                proof_tests.add(path)
        elif r:
            command = _claims_run_command(r.group(1))
            proof_runs.append(command)
            if "`" in command:
                violations.append(
                    _backtick_command_violation("Run", command, task_id))
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
            "machine_clauses": machine_clauses,
            "proof_legs": proof_legs,
            "violations": violations}


# Task-scoped exams (#515): the implementer's red->green loop runs its OWN
# Proof, not the whole suite. Only two path shapes are runnable that way — a
# node test file under `fleet/tests/`, and any pytest file under `tests/`.
# Anything else (a doc, a fixture, a directory, a legacy body with no Proof at
# all) derives nothing, and the engine falls back to the run-wide command; the
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
    **Interfaces:** block the legacy pass has already parsed (they are
    unchanged under claims-v1, §3). The two tiers claims-v1 does not sign are
    dropped rather than trusted: whatever the legacy pass read out of a
    **Depends-on:**/**Commutes:** line is discarded here, and the line itself
    is a refusal recorded in `grammar_violations`."""
    claims = parse_claims_body(t["body"], t["id"], plan_claim)
    t.update(claims=claims,
             claim_provenance=claims["claim_provenance"],
             grammar_violations=claims["violations"],
             depends_on=[], depends_none=False,
             commutes=[], commutes_conflicts=[])
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
    verdict. Legacy plans never reach here."""
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



def parse_task(t, raise_on_marker_error=True, grammar=LEGACY_GRAMMAR,
               plan_claim=None):
    """Parse one task's body. raise_on_marker_error controls how a marker-VALUE
    validation failure (currently: an invalid or duplicate **Review:** value)
    is reported: True (the normal compile path, default) raises SystemExit
    immediately, so main() dies loudly at the first one found; False (the
    --check collecting mode, #85) records the same message into the returned
    task's `marker_violations` list instead, so collect_violations can gather
    every task's violations in one pass rather than aborting at the first.

    `grammar` selects the plan's declared grammar (plan_grammar). Under the
    default "legacy" this function is exactly what it has always been; under
    "claims-v1" the head markers (**Type:**/**Files:**/**Review:**) and the
    **Interfaces:** block parse identically — spec 2026-08-31 §3 keeps them
    signed and unchanged — and the six-slot body grammar is then overlaid by
    _apply_claims_grammar, which also drops the two body tiers claims-v1 does
    not sign (**Depends-on:**/**Commutes:**, both refused outright).

    `plan_claim` is the plan's header Claim, threaded to the body parser so a
    `(derived)` task Claim can be checked against the signature it descends
    from (#552). The default None preserves BASE behaviour for every caller
    that does not pass it."""
    ttype = None
    deps, deps_none = [], False
    commutes = []
    late_markers = []
    marker_violations = []
    creates, modifies, reads = [], [], []
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
        elif (m := MARKER_DEPS.match(s)):
            if not in_header:
                late_markers.append(s)
            else:
                # Accumulate across repeated **Depends-on:** lines — first-wins
                # silently dropped declared prerequisites. `none` combined with
                # concrete ids (across lines OR inline, `none, A`) is
                # contradictory: the ids win (the none assertion is void).
                tokens = [d.strip() for d in m.group(1).split(",") if d.strip()]
                id_tokens = [d for d in tokens if d.lower() != "none"]
                if len(id_tokens) != len(tokens):
                    deps_none = True
                if id_tokens:
                    deps.extend(id_tokens)
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
        elif (m := MARKER_COMMUTES.match(s)):
            if not in_header:
                late_markers.append(s)
            else:
                # Accumulate across repeated **Commutes:** lines, same as
                # **Depends-on:**. Prefer backticked paths; a bare comma-split
                # token is kept only when it is path-like on its own — a stray
                # prose fragment must not fabricate a phantom commutes path.
                for tok in m.group(1).split(","):
                    tok = tok.strip()
                    if not tok:
                        continue
                    backticked = [p for p in PATH_RE.findall(tok) if _is_pathlike(p)]
                    if backticked:
                        commutes.extend(backticked)
                    elif _is_pathlike(tok):
                        commutes.append(tok)
        elif is_markerish and s.rstrip() == "**Depends-on:**":
            # Exact marker, missing value. Inside the header it silently
            # degrades to the heuristics; outside it is a placement violation
            # surfaced like any late marker.
            if not in_header:
                late_markers.append(s + "  <missing value>")
        elif is_markerish:
            # A marker-shaped line that is not a trusted marker (`**type:**`,
            # `**Depends-On:**`, `**Type**:`). Inside the header it degrades to
            # the heuristics; after the header it surfaces as a late marker.
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
            # as a Files entry and over-serialize the task. Checkbox lines start
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
                elif f.group(1) in ("Modify", "Test fixture(s)", "Fixture(s)"):
                    # A declared test fixture is a file the task OWNS and writes
                    # (test data committed alongside the code) — treat it as a
                    # write so two tasks touching the same fixture serialize.
                    modifies.extend(paths)
                else:  # Test — the suite the task reads/runs, not a write
                    reads.extend(paths)
            elif s and not s.startswith("-"):
                in_files = False

    # Commutes: validation (spec §2b) — now that the Files: block has closed,
    # every declared commutes path must be one this task itself creates,
    # modifies, or reads. A path outside that set is a rendered marker
    # conflict (surfaced by the caller via commutes_conflicts, folded into
    # marker_conflicts), never a SystemExit — and the offending path is
    # dropped from the task's own commutes list so it never participates in
    # auto-union eligibility downstream.
    commutes_conflicts = []
    own_paths = set(creates) | set(modifies) | set(reads)
    kept_commutes = []
    for p in commutes:
        if p in own_paths:
            kept_commutes.append(p)
        else:
            commutes_conflicts.append(
                "Task {}: Commutes path `{}` is not in this task's own "
                "Files: block — declaration ignored for that path".format(
                    t["id"], p))
    commutes = kept_commutes

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
    prose_lines = [line for line, fenced in _fence_aware_lines(t["body"])
                   if not fenced and not TASK_HEAD.match(line)]
    prose = "\n".join(prose_lines)

    t.update(marker_type=ttype,
             # ids win over a contradictory `none` (the none assertion is void
             # once concrete prerequisites are declared).
             depends_on=deps, depends_none=deps_none and not deps,
             # Declared order-insensitive additive registrations (spec §2b),
             # filtered to paths that survived the own-Files validation above;
             # [] when the task declares no **Commutes:** marker at all.
             commutes=sorted(set(commutes)),
             commutes_conflicts=commutes_conflicts,
             late_markers=late_markers,
             # Marker-VALUE validation failures collected instead of raised
             # (only populated when raise_on_marker_error=False — the --check
             # CLI mode, #85); empty in the normal compile path since a
             # violation there raises SystemExit immediately instead.
             marker_violations=marker_violations,
             files_raw=files_raw,
             creates=sorted(set(creates)), modifies=sorted(set(modifies)),
             reads=sorted(set(reads)),
             writes=sorted(set(creates) | set(modifies)),
             interfaces={"consumes": consumes, "produces": produces},
             prose=prose)
    if grammar == CLAIMS_GRAMMAR:
        _apply_claims_grammar(t, plan_claim)
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
    # EMPTY_WRITES_GATE: a task that writes nothing and whose only steps are
    # build/verification (positive build/QA evidence, no implementation prose) is
    # a gate, not implementation — a verification task belongs in `gates`, not in
    # the wave plan ([c171bd23cbab3265]). The build/QA-evidence guard keeps a
    # prose-only task (no writes, no build/QA steps) classified `implementation`
    # rather than swept into the gate bucket.
    if (not t["writes"] and BUILDQA_EV.search(prose)
            and not _has_implementation_prose(prose)):
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
# the reviewer-prompt source layout …' into a spurious edge that over-serialized
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
# into a FALSE edge (silent and permanent), and the P1 blast-radius advisory
# matches every file containing the keyword (2026-09-01 papercut: 67 files).
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
CANONICAL_FILE_LABELS = ("Create", "Modify", "Test", "Test fixture(s)",
                         "Fixture(s)")
# `catch-all` was the declared-open-write-set construct (#85). The tier that
# consumed it is gone, so the bullet is now just an unknown label — routed
# through the same did-you-mean rather than parsed into a phantom construct.
_LABEL_SUGGEST = {"delete": "Modify", "remove": "Modify", "read": "Test",
                  "create-or-modify": "Modify", "add": "Create",
                  "catch-all": "Modify"}
_FILES_GLOB_CHARS = "*?[{"


# Dispositions whose Files block is exempt from the strict grammar (#91): a
# gate/manual/release task never enters overlap inference, so its placeholder
# Files text ("- Verify: `(none)`") is structurally inert.
#
# The exemption keys on the EXPLICIT `**Type:**` marker (`marker_type`) and
# NEVER on classify()'s heuristic result. An unknown Files label is itself what
# empties `writes`, and empty writes is what sends classify() into its gate
# heuristic — so a heuristic-keyed exemption would let a marker-less
# implementation task with a typo'd label buy its own exemption, compile
# silently as a "gate", drop out of the wave plan, and lose overlap coverage.
# A task with no explicit marker stays fully Files-checked.
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
    # for the same reason `_files_grammar_exempt` is (a heuristic key would let
    # the empty Files block that CAUSED the gate guess buy its own exemption),
    # and a `- none` block reaches here identically: it parses to no paths.
    if (task.get("marker_type") == "implementation"
            and not (task.get("creates") or task.get("modifies")
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


# The refusal main() raises at compile time (#440). One constant, two call
# sites: --check must refuse exactly what the full compile refuses, or its
# "green here means it launches" promise is false.
ACCEPTANCE_MISSING_ERROR = (
    "marked plan has no **Acceptance:** line (sealed or waived). "
    "Seal the exam (ultraplan sealing step) or record an explicit waiver. "
    "See docs/superpowers/specs/2026-06-12-sealed-acceptance-design.md")


def collect_violations(plan_path):
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

    grammar = plan_grammar(plan_text)
    tasks = [parse_task(t, raise_on_marker_error=False, grammar=grammar,
                        plan_claim=parse_plan_claim(plan_text))
             for t in raw_tasks]

    violations = []
    # claims-v1 body grammar (empty for every legacy plan, which declares no
    # grammar and so never enters the slot parser at all).
    for t in tasks:
        violations.extend(t.get("grammar_violations", []))
    # ... and the gate-verdict record, which is a grammar refusal on the same
    # footing (spec §4.5): both channels close on it, so an author never
    # discovers at dispatch that the gate was never run.
    if grammar == CLAIMS_GRAMMAR:
        violations.extend(plan_claim_violations(plan_text))
        violations.extend(gate_verdict_violations(plan_path, tasks))
    # ... and the Global-Constraints `- Check:` commands, which belong to no
    # task and so are checked once for the whole plan, in either grammar.
    violations.extend(constraint_check_violations(plan_text))
    # ... and the declared exam command (#644), plan-level for the same reason:
    # the shell that would run it does not care which grammar the plan declares.
    violations.extend(exam_command_violations(plan_text))
    violations.extend(exam_shape_violations(plan_text, tasks))
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
    # this must never key on the heuristic classifier.
    for t in tasks:
        if _files_grammar_exempt(t):
            continue
        violations.extend(_files_violations(t))
    # #440: scoped to MARKED plans, exactly as main() is — four committed
    # plans are unmarked and Acceptance-less, and must keep passing.
    if any(not classify(t)[1] for t in tasks) and \
            parse_acceptance(plan_text)["mode"] == "missing":
        violations.append(ACCEPTANCE_MISSING_ERROR)
    return violations


# ---------------------------------------------------------------------------
# The claims-v1 ADVISORY channel (spec 2026-08-31 §1.5, §3). Everything the
# compiler NOTICES about a claims-v1 plan but will not act on: a body slot
# phrased as an order (the text tier is off under claims-v1), a Consumes that
# pairs with no sibling Produces, the Context word count, and a same-file pair
# it cannot classify without a tree. Every line starts `ADVISORY grammar: ` and
# rides the `--check` tail AFTER the frozen verdict. Nothing here refuses — at
# any word count — and nothing here touches the exit code.
# ---------------------------------------------------------------------------
ORDERING_PHRASE_RE = re.compile(r"\bafter Task\s+\w+")
# The lead word of a Consumes/Produces value, bullet and backticks stripped —
# just enough to recognize the placeholders (`none`, `nothing (first task)`)
# the unmatched-Consumes advisory must stay silent about.
_INTERFACE_LEAD_RE = re.compile(r"^\s*(?:[-*+]\s*)?`?([A-Za-z][\w.-]*)")


def _slot_prose(text):
    """Slot text with fenced lines dropped — the same fence-aware rule the
    legacy prose scan uses, so a fenced example never draws an advisory."""
    return "\n".join(l for l, fenced in _fence_aware_lines(text) if not fenced)


def _is_placeholder_interface(value):
    """True for an explicitly empty Interfaces value (`none`, `nothing`)."""
    m = _INTERFACE_LEAD_RE.match(value)
    return bool(m) and m.group(1).lower() in PLACEHOLDER_TOKENS


def claims_grammar_advisories(tasks, tree_root=None):
    """Every `ADVISORY grammar:` line the parsed claims-v1 `tasks` draw.

    Pure and total: it reads the parsed tasks (and, for the same-file tier,
    the tree root, when one is provided, one shared path at a time) and
    returns lines. `tasks` that carry no claims overlay — every legacy task —
    contribute nothing."""
    tasks = [t for t in tasks if t.get("claims")]
    produced = {t["id"]: {tok for pr in t["interfaces"]["produces"]
                          if (tok := _interface_token(pr))} for t in tasks}
    lines = []
    for t in tasks:
        claims = t["claims"]
        # Ordering phrasing: under claims-v1 the sentence reads as an order and
        # is not one, because the text tier is off. Advisory, not a refusal —
        # the prose may be describing the world rather than sequencing it.
        for slot in CLAIMS_SLOTS:
            body = _slot_prose(claims.get(slot.lower().replace("-", "_"), ""))
            for m in ORDERING_PHRASE_RE.finditer(body):
                lines.append(
                    "ADVISORY grammar: ordering phrasing in a body slot never "
                    "orders — task %s, %s: %r; ordering is derived from "
                    "Interfaces and Files, so this sentence orders nothing"
                    % (t["id"], slot, m.group(0)))
        # A Consumes with no sibling Produces draws no interface edge, so
        # nothing orders the task against a producer. Free prose and a typo'd
        # symbol are the same finding: neither pairs.
        siblings = set()
        for other in tasks:
            if other["id"] != t["id"]:
                siblings |= produced[other["id"]]
        for entry in t["interfaces"]["consumes"]:
            value = entry.strip()
            if not value or _is_placeholder_interface(value):
                continue
            token = _interface_token(entry)
            if token and token in siblings:
                continue
            lines.append(
                "ADVISORY grammar: Consumes pairs with no sibling Produces — "
                "task %s: %s — %s, so no interface edge orders this task"
                % (t["id"], value,
                   "no sibling Produces `%s`" % token if token else
                   "the value is prose, which never tokens into a symbol"))
        # The word count is a MEASUREMENT, never a threshold (spec §1.5).
        lines.append("ADVISORY grammar: Context is %d words — task %s"
                     % (len(_slot_prose(claims.get("context", "")).split()),
                        t["id"]))
        # Clause-to-leg citation (#554): the judgment species, and the one
        # line an unnumbered Machine line draws.
        lines.extend(clause_citation_advisories(
            t["id"], claims.get("machine_clauses") or [],
            claims.get("proof_legs") or []))
        # A Proof leg quantifying over a directory the task does not write
        # (#536): the gate cannot see it — it reads the Claim and Proof text
        # with no tree — and the compiler has one.
        lines.extend(directory_quantifier_advisories(
            t["id"], claims.get("proof_legs") or [],
            sorted(set(t["creates"]) | set(t["modifies"]) | set(t["reads"]))))
    # Same-file pairs. What the compiler can say about a shared path depends on
    # whether it was handed a tree: with none it cannot tell a mergeable text
    # file from a non-text one it would have to order, and says so. With one it
    # asks `is_binary` per shared path — a non-text answer means the pair
    # cannot fold, so the advisory names the order the compile puts on it
    # instead of naming its own ignorance. A text-only pair folds and stays
    # silent.
    #
    # That order is NOT always Tier 2b's document-order `non-text-overlap`
    # edge. Tier 2b is guarded twice (:1734): it yields to any edge already on
    # the pair, and to one that would close a cycle. So an interface edge can
    # own the pair, in EITHER direction, and the advisory must report what the
    # compile actually did — asking the edge builder, not re-deriving the guess
    # and getting the reverse of the truth.
    pairs = []
    for i, a in enumerate(tasks):
        for b in tasks[i + 1:]:
            shared = sorted((set(a["writes"]) | set(a["reads"]))
                            & (set(b["writes"]) | set(b["reads"])))
            if shared:
                pairs.append((a, b, shared))
    edges = None
    if pairs and tree_root is not None:
        # The same edge set the compile builds: same grammar, same tree, and
        # the shipped `fold` overlap default (`serialize` is the rollback knob,
        # not what a `--check` predicts). Only implementation tasks enter it,
        # exactly as the compile's own `impl` filter does.
        edges, _ = build_edges(
            [t for t in tasks if classify(t)[0] == "implementation"],
            grammar=CLAIMS_GRAMMAR, tree_root=tree_root)
    for a, b, shared in pairs:
        if tree_root is None:
            lines.append(
                # This sentence is byte-frozen, not free prose: leg (e) of
                # tests/test_compile_plan_proof_runs.py pins every `--check`
                # byte for the Run-less fixture corpus against the compiler at
                # sha 0a3559a, and two of those fixtures print this line. #637
                # asked it to say `--base <checkout-dir>`; that edit fails the
                # frozen comparison, so the checkout-dir wording lives in the
                # `--base` help entry and the renders skip note instead.
                "ADVISORY grammar: same-file pair not classifiable without "
                "a tree — tasks %s and %s both name %s; pass --base so the "
                "compiler can tell a mergeable text file from a non-text "
                "one it must order"
                % (a["id"], b["id"],
                   ", ".join("`%s`" % p for p in shared)))
            continue
        non_text = [p for p in shared if is_binary(tree_root, p)]
        if not non_text:
            continue
        lines.append(
            "ADVISORY grammar: non-text same-file pair — tasks %s and %s "
            "both name %s; %s"
            % (a["id"], b["id"], ", ".join("`%s`" % p for p in non_text),
               _pair_ordering(edges, a["id"], b["id"])))
    return lines


def _reaches(edges, src, dst):
    """True when `dst` is reachable from `src` over `edges` (src itself is not
    a hit — an unordered pair must not read as ordered)."""
    adj = {}
    for e in edges:
        adj.setdefault(e["from"], []).append(e["to"])
    stack, seen = list(adj.get(src, ())), set()
    while stack:
        n = stack.pop()
        if n == dst:
            return True
        if n in seen:
            continue
        seen.add(n)
        stack.extend(adj.get(n, ()))
    return False


def _pair_ordering(edges, a_id, b_id):
    """How the compile orders the pair (a_id, b_id), as an advisory clause.

    Three cases, and every non-text pair lands in one of them:
      * a direct edge, in either direction — name it and its `why`. This is
        Tier 2b's own `a -> b (non-text-overlap)` when no earlier tier claimed
        the pair, and the earlier tier's edge and label when one did (Tier 2b's
        `seen` guard means the label is that tier's, not `non-text-overlap`).
      * no direct edge but a path — Tier 2b's cycle guard declined, because the
        other task already reaches this one transitively. The order is real;
        no single edge carries it, so none is named.
      * neither — the pair is not two implementation tasks, so no tier reaches
        it and the compile orders nothing. The non-text hazard is real and
        unmanaged, which is precisely what the reader needs told."""
    direct = next((e for e in edges
                   if {e["from"], e["to"]} == {a_id, b_id}), None)
    if direct is not None:
        return ("the compile orders %s -> %s (%s)"
                % (direct["from"], direct["to"], direct["why"]))
    for x, y in ((a_id, b_id), (b_id, a_id)):
        if _reaches(edges, x, y):
            return ("the compile already orders %s before %s, transitively"
                    % (x, y))
    return ("the compile orders neither — the pair is not two implementation "
            "tasks, so no edge tier reaches it")


def collect_advisories(plan_path, tree_root=None):
    """The `--check` advisory tail for a claims-v1 plan; [] for a legacy plan
    and for one the check's structural net already rejected (the same
    early-abort guards render_advisories uses — a parse the check could not
    trust is not one to advise over)."""
    plan_text = Path(plan_path).read_text()
    if plan_grammar(plan_text) != CLAIMS_GRAMMAR:
        return []
    if _malformed_task_headings(plan_text):
        return []
    raw = split_tasks(plan_text)
    ids = [t["id"] for t in raw]
    if not raw or len(set(ids)) != len(ids):
        return []
    return claims_grammar_advisories(
        [parse_task(t, raise_on_marker_error=False, grammar=CLAIMS_GRAMMAR,
                    plan_claim=parse_plan_claim(plan_text))
         for t in raw], tree_root)


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


# Overlap disposition — the ROLLBACK KNOB, and nothing else:
#   "fold"      (default) — two tasks whose declared paths merely overlap are
#                 NOT ordered; they share a wave and the kernel folds their
#                 same-file edits at merge time.
#   "serialize" — re-enables the document-order `write-after-write` tier, and
#                 exactly that tier: every other edge label is identical
#                 between the two modes.
# `fold` became the default after the 2026-08-14 counted A/B (0.640x wall,
# 1.111x tokens, all hard gates green — evals/frontier/results/2026-08-14-t15-ab.md).
OVERLAP_MODES = ("serialize", "fold")
OVERLAP_DEFAULT = "fold"

# The one same-file tier claims-v1 can justify (spec 2026-08-31 §3 edge-tier
# table). `fold` leaves a mere same-file overlap unordered because the kernel
# merges the two edits line-wise at merge time — an argument that holds for
# TEXT and for nothing else. A non-text file (a raster asset, a compiled blob,
# a symlink whose content is a target rather than lines) has no line-wise
# merge, so two tasks naming one must be ordered. Classifying it needs a tree
# to read, and the compiler is handed one only when the caller provides it; with
# no tree root nothing is ordered and the advisory channel says exactly why.
_BINARY_SNIFF_BYTES = 8192


def is_binary(tree_root, rel_path):
    """True when `rel_path` under `tree_root` is not a line-wise mergeable text
    file: a symlink, or a file whose first 8 KB carry a NUL byte. A path that
    cannot be read — absent, a directory, permission-denied — is False: a file
    that is not there is one a task is about to create, and presuming text is
    the fold-preserving direction."""
    p = Path(tree_root) / rel_path
    try:
        if p.is_symlink():
            return True
        with open(p, "rb") as fh:
            return b"\x00" in fh.read(_BINARY_SNIFF_BYTES)
    except OSError:
        return False


def build_edges(impl, overlap_mode=OVERLAP_DEFAULT, grammar=LEGACY_GRAMMAR,
                tree_root=None):
    """Returns (edges, conflicts).

    Edges are DECLARED-ordering only: marker, text, interface, and the one
    existence edge write-after-create. Mere same-file overlap orders nothing —
    unless `overlap_mode == "serialize"`, the rollback knob, which re-adds the
    document-order `write-after-write` tier and only that tier.

    `grammar` selects the plan's declared grammar (plan_grammar). Under the
    default "legacy" every tier below is exactly what it has always been. Under
    "claims-v1" (spec 2026-08-31 §3 edge-tier table) three things differ, and
    nothing else: the TEXT tier is off (a body slot's prose orders nothing —
    the advisory channel says so out loud), the `undeclared-dependency`
    cross-check is retired (see its own comment), and a same-file pair whose
    shared path is NON-TEXT under `tree_root` is ordered, since no kernel fold
    can merge it. `tree_root` is the tree the non-text classifier reads; None
    (the default) leaves the pair unordered and draws an advisory instead.
    """
    if overlap_mode not in OVERLAP_MODES:
        raise ValueError("unknown overlap mode: %r" % (overlap_mode,))
    # Edge precedence:
    # explicit (marker, text) > semantic order-independent (write-after-create)
    # > the document-order `write-after-write` heuristic (serialize mode only),
    # which yields to any opposing earlier PATH (reachability), not just a
    # direct reverse edge.
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

    # Tier 1: Explicit — text edges, LEGACY ONLY. Under claims-v1 ordering
    # is derived from Interfaces and Files and never from prose (spec §3),
    # so this tier does not run at all — a Context slot that says "after
    # Task 1 completes" draws an `ADVISORY grammar:` line instead of a
    # silent edge the grammar never signed.
    # (Moved up from the bottom to enforce precedence; scans fence-stripped
    # prose so a fenced example saying "runs after Task A" fabricates nothing.)
    if grammar != CLAIMS_GRAMMAR:
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
    # informative `why` for its pair, so when an earlier tier (marker, file
    # overlap) already recorded the (a, b) pair, its label is PROMOTED to
    # "interface"; otherwise a fresh edge is added. The symbols may not map to
    # files, so it is cycle-guarded.
    # Every edge NOT already covered by a Depends-on marker or a file-overlap edge
    # is surfaced as a loud "undeclared dependency" finding: the plan runs
    # correctly AND the author is told their Depends-on was wrong. A Consumes with
    # no matching Produces is not an error.
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
            declared = a["id"] in b["depends_on"]
            file_overlap = (existing is not None
                            and existing["why"] in ("write-after-create",
                                                    "write-after-write"))
            if existing is not None:
                # Pair already ordered (marker / file overlap / earlier tier):
                # promote its label to the more informative "interface".
                existing["why"] = "interface"
                added = False
            else:
                add(a["id"], b["id"], "interface")
                added = True
            # RETIRED under claims-v1 (spec §3 edge-tier table, amended
            # after run-43). `declared` reads b's **Depends-on:**, which
            # the grammar zeroes — so this fired on the canonical happy
            # path, telling the author to add a marker claims-v1 refuses
            # outright. The legacy conflict is untouched.
            if (not declared and not file_overlap
                    and grammar != CLAIMS_GRAMMAR):
                shared = sorted(b_consumes & produced[a["id"]])
                add_conflict(
                    b["id"],
                    "undeclared: " + a["id"] + " -> " + b["id"] + " (interface)",
                    "undeclared dependency: Task " + b["id"] + " Consumes "
                    + ", ".join(shared[:3]) + " which Task " + a["id"]
                    + " Produces, but Task " + b["id"]
                    + " does not declare **Depends-on:** " + a["id"]
                    + " and shares no file with it — add the marker"
                    + ("" if added else " (edge already present)"),
                    kind="undeclared-dependency")

    # Tier 2b (claims-v1 ONLY): non-text same-file overlap. `fold` leaves a
    # same-file pair unordered because the kernel merges the two edits line-wise
    # — which it cannot do for a raster asset, a compiled blob, or a symlink. So
    # when a tree root is provided and some shared path is non-text there, the
    # pair is ordered in document order, cycle-guarded like every derived tier.
    if grammar == CLAIMS_GRAMMAR and tree_root is not None:
        for a in impl:
            for b in impl:
                if a["id"] == b["id"] or a["order"] >= b["order"]:
                    continue
                shared = ((set(a["writes"]) | set(a["reads"]))
                          & (set(b["writes"]) | set(b["reads"])))
                if not any(is_binary(tree_root, p) for p in sorted(shared)):
                    continue
                if (a["id"], b["id"]) in seen or would_cycle(a["id"], b["id"]):
                    continue
                add(a["id"], b["id"], "non-text-overlap")

    # Tier 3 (`--overlap serialize` ONLY — the rollback knob): document-order
    # `write-after-write`. The overlap set is (writes union reads) on both
    # sides, so two tasks listing the same `Test:` path serialize too. Add only
    # when doc order is forward AND b cannot already reach a (reachability
    # guard, Bug A), so the tier can never close a cycle.
    #
    # Under the shipped `fold` default this loop does not run at all: mere
    # same-file overlap orders nothing and the kernel folds the two edits at
    # merge time.
    if overlap_mode == "serialize":
        for a in impl:
            for b in impl:
                if a["id"] == b["id"]:
                    continue
                a_touch = set(a["writes"]) | set(a["reads"])
                b_touch = set(b["writes"]) | set(b["reads"])
                if (a_touch & b_touch
                        and a["order"] < b["order"]
                        and (a["id"], b["id"]) not in seen
                        and not would_cycle(a["id"], b["id"])):
                    add(a["id"], b["id"], "write-after-write")

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
# Advisory renders (#345 eval cell) — `--check --renders` ONLY.               #
# --------------------------------------------------------------------------- #
# The --check diagnostic vocabulary is frozen (0.1.0). These renders are
# ADVISORY: they print AFTER the check verdict, never change the exit code,
# and print nothing at all when they have nothing to say — so `PLAN OK` stays
# byte-identical on a clean plan. They live behind the `--renders` flag so the
# default `--check` output is unchanged until an eval-measured adoption flips
# the default (evals/check_renders_ab.py writes the measurement).
#
# A render is `fn(tasks, ctx) -> list[str]`: `tasks` is the parse_task output
# for every task in document order; `ctx` is {"base": Path, "plan_path": Path,
# "tracked": set[str] (git ls-files under base), "task_ids": set[str],
# "exclude": tuple[str, ...] (base-relative paths hidden from every tracked-
# file lookup — `--exclude`, the eval campaign's seam for keeping its own
# files out of its measurement; empty by default)}. Every line a render
# returns starts with the literal prefix "ADVISORY ".
CODE_EXTS = (".py", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".sh")
# Registry of (name, fn). Renders APPEND themselves here — an order-insensitive
# registration surface; the order lines print in is registration order.
ADVISORY_RENDERS = []


def _git(base, *args):
    """git in `base`; stdout text, or '' on ANY failure (missing git, not a
    checkout, no match) — advisory code never raises."""
    try:
        p = subprocess.run(["git", "-C", str(base), *args],
                           capture_output=True, text=True)
    except OSError:
        return ""
    return p.stdout if p.returncode == 0 else ""


def _exclude_pathspecs(exclude):
    return [":(exclude)" + p for p in exclude]


def _git_tracked(base, exclude=()):
    """Tracked paths under `base`, relative to it, minus `exclude`."""
    spec = ["--", "."] + _exclude_pathspecs(exclude) if exclude else []
    return set(_git(base, "ls-files", *spec).split())


def _code_pathspecs(exclude=()):
    return ["--"] + ["*" + ext for ext in CODE_EXTS] + _exclude_pathspecs(exclude)


def _git_word_files(base, word, exclude=()):
    """Tracked CODE files (CODE_EXTS) under `base` containing `word` as a
    whole word (`git grep -l -w -F`), sorted, relative to `base`."""
    return sorted(_git(base, "grep", "-l", "-w", "-F", word,
                       *_code_pathspecs(exclude)).split())


def _git_literal_in_code(base, literal, exclude=()):
    """True when some tracked CODE file under `base` contains `literal`."""
    return bool(_git(base, "grep", "-l", "-F", literal,
                     *_code_pathspecs(exclude)).strip())


def _git_substring_files(base, literal, exclude=()):
    """Tracked files under `base` containing `literal` as a SUBSTRING
    (`git grep -l -F`), sorted, relative to `base`.

    Unlike `_git_word_files` this is neither word-bounded nor extension-scoped:
    a Machine clause pins spans like `runner: None`, which is not one word and
    can be asserted from a fixture of any extension. `-e` keeps a span opening
    with `-` from reading as a flag."""
    return sorted(_git(base, "grep", "-l", "-F", "-e", literal,
                       "--", *_exclude_pathspecs(exclude)).split())


def default_base(plan_path):
    """The git toplevel of the plan's directory, or None outside a checkout."""
    top = _git(Path(plan_path).resolve().parent, "rev-parse", "--show-toplevel").strip()
    return Path(top) if top else None


def render_advisories(plan_path, base, exclude=()):
    """Every registered render's lines for `plan_path` against the tree at
    `base`. Returns [] when the plan failed the check's structural early-abort
    net (malformed heading, no tasks, duplicate ids) — a parse the check could
    not trust is not one to render over. A `base` that is not a git checkout
    yields the single skip note instead of guessing. A render that raises
    degrades to one `render failed` line — advisory output never changes the
    check's exit code, so nothing here may propagate. A `base` that is a 40-hex
    sha naming no directory says so in its own words: the flag wants a checkout
    directory, not a commit."""
    plan_text = Path(plan_path).read_text()
    if _malformed_task_headings(plan_text):
        return []
    raw = split_tasks(plan_text)
    ids = [t["id"] for t in raw]
    if not raw or len(set(ids)) != len(ids):
        return []
    if base is None:
        return ["ADVISORY renders skipped: no git checkout found for %s (pass --base)"
                % Path(plan_path).resolve().parent]
    # A 40-hex `--base` that names no directory is a commit sha someone reached
    # for where the flag wants a checkout: say so, rather than reporting the sha
    # as a directory that failed to be a checkout (#637).
    if not Path(base).is_dir() and re.fullmatch(r"[0-9a-f]{40}", str(base)):
        return ["ADVISORY renders skipped: --base wants a checkout directory, "
                "got a commit sha %s" % base]
    if not _git(base, "rev-parse", "--show-toplevel").strip():
        return ["ADVISORY renders skipped: %s is not a git checkout" % base]
    # Grammar-aware, like the compile and `--check` call sites: a claims-v1
    # body is six SLOTS, not legacy prose, and its two unsigned tiers are
    # zeroed. Parsing it as legacy here made the renders read slot bodies
    # under a grammar the plan is not written in.
    tasks = [parse_task(t, raise_on_marker_error=False,
                        grammar=plan_grammar(plan_text),
                        plan_claim=parse_plan_claim(plan_text)) for t in raw]
    exclude = tuple(exclude)
    ctx = {"base": Path(base), "plan_path": Path(plan_path).resolve(),
           "tracked": _git_tracked(base, exclude), "task_ids": set(ids),
           "exclude": exclude}
    lines = []
    for name, fn in ADVISORY_RENDERS:
        try:
            lines.extend(fn(tasks, ctx))
        except Exception as e:  # noqa: BLE001 — advisory: degrade, never raise
            lines.append("ADVISORY %s: render failed (%s)" % (name, type(e).__name__))
    return lines


# P1 — Produces blast radius (#233 build, #345 eval cell). For every symbol a
# task's Produces declares, the CODE files at BASE outside the task's own
# Files that mention it as a whole word. Keyed on EVERY Produces symbol, not
# only deleted/renamed ones — run-14's additive shim-outcome shape change had
# its strict-equality pin in a sibling-owned test file. Advisory: a listed
# file is somewhere the implementer must look (ultraplan Move 3), never a
# refusal.
_SYMBOL_RE = re.compile(r"^[A-Za-z_]\w*$")
_BLAST_LIST_CAP = 8


def _multiword_symbol(sym):
    """camelCase / snake_case / CONSTANT_CASE — an identifier, not a word."""
    return "_" in sym or any(c.isupper() for c in sym[1:])


def _produces_symbols(task):
    """Symbol tokens the task's Produces lines declare, document order, deduped.
    Every backticked span reduces like _interface_token's lead (cut at the
    first '(', whitespace, or ':'); the lead span is kept at >= 5 chars or
    multi-word, a non-lead span only when multi-word — single common words
    (`main`, `delivered`, `token`) are grep noise, measured (#345)."""
    out = []
    for entry in task["interfaces"]["produces"]:
        for k, span in enumerate(PATH_RE.findall(entry)):
            sym = re.split(r"[(\s:]", span, 1)[0].strip("`").strip()
            if not _SYMBOL_RE.match(sym) or sym.lower() in PLACEHOLDER_TOKENS:
                continue
            if not _multiword_symbol(sym) and (k > 0 or len(sym) < 5):
                continue
            if sym not in out:
                out.append(sym)
    return out


def _render_blast_radius(tasks, ctx):
    lines = []
    for t in tasks:
        own = set(t["creates"]) | set(t["modifies"]) | set(t["reads"])
        for sym in _produces_symbols(t):
            hits = [f for f in _git_word_files(ctx["base"], sym, ctx.get("exclude", ()))
                    if f not in own]
            if not hits:
                continue
            lines.append("ADVISORY blast-radius: Task %s Produces `%s` — %d file(s) "
                         "at BASE outside Task %s's Files mention it:"
                         % (t["id"], sym, len(hits), t["id"]))
            lines.extend("  - " + f for f in hits[:_BLAST_LIST_CAP])
            if len(hits) > _BLAST_LIST_CAP:
                lines.append("  … +%d more" % (len(hits) - _BLAST_LIST_CAP))
    return lines


ADVISORY_RENDERS.append(("blast-radius", _render_blast_radius))


# --- advisory renders register below (append zone) --------------------------

# P2 — referent existence (#321 item 2 ∪ #237(b) ∪ #237(c); #345 eval cell).
# A plan body asserting the existence of something the compiler can check —
# a path against the tree at BASE, a report/detail field against
# report-format.md (or the code that defines it), a `Task N` against the
# plan's own headings — is resolved once; each unresolved referent renders
# once, advisory. Ultraplan authoring rule 6 is the prose half.
_REFERENT_EXTS = frozenset(
    "py js mjs cjs ts tsx jsx md json jsonl sh yml yaml toml txt html css "
    "sql csv lock cfg ini env tgz log".split())
_MIME_RE = re.compile(r"^(text|application|image|audio|video|multipart)/")
_FIELD_HEADS = ("report", "result", "detail", "tasks", "waveMerges", "frontier",
                "coverage", "acceptance", "tests", "baseline", "blockedWaves",
                "missingDeliverables", "deferredVerification")
_FIELD_RE = re.compile(r"^(?:%s)(?:\[\])?(?:\.[A-Za-z_]\w*(?:\[\])?)+$"
                       % "|".join(_FIELD_HEADS))
# `Task <id>` where <id> LOOKS like a task id: contains a digit, or is 1-3
# uppercase alphanumerics led by a letter (`A`, `B3`, `IV`). `Task agents`,
# `Task IDs`, `Task list` never match. Only the first id of a list/range is
# captured — under-reporting is the safe direction for an advisory.
_TASK_REF_RE = re.compile(r"\bTasks?\s+((?=[A-Za-z0-9]*\d)[A-Za-z0-9]+|[A-Z][A-Z0-9]{0,2})\b")
_FILES_BULLET_RE = re.compile(
    r"^\s*[-*+]\s*(Create|Modify|Test|Test fixture\(s\)|Fixture\(s\))\s*:")


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


def _report_field_vocab():
    """Every field name report-format.md defines: JSON keys in its schema
    block plus every segment of every backticked dotted token in its text.
    None when the file cannot be read (a compiler copied out of its plugin
    tree) — the field check then skips rather than reporting every field
    as unknown."""
    try:
        text = (PLUGIN_ROOT / "skills/ultrapowers/references/report-format.md").read_text()
    except OSError:
        return None
    names = set(re.findall(r'"([A-Za-z_]\w*)"\s*:', text))
    for tok in re.findall(r"`([A-Za-z_][\w\[\].]*)`", text):
        for seg in tok.split("."):
            seg = seg.replace("[]", "")
            if seg:
                names.add(seg)
    return names


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


def _render_referents(tasks, ctx):
    base, tracked, ids = ctx["base"], ctx["tracked"], ctx["task_ids"]
    basenames = {p.rsplit("/", 1)[-1] for p in tracked}
    creates = {t["id"]: set(t["creates"]) for t in tasks}
    all_files = set()
    for t in tasks:
        all_files |= set(t["creates"]) | set(t["modifies"]) | set(t["reads"])
    exclude = ctx.get("exclude", ())
    vocab = _report_field_vocab()
    lines = []
    if vocab is None:
        lines.append("ADVISORY referent: report-format.md vocabulary unavailable — "
                     "field referents not checked")
    for t in tasks:
        own = set(t["creates"]) | set(t["modifies"]) | set(t["reads"])
        dep_creates = set()
        for d in t["depends_on"]:
            dep_creates |= creates.get(d, set())
        seen = set()
        for line in _referent_scan_lines(t):
            for tok in PATH_RE.findall(line):
                tok = tok.strip()
                p = _path_referent(tok)
                if p is not None:
                    if p in seen:
                        continue
                    seen.add(p)
                    resolved = (
                        p in tracked or p in own or p in dep_creates
                        or ("/" not in p and (p in basenames
                                              or any(f.endswith("/" + p) for f in all_files)))
                        or _git_literal_in_code(base, p, exclude))
                    if not resolved:
                        lines.append("ADVISORY referent: Task %s names `%s` — not at BASE, "
                                     "not in Task %s's Files, not Created by a task it "
                                     "Depends-on" % (t["id"], p, t["id"]))
                    continue
                if vocab is not None and _FIELD_RE.match(tok):
                    if tok in seen:
                        continue
                    seen.add(tok)
                    segs = [s.replace("[]", "") for s in tok.split(".")[1:]]
                    missing = [s for s in segs
                               if s not in vocab and not _git_word_files(base, s, exclude)]
                    if missing:
                        lines.append("ADVISORY referent: Task %s names `%s` — `%s` is not a "
                                     "report-format.md field and appears in no code file "
                                     "at BASE" % (t["id"], tok, missing[0]))
        for m in _TASK_REF_RE.finditer(t["prose"]):
            ref = m.group(1)
            key = "Task " + ref
            if ref in ids or key in seen:
                continue
            seen.add(key)
            lines.append("ADVISORY referent: Task %s names Task %s — no such task heading "
                         "in this plan" % (t["id"], ref))
    return lines


ADVISORY_RENDERS.append(("referent", _render_referents))


# P3 — unverifiable from a sandbox (#458). Documents whose correctness is
# established by a human running commands against live infrastructure, not by
# any check in this repo. A task that writes one makes claims no sandbox can
# verify — run-30 drew three `deferred:*` acks that were guaranteed by its
# plan's shape before the run started. Extend this tuple when another such
# record appears; it is deliberately a short explicit list rather than a
# heuristic, because a heuristic here would flag ordinary docs.
HAND_EXECUTED_RECORDS = (
    "fleet/RUNBOOK.md",
    "fleet/tests/PROBES.md",
)


def _render_unverifiable(tasks, ctx):
    lines = []
    for t in tasks:
        # writes only: reading a hand-executed record asserts nothing about the
        # live infrastructure it records.
        hits = sorted((set(t["creates"]) | set(t["modifies"]))
                      .intersection(HAND_EXECUTED_RECORDS))
        if not hits:
            continue
        lines.append("ADVISORY unverifiable-from-sandbox: Task %s edits %s — a "
                     "hand-executed record. No reviewer can check its claims from "
                     "a sandbox; carry the evidence (commands and their output) in "
                     "the task body so review can check correspondence instead of "
                     "truth." % (t["id"], ", ".join(hits)))
    return lines


ADVISORY_RENDERS.append(("unverifiable-from-sandbox", _render_unverifiable))


# P4 — process rules in `## Global Constraints` (#441). The engine forwards
# this section verbatim to every reviewer as its attention lens
# (`fleet/run-engine.mjs`'s globalConstraintsBlock), and a reviewer's only
# evidence is a diff — which cannot show the order in which its lines came to
# exist. A rule about HOW the work was produced therefore has no answer there,
# and honest reviewers escalate it: run-32 put "every test must have been
# observed to fail before its implementation exists" in this section and drew
# 25 `cannotVerify` entries plus the single `deferred:manual` ack that was the
# sole reason the run parked instead of auto-approving.
#
# ultraplan already carries the prose half ("State what must be true of the
# result… not the order it was produced in"); this is the machine half. Like
# HAND_EXECUTED_RECORDS it is a short explicit phrase list, never a heuristic —
# an ordinary result-claim ("every new module has a test") must not trip it.
PROCESS_RULE_PHRASES = (
    (re.compile(r"\bred[-\s]then[-\s]green\b", re.I), "red-then-green"),
    (re.compile(r"\bfailing tests?\s+(?:first|before)\b", re.I), "failing-test-first"),
    (re.compile(r"\b(?:writ\w+)\s+(?:the\s+|a\s+)?tests?\s+first\b", re.I), "tests-first"),
    (re.compile(r"\bobserved to fail\b", re.I), "observed-to-fail"),
    (re.compile(r"\bbefore\s+(?:its|the|any)\s+implementation\b", re.I), "before-implementation"),
    (re.compile(r"\btest[-\s]driven\b", re.I), "test-driven"),
    (re.compile(r"\bTDD\b", re.I), "tdd"),
    (re.compile(r"\bcommit\s+(?:cadence|order|sequence)\b", re.I), "commit-cadence"),
    (re.compile(r"\bin\s+(?:this|the following)\s+order\b", re.I), "explicit-ordering"),
)
PROCESS_RULE_CLIP = 90


def _bullet_text(s):
    """A bullet's sentence: list marker gone, wrapped lines collapsed to one
    space \u2014 what a reader hears when the bullet is read aloud."""
    return re.sub(r"^(?:[-*+]|\d+\.)\s+", "", " ".join(s.split()))


def _clip(s, n=PROCESS_RULE_CLIP):
    # A constraints section is a bullet list; quote the sentence, not its marker.
    s = _bullet_text(s)
    return s if len(s) <= n else s[:n - 1].rstrip() + "\u2026"


def _render_process_rules(tasks, ctx):
    body = parse_global_constraints(ctx["plan_path"].read_text())
    lines = []
    for raw in body.splitlines():
        text = raw.strip()
        if not text:
            continue
        for pattern, label in PROCESS_RULE_PHRASES:
            if pattern.search(text):
                lines.append(
                    'ADVISORY process-rule: `## Global Constraints` says "%s" '
                    "(%s) \u2014 a rule about how the work was produced, which no "
                    "reviewer can check against a diff. State the result here and "
                    "put the ordering in the task's own steps; left in this "
                    "section it becomes a cannotVerify entry per task and a "
                    "deferred:manual ack that parks the run."
                    % (_clip(text), label))
                break
    return lines


ADVISORY_RENDERS.append(("process-rule", _render_process_rules))


# P4b — the other half of the same section (#632). Where a process rule is a
# constraint NO reviewer can decide, this is one a COMMAND could have: "`x.mjs`
# is byte-identical to BASE", "`report.sh` prints `ready`". Left as prose it is
# still only the reviewer's attention lens, so it comes back as a per-task
# unverifiable finding and parks the run on an ack — while the same sentence
# written as a `- Check:` is run by the driver and decided before anyone reads
# a diff.
#
# Like PROCESS_RULE_PHRASES this is a short explicit list, never a heuristic: a
# bullet must name something a command could be handed (a backticked path or
# script) AND say something a command could decide about it. Either alone is an
# ordinary orienting sentence.
PROSE_CHECK_PHRASES = ("byte-identical", "unchanged from BASE", "is not edited",
                       "are not edited", "not changed", "prints ", "exits 0")
# A backticked span is a path when it carries a directory separator, or ends in
# one of these — a bare `validate_skill.py` names a script with no slash in it.
PROSE_CHECK_PATH_EXTS = (".py", ".mjs", ".sh", ".ts", ".js", ".md")
_BULLET_START = re.compile(r"^(?:[-*+]|\d+\.)\s+\S")


def _prose_bullets(body):
    """The section's bullets, each one sentence: a line starting no new `- ` is
    a continuation and joins the bullet above it. A wrapped bullet routinely
    carries its path on the first line and its phrase on the second, and
    matching line by line sees neither."""
    bullets, open_bullet = [], False
    for raw in body.splitlines():
        line = raw.strip()
        if not line:
            open_bullet = False
        elif _BULLET_START.match(line):
            bullets.append(_bullet_text(line))
            open_bullet = True
        elif open_bullet:
            bullets[-1] += " " + line
    return bullets


def _prose_check_paths(text):
    """The backticked paths and scripts a bullet names, document order."""
    out = []
    for span in PATH_RE.findall(text):
        span = span.strip()
        if "/" in span or span.endswith(PROSE_CHECK_PATH_EXTS):
            if span not in out:
                out.append(span)
    return out


def _render_prose_check(tasks, ctx):
    plan_text = ctx["plan_path"].read_text()
    # The section's own `- Check:` commands. A task's Proof `Run:` is NOT one of
    # these: it runs for that one task, while the bullet binds every task — so
    # the exclusion is by path named in a section Check:, which is exactly what
    # keeps a plan's prose gloss above its own Check: lines silent.
    checked = " ".join(c["cmd"] for c in parse_constraint_checks(plan_text))
    lines = []
    for text in _prose_bullets(parse_global_constraints(plan_text)):
        low = text.lower()
        if not any(p.lower() in low for p in PROSE_CHECK_PHRASES):
            continue
        paths = _prose_check_paths(text)
        if not paths or any(p in checked for p in paths):
            continue
        lines.append(
            'ADVISORY prose-check: `## Global Constraints` says "%s" — a '
            "command can decide this; write it as a Check: so the driver runs "
            "it, since a prose bullet is only the referee's lens and parks the "
            "run on an ack" % _clip(text))
    return lines


ADVISORY_RENDERS.append(("prose-check", _render_prose_check))


# P5 — the recurring rejection species (#616). The 2026-09-04 rejections kept
# turning on the same handful of shapes: a `;`-chained `Run:`, a `leg (e)`
# written in prose, a default the Machine pins and no leg asserts, an `every`
# checked as a count floor, a duration bound with no clock in sight. Each is a
# TEXT property of a claims-v1 task's own slots, so the compiler can name it
# before a reader is dispatched — and, like every render here, it only names it
# (#492/#496: advisories report, never refuse).
#
# Each species reads a `Run:` command, a Proof leg, or a Machine clause against
# the legs that CITE it. A task whose Machine line numbers no clause has no
# clauses to read against, so it is silent exactly as a legacy task is — the
# same empty-`machine_clauses` guard the citation grammar itself uses.
RUN_JOIN_ADVICE = ("the exit status is the last command's — join with && "
                   "or || exit 1")
RUN_CLIP = 80
# A back-reference by label: `parse_proof_legs` splits only at the NEXT expected
# label, so `leg (b)` inside leg (d) reads as prose — and the reader who renames
# a leg silently invalidates the sentence.
PROSE_LEG_RE = re.compile(r"\blegs?\s*\(([a-z])\)")
PROSE_LEG_ADVICE = ('the parser splits at the next expected label — write '
                    '"the previous leg"')
# `defaults to 4` with no citing leg naming `4`: the default is a number the
# Proof never reads back.
DEFAULT_LITERAL_RE = re.compile(r"\bdefaults?\s+to\s+`?([^\s,;.`]+)`?", re.I)
UNPINNED_DEFAULT_DETAIL = "no citing leg pins it"
# `every row` cited only by `at least 3 rows`: a floor is satisfied by a proper
# subset, so nothing in the Proof falsifies the universal. A leg that says
# `exactly`, or re-states the quantifier, or excludes the rest, does.
COUNT_UNIVERSAL_RE = re.compile(r"\b(every|each|all)\b", re.I)
COUNT_FLOOR_RE = re.compile(r"\bat least\b", re.I)
COUNT_CLOSED_RE = re.compile(r"\b(exactly|every|each|all|no other|none)\b", re.I)
COUNT_FLOOR_DETAIL = "a universal cited only by a count floor"
# `waits <= 90 s` cited by a leg that counts iterations: the bound is a wall
# time and no leg reads a wall clock.
DURATION_RE = re.compile(
    r"(≤|<=|within|under|at most|no more than)\s*\d+\s*"
    r"(ms|s|sec|seconds?|min|minutes?)\b", re.I)
CLOCK_RE = re.compile(
    r"(elapsed|wall|Date\.now|time\.|perf_counter|monotonic|clock)", re.I)
NO_CLOCK_DETAIL = "a duration bound with no wall-clock leg"
# `a VM older than 6 h is stale` cited only by a leg probing `7 h`: the bound is
# stated, but every leg lands on the near side of it, so nothing in the Proof
# reads where the bound actually sits. The FAR side of a lower-bounded shape is
# below it, of an upper-bounded shape above it. `no more than` is upper-bounded
# whole, so the shapes are tried longest-first and the lower-bounded `more than`
# inside it never wins; `>=` before `>`, `<=` before `<`, for the same reason.
LOWER_BOUND_SHAPES = ("over", "more than", "older than", "at least")
UPPER_BOUND_SHAPES = ("under", "less than", "younger than", "at most",
                      "no more than", "within")
LOWER_BOUND_SYMBOLS = (">=", ">")
UPPER_BOUND_SYMBOLS = ("<=", "<", "≤")
BOUND_RE = re.compile(
    r"(?:(?<![\w-])(?P<word>%s)(?![\w-])|(?P<sym>%s))"
    r"\s*(?P<num>\d+(?:\.\d+)?)(?:[ \t]*(?P<unit>[A-Za-z]+))?"
    % ("|".join(sorted(LOWER_BOUND_SHAPES + UPPER_BOUND_SHAPES,
                       key=len, reverse=True)),
       "|".join(re.escape(s) for s in sorted(
           LOWER_BOUND_SYMBOLS + UPPER_BOUND_SYMBOLS, key=len, reverse=True))),
    re.I)
# A number a leg carries, with the unit that rides on it — `7 h`, `199 bytes`,
# `3 times`, or a bare `4` inside a backticked `-n 4`.
LEG_NUMBER_RE = re.compile(r"(?<![\w.])(\d+(?:\.\d+)?)(?:[ \t]*([A-Za-z]+))?")
ONE_SIDED_DETAIL = "clause %s bounds at %s; its legs probe one side only"
# `the type is `github` or the name starts `gh-`` cited by a leg naming only
# `github`: the Proof argues one arm of the either/or and leaves the other
# unread. Both alternatives are backticked and the ` or ` sits between them.
DISJUNCT_RE = re.compile(r"`([^`]+)`[^`]*?(?<![\w-])or(?![\w-])[^`]*?`([^`]+)`")
DISJUNCT_DETAIL = "clause %s names `%s` or `%s`; the legs name only `%s`"
# The two integration-hostile shapes (#631). Since #604 the driver re-runs every
# merged task's `Run:` on the ADOPTED tree, where every sibling's changes have
# folded in — so both of these pass in the task's own clone and fail there,
# through no fault of the task.
#
# `test "$(pytest --collect-only -q | tail -1 | cut -d' ' -f1)" = 1461`: a suite
# total is wrong by construction once any sibling adds a test. The pin is only
# hostile when it counts the WHOLE suite — a collect-only naming a path counts
# that path, which siblings do not move, so the segment before the first `|` is
# read for a token that looks like one.
COLLECT_ONLY_RE = re.compile(r"--collect-only\b")
INTEGER_COMPARE_RE = re.compile(r"(?:(?<=\s)|^)(?:==?|-eq)\s+\d+(?!\S)")
SUITE_TOTAL_ADVICE = ("the driver re-runs this on the adopted tree, where "
                      "every sibling's tests have folded in — count a named "
                      "path, or assert a delta")
# `test ! -e tests/drainprobe`: a bare directory survives as a `__pycache__`
# long after the thing it held is gone. A last segment carrying a `.` is a file
# name, which does not come back on its own.
ABSENCE_RE = re.compile(r"(?:(?<=[;&|])|^)\s*test\s+!\s+-[ed]\s+(\S+)")
DIRECTORY_ABSENCE_ADVICE = ("a bare directory survives as a `__pycache__` on "
                            "the adopted tree — name the file whose absence "
                            "is the claim")
# The two WIDTH species (#582). These read the task's shape rather than its
# text: how many files it writes, how many clauses its contract carries. Both
# are named before a VM is spent on the task — eight is the low end of run-55's
# measured knee ("between 8 and 19 files"), so MORE than eight draws the line
# and eight itself is silent. `reads` (the Files block's `Test:` paths) is not
# a write and does not count.
WIDTH_THRESHOLD = 8
WIDE_FILES_ADVICE = ("run-55's 19-file task hit the worker wall clock while "
                     "its 3–8-file siblings finished; split along a Produces "
                     "symbol")
WIDE_CONTRACT_ADVICE = "one contract per task; split along a Produces symbol"
# The NARROW knee (#666, proposal 1: the advisory reads the paths, not only
# the count). Eight is the knee for app-path work; engine work knees lower.
# A task that rewrites `fleet/run-engine.mjs`, or more than one
# `fleet/tests/test_*.mjs` sim, is wide at FOUR — more than four draws the
# line and four itself is silent, the same strictness as `WIDTH_THRESHOLD`.
# A sim is a `startswith`/`endswith`, so a helpers module under the same
# directory without the `test_` prefix is not one. Every other task keeps the
# eight knee and its BASE line.
NARROW_WIDTH_THRESHOLD = 4
SIM_PATH_PREFIX = "fleet/tests/test_"
SIM_PATH_SUFFIX = ".mjs"
WIDE_FILES_ENGINE_ADVICE = ("wide at four because it writes "
                            "fleet/run-engine.mjs — run-10's eight-file "
                            "engine task took 24.7 min while its one- and "
                            "two-file siblings took 2–4; split along a "
                            "Produces symbol")
WIDE_FILES_SIMS_ADVICE = ("wide at four because it writes %d "
                          "fleet/tests/test_*.mjs sims — run-10's eight-file "
                          "engine task took 24.7 min while its one- and "
                          "two-file siblings took 2–4; split along a Produces "
                          "symbol")


# The ENGINE-SELF-CHANGE species (#461). Since 0.3.5 the engine a run executes
# is the `engine=` sha in the VM's assignment, cloned to
# `/home/exedev/engines/<sha>` before the run starts — so a patch to one of
# these files lands in the integration branch, never in the running process.
# A task that writes one therefore cannot observe its own change from its own
# run, and a Proof that claims a live-run behaviour for it is unfalsifiable
# until the NEXT run. Like HAND_EXECUTED_RECORDS this is a short explicit list
# plus one prefix, never a heuristic — `fleet/launch.mjs` and
# `fleet/tests/test_run_engine.mjs` are under `fleet/` and are not the engine.
ENGINE_PATHS = (
    "fleet/run-engine.mjs",
    "fleet/run-worker.mjs",
    "fleet/run-waves.mjs",
)
# Every role prompt shapes the workers the same way the engine does.
ENGINE_PATH_PREFIX = "fleet/roles/"
ENGINE_SELF_CHANGE_ADVICE = ("shapes the workers, and the run that builds it "
                             "runs the engine it started with — the behaviour "
                             "is first observed by the next run; prove it with "
                             "a sim, never a live-run claim")


# The one TREE-reading species (#656). A clause that replaces a literal some
# existing test already asserts is a strict-equality pin the implementer will
# break blind — unless that test is in some task's Files, where it folds. So
# the pinning file is named before a reader is dispatched.
BACKTICK_SPAN_RE = re.compile(r"`([^`\n]+)`")
# Below six characters a span is grep noise: `src/`, `'Ada'`, `M1.` match half
# the tree as substrings, and this species greps for a substring, not a word.
MIN_SPAN = 6
# Above this many tracked test files a span is the tree's vocabulary, not one
# sibling's strict-equality pin: measured on this repository, `runner: None`
# sits in 1 tracked test file, `deferred:external` in 3, `examEdited` in 5 and
# `fix-loop-exhausted` in 7 — each still named — while `PLAN OK` is in 25,
# `claims-v1` in 29 and `ALL TESTS PASSED` in 64, none of which a clause could
# replace without the implementer grepping anyway. Eight is the line the
# compiler already draws elsewhere for width.
PINNED_EVERYWHERE = 8
PINNED_ELSEWHERE_DETAIL = "%s is asserted in %s, which is in no task's Files"
# A test file by path or by basename: under a tests directory the repo keeps
# suites in, or named the way a runner discovers one.
TEST_DIR_PREFIXES = ("tests/", "fleet/tests/")


def _is_test_file(path):
    basename = path.rsplit("/", 1)[-1]
    return (path.startswith(TEST_DIR_PREFIXES)
            or basename.startswith("test_") or ".test." in basename)


def _clause_spans(clauses):
    """The backticked spans of `MIN_SPAN`+ characters across a task's Machine
    clauses, document order, deduped — one line per (task, span, path) means a
    span repeated across clauses is still one span.

    A span ending in `/` is dropped whatever its length: that is a directory
    prefix (`fleet/tests/`, `src/`), which every import line under it contains
    and no test pins."""
    spans, seen = [], set()
    for clause in clauses:
        for m in BACKTICK_SPAN_RE.finditer(clause["text"]):
            span = m.group(1)
            if len(span) < MIN_SPAN or span.endswith("/") or span in seen:
                continue
            seen.add(span)
            spans.append(span)
    return spans


def _declared_files(tasks):
    """Every path any task's Files block names — its `writes` (Create:/Modify:)
    and its `reads` (Test:). A pin inside one of these folds at merge time."""
    declared = set()
    for t in tasks:
        declared |= set(t.get("writes") or ()) | set(t.get("reads") or ())
    return declared


def _species_pinned_elsewhere(task_id, clauses, base, declared, exclude):
    lines = []
    for span in _clause_spans(clauses):
        pinning = [path for path in _git_substring_files(base, span, exclude)
                   if _is_test_file(path)]
        # Counted BEFORE the `declared` filter: a span the whole suite carries
        # is vocabulary whether or not one of its files happens to be owned.
        if len(pinning) > PINNED_EVERYWHERE:
            continue
        for path in pinning:
            if path not in declared:
                lines.append(_species_line(
                    "pinned-elsewhere", task_id,
                    PINNED_ELSEWHERE_DETAIL % (span, path)))
    return lines

def _clip_run(command, n=RUN_CLIP):
    """A command's first `n` characters, whitespace collapsed — the command,
    not its marker, so nothing is stripped off the front."""
    s = " ".join(command.split())
    return s if len(s) <= n else s[:n - 1].rstrip() + "…"


def _species_line(species, task_id, detail, leg=None):
    return ("ADVISORY proof-species: %s — task %s%s: %s"
            % (species, task_id, ", leg %s" % leg if leg else "", detail))


def _chains_on_semicolon(command):
    """True when `command` carries a `;` outside single and double quotes.

    A quoted `;` (`echo 'a; b'`, `python3 -c "print(1); print(2)"`) is an
    argument, not a chain, so the walk toggles on the unescaped quotes and only
    flags a `;` seen outside both. A backslash escapes the next character
    everywhere but inside single quotes, where shell treats it literally."""
    single = double = False
    i = 0
    while i < len(command):
        c = command[i]
        if c == "\\" and not single:
            i += 2
            continue
        if c == "'" and not double:
            single = not single
        elif c == '"' and not single:
            double = not double
        elif c == ";" and not single and not double:
            return True
        i += 1
    return False


def _citing_legs(legs, clause_id):
    return [leg for leg in legs if clause_id in leg["cites"]]


def _species_run_chained_semicolon(task_id, clauses, legs, runs):
    return [_species_line("run-chained-semicolon", task_id,
                          "%s — %s" % (_clip_run(cmd), RUN_JOIN_ADVICE))
            for cmd in runs if _chains_on_semicolon(cmd)]


def _species_leg_named_in_prose(task_id, clauses, legs, runs):
    lines = []
    for leg in legs:
        m = PROSE_LEG_RE.search(leg["text"])
        if m:
            lines.append(_species_line(
                "leg-named-in-prose", task_id,
                "`(%s)` — %s" % (m.group(1), PROSE_LEG_ADVICE),
                leg=leg["label"]))
    return lines


def _species_default_unpinned(task_id, clauses, legs, runs):
    lines = []
    for clause in clauses:
        m = DEFAULT_LITERAL_RE.search(clause["text"])
        cited = _citing_legs(legs, clause["id"])
        # An UNCITED clause is already a citation-grammar refusal; this species
        # is about a clause the Proof does argue, whose legs skip the literal.
        if m and cited and not any(m.group(1) in leg["text"] for leg in cited):
            lines.append(_species_line(
                "default-unpinned", task_id,
                "`%s` — %s" % (m.group(1), UNPINNED_DEFAULT_DETAIL)))
    return lines


def _species_universal_as_count_floor(task_id, clauses, legs, runs):
    lines = []
    for clause in clauses:
        cited = _citing_legs(legs, clause["id"])
        if not COUNT_UNIVERSAL_RE.search(clause["text"]) or not cited:
            continue
        if all(COUNT_FLOOR_RE.search(leg["text"])
               and not COUNT_CLOSED_RE.search(leg["text"]) for leg in cited):
            lines.append(_species_line("universal-as-count-floor", task_id,
                                       COUNT_FLOOR_DETAIL))
    return lines


def _species_duration_without_clock(task_id, clauses, legs, runs):
    lines = []
    for clause in clauses:
        cited = _citing_legs(legs, clause["id"])
        if not DURATION_RE.search(clause["text"]) or not cited:
            continue
        if not any(CLOCK_RE.search(leg["text"]) for leg in cited):
            lines.append(_species_line("duration-without-clock", task_id,
                                       NO_CLOCK_DETAIL))
    return lines


def _clause_bound(text):
    """The first numeric bound `text` states, as
    `(value, unit, verbatim, lower)` — or None when it states none.

    `verbatim` is the number with its unit exactly as the clause writes them
    (`6 h`, `10240 bytes`), which is what rides into the advisory line; `lower`
    is True for the shapes whose far side lies below the bound."""
    m = BOUND_RE.search(text)
    if not m:
        return None
    shape = (m.group("word") or m.group("sym")).lower()
    lower = shape in LOWER_BOUND_SHAPES or shape in LOWER_BOUND_SYMBOLS
    end = m.end("unit") if m.group("unit") else m.end("num")
    return (float(m.group("num")), (m.group("unit") or "").lower(),
            text[m.start("num"):end], lower)


def _leg_numbers(legs):
    """Every `(value, unit)` the legs carry, `[M…]` citations stripped first —
    a clause marker is the leg's bookkeeping, not a number it probes."""
    return [(float(m.group(1)), (m.group(2) or "").lower())
            for leg in legs
            for m in LEG_NUMBER_RE.finditer(LEG_CITE_RE.sub(" ", leg["text"]))]


def _species_threshold_one_sided(task_id, clauses, legs, runs):
    lines = []
    for clause in clauses:
        cited = _citing_legs(legs, clause["id"])
        bound = _clause_bound(clause["text"])
        if not bound or not cited:
            continue
        value, unit, verbatim, lower = bound
        # Only a number in the bound's own unit is comparable to it: a leg
        # counting `3 times` against a `90 s` bound probes neither side, and a
        # leg that merely restates `90 s` probes nothing — that shape belongs to
        # `default-unpinned` or `duration-without-clock`.
        probes = [v for v, u in _leg_numbers(cited) if u == unit and v != value]
        if probes and not any(v < value if lower else v > value for v in probes):
            lines.append(_species_line(
                "threshold-one-sided", task_id,
                ONE_SIDED_DETAIL % (clause["id"], verbatim)))
    return lines


def _species_disjunct_without_leg(task_id, clauses, legs, runs):
    lines = []
    for clause in clauses:
        cited = _citing_legs(legs, clause["id"])
        m = DISJUNCT_RE.search(clause["text"])
        if not m or not cited:
            continue
        spans = (m.group(1), m.group(2))
        named = [s for s in spans
                 if any(s in leg["text"] for leg in cited)]
        if len(named) == 1:
            lines.append(_species_line(
                "disjunct-without-leg", task_id,
                DISJUNCT_DETAIL % ((clause["id"],) + spans + (named[0],))))
    return lines


def _pins_suite_total(command):
    """True when `command` compares a whole-suite `--collect-only` count against
    a bare integer.

    The segment before the first `|` is the collect-only invocation itself; a
    token there containing `/` or ending in `.py` names a path, which scopes the
    count to something a sibling does not move."""
    if not COLLECT_ONLY_RE.search(command):
        return False
    if not INTEGER_COMPARE_RE.search(command):
        return False
    head = command.split("|", 1)[0]
    return not any("/" in tok or tok.endswith(".py") for tok in head.split())


def _bare_directory_absence(command):
    """The `test ! -e <path>` / `test ! -d <path>` paths whose last segment
    carries no `.` — a directory name, not a file name."""
    return [m.group(1) for m in ABSENCE_RE.finditer(command)
            if "." not in m.group(1).rstrip("/").rsplit("/", 1)[-1]]


def _species_suite_total_pin(task_id, clauses, legs, runs):
    return [_species_line("suite-total-pin", task_id,
                          "%s — %s" % (_clip_run(cmd), SUITE_TOTAL_ADVICE))
            for cmd in runs if _pins_suite_total(cmd)]


def _species_directory_absence_pin(task_id, clauses, legs, runs):
    return [_species_line("directory-absence-pin", task_id,
                          "%s — %s" % (_clip_run(cmd),
                                       DIRECTORY_ABSENCE_ADVICE))
            for cmd in runs if _bare_directory_absence(cmd)]


def _is_sim_path(path):
    """A sim under the fleet's test directory — `fleet/tests/test_<name>.mjs`.
    A helpers module beside it carries no `test_` prefix and is not one."""
    return (path.startswith(SIM_PATH_PREFIX)
            and path.endswith(SIM_PATH_SUFFIX))


def _species_wide_files(task, clauses):
    """A task that writes more than `WIDTH_THRESHOLD` files — `Create:` plus
    `Modify:`, never `Test:` — or more than `NARROW_WIDTH_THRESHOLD` when
    what it writes is the engine or more than one sim. One line per task: the
    engine reason wins when both hold."""
    writes = list(task["creates"]) + list(task["modifies"])
    n = len(writes)
    if n > NARROW_WIDTH_THRESHOLD:
        # `ENGINE_PATHS[0]` is `fleet/run-engine.mjs`; the other engine paths
        # and the role prompts keep the eight knee.
        if ENGINE_PATHS[0] in writes:
            reason = WIDE_FILES_ENGINE_ADVICE
        else:
            sims = sum(1 for p in writes if _is_sim_path(p))
            reason = WIDE_FILES_SIMS_ADVICE % sims if sims > 1 else None
        if reason is not None:
            return [_species_line("wide-files", task["id"],
                                  "%d Create/Modify entries, %s" % (n, reason))]
    if n <= WIDTH_THRESHOLD:
        return []
    return [_species_line("wide-files", task["id"],
                          "%d Create/Modify entries — %s"
                          % (n, WIDE_FILES_ADVICE))]


def _species_wide_contract(task, clauses):
    """A task whose Machine line numbers more than `WIDTH_THRESHOLD` clauses —
    more contract than one task's Proof can argue."""
    if len(clauses) <= WIDTH_THRESHOLD:
        return []
    return [_species_line("wide-contract", task["id"],
                          "%d Machine clauses — %s"
                          % (len(clauses), WIDE_CONTRACT_ADVICE))]


def _is_engine_path(path):
    return path in ENGINE_PATHS or path.startswith(ENGINE_PATH_PREFIX)


def _species_engine_self_change(task, clauses):
    """A task that writes an engine path or a role prompt — `Create:` plus
    `Modify:`, never `Test:`, since reading the engine changes no worker."""
    hits = sorted(p for p in set(task["creates"]) | set(task["modifies"])
                  if _is_engine_path(p))
    return [_species_line("engine-self-change", task["id"],
                          "%s %s" % (path, ENGINE_SELF_CHANGE_ADVICE))
            for path in hits]


# Species order inside a task; print order overall is task-major, so every line
# for a task prints before any line for the next.
PROOF_SPECIES = (
    _species_run_chained_semicolon,
    _species_leg_named_in_prose,
    _species_default_unpinned,
    _species_universal_as_count_floor,
    _species_duration_without_clock,
    _species_threshold_one_sided,
    _species_disjunct_without_leg,
    _species_suite_total_pin,
    _species_directory_absence_pin,
)

# The width species read the whole task, not its clauses, legs and runs — same
# line shape, same task-major order, their own signature.
PROOF_WIDTH_SPECIES = (
    _species_wide_files,
    _species_wide_contract,
)

# The FILES species read a task's declared paths rather than its width or its
# text — same `(task, clauses)` signature, same line shape, walked from the
# same loop, so registration here inherits the render's claims-v1 guard.
PROOF_FILES_SPECIES = (
    _species_engine_self_change,
)


def _render_proof_species(tasks, ctx):
    # `pinned-elsewhere` is the one species that reads the TREE rather than the
    # task's own text, so it takes the checkout and the plan-wide declared set
    # instead of PROOF_SPECIES' (clauses, legs, runs) — both computed once, then
    # run last within each task so print order stays task-major.
    base = ctx["base"]
    declared = _declared_files(tasks)
    exclude = ctx["exclude"]
    lines = []
    for t in tasks:
        claims = t.get("claims") or {}
        clauses = claims.get("machine_clauses") or []
        if not clauses:
            continue
        legs = claims.get("proof_legs") or []
        runs = claims.get("proof_runs") or []
        for species in PROOF_SPECIES:
            lines.extend(species(t["id"], clauses, legs, runs))
        for species in PROOF_WIDTH_SPECIES + PROOF_FILES_SPECIES:
            lines.extend(species(t, clauses))
        lines.extend(_species_pinned_elsewhere(t["id"], clauses, base,
                                               declared, exclude))
    return lines


ADVISORY_RENDERS.append(("proof-species", _render_proof_species))


# P6 — a `Check:` that runs a sim is a per-task cost (#657). A `- Check:` bullet
# under `## Global Constraints` is run by the driver in EVERY task's clone on
# every pass, so a check that runs a test suite is paid W times over on a wave
# of width W — while the same command as the owning task's `Run:` is paid once.
# The compiler can name that cost before a reader is dispatched.
#
# Its own render, not a `proof-species` line: the species line shape names a
# task, and a `Check:` belongs to none. For the same reason it belongs to no
# grammar — a legacy-grammar plan's section is read exactly as a claims-v1
# plan's is. A `(minor)` check is never dispatched, so it costs nothing.
CHECK_COST_ADVICE = ("paid by every task on every pass; if one task owns what "
                     "it tests, make it that task's Run:")


def _names_test_path(command):
    """True when some token of `command` names a path under `tests/` or
    `fleet/tests/` — a token beginning `tests/` or `fleet/tests/`, or one
    carrying `/tests/` anywhere (`packages/x/tests/y.mjs`)."""
    return any(tok.startswith(("tests/", "fleet/tests/")) or "/tests/" in tok
               for tok in command.split())


def _render_check_cost(tasks, ctx):
    return ["ADVISORY check-cost: %s — %s"
            % (_clip_run(check["cmd"]), CHECK_COST_ADVICE)
            for check in parse_constraint_checks(ctx["plan_path"].read_text())
            if not check["minor"] and _names_test_path(check["cmd"])]


ADVISORY_RENDERS.append(("check-cost", _render_check_cost))


# P7 — a leg that diffs or shows a BASE sha guards for the sha's absence, or it
# is not a leg (#572 item 1). The driver hands a task a depth-1 clone, which
# holds exactly one commit: `git diff d6efce4 -- fleet/x.mjs` there does not
# report "no change", it dies "bad object". A leg written that way passes
# nowhere and fails nowhere; it reads as verified and proves nothing. The fix
# is in the same command — `git cat-file -e <sha>^{commit} && …` or
# `git rev-parse --verify <sha> && …` — so the leg is skipped, not silently
# lost, when BASE is out of reach.
#
# Its own render, not a `proof-species` line, for the same reason `check-cost`
# is: a `Check:` belongs to no task and the species line shape names one. So a
# `Check:` is read here under any grammar, exactly as a claims-v1 `Run:` is.
SHA_UNGUARDED_ADVICE = ("%s reaches for BASE, which a depth-1 clone does not "
                        "hold; guard it in the same command with git cat-file "
                        "-e <sha>^{commit} or git rev-parse --verify, and skip "
                        "the leg when the guard fails")

# The verb, then any run of whitespace-separated flag tokens (`--name-only`,
# `-1`, `--format=%H`, a bare `--`), then the operand. Only the four verbs that
# resolve a revision are read: `git hash-object`'s sha is an OUTPUT, not a
# lookup, so `test "$(git hash-object x)" = <40 hex>` is silent.
SHA_VERB_OPERAND_RE = re.compile(
    r"\bgit\s+(?:diff|show|log|cat-file)\b(?:\s+-\S*)*\s+(?!-)(\S+)")
# The three operand shapes: a bare short-or-full sha, a `<sha>:<path>` reach
# and a `HEAD:<path>` reach. 6 hex is not a sha and 41 hex is not one either,
# so both bounds are closed.
SHA_OPERAND_RES = (re.compile(r"[0-9a-f]{7,40}\Z"),
                   re.compile(r"[0-9a-f]{7,40}:"),
                   re.compile(r"HEAD:"))
# Tested BEFORE the verb, because the guard itself carries the verb `cat-file`
# and would otherwise flag itself.
SHA_GUARDS = ("git cat-file -e", "git rev-parse --verify")


def _unguarded_sha_operand(command):
    """The first sha-shaped operand `command` reaches for unguarded, or None.

    None when the command carries either guard anywhere in it — a
    `git cat-file -e d6efce4^{commit} && git diff … d6efce4 …` command is one
    command, and the guard covers the whole of it."""
    if any(guard in command for guard in SHA_GUARDS):
        return None
    for m in SHA_VERB_OPERAND_RE.finditer(command):
        operand = m.group(1)
        if any(shape.match(operand) for shape in SHA_OPERAND_RES):
            return operand
    return None


def _sha_unguarded_line(subject, command, operand):
    return ("ADVISORY sha-unguarded: %s%s — %s"
            % (subject, _clip_run(command), SHA_UNGUARDED_ADVICE % operand))


def _render_sha_unguarded(tasks, ctx):
    # Task order first, then section order — the Run: lines of every task
    # before the first Check: line, as the two subjects are read in two passes.
    lines = []
    for t in tasks:
        for cmd in (t.get("claims") or {}).get("proof_runs") or []:
            operand = _unguarded_sha_operand(cmd)
            if operand:
                lines.append(_sha_unguarded_line(
                    "task %s Run: " % t["id"], cmd, operand))
    for check in parse_constraint_checks(ctx["plan_path"].read_text()):
        if check["minor"]:
            continue
        operand = _unguarded_sha_operand(check["cmd"])
        if operand:
            lines.append(_sha_unguarded_line("Check: ", check["cmd"], operand))
    return lines


ADVISORY_RENDERS.append(("sha-unguarded", _render_sha_unguarded))


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
                         "(waves/wavesPath/edges/acceptance/waveLabels/"
                         "globalConstraints/planPath) to PATH; the orchestrator "
                         "adds only per-task tier/review/testCmd and run knobs. "
                         "Requires --emit-launch.")
    ap.add_argument("--check", action="store_true",
                    help="authoring-time grammar validation only (#85): print "
                         "every violation with a did-you-mean fix and exit 2, "
                         "or print 'PLAN OK' and exit 0 — never emits waves. "
                         "Mutually exclusive with "
                         "--emit-launch/--emit-args/--run-dir.")
    ap.add_argument("--overlap", choices=OVERLAP_MODES, default=OVERLAP_DEFAULT,
                    help="how two tasks whose declared paths overlap are "
                         "scheduled: 'fold' (the default) does not order them "
                         "at all — they share a wave and the kernel folds "
                         "their same-file edits at merge time; 'serialize' is "
                         "the rollback knob, re-adding the document-order "
                         "write-after-write edge and nothing else. Every "
                         "other edge label is identical in both modes.")
    ap.add_argument("--run-dir", type=Path, default=None, dest="run_dir",
                    help="absolute per-run directory; stamped into the args "
                         "skeleton as runDir (with pluginRoot) so the engine "
                         "routes all scratch there")
    ap.add_argument("--renders", action="store_true",
                    help="with --check only (#345): after the verdict, print "
                         "the ADVISORY renders (Produces blast-radius, "
                         "referent-existence). Advisory: never changes the exit "
                         "code; prints nothing when there is nothing to say.")
    ap.add_argument("--base", type=Path, default=None,
                    help="the tree file-level questions resolve against, given "
                         "as <checkout-dir> — a checkout directory, never a "
                         "commit sha. It "
                         "is the tree the claims-v1 non-text same-file "
                         "classifier reads — on a plain compile, where it "
                         "orders the pair, and under --check, where the "
                         "advisory names the order the compile would impose. "
                         "With --check it requires --renders and is also what "
                         "the renders resolve against (default: the git "
                         "toplevel of the plan's directory). Unset, a "
                         "claims-v1 same-file pair is left unordered and draws "
                         "a not-classifiable advisory instead.")
    ap.add_argument("--exclude", action="append", default=[], metavar="PATH",
                    help="with --renders only, repeatable: a BASE-relative "
                         "tracked path the renders must not see (the eval "
                         "campaign's seam for keeping its own files out of "
                         "its measurement)")
    args = ap.parse_args(argv)
    emit_launch = args.emit_launch
    emit_args = args.emit_args
    if args.check and (emit_launch is not None or emit_args is not None
                       or args.run_dir is not None):
        sys.exit("error: --check is mutually exclusive with --emit-launch/"
                 "--emit-args/--run-dir (--check only validates grammar; it "
                 "never emits launch files)")
    if args.renders and not args.check:
        sys.exit("error: --renders requires --check (renders are the check's "
                 "advisory tail; plain compile never prints them)")
    # --base is the check's render tree AND the plain compile's claims-v1
    # non-text classifier root; inside --check it still requires --renders,
    # which is the only thing that reads it there.
    if args.base is not None and args.check and not args.renders:
        sys.exit("error: --base requires --renders")
    if args.exclude and not args.renders:
        sys.exit("error: --exclude requires --renders")
    if args.check:
        violations = collect_violations(args.plan)
        if violations:
            print("\n\n".join(violations))
            print()
            print(f"{len(violations)} violation(s)")
            rc = 2
        else:
            print("PLAN OK")
            rc = 0
        # Advisory tail: after the frozen verdict, separated by one blank line,
        # ONLY when there is something to say. rc is untouched by either half.
        # The claims-v1 `ADVISORY grammar:` lines ride unconditionally (they
        # are the grammar's own channel and empty for every legacy plan); the
        # #345 renders ride behind --renders.
        lines = collect_advisories(args.plan, args.base)
        if args.renders:
            lines = lines + render_advisories(args.plan,
                                              args.base if args.base is not None
                                              else default_base(args.plan),
                                              exclude=tuple(args.exclude))
        if lines:
            print()
            print("\n".join(lines))
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

    grammar = plan_grammar(plan_text)
    plan_claim = parse_plan_claim(plan_text)
    tasks = [parse_task(t, grammar=grammar, plan_claim=plan_claim)
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
    # inert and must neither block compile nor warn. The exemption itself keys
    # on the EXPLICIT marker, not on the stamped (possibly heuristic)
    # disposition — see _files_grammar_exempt.
    for t in tasks:
        disp, heuristic = classify(t)
        t["disposition"], t["heuristic"] = disp, heuristic

    # claims-v1 body grammar (spec 2026-08-31 §4): a slot-shape, Steps,
    # refused-marker, fence, provenance, Stale-if or Proof-disjointness fault
    # is a loud compile error, raised BEFORE edge building for the same reason
    # the Files gate is — a body the compiler cannot read is a body whose
    # ordering it must not guess at. Empty for every legacy plan.
    grammar_violations = [v for t in tasks for v in t.get("grammar_violations", [])]
    if grammar == CLAIMS_GRAMMAR:
        grammar_violations = (plan_claim_violations(plan_text)
                              + grammar_violations
                              + gate_verdict_violations(args.plan, tasks))
    # Plan-level and grammar-independent: a `- Check:` command belongs to no
    # task, and the shell that would run it does not care which grammar the
    # plan declares.
    grammar_violations = (grammar_violations
                          + constraint_check_violations(plan_text)
                          + exam_command_violations(plan_text)
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

    # A **Commutes:** path outside the task's own Files: block (spec §2b) is a
    # rendered marker conflict, never a compile error — one entry per
    # offending path, since a task may declare several.
    type_conflicts.extend(
        {"task": t["id"], "edge": "", "note": note}
        for t in tasks for note in t.get("commutes_conflicts", []))

    acceptance = parse_acceptance(plan_text)
    global_constraints = parse_global_constraints(plan_text)
    # The other kind of constraint: commands, not sentences. They ride beside
    # `globalConstraints` in all three payloads — the driver runs them, and
    # `fleet/run-main.mjs` spreads the args file into the engine's `args`, so
    # nothing else upstream has to learn the key.
    constraint_checks = parse_constraint_checks(plan_text)
    marked = any(not t.get("heuristic") for t in out_tasks)
    if acceptance["mode"] == "missing" and marked:
        sys.exit("error: " + ACCEPTANCE_MISSING_ERROR)
    if acceptance["mode"] == "missing":
        type_conflicts.append({"task": "", "edge": "",
                               "note": "acceptance: missing (unmarked plan — warning only)"})
    # 0-markers: no task carries a trusted **Type:**/**Depends-on:** marker, so
    # EVERY disposition was guessed. Surface it loudly (and expose `allHeuristic`
    # on the result) so the Step-3 render can flag a heuristic-only wave plan.
    if not marked:
        type_conflicts.append({"task": "", "edge": "",
            "kind": "all-heuristic",
            "note": "0 markers — all dispositions inferred; the wave plan is "
                    "heuristic-only"})

    impl = [t for t in tasks if t["disposition"] == "implementation"]
    if not impl:
        # Bug D: a gates/release/manual-only plan compiles to waves: [] —
        # waves.js refuses empty waves, so warn loudly while still emitting
        # the JSON (exit 0): the runbook and gates remain meaningful.
        print("compile_plan: no implementation tasks — nothing to wave "
              "(plan is gates/release/manual only); the runbook and gates "
              "still apply.", file=sys.stderr)
    edges, conflicts = build_edges(impl, overlap_mode=args.overlap,
                                   grammar=grammar, tree_root=args.base)
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
          # what it only reads/runs); commutes is the task's own validated
          # **Commutes:** declaration, [] when undeclared.
          "writes": by_id[tid].get("writes", []),
          "commutes": by_id[tid].get("commutes", []),
          # Task-scoped exam (#515, #553): the Proof `Test:` paths themselves,
          # in Proof order ([] for a legacy-grammar body), and the command the
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
          # that names none (and for every legacy-grammar body). The driver
          # executes these in the task's clone; no model ever runs one, and
          # they are additive to testCmd, which still derives from `Test:`
          # paths alone.
          "proofRuns": list(
              (by_id[tid].get("claims") or {}).get("proof_runs", []))}
         for tid in wave]
        for wave in waves]

    # One deterministic label per wave (same order as waves/launch_waves). The
    # orchestrator threads these into args.waveLabels; the viewer reads them too.
    wave_labels = [derive_wave_label(wave) for wave in launch_waves]

    result = {
        "tasks": out_tasks,
        "dag_edges": edges,
        "marker_conflicts": marker_conflicts,
        "gates": [t["id"] for t in tasks if t["disposition"] == "gate"],
        "post_merge_runbook": [t["id"] for t in tasks
                               if t["disposition"] in ("release", "manual")],
        "waves": waves,
        "launch_waves": launch_waves,
        "waveLabels": wave_labels,
        "mode": mode,
        "degrade_reason": degrade,
        "allHeuristic": not marked,
        "acceptance": acceptance,
        "globalConstraints": global_constraints,
        "constraintChecks": constraint_checks,
    }

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
                       "commutes": by_id[tid].get("commutes", [])}
                      for wave in waves for tid in wave],
            "waves": waves,
            "waveLabels": wave_labels,
            "edges": [[e["from"], e["to"]] for e in edges],
            "acceptance": acceptance,
            "globalConstraints": global_constraints,
            "constraintChecks": constraint_checks,
        }
        emit_launch.parent.mkdir(parents=True, exist_ok=True)
        emit_launch.write_text(json.dumps(launch_payload, indent=2))
        result["launch_file"] = str(emit_launch)

    if emit_args is not None:
        # The complete launch-args skeleton: everything deterministic rides
        # from here so the orchestrator never hand-assembles edges/acceptance
        # (forgetting args.edges silently disabled dependency blocking).
        args_payload = {
            "waves": launch_waves,
            "wavesPath": str(emit_launch.resolve()),
            "edges": [[e["from"], e["to"]] for e in edges],
            "dependencyEdges": [f"{e['from']} -> {e['to']} ({e['why']})"
                                for e in edges],
            "acceptance": acceptance,
            "waveLabels": wave_labels,
            "globalConstraints": global_constraints,
            "constraintChecks": constraint_checks,
            "planPath": str(args.plan.resolve()),
            # The plan's ONE operator sentence (#552), or null when the header
            # carries none — every other key is unchanged.
            "planClaim": plan_claim,
        }
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
