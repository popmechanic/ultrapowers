/**
 * fleet/tests/test_run_record_keys.mjs — Task 4's exam: the run's report and
 * receipt carry no acceptance record.
 *
 * Claim: the engine writes none, the driver tees no acceptance log, and the
 * sandbox looks for none.
 *
 * The exam is written against the task's Machine clauses, leg by leg. Every
 * assertion names the leg it belongs to and the clause it comes from, so a
 * reader can map this file back to the contract:
 *
 *   M1  the engine's `report.json` for a one-task run has no `acceptance` key
 *       and still has `tests` with `command`, `passed`, `output`.
 *   M2  `run-main.mjs` exports neither `acceptanceWrap` nor `acceptanceLogPath`,
 *       writes no `acceptance-capture` stage, and leaves `receipt.json`'s
 *       `testCmd` byte-equal to the value `ultra_run.py` stamped (no `tee`, no
 *       `pipefail`) and its `acceptanceLog` key absent.
 *   M3  `sandbox-boot.sh` contains no `acceptance.log`, and its nothing-ahead
 *       park writes the error cell exactly
 *       `parked: <branch> has no commits ahead of base (verdict <v>)` with
 *       nothing appended.
 *   M4  for each of `fleet/referee.mjs`, `fleet/CONTRACT.md`,
 *       `fleet/failing-block.mjs`: the string `acceptance` does not occur; and
 *       `fleet/launch.mjs` does not contain the word `frozen`.
 *   M5  `fleet/tests/test_sandbox_boot_parked_error.mjs` is absent, and for each
 *       of `fleet/tests/test_run_engine.mjs`, `fleet/tests/test_run_main.mjs`,
 *       `fleet/tests/test_sandbox_boot_approval_evidence.mjs`: the sim prints
 *       `ALL TESTS PASSED`.
 *
 * Legs: (a) M1, (b) M2, (c) M3, (d) M4, (e) M5.
 *
 * Two drives below the seam, the way the Context names them: one engine run
 * through `_engine_helpers.mjs`'s rig (real git, real capture, canned
 * judgments) to a report, and one nothing-ahead park through
 * `_sandbox_boot_helpers.mjs`'s rig to its status cell. `runMain` is driven
 * over a stubbed `exec` — the receipt and the event log are files on disk
 * either way, which is what M2 measures. Nothing here spawns a sibling sim:
 * M5's three green sims are named and left to the bridge, which is what runs
 * them (the Proof's own `Run:` lines).
 *
 * The `acceptance` reads are case-INSENSITIVE. `fleet/referee.mjs`'s only
 * occurrence at BASE is `Acceptance` in the `INTEGRATED_SUITE` disposition
 * clause, so a case-sensitive read of M4 would already be satisfied there by a
 * file that still teaches the record. The clause is read as the word, and the
 * disposition clause is the sentence M4 is about.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { makeRepo, gitSync, rig, passReview, cleanCritic, doneImpl } from './_engine_helpers.mjs'
import {
  INTEGRATION_BRANCH,
  makeHome, boot, statusOf, states, runDir, runTests,
} from './_sandbox_boot_helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const FLEET = path.join(ROOT, 'fleet')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'run-record-keys-'))
const read = (file) => fs.readFileSync(file, 'utf8')

/** `grep -c <pattern> <file>`: the number of LINES the pattern matches. */
const grepCount = (file, re) => read(file).split('\n').filter((l) => re.test(l)).length
/** The matching lines themselves, so a failure names what is still there. */
const grepLines = (file, re) => read(file).split('\n')
  .map((l, i) => [i + 1, l])
  .filter(([, l]) => re.test(l))
  .map(([n, l]) => `${n}: ${l.trim()}`)

const tests = []
const test = (name, fn) => tests.push([name, fn])

