// tests/sim_derived_heads.mjs
//
// Behavioral sim for the #259 fold-over-git heads contract — the subtraction that
// replaced #114's <runDir>/heads/ sidecar. Like sim_workflow.mjs and
// wave_ancestry_sim.mjs this runs the REAL orchestrator body from
// skills/ultrapowers/harnesses/waves.js with stubbed engine globals
// (agent/parallel/phase/log/args/budget) — the research-preview Workflow engine
// can't run in CI, so we execute the wrapped body the same way the engine does
// and inspect the prompts it actually dispatched.
//
// What it pins: NO engine role is told to write a sha anywhere. Git is the
// ledger — task branches survive their merge and the integration branch tip IS
// the run's tree — so the merge, reconcile and adopt prompts carry no
// heads-recording step and no dispatch appends a slot line, and the completeness
// critic DERIVES its detach target from the branch it was sent to verify (confirm
// git branch --show-current, then git rev-parse HEAD) rather than reading a
// sidecar. The recorded merge sha stays in the prompt as a labelled cross-check
// only, and mergedShas hands the critic {task, branch} pairs so it resolves every
// tip itself. Assertions quote the DISPATCHED string, never a paraphrase.
//
// NOT run by pytest/CI (it's a Node sim). Run manually:  node tests/sim_derived_heads.mjs
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
function has(haystack, needle, msg) {
  assert(haystack.indexOf(needle) !== -1, msg + '\n  missing literal: ' + JSON.stringify(needle))
}
function lacks(haystack, needle, msg) {
  assert(haystack.indexOf(needle) === -1, msg + '\n  forbidden literal present: ' + JSON.stringify(needle))
}

// Two waves: A,B merge in wave 1; C merges in wave 2.
const WAVES = [
  [
    { id: 'A', title: 'alpha', body: 'create a.txt', tier: 'standard' },
    { id: 'B', title: 'beta', body: 'create b.txt', tier: 'standard' },
  ],
  [{ id: 'C', title: 'gamma', body: 'create c.txt', tier: 'standard' }],
]
const RUN_DIR = '/repo/.claude/ultrapowers/run-sim'
const INTEGRATION_BRANCH = 'ultra/integration-sim'
const baseArgs = { waves: WAVES, integrationBranch: INTEGRATION_BRANCH, stamp: 'sim',
  edges: [['A', 'C']], testCmd: 'pnpm check',
  pluginRoot: '/opt/plug', runDir: RUN_DIR }

// Every span the sidecar convention used to contribute. None of it may survive on
// any merge-side dispatch: the token form (an unsubstituted engine path), the
// substituted form (what the agent would actually have read), the instruction
// verb, and the per-dispatch slot line the engine used to append.
const FORBIDDEN_SIDECAR = [
  '<runDir>/heads',
  RUN_DIR + '/heads',
  'record heads',
  'For this wave that means slots',
]

function assertNoSidecarInstruction(prompt, who) {
  for (const needle of FORBIDDEN_SIDECAR) {
    lacks(prompt, needle, who + ': carries no heads-sidecar instruction')
  }
}

// Capture every dispatched prompt by label; drive merge outcomes per label.
// cannotVerifyFor(label) optionally returns the cannotVerify entries a per-task
// reviewer escalates, so a scenario can put reviewer-authored prose into the
// completeness prompt.
function makeAgent(mergeStatusFor, captured, cannotVerifyFor) {
  return async (prompt, opts) => {
    const label = opts.label || ''
    captured[label] = prompt
    if (label === 'setup') return { branch: baseArgs.integrationBranch, headSha: 'int0' }
    if (label.startsWith('impl:') || label.startsWith('fix:')) {
      const id = label.split(':')[1]
      return { status: 'DONE', summary: 's', branch: 'wt-' + id, headSha: 'sha-' + id }
    }
    if (label.startsWith('review:')) {
      const cv = (cannotVerifyFor && cannotVerifyFor(label)) || []
      return { verdict: 'PASS', issues: [], cannotVerify: cv }
    }
    if (label.startsWith('merge:') || label.startsWith('reconcile:')) {
      const status = (mergeStatusFor && mergeStatusFor(label)) || 'MERGED'
      if (status !== 'MERGED') return { status, detail: 'simulated ' + status + ' for ' + label }
      return { status: 'MERGED', headSha: 'head-' + label }
    }
    if (label === 'integration') {
      return { command: 'pytest', testsPassed: true, output: 'ok', findings: [],
               onIntegrationHead: true, ancestryMisses: [] }
    }
    throw new Error('unexpected agent label: ' + label)
  }
}

