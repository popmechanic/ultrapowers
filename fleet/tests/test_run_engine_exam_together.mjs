// fleet/tests/test_run_engine_exam_together.mjs — the examiner and the
// implementer start at the same moment, and the peer's exam still grades the
// patch before any referee reads it (#653).
//
// At BASE the two share one clone and one clock: the driver dispatches
// `exam:<id>`, AWAITS it, records the blobs, runs the red-at-BASE probe, and
// only then dispatches `impl:<id>` into the same directory — so the exam's
// wall clock is spent with the implementer idle, and the implementer inherits
// a tree with the exam already in it. This sim pins the other shape: the pair
// is dispatched together into two clones, and the exam reaches the graded tree
// by a DRIVER handoff after both have returned.
//
// Everything below the agent seam is real (git, clones, capture, the fold
// kernel, the real `sh`, the real blob shas); only the judgments are canned,
// so every clone, patch and event the assertions read is the driver's own.
//
// Machine clauses under test:
//   M1 — for a task whose Proof names `Test:` paths and whose test command is
//        set, `exam:<id>` and `impl:<id>` are dispatched together, neither
//        awaited before the other: the examiner in `<clonesDir>/exam-<id>`, a
//        clone whose HEAD is the wave base and in which `bootstrapCmd` has
//        already run, the implementer in `<clonesDir>/task-<id>`; the exam
//        prompt is `examiner.md` followed by the implementer's own inputs byte
//        for byte; the examiner's capture is written to
//        `<patchesDir>/exam-<id>.patch`, never to `task-<id>.patch`.
//   M2 — the wave-0 verdict is decided in the examiner's clone as at BASE:
//        `exam` is `red`, or `green-at-base` with the judgment call
//        `exam is green at BASE — it establishes nothing`.
//   M3 — when both have returned and the examiner is `DONE`, the driver copies
//        every Proof `Test:` path the examiner wrote over the same path in the
//        implementer's clone, re-captures the implementer's patch, and appends
//        one `driver:exam-handoff` event carrying `task` and `paths` before the
//        task's first `driver:exam-run`; a red exam at the pre-review pass
//        still buys the one repair round.
//   M4 — `examEdited` is judged against the HANDED-IN blobs, only after the
//        handoff: an implementer that wrote its own file at a Proof `Test:`
//        path yields `examEdited: []` and no judgment call naming it, while a
//        fix round that changes it yields `examEdited: [<path>]` and the
//        `EXAM EDITED: <path>` line in the reviewer's prompt.
//   M5 — a `BLOCKED` examiner, and one that returns no reply at all, each
//        leave the task unexamined: `exam` is `blocked`, no
//        `driver:exam-handoff` and no `driver:exam-run` event, and the
//        implementer's own file at the Proof path is what is folded.
//   M6 — `makeCwdFor` answers `<clonesDir>/exam-<id>` for `exam:<id>` and
//        `<clonesDir>/task-<id>` for `impl:<id>` and `fix:<id>:<n>`.
//
// Proof legs, and where each is asserted below: (a) the dispatch pair, the two
// clones, the bootstrapped exam clone, the prompt and the two patches [M1];
// (b) red at BASE vs green at BASE, decided in the exam clone [M2]; (c) the
// handoff — the peer's bytes on the integration branch, one event in its
// place, `examEdited: []` [M3][M4]; (d) one repair round, and a fix-round edit
// that IS recorded [M3][M4]; (e) a blocked and a dead examiner [M5]; (f)
// `makeCwdFor`'s answers [M6]; (g) the sentinel.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { makeCwdFor } from '../run-waves.mjs'
import { rig, makeRepo, gitSync, passReview, cleanCritic, doneImpl } from './_engine_helpers.mjs'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-exam-together-'))
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }))

