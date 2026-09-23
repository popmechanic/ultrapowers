"""tests/test_catch_counter.py — the exam for the catch-counter ratchet's first
half: the record pulled off the evidence tags and counted.

Written against the task's Machine clauses, leg by leg. Every assertion names
the leg it belongs to and the clause it comes from, so a reader can map this
file back to the contract:

  M1  `catch_counter.py --fetch <owner>/<repo> --runs <A>..<B> --into <dir>`
      writes, for each N from A to B inclusive, `<dir>/run-<N>/events.jsonl`,
      `report.json`, `receipt.json` and `status.json`, each read through the
      binary `--gh` names (`gh` by default) with exactly the arguments
      `api repos/<owner>/<repo>/contents/.ultrapowers/runs/<N>/<name>?ref=ultra/evidence/run-<N>`
      and decoded from the answer's base64 `content`; a run whose
      `events.jsonl` does not answer is skipped whole — one stderr line naming
      the run, no `run-<N>` directory — and a run whose other three files do
      not answer keeps `events.jsonl` with the missing file absent; the fetched
      run directories are then counted exactly as `PATH` arguments are, so with
      `--ledger` one `catch-count` row per fetched run is appended and the
      closing `%d run(s) counted, %d row(s) appended, %d already recorded` line
      counts them; `--fetch` without both `--runs <A>..<B>` and `--into <dir>`,
      or with a range that counts backwards, exits 2 with one line on stderr.

Legs: (a) [M1] the three fetched runs — four files for 7, 8 skipped whole, 9
without its `receipt.json` — the call log's shape, and the decoy `gh` first on
PATH that must stay unrun; (b) [M1] the same call with `--ledger`: two rows
keyed on the `run:open` ids, the closing line, and a second call that appends
nothing; (c) [M1] the three refusals at exit 2, and that no positional `PATH`
is needed beside `--fetch`; (h) [M1] the Proof's second `Run:` — `--help` names
`--fetch`.

The script is driven as a subprocess, with a fake `gh` written under `tmp_path`
that answers a contents read from a table keyed on its argv and logs every
call, and a decoy `gh` first on `PATH` whose log must stay empty — the shape
`tests/test_authoring_census.py` uses, written here rather than imported, so
this exam depends on no other exam. The real binary is never invoked and
nothing here reaches the network.

The module is imported the way `tests/test_catch_report.py` does it
(`sys.path.insert(0, SCRIPTS)`), and the name this task PRODUCES (`fetch_runs`)
is reached as an attribute of the module rather than imported at the top, so at
BASE the legs red on the absent `--fetch` surface rather than on an ImportError.
Neither `ULTRA_BASE` nor any commit sha is read.
"""
import base64
import inspect
import json
import os
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "skills/ultrapowers/scripts"
sys.path.insert(0, str(SCRIPTS))
import catch_counter  # noqa: E402

COUNTER = SCRIPTS / "catch_counter.py"

TARGET = "o/r"
RUN_FILES = ("events.jsonl", "report.json", "receipt.json", "status.json")


# --- the fake `gh` and the decoy -------------------------------------------

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

DECOY = """#!/bin/sh
printf '%s\\n' "$*" >> '{log}'
exit 1
"""


def fake_gh(tmp_path, answers, name="fakebin"):
    """The fake, plus the table it answers from. Returns (its path, its call
    log). [M1]"""
    bindir = tmp_path / name
    bindir.mkdir()
    (bindir / "answers.json").write_text(json.dumps(answers))
    gh = bindir / "gh-fake"
    gh.write_text(FAKE_GH)
    gh.chmod(0o755)
    return gh, bindir / "calls.jsonl"


