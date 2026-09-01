"""The shape of the fleet mjs suite, read as text (#460, #385 items 4 and 5).

`tests/test_fleet_suite.py` schedules whole FILES under xdist, so the suite's
wall clock is pinned by its longest file — `test_drive.mjs` was 46.8 s of a
73 s wall. Splitting it is only worth doing if the split stays split, so the
invariants that keep it that way are pinned here rather than left to review:
where the 13-series lives, that no scenario was dropped on the way, and that
each of the three files still ends by announcing itself to the collector.

These legs read the files as text. They are deliberately not a substitute for
running them — `tests/test_fleet_suite.py` does that.
"""

import glob
import os
import re

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FLEET_TESTS = os.path.join(ROOT, "fleet", "tests")

# The glob `tests/test_fleet_suite.py:5` collects with. Kept literally equal to
# it so a change there that stops collecting a file surfaces here too.
SUITE_GLOB = os.path.join(ROOT, "fleet", "tests", "test_*.mjs")

SPLIT = ("test_drive.mjs", "test_drive_evidence.mjs", "test_drive_fitness.mjs")

# Leg (b)'s bound: a single file may hold at most this many `driveOne(` sites.
DRIVE_ONE_CAP = 10

# `test_drive_lifecycle.mjs` is the EARLIER split (#460) and predates this
# bound at 16 sites and a measured 25.8 s — nowhere near the 120 s per-file cap
# the bound exists to keep files away from. It is not this task's file, so it is
# pinned at its BASE count rather than exempted: it may not grow, and no other
# file may join it.
GRANDFATHERED = {"test_drive_lifecycle.mjs": 16}

# The count at BASE, when all of them lived in `test_drive.mjs`.
DRIVE_ONE_TOTAL_AT_BASE = 25


def _read(name):
    with open(os.path.join(FLEET_TESTS, name), encoding="utf-8") as handle:
        return handle.read()


def _drive_one_sites(text):
    return len(re.findall(r"driveOne\(", text))


def _blocks(text):
    """The scenario blocks: a line that is exactly `  {` through the next `  }`.

    Every scenario in the drive specs is one such block; nested braces are
    indented deeper, so the two-space form delimits them unambiguously.
    """
    lines = text.splitlines()
    out, start = [], None
    for i, line in enumerate(lines):
        if start is None:
            if line == "  {":
                start = i
        elif line == "  }":
            out.append("\n".join(lines[start : i + 1]))
            start = None
    return out


def test_a_three_files_exist_and_are_collected():
    collected = {os.path.basename(p) for p in glob.glob(SUITE_GLOB)}
    for name in SPLIT:
        assert os.path.isfile(os.path.join(FLEET_TESTS, name)), f"{name} must exist"
        assert name in collected, f"{name} must be collected by the suite glob"


@pytest.mark.parametrize(
    "path", sorted(glob.glob(SUITE_GLOB)), ids=lambda p: os.path.basename(p)
)
def test_b_no_file_holds_more_than_ten_drive_one_sites(path):
    name = os.path.basename(path)
    sites = _drive_one_sites(_read(name))
    if name in GRANDFATHERED:
        assert sites == GRANDFATHERED[name], (
            f"{name} is pinned at {GRANDFATHERED[name]} driveOne( sites; it may "
            f"not grow, got {sites}"
        )
        return
    assert sites <= DRIVE_ONE_CAP, (
        f"{name} holds {sites} driveOne( sites, over the cap of {DRIVE_ONE_CAP} "
        f"— split it, the way test_drive.mjs was split"
    )


def test_c_no_scenario_was_dropped():
    total = sum(_drive_one_sites(_read(name)) for name in SPLIT)
    assert total == DRIVE_ONE_TOTAL_AT_BASE, (
        f"the three files hold {total} driveOne( sites; BASE had "
        f"{DRIVE_ONE_TOTAL_AT_BASE} in test_drive.mjs alone"
    )


def test_d_every_docs_dir_the_fitness_file_mints_is_removed():
    text = _read("test_drive_fitness.mjs")
    seen = 0
    for block in _blocks(text):
        for expr in re.findall(r"mkdirSync\((.+?),\s*\{", block):
            if not expr.rstrip().endswith("'docs')"):
                continue
            seen += 1
            wanted = re.compile(
                r"rmSync\(\s*" + re.escape(expr) + r"\s*,\s*\{[^}]*recursive:\s*true"
            )
            assert wanted.search(block), (
                f"a block mkdirSync's {expr} without rmSync'ing it recursively "
                f"— it re-violates 13d's invariant:\n{block}"
            )
    assert seen >= 2, f"expected the 13-series' docs/ mkdirs to be found, got {seen}"


def test_e_the_gitattributes_pin_is_check_attr_on_the_plan_path():
    """The #362-4 pin asks `check-attr` of the scenario's plan path.

    `check-attr` is the same resolution the smudge itself uses, so it sees an
    untracked `.gitattributes`, `.git/info/attributes` and a global
    `core.attributesFile` — none of which the `git ls-files` read at BASE could.
    """
    text = _read("test_drive_fitness.mjs")
    lines = [line for line in text.splitlines() if "git check-attr -a --" in line]
    assert lines, "the .gitattributes pin must read `git check-attr -a --`"
    interpolated = [
        m.group(1) for m in (re.search(r"git check-attr -a -- \$\{(\w+)\}", l) for l in lines) if m
    ]
    assert interpolated, f"a pin must interpolate the plan path, got: {lines}"
    assert any(
        re.search(rf"planPath: {var}\b", text) for var in interpolated
    ), f"one of {interpolated} must be the scenario's plan path"


def test_e2_the_pin_still_reads_the_repository_a_live_drive_reads():
    """…and it asks it of the REAL checkout too, not only of the fixture.

    `setupDriveFixture()` builds its repo with `git init` under `fs.mkdtemp`, so
    a `check-attr` run there can only ever see that throwaway's attributes. The
    refusal #362-4 exists to pre-empt happens in the repository a live drive
    reads — a filter added to THIS repo's `.gitattributes` makes `git show
    <baseRef>:<plan>` return the raw blob against a smudged working tree, and
    every clean run refuses with `differs between …`. So the fixture-scoped pin
    above is necessary and not sufficient: the real-repo read is pinned here
    separately, and may be `check-attr` on the live plan paths, the `ls-files`
    blanket BASE carried, or both.
    """
    text = _read("test_drive_fitness.mjs")
    assert "new URL('../..', import.meta.url)" in text, (
        "the pin must resolve the real repository root from the spec's own "
        "location — the fixture repo is not the repo a live drive reads"
    )
    real = [
        line
        for line in text.splitlines()
        if "repoRoot)" in line and ("check-attr" in line or ".gitattributes" in line)
    ]
    assert real, (
        "no attribute read runs against the real repository root; a "
        "`.gitattributes` committed here would then break every live drive "
        "with nothing in the suite going red (#362-4)"
    )


def test_g_the_thirteen_series_lives_only_in_the_fitness_file():
    fitness = _read("test_drive_fitness.mjs")
    elsewhere = {
        name: _read(name) for name in SPLIT if name != "test_drive_fitness.mjs"
    }
    for marker in [f"13{suffix}." for suffix in "abcdefg"]:
        assert marker in fitness, f"{marker} must live in test_drive_fitness.mjs"
        for name, text in elsewhere.items():
            assert marker not in text, f"{marker} must not remain in {name}"


def test_f_each_file_announces_itself_to_the_collector():
    for name in SPLIT:
        assert "ALL TESTS PASSED" in _read(
            name
        ), f"{name} must end by printing the collector's sentinel"
