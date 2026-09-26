#!/usr/bin/env python3
"""Autoresearch — one command over a directory of tagged runs, a list of
candidate questions and a recorded answer table, that reports held-out
AUROC per candidate question against two outcomes: `fix` (the task drew a
fix or a redispatch/fold reattempt) and `parked` (the task was parked).

The model this fits is deliberately small and fixed, not tuned: standardize
each feature on the training half, logistic regression by hand (full-batch
gradient descent, an L2 term on the weights), score the held-out half, and
read AUROC as the fraction of (positive, negative) pairs the score orders
correctly. `difficulty` — the authored score every task already carries
off its own last answered `jev` row — is the baseline every candidate is
measured against: alone, added to `difficulty`, all together, and dropped
one at a time from "all" (the `ablation` reading — what removing just that
one candidate costs).

Read-only and advisory over `--questions`/`--answers`: with both given, no
external process runs at all — the whole fit is arithmetic over the two
files handed in and the run directories' own `events.jsonl`. The two ways
this script instead REACHES for a process are both off the exam (Context,
M7): `--fetch` pulls runs and plans through `catch_counter.fetch_runs` and
`gh api`; without `--questions` a single `claude -p` proposes candidates;
without `--answers` one `node` child per task asks Jev through
`factory/jev-client.mjs`. None of the three runs when both `--questions` and
`--answers` are given.

Sibling scripts this one reuses rather than reimplements: `catch_counter`'s
`fetch_runs` (the same evidence-tag fetch `jev_census.py` already uses) and
`jev_census`'s `numeric_of` (the same value reader, extended here to also
read a `score` answer's `score` — `difficulty`'s own shape).
"""
from __future__ import annotations

import argparse
import json
import math
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

# This is a readings tool under `evals/readings/`, beside `jev_census.py` and
# `ab_auth.py`; the scripts it reuses live in the plugin's own `scripts/`.
HERE = Path(__file__).resolve().parent
SCRIPTS = HERE.parents[1] / "skills" / "ultrapowers" / "scripts"
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(SCRIPTS))
from catch_counter import fetch_runs  # noqa: E402
from jev_census import numeric_of  # noqa: E402

RUN_FILE = "events.jsonl"
PLAN_FILE = "plan.md"
RUN_DIR_RE = re.compile(r"^run-(\d+)$")
RUNS_RE = re.compile(r"^(\d+)\.\.(\d+)$")

RESERVED_CANDIDATE = "difficulty"

# The three seed candidates, verbatim from #1132's comment of 2026-09-21 —
# always in the proposed list, whether or not `claude -p` adds any more.
SEED_CANDIDATES = [
    {"name": "stub_replaces_deterministic", "type": "noul",
     "instructions": {
         "question": "Does the exam replace something local and "
                     "deterministic with a stub?",
         "context": "One of three seed candidates for autoresearch's "
                    "proposer (#1132, 2026-09-21)."},
     "criteria": {"true": "Yes", "false": "No"}},
    {"name": "hand_written_fixture", "type": "noul",
     "instructions": {
         "question": "Does the exam hand-write a fixture for a file "
                     "another module writes?",
         "context": "One of three seed candidates for autoresearch's "
                    "proposer (#1132, 2026-09-21)."},
     "criteria": {"true": "Yes", "false": "No"}},
    {"name": "stub_answers_unchecked", "type": "noul",
     "instructions": {
         "question": "Does a stub answer success without checking its "
                     "arguments?",
         "context": "One of three seed candidates for autoresearch's "
                    "proposer (#1132, 2026-09-21)."},
     "criteria": {"true": "Yes", "false": "No"}},
]

GD_STEPS = 2000
GD_LR = 0.1
GD_L2 = 0.01


def die(message):
    """The one refusal shape: exactly one stderr line, `autoresearch:` up
    front, no `--out` written -- the caller returns 2 right after."""
    print("autoresearch: %s" % message, file=sys.stderr)
    return 2


# --- value reading ------------------------------------------------------------

def value_of(value):
    """A number the way `numeric_of` reads it (a bare number, or a `noul`
    answer's `noul`), extended to also read a `{"score": n}` answer's
    `score` -- `numeric_of` reads that shape as None (it is not a band
    reading for the census), but it is exactly `difficulty`'s own shape,
    and this script accepts it from a candidate answer too."""
    number = numeric_of(value)
    if number is not None:
        return number
    if isinstance(value, dict) and value.get("type") == "score":
        score = value.get("score")
        if isinstance(score, bool):
            return None
        if isinstance(score, (int, float)):
            return float(score)
    return None


