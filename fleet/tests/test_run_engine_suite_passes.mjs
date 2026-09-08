// fleet/tests/test_run_engine_suite_passes.mjs — #712 Task 1: the depth-1 leg
// is gone; CI's depth-1 checkout keeps the guard.
//
// The claim: after a run whose adopted tree is green, no depth-1 clone was made
// and no ack was manufactured for one — the leg is gone from the engine, its
// record, its documents and its sims, and `.github/workflows/ci.yml`'s
// default-depth checkout is what now predicts the history-coupled failure.
//
// How the legs count suite executions: the engine emits no event for a suite
// run, so an event count cannot answer M1. The count comes from the SUITE
// COMMAND itself — a `check.sh` written into the sim repo at `makeRepo` time
// that appends `$PWD` and `$(git write-tree)` to an absolute log under the
// sim's temp dir on every execution and then exits by its own rule. The
// implementer stubs never run the suite and no sim task carries `proofTests`,
// so every line of that log is one of the driver's executions, naming the
// directory it ran in and the tree its index held.
//
// The six identifiers M5 sweeps for are assembled from fragments below on
// purpose: this file is tracked under `fleet/`, so writing any of them out
// whole here would make leg (e) unsatisfiable by construction.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { makeRepo, rig, gitSync, passReview, cleanCritic, doneImpl } from './_engine_helpers.mjs'

// fleet/tests/<this file> → the repository root the tracked-file legs read.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

// The six strings of M5, never spelled whole in this file.
const SHALLOW_SUITE = 'shallow' + 'Suite'
const SHALLOW_LEG = 'shallow' + 'Leg'
const SHALLOW_DEFERRED = 'shallow' + 'Deferred'
const RUN_SHALLOW_LEG = 'run' + 'ShallowLeg'
const LEG_PHASE = 'Depth-1' + ' Leg'
const LEG_CALL_PREFIX = 'depth-1' + ' leg:'
const GONE = [SHALLOW_SUITE, SHALLOW_LEG, SHALLOW_DEFERRED, RUN_SHALLOW_LEG, LEG_PHASE,
              LEG_CALL_PREFIX]

// A suite command that logs where it ran, then decides by `rule`.
const loggingCheck = (logPath, rule) =>
  '#!/bin/bash\n' +
  'printf \'%s\\t%s\\n\' "$PWD" "$(git write-tree 2>/dev/null)" >> ' + JSON.stringify(logPath) +
  '\n' + rule + '\n'

// The BASE suite rule (`makeRepo`'s own) and the history-coupled one: true in
// any full clone of a two-commit repo, false at depth 1 — the smallest faithful
// stand-in for a test that reads repository history.
const BROKEN_RULE = '[ ! -f BROKEN ]'
const HISTORY_COUPLED_RULE = '[ "$(git rev-list --count HEAD)" -gt 1 ]'

// More than one commit at BASE, so the full-clone suite is green before the run
// starts (a red baseline would change the run's shape).
function twoCommitRepo(dir, checkScript) {
  makeRepo(dir, { 'check.sh': checkScript })
  fs.writeFileSync(path.join(dir, 'b.txt'), 'second\n')
  gitSync(['add', '-A'], dir)
  gitSync(['commit', '-q', '-m', 'second'], dir)
  return dir
}

const wavesFor = (id) => [[{ id, title: 'create ' + id, files: [id + '.txt'], tier: 'standard',
  review: 'lean', writes: [id + '.txt'], commutes: [], body: 'sim task ' + id }]]

const countOf = (labels, label) => labels.filter((l) => l === label).length

// Physical paths on both sides: bash resolves `$PWD` through getcwd(), and the
// sim's temp root may itself be reached through a symlink.
const real = (p) => { try { return fs.realpathSync(p) } catch { return p } }

// One {dir, tree} per execution of the suite command, in execution order.
const readLog = (logPath) => (fs.existsSync(logPath)
  ? fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean)
      .map((l) => { const [dir, tree] = l.split('\t'); return { dir, tree } })
  : [])

