"""tests/test_jev_census.py -- the exam for the Jev census: one command over a
range of runs that names the questions Jev answers near 0.5 or barely moves
within a role, printing the runs it skipped beside its n.

Written against the task's Machine clauses, leg by leg. Every assertion names
the leg and the clause it comes from, so a reader can map this file back to
the contract.

The Proof names five legs, worked over one shared fixture (leg a's root, the
Context's own literal shape: `run-1/events.jsonl`'s six supervisor rows, one
landing row, one unanswered landing row and a `worker:tool` row; `run-2`'s one
landing row):

  * (a) [M1] the header and the first three question lines of the shared root.
  * (b) [M2] the same root with the five `exam:` nouls replaced so
      `supervisor/stuck` no longer bands or holds constant: flag `-`.
  * (c) [M3] the `runs:` line, with and without a third run holding no `jev`
      row.
  * (d) [M4] `--fetch` over a stub `gh`: run 5 answers, run 6 does not, so the
      close reads `read=5 skipped=6(no events.jsonl)`.
  * (e) [M5] every call above exits 0, and `--fetch` missing `--runs` or
      `--into` exits 2 with one stderr line.

M1 also spells three worked examples inline (`M3__f1` -> `M__f`, `M2__t0` ->
`M__t`, `g4` -> `g`) and two definitions the five legs' own numbers do not, on
their own, force a reader to exercise: the role fallback (`label` up to its
first `:`, or `-` when `label` is `null`) and the two value shapes excluded
from `n` (`{"score": n}`, `{"choice": ..., "confidence": ...}`, per the
Context's own gloss of "the numeric values read"). Legs (f)-(k) below cover
that remaining language with fixtures small enough to carry one fact each:

  * (f) [M1] the three fold examples, verbatim.
  * (g) [M1] a `null` label groups under role `-`, and that role's population
      sd still computes when it holds >= 2 values.
  * (h) [M1] a question whose values are only `score`/`choice` shapes prints
      `n` `0` and `-` for all three ratios (`in_band` and `unanswered` stay
      plain counts).
  * (i) [M2] `flag` `band` alone: `n` >= 5, `share` >= 0.5, no role's sd <=
      0.05.
  * (j) [M2] `flag` `constant` alone: some role's sd <= 0.05 over >= 5
      values, `share` < 0.5.
  * (k) [M1] `role_sd` is the LARGEST sd over qualifying roles, not just any
      one of them -- two roles on the same question, sds 0.10 and 0.20, and
      the printed cell is 0.20.

Driven as a subprocess, exactly as `tests/test_catch_counter.py` and
`tests/test_authoring_census_jev.py` drive their scripts: `census()` asserts
the script exists before spawning it, so a script that doesn't exist yet reds
on that assertion rather than on a coincidental exit code (an absent script
makes Python itself exit 2 with a stderr line, which would otherwise be
mistaken for the M5 refusal). No env var is read; `--fetch`'s stub `gh` is a
plain script named directly by `--gh`, so nothing here depends on `PATH`.

Two things this exam assumes about the code under test, since the task fixes
the CLI's output but not its internals: that `question` sorts as an ordinary
Python string comparison (case-sensitive, so an uppercase-led fold like
`M__f` sorts before a lowercase `claim_established`), and that a directory
holding `run-<N>/events.jsonl` is found when handed to the script as a
positional PATH one level up (`root`, holding `run-1/`, `run-2/`, ...) -- the
exact shape the task's own Proof fixture uses.
"""
import base64
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "skills/ultrapowers/scripts/jev_census.py"

TARGET = "o/r"

HEADER = "question\tn\tunanswered\tin_band\tshare\tmean\trole_sd\tflag"


# --- driving the script -----------------------------------------------------

def census(*args, env=None):
    """The script, as a subprocess. Asserts it exists first, so every leg
    below reds on an absent implementation rather than a look-alike exit
    code."""
    assert SCRIPT.is_file(), (
        "the census script does not exist yet: %s" % SCRIPT)
    return subprocess.run([sys.executable, str(SCRIPT), *args],
                          capture_output=True, text=True, env=env)


def lines(text):
    return text.splitlines()


def body(stdout):
    """The printed question lines, between the header and the `runs:` line."""
    return lines(stdout)[1:-1]


def stderr_lines(proc):
    return [line for line in lines(proc.stderr) if line.strip()]


# --- building `run-<N>/events.jsonl` fixtures -------------------------------

