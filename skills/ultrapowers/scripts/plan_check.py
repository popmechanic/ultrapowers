#!/usr/bin/env python3
"""The laptop's check of a claims-v1 plan, on the sandbox's own parser.

    plan_check.py [--base <sha|checkout-dir>] <plan.md>

`plan_parse.py` reads the grammar — the same file the sandbox runs, so there
is no second reader to drift from it. This file asks only what a parser
cannot: whether the records beside the plan are in order, and what the tree
the plan launches on says about it. It prints `PLAN OK` and exits 0, or every
violation, a count, and exits 2.

What refuses:
  * the gate-verdict record `<stem>.gate-verdicts.json` — missing, unreadable,
    an entry missing, stale against the live `sha256(claim NUL proof)`, or
    `fail`;
  * that record's `authoring` object, when it carries one and it is malformed;
  * a `- Check:` or Proof `Run:` command carrying a backtick, and a `Check:`
    naming a path one implementation task's Files own;
  * a `- Check:` that freezes a `git diff … $ULTRA_BASE -- <pathspecs>` whose
    pathspec covers any task's `Create:`, `Modify:` or `Delete:` path (run-199);
  * a `- Test:` or `- Guard:` bullet under a task's Files or Proof, and an
    `**Exam command:**` header line — cut three (2026-09-22) retired the
    examiner these fed; the parser reads none of them any more, and this is
    the one reader left to say so;
  * with `--base`: a Stale-if predicate that already holds at BASE, and a
    `--base` that is neither a checkout directory nor a 40-hex sha.

What is printed after the verdict, with `--base` only, and refuses nothing:
`BASE fact:` (what a deleted file holds; which files outside a task's Files
carry a literal its Machine clauses pin), `STALE fact: … unreadable at BASE`,
`GREEN-AT-BASE fact:` (the plan's `Run:` lines rehearsed in a throwaway
worktree at BASE — behind a `PLAN OK` only), and `AUTHORING fact:`.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import plan_parse  # noqa: E402
from plan_parse import machine_restatement  # noqa: E402

PATH_RE = re.compile(r"`([^`]+)`")
EXT_RE = re.compile(r"\.([A-Za-z0-9]{1,8})$")


# --------------------------------------------------------------------------- #
# The gate-verdict record                                                      #
# --------------------------------------------------------------------------- #
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
    """Every gate-verdict refusal a plan earns, `grammar:`-namespaced.

    Keyed on the LIVE hash of each task's (Claim, Proof) pair, so an edited
    claim or proof goes stale and re-dispatches rather than riding an old
    verdict."""
    path = verdicts_path(plan_path)
    if not path.exists():
        return ["grammar: gate verdicts missing — expected `%s` beside the "
                "plan; the proof gate's verdict is an artifact, not a memory "
                "(spec §4.5). Run the gate and commit its record."
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
        entry = entries.get(t["id"])
        if not isinstance(entry, dict):
            violations.append(
                "grammar: gate verdict missing for task %s — `%s` carries no "
                "entry for it; every task is dispatched to the gate."
                % (t["id"], path.name))
            continue
        live = gate_input_hash(t["claim"], t["proof"])
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
# A top-level `authoring` object in the verdict record, written by the
# authoring skill and only READ here. A malformed one is a refusal; a record
# with no `authoring` key is read exactly as it was before the key existed.
AUTHORING_KEY = "authoring"
AUTHORING_BRANCHES = ("risk", "width", "inline", "subagent")
AUTHORING_LANES = ("ultrapowers", "subagent", "inline")
_AUTHORING_BAD = "grammar: authoring record unreadable — "


def _record(plan_path):
    """The verdict record as a dict — `{}` when absent or unreadable, which is
    `gate_verdict_violations`'s refusal to make, once."""
    try:
        record = json.loads(verdicts_path(plan_path).read_text())
    except (OSError, ValueError):
        return {}
    return record if isinstance(record, dict) else {}


def _nonneg_int(value):
    """A JSON non-negative integer. `True` is an `int` in Python and is not
    one of these; `"12"` is a string the record's writer did not convert."""
    return (isinstance(value, int) and not isinstance(value, bool)
            and value >= 0)


