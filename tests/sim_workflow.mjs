// tests/sim_workflow.mjs
//
// Deterministic simulation of skills/ultrapowers/workflow.js. The real
// research-preview Workflow engine can't run in CI, so we stub its globals
// (agent, parallel, phase, log, args, budget) and execute the orchestrator the
// same way the engine does (strip `export`, run the body as an async function).
// This validates the orchestration LOGIC — wave ordering, the bounded fix-loop,
// merge reconciliation, cascade-blocking, and the report shape — not just syntax.
//
// Self-asserting: throws (exit 1) on any failed expectation.

import fs from 'node:fs'

const WF_URL = new URL('../skills/ultrapowers/workflow.js', import.meta.url)
const SRC = fs.readFileSync(WF_URL, 'utf8').replace('export const meta', 'const meta')

function runWorkflow({ agent, args, budget }) {
  const parallel = (thunks) => Promise.all(thunks.map((t) => t()))
  const phase = () => {}
  const log = () => {}
  // Execute the workflow body as the engine would: an async wrapper whose
  // trailing `return {...}` becomes the resolved report.
  const factory = new Function(
    'agent', 'parallel', 'phase', 'log', 'args', 'budget',
    '"use strict"; return (async () => {\n' + SRC + '\n})();'
  )
  return factory(agent, parallel, phase, log, args, budget)
}

function assert(cond, msg) {
  if (!cond) throw new Error('SIM ASSERT FAILED: ' + msg)
}
function eq(a, b, msg) {
  assert(JSON.stringify(a) === JSON.stringify(b), msg + ' (got ' + JSON.stringify(a) + ')')
}

// Canary plan: A,B independent; C depends on A. waves = [[A,B],[C]].
const WAVES = [
  [
    { id: 'A', title: 'create alpha', body: 'create a.txt', tier: 'cheap' },
    { id: 'B', title: 'create beta', body: 'create b.txt', tier: 'cheap' },
  ],
  [{ id: 'C', title: 'append alpha', body: 'modify a.txt', tier: 'standard' }],
]
const baseArgs = { waves: WAVES, integrationBranch: 'ultra/integration-sim', stamp: 'sim', dependencyEdges: ['A -> C'] }

function taskIdFromLabel(label) {
  // labels look like impl:A, spec:A:1, qual:A:1, fix:A:1
  return label.split(':')[1]
}

// ── Scenario 1: happy path — everything DONE / PASS / MERGED ──────────────────
async function scenarioHappy() {
  const agent = async (_prompt, opts) => {
    const label = opts.label || ''
    if (label === 'setup') return { branch: baseArgs.integrationBranch, headSha: 'int0' }
    if (label.startsWith('impl:') || label.startsWith('fix:')) {
      const id = taskIdFromLabel(label)
      return { status: 'DONE', summary: 'done ' + id, branch: 'wt-' + id, headSha: 'sha-' + id, commit: 'c-' + id }
    }
    if (label.startsWith('spec:') || label.startsWith('qual:')) return { verdict: 'PASS', issues: [] }
    if (label.startsWith('merge:')) return { status: 'MERGED', headSha: 'm-' + label }
    if (label === 'integration') return { command: 'pytest', testsPassed: true, output: 'ok', findings: [] }
    throw new Error('unexpected agent label: ' + label)
  }
  const r = await runWorkflow({ agent, args: baseArgs, budget: undefined })
  eq(r.waves, [['A', 'B'], ['C']], 'happy: waves')
  eq(r.tasks.map((t) => t.task).sort(), ['A', 'B', 'C'], 'happy: task ids')
  assert(r.tasks.every((t) => t.status === 'done'), 'happy: all tasks done')
  assert(r.tasks.every((t) => t.reviewVerdict === 'clean'), 'happy: all clean')
  eq(r.tests.passed, true, 'happy: tests passed')
  eq(r.unfinished, [], 'happy: nothing unfinished')
  eq(r.blockedWaves, [], 'happy: no blocked waves')
  eq(r.dependencyEdges, ['A -> C'], 'happy: dependency edges passed through')
  console.log('scenario happy: OK')
}

