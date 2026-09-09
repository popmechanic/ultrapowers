// fleet/tests/test_run_engine_review_pair.mjs — two run-47 reads (2026-09-01):
//   1. the adversarial reviewer pair runs CONCURRENTLY — same patch, same
//      prompt, no dependency between them; six serial calls were 26 of 79 min.
//   2. round-2 reviewers are handed round-1's minor findings, and the task's
//      notes carry the union — three of six reviewers re-found one advisory
//      the report already held and no fix round was ever asked to act on.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { makeRepo, rig, passReview, cleanCritic, doneImpl } from '../../_engine_helpers.mjs'
import { priorAdvisoriesBlock } from '../../../run-engine.mjs'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-pair-'))
const task = (review) => [[{
  id: 'T1', title: 't', files: ['T1.txt'], tier: 'standard', review,
  writes: ['T1.txt'], commutes: [], body: 'sim task T1',
}]]

// ── 1. the pair overlaps: the first reviewer resolves only after the second started
{
  const repo = makeRepo(path.join(tmp, 'r1'))
  const started = []
  let releaseFirst
  const secondStarted = new Promise((resolve) => { releaseFirst = resolve })
  const stub = async (prompt, opts, cwd) => {
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') { fs.writeFileSync(path.join(cwd, 'T1.txt'), 'v1\n'); return doneImpl(cwd) }
    if (kind === 'review') {
      started.push(opts.label)
      if (opts.label === 'review:T1:1:1') { await secondStarted; return passReview() }
      if (opts.label === 'review:T1:1:2') { releaseFirst(); return passReview() }
    }
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected: ' + opts.label)
  }
  const { run } = rig({ repo, runDir: path.join(tmp, 'run1'), waves: task('adversarial'), stub, stamp: 'pr1' })
  const report = await run()
  assert.equal(report.tasks[0].status, 'done', 'sim precondition: the task merged')
  assert.deepEqual(started, ['review:T1:1:1', 'review:T1:1:2'],
    'both reviewers of the pair must start; a sequential pair would deadlock this sim')
  assert.equal(report.coverage.complete, true)
}

