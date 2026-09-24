"""The census counts amendments: the new column, the new totals suffix, the
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
helpers are copied from `tests/test_authoring_census.py`, never imported — the
task says so, and the two files are graded apart.

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
"""
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


def lines(text):
    return text.splitlines()


# ---------------------------------------------------------------- the records

# The records are the sibling exam's, unchanged: this task adds a column, it
# does not move the ten that were already there, so their cells stay readable.
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

# A record older than this plan: no `authoring` key.
RECORD_9 = {
    "tasks": [{"id": "1", "verdict": "pass"}],
    "tally": {"dispatched": 3, "rejected": 0},
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

# The shared literal the Context spells: `report.json`'s top-level `amendments`
# is a list of `{task, amends, what, why}` rows.
def amendment(task, amends):
    return {
        "task": task,
        "amends": amends,
        "what": "the clause moved",
        "why": "the tree said otherwise",
    }


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

#: Leg (b)'s other root: a report carrying the empty list. Zero is a value the
#: file carries, so the cell is `0` and the totals sum is still 0.
REPORT_EMPTY = {"run": "0", "amendments": []}

#: Leg (c)'s fetched report: two rows, so the fetched row's cell is `2` and no
#: leg's expected number is the same as another's by accident.
REPORT_FETCHED = {
    "run": "131",
    "amendments": [amendment("1", "M2"), amendment("3", "M1")],
}


# ------------------------------------------------------------- the M2 expected

#: [M2] `COLUMNS` gains `amendments` as its last name, after `run_min`. A
#: later plan (#526) hangs `explain_rounds` off the end, after `magnitude`.
COLUMN_NAMES = ("run", "authoring_min", "probes", "dispatched", "rejected",
                "routing", "lane", "questions", "recommended_picked",
                "run_min", "amendments", "compelled", "plan_fault",
                "magnitude", "explain_rounds")

HEADER = tsv(*COLUMN_NAMES)

#: Where the `amendments` cell sits in a row, counted from the end — the three
#: amendment-reading columns a later plan added close the row after it.
AMENDMENTS_FROM_END = len(COLUMN_NAMES) - COLUMN_NAMES.index("amendments")

# (a): `run-9`'s record predates the plan — `-` in every authoring column, its
# tally read — and its report carries three amendment rows, none of them read
# (no row carries a `jev`), so the readings are the empty ones and not `-`.
ROW_9 = tsv("9", "-", "-", "3", "0", "-", "-", "-", "-", "-", "3",
            "0/0", "0/0", "0/0/0/0", "-")
# (a): the full row, its report carrying no `amendments` key — so no list, and
# no list is no reading: `-` in all three. Its question carries no
# `explain_rounds`, so that cell is `0`, not `-` — the record has an
# `authoring` key.
ROW_131 = tsv("131", "118", "12", "4", "1", "risk", "ultrapowers", "1",
              "1/1", "16", "-", "-", "-", "-", "0")
# (a): no report at all beside the record.
ROW_133 = tsv("133", "47", "5", "2", "-", "width", "ultrapowers", "2",
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

def blob(obj):
    """One record, as the bytes that land on disk — the fetch leg compares the
    file it wrote against exactly this."""
    return (json.dumps(obj, indent=2) + "\n").encode("utf-8")


def census(*args, env=None):
    """The script, as a subprocess. Nothing here reaches into its internals."""
    assert CENSUS.is_file(), (
        "the census script does not exist yet: %s" % CENSUS)
    return subprocess.run([sys.executable, str(CENSUS), *args],
                          capture_output=True, text=True, env=env)


def write_run(root, number, record, status=None, report=None):
    """One `run-<N>` directory. `report` is this task's addition: the
    `report.json` the fetch now writes beside the record and the status."""
    d = root / ("run-%s" % number)
    d.mkdir(parents=True)
    if record is not None:
        (d / "gate-verdicts.json").write_bytes(blob(record))
    if status is not None:
        (d / "status.json").write_bytes(blob(status))
    if report is not None:
        (d / "report.json").write_bytes(blob(report))
    return d


def build_root(tmp_path, name="census", reports=("three", "no_key", None)):
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
    root = tmp_path / name
    root.mkdir()
    write_run(root, 131, RECORD_131, STATUS_131, which[reports[1]])
    write_run(root, 133, RECORD_133, None, which[reports[2]])
    write_run(root, 9, RECORD_9, None, which[reports[0]])
    return root


DECOY = """#!/bin/sh
printf '%s\\n' "$*" >> '{log}'
exit 1
"""


def decoy_env(tmp_path, name="decoy"):
    """A `gh` first on PATH that logs and fails. `--gh` names a binary, so the
    real one is never resolved by bare name. Returns (env, the log that must
    never appear)."""
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
    """[M1] the third read: `.ultrapowers/runs/<N>/report.json` at the evidence
    tag, over the same `repos/<owner>/<repo>/contents/…?ref=…` shape."""
    return ("repos/o/r/contents/.ultrapowers/runs/%d/report.json"
            "?ref=ultra/evidence/run-%d" % (number, number))


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
    root = build_root(tmp_path)
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
    root = build_root(tmp_path)
    p = census("--from", str(root))
    assert p.returncode == 0, p.stdout + p.stderr
    assert last_cells(p.stdout) == ["3", "-", "-"], p.stdout


def test_a_each_whole_row_gains_its_eleventh_cell_and_keeps_the_ten(tmp_path):
    """(a)/[M2]: the rows verbatim — the ten cells this task does not touch,
    then the new one, then whatever closes the row after it. `run-9`'s
    `rejected` is still `0` and not `-`, and `run-133` still carries neither
    `rejected` nor a `run_min`."""
    root = build_root(tmp_path)
    p = census("--from", str(root))
    assert lines(p.stdout)[1:4] == [ROW_9, ROW_131, ROW_133], p.stdout


def test_a_a_report_without_the_key_reads_a_dash_and_an_empty_list_a_zero(
        tmp_path):
    """(a)/[M2]: the length of the list "when that file parses as an object
    carrying a list under that key, `None` otherwise". A report with no such
    key carries no value and prints `-`; a report carrying `[]` carries the
    value zero and prints `0`."""
    no_key = build_root(tmp_path, name="nokey",
                        reports=("no_key", "no_key", "no_key"))
    empty = build_root(tmp_path, name="empty",
                       reports=("empty", "empty", "empty"))
    assert last_cells(census("--from", str(no_key)).stdout) == \
        ["-", "-", "-"], "a report with no `amendments` key must read `-`"
    assert last_cells(census("--from", str(empty)).stdout) == \
        ["0", "0", "0"], "a report carrying `[]` must read `0`, not `-`"


def test_a_census_rows_carries_an_amendments_value_per_row(tmp_path):
    """(a)/[M2]: read at the seam the clause names — `census_rows` gives each
    row an `amendments` value: the list's length, or None."""
    module = load_module()
    rows = module.census_rows(build_root(tmp_path))
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
    root = build_root(tmp_path)
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
    root = build_root(tmp_path)
    p = census("--from", str(root))
    totals = lines(p.stdout)[-1]
    assert without_window(totals) == TOTALS_WITHOUT_WINDOW, totals
    assert totals.count("amendments=") == 1, totals


def test_b_a_root_whose_reports_carry_no_lists_ends_with_zero(tmp_path):
    """(b)/[M3]: no row carries a value, so the sum over the rows that carry
    one is the empty sum — the line carries ` amendments=0`, not
    ` amendments=-` and not a missing field."""
    root = build_root(tmp_path, name="nokey",
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
    root = build_root(tmp_path, name="empty",
                      reports=("empty", "empty", "empty"))
    p = census("--from", str(root))
    assert totals_field(lines(p.stdout)[-1], "amendments") == "0", p.stdout


# ------------------------------------------------------------------- leg (c)

def fetch_answers():
    """[M1]'s leg (c) table: the plan and status reads answer for 131 and 132,
    the report read answers for 131 only."""
    return {
        plan_path(131): blob(RECORD_131).decode("utf-8"),
        plan_path(132): blob(RECORD_133).decode("utf-8"),
        status_path(131): blob(STATUS_131).decode("utf-8"),
        status_path(132): blob(STATUS_131).decode("utf-8"),
        report_path(131): blob(REPORT_FETCHED).decode("utf-8"),
    }


def run_fetch(tmp_path, answers=None, runs="131..132"):
    into = tmp_path / "fetched"
    into.mkdir()
    gh, calls = fake_gh(tmp_path, fetch_answers() if answers is None
                        else answers)
    env, bare_log = decoy_env(tmp_path)
    p = census("--fetch", "o/r", "--runs", runs, "--into", str(into),
               "--gh", str(gh), env=env)
    return p, into, calls, bare_log


def test_c_fetch_writes_the_report_as_the_decoded_bytes_of_the_answer(
        tmp_path):
    """(c)/[M1]: `run-131/report.json` is written into `run-<N>/report.json`,
    and it is exactly the decoded bytes of the answer's base64 `content` — not
    a re-serialisation of it."""
    p, into, _calls, _bare = run_fetch(tmp_path)
    assert p.returncode == 0, p.stdout + p.stderr
    written = into / "run-131/report.json"
    assert written.is_file(), "no report was written: " + repr(sorted(
        str(q.relative_to(into)) for q in into.rglob("*")))
    assert written.read_bytes() == blob(REPORT_FETCHED), p.stdout + p.stderr


def test_c_a_report_that_does_not_answer_leaves_the_file_unwritten(tmp_path):
    """(c)/[M1]: run 132's report read exits non-zero, so that file is
    unwritten — and the run is still a row, its record and status having
    answered."""
    p, into, _calls, _bare = run_fetch(tmp_path)
    assert not (into / "run-132/report.json").exists(), sorted(
        q.name for q in (into / "run-132").iterdir())
    assert (into / "run-132/gate-verdicts.json").is_file(), p.stderr


def test_c_both_report_paths_are_requested_as_api_reads_of_the_evidence_tag(
        tmp_path):
    """(c)/[M1]: exactly `repos/o/r/contents/.ultrapowers/runs/131/report.json
    ?ref=ultra/evidence/run-131` and its 132 twin, each once, each an `api`
    call naming exactly two arguments — the shape the two existing fetches
    already use."""
    p, _into, calls, _bare = run_fetch(tmp_path)
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
    p, _into, _calls, _bare = run_fetch(tmp_path)
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
    p, _into, _calls, bare_log = run_fetch(tmp_path)
    assert not bare_log.exists(), bare_log.read_text() + p.stdout + p.stderr


# ------------------------------------------------------------------- leg (d)

def skipped_run_answers():
    """Run 200's plan tag carries a record; run 201's does not, though its
    status and its report both answer."""
    return {
        plan_path(200): blob(RECORD_131).decode("utf-8"),
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


# ------------------------------------------------------------------ the seam

def load_module():
    import importlib.util
    assert CENSUS.is_file(), (
        "the census script does not exist yet: %s" % CENSUS)
    spec = importlib.util.spec_from_file_location("authoring_census", CENSUS)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
