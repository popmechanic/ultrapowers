"""tests/test_autoresearch.py -- the exam for `autoresearch.py`: one command
over a directory of tagged runs, a candidate-questions file and a recorded
answer table, that reports held-out AUROC per candidate question.

Written against the task's Machine clauses, leg by leg. Every assertion names
the leg and the clause it comes from, so a reader can map this file back to
the contract. Driven as a subprocess, the way `tests/test_jev_census.py`
drives its script (`run_auto()` asserts the script exists before spawning it,
so an absent script reds on that assertion rather than a look-alike exit
code).

# Task: "autoresearch.py reads the tagged runs, fits the small model, and
# reports held-out AUROC per candidate question" -- legs (a)-(f), the forty-
# task fixture the Context itself specifies, built here from the same
# formulas so the exam ships no hand-written fixture for a file the script
# itself would otherwise write.

  * (a) [M1, M7] exit 0, the last stdout line byte-exact
      `tasks: n=40 train=20 held_out=20 fix=16 parked=5 dropped=0`, and the
      JSON's `labels` counting 16 `fix` and 5 `parked` positives. M7 is a
      shape clause with no leg of its own (Proof); it is not exercised here.
  * (b) [M2] the JSON's `outcomes.fix` five named AUROCs, rounded to two
      places, equal the frozen figures.
  * (c) [M3] the JSON's `outcomes.fix.ablation` three values, rounded to two
      places, equal the frozen figures, and every AUROC under
      `outcomes.parked` is a number, in the same key shape as `outcomes.fix`.
  * (d) [M4] the first stdout line, byte-exact, and the JSON's sorted
      top-level keys.
  * (e) [M5] with `node`, `claude` and `gh` stubs -- each marking a file and
      exiting 1 -- leading `PATH`, the same command still exits 0 and no
      marker exists.
  * (f) [M6] `--answers` naming an absent file exits 2 with exactly one
      stderr line beginning `autoresearch:` and writes no `--out` file.

Two things this exam assumes about the code under test, since the task fixes
the CLI's output and the JSON's shape but not the script's internals: that a
directory holding `run-<N>/events.jsonl` is found when handed to the script
as a positional PATH one level up (the exact shape the task's own fixture
uses, and the shape `jev_census.py`'s sibling script uses), and that
`--questions`/`--answers`/`--out` take a single following argument each (the
ordinary `argparse` convention every sibling script in this tree uses). No
env var but `PATH` is read (leg (e) only); every other leg runs with the
ambient environment untouched.
"""
import json
import os
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "evals/readings/autoresearch.py"

TABLE_HEADER = "outcome\tmodel\tauroc\tdelta"
LAST_LINE = "tasks: n=40 train=20 held_out=20 fix=16 parked=5 dropped=0"

TOP_LEVEL_KEYS = ["answers", "labels", "outcomes", "questions", "runs",
                  "split", "tasks"]

CANDIDATES = ("planted", "noise_a", "noise_b")


# --- driving the script ------------------------------------------------------

def run_auto(*args, env=None):
    """The script, as a subprocess. Asserts it exists first, so every leg
    below reds on an absent implementation rather than a look-alike exit
    code."""
    assert SCRIPT.is_file(), (
        "the autoresearch script does not exist yet: %s" % SCRIPT)
    return subprocess.run([sys.executable, str(SCRIPT), *args],
                          capture_output=True, text=True, env=env)


def lines(text):
    return text.splitlines()


def stderr_lines(proc):
    return [line for line in lines(proc.stderr) if line.strip()]


# --- the Context's own forty-task fixture, built from its formulas ----------

def task_facts(i):
    """One of the forty tasks (`i` in 0..39), exactly the Context's
    formulas."""
    run = i // 4 + 1
    task = str(i % 4 + 1)
    fix = 1 if (i * 7) % 10 < 4 else 0
    parked = 1 if (i * 5) % 9 == 0 else 0
    difficulty = round(((i * 29) % 4) * 0.5 + 0.6 * fix + ((i * 11) % 5) / 10,
                       2)
    planted = round((0.7 if fix else 0.3) + ((i * 13) % 7 - 3) * 0.1, 2)
    noise_a = round(((i * 3) % 8) / 7, 2)
    noise_b = round(((i * 4) % 7) / 6, 2)
    return {"i": i, "run": run, "task": task, "fix": fix, "parked": parked,
           "difficulty": difficulty, "planted": planted,
           "noise_a": noise_a, "noise_b": noise_b}


