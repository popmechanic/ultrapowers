"""The one multiplier the suite's wall-clock deadlines scale by (#478).

A test that asserts a deadline was ENFORCED has to name a number, and any
number it names is a guess about the machine. The driver runs this suite three
to five times per run, under whatever concurrent load the fleet is generating,
so the guess is sampled precisely when it is least true. Widening a deadline
cannot make a correct test fail — it only costs wall time on the failure path,
which is the path that already means the run is in trouble.

The base durations stay in the specs, where they document what the case is
about; this module carries only the multiplier. `deadline_budget` multiplies
whatever unit it is handed — seconds here, milliseconds in the node half.

`fleet/tests/deadline-slack.mjs` is the same seam for the node suite. The two
files share no import, so they agree by pinned literal: same variable name,
same default. `tests/test_deadline_slack.py` holds that pin.

The name deliberately does not match `test_*.py`, so pytest does not collect
this module.
"""

import os

# The variable, exported by name so the cross-language pin reads it rather than
# re-typing it.
SLACK_ENV = "FLEET_TEST_SLACK"

# Four: enough headroom for a loaded sandbox's process spawn, cheap enough that
# a genuine hang is still caught in seconds rather than minutes.
DEFAULT_SLACK = 4


def slack():
    """The multiplier: the positive number in FLEET_TEST_SLACK, or 4."""
    try:
        parsed = float(os.environ.get(SLACK_ENV))
    except (TypeError, ValueError):
        return DEFAULT_SLACK
    if parsed <= 0:
        return DEFAULT_SLACK
    # An integral multiplier stays an int, so a budget handed whole seconds
    # comes back as whole seconds.
    return int(parsed) if parsed.is_integer() else parsed


def deadline_budget(base):
    """A wall-clock budget for a base duration, scaled to this machine."""
    return base * slack()