def decoy_env(tmp_path, name="decoy"):
    """A `gh` first on PATH that logs and fails. `--gh` names a binary, so the
    real one is never resolved by bare name. Returns (env, the log that must
    never appear). [M1]"""
    bindir = tmp_path / name
    bindir.mkdir()
    log = bindir / "bare-gh.log"
    gh = bindir / "gh"
    gh.write_text(DECOY.format(log=log))
    gh.chmod(0o755)
    env = dict(os.environ)
    env["PATH"] = str(bindir) + os.pathsep + env["PATH"]
    return env, log


def contents_path(number, name):
    """M1's argument, spelled exactly as the clause spells it."""
    return ("repos/%s/contents/.ultrapowers/runs/%d/%s?ref=ultra/evidence/"
            "run-%d" % (TARGET, number, name, number))


# --- the record the fake answers with --------------------------------------
#
# Run 7 answers all four files, run 8 answers no `events.jsonl` (its
# `report.json` is on the table, so "skipped whole" has something to skip), and
# run 9 answers three files but no `receipt.json`.

EVENTS_7 = "\n".join(json.dumps(event) for event in [
    {"id": 1, "kind": "run:open", "runId": "opened-seven"},
    {"id": 2, "kind": "driver:exam-run", "task": "1", "exit": 1,
     "cmd": "python3 -m pytest tests/test_x.py"},
    {"id": 3, "kind": "worker:end", "label": "fix:1:0"},
    {"id": 4, "kind": "driver:exam-run", "task": "1", "exit": 0,
     "cmd": "python3 -m pytest tests/test_x.py"},
]) + "\n"
REPORT_7 = json.dumps({"tasks": [{"task": "1", "examEdited": []}]}) + "\n"
RECEIPT_7 = json.dumps(
    {"compile": {"tasks": [{"id": "1", "writes": ["lib/x.py"]}]}}) + "\n"
STATUS_7 = json.dumps({"startedAt": "2026-03-15T00:00:00Z"}) + "\n"

EVENTS_9 = "\n".join(json.dumps(event) for event in [
    {"id": 1, "kind": "run:open", "runId": "opened-nine"},
    {"id": 2, "kind": "driver:proof-run", "task": "2", "exit": 0,
     "cmd": "python3 -m pytest tests/test_y.py"},
]) + "\n"
REPORT_9 = json.dumps({"tasks": [{"task": "2", "examEdited": []}]}) + "\n"
STATUS_9 = json.dumps({"startedAt": "2026-03-16T00:00:00Z"}) + "\n"

REPORT_8 = json.dumps({"tasks": []}) + "\n"

ANSWERS = {
    contents_path(7, "events.jsonl"): EVENTS_7,
    contents_path(7, "report.json"): REPORT_7,
    contents_path(7, "receipt.json"): RECEIPT_7,
    contents_path(7, "status.json"): STATUS_7,
    contents_path(8, "report.json"): REPORT_8,
    contents_path(9, "events.jsonl"): EVENTS_9,
    contents_path(9, "report.json"): REPORT_9,
    contents_path(9, "status.json"): STATUS_9,
}

def plan_path(number):
    """The fifth read of a run: the plan at the repository root of the same
    evidence ref, since the factory keeps what a task wrote in its Files."""
    return ("repos/%s/contents/.ultrapowers/plan.md?ref=ultra/evidence/run-%d"
            % (TARGET, number))


EXPECTED_PATHS = {contents_path(n, name)
                  for n in (7, 8, 9) for name in RUN_FILES} | {
                      plan_path(n) for n in (7, 8, 9)}


# --- driving the script ----------------------------------------------------

def counter(*args, env=None):
    return subprocess.run([sys.executable, str(COUNTER), *args],
                          capture_output=True, text=True, env=env)


def lines(text):
    return [line for line in text.splitlines() if line.strip()]


