// fleet/tests/test_run_engine_review_economy.mjs — what a reviewer-minute
// bought, and the channel that bought nothing.
//
// Two halves of one accounting question. The `cannotVerify` channel asked a
// reviewer to list what it could not judge and then paid a second agent to
// judge the list; #604 and this plan's driver-run evidence answer those
// questions with bytes, so the channel is removed rather than left to
// manufacture work. In its place the run reports the ratio it never had:
// wall-clock reviewer milliseconds against the blocking findings those minutes
// actually returned.
//
// #964 Task 2 retired the pair and the critic, and this sim lost the legs that
// were about them: the `pairRounds`/`r2MarginalBlocking` keys and both pair
// blocks (a concurrent pair contributing both durations; what the second
// reviewer found that the first did not — the premium those two keys measured),
// and the CANNOT-VERIFY assertions against the critic's prompt. Every other leg
// is unchanged, and what the pair legs also covered — de-duplicated blocking
// counting and the per-reviewer-MINUTE ratio — is kept below over one reviewer.
//
// Machine clauses under test (legs (f), (g) and (h) of the Proof):
//   M6 — the `cannotVerify` channel is gone: no schema property, no
//        accumulator, no no-wave-merged judgment calls, and the string does not
//        occur in `fleet/run-engine.mjs` at all. (The checklist half of this
//        clause read the critic's prompt — #964 Task 2.)
//   M7 — `reviewEconomy: { reviewerMs, blockingFindings,
//        blockingPerReviewerMinute }`;
//        `reviewerMs` sums every `review:` agent call measured INDIVIDUALLY,
//        `blockingFindings` counts
//        de-duplicated reviewer-returned blocking issues only (driver-minted
//        Run:/Check: reds excluded), the ratio is per reviewer-minute and 0
//        when no reviewer ran.
//   M8 — a run with no `proofRuns`, no `constraintChecks` and clean reviews
//        leaves every captured prompt of every role byte-identical to the same
//        run on BASE's engine, `integratedChecks` [], `proofFixes: 0` on every
//        row, and `reviewEconomy` present.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execSeam } from '../run-main.mjs'
import { makeCwdFor, withPatchCapture, defaultTaskIdOf } from '../run-waves.mjs'
import { runEngine, REVIEWER_SCHEMA } from '../run-engine.mjs'
import { ENV, rig, makeRepo, provision, passReview, cleanCritic, doneImpl } from './_engine_helpers.mjs'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-review-economy-'))
// rmSync unlinks the base tree's `skills` symlink rather than following it.
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }))
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const FLEET_DIR = fileURLToPath(new URL('..', import.meta.url))
const ROLES_DIR = fileURLToPath(new URL('../roles/', import.meta.url))
const ENGINE_SRC = fileURLToPath(new URL('../run-engine.mjs', import.meta.url))
const BASE_SHA = '2cc873fb2d040fbe081f35ff0ababc408eaa6500'

// Sorted.
const ECONOMY_KEYS = ['blockingFindings', 'blockingPerReviewerMinute', 'reviewerMs']
const mkTask = (id, files, over = {}) => ({
  id, title: id.toLowerCase(), files, tier: 'standard', review: 'lean',
  writes: files, commutes: [], proofTests: [], proofRuns: [],
  body: 'task ' + id + ' body', ...over,
})
const fileOf = (id) => (id === 'A' ? 'a.txt' : id === 'B' ? 'b.txt' : 'a.txt')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const eventsOf = (runDir) => {
  const file = path.join(runDir, 'events.jsonl')
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
}

// ── the channel is gone [M6] ─────────────────────────────────────────────────
{
  assert.ok(!Object.prototype.hasOwnProperty.call(
    REVIEWER_SCHEMA.properties.issues.items.properties, 'cannotVerify'),
    'the reviewer issue object must carry no `cannotVerify` property: ' +
    JSON.stringify(Object.keys(REVIEWER_SCHEMA.properties.issues.items.properties)))
  assert.ok(!Object.prototype.hasOwnProperty.call(REVIEWER_SCHEMA.properties, 'cannotVerify'),
    'and neither must the reply object: ' + JSON.stringify(Object.keys(REVIEWER_SCHEMA.properties)))
  // The Proof's first Run: reads the file; so does this, so the sim says the
  // same thing the command says.
  assert.ok(!fs.readFileSync(ENGINE_SRC, 'utf8').includes('cannotVerify'),
    'the string `cannotVerify` still occurs in fleet/run-engine.mjs — the schema property, ' +
    'the accumulator, the checklist and the no-wave-merged judgment calls all go')
}

