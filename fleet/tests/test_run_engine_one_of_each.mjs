// fleet/tests/test_run_engine_one_of_each.mjs — one reviewer, one fix round, no
// critic.
//
// The run's judgment economy after the 2026-09-13 review reading: a task is
// read by ONE referee, repaired at most ONCE, and nobody reads the finished run
// for completeness. Everything below the agent seam is the real thing (real git
// repos, real clones, real capture, the real fold kernel, the real `sh`); only
// the judgments are canned, so every label this file counts is a dispatch the
// engine actually made.
//
// Machine clauses under test, and the Proof legs that carry them:
//
//   M1 — every review round dispatches exactly ONE worker, labeled
//        `review:<id>:<iter>` with no trailing pass number, whatever the task's
//        `**Review:**` value is. `peer` still means the task is reviewed.
//        Leg (a): a `peer` task's recorded labels hold exactly one
//        `review:<id>:1` and no label ending `:1:1` or `:1:2`.
//   M2 — a task gets at most one fix dispatch, labeled `fix:<id>:0`; a second
//        red after it ends the task `fix-loop-exhausted`, and no `fix:<id>:1`
//        label is ever dispatched. Leg (b).
//   M3 — no worker labeled `integration` is dispatched, `fleet/roles/critic.md`
//        is absent, and `loadRoles` reads no `critic` entry. Leg (c).
//   M4 — the report carries `completenessFindings` deep-equal to `[]` and a
//        `reviewEconomy` object with exactly `reviewerMs`, `blockingFindings`
//        and `blockingPerReviewerMinute` — neither `pairRounds` nor
//        `r2MarginalBlocking` — and `criticDecision` as exported by
//        `fleet/run-main.mjs`, applied to that report, answers
//        `{ approve: true, blocking: [] }` with the reason
//        `0 completeness finding(s), none blocking`. Leg (d).
//   M5 — the four surviving engine sims each print `ALL TESTS PASSED`. Leg (e)
//        says that is read off the Proof's four `Run:` lines, which the driver
//        executes itself; what this file pins is that each of the four is still
//        there and still ends in the sentinel those `Run:` lines grep for.
//
// One reading is recorded on the kata issue and repeated here, because a later
// session would otherwise have to reconstruct it from the engine:
//
//   Leg (b)'s "a stub that keeps a proof red through the fix round ...
//   `fix-loop-exhausted`" is the #908 path, and only that path. A plain red
//   `Run:` that survives `fix:<id>:0` never reaches a referee at all — it exits
//   `reviewVerdict: 'proof-red'`, which `test_run_engine_proof_runs.mjs` pins
//   and M5 keeps green. The one red that survives `fix:<id>:0` and still buys a
//   review round is a red EXAM beside the fix round's `exam:` concern, and
//   round 1 re-appends that red as blocking whatever the referee returned. That
//   is the "second red after `fix:<id>:0`" the task names, and with one round
//   it takes the `fix-loop-exhausted` exit that exists today.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { criticDecision } from '../run-main.mjs'
import { loadRoles } from '../run-engine.mjs'
import { rig, makeRepo, passReview, cleanCritic, doneImpl } from './_engine_helpers.mjs'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-one-of-each-'))
// rmSync unlinks a tree's `skills` symlink rather than following it.
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }))
const TESTS_DIR = fileURLToPath(new URL('.', import.meta.url))
const ROLES_DIR = fileURLToPath(new URL('../roles/', import.meta.url))
const ENGINE_SRC = fileURLToPath(new URL('../run-engine.mjs', import.meta.url))

const mkTask = (id, files, over = {}) => ({
  id, title: id.toLowerCase(), files, tier: 'standard', review: 'lean',
  writes: files, commutes: [], proofTests: [], proofRuns: [],
  body: 'task ' + id + ' body', ...over,
})