def jev_row(site, label, keys, values, answered=True, task="1"):
    """One `jev` event, in the Context's own shape."""
    return {"ts": 0, "kind": "jev", "site": site, "task": task,
            "label": label, "keys": keys, "values": values,
            "state_bytes": 0, "ms": 0, "answered": answered}


def noul(x):
    return {"type": "noul", "noul": x}


def write_run(root, number, rows):
    run_dir = root / ("run-%d" % number)
    run_dir.mkdir(parents=True)
    with (run_dir / "events.jsonl").open("w", encoding="utf-8") as fh:
        for row in rows:
            fh.write(json.dumps(row) + "\n")
    return run_dir


# ---------------------------------------------------------- the shared fixture
#
# run-1: five `exam:` rows and one `referee:1` row at supervisor/stuck, one
# answered landing row (`impl:1:0`), one unanswered landing row and a
# `worker:tool` row that carries no `jev` field at all.
# run-2: one answered landing row (`impl:2:0`).

EXAM_LABELS = ["exam:1", "exam:2", "exam:3", "exam:4", "exam:5"]
EXAM_NOULS_A = [0.46, 0.47, 0.45, 0.46, 0.48]


def run1_rows(exam_nouls):
    rows = [jev_row("supervisor", label, ["stuck"], {"stuck": noul(v)})
            for label, v in zip(EXAM_LABELS, exam_nouls)]
    rows.append(jev_row("supervisor", "referee:1", ["stuck"],
                        {"stuck": noul(0.16)}))
    rows.append(jev_row("landing", "impl:1:0",
                        ["claim_established", "M1__f0", "M1__f1"],
                        {"claim_established": noul(0.9), "M1__f0": 0.2,
                         "M1__f1": 0.95}))
    rows.append(jev_row("landing", "impl:1:0",
                        ["claim_established", "M1__f0"], None,
                        answered=False))
    rows.append({"ts": 0, "kind": "worker:tool", "tool": "Read"})
    return rows


RUN2_ROWS = [jev_row("landing", "impl:2:0", ["claim_established", "M1__f0"],
                     {"claim_established": 0.5, "M1__f0": 0.6})]


def build_shared_root(tmp_path, name="root", exam_nouls=EXAM_NOULS_A,
                      third_run_no_jev=False):
    root = tmp_path / name
    root.mkdir()
    write_run(root, 1, run1_rows(exam_nouls))
    write_run(root, 2, RUN2_ROWS)
    if third_run_no_jev:
        write_run(root, 3, [{"ts": 0, "kind": "worker:tool", "tool": "Bash"}])
    return root


# ------------------------------------------------------------------- leg (a)

def test_leg_a_header_and_first_three_question_lines(tmp_path):
    """(a) [M1]: the header, then `landing/M__f` (`M1__f0`, `M1__f1` from
    run-1 and `M1__f0` from run-2 all fold to `M__f`; n=3, one unanswered row
    names it, one of its three values lands in [0.35, 0.65]), then
    `landing/claim_established` (n=2, one unanswered, one of two in band),
    then `supervisor/stuck` (six values, all five `exam:` rows in band, the
    lone `referee:1` value is not; role_sd is the `exam` role's sd -- the
    single `referee:1` value never qualifies a role on its own)."""
    root = build_shared_root(tmp_path)
    proc = census(str(root))
    assert proc.returncode == 0, (
        "(a) [M5] a readable root exits 0: " + proc.stdout + proc.stderr)
    got = lines(proc.stdout)[:4]
    assert got == [
        HEADER,
        "landing/M__f\t3\t1\t1\t0.33\t0.58\t0.31\t-",
        "landing/claim_established\t2\t1\t1\t0.50\t0.70\t0.20\t-",
        "supervisor/stuck\t6\t0\t5\t0.83\t0.41\t0.01\tband,constant",
    ], "(a) [M1] " + proc.stdout


# ------------------------------------------------------------------- leg (b)

EXAM_NOULS_B = [0.10, 0.30, 0.50, 0.70, 0.90]


def test_leg_b_spread_exam_nouls_drop_the_flag(tmp_path):
    """(b) [M2]: with the five `exam:` nouls spread out (0.10 .. 0.90) instead
    of clustered near 0.45, `supervisor/stuck` no longer bands (only the
    single 0.50 value lands in [0.35, 0.65], share 1/6) or holds constant
    (the `exam` role's sd is ~0.283, far past 0.05): flag `-`."""
    root = build_shared_root(tmp_path, name="rootb", exam_nouls=EXAM_NOULS_B)
    proc = census(str(root))
    assert proc.returncode == 0, (
        "(b) [M5] a readable root exits 0: " + proc.stdout + proc.stderr)
    stuck = [l for l in body(proc.stdout) if l.startswith("supervisor/stuck")]
    assert len(stuck) == 1, proc.stdout
    assert stuck[0] == "supervisor/stuck\t6\t0\t1\t0.17\t0.44\t0.28\t-", (
        "(b) [M2] " + proc.stdout)


