// fleet/tests/test_run_engine_examiner.mjs — the wave-0 examiner (#553): one
// worker per task writes the Proof's tests in the task's own clone at BASE,
// BEFORE the implementer sees the tree, and the driver records what it wrote.
//
// Everything below the agent seam is real (git, clones, capture, the fold
// kernel, the blob shas, the red-at-BASE run); only the judgments are canned.
// The exam's two obligations are what this pins: the examiner receives the
// implementer's OWN inputs minus the implementer's role, and an exam the
// implementer then edits is not reviewed, not folded, and says so.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { execSeam } from '../run-main.mjs'
import { makeCwdFor, withPatchCapture, defaultTaskIdOf } from '../run-waves.mjs'
import { runEngine, loadRoles, EXAMINER_SCHEMA } from '../run-engine.mjs'
import { makeRepo, provision, passReview, cleanCritic, doneImpl } from './_engine_helpers.mjs'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-exam-'))
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const REAL_ROLES = fileURLToPath(new URL('../roles/', import.meta.url))
const SIX = ['implementer', 'reviewer', 'fix', 'resolver', 'reconcile', 'critic']

// The seventh role file. `fleet/roles/examiner.md` is a sibling task's to
// write, so the sims point `rolesDir` at a temp directory holding all seven —
// this text is the one the prompt must carry verbatim.
const EXAMINER_TEXT = '# examiner (sim)\n\nYou write the exam and nothing else.\n'
const rolesDir = path.join(tmp, 'roles')
fs.mkdirSync(rolesDir, { recursive: true })
for (const name of SIX) {
  fs.copyFileSync(path.join(REAL_ROLES, name + '.md'), path.join(rolesDir, name + '.md'))
}
fs.writeFileSync(path.join(rolesDir, 'examiner.md'), EXAMINER_TEXT)
const IMPLEMENTER_TEXT = fs.readFileSync(path.join(rolesDir, 'implementer.md'), 'utf8')

// The rig, with `rolesDir` threaded through (the shared one in
// _engine_helpers.mjs has no seam for it): real clones, real capture, real
// exec seam, canned judgments.
let seq = 0
function rig({ waves, stub, testCmd = 'bash check.sh' }) {
  seq += 1
  const stamp = 'exam' + seq
  const repo = makeRepo(path.join(tmp, 'repo-' + stamp))
  const runDir = path.join(tmp, 'run-' + stamp)
  const taskIds = waves.flat().map((t) => t.id)
  const { base, clonesDir, patchesDir, integ } = provision({ repo, runDir, taskIds })
  const patchBase = { current: base }
  const cwdFor = makeCwdFor({ clonesDir })
  const inner = async (prompt, opts) => stub(prompt, opts, cwdFor(opts))
  const agent = withPatchCapture({
    agent: inner, clonesDir, base: () => patchBase.current, patchesDir,
    taskIdOf: defaultTaskIdOf,
  })
  const run = () => runEngine({
    args: {
      waves, edges: [], testCmd, acceptance: { mode: 'suite', reason: 'sim' }, stamp,
      integrationBranch: 'ultra/integration-' + stamp,
      dependencyEdges: [], patchInput: patchesDir, shallowLeg: false,
    },
    agent,
    parallel: (thunks) => Promise.all(thunks.map((t) => t())),
    exec: execSeam,
    paths: { repoDir: repo, runDir, clonesDir },
    log: () => {},
    rolesDir,
    patchBase,
  })
  return { run, base, repo, runDir, clonesDir, patchesDir, integ }
}

// One wave entry, six-slot shaped: a Machine line and Proof legs in the body,
// a per-task testCmd (#515) and the compiler's new `proofTests` key.
const MACHINE = 'Machine: M1. The tree holds `one.txt` whose content is "from T1".'
const LEGS = '- Legs: (a) `one.txt` reads exactly "from T1" [M1]'
const BODY = '**Claim:** the tree gains one.txt\n' + MACHINE +
  '\n\n**Proof:**\n- Test: `t1_test.sh`\n' + LEGS
const entry = (over = {}) => ({
  id: 'T1', title: 'create one', files: ['one.txt'], tier: 'standard', review: 'lean',
  writes: ['one.txt'], commutes: [],
  interfaces: { consumes: ['`BASE_FACTS`'], produces: ['`ONE`'] },
  testCmd: 'bash t1_test.sh',
  proofTests: ['t1_test.sh'],
  body: BODY,
  ...over,
})

