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

// ═════════════════════════════════════════════════════════════════════════════
// run-169 task 1 — the mutant record is read through the task's own state exams
//
// The record under `<runDir>/state-exams/task-<id>/` holds a row for ANY exam
// machinery that ran with the run's environment: the fixture's `evidenceDir`
// writes under `task-$ULTRA_TASK/<stem>-<pass>` for every call, so a helper's
// own self-test rigs — run-23's `packages/tinyapp-exam/test/persistence-move.
// test.ts`, a Proof `Test:` path OUTSIDE `tests/state-exams/`, which drives the
// exam machinery over deliberately failing pages — leave their surviving
// mutants beside the real exam's. The mutant a task is judged on has to come
// from the state exams that task's plan named.
//
// This section is legs (c), (d), (g) [M3] and (e) [M4] of that task's Proof.
// Legs (a), (b) [M1]/[M2] and (f) are in `test_run_engine_state_exams.mjs`, the
// task's other guarded sim — the pure readings of `stateExamStemsOf` and of
// `stateExamsOf`'s third argument, with no engine run at all.
//
// The Machine clauses these legs are about, restated:
//   M3 — in the engine, the rows the review round reads (for the hollow
//        finding, for the reviewer-skip predicate and for the `STATE EXAM`
//        block) and the `stateExams` row the report writes for each task are
//        BOTH read with `stems` equal to `stateExamStemsOf` of that task's
//        `proofTests`. So for a task whose Proof names
//        `tests/state-exams/real.test.ts` and whose record holds a killed
//        `real` row and a surviving `rig` row: no `driver:finding` whose
//        `detail` begins `hollow:` is appended, the task ends
//        `skipped-mutant-killed` with no `review:<id>:1` dispatched, and its
//        report row's `stateExams` is exactly one element with `exam` `real`;
//        while for a task whose Proof names only `a_test.sh` the same two rows
//        yield one `hollow: rig …` finding, one `review:<id>:1` and a
//        `stateExams` row of two elements, as at BASE.
//   M4 — `fleet/CONTRACT.md`'s state-exam record sentence says the task's
//        stems are those of its Proof `Test:` paths under `tests/state-exams/`
//        and that a task with none reads every stem in its directory, and
//        `report-format.md`'s `tasks[].stateExams` prose says the same in one
//        sentence.
//
// How the three runs below are arranged, and why. Each is one task `A` over
// `a.txt`, with the two record rows written by hand between `rig(...)` and
// `await run()` exactly as the run-156 legs above write theirs — `real`, the
// exam the Proof names, and `rig`, the helper's self-test row that the run's
// environment let land in the same directory. What differs between the runs is
// only the task's `proofTests` and the two rows' `mutant.json`.
//
// The pre-review pass has to come back GREEN for the skip in leg (c) to be
// reachable at all, so the `exam:` arm writes an exam that exits 0 and the run
// executes it: measured at BASE, an `exam:` arm that writes NOTHING leaves
// `examBlobs` a one-pair array of `[landing, null]`, which is truthy, so the
// exam is runnable, exits 127 for the absent file and parks the task
// `proof-red` before any review round — a reason that is not this task's
// claim. The task's `testCmd` therefore names the Proof path itself, and the
// arm writes the exam at the landing the driver's own `EXAM PATHS:` line
// gives, which for a path under `tests/state-exams/` is the reserved
// directory. The `exam is green at BASE` judgment call that follows is the
// engine's reading of a sim's exam and gates nothing.
// ═════════════════════════════════════════════════════════════════════════════

// An exam that is green wherever it lands: the pass this section needs is a
// green one, and what the exam measures is not what these legs are about — the
// record's rows are the sim's own bytes, not this exam's output.
const R169_GREEN_EXAM = '#!/bin/bash\nexit 0\n'
// The eight-key report element each seeded stem reads as: `WALLS` above is
// `{ store_ms: 5, render_ms: null, render: 'skipped' }`, so every other field
// is the reading that shape gives. Spelled once, so leg (c)'s one element and
// leg (d)'s two are pinned to full expected values rather than to a length.
const R169_ROW = (exam, killed) => ({
  exam, store_ms: 5, render_ms: null, render: 'skipped',
  action_ms: null, browser: null, mutant_killed: killed, contract: 'ok',
})
// The hollow findings on the run's own log, in the order they were appended.
const hollowOf = (runDir) => eventsOf(runDir)
  .filter((e) => e.kind === 'driver:finding' && String(e.detail || '').startsWith('hollow:'))
  .map((e) => String(e.detail))
