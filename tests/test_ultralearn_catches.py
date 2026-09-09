"""Exam for task 1 — the counter derives a run's catches from its record.

Every assertion names the Proof leg (a)–(n) and the Machine clause (M1–M10) it
comes from, so the file reads back against the contract.

The claim under test: "A catch is a red the fix round then turned green by
editing implementation files, never the test and never by re-run alone."

`skills/ultralearn/scripts/catch_counter.py` is this task's deliverable, so at
BASE every test here is red for one reason — `_load()` says the script does not
exist yet, in as many words, rather than letting the absence surface as a
collection error.

Every fixture run directory is built under pytest's `tmp_path`: the record this
counter reads is the engine's, and the exam writes no bytes into the tree.
"""
import hashlib
import importlib.util
import json
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
SCRIPT = REPO / "skills/ultralearn/scripts/catch_counter.py"
SCRIPTS_DIR = REPO / "skills/ultralearn/scripts"

# M7: the row is exactly these keys — no more, no fewer.
ROW_KEYS = {"kind", "runId", "driverRuns", "catches", "reds", "touched",
            "exercises"}

# The Context's outcome vocabulary, one of which every `reds` entry carries.
OUTCOMES = {"caught", "exam-edited", "task-writes", "rerun", "stayed-red",
            "no-green"}

THING = "fleet/tests/test_thing.mjs"
THING_CMD = "node fleet/tests/test_thing.mjs"
OTHER = "tests/test_other.py"
OTHER_CMD = "python3 -m pytest -q tests/test_other.py"

T0 = 1788130000000


