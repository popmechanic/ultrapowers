// fleet/tests/test_run_engine_actor_routing.mjs — a finding has an ACTOR, and
// the two actors cost different things.
//
// Until now every blocking issue drove the same fix round: the implementer was
// handed the finding and told to repair it. A finding whose subject is the PLAN
// — a clause that cannot hold, an exam the task's own FILES cannot reach —
// cannot be repaired by the one agent that is forbidden from changing the plan,
// so the fix round loops the implementer against a wall and the run pays for
// both halves. Routing it to `plan` instead parks the question at the gate,
// where a human answers it, and lets the patch merge on the findings the
// implementer actually owns.
//
// Machine clause under test (leg (e) of the Proof):
//   M5 — `REVIEWER_SCHEMA`'s issue object gains
//        `actor: { enum: ['implementer', 'plan'] }`, in `required`; an issue's
//        actor reads as `plan` only when it says `plan`, EXCEPT that a blocking
//        issue whose detail begins `plan-defect:` and names a backticked
//        path-like token outside the task's `files` is re-routed to `plan` with
//        a judgment call; blocking `implementer` issues drive the fix round as
//        today (and the fix prompt lists only them); blocking `plan` issues
//        drive no fix round and no re-review — the task merges, carries
//        `plan-defect: <detail>` in its notes, and every DONE task's distinct
//        plan-actor detail becomes one `deferredVerification` item with reason
//        `plan-defect`, which the frozen gate turns into a `deferred:plan-defect`
//        ack that `run-main.mjs`'s `ackDecision` refuses.
//
// Everything below the agent seam is real; only the judgments are canned.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { ackDecision } from '../run-main.mjs'
import { REVIEWER_SCHEMA } from '../run-engine.mjs'
import { rig, makeRepo, passReview, cleanCritic, doneImpl } from './_engine_helpers.mjs'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-actor-routing-'))
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }))
const SCRIPTS = fileURLToPath(new URL('../../skills/ultrapowers/scripts', import.meta.url))

const PLAN_DETAIL = 'plan-defect: M2 cannot hold'
const IMPL_DETAIL = 'v1 is wrong'
const OUTSIDE_DETAIL = 'plan-defect: the exam at `other/exam.sh` cannot pass'

const mkTask = (id, files, over = {}) => ({
  id, title: id.toLowerCase(), files, tier: 'standard', review: 'lean',
  writes: ['a.txt'], commutes: [], proofTests: [], proofRuns: [],
  body: 'task ' + id + ' body', ...over,
})
const blocking = (detail, actor) => (actor === undefined
  ? { severity: 'blocking', detail }
  : { severity: 'blocking', detail, actor })
const fixRequired = (issues) => ({ verdict: 'FIX_REQUIRED', issues })
// One task, one file, canned reviews per round. `reviews` is indexed by the
// round number (1, 2); anything else is a PASS.
const oneTaskRun = ({ name, files = ['a.txt'], reviews, fixWrites = false }) => {
  const repo = makeRepo(path.join(tmp, 'repo-' + name))
  const runDir = path.join(tmp, 'run-' + name)
  const calls = []
  const prompts = {}
  const stub = (prompt, opts, cwd) => {
    calls.push(opts.label)
    prompts[opts.label] = prompt
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') {
      fs.writeFileSync(path.join(cwd, 'a.txt'), 'implemented\n')
      return doneImpl(cwd)
    }
    if (kind === 'fix') {
      if (fixWrites) fs.writeFileSync(path.join(cwd, 'a.txt'), 'repaired\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') {
      const round = Number(opts.label.split(':')[2])
      return reviews[round] || passReview()
    }
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run, integ } = rig({ repo, runDir, waves: [[mkTask('T1', files)]], stub,
                               stamp: name, extraArgs: { shallowLeg: false } })
  return { run, calls, prompts, repo, runDir, integ, branch: 'ultra/integration-' + name }
}

// ── the schema: an issue now says who owns it [M5] ───────────────────────────
{
  const issue = REVIEWER_SCHEMA.properties.issues.items
  assert.deepEqual(issue.properties.actor, { enum: ['implementer', 'plan'] },
    'REVIEWER_SCHEMA\'s issue object must carry ' +
    '`actor: { enum: [\'implementer\', \'plan\'] }`, got: ' + JSON.stringify(issue.properties.actor))
  assert.deepEqual(issue.required, ['severity', 'detail', 'actor'],
    'and `actor` joins `required`, in that order: ' + JSON.stringify(issue.required))
}