def round4(value):
    return None if value is None else round(value, 4)


# --- finding run directories ---------------------------------------------------

def find_run_dirs(paths):
    """`{run number: directory}` for every `run-<N>` directory holding an
    `events.jsonl`, at or under any of `paths` -- the same shape
    `jev_census.py`'s `find_run_dirs` uses."""
    found = {}
    for base in paths:
        for dirpath, dirnames, filenames in os.walk(base):
            dirnames.sort()
            match = RUN_DIR_RE.match(os.path.basename(dirpath.rstrip(os.sep)))
            if match and RUN_FILE in filenames:
                found.setdefault(int(match.group(1)), dirpath)
    return found


def _fetch_bounds(runs, into):
    if not runs or not into:
        print("autoresearch: --fetch needs --runs <A>..<B> and --into <dir>",
              file=sys.stderr)
        return None
    match = RUNS_RE.match(runs)
    if not match:
        print("autoresearch: --runs takes `<A>..<B>`, not `%s`" % runs,
              file=sys.stderr)
        return None
    first, last = int(match.group(1)), int(match.group(2))
    if first > last:
        print("autoresearch: --runs `%s` counts backwards" % runs,
              file=sys.stderr)
        return None
    return first, last


# --- reading one run's events.jsonl --------------------------------------------

def _fix_labels(task):
    """The three labels (Context, `factory/engine.mjs`) that make a task's
    `fix` label 1."""
    return {"fix:%s" % task, "impl:%s:redispatch" % task,
           "impl:%s:fold" % task}


def read_run_events(events_path):
    """One run's `(dispatch_labels, parked_tasks, difficulty)`:
    `dispatch_labels` maps task -> the set of `dispatch:start` labels it
    saw; `parked_tasks` is the set of tasks a `parked` row named;
    `difficulty` maps task -> `value_of` of the LAST answered
    `site: "task"` `jev` row's `values.difficulty` (file order is read as
    chronological order, the way every sibling script here reads a log)."""
    dispatch_labels = {}
    parked_tasks = set()
    difficulty = {}
    try:
        handle = open(events_path, encoding="utf-8")
    except OSError:
        return dispatch_labels, parked_tasks, difficulty
    with handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except ValueError:
                continue
            if not isinstance(row, dict):
                continue
            kind = row.get("kind")
            if kind == "dispatch:start":
                task = row.get("task")
                if task is None:
                    continue
                task = str(task)
                dispatch_labels.setdefault(task, set()).add(row.get("label"))
            elif kind == "parked":
                task = row.get("task")
                if task is not None:
                    parked_tasks.add(str(task))
            elif kind == "jev":
                if row.get("site") != "task" or not row.get("answered"):
                    continue
                task = row.get("task")
                if task is None:
                    continue
                values = row.get("values")
                if not isinstance(values, dict):
                    continue
                # Last matching row wins -- overwrite unconditionally.
                difficulty[str(task)] = value_of(values.get("difficulty"))
    return dispatch_labels, parked_tasks, difficulty


def read_runs(entries):
    """`(runs_read, dispatch_by_run, parked_by_run, difficulty_by_run)` over
    `entries` (`(run number, directory-or-None)` pairs) -- a run whose
    directory is None or whose `events.jsonl` is unreadable contributes
    nothing and is not counted read."""
    runs_read = []
    dispatch_by_run = {}
    parked_by_run = {}
    difficulty_by_run = {}
    for number, directory in entries:
        if directory is None:
            continue
        events_path = Path(directory) / RUN_FILE
        if not events_path.is_file():
            continue
        dispatch, parked, difficulty = read_run_events(events_path)
        runs_read.append(number)
        dispatch_by_run[number] = dispatch
        parked_by_run[number] = parked
        difficulty_by_run[number] = difficulty
    runs_read.sort()
    return runs_read, dispatch_by_run, parked_by_run, difficulty_by_run


def task_sort_key(task):
    """A task id as an integer when it parses, else as a string -- int-
    parseable ids sort first, among themselves numerically."""
    try:
        return (0, int(task))
    except (TypeError, ValueError):
        return (1, str(task))


