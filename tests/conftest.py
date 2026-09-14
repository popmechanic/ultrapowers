"""Suite-wide collection order.

One thing lives here because it belongs to no single test file:

* `pytest_collection_modifyitems` — the fleet bridge goes to the FRONT.
  `--dist load` hands items to workers in collection order, so the file
  carrying the slowest items must start at t=0 or it becomes the straggler
  every other worker waits on.

The session-scoped synthetic-corpus fixture that used to sit beside it is
gone with the corpus itself: the tests that read it tested the grammar this
compiler no longer speaks.
"""
BRIDGE = "test_fleet_suite.py"


def pytest_collection_modifyitems(session, config, items):
    """Collect the fleet .mjs bridge first, everything else in its own order.

    A stable partition: the bridge's items keep their (slowest-first) order and
    so does the tail, so this only decides who starts at t=0.
    """
    bridge = [item for item in items if item.fspath.basename == BRIDGE]
    if bridge:
        items[:] = bridge + [item for item in items
                             if item.fspath.basename != BRIDGE]
