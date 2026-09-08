// fleet/tests/test_run_engine_examiner.mjs — the wave-0 examiner (#553): one
// worker per task writes the Proof's tests in the task's own clone at BASE,
// BEFORE the implementer sees the tree, and the driver records what it wrote.
//
// Everything below the agent seam is real (git, clones, capture, the fold
// kernel, the blob shas, the red-at-BASE run); only the judgments are canned.
// The obligation this half pins: the examiner receives the implementer's OWN
// inputs minus the implementer's role, its exam is red or green at BASE, and a
// blocked examiner still lets the run proceed. The recorded-edit half — legs
// (d), (f) and (g) — lives in test_run_engine_exam_edits.mjs.
//
// The second half of this file (#762) pins what happens when the examiner of
// that pair DIES — `agent()` leaves by a `WORKER_SIGTERM` throw — while the
// implementer beside it is still running. Its Machine clauses are numbered M1
// through M5 again, and they are #762's, not the ones above; each assertion
// there names its own leg letter and clause.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSeam } from '../run-main.mjs'
import { makeCwdFor, withPatchCapture, defaultTaskIdOf } from '../run-waves.mjs'
import { runEngine, loadRoles, EXAMINER_SCHEMA } from '../run-engine.mjs'
import { makeRepo, provision, passReview, cleanCritic, doneImpl } from './_engine_helpers.mjs'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-exam-'))
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
      dependencyEdges: [], patchInput: patchesDir,
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

  // Every dispatch the task takes, in the order the stub saw them. The exam and
  // the implementer go out together (#653) — this leg's stub replies to each in
  // the same tick it is called, so the pair still arrives here in dispatch
  // order; the leg that holds the examiner's reply back until the implementer
  // is out is test_run_engine_exam_together.mjs's.
  assert.deepEqual(seen.map((d) => d.label), ['exam:T1', 'impl:T1', 'review:T1:1', 'integration'],
    'the examiner and the implementer are both dispatched, before any review')
  const exam = seen[0], impl = seen[1]
  assert.equal(exam.opts.isolation, 'worktree', 'the exam runs isolated')
  assert.equal(exam.cwd, path.join(clonesDir, 'exam-T1'), 'in the examiner\'s own clone, not the graded one')
  assert.equal(impl.cwd, path.join(clonesDir, 'task-T1'), 'and the implementer in the task clone')

  // The prompt: the examiner's role, then the implementer's own inputs — with
  // the one line #663 sets apart. This task's `testCmd` names its Proof `Test:`
  // path, so the examiner keeps `bash t1_test.sh` and the implementer, whose
  // tree will not hold that file until the driver's handoff, is handed the
  // run-wide `bash check.sh`. Everything else is still byte for byte.
  assert.ok(exam.prompt.startsWith(EXAMINER_TEXT), 'the exam prompt opens with examiner.md verbatim')
  assert.ok(!exam.prompt.includes('You are an implementer'), 'and carries no implementer role')
  assert.ok(impl.prompt.startsWith(IMPLEMENTER_TEXT))
  const examTail = exam.prompt.slice(EXAMINER_TEXT.length)
  const implTail = impl.prompt.slice(IMPLEMENTER_TEXT.length)
  assert.equal(examTail.replace('\nTEST COMMAND: bash t1_test.sh', '\nTEST COMMAND: bash check.sh'),
    implTail, 'the examiner gets the implementer\'s inputs byte for byte but the TEST COMMAND line')
  assert.deepEqual(examTail.split('\n').filter((l) => l.startsWith('TEST COMMAND: ')),
    ['TEST COMMAND: bash t1_test.sh'], 'the task\'s own TEST COMMAND, once')
  assert.deepEqual(implTail.split('\n').filter((l) => l.startsWith('TEST COMMAND: ')),
    ['TEST COMMAND: bash check.sh'], 'and the run-wide suite for the implementer, once')
  assert.ok(examTail.startsWith('\nBASE: ' + base), 'BASE block')
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
  assert.equal(defaultTaskIdOf('exam:T1'), 'T1', 'exam:<id> reads as task T1 — its clone is exam-T1')

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

// ── (e) no proofTests, no exam [M5] ─────────────────────────────────────────
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