// ── (a) the engine's report carries no acceptance record  [M1] ───────────────
//
// One task, one wave, a green suite. The rig hands `runEngine` an
// `acceptance: { mode: 'suite', reason: 'sim' }` in its args — `_engine_helpers.mjs`
// is outside this task's file scope, so it keeps doing so — which is exactly
// the input M1 says the report must no longer carry out. At BASE the key is
// there with `{ mode: 'suite', passed: true, reason: 'sim' }`; with the reader
// deleted it is not there at all (and `null` is not "no key": the engine's
// `acceptance` slot at BASE is `null` whenever no acceptance was handed in, so
// the leg is key ABSENCE, not a falsy value).

test('a one-task engine run\'s report has no acceptance key, and keeps tests  [M1 / leg (a)]', async () => {
  const repo = makeRepo(path.join(tmp, 'engine-repo'))
  const engineRun = path.join(tmp, 'engine-run')
  const waves = [[{
    id: 'T1', title: 'create one', files: ['one.txt'], tier: 'standard',
    review: 'lean', writes: ['one.txt'], commutes: [],
  }]]
  for (const w of waves) for (const t of w) t.body = 'sim task ' + t.id

  const stub = (prompt, opts, cwd) => {
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') {
      fs.writeFileSync(path.join(cwd, 'one.txt'), 'from T1\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }

  const { run, integ } = rig({
    repo, runDir: engineRun, waves, edges: [], stub, stamp: 'rk1',
    acceptance: { mode: 'suite', reason: 'sim' },
  })
  const report = await run()

  // The run really got as far as a report worth reading: one task merged, the
  // driver's own suite ran on the adopted tree. Without this the leg below
  // could pass on a report that is missing everything.
  assert.equal(report.coverage.tasks_merged, 1,
    'leg (a) [M1]: the one task merged — this is a report of a run that happened')
  assert.equal(gitSync(['show', 'ultra/integration-rk1:one.txt'], integ), 'from T1',
    'leg (a) [M1]: and the integrated tree holds its work')

  assert.equal('acceptance' in report, false,
    'leg (a) [M1]: the report has NO acceptance key — not a null one, not a waived/suite/sealed ' +
    'object. The engine was handed acceptance: { mode: "suite" } in its args and carried none of ' +
    'it out: ' + JSON.stringify(report.acceptance))

  assert.deepEqual(Object.keys(report.tests).sort(),
    ['command', 'output', 'passed', 'unattributed'],
    'leg (a) [M1]: and `tests` still carries exactly command, passed, output and (#871) the ' +
    'run\'s unattributed reds — the driver\'s own suite run on the adopted tree is what the ' +
    'record keeps: ' + JSON.stringify(report.tests))
  assert.equal(report.tests.command, 'bash check.sh',
    'leg (a) [M1]: tests.command is the suite command the run was given')
  assert.equal(report.tests.passed, true,
    'leg (a) [M1]: tests.passed is the DRIVER\'s result: ' + report.tests.output)
  assert.equal(typeof report.tests.output, 'string',
    'leg (a) [M1]: tests.output is the captured text')

  // The `suite` arm's judgment call went with the object it graded: a green
  // suite never pushed one at BASE either, so this can only fail on a build
  // that invented a new one.
  const suiteCalls = (report.judgmentCalls || []).filter((c) => /suite acceptance/i.test(String(c)))
  assert.deepEqual(suiteCalls, [],
    'leg (a) [M1]: no `suite acceptance did not pass …` judgment call survives — tests.passed is ' +
    'the report\'s record of the suite: ' + JSON.stringify(suiteCalls))
})

// ── (b) the driver tees nothing and rewrites no receipt  [M2] ────────────────
//
// One `runMain` drive over a stubbed `exec`. The receipt is read at the moment
// `ultra_gate.py` is invoked — that is the reader M2 is about — and once
// more from disk at the end of the run.

/** The value `ultra_run.py` stamps in this drive. Carries `&&` on purpose: the
 *  deleted wrapper existed to group exactly this shape, so a survivor shows. */
const STAMPED_TEST_CMD = 'bunx tsc --noEmit && bun test'

const WAVES = [[{
  id: 'T1', title: 't', files: ['a.txt'], tier: null,
  review: 'lean', writes: ['a.txt'], commutes: [],
}]]

/** git through the engine rig's own hermetic runner, in `exec`'s shape. */
const gitExec = (argv, cwd) => {
  try {
    return { code: 0, stdout: gitSync(argv, cwd) + '\n', stderr: '' }
  } catch (error) {
    return { code: 1, stdout: '', stderr: String((error && error.stderr) || (error && error.message) || error) }
  }
}

/** The stubbed scripts: ultra_run stamps the receipt once, the gate reads it. */
const makeExecStub = ({ repoDir, runId }) => {
  const runDirPath = path.join(repoDir, '.claude/ultrapowers', 'run-' + runId)
  const argsFile = path.join(runDirPath, 'args.json')
  /** Exactly what `ultra_run.py` wrote — the value every later reader owes. */
  const STAMPED = { ok: true, baseBranch: 'fleet-base', argsFile, testCmd: STAMPED_TEST_CMD, testCmdSource: 'plan' }
  const calls = []
  const seen = { gate: null }
  const snapReceipt = () => {
    try {
      return JSON.parse(read(path.join(runDirPath, 'receipt.json')))
    } catch {
      return null
    }
  }
  const exec = async (cmd, argv, opts) => {
    calls.push([cmd, ...argv])
    if (cmd === 'git') return gitExec(argv, opts && opts.cwd)
    if (cmd === 'claude' && argv[0] === 'auth') {
      return { code: 0, stdout: JSON.stringify({ authMethod: 'oauth', subscriptionType: 'max' }), stderr: '' }
    }
    const script = path.basename(String(argv[0] || ''))
    if (script === 'ultra_run.py' && argv.includes('--validate-knobs')) {
      return { code: 0, stdout: '{"ok": true}', stderr: '' }
    }
    if (script === 'ultra_run.py') {
      fs.mkdirSync(runDirPath, { recursive: true })
      fs.writeFileSync(argsFile, JSON.stringify({
        waves: WAVES, wavesPath: path.join(runDirPath, 'launch.json'),
        edges: [], acceptance: { mode: 'suite' }, waveLabels: ['w1'],
        globalConstraints: '', planPath: argv[1],
        pluginRoot: repoDir, runDir: runDirPath, testCmd: STAMPED_TEST_CMD,
      }))
      fs.writeFileSync(path.join(runDirPath, 'receipt.json'), JSON.stringify(STAMPED))
      return { code: 0, stdout: JSON.stringify(STAMPED), stderr: '' }
    }
    if (script === 'finalize_report.py') return { code: 0, stdout: '', stderr: '' }
    if (script === 'ultra_gate.py' && argv.includes('--approve')) {
      return { code: 0, stdout: JSON.stringify({ stamp: runId, branch: 'ultra/integration-' + runId }), stderr: '' }
    }
    if (script === 'ultra_gate.py') {
      // The one reader M2 is about: the receipt AS THE GATE SEES IT.
      seen.gate = snapReceipt()
      fs.writeFileSync(path.join(runDirPath, 'gate-receipt.json'), JSON.stringify({
        verdict: 'PASS', gateCheck: { verdict: 'PASS', checks: [], acks: [] }, gateCheckExit: 0,
      }))
      return { code: 0, stdout: '', stderr: '' }
    }
    throw new Error('exec stub: unexpected ' + cmd + ' ' + argv.join(' '))
  }
  return { exec, calls, runDirPath, seen, STAMPED }
}

test('run-main exports no acceptance wrapper and rewrites no receipt  [M2 / leg (b)]', async () => {
  // Dynamic, and read as a namespace: a static named import of a deleted export
  // would fail to LINK, which is a different failure from the one this leg is.
  const mod = await import('../run-main.mjs')
  assert.equal('acceptanceWrap' in mod, false,
    'leg (b) [M2]: run-main.mjs exports no acceptanceWrap — the #739 tee is gone, wrapper and all')
  assert.equal('acceptanceLogPath' in mod, false,
    'leg (b) [M2]: and no acceptanceLogPath')

  const repoDir = makeRepo(path.join(tmp, 'runmain-repo'))
  const runId = 'run-rk2'
  const { exec, runDirPath, seen, STAMPED } = makeExecStub({ repoDir, runId })
  const out = await mod.runMain(
    { planPath: 'plan.md', runId, repoDir, tier: 'mostCapable', overlap: null,
      testCmd: null, bootstrapCmd: null, cli: 'claude' },
    {
      exec,
      log: () => {},
      runEngineFn: async () => ({
        integrationBranch: 'ultra/integration-' + runId, waveMerges: [], tasks: [],
      }),
      makeAgent: (opts) => ({ agent: async () => null, patchInput: opts.patchesDir }),
    },
  )
  assert.equal(out.code, 0, 'leg (b) [M2]: the drive is green — ' + out.verdict + ': ' + out.detail)

  // 1. The receipt at the moment ultra_gate.py read it.
  const snap = seen.gate
  assert.ok(snap, 'leg (b) [M2]: the ultra_gate.py stub read a receipt.json — the reader is real')
  assert.equal(snap.testCmd, STAMPED_TEST_CMD,
    'leg (b) [M2]: the gate reads the value ultra_run.py stamped, byte for byte — no wrapper, no ' +
    'grouping, no redirection: ' + JSON.stringify(snap.testCmd))
  for (const forbidden of ['tee', 'pipefail']) {
    assert.equal(String(snap.testCmd).includes(forbidden), false,
      'leg (b) [M2]: the gate\'s command carries no `' + forbidden + '` substring: ' +
      JSON.stringify(snap.testCmd))
  }
  assert.equal('acceptanceLog' in snap, false,
    'leg (b) [M2]: and no acceptanceLog sibling key: ' + JSON.stringify(snap))
  assert.deepEqual(snap, STAMPED,
    'leg (b) [M2]: the receipt the gate reads IS the receipt ultra_run.py wrote — every key, every ' +
    'value, nothing added and nothing rewritten: ' + JSON.stringify(snap))

  // 2. The same file at the end of the run: written once, never rewritten.
  const onDisk = JSON.parse(read(path.join(runDirPath, 'receipt.json')))
  assert.deepEqual(onDisk, STAMPED,
    'leg (b) [M2]: and the file on disk when the run ends is still that receipt: ' +
    JSON.stringify(onDisk))

  // 3. The event log carries no acceptance-capture stage.
  const raw = read(path.join(runDirPath, 'events.jsonl'))
  const events = raw.split('\n').filter(Boolean).map((l) => JSON.parse(l))
  const stages = events.filter((e) => e.kind === 'driver:stage').map((e) => e.stage)
  assert.ok(stages.includes('gate') && stages.includes('approve'),
    'leg (b) [M2]: the drive reached the gate and the approve, so the stage list is the real one: ' +
    JSON.stringify(stages))
  assert.equal(stages.includes('acceptance-capture'), false,
    'leg (b) [M2]: and `acceptance-capture` is not among them — the stage went with the rewrite it ' +
    'narrated: ' + JSON.stringify(stages))
  const leaked = raw.split('\n').filter((l) => /acceptance/i.test(l))
  assert.deepEqual(leaked, [],
    'leg (b) [M2]: no line of the run\'s events.jsonl names an acceptance capture at all — not the ' +
    'stage, not its failure verdict: ' + JSON.stringify(leaked))
})

// ── (c) the boot script looks for no acceptance log  [M3] ────────────────────

const BOOT_SCRIPT = path.join(FLEET, 'sandbox-boot.sh')
/** `grep`'s own reading of `acceptance.log`: the `.` matches any character, so
 *  the shell variable `acceptance_log` is one of the hits the leg counts. */
const ACCEPTANCE_LOG_RE = /acceptance.log/

test('grep -c acceptance.log fleet/sandbox-boot.sh is 0  [M3 / leg (c)]', () => {
  assert.ok(fs.existsSync(BOOT_SCRIPT), 'leg (c) [M3]: fleet/sandbox-boot.sh is the boot the rig drives')
  assert.equal(grepCount(BOOT_SCRIPT, ACCEPTANCE_LOG_RE), 0,
    'leg (c) [M3]: the boot script names no acceptance.log — neither the evidence copy nor the ' +
    'parked arm\'s cut:\n  ' + grepLines(BOOT_SCRIPT, ACCEPTANCE_LOG_RE).join('\n  '))
  // The survivors: `failing_block`/`has_failing_block` are the publish fold's,
  // and the fold's `suite-<n>.txt` still calls them. A deletion that took them
  // out took a live reader with it.
  const boot = read(BOOT_SCRIPT)
  for (const name of ['failing_block', 'has_failing_block']) {
    assert.ok(boot.includes(name + '('),
      'leg (c) [M3]: `' + name + '` still exists in the boot script — the publish fold\'s ' +
      '`suite-<n>.txt` is a live caller and stays one')
  }
})

/** BASE's sentence, with the verdict both arms below run under. */
const VERDICT = 'NEEDS_ACK'
const SENTENCE =
  `parked: ${INTEGRATION_BRANCH} has no commits ahead of base (verdict ${VERDICT})`

/**
 * A pytest-shaped log with a failing test's block in the middle — the hostile
 * fixture. It is seeded at `<run dir>/acceptance.log`, the exact path the
 * deleted arm read, so a boot that still cuts a block appends one here and a
 * boot that has forgotten the file leaves the sentence whole.
 */
const ACCEPTANCE_TEXT = [
  '============================= test session starts ==============================',
  'platform linux -- Python 3.12.3',
  'collected 2 items',
  '',
  '=================================== FAILURES ===================================',
  '___________________________________ test_x _____________________________________',
  '',
  '    def test_x():',
  '>       assert 1 == 2',
  'E       assert 1 == 2',
  '',
  '=========================== short test summary info ============================',
  'FAILED tests/test_x.py::test_x - assert 1 == 2',
  '1 failed, 1 passed in 0.03s',
  '',
].join('\n')

/** The nothing-ahead park, with the log seeded or not. */
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

test('the nothing-ahead park writes exactly BASE\'s sentence  [M3 / leg (c)]', () => {
  const ctx = parkedRun(null)
  assert.deepEqual(states(ctx), ['booting', 'running', 'parked'],
    'leg (c) [M3]: the run still parks — the cell is the only thing in question')
  const status = statusOf(ctx)
  assert.equal(status.state, 'parked', 'leg (c) [M3]: state=parked')
  assert.equal(status.error, SENTENCE,
    'leg (c) [M3]: the error cell is exactly the sentence, and nothing follows the closing ' +
    'parenthesis: ' + JSON.stringify(status.error))
  assert.ok(status.error.endsWith(')'),
    'leg (c) [M3]: the cell ENDS at the closing parenthesis — no dash, no quotation, no trailing ' +
    'space: ' + JSON.stringify(status.error))
  assert.equal(status.pr, null, 'leg (c) [M3]: nothing was published')
})

test('a seeded acceptance.log adds nothing to the parked cell  [M3 / leg (c)]', () => {
  const ctx = parkedRun(ACCEPTANCE_TEXT)
  assert.equal(read(path.join(runDir(ctx), 'acceptance.log')), ACCEPTANCE_TEXT,
    'leg (c) [M3]: this arm really has a red acceptance.log on disk, at the path the deleted arm read')
  const status = statusOf(ctx)
  assert.equal(status.state, 'parked', 'leg (c) [M3]: state=parked')
  assert.equal(status.error, SENTENCE,
    'leg (c) [M3]: and the cell is STILL exactly the sentence — the boot looks for no such file, so ' +
    'a red one beside it changes nothing: ' + JSON.stringify(status.error))
  assert.equal(status.error.includes('test_x'), false,
    'leg (c) [M3]: the failing test is not quoted: ' + JSON.stringify(status.error))
  assert.equal(status.error.includes(' — '), false,
    'leg (c) [M3]: nothing is appended after the closing parenthesis: ' + JSON.stringify(status.error))
  assert.equal(status.pr, null, 'leg (c) [M3]: nothing was published')
})

// ── (d) the three files and the launcher's sentence  [M4] ────────────────────

const ACCEPTANCE_RE = /acceptance/i

for (const rel of ['referee.mjs', 'CONTRACT.md', 'failing-block.mjs']) {
  test(`fleet/${rel} carries zero occurrences of acceptance  [M4 / leg (d)]`, () => {
    const file = path.join(FLEET, rel)
    assert.ok(fs.existsSync(file), `leg (d) [M4]: fleet/${rel} is a deliverable of this task`)
    assert.equal(grepCount(file, ACCEPTANCE_RE), 0,
      `leg (d) [M4]: fleet/${rel} names no acceptance — the record is gone, so every sentence that ` +
      'taught it is rewritten or removed:\n  ' + grepLines(file, ACCEPTANCE_RE).join('\n  '))
  })
}

test('fleet/failing-block.mjs still names the call site that remains  [M4 / leg (d)]', () => {
  const file = path.join(FLEET, 'failing-block.mjs')
  const text = read(file)
  assert.ok(text.includes('publish-fold/suite-'),
    'leg (d) [M4]: the survivor is named — the header names `publish-fold/suite-<attempt>.txt`, the ' +
    'one record that still reads a red suite\'s output whole, rather than a list with a hole in it')
  assert.ok(/export\s+(?:const|function)\s+failingBlock/.test(text),
    'leg (d) [M4]: and `failingBlock` itself stays — the module has readers')
})

test('fleet/launch.mjs does not contain the word frozen  [M4 / leg (d)]', () => {
  const file = path.join(FLEET, 'launch.mjs')
  assert.ok(fs.existsSync(file), 'leg (d) [M4]: fleet/launch.mjs is a deliverable of this task')
  const FROZEN_RE = /frozen/i
  assert.equal(grepCount(file, FROZEN_RE), 0,
    'leg (d) [M4]: the launcher claims no frozen verification periphery:\n  ' +
    grepLines(file, FROZEN_RE).join('\n  '))
  // The survivor named: the copy stays, and so does the reason it is a copy —
  // the launcher spawns no python, and the Python ladder is the one the sandbox
  // runs. A sentence deleted whole would take that with it.
  const text = read(file)
  assert.ok(text.includes('detect_test_cmd'),
    'leg (d) [M4]: `detect_test_cmd` is still named — the mirrored ladder says what it mirrors')
  assert.ok(text.includes('ultra_run.py'),
    'leg (d) [M4]: and `ultra_run.py` is still named as where that one lives')
})

// ── (e) the sim the arm existed for is gone; the others stay  [M5] ───────────
//
// Named and not run: the bridge (tests/test_fleet_suite.py) collects every
// fleet/tests/test_*.mjs and dispatches each on a worker of its own, and the
// Proof's three `Run:` lines are where their `ALL TESTS PASSED` is graded. A
// sim that spawned them here would run them twice, in whatever environment this
// process carries.

test('fleet/tests/test_sandbox_boot_parked_error.mjs is absent  [M5 / leg (e)]', () => {
  const gone = path.join(HERE, 'test_sandbox_boot_parked_error.mjs')
  assert.equal(fs.existsSync(gone), false,
    'leg (e) [M5]: the sim existed only for the acceptance.log arm of the nothing-ahead park; with ' +
    'the arm deleted it is a test with nothing left to grade, and a deletion is whole')
})

test('the three sims the Proof runs are still there for the bridge  [M5 / leg (e)]', () => {
  for (const sim of ['test_run_engine.mjs', 'test_run_main.mjs', 'test_sandbox_boot_approval_evidence.mjs']) {
    assert.ok(fs.existsSync(path.join(HERE, sim)),
      `leg (e) [M5]: fleet/tests/${sim} is still a sim under fleet/tests/, collected and dispatched ` +
      'by the bridge, which is where its ALL TESTS PASSED is graded')
  }
})

runTests(tests).then(() => fs.rmSync(tmp, { recursive: true, force: true }))
