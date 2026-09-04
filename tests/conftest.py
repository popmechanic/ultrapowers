"""Suite-wide fixtures and collection order.

Two things live here because neither belongs to any one test file:

* `fixture_corpus` — ONE build of the synthetic fold corpus per session. The
  builder drives the real kernel CLI, so a build costs seconds, and four test
  modules want the same read-only bytes; at module scope they paid for it four
  times over (the audit's point 5). Each module now derives what it needs —
  a wave index, a replay — in a thin module-scoped wrapper of its own.
* `pytest_collection_modifyitems` — the fleet bridge goes to the FRONT.
  `--dist load` hands items to workers in collection order, so the file
  carrying the slowest items must start at t=0 or it becomes the straggler
  every other worker waits on.
"""
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "evals" / "frontier"))
import corpuslib  # noqa: E402

BRIDGE = "test_fleet_suite.py"


@pytest.fixture(scope="session")
def fixture_corpus(tmp_path_factory):
    """`(repo, corpus)` — one build of the fixture corpus for the whole session.

    Under a pytest tmp dir, never a checked-in fixture directory, so the suite
    still owns every byte it writes. Shared READ-ONLY: a test that damages a
    corpus copies it first (`test_arm_weave._copy_corpus`).
    """
    dest = tmp_path_factory.mktemp("fold-corpus")
    return corpuslib.make_fixture_corpus(dest)


def pytest_collection_modifyitems(session, config, items):
    """Collect the fleet .mjs bridge first, everything else in its own order.

    A stable partition: the bridge's items keep their (slowest-first) order and
    so does the tail, so this only decides who starts at t=0.
    """
    bridge = [item for item in items if item.fspath.basename == BRIDGE]
    if bridge:
        items[:] = bridge + [item for item in items
                             if item.fspath.basename != BRIDGE]
