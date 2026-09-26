"""The authoring census: three exams in one file.

Part one — one table per release, the register, and the fetch.

The exam for `skills/ultrawrite/scripts/authoring_census.py`, leg by leg:

  * (a)/[M1] three run directories under one root — `run-131` carrying the
    Context's example record, `run-133` carrying a record whose `tally` lacks
    `rejected` and whose first question has no `recommended`, and `run-9`
    carrying a record from before this plan, with no `authoring` key at all —
    print the header line exactly, one row per directory in ascending numeric
    N, and the `totals:` line.
  * (b)/[M1] a `run-<N>` directory that holds no `gate-verdicts.json` earns no
    row and is not counted in `plans` — asserted as: the same root plus such a
    directory prints byte-for-byte what (a) printed.
  * (c)/[M2] `--register` prints one line per option of every question of every
    row, in row order then question order then option order, and no header.
  * (d)/[M3] `--fetch o/r --runs 131..133 --into <dir> --gh <fake>` writes the
    record from the plan tag and the status and report from the evidence tag,
    skips the run whose plan tag has no record with one stderr line naming it,
    invokes the binary `--gh` names and no other, and then prints the M1 table
    over `<dir>`.

The script is driven as a subprocess over directories built under `tmp_path`,
with a fake `gh` written there that answers from a table keyed on the `ref=`
and path of its argv — the shape the task's Context asks for. The one test
that imports the module is the Interfaces check: the four `Produces` symbols
and the parameter names the task spells.

Two readings this file pins, both from the task's own words:

  * `run-131`'s `status.json` spans 16m30s, not a whole 16 — M1 pins `run_min`
    as "the whole minutes, rounded down", so the floor is live, and leg (a)'s
    `16` is the value either way.
  * `run-9` carries `rejected` 0, which prints `0` and not `-`: `-` is "the
    run's files do not carry it", which zero is not.

Part two — the census counts amendments: the new column, the new totals
suffix, the new fetch.

The census counts amendments: the new column, the new totals suffix, the
new fetch.

The exam for task 4 — `skills/ultrawrite/scripts/authoring_census.py` gaining
an `amendments` column, a ` amendments=<n>` totals suffix and a third `--fetch`
read. Leg by leg, in the Proof's own order:

  * (a)/[M2] over one root of three runs — `run-9` carrying a `report.json`
    whose `amendments` has three rows, `run-131` carrying a report with no
    `amendments` key, `run-133` carrying no report at all — the header carries
    an `amendments` column directly after `run_min`, and the three rows'
    `amendments` cells are `3`, `-` and `-` in that order (rows sort by
    ascending N, so `run-9` is the first of them).
  * (b)/[M3] that table's last line carries ` amendments=3`, and a root whose
    reports carry no lists carries ` amendments=0`.
  * (c)/[M1] `--fetch o/r --runs 131..132` against a fake `gh` that answers the
    plan and status reads for both and a report for 131 only: `run-131/
    report.json` is the decoded bytes of the answer, no `run-132/report.json`
    is written, both report contents paths are requested as `api` calls, and
    the printed table gives 131 the report's list length and 132 a `-`.
  * (d)/[M1] a run whose plan tag has no record still yields no row and no
    directory, report or not — its report answering changes nothing.
  * (f)/[M1] the Proof's third `Run:` line: `--help` names `--fetch`.

The script is driven as a subprocess over directories built under `tmp_path`,
with the fake `gh` the task's Context describes written there beside it. The
helpers are the ones the first part defines.

Three readings this file pins, each from the task's own words:

  * A report that parses but carries no `amendments` key reads `-`, never `0`
    (M2: the length "when that file parses as an object carrying a list under
    that key, `None` otherwise"; the Context: "every run before this plan —
    reads `-`, never `0`"). A report carrying `[]` reads `0`, not `-`: zero
    amendments is a value the file carries.
  * The totals sum is "over the rows that carry a value", so a root where no
    row carries one still reads ` amendments=0` — the empty sum, not a `-`.
  * M3 quotes the totals format string without the ` runs=<lo>..<hi>` field
    the line carries at BASE, and the Context's line numbers match the tree at
    `5a8f1ebd` rather than at this BASE (`5aa9af93`, "a release's census line
    says which runs it read", landed in between and added that field). The
    quoted string is therefore a stale snapshot, not an instruction to drop
    the window. This exam encodes M3's operative words — "the totals line ends
    ` amendments=<n>`" — as that field's value, and checks the rest of the line
    by equality after stripping a single optional ` runs=<window>` field, which
    reproduces M3's quoted format string exactly. It pins neither the window's
    presence nor its absence, because the task's own text says both. For the
    same reason it reads the field rather than the line's tail: a later plan
    appends its own fields after ` amendments=<n>`, and the sum is what this
    exam is about.

Part three — the census reads the amendment reads: three columns and the
totals line.

The census reads the amendment reads: three columns and the totals line.

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
    order and every cell before `amendments` are unchanged.

The script is driven as a subprocess over directories built under `tmp_path`,
exactly as the two parts before it do, through the same helpers.

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

Each part keeps its own fixture roots (`build_root`, `amendments_root`,
`jev_root`) and its own expected rows; the seam helpers are shared.
"""
import importlib.util
import inspect
import json
import os
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
CENSUS = ROOT / "skills/ultrawrite/scripts/authoring_census.py"


def tsv(*cells):
    return "\t".join(cells)


# ---------------------------------------------------------------- the records

# The record shape is the one literal every task in this plan shares: the
# `authoring` object sits at the top level beside `tasks` and `tally`.
RECORD_131 = {
    "tasks": [{"id": "1", "verdict": "pass"}],
    "tally": {"dispatched": 4, "rejected": 1},
    "authoring": {
        "minutes": 118,
        "probes": 12,
        "routing": {"branch": "risk", "lane": "ultrapowers"},
        "questions": [
            {"question": "Claim and summary", "options": ["A", "B"],
             "recommended": "A", "picked": "A", "explain_rounds": 2},
        ],
    },
}

# A `tally` that lacks `rejected`, a `width` routing, and two questions: one
# whose `recommended` is null (the question carried no recommended option) and
# one whose `picked` equals its `recommended`.
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

