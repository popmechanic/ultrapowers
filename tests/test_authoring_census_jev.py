"""The census reads the amendment reads: three columns and the totals line.

The exam for task 5 — `skills/ultrawrite/scripts/authoring_census.py` gaining
`compelled`, `plan_fault` and `magnitude` after `amendments`, the matching
`totals:` fields, and the `jev_cells(report)` seam. Leg by leg, in the Proof's
own order:

  * (a)/[M1] `--from` over the five-run root prints a header whose
    tab-separated names end `…\\trun_min\\tamendments\\tcompelled\\tplan_fault\\t
    magnitude`, and that header equals the imported `COLUMNS` — the three new
    names in that order, directly after `amendments`.
  * (b)/[M2] in that table the four-row run's last three cells are `2/3`,
    `1/3`, `0/1/1/1`; the empty-list run's and the no-`jev`-rows run's are
    `0/0`, `0/0`, `0/0/0/0` (the latter with its `amendments` cell its row
    count); the no-list run's and the no-report run's are `-`, `-`, `-`. Read
    at the seam the clause names, `jev_cells` over the Proof's own literal is
    `((1, 2), (1, 2), (0, 0, 1, 1))` — the `null`, the string and the absent
    `jev` all outside `R` — and `jev_cells({})` is `None`.
  * (c)/[M3] that table's last line ends ` amendments=6 compelled=2/3
    plan_fault=1/3 magnitude=0/1/1/1`, and a root holding only the no-list and
    no-report runs ends ` amendments=0 compelled=0/0 plan_fault=0/0
    magnitude=0/0/0/0`.
  * (d)/[M4] `--register` over the same root prints byte for byte what the same
    records print with no `report.json` beside them — which is what BASE's
    fixture records printed, no `jev` field reaching the register — the row
    order and every cell before `amendments` are unchanged, and both sibling
    exams still define exactly 19 `def test_` functions.

The script is driven as a subprocess over directories built under `tmp_path`,
exactly as the two sibling census exams do; their helpers are copied here,
never imported — the task says so, and the three files are graded apart.

Four readings this file pins, each from the task's own words:

  * The buckets are `min(3, max(0, floor(x + 0.5)))`, not Python's `round`.
    Leg (b)'s own fixture carries `0.5` and `2.5`, the two values where the two
    disagree: `floor(0.5 + 0.5)` is 1 and `floor(2.5 + 0.5)` is 3, where
    banker's rounding reads 0 and 2. `0/1/1/1` is therefore live against the
    banker's spelling, and the clamp's two ends — `3.4` and a negative — get an
    assertion of their own off `jev_cells`, M2 spelling both.
  * The `totals:` line is asserted whole, including the ` runs=<lo>..<hi>`
    field BASE already prints: M3 says the three fields are *gained* directly
    after ` amendments=<n>`, and M4 pins everything before them as BASE's.
  * A report that parses and carries no `amendments` list reads `-` in all
    three, never `0/0` — M2's own split, and the same split the `amendments`
    column has carried since it landed. A list carrying no `jev` row reads
    `0/0` and `0/0/0/0`: no read is a value the file carries, an absent list is
    not.
  * Leg (d)'s "the four `Run:` lines below exit 0" is two different things.
    The `def test_` counts are a read of two files, and this exam reads them.
    The two `pytest` lines are the Proof's own `Run:` lines, which the driver
    executes; an exam proves its claim through its own imports and calls and
    does not re-run another exam, so they are not spawned from here. Nothing of
    M4 is left unpinned by that: the register, the row order and every cell
    before `amendments` are all asserted above.
"""
import importlib.util
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
CENSUS = ROOT / "skills/ultrawrite/scripts/authoring_census.py"
SIBLINGS = (ROOT / "tests/test_authoring_census.py",
            ROOT / "tests/test_authoring_census_amendments.py")


def tsv(*cells):
    return "\t".join(cells)


def lines(text):
    return text.splitlines()


# ---------------------------------------------------------------- the records