// Exam scripts the examiner stub writes into its clone.
const RED_AT_BASE = '#!/bin/bash\n[ -f one.txt ]\n'      // red until the implementer works
const GREEN_AT_BASE = '#!/bin/bash\nexit 0\n'            // establishes nothing
const examOk = (cwd, files = { 't1_test.sh': RED_AT_BASE }) => {
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(cwd, name), text)
  return { status: 'DONE', summary: 'exam written', startHead: 'ignored' }
}

// ── (a) the exam dispatch: label order, isolation, prompt, schema [M1] ──────
{
  const seen = []
  const stub = (prompt, opts, cwd) => {
    seen.push({ label: opts.label, opts, cwd, prompt })
    const kind = opts.label.split(':')[0]
    if (kind === 'exam') return examOk(cwd)
    if (kind === 'impl') { fs.writeFileSync(path.join(cwd, 'one.txt'), 'from T1\n'); return doneImpl(cwd) }
    if (kind === 'review') return passReview()
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run, base, clonesDir } = rig({ waves: [[entry()]], stub })
  const report = await run()

  assert.deepEqual(seen.map((d) => d.label), ['exam:T1', 'impl:T1', 'review:T1:1', 'integration'],
    'the examiner is dispatched before the implementer')
  const exam = seen[0], impl = seen[1]
  assert.equal(exam.opts.isolation, 'worktree', 'the exam runs isolated')
  assert.equal(exam.cwd, path.join(clonesDir, 'task-T1'), 'in the task\'s own clone')

  // The prompt: the examiner's role, then the implementer's own inputs.
  assert.ok(exam.prompt.startsWith(EXAMINER_TEXT), 'the exam prompt opens with examiner.md verbatim')
  assert.ok(!exam.prompt.includes('You are an implementer'), 'and carries no implementer role')
  assert.ok(impl.prompt.startsWith(IMPLEMENTER_TEXT))
  const examTail = exam.prompt.slice(EXAMINER_TEXT.length)
  const implTail = impl.prompt.slice(IMPLEMENTER_TEXT.length)
  assert.equal(examTail, implTail, 'the examiner gets the implementer\'s inputs byte for byte')
  assert.ok(examTail.startsWith('\nBASE: ' + base), 'BASE block')
  assert.ok(examTail.includes('\nTEST COMMAND: bash t1_test.sh'), 'the task\'s own TEST COMMAND')
  assert.ok(examTail.includes('\nFILES: one.txt'), 'FILES block')
  assert.ok(examTail.includes('\nINTERFACES:\nConsumes: `BASE_FACTS`\nProduces: `ONE`'), 'INTERFACES block')
  assert.ok(examTail.includes('\nTASK:\n' + BODY), 'the TASK block, Machine line and legs included')
  assert.ok(examTail.includes(MACHINE) && examTail.includes(LEGS))

  // The schema.
  assert.deepEqual(exam.opts.schema, EXAMINER_SCHEMA, 'the exam is dispatched under EXAMINER_SCHEMA')
  assert.deepEqual(EXAMINER_SCHEMA.required, ['status', 'summary'], 'no startHead: the driver knows BASE (Amendment 10)')
  assert.deepEqual(EXAMINER_SCHEMA.properties.status.enum, ['DONE', 'BLOCKED'])
  assert.deepEqual(EXAMINER_SCHEMA.properties.unsatisfiable.items.required, ['leg', 'why'])

  // The role loader and the label→clone route.
  assert.equal(loadRoles(rolesDir).examiner, EXAMINER_TEXT, 'loadRoles reads examiner.md')
  for (const name of SIX) assert.equal(typeof loadRoles(rolesDir)[name], 'string')
  assert.equal(defaultTaskIdOf('exam:T1'), 'T1', 'exam:<id> routes to the task clone')

  assert.equal(report.tasks[0].status, 'done')
  assert.equal(report.coverage.tasks_merged, 1, 'an unedited exam merges')
}