// ══ #762: a dead examiner beside a finished implementer ════════════════════
// The pair is dispatched with nothing awaited between the two calls, so a
// worker that dies at exit 143 makes the EXAMINER's call reject while the
// implementer's is still running. At BASE that rejection climbs out of
// `runTaskInner` and the whole pair is re-run — a second implementer, a reset
// task clone, and the finished implementer's work thrown away. These legs pin
// the narrower lane: when the implementer of the same pair ended `success`
// with its patch captured, only the examiner is dispatched again.
//
// #762's Machine clauses, restated:
//   M1 — a run whose `exam:T1` rejects with `WORKER_SIGTERM` before `impl:T1`
//        has returned, and whose `impl:T1` then resolves `DONE` with a
//        driver-captured patch and headSha, dispatches `exam:T1` exactly twice
//        and `impl:T1` exactly once; the second exam prompt equals the first,
//        its clone holds nothing the first examiner left, the `review:T1:1`
//        prompt's patch carries the one implementer's hunk, the graded clone's
//        Proof path holds the second examiner's bytes, and the row ends `done`
//        with `exam` `red`.
//   M2 — a second rejection makes no third dispatch: `impl:T1` is still
//        dispatched once, the row ends `done` with `exam` `blocked`, and a
//        judgment call starts `task T1: examiner` and contains
//        `proceeds unexamined`.
//   M3 — when the implementer rejects too, the lane at BASE stands: each label
//        dispatched twice, and a judgment call containing `retrying once at`.
//   M4 — the record: exactly one judgment call starting `task T1: examiner
//        died` and containing `re-dispatching the examiner alone`, and exactly
//        one `driver:exam-redispatch` line in `<runDir>/events.jsonl` — none of
//        either on a run whose examiner answers first time.
//   M5 — an implementer that merely RETURNED (`BLOCKED`) is not a kept reply:
//        the examiner-alone lane does not open, and the lane at BASE stands.

// What the real worker throws when the CLI is killed with no envelope
// (`fleet/run-worker.mjs`'s classify + the `WORKER_<CLASS>` throw): the message
// the driver's catch classifies, with the verdict and label attached.
const SIGTERM_MSG = 'WORKER_SIGTERM: SIGTERM: killed with no envelope (exit 143)'
const sigterm = (label) => Object.assign(new Error(SIGTERM_MSG),
  { workerVerdict: { outcome: 'retry', class: 'sigterm' }, label })

const deferred = () => {
  let resolve
  const promise = new Promise((r) => { resolve = r })
  return { promise, resolve }
}
// Unref'd so a race the deferred already won does not hold the process open.
const sleep = (ms) => new Promise((r) => { const t = setTimeout(r, ms); if (t.unref) t.unref() })
const countOf = (labels, label) => labels.filter((l) => l === label).length
// The driver's own append-only record. An absent file reads as no records, so
// an engine that writes none fails an assertion rather than throwing ENOENT.
const readEvents = (runDir) => {
  const file = path.join(runDir, 'events.jsonl')
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l) } catch { return null } })
    .filter(Boolean)
}
// A missing file is an answer here, not a crash: the leg reports what the
// graded clone held rather than dying at the read.
const readOr = (p) => {
  try { return fs.readFileSync(p, 'utf8') } catch (e) { return 'ABSENT: ' + String((e && e.message) || e) }
}

// The second examiner's exam, distinguishable from the first attempt's byte
// for byte, and red at BASE for the same reason RED_AT_BASE is.
const SECOND_EXAM = '#!/bin/bash\n[ -f one.txt ] # written by the second examiner\n'
const REDISPATCH = 're-dispatching the examiner alone'
const REDISPATCH_EVENT = 'driver:exam-redispatch'

