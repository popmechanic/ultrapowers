// tests/sim_workflow.mjs
//
// Deterministic simulation of skills/ultrapowers/harnesses/waves.js. The real
// research-preview Workflow engine can't run in CI, so we stub its globals
// (agent, parallel, phase, log, args, budget) and execute the orchestrator the
// same way the engine does (strip `export`, run the body as an async function).
// This validates the orchestration LOGIC — wave ordering, the bounded fix-loop,
// merge reconciliation, cascade-blocking, and the report shape — not just syntax.
//
// Self-asserting: throws (exit 1) on any failed expectation.

import fs from 'node:fs'

const WF_URL = new URL('../skills/ultrapowers/harnesses/waves.js', import.meta.url)
const SRC = fs.readFileSync(WF_URL, 'utf8').replace('export const meta', 'const meta')

function runWorkflow({ agent, args, budget, parallel: parallelOverride }) {
  const parallel = parallelOverride || ((thunks) => Promise.all(thunks.map((t) => t())))
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
    // Every dispatched prompt must START with the baked GUARD — reviewer-prompts.md
    // calls it the sole safety net; a dropped prepend at any call site must fail here.
    assert(prompt.startsWith('SAFETY: Operate ONLY inside the git worktree'),
      'GUARD must head every dispatched prompt (label=' + label + ')')
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
  let mergePrompt = ''
  const agent = async (prompt, opts) => {
    const label = opts.label || ''
    if (label === 'setup') return { branch: baseArgs.integrationBranch, headSha: 'int0' }
    if (label.startsWith('impl:') || label.startsWith('fix:')) {
      const id = taskIdFromLabel(label)
      return { status: 'DONE', summary: 'done ' + id, branch: 'wt-' + id, headSha: 'sha-' + id, commit: 'c-' + id }
    }
    if (label.startsWith('review:')) return { verdict: 'PASS', issues: [] }
    if (label.startsWith('merge:')) {
      mergePrompt = prompt
      return { status: 'MERGED', headSha: 'm-' + label }
    }
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
  assert(/git worktree remove/.test(mergePrompt), 'happy: merge prompt contains cleanup instruction (git worktree remove)')
  // acceptance-absent: no acceptance arg supplied → report.acceptance must be null
  eq(r.acceptance, null, 'happy: acceptance is null when not supplied (acceptance-absent)')
  console.log('scenario happy: OK')
}

// ── Scenario 2: fix-loop — A needs one fix round, then passes (cap 2) ─────────
async function scenarioFixLoop() {
  const reviewCalls = {}
  let fixPrompt = ''
  const agent = async (_prompt, opts) => {
    const label = opts.label || ''
    if (label === 'setup') return { branch: baseArgs.integrationBranch, headSha: 'int0' }
    if (label.startsWith('impl:') || label.startsWith('fix:')) {
      const id = taskIdFromLabel(label)
      if (label === 'fix:A:1') { fixPrompt = _prompt }
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
  assert(fixPrompt.indexOf('BASE: sha-A') !== -1, 'fixLoop: fix round anchors BASE to the prior implementation HEAD')
  assert(fixPrompt.indexOf('FIX ROUND') !== -1, 'fixLoop: fix preamble present')
  assert(fixPrompt.indexOf('locked by its own worktree') !== -1, 'fixLoop: branch-lock warning present')
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
  let reconcileHadCmd = false
  const agent = async (prompt, opts) => {
    const label = opts.label || ''
    if (label === 'setup') return { branch: baseArgs.integrationBranch, headSha: 'int0' }
    if (label.startsWith('impl:') || label.startsWith('fix:')) {
      const id = taskIdFromLabel(label)
      return { status: 'DONE', summary: 's', branch: 'wt-' + id, headSha: 'sha-' + id, commit: 'c-' + id }
    }
    if (label.startsWith('review:')) return { verdict: 'PASS', issues: [] }
    if (label.startsWith('merge:wave1')) return { status: 'CONFLICT', detail: 'merge conflict in a.txt' }
    if (label.startsWith('reconcile:')) {
      if (prompt.includes('make test')) reconcileHadCmd = true
      return { status: 'CONFLICT', detail: 'still conflicted' }
    }
    if (label.startsWith('merge:')) return { status: 'MERGED', headSha: 'm' }
    if (label === 'integration') return { command: 'pytest', testsPassed: false, output: 'n/a', findings: ['wave 1 blocked'] }
    throw new Error('unexpected agent label: ' + label)
  }
  const r = await runWorkflow({ agent, args: Object.assign({}, baseArgs, { testCmd: 'make test' }), budget: undefined })
  assert(reconcileHadCmd, 'cascade: testCmd threaded into the reconcile prompt')
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

// ── Scenario: duplicate task ids across waves refuse to launch ────────────────
async function scenarioDuplicateTaskId() {
  const waves = [
    [{ id: 'A', title: 'one', body: 'b1' }],
    [{ id: 'A', title: 'two', body: 'b2' }],
  ]
  let threw = null
  try {
    await runWorkflow({ agent: makeAgent(), args: { waves, integrationBranch: 'ib', stamp: 's' }, budget: undefined })
  } catch (e) { threw = e }
  assert(threw && /duplicate task id "A"/.test(String(threw.message)),
    'dupId: launch must throw naming the duplicated id (got ' + String(threw && threw.message) + ')')
  console.log('scenario duplicate-task-id: OK')
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
  const seen = { implModels: {}, reviewCount: {}, reviewModels: {}, integrationModel: null, mergeHadCmd: false, integrationHadCmd: false, implHadCmd: false, reviewHadCmd: false }
  const agent = async (prompt, opts) => {
    const label = opts.label || ''
    if (label === 'setup') return { branch: baseArgs.integrationBranch, headSha: 'int0' }
    if (label.startsWith('impl:') || label.startsWith('fix:')) {
      const id = taskIdFromLabel(label)
      seen.implModels[id] = opts.model
      if (prompt.includes('make test')) seen.implHadCmd = true
      return { status: 'DONE', summary: 's', branch: 'wt-' + id, headSha: 'sha-' + id, commit: 'c-' + id }
    }
    if (label.startsWith('review:')) {
      const id = taskIdFromLabel(label)
      seen.reviewCount[id] = (seen.reviewCount[id] || 0) + 1
      seen.reviewModels[id] = opts.model
      if (prompt.includes('make test')) seen.reviewHadCmd = true
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
  // ...and into the implementer/reviewer dispatches, so task agents don't guess.
  assert(seen.implHadCmd, 'portability: testCmd threaded into implementer dispatch')
  assert(seen.reviewHadCmd, 'portability: testCmd threaded into reviewer dispatch')
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

// ── Scenario: identical adversarial findings are deduped in the fix prompt ────
async function scenarioAdversarialDedupe() {
  let fixPrompt = ''
  const agent = makeAgent((label, prompt) => {
    if (label.startsWith('review:A')) {
      const iter = label.split(':')[2]
      if (iter === '1') {
        // Both independent reviewers report the SAME blocking issue.
        return { verdict: 'FIX_REQUIRED', issues: [{ severity: 'blocking', detail: 'missing null check' }] }
      }
      return { verdict: 'PASS', issues: [] }
    }
    if (label.startsWith('fix:A')) { fixPrompt = prompt }
    return undefined
  })
  const waves = [[{ id: 'A', title: 't', body: 'do A', tier: 'standard', review: 'adversarial' }]]
  const r = await runWorkflow({
    agent, args: { waves, integrationBranch: 'ultra/integration-sim', stamp: 's' }, budget: undefined,
  })
  const count = (fixPrompt.match(/missing null check/g) || []).length
  eq(count, 1, 'dedupe: identical findings from both reviewers appear once in the fix prompt')
  eq(r.tasks.find((t) => t.task === 'A').status, 'done', 'dedupe: task recovers after the fix')
  console.log('scenario adversarial-dedupe: OK')
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
  // Unknown override KEY must also throw at launch (documented alongside values).
  let keyThrew = false
  try {
    await runWorkflow({ agent: makeAgent(),
      args: Object.assign({}, baseArgs, { tierOverrides: { chepa: 'haiku' } }),
      budget: undefined })
  } catch (e) {
    keyThrew = /not a tier/.test(e.message)
  }
  assert(keyThrew, 'tierOverride: unknown override key throws at launch')
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
  let integrationPrompt = ''
  const r = await runWorkflow({
    agent: makeAgent((label, prompt) => {
      if (label === 'setup') {
        return { branch: 'ultra/integration-sim', headSha: 'int0',
                 baselinePassed: false, baselineOutput: '2 failed, 10 passed' }
      }
      if (label === 'integration') { integrationPrompt = prompt }
      return undefined
    }),
    args: baseArgs, budget: undefined,
  })
  eq(r.baseline.passed, false, 'baselineRed: baseline failure recorded in report')
  assert(/failed/.test(r.baseline.output), 'baselineRed: baseline output kept')
  assert(r.judgmentCalls.some((j) => /baseline/.test(j)),
    'baselineRed: red baseline surfaced as a judgment call')
  assert(r.tasks.length === 3, 'baselineRed: run still proceeds (conservative, non-destructive)')
  // The completeness critic must know the suite was red BEFORE any task ran, so
  // it can tell inherited failures from introduced ones when it re-runs tests.
  assert(/[Bb]aseline/.test(integrationPrompt) && /FAILED/.test(integrationPrompt),
    'baselineRed: red baseline threaded into the completeness prompt')
  console.log('scenario baseline-red: OK')
}

// ── Scenario: exhausted budget defers every wave, runs nothing ────────────────
async function scenarioBudgetExhausted() {
  let agentCalls = 0
  const inner = makeAgent()
  const r = await runWorkflow({
    agent: async (prompt, opts) => { agentCalls += 1; return inner(prompt, opts) },
    args: baseArgs, budget: { total: 100, remaining: 0 },
  })
  assert(agentCalls === 0, 'budget: NO agents dispatched at all (setup and integration included)')
  eq(r.tasks, [], 'budget: no task results')
  eq(r.tests.passed, false, 'budget: tests reported not-passed (not run)')
  assert(['A', 'B', 'C'].every((id) => r.unfinished.some((u) => u.startsWith(id + ':') && /budget/.test(u))),
    'budget: every task surfaced as deferred, none silently dropped')
  assert(r.judgmentCalls.some((j) => /budget exhausted before setup/.test(j)),
    'budget: deferral recorded as a judgment call')
  console.log('scenario budget-exhausted: OK')
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

// ── Scenario: FIX_REQUIRED verdict with zero blocking issues is flagged (F7) ──
async function scenarioVerdictMismatch() {
  const r = await runWorkflow({
    agent: makeAgent((label) => {
      if (label === 'review:A:1') {
        return { verdict: 'FIX_REQUIRED', issues: [{ severity: 'minor', detail: 'nit' }] }
      }
      return undefined
    }),
    args: baseArgs, budget: undefined,
  })
  const a = r.tasks.find((t) => t.task === 'A')
  eq(a.status, 'done', 'verdictMismatch: severity rule still decides (merges)')
  assert(r.judgmentCalls.some((j) => /A/.test(j) && /FIX_REQUIRED/.test(j)),
    'verdictMismatch: the inconsistency is surfaced, not swallowed')
  console.log('scenario verdict-mismatch: OK')
}

// ── Scenario: NEEDS_CONTEXT after a fix re-dispatch fails the task (F8) ───────
async function scenarioNeedsContextAfterFix() {
  let reviews = 0
  const r = await runWorkflow({
    agent: makeAgent((label) => {
      if (label.startsWith('review:A')) {
        reviews += 1
        return { verdict: 'FIX_REQUIRED', issues: [{ severity: 'blocking', detail: 'broken' }] }
      }
      if (label.startsWith('fix:A')) {
        return { status: 'NEEDS_CONTEXT', summary: 'which auth provider?', branch: 'wt-A' }
      }
      return undefined
    }),
    args: baseArgs, budget: undefined,
  })
  const a = r.tasks.find((t) => t.task === 'A')
  eq(a.status, 'failed', 'needsContext: task fails instead of re-reviewing')
  assert(reviews === 1, 'needsContext: no second review after NEEDS_CONTEXT (got ' + reviews + ')')
  assert(/auth provider/.test(a.notes), 'needsContext: the open question is surfaced')
  console.log('scenario needs-context-after-fix: OK')
}

// ── Scenario: resume reuses the existing integration branch (F16) ─────────────
async function scenarioResume() {
  let setupPrompt = ''
  const r = await runWorkflow({
    agent: makeAgent((label, prompt) => {
      if (label === 'setup') { setupPrompt = prompt }
      return undefined
    }),
    args: Object.assign({}, baseArgs, { resume: true }),
    budget: undefined,
  })
  assert(/EXISTING/.test(setupPrompt) && setupPrompt.includes('ultra/integration-sim'),
    'resume: setup told to check out the EXISTING integration branch')
  assert(!/checkout -b/.test(setupPrompt), 'resume: setup must not create a new branch')
  assert(r.tasks.every((t) => t.status === 'done'), 'resume: redirect tasks ran')
  console.log('scenario resume: OK')
}

// ── Scenario: resume without an explicit integrationBranch fails loud ─────────
async function scenarioResumeRequiresBranch() {
  let threw = false
  try {
    await runWorkflow({
      agent: makeAgent(),
      args: { waves: WAVES, stamp: 'sim', resume: true },
      budget: undefined,
    })
  } catch (e) {
    threw = /resume requires/.test(e.message)
  }
  assert(threw, 'resumeRequiresBranch: resume with a defaulted branch must throw')
  console.log('scenario resume-requires-branch: OK')
}

// ── Scenario: agent-throw-degrades — a thrown impl agent costs ONE task ────────
// parallel() is fail-fast; an uncaught throw would lose the whole wave's report.
// The runTask wrapper must degrade to {status:'failed', reviewVerdict:'agent-error'}.
async function scenarioAgentThrowDegrades() {
  const waves = [
    [
      { id: 'X', title: 'throw task', body: 'task X', tier: 'cheap' },
      { id: 'Y', title: 'sibling task', body: 'task Y', tier: 'cheap' },
    ],
  ]
  const args = { waves, integrationBranch: 'ultra/integration-sim', stamp: 'sim' }
  const r = await runWorkflow({
    agent: makeAgent((label) => {
      if (label === 'impl:X') throw new Error('engine fault: schema mismatch')
      return undefined
    }),
    args, budget: undefined,
  })
  assert(r !== undefined && r.tasks !== undefined, 'agentThrow: run returned a report')
  const x = r.tasks.find((t) => t.task === 'X')
  const y = r.tasks.find((t) => t.task === 'Y')
  assert(x !== undefined, 'agentThrow: X appears in tasks')
  eq(x.status, 'failed', 'agentThrow: thrown task status is failed')
  eq(x.reviewVerdict, 'agent-error', 'agentThrow: thrown task reviewVerdict is agent-error')
  assert(y !== undefined, 'agentThrow: sibling Y appears in tasks')
  eq(y.status, 'done', 'agentThrow: sibling Y is done (parallel did not lose it)')
  assert(r.judgmentCalls.some((j) => /X/.test(j) && /engine fault/.test(j)),
    'agentThrow: judgmentCalls mentions the error')
  console.log('scenario agent-throw-degrades: OK')
}

// ── Scenario: merged-without-headsha — MERGED result missing headSha is surfaced ─
async function scenarioMergedWithoutHeadSha() {
  const waves = [
    [{ id: 'A', title: 'task A', body: 'do A', tier: 'cheap' }],
  ]
  const args = { waves, integrationBranch: 'ultra/integration-sim', stamp: 'sim' }
  const r = await runWorkflow({
    agent: makeAgent((label) => {
      if (label.startsWith('merge:')) return { status: 'MERGED' } // no headSha
      return undefined
    }),
    args, budget: undefined,
  })
  assert(r !== undefined, 'mergedWithoutHeadSha: run completed')
  assert(r.judgmentCalls.some((j) => /without headSha/.test(j)),
    'mergedWithoutHeadSha: judgmentCalls contains an entry matching /without headSha/')
  console.log('scenario merged-without-headsha: OK')
}

// ── Scenario: meta-absent-engine — entire meta declaration stripped ────────────
// Simulates engines that extract meta at parse time and do not expose the
// binding to the executing body. The typeof guard must handle this gracefully.
async function scenarioMetaAbsentEngine() {
  // Strip the entire `export const meta = { ... }` block (multi-line object literal)
  // by removing from 'export const meta' up through the closing '}\n' of that block.
  const srcWithoutMeta = SRC.replace(/const meta\s*=\s*\{[^}]*\}\s*\n/, '')
  assert(srcWithoutMeta !== SRC, 'metaAbsent: the regex actually stripped the meta block — update it if meta gained nesting')
  const parallel = (thunks) => Promise.all(thunks.map((t) => t()))
  const phase = () => {}
  const log = () => {}
  const agent = makeAgent()
  const args = baseArgs
  const budget = undefined
  const factory = new Function(
    'agent', 'parallel', 'phase', 'log', 'args', 'budget',
    '"use strict"; return (async () => {\n' + srcWithoutMeta + '\n})();'
  )
  const r = await factory(agent, parallel, phase, log, args, budget)
  assert(r !== undefined && r.tasks !== undefined, 'metaAbsent: run completed (typeof guard holds)')
  assert(r.tasks.every((t) => t.status === 'done'), 'metaAbsent: all tasks done')
  console.log('scenario meta-absent-engine: OK')
}

// ── Scenario: dependent-blocked-by-failed-task ────────────────────────────────
// waves [[A, X],[B]] with args.edges=[["A","B"]]; A's review stub returns
// blocking issues twice (fix-loop exhaustion -> A failed); X passes; wave 1
// merges successfully (X's branch lands); B is in wave 2 but depends on A
// which never landed. The dep-cascade must block B before dispatch.
async function scenarioDependentBlockedByFailedTask() {
  const implCalled = new Set()
  const waves = [
    [
      { id: 'A', title: 'task A', body: 'do A', tier: 'cheap' },
      { id: 'X', title: 'task X', body: 'do X', tier: 'cheap' },
    ],
    [{ id: 'B', title: 'task B', body: 'do B', tier: 'cheap' }],
  ]
  const args = {
    waves,
    integrationBranch: 'ultra/integration-sim',
    stamp: 'sim',
    edges: [['A', 'B']],
  }
  const r = await runWorkflow({
    agent: makeAgent((label) => {
      if (label.startsWith('impl:') || label.startsWith('fix:')) {
        const id = taskIdFromLabel(label)
        implCalled.add(id)
        return { status: 'DONE', summary: 's', branch: 'wt-' + id, headSha: 'sha-' + id, commit: 'c-' + id }
      }
      if (label.startsWith('review:')) {
        const id = taskIdFromLabel(label)
        // A always returns blocking issues -> fix-loop exhaustion -> failed
        if (id === 'A') {
          return { verdict: 'FIX_REQUIRED', issues: [{ severity: 'blocking', detail: 'always broken' }] }
        }
        return { verdict: 'PASS', issues: [] }
      }
      return undefined
    }),
    args, budget: undefined,
  })
  assert(!implCalled.has('B'), 'depBlocked: B impl must never dispatch (no impl:B stub call)')
  assert(r.unfinished.some((u) => /B: blocked — depends on a failed task/.test(u)),
    'depBlocked: unfinished contains B: blocked — depends on a failed task')
  assert(r !== undefined && r.tasks !== undefined, 'depBlocked: report still returned')
  const a = r.tasks.find((t) => t.task === 'A')
  eq(a.status, 'failed', 'depBlocked: A failed (fix-loop exhausted)')
  eq(a.reviewVerdict, 'fix-loop-exhausted', 'depBlocked: A reviewVerdict fix-loop-exhausted')
  console.log('scenario dependent-blocked-by-failed-task: OK')
}

// ── Scenario: chunk-cap — 17-task wave must not exceed engine's 16-agent cap ────
async function scenarioChunkCap() {
  const tasks = Array.from({ length: 17 }, (_, i) =>
    ({ id: 'T' + i, title: 't' + i, body: 'do ' + i, tier: 'cheap' }))
  const args = { waves: [tasks], integrationBranch: 'ultra/integration-sim', stamp: 'sim' }
  const batchSizes = []
  const parallel = (thunks) => { batchSizes.push(thunks.length); return Promise.all(thunks.map((t) => t())) }
  const r = await runWorkflow({ agent: makeAgent(), args, budget: undefined, parallel })
  assert(Math.max(...batchSizes) <= 16, 'chunkCap: no parallel batch exceeds the 16-agent engine cap')
  eq(batchSizes.reduce((a, b) => a + b, 0), 17, 'chunkCap: every task dispatched exactly once')
  eq(r.tasks.length, 17, 'chunkCap: 17 task results')
  assert(r.tasks.every((t) => t.status === 'done'), 'chunkCap: all 17 done')
  console.log('scenario chunk-cap: OK')
}

// ── Scenario: transitive dep-block — closure blocks C via B via failed A ──────
async function scenarioTransitiveDepBlock() {
  const implCalled = new Set()
  const waves = [
    [
      { id: 'A', title: 'task A', body: 'do A', tier: 'cheap' },
      { id: 'X', title: 'task X', body: 'do X', tier: 'cheap' },
    ],
    [
      { id: 'B', title: 'task B', body: 'do B', tier: 'cheap' },
      { id: 'C', title: 'task C', body: 'do C', tier: 'cheap' },
      { id: 'Y', title: 'task Y', body: 'do Y', tier: 'cheap' },
    ],
  ]
  const args = { waves, integrationBranch: 'ultra/integration-sim', stamp: 'sim',
                 edges: [['A', 'B'], ['B', 'C']] }
  const r = await runWorkflow({
    agent: makeAgent((label) => {
      if (label.startsWith('impl:') || label.startsWith('fix:')) {
        implCalled.add(taskIdFromLabel(label))
        return undefined            // fall through to the default DONE stub
      }
      if (label.startsWith('review:') && taskIdFromLabel(label) === 'A') {
        return { verdict: 'FIX_REQUIRED', issues: [{ severity: 'blocking', detail: 'always broken' }] }
      }
      return undefined
    }),
    args, budget: undefined,
  })
  assert(!implCalled.has('B'), 'transitive: direct dependent B never dispatched')
  assert(!implCalled.has('C'), 'transitive: TRANSITIVE dependent C never dispatched')
  assert(implCalled.has('Y'), 'transitive: unrelated sibling Y did dispatch')
  assert(r.unfinished.some((u) => /^B: blocked/.test(u)) && r.unfinished.some((u) => /^C: blocked/.test(u)),
    'transitive: B and C both surfaced in unfinished')
  const y = r.tasks.find((t) => t.task === 'Y')
  eq(y && y.status, 'done', 'transitive: Y completed')
  console.log('scenario transitive-dep-block: OK')
}

// ── Scenario: fully dep-blocked wave does NOT cascade ─────────────────────────
async function scenarioFullyBlockedWaveDoesNotCascade() {
  const implCalled = new Set()
  let wave1MergeHeadSha = null
  let zImplBase = null
  const waves = [
    [
      { id: 'A', title: 'task A', body: 'do A', tier: 'cheap' },
      { id: 'X', title: 'task X', body: 'do X', tier: 'cheap' },
    ],
    [{ id: 'B', title: 'task B', body: 'do B', tier: 'cheap' }],
    [{ id: 'Z', title: 'task Z', body: 'do Z', tier: 'cheap' }],
  ]
  const args = { waves, integrationBranch: 'ultra/integration-sim', stamp: 'sim',
                 edges: [['A', 'B']] }
  const r = await runWorkflow({
    agent: makeAgent((label, prompt) => {
      if (label.startsWith('impl:') || label.startsWith('fix:')) {
        implCalled.add(taskIdFromLabel(label))
        if (label === 'impl:Z') {
          // Capture the LAST "BASE: <sha>" from Z's implementer prompt
          const all = prompt.match(/BASE: \S+/g) || []
          const last = all[all.length - 1]
          zImplBase = last && last.slice('BASE: '.length)
        }
        return undefined
      }
      if (label.startsWith('review:') && taskIdFromLabel(label) === 'A') {
        return { verdict: 'FIX_REQUIRED', issues: [{ severity: 'blocking', detail: 'always broken' }] }
      }
      if (label === 'merge:wave1') {
        const result = { status: 'MERGED', headSha: 'w1-merge-head' }
        wave1MergeHeadSha = result.headSha
        return result
      }
      return undefined
    }),
    args, budget: undefined,
  })
  assert(!implCalled.has('B'), 'noCascade: dep-blocked B never dispatched')
  assert(implCalled.has('Z'), 'noCascade: unrelated wave-3 task Z DID dispatch')
  const zr = r.tasks.find((t) => t.task === 'Z')
  eq(zr && zr.status, 'done', 'noCascade: Z completed')
  const w2 = r.waveMerges.find((m) => m.wave === 2)
  eq(w2 && w2.status, 'SKIPPED', 'noCascade: wave-2 merge recorded SKIPPED')
  eq(r.blockedWaves, [], 'noCascade: no wave recorded blocked')
  assert(!r.unfinished.some((u) => /cascade-blocked/.test(u)), 'noCascade: nothing cascade-blocked')
  // Review base stays frozen across the SKIPPED wave: Z must build on wave-1's
  // merge headSha, not on a stale or corrupted value from the skipped wave.
  assert(wave1MergeHeadSha !== null, 'noCascade: wave-1 merge captured a headSha')
  eq(zImplBase, wave1MergeHeadSha, 'noCascade: Z implementer BASE equals wave-1 merge headSha — SKIPPED wave 2 did not advance or corrupt the review base')
  console.log('scenario fully-blocked-wave-no-cascade: OK')
}

// ── Scenario: baseBranch threading — setup prompt carries checkout instruction ─
// workflow.js threads args.baseBranch into the setup prompt so the setup agent
// checks out the base branch before creating the integration branch. When
// baseBranch is absent, the sentence must not appear.
async function scenarioBaseBranchThreaded() {
  let setupPromptWith = ''
  let setupPromptWithout = ''

  // With baseBranch supplied
  const agentWith = makeAgent((label, prompt) => {
    if (label === 'setup') { setupPromptWith = prompt }
    return undefined
  })
  await runWorkflow({
    agent: agentWith,
    args: Object.assign({}, baseArgs, { baseBranch: 'main' }),
    budget: undefined,
  })
  assert(/Check out the base branch main/.test(setupPromptWith),
    'baseBranch: setup prompt contains "Check out the base branch main" when baseBranch supplied')

  // Without baseBranch
  const agentWithout = makeAgent((label, prompt) => {
    if (label === 'setup') { setupPromptWithout = prompt }
    return undefined
  })
  await runWorkflow({
    agent: agentWithout,
    args: baseArgs,
    budget: undefined,
  })
  assert(!/Check out the base branch/.test(setupPromptWithout),
    'baseBranch: setup prompt does NOT contain "Check out the base branch" when baseBranch is absent')

  console.log('scenario baseBranch-threaded: OK')
}

// ── Scenario: reconcile tracks mostCapable tier override ──────────────────────
// From reviewer-prompts.md: "reconcile is a fixer, not a reviewer, so it tracks
// the implementer-side mostCapable". With tierOverrides: { mostCapable: 'sonnet' },
// the reconcile agent must receive opts.model === 'sonnet', while the reviewer
// must stay 'opus' (OVERRIDE-PROOF).
// Also asserts setup and merge:wave* labels follow the overridden cheap tier,
// pinning the last untested clause of the documented tier routing.
async function scenarioReconcileTierOverride() {
  let reconcileModel = null
  let reviewerModel = null
  const modelsByLabel = {}

  const agent = async (prompt, opts) => {
    const label = opts.label || ''
    modelsByLabel[label] = opts.model
    if (label === 'setup') return { branch: baseArgs.integrationBranch, headSha: 'int0' }
    if (label.startsWith('impl:') || label.startsWith('fix:')) {
      const id = taskIdFromLabel(label)
      return { status: 'DONE', summary: 's', branch: 'wt-' + id, headSha: 'sha-' + id, commit: 'c-' + id }
    }
    if (label.startsWith('review:')) {
      reviewerModel = opts.model
      return { verdict: 'PASS', issues: [] }
    }
    if (label.startsWith('merge:wave1')) {
      // Return CONFLICT so reconcile is dispatched
      return { status: 'CONFLICT', detail: 'simulated conflict' }
    }
    if (label.startsWith('reconcile:')) {
      reconcileModel = opts.model
      return { status: 'MERGED', headSha: 'reconciled-sha' }
    }
    if (label.startsWith('merge:')) return { status: 'MERGED', headSha: 'm' }
    if (label === 'integration') return { command: 'pytest', testsPassed: true, output: 'ok', findings: [] }
    throw new Error('unexpected agent label: ' + label)
  }

  await runWorkflow({
    agent,
    args: Object.assign({}, baseArgs, { tierOverrides: { cheap: 'sonnet', mostCapable: 'sonnet' } }),
    budget: undefined,
  })

  assert(reconcileModel !== null, 'reconcileTier: reconcile agent was actually dispatched')
  eq(reconcileModel, 'sonnet', 'reconcileTier: reconcile uses overridden mostCapable model (sonnet)')
  eq(reviewerModel, 'opus', 'reconcileTier: reviewer stays opus despite mostCapable override (OVERRIDE-PROOF)')
  // setup uses cheap tier; merge:wave* uses cheap tier — both must follow the override
  eq(modelsByLabel['setup'], 'sonnet', 'reconcileTier: setup uses overridden cheap model (sonnet)')
  const mergeWaveLabel = Object.keys(modelsByLabel).find((l) => /^merge:wave/.test(l))
  assert(mergeWaveLabel !== undefined, 'reconcileTier: a merge:wave* agent was dispatched')
  eq(modelsByLabel[mergeWaveLabel], 'sonnet', 'reconcileTier: merge:wave* uses overridden cheap model (sonnet) (label=' + mergeWaveLabel + ')')
  console.log('scenario reconcile-tier-override: OK')
}

// ── Scenario: done-without-headSha is not mergeable ───────────────────────────
async function scenarioDoneWithoutHeadShaNotMerged() {
  let mergePrompt = null
  const reviewed = new Set()
  const waves = [
    [
      { id: 'A', title: 'task A', body: 'do A', tier: 'cheap' },
      { id: 'G', title: 'good task', body: 'do G', tier: 'cheap' },
    ],
  ]
  const args = { waves, integrationBranch: 'ultra/integration-sim', stamp: 'sim' }
  const r = await runWorkflow({
    agent: makeAgent((label, prompt) => {
      if (label.startsWith('review:')) reviewed.add(taskIdFromLabel(label))
      if (label === 'impl:A') {
        return { status: 'DONE', summary: 's', branch: 'wt-A', commit: 'c-A' } // no headSha
      }
      if (label.startsWith('merge:')) {
        mergePrompt = prompt
        return { status: 'MERGED', headSha: 'm1' }
      }
      return undefined
    }),
    args, budget: undefined,
  })
  assert(mergePrompt !== null, 'noHeadSha: wave still merged (G is mergeable)')
  assert(mergePrompt.indexOf('wt-A') === -1, 'noHeadSha: branch without headSha excluded from the merge list')
  assert(mergePrompt.indexOf('wt-G') !== -1, 'noHeadSha: good branch merged')
  // Fix A: the lost-done must be surfaced in judgmentCalls and treated as failed
  assert(r.judgmentCalls.some((j) => /without mergeable coordinates/.test(j)),
    'noHeadSha: lost-done surfaced in judgmentCalls with "without mergeable coordinates"')
  const aTask = r.tasks.find((t) => t.task === 'A')
  eq(aTask && aTask.status, 'failed', 'noHeadSha: A task record has status failed (not done)')
  // Fix C: lost-done record must carry reviewVerdict 'lost-coordinates' and notes mentioning 'downgraded'
  eq(aTask && aTask.reviewVerdict, 'lost-coordinates', 'noHeadSha: A reviewVerdict is lost-coordinates (not clean)')
  assert(aTask && aTask.notes && /downgraded/.test(aTask.notes),
    'noHeadSha: A notes mention "downgraded" (got ' + (aTask && aTask.notes) + ')')
  // Hardening: a coordinate-less DONE fails fast BEFORE review — no opus
  // review is spent on a pipeline that cannot merge (GUARD would force a
  // BLOCKED state the reviewer schema cannot express).
  assert(!reviewed.has('A'), 'noHeadSha: no review dispatched for the coordinate-less task')
  assert(reviewed.has('G'), 'noHeadSha: the good task was still reviewed')
  console.log('scenario done-without-headsha-not-merged: OK')
}

// ── Scenario: malformed edges (object-shaped) must throw at launch ────────────
async function scenarioMalformedEdgesThrow() {
  let threw = false
  try {
    await runWorkflow({
      agent: makeAgent(),
      args: Object.assign({}, baseArgs, {
        edges: [{ from: 'A', to: 'C', why: 'marker' }], // object, not [from, to] pair
      }),
      budget: undefined,
    })
  } catch (e) {
    threw = /args\.edges\[0\]/.test(e.message)
  }
  assert(threw, 'malformedEdges: object-shaped edge must throw with message matching /args\\.edges\\[0\\]/')
  console.log('scenario malformed-edges-throw: OK')
}

// ── Scenario: no edges + zero-mergeable wave must cascade-block later waves ────
// waves [[A],[B]], NO edges; A's reviewer always returns blocking (fix-loop
// exhaustion -> A failed -> wave 1 has zero mergeable). Without edges, the
// SKIPPED-continue path is unsafe: later waves assume the prerequisite landed.
// Fix A (in workflow.js) requires a conservative cascade-break instead.
//
// Second leg: edges: [] EXPLICITLY SUPPLIED — the compiler proved independence.
// A zero-mergeable wave with explicit edges=[] must NOT cascade; wave 2 dispatches
// and completes, wave 1 merge records SKIPPED, blockedWaves stays empty.
async function scenarioNoEdgesZeroMergeableCascades() {
  // ── Leg 1: NO edges supplied (omitted) — cascade expected ────────────────────
  const implCalled = new Set()
  const waves = [
    [{ id: 'A', title: 'task A', body: 'do A', tier: 'cheap' }],
    [{ id: 'B', title: 'task B', body: 'do B', tier: 'cheap' }],
  ]
  const args = { waves, integrationBranch: 'ultra/integration-sim', stamp: 'sim' }
  // NO edges supplied
  const r = await runWorkflow({
    agent: makeAgent((label) => {
      if (label.startsWith('impl:') || label.startsWith('fix:')) {
        implCalled.add(taskIdFromLabel(label))
        return undefined // fall through to default DONE stub
      }
      if (label.startsWith('review:') && taskIdFromLabel(label) === 'A') {
        // A always has a blocking review => fix-loop exhaustion => failed
        return { verdict: 'FIX_REQUIRED', issues: [{ severity: 'blocking', detail: 'always broken' }] }
      }
      return undefined
    }),
    args, budget: undefined,
  })
  assert(!implCalled.has('B'), 'noEdgesCascade: B must never dispatch when A failed with no edges')
  assert(r.blockedWaves.length === 1, 'noEdgesCascade: one blocked wave recorded (got ' + r.blockedWaves.length + ')')
  assert(r.unfinished.some((u) => /B/.test(u) && /cascade-blocked/.test(u)),
    'noEdgesCascade: B surfaced in unfinished with cascade-blocked')

  // ── Leg 2: edges: [] EXPLICITLY SUPPLIED — compiler proved independence ──────
  // A zero-mergeable wave 1 with edges=[] must NOT cascade; wave 2 dispatches
  // and completes normally; wave 1 merge records SKIPPED; blockedWaves stays empty.
  const implCalled2 = new Set()
  const waves2 = [
    [{ id: 'A', title: 'task A', body: 'do A', tier: 'cheap' }],
    [{ id: 'B', title: 'task B', body: 'do B', tier: 'cheap' }],
  ]
  const args2 = { waves: waves2, integrationBranch: 'ultra/integration-sim', stamp: 'sim', edges: [] }
  const r2 = await runWorkflow({
    agent: makeAgent((label) => {
      if (label.startsWith('impl:') || label.startsWith('fix:')) {
        implCalled2.add(taskIdFromLabel(label))
        return undefined
      }
      if (label.startsWith('review:') && taskIdFromLabel(label) === 'A') {
        return { verdict: 'FIX_REQUIRED', issues: [{ severity: 'blocking', detail: 'always broken' }] }
      }
      return undefined
    }),
    args: args2, budget: undefined,
  })
  assert(implCalled2.has('B'), 'noEdgesExplicit: B dispatched when edges=[] (compiler proved independence)')
  eq(r2.blockedWaves, [], 'noEdgesExplicit: blockedWaves empty when edges=[] supplied (got ' + JSON.stringify(r2.blockedWaves) + ')')
  const w1merge2 = r2.waveMerges.find((m) => m.wave === 1)
  eq(w1merge2 && w1merge2.status, 'SKIPPED', 'noEdgesExplicit: wave-1 merge is SKIPPED (no mergeable branches, but no cascade)')
  assert(!r2.unfinished.some((u) => /cascade-blocked/.test(u)), 'noEdgesExplicit: nothing cascade-blocked when edges=[] supplied')

  console.log('scenario no-edges-zero-mergeable-cascades: OK')
}

// ── Scenario: lost-done blocks dependents (cross-wave and intra-wave chunks) ───
// Fix B: the lost-done sweep must run inside the chunk loop so the NEXT chunk
// sees the downgrade before dispatching intra-wave dependents.
async function scenarioLostDoneBlocksDependents() {
  // ── Leg (a): cross-wave — waves [[A],[B]], edges [['A','B']] ─────────────────
  // A returns DONE without headSha => downgraded to failed => B in wave 2 never dispatches.
  const implCalledA = new Set()
  const wavesA = [
    [{ id: 'A', title: 'task A', body: 'do A', tier: 'cheap' }],
    [{ id: 'B', title: 'task B', body: 'do B', tier: 'cheap' }],
  ]
  const argsA = { waves: wavesA, integrationBranch: 'ultra/integration-sim', stamp: 'sim',
                  edges: [['A', 'B']] }
  const rA = await runWorkflow({
    agent: makeAgent((label) => {
      if (label.startsWith('impl:') || label.startsWith('fix:')) {
        implCalledA.add(taskIdFromLabel(label))
        if (taskIdFromLabel(label) === 'A') {
          // DONE without headSha — lost-done
          return { status: 'DONE', summary: 's', branch: 'wt-A', commit: 'c-A' }
        }
        return undefined
      }
      return undefined
    }),
    args: argsA, budget: undefined,
  })
  assert(!implCalledA.has('B'), 'lostDoneBlocks (cross-wave): impl:B must never dispatch when A is lost-done')
  assert(rA.unfinished.some((u) => /^B: blocked/.test(u)),
    'lostDoneBlocks (cross-wave): B surfaced in unfinished as blocked')

  // ── Leg (b): intra-wave across chunks — 17-task wave, edges [['T0','T16']] ───
  // T0 in chunk 1 returns DONE without headSha => downgraded to failed inside chunk loop.
  // T16 in chunk 2 must see the failure BEFORE dispatch and never be dispatched.
  // This test FAILS before Fix B (the sweep ran only after all chunks).
  const tasks17 = Array.from({ length: 17 }, (_, i) =>
    ({ id: 'T' + i, title: 't' + i, body: 'do ' + i, tier: 'cheap' }))
  const argsB = { waves: [tasks17], integrationBranch: 'ultra/integration-sim', stamp: 'sim',
                  edges: [['T0', 'T16']] }
  const implCalledB = new Set()
  const rB = await runWorkflow({
    agent: makeAgent((label) => {
      if (label.startsWith('impl:') || label.startsWith('fix:')) {
        const id = taskIdFromLabel(label)
        implCalledB.add(id)
        if (id === 'T0') {
          // DONE without headSha — lost-done; must be swept before chunk 2 runs
          return { status: 'DONE', summary: 's', branch: 'wt-T0', commit: 'c-T0' }
        }
        return undefined
      }
      return undefined
    }),
    args: argsB, budget: undefined,
  })
  assert(!implCalledB.has('T16'), 'lostDoneBlocks (intra-wave): impl:T16 must never dispatch (Fix B)')
  assert(rB.unfinished.some((u) => /^T16: blocked/.test(u)),
    'lostDoneBlocks (intra-wave): T16 surfaced in unfinished as blocked')

  console.log('scenario lost-done-blocks-dependents: OK')
}

// ── Scenario: mid-run budget deferral ─────────────────────────────────────────
// A budget whose remaining() counter hits 0 after wave 1 completes must defer
// all later waves; the integration review must still run; judgmentCalls must
// include exactly one entry matching /budget exhausted mid-run/; no impl: dispatch
// occurs after the budget flips; the report's tests field is populated.
async function scenarioMidRunBudgetDeferral() {
  // Budget: start at 2, decrement each call; wave 1 uses 1 call, so hits 0 for wave 2.
  // We flip a flag after wave 1's merge agent is called so wave 2 sees remaining=0.
  let mergeWave1Called = false
  let budgetRemaining = 2

  const budget = {
    total: 2,
    remaining: () => {
      // After wave 1 merge completes, budget is exhausted
      return mergeWave1Called ? 0 : budgetRemaining
    },
  }

  const waves = [
    [{ id: 'A', title: 'task A', body: 'do A', tier: 'cheap' }],
    [{ id: 'B', title: 'task B', body: 'do B', tier: 'cheap' }],
  ]
  const args = { waves, integrationBranch: 'ultra/integration-sim', stamp: 'sim' }
  const implDispatched = []

  const r = await runWorkflow({
    agent: makeAgent((label, prompt, opts) => {
      if (label.startsWith('impl:')) {
        implDispatched.push(label)
        return undefined
      }
      if (label.startsWith('merge:wave1')) {
        // After this merge returns, budget is exhausted for wave 2
        mergeWave1Called = true
        return { status: 'MERGED', headSha: 'w1-head' }
      }
      return undefined
    }),
    args, budget,
  })

  // Wave 2 tasks must be in unfinished with budget-exhausted entries
  assert(r.unfinished.some((u) => /^B:/.test(u) && /budget exhausted/.test(u)),
    'midRunBudget: B in unfinished with budget exhausted (got ' + JSON.stringify(r.unfinished) + ')')
  // Exactly one judgmentCall matching /budget exhausted mid-run/
  const midRunCalls = r.judgmentCalls.filter((j) => /budget exhausted mid-run/.test(j))
  eq(midRunCalls.length, 1, 'midRunBudget: exactly one judgmentCall matching /budget exhausted mid-run/ (got ' + midRunCalls.length + ')')
  // No impl: dispatches after the budget flips (only A dispatched before flip, B never)
  assert(!implDispatched.some((l) => l === 'impl:B'), 'midRunBudget: impl:B never dispatched after budget exhausted')
  // Integration review still runs (tests field populated)
  assert(r.tests !== undefined && r.tests.passed !== undefined,
    'midRunBudget: integration review ran and tests field is populated')
  // tests field should reflect the integration agent's response
  assert(r.tests.command !== undefined || r.tests.output !== undefined,
    'midRunBudget: integration review output is present')

  console.log('scenario mid-run-budget-deferral: OK')
}

// ── Scenario: intra-wave edge respected across 16-task chunks ─────────────────
async function scenarioIntraWaveDepAcrossChunks() {
  const tasks = Array.from({ length: 17 }, (_, i) =>
    ({ id: 'T' + i, title: 't' + i, body: 'do ' + i, tier: 'cheap' }))
  const args = { waves: [tasks], integrationBranch: 'ultra/integration-sim', stamp: 'sim',
                 edges: [['T0', 'T16']] }
  const implCalled = new Set()
  const r = await runWorkflow({
    agent: makeAgent((label) => {
      if (label.startsWith('impl:') || label.startsWith('fix:')) {
        implCalled.add(taskIdFromLabel(label))
        return undefined
      }
      if (label.startsWith('review:') && taskIdFromLabel(label) === 'T0') {
        return { verdict: 'FIX_REQUIRED', issues: [{ severity: 'blocking', detail: 'always broken' }] }
      }
      return undefined
    }),
    args, budget: undefined,
  })
  assert(!implCalled.has('T16'), 'chunkDep: chunk-2 dependent of failed chunk-1 task never dispatched')
  assert(r.unfinished.some((u) => /^T16: blocked/.test(u)), 'chunkDep: T16 surfaced in unfinished')
  eq(r.tasks.filter((t) => t.status === 'done').length, 15, 'chunkDep: the other 15 completed')
  console.log('scenario intra-wave-dep-across-chunks: OK')
}


// ── Scenario: typo'd review depth and unknown baseline reach judgmentCalls ────
async function scenarioTypoReviewAndUnknownBaseline() {
  const waves = [
    [{ id: 'A', title: 'task A', body: 'do A', tier: 'opus', review: 'agressive' }],
  ]
  const args = { waves, integrationBranch: 'ultra/integration-sim', stamp: 'sim' }
  const r = await runWorkflow({
    agent: makeAgent((label) => {
      if (label === 'setup') {
        // Schema-legal setup report that omits baselinePassed entirely.
        return { branch: 'ultra/integration-sim', headSha: 'int0' }
      }
      return undefined
    }),
    args, budget: undefined,
  })
  assert(r.judgmentCalls.some((j) => /unknown review/.test(j) && /agressive/.test(j)),
    'typoReview: typo\'d task.review surfaced as a judgment call, not just a log line')
  assert(r.judgmentCalls.some((j) => /unknown tier/.test(j) && /opus/.test(j)),
    'typoReview: typo\'d task.tier surfaced as a judgment call (alias, not a tier name)')
  assert(r.judgmentCalls.some((j) => /baseline unknown/.test(j)),
    'typoReview: setup omitting baselinePassed surfaced as a judgment call')
  assert(r.baseline && r.baseline.passed === undefined, 'typoReview: baseline.passed stays undefined (not coerced)')
  const a = r.tasks.find((t) => t.task === 'A')
  eq(a && a.status, 'done', 'typoReview: task still completes on the run-default review depth')
  // Second leg: baselinePassed: null (the natural JSON for "unknown") must hit
  // the same unknown-baseline guard as an omitted field — === undefined alone
  // lets null read silently as not-red.
  const r2 = await runWorkflow({
    agent: makeAgent((label) => {
      if (label === 'setup') {
        return { branch: 'ultra/integration-sim', headSha: 'int0', baselinePassed: null }
      }
      return undefined
    }),
    args: { waves: [[{ id: 'A', title: 'task A', body: 'do A', tier: 'cheap' }]],
            integrationBranch: 'ultra/integration-sim', stamp: 'sim' },
    budget: undefined,
  })
  assert(r2.judgmentCalls.some((j) => /baseline unknown/.test(j)),
    'typoReview: baselinePassed: null also surfaced as an unknown baseline')
  console.log('scenario typo-review-and-unknown-baseline: OK')
}


// ── Scenario: fix-round DONE without coordinates also fails fast pre-review ───
async function scenarioFixRoundLostCoordinates() {
  let reviewCount = 0
  const waves = [[{ id: 'A', title: 'task A', body: 'do A', tier: 'cheap' }]]
  const args = { waves, integrationBranch: 'ultra/integration-sim', stamp: 'sim' }
  const r = await runWorkflow({
    agent: makeAgent((label) => {
      if (label.startsWith('review:A')) {
        reviewCount += 1
        return { verdict: 'FIX_REQUIRED', issues: [{ severity: 'blocking', detail: 'broken' }] }
      }
      if (label === 'fix:A:1') {
        return { status: 'DONE', summary: 's', commit: 'c-A2' } // no branch/headSha
      }
      return undefined
    }),
    args, budget: undefined,
  })
  eq(reviewCount, 1, 'fixLost: no iter-2 review dispatched for a coordinate-less fix result')
  const a = r.tasks.find((t) => t.task === 'A')
  eq(a && a.status, 'failed', 'fixLost: task failed')
  eq(a && a.reviewVerdict, 'lost-coordinates', 'fixLost: verdict lost-coordinates')
  assert(r.judgmentCalls.some((j) => /without mergeable coordinates/.test(j)),
    'fixLost: surfaced in judgmentCalls')
  console.log('scenario fix-round-lost-coordinates: OK')
}

// ── Scenario: edges with endpoints outside the waves surface, never bind ──────
async function scenarioUnboundEdgeEndpointsSurface() {
  const waves = [
    [{ id: 'A', title: 'task A', body: 'do A', tier: 'cheap' }],
    [{ id: 'B', title: 'task B', body: 'do B', tier: 'cheap' }],
  ]
  const args = { waves, integrationBranch: 'ultra/integration-sim', stamp: 'sim',
                 edges: [['ghost', 'B']] }
  const r = await runWorkflow({ agent: makeAgent(), args, budget: undefined })
  assert(r.judgmentCalls.some((j) => /ghost/.test(j) && /unbound|not in this run/.test(j)),
    'unboundEdge: typo\'d edge endpoint surfaced as a judgment call')
  const b = r.tasks.find((t) => t.task === 'B')
  eq(b && b.status, 'done', 'unboundEdge: B still ran (ghost never fails, so no blocking)')
  console.log('scenario unbound-edge-endpoints-surface: OK')
}


// ── Scenario: same-wave edge endpoints surface (cannot block) ─────────────────
async function scenarioSameWaveEdgeSurfaces() {
  const waves = [[
    { id: 'A', title: 'task A', body: 'do A', tier: 'cheap' },
    { id: 'B', title: 'task B', body: 'do B', tier: 'cheap' },
  ]]
  const args = { waves, integrationBranch: 'ultra/integration-sim', stamp: 'sim',
                 edges: [['A', 'B']] }
  const r = await runWorkflow({ agent: makeAgent(), args, budget: undefined })
  assert(r.judgmentCalls.some((j) => /A -> B/.test(j) && /share a wave/.test(j) && /chunk/.test(j)),
    'sameWave: co-located edge endpoints surfaced with the chunk-position-dependent wording')
  console.log('scenario same-wave-edge-surfaces: OK')
}

// ── Scenario: pre-setup budget deferral keeps earlier judgment calls ──────────
async function scenarioBudgetDeferralKeepsJudgmentCalls() {
  const r = await runWorkflow({
    agent: makeAgent(),
    args: { waves: [[{ id: 'A', title: 'task A', body: 'do A', tier: 'cheap' }]],
            integrationBranch: 'ultra/integration-sim', stamp: 'sim',
            edges: [['ghost', 'A']] },
    budget: { total: 100, remaining: 0 },
  })
  assert(r.judgmentCalls.some((j) => /budget exhausted before setup/.test(j)),
    'budgetKeep: deferral judgment call present')
  assert(r.judgmentCalls.some((j) => /ghost/.test(j)),
    'budgetKeep: earlier unbound-edge judgment call NOT discarded by the early return')
  console.log('scenario budget-deferral-keeps-judgment-calls: OK')
}

// ── Scenarios: merge/reconcile/integration throws are caught and contained ────
async function scenarioMergeThrowContained() {
  let reconciled = false
  const waves = [[{ id: 'A', title: 'task A', body: 'do A', tier: 'cheap' }]]
  const args = { waves, integrationBranch: 'ultra/integration-sim', stamp: 'sim' }
  const r = await runWorkflow({
    agent: makeAgent((label) => {
      if (label.startsWith('merge:')) throw new Error('engine fault in merge')
      if (label.startsWith('reconcile:')) { reconciled = true; return { status: 'MERGED', headSha: 'm1' } }
      return undefined
    }),
    args, budget: undefined,
  })
  assert(reconciled, 'mergeThrow: a thrown merge agent degrades to CONFLICT and reconcile dispatches')
  eq(r.waveMerges[0] && r.waveMerges[0].status, 'MERGED', 'mergeThrow: reconcile recovered the wave')
  assert(r.tasks.length === 1 && r.blockedWaves.length === 0, 'mergeThrow: run completed normally')
  console.log('scenario merge-throw-contained: OK')
}

async function scenarioReconcileThrowContained() {
  const waves = [
    [{ id: 'A', title: 'task A', body: 'do A', tier: 'cheap' }],
    [{ id: 'B', title: 'task B', body: 'do B', tier: 'cheap' }],
  ]
  const args = { waves, integrationBranch: 'ultra/integration-sim', stamp: 'sim' }
  const r = await runWorkflow({
    agent: makeAgent((label) => {
      if (label === 'merge:wave1') return { status: 'CONFLICT', detail: 'clash' }
      if (label.startsWith('reconcile:')) throw new Error('engine fault in reconcile')
      return undefined
    }),
    args, budget: undefined,
  })
  eq(r.blockedWaves.length, 1, 'reconcileThrow: wave 1 blocked after both thrown reconciles')
  assert(r.unfinished.some((u) => /B: cascade-blocked/.test(u)),
    'reconcileThrow: wave 2 cascade-blocked, run still returned a report')
  console.log('scenario reconcile-throw-contained: OK')
}

async function scenarioIntegrationThrowContained() {
  const waves = [[{ id: 'A', title: 'task A', body: 'do A', tier: 'cheap' }]]
  const args = { waves, integrationBranch: 'ultra/integration-sim', stamp: 'sim' }
  const r = await runWorkflow({
    agent: makeAgent((label) => {
      if (label === 'integration') throw new Error('engine fault in integration')
      return undefined
    }),
    args, budget: undefined,
  })
  eq(r.tests.passed, false, 'integrationThrow: tests reported not-passed')
  assert(r.completenessFindings.some((f) => /did not run|verify the suite manually/.test(f)),
    'integrationThrow: manual-verify finding present in the report')
  assert(r.judgmentCalls.some((j) => /integration review failed to run/.test(j)),
    'integrationThrow: surfaced as a judgment call')
  console.log('scenario integration-throw-contained: OK')
}


// ── Scenario: verdict-less reviewer result must not merge as clean ────────────
async function scenarioVerdictlessReviewSurfaces() {
  let fixDispatched = false
  const waves = [[{ id: 'A', title: 'task A', body: 'do A', tier: 'cheap' }]]
  const args = { waves, integrationBranch: 'ultra/integration-sim', stamp: 'sim' }
  const r = await runWorkflow({
    agent: makeAgent((label) => {
      if (label === 'review:A:1') return {}            // engine-bypass: no verdict, no issues
      if (label === 'fix:A:1') fixDispatched = true    // conservative path: fix round
      return undefined
    }),
    args, budget: undefined,
  })
  assert(r.judgmentCalls.some((j) => /no recognizable verdict/.test(j)),
    'verdictless: surfaced as a judgment call')
  assert(fixDispatched, 'verdictless: treated as blocking — fix round dispatched, not merged as clean')
  const a = r.tasks.find((t) => t.task === 'A')
  assert(a && a.reviewVerdict !== 'clean', 'verdictless: never merges as clean off an empty review')
  console.log('scenario verdictless-review-surfaces: OK')
}

// ── Scenario: prototype-name tiers and edge ids stay safe ─────────────────────
async function scenarioPrototypeNamesSafe() {
  const models = []
  const waves = [
    [{ id: 'toString', title: 'proto-named task', body: 'do it', tier: 'constructor' }],
  ]
  const args = { waves, integrationBranch: 'ultra/integration-sim', stamp: 'sim',
                 edges: [['toString', 'valueOf']] }
  const r = await runWorkflow({
    agent: makeAgent((label, prompt, opts) => {
      if (label.startsWith('impl:')) models.push(opts.model)
      return undefined
    }),
    args, budget: undefined,
  })
  eq(models[0], 'sonnet', 'proto: tier "constructor" falls back to standard, never a prototype function')
  assert(r.judgmentCalls.some((j) => /unknown tier/.test(j)), 'proto: bogus tier surfaced')
  assert(r.judgmentCalls.some((j) => /valueOf/.test(j)), 'proto: unbound prototype-named edge endpoint surfaced')
  console.log('scenario prototype-names-safe: OK')
}


// ── Scenario: inverted edge (dependent in an EARLIER wave) surfaces ───────────
async function scenarioInvertedEdgeSurfaces() {
  const waves = [
    [{ id: 'B', title: 'dependent first', body: 'do B', tier: 'cheap' }],
    [{ id: 'A', title: 'prerequisite second', body: 'do A', tier: 'cheap' }],
  ]
  const args = { waves, integrationBranch: 'ultra/integration-sim', stamp: 'sim',
                 edges: [['A', 'B']] }
  const r = await runWorkflow({ agent: makeAgent(), args, budget: undefined })
  assert(r.judgmentCalls.some((j) => /A -> B/.test(j) && /earlier wave|cannot bind/.test(j)),
    'inverted: earlier-wave dependent surfaced as cannot-bind')
  assert(r.tasks.length === 2 && r.tasks.every((t) => t.status === 'done'),
    'inverted: both tasks still dispatched (surfacing only)')
  console.log('scenario inverted-edge-surfaces: OK')
}

// ── Scenario: status-less impl result fails fast like any lost coordinates ────
async function scenarioStatuslessImplFailsFast() {
  let reviewed = false
  const waves = [[{ id: 'A', title: 'task A', body: 'do A', tier: 'cheap' }]]
  const args = { waves, integrationBranch: 'ultra/integration-sim', stamp: 'sim' }
  const r = await runWorkflow({
    agent: makeAgent((label) => {
      if (label === 'impl:A') return {}        // engine bypass: no status, no coordinates
      if (label.startsWith('review:A')) { reviewed = true }
      return undefined
    }),
    args, budget: undefined,
  })
  assert(!reviewed, 'statusless: no reviewer dispatched for a coordinate-less result')
  const a = r.tasks.find((t) => t.task === 'A')
  eq(a && a.status, 'failed', 'statusless: task failed')
  eq(a && a.reviewVerdict, 'lost-coordinates', 'statusless: verdict lost-coordinates')
  console.log('scenario statusless-impl-fails-fast: OK')
}

// ── Scenario: budget dies mid-wave — no merge/reconcile/integration dispatch ──
async function scenarioBudgetDiesMidWave() {
  let implsDone = 0
  const labels = []
  const agent = makeAgent((label) => {
    labels.push(label)
    if (label.startsWith('impl:')) implsDone++
    return undefined // fall through to default stub behavior
  })
  // Both wave-1 tasks dispatch (checks at wave/chunk top pass), then the
  // budget reads 0 before the wave-1 merge.
  const budget = { total: 100, remaining: () => (implsDone >= 2 ? 0 : 50) }
  const r = await runWorkflow({ agent, args: baseArgs, budget })
  assert(!labels.some((l) => l.startsWith('merge:')), 'budgetMidWave: no merge dispatched')
  assert(!labels.some((l) => l.startsWith('reconcile:')), 'budgetMidWave: no reconcile dispatched')
  assert(!labels.includes('integration'), 'budgetMidWave: no integration review dispatched')
  assert(r.waveMerges.length === 1 && r.waveMerges[0].status === 'DEFERRED',
    'budgetMidWave: wave-1 merge recorded as DEFERRED (got ' + JSON.stringify(r.waveMerges) + ')')
  eq(r.blockedWaves, [], 'budgetMidWave: budget deferral is not a blocked wave')
  assert(r.unfinished.some((u) => /^C: deferred \(budget exhausted/.test(u)),
    'budgetMidWave: wave-2 task deferred with a budget reason')
  assert(r.judgmentCalls.some((j) => /budget exhausted/.test(j)), 'budgetMidWave: cause in judgmentCalls')
  assert(/budget exhausted/.test(r.tests.output), 'budgetMidWave: integration skip attributed to budget')
  eq(r.tests.passed, false, 'budgetMidWave: tests cannot read as passed')
  console.log('scenario budget-dies-mid-wave: OK')
}

// ── Scenario: budget dies after a CONFLICT merge — reconcile not dispatched ───
async function scenarioBudgetDiesBeforeReconcile() {
  let merged = false
  const labels = []
  const agent = makeAgent((label) => {
    labels.push(label)
    if (label.startsWith('merge:')) { merged = true; return { status: 'CONFLICT', detail: 'overlap' } }
    return undefined
  })
  const budget = { total: 100, remaining: () => (merged ? 0 : 50) }
  const r = await runWorkflow({ agent, args: baseArgs, budget })
  assert(!labels.some((l) => l.startsWith('reconcile:')), 'budgetReconcile: no reconcile dispatched')
  assert(r.waveMerges[0].status === 'DEFERRED',
    'budgetReconcile: DEFERRED, not CONFLICT (got ' + JSON.stringify(r.waveMerges[0]) + ')')
  eq(r.blockedWaves, [], 'budgetReconcile: not recorded as a merge failure')
  assert(r.unfinished.some((u) => /^C: deferred \(budget exhausted/.test(u)),
    'budgetReconcile: later tasks deferred, not cascade-blocked')
  assert(!r.unfinished.some((u) => /cascade-blocked/.test(u)), 'budgetReconcile: no cascade-block wording')
  console.log('scenario budget-dies-before-reconcile: OK')
}

// ── Scenario: declared file scope is threaded into impl/review prompts ───────
async function scenarioFileScope() {
  const waves = [[
    { id: 'A', title: 'alpha', body: 'create a.txt', tier: 'cheap',
      files: ['a.txt', 'tests/test_a.py'] },
    { id: 'B', title: 'beta', body: 'create b.txt', tier: 'cheap', files: ['b.txt'] },
  ]]
  const prompts = {}
  const agent = makeAgent((label, prompt) => { prompts[label] = prompt; return undefined })
  await runWorkflow({ agent, args: { waves, integrationBranch: 'ultra/integration-sim', stamp: 'sim', dependencyEdges: [], edges: [] }, budget: undefined })
  assert(prompts['impl:A'].includes('\nFILES: a.txt, tests/test_a.py'),
    'scope: impl:A prompt carries the FILES line')
  assert(prompts['review:A:1'].includes('\nFILES: a.txt, tests/test_a.py'),
    'scope: review:A prompt carries the FILES line')
  assert(prompts['impl:B'].includes('\nFILES: b.txt'),
    'scope: impl:B now carries its own FILES line')
  assert(prompts['impl:A'].includes('\nSIBLING FILES: B: b.txt'),
    'sibling: impl:A names B-owned files')
  assert(prompts['impl:B'].includes('\nSIBLING FILES: A: a.txt, tests/test_a.py'),
    'sibling: impl:B names A-owned files')
  assert(prompts['review:A:1'].includes('\nSIBLING FILES: B: b.txt'),
    'sibling: review:A names B-owned files')
  console.log('scenario fileScope: OK')
}

// Helper: build a complete raw agent for acceptance scenarios (the acceptance-exam
// call does NOT prepend GUARD, so we cannot use makeAgent for these scenarios).
// Handles all standard labels plus 'acceptance-exam', delegating to handleExam.
function makeAcceptanceAgent(handleExam) {
  return async (prompt, opts) => {
    const label = opts.label || ''
    // acceptance-exam prompt does NOT carry the GUARD (it is a relay-only dispatch).
    if (label === 'acceptance-exam') {
      return handleExam(prompt, opts)
    }
    // All other labels must carry the GUARD.
    assert(prompt.startsWith('SAFETY: Operate ONLY inside the git worktree'),
      'GUARD must head every dispatched prompt (label=' + label + ')')
    if (label === 'setup') return { branch: baseArgs.integrationBranch, headSha: 'int0' }
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

// ── Scenario: acceptance-sealed-pending — workflow records PENDING_GATE, no exam ──
// Sealed exams are administered at the gate (SKILL.md Step 5), not in the workflow.
async function scenarioAcceptanceSealedPending() {
  let examDispatched = false
  const acceptanceArg = {
    mode: 'sealed', sealId: 'abc123def456', sha256: 'ab'.repeat(32),
    scriptPath: '/fake/run_acceptance.sh',
  }
  const r = await runWorkflow({
    agent: makeAcceptanceAgent(() => { examDispatched = true; return { raw: '' } }),
    args: Object.assign({}, baseArgs, { acceptance: acceptanceArg }),
    budget: undefined,
  })
  eq(r.acceptance && r.acceptance.mode, 'sealed', 'acceptance-sealed-pending: mode is sealed')
  eq(r.acceptance && r.acceptance.status, 'PENDING_GATE', 'acceptance-sealed-pending: status is PENDING_GATE')
  eq(r.acceptance && r.acceptance.passed, null, 'acceptance-sealed-pending: passed is null (not yet administered)')
  assert(!examDispatched, 'acceptance-sealed-pending: workflow dispatches NO acceptance-exam agent')
  assert(!r.judgmentCalls.some((j) => /acceptance/.test(j)),
    'acceptance-sealed-pending: no acceptance judgmentCall before administration (got ' + JSON.stringify(r.judgmentCalls) + ')')
  console.log('scenario acceptance-sealed-pending: OK')
}

// ── Scenario: acceptance-waived — no exam agent dispatched ───────────────────
async function scenarioAcceptanceWaived() {
  let examDispatched = false
  const r = await runWorkflow({
    agent: makeAcceptanceAgent(() => {
      examDispatched = true
      return { raw: '' }
    }),
    args: Object.assign({}, baseArgs, { acceptance: { mode: 'waived', reason: 'sim test' } }),
    budget: undefined,
  })
  eq(r.acceptance, { mode: 'waived', reason: 'sim test', passed: null },
    'acceptance-waived: report.acceptance deep-equals { mode: "waived", reason: "sim test", passed: null }')
  assert(!examDispatched, 'acceptance-waived: no acceptance-exam agent was dispatched')
  console.log('scenario acceptance-waived: OK')
}

await scenarioHappy()
await scenarioFixLoop()
await scenarioFixLoopExhausted()
await scenarioBlockedCascade()
await scenarioArgsThrow()
await scenarioDuplicateTaskId()
await scenarioArgsString()
await scenarioPortability()
await scenarioPerTaskReview()
await scenarioAdversarialDissent()
await scenarioTierOverrideInvalid()
await scenarioSetupFailure()
await scenarioBaselineRed()
await scenarioTypoReviewAndUnknownBaseline()
await scenarioFixRoundLostCoordinates()
await scenarioUnboundEdgeEndpointsSurface()
await scenarioVerdictlessReviewSurfaces()
await scenarioPrototypeNamesSafe()
await scenarioSameWaveEdgeSurfaces()
await scenarioInvertedEdgeSurfaces()
await scenarioStatuslessImplFailsFast()
await scenarioBudgetDeferralKeepsJudgmentCalls()
await scenarioMergeThrowContained()
await scenarioReconcileThrowContained()
await scenarioIntegrationThrowContained()
await scenarioBaseShaThreading()
await scenarioConcernsPropagate()
await scenarioPlanPath()
await scenarioVerdictMismatch()
await scenarioNeedsContextAfterFix()
await scenarioResume()
await scenarioResumeRequiresBranch()
await scenarioAdversarialDedupe()
await scenarioBudgetDiesMidWave()
await scenarioBudgetDiesBeforeReconcile()
await scenarioBudgetExhausted()
await scenarioAgentThrowDegrades()
await scenarioMergedWithoutHeadSha()
await scenarioMetaAbsentEngine()
await scenarioDependentBlockedByFailedTask()
await scenarioChunkCap()
await scenarioTransitiveDepBlock()
await scenarioFullyBlockedWaveDoesNotCascade()
await scenarioDoneWithoutHeadShaNotMerged()
await scenarioIntraWaveDepAcrossChunks()
await scenarioMalformedEdgesThrow()
await scenarioNoEdgesZeroMergeableCascades()
await scenarioBaseBranchThreaded()
await scenarioReconcileTierOverride()
await scenarioLostDoneBlocksDependents()
await scenarioMidRunBudgetDeferral()
await scenarioFileScope()
// ── Scenario: acceptance-suite-green — disposition bound to the committed suite
async function scenarioAcceptanceSuiteGreen() {
  let examDispatched = false
  const agent = makeAcceptanceAgent((prompt, opts) => {
    examDispatched = true
    return { raw: '{}' }
  })
  const r = await runWorkflow({
    agent,
    args: Object.assign({}, baseArgs, { acceptance: { mode: 'suite', reason: 'committed suite' } }),
    budget: undefined,
  })
  eq(r.acceptance && r.acceptance.mode, 'suite', 'acceptance-suite-green: mode is suite')
  eq(r.acceptance && r.acceptance.passed, true, 'acceptance-suite-green: passed mirrors green tests')
  eq(examDispatched, false, 'acceptance-suite-green: no held-out exam dispatched')
  assert(!r.judgmentCalls.some((j) => /acceptance did not pass/.test(j)),
    'acceptance-suite-green: no gate-blocking judgmentCall on green')
  console.log('scenario acceptance-suite-green: OK')
}

// ── Scenario: acceptance-suite-red — failed committed suite blocks the gate ────
async function scenarioAcceptanceSuiteRed() {
  // Need a custom agent so we can make integration return testsPassed: false.
  const agent = async (prompt, opts) => {
    const label = opts.label || ''
    // No acceptance-exam should be dispatched for suite mode.
    if (label === 'acceptance-exam') throw new Error('suite mode must not dispatch acceptance-exam')
    assert(prompt.startsWith('SAFETY: Operate ONLY inside the git worktree'),
      'GUARD must head every dispatched prompt (label=' + label + ')')
    if (label === 'setup') return { branch: baseArgs.integrationBranch, headSha: 'int0' }
    if (label.startsWith('impl:') || label.startsWith('fix:')) {
      const id = taskIdFromLabel(label)
      return { status: 'DONE', summary: 's', branch: 'wt-' + id, headSha: 'sha-' + id, commit: 'c-' + id }
    }
    if (label.startsWith('review:')) return { verdict: 'PASS', issues: [] }
    if (label.startsWith('merge:')) return { status: 'MERGED', headSha: 'm-' + label }
    if (label === 'integration') return { command: 'pytest', testsPassed: false, output: '1 failed', findings: [] }
    throw new Error('unexpected agent label: ' + label)
  }
  const r = await runWorkflow({
    agent,
    args: Object.assign({}, baseArgs, { acceptance: { mode: 'suite', reason: 'committed suite' } }),
    budget: undefined,
  })
  eq(r.acceptance && r.acceptance.mode, 'suite', 'acceptance-suite-red: mode is suite')
  eq(r.acceptance && r.acceptance.passed, false, 'acceptance-suite-red: passed mirrors red tests')
  assert(r.judgmentCalls.some((j) => /acceptance did not pass/.test(j)),
    'acceptance-suite-red: red suite pushes a gate-blocking judgmentCall')
  console.log('scenario acceptance-suite-red: OK')
}

// ── Scenario: review-role discipline — the completeness critic is pinned to the
// run's verified merge HEAD, and review roles carry read-only language (#29, #32).
async function scenarioReviewDiscipline() {
  let integrationPrompt = ''
  let lastMergeHead = ''
  const reviewPrompts = []
  const agent = async (prompt, opts) => {
    const label = opts.label || ''
    if (label === 'setup') return { branch: baseArgs.integrationBranch, headSha: 'int0' }
    if (label.startsWith('impl:') || label.startsWith('fix:')) {
      const id = taskIdFromLabel(label)
      return { status: 'DONE', summary: 's', branch: 'wt-' + id, headSha: 'sha-' + id, commit: 'c-' + id }
    }
    if (label.startsWith('review:')) { reviewPrompts.push(prompt); return { verdict: 'PASS', issues: [] } }
    if (label.startsWith('merge:')) {
      lastMergeHead = 'MERGEHEAD-' + label   // distinct per wave; waveBaseSha ends on the last one
      return { status: 'MERGED', headSha: lastMergeHead }
    }
    if (label === 'integration') {
      integrationPrompt = prompt
      return { command: 'pytest', testsPassed: true, output: 'ok', findings: [] }
    }
    throw new Error('unexpected agent label: ' + label)
  }
  await runWorkflow({ agent, args: baseArgs, budget: undefined })

  // #29 — the critic must operate on the exact tree the run produced.
  assert(integrationPrompt.includes(lastMergeHead),
    'review-discipline: completeness prompt carries the run merge HEAD sha (' + lastMergeHead + ')')
  assert(/git checkout --detach/.test(integrationPrompt),
    'review-discipline: completeness prompt instructs a detached checkout to the merge HEAD')
  assert(/rev-parse HEAD/.test(integrationPrompt),
    'review-discipline: completeness prompt requires a rev-parse HEAD self-check')
  assert(/report BLOCKED/.test(integrationPrompt),
    'review-discipline: completeness prompt requires BLOCKED on an unverified tree')

  // #32 — review roles are read-only.
  assert(/REVIEW role/.test(integrationPrompt) && /Do not write files/.test(integrationPrompt),
    'review-discipline: completeness prompt carries read-only review-role language')
  assert(reviewPrompts.length > 0 &&
    reviewPrompts.every((p) => /REVIEW role/.test(p) && /Do not write files/.test(p)),
    'review-discipline: per-task reviewer prompts carry read-only review-role language')

  console.log('scenario review-discipline: OK')
}

// ── Scenario: wavesPath file-backed bodies — large plans deliver bodies on disk ─
// A task may omit its inline `body` when args.wavesPath is supplied; the impl and
// reviewer then read the verbatim body from that file BY ID (no model transcribes
// the multi-KB body). An inline body is still honored (mixed / back-compat).
async function scenarioWavesPathFileBackedBodies() {
  const prompts = {}
  const waves = [[
    { id: 'A', title: 'alpha', tier: 'cheap', files: ['a.txt'] },      // no body -> from file
    { id: 'B', title: 'beta', tier: 'cheap', body: 'inline body for B' }, // inline body kept
  ]]
  const args = { waves, integrationBranch: 'ultra/integration-sim', stamp: 'sim',
                 wavesPath: '/repo/.claude/ultrapowers/waves-sim.json', edges: [] }
  const r = await runWorkflow({
    agent: makeAgent((label, prompt) => {
      prompts[label] = prompt
      // The preflight confirms the file covers the bodyless task id 'A'.
      if (label === 'waves-file-check') return { ok: true, ids: ['A', 'B'] }
      return undefined
    }),
    args, budget: undefined,
  })
  assert(/waves-file-check/.test(Object.keys(prompts).join(',')),
    'wavesPath: a preflight check agent ran before setup')
  assert(/read your verbatim task text from the JSON file at \/repo\/\.claude\/ultrapowers\/waves-sim\.json/.test(prompts['impl:A']),
    'wavesPath: impl:A reads its body from the file at wavesPath')
  assert(prompts['impl:A'].includes('"id" is "A"'),
    'wavesPath: impl:A points to its OWN id in the file')
  assert(/read your verbatim task text from the JSON file/.test(prompts['review:A:1']),
    'wavesPath: reviewer also reads A body from the file')
  assert(prompts['impl:B'].includes('\nTASK:\ninline body for B'),
    'wavesPath: an inline body is still embedded verbatim (mixed / back-compat)')
  assert(r.tasks.every((t) => t.status === 'done'), 'wavesPath: validation passed, all tasks done')
  console.log('scenario wavesPath-file-backed-bodies: OK')
}

// ── Scenario: a bodyless task without wavesPath must fail loud ─────────────────
async function scenarioWavesPathRequiredForMissingBody() {
  let threw = false
  try {
    await runWorkflow({
      agent: makeAgent(),
      args: { waves: [[{ id: 'A', title: 'a', tier: 'cheap' }]], // no body AND no wavesPath
              integrationBranch: 'ib', stamp: 's' },
      budget: undefined })
  } catch (e) { threw = /args\.waves missing or malformed/.test(e.message) }
  assert(threw, 'wavesPath-missing: a bodyless task without wavesPath must throw the fail-loud error')
  console.log('scenario wavesPath-required-for-missing-body: OK')
}

// ── Scenario: wavesPath preflight fails loud on a missing file ────────────────
async function scenarioWavesPathPreflightMissingFile() {
  let implRan = false
  let threw = false
  const waves = [[{ id: 'A', title: 'a', tier: 'cheap', files: ['a.txt'] }]] // bodyless
  const args = { waves, integrationBranch: 'ib', stamp: 's', wavesPath: '/nope/waves.json' }
  try {
    await runWorkflow({
      agent: makeAgent((label) => {
        if (label === 'waves-file-check') return { ok: false, error: 'file not found' }
        if (label.startsWith('impl:')) { implRan = true }
        return undefined
      }),
      args, budget: undefined,
    })
  } catch (e) { threw = /wavesPath file unusable/.test(e.message) && /file not found/.test(e.message) }
  assert(threw, 'preflightMissing: an unusable wavesPath file must throw before any task')
  assert(!implRan, 'preflightMissing: no implementer runs after a failed preflight')
  console.log('scenario wavesPath-preflight-missing-file: OK')
}

// ── Scenario: wavesPath preflight fails loud when a task id is not covered ─────
async function scenarioWavesPathPreflightMissingId() {
  let threw = false
  const waves = [[
    { id: 'A', title: 'a', tier: 'cheap', files: ['a.txt'] },   // bodyless
    { id: 'B', title: 'b', tier: 'cheap', files: ['b.txt'] },   // bodyless
  ]]
  const args = { waves, integrationBranch: 'ib', stamp: 's', wavesPath: '/x/waves.json', edges: [] }
  try {
    await runWorkflow({
      agent: makeAgent((label) => {
        if (label === 'waves-file-check') return { ok: true, ids: ['A'] } // B missing
        return undefined
      }),
      args, budget: undefined,
    })
  } catch (e) { threw = /no body for task id\(s\): B/.test(e.message) }
  assert(threw, 'preflightMissingId: a bodyless task absent from the file must throw, naming it')
  console.log('scenario wavesPath-preflight-missing-id: OK')
}

// ── Scenario: an empty inline body with NO wavesPath fails loud ───────────────
async function scenarioEmptyBodyNoWavesPathThrows() {
  let threw = false
  try {
    await runWorkflow({
      agent: makeAgent(),
      args: { waves: [[{ id: 'A', title: 'a', body: '   ', tier: 'cheap' }]],
              integrationBranch: 'ib', stamp: 's' },
      budget: undefined })
  } catch (e) { threw = /args\.waves missing or malformed/.test(e.message) }
  assert(threw, 'emptyBody: a whitespace-only body with no wavesPath must be rejected (no "file at undefined")')
  console.log('scenario empty-body-no-wavespath-throws: OK')
}

// ── Scenario: bootstrapCmd + per-task testCmd (polyglot / fresh worktrees) ─────
async function scenarioBootstrapAndPerTaskTestCmd() {
  const prompts = {}
  const waves = [[
    { id: 'A', title: 'py task', body: 'do A', tier: 'cheap', testCmd: '.venv/bin/pytest -q' },
    { id: 'B', title: 'bun task', body: 'do B', tier: 'cheap' },
  ]]
  const args = { waves, integrationBranch: 'ultra/integration-sim', stamp: 'sim', edges: [],
                 testCmd: 'make test',
                 bootstrapCmd: 'python3 -m venv .venv && .venv/bin/pip install -e . && (cd app && bun install)' }
  const r = await runWorkflow({
    agent: makeAgent((label, prompt) => { prompts[label] = prompt; return undefined }),
    args, budget: undefined,
  })
  // bootstrap threaded into the FRESH worktree roles…
  assert(/WORKTREE SETUP:.*bun install/.test(prompts['impl:A']),
    'bootstrap: impl carries the per-worktree setup command')
  assert(/WORKTREE SETUP:/.test(prompts['review:A:1']),
    'bootstrap: reviewer carries the per-worktree setup command')
  // …but NOT the non-isolated roles (they run on the main checkout, deps present).
  assert(prompts['merge:wave1'] && !/WORKTREE SETUP:/.test(prompts['merge:wave1']),
    'bootstrap: the merge agent does NOT get the worktree-setup line')
  assert(prompts['integration'] && !/WORKTREE SETUP:/.test(prompts['integration']),
    'bootstrap: the completeness critic does NOT get the worktree-setup line')
  // per-task testCmd overrides the run-wide one for A; B falls back to the global.
  assert(/TEST COMMAND: \.venv\/bin\/pytest -q/.test(prompts['impl:A']),
    'perTaskTest: A uses its own testCmd')
  assert(/TEST COMMAND: make test/.test(prompts['impl:B']),
    'perTaskTest: B falls back to the run-wide testCmd')
  assert(r.tasks.every((t) => t.status === 'done'), 'bootstrap: all tasks done')
  console.log('scenario bootstrap-and-per-task-testcmd: OK')
}

// ── Scenario: forwarded signals — the implementer and reviewer dispatches carry
// the plan's Global Constraints and each task's Interfaces, and the prompts state
// the terse output contract (#1.4, #2.4).
async function scenarioForwardedSignals() {
  const prompts = {}
  const waves = [[
    { id: 'A', title: 'alpha', body: 'do A', tier: 'cheap',
      interfaces: { consumes: ['schema.User'], produces: ['createUser(name: string): User'] } },
    { id: 'B', title: 'beta', body: 'do B', tier: 'cheap' }, // no interfaces
  ]]
  const args = { waves, integrationBranch: 'ultra/integration-sim', stamp: 'sim', edges: [],
                 globalConstraints: 'Node >= 20. All copy uses sentence case.' }
  const r = await runWorkflow({
    agent: makeAgent((label, prompt) => { prompts[label] = prompt; return undefined }),
    args, budget: undefined,
  })
  assert(/GLOBAL CONSTRAINTS:[\s\S]*Node >= 20/.test(prompts['impl:A']),
    'forwarded: implementer dispatch carries the global constraints text')
  assert(/GLOBAL CONSTRAINTS:[\s\S]*Node >= 20/.test(prompts['review:A:1']),
    'forwarded: reviewer dispatch carries the global constraints text')
  assert(/INTERFACES:[\s\S]*schema\.User/.test(prompts['impl:A']) &&
         /createUser\(name: string\): User/.test(prompts['impl:A']),
    'forwarded: implementer dispatch carries the task interfaces (consumes + produces)')
  assert(/INTERFACES:[\s\S]*schema\.User/.test(prompts['review:A:1']),
    'forwarded: reviewer dispatch carries the task interfaces')
  assert(!/INTERFACES:/.test(prompts['impl:B']),
    'forwarded: a task without interfaces gets no INTERFACES line')
  assert(/final message is your report/i.test(prompts['review:A:1']) &&
         /file:line/.test(prompts['review:A:1']),
    'forwarded: reviewer prompt states the terse report contract')
  assert(/15 lines/.test(prompts['impl:A']),
    'forwarded: implementer prompt caps the back-channel at 15 lines')
  assert(r.tasks.every((t) => t.status === 'done'), 'forwarded: all tasks done')
  console.log('scenario forwarded-signals: OK')
}

// ── Scenario: pre-baked review packets — the implementer's final step generates
// the packet, the reviewer reads it (guarded fallback to live git), and the
// reviewer no longer runs the suite (#2.1, #2.3b).
async function scenarioReviewPackets() {
  const prompts = {}
  const r = await runWorkflow({
    agent: makeAgent((label, prompt) => { prompts[label] = prompt; return undefined }),
    args: baseArgs, budget: undefined,
  })
  assert(/scripts\/review-package/.test(prompts['impl:A']),
    'packets: implementer final step runs the review-package script')
  assert(/last (stdout )?line|echoed/i.test(prompts['impl:A']) && /packet/i.test(prompts['impl:A']),
    'packets: implementer reports the echoed packet path')
  assert(/review packet/i.test(prompts['review:A:1']),
    'packets: reviewer prompt references the pre-baked review packet')
  assert(/do not run git/i.test(prompts['review:A:1']),
    'packets: reviewer reads the packet instead of running git')
  assert(/fall back|missing|does not match/i.test(prompts['review:A:1']),
    'packets: reviewer has a guarded fallback to live git when the packet is missing or stale')
  assert(!/Run the full check suite and confirm it passes/.test(prompts['review:A:1']),
    'packets: reviewer no longer runs the full check suite')
  assert(/BASE\.\.\.HEAD/.test(prompts['review:A:1']),
    'packets: reviewer still anchors to BASE...HEAD')
  assert(/REVIEW role/.test(prompts['review:A:1']) && /Do not write files/.test(prompts['review:A:1']),
    'packets: reviewer stays read-only')
  assert(r.tasks.every((t) => t.status === 'done'), 'packets: all tasks done')
  console.log('scenario review-packets: OK')
}

// ── Scenario: cannot-verify-from-diff escalation — reviewers list requirements
// they cannot judge from the diff; the engine routes them into the completeness
// critic's checklist (#2.2).
async function scenarioCannotVerifyEscalation() {
  let integrationPrompt = ''
  const agent = async (prompt, opts) => {
    const label = opts.label || ''
    assert(prompt.startsWith('SAFETY: Operate ONLY inside the git worktree'),
      'GUARD must head every dispatched prompt (label=' + label + ')')
    if (label === 'setup') return { branch: baseArgs.integrationBranch, headSha: 'int0' }
    if (label.startsWith('impl:') || label.startsWith('fix:')) {
      const id = taskIdFromLabel(label)
      return { status: 'DONE', summary: 's', branch: 'wt-' + id, headSha: 'sha-' + id, commit: 'c-' + id }
    }
    if (label.startsWith('review:')) {
      const id = taskIdFromLabel(label)
      if (id === 'A') {
        return { verdict: 'PASS', issues: [],
                 cannotVerify: [{ requirement: 'end-to-end auth flow across tasks A and C',
                                  why: 'token consumer lives in task C, not in this diff' }] }
      }
      return { verdict: 'PASS', issues: [] }
    }
    if (label.startsWith('merge:')) return { status: 'MERGED', headSha: 'm-' + label }
    if (label === 'integration') {
      integrationPrompt = prompt
      return { command: 'pytest', testsPassed: true, output: 'ok', findings: [] }
    }
    throw new Error('unexpected agent label: ' + label)
  }
  const r = await runWorkflow({ agent, args: baseArgs, budget: undefined })
  assert(/CANNOT-VERIFY/i.test(integrationPrompt),
    'cannotVerify: the completeness prompt carries a cannot-verify checklist heading')
  assert(integrationPrompt.includes('end-to-end auth flow across tasks A and C'),
    'cannotVerify: the listed requirement reaches the completeness critic')
  assert(integrationPrompt.includes('token consumer lives in task C'),
    'cannotVerify: the why reaches the completeness critic')
  assert(r.tasks.every((t) => t.status === 'done'), 'cannotVerify: all tasks still done (PASS verdict)')
  console.log('scenario cannot-verify-escalation: OK')
}

await scenarioAcceptanceSealedPending()
await scenarioAcceptanceWaived()
await scenarioAcceptanceSuiteGreen()
await scenarioAcceptanceSuiteRed()
await scenarioReviewDiscipline()
await scenarioWavesPathFileBackedBodies()
await scenarioWavesPathRequiredForMissingBody()
await scenarioWavesPathPreflightMissingFile()
await scenarioWavesPathPreflightMissingId()
await scenarioEmptyBodyNoWavesPathThrows()
await scenarioBootstrapAndPerTaskTestCmd()
await scenarioForwardedSignals()
await scenarioReviewPackets()
await scenarioCannotVerifyEscalation()
console.log('ALL SCENARIOS PASSED')