// One run of the arrangement above. The reviewer PASSES rather than throwing
// at the dispatch: leg (c) reads four separate things off the same run — the
// findings, the dispatch, the verdict and the report row — and a throw inside
// the reviewer would take the run to `agent-error` and leave three of them
// unreadable at BASE. The dispatch itself is read off `labels`.
const r169Run = async ({ tag, proofTests, testCmd, rows }) => {
  const repo = makeRepo(path.join(tmp, 'repo-169-' + tag))
  const runDir = path.join(tmp, 'run-169-' + tag)
  const labels = []
  const prompts = {}
  const examPaths = []
  const stub = (prompt, opts, cwd) => {
    labels.push(opts.label)
    prompts[opts.label] = prompt
    const kind = opts.label.split(':')[0]
    if (kind === 'exam') {
      // Where the driver sent the exam: its own `EXAM PATHS:` line when the
      // Proof path moved — which is every path under `tests/state-exams/` —
      // and the Proof path itself when nothing moved.
      for (const m of prompt.matchAll(/\nEXAM PATHS: (\S+) -> (\S+)/g)) {
        examPaths.push([m[1], m[2]])
      }
      const land = examPaths.length ? examPaths[0][1] : proofTests[0]
      const dest = path.join(cwd, land)
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.writeFileSync(dest, R169_GREEN_EXAM)
      return { status: 'DONE', summary: 'exam written' }
    }
    if (kind === 'impl') {
      fs.writeFileSync(path.join(cwd, 'a.txt'), 'from-A\n')
      return doneImpl(cwd)
    }
    if (kind === 'fix') return doneImpl(cwd)
    if (kind === 'review') return passReview()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run } = rig({
    repo, runDir, stub, stamp: 'r169' + tag,
    waves: [[mkTask('A', ['a.txt'], { proofTests, testCmd })]],
  })
  for (const [stem, mutant] of rows) {
    writeStateExam(runDir, 'A', stem,
      { 'walls.json': WALLS, 'contract.json': CONTRACT_OK, 'mutant.json': mutant })
  }
  const report = await run()
  return {
    report, labels, prompts, examPaths, runDir,
    row: report.tasks.find((r) => r.task === 'A'),
    reviews: labels.filter((l) => l.startsWith('review:')),
    fixes: labels.filter((l) => l.startsWith('fix:')),
    examRuns: eventsOf(runDir).filter((e) => e.kind === 'driver:exam-run' && e.task === 'A')
      .map((e) => [e.iter, e.exit]),
    hollow: hollowOf(runDir),
  }
}
// The two rows every run below seeds: the exam the Proof names, and the
// helper's own rig row that the record holds beside it.
const R169_KILLED_REAL = ['real', MUTANT_KILLED]
const R169_SURVIVED_REAL = ['real', MUTANT_SURVIVED]
const R169_SURVIVED_RIG = ['rig', MUTANT_SURVIVED]
// The Proof path this task's plan names, and the exam command that names it.
const R169_PROOF_PATH = 'tests/state-exams/real.test.ts'
const R169_EXAM_CMD = 'bash ' + R169_PROOF_PATH

