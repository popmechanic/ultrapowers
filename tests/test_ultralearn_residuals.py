"""Exam for task 2 — the residual counter appends the rows to the ledger and
the report names the repeats.

Every assertion names the Proof leg (a)–(f) and the Machine clause (M1–M5) it
comes from, so the file reads back against the contract.

The claim under test: "`skills/ultralearn/scripts/harvest` (or the catch
counter's sibling) merges those rows into
`docs/superpowers/observations/ledger.jsonl` on the next `ultralearn` pass,
keyed by `(file, normalized text)`, and the report lists residuals seen in ≥2
runs or on ≥2 files as the candidates."

`skills/ultralearn/scripts/residual_counter.py` and
`skills/ultralearn/scripts/residual_report.py` are this task's deliverables, so
at BASE every test here is red for one reason — `_require()` says the script
does not exist yet, in as many words, rather than letting the absence surface as
a `FileNotFoundError` from a subprocess. The SKILL.md legs are red for the
matching reason: `## The residual counter` is not a heading in the file yet.

Every fixture is built under pytest's `tmp_path`: the `residuals.jsonl` files
this counter reads are the fix round's record, and the exam writes no bytes into
the tree.
"""
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = REPO / "skills/ultralearn/scripts"
COUNTER = SCRIPTS_DIR / "residual_counter.py"
REPORT = SCRIPTS_DIR / "residual_report.py"
SKILL = REPO / "skills/ultralearn/SKILL.md"
VALIDATE = REPO / "skills/ultrapowers/scripts/validate_skill.py"

# M1: the appended row is exactly these ten keys — no more, no fewer.
ROW_KEYS = {"id", "kind", "key", "runId", "task", "file", "line",
            "residualKind", "text", "sha"}

# M1/M2: the ledger kind these rows carry, and the middle field of the id.
ROW_KIND = "residual"

# M4: the report's two literal lines.
HEADING = "## Residual candidates"
NONE_LINE = "(none)"

# M5: the headings the section sits between, and its own.
CATCH_HEADING = "## The catch counter"
RESIDUAL_HEADING = "## The residual counter"
VERB2_HEADING = "## Verb 2"

XMJS = "fleet/x.mjs"

# --- leg (a)'s fixture ------------------------------------------------------
#
# The input row shape is the literal task 1 writes, one JSON object per line of
# `residuals.jsonl`. The directory names deliberately differ from the lines'
# `run` values, so a `runId` read off the directory name is visible.

SEVEN_LINES = [
    {"file": None, "kind": "deferred", "line": None, "run": "run-7",
     "sha": "a" * 40, "task": None, "text": "E1 dup insert"},
    {"file": XMJS, "kind": "structural", "line": 12, "run": "run-7",
     "sha": "b" * 40, "task": "3",
     "text": "the exam covers  the success path only"},
]
EIGHT_LINES = [
    {"file": XMJS, "kind": "nit", "line": 5, "run": "run-8",
     "sha": "c" * 40, "task": "4",
     "text": "The exam covers the success path only"},
]


# --- the deliverables -------------------------------------------------------

def _require(script):
    """Name the script as this task's deliverable when it is absent."""
    assert script.is_file(), (
        "%s is a deliverable of this task and does not exist"
        % script.relative_to(REPO))
    return script


def _sha16(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def _normalized(text):
    """M2: the text's whitespace runs collapsed to one space, stripped,
    lowercased."""
    return " ".join(text.split()).lower()


def _key(file, text):
    """M2: the first 16 hex digits of the SHA-256 of the row's `file` (the
    empty string when the line's `file` is null) + newline + the normalized
    text."""
    return _sha16((file or "") + "\n" + _normalized(text))


def _id(run_id, key):
    """M2: the first 16 hex digits of the SHA-256 of `<runId>` + newline +
    `residual` + newline + `<key>`."""
    return _sha16("%s\n%s\n%s" % (run_id, ROW_KIND, key))


def _expected_row(line):
    """M1/M2: the ledger row one `residuals.jsonl` line yields, in full."""
    key = _key(line["file"], line["text"])
    return {"id": _id(line["run"], key), "kind": ROW_KIND, "key": key,
            "runId": line["run"], "task": line["task"], "file": line["file"],
            "line": line["line"], "residualKind": line["kind"],
            "text": line["text"], "sha": line["sha"]}


# --- fixtures ---------------------------------------------------------------

def _write_residuals(directory, lines):
    """One directory holding a `residuals.jsonl`. No `events.jsonl` beside it:
    the counter's discovery is "a directory holding `residuals.jsonl`"."""
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "residuals.jsonl").write_text(
        "".join(json.dumps(line) + "\n" for line in lines), encoding="utf-8")
    return directory