def ordered_tasks(runs_read, dispatch_by_run):
    """Every `(run, task)` in run-then-task order: `runs_read` ascending,
    then each run's distinct `dispatch:start` task ids by `task_sort_key`."""
    order = []
    for run in runs_read:
        tasks = sorted(dispatch_by_run.get(run, {}).keys(), key=task_sort_key)
        for task in tasks:
            order.append((run, task))
    return order


# --- the model ------------------------------------------------------------------

def _sigmoid(z):
    if z >= 0:
        return 1.0 / (1.0 + math.exp(-z))
    e = math.exp(z)
    return e / (1.0 + e)


def fit_logreg(X, y, steps=GD_STEPS, lr=GD_LR, l2=GD_L2):
    """Weights and intercept, starting at 0, by full-batch gradient descent:
    the gradient is the mean over rows of (sigma(w.x+b) - y).x for the
    weights and of (sigma(w.x+b) - y) for the intercept, plus an L2 term
    `l2 * w` on the weights only."""
    n = len(X)
    if n == 0:
        return [], 0.0
    n_features = len(X[0])
    w = [0.0] * n_features
    b = 0.0
    for _ in range(steps):
        grad_w = [0.0] * n_features
        grad_b = 0.0
        for xi, yi in zip(X, y):
            z = b + sum(w[k] * xi[k] for k in range(n_features))
            diff = _sigmoid(z) - yi
            for k in range(n_features):
                grad_w[k] += diff * xi[k]
            grad_b += diff
        grad_w = [(gw / n) + l2 * w[k] for k, gw in enumerate(grad_w)]
        grad_b = grad_b / n
        w = [w[k] - lr * grad_w[k] for k in range(n_features)]
        b = b - lr * grad_b
    return w, b


def auroc(scores, labels):
    """The mean over every (positive, negative) pair of 1 when the positive
    scores higher, 0.5 on a tie, 0 otherwise -- `None` when either half of
    the pair is empty."""
    positives = [s for s, y in zip(scores, labels) if y == 1]
    negatives = [s for s, y in zip(scores, labels) if y == 0]
    if not positives or not negatives:
        return None
    total = 0.0
    for p in positives:
        for n in negatives:
            if p > n:
                total += 1.0
            elif p == n:
                total += 0.5
    return total / (len(positives) * len(negatives))


def fit_and_score(feature_names, outcome, train_keys, held_keys,
                  features_by_task, labels):
    """One fit's held-out AUROC: standardize each feature on `train_keys`
    (population std; a zero std standardizes every row to 0), fit logistic
    regression on `train_keys`, score `held_keys` as w.x + b, read AUROC
    against their `outcome` label."""
    if not train_keys or not feature_names:
        return None
    means, stds = {}, {}
    for f in feature_names:
        vals = [features_by_task[k][f] for k in train_keys]
        m = sum(vals) / len(vals)
        var = sum((v - m) ** 2 for v in vals) / len(vals)
        means[f] = m
        stds[f] = var ** 0.5

    def vec(k):
        row = features_by_task[k]
        return [0.0 if stds[f] == 0 else (row[f] - means[f]) / stds[f]
               for f in feature_names]

    X = [vec(k) for k in train_keys]
    y = [labels[k][outcome] for k in train_keys]
    w, b = fit_logreg(X, y)
    held_scores = [sum(wk * vk for wk, vk in zip(w, vec(k))) + b
                  for k in held_keys]
    held_labels = [labels[k][outcome] for k in held_keys]
    return auroc(held_scores, held_labels)


def outcome_fits(outcome, candidate_names, train_keys, held_keys,
                 features_by_task, labels):
    """One outcome's whole reading: `difficulty` alone, `difficulty` plus
    each candidate (`added`), every candidate together (`all`), `all`
    minus each candidate in turn (`drop`, table-only) and that drop's cost
    (`ablation` = `all` - the drop fit)."""
    alone = fit_and_score(["difficulty"], outcome, train_keys, held_keys,
                          features_by_task, labels)
    added = {}
    for name in candidate_names:
        added[name] = fit_and_score(["difficulty", name], outcome,
                                    train_keys, held_keys, features_by_task,
                                    labels)
    all_features = ["difficulty"] + list(candidate_names)
    all_auroc = fit_and_score(all_features, outcome, train_keys, held_keys,
                              features_by_task, labels)
    drop, ablation = {}, {}
    for name in candidate_names:
        drop_features = ["difficulty"] + [n for n in candidate_names
                                          if n != name]
        drop_auroc = fit_and_score(drop_features, outcome, train_keys,
                                   held_keys, features_by_task, labels)
        drop[name] = drop_auroc
        ablation[name] = (None if all_auroc is None or drop_auroc is None
                          else all_auroc - drop_auroc)
    return {"difficulty": alone, "added": added, "all": all_auroc,
           "drop": drop, "ablation": ablation}