def run_fetch(tmp_path, *extra, into_name="fetched"):
    """`--fetch o/r --runs 7..9 --into <dir> --gh <fake>`, with the decoy first
    on PATH. Returns (proc, into, the call log, the decoy's log)."""
    into = tmp_path / into_name
    into.mkdir(exist_ok=True)
    # Named off the destination, so a second call in the same `tmp_path` gets
    # its own fake, its own call log and its own decoy.
    gh, calls = fake_gh(tmp_path, ANSWERS, name="fakebin-" + into_name)
    env, bare_log = decoy_env(tmp_path, name="decoy-" + into_name)
    proc = counter("--fetch", TARGET, "--runs", "7..9", "--into", str(into),
                   "--gh", str(gh), *extra, env=env)
    return proc, into, calls, bare_log


def sanitized(text, tmp_path):
    """The lines of `text` with the sandbox's own path removed, so a digit in
    `tmp_path` is never read as a run number."""
    return [line.replace(str(tmp_path), "") for line in lines(text)]


# ------------------------------------------------------------------- leg (a)

def test_leg_a_the_four_files_of_run_7_are_the_decoded_answers(tmp_path):
    """(a) [M1]: `run-7/` holds the four files, each byte-equal to the decoded
    bytes of its answer's base64 `content`."""
    proc, into, _calls, _bare = run_fetch(tmp_path)
    assert proc.returncode == 0, (
        "(a) [M1] `--fetch` with `--runs` and `--into` and no positional "
        f"`PATH` succeeds: {proc.stdout + proc.stderr}")
    for name, body in (("events.jsonl", EVENTS_7), ("report.json", REPORT_7),
                       ("receipt.json", RECEIPT_7), ("status.json", STATUS_7)):
        got = (into / "run-7" / name)
        assert got.is_file(), (
            f"(a) [M1] `run-7/{name}` is written: {proc.stdout + proc.stderr}")
        assert got.read_bytes() == body.encode("utf-8"), (
            f"(a) [M1] `run-7/{name}` is the decoded answer, byte for byte")


def test_leg_a_run_8_is_skipped_whole_with_one_stderr_line(tmp_path):
    """(a) [M1]: run 8's `events.jsonl` does not answer, so no `run-8`
    directory is left behind and exactly one stderr line names the run."""
    proc, into, _calls, _bare = run_fetch(tmp_path)
    assert not (into / "run-8").exists(), (
        "(a) [M1] a run whose `events.jsonl` does not answer leaves no "
        f"`run-8` directory: {sorted(p.name for p in into.iterdir())}")
    assert sorted(p.name for p in into.iterdir()) == ["run-7", "run-9"], (
        "(a) [M1] the fetch writes run 7 and run 9 and nothing else: "
        f"{sorted(p.name for p in into.iterdir())}")
    named = [line for line in sanitized(proc.stderr, tmp_path)
             if re.search(r"\b8\b", line)]
    assert len(named) == 1, (
        "(a) [M1] exactly one stderr line names the skipped run 8, got "
        f"{named!r} out of {proc.stderr!r}")


def test_leg_a_run_9_keeps_its_events_with_the_receipt_absent(tmp_path):
    """(a) [M1]: run 9's `receipt.json` does not answer — the run keeps
    `events.jsonl` and the missing file is simply absent."""
    proc, into, _calls, _bare = run_fetch(tmp_path)
    assert (into / "run-9/events.jsonl").read_bytes() == \
        EVENTS_9.encode("utf-8"), proc.stdout + proc.stderr
    assert (into / "run-9/report.json").read_bytes() == \
        REPORT_9.encode("utf-8"), proc.stdout + proc.stderr
    assert (into / "run-9/status.json").read_bytes() == \
        STATUS_9.encode("utf-8"), proc.stdout + proc.stderr
    assert not (into / "run-9/receipt.json").exists(), (
        "(a) [M1] the file that did not answer is absent, and the run is kept: "
        f"{sorted(p.name for p in (into / 'run-9').iterdir())}")


