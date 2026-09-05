// fleet/tests/test_run_engine_pre_review.mjs — the driver runs every check
// BEFORE any referee reads the patch.
//
// #604 said the driver's own execution is authoritative and applied it to the
// Proof's `Run:` commands. This extends the same rule to the Global
// Constraints' `Check:` commands, and moves both to where they buy something:
// a red command is repaired by a `fix:<id>:0` round before a reviewer-minute is
// ever spent on the patch, and what the referee then reads is the bytes of a
// pass the driver ran itself.
//
// Machine clauses under test (legs (a)–(d) of the Proof):
//   M1 — `args.constraintChecks` reads as an array of { cmd, minor } (empty or
//        non-string `cmd` dropped, `minor` coerced to boolean, malformed reads
//        as []); after the implementer's patch is captured and BEFORE any
//        `review:` worker is dispatched, the driver runs each `proofRuns`
//        command and then each check in the task's own clone, appending one
//        `driver:proof-run` { task, cmd, exit, iter: 0 } and one
//        `driver:check-run` { task, cmd, exit, minor, iter: 0 } per command.
//   M2 — a red Run: or a red non-minor Check: dispatches exactly one
//        `fix:<id>:0` round with the verbatim blocking lines, re-captures and
//        repeats the pass; still red ⇒ `status: 'failed'`,
//        `reviewVerdict: 'proof-red'`, `proofFixes: 1` and no review at all;
//        green ⇒ review proceeds with `proofFixes: 1`. An all-green first pass
//        dispatches no fix and reports `proofFixes: 0`. A red MINOR check
//        never dispatches a fix; it pushes one judgment call.
//   M3 — every review round re-executes both, and the reviewer prompt carries
//        the CHECK EVIDENCE block directly after the RUN EVIDENCE block; a red
//        non-minor check in a review round is a blocking issue exactly as a red
//        Run: is; with no checks the block is absent.
//   M4 — after adopt, each check runs once more in the integration clone under
//        `report.integratedChecks` + one `driver:integrated-check` event per
//        command; a non-zero non-minor exit is the typed #474 blocking
//        completeness finding, a minor one a judgment call only; the critic
//        prompt carries the INTEGRATED CHECK EVIDENCE block directly after the
//        INTEGRATED RUN EVIDENCE one.
//
// Everything below the agent seam is real (git, clones, capture, the fold
// kernel, the real `sh`), so every command execution these assertions observe
// is the driver's own.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { criticDecision } from '../run-main.mjs'
// Namespace import on purpose: at BASE the module provides neither
// `checkEvidenceBlock` nor `integratedCheckEvidenceBlock`, and a named import
// would fail to LINK — the whole file would die with a SyntaxError that reads
// like a typo instead of like the absent implementation. The first assertions
// below name them instead.
import * as engineMod from '../run-engine.mjs'
import { rig, makeRepo, gitSync, passReview, cleanCritic, doneImpl } from './_engine_helpers.mjs'

const { checkEvidenceBlock, integratedCheckEvidenceBlock, loadRoles } = engineMod
const roles = loadRoles()

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-pre-review-'))
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }))

// [M3] the per-task block's opening sentence, verbatim from the Machine
// clause. A block that renders a *similar* sentence is not this leg.
const OPENER =
  'CHECK EVIDENCE: the driver executed each Global Constraints `Check:` command itself, ' +
  'in this task\'s own clone, on the tree the patch above describes — stdout and stderr ' +
  'combined, last 4,000 characters. A blocking check that exited non-zero is already the ' +
  'fix loop\'s; a check marked (minor) is recorded here for the referee\'s attention and ' +
  'blocks nothing.'
// [M4] the critic-side block's opening sentence, verbatim.
const INTEGRATED_OPENER =
  'INTEGRATED CHECK EVIDENCE: the driver executed each Global Constraints `Check:` command ' +
  'itself, on the adopted integration tree — this is the authoritative result.'

// [M2] the two blocking lines the fix round reads as its instructions, and the
// output header that follows each one. Literals, per the task's Context.
const runFailLine = (cmd, n) => '- the Proof\'s Run: command failed: ' + cmd + ' — exit ' + n
const checkFailLine = (cmd, n) => '- the Global Constraints Check: command failed: ' + cmd +
  ' — exit ' + n
const OUTPUT_HEADER = '\n  output (last 4,000 characters):\n'
const BLOCKING_HEADER = '\n\nBlocking issues to resolve:\n'

// makeRepo's BASE already carries a.txt, so `test -e a.txt` would be green
// before any implementer ran. These scenarios need it ABSENT at BASE — that is
// what makes "the implementer writes a.txt" the thing the command measures.
const bareRepo = (dir) => {
  makeRepo(dir)
  gitSync(['rm', '-q', 'a.txt'], dir)
  gitSync(['commit', '-q', '-m', 'drop a.txt'], dir)
  return dir
}
const mkTask = (id, files, over = {}) => ({
  id, title: id.toLowerCase(), files, tier: 'standard', review: 'lean',
  writes: files, commutes: [], proofTests: [], proofRuns: [],
  body: 'task ' + id + ' body', ...over,
})
const write = (cwd, name, content = 'x\n') => fs.writeFileSync(path.join(cwd, name), content)

// The run's own record. An absent file reads as no records, so a BASE engine
// that writes none fails a count assertion rather than an ENOENT.
const eventsOf = (runDir) => {
  const file = path.join(runDir, 'events.jsonl')
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l) } catch { return null } })
    .filter(Boolean)
}
const ofKind = (runDir, kind) => eventsOf(runDir).filter((e) => e.kind === kind)
// The fields the Machine clauses name, so an event carrying them plus the
// appendEvent stamp (id, ts) still compares equal.
const runShape = (e) => ({ kind: e.kind, task: e.task, cmd: e.cmd, exit: e.exit, iter: e.iter })
const checkShape = (e) => ({ kind: e.kind, task: e.task, cmd: e.cmd, exit: e.exit,
                             minor: e.minor, iter: e.iter })

