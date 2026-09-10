/**
 * fleet/tests/test_sandbox_boot_parked_error.mjs — Task 1's boot half: the
 * parked cell of a run with nothing ahead of base names the failing tests.
 *
 * The exam is written against the task's Machine clause, leg by leg; every
 * assertion names the leg it belongs to and the clause it comes from, so a
 * reader can map this file back to the contract:
 *
 *   M6  after the boot script parks a run whose branch has no commits ahead of
 *       base, `status.json.error` STILL begins
 *       `parked: <branch> has no commits ahead of base (verdict <verdict>)`
 *       and, when `<run dir>/acceptance.log` exists and carries a failure line,
 *       CONTINUES with ` — ` and the failing test's own block cut from that
 *       file; when the file is absent the cell is exactly BASE's sentence.
 *
 * Both arms are the rig's nothing-ahead scenario — `STUB_NO_COMMITS=1`, which
 * makes the `git` stub answer `rev-list --count ^<base> <branch>` with 0 — and
 * they differ in one thing only: whether `<run dir>/acceptance.log` was seeded
 * before the boot. The run directory is where the boot script's own
 * `run_dir_path` points (`<target clone>/.claude/ultrapowers/run-<RUN_ID>`),
 * which is what the rig's `runDir(ctx)` names and where the engine stub writes
 * its receipt.
 *
 * "The failing test's own block" is not this exam's invention: it is
 * `failingBlock` from `fleet/failing-block.mjs`, the module the boot script's
 * POSIX-awk `failing_block` is required to agree with line for line. So the
 * expected cell is computed by that module from the same seeded text, which is
 * a check a whole-file dump or a fixed-length tail does not pass.
 *
 * No network, no systemd, no real `claude`: every call is a stub in
 * `FLEET_BIN_DIR` and every path is under `FLEET_HOME`.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import { failingBlock } from '../failing-block.mjs'
import {
  INTEGRATION_BRANCH, TARGET,
  makeHome, boot, statusOf, states, notifies, prPosts, runDir,
  runTests,
} from './_sandbox_boot_helpers.mjs'

// ── the fixture ──────────────────────────────────────────────────────────────
//
// A pytest-shaped acceptance log whose failing test's block sits in the middle:
// above it the session header the run always prints, below it the short summary
// that ENDS the block. A tail of this file quotes the summary and a head quotes
// the collection line; only the block quotes `test_x`'s own failure.

const ACCEPTANCE_TEXT = [
  '============================= test session starts ==============================',
  'platform linux -- Python 3.12.3, pytest-8.2.0',
  'collected 2 items',
  '',
  'tests/test_x.py .F                                                       [100%]',
  '',
  '=================================== FAILURES ===================================',
  '___________________________________ test_x _____________________________________',
  '',
  '    def test_x():',
  '>       assert 1 == 2',
  'E       assert 1 == 2',
  '',
  'tests/test_x.py:4: AssertionError',
  '=========================== short test summary info ============================',
  'FAILED tests/test_x.py::test_x - assert 1 == 2',
  '1 failed, 1 passed in 0.03s',
  '',
].join('\n')

// The same run's log when BASE was GREEN — the classic nothing-ahead park, where
// every task was blocked and the gate's acceptance suite passed on a branch equal
// to BASE. The gate tees this file unconditionally, so it is on disk with no
// failure line anywhere in it: there is no block to cut, and a caller that asks
// `failing_block` anyway is handed the WHOLE file back by documented design.
const GREEN_ACCEPTANCE_TEXT = [
  '============================= test session starts ==============================',
  'platform linux -- Python 3.12.3, pytest-8.2.0',
  'collected 2 items',
  '',
  'tests/test_x.py ..                                                       [100%]',
  '',
  '============================== 2 passed in 0.03s ===============================',
  '',
].join('\n')

/** The block the boot script's `failing_block` has to cut out of it. */
const EXPECTED_BLOCK = failingBlock(ACCEPTANCE_TEXT).trimEnd()

/** BASE's sentence, with the verdict both arms run under. */
const VERDICT = 'NEEDS_ACK'
const SENTENCE =
  `parked: ${INTEGRATION_BRANCH} has no commits ahead of base (verdict ${VERDICT})`

/** The nothing-ahead park, with `acceptance.log` seeded or not. */
const parkedRun = (acceptanceText) => {
  const ctx = makeHome()
  if (acceptanceText !== null) {
    fs.mkdirSync(runDir(ctx), { recursive: true })
    fs.writeFileSync(path.join(runDir(ctx), 'acceptance.log'), acceptanceText)
  }
  const r = boot(ctx, ['boot'], { STUB_VERDICT: VERDICT, STUB_NO_COMMITS: '1' })
  assert.equal(r.status, 0, r.stdout + r.stderr)
  return ctx
}