// ── a reviewer that files one anyway is simply not read [M6] + [M7] ──────────
{
  const repo = makeRepo(path.join(tmp, 'repo-cv'))
  const runDir = path.join(tmp, 'run-cv')
  const prompts = {}
  const stub = (prompt, opts, cwd) => {
    prompts[opts.label] = prompt
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') {
      fs.writeFileSync(path.join(cwd, 'a.txt'), 'from-A\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') {
      return { verdict: 'PASS', issues: [],
               cannotVerify: [{ requirement: 'x', why: 'y' }] }
    }
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run } = rig({ repo, runDir, waves: [[mkTask('A', ['a.txt'])]], stub, stamp: 're1' })
  const report = await run()
  assert.equal(report.coverage.complete, true,
    'an unread extra field must not fail the task: ' + JSON.stringify(report.tasks))
  // The two prompt halves of this leg read the completeness critic's prompt for
  // the CANNOT-VERIFY checklist and the escalated-item line; no such agent is
  // dispatched since #964 Task 2, so they go and the judgment-call half stays.
  assert.ok(!report.judgmentCalls.some((j) => String(j).includes('cannot-verify')),
    'and no cannot-verify judgment call survives: ' + JSON.stringify(report.judgmentCalls))

  // [M7] an instantly-returning reviewer still produces a finite measurement.
  const eco = report.reviewEconomy
  assert.equal(typeof eco, 'object', 'the report carries no `reviewEconomy` object')
  assert.deepEqual(Object.keys(eco).sort(), ECONOMY_KEYS,
    'reviewEconomy carries exactly those three fields: ' + JSON.stringify(Object.keys(eco)))
  assert.equal(Number.isFinite(eco.reviewerMs), true,
    'reviewerMs is a finite number: ' + JSON.stringify(eco.reviewerMs))
  assert.ok(eco.reviewerMs >= 0, 'and never negative: ' + eco.reviewerMs)
}

// ── de-duplicated blocking findings, per reviewer-MINUTE [M7] ────────────────
// #964 Task 2 retired the pair, and the two blocks that stood here went with
// what they measured. The first paid a concurrent pair 30 ms and 200 ms to
// prove BOTH durations were summed rather than maxed; the second paid four
// reviewers across two rounds to price the second reviewer's marginal finding
// (`pairRounds`, `r2MarginalBlocking`). Neither has a subject any more. What
// they also proved, and nothing else in this sim does, is kept here over one
// reviewer per round: a repeated blocking detail is counted once, and the ratio
// is per reviewer-MINUTE. (Second pass of the same task: with one review round
// the referee's blocking issues end the task rather than buying a fix and a
// second reading, so the arithmetic is measured over the one reviewer this run
// pays for — the counting rule under test is unchanged.)
{
  const repo = makeRepo(path.join(tmp, 'repo-g2'))
  const runDir = path.join(tmp, 'run-g2')
  const calls = []
  const stub = async (prompt, opts, cwd) => {
    calls.push(opts.label)
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') {
      fs.writeFileSync(path.join(cwd, 'a.txt'), 'from-A\n')
      return doneImpl(cwd)
    }
    if (kind === 'fix') {
      fs.writeFileSync(path.join(cwd, 'a.txt'), 'repaired\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') {
      await sleep(30)
      const d1 = { severity: 'blocking', detail: 'd1', actor: 'implementer' }
      const d2 = { severity: 'blocking', detail: 'd2', actor: 'implementer' }
      return { verdict: 'FIX_REQUIRED', issues: [d1, d1, d2] }
    }
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run } = rig({ repo, runDir, waves: [[mkTask('A', ['a.txt'], { review: 'peer' })]],
                        stub, stamp: 're3' })
  const report = await run()
  const eco = report.reviewEconomy
  assert.equal(report.tasks.find((r) => r.task === 'A').reviewVerdict, 'fix-loop-exhausted',
    'sim precondition: the one round\'s blocking issues ended the task')
  assert.deepEqual(calls.filter((l) => l.startsWith('review:')), ['review:A:1'],
    'sim precondition: one round, one reviewer, whatever `peer` asked for: ' + calls.join(','))

  // 25, not 30: the timer fires a millisecond or two early against Date.now.
  assert.ok(eco.reviewerMs >= 25,
    'the reviewer call is measured: ' + eco.reviewerMs)
  assert.ok(eco.reviewerMs < 1000, 'and nothing else is counted: ' + eco.reviewerMs)
  assert.equal(eco.blockingFindings, 2,
    '`d1` is counted once however often it is returned, `d2` is its own: ' + JSON.stringify(eco))
  assert.equal(eco.blockingPerReviewerMinute.toFixed(6),
    (2 / (eco.reviewerMs / 60000)).toFixed(6),
    'the ratio is blockingFindings per reviewer-MINUTE: ' + JSON.stringify(eco))
}

