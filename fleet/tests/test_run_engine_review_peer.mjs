// fleet/tests/test_run_engine_review_peer.mjs — `peer` is the documented name
// for the concurrent reviewer pair (#556). `adversarial` stays accepted as the
// legacy spelling (pinned by test_run_engine_review_pair.mjs); this file pins
// that `peer` selects the same pair, on the task and run-wide, and that an
// unrecognized value still draws the judgment call.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { makeRepo, rig, passReview, cleanCritic, doneImpl } from './_engine_helpers.mjs'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-peer-'))
const task = (review) => [[{
  id: 'T1', title: 't', files: ['T1.txt'], tier: 'standard', review,
  writes: ['T1.txt'], commutes: [], body: 'sim task T1',
}]]

// The review_pair deadlock shape: reviewer 1 resolves only after reviewer 2
// started, so a sequential pair hangs instead of going quietly green.
const pairRig = ({ dir, waves, extraArgs, stamp }) => {
  const repo = makeRepo(path.join(tmp, dir))
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
  return { started, ...rig({ repo, runDir: path.join(tmp, dir + '-run'), waves, stub, extraArgs, stamp }) }
}

// ── 1. review: 'peer' on the task runs the pair, and draws no judgment call ──
{
  const { started, run } = pairRig({ dir: 'r1', waves: task('peer'), stamp: 'peer1' })
  const report = await run()
  assert.equal(report.tasks[0].status, 'done', 'sim precondition: the task merged')
  assert.deepEqual(started, ['review:T1:1:1', 'review:T1:1:2'],
    'peer must start both reviewers; a sequential pair would deadlock this sim')
  assert.deepEqual(report.judgmentCalls.filter((c) => c.includes('unknown review=')), [],
    'peer is a known review value — it must draw no unknown-review judgment call')
}

// ── 2. args.reviewProfile: 'peer' selects the pair run-wide ─────────────────
{
  const { started, run } = pairRig({
    dir: 'r2', waves: task('lean'), extraArgs: { reviewProfile: 'peer' }, stamp: 'peer2',
  })
  const report = await run()
  assert.equal(report.tasks[0].status, 'done')
  assert.deepEqual(started, ['review:T1:1:1', 'review:T1:1:2'],
    'reviewProfile: peer must select the pair for a task marked lean')
  assert.deepEqual(report.judgmentCalls.filter((c) => c.includes('unknown review=')), [])
}

// ── 3. an unrecognized value still records the judgment call ────────────────
{
  const repo = makeRepo(path.join(tmp, 'r3'))
  const started = []
  const stub = (prompt, opts, cwd) => {
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') { fs.writeFileSync(path.join(cwd, 'T1.txt'), 'v1\n'); return doneImpl(cwd) }
    if (kind === 'review') { started.push(opts.label); return passReview() }
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected: ' + opts.label)
  }
  const { run } = rig({ repo, runDir: path.join(tmp, 'r3-run'), waves: task('wat'), stub, stamp: 'peer3' })
  const report = await run()
  assert.equal(report.tasks[0].status, 'done')
  assert.deepEqual(started, ['review:T1:1'], 'an unknown value falls back to the lean default')
  assert.deepEqual(report.judgmentCalls,
    ['task T1: unknown review="wat" — fell back to the run default (lean)'])
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log('ALL TESTS PASSED')