def picks(question):
    """A question's picks as a list: `picked` is one option, or — for a
    multi-select question (#1189) — a list of them. One row is one question
    either way."""
    picked = question.get("picked")
    return picked if isinstance(picked, list) else [picked]


def authoring_record_violations(plan_path):
    """Every refusal the `authoring` object earns, one line per offending
    field. A question whose option list is unusable says nothing further.
    A question row's `explain_rounds` may be absent; when present it must be
    a non-negative integer."""
    auth = _record(plan_path).get(AUTHORING_KEY)
    if auth is None:
        return []
    name = verdicts_path(plan_path).name
    out = []

    def bad(field, detail):
        out.append("%s`%s`: %s: %s" % (_AUTHORING_BAD, name, field, detail))

    if not isinstance(auth, dict):
        bad("authoring", "must be an object, got %s" % type(auth).__name__)
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
        if not picks(q) or any(p not in options for p in picks(q)):
            bad(where + ".picked", "must be one of %r, or a list of them, "
                "got %r" % (options, q.get("picked")))
        recommended = q.get("recommended")
        if recommended is not None and recommended not in options:
            bad(where + ".recommended", "must be null or one of %r, got %r"
                % (options, recommended))
        explain_rounds = q.get("explain_rounds")
        if explain_rounds is not None and not _nonneg_int(explain_rounds):
            bad(where + ".explain_rounds",
                "must be a non-negative integer or absent, got %r"
                % (explain_rounds,))
    return out


def authoring_fact_line(plan_path):
    """The `AUTHORING fact:` line(s): `none recorded` only for a record with
    no `authoring` key; one `refused — <key>: <rule>` line per violation for a
    malformed one (#1029), so it is never read as an absent one. A
    well-formed record's line ends with the question and pick-rate counts and
    the sum of every row's `explain_rounds` (absent reads 0)."""
    record = _record(plan_path)
    auth = record.get(AUTHORING_KEY)
    if auth is None:
        return "AUTHORING fact: none recorded"
    violations = authoring_record_violations(plan_path)
    if violations:
        head = "%s`%s`: " % (_AUTHORING_BAD, verdicts_path(plan_path).name)
        return "\n".join("AUTHORING fact: refused — " + v[len(head):]
                         for v in violations)
    tally = record.get("tally") if isinstance(record.get("tally"), dict) else {}
    questions = auth.get("questions", [])
    with_rec = [q for q in questions if q.get("recommended") is not None]
    picked = [q for q in with_rec if q.get("recommended") in picks(q)]
    explain_rounds = sum(q.get("explain_rounds", 0) for q in questions)
    # `-` reads as "the record does not say" — distinct from a recorded 0.
    return ("AUTHORING fact: %s min to PLAN OK, %s hub probes, "
            "%s gate dispatches, %s rejected, routing %s->%s, "
            "%d questions, %d/%d recommended picked, %d explain rounds"
            % (auth["minutes"], auth["probes"], tally.get("dispatched", "-"),
               tally.get("rejected", "-"), auth["routing"]["branch"],
               auth["routing"]["lane"], len(questions), len(picked),
               len(with_rec), explain_rounds))


# --------------------------------------------------------------------------- #
# The run-wide `- Check:` commands                                             #
# --------------------------------------------------------------------------- #
def command_names_path(command, path):
    """True when `command` names `path` as a WHOLE token. The boundary class
    is the path alphabet itself, so `a.mjs.bak` does not name `a.mjs`, while a
    path inside quotes, a pipeline or a `$(...)` does."""
    if not path:
        return False
    return re.search(r"(?<![\w./-])" + re.escape(path) + r"(?![\w./-])",
                     command) is not None


def task_files(t):
    """Every path a task's Files block claims: `Create:`, `Modify:` and
    `Delete:` paths."""
    return set(t["creates"]) | set(t["modifies"]) | set(t["deletes"])


def _is_implementation(t):
    return t["type"] is None or t["type"] == "implementation"