// ── a driver-minted red is not a reviewer's finding [M7] ─────────────────────
// #964 Task 2 took this leg's vehicle, not its clause. It used to drive a
// TOGGLE `Run:` green on the driver's pre-review pass and red on the fresh
// execution round 2 took after `fix:A:1`: with one review round there is no
// second execution and no second round, so that arrangement cannot be built.
// The clause — a red the DRIVER minted is never charged to the referee — is
// measured here on the one arrangement that still puts both kinds of blocking
// issue in the same round: the #908 path, where a red exam survives the
// pre-review repair round beside that round's `exam:` concern, buys review
// round 1, and is re-appended there as blocking whatever the referee returned.
// The row's notes then hold two blocking details and the economy counts one.
{
  const EXAM_CMD = 'bash a_test.sh'
  const EXAM = '#!/bin/bash\necho exam-is-red\nexit 1\n'
  const repo = makeRepo(path.join(tmp, 'repo-g4'))
  const runDir = path.join(tmp, 'run-g4')
  const calls = []
  const stub = (prompt, opts, cwd) => {
    calls.push(opts.label)
    const kind = opts.label.split(':')[0]
    if (kind === 'exam') {
      fs.writeFileSync(path.join(cwd, 'a_test.sh'), EXAM)
      return { status: 'DONE', summary: 'exam written' }
    }
    if (kind === 'impl') {
      fs.writeFileSync(path.join(cwd, 'a.txt'), 'from-A\n')
      return doneImpl(cwd)
    }
    // The repair round cannot turn the exam green and says so in the
    // `exam:`-prefixed form, which is what buys a referee instead of a park.
    if (kind === 'fix') {
      return { ...doneImpl(cwd), status: 'DONE_WITH_CONCERNS',
               concerns: ['exam: the case is red for any output'] }
    }
    if (kind === 'review') {
      return { verdict: 'FIX_REQUIRED',
               issues: [{ severity: 'blocking', detail: 'the referee wants one thing changed' }] }
    }
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run } = rig({
    repo, runDir, stub, stamp: 're4',
    waves: [[mkTask('A', ['a.txt'], { proofTests: ['a_test.sh'], testCmd: EXAM_CMD })]],
  })
  const report = await run()
  const row = report.tasks.find((r) => r.task === 'A')
  const examRuns = eventsOf(runDir).filter((e) => e.kind === 'driver:exam-run' && e.task === 'A')
  assert.deepEqual(examRuns.map((e) => [e.iter, e.exit]), [[0, 1], [0, 1]],
    'the driver\'s pass and its repeat after the repair round, both red, both iter 0: ' +
    JSON.stringify(examRuns))
  assert.deepEqual(calls,
    ['exam:A', 'impl:A', 'fix:A:0', 'review:A:1'],
    'sim precondition: the red exam bought the one repair round and its `exam:` concern ' +
    'bought the one review round: ' + calls.join(','))
  assert.equal(row.reviewVerdict, 'fix-loop-exhausted',
    'and the still-red exam ended the task, whatever the referee returned: ' +
    JSON.stringify(row))
  assert.ok(row.notes.includes('the referee wants one thing changed') &&
            row.notes.includes(EXAM_CMD),
    'sim precondition: both blocking issues are on the row — the referee\'s and the ' +
    'driver\'s own red exam: ' + JSON.stringify(row.notes))
  assert.ok(report.reviewEconomy.reviewerMs >= 0,
    'the reviewer still ran and was still measured: ' + JSON.stringify(report.reviewEconomy))
  assert.equal(report.reviewEconomy.blockingFindings, 1,
    'a driver-minted exam/Run:/Check: red is never counted as a reviewer\'s finding — only ' +
    'the round\'s referee issue is: ' + JSON.stringify(report.reviewEconomy))
}

