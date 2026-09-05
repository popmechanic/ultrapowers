// fleet/tests/test_run_engine_exam_edits.mjs — the recorded-edit half of the
// wave-0 examiner (#553), split out of test_run_engine_examiner.mjs so each
// half finishes inside a bridge slot. What this pins: an exam the implementer
// (or the fix round) edits is recorded, named to the referee, and reviewed —
// never refused by the driver — and the record is one blob per proofTests
// path, with an absent path recorded as null.
//
// Everything below the agent seam is real (git, clones, capture, the fold
// kernel, the blob shas, the red-at-BASE run); only the judgments are canned.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSeam } from '../run-main.mjs'
import { makeCwdFor, withPatchCapture, defaultTaskIdOf } from '../run-waves.mjs'
import { runEngine } from '../run-engine.mjs'
import { makeRepo, provision, passReview, cleanCritic, doneImpl } from './_engine_helpers.mjs'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-exam-edits-'))
const REAL_ROLES = fileURLToPath(new URL('../roles/', import.meta.url))
const SIX = ['implementer', 'reviewer', 'fix', 'resolver', 'reconcile', 'critic']

// The seventh role file. `fleet/roles/examiner.md` is a sibling task's to
// write, so the sims point `rolesDir` at a temp directory holding all seven.
const EXAMINER_TEXT = '# examiner (sim)\n\nYou write the exam and nothing else.\n'
const rolesDir = path.join(tmp, 'roles')
fs.mkdirSync(rolesDir, { recursive: true })
for (const name of SIX) {
  fs.copyFileSync(path.join(REAL_ROLES, name + '.md'), path.join(rolesDir, name + '.md'))
}
fs.writeFileSync(path.join(rolesDir, 'examiner.md'), EXAMINER_TEXT)

// The rig, with `rolesDir` threaded through (the shared one in
// _engine_helpers.mjs has no seam for it): real clones, real capture, real
// exec seam, canned judgments.
let seq = 0
function rig({ waves, stub, testCmd = 'bash check.sh' }) {
  seq += 1
  const stamp = 'examedit' + seq
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
const writeOne = (cwd) => fs.writeFileSync(path.join(cwd, 'one.txt'), 'from T1\n')

// ── (d) an edited exam is recorded, named to the referee, and reviewed [M4] ─
// One rule since 2026-09-02 (after run-53): the driver never refuses the
// edit. It lands on the row as `examEdited`, in one judgment call, and in the
// review prompt as EXAM EDITED; the referee (reviewer.md rule 8) decides.
//
// Since #653 the only party that CAN edit the exam is a fix round: the
// implementer works in a clone the exam never entered, and the peer's bytes
// arrive over its Proof paths at the handoff. So the first case below is the
// implementer's own file at a Proof path — an event with nothing to record —
// and the enforcement cases move to the round that really holds the exam.
const editExam = (cwd) =>
  fs.writeFileSync(path.join(cwd, 't1_test.sh'), '#!/bin/bash\nexit 0 # rewritten by the graded party\n')
{
  // The implementer writes its own file at the Proof path. It was never handed
  // the exam, so this is not an edit of one: the peer's bytes overwrite it at
  // the handoff, the row records no drift, and the referee is told nothing.
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
  const { run, clonesDir } = rig({ waves: [[entry()]], stub })
  const report = await run()
  assert.equal(report.tasks[0].status, 'done', 'the task merges: ' + report.tasks[0].notes)
  assert.equal(report.tasks[0].reviewVerdict, 'clean')
  assert.equal(report.tasks[0].exam, 'red', 'the value read in the examiner\'s clone at BASE')
  assert.deepEqual(report.tasks[0].examEdited, [], 'nothing was edited — the peer\'s bytes won')
  assert.equal(fs.readFileSync(path.join(clonesDir, 'task-T1', 't1_test.sh'), 'utf8'), RED_AT_BASE,
    'the graded tree holds the exam, not the implementer\'s file')
  assert.ok(labels.includes('review:T1:1'), 'the review is dispatched: ' + labels.join(','))
  // reviewer.md's rule 8 mentions the line, so the pin is on the LINE the
  // driver appends to the inputs, not on the two words.
  assert.ok(!prompts['review:T1:1'].includes('\nEXAM EDITED: '),
    'and the referee is handed no EXAM EDITED line')
  assert.equal(report.coverage.tasks_merged, 1)
  assert.deepEqual(report.judgmentCalls.filter((j) => j.includes('t1_test.sh')), [])
}
{
  // The referee, told, may block it — and that is the whole enforcement. The
  // edit is the fix round's, which is the round that holds the exam.
  const stub = (prompt, opts, cwd) => {
    const kind = opts.label.split(':')[0]
    if (kind === 'exam') return examOk(cwd)
    if (kind === 'impl') { writeOne(cwd); return doneImpl(cwd) }
    if (kind === 'review') return { verdict: 'FIX_REQUIRED', issues: [{ severity: 'blocking', detail: 'the exam was weakened' }] }
    if (kind === 'fix') { editExam(cwd); return doneImpl(cwd) }
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
  // A green-at-BASE exam keeps the value it recorded, and the implementer's own
  // file at that path still records nothing: the verdict is read in the
  // examiner's clone, the drift is read in the graded one after the handoff.
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
  assert.deepEqual(report.tasks[0].examEdited, [])
}

// ── (f) one blob per proofTests path, absent recorded as null [M2, M4] ─────
// The mutations belong to the fix round: it is the round that works in a tree
// the exam has been handed into, so it is the only one whose writes at a Proof
// path are edits of an exam at all (#653). The first review blocks to buy it.
const twoPathScenario = async (fixFn, paths = ['t1_test.sh', 't1_extra.sh'],
                               examFiles = { 't1_test.sh': RED_AT_BASE }) => {
  const labels = []
  const stub = (prompt, opts, cwd) => {
    labels.push(opts.label)
    const kind = opts.label.split(':')[0]
    if (kind === 'exam') return examOk(cwd, examFiles)
    if (kind === 'impl') { writeOne(cwd); return doneImpl(cwd) }
    if (opts.label === 'review:T1:1') {
      return { verdict: 'FIX_REQUIRED', issues: [{ severity: 'blocking', detail: 'another look' }] }
    }
    if (kind === 'review') return passReview()
    if (kind === 'fix') { fixFn(cwd); return doneImpl(cwd) }
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
