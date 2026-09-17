"""tests/test_catch_report.py — the exam for task 2: the fold-order gate is a
probe run by hand, and the catch counter keeps a design gate.

Written against the task's Machine clauses, leg by leg. Every assertion names
the leg it belongs to and the clause it comes from, so a reader can map this
file back to the contract:

  M1  `fleet/tests/probe_readiness_fold_order.mjs` is #832's sim as `2f327c6f`
      added it — five corpus waves, the negative control, the soft-edges pair
      and the fixture sets, one stdout line per set and `ALL TESTS PASSED`
      last, importing `./_readiness_helpers.mjs` unchanged — with one change:
      a fixture set whose manifest's `project` tree exists at neither of the
      helper's two resolutions is SKIPPED with one stderr line naming the set
      and no stdout line, instead of throwing. Its `import` lines name only
      `node:assert/strict`, `node:fs`, `node:path` and
      `./_readiness_helpers.mjs`.
  M2  `node fleet/tests/probe_readiness_fold_order.mjs` at BASE exits 0 and
      prints exactly five lines beginning `wave-` and ending
      `ok steps=<n> kernelCalls=<n>`, one line beginning `negative-control`
      carrying ` caught `, and `ALL TESTS PASSED` last; it is never collected
      by `tests/test_fleet_suite.py` and never swept by
      `test_sims_are_hermetic.mjs`, because its name begins `probe_`.
  M3  `fleet/tests/PROBES.md` lists the probe with the sentence that it is run
      by hand before any change to the fold kernel or the ready-set scheduler,
      and its opening paragraph says a probe is either a live measurement or a
      design gate.
  M4  in `catch_report.py`, a test file whose text carries the line
      `# catch-counter: gate` has status `gate`: never a deletion candidate,
      never a point on the zero-catch curve, and listed in the table with its
      catches and touching runs whatever their values — exactly the treatment
      `# catch-counter: runner` gets, under a second name; a file carrying
      neither marker keeps its BASE status.

Legs: (a) M4 the three statuses, the deletion input and the curve; (b) M4 the
gate's row in the report but not under the deletion heading; (c) M4 a gate
with catches, and `tree_gates`; (d) M1 the probe read as text (and M2's
"never collected"); (e) M2 the probe run; (f) M3 `PROBES.md`; (g) M1 the
unresolvable fixture set skipped rather than thrown.

The script is imported the way `tests/test_ultra_run.py:16` does it, and the
names this task PRODUCES (`tree_gates`, `catch_table`'s `gates=`) are reached
as attributes of the module rather than imported at the top, so at BASE each
M4 leg reds on its own missing name while the M1/M2/M3 legs red on the absent
probe.

A second task's legs live at the end of this file, under their own banner:
"the catch-counter ratchet — the zero-catch reading per release" (`--zero-over`,
`fleet/RUNBOOK.md`'s `## Release` section). They are read over a git fixture
tree of their own and share nothing with the legs above but the import.
"""
import inspect
import json
import os
import pathlib
import re
import subprocess
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "skills/ultrapowers/scripts"
sys.path.insert(0, str(SCRIPTS))
import catch_report  # noqa: E402

# The bridge's own collector, so M2's "never collected" is read off the real
# glob rather than a copy of it.
sys.path.insert(0, str(ROOT / "tests"))
from test_fleet_suite import collect_sims  # noqa: E402

PROBE_REL = "fleet/tests/probe_readiness_fold_order.mjs"
PROBE = ROOT / PROBE_REL
PROBES_MD = ROOT / "fleet/tests/PROBES.md"

GATE_LINE = "# catch-counter: gate"
RUNNER_LINE = "# catch-counter: runner"

GATE_FILE = "fleet/tests/test_gate.mjs"
RUNNER_FILE = "tests/test_runner.py"
PLAIN_FILE = "tests/test_plain.py"

# A hang detector, not a budget: the sim measures ~10-26 s of real kernel work.
PROBE_TIMEOUT = 600


# --- the tree and the ledger the M4 legs are read over ---------------------

def _write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


@pytest.fixture
def tree(tmp_path):
    """A tree of three tests: a gate `.mjs` carrying the bare marker as a line
    of its own inside a block comment, a runner `.py`, and a plain `.py`."""
    root = tmp_path / "tree"
    _write(root / GATE_FILE,
           "/**\n"
           " * the fold-order design gate\n"
           "\n"
           f"{GATE_LINE}\n"
           " */\n"
           "console.log('ALL TESTS PASSED')\n")
    _write(root / RUNNER_FILE, f"{RUNNER_LINE}\nimport pytest\n")
    _write(root / PLAIN_FILE, "def test_plain():\n    assert True\n")
    return root