// ── the Produces contract, as two pure functions [M3, M4] ────────────────────
{
  assert.equal(typeof checkEvidenceBlock, 'function',
    'fleet/run-engine.mjs exports no `checkEvidenceBlock(checks) -> string` ' +
    '(the task\'s Produces contract)')
  assert.equal(typeof integratedCheckEvidenceBlock, 'function',
    'fleet/run-engine.mjs exports no `integratedCheckEvidenceBlock(checks) -> string` ' +
    '(the task\'s Produces contract)')

  // The run-51 rule the global constraints restate: empty evidence renders
  // nothing at all, so a run with no checks keeps BASE's prompts byte for byte.
  for (const [name, fn] of [['checkEvidenceBlock', checkEvidenceBlock],
                            ['integratedCheckEvidenceBlock', integratedCheckEvidenceBlock]]) {
    assert.equal(fn([]), '', name + ': no checks renders nothing')
    assert.equal(fn(undefined), '', name + ': undefined renders nothing')
    assert.equal(fn(null), '', name + ': null renders nothing')
  }

  const sample = [
    { cmd: 'test -e c.txt', exit: 0, stdout: '', minor: false },
    { cmd: 'grep -q needle f.txt', exit: 2, stdout: 'boom-marker\n', minor: true },
  ]
  for (const [name, fn, opener] of [
    ['checkEvidenceBlock', checkEvidenceBlock, OPENER],
    ['integratedCheckEvidenceBlock', integratedCheckEvidenceBlock, INTEGRATED_OPENER],
  ]) {
    const out = fn(sample)
    assert.equal(typeof out, 'string', name + ': the block is a string')
    assert.equal(out.trimStart().slice(0, opener.length), opener,
      name + ' must BEGIN with the sentence the Machine clause fixes, verbatim:\nwant: ' +
      opener + '\ngot:  ' + out.trimStart().slice(0, opener.length))
    const iFirst = out.indexOf('$ test -e c.txt')
    const iSecond = out.indexOf('$ grep -q needle f.txt')
    assert.ok(iFirst > 0, name + ': the first command is quoted as `$ <cmd>`: ' + out)
    assert.ok(iSecond > iFirst, name + ': the second command follows the first: ' + out)
    const first = out.slice(iFirst, iSecond)
    const second = out.slice(iSecond)
    assert.ok(first.includes('exit 0'), name + ': each command carries its own exit line: ' + first)
    assert.ok(!first.includes('(minor)'),
      name + ': a blocking check is NOT marked (minor): ' + first)
    assert.ok(second.includes('exit 2 (minor)'),
      name + ': a minor check renders `exit <n> (minor)`: ' + second)
    assert.ok(second.indexOf('boom-marker') > second.indexOf('exit 2'),
      name + ': the recorded output follows the exit line, not only the exit line: ' + second)
  }
}

// ── leg (a): what the pre-review pass reads and records [M1] ─────────────────
{
  const repo = bareRepo(path.join(tmp, 'repo-a1'))
  const runDir = path.join(tmp, 'run-a1')
  const waves = [[mkTask('T1', ['a.txt'], { proofRuns: ['test -e a.txt'] })]]
  const CHECKS = [
    { cmd: 'test -e c.txt', minor: false },
    { cmd: 'test -e m.txt', minor: true },
    { cmd: '', minor: false },
    { cmd: 7 },
  ]
  const calls = []
  // The events already on disk when each dispatch happened: worker events are
  // the worker's, not the engine's, so this is how a sim proves ORDER.
  const before = {}
  const stub = (prompt, opts, cwd) => {
    calls.push(opts.label)
    before[opts.label] = eventsOf(runDir)
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') { write(cwd, 'a.txt'); return doneImpl(cwd) }
    if (kind === 'fix') { write(cwd, 'c.txt'); return doneImpl(cwd) }
    if (kind === 'review') return passReview()
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run } = rig({ repo, runDir, waves, stub, stamp: 'pr1',
                        extraArgs: { shallowLeg: false, constraintChecks: CHECKS } })
  const report = await run()

  // The pre-review pass ran before ANY review worker was dispatched.
  const firstReview = calls.findIndex((l) => l.startsWith('review:'))
  assert.ok(firstReview !== -1, 'sim precondition: a review round was reached: ' + calls.join(','))
  assert.ok(calls.indexOf('fix:T1:0') !== -1 && calls.indexOf('fix:T1:0') < firstReview,
    'the `fix:<id>:0` round runs before any review: ' + calls.join(','))
  const pre = before['fix:T1:0'] || []
  assert.deepEqual(pre.map((e) => (e.kind === 'driver:check-run' ? checkShape(e) : runShape(e))), [
    { kind: 'driver:proof-run', task: 'T1', cmd: 'test -e a.txt', exit: 0, iter: 0 },
    { kind: 'driver:check-run', task: 'T1', cmd: 'test -e c.txt', exit: 1, minor: false, iter: 0 },
    { kind: 'driver:check-run', task: 'T1', cmd: 'test -e m.txt', exit: 1, minor: true, iter: 0 },
  ], 'the Run: command runs first, then each well-formed Check: in order, all at iter 0, ' +
     'and all of it before the patch reaches a referee: ' + JSON.stringify(pre))

  // [M1] the malformed entries are dropped, not run and not recorded.
  for (const e of ofKind(runDir, 'driver:check-run')) {
    assert.ok(e.cmd === 'test -e c.txt' || e.cmd === 'test -e m.txt',
      'an empty or non-string `cmd` must be dropped, never executed: ' + JSON.stringify(e))
  }
  assert.equal(report.tasks[0].proofFixes, 1, 'the repaired task reports one proof fix')
}

// [M1] a malformed `constraintChecks` reads as [] — no check runs, nothing throws.
{
  const repo = bareRepo(path.join(tmp, 'repo-a2'))
  const runDir = path.join(tmp, 'run-a2')
  const waves = [[mkTask('T1', ['a.txt'])]]
  const stub = (prompt, opts, cwd) => {
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') { write(cwd, 'a.txt'); return doneImpl(cwd) }
    if (kind === 'review') return passReview()
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run } = rig({ repo, runDir, waves, stub, stamp: 'pr2',
                        extraArgs: { shallowLeg: false, constraintChecks: 'nope' } })
  const report = await run()
  assert.equal(report.coverage.complete, true,
    'a malformed constraintChecks must not fail the run')
  assert.deepEqual(ofKind(runDir, 'driver:check-run'), [],
    'a malformed constraintChecks records no check event')
  assert.deepEqual(ofKind(runDir, 'driver:integrated-check'), [],
    'a malformed constraintChecks records no integrated-check event')
  assert.deepEqual(report.integratedChecks, [],
    'and leaves `integratedChecks` as []: ' + JSON.stringify(report.integratedChecks))
}

