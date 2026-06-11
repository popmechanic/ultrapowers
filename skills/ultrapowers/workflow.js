// skills/ultrapowers/workflow.js
//
// COMMITTED Dynamic Workflow for ultrapowers. This file is NOT authored at
// runtime — it ships frozen and is launched by SKILL.md with args.waves.
//
// The Superpowers discipline (implementer / reviewer / completeness prompts,
// the safety GUARD, and the JSON schemas) is BAKED IN below as constants.
// Source of truth: references/reviewer-prompts.md (prompts + GUARD + schemas)
// and references/wave-merge.md (merge / setup / reconcile prompts). When the
// upstream discipline changes, re-bake per references/workflow-template.md;
// tests/test_no_prompt_drift.py fails if the baked copy diverges from source.
//
// Runtime globals provided by the workflow engine: agent(), parallel(),
// phase(), log(), args, budget. The script itself has no shell/filesystem
// access — only agent() calls do work.

export const meta = {
  name: 'ultrapowers',
  description: 'Execute an approved plan: parallel waves, worktree isolation, independent per-task review.',
  phases: [],
}

// ── args.waves validation (FAIL LOUD) ────────────────────────────────────────
// A silent undefined target is catastrophic (agents could mutate the session
// repo). We refuse to run rather than proceed on a missing/malformed plan.
// args may arrive as a parsed object OR, in some headless/-p launch paths, as a
// raw JSON string (confirmed live via tests/fixtures/args-probe.js: Object.keys
// returned character indices, i.e. a string). Normalize defensively so the
// primary args.waves path works regardless of delivery form.
let ARGS = (typeof args !== 'undefined') ? args : undefined
if (typeof ARGS === 'string') {
  try {
    ARGS = JSON.parse(ARGS)
  } catch (e) {
    throw new Error('ultrapowers: args was a string but not valid JSON: ' + e.message)
  }
}

const WAVES = (ARGS && typeof ARGS === 'object') ? ARGS.waves : undefined
const validWaves =
  Array.isArray(WAVES) && WAVES.length > 0 &&
  WAVES.every((w) =>
    Array.isArray(w) && w.length > 0 &&
    w.every((t) => t && typeof t.id === 'string' && typeof t.body === 'string'))
if (!validWaves) {
  throw new Error(
    'ultrapowers: args.waves missing or malformed. Expected Task[][] where each ' +
    'task = { id, title, body, tier, acceptance, files }. Refusing to run with an ' +
    'undefined plan. When this happens, the SKILL.md fallback ' +
    '(superpowers:subagent-driven-development) runs instead.'
  )
}

const stamp = (ARGS && ARGS.stamp) || 'run'
const integrationBranch =
  (ARGS && typeof ARGS.integrationBranch === 'string' && ARGS.integrationBranch) ||
  ('ultra/integration-' + stamp)
const dependencyEdges = (ARGS && ARGS.dependencyEdges) || []
// Structured dependency pairs [[fromTaskId, toTaskId], ...] — optional. When
// present, a failed task blocks its transitive dependents instead of letting
// them run against a base that never received the prerequisite.
const EDGES = (ARGS && Array.isArray(ARGS.edges))
  ? ARGS.edges.filter((e) => Array.isArray(e) && e.length === 2).map((e) => [String(e[0]), String(e[1])])
  : []

// ── Per-project knobs (all optional; defaults preserve prior behavior) ────────
// testCmd:        override the test-command detection ladder (e.g. 'make test').
// reviewProfile:  'lean' (default, one review pass) | 'adversarial' (two independent passes).
// tierOverrides:  remap model tiers per project, e.g. { cheap: 'sonnet' }.
const testCmd = (ARGS && typeof ARGS.testCmd === 'string' && ARGS.testCmd.trim()) || undefined
const reviewProfile = (ARGS && ARGS.reviewProfile === 'adversarial') ? 'adversarial' : 'lean'
const tierOverrides = (ARGS && ARGS.tierOverrides && typeof ARGS.tierOverrides === 'object') ? ARGS.tierOverrides : {}