// ── leg (h): empty evidence changes nothing [M8] ─────────────────────────────
// The byte-pin needs BASE in the object store. A depth-1 clone — the engine's
// own shallow leg and `actions/checkout`'s default — has no 2cc873f; there the
// leg has nothing to say and says so, rather than failing for a reason
// unrelated to the tree (test_run_engine_integrated_runs.mjs guards the same way).
const haveBase = (() => {
  try {
    execFileSync('git', ['cat-file', '-e', BASE_SHA + '^{commit}'],
      { cwd: REPO_ROOT, env: ENV, stdio: 'ignore' })
    return true
  } catch { return false }
})()
let baseRunEngine = null
// BASE's `loadRoles` reads `fleet/roles/critic.md`, which this release deletes
// (#964 Task 2), so the BASE engine cannot boot against the live roles dir at
// all. It is driven against a copy of that dir with BASE's own critic.md
// restored into it: every other role file is byte-identical to the live one, so
// the prompts the pin compares are still the live tree's bytes.
let baseRolesDir = null
if (haveBase) {
  const baseTree = path.join(tmp, 'base-tree')
  fs.cpSync(FLEET_DIR, path.join(baseTree, 'fleet'), {
    recursive: true, filter: (src) => path.basename(src) !== 'tests',
  })
  fs.writeFileSync(path.join(baseTree, 'fleet', 'run-engine.mjs'),
    execFileSync('git', ['show', BASE_SHA + ':fleet/run-engine.mjs'],
      { cwd: REPO_ROOT, env: ENV, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }))
  fs.symlinkSync(path.join(REPO_ROOT, 'skills'), path.join(baseTree, 'skills'))
  baseRolesDir = path.join(baseTree, 'roles-base')
  fs.cpSync(ROLES_DIR, baseRolesDir, { recursive: true })
  fs.writeFileSync(path.join(baseRolesDir, 'critic.md'),
    execFileSync('git', ['show', BASE_SHA + ':fleet/roles/critic.md'],
      { cwd: REPO_ROOT, env: ENV, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }))
  ;({ runEngine: baseRunEngine } =
    await import(pathToFileURL(path.join(baseTree, 'fleet', 'run-engine.mjs')).href))
} else {
  console.log('[M8] BASE ' + BASE_SHA + ' is not in this clone (shallow) — the ' +
    'byte-for-byte comparison against the BASE engine is skipped')
}