// ── (b) red at BASE vs green at BASE [M2] ──────────────────────────────────
const examScenario = async (examScript, implFn) => {
  const stub = (prompt, opts, cwd) => {
    const kind = opts.label.split(':')[0]
    if (kind === 'exam') return examOk(cwd, { 't1_test.sh': examScript })
    if (kind === 'impl') { implFn(cwd); return doneImpl(cwd) }
    if (kind === 'review') return passReview()
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run } = rig({ waves: [[entry()]], stub })
  return run()
}
const writeOne = (cwd) => fs.writeFileSync(path.join(cwd, 'one.txt'), 'from T1\n')
const GREEN_CALL = 'task T1: exam is green at BASE — it establishes nothing'
{
  const report = await examScenario(RED_AT_BASE, writeOne)
  assert.equal(report.tasks[0].exam, 'red', 'the exam failed at BASE — it establishes something')
  assert.ok(!report.judgmentCalls.some((j) => j.includes('green at BASE')),
    'a red exam raises no green-at-BASE call: ' + report.judgmentCalls.join(' | '))
}
{
  const report = await examScenario(GREEN_AT_BASE, writeOne)
  assert.equal(report.tasks[0].exam, 'green-at-base')
  assert.deepEqual(report.judgmentCalls.filter((j) => j.includes('green at BASE')), [GREEN_CALL])
}

// ── (c) unsatisfiable legs, BLOCKED and a dead examiner [M3] ───────────────
const examReplyScenario = async (examReply) => {
  const labels = []
  const stub = (prompt, opts, cwd) => {
    labels.push(opts.label)
    const kind = opts.label.split(':')[0]
    if (kind === 'exam') return examReply(cwd)
    if (kind === 'impl') { writeOne(cwd); return doneImpl(cwd) }
    if (kind === 'review') return passReview()
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run } = rig({ waves: [[entry()]], stub })
  return { report: await run(), labels }
}
{
  const { report } = await examReplyScenario((cwd) => ({
    ...examOk(cwd), unsatisfiable: [{ leg: '(b)', why: 'no such flag' }],
  }))
  assert.deepEqual(report.judgmentCalls.filter((j) => j.includes('examiner:')),
    ['task T1: examiner: (b) — no such flag'])
  assert.equal(report.tasks[0].exam, 'red')
}
for (const [name, reply] of [
  ['BLOCKED', () => ({ status: 'BLOCKED', summary: 'the Proof names no test', startHead: 'x' })],
  ['null', () => null],
]) {
  const { report, labels } = await examReplyScenario(reply)
  assert.equal(report.tasks[0].exam, 'blocked', name + ' examiner records a blocked exam')
  assert.ok(report.judgmentCalls.some((j) => j.startsWith('task T1: examiner')),
    name + ' examiner raises a judgment call: ' + report.judgmentCalls.join(' | '))
  assert.ok(labels.includes('impl:T1'), name + ' examiner still lets the implementer run')
  assert.equal(report.tasks[0].status, 'done', name + ' examiner does not fail the task')
}

