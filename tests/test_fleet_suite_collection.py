"""The suite collects the reserved directory from the branch (task 3).

Task 1's engine writes a run's exams into a reserved directory on the branch —
`fleet/tests/exams/<slug>/` for a sim, `tests/exams/<slug>/` for a `.py` exam.
This file grades the other half of that: inside a run, the committed suite has
to COLLECT those directories, and on main — where neither exists — collect
exactly what it collects today, with no workflow edit.

Leg by leg, each assertion naming the clause it comes from:

  M1 / leg (a) — `tests/test_fleet_suite.py` exports `collect_sims(fleet_dir)`,
    returning every `<fleet_dir>/tests/test_*.mjs` and every
    `<fleet_dir>/tests/exams/*/test_*.mjs`, `SLOW_FIRST` names first and the
    rest alphabetical by path relative to `<fleet_dir>/tests`, keeping two
    files of one basename in different directories BOTH (the BASE
    `_slowest_first` keys `by_name` on the basename, so one of the two would be
    dropped). Non-`test_*` neighbours are not sims.
  M2 / legs (b) and (c) — the bridge's parametrize ids are each path relative
    to `fleet/tests/`, `TESTS` is `collect_sims(FLEET)`, and on a tree with no
    `fleet/tests/exams/` the bridge collects exactly the
    `fleet/tests/test_*.mjs` files in the BASE order. Leg (b) proves it on a
    tmp tree carrying a byte-for-byte copy of the bridge (ids, a green run, and
    a red one that names the exam sim); leg (c) proves it on the tree at hand,
    against a list this file computes from the globs itself — never through
    `collect_sims`, so the exam does not grade the implementation with the
    implementation.
  M3 / leg (d) — a fact about pytest's collector that the run relies on, not a
    test of pytest's source: `python3 -m pytest` from the repo root collects a
    `.py` exam at `tests/exams/<slug>/test_x.py` beside a curated
    `tests/test_x.py` of the same basename and runs BOTH, provided
    `tests/exams/<slug>/__init__.py` is present; without it, collection aborts.

`test_fleet_suite` is imported by module name — the convention of this suite
(`tests/test_compile_plan_check_cost.py` line 57) — and `collect_sims` is
fetched off it inside leg (a), so its absence at BASE reads as the missing
export rather than as a collection error for the whole file.
"""
import glob
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
BRIDGE = ROOT / "tests" / "test_fleet_suite.py"
PYTEST_INI = ROOT / "pytest.ini"
FLEET_TESTS = ROOT / "fleet" / "tests"

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_fleet_suite as bridge  # noqa: E402

# A sim, in the only terms the bridge reads: exit 0 and the sentinel on stdout.
SIM_OK = 'console.log("ALL TESTS PASSED");\n'
SIM_RED = 'console.error("this sim fails");\nprocess.exit(1);\n'

TIMEOUT = 300


# --------------------------------------------------------------------------- #
# helpers                                                                      #
# --------------------------------------------------------------------------- #
def _write(path, text=""):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    return path


def _rel(fleet_dir, paths):
    """Each path as M1 names it: relative to `<fleet_dir>/tests`, `/`-joined."""
    tests_dir = os.path.join(str(fleet_dir), "tests")
    return [os.path.relpath(str(p), tests_dir).replace(os.sep, "/")
            for p in paths]


def _collect_sims():
    """M1's produced symbol, read off the bridge module at call time."""
    fn = getattr(bridge, "collect_sims", None)
    assert callable(fn), (
        "M1: tests/test_fleet_suite.py must export "
        "`collect_sims(fleet_dir: str) -> list[str]`; the module exports no "
        "such name")
    return fn


def _pytest(args, cwd):
    """`python3 -m pytest <args>` as a subprocess, with the outer run's
    PYTEST_ADDOPTS cleared so an `-n 6` on the outer suite cannot reshape the
    inner run's output."""
    env = dict(os.environ)
    env["PYTEST_ADDOPTS"] = ""
    return subprocess.run([sys.executable, "-m", "pytest"] + list(args),
                          cwd=str(cwd), capture_output=True, text=True,
                          env=env, timeout=TIMEOUT)


def _ids(stdout):
    """The parametrize ids of `test_fleet_mjs`, in printed order."""
    marker = "::test_fleet_mjs["
    ids = []
    for line in stdout.splitlines():
        line = line.strip()
        if marker in line and line.endswith("]"):
            ids.append(line.split(marker, 1)[1][:-1])
    return ids


def _last_line(stdout):
    lines = [ln for ln in stdout.strip().splitlines() if ln.strip()]
    return lines[-1] if lines else ""