// Sorted — the three keys M4 names, and nothing else.
const ECONOMY_KEYS = ['blockingFindings', 'blockingPerReviewerMinute', 'reviewerMs']
// Every `review:` label a task was actually dispatched, in order.
const reviewsOf = (labels, id) => labels.filter((l) => l.startsWith('review:' + id + ':'))
const fixesOf = (labels, id) => labels.filter((l) => l.startsWith('fix:' + id + ':'))

// ── one of each: a `peer` task and a `lean` task in one wave ─────────────────
// [M1] leg (a), [M3] leg (c), [M4] leg (d). The reviewers are clean, so nothing
// but the profile decides how many of them there are.
{
  const repo = makeRepo(path.join(tmp, 'repo-one'))
  const runDir = path.join(tmp, 'run-one')
  const labels = []
  const stub = (prompt, opts, cwd) => {
    labels.push(opts.label)
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') {
      fs.writeFileSync(path.join(cwd, opts.label === 'impl:A' ? 'a.txt' : 'b.txt'),
        'from ' + opts.label + '\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    // Recorded, not thrown on: leg (c) is an assertion about what was
    // dispatched, and a throw here would report itself as an engine error
    // instead.
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run } = rig({
    repo, runDir, stub, stamp: 'ooe1',
    waves: [[mkTask('A', ['a.txt'], { review: 'peer' }), mkTask('B', ['b.txt'])]],
  })
  const report = await run()
  assert.equal(report.coverage.complete, true,
    'sim precondition: both tasks merged — ' + JSON.stringify(report.tasks))
  assert.equal(report.tasks.find((r) => r.task === 'A').reviewVerdict, 'clean',
    'sim precondition: the peer task passed its one round clean — ' +
    JSON.stringify(report.tasks))

  // [M1] leg (a): the `peer` task is reviewed, by exactly one worker, and the
  // label carries no trailing pass number.
  assert.deepEqual(reviewsOf(labels, 'A'), ['review:A:1'],
    'a `peer` task\'s recorded labels hold exactly one `review:A:1` — one worker per ' +
    'review round, whatever the task\'s **Review:** value is: ' + JSON.stringify(labels))
  assert.deepEqual(labels.filter((l) => l.endsWith(':1:1') || l.endsWith(':1:2')), [],
    'and no label ending `:1:1` or `:1:2` — the pair\'s two halves are gone, not renamed: ' +
    JSON.stringify(labels))

  // [M1] the `lean` task is reviewed on the same terms: one worker, no pass
  // number. (The Proof's leg (a) also says a `lean` task's labels hold NO
  // review at all; that half is returned unsatisfiable — `isPairReview` decides
  // how many referees read a task, not whether one does, and two of the four
  // sims M5 keeps green dispatch `review:<id>:1` for a `lean` task. What is
  // asserted here is what both readings of leg (a) agree on: never more than
  // one reviewer per round, and never a pass number.)
  for (const l of reviewsOf(labels, 'B')) {
    assert.equal(l.split(':').length, 3,
      'a review label is `review:<id>:<iter>` and carries no fourth field: ' + l)
  }
  assert.ok(reviewsOf(labels, 'B').length <= 1,
    'and a `lean` task is never read by more than one referee: ' + JSON.stringify(labels))

  // [M3] leg (c): no `integration` worker is dispatched at all.
  assert.deepEqual(labels.filter((l) => l === 'integration'), [],
    'no worker labeled `integration` is dispatched — the completeness critic is deleted, ' +
    'not merely ignored: ' + JSON.stringify(labels))

  // [M4] leg (d): the report's two critic-shaped keys.
  assert.ok(Object.prototype.hasOwnProperty.call(report, 'completenessFindings'),
    'the report still carries a `completenessFindings` key — the readers of report.json ' +
    'are unchanged, the value is: ' + JSON.stringify(Object.keys(report)))
  assert.deepEqual(report.completenessFindings, [],
    'and it is deep-equal to [] on a run where every wave merged: ' +
    JSON.stringify(report.completenessFindings))
  assert.equal(typeof report.reviewEconomy, 'object',
    'the report still carries a `reviewEconomy` object: ' + JSON.stringify(report.reviewEconomy))
  assert.deepEqual(Object.keys(report.reviewEconomy).sort(), ECONOMY_KEYS,
    'with exactly `reviewerMs`, `blockingFindings` and `blockingPerReviewerMinute` — ' +
    'neither `pairRounds` nor `r2MarginalBlocking`: ' + JSON.stringify(report.reviewEconomy))
  assert.deepEqual(criticDecision(report),
    { approve: true, blocking: [], reason: '0 completeness finding(s), none blocking' },
    '`criticDecision` from ../run-main.mjs, applied to that report, approves with no ' +
    'blocking findings and that exact reason: ' + JSON.stringify(criticDecision(report)))
}

// ── leg (b), first half: a referee that stays unhappy buys no fix round ──────
// [M2] Round 1 is the only round: its blocking issue ends the task on the
// `fix-loop-exhausted` exit, and no fix worker is dispatched for it.
{
  const repo = makeRepo(path.join(tmp, 'repo-nofix'))
  const runDir = path.join(tmp, 'run-nofix')
  const labels = []
  const stub = (prompt, opts, cwd) => {
    labels.push(opts.label)
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') {
      fs.writeFileSync(path.join(cwd, 'c.txt'), 'from C\n')
      return doneImpl(cwd)
    }
    if (kind === 'fix') return doneImpl(cwd)
    if (kind === 'review') {
      return { verdict: 'FIX_REQUIRED',
               issues: [{ severity: 'blocking', detail: 'the referee wants one thing changed',
                          actor: 'implementer' }] }
    }
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run } = rig({ repo, runDir, stub, stamp: 'ooe2', waves: [[mkTask('C', ['c.txt'])]] })
  const report = await run()
  const row = report.tasks.find((r) => r.task === 'C')

  assert.deepEqual(reviewsOf(labels, 'C'), ['review:C:1'],
    'one review round, one referee — and no second round after it: ' + JSON.stringify(labels))
  assert.deepEqual(fixesOf(labels, 'C'), [],
    'a blocking issue in the one review round dispatches NO fix worker — in particular no ' +
    '`fix:C:1`: ' + JSON.stringify(labels))
  assert.equal(row.reviewVerdict, 'fix-loop-exhausted',
    'and the task ends on the `fix-loop-exhausted` exit that exists today: ' +
    JSON.stringify(row))
}

