// Exam for Task 1 of the referee-deletion plan (#911): the engine's pre-review
// pass is the `Run:`/`Check:`/exam pass again, a `peer` task always buys both
// reviewers, and no prompt carries a driver block over the patch's footprint.
//
// The legs, in the Proof's own words:
//   (b) [M2] a two-task `peer` wave in which `impl:T1` writes `T1.txt` AND its
//       sibling's `T2.txt`: no label starts `fix:`, the `review:T1` labels are
//       exactly `['review:T1:1:1', 'review:T1:1:2']`, T1's row is `done` with
//       `proofFixes: 0`, `<runDir>/referee` does not exist, and no captured
//       prompt contains `REFEREE:`.
//   (c) [M3] `Object.keys(report.reviewEconomy).sort()` is exactly the five
//       names — a sixth key, or a missing one, fails.
//   (d) [M4] a `peer` task with `proofRuns: ['test -e fixed.txt']` whose
//       `fix:T1:0` stub writes `fixed.txt`: the labels carry `fix:T1:0` exactly
//       once, then both `review:T1:1:1` and `review:T1:1:2`, and the row is
//       `done` with `proofFixes: 1`.
//
// The rig is `_engine_helpers.mjs`: real git, real clones at BASE, real patch
// capture, the real fold; only the agent seam is canned. It lands under
// `fleet/tests/exams/<slug>/`, so the helpers are two levels up.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { makeRepo, rig, passReview, cleanCritic, doneImpl } from '../../_engine_helpers.mjs'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reviewer-prompt-'))

const ECONOMY_KEYS = ['blockingFindings', 'blockingPerReviewerMinute', 'pairRounds',
                      'r2MarginalBlocking', 'reviewerMs']

const peerTask = (id, over = {}) => ({
  id, title: 't' + id, files: [id + '.txt'], tier: 'standard', review: 'peer',
  writes: [id + '.txt'], commutes: [], body: 'sim task ' + id, ...over,
})

// One run: a stub that records every label and prompt, implements by writing
// the task's own file (and, for T1 when asked, the sibling's), repairs by
// writing whatever `onFix` says, and passes every review.
const drive = async (name, { waves, onImpl, onFix }) => {
  const repo = makeRepo(path.join(tmp, name))
  const runDir = path.join(tmp, name + '-run')
  const labels = []
  const prompts = {}
  const stub = (prompt, opts, cwd) => {
    labels.push(opts.label)
    prompts[opts.label] = prompt
    const [kind, id] = opts.label.split(':')
    if (kind === 'impl') { onImpl(id, cwd); return doneImpl(cwd) }
    if (kind === 'fix') { onFix(id, cwd); return doneImpl(cwd) }
    if (kind === 'review') return passReview()
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected: ' + opts.label)
  }
  const { run } = rig({ repo, runDir, waves, stub, stamp: name })
  const report = await run()
  return { report, labels, prompts, runDir }
}

// ── (b) a patch outside FILES goes straight to review, and the pair stands [M2]
{
  const { report, labels, prompts, runDir } = await drive('trespass', {
    waves: [[peerTask('T1'), peerTask('T2')]],
    onImpl: (id, cwd) => {
      fs.writeFileSync(path.join(cwd, id + '.txt'), 'v1\n')
      // T1 also writes the sibling's file — the footprint the reviewers, not
      // the driver, now own.
      if (id === 'T1') fs.writeFileSync(path.join(cwd, 'T2.txt'), 'v1\n')
    },
    onFix: () => { throw new Error('no fix round may be dispatched') },
  })
  const t1 = report.tasks.find((t) => t.task === 'T1')
  assert.ok(t1, '(b) [M2] T1 has a row: ' + JSON.stringify(report.tasks))
  assert.equal(t1.status, 'done', '(b) [M2] T1 merges: ' + t1.notes)
  assert.equal(t1.proofFixes, 0, '(b) [M2] nothing bought a pre-review round: ' + JSON.stringify(t1))
  assert.ok(labels.every((l) => !l.startsWith('fix:')),
    '(b) [M2] no label starts fix: — the driver does not send a stray footprint to a fix round: ' +
    labels.join(','))
  assert.deepEqual(labels.filter((l) => l.startsWith('review:T1')), ['review:T1:1:1', 'review:T1:1:2'],
    '(b) [M2] a peer task buys both reviewers: ' + labels.join(','))
  assert.ok(!fs.existsSync(path.join(runDir, 'referee')),
    '(b) [M2] the run directory carries no referee/ record')
  for (const [label, p] of Object.entries(prompts)) {
    assert.ok(!String(p).includes('REFEREE:'), '(b) [M2] ' + label + ' carries no REFEREE: block')
  }

  // ── (c) the report's reviewEconomy is exactly five keys [M3] ──────────────
  assert.equal(typeof report.reviewEconomy, 'object', '(c) [M3] reviewEconomy is an object')
  assert.deepEqual(Object.keys(report.reviewEconomy).sort(), ECONOMY_KEYS,
    '(c) [M3] reviewEconomy carries exactly the five keys: ' + JSON.stringify(report.reviewEconomy))
}

// ── (d) a red Run: still buys one fix round, then the pair [M4] ──────────────
{
  const { report, labels } = await drive('proofrun', {
    waves: [[peerTask('T1', { proofRuns: ['test -e fixed.txt'] })]],
    onImpl: (id, cwd) => fs.writeFileSync(path.join(cwd, id + '.txt'), 'v1\n'),
    onFix: (id, cwd) => fs.writeFileSync(path.join(cwd, 'fixed.txt'), 'fixed\n'),
  })
  const t1 = report.tasks.find((t) => t.task === 'T1')
  assert.equal(t1.status, 'done', '(d) [M4] the repaired task merges: ' + t1.notes)
  assert.equal(t1.proofFixes, 1, '(d) [M4] the red Run: bought one round: ' + JSON.stringify(t1))
  assert.equal(labels.filter((l) => l === 'fix:T1:0').length, 1,
    '(d) [M4] fix:T1:0 is dispatched exactly once: ' + labels.join(','))
  assert.equal(labels.filter((l) => l.startsWith('fix:')).length, 1,
    '(d) [M4] and no other fix round: ' + labels.join(','))
  const fixAt = labels.indexOf('fix:T1:0')
  const r1 = labels.indexOf('review:T1:1:1')
  const r2 = labels.indexOf('review:T1:1:2')
  assert.ok(r1 > fixAt && r2 > fixAt, '(d) [M4] both reviewers follow the fix round: ' + labels.join(','))
  assert.deepEqual(labels.filter((l) => l.startsWith('review:T1')), ['review:T1:1:1', 'review:T1:1:2'],
    '(d) [M4] a repaired peer task still buys both reviewers: ' + labels.join(','))
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log('ALL TESTS PASSED')