# A record older than this plan: no `authoring` key. Its row is `-` everywhere
# except `dispatched`/`rejected`, which it does carry — `rejected` as 0.
RECORD_9 = {
    "tasks": [{"id": "1", "verdict": "pass"}],
    "tally": {"dispatched": 3, "rejected": 0},
}

# `fleet/CONTRACT.md`'s shape: ISO-8601 with a `Z` suffix. 22:40:00 to
# 22:56:30 is 16 whole minutes once the half is floored away.
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


def blob(obj):
    """One record, as the bytes that land on disk — the fetch leg compares the
    file it wrote against exactly this."""
    return (json.dumps(obj, indent=2) + "\n").encode("utf-8")


# ------------------------------------------------------------ the M1 expected

#: `COLUMNS`, in the clause's order: the ten BASE names, `amendments`, the
#: three amendment-reading names, and `explain_rounds` (#526) last.
COLUMN_NAMES = ("run", "authoring_min", "probes", "dispatched", "rejected",
                "routing", "lane", "questions", "recommended_picked",
                "run_min", "amendments", "compelled", "plan_fault",
                "magnitude", "explain_rounds")

HEADER = tsv(*COLUMN_NAMES)

# (a): the no-`authoring` record — `-` in every authoring column, its tally
# read, and `-` for `run_min` (it carries no `status.json`). `amendments` is
# `-` on every row here: `build_root` writes no `report.json`, and a run that
# left no report reads `-`, never `0`. The three reading columns read `-` for
# the same reason — no report is no amendments list, and no list is no reading.
ROW_9 = tsv("9", "-", "-", "3", "0", "-", "-", "-", "-", "-", "-",
            "-", "-", "-", "-")
# (a): the leg's row, verbatim. Its question carries `explain_rounds: 2`.
ROW_131 = tsv("131", "118", "12", "4", "1", "risk", "ultrapowers", "1",
              "1/1", "16", "-", "-", "-", "-", "2")
# (a): `rejected` and `run_min` both `-`, `recommended_picked` 1/1 — the
# null-recommended question counts in neither p nor q. Neither of its
# questions carries `explain_rounds`, so the cell is `0`, not `-`.
ROW_133 = tsv("133", "47", "5", "2", "-", "width", "ultrapowers", "2",
              "1/1", "-", "-", "-", "-", "-", "0")
# (a): m = the rows with a routing record (131, 133), k = those whose branch
# is `risk` (131); p/q summed over every row; 118 + 47 = 165; 16 is the one
# row carrying a `run_min`; no row carries an amendment count, so the sum over
# the rows that do is 0, and no row carries a reading, so the three reading
# sums are their empty ones.
TOTALS = ("totals: plans=3 runs=9..133 risk_override=1/2 "
          "recommended_picked=2/2 authoring_min=165 run_min=16 "
          "amendments=0 compelled=0/0 plan_fault=0/0 magnitude=0/0/0/0 "
          "explain_rounds=2")

TABLE = [HEADER, ROW_9, ROW_131, ROW_133, TOTALS]

# ------------------------------------------------------------ the M2 expected

REGISTER = [
    tsv("run-131", "q1", "Claim and summary", "A", "rec", "picked"),
    tsv("run-131", "q1", "Claim and summary", "B", "-", "-"),
    tsv("run-133", "q1", "Lane and shape", "ultrapowers", "-", "-"),
    tsv("run-133", "q1", "Lane and shape", "subagent", "-", "picked"),
    tsv("run-133", "q1", "Lane and shape", "inline", "-", "-"),
    tsv("run-133", "q2", "Probe budget", "8", "-", "-"),
    tsv("run-133", "q2", "Probe budget", "12", "rec", "picked"),
]


# ------------------------------------------------------------------- the seam

def census(*args, env=None):
    """The script, as a subprocess. Nothing here reaches into its internals."""
    assert CENSUS.is_file(), (
        "the census script does not exist yet: %s" % CENSUS)
    return subprocess.run([sys.executable, str(CENSUS), *args],
                          capture_output=True, text=True, env=env)


def write_run(root, number, record, status=None, report=None):
    """One `run-<N>` directory: the record, and beside it the `status.json`
    and the `report.json` when given."""
    d = root / ("run-%s" % number)
    d.mkdir(parents=True)
    if record is not None:
        (d / "gate-verdicts.json").write_bytes(blob(record))
    if status is not None:
        (d / "status.json").write_bytes(blob(status))
    if report is not None:
        (d / "report.json").write_bytes(blob(report))
    return d


def build_root(tmp_path, name="census", runs=None):
    """Run directories under one root. `runs` is a list of
    `(number, record, status, report)`; it defaults to part one's leg (a)
    three run directories, which carry no status but 131's and no report."""
    if runs is None:
        runs = [(131, RECORD_131, STATUS_131, None),
                (133, RECORD_133, None, None),
                (9, RECORD_9, None, None)]
    root = tmp_path / name
    root.mkdir()
    for number, record, status, report in runs:
        write_run(root, number, record, status, report)
    return root


DECOY = """#!/bin/sh
printf '%s\\n' "$*" >> '{log}'
exit 1
"""


def decoy_env(tmp_path, name="decoy"):
    """A `gh` first on PATH that logs and fails. `--gh` names a binary, so the
    real one is never resolved by bare name — the seam `check_provenance.py`
    gives its own `--gh`. Returns (env, the log that must never appear)."""
    bindir = tmp_path / name
    bindir.mkdir()
    log = bindir / "bare-gh.log"
    gh = bindir / "gh"
    gh.write_text(DECOY.format(log=log))
    gh.chmod(0o755)
    env = dict(os.environ)
    env["PATH"] = str(bindir) + os.pathsep + env["PATH"]
    return env, log


FAKE_GH = '''#!/usr/bin/env python3
"""A `gh` that answers a contents read from a table keyed on argv[1]."""
import base64
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
argv = sys.argv[1:]
with (HERE / "calls.jsonl").open("a") as fh:
    fh.write(json.dumps(argv) + "\\n")
table = json.loads((HERE / "answers.json").read_text())
body = table.get(argv[1]) if len(argv) > 1 else None
if body is None:
    # No digits of its own: the one stderr line naming the skipped run can
    # then only be the script's.
    sys.stderr.write("gh: that ref carries no such file\\n")
    sys.exit(1)
payload = base64.b64encode(body.encode("utf-8")).decode("ascii")
wrapped = "\\n".join(payload[i:i + 60] for i in range(0, len(payload), 60))
sys.stdout.write(json.dumps({
    "name": Path(argv[1].split("?")[0]).name,
    "encoding": "base64",
    "content": wrapped + "\\n",
}) + "\\n")
'''