// baseBranch: the repo's default branch, derived by the orchestrator (SKILL.md
// Step 2). Anchors the integration branch against a stale checkout left by a
// previous run.
const baseBranch = (ARGS && typeof ARGS.baseBranch === 'string' && ARGS.baseBranch.trim()) || undefined
// planPath: where the original plan lives on disk, so the completeness critic
// reviews against the actual plan (agents have fs access; this script does not).
const planPath = (ARGS && typeof ARGS.planPath === 'string' && ARGS.planPath.trim()) || undefined
// resume: the deterministic redirect path (SKILL.md Step 5). Setup checks out the
// EXISTING integration branch instead of creating one; the waves carry only the
// redirected tasks. Requires the branch to be named explicitly — never guessed.
const resume = !!(ARGS && ARGS.resume === true)
if (resume && !(ARGS && typeof ARGS.integrationBranch === 'string' && ARGS.integrationBranch)) {
  throw new Error('ultrapowers: resume requires an explicit args.integrationBranch — ' +
    'pass the integration branch of the run being redirected.')
}

// Fail loud on a typo'd model alias: an invalid model makes every agent error
// without doing any work (verified live 2026-06-03), so catch it before launch.
const VALID_MODELS = ['haiku', 'sonnet', 'opus']
for (const k of Object.keys(tierOverrides)) {
  if (k !== 'cheap' && k !== 'standard' && k !== 'mostCapable') {
    throw new Error('ultrapowers: tierOverrides key "' + k +
      '" is not a tier (valid: cheap, standard, mostCapable). Refusing to launch.')
  }
}
for (const k in tierOverrides) {
  if (VALID_MODELS.indexOf(tierOverrides[k]) === -1) {
    throw new Error(
      'ultrapowers: tierOverrides.' + k + ' = "' + tierOverrides[k] +
      '" is not a valid model alias (valid: haiku, sonnet, opus). Refusing to launch.'
    )
  }
}

// meta.phases must be { title } objects, one per wave (+ setup + review).
// Newer engines extract the meta literal at parse time and do NOT expose
// `meta` to the executing body (runtime mutation throws ReferenceError there);
// phase() calls group progress regardless, so the mutation is best-effort.
if (typeof meta !== 'undefined') {
  meta.phases = [{ title: 'Setup' }]
    .concat(WAVES.map((_, i) => ({ title: 'Wave ' + (i + 1) })))
    .concat([{ title: 'Integration Review' }])
}

// ── GUARD — baked from references/reviewer-prompts.md (BAKE:GUARD) ────────────
const GUARD =
  'SAFETY: Operate ONLY inside the git worktree assigned to you, or for the ' +
  'setup, merge, reconcile, and integration roles the session repository main ' +
  'checkout. Before any git command, confirm the target directory exists and is ' +
  'a git repository. If a path is missing, empty, the literal string undefined, ' +
  'or not a git repo, STOP immediately and report BLOCKED. NEVER run git or ' +
  'write files in an unrelated repository, and NEVER fall back to your current ' +
  'working directory.'

// ── Baked discipline prompts (source: references/reviewer-prompts.md) ─────────
// BAKE:IMPLEMENTER_PROMPT
const IMPLEMENTER_PROMPT = [
  'You are an implementer subagent operating inside a dedicated git worktree. You have no access to the Skill tool.',
  '',
  'Inputs you receive:',
  '- TASK: the full, verbatim task text — do not paraphrase or reinterpret it',
  '- WORKTREE_PATH: absolute path to your isolated worktree',
  '- BRANCH: the branch you must work on (already checked out for you)',
  '- BASE: sha of the integration-branch HEAD your work builds on',
  '',
  'Workflow — red green refactor:',
  "1. Anchor to BASE first: run git rev-parse HEAD; if it differs from BASE, run git reset --hard <BASE> before anything else — engine worktrees are sometimes cut from a stale ref, and building on the wrong parent reintroduces other tasks' changes and forces merge conflicts.",
  '2. Read and restate the acceptance criteria from the task text before touching code.',
  '3. Write or update tests that encode those criteria. Confirm they fail (pnpm check or equivalent).',
  '4. Implement the minimum code to make them pass.',
  '5. Refactor for clarity without breaking tests.',
  '6. Run the full check suite one final time and confirm it is clean.',
  '7. Commit your work on your branch. The merge step integrates committed work only — git rev-parse HEAD must point at a commit that contains your final state; uncommitted or unstaged changes never reach the integration branch.',
  '',
  'Self-verify before reporting:',
  '- Re-read the task. Confirm every stated requirement is addressed.',
  '- Run git diff BASE...HEAD (BASE is provided in your inputs) and verify no unrelated files are modified.',
  '- Confirm no secrets, no commented-out debug code, no TODOs introduced.',
  '',
  'Report your worktree coordinates: include git branch --show-current and git rev-parse HEAD in your response so the merge step can map task branch commit.',
  '',
  'Return a single JSON object conforming to the implementer status schema below. No prose outside the JSON block.',
].join('\n')

