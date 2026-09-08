"""Exam for task 1 — one row per run, across many run directories.

Every assertion below names the Proof leg (a)–(f) and the Machine clause it
comes from. The three rows are the ones the task pins verbatim in Context; the
column list is the one M1 pins, in M1's order.

The script and the three fixture run directories are this task's deliverables,
so at BASE this file is red because they do not exist yet — `_require_fixtures`
says so in as many words rather than letting the absence surface as a stray
parse error.
"""
import csv
import subprocess
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
SCRIPT = REPO / "skills/ultralearn/scripts/census_many.py"
SCRIPTS_DIR = REPO / "skills/ultralearn/scripts"
CENSUS = REPO / "tests/fixtures/ultralearn/census"
RUN_DIRS = {n: CENSUS / n for n in ("run-101", "run-102", "run-103")}

# M1: exactly these 31 columns, in this order.
COLUMNS = (
    "run", "era", "engine", "terminus", "tasks", "width", "minutes_total",
    "cost_usd", "start", "setup_min", "wave_min", "fold_min", "critic_min",
    "gate_min", "publish_min", "min_examiner", "usd_examiner",
    "min_implementer", "usd_implementer", "min_reviewer", "usd_reviewer",
    "min_critic", "usd_critic", "min_resolver", "usd_resolver",
    "longest_chain_min", "fix_rounds", "launched_at", "pr", "merged",
    "status_min",
)

EMPTY = {c: "" for c in COLUMNS}

# The three rows, verbatim from the task's Context. An unlisted column is the
# empty string, which is what `EMPTY` supplies.
ROW_101 = dict(
    EMPTY, run="run-101", terminus="done", tasks="1", width="1",
    minutes_total="8.0", cost_usd="2.50", start="2026-08-30T22:46:40Z",
    setup_min="1.0", wave_min="7.0", fold_min="1.0", critic_min="1.0",
    gate_min="2.0", publish_min="3.0", min_examiner="1.0",
    usd_examiner="0.25", min_implementer="4.0", usd_implementer="1.00",
    min_reviewer="2.0", usd_reviewer="0.50", min_critic="1.0",
    usd_critic="0.75", min_resolver="0.0", usd_resolver="0.00",
    longest_chain_min="7.0", fix_rounds="0",
    launched_at="2026-08-30T22:40:00Z", pr="https://github.com/o/r/pull/1",
    merged="a" * 40, status_min="20.0",
)

ROW_102 = dict(
    EMPTY, run="run-102", terminus="parked", tasks="2", width="2",
    minutes_total="9.0", cost_usd="5.00", start="2026-08-30T22:46:40Z",
    setup_min="1.0", wave_min="6.0", critic_min="1.0", gate_min="1.0",
    min_examiner="0.0", usd_examiner="0.00", min_implementer="6.0",
    usd_implementer="3.00", min_reviewer="2.0", usd_reviewer="1.00",
    min_critic="1.0", usd_critic="1.00", min_resolver="0.0",
    usd_resolver="0.00", longest_chain_min="5.0", fix_rounds="1",
    launched_at="2026-08-30T23:10:00Z", status_min="15.0",
)

ROW_103 = dict(
    EMPTY, run="run-103", engine="0.3.17", terminus="done", tasks="3",
    launched_at="2026-08-30T23:30:00Z", pr="https://github.com/o/r/pull/3",
    merged="c" * 40, status_min="12.0",
)


def _require_fixtures():
    """The tracked fixture is part of this task; say so when it is absent."""
    missing = [str(p.relative_to(REPO)) for p in RUN_DIRS.values()
               if not p.is_dir()]
    assert not missing, (
        "the census fixture run directories are deliverables of this task and "
        "are absent: " + ", ".join(missing))


def _run(tmp_path, *args):
    """Invoke the CLI with `sys.executable`, cwd = tmp_path (Proof legs)."""
    _require_fixtures()
    assert SCRIPT.is_file(), (
        "%s is a deliverable of this task and does not exist"
        % SCRIPT.relative_to(REPO))
    proc = subprocess.run(
        [sys.executable, str(SCRIPT), *[str(a) for a in args]],
        cwd=str(tmp_path), capture_output=True, text=True)
    assert proc.returncode == 0, (
        "census_many exited %d\nstdout:\n%s\nstderr:\n%s"
        % (proc.returncode, proc.stdout, proc.stderr))
    return proc


def _read_csv(path):
    with open(str(path), newline="", encoding="utf-8") as fh:
        return list(csv.reader(fh))


