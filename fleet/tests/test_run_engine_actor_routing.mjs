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
import { rig, makeRepo, passReview, cleanCritic, doneImpl, gitSync } from './_engine_helpers.mjs'

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
                               stamp: name })
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

// ═══════════════════════════════════════════════════════════════════════════
// #722 Task 1 — the implementer's plan-defect against a Proof leg parks the
// task for the plan.
//
// A referee is not the only reader who can find a defect in the plan. The
// implementer holds the same task text, and when the Proof's own exam asserts
// something no implementation of the task can produce, the fix round that red
// buys is a round against a wall: the one agent forbidden from editing the exam
// (#663), handed the exam's red as its instructions. So a first exam-red reply
// whose `concerns` carry a `plan-defect:` naming a Proof leg by its label parks
// the task for the plan instead — no `fix:<id>:0`, no referee, a `failed` row
// with actor `plan`, the wave still merging around it, and the leg travelling
// to the gate as a deferral the operator reads. The block below is the same
// actor question this file already asks of a reviewer's finding, asked of the
// implementer's own reply. Machine clauses M1–M8, Proof legs (a)–(h).
// ═══════════════════════════════════════════════════════════════════════════

const T1_TEST = 't1_test.sh'
// The exam that "asserts a value the fixture cannot produce": red at BASE
// (`makeRepo` writes `a.txt` as line1/line2/line3) and red after an
// implementer that writes `implemented\n`. That impossibility is the leg the
// implementer's concern names.
const IMPOSSIBLE_EXAM = '#!/bin/bash\n[ "$(cat a.txt)" = "impossible" ]\n'
// The ordinary exam beside it: red at BASE, green once the implementer wrote.
const REACHABLE_EXAM = '#!/bin/bash\n[ "$(cat a.txt)" = "implemented" ]\n'
// The Context's parking concern, verbatim — it matches
// /^plan-defect:[\s\S]*\([a-z]\)/ because it names its leg by label.
const PARK_CONCERN = 'plan-defect: leg (a) asserts a.txt reads "impossible", ' +
  'which no implementation of this task can produce'
// The same prefix with no leg label anywhere in it [M5].
const UNLABELLED_CONCERN = 'plan-defect: the exam cannot pass on this fixture'
const PARK_CALL = 'task T1: plan-defect against a Proof leg named by the implementer' +
  ' — no fix round dispatched; failed with actor plan — ' + PARK_CONCERN

const concernsImpl = (cwd, concerns) => ({
  status: 'DONE_WITH_CONCERNS', summary: 'sim work done',
  startHead: gitSync(['rev-parse', 'HEAD'], cwd), concerns,
})

// A sibling of `oneTaskRun` rather than a widening of it (`oneTaskRun` is one
// task with no Proof `Test:` by construction). T1 carries a Proof exam — a
// `proofTests`/`testCmd` pair, so the real `examiner.md` role is dispatched
// beside the implementer — and an implementer that returns DONE_WITH_CONCERNS.
// `sibling: true` adds T2: files `b.txt`, no exam, a PASS review — the
// ordinary task the wave still merges around the parked one.
// `fix` and `review` are the dispatches the leg PERMITS; null means the leg
// forbids that dispatch, and the stub throws on it rather than serving it.
const examConcernRun = ({ name, exam, concerns, sibling = false, fix = null, review = null }) => {
  const repo = makeRepo(path.join(tmp, 'repo-' + name))
  const runDir = path.join(tmp, 'run-' + name)
  const calls = []
  const t1 = mkTask('T1', ['a.txt'], { testCmd: 'bash ' + T1_TEST, proofTests: [T1_TEST] })
  const t2 = mkTask('T2', ['b.txt'], { writes: ['b.txt'] })
  const stub = (prompt, opts, cwd) => {
    calls.push(opts.label)
    if (opts.label === 'integration') return cleanCritic()
    const [kind, id] = String(opts.label).split(':')
    if (kind === 'exam') {
      fs.writeFileSync(path.join(cwd, T1_TEST), exam)
      return { status: 'DONE', summary: 'exam written', startHead: 'ignored' }
    }
    if (kind === 'impl' && id === 'T2') {
      fs.writeFileSync(path.join(cwd, 'b.txt'), 'from T2\n')
      return doneImpl(cwd)
    }
    if (kind === 'impl') {
      fs.writeFileSync(path.join(cwd, 'a.txt'), 'implemented\n')
      return concernsImpl(cwd, concerns)
    }
    if (kind === 'review' && id === 'T2') return passReview()
    if (kind === 'fix' && id === 'T1' && fix) { fix(cwd); return doneImpl(cwd) }
    if (kind === 'review' && id === 'T1' && review) return review()
    throw new Error('dispatch this leg forbids: ' + opts.label +
      ' — a plan-defect against a Proof leg buys neither a fix round nor a referee')
  }
  const { run, integ } = rig({ repo, runDir, waves: [sibling ? [t1, t2] : [t1]], stub,
                               stamp: name })
  // Only the labels that belong to T1: the sibling's dispatches interleave.
  const forT1 = () => calls.filter((l) => /^(?:exam|impl|fix|review):T1(?::|$)/.test(l))
  return { run, calls, forT1, runDir, integ, branch: 'ultra/integration-' + name }
}