# --- questions / answers files --------------------------------------------------

def load_json_file(path, what):
    """`(data, None)` on a readable JSON file, or `(None, message)` -- a
    missing file and a file that is not JSON are the same refusal shape."""
    p = Path(path)
    if not p.is_file():
        return None, "%s does not exist: %s" % (what, path)
    try:
        text = p.read_text(encoding="utf-8")
    except OSError as exc:
        return None, "%s could not be read (%s): %s" % (what, exc, path)
    try:
        data = json.loads(text)
    except ValueError:
        return None, "%s is not JSON: %s" % (what, path)
    return data, None


def validate_questions(data):
    """`(names, None)` in file order, or `(None, message)` -- a non-list, an
    entry missing `name` or `type`, and a candidate named `difficulty`
    (reserved for the baseline) are all refused here."""
    if not isinstance(data, list):
        return None, "--questions must be a JSON list of entries"
    names = []
    for entry in data:
        if not isinstance(entry, dict) or "name" not in entry \
               or "type" not in entry:
            return None, "--questions entry carries no `name` or no `type`"
        name = entry["name"]
        if name == RESERVED_CANDIDATE:
            return None, ("--questions names a candidate `difficulty` -- "
                          "that name is reserved for the baseline")
        names.append(name)
    return names, None


def task_features(run, task, difficulty_by_run, answers_table,
                  candidate_names):
    """One task's `(key, features)`: `features["difficulty"]` from the
    answer table's own `difficulty` column when it carries one for this
    task (a re-fit from a previous `--out`), else from the run's last
    answered `jev` row; each candidate from the answer table, or None when
    the table carries nothing for it."""
    key = "%d:%s" % (run, task)
    entry = answers_table.get(key) if isinstance(answers_table, dict) else None
    entry = entry if isinstance(entry, dict) else {}
    if "difficulty" in entry:
        difficulty = value_of(entry["difficulty"])
    else:
        difficulty = difficulty_by_run.get(run, {}).get(task)
    features = {"difficulty": difficulty}
    for name in candidate_names:
        features[name] = value_of(entry[name]) if name in entry else None
    return key, features


# --- the table --------------------------------------------------------------

def _table_cell(value):
    return "-" if value is None else "%.3f" % value


def render_table(candidate_names, outcomes):
    lines = ["outcome\tmodel\tauroc\tdelta"]
    for outcome in ("fix", "parked"):
        fits = outcomes[outcome]
        diff_auroc = fits["difficulty"]
        lines.append("\t".join(
            [outcome, "difficulty", _table_cell(diff_auroc), "-"]))
        for name in candidate_names:
            added_auroc = fits["added"][name]
            delta = (None if added_auroc is None or diff_auroc is None
                     else added_auroc - diff_auroc)
            lines.append("\t".join(
                [outcome, "+" + name, _table_cell(added_auroc),
                 _table_cell(delta)]))
        lines.append("\t".join(
            [outcome, "all", _table_cell(fits["all"]), "-"]))
        for name in candidate_names:
            lines.append("\t".join(
                [outcome, "-" + name, _table_cell(fits["drop"][name]),
                 _table_cell(fits["ablation"][name])]))
    return lines


# --- M7: the proposer (not exercised by the exam) --------------------------

def _sample_tasks(entries, limit=8):
    """Up to `limit` tasks, title+body (body cut at 3000 characters) with
    their `fix`/`parked` labels, read off each run's fetched `plan.md` and
    `events.jsonl` -- the proposer's own sample, not the fit's."""
    import plan_parse  # noqa: E402 (local import: only the proposer needs it)

    sample = []
    for number, directory in entries:
        if directory is None or len(sample) >= limit:
            continue
        plan_path = Path(directory) / PLAN_FILE
        if not plan_path.is_file():
            continue
        try:
            text = plan_path.read_text(encoding="utf-8")
        except OSError:
            continue
        try:
            _result, tasks = plan_parse.parse_plan_full(text)
        except Exception:
            continue
        events_path = Path(directory) / RUN_FILE
        dispatch, parked, _difficulty = (
            read_run_events(events_path) if events_path.is_file()
            else ({}, set(), {}))
        for task in tasks:
            if len(sample) >= limit:
                break
            tid = str(task.get("id"))
            labels = dispatch.get(tid, set())
            fix = 1 if labels & _fix_labels(tid) else 0
            parked_flag = 1 if tid in parked else 0
            sample.append({
                "run": number, "task": tid,
                "title": task.get("title") or "",
                "body": (task.get("body") or "")[:3000],
                "fix": fix, "parked": parked_flag,
            })
    return sample