def _rows(path):
    """(header, [row dict, ...]) from a CSV the CLI wrote."""
    table = _read_csv(path)
    assert table, "the CSV is empty"
    header = table[0]
    return header, [dict(zip(header, r)) for r in table[1:]]


# ---------------------------------------------------------------- leg (a) M1

def test_tree_positional_yields_the_31_columns_and_one_row_per_run(tmp_path):
    """(a)/M1: the tree as the one positional — header is the 31 columns in the
    pinned order, and exactly one row per run directory found, run-101,
    run-102, run-103 in that order. The fixture root itself holds none of the
    three files and so is not a run: a fourth row fails."""
    _run(tmp_path, CENSUS, "--csv", "out.csv")
    header, rows = _rows(tmp_path / "out.csv")
    assert header == list(COLUMNS)
    assert [r["run"] for r in rows] == ["run-101", "run-102", "run-103"]


def test_row_order_is_run_number_not_argv_order(tmp_path):
    """(a)/M1: three run directories passed as three positionals in the order
    103, 102, 101 still come out 101, 102, 103 — ordered by the integer in
    `run-<N>`, regardless of argv order."""
    _run(tmp_path, RUN_DIRS["run-103"], RUN_DIRS["run-102"],
         RUN_DIRS["run-101"], "--csv", "out.csv")
    header, rows = _rows(tmp_path / "out.csv")
    assert header == list(COLUMNS)
    assert [r["run"] for r in rows] == ["run-101", "run-102", "run-103"]


# ---------------------------------------------------------------- leg (b) M2

def test_run_101_row_is_the_pinned_row(tmp_path):
    """(b)/M2: the run-101 row equals the pinned dict, all 31 columns. The
    critic's minute belongs to `critic_min`, not to `wave_min` (`7.0`), and
    `cost_usd` is `2.50`, not `2.5`."""
    _run(tmp_path, CENSUS, "--csv", "out.csv")
    _, rows = _rows(tmp_path / "out.csv")
    by_run = {r["run"]: r for r in rows}
    assert by_run["run-101"] == ROW_101


# ---------------------------------------------------------------- leg (c) M2

def test_run_102_row_is_the_pinned_row(tmp_path):
    """(c)/M2: the run-102 row equals the pinned dict — `width` `2` (two starts
    at an equal `ts` are concurrent), `fix_rounds` `1`, `longest_chain_min`
    `5.0` (the fix and its re-review chain onto task 1), and `fold_min` the
    empty string (the run never folded)."""
    _run(tmp_path, CENSUS, "--csv", "out.csv")
    _, rows = _rows(tmp_path / "out.csv")
    by_run = {r["run"]: r for r in rows}
    assert by_run["run-102"] == ROW_102


# ---------------------------------------------------------------- leg (d) M3

def test_run_103_without_an_event_log_still_gets_its_row(tmp_path):
    """(d)/M3: a run directory with no `events.jsonl` is never omitted. Its row
    equals the pinned dict: `tasks` `3` (len of report's `tasks`), `engine`
    `0.3.17`, `terminus` `done`, `status_min` `12.0`, and the empty string —
    not `0.0` — in every timing and role column."""
    _run(tmp_path, CENSUS, "--csv", "out.csv")
    _, rows = _rows(tmp_path / "out.csv")
    by_run = {r["run"]: r for r in rows}
    assert "run-103" in by_run, "the log-less run directory was skipped"
    assert by_run["run-103"] == ROW_103
    for column in ("width", "minutes_total", "cost_usd", "start", "setup_min",
                   "wave_min", "fold_min", "critic_min", "gate_min",
                   "publish_min", "min_examiner", "usd_examiner",
                   "min_implementer", "usd_implementer", "min_reviewer",
                   "usd_reviewer", "min_critic", "usd_critic", "min_resolver",
                   "usd_resolver", "longest_chain_min", "fix_rounds"):
        assert by_run["run-103"][column] == "", column


# ---------------------------------------------------------------- leg (e) M4

def _md_lines(text):
    return text.rstrip("\n").split("\n")


def _cells(line):
    parts = line.split("|")
    assert parts[0].strip() == "" and parts[-1].strip() == "", (
        "not a pipe-delimited row: %r" % line)
    return [p.strip() for p in parts[1:-1]]


def test_md_flag_writes_a_pipe_table(tmp_path):
    """(e)/M4: `--md PATH` writes a header line beginning `| run | era |
    engine |`, a separator line of 31 `---` cells, then exactly three rows."""
    _run(tmp_path, CENSUS, "--md", "out.md")
    lines = _md_lines((tmp_path / "out.md").read_text(encoding="utf-8"))
    assert lines[0].startswith("| run | era | engine |")
    assert _cells(lines[0]) == list(COLUMNS)
    assert _cells(lines[1]) == ["---"] * 31
    assert len(lines) == 5, "expected header, separator and three rows"
    assert [_cells(l)[0] for l in lines[2:]] == [
        "run-101", "run-102", "run-103"]