# ------------------------------------------------------------------- leg (c)

def test_leg_c_third_run_with_no_jev_rows_is_skipped(tmp_path):
    """(c) [M3]: a third run whose `events.jsonl` carries no `jev` row is not
    counted, and is named `3(no jev rows)` beside the runs that were."""
    root = build_shared_root(tmp_path, name="rootc", third_run_no_jev=True)
    proc = census(str(root))
    assert proc.returncode == 0, (
        "(c) [M5] a readable root exits 0: " + proc.stdout + proc.stderr)
    assert lines(proc.stdout)[-1] == "runs: n=2 read=1,2 skipped=3(no jev rows)", (
        "(c) [M3] " + proc.stdout)


def test_leg_c_no_skip_reads_none(tmp_path):
    """(c) [M3]: the same two runs with no third one ends `skipped=none`."""
    root = build_shared_root(tmp_path, name="rootc2")
    proc = census(str(root))
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert lines(proc.stdout)[-1] == "runs: n=2 read=1,2 skipped=none", (
        "(c) [M3] " + proc.stdout)


# ------------------------------------------------------------------- leg (d)

def contents_path(number, name="events.jsonl"):
    """The `gh api` contents path `catch_counter.fetch_runs` reads, for the
    run number and file name."""
    return ("repos/%s/contents/.ultrapowers/runs/%d/%s?ref=ultra/evidence/"
            "run-%d" % (TARGET, number, name, number))


RUN5_EVENTS = json.dumps(jev_row("landing", "impl:5:0",
                                 ["claim_established"],
                                 {"claim_established": 0.5})) + "\n"


def build_stub_gh(tmp_path):
    """A `gh` that answers exactly run 5's `events.jsonl` contents path with
    one answered `jev` row, and exits 1 (no stdout) for every other path --
    every other file of run 5, and every file of run 6."""
    bindir = tmp_path / "stubbin"
    bindir.mkdir()
    expected = contents_path(5)
    b64 = base64.b64encode(RUN5_EVENTS.encode("utf-8")).decode("ascii")
    answer = json.dumps({"content": b64, "encoding": "base64"})
    script = (
        "#!/usr/bin/env python3\n"
        "import sys\n"
        "EXPECTED = %s\n"
        "ANSWER = %s\n"
        "argv = sys.argv[1:]\n"
        "if len(argv) >= 2 and argv[0] == 'api' and argv[1] == EXPECTED:\n"
        "    sys.stdout.write(ANSWER)\n"
        "    sys.exit(0)\n"
        "sys.stderr.write('gh: that ref carries no such file\\n')\n"
        "sys.exit(1)\n"
    ) % (json.dumps(expected), json.dumps(answer))
    stub = bindir / "gh-stub"
    stub.write_text(script)
    stub.chmod(0o755)
    return stub


def test_leg_d_fetch_run_5_answers_run_6_does_not(tmp_path):
    """(d) [M4]: `--fetch o/r --runs 5..6 --into <dir> --gh <stub>` reads run
    5 off `ultra/evidence/run-5` through `catch_counter.py`'s own
    `fetch_runs`, and lists run 6 -- whose `events.jsonl` never answered -- as
    `6(no events.jsonl)`."""
    stub = build_stub_gh(tmp_path)
    into = tmp_path / "fetched"
    proc = census("--fetch", TARGET, "--runs", "5..6", "--into", str(into),
                 "--gh", str(stub))
    assert proc.returncode == 0, (
        "(d) [M5] a successful fetch exits 0: " + proc.stdout + proc.stderr)
    assert lines(proc.stdout)[-1] == "runs: n=1 read=5 skipped=6(no events.jsonl)", (
        "(d) [M4] " + proc.stdout)


# ------------------------------------------------------------------- leg (e)

def test_leg_e_fetch_without_runs_exits_2_with_one_stderr_line(tmp_path):
    """(e) [M5]: `--fetch` without `--runs` exits 2 with exactly one line on
    stderr."""
    proc = census("--fetch", TARGET, "--into", str(tmp_path / "d"))
    assert proc.returncode == 2, (
        "(e) [M5] `--fetch` without `--runs` exits 2, got "
        f"{proc.returncode}: {proc.stdout + proc.stderr}")
    assert len(stderr_lines(proc)) == 1, (
        "(e) [M5] with one line on stderr: " + repr(proc.stderr))