def command_violations(checks, tasks):
    """The engine runs a `Check:` and a Proof `Run:` through a shell, which
    reads a backtick as a command substitution (run-74) — one wording, two
    callers; and a `Check:` naming a path ONE implementation task's Files own
    is that task's `Run:` wearing a run-wide coat — red for every other task
    until that one lands (#978)."""
    commands = ([("Check", "", c["cmd"]) for c in checks]
                + [("Run", "task %s: " % t["id"], cmd)
                   for t in tasks for cmd in t["proofRuns"]])
    violations = [
        "grammar: %s: command carries a backtick — %s%s; the driver's shell "
        "reads it as a command substitution (run-74)" % (kind, where, cmd[:80])
        for kind, where, cmd in commands if "`" in cmd]
    for check in checks:
        for t in tasks:
            if not _is_implementation(t):
                continue
            for path in sorted(task_files(t)):
                if command_names_path(check["cmd"], path):
                    violations.append(
                        "grammar: task %s: run-wide `- Check: %s` names `%s`, "
                        "a path task %s's Files own — a check one task would "
                        "turn green is not run-wide; move it to that task's "
                        "Proof as a `Run:`."
                        % (t["id"], check["cmd"], path, t["id"]))
    return violations


_SHELL_OPERATORS = ("&&", "||", "|", ";")


def freeze_violations(checks, tasks):
    """A `- Check:` that freezes a `git diff … $ULTRA_BASE -- <pathspecs>` is
    green at BASE by construction — it goes red the moment a task's own patch
    lands under the frozen path (run-199). Reads only the strings the parser
    printed: no worktree, no git, no subprocess."""
    violations = []
    for check in checks:
        cmd = check["cmd"]
        idx_diff = cmd.find("git diff")
        if idx_diff == -1:
            continue
        idx_base = cmd.find("$ULTRA_BASE", idx_diff)
        if idx_base == -1:
            continue
        idx_sep = cmd.find(" -- ", idx_base)
        if idx_sep == -1:
            continue
        rest = cmd[idx_sep + len(" -- "):]
        pathspecs = []
        for tok in rest.split():
            if tok in _SHELL_OPERATORS:
                break
            raw = tok
            if len(raw) >= 2 and raw[0] == raw[-1] and raw[0] in "\"'":
                raw = raw[1:-1]
            normalized = raw[:-1] if len(raw) > 1 and raw.endswith("/") else raw
            pathspecs.append((raw, normalized))
        for raw, normalized in pathspecs:
            for t in tasks:
                for path in sorted(task_files(t)):
                    if path == normalized or path.startswith(normalized + "/"):
                        violations.append(
                            "grammar: task %s: run-wide `- Check: %s` freezes "
                            "`%s`, which covers `%s`, a path task %s's Files "
                            "own — the check goes red the moment that task's "
                            "own patch lands (run-199); freeze files, not the "
                            "directory they sit in."
                            % (t["id"], cmd, raw, path, t["id"]))
    return violations


# --------------------------------------------------------------------------- #
# Retired slots (cut three, 2026-09-22): a `- Test:` or `- Guard:` bullet,     #
# or an `**Exam command:**` header line                                       #
# --------------------------------------------------------------------------- #
_RETIRED_TEST_BULLET_RE = re.compile(r'^-\s*Test\s*:', re.I)
_RETIRED_GUARD_BULLET_RE = re.compile(r'^-\s*Guard\s*:', re.I)
_EXAM_CMD_HEADER_RE = re.compile(r'^\*\*Exam command:\*\*', re.I)
_RETIRED_SUFFIX = ("a plan's proof is its Run: probes; a test file is not "
                   "written for a task since cut three (2026-09-22)")


def _unfenced_lines(text):
    """`text`'s own lines, fence-tracked the same way `plan_parse.py` tracks
    them -- a fence's content is never read as structure, here either."""
    return [line for line, fenced in plan_parse._fence_aware_lines(text)
            if not fenced]


