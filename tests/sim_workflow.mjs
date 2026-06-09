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
  // labels look like impl:A, review:A:1, fix:A:1
  return label.split(':')[1]
}

// Default stub agent: every role succeeds. Pass a handler(label, prompt, opts)
// that returns a value to override a role, or undefined to fall through.
function makeAgent(handle) {
  return async (prompt, opts) => {
    const label = opts.label || ''
    if (handle) {
      const r = handle(label, prompt, opts)
      if (r !== undefined) return r
    }
    if (label === 'setup') return { branch: 'ultra/integration-sim', headSha: 'int0' }
    if (label.startsWith('impl:') || label.startsWith('fix:')) {
      const id = taskIdFromLabel(label)
      return { status: 'DONE', summary: 's', branch: 'wt-' + id, headSha: 'sha-' + id, commit: 'c-' + id }
    }
    if (label.startsWith('review:')) return { verdict: 'PASS', issues: [] }
    if (label.startsWith('merge:')) return { status: 'MERGED', headSha: 'm-' + label }
    if (label === 'integration') return { command: 'pytest', testsPassed: true, output: 'ok', findings: [] }
    throw new Error('unexpected agent label: ' + label)
  }
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
    if (label.startsWith('review:')) return { verdict: 'PASS', issues: [] }
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
  assert(r.waveMerges.length === 2 && r.waveMerges.every((m) => m.status === 'MERGED' && m.headSha),
    'happy: per-wave merge outcomes recorded (status + headSha)')
  eq(r.waveMerges.map((m) => m.wave), [1, 2], 'happy: waveMerges numbered in order')
  console.log('scenario happy: OK')
}

// ── Scenario 2: fix-loop — A needs one fix round, then passes (cap 2) ─────────
async function scenarioFixLoop() {
  const reviewCalls = {}
  const agent = async (_prompt, opts) => {
    const label = opts.label || ''
    if (label === 'setup') return { branch: baseArgs.integrationBranch, headSha: 'int0' }
    if (label.startsWith('impl:') || label.startsWith('fix:')) {
      const id = taskIdFromLabel(label)
      return { status: 'DONE', summary: 's', branch: 'wt-' + id, headSha: 'sha-' + id, commit: 'c-' + id }
    }
    if (label.startsWith('review:')) {
      const id = taskIdFromLabel(label)
      reviewCalls[id] = (reviewCalls[id] || 0) + 1
      if (id === 'A' && reviewCalls[id] === 1) {
        return { verdict: 'FIX_REQUIRED', issues: [{ severity: 'blocking', detail: 'missing assertion' }] }
      }
      return { verdict: 'PASS', issues: [] }
    }
    if (label.startsWith('merge:')) return { status: 'MERGED', headSha: 'm' }
    if (label === 'integration') return { command: 'pytest', testsPassed: true, output: 'ok', findings: [] }
    throw new Error('unexpected agent label: ' + label)
  }
  const r = await runWorkflow({ agent, args: baseArgs, budget: undefined })
  const a = r.tasks.find((t) => t.task === 'A')
  eq(a.status, 'done', 'fixloop: A done')
  eq(a.reviewVerdict, 'fixed', 'fixloop: A reviewVerdict fixed (re-dispatched once)')
  eq(a.fixIterations, 1, 'fixloop: one fix round recorded')
  assert(reviewCalls['A'] === 2, 'fixloop: A reviewed twice — single pass per iter, cap 2 (got ' + reviewCalls['A'] + ')')
  eq(r.tests.passed, true, 'fixloop: tests passed')
  console.log('scenario fix-loop: OK')
}