def test_leg_e_fetch_without_into_exits_2_with_one_stderr_line(tmp_path):
    """(e) [M5]: `--fetch` without `--into` exits 2 with exactly one line on
    stderr."""
    proc = census("--fetch", TARGET, "--runs", "5..6")
    assert proc.returncode == 2, (
        "(e) [M5] `--fetch` without `--into` exits 2, got "
        f"{proc.returncode}: {proc.stdout + proc.stderr}")
    assert len(stderr_lines(proc)) == 1, (
        "(e) [M5] with one line on stderr: " + repr(proc.stderr))


# ================================================================
# Legs (f)-(k): the remaining Machine language legs (a)-(e), worked over the
# Proof's own fixture, do not force a reader to exercise on their own.
# ================================================================

# ------------------------------------------------------------------- leg (f)

def test_leg_f_pairwise_family_folding_the_three_named_examples(tmp_path):
    """(f) [M1]: the three fold examples M1 spells verbatim --
    `M3__f1` -> `M__f`, `M2__t0` -> `M__t`, `g4` -> `g`. One row per key, same
    site, so each folded question appears exactly once."""
    root = tmp_path / "foldroot"
    root.mkdir()
    write_run(root, 1, [
        jev_row("x", "r:1", ["M3__f1"], {"M3__f1": 0.5}),
        jev_row("x", "r:1", ["M2__t0"], {"M2__t0": 0.5}),
        jev_row("x", "r:1", ["g4"], {"g4": 0.5}),
    ])
    proc = census(str(root))
    assert proc.returncode == 0, proc.stdout + proc.stderr
    questions = sorted(l.split("\t")[0] for l in body(proc.stdout))
    assert questions == ["x/M__f", "x/M__t", "x/g"], (
        "(f) [M1] `M3__f1` -> `M__f`, `M2__t0` -> `M__t`, `g4` -> `g`: "
        + proc.stdout)


# ------------------------------------------------------------------- leg (g)

def test_leg_g_null_label_groups_under_role_dash(tmp_path):
    """(g) [M1]: "a role is the row's `label` up to its first `:`, or `-`
    when `label` is `null`" -- two rows with `label: null` on the same
    question group under role `-`, and that role's population sd (of 0.4 and
    0.6: mean 0.5, sd 0.1) prints as `role_sd` since it holds >= 2 values."""
    root = tmp_path / "rolenullroot"
    root.mkdir()
    write_run(root, 1, [
        jev_row("y", None, ["k"], {"k": 0.4}),
        jev_row("y", None, ["k"], {"k": 0.6}),
    ])
    proc = census(str(root))
    assert proc.returncode == 0, proc.stdout + proc.stderr
    line = [l for l in body(proc.stdout) if l.startswith("y/k")]
    assert len(line) == 1, proc.stdout
    assert line[0] == "y/k\t2\t0\t2\t1.00\t0.50\t0.10\t-", (
        "(g) [M1] " + proc.stdout)


# ------------------------------------------------------------------- leg (h)

def test_leg_h_score_and_choice_values_are_excluded_from_n(tmp_path):
    """(h) [M1]: "`n` counts the numeric values read (a bare number or an
    answer's `noul`)" -- a `{"score": ...}` value and a `{"choice": ...,
    "confidence": ...}` value are neither, so the question they alone answer
    prints `n` 0, `in_band` 0 (a plain count, not a ratio) and `-` for all
    three ratios."""
    root = tmp_path / "scoreonlyroot"
    root.mkdir()
    write_run(root, 1, [
        jev_row("z", "r:1", ["m"], {"m": {"score": 3}}),
        jev_row("z", "r:2", ["m"], {"m": {"choice": "plan", "confidence": 0.8}}),
    ])
    proc = census(str(root))
    assert proc.returncode == 0, proc.stdout + proc.stderr
    line = [l for l in body(proc.stdout) if l.startswith("z/m")]
    assert len(line) == 1, proc.stdout
    assert line[0] == "z/m\t0\t0\t0\t-\t-\t-\t-", "(h) [M1] " + proc.stdout


# ------------------------------------------------------------------- leg (i)