def _propose_prompt(sample):
    lines = [
        "You are proposing candidate yes/no questions for autoresearch.py,",
        "which fits a small model reading each candidate's held-out AUROC",
        "against two outcomes: `fix` (the task drew a fix/redispatch/fold",
        "reattempt) and `parked` (the task was parked).",
        "",
        "Three seed candidates are already in the list:",
        json.dumps(SEED_CANDIDATES),
        "",
        "Propose up to five MORE yes/no questions about a task's text --",
        "not the three seeds above, and not `difficulty` (reserved).",
        "Answer ONLY a JSON list of entries, each",
        '{"name", "type": "noul", "instructions": {"question", "context"},',
        ' "criteria": {"true": "Yes", "false": "No"}}.',
        "",
        "Sample tasks:",
    ]
    for row in sample:
        lines.append(json.dumps(row))
    return "\n".join(lines)


def _extract_json_list(text):
    """The last complete JSON list in `text` -- `claude -p`'s reply is told
    to be ONLY a JSON list, but a model may preface or fence it (the same
    tolerance the retired A/B judge's `_extract_json` gave a JSON object)."""
    try:
        data = json.loads(text)
        if isinstance(data, list):
            return data
    except ValueError:
        pass
    depth, start, found = 0, None, []
    for i, ch in enumerate(text):
        if ch == "[":
            if depth == 0:
                start = i
            depth += 1
        elif ch == "]" and depth:
            depth -= 1
            if depth == 0 and start is not None:
                try:
                    candidate = json.loads(text[start:i + 1])
                except ValueError:
                    candidate = None
                if isinstance(candidate, list):
                    found.append(candidate)
                start = None
    return found[-1] if found else []


def propose_questions(entries):
    """One `claude -p` proposing up to five more candidates beside the
    three seeds, under an isolated `CLAUDE_CONFIG_DIR` -- M7, not exercised
    by the exam. Never called when `--questions` is given."""
    sample = _sample_tasks(entries)
    prompt = _propose_prompt(sample)
    env = dict(os.environ)
    config_dir = tempfile.mkdtemp(prefix="autoresearch-claude-config-")
    env["CLAUDE_CONFIG_DIR"] = config_dir
    try:
        import ab_auth  # noqa: E402 (beside this file under evals/readings/)
        env = ab_auth.seed_worker_auth(env)
    except SystemExit:
        raise
    except Exception:
        pass
    try:
        proc = subprocess.run(
            ["claude", "-p", prompt, "--output-format", "json",
             "--dangerously-skip-permissions"],
            capture_output=True, text=True, env=env)
    except OSError:
        return list(SEED_CANDIDATES)
    if proc.returncode != 0:
        return list(SEED_CANDIDATES)
    try:
        payload = json.loads(proc.stdout)
    except ValueError:
        return list(SEED_CANDIDATES)
    text = payload.get("result", payload.get("response", proc.stdout)) \
        if isinstance(payload, dict) else proc.stdout
    extra = _extract_json_list(text)
    extra = [e for e in extra if isinstance(e, dict) and "name" in e
            and e.get("name") != RESERVED_CANDIDATE
            and e.get("name") not in {c["name"] for c in SEED_CANDIDATES}]
    return list(SEED_CANDIDATES) + extra


# --- M7: the Jev fan-out (not exercised by the exam) ------------------------

_NODE_PROGRAM = """
import { makeJevClient } from %r;
const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
const client = makeJevClient({
  baseUrl: input.baseUrl,
  fetchImpl: (url, opts) => fetch(url, {
    ...opts,
    headers: { ...(opts && opts.headers), authorization:
      'Bearer ' + process.env.TYPESAFE_API_KEY },
  }),
});
client.ask({ state: input.state, questions: input.questions }).then((answers) => {
  process.stdout.write(JSON.stringify(answers));
});
"""