// ── a blocking PLAN issue: no fix round, no re-review, a deferral [M5] ───────
{
  const { run, calls, runDir, integ, branch } = oneTaskRun({
    name: 'ar1', reviews: { 1: fixRequired([blocking(PLAN_DETAIL, 'plan')]) },
  })
  const report = await run()

  assert.deepEqual(calls.filter((l) => l.startsWith('fix:')), [],
    'a plan-actor finding must not loop the implementer: ' + calls.join(','))
  assert.deepEqual(calls.filter((l) => l.startsWith('review:')), ['review:T1:1'],
    'and must not buy a second review round either: ' + calls.join(','))
  const row = report.tasks.find((r) => r.task === 'T1')
  assert.equal(row.status, 'done', 'the patch still merges: ' + JSON.stringify(row))
  assert.equal(row.reviewVerdict, 'clean', 'on its first round, as today: ' + JSON.stringify(row))
  assert.equal(row.fixIterations, 0, 'with no fix iterations: ' + JSON.stringify(row))
  assert.ok(String(row.notes).includes(PLAN_DETAIL),
    'the row\'s notes carry the plan defect: ' + JSON.stringify(row.notes))

  // [M5] the deferral the gate reads, and the judgment call that announces it.
  assert.deepEqual(report.deferredVerification,
    [{ deliverable: 'T1', reason: 'plan-defect', why: PLAN_DETAIL }],
    'one typed deferredVerification item per distinct plan-actor detail: ' +
    JSON.stringify(report.deferredVerification))
  const WANT = 'task T1: plan-defect deferred to the gate — ' + PLAN_DETAIL
  assert.equal(report.judgmentCalls.filter((j) => String(j).includes(WANT)).length, 1,
    'exactly one judgment call, verbatim `' + WANT + '`: ' + JSON.stringify(report.judgmentCalls))

  // [M5] run through the FROZEN gate: an ack of type deferred:plan-defect,
  // which run-main's ackDecision refuses. Both halves, or the park is theatre.
  const reportPath = path.join(runDir, 'workflow-result.json')
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
  // The integration clone is the tree the run produced, and the gate reads git
  // there: clean tree, the recorded merge head, the branch it merged onto.
  const gate = spawnSync('python3', [path.join(SCRIPTS, 'gate_check.py'),
    '--run-id', 'sim', '--branch', branch, '--report', reportPath, '--repo', integ],
    { encoding: 'utf8' })
  assert.equal(gate.status, 2,
    'gate_check.py must exit 2 (NEEDS_ACK) on a plan-defect deferral: ' +
    gate.stdout + gate.stderr)
  const verdict = JSON.parse(gate.stdout)
  assert.deepEqual((verdict.checks || []).filter((c) => !c.ok), [],
    'and every deterministic check must still pass: ' + gate.stdout)
  assert.equal(verdict.verdict, 'NEEDS_ACK', gate.stdout)
  assert.deepEqual((verdict.acks || []).map((a) => a.type), ['deferred:plan-defect'],
    'the ack is typed from the reason: ' + gate.stdout)
  assert.equal(ackDecision({ gateCheck: { acks: [{ type: 'deferred:plan-defect' }] } }).approve,
    false, 'and `deferred:plan-defect` is not pre-authorized — the run parks')
}

// ── a mixed round: the implementer's issue drives the fix, the plan's does not
{
  const { run, calls, prompts } = oneTaskRun({
    name: 'ar2', fixWrites: true,
    reviews: {
      1: fixRequired([blocking(IMPL_DETAIL, 'implementer'), blocking(PLAN_DETAIL, 'plan')]),
      // Round 2 returns the same plan defect again: the deferral must not double.
      2: fixRequired([blocking(PLAN_DETAIL, 'plan')]),
    },
  })
  const report = await run()

  assert.deepEqual(calls.filter((l) => l.startsWith('fix:') || l.startsWith('review:')),
    ['review:T1:1', 'fix:T1:1', 'review:T1:2'],
    'the implementer issue drives one fix round and its re-review: ' + calls.join(','))
  const fixPrompt = prompts['fix:T1:1']
  const section = fixPrompt.slice(fixPrompt.indexOf('\n\nBlocking issues to resolve:\n'))
  assert.ok(section.includes('- ' + IMPL_DETAIL),
    'the fix round is handed the implementer\'s issue: ' + section)
  assert.ok(!section.includes(PLAN_DETAIL),
    'and NOT the plan\'s — nothing the implementer may act on is in it: ' + section)

  const row = report.tasks.find((r) => r.task === 'T1')
  assert.equal(row.status, 'done', JSON.stringify(row))
  assert.equal(row.reviewVerdict, 'fixed', JSON.stringify(row))
  assert.deepEqual(report.deferredVerification,
    [{ deliverable: 'T1', reason: 'plan-defect', why: PLAN_DETAIL }],
    'one item per DISTINCT plan-actor detail, even when both rounds returned it: ' +
    JSON.stringify(report.deferredVerification))
}