const PIN_REPO = makeRepo(path.join(tmp, 'pin-repo'))
const pinRunDir = path.join(tmp, 'pin-run')
// Both engines are driven through the SAME run directory: prompts name the
// patch FILE, so a second directory would differ in bytes that are not this
// change.
async function pinRun(engine, tasks, rolesDir = ROLES_DIR) {
  fs.rmSync(pinRunDir, { recursive: true, force: true })
  const { base, clonesDir, patchesDir } =
    provision({ repo: PIN_REPO, runDir: pinRunDir, taskIds: tasks.map((t) => t.id) })
  const patchBase = { current: base }
  const cwdFor = makeCwdFor({ clonesDir })
  const prompts = {}
  const inner = async (p, opts) => {
    const cwd = cwdFor(opts)
    prompts[opts.label] = p
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') {
      fs.writeFileSync(path.join(cwd, fileOf(opts.label.split(':')[1])), 'written\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    // BASE's engine still dispatches a completeness critic; the live one never
    // does (#964 Task 2). This arm exists only so the byte-pin can drive BASE —
    // the assertions below require the live run to produce no such prompt.
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const agent = withPatchCapture({
    agent: inner, clonesDir, base: () => patchBase.current, patchesDir, taskIdOf: defaultTaskIdOf,
  })
  const report = await engine({
    args: {
      waves: [tasks], edges: [], testCmd: 'bash check.sh',
      acceptance: { mode: 'suite', reason: 'sim' }, stamp: 'pin',
      integrationBranch: 'ultra/integration-pin', dependencyEdges: [],
      patchInput: patchesDir,
    },
    agent,
    parallel: (thunks) => Promise.all(thunks.map((t) => t())),
    exec: execSeam,
    paths: { repoDir: PIN_REPO, runDir: pinRunDir, clonesDir },
    log: () => {},
    rolesDir,
    patchBase,
  })
  return { prompts, report }
}
{
  const pair = () => [mkTask('A', ['a.txt']), mkTask('B', ['b.txt'])]
  const basePin = haveBase ? await pinRun(baseRunEngine, pair(), baseRolesDir) : null
  const live = await pinRun(runEngine, pair())

  assert.equal(live.report.coverage.complete, true, 'sim precondition: both tasks merged')
  assert.deepEqual(live.report.integratedChecks, [],
    'no constraintChecks leaves `integratedChecks` as [] — present, not absent')
  for (const row of live.report.tasks) {
    assert.equal(row.proofFixes, 0,
      'every task row carries proofFixes 0 when nothing was repaired: ' + JSON.stringify(row))
  }
  assert.deepEqual(Object.keys(live.report.reviewEconomy || {}).sort(), ECONOMY_KEYS,
    'and reviewEconomy is present with exactly its three fields: ' +
    JSON.stringify(live.report.reviewEconomy))
  assert.ok(!Object.prototype.hasOwnProperty.call(live.prompts, 'integration'),
    'the live engine dispatches no completeness critic at all (#964 Task 2): ' +
    JSON.stringify(Object.keys(live.prompts)))

  // The run-51 rule: a run with no proofRuns and no constraintChecks renders
  // nothing new, so every prompt is byte-identical to BASE's. One label is
  // exempt since #964 Task 2 — BASE's `integration` prompt has no live
  // counterpart, and that absence is the assertion above.
  //
  // Run-128 Task 1 re-aims the rule for the `impl:` labels, and only for them:
  // an implementer is no longer handed the run-wide suite at all but the
  // `PROOFS:` block of its own task's proofs, so BASE's `TEST COMMAND:` line
  // has no live counterpart either. The leg is not dropped — it asserts that
  // ONE substitution and byte-identity everywhere around it, so a second,
  // unrelated drift in an implementer's inputs still fails right here.
  const PROOFS_NONE = '\nPROOFS:\n(none — the driver runs the exam at handoff)'
  const reaimed = (label, basePrompt) => {
    assert.ok(basePrompt.includes('\nTEST COMMAND: bash check.sh'),
      'sim precondition: BASE handed ' + label + ' the run-wide suite')
    return basePrompt.replace('\nTEST COMMAND: bash check.sh', PROOFS_NONE)
  }
  if (basePin) {
    const baseLabels = Object.keys(basePin.prompts).filter((l) => l !== 'integration').sort()
    assert.deepEqual(Object.keys(live.prompts).sort(), baseLabels,
      'the same roles are dispatched as on BASE\'s engine, less the critic')
    for (const label of baseLabels) {
      const expected = label.startsWith('impl:')
        ? reaimed(label, basePin.prompts[label])
        : basePin.prompts[label]
      assert.equal(live.prompts[label], expected,
        'an empty-evidence run must leave the ' + label +
        ' prompt byte-identical to BASE\'s (the run-51 rule; for an `impl:` ' +
        'label, identical but for the `PROOFS:` block in place of BASE\'s ' +
        '`TEST COMMAND:` line)')
    }
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// run-156 task 1 — the engine skips the reviewer on a killed mutant, behind
// `reviewOnStateExams`.
//
// The same accounting question this sim already asks, one round earlier: a
// reviewer-minute spent on a task whose own state exam already proved it would
// have caught a wrong state buys the run nothing that the driver did not
// already hold. The switch removes that dispatch and only ever that dispatch,
// and it is off unless the run's arguments carry literally `true`.
//
// Machine clauses under test (legs (a)–(e) of the Proof):
//   M1 — no `reviewOnStateExams` key + a green pre-review pass + a record whose
//        every stem reads `killed: true` dispatches no `review:<id>:1`; the row
//        is `done` / `skipped-mutant-killed` / `fixIterations: 0`, the patch is
//        adopted by the fold, `reviewEconomy.reviewerMs` is `0`, and exactly
//        one `judgmentCalls` entry names the stems and the switch.
//   M2 — the same run with `reviewOnStateExams: true` dispatches
//        `review:A:1` once, with the `STATE EXAM:` block on its prompt, and the
//        row reads `clean`.
//   M3 — with the switch off, `killed: false`, a stem with no `mutant.json` and
//        no record at all each dispatch `review:A:1` once and read `clean`.
//   M4 — with the switch off and every mutant killed, a still-red `Run:` ends
//        `proof-red` with no reviewer, and the #908 path (a still-red exam
//        beside an `exam:` concern) still dispatches its one reviewer.
//   M5 — the two documents carry the switch, its default, its rollback and the
//        verdict, in the places the Proof's `Run:` lines read them.

// The record the driver reads at pass `0`, written by the sim rather than by an
// exam: `stateExamRowsOf` walks `<runDir>/state-exams/task-<id>/<stem>-<pass>/`
// and reads these three files. `rig()` provisions synchronously, so a call to
// this between `rig(...)` and `await run()` lands before the engine looks.
const WALLS = { store_ms: 5, render_ms: null, render: 'skipped' }
const CONTRACT_OK = { breach: null }
const MUTANT_KILLED = { killed: true, path: 'todos/0/completed' }
const MUTANT_SURVIVED = { killed: false, path: 'todos/0/completed' }
const writeStateExam = (runDir, taskId, stem, files) => {
  const dir = path.join(runDir, 'state-exams', 'task-' + taskId, stem + '-0')
  fs.mkdirSync(dir, { recursive: true })
  for (const [name, obj] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), JSON.stringify(obj) + '\n')
  }
  return dir
}
// The full record of one killed stem: walls, contract and a killed mutant.
const writeKilledRecord = (runDir, taskId) =>
  writeStateExam(runDir, taskId, 'todo-state',
    { 'walls.json': WALLS, 'contract.json': CONTRACT_OK, 'mutant.json': MUTANT_KILLED })
// A blob of the integration clone, byte for byte — the fold's green path is
// `reset --hard <candidate>` in that clone, so `HEAD:` is the adopted tree.
const integBlob = (integ, ref) =>
  execFileSync('git', ['show', ref], { cwd: integ, env: ENV, encoding: 'utf8' })
const SKIP_CALL = /^task A: every mutant killed \(todo-state\) — no reviewer was dispatched \(reviewOnStateExams off\)$/

// ── leg (a): the skip itself, and that it is not keyed on an explicit `false`
// [M1] ───────────────────────────────────────────────────────────────────────
// Run twice: once with no `reviewOnStateExams` key in the run's arguments (the
// shipped default — nothing writes the key on the fleet today) and once with it
// spelled `false`. The assertions are the same both times, so an engine that
// skips only when the argument is literally `false` fails the first half and an
// engine that reviews regardless fails both.
for (const [tag, extraArgs] of [['absent', {}], ['false', { reviewOnStateExams: false }]]) {
  const repo = makeRepo(path.join(tmp, 'repo-skip-' + tag))
  const runDir = path.join(tmp, 'run-skip-' + tag)
  const labels = []
  const stub = (prompt, opts, cwd) => {
    labels.push(opts.label)
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') {
      fs.writeFileSync(path.join(cwd, 'a.txt'), 'from-A\n')
      return doneImpl(cwd)
    }
    // A dispatched reviewer fails this leg loudly, at the dispatch, rather than
    // leaving the label list to be read after a clean-looking run.
    if (kind === 'review') {
      throw new Error('(a) [M1] a reviewer was dispatched on a killed-mutant task: ' + opts.label)
    }
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run, integ } = rig({
    repo, runDir, stub, stamp: 'skip-' + tag, extraArgs,
    waves: [[mkTask('A', ['a.txt'])]],
  })
  writeKilledRecord(runDir, 'A')
  const report = await run()
  const row = report.tasks.find((r) => r.task === 'A')

  assert.deepEqual(labels.filter((l) => l.startsWith('review:')), [],
    '(a) [M1] with `reviewOnStateExams` ' + tag + ', a task whose every mutant was killed ' +
    'dispatches no `review:` agent call at all: ' + JSON.stringify(labels))
  assert.equal(row.status, 'done',
    '(a) [M1] and the task is still merged: ' + JSON.stringify(row))
  assert.equal(row.reviewVerdict, 'skipped-mutant-killed',
    '(a) [M1] its row carries the verdict the skip writes: ' + JSON.stringify(row))
  assert.equal(row.fixIterations, 0,
    '(a) [M1] with `fixIterations: 0` — no reviewer ran, so no reviewer\'s findings drove a ' +
    'round: ' + JSON.stringify(row))
  assert.equal(integBlob(integ, 'HEAD:a.txt'), 'from-A\n',
    '(a) [M1] and the wave\'s fold adopted the patch: the integration clone\'s `a.txt` reads ' +
    'the implementer\'s bytes')
  assert.equal(report.reviewEconomy.reviewerMs, 0,
    '(a) [M1] `reviewEconomy.reviewerMs` is exactly 0 on a one-task run that paid for no ' +
    'reviewer: ' + JSON.stringify(report.reviewEconomy))
  const calls = report.judgmentCalls.filter((j) => SKIP_CALL.test(String(j)))
  assert.equal(calls.length, 1,
    '(a) [M1] exactly one judgmentCalls entry records the skip, naming each stem and the ' +
    'switch, verbatim: ' + JSON.stringify(report.judgmentCalls))
}

// ── leg (b): the rollback brings the reviewer back [M2] ──────────────────────
// The same rig and the same killed record with `reviewOnStateExams: true` in
// the run's arguments: one reviewer, and the settled block on its prompt — the
// reading of the record the reviewer gets at BASE, unchanged by this plan.
{
  const repo = makeRepo(path.join(tmp, 'repo-switch-on'))
  const runDir = path.join(tmp, 'run-switch-on')
  const labels = []
  const prompts = {}
  const stub = (prompt, opts, cwd) => {
    labels.push(opts.label)
    prompts[opts.label] = prompt
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') {
      fs.writeFileSync(path.join(cwd, 'a.txt'), 'from-A\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run } = rig({
    repo, runDir, stub, stamp: 'switch-on',
    extraArgs: { reviewOnStateExams: true },
    waves: [[mkTask('A', ['a.txt'])]],
  })
  writeKilledRecord(runDir, 'A')
  const report = await run()
  const row = report.tasks.find((r) => r.task === 'A')

  assert.deepEqual(labels.filter((l) => l.startsWith('review:')), ['review:A:1'],
    '(b) [M2] `reviewOnStateExams: true` restores the one reviewer every task gets at BASE: ' +
    JSON.stringify(labels))
  assert.ok(prompts['review:A:1'].includes('STATE EXAM:'),
    '(b) [M2] and that reviewer is told the record is settled, as the `STATE EXAM:` block')
  assert.ok(prompts['review:A:1'].includes('\n- todo-state: mutant todos/0/completed killed: true'),
    '(b) [M2] naming the stem and its mutant path: ' +
    JSON.stringify(prompts['review:A:1'].slice(-300)))
  assert.equal(row.reviewVerdict, 'clean',
    '(b) [M2] and the row reads like any reviewed task\'s: ' + JSON.stringify(row))
}

// ── leg (c): anything short of every mutant killed is reviewed [M3] ──────────
// Three runs, no switch argument, a reviewer that passes. The predicate is
// `stateExamBlock`'s: rows non-empty AND every `mutant_killed === true`. An
// engine keyed on "no `false`" merges the second row unreviewed; one keyed on
// the directory's presence merges the third.
for (const [tag, record] of [
  ['survived', { 'walls.json': WALLS, 'contract.json': CONTRACT_OK, 'mutant.json': MUTANT_SURVIVED }],
  ['no-mutant-json', { 'walls.json': WALLS, 'contract.json': CONTRACT_OK }],
  ['no-record', null],
]) {
  const repo = makeRepo(path.join(tmp, 'repo-review-' + tag))
  const runDir = path.join(tmp, 'run-review-' + tag)
  const labels = []
  const stub = (prompt, opts, cwd) => {
    labels.push(opts.label)
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') {
      fs.writeFileSync(path.join(cwd, 'a.txt'), 'from-A\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run } = rig({
    repo, runDir, stub, stamp: 'rev-' + tag,
    waves: [[mkTask('A', ['a.txt'])]],
  })
  if (record) writeStateExam(runDir, 'A', 'todo-state', record)
  const report = await run()
  const row = report.tasks.find((r) => r.task === 'A')

  assert.deepEqual(labels.filter((l) => l.startsWith('review:')), ['review:A:1'],
    '(c) [M3] the `' + tag + '` record is not every-mutant-killed, so the task is reviewed ' +
    'exactly as it is at BASE: ' + JSON.stringify(labels))
  assert.equal(row.reviewVerdict, 'clean',
    '(c) [M3] and its row reads `clean`, never the skip\'s verdict: ' + JSON.stringify(row))
}

// ── leg (d), first half: a red proof still outranks the record [M4] ──────────
// The skip lives inside the review round, which a still-red pre-review pass
// never reaches: the task parks `proof-red` after its one repair round, with no
// reviewer, exactly as at BASE. An engine that read the record before the
// pass's evidence would merge this.
{
  const repo = makeRepo(path.join(tmp, 'repo-skip-red'))
  const runDir = path.join(tmp, 'run-skip-red')
  const labels = []
  const stub = (prompt, opts, cwd) => {
    labels.push(opts.label)
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') {
      fs.writeFileSync(path.join(cwd, 'a.txt'), 'from-A\n')
      return doneImpl(cwd)
    }
    // The repair round repairs nothing: `false` is still `false`.
    if (kind === 'fix') return doneImpl(cwd)
    if (kind === 'review') {
      throw new Error('(d) [M4] a reviewer was dispatched on a proof-red task: ' + opts.label)
    }
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run } = rig({
    repo, runDir, stub, stamp: 'skip-red',
    waves: [[mkTask('A', ['a.txt'], { proofRuns: ['false'] })]],
  })
  writeKilledRecord(runDir, 'A')
  const report = await run()
  const row = report.tasks.find((r) => r.task === 'A')

  assert.deepEqual(labels.filter((l) => l.startsWith('review:')), [],
    '(d) [M4] a task whose `Run:` is still red after the repair round dispatches no reviewer: ' +
    JSON.stringify(labels))
  assert.equal(row.status, 'failed',
    '(d) [M4] and a killed mutant does not merge it: ' + JSON.stringify(row))
  assert.equal(row.reviewVerdict, 'proof-red',
    '(d) [M4] the row keeps the `proof-red` park it has at BASE, not the skip\'s verdict: ' +
    JSON.stringify(row))
}

