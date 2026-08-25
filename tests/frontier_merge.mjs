// tests/frontier_merge.mjs
//
// Deterministic simulation of the CONTENDED (frontier) merge path in
// skills/ultrapowers/harnesses/waves.js. Same loader/stub structure as
// tests/sim_workflow.mjs — the real research-preview Workflow engine can't run
// in CI, so we stub its globals (agent, parallel, phase, log, args, budget) and
// execute the orchestrator the way the engine does (strip `export`, run the body
// as an async function).
//
// What this covers that sim_workflow.mjs does not: the derived-contention
// routing rule, the fold → resolve → adopt dispatch sequence, the serial
// resolver WORK LIST (one hunk-briefed resolver per open conflict, a single
// re-brief after a REJECTED reply, and the continued folds that arrive as
// `resolve` replies rather than a second fold dispatch), every route that must
// fall the wave back to the ordinary git-merge path, and the `frontier` report
// section.
//
// Self-asserting: throws (exit 1) on any failed expectation. Prints the
// suite-gate sentinel `ALL SCENARIOS PASSED` on success only.

import fs from 'node:fs'

const WF_URL = new URL('../skills/ultrapowers/harnesses/waves.js', import.meta.url)
const SRC = fs.readFileSync(WF_URL, 'utf8').replace('export const meta', 'const meta')

