// fleet/tests/test_run_engine_exam_fix_edit.mjs — a referee's fix to the exam
// is reviewed, not refused (run-54 task 5).
//
// The engine checks exam drift at two moments. Before any review, an edited
// exam is the task grading itself and that stop stays (leg c / M3). After a
// blocking review, the fix round is applying a referee's findings — on run-53
// the finding WAS the exam, with the referee's own proposedPatch attached —
// so the second stop is demoted: the run records which Proof paths moved,
// pushes one judgment call, and falls through to the re-review that reads the
// whole fix patch, exam hunks included (legs a, b, d, e / M1, M2, M4, M5).
//
// The rig is the examiner sim's: real repos, real clones, real capture, the
// real fold kernel; only the judgments are canned. `rig` is not exported from
// test_run_engine_examiner.mjs, so this sim builds its own — including its own
// rolesDir (the real six roles plus a sim examiner file), the way that sim does.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { execSeam } from '../run-main.mjs'
import { makeCwdFor, withPatchCapture, defaultTaskIdOf } from '../run-waves.mjs'
import { runEngine } from '../run-engine.mjs'
import { makeRepo, provision, passReview, cleanCritic, doneImpl } from './_engine_helpers.mjs'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-exam-fix-'))
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const REAL_ROLES = fileURLToPath(new URL('../roles/', import.meta.url))
const SIX = ['implementer', 'reviewer', 'fix', 'resolver', 'reconcile', 'critic']

const rolesDir = path.join(tmp, 'roles')
fs.mkdirSync(rolesDir, { recursive: true })
for (const name of SIX) {
  fs.copyFileSync(path.join(REAL_ROLES, name + '.md'), path.join(rolesDir, name + '.md'))
}
fs.writeFileSync(path.join(rolesDir, 'examiner.md'), '# examiner (sim)\n\nYou write the exam and nothing else.\n')

let seq = 0
function rig({ waves, stub, testCmd = 'bash check.sh' }) {
  seq += 1
  const stamp = 'examfix' + seq
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

const BODY = '**Claim:** the tree gains one.txt\n' +
  'Machine: M1. The tree holds `one.txt` whose content is "from T1".\n\n' +
  '**Proof:**\n- Test: `t1_test.sh`\n- Legs: (a) `one.txt` reads exactly "from T1" [M1]'
const entry = (over = {}) => ({
  id: 'T1', title: 'create one', files: ['one.txt'], tier: 'standard', review: 'lean',
  writes: ['one.txt'], commutes: [],
  interfaces: { consumes: ['`BASE_FACTS`'], produces: ['`ONE`'] },
  testCmd: 'bash t1_test.sh',
  proofTests: ['t1_test.sh'],
  body: BODY,
  ...over,
})

const RED_AT_BASE = '#!/bin/bash\n[ -f one.txt ]\n'
const examOk = (cwd, files) => {
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(cwd, name), text)
  return { status: 'DONE', summary: 'exam written', startHead: 'ignored' }
}
const writeOne = (cwd) => fs.writeFileSync(path.join(cwd, 'one.txt'), 'from T1\n')
const rewrite = (name) => (cwd) =>
  fs.writeFileSync(path.join(cwd, name), '#!/bin/bash\nexit 0 # repaired under the referee\'s finding\n')
const editExam = rewrite('t1_test.sh')
const blockingReview = () => ({
  verdict: 'FIX_REQUIRED',
  issues: [{ severity: 'blocking', detail: 'the exam pins a tree-dependent path' }],
})
const FIX_CALL = 'task T1: the fix round edited the exam — '

// A run whose first review blocks, whose fix round runs `onFix` in the task's
// clone, and whose second review answers `secondReview`.
async function fixRoundRun({
  proofTests = ['t1_test.sh'],
  examFiles = { 't1_test.sh': RED_AT_BASE },
  onFix = editExam,
  secondReview = passReview,
} = {}) {
  const labels = []
  const stub = (prompt, opts, cwd) => {
    labels.push(opts.label)
    const kind = opts.label.split(':')[0]
    if (kind === 'exam') return examOk(cwd, examFiles)
    if (kind === 'impl') { writeOne(cwd); return doneImpl(cwd) }
    if (opts.label === 'review:T1:1') return blockingReview()
    if (opts.label === 'review:T1:2') return secondReview()
    if (kind === 'fix') { onFix(cwd); return doneImpl(cwd) }
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run } = rig({ waves: [[entry({ proofTests })]], stub })
  const report = await run()
  return { report, labels, row: report.tasks[0], calls: report.judgmentCalls }
}