const mkTmp = (tag) => fs.mkdtempSync(path.join(os.tmpdir(), 'engine-suite-passes-' + tag + '-'))

// ── (a) [M1] + (b) [M2] + the merged half of (d) [M4] — one run, read three
// ways: no depth-1 clone, every suite execution in the integration clone, the
// phases the engine announced, and one critic dispatch. ─────────────────────
{
  const tmp = mkTmp('merged')
  const logPath = path.join(tmp, 'suite-runs.log')
  const repo = twoCommitRepo(path.join(tmp, 'repo'), loggingCheck(logPath, BROKEN_RULE))
  const runDir = path.join(tmp, 'run')

  const labels = []
  const stub = (prompt, opts, cwd) => {
    labels.push(opts.label)
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') {
      fs.writeFileSync(path.join(cwd, 'T1.txt'), 'from T1\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }

  // No knob is passed: an engine that reads no such arg must not be handed one.
  const { run, integ, phases } = rig({ repo, runDir, waves: wavesFor('T1'), stub,
                                       stamp: 'suitepassesa' })
  const report = await run()

  // (a)/M1 — the run this leg is about: a wave that merged on a green tree.
  assert.equal(report.waveMerges[0].status, 'MERGED',
    '(a)/M1 precondition: wave 1 was adopted — ' + JSON.stringify(report.waveMerges))
  assert.equal(report.tests.passed, true,
    '(a)/M1 precondition: the driver\'s suite on the adopted tree passed — ' +
    report.tests.output)

  const shallowDir = path.join(runDir, 'clones', 'shallow')
  assert.equal(fs.existsSync(shallowDir), false,
    '(a)/M1: `<runDir>/clones/shallow` exists — the engine still cuts a depth-1 clone ' +
    'after a green wave; the leg is supposed to be gone')

  const executions = readLog(logPath)
  assert.ok(executions.length >= 1,
    '(a)/M1 precondition: the suite command logged no execution at all — the log is the ' +
    'only witness this leg has, so an empty one is a broken fixture, not a green run')
  const wanted = real(integ)
  const strays = executions.filter((e) => real(e.dir) !== wanted)
  assert.deepEqual(strays, [],
    '(a)/M1: the suite command ran outside ' + wanted + ' — every execution must happen in ' +
    '<runDir>/clones/integration, and these did not: ' + JSON.stringify(strays))

  // (b)/M2 — the phases announced, in order, with nothing between the wave and
  // the review. `phases` is the rig\'s array beside `logs`, filled by the
  // `phase` callback it passes to runEngine.
  assert.deepEqual(phases, ['Setup', 'Wave 1', 'Integration Review'],
    '(b)/M2: the phases announced on a one-wave run whose wave merged are not exactly ' +
    'Setup, Wave 1, Integration Review (an engine that still announces `' + LEG_PHASE +
    '` fails on the extra element; `undefined` means rig() does not return `phases` yet) — ' +
    'got ' + JSON.stringify(phases))

  // (d)/M4 — the critic is dispatched exactly once on a run whose wave merged.
  assert.equal(countOf(labels, 'integration'), 1,
    '(d)/M4: the completeness critic was not dispatched exactly once on a merged run — ' +
    labels.join(','))
}

// ── (c) [M3] the history-coupled suite: green in the rig's full clones, red at
// depth 1 — the run is clean, and the report has no key for the leg at all ───
{
  const tmp = mkTmp('coupled')
  const logPath = path.join(tmp, 'suite-runs.log')
  const repo = twoCommitRepo(path.join(tmp, 'repo'), loggingCheck(logPath, HISTORY_COUPLED_RULE))
  const runDir = path.join(tmp, 'run')

  const stub = (prompt, opts, cwd) => {
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') {
      fs.writeFileSync(path.join(cwd, 'T2.txt'), 'from T2\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }

  const { run } = rig({ repo, runDir, waves: wavesFor('T2'), stub, stamp: 'suitepassesc' })
  const report = await run()

  assert.equal(report.waveMerges[0].status, 'MERGED',
    '(c)/M3: the wave did not merge on a history-coupled suite that is green in every full ' +
    'clone — ' + JSON.stringify(report.waveMerges))
  assert.equal(report.tests.passed, true,
    '(c)/M3: the driver\'s full-clone suite did not pass — ' + report.tests.output)

  assert.equal(Object.hasOwn(report, SHALLOW_SUITE), false,
    '(c)/M3: `report` still carries the `' + SHALLOW_SUITE + '` key — it must be ABSENT, ' +
    'not null: a sim at BASE pinned null as "did not run", and an engine without the leg ' +
    'returns no key at all (got ' + JSON.stringify(report[SHALLOW_SUITE]) + ')')

  const manufactured = (report.deferredVerification || []).filter((d) =>
    d && (d.reason === 'manual' || String(d.deliverable || '').startsWith('depth-1 clone of ')))
  assert.deepEqual(manufactured, [],
    '(c)/M3: an ack was manufactured for a depth-1 clone — the `manual` reason is the one ' +
    'the gate does not pre-authorize, and a green run must not park on it: ' +
    JSON.stringify(manufactured))
  assert.deepEqual(report.deferredVerification, [],
    '(c)/M3: `report.deferredVerification` is not [] on a clean run — ' +
    JSON.stringify(report.deferredVerification))

  const legCalls = (report.judgmentCalls || []).filter((j) => String(j).startsWith(LEG_CALL_PREFIX))
  assert.deepEqual(legCalls, [],
    '(c)/M3: a judgment call still starts with `' + LEG_CALL_PREFIX + '` — the leg still ran: ' +
    JSON.stringify(legCalls))
}

// ── (d) [M4] the other half: nothing merged, so no critic is dispatched and
// the report says so itself ─────────────────────────────────────────────────
{
  const tmp = mkTmp('blocked')
  const logPath = path.join(tmp, 'suite-runs.log')
  const repo = twoCommitRepo(path.join(tmp, 'repo'), loggingCheck(logPath, BROKEN_RULE))
  const runDir = path.join(tmp, 'run')

  const labels = []
  const stub = (prompt, opts, cwd) => {
    labels.push(opts.label)
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') {
      return { status: 'BLOCKED', summary: 'sim: cannot proceed', startHead: doneImpl(cwd).startHead }
    }
    if (kind === 'review') return passReview()
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }

  const { run } = rig({ repo, runDir, waves: wavesFor('T3'), stub, stamp: 'suitepassesd' })
  const report = await run()

  assert.equal(report.waveMerges.some((m) => m && m.status === 'MERGED'), false,
    '(d)/M4 precondition: no wave merged — ' + JSON.stringify(report.waveMerges))
  assert.equal(countOf(labels, 'integration'), 0,
    '(d)/M4: the completeness critic was dispatched on a tree still at BASE — ' +
    labels.join(','))
  assert.ok((report.completenessFindings || []).some((f) =>
    f && String(f.detail || '').includes('no wave merged')),
    '(d)/M4: the report carries no `no wave merged` finding — ' +
    JSON.stringify(report.completenessFindings))
}

// ── (e) [M5] the deletion is real: neither sim file survives, and no tracked
// file of the four directories names the leg. Same sweep as the Proof's first
// two `Run:` commands, run here so the exam fails on a half-done deletion. ───
{
  const sweep = spawnSync('git',
    ['grep', '-n', '-e', SHALLOW_SUITE, '-e', SHALLOW_LEG, '-e', SHALLOW_DEFERRED,
     '-e', RUN_SHALLOW_LEG, '-e', LEG_PHASE, '-e', LEG_CALL_PREFIX,
     '--', 'fleet', 'skills', 'tests', '.github', ':!tests/fixtures'],
    { cwd: REPO_ROOT, encoding: 'utf8' })
  assert.equal(sweep.error, undefined, '(e)/M5: the sweep could not run: ' + sweep.error)
  assert.equal(String(sweep.stdout || ''), '',
    '(e)/M5: a tracked file under fleet/, skills/, tests/ or .github/ still names the leg ' +
    '(the knob in one of the thirteen sims, or the row in report-format.md, counts):\n' +
    String(sweep.stdout || ''))
  assert.equal(sweep.status, 1,
    '(e)/M5: `git grep` exited ' + sweep.status + ' rather than 1-for-no-match — ' +
    String(sweep.stderr || ''))

  for (const p of ['fleet/tests/test_run_engine_shallow.mjs',
                   'fleet/tests/test_run_engine_depth1_beside_critic.mjs']) {
    assert.equal(fs.existsSync(path.join(REPO_ROOT, p)), false,
      '(e)/M5: ' + p + ' is still in the tree — both sims are deleted outright')
  }

  const reportFormat = fs.readFileSync(
    path.join(REPO_ROOT, 'skills/ultrapowers/references/report-format.md'), 'utf8')
  assert.equal(reportFormat.includes(SHALLOW_SUITE), false,
    '(e)/M5: report-format.md still carries the leg — both its schema entry and its field ' +
    'table row go, and the record must not name a field the engine no longer returns')
}

// ── (f) [M6] CI keeps the guard: the checkout comment names #712, the file has
// dropped the old reading, and no line sets a fetch-depth key ───────────────
{
  const ciPath = path.join(REPO_ROOT, '.github/workflows/ci.yml')
  const ciLines = fs.readFileSync(ciPath, 'utf8').split('\n')
  const idx = ciLines.findIndex((l) => l.includes('uses: actions/checkout'))
  assert.ok(idx >= 0, '(f)/M6: ci.yml has no `uses: actions/checkout` line at all')

  const above = ciLines.slice(Math.max(0, idx - 8), idx)
  assert.ok(above.some((l) => l.includes('#712')),
    '(f)/M6: none of the eight lines directly above the `uses: actions/checkout` line names ' +
    '#712 — the comment has to say the depth-1 checkout IS the guard now that #712 deleted ' +
    'the engine\'s leg (a #712 written elsewhere in the file does not satisfy this):\n' +
    above.join('\n'))

  const gateLeg = ciLines.filter((l) => l.includes('gate leg'))
  assert.deepEqual(gateLeg, [],
    '(f)/M6: ci.yml still describes the checkout as predicting a gate leg that no longer ' +
    'exists: ' + JSON.stringify(gateLeg))

  const depthKeys = ciLines.filter((l) => /^[ \t]+fetch-depth:/.test(l))
  assert.deepEqual(depthKeys, [],
    '(f)/M6: a line of ci.yml sets a fetch-depth key — the default depth is the guard, so ' +
    'the key stays unset (a comment naming it is not a key): ' + JSON.stringify(depthKeys))
  assert.ok(ciLines[idx].includes('actions/checkout@v7'),
    '(f)/M6: the checkout step is no longer actions/checkout@v7 — only the comment changes: ' +
    ciLines[idx])

  // The fourth and fifth `Run:` legs, executed here too: the sibling sim prints
  // its sentinel with its knob gone, and the doc pin passes as the lens over
  // the four operator documents.
  const cleanSim = spawnSync('node', ['fleet/tests/test_run_engine_integrated_clean.mjs'],
    { cwd: REPO_ROOT, encoding: 'utf8' })
  assert.ok(String(cleanSim.stdout || '').includes('ALL TESTS PASSED'),
    '(f)/M6: fleet/tests/test_run_engine_integrated_clean.mjs did not print its sentinel ' +
    'once its knob was removed (exit ' + cleanSim.status + '):\n' +
    String(cleanSim.stdout || '') + String(cleanSim.stderr || ''))

  const docPin = spawnSync('python3', ['-m', 'pytest', '-q', 'tests/test_docs_agree_with_code.py'],
    { cwd: REPO_ROOT, encoding: 'utf8' })
  assert.equal(docPin.status, 0,
    '(f)/M6: tests/test_docs_agree_with_code.py failed — the operator documents name a ' +
    'mechanism that is not there:\n' + String(docPin.stdout || '') + String(docPin.stderr || ''))
}

console.log('ALL TESTS PASSED')