def test_leg_i_flag_band_alone(tmp_path):
    """(i) [M2]: `flag` is `band` when `n >= 5 and share >= 0.5`, with no
    role's sd <= 0.05 -- five values at 0.35, 0.40, 0.50, 0.60, 0.65 (all in
    [0.35, 0.65], boundary values included both ends), one role, sd ~0.114:
    `band` alone, not `band,constant`."""
    root = tmp_path / "bandonlyroot"
    root.mkdir()
    values = [0.35, 0.40, 0.50, 0.60, 0.65]
    write_run(root, 1, [
        jev_row("q", "exam:%d" % i, ["k"], {"k": v})
        for i, v in enumerate(values, start=1)
    ])
    proc = census(str(root))
    assert proc.returncode == 0, proc.stdout + proc.stderr
    line = [l for l in body(proc.stdout) if l.startswith("q/k")]
    assert len(line) == 1, proc.stdout
    assert line[0] == "q/k\t5\t0\t5\t1.00\t0.50\t0.11\tband", (
        "(i) [M2] " + proc.stdout)


# ------------------------------------------------------------------- leg (j)

def test_leg_j_flag_constant_alone(tmp_path):
    """(j) [M2]: `flag` is `constant` when some role holds >= 5 values whose
    sd is <= 0.05 -- five values clustered at ~0.90 (all outside
    [0.35, 0.65], so `share` is 0), one role, sd ~0.006: `constant` alone, not
    `band,constant`."""
    root = tmp_path / "constantonlyroot"
    root.mkdir()
    values = [0.90, 0.91, 0.89, 0.90, 0.90]
    write_run(root, 1, [
        jev_row("q", "exam:%d" % i, ["k"], {"k": v})
        for i, v in enumerate(values, start=1)
    ])
    proc = census(str(root))
    assert proc.returncode == 0, proc.stdout + proc.stderr
    line = [l for l in body(proc.stdout) if l.startswith("q/k")]
    assert len(line) == 1, proc.stdout
    assert line[0] == "q/k\t5\t0\t0\t0.00\t0.90\t0.01\tconstant", (
        "(j) [M2] " + proc.stdout)


# ------------------------------------------------------------------- leg (k)

def test_leg_k_role_sd_is_the_largest_over_qualifying_roles(tmp_path):
    """(k) [M1]: "`role_sd` is the LARGEST population standard deviation over
    the roles holding at least two values" -- two roles on the same
    question, `roleA` (0.40, 0.60: sd 0.10) and `roleB` (0.30, 0.70: sd
    0.20). The printed cell is 0.20, not 0.10 and not an average of the two."""
    root = tmp_path / "tworolesroot"
    root.mkdir()
    write_run(root, 1, [
        jev_row("w", "roleA:1", ["k"], {"k": 0.40}),
        jev_row("w", "roleA:2", ["k"], {"k": 0.60}),
        jev_row("w", "roleB:1", ["k"], {"k": 0.30}),
        jev_row("w", "roleB:2", ["k"], {"k": 0.70}),
    ])
    proc = census(str(root))
    assert proc.returncode == 0, proc.stdout + proc.stderr
    line = [l for l in body(proc.stdout) if l.startswith("w/k")]
    assert len(line) == 1, proc.stdout
    assert line[0] == "w/k\t4\t0\t2\t0.50\t0.50\t0.20\t-", (
        "(k) [M1] " + proc.stdout)


# ================================================================
# Task: "The census joins each supervisor tick to its worker's end and its
# task's landing, and reads the alarms per role" (#1218) -- legs (l)-(o),
# `--ticks` and `--outcomes` over the task's own pinned `run-7` fixture.
# ================================================================

TICKS_HEADER = ("run\ttask\tlabel\trole\treading\telapsed_ms\tstuck\t"
               "off_track\tneeds_human\tdone_not_exited\twall_ms\terror\t"
               "examExit\tfolded")

OUTCOMES_HEADER = ("role\treading\tworkers\tlate\terrored\tmedian_wall_ms\t"
                   "ticks\tfired\tfired_late\tfired_errored\tfired_clean")


def dispatch_start_row(ts, task, label, role):
    return {"ts": ts, "kind": "dispatch:start", "task": task, "label": label,
           "role": role}


def supervisor_row(ts, task, label, stuck, off_track, needs_human,
                   done_not_exited):
    return {"ts": ts, "kind": "supervisor", "task": task, "label": label,
           "answers": {"stuck": noul(stuck), "off_track": noul(off_track),
                       "needs_human": noul(needs_human),
                       "done_not_exited": noul(done_not_exited)}}