def _expected_order(rel_names):
    """M1's order, spelled here rather than imported: the `SLOW_FIRST` members
    present, in `SLOW_FIRST` order, then every other name sorted by relative
    path.

    Membership is by BASENAME, as `SLOW_FIRST` is written: it is a list of wall
    measurements, and a sim's wall does not change because a run copied it into
    `exams/`. Keying it on the relative name instead would put
    `exams/run_7/test_publish_fold.mjs` in the tail while the bridge puts it in
    the head, and this leg would red against a correct implementation.
    """
    def key(rel):
        name = rel.rsplit("/", 1)[-1]
        rank = (bridge.SLOW_FIRST.index(name) if name in bridge.SLOW_FIRST
                else len(bridge.SLOW_FIRST))
        return (rank, rel)

    return sorted(set(rel_names), key=key)


# --------------------------------------------------------------------------- #
# leg (a) [M1] — collect_sims: what it returns, and in what order              #
# --------------------------------------------------------------------------- #
def test_collect_sims_takes_both_directories_in_slow_first_then_alpha_order(
        tmp_path):
    """leg (a) [M1]: a `fleet/tests/` holding `test_a.mjs`, `test_b.mjs`,
    `test_sandbox_boot.mjs` and `exams/run_7/test_a.mjs` yields four paths,
    the `SLOW_FIRST` member first and the rest alphabetical by relative path;
    `_helpers.mjs` and `exams/run_7/probe_x.mjs` are not sims; the two
    `test_a.mjs` in different directories are BOTH kept.
    """
    collect_sims = _collect_sims()

    # The membership leg (a) relies on, asserted before it is relied on.
    assert "test_sandbox_boot.mjs" in bridge.SLOW_FIRST, (
        "leg (a) [M1]: the leg's ordering rests on test_sandbox_boot.mjs being "
        "a member of the module's SLOW_FIRST; it is not: %r"
        % (bridge.SLOW_FIRST,))

    fleet = tmp_path / "fleet"
    for name in ("test_a.mjs", "test_b.mjs", "test_sandbox_boot.mjs",
                 "_helpers.mjs"):
        _write(fleet / "tests" / name, SIM_OK)
    _write(fleet / "tests" / "exams" / "run_7" / "test_a.mjs", SIM_OK)
    _write(fleet / "tests" / "exams" / "run_7" / "probe_x.mjs", SIM_OK)

    got = collect_sims(str(fleet))
    rel = _rel(fleet, got)

    assert rel == ["test_sandbox_boot.mjs", "exams/run_7/test_a.mjs",
                   "test_a.mjs", "test_b.mjs"], (
        "leg (a) [M1]: collect_sims returns the four sims, SLOW_FIRST first "
        "then alphabetical by path relative to <fleet_dir>/tests. Got %r"
        % (rel,))
    assert len(got) == 4, (
        "leg (a) [M1]: four paths — two files of the basename test_a.mjs in "
        "different directories are kept BOTH. Got %r" % (got,))
    for path in got:
        assert os.path.isfile(path), (
            "leg (a) [M1]: every returned entry is a path to the sim file "
            "itself. %r is not a file" % (path,))

    assert "_helpers.mjs" not in rel, (
        "leg (a) [M1]: a `_helpers.mjs` beside the sims is not a sim. Got %r"
        % (rel,))
    assert "exams/run_7/probe_x.mjs" not in rel, (
        "leg (a) [M1]: only `test_*.mjs` under exams/<slug>/ is a sim, so "
        "probe_x.mjs is absent. Got %r" % (rel,))


def test_collect_sims_on_a_tree_with_no_exams_directory(tmp_path):
    """leg (a) [M1]: the same tree without `exams/` returns the three others in
    the same order — the main-branch case, where the exams glob is empty."""
    collect_sims = _collect_sims()

    fleet = tmp_path / "fleet"
    for name in ("test_a.mjs", "test_b.mjs", "test_sandbox_boot.mjs",
                 "_helpers.mjs"):
        _write(fleet / "tests" / name, SIM_OK)
    assert not (fleet / "tests" / "exams").exists()

    rel = _rel(fleet, collect_sims(str(fleet)))
    assert rel == ["test_sandbox_boot.mjs", "test_a.mjs", "test_b.mjs"], (
        "leg (a) [M1]: with no exams/ directory collect_sims returns the three "
        "top-level sims in the same order. Got %r" % (rel,))