// BAKE:REVIEWER_PROMPT
// One independent pass merging spec-compliance + code-quality — a deliberate
// divergence from superpowers 5.1.0's two-ordered-pass mandate (see
// references/reviewer-prompts.md, "Deliberate divergence"). Always runs at most-capable.
const REVIEWER_PROMPT = [
  'You are an independent reviewer. You receive the original task text and the implementer diff. You have no access to the Skill tool and must not consult the implementer report when forming your verdict.',
  '',
  'Mandate: verify everything independently. Do not trust the implementer report.',
  '',
  'Spec compliance:',
  '1. Check out the implementer HEAD sha as a DETACHED checkout (git checkout --detach <HEAD>) — the implementer branch itself is locked by its worktree, so do not check the branch out. Run git diff BASE...HEAD yourself.',
  '2. Map every acceptance criterion in the task to a concrete line or test in the diff. Flag any criterion with no corresponding evidence as a blocking issue.',
  '3. Flag anything in the diff that is NOT required by the task (scope creep, unrelated refactors, leftover debug code).',
  '',
  'Code quality:',
  '4. Separation of concerns: each module or function has one clear responsibility; UI, logic, and data layers are not entangled.',
  '5. Error handling: all async paths have explicit error paths; no silent catch blocks; user-visible errors are meaningful.',
  '6. DRY: no copy-pasted logic that could be extracted; shared utilities are used rather than reimplemented.',
  '7. Test quality: tests assert observable behavior, not implementation details; no tests that trivially pass without exercising real logic.',
  '',
  '8. Run the full check suite and confirm it passes.',
  '',
  'Flag only issues worth fixing. Minor style nits that a linter would catch automatically are not worth flagging. Severity blocking means the task must not merge until fixed; minor is advisory.',
  '',
  'Return a single JSON object conforming to the reviewer verdict schema. No prose outside the JSON block.',
].join('\n')

// Setup / merge / reconcile / completeness prompts (source: references/wave-merge.md)
// testInstruction: honor an explicit args.testCmd, else fall back to detection.
const testInstruction = testCmd
  ? ('run the project test command `' + testCmd + '`')
  : ('detect and run the project test command (pnpm check, npm test, pytest, cargo test, or go test ./...)')

const SETUP_PROMPT = resume
  ? ('You are the setup agent on the session repo main checkout. Check out the EXISTING ' +
     'integration branch ' + integrationBranch + ' — it must already exist; report BLOCKED ' +
     'if it does not, and do not create a new branch. Then ' +
     'establish the test baseline: ' + testInstruction + ' and record whether it passes. ' +
     'Report the branch name, its HEAD sha, and the baseline result in your JSON result.')
  : ('You are the setup agent on the session repo main checkout. ' +
     (baseBranch ? ('Check out the base branch ' + baseBranch + ' first. ') : '') +
     'Create the integration branch: git checkout -b ' + integrationBranch + '. Then ' +
     'establish the test baseline: ' + testInstruction + ' and record whether it passes. ' +
     'Report the branch name, its HEAD sha, and the baseline result in your JSON result.')