def observed_row(ts, task, label, stuck, off_track, needs_human,
                 done_not_exited, elapsed_ms):
    return {"ts": ts, "kind": "supervisor:observed", "task": task,
           "label": label,
           "answers": {"stuck": noul(stuck), "off_track": noul(off_track),
                       "needs_human": noul(needs_human),
                       "done_not_exited": noul(done_not_exited)},
           "observed": {"elapsed_ms": elapsed_ms}}


def observed_skipped_row(ts, task, label, elapsed_ms, min_elapsed_ms,
                         skipped="under floor"):
    """A `supervisor:observed` row that never fired -- carries `skipped` and
    no `answers`, so it is not a tick (Context)."""
    return {"ts": ts, "kind": "supervisor:observed", "task": task,
           "label": label, "skipped": skipped, "elapsed_ms": elapsed_ms,
           "min_elapsed_ms": min_elapsed_ms}


def dispatch_end_row(ts, task, label, role, wall_ms, error):
    return {"ts": ts, "kind": "dispatch:end", "task": task, "label": label,
           "role": role, "wall_ms": wall_ms, "cost_usd": 0, "error": error}


def landing_row(ts, task, exam_exit):
    return {"ts": ts, "kind": "landing", "task": task, "k": 1,
           "examExit": exam_exit, "claim": 0.86, "coverage": [1, 1, 0.16],
           "candidateSha": "a072c3dbd83ed22d94a4513be83fa97fd8ffbbf8",
           "wall_ms": 52475}


def build_join_fixture(root):
    """`run-7/events.jsonl`, verbatim from the task's own pinned fixture: three
    `impl` dispatches (one clean, one late+folded, one errored+unfolded) and
    one `referee` dispatch whose only supervisor row never fired. No `jev` row
    anywhere."""
    rows = [
        dispatch_start_row("2026-09-22T00:00:00.000Z", "1", "impl:1:0",
                          "implement"),
        supervisor_row("2026-09-22T00:00:20.000Z", "1", "impl:1:0",
                       0.9, 0.1, 0.1, 0.1),
        observed_row("2026-09-22T00:00:20.500Z", "1", "impl:1:0",
                    0.2, 0.1, 0.1, 0.1, 20500),
        dispatch_end_row("2026-09-22T00:00:30.500Z", "1", "impl:1:0",
                        "implement", 30000, None),
        landing_row("2026-09-22T00:00:31.000Z", "1", 0),
        dispatch_start_row("2026-09-22T00:01:00.000Z", "2", "impl:2:0",
                          "implement"),
        supervisor_row("2026-09-22T00:01:20.000Z", "2", "impl:2:0",
                       0.3, 0.1, 0.1, 0.1),
        observed_row("2026-09-22T00:01:20.500Z", "2", "impl:2:0",
                    0.85, 0.1, 0.1, 0.1, 20500),
        dispatch_end_row("2026-09-22T00:04:40.500Z", "2", "impl:2:0",
                        "implement", 200000, None),
        landing_row("2026-09-22T00:04:41.000Z", "2", 1),
        dispatch_start_row("2026-09-22T00:05:00.000Z", "3", "impl:3:0",
                          "implement"),
        supervisor_row("2026-09-22T00:05:20.000Z", "3", "impl:3:0",
                       0.1, 0.1, 0.1, 0.1),
        dispatch_end_row("2026-09-22T00:05:40.000Z", "3", "impl:3:0",
                        "implement", 40000, "API Error: 529 Overloaded"),
        dispatch_start_row("2026-09-22T00:06:00.000Z", "1", "referee:1",
                          "referee"),
        observed_skipped_row("2026-09-22T00:06:00.100Z", "1", "referee:1",
                            1500, 120000),
        dispatch_end_row("2026-09-22T00:06:01.500Z", "1", "referee:1",
                        "referee", 1500, "API Error: 529 Overloaded"),
    ]
    return write_run(root, 7, rows)


# ------------------------------------------------------------------- leg (l)

def test_leg_l_ticks_header_and_first_two_lines(tmp_path):
    """(l) [M1]: `--ticks` over the fixture prints the tick header, exactly
    five body lines between header and trailer, and the first two are
    byte-equal to the narrated and observed readings of `impl:1:0` -- the
    clean, folded worker."""
    root = tmp_path / "joinroot"
    root.mkdir()
    build_join_fixture(root)
    proc = census("--ticks", str(root))
    assert proc.returncode == 0, (
        "(l) [M4] --ticks over a readable root exits 0: "
        + proc.stdout + proc.stderr)
    out_lines = lines(proc.stdout)
    assert out_lines[0] == TICKS_HEADER, "(l) [M1] " + proc.stdout
    body_lines = out_lines[1:-1]
    assert len(body_lines) == 5, "(l) [M1] " + proc.stdout
    assert body_lines[0] == (
        "7\t1\timpl:1:0\timpl\tnarrated\t20000\t0.90\t0.10\t0.10\t0.10\t"
        "30000\t-\t0\t1"), "(l) [M1] " + proc.stdout
    assert body_lines[1] == (
        "7\t1\timpl:1:0\timpl\tobserved\t20500\t0.20\t0.10\t0.10\t0.10\t"
        "30000\t-\t0\t1"), "(l) [M1] " + proc.stdout