def _leg_a_tree(tmp_path):
    """Leg (a)'s tree: `seven/residuals.jsonl` with two lines and
    `eight/residuals.jsonl` with one, both nested under one root."""
    tree = tmp_path / "tree"
    _write_residuals(tree / "seven", SEVEN_LINES)
    _write_residuals(tree / "eight", EIGHT_LINES)
    return tree


def _lines(path):
    return [line for line in Path(path).read_text(encoding="utf-8").splitlines()
            if line.strip()]


def _rows(ledger):
    return [json.loads(line) for line in _lines(ledger)]


def _by_text(rows):
    """The appended rows keyed by `(runId, text)` — the counter's order over a
    tree is not pinned by any clause, so each leg reads the row it means."""
    return {(row.get("runId"), row.get("text")): row for row in rows}


def _run(script, tmp_path, *args):
    """Invoke a CLI with `sys.executable`, cwd = tmp_path."""
    _require(script)
    return subprocess.run(
        [sys.executable, str(script), *[str(a) for a in args]],
        cwd=str(tmp_path), capture_output=True, text=True)


def _stdout_line(proc):
    lines = [line for line in proc.stdout.splitlines() if line.strip()]
    assert len(lines) == 1, (
        "expected exactly one stdout line, got %r (stderr: %r)"
        % (proc.stdout, proc.stderr))
    return lines[0]


def _counted(files, appended, recorded):
    """M3: the counter's one stdout line, verbatim."""
    return ("%d file(s) counted, %d row(s) appended, %d already recorded"
            % (files, appended, recorded))


# === leg (a) — M1: one row per line, with exactly the ten keys ==============

def test_a_counter_appends_one_row_per_residual_line(tmp_path):
    """(a)/M1: the tree of `seven/residuals.jsonl` (two lines, `run` `run-7`)
    and `eight/residuals.jsonl` (one line, `run` `run-8`) appends exactly three
    rows, each with exactly the ten keys, `kind` `residual`, and `runId`
    `run-7`, `run-7`, `run-8` — read off each line's `run`, never off the
    directory name (`seven`, `eight`)."""
    tree = _leg_a_tree(tmp_path)
    ledger = tmp_path / "ledger.jsonl"

    proc = _run(COUNTER, tmp_path, tree, "--ledger", ledger)
    assert proc.returncode == 0, proc.stderr
    assert "Traceback" not in proc.stderr, proc.stderr

    rows = _rows(ledger)
    assert len(rows) == 3, rows
    for row in rows:
        assert set(row) == ROW_KEYS, (
            "M1: the row is exactly the ten keys; got %r" % (sorted(row),))
        assert row["kind"] == ROW_KIND, row
    assert sorted(row["runId"] for row in rows) == ["run-7", "run-7", "run-8"]
    assert "seven" not in {row["runId"] for row in rows}, rows
    assert "eight" not in {row["runId"] for row in rows}, rows


def test_a_each_row_copies_its_lines_fields(tmp_path):
    """(a)/M1: `residualKind` is copied from each line's `kind`, and `task`,
    `file`, `line`, `text` and `sha` from each line — the whole row, compared
    as a value against the exam's own construction of it."""
    tree = _leg_a_tree(tmp_path)
    ledger = tmp_path / "ledger.jsonl"

    assert _run(COUNTER, tmp_path, tree, "--ledger", ledger).returncode == 0
    got = _by_text(_rows(ledger))
    for line in SEVEN_LINES + EIGHT_LINES:
        expected = _expected_row(line)
        row = got.get((line["run"], line["text"]))
        assert row is not None, (
            "M1: no row for run %r text %r; got %r"
            % (line["run"], line["text"], sorted(got)))
        assert row == expected, (
            "M1: the row for %r does not match the line it came from\n"
            "  got      %r\n  expected %r" % (line["text"], row, expected))
        assert row["residualKind"] == line["kind"]
        assert row["task"] == line["task"]
        assert row["file"] == line["file"]
        assert row["line"] == line["line"]
        assert row["sha"] == line["sha"]