def _pre_slot_lines(body):
    """The unfenced lines of a task body before its first named slot label
    (`**Claim:**`, `**Proof:**`, ...) -- the same span the parser's own
    Files-bullet scan reads, heading line included (it matches no bullet
    shape anyway)."""
    out = []
    for line in _unfenced_lines(body):
        if plan_parse.SLOT_RE.match(line.strip()):
            break
        out.append(line)
    return out


def retired_slot_violations(text_or_tasks):
    """One `grammar:` line per retired slot the plan still carries: a
    `- Test:` bullet under a task's Files or Proof, a `- Guard:` bullet
    under Proof, or an `**Exam command:**` header line -- cut three
    (2026-09-22) retired the examiner all three fed, and `plan_parse.py`
    reads none of them any more. A fenced occurrence of any shape is never
    read as one, the same as the parser's own scan.

    Called with the plan's raw TEXT for the header check (the lines above
    the first `### Task` heading), or with the TASKS list
    (`parse_plan_full`'s per-task dicts, each carrying `body` and `proof`)
    for the bullet check -- `parse_plan_full` answers neither slot any
    more, so this reads the plan's own strings directly."""
    if isinstance(text_or_tasks, str):
        violations = []
        for line, fenced in plan_parse._header_lines(text_or_tasks):
            if not fenced and _EXAM_CMD_HEADER_RE.match(line.strip()):
                violations.append(
                    "grammar: header: Exam command is not read since cut "
                    "three (2026-09-22) — a task's probes are its own "
                    "Run: lines")
        return violations

    violations = []
    for t in text_or_tasks:
        for line in _pre_slot_lines(t["body"]):
            if _RETIRED_TEST_BULLET_RE.match(line.strip()):
                violations.append(
                    "grammar: task %s: Files carries a Test: bullet — %s"
                    % (t["id"], _RETIRED_SUFFIX))
        for line in _unfenced_lines(t["proof"]):
            s = line.strip()
            if _RETIRED_TEST_BULLET_RE.match(s):
                violations.append(
                    "grammar: task %s: Proof carries a Test: bullet — %s"
                    % (t["id"], _RETIRED_SUFFIX))
            elif _RETIRED_GUARD_BULLET_RE.match(s):
                violations.append(
                    "grammar: task %s: Proof carries a Guard: bullet — %s"
                    % (t["id"], _RETIRED_SUFFIX))
    return violations


# --------------------------------------------------------------------------- #
# The tree at BASE                                                             #
# --------------------------------------------------------------------------- #
def _git_run(base, *args, binary=False):
    """THE subprocess call every git read of a base tree makes. Returns
    (ok, stdout) — ok False on ANY failure, so a tree read never raises."""
    try:
        p = subprocess.run(["git", "-C", str(base), *args],
                           capture_output=True, text=not binary)
    except OSError:
        return False, (b"" if binary else "")
    return p.returncode == 0, p.stdout


def _git(base, *args):
    """git in `base`; stdout text, or '' on ANY failure. Name and signature
    are load-bearing: `pin_base_facts.py` imports this."""
    ok, out = _git_run(base, *args)
    return out if ok else ""


# The sentinel rev of the DIRECTORY reader: it passes no tree-ish, so a read
# is of the working tree. Any other rev is a commit sha.
WORKTREE_REV = "HEAD"
_SHA40_RE = re.compile(r"[0-9a-f]{40}")


def default_base(plan_path):
    """The git toplevel of the plan's directory, or None outside a checkout."""
    top = _git(Path(plan_path).resolve().parent, "rev-parse", "--show-toplevel").strip()
    return Path(top) if top else None


def base_flag_refusal(value):
    """The one line a `--base` that is neither a checkout directory nor a
    40-hex sha earns, or None. `BaseTree.from_flag` reads any non-sha as a
    directory on purpose, so an 8-character abbreviation became
    `git -C <abbrev>` and every file read absent (#1025)."""
    if Path(str(value)).is_dir() or _SHA40_RE.fullmatch(str(value)):
        return None
    return ("--base %s is not a commit this repository has — pass the 40-hex "
            "sha or a checkout directory" % value)


