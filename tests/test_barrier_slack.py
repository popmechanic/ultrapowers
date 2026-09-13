1 //1;'''
// ── the node shim ───────────────────────────────────────────────────────────
// One file, two runners. Task 6's Context names this a PYTEST file ("the
// pytest file drives the script on two fixtures written by the test into
// `tmp_path`"; `pytest.ini` scopes collection to `tests/`), and the plan
// header's `**Exam command:** node {paths}` makes the driver run it as
// `node tests/test_barrier_slack.py`. So the file is a pytest module whose
// first lines are also a node entry point: under node, line 1 is the
// expression `1` followed by a `//` comment, and this block runs pytest on
// this very file and exits with pytest's status. Under Python, line 1 opens a
// single-quoted triple-quote string that swallows this block and closes on the
// `/*` line below — which opens the JS block comment that hides the rest of
// the file from node, and is closed by the last line of the file.
// Nothing below this block is JavaScript; nothing in this block is Python.
const { spawnSync } = require("node:child_process")
const r = spawnSync("python3", ["-m", "pytest", "-q", __filename], { stdio: "inherit" })
process.exit(typeof r.status === "number" ? r.status : 1)
/* '''
"""The exam for task 6 — the barrier-slack reading (`evals/barrier_slack.py`).

What the contract says, restated, so every assertion below can be read back
against it:

  M1 — `python3 evals/barrier_slack.py <events.jsonl>…` reads each file and,
    per task, computes `slack = ts(driver:wave-adopted whose tasks[] names it)
    − ts(last worker:end whose label's second colon-segment is the task)`,
    ignoring tasks with no adoption event. Per file it prints one line
    `run=<id> tasks=<n> engine_wall_ms=<W> slack_sum_ms=<S> share=<S/W to 3
    places> median_ms=<m> p90_ms=<p>`, where `W = ts(last driver:wave-adopted)
    − ts(first worker:start)` and p90 is the value at index `ceil(0.9·n) − 1`
    of the ascending slacks; then a final line `all: files=<k> share=<ΣS/ΣW to
    3 places> median_ms=<m> p90_ms=<p>` over every task of every file.
  M2 — `--tags 70-112` reads `git show
    ultra/evidence/run-<N>:.ultrapowers/runs/<N>/events.jsonl` for each N in
    the range, skips a tag that is absent or carries no `events.jsonl`, reports
    the skipped Ns on one `skipped:` line, and never fetches.
  M3 — a file with no `driver:wave-adopted` prints its `run=` line with
    `tasks=0` and share `0.000` and is excluded from `all:`.

Leg by leg, each test named for its leg and the clause it comes from:

  leg (a) [M1] — `test_a_*`: FIXTURE_A, two tasks in one wave (task 1's last
    `worker:end` 100 000, task 2's 130 000, one adoption naming both at
    160 000, first `worker:start` 10 000) answers slacks 60 000 and 30 000 as
    `tasks=2 engine_wall_ms=150000 slack_sum_ms=90000 share=0.600
    median_ms=45000 p90_ms=60000` — every field of the printed line asserted by
    equality, and the `all:` line over that one file with it.
  leg (b) [M1] — `test_b_*`: FIXTURE_B, one task with two labels (`impl:1`
    ending 50 000, `review:1:1:1` ending 80 000, adoption 90 000) answers slack
    10 000, the LAST end; a script that reads the first `worker:end` answers
    40 000 and fails here. Run with FIXTURE_A, the `all:` line reads `files=2
    share=0.500` (ΣS 100 000 over ΣW 150 000 + 50 000, W2 from that fixture's
    own first start at 40 000) with `median_ms=30000 p90_ms=60000` over the
    three slacks (sorted 10 000, 30 000, 60 000; p90 index `ceil(2.7) − 1` = 2).
  leg (b2) [M1] — `test_b2_*`: FIXTURE_C, two waves — task 1's last
    `worker:end` 100 000 adopted at 120 000, task 2's 130 000 adopted at
    160 000 — answers slacks 20 000 and 30 000 (`slack_sum_ms=50000`,
    `median_ms=25000`), where pairing every task with the LAST adoption would
    answer 60 000 and 30 000 (sum 90 000). Task 9 works in that file and is
    named by no adoption's `tasks[]`, so it is ignored and `tasks=` counts 2.
  leg (c) [M2] — `test_c_*`: `--tags 5-7` in a git repo the test builds, with
    `ultra/evidence/run-5` carrying an `events.jsonl`, `ultra/evidence/run-6`
    whose tree has none, and no tag for 7, prints one `skipped: 6 7` line and
    exactly one `run=` line, the `run=5` one; and no line of the script's
    source contains `fetch` (`grep -c 'fetch' evals/barrier_slack.py` is 0).
  leg (d) [M3] — `test_d_*`: FIXTURE_D has workers and no adoption, so its line
    carries `tasks=0` and `share=0.000`, and run beside FIXTURE_A the `all:`
    line reads `files=1` with FIXTURE_A's own numbers.

The fixtures carry the event shapes the task's Context pins: `worker:start` and
`worker:end` with `impl:<task>`, `exam:<task>`, `fix:<task>:<n>` and
`review:<task>:<round>:<k>` labels, `driver:wave-adopted` with `wave`, `tasks`
and `headSha`, the task-less `integration` and `reconcile:*` labels, and two
`run:open` lines (the engine's and `publish-fold.mjs`'s) to be ignored. `ts` is
epoch milliseconds throughout.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "evals" / "barrier_slack.py"
REL_SCRIPT = "evals/barrier_slack.py"

TIMEOUT = 300

# M1's per-file line, field by field in the order the clause spells them, and
# the `all:` line's four.
RUN_FIELDS = ("run", "tasks", "engine_wall_ms", "slack_sum_ms",
              "share", "median_ms", "p90_ms")
ALL_FIELDS = ("files", "share", "median_ms", "p90_ms")

# --------------------------------------------------------------------------- #
# the fixtures                                                                 #
# --------------------------------------------------------------------------- #

# leg (a): one wave, two tasks. First `worker:start` 10 000, last adoption
# 160 000 → W = 150 000. Task 1's last end is `fix:1:1` at 100 000 (slack
# 60 000), task 2's is `impl:2` at 130 000 (slack 30 000). `integration` and
# the two `run:open` lines carry no task and move nothing.
FIXTURE_A = [
    {"kind": "run:open", "runId": "run-201", "source": "fleet/run-main.mjs", "ts": 9000},
    {"kind": "worker:start", "label": "impl:1", "role": "implementer", "ts": 10000},
    {"kind": "worker:start", "label": "exam:1", "role": "examiner", "ts": 10500},
    {"kind": "worker:start", "label": "impl:2", "role": "implementer", "ts": 11000},
    {"kind": "worker:end", "label": "exam:1", "ts": 40000},
    {"kind": "worker:end", "label": "impl:1", "ts": 70000},
    {"kind": "worker:start", "label": "fix:1:1", "role": "fix", "ts": 80000},
    {"kind": "worker:end", "label": "fix:1:1", "ts": 100000},
    {"kind": "worker:end", "label": "impl:2", "ts": 130000},
    {"kind": "worker:start", "label": "integration", "role": "integration", "ts": 140000},
    {"kind": "worker:end", "label": "integration", "ts": 150000},
    {"kind": "run:open", "runId": "run-201", "source": "fleet/publish-fold.mjs", "ts": 155000},
    {"kind": "driver:wave-adopted", "wave": 1, "tasks": ["1", "2"],
     "headSha": "aaaaaaaaaaaa", "ts": 160000},
]
A_LINE = ("tasks=2 engine_wall_ms=150000 slack_sum_ms=90000 share=0.600 "
          "median_ms=45000 p90_ms=60000")
A_ALL = "all: files=1 share=0.600 median_ms=45000 p90_ms=60000"

# leg (b): one task, two labels. Its LAST end is `review:1:1:1` at 80 000, so
# the slack against the 90 000 adoption is 10 000; the FIRST end (`impl:1` at
# 50 000) would answer 40 000. W = 90 000 − 40 000 = 50 000.
FIXTURE_B = [
    {"kind": "run:open", "runId": "run-202", "source": "fleet/run-main.mjs", "ts": 39000},
    {"kind": "worker:start", "label": "impl:1", "role": "implementer", "ts": 40000},
    {"kind": "worker:end", "label": "impl:1", "ts": 50000},
    {"kind": "worker:start", "label": "review:1:1:1", "role": "reviewer", "ts": 60000},
    {"kind": "worker:end", "label": "review:1:1:1", "ts": 80000},
    {"kind": "driver:wave-adopted", "wave": 1, "tasks": ["1"],
     "headSha": "bbbbbbbbbbbb", "ts": 90000},
]
B_LINE = ("tasks=1 engine_wall_ms=50000 slack_sum_ms=10000 share=0.200 "
          "median_ms=10000 p90_ms=10000")
# ΣS = 90 000 + 10 000; ΣW = 150 000 + 50 000; slacks 10 000, 30 000, 60 000.
AB_ALL = "all: files=2 share=0.500 median_ms=30000 p90_ms=60000"

# leg (b2): two waves, each adopting its own task, plus a task 9 no adoption
# ever names and two task-less labels.
FIXTURE_C = [
    {"kind": "run:open", "runId": "run-203", "source": "fleet/run-main.mjs", "ts": 9000},
    {"kind": "worker:start", "label": "impl:1", "role": "implementer", "ts": 10000},
    {"kind": "worker:start", "label": "impl:2", "role": "implementer", "ts": 20000},
    {"kind": "worker:start", "label": "impl:9", "role": "implementer", "ts": 30000},
    {"kind": "worker:end", "label": "impl:1", "ts": 100000},
    {"kind": "worker:end", "label": "impl:9", "ts": 110000},
    {"kind": "driver:wave-adopted", "wave": 1, "tasks": ["1"],
     "headSha": "cccccccccccc", "ts": 120000},
    {"kind": "worker:end", "label": "impl:2", "ts": 130000},
    {"kind": "worker:start", "label": "reconcile:wave-2", "role": "reconcile", "ts": 135000},
    {"kind": "worker:end", "label": "reconcile:wave-2", "ts": 140000},
    {"kind": "worker:start", "label": "integration", "role": "integration", "ts": 145000},
    {"kind": "worker:end", "label": "integration", "ts": 150000},
    {"kind": "driver:wave-adopted", "wave": 2, "tasks": ["2"],
     "headSha": "dddddddddddd", "ts": 160000},
]
C_LINE = ("tasks=2 engine_wall_ms=150000 slack_sum_ms=50000 share=0.333 "
          "median_ms=25000 p90_ms=30000")

# leg (d): workers, no adoption — a run that died before its fold.
FIXTURE_D = [
    {"kind": "run:open", "runId": "run-204", "source": "fleet/run-main.mjs", "ts": 9000},
    {"kind": "worker:start", "label": "impl:1", "role": "implementer", "ts": 10000},
    {"kind": "worker:start", "label": "exam:1", "role": "examiner", "ts": 10500},
    {"kind": "worker:end", "label": "exam:1", "ts": 40000},
    {"kind": "worker:end", "label": "impl:1", "ts": 70000},
    {"kind": "engine:log", "message": "the run died before the fold", "ts": 80000},
]
# M3 pins two of the seven fields; `W` has no last adoption to be measured
# from, so the other four are left to the implementation.
D_LINE_RE = re.compile(
    r"^run=\S+ tasks=0 engine_wall_ms=\S+ slack_sum_ms=\S+ share=0\.000 "
    r"median_ms=\S+ p90_ms=\S+$")
AD_ALL = "all: files=1 share=0.600 median_ms=45000 p90_ms=60000"

# leg (c): what the `ultra/evidence/run-5` tag carries. No `run:open`, so the
# only id in play is the N the `--tags` range named.
FIXTURE_TAG_5 = [
    {"kind": "worker:start", "label": "impl:1", "role": "implementer", "ts": 10000},
    {"kind": "worker:end", "label": "impl:1", "ts": 100000},
    {"kind": "driver:wave-adopted", "wave": 1, "tasks": ["1"],
     "headSha": "eeeeeeeeeeee", "ts": 160000},
]
TAG_5_LINE = ("run=5 tasks=1 engine_wall_ms=150000 slack_sum_ms=60000 "
              "share=0.400 median_ms=60000 p90_ms=60000")


# --------------------------------------------------------------------------- #
# helpers                                                                      #
# --------------------------------------------------------------------------- #
def write_events(path, events):
    """One JSON object per line, as the engine appends them."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(e) + "\n" for e in events))
    return path


def read_script():
    assert SCRIPT.is_file(), REL_SCRIPT + " does not exist yet"
    return SCRIPT.read_text()


def run_reading(*args, cwd=None):
    """`python3 evals/barrier_slack.py <args>` — its stdout, or a red test."""
    assert SCRIPT.is_file(), REL_SCRIPT + " does not exist yet"
    res = subprocess.run([sys.executable, str(SCRIPT), *[str(a) for a in args]],
                         capture_output=True, text=True, timeout=TIMEOUT,
                         cwd=None if cwd is None else str(cwd))
    assert res.returncode == 0, (
        "%s %s exited %d\n--- stdout ---\n%s\n--- stderr ---\n%s"
        % (REL_SCRIPT, " ".join(str(a) for a in args), res.returncode,
           res.stdout, res.stderr))
    return res.stdout


def run_lines(out):
    return [line for line in out.splitlines() if line.startswith("run=")]


def one_run_line(out):
    """The single `run=` line, split into its `run=<id>` head and its tail.

    The head is asserted to be a `run=<id>` token so the tail can be compared
    as one exact string: M1 names the run id's slot but not its spelling for a
    file read off the command line, and the exam pins only what the task pins.
    """
    lines = run_lines(out)
    assert len(lines) == 1, "expected one `run=` line, got %r" % (lines,)
    head, _, tail = lines[0].partition(" ")
    assert re.fullmatch(r"run=\S+", head), "first field is not `run=<id>`: %r" % lines[0]
    return head, tail


def all_line(out):
    lines = [line for line in out.splitlines() if line.startswith("all:")]
    assert len(lines) == 1, "expected one `all:` line, got %r" % (lines,)
    return lines[0]


def fields_of(line):
    """A printed line's field NAMES in order, so field order is asserted too."""
    body = line[len("all:"):] if line.startswith("all:") else line
    return tuple(tok.split("=", 1)[0] for tok in body.split())


# --------------------------------------------------------------------------- #
# leg (a) — one wave, two tasks, every field of the line [M1]                   #
# --------------------------------------------------------------------------- #
def test_a_two_tasks_in_one_wave_print_every_field_of_m1s_line(tmp_path):
    """leg (a) [M1]: slacks 60 000 and 30 000 over a 150 000 ms engine wall."""
    events = write_events(tmp_path / "a" / "events.jsonl", FIXTURE_A)
    out = run_reading(events)
    head, tail = one_run_line(out)
    assert tail == A_LINE, "leg (a) line: %s %s" % (head, tail)


def test_a_the_per_file_line_carries_m1s_seven_fields_in_order(tmp_path):
    """leg (a) [M1]: the field names and their order, exactly as M1 spells them."""
    events = write_events(tmp_path / "a" / "events.jsonl", FIXTURE_A)
    out = run_reading(events)
    assert fields_of(run_lines(out)[0]) == RUN_FIELDS


def test_a_the_all_line_over_one_file_repeats_that_files_numbers(tmp_path):
    """leg (a) [M1]: `all:` over a single file — ΣS/ΣW is that file's share."""
    events = write_events(tmp_path / "a" / "events.jsonl", FIXTURE_A)
    out = run_reading(events)
    assert all_line(out) == A_ALL
    assert fields_of(all_line(out)) == ALL_FIELDS


# --------------------------------------------------------------------------- #
# leg (b) — the LAST `worker:end`, and `all:` over two files [M1]               #
# --------------------------------------------------------------------------- #
def test_b_a_tasks_slack_is_measured_from_its_last_worker_end(tmp_path):
    """leg (b) [M1]: 90 000 − 80 000 = 10 000, not 90 000 − 50 000 = 40 000.

    `slack_sum_ms=10000` is the whole of leg (b)'s "a script that uses the
    first `worker:end` fails".
    """
    events = write_events(tmp_path / "b" / "events.jsonl", FIXTURE_B)
    out = run_reading(events)
    head, tail = one_run_line(out)
    assert tail == B_LINE, "leg (b) line: %s %s" % (head, tail)


def test_b_the_all_line_sums_both_files_slacks_and_walls(tmp_path):
    """leg (b) [M1]: `files=2 share=0.500`, ΣS 100 000 over ΣW 200 000."""
    a = write_events(tmp_path / "a" / "events.jsonl", FIXTURE_A)
    b = write_events(tmp_path / "b" / "events.jsonl", FIXTURE_B)
    out = run_reading(a, b)
    assert all_line(out) == AB_ALL
    assert len(run_lines(out)) == 2, "one `run=` line per file"


def test_b_the_all_lines_median_and_p90_run_over_every_task_of_every_file(tmp_path):
    """leg (b) [M1]: median 30 000 and p90 60 000 over the three slacks.

    Sorted 10 000, 30 000, 60 000 — p90 at index `ceil(0.9·3) − 1` = 2. A
    median or p90 taken per file and then averaged answers something else.
    """
    a = write_events(tmp_path / "a" / "events.jsonl", FIXTURE_A)
    b = write_events(tmp_path / "b" / "events.jsonl", FIXTURE_B)
    fields = dict(tok.split("=", 1) for tok in all_line(run_reading(a, b))[len("all:"):].split())
    assert fields["median_ms"] == "30000"
    assert fields["p90_ms"] == "60000"


# --------------------------------------------------------------------------- #
# leg (b2) — each task against ITS OWN wave's adoption [M1]                     #
# --------------------------------------------------------------------------- #
def test_b2_each_task_is_paired_with_the_adoption_that_names_it(tmp_path):
    """leg (b2) [M1]: slacks 20 000 and 30 000, sum 50 000, median 25 000.

    Pairing every task with the LAST adoption answers 60 000 and 30 000 — a
    `slack_sum_ms` of 90 000 and a `median_ms` of 45 000.
    """
    events = write_events(tmp_path / "c" / "events.jsonl", FIXTURE_C)
    out = run_reading(events)
    head, tail = one_run_line(out)
    assert tail == C_LINE, "leg (b2) line: %s %s" % (head, tail)


def test_b2_a_task_no_adoption_names_is_ignored(tmp_path):
    """leg (b2) [M1]: task 9 ends at 110 000 and no adoption names it.

    `tasks=` counts only adopted tasks, so it is 2 — and task 9 contributes
    nothing to `slack_sum_ms`, which the line above pins at 50 000.
    """
    events = write_events(tmp_path / "c" / "events.jsonl", FIXTURE_C)
    fields = dict(tok.split("=", 1) for tok in run_lines(run_reading(events))[0].split())
    assert fields["tasks"] == "2"
    assert fields["slack_sum_ms"] == "50000"


# --------------------------------------------------------------------------- #
# leg (c) — `--tags`, the skipped Ns, and no fetch [M2]                         #
# --------------------------------------------------------------------------- #
def git(repo, *args):
    res = subprocess.run(["git", "-C", str(repo), *args],
                         capture_output=True, text=True, timeout=TIMEOUT)
    assert res.returncode == 0, (
        "git %s failed (%d): %s" % (" ".join(args), res.returncode, res.stderr.strip()))
    return res.stdout


def evidence_repo(tmp_path):
    """A repo with `ultra/evidence/run-5` and `run-6`, and no tag for 7.

    run-5's tree carries `.ultrapowers/runs/5/events.jsonl`; run-6's carries no
    `events.jsonl` at all — the two shapes M2 names, plus the absent tag.
    """
    repo = tmp_path / "evidence"
    repo.mkdir()
    git(repo, "init", "-q")
    git(repo, "config", "user.email", "exam@example.invalid")
    git(repo, "config", "user.name", "exam")
    (repo / "README.md").write_text("the evidence branch\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", "readme")
    write_events(repo / ".ultrapowers" / "runs" / "5" / "events.jsonl", FIXTURE_TAG_5)
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", "run 5 evidence")
    git(repo, "tag", "ultra/evidence/run-5")
    git(repo, "rm", "-r", "-q", ".ultrapowers")
    git(repo, "commit", "-q", "-m", "run 6, no events.jsonl in the tree")
    git(repo, "tag", "ultra/evidence/run-6")
    return repo


def test_c_tags_reads_the_tag_it_has_and_skips_the_two_it_has_not(tmp_path):
    """leg (c) [M2]: `--tags 5-7` prints `skipped: 6 7` and one `run=5` line."""
    repo = evidence_repo(tmp_path)
    out = run_reading("--tags", "5-7", cwd=repo)
    skipped = [line for line in out.splitlines() if line.startswith("skipped:")]
    assert skipped == ["skipped: 6 7"], out
    head, tail = one_run_line(out)
    assert head + " " + tail == TAG_5_LINE, out


def test_c_tags_reports_one_file_and_that_files_numbers(tmp_path):
    """leg (c) [M2]: only run 5 was read, so `all:` counts one file."""
    repo = evidence_repo(tmp_path)
    out = run_reading("--tags", "5-7", cwd=repo)
    fields = dict(tok.split("=", 1) for tok in all_line(out)[len("all:"):].split())
    assert fields["files"] == "1", out


def test_c_the_script_never_fetches():
    """leg (c) [M2]: `grep -c 'fetch' evals/barrier_slack.py` is 0."""
    source = read_script()
    offenders = [line for line in source.splitlines() if "fetch" in line]
    assert offenders == [], offenders


# --------------------------------------------------------------------------- #
# leg (d) — a file with no adoption [M3]                                       #
# --------------------------------------------------------------------------- #
def test_d_a_file_with_no_adoption_answers_no_tasks_and_a_zero_share(tmp_path):
    """leg (d) [M3]: `tasks=0` and `share=0.000` on its own `run=` line."""
    events = write_events(tmp_path / "d" / "events.jsonl", FIXTURE_D)
    out = run_reading(events)
    line = run_lines(out)[0]
    assert len(run_lines(out)) == 1, out
    assert D_LINE_RE.match(line), line
    assert fields_of(line) == RUN_FIELDS


def test_d_a_file_with_no_adoption_is_excluded_from_the_all_line(tmp_path):
    """leg (d) [M3]: two files in, `files=1` out — and A's own numbers."""
    a = write_events(tmp_path / "a" / "events.jsonl", FIXTURE_A)
    d = write_events(tmp_path / "d" / "events.jsonl", FIXTURE_D)
    out = run_reading(a, d)
    assert len(run_lines(out)) == 2, "both files still print a `run=` line\n" + out
    assert all_line(out) == AD_ALL
# */