ALL_TASKS = [task_facts(i) for i in range(40)]

# The frozen counts the Context asserts over this fixture -- also asserted
# about the exam's own arithmetic here, so a slip in `task_facts` reds loudly
# rather than silently changing what leg (a) expects.
assert sum(t["fix"] for t in ALL_TASKS) == 16
assert sum(t["parked"] for t in ALL_TASKS) == 5


def task_rows(t):
    """`run-<N>/events.jsonl`'s rows for one task, in the Context's own
    order and shapes."""
    ts = "2026-09-22T00:00:00.000Z"
    rows = [
        {"ts": ts, "kind": "jev", "site": "task", "task": t["task"],
         "label": None, "keys": ["difficulty"],
         "values": {"difficulty": {"type": "score",
                                   "score": t["difficulty"]}},
         "state_bytes": 0, "ms": 0, "answered": True},
        {"ts": ts, "kind": "dispatch:start", "task": t["task"],
         "label": "impl:%s:0" % t["task"], "role": "implement"},
    ]
    if t["fix"]:
        rows.append({"ts": ts, "kind": "dispatch:start", "task": t["task"],
                     "label": "fix:%s" % t["task"], "role": "implement"})
    if t["parked"]:
        rows.append({"ts": ts, "kind": "parked", "task": t["task"],
                     "reason": "fixture"})
    return rows


def build_fixture(root):
    """The ten `run-<N>/events.jsonl` files, four tasks each, in
    run-then-task order."""
    root.mkdir(parents=True)
    by_run = {}
    for t in ALL_TASKS:
        by_run.setdefault(t["run"], []).append(t)
    for run, tasks in sorted(by_run.items()):
        run_dir = root / ("run-%d" % run)
        run_dir.mkdir()
        with (run_dir / "events.jsonl").open("w", encoding="utf-8") as fh:
            for t in tasks:
                for row in task_rows(t):
                    fh.write(json.dumps(row) + "\n")
    return root


def build_questions(path):
    """`<Q>`: the three candidates, in the Context's own entry shape plus
    `name`, `planted` then `noise_a` then `noise_b`."""
    entries = []
    for name in CANDIDATES:
        entries.append({
            "name": name,
            "type": "noul",
            "instructions": {"question": "Does %s hold for this task?" % name,
                             "context": "fixture candidate %s" % name},
            "criteria": {"true": "Yes", "false": "No"},
        })
    path.write_text(json.dumps(entries))


def build_answers(path):
    """`<A>`: `{"<run>:<task>": {"planted": ..., "noise_a": ..., "noise_b":
    ...}}` for all forty keys, each a `noul` answer."""
    answers = {}
    for t in ALL_TASKS:
        key = "%d:%s" % (t["run"], t["task"])
        answers[key] = {name: {"type": "noul", "noul": t[name]}
                        for name in CANDIDATES}
    path.write_text(json.dumps(answers))


def build_case(tmp_path, name="fx"):
    """A fresh fixture root, questions file, answers file and (unwritten)
    `--out` path, all under `tmp_path` -- nothing shared between legs, or
    between xdist workers."""
    root = tmp_path / (name + "-runs")
    build_fixture(root)
    questions = tmp_path / (name + "-questions.json")
    build_questions(questions)
    answers = tmp_path / (name + "-answers.json")
    build_answers(answers)
    out = tmp_path / (name + "-out.json")
    return root, questions, answers, out


def key_shape(node):
    """A dict's keys, recursively, with every leaf collapsed to None -- so
    two dicts compare equal here exactly when they carry the same keys at
    every level, regardless of the numbers underneath."""
    if isinstance(node, dict):
        return {k: key_shape(v) for k, v in node.items()}
    return None


