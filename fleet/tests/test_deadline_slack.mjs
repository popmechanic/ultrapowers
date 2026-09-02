// fleet/tests/test_deadline_slack.mjs — the node half of #478's deadline seam.
//
// A wall-clock assertion in the suite is sampled three to five times per run,
// each time under whatever concurrent load the fleet is generating, and a
// single flaky trip reads as `infra` weather rather than as the bare constant
// it actually is. `deadline-slack.mjs` is the seam that lets those deadlines
// scale with the machine: one environment variable, one multiplier, no other
// knob.
//
// Legs (a), (c) and (e) of the task's Proof live here; (b), (d) and (f) are
// the same shape against the python half, in tests/test_deadline_slack.py.

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { slack, deadlineBudget, SLACK_ENV, DEFAULT_SLACK } from './deadline-slack.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')

// The module reads the variable per call, so the legs set it in place rather
// than respawning a node process per value.
const withSlack = (value, body) => {
  const had = Object.prototype.hasOwnProperty.call(process.env, 'FLEET_TEST_SLACK')
  const previous = process.env.FLEET_TEST_SLACK
  if (value === null) delete process.env.FLEET_TEST_SLACK
  else process.env.FLEET_TEST_SLACK = value
  try {
    body()
  } finally {
    if (had) process.env.FLEET_TEST_SLACK = previous
    else delete process.env.FLEET_TEST_SLACK
  }
}

// ── (a) the seam itself [M1] ────────────────────────────────────────────────

withSlack(null, () => {
  assert.equal(slack(), 4, 'unset: the default multiplier is 4')
  assert.equal(deadlineBudget(300), 1200, 'unset: a 300 ms base budgets 1200 ms')
})
console.log('ok - (a) unset: slack() is 4 and deadlineBudget(300) is 1200')

withSlack('1', () => {
  assert.equal(slack(), 1, "'1': the machine is quiet, take the base at face value")
  assert.equal(deadlineBudget(300), 300, "'1': a 300 ms base budgets 300 ms")
})
console.log('ok - (a) FLEET_TEST_SLACK=1: slack() is 1 and deadlineBudget(300) is 300')

for (const bad of ['abc', '0', '-2']) {
  withSlack(bad, () => {
    assert.equal(slack(), 4, `'${bad}' is not a positive number, so the default stands`)
  })
  console.log(`ok - (a) FLEET_TEST_SLACK=${bad}: slack() falls back to 4`)
}

// The two constants the python half is pinned against, by name.
assert.equal(SLACK_ENV, 'FLEET_TEST_SLACK')
assert.equal(DEFAULT_SLACK, 4)

// ── (c) the three deadlines in test_run_worker.mjs are seam calls [M3] ──────

const WORKER_SPEC = path.join(HERE, 'test_run_worker.mjs')
const worker = fs.readFileSync(WORKER_SPEC, 'utf8')

assert.ok(!worker.includes('< 5000'),
  'test_run_worker.mjs still bounds an elapsed time by the bare constant 5000')
assert.ok(!worker.includes('timeoutMs: 400'),
  'test_run_worker.mjs still configures the hang case with a bare 400 ms deadline')
assert.match(worker, /import\s*\{[^}]*\bdeadlineBudget\b[^}]*\}\s*from\s*'\.\/deadline-slack\.mjs'/,
  'test_run_worker.mjs must import deadlineBudget from ./deadline-slack.mjs')

const count = (needle) => worker.split(needle).length - 1
assert.ok(count('timeoutMs: deadlineBudget(') >= 2,
  `both timeout cases must budget their timeoutMs, found ${count('timeoutMs: deadlineBudget(')}`)
assert.ok(count('graceMs: deadlineBudget(') >= 1,
  'the trapped-SIGTERM case must budget its graceMs too')
console.log('ok - (c) all three deadlines in test_run_worker.mjs are deadlineBudget() calls')

const elapsed = worker.match(/Date\.now\(\) - t0 < ([^,]+),/)
assert.ok(elapsed, "the trapped-SIGTERM case's elapsed-time assertion was not found")
const bound = elapsed[1]
assert.ok(bound.includes('timeoutMs'), `the bound must name the case's timeoutMs, got: ${bound}`)
assert.ok(bound.includes('graceMs'), `the bound must name the case's graceMs, got: ${bound}`)
assert.ok(!/\d{3,}/.test(bound),
  `the bound must be computed from what the case configured, not a bare literal, got: ${bound}`)
console.log('ok - (c) the elapsed bound is computed from the case\'s own timeoutMs and graceMs')

// ── (e) the spec still passes, slack set and unset [M5] ─────────────────────

const runWorkerSpec = (value) => {
  const env = { ...process.env }
  if (value === null) delete env.FLEET_TEST_SLACK
  else env.FLEET_TEST_SLACK = value
  return spawnSync(process.execPath, [WORKER_SPEC], { cwd: ROOT, env, encoding: 'utf8' })
}

for (const value of [null, '1']) {
  const label = value === null ? 'unset' : `FLEET_TEST_SLACK=${value}`
  const r = runWorkerSpec(value)
  assert.equal(r.status, 0, `test_run_worker.mjs exited ${r.status} with ${label}:\n${r.stdout}${r.stderr}`)
  assert.ok(r.stdout.includes('ALL TESTS PASSED'),
    `test_run_worker.mjs printed no sentinel with ${label}:\n${r.stdout}${r.stderr}`)
  console.log(`ok - (e) node fleet/tests/test_run_worker.mjs passes with ${label}`)
}

console.log('ALL TESTS PASSED')