// The real role files: this sim reads the prompt the engine actually builds,
// so `examiner.md` and `implementer.md` are read from `fleet/roles/` rather
// than from a temp copy — the byte-for-byte leg is about THOSE bytes.
const REAL_ROLES = fileURLToPath(new URL('../roles/', import.meta.url))
const EXAMINER_TEXT = fs.readFileSync(path.join(REAL_ROLES, 'examiner.md'), 'utf8')
const IMPLEMENTER_TEXT = fs.readFileSync(path.join(REAL_ROLES, 'implementer.md'), 'utf8')

// ── the task the sims run ───────────────────────────────────────────────────
const MACHINE = 'Machine: M1. The tree holds `one.txt` whose content is "from T1".'
const LEGS = '- Legs: (a) `one.txt` reads exactly "from T1" [M1]'
const BODY = '**Claim:** the tree gains one.txt\n' + MACHINE +
  '\n\n**Proof:**\n- Test: `t1_test.sh`\n' + LEGS
const entry = (over = {}) => ({
  id: 'T1', title: 'create one', files: ['one.txt'], tier: 'standard', review: 'lean',
  writes: ['one.txt'], commutes: [],
  interfaces: { consumes: ['`BASE_FACTS`'], produces: ['`ONE`'] },
  testCmd: 'bash t1_test.sh',
  proofTests: ['t1_test.sh'], proofRuns: [],
  body: BODY,
  ...over,
})

// The exam the peer writes: red at BASE until the implementer writes one.txt.
const RED_AT_BASE = '#!/bin/bash\n[ -f one.txt ]\n'
const GREEN_AT_BASE = '#!/bin/bash\nexit 0\n'
// What a submitter writes at the Proof path when it writes there itself — an
// exam that grades nothing, and distinguishable from the peer's byte for byte.
const IMPL_OWN = '#!/bin/bash\nexit 0 # written by the graded party, not the peer\n'
const REWRITTEN = '#!/bin/bash\nexit 0 # rewritten by the fix round\n'

const writeExam = (cwd, script = RED_AT_BASE) => {
  fs.writeFileSync(path.join(cwd, 't1_test.sh'), script)
  return { status: 'DONE', summary: 'exam written' }
}
const writeOne = (cwd) => fs.writeFileSync(path.join(cwd, 'one.txt'), 'from T1\n')

const GREEN_CALL = 'task T1: exam is green at BASE — it establishes nothing'