def all_numbers(node):
    """True when every leaf under `node` is an int or float (not a bool, not
    `None`)."""
    if isinstance(node, dict):
        return all(all_numbers(v) for v in node.values())
    return isinstance(node, (int, float)) and not isinstance(node, bool)


# ------------------------------------------------------------------- leg (a)

def test_leg_a_tasks_line_and_label_counts(tmp_path):
    """(a) [M1, M7]: over the forty-task fixture, `main` exits 0 and its last
    stdout line is byte-exact `tasks: n=40 train=20 held_out=20 fix=16
    parked=5 dropped=0`; the JSON's `labels` map counts the same 16 `fix` and
    5 `parked` positives the stdout line claims. M7 (the fetch/proposer/
    fan-out shape) carries no leg of its own and is not exercised here."""
    root, questions, answers, out = build_case(tmp_path)
    proc = run_auto(str(root), "--questions", str(questions),
                    "--answers", str(answers), "--out", str(out))
    assert proc.returncode == 0, (
        "(a) [M1] a readable fixture exits 0: " + proc.stdout + proc.stderr)
    assert lines(proc.stdout)[-1] == LAST_LINE, "(a) [M1] " + proc.stdout
    assert out.is_file(), "(a) [M1] --out is written on success"
    data = json.loads(out.read_text())
    labels = data["labels"]
    fix_positives = sum(1 for v in labels.values() if v["fix"] == 1)
    parked_positives = sum(1 for v in labels.values() if v["parked"] == 1)
    assert fix_positives == 16, "(a) [M1] " + json.dumps(labels)
    assert parked_positives == 5, "(a) [M1] " + json.dumps(labels)


# ------------------------------------------------------------------- leg (b)

def test_leg_b_fix_outcome_frozen_aurocs(tmp_path):
    """(b) [M2]: `outcomes.fix.difficulty`, `.added.planted`,
    `.added.noise_a`, `.added.noise_b` and `.all`, each rounded to two
    places, equal the Context's frozen figures `0.77`, `0.98`, `0.78`,
    `0.77`, `0.98`."""
    root, questions, answers, out = build_case(tmp_path, name="fxb")
    proc = run_auto(str(root), "--questions", str(questions),
                    "--answers", str(answers), "--out", str(out))
    assert proc.returncode == 0, proc.stdout + proc.stderr
    fix = json.loads(out.read_text())["outcomes"]["fix"]
    assert round(fix["difficulty"], 2) == 0.77, "(b) [M2] " + json.dumps(fix)
    assert round(fix["added"]["planted"], 2) == 0.98, (
        "(b) [M2] " + json.dumps(fix))
    assert round(fix["added"]["noise_a"], 2) == 0.78, (
        "(b) [M2] " + json.dumps(fix))
    assert round(fix["added"]["noise_b"], 2) == 0.77, (
        "(b) [M2] " + json.dumps(fix))
    assert round(fix["all"], 2) == 0.98, "(b) [M2] " + json.dumps(fix)


# ------------------------------------------------------------------- leg (c)

def test_leg_c_fix_ablation_and_parked_shape(tmp_path):
    """(c) [M3]: `outcomes.fix.ablation` `planted`, `noise_a` and `noise_b`,
    rounded to two places, equal the frozen `0.18`, `0.0`, `0.0`; and
    `outcomes.parked` carries the same keys, at every level, as
    `outcomes.fix`, with every AUROC under it a number (never `null`)."""
    root, questions, answers, out = build_case(tmp_path, name="fxc")
    proc = run_auto(str(root), "--questions", str(questions),
                    "--answers", str(answers), "--out", str(out))
    assert proc.returncode == 0, proc.stdout + proc.stderr
    outcomes = json.loads(out.read_text())["outcomes"]
    ablation = outcomes["fix"]["ablation"]
    assert round(ablation["planted"], 2) == 0.18, (
        "(c) [M3] " + json.dumps(ablation))
    assert round(ablation["noise_a"], 2) == 0.0, (
        "(c) [M3] " + json.dumps(ablation))
    assert round(ablation["noise_b"], 2) == 0.0, (
        "(c) [M3] " + json.dumps(ablation))
    assert key_shape(outcomes["parked"]) == key_shape(outcomes["fix"]), (
        "(c) [M3] outcomes.parked carries the same keys as outcomes.fix: "
        + json.dumps(outcomes))
    assert all_numbers(outcomes["parked"]), (
        "(c) [M3] every AUROC under outcomes.parked is a number: "
        + json.dumps(outcomes["parked"]))


