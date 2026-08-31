// fleet/tests/test_run_engine_shallow.mjs — the depth-1 leg (#465).
//
// Run-32 gated green and CI went red: the sandbox clone carries full history,
// `actions/checkout@v4` defaults to fetch-depth 1, and git reports a shallow
// boundary commit as introducing every file. The leg re-runs the suite on a
// depth-1 clone of the integration branch so that divergence is a gate finding
// instead of a post-merge surprise.
//
// The sim's oracle is a history-coupled suite: `git rev-list --count HEAD > 1`
// is true in any full clone of this repo and false at depth 1 — the smallest
// faithful stand-in for `git log -- <path>` collapsing on a shallow boundary.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { makeRepo, rig, gitSync, passReview, cleanCritic, doneImpl } from './_engine_helpers.mjs'

const HISTORY_COUPLED = '#!/bin/bash\n[ "$(git rev-list --count HEAD)" -gt 1 ]\n'

const wavesFor = (id) => [[{ id, title: 'create ' + id, files: [id + '.txt'], tier: 'standard',
  review: 'lean', writes: [id + '.txt'], commutes: [], body: 'sim task ' + id }]]

const stubFor = (id) => (prompt, opts, cwd) => {
  const kind = opts.label.split(':')[0]
  if (kind === 'impl') {
    fs.writeFileSync(path.join(cwd, id + '.txt'), 'from ' + id + '\n')
    return doneImpl(cwd)
  }
  if (kind === 'review') return passReview()
  if (opts.label === 'integration') return cleanCritic()
  throw new Error('unexpected dispatch: ' + opts.label)
}

// A repo with more than one commit at BASE, so the full-clone suite is green
// before the run starts (a red baseline would change the run's shape).
function twoCommitRepo(dir, checkScript) {
  makeRepo(dir, checkScript ? { 'check.sh': checkScript } : {})
  fs.writeFileSync(path.join(dir, 'b.txt'), 'second\n')
  gitSync(['add', '-A'], dir)
  gitSync(['commit', '-q', '-m', 'second'], dir)
  return dir
}

// ── 1. a history-coupled suite: green on the full clone, RED at depth 1 ──────
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-shallow-red-'))
  const repo = twoCommitRepo(path.join(tmp, 'repo'), HISTORY_COUPLED)
  const { run } = rig({ repo, runDir: path.join(tmp, 'run'), waves: wavesFor('T1'),
                        stub: stubFor('T1'), stamp: 'shallowred' })
  const report = await run()

  assert.equal(report.baseline.passed, true, 'the full-clone baseline is green')
  assert.equal(report.tests.passed, true,
    'the driver\'s full-clone suite really passed: ' + report.tests.output)
  assert.ok(report.shallowSuite, 'the leg ran on a green adopted tree')
  assert.equal(report.shallowSuite.depth, 1)
  assert.equal(report.shallowSuite.command, 'bash check.sh')
  assert.equal(report.shallowSuite.passed, false,
    'the same suite fails on a depth-1 clone — the merge target does not reproduce the green')

  // The gate channel: a red leg is a `manual` ack, which run-main's ackDecision
  // does NOT pre-authorize, so the run parks on real evidence. It must not
  // silently rewrite `tests`, which describes the full-clone run.
  const manual = report.deferredVerification.filter((d) => d.reason === 'manual')
  assert.equal(manual.length, 1, 'exactly one manual deferral: ' +
    JSON.stringify(report.deferredVerification))
  assert.ok(manual[0].deliverable.includes('depth-1 clone of ultra/integration-shallowred'))
  assert.ok(/fetch-depth 1/.test(manual[0].why), 'the ack says why CI will disagree')
  assert.ok(report.judgmentCalls.some((j) => j.startsWith('depth-1 leg:')),
    'the divergence is also on the judgment record')
}

// ── 2. a depth-agnostic suite: the leg runs and agrees, adding no ack ────────
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-shallow-green-'))
  const repo = twoCommitRepo(path.join(tmp, 'repo'), null)
  const { run } = rig({ repo, runDir: path.join(tmp, 'run'), waves: wavesFor('T2'),
                        stub: stubFor('T2'), stamp: 'shallowgreen' })
  const report = await run()

  assert.equal(report.tests.passed, true)
  assert.equal(report.shallowSuite.passed, true, 'a suite that does not read history agrees')
  assert.deepEqual(report.deferredVerification, [], 'a green leg adds no ack')
  assert.ok(!report.judgmentCalls.some((j) => j.startsWith('depth-1 leg:')),
    'a green leg is silent on the judgment record')
}

// ── 3. the leg is a real depth-1 clone, not a second full one ───────────────
// `git clone --depth` is IGNORED on a plain local path (it hardlinks the whole
// object store), so the `file://` form is load-bearing: without it the leg
// would certify a full clone and always agree with `tests`.
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-shallow-tree-'))
  const repo = twoCommitRepo(path.join(tmp, 'repo'), null)
  const runDir = path.join(tmp, 'run')
  const { run } = rig({ repo, runDir, waves: wavesFor('T3'), stub: stubFor('T3'),
                        stamp: 'shallowtree' })
  await run()
  const shallow = path.join(runDir, 'shallow')
  assert.ok(fs.existsSync(path.join(shallow, '.git', 'shallow')),
    'the leg cloned with a shallow boundary')
  assert.equal(gitSync(['rev-list', '--count', 'HEAD'], shallow), '1',
    'the leg\'s clone holds exactly one commit')
  assert.ok(fs.existsSync(path.join(shallow, 'T3.txt')),
    'and it is the integration branch tip, carrying the run\'s work')
}

// ── 4. the opt-out ──────────────────────────────────────────────────────────
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-shallow-off-'))
  const repo = twoCommitRepo(path.join(tmp, 'repo'), HISTORY_COUPLED)
  const runDir = path.join(tmp, 'run')
  const { run } = rig({ repo, runDir, waves: wavesFor('T4'), stub: stubFor('T4'),
                        stamp: 'shallowoff', extraArgs: { shallowLeg: false } })
  const report = await run()
  // strictEqual on purpose: a loose `== null` would also accept `undefined`,
  // which is what an engine WITHOUT the leg returns — a check that cannot fail.
  assert.strictEqual(report.shallowSuite, null, 'shallowLeg:false skips the leg')
  assert.deepEqual(report.deferredVerification, [])
  assert.ok(!fs.existsSync(path.join(runDir, 'shallow')), 'and clones nothing')
}

console.log('ALL TESTS PASSED')