def test_leg_a_every_call_is_api_plus_the_contents_path_and_nothing_else(
        tmp_path):
    """(a) [M1]: each logged call is exactly `api` and a
    `repos/o/r/contents/.ultrapowers/runs/<N>/<name>?ref=ultra/evidence/run-<N>`
    path — two arguments, no third — and no argv names another repository. The
    four reads of run 7 and the `events.jsonl` reads of 8 and 9 are all made."""
    proc, _into, calls, _bare = run_fetch(tmp_path)
    assert calls.exists(), (
        "(a) [M1] the fake `gh` was invoked: " + proc.stdout + proc.stderr)
    argvs = [json.loads(line) for line in lines(calls.read_text())]
    assert argvs, "(a) [M1] the fake `gh` was never invoked"
    for argv in argvs:
        assert argv[0] == "api", (
            f"(a) [M1] every call's first argument is `api`, got {argv!r}")
        assert len(argv) == 2, (
            "(a) [M1] every call names exactly `api` and the contents path, "
            f"and nothing else, got {argv!r}")
        assert argv[1] in EXPECTED_PATHS, (
            "(a) [M1] every call reads "
            "`repos/o/r/contents/.ultrapowers/runs/<N>/<name>"
            "?ref=ultra/evidence/run-<N>` or the run's plan at "
            f"`.ultrapowers/plan.md` on the same ref, got {argv[1]!r}")
        for owner_repo in re.findall(r"repos/([^/]+/[^/?]+)", argv[1]):
            assert owner_repo == TARGET, argv
    made = {argv[1] for argv in argvs}
    for required in [contents_path(7, name) for name in RUN_FILES] + [
            plan_path(7),
            contents_path(8, "events.jsonl"),
            contents_path(9, "events.jsonl"),
            contents_path(9, "receipt.json")]:
        assert required in made, (
            f"(a) [M1] the fetch reads {required!r}: {sorted(made)}")


def test_leg_a_the_bare_gh_on_path_is_never_resolved(tmp_path):
    """(a) [M1]: the script runs the binary `--gh` names and no other — the
    decoy first on PATH logs nothing."""
    proc, _into, _calls, bare_log = run_fetch(tmp_path)
    assert not bare_log.exists(), (
        "(a) [M1] the decoy `gh` first on PATH was invoked: "
        + bare_log.read_text() + proc.stdout + proc.stderr)


# ------------------------------------------------------------------- leg (b)

LEDGER_FIRST = "2 run(s) counted, 2 row(s) appended, 0 already recorded"
LEDGER_AGAIN = "2 run(s) counted, 0 row(s) appended, 2 already recorded"


def catch_rows(ledger):
    return [json.loads(line) for line in lines(ledger.read_text())]


def test_leg_b_the_ledger_gains_one_row_per_fetched_run(tmp_path):
    """(b) [M1]: the fetched run directories are counted exactly as `PATH`
    arguments are — two `catch-count` rows, keyed on the `run:open` ids of the
    runs that answered, and the closing line counts them."""
    ledger = tmp_path / "ledger.jsonl"
    proc, _into, _calls, _bare = run_fetch(tmp_path, "--ledger", str(ledger))
    assert proc.returncode == 0, proc.stdout + proc.stderr

    rows = catch_rows(ledger)
    assert len(rows) == 2, (
        "(b) [M1] the ledger gains exactly two rows — one per fetched run, "
        f"and none for the skipped run 8: {rows!r}")
    assert [row.get("kind") for row in rows] == ["catch-count", "catch-count"], (
        f"(b) [M1] both rows are `catch-count` rows: {rows!r}")
    assert [row.get("runId") for row in rows] == ["opened-seven",
                                                  "opened-nine"], (
        "(b) [M1] the rows' `runId`s are the `run:open` ids of runs 7 and 9, "
        f"read out of the fetched `events.jsonl`: {rows!r}")
    assert lines(proc.stdout)[-1] == LEDGER_FIRST, (
        f"(b) [M1] the closing stdout line is {LEDGER_FIRST!r}: {proc.stdout!r}")