// ── 2. round 2 is told round 1's advisories; notes carry the union ──────────
{
  const repo = makeRepo(path.join(tmp, 'r2'))
  const prompts = {}
  const stub = (prompt, opts, cwd) => {
    prompts[opts.label] = prompt
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') { fs.writeFileSync(path.join(cwd, 'T1.txt'), 'v1\n'); return doneImpl(cwd) }
    if (kind === 'fix') { fs.writeFileSync(path.join(cwd, 'T1.txt'), 'v2 fixed\n'); return doneImpl(cwd) }
    if (opts.label === 'review:T1:1:1') {
      return { verdict: 'FIX_REQUIRED', issues: [
        { severity: 'blocking', detail: 'v1 is wrong' },
        { severity: 'minor', detail: 'm1: argv parsed twice' }] }
    }
    if (opts.label === 'review:T1:1:2') {
      return { verdict: 'PASS', issues: [{ severity: 'minor', detail: 'm2: orphaned siblings' }] }
    }
    if (opts.label === 'review:T1:2:1') {
      return { verdict: 'PASS', issues: [{ severity: 'minor', detail: 'm3: new in round 2' }] }
    }
    if (opts.label === 'review:T1:2:2') {
      // A reviewer that ignores the block and repeats m1: still recorded once.
      return { verdict: 'PASS', issues: [{ severity: 'minor', detail: 'm1: argv parsed twice' }] }
    }
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected: ' + opts.label)
  }
  const { run } = rig({ repo, runDir: path.join(tmp, 'run2'), waves: task('adversarial'), stub, stamp: 'pr2' })
  const report = await run()
  const t = report.tasks[0]
  assert.equal(t.status, 'done')
  assert.equal(t.reviewVerdict, 'fixed')
  assert.equal(t.fixIterations, 1)
  // Round 1 carries no advisories block — there is no prior round.
  assert.ok(!/PRIOR-ROUND ADVISORIES/.test(prompts['review:T1:1:1']), 'round 1 must not carry the block')
  assert.ok(!/PRIOR-ROUND ADVISORIES/.test(prompts['review:T1:1:2']), 'round 1 must not carry the block')
  // Round 2 carries both round-1 minors, for BOTH reviewers of the pair; the
  // blocking issue is the fix's business, not the block's.
  for (const label of ['review:T1:2:1', 'review:T1:2:2']) {
    const p = prompts[label]
    assert.match(p, /\nPRIOR-ROUND ADVISORIES \(/, label + ' lacks the advisories block')
    assert.ok(p.includes('\n- m1: argv parsed twice'), label + ' lacks m1')
    assert.ok(p.includes('\n- m2: orphaned siblings'), label + ' lacks m2')
    assert.ok(!/\n- v1 is wrong/.test(p.split('PRIOR-ROUND ADVISORIES')[1]), label + ' lists the blocking issue as an advisory')
    assert.match(p, /do not re-report them/, label + ' does not tell the reviewer what the block is for')
  }
  // The fix prompt is unchanged in kind: blocking issues only.
  assert.match(prompts['fix:T1:1'], /Blocking issues to resolve:\n- v1 is wrong/)
  assert.ok(!/PRIOR-ROUND ADVISORIES/.test(prompts['fix:T1:1']), 'the fix agent is not handed advisories')
  // Notes: the union across rounds, each advisory once, in first-seen order.
  assert.equal(t.notes, 'm1: argv parsed twice; m2: orphaned siblings; m3: new in round 2',
    'notes must carry every round\'s advisories once, not round 2\'s alone')
}

// ── 3. the lean profile: one reviewer, block only when there is something prior
{
  const repo = makeRepo(path.join(tmp, 'r3'))
  const prompts = {}
  let reviews = 0
  const stub = (prompt, opts, cwd) => {
    prompts[opts.label] = prompt
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') { fs.writeFileSync(path.join(cwd, 'T1.txt'), 'v1\n'); return doneImpl(cwd) }
    if (kind === 'fix') { fs.writeFileSync(path.join(cwd, 'T1.txt'), 'v2\n'); return doneImpl(cwd) }
    if (kind === 'review') {
      reviews += 1
      return reviews === 1
        ? { verdict: 'FIX_REQUIRED', issues: [{ severity: 'blocking', detail: 'v1 is wrong' }] }
        : passReview()
    }
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected: ' + opts.label)
  }
  const { run } = rig({ repo, runDir: path.join(tmp, 'run3'), waves: task('lean'), stub, stamp: 'pr3' })
  const report = await run()
  assert.equal(report.tasks[0].reviewVerdict, 'fixed')
  assert.equal(reviews, 2, 'lean = one reviewer per round')
  assert.ok(!/PRIOR-ROUND ADVISORIES/.test(prompts['review:T1:2']),
    'no round-1 minors means no block in round 2')
  assert.equal(report.tasks[0].notes, '', 'no advisories, empty notes')
}

// ── 4. the block as a pure function ─────────────────────────────────────────
{
  assert.equal(priorAdvisoriesBlock([]), '')
  assert.equal(priorAdvisoriesBlock(undefined), '')
  const out = priorAdvisoriesBlock([{ severity: 'minor', detail: 'a' }, { severity: 'minor', detail: 'b' }])
  assert.match(out, /^\nPRIOR-ROUND ADVISORIES \(/)
  assert.ok(out.endsWith('\n- a\n- b'))
}

// ── 5. the pair rule the mechanical referee buys (#729, Task 3) ─────────────
// M7 — the second reviewer of a pair is a hedge against the first missing
// something mechanical. When the driver's own pre-review pass ALREADY caught a
// blocking defect the implementer could act on, and the repair round answered
// it, that hedge has been bought: the round dispatches ONE reviewer, under the
// unsuffixed `review:<id>:<iter>` label, and `refereeSkippedPairs` counts it.
// Every other pair round is unchanged and counted by `pairRounds` as before —
// a clean pass, a referee `minor`, and a blocking finding whose actor is the
// `plan` (which no fix round was ever asked to answer) all still buy two.
{
  const refereeTask = (over = {}) => [[{
    id: 'T1', title: 't', files: ['T1.txt'], tier: 'standard', review: 'peer',
    writes: ['T1.txt'], commutes: [], proofTests: [], proofRuns: [],
    body: 'sim task T1', ...over,
  }]]
  const labelsOf = (calls, prefix) => calls.filter((l) => l.startsWith(prefix))

  // 5a. a referee `minor` is not a defect anyone was asked to repair: two.
  {
    const repo = makeRepo(path.join(tmp, 'r5a'))
    const calls = []
    const stub = (prompt, opts, cwd) => {
      calls.push(opts.label)
      const kind = opts.label.split(':')[0]
      if (kind === 'impl') {
        fs.writeFileSync(path.join(cwd, 'T1.txt'), 'v1\n')
        fs.writeFileSync(path.join(cwd, 'helper.txt'), 'helper\n')
        return doneImpl(cwd)
      }
      if (kind === 'review') return passReview()
      if (opts.label === 'integration') return cleanCritic()
      throw new Error('unexpected: ' + opts.label)
    }
    const { run } = rig({ repo, runDir: path.join(tmp, 'run5a'), waves: refereeTask(), stub, stamp: 'pr5a' })
    const report = await run()
    assert.equal(report.tasks[0].status, 'done',
      '[M7] sim precondition: an outside-FILES path is a minor and blocks nothing: ' +
      JSON.stringify(report.tasks[0]))
    assert.deepEqual(labelsOf(calls, 'review:'), ['review:T1:1:1', 'review:T1:1:2'],
      '[M7] a round the referee did not buy a repair for still dispatches the pair: ' +
      calls.join(','))
    assert.equal(report.reviewEconomy.pairRounds, 1,
      '[M7] and is counted as a pair round: ' + JSON.stringify(report.reviewEconomy))
    assert.equal(report.reviewEconomy.refereeSkippedPairs, 0,
      '[M7] with nothing skipped: ' + JSON.stringify(report.reviewEconomy))
  }

  // 5b. a blocking implementer finding, repaired: ONE reviewer, unsuffixed.
  {
    const repo = makeRepo(path.join(tmp, 'r5b'))
    const calls = []
    const stub = (prompt, opts, cwd) => {
      calls.push(opts.label)
      const kind = opts.label.split(':')[0]
      if (kind === 'impl') {
        fs.writeFileSync(path.join(cwd, 'T1.txt'), 'v1\n')
        fs.rmSync(path.join(cwd, 'a.txt'))
        return doneImpl(cwd)
      }
      if (kind === 'fix') {
        // Byte for byte what makeRepo committed, so the repaired patch carries
        // no hunk for a.txt at all.
        fs.writeFileSync(path.join(cwd, 'a.txt'), 'line1\nline2\nline3\n')
        return doneImpl(cwd)
      }
      if (kind === 'review') return passReview()
      if (opts.label === 'integration') return cleanCritic()
      throw new Error('unexpected: ' + opts.label)
    }
    const { run } = rig({ repo, runDir: path.join(tmp, 'run5b'), waves: refereeTask(), stub, stamp: 'pr5b' })
    const report = await run()
    assert.deepEqual(labelsOf(calls, 'fix:'), ['fix:T1:0'],
      '[M7] sim precondition: deleting a BASE file outside FILES is blocking, actor ' +
      'implementer, and bought the pre-review repair round: ' + calls.join(','))
    assert.deepEqual(labelsOf(calls, 'review:'), ['review:T1:1'],
      '[M7] the round the referee already graded dispatches ONE reviewer, under the same ' +
      'unsuffixed label a single reviewer has always carried: ' + calls.join(','))
    assert.equal(report.reviewEconomy.pairRounds, 0,
      '[M7] so no pair round is counted: ' + JSON.stringify(report.reviewEconomy))
    assert.equal(report.reviewEconomy.refereeSkippedPairs, 1,
      '[M7] and the skipped second reviewer is counted once: ' +
      JSON.stringify(report.reviewEconomy))
    assert.equal(report.tasks[0].status, 'done',
      '[M7] with the task merging on the surviving reviewer\'s PASS: ' +
      JSON.stringify(report.tasks[0]))
  }

  // 5c. a clean pass: unchanged, two.
  {
    const repo = makeRepo(path.join(tmp, 'r5c'))
    const calls = []
    const stub = (prompt, opts, cwd) => {
      calls.push(opts.label)
      const kind = opts.label.split(':')[0]
      if (kind === 'impl') { fs.writeFileSync(path.join(cwd, 'T1.txt'), 'v1\n'); return doneImpl(cwd) }
      if (kind === 'review') return passReview()
      if (opts.label === 'integration') return cleanCritic()
      throw new Error('unexpected: ' + opts.label)
    }
    const { run } = rig({ repo, runDir: path.join(tmp, 'run5c'), waves: refereeTask(), stub, stamp: 'pr5c' })
    const report = await run()
    assert.deepEqual(labelsOf(calls, 'review:'), ['review:T1:1:1', 'review:T1:1:2'],
      '[M7] a pass that found nothing bought no hedge, so the pair is unchanged: ' +
      calls.join(','))
    assert.equal(report.reviewEconomy.pairRounds, 1,
      '[M7] counted as a pair round: ' + JSON.stringify(report.reviewEconomy))
    assert.equal(report.reviewEconomy.refereeSkippedPairs, 0,
      '[M7] nothing skipped: ' + JSON.stringify(report.reviewEconomy))
  }

  // 5d. a blocking finding whose actor is the `plan`: two. Nobody was asked to
  // repair it, so nothing was verified on the driver's behalf.
  {
    const repo = makeRepo(path.join(tmp, 'r5d'))
    const calls = []
    const stub = (prompt, opts, cwd) => {
      calls.push(opts.label)
      const kind = opts.label.split(':')[0]
      if (kind === 'exam') return { status: 'DONE', summary: 'exam written' }
      if (kind === 'impl') { fs.writeFileSync(path.join(cwd, 'T1.txt'), 'v1\n'); return doneImpl(cwd) }
      if (kind === 'review') return passReview()
      if (opts.label === 'integration') return cleanCritic()
      throw new Error('unexpected: ' + opts.label)
    }
    const waves = refereeTask({
      proofTests: ['t1_test.sh'], testCmd: 'bash check.sh',
      body: '**Proof:**\n- Test: `t1_test.sh`\n- Legs: (a) T1.txt exists [M1]',
    })
    const { run } = rig({ repo, runDir: path.join(tmp, 'run5d'), waves, stub, stamp: 'pr5d' })
    const report = await run()
    assert.equal(calls.filter((l) => l.startsWith('fix:')).length, 0,
      '[M7] sim precondition: a `plan`-actor finding buys no repair round: ' + calls.join(','))
    assert.deepEqual(labelsOf(calls, 'review:'), ['review:T1:1:1', 'review:T1:1:2'],
      '[M7] so the pair still runs — the defect is in the plan, and the patch in front of ' +
      'the reviewers was never graded clean: ' + calls.join(','))
    assert.equal(report.reviewEconomy.pairRounds, 1,
      '[M7] counted as a pair round: ' + JSON.stringify(report.reviewEconomy))
    assert.equal(report.reviewEconomy.refereeSkippedPairs, 0,
      '[M7] and never as a skipped pair: ' + JSON.stringify(report.reviewEconomy))
  }
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log('ALL TESTS PASSED')