# --------------------------------------------------------------------------- #
# leg (b) [M2] — the bridge itself, byte-for-byte, on a tmp tree               #
# --------------------------------------------------------------------------- #
def _bridge_tree(tmp_path):
    """A tree carrying a byte-for-byte copy of the repository's
    `tests/test_fleet_suite.py` and `pytest.ini`, a dependency-free
    `fleet/package.json` beside an empty `fleet/node_modules/` (so the bridge's
    flocked `npm install` is a no-op), and three sims."""
    root = tmp_path / "tree"
    (root / "tests").mkdir(parents=True)
    shutil.copyfile(str(BRIDGE), str(root / "tests" / "test_fleet_suite.py"))
    shutil.copyfile(str(PYTEST_INI), str(root / "pytest.ini"))

    fleet = root / "fleet"
    (fleet / "node_modules").mkdir(parents=True)
    _write(fleet / "package.json",
           '{\n  "name": "exam-fleet",\n  "private": true\n}\n')
    _write(fleet / "tests" / "test_a.mjs", SIM_OK)
    _write(fleet / "tests" / "test_b.mjs", SIM_OK)
    _write(fleet / "tests" / "exams" / "run_7" / "test_a.mjs", SIM_OK)

    copied = (root / "tests" / "test_fleet_suite.py").read_bytes()
    assert copied == BRIDGE.read_bytes(), (
        "leg (b) [M2]: the tree carries a byte-for-byte copy of the "
        "repository's tests/test_fleet_suite.py")
    assert (root / "pytest.ini").read_bytes() == PYTEST_INI.read_bytes(), (
        "leg (b) [M2]: the tree carries a byte-for-byte copy of pytest.ini")
    return root


def test_bridge_ids_are_paths_relative_to_fleet_tests(tmp_path):
    """leg (b) [M2]: `--collect-only -q` on that tree lists the ids
    `exams/run_7/test_a.mjs`, `test_a.mjs`, `test_b.mjs` in that order."""
    root = _bridge_tree(tmp_path)
    p = _pytest(["--collect-only", "-q", "tests/test_fleet_suite.py"], root)
    assert p.returncode == 0, (
        "leg (b) [M2]: collection of the copied bridge succeeds. rc=%d\n%s%s"
        % (p.returncode, p.stdout, p.stderr))
    assert _ids(p.stdout) == ["exams/run_7/test_a.mjs", "test_a.mjs",
                              "test_b.mjs"], (
        "leg (b) [M2]: the parametrize ids are each path relative to "
        "fleet/tests/, exams first by alphabetical order. Got %r\n%s"
        % (_ids(p.stdout), p.stdout))


def test_bridge_runs_the_exam_sim_and_names_it_when_it_fails(tmp_path):
    """leg (b) [M2]: the same tree runs green with `4 passed` (three sims and
    `test_fleet_has_tests`); after the exam sim is rewritten to exit 1 without
    the sentinel, the same command exits non-zero and its summary names
    `exams/run_7/test_a.mjs` as the one failure."""
    root = _bridge_tree(tmp_path)
    exam_sim = root / "fleet" / "tests" / "exams" / "run_7" / "test_a.mjs"

    green = _pytest(["-q", "tests/test_fleet_suite.py"], root)
    assert green.returncode == 0, (
        "leg (b) [M2]: three green sims and test_fleet_has_tests exit 0. "
        "rc=%d\n%s%s" % (green.returncode, green.stdout, green.stderr))
    assert "4 passed" in _last_line(green.stdout), (
        "leg (b) [M2]: `4 passed` — the two top-level sims, the exams sim, and "
        "test_fleet_has_tests. Got %r\n%s"
        % (_last_line(green.stdout), green.stdout))

    exam_sim.write_text(SIM_RED)
    red = _pytest(["-q", "tests/test_fleet_suite.py"], root)
    assert red.returncode != 0, (
        "leg (b) [M2]: a red exam sim fails the suite. rc=%d\n%s%s"
        % (red.returncode, red.stdout, red.stderr))
    failed = [ln for ln in red.stdout.splitlines() if ln.startswith("FAILED")]
    assert len(failed) == 1, (
        "leg (b) [M2]: exactly one failure. Got %r\n%s" % (failed, red.stdout))
    assert "[exams/run_7/test_a.mjs]" in failed[0], (
        "leg (b) [M2]: the summary names exams/run_7/test_a.mjs as the one "
        "failure. Got %r" % (failed[0],))
    assert "1 failed" in _last_line(red.stdout), (
        "leg (b) [M2]: one failure and no other. Got %r"
        % (_last_line(red.stdout),))