def test_leg_b_the_row_is_the_reading_of_the_fetched_record(tmp_path):
    """(b) [M1]: the row is derived from the four fetched files — run 7's
    `receipt.json` and `report.json` stand behind its catch, and run 9, whose
    `receipt.json` never answered, carries the empty `touched` and
    `exercises` that absence makes."""
    ledger = tmp_path / "ledger.jsonl"
    proc, _into, _calls, _bare = run_fetch(tmp_path, "--ledger", str(ledger))
    assert proc.returncode == 0, proc.stdout + proc.stderr
    seven, nine = catch_rows(ledger)

    assert seven["catches"] == {"tests/test_x.py": 1}, (
        "(b) [M1] run 7's row is the reading of its own fetched record: "
        f"{seven!r}")
    assert seven["touched"] == ["lib/x.py"], (
        f"(b) [M1] read off the fetched `receipt.json`: {seven!r}")
    assert seven["startedAt"] == "2026-03-15T00:00:00Z", (
        f"(b) [M1] and its `startedAt` off the fetched `status.json`: {seven!r}")
    assert nine["touched"] == [] and nine["exercises"] == {}, (
        "(b) [M1] run 9's `receipt.json` did not answer, so nothing stands "
        f"behind its paths: {nine!r}")
    assert nine["startedAt"] == "2026-03-16T00:00:00Z", (
        f"(b) [M1] its `status.json` did answer: {nine!r}")


def test_leg_b_a_second_identical_call_appends_nothing(tmp_path):
    """(b) [M1]: a second identical call appends nothing — `0 row(s) appended,
    2 already recorded` — and the ledger's rows are unchanged."""
    ledger = tmp_path / "ledger.jsonl"
    first, _into, _calls, _bare = run_fetch(tmp_path, "--ledger", str(ledger))
    assert first.returncode == 0, first.stdout + first.stderr
    before = ledger.read_bytes()

    again, _into2, _calls2, _bare2 = run_fetch(
        tmp_path, "--ledger", str(ledger), into_name="fetched-again")
    assert again.returncode == 0, again.stdout + again.stderr
    assert lines(again.stdout)[-1] == LEDGER_AGAIN, (
        f"(b) [M1] the second call's closing line is {LEDGER_AGAIN!r}: "
        f"{again.stdout!r}")
    assert ledger.read_bytes() == before, (
        "(b) [M1] and the ledger's bytes are unchanged by it")


# ------------------------------------------------------------------- leg (c)

def refusal(tmp_path, *args, name="bin"):
    gh, _calls = fake_gh(tmp_path, ANSWERS, name=name)
    env, _bare = decoy_env(tmp_path, name=name + "-decoy")
    return counter(*args, "--gh", str(gh), env=env)


def test_leg_c_fetch_without_runs_is_refused(tmp_path):
    """(c) [M1]: `--fetch` without `--runs` exits 2 with one line on stderr."""
    proc = refusal(tmp_path, "--fetch", TARGET, "--into", str(tmp_path / "d"))
    assert proc.returncode == 2, (
        "(c) [M1] `--fetch` without `--runs <A>..<B>` exits 2, got "
        f"{proc.returncode}: {proc.stdout + proc.stderr}")
    assert len(lines(proc.stderr)) == 1, (
        f"(c) [M1] with one line on stderr: {proc.stderr!r}")


def test_leg_c_fetch_without_into_is_refused(tmp_path):
    """(c) [M1]: `--fetch` without `--into` exits 2 with one line on stderr."""
    proc = refusal(tmp_path, "--fetch", TARGET, "--runs", "7..9")
    assert proc.returncode == 2, (
        "(c) [M1] `--fetch` without `--into <dir>` exits 2, got "
        f"{proc.returncode}: {proc.stdout + proc.stderr}")
    assert len(lines(proc.stderr)) == 1, (
        f"(c) [M1] with one line on stderr: {proc.stderr!r}")