// ── (a)–(d): the park, its row, the wave around it, and the gate ────────────
{
  const r = examConcernRun({
    name: 'ar7', exam: IMPOSSIBLE_EXAM, concerns: [PARK_CONCERN], sibling: true,
  })
  const report = await r.run()

  // (a) [M1] the pre-review pass is red on the exam and the reply names a leg:
  // the labels T1 bought are the pair and nothing else. The stub throws on any
  // `fix:T1:*` or `review:T1:*`, so a dispatched fix round fails this leg here.
  assert.deepEqual(r.forT1(), ['exam:T1', 'impl:T1'],
    '(a)/M1: a leg-labelled plan-defect on a red exam dispatches exactly ' +
    '`exam:T1` and `impl:T1` — no fix round, no referee. Dispatched: ' + r.calls.join(','))

  const row = report.tasks.find((t) => t.task === 'T1')
  // (b) [M2] the row the park returns.
  assert.equal(row.status, 'failed', '(b)/M2: the parked task is `failed`: ' + JSON.stringify(row))
  assert.equal(row.reviewVerdict, 'plan-defect',
    '(b)/M2: with reviewVerdict `plan-defect`: ' + JSON.stringify(row))
  assert.equal(row.actor, 'plan', '(b)/M2: and actor `plan`: ' + JSON.stringify(row))
  assert.equal(row.fixIterations, 0, '(b)/M2: no fix iterations: ' + JSON.stringify(row))
  assert.equal(row.proofFixes, 0,
    '(b)/M2: and no pre-review repair round was bought either — proofFixes is 0, ' +
    'so the park precedes the `fix:T1:0` dispatch rather than following it: ' + JSON.stringify(row))
  assert.equal(row.exam, 'red',
    '(b)/M2: the exam was recorded red at BASE: ' + JSON.stringify(row))
  assert.equal(row.notes, PARK_CONCERN,
    '(b)/M2: `notes` is the matching concern entries joined by `; ` — one here, so the ' +
    'leg label and the concern\'s own text are both in it: ' + JSON.stringify(row.notes))

  // (c) [M3] the wave keeps moving: the sibling merges as at BASE.
  const sib = report.tasks.find((t) => t.task === 'T2')
  assert.equal(sib.status, 'done', '(c)/M3: the sibling merges as at BASE: ' + JSON.stringify(sib))
  assert.equal('actor' in sib, false,
    '(c)/M3: and carries no `actor` key — the key is present only on a parked row: ' +
    JSON.stringify(sib))
  assert.equal(report.coverage.tasks_merged, 1,
    '(c)/M3: one of the wave\'s two tasks merged: ' + JSON.stringify(report.coverage))
  assert.equal(report.waveMerges[0].status, 'MERGED',
    '(c)/M3: and the wave\'s merge is MERGED: ' + JSON.stringify(report.waveMerges[0]))

  // (d) [M4] the deferral the gate reads, the gate's own verdict, and the one
  // judgment call that announces the park.
  assert.deepEqual(report.deferredVerification,
    [{ deliverable: 'T1', reason: 'plan-defect', why: PARK_CONCERN }],
    '(d)/M4: exactly one deferredVerification item for the parked task, its `why` the ' +
    'concern verbatim: ' + JSON.stringify(report.deferredVerification))
  assert.equal(report.judgmentCalls.filter((j) => j === PARK_CALL).length, 1,
    '(d)/M4: exactly one judgment call equal to `' + PARK_CALL + '`: ' +
    JSON.stringify(report.judgmentCalls))

  // The FROZEN gate on that report. The parked task is `failed` with declared
  // files, so `missingDeliverables` carries it and the `deliverables` check
  // fails — BLOCKED, exit 1 — and the deferral still becomes its typed ack,
  // because `emit()` prints every ack whatever the verdict.
  const reportPath = path.join(r.runDir, 'workflow-result.json')
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
  const gate = spawnSync('python3', [path.join(SCRIPTS, 'gate_check.py'),
    '--run-id', 'sim', '--branch', r.branch, '--report', reportPath, '--repo', r.integ],
    { encoding: 'utf8' })
  assert.equal(gate.status, 1,
    '(d)/M4: the frozen gate exits 1 on the parked task: ' + gate.stdout + gate.stderr)
  const verdict = JSON.parse(gate.stdout)
  assert.equal(verdict.verdict, 'BLOCKED', '(d)/M4: verdict BLOCKED: ' + gate.stdout)
  const deliverables = (verdict.checks || []).find((c) => c.name === 'deliverables')
  assert.equal(deliverables && deliverables.ok, false,
    '(d)/M4: the failing check is `deliverables`: ' + gate.stdout)
  assert.ok(String(deliverables.detail).includes('"task": "T1"') &&
            String(deliverables.detail).includes('a.txt'),
    '(d)/M4: and it fails on the parked task\'s own files: ' + deliverables.detail)
  const deferredAcks = (verdict.acks || []).filter((a) => a.type === 'deferred:plan-defect')
  assert.equal(deferredAcks.length, 1,
    '(d)/M4: exactly one ack typed `deferred:plan-defect`: ' + gate.stdout)
  assert.ok(String(deferredAcks[0].detail).includes(PARK_CONCERN),
    '(d)/M4: whose detail carries the concern\'s text: ' + deferredAcks[0].detail)
  // The leg reads `acks` deep-equal to ['deferred:plan-defect']; the frozen
  // gate also acks `coverage` here, because M3's own numbers (1 of 2 tasks
  // merged) make `coverage.complete` false and gate_check.py's coverage ack is
  // unconditional on that. The full list is asserted as it must be, rather
  // than the leg's literal one, so the check stays live and honest.
  assert.deepEqual((verdict.acks || []).map((a) => a.type), ['coverage', 'deferred:plan-defect'],
    '(d)/M4: the ack list is the coverage ack M3\'s numbers force plus the park\'s: ' + gate.stdout)
}