def _load():
    """Import the counter, naming it as this task's deliverable when absent."""
    assert SCRIPT.is_file(), (
        "%s is a deliverable of this task and does not exist"
        % SCRIPT.relative_to(REPO))
    if str(SCRIPTS_DIR) not in sys.path:
        sys.path.insert(0, str(SCRIPTS_DIR))
    spec = importlib.util.spec_from_file_location("catch_counter", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# --- fixtures --------------------------------------------------------------
#
# The engine's shapes, as the task's Context spells them: `events.jsonl` is one
# JSON object per line and sorts by `id` (never by `ts`); `report.json` carries
# `tasks[]` rows keyed by a string `task`; `receipt.json` carries
# `compile.tasks[]` entries keyed by a string `id`.

def _ev(seq, **fields):
    """One event record. `id` is the order; `ts` is only the wall clock."""
    return dict(fields, id="01AAA%03d" % seq, ts=T0 + seq * 1000)


def _run_open(seq, run_id):
    return _ev(seq, kind="run:open", runId=run_id, base="",
               source="fleet/run-main.mjs")


def _driver_run(seq, kind, task, cmd, exit_code, **extra):
    return _ev(seq, kind=kind, task=task, cmd=cmd, exit=exit_code, iter=0,
               **extra)


def _fix_end(seq, label):
    return _ev(seq, kind="worker:end", label=label, role="implementer",
               exitCode=0, outcome="ok")


def _write_run(run_dir, events, report=None, receipt=None):
    """One run directory. `report.json`/`receipt.json` are written only when
    given — a run directory may lack either file (M10)."""
    run_dir.mkdir(parents=True, exist_ok=True)
    (run_dir / "events.jsonl").write_text(
        "".join(json.dumps(e) + "\n" for e in events), encoding="utf-8")
    if report is not None:
        (run_dir / "report.json").write_text(json.dumps(report),
                                             encoding="utf-8")
    if receipt is not None:
        (run_dir / "receipt.json").write_text(json.dumps(receipt),
                                              encoding="utf-8")
    return run_dir


def _report(rows):
    return {"tasks": rows}

def _receipt(entries):
    return {"compile": {"tasks": entries}}


def base_fixture(run_dir, kind="driver:exam-run", run_id="run-77",
                 exam_edited=(), writes=("fleet/thing.mjs",), with_fix=True,
                 green_exit=0, with_green=True, extra=None):
    """Leg (a)'s fixture, and every variation the other legs ask for.

    `run:open`, a red driver run of `kind` for task `1` naming
    `fleet/tests/test_thing.mjs`, a `fix:1:0` `worker:end`, then the same
    driver run green.
    """
    extra = extra or {}
    events = [_run_open(1, run_id),
              _driver_run(2, kind, "1", THING_CMD, 1, **extra)]
    if with_fix:
        events.append(_fix_end(3, "fix:1:0"))
    if with_green:
        events.append(_driver_run(4, kind, "1", THING_CMD, green_exit,
                                  **extra))
    return _write_run(
        run_dir, events,
        report=_report([{"task": "1", "proofFixes": 1, "fixIterations": 1,
                         "examEdited": list(exam_edited)}]),
        receipt=_receipt([{"id": "1", "writes": list(writes)}]))


def _only(reds):
    """The one `reds` entry, or a failure naming what was there instead."""
    assert len(reds) == 1, "expected exactly one reds entry, got %r" % (reds,)
    return reds[0]


def _pins(entry, **expected):
    """The pinned fields of a `reds` entry, compared as a whole."""
    return {k: entry.get(k) for k in expected} == expected


# --- leg (a) — M1: the credit ---------------------------------------------

def test_a_exam_run_red_then_fix_then_green_is_one_catch(tmp_path):
    """(a)/M1: a `driver:exam-run` red naming `fleet/tests/test_thing.mjs`, a
    `fix:1:0` `worker:end`, then the same run green, with an `examEdited` that
    does not name the path and a `writes` that does not name it either, is one
    catch: `catches` is exactly that one key at 1, and `reds` is exactly one
    entry, task `"1"`, that path, outcome `caught`."""
    counter = _load()
    row = counter.derive_catches(base_fixture(tmp_path / "run-77"))
    assert row["catches"] == {THING: 1}
    entry = _only(row["reds"])
    assert _pins(entry, task="1", kind="driver:exam-run", path=THING,
                 cmd=THING_CMD, outcome="caught"), entry


# --- leg (b) — M1: the same credit under `driver:proof-run` -----------------

def test_b_proof_run_red_then_fix_then_green_is_one_catch(tmp_path):
    """(b)/M1: the same fixture with both events as `driver:proof-run` credits
    identically — the rule is over all three driver-run kinds."""
    counter = _load()
    row = counter.derive_catches(
        base_fixture(tmp_path / "run-77", kind="driver:proof-run"))
    assert row["catches"] == {THING: 1}
    entry = _only(row["reds"])
    assert _pins(entry, task="1", kind="driver:proof-run", path=THING,
                 cmd=THING_CMD, outcome="caught"), entry


# --- leg (c) — M1: the same credit under `driver:check-run` -----------------

def test_c_check_run_red_then_fix_then_green_is_one_catch(tmp_path):
    """(c)/M1: the same fixture as `driver:check-run` (which carries the extra
    `minor` field) credits identically."""
    counter = _load()
    row = counter.derive_catches(
        base_fixture(tmp_path / "run-77", kind="driver:check-run",
                     extra={"minor": False}))
    assert row["catches"] == {THING: 1}
    entry = _only(row["reds"])
    assert _pins(entry, task="1", kind="driver:check-run", path=THING,
                 cmd=THING_CMD, outcome="caught"), entry


# --- leg (d) — M2: never the test, when the exam moved ----------------------

def test_d_exam_edited_path_is_not_a_catch(tmp_path):
    """(d)/M2: when the report row's `examEdited` names the path, the green is
    not a catch — `catches` is exactly `{}` (the key absent) and the one `reds`
    entry reads `exam-edited`, not `caught`."""
    counter = _load()
    row = counter.derive_catches(
        base_fixture(tmp_path / "run-77", exam_edited=[THING]))
    assert row["catches"] == {}
    assert THING not in row["catches"]
    entry = _only(row["reds"])
    assert _pins(entry, task="1", path=THING, outcome="exam-edited"), entry


# --- leg (e) — M3: never the test, when the task owns it --------------------

def test_e_path_in_task_writes_is_not_a_catch(tmp_path):
    """(e)/M3: when the test path is one of the task's own `writes`, the green
    is not a catch — `catches` is exactly `{}` and the outcome is
    `task-writes`, not `caught`."""
    counter = _load()
    row = counter.derive_catches(
        base_fixture(tmp_path / "run-77",
                     writes=["fleet/thing.mjs", THING]))
    assert row["catches"] == {}
    assert THING not in row["catches"]
    entry = _only(row["reds"])
    assert _pins(entry, task="1", path=THING, outcome="task-writes"), entry


# --- leg (f) — M4: never by re-run alone ------------------------------------

def test_f_green_without_an_intervening_fix_round_is_a_rerun(tmp_path):
    """(f)/M4: with no `fix:1:` `worker:end` between the red and the green,
    nothing was fixed — `catches` is exactly `{}` and the outcome is `rerun`,
    not `caught`."""
    counter = _load()
    row = counter.derive_catches(
        base_fixture(tmp_path / "run-77", with_fix=False))
    assert row["catches"] == {}
    assert THING not in row["catches"]
    entry = _only(row["reds"])
    assert _pins(entry, task="1", path=THING, outcome="rerun"), entry


# --- leg (g) — M5: the red that never went green ----------------------------

def test_g_next_same_run_still_red_is_stayed_red(tmp_path):
    """(g)/M5: when the next same-kind same-`cmd` run for the task is itself
    non-zero, the first red reads `stayed-red` and nothing is credited."""
    counter = _load()
    row = counter.derive_catches(
        base_fixture(tmp_path / "run-77", green_exit=1))
    assert row["catches"] == {}
    assert THING not in row["catches"]
    assert row["reds"][0].get("outcome") == "stayed-red", row["reds"]
    assert row["reds"][0].get("path") == THING
    assert not [e for e in row["reds"] if e.get("outcome") == "caught"]


def test_g_no_later_same_run_is_no_green(tmp_path):
    """(g)/M5: when no later same-kind same-`cmd` run for the task exists at
    all, the red reads `no-green` and nothing is credited."""
    counter = _load()
    row = counter.derive_catches(
        base_fixture(tmp_path / "run-77", with_green=False))
    assert row["catches"] == {}
    assert THING not in row["catches"]
    entry = _only(row["reds"])
    assert _pins(entry, task="1", path=THING, outcome="no-green"), entry


# --- leg (h) — M6: one credit per path per fix round ------------------------

def test_h_two_kinds_of_red_before_one_fix_round_credit_once(tmp_path):
    """(h)/M6: a red `driver:proof-run` and a red `driver:check-run` for the
    same task naming the same path, one `fix:1:0` `worker:end`, then both
    green — the path is credited 1, not 2, and both reds are recorded."""
    counter = _load()
    run_dir = _write_run(
        tmp_path / "run-8",
        [_run_open(1, "run-8"),
         _driver_run(2, "driver:proof-run", "1", THING_CMD, 1),
         _driver_run(3, "driver:check-run", "1", THING_CMD, 1, minor=False),
         _fix_end(4, "fix:1:0"),
         _driver_run(5, "driver:proof-run", "1", THING_CMD, 0),
         _driver_run(6, "driver:check-run", "1", THING_CMD, 0, minor=False)],
        report=_report([{"task": "1", "examEdited": []}]),
        receipt=_receipt([{"id": "1", "writes": ["fleet/thing.mjs"]}]))
    row = counter.derive_catches(run_dir)
    assert row["catches"] == {THING: 1}
    assert len(row["reds"]) == 2, row["reds"]
    assert {e.get("kind") for e in row["reds"]} == {"driver:proof-run",
                                                   "driver:check-run"}


# --- leg (i) — M7: the row's shape ------------------------------------------

def test_i_row_has_exactly_the_seven_keys(tmp_path):
    """(i)/M7: the row of (a) carries exactly `kind`, `runId`, `driverRuns`,
    `catches`, `reds`, `touched`, `exercises`; `kind` is `catch-count`,
    `runId` is the `run:open` event's, and `driverRuns` counts the two
    driver-run events."""
    counter = _load()
    row = counter.derive_catches(base_fixture(tmp_path / "run-77"))
    assert set(row) == ROW_KEYS
    assert row["kind"] == "catch-count"
    assert row["runId"] == "run-77"
    assert row["driverRuns"] == 2


def test_i_touched_and_exercises_are_sorted_unions(tmp_path):
    """(i)/M7: with a second task `2` whose only event is a green
    `driver:proof-run` naming `tests/test_other.py` and whose `writes` are
    `["lib/other.py"]`, `touched` is the sorted union of every receipt
    `writes` and `exercises[T]` is the sorted union of the `writes` of every
    task whose driver runs named `T` — the green run counts too."""
    counter = _load()
    run_dir = _write_run(
        tmp_path / "run-77",
        [_run_open(1, "run-77"),
         _driver_run(2, "driver:exam-run", "1", THING_CMD, 1),
         _fix_end(3, "fix:1:0"),
         _driver_run(4, "driver:exam-run", "1", THING_CMD, 0),
         _driver_run(5, "driver:proof-run", "2", OTHER_CMD, 0)],
        report=_report([{"task": "1", "examEdited": []},
                        {"task": "2", "examEdited": []}]),
        receipt=_receipt([{"id": "1", "writes": ["fleet/thing.mjs"]},
                          {"id": "2", "writes": ["lib/other.py"]}]))
    row = counter.derive_catches(run_dir)
    assert row["driverRuns"] == 3
    assert row["touched"] == ["fleet/thing.mjs", "lib/other.py"]
    assert row["exercises"] == {THING: ["fleet/thing.mjs"],
                                OTHER: ["lib/other.py"]}
    assert row["catches"] == {THING: 1}


# --- leg (j) — M8: what counts as a test path -------------------------------

def test_j_test_paths_of_reads_the_tokens_in_order(tmp_path):
    """(j)/M8: a piped node command yields its one `.mjs` path; a pytest
    command yields both paths in order of appearance; a `git diff` naming an
    implementation file yields none."""
    counter = _load()
    assert counter.test_paths_of(
        "node fleet/tests/test_x.mjs | grep -q 'ALL TESTS PASSED'") == [
            "fleet/tests/test_x.mjs"]
    assert counter.test_paths_of(
        "python3 -m pytest -q tests/test_a.py tests/test_b.py") == [
            "tests/test_a.py", "tests/test_b.py"]
    assert counter.test_paths_of(
        "git diff --quiet $ULTRA_BASE -- fleet/x.mjs") == []


def test_j_a_red_naming_no_test_path_adds_nothing(tmp_path):
    """(j)/M8: a red whose `cmd` matches no test path adds nothing to `reds`
    and nothing to `catches`."""
    counter = _load()
    cmd = "git diff --quiet $ULTRA_BASE -- fleet/x.mjs"
    run_dir = _write_run(
        tmp_path / "run-77",
        [_run_open(1, "run-77"),
         _driver_run(2, "driver:check-run", "1", cmd, 1, minor=False),
         _fix_end(3, "fix:1:0"),
         _driver_run(4, "driver:check-run", "1", cmd, 0, minor=False)],
        report=_report([{"task": "1", "examEdited": []}]),
        receipt=_receipt([{"id": "1", "writes": ["fleet/x.mjs"]}]))
    row = counter.derive_catches(run_dir)
    assert row["reds"] == []
    assert row["catches"] == {}


# --- leg (k) — M9: the append is idempotent ---------------------------------

def _row(run_id, **over):
    """A catch-count row of the shape `derive_catches` returns."""
    return dict({"kind": "catch-count", "runId": run_id, "driverRuns": 2,
                 "catches": {THING: 1},
                 "reds": [{"task": "1", "kind": "driver:exam-run",
                           "path": THING, "cmd": THING_CMD,
                           "outcome": "caught"}],
                 "touched": ["fleet/thing.mjs"],
                 "exercises": {THING: ["fleet/thing.mjs"]}}, **over)


def _expected_id(run_id):
    """M9's id: the first 16 hex digits of the SHA-256 of the UTF-8 bytes of
    `runId + "\\n" + "catch-count"`."""
    return hashlib.sha256(
        (run_id + "\n" + "catch-count").encode("utf-8")).hexdigest()[:16]


def _lines(path):
    return [l for l in path.read_text(encoding="utf-8").splitlines() if l.strip()]


def test_k_append_rows_creates_parents_stamps_ids_and_is_idempotent(tmp_path):
    """(k)/M9: appending two rows to a ledger whose parent directory does not
    exist writes two lines, each carrying the pinned `id`, and returns
    `{"added": 2, "skipped": 0}`; a second call with the same rows returns
    `{"added": 0, "skipped": 2}` and leaves the file's bytes unchanged."""
    counter = _load()
    ledger = tmp_path / "not" / "yet" / "ledger.jsonl"
    rows = [_row("run-77"), _row("run-78")]

    assert counter.append_rows(rows, ledger) == {"added": 2, "skipped": 0}
    assert ledger.is_file()
    written = [json.loads(l) for l in _lines(ledger)]
    assert len(written) == 2
    assert [w["runId"] for w in written] == ["run-77", "run-78"]
    assert [w["id"] for w in written] == [_expected_id("run-77"),
                                          _expected_id("run-78")]
    assert [w["kind"] for w in written] == ["catch-count", "catch-count"]
    assert written[0]["catches"] == {THING: 1}

    before = ledger.read_bytes()
    assert counter.append_rows(rows, ledger) == {"added": 0, "skipped": 2}
    assert ledger.read_bytes() == before


def test_k_append_rows_never_rewrites_an_existing_findings_line(tmp_path):
    """(k)/M9: the ledger's other lines are findings rows; the counter appends
    beside them — the pre-seeded line stays byte-for-byte the first line."""
    counter = _load()
    ledger = tmp_path / "ledger.jsonl"
    finding = json.dumps({"runId": "run-44", "lens": "friction",
                          "title": "a finding", "id": "0123456789abcdef"},
                         sort_keys=True)
    ledger.write_text(finding + "\n", encoding="utf-8")

    assert counter.append_rows([_row("run-77")], ledger) == {"added": 1,
                                                             "skipped": 0}
    lines = _lines(ledger)
    assert lines[0] == finding
    assert len(lines) == 2
    assert json.loads(lines[1])["id"] == _expected_id("run-77")


# --- legs (l), (m), (n) — M10: the CLI --------------------------------------

def _cli(tmp_path, *args):
    """Invoke the CLI with `sys.executable`, cwd = tmp_path."""
    assert SCRIPT.is_file(), (
        "%s is a deliverable of this task and does not exist"
        % SCRIPT.relative_to(REPO))
    return subprocess.run(
        [sys.executable, str(SCRIPT), *[str(a) for a in args]],
        cwd=str(tmp_path), capture_output=True, text=True)


def _stdout_line(proc):
    lines = [l for l in proc.stdout.splitlines() if l.strip()]
    assert len(lines) == 1, (
        "expected one stdout line, got %r (stderr: %r)"
        % (proc.stdout, proc.stderr))
    return lines[0]


def test_l_cli_over_a_tree_counts_appends_and_then_skips(tmp_path):
    """(l)/M10: a tree holding two run directories yields one row each — the
    CLI prints `2 run(s) counted, 2 row(s) appended, 0 already recorded` and
    exits 0; run again over the same tree and ledger, the same two rows are
    already recorded and nothing is appended."""
    counter = _load()
    tree = tmp_path / "tree"
    base_fixture(tree / "run-201", run_id="run-201")
    base_fixture(tree / "run-202", run_id="run-202")
    ledger = tmp_path / "led" / "ledger.jsonl"

    first = _cli(tmp_path, tree, "--ledger", ledger)
    assert first.returncode == 0, first.stderr
    assert _stdout_line(first) == "2 run(s) counted, 2 row(s) appended, 0 already recorded"
    assert len(_lines(ledger)) == 2
    assert {json.loads(l)["runId"] for l in _lines(ledger)} == {"run-201",
                                                               "run-202"}

    before = ledger.read_bytes()
    second = _cli(tmp_path, tree, "--ledger", ledger)
    assert second.returncode == 0, second.stderr
    assert _stdout_line(second) == "2 run(s) counted, 0 row(s) appended, 2 already recorded"
    assert ledger.read_bytes() == before


def test_m_cli_on_a_path_with_no_run_directory_looks_empty(tmp_path):
    """(m)/M10: a path under which no directory holds an `events.jsonl` prints
    one line beginning `LOOKED-EMPTY:` on stderr — "I looked and there was
    nothing" — and the process still exits 0."""
    empty = tmp_path / "empty"
    empty.mkdir()
    proc = _cli(tmp_path, empty, "--ledger", tmp_path / "ledger.jsonl")
    assert proc.returncode == 0, proc.stderr
    assert [l for l in proc.stderr.splitlines()
            if l.startswith("LOOKED-EMPTY:")], proc.stderr


def test_n_run_directory_without_report_or_receipt_still_yields_a_row(tmp_path):
    """(n)/M10: a bare run directory holding only an `events.jsonl` — no
    `report.json`, no `receipt.json` — exits 0 with no traceback, and its
    appended row has empty `catches`, `touched` and `exercises`."""
    run_dir = _write_run(
        tmp_path / "run-99",
        [_run_open(1, "run-99"),
         _driver_run(2, "driver:exam-run", "1",
                     "python3 -m pytest -q tests/test_lonely.py", 0)])
    ledger = tmp_path / "ledger.jsonl"

    proc = _cli(tmp_path, run_dir, "--ledger", ledger)
    assert proc.returncode == 0, proc.stderr
    assert "Traceback" not in proc.stderr
    assert _stdout_line(proc) == "1 run(s) counted, 1 row(s) appended, 0 already recorded"
    written = [json.loads(l) for l in _lines(ledger)]
    assert len(written) == 1
    row = written[0]
    assert row["runId"] == "run-99"
    assert row["catches"] == {}
    assert row["touched"] == []
    assert row["exercises"] == {}


# --- the vocabulary, across every leg ---------------------------------------

def test_every_reds_outcome_is_one_of_the_six(tmp_path):
    """M1–M5: `outcome` is one of `caught`, `exam-edited`, `task-writes`,
    `rerun`, `stayed-red`, `no-green` — no seventh spelling."""
    counter = _load()
    for i, kwargs in enumerate([{}, {"exam_edited": [THING]},
                                {"writes": ["fleet/thing.mjs", THING]},
                                {"with_fix": False}, {"green_exit": 1},
                                {"with_green": False}]):
        row = counter.derive_catches(
            base_fixture(tmp_path / ("run-%d" % i), **kwargs))
        for entry in row["reds"]:
            assert entry.get("outcome") in OUTCOMES, entry
