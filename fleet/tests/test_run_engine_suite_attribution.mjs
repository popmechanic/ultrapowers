// fleet/tests/test_run_engine_suite_attribution.mjs — Task 1's exam.
//
// Claim: when a wave's fold turns a test red that none of the wave's tasks
// touched, the run records that and keeps going; when the red is in something a
// task did touch, the run repairs it or parks as it does today.
//
// The Machine clauses, restated as this file reads them:
//
//   M1  `failingTestPaths(output)` returns, in order and without duplicates,
//       the paths of pytest `FAILED <path>::…` lines in a suite output, mapping
//       the bridge's `tests/test_fleet_suite.py::test_fleet_mjs[<name>.mjs]` to
//       `fleet/tests/<name>.mjs`; an output with no such line returns `[]`.
//   M2  a red candidate whose failing paths are non-empty and none of which is
//       in any wave task's `files` or `proofTests` is ADOPTED: the wave's
//       `waveMerges` row has `status` `MERGED` and `suite`
//       `{passed: false, unattributed: [<paths>], output}`, no worker labelled
//       `reconcile:` is dispatched, and `judgmentCalls` carries one line
//       `unattributed red: <path> went red on wave <n>'s fold; no task names it`.
//   M3  a red candidate whose failing paths include one that IS in some wave
//       task's `files` or `proofTests`, or whose failing paths are `[]`, takes
//       today's path: up to two `reconcile:` dispatches, then `TEST_FAILED`
//       with the failing block.
//   M4  the report's `tests` carries `unattributed` — the union of every wave's
//       unattributed paths, `[]` when none — and a run whose only red was
//       unattributed ends with `blockedWaves` empty.
//   M5  `ultra_gate.py --result <report>` with `tests.passed` `false` and
//       non-empty `tests.unattributed` writes verdict `PASS` and `suite`
//       `{passed: false, unattributed: [<paths>], output}` and exits 0; with
//       `tests.passed` `false` and `unattributed` `[]` it writes `BLOCKED` and
//       exits 1, as it does at BASE.
//
// The Proof's legs, and where each is asserted below: (a) the five
// `failingTestPaths` readings [M1]; (b) the adopted unattributed red [M2];
// (c) the three attributed-or-unreadable reds that still park [M3]; (d) the
// two-wave union and the green run's `[]` [M4]; (e) the gate, driven through
// `python3` the way `tests/test_ultra_gate_record.py` drives it [M5].
//
// The rig is `test_run_engine_reconcile.mjs`'s: `makeRepo` with a `check.sh`
// that fails a NAMED test, the agent seam stubbed, everything below it real
// (real git, real clones, real capture, the real fold kernel, the real `sh`).
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { makeRepo, rig, gitSync, passReview, cleanCritic, doneImpl } from './_engine_helpers.mjs'
import { simEnv } from './_helpers.mjs'
import { failingTestPaths } from '../run-engine.mjs'

const tmpDirs = []
const tmpDir = (name) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-attr-' + name + '-'))
  tmpDirs.push(dir)
  return dir
}

// ── leg (a): the five readings of `failingTestPaths` [M1] ───────────────────
// Five outputs, five expected returns. The fixtures are whole suite outputs
// rather than bare lines, so a reading that scans the text rather than the
// summary block is measured the same way.

const PLAIN = [
  'collected 3 items',
  'tests/x.py .F',
  '=== short test summary info ===',
  'FAILED tests/x.py::test_y - AssertionError: boom',
  '1 failed, 2 passed in 0.11s',
].join('\n')

const BRIDGE = [
  'collected 90 items',
  '=== short test summary info ===',
  'FAILED tests/test_fleet_suite.py::test_fleet_mjs[test_y.mjs] - E',
  '1 failed, 89 passed in 12.34s',
].join('\n')

const TWO_PATHS = [
  '=== short test summary info ===',
  'FAILED tests/b.py::test_second - AssertionError: b',
  'FAILED tests/a.py::test_first - AssertionError: a',
  '2 failed in 0.30s',
].join('\n')

