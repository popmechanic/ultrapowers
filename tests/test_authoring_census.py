"""The authoring census: two exams in one file.

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
    record, the status and the report from the run's folder in the evidence
    repository (#1395), skips the run with no record with one stderr line
    naming it,
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

Each part keeps its own fixture roots (`build_root`, `amendments_root`) and
its own expected rows; the seam helpers are shared.
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

#: `COLUMNS`, in the clause's order: the ten BASE names, `amendments`, and
#: `explain_rounds` (#526) last.
COLUMN_NAMES = ("run", "authoring_min", "probes", "dispatched", "rejected",
                "routing", "lane", "questions", "recommended_picked",
                "run_min", "amendments", "explain_rounds")

HEADER = tsv(*COLUMN_NAMES)

# (a): the no-`authoring` record — `-` in every authoring column, its tally
# read, and `-` for `run_min` (it carries no `status.json`). `amendments` is
# `-` on every row here: `build_root` writes no `report.json`, and a run that
# left no report reads `-`, never `0`.
ROW_9 = tsv("9", "-", "-", "3", "0", "-", "-", "-", "-", "-", "-", "-")
# (a): the leg's row, verbatim. Its question carries `explain_rounds: 2`.
ROW_131 = tsv("131", "118", "12", "4", "1", "risk", "ultrapowers", "1",
              "1/1", "16", "-", "2")
# (a): `rejected` and `run_min` both `-`, `recommended_picked` 1/1 — the
# null-recommended question counts in neither p nor q. Neither of its
# questions carries `explain_rounds`, so the cell is `0`, not `-`.
ROW_133 = tsv("133", "47", "5", "2", "-", "width", "ultrapowers", "2",
              "1/1", "-", "-", "0")
# (a): m = the rows with a routing record (131, 133), k = those whose branch
# is `risk` (131); p/q summed over every row; 118 + 47 = 165; 16 is the one
# row carrying a `run_min`; no row carries an amendment count, so the sum over
# the rows that do is 0.
TOTALS = ("totals: plans=3 runs=9..133 risk_override=1/2 "
          "recommended_picked=2/2 authoring_min=165 run_min=16 "
          "amendments=0 explain_rounds=2")

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


#: The operator's evidence repository the fetch tests read from (#1395): the
#: run folders live there, never in the target `o/r`.
EVIDENCE = "ops/evidence"


def run_file_path(number, name, evidence=EVIDENCE):
    return ("repos/%s/contents/runs/o-r/%d/%s?ref=o-r/run-%d"
            % (evidence, number, name, number))


def plan_path(number, evidence=EVIDENCE):
    return run_file_path(number, "gate-verdicts.json", evidence)


def status_path(number, evidence=EVIDENCE):
    return run_file_path(number, "status.json", evidence)


def report_path(number, evidence=EVIDENCE):
    return run_file_path(number, "report.json", evidence)


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
    clause's order, `amendments` and `explain_rounds` last — read on its own so a drift there reads as a drift there."""
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
    # `run_min` is the third cell from the end now that `amendments` and
    # `explain_rounds` close the row.
    assert lines(p.stdout)[2].split("\t")[-3] == "16", p.stdout


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


def run_fetch(tmp_path, answers=None, runs="131..133",
              repo_args=("--evidence-repo", EVIDENCE)):
    """`--fetch` over the fake: `answers` defaults to part one's table, and
    `repo_args` name the evidence repository (the flag, by default)."""
    into = tmp_path / "fetched"
    into.mkdir()
    gh, calls = fake_gh(tmp_path, fetch_answers() if answers is None
                        else answers)
    env, bare_log = decoy_env(tmp_path)
    # The laptop's own `~/.ultrapowers/fleet.json` is never read: HOME is
    # the test's.
    env["HOME"] = str(tmp_path / "home")
    p = census("--fetch", "o/r", "--runs", runs, "--into", str(into),
               "--gh", str(gh), *repo_args, env=env)
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
         "amendments=0 explain_rounds=2"),
    ], p.stdout + p.stderr


