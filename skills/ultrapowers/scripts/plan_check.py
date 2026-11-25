#!/usr/bin/env python3
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



GATE_VERDICTS_SUFFIX = ".gate-verdicts.json"
GATE_VERDICT_VALUES = ("pass", "fail")


def verdicts_path(plan_path):
    p = Path(plan_path)
    return p.with_name(p.stem + GATE_VERDICTS_SUFFIX)


def gate_input_hash(claim, proof):
    return hashlib.sha256(
        (claim + "\x00" + proof).encode("utf-8")).hexdigest()


def gate_verdict_violations(plan_path, tasks):
    path = verdicts_path(plan_path)
    if not path.exists():
        return ["grammar: gate verdicts missing — expected `%s` beside the "
                "plan; the proof gate's verdict is an artifact, not a memory "
                "(ultrawrite §The proof gate). Run the gate and commit its record."
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


AUTHORING_KEY = "authoring"


def _record(plan_path):
    try:
        record = json.loads(verdicts_path(plan_path).read_text())
    except (OSError, ValueError):
        return {}
    return record if isinstance(record, dict) else {}


def picks(question):
    picked = question.get("picked")
    return picked if isinstance(picked, list) else [picked]


def recommended_picked(questions):
    offered = [q for q in questions if q.get("recommended") is not None]
    return (len([q for q in offered if q.get("recommended") in picks(q)]),
            len(offered))


def explain_rounds(questions):
    return sum(q["explain_rounds"] for q in questions
               if isinstance(q.get("explain_rounds"), int)
               and not isinstance(q["explain_rounds"], bool))


def _count(value):
    ok = isinstance(value, int) and not isinstance(value, bool) and value >= 0
    return value if ok else "-"


def _word(value):
    return value if isinstance(value, str) and value else "-"


def authoring_fact_line(plan_path):
    record = _record(plan_path)
    auth = record.get(AUTHORING_KEY)
    if auth is None:
        return "AUTHORING fact: none recorded"
    auth = auth if isinstance(auth, dict) else {}
    tally = record.get("tally") if isinstance(record.get("tally"), dict) else {}
    routing = auth.get("routing") if isinstance(auth.get("routing"), dict) else {}
    questions = auth.get("questions")
    questions = [q for q in questions if isinstance(q, dict)] if isinstance(questions, list) else []
    picked, offered = recommended_picked(questions)
    return ("AUTHORING fact: %s min to PLAN OK, "
            "%s gate dispatches, %s rejected, routing %s->%s, "
            "%d questions, %d/%d recommended picked, %d explain rounds"
            % (_count(auth.get("minutes")),
               tally.get("dispatched", "-"), tally.get("rejected", "-"),
               _word(routing.get("branch")), _word(routing.get("lane")),
               len(questions), picked, offered, explain_rounds(questions)))


def command_names_path(command, path):
    if not path:
        return False
    return re.search(r"(?<![\w./-])" + re.escape(path) + r"(?![\w./-])",
                     command) is not None


def task_files(t):
    return set(t["creates"]) | set(t["modifies"]) | set(t["deletes"])


def shared_fact_lines(tasks):
    owners = {}
    for t in tasks:
        for path in t["creates"] + t["modifies"] + t["deletes"]:
            ids = owners.setdefault(path, [])
            if t["id"] not in ids:
                ids.append(t["id"])
    lines = []
    for path, ids in owners.items():
        if len(ids) < 2:
            continue
        named = ", ".join(str(i) for i in ids[:-1]) + " and " + str(ids[-1])
        lines.append("SHARED fact: %s is in tasks %s; name what it must keep "
                     "in a Run: probe" % (path, named))
    return lines


def command_violations(checks, tasks, publish=None):
    commands = ([("Check", "", c["cmd"]) for c in checks]
                + [("Run", "task %s: " % t["id"], cmd)
                   for t in tasks for cmd in t["proofRuns"]])
    if publish:
        commands += [(kind, "", publish[key]) for kind, key in
                      (("Publish", "deploy"), ("Verify", "verify"),
                       ("Rollback", "rollback"))
                      if publish.get(key)]
    violations = [
        "grammar: %s: command carries a backtick — %s%s; the engine's shell "
        "reads it as a command substitution (run-74)" % (kind, where, cmd[:80])
        for kind, where, cmd in commands if "`" in cmd]
    for check in checks:
        for t in tasks:
            for path in sorted(task_files(t)):
                if command_names_path(check["cmd"], path):
                    violations.append(
                        "grammar: task %s: run-wide `- Check: %s` names `%s`, "
                        "a path task %s's Files own — a check one task would "
                        "turn green is not run-wide; move it to that task's "
                        "Proof as a `Run:`."
                        % (t["id"], check["cmd"], path, t["id"]))
    return violations


def publish_violations(publish):
    if not publish:
        return []
    deploy, verify = publish.get("deploy"), publish.get("verify")
    violations = []
    if deploy is not None and verify is None:
        violations.append(
            "grammar: Publish: a **Publish:** line needs a **Verify:** "
            "line — a deploy nobody checks live is not a publish")
    elif verify is not None and deploy is None:
        violations.append(
            "grammar: Publish: a **Verify:** line needs a **Publish:** "
            "line — there is no deployed URL to check")
    if verify is not None and "$ULTRA_PUBLISH_URL" not in verify:
        violations.append(
            "grammar: Verify: the **Verify:** command never reads "
            "$ULTRA_PUBLISH_URL — a probe that does not read the deployed "
            "URL is not a live probe")
    return violations


_SHELL_OPERATORS = ("&&", "||", "|", ";")


_WHOLE_TREE_TOKENS = (".", "", "*")


def freeze_violations(checks, tasks):
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
            violations.append(
                "grammar: run-wide `- Check: %s` freezes the whole tree "
                "against $ULTRA_BASE, which covers every task's Files — the "
                "check goes red the moment any task's patch lands (run-199); "
                "freeze files, never the tree." % cmd)
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
        if pathspecs and pathspecs[0][1] in _WHOLE_TREE_TOKENS:
            violations.append(
                "grammar: run-wide `- Check: %s` freezes the whole tree "
                "against $ULTRA_BASE, which covers every task's Files — the "
                "check goes red the moment any task's patch lands (run-199); "
                "freeze files, never the tree." % cmd)
            continue
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


_MACHINE_NUM_RE = re.compile(r'\bM(\d+)\.')


def _run_cite_span(numbers):
    if not numbers:
        return "(no clauses)"
    if len(numbers) == 1:
        return "M%d" % numbers[0]
    return "M%d–M%d" % (min(numbers), max(numbers))


def promised_violations(tasks):
    violations = []
    for t in tasks:
        numbers = [int(n) for n in _MACHINE_NUM_RE.findall(
            machine_restatement(t["claim"]))]
        span = _run_cite_span(sorted(set(numbers)))
        for cmd, clauses in zip(t["proofRuns"], t["proofRunClauses"]):
            for tag in clauses:
                num = int(tag[1:])
                if num not in numbers:
                    violations.append(
                        "grammar: Run: cites an unknown clause — task %s: "
                        "%s cites %s; the Machine line numbers %s"
                        % (t["id"], cmd[:80], tag, span))

        for entry in t["stale_if_entries"]:
            if not _STALE_ENTRY_RE.match(entry):
                violations.append(
                    "grammar: task %s: Stale-if entry `%s` is not a "
                    "predicate — path-exists:, path-absent:, sha-matches:, "
                    "issue-open: or issue-closed:" % (t["id"], entry))
    return violations


_SLOT_ORDER = ["claim", "authorized-by", "interfaces", "context", "proof",
               "stale-if"]
def _task_slots(body_lines):
    spans = plan_parse._slot_spans(body_lines)
    return ([(sp[2], plan_parse._span_text(body_lines, sp)) for sp in spans],
            [(sp[0], sp[2]) for sp in spans])


def slip_violations(text, tasks):
    violations = []
    header, bodies = plan_parse._split_plan(text)

    if any(fenced for _, fenced in header):
        violations.append("grammar: header: a code fence above the first task")

    for tid, _title, _order, body in bodies:
        slots, positions = _task_slots(body)
        if ([name for name, _ in slots] != _SLOT_ORDER
                or not all(t for _, t in slots)):
            violations.append(
                "grammar: task %s: the body must carry Claim, Authorized-by, "
                "Interfaces, Context, Proof and Stale-if, each once, "
                "non-empty, in that order" % tid)
        for i, (_line, fenced) in enumerate(body):
            if not fenced:
                continue
            owner = next((name for at, name in reversed(positions) if at < i),
                         None)
            if owner != "proof":
                violations.append(
                    "grammar: task %s: a code fence outside the Proof slot"
                    % tid)
                break
    scanned = plan_parse._fence_aware_lines(text)
    owned = len(header) + sum(len(b) for _, _, _, b in bodies)
    if owned < len(scanned):
        outside, where = False, "header"
        for line, fenced in scanned:
            s = line.strip()
            if not fenced and plan_parse._leading_spaces(line) <= 3:
                if plan_parse.TASK_HEAD.match(s):
                    where = "task"
                elif where != "header" and plan_parse.H2_HEAD.match(s):
                    where = "outside"
            if fenced and where == "outside":
                outside = True
        if outside:
            violations.append("grammar: a code fence outside every task")
    return violations


def _git_run(base, *args, binary=False):
    try:
        p = subprocess.run(["git", "-C", str(base), *args],
                           capture_output=True, text=not binary)
    except OSError:
        return False, (b"" if binary else "")
    return p.returncode == 0, p.stdout


def _git(base, *args):
    ok, out = _git_run(base, *args)
    return out if ok else ""


WORKTREE_REV = "HEAD"
_SHA40_RE = re.compile(r"[0-9a-f]{40}")


def default_base(plan_path):
    top = _git(Path(plan_path).resolve().parent, "rev-parse", "--show-toplevel").strip()
    return Path(top) if top else None


def base_flag_refusal(value):
    if Path(str(value)).is_dir() or _SHA40_RE.fullmatch(str(value)):
        return None
    return ("--base %s is not a commit this repository has — pass the 40-hex "
            "sha or a checkout directory" % value)


class BaseTree:

    def __init__(self, repo, rev=WORKTREE_REV):
        self.repo = Path(repo)
        self.rev = rev
        self._peeled = {}

    @classmethod
    def from_flag(cls, value, plan_path, repo=None):
        text = str(value)
        if Path(text).is_dir() or not _SHA40_RE.fullmatch(text):
            return cls(text)
        repo_path = Path(repo) if repo is not None else default_base(plan_path)
        if repo_path is None:
            sys.exit("error: --base %s: no git checkout found for %s to "
                     "resolve the sha in"
                     % (text, Path(plan_path).resolve().parent))
        tree = cls(repo_path, text)
        if not tree._peel(text):
            sys.exit("error: --base %s names no commit of %s" % (text, repo_path))
        return tree

    @property
    def is_sha(self):
        return self.rev != WORKTREE_REV

    def read_text(self, path):
        if not self.is_sha:
            try:
                return (self.repo / path).read_text(errors="replace")
            except OSError:
                return None
        ok, raw = _git_run(self.repo, "show", "%s:%s" % (self.rev, path),
                           binary=True)
        return raw.decode("utf-8", "replace") if ok else None

    def commit_sha(self):
        return self._peel(self.rev)

    def _peel(self, rev):
        if rev not in self._peeled:
            self._peeled[rev] = _git(self.repo, "rev-parse", "--verify",
                                     "--quiet", rev + "^{commit}").strip()
        return self._peeled[rev]

    def _ls_tree(self, path):
        return [line.split("\t", 1)[0].split()
                for line in _git(self.repo, "ls-tree", self.rev,
                                 "--", path).splitlines()]

    def _blob_mode(self, path):
        for head in self._ls_tree(path):
            if len(head) >= 3 and head[1] == "blob":
                return head[0]
        return None


_STALE_ENTRY_RE = re.compile(
    r"^(path-exists|path-absent|sha-matches|issue-open|issue-closed)\s*:\s*(.*)$")
_ISSUE_ARG_RE = re.compile(r"^#?\s*(\d+)$")
_ISSUE_STATE_CACHE = {}


def _stale_argument(text):
    return text.strip().strip("`").strip()


def gh_issue_view(gh, number, field, cwd=None):
    return subprocess.run(
        list(gh) + ["issue", "view", number, "--json", field, "-q", "." + field],
        capture_output=True, text=True, cwd=cwd)


def _issue_state(repo, number):
    if number in _ISSUE_STATE_CACHE:
        return _ISSUE_STATE_CACHE[number]
    gh = shutil.which("gh")
    if gh is None:
        answer = None, "gh not on PATH"
    else:
        p = gh_issue_view([gh], number, "state", cwd=str(repo))
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
        return (blob is not None and blob.startswith(want.lower())), None

    m = _ISSUE_ARG_RE.match(_stale_argument(argument))
    if m is None:
        return False, "malformed argument"
    state, reason = _issue_state(base_tree.repo, m.group(1))
    if reason is not None:
        return False, reason
    return state == ("OPEN" if head == "issue-open" else "CLOSED"), None


def evaluate_stale_if(tasks, base_tree):
    refusals, advisories = [], []
    for t in tasks:
        for entry in t["stale_if_entries"]:
            m = _STALE_ENTRY_RE.match(entry)
            if m is None:
                continue
            holds, reason = _stale_entry_holds(m.group(1), m.group(2), base_tree)
            if reason is not None:
                advisories.append(
                    "STALE fact: task %s: %s unreadable at BASE — %s"
                    % (t["id"], entry, reason))
            elif holds:
                refusals.append(
                    "STALE fact: task %s: %s holds at BASE" % (t["id"], entry))
    return refusals, advisories


GREEN_AT_BASE_TIMEOUT_S = 30
GREEN_FACT = "GREEN-AT-BASE fact:"


def _timeout_shim_env(tmp):
    env = dict(os.environ)
    if shutil.which("timeout") is not None:
        return env
    shim_dir = os.path.join(tmp, "shim")
    os.makedirs(shim_dir, exist_ok=True)
    shim = os.path.join(shim_dir, "timeout")
    with open(shim, "w") as f:
        f.write('#!/bin/sh\nshift; "$@"\n')
    os.chmod(shim, 0o755)
    path = env.get("PATH")
    env["PATH"] = shim_dir + (os.pathsep + path if path else "")
    return env


def _run_at_base(command, worktree, sha, timeout_s, env=None):
    started = time.monotonic()
    proc = subprocess.Popen(["bash", "-lc", command], cwd=worktree,
                            env={**(os.environ if env is None else env),
                                 "ULTRA_BASE": sha},
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
        except OSError:
            pass
        proc.wait()
    return code, time.monotonic() - started


def _rehearse(commands, base_tree, timeout_s):
    sha = base_tree.commit_sha()
    if not sha or not commands:
        return []
    tmp = tempfile.mkdtemp(prefix="ultra-rehearsal-")
    worktree = os.path.join(tmp, "tree")
    try:
        ok, _ = _git_run(base_tree.repo, "worktree", "add", "--detach",
                         worktree, sha)
        env = _timeout_shim_env(tmp)
        return [_run_at_base(c, worktree, sha, timeout_s, env)
                for c in (commands if ok else [])]
    finally:
        _git_run(base_tree.repo, "worktree", "remove", "--force", worktree)
        _git_run(base_tree.repo, "worktree", "prune")
        shutil.rmtree(tmp, ignore_errors=True)


def green_at_base_lines(tasks, base_tree, timeout_s=GREEN_AT_BASE_TIMEOUT_S):
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


def main(argv=None):
    ap = argparse.ArgumentParser(
        description="Check a claims-v1 plan's records, and with --base what "
                    "the tree it launches on says about it.")
    ap.add_argument("plan", type=Path)
    ap.add_argument("--base", default=None, metavar="SHA|DIR",
                    help="a checkout directory, or a 40-hex commit of the "
                         "plan's own repository (read with git show/ls-tree, "
                         "never checked out)")
    ap.add_argument("--repo", default=None, metavar="DIR",
                    help="the repository a 40-hex --base is resolved and "
                         "peeled in, in place of the plan's own checkout "
                         "(for a plan sitting outside any git checkout); "
                         "a directory --base is unaffected")
    args = ap.parse_args(argv)

    base_tree = None
    if args.base is not None:
        refusal = base_flag_refusal(args.base)
        if refusal is not None:
            print("error: " + refusal, file=sys.stderr)
            return 2
        base_tree = BaseTree.from_flag(args.base, args.plan, repo=args.repo)

    try:
        plan_text = args.plan.read_text()
    except UnicodeDecodeError as exc:
        print("error: plan is not UTF-8: " + str(exc), file=sys.stderr)
        return 2

    try:
        plan_parse.plan_grammar(plan_text)
    except plan_parse.Refusal as exc:
        print(exc)
        return 2

    try:
        result, tasks = plan_parse.parse_plan_full(plan_text)
    except plan_parse.Refusal as exc:
        print("%s\n\n1 violation(s)" % exc)
        return 2

    violations = (gate_verdict_violations(args.plan, tasks)
                  + command_violations(result["checks"], tasks, result["publish"])
                  + freeze_violations(result["checks"], tasks)
                  + promised_violations(tasks)
                  + slip_violations(plan_text, tasks)
                  + publish_violations(result["publish"]))
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
    for line in shared_fact_lines(tasks):
        print(line)
    if base_tree is not None:
        for line in advisories:
            print(line)
        if not violations:
            for line in green_at_base_lines(tasks, base_tree):
                print(line)
        print(authoring_fact_line(args.plan))
    return 2 if violations else 0


if __name__ == "__main__":
    sys.exit(main())