// [M1] `minor` is coerced to a boolean — absent reads false, truthy reads true.
{
  const repo = bareRepo(path.join(tmp, 'repo-a3'))
  const runDir = path.join(tmp, 'run-a3')
  const waves = [[mkTask('T1', ['a.txt'])]]
  const stub = (prompt, opts, cwd) => {
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') { write(cwd, 'a.txt'); return doneImpl(cwd) }
    if (kind === 'review') return passReview()
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run } = rig({ repo, runDir, waves, stub, stamp: 'pr3',
                        extraArgs: { shallowLeg: false, constraintChecks: [
                          { cmd: 'test -e a.txt' },
                          { cmd: 'test -e z.txt', minor: 1 },
                        ] } })
  const report = await run()
  assert.deepEqual(ofKind(runDir, 'driver:check-run').filter((e) => e.iter === 0).map(checkShape), [
    { kind: 'driver:check-run', task: 'T1', cmd: 'test -e a.txt', exit: 0, minor: false, iter: 0 },
    { kind: 'driver:check-run', task: 'T1', cmd: 'test -e z.txt', exit: 1, minor: true, iter: 0 },
  ], 'an absent `minor` reads false and a truthy one reads true — booleans, not the raw value')
  assert.equal(report.integratedChecks.every((c) => typeof c.minor === 'boolean'), true,
    'the integrated records carry the coerced boolean too: ' + JSON.stringify(report.integratedChecks))
}

// ── leg (b): a red non-minor Check: is repaired before review [M2] ───────────
{
  const repo = bareRepo(path.join(tmp, 'repo-b1'))
  const runDir = path.join(tmp, 'run-b1')
  const waves = [[
    mkTask('T1', ['a.txt'], { proofRuns: ['test -e a.txt'],
                              interfaces: { produces: ['thing(x) -> y'] } }),
    // A sibling, so the fix prompt has a SIBLING FILES block to carry. Its own
    // checks are red and its fix writes nothing, so it never merges — this
    // scenario asserts nothing about T2's row.
    mkTask('T2', ['b.txt']),
  ]]
  const CHECKS = [{ cmd: 'test -e c.txt', minor: false }, { cmd: 'test -e m.txt', minor: true }]
  const calls = []
  const prompts = {}
  const stub = (prompt, opts, cwd) => {
    calls.push(opts.label)
    prompts[opts.label] = prompt
    const kind = opts.label.split(':')[0]
    const id = opts.label.split(':')[1]
    if (kind === 'impl') { write(cwd, id === 'T1' ? 'a.txt' : 'b.txt'); return doneImpl(cwd) }
    if (kind === 'fix') { if (id === 'T1') write(cwd, 'c.txt'); return doneImpl(cwd) }
    if (kind === 'review') return passReview()
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run } = rig({ repo, runDir, waves, stub, stamp: 'pr4',
                        extraArgs: { shallowLeg: false, constraintChecks: CHECKS,
                                     globalConstraints: 'the periphery is frozen' } })
  const report = await run()

  // [M2] exactly one fix round, at iter 0, between the implementer and the review.
  assert.deepEqual(calls.filter((l) => l.includes('T1') && !l.startsWith('exam:')),
    ['impl:T1', 'fix:T1:0', 'review:T1:1'],
    'the red check is repaired before the referee reads anything: ' + calls.join(','))

  // [M2] the fix prompt: the role, the standard input blocks, then the
  // blocking line the Machine clause fixes verbatim.
  const fixPrompt = prompts['fix:T1:0']
  assert.ok(fixPrompt.startsWith(roles.fix),
    'the `fix:<id>:0` prompt begins with the fix role text')
  assert.ok(fixPrompt.includes('\nTEST COMMAND: bash check.sh'), 'it carries the TEST COMMAND line')
  assert.ok(fixPrompt.includes('\nFILES: a.txt'), 'it carries the FILES line')
  assert.ok(fixPrompt.includes('\nSIBLING FILES: T2: b.txt'), 'it carries the SIBLING FILES line')
  assert.ok(fixPrompt.includes('\nGLOBAL CONSTRAINTS:\nthe periphery is frozen'),
    'it carries the GLOBAL CONSTRAINTS block')
  assert.ok(fixPrompt.includes('\nINTERFACES:\nProduces: thing(x) -> y'),
    'it carries the INTERFACES block')
  assert.ok(fixPrompt.includes(BLOCKING_HEADER + checkFailLine('test -e c.txt', 1) + OUTPUT_HEADER),
    'the blocking section is the Machine clause\'s literal, followed by the output header:\n' +
    'want: ' + JSON.stringify(BLOCKING_HEADER + checkFailLine('test -e c.txt', 1) + OUTPUT_HEADER) +
    '\ngot:  ' + JSON.stringify(fixPrompt.slice(fixPrompt.indexOf(BLOCKING_HEADER))))
  assert.ok(!fixPrompt.includes('- the Proof\'s Run:'),
    'the green Run: command is not a blocking issue: ' + fixPrompt.slice(-400))
  assert.ok(!fixPrompt.includes('test -e m.txt'),
    'a MINOR check never reaches the fix round: ' + fixPrompt.slice(-400))

  // [M2] the pass repeats after the re-capture, still at iter 0, and the green
  // second reading is what the review round follows.
  const zero = ofKind(runDir, 'driver:check-run')
    .filter((e) => e.task === 'T1' && e.cmd === 'test -e c.txt' && e.iter === 0)
  assert.deepEqual(zero.map((e) => e.exit), [1, 0],
    'the check is executed once before the fix and once after it, both at iter 0: ' +
    JSON.stringify(zero))
  const evs = eventsOf(runDir)
  const iSecondPass = evs.findIndex((e) => e.kind === 'driver:check-run' && e.task === 'T1' &&
    e.cmd === 'test -e c.txt' && e.iter === 0 && e.exit === 0)
  assert.ok(iSecondPass !== -1 && iSecondPass < evs.findIndex((e) => e.iter === 1 && e.task === 'T1'),
    'the green second pass precedes the review round\'s own execution')

  const row = report.tasks.find((r) => r.task === 'T1')
  assert.equal(row.status, 'done', 'the repaired task merges: ' + JSON.stringify(row))
  assert.equal(row.reviewVerdict, 'clean', 'its first review round is still its first')
  assert.equal(row.proofFixes, 1, 'one pre-review fix round is recorded as proofFixes: 1')
  assert.equal(row.fixIterations, 0, 'a pre-review repair is not a review fix iteration')
}