def _ledger(tmp_path, catches, name="ledger.jsonl"):
    """One `catch-count` row that touched what all three tests exercise, with
    the catches the caller names and none otherwise."""
    row = {
        "kind": "catch-count",
        "runId": "run-1",
        "startedAt": "2026-09-14T00:00:00Z",
        "touched": ["lib/a.py"],
        "catches": catches,
        "exercises": {GATE_FILE: ["lib/a.py"],
                      RUNNER_FILE: ["lib/a.py"],
                      PLAIN_FILE: ["lib/a.py"]},
    }
    path = tmp_path / name
    path.write_text(json.dumps(row) + "\n", encoding="utf-8")
    return catch_report._read_jsonl(path)


def _table(tree, rows):
    """The table the CLI builds, with the gate species wired the way `main`
    wires the runner species. [M4]"""
    tests = catch_report.tree_test_files(tree)
    return tests, catch_report.catch_table(
        rows, tests,
        runners=catch_report.tree_runners(tree, tests),
        gates=catch_report.tree_gates(tree, tests))


# --- (a) [M4] the three statuses, the deletion input, the curve ------------

def test_leg_a_gate_runner_and_zero(tree, tmp_path):
    rows = _ledger(tmp_path, {})
    tests, table = _table(tree, rows)

    assert tests == sorted([GATE_FILE, PLAIN_FILE, RUNNER_FILE]), (
        "(a) [M4] the tree's two suite globs list exactly the three tests")
    assert sorted(table) == sorted([GATE_FILE, PLAIN_FILE, RUNNER_FILE]), (
        "(a) [M4] the table is keyed over those three tests")

    assert table[GATE_FILE]["status"] == "gate", (
        "(a) [M4] a test carrying the bare `# catch-counter: gate` line has "
        "status `gate`")
    assert table[RUNNER_FILE]["status"] == "runner", (
        "(a) [M4] the runner marker still answers `runner` — the gate is a "
        "second name for the same treatment, not a replacement")
    assert table[PLAIN_FILE]["status"] == "zero", (
        "(a) [M4] a file carrying neither marker keeps its BASE status")

    assert table[GATE_FILE]["catches"] == 0, (
        "(a) [M4] the gate is listed with its catches")
    assert table[GATE_FILE]["touchingRuns"] == 1, (
        "(a) [M4] the gate is listed with its touching runs")

    assert catch_report.zero_over(table, 1) == [PLAIN_FILE], (
        "(a) [M4] the gate is never a deletion candidate — `zero_over` at N=1 "
        "is exactly the plain file")
    assert catch_report.zero_curve(table) == [{"n": 1, "files": 1}], (
        "(a) [M4] the gate is never a point on the zero-catch curve — one "
        "file at N=1")


# --- (b) [M4] the gate's row in the report, not under the deletion heading --

def test_leg_b_gate_row_in_report_not_under_deletion_heading(tree, tmp_path):
    rows = _ledger(tmp_path, {})
    _, table = _table(tree, rows)
    lines = catch_report.report_lines(table, 1)

    gate_row = f"| {GATE_FILE} | 0 | 1 | gate |"
    assert gate_row in lines, (
        "(b) [M4] the gate is listed in the table with its catches and "
        f"touching runs: {gate_row!r} in {lines!r}")

    heading = "## Zero catches over 1 runs"
    assert heading in lines, (
        "(b) [M4] the deletion input is still reported at the operator's N")
    tail = lines[lines.index(heading) + 1:]
    assert GATE_FILE not in tail, (
        "(b) [M4] the gate is not carried under "
        f"{heading!r}: {tail!r}")
    assert PLAIN_FILE in tail, (
        f"(b) [M4] the plain zero still is: {tail!r}")


# --- (c) [M4] a gate with catches, and `tree_gates` ------------------------

def test_leg_c_gate_with_catches_and_tree_gates(tree, tmp_path):
    rows = _ledger(tmp_path, {GATE_FILE: 2})
    tests, table = _table(tree, rows)

    assert table[GATE_FILE]["catches"] == 2, (
        "(c) [M4] a gate's catches are counted and listed")
    assert table[GATE_FILE]["status"] == "gate", (
        "(c) [M4] a gate with two catches still reads `gate`, whatever the "
        "values")
    assert f"| {GATE_FILE} | 2 | 1 | gate |" in catch_report.table_lines(table), (
        "(c) [M4] and is listed in the table with those values")
    assert catch_report.zero_over(table, 1) == [PLAIN_FILE], (
        "(c) [M4] and is still no deletion candidate")

    assert catch_report.tree_gates(tree, tests) == [GATE_FILE], (
        "(c) [M4] `tree_gates` over that tree names only the gate file")
    assert catch_report.tree_runners(tree, tests) == [RUNNER_FILE], (
        "(c) [M4] and `tree_runners` still names only the runner")