// ── (e) [M5] a `plan-defect:` naming no leg label buys the fix round, as at BASE
{
  const r = examConcernRun({
    name: 'ar8', exam: IMPOSSIBLE_EXAM, concerns: [UNLABELLED_CONCERN],
    // The repair round runs; the exam it cannot satisfy stays red.
    fix: (cwd) => fs.writeFileSync(path.join(cwd, 'a.txt'), 'repaired\n'),
  })
  const report = await r.run()
  assert.deepEqual(r.calls.filter((l) => l.startsWith('fix:')), ['fix:T1:0'],
    '(e)/M5: a `plan-defect:` with no `(<letter>)` in it is not a leg — the pre-review ' +
    'repair round is dispatched exactly as at BASE: ' + r.calls.join(','))
  const row = report.tasks.find((t) => t.task === 'T1')
  assert.equal('actor' in row, false,
    '(e)/M5: and the row carries no `actor` key at all: ' + JSON.stringify(row))
  assert.equal(row.reviewVerdict, 'proof-red',
    '(e)/M5: the BASE lane runs to its end — still red after the repair round: ' +
    JSON.stringify(row))
}

// ── (f) [M6] the same leg-labelled concern over a GREEN pre-review pass is not
// a park: the exam the implementer called impossible passed, so the reply is a
// concern like any other and the task is reviewed and merged.
{
  const r = examConcernRun({
    name: 'ar9', exam: REACHABLE_EXAM, concerns: [PARK_CONCERN], review: passReview,
  })
  const report = await r.run()
  assert.deepEqual(r.calls.filter((l) => l.startsWith('fix:')), [],
    '(f)/M6: a green pre-review pass dispatches no `fix:T1:0`: ' + r.calls.join(','))
  assert.deepEqual(r.calls.filter((l) => l.startsWith('review:')), ['review:T1:1'],
    '(f)/M6: it proceeds to `review:T1:1`: ' + r.calls.join(','))
  const row = report.tasks.find((t) => t.task === 'T1')
  assert.equal(row.status, 'done', '(f)/M6: a PASS review ends `done`: ' + JSON.stringify(row))
  assert.equal('actor' in row, false,
    '(f)/M6: with no `actor` key — the park fires on the red exam, not on the prefix: ' +
    JSON.stringify(row))
  assert.deepEqual(report.deferredVerification, [],
    '(f)/M6: and nothing is deferred to the gate: ' + JSON.stringify(report.deferredVerification))
}