def test_a_stdout_counts_the_two_files(tmp_path):
    """(a)/M3: the counter counted two `residuals.jsonl` files and appended
    three rows — the one stdout line says so, verbatim."""
    tree = _leg_a_tree(tmp_path)
    proc = _run(COUNTER, tmp_path, tree, "--ledger", tmp_path / "ledger.jsonl")
    assert _stdout_line(proc) == _counted(2, 3, 0)


# === leg (b) — M1: what discovery finds, and what it does not ===============

def test_b_a_directory_without_the_file_yields_no_row(tmp_path):
    """(b)/M1: the same tree with a third directory `nine/` holding only an
    `events.jsonl` yields no fourth row — discovery is "a directory holding
    `residuals.jsonl`", so a directory without the file counts nothing."""
    tree = _leg_a_tree(tmp_path)
    nine = tree / "nine"
    nine.mkdir(parents=True, exist_ok=True)
    (nine / "events.jsonl").write_text(
        json.dumps({"id": "01AAA001", "kind": "run:open", "runId": "run-9"})
        + "\n", encoding="utf-8")
    ledger = tmp_path / "ledger.jsonl"

    proc = _run(COUNTER, tmp_path, tree, "--ledger", ledger)
    assert proc.returncode == 0, proc.stderr
    assert _stdout_line(proc) == _counted(2, 3, 0)
    rows = _rows(ledger)
    assert len(rows) == 3, rows
    assert sorted(row["runId"] for row in rows) == ["run-7", "run-7", "run-8"]


def test_b_one_directory_as_the_only_path_appends_its_one_row(tmp_path):
    """(b)/M1: the counter given `eight/` as its one path appends exactly that
    one row, with `runId` `run-8`."""
    tree = _leg_a_tree(tmp_path)
    ledger = tmp_path / "ledger.jsonl"

    proc = _run(COUNTER, tmp_path, tree / "eight", "--ledger", ledger)
    assert proc.returncode == 0, proc.stderr
    assert _stdout_line(proc) == _counted(1, 1, 0)
    rows = _rows(ledger)
    assert len(rows) == 1, rows
    assert rows[0] == _expected_row(EIGHT_LINES[0])
    assert rows[0]["runId"] == "run-8"


def test_b_discovery_reaches_descendants_not_only_top_level_paths(tmp_path):
    """(b)/M1: the two `residuals.jsonl` files sit one level under the path
    given, so a discovery that reads only the top-level path finds nothing and
    appends nothing."""
    tree = _leg_a_tree(tmp_path)
    ledger = tmp_path / "ledger.jsonl"
    assert not (tree / "residuals.jsonl").exists()

    assert _run(COUNTER, tmp_path, tree, "--ledger", ledger).returncode == 0
    assert len(_rows(ledger)) == 3


# === leg (c) — M2: the key is `(file, normalized text)`, the id carries the run

def test_c_key_collapses_whitespace_and_lowercases(tmp_path):
    """(c)/M2: the two rows whose text differs only by a double space and a
    capital share one `key`, equal to the exam's own
    `sha256("fleet/x.mjs\\nthe exam covers the success path only")[:16]` — a
    key that does not collapse the double space, or does not lowercase, fails.
    """
    tree = _leg_a_tree(tmp_path)
    ledger = tmp_path / "ledger.jsonl"
    assert _run(COUNTER, tmp_path, tree, "--ledger", ledger).returncode == 0
    got = _by_text(_rows(ledger))

    second = got[("run-7", "the exam covers  the success path only")]
    third = got[("run-8", "The exam covers the success path only")]
    expected = _sha16("fleet/x.mjs\nthe exam covers the success path only")
    assert second["key"] == expected, second
    assert third["key"] == expected, third
    assert second["key"] == third["key"]