def test_leg_c_a_backwards_range_is_refused(tmp_path):
    """(c) [M1]: a range that counts backwards exits 2 with one line on
    stderr."""
    proc = refusal(tmp_path, "--fetch", TARGET, "--runs", "9..7",
                   "--into", str(tmp_path / "d"))
    assert proc.returncode == 2, (
        "(c) [M1] `--runs 9..7` counts backwards and exits 2, got "
        f"{proc.returncode}: {proc.stdout + proc.stderr}")
    assert len(lines(proc.stderr)) == 1, (
        f"(c) [M1] with one line on stderr: {proc.stderr!r}")


def test_leg_c_neither_fetch_nor_a_path_is_refused(tmp_path):
    """(c) [M1]: `paths` is `nargs="*"`, so no positional is needed beside
    `--fetch` — leg (a)'s call carries none and exits 0 — and a call that names
    neither `--fetch` nor a `PATH` exits 2 saying so."""
    proc = counter()
    assert proc.returncode == 2, (
        "(c) [M1] neither `--fetch` nor a `PATH`: exit 2, got "
        f"{proc.returncode}: {proc.stdout + proc.stderr}")
    assert proc.stderr.strip(), (
        "(c) [M1] with a usage message on stderr: " + repr(proc.stderr))


# ------------------------------------------------------------------- leg (h)

def test_leg_h_help_names_the_fetch_flag():
    """(h) [M1]: the Proof's second `Run:` — `--help` names `--fetch`."""
    proc = counter("--help")
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert "--fetch" in proc.stdout, (
        "(h) [M1] `catch_counter.py --help` names `--fetch`: " + proc.stdout)


# ------------------------------------------------------------- the Interfaces

def test_produces_fetch_runs_signature_and_return(tmp_path):
    """[Produces] `fetch_runs(target: str, first: int, last: int, into: Path,
    gh="gh") -> list[int]`, with those parameter names, that default, and the
    runs written as its answer."""
    fetch_runs = getattr(catch_counter, "fetch_runs", None)
    assert callable(fetch_runs), (
        "[Produces] `catch_counter.fetch_runs` does not exist yet")
    signature = inspect.signature(fetch_runs)
    assert list(signature.parameters) == ["target", "first", "last", "into",
                                          "gh"], (
        "[Produces] `fetch_runs(target, first, last, into, gh)`, got "
        f"{signature}")
    assert signature.parameters["gh"].default == "gh", (
        f'[Produces] `gh="gh"` is the default, got {signature}')

    gh, _calls = fake_gh(tmp_path, ANSWERS, name="produces-bin")
    into = tmp_path / "produced"
    written = fetch_runs(TARGET, 7, 9, into, str(gh))
    assert written == [7, 9], (
        "[Produces] the runs written, in order, as a list of ints — run 8 "
        f"answered no `events.jsonl`: {written!r}")
    assert (into / "run-7/events.jsonl").read_bytes() == \
        EVENTS_7.encode("utf-8"), "[Produces] and the files are on disk"


def test_the_answer_is_decoded_from_the_base64_content(tmp_path):
    """[M1]: the bytes on disk are the decode of the answer's base64
    `content` — asserted against the encoding itself, so a fetch that wrote the
    envelope, or the payload undecoded, reds here."""
    _proc, into, _calls, _bare = run_fetch(tmp_path)
    on_disk = (into / "run-7/events.jsonl").read_bytes()
    assert base64.b64encode(on_disk).decode("ascii") == \
        base64.b64encode(EVENTS_7.encode("utf-8")).decode("ascii"), (
        "[M1] `<dir>/run-7/events.jsonl` is the decoded `content`")
    assert b"content" not in on_disk and b"base64" not in on_disk, (
        "[M1] and not the JSON envelope `gh` answered with")
