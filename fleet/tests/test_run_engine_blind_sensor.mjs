// fleet/tests/test_run_engine_blind_sensor.mjs — Task 4: a red base names its
// failing test and says the sensor is blind.
//
// The exam is written against the task's Machine clauses, leg by leg; every
// assertion names the leg it belongs to and the clause it comes from, so a
// reader can map this file back to the contract:
//
//   M1  the red-baseline park's `blockedWaves` detail and its judgment call
//       each BEGIN `baseline: the suite is RED on BASE` and CONTINUE
//       ` — the sensor is blind for this run; failing: <paths>`, where
//       `<paths>` is the comma-joined list of `FAILED <path>::…` paths read
//       from the baseline output (or `unparsed` when there is none), followed
//       by the failing block as today.
//   M2  no implementer worker is dispatched on a run whose baseline is red and
//       settles within the head start: the stream carries no `impl:` label and
//       every task is listed in `unfinished` as `never dispatched`.
//
// Legs: (a) M1 with two failing paths, in the order the output printed them;
// (b) M1 with a red suite that printed no `FAILED` line — `unparsed`;
// (c) M2 on the (a) run.
//
// The instrument is the engine's own report plus the recording stub's label
// stream: the park's `detail` and `judgmentCalls` are read as strings and
// compared against the clause's own words, and the dispatch stream is the list
// of labels the agent seam was called with. Both runs are red on BASE the
// instant the suite is asked, so the baseline settles inside the run's head
// start and the park happens before anyone is dispatched — which is the arm
// M2 is about and the arm M1's two readers are written on.
//
// The exact prefix is spelled ONCE here and used by every leg: `RED_PREFIX` is
// the byte-for-byte opening two sibling sims already pin with `startsWith`
// (`test_run_engine_early_baseline.mjs`, `test_run_engine_baseline.mjs`), and
// `BLIND` is the continuation M1 adds after it.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { makeRepo, rig, passReview, cleanCritic, doneImpl } from './_engine_helpers.mjs'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-blind-sensor-'))

/** The opening the park has today and keeps byte for byte [M1]. */
const RED_PREFIX = 'baseline: the suite is RED on BASE'
/** What M1 makes it continue with, up to the paths themselves. */
const BLIND = ' — the sensor is blind for this run; failing: '

// Leg (a)'s suite: red on BASE, naming two failing tests in this order. The
// preamble line opens no failure block and closes none, so the paths are the
// same two whether they are read off the raw output or off the failing block
// cut from it — this exam grades the phrase, not the scan that built it.
const Z_LINE = 'FAILED tests/test_z.py::t - AssertionError: z is red at BASE'
const W_LINE = 'FAILED tests/test_w.py::u - AssertionError: w is red at BASE'
const TWO_PATHS_SH =
  '#!/bin/bash\n' +
  'printf "%s\\n" "running the suite on this tree"\n' +
  'printf "%s\\n" ' + JSON.stringify(Z_LINE) + '\n' +
  'printf "%s\\n" ' + JSON.stringify(W_LINE) + '\n' +
  'exit 1\n'

// Leg (b)'s suite: red, and printing not one `FAILED <path>::…` line for a
// reader to name.
const NO_PATH_LINE = 'not ok 1 - the suite is red at BASE and named no path'
const NO_PATHS_SH =
  '#!/bin/bash\n' +
  'printf "%s\\n" ' + JSON.stringify(NO_PATH_LINE) + '\n' +
  'exit 1\n'

const scenario = (name, checkSh) => {
  const dir = path.join(tmp, name)
  const repo = makeRepo(path.join(dir, 'repo'), { 'check.sh': checkSh })
  return { repo, runDir: path.join(dir, 'run') }
}

const task = (id) => ({
  id, title: 'task ' + id, files: [id + '.txt'], tier: 'standard', review: 'lean',
  writes: [id + '.txt'], commutes: [], body: 'sim task ' + id,
})

// One recording stub for every leg: it remembers each dispatch (label, cwd) and
// answers with the canned judgment for that kind. Every arm the engine could
// take is answered — a leg that asserts "no `impl:` was called" has to report
// the call it saw, not die inside the stub.
const recording = () => {
  const calls = []
  const stub = (prompt, opts, cwd) => {
    calls.push({ label: String(opts.label), prompt, cwd })
    const kind = String(opts.label).split(':')[0]
    if (kind === 'impl') {
      const id = String(opts.label).split(':')[1]
      fs.writeFileSync(path.join(cwd, id + '.txt'), 'from ' + id + '\n')
      return doneImpl(cwd)
    }
    if (kind === 'review' || kind === 'fix') return passReview()
    if (kind === 'reconcile') {
      return { status: 'BLOCKED', summary: 'sim: this leg expects no reconcile' }
    }
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch ' + opts.label)
  }
  const labels = () => calls.map((c) => c.label)
  const startingWith = (prefix) => labels().filter((l) => l.startsWith(prefix))
  return { stub, labels, startingWith }
}

/** The one judgment call the red baseline made, or a message naming what was
 *  there instead — the clause is about THE park's judgment call. */
const redBaselineCall = (report, where) => {
  const calls = (report.judgmentCalls || []).map(String)
  const mine = calls.filter((c) => c.startsWith(RED_PREFIX))
  assert.equal(mine.length, 1,
    where + ': exactly one judgment call begins "' + RED_PREFIX + '" — the park\'s own: ' +
    JSON.stringify(calls))
  return mine[0]
}