const MERGE_PROMPT =
  'You are the wave merge agent, operating on the session repo main checkout (no ' +
  'worktree). Check out ' + integrationBranch + '. Merge each reported branch in ' +
  'the given task-index order (deterministic, so conflicts are reproducible). ' +
  'After all merges succeed, ' + testInstruction + '. Report MERGED with the final ' +
  'HEAD sha, or CONFLICT / TEST_FAILED with the conflict diff or failing output.' +
  ' After ALL branches in your list are merged and the test suite passes, clean up' +
  ' the merged branches only: use git worktree list to find each merged branch\'s' +
  ' worktree, git worktree remove it, then git branch -d the branch. Leave any' +
  ' branch you did NOT merge — and its worktree — untouched; failed and blocked' +
  ' work must stay inspectable.'

const RECONCILE_PROMPT =
  'You are the reconciliation agent on ' + integrationBranch + '. You are given a ' +
  'merge conflict diff or failing test output. Resolve it on the integration ' +
  'branch, then ' + testInstruction + '. Report MERGED on success, or ' +
  'CONFLICT / TEST_FAILED with detail if you cannot resolve it.'

const COMPLETENESS_PROMPT =
  (planPath ? ('Read the original plan document at ' + planPath + ' first. ') : '') +
  'What plan requirement is unmet? What claim is unverified? What code path is ' +
  'untested? On ' + integrationBranch + ' from the main checkout, ' + testInstruction +
  ', then review the integrated result against the original plan. List every ' +
  'gap, unverified claim, and untested path.'

// ── Baked schemas (source: references/reviewer-prompts.md) ────────────────────
const IMPLEMENTER_SCHEMA = {
  type: 'object',
  required: ['status', 'summary', 'branch', 'headSha'],
  properties: {
    status: { enum: ['DONE', 'DONE_WITH_CONCERNS', 'NEEDS_CONTEXT', 'BLOCKED'] },
    summary: { type: 'string' },
    concerns: { type: 'array', items: { type: 'string' } },
    branch: { type: 'string' },
    headSha: { type: 'string' },
    commit: { type: 'string' },
  },
}
const REVIEWER_SCHEMA = {
  type: 'object',
  required: ['verdict', 'issues'],
  properties: {
    verdict: { enum: ['PASS', 'FIX_REQUIRED'] },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        required: ['severity', 'detail'],
        properties: {
          severity: { enum: ['blocking', 'minor'] },
          detail: { type: 'string' },
        },
      },
    },
  },
}
const MERGE_SCHEMA = {
  type: 'object',
  required: ['status'],
  properties: {
    status: { enum: ['MERGED', 'CONFLICT', 'TEST_FAILED'] },
    headSha: { type: 'string' },
    detail: { type: 'string' },
    command: { type: 'string' },
  },
}
const SETUP_SCHEMA = {
  type: 'object',
  required: ['branch', 'headSha'],
  properties: {
    branch: { type: 'string' },
    headSha: { type: 'string' },
    baselinePassed: { type: 'boolean' },
    baselineOutput: { type: 'string' },
  },
}
const REVIEW_SCHEMA = {
  type: 'object',
  required: ['testsPassed'],
  properties: {
    command: { type: 'string' },
    testsPassed: { type: 'boolean' },
    output: { type: 'string' },
    findings: { type: 'array', items: { type: 'string' } },
  },
}

// Model tiers. reviewer-prompts.md names them cheap / standard / most-capable;
// the workflow agent() API takes Claude aliases haiku / sonnet / opus. Verified
// live (2026-06-03): small/medium/large are rejected as invalid models, so the
// agent returns an error instead of doing the work. Map in ONE place here.
const DEFAULT_TIER = { cheap: 'haiku', standard: 'sonnet', mostCapable: 'opus' }
const TIER = Object.assign({}, DEFAULT_TIER, tierOverrides)
// Plans may name the top tier 'most-capable' (dependency-analysis) or 'mostCapable'
// (this map); normalize so both resolve. Unknown tiers fall back to standard.
const tierKey = (t) => (t === 'most-capable' ? 'mostCapable' : t)
// Review / completeness roles always run at the strongest model, OVERRIDE-PROOF:
// tierOverrides remap implementer tiers only — a weak reviewer's failure mode is
// the silent false PASS, so it must never be downgradable. (Reconcile is a fixer,
// not a reviewer, so it tracks the implementer-side mostCapable.)
const REVIEWER_MODEL = DEFAULT_TIER.mostCapable

