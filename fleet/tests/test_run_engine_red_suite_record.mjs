// fleet/tests/test_run_engine_red_suite_record.mjs — #763 part (2), Task 2:
// the engine quotes the failing test's own BLOCK wherever it quoted a tail.
//
// The claim: after a run whose suite went red — on BASE, or on a wave's folded
// candidate — the judgment call, the parked or blocked wave's detail, the
// reconcile agent's brief and `suiteLine`'s section each quote the failing
// test's own block and so name the failing leg; and a run whose suite stayed
// green records exactly what it recorded before.
//
// How every leg tells a block from a tail, without knowing how the engine cut
// it: the rig's `check.sh` prints a pytest-shaped failure and then PADS. The
// failure block is ~190 characters near the TOP of the output; the padding is
// forty lines of `PADDING-` + one hundred `x` (4,300+ characters) at the
// BOTTOM. Every tail the engine took at BASE — 2000 for the baseline record,
// 3000 for the reconcile brief, 800 for the blocked wave's detail, 500 for the
// judgment call, the critic brief and `suiteLine` — is SHORTER than the
// padding, so a tail is all padding: it carries `PADDING-` and cannot carry the
// leg-naming line. A block carries the leg-naming line and no `PADDING-`. The
// two are therefore distinguishable by content alone, at every site, without
// the exam pinning a cut length or naming `failingBlock`.
//
// The leg-naming line the legs search for is the literal
// `the recorded text names the failing leg`; the padding marker is `PADDING-`.
//
// Pattern and rig are `test_run_engine_baseline.mjs`'s: `makeRepo(dir, {
// 'check.sh': … })` replaces the helper's plain BROKEN-rule script, the agent
// seam is stubbed, everything below it is real. Each scenario gets its own
// `mkdtemp` directory and its own `stamp`; no ports, no shared fixtures.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { makeRepo, rig, passReview, cleanCritic, doneImpl } from './_engine_helpers.mjs'
import { suiteLine } from '../run-engine.mjs'

// ── the fixture: one red suite output, pytest-shaped, with a padded tail ─────

// The FAILURES header of the failing test's own block — the `___ name ___` line
// pytest prints under `=== FAILURES ===` for each failure, and the line
// `failing-block.mjs`'s START matches (the section rule `=== FAILURES ===` is
// not a failure opener, so a block begins here).
const FAILURE_HEADER = '___ test_fleet_mjs[test_sim.mjs] ___'
// The line that names the failing leg — inside the block, far from the tail.
const LEG_LINE = 'the recorded text names the failing leg'
// The marker every fixed-length tail of this output keeps.
const PADDING_MARKER = 'PADDING-'

const RED_BODY = [
  'bringing up nodes...',
  '..F',
  '=== FAILURES ===',
  FAILURE_HEADER,
  '[gw1] linux -- Python 3.12',
  'E   AssertionError: scenario a ran',
  'E     AssertionError [ERR_ASSERTION]: leg (b) [M2]: ' + LEG_LINE,
  '=== short test summary info ===',
  'FAILED tests/test_fleet_suite.py::test_fleet_mjs[test_sim.mjs] - AssertionError',
  '1 failed, 2 passed in 0.24s',
]
const PADDING_LINES = Array.from({ length: 40 }, () => PADDING_MARKER + 'x'.repeat(100))
const RED_OUTPUT = RED_BODY.concat(PADDING_LINES).join('\n')
const GREEN_OUTPUT = 'green suite output\n'

// Red by the BROKEN rule, printing the shape above; green otherwise, printing
// one known line. The heredoc delimiter is quoted, so the body is emitted byte
// for byte with no shell expansion.
const CHECK_SH =
  '#!/bin/bash\n' +
  'if [ -f BROKEN ]; then\n' +
  "  cat <<'RED_EOF'\n" +
  RED_OUTPUT + '\n' +
  'RED_EOF\n' +
  '  exit 1\n' +
  'fi\n' +
  "echo 'green suite output'\n"

// The fixture's own premise, asserted rather than asserted-about: every tail
// the engine took at BASE lands strictly inside the padding. If this block ever
// fails, the legs below are measuring nothing and must be re-cut.
{
  const padding = PADDING_LINES.join('\n')
  assert.ok(padding.length > 3000,
    'fixture: the padding (' + padding.length + ' chars) is longer than every tail the ' +
    'engine took at BASE (2000, 3000, 800, 500) — otherwise a tail could still carry the block')
  for (const n of [2000, 3000, 800, 500]) {
    const t = RED_OUTPUT.slice(-n)
    assert.ok(t.includes(PADDING_MARKER),
      'fixture: a ' + n + '-char tail of the red output carries ' + PADDING_MARKER)
    assert.ok(!t.includes(LEG_LINE),
      'fixture: a ' + n + '-char tail of the red output has LOST the leg-naming line')
  }
  assert.ok(RED_OUTPUT.includes(LEG_LINE) && RED_OUTPUT.includes(FAILURE_HEADER),
    'fixture: the whole red output carries both the header and the leg-naming line')
}