// ── leg (c) [M3]: the rig's survivor is not this task's record ────────────────
{
  const c = await r169Run({
    tag: 'c', proofTests: [R169_PROOF_PATH], testCmd: R169_EXAM_CMD,
    rows: [R169_KILLED_REAL, R169_SURVIVED_RIG],
  })

  // Sim preconditions: the arrangement is the one the legs are read off — the
  // Proof path moved to the reserved directory, the exam ran green on the
  // pre-review pass, and that pass bought no repair round.
  assert.equal(c.examPaths.length, 1,
    '(c) [M3] sim precondition: a Proof path under `tests/state-exams/` moves, so the ' +
    'examiner got exactly one `EXAM PATHS:` line: ' + JSON.stringify(c.examPaths))
  assert.equal(c.examPaths[0][0], R169_PROOF_PATH,
    '(c) [M3] sim precondition: that line maps the Proof path: ' + JSON.stringify(c.examPaths))
  assert.notEqual(c.examPaths[0][1], R169_PROOF_PATH,
    '(c) [M3] sim precondition: to a landing under the reserved directory: ' +
    JSON.stringify(c.examPaths))
  assert.deepEqual(c.examRuns, [[0, 0]],
    '(c) [M3] sim precondition: the task\'s own exam ran once on the pre-review pass and was ' +
    'green, so the pass is the green one the skip requires: ' + JSON.stringify(c.examRuns))
  assert.deepEqual(c.fixes, [],
    '(c) [M3] sim precondition: a green pass buys no repair round: ' + JSON.stringify(c.labels))
  assert.equal(c.report.tasks.length, 1,
    '(c) [M3] sim precondition: one task, so `report.tasks[0]` is task A: ' +
    JSON.stringify(c.report.tasks.map((r) => r.task)))
  assert.equal(c.report.tasks[0], c.row,
    '(c) [M3] sim precondition: and it is the row read below')

  assert.deepEqual(c.hollow, [],
    '(c) [M3] the task\'s Proof names `' + R169_PROOF_PATH + '`, so its record is the `real` ' +
    'row alone and no `driver:finding` whose `detail` begins `hollow:` is appended at all — ' +
    'the surviving `rig` mutant belongs to a helper\'s own test rig, not to this task\'s exam. ' +
    'At BASE the same run appends one `hollow: rig …` finding. Got: ' + JSON.stringify(c.hollow))
  assert.deepEqual(c.reviews, [],
    '(c) [M3] and the reviewer-skip predicate reads those same scoped rows: every mutant of ' +
    'the task\'s own record was killed, so no `review:A:1` is dispatched. At BASE the ' +
    'rig\'s survivor buys that reviewer. Got: ' + JSON.stringify(c.labels))
  assert.equal(c.row.status, 'done',
    '(c) [M3] the task is merged: ' + JSON.stringify(c.row))
  assert.equal(c.row.reviewVerdict, 'skipped-mutant-killed',
    '(c) [M3] `report.tasks[0].reviewVerdict` is the verdict the skip writes, not `clean`: ' +
    JSON.stringify(c.row))
  assert.deepEqual(c.row.stateExams, [R169_ROW('real', true)],
    '(c) [M3] and `report.tasks[0].stateExams` is EXACTLY one element — `exam` `real`, ' +
    '`mutant_killed` true, every other field the reading the seeded evidence gives. The ' +
    'report row and the review round read the same scoped record, so the pull request card\'s ' +
    '`mutant` cell is corrected by this row alone. At BASE this is two elements. Got: ' +
    JSON.stringify(c.row.stateExams))
  // The skip's own judgment call names the stems it read, so it names the
  // task's exam and not the rig's row.
  const skipCalls = c.report.judgmentCalls.filter((j) => String(j).includes('every mutant killed'))
  assert.equal(skipCalls.length, 1,
    '(c) [M3] exactly one judgmentCalls entry records the skip: ' +
    JSON.stringify(c.report.judgmentCalls))
  assert.ok(skipCalls[0].includes('real') && !skipCalls[0].includes('rig'),
    '(c) [M3] and it names the stems the skip predicate actually read — `real`, never `rig`: ' +
    JSON.stringify(skipCalls[0]))
}

// ── leg (d) [M3]: a Proof that names no state exam reads the whole record ─────
// The BASE behaviour, held: a task whose Proof names only `a_test.sh` has no
// state-exam stems of its own, so the scoping is empty and every row in its
// directory is its record — the same two rows, read as they are at BASE.
{
  const d = await r169Run({
    tag: 'd', proofTests: ['a_test.sh'], testCmd: 'bash a_test.sh',
    rows: [R169_KILLED_REAL, R169_SURVIVED_RIG],
  })

  assert.deepEqual(d.examPaths, [],
    '(d) [M3] sim precondition: `a_test.sh` is under neither test root, so nothing moved and ' +
    'the exam is its own landing: ' + JSON.stringify(d.examPaths))
  assert.deepEqual(d.examRuns, [[0, 0]],
    '(d) [M3] sim precondition: the exam ran green on the pre-review pass: ' +
    JSON.stringify(d.examRuns))
  assert.deepEqual(d.fixes, [],
    '(d) [M3] sim precondition: a green pass buys no repair round: ' + JSON.stringify(d.labels))

  assert.equal(d.hollow.length, 1,
    '(d) [M3] exactly one `driver:finding` whose `detail` begins `hollow:` is appended — the ' +
    'BASE behaviour, held: with no stems of its own this task reads every row in its ' +
    'directory, and the `rig` row\'s mutant survived. Got: ' + JSON.stringify(d.hollow))
  assert.ok(d.hollow[0].startsWith('hollow: rig'),
    '(d) [M3] and it is the `rig` row\'s: ' + JSON.stringify(d.hollow[0]))
  assert.deepEqual(d.reviews, ['review:A:1'],
    '(d) [M3] one `review:A:1` is dispatched — a record short of every mutant killed is not ' +
    'an answer, exactly as at BASE: ' + JSON.stringify(d.labels))
  assert.deepEqual(d.row.stateExams, [R169_ROW('real', true), R169_ROW('rig', false)],
    '(d) [M3] and `report.tasks[0].stateExams` is two elements, `real` and `rig`, in sorted ' +
    'order with the same eight keys and values the unscoped read gives at BASE. Got: ' +
    JSON.stringify(d.row.stateExams))
  assert.equal(d.row.reviewVerdict, 'clean',
    '(d) [M3] the reviewed task\'s row reads like any reviewed task\'s, never the skip\'s ' +
    'verdict: ' + JSON.stringify(d.row))
}

