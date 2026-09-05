// fleet/tests/test_run_engine_implementer_suite.mjs — #663: the implementer is
// handed the run-wide suite, the exam keeps its own command.
//
// The claim under test: the implementer's TEST COMMAND is the run-wide suite
// whenever the task's `testCmd` names one of its Proof `Test:` paths — the
// exam's command stays the examiner's, the driver's pre-review pass's and the
// reviewer's.
//
// Machine clauses, restated as this sim reads them:
//   M1 — for a task whose `testCmd` contains one of its `proofTests` paths, the
//        implementer's prompt (label `impl:<id>`) carries the line
//        `TEST COMMAND: <workerTestCmd>` — the run-wide command exactly as a
//        task with no `testCmd` receives it — and no line
//        `TEST COMMAND: <task.testCmd>`.
//   M2 — the examiner's prompt (label `exam:<id>`) carries
//        `TEST COMMAND: <task.testCmd>` as at BASE, and its inputs after the
//        role text differ from the implementer's in that one line only: the
//        examiner's tail with its `TEST COMMAND:` line replaced by the
//        implementer's is byte-equal to the implementer's tail.
//   M3 — the exam's command is `task.testCmd` at each of the four places the
//        driver or a referee touches it: the examiner's red-at-BASE run
//        executes it in `<clonesDir>/exam-<id>`; the pre-review pass's
//        `driver:exam-run` event (`iter: 0`) carries `cmd` equal to
//        `task.testCmd`; the review-round `driver:exam-run` event (`iter: 1`)
//        carries the same `cmd`; and the reviewer's prompt carries
//        `EXAM EVIDENCE` with the line `$ <task.testCmd>`.
//   M4 — a task whose `testCmd` contains none of its `proofTests` paths keeps
//        that `testCmd` as its implementer's `TEST COMMAND:` line, and a task
//        with no `testCmd` receives `TEST COMMAND: <workerTestCmd>`, both as at
//        BASE.
//   M5 — the fix round's prompt carries `TEST COMMAND: <task.testCmd>` as at
//        BASE, for the pre-review repair `fix:<id>:0` and for the review-round
//        fix `fix:<id>:1` alike.
//   M6 — the run-wide sharer count that caps `workerTestCmd` (#547) counts
//        every task whose implementer is handed the run-wide command.
//
// Proof legs, and where each is asserted below: (a) the implementer's line is
// the run-wide command [M1]; (b) the examiner's line, and the one-line
// difference between the two tails [M2]; (c) the exam's command at all four
// places the driver or a referee touches it [M3]; (d) the two rows that do not
// move [M4]; (e) the two fix prompts [M5]; (f) the sharer count [M6]; (g) the
// sentinel.
//
// Everything below the agent seam is real (git, clones, capture, the fold
// kernel, the real `sh`, the real events file); only the judgments are canned.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { capWorkerParallelism } from '../run-engine.mjs'
import { rig, makeRepo, passReview, cleanCritic, doneImpl } from './_engine_helpers.mjs'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-impl-suite-'))
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }))

// The real role files: this sim reads the prompt the engine actually builds, so
// the byte-for-byte leg is about THOSE bytes, not a temp copy's.
const REAL_ROLES = fileURLToPath(new URL('../roles/', import.meta.url))
const EXAMINER_TEXT = fs.readFileSync(path.join(REAL_ROLES, 'examiner.md'), 'utf8')
const IMPLEMENTER_TEXT = fs.readFileSync(path.join(REAL_ROLES, 'implementer.md'), 'utf8')

// The run-wide suite the rig's repo answers to, and the two per-task commands.
const RUN_WIDE = 'bash check.sh'
const RUN_WIDE_AUTO = 'bash check.sh -n auto'
const T1_CMD = 'bash t1_test.sh'
const T2_CMD = 'bash t2.sh'

