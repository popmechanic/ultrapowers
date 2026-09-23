"""The authoring census: one table per release, the register, and the fetch.

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

HEADER = tsv("run", "authoring_min", "probes", "dispatched", "rejected",
             "routing", "lane", "questions", "recommended_picked", "run_min",
             "amendments", "compelled", "plan_fault", "magnitude",
             "explain_rounds")

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


def write_run(root, number, record, status=None):
    d = root / ("run-%s" % number)
    d.mkdir(parents=True)
    if record is not None:
        (d / "gate-verdicts.json").write_bytes(blob(record))
    if status is not None:
        (d / "status.json").write_bytes(blob(status))
    return d


def build_root(tmp_path, name="census"):
    """(a)'s three run directories, under one root."""
    root = tmp_path / name
    root.mkdir()
    write_run(root, 131, RECORD_131, STATUS_131)
    write_run(root, 133, RECORD_133)
    write_run(root, 9, RECORD_9)
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


def run_fetch(tmp_path):
    into = tmp_path / "fetched"
    into.mkdir()
    gh, calls = fake_gh(tmp_path, fetch_answers())
    env, bare_log = decoy_env(tmp_path)
    p = census("--fetch", "o/r", "--runs", "131..133", "--into", str(into),
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
    import importlib.util
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
    import inspect
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