// Every merge-side label the run dispatched, in dispatch order.
const mergeSideLabels = (captured) =>
  Object.keys(captured).filter((l) => l.startsWith('merge:') || l.startsWith('reconcile:'))

// ── Scenario 1: no merge dispatch records a sha, and the sweep survives ───────
async function scenarioMergeRecordsNothing() {
  const captured = {}
  await runWorkflow({ agent: makeAgent(null, captured), args: baseArgs })

  const labels = mergeSideLabels(captured)
  assert(labels.length === 2, 'both wave merges dispatched (got ' + JSON.stringify(labels) + ')')

  for (const label of labels) {
    assertNoSidecarInstruction(captured[label], label)
    // The sweep step is NOT part of the deletion: it survives, re-anchored to the
    // MERGED verdict alone now that there are no heads to record first.
    has(captured[label], 'If and only if you are reporting MERGED, sweep',
        label + ': the wave-barrier sweep is gated on the MERGED verdict alone')
    has(captured[label], 'git worktree remove --force',
        label + ': still carries the identity-checked worktree sweep')
  }

  console.log('scenario merge-records-nothing: OK')
}

// ── Scenario 2: the reconciliation agent records nothing either ───────────────
async function scenarioReconcileRecordsNothing() {
  const captured = {}
  // Wave 1's merge conflicts once; the reconciliation agent resolves it and is
  // the role that then reports the MERGED head — under the sidecar convention it
  // carried the record-heads span verbatim. It must not any more.
  const mergeStatusFor = (label) => (label === 'merge:wave1' ? 'CONFLICT' : 'MERGED')
  await runWorkflow({ agent: makeAgent(mergeStatusFor, captured), args: baseArgs })

  const rec = captured['reconcile:wave1:1']
  assert(typeof rec === 'string', 'reconciliation agent dispatched after the conflict')
  assertNoSidecarInstruction(rec, 'reconcile:wave1:1')
  has(rec, 'If and only if you are reporting MERGED, sweep',
      'reconcile:wave1:1: the sweep is gated on the MERGED verdict alone')

  // ...and every other merge-side dispatch in the same run is clean too.
  for (const label of mergeSideLabels(captured)) {
    assertNoSidecarInstruction(captured[label], label)
  }
  console.log('scenario reconcile-records-nothing: OK')
}

// ── Scenario 3: the critic derives its tree from git, not from a sidecar ──────
async function scenarioCriticDerivesFromGit() {
  const captured = {}
  await runWorkflow({ agent: makeAgent(null, captured), args: baseArgs })

  const critic = captured['integration']
  assert(typeof critic === 'string', 'completeness critic dispatched')

  // The derivation is from git itself, anchored on the branch the critic was sent
  // to verify — never a sha typed into the prompt, never a sidecar slot.
  has(critic, 'derive that tree from git itself',
      'critic: told to derive the tree from git')
  has(critic, 'git branch --show-current prints ' + INTEGRATION_BRANCH,
      'critic: the branch identity check names the run\'s integration branch')
  has(critic, 'run git checkout --detach <derived>',
      'critic: detaches at the derived tip, never at the recorded sha')
  has(critic, 'Authoritative shas live in git',
      'critic: git is named as the sha authority')
  lacks(critic, '<runDir>/heads', 'critic: no sidecar token survives')
  lacks(critic, RUN_DIR + '/heads', 'critic: no substituted sidecar path survives')

  // The recorded value stays, labelled as recorded, and a mismatch reports the
  // specific recorded-vs-derived signal. Wave 2 is the last wave, so its merge
  // reply is the recorded merge sha.
  const RECORDED_SHA = 'head-merge:wave2'
  has(critic, 'the recorded merge sha is ' + RECORDED_SHA,
      'critic: the recorded value is interpolated, labelled as recorded')
  has(critic, 'recorded merge sha <recorded> != derived integration tip <derived>',
      'critic: a mismatch reports the specific recorded-vs-derived signal')
  // The derivation is stated BEFORE the recorded sha is ever mentioned.
  const derivedAt = critic.indexOf('derive that tree from git itself')
  const recordedAt = critic.indexOf(RECORDED_SHA)
  assert(derivedAt !== -1 && recordedAt !== -1 && derivedAt < recordedAt,
    'critic: the git derivation precedes the first mention of the recorded sha')

  // mergedShas hands over {task, branch} — no sha travels, so the critic must
  // resolve every tip itself.
  has(critic, 'resolve the branch tip yourself with git rev-parse',
      'critic: told to resolve each branch tip itself')
  const listAt = critic.indexOf('mergedShas: ')
  assert(listAt !== -1, 'critic: the mergedShas list is interpolated')
  const list = critic.slice(listAt + 'mergedShas: '.length)
  for (const id of ['A', 'B', 'C']) {
    has(list, '"branch":"wt-' + id + '"',
        'critic: mergedShas carries task ' + id + '\'s branch name')
  }
  lacks(list, '"headSha"', 'critic: no headSha key rides the mergedShas list')
  lacks(list, 'sha-A', 'critic: no implementer-typed sha rides the mergedShas list')

  console.log('scenario critic-derives-from-git: OK')
}