// ── (g) [M7] the `ar6` block above is unchanged and still holds: a task that
// ended `fix-loop-exhausted` contributes no deferredVerification item. The new
// lane records its own parked task beside that loop rather than widening it.

// ── (h) [M8] the two documents the park is written into ──────────────────────
{
  const ROOT = fileURLToPath(new URL('../..', import.meta.url))
  const IMPL_MD = path.join(ROOT, 'fleet/roles/implementer.md')
  const RF_MD = path.join(ROOT, 'skills/ultrapowers/references/report-format.md')
  const implText = fs.readFileSync(IMPL_MD, 'utf8')
  const rfText = fs.readFileSync(RF_MD, 'utf8')

  // implementer.md: the shape lives in the judgment-rules paragraph, beside the
  // `plan-defect:` disclosure rule it extends — not merely somewhere in the file.
  const judgment = implText.split(/\n\s*\n/).filter((p) => p.startsWith('Judgment rules:'))
  assert.equal(judgment.length, 1,
    '(h)/M8: implementer.md has exactly one `Judgment rules:` paragraph: ' + judgment.length)
  assert.ok(judgment[0].includes('plan-defect: leg ('),
    '(h)/M8: which names the concern\'s shape with the literal `plan-defect: leg (`: ' +
    judgment[0])
  assert.ok(judgment[0].includes('naming the leg by its label'),
    '(h)/M8: and carries the phrase `naming the leg by its label`: ' + judgment[0])

  const rows = (prefix) => rfText.split('\n').filter((l) => l.startsWith(prefix))
  // report-format.md: still exactly ONE reviewVerdict row (the pin
  // test_run_engine_exam_fix_edit.mjs leg (f) reads), now naming the verdict,
  // and still carrying the 2026-09-02 sentence a lost edit would drop.
  const verdictRows = rows('| `tasks[].reviewVerdict` |')
  assert.equal(verdictRows.length, 1,
    '(h)/M8: exactly one `| `tasks[].reviewVerdict` |` row: ' + verdictRows.length)
  assert.ok(verdictRows[0].includes('plan-defect'),
    '(h)/M8: which names the `plan-defect` verdict: ' + verdictRows[0])
  assert.ok(verdictRows[0].includes(
    'An edited exam is never a verdict of its own: it is recorded under `examEdited` and reviewed (2026-09-02).'),
    '(h)/M8: and still carries the 2026-09-02 sentence verbatim: ' + verdictRows[0])
  // The one new row key.
  const actorRows = rows('| `tasks[].actor` |')
  assert.equal(actorRows.length, 1,
    '(h)/M8: exactly one `| `tasks[].actor` |` row: ' + actorRows.length)
  assert.ok(actorRows[0].includes('plan'),
    '(h)/M8: which names `plan`: ' + actorRows[0])
  // The deferredVerification row names the parked task's item — until now it
  // said a plan-defect item sits on tasks whose final `status` is `done`, which
  // the parked row is the one exception to.
  const dvRows = rows('| `deferredVerification` |')
  assert.equal(dvRows.length, 1,
    '(h)/M8: exactly one `| `deferredVerification` |` row: ' + dvRows.length)
  assert.ok(/park|failed/i.test(dvRows[0]) && dvRows[0].includes('actor'),
    '(h)/M8: which names the parked task\'s item — the `done`-only clause no longer ' +
    'reads as the whole rule: ' + dvRows[0])

  // The Proof's two `Run:` greps, run as the Proof runs them: exit 0 on the
  // documents as written, and non-zero on a document that lost any one pin.
  const q = (p) => JSON.stringify(p)
  const IMPL_GREP = (p) => 'grep -q \'plan-defect: leg (\' ' + q(p) +
    ' && grep -q \'naming the leg by its label\' ' + q(p)
  const RF_GREP = (p) => [
    'test "$(grep -c \'tasks\\[\\]\\.reviewVerdict\' ' + q(p) + ')" = 1',
    'grep \'tasks\\[\\]\\.reviewVerdict\' ' + q(p) + ' | grep -q \'plan-defect\'',
    'grep \'tasks\\[\\]\\.actor\' ' + q(p) + ' | grep -q \'plan\'',
    'grep \'deferredVerification. | no |\' ' + q(p) + ' | grep -q \'actor\'',
  ].join(' && ')
  const sh = (cmd) => spawnSync('bash', ['-c', cmd], { encoding: 'utf8' }).status
  assert.equal(sh(IMPL_GREP(IMPL_MD)), 0,
    '(h)/M8: the implementer.md grep exits 0 on the document as written')
  assert.equal(sh(RF_GREP(RF_MD)), 0,
    '(h)/M8: the report-format.md grep chain exits 0 on the document as written')

  // The negatives: each grep is discriminating, so a document that lost a pin
  // fails the Proof rather than passing it quietly.
  const docs = path.join(tmp, 'docs-h')
  fs.mkdirSync(docs, { recursive: true })
  const mutate = (base, name, fn) => {
    const p = path.join(docs, name)
    fs.writeFileSync(p, fn(fs.readFileSync(base, 'utf8')))
    return p
  }
  const lines = (t) => t.split('\n')
  assert.notEqual(sh(IMPL_GREP(mutate(IMPL_MD, 'impl-no-shape.md',
    (t) => t.split('plan-defect: leg (').join('plan-defect: leg ')))), 0,
    '(h)/M8: an implementer.md without `plan-defect: leg (` exits non-zero')
  assert.notEqual(sh(IMPL_GREP(mutate(IMPL_MD, 'impl-no-phrase.md',
    (t) => t.split('naming the leg by its label').join('named somehow')))), 0,
    '(h)/M8: an implementer.md without `naming the leg by its label` exits non-zero')
  assert.notEqual(sh(RF_GREP(mutate(RF_MD, 'rf-two-verdict-rows.md', (t) =>
    lines(t).flatMap((l) => (l.startsWith('| `tasks[].reviewVerdict` |') ? [l, l] : [l])).join('\n')))), 0,
    '(h)/M8: a report-format.md with two reviewVerdict rows exits non-zero')
  assert.notEqual(sh(RF_GREP(mutate(RF_MD, 'rf-no-verdict-name.md', (t) =>
    lines(t).map((l) => (l.startsWith('| `tasks[].reviewVerdict` |')
      ? l.split('plan-defect').join('plan-issue') : l)).join('\n')))), 0,
    '(h)/M8: a reviewVerdict row that does not name `plan-defect` exits non-zero')
  assert.notEqual(sh(RF_GREP(mutate(RF_MD, 'rf-no-actor-row.md', (t) =>
    lines(t).filter((l) => !l.includes('tasks[].actor')).join('\n')))), 0,
    '(h)/M8: a report-format.md with no actor row exits non-zero')
  assert.notEqual(sh(RF_GREP(mutate(RF_MD, 'rf-dv-no-actor.md', (t) =>
    lines(t).map((l) => (l.startsWith('| `deferredVerification` |')
      ? l.split('actor').join('owner') : l)).join('\n')))), 0,
    '(h)/M8: a deferredVerification row that does not say `actor` exits non-zero')
}

console.log('ALL TESTS PASSED')
