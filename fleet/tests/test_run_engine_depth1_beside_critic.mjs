// fleet/tests/test_run_engine_depth1_beside_critic.mjs — the depth-1 leg runs
// BESIDE the completeness critic (#654, re-shaped 2026-09-05: "Overlap it with
// the critic").
//
// At BASE the two are serial: `phase('Depth-1 Leg')` clones the integration
// branch at depth 1, bootstraps it and runs the suite there; only when that
// returns does `phase('Integration Review')` dispatch the critic. Neither reads
// the other's result — the critic's inputs are `lastSuite`, the plan, the
// contracts and the integrated Run:/Check: evidence, while `shallowDeferred`
// and `shallowSuite` are consumed after both — so the ~1.5 min the leg costs is
// wall clock nobody is waiting on. The change is to start both and await both.
//
// The rig leaves `phase` a no-op, so the overlap is not observable from phase
// events. It is observed from the two seams the sim owns: the SUITE COMMAND
// (a check.sh that marks an order file only in a shallow repository) and the
// CRITIC STUB (which marks the same file when dispatched). The leg is on the
// path exactly when `critic` lands between the leg's start and its end.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { makeRepo, rig, gitSync, passReview, cleanCritic, criticWithFindings,
         doneImpl } from './_engine_helpers.mjs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// The Proof legs name `report.review.findings`; at BASE the critic's findings
// reach the report as `completenessFindings` (run-engine.mjs:2048), and M2/M3
// pin what the leg produces "as at BASE". Read whichever surface the engine
// offers so these legs pin the FINDING, not the field name.
const criticFindings = (report) =>
  (report && report.review && Array.isArray(report.review.findings))
    ? report.review.findings
    : ((report && report.completenessFindings) || [])

const countOf = (labels, label) => labels.filter((l) => l === label).length

// Same history-coupled oracle as test_run_engine_shallow.mjs: true in any full
// clone of a two-commit repo, false at depth 1.
const HISTORY_COUPLED = '#!/bin/bash\n[ "$(git rev-list --count HEAD)" -gt 1 ]\n'

const wavesFor = (id) => [[{ id, title: 'create ' + id, files: [id + '.txt'], tier: 'standard',
  review: 'lean', writes: [id + '.txt'], commutes: [], body: 'sim task ' + id }]]

// More than one commit at BASE so the full-clone suite is green before the run
// starts (a red baseline would change the run's shape) and so `--depth 1`
// really writes a shallow boundary.
function twoCommitRepo(dir, checkScript) {
  makeRepo(dir, checkScript ? { 'check.sh': checkScript } : {})
  fs.writeFileSync(path.join(dir, 'b.txt'), 'second\n')
  gitSync(['add', '-A'], dir)
  gitSync(['commit', '-q', '-m', 'second'], dir)
  return dir
}

