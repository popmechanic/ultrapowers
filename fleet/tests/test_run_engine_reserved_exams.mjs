// fleet/tests/test_run_engine_reserved_exams.mjs — the exam lands under the
// reserved directory (#777).
//
// An operator opening a run's integration branch finds each task's peer-written
// exam under `tests/exams/<run>/` (or `fleet/tests/exams/<run>/` for a
// `fleet/tests/` path) and NOT at the path the Proof named — except an exam the
// task's Proof marked `Guard:`, which sits at the path the Proof names.
//
// Everything below the agent seam is real, as in the sibling exam sims: real
// git repos, real clones, the real capture, the real `sh`, the real fold. Only
// the judgments are canned. The examiner stub here is deliberately NOT told
// where to write: it READS the `EXAM PATHS:` line out of the prompt the driver
// built and writes where that line says — which is what the model does, and a
// stub that wrote the Proof path would prove nothing.
//
// Machine clauses under test, restated:
//   M1 — for a task with a non-empty `proofTests` and a `testCmd`, the driver
//        computes each Proof path's landing path with `reservedExamPath(p,
//        runId)` from `fleet/exam-paths.mjs`: `tests/<rest>` lands at
//        `tests/exams/<slug>/<rest>`, `fleet/tests/<rest>` lands at
//        `fleet/tests/exams/<slug>/<rest>`, where `<slug>` is `runId` with every
//        character outside `[A-Za-z0-9_]` replaced by `_` (`run-7` is `run_7`);
//        a path under neither prefix lands at itself; a path listed in the
//        task's `proofGuards` lands at itself.
//   M2 — the examiner's prompt carries, directly after its `TEST COMMAND:`
//        line, one `EXAM PATHS: <proof path> -> <landing path>` line per Proof
//        path whose landing path differs, and its `TEST COMMAND:` line is the
//        task's `testCmd` with each such Proof path replaced by its landing
//        path; a task with no differing path gets no `EXAM PATHS:` line and the
//        prompt it gets at BASE, byte for byte.
//   M3 — at the handoff the driver copies the examiner's bytes to the landing
//        path in the graded clone, restores the Proof path there to its BASE
//        state (deleted when absent at BASE) whenever the landing path differs,
//        records `examBlobs` and judges `examEdited` at the landing paths, runs
//        the exam as the remapped command, appends `driver:exam-handoff` with
//        `paths` naming the landing paths, and the integration branch after the
//        wave holds the exam bytes at the landing path and nothing at the Proof
//        path.
//   M4 — a landing path ending `.py` under `tests/exams/<slug>/` gets an empty
//        `__init__.py` in `tests/exams/<slug>/` and in every directory between
//        it and the file, on the graded clone and so on the branch.
//   M5 — `fleet/exam-paths.mjs` exports `examSlug(runId)`, `reservedExamPath(p,
//        runId)` and `reservedExamDirs(runId)`; `reservedExamDirs('run-7')` is
//        exactly `['tests/exams/run_7', 'fleet/tests/exams/run_7']`.
//   M6 — `fleet/roles/examiner.md` names the `EXAM PATHS:` line. Proven by the
//        Proof's scoped `Run:` commands (legs (h) and (i)), not here: no test
//        pins a sentence of a document.
//
// Proof legs, and where each is asserted below: (a) the three exported
// functions, on the task's own examples [M1][M5]; (b) the remapped
// `TEST COMMAND:` line and the one `EXAM PATHS:` line after it, and none for
// the implementer [M2]; (c) a `Guard:`-marked Proof path: no remap, no
// `tests/exams/` on the branch [M1][M2]; (d) a Proof path under neither prefix:
// the byte-for-byte prompt at BASE, no `EXAM PATHS:` line [M2]; (e) the
// handoff — the peer's bytes at the landing path, nothing at the Proof path,
// `examEdited: []`, the event's `paths`, the remapped exam command [M3]; (f)
// the `__init__.py` package shape under `tests/exams/<slug>/`, and none under
// `fleet/tests/exams/` [M4]; (g) the sentinel [M3].
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { examSlug, reservedExamPath, reservedExamDirs } from '../exam-paths.mjs'
import { ENV, rig, makeRepo, passReview, cleanCritic, doneImpl } from './_engine_helpers.mjs'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-reserved-exams-'))
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }))