// [M2] the second pass is still red: no review is ever dispatched.
{
  const repo = bareRepo(path.join(tmp, 'repo-b2'))
  const runDir = path.join(tmp, 'run-b2')
  const waves = [[mkTask('T1', ['a.txt'])]]
  const calls = []
  const stub = (prompt, opts, cwd) => {
    calls.push(opts.label)
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') { write(cwd, 'a.txt'); return doneImpl(cwd) }
    if (kind === 'fix') return doneImpl(cwd)          // repairs nothing
    if (kind === 'review') return passReview()
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run } = rig({ repo, runDir, waves, stub, stamp: 'pr5',
                        extraArgs: { shallowLeg: false,
                                     constraintChecks: [{ cmd: 'test -e c.txt', minor: false }] } })
  const report = await run()
  const row = report.tasks.find((r) => r.task === 'T1')
  assert.equal(row.status, 'failed', 'a check that stays red fails the task: ' + JSON.stringify(row))
  assert.equal(row.reviewVerdict, 'proof-red', 'the verdict names why: ' + JSON.stringify(row))
  assert.equal(row.proofFixes, 1, 'the one fix round it did get is recorded')
  assert.ok(String(row.notes).includes('test -e c.txt') && String(row.notes).includes('exit 1'),
    'the notes name the red command and its exit: ' + JSON.stringify(row.notes))
  assert.deepEqual(calls.filter((l) => l.startsWith('review:')), [],
    'no reviewer-minute is spent on a patch whose checks are red: ' + calls.join(','))
  assert.equal(report.coverage.tasks_merged, 0, 'and nothing merges')
}

// [M2] the same shape for a red `Run:` — repaired, then reviewed.
{
  const repo = bareRepo(path.join(tmp, 'repo-b3'))
  const runDir = path.join(tmp, 'run-b3')
  const waves = [[mkTask('T1', ['a.txt'], { proofRuns: ['test -e a.txt'] })]]
  const calls = []
  const prompts = {}
  const stub = (prompt, opts, cwd) => {
    calls.push(opts.label)
    prompts[opts.label] = prompt
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') return doneImpl(cwd)          // writes nothing: a.txt is absent
    if (kind === 'fix') { write(cwd, 'a.txt'); return doneImpl(cwd) }
    if (kind === 'review') return passReview()
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run } = rig({ repo, runDir, waves, stub, stamp: 'pr6',
                        extraArgs: { shallowLeg: false } })
  const report = await run()
  assert.deepEqual(calls.filter((l) => !l.startsWith('exam:') && l !== 'integration'),
    ['impl:T1', 'fix:T1:0', 'review:T1:1'],
    'a red Run: is repaired before the review too: ' + calls.join(','))
  assert.ok(prompts['fix:T1:0'].includes(
    BLOCKING_HEADER + runFailLine('test -e a.txt', 1) + OUTPUT_HEADER),
    'the Run: blocking line is the Machine clause\'s literal:\n' +
    JSON.stringify(prompts['fix:T1:0'].slice(-400)))
  const zero = ofKind(runDir, 'driver:proof-run').filter((e) => e.iter === 0)
  assert.deepEqual(zero.map((e) => e.exit), [1, 0],
    'the Run: is executed once before the fix and once after, both at iter 0: ' +
    JSON.stringify(zero))
  assert.equal(report.tasks.find((r) => r.task === 'T1').proofFixes, 1,
    'the merged row carries proofFixes 1')
  assert.equal(report.tasks.find((r) => r.task === 'T1').status, 'done', 'and it merged')
}

// [M2] a Run: that stays red ends the task the same way a Check: does.
{
  const repo = bareRepo(path.join(tmp, 'repo-b4'))
  const runDir = path.join(tmp, 'run-b4')
  const waves = [[mkTask('T1', ['a.txt'], { proofRuns: ['test -e a.txt'] })]]
  const calls = []
  const stub = (prompt, opts, cwd) => {
    calls.push(opts.label)
    const kind = opts.label.split(':')[0]
    if (kind === 'impl' || kind === 'fix') return doneImpl(cwd)
    if (kind === 'review') return passReview()
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run } = rig({ repo, runDir, waves, stub, stamp: 'pr7',
                        extraArgs: { shallowLeg: false } })
  const report = await run()
  const row = report.tasks.find((r) => r.task === 'T1')
  assert.equal(row.status, 'failed', JSON.stringify(row))
  assert.equal(row.reviewVerdict, 'proof-red', JSON.stringify(row))
  assert.equal(row.proofFixes, 1, JSON.stringify(row))
  assert.ok(String(row.notes).includes('test -e a.txt') && String(row.notes).includes('exit 1'),
    'the notes name the red command and its exit: ' + JSON.stringify(row.notes))
  assert.deepEqual(calls.filter((l) => l.startsWith('review:')), [],
    'no review is dispatched: ' + calls.join(','))
}