// ── (a) [M1] the critic's dispatch lands INSIDE the depth-1 suite's window ───
// check.sh marks `shallow-start`, sleeps half a second, marks `shallow-end` —
// but only in a shallow repository, so the baseline and per-wave runs (full
// clones, every one) leave the order file alone. The critic stub marks
// `critic` on dispatch, once the leg has actually started; a serial engine
// dispatches it after `shallow-end` is already written, so it marks third.
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-beside-order-'))
  const order = path.join(tmp, 'order.txt')
  const q = JSON.stringify(order)
  const MARKING = '#!/bin/bash\n' +
    'if [ "$(git rev-parse --is-shallow-repository)" = "true" ]; then\n' +
    '  echo shallow-start >> ' + q + '\n' +
    '  sleep 0.5\n' +
    '  echo shallow-end >> ' + q + '\n' +
    'fi\n' +
    'exit 0\n'
  const repo = twoCommitRepo(path.join(tmp, 'repo'), MARKING)
  const marks = () => (fs.existsSync(order)
    ? fs.readFileSync(order, 'utf8').split('\n').filter(Boolean) : [])

  const labels = []
  const stub = async (prompt, opts, cwd) => {
    labels.push(opts.label)
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') {
      fs.writeFileSync(path.join(cwd, 'A1.txt'), 'from A1\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    if (opts.label === 'integration') {
      // Bounded, not a hang: the mark goes down as soon as the leg's suite has
      // started. On the serial path `shallow-start` is already present (with
      // `shallow-end` behind it) and this returns on the first look, so the
      // order below reads shallow-start/shallow-end/critic and the leg is red
      // for the one reason it should be.
      const deadline = Date.now() + 20000
      while (!marks().includes('shallow-start') && Date.now() < deadline) await sleep(10)
      fs.appendFileSync(order, 'critic\n')
      return cleanCritic()
    }
    throw new Error('unexpected dispatch: ' + opts.label)
  }

  const runDir = path.join(tmp, 'run')
  const { run } = rig({ repo, runDir, waves: wavesFor('A1'), stub, stamp: 'beside' })
  const report = await run()

  assert.equal(report.tests.passed, true,
    '(a)/M1 precondition: the full-clone suite is green — ' + report.tests.output)
  assert.ok(report.shallowSuite, '(a)/M1 precondition: the leg ran on the green adopted tree')
  assert.equal(report.shallowSuite.passed, true,
    '(a)/M1 precondition: the marking suite is green at depth 1 too')
  assert.equal(countOf(labels, 'integration'), 1,
    '(a)/M1 precondition: the critic is dispatched once — ' + labels.join(','))
  assert.deepEqual(marks(), ['shallow-start', 'critic', 'shallow-end'],
    '(a)/M1: the critic\'s dispatch begins while the depth-1 suite is still running ' +
    '(serial reads shallow-start,shallow-end,critic)')
}

// ── (b) [M2] what each side produces is unchanged by running them together ───
// b1: a history-coupled suite — green on the two-commit full clone, RED at
// depth 1 — still yields shallowSuite.passed === false and exactly one
// depth-1 `manual` deferral; the critic still ran once and its finding is in
// the report.
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-beside-red-'))
  const repo = twoCommitRepo(path.join(tmp, 'repo'), HISTORY_COUPLED)
  const FINDING = { severity: 'advisory', detail: 'sim critic finding: B1 beside the red leg' }
  const labels = []
  const stub = (prompt, opts, cwd) => {
    labels.push(opts.label)
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') {
      fs.writeFileSync(path.join(cwd, 'B1.txt'), 'from B1\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    if (opts.label === 'integration') return criticWithFindings([FINDING])
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run } = rig({ repo, runDir: path.join(tmp, 'run'), waves: wavesFor('B1'),
                        stub, stamp: 'besidered' })
  const report = await run()

  assert.equal(report.tests.passed, true,
    '(b)/M2 precondition: the driver\'s full-clone suite passed — ' + report.tests.output)
  assert.ok(report.shallowSuite, '(b)/M2: the leg still ran')
  assert.equal(report.shallowSuite.passed, false,
    '(b)/M2: a history-coupled suite still fails on the depth-1 clone')

  const depth1 = report.deferredVerification
    .filter((d) => d && String(d.deliverable || '').startsWith('depth-1 clone of '))
  assert.equal(depth1.length, 1, '(b)/M2: exactly one depth-1 deferral — ' +
    JSON.stringify(report.deferredVerification))
  assert.equal(depth1[0].reason, 'manual',
    '(b)/M2: and it is the `manual` ack the gate does not pre-authorize')

  assert.equal(countOf(labels, 'integration'), 1,
    '(b)/M2: the critic is dispatched exactly once — ' + labels.join(','))
  assert.deepEqual(criticFindings(report), [FINDING],
    '(b)/M2: the finding the critic stub returned is in the report')
}