def test_stdout_with_no_flag_is_the_markdown_table(tmp_path):
    """(e)/M4: with neither `--csv` nor `--md`, the Markdown table goes to
    stdout — the same text the `--md` file holds."""
    _run(tmp_path, CENSUS, "--md", "out.md")
    md_text = (tmp_path / "out.md").read_text(encoding="utf-8")
    proc = _run(tmp_path, CENSUS)
    assert proc.stdout.rstrip("\n") == md_text.rstrip("\n")


def test_csv_append_keeps_prior_bytes_and_writes_no_second_header(tmp_path):
    """(e)/M4: `--csv out.csv --append` a second time over the same three run
    directories leaves the first run's bytes as an exact prefix, adds no second
    header line, and appends one row per run — six data rows in all."""
    out = tmp_path / "out.csv"
    _run(tmp_path, CENSUS, "--csv", "out.csv")
    first = out.read_bytes()
    assert first, "the first write produced an empty CSV"

    _run(tmp_path, CENSUS, "--csv", "out.csv", "--append")
    second = out.read_bytes()
    assert second.startswith(first), (
        "--append rewrote the file rather than appending to it")

    text = second.decode("utf-8")
    headers = [l for l in text.splitlines() if l.startswith("run,era,")]
    assert len(headers) == 1, "expected exactly one header line, got %d" % len(
        headers)
    header, rows = _rows(out)
    assert header == list(COLUMNS)
    assert [r["run"] for r in rows] == [
        "run-101", "run-102", "run-103"] * 2


# ---------------------------------------------------------------- leg (f) M5

def test_label_fills_era_on_that_run_only(tmp_path):
    """(f)/M5: `--label run-101=lift` puts `lift` in run-101's `era` and leaves
    `era` empty on the other two rows."""
    _run(tmp_path, CENSUS, "--label", "run-101=lift", "--csv", "out.csv")
    _, rows = _rows(tmp_path / "out.csv")
    by_run = {r["run"]: r for r in rows}
    assert by_run["run-101"] == dict(ROW_101, era="lift")
    assert by_run["run-102"]["era"] == ""
    assert by_run["run-103"]["era"] == ""


def test_engine_is_report_engine_version_only_when_it_is_a_string(tmp_path):
    """(f)/M5: `engine` is `report.json`'s `engineVersion` when that key holds a
    string and the empty string otherwise — run-101's report has no such key,
    run-103's has `0.3.17`."""
    _run(tmp_path, CENSUS, "--csv", "out.csv")
    _, rows = _rows(tmp_path / "out.csv")
    by_run = {r["run"]: r for r in rows}
    assert by_run["run-101"]["engine"] == ""
    assert by_run["run-102"]["engine"] == ""
    assert by_run["run-103"]["engine"] == "0.3.17"


# ------------------------------------------------- Produces / M1 / M2 / M3 /
# M5: the importable contract later tasks rely on.

def _module():
    _require_fixtures()
    assert SCRIPT.is_file(), (
        "%s is a deliverable of this task and does not exist"
        % SCRIPT.relative_to(REPO))
    sys.path.insert(0, str(SCRIPTS_DIR))
    try:
        import census_many
    except ImportError as exc:  # pragma: no cover - red-at-BASE path
        pytest.fail("census_many is not importable: %s" % exc)
    return census_many


def test_columns_is_a_module_level_tuple_of_the_31_names():
    """M1 / Produces: `COLUMNS` is a module-level tuple naming the 31 columns
    in the pinned order."""
    census_many = _module()
    assert isinstance(census_many.COLUMNS, tuple)
    assert census_many.COLUMNS == COLUMNS


def test_census_rows_returns_the_three_pinned_row_dicts():
    """Produces `census_rows(paths, labels) -> list[dict]`: the same table the
    CLI writes, keyed by the 31 columns, in run order, with `labels` filling
    `era` (M5)."""
    census_many = _module()
    rows = census_many.census_rows([str(CENSUS)], {})
    assert [r["run"] for r in rows] == ["run-101", "run-102", "run-103"]
    assert [sorted(r) for r in rows] == [sorted(COLUMNS)] * 3
    assert rows == [ROW_101, ROW_102, ROW_103]

    labelled = census_many.census_rows([str(CENSUS)], {"run-101": "lift"})
    assert labelled == [dict(ROW_101, era="lift"), ROW_102, ROW_103]
