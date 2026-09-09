"""Exam for task 2 — the report emits the table, the curve and the deletion input.

Every assertion below names the Proof leg (a)–(j) and the Machine clause it
comes from, so the file reads back against the contract rather than against any
one implementation.

The three `catch-count` rows are the ones the Proof pins verbatim in leg (a);
the findings row of leg (d) is the shape `merge_ledger.py` writes (no `kind`).
The pinned strings — the table header, `N=<n>: <c> file(s)`, `max touching
runs: <max>`, `## Zero-catch curve`, `## Zero catches over <N> runs` — are
compared verbatim, because M5 pins them verbatim.

`skills/ultralearn/scripts/catch_report.py` is this task's deliverable, so at
BASE every test here is red for that one reason: `_module()` says the script
does not exist yet rather than letting the absence surface as a stray import
error.
"""
import importlib.util
import json
import re
import subprocess
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = REPO / "skills/ultralearn/scripts"
SCRIPT = SCRIPTS_DIR / "catch_report.py"

# The scripts directory on the path, as the rest of the suite does it, so a
# script that does `from _outcome import swallow` imports here as it runs.
sys.path.insert(0, str(SCRIPTS_DIR))

# M5: the header row, verbatim.
HEADER = "| test | catches | touching runs | status |"
CURVE_HEADING = "## Zero-catch curve"


