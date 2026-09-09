// fleet/tests/test_run_engine_review_pair.mjs — two run-47 reads (2026-09-01):
//   1. the adversarial reviewer pair runs CONCURRENTLY — same patch, same
//      prompt, no dependency between them; six serial calls were 26 of 79 min.
//   2. round-2 reviewers are handed round-1's minor findings, and the task's
//      notes carry the union — three of six reviewers re-found one advisory
//      the report already held and no fix round was ever asked to act on.
// and, since #729 ("the engine runs the referee before any reviewer"), a third:
//   3. the pair rule — a round whose patch the driver's own arithmetic already
//      graded blocking, and whose `fix:<id>:0` round already answered it, buys
//      one reviewer instead of two.
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

// ── 5. the pair rule: the referee buys the second reviewer back ─────────────
// "The engine runs the referee before any reviewer" (#729, M7). A pair exists
// to find what one read misses. When the driver's own arithmetic already named
// a blocking defect in this patch and a `fix:T1:0` round already answered it,
// the patch has been read twice before a reviewer saw it — so round 1 of that
// task buys ONE reviewer, and the run reports the round it did not buy.
//
// The finding is a real one, minted by the real referee from the real captured
// patch: T1 writes T2.txt, a path its wave sibling owns and its own FILES do
// not, which is `footprint` blocking with actor `implementer`.
const pairWave = () => [[
  { id: 'T1', title: 't1', files: ['T1.txt'], tier: 'standard', review: 'adversarial',
    writes: ['T1.txt'], commutes: [], body: 'sim task T1' },
  { id: 'T2', title: 't2', files: ['T2.txt'], tier: 'standard', review: 'adversarial',
    writes: ['T2.txt'], commutes: [], body: 'sim task T2' },
]]
const pairRun = async (name, { trespass }) => {
  const repo = makeRepo(path.join(tmp, name))
  const labels = []
  const prompts = {}
  const stub = (prompt, opts, cwd) => {
    labels.push(opts.label)
    prompts[opts.label] = prompt
    const id = opts.label.split(':')[1]
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') {
      fs.writeFileSync(path.join(cwd, id + '.txt'), 'v1\n')
      // T1 also writes the sibling's file — the referee's blocking finding.
      if (id === 'T1' && trespass) fs.writeFileSync(path.join(cwd, 'T2.txt'), 'trespass\n')
      return doneImpl(cwd)
    }
    if (kind === 'fix') {
      fs.rmSync(path.join(cwd, 'T2.txt'), { force: true })
      fs.writeFileSync(path.join(cwd, id + '.txt'), 'v2\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected: ' + opts.label)
  }
  const { run } = rig({ repo, runDir: path.join(tmp, name + '-run'), waves: pairWave(),
                        stub, stamp: name })
  return { report: await run(), labels, prompts }
}
{
  // T1's patch trespasses and is repaired; T2's is clean throughout. One run,
  // both rules, and the difference between them is the referee's finding.
  const { report, labels, prompts } = await pairRun('r5', { trespass: true })
  const t1 = report.tasks.find((t) => t.task === 'T1')
  assert.equal(t1.status, 'done', 'sim precondition: the repaired task merged: ' + t1.notes)
  assert.equal(t1.proofFixes, 1, 'the referee\'s blocking finding bought the pre-review round')
  assert.ok(labels.indexOf('fix:T1:0') !== -1, 'the fix round ran: ' + labels.join(','))
  assert.match(prompts['fix:T1:0'],
    /Blocking issues to resolve:\n- path owned by a wave sibling and absent from FILES: `T2\.txt`/,
    'the fix round is handed the referee\'s detail verbatim: ' + prompts['fix:T1:0'].slice(-400))

  // T1: exactly one reviewer, and its label carries no pass suffix.
  assert.deepEqual(labels.filter((l) => l.startsWith('review:T1')), ['review:T1:1'],
    'a repaired pair task buys one reviewer, labelled without a pass suffix: ' + labels.join(','))
  // T2: untouched by any referee finding, so the pair stands.
  assert.deepEqual(labels.filter((l) => l.startsWith('review:T2')),
    ['review:T2:1:1', 'review:T2:1:2'],
    'a task the referee cleared still buys both reviewers: ' + labels.join(','))

  const eco = report.reviewEconomy
  assert.equal(eco.pairRounds, 1, 'only the two-reviewer round is a pair round: ' + JSON.stringify(eco))
  assert.equal(eco.refereeSkippedPairs, 1,
    'and the round the referee bought back is counted once: ' + JSON.stringify(eco))
  assert.ok(eco.refereeBlocking >= 1, 'the blocking finding is tallied: ' + JSON.stringify(eco))
}
{
  // The control: the same wave with nothing for the referee to find. No fix
  // round, no skipped pair, and both tasks buy two reviewers each.
  const { report, labels } = await pairRun('r6', { trespass: false })
  assert.deepEqual(labels.filter((l) => l.startsWith('review:')).sort(),
    ['review:T1:1:1', 'review:T1:1:2', 'review:T2:1:1', 'review:T2:1:2'],
    'a clean run dispatches the full pair for both tasks: ' + labels.join(','))
  assert.ok(labels.every((l) => !l.startsWith('fix:')), 'and no fix round: ' + labels.join(','))
  const eco = report.reviewEconomy
  assert.equal(eco.pairRounds, 2, 'two pair rounds: ' + JSON.stringify(eco))
  assert.equal(eco.refereeSkippedPairs, 0, 'and none bought back: ' + JSON.stringify(eco))
  assert.equal(eco.refereeBlocking, 0, 'nothing blocking was found: ' + JSON.stringify(eco))
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log('ALL TESTS PASSED')
