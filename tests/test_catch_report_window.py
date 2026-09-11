"""The counter's window starts when the test lands, and runners are never
candidates (first ratchet, task 2 — re-driven after runs 98 and 99).

One test per leg, each naming its clause:
  (a) [M1] `catch_counter.py` stamps each row with the run's `startedAt`, or
      null when the status page or the key is absent; three run directories
      with three distinct run ids yield three rows;
  (b) [M2] a row counts toward a test's window only when it started after the
      test's adding commit landed (committer date, not author date); an
      untracked test lands at the epoch; an unstamped row counts toward nothing
      and makes the report close with the recount note, after the curve without
      `--n` and after the listing with it; with every row stamped no such line
      exists anywhere;
  (c) [M3] two rows with one `runId`: the later one is read, the earlier
      contributes nothing;
  (d) [M4] a file carrying `# catch-counter: runner` has status `runner`, sits
      on no curve point and in no `--n` listing; the bridge carries exactly one
      such line;
  (e) [M5] the skill's counter section says the three things, in operative
      phrases, and a copy with the landing sentence removed fails.
"""
import importlib.util
import json
import os
import re
import subprocess
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
SCRIPTS = REPO / "skills/ultralearn/scripts"
COUNTER = SCRIPTS / "catch_counter.py"
REPORT = SCRIPTS / "catch_report.py"
SKILL = REPO / "skills/ultralearn/SKILL.md"
NOTE_RE = re.compile(r"^\d+ row\(s\) carry no startedAt — recount them$")


def _load(path):
    spec = importlib.util.spec_from_file_location(path.stem, path)
    mod = importlib.util.module_from_spec(spec)
    sys.path.insert(0, str(SCRIPTS))
    spec.loader.exec_module(mod)
    return mod


def git(repo, *args, env=None):
    p = subprocess.run(["git", "-C", str(repo), *args], capture_output=True,
                       text=True, env={**os.environ, **(env or {})})
    assert p.returncode == 0, "git %s: %s" % (" ".join(args), p.stderr)
    return p.stdout


# --- fixtures ---------------------------------------------------------------

def run_dir(root, name, run_id, status):
    """A run directory with one green driver run naming tests/test_a.py."""
    d = root / name
    d.mkdir(parents=True)
    events = [{"kind": "run:open", "runId": run_id},
              {"kind": "driver:proof-run", "task": "1", "exit": 0,
               "cmd": "python3 -m pytest -q tests/test_a.py"}]
    (d / "events.jsonl").write_text("".join(json.dumps(e) + "\n" for e in events))
    (d / "report.json").write_text(json.dumps({"tasks": []}))
    (d / "receipt.json").write_text(json.dumps(
        {"tasks": [{"task": "1", "writes": ["lib/a.py"]}]}))
    if status is not None:
        (d / "status.json").write_text(json.dumps(status))
    return d


def row(run_id, started, touched, exercises, catches=None):
    return {"kind": "catch-count", "id": run_id, "runId": run_id,
            "startedAt": started, "driverRuns": 1, "catches": catches or {},
            "reds": [], "touched": touched, "exercises": exercises}


def ledger(tmp_path, rows):
    path = tmp_path / "ledger.jsonl"
    path.write_text("".join(json.dumps(r) + "\n" for r in rows))
    return path