// ── leg (g) [M3]: the task's OWN hollow exam still reaches its referee ────────
// The scoping is not a way of losing findings: with the task's own `real`
// mutant alive, that hollow finding is appended, that reviewer is dispatched
// and that reviewer reads the finding — and the rig's row is absent from all
// three, and from the report row.
{
  const g = await r169Run({
    tag: 'g', proofTests: [R169_PROOF_PATH], testCmd: R169_EXAM_CMD,
    rows: [R169_SURVIVED_REAL, R169_SURVIVED_RIG],
  })

  assert.deepEqual(g.examRuns, [[0, 0]],
    '(g) [M3] sim precondition: the exam ran green on the pre-review pass, so the round is ' +
    'reached: ' + JSON.stringify(g.examRuns))
  assert.deepEqual(g.fixes, [],
    '(g) [M3] sim precondition: a green pass buys no repair round: ' + JSON.stringify(g.labels))
  assert.equal(g.row.reviewVerdict, 'clean',
    '(g) [M3] sim precondition: a survivor is not every-mutant-killed, so the task is ' +
    'reviewed and the passing referee leaves it `clean`: ' + JSON.stringify(g.row))

  assert.equal(g.hollow.length, 1,
    '(g) [M3] exactly one `driver:finding` whose `detail` begins `hollow:` — the task\'s own ' +
    'exam left its mutant alive, and that is the finding the scoping must not lose. At BASE ' +
    'this run appends two. Got: ' + JSON.stringify(g.hollow))
  assert.ok(g.hollow[0].startsWith('hollow: real'),
    '(g) [M3] and it is the `real` row\'s: ' + JSON.stringify(g.hollow[0]))
  assert.deepEqual(g.hollow.filter((h) => h.startsWith('hollow: rig')), [],
    '(g) [M3] none begins `hollow: rig` — the rig\'s survivor is not this task\'s exam: ' +
    JSON.stringify(g.hollow))
  assert.deepEqual(g.reviews, ['review:A:1'],
    '(g) [M3] one `review:A:1` is dispatched: ' + JSON.stringify(g.labels))

  const promptLines = String(g.prompts['review:A:1'] || '').split('\n')
  assert.ok(promptLines.some((l) => l.includes('hollow: real')),
    '(g) [M3] sim precondition: the driver\'s hollow finding against the task\'s OWN exam ' +
    'does reach that reviewer\'s prompt, so the two assertions below are not vacuous')
  assert.deepEqual(promptLines.filter((l) => l.includes('hollow: rig')), [],
    '(g) [M3] and no line of that captured prompt contains `hollow: rig`: the referee is ' +
    'briefed on the task\'s own record and not on a helper\'s test rig. At BASE the prompt ' +
    'carries that line. Got: ' +
    JSON.stringify(promptLines.filter((l) => l.includes('hollow: rig'))))
  assert.deepEqual(promptLines.filter((l) => l.startsWith('- rig:')), [],
    '(g) [M3] and no line begins `- rig:` — the `STATE EXAM` block the reviewer reads is ' +
    'built from the same scoped rows: ' +
    JSON.stringify(promptLines.filter((l) => l.startsWith('- rig:'))))

  assert.deepEqual(g.row.stateExams, [R169_ROW('real', false)],
    '(g) [M3] and `report.tasks[0].stateExams` is exactly one element with `exam` `real` and ' +
    '`mutant_killed` false — a survivor the task owns is reported, a survivor it does not is ' +
    'not. At BASE this is two elements. Got: ' + JSON.stringify(g.row.stateExams))
}