// ── leg (d), second half: the #908 path still buys its referee [M4] ──────────
// A red exam that survives the repair round beside that round's `exam:` concern
// buys review round 1 — the one reading a killed record must not take away,
// because the question there is whether the exam's case can be satisfied at
// all, which no mutant answers. The rig is `test_run_engine_one_of_each.mjs`'s
// `repo-red` leg, copied rather than imported, with the killed record
// pre-written.
{
  const EXAM_CMD = 'bash a_test.sh'
  // Red at BASE and red on every patch: the case no implementation satisfies.
  const EXAM = '#!/bin/bash\necho exam-is-red\nexit 1\n'
  const repo = makeRepo(path.join(tmp, 'repo-skip-908'))
  const runDir = path.join(tmp, 'run-skip-908')
  const labels = []
  const stub = (prompt, opts, cwd) => {
    labels.push(opts.label)
    const kind = opts.label.split(':')[0]
    if (kind === 'exam') {
      fs.writeFileSync(path.join(cwd, 'a_test.sh'), EXAM)
      return { status: 'DONE', summary: 'exam written' }
    }
    if (kind === 'impl') {
      fs.writeFileSync(path.join(cwd, 'a.txt'), 'from-A\n')
      return doneImpl(cwd)
    }
    if (kind === 'fix') {
      return { ...doneImpl(cwd), status: 'DONE_WITH_CONCERNS',
               concerns: ['exam: the case is red for any output'] }
    }
    if (kind === 'review') return passReview()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run } = rig({
    repo, runDir, stub, stamp: 'skip-908',
    waves: [[mkTask('A', ['a.txt'], { proofTests: ['a_test.sh'], testCmd: EXAM_CMD })]],
  })
  writeKilledRecord(runDir, 'A')
  const report = await run()
  const row = report.tasks.find((r) => r.task === 'A')

  assert.deepEqual(labels.filter((l) => l.startsWith('fix:')), ['fix:A:0'],
    '(d) [M4] sim precondition: the red exam bought the one repair round: ' +
    JSON.stringify(labels))
  assert.deepEqual(labels.filter((l) => l.startsWith('review:')), ['review:A:1'],
    '(d) [M4] the fix round\'s `exam:` concern buys review round 1 even with every mutant ' +
    'killed — the skip requires no `exam:` concern: ' + JSON.stringify(labels))
  assert.equal(row.reviewVerdict, 'fix-loop-exhausted',
    '(d) [M4] and the still-red exam ends the task, whatever the referee returned: ' +
    JSON.stringify(row))
}