# The records are the sibling exams', unchanged: this task adds three columns,
# it does not move the eleven that were already there, so their cells stay
# readable as BASE's.
RECORD_131 = {
    "tasks": [{"id": "1", "verdict": "pass"}],
    "tally": {"dispatched": 4, "rejected": 1},
    "authoring": {
        "minutes": 118,
        "probes": 12,
        "routing": {"branch": "risk", "lane": "ultrapowers"},
        "questions": [
            {"question": "Claim and summary", "options": ["A", "B"],
             "recommended": "A", "picked": "A"},
        ],
    },
}

RECORD_133 = {
    "tasks": [{"id": "1", "verdict": "pass"}],
    "tally": {"dispatched": 2},
    "authoring": {
        "minutes": 47,
        "probes": 5,
        "routing": {"branch": "width", "lane": "ultrapowers"},
        "questions": [
            {"question": "Lane and shape",
             "options": ["ultrapowers", "subagent", "inline"],
             "recommended": None, "picked": "subagent"},
            {"question": "Probe budget", "options": ["8", "12"],
             "recommended": "12", "picked": "12"},
        ],
    },
}

#: A fifth run, so the five reports of the Context each land on their own row:
#: a question whose `picked` is not its `recommended`, which the register
#: prints as `rec` on one option and `picked` on the other.
RECORD_140 = {
    "tasks": [{"id": "1", "verdict": "pass"}],
    "tally": {"dispatched": 5, "rejected": 0},
    "authoring": {
        "minutes": 30,
        "probes": 3,
        "routing": {"branch": "width", "lane": "ultrapowers"},
        "questions": [
            {"question": "Exam shape", "options": ["subprocess", "import"],
             "recommended": "subprocess", "picked": "import"},
        ],
    },
}

# Records older than this plan: no `authoring` key, their tallies read.
RECORD_9 = {
    "tasks": [{"id": "1", "verdict": "pass"}],
    "tally": {"dispatched": 3, "rejected": 0},
}

RECORD_12 = {
    "tasks": [{"id": "1", "verdict": "pass"}],
    "tally": {"dispatched": 1, "rejected": 2},
}

STATUS_131 = {
    "run": "131",
    "state": "done",
    "phase": "merged",
    "pr": "https://github.com/o/r/pull/1",
    "prAuthor": "o",
    "merged": "a" * 40,
    "branch": "ultra/integration-run-131",
    "vm": "fleet-r131-x",
    "startedAt": "2026-08-30T22:40:00Z",
    "updatedAt": "2026-08-30T22:56:30Z",
    "error": None,
}

# ---------------------------------------------------------------- the reports

# The shared literal the Context spells: `report.amendments` is a list of
# `{task, amends, what, why, jev}` rows, `jev` being `{compelled, plan_fault,
# magnitude}` when a reader answered and `null` when it did not.
def amendment(task, amends, jev="absent"):
    row = {
        "task": task,
        "amends": amends,
        "what": "the clause moved",
        "why": "the tree said otherwise",
    }
    if jev != "absent":
        row["jev"] = jev
    return row


def jev(compelled, plan_fault, magnitude):
    return {"compelled": compelled, "plan_fault": plan_fault,
            "magnitude": magnitude}


#: The Context's first run: four amendment rows, three of them read. `R` = 3;
#: `k` = 2 (0.8 and 0.7 clear the 0.7 threshold, 0.2 does not); `p` = 1 (0.7
#: alone); the buckets are `floor(1.6 + 0.5)` = 2, `floor(0.5 + 0.5)` = 1 and
#: `floor(2.5 + 0.5)` = 3 — `0/1/1/1`. The fourth row's `jev` is `null` and is
#: no part of `R`.
REPORT_FOUR = {
    "run": "9",
    "amendments": [
        amendment("1", "M1", jev(0.8, 0.1, 1.6)),
        amendment("2", "M2", jev(0.7, 0.7, 0.5)),
        amendment("2", "M3", jev(0.2, 0.0, 2.5)),
        amendment("4", "M1", None),
    ],
}

#: A report carrying the empty list: `0` amendments, `0/0` and `0/0/0/0`.
REPORT_EMPTY = {"run": "12", "amendments": []}