def test_c_a_null_file_hashes_as_the_empty_string(tmp_path):
    """(c)/M2: the first row's `key` equals the exam's own
    `sha256("\\ne1 dup insert")[:16]` — a null `file` hashed as the string
    `None` fails."""
    tree = _leg_a_tree(tmp_path)
    ledger = tmp_path / "ledger.jsonl"
    assert _run(COUNTER, tmp_path, tree, "--ledger", ledger).returncode == 0
    got = _by_text(_rows(ledger))

    first = got[("run-7", "E1 dup insert")]
    assert first["key"] == _sha16("\ne1 dup insert"), first
    assert first["key"] != _sha16("None\ne1 dup insert"), (
        "M2: the null `file` was hashed as the string `None`")


def test_c_ids_differ_by_run_and_carry_the_key(tmp_path):
    """(c)/M2: the same residual text on two runs yields two rows with equal
    `key` and different `id`; each `id` equals the exam's own
    `sha256("<runId>\\nresidual\\n<key>")[:16]` — an id without the run
    fails."""
    tree = _leg_a_tree(tmp_path)
    ledger = tmp_path / "ledger.jsonl"
    assert _run(COUNTER, tmp_path, tree, "--ledger", ledger).returncode == 0
    got = _by_text(_rows(ledger))

    second = got[("run-7", "the exam covers  the success path only")]
    third = got[("run-8", "The exam covers the success path only")]
    key = _sha16("fleet/x.mjs\nthe exam covers the success path only")
    assert second["id"] != third["id"], (second, third)
    assert second["id"] == _sha16("run-7\nresidual\n" + key), second
    assert third["id"] == _sha16("run-8\nresidual\n" + key), third


# === leg (d) — M3: append-only, idempotent, and the one stdout line =========

def test_d_a_second_pass_appends_nothing_and_changes_no_bytes(tmp_path):
    """(d)/M3: running the counter twice over leg (a)'s tree leaves the
    ledger's bytes identical, and prints
    `2 file(s) counted, 3 row(s) appended, 0 already recorded` the first time
    and `2 file(s) counted, 0 row(s) appended, 3 already recorded` the
    second."""
    tree = _leg_a_tree(tmp_path)
    ledger = tmp_path / "ledger.jsonl"

    first = _run(COUNTER, tmp_path, tree, "--ledger", ledger)
    assert first.returncode == 0, first.stderr
    assert _stdout_line(first) == _counted(2, 3, 0)
    before = ledger.read_bytes()

    second = _run(COUNTER, tmp_path, tree, "--ledger", ledger)
    assert second.returncode == 0, second.stderr
    assert _stdout_line(second) == _counted(2, 0, 3)
    assert ledger.read_bytes() == before, (
        "M3: the second pass rewrote the ledger's bytes")
    assert len(_rows(ledger)) == 3


def test_d_an_existing_findings_line_is_never_rewritten(tmp_path):
    """(d)/M3: a ledger pre-seeded with one findings line (no `kind`) still
    holds that exact line first afterwards — the counter appends beside it."""
    tree = _leg_a_tree(tmp_path)
    ledger = tmp_path / "ledger.jsonl"
    finding = json.dumps({"id": "0123456789abcdef", "lens": "friction",
                          "runId": "run-44", "title": "a finding"},
                         sort_keys=True)
    ledger.write_text(finding + "\n", encoding="utf-8")

    proc = _run(COUNTER, tmp_path, tree, "--ledger", ledger)
    assert proc.returncode == 0, proc.stderr
    lines = _lines(ledger)
    assert lines[0] == finding, (
        "M3: the pre-seeded findings line was rewritten; got %r" % (lines[0],))
    assert len(lines) == 4, lines


def test_d_the_ledgers_parent_directories_are_created(tmp_path):
    """(d)/M3: a ledger under a directory that does not yet exist is
    created."""
    tree = _leg_a_tree(tmp_path)
    ledger = tmp_path / "not" / "yet" / "residual-ledger.jsonl"
    assert not ledger.parent.exists()

    proc = _run(COUNTER, tmp_path, tree, "--ledger", ledger)
    assert proc.returncode == 0, proc.stderr
    assert ledger.is_file(), "M3: the ledger's parent directories were not made"
    assert len(_rows(ledger)) == 3


