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

console.log('ALL TESTS PASSED')