def test_leg_c_produced_signatures():
    table_sig = inspect.signature(catch_report.catch_table)
    assert list(table_sig.parameters) == [
        "rows", "tree_tests", "landings", "runners", "gates"], (
        "(c) [Produces] `catch_table(rows, tree_tests, landings=None, "
        f"runners=(), gates=())`, got {table_sig}")
    assert table_sig.parameters["gates"].default == (), (
        f"(c) [Produces] `gates=()` is the default, got {table_sig}")
    gates_sig = inspect.signature(catch_report.tree_gates)
    assert list(gates_sig.parameters) == ["tree", "tests"], (
        f"(c) [Produces] `tree_gates(tree, tests)`, got {gates_sig}")


# --- (d) [M1] the probe read as text ---------------------------------------

def _probe_text():
    assert PROBE.is_file(), (
        f"(d) [M1] the probe is created at {PROBE_REL}")
    return PROBE.read_text(encoding="utf-8")


def test_leg_d_probe_imports_and_text():
    text = _probe_text()
    specifiers = set(re.findall(r"""\bfrom\s+['"]([^'"]+)['"]""", text))
    specifiers |= set(re.findall(r"""\bimport\s+['"]([^'"]+)['"]""", text))
    specifiers |= set(re.findall(r"""\bimport\s*\(\s*['"]([^'"]+)['"]""", text))
    assert specifiers == {"node:assert/strict", "node:fs", "node:path",
                          "./_readiness_helpers.mjs"}, (
        "(d) [M1] the probe's `import` lines name exactly the four "
        f"specifiers M1 lists, got {sorted(specifiers)}")

    for name in ("negativeControlSpec", "softEdgesSpec", "discoverFixtureSets",
                 "ALL TESTS PASSED"):
        assert name in text, (
            f"(d) [M1] the probe's text carries {name!r} — it is #832's sim, "
            "control, soft-edges pair and sentinel included")


def test_leg_d_probe_is_no_suite_test():
    assert PROBE.is_file(), f"(d) [M1] the probe is created at {PROBE_REL}"
    assert PROBE_REL not in catch_report.tree_test_files(ROOT), (
        "(d) [M1] `tree_test_files` over this repository does not list the "
        "probe — a `probe_*.mjs` is not a test file")
    collected = [os.path.relpath(p, ROOT)
                 for p in collect_sims(str(ROOT / "fleet"))]
    assert PROBE_REL not in collected, (
        "(d) [M2] and `tests/test_fleet_suite.py` never collects it, because "
        "its name begins `probe_`")


# --- (e) [M2] and (g) [M1] the probe run -----------------------------------

def _run_probe(env_extra=None):
    # No existence check here: an absent probe is `node`'s own
    # `Cannot find module` on stderr, which is what the caller reports.
    env = dict(os.environ)
    env.pop("READINESS_FIXTURES_DIR", None)
    env.update(env_extra or {})
    return subprocess.run(["node", PROBE_REL], cwd=str(ROOT), env=env,
                          capture_output=True, text=True,
                          timeout=PROBE_TIMEOUT)


def _stdout_lines(proc):
    return [line for line in proc.stdout.splitlines() if line.strip()]


def _assert_census(lines, where):
    """M2's stdout shape: five `wave-` lines, the control, the sentinel last —
    and, because M1 makes stdout one line per set, nothing else."""
    waves = [line for line in lines
             if re.fullmatch(r"wave-\S+ .* ok steps=\d+ kernelCalls=\d+", line)]
    assert len(waves) == 5, (
        f"[M2] {where}: exactly five lines beginning `wave-` and ending "
        f"`ok steps=<n> kernelCalls=<n>`, got {waves!r}")
    control = [line for line in lines if line.startswith("negative-control")]
    assert len(control) == 1 and " caught " in control[0], (
        f"[M2] {where}: one line beginning `negative-control` carrying "
        f"` caught `, got {control!r}")
    assert lines[-1] == "ALL TESTS PASSED", (
        f"[M2] {where}: `ALL TESTS PASSED` is the last line, got {lines!r}")
    assert len(lines) == 7, (
        f"[M2] {where}: one stdout line per set and the sentinel, nothing "
        f"else, got {lines!r}")


@pytest.fixture(scope="module")
def plain_run():
    return _run_probe()


def test_leg_e_probe_run(plain_run):
    assert plain_run.returncode == 0, (
        "(e) [M2] `node fleet/tests/probe_readiness_fold_order.mjs` at BASE "
        f"exits 0, got {plain_run.returncode}\n{plain_run.stderr}")
    _assert_census(_stdout_lines(plain_run), "the plain run")


