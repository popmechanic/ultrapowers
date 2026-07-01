// tests/wave_ancestry_sim.mjs
//
// Behavioral sim for the #70 integration ancestry assertion. Like sim_workflow.mjs
// this runs the REAL orchestrator body from skills/ultrapowers/harnesses/waves.js
// with stubbed engine globals (agent/parallel/phase/log/args/budget) — the
// research-preview Workflow engine can't run in CI, so we execute the wrapped body
// the same way the engine does and inspect the returned report.
//
// NOT run by pytest/CI (it's a Node sim). Run manually:  node tests/wave_ancestry_sim.mjs
// Self-asserting: throws (exit 1) on any failed expectation.

import fs from 'node:fs'

const WF_URL = new URL('../skills/ultrapowers/harnesses/waves.js', import.meta.url)
const SRC = fs.readFileSync(WF_URL, 'utf8').replace('export const meta', 'const meta')

function runWorkflow({ agent, args }) {
  const parallel = (thunks) => Promise.all(thunks.map((t) => t()))
  const phase = () => {}
  const log = () => {}
  const budget = { total: null, spent: () => 0, remaining: () => Infinity }
  const factory = new Function(
    'agent', 'parallel', 'phase', 'log', 'args', 'budget',
    '"use strict"; return (async () => {\n' + SRC + '\n})();'
  )
  return factory(agent, parallel, phase, log, args, budget)
}

function assert(cond, msg) {
  if (!cond) throw new Error('SIM ASSERT FAILED: ' + msg)
}

// Two waves: A,B merge in wave 1; C merges in wave 2. Every task lands, so
// mergedShas = [{A,sha-A},{B,sha-B},{C,sha-C}] reaches the completeness critic.
const WAVES = [
  [
    { id: 'A', title: 'alpha', body: 'create a.txt', tier: 'cheap' },
    { id: 'B', title: 'beta', body: 'create b.txt', tier: 'cheap' },
  ],
  [{ id: 'C', title: 'gamma', body: 'create c.txt', tier: 'standard' }],
]
const baseArgs = { waves: WAVES, integrationBranch: 'ultra/integration-sim', stamp: 'sim', edges: [['A', 'C']] }

// Stub every role to success; let each scenario override the integration critic's
// review result to inject (or omit) ancestryMisses. Also captures the completeness
// prompt so we can assert the mergedShas list + the ancestry instruction reach it.
function makeAgent(reviewResult, capture) {
  return async (prompt, opts) => {
    const label = opts.label || ''
    if (label === 'setup') return { branch: baseArgs.integrationBranch, headSha: 'int0' }
    if (label.startsWith('impl:') || label.startsWith('fix:')) {
      const id = label.split(':')[1]
      return { status: 'DONE', summary: 's', branch: 'wt-' + id, headSha: 'sha-' + id }
    }
    if (label.startsWith('review:')) return { verdict: 'PASS', issues: [] }
    if (label.startsWith('merge:')) return { status: 'MERGED', headSha: 'm-' + label }
    if (label === 'integration') {
      if (capture) capture.prompt = prompt
      return reviewResult
    }
    throw new Error('unexpected agent label: ' + label)
  }
}

// ── Scenario 1: a dropped headSha → BLOCKED + judgmentCall, gitVerified withheld ──
async function scenarioMiss() {
  const cap = {}
  const review = {
    command: 'pytest', testsPassed: true, output: 'ok', findings: [], onIntegrationHead: true,
    // Task A's commit is NOT an ancestor of the integration HEAD — a silent drop.
    ancestryMisses: [{ task: 'A', headSha: 'sha-A' }],
  }
  const report = await runWorkflow({ agent: makeAgent(review, cap), args: baseArgs })

  // The critic was fed the accumulated mergedShas + the ancestry instruction.
  assert(/merge-base --is-ancestor/.test(cap.prompt), 'completeness prompt carries the ancestry instruction')
  assert(/mergedShas/.test(cap.prompt), 'completeness prompt carries the mergedShas label')
  assert(/sha-A/.test(cap.prompt) && /sha-B/.test(cap.prompt) && /sha-C/.test(cap.prompt),
    'completeness prompt lists every merged task headSha')

  // A miss forces BLOCKED: gitVerified withheld even though onIntegrationHead was true.
  assert(report.gitVerified === false, 'ancestry miss withholds gitVerified (run BLOCKED)')
  assert(Array.isArray(report.ancestryMisses) && report.ancestryMisses.length === 1,
    'report surfaces the ancestry miss')
  const named = report.judgmentCalls.some((j) => /ancestry miss/.test(j) && /task A/.test(j) && /BLOCKED/.test(j))
  assert(named, 'a judgmentCall names the dropped task and marks the run BLOCKED')
  console.log('scenario ancestry-miss: OK')
}

// ── Scenario 2: every recorded head is an ancestor → clean, gitVerified true ──────
async function scenarioClean() {
  const cap = {}
  const review = {
    command: 'pytest', testsPassed: true, output: 'ok', findings: [], onIntegrationHead: true,
    ancestryMisses: [],
  }
  const report = await runWorkflow({ agent: makeAgent(review, cap), args: baseArgs })
  assert(report.gitVerified === true, 'no misses + onIntegrationHead -> gitVerified true')
  assert(report.ancestryMisses.length === 0, 'no ancestry misses recorded')
  const anyMissCall = report.judgmentCalls.some((j) => /ancestry miss/.test(j))
  assert(!anyMissCall, 'no ancestry-miss judgmentCall on a clean run')
  console.log('scenario ancestry-clean: OK')
}

await scenarioMiss()
await scenarioClean()
console.log('ALL SCENARIOS PASSED')