class BaseTree:
    """The one reader every BASE-tree question goes through.

    `--base` names a tree two ways: a CHECKOUT DIRECTORY (`rev` is the
    `WORKTREE_REV` sentinel and a read is the working tree's), or a 40-hex SHA
    of the plan's own repository (every read is `git -C <repo> … <sha>`;
    nothing is opened off disk, the commit need not be checked out). Both
    answer the same questions, so no caller branches on which it was handed
    (#725)."""

    def __init__(self, repo, rev=WORKTREE_REV):
        self.repo = Path(repo)
        self.rev = rev
        self._peeled = {}

    @classmethod
    def from_flag(cls, value, plan_path):
        """The reader a `--base` VALUE names. A sha that names no commit of
        the plan's repository — or a plan outside any checkout — exits with
        one `error:` line rather than reading a tree nobody asked for."""
        text = str(value)
        if Path(text).is_dir() or not _SHA40_RE.fullmatch(text):
            return cls(text)
        repo = default_base(plan_path)
        if repo is None:
            sys.exit("error: --base %s: no git checkout found for %s to "
                     "resolve the sha in"
                     % (text, Path(plan_path).resolve().parent))
        tree = cls(repo, text)
        if not tree._peel(text):
            sys.exit("error: --base %s names no commit of %s" % (text, repo))
        return tree

    @property
    def is_sha(self):
        return self.rev != WORKTREE_REV

    def read_text(self, path):
        """`path`'s text at BASE, or None when it is not readable there."""
        if not self.is_sha:
            try:
                return (self.repo / path).read_text(errors="replace")
            except OSError:
                return None
        ok, raw = _git_run(self.repo, "show", "%s:%s" % (self.rev, path),
                           binary=True)
        return raw.decode("utf-8", "replace") if ok else None

    def commit_sha(self):
        """The 40-hex commit this reader reads — the sha itself, or the
        checkout's HEAD; '' when there is none."""
        return self._peel(self.rev)

    def _peel(self, rev):
        if rev not in self._peeled:
            self._peeled[rev] = _git(self.repo, "rev-parse", "--verify",
                                     "--quiet", rev + "^{commit}").strip()
        return self._peeled[rev]

    def _ls_tree(self, path):
        """The `(mode, type, id)` heads `git ls-tree <rev> -- <path>` prints."""
        return [line.split("\t", 1)[0].split()
                for line in _git(self.repo, "ls-tree", self.rev,
                                 "--", path).splitlines()]

    def _blob_mode(self, path):
        """The entry's mode when `path` is a blob at `rev`, else None."""
        for head in self._ls_tree(path):
            if len(head) >= 3 and head[1] == "blob":
                return head[0]
        return None


# --------------------------------------------------------------------------- #
# Stale-if predicates, answered at BASE (#538)                                 #
# --------------------------------------------------------------------------- #
# A predicate that HOLDS at BASE is a refusal: the plan is stale before it is
# dispatched. One the machine cannot DECIDE is an advisory after the verdict:
# an unreachable network is evidence about the laptop, never about the plan.
_STALE_ENTRY_RE = re.compile(
    r"^(path-exists|path-absent|sha-matches|issue-open|issue-closed)\s*:\s*(.*)$")
_ISSUE_ARG_RE = re.compile(r"^#?\s*(\d+)$")
_ISSUE_STATE_CACHE = {}


def _stale_argument(text):
    """An entry's argument, whitespace and the author's backticks stripped."""
    return text.strip().strip("`").strip()


def _issue_state(repo, number):
    """(state, reason) from one `gh issue view` in `repo`, once per number."""
    if number in _ISSUE_STATE_CACHE:
        return _ISSUE_STATE_CACHE[number]
    gh = shutil.which("gh")
    if gh is None:
        answer = None, "gh not on PATH"
    else:
        p = subprocess.run(
            [gh, "issue", "view", number, "--json", "state", "-q", ".state"],
            capture_output=True, text=True, cwd=str(repo))
        state = (p.stdout or "").strip()
        if p.returncode != 0:
            first = (p.stderr or "").strip().splitlines()
            answer = None, ("gh exited %d%s" % (
                p.returncode, (": " + first[0]) if first else ""))
        elif state not in ("OPEN", "CLOSED"):
            answer = None, "gh printed %r" % state
        else:
            answer = state, None
    _ISSUE_STATE_CACHE[number] = answer
    return answer