# ------------------------------------------------------------------- leg (m)

def test_leg_m_ticks_join_worker_end_and_task_landing(tmp_path):
    """(m) [M2]: the third and fifth tick lines join the same run+label's
    `dispatch:end` (`wall_ms`, `error`) and the same run+task's `landing`
    (`examExit`, `folded`) -- `impl:2:0` narrated (late worker, folded task,
    landed) and `impl:3:0` narrated (errored worker, unfolded task, no
    landing row at all: `examExit` `-`, `folded` `0`)."""
    root = tmp_path / "joinroot2"
    root.mkdir()
    build_join_fixture(root)
    proc = census("--ticks", str(root))
    assert proc.returncode == 0, proc.stdout + proc.stderr
    body_lines = lines(proc.stdout)[1:-1]
    assert len(body_lines) == 5, proc.stdout
    assert body_lines[2] == (
        "7\t2\timpl:2:0\timpl\tnarrated\t20000\t0.30\t0.10\t0.10\t0.10\t"
        "200000\t-\t1\t1"), "(m) [M2] " + proc.stdout
    assert body_lines[4] == (
        "7\t3\timpl:3:0\timpl\tnarrated\t20000\t0.10\t0.10\t0.10\t0.10\t"
        "40000\tAPI Error: 529 Overloaded\t-\t0"), "(m) [M2] " + proc.stdout


# ------------------------------------------------------------------- leg (n)

def test_leg_n_outcomes_ticks_in_band_against_late_and_errored_workers(
       tmp_path):
    """(n) [M3]: `--outcomes` over the fixture prints the outcomes header,
    then exactly the four (role, reading) lines the task's own arithmetic
    gives, in role-then-reading order: `impl` walls 30000/200000/40000 median
    to 40000 (late above 80000, so `impl:2:0` is the one late worker and
    `impl:3:0` the one errored); `impl` narrated fires once
    (`impl:1:0` at 0.9, worker clean -- `fired_clean`), `impl` observed fires
    once (`impl:2:0` at 0.85, worker late -- `fired_late`); `referee` has one
    worker (errored) and no tick of either reading."""
    root = tmp_path / "joinroot3"
    root.mkdir()
    build_join_fixture(root)
    proc = census("--outcomes", str(root))
    assert proc.returncode == 0, (
        "(n) [M4] --outcomes over a readable root exits 0: "
        + proc.stdout + proc.stderr)
    out_lines = lines(proc.stdout)
    assert out_lines[0] == OUTCOMES_HEADER, "(n) [M3] " + proc.stdout
    body_lines = out_lines[1:-1]
    assert body_lines == [
        "impl\tnarrated\t3\t1\t1\t40000\t3\t1\t0\t0\t1",
        "impl\tobserved\t3\t1\t1\t40000\t2\t1\t1\t0\t0",
        "referee\tnarrated\t1\t0\t1\t1500\t0\t0\t0\t0\t0",
        "referee\tobserved\t1\t0\t1\t1500\t0\t0\t0\t0\t0",
    ], "(n) [M3] " + proc.stdout


# ------------------------------------------------------------------- leg (o)

def test_leg_o_ticks_and_outcomes_read_a_run_with_no_jev_rows(tmp_path):
    """(o) [M4]: under either flag a run is read whenever its `events.jsonl`
    exists -- the `no jev rows` skip belongs to the question table only -- so
    both `--ticks` and `--outcomes` over a fixture with no `jev` row at all
    end with `runs: n=1 read=7 skipped=none`."""
    root = tmp_path / "joinroot4"
    root.mkdir()
    build_join_fixture(root)
    ticks_proc = census("--ticks", str(root))
    outcomes_proc = census("--outcomes", str(root))
    assert ticks_proc.returncode == 0, (
        "(o) [M4] " + ticks_proc.stdout + ticks_proc.stderr)
    assert outcomes_proc.returncode == 0, (
        "(o) [M4] " + outcomes_proc.stdout + outcomes_proc.stderr)
    assert lines(ticks_proc.stdout)[-1] == "runs: n=1 read=7 skipped=none", (
        "(o) [M4] " + ticks_proc.stdout)
    assert lines(outcomes_proc.stdout)[-1] == (
        "runs: n=1 read=7 skipped=none"), "(o) [M4] " + outcomes_proc.stdout