def fake_gh(tmp_path, answers, name="fakebin"):
    """The fake, plus the table it answers from. Returns (its path, its call
    log)."""
    bindir = tmp_path / name
    bindir.mkdir()
    (bindir / "answers.json").write_text(json.dumps(answers))
    gh = bindir / "gh-fake"
    gh.write_text(FAKE_GH)
    gh.chmod(0o755)
    return gh, bindir / "calls.jsonl"


def plan_path(number):
    return ("repos/o/r/contents/.ultrapowers/gate-verdicts.json"
            "?ref=ultra/plan/run-%d" % number)


def status_path(number):
    return ("repos/o/r/contents/.ultrapowers/runs/%d/status.json"
            "?ref=ultra/evidence/run-%d" % (number, number))


def report_path(number):
    return ("repos/o/r/contents/.ultrapowers/runs/%d/report.json"
            "?ref=ultra/evidence/run-%d" % (number, number))


def lines(text):
    return text.splitlines()


# ------------------------------------------------------------------- leg (a)

def test_a_the_table_over_three_runs(tmp_path):
    """(a)/[M1]: the header exactly, rows for 9, 131 and 133 in that order,
    and the `totals:` line — the whole of stdout, nothing beside it."""
    root = build_root(tmp_path)
    p = census("--from", str(root))
    assert p.returncode == 0, p.stdout + p.stderr
    assert lines(p.stdout) == TABLE, p.stdout


def test_a_the_header_line_is_exact(tmp_path):
    """(a)/[M1]: the first line is the tab-separated column names, in the
    clause's order, `amendments` and the three amendment-reading columns last
    — read on its own so a drift there reads as a drift there."""
    root = build_root(tmp_path)
    p = census("--from", str(root))
    assert lines(p.stdout)[0] == HEADER, p.stdout


def test_a_a_record_without_an_authoring_key_is_dashes_but_for_its_tally(
        tmp_path):
    """(a)/[M1]: `run-9`'s record predates this plan. Every authoring column is
    `-`; `dispatched` and `rejected` are its tally's, and `rejected` 0 prints
    as `0` — `-` is "the run's files do not carry it", which zero is not."""
    root = build_root(tmp_path)
    p = census("--from", str(root))
    assert ROW_9 in lines(p.stdout), p.stdout
    # The row for 9 comes first: ascending numeric N, not lexical.
    assert lines(p.stdout)[1] == ROW_9, p.stdout


def test_a_a_tally_without_rejected_and_a_run_without_status_are_dashes(
        tmp_path):
    """(a)/[M1]: `run-133` carries no `rejected` and no `status.json`, so both
    columns are `-`, and its `recommended_picked` is 1/1 — the question whose
    `recommended` is null counts in neither p nor q."""
    root = build_root(tmp_path)
    p = census("--from", str(root))
    assert ROW_133 in lines(p.stdout), p.stdout


def test_a_run_min_is_whole_minutes_rounded_down(tmp_path):
    """(a)/[M1]: 2026-08-30T22:40:00Z to 2026-08-30T22:56:30Z is 16.5 minutes,
    and the column carries "the whole minutes, rounded down" — 16."""
    root = build_root(tmp_path)
    p = census("--from", str(root))
    assert ROW_131 in lines(p.stdout), p.stdout
    # `run_min` is the sixth cell from the end now that `amendments`, the
    # three amendment-reading columns and `explain_rounds` close the row.
    assert lines(p.stdout)[2].split("\t")[-6] == "16", p.stdout


def test_a_the_totals_line_is_exact(tmp_path):
    """(a)/[M1]: `plans` counts the rows, `risk_override` is the `risk` rows
    over the rows with a routing record, `recommended_picked` sums p and q over
    every row, and each minute sum is over the rows carrying that value."""
    root = build_root(tmp_path)
    p = census("--from", str(root))
    assert lines(p.stdout)[-1] == TOTALS, p.stdout


# ------------------------------------------------------------------- leg (b)

def test_b_a_run_directory_without_a_record_earns_no_row(tmp_path):
    """(b)/[M1]: `run-150` holds a `status.json` and no `gate-verdicts.json`.
    It yields no row and is not counted in `plans` — so the output is what
    (a) printed, line for line, `plans=3` included."""
    root = build_root(tmp_path)
    write_run(root, 150, None, STATUS_131)
    p = census("--from", str(root))
    assert p.returncode == 0, p.stdout + p.stderr
    assert lines(p.stdout) == TABLE, p.stdout
    assert "150" not in p.stdout, p.stdout


# ------------------------------------------------------------------- leg (c)

def test_c_register_prints_one_line_per_option(tmp_path):
    """(c)/[M2]: one line per option of every question of every row, in row
    order then question order then option order, and no table header."""
    root = build_root(tmp_path)
    p = census("--register", "--from", str(root))
    assert p.returncode == 0, p.stdout + p.stderr
    assert lines(p.stdout) == REGISTER, p.stdout
    assert HEADER not in p.stdout, p.stdout
    assert "totals:" not in p.stdout, p.stdout


def test_c_register_marks_the_recommended_and_the_picked_option(tmp_path):
    """(c)/[M2]: `run-131`'s two lines, verbatim — `rec` on the option equal to
    the question's `recommended` and `-` on the others, `picked` on the option
    equal to `picked` and `-` on the others."""
    root = build_root(tmp_path)
    p = census("--register", "--from", str(root))
    got = [line for line in lines(p.stdout) if line.startswith("run-131\t")]
    assert got == [
        tsv("run-131", "q1", "Claim and summary", "A", "rec", "picked"),
        tsv("run-131", "q1", "Claim and summary", "B", "-", "-"),
    ], p.stdout