#: A list of rows carrying no `jev` at all — every run between the column
#: landing and this plan. Two rows, so the `amendments` cell is `2` while the
#: three read cells are the empty counts.
REPORT_NO_JEV = {
    "run": "131",
    "amendments": [amendment("1", "M2"), amendment("3", "M1")],
}

#: A report that parses and carries no `amendments` list: `-` in all four.
REPORT_NO_LIST = {
    "run": "133",
    "tasks": [{"id": "1", "verdict": "pass"}],
}


# ------------------------------------------------------------ the M1 expected

#: [M1] `COLUMNS` gains `compelled`, `plan_fault` and `magnitude`, in that
#: order, directly after `amendments`. A later plan (#526) hangs
#: `explain_rounds` off the end, after `magnitude`.
COLUMN_NAMES = ("run", "authoring_min", "probes", "dispatched", "rejected",
                "routing", "lane", "questions", "recommended_picked",
                "run_min", "amendments", "compelled", "plan_fault",
                "magnitude", "explain_rounds")

HEADER = tsv(*COLUMN_NAMES)

#: The index the new columns start at — everything left of it is BASE's [M4].
AMENDMENTS_AT = COLUMN_NAMES.index("amendments")


# ------------------------------------------------------------ the M2 expected

# The eleven BASE cells of each row, then the three this task adds, then
# `explain_rounds` (#526) — `-` for a record with no `authoring` key, `0`
# for one that carries the key but no question's `explain_rounds`. Rows sort
# by ascending run number, so this is the printed order.
ROW_9 = tsv("9", "-", "-", "3", "0", "-", "-", "-", "-", "-",
            "4", "2/3", "1/3", "0/1/1/1", "-")
ROW_12 = tsv("12", "-", "-", "1", "2", "-", "-", "-", "-", "-",
             "0", "0/0", "0/0", "0/0/0/0", "-")
ROW_131 = tsv("131", "118", "12", "4", "1", "risk", "ultrapowers", "1",
              "1/1", "16", "2", "0/0", "0/0", "0/0/0/0", "0")
ROW_133 = tsv("133", "47", "5", "2", "-", "width", "ultrapowers", "2",
              "1/1", "-", "-", "-", "-", "-", "0")
ROW_140 = tsv("140", "30", "3", "5", "0", "width", "ultrapowers", "1",
              "0/1", "-", "-", "-", "-", "-", "0")

TABLE_ROWS = [ROW_9, ROW_12, ROW_131, ROW_133, ROW_140]

#: (b): the last three cells of each row, in printed order.
LAST_THREE = [
    ["2/3", "1/3", "0/1/1/1"],      # the four-row run, three of them read
    ["0/0", "0/0", "0/0/0/0"],      # the empty list
    ["0/0", "0/0", "0/0/0/0"],      # the list whose rows carry no `jev`
    ["-", "-", "-"],                # a report with no `amendments` list
    ["-", "-", "-"],                # no report at all
]

#: (b): the Proof's own `jev_cells` literal and its answer.
JEV_CELLS_REPORT = {"amendments": [
    {"jev": {"compelled": 0.7, "plan_fault": 0.69, "magnitude": 1.5}},
    {"jev": {"compelled": 0.1, "plan_fault": 0.9, "magnitude": 3.4}},
    {"jev": None},
    {"jev": "unread"},
    {},
]}

JEV_CELLS_ANSWER = ((1, 2), (1, 2), (0, 0, 1, 1))


# ------------------------------------------------------------ the M3 expected

#: [M3] the whole line: BASE's fields, then the three gained directly after
#: ` amendments=<n>`. 118 + 47 + 30 = 195; 16 is the one row carrying a
#: `run_min`; 4 + 0 + 2 = 6 amendment rows over the three runs that carry a
#: list; the three read fields sum to the one run that carried a read.
TOTALS = ("totals: plans=5 runs=9..140 risk_override=1/3 "
          "recommended_picked=2/3 authoring_min=195 run_min=16 "
          "amendments=6 compelled=2/3 plan_fault=1/3 magnitude=0/1/1/1 "
          "explain_rounds=0")