// ── the tasks ───────────────────────────────────────────────────────────────
// T1: a `testCmd` that NAMES its Proof `Test:` path — the row #663 moves.
// T2: a `testCmd` set some other way (`proofTests` empty) — a row that stays.
// T3: no `testCmd` key at all — the row that already got the run-wide command.
const MACHINE = 'Machine: M1. The tree holds `one.txt` whose content is "from T1".'
const LEGS = '- Legs: (a) `one.txt` reads exactly "from T1" [M1]'
const BODY = '**Claim:** the tree gains one.txt\n' + MACHINE +
  '\n\n**Proof:**\n- Test: `t1_test.sh`\n' + LEGS
const T1 = (over = {}) => ({
  id: 'T1', title: 'create one', files: ['one.txt'], tier: 'standard', review: 'lean',
  writes: ['one.txt'], commutes: [],
  interfaces: { consumes: ['`BASE_FACTS`'], produces: ['`ONE`'] },
  testCmd: T1_CMD,
  proofTests: ['t1_test.sh'], proofRuns: [],
  body: BODY,
  ...over,
})
const T2 = (over = {}) => ({
  id: 'T2', title: 'create two', files: ['two.txt'], tier: 'standard', review: 'lean',
  writes: ['two.txt'], commutes: [],
  interfaces: { consumes: [], produces: [] },
  testCmd: T2_CMD,
  proofTests: [], proofRuns: [],
  body: '**Claim:** the tree gains two.txt',
  ...over,
})
// No `testCmd` key at all — deleted rather than set to undefined, so the entry
// is shaped exactly like a compiled task that never had one.
const T3 = (over = {}) => {
  const t = {
    id: 'T3', title: 'create three', files: ['three.txt'], tier: 'standard', review: 'lean',
    writes: ['three.txt'], commutes: [],
    interfaces: { consumes: [], produces: [] },
    proofTests: [], proofRuns: [],
    body: '**Claim:** the tree gains three.txt',
    ...over,
  }
  delete t.testCmd
  return t
}

// ── reading a prompt ────────────────────────────────────────────────────────
// Every line that BEGINS `TEST COMMAND: `. No role file has one, so what comes
// back is the engine's own — and the legs below assert there is exactly one.
const testCommandLines = (prompt) =>
  String(prompt).split('\n').filter((l) => l.startsWith('TEST COMMAND: '))
const theTestCommandLine = (prompt) => {
  const lines = testCommandLines(prompt)
  assert.equal(lines.length, 1, 'exactly one TEST COMMAND: line, saw ' + JSON.stringify(lines))
  return lines[0]
}

// ── the exam scripts the examiner stub writes into its own clone ────────────
// Red at BASE (`one.txt` absent), green once the implementer has worked.
const RED_AT_BASE = '#!/bin/bash\n[ -f one.txt ]\n'
// The same, plus a line recording that THIS command ran and where. Only
// `bash t1_test.sh` can write it: the run-wide `bash check.sh` never does.
const orderingExam = (orderFile) =>
  '#!/bin/bash\n' +
  'printf "exam-run %s\\n" "$(pwd)" >> ' + JSON.stringify(orderFile) + '\n' +
  '[ -f one.txt ]\n'

const writeExam = (cwd, script) => {
  fs.writeFileSync(path.join(cwd, 't1_test.sh'), script)
  return { status: 'DONE', summary: 'exam written' }
}
const writeOne = (cwd) => fs.writeFileSync(path.join(cwd, 'one.txt'), 'from T1\n')

const readEvents = (runDir) => {
  const file = path.join(runDir, 'events.jsonl')
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l) } catch { return null } })
    .filter(Boolean)
}