// ── leg (e) [M4]: the third and fourth `Run:`, and what those sentences say ───
// At BASE neither document carries the string `tests/state-exams/` at all
// (zero occurrences in both), so both greps fail there. They are read here so
// the sim says what the commands say.
{
  const CONTRACT = path.join(REPO_ROOT, 'fleet', 'CONTRACT.md')
  const REPORT_FORMAT = path.join(REPO_ROOT, 'skills', 'ultrapowers', 'references',
                                  'report-format.md')
  const contract = fs.readFileSync(CONTRACT, 'utf8')
  const reportFormat = fs.readFileSync(REPORT_FORMAT, 'utf8')

  // The third `Run:` — grep -q 'tests/state-exams/' fleet/CONTRACT.md
  assert.ok(contract.includes('tests/state-exams/'),
    '(e) [M4] the third `Run:`: `fleet/CONTRACT.md` carries `tests/state-exams/`')
  // The fourth — grep -q 'tests/state-exams/' skills/…/report-format.md
  assert.ok(reportFormat.includes('tests/state-exams/'),
    '(e) [M4] the fourth `Run:`: `skills/ultrapowers/references/report-format.md` carries ' +
    '`tests/state-exams/`')

  // …and that each occurrence is in the prose M4 names, saying what M4 says.
  // Two readings, not a wording: the sentence carrying the string has to name
  // the Proof — the stems ARE the stems of the task's Proof `Test:` paths —
  // and the prose has to answer the task that names none of them, which reads
  // every stem in its directory. Both are checked against alternations rather
  // than one spelling, because M4 fixes what the sentence says and not how it
  // is phrased; neither alternation matches either document at BASE, so
  // neither is vacuous.
  const READS_THE_WHOLE = /every stem|all the stems|all of the stems|whole directory|whole record|entire directory|entire record/i
  const sentencesWith = (text) =>
    text.split(/(?<=\.)\s+/).filter((s) => s.includes('tests/state-exams/'))
  const saysTheClause = (where, text) => {
    const carrying = sentencesWith(text)
    assert.ok(carrying.length > 0,
      '(e) [M4] ' + where + ' carries `tests/state-exams/`: ' + JSON.stringify(text.slice(0, 200)))
    assert.ok(carrying.some((s) => /Proof/.test(s)),
      '(e) [M4] ' + where + ' says the task\'s stems are those of its PROOF `Test:` paths ' +
      'under `tests/state-exams/` — the sentence carrying the string names no Proof at all: ' +
      JSON.stringify(carrying))
    assert.ok(READS_THE_WHOLE.test(text),
      '(e) [M4] and it says what a task with none of those paths reads — every stem in its ' +
      'directory. No such reading is in that prose: ' + JSON.stringify(text.slice(0, 400)))
  }

  // CONTRACT.md's state-exam record sentence is in the bullet that names the
  // `skipped-mutant-killed` rule — the bullet `every mutant killed` is in.
  const contractLines = contract.split('\n')
  const at = contractLines.findIndex((l) => l.includes('every mutant killed'))
  assert.ok(at !== -1,
    '(e) [M4] sim precondition: `fleet/CONTRACT.md` still carries the `every mutant killed` ' +
    'rule the state-exam record sentence sits with')
  let from = at
  while (from > 0 && !/^- \*\*/.test(contractLines[from])) from--
  let to = at + 1
  while (to < contractLines.length && !/^- \*\*/.test(contractLines[to])) to++
  const bullet = contractLines.slice(from, to).join(' ')
  assert.ok(bullet.includes('tests/state-exams/'),
    '(e) [M4] and the occurrence is in THAT bullet — the one carrying the ' +
    '`skipped-mutant-killed` rule and the state-exam record — not somewhere else in the ' +
    'document: ' + JSON.stringify(bullet.slice(0, 300)))
  saysTheClause('`fleet/CONTRACT.md`\'s state-exam record sentence', bullet)

  // report-format.md says the same in ONE sentence, in the `tasks[].stateExams`
  // prose — the row that says one element per stem.
  const stateExamsRows = reportFormat.split('\n')
    .filter((l) => /^\| `tasks\[\]\.stateExams` \|/.test(l))
  assert.equal(stateExamsRows.length, 1,
    '(e) [M4] sim precondition: `report-format.md` carries exactly one `tasks[].stateExams` ' +
    'table row: ' + stateExamsRows.length)
  assert.ok(stateExamsRows[0].includes('tests/state-exams/'),
    '(e) [M4] the fourth `Run:` reads THAT row: the `tasks[].stateExams` prose is where ' +
    '`tests/state-exams/` belongs, not another row of the schema')
  saysTheClause('`report-format.md`\'s `tasks[].stateExams` prose', stateExamsRows[0])
}

console.log('ALL TESTS PASSED')