#: [M3] the leg's exact suffix on that line.
TOTALS_SUFFIX = (" amendments=6 compelled=2/3 plan_fault=1/3 "
                 "magnitude=0/1/1/1 explain_rounds=0")

#: [M3] the other root — only the no-list and the no-report run, so no run
#: carried a read and the sums are the empty ones.
TOTALS_UNREAD = ("totals: plans=2 runs=133..140 risk_override=0/2 "
                 "recommended_picked=1/2 authoring_min=77 run_min=0 "
                 "amendments=0 compelled=0/0 plan_fault=0/0 "
                 "magnitude=0/0/0/0 explain_rounds=0")

TOTALS_UNREAD_SUFFIX = (" amendments=0 compelled=0/0 plan_fault=0/0 "
                        "magnitude=0/0/0/0 explain_rounds=0")


# ------------------------------------------------------------ the M4 expected

#: [M4] `--register` is what it was at BASE: one line per option of every
#: question, in row then question then option order, and nothing of `jev`.
REGISTER = [
    tsv("run-131", "q1", "Claim and summary", "A", "rec", "picked"),
    tsv("run-131", "q1", "Claim and summary", "B", "-", "-"),
    tsv("run-133", "q1", "Lane and shape", "ultrapowers", "-", "-"),
    tsv("run-133", "q1", "Lane and shape", "subagent", "-", "picked"),
    tsv("run-133", "q1", "Lane and shape", "inline", "-", "-"),
    tsv("run-133", "q2", "Probe budget", "8", "-", "-"),
    tsv("run-133", "q2", "Probe budget", "12", "rec", "picked"),
    tsv("run-140", "q1", "Exam shape", "subprocess", "rec", "-"),
    tsv("run-140", "q1", "Exam shape", "import", "-", "picked"),
]


# ------------------------------------------------------------------- the seam

def blob(obj):
    """One record, as the bytes that land on disk."""
    return (json.dumps(obj, indent=2) + "\n").encode("utf-8")


def census(*args, env=None):
    """The script, as a subprocess. Nothing here reaches into its internals."""
    assert CENSUS.is_file(), (
        "the census script does not exist yet: %s" % CENSUS)
    return subprocess.run([sys.executable, str(CENSUS), *args],
                          capture_output=True, text=True, env=env)


def load_module():
    """The script as a module, for the one clause read at its own seam."""
    assert CENSUS.is_file(), (
        "the census script does not exist yet: %s" % CENSUS)
    spec = importlib.util.spec_from_file_location("authoring_census", CENSUS)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def jev_cells_of(module):
    """`jev_cells`, the symbol the task's Interfaces `Produces`."""
    fn = getattr(module, "jev_cells", None)
    assert fn is not None, (
        "the census carries no `jev_cells(report)` — the Interfaces "
        "`Produces` of this task")
    return fn


def write_run(root, number, record, status=None, report=None):
    d = root / ("run-%s" % number)
    d.mkdir(parents=True)
    if record is not None:
        (d / "gate-verdicts.json").write_bytes(blob(record))
    if status is not None:
        (d / "status.json").write_bytes(blob(status))
    if report is not None:
        (d / "report.json").write_bytes(blob(report))
    return d


def build_root(tmp_path, name="census", reports=True):
    """The Context's five runs under one root, written out of run order — the
    census sorts by run number, so the printed order is 9, 12, 131, 133, 140.

    `reports=False` writes the same five records with no `report.json` beside
    any of them: the fixture shape BASE's census was read over, which leg (d)
    compares the register against."""
    root = tmp_path / name
    root.mkdir()
    write_run(root, 131, RECORD_131, STATUS_131,
              REPORT_NO_JEV if reports else None)
    write_run(root, 9, RECORD_9, None, REPORT_FOUR if reports else None)
    write_run(root, 140, RECORD_140, None, None)
    write_run(root, 133, RECORD_133, None, REPORT_NO_LIST if reports else None)
    write_run(root, 12, RECORD_12, None, REPORT_EMPTY if reports else None)
    return root