def test_leg_g_unresolvable_fixture_set_is_skipped(tmp_path):
    # The set directory is named `ghost`; this test function deliberately is
    # not, because the helper writes one `fixture root <root>` stderr line and
    # pytest derives `tmp_path` from the test's name.
    root = tmp_path / "fixtures"
    (root / "ghost").mkdir(parents=True)
    (root / "ghost" / "manifest.json").write_text(
        json.dumps({"fixture": "ghost", "project": "no/such/tree",
                    "tasks": []}) + "\n", encoding="utf-8")

    proc = _run_probe({"READINESS_FIXTURES_DIR": str(root)})
    assert proc.returncode == 0, (
        "(g) [M1] a fixture set whose `project` tree exists at neither "
        "resolution is skipped, not thrown: the run exits 0, got "
        f"{proc.returncode}\n{proc.stderr}")

    lines = _stdout_lines(proc)
    assert not [line for line in lines if line.startswith("ghost")], (
        f"(g) [M1] the skipped set prints no stdout line, got {lines!r}")
    _assert_census(lines, "the run over the unresolvable set")

    named = [line for line in proc.stderr.splitlines() if "ghost" in line]
    assert len(named) == 1, (
        "(g) [M1] its stderr carries exactly one line naming the skipped set, "
        f"got {named!r}")


# --- (f) [M3] `PROBES.md` --------------------------------------------------

def _sed_range(text, start, end=None):
    """`sed -n '/start/,/end/p'` — from the first line matching `start` to the
    first line after it matching `end`, or to the end of the file."""
    lines = text.splitlines()
    begun = []
    for index, line in enumerate(lines):
        if not begun:
            if re.search(start, line):
                begun = [line]
            continue
        begun.append(line)
        if end is not None and re.search(end, line):
            break
    return " ".join(begun)


def test_leg_f_probes_md_opening_paragraph():
    text = PROBES_MD.read_text(encoding="utf-8")
    opening = _sed_range(text, r"^# fleet.tests probes", r"^The current probes:")
    assert re.search(r"live measurement.*design gate", opening), (
        "(f) [M3] the opening paragraph says a probe is either a live "
        "measurement or a design gate, so a model-free probe is what the file "
        f"describes: {opening!r}")


def test_leg_f_probes_md_lists_the_probe():
    text = PROBES_MD.read_text(encoding="utf-8")
    entry = _sed_range(text, r"probe_readiness_fold_order\.mjs", r"^$")
    assert entry, (
        "(f) [M3] `fleet/tests/PROBES.md` lists "
        "`probe_readiness_fold_order.mjs`")
    assert re.search(
        r"every.*order.*by hand.*before any change.*scheduler", entry), (
        "(f) [M3] with the sentence that it is run by hand before any change "
        "to the fold kernel or the ready-set scheduler: "
        f"{entry!r}")


# ===========================================================================
# The catch-counter ratchet — the zero-catch reading per release
# ===========================================================================
#
# The exam for the second task carried in this file: `--zero-over N`, the
# report's release window, and the RUNBOOK's `## Release` section. Written
# against that task's Machine clauses, leg by leg, with every assertion naming
# the leg it belongs to and the clause it comes from:
#
#   M2  `catch_report.py --ledger <f> --tree <dir> --zero-over N` prints, after
#       the table and the curve, a section headed exactly
#       `## Zero catches over the last N release(s)` (N the number given),
#       whose first line names the window — the `v*` tag that opens it, that
#       tag's instant and how many `catch-count` rows fall inside it — and then
#       one line `- <path> — exercised by <k> run(s)` per test file of the
#       tree, sorted, for every path `tree_test_files` lists (never a path only
#       the record names, never a `runner` or `gate`) whose catches summed over
#       the rows in the window are 0, `k` being the number of rows in the
#       window whose `exercises` names the path; the window is every row whose
#       `startedAt` is after the creator date of the Nth most recent `v*` tag
#       of `--tree`, and a tree with fewer than N `v*` tags opens the window at
#       the epoch with the first line saying so.
#   M3  Without `--zero-over` the report is what it is at BASE: the table, the
#       curve, `--n`'s `## Zero catches over N runs` section and the unstamped
#       note, unchanged.
#   M4  `fleet/RUNBOOK.md` carries a `## Release` section, before
#       `## Rollback`, naming the two commands in order and saying the
#       `## Zero catches over the last 1 release(s)` section is pasted into the
#       release commit body beside the prose sizes, report-only, with deletion
#       following on the reading as `CLAUDE.md`'s Test doctrine has it.
#
# Legs: (d) [M2] `--zero-over 1` over the two-tag fixture; (e) [M2]
# `--zero-over 2`; (f) [M2] `--zero-over 5` on the same two-tag fixture — the
# epoch window; (g) [M3] the report without `--zero-over`, line for line;
# (h) [M2] the Proof's third `Run:`; (i) [M4] the fourth; (j) [M2] the fifth.
#
# Two readings this section pins, both from the task's own words:
#
#   * the window line's template is verbatim — `window: since <tag>
#     (<instant>), <k> run(s)` — but `<instant>` is matched as a group and
#     compared as a MOMENT against the tag's own `%(creatordate:iso-strict)`,
#     so an implementation that spells the same instant `…Z` rather than
#     `…+00:00` is not failed for the spelling.
#   * the epoch line is `window: the whole record (fewer than N release tags),
#     <k> run(s)`, where the task writes a bare `N` in a template whose heading
#     it writes as `%d`; that one token is matched as the number or the letter
#     and every other character of the line verbatim.
#
# The fixture tree is a real `git init` repository — two commits tagged
# `v0.1.0` and `v0.2.0` with `GIT_COMMITTER_DATE` set to T1 and T2, T1 < T2,
# `user.name`/`user.email` configured locally so `HOME` is irrelevant — so
# `for-each-ref` reads the tags the way the tool does. Neither `ULTRA_BASE` nor
# any commit sha is read.