// ── Scenario 2b: fix-loop exhausts at cap 2 (still blocking after one fix) ────
async function scenarioFixLoopExhausted() {
  const reviewCalls = {}
  const agent = async (_prompt, opts) => {
    const label = opts.label || ''
    if (label === 'setup') return { branch: baseArgs.integrationBranch, headSha: 'int0' }
    if (label.startsWith('impl:') || label.startsWith('fix:')) {
      const id = taskIdFromLabel(label)
      return { status: 'DONE', summary: 's', branch: 'wt-' + id, headSha: 'sha-' + id, commit: 'c-' + id }
    }
    if (label.startsWith('review:')) {
      const id = taskIdFromLabel(label)
      reviewCalls[id] = (reviewCalls[id] || 0) + 1
      // A never gets fixed; everything else passes.
      if (id === 'A') return { verdict: 'FIX_REQUIRED', issues: [{ severity: 'blocking', detail: 'still broken' }] }
      return { verdict: 'PASS', issues: [] }
    }
    if (label.startsWith('merge:')) return { status: 'MERGED', headSha: 'm' }
    if (label === 'integration') return { command: 'pytest', testsPassed: true, output: 'ok', findings: [] }
    throw new Error('unexpected agent label: ' + label)
  }
  const r = await runWorkflow({ agent, args: baseArgs, budget: undefined })
  const a = r.tasks.find((t) => t.task === 'A')
  eq(a.status, 'failed', 'exhausted: A failed')
  eq(a.reviewVerdict, 'fix-loop-exhausted', 'exhausted: A fix-loop-exhausted')
  assert(reviewCalls['A'] === 2, 'exhausted: A reviewed exactly twice — cap 2, no third pass (got ' + reviewCalls['A'] + ')')
  console.log('scenario fix-loop-exhausted: OK')
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
    if (label.startsWith('review:')) return { verdict: 'PASS', issues: [] }
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
  assert(r.waveMerges.length === 1 && r.waveMerges[0].status === 'CONFLICT',
    'cascade: wave-1 merge outcome recorded as CONFLICT in waveMerges')
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

// ── Scenario 5: args delivered as a JSON STRING (observed live in -p) ─────────
// The args-probe showed args can arrive as a raw JSON string; workflow.js must
// JSON.parse it and still run normally.
async function scenarioArgsString() {
  const agent = async (_prompt, opts) => {
    const label = opts.label || ''
    if (label === 'setup') return { branch: baseArgs.integrationBranch, headSha: 'int0' }
    if (label.startsWith('impl:') || label.startsWith('fix:')) {
      const id = taskIdFromLabel(label)
      return { status: 'DONE', summary: 's', branch: 'wt-' + id, headSha: 'sha-' + id, commit: 'c-' + id }
    }
    if (label.startsWith('review:')) return { verdict: 'PASS', issues: [] }
    if (label.startsWith('merge:')) return { status: 'MERGED', headSha: 'm' }
    if (label === 'integration') return { command: 'pytest', testsPassed: true, output: 'ok', findings: [] }
    throw new Error('unexpected agent label: ' + label)
  }
  const r = await runWorkflow({ agent, args: JSON.stringify(baseArgs), budget: undefined })
  eq(r.waves, [['A', 'B'], ['C']], 'argsString: waves parsed from JSON string')
  assert(r.tasks.length === 3 && r.tasks.every((t) => t.status === 'done'), 'argsString: all tasks done')
  eq(r.integrationBranch, 'ultra/integration-sim', 'argsString: integrationBranch from parsed string')
  console.log('scenario args-string: OK')
}

// ── Scenario 6: portability — testCmd / reviewProfile / tierOverrides via args ─
// Defaults stay unchanged when omitted (covered by the other scenarios); here we
// supply all three and assert each is honored.
async function scenarioPortability() {
  const seen = { implModels: {}, reviewCount: {}, reviewModels: {}, integrationModel: null, mergeHadCmd: false, integrationHadCmd: false }
  const agent = async (prompt, opts) => {
    const label = opts.label || ''
    if (label === 'setup') return { branch: baseArgs.integrationBranch, headSha: 'int0' }
    if (label.startsWith('impl:') || label.startsWith('fix:')) {
      const id = taskIdFromLabel(label)
      seen.implModels[id] = opts.model
      return { status: 'DONE', summary: 's', branch: 'wt-' + id, headSha: 'sha-' + id, commit: 'c-' + id }
    }
    if (label.startsWith('review:')) {
      const id = taskIdFromLabel(label)
      seen.reviewCount[id] = (seen.reviewCount[id] || 0) + 1
      seen.reviewModels[id] = opts.model
      return { verdict: 'PASS', issues: [] }
    }
    if (label.startsWith('merge:')) {
      if (prompt.includes('make test')) seen.mergeHadCmd = true
      return { status: 'MERGED', headSha: 'm' }
    }
    if (label === 'integration') {
      if (prompt.includes('make test')) seen.integrationHadCmd = true
      seen.integrationModel = opts.model
      return { command: 'make test', testsPassed: true, output: 'ok', findings: [] }
    }
    throw new Error('unexpected agent label: ' + label)
  }
  const args = Object.assign({}, baseArgs, {
    testCmd: 'make test',
    reviewProfile: 'adversarial',
    // cheap -> opus (distinct from the haiku default); mostCapable -> haiku to prove
    // reviewers DON'T follow the override (they must stay opus, override-proof).
    tierOverrides: { cheap: 'opus', mostCapable: 'haiku' },
  })
  const r = await runWorkflow({ agent, args, budget: undefined })
  // tierOverrides: A,B are 'cheap' -> overridden to opus; C is 'standard' -> sonnet (unchanged).
  eq(seen.implModels['A'], 'opus', 'portability: cheap tier overridden to opus (A)')
  eq(seen.implModels['B'], 'opus', 'portability: cheap tier overridden to opus (B)')
  eq(seen.implModels['C'], 'sonnet', 'portability: untouched standard tier still sonnet (C)')
  // OVERRIDE-PROOF reviewers: mostCapable was overridden to haiku, but review and
  // completeness roles must still run at opus (a weak reviewer false-PASSes).
  eq(seen.reviewModels['A'], 'opus', 'portability: reviewer stays opus despite mostCapable override (A)')
  eq(seen.reviewModels['C'], 'opus', 'portability: reviewer stays opus despite mostCapable override (C)')
  eq(seen.integrationModel, 'opus', 'portability: completeness reviewer stays opus despite mostCapable override')
  // adversarial: two independent review passes per iteration (all PASS on iter 1 => 2 each).
  assert(seen.reviewCount['A'] === 2, 'portability: adversarial = 2 review passes (A, got ' + seen.reviewCount['A'] + ')')
  assert(seen.reviewCount['C'] === 2, 'portability: adversarial = 2 review passes (C, got ' + seen.reviewCount['C'] + ')')
  // testCmd threaded into the merge + integration/completeness prompts.
  assert(seen.mergeHadCmd, 'portability: testCmd threaded into merge prompt')
  assert(seen.integrationHadCmd, 'portability: testCmd threaded into integration prompt')
  assert(r.tasks.every((t) => t.status === 'done'), 'portability: all tasks done')
  console.log('scenario portability: OK')
}

// ── Scenario 7: per-task review depth — task.review overrides the run default ──
// The plan (via the orchestrating agent) marks high-stakes tasks 'adversarial'
// while routine tasks use the lean default; we should spend the extra review
// pass only where it was asked for.
async function scenarioPerTaskReview() {
  const reviewCount = {}
  const agent = async (_prompt, opts) => {
    const label = opts.label || ''
    if (label === 'setup') return { branch: 'ib', headSha: 'int0' }
    if (label.startsWith('impl:') || label.startsWith('fix:')) {
      const id = taskIdFromLabel(label)
      return { status: 'DONE', summary: 's', branch: 'wt-' + id, headSha: 'sha-' + id, commit: 'c-' + id }
    }
    if (label.startsWith('review:')) {
      const id = taskIdFromLabel(label)
      reviewCount[id] = (reviewCount[id] || 0) + 1
      return { verdict: 'PASS', issues: [] }
    }
    if (label.startsWith('merge:')) return { status: 'MERGED', headSha: 'm' }
    if (label === 'integration') return { command: 'pytest', testsPassed: true, output: 'ok', findings: [] }
    throw new Error('unexpected agent label: ' + label)
  }
  const waves = [[
    { id: 'A', title: 'high stakes', body: 'do A', tier: 'standard', review: 'adversarial' },
    { id: 'B', title: 'routine', body: 'do B', tier: 'cheap' }, // no review field -> run default
  ]]
  // No global reviewProfile -> run default is 'lean'. A opts into adversarial.
  const args = { waves, integrationBranch: 'ib', stamp: 's' }
  const r = await runWorkflow({ agent, args, budget: undefined })
  assert(reviewCount['A'] === 2, 'per-task: A (review=adversarial) gets 2 passes (got ' + reviewCount['A'] + ')')
  assert(reviewCount['B'] === 1, 'per-task: B (default lean) gets 1 pass (got ' + reviewCount['B'] + ')')
  assert(r.tasks.every((t) => t.status === 'done'), 'per-task: all done')
  console.log('scenario per-task-review: OK')
}

// ── Scenario 8: adversarial dissent — second reviewer catches what first misses ─
// The whole point of 'adversarial': a clean first reviewer must NOT shield a task
// when an independent second reviewer finds a blocker. Exercises the issue union
// (r1 ∪ r2) and the fix-loop driven by the second opinion.
async function scenarioAdversarialDissent() {
  const reviewCalls = {}
  const agent = async (_prompt, opts) => {
    const label = opts.label || ''
    if (label === 'setup') return { branch: 'ib', headSha: 'int0' }
    if (label.startsWith('impl:') || label.startsWith('fix:')) {
      const id = taskIdFromLabel(label)
      return { status: 'DONE', summary: 's', branch: 'wt-' + id, headSha: 'sha-' + id, commit: 'c-' + id }
    }
    if (label.startsWith('review:')) {
      // label is review:A:<iter>:<pass>; track per (iter,pass).
      const parts = label.split(':') // ['review','A','1','1']
      const iter = parts[2]
      const pass = parts[3]
      reviewCalls.A = (reviewCalls.A || 0) + 1
      // Round 1: reviewer 1 PASSes, reviewer 2 dissents (blocking) -> must fix.
      // Round 2 (after the fix): both PASS.
      if (iter === '1' && pass === '2') {
        return { verdict: 'FIX_REQUIRED', issues: [{ severity: 'blocking', detail: 'second reviewer caught a missing edge case' }] }
      }
      return { verdict: 'PASS', issues: [] }
    }
    if (label.startsWith('merge:')) return { status: 'MERGED', headSha: 'm' }
    if (label === 'integration') return { command: 'pytest', testsPassed: true, output: 'ok', findings: [] }
    throw new Error('unexpected agent label: ' + label)
  }
  const waves = [[{ id: 'A', title: 't', body: 'do A', tier: 'standard', review: 'adversarial' }]]
  const r = await runWorkflow({ agent, args: { waves, integrationBranch: 'ib', stamp: 's' }, budget: undefined })
  const a = r.tasks.find((t) => t.task === 'A')
  eq(a.status, 'done', 'dissent: A recovers after the fix')
  eq(a.reviewVerdict, 'fixed', "dissent: second reviewer's blocker drove a fix round")
  // 2 passes/round × 2 rounds = 4 review calls: the dissent was NOT swallowed.
  assert(reviewCalls.A === 4, 'dissent: 2 reviewers × 2 rounds = 4 review calls (got ' + reviewCalls.A + ')')
  console.log('scenario adversarial-dissent: OK')
}

// ── Scenario: invalid tierOverrides model must fail loud at launch ────────────
async function scenarioTierOverrideInvalid() {
  let threw = false
  try {
    await runWorkflow({
      agent: makeAgent(),
      args: Object.assign({}, baseArgs, { tierOverrides: { cheap: 'gpt-4' } }),
      budget: undefined,
    })
  } catch (e) {
    threw = /tierOverrides/.test(e.message) && /gpt-4/.test(e.message)
  }
  assert(threw, 'tierOverrideInvalid: invalid model alias must throw at launch, before any agent runs')
  console.log('scenario tier-override-invalid: OK')
}

// ── Scenario: setup failure must abort before any task runs (F1) ──────────────
async function scenarioSetupFailure() {
  let implRan = false
  let threw = false
  try {
    await runWorkflow({
      agent: makeAgent((label) => {
        if (label === 'setup') return { branch: 'wrong-branch', headSha: 'x' }
        if (label.startsWith('impl:')) { implRan = true }
        return undefined
      }),
      args: baseArgs, budget: undefined,
    })
  } catch (e) {
    threw = /setup failed/.test(e.message)
  }
  assert(threw, 'setupFailure: mismatched setup branch must throw')
  assert(!implRan, 'setupFailure: no implementer may run after a failed setup')
  console.log('scenario setup-failure: OK')
}

// ── Scenario: red baseline is recorded and surfaced, run continues (F15) ──────
async function scenarioBaselineRed() {
  const r = await runWorkflow({
    agent: makeAgent((label) => {
      if (label === 'setup') {
        return { branch: 'ultra/integration-sim', headSha: 'int0',
                 baselinePassed: false, baselineOutput: '2 failed, 10 passed' }
      }
      return undefined
    }),
    args: baseArgs, budget: undefined,
  })
  eq(r.baseline.passed, false, 'baselineRed: baseline failure recorded in report')
  assert(/failed/.test(r.baseline.output), 'baselineRed: baseline output kept')
  assert(r.judgmentCalls.some((j) => /baseline/.test(j)),
    'baselineRed: red baseline surfaced as a judgment call')
  assert(r.tasks.length === 3, 'baselineRed: run still proceeds (conservative, non-destructive)')
  console.log('scenario baseline-red: OK')
}

// ── Scenario: diff base = integration HEAD at wave start, threaded per wave (F3)
async function scenarioBaseShaThreading() {
  const basesSeen = {}
  const r = await runWorkflow({
    agent: makeAgent((label, prompt) => {
      if (label.startsWith('impl:') || label.startsWith('review:')) {
        const id = taskIdFromLabel(label)
        // The prompt body also says "- BASE: sha of the ..."; the threaded value is
        // the LAST "BASE: <sha>" occurrence (appended by the dispatch).
        const all = prompt.match(/BASE: \S+/g) || []
        const last = all[all.length - 1]
        basesSeen[label.split(':')[0] + ':' + id] = last && last.slice('BASE: '.length)
      }
      if (label === 'merge:wave1') return { status: 'MERGED', headSha: 'm1' }
      return undefined
    }),
    args: baseArgs, budget: undefined,
  })
  eq(basesSeen['impl:A'], 'int0', 'baseSha: wave-1 implementer base = setup HEAD')
  eq(basesSeen['review:A'], 'int0', 'baseSha: wave-1 reviewer base = setup HEAD')
  eq(basesSeen['impl:C'], 'm1', 'baseSha: wave-2 implementer base = wave-1 merge HEAD')
  eq(basesSeen['review:C'], 'm1', 'baseSha: wave-2 reviewer base = wave-1 merge HEAD')
  assert(r.tasks.every((t) => t.status === 'done'), 'baseSha: all done')
  console.log('scenario base-sha-threading: OK')
}

// ── Scenario: DONE_WITH_CONCERNS concerns reach the report; economics recorded (F4, F17)
async function scenarioConcernsPropagate() {
  const r = await runWorkflow({
    agent: makeAgent((label) => {
      if (label === 'impl:A') {
        return { status: 'DONE_WITH_CONCERNS', summary: 's', branch: 'wt-A',
                 headSha: 'sha-A', commit: 'c-A', concerns: ['reused legacy auth API'] }
      }
      return undefined
    }),
    args: baseArgs, budget: undefined,
  })
  const a = r.tasks.find((t) => t.task === 'A')
  assert(/legacy auth/.test(a.notes), 'concerns: concern lands in task notes')
  assert(r.judgmentCalls.some((j) => /A/.test(j) && /legacy auth/.test(j)),
    'concerns: concern surfaced as a judgment call')
  eq(a.fixIterations, 0, 'economics: clean task records 0 fix iterations')
  eq(a.tier, 'haiku', 'economics: resolved model recorded (A is cheap)')
  eq(a.review, 'lean', 'economics: review depth recorded')
  console.log('scenario concerns-propagate: OK')
}

// ── Scenario: completeness critic gets the plan path (F5) ─────────────────────
async function scenarioPlanPath() {
  let integrationPrompt = ''
  await runWorkflow({
    agent: makeAgent((label, prompt) => {
      if (label === 'integration') { integrationPrompt = prompt }
      return undefined
    }),
    args: Object.assign({}, baseArgs, { planPath: 'docs/superpowers/plans/feature.md' }),
    budget: undefined,
  })
  assert(integrationPrompt.includes('docs/superpowers/plans/feature.md'),
    'planPath: completeness prompt instructs reading the original plan document')
  console.log('scenario plan-path: OK')
}

await scenarioHappy()
await scenarioFixLoop()
await scenarioFixLoopExhausted()
await scenarioBlockedCascade()
await scenarioArgsThrow()
await scenarioArgsString()
await scenarioPortability()
await scenarioPerTaskReview()
await scenarioAdversarialDissent()
await scenarioTierOverrideInvalid()
await scenarioSetupFailure()
await scenarioBaselineRed()
await scenarioBaseShaThreading()
await scenarioConcernsPropagate()
await scenarioPlanPath()
console.log('ALL SCENARIOS PASSED')