def test_d_without_ledger_nothing_is_appended(tmp_path):
    """(d)/M3: without `--ledger` nothing is appended — the ledger is absent
    afterwards and stdout is
    `2 file(s) counted, 0 row(s) appended, 0 already recorded`."""
    tree = _leg_a_tree(tmp_path)
    ledger = tmp_path / "ledger.jsonl"

    proc = _run(COUNTER, tmp_path, tree)
    assert proc.returncode == 0, proc.stderr
    assert _stdout_line(proc) == _counted(2, 0, 0)
    assert not ledger.exists(), "M3: a ledger was written without `--ledger`"


def test_d_counter_help_names_ledger(tmp_path):
    """(d)/M3, and the fourth `Run:`: `residual_counter.py --help` names
    `--ledger`."""
    proc = _run(COUNTER, tmp_path, "--help")
    assert proc.returncode == 0, proc.stderr
    assert "--ledger" in proc.stdout, proc.stdout


# === leg (e) — M4: the report names the repeats =============================

def _residual_ledger_row(run_id, text, file=None, task=None, line=None,
                         kind="deferred", sha="d" * 40):
    """A `residual` ledger row of the shape M1/M2 pin, written by hand so the
    ledger's order — and so "the text as first seen" — is the exam's own."""
    return _expected_row({"file": file, "kind": kind, "line": line,
                          "run": run_id, "sha": sha, "task": task,
                          "text": text})


def _write_ledger(path, rows):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(
        "".join(json.dumps(row, sort_keys=True) + "\n" for row in rows),
        encoding="utf-8")
    return path


def _report_lines(tmp_path, ledger):
    proc = _run(REPORT, tmp_path, "--ledger", ledger)
    assert proc.returncode == 0, proc.stderr
    assert "Traceback" not in proc.stderr, proc.stderr
    return proc.stdout.splitlines()


def test_e_report_lists_the_text_seen_on_two_runs(tmp_path):
    """(e)/M4: over a ledger holding leg (a)'s three rows plus one
    `catch-count` row and one findings row, the report prints exactly
    `## Residual candidates` then exactly one candidate line — the text as
    first seen, its two runs and its one file. `E1 dup insert` (one run, no
    file) is absent.

    Both control rows carry the same `text` on further runs on purpose: a
    reader that does not filter on `kind` would print `run-9` and `run-10` in
    the same line, so "every other row kind contributes nothing" is live."""
    repeated = "the exam covers  the success path only"
    rows = [_expected_row(SEVEN_LINES[0]), _expected_row(SEVEN_LINES[1]),
            _expected_row(EIGHT_LINES[0]),
            {"id": "1111111111111111", "kind": "catch-count", "runId": "run-9",
             "text": repeated, "file": "fleet/y.mjs", "catches": {},
             "touched": [], "exercises": {}},
            {"id": "2222222222222222", "lens": "friction", "runId": "run-10",
             "title": "a finding", "text": repeated, "file": "fleet/z.mjs"}]
    ledger = _write_ledger(tmp_path / "ledger.jsonl", rows)

    lines = _report_lines(tmp_path, ledger)
    assert lines == [
        HEADING,
        "- the exam covers  the success path only | runs: run-7, run-8 "
        "| files: fleet/x.mjs",
    ], lines
    assert not [line for line in lines if "E1 dup insert" in line], lines


def test_e_report_lists_one_run_on_two_files(tmp_path):
    """(e)/M4: a ledger whose only two `residual` rows share the text
    `same words` with `file` `a/one.py` and `a/two.py` on the one run `run-9`
    prints the line `- same words | runs: run-9 | files: a/one.py, a/two.py` —
    the ≥2-files half of the rule."""
    ledger = _write_ledger(tmp_path / "ledger.jsonl", [
        _residual_ledger_row("run-9", "same words", file="a/one.py"),
        _residual_ledger_row("run-9", "same words", file="a/two.py")])

    assert _report_lines(tmp_path, ledger) == [
        HEADING, "- same words | runs: run-9 | files: a/one.py, a/two.py"]


def test_e_one_run_on_one_file_is_not_a_candidate(tmp_path):
    """(e)/M4: a ledger with one `residual` row prints `(none)` as its second
    line — a group seen in one run on one file is not listed."""
    ledger = _write_ledger(tmp_path / "ledger.jsonl", [
        _residual_ledger_row("run-9", "lonely words", file="a/one.py")])

    lines = _report_lines(tmp_path, ledger)
    assert lines == [HEADING, NONE_LINE], lines