// ── (a) the fix round's edit is reviewed and folded [M1] ────────────────────
const runA = await fixRoundRun()
assert.deepEqual(runA.labels.filter((l) => l !== 'integration'),
  ['exam:T1', 'impl:T1', 'review:T1:1', 'fix:T1:1', 'review:T1:2'],
  '(a)/M1: the fix round proceeds to its re-review — labels: ' + runA.labels.join(','))
assert.equal(runA.row.status, 'done', '(a)/M1: the task is not returned as failed: ' + runA.row.notes)
assert.equal(runA.row.reviewVerdict, 'fixed', '(a)/M1: a PASS re-review reads `fixed`')
assert.deepEqual(runA.row.examEdited, ['t1_test.sh'], '(a)/M1: examEdited is the array of moved paths')
assert.equal(runA.report.coverage.tasks_merged, 1, '(a)/M1: and coverage.tasks_merged counts it')

// ── (b) exactly one judgment call, naming every moved path and no other [M1, M2] ─
const fixCalls = (calls) => calls.filter((j) => j.startsWith(FIX_CALL))
assert.equal(fixCalls(runA.calls).length, 1,
  '(b)/M2: exactly one `' + FIX_CALL + '` entry: ' + runA.calls.join(' | '))
assert.ok(fixCalls(runA.calls)[0].includes('t1_test.sh'),
  '(b)/M2: and it names the moved path: ' + fixCalls(runA.calls)[0])
{
  // Two Proof paths, one written and one recorded absent; only the written one moves.
  const { row, calls } = await fixRoundRun({ proofTests: ['t1_test.sh', 't1_extra.sh'] })
  assert.deepEqual(row.examEdited, ['t1_test.sh'], '(b)/M1: only the moved path is recorded')
  assert.equal(fixCalls(calls).length, 1, '(b)/M2: still exactly one entry: ' + calls.join(' | '))
  assert.ok(fixCalls(calls)[0].includes('t1_test.sh'), '(b)/M2: the entry names the moved path')
  assert.ok(!fixCalls(calls)[0].includes('t1_extra.sh'),
    '(b)/M2: and not the untouched one: ' + fixCalls(calls)[0])
}
{
  // Two written Proof paths, both rewritten by the fix round. The expected
  // array is the task's declared `proofTests` order, which is the order the
  // recorded blob list is walked in.
  const { row, calls } = await fixRoundRun({
    proofTests: ['t1_test.sh', 't1_second.sh'],
    examFiles: { 't1_test.sh': RED_AT_BASE, 't1_second.sh': '#!/bin/bash\nexit 1\n' },
    onFix: (cwd) => { rewrite('t1_test.sh')(cwd); rewrite('t1_second.sh')(cwd) },
  })
  assert.deepEqual(row.examEdited, ['t1_test.sh', 't1_second.sh'],
    '(b)/M1: both moved paths are recorded')
  assert.equal(fixCalls(calls).length, 1, '(b)/M2: one entry for both: ' + calls.join(' | '))
  assert.ok(fixCalls(calls)[0].includes('t1_test.sh') && fixCalls(calls)[0].includes('t1_second.sh'),
    '(b)/M2: naming both moved paths: ' + fixCalls(calls)[0])
}

// ── (c) the first-round guard is unchanged [M3] ─────────────────────────────
{
  const labels = []
  const stub = (prompt, opts, cwd) => {
    labels.push(opts.label)
    const kind = opts.label.split(':')[0]
    if (kind === 'exam') return examOk(cwd, { 't1_test.sh': RED_AT_BASE })
    if (kind === 'impl') { writeOne(cwd); editExam(cwd); return doneImpl(cwd) }
    if (kind === 'review') return passReview()
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run } = rig({ waves: [[entry()]], stub })
  const report = await run()
  const row = report.tasks[0]
  assert.equal(row.status, 'failed', '(c)/M3: an exam edited before any review still fails')
  assert.equal(row.reviewVerdict, 'exam-edited', '(c)/M3: with reviewVerdict exam-edited')
  assert.ok(!labels.some((l) => l.startsWith('review:T1')),
    '(c)/M3: and no review is dispatched: ' + labels.join(','))
  assert.equal(report.coverage.tasks_merged, 0, '(c)/M3: the patch is not folded')
  assert.ok(!Object.prototype.hasOwnProperty.call(row, 'examEdited'),
    '(c)/M3: a row returned before a fix round carries no examEdited key')
}

// ── (d) an exam edited by the fix round does not bypass the referee [M4] ────
{
  const { row, labels } = await fixRoundRun({ secondReview: blockingReview })
  assert.ok(labels.includes('review:T1:2'), '(d)/M4: the re-review ran: ' + labels.join(','))
  assert.equal(row.status, 'failed', '(d)/M4: a blocking re-review fails the task')
  assert.equal(row.reviewVerdict, 'fix-loop-exhausted',
    '(d)/M4: as any other task does, not as an exam-edited refusal')
}