// ── the sim rig ─────────────────────────────────────────────────────────────
// The shared rig from _engine_helpers (real clones, real capture, real exec
// seam, the real role files), plus a stub that records every prompt by label.
let seq = 0
async function scenario ({ waves, testCmd = RUN_WIDE, examScript = RED_AT_BASE,
                           onImpl = writeOne, onFix = () => {}, review = () => passReview() }) {
  seq += 1
  const stamp = 'isuite' + seq
  const repo = makeRepo(path.join(tmp, 'repo-' + stamp))
  const runDir = path.join(tmp, 'run-' + stamp)
  const labels = []
  const prompts = {}
  const stub = (prompt, opts, cwd) => {
    labels.push(opts.label)
    prompts[opts.label] = prompt
    const kind = opts.label.split(':')[0]
    const id = opts.label.split(':')[1]
    if (kind === 'exam') return writeExam(cwd, examScript)
    if (kind === 'impl') {
      if (id === 'T1') onImpl(cwd)
      else fs.writeFileSync(path.join(cwd, id === 'T2' ? 'two.txt' : 'three.txt'), 'work by ' + id + '\n')
      return doneImpl(cwd)
    }
    if (kind === 'fix') { onFix(cwd, opts.label); return doneImpl(cwd) }
    if (kind === 'review') return review(opts.label)
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run, base, clonesDir, patchesDir, integ, logs } = rig({
    repo, runDir, waves, stub, testCmd, stamp, extraArgs: { shallowLeg: false },
  })
  const report = await run()
  const rowOf = (id) => report.tasks.find((t) => t.task === id)
  return { report, rowOf, labels, prompts, base, runDir, clonesDir, patchesDir, integ, logs }
}

// ── (a) the implementer's line is the run-wide command [M1] ─────────────────
// T1's `testCmd` (`bash t1_test.sh`) contains its `proofTests` path
// (`t1_test.sh`), so its implementer is handed the run-wide suite — the very
// string a task with no `testCmd` gets. Held together with (b) so both read the
// same pair of prompts.
const AB = await scenario({ waves: [[T1()]] })
{
  assert.equal(AB.rowOf('T1').status, 'done', 'the task ran to a verdict: ' + AB.rowOf('T1').notes)
  const implPrompt = AB.prompts['impl:T1']
  assert.equal(typeof implPrompt, 'string', 'the implementer was dispatched: ' + AB.labels.join(','))

  // [M1] the only TEST COMMAND: line is the run-wide one.
  assert.deepEqual(testCommandLines(implPrompt), ['TEST COMMAND: ' + RUN_WIDE],
    'the implementer of a task whose testCmd names its Proof path is handed the ' +
    'run-wide suite, and that line is the only one')
  // [M1] and the exam's command appears on no line of that prompt.
  assert.ok(!implPrompt.split('\n').some((l) => l === 'TEST COMMAND: ' + T1_CMD),
    'no line of the implementer\'s prompt is TEST COMMAND: ' + T1_CMD)
}

// ── (b) the examiner's line, and the one-line difference [M2] ───────────────
{
  const examPrompt = AB.prompts['exam:T1']
  const implPrompt = AB.prompts['impl:T1']
  assert.equal(typeof examPrompt, 'string', 'the examiner was dispatched: ' + AB.labels.join(','))

  // [M2] the examiner keeps the task's own command, as at BASE.
  assert.deepEqual(testCommandLines(examPrompt), ['TEST COMMAND: ' + T1_CMD],
    'the exam\'s command stays the examiner\'s')

  // [M2] the prompt opens with examiner.md verbatim.
  assert.ok(examPrompt.startsWith(EXAMINER_TEXT), 'the exam prompt opens with examiner.md verbatim')
  assert.ok(implPrompt.startsWith(IMPLEMENTER_TEXT), 'the impl prompt opens with implementer.md verbatim')

  // [M2] the two tails differ in that one line and nothing else.
  const examTail = examPrompt.slice(EXAMINER_TEXT.length)
  const implTail = implPrompt.slice(IMPLEMENTER_TEXT.length)
  const lines = examTail.split('\n')
  const idx = lines.findIndex((l) => l.startsWith('TEST COMMAND: '))
  assert.notEqual(idx, -1, 'the examiner\'s tail carries a TEST COMMAND: line')
  assert.equal(lines[idx], 'TEST COMMAND: ' + T1_CMD)
  lines[idx] = 'TEST COMMAND: ' + RUN_WIDE
  assert.equal(lines.join('\n'), implTail,
    'the examiner\'s inputs are the implementer\'s byte for byte except the TEST COMMAND line')
  assert.equal(examTail.startsWith('\nBASE: ' + AB.base), true, 'both tails open at the BASE block')
}