// ── Scenario 4: reviewer-authored prose reaches the critic UNSUBSTITUTED ──────
// Path substitution is for ENGINE-authored text only. The CANNOT-VERIFY checklist
// is written by the per-task reviewers, and a reviewer describing a run-directory
// path quotes the literal <runDir> token — rewriting that quotation would hand
// the critic prose the reviewer never wrote. Same rule that keeps the plan's
// GLOBAL CONSTRAINTS outside fillPaths(), applied to a span that sits mid-prompt.
async function scenarioCannotVerifyPassesThroughVerbatim() {
  const captured = {}
  // Reviewer prose deliberately quoting the literal token, twice, in both fields.
  const REQUIREMENT = 'the fold writes <runDir>/frontier/wave-1/conflicts.json'
  const WHY = 'spans tasks — <runDir> is not visible in this diff'
  const cannotVerifyFor = (label) =>
    (label === 'review:A:1' ? [{ requirement: REQUIREMENT, why: WHY }] : [])
  await runWorkflow({ agent: makeAgent(null, captured, cannotVerifyFor), args: baseArgs })

  const critic = captured['integration']
  assert(typeof critic === 'string', 'completeness critic dispatched')

  // The escalated checklist reaches the critic exactly as the reviewer wrote it.
  const CHECKLIST = 'CANNOT-VERIFY checklist (escalated by the per-task reviewers — ' +
    'verify each against the integrated tree): [A] ' + REQUIREMENT + ' (' + WHY + '). '
  has(critic, CHECKLIST, 'critic: reviewer-authored checklist passes through verbatim')
  has(critic, REQUIREMENT, 'critic: the reviewer\'s literal <runDir> quote survives dispatch')
  has(critic, WHY, 'critic: the reviewer\'s why field survives dispatch')

  // ...and nothing else in the prompt still carries the token: every remaining
  // occurrence must be one the reviewer typed, not an unsubstituted engine path.
  const occurrences = critic.split('<runDir>').length - 1
  assert(occurrences === 2,
    'critic: exactly the reviewer\'s two <runDir> quotes survive (engine text stays ' +
    'substituted) — found ' + occurrences)

  // The seam token itself is engine plumbing and must never reach an agent.
  assert(critic.indexOf('{{CANNOT_VERIFY}}') === -1,
    'critic: the CANNOT_VERIFY seam token is filled, never dispatched')

  // The checklist lands in its designed position: after the review instruction,
  // before the GLOBAL CONSTRAINTS sentence — not appended at the end.
  const at = critic.indexOf(CHECKLIST)
  const after = critic.indexOf('When GLOBAL CONSTRAINTS are provided')
  assert(at !== -1 && after !== -1 && at < after,
    'critic: the checklist is spliced at its seam, ahead of the constraints sentence')

  // Engine-authored spans in the SAME prompt still carry the git-derived contract.
  has(critic, 'Authoritative shas live in git', 'critic: engine text is unchanged by the splice')
  console.log('scenario cannot-verify-passes-through-verbatim: OK')
}

await scenarioMergeRecordsNothing()
await scenarioReconcileRecordsNothing()
await scenarioCriticDerivesFromGit()
await scenarioCannotVerifyPassesThroughVerbatim()
console.log('ALL SCENARIOS PASSED')