def _base_blob_id(base_tree, path):
    """`path`'s object id at BASE when it is a blob there, else None."""
    if not base_tree.is_sha:
        f = base_tree.repo / path
        if not f.is_file():
            return None
        return _git(base_tree.repo, "hash-object", "--", str(f)).strip() or None
    for head in base_tree._ls_tree(path):
        if len(head) >= 3 and head[1] == "blob":
            return head[2]
    return None


def _stale_entry_holds(head, argument, base_tree):
    """(holds, reason) for one entry. A non-None `reason` means the machine
    could not decide it, and `holds` says nothing."""
    if head in ("path-exists", "path-absent"):
        path = _stale_argument(argument)
        if not path:
            there = False
        elif base_tree.is_sha:
            there = bool(base_tree._ls_tree(path))
        else:
            there = (base_tree.repo / path).exists()
        return (there if head == "path-exists" else not there), None

    if head == "sha-matches":
        path, sep, want = argument.strip().rpartition("@")
        path, want = _stale_argument(path), _stale_argument(want)
        if not sep or not path or not want:
            return False, "malformed argument"
        blob = _base_blob_id(base_tree, path)
        # Not a blob at BASE cannot match an id — the predicate answered.
        return (blob is not None and blob.startswith(want.lower())), None

    m = _ISSUE_ARG_RE.match(_stale_argument(argument))
    if m is None:
        return False, "malformed argument"
    state, reason = _issue_state(base_tree.repo, m.group(1))
    if reason is not None:
        return False, reason
    return state == ("OPEN" if head == "issue-open" else "CLOSED"), None


def evaluate_stale_if(tasks, base_tree):
    """`(refusals, advisories)`: `STALE fact: task <id>: <entry> holds at
    BASE` per entry that holds, `… unreadable at BASE — <reason>` per entry
    the machine cannot decide. `<entry>` is the line as the author typed it."""
    refusals, advisories = [], []
    for t in tasks:
        for entry in t["stale_if_entries"]:
            m = _STALE_ENTRY_RE.match(entry)
            if m is None:
                continue  # not a predicate at all
            holds, reason = _stale_entry_holds(m.group(1), m.group(2), base_tree)
            if reason is not None:
                advisories.append(
                    "STALE fact: task %s: %s unreadable at BASE — %s"
                    % (t["id"], entry, reason))
            elif holds:
                refusals.append(
                    "STALE fact: task %s: %s holds at BASE" % (t["id"], entry))
    return refusals, advisories


# --------------------------------------------------------------------------- #
# BASE facts (#896)                                                            #
# --------------------------------------------------------------------------- #
# Two facts an author narrates from memory and gets wrong (runs 84, 88, 90):
# what a file the plan deletes actually holds, and which files OUTSIDE a task's
# Files carry a literal its Machine clauses pin. Facts, not advisories.

# A test case, in the shapes this repository's suites use.
_CASE_LINE_RE = re.compile(r"^\s*(?:test\(|it\(|def test_)")
# A section banner: a comment line that is a shouted heading, or a rule.
_BANNER_RE = re.compile(
    r"^\s*(?://|#)\s*((?:[A-Z][A-Z0-9'’#,:\-]*\s+){2}[A-Z][A-Z0-9'’#,:\-]*.*?)\s*$")
_BANNER_CAP = 70
_RULE_RE = re.compile(r"^\s*(?://|#)\s*[═─=\-]{20,}\s*$")
# Eight characters is where a quoted string starts to name one thing.
_LITERAL_MIN = 8
_LITERAL_FILES_SHOWN = 6
_LITERAL_CARRIERS_MAX = 40

# Path referents: a backticked token in a task body may name a repo path.
# `pin_base_facts.py` and `extract_gate_input.py` import the normalizer and the
# body-line selector from here, so what they pin is what this file reads.
_REFERENT_EXTS = frozenset(
    "py js mjs cjs ts tsx jsx md json jsonl sh yml yaml toml txt html css "
    "sql csv lock cfg ini env tgz log".split())