// ── legs (b) + (c): an all-green pass, a red minor, and what the referee reads
{
  const repo = bareRepo(path.join(tmp, 'repo-b5'))
  const runDir = path.join(tmp, 'run-b5')
  const waves = [[mkTask('T1', ['a.txt'], { proofRuns: ['test -e a.txt'] })]]
  const CHECKS = [{ cmd: 'test -e c.txt', minor: false }, { cmd: 'test -e m.txt', minor: true }]
  const calls = []
  const prompts = {}
  const stub = (prompt, opts, cwd) => {
    calls.push(opts.label)
    prompts[opts.label] = prompt
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') { write(cwd, 'a.txt'); write(cwd, 'c.txt'); return doneImpl(cwd) }
    if (kind === 'review') return passReview()
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run } = rig({ repo, runDir, waves, stub, stamp: 'pr8',
                        extraArgs: { shallowLeg: false, constraintChecks: CHECKS } })
  const report = await run()

  // [M2] a green first pass costs no fix round; a red MINOR check never does.
  assert.deepEqual(calls.filter((l) => l.startsWith('fix:')), [],
    'a minor check that exits non-zero must not dispatch a fix: ' + calls.join(','))
  const row = report.tasks.find((r) => r.task === 'T1')
  assert.equal(row.status, 'done', 'the task merges: ' + JSON.stringify(row))
  assert.equal(row.proofFixes, 0, 'and reports proofFixes 0')

  // [M2] one judgment call, the Machine clause's literal, exactly once — not
  // once per pass and not once per review round (leg (b): "`judgmentCalls`
  // contains exactly one string matching ...").
  const WANT = 'task T1: minor Check: `test -e m.txt` exited 1'
  const minorCalls = report.judgmentCalls.filter((j) => String(j).includes(WANT))
  assert.equal(minorCalls.length, 1,
    'a red minor check pushes exactly one judgment call, verbatim `' + WANT + '`: ' +
    JSON.stringify(report.judgmentCalls))
  assert.ok(String(minorCalls[0]).startsWith(WANT),
    'and it begins with that literal: ' + JSON.stringify(minorCalls[0]))

  // [M3] the review round re-executes both, at its own iter.
  assert.deepEqual(ofKind(runDir, 'driver:check-run').filter((e) => e.iter === 1).map(checkShape), [
    { kind: 'driver:check-run', task: 'T1', cmd: 'test -e c.txt', exit: 0, minor: false, iter: 1 },
    { kind: 'driver:check-run', task: 'T1', cmd: 'test -e m.txt', exit: 1, minor: true, iter: 1 },
  ], 'each review round runs the checks again, carrying the round number')

  // [M3] the reviewer prompt: RUN EVIDENCE, then the CHECK EVIDENCE block.
  const rp = prompts['review:T1:1']
  const iRun = rp.indexOf('RUN EVIDENCE: the driver executed each of the Proof\'s `Run:` commands')
  const iCheck = rp.indexOf(OPENER)
  assert.ok(iRun > 0, 'sim precondition: the RUN EVIDENCE block is still rendered')
  assert.ok(iCheck > iRun,
    'the CHECK EVIDENCE block\'s opening sentence must follow the RUN EVIDENCE block, verbatim:\n' +
    OPENER + '\n\ngot tail:\n' + rp.slice(-800))
  const seg = rp.slice(iCheck)
  const iC = seg.indexOf('$ test -e c.txt')
  const iM = seg.indexOf('$ test -e m.txt')
  assert.ok(iC > 0 && iM > iC, 'the checks are quoted in check order: ' + seg)
  assert.ok(seg.slice(iC, iM).includes('exit 0'), 'the green check renders `exit 0`: ' + seg)
  assert.ok(seg.slice(iM).includes('exit 1 (minor)'),
    'the minor check renders `exit 1 (minor)`: ' + seg.slice(iM))
  // Exact: the prompt's tail IS the exported renderer's output for this run's
  // own evidence — "directly after the RUN EVIDENCE block", to the byte.
  assert.ok(rp.endsWith(checkEvidenceBlock([
    { cmd: 'test -e c.txt', exit: 0, stdout: '', minor: false },
    { cmd: 'test -e m.txt', exit: 1, stdout: '', minor: true },
  ])), 'the reviewer prompt must END with `checkEvidenceBlock` of the round\'s own evidence: ' +
       JSON.stringify(rp.slice(-300)))
}

// ── leg (c): a check that goes red inside a review round is a blocking issue ──
// The pre-review pass and the review round differ only in time, so the tree has
// to change between them — and the only actor between them is a command the
// driver itself runs. This Run: is a no-op the first time and deletes c.txt the
// second, which is exactly the "green in the clone the implementer left, red
// when the referee is about to read it" case the clause is about.
{
  const TOGGLE = "sh -c 'if [ -e seen.txt ]; then rm -f c.txt; else : > seen.txt; fi'"
  const repo = bareRepo(path.join(tmp, 'repo-c2'))
  const runDir = path.join(tmp, 'run-c2')
  const waves = [[mkTask('T1', ['a.txt'], { proofRuns: [TOGGLE] })]]
  const calls = []
  const prompts = {}
  const stub = (prompt, opts, cwd) => {
    calls.push(opts.label)
    prompts[opts.label] = prompt
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') { write(cwd, 'a.txt'); write(cwd, 'c.txt'); return doneImpl(cwd) }
    if (kind === 'fix') return doneImpl(cwd)
    if (kind === 'review') return passReview()          // the referee says PASS anyway
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run } = rig({ repo, runDir, waves, stub, stamp: 'pr9',
                        extraArgs: { shallowLeg: false,
                                     constraintChecks: [{ cmd: 'test -e c.txt', minor: false }] } })
  await run()
  assert.deepEqual(ofKind(runDir, 'driver:check-run').filter((e) => e.iter === 0).map((e) => e.exit),
    [0], 'sim precondition: the pre-review pass was green, so no fix:T1:0 ran')
  assert.ok(!calls.includes('fix:T1:0'), 'sim precondition: no pre-review fix: ' + calls.join(','))
  assert.ok(calls.includes('fix:T1:1'),
    'a check that exits non-zero in a review round drives the fix round exactly as a red ' +
    'Run: does, whatever the reviewer returned: ' + calls.join(','))
  assert.ok(prompts['fix:T1:1'].includes(checkFailLine('test -e c.txt', 1)),
    'and the fix round is told which check failed, in the same words: ' +
    JSON.stringify(prompts['fix:T1:1'].slice(-500)))
}

// ── legs (c) + (d): no checks ⇒ no block anywhere, and an empty report key ────
{
  const repo = bareRepo(path.join(tmp, 'repo-c3'))
  const runDir = path.join(tmp, 'run-c3')
  const waves = [[mkTask('T1', ['a.txt'], { proofRuns: ['test -e a.txt'] })]]
  const prompts = {}
  const stub = (prompt, opts, cwd) => {
    prompts[opts.label] = prompt
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') { write(cwd, 'a.txt'); return doneImpl(cwd) }
    if (kind === 'review') return passReview()
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run } = rig({ repo, runDir, waves, stub, stamp: 'pr10',
                        extraArgs: { shallowLeg: false } })
  const report = await run()
  assert.equal(report.coverage.complete, true, 'sim precondition: the task merged')
  // A RENDERED block is what this leg forbids, and a rendered block opens with
  // the colon: `CHECK EVIDENCE:`. The role cards carry standing prose naming
  // the block they may be handed ("CHECK EVIDENCE, when present, is ...") the
  // same way they already do for RUN EVIDENCE, and that prose is in every
  // reviewer prompt whether or not the run declared any checks — so the colon
  // is the discriminator here, exactly as in test_run_engine_proof_runs.mjs.
  for (const [label, p] of Object.entries(prompts)) {
    assert.ok(!String(p).includes('CHECK EVIDENCE:'),
      'with no constraintChecks no prompt may carry a check block — ' + label +
      ' does (the run-51 rule: empty evidence renders nothing)')
  }
  assert.deepEqual(report.integratedChecks, [], 'and `integratedChecks` is []')
  assert.deepEqual(ofKind(runDir, 'driver:integrated-check'), [],
    'and no driver:integrated-check event is written')
}