// ── leg (b), second half: a proof kept red through the fix round ─────────────
// [M2] The #908 path, end to end: the pre-review pass is red (the peer's exam
// fails), which buys the one repair round `fix:T1:0`; the fix round hands back
// an `exam:` concern beside a still-red exam, which buys review round 1; round
// 1 re-appends the red exam as a blocking issue whatever the referee returned.
// That second red is where the task ends — exactly one fix dispatch, never a
// `fix:T1:1`.
{
  const repo = makeRepo(path.join(tmp, 'repo-red'))
  const runDir = path.join(tmp, 'run-red')
  const EXAM_CMD = 'bash t1_test.sh'
  // Red at BASE and red on every patch: the case no implementation satisfies,
  // which is the whole reason the #908 concern exists.
  const EXAM = '#!/bin/bash\necho exam-is-red\nexit 1\n'
  const labels = []
  const stub = (prompt, opts, cwd) => {
    labels.push(opts.label)
    const kind = opts.label.split(':')[0]
    if (kind === 'exam') {
      fs.writeFileSync(path.join(cwd, 't1_test.sh'), EXAM)
      return { status: 'DONE', summary: 'exam written' }
    }
    if (kind === 'impl') {
      fs.writeFileSync(path.join(cwd, 'one.txt'), 'from T1\n')
      return doneImpl(cwd)
    }
    if (kind === 'fix') {
      // The repair round holds the red bytes and says the exam's case cannot be
      // satisfied, in the `exam:`-prefixed form `fix.md` asks for. That entry
      // beside the same pass's red exam is what buys a referee instead of a
      // park.
      return { ...doneImpl(cwd), status: 'DONE_WITH_CONCERNS',
               concerns: ['exam: the Proof leg asks for a case no implementation can satisfy'] }
    }
    if (kind === 'review') return passReview()
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run } = rig({
    repo, runDir, stub, stamp: 'ooe3',
    waves: [[mkTask('T1', ['one.txt'], { proofTests: ['t1_test.sh'], testCmd: EXAM_CMD })]],
  })
  const report = await run()
  const row = report.tasks.find((r) => r.task === 'T1')

  assert.equal(row.proofFixes, 1,
    'sim precondition: the driver\'s pre-review pass was red and bought one repair round — ' +
    JSON.stringify(row))
  assert.deepEqual(fixesOf(labels, 'T1'), ['fix:T1:0'],
    'a proof kept red through the fix round yields exactly one `fix:T1:0` label and no ' +
    '`fix:T1:1` — one fix dispatch per task, at most: ' + JSON.stringify(labels))
  assert.deepEqual(reviewsOf(labels, 'T1'), ['review:T1:1'],
    'and the fix round\'s `exam:` concern bought review round 1 — one round, one referee, ' +
    'no round 2 to hand a second repair to: ' + JSON.stringify(labels))
  assert.equal(row.reviewVerdict, 'fix-loop-exhausted',
    'and the second red after `fix:T1:0` ends the task `fix-loop-exhausted`: ' +
    JSON.stringify(row))
  assert.deepEqual(labels.filter((l) => l === 'integration'), [],
    '[M3] and no `integration` worker is dispatched on this run either: ' +
    JSON.stringify(labels))
}

