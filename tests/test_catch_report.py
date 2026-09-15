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