_MIME_RE = re.compile(r"^(text|application|image|audio|video|multipart)/")
_FENCE_MARK_RE = re.compile(r"^(`{3,}|~{3,})")
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
    """Body lines whose backticked tokens are referents: every line, fenced
    content included, minus the fence markers themselves (their backtick runs
    mis-pair PATH_RE) and the Files bullets."""
    return [line for line in task["body"].splitlines()
            if not _FENCE_MARK_RE.match(line.strip())
            and not _FILES_BULLET_RE.match(line)]


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
        paths = _git(base_tree.repo, *args, "--", ".").splitlines()
    return sorted(p for p in paths if p)


def _machine_literals(t, base_tree):
    """The backticked literals of a task's Machine clauses, in order, deduped,
    long enough to name one thing, and not a path of the tree (paths are the
    pinning script's business; a path the tree LACKS is a literal like any
    other, and the files that still say it are the fact — run-88)."""
    out = []
    for tok in PATH_RE.findall(machine_restatement(t["claim"])):
        tok = tok.strip()
        if len(tok) < _LITERAL_MIN or "\n" in tok or tok in out:
            continue
        rel = _path_referent(tok)
        if rel is not None and base_tree._blob_mode(rel) is not None:
            continue
        out.append(tok)
    return out


def base_fact_lines(tasks, base_tree):
    """One line per fact, in task order — empty for a task with nothing to
    say."""
    lines = []
    for t in tasks:
        if not _is_implementation(t):
            continue
        for rel in t["deletes"]:
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
        own = task_files(t)
        for lit in _machine_literals(t, base_tree):
            carriers = [p for p in _tree_files_carrying(base_tree, lit)
                        if p not in own]
            # A string carried by half the tree pins nothing in particular.
            if not carriers or len(carriers) > _LITERAL_CARRIERS_MAX:
                continue
            more = len(carriers) - _LITERAL_FILES_SHOWN
            lines.append(
                "BASE fact: task %s: `%s` is carried at BASE by %s%s — not in "
                "this task's Files"
                % (t["id"], lit, ", ".join(carriers[:_LITERAL_FILES_SHOWN]),
                   (" and %d more" % more) if more > 0 else ""))
    return lines


# --------------------------------------------------------------------------- #
# The rehearsals at BASE: every `Run:` (#1098)                                #
# --------------------------------------------------------------------------- #
GREEN_AT_BASE_TIMEOUT_S = 30
GREEN_FACT = "GREEN-AT-BASE fact:"


def _run_at_base(command, worktree, sha, timeout_s):
    """One command in the worktree at BASE: `(exit code or None, seconds)`.

    `bash -lc <command>` with `ULTRA_BASE` ADDED to the inherited environment.
    Output is discarded — the exit code is the reading. `start_new_session`
    puts the command in its own process group so a timeout kills the WHOLE
    tree: a `pytest` or `node` grandchild outlives a signal sent to the shell
    alone."""
    started = time.monotonic()
    proc = subprocess.Popen(["bash", "-lc", command], cwd=worktree,
                            env={**os.environ, "ULTRA_BASE": sha},
                            start_new_session=True,
                            stdin=subprocess.DEVNULL,
                            stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL)
    try:
        code = proc.wait(timeout=timeout_s)
    except subprocess.TimeoutExpired:
        code = None
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except OSError:  # the group is already gone
            pass
        proc.wait()
    return code, time.monotonic() - started