// ── leg (c): the critic's file and the critic's code ─────────────────────────
// [M3] The same three facts the Proof's first `Run:` line reads, asserted here
// so the sim says what the command says.
{
  assert.equal(fs.existsSync(path.join(ROLES_DIR, 'critic.md')), false,
    'fleet/roles/critic.md is deleted, not emptied')
  const src = fs.readFileSync(ENGINE_SRC, 'utf8')
  assert.ok(!src.includes('runCritic'),
    'the string `runCritic` no longer occurs in fleet/run-engine.mjs — the function, its ' +
    'call and the barrier comment around it all go')
  assert.ok(!src.includes('roles.critic'),
    'and neither does `roles.critic` — nothing builds the critic\'s prompt any more')

  let roles
  try {
    roles = loadRoles()
  } catch (e) {
    assert.fail('loadRoles() must not read a `critic` entry — with fleet/roles/critic.md ' +
      'deleted it threw instead, so `critic` is still in the list of names it reads: ' +
      String((e && e.message) || e))
  }
  assert.equal(Object.prototype.hasOwnProperty.call(roles, 'critic'), false,
    'loadRoles reads no `critic` entry: ' + JSON.stringify(Object.keys(roles)))
  for (const name of ['implementer', 'reviewer', 'fix', 'resolver', 'reconcile', 'examiner']) {
    assert.equal(typeof roles[name], 'string',
      'and every other role it read at BASE is still read: `' + name + '` is missing from ' +
      JSON.stringify(Object.keys(roles)))
  }
}

// ── leg (e): the four survivors still end in the sentinel [M5] ───────────────
// The Proof's four `Run:` lines are what actually executes these, in the
// driver's own clone; what this pins is that each file is still there and still
// prints the line those commands grep for, so a survivor cannot be dropped or
// silenced and read as green.
{
  for (const name of ['test_run_engine_proof_runs.mjs', 'test_run_engine_joined_proofs.mjs',
                      'test_run_engine_review_economy.mjs', 'test_run_engine_infra_retry.mjs']) {
    const file = path.join(TESTS_DIR, name)
    assert.equal(fs.existsSync(file), true, 'the surviving sim ' + name + ' is still here')
    assert.ok(fs.readFileSync(file, 'utf8').includes("console.log('ALL TESTS PASSED')"),
      name + ' still ends in the `ALL TESTS PASSED` sentinel its `Run:` line greps for')
  }
}

console.log('ALL TESTS PASSED')