// ── leg (e): the two documents [M5] ──────────────────────────────────────────
// The three `Run:` lines of the Proof, read here so the sim says what the
// commands say. None of these strings is in either file at BASE.
{
  const REPORT_FORMAT = path.join(REPO_ROOT, 'skills', 'ultrapowers', 'references', 'report-format.md')
  const CONTRACT = path.join(REPO_ROOT, 'fleet', 'CONTRACT.md')
  const rowOf = (file, key) => {
    const re = new RegExp('^\\| `tasks\\[\\]\\.' + key + '` \\|')
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter((l) => re.test(l))
    assert.equal(lines.length, 1,
      '(e) [M5] report-format.md carries exactly one `tasks[].' + key + '` table row: ' +
      lines.length)
    return lines[0]
  }
  const verdictRow = rowOf(REPORT_FORMAT, 'reviewVerdict')
  assert.ok(verdictRow.includes('skipped-mutant-killed'),
    '(e) [M5] the `tasks[].reviewVerdict` row names `skipped-mutant-killed` among the values')
  assert.ok(verdictRow.includes('reviewOnStateExams'),
    '(e) [M5] and says it is written only when `reviewOnStateExams` is off')
  assert.ok(rowOf(REPORT_FORMAT, 'stateExams').includes('reviewOnStateExams'),
    '(e) [M5] the `tasks[].stateExams` row says the `STATE EXAM:` block reaches a reviewer ' +
    'only when one is dispatched, naming `reviewOnStateExams`')

  // The Exam environment bullet, sliced exactly as the Proof's `sed` slices it
  // and folded to one line exactly as its `tr` folds it.
  const contractLines = fs.readFileSync(CONTRACT, 'utf8').split('\n')
  const from = contractLines.findIndex((l) => /^- \*\*Exam environment:\*\*/.test(l))
  assert.ok(from !== -1, '(e) [M5] sim precondition: fleet/CONTRACT.md has an Exam environment bullet')
  const to = contractLines.findIndex((l, i) => i > from && /^- \*\*Launch order/.test(l))
  assert.ok(to !== -1, '(e) [M5] sim precondition: the Launch order bullet follows it')
  const bullet = contractLines.slice(from, to + 1).join(' ')
  assert.ok(/reviewOnStateExams.*off.*true.*skipped-mutant-killed/.test(bullet),
    '(e) [M5] the Exam environment bullet names `reviewOnStateExams`, its default (off), its ' +
    'rollback value (`true`) and the verdict `skipped-mutant-killed`, in that order: ' +
    JSON.stringify(bullet))
}

console.log('ALL TESTS PASSED')