def build_unread_root(tmp_path, name="unread"):
    """(c)'s other root: only the run whose report carries no list and the run
    that left no report, so no run carried a read."""
    root = tmp_path / name
    root.mkdir()
    write_run(root, 133, RECORD_133, None, REPORT_NO_LIST)
    write_run(root, 140, RECORD_140, None, None)
    return root


def body(stdout):
    """The printed rows, between the header and the totals line."""
    return lines(stdout)[1:-1]


def table(root):
    p = census("--from", str(root))
    assert p.returncode == 0, p.stdout + p.stderr
    return p


# ------------------------------------------------------------------- leg (a)

def test_a_the_header_ends_with_the_three_new_columns_after_amendments(
        tmp_path):
    """(a)/[M1]: the header line's tab-separated names end `…\\trun_min\\t
    amendments\\tcompelled\\tplan_fault\\tmagnitude` — the three new names in
    that order, directly after `amendments` and after nothing else; a later
    plan (#526) hangs `explain_rounds` off the end, after those three."""
    p = table(build_root(tmp_path))
    header = lines(p.stdout)[0]
    assert header.split("\t")[-6:] == [
        "run_min", "amendments", "compelled", "plan_fault",
        "magnitude", "explain_rounds"], header
    assert header == HEADER, p.stdout


def test_a_the_header_equals_the_imported_columns(tmp_path):
    """(a)/[M1]: and it equals the imported `COLUMNS` — the header is those
    names, and `COLUMNS` is the eleven BASE names with the three appended."""
    module = load_module()
    p = table(build_root(tmp_path))
    assert tuple(module.COLUMNS) == COLUMN_NAMES, module.COLUMNS
    assert lines(p.stdout)[0] == "\t".join(module.COLUMNS), p.stdout


# ------------------------------------------------------------------- leg (b)

def test_b_the_five_runs_last_three_cells(tmp_path):
    """(b)/[M2]: the four-row run reads `2/3`, `1/3`, `0/1/1/1` (`R` = 3 of its
    four rows, `k` = 2 over the 0.7 threshold, `p` = 1, buckets 2, 1 and 3);
    the empty-list run and the no-`jev`-rows run both read `0/0`, `0/0`,
    `0/0/0/0`; the no-list run and the no-report run read `-`, `-`, `-` — the
    three, then `explain_rounds` last (#526)."""
    p = table(build_root(tmp_path))
    got = [line.split("\t")[-4:-1] for line in body(p.stdout)]
    assert got == LAST_THREE, p.stdout


def test_b_the_no_jev_rows_run_keeps_its_amendments_count(tmp_path):
    """(b)/[M2]: "the no-`jev`-rows run's are `0/0`, `0/0`, `0/0/0/0` with its
    `amendments` cell its row count" — the list is still counted, only no row
    of it was read."""
    p = table(build_root(tmp_path))
    row = [line for line in body(p.stdout)
           if line.split("\t")[0] == "131"]
    assert len(row) == 1, p.stdout
    cells = row[0].split("\t")
    assert cells[AMENDMENTS_AT] == str(len(REPORT_NO_JEV["amendments"])), row
    assert cells[AMENDMENTS_AT] == "2", row
    assert cells[AMENDMENTS_AT + 1:AMENDMENTS_AT + 4] == \
        ["0/0", "0/0", "0/0/0/0"], row


def test_b_each_whole_row_is_its_base_cells_then_the_three(tmp_path):
    """(b)/[M2] and [M4]: the rows verbatim — the eleven cells this task does
    not touch, each followed by the three it adds, then `explain_rounds`
    (#526) last, in ascending run order."""
    p = table(build_root(tmp_path))
    assert body(p.stdout) == TABLE_ROWS, p.stdout


def test_b_jev_cells_over_the_proofs_own_literal(tmp_path):
    """(b)/[M2]: the seam the Interfaces `Produces`. The Proof's literal reads
    `((1, 2), (1, 2), (0, 0, 1, 1))` — two rows carry a `jev` object, so `R` is
    2; `0.7` clears the threshold and `0.69` does not; the buckets are
    `floor(1.5 + 0.5)` = 2 and `min(3, floor(3.4 + 0.5))` = 3. The `null`, the
    string and the absent `jev` are all outside `R`. A report with no
    `amendments` list is `None`."""
    cells = jev_cells_of(load_module())
    assert cells(JEV_CELLS_REPORT) == JEV_CELLS_ANSWER, cells(JEV_CELLS_REPORT)
    assert cells({}) is None, cells({})