from datetime import datetime  # noqa: E402

REPORT = SCRIPTS / "catch_report.py"
RUNBOOK = ROOT / "fleet/RUNBOOK.md"

# The fixture's four test files: three plain, one carrying the runner marker.
R_P = "tests/test_p.py"
R_Q = "tests/test_q.py"
R_R = "tests/test_r.py"
R_RUNNER = "tests/test_runner.py"
# A path the record names and the tree does not have: never listed.
R_GONE = "tests/test_gone.py"

T1 = "2026-02-01T00:00:00+00:00"          # v0.1.0
T2 = "2026-03-01T00:00:00+00:00"          # v0.2.0

# run-1 before T1, run-2 between the tags, run-3 and run-4 after T2.
R_ROWS = [
    {"kind": "catch-count", "runId": "run-1",
     "startedAt": "2026-01-15T00:00:00Z",
     "touched": ["lib/a.py"],
     "catches": {R_P: 1, R_Q: 1},
     "exercises": {R_P: ["lib/a.py"], R_Q: ["lib/a.py"]}},
    {"kind": "catch-count", "runId": "run-2",
     "startedAt": "2026-02-15T00:00:00Z",
     "touched": ["lib/a.py"],
     "catches": {R_P: 1},
     "exercises": {R_P: ["lib/a.py"], R_Q: ["lib/a.py"],
                   R_RUNNER: ["lib/a.py"]}},
    {"kind": "catch-count", "runId": "run-3",
     "startedAt": "2026-03-15T00:00:00Z",
     "touched": ["lib/a.py"],
     "catches": {},
     "exercises": {R_P: ["lib/a.py"], R_Q: ["lib/a.py"],
                   R_GONE: ["lib/a.py"]}},
    {"kind": "catch-count", "runId": "run-4",
     "startedAt": "2026-03-16T00:00:00Z",
     "touched": ["lib/a.py"],
     "catches": {},
     "exercises": {R_P: ["lib/a.py"]}},
]


def _git(tree, *args, when=None):
    env = dict(os.environ)
    if when is not None:
        env["GIT_AUTHOR_DATE"] = when
        env["GIT_COMMITTER_DATE"] = when
    proc = subprocess.run(["git", "-C", str(tree), *args],
                          capture_output=True, text=True, env=env)
    assert proc.returncode == 0, (
        "the fixture repository could not be built: git %s\n%s%s"
        % (" ".join(args), proc.stdout, proc.stderr))
    return proc.stdout


@pytest.fixture(scope="module")
def release_tree(tmp_path_factory):
    """The fixture tree: four test files under `tests/`, one of them a runner,
    in a real git repository whose two lightweight `v*` tags sit on commits
    dated T1 and T2. [M2]"""
    root = tmp_path_factory.mktemp("release-tree")
    _git(root, "init", "-q")
    _git(root, "config", "user.name", "exam")
    _git(root, "config", "user.email", "exam@example.invalid")
    _git(root, "config", "commit.gpgsign", "false")
    _git(root, "config", "tag.gpgsign", "false")

    for rel in (R_P, R_Q, R_R):
        _write(root / rel, "def test_x():\n    assert True\n")
    _write(root / R_RUNNER, f"{RUNNER_LINE}\nimport pytest\n")
    _write(root / "lib/a.py", "value = 1\n")
    _git(root, "add", "-A")
    _git(root, "commit", "-q", "-m", "the tests", when=T1)
    _git(root, "tag", "v0.1.0")

    _write(root / "NOTES.md", "the second release\n")
    _git(root, "add", "-A")
    _git(root, "commit", "-q", "-m", "chore(release): v0.2.0", when=T2)
    _git(root, "tag", "v0.2.0")
    return root


@pytest.fixture(scope="module")
def release_ledger(tmp_path_factory):
    """The four `catch-count` rows, one JSON object per line. [M2]"""
    path = tmp_path_factory.mktemp("release-ledger") / "ledger.jsonl"
    path.write_text("".join(json.dumps(row) + "\n" for row in R_ROWS),
                    encoding="utf-8")
    return path


def _creatordate(tree, tag):
    """The tag's creator date as the tool reads it — the Context's own command,
    so the exam and the implementation read one clock."""
    out = _git(tree, "for-each-ref",
               "--format=%(creatordate:iso-strict)", "refs/tags/" + tag)
    return out.strip()


def _report(*args):
    return subprocess.run([sys.executable, str(REPORT), *args],
                          capture_output=True, text=True)