// Returns true for a task result whose worktree branch is ready to merge.
const isMergeable = (r) => r && r.status === 'done' && r.branch

// Threaded into implementer/reviewer dispatches so task agents run the project's
// actual test command instead of guessing ("pnpm check or equivalent").
const testCmdLine = testCmd ? ('\nTEST COMMAND: ' + testCmd) : ''

// Review depth per task: an explicit task.review ('adversarial' | 'lean') — set by
// the orchestrating agent from the plan's per-task risk/tier — overrides the
// run-wide reviewProfile default. Spend the extra adversarial pass only where asked.
const taskReviewProfile = (task) =>
  (task.review === 'adversarial' || task.review === 'lean') ? task.review : reviewProfile

// ── Per-task pipeline: implement → review → bounded fix-loop ──────────────────
// A thrown agent() call (engine fault, schema failure, transient error) must
// cost ONE task, never the run: parallel() is fail-fast, so an uncaught throw
// in a 16-wide wave would reject the whole wave and lose the report.
async function runTask(task, baseSha) {
  try {
    return await runTaskInner(task, baseSha)
  } catch (e) {
    const msg = String((e && e.message) || e)
    judgmentCalls.push('task ' + task.id + ': agent error — ' + msg)
    log('task ' + task.id + ' FAILED on agent error: ' + msg)
    return { task: task.id, status: 'failed', reviewVerdict: 'agent-error',
             notes: msg, tier: TIER[tierKey(task.tier)] || TIER.standard,
             review: taskReviewProfile(task), fixIterations: 0 }
  }
}
async function runTaskInner(task, baseSha) {
  const baseModel = TIER[tierKey(task.tier)] || TIER.standard
  // Run economics, reported per task so the pre-merge gate can judge cost vs. benefit.
  const economics = { tier: baseModel, review: taskReviewProfile(task) }
  // DONE_WITH_CONCERNS concerns must reach the report — never swallowed.
  const concerns = []
  const noteConcerns = (res) => {
    if (res && res.status === 'DONE_WITH_CONCERNS' && Array.isArray(res.concerns)) {
      for (const c of res.concerns) {
        concerns.push(c)
        judgmentCalls.push('task ' + task.id + ': ' + c)
      }
    }
  }
  // Surface a typo'd review depth rather than silently downgrading it.
  if (task.review && task.review !== 'adversarial' && task.review !== 'lean') {
    log('task ' + task.id + ': unknown review="' + task.review +
        '", falling back to run default (' + reviewProfile + ')')
  }

  let impl = await agent(
    GUARD + '\n\n' + IMPLEMENTER_PROMPT + '\n\nBASE: ' + baseSha + testCmdLine + '\nTASK:\n' + task.body,
    { label: 'impl:' + task.id, isolation: 'worktree', model: baseModel, schema: IMPLEMENTER_SCHEMA }
  )
  noteConcerns(impl)
  if (impl.status === 'BLOCKED' || impl.status === 'NEEDS_CONTEXT') {
    return { task: task.id, status: 'failed', branch: impl.branch,
             reviewVerdict: 'not-reviewed', notes: impl.summary,
             tier: economics.tier, review: economics.review, fixIterations: 0 }
  }

  // Fix-loop: cap 2 iterations total (initial + 1). One independent review pass
  // per iteration (spec-compliance + code-quality merged). See reviewer-prompts.md.
  for (let iter = 1; iter <= 2; iter++) {
    const reviewPrompt =
      GUARD + '\n\n' + REVIEWER_PROMPT +
      '\n\nTASK:\n' + task.body + '\nBRANCH: ' + impl.branch + '\nHEAD: ' + impl.headSha +
      '\nBASE: ' + baseSha + testCmdLine
    const reviewOpts = (pass) => ({
      label: 'review:' + task.id + ':' + iter + (pass ? ':' + pass : ''),
      isolation: 'worktree', model: REVIEWER_MODEL, schema: REVIEWER_SCHEMA,
    })
    // 'adversarial' runs two independent reviewers over the same diff and unions
    // their findings; 'lean' (default) runs one. Per-task, falling back to the run default.
    // NOTE: the two adversarial reviews run SEQUENTIALLY on purpose — each task
    // pipeline must stay single-agent so peak concurrency equals wave width and the
    // 16-agent chunking below holds. Do NOT parallelize them, or a wide adversarial
    // wave can exceed the engine's concurrency cap.
    let issues, verdicts
    if (taskReviewProfile(task) === 'adversarial') {
      const r1 = await agent(reviewPrompt, reviewOpts(1))
      const r2 = await agent(reviewPrompt, reviewOpts(2))
      issues = (r1.issues || []).concat(r2.issues || [])
      verdicts = [r1.verdict, r2.verdict]
    } else {
      const review = await agent(reviewPrompt, reviewOpts())
      issues = review.issues || []
      verdicts = [review.verdict]
    }
    // Dedupe identical findings — adversarial reviewers often agree verbatim,
    // and a doubled issue doubles the noise in the fix prompt and the report.
    const seenIssue = {}
    issues = issues.filter((i) => {
      const key = (i.severity || '') + '|' + (i.detail || '')
      if (seenIssue[key]) return false
      seenIssue[key] = true
      return true
    })
    const blocking = issues.filter((i) => i.severity === 'blocking')
    const minors = issues.filter((i) => i.severity === 'minor')

    if (blocking.length === 0) {
      // Severity decides the merge; a FIX_REQUIRED verdict with no blocking issues
      // is a reviewer inconsistency worth surfacing, not silently merging past.
      if (verdicts.indexOf('FIX_REQUIRED') !== -1) {
        log('task ' + task.id + ': reviewer verdict FIX_REQUIRED but no blocking issues; merging on severity')
        judgmentCalls.push('task ' + task.id +
          ': reviewer said FIX_REQUIRED with no blocking issues — merged on the severity rule')
      }
      return { task: task.id, status: 'done', branch: impl.branch, commit: impl.commit,
               headSha: impl.headSha, reviewVerdict: iter === 1 ? 'clean' : 'fixed',
               notes: minors.map((m) => m.detail)
                 .concat(concerns.map((c) => 'concern: ' + c)).join('; '),
               tier: economics.tier, review: economics.review, fixIterations: iter - 1 }
    }
    if (iter === 2) {
      log('task ' + task.id + ' FAILED: fix-loop cap (2) reached with blocking issues remaining')
      return { task: task.id, status: 'failed', branch: impl.branch,
               reviewVerdict: 'fix-loop-exhausted', notes: blocking.map((b) => b.detail).join('; '),
               tier: economics.tier, review: economics.review, fixIterations: 1 }
    }
    // Re-dispatch implementer on the same branch, escalated to most-capable.
    impl = await agent(
      GUARD + '\n\n' + IMPLEMENTER_PROMPT + '\n\nBASE: ' + baseSha + testCmdLine + '\nTASK:\n' + task.body +
        '\n\nFIX REQUIRED — resolve these blocking issues on the same branch (' +
        impl.branch + '):\n' + blocking.map((b) => '- ' + b.detail).join('\n'),
      { label: 'fix:' + task.id + ':' + iter, isolation: 'worktree', model: TIER.mostCapable, schema: IMPLEMENTER_SCHEMA }
    )
    noteConcerns(impl)
    if (impl.status === 'BLOCKED' || impl.status === 'NEEDS_CONTEXT') {
      return { task: task.id, status: 'failed', branch: impl.branch,
               reviewVerdict: 'blocked-after-fix', notes: impl.summary,
               tier: economics.tier, review: economics.review, fixIterations: 1 }
    }
  }
}

