// fleet/tests/test_run_engine_reconcile.mjs — the post-fold suite repair (the
// spec's named addition): a red candidate dispatches the reconcile JUDGMENT
// agent (it edits files only; the driver commits and re-runs the suite), and
// exhaustion restores prevHead and blocks the wave as TEST_FAILED.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { makeRepo, rig, gitSync, passReview, cleanCritic, doneImpl } from './_engine_helpers.mjs'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-rec-'))
const waves = () => [[{
  id: 'T1', title: 'breaks the suite', files: ['T1.txt'], tier: 'standard', review: 'lean',
  writes: ['T1.txt'], commutes: [], body: 'task T1',
}]]

// ── 1. red candidate → reconcile fixes → driver commits → MERGED ────────────
{
  const repo = makeRepo(path.join(tmp, 'r1'))
  let reconciled = false
  const stub = (prompt, opts, cwd) => {
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') {
      // Real content plus the BROKEN marker check.sh fails on — a composition
      // seam the per-task review (canned PASS here) did not catch.
      fs.writeFileSync(path.join(cwd, 'T1.txt'), 'useful work\n')
      fs.writeFileSync(path.join(cwd, 'BROKEN'), 'oops\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    if (kind === 'reconcile') {
      reconciled = true
      assert.ok(/Failing output:/.test(prompt), 'the reconcile brief carries the failing output')
      // Judgment only: fix by editing the tree — no git (the driver commits).
      fs.rmSync(path.join(cwd, 'BROKEN'))
      return { status: 'FIXED', summary: 'removed the BROKEN marker' }
    }
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected: ' + opts.label)
  }
  const { run, integ } = rig({ repo, runDir: path.join(tmp, 'run1'), waves: waves(), stub, stamp: 'rc1' })
  const report = await run()
  assert.ok(reconciled, 'the reconcile agent was dispatched')
  assert.equal(report.waveMerges[0].status, 'MERGED', JSON.stringify(report.judgmentCalls))
  assert.equal(report.tests.passed, true)
  assert.ok(report.judgmentCalls.some((j) => j.includes('adopted after reconcile')))
  const tip = gitSync(['rev-parse', 'ultra/integration-rc1'], integ)
  assert.equal(tip, report.waveMerges[0].headSha)
  assert.equal(gitSync(['show', tip + ':T1.txt'], integ), 'useful work')
  // The BROKEN marker is gone from the adopted tree.
  const files = gitSync(['ls-tree', '--name-only', tip], integ).split('\n')
  assert.ok(!files.includes('BROKEN'))
  assert.equal(report.gitVerified, true)
}

// ── 2. reconcile BLOCKED → prevHead restored → TEST_FAILED + cascade ────────
{
  const repo = makeRepo(path.join(tmp, 'r2'))
  const stub = (prompt, opts, cwd) => {
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') {
      fs.writeFileSync(path.join(cwd, 'T1.txt'), 'work\n')
      fs.writeFileSync(path.join(cwd, 'BROKEN'), 'oops\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    if (kind === 'reconcile') return { status: 'BLOCKED', summary: 'not fixable here' }
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected: ' + opts.label)
  }
  const twoWaves = waves().concat([[{ id: 'T2', title: 'later', files: ['T2.txt'],
    tier: 'standard', review: 'lean', writes: ['T2.txt'], commutes: [], body: 'task T2' }]])
  const { run, integ, base } = rig({ repo, runDir: path.join(tmp, 'run2'),
    waves: twoWaves, edges: [], stub, stamp: 'rc2' })
  const report = await run()
  assert.equal(report.waveMerges[0].status, 'TEST_FAILED')
  assert.ok(report.blockedWaves.length === 1)
  assert.ok(report.unfinished.some((u) => u.includes('cascade-blocked')), JSON.stringify(report.unfinished))
  // The integration branch is back at the run base — nothing red was adopted.
  assert.equal(gitSync(['rev-parse', 'ultra/integration-rc2'], integ), base)
  assert.equal(report.gitVerified, false)
  assert.equal(report.tests.passed, false)
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log('ALL TESTS PASSED')