def _lines(text):
    return [line for line in text.splitlines() if line.strip()]


def _heading(n):
    """M2's heading, verbatim."""
    return "## Zero catches over the last %d release(s)" % n


def _section(stdout, heading):
    """The lines under `heading`, up to the next `## ` heading or the end —
    the closing unstamped note, which is no part of the section, excluded."""
    body = _lines(stdout)
    assert body.count(heading) == 1, (
        f"[M2] exactly one {heading!r} in the report: {body!r}")
    out = []
    for line in body[body.index(heading) + 1:]:
        if line.startswith("## "):
            break
        if re.fullmatch(r"\d+ row\(s\) carry no startedAt — recount them",
                        line):
            continue
        out.append(line)
    return out


WINDOW_SINCE = re.compile(
    r"^window: since (?P<tag>\S+) \((?P<instant>[^()]+)\), "
    r"(?P<runs>\d+) run\(s\)$")
# The one ambiguous token: the task's template writes `fewer than N release
# tags` while spelling the heading's N as `%d`, so either reading passes and
# every other character is verbatim.
WINDOW_EPOCH = re.compile(
    r"^window: the whole record \(fewer than (?:\d+|N) release tags\), "
    r"(?P<runs>\d+) run\(s\)$")


def _assert_window_since(line, tree, tag, runs, leg):
    match = WINDOW_SINCE.match(line)
    assert match, (
        f"{leg} [M2] the section's first line names the window: "
        f"`window: since <tag> (<instant>), <k> run(s)`, got {line!r}")
    assert match.group("tag") == tag, (
        f"{leg} [M2] the `v*` tag that opens the window is {tag!r}, got "
        f"{match.group('tag')!r}")
    assert match.group("runs") == str(runs), (
        f"{leg} [M2] {runs} `catch-count` row(s) fall inside it, got "
        f"{match.group('runs')!r}")
    # The tag's own instant, read with the tool's own parse: `creatordate`
    # ends in `Z`, which `datetime.fromisoformat` rejects before Python
    # 3.11 — and the laptop's python3 is older than the sandbox's, which is
    # how this leg went red on one machine and green on the other.
    wanted = catch_report._when(_creatordate(tree, tag))
    got = catch_report._when(match.group("instant"))
    assert got is not None and got == wanted, (
        f"{leg} [M2] and that tag's own instant ({wanted.isoformat()}), got "
        f"{match.group('instant')!r}")


# --- (d) [M2] `--zero-over 1`: the window since the latest tag --------------

def test_ratchet_leg_d_zero_over_one(release_tree, release_ledger):
    """(d) [M2]: `--zero-over 1` opens at `v0.2.0` — run-3 and run-4 — where
    nothing caught, so all three of the tree's plain tests are listed with the
    runs that exercised them; the runner and the record-only path are not."""
    proc = _report("--ledger", str(release_ledger), "--tree",
                   str(release_tree), "--zero-over", "1")
    assert proc.returncode == 0, proc.stdout + proc.stderr

    body = _lines(proc.stdout)
    heading = _heading(1)
    assert heading in body, (
        f"(d) [M2] the section is headed exactly {heading!r}: {proc.stdout!r}")
    assert body.index(heading) > body.index(catch_report.CURVE_HEADING), (
        "(d) [M2] the section prints after the table and the curve: "
        f"{body!r}")

    section = _section(proc.stdout, heading)
    _assert_window_since(section[0], release_tree, "v0.2.0", 2, "(d)")
    assert section[1:] == [
        "- tests/test_p.py — exercised by 2 run(s)",
        "- tests/test_q.py — exercised by 1 run(s)",
        "- tests/test_r.py — exercised by 0 run(s)",
    ], ("(d) [M2] one `- <path> — exercised by <k> run(s)` line per zero-catch "
        f"test of the tree, sorted: {section[1:]!r}")


def test_ratchet_leg_d_neither_the_runner_nor_the_record_only_path(
        release_tree, release_ledger):
    """(d) [M2]: never a `runner`, and never a path only the record names."""
    proc = _report("--ledger", str(release_ledger), "--tree",
                   str(release_tree), "--zero-over", "1")
    assert proc.returncode == 0, proc.stdout + proc.stderr
    section = _section(proc.stdout, _heading(1))
    assert not [line for line in section if R_RUNNER in line], (
        f"(d) [M2] the runner is not under the heading: {section!r}")
    assert not [line for line in section if R_GONE in line], (
        "(d) [M2] and neither is `tests/test_gone.py`, which only the record "
        f"names: {section!r}")


# --- (e) [M2] `--zero-over 2`: the window since the tag before -------------