def test_d_every_gh_call_is_an_api_read_of_the_expected_ref(tmp_path):
    """(d)/[M3]: each call's first two arguments are `api` and a
    `repos/ops/evidence/contents/runs/o-r/<N>/` path at the run's tag
    `o-r/run-<N>` — the record, the status and the report all in the one
    folder — and no argv names any other repository. The three record reads,
    the two status reads and the two report reads the leg asks for are all
    made."""
    p, _into, calls, _bare = run_fetch(tmp_path)
    argvs = [json.loads(line) for line in lines(calls.read_text())
             if line.strip()]
    assert argvs, "the fake `gh` was never invoked: " + p.stdout + p.stderr
    expected = {plan_path(n) for n in (131, 132, 133)}
    expected |= {status_path(n) for n in (131, 132, 133)}
    expected |= {report_path(n) for n in (131, 132, 133)}
    for argv in argvs:
        assert argv[0] == "api", argv
        assert argv[1].startswith("repos/ops/evidence/contents/runs/o-r/"), \
            argv
        assert argv[1] in expected, argv
        for token in argv:
            for owner_repo in re.findall(r"repos/([^/]+/[^/?]+)", token):
                assert owner_repo == EVIDENCE, argv
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


# ------------------------------------------- the evidence repository (#1395)

def test_the_contents_path_is_byte_exact():
    """[M1]: one run file's `gh api` path, in the evidence repository's run
    folder at the run's tag."""
    module = load_module()
    assert module.evidence_contents_path(
        "ops/evidence", "o/r", 5, "status.json") == \
        "repos/ops/evidence/contents/runs/o-r/5/status.json?ref=o-r/run-5"


def test_the_flag_asks_for_exactly_the_three_run_folder_paths(tmp_path):
    """[M2]: `--runs 5..5 --evidence-repo ops/evidence` asks `gh api` for the
    record, the status and the report of run 5 — those three, no other."""
    answers = {
        plan_path(5): blob(RECORD_131).decode("utf-8"),
        status_path(5): blob(STATUS_131).decode("utf-8"),
        report_path(5): blob(REPORT_FETCHED).decode("utf-8"),
    }
    p, into, calls, _bare = run_fetch(tmp_path, answers=answers, runs="5..5")
    assert p.returncode == 0, p.stdout + p.stderr
    assert sorted(argv[1] for argv in call_log(calls)) == sorted(answers), \
        call_log(calls)
    for name in ("gate-verdicts.json", "status.json", "report.json"):
        assert (into / "run-5" / name).is_file(), name


def test_the_config_key_steers_the_reads(tmp_path):
    """[M3]: with no `--evidence-repo`, `--fetch` reads from the repository
    the `evidence` key of `--config` names."""
    config = tmp_path / "fleet.json"
    config.write_text(json.dumps({"evidence": "cfg/ev"}))
    answers = {plan_path(5, "cfg/ev"): blob(RECORD_131).decode("utf-8")}
    p, into, calls, _bare = run_fetch(
        tmp_path, answers=answers, runs="5..5",
        repo_args=("--config", str(config)))
    assert p.returncode == 0, p.stdout + p.stderr
    assert sorted(argv[1] for argv in call_log(calls)) == sorted([
        plan_path(5, "cfg/ev"), status_path(5, "cfg/ev"),
        report_path(5, "cfg/ev")]), call_log(calls)
    assert (into / "run-5/gate-verdicts.json").read_bytes() == \
        blob(RECORD_131)


def test_the_flag_wins_over_the_config(tmp_path):
    """[M3]: `--evidence-repo` overrides the config's `evidence`."""
    config = tmp_path / "fleet.json"
    config.write_text(json.dumps({"evidence": "cfg/ev"}))
    p, _into, calls, _bare = run_fetch(
        tmp_path, answers={}, runs="5..5",
        repo_args=("--evidence-repo", EVIDENCE, "--config", str(config)))
    assert [argv[1] for argv in call_log(calls)] == [plan_path(5)], \
        call_log(calls)