// ── Wave merge (NON-isolated; reconciliation cap 2) ──────────────────────────
async function mergeWave(results, waveIdx) {
  const merged = results.filter(isMergeable)
  if (merged.length === 0) return { status: 'TEST_FAILED', detail: 'no branches to merge' }
  const branchList = merged
    .map((r, i) => i + '. task=' + r.task + ' branch=' + r.branch + ' sha=' + (r.headSha || ''))
    .join('\n')
  let merge
  try {
    merge = await agent(
      GUARD + '\n\n' + MERGE_PROMPT + '\nMerge in this order:\n' + branchList,
      { label: 'merge:wave' + (waveIdx + 1), model: TIER.cheap, schema: MERGE_SCHEMA }
    )
  } catch (e) {
    merge = { status: 'CONFLICT', detail: 'merge agent error: ' + String((e && e.message) || e) }
  }
  for (let attempt = 1; merge.status !== 'MERGED' && attempt <= 2; attempt++) {
    log('wave ' + (waveIdx + 1) + ' reconciliation attempt ' + attempt + ': ' + merge.status)
    try {
      merge = await agent(
        GUARD + '\n\n' + RECONCILE_PROMPT + '\nFailure:\n' + (merge.detail || ''),
        { label: 'reconcile:wave' + (waveIdx + 1) + ':' + attempt, model: TIER.mostCapable, schema: MERGE_SCHEMA }
      )
    } catch (e) {
      merge = { status: 'CONFLICT', detail: 'reconcile agent error: ' + String((e && e.message) || e) }
    }
  }
  return merge
}