const ONE_PATH_TWICE = [
  '=== short test summary info ===',
  'FAILED tests/dup.py::test_one - AssertionError: one',
  'FAILED tests/dup.py::test_two - AssertionError: two',
  '2 failed in 0.30s',
].join('\n')

const NO_FAILED_LINE = [
  'bash: line 1: pytest: command not found',
  'the runner exited 127 and named no test at all',
].join('\n')

for (const [why, output, expected] of [
  ['a plain pytest FAILED line', PLAIN, ['tests/x.py']],
  ['a bridge line', BRIDGE, ['fleet/tests/test_y.mjs']],
  ['two lines naming tests/b.py then tests/a.py', TWO_PATHS, ['tests/b.py', 'tests/a.py']],
  ['two lines naming one path twice', ONE_PATH_TWICE, ['tests/dup.py']],
  ['an output with no FAILED line', NO_FAILED_LINE, []],
]) {
  const got = failingTestPaths(output)
  assert.ok(Array.isArray(got),
    'leg (a) [M1]: failingTestPaths returns an array for ' + why + ' — got ' +
    JSON.stringify(got))
  assert.deepEqual(got, expected,
    'leg (a) [M1]: failingTestPaths for ' + why + ' is ' + JSON.stringify(expected) +
    ', in that order and without duplicates — got ' + JSON.stringify(got) +
    '. A wrong, reordered or duplicated entry fails this leg.')
}

// ── the sims' fixture: a check.sh that fails a NAMED test ───────────────────
// Each rule is a marker file the implementer stub plants in its own clone: the
// folded candidate carries it, so the candidate's suite is red on the path that
// rule names and nothing else in the run has to be red for it.

// The line inside the failing test's own BLOCK — the one `failingBlock` cuts
// out and the TEST_FAILED detail must carry. It sits above the
// `=== short test summary info ===` rule line, where a block ends.
const blockMark = (tag) => 'E   AssertionError: the failing block names ' + tag

const redOutput = (failedPath, tag) => [
  'collected 3 items',
  '..F',
  '=== FAILURES ===',
  '___ test_t ___',
  blockMark(tag),
  '=== short test summary info ===',
  'FAILED ' + failedPath + '::test_t - AssertionError',
  '1 failed, 2 passed in 0.10s',
].join('\n')

// A rule: red, printing the pytest shape above, when `marker` is present. The
// heredoc delimiter is quoted, so the body is emitted byte for byte.
const redOn = (marker, failedPath, tag) =>
  'if [ -f ' + marker + ' ]; then\n' +
  "  cat <<'RED_EOF'\n" +
  redOutput(failedPath, tag) + '\n' +
  'RED_EOF\n' +
  '  exit 1\n' +
  'fi\n'

// The third M3 shape: a bare non-zero exit whose output carries no `FAILED`
// line at all, so `failingTestPaths` reads `[]` from it.
const BARE_MARK = 'the candidate exited non-zero and named no test'
const bareRedOn = (marker) =>
  'if [ -f ' + marker + ' ]; then\n' +
  "  echo '" + BARE_MARK + "'\n" +
  '  exit 1\n' +
  'fi\n'

const checkSh = (rules) => '#!/bin/bash\n' + rules.join('') + "echo 'green suite output'\n"

const task = (id, extra = {}) => ({
  id, title: 'task ' + id, files: [id + '.txt'], tier: 'standard', review: 'lean',
  writes: [id + '.txt'], commutes: [], body: 'sim task ' + id, ...extra,
})