def test_b_a_report_with_no_list_is_none_and_an_empty_list_is_the_zeroes(
        tmp_path):
    """(b)/[M2]: the split the `-` cells come from — "a run whose report
    carries no `amendments` list, or no report" is `None`, while "a list with
    no `jev` row prints `0/0` and `0/0/0/0`", the empty list included."""
    cells = jev_cells_of(load_module())
    assert cells({"run": "133", "tasks": []}) is None
    assert cells(None) is None
    assert cells({"amendments": []}) == ((0, 0), (0, 0), (0, 0, 0, 0)), \
        cells({"amendments": []})
    assert cells({"amendments": [amendment("1", "M1")]}) == \
        ((0, 0), (0, 0), (0, 0, 0, 0))


def test_b_the_buckets_are_floor_of_x_plus_a_half_clamped(tmp_path):
    """(b)/[M2]: `b = min(3, max(0, floor(jev.magnitude + 0.5)))`. `0.5` is
    bucket 1 and `2.5` is bucket 3, where Python's banker's `round` reads 0 and
    2; `3.4` clamps down to 3 and a negative clamps up to 0."""
    cells = jev_cells_of(load_module())

    def buckets(*magnitudes):
        return cells({"amendments": [
            {"jev": jev(0.0, 0.0, m)} for m in magnitudes]})[2]

    assert buckets(0.5) == (0, 1, 0, 0), buckets(0.5)
    assert buckets(2.5) == (0, 0, 0, 1), buckets(2.5)
    assert buckets(1.5) == (0, 0, 1, 0), buckets(1.5)
    assert buckets(3.4, 9.0) == (0, 0, 0, 2), buckets(3.4, 9.0)
    assert buckets(-0.4, -7.0) == (2, 0, 0, 0), buckets(-0.4, -7.0)
    assert buckets(0.0, 0.49, 1.0, 2.0, 3.0) == (2, 1, 1, 1), \
        buckets(0.0, 0.49, 1.0, 2.0, 3.0)


def test_b_the_threshold_is_at_least_seven_tenths(tmp_path):
    """(b)/[M2]: `k` counts "the rows whose `jev.compelled ≥ 0.7`" and `p` "the
    rows whose `jev.plan_fault ≥ 0.7`" — 0.7 itself counts, 0.69 does not, and
    the two cells count their own field."""
    cells = jev_cells_of(load_module())
    compelled, plan_fault, _buckets = cells({"amendments": [
        {"jev": jev(0.7, 0.69, 0.0)},
        {"jev": jev(0.69, 0.7, 0.0)},
        {"jev": jev(1.0, 0.0, 0.0)},
    ]})
    assert compelled == (2, 3), compelled
    assert plan_fault == (1, 3), plan_fault


# ------------------------------------------------------------------- leg (c)

def test_c_the_totals_line_ends_with_the_three_new_fields(tmp_path):
    """(c)/[M3]: the last line ends ` amendments=<n> compelled=2/3
    plan_fault=1/3 magnitude=0/1/1/1`, `<n>` being the sum of the runs'
    amendment counts — 4 + 0 + 2 over the three runs carrying a list."""
    p = table(build_root(tmp_path))
    totals = lines(p.stdout)[-1]
    assert totals.startswith("totals: "), p.stdout
    expected_n = (len(REPORT_FOUR["amendments"]) + len(REPORT_EMPTY["amendments"])
                  + len(REPORT_NO_JEV["amendments"]))
    assert expected_n == 6, expected_n
    assert totals.endswith(TOTALS_SUFFIX), totals