def test_ratchet_leg_e_zero_over_two(release_tree, release_ledger):
    """(e) [M2]: `--zero-over 2` opens at `v0.1.0` — run-2, run-3, run-4 —
    where run-2 caught with `test_p`, so `test_p` is absent and the fixture's
    two never-catching tests are exactly what is listed."""
    proc = _report("--ledger", str(release_ledger), "--tree",
                   str(release_tree), "--zero-over", "2")
    assert proc.returncode == 0, proc.stdout + proc.stderr

    section = _section(proc.stdout, _heading(2))
    _assert_window_since(section[0], release_tree, "v0.1.0", 3, "(e)")
    assert section[1:] == [
        "- tests/test_q.py — exercised by 2 run(s)",
        "- tests/test_r.py — exercised by 0 run(s)",
    ], ("(e) [M2] `test_p` caught inside the window and is gone; `test_q` is "
        "named by run-2 and run-3, and run-4 exercises `test_p` alone: "
        f"{section[1:]!r}")


# --- (f) [M2] `--zero-over 5`: fewer tags than releases asked for ----------

def test_ratchet_leg_f_zero_over_five_opens_at_the_epoch(release_tree,
                                                         release_ledger):
    """(f) [M2]: the two-tag fixture has fewer than five `v*` tags, so the
    window opens at the epoch — the first line says so and names all four rows
    — and only `test_r` is listed, `test_p` and `test_q` having caught in
    run-1."""
    proc = _report("--ledger", str(release_ledger), "--tree",
                   str(release_tree), "--zero-over", "5")
    assert proc.returncode == 0, proc.stdout + proc.stderr

    section = _section(proc.stdout, _heading(5))
    match = WINDOW_EPOCH.match(section[0])
    assert match, (
        "(f) [M2] a tree with fewer than N `v*` tags opens the window at the "
        "epoch with the first line saying so — `window: the whole record "
        f"(fewer than N release tags), <k> run(s)`, got {section[0]!r}")
    assert match.group("runs") == "4", (
        "(f) [M2] with every row of the record inside it, got "
        f"{match.group('runs')!r}")
    assert section[1:] == [
        "- tests/test_r.py — exercised by 0 run(s)",
    ], ("(f) [M2] `test_p` and `test_q` caught in run-1, which is inside this "
        f"window: {section[1:]!r}")


# --- (g) [M3] the report without `--zero-over`, line for line --------------

BASE_SHAPE = [
    "| test | catches | touching runs | status |",
    "| --- | --- | --- | --- |",
    "| tests/test_gone.py | 0 | 4 | zero |",
    "| tests/test_p.py | 2 | 3 | caught |",
    "| tests/test_q.py | 1 | 3 | caught |",
    "| tests/test_r.py | 0 | 0 | unobserved |",
    "| tests/test_runner.py | 0 | 3 | runner |",
    "## Zero-catch curve",
    "N=1: 1 file(s)",
    "N=2: 1 file(s)",
    "N=3: 1 file(s)",
    "N=4: 1 file(s)",
    "max touching runs: 4",
    "## Zero catches over 1 runs",
    "tests/test_gone.py",
]


def test_ratchet_leg_g_without_zero_over_the_report_is_the_base_shape(
        release_tree, release_ledger):
    """(g) [M3]: without `--zero-over` the report is line for line what it is
    at BASE — the table, the curve, `--n`'s own section — and nothing of the
    release window appears in it."""
    proc = _report("--ledger", str(release_ledger), "--tree",
                   str(release_tree), "--n", "1")
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert _lines(proc.stdout) == BASE_SHAPE, (
        "(g) [M3] the BASE report, unchanged: "
        f"{_lines(proc.stdout)!r}")
    assert not [line for line in _lines(proc.stdout)
                if line.startswith("## Zero catches over the last")], (
        "(g) [M3] and no release section without the option")


def test_ratchet_leg_g_the_unstamped_note_stays_last(release_tree,
                                                     release_ledger,
                                                     tmp_path):
    """(g) [M3]: the unstamped note is still the report's last line — without
    `--zero-over`, and with it, since the section is wired before the note."""
    ledger = tmp_path / "unstamped.jsonl"
    rows = R_ROWS + [{"kind": "catch-count", "runId": "run-5",
                      "catches": {}, "exercises": {}, "touched": []}]
    ledger.write_text("".join(json.dumps(row) + "\n" for row in rows),
                      encoding="utf-8")
    note = "1 row(s) carry no startedAt — recount them"

    plain = _report("--ledger", str(ledger), "--tree", str(release_tree),
                    "--n", "1")
    assert plain.returncode == 0, plain.stdout + plain.stderr
    assert _lines(plain.stdout)[-1] == note, (
        f"(g) [M3] the note is the last line: {_lines(plain.stdout)!r}")

    windowed = _report("--ledger", str(ledger), "--tree", str(release_tree),
                       "--n", "1", "--zero-over", "1")
    assert windowed.returncode == 0, windowed.stdout + windowed.stderr
    body = _lines(windowed.stdout)
    assert body[-1] == note, (
        "(g) [M3] and stays the last line with the release section printed "
        f"before it: {body!r}")
    assert _heading(1) in body, (
        f"(g) [M2] with the section itself still printed: {body!r}")