// ── Main: setup → wave loop (parallel barrier, chunked at 16) → review ────────
const taskResults = []
const blockedWaves = []
const waveMerges = []
const judgmentCalls = []
const unfinished = []

phase('Setup')
const setup = await agent(GUARD + '\n\n' + SETUP_PROMPT, { label: 'setup', model: TIER.cheap, schema: SETUP_SCHEMA })
// SKILL.md promises an abort when the integration branch cannot be created.
if (!setup || setup.branch !== integrationBranch || !setup.headSha) {
  throw new Error(
    'ultrapowers: setup failed to ' + (resume ? 'check out existing' : 'create') +
    ' integration branch ' + integrationBranch +
    ' (got ' + JSON.stringify(setup) + '). Aborting before any task runs.'
  )
}
const baseline = { passed: setup.baselinePassed, output: setup.baselineOutput }
if (setup.baselinePassed === false) {
  judgmentCalls.push(
    'baseline: test suite was already failing before any task ran (' +
    (setup.baselineOutput || 'no output') + ') — task results inherit a red suite'
  )
  log('setup: baseline tests FAILED before any work began')
}

const CONCURRENCY = 16 // engine cap: up to 16 concurrent agents per run

const budgetExhausted = () => {
  if (typeof budget === 'undefined' || !budget) return false
  const r = (typeof budget.remaining === 'function') ? budget.remaining() : budget.remaining
  return typeof r === 'number' && r <= 0
}

// Tasks transitively downstream of a failure — never dispatched, always reported.
const blockedByDep = new Set()
const noteFailures = () => {
  const failed = new Set(taskResults.filter((r) => r && r.status === 'failed').map((r) => r.task))
  let grew = true
  while (grew) {
    grew = false
    for (const [a, b] of EDGES) {
      if ((failed.has(a) || blockedByDep.has(a)) && !blockedByDep.has(b) && !failed.has(b)) {
        blockedByDep.add(b)
        grew = true
      }
    }
  }
}

// Review diff base: the integration-branch HEAD a wave's worktrees build on.
// Wave 1 starts at the setup HEAD; each successful merge advances it.
let waveBaseSha = setup.headSha