def test_c_the_totals_line_is_its_base_fields_then_the_three(tmp_path):
    """(c)/[M3] and [M4]: the whole line — `plans`, `runs`, `risk_override`,
    `recommended_picked`, `authoring_min`, `run_min` and `amendments` are what
    they were at BASE, and the three new fields come directly after
    ` amendments=<n>` and last."""
    p = table(build_root(tmp_path))
    totals = lines(p.stdout)[-1]
    assert totals == TOTALS, totals
    assert totals.count("compelled=") == 1, totals
    assert totals.count("plan_fault=") == 1, totals
    assert totals.count("magnitude=") == 1, totals


def test_c_a_root_where_no_run_carried_a_read_sums_to_the_empty_counts(
        tmp_path):
    """(c)/[M3]: a root holding only the no-list and the no-report run ends
    ` amendments=0 compelled=0/0 plan_fault=0/0 magnitude=0/0/0/0` — the empty
    sums, not `-` and not a missing field."""
    p = table(build_unread_root(tmp_path))
    totals = lines(p.stdout)[-1]
    assert totals.endswith(TOTALS_UNREAD_SUFFIX), totals
    assert totals == TOTALS_UNREAD, totals


# ------------------------------------------------------------------- leg (d)

def test_d_the_register_is_byte_for_byte_the_records_own_lines(tmp_path):
    """(d)/[M4]: `--register` over the five-run root prints byte for byte what
    the same five records print with no `report.json` beside them — which is
    what BASE's fixture records printed. No `jev` field reaches the register:
    the register is a reading of the gate record, and the reads live on the
    report."""
    with_reports = build_root(tmp_path, name="withreports")
    records_only = build_root(tmp_path, name="recordsonly", reports=False)
    p = census("--register", "--from", str(with_reports))
    q = census("--register", "--from", str(records_only))
    assert p.returncode == 0, p.stdout + p.stderr
    assert q.returncode == 0, q.stdout + q.stderr
    assert p.stdout == "\n".join(REGISTER) + "\n", p.stdout
    assert p.stdout.encode("utf-8") == q.stdout.encode("utf-8"), \
        p.stdout + "\n--- vs ---\n" + q.stdout
    assert "jev" not in p.stdout, p.stdout
    for text in ("compelled", "plan_fault", "magnitude", "0.8", "2.5"):
        assert text not in p.stdout, (text, p.stdout)


def test_d_the_row_order_and_every_cell_before_amendments_are_unchanged(
        tmp_path):
    """(d)/[M4]: the rows come in the same order and every cell before
    `amendments` is what it was at BASE — read as: the same five records with
    their reports taken away print the same run order and the same first eleven
    columns up to `amendments`, the reads being the only thing a `report.json`
    moves."""
    with_reports = table(build_root(tmp_path, name="withreports"))
    records_only = table(build_root(tmp_path, name="recordsonly",
                                    reports=False))
    before = [line.split("\t")[:AMENDMENTS_AT] for line in
              body(with_reports.stdout)]
    assert before == [line.split("\t")[:AMENDMENTS_AT] for line in
                      body(records_only.stdout)], (
        with_reports.stdout + "\n--- vs ---\n" + records_only.stdout)
    assert before == [row.split("\t")[:AMENDMENTS_AT] for row in TABLE_ROWS], \
        with_reports.stdout
    assert [cells[0] for cells in before] == ["9", "12", "131", "133", "140"], \
        before


def test_d_both_sibling_exams_still_define_nineteen_tests():
    """(d)/[M4]: the Proof's third and fourth `Run:` lines — `tests/
    test_authoring_census.py` and `tests/test_authoring_census_amendments.py`,
    both edited by this task so their header and totals pins move, each "still
    defining exactly 19 `def test_` functions, the counts they have at BASE".
    The pin is on `^def test_`, as the Context says: a bare `def test_` grep
    counts the docstring mentions too."""
    for sibling in SIBLINGS:
        assert sibling.is_file(), "the sibling exam is missing: %s" % sibling
        defs = [line for line in lines(sibling.read_text(encoding="utf-8"))
                if line.startswith("def test_")]
        assert len(defs) == 19, "%s defines %d:\n%s" % (
            sibling.name, len(defs), "\n".join(defs))