// ── leg (d): the adopted tree is checked once more [M4] ──────────────────────
{
  const repo = bareRepo(path.join(tmp, 'repo-d1'))
  const runDir = path.join(tmp, 'run-d1')
  const waves = [[mkTask('A', ['a.txt'])]]
  const CHECKS = [{ cmd: 'test -e a.txt', minor: false }, { cmd: 'test -e z.txt', minor: true }]
  const stub = (prompt, opts, cwd) => {
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') { write(cwd, 'a.txt'); return doneImpl(cwd) }
    if (kind === 'review') return passReview()
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run } = rig({ repo, runDir, waves, stub, stamp: 'pr11',
                        extraArgs: { shallowLeg: false, constraintChecks: CHECKS } })
  const report = await run()
  assert.equal(report.coverage.complete, true, 'sim precondition: the wave was adopted')

  assert.ok(Array.isArray(report.integratedChecks),
    'the report carries no `integratedChecks` array: ' + JSON.stringify(report.integratedChecks))
  assert.deepEqual(report.integratedChecks.map((c) => ({ cmd: c.cmd, exit: c.exit, minor: c.minor })), [
    { cmd: 'test -e a.txt', exit: 0, minor: false },
    { cmd: 'test -e z.txt', exit: 1, minor: true },
  ], 'each check runs once on the adopted tree, in check order')
  for (const c of report.integratedChecks) {
    assert.deepEqual(Object.keys(c).sort(), ['cmd', 'exit', 'minor', 'stdout'],
      'each record is exactly { cmd, exit, stdout, minor }: ' + JSON.stringify(c))
    assert.equal(typeof c.stdout, 'string', 'stdout is a string: ' + JSON.stringify(c))
  }
  assert.deepEqual(ofKind(runDir, 'driver:integrated-check')
    .map((e) => ({ kind: e.kind, cmd: e.cmd, exit: e.exit, minor: e.minor, wave: e.wave })), [
    { kind: 'driver:integrated-check', cmd: 'test -e a.txt', exit: 0, minor: false, wave: 1 },
    { kind: 'driver:integrated-check', cmd: 'test -e z.txt', exit: 1, minor: true, wave: 1 },
  ], 'one event per command, carrying the wave number')

  // [M4] a red MINOR integrated check is a judgment call and nothing more.
  assert.deepEqual(report.completenessFindings, [],
    'a minor integrated check mints no completeness finding: ' +
    JSON.stringify(report.completenessFindings))
  const PER_TASK = 'task A: minor Check: `test -e z.txt` exited 1'
  const named = report.judgmentCalls.filter((j) => String(j).includes('test -e z.txt'))
  assert.equal(named.filter((j) => String(j).startsWith(PER_TASK)).length, 1,
    'the per-task pass pushed its one call, verbatim: ' + JSON.stringify(report.judgmentCalls))
  assert.equal(named.filter((j) => !String(j).startsWith(PER_TASK)).length, 1,
    'and the INTEGRATED pass pushes one judgment call of its own for the minor red — one ' +
    'call that is not the per-task literal: ' + JSON.stringify(report.judgmentCalls))
}

// [M4] green in every clone, red on the fold — the whole reason to run it again
{
  const CMD = 'test ! -e a.txt -o ! -e b.txt'
  const DETAIL = 'integrated Check: ' + CMD + ' exited 1 on the adopted tree'
  const repo = bareRepo(path.join(tmp, 'repo-d2'))
  const runDir = path.join(tmp, 'run-d2')
  const waves = [[
    mkTask('A', ['a.txt'], { proofRuns: ['test -e a.txt'] }),
    mkTask('B', ['b.txt']),
  ]]
  const calls = []
  const prompts = {}
  const stub = (prompt, opts, cwd) => {
    calls.push(opts.label)
    prompts[opts.label] = prompt
    const kind = opts.label.split(':')[0]
    const id = opts.label.split(':')[1]
    if (kind === 'impl') { write(cwd, id === 'A' ? 'a.txt' : 'b.txt'); return doneImpl(cwd) }
    if (kind === 'review') return passReview()
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run } = rig({ repo, runDir, waves, stub, stamp: 'pr12',
                        extraArgs: { shallowLeg: false,
                                     constraintChecks: [{ cmd: CMD, minor: false }] } })
  const report = await run()
  assert.deepEqual(calls.filter((l) => l.startsWith('fix:')), [],
    'sim precondition: the check is green in each task\'s own clone: ' + calls.join(','))
  assert.equal(report.coverage.complete, true, 'sim precondition: both tasks merged')

  assert.deepEqual(report.integratedChecks.map((c) => ({ cmd: c.cmd, exit: c.exit, minor: c.minor })),
    [{ cmd: CMD, exit: 1, minor: false }],
    'the integrated execution disagrees with both clone-local ones')
  const blocking = report.completenessFindings
    .filter((f) => f && typeof f === 'object' && f.severity === 'blocking')
  assert.equal(blocking.length, 1,
    'exactly one blocking completeness finding: ' + JSON.stringify(report.completenessFindings))
  assert.deepEqual(blocking[0], { severity: 'blocking', detail: DETAIL },
    'the finding is the typed #474 shape, and its detail is the Machine clause\'s literal')
  assert.ok(report.judgmentCalls.some((j) => String(j).includes(DETAIL)),
    'the judgment calls name it too: ' + JSON.stringify(report.judgmentCalls))
  assert.deepEqual(report.deferredVerification, [],
    'a red integrated check is a blocking finding, never a deferral — the driver has the answer')
  const decision = criticDecision(report)
  assert.equal(decision.approve, false,
    'the #474 brake must refuse a run whose integrated check is red')

  // [M4] the critic read the bytes: the block, directly after the integrated
  // RUN evidence, with the same per-command lines.
  const cp = prompts['integration']
  const iRun = cp.indexOf('INTEGRATED RUN EVIDENCE:')
  const iCheck = cp.indexOf(INTEGRATED_OPENER)
  assert.ok(iRun > 0, 'sim precondition: the integrated RUN evidence block is rendered')
  assert.ok(iCheck > iRun,
    'the INTEGRATED CHECK EVIDENCE block must follow it, opening sentence verbatim:\n' +
    INTEGRATED_OPENER + '\n\ngot tail:\n' + cp.slice(-800))
  const seg = cp.slice(iCheck)
  assert.ok(seg.includes('$ ' + CMD), 'the block quotes the command: ' + seg)
  assert.ok(seg.slice(seg.indexOf('$ ' + CMD)).includes('exit 1'),
    'and its exit code: ' + seg)
  assert.ok(cp.endsWith(integratedCheckEvidenceBlock(report.integratedChecks)),
    'the critic prompt must END with `integratedCheckEvidenceBlock` of the recorded checks: ' +
    JSON.stringify(cp.slice(-300)))
}