# ------------------------------------------------------------------- leg (d)

def test_leg_d_table_header_and_json_top_level_keys(tmp_path):
    """(d) [M4]: the first stdout line is exactly `outcome<TAB>model<TAB>
    auroc<TAB>delta`, and `<OUT>`'s top-level keys, sorted, are exactly
    `answers`, `labels`, `outcomes`, `questions`, `runs`, `split`, `tasks`."""
    root, questions, answers, out = build_case(tmp_path, name="fxd")
    proc = run_auto(str(root), "--questions", str(questions),
                    "--answers", str(answers), "--out", str(out))
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert lines(proc.stdout)[0] == TABLE_HEADER, "(d) [M4] " + proc.stdout
    data = json.loads(out.read_text())
    assert sorted(data.keys()) == TOP_LEVEL_KEYS, (
        "(d) [M4] " + json.dumps(sorted(data.keys())))


# ------------------------------------------------------------------- leg (e)

def build_marker_stub(bindir, marker_dir, name):
    """An executable `name` on `PATH` that marks its own invocation and
    fails, so a spurious spawn is both visible and harmless."""
    script = bindir / name
    script.write_text(
        "#!/bin/sh\n"
        "touch \"%s/spawned-%s\"\n"
        "exit 1\n" % (marker_dir, name))
    script.chmod(0o755)
    return script


def test_leg_e_no_node_claude_or_gh_spawned_under_questions_and_answers(
       tmp_path):
    """(e) [M5]: with `PATH` led by a directory holding executable `node`,
    `claude` and `gh` scripts that each write a marker file, running under
    `--questions` and `--answers` still exits 0 and leaves every marker
    unwritten -- none of the three is spawned."""
    root, questions, answers, out = build_case(tmp_path, name="fxe")
    bindir = tmp_path / "stubbin"
    bindir.mkdir()
    for name in ("node", "claude", "gh"):
        build_marker_stub(bindir, tmp_path, name)
    env = dict(os.environ)
    env["PATH"] = str(bindir) + os.pathsep + env.get("PATH", "")
    proc = run_auto(str(root), "--questions", str(questions),
                    "--answers", str(answers), "--out", str(out), env=env)
    assert proc.returncode == 0, (
        "(e) [M5] exits 0 under the stub PATH: " + proc.stdout + proc.stderr)
    for name in ("node", "claude", "gh"):
        marker = tmp_path / ("spawned-%s" % name)
        assert not marker.exists(), (
            "(e) [M5] `%s` was spawned under --questions/--answers" % name)


# ------------------------------------------------------------------- leg (f)

def test_leg_f_missing_answers_file_exits_2_and_writes_no_out(tmp_path):
    """(f) [M6]: `--answers` naming a file that does not exist exits 2 with
    exactly one stderr line beginning `autoresearch:`, and `<OUT>` is not
    written."""
    root, questions, _answers, out = build_case(tmp_path, name="fxf")
    absent = tmp_path / "fxf-absent-answers.json"
    assert not absent.exists()
    proc = run_auto(str(root), "--questions", str(questions),
                    "--answers", str(absent), "--out", str(out))
    assert proc.returncode == 2, (
        "(f) [M6] a missing --answers file exits 2, got "
        f"{proc.returncode}: {proc.stdout + proc.stderr}")
    err_lines = stderr_lines(proc)
    assert len(err_lines) == 1, (
        "(f) [M6] exactly one stderr line: " + repr(proc.stderr))
    assert err_lines[0].startswith("autoresearch:"), (
        "(f) [M6] stderr begins `autoresearch:`: " + repr(proc.stderr))
    assert not out.exists(), "(f) [M6] no --out file is written on refusal"
