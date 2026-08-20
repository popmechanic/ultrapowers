// tests/sim_derived_heads.mjs
//
// Behavioral sim for the #114 derived-task-heads sidecar. Like sim_workflow.mjs
// and wave_ancestry_sim.mjs this runs the REAL orchestrator body from
// skills/ultrapowers/harnesses/waves.js with stubbed engine globals
// (agent/parallel/phase/log/args/budget) — the research-preview Workflow engine
// can't run in CI, so we execute the wrapped body the same way the engine does
// and inspect the prompts it actually dispatched.
//
// What it pins: the merge and reconcile agents are told to record every merged
// task head and the post-merge integration HEAD into <runDir>/heads/ by shell
// redirection (never by typing a sha) with every rev-parse pinned to the
// integration worktree via git -C (#173 — a bare rev-parse resolves against the
// agent's cwd), from the LAUNCH DIRECTORY (the integration worktree path is
// repo-root-relative, so git -C only resolves there — the same prompts send the
// agent INTO the worktree, where a -C read would die 'cannot change to' and
// leave an empty slot), and to self-check the wave slot against the headSha they
// are about to report; each dispatch names its concrete slots,
// and the completeness critic is told those files — not the shas quoted in its
// own prompt — are the authority. Assertions quote the DISPATCHED string, never
// a paraphrase.
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

// Two waves: A,B merge in wave 1; C merges in wave 2.
const WAVES = [
  [
    { id: 'A', title: 'alpha', body: 'create a.txt', tier: 'cheap' },
    { id: 'B', title: 'beta', body: 'create b.txt', tier: 'cheap' },
  ],
  [{ id: 'C', title: 'gamma', body: 'create c.txt', tier: 'standard' }],
]
const RUN_DIR = '/repo/.claude/ultrapowers/run-sim'
const baseArgs = { waves: WAVES, integrationBranch: 'ultra/integration-sim', stamp: 'sim',
  edges: [['A', 'C']], testCmd: 'pnpm check',
  pluginRoot: '/opt/plug', runDir: RUN_DIR }

// The integration worktree path the engine derives from the launch stamp
// (waves.js: '.claude/worktrees/wf_' + stamp + '-integration'). Every slot read
// in the sidecar sentence is pinned to it with git -C, so no recorded sha can
// depend on the merge agent's ambient cwd (#173). It is RELATIVE to the repo
// root, which is why the sentence names the launch directory as the place the
// -C reads must run from.
const INTEGRATION_WT = '.claude/worktrees/wf_' + baseArgs.stamp + '-integration'

// The sidecar-write instruction, exactly as it must reach a merge-side agent
// once <runDir> has been substituted. Both the merge and the reconcile agent
// report MERGED heads, so both carry it verbatim.
const SIDECAR_SENTENCE =
  'Before you report, record heads mechanically FROM THE LAUNCH DIRECTORY — the session repo ' +
  'root this dispatch started you in, the one place the relative worktree path ' +
  INTEGRATION_WT + ' resolves; cd back to it first if you have moved. Then run mkdir -p ' +
  RUN_DIR + '/heads, then for each task branch you merged run git -C ' + INTEGRATION_WT +
  ' rev-parse <branch> > ' + RUN_DIR + '/heads/task-<taskId>, then git -C ' + INTEGRATION_WT +
  ' rev-parse HEAD > ' + RUN_DIR + '/heads/wave-<waveNumber>. Shell redirection only — never ' +
  'type a sha by hand, and never a bare rev-parse for a slot: -C pins every read to the ' +
  "integration worktree. A 'cannot change to' failure means you are not in the launch " +
  'directory — cd back there and rerun; never fall back to a bare rev-parse. Before reporting, ' +
  'self-check the wave slot: cat ' + RUN_DIR + '/heads/wave-<waveNumber> must print exactly ' +
  'the headSha you are about to report; if it is empty or different, cd to the launch ' +
  'directory and re-record.'