// ── an issue with no actor is the implementer's, as today [M5] ───────────────
{
  const { run, calls } = oneTaskRun({
    name: 'ar3', fixWrites: true,
    reviews: { 1: fixRequired([{ severity: 'blocking', detail: IMPL_DETAIL }]) },
  })
  const report = await run()
  assert.deepEqual(calls.filter((l) => l.startsWith('fix:')), ['fix:T1:1'],
    'an issue that does not say `plan` reads as the implementer\'s: ' + calls.join(','))
  assert.equal(report.tasks.find((r) => r.task === 'T1').reviewVerdict, 'fixed',
    'and the fix round merges it as it always did')
  assert.deepEqual(report.deferredVerification, [],
    'no plan actor, no deferral: ' + JSON.stringify(report.deferredVerification))
}

// ── the validator: a `plan-defect:` naming a path outside FILES is the plan's,
// whatever actor the reviewer typed [M5] ─────────────────────────────────────
{
  const { run, calls } = oneTaskRun({
    name: 'ar4', files: ['a.txt'],
    reviews: { 1: fixRequired([blocking(OUTSIDE_DETAIL, 'implementer')]) },
  })
  const report = await run()
  assert.deepEqual(calls.filter((l) => l.startsWith('fix:')), [],
    'an implementer cannot repair a path its FILES do not carry: ' + calls.join(','))
  const WANT = 'task T1: plan-defect names `other/exam.sh` outside FILES — routed to the plan'
  assert.equal(report.judgmentCalls.filter((j) => String(j).includes(WANT)).length, 1,
    'the re-route is announced verbatim as `' + WANT + '`: ' + JSON.stringify(report.judgmentCalls))
  assert.deepEqual(report.deferredVerification,
    [{ deliverable: 'T1', reason: 'plan-defect', why: OUTSIDE_DETAIL }],
    'and it reaches the gate as a plan-defect deferral: ' +
    JSON.stringify(report.deferredVerification))
}
{
  const { run, calls } = oneTaskRun({
    name: 'ar5', files: ['a.txt', 'other/exam.sh'], fixWrites: true,
    reviews: { 1: fixRequired([blocking(OUTSIDE_DETAIL, 'implementer')]) },
  })
  const report = await run()
  assert.deepEqual(calls.filter((l) => l.startsWith('fix:')), ['fix:T1:1'],
    'the SAME issue on a task that owns the file is the implementer\'s to fix: ' + calls.join(','))
  assert.deepEqual(report.deferredVerification, [],
    'and nothing is deferred: ' + JSON.stringify(report.deferredVerification))
}

// ── a task that never finished defers nothing [M5] ───────────────────────────
// deferredVerification is built from tasks whose final status is `done`: a
// fix-loop-exhausted task is already accounted under missingDeliverables, and
// deferring a plan question about work that did not land would ask the operator
// to ack a defect in a patch nobody merged.
{
  const both = fixRequired([blocking(IMPL_DETAIL, 'implementer'), blocking(PLAN_DETAIL, 'plan')])
  const { run } = oneTaskRun({ name: 'ar6', reviews: { 1: both, 2: both } })
  const report = await run()
  const row = report.tasks.find((r) => r.task === 'T1')
  assert.equal(row.status, 'failed', 'sim precondition: the task exhausted its fix loop')
  assert.equal(row.reviewVerdict, 'fix-loop-exhausted', JSON.stringify(row))
  assert.deepEqual(report.deferredVerification, [],
    'a task that is not `done` contributes no plan-defect item: ' +
    JSON.stringify(report.deferredVerification))
}

console.log('ALL TESTS PASSED')