def report(ledger_path, tree, n=None):
    argv = [sys.executable, str(REPORT), "--ledger", str(ledger_path),
            "--tree", str(tree)]
    if n is not None:
        argv += ["--n", str(n)]
    p = subprocess.run(argv, capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    return p.stdout.splitlines()


@pytest.fixture
def tree(tmp_path):
    """A git tree: tests/test_a.py committed with committer date 2026-09-05
    and author date 2026-09-01; tests/test_b.py untracked."""
    t = tmp_path / "tree"
    (t / "tests").mkdir(parents=True)
    git(t, "init", "-q")
    git(t, "config", "user.email", "w@example.com")
    git(t, "config", "user.name", "Window")
    (t / "tests/test_a.py").write_text("def test_a(): pass\n")
    git(t, "add", "tests/test_a.py")
    git(t, "commit", "-q", "-m", "a lands",
        env={"GIT_AUTHOR_DATE": "2026-09-01T00:00:00+00:00",
             "GIT_COMMITTER_DATE": "2026-09-05T12:00:00+00:00"})
    (t / "tests/test_b.py").write_text("def test_b(): pass\n")
    return t


A = "tests/test_a.py"
B = "tests/test_b.py"
EX_A = {A: ["lib/a.py"]}
EX_B = {B: ["lib/b.py"]}


# --- (a) [M1] --------------------------------------------------------------

def test_leg_a_rows_carry_started_at_or_null(tmp_path):
    root = tmp_path / "runs"
    run_dir(root, "r1", "run-1", {"startedAt": "2026-09-10T16:28:26Z"})
    run_dir(root, "r2", "run-2", None)
    run_dir(root, "r3", "run-3", {})
    led = tmp_path / "led.jsonl"
    p = subprocess.run([sys.executable, str(COUNTER), str(root), "--ledger", str(led)],
                       capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    rows = {json.loads(l)["runId"]: json.loads(l) for l in led.read_text().splitlines()}
    assert set(rows) == {"run-1", "run-2", "run-3"}, "leg (a) [M1]: three rows"
    assert rows["run-1"]["startedAt"] == "2026-09-10T16:28:26Z"
    assert rows["run-2"]["startedAt"] is None, "no status.json → null"
    assert rows["run-3"]["startedAt"] is None, "no startedAt key → null"


# --- (b) [M2] --------------------------------------------------------------

def test_leg_b_window_opens_at_the_committer_date(tmp_path, tree):
    mod = _load(REPORT)
    tests = mod.tree_test_files(tree)
    landings = mod.tree_landings(tree, tests)
    early = row("r-early", "2026-09-04T00:00:00Z", ["lib/a.py", "lib/b.py"], {**EX_A, **EX_B})
    late = row("r-late", "2026-09-06T00:00:00Z", ["lib/a.py"], EX_A)
    blank = row("r-blank", None, ["lib/a.py"], EX_A)
    table = mod.catch_table([early], tests, landings=landings)
    assert table[A]["touchingRuns"] == 0, "leg (b) [M2]: 09-04 is before the 09-05 committer date (author date 09-01 must not count)"
    assert table[B]["touchingRuns"] == 1, "leg (b) [M2]: an untracked test lands at the epoch"
    assert mod.catch_table([late], tests, landings=landings)[A]["touchingRuns"] == 1
    assert mod.catch_table([blank], tests, landings=landings)[A]["touchingRuns"] == 0, \
        "leg (b) [M2]: an unstamped row counts toward no window"


def test_leg_b_unstamped_rows_close_the_report_with_the_note(tmp_path, tree):
    # The 09-04 row touches both: test_a's window has not opened (it landed
    # 09-05) but untracked test_b's has (epoch), so the --n listing names it.
    led = ledger(tmp_path, [row("r-early", "2026-09-04T00:00:00Z", ["lib/a.py", "lib/b.py"], {**EX_A, **EX_B}),
                            row("r-blank", None, ["lib/a.py"], EX_A)])
    plain = report(led, tree)
    assert NOTE_RE.match(plain[-1]) and plain[-1].startswith("1 row(s)"), plain
    assert plain[-2].startswith("max touching runs:"), plain
    with_n = report(led, tree, n=1)
    assert NOTE_RE.match(with_n[-1]) and with_n[-1].startswith("1 row(s)"), with_n
    heading = with_n.index("## Zero catches over 1 runs")
    listing = with_n[heading + 1:-1]
    assert listing and with_n[-2] == listing[-1], \
        "leg (b) [M2]: under --n the line before the note is the listing's last entry:\n" + "\n".join(with_n)


def test_leg_b_every_row_stamped_prints_no_note(tmp_path, tree):
    led = ledger(tmp_path, [row("r-early", "2026-09-04T00:00:00Z", ["lib/a.py"], EX_A),
                            row("r-late", "2026-09-06T00:00:00Z", ["lib/a.py"], EX_A)])
    plain = report(led, tree)
    assert not any("carry no startedAt" in l for l in plain), plain
    assert plain[-1].startswith("max touching runs:"), plain
    with_n = report(led, tree, n=1)
    assert not any("carry no startedAt" in l for l in with_n), with_n
    heading = with_n.index("## Zero catches over 1 runs")
    assert with_n[-1] == with_n[heading + 1:][-1], "leg (b) [M2]: with --n the listing ends the report"


# --- (c) [M3] --------------------------------------------------------------

def test_leg_c_last_row_per_run_wins(tree):
    mod = _load(REPORT)
    tests = mod.tree_test_files(tree)
    first = row("run-7", "2026-09-06T00:00:00Z", ["lib/a.py"], EX_A)
    second = row("run-7", "2026-09-06T00:00:00Z", [], EX_A)
    landings = mod.tree_landings(tree, tests)
    assert mod.catch_table([first, second], tests, landings=landings)[A]["touchingRuns"] == 0, \
        "leg (c) [M3]: the later row (touching nothing) is the one read"
    assert mod.catch_table([second, first], tests, landings=landings)[A]["touchingRuns"] == 1, \
        "leg (c) [M3]: reversed, the touching row is last and counts"


# --- (d) [M4] --------------------------------------------------------------

def test_leg_d_a_runner_is_never_a_candidate(tmp_path, tree):
    (tree / "tests/test_bridge.py").write_text("# catch-counter: runner\nimport glob\n")
    ex = {"tests/test_bridge.py": ["lib/a.py"], B: ["lib/a.py"]}
    led = ledger(tmp_path, [row("r1", "2026-09-06T00:00:00Z", ["lib/a.py"], ex)])
    mod = _load(REPORT)
    tests = mod.tree_test_files(tree)
    table = mod.catch_table(mod._read_jsonl(led), tests,
                            landings=mod.tree_landings(tree, tests),
                            runners=mod.tree_runners(tree, tests))
    assert table["tests/test_bridge.py"]["status"] == "runner"
    assert table[B]["status"] == "zero"
    curve = mod.zero_curve(table)
    assert curve and curve[0] == {"n": 1, "files": 1}, "leg (d) [M4]: the sibling counts, the runner does not: %r" % curve
    with_n = report(led, tree, n=1)
    heading = with_n.index("## Zero catches over 1 runs")
    assert B in with_n[heading + 1:] and "tests/test_bridge.py" not in with_n[heading + 1:]


def test_leg_d_the_fleet_suite_bridge_carries_the_marker():
    lines = (REPO / "tests/test_fleet_suite.py").read_text().splitlines()
    assert sum(1 for l in lines if l == "# catch-counter: runner") == 1, \
        "leg (d) [M4]: exactly one runner marker line in the bridge"


# --- (e) [M5] --------------------------------------------------------------

def _counter_section(text):
    lines = text.splitlines()
    start = next(i for i, l in enumerate(lines) if l.startswith("## ") and "catch counter" in l.lower())
    end = next((i for i in range(start + 1, len(lines)) if lines[i].startswith("## ")), len(lines))
    return " ".join(lines[start:end])


def _checks(section):
    return (re.search(r"started after the test landed", section) is not None,
            re.search(r"last row per run.*recount", section) is not None,
            re.search(r"# catch-counter: runner.*never a candidate", section) is not None)


def test_leg_e_the_skill_says_the_three_things():
    section = _counter_section(SKILL.read_text())
    assert _checks(section) == (True, True, True), "leg (e) [M5]: %r" % (_checks(section),)


def test_leg_e_removing_the_landing_sentence_fails_the_first_check():
    text = SKILL.read_text()
    sentence = next(s for s in re.split(r"(?<=\.)\s", text) if "started after the test landed" in s)
    section = _counter_section(text.replace(sentence, ""))
    assert _checks(section)[0] is False, "leg (e) [M5]: the control must fail"