for (let w = 0; w < WAVES.length; w++) {
  // Peak concurrency equals wave width (each task pipeline is internally
  // sequential), so chunk waves wider than the engine cap.
  if (budgetExhausted()) {
    WAVES[w].forEach((t) => unfinished.push(t.id + ': deferred (budget exhausted)'))
    continue
  }
  phase('Wave ' + (w + 1))
  noteFailures()
  const results = []
  for (let off = 0; off < WAVES[w].length; off += CONCURRENCY) {
    const chunk = WAVES[w].slice(off, off + CONCURRENCY)
    if (budgetExhausted()) {
      chunk.forEach((t) => unfinished.push(t.id + ': deferred (budget exhausted mid-wave)'))
      continue
    }
    const runnable = chunk.filter((t) => {
      if (blockedByDep.has(t.id)) {
        unfinished.push(t.id + ': blocked — depends on a failed task')
        log('task ' + t.id + ' skipped: upstream dependency failed')
        return false
      }
      return true
    })
    if (runnable.length === 0) continue
    const chunkResults = await parallel(runnable.map((task) => () => runTask(task, waveBaseSha)))
    for (const r of chunkResults) results.push(r)
  }
  for (const r of results) taskResults.push(r)
  noteFailures()

  const merge = await mergeWave(results, w)
  // Record every wave's merge outcome (success too) so the pre-merge gate can see
  // how integration actually went — not just failures. This is the report's record
  // of the merge sequence; on success merge.headSha is the integration HEAD.
  waveMerges.push({
    wave: w + 1,
    status: merge.status,
    headSha: merge.headSha,
    command: merge.command,
    detail: merge.detail,
    // Task branches submitted to the merge agent — accurate whether or not the
    // merge succeeded (do not imply success: a CONFLICT wave still lists them).
    branches: results.filter(isMergeable).map((r) => r.task),
  })
  if (merge.status === 'MERGED' && !merge.headSha) {
    judgmentCalls.push('wave ' + (w + 1) + ': merge reported MERGED without headSha — ' +
      'review base stays at ' + String(waveBaseSha).slice(0, 12) +
      '; later reviewers may see this wave\'s changes as task scope')
    log('wave ' + (w + 1) + ': MERGED without headSha; review base frozen')
  }
  if (merge.status === 'MERGED' && merge.headSha) waveBaseSha = merge.headSha
  if (merge.status !== 'MERGED') {
    blockedWaves.push({ wave: w + 1, detail: merge.detail || merge.status })
    log('wave ' + (w + 1) + ' BLOCKED: ' + (merge.detail || merge.status))
    // Later waves depend on earlier ones by construction: cascade-block them.
    for (let d = w + 1; d < WAVES.length; d++) {
      WAVES[d].forEach((t) => unfinished.push(t.id + ': cascade-blocked by wave ' + (w + 1)))
    }
    break
  }
}

// ── Integration + completeness review ────────────────────────────────────────
phase('Integration Review')
const taskList = WAVES.flat().map((t) => t.id + ': ' + (t.title || '')).join('\n')
let review
try {
  review = await agent(
    GUARD + '\n\n' + COMPLETENESS_PROMPT +
      '\n\nTasks:\n' + taskList + '\nBlocked waves:\n' + JSON.stringify(blockedWaves) +
      // A red baseline reframes the critic's own test run: failures it sees may be
      // inherited, not introduced. Only thread it when it actually failed.
      (baseline.passed === false
        ? '\nBaseline: the test suite FAILED before any task ran — ' + (baseline.output || 'no output')
        : ''),
    { label: 'integration', model: REVIEWER_MODEL, schema: REVIEW_SCHEMA }
  )
} catch (e) {
  const msg = String((e && e.message) || e)
  judgmentCalls.push('integration review failed to run: ' + msg)
  review = { testsPassed: false, output: 'integration agent error: ' + msg,
             findings: ['integration review did not run — verify the suite manually before merging'] }
}

// ── Structured return value (matches references/report-format.md) ─────────────
return {
  integrationBranch,
  waves: WAVES.map((w) => w.map((t) => t.id)),
  dependencyEdges,
  tasks: taskResults,
  tests: { command: review.command, passed: review.testsPassed, output: review.output },
  baseline,
  waveMerges,
  judgmentCalls,
  unfinished,
  completenessFindings: review.findings || [],
  blockedWaves,
}