def test_leg_o_both_flags_together_exit_2_with_one_stderr_line(tmp_path):
    """(o) [M4]: `--ticks` and `--outcomes` given together print exactly one
    line on stderr, refuse with the exact shape `_fetch_bounds` uses
    elsewhere in this script, and exit 2 with nothing on stdout."""
    root = tmp_path / "joinroot5"
    root.mkdir()
    build_join_fixture(root)
    proc = census("--ticks", "--outcomes", str(root))
    assert proc.returncode == 2, (
        "(o) [M4] both flags together exit 2, got "
        f"{proc.returncode}: {proc.stdout + proc.stderr}")
    assert proc.stdout == "", "(o) [M4] nothing on stdout: " + repr(proc.stdout)
    err_lines = stderr_lines(proc)
    assert len(err_lines) == 1, (
        "(o) [M4] exactly one stderr line: " + repr(proc.stderr))
    assert err_lines[0] == (
        "jev-census: --ticks and --outcomes are two tables; ask for one"
    ), "(o) [M4] " + repr(proc.stderr)


def test_leg_o_neither_flag_is_unchanged_at_base(tmp_path):
    """(o) [M4]: with neither flag, the same fixture prints exactly the
    question header line followed by the BASE trailer `runs: n=0 read=
    skipped=7(no jev rows)` -- the question table's own `no jev rows` skip is
    untouched by the new flags."""
    root = tmp_path / "joinroot6"
    root.mkdir()
    build_join_fixture(root)
    proc = census(str(root))
    assert proc.returncode == 0, (
        "(o) [M4] " + proc.stdout + proc.stderr)
    assert lines(proc.stdout) == [
        HEADER,
        "runs: n=0 read= skipped=7(no jev rows)",
    ], "(o) [M4] " + proc.stdout


# ------------------------------------------------------------------- leg (p)

def landing_row_with_facts(ts, task, facts_exit, exam_exit):
    """A `landing` row from a run recorded after the exam left -- carries
    both `factsExit` (the current field) and a stale `examExit` alongside
    it, so a fixture can tell which one `read_ticks` actually reads."""
    return {"ts": ts, "kind": "landing", "task": task, "k": 1,
           "factsExit": facts_exit, "examExit": exam_exit,
           "claim": 0.86, "coverage": [1, 1, 0.16],
           "candidateSha": "a072c3dbd83ed22d94a4513be83fa97fd8ffbbf8",
           "wall_ms": 52475}


def build_facts_fixture(root):
    """One `impl` dispatch, landed with a `factsExit` of 0 alongside a stale
    non-zero `examExit` left over from an older recording -- the task's own
    claim that `read_ticks` prefers `factsExit` when the row carries one."""
    rows = [
        dispatch_start_row("2026-09-22T00:00:00.000Z", "1", "impl:1:0",
                          "implement"),
        supervisor_row("2026-09-22T00:00:20.000Z", "1", "impl:1:0",
                       0.9, 0.1, 0.1, 0.1),
        dispatch_end_row("2026-09-22T00:00:30.500Z", "1", "impl:1:0",
                        "implement", 30000, None),
        landing_row_with_facts("2026-09-22T00:00:31.000Z", "1", 0, 9),
    ]
    return write_run(root, 8, rows)


def test_leg_p_ticks_prefer_facts_exit_over_a_stale_exam_exit(tmp_path):
    """(p) [M9]: a `landing` row that carries both `factsExit` and an older
    `examExit` reads `factsExit` -- the tick's `examExit` column shows the
    facts value (0), not the stale exam one (9)."""
    root = tmp_path / "factsroot"
    root.mkdir()
    build_facts_fixture(root)
    proc = census("--ticks", str(root))
    assert proc.returncode == 0, "(p) [M9] " + proc.stdout + proc.stderr
    body_lines = lines(proc.stdout)[1:-1]
    assert len(body_lines) == 1, "(p) [M9] " + proc.stdout
    assert body_lines[0] == (
        "8\t1\timpl:1:0\timpl\tnarrated\t20000\t0.90\t0.10\t0.10\t0.10\t"
        "30000\t-\t0\t1"), "(p) [M9] " + proc.stdout