// ── Scenario 2: fix-loop — A needs one fix round, then passes ────────────────
async function scenarioFixLoop() {
  const specCalls = {}
  const agent = async (_prompt, opts) => {
    const label = opts.label || ''
    if (label === 'setup') return { branch: baseArgs.integrationBranch, headSha: 'int0' }
    if (label.startsWith('impl:') || label.startsWith('fix:')) {
      const id = taskIdFromLabel(label)
      return { status: 'DONE', summary: 's', branch: 'wt-' + id, headSha: 'sha-' + id, commit: 'c-' + id }
    }
    if (label.startsWith('spec:')) {
      const id = taskIdFromLabel(label)
      specCalls[id] = (specCalls[id] || 0) + 1
      if (id === 'A' && specCalls[id] === 1) {
        return { verdict: 'FIX_REQUIRED', issues: [{ severity: 'blocking', detail: 'missing assertion' }] }
      }
      return { verdict: 'PASS', issues: [] }
    }
    if (label.startsWith('qual:')) return { verdict: 'PASS', issues: [] }
    if (label.startsWith('merge:')) return { status: 'MERGED', headSha: 'm' }
    if (label === 'integration') return { command: 'pytest', testsPassed: true, output: 'ok', findings: [] }
    throw new Error('unexpected agent label: ' + label)
  }
  const r = await runWorkflow({ agent, args: baseArgs, budget: undefined })
  const a = r.tasks.find((t) => t.task === 'A')
  eq(a.status, 'done', 'fixloop: A done')
  eq(a.reviewVerdict, 'fixed', 'fixloop: A reviewVerdict fixed (re-dispatched once)')
  assert(specCalls['A'] === 2, 'fixloop: A spec reviewed twice (got ' + specCalls['A'] + ')')
  eq(r.tests.passed, true, 'fixloop: tests passed')
  console.log('scenario fix-loop: OK')
}

// ── Scenario 3: wave-1 merge unrecoverable → wave blocked, C cascade-blocked ──
async function scenarioBlockedCascade() {
  const agent = async (_prompt, opts) => {
    const label = opts.label || ''
    if (label === 'setup') return { branch: baseArgs.integrationBranch, headSha: 'int0' }
    if (label.startsWith('impl:') || label.startsWith('fix:')) {
      const id = taskIdFromLabel(label)
      return { status: 'DONE', summary: 's', branch: 'wt-' + id, headSha: 'sha-' + id, commit: 'c-' + id }
    }
    if (label.startsWith('spec:') || label.startsWith('qual:')) return { verdict: 'PASS', issues: [] }
    if (label.startsWith('merge:wave1')) return { status: 'CONFLICT', detail: 'merge conflict in a.txt' }
    if (label.startsWith('reconcile:')) return { status: 'CONFLICT', detail: 'still conflicted' }
    if (label.startsWith('merge:')) return { status: 'MERGED', headSha: 'm' }
    if (label === 'integration') return { command: 'pytest', testsPassed: false, output: 'n/a', findings: ['wave 1 blocked'] }
    throw new Error('unexpected agent label: ' + label)
  }
  const r = await runWorkflow({ agent, args: baseArgs, budget: undefined })
  assert(r.blockedWaves.length === 1 && r.blockedWaves[0].wave === 1, 'cascade: wave 1 recorded blocked')
  assert(r.unfinished.some((u) => u.startsWith('C:') && u.includes('cascade-blocked')), 'cascade: C cascade-blocked')
  // C must NOT appear as a completed task (we broke before running wave 2).
  assert(!r.tasks.some((t) => t.task === 'C'), 'cascade: C did not run')
  console.log('scenario blocked-cascade: OK')
}

// ── Scenario 4: malformed args → fail loud (no silent proceed) ────────────────
async function scenarioArgsThrow() {
  let threw = false
  try {
    await runWorkflow({ agent: async () => ({}), args: {}, budget: undefined })
  } catch (e) {
    threw = /args\.waves missing or malformed/.test(e.message)
  }
  assert(threw, 'argsThrow: empty args.waves must throw the fail-loud error')
  console.log('scenario args-throw: OK')
}

await scenarioHappy()
await scenarioFixLoop()
await scenarioBlockedCascade()
await scenarioArgsThrow()
console.log('ALL SCENARIOS PASSED')