// ── (c) the exam's command at all four places [M3] ──────────────────────────
// The exam script appends `exam-run <pwd>` to a file outside every clone, so
// only an execution of `bash t1_test.sh` can write a line there — the run-wide
// `bash check.sh` cannot. It exits 0 only when `one.txt` exists, so it is red
// in the examiner's clone at BASE and green on the implementer's tree.
{
  const orderFile = path.join(tmp, 'exam-order.txt')
  fs.writeFileSync(orderFile, '')
  const { rowOf, prompts, runDir, clonesDir } = await scenario({
    waves: [[T1()]], examScript: orderingExam(orderFile),
  })
  assert.equal(rowOf('T1').status, 'done', 'the task merged: ' + rowOf('T1').notes)
  assert.equal(rowOf('T1').exam, 'red', 'the exam was red at BASE')

  // [M3] place one: the examiner's red-at-BASE run, in the examiner's clone.
  const examDir = fs.realpathSync(path.join(clonesDir, 'exam-T1'))
  const order = fs.readFileSync(orderFile, 'utf8').split('\n').filter(Boolean)
  assert.ok(order.some((l) => l === 'exam-run ' + examDir),
    'the examiner\'s red-at-BASE run executed the task\'s own testCmd in ' + examDir +
    ' — saw ' + JSON.stringify(order))

  // [M3] places two and three: the two driver:exam-run events.
  const examRuns = readEvents(runDir).filter((e) => e.kind === 'driver:exam-run' && e.task === 'T1')
  const pre = examRuns.filter((e) => e.iter === 0)
  const round1 = examRuns.filter((e) => e.iter === 1)
  assert.equal(pre.length, 1, 'one pre-review driver:exam-run: ' + JSON.stringify(examRuns))
  assert.equal(pre[0].cmd, T1_CMD, 'the pre-review pass ran the task\'s own testCmd')
  assert.equal(round1.length, 1, 'one review-round driver:exam-run: ' + JSON.stringify(examRuns))
  assert.equal(round1[0].cmd, T1_CMD, 'the review round ran the same command')

  // [M3] place four: the reviewer's EXAM EVIDENCE block.
  const reviewPrompt = prompts['review:T1:1']
  assert.equal(typeof reviewPrompt, 'string', 'a referee read the patch')
  const at = reviewPrompt.indexOf('EXAM EVIDENCE')
  assert.notEqual(at, -1, 'the reviewer\'s prompt carries EXAM EVIDENCE')
  const after = reviewPrompt.slice(at).split('\n')
  assert.ok(after.some((l) => l === '$ ' + T1_CMD),
    'and the line `$ ' + T1_CMD + '` follows it')
  assert.ok(!reviewPrompt.split('\n').some((l) => l === '$ ' + RUN_WIDE),
    'and no line of the reviewer\'s prompt is `$ ' + RUN_WIDE + '`')
}

// ── (d) the two rows that do not move [M4] ──────────────────────────────────
// T2's `testCmd` names none of its Proof paths (`proofTests` is empty), so it
// keeps its own command; T3 has no `testCmd` and keeps the run-wide one.
{
  const { rowOf, prompts } = await scenario({ waves: [[T2(), T3()]] })
  assert.equal(rowOf('T2').status, 'done', 'T2 ran to a verdict: ' + rowOf('T2').notes)
  assert.equal(rowOf('T3').status, 'done', 'T3 ran to a verdict: ' + rowOf('T3').notes)
  assert.equal(theTestCommandLine(prompts['impl:T2']), 'TEST COMMAND: ' + T2_CMD,
    'a testCmd that names none of the task\'s Proof paths stays the implementer\'s')
  assert.equal(theTestCommandLine(prompts['impl:T3']), 'TEST COMMAND: ' + RUN_WIDE,
    'a task with no testCmd receives the run-wide command, as at BASE')
}