def test_e_two_different_texts_on_one_run_each_qualify_nothing(tmp_path):
    """(e)/M4: a ledger with two `residual` rows of different texts on one run
    each prints `(none)` — the count is per group, not per ledger."""
    ledger = _write_ledger(tmp_path / "ledger.jsonl", [
        _residual_ledger_row("run-1", "first words", file="a/one.py"),
        _residual_ledger_row("run-2", "second words", file="a/two.py")])

    assert _report_lines(tmp_path, ledger) == [HEADING, NONE_LINE]


def test_e_missing_ledger_reads_as_no_rows(tmp_path):
    """(e)/M4, and the second `Run:`: a ledger path that does not exist reads
    as no rows — the second line is exactly `(none)`."""
    lines = _report_lines(tmp_path, tmp_path / "nope" / "residual-ledger.jsonl")
    assert lines == [HEADING, NONE_LINE], lines


def test_e_order_is_run_count_descending(tmp_path):
    """(e)/M4: a ledger whose `residual` rows put `zeta` on `run-1`, `run-2`,
    `run-3` and `alpha` on `run-1`, `run-2` (all `file` null) prints the `zeta`
    line before the `alpha` line — text-ascending or run-count-ascending order
    fails. `files:` reads `-` when a group names no file."""
    ledger = _write_ledger(tmp_path / "ledger.jsonl", [
        _residual_ledger_row("run-1", "alpha"),
        _residual_ledger_row("run-2", "alpha"),
        _residual_ledger_row("run-1", "zeta"),
        _residual_ledger_row("run-2", "zeta"),
        _residual_ledger_row("run-3", "zeta")])

    assert _report_lines(tmp_path, ledger) == [
        HEADING,
        "- zeta | runs: run-1, run-2, run-3 | files: -",
        "- alpha | runs: run-1, run-2 | files: -"]


def test_e_ties_are_broken_by_text_ascending(tmp_path):
    """(e)/M4: a ledger whose rows put `beta` and `alpha` each on `run-1`,
    `run-2` prints the `alpha` line before the `beta` line, each as
    `- <text> | runs: run-1, run-2 | files: -` — a tie broken by first-seen
    order fails, since `beta` is seen first here."""
    ledger = _write_ledger(tmp_path / "ledger.jsonl", [
        _residual_ledger_row("run-1", "beta"),
        _residual_ledger_row("run-2", "beta"),
        _residual_ledger_row("run-1", "alpha"),
        _residual_ledger_row("run-2", "alpha")])

    assert _report_lines(tmp_path, ledger) == [
        HEADING,
        "- alpha | runs: run-1, run-2 | files: -",
        "- beta | runs: run-1, run-2 | files: -"]


def test_e_report_over_the_counters_own_ledger_names_the_repeat(tmp_path):
    """(e)/M4 with (a)/M1: the counter's own ledger, not a hand-written one,
    yields exactly one candidate — the words seen on `run-7` and `run-8` on
    `fleet/x.mjs`. Only the run and file columns are pinned here; which of the
    two spellings is "first seen" depends on the counter's walk order, which no
    clause pins."""
    tree = _leg_a_tree(tmp_path)
    ledger = tmp_path / "ledger.jsonl"
    assert _run(COUNTER, tmp_path, tree, "--ledger", ledger).returncode == 0

    lines = _report_lines(tmp_path, ledger)
    assert lines[0] == HEADING
    assert len(lines) == 2, lines
    assert lines[1].endswith(" | runs: run-7, run-8 | files: fleet/x.mjs"), lines
    assert lines[1].startswith("- "), lines


# === leg (f) — M5: the skill says how the counter is read ====================

def _skill_lines():
    return SKILL.read_text(encoding="utf-8").splitlines()


def _heading_index(prefix):
    """0-based index of the one line starting with `prefix`."""
    lines = _skill_lines()
    hits = [n for n, line in enumerate(lines) if line.startswith(prefix)]
    assert len(hits) == 1, (
        "SKILL.md has %d lines starting with %r, expected exactly one"
        % (len(hits), prefix))
    return hits[0]