// Run one scenario end to end. `markers[id]` is the marker that task's
// implementer plants; every task writes its own declared files as well, so the
// tree the fold sees is an ordinary one.
const runScenario = async ({ name, waves, rules, markers = {} }) => {
  const dir = tmpDir(name)
  const repo = makeRepo(path.join(dir, 'repo'), { 'check.sh': checkSh(rules) })
  const labels = []
  const stub = (prompt, opts, cwd) => {
    labels.push(opts.label)
    const kind = String(opts.label).split(':')[0]
    const id = String(opts.label).split(':')[1]
    if (kind === 'impl') {
      const t = waves.flat().find((x) => x.id === id)
      for (const f of (t ? t.files : [])) {
        const dest = path.join(cwd, f)
        fs.mkdirSync(path.dirname(dest), { recursive: true })
        fs.writeFileSync(dest, 'useful work for ' + id + '\n')
      }
      if (markers[id]) fs.writeFileSync(path.join(cwd, markers[id]), 'red\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    // Every reconcile attempt refuses: a scenario that dispatches one gets no
    // repair out of it, so the M3 rows land on TEST_FAILED and the M2 row can
    // only be MERGED if no reconcile was dispatched at all.
    if (kind === 'reconcile') return { status: 'BLOCKED', summary: 'not fixable here' }
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('scenario ' + name + ': unexpected dispatch ' + opts.label)
  }
  const { run, integ, base } = rig({
    repo, runDir: path.join(dir, 'run'), waves, stub, stamp: 'attr-' + name,
  })
  const report = await run()
  return { report, labels, integ, base }
}

const reconcileLabels = (labels) => labels.filter((l) => String(l).startsWith('reconcile:'))

// ── leg (b): the unattributed red is adopted [M2] ────────────────────────────
// One wave, one task, `files: ['T1.txt']` and no `proofTests`; the candidate's
// suite fails `tests/other.py::test_t`, which no task names.
{
  const waves = [[task('T1')]]
  const { report, labels, integ } = await runScenario({
    name: 'b',
    waves,
    rules: [redOn('BREAK_OTHER', 'tests/other.py', 'tests/other.py')],
    markers: { T1: 'BREAK_OTHER' },
  })

  const row = report.waveMerges[0]
  assert.ok(row, 'leg (b) [M2]: the run recorded a waveMerges row — ' +
    JSON.stringify(report.waveMerges))
  assert.equal(row.status, 'MERGED',
    'leg (b) [M2]: a red candidate whose only failing path (tests/other.py) is in no wave ' +
    'task\'s files or proofTests is ADOPTED — the row is ' + JSON.stringify(row.status) +
    ' with detail ' + JSON.stringify(row.detail) + '; calls: ' +
    JSON.stringify(report.judgmentCalls))

  const suite = row.suite
  assert.ok(suite && typeof suite === 'object',
    'leg (b) [M2]: the adopted row carries a `suite` object — ' + JSON.stringify(row))
  assert.equal(typeof suite.output, 'string',
    'leg (b) [M2]: the row\'s suite.output is a string — ' + JSON.stringify(suite.output))
  assert.ok(suite.output.length > 0,
    'leg (b) [M2]: the row\'s suite.output is a NON-EMPTY string (the recorded tail) — ' +
    JSON.stringify(suite.output))
  assert.deepEqual(suite, { passed: false, unattributed: ['tests/other.py'], output: suite.output },
    'leg (b) [M2]: the adopted row\'s suite deep-equals {passed: false, unattributed: ' +
    '[\'tests/other.py\'], output: <the recorded tail>} — nothing else changes in the row. ' +
    'Got ' + JSON.stringify(suite))

  assert.deepEqual(reconcileLabels(labels), [],
    'leg (b) [M2]: no worker labelled `reconcile:` is dispatched against an unattributed ' +
    'red — the stream carried ' + JSON.stringify(labels))

  const notes = report.judgmentCalls.filter((j) => String(j).startsWith('unattributed red:'))
  assert.equal(notes.length, 1,
    'leg (b) [M2]: exactly one judgmentCalls line starts with "unattributed red:" — ' +
    JSON.stringify(report.judgmentCalls))
  assert.equal(notes[0],
    'unattributed red: tests/other.py went red on wave 1\'s fold; no task names it',
    'leg (b) [M2]: that line is the verbatim record the clause spells — got ' +
    JSON.stringify(notes[0]))

  // Adopted means adopted: the integration branch stands at the row's head.
  assert.equal(gitSync(['rev-parse', 'ultra/integration-attr-b'], integ), row.headSha,
    'leg (b) [M2]: the integration branch is at the adopted candidate — the unattributed ' +
    'branch adopts exactly as the green path does')
}

// ── leg (c): the attributed, and the unreadable, still park [M3] ─────────────
// Three shapes, one scenario each. In every one the reconcile agent IS
// dispatched and (refusing) leaves the wave TEST_FAILED with the failing block
// in its detail. An adopted row in any of the three fails this leg.
for (const { name, why, waves, rules, expectBlock } of [
  { name: 'c-files',
    why: 'the failing path is in the task\'s files',
    waves: [[task('T1', { files: ['tests/other.py'], writes: ['tests/other.py'] })]],
    rules: [redOn('BREAK_OTHER', 'tests/other.py', 'tests/other.py')],
    expectBlock: blockMark('tests/other.py') },
  { name: 'c-prooftests',
    why: 'the failing path is in the task\'s proofTests',
    waves: [[task('T1', { proofTests: ['tests/other.py'] })]],
    rules: [redOn('BREAK_OTHER', 'tests/other.py', 'tests/other.py')],
    expectBlock: blockMark('tests/other.py') },
  { name: 'c-nopath',
    why: 'the output names no failing path at all',
    waves: [[task('T1')]],
    rules: [bareRedOn('BREAK_OTHER')],
    expectBlock: BARE_MARK },
]) {
  const { report, labels } = await runScenario({
    name, waves, rules, markers: { T1: 'BREAK_OTHER' },
  })

  const row = report.waveMerges[0]
  assert.ok(row, 'leg (c) [M3]: a waveMerges row exists when ' + why)
  assert.notEqual(row.status, 'MERGED',
    'leg (c) [M3]: when ' + why + ', the red candidate is NOT adopted — an adopted row ' +
    'fails this leg. Got ' + JSON.stringify(row))
  assert.equal(row.status, 'TEST_FAILED',
    'leg (c) [M3]: when ' + why + ', the wave takes today\'s path and ends TEST_FAILED — ' +
    'got ' + JSON.stringify(row.status) + '; calls: ' + JSON.stringify(report.judgmentCalls))

  assert.ok(labels.includes('reconcile:wave1:1'),
    'leg (c) [M3]: when ' + why + ', `reconcile:wave1:1` is dispatched — the stream carried ' +
    JSON.stringify(labels))

  const detail = String(row.detail)
  const prefix = 'candidate suite failed after reconcile attempts: '
  assert.ok(detail.startsWith(prefix),
    'leg (c) [M3]: when ' + why + ', the detail begins ' + JSON.stringify(prefix) + ' — got ' +
    JSON.stringify(detail.slice(0, 160)))
  assert.ok(detail.includes(expectBlock),
    'leg (c) [M3]: when ' + why + ', the detail carries the failing block, which contains ' +
    JSON.stringify(expectBlock) + ' — got ' + JSON.stringify(detail.slice(0, 400)))

  assert.ok(!report.judgmentCalls.some((j) => String(j).startsWith('unattributed red:')),
    'leg (c) [M3]: when ' + why + ', the run records no "unattributed red:" line — ' +
    JSON.stringify(report.judgmentCalls))
}

// ── leg (d): the report's union, and the green run's [] [M4] ─────────────────
// Two waves, two unattributed reds, in wave order. The second wave's candidate
// is built on the first wave's ADOPTED (still red) head, so the run only
// reaches it if the unattributed red of wave 1 did not park it.
{
  const waves = [[task('T1')], [task('T2')]]
  const { report, labels } = await runScenario({
    name: 'd',
    waves,
    // BREAK_MORE is checked first, so wave 2's candidate — which carries both
    // markers — is red on tests/more.py.
    rules: [
      redOn('BREAK_MORE', 'tests/more.py', 'tests/more.py'),
      redOn('BREAK_OTHER', 'tests/other.py', 'tests/other.py'),
    ],
    markers: { T1: 'BREAK_OTHER', T2: 'BREAK_MORE' },
  })

  assert.deepEqual(report.waveMerges.map((m) => m.status), ['MERGED', 'MERGED'],
    'leg (d) [M4]: both waves adopted their unattributed red — ' +
    JSON.stringify(report.waveMerges) + '; calls: ' + JSON.stringify(report.judgmentCalls))
  assert.deepEqual(reconcileLabels(labels), [],
    'leg (d) [M4]: neither unattributed red dispatched a reconcile — ' + JSON.stringify(labels))

  assert.ok(report.tests && typeof report.tests === 'object',
    'leg (d) [M4]: the report carries a tests block — ' + JSON.stringify(report.tests))
  assert.deepEqual(report.tests.unattributed, ['tests/other.py', 'tests/more.py'],
    'leg (d) [M4]: report.tests.unattributed is the UNION of every wave\'s unattributed ' +
    'paths, in wave order — got ' + JSON.stringify(report.tests.unattributed) +
    ' (the last wave\'s alone is not the union)')
  assert.deepEqual(report.blockedWaves, [],
    'leg (d) [M4]: a run whose only red was unattributed ends with blockedWaves empty — ' +
    JSON.stringify(report.blockedWaves))
}

// …and the green run: `unattributed` is present and `[]`.
{
  const { report } = await runScenario({
    name: 'dgreen',
    waves: [[task('T1')]],
    rules: [redOn('BREAK_OTHER', 'tests/other.py', 'tests/other.py')],
    markers: {},
  })

  assert.equal(report.waveMerges[0].status, 'MERGED',
    'leg (d) [M4] precondition: the green run merged — ' +
    JSON.stringify(report.judgmentCalls))
  assert.equal(report.tests.passed, true,
    'leg (d) [M4] precondition: the green run\'s suite passed — ' +
    JSON.stringify(report.tests))
  assert.deepEqual(report.tests.unattributed, [],
    'leg (d) [M4]: a green run ends with report.tests.unattributed equal to [] — got ' +
    JSON.stringify(report.tests.unattributed))
}

// ── leg (e): the gate reads `tests.unattributed` [M5] ────────────────────────
// Driven through `python3` the way `tests/test_ultra_gate_record.py` drives it:
// a throwaway repo, the two scripts copied beside each other, `gate_check.py`
// real and PASSing, and the report's `tests` block spliced in verbatim.
const SCRIPTS = fileURLToPath(new URL('../../skills/ultrapowers/scripts', import.meta.url))

const reportWith = (head, tests) => ({
  integrationBranch: 'ultra/int',
  waves: [['1']],
  tasks: [{ task: '1', status: 'done' }],
  unfinished: [],
  gitVerified: true,
  waveMerges: [{ wave: 1, status: 'MERGED', headSha: head }],
  coverage: { tasks_merged: 1, tasks_planned: 1, complete: true },
  tests,
})

const runGate = (name, tests) => {
  const dir = tmpDir(name)
  const repo = path.join(dir, 'repo')
  fs.mkdirSync(repo, { recursive: true })
  gitSync(['init', '-q', '-b', 'main'], repo)
  gitSync(['config', 'user.email', 'sim@test'], repo)
  gitSync(['config', 'user.name', 'sim'], repo)
  fs.writeFileSync(path.join(repo, '.gitignore'), '.claude/\n')
  fs.writeFileSync(path.join(repo, 'f.txt'), 'base\n')
  gitSync(['add', '.'], repo)
  gitSync(['commit', '-qm', 'base'], repo)
  gitSync(['checkout', '-qb', 'ultra/int'], repo)
  fs.writeFileSync(path.join(repo, 'f.txt'), 'work\n')
  gitSync(['add', '.'], repo)
  gitSync(['commit', '-qm', 'work'], repo)
  const head = gitSync(['rev-parse', 'HEAD'], repo)
  gitSync(['checkout', '-q', 'main'], repo)

  const scripts = path.join(dir, 'scripts')
  fs.mkdirSync(scripts, { recursive: true })
  for (const f of ['ultra_gate.py', 'gate_check.py']) {
    fs.copyFileSync(path.join(SCRIPTS, f), path.join(scripts, f))
  }
  const runDir = path.join(repo, '.claude/ultrapowers/run-t1')
  fs.mkdirSync(runDir, { recursive: true })
  fs.writeFileSync(path.join(runDir, 'receipt.json'), JSON.stringify({
    ok: true, stamp: 't1', baseBranch: 'main', testCmd: 'python3 -m pytest -q',
  }))

  const result = path.join(dir, 'result.json')
  fs.writeFileSync(result, JSON.stringify(reportWith(head, tests)))
  const r = spawnSync('python3',
    [path.join(scripts, 'ultra_gate.py'), '--stamp', 't1', '--result', result],
    { cwd: repo, encoding: 'utf8', env: simEnv() })
  let printed = null
  try {
    printed = JSON.parse(r.stdout)
  } catch (e) {
    assert.fail('leg (e) [M5]: the gate printed no receipt JSON (' + e.message + ')\nstdout:\n' +
      r.stdout + '\nstderr:\n' + r.stderr)
  }
  const savedPath = path.join(runDir, 'gate-receipt.json')
  const saved = fs.existsSync(savedPath) ? JSON.parse(fs.readFileSync(savedPath, 'utf8')) : null
  return { code: r.status, printed, saved }
}

// A red suite with a non-empty `unattributed` PASSES, and the list is copied.
{
  const tests = { command: 'python3 -m pytest -q', passed: false,
                  unattributed: ['tests/other.py'], output: 'x' }
  const { code, printed, saved } = runGate('e-pass', tests)

  assert.equal(printed.verdict, 'PASS',
    'leg (e) [M5]: tests.passed false with a non-empty tests.unattributed and a PASS ' +
    'gate_check writes verdict PASS — got ' + JSON.stringify(printed.verdict) +
    '; receipt: ' + JSON.stringify(printed))
  assert.deepEqual(printed.suite && printed.suite.unattributed, ['tests/other.py'],
    'leg (e) [M5]: the receipt\'s suite.unattributed is the list the report carried — got ' +
    JSON.stringify(printed.suite))
  assert.deepEqual(printed.suite, { passed: false, unattributed: ['tests/other.py'], output: 'x' },
    'leg (e) [M5]: the receipt\'s suite is the shared literal\'s shape, ' +
    '{"passed": false, "unattributed": ["tests/other.py"], "output": "x"} — got ' +
    JSON.stringify(printed.suite))
  assert.equal(code, 0,
    'leg (e) [M5]: exit 0 — got ' + code + '; receipt: ' + JSON.stringify(printed))
  assert.ok(saved !== null && saved.verdict === 'PASS',
    'leg (e) [M5]: the saved gate receipt records verdict PASS — ' + JSON.stringify(saved))
  assert.deepEqual(saved.suite && saved.suite.unattributed, ['tests/other.py'],
    'leg (e) [M5]: the saved gate receipt carries the same suite.unattributed — ' +
    JSON.stringify(saved.suite))
}

// …and an EMPTY `unattributed` blocks, as it does at BASE.
{
  const tests = { command: 'python3 -m pytest -q', passed: false,
                  unattributed: [], output: 'x' }
  const { code, printed, saved } = runGate('e-blocked', tests)

  assert.equal(printed.verdict, 'BLOCKED',
    'leg (e) [M5]: tests.passed false with unattributed [] writes BLOCKED, as it does at ' +
    'BASE — got ' + JSON.stringify(printed.verdict) + '; receipt: ' + JSON.stringify(printed))
  assert.equal(printed.suite && printed.suite.passed, false,
    'leg (e) [M5]: the blocked receipt still records suite.passed false — ' +
    JSON.stringify(printed.suite))
  assert.equal(code, 1,
    'leg (e) [M5]: exit 1 — got ' + code + '; receipt: ' + JSON.stringify(printed))
  assert.ok(saved !== null && saved.verdict === 'BLOCKED',
    'leg (e) [M5]: the saved gate receipt records verdict BLOCKED — ' + JSON.stringify(saved))
}

for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true })
console.log('ALL TESTS PASSED')