const tests = []
const test = (name, fn) => tests.push([name, fn])

// ── (f) the seeded arm: the sentence, then the failing test's own block [M6] ─
test('the parked cell carries the failing block of acceptance.log  [M6 / leg (f)]', () => {
  const ctx = parkedRun(ACCEPTANCE_TEXT)

  assert.deepEqual(states(ctx), ['booting', 'running', 'parked'],
    'leg (f) [M6]: the run still parks — the cell is the only thing that changed')
  const status = statusOf(ctx)
  assert.equal(status.state, 'parked', 'leg (f) [M6]: state=parked')

  assert.match(status.error,
    /^parked: ultra\/integration-run-7 has no commits ahead of base \(verdict [A-Z_]+\) — /,
    'leg (f) [M6]: the cell BEGINS with BASE\'s sentence and continues with " — ": ' +
    JSON.stringify(status.error))
  assert.ok(status.error.includes('test_x'),
    'leg (f) [M6]: and it names the failing test: ' + JSON.stringify(status.error))

  // …and what follows the dash is the failing test's own BLOCK, not the file:
  // the same cut `fleet/failing-block.mjs` makes, which is the rule the boot
  // script's awk is written to.
  assert.equal(status.error.trimEnd(), SENTENCE + ' — ' + EXPECTED_BLOCK,
    'leg (f) [M6]: the cell is BASE\'s sentence, " — ", and the failing test\'s own block ' +
    'cut from acceptance.log — a whole-file dump or a fixed-length tail is not that block: ' +
    JSON.stringify(status.error))
  assert.ok(!status.error.includes('collected 2 items'),
    'leg (f) [M6]: the preamble above the block is not quoted: ' + JSON.stringify(status.error))
  assert.ok(!status.error.includes('short test summary info'),
    'leg (f) [M6]: nor the summary that ends it: ' + JSON.stringify(status.error))

  assert.equal(status.pr, null, 'leg (f) [M6]: nothing was published')
  assert.equal(prPosts(ctx).length, 0, 'leg (f) [M6]: no PR is attempted')
  assert.deepEqual(notifies(ctx),
    [{ title: 'run-7 parked', message: `${TARGET} — nothing ahead of base` }],
    'leg (f) [M6]: the notification is unchanged from BASE')
})

// ── (f) the bare arm: no acceptance.log, exactly BASE's sentence [M6] ────────
test('with no acceptance.log the parked cell is exactly BASE\'s sentence  [M6 / leg (f)]', () => {
  const ctx = parkedRun(null)

  assert.ok(!fs.existsSync(path.join(runDir(ctx), 'acceptance.log')),
    'leg (f) [M6]: this arm really has no acceptance.log')
  const status = statusOf(ctx)
  assert.equal(status.state, 'parked', 'leg (f) [M6]: state=parked')
  assert.equal(status.error, SENTENCE,
    'leg (f) [M6]: with the file absent the cell is exactly BASE\'s sentence — no trailing ' +
    'dash, no empty quotation: ' + JSON.stringify(status.error))
  assert.equal(status.pr, null, 'leg (f) [M6]: nothing was published')
})

// ── (f) the green arm: a log with no failure line quotes nothing [M6] ────────
//
// The third state M6 names: the file EXISTS but carries no failure line. This is
// the common park — every task blocked, the branch equal to BASE, BASE green —
// and it is the one where quoting without asking pastes a whole passing suite
// into the cell.
test('a green acceptance.log leaves the parked cell exactly BASE\'s sentence  [M6 / leg (f)]', () => {
  const ctx = parkedRun(GREEN_ACCEPTANCE_TEXT)

  assert.equal(
    fs.readFileSync(path.join(runDir(ctx), 'acceptance.log'), 'utf8'),
    GREEN_ACCEPTANCE_TEXT,
    'leg (f) [M6]: this arm really has a green acceptance.log on disk')
  const status = statusOf(ctx)
  assert.equal(status.state, 'parked', 'leg (f) [M6]: state=parked')
  assert.equal(status.error, SENTENCE,
    'leg (f) [M6]: the log exists but carries no failure line, so there is no block to ' +
    'quote — a boot that pastes the whole green log into the cell fails here: ' +
    JSON.stringify(status.error))
  assert.ok(!status.error.includes('2 passed'),
    'leg (f) [M6]: and nothing of the green summary reaches the page: ' +
    JSON.stringify(status.error))
  assert.equal(status.pr, null, 'leg (f) [M6]: nothing was published')
})

runTests(tests)