def _typesafe_key():
    """The bearer, read the way `factory/replay/replay_landing.py`'s `key()`
    reads it -- never passed in argv, only in the child's environment."""
    env_path = Path(os.path.expanduser("~/.ultrapowers/typesafe.env"))
    if not env_path.is_file():
        return None
    pairs = dict(line.strip().split("=", 1)
                for line in env_path.read_text(encoding="utf-8").splitlines()
                if "=" in line)
    return pairs.get("TYPESAFE_API_KEY")


def _ask_jev(jev_client_path, base_url, state, questions, api_key):
    """One task's answers over one `node` child, or `None` on any refusal --
    the bearer rides the child's environment, never its argv."""
    env = dict(os.environ)
    env["TYPESAFE_API_KEY"] = api_key or ""
    program = _NODE_PROGRAM % (str(jev_client_path.as_uri()),)
    try:
        proc = subprocess.run(
            ["node", "--input-type=module", "-e", program],
            input=json.dumps({"baseUrl": base_url, "state": state,
                              "questions": questions}),
            capture_output=True, text=True, env=env, timeout=30)
    except (OSError, subprocess.TimeoutExpired):
        return None
    if proc.returncode != 0 or not proc.stdout.strip():
        return None
    try:
        answers = json.loads(proc.stdout)
    except ValueError:
        return None
    return answers if isinstance(answers, dict) else None


def fetch_answers(entries, candidate_names, questions_entries, base_url=
                  "https://api.typesafe.ai"):
    """One `node` child per task, asking Jev the candidates over that
    task's `{"task": {"title", "body"}}` state -- M7, not exercised by the
    exam. Never called when `--answers` is given. A task the fan-out
    cannot answer is simply absent from the returned table (dropped, and
    counted, by the caller)."""
    jev_client_path = Path(__file__).resolve().parents[2] / "factory" / \
        "jev-client.mjs"
    api_key = _typesafe_key()
    questions_by_name = {q["name"]: {k: v for k, v in q.items()
                                     if k != "name"}
                         for q in questions_entries}
    import plan_parse  # noqa: E402

    answers = {}
    for number, directory in entries:
        if directory is None:
            continue
        plan_path = Path(directory) / PLAN_FILE
        if not plan_path.is_file():
            continue
        try:
            text = plan_path.read_text(encoding="utf-8")
            _result, tasks = plan_parse.parse_plan_full(text)
        except Exception:
            continue
        for task in tasks:
            tid = str(task.get("id"))
            state = {"task": {"title": task.get("title") or "",
                              "body": task.get("body") or ""}}
            reply = _ask_jev(jev_client_path, base_url, state,
                             questions_by_name, api_key)
            if reply is None:
                continue
            answers["%d:%s" % (number, tid)] = {
                name: reply[name] for name in candidate_names if name in reply
            }
    return answers


# --- CLI --------------------------------------------------------------------