def test_c_register_leaves_the_rec_column_dashed_for_a_null_recommended(
        tmp_path):
    """(c)/[M2]: `run-133`'s first question carried no recommended option, so
    every one of its three lines is `-` in the `rec` column and exactly one
    is `picked`; `<i>` counts from 1, so its second question is `q2`."""
    root = build_root(tmp_path)
    p = census("--register", "--from", str(root))
    q1 = [line.split("\t") for line in lines(p.stdout)
          if line.startswith("run-133\tq1\t")]
    assert len(q1) == 3, p.stdout
    assert [cells[4] for cells in q1] == ["-", "-", "-"], p.stdout
    assert [cells[5] for cells in q1] == ["-", "picked", "-"], p.stdout
    q2 = [line for line in lines(p.stdout) if line.startswith("run-133\tq2\t")]
    assert q2 == [
        tsv("run-133", "q2", "Probe budget", "8", "-", "-"),
        tsv("run-133", "q2", "Probe budget", "12", "rec", "picked"),
    ], p.stdout


# ------------------------------------------------------------------- leg (d)

def fetch_answers():
    """The fake's table: the plan record for 131 and 133, a `status.json` for
    131 only. Run 132's plan tag and run 133's evidence tag are absent, so the
    fake exits 1 for them — and no `report.json` is answered at all, so every
    row's `amendments` is `-`."""
    return {
        plan_path(131): blob(RECORD_131).decode("utf-8"),
        plan_path(133): blob(RECORD_133).decode("utf-8"),
        status_path(131): blob(STATUS_131).decode("utf-8"),
    }


def run_fetch(tmp_path, answers=None, runs="131..133"):
    """`--fetch` over the fake: `answers` defaults to part one's table."""
    into = tmp_path / "fetched"
    into.mkdir()
    gh, calls = fake_gh(tmp_path, fetch_answers() if answers is None
                        else answers)
    env, bare_log = decoy_env(tmp_path)
    p = census("--fetch", "o/r", "--runs", runs, "--into", str(into),
               "--gh", str(gh), env=env)
    return p, into, calls, bare_log


def test_d_fetch_writes_the_decoded_files(tmp_path):
    """(d)/[M3]: both files for 131 and the record for 133, each the decoded
    bytes of the answer's base64 `content`."""
    p, into, _calls, _bare = run_fetch(tmp_path)
    assert (into / "run-131/gate-verdicts.json").read_bytes() == \
        blob(RECORD_131), p.stdout + p.stderr
    assert (into / "run-131/status.json").read_bytes() == blob(STATUS_131), \
        p.stdout + p.stderr
    assert (into / "run-133/gate-verdicts.json").read_bytes() == \
        blob(RECORD_133), p.stdout + p.stderr


def test_d_a_plan_tag_without_a_record_is_skipped_with_one_stderr_line(
        tmp_path):
    """(d)/[M3]: run 132's plan tag answers non-zero — nothing is written for
    it, and exactly one stderr line names it."""
    p, into, _calls, _bare = run_fetch(tmp_path)
    assert not (into / "run-132").exists(), sorted(
        q.name for q in into.iterdir())
    named = [line for line in lines(p.stderr) if "132" in line]
    assert len(named) == 1, p.stderr


def test_d_a_missing_status_leaves_the_file_unwritten(tmp_path):
    """(d)/[M3]: run 133's evidence tag answers non-zero for `status.json`
    alone — that file is unwritten, and the row's `run_min` is `-`."""
    p, into, _calls, _bare = run_fetch(tmp_path)
    assert not (into / "run-133/status.json").exists(), p.stdout + p.stderr
    assert ROW_133 in lines(p.stdout), p.stdout


def test_d_fetch_then_prints_the_table_over_the_directory(tmp_path):
    """(d)/[M3]: the M1 table over `<dir>`, with rows for 131 and 133 only."""
    p, _into, _calls, _bare = run_fetch(tmp_path)
    assert lines(p.stdout) == [
        HEADER, ROW_131, ROW_133,
        ("totals: plans=2 runs=131..133 risk_override=1/2 "
         "recommended_picked=2/2 authoring_min=165 run_min=16 "
         "amendments=0 compelled=0/0 plan_fault=0/0 magnitude=0/0/0/0 "
         "explain_rounds=2"),
    ], p.stdout + p.stderr


def test_d_every_gh_call_is_an_api_read_of_the_expected_ref(tmp_path):
    """(d)/[M3]: each call's first two arguments are `api` and a
    `repos/o/r/contents/` path carrying the expected `ref=` tag — the plan tag
    for the record, the evidence tag for the status and the report — and no
    argv names any other repository. The three plan reads, the two status reads
    and the two report reads the leg asks for are all made."""
    p, _into, calls, _bare = run_fetch(tmp_path)
    argvs = [json.loads(line) for line in lines(calls.read_text())
             if line.strip()]
    assert argvs, "the fake `gh` was never invoked: " + p.stdout + p.stderr
    expected = {plan_path(n) for n in (131, 132, 133)}
    expected |= {status_path(n) for n in (131, 132, 133)}
    expected |= {report_path(n) for n in (131, 132, 133)}
    for argv in argvs:
        assert argv[0] == "api", argv
        assert argv[1].startswith("repos/o/r/contents/"), argv
        assert argv[1] in expected, argv
        for token in argv:
            for owner_repo in re.findall(r"repos/([^/]+/[^/?]+)", token):
                assert owner_repo == "o/r", argv
    made = {argv[1] for argv in argvs}
    for required in (plan_path(131), plan_path(132), plan_path(133),
                     status_path(131), status_path(133),
                     report_path(131), report_path(133)):
        assert required in made, sorted(made)
    # 132's plan tag carries no record, so the run is skipped whole: neither
    # its status nor its report is ever read.
    assert report_path(132) not in made, sorted(made)


def test_d_the_bare_gh_on_path_is_never_resolved(tmp_path):
    """(d)/[M3]: the script invokes the binary `--gh` names and no other — the
    decoy first on PATH is never run."""
    p, _into, _calls, bare_log = run_fetch(tmp_path)
    assert not bare_log.exists(), bare_log.read_text() + p.stdout + p.stderr


# -------------------------------------------------------- the Proof's `Run:`

def test_help_names_the_register_flag():
    """The Proof's second `Run:` line: `--help` names `--register`."""
    p = census("--help")
    assert p.returncode == 0, p.stdout + p.stderr
    assert "--register" in p.stdout, p.stdout