# --------------------------------------------------------------------------- #
# leg (c) [M2] — the tree at hand, against a list computed from the globs      #
# --------------------------------------------------------------------------- #
def test_bridge_ids_on_this_tree_equal_the_globs_reordered():
    """leg (c) [M2]: `--collect-only -q` from the repository root prints ids
    that, in printed order, equal the list this test computes itself — not
    through `collect_sims` — from `glob('fleet/tests/test_*.mjs')` plus
    `glob('fleet/tests/exams/*/test_*.mjs')`, each relative to `fleet/tests/`,
    `SLOW_FIRST` members present first in `SLOW_FIRST` order then the rest
    sorted. `-p no:cacheprovider` only keeps the inner run from writing a cache
    into the repository; it does not touch collection."""
    p = _pytest(["--collect-only", "-q", "-p", "no:cacheprovider",
                 "tests/test_fleet_suite.py"], ROOT)
    assert p.returncode == 0, (
        "leg (c) [M2]: collection from the repository root succeeds. rc=%d\n"
        "%s%s" % (p.returncode, p.stdout, p.stderr))

    found = (glob.glob(str(FLEET_TESTS / "test_*.mjs"))
             + glob.glob(str(FLEET_TESTS / "exams" / "*" / "test_*.mjs")))
    expected = _expected_order(_rel(ROOT / "fleet", found))

    assert expected, "leg (c) [M2]: fleet/tests/ holds at least one sim"
    assert _ids(p.stdout) == expected, (
        "leg (c) [M2]: the printed ids, in printed order, are the two globs "
        "relative to fleet/tests/, SLOW_FIRST first then sorted.\nGot      %r\n"
        "Expected %r" % (_ids(p.stdout), expected))


def test_bridge_ids_are_plain_basenames_when_this_tree_has_no_exams():
    """leg (c) [M2]: the no-`exams/` case, read off the filesystem rather than
    assumed — the case at BASE — so a later branch that carries a run's exams
    keeps this leg green: no printed id contains `exams/`, and the list is
    exactly the `fleet/tests/test_*.mjs` basenames."""
    if (FLEET_TESTS / "exams").exists():
        pytest.skip("this tree carries a run's exams; leg (c)'s first half "
                    "grades that case")

    p = _pytest(["--collect-only", "-q", "-p", "no:cacheprovider",
                 "tests/test_fleet_suite.py"], ROOT)
    assert p.returncode == 0, (
        "leg (c) [M2]: collection from the repository root succeeds. rc=%d\n"
        "%s%s" % (p.returncode, p.stdout, p.stderr))
    ids = _ids(p.stdout)

    assert not [i for i in ids if "exams/" in i], (
        "leg (c) [M2]: with no fleet/tests/exams/ on the tree, no printed id "
        "contains `exams/`. Got %r" % ([i for i in ids if "exams/" in i],))
    basenames = [os.path.basename(x)
                 for x in glob.glob(str(FLEET_TESTS / "test_*.mjs"))]
    assert ids == _expected_order(basenames), (
        "leg (c) [M2]: the ids are exactly the fleet/tests/test_*.mjs "
        "basenames in the BASE order.\nGot      %r\nExpected %r"
        % (ids, _expected_order(basenames)))


# --------------------------------------------------------------------------- #
# leg (d) [M3] — the collector fact the reserved .py directory rests on        #
# --------------------------------------------------------------------------- #
def _dup_tree(root, with_init):
    """`tests/test_dup.py` and `tests/exams/run_7/test_dup.py`, one passing
    test each, under a byte-for-byte copy of the repository's `pytest.ini`."""
    (root / "tests" / "exams" / "run_7").mkdir(parents=True)
    shutil.copyfile(str(PYTEST_INI), str(root / "pytest.ini"))
    body = "def test_dup():\n    assert True\n"
    _write(root / "tests" / "test_dup.py", body)
    _write(root / "tests" / "exams" / "run_7" / "test_dup.py", body)
    if with_init:
        _write(root / "tests" / "exams" / "run_7" / "__init__.py", "")
    return root


def test_py_exam_beside_a_curated_file_of_one_basename_runs_both(tmp_path):
    """leg (d) [M3]: with `tests/exams/run_7/__init__.py` present,
    `python3 -m pytest` from the tree root exits 0 and its last line contains
    `2 passed` — both the curated file and the exam ran."""
    root = _dup_tree(tmp_path / "with_init", with_init=True)
    p = _pytest(["-q"], root)
    assert p.returncode == 0, (
        "leg (d) [M3]: the reserved .py exam collects beside a curated file of "
        "the same basename. rc=%d\n%s%s" % (p.returncode, p.stdout, p.stderr))
    assert "2 passed" in _last_line(p.stdout), (
        "leg (d) [M3]: BOTH tests run — `2 passed`. Got %r\n%s"
        % (_last_line(p.stdout), p.stdout))


def test_py_exam_without_the_package_marker_aborts_collection(tmp_path):
    """leg (d) [M3]: without the `__init__.py` the same tree exits non-zero —
    which is why the engine writes one into `tests/exams/<slug>/`."""
    root = _dup_tree(tmp_path / "no_init", with_init=False)
    assert not (root / "tests" / "exams" / "run_7" / "__init__.py").exists()
    p = _pytest(["-q"], root)
    assert p.returncode != 0, (
        "leg (d) [M3]: without tests/exams/run_7/__init__.py, collection of "
        "two test_dup.py modules does not succeed. rc=%d\n%s%s"
        % (p.returncode, p.stdout, p.stderr))