// ── (a) the examiner dies, the implementer finishes: the examiner alone [M1] ─
// The examiner throws before the implementer returns — the implementer's reply
// is held behind the promise the examiner's throw resolves (or 3s, so a driver
// that serializes the pair fails an assertion rather than hanging).
let runA = null
{
  const labels = []
  const examSeen = []
  const prompts = {}
  const examDied = deferred()
  const stub = async (prompt, opts, cwd) => {
    labels.push(opts.label)
    prompts[opts.label] = prompt
    const kind = opts.label.split(':')[0]
    if (kind === 'exam') {
      const attempt = countOf(labels, 'exam:T1')
      examSeen.push({ prompt, cwd, leftBehind: fs.existsSync(path.join(cwd, 'left-behind')) })
      if (attempt === 1) {
        fs.writeFileSync(path.join(cwd, 'left-behind'), 'the dead examiner was here\n')
        examDied.resolve()
        throw sigterm(opts.label)
      }
      return examOk(cwd, { 't1_test.sh': SECOND_EXAM })
    }
    if (kind === 'impl') {
      await Promise.race([examDied.promise, sleep(3000)])
      writeOne(cwd)
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run, runDir, clonesDir } = rig({ waves: [[entry()]], stub })
  const report = await run()
  runA = { report, runDir }
  const row = report.tasks[0]

  // [M1] the counts: the examiner again, the implementer never.
  assert.equal(countOf(labels, 'exam:T1'), 2,
    'the dead examiner is dispatched exactly twice: ' + labels.join(','))
  assert.equal(countOf(labels, 'impl:T1'), 1,
    'and the implementer that already finished is dispatched exactly once — its work is ' +
    'kept, not re-run: ' + labels.join(','))

  // [M1] the second dispatch is the same ask into a clone re-cut at BASE.
  assert.equal(examSeen.length, 2, 'both exam dispatches were observed')
  assert.equal(examSeen[1].prompt, examSeen[0].prompt,
    'the re-dispatched examiner is handed the same prompt as the one that died')
  assert.equal(examSeen[0].leftBehind, false,
    'the first examiner started in a clone that did not hold left-behind')
  assert.equal(examSeen[1].leftBehind, false,
    'and the second starts in a clone holding no file the first examiner left')

  // [M1] the one implementer's hunk reaches the referee.
  assert.equal(typeof prompts['review:T1:1'], 'string',
    'a referee read the patch: ' + labels.join(','))
  assert.ok(prompts['review:T1:1'].includes('from T1'),
    'the review:T1:1 prompt carries the hunk the one implementer wrote: ' +
    String(prompts['review:T1:1']).slice(0, 400))

  // [M1] the graded clone holds the SECOND examiner's exam, byte for byte.
  assert.equal(readOr(path.join(clonesDir, 'task-T1', 't1_test.sh')), SECOND_EXAM,
    'the handoff copied the second examiner\'s bytes into the graded clone')

  // [M1] and the row.
  assert.equal(row.status, 'done', 'the task ends done: ' + row.notes)
  assert.equal(row.exam, 'red', 'with the second examiner\'s red-at-BASE verdict')
}

// ── (b) the second examiner dies too: no third, and unexamined [M2] ─────────
{
  const labels = []
  const examDied = deferred()
  const stub = async (prompt, opts, cwd) => {
    labels.push(opts.label)
    const kind = opts.label.split(':')[0]
    if (kind === 'exam') { examDied.resolve(); throw sigterm(opts.label) }
    if (kind === 'impl') {
      await Promise.race([examDied.promise, sleep(3000)])
      writeOne(cwd)
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run } = rig({ waves: [[entry()]], stub })
  const report = await run()
  const row = report.tasks[0]

  // [M2] two dispatches, never three.
  assert.equal(countOf(labels, 'exam:T1'), 2,
    'a second dead examiner buys no third dispatch: ' + labels.join(','))
  assert.equal(countOf(labels, 'impl:T1'), 1,
    'and the implementer is still dispatched exactly once: ' + labels.join(','))

  // [M2] the run proceeds, unexamined, and says so.
  assert.equal(row.status, 'done', 'the task still ends done: ' + row.notes)
  assert.equal(row.exam, 'blocked', 'with no exam recorded')
  const call = report.judgmentCalls.filter((j) => j.startsWith('task T1: examiner') &&
    j.includes('proceeds unexamined'))
  assert.equal(call.length, 1,
    'one judgment call starts "task T1: examiner" and says the implementer proceeds ' +
    'unexamined: ' + report.judgmentCalls.join(' | '))
}

// ── (c) both halves die: the whole-pair lane at BASE stands [M3] ────────────
{
  const labels = []
  const stub = async (prompt, opts, cwd) => {
    labels.push(opts.label)
    const kind = opts.label.split(':')[0]
    if (kind === 'exam') {
      if (countOf(labels, 'exam:T1') === 1) throw sigterm(opts.label)
      return examOk(cwd, { 't1_test.sh': SECOND_EXAM })
    }
    if (kind === 'impl') {
      if (countOf(labels, 'impl:T1') === 1) throw sigterm(opts.label)
      writeOne(cwd)
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run } = rig({ waves: [[entry()]], stub })
  const report = await run()

  // [M3] a dead implementer is still the whole pair's retry — neither label is
  // dispatched once, and neither three times.
  assert.equal(countOf(labels, 'impl:T1'), 2,
    'the implementer is dispatched exactly twice: ' + labels.join(','))
  assert.equal(countOf(labels, 'exam:T1'), 2,
    'and the examiner exactly twice: ' + labels.join(','))
  assert.deepEqual(report.judgmentCalls.filter((j) => j.includes(REDISPATCH)), [],
    'no examiner-alone re-dispatch was taken: ' + report.judgmentCalls.join(' | '))
  assert.ok(report.judgmentCalls.some((j) => j.includes('retrying once at')),
    'the retry ladder at BASE is the one that ran: ' + report.judgmentCalls.join(' | '))
}

// ── (d) the record the operator reads [M4] ─────────────────────────────────
{
  const { report, runDir } = runA
  const died = report.judgmentCalls.filter((j) => j.startsWith('task T1: examiner died'))
  assert.equal(died.length, 1,
    'exactly one judgment call starts "task T1: examiner died": ' +
    report.judgmentCalls.join(' | '))
  assert.deepEqual(died.filter((j) => j.includes(REDISPATCH)), died,
    'and it names the decision: ' + died.join(' | '))
  const marks = readEvents(runDir)
    .filter((e) => e.kind === REDISPATCH_EVENT && e.task === 'T1')
  assert.equal(marks.length, 1,
    'exactly one driver:exam-redispatch line for T1 in events.jsonl: ' + JSON.stringify(marks))
}
// ...and none of either when the examiner answers first time.
{
  const labels = []
  const stub = async (prompt, opts, cwd) => {
    labels.push(opts.label)
    const kind = opts.label.split(':')[0]
    if (kind === 'exam') return examOk(cwd)
    if (kind === 'impl') { writeOne(cwd); return doneImpl(cwd) }
    if (kind === 'review') return passReview()
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run, runDir } = rig({ waves: [[entry()]], stub })
  const report = await run()
  assert.equal(countOf(labels, 'exam:T1'), 1, 'a live examiner is dispatched once')
  assert.deepEqual(report.judgmentCalls.filter((j) => j.startsWith('task T1: examiner died')), [],
    'a live examiner raises no examiner-died call: ' + report.judgmentCalls.join(' | '))
  assert.deepEqual(readEvents(runDir).filter((e) => e.kind === REDISPATCH_EVENT), [],
    'and appends no driver:exam-redispatch line')
}

// ── (e) an implementer that merely returned is not a kept reply [M5] ───────
// The examiner dies before the implementer returns, as in (a) — but the reply
// is `BLOCKED` with nothing written, so the examiner-alone lane must not open.
{
  const labels = []
  const examDied = deferred()
  const stub = async (prompt, opts, cwd) => {
    labels.push(opts.label)
    const kind = opts.label.split(':')[0]
    if (kind === 'exam') {
      if (countOf(labels, 'exam:T1') === 1) { examDied.resolve(); throw sigterm(opts.label) }
      return examOk(cwd, { 't1_test.sh': SECOND_EXAM })
    }
    if (kind === 'impl') {
      if (countOf(labels, 'impl:T1') === 1) {
        await Promise.race([examDied.promise, sleep(3000)])
        return { status: 'BLOCKED', summary: 'cannot', startHead: 'ignored' }
      }
      writeOne(cwd)
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run, runDir } = rig({ waves: [[entry()]], stub })
  const report = await run()

  // [M5] the pair lane, as at BASE.
  assert.equal(countOf(labels, 'impl:T1'), 2,
    'the implementer is dispatched exactly twice: ' + labels.join(','))
  assert.equal(countOf(labels, 'exam:T1'), 2,
    'and the examiner exactly twice: ' + labels.join(','))
  assert.deepEqual(report.judgmentCalls.filter((j) => j.includes(REDISPATCH)), [],
    'a BLOCKED implementer opens no examiner-alone lane: ' + report.judgmentCalls.join(' | '))
  assert.deepEqual(readEvents(runDir).filter((e) => e.kind === REDISPATCH_EVENT), [],
    'and no driver:exam-redispatch line is appended')
}

console.log('ALL TESTS PASSED')