function runWorkflow({ agent, args, budget }) {
  const parallel = (thunks) => Promise.all(thunks.map((t) => t()))
  const phase = () => {}
  const log = () => {}
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

// ── Fixtures ─────────────────────────────────────────────────────────────────
const PLUGIN_ROOT = '/opt/plug'
const RUN_DIR = '/repo/.claude/ultrapowers/run-sim'
const PATH_ARGS = { pluginRoot: PLUGIN_ROOT, runDir: RUN_DIR }
// Fold-log path convention: <runDir>/frontier/wave-<n>/ with <n> 1-based (the
// heads/ slot precedent). Asserting the literal here is the pin on that.
const FDIR = RUN_DIR + '/frontier/wave-1'
const CLI = 'python3 ' + PLUGIN_ROOT + '/skills/ultrapowers/kernel/fold_wave.py'
const SETUP_HEAD = 'int0'

// A contended-shaped wave: two tasks whose declared `files` intersect. Under the
// shipped `--overlap serialize` default the compiler can never emit this, so
// every scenario here builds it by hand — exactly what a frontier-mode compile
// would produce.
const contendedWave = () => [[
  { id: 'A', title: 'alpha', body: 'edit the shared module', tier: 'cheap',
    files: ['src/shared.js'] },
  { id: 'B', title: 'beta', body: 'also edit the shared module', tier: 'cheap',
    files: ['src/shared.js', 'src/b.js'] },
]]

const argsFor = (waves, extra) => Object.assign(
  { waves, integrationBranch: 'ultra/integration-sim', stamp: 'sim', testCmd: 'pnpm check' },
  PATH_ARGS, extra || {})

// Every dispatch is recorded. `handle(label, prompt, opts)` overrides a role by
// returning a value (or throwing); returning undefined falls through to the
// defaults below. The contended labels have NO default on purpose: a scenario
// that reaches one it did not plan for fails loudly instead of silently passing.
function makeAgent(calls, handle) {
  return async (prompt, opts) => {
    const label = (opts && opts.label) || ''
    calls.push({ label, prompt, opts })
    // reviewer-prompts.md calls the GUARD the sole safety net; a dropped prepend
    // at any contended call site must fail here.
    assert(prompt.startsWith('SAFETY: Operate ONLY inside the git worktree'),
      'GUARD must head every dispatched prompt (label=' + label + ')')
    // The fold CLI path and every frontier path are baked as <pluginRoot>/<runDir>
    // tokens. No scenario's plan text quotes them, so an un-substituted token
    // anywhere is a dispatch that sends an agent to a nonexistent path.
    assert(prompt.indexOf('<pluginRoot>') === -1 && prompt.indexOf('<runDir>') === -1,
      'path placeholders must be substituted before dispatch (label=' + label + ')')
    if (handle) {
      const r = handle(label, prompt, opts)
      if (r !== undefined) return r
    }
    if (label === 'setup') return { branch: 'ultra/integration-sim', headSha: SETUP_HEAD }
    if (label.startsWith('impl:') || label.startsWith('fix:')) {
      const id = label.split(':')[1]
      return { status: 'DONE', summary: 's', branch: 'wt-' + id, headSha: 'sha-' + id,
               commit: 'c-' + id }
    }
    if (label.startsWith('review:')) return { verdict: 'PASS', issues: [] }
    // The ordinary git-merge path (the fallback target). Exactly `merge:wave<n>`;
    // the contended dispatches carry a further `:fold` / `:apply…` / `:adopt`.
    if (/^merge:wave\d+$/.test(label)) return { status: 'MERGED', headSha: 'plain-' + label }
    if (label === 'integration') {
      return { command: 'pytest', testsPassed: true, output: 'ok', findings: [] }
    }
    throw new Error('unexpected agent label: ' + label)
  }
}

const labels = (calls) => calls.map((c) => c.label)
const promptFor = (calls, label) => {
  const c = calls.find((x) => x.label === label)
  assert(c, 'expected a dispatch labelled ' + label + ' (got ' + JSON.stringify(labels(calls)) + ')')
  return c.prompt
}
const optsFor = (calls, label) => {
  const c = calls.find((x) => x.label === label)
  assert(c, 'expected a dispatch labelled ' + label + ' (got ' + JSON.stringify(labels(calls)) + ')')
  return c.opts
}
const has = (calls, label) => calls.some((c) => c.label === label)

// A COMPLETING fold reply: every task folded, nothing left narrated. Only a
// completing reply carries `selfChecks` — the CLI runs the two live self-checks
// inside whichever call completes the wave.
const cleanFoldReply = () => ({
  status: 'FOLDED', conflicts: 0, dispatchable: 0, parked: 0, selfChecks: 'ok',
  foldLogPath: FDIR + '/fold_log.jsonl', conflictsIndex: FDIR + '/conflicts.json',
  foldCliWallTimeSec: 2.5, open: [], remaining: [], complete: true,
})
// One open conflict as the engine sees it: keyed by the conflicts-index `i`
// (`(path, epoch)` is not unique), briefed off its hunks file. No narration
// file reaches the engine any more.
const openEntry = (i, path, epoch) => ({
  i, path, epoch, hunksFile: FDIR + '/conflict-' + i + '.hunks.txt', hunkCount: 2,
})
// A STOP reply: the fold halted at its first conflicted fold, so tasks are
// still `remaining`, the wave is not `complete`, and there is no `selfChecks`.
const conflictFoldReply = (open, remaining) => ({
  status: 'CONFLICTS', conflicts: open.length, dispatchable: open.length, parked: 0,
  foldLogPath: FDIR + '/fold_log.jsonl',
  conflictsIndex: FDIR + '/conflicts.json', foldCliWallTimeSec: 4.25, open,
  remaining: remaining || ['C'], complete: false,
})

// The documented `frontier[]` key list (references/report-format.md).
const FRONTIER_KEYS = ['autoResolved', 'conflictsIndex', 'foldCliCalls',
  'foldCliWallTimeSec', 'foldLogPath', 'resolverTranscripts', 'selfChecks', 'wave']
function assertFrontierShape(r, tag) {
  assert(Array.isArray(r.frontier), tag + ': report carries a frontier array')
  eq(r.frontier.length, 1, tag + ': exactly one frontier entry for the contended wave')
  eq(Object.keys(r.frontier[0]).sort(), FRONTIER_KEYS,
     tag + ': frontier entry carries exactly the documented keys')
  eq(r.frontier[0].wave, 1, tag + ': frontier wave number is 1-based')
}
// A fallback is one judgmentCalls entry naming its reason — one fact, one record.
function assertFellBack(r, calls, re, tag) {
  assert(r.judgmentCalls.some((j) => /contended merge fell back to the git-merge path/.test(j) &&
    re.test(j)),
    tag + ': a judgmentCalls entry names the fallback reason ' + re +
    ' (got ' + JSON.stringify(r.judgmentCalls) + ')')
  assert(has(calls, 'merge:wave1'),
    tag + ': the ordinary git-merge path ran after the fallback')
  eq(r.waveMerges[0].status, 'MERGED', tag + ': the wave merged via the fallback')
  eq(r.waveMerges[0].headSha, 'plain-merge:wave1', tag + ': the fallback merge sha is recorded')
}

// ── Scenario 1: clean fold → adopt ───────────────────────────────────────────
async function scenarioCleanFold() {
  const calls = []
  const agent = makeAgent(calls, (label) => {
    if (label === 'merge:wave1:fold') return cleanFoldReply()
    if (label === 'merge:wave1:adopt') return { status: 'MERGED', headSha: 'cand-1' }
    return undefined
  })
  const r = await runWorkflow({ agent, args: argsFor(contendedWave()), budget: undefined })

  // Routing: the contended path ran and the git-merge path did NOT.
  assert(has(calls, 'merge:wave1:fold'), 'clean: the wave routed to the contended fold')
  assert(!has(calls, 'merge:wave1'), 'clean: the ordinary git-merge path never ran')
  assert(!calls.some((c) => c.label.startsWith('resolve:')),
    'clean: a zero-conflict fold dispatches no resolver')

  const fold = promptFor(calls, 'merge:wave1:fold')
  // heads/ slot names for every merged task id must reach the contended dispatch —
  // the completeness critic reads a missing slot as an ancestry miss.
  for (const slot of ['heads/task-A', 'heads/task-B', 'heads/wave-1']) {
    assert(fold.indexOf(slot) !== -1, 'clean: fold dispatch names ' + slot)
  }
  assert(fold.indexOf(FDIR) !== -1,
    'clean: fold dispatch names the 1-based fold directory ' + FDIR)
  assert(fold.indexOf(CLI + ' fold --repo . --run-dir ' + RUN_DIR + ' --wave 1 --base ' +
    SETUP_HEAD + ' --branch A=wt-A:sha-A --branch B=wt-B:sha-B') !== -1,
    'clean: fold command is engine-authored in task-index order off the previous head')
  const foldOpts = optsFor(calls, 'merge:wave1:fold')
  eq(foldOpts.model, 'opus', 'clean: fold dispatches at the most-capable tier')
  assert(foldOpts.schema && foldOpts.schema.properties && foldOpts.schema.properties.open,
    'clean: fold dispatch carries FOLD_SCHEMA (it alone has `open`)')

  const adopt = promptFor(calls, 'merge:wave1:adopt')
  assert(adopt.indexOf(CLI + ' materialize --repo . --run-dir ' + RUN_DIR +
    ' --wave 1 --prev-head ' + SETUP_HEAD + ' --task-head A=sha-A --task-head B=sha-B') !== -1,
    'clean: adoption command carries the previous head and every task head')
  for (const slot of ['heads/task-A', 'heads/task-B', 'heads/wave-1']) {
    assert(adopt.indexOf(slot) !== -1, 'clean: adoption dispatch names ' + slot)
  }
  const adoptOpts = optsFor(calls, 'merge:wave1:adopt')
  assert(adoptOpts.schema && adoptOpts.schema.properties && adoptOpts.schema.properties.headSha &&
    !adoptOpts.schema.properties.open,
    'clean: adoption rides MERGE_SCHEMA, not FOLD_SCHEMA')

  // The adopted candidate is the wave's merge result.
  eq(r.waveMerges[0].status, 'MERGED', 'clean: wave merged')
  eq(r.waveMerges[0].headSha, 'cand-1', 'clean: the adopted candidate sha is the wave head')
  eq(r.waveMerges[0].branches, ['A', 'B'], 'clean: both branches recorded as submitted')
  assert(!r.judgmentCalls.some((j) => /contended merge fell back/.test(j)),
    'clean: no fallback recorded')

  // The frontier report section is populated from the reply scalars.
  assertFrontierShape(r, 'clean')
  eq(r.frontier[0].foldLogPath, FDIR + '/fold_log.jsonl', 'clean: fold log path recorded')
  eq(r.frontier[0].conflictsIndex, FDIR + '/conflicts.json', 'clean: conflicts index recorded')
  eq(r.frontier[0].selfChecks, 'ok', 'clean: self-checks recorded')
  eq(r.frontier[0].foldCliWallTimeSec, 2.5, 'clean: fold CLI wall time recorded')
  eq(r.frontier[0].resolverTranscripts, [], 'clean: no resolver transcripts on a clean fold')
  console.log('scenario 1 clean-fold: OK')
}

// ── Scenario 2: conflict → resolver → resolve → adopt ────────────────────────
async function scenarioConflictResolved() {
  const calls = []
  const open = [openEntry(1, 'src/shared.js', 3)]
  const agent = makeAgent(calls, (label) => {
    if (label === 'merge:wave1:fold') return conflictFoldReply(open, [])
    if (label === 'resolve:wave1:1:1') return { status: 'RESOLVED', notes: 'kept both edits' }
    if (label === 'merge:wave1:apply1:1') {
      return { status: 'FOLDED', complete: true, selfChecks: 'ok', open: [], remaining: [] }
    }
    if (label === 'merge:wave1:adopt') return { status: 'MERGED', headSha: 'cand-2' }
    return undefined
  })
  const r = await runWorkflow({ agent, args: argsFor(contendedWave()), budget: undefined })

  eq(labels(calls).filter((l) => l.startsWith('merge:') || l.startsWith('resolve:')),
     ['merge:wave1:fold', 'resolve:wave1:1:1', 'merge:wave1:apply1:1', 'merge:wave1:adopt'],
     'conflict: fold → resolver → resolve → adopt, in that order, with no git-merge fallback')

  const rp = promptFor(calls, 'resolve:wave1:1:1')
  assert(rp.indexOf('HUNKS: src/shared.js — read ' +
    FDIR + '/conflict-1.hunks.txt') !== -1,
    'conflict: the resolver is pointed at its hunks brief, never the narration')
  assert(rp.indexOf('NARRATION') === -1,
    'conflict: no narration file is named to the resolver any more')
  assert(rp.indexOf('REPLY DIR: write one file per hunk (h1.txt, h2.txt, …) plus ' +
    'notes.txt into ' + FDIR + '/reply-1-1') !== -1,
    'conflict: the resolver is given its engine-authored reply DIRECTORY')
  assert(rp.indexOf('PREVIOUS REPLY REJECTED') === -1,
    'conflict: a first attempt carries no rejection notice')
  assert(rp.indexOf('CONTENDING TASKS:') !== -1 &&
    rp.indexOf('- task A: alpha [files: src/shared.js]') !== -1 &&
    rp.indexOf('- task B: beta [files: src/shared.js, src/b.js]') !== -1,
    'conflict: both contending tasks\' intent reaches the resolver')

  // Resolver dispatch options. Task 9 verified live (2026-08-13) that agent()
  // accepts an options object with `model` omitted, and shipped the omission —
  // the resolver runs at the session-ambient model, like-for-like with the
  // graded production cell. This assertion is the tripwire if that ever changes
  // to the spec's pre-stated fallback (TIER.standard).
  const ro = optsFor(calls, 'resolve:wave1:1:1')
  assert(typeof ro.label === 'string' && ro.label,
    'conflict: resolver dispatch carries a label')
  assert(ro.schema && ro.schema.properties && ro.schema.properties.status &&
    ro.schema.properties.status.enum.indexOf('RESOLVED') !== -1,
    'conflict: resolver dispatch carries RESOLVER_SCHEMA')
  assert(!('model' in ro),
    'conflict: resolver dispatch omits `model` (shipped: session-ambient model)')

  const ap = promptFor(calls, 'merge:wave1:apply1:1')
  assert(ap.indexOf(CLI + ' resolve --repo . --run-dir ' + RUN_DIR + ' --wave 1' +
    ' --conflict 1 --reply-dir ' + FDIR + '/reply-1-1' +
    ' --branch A=wt-A:sha-A --branch B=wt-B:sha-B') !== -1,
    'conflict: the resolve command carries the conflict index, the reply dir and ' +
    'the wave\'s full task list (re-supplied on every call)')

  eq(r.waveMerges[0].headSha, 'cand-2', 'conflict: the adopted candidate is the wave head')
  assertFrontierShape(r, 'conflict')
  eq(r.frontier[0].resolverTranscripts,
     [{ conflict: 1, attempt: 1, path: 'src/shared.js', epoch: 3,
        hunksFile: FDIR + '/conflict-1.hunks.txt', replyDir: FDIR + '/reply-1-1',
        status: 'RESOLVED', notes: 'kept both edits' }],
     'conflict: the resolver transcript is recorded verbatim')
  eq(r.frontier[0].foldCliCalls, 3, 'conflict: fold + resolve + materialize = 3 CLI calls')
  eq(r.frontier[0].selfChecks, 'ok',
     'conflict: selfChecks is sourced from the COMPLETING reply — the stop reply carries none')
  console.log('scenario 2 conflict-resolved: OK')
}

// ── Scenario 3: a stale resolution is a REFUSAL, not a re-narration ─────────
// The kernel's epoch check is the idempotency guard against a re-issued
// command (spec §1b): staleness exits 2, the agent reports it as ERROR, and the
// wave falls back. The old markerless re-narration retry is gone — nothing
// re-briefs a resolver on a stale epoch, so no second resolver may be spent.
async function scenarioStaleFallback() {
  const calls = []
  const open = [openEntry(1, 'src/shared.js', 3)]
  const agent = makeAgent(calls, (label) => {
    if (label === 'merge:wave1:fold') return conflictFoldReply(open, [])
    if (label === 'resolve:wave1:1:1') return { status: 'RESOLVED', notes: 'first pass' }
    if (label === 'merge:wave1:apply1:1') return { status: 'ERROR', detail: 'stale' }
    return undefined
  })
  const r = await runWorkflow({ agent, args: argsFor(contendedWave()), budget: undefined })

  eq(labels(calls).filter((l) => l.startsWith('merge:') || l.startsWith('resolve:')),
     ['merge:wave1:fold', 'resolve:wave1:1:1', 'merge:wave1:apply1:1', 'merge:wave1'],
     'stale: one resolver, one apply, then the git-merge fallback — no re-narration retry')
  assert(!has(calls, 'resolve:wave1:1:2'),
    'stale: a stale apply never re-briefs a second resolver')
  assert(!has(calls, 'merge:wave1:adopt'), 'stale: nothing is adopted on a stale resolution')
  assertFellBack(r, calls,
    /resolution of src\/shared\.js not applied \(ERROR\): stale/, 'stale')
  assertFrontierShape(r, 'stale')
  eq(r.frontier[0].resolverTranscripts.length, 1,
     'stale: only the single resolver attempt is transcribed')
  console.log('scenario 3 stale-fallback: OK')
}

// ── Scenario 4: park → fallback to the plain git merge ───────────────────────
async function scenarioParkFallback() {
  const calls = []
  const agent = makeAgent(calls, (label) => {
    if (label === 'merge:wave1:fold') {
      return { status: 'PARKED', conflicts: 2, dispatchable: 1, parked: 1, selfChecks: 'ok',
               foldLogPath: FDIR + '/fold_log.jsonl', conflictsIndex: FDIR + '/conflicts.json',
               foldCliWallTimeSec: 1.75, detail: 'src/logo.bin is binary' }
    }
    return undefined
  })
  const r = await runWorkflow({ agent, args: argsFor(contendedWave()), budget: undefined })

  assert(has(calls, 'merge:wave1:fold'), 'park: the wave routed contended')
  assert(!calls.some((c) => c.label.startsWith('resolve:')),
    'park: a parked fold dispatches no resolver — the frontier cannot be completed')
  assert(!has(calls, 'merge:wave1:adopt'), 'park: nothing is adopted after a park')
  assertFellBack(r, calls, /fold parked an ineligible conflict/, 'park')
  // Recorded even on the fallback: the on-disk fold directory exists either way.
  assertFrontierShape(r, 'park')
  eq(r.frontier[0].conflictsIndex, FDIR + '/conflicts.json',
     'park: the conflicts index — the record of the park — is reported')
  console.log('scenario 4 park-fallback: OK')
}

// ── Scenario 5: budget exhaustion mid-resolver-loop → fallback ───────────────
async function scenarioBudgetExhaustedMidLoop() {
  const calls = []
  const openTwo = [openEntry(1, 'src/shared.js', 3), openEntry(2, 'src/b.js', 3)]
  let remaining = 100
  const agent = makeAgent(calls, (label) => {
    if (label === 'merge:wave1:fold') return conflictFoldReply(openTwo, [])
    if (label === 'resolve:wave1:1:1') return { status: 'RESOLVED', notes: 'ok' }
    if (label === 'merge:wave1:apply1:1') {
      remaining = 0   // exhausted AFTER conflict 1 landed, BEFORE conflict 2 dispatches
      // Conflict 2 is still waiting on the same stop: the CLI applied this
      // resolution and cannot fold on until the stop drains.
      return { status: 'CONFLICTS', open: [], waiting: [2] }
    }
    return undefined
  })
  const r = await runWorkflow({ agent, args: argsFor(contendedWave()),
    budget: { total: 100, remaining: () => remaining } })

  assert(!has(calls, 'resolve:wave1:2:1'),
    'budget: the second conflict\'s resolver is never dispatched')
  assert(!has(calls, 'merge:wave1:adopt'),
    'budget: nothing is adopted with conflicts still open')
  assertFellBack(r, calls,
    /budget exhausted before resolving conflict 2 \(1 outstanding\)/, 'budget')
  assertFrontierShape(r, 'budget')
  eq(r.frontier[0].resolverTranscripts.length, 1,
     'budget: only the completed resolver dispatch is transcribed')
  console.log('scenario 5 budget-exhausted-mid-loop: OK')
}

// ── Scenario 6: a thrown contended dispatch → fallback, never reconcile ──────
async function scenarioFoldDispatchThrows() {
  const calls = []
  const agent = makeAgent(calls, (label) => {
    if (label === 'merge:wave1:fold') throw new Error('engine overloaded')
    return undefined
  })
  const r = await runWorkflow({ agent, args: argsFor(contendedWave()), budget: undefined })

  assertFellBack(r, calls, /fold dispatch threw: engine overloaded/, 'throw')
  // The fallback is an ORDINARY git merge, not the reconciliation path: the plain
  // merge succeeded, so no reconcile agent may be spent.
  assert(!calls.some((c) => c.label.startsWith('reconcile:')),
    'throw: a thrown contended dispatch never escalates to reconciliation ' +
    '(got ' + JSON.stringify(labels(calls)) + ')')
  assertFrontierShape(r, 'throw')
  eq(r.frontier[0].foldLogPath, '',
     'throw: a fold that never replied contributes no paths, and reports none')
  console.log('scenario 6 fold-dispatch-throws: OK')
}

// ── Scenario 7: a red candidate suite → fallback ─────────────────────────────
async function scenarioCandidateSuiteFails() {
  const calls = []
  const agent = makeAgent(calls, (label) => {
    if (label === 'merge:wave1:fold') return cleanFoldReply()
    if (label === 'merge:wave1:adopt') {
      return { status: 'TEST_FAILED', detail: '3 failing tests in the candidate tree' }
    }
    return undefined
  })
  const r = await runWorkflow({ agent, args: argsFor(contendedWave()), budget: undefined })

  assertFellBack(r, calls,
    /candidate not adopted \(TEST_FAILED\): 3 failing tests in the candidate tree/,
    'red-candidate')
  assert(!calls.some((c) => c.label.startsWith('reconcile:')),
    'red-candidate: the fallback is the ordinary git merge, not reconciliation')
  assertFrontierShape(r, 'red-candidate')
  console.log('scenario 7 candidate-suite-failure: OK')
}

// ── Scenario 8: routing — what must NOT take the contended path ──────────────
async function scenarioRoutingDisjointFiles() {
  const calls = []
  const waves = [[
    { id: 'A', title: 'alpha', body: 'edit a', tier: 'cheap', files: ['src/a.js'] },
    { id: 'B', title: 'beta', body: 'edit b', tier: 'cheap', files: ['src/b.js'] },
  ]]
  const r = await runWorkflow({ agent: makeAgent(calls), args: argsFor(waves), budget: undefined })
  // Both tasks carry the tagged shape, but they came from DISJOINT dropped pairs:
  // no pairwise `files` intersection, so there is nothing to fold.
  assert(!calls.some((c) => c.label.indexOf('merge:wave1:') === 0),
    'routing/disjoint: no contended dispatch (got ' + JSON.stringify(labels(calls)) + ')')
  assert(has(calls, 'merge:wave1'), 'routing/disjoint: the ordinary git merge ran')
  eq(r.frontier, [], 'routing/disjoint: no frontier entry')
  console.log('scenario 8a routing-disjoint-files: OK')
}

async function scenarioRoutingLoneSurvivor() {
  const calls = []
  const agent = makeAgent(calls, (label) => {
    // B never produces a mergeable branch, so the intersecting pair collapses to
    // a lone survivor — there is no second side to fold against.
    if (label === 'impl:B') return { status: 'BLOCKED', summary: 'missing dependency' }
    return undefined
  })
  const r = await runWorkflow({ agent, args: argsFor(contendedWave()), budget: undefined })

  assert(!calls.some((c) => c.label.indexOf('merge:wave1:') === 0),
    'routing/lone: no contended dispatch (got ' + JSON.stringify(labels(calls)) + ')')
  assert(has(calls, 'merge:wave1'), 'routing/lone: the ordinary git merge ran')
  eq(r.waveMerges[0].branches, ['A'], 'routing/lone: only the survivor was submitted')
  eq(r.frontier, [], 'routing/lone: no frontier entry')
  console.log('scenario 8b routing-lone-survivor: OK')
}

async function scenarioRoutingResume() {
  const calls = []
  const r = await runWorkflow({ agent: makeAgent(calls),
    args: argsFor(contendedWave(), { resume: true }), budget: undefined })
  // Redirect / salvage / any future resume lane: the integration branch already
  // carries work the fold base cannot account for.
  assert(!calls.some((c) => c.label.indexOf('merge:wave1:') === 0),
    'routing/resume: a resume launch never routes contended ' +
    '(got ' + JSON.stringify(labels(calls)) + ')')
  assert(has(calls, 'merge:wave1'), 'routing/resume: the ordinary git merge ran')
  eq(r.frontier, [], 'routing/resume: no frontier entry')
  console.log('scenario 8c routing-resume: OK')
}

async function scenarioRoutingFrozenBase() {
  const calls = []
  const waves = [
    [{ id: 'X', title: 'prep', body: 'seed the module', tier: 'cheap', files: ['src/x.js'] }],
    [
      { id: 'A', title: 'alpha', body: 'edit the shared module', tier: 'cheap',
        files: ['src/shared.js'] },
      { id: 'B', title: 'beta', body: 'also edit the shared module', tier: 'cheap',
        files: ['src/shared.js'] },
    ],
  ]
  const agent = makeAgent(calls, (label) => {
    // Schema-legal MERGED without a headSha: the branch advanced but the recorded
    // wave base did not. A contended candidate built FROM that base would rewind
    // the integration branch over wave 1's merge.
    if (label === 'merge:wave1') return { status: 'MERGED' }
    return undefined
  })
  const r = await runWorkflow({ agent, args: argsFor(waves), budget: undefined })

  assert(r.judgmentCalls.some((j) => /merge reported MERGED without headSha/.test(j)),
    'routing/frozen: the frozen review base is recorded as a judgment call')
  assert(!calls.some((c) => c.label.indexOf('merge:wave2:') === 0),
    'routing/frozen: the contended-shaped wave 2 falls to the plain merge ' +
    '(got ' + JSON.stringify(labels(calls)) + ')')
  assert(has(calls, 'merge:wave2'), 'routing/frozen: wave 2 took the ordinary git merge')
  eq(r.frontier, [], 'routing/frozen: no frontier entry')
  console.log('scenario 8d routing-frozen-base: OK')
}

// ── Guard scenarios (a)–(o): each pins ONE defensive guard in contendedMerge's
// fold-reply gauntlet or the resolver/adoption null checks. The completeness
// critic mutation-verified that deleting any one of these guards left
// ALL SCENARIOS PASSED unchanged — every scenario below must fail if its
// guard is removed (see the mutation check run alongside this file). Every
// one falls back to the plain git-merge path, never reconcile. (a)–(i) are the
// first gate round's nine; (j)–(n) are the final gate round's four remaining
// mutation-found guards plus the Task-9-amend fallout on the missing-counts
// guard's CONFLICTS half; (o) is the #145 close — the selfChecks-absent
// adoption hole, the last missing-scalar case at the adoption boundary.

// (a) fold dispatch returns null/undefined reply.
async function scenarioGuardFoldReplyNull() {
  const calls = []
  const agent = makeAgent(calls, (label) => {
    if (label === 'merge:wave1:fold') return null
    return undefined
  })
  const r = await runWorkflow({ agent, args: argsFor(contendedWave()), budget: undefined })
  assertFellBack(r, calls, /fold dispatch returned no reply/, 'guard-a')
  assert(!calls.some((c) => c.label.startsWith('reconcile:')),
    'guard-a: never escalates to reconciliation')
  console.log('scenario 9a guard-fold-reply-null: OK')
}

// (b) resolver dispatch returns null mid-loop.
async function scenarioGuardResolverReplyNull() {
  const calls = []
  const open = [openEntry(1, 'src/shared.js', 3)]
  const agent = makeAgent(calls, (label) => {
    if (label === 'merge:wave1:fold') return conflictFoldReply(open)
    if (label === 'resolve:wave1:1:1') return null
    return undefined
  })
  const r = await runWorkflow({ agent, args: argsFor(contendedWave()), budget: undefined })
  assert(!has(calls, 'merge:wave1:apply1:1'),
    'guard-b: no resolve is dispatched after a null resolver reply')
  assert(!has(calls, 'merge:wave1:adopt'), 'guard-b: nothing is adopted')
  assertFellBack(r, calls, /resolver dispatch returned no reply on src\/shared\.js/, 'guard-b')
  assert(!calls.some((c) => c.label.startsWith('reconcile:')),
    'guard-b: never escalates to reconciliation')
  console.log('scenario 9b guard-resolver-reply-null: OK')
}

// (c) adoption dispatch returns null.
async function scenarioGuardAdoptionReplyNull() {
  const calls = []
  const agent = makeAgent(calls, (label) => {
    if (label === 'merge:wave1:fold') return cleanFoldReply()
    if (label === 'merge:wave1:adopt') return null
    return undefined
  })
  const r = await runWorkflow({ agent, args: argsFor(contendedWave()), budget: undefined })
  assertFellBack(r, calls, /adoption dispatch returned no reply/, 'guard-c')
  assert(!calls.some((c) => c.label.startsWith('reconcile:')),
    'guard-c: never escalates to reconciliation')
  console.log('scenario 9c guard-adoption-reply-null: OK')
}

// (d) selfChecks !== 'ok' in the fold reply.
async function scenarioGuardSelfChecksFailed() {
  const calls = []
  const agent = makeAgent(calls, (label) => {
    if (label === 'merge:wave1:fold') {
      return Object.assign(cleanFoldReply(),
        { selfChecks: 'failed: rehydrate manifest mismatch' })
    }
    return undefined
  })
  const r = await runWorkflow({ agent, args: argsFor(contendedWave()), budget: undefined })
  assert(!has(calls, 'merge:wave1:adopt'), 'guard-d: nothing is adopted on failed self-checks')
  assertFellBack(r, calls,
    /fold self-checks did not pass: failed: rehydrate manifest mismatch/, 'guard-d')
  console.log('scenario 9d guard-selfchecks-failed: OK')
}

// (e) parked > 0 is count-authority even when the status enum disagrees.
async function scenarioGuardParkedCountAuthority() {
  const calls = []
  const agent = makeAgent(calls, (label) => {
    if (label === 'merge:wave1:fold') return Object.assign(cleanFoldReply(), { parked: 1 })
    return undefined
  })
  const r = await runWorkflow({ agent, args: argsFor(contendedWave()), budget: undefined })
  assert(!has(calls, 'merge:wave1:adopt'),
    'guard-e: nothing is adopted when the parked count is non-zero')
  assertFellBack(r, calls,
    /fold parked 1 conflict\(s\) — see the conflicts index/, 'guard-e')
  console.log('scenario 9e guard-parked-count-authority: OK')
}

// (f) status: 'CONFLICTS' with an empty `open` list.
async function scenarioGuardConflictsEmptyOpen() {
  const calls = []
  const agent = makeAgent(calls, (label) => {
    if (label === 'merge:wave1:fold') {
      return Object.assign(conflictFoldReply([]), { conflicts: 1, dispatchable: 1 })
    }
    return undefined
  })
  const r = await runWorkflow({ agent, args: argsFor(contendedWave()), budget: undefined })
  assert(!calls.some((c) => c.label.startsWith('resolve:')),
    'guard-f: no resolver dispatches with nothing named to resolve')
  assertFellBack(r, calls,
    /fold reported CONFLICTS but named no dispatchable conflict/, 'guard-f')
  console.log('scenario 9f guard-conflicts-empty-open: OK')
}

// (g) open.length !== expectOpen (named vs counted mismatch).
async function scenarioGuardOpenCountMismatch() {
  const calls = []
  const one = [openEntry(1, 'src/shared.js', 3)]
  const agent = makeAgent(calls, (label) => {
    if (label === 'merge:wave1:fold') {
      return Object.assign(conflictFoldReply(one), { conflicts: 2, dispatchable: 2 })
    }
    return undefined
  })
  const r = await runWorkflow({ agent, args: argsFor(contendedWave()), budget: undefined })
  assert(!calls.some((c) => c.label.startsWith('resolve:')),
    'guard-g: no resolver dispatches when the named/counted conflicts disagree')
  assertFellBack(r, calls,
    /fold named 1 open conflict\(s\) but counted 2 still to resolve/, 'guard-g')
  console.log('scenario 9g guard-open-count-mismatch: OK')
}

// (h) status: 'FOLDED' with conflicts > 0 (the FOLDED-over-conflicts reply).
async function scenarioGuardFoldedWithConflicts() {
  const calls = []
  const agent = makeAgent(calls, (label) => {
    if (label === 'merge:wave1:fold') return Object.assign(cleanFoldReply(), { conflicts: 2 })
    return undefined
  })
  const r = await runWorkflow({ agent, args: argsFor(contendedWave()), budget: undefined })
  assert(!has(calls, 'merge:wave1:adopt'),
    'guard-h: a FOLDED reply over a non-zero conflict count is never adopted')
  assertFellBack(r, calls,
    /fold counted 2 conflict\(s\) but named none to resolve/, 'guard-h')
  console.log('scenario 9h guard-folded-with-conflicts: OK')
}

// (i) status: 'FOLDED' with the counts entirely omitted (no `conflicts` field
// at all — the guard added by the concurrent Task 9 amend).
async function scenarioGuardFoldedCountsOmitted() {
  const calls = []
  const agent = makeAgent(calls, (label) => {
    if (label === 'merge:wave1:fold') {
      const reply = cleanFoldReply()
      delete reply.conflicts
      delete reply.dispatchable
      delete reply.parked
      return reply
    }
    return undefined
  })
  const r = await runWorkflow({ agent, args: argsFor(contendedWave()), budget: undefined })
  assert(!has(calls, 'merge:wave1:adopt'),
    'guard-i: a FOLDED reply with no conflicts count is never adopted')
  assertFellBack(r, calls,
    /fold reported FOLDED with no conflicts count to verify against/, 'guard-i')
  console.log('scenario 9i guard-folded-counts-omitted: OK')
}

// (j)–(n): the four remaining mutation-found guards from the final gate round,
// plus the Task-9-amend fallout on the missing-counts guard (it lost its
// `status === 'FOLDED' &&` conjunct, so a CONFLICTS reply with the counts
// omitted now ALSO falls back — 9i above pins the FOLDED half, (n) pins the
// CONFLICTS half). Same discipline as (a)–(i): every scenario falls back to
// the plain git-merge path, never reconcile.

// (j) waves.js:1271-1272 — fold.status === 'ERROR' → fallback.
async function scenarioGuardFoldStatusError() {
  const calls = []
  const agent = makeAgent(calls, (label) => {
    if (label === 'merge:wave1:fold') {
      return { status: 'ERROR', detail: 'kernel CLI crashed', selfChecks: 'ok',
               foldLogPath: FDIR + '/fold_log.jsonl', conflictsIndex: FDIR + '/conflicts.json',
               foldCliWallTimeSec: 0.5 }
    }
    return undefined
  })
  const r = await runWorkflow({ agent, args: argsFor(contendedWave()), budget: undefined })
  assert(!has(calls, 'merge:wave1:adopt'), 'guard-j: nothing is adopted on a fold ERROR')
  assert(!calls.some((c) => c.label.startsWith('resolve:')),
    'guard-j: an ERROR fold dispatches no resolver')
  assertFellBack(r, calls, /fold reported ERROR: kernel CLI crashed/, 'guard-j')
  console.log('scenario 9j guard-fold-status-error: OK')
}

// (k) waves.js:1370-1371 — resolver reply status !== 'RESOLVED' → fallback.
async function scenarioGuardResolverStatusNotResolved() {
  const calls = []
  const open = [openEntry(1, 'src/shared.js', 3)]
  const agent = makeAgent(calls, (label) => {
    if (label === 'merge:wave1:fold') return conflictFoldReply(open)
    if (label === 'resolve:wave1:1:1') return { status: 'BLOCKED', notes: 'cannot reconcile' }
    return undefined
  })
  const r = await runWorkflow({ agent, args: argsFor(contendedWave()), budget: undefined })
  assert(!has(calls, 'merge:wave1:apply1:1'),
    'guard-k: no resolve is dispatched after a non-RESOLVED resolver reply')
  assert(!has(calls, 'merge:wave1:adopt'), 'guard-k: nothing is adopted')
  assertFellBack(r, calls, /resolver reported BLOCKED on src\/shared\.js/, 'guard-k')
  console.log('scenario 9k guard-resolver-status-not-resolved: OK')
}

// (l) waves.js:1383-1384 — resolve-apply dispatch returned no reply → fallback.
async function scenarioGuardResolveApplyReplyNull() {
  const calls = []
  const open = [openEntry(1, 'src/shared.js', 3)]
  const agent = makeAgent(calls, (label) => {
    if (label === 'merge:wave1:fold') return conflictFoldReply(open)
    if (label === 'resolve:wave1:1:1') return { status: 'RESOLVED', notes: 'ok' }
    if (label === 'merge:wave1:apply1:1') return null
    return undefined
  })
  const r = await runWorkflow({ agent, args: argsFor(contendedWave()), budget: undefined })
  assert(!has(calls, 'merge:wave1:adopt'), 'guard-l: nothing is adopted')
  assertFellBack(r, calls,
    /resolve dispatch returned no reply on src\/shared\.js/, 'guard-l')
  console.log('scenario 9l guard-resolve-apply-reply-null: OK')
}

// (m) The apply-reply retry rule, inverted from the old stale re-narration.
// REJECTED (exit 4 — the reply-dir grammar refused before any kernel work) is
// the ONE retryable apply status: the engine re-briefs the same resolver once,
// carrying the reason, and a second REJECTED falls the wave back. Every other
// non-advancing status — ERROR included — falls back immediately, because a
// kernel that refused the work will refuse it again.
async function scenarioGuardRejectedRetriedOnce() {
  const calls = []
  const open = [openEntry(1, 'src/shared.js', 3)]
  const agent = makeAgent(calls, (label) => {
    if (label === 'merge:wave1:fold') return conflictFoldReply(open)
    if (label === 'resolve:wave1:1:1') return { status: 'RESOLVED', notes: 'first try' }
    if (label === 'merge:wave1:apply1:1') {
      return { status: 'REJECTED', detail: 'missing reply for h2' }
    }
    if (label === 'resolve:wave1:1:2') return { status: 'RESOLVED', notes: 'second try' }
    if (label === 'merge:wave1:apply1:2') {
      return { status: 'REJECTED', detail: 'h1: final line without newline' }
    }
    return undefined
  })
  const r = await runWorkflow({ agent, args: argsFor(contendedWave()), budget: undefined })

  eq(labels(calls).filter((l) => l.startsWith('merge:wave1:a') || l.startsWith('resolve:')),
     ['resolve:wave1:1:1', 'merge:wave1:apply1:1', 'resolve:wave1:1:2',
      'merge:wave1:apply1:2'],
     'guard-m: exactly ONE re-brief after a rejected reply, then no more')
  const rp2 = promptFor(calls, 'resolve:wave1:1:2')
  assert(rp2.indexOf('PREVIOUS REPLY REJECTED: missing reply for h2') !== -1,
    'guard-m: the re-brief carries the kernel\'s rejection reason')
  assert(rp2.indexOf('REPLY DIR: write one file per hunk (h1.txt, h2.txt, …) plus ' +
    'notes.txt into ' + FDIR + '/reply-1-2') !== -1,
    'guard-m: the re-brief writes a FRESH reply directory (attempt 2)')
  assert(!has(calls, 'merge:wave1:adopt'), 'guard-m: nothing is adopted')
  assertFellBack(r, calls,
    /resolver reply rejected twice on src\/shared\.js: h1: final line without newline/,
    'guard-m')
  eq(r.frontier[0].resolverTranscripts.map((t) => [t.conflict, t.attempt, t.status]),
     [[1, 1, 'RESOLVED'], [1, 2, 'RESOLVED']],
     'guard-m: both briefed attempts are transcribed against the same conflict index')
  console.log('scenario 9m guard-rejected-retried-once: OK')
}

async function scenarioGuardApplyErrorFallsBackAtOnce() {
  const calls = []
  const open = [openEntry(1, 'src/shared.js', 3)]
  const agent = makeAgent(calls, (label) => {
    if (label === 'merge:wave1:fold') return conflictFoldReply(open)
    if (label === 'resolve:wave1:1:1') return { status: 'RESOLVED', notes: 'ok' }
    if (label === 'merge:wave1:apply1:1') {
      return { status: 'ERROR', detail: 'kernel-limit park exceeded' }
    }
    return undefined
  })
  const r = await runWorkflow({ agent, args: argsFor(contendedWave()), budget: undefined })
  assert(!has(calls, 'resolve:wave1:1:2'),
    'guard-m2: an ERROR apply is never retried — only REJECTED is')
  assert(!has(calls, 'merge:wave1:adopt'), 'guard-m2: nothing is adopted')
  assertFellBack(r, calls,
    /resolution of src\/shared\.js not applied \(ERROR\): kernel-limit park exceeded/,
    'guard-m2')
  console.log('scenario 9m2 guard-apply-error-falls-back-at-once: OK')
}

// (n) status: 'CONFLICTS' with the counts entirely omitted — the missing-counts
// guard lost its FOLDED-only conjunct in the concurrent Task 9 amend, so this
// half of the reply space now falls back too (see 9i for the FOLDED half).
async function scenarioGuardConflictsCountsOmitted() {
  const calls = []
  const agent = makeAgent(calls, (label) => {
    if (label === 'merge:wave1:fold') {
      const reply = conflictFoldReply([openEntry(1, 'src/shared.js', 3)])
      delete reply.conflicts
      delete reply.dispatchable
      return reply
    }
    return undefined
  })
  const r = await runWorkflow({ agent, args: argsFor(contendedWave()), budget: undefined })
  assert(!calls.some((c) => c.label.startsWith('resolve:')),
    'guard-n: a CONFLICTS reply with no conflicts count dispatches no resolver')
  assert(!has(calls, 'merge:wave1:adopt'), 'guard-n: nothing is adopted')
  assertFellBack(r, calls,
    /fold reported CONFLICTS with no conflicts count to verify against/, 'guard-n')
  console.log('scenario 9n guard-conflicts-counts-omitted: OK')
}

// (o) status: 'FOLDED' with `selfChecks` entirely omitted (#145). The shape is
// schema-legal — FOLD_SCHEMA requires only `status`, because resolve replies
// share it — so the guard must be unconditional: the fold STEP orders the
// agent to copy `selfChecks` from the CLI's stdout, and absence of the
// attestation falls back exactly like a named failure. Counts are present on
// purpose: only the attestation is missing, so nothing else can trip first.
async function scenarioGuardSelfChecksOmitted() {
  const calls = []
  const agent = makeAgent(calls, (label) => {
    if (label === 'merge:wave1:fold') {
      const reply = cleanFoldReply()
      delete reply.selfChecks
      return reply
    }
    return undefined
  })
  const r = await runWorkflow({ agent, args: argsFor(contendedWave()), budget: undefined })
  assert(!has(calls, 'merge:wave1:adopt'),
    'guard-o: a fold reply with no selfChecks attestation is never adopted')
  assert(!calls.some((c) => c.label.startsWith('resolve:')),
    'guard-o: a fold reply with no selfChecks attestation dispatches no resolver')
  assertFellBack(r, calls,
    /fold self-checks did not pass: \(absent from the reply\)/, 'guard-o')
  console.log('scenario 9o guard-selfchecks-omitted: OK')
}

// (p) The `waiting` shape: the CLI applied the resolution but the current stop
// has not drained, so it folds no further and names the entries still waiting.
// That is a LEGAL continuation, not a fallback — but the waiting set is held to
// the engine's own outstanding list, minus the entry just applied. A `waiting`
// that disagrees (or an empty one, which the CLI never prints) is a contract
// violation: believing it would drop a conflict nobody ever resolves.
async function scenarioWaitingShapeLegal() {
  const calls = []
  const openTwo = [openEntry(1, 'src/shared.js', 3), openEntry(2, 'src/b.js', 3)]
  const agent = makeAgent(calls, (label) => {
    if (label === 'merge:wave1:fold') return conflictFoldReply(openTwo, [])
    if (label === 'resolve:wave1:1:1') return { status: 'RESOLVED', notes: 'a' }
    if (label === 'merge:wave1:apply1:1') {
      return { status: 'CONFLICTS', open: [], waiting: [2] }
    }
    if (label === 'resolve:wave1:2:1') return { status: 'RESOLVED', notes: 'b' }
    if (label === 'merge:wave1:apply2:1') {
      return { status: 'FOLDED', complete: true, selfChecks: 'ok', open: [], remaining: [] }
    }
    if (label === 'merge:wave1:adopt') return { status: 'MERGED', headSha: 'cand-p' }
    return undefined
  })
  const r = await runWorkflow({ agent, args: argsFor(contendedWave()), budget: undefined })

  eq(labels(calls).filter((l) => l.startsWith('merge:') || l.startsWith('resolve:')),
     ['merge:wave1:fold', 'resolve:wave1:1:1', 'merge:wave1:apply1:1',
      'resolve:wave1:2:1', 'merge:wave1:apply2:1', 'merge:wave1:adopt'],
     'waiting-legal: a matching waiting list continues the work list, never falls back')
  eq(r.waveMerges[0].headSha, 'cand-p', 'waiting-legal: the candidate was adopted')
  eq(r.frontier[0].foldCliCalls, 4,
     'waiting-legal: fold + two resolves + materialize = 4 CLI calls')
  console.log('scenario 9p waiting-shape-legal: OK')
}

async function scenarioWaitingShapeMismatch() {
  for (const [tag, waiting, re] of [
    ['empty', [], /reported waiting \[\] but the engine was holding \[2\] outstanding/],
    ['mismatch', [3], /reported waiting \[3\] but the engine was holding \[2\] outstanding/],
  ]) {
    const calls = []
    const openTwo = [openEntry(1, 'src/shared.js', 3), openEntry(2, 'src/b.js', 3)]
    const agent = makeAgent(calls, (label) => {
      if (label === 'merge:wave1:fold') return conflictFoldReply(openTwo, [])
      if (label === 'resolve:wave1:1:1') return { status: 'RESOLVED', notes: 'a' }
      if (label === 'merge:wave1:apply1:1') return { status: 'CONFLICTS', open: [], waiting }
      return undefined
    })
    const r = await runWorkflow({ agent, args: argsFor(contendedWave()), budget: undefined })
    assert(!has(calls, 'resolve:wave1:2:1'),
      'waiting-' + tag + ': the work list never advances on a disagreeing waiting set')
    assert(!has(calls, 'merge:wave1:adopt'), 'waiting-' + tag + ': nothing is adopted')
    assertFellBack(r, calls, re, 'waiting-' + tag)
  }
  console.log('scenario 9p2 waiting-shape-mismatch: OK')
}

// (q) The selfChecks guard is scoped to the COMPLETING reply. A stop reply
// legitimately carries no attestation — the CLI runs its two live self-checks
// inside whichever call completes the wave — so requiring one here would fall
// every conflicted wave back before a single resolver was dispatched.
async function scenarioStopReplyNeedsNoSelfChecks() {
  const calls = []
  const open = [openEntry(1, 'src/shared.js', 3)]
  const agent = makeAgent(calls, (label) => {
    if (label === 'merge:wave1:fold') {
      // Exactly the CLI's stop shape: no selfChecks key at all.
      return { status: 'CONFLICTS', conflicts: 1, dispatchable: 1, parked: 0,
               foldLogPath: FDIR + '/fold_log.jsonl',
               conflictsIndex: FDIR + '/conflicts.json',
               open, remaining: ['t3'], complete: false }
    }
    if (label === 'resolve:wave1:1:1') return { status: 'RESOLVED', notes: 'ok' }
    if (label === 'merge:wave1:apply1:1') {
      return { status: 'FOLDED', complete: true, selfChecks: 'ok', open: [], remaining: [] }
    }
    if (label === 'merge:wave1:adopt') return { status: 'MERGED', headSha: 'cand-q' }
    return undefined
  })
  const r = await runWorkflow({ agent, args: argsFor(contendedWave()), budget: undefined })
  assert(has(calls, 'resolve:wave1:1:1'),
    'guard-q: a stop reply without selfChecks still dispatches its resolver')
  eq(r.waveMerges[0].headSha, 'cand-q', 'guard-q: the wave adopted its candidate')
  assert(!r.judgmentCalls.some((j) => /contended merge fell back/.test(j)),
    'guard-q: no fallback (got ' + JSON.stringify(r.judgmentCalls) + ')')
  eq(r.frontier[0].selfChecks, 'ok',
     'guard-q: the attestation is taken from the completing reply')
  console.log('scenario 9q stop-reply-no-selfchecks-not-checked: OK')
}

// ── Scenario 10: the work list across CONTINUED folds ───────────────────────
// The incremental protocol folds on inside the same `resolve` call once a stop
// drains, so a later stop's conflicts arrive as an apply REPLY — never as a
// second fold dispatch. The engine's work list must be REPLACED by that reply's
// `open`, not appended to and not ignored.
async function scenarioWorkListToComplete() {
  const calls = []
  const first = [openEntry(1, 'src/shared.js', 3)]
  const second = [openEntry(2, 'src/b.js', 5)]
  const agent = makeAgent(calls, (label) => {
    if (label === 'merge:wave1:fold') return conflictFoldReply(first, ['t3'])
    if (label === 'resolve:wave1:1:1') return { status: 'RESOLVED', notes: 'a' }
    if (label === 'merge:wave1:apply1:1') {
      // Stop 1 drained, the CLI folded on, and t3 opened a NEW conflict.
      return { status: 'CONFLICTS', conflicts: 1, dispatchable: 1, open: second,
               remaining: [], complete: false, foldCliWallTimeSec: 1.5 }
    }
    if (label === 'resolve:wave1:2:1') return { status: 'RESOLVED', notes: 'b' }
    if (label === 'merge:wave1:apply2:1') {
      return { status: 'FOLDED', complete: true, selfChecks: 'ok', open: [],
               remaining: [], foldCliWallTimeSec: 2.25 }
    }
    if (label === 'merge:wave1:adopt') {
      return { status: 'MERGED', headSha: 'cand-10a', foldCliWallTimeSec: 1 }
    }
    return undefined
  })
  const r = await runWorkflow({ agent, args: argsFor(contendedWave()), budget: undefined })

  eq(labels(calls).filter((l) => l.startsWith('merge:') || l.startsWith('resolve:')),
     ['merge:wave1:fold', 'resolve:wave1:1:1', 'merge:wave1:apply1:1',
      'resolve:wave1:2:1', 'merge:wave1:apply2:1', 'merge:wave1:adopt'],
     'work-list: the continued fold conflict is resolved without a second fold dispatch')
  eq(calls.filter((c) => c.label.startsWith('resolve:')).length, 2,
     'work-list: exactly two resolver dispatches')
  const rp2 = promptFor(calls, 'resolve:wave1:2:1')
  assert(rp2.indexOf('HUNKS: src/b.js — read ' + FDIR + '/conflict-2.hunks.txt') !== -1,
    'work-list: the second resolver is briefed off the NEW conflict index')
  const ap2 = promptFor(calls, 'merge:wave1:apply2:1')
  assert(ap2.indexOf('--conflict 2 --reply-dir ' + FDIR + '/reply-2-1') !== -1,
    'work-list: the second apply names conflict 2 and its own reply directory')

  eq(r.waveMerges[0].headSha, 'cand-10a', 'work-list: the completed fold adopted')
  assertFrontierShape(r, 'work-list')
  eq(r.frontier[0].foldCliCalls, 4,
     'work-list: fold + resolve + resolve + materialize = 4 CLI calls')
  eq(r.frontier[0].foldCliWallTimeSec, 4.25 + 1.5 + 2.25 + 1,
     'work-list: the wall clock sums every STEP reply that timed its invocation')
  eq(r.frontier[0].selfChecks, 'ok', 'work-list: selfChecks comes from the completing reply')
  eq(r.frontier[0].resolverTranscripts.map((t) => [t.conflict, t.path, t.epoch]),
     [[1, 'src/shared.js', 3], [2, 'src/b.js', 5]],
     'work-list: each transcript is keyed by its conflicts-index i')
  console.log('scenario 10a work-list-to-complete: OK')
}

// The park PRE-SCAN: the whole wave is folded once in memory before the log is
// written, so a wave that is going to park is reported before a single resolver
// is dispatched. It reports parked > 0 with an EMPTY open list.
async function scenarioParkedPreScan() {
  const calls = []
  const agent = makeAgent(calls, (label) => {
    if (label === 'merge:wave1:fold') {
      return { status: 'PARKED', conflicts: 1, dispatchable: 0, parked: 1, open: [],
               remaining: ['A', 'B'], complete: false,
               foldLogPath: FDIR + '/fold_log.jsonl',
               conflictsIndex: FDIR + '/conflicts.json', foldCliWallTimeSec: 0.9,
               detail: 'marker-shaped content in src/shared.js' }
    }
    return undefined
  })
  const r = await runWorkflow({ agent, args: argsFor(contendedWave()), budget: undefined })
  assert(!calls.some((c) => c.label.startsWith('resolve:')),
    'pre-scan park: no resolver is dispatched — the pre-scan runs before the log exists')
  assert(!has(calls, 'merge:wave1:adopt'), 'pre-scan park: nothing is adopted')
  assertFellBack(r, calls,
    /fold parked an ineligible conflict: marker-shaped content in src\/shared\.js/,
    'pre-scan park')
  assertFrontierShape(r, 'pre-scan park')
  eq(r.frontier[0].foldCliCalls, 1, 'pre-scan park: exactly one CLI call was driven')
  console.log('scenario 10b parked-pre-scan: OK')
}

// Scenario 5's budget checkpoint, mirrored across the CONTINUED-fold leg: the
// work list is re-seeded from an apply reply, and the checkpoint must guard that
// entry too. Exhaustion routes to fallback, which is still live before adoption.
async function scenarioBudgetExhaustedMidWorkList() {
  const calls = []
  const first = [openEntry(1, 'src/shared.js', 3)]
  const second = [openEntry(2, 'src/b.js', 5)]
  let remaining = 100
  const agent = makeAgent(calls, (label) => {
    if (label === 'merge:wave1:fold') return conflictFoldReply(first, ['t3'])
    if (label === 'resolve:wave1:1:1') return { status: 'RESOLVED', notes: 'a' }
    if (label === 'merge:wave1:apply1:1') {
      remaining = 0   // exhausted AFTER the continued fold, BEFORE conflict 2 dispatches
      return { status: 'CONFLICTS', conflicts: 1, dispatchable: 1, open: second,
               remaining: [], complete: false }
    }
    return undefined
  })
  const r = await runWorkflow({ agent, args: argsFor(contendedWave()),
    budget: { total: 100, remaining: () => remaining } })

  assert(!has(calls, 'resolve:wave1:2:1'),
    'budget/work-list: the continued fold resolver is never dispatched')
  assert(!has(calls, 'merge:wave1:adopt'),
    'budget/work-list: nothing is adopted with a conflict still open')
  assertFellBack(r, calls,
    /budget exhausted before resolving conflict 2 \(1 outstanding\)/, 'budget/work-list')
  eq(r.frontier[0].resolverTranscripts.length, 1,
     'budget/work-list: only the completed resolver dispatch is transcribed')
  console.log('scenario 10c budget-exhausted-mid-work-list: OK')
}

// (n2) The missing-counts guard on the CONTINUED-fold leg: an apply reply that
// names an `open` list with no `conflicts` scalar is the same contract violation
// as the fold-leg 9n — and the same silent-drop risk, since the work list is
// re-seeded from exactly that list.
async function scenarioGuardContinuedFoldCountsOmitted() {
  const calls = []
  const first = [openEntry(1, 'src/shared.js', 3)]
  const agent = makeAgent(calls, (label) => {
    if (label === 'merge:wave1:fold') return conflictFoldReply(first, ['t3'])
    if (label === 'resolve:wave1:1:1') return { status: 'RESOLVED', notes: 'a' }
    if (label === 'merge:wave1:apply1:1') {
      return { status: 'CONFLICTS', open: [openEntry(2, 'src/b.js', 5)] }
    }
    return undefined
  })
  const r = await runWorkflow({ agent, args: argsFor(contendedWave()), budget: undefined })
  assert(!has(calls, 'resolve:wave1:2:1'),
    'guard-n2: no resolver is dispatched off an uncounted continued-fold stop')
  assert(!has(calls, 'merge:wave1:adopt'), 'guard-n2: nothing is adopted')
  assertFellBack(r, calls,
    /continued fold reported CONFLICTS with no conflicts count to verify against/,
    'guard-n2')
  console.log('scenario 9n2 guard-continued-fold-counts-omitted: OK')
}

// (g2) The named-vs-counted guard on the CONTINUED-fold leg — 9g's sibling. A
// short `open` list here is the same silent drop: the work list is re-seeded
// from exactly that list, so an unnamed conflict is one nobody ever resolves.
async function scenarioGuardContinuedFoldOpenCountMismatch() {
  const calls = []
  const first = [openEntry(1, 'src/shared.js', 3)]
  const agent = makeAgent(calls, (label) => {
    if (label === 'merge:wave1:fold') return conflictFoldReply(first, ['t3'])
    if (label === 'resolve:wave1:1:1') return { status: 'RESOLVED', notes: 'a' }
    if (label === 'merge:wave1:apply1:1') {
      return { status: 'CONFLICTS', conflicts: 2, dispatchable: 2,
               open: [openEntry(2, 'src/b.js', 5)], remaining: [], complete: false }
    }
    return undefined
  })
  const r = await runWorkflow({ agent, args: argsFor(contendedWave()), budget: undefined })
  assert(!has(calls, 'resolve:wave1:2:1'),
    'guard-g2: no resolver is dispatched off a short continued-fold stop')
  assert(!has(calls, 'merge:wave1:adopt'), 'guard-g2: nothing is adopted')
  assertFellBack(r, calls,
    /continued fold named 1 open conflict\(s\) but counted 2 still to resolve/, 'guard-g2')
  console.log('scenario 9g2 guard-continued-fold-open-count-mismatch: OK')
}

// (o2) The selfChecks attestation on a COMPLETING apply reply — 9o's sibling
// across the incremental protocol. The wave usually completes inside a `resolve`
// call now, so this is where the #145 hole actually lives: a `complete` reply
// with no attestation is schema-legal and lands at the adoption boundary.
async function scenarioGuardApplySelfChecksOmitted() {
  const calls = []
  const open = [openEntry(1, 'src/shared.js', 3)]
  const agent = makeAgent(calls, (label) => {
    if (label === 'merge:wave1:fold') return conflictFoldReply(open, [])
    if (label === 'resolve:wave1:1:1') return { status: 'RESOLVED', notes: 'ok' }
    if (label === 'merge:wave1:apply1:1') {
      return { status: 'FOLDED', complete: true, open: [], remaining: [] }
    }
    return undefined
  })
  const r = await runWorkflow({ agent, args: argsFor(contendedWave()), budget: undefined })
  assert(!has(calls, 'merge:wave1:adopt'),
    'guard-o2: a completing apply reply with no attestation is never adopted')
  assertFellBack(r, calls,
    /fold self-checks did not pass: \(absent from the reply\)/, 'guard-o2')
  console.log('scenario 9o2 guard-apply-selfchecks-omitted: OK')
}

// ── Scenario 11: Commutes plumbing, autoResolved, composition rows ───────────
// The rev-7 contract surface (spec §2b): the plan's `Commutes:` declarations ride
// the fold/resolve commands as `--commutes`, the kernel auto-resolves a conflict
// on a path EVERY writer declared (no resolver is dispatched for it, and the count
// comes back as `autoResolved`), and the engine records a `composition-unpinned:`
// judgment call for every multi-writer path some writer did NOT declare.

// A wave whose two tasks contend on shared.py: t1 declares it commutes, t2 does
// not. `files` drives contention routing; `writes`/`commutes` drive the rows.
const commutesWave = () => [[
  { id: 't1', title: 'one', body: 'append to shared', tier: 'cheap',
    files: ['shared.py'], writes: ['shared.py'], commutes: ['shared.py'] },
  { id: 't2', title: 'two', body: 'also append to shared', tier: 'cheap',
    files: ['shared.py'], writes: ['shared.py'], commutes: [] },
]]

// ── 11a: an auto-resolved fold completes without a resolver dispatch ─────────
// The kernel resolved the conflict in process against the contract, so the fold
// never stopped on it: a COMPLETING reply carrying conflicts 0 and autoResolved 1.
// Nothing about that may dispatch a resolver, and the count must reach the report.
async function scenarioAutoResolvedFoldCompletes() {
  const calls = []
  const agent = makeAgent(calls, (label) => {
    if (label === 'merge:wave1:fold') {
      return { status: 'FOLDED', conflicts: 0, dispatchable: 0, parked: 0,
               autoResolved: 1, selfChecks: 'ok',
               foldLogPath: FDIR + '/fold_log.jsonl',
               conflictsIndex: FDIR + '/conflicts.json', foldCliWallTimeSec: 3.5,
               open: [], remaining: [], complete: true }
    }
    if (label === 'merge:wave1:adopt') return { status: 'MERGED', headSha: 'cand-auto' }
    return undefined
  })
  const r = await runWorkflow({ agent, args: argsFor(commutesWave()), budget: undefined })

  assert(has(calls, 'merge:wave1:fold'), 'auto: the wave routed to the contended fold')
  assert(!calls.some((c) => c.label.startsWith('resolve:')),
    'auto: an auto-resolved conflict dispatches no resolver')
  assert(!has(calls, 'merge:wave1'), 'auto: the ordinary git-merge path never ran')
  eq(r.waveMerges[0].status, 'MERGED', 'auto: the wave adopted its folded candidate')
  eq(r.waveMerges[0].headSha, 'cand-auto', 'auto: the adopted candidate is the wave head')
  assertFrontierShape(r, 'auto')
  eq(r.frontier[0].autoResolved, 1, 'auto: the autoResolved count reaches the frontier entry')
  eq(r.frontier[0].foldCliCalls, 2, 'auto: fold + materialize = 2 CLI calls, no resolve leg')
  console.log('scenario 11a auto-resolved-fold: OK')
}

// ── 11b: --commutes rides fold AND resolve, for declaring tasks only ─────────
async function scenarioCommutesArgsOnCommands() {
  const calls = []
  const open = [openEntry(1, 'shared.py', 2)]
  const agent = makeAgent(calls, (label) => {
    if (label === 'merge:wave1:fold') return conflictFoldReply(open, [])
    if (label === 'resolve:wave1:1:1') return { status: 'RESOLVED', notes: 'unioned' }
    if (label === 'merge:wave1:apply1:1') {
      return { status: 'FOLDED', complete: true, selfChecks: 'ok', autoResolved: 2,
               open: [], remaining: [] }
    }
    if (label === 'merge:wave1:adopt') return { status: 'MERGED', headSha: 'cand-c' }
    return undefined
  })
  const r = await runWorkflow({ agent, args: argsFor(commutesWave()), budget: undefined })

  const fold = promptFor(calls, 'merge:wave1:fold')
  assert(fold.indexOf(' --commutes t1=shared.py') !== -1,
    'commutes-args: the fold command carries the declaring task\'s commutes paths')
  assert(fold.indexOf('--commutes t2') === -1,
    'commutes-args: a task declaring nothing contributes no --commutes argument')
  const ap = promptFor(calls, 'merge:wave1:apply1:1')
  assert(ap.indexOf(' --commutes t1=shared.py') !== -1,
    'commutes-args: the resolve command re-supplies the same declarations')
  assert(ap.indexOf('--commutes t2') === -1,
    'commutes-args: the resolve command omits the non-declaring task too')
  // Summed across every reply that carried one — the fold leg reported none.
  eq(r.frontier[0].autoResolved, 2,
     'commutes-args: autoResolved is summed across the fold and resolve replies')
  console.log('scenario 11b commutes-args-on-commands: OK')
}

// ── 11e: autoResolved is a SUM, not last-value-wins ─────────────────────────
// 11a/11b each carry the count on ONE leg, so `+=` → `=` in addWall stays green
// there. Here the fold leg reports 1 and the resolve leg 2: frontier must be 3.
async function scenarioAutoResolvedSumsAcrossLegs() {
  const calls = []
  const open = [openEntry(1, 'shared.py', 2)]
  const agent = makeAgent(calls, (label) => {
    if (label === 'merge:wave1:fold') return Object.assign(conflictFoldReply(open, []), { autoResolved: 1 })
    if (label === 'resolve:wave1:1:1') return { status: 'RESOLVED', notes: 'unioned' }
    if (label === 'merge:wave1:apply1:1') {
      return { status: 'FOLDED', complete: true, selfChecks: 'ok', autoResolved: 2,
               open: [], remaining: [] }
    }
    if (label === 'merge:wave1:adopt') return { status: 'MERGED', headSha: 'cand-sum' }
    return undefined
  })
  const r = await runWorkflow({ agent, args: argsFor(commutesWave()), budget: undefined })
  eq(r.waveMerges[0].headSha, 'cand-sum', 'sum: the wave adopted its folded candidate')
  eq(r.frontier[0].autoResolved, 3,
     'sum: autoResolved is 1 (fold) + 2 (resolve) = 3 — a last-value-wins accumulator reads 2')
  console.log('scenario 11e auto-resolved-sums-across-legs: OK')
}

// ── 11c: a composition-unpinned row for an undeclared multi-writer path ─────
async function scenarioCompositionUnpinnedRow() {
  const calls = []
  const agent = makeAgent(calls, (label) => {
    if (label === 'merge:wave1:fold') return cleanFoldReply()
    if (label === 'merge:wave1:adopt') return { status: 'MERGED', headSha: 'cand-u' }
    return undefined
  })
  const r = await runWorkflow({ agent, args: argsFor(commutesWave()), budget: undefined })

  const rows = r.judgmentCalls.filter((j) => j.startsWith('composition-unpinned:'))
  eq(rows.length, 1, 'composition: exactly one row for the one undeclared multi-writer path' +
     ' (got ' + JSON.stringify(r.judgmentCalls) + ')')
  eq(rows[0], 'composition-unpinned: wave 1 shared.py — writers t1,t2; undeclared: t2',
     'composition: the row names the wave, the path, every writer and the undeclared ones')
  assert(!r.judgmentCalls.some((j) => /composition rows skipped/.test(j)),
    'composition: a wave whose tasks all carry writes is never skipped')
  console.log('scenario 11c composition-unpinned-row: OK')
}

// ── 11d: writes absent → no composition rows, one note instead ───────────────
// The contendedWave() fixture predates the field, exactly like a launch file
// compiled before the Commutes compiler landed. Guessing rows off a missing
// field would fabricate them, so the wave is skipped and says so, once.
async function scenarioWritesAbsentSkipsCompositionRows() {
  const calls = []
  const agent = makeAgent(calls, (label) => {
    if (label === 'merge:wave1:fold') return cleanFoldReply()
    if (label === 'merge:wave1:adopt') return { status: 'MERGED', headSha: 'cand-w' }
    return undefined
  })
  const r = await runWorkflow({ agent, args: argsFor(contendedWave()), budget: undefined })

  assert(!r.judgmentCalls.some((j) => j.startsWith('composition-unpinned:')),
    'writes-absent: no composition row is fabricated from a missing writes field' +
    ' (got ' + JSON.stringify(r.judgmentCalls) + ')')
  const notes = r.judgmentCalls.filter((j) => /composition rows skipped/.test(j))
  eq(notes.length, 1, 'writes-absent: exactly one skip note for the wave' +
     ' (got ' + JSON.stringify(r.judgmentCalls) + ')')
  eq(notes[0], 'wave 1: tasks carry no writes field — composition rows skipped',
     'writes-absent: the note names the wave')
  console.log('scenario 11d writes-absent-skips-composition-rows: OK')
}

await scenarioCleanFold()
await scenarioConflictResolved()
await scenarioStaleFallback()
await scenarioParkFallback()
await scenarioBudgetExhaustedMidLoop()
await scenarioFoldDispatchThrows()
await scenarioCandidateSuiteFails()
await scenarioRoutingDisjointFiles()
await scenarioRoutingLoneSurvivor()
await scenarioRoutingResume()
await scenarioRoutingFrozenBase()
await scenarioGuardFoldReplyNull()
await scenarioGuardResolverReplyNull()
await scenarioGuardAdoptionReplyNull()
await scenarioGuardSelfChecksFailed()
await scenarioGuardParkedCountAuthority()
await scenarioGuardConflictsEmptyOpen()
await scenarioGuardOpenCountMismatch()
await scenarioGuardFoldedWithConflicts()
await scenarioGuardFoldedCountsOmitted()
await scenarioGuardFoldStatusError()
await scenarioGuardResolverStatusNotResolved()
await scenarioGuardResolveApplyReplyNull()
await scenarioGuardRejectedRetriedOnce()
await scenarioGuardApplyErrorFallsBackAtOnce()
await scenarioGuardConflictsCountsOmitted()
await scenarioGuardSelfChecksOmitted()
await scenarioGuardContinuedFoldCountsOmitted()
await scenarioGuardContinuedFoldOpenCountMismatch()
await scenarioGuardApplySelfChecksOmitted()
await scenarioWaitingShapeLegal()
await scenarioWaitingShapeMismatch()
await scenarioStopReplyNeedsNoSelfChecks()
await scenarioWorkListToComplete()
await scenarioParkedPreScan()
await scenarioBudgetExhaustedMidWorkList()
await scenarioAutoResolvedFoldCompletes()
await scenarioCommutesArgsOnCommands()
await scenarioCompositionUnpinnedRow()
// ── 11f–11i: composition rows — the four negative paths ─────────────────────
// (f) one writer per path → no row (delete the `ids.length < 2` guard: green today)
// (g) every writer declared → no row (delete the `undeclared.length` guard: green today)
// (h) mixed writes (one task carries `writes`, one does not) → ONE skip note, no row
// (i) partially-merged wave (a writer failed) → the failed writer is excluded, no row
async function scenarioCompositionSingleWriterNoRow() {
  const calls = []
  const agent = makeAgent(calls)
  const waves = [[
    { id: 't1', title: 'one', body: 'b', tier: 'cheap', files: ['a.py'], writes: ['a.py'], commutes: [] },
    { id: 't2', title: 'two', body: 'b', tier: 'cheap', files: ['b.py'], writes: ['b.py'], commutes: [] },
  ]]
  const r = await runWorkflow({ agent, args: argsFor(waves), budget: undefined })
  eq(r.waveMerges[0].status, 'MERGED', 'single-writer: the wave merged')
  assert(!r.judgmentCalls.some((j) => j.startsWith('composition-unpinned:')),
    'single-writer: a path with one writer is never a composition row' +
    ' (got ' + JSON.stringify(r.judgmentCalls) + ')')
  assert(!r.judgmentCalls.some((j) => /composition rows skipped/.test(j)),
    'single-writer: a wave whose tasks all carry writes is never skipped')
  console.log('scenario 11f composition-single-writer-no-row: OK')
}

async function scenarioCompositionAllDeclaredNoRow() {
  const calls = []
  const agent = makeAgent(calls, (label) => {
    if (label === 'merge:wave1:fold') return cleanFoldReply()
    if (label === 'merge:wave1:adopt') return { status: 'MERGED', headSha: 'cand-all' }
    return undefined
  })
  const waves = [[
    { id: 't1', title: 'one', body: 'b', tier: 'cheap', files: ['shared.py'], writes: ['shared.py'], commutes: ['shared.py'] },
    { id: 't2', title: 'two', body: 'b', tier: 'cheap', files: ['shared.py'], writes: ['shared.py'], commutes: ['shared.py'] },
  ]]
  const r = await runWorkflow({ agent, args: argsFor(waves), budget: undefined })
  eq(r.waveMerges[0].headSha, 'cand-all', 'all-declared: the contended wave adopted its candidate')
  assert(!r.judgmentCalls.some((j) => j.startsWith('composition-unpinned:')),
    'all-declared: every writer declared the path — no unpinned composition' +
    ' (got ' + JSON.stringify(r.judgmentCalls) + ')')
  console.log('scenario 11g composition-all-declared-no-row: OK')
}

async function scenarioCompositionMixedWritesSkipNote() {
  const calls = []
  const agent = makeAgent(calls, (label) => {
    if (label === 'merge:wave1:fold') return cleanFoldReply()
    if (label === 'merge:wave1:adopt') return { status: 'MERGED', headSha: 'cand-mixed' }
    return undefined
  })
  const waves = [[
    { id: 't1', title: 'one', body: 'b', tier: 'cheap', files: ['shared.py'], writes: ['shared.py'], commutes: [] },
    { id: 't2', title: 'two', body: 'b', tier: 'cheap', files: ['shared.py'] },   // no writes field
  ]]
  const r = await runWorkflow({ agent, args: argsFor(waves), budget: undefined })
  assert(!r.judgmentCalls.some((j) => j.startsWith('composition-unpinned:')),
    'mixed-writes: no row is guessed when any task lacks writes' +
    ' (got ' + JSON.stringify(r.judgmentCalls) + ')')
  const notes = r.judgmentCalls.filter((j) => /composition rows skipped/.test(j))
  eq(notes, ['wave 1: tasks carry no writes field — composition rows skipped'],
     'mixed-writes: exactly one skip note, naming the wave')
  console.log('scenario 11h composition-mixed-writes-skip-note: OK')
}

async function scenarioCompositionPartiallyMergedExcludesFailedWriter() {
  const calls = []
  const agent = makeAgent(calls, (label) => {
    if (label === 'impl:t2' || label === 'fix:t2') {
      return { status: 'BLOCKED', summary: 'cannot', branch: 'wt-t2', headSha: 'sha-t2' }
    }
    return undefined
  })
  // both tasks WRITE shared.py and neither declares it — but t2 never merges,
  // so the merged wave has one writer and no composition exists to pin.
  const waves = [[
    { id: 't1', title: 'one', body: 'b', tier: 'cheap', files: ['shared.py'], writes: ['shared.py'], commutes: [] },
    { id: 't2', title: 'two', body: 'b', tier: 'cheap', files: ['shared.py'], writes: ['shared.py'], commutes: [] },
  ]]
  const r = await runWorkflow({ agent, args: argsFor(waves), budget: undefined })
  eq(r.tasks.find((t) => t.task === 't2').status, 'failed', 'partial: t2 failed')
  eq(r.waveMerges[0].status, 'MERGED', 'partial: the wave merged t1 alone')
  assert(!has(calls, 'merge:wave1:fold'), 'partial: one mergeable task is not a contended wave')
  assert(!r.judgmentCalls.some((j) => j.startsWith('composition-unpinned:')),
    'partial: the failed writer is excluded from the row derivation' +
    ' (got ' + JSON.stringify(r.judgmentCalls) + ')')
  assert(!r.judgmentCalls.some((j) => /composition rows skipped/.test(j)),
    'partial: the merged task carries writes — never skipped')
  console.log('scenario 11i composition-partially-merged-excludes-failed-writer: OK')
}

await scenarioWritesAbsentSkipsCompositionRows()
await scenarioAutoResolvedSumsAcrossLegs()
await scenarioCompositionSingleWriterNoRow()
await scenarioCompositionAllDeclaredNoRow()
await scenarioCompositionMixedWritesSkipNote()
await scenarioCompositionPartiallyMergedExcludesFailedWriter()

console.log('ALL SCENARIOS PASSED')