def test_a_config_without_the_key_exits_2_naming_it_and_calls_no_gh(tmp_path):
    """[M3]: a config that lacks `evidence` and no flag — exit 2, a stderr
    line naming `evidence`, and the fake `gh` never invoked."""
    config = tmp_path / "fleet.json"
    config.write_text(json.dumps({"other": "x"}))
    p, _into, calls, bare_log = run_fetch(
        tmp_path, runs="5..5", repo_args=("--config", str(config)))
    assert p.returncode == 2, p.stdout + p.stderr
    assert any("evidence" in line for line in lines(p.stderr)), p.stderr
    assert not calls.exists(), calls.read_text()
    assert not bare_log.exists(), bare_log.read_text()


def test_a_missing_default_config_exits_2_and_calls_no_gh(tmp_path):
    """[M3]: no flag, no `--config`, and no `~/.ultrapowers/fleet.json` under
    the test's HOME — exit 2 naming `evidence`, no `gh` call."""
    p, _into, calls, bare_log = run_fetch(tmp_path, runs="5..5", repo_args=())
    assert p.returncode == 2, p.stdout + p.stderr
    assert "evidence" in p.stderr, p.stderr
    assert not calls.exists(), calls.read_text()
    assert not bare_log.exists(), bare_log.read_text()


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
    `render_register(rows)`, `fetch_runs(target, first, last, into, gh,
    evidence)` and `evidence_contents_path(evidence, target, number, name)`,
    with those parameter names; `census_rows` answers one dict per row."""
    module = load_module()
    wanted = {
        "census_rows": ["root"],
        "render_table": ["rows"],
        "render_register": ["rows"],
        "fetch_runs": ["target", "first", "last", "into", "gh", "evidence"],
        "evidence_contents_path": ["evidence", "target", "number", "name"],
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
# `{task, amends, what, why}` rows.
def amendment(task, amends):
    return {
        "task": task,
        "amends": amends,
        "what": "the clause moved",
        "why": "the tree said otherwise",
    }


#: A report carrying the empty list: `0` amendments. Zero is a value the file
#: carries, so the cell is `0` and the totals sum is still 0.
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


#: Where the `amendments` cell sits in a row, counted from the end — the
#: `explain_rounds` column a later plan added closes the row after it.
AMENDMENTS_FROM_END = len(COLUMN_NAMES) - COLUMN_NAMES.index("amendments")

# (a): `run-9`'s record predates the plan — `-` in every authoring column, its
# tally read — and its report carries three amendment rows.
AM_ROW_9 = tsv("9", "-", "-", "3", "0", "-", "-", "-", "-", "-", "3", "-")
# (a): the full row, its report carrying no `amendments` key. Its question
# carries no `explain_rounds`, so that cell is `0`, not `-` — the record has
# an `authoring` key.
AM_ROW_131 = tsv("131", "118", "12", "4", "1", "risk", "ultrapowers", "1",
                 "1/1", "16", "-", "0")
# (a): no report at all beside the record.
AM_ROW_133 = tsv("133", "47", "5", "2", "-", "width", "ultrapowers", "2",
                 "1/1", "-", "-", "0")

# ------------------------------------------------------------- the M3 expected

#: [M3] the totals line with its ` runs=<window>` field stripped: exactly the
#: format string M3 quotes, filled in for leg (a)'s root. 118 + 47 = 165; 16 is
#: the one row carrying a `run_min`; 3 is the one row carrying an `amendments`.
TOTALS_WITHOUT_WINDOW = ("totals: plans=3 risk_override=1/2 "
                         "recommended_picked=2/2 authoring_min=165 "
                         "run_min=16 amendments=3 explain_rounds=0")

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
    `amendments`, then `explain_rounds`, which a later plan hung off it."""
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
        "authoring_min=165 run_min=16 amendments=0 explain_rounds=0"), totals


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
    """(c)/[M1]: exactly `repos/ops/evidence/contents/runs/o-r/131/report.json
    ?ref=o-r/run-131` and its 132 twin, each once, each an `api`
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
        assert argv[1].startswith("repos/ops/evidence/contents/runs/o-r/"), \
            argv
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