// ── reading the run's own record ────────────────────────────────────────────
// The ordering legs ask where the handoff sits relative to a DISPATCH, and a
// dispatch is not an engine event in this rig (the agent is a stub, so no
// worker envelope is written). So the stub appends its own line to the SAME
// append-only file the driver writes: one stream, one order, no second clock
// to reconcile. An absent file reads as no records, so an engine that writes
// none fails the assertion rather than throwing ENOENT.
const eventsFile = (runDir) => path.join(runDir, 'events.jsonl')
const markDispatch = (runDir, label) => {
  try {
    fs.appendFileSync(eventsFile(runDir), JSON.stringify({ kind: 'sim:dispatch', label }) + '\n')
  } catch { /* evidence, not control flow */ }
}
const readEvents = (runDir) => {
  const file = eventsFile(runDir)
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l) } catch { return null } })
    .filter(Boolean)
}
// Exact bytes off a ref, undecorated by the helper's `.trim()`: the leg is a
// byte equality against the peer's script, trailing newline included.
const showBytes = (cwd, ref, file) => {
  try {
    return execFileSync('git', ['show', ref + ':' + file],
      { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (e) {
    return 'ABSENT: ' + String((e && e.message) || e)
  }
}

const deferred = () => {
  let resolve
  const promise = new Promise((r) => { resolve = r })
  return { promise, resolve }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── the sim rig: the shared one, plus the exam/impl/fix hooks ───────────────
// `exam` receives the examiner's cwd and a context carrying the promise that
// resolves when the IMPLEMENTER is dispatched — leg (a)'s only way to observe
// that neither call awaits the other.
let seq = 0
async function scenario({ exam = (cwd) => writeExam(cwd), onImpl = writeOne, onFix = () => {},
                          review = () => passReview(), extraArgs = {} } = {}) {
  seq += 1
  const stamp = 'together' + seq
  const repo = makeRepo(path.join(tmp, 'repo-' + stamp))
  const runDir = path.join(tmp, 'run-' + stamp)
  const labels = []
  const seen = {}
  const implDispatched = deferred()
  const stub = async (prompt, opts, cwd) => {
    labels.push(opts.label)
    seen[opts.label] = { cwd, prompt, bootstrapped: fs.existsSync(path.join(cwd, 'bootstrapped')) }
    markDispatch(runDir, opts.label)
    const kind = opts.label.split(':')[0]
    if (kind === 'exam') return exam(cwd, { implDispatched: implDispatched.promise, labels })
    if (kind === 'impl') { implDispatched.resolve(); onImpl(cwd); return doneImpl(cwd) }
    if (kind === 'fix') { onFix(cwd, opts.label); return doneImpl(cwd) }
    if (kind === 'review') return review(opts.label)
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run, base, clonesDir, patchesDir, integ } = rig({
    repo, runDir, waves: [[entry()]], stub, stamp,
    extraArgs: { shallowLeg: false, ...extraArgs },
  })
  const report = await run()
  return { report, row: report.tasks[0], labels, seen, base, runDir, clonesDir, patchesDir,
           integ, branch: 'ultra/integration-' + stamp, events: readEvents(runDir) }
}

// ── (a) dispatched together, into two clones [M1] ───────────────────────────
// The examiner's reply is withheld until the implementer has been dispatched
// (or 3s pass, so a driver that still serializes the pair fails an assertion
// rather than hanging). What the log holds AT THAT MOMENT is the leg.
let clonesDirOfA = null
{
  let atReply = null
  const { row, labels, seen, base, clonesDir, patchesDir } = await scenario({
    exam: async (cwd, ctx) => {
      await Promise.race([ctx.implDispatched, sleep(3000)])
      atReply = ctx.labels.slice()
      return writeExam(cwd)
    },
    extraArgs: { bootstrapCmd: 'touch bootstrapped' },
  })
  clonesDirOfA = clonesDir

  // [M1] the pair: both dispatched, and the second one dispatched while the
  // first was still working.
  assert.deepEqual(atReply, ['exam:T1', 'impl:T1'],
    'the implementer was dispatched while the examiner was still working — ' +
    'the driver awaits neither before the other')
  assert.deepEqual(labels.filter((l) => l !== 'integration'),
    ['exam:T1', 'impl:T1', 'review:T1:1'],
    'and the run is otherwise the ordinary one: ' + labels.join(','))

  // [M1] the two clones.
  const examDir = path.join(clonesDir, 'exam-T1')
  const taskDir = path.join(clonesDir, 'task-T1')
  assert.equal(seen['exam:T1'].cwd, examDir, 'the examiner runs in its own clone')
  assert.equal(seen['impl:T1'].cwd, taskDir, 'the implementer in the task clone')
  assert.ok(fs.existsSync(examDir), 'the driver cut the exam clone itself (provision cuts only task-<id>)')
  assert.equal(gitSync(['rev-parse', 'HEAD'], examDir), base,
    'the exam clone is at the wave base')

  // [M1] the bootstrap ran there BEFORE the examiner was dispatched.
  assert.equal(seen['exam:T1'].bootstrapped, true,
    'the bootstrap command had already run in the exam clone when the examiner started')

  // [M1] the prompt: examiner.md, then the implementer's own inputs, verbatim.
  const examPrompt = seen['exam:T1'].prompt
  const implPrompt = seen['impl:T1'].prompt
  assert.ok(examPrompt.startsWith(EXAMINER_TEXT), 'the exam prompt opens with examiner.md verbatim')
  assert.ok(implPrompt.startsWith(IMPLEMENTER_TEXT), 'the impl prompt opens with implementer.md verbatim')
  assert.equal(examPrompt.slice(EXAMINER_TEXT.length), implPrompt.slice(IMPLEMENTER_TEXT.length),
    'the examiner gets the implementer\'s inputs byte for byte')

  // [M1] the two captures, in their two places.
  assert.ok(fs.existsSync(path.join(patchesDir, 'exam-T1.patch')),
    'the examiner\'s capture is written to exam-T1.patch')
  const taskPatch = fs.readFileSync(path.join(patchesDir, 'task-T1.patch'), 'utf8')
  assert.ok(taskPatch.includes('+++ b/t1_test.sh'),
    'and the implementer\'s patch, re-captured after the handoff, carries the exam\'s ' +
    'hunk: ' + taskPatch.slice(0, 600))
  assert.equal(row.status, 'done', 'the task still merges: ' + row.notes)
}

// ── (b) the wave-0 verdict, decided in the examiner's clone [M2] ────────────
{
  const { row, report, clonesDir } = await scenario({ exam: (cwd) => writeExam(cwd, RED_AT_BASE) })
  assert.equal(row.exam, 'red', 'the exam failed at BASE — it establishes something')
  assert.ok(!report.judgmentCalls.some((j) => j.includes('green at BASE')),
    'a red exam raises no green-at-BASE call: ' + report.judgmentCalls.join(' | '))
  assert.ok(fs.existsSync(path.join(clonesDir, 'exam-T1', 't1_test.sh')),
    'and the file the verdict was read from is the examiner\'s own, in the exam clone')
}
{
  const { row, report, clonesDir } = await scenario({ exam: (cwd) => writeExam(cwd, GREEN_AT_BASE) })
  assert.equal(row.exam, 'green-at-base')
  assert.deepEqual(report.judgmentCalls.filter((j) => j.includes('green at BASE')), [GREEN_CALL])
  assert.ok(fs.existsSync(path.join(clonesDir, 'exam-T1', 't1_test.sh')),
    'read from the examiner\'s own file in the exam clone here too')
}

// ── (c) the handoff: the peer's exam wins at the Proof path [M3] [M4] ───────
// The implementer writes its own `t1_test.sh` — an exam that grades nothing —
// before the handoff. The peer's bytes are what the run folds, the copy is one
// recorded event in its place, and the implementer's own file at that path is
// NOT an edit: `examEdited` is judged against the handed-in blobs.
{
  const { row, report, events, integ, branch } = await scenario({
    exam: (cwd) => writeExam(cwd, RED_AT_BASE),
    onImpl: (cwd) => {
      writeOne(cwd)
      fs.writeFileSync(path.join(cwd, 't1_test.sh'), IMPL_OWN)
    },
  })
  assert.equal(row.status, 'done', 'the task merged: ' + row.notes)
  assert.equal(showBytes(integ, branch, 't1_test.sh'), RED_AT_BASE,
    'the integration branch carries the peer\'s exam, byte for byte, not the submitter\'s')

  const handoffs = events.filter((e) => e.kind === 'driver:exam-handoff' && e.task === 'T1')
  assert.equal(handoffs.length, 1,
    'exactly one driver:exam-handoff event for T1: ' + JSON.stringify(handoffs))
  assert.deepEqual(handoffs[0].paths, ['t1_test.sh'],
    'carrying the copied Proof paths: ' + JSON.stringify(handoffs[0]))

  const iImpl = events.findIndex((e) => e.kind === 'sim:dispatch' && e.label === 'impl:T1')
  const iHandoff = events.findIndex((e) => e.kind === 'driver:exam-handoff' && e.task === 'T1')
  const iExamRun = events.findIndex((e) => e.kind === 'driver:exam-run' && e.task === 'T1')
  assert.ok(iImpl !== -1, 'the implementer was dispatched')
  assert.ok(iExamRun !== -1, 'and the driver ran the exam on the handed-in tree')
  assert.ok(iHandoff > iImpl, 'the handoff is appended after the implementer was dispatched')
  assert.ok(iHandoff < iExamRun, 'and before the task\'s first driver:exam-run')

  // [M4] the implementer's own file at the Proof path is not an edit of an exam
  // it was never handed.
  assert.deepEqual(row.examEdited, [],
    'nothing was edited: the blobs are recorded from the handoff, not from before it')
  assert.deepEqual(report.judgmentCalls.filter((j) => j.includes('t1_test.sh')), [],
    'and no judgment call names the path: ' + report.judgmentCalls.join(' | '))
}

// ── (d) one repair round, and a fix-round edit that IS recorded [M3] [M4] ───
// The implementer never writes `one.txt`, so the handed-in exam is red at the
// pre-review pass: one `fix:T1:0`, as at BASE. That fix rewrites the exam —
// the case the referee, not the driver, decides.
{
  const { row, labels, seen } = await scenario({
    exam: (cwd) => writeExam(cwd, RED_AT_BASE),
    onImpl: () => {},
    onFix: (cwd) => fs.writeFileSync(path.join(cwd, 't1_test.sh'), REWRITTEN),
  })
  assert.deepEqual(labels.filter((l) => l.startsWith('fix:')), ['fix:T1:0'],
    'a red exam on the handed-in tree buys exactly one repair round: ' + labels.join(','))
  assert.equal(row.proofFixes, 1)
  assert.deepEqual(row.examEdited, ['t1_test.sh'],
    'the fix round\'s edit of the handed-in exam is recorded')
  assert.equal(typeof (seen['review:T1:1'] || {}).prompt, 'string',
    'the repaired tree reached a referee: ' + labels.join(','))
  assert.ok(seen['review:T1:1'].prompt.includes('EXAM EDITED: t1_test.sh'),
    'and the referee is told which Proof path moved')
}

// ── (e) a blocked examiner, and one that never answers [M5] ─────────────────
for (const [name, reply] of [
  ['BLOCKED', () => ({ status: 'BLOCKED', summary: 'the Proof names no runnable test' })],
  ['null', () => null],
]) {
  const { row, events, integ, branch } = await scenario({
    exam: () => reply(),
    onImpl: (cwd) => {
      writeOne(cwd)
      fs.writeFileSync(path.join(cwd, 't1_test.sh'), IMPL_OWN)
    },
  })
  assert.equal(row.exam, 'blocked', name + ' examiner records a blocked exam')
  assert.deepEqual(events.filter((e) => e.kind === 'driver:exam-handoff' && e.task === 'T1'), [],
    name + ' examiner hands off nothing')
  assert.deepEqual(events.filter((e) => e.kind === 'driver:exam-run' && e.task === 'T1'), [],
    name + ' examiner leaves the task unexamined — no exam is run')
  assert.equal(showBytes(integ, branch, 't1_test.sh'), IMPL_OWN,
    name + ' examiner: the implementer\'s own file at the Proof path is what is folded')
  assert.equal(row.status, 'done', name + ' examiner does not fail the task')
}

// ── (f) the label→clone map [M6] ────────────────────────────────────────────
// Read off the clones leg (a)'s run left behind, so both directories exist and
// the answer is the one a real dispatch would get. A missing clone is a throw
// in `makeCwdFor` by design; it is turned into a value here so the leg reports
// what was answered rather than dying at the call.
{
  const cwdFor = makeCwdFor({ clonesDir: clonesDirOfA })
  const answer = (label) => {
    try { return cwdFor({ label, isolation: 'worktree' }) } catch (e) { return 'threw: ' + String((e && e.message) || e) }
  }
  assert.equal(answer('exam:T1'), path.join(clonesDirOfA, 'exam-T1'),
    'makeCwdFor routes exam:<id> to the exam clone')
  assert.equal(answer('impl:T1'), path.join(clonesDirOfA, 'task-T1'),
    'and impl:<id> to the task clone')
  assert.equal(answer('fix:T1:0'), path.join(clonesDirOfA, 'task-T1'),
    'and fix:<id>:<n> to the task clone, where the fix round still runs')
}

// ── (g) the sentinel ────────────────────────────────────────────────────────
console.log('ALL TESTS PASSED')