# ------------------------------------------------------------- the Interfaces

def load_module():
    """The script as a module, for the clauses read at its own seam."""
    assert CENSUS.is_file(), (
        "the census script does not exist yet: %s" % CENSUS)
    spec = importlib.util.spec_from_file_location("authoring_census", CENSUS)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_the_produced_symbols_carry_the_names_the_task_spells(tmp_path):
    """Interfaces/Produces: `census_rows(root)`, `render_table(rows)`,
    `render_register(rows)` and `fetch_runs(target, first, last, into, gh)`,
    with those parameter names; `census_rows` answers one dict per row."""
    module = load_module()
    wanted = {
        "census_rows": ["root"],
        "render_table": ["rows"],
        "render_register": ["rows"],
        "fetch_runs": ["target", "first", "last", "into", "gh"],
    }
    for name, params in wanted.items():
        fn = getattr(module, name, None)
        assert callable(fn), "no callable `%s` in %s" % (name, CENSUS)
        got = list(inspect.signature(fn).parameters)
        assert got == params, "%s%s" % (name, tuple(got))
    rows = module.census_rows(build_root(tmp_path))
    assert isinstance(rows, list) and len(rows) == 3, rows
    assert all(isinstance(row, dict) for row in rows), rows


def test_the_module_docstring_carries_the_three_invocations():
    """Context: the module docstring carries the three invocations."""
    module = load_module()
    doc = module.__doc__ or ""
    for flag in ("--from", "--register", "--fetch"):
        assert flag in doc, doc


# ============================================================================
# Part two: the census counts amendments.
# ============================================================================