/** The park's blockedWaves entry — the first one a parked run records. */
const parkEntry = (report, where) => {
  const blocked = report.blockedWaves || []
  assert.ok(blocked.length >= 1,
    where + ': the run parked and recorded a blockedWaves entry: ' + JSON.stringify(blocked))
  assert.equal(typeof blocked[0].detail, 'string',
    where + ': that entry carries a string detail: ' + JSON.stringify(blocked[0]))
  return blocked[0]
}

/** Both readers of M1's phrase, held to the same expected opening. */
const bothReadersBegin = (report, expected, where) => {
  const detail = parkEntry(report, where).detail
  const call = redBaselineCall(report, where)
  for (const [what, text] of [['blockedWaves[0].detail', detail], ['the judgment call', call]]) {
    assert.ok(text.startsWith(expected),
      where + ': ' + what + ' BEGINS ' + JSON.stringify(expected) + ' — the phrase, the paths and ' +
      'their order are all part of that opening, and a detail missing any of them is not this ' +
      'clause. Got ' + JSON.stringify(text))
    // The list ENDS with the paths M1 read: what follows the opening opens the
    // failing block, it does not append a third path to the list.
    const after = text.slice(expected.length)
    assert.doesNotMatch(after, /^\s*,/,
      where + ': ' + what + '\'s `failing:` list is exactly the comma-joined paths the output ' +
      'named, with nothing appended after them: ' + JSON.stringify(after.slice(0, 120)))
    // "followed by the failing block as today" — `baseline.output` is that
    // block, and it is quoted after the opening, not in place of it.
    const block = String(report.baseline.output)
    const at = text.indexOf(block)
    assert.ok(at >= expected.length,
      where + ': ' + what + ' carries the failing block (report.baseline.output) AFTER that ' +
      'opening, as today: block ' + JSON.stringify(block) + ' in ' + JSON.stringify(text))
  }
  return { detail, call }
}

// ── (a) two failing paths, named in the order the output printed them [M1] ───
// Leg (c) rides on this same run: [M2] is about a baseline that settles red
// within the head start, which is this suite.
{
  const { repo, runDir } = scenario('a', TWO_PATHS_SH)
  const rec = recording()
  const { run } = rig({
    repo, runDir, waves: [[task('T1'), task('T2')]], edges: [], stub: rec.stub, stamp: 'bs-a',
  })
  const report = await run()
  const where = 'leg (a) [M1]'

  // The run parked on the red it inherited — the state both readers describe.
  assert.equal(report.baseline.passed, false,
    where + ': the suite was RED on BASE: ' + JSON.stringify(report.baseline))
  assert.equal(report.waveMerges[0].status, 'TEST_FAILED',
    where + ': wave 1 is TEST_FAILED — the run parked: ' + JSON.stringify(report.waveMerges))

  const expected = RED_PREFIX + BLIND + 'tests/test_z.py, tests/test_w.py'
  const { detail } = bothReadersBegin(report, expected, where)

  // The paths are the FILES the `FAILED <path>::…` lines named, not the whole
  // node ids: a park that quoted `tests/test_z.py::t` fails the opening above,
  // and this line says why in its own words.
  assert.equal(detail.slice(0, expected.length), expected,
    where + ': the opening is exactly ' + JSON.stringify(expected) + ' — the comma-joined ' +
    'FAILED paths, `tests/test_z.py` before `tests/test_w.py` as the output printed them: ' +
    JSON.stringify(detail.slice(0, expected.length + 40)))

  // ── (c) nobody is dispatched at a repository that was already red [M2] ─────
  assert.deepEqual(rec.startingWith('impl:'), [],
    'leg (c) [M2]: the stream carries no `impl:` label — the baseline settled red inside the ' +
    'head start, so not one implementer was dispatched: ' + JSON.stringify(rec.labels()))
  const unfinished = (report.unfinished || []).map(String)
  for (const id of ['T1', 'T2']) {
    const mine = unfinished.filter((u) => u.startsWith(id + ':'))
    assert.equal(mine.length, 1,
      'leg (c) [M2]: task ' + id + ' is listed in `unfinished`: ' + JSON.stringify(unfinished))
    assert.ok(mine[0].includes('never dispatched'),
      'leg (c) [M2]: and listed as `never dispatched`: ' + JSON.stringify(mine[0]))
  }
}

// ── (b) a red suite that named no path at all: `unparsed` [M1] ───────────────
{
  const { repo, runDir } = scenario('b', NO_PATHS_SH)
  const rec = recording()
  const { run } = rig({
    repo, runDir, waves: [[task('T1')]], edges: [], stub: rec.stub, stamp: 'bs-b',
  })
  const report = await run()
  const where = 'leg (b) [M1]'

  assert.equal(report.baseline.passed, false,
    where + ': the suite exited 1 on BASE: ' + JSON.stringify(report.baseline))
  assert.ok(!String(report.baseline.output).includes('FAILED'),
    where + ': and its output carries no `FAILED` line for a reader to name: ' +
    JSON.stringify(report.baseline.output))

  const expected = RED_PREFIX + BLIND + 'unparsed'
  const { detail } = bothReadersBegin(report, expected, where)
  assert.equal(detail.slice(0, expected.length), expected,
    where + ': a red output with no `FAILED <path>::…` line is named `unparsed` — the sensor ' +
    'still says it is blind, and says it read nothing: ' +
    JSON.stringify(detail.slice(0, expected.length + 40)))
  assert.deepEqual(rec.startingWith('reconcile:'), [],
    where + ': and the run reconciles nothing against the red it inherited: ' +
    JSON.stringify(rec.labels()))
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log('ALL TESTS PASSED')