// The critic's file-read authority instruction, post-substitution.
const CRITIC_SENTENCE =
  'Authoritative shas live in ' + RUN_DIR + '/heads/: read task-<id> for each merged task id in ' +
  'your inputs, and the highest-numbered wave-<n> slot is your detach target. Treat a missing or ' +
  'malformed slot for a merged task exactly as an ancestry miss. Sha values quoted elsewhere in ' +
  'this prompt are context, not authority.'

// Assert the coarse mechanism the task text names, then the verbatim sentence.
function assertSidecarInstruction(prompt, who) {
  has(prompt, 'heads/task-', who + ': names the per-task sidecar slot')
  has(prompt, 'git -C ' + INTEGRATION_WT + ' rev-parse',
      who + ': records heads with a git -C rev-parse pinned to the integration worktree')
  has(prompt, '> ', who + ': records heads by shell redirection')
  // #173 round 2: INTEGRATION_WT is repo-root-relative, and the same prompt orders
  // the agent to cd INTO the worktree — so the sentence must say WHERE the -C reads
  // run, or they die 'cannot change to' and leave the slot empty.
  has(prompt, 'FROM THE LAUNCH DIRECTORY',
      who + ': anchors the -C reads to the launch directory, where the relative path resolves')
  has(prompt, SIDECAR_SENTENCE, who + ': carries the sidecar-write sentence verbatim')
  // #173: a bare rev-parse resolves against the agent's cwd, which is how an
  // eval-baseline sha reached heads/wave-4. No slot write may be cwd-relative,
  // and no failure path may fall back to one.
  assert(prompt.indexOf('then git rev-parse HEAD > ') === -1,
    who + ': records no slot with a bare, cwd-relative rev-parse')
  has(prompt, 'never fall back to a bare rev-parse',
      who + ': forbids a bare rev-parse as the recovery from a failed -C read')
  assert(prompt.indexOf('<runDir>') === -1,
    who + ': the <runDir> token must be substituted before dispatch')
  has(prompt, RUN_DIR + '/heads', who + ': the sidecar dir is the run dir this launch was given')
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

// ── Scenario 1: the merge agent is told to write the sidecars, with concrete slots ──
async function scenarioMergeWritesSidecars() {
  const captured = {}
  await runWorkflow({ agent: makeAgent(null, captured), args: baseArgs })

  const w1 = captured['merge:wave1']
  const w2 = captured['merge:wave2']
  assert(typeof w1 === 'string' && typeof w2 === 'string', 'both wave merges dispatched')

  assertSidecarInstruction(w1, 'merge:wave1')
  assertSidecarInstruction(w2, 'merge:wave2')

  // The per-dispatch line names the concrete slots so the agent infers nothing:
  // the wave's mergeable task ids plus this wave's integration-HEAD slot.
  has(w1, 'For this wave that means slots: heads/task-A, heads/task-B, and heads/wave-1.',
      'merge:wave1: per-dispatch line names this wave\'s concrete slots')
  has(w2, 'For this wave that means slots: heads/task-C and heads/wave-2.',
      'merge:wave2: per-dispatch line names this wave\'s concrete slots')
  // Slot names are per-wave, never carried over from a neighbouring wave.
  assert(w2.indexOf('heads/wave-1') === -1, 'merge:wave2: does not name wave 1\'s slot')
  assert(w1.indexOf('heads/wave-2') === -1, 'merge:wave1: does not name wave 2\'s slot')
  assert(w1.indexOf('heads/task-C') === -1, 'merge:wave1: does not name a later wave\'s task slot')

  console.log('scenario merge-writes-sidecars: OK')
}

// ── Scenario 2: the reconciliation agent carries the same instruction ─────────
async function scenarioReconcileWritesSidecars() {
  const captured = {}
  // Wave 1's merge conflicts once; the reconciliation agent resolves it and is
  // the role that then reports the MERGED head — so it must record it too.
  const mergeStatusFor = (label) => (label === 'merge:wave1' ? 'CONFLICT' : 'MERGED')
  await runWorkflow({ agent: makeAgent(mergeStatusFor, captured), args: baseArgs })

  const rec = captured['reconcile:wave1:1']
  assert(typeof rec === 'string', 'reconciliation agent dispatched after the conflict')
  assertSidecarInstruction(rec, 'reconcile:wave1:1')
  has(rec, 'For this wave that means slots: heads/task-A, heads/task-B, and heads/wave-1.',
      'reconcile:wave1:1: per-dispatch line names this wave\'s concrete slots')
  console.log('scenario reconcile-writes-sidecars: OK')
}

// ── Scenario 3: the completeness critic reads the sidecars as the authority ───
async function scenarioCriticReadsSidecars() {
  const captured = {}
  await runWorkflow({ agent: makeAgent(null, captured), args: baseArgs })

  const critic = captured['integration']
  assert(typeof critic === 'string', 'completeness critic dispatched')
  has(critic, RUN_DIR + '/heads/', 'critic: pointed at the run\'s heads sidecar dir')
  has(critic, 'detach target', 'critic: told which slot is its detach target')
  has(critic, 'ancestry miss', 'critic: a missing/malformed slot is an ancestry miss')
  has(critic, CRITIC_SENTENCE, 'critic: carries the file-read-authority sentence verbatim')
  assert(critic.indexOf('<runDir>') === -1,
    'critic: the <runDir> token must be substituted before dispatch')

  // #123: the sidecar is the SINGLE authority, and it must be stated FIRST.
  // The prompt used to open with a hard gate on the model-typed recorded sha
  // ("run git checkout --detach <recorded> … if it does not, report BLOCKED")
  // and only mention the sidecar in its closing sentence — so a fabricated
  // recorded sha detached the agent at a value nobody derived, then surfaced
  // as an unexplained BLOCKED. Pin the derived-first ordering, the derived
  // detach target, and the specific recorded-vs-derived mismatch signal.
  // Wave 2 is the last wave, so its merge reply is the recorded merge sha.
  const RECORDED_SHA = 'head-merge:wave2'
  has(critic, 'the recorded merge sha is ' + RECORDED_SHA,
      'critic: the recorded value is interpolated, labelled as recorded')
  const headsAt = critic.indexOf(RUN_DIR + '/heads/')
  const recordedAt = critic.indexOf(RECORDED_SHA)
  assert(headsAt !== -1 && recordedAt !== -1 && headsAt < recordedAt,
    'critic: the heads/ derivation precedes the first mention of the recorded sha')
  has(critic, 'run git checkout --detach <derived>',
      'critic: detaches at the derived slot value, never at the recorded sha')
  has(critic, 'recorded merge sha <recorded> != derived heads/ slot <derived>',
      'critic: a mismatch reports the specific recorded-vs-derived signal')
  console.log('scenario critic-reads-sidecars: OK')
}

// ── Scenario 4: reviewer-authored prose reaches the critic UNSUBSTITUTED ──────
// Path substitution is for ENGINE-authored text only. The CANNOT-VERIFY checklist
// is written by the per-task reviewers, and a reviewer describing this very
// feature quotes the literal <runDir> token — rewriting that quotation would hand
// the critic prose the reviewer never wrote. Same rule that keeps the plan's
// GLOBAL CONSTRAINTS outside fillPaths(), applied to a span that sits mid-prompt.
async function scenarioCannotVerifyPassesThroughVerbatim() {
  const captured = {}
  // Reviewer prose deliberately quoting the literal token, twice, in both fields.
  const REQUIREMENT = 'the merge agent writes <runDir>/heads/task-<id> by redirection'
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

  // Engine-authored spans in the SAME prompt are still substituted.
  has(critic, CRITIC_SENTENCE, 'critic: engine text is still path-substituted')
  console.log('scenario cannot-verify-passes-through-verbatim: OK')
}

await scenarioMergeWritesSidecars()
await scenarioReconcileWritesSidecars()
await scenarioCriticReadsSidecars()
await scenarioCannotVerifyPassesThroughVerbatim()
console.log('ALL SCENARIOS PASSED')
