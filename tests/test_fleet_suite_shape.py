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

# The count at BASE, when all of them lived in `test_drive.mjs`, was 25. #575
# deleted the two #337 divergence scenarios (13c uncommitted, 13e `git show`
# chatter) with the `git show` that made them possible — the plan is a shipped
# file now, with no committed copy to diverge from — so the three files hold
# 24, and every one of the remaining scenarios is accounted for.
DRIVE_ONE_TOTAL_AT_BASE = 24


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


def test_d_every_plan_the_fitness_file_writes_lives_outside_the_engine_checkout():
    """13d's invariant, in its #575 form.

    The engine checkout must be CLEAN — that is the one refusal #575 added —
    so the fitness file may not mint a `docs/` dir inside `repoDir` any more:
    every plan it writes lives under the fixture's `plans/` dir beside the
    repos, and the file ends by asserting the checkout is still clean.
    """
    text = _read("test_drive_fitness.mjs")
    assert not re.search(r"mkdirSync\(path\.join\(repoDir", text), (
        "the fitness file writes into the engine checkout — a dirty checkout "
        "refuses to drive (#575), so its plans belong under plansDir"
    )
    assert not re.search(r"writeFileSync\(path\.join\(repoDir", text)
    assert "plansDir" in text, "the fitness file must keep its plans under a plansDir"
    assert "leaves the engine checkout clean" in text, (
        "the file must end by asserting `git status --porcelain` is empty in repoDir"
    )


# (test_e / test_e2 — the #362-4 `.gitattributes` pins — died with the `git show
# <baseRef>:<plan>` byte comparison they guarded. #575 ships the plan file's
# own bytes and reads nothing out of git, so a smudge filter has nothing to
# diverge from; the RUNBOOK's headless-fitness paragraph says so.)


def test_g_the_thirteen_series_lives_only_in_the_fitness_file():
    fitness = _read("test_drive_fitness.mjs")
    elsewhere = {
        name: _read(name) for name in SPLIT if name != "test_drive_fitness.mjs"
    }
    # 13c and 13e are gone (#575, see DRIVE_ONE_TOTAL_AT_BASE); the rest stay.
    for marker in [f"13{suffix}." for suffix in "abdfg"]:
        assert marker in fitness, f"{marker} must live in test_drive_fitness.mjs"
        for name, text in elsewhere.items():
            assert marker not in text, f"{marker} must not remain in {name}"


def test_f_each_file_announces_itself_to_the_collector():
    for name in SPLIT:
        assert "ALL TESTS PASSED" in _read(
            name
        ), f"{name} must end by printing the collector's sentinel"