// ── (d) an edited exam is recorded, named to the referee, and reviewed [M4] ─
// One rule since 2026-09-02 (after run-53): the driver never refuses the
// edit. It lands on the row as `examEdited`, in one judgment call, and in the
// review prompt as EXAM EDITED; the referee (reviewer.md rule 8) decides.
const editExam = (cwd) =>
  fs.writeFileSync(path.join(cwd, 't1_test.sh'), '#!/bin/bash\nexit 0 # rewritten by the graded party\n')
{
  // The implementer rewrites the exam it was handed.
  const labels = []
  const prompts = {}
  const stub = (prompt, opts, cwd) => {
    labels.push(opts.label)
    prompts[opts.label] = prompt
    const kind = opts.label.split(':')[0]
    if (kind === 'exam') return examOk(cwd)
    if (kind === 'impl') { writeOne(cwd); editExam(cwd); return doneImpl(cwd) }
    if (kind === 'review') return passReview()
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run } = rig({ waves: [[entry()]], stub })
  const report = await run()
  assert.equal(report.tasks[0].status, 'done', 'a clean review merges an edited exam: ' + report.tasks[0].notes)
  assert.equal(report.tasks[0].reviewVerdict, 'clean')
  assert.equal(report.tasks[0].exam, 'red', 'the value recorded before the implementer ran')
  assert.deepEqual(report.tasks[0].examEdited, ['t1_test.sh'], 'the edit is on the row')
  assert.ok(labels.includes('review:T1:1'), 'the review is dispatched: ' + labels.join(','))
  assert.ok(prompts['review:T1:1'].includes('\nEXAM EDITED: t1_test.sh'),
    'the referee is told which Proof path moved')
  assert.equal(report.coverage.tasks_merged, 1)
  assert.deepEqual(report.judgmentCalls.filter((j) => j.includes('t1_test.sh')).length, 1)
}
{
  // The referee, told, may block it — and that is the whole enforcement.
  const stub = (prompt, opts, cwd) => {
    const kind = opts.label.split(':')[0]
    if (kind === 'exam') return examOk(cwd)
    if (kind === 'impl') { writeOne(cwd); editExam(cwd); return doneImpl(cwd) }
    if (kind === 'review') return { verdict: 'FIX_REQUIRED', issues: [{ severity: 'blocking', detail: 'the exam was weakened' }] }
    if (kind === 'fix') return doneImpl(cwd)
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run } = rig({ waves: [[entry()]], stub })
  const report = await run()
  assert.equal(report.tasks[0].status, 'failed')
  assert.equal(report.tasks[0].reviewVerdict, 'fix-loop-exhausted')
  assert.deepEqual(report.tasks[0].examEdited, ['t1_test.sh'])
  assert.equal(report.coverage.tasks_merged, 0)
}
{
  // The same edit in the fix round, after a blocking first review, is the
  // other case (run-54 task 5): the fix round is applying a referee's
  // findings, and the finding may BE the exam. The edit is recorded and
  // reviewed — the re-review reads the fix patch, exam hunks included — not
  // refused. Its own sim is test_run_engine_exam_fix_edit.mjs.
  const labels = []
  const stub = (prompt, opts, cwd) => {
    labels.push(opts.label)
    const kind = opts.label.split(':')[0]
    if (kind === 'exam') return examOk(cwd)
    if (kind === 'impl') { writeOne(cwd); return doneImpl(cwd) }
    if (opts.label === 'review:T1:1') return { verdict: 'FIX_REQUIRED', issues: [{ severity: 'blocking', detail: 'not yet' }] }
    if (kind === 'review') return passReview()
    if (kind === 'fix') { editExam(cwd); return doneImpl(cwd) }
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run } = rig({ waves: [[entry()]], stub })
  const report = await run()
  assert.deepEqual(labels.filter((l) => l !== 'integration'),
    ['exam:T1', 'impl:T1', 'review:T1:1', 'fix:T1:1', 'review:T1:2'],
    'the fix round proceeds to its re-review')
  assert.equal(report.tasks[0].status, 'done')
  assert.equal(report.tasks[0].reviewVerdict, 'fixed')
  assert.equal(report.tasks[0].exam, 'red')
  assert.deepEqual(report.tasks[0].examEdited, ['t1_test.sh'])
  assert.equal(report.coverage.tasks_merged, 1)
  assert.ok(report.judgmentCalls.some((j) => j.includes('t1_test.sh')))
}
{
  // A green-at-BASE exam that is then edited keeps the value it recorded.
  const stub = (prompt, opts, cwd) => {
    const kind = opts.label.split(':')[0]
    if (kind === 'exam') return examOk(cwd, { 't1_test.sh': GREEN_AT_BASE })
    if (kind === 'impl') { writeOne(cwd); editExam(cwd); return doneImpl(cwd) }
    if (kind === 'review') return passReview()
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run } = rig({ waves: [[entry()]], stub })
  const report = await run()
  assert.equal(report.tasks[0].status, 'done')
  assert.equal(report.tasks[0].exam, 'green-at-base')
  assert.deepEqual(report.tasks[0].examEdited, ['t1_test.sh'])
}

