// fleet/tests/test_run_engine_fixloop.mjs — the judgment-flow semantics ported
// from waves.js: the bounded fix loop (recover and exhaust), the infra-death
// barrier retry, and dependency cascade-blocking.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { makeRepo, rig, passReview, cleanCritic, doneImpl } from './_engine_helpers.mjs'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-fix-'))
const wavesOf = (ids) => ids.map((wave) => wave.map((id) => ({
  id, title: 't', files: [id + '.txt'], tier: 'standard', review: 'lean',
  writes: [id + '.txt'], commutes: [], body: 'sim task ' + id,
})))

// ── 1. fix loop recovers: FIX_REQUIRED → fix dispatch → PASS ────────────────
{
  const repo = makeRepo(path.join(tmp, 'r1'))
  let reviews = 0
  const labels = []
  const stub = (prompt, opts, cwd) => {
    labels.push(opts.label)
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') { fs.writeFileSync(path.join(cwd, 'T1.txt'), 'v1\n'); return doneImpl(cwd) }
    if (kind === 'fix') { fs.writeFileSync(path.join(cwd, 'T1.txt'), 'v2 fixed\n'); return doneImpl(cwd) }
    if (kind === 'review') {
      reviews += 1
      return reviews === 1
        ? { verdict: 'FIX_REQUIRED', issues: [{ severity: 'blocking', detail: 'v1 is wrong' }] }
        : passReview()
    }
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected: ' + opts.label)
  }
  const { run } = rig({ repo, runDir: path.join(tmp, 'run1'), waves: wavesOf([['T1']]), stub, stamp: 'fx1' })
  const report = await run()
  assert.equal(report.tasks[0].status, 'done')
  assert.equal(report.tasks[0].reviewVerdict, 'fixed')
  assert.equal(report.tasks[0].fixIterations, 1)
  assert.ok(labels.includes('fix:T1:1'), 'a fix round dispatched')
  assert.equal(report.coverage.complete, true)
  // The fix ran in the SAME tree and the cumulative capture carries it.
  assert.ok(fs.readFileSync(report.tasks[0].patch, 'utf8').includes('v2 fixed'))
}

// ── 2. fix loop exhausts: blocking issues twice → failed, wave skipped ──────
{
  const repo = makeRepo(path.join(tmp, 'r2'))
  const stub = (prompt, opts, cwd) => {
    const kind = opts.label.split(':')[0]
    if (kind === 'impl' || kind === 'fix') {
      fs.writeFileSync(path.join(cwd, 'T1.txt'), 'still wrong\n'); return doneImpl(cwd)
    }
    if (kind === 'review') return { verdict: 'FIX_REQUIRED', issues: [{ severity: 'blocking', detail: 'never right' }] }
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected: ' + opts.label)
  }
  const { run } = rig({ repo, runDir: path.join(tmp, 'run2'), waves: wavesOf([['T1']]), stub, stamp: 'fx2' })
  const report = await run()
  assert.equal(report.tasks[0].status, 'failed')
  assert.equal(report.tasks[0].reviewVerdict, 'fix-loop-exhausted')
  assert.equal(report.waveMerges[0].status, 'SKIPPED')
  assert.equal(report.coverage.tasks_merged, 0)
  assert.equal(report.gitVerified, false)
  assert.equal(report.tests.passed, false, 'no wave merged → tests cannot claim green')
}

// ── 3. infra-death parks and the barrier retry recovers it ──────────────────
{
  const repo = makeRepo(path.join(tmp, 'r3'))
  let implCalls = 0
  const stub = (prompt, opts, cwd) => {
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') {
      implCalls += 1
      if (implCalls === 1) return null // terminal overload → AGENT_NULL → park
      fs.writeFileSync(path.join(cwd, 'T1.txt'), 'recovered\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected: ' + opts.label)
  }
  const { run } = rig({ repo, runDir: path.join(tmp, 'run3'), waves: wavesOf([['T1']]), stub, stamp: 'fx3' })
  const report = await run()
  assert.equal(report.tasks.length, 1)
  assert.equal(report.tasks[0].status, 'done', JSON.stringify(report.tasks))
  assert.ok(report.judgmentCalls.some((j) => j.includes('recovered at the barrier retry')))
  assert.equal(report.coverage.complete, true)
}

// ── 4. a failed prerequisite cascade-blocks its dependents ──────────────────
{
  const repo = makeRepo(path.join(tmp, 'r4'))
  const stub = (prompt, opts, cwd) => {
    const kind = opts.label.split(':')[0]
    if (opts.label === 'impl:T1') return { status: 'BLOCKED', summary: 'cannot proceed', startHead: doneImpl(cwd).startHead }
    if (kind === 'impl') { fs.writeFileSync(path.join(cwd, opts.label.split(':')[1] + '.txt'), 'x\n'); return doneImpl(cwd) }
    if (kind === 'review') return passReview()
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected: ' + opts.label)
  }
  const { run } = rig({ repo, runDir: path.join(tmp, 'run4'),
    waves: wavesOf([['T1'], ['T2']]), edges: [['T1', 'T2']], stub, stamp: 'fx4' })
  const report = await run()
  assert.equal(report.tasks[0].status, 'failed')
  assert.ok(report.unfinished.some((u) => u.startsWith('T2:')), 'T2 blocked: ' + JSON.stringify(report.unfinished))
  assert.equal(report.waveMerges[0].status, 'SKIPPED')
  assert.ok(report.missingDeliverables.some((m) => m.task === 'T2'))
  assert.equal(report.coverage.tasks_merged, 0)
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log('ALL TESTS PASSED')