// ── Task 1 (#632 part 2): the driver hands its `Check:` commands the base sha ─
// The Claim: `ULTRA_BASE` is set by the engine from the wave's base, so a
// Global Constraint written as `git diff --quiet $ULTRA_BASE -- <path>` is
// writable at all. This file owns the `Check:` half (legs (c), (d), (g)); the
// `Run:` half is test_run_engine_proof_runs.mjs's legs (a), (b), (e).
//
// One command's evidence, read out of a rendered block: everything from
// `\n\n$ <cmd>\n` up to the next `\n\n$ ` (or the block's end).
const segmentOf = (block, cmd) => {
  const marker = '\n\n$ ' + cmd + '\n'
  const i = String(block || '').indexOf(marker)
  if (i === -1) return null
  const rest = block.slice(i + marker.length)
  const j = rest.indexOf('\n\n$ ')
  return j === -1 ? rest : rest.slice(0, j)
}

// ── legs (c) + (d): the diff a Global Constraint can now express [M2] [M3] ───
// `makeRepo`, not `bareRepo`: `git diff <sha> -- <path>` compares the commit
// with the WORKING TREE, and an untracked file shows up only once staged — so
// the edited path has to be one tracked at BASE. makeRepo leaves both `a.txt`
// and `check.sh` tracked, the implementer rewrites the first and leaves the
// second alone, and the two checks read that difference.
//
// The edited path's check is `minor: true` on purpose: a red non-minor check
// buys one `fix:<id>:0` round and then ends the task `proof-red` before any
// referee, and leg (c) is about what the REVIEW PROMPT carries. The untouched
// path's check stays non-minor, and stays green.
{
  const CHECK_UNTOUCHED = 'git diff --quiet $ULTRA_BASE -- check.sh'
  const CHECK_EDITED = 'git diff --quiet $ULTRA_BASE -- a.txt'
  const ECHO = "sh -c 'echo base=$ULTRA_BASE'"
  const repo = makeRepo(path.join(tmp, 'repo-ub1'))
  const runDir = path.join(tmp, 'run-ub1')
  const waves = [[mkTask('T1', ['a.txt'], { proofRuns: [ECHO] })]]
  const CHECKS = [{ cmd: CHECK_UNTOUCHED, minor: false }, { cmd: CHECK_EDITED, minor: true }]
  const calls = []
  const prompts = {}
  const stub = (prompt, opts, cwd) => {
    calls.push(opts.label)
    prompts[opts.label] = prompt
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') { write(cwd, 'a.txt', 'rewritten by the implementer\n'); return doneImpl(cwd) }
    if (kind === 'review') return passReview()
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run, base } = rig({ repo, runDir, waves, stub, stamp: 'ub1',
                              extraArgs: { shallowLeg: false, constraintChecks: CHECKS } })
  const report = await run()
  assert.match(base, /^[0-9a-f]{40}$/, 'sim precondition: the rig\'s base is a 40-hex sha')

  // [M2] the per-task pass: green for the path the implementer left alone, red
  // for the one it edited. With ULTRA_BASE unset, `git diff --quiet -- <path>`
  // is a working-tree-vs-index diff — and the capture already staged the edit —
  // so both would read 0 and the second assertion is the discriminator.
  const zero = ofKind(runDir, 'driver:check-run').filter((e) => e.iter === 0)
  const untouched = zero.filter((e) => e.cmd === CHECK_UNTOUCHED)
  const edited = zero.filter((e) => e.cmd === CHECK_EDITED)
  assert.deepEqual(untouched.map(checkShape), [
    { kind: 'driver:check-run', task: 'T1', cmd: CHECK_UNTOUCHED, exit: 0, minor: false, iter: 0 },
  ], 'a tracked path the implementer left alone diffs clean against ULTRA_BASE: ' +
     JSON.stringify(zero.map(checkShape)))
  assert.equal(edited.length, 1,
    'the edited path\'s check ran once on the driver\'s own pass: ' +
    JSON.stringify(zero.map(checkShape)))
  assert.notEqual(edited[0].exit, 0,
    'and a tracked path it DID edit diffs non-zero against ULTRA_BASE — with the variable ' +
    'unset the command degenerates to a working-tree-vs-index diff and reads 0: ' +
    JSON.stringify(checkShape(edited[0])))
  assert.equal(edited[0].minor, true, JSON.stringify(checkShape(edited[0])))

  // [M2] no fix round: the only red check is minor.
  assert.deepEqual(calls.filter((l) => l.startsWith('fix:')), [],
    'a red MINOR check dispatches no fix round: ' + calls.join(','))
  const row = report.tasks.find((r) => r.task === 'T1')
  assert.equal(row.status, 'done', 'the task merges: ' + JSON.stringify(row))

  // [M2] and the referee reads the same two exits out of the CHECK EVIDENCE block.
  const rp = prompts['review:T1:1']
  const iCheck = rp.indexOf(OPENER)
  assert.ok(iCheck > 0,
    'sim precondition: the CHECK EVIDENCE block is rendered: ' + JSON.stringify(rp.slice(-600)))
  const block = rp.slice(iCheck)
  const segU = segmentOf(block, CHECK_UNTOUCHED)
  const segE = segmentOf(block, CHECK_EDITED)
  assert.ok(segU !== null && segE !== null,
    'the block quotes both commands verbatim: ' + JSON.stringify(block))
  assert.equal(segU.split('\n')[0], 'exit 0',
    'the untouched path renders `exit 0`: ' + JSON.stringify(segU))
  assert.match(segE.split('\n')[0], /^exit [1-9][0-9]* \(minor\)$/,
    'the edited path renders a non-zero `exit <n> (minor)`: ' + JSON.stringify(segE))

  // [M3] leg (d): the integrated pass, on the adopted tree, against the RUN base.
  assert.deepEqual(report.integratedChecks.map((c) => c.cmd), [CHECK_UNTOUCHED, CHECK_EDITED],
    'both checks run once on the adopted tree, in check order: ' +
    JSON.stringify(report.integratedChecks))
  assert.equal(report.integratedChecks[0].exit, 0,
    'the untouched path is clean on the fold too: ' + JSON.stringify(report.integratedChecks[0]))
  assert.notEqual(report.integratedChecks[1].exit, 0,
    'and the path the wave edited diffs non-zero against ULTRA_BASE on the adopted tree — ' +
    'with the variable unset the adopted tree is clean and this reads 0: ' +
    JSON.stringify(report.integratedChecks[1]))
  const iev = ofKind(runDir, 'driver:integrated-check')
  assert.deepEqual(iev.map((e) => e.cmd), [CHECK_UNTOUCHED, CHECK_EDITED],
    'one event per command: ' + JSON.stringify(iev))
  assert.equal(iev[0].exit, 0, JSON.stringify(iev[0]))
  assert.notEqual(iev[1].exit, 0,
    'the events agree with the report: ' + JSON.stringify(iev[1]))

  // [M3] and the value itself, printed by a `Run:` on the same adopted tree.
  const integrated = report.integratedRuns.filter((r) => r.task === 'T1')
  assert.equal(integrated.length, 1,
    'one integrated run for T1: ' + JSON.stringify(report.integratedRuns))
  assert.ok(String(integrated[0].stdout).includes('base=' + base),
    'the integrated `Run:` ran with ULTRA_BASE = the run base ' + base + ': ' +
    JSON.stringify(integrated[0]))
}

