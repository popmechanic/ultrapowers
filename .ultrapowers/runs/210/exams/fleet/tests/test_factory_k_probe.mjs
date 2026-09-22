/**
 * fleet/tests/test_factory_k_probe.mjs — the exam for "One task per run — the
 * hardest by Jev's reading — lands from two implementers, and the landing row
 * says which won and by how much" (#1211).
 *
 * Pure: imports only `kFor` and `probeRecord` from `../../factory/kprobe.mjs`
 * (nothing from the engine), passes plain policy objects of its own making,
 * never reads `factory/policy.json`, and starts no child process, touches no
 * disk, no network.
 *
 * Legs, each naming the Machine clause it comes from:
 *
 *   (a) [M1] the cell enabled: the probe is the highest-reading task (a
 *       number reading beats an object `{ score }` reading beats a
 *       non-reading), first-in-order on a tie, its `k` is the cell's own `k`
 *       (not a literal 2) and every other task's `k` is 1; with no task
 *       readable at all, `probe` is `null` and every `k` is 1.
 *   (b) [M1] the cell absent, or present but not `enabled: true` (`enabled:
 *       false`): `probe` is `null` and `k[id]` falls back to `judged[id]`
 *       when that is a positive integer, else 1.
 *   (c) [M2] `probeRecord` builds one `candidates` entry per input in input
 *       order, carrying `index`, `examExit`, `claim`, `coverage` and `score`;
 *       picks the highest-scoring `chosen` (first on a tie); and answers a
 *       `margin` that is the chosen score minus the best of the rest, or
 *       `null` for a single candidate.
 *
 * What this exam assumes about the code under test: `kFor` and `probeRecord`
 * are synchronous pure functions exported by name from `factory/kprobe.mjs`,
 * neither throws on the well-formed inputs used below, and neither mutates
 * its arguments (checked only incidentally — not itself asserted as a
 * clause).
 */

import assert from 'node:assert/strict'

import { kFor, probeRecord } from '../../factory/kprobe.mjs'

let failures = 0

function check(label, fn) {
  try {
    fn()
    console.log(`ok - ${label}`)
  } catch (err) {
    failures += 1
    console.error(`NOT OK - ${label}`)
    console.error(err && err.stack ? err.stack : err)
  }
}

// ── (a) [M1] enabled: highest reading wins, ties go first, k is the cell's own k ──

check('[M1] enabled: highest reading (mixed number/score-object/unreadable) wins, k[probe] is the cell k, others 1', () => {
  const policy = { dispatch: { k_probe: { enabled: true, k: 2 } } }
  const tasks = [{ id: '1' }, { id: '2' }, { id: '3' }]
  const difficulties = { '1': 1.5, '2': { score: 2.7 }, '3': 'x' }
  const result = kFor({ tasks, difficulties, judged: {}, policy })
  assert.equal(result.probe, '2')
  assert.deepEqual(result.k, { '1': 1, '2': 2, '3': 1 })
})

check('[M1] enabled: first task in order wins a tie', () => {
  const policy = { dispatch: { k_probe: { enabled: true, k: 2 } } }
  const tasks = [{ id: '1' }, { id: '2' }, { id: '3' }]
  const result = kFor({ tasks, difficulties: { '1': 2, '2': 2 }, judged: {}, policy })
  assert.equal(result.probe, '1')
})

check('[M1] enabled: the probe\'s k is the cell\'s own k, not a hardcoded 2', () => {
  const policy = { dispatch: { k_probe: { enabled: true, k: 3 } } }
  const tasks = [{ id: '1' }, { id: '2' }, { id: '3' }]
  const result = kFor({ tasks, difficulties: { '2': 1 }, judged: {}, policy })
  assert.equal(result.k['2'], 3)
})

check('[M1] enabled: no task has a reading at all -> probe null, every k 1', () => {
  const policy = { dispatch: { k_probe: { enabled: true, k: 2 } } }
  const tasks = [{ id: '1' }, { id: '2' }, { id: '3' }]
  const result = kFor({ tasks, difficulties: {}, judged: {}, policy })
  assert.equal(result.probe, null)
  assert.deepEqual(result.k, { '1': 1, '2': 1, '3': 1 })
})

// ── (b) [M1] disabled or absent: probe null, k falls back to judged ──

check('[M1] enabled: false -> probe null, k[id] falls back to judged[id] (positive integer) else 1', () => {
  const policy = { dispatch: { k_probe: { enabled: false, k: 2 } } }
  const tasks = [{ id: '1' }, { id: '2' }, { id: '3' }]
  const result = kFor({
    tasks,
    difficulties: { '1': 3 },
    judged: { '1': 2, '2': 0, '3': 'x' },
    policy
  })
  assert.equal(result.probe, null)
  assert.deepEqual(result.k, { '1': 2, '2': 1, '3': 1 })
})

check('[M1] cell absent entirely -> same fallback-to-judged behavior as disabled', () => {
  const tasks = [{ id: '1' }, { id: '2' }, { id: '3' }]
  const result = kFor({
    tasks,
    difficulties: { '1': 3 },
    judged: { '1': 2, '2': 0, '3': 'x' },
    policy: {}
  })
  assert.equal(result.probe, null)
  assert.deepEqual(result.k, { '1': 2, '2': 1, '3': 1 })
})

// ── (c) [M2] probeRecord ──

check('[M2] two candidates: candidates carry index/examExit/claim/coverage/score, chosen is the higher scorer, margin is the gap', () => {
  const candidates = [
    { index: 0, examExit: 1, claim: 0.4, coverage: [0.5] },
    { index: 1, examExit: 0, claim: 0.9, coverage: [1] }
  ]
  const scores = [1.5, 11.9]
  const result = probeRecord({ candidates, scores })
  assert.equal(result.chosen, 1)
  assert.equal(result.margin, 10.4)
  assert.deepEqual(result.candidates[0], {
    index: 0, examExit: 1, claim: 0.4, coverage: [0.5], score: 1.5
  })
})

check('[M2] a tie on score picks the first candidate and margin is 0', () => {
  const candidates = [
    { index: 0, examExit: 1, claim: 0.4, coverage: [0.5] },
    { index: 1, examExit: 0, claim: 0.9, coverage: [1] }
  ]
  const scores = [11, 11]
  const result = probeRecord({ candidates, scores })
  assert.equal(result.chosen, 0)
  assert.equal(result.margin, 0)
})

check('[M2] a single candidate: chosen is its own index, margin is null', () => {
  const candidates = [{ index: 0, examExit: 1, claim: 0.4, coverage: [0.5] }]
  const scores = [11]
  const result = probeRecord({ candidates, scores })
  assert.equal(result.chosen, 0)
  assert.equal(result.margin, null)
})

if (failures > 0) {
  console.error(`${failures} check(s) failed`)
  process.exit(1)
}

console.log('ALL TESTS PASSED')
process.exit(0)