const tmpDirs = []
const scenario = (name, files = {}) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-red-record-' + name + '-'))
  tmpDirs.push(dir)
  const repo = makeRepo(path.join(dir, 'repo'), { 'check.sh': CHECK_SH, ...files })
  return { repo, runDir: path.join(dir, 'run') }
}

// `proofTests` names the very path the fixture output above fails —
// `tests/test_fleet_suite.py::test_fleet_mjs[test_sim.mjs]` is the bridge's
// spelling of `fleet/tests/test_sim.mjs` — so this task NAMES the red and the
// candidate stays on the reconcile route (#871). A red no task of the wave
// names is adopted and recorded instead, and the scenarios below are about the
// records a reconciled and a parked run leave.
const task = (id) => ({
  id, title: 'task ' + id, files: [id + '.txt'], tier: 'standard', review: 'lean',
  writes: [id + '.txt'], proofTests: ['fleet/tests/test_sim.mjs'], commutes: [],
  body: 'sim task ' + id,
})

// ── (i) BASE itself red → legs (a) and (b) [M1, M2] ──────────────────────────
// `BROKEN` is committed at BASE, so the baseline the driver reads in Setup is
// red and the run PARKS on it (#862): no candidate is folded and no reconcile is
// dispatched. What this scenario reads is therefore the two records a parked run
// leaves — the baseline's own, and the wave's `detail` — and each must carry the
// failing test's own block rather than a tail.
{
  const { repo, runDir } = scenario('i', { BROKEN: 'red at BASE\n' })
  // Whoever the engine dispatches is recorded rather than refused: this
  // scenario reads the RECORDS a parked run leaves, and the one dispatch it
  // asserts about is the reconcile that must not happen.
  const labels = []
  const stub = (prompt, opts, cwd) => {
    labels.push(opts.label)
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') {
      fs.writeFileSync(path.join(cwd, 'T1.txt'), 'useful work\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('scenario (i): unexpected dispatch ' + opts.label)
  }
  const { run } = rig({ repo, runDir, waves: [[task('T1')]], stub, stamp: 'rr-i' })
  const report = await run()

  assert.equal(report.waveMerges[0].status, 'TEST_FAILED',
    'scenario (i) precondition: a red baseline parks the wave — ' +
    JSON.stringify(report.judgmentCalls))
  assert.ok(report.baseline && report.baseline.passed === false,
    'scenario (i) precondition: the baseline ran and BASE was RED — ' +
    JSON.stringify(report.baseline))

  // ── leg (a): the baseline record is the block [M1] ────────────────────────
  const out = report.baseline.output
  assert.ok(out.startsWith(FAILURE_HEADER),
    'leg (a) [M1]: report.baseline.output BEGINS with the FAILURES header line ' +
    JSON.stringify(FAILURE_HEADER) + ' — an engine that records a 2000-character tail begins ' +
    'mid-padding instead. Got: ' + JSON.stringify(out.slice(0, 120)))
  assert.ok(out.includes(LEG_LINE),
    'leg (a) [M1]: report.baseline.output CONTAINS the leg-naming line ' +
    JSON.stringify(LEG_LINE) + ' — a 2000-character tail of this output has lost it')
  assert.ok(!out.includes(PADDING_MARKER),
    'leg (a) [M1]: report.baseline.output contains no ' + JSON.stringify(PADDING_MARKER) +
    ' — a tail of any length the engine took at BASE is all padding')

  // ── leg (b): the judgment call and the critic's brief [M2] ────────────────
  // The opening is pinned by its prefix alone — `baseline: the suite is RED on
  // BASE` — and not by the punctuation that follows it: the sentence continues
  // with the blind-sensor clause and the failing paths before it quotes the
  // block, and this leg is about WHICH text the block is (a block, not a tail),
  // not about the words that introduce it.
  const redCalls = report.judgmentCalls.filter(
    (j) => String(j).startsWith('baseline: the suite is RED on BASE'))
  assert.equal(redCalls.length, 1,
    'leg (b) [M2]: exactly one judgmentCalls entry starts with "baseline: the suite is RED ' +
    'on BASE" — ' + JSON.stringify(report.judgmentCalls))
  assert.ok(redCalls[0].includes(LEG_LINE),
    'leg (b) [M2]: that judgment call CONTAINS the leg-naming line — ' +
    JSON.stringify(redCalls[0]))
  assert.ok(!redCalls[0].includes(PADDING_MARKER),
    'leg (b) [M2]: that judgment call contains no ' + JSON.stringify(PADDING_MARKER) + ' — ' +
    JSON.stringify(redCalls[0]))

  // The parked wave's own record. A run that parks on BASE's red dispatches no
  // reconcile at all — there is no candidate to reconcile — so the second reader
  // of the block is the wave's `detail`, and it quotes the block for the same
  // reason the judgment call does: whoever reads the report must see WHICH leg
  // was already failing, not forty lines of padding.
  assert.equal(labels.filter((l) => l.startsWith('reconcile:')).length, 0,
    'leg (b) [M2]: no reconcile agent is dispatched against a red BASE — ' +
    JSON.stringify(labels))
  const detail = String(report.waveMerges[0].detail)
  assert.ok(detail.startsWith('baseline: the suite is RED on BASE'),
    'leg (b) [M2]: the parked wave\'s detail BEGINS "baseline: the suite is RED on BASE" — ' +
    JSON.stringify(detail.slice(0, 120)))
  assert.ok(detail.includes(LEG_LINE),
    'leg (b) [M2]: the parked wave\'s detail CONTAINS the leg-naming line — a detail cut ' +
    'as a tail of this output has lost it: ' + JSON.stringify(detail.slice(0, 200)))
  assert.ok(!detail.includes(PADDING_MARKER),
    'leg (b) [M2]: the parked wave\'s detail contains no ' + JSON.stringify(PADDING_MARKER) +
    ' — a tail of any length the engine took at BASE is all padding')
}

// ── (ii) a red wave candidate, reconciled green → leg (c) [M3] ───────────────
// BASE is green; the implementer stub plants `BROKEN` in its own clone, so the
// folded candidate is red. The reconcile stub captures its brief, then removes
// the marker and reports FIXED.
{
  const { repo, runDir } = scenario('ii')
  let reconcilePrompt = null
  const stub = (prompt, opts, cwd) => {
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') {
      fs.writeFileSync(path.join(cwd, 'T1.txt'), 'useful work\n')
      fs.writeFileSync(path.join(cwd, 'BROKEN'), 'oops\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    if (kind === 'reconcile') {
      reconcilePrompt = prompt
      fs.rmSync(path.join(cwd, 'BROKEN'))
      return { status: 'FIXED', summary: 'removed the BROKEN marker' }
    }
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('scenario (ii): unexpected dispatch ' + opts.label)
  }
  const { run } = rig({ repo, runDir, waves: [[task('T1')]], stub, stamp: 'rr-ii' })
  const report = await run()

  assert.equal(report.waveMerges[0].status, 'MERGED',
    'leg (c) [M3]: the wave ends MERGED — ' + JSON.stringify(report.judgmentCalls))
  assert.ok(reconcilePrompt !== null, 'leg (c) [M3]: the reconcile agent was dispatched')

  const marker = 'Failing output:\n'
  const at = reconcilePrompt.indexOf(marker)
  assert.ok(at >= 0,
    'leg (c) [M3]: the reconcile brief carries a "Failing output:" section — ' +
    JSON.stringify(reconcilePrompt.slice(-200)))
  const failing = reconcilePrompt.slice(at + marker.length)
  assert.ok(failing.includes(LEG_LINE),
    'leg (c) [M3]: the text after "Failing output:\\n" CONTAINS the leg-naming line ' +
    JSON.stringify(LEG_LINE) + ' — a 3000-character tail of this output has lost it. Got: ' +
    JSON.stringify(failing.slice(0, 200)))
  assert.ok(!failing.includes(PADDING_MARKER),
    'leg (c) [M3]: the text after "Failing output:\\n" contains no ' +
    JSON.stringify(PADDING_MARKER))
}

// ── (iii) the reconcile agent BLOCKED → leg (d) [M4] ─────────────────────────
// As (ii), but the reconcile stub refuses: the wave is TEST_FAILED and its
// detail is the only place a reader is told what failed.
{
  const { repo, runDir } = scenario('iii')
  const stub = (prompt, opts, cwd) => {
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') {
      fs.writeFileSync(path.join(cwd, 'T1.txt'), 'useful work\n')
      fs.writeFileSync(path.join(cwd, 'BROKEN'), 'oops\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    if (kind === 'reconcile') return { status: 'BLOCKED', summary: 'not fixable here' }
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('scenario (iii): unexpected dispatch ' + opts.label)
  }
  const { run } = rig({ repo, runDir, waves: [[task('T1')]], stub, stamp: 'rr-iii' })
  const report = await run()

  assert.equal(report.waveMerges[0].status, 'TEST_FAILED',
    'leg (d) [M4]: BLOCKED → TEST_FAILED — ' + JSON.stringify(report.judgmentCalls))
  const detail = String(report.waveMerges[0].detail)
  const prefix = 'candidate suite failed after reconcile attempts: '
  assert.ok(detail.startsWith(prefix),
    'leg (d) [M4]: the detail begins ' + JSON.stringify(prefix) + ' — got ' +
    JSON.stringify(detail.slice(0, 120)))
  assert.ok(detail.includes(LEG_LINE),
    'leg (d) [M4]: the detail CONTAINS the leg-naming line ' + JSON.stringify(LEG_LINE) +
    ' — an 800-character tail of this output has lost it. Got: ' +
    JSON.stringify(detail.slice(0, 200)))
  assert.ok(!detail.includes(PADDING_MARKER),
    'leg (d) [M4]: the detail contains no ' + JSON.stringify(PADDING_MARKER))
}

// ── (e) suiteLine carries a red output whole [M5] ────────────────────────────
// Called directly: the section the completeness critic reads must not re-tail
// an excerpt the engine already cut. `long` is over 8000 characters — more than
// twice the largest tail anywhere in the engine — so an equality here cannot
// pass against any fixed-length cut.
{
  const long = RED_OUTPUT + '\n' + 'y'.repeat(8000) + '\nEND-OF-LONG-OUTPUT'
  assert.ok(long.length > 8000, 'leg (e) [M5]: the fixture output is over 8000 characters')

  const rendered = suiteLine({ passed: false, output: long }, 'bash check.sh')
  const at = rendered.indexOf('\noutput: ')
  assert.ok(at >= 0, 'leg (e) [M5]: a red suite renders an "output: " line')
  assert.equal(rendered.slice(at + '\noutput: '.length), long,
    'leg (e) [M5]: the text after "\\noutput: " equals the output WHOLE — an engine that ' +
    'renders tail(output, 500) carries only its last 500 characters')

  const green = suiteLine({ passed: true, output: long }, 'bash check.sh')
  assert.ok(!green.includes('output: '),
    'leg (e) [M5]: a green suite renders no "output:" line — ' + JSON.stringify(green))
  assert.equal(green,
    '\nSUITE (driver-run, post-fold) — this is the authoritative result; ' +
    'do not re-derive it by reading tests.' +
    '\ncommand: bash check.sh' +
    '\npassed: true',
    'leg (e) [M5]: the green branch is BASE\'s, verdict without output')
}

// ── (iv) every wave green: the record is BASE's, unchanged → leg (f) [M6] ────
{
  const { repo, runDir } = scenario('iv')
  const stub = (prompt, opts, cwd) => {
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') {
      fs.writeFileSync(path.join(cwd, 'T1.txt'), 'useful work\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('scenario (iv): unexpected dispatch ' + opts.label)
  }
  const { run } = rig({ repo, runDir, waves: [[task('T1')]], stub, stamp: 'rr-iv' })
  const report = await run()

  assert.equal(report.waveMerges[0].status, 'MERGED',
    'scenario (iv) precondition: the wave merged — ' + JSON.stringify(report.judgmentCalls))
  assert.equal(report.baseline && report.baseline.passed, true,
    'leg (f) [M6]: report.baseline records a GREEN BASE on an all-green run — the baseline ' +
    'is read once per run whatever the waves do, so it is never null after Setup — ' +
    JSON.stringify(report.baseline))
  assert.ok(!report.judgmentCalls.some((j) => String(j).startsWith('baseline:')),
    'leg (f) [M6]: no judgmentCalls entry starts with "baseline:" — ' +
    JSON.stringify(report.judgmentCalls))
  assert.equal(report.tests.passed, true, 'leg (f) [M6]: report.tests.passed is true')
  assert.equal(report.tests.output, GREEN_OUTPUT,
    'leg (f) [M6]: report.tests.output equals the suite\'s own printed stdout+stderr for ' +
    'that execution — ' + JSON.stringify(report.tests.output))
}

for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true })
console.log('ALL TESTS PASSED')