// ── leg (g): the same two shas, told apart across two waves [M2] [M3] ────────
// A `Check:` that simply prints the variable, so the leg reads the value rather
// than a diff's exit code: wave 1's check sees the run base, wave 2's sees
// wave 1's adopted head, and BOTH integrated executions see the run base.
{
  const CBASE = "sh -c 'echo cbase=$ULTRA_BASE'"
  const repo = makeRepo(path.join(tmp, 'repo-ub2'))
  const runDir = path.join(tmp, 'run-ub2')
  const waves = [[mkTask('T1', ['one.txt'])], [mkTask('T2', ['two.txt'])]]
  const prompts = {}
  const stub = (prompt, opts, cwd) => {
    prompts[opts.label] = prompt
    const kind = opts.label.split(':')[0]
    const id = opts.label.split(':')[1]
    if (kind === 'impl') {
      write(cwd, id === 'T1' ? 'one.txt' : 'two.txt', 'from ' + id + '\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run, base } = rig({ repo, runDir, waves, edges: [['T1', 'T2']], stub, stamp: 'ub2',
                              extraArgs: { shallowLeg: false,
                                           constraintChecks: [{ cmd: CBASE, minor: false }] } })
  const report = await run()

  assert.equal(report.coverage.complete, true, 'sim precondition: both waves adopted')
  assert.equal(report.waveMerges.length, 2, 'sim precondition: two folded waves')
  const w1 = report.waveMerges[0].headSha
  const w2 = report.waveMerges[1].headSha
  assert.match(String(w1), /^[0-9a-f]{40}$/, 'sim precondition: wave 1 adopted a head')
  assert.notEqual(w1, base,
    'sim precondition: wave 1\'s adopted head differs from the run base, so the two shas ' +
    'this leg distinguishes are actually distinguishable')

  const segFor = (label) => {
    const p = prompts[label]
    const i = String(p || '').indexOf(OPENER)
    assert.ok(i > 0, 'sim precondition: ' + label + ' carries a CHECK EVIDENCE block: ' +
      JSON.stringify(String(p || '').slice(-600)))
    const s = segmentOf(p.slice(i), CBASE)
    assert.ok(s !== null, label + ': the block quotes `' + CBASE + '` verbatim')
    return s
  }

  // [M2] wave 1's per-task check reads the run base; wave 2's reads the head
  // its clone was re-anchored onto.
  const seg1 = segFor('review:T1:1')
  assert.ok(seg1.includes('cbase=' + base),
    'the wave-1 `Check:` ran with ULTRA_BASE = the run base ' + base + ': ' +
    JSON.stringify(seg1))
  const seg2 = segFor('review:T2:1')
  assert.ok(seg2.includes('cbase=' + w1),
    'the wave-2 `Check:` ran with ULTRA_BASE = waveMerges[0].headSha (' + w1 + '): ' +
    JSON.stringify(seg2))
  assert.ok(!seg2.includes('cbase=' + base),
    'and NOT the run base: ' + JSON.stringify(seg2))

  // [M3] both integrated executions read the run base — never an adopted head.
  const ics = report.integratedChecks.filter((c) => c.cmd === CBASE)
  assert.equal(ics.length, 2,
    'one integrated execution per adopted wave: ' + JSON.stringify(report.integratedChecks))
  for (const c of ics) {
    assert.ok(String(c.stdout).includes('cbase=' + base),
      'every integrated `Check:` runs with ULTRA_BASE = the run base ' + base + ', in wave 2 ' +
      'as in wave 1: ' + JSON.stringify(c))
    assert.ok(!String(c.stdout).includes(String(w1)),
      'never wave 1\'s adopted head ' + w1 + ' — a diff against the adopted head is a ' +
      'tautology: ' + JSON.stringify(c))
    assert.ok(!String(c.stdout).includes(String(w2)),
      'and never wave 2\'s ' + w2 + ': ' + JSON.stringify(c))
  }
}

// [M5] leg (f): the sentinel below is this sim's — its existing legs and the
// new ones. It is printed only if every assertion above held.
console.log('ALL TESTS PASSED')