def _sed_range(start_prefix, end_prefix):
    """The lines `sed -n '/^<start>/,/^<end>/p'` prints — from the start
    heading through the first later line starting with `end_prefix`, both
    included."""
    lines = _skill_lines()
    start = _heading_index(start_prefix)
    for n in range(start + 1, len(lines)):
        if lines[n].startswith(end_prefix):
            return lines[start:n + 1]
    return lines[start:]


def _residual_section():
    """The residual-counter section: its heading through the line before the
    next `## ` heading."""
    lines = _skill_lines()
    start = _heading_index(RESIDUAL_HEADING)
    for n in range(start + 1, len(lines)):
        if lines[n].startswith("## "):
            return "\n".join(lines[start:n])
    return "\n".join(lines[start:])


def _help(script):
    proc = _run(script, REPO, "--help")
    assert proc.returncode == 0, (
        "%s --help exited %d\n%s%s"
        % (script.name, proc.returncode, proc.stdout, proc.stderr))
    return proc.stdout


def test_f_the_section_sits_between_the_catch_counter_and_verb_2():
    """(f)/M5: exactly one line `## The residual counter` sits inside the
    `## The catch counter` … `## Verb 2` range — the `Run:` that counts it. A
    section placed after `## Verb 2` or before `## The catch counter` counts
    zero and fails."""
    catch_range = _sed_range(CATCH_HEADING, VERB2_HEADING)
    hits = [line for line in catch_range if line.startswith(RESIDUAL_HEADING)]
    assert len(hits) == 1, (
        "expected exactly one %r line between %r and %r, found %d"
        % (RESIDUAL_HEADING, CATCH_HEADING, VERB2_HEADING, len(hits)))
    assert catch_range[0].startswith(CATCH_HEADING)
    assert catch_range[-1].startswith(VERB2_HEADING)


def test_f_the_section_names_both_scripts_and_the_input_file():
    """(f)/M5, the fourth and fifth `Run:`: the section, joined on one line,
    names `residual_counter.py` then `residual_report.py`, and `residuals.jsonl`
    then `normalized text` — the two `Run:` patterns' own order."""
    one_line = _residual_section().replace("\n", " ")
    assert re.search(r"residual_counter\.py.*residual_report\.py", one_line), (
        "the section does not name residual_counter.py then "
        "residual_report.py:\n%s" % one_line)
    assert re.search(r"residuals\.jsonl.*normalized text", one_line), (
        "the section does not name residuals.jsonl then `normalized text`:\n%s"
        % one_line)


def test_f_the_section_names_the_key_and_the_two_or_more_rule():
    """(f)/M5: the section, joined on one line, contains `(file, normalized
    text)`, `two or more runs` and `two or more files` — the key the ledger is
    keyed by and both halves of the candidate rule."""
    one_line = _residual_section().replace("\n", " ")
    for token in ("(file, normalized text)", "two or more runs",
                  "two or more files"):
        assert token in one_line, (
            "the residual-counter section does not contain %r:\n%s"
            % (token, one_line))


def test_f_every_flag_the_section_advertises_exists():
    """(f)/M5: every `--[a-z][a-z-]*` token in the section is a flag one of the
    two CLIs prints under `--help` — a section advertising `--n`, which neither
    script has, fails."""
    advertised = set(re.findall(r"--[a-z][a-z-]*", _residual_section()))
    both = _help(COUNTER) + "\n" + _help(REPORT)
    for flag in sorted(advertised):
        assert flag in both, (
            "the residual-counter section advertises %s, neither CLI has such "
            "a flag" % flag)
    assert "--nope" not in both, (
        "the union of the two help texts contains `--nope`, so this check pins "
        "nothing")


def test_f_validate_skill_accepts_the_ultralearn_skill():
    """(f)/M5, the last `Run:`: `validate_skill.py` accepts the skill after the
    section is added."""
    proc = subprocess.run([sys.executable, str(VALIDATE),
                           str(REPO / "skills/ultralearn")],
                          capture_output=True, text=True)
    assert proc.returncode == 0, (
        "validate_skill.py exited %d\n%s%s"
        % (proc.returncode, proc.stdout, proc.stderr))