// ── (e) the two fix prompts [M5] ────────────────────────────────────────────
// The implementer leaves `one.txt` absent, so the handed-in exam is red at the
// pre-review pass and buys one `fix:T1:0`; that fix writes the file, and the
// first review round returns one blocking issue, which buys `fix:T1:1`. Both
// prompts keep the exam's command: by then the Proof path is in the tree.
{
  const { rowOf, labels, prompts } = await scenario({
    waves: [[T1()]],
    onImpl: () => {},
    onFix: (cwd) => writeOne(cwd),
    review: (label) => (label === 'review:T1:1'
      ? { verdict: 'FIX_REQUIRED',
          issues: [{ severity: 'blocking', actor: 'implementer',
                     detail: 'the summary line does not say what the change does' }] }
      : passReview()),
  })
  assert.deepEqual(labels.filter((l) => l.startsWith('fix:')), ['fix:T1:0', 'fix:T1:1'],
    'the red pre-review pass and the blocking review each bought one round: ' + labels.join(','))
  assert.equal(theTestCommandLine(prompts['fix:T1:0']), 'TEST COMMAND: ' + T1_CMD,
    'the pre-review repair keeps the exam\'s command, as at BASE')
  assert.equal(theTestCommandLine(prompts['fix:T1:1']), 'TEST COMMAND: ' + T1_CMD,
    'and so does the review-round fix')
  assert.equal(rowOf('T1').proofFixes, 1)
}

// ── (f) the sharer count [M6] ───────────────────────────────────────────────
// `capWorkerParallelism` only touches a command carrying `-n auto`, so the
// run-wide command here is `bash check.sh -n auto` — a shape the rig's
// check.sh ignores. The arithmetic distinguishes a one-sharer share from a
// two-sharer one only on a host with at least two cpus.
{
  const CPUS = os.cpus().length
  assert.ok(CPUS >= 2, 'this leg assumes a host with at least 2 cpus (saw ' + CPUS + ')')
  const sharedTwo = capWorkerParallelism(RUN_WIDE_AUTO, 2, CPUS)
  const sharedOne = capWorkerParallelism(RUN_WIDE_AUTO, 1, CPUS)
  assert.notEqual(sharedOne, sharedTwo,
    'the one-sharer and two-sharer shares differ at ' + CPUS + ' cpus — the leg is observable')

  // T1 (testCmd names its Proof path) beside T3 (no testCmd): two sharers.
  {
    const { rowOf, prompts } = await scenario({
      waves: [[T1(), T3()]], testCmd: RUN_WIDE_AUTO,
    })
    assert.equal(rowOf('T1').status, 'done', 'T1 ran to a verdict: ' + rowOf('T1').notes)
    assert.equal(rowOf('T3').status, 'done', 'T3 ran to a verdict: ' + rowOf('T3').notes)
    assert.equal(theTestCommandLine(prompts['impl:T1']), 'TEST COMMAND: ' + sharedTwo,
      'an implementer handed the run-wide command is counted as a sharer')
    assert.equal(theTestCommandLine(prompts['impl:T3']), 'TEST COMMAND: ' + sharedTwo,
      'and the task with no testCmd gets the same capped string')
  }

  // T1 beside T2 (its own non-Proof testCmd): one sharer.
  {
    const { rowOf, prompts } = await scenario({
      waves: [[T1(), T2()]], testCmd: RUN_WIDE_AUTO,
    })
    assert.equal(rowOf('T1').status, 'done', 'T1 ran to a verdict: ' + rowOf('T1').notes)
    assert.equal(rowOf('T2').status, 'done', 'T2 ran to a verdict: ' + rowOf('T2').notes)
    assert.equal(theTestCommandLine(prompts['impl:T1']), 'TEST COMMAND: ' + sharedOne,
      'the sole sharer gets the whole machine')
    assert.equal(theTestCommandLine(prompts['impl:T2']), 'TEST COMMAND: ' + T2_CMD,
      'a task with its own non-Proof testCmd is still not a sharer')
  }
}

// ── (g) the sentinel ────────────────────────────────────────────────────────
console.log('ALL TESTS PASSED')