# --- (h) [M2] the Proof's third `Run:` -------------------------------------

def test_ratchet_leg_h_help_names_the_zero_over_flag():
    """(h) [M2]: `catch_report.py --help` names `--zero-over`."""
    proc = _report("--help")
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert "--zero-over" in proc.stdout, (
        "(h) [M2] `--help` names `--zero-over`: " + proc.stdout)


# --- (i) [M4] the Proof's fourth `Run:` — the RUNBOOK's `## Release` -------

def test_ratchet_leg_i_runbook_release_section_sits_before_rollback():
    """(i) [M4]: `fleet/RUNBOOK.md` carries a `## Release` section between
    `## Trust` and `## Rollback`."""
    headings = [line for line in RUNBOOK.read_text(encoding="utf-8").
                splitlines() if line.startswith("## ")]
    assert "## Release" in headings, (
        f"(i) [M4] `fleet/RUNBOOK.md` carries a `## Release` section: "
        f"{headings!r}")
    assert "## Rollback" in headings, headings
    assert headings.index("## Release") < headings.index("## Rollback"), (
        f"(i) [M4] before `## Rollback`: {headings!r}")
    assert headings.index("## Trust") < headings.index("## Release"), (
        f"(i) [M4] and after `## Trust`: {headings!r}")


def test_ratchet_leg_i_runbook_names_the_two_commands_in_order():
    """(i) [M4]: the fourth `Run:` itself — the section, read to
    `## Rollback`, carries the `catch_counter.py --fetch` line, then the
    `catch_report.py … --zero-over 1` line, then the release commit body."""
    text = RUNBOOK.read_text(encoding="utf-8")
    blob = _sed_range(text, r"^## Release", r"^## Rollback")
    assert blob, (
        "(i) [M4] there is no `## Release` section to read")
    assert re.search(r"catch_counter\.py --fetch.*catch_report\.py.*"
                     r"--zero-over 1.*release commit body", blob), (
        "(i) [M4] the two commands in order, then the release commit body: "
        f"{blob!r}")


def test_ratchet_leg_i_runbook_says_what_the_reading_is_for():
    """(i) [M4]: and says the `## Zero catches over the last 1 release(s)`
    section is pasted into the release commit body beside the prose sizes,
    report-only, with deletion following on the reading as the Test doctrine
    has it."""
    text = RUNBOOK.read_text(encoding="utf-8")
    blob = _sed_range(text, r"^## Release", r"^## Rollback")
    assert _heading(1) in blob, (
        "(i) [M4] the section named is `## Zero catches over the last 1 "
        f"release(s)`: {blob!r}")
    assert "prose sizes" in blob, (
        f"(i) [M4] pasted beside the prose sizes: {blob!r}")
    assert re.search(r"report-only", blob, re.I), (
        f"(i) [M4] report-only: {blob!r}")
    assert re.search(r"delet", blob, re.I) and "Test doctrine" in blob, (
        "(i) [M4] and deletion follows on the reading, as `CLAUDE.md`'s Test "
        f"doctrine has it: {blob!r}")


# --- (j) [M2] the Proof's fifth `Run:` — this tree, an empty ledger --------

def test_ratchet_leg_j_the_heading_prints_on_this_tree():
    """(j) [M2]: `--ledger /dev/null --tree . --zero-over 1` on this repository
    prints the heading — `/dev/null` reads as no rows, and a tree with no `v*`
    tag opens the window at the epoch rather than failing."""
    proc = _report("--ledger", "/dev/null", "--tree", str(ROOT),
                   "--zero-over", "1")
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert _heading(1) in _lines(proc.stdout), (
        "(j) [M2] the section heading prints for N=1: " + proc.stdout)


# ------------------------------------------------------------- the Interfaces

def test_ratchet_produces_zero_over_releases_signature(release_tree):
    """[Produces] `zero_over_releases(rows, tree, tree_tests, n, runners=(),
    gates=()) -> list[str]`, with those parameter names and those defaults."""
    fn = getattr(catch_report, "zero_over_releases", None)
    assert callable(fn), (
        "[Produces] `catch_report.zero_over_releases` does not exist yet")
    signature = inspect.signature(fn)
    assert list(signature.parameters) == ["rows", "tree", "tree_tests", "n",
                                          "runners", "gates"], (
        "[Produces] `zero_over_releases(rows, tree, tree_tests, n, runners=(), "
        f"gates=())`, got {signature}")
    assert signature.parameters["runners"].default == () and \
        signature.parameters["gates"].default == (), (
        f"[Produces] with `runners=()` and `gates=()`, got {signature}")
    answer = fn(list(R_ROWS), release_tree,
                catch_report.tree_test_files(release_tree), 1,
                runners=[R_RUNNER])
    assert isinstance(answer, list) and all(isinstance(line, str)
                                            for line in answer), (
        f"[Produces] the answer is a list of strings, got {answer!r}")