def main(argv=None):
    parser = argparse.ArgumentParser(
        prog="autoresearch.py",
        description="Fit `difficulty` plus candidate questions against "
                    "held-out fix/parked outcomes, over a directory of "
                    "tagged runs.")
    parser.add_argument("paths", nargs="*", metavar="DIR",
                        help="a directory holding run-<N>/events.jsonl, or "
                             "a tree containing them")
    parser.add_argument("--fetch", metavar="OWNER/REPO",
                        help="pull the runs (and their plans) off this "
                             "repository's evidence/plan tags into --into")
    parser.add_argument("--runs", metavar="A..B",
                        help="the inclusive run range to fetch")
    parser.add_argument("--into", metavar="DIR",
                        help="where --fetch writes the runs it reads")
    parser.add_argument("--gh", default="gh", metavar="BIN",
                        help="the gh binary (or command) to run; default `gh`")
    parser.add_argument("--questions", metavar="FILE",
                        help="the candidate-questions JSON file; without "
                             "it, one claude -p proposes candidates")
    parser.add_argument("--answers", metavar="FILE",
                        help="the recorded answer table; without it, one "
                             "node child per task asks Jev")
    parser.add_argument("--out", metavar="FILE",
                        help="where the JSON report is written")
    parser.add_argument("--propose-only", action="store_true",
                        help="print the proposed questions list and exit, "
                             "without fetching answers or fitting anything")
    args = parser.parse_args(argv)

    if args.fetch:
        bounds = _fetch_bounds(args.runs, args.into)
        if bounds is None:
            return 2
        first, last = bounds
        written = set(fetch_runs(args.fetch, first, last, args.into, args.gh))
        into = Path(args.into)
        entries = [(number,
                   into / ("run-%d" % number) if number in written else None)
                  for number in range(first, last + 1)]
    else:
        if not args.paths:
            return die("give a PATH, or --fetch <owner>/<repo> with --runs "
                       "<A>..<B> and --into <dir>")
        entries = sorted(find_run_dirs(args.paths).items())

    if args.propose_only:
        proposed = propose_questions(entries)
        print(json.dumps(proposed))
        return 0

    runs_read, dispatch_by_run, parked_by_run, difficulty_by_run = \
        read_runs(entries)
    if not runs_read:
        return die("no run-<N>/events.jsonl found under the given paths")

    if args.questions:
        qdata, err = load_json_file(args.questions, "--questions")
        if err:
            return die(err)
        candidate_names, err = validate_questions(qdata)
        if err:
            return die(err)
        questions_entries = qdata
    else:
        questions_entries = propose_questions(entries)
        candidate_names, err = validate_questions(questions_entries)
        if err:
            return die(err)

    if args.answers:
        adata, err = load_json_file(args.answers, "--answers")
        if err:
            return die(err)
        if not isinstance(adata, dict):
            return die("--answers must be a JSON object")
        answers_table = adata
    else:
        answers_table = fetch_answers(entries, candidate_names,
                                      questions_entries)

    order = ordered_tasks(runs_read, dispatch_by_run)
    order_keys = ["%d:%s" % (run, task) for run, task in order]
    train_keys = [k for i, k in enumerate(order_keys) if i % 2 == 0]
    held_keys_all = [k for i, k in enumerate(order_keys) if i % 2 == 1]

    labels = {}
    features_by_task = {}
    for run, task in order:
        key, features = task_features(run, task, difficulty_by_run,
                                      answers_table, candidate_names)
        dispatch_labels = dispatch_by_run.get(run, {}).get(task, set())
        fix = 1 if dispatch_labels & _fix_labels(task) else 0
        parked = 1 if task in parked_by_run.get(run, set()) else 0
        labels[key] = {"fix": fix, "parked": parked}
        features_by_task[key] = features

    usable_keys = {
        key for key, features in features_by_task.items()
        if features["difficulty"] is not None
        and all(features[name] is not None for name in candidate_names)
    }
    dropped = len(order_keys) - len(usable_keys)
    usable_train = [k for k in train_keys if k in usable_keys]
    usable_held = [k for k in held_keys_all if k in usable_keys]

    outcomes = {}
    for outcome in ("fix", "parked"):
        outcomes[outcome] = outcome_fits(outcome, candidate_names,
                                         usable_train, usable_held,
                                         features_by_task, labels)

    for line in render_table(candidate_names, outcomes):
        print(line)

    fix_positives = sum(1 for v in labels.values() if v["fix"] == 1)
    parked_positives = sum(1 for v in labels.values() if v["parked"] == 1)
    print("tasks: n=%d train=%d held_out=%d fix=%d parked=%d dropped=%d" % (
        len(order_keys), len(train_keys), len(held_keys_all),
        fix_positives, parked_positives, dropped))

    if args.out:
        answers_out = {}
        for key, features in features_by_task.items():
            row = {}
            if features["difficulty"] is not None:
                row["difficulty"] = round4(features["difficulty"])
            for name in candidate_names:
                if features[name] is not None:
                    row[name] = round4(features[name])
            answers_out[key] = row

        outcomes_out = {
            outcome: {
                "difficulty": round4(fits["difficulty"]),
                "added": {name: round4(v)
                          for name, v in fits["added"].items()},
                "all": round4(fits["all"]),
                "ablation": {name: round4(v)
                            for name, v in fits["ablation"].items()},
            }
            for outcome, fits in outcomes.items()
        }

        out_obj = {
            "runs": runs_read,
            "tasks": {"n": len(order_keys), "train": len(train_keys),
                     "held_out": len(held_keys_all), "dropped": dropped},
            "questions": list(candidate_names),
            "answers": answers_out,
            "labels": labels,
            "split": {"held_out": held_keys_all},
            "outcomes": outcomes_out,
        }
        Path(args.out).write_text(json.dumps(out_obj, indent=2) + "\n",
                                  encoding="utf-8")

    return 0


if __name__ == "__main__":
    sys.exit(main())
