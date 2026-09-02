// fleet/tests/deadline-slack.mjs — the one multiplier the suite's wall-clock
// deadlines scale by (#478).
//
// A test that asserts a deadline was ENFORCED has to name a number, and any
// number it names is a guess about the machine. The driver runs this suite
// three to five times per run, under whatever concurrent load the fleet is
// generating, so the guess is sampled precisely when it is least true: 400 ms
// is shorter than a node process spawn on a loaded sandbox. Widening a deadline
// cannot make a correct test fail — it only costs wall time on the failure
// path, which is the path that already means the run is in trouble.
//
// The base durations stay in the specs, where they document what the case is
// about. This module carries only the multiplier, so a machine can be told it
// is fast (`FLEET_TEST_SLACK=1`) or slow (`FLEET_TEST_SLACK=16`) in one place.
//
// tests/deadline_slack.py is the same seam for the python suite. The two files
// share no import, so they agree by pinned literal: same variable name, same
// default. tests/test_deadline_slack.py holds that pin.
//
// The name deliberately does not match `test_*.mjs`, so tests/test_fleet_suite
// .py does not collect this module as a suite file.

// The variable, exported by name so the cross-language pin reads it rather than
// re-typing it.
export const SLACK_ENV = 'FLEET_TEST_SLACK'

// Four: enough headroom for a loaded sandbox's process spawn, cheap enough that
// a genuine hang is still caught in seconds rather than minutes.
export const DEFAULT_SLACK = 4

/** The multiplier: the positive number in FLEET_TEST_SLACK, or 4. */
export function slack() {
  const parsed = Number(process.env[SLACK_ENV])
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SLACK
}

/** A wall-clock budget for a base duration, scaled to this machine. */
export function deadlineBudget(ms) {
  return ms * slack()
}
