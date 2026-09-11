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
import { makeRepo, rig, passReview, cleanCritic, doneImpl } from './_engine_helpers.mjs'
import { priorAdvisoriesBlock } from '../run-engine.mjs'

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

fs.rmSync(tmp, { recursive: true, force: true })
console.log('ALL TESTS PASSED')