// The real role files: the byte-for-byte leg (d) is about THOSE bytes, so they
// are read from `fleet/roles/` rather than from a temp copy.
const REAL_ROLES = fileURLToPath(new URL('../roles/', import.meta.url))
const EXAMINER_TEXT = fs.readFileSync(path.join(REAL_ROLES, 'examiner.md'), 'utf8')
const IMPLEMENTER_TEXT = fs.readFileSync(path.join(REAL_ROLES, 'implementer.md'), 'utf8')

// ── reading what the run left behind ────────────────────────────────────────
// An absent events file reads as no records, so an engine that writes none
// fails an assertion rather than throwing ENOENT.
const readEvents = (runDir) => {
  const file = path.join(runDir, 'events.jsonl')
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l) } catch { return null } })
    .filter(Boolean)
}
// Exact bytes off a ref, undecorated by any `.trim()`: the legs are byte
// equalities, trailing newline included. A path absent from the ref is an
// answer here, not a crash.
const showBytes = (cwd, ref, file) => {
  try {
    return execFileSync('git', ['show', ref + ':' + file],
      { cwd, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (e) {
    return 'ABSENT: ' + String((e && e.message) || e)
  }
}
const isAbsent = (s) => typeof s === 'string' && s.startsWith('ABSENT: ')
// Every path the branch's tree holds.
const treePaths = (cwd, ref) => {
  try {
    return execFileSync('git', ['ls-tree', '-r', '--name-only', ref],
      { cwd, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
      .split('\n').filter(Boolean)
  } catch (e) {
    return ['ABSENT: ' + String((e && e.message) || e)]
  }
}

// ── the examiner stub: it writes where the prompt tells it to ───────────────
// One `EXAM PATHS: <proof path> -> <landing path>` line per remapped path. A
// Proof path with no line is written at the Proof path itself.
const examPathsFrom = (prompt) => {
  const map = new Map()
  for (const line of String(prompt).split('\n')) {
    const m = /^EXAM PATHS: (\S+) -> (\S+)$/.exec(line)
    if (m) map.set(m[1], m[2])
  }
  return map
}
const writeExamWhereTold = (cwd, prompt, files) => {
  const told = examPathsFrom(prompt)
  for (const [proofPath, text] of Object.entries(files)) {
    const dest = path.resolve(cwd, told.get(proofPath) || proofPath)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, text)
  }
  return { status: 'DONE', summary: 'exam written' }
}

// ── the tasks the sims run ──────────────────────────────────────────────────
const MACHINE = 'Machine: M1. The tree holds `one.txt` whose content is "from T1".'
const LEGS = '- Legs: (a) `one.txt` reads exactly "from T1" [M1]'
const bodyFor = (testPath) => '**Claim:** the tree gains one.txt\n' + MACHINE +
  '\n\n**Proof:**\n- Test: `' + testPath + '`\n' + LEGS
const entry = (over = {}) => {
  const task = {
    id: 'T1', title: 'create one', files: ['one.txt'], tier: 'standard', review: 'lean',
    writes: ['one.txt'], commutes: [],
    interfaces: { consumes: ['`BASE_FACTS`'], produces: ['`ONE`'] },
    testCmd: 'bash tests/test_t1.sh',
    proofTests: ['tests/test_t1.sh'], proofRuns: [],
    body: bodyFor('tests/test_t1.sh'),
    ...over,
  }
  // `proofGuards: undefined` in the override means "an entry without the key".
  for (const k of Object.keys(task)) if (task[k] === undefined) delete task[k]
  return task
}

// The exam the peer writes: red at BASE until the implementer writes one.txt.
const RED_AT_BASE = '#!/bin/bash\n[ -f one.txt ]\n'
// What the graded party writes at the Proof path when it writes there itself —
// distinguishable from the peer's byte for byte.
const IMPL_OWN = '#!/bin/bash\nexit 0 # written by the graded party, not the peer\n'
const writeOne = (cwd) => fs.writeFileSync(path.join(cwd, 'one.txt'), 'from T1\n')

let seq = 0
async function scenario({ stamp, task, examFiles, onImpl = writeOne, testCmd = 'bash check.sh' }) {
  seq += 1
  const repo = makeRepo(path.join(tmp, 'repo-' + seq))
  const runDir = path.join(tmp, 'run-' + seq)
  const labels = []
  const prompts = {}
  const stub = async (prompt, opts, cwd) => {
    labels.push(opts.label)
    prompts[opts.label] = prompt
    const kind = opts.label.split(':')[0]
    if (kind === 'exam') return writeExamWhereTold(cwd, prompt, examFiles)
    if (kind === 'impl') { onImpl(cwd); return doneImpl(cwd) }
    if (kind === 'fix') return doneImpl(cwd)
    if (kind === 'review') return passReview()
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run, base, clonesDir, patchesDir, integ } = rig({
    repo, runDir, waves: [[task]], stub, stamp, testCmd,
  })
  const report = await run()
  return { report, row: report.tasks[0], labels, prompts, base, runDir, clonesDir,
           patchesDir, integ, branch: 'ultra/integration-' + stamp,
           events: readEvents(runDir) }
}

// Every line of a prompt tail that opens with a marker.
const linesStarting = (text, marker) =>
  String(text).split('\n').filter((l) => l.startsWith(marker))

// ══ (a) the three exported functions [M1] [M5] ══════════════════════════════
{
  // [M5] the module exports the three names the task Produces.
  assert.equal(typeof reservedExamPath, 'function',
    '[a][M5] fleet/exam-paths.mjs exports reservedExamPath')
  assert.equal(typeof examSlug, 'function',
    '[a][M5] fleet/exam-paths.mjs exports examSlug')
  assert.equal(typeof reservedExamDirs, 'function',
    '[a][M5] fleet/exam-paths.mjs exports reservedExamDirs')

  // [M1] `tests/<rest>` lands under the run's reserved directory.
  assert.equal(reservedExamPath('tests/test_x.py', 'run-7'), 'tests/exams/run_7/test_x.py',
    '[a][M1] tests/test_x.py lands at tests/exams/run_7/test_x.py')
  // [M1] `fleet/tests/<rest>` lands under the fleet suite's reserved directory.
  assert.equal(reservedExamPath('fleet/tests/test_y.mjs', 'run-7'),
    'fleet/tests/exams/run_7/test_y.mjs',
    '[a][M1] fleet/tests/test_y.mjs lands at fleet/tests/exams/run_7/test_y.mjs')
  // [M1] a path under neither prefix lands at itself — the sixteen sims at BASE
  // name such paths, and none of them may move.
  assert.equal(reservedExamPath('t1_test.sh', 'run-7'), 't1_test.sh',
    '[a][M1] a path under neither prefix lands at itself')
  // [M1] the slug rule: every character outside [A-Za-z0-9_] becomes `_`.
  assert.equal(examSlug('run-7'), 'run_7', '[a][M1] examSlug("run-7") is run_7')
  // [M5] the two reserved directories, in that order.
  assert.deepEqual(reservedExamDirs('run-7'), ['tests/exams/run_7', 'fleet/tests/exams/run_7'],
    '[a][M5] reservedExamDirs("run-7") is exactly the two reserved directories')
}

// ══ (b) the remapped TEST COMMAND and the one EXAM PATHS line [M2] ══════════
// A task with `proofTests: ['tests/test_t1.sh']`, `testCmd: 'bash
// tests/test_t1.sh'` and no `proofGuards`, under `stamp: 'sim1'`.
{
  const { row, prompts } = await scenario({
    stamp: 'sim1',
    task: entry({ proofGuards: undefined }),
    examFiles: { 'tests/test_t1.sh': RED_AT_BASE },
  })
  assert.equal(row.status, 'done', '[b] the task still merges: ' + row.notes)

  const examTail = String(prompts['exam:T1']).slice(EXAMINER_TEXT.length)
  const implTail = String(prompts['impl:T1']).slice(IMPLEMENTER_TEXT.length)

  // [M2] the examiner's TEST COMMAND is the task's own, with the Proof path
  // replaced by its landing path.
  assert.deepEqual(linesStarting(examTail, 'TEST COMMAND: '),
    ['TEST COMMAND: bash tests/exams/sim1/test_t1.sh'],
    '[b][M2] the examiner is handed the remapped command, once')

  // [M2] exactly one EXAM PATHS line, and it names the mapping.
  assert.deepEqual(linesStarting(examTail, 'EXAM PATHS'),
    ['EXAM PATHS: tests/test_t1.sh -> tests/exams/sim1/test_t1.sh'],
    '[b][M2] exactly one EXAM PATHS line, naming the one remapped path')

  // [M2] and it sits directly after the TEST COMMAND line.
  const lines = examTail.split('\n')
  const iCmd = lines.findIndex((l) => l.startsWith('TEST COMMAND: '))
  assert.ok(iCmd !== -1, '[b][M2] the examiner prompt carries a TEST COMMAND line')
  assert.equal(lines[iCmd + 1], 'EXAM PATHS: tests/test_t1.sh -> tests/exams/sim1/test_t1.sh',
    '[b][M2] the EXAM PATHS line is directly after the TEST COMMAND line, not elsewhere: ' +
    lines.slice(iCmd, iCmd + 3).join(' / '))

  // [M2] the implementer's prompt never carries it.
  assert.deepEqual(linesStarting(implTail, 'EXAM PATHS'), [],
    '[b][M2] the implementer\'s prompt has no EXAM PATHS line')
}

// ══ (c) a Guard:-marked Proof path lands at itself [M1] [M2] ════════════════
// The same task, with `proofGuards: ['tests/test_t1.sh']`.
{
  const { row, prompts, integ, branch } = await scenario({
    stamp: 'sim1',
    task: entry({ proofGuards: ['tests/test_t1.sh'] }),
    examFiles: { 'tests/test_t1.sh': RED_AT_BASE },
  })
  assert.equal(row.status, 'done', '[c] the guarded task merges: ' + row.notes)

  const examTail = String(prompts['exam:T1']).slice(EXAMINER_TEXT.length)
  // [M1] [M2] a guarded path is not remapped, so there is nothing to announce.
  assert.deepEqual(linesStarting(examTail, 'EXAM PATHS'), [],
    '[c][M1][M2] a proofGuards path lands at itself — no EXAM PATHS line')
  assert.deepEqual(linesStarting(examTail, 'TEST COMMAND: '),
    ['TEST COMMAND: bash tests/test_t1.sh'],
    '[c][M2] and the TEST COMMAND line is the task\'s own, unrewritten')

  // [M1] the branch holds the peer's bytes where the Proof named them.
  assert.equal(showBytes(integ, branch, 'tests/test_t1.sh'), RED_AT_BASE,
    '[c][M1] the guarded exam sits at the path the Proof names, byte for byte')
  assert.deepEqual(treePaths(integ, branch).filter((p) => p.startsWith('tests/exams/')), [],
    '[c][M1] and the branch holds no tests/exams/ directory at all')
}

// ══ (d) a Proof path under neither prefix: the prompt at BASE [M2] ══════════
// The shape the sixteen existing sims are in: `proofTests: ['t1_test.sh']`.
{
  const task = entry({
    testCmd: 'bash t1_test.sh',
    proofTests: ['t1_test.sh'],
    body: bodyFor('t1_test.sh'),
    proofGuards: undefined,
  })
  const { row, prompts } = await scenario({
    stamp: 'sim1', task, examFiles: { 't1_test.sh': RED_AT_BASE },
  })
  assert.equal(row.status, 'done', '[d] the task merges: ' + row.notes)

  const examPrompt = String(prompts['exam:T1'])
  const implPrompt = String(prompts['impl:T1'])
  assert.ok(examPrompt.startsWith(EXAMINER_TEXT), '[d] the exam prompt opens with examiner.md')
  assert.ok(implPrompt.startsWith(IMPLEMENTER_TEXT), '[d] the impl prompt opens with implementer.md')
  const examTail = examPrompt.slice(EXAMINER_TEXT.length)
  const implTail = implPrompt.slice(IMPLEMENTER_TEXT.length)

  // [M2] no differing path, so the prompt is the one it gets at BASE, byte for
  // byte: the two tails still differ in the TEST COMMAND line and nothing else.
  assert.equal(examTail.replace('\nTEST COMMAND: bash t1_test.sh', '\nTEST COMMAND: bash check.sh'),
    implTail,
    '[d][M2] the examiner gets the implementer\'s inputs byte for byte but the TEST COMMAND line')
  assert.deepEqual(linesStarting(examTail, 'EXAM PATHS'), [],
    '[d][M2] and carries no EXAM PATHS line')
  assert.deepEqual(linesStarting(examTail, 'TEST COMMAND: '), ['TEST COMMAND: bash t1_test.sh'],
    '[d][M2] the unremapped command stays the examiner\'s')
}

// ══ (e) the handoff: the landing path is what the branch holds [M3] ═════════
// The implementer also writes its own file at the Proof path — an exam that
// grades nothing. The peer's bytes land under the reserved directory, the
// Proof path is restored to its BASE state (absent), and nothing about the
// implementer's own file is an edit of an exam it was never handed.
{
  const { row, events, integ, branch, clonesDir } = await scenario({
    stamp: 'sim1',
    task: entry({ proofGuards: undefined }),
    examFiles: { 'tests/test_t1.sh': RED_AT_BASE },
    onImpl: (cwd) => {
      writeOne(cwd)
      fs.mkdirSync(path.join(cwd, 'tests'), { recursive: true })
      fs.writeFileSync(path.join(cwd, 'tests', 'test_t1.sh'), IMPL_OWN)
    },
  })
  assert.equal(row.status, 'done', '[e] the task merged: ' + row.notes)

  // [M3] the peer's bytes at the landing path.
  assert.equal(showBytes(integ, branch, 'tests/exams/sim1/test_t1.sh'), RED_AT_BASE,
    '[e][M3] the branch carries the peer\'s exam at the landing path, byte for byte')
  // [M3] and nothing at the Proof path: the implementer's own file there was
  // restored to its BASE state, which at BASE is absent.
  assert.ok(isAbsent(showBytes(integ, branch, 'tests/test_t1.sh')),
    '[e][M3] and nothing at the Proof path — the implementer\'s own file there is gone, ' +
    'not folded: ' + showBytes(integ, branch, 'tests/test_t1.sh'))
  assert.ok(!fs.existsSync(path.join(clonesDir, 'task-T1', 'tests', 'test_t1.sh')),
    '[e][M3] the graded clone holds nothing at the Proof path either')

  // [M3] `examEdited` is judged at the landing path, so the implementer's own
  // file at the Proof path is not an edit.
  assert.deepEqual(row.examEdited, [],
    '[e][M3] examEdited is judged at the landing paths: nothing was edited')

  // [M3] the handoff event names the landing paths.
  const handoffs = events.filter((e) => e.kind === 'driver:exam-handoff' && e.task === 'T1')
  assert.equal(handoffs.length, 1,
    '[e][M3] exactly one driver:exam-handoff event for T1: ' + JSON.stringify(handoffs))
  assert.deepEqual(handoffs[0].paths, ['tests/exams/sim1/test_t1.sh'],
    '[e][M3] carrying the landing paths, not the Proof paths: ' + JSON.stringify(handoffs[0]))

  // [M3] and the exam is run as the remapped command, every time it is run.
  const examRuns = events.filter((e) => e.kind === 'driver:exam-run' && e.task === 'T1')
  assert.ok(examRuns.length >= 1,
    '[e][M3] the driver ran the exam on the handed-in tree: ' + JSON.stringify(examRuns))
  assert.deepEqual([...new Set(examRuns.map((e) => e.cmd))],
    ['bash tests/exams/sim1/test_t1.sh'],
    '[e][M3] every driver:exam-run names the remapped command: ' + JSON.stringify(examRuns))
}

// ══ (f) the __init__.py package shape [M4] ══════════════════════════════════
// A `.py` landing path under `tests/exams/<slug>/` gets an empty `__init__.py`
// in the slug directory and in every directory between it and the file. The
// task's own `testCmd` does not name the Proof path here.
{
  const task = entry({
    files: ['one.txt'], writes: ['one.txt'],
    testCmd: 'bash check.sh',
    proofTests: ['tests/sub/test_t2.py'],
    body: bodyFor('tests/sub/test_t2.py'),
    proofGuards: undefined,
  })
  const { row, integ, branch } = await scenario({
    stamp: 'sim1', task,
    examFiles: { 'tests/sub/test_t2.py': 'def test_t2():\n    assert True\n' },
  })
  assert.equal(row.status, 'done', '[f] the task merged: ' + row.notes)

  // [M4] the exam itself, at the landing path.
  assert.equal(showBytes(integ, branch, 'tests/exams/sim1/sub/test_t2.py'),
    'def test_t2():\n    assert True\n',
    '[f][M4] the branch holds the exam at tests/exams/sim1/sub/test_t2.py')
  // [M4] and an EMPTY __init__.py in the slug directory and in every directory
  // between it and the file.
  assert.equal(showBytes(integ, branch, 'tests/exams/sim1/__init__.py'), '',
    '[f][M4] tests/exams/sim1/__init__.py is on the branch and is empty')
  assert.equal(showBytes(integ, branch, 'tests/exams/sim1/sub/__init__.py'), '',
    '[f][M4] tests/exams/sim1/sub/__init__.py is on the branch and is empty')
}
// ...and a `fleet/tests/` landing path is not a pytest package: no `__init__.py`.
{
  const task = entry({
    files: ['one.txt'], writes: ['one.txt'],
    testCmd: 'bash check.sh',
    proofTests: ['fleet/tests/test_t3.mjs'],
    body: bodyFor('fleet/tests/test_t3.mjs'),
    proofGuards: undefined,
  })
  const { row, integ, branch } = await scenario({
    stamp: 'sim1', task,
    examFiles: { 'fleet/tests/test_t3.mjs': "console.log('ALL TESTS PASSED')\n" },
  })
  assert.equal(row.status, 'done', '[f] the fleet-path task merged: ' + row.notes)
  assert.equal(showBytes(integ, branch, 'fleet/tests/exams/sim1/test_t3.mjs'),
    "console.log('ALL TESTS PASSED')\n",
    '[f][M4] the branch holds the exam at fleet/tests/exams/sim1/test_t3.mjs')
  assert.deepEqual(
    treePaths(integ, branch).filter((p) => p.startsWith('fleet/tests/exams/') &&
      p.endsWith('__init__.py')), [],
    '[f][M4] and leaves no __init__.py under fleet/tests/exams/')
}

// ══ (g) the sentinel [M3] ═══════════════════════════════════════════════════
console.log('ALL TESTS PASSED')