# The records are part one's, but for `run-131`'s question, which carries no
# `explain_rounds` here — this part's rows read that cell as `0`.
RECORD_131_PLAIN = {
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


# The shared literal the Context spells: `report.amendments` is a list of
# `{task, amends, what, why, jev}` rows, `jev` being `{compelled, plan_fault,
# magnitude}` when a reader answered and `null` when it did not — and absent
# altogether on every row part two writes.
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


#: A report carrying the empty list: `0` amendments, `0/0` and `0/0/0/0`.
#: Zero is a value the file carries, so the cell is `0` and the totals sum is
#: still 0.
REPORT_EMPTY = {"run": "12", "amendments": []}


#: Leg (a)'s first run: three amendment rows, so its cell is `3`.
REPORT_THREE = {
    "run": "9",
    "amendments": [amendment("1", "M1"), amendment("2", "M2"),
                   amendment("2", "M3")],
}

#: Leg (a)'s second run: a report that parses and carries no `amendments`
#: key — every run before this plan. Its cell is `-`, never `0`.
REPORT_NO_KEY = {
    "run": "131",
    "tasks": [{"id": "1", "verdict": "pass"}],
}


#: Leg (c)'s fetched report: two rows, so the fetched row's cell is `2` and no
#: leg's expected number is the same as another's by accident.
REPORT_FETCHED = {
    "run": "131",
    "amendments": [amendment("1", "M2"), amendment("3", "M1")],
}


# ------------------------------------------------------------- the M2 expected


#: Where the `amendments` cell sits in a row, counted from the end — the three
#: amendment-reading columns a later plan added close the row after it.
AMENDMENTS_FROM_END = len(COLUMN_NAMES) - COLUMN_NAMES.index("amendments")

# (a): `run-9`'s record predates the plan — `-` in every authoring column, its
# tally read — and its report carries three amendment rows, none of them read
# (no row carries a `jev`), so the readings are the empty ones and not `-`.
AM_ROW_9 = tsv("9", "-", "-", "3", "0", "-", "-", "-", "-", "-", "3",
                "0/0", "0/0", "0/0/0/0", "-")
# (a): the full row, its report carrying no `amendments` key — so no list, and
# no list is no reading: `-` in all three. Its question carries no
# `explain_rounds`, so that cell is `0`, not `-` — the record has an
# `authoring` key.
AM_ROW_131 = tsv("131", "118", "12", "4", "1", "risk", "ultrapowers", "1",
                 "1/1", "16", "-", "-", "-", "-", "0")
# (a): no report at all beside the record.
AM_ROW_133 = tsv("133", "47", "5", "2", "-", "width", "ultrapowers", "2",
                 "1/1", "-", "-", "-", "-", "-", "0")

# ------------------------------------------------------------- the M3 expected

#: [M3] the totals line with its ` runs=<window>` field stripped: exactly the
#: format string M3 quotes, filled in for leg (a)'s root. 118 + 47 = 165; 16 is
#: the one row carrying a `run_min`; 3 is the one row carrying an `amendments`.
TOTALS_WITHOUT_WINDOW = ("totals: plans=3 risk_override=1/2 "
                         "recommended_picked=2/2 authoring_min=165 "
                         "run_min=16 amendments=3 compelled=0/0 "
                         "plan_fault=0/0 magnitude=0/0/0/0 "
                         "explain_rounds=0")

WINDOW_RE = re.compile(r" runs=\S+")


def without_window(line):
    """`line` with one ` runs=<window>` field removed — see this module's
    docstring: M3's quoted format string predates that field, so the exam reads
    the line either way rather than pinning a question the task answers twice."""
    return WINDOW_RE.sub("", line, count=1)


# ------------------------------------------------------------------- the seam

def amendments_root(tmp_path, name="census",
                    reports=("three", "no_key", None)):
    """Leg (a)'s three run directories under one root.

    `reports` says what each of `run-9`, `run-131`, `run-133` carries beside
    its record, in that order: the leg's root is a three-row report, a report
    with no `amendments` key, and no report at all."""
    which = {
        "three": REPORT_THREE,
        "no_key": REPORT_NO_KEY,
        "empty": REPORT_EMPTY,
        None: None,
    }
    return build_root(tmp_path, name, runs=[
        (131, RECORD_131_PLAIN, STATUS_131, which[reports[1]]),
        (133, RECORD_133, None, which[reports[2]]),
        (9, RECORD_9, None, which[reports[0]]),
    ])



def call_log(calls):
    return [json.loads(line) for line in lines(calls.read_text())
            if line.strip()]


def row_for(stdout, number):
    """The one printed row whose first cell is `<number>`, or None."""
    found = [line for line in lines(stdout)
             if line.split("\t")[0] == str(number)]
    assert len(found) <= 1, found
    return found[0] if found else None


def last_cells(stdout):
    """The `amendments` cell of every row between the header and the totals
    line — the last one this exam is about, whatever columns close the row
    after it."""
    body = lines(stdout)[1:-1]
    return [line.split("\t")[-AMENDMENTS_FROM_END] for line in body]


def amendments_cell(row):
    """One row's `amendments` cell, read the same way."""
    return row.split("\t")[-AMENDMENTS_FROM_END]


def totals_field(line, name):
    """The value of one ` <name>=<value>` field of the totals line.

    M3's operative words are that the line ends ` amendments=<n>`; a later
    plan appends its own fields after it, so what this exam pins is the
    field's value, not its position."""
    match = re.search(r" %s=(\S+)" % re.escape(name), line)
    assert match is not None, line
    return match.group(1)


# ------------------------------------------------------------------- leg (a)

def test_a_the_header_ends_with_an_amendments_column_after_run_min(tmp_path):
    """(a)/[M2]: `COLUMNS` gains `amendments` as its last name, after
    `run_min` — the header line is those names, tab-separated, in that order
    and no other."""
    root = amendments_root(tmp_path)
    p = census("--from", str(root))
    assert p.returncode == 0, p.stdout + p.stderr
    header = lines(p.stdout)[0]
    assert header == HEADER, p.stdout
    names = header.split("\t")
    assert "amendments" in names, header
    assert names[names.index("amendments") - 1] == "run_min", header


def test_a_the_three_rows_last_cells_are_three_dash_dash(tmp_path):
    """(a)/[M2]: the three runs' last cells are `3` (a report whose
    `amendments` has three rows), `-` (a report carrying no `amendments` key)
    and `-` (no report), in that order — rows sort by ascending N, so `run-9`
    is first."""
    root = amendments_root(tmp_path)
    p = census("--from", str(root))
    assert p.returncode == 0, p.stdout + p.stderr
    assert last_cells(p.stdout) == ["3", "-", "-"], p.stdout


def test_a_each_whole_row_gains_its_eleventh_cell_and_keeps_the_ten(tmp_path):
    """(a)/[M2]: the rows verbatim — the ten cells this task does not touch,
    then the new one, then whatever closes the row after it. `run-9`'s
    `rejected` is still `0` and not `-`, and `run-133` still carries neither
    `rejected` nor a `run_min`."""
    root = amendments_root(tmp_path)
    p = census("--from", str(root))
    assert lines(p.stdout)[1:4] == [AM_ROW_9, AM_ROW_131, AM_ROW_133], p.stdout


def test_a_a_report_without_the_key_reads_a_dash_and_an_empty_list_a_zero(
        tmp_path):
    """(a)/[M2]: the length of the list "when that file parses as an object
    carrying a list under that key, `None` otherwise". A report with no such
    key carries no value and prints `-`; a report carrying `[]` carries the
    value zero and prints `0`."""
    no_key = amendments_root(tmp_path, name="nokey",
                        reports=("no_key", "no_key", "no_key"))
    empty = amendments_root(tmp_path, name="empty",
                       reports=("empty", "empty", "empty"))
    assert last_cells(census("--from", str(no_key)).stdout) == \
        ["-", "-", "-"], "a report with no `amendments` key must read `-`"
    assert last_cells(census("--from", str(empty)).stdout) == \
        ["0", "0", "0"], "a report carrying `[]` must read `0`, not `-`"


def test_a_census_rows_carries_an_amendments_value_per_row(tmp_path):
    """(a)/[M2]: read at the seam the clause names — `census_rows` gives each
    row an `amendments` value: the list's length, or None."""
    module = load_module()
    rows = module.census_rows(amendments_root(tmp_path))
    got = [row.get("amendments", "<no such key>") for row in rows]
    assert got == [3, None, None], got


def test_a_columns_gains_amendments_last_and_keeps_the_ten_before_it(tmp_path):
    """(a)/[M2]: `COLUMNS` itself — the ten BASE names in their order, then
    `amendments`, then the three amendment-reading names a later plan hung
    off it."""
    module = load_module()
    assert tuple(module.COLUMNS) == COLUMN_NAMES, module.COLUMNS


# ------------------------------------------------------------------- leg (b)

def test_b_the_totals_line_ends_with_the_amendments_sum(tmp_path):
    """(b)/[M3]: the table's last line carries ` amendments=3` — the sum over
    the rows that carry a value, which here is `run-9`'s three alone."""
    root = amendments_root(tmp_path)
    p = census("--from", str(root))
    assert p.returncode == 0, p.stdout + p.stderr
    totals = lines(p.stdout)[-1]
    assert totals.startswith("totals: "), p.stdout
    assert totals_field(totals, "amendments") == "3", totals


def test_b_the_totals_line_keeps_every_field_it_had_before_the_suffix(
        tmp_path):
    """(b)/[M3]: the whole line — M3's quoted format string, filled in for this
    root, once the ` runs=<window>` field that string predates is set aside
    (see this module's docstring). `plans`, `risk_override`,
    `recommended_picked`, `authoring_min` and `run_min` are what they were at
    BASE; the suffix is the only new field."""
    root = amendments_root(tmp_path)
    p = census("--from", str(root))
    totals = lines(p.stdout)[-1]
    assert without_window(totals) == TOTALS_WITHOUT_WINDOW, totals
    assert totals.count("amendments=") == 1, totals


def test_b_a_root_whose_reports_carry_no_lists_ends_with_zero(tmp_path):
    """(b)/[M3]: no row carries a value, so the sum over the rows that carry
    one is the empty sum — the line carries ` amendments=0`, not
    ` amendments=-` and not a missing field."""
    root = amendments_root(tmp_path, name="nokey",
                      reports=("no_key", "no_key", "no_key"))
    p = census("--from", str(root))
    assert p.returncode == 0, p.stdout + p.stderr
    totals = lines(p.stdout)[-1]
    assert totals_field(totals, "amendments") == "0", totals
    assert without_window(totals) == (
        "totals: plans=3 risk_override=1/2 recommended_picked=2/2 "
        "authoring_min=165 run_min=16 amendments=0 compelled=0/0 "
        "plan_fault=0/0 magnitude=0/0/0/0 explain_rounds=0"), totals


def test_b_a_root_whose_reports_carry_empty_lists_also_ends_with_zero(
        tmp_path):
    """(b)/[M3]: three rows each carrying the value zero sum to zero too — the
    same field by the other route."""
    root = amendments_root(tmp_path, name="empty",
                      reports=("empty", "empty", "empty"))
    p = census("--from", str(root))
    assert totals_field(lines(p.stdout)[-1], "amendments") == "0", p.stdout


# ------------------------------------------------------------------- leg (c)

def report_fetch_answers():
    """[M1]'s leg (c) table: the plan and status reads answer for 131 and 132,
    the report read answers for 131 only."""
    return {
        plan_path(131): blob(RECORD_131_PLAIN).decode("utf-8"),
        plan_path(132): blob(RECORD_133).decode("utf-8"),
        status_path(131): blob(STATUS_131).decode("utf-8"),
        status_path(132): blob(STATUS_131).decode("utf-8"),
        report_path(131): blob(REPORT_FETCHED).decode("utf-8"),
    }


def test_c_fetch_writes_the_report_as_the_decoded_bytes_of_the_answer(
        tmp_path):
    """(c)/[M1]: `run-131/report.json` is written into `run-<N>/report.json`,
    and it is exactly the decoded bytes of the answer's base64 `content` — not
    a re-serialisation of it."""
    p, into, _calls, _bare = run_fetch(
        tmp_path, answers=report_fetch_answers(), runs="131..132")
    assert p.returncode == 0, p.stdout + p.stderr
    written = into / "run-131/report.json"
    assert written.is_file(), "no report was written: " + repr(sorted(
        str(q.relative_to(into)) for q in into.rglob("*")))
    assert written.read_bytes() == blob(REPORT_FETCHED), p.stdout + p.stderr


def test_c_a_report_that_does_not_answer_leaves_the_file_unwritten(tmp_path):
    """(c)/[M1]: run 132's report read exits non-zero, so that file is
    unwritten — and the run is still a row, its record and status having
    answered."""
    p, into, _calls, _bare = run_fetch(
        tmp_path, answers=report_fetch_answers(), runs="131..132")
    assert not (into / "run-132/report.json").exists(), sorted(
        q.name for q in (into / "run-132").iterdir())
    assert (into / "run-132/gate-verdicts.json").is_file(), p.stderr


def test_c_both_report_paths_are_requested_as_api_reads_of_the_evidence_tag(
        tmp_path):
    """(c)/[M1]: exactly `repos/o/r/contents/.ultrapowers/runs/131/report.json
    ?ref=ultra/evidence/run-131` and its 132 twin, each once, each an `api`
    call naming exactly two arguments — the shape the two existing fetches
    already use."""
    p, _into, calls, _bare = run_fetch(
        tmp_path, answers=report_fetch_answers(), runs="131..132")
    argvs = call_log(calls)
    assert argvs, "the fake `gh` was never invoked: " + p.stdout + p.stderr
    reports = [argv for argv in argvs
               if "report.json" in (argv[1] if len(argv) > 1 else "")]
    assert [argv[1] for argv in reports] == [
        report_path(131), report_path(132)], reports
    for argv in reports:
        assert argv == ["api", argv[1]], argv
    expected = {plan_path(n) for n in (131, 132)}
    expected |= {status_path(n) for n in (131, 132)}
    expected |= {report_path(n) for n in (131, 132)}
    for argv in argvs:
        assert len(argv) == 2, argv
        assert argv[0] == "api", argv
        assert argv[1].startswith("repos/o/r/contents/"), argv
        assert "?ref=" in argv[1], argv
        assert argv[1] in expected, argv


def test_c_the_printed_rows_carry_the_list_length_and_the_dash(tmp_path):
    """(c)/[M1]: the table printed over `<dir>` gives 131 the fetched report's
    list length in its `amendments` cell, and 132 — whose report did not
    answer — a `-`."""
    p, _into, _calls, _bare = run_fetch(
        tmp_path, answers=report_fetch_answers(), runs="131..132")
    row_131, row_132 = row_for(p.stdout, 131), row_for(p.stdout, 132)
    assert row_131 is not None and row_132 is not None, p.stdout + p.stderr
    assert amendments_cell(row_131) == \
        str(len(REPORT_FETCHED["amendments"])), row_131
    assert amendments_cell(row_131) == "2", row_131
    assert amendments_cell(row_132) == "-", row_132
    assert totals_field(lines(p.stdout)[-1], "amendments") == "2", p.stdout


def test_c_the_bare_gh_on_path_is_never_resolved(tmp_path):
    """(c)/[M1]: the new read goes through the same seam as the two existing
    ones — the binary `--gh` names, never the bare `gh` first on PATH."""
    p, _into, _calls, bare_log = run_fetch(
        tmp_path, answers=report_fetch_answers(), runs="131..132")
    assert not bare_log.exists(), bare_log.read_text() + p.stdout + p.stderr


# ------------------------------------------------------------------- leg (d)

def skipped_run_answers():
    """Run 200's plan tag carries a record; run 201's does not, though its
    status and its report both answer."""
    return {
        plan_path(200): blob(RECORD_131_PLAIN).decode("utf-8"),
        status_path(200): blob(STATUS_131).decode("utf-8"),
        report_path(200): blob(REPORT_FETCHED).decode("utf-8"),
        status_path(201): blob(STATUS_131).decode("utf-8"),
        report_path(201): blob(REPORT_THREE).decode("utf-8"),
    }


def test_d_a_plan_tag_without_a_record_yields_no_row_and_no_directory(
        tmp_path):
    """(d)/[M1]: run 201's plan tag has no record, so it is skipped whole —
    nothing written for it, no directory left behind, no row — and its report
    answering does not change that. Run 200, whose record was written, does
    get its report."""
    p, into, _calls, _bare = run_fetch(
        tmp_path, answers=skipped_run_answers(), runs="200..201")
    assert p.returncode == 0, p.stdout + p.stderr
    assert not (into / "run-201").exists(), sorted(
        q.name for q in into.iterdir())
    assert row_for(p.stdout, 201) is None, p.stdout
    assert (into / "run-200/report.json").is_file(), sorted(
        str(q.relative_to(into)) for q in into.rglob("*"))
    assert (into / "run-200/report.json").read_bytes() == \
        blob(REPORT_FETCHED), p.stdout + p.stderr
    assert amendments_cell(row_for(p.stdout, 200)) == "2", p.stdout


# ------------------------------------------------------------------- leg (f)

def test_f_help_names_the_fetch_flag():
    """(f)/[M1]: the Proof's third `Run:` line — `--help` names `--fetch`."""
    p = census("--help")
    assert p.returncode == 0, p.stdout + p.stderr
    assert "--fetch" in p.stdout, p.stdout


# ============================================================================
# Part three: the census reads the amendment reads.
# ============================================================================

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


RECORD_12 = {
    "tasks": [{"id": "1", "verdict": "pass"}],
    "tally": {"dispatched": 1, "rejected": 2},
}


# ---------------------------------------------------------------- the reports


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


#: The index the new columns start at — everything left of it is BASE's [M4].
AMENDMENTS_AT = COLUMN_NAMES.index("amendments")


# ------------------------------------------------------------ the M2 expected

# The eleven BASE cells of each row, then the three this task adds, then
# `explain_rounds` (#526) — `-` for a record with no `authoring` key, `0`
# for one that carries the key but no question's `explain_rounds`. Rows sort
# by ascending run number, so this is the printed order.
JEV_ROW_9 = tsv("9", "-", "-", "3", "0", "-", "-", "-", "-", "-",
                 "4", "2/3", "1/3", "0/1/1/1", "-")
ROW_12 = tsv("12", "-", "-", "1", "2", "-", "-", "-", "-", "-",
             "0", "0/0", "0/0", "0/0/0/0", "-")
JEV_ROW_131 = tsv("131", "118", "12", "4", "1", "risk", "ultrapowers", "1",
                  "1/1", "16", "2", "0/0", "0/0", "0/0/0/0", "0")
JEV_ROW_133 = tsv("133", "47", "5", "2", "-", "width", "ultrapowers", "2",
                  "1/1", "-", "-", "-", "-", "-", "0")
ROW_140 = tsv("140", "30", "3", "5", "0", "width", "ultrapowers", "1",
              "0/1", "-", "-", "-", "-", "-", "0")

TABLE_ROWS = [JEV_ROW_9, ROW_12, JEV_ROW_131, JEV_ROW_133, ROW_140]

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
JEV_TOTALS = ("totals: plans=5 runs=9..140 risk_override=1/3 "
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
JEV_REGISTER = [
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


def jev_cells_of(module):
    """`jev_cells`, the symbol the task's Interfaces `Produces`."""
    fn = getattr(module, "jev_cells", None)
    assert fn is not None, (
        "the census carries no `jev_cells(report)` — the Interfaces "
        "`Produces` of this task")
    return fn


def jev_root(tmp_path, name="census", reports=True):
    """The Context's five runs under one root, written out of run order — the
    census sorts by run number, so the printed order is 9, 12, 131, 133, 140.

    `reports=False` writes the same five records with no `report.json` beside
    any of them: the fixture shape BASE's census was read over, which leg (d)
    compares the register against."""
    return build_root(tmp_path, name, runs=[
        (131, RECORD_131_PLAIN, STATUS_131,
         REPORT_NO_JEV if reports else None),
        (9, RECORD_9, None, REPORT_FOUR if reports else None),
        (140, RECORD_140, None, None),
        (133, RECORD_133, None, REPORT_NO_LIST if reports else None),
        (12, RECORD_12, None, REPORT_EMPTY if reports else None),
    ])


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
    p = table(jev_root(tmp_path))
    header = lines(p.stdout)[0]
    assert header.split("\t")[-6:] == [
        "run_min", "amendments", "compelled", "plan_fault",
        "magnitude", "explain_rounds"], header
    assert header == HEADER, p.stdout


def test_a_the_header_equals_the_imported_columns(tmp_path):
    """(a)/[M1]: and it equals the imported `COLUMNS` — the header is those
    names, and `COLUMNS` is the eleven BASE names with the three appended."""
    module = load_module()
    p = table(jev_root(tmp_path))
    assert tuple(module.COLUMNS) == COLUMN_NAMES, module.COLUMNS
    assert lines(p.stdout)[0] == "\t".join(module.COLUMNS), p.stdout


# ------------------------------------------------------------------- leg (b)

def test_b_the_five_runs_last_three_cells(tmp_path):
    """(b)/[M2]: the four-row run reads `2/3`, `1/3`, `0/1/1/1` (`R` = 3 of its
    four rows, `k` = 2 over the 0.7 threshold, `p` = 1, buckets 2, 1 and 3);
    the empty-list run and the no-`jev`-rows run both read `0/0`, `0/0`,
    `0/0/0/0`; the no-list run and the no-report run read `-`, `-`, `-` — the
    three, then `explain_rounds` last (#526)."""
    p = table(jev_root(tmp_path))
    got = [line.split("\t")[-4:-1] for line in body(p.stdout)]
    assert got == LAST_THREE, p.stdout


def test_b_the_no_jev_rows_run_keeps_its_amendments_count(tmp_path):
    """(b)/[M2]: "the no-`jev`-rows run's are `0/0`, `0/0`, `0/0/0/0` with its
    `amendments` cell its row count" — the list is still counted, only no row
    of it was read."""
    p = table(jev_root(tmp_path))
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
    p = table(jev_root(tmp_path))
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
    p = table(jev_root(tmp_path))
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
    p = table(jev_root(tmp_path))
    totals = lines(p.stdout)[-1]
    assert totals == JEV_TOTALS, totals
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
    with_reports = jev_root(tmp_path, name="withreports")
    records_only = jev_root(tmp_path, name="recordsonly", reports=False)
    p = census("--register", "--from", str(with_reports))
    q = census("--register", "--from", str(records_only))
    assert p.returncode == 0, p.stdout + p.stderr
    assert q.returncode == 0, q.stdout + q.stderr
    assert p.stdout == "\n".join(JEV_REGISTER) + "\n", p.stdout
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
    with_reports = table(jev_root(tmp_path, name="withreports"))
    records_only = table(jev_root(tmp_path, name="recordsonly",
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