// ── (e) a fix round that leaves every Proof blob alone [M5] ─────────────────
{
  const { row, calls } = await fixRoundRun({ onFix: () => {} })
  assert.equal(row.status, 'done', '(e)/M5: the task merges: ' + row.notes)
  assert.deepEqual(row.examEdited, [], '(e)/M5: examEdited is exactly []')
  assert.deepEqual(calls.filter((j) => j.includes('edited the exam')), [],
    '(e)/M5: and nothing claims the exam was edited: ' + calls.join(' | '))
}

// ── (f) the report's field table [M6] ───────────────────────────────────────
const M6_SENTENCE = 'Raised only before the first review; an exam a referee asked the fix round ' +
  'to repair is folded and recorded under `examEdited` instead (run-53, #556).'
const EXAM_EDITED_ROW = '| `tasks[].examEdited` |'
const VERDICT_ROW = '| `tasks[].reviewVerdict` |'
const reportTableOk = (text) => {
  const lines = text.split('\n')
  const verdict = lines.filter((l) => l.startsWith(VERDICT_ROW))
  return lines.some((l) => l.startsWith(EXAM_EDITED_ROW)) &&
    verdict.length > 0 && verdict.every((l) => l.includes(M6_SENTENCE))
}
{
  const p = path.join(REPO_ROOT, 'skills/ultrapowers/references/report-format.md')
  const text = fs.readFileSync(p, 'utf8')
  assert.ok(text.split('\n').some((l) => l.startsWith(EXAM_EDITED_ROW)),
    '(f)/M6: the field table has a `tasks[].examEdited` row')
  const verdict = text.split('\n').filter((l) => l.startsWith(VERDICT_ROW))
  assert.equal(verdict.length, 1, '(f)/M6: one `tasks[].reviewVerdict` row')
  assert.ok(verdict[0].includes(M6_SENTENCE),
    '(f)/M6: that row carries the sentence verbatim: ' + verdict[0])
  assert.ok(reportTableOk(text), '(f)/M6: the check passes on the file as it stands')
  // The sentence belongs to that row, not merely to the file: a copy with it
  // moved to a line of its own fails the same check.
  const moved = text.replace(M6_SENTENCE, '') + '\n' + M6_SENTENCE + '\n'
  assert.ok(moved.includes(M6_SENTENCE), '(f)/M6: the moved copy still contains the sentence')
  assert.ok(!reportTableOk(moved), '(f)/M6: yet fails the row-anchored check')
}

// ── (g) no file gains an upper-case whole-word shouting verb [M7] ───────────
// The three words are assembled from pieces so this file itself carries none
// of them as whole words — it is one of the files the leg walks.
const SHOUT = ['NEV' + 'ER', 'ALW' + 'AYS', 'MU' + 'ST']
const shoutSet = (text) => {
  const re = new RegExp('\\b(' + SHOUT.join('|') + ')\\b', 'g')
  return [...new Set(String(text).match(re) || [])].sort().join(',')
}
assert.equal(shoutSet('a ' + SHOUT[0] + ' b ' + SHOUT[2] + ' c'), SHOUT[2] + ',' + SHOUT[0],
  '(g)/M7: the matcher finds whole upper-case words')
assert.equal(shoutSet('it must always never bother'), '',
  '(g)/M7: lower-case prose is not a match')
assert.notEqual(shoutSet('gained a ' + SHOUT[1] + ' here'), shoutSet('gained a here'),
  '(g)/M7: a gained word makes the sets differ — the leg fails on such a tree')
{
  const BASE_SHA = 'd6efce4'
  const git = (argv) => {
    try {
      return { code: 0, out: execFileSync('git', argv, { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }
    } catch (e) {
      return { code: 1, out: '' }
    }
  }
  const diff = git(['diff', '--name-only', BASE_SHA])
  assert.equal(diff.code, 0, '(g)/M7: `git diff --name-only ' + BASE_SHA + '` runs in this tree')
  for (const rel of diff.out.split('\n').filter((l) => l.trim() !== '')) {
    const shown = git(['show', BASE_SHA + ':' + rel])
    const atBase = shown.code === 0 ? shown.out : ''   // new since BASE → empty
    const abs = path.join(REPO_ROOT, rel)
    const now = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : ''
    assert.equal(shoutSet(now), shoutSet(atBase),
      '(g)/M7: ' + rel + ' changed its upper-case NEV/ALW/MU set against BASE')
  }
}

console.log('ALL TESTS PASSED')