// ── (e) no proofTests, no exam — and every other engine sim unchanged [M5] ─
for (const [name, over] of [
  ['empty proofTests', { proofTests: [] }],
  ['no proofTests key', { proofTests: undefined }],
  ['null testCmd', { testCmd: null }],
]) {
  const task = entry(over)
  if (over.proofTests === undefined) delete task.proofTests
  const labels = []
  const stub = (prompt, opts, cwd) => {
    labels.push(opts.label)
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') { writeOne(cwd); return doneImpl(cwd) }
    if (kind === 'review') return passReview()
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch (' + name + '): ' + opts.label)
  }
  const { run } = rig({ waves: [[task]], stub })
  const report = await run()
  assert.deepEqual(labels, ['impl:T1', 'review:T1:1', 'integration'], name + ': no exam worker')
  assert.ok('exam' in report.tasks[0], name + ': the task result carries the exam key')
  assert.equal(report.tasks[0].exam, null, name + ': and it is null')
  assert.equal(report.tasks[0].status, 'done')
}
{
  // Every other engine sim still passes, as its own process.
  const here = path.basename(fileURLToPath(import.meta.url))
  const dir = fileURLToPath(new URL('.', import.meta.url))
  const sims = fs.readdirSync(dir)
    .filter((f) => /^test_run_engine.*\.mjs$/.test(f) && f !== here)
    .sort()
  assert.ok(sims.length >= 7, 'the engine sims are enumerable: ' + sims.join(','))
  for (const f of sims) {
    const out = execFileSync('node', [path.join(dir, f)],
      { cwd: REPO_ROOT, encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] })
    assert.ok(out.includes('ALL TESTS PASSED'), f + ' printed no pass line: ' + out.slice(-400))
  }
}

// ── (f) one blob per proofTests path, absent recorded as null [M2, M4] ─────
const twoPathScenario = async (implFn, paths = ['t1_test.sh', 't1_extra.sh'],
                               examFiles = { 't1_test.sh': RED_AT_BASE }) => {
  const labels = []
  const stub = (prompt, opts, cwd) => {
    labels.push(opts.label)
    const kind = opts.label.split(':')[0]
    if (kind === 'exam') return examOk(cwd, examFiles)
    if (kind === 'impl') { writeOne(cwd); implFn(cwd); return doneImpl(cwd) }
    if (kind === 'review') return passReview()
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run } = rig({ waves: [[entry({ proofTests: paths })]], stub })
  return { report: await run(), labels }
}
{
  // Leaves both as the examiner left them (one written, one absent): merges.
  const { report } = await twoPathScenario(() => {})
  assert.equal(report.tasks[0].status, 'done', 'an untouched exam merges: ' + report.tasks[0].notes)
  assert.equal(report.tasks[0].exam, 'red')
  assert.equal(report.coverage.tasks_merged, 1)
  assert.deepEqual(report.judgmentCalls.filter((j) => j.includes('t1_extra.sh')), [])
}
{
  // Creates the path the examiner left absent: the recorded null moved.
  const { report } = await twoPathScenario((cwd) => fs.writeFileSync(path.join(cwd, 't1_extra.sh'), 'x\n'))
  assert.deepEqual(report.tasks[0].examEdited, ['t1_extra.sh'])
  const calls = report.judgmentCalls.filter((j) => j.includes('exam'))
  const named = calls.filter((j) => j.includes('t1_extra.sh'))
  assert.equal(named.length, 1, 'the call names the created path: ' + calls.join(' | '))
  assert.ok(!named[0].includes('t1_test.sh'), 'and not the untouched one: ' + named[0])
}
{
  // Changes one byte of the written path.
  const { report } = await twoPathScenario((cwd) =>
    fs.writeFileSync(path.join(cwd, 't1_test.sh'), RED_AT_BASE + '\n'))
  assert.deepEqual(report.tasks[0].examEdited, ['t1_test.sh'])
  const named = report.judgmentCalls.filter((j) => j.includes('t1_test.sh'))
  assert.equal(named.length, 1)
  assert.ok(!named[0].includes('t1_extra.sh'))
}

// ── (g) two written paths, one edited: the call names exactly that one [M4] ─
{
  const files = { 't1_test.sh': RED_AT_BASE, 't1_second.sh': '#!/bin/bash\nexit 1\n' }
  const { report } = await twoPathScenario(
    (cwd) => fs.writeFileSync(path.join(cwd, 't1_second.sh'), '#!/bin/bash\nexit 0\n'),
    ['t1_test.sh', 't1_second.sh'], files)
  assert.deepEqual(report.tasks[0].examEdited, ['t1_second.sh'])
  const named = report.judgmentCalls.filter((j) => j.includes('t1_second.sh'))
  assert.equal(named.length, 1, 'exactly one call names the edited path')
  assert.ok(!named[0].includes('t1_test.sh'), 'and it does not name the untouched one: ' + named[0])
}

console.log('ALL TESTS PASSED')