// b2: a plain green suite — shallowSuite.passed === true, no depth-1 item, the
// critic still dispatched once with its finding carried.
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-beside-green-'))
  const repo = twoCommitRepo(path.join(tmp, 'repo'), null)
  const FINDING = { severity: 'advisory', detail: 'sim critic finding: B2 beside the green leg' }
  const labels = []
  const stub = (prompt, opts, cwd) => {
    labels.push(opts.label)
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') {
      fs.writeFileSync(path.join(cwd, 'B2.txt'), 'from B2\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    if (opts.label === 'integration') return criticWithFindings([FINDING])
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run } = rig({ repo, runDir: path.join(tmp, 'run'), waves: wavesFor('B2'),
                        stub, stamp: 'besidegreen' })
  const report = await run()

  assert.ok(report.shallowSuite, '(b)/M2: the leg still ran')
  assert.equal(report.shallowSuite.passed, true,
    '(b)/M2: a suite that does not read history still agrees at depth 1')
  assert.deepEqual(
    report.deferredVerification
      .filter((d) => d && String(d.deliverable || '').startsWith('depth-1 clone of ')), [],
    '(b)/M2: a green leg still adds no depth-1 ack — ' +
    JSON.stringify(report.deferredVerification))

  assert.equal(countOf(labels, 'integration'), 1,
    '(b)/M2: the critic is dispatched exactly once — ' + labels.join(','))
  assert.deepEqual(criticFindings(report), [FINDING],
    '(b)/M2: the finding the critic stub returned is in the report')
}

// ── (c) [M3] the two skip paths are as at BASE ──────────────────────────────
// c1: `shallowLeg: false` skips the leg and nothing else — the critic still
// runs. strictEqual on purpose: a loose `== null` would also accept the
// `undefined` an engine WITHOUT the field returns, a check that cannot fail.
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-beside-off-'))
  const repo = twoCommitRepo(path.join(tmp, 'repo'), HISTORY_COUPLED)
  const runDir = path.join(tmp, 'run')
  const labels = []
  const stub = (prompt, opts, cwd) => {
    labels.push(opts.label)
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') {
      fs.writeFileSync(path.join(cwd, 'C1.txt'), 'from C1\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run } = rig({ repo, runDir, waves: wavesFor('C1'), stub, stamp: 'besideoff',
                        extraArgs: { shallowLeg: false } })
  const report = await run()

  assert.strictEqual(report.shallowSuite, null, '(c)/M3: shallowLeg:false skips the leg')
  assert.ok(!fs.existsSync(path.join(runDir, 'clones', 'shallow')),
    '(c)/M3: and clones nothing')
  assert.equal(countOf(labels, 'integration'), 1,
    '(c)/M3: the critic is still dispatched exactly once — ' + labels.join(','))
}

// c2: no wave merged (the only implementer returns BLOCKED) — no leg, no
// clone, NO critic, and the report carries the `no wave merged` finding.
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-beside-nomerge-'))
  const repo = twoCommitRepo(path.join(tmp, 'repo'), null)
  const runDir = path.join(tmp, 'run')
  const labels = []
  const stub = (prompt, opts, cwd) => {
    labels.push(opts.label)
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') {
      return { status: 'BLOCKED', summary: 'sim: cannot proceed', startHead: doneImpl(cwd).startHead }
    }
    if (kind === 'review') return passReview()
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run } = rig({ repo, runDir, waves: wavesFor('C2'), stub, stamp: 'besidenomerge' })
  const report = await run()

  assert.ok(!report.waveMerges.some((m) => m && m.status === 'MERGED'),
    '(c)/M3 precondition: no wave merged — ' + JSON.stringify(report.waveMerges))
  assert.strictEqual(report.shallowSuite, null, '(c)/M3: no merged wave, no leg')
  assert.ok(!fs.existsSync(path.join(runDir, 'clones', 'shallow')),
    '(c)/M3: and no depth-1 clone was made')
  assert.equal(countOf(labels, 'integration'), 0,
    '(c)/M3: the critic is not dispatched on a tree that is still at BASE — ' + labels.join(','))
  assert.ok(criticFindings(report).some((f) => f && String(f.detail || '').includes('no wave merged')),
    '(c)/M3: the report carries the `no wave merged` finding — ' +
    JSON.stringify(criticFindings(report)))
}

// ── (d) the sim's sentinel ──────────────────────────────────────────────────
console.log('ALL TESTS PASSED')
