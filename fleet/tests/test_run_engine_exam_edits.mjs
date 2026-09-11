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
import { makeRepo, provision, gitSync, passReview, cleanCritic, doneImpl } from './_engine_helpers.mjs'

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
  // `stamp` rides along so a sim can read the integration branch this run
  // folded onto (`ultra/integration-<stamp>`) in the `integ` clone.
  return { run, base, repo, runDir, clonesDir, patchesDir, integ, stamp }
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
  // Task 2, leg (f) [M4]: with no edit there is no block to show either. Same
  // reason as above — rule 8 quotes `EXAM EDITED DIFF <path>:` mid-sentence
  // when it tells the referee where to read the hunks, so the two words are in
  // every review prompt. The pin is on the block HEADER LINE the driver
  // appends, which is the thing that must be absent.
  assert.ok(!prompts['review:T1:1'].split('\n').some((l) => l.startsWith('EXAM EDITED DIFF ')),
    'and no EXAM EDITED DIFF block')
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

// An exam-EDIT judgment call, and only that: other judgment calls a run
// records (a plan defect deferred to the gate, a pre-review red) are not this
// sim's business.
const isExamEdit = (j) => j.includes('edited the exam')

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
  assert.deepEqual(report.judgmentCalls.filter(isExamEdit).filter((j) => j.includes('t1_extra.sh')), [])
}
{
  // Creates the path the examiner left absent: the recorded null moved.
  const { report } = await twoPathScenario((cwd) => fs.writeFileSync(path.join(cwd, 't1_extra.sh'), 'x\n'))
  assert.deepEqual(report.tasks[0].examEdited, ['t1_extra.sh'])
  const calls = report.judgmentCalls.filter(isExamEdit)
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

// ── Task 2: the referee sees what an exam edit changed against the peer's
// bytes (#700 option (a), #556, #551) ───────────────────────────────────────
// `examEdited` names the path and reviewer.md rule 8 asks the referee to judge
// the edit — but PATCH diffs the graded clone against BASE, where the Proof
// path does not exist, so an edited exam reads there as a whole-file add and
// the referee cannot see which lines the peer wrote. These legs pin the other
// half: one `EXAM EDITED DIFF <path>:` block per edited path, carrying the
// unified diff from the bytes the examiner left at that path (empty, when it
// left the path absent) to the bytes in the graded tree [M1]. On those hunks a
// strengthening edit can be accepted and a weakening one blocked.

// The strengthening edit: the peer's line kept, one more appended. Green on
// the tree `writeOne` made, so round 2's exam evidence is green.
const APPENDED = '[ "$(cat one.txt)" = "from T1" ]'
const STRENGTHENED = RED_AT_BASE + APPENDED + '\n'

// One block of a review prompt: from its `EXAM EDITED DIFF <path>:` header
// line up to the next block, the RUN EVIDENCE text, or the end of the prompt.
const diffBlock = (prompt, p) => {
  const header = 'EXAM EDITED DIFF ' + p + ':'
  const at = prompt.indexOf('\n' + header + '\n')
  if (at < 0) return null
  const rest = prompt.slice(at + 1)
  const ends = ['\nEXAM EDITED DIFF ', '\n\nRUN EVIDENCE:', '\n\nEXAM EVIDENCE:']
    .map((s) => rest.indexOf(s, header.length))
    .filter((i) => i >= 0)
  return ends.length ? rest.slice(0, Math.min(...ends)) : rest
}

// A first review that blocks buys the fix round — the only round that holds
// the exam (#653) — and `review:T1:2` is the prompt these legs read. A
// `Run:` proof rides along so the prompt really carries the RUN EVIDENCE text
// leg (a) orders the block against.
const fixRoundScenario = async ({ fixFn, review2 = passReview,
                                  paths = ['t1_test.sh'],
                                  examFiles = { 't1_test.sh': RED_AT_BASE } }) => {
  const labels = []
  const prompts = {}
  const stub = (prompt, opts, cwd) => {
    labels.push(opts.label)
    prompts[opts.label] = prompt
    const kind = opts.label.split(':')[0]
    if (kind === 'exam') return examOk(cwd, examFiles)
    if (kind === 'impl') { writeOne(cwd); return doneImpl(cwd) }
    if (opts.label === 'review:T1:1') {
      return { verdict: 'FIX_REQUIRED', issues: [{ severity: 'blocking', detail: 'not yet' }] }
    }
    if (opts.label === 'review:T1:2') return review2()
    if (kind === 'review') return passReview()
    if (kind === 'fix') { fixFn(cwd); return doneImpl(cwd) }
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run, integ, stamp } = rig({
    waves: [[entry({ proofTests: paths, proofRuns: ['true'] })]], stub,
  })
  const report = await run()
  return { report, prompts, labels, integ, stamp }
}

{
  // (a)+(b)+(c) — a fix round that only STRENGTHENS the exam: the peer's line
  // survives, one line is appended, the referee sees exactly that and passes.
  const { report, prompts, labels, integ, stamp } = await fixRoundScenario({
    fixFn: (cwd) => fs.writeFileSync(path.join(cwd, 't1_test.sh'), STRENGTHENED),
  })
  assert.deepEqual(labels.filter((l) => l !== 'integration'),
    ['exam:T1', 'impl:T1', 'review:T1:1', 'fix:T1:1', 'review:T1:2'],
    'the fix round proceeds to its re-review: ' + labels.join(','))

  // (a) [M1] the EXAM EDITED line, then the block header, then a @@ hunk
  // header — all of it before the RUN EVIDENCE text.
  const prompt = prompts['review:T1:2']
  const lines = prompt.split('\n')
  const iEdited = lines.indexOf('EXAM EDITED: t1_test.sh')
  const iBlock = lines.indexOf('EXAM EDITED DIFF t1_test.sh:')
  const iRun = lines.findIndex((l) => l.startsWith('RUN EVIDENCE:'))
  assert.ok(iEdited >= 0, '(a)[M1] the re-review prompt carries the line `EXAM EDITED: t1_test.sh`')
  assert.ok(iRun >= 0, '(a)[M1] the re-review prompt carries the RUN EVIDENCE text the block precedes')
  assert.ok(iBlock > iEdited,
    '(a)[M1] a line `EXAM EDITED DIFF t1_test.sh:` follows the EXAM EDITED line (at ' +
    iBlock + ' vs ' + iEdited + ')')
  assert.ok(iBlock < iRun,
    '(a)[M1] and it comes before the RUN EVIDENCE text (at ' + iBlock + ' vs ' + iRun + ')')
  const block = diffBlock(prompt, 't1_test.sh')
  assert.ok(block, '(a)[M1] the block is delimited')
  const blockLines = block.split('\n')
  assert.ok(blockLines.some((l) => l.startsWith('@@')),
    '(a)[M1] and then a @@ hunk header: ' + JSON.stringify(block))
  assert.ok(blockLines.some((l) => l.startsWith('---')) && blockLines.some((l) => l.startsWith('+++')),
    '(a)[M1] the block carries the ---/+++ header lines of a unified diff: ' + JSON.stringify(block))

  // (b) [M2] the appended line is a `+` content line, and nothing was removed:
  // no line of the block begins `-` other than the `---` header.
  assert.ok(blockLines.includes('+' + APPENDED),
    '(b)[M2] the block carries the content line `+' + APPENDED + '`: ' + JSON.stringify(block))
  assert.ok(!/\n-(?!--)/.test(block),
    '(b)[M2] and no `-` content line — the peer\'s bytes all survive: ' + JSON.stringify(block))
  const afterPlusPlus = blockLines.slice(blockLines.findIndex((l) => l.startsWith('+++')) + 1)
  assert.ok(!afterPlusPlus.some((l) => l.startsWith('-')),
    '(b)[M2] nothing beginning `-` after the +++ header: ' + JSON.stringify(afterPlusPlus))

  // (c) [M2] the strengthened exam is accepted, recorded, and folded.
  assert.equal(report.tasks[0].status, 'done', '(c)[M2] the row is done: ' + report.tasks[0].notes)
  assert.equal(report.tasks[0].reviewVerdict, 'fixed', '(c)[M2] reviewVerdict')
  assert.deepEqual(report.tasks[0].examEdited, ['t1_test.sh'], '(c)[M2] examEdited')
  assert.equal(report.tasks[0].exam, 'red', '(c)[M2] the value read in the examiner\'s clone at BASE')
  assert.equal(report.coverage.tasks_merged, 1, '(c)[M2] tasks_merged')
  const merged = gitSync(['show', 'ultra/integration-' + stamp + ':t1_test.sh'], integ)
  assert.ok(merged.includes('[ -f one.txt ]'),
    '(c)[M2] the integration branch keeps the peer\'s line: ' + JSON.stringify(merged))
  assert.ok(merged.includes(APPENDED),
    '(c)[M2] and holds the appended one: ' + JSON.stringify(merged))
}

{
  // (d) [M3] the same round WEAKENS the exam: the peer's line is gone, the
  // block shows it as a `-` content line, and the referee blocks on that.
  const { report, prompts } = await fixRoundScenario({
    fixFn: editExam,
    review2: () => ({
      verdict: 'FIX_REQUIRED',
      issues: [{ severity: 'blocking',
                 detail: 'the exam was weakened — the peer\'s [ -f one.txt ] is gone',
                 actor: 'implementer' }],
    }),
  })
  const block = diffBlock(prompts['review:T1:2'], 't1_test.sh')
  assert.ok(block, '(d)[M3] the re-review prompt carries the block for the edited path')
  assert.ok(block.split('\n').includes('-[ -f one.txt ]'),
    '(d)[M3] whose content line `-[ -f one.txt ]` is the dropped assertion: ' + JSON.stringify(block))
  assert.equal(report.tasks[0].status, 'failed', '(d)[M3] the row is failed')
  assert.equal(report.tasks[0].reviewVerdict, 'fix-loop-exhausted', '(d)[M3] reviewVerdict')
  assert.deepEqual(report.tasks[0].examEdited, ['t1_test.sh'], '(d)[M3] examEdited')
  assert.equal(report.coverage.tasks_merged, 0, '(d)[M3] nothing merges')
}

{
  // (e) [M1] a Proof path the examiner left ABSENT that the fix round creates:
  // the block diffs from empty, so every content line is an addition.
  const { report, prompts } = await fixRoundScenario({
    fixFn: (cwd) => fs.writeFileSync(path.join(cwd, 't1_extra.sh'), 'x\n'),
    paths: ['t1_test.sh', 't1_extra.sh'],
  })
  assert.deepEqual(report.tasks[0].examEdited, ['t1_extra.sh'], '(e)[M1] the created path is the edit')
  const block = diffBlock(prompts['review:T1:2'], 't1_extra.sh')
  assert.ok(block, '(e)[M1] a block `EXAM EDITED DIFF t1_extra.sh:` is carried')
  const blockLines = block.split('\n')
  const content = blockLines.slice(blockLines.findIndex((l) => l.startsWith('+++')) + 1)
    .filter((l) => l !== '' && !l.startsWith('@@') && !l.startsWith('\\'))
  assert.ok(content.length > 0, '(e)[M1] the block has content lines: ' + JSON.stringify(block))
  for (const l of content) {
    assert.ok(l.startsWith('+'),
      '(e)[M1] every content line of an absent-path block begins `+`: ' + JSON.stringify(l))
  }
  assert.ok(!diffBlock(prompts['review:T1:2'], 't1_test.sh'),
    '(e)[M1] and the untouched path gets no block')
}

console.log('ALL TESTS PASSED')