def _module():
    """Import the deliverable; name it when it is not there yet."""
    assert SCRIPT.is_file(), (
        "%s is a deliverable of this task and does not exist"
        % SCRIPT.relative_to(REPO))
    spec = importlib.util.spec_from_file_location("catch_report", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# --------------------------------------------------------------- the rows

def _row(row_id, run_id, catches, touched, exercises):
    """One `catch-count` row in the shape the record spells (task Context)."""
    return {
        "kind": "catch-count",
        "id": row_id,
        "runId": run_id,
        "driverRuns": 3,
        "catches": catches,
        "reds": [],
        "touched": touched,
        "exercises": exercises,
    }


# leg (a): run A, run B, run C — verbatim from the Proof.
ROW_A = _row("a" * 16, "run-a", {"tests/test_a.py": 1}, ["lib/a.py"],
             {"tests/test_a.py": ["lib/a.py"],
              "tests/test_b.py": ["lib/b.py"]})
ROW_B = _row("b" * 16, "run-b", {}, ["lib/b.py"],
             {"tests/test_b.py": ["lib/b.py"]})
ROW_C = _row("c" * 16, "run-c", {}, ["lib/c.py"], {})

ROWS = [ROW_A, ROW_B, ROW_C]

TREE_TESTS = ["tests/test_a.py", "tests/test_b.py", "tests/test_d.py"]

# leg (d): a findings row — `merge_ledger.py`'s shape, no `kind` key at all.
FINDINGS_ROW = {"runId": "run-9", "lens": "friction", "title": "t",
                "touched": ["lib/b.py"]}


@pytest.fixture
def mod():
    return _module()


@pytest.fixture
def table_a(mod):
    """The table of leg (a): the three rows against the three tree tests."""
    return mod.catch_table([dict(r) for r in ROWS], list(TREE_TESTS))


# --------------------------------------------------------------- leg (a) M1

def test_leg_a_caught_test_counts_its_catch_and_its_touching_run(table_a):
    """(a)/M1: `tests/test_a.py` — `catches` exactly 1 (run A's one catch),
    `touchingRuns` exactly 1 (only run A touched `lib/a.py`), `status`
    `caught`."""
    assert "tests/test_a.py" in table_a, (
        "the table has no entry for tests/test_a.py; keys: %r"
        % sorted(table_a))
    entry = table_a["tests/test_a.py"]
    assert entry["catches"] == 1
    assert entry["touchingRuns"] == 1
    assert entry["status"] == "caught"


# --------------------------------------------------------------- leg (b) M1

def test_leg_b_zero_test_unions_its_exercises_and_counts_one_touch(table_a):
    """(b)/M1: `tests/test_b.py` — `catches` exactly 0, `exercised` exactly
    `["lib/b.py"]` (the union across run A and run B), `touchingRuns` exactly
    1 (run A's `touched` misses `lib/b.py`, run B's hits it, run C's misses
    it), and `status` `zero`, not `caught`."""
    assert "tests/test_b.py" in table_a, (
        "the table has no entry for tests/test_b.py; keys: %r"
        % sorted(table_a))
    entry = table_a["tests/test_b.py"]
    assert entry["catches"] == 0
    assert entry["exercised"] == ["lib/b.py"]
    assert entry["touchingRuns"] == 1
    assert entry["status"] == "zero"
    assert entry["status"] != "caught"


# --------------------------------------------------------------- leg (c) M1

def test_leg_c_tree_only_test_is_unobserved_and_only_tests_are_keys(table_a):
    """(c)/M1: `tests/test_d.py` — a path the tree holds that no row ever
    named: `catches` 0, `exercised` exactly `[]`, `touchingRuns` 0, `status`
    `unobserved`, not `zero`. And the table has exactly the three keys; the
    exercised/touched path `lib/b.py` is not one of them."""
    assert "tests/test_d.py" in table_a, (
        "the table has no entry for the tree's tests/test_d.py; keys: %r"
        % sorted(table_a))
    entry = table_a["tests/test_d.py"]
    assert entry["catches"] == 0
    assert entry["exercised"] == []
    assert entry["touchingRuns"] == 0
    assert entry["status"] == "unobserved"
    assert entry["status"] != "zero"
    assert set(table_a) == {"tests/test_a.py", "tests/test_b.py",
                            "tests/test_d.py"}
    assert "lib/b.py" not in table_a


# --------------------------------------------------------------- leg (d) M2

def test_leg_d_a_findings_row_contributes_nothing(mod, table_a):
    """(d)/M2: adding the findings row (no `kind`) to the rows of (a) changes
    no entry — the table is equal to that of (a). Its `touched` names
    `lib/b.py`, so a report that counted every row's `touched` would report
    `tests/test_b.py` with two touching runs here."""
    with_finding = mod.catch_table(
        [dict(r) for r in ROWS] + [dict(FINDINGS_ROW)], list(TREE_TESTS))
    assert with_finding == table_a


# --------------------------------------------------------------- leg (e) M3

def test_leg_e_curve_counts_zeroes_at_each_n_up_to_the_largest(mod):
    """(e)/M3: over entries `{catches 0, touchingRuns 3}`, `{catches 0,
    touchingRuns 1}`, `{catches 2, touchingRuns 3}` and `{catches 0,
    touchingRuns 0}`, the curve is exactly three entries — N=1 counts two,
    N=2 and N=3 count one, and there is no `n` of 4."""
    table = {
        "tests/test_p.py": {"catches": 0, "exercised": ["lib/p.py"],
                            "touchingRuns": 3, "status": "zero"},
        "tests/test_q.py": {"catches": 0, "exercised": ["lib/q.py"],
                            "touchingRuns": 1, "status": "zero"},
        "tests/test_r.py": {"catches": 2, "exercised": ["lib/r.py"],
                            "touchingRuns": 3, "status": "caught"},
        "tests/test_s.py": {"catches": 0, "exercised": ["lib/s.py"],
                            "touchingRuns": 0, "status": "zero"},
    }
    assert mod.zero_curve(table) == [{"n": 1, "files": 2},
                                     {"n": 2, "files": 1},
                                     {"n": 3, "files": 1}]


# --------------------------------------------------------------- leg (f) M3

def test_leg_f_curve_is_empty_when_no_run_touches(mod):
    """(f)/M3: a table whose every `touchingRuns` is 0 — the largest is 0 —
    gives exactly `[]`, even though one entry is a real `zero` at N=0."""
    table = {
        "tests/test_p.py": {"catches": 0, "exercised": ["lib/p.py"],
                            "touchingRuns": 0, "status": "zero"},
        "tests/test_q.py": {"catches": 1, "exercised": ["lib/q.py"],
                            "touchingRuns": 0, "status": "caught"},
    }
    assert mod.zero_curve(table) == []


# --------------------------------------------------------------- leg (g) M4

@pytest.fixture
def tree(tmp_path):
    """The temporary tree of legs (g)–(j): two suite files and three files
    that are not tests of either suite."""
    root = tmp_path / "tree"
    for rel, body in (("tests/test_x.py", "def test_x(): pass\n"),
                      ("tests/helper.py", "X = 1\n"),
                      ("fleet/tests/test_y.mjs", "// y\n"),
                      ("fleet/tests/_helpers.mjs", "// helpers\n"),
                      ("other/test_z.py", "def test_z(): pass\n")):
        path = root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(body)
    return root


# The two suite files of that tree, sorted, relative to it (M4).
TREE_FILES = ["fleet/tests/test_y.mjs", "tests/test_x.py"]


def test_leg_g_tree_test_files_matches_the_two_globs_only(mod, tree):
    """(g)/M4: exactly `["fleet/tests/test_y.mjs", "tests/test_x.py"]` —
    repository-relative strings, sorted. `tests/helper.py` is not a
    `test_*.py`, `fleet/tests/_helpers.mjs` is not a `test_*.mjs`, and
    `other/test_z.py` is under neither glob's directory."""
    assert mod.tree_test_files(tree) == TREE_FILES


# ------------------------------------------------------------------- the CLI

def _run(*args):
    """Invoke the CLI as M5 spells it; return the completed process."""
    assert SCRIPT.is_file(), (
        "%s is a deliverable of this task and does not exist"
        % SCRIPT.relative_to(REPO))
    return subprocess.run([sys.executable, str(SCRIPT),
                           *[str(a) for a in args]],
                          capture_output=True, text=True)


def _lines(proc):
    """Exit 0 (M5/M6) and stdout as lines, trailing blank lines dropped."""
    assert proc.returncode == 0, (
        "catch_report exited %d\nstdout:\n%s\nstderr:\n%s"
        % (proc.returncode, proc.stdout, proc.stderr))
    return proc.stdout.rstrip("\n").split("\n")


def _cells(line):
    parts = line.strip().split("|")
    assert parts[0].strip() == "" and parts[-1].strip() == "", (
        "not a pipe-delimited row: %r" % line)
    return [p.strip() for p in parts[1:-1]]


def _is_separator(cells):
    return bool(cells) and all(re.fullmatch(r":?-{2,}:?", c) for c in cells)


def _table_rows(lines):
    """The data rows under the pinned header — the header line must be there
    verbatim, and the rows are the pipe lines that follow it."""
    assert HEADER in lines, (
        "no header line %r in output:\n%s" % (HEADER, "\n".join(lines)))
    rows = []
    for line in lines[lines.index(HEADER) + 1:]:
        if not line.strip().startswith("|"):
            break
        cells = _cells(line)
        if not _is_separator(cells):
            rows.append(cells)
    return rows


def _section(lines, heading):
    """The non-blank body lines under `heading`, up to the next `## `."""
    assert heading in lines, (
        "no %r line in output:\n%s" % (heading, "\n".join(lines)))
    body = []
    for line in lines[lines.index(heading) + 1:]:
        if not line.strip():
            continue
        if line.startswith("## "):
            break
        body.append(line.strip())
    return body


def _ledger(tmp_path, rows):
    path = tmp_path / "ledger.jsonl"
    path.write_text("".join(json.dumps(r, sort_keys=True) + "\n"
                            for r in rows))
    return path


# The four entries of the CLI's table: the tree's two files plus the two the
# record names, sorted by path (M1 over ROWS and TREE_FILES, M5's order).
CLI_ROWS = [
    ["fleet/tests/test_y.mjs", "0", "0", "unobserved"],
    ["tests/test_a.py", "1", "1", "caught"],
    ["tests/test_b.py", "0", "1", "zero"],
    ["tests/test_x.py", "0", "0", "unobserved"],
]


# --------------------------------------------------------------- leg (h) M5

def test_leg_h_cli_prints_the_table_and_the_curve(tmp_path, tree):
    """(h)/M5: the ledger of (a) against that tree, without `--n` — the header
    line verbatim, one row per table entry sorted by path, a `## Zero-catch
    curve` section holding exactly `N=1: 1 file(s)` and `max touching runs:
    1`, no `## Zero catches over` line, exit 0."""
    proc = _run("--ledger", _ledger(tmp_path, ROWS), "--tree", tree)
    lines = _lines(proc)
    assert _table_rows(lines) == CLI_ROWS
    assert _section(lines, CURVE_HEADING) == ["N=1: 1 file(s)",
                                              "max touching runs: 1"]
    assert not [l for l in lines if l.startswith("## Zero catches over")], (
        "a deletion section was printed without --n:\n%s" % "\n".join(lines))
    assert lines.index(HEADER) < lines.index(CURVE_HEADING), (
        "the curve section precedes the table")


# --------------------------------------------------------------- leg (i) M5

def test_leg_i_cli_with_n_1_lists_the_one_zero_test(tmp_path, tree):
    """(i)/M5: `--n 1` additionally prints `## Zero catches over 1 runs`,
    after the curve, followed by exactly the line `tests/test_b.py` and
    nothing else before end of output."""
    proc = _run("--ledger", _ledger(tmp_path, ROWS), "--tree", tree,
                "--n", "1")
    lines = _lines(proc)
    heading = "## Zero catches over 1 runs"
    assert _table_rows(lines) == CLI_ROWS
    assert _section(lines, heading) == ["tests/test_b.py"]
    assert lines.index(CURVE_HEADING) < lines.index(heading), (
        "the deletion section precedes the curve")
    assert lines[-1].strip() == "tests/test_b.py", (
        "the deletion section is not last:\n%s" % "\n".join(lines))


def test_leg_i_cli_with_n_2_lists_no_path(tmp_path, tree):
    """(i)/M5: `--n 2` prints the heading `## Zero catches over 2 runs`
    followed by no path — `tests/test_b.py` has one touching run, not two."""
    proc = _run("--ledger", _ledger(tmp_path, ROWS), "--tree", tree,
                "--n", "2")
    lines = _lines(proc)
    assert _section(lines, "## Zero catches over 2 runs") == []


# --------------------------------------------------------------- leg (j) M6

def test_leg_j_missing_ledger_reports_the_tree_as_unobserved(tmp_path, tree):
    """(j)/M6: a `--ledger` path that does not exist — a table row for each of
    the two tree tests with `0` catches and `unobserved`, no `N=` line, `max
    touching runs: 0`, exit 0."""
    missing = tmp_path / "absent.jsonl"
    assert not missing.exists()
    proc = _run("--ledger", missing, "--tree", tree)
    lines = _lines(proc)
    assert _table_rows(lines) == [
        ["fleet/tests/test_y.mjs", "0", "0", "unobserved"],
        ["tests/test_x.py", "0", "0", "unobserved"],
    ]
    assert _section(lines, CURVE_HEADING) == ["max touching runs: 0"]
    assert not [l for l in lines if l.strip().startswith("N=")], (
        "a curve line was printed for an empty record:\n%s" % "\n".join(lines))


# ===========================================================================
# Task 2 — "The table renders and catches is a sum" (#823).
#
# The legs below are task 2's (a)–(c); the eleven above are task 2's
# inheritance and stay exactly as they were. M1 is the delimiter row — the
# second line of `table_lines` and of the CLI's stdout, both over the leg-(a)
# ledger and over a `--ledger` path that does not exist. M2 is the sum: a
# test credited by two rows carries the total, which is what separates a sum
# from `max`, `any` or last-row-wins.

# M1: the GFM delimiter row under the four-column header, verbatim.
DELIMITER = "| --- | --- | --- | --- |"


def _rendered(cells):
    """`CLI_ROWS`-shaped cells as the table's `| a | b | c | d |` line."""
    return "| %s |" % " | ".join(cells)


# The tree's two files as the table renders them when no row names them (M1,
# used by leg (b)'s missing-ledger half).
UNOBSERVED_TREE_ROWS = [
    ["fleet/tests/test_y.mjs", "0", "0", "unobserved"],
    ["tests/test_x.py", "0", "0", "unobserved"],
]


# ----------------------------------------------------------- task 2 (a) M1

def test_task2_leg_a_table_lines_emits_the_delimiter_then_the_rows(mod):
    """(a)/M1: `table_lines(catch_table(ROWS, TREE_FILES))` — `[0]` is
    `HEADER`, `[1]` is `| --- | --- | --- | --- |`, and `[2:]` is exactly the
    four `CLI_ROWS` rendered as `| a | b | c | d |` lines, in that order
    (sorted by path). Nothing is dropped and nothing is inserted between the
    delimiter and the first data row."""
    lines = mod.table_lines(
        mod.catch_table([dict(r) for r in ROWS], list(TREE_FILES)))
    assert lines[0] == HEADER, (
        "first line is not the pinned header: %r" % (lines[:1],))
    assert lines[1] == DELIMITER, (
        "second line is not the delimiter row: %r" % (lines[:2],))
    assert lines[2:] == [_rendered(cells) for cells in CLI_ROWS]


def test_task2_leg_a_one_entry_table_is_exactly_three_lines(mod):
    """(a)/M1: a table of one entry yields exactly three lines — the header,
    the delimiter once, and that entry's row. A delimiter emitted per row, or
    none at all, is not three lines in this order."""
    entry_row = ["tests/test_a.py", "1", "1", "caught"]
    lines = mod.table_lines({
        "tests/test_a.py": {"catches": 1, "exercised": ["lib/a.py"],
                            "touchingRuns": 1, "status": "caught"}})
    assert len(lines) == 3, (
        "a one-entry table rendered %d line(s):\n%s"
        % (len(lines), "\n".join(lines)))
    assert lines == [HEADER, DELIMITER, _rendered(entry_row)]


# ----------------------------------------------------------- task 2 (b) M1

def test_task2_leg_b_cli_second_stdout_line_is_the_delimiter(tmp_path, tree):
    """(b)/M1: the CLI over the leg-(a) ledger and the `tree` fixture — stdout
    line index 0 is `HEADER`, index 1 is `| --- | --- | --- | --- |`, and the
    data rows are still exactly `CLI_ROWS`: the delimiter is an addition to
    the table, not a replacement of a row."""
    proc = _run("--ledger", _ledger(tmp_path, ROWS), "--tree", tree)
    lines = _lines(proc)
    assert lines[0] == HEADER, (
        "first stdout line is not the pinned header:\n%s" % "\n".join(lines))
    assert lines[1] == DELIMITER, (
        "second stdout line is not the delimiter row:\n%s" % "\n".join(lines))
    assert _table_rows(lines) == CLI_ROWS


def test_task2_leg_b_cli_missing_ledger_prints_the_delimiter(tmp_path, tree):
    """(b)/M1: the CLI over a `--ledger` path under `tmp_path` that does not
    exist — line index 1 is that same delimiter, and the data rows following
    it are the tree's two files, each `unobserved`."""
    missing = tmp_path / "absent-ledger.jsonl"
    assert not missing.exists()
    proc = _run("--ledger", missing, "--tree", tree)
    lines = _lines(proc)
    assert lines[0] == HEADER, (
        "first stdout line is not the pinned header:\n%s" % "\n".join(lines))
    assert lines[1] == DELIMITER, (
        "second stdout line is not the delimiter row:\n%s" % "\n".join(lines))
    assert lines[2:4] == [_rendered(cells) for cells in UNOBSERVED_TREE_ROWS]
    assert _table_rows(lines) == UNOBSERVED_TREE_ROWS


# ----------------------------------------------------------- task 2 (c) M2

def test_task2_leg_c_catches_sums_over_every_catch_count_row(mod):
    """(c)/M2: `catch_table([ROW_A, dict(ROW_A, id="d"*16, runId="run-d")],
    [])["tests/test_a.py"]` — `catches` is `2`, the sum of that row's
    `catches["tests/test_a.py"]` over both rows, and `touchingRuns` is `2`,
    both rows' `touched` being `["lib/a.py"]`. A `max`, `any` or
    last-row-wins reading yields `1` here."""
    rows = [dict(ROW_A), dict(ROW_A, id="d" * 16, runId="run-d")]
    table = mod.catch_table(rows, [])
    assert "tests/test_a.py" in table, (
        "the table has no entry for tests/test_a.py; keys: %r" % sorted(table))
    entry = table["tests/test_a.py"]
    assert entry["catches"] == 2
    assert entry["touchingRuns"] == 2