def _rehearse(commands, base_tree, timeout_s):
    """`[(exit code or None, seconds)]`, one per command, each run in order in
    ONE detached worktree of the plan's repository cut at BASE's commit under
    a fresh temporary directory, removed with `--force` whatever the commands
    wrote. The repository's own working tree is never the one a command runs
    in. `[]` for no commands, a base that is no commit, or a worktree git
    would not cut."""
    sha = base_tree.commit_sha()
    if not sha or not commands:
        return []
    tmp = tempfile.mkdtemp(prefix="ultra-rehearsal-")
    worktree = os.path.join(tmp, "tree")
    try:
        ok, _ = _git_run(base_tree.repo, "worktree", "add", "--detach",
                         worktree, sha)
        return [_run_at_base(c, worktree, sha, timeout_s)
                for c in (commands if ok else [])]
    finally:
        _git_run(base_tree.repo, "worktree", "remove", "--force", worktree)
        _git_run(base_tree.repo, "worktree", "prune")
        shutil.rmtree(tmp, ignore_errors=True)


def green_at_base_lines(tasks, base_tree, timeout_s=GREEN_AT_BASE_TIMEOUT_S):
    """A `Run:` that exits 0 at BASE yields one line, worded by what the plan
    said it was: a PROVER (it carries a citation tag) cannot falsify the clause
    it cites, a GUARD is cited by no leg. Red at BASE is the ordinary case and
    is silent. The last line is always the reading — seconds, how many reached
    an exit, how many were killed — even for a plan with no `Run:` line."""
    runs = [(t["id"], command, cites) for t in tasks
            for command, cites in zip(t["proofRuns"], t["proofRunClauses"])]
    lines, seconds, ran, killed = [], 0.0, 0, 0
    results = _rehearse([r[1] for r in runs], base_tree, timeout_s)
    for (task_id, command, cites), (code, elapsed) in zip(runs, results):
        seconds += elapsed
        if code is None:
            killed += 1
            lines.append("%s task %s: Run: %s — not run (timeout after %s s)"
                         % (GREEN_FACT, task_id, command, timeout_s))
            continue
        ran += 1
        if code == 0:
            lines.append(
                "%s task %s: Run: %s — exits 0 at BASE; %s"
                % (GREEN_FACT, task_id, command,
                   "this line cannot falsify its clause" if cites
                   else "a guard, no leg cites it"))
    lines.append("%s %.1f s over %d lines run, %d not run (timeout)"
                 % (GREEN_FACT, seconds, ran, killed))
    return lines


# --------------------------------------------------------------------------- #
def main(argv=None):
    ap = argparse.ArgumentParser(
        description="Check a claims-v1 plan's records, and with --base what "
                    "the tree it launches on says about it.")
    ap.add_argument("plan", type=Path)
    ap.add_argument("--base", default=None, metavar="SHA|DIR",
                    help="a checkout directory, or a 40-hex commit of the "
                         "plan's own repository (read with git show/ls-tree, "
                         "never checked out)")
    args = ap.parse_args(argv)

    # An input error prints no verdict line at all.
    base_tree = None
    if args.base is not None:
        refusal = base_flag_refusal(args.base)
        if refusal is not None:
            print("error: " + refusal, file=sys.stderr)
            return 2
        base_tree = BaseTree.from_flag(args.base, args.plan)

    plan_text = args.plan.read_text()
    try:
        result, tasks = plan_parse.parse_plan_full(plan_text)
    except plan_parse.Refusal as exc:
        print("%s\n\n1 violation(s)" % exc)
        return 2

    violations = (gate_verdict_violations(args.plan, tasks)
                  + authoring_record_violations(args.plan)
                  + command_violations(result["checks"], tasks)
                  + freeze_violations(result["checks"], tasks)
                  + retired_slot_violations(tasks)
                  + retired_slot_violations(plan_text))
    advisories = []
    if base_tree is not None:
        refusals, advisories = evaluate_stale_if(tasks, base_tree)
        violations += refusals

    if violations:
        print("\n\n".join(violations))
        print()
        print("%d violation(s)" % len(violations))
    else:
        print("PLAN OK")
    if base_tree is not None:
        for line in base_fact_lines(tasks, base_tree) + advisories:
            print(line)
        # A refused plan's commands are not run: the seconds would buy a
        # reading of a document nobody will dispatch.
        if not violations:
            for line in green_at_base_lines(tasks, base_tree):
                print(line)
        print(authoring_fact_line(args.plan))
    return 2 if violations else 0


if __name__ == "__main__":
    sys.exit(main())
