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
  // 'ultrapowers-run', NOT 'ultrapowers': the engine auto-registers a saved
  // workflow as a /<meta.name> slash command, and meta.name 'ultrapowers' would
  // shadow the ultrapowers:ultrapowers SKILL (the documented /ultrapowers entry
  // point), feeding a bare plan path straight into this engine (#collision,
  // docs/bugs/2026-06-15-ultrapowers-command-collision.md). The probe follows
  // the same convention ('ultrapowers-probe'). SKILL.md launches by this name.
  name: 'ultrapowers-run',
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
  // Compiled launch args serialize to a JSON object/array, so a string always
  // begins with '{' or '['. Anything else (a bare plan path like
  // 'docs/plans/feature.md') means this engine workflow was launched DIRECTLY
  // instead of through the ultrapowers:ultrapowers SKILL, which is the only
  // thing that compiles a plan path into args.waves (via compile_plan.py). Emit
  // a redirect rather than the cryptic 'Unexpected identifier' parse error.
  const looksLikeJson = /^\s*[\[{]/.test(ARGS)
  try {
    ARGS = JSON.parse(ARGS)
  } catch (e) {
    if (!looksLikeJson) {
      throw new Error(
        'ultrapowers: launched with a raw string ("' + ARGS.slice(0, 80) + '"), not compiled ' +
        'launch args. This is the engine workflow — do NOT launch it directly with a plan path. ' +
        'Run the /ultrapowers skill (ultrapowers:ultrapowers) on the plan; it compiles the plan ' +
        'into args.waves (via compile_plan.py) and launches this workflow for you.')
    }
    throw new Error('ultrapowers: args was a string but not valid JSON: ' + e.message)
  }
}

const WAVES = (ARGS && typeof ARGS === 'object') ? ARGS.waves : undefined
// wavesPath: absolute path to a launch-ready waves file the compiler wrote
// (compile_plan.py --emit-launch). It carries the FULL verbatim task bodies so
// a large plan (tens of KB of bodies) need not ride inline in the Workflow call
// — an LLM orchestrator cannot reliably emit that as one escaped JSON value.
// When supplied, each task's inline `body` may be OMITTED: the implementer and
// reviewer read their own verbatim body from this file BY ABSOLUTE PATH (the
// same fs-read mechanism planPath already uses), so no model ever transcribes
// the bodies. The light inline args.waves still carries id/title/files/tier/review.
const wavesPath = (ARGS && typeof ARGS.wavesPath === 'string' && ARGS.wavesPath.trim()) || undefined
const validWaves =
  Array.isArray(WAVES) && WAVES.length > 0 &&
  WAVES.every((w) =>
    Array.isArray(w) && w.length > 0 &&
    // id is always required; a NON-EMPTY inline body satisfies delivery, else
    // wavesPath must supply it from disk. An empty/whitespace body with no
    // wavesPath is rejected here rather than producing a "file at undefined"
    // prompt downstream.
    w.every((t) => t && typeof t.id === 'string' &&
      ((typeof t.body === 'string' && t.body.trim() !== '') || Boolean(wavesPath))))
if (!validWaves) {
  throw new Error(
    'ultrapowers: args.waves missing or malformed. Expected Task[][] where each ' +
    'task = { id, body, ... } (id is always validated; body is validated unless ' +
    'args.wavesPath is supplied, in which case each agent reads its body from that ' +
    'file by id; title/tier/review/testCmd are consumed by prompts; acceptance is ' +
    'advisory; files feeds the FILES prompt line). Refusing to run with an ' +
    'undefined plan. When this happens, the SKILL.md fallback ' +
    '(superpowers:subagent-driven-development) runs instead.'
  )
}

// Duplicate ids would corrupt blockedByDep and report keying (tasks[],
// waveMerges.branches). compile_plan.py hard-errors on duplicates at the plan
// level; hand-authored waves must meet the same bar — refuse to run.
{
  const seenIds = new Set()
  for (const w of WAVES) for (const t of w) {
    if (seenIds.has(t.id)) {
      throw new Error('ultrapowers: duplicate task id "' + t.id + '" across waves — task ids ' +
        'must be unique (compile_plan.py enforces this at the plan level; hand-authored ' +
        'waves must too). Refusing to run.')
    }
    seenIds.add(t.id)
  }
}

const stamp = (ARGS && ARGS.stamp) || 'run'
const integrationBranch =
  (ARGS && typeof ARGS.integrationBranch === 'string' && ARGS.integrationBranch) ||
  ('ultra/integration-' + stamp)
// dependencyEdges: human-readable edge strings, echoed into the report ONLY.
// Dependency BLOCKING is driven by args.edges below — passing dependencyEdges
// alone does not block anything.
const dependencyEdges = (ARGS && ARGS.dependencyEdges) || []
// args.edges: structured dependency pairs [[fromTaskId, toTaskId], ...] —
// optional. When present, a failed task blocks its transitive dependents
// instead of letting them run against a base that never received the
// prerequisite.
// edgesSupplied: true iff the caller explicitly passed args.edges (even if []).
// A compiler-generated plan with no dependencies legitimately yields edges: [].
// The conservative-cascade branch must distinguish "edges omitted" (unsafe to
// skip cascade) from "edges: [] supplied" (compiler proved independence — safe).
const edgesSupplied = !!(ARGS && Array.isArray(ARGS.edges))
const EDGES = edgesSupplied
  ? ARGS.edges.map((e, i) => {
      if (!Array.isArray(e) || e.length !== 2) {
        throw new Error(
          'ultrapowers: args.edges[' + i + '] is not a [fromTaskId, toTaskId] pair. ' +
          'Convert compiler dag_edges objects to pairs (e.g. [e.from, e.to]) before launch. ' +
          'Refusing to run with dependency blocking silently disabled.')
      }
      return [String(e[0]), String(e[1])]
    })
  : []

// ── Per-project knobs (all optional; defaults preserve prior behavior) ────────
// testCmd:        override the test-command detection ladder (e.g. 'make test').
// reviewProfile:  'lean' (default, one review pass) | 'adversarial' (two independent passes).
// tierOverrides:  remap model tiers per project, e.g. { cheap: 'sonnet' }.
const testCmd = (ARGS && typeof ARGS.testCmd === 'string' && ARGS.testCmd.trim()) || undefined
// bootstrapCmd: a per-worktree setup command (e.g. install deps) the FRESH,
// worktree-isolated roles (implementer, reviewer, fix) run before testing.
// Engine worktrees are cut clean from the integration HEAD: they have no .venv,
// no node_modules. A polyglot/monorepo repo (e.g. pytest at root + `bun test` in
// app/) needs its stacks installed in each worktree before the suite can run.
// The non-isolated roles (setup/merge/reconcile/completeness) operate on the
// session main checkout, which already has its deps, so they do not run it.
const bootstrapCmd = (ARGS && typeof ARGS.bootstrapCmd === 'string' && ARGS.bootstrapCmd.trim()) || undefined
// acceptance: disposition carried into the report (spec 2026-06-14-sealed-acceptance-gate-fix).
//   { mode: 'sealed', sealId, sha256 }  — recorded as PENDING_GATE; the SEALED exam is
//     administered deterministically at the pre-merge gate (SKILL.md Step 5), NOT here:
//     the workflow has no shell, and relaying the runner's JSON corrupts it (#36).
//   { mode: 'waived', reason }  — static, passed: null.
//   { mode: 'suite', reason }   — passed mirrors the committed-suite result.
//   Absent → report.acceptance = null.
const ACCEPTANCE = (ARGS && ARGS.acceptance && typeof ARGS.acceptance === 'object')
  ? ARGS.acceptance : null
const reviewProfile = (ARGS && ARGS.reviewProfile === 'adversarial') ? 'adversarial' : 'lean'
const tierOverrides = (ARGS && ARGS.tierOverrides && typeof ARGS.tierOverrides === 'object') ? ARGS.tierOverrides : {}

// baseBranch: the repo's default branch, derived by the orchestrator (SKILL.md
// Step 2). Anchors the integration branch against a stale checkout left by a
// previous run.
const baseBranch = (ARGS && typeof ARGS.baseBranch === 'string' && ARGS.baseBranch.trim()) || undefined
// planPath: where the original plan lives on disk, so the completeness critic
// reviews against the actual plan (agents have fs access; this script does not).
const planPath = (ARGS && typeof ARGS.planPath === 'string' && ARGS.planPath.trim()) || undefined
// globalConstraints: the plan's project-wide requirements the compiler captured
// from the plan header, '' when the plan had no `## Global Constraints` section.
// Forwarded verbatim into the implementer (binding requirements) and reviewer
// (attention lens) dispatches. (#1.4)
const globalConstraints =
  (ARGS && typeof ARGS.globalConstraints === 'string' && ARGS.globalConstraints.trim()) || ''
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
  'setup, merge, and reconcile roles the session repository main checkout, ' +
  'which those write-side roles may modify. Review roles (the per-task reviewer ' +
  'and the completeness critic) are READ-ONLY: they operate on a detached ' +
  'checkout and never write files, create commits, stage changes, or otherwise ' +
  'mutate any tree — their only output is their report payload. You operate in ' +
  "the workflow's launch working directory, the session repository; never " +
  'resolve to, check out, or detach a DIFFERENT primary checkout of the same ' +
  "repository — moving the user's primary checkout off its branch is a " +
  'forbidden, undisclosed side effect. Before any git command, confirm the ' +
  'target directory exists and is a git repository. If a path is missing, ' +
  'empty, the literal string undefined, ambiguous, or not a git repo, STOP ' +
  'immediately and report BLOCKED. NEVER run git or write files in an unrelated ' +
  'repository, and NEVER fall back to your current working directory.'

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
  '- FILES: the task\'s declared file scope — the Create/Modify/Test paths the plan assigns to this task (may be absent)',
  '- SIBLING FILES: files owned by tasks running in parallel with yours (may be absent). They do NOT exist at BASE and are not yours: never create, duplicate, modify, or delete a sibling-owned path. If your task cannot be implemented or tested without one, report BLOCKED naming the file — that is a missing dependency edge in the plan, not yours to work around.',
  '- GLOBAL CONSTRAINTS: project-wide requirements (version floors, naming/copy rules, platform reqs) that bind every task (may be absent). Treat them as additional acceptance criteria your work must satisfy.',
  '- INTERFACES - the exact neighboring signatures your task consumes and the contract it produces (may be absent). Consumes names symbols earlier tasks expose that you may call; Produces is the contract later tasks rely on — match those names and types exactly, since the implementers that consume them never see your code.',
  '',
  'Workflow — red green refactor:',
  "1. Anchor to BASE first: run git rev-parse HEAD; if it differs from BASE, run git reset --hard <BASE> before anything else — engine worktrees are sometimes cut from a stale ref, and building on the wrong parent reintroduces other tasks' changes and forces merge conflicts.",
  '2. Read and restate the acceptance criteria from the task text before touching code.',
  '3. Write or update tests that encode those criteria. Where the task specifies exact outputs — error lists and their order, JSON shapes, return values — assert the full expected value with equality, not loose containment, and cover the type edge cases the spec implies (e.g. a bool passing an int check). Confirm they fail (pnpm check or equivalent).',
  '4. Implement the minimum code to make them pass.',
  '5. Refactor for clarity without breaking tests.',
  '6. Run the full check suite one final time and confirm it is clean.',
  '7. Commit your work on your branch. The merge step integrates committed work only — git rev-parse HEAD must point at a commit that contains your final state; uncommitted or unstaged changes never reach the integration branch.',
  '',
  'Self-verify before reporting:',
  '- Re-read the task. Confirm every stated requirement is addressed.',
  '- Run git diff BASE...HEAD (BASE is provided in your inputs) and verify no unrelated files are modified.',
  '- Confirm no secrets, no commented-out debug code, no TODOs introduced.',
  '- If FILES is present: confirm every file you created, modified, or deleted is named there or is plainly required by the task text. NEVER delete a file outside FILES — if the task seems to demand it, STOP and report BLOCKED explaining why.',
  '- As your final step, generate the review packet for your BASE...HEAD: run bash skills/ultrapowers/scripts/review-package <BASE> <HEAD> (your committed HEAD). It writes the commits and the git diff -U10 to the shared common git dir and echoes the packet path as its last stdout line. Report that echoed path so the reviewer reads the exact diff you produced.',
  '',
  'Report your worktree coordinates: include git branch --show-current and git rev-parse HEAD in your response so the merge step can map task branch commit.',
  '',
  'Return a single JSON object conforming to the implementer status schema below. No prose outside the JSON block. Keep your back-channel summary to 15 lines or fewer; put the full detail in your committed work and the JSON fields.',
].join('\n')

// BAKE:REVIEWER_PROMPT
// One independent pass merging spec-compliance + code-quality — a deliberate
// divergence from superpowers 5.1.0's two-ordered-pass mandate (see
// references/reviewer-prompts.md, "Deliberate divergence"). Always runs at most-capable.
const REVIEWER_PROMPT = [
  'You are an independent reviewer. You receive the original task text and the implementer diff. You have no access to the Skill tool and must not consult the implementer report when forming your verdict.',
  '',
  'You are a REVIEW role. Do not write files, create commits, stage changes, or modify the tree in any way. Your only output is your findings/verdict. If the work is wrong, report it — never fix it.',
  '',
  'Mandate: verify everything independently. Do not trust the implementer report.',
  '',
  'Attention lens: when GLOBAL CONSTRAINTS are provided, they are binding requirements the spec demands — gate the diff against every one of them. When INTERFACES are provided, confirm the diff produces the named Produces contract with the stated types and uses each Consumes symbol as named, so neighboring tasks that depend on it stay satisfiable.',
  '',
  'Spec compliance:',
  '1. Read the pre-baked review packet at the path the implementer reported (the commits and git diff BASE...HEAD for this task, written to the shared common git dir). Do not run git. Guarded fallback: if no packet path was reported, the file is missing, or its recorded HEAD does not match the implementer HEAD, recover the diff from live git on a DETACHED checkout of the implementer HEAD (git checkout --detach <HEAD> — the implementer branch is locked by its worktree, so do not check the branch out) and run git diff BASE...HEAD yourself.',
  '2. Map every acceptance criterion in the task to a concrete line or test in the diff. Flag any criterion with no corresponding evidence as a blocking issue.',
  '3. Flag anything in the diff that is NOT required by the task (scope creep, unrelated refactors, leftover debug code).',
  'When FILES (the task\'s declared file scope) is provided: a deletion of any file that exists at BASE but is not named in FILES is automatically a blocking issue; modifications outside FILES are blocking unless the task text plainly requires them.',
  '',
  'Code quality:',
  '4. Separation of concerns: each module or function has one clear responsibility; UI, logic, and data layers are not entangled.',
  '5. Error handling: all async paths have explicit error paths; no silent catch blocks; user-visible errors are meaningful.',
  '6. DRY: no copy-pasted logic that could be extracted; shared utilities are used rather than reimplemented.',
  '7. Test quality: tests assert observable behavior, not implementation details; no tests that trivially pass without exercising real logic. Where the task defines exact outputs or ordering, a loose containment assertion in place of full-value equality is a finding — minor, or blocking when it leaves an acceptance criterion unverified.',
  '',
  'You review by reading the diff and its evidence; the implementer red green refactor cycle already ran the suite, and the suite runs again at the wave merge and on the integrated tree, so you do not re-run it here.',
  '',
  'For any requirement you cannot verify from the diff alone — it spans tasks, or it depends on unchanged code outside this diff — list it under cannotVerify with the requirement and why it is unverifiable from here, rather than crawling the repository to chase it. The completeness critic verifies these against the integrated tree.',
  '',
  'When SIBLING FILES is provided and a criterion is unsatisfiable in the diff ONLY because a sibling-owned file is absent at BASE, report a blocking issue that names the sibling file and the words "missing dependency edge" — do not instruct the implementer to create, duplicate, or delete the sibling-owned file.',
  '',
  'Flag only issues worth fixing. Minor style nits that a linter would catch automatically are not worth flagging. Severity blocking means the task must not merge until fixed; minor is advisory.',
  '',
  'Return a single JSON object conforming to the reviewer verdict schema. No prose outside the JSON block. Your final message is your report: every line is a verdict or a finding carrying file:line evidence.',
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

// Completeness critic prompt, built per-dispatch so it pins the critic to the
// EXACT tree the run produced (waveBaseSha = the last wave's merge.headSha).
// #29: a critic that reviews the wrong tree emits confident false findings — the
// detached checkout is immune to the integration-branch lock, and an empty sha
// forces BLOCKED rather than a guessed tree. Read-only review-role language: #32.
const completenessPrompt = (mergeHeadSha, cannotVerifyChecklist) =>
  'You are a REVIEW role. Do not write files, create commits, stage changes, or ' +
  'modify the tree in any way. Your only output is your findings/verdict. If the ' +
  'work is wrong, report it — never fix it.\n' +
  (planPath ? ('Read the original plan document at ' + planPath + ' first. ') : '') +
  'First, put yourself on the exact tree the run produced: the integration HEAD ' +
  'is ' + (mergeHeadSha || '') + '. If that value is empty, report BLOCKED and ' +
  'produce no findings — do not guess a tree. Otherwise run git checkout --detach ' +
  (mergeHeadSha || '') + ', then git rev-parse HEAD and confirm it equals ' +
  (mergeHeadSha || '') + '; if it does not, report BLOCKED and produce no ' +
  'findings. Only once you are verified on that tree: what plan requirement is ' +
  'unmet? What claim is unverified? What code path is untested? ' + testInstruction +
  ', then review the integrated result against the original plan. ' + (cannotVerifyChecklist || '') +
  'List every gap, unverified claim, and untested path.'

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
    cannotVerify: {
      type: 'array',
      items: {
        type: 'object',
        required: ['requirement', 'why'],
        properties: {
          requirement: { type: 'string' },
          why: { type: 'string' },
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
// headSha is required: downstream steps refuse to operate on a guessed sha.
const isMergeable = (r) => r && r.status === 'done' && r.branch && r.headSha

// Threaded into implementer/reviewer dispatches so task agents run the project's
// actual test command instead of guessing ("pnpm check or equivalent"). A task
// may carry its own `testCmd` (a polyglot plan often has Python tasks running
// pytest and Bun tasks running `bun test`); it overrides the run-wide testCmd.
const testCmdLine = (task) => {
  const cmd = (task && typeof task.testCmd === 'string' && task.testCmd.trim()) || testCmd
  return cmd ? ('\nTEST COMMAND: ' + cmd) : ''
}

// Threaded into the FRESH worktree roles (implementer, reviewer, fix) so they
// install dependencies before testing — engine worktrees carry no .venv /
// node_modules. Empty when bootstrapCmd is not supplied (deps assumed present).
const bootstrapLine = bootstrapCmd
  ? ('\nWORKTREE SETUP: this is a fresh worktree with no installed dependencies; ' +
     'run this before building or testing: ' + bootstrapCmd)
  : ''

// The verbatim task text block appended to implementer/reviewer dispatches. When
// the task carries an inline `body`, it is embedded directly (small/back-compat
// plans). Otherwise the body lives in the args.wavesPath file the compiler wrote:
// the agent reads its own entry by id from disk, so a multi-KB body never has to
// be transcribed by a model (neither the orchestrator inline, nor a relay agent).
const taskBodyBlock = (task) => {
  // A non-empty inline body wins (a whitespace-only body is treated as absent so
  // it never shadows the file-backed body). Otherwise read from the wavesPath
  // file — validation guarantees wavesPath is set whenever the body is empty, so
  // the else branch can never interpolate "undefined".
  const inlineBody = (typeof task.body === 'string' && task.body.trim() !== '')
  if (inlineBody) return '\nTASK:\n' + task.body
  if (wavesPath) {
    return '\nTASK: read your verbatim task text from the JSON file at ' + wavesPath +
      ' — in its "tasks" array, find the object whose "id" is "' + task.id +
      '" and use that object\'s "body" field as the authoritative task text. Do ' +
      'not paraphrase it; that entry also lists your declared file scope.'
  }
  return '\nTASK:\n' + (typeof task.body === 'string' ? task.body : '')
}

// task.files (advisory at validation) becomes the FILES prompt line: the
// declared scope the implementer must stay inside and the reviewer enforces.
// Eval run mixed-B-2 (2026-06-13): an implementer deleted a file its task
// never named; nothing mechanical caught it before the fix loop burned out.
const filesLine = (task) => (Array.isArray(task.files) && task.files.length)
  ? ('\nFILES: ' + task.files.join(', '))
  : ''

// The plan's Global Constraints, threaded into the implementer and reviewer
// dispatches. Empty when no constraints were supplied. (#1.4)
const globalConstraintsBlock = globalConstraints
  ? ('\nGLOBAL CONSTRAINTS:\n' + globalConstraints)
  : ''

// A task's Interfaces (compile_plan.py emits { consumes:[...], produces:[...] }),
// threaded so the worktree-isolated implementer learns the neighboring signatures
// it consumes and the contract it must produce, and the reviewer can check the
// produced contract. Empty when the task declared no interfaces. (#1.4)
const interfacesLine = (task) => {
  const i = task && task.interfaces
  if (!i || typeof i !== 'object') return ''
  const consumes = Array.isArray(i.consumes) ? i.consumes : []
  const produces = Array.isArray(i.produces) ? i.produces : []
  if (consumes.length === 0 && produces.length === 0) return ''
  return '\nINTERFACES:' +
    (consumes.length ? ('\nConsumes: ' + consumes.join(', ')) : '') +
    (produces.length ? ('\nProduces: ' + produces.join(', ')) : '')
}

// Same-wave siblings own files this task must not touch — they are not at
// BASE (a wave merges only after all its tasks finish). Naming them lets the
// implementer and reviewer tell "missing sibling file" from "broken work".
const siblingLine = (task, wave) => {
  const sibs = wave
    .filter((t) => t.id !== task.id && Array.isArray(t.files) && t.files.length)
    .map((t) => t.id + ': ' + t.files.join(', '))
  return sibs.length ? ('\nSIBLING FILES: ' + sibs.join(' | ')) : ''
}

// Review depth per task: an explicit task.review ('adversarial' | 'lean') — set by
// the orchestrating agent from the plan's per-task risk/tier — overrides the
// run-wide reviewProfile default. Spend the extra adversarial pass only where asked.
const taskReviewProfile = (task) =>
  (task.review === 'adversarial' || task.review === 'lean') ? task.review : reviewProfile

// ── Per-task pipeline: implement → review → bounded fix-loop ──────────────────
// A thrown agent() call (engine fault, schema failure, transient error) must
// cost ONE task, never the run: parallel() is fail-fast, so an uncaught throw
// in a 16-wide wave would reject the whole wave and lose the report.
async function runTask(task, baseSha, siblings) {
  try {
    return await runTaskInner(task, baseSha, siblings)
  } catch (e) {
    const msg = String((e && e.message) || e)
    judgmentCalls.push('task ' + task.id + ': agent error — ' + msg)
    log('task ' + task.id + ' FAILED on agent error: ' + msg)
    const safeTier = Object.prototype.hasOwnProperty.call(TIER, tierKey(task.tier))
      ? TIER[tierKey(task.tier)] : undefined
    return { task: task.id, status: 'failed', reviewVerdict: 'agent-error',
             notes: msg, tier: (typeof safeTier === 'string') ? safeTier : TIER.standard,
             review: taskReviewProfile(task), fixIterations: 0 }
  }
}
async function runTaskInner(task, baseSha, siblings) {
  // Own-string lookup only: a prototype name like 'constructor' must never
  // resolve to an inherited function and ship as a model identifier.
  const tierValue = Object.prototype.hasOwnProperty.call(TIER, tierKey(task.tier))
    ? TIER[tierKey(task.tier)] : undefined
  const baseModel = (typeof tierValue === 'string') ? tierValue : TIER.standard
  // Run economics, reported per task so the pre-merge gate can judge cost vs. benefit.
  const economics = { tier: baseModel, review: taskReviewProfile(task) }
  // DONE_WITH_CONCERNS concerns must reach the report — never swallowed.
  const concerns = []
  const noteConcerns = (res) => {
    if (res && res.status === 'DONE_WITH_CONCERNS' && Array.isArray(res.concerns)) {
      for (const c of res.concerns) {
        if (concerns.indexOf(c) !== -1) continue // fix round repeating a concern: once is enough
        concerns.push(c)
        judgmentCalls.push('task ' + task.id + ': ' + c)
      }
    }
  }
  // Surface a typo'd review depth rather than silently downgrading it — the
  // autonomy posture promises ambiguity reaches the report via judgmentCalls,
  // not only the run log.
  if (task.review && task.review !== 'adversarial' && task.review !== 'lean') {
    log('task ' + task.id + ': unknown review="' + task.review +
        '", falling back to run default (' + reviewProfile + ')')
    judgmentCalls.push('task ' + task.id + ': unknown review="' + task.review +
        '" — fell back to the run default (' + reviewProfile + ')')
  }
  // Same posture for an unknown tier: a plan asking for top-tier work must not
  // silently run a tier down (tierKey normalizes only 'most-capable').
  if (task.tier && typeof tierValue !== 'string') {
    log('task ' + task.id + ': unknown tier="' + task.tier +
        '", falling back to standard')
    judgmentCalls.push('task ' + task.id + ': unknown tier="' + task.tier +
        '" — fell back to standard (valid: cheap, standard, mostCapable/most-capable)')
  }

  const siblingsStr = siblings || ''
  let impl = await agent(
    GUARD + '\n\n' + IMPLEMENTER_PROMPT + '\n\nBASE: ' + baseSha + testCmdLine(task) + bootstrapLine + filesLine(task) + siblingsStr + globalConstraintsBlock + interfacesLine(task) + taskBodyBlock(task),
    { label: 'impl:' + task.id, isolation: 'worktree', model: baseModel, schema: IMPLEMENTER_SCHEMA }
  )
  noteConcerns(impl)
  // Fail fast on a DONE without mergeable coordinates (schema requires
  // branch/headSha, so this needs an engine bypass): dispatching the reviewer
  // would thread "HEAD: undefined" into a checkout it cannot perform — the
  // GUARD forces a BLOCKED state the reviewer schema cannot express — burning
  // an opus review on a doomed pipeline. The wave-level lost sweep stays as
  // second-line defense.
  if (impl.status !== 'BLOCKED' && impl.status !== 'NEEDS_CONTEXT' &&
      (!impl.branch || !impl.headSha)) {
    judgmentCalls.push('task ' + task.id + ': reported done without mergeable ' +
      'coordinates (branch/headSha) — failed before review; downgraded for dependency blocking')
    log('task ' + task.id + ' FAILED: done without mergeable coordinates — review skipped')
    return { task: task.id, status: 'failed', branch: impl.branch,
             reviewVerdict: 'lost-coordinates',
             notes: 'reported done without mergeable coordinates — downgraded to failed before review',
             tier: economics.tier, review: economics.review, fixIterations: 0 }
  }
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
      taskBodyBlock(task) + '\nBRANCH: ' + impl.branch + '\nHEAD: ' + impl.headSha +
      '\nBASE: ' + baseSha + testCmdLine(task) + bootstrapLine + filesLine(task) + siblingsStr + globalConstraintsBlock + interfacesLine(task)
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
      for (const cv of (r1.cannotVerify || []).concat(r2.cannotVerify || [])) {
        cannotVerifyItems.push({ task: task.id, requirement: cv.requirement, why: cv.why })
      }
    } else {
      const review = await agent(reviewPrompt, reviewOpts())
      issues = review.issues || []
      verdicts = [review.verdict]
      for (const cv of (review.cannotVerify || [])) {
        cannotVerifyItems.push({ task: task.id, requirement: cv.requirement, why: cv.why })
      }
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
    // Engine-bypass class (schema requires verdict+issues): a review result
    // with NO recognizable verdict must not severity-merge as clean — a weak
    // reviewer's failure mode is the silent false PASS. Treat it as blocking.
    if (!verdicts.some((v) => v === 'PASS' || v === 'FIX_REQUIRED')) {
      judgmentCalls.push('task ' + task.id + ': reviewer returned no recognizable verdict — ' +
        'treating as FIX_REQUIRED with a blocking issue (never merging on an empty review)')
      log('task ' + task.id + ': verdict-less review result — conservative blocking')
      issues = issues.concat([{ severity: 'blocking',
        detail: 'review result carried no recognizable verdict — re-review required' }])
    }
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
    // Re-dispatch implementer in a fresh worktree anchored to the prior implementation commit.
    // BASE is set to impl.headSha (not baseSha) so anchoring to BASE hands it the work to
    // amend rather than a blank slate. The prior branch stays locked by its worktree;
    // the fix agent commits on its own engine-assigned branch and reports it.
    impl = await agent(
      GUARD + '\n\n' + IMPLEMENTER_PROMPT + '\n\nBASE: ' + impl.headSha + testCmdLine(task) + bootstrapLine + filesLine(task) + siblingsStr + globalConstraintsBlock + interfacesLine(task) + taskBodyBlock(task) +
        '\n\nFIX ROUND — the prior implementation of this task exists at commit ' + impl.headSha +
        ' (branch ' + impl.branch + ', locked by its own worktree — do not try to check it out).' +
        ' BASE above IS that commit: anchoring to BASE gives you the prior work to amend, not a blank slate.' +
        ' Resolve these blocking issues on top of it, commit on YOUR assigned branch, and report YOUR branch and HEAD:\n' +
        blocking.map((b) => '- ' + b.detail).join('\n'),
      { label: 'fix:' + task.id + ':' + iter, isolation: 'worktree', model: TIER.mostCapable, schema: IMPLEMENTER_SCHEMA }
    )
    noteConcerns(impl)
    // Same fail-fast as the initial dispatch: a fix result claiming DONE
    // without mergeable coordinates must not reach the iter-2 reviewer
    // ("HEAD: undefined" → a doomed opus review). Engine-bypass class only —
    // the schema requires branch/headSha.
    if ((impl.status === 'DONE' || impl.status === 'DONE_WITH_CONCERNS') &&
        (!impl.branch || !impl.headSha)) {
      judgmentCalls.push('task ' + task.id + ': fix round reported done without mergeable ' +
        'coordinates (branch/headSha) — failed before review; downgraded for dependency blocking')
      log('task ' + task.id + ' FAILED: fix round done without mergeable coordinates — review skipped')
      return { task: task.id, status: 'failed', branch: impl.branch,
               reviewVerdict: 'lost-coordinates',
               notes: 'fix round reported done without mergeable coordinates — downgraded to failed before review',
               tier: economics.tier, review: economics.review, fixIterations: 1 }
    }
    if (impl.status === 'BLOCKED' || impl.status === 'NEEDS_CONTEXT') {
      return { task: task.id, status: 'failed', branch: impl.branch,
               reviewVerdict: 'blocked-after-fix', notes: impl.summary,
               tier: economics.tier, review: economics.review, fixIterations: 1 }
    }
  }
}

// ── Wave merge (NON-isolated; reconciliation cap 2) ──────────────────────────
async function mergeWave(results, waveIdx) {
  // Caller guarantees ≥1 mergeable result (the SKIPPED path filters empty waves).
  const merged = results.filter(isMergeable)
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
    if (budgetExhausted()) {
      return { status: 'DEFERRED', detail: 'budget exhausted before reconciliation attempt ' +
        attempt + ' (last merge status: ' + merge.status + ') — task branches intact, not merged' }
    }
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
const cannotVerifyItems = []

// An edge endpoint absent from this run's waves can never bind for dependency
// blocking — a typo'd id would silently disable the guarantee for that pair.
// Surfaced, not thrown: on resume runs, edges referencing tasks completed in
// the prior run are legitimately unbound.
{
  const waveIndexOf = Object.create(null) // proto-safe: ids like 'toString' must not false-bind
  WAVES.forEach((w, i) => w.forEach((t) => { waveIndexOf[t.id] = i }))
  for (const [a, b] of EDGES) {
    if (!(a in waveIndexOf) || !(b in waveIndexOf)) {
      judgmentCalls.push('edge ' + a + ' -> ' + b + ': endpoint not in this run — ' +
        'unbound for dependency blocking (legitimate on resume runs; otherwise check for a typo)')
      log('edge ' + a + ' -> ' + b + ' has an unbound endpoint — dependency blocking will not fire for it')
    } else if (waveIndexOf[a] > waveIndexOf[b]) {
      // Inverted: the dependent is scheduled BEFORE its prerequisite — blocking
      // can never bind. Compiler waves always layer dependents later;
      // hand-authored or redirect waves may not.
      judgmentCalls.push('edge ' + a + ' -> ' + b + ': \'' + b + '\' does not run after \'' + a +
        '\' (earlier wave) — dependency blocking cannot bind; move the dependent to a later wave')
      log('edge ' + a + ' -> ' + b + ' endpoints are inverted — blocking will not fire')
    } else if (waveIndexOf[a] === waveIndexOf[b]) {
      // Same wave: the per-chunk noteFailures() re-check DOES bind across
      // 16-task chunk boundaries, so blocking here is position-dependent, not
      // impossible — say exactly that.
      judgmentCalls.push('edge ' + a + ' -> ' + b + ': endpoints share a wave — blocking is ' +
        'chunk-position-dependent (fires only across 16-task chunk boundaries); ' +
        'move the dependent to a later wave for a guarantee')
      log('edge ' + a + ' -> ' + b + ' endpoints share a wave — blocking only fires across chunk boundaries')
    }
  }
}

const budgetExhausted = () => {
  if (typeof budget === 'undefined' || !budget) return false
  const r = (typeof budget.remaining === 'function') ? budget.remaining() : budget.remaining
  return typeof r === 'number' && r <= 0
}

// A run launched with an already-exhausted budget defers everything up front:
// dispatching setup (or the opus integration review) would spend agents on a
// run that cannot execute a single task.
if (budgetExhausted()) {
  WAVES.forEach((w) => w.forEach((t) => unfinished.push(t.id + ': deferred (budget exhausted before setup)')))
  log('budget exhausted before setup: deferring the entire run, no agents dispatched')
  return {
    integrationBranch,
    waves: WAVES.map((w) => w.map((t) => t.id)),
    dependencyEdges,
    tasks: [],
    tests: { command: undefined, passed: false, output: 'not run — budget exhausted before setup' },
    baseline: {},
    waveMerges: [],
    judgmentCalls: judgmentCalls.concat(['run deferred: budget exhausted before setup — no setup, task, or review agents dispatched']),
    unfinished,
    completenessFindings: [],
    blockedWaves: [],
  }
}

// ── wavesPath preflight (FAIL LOUD, before spending task agents) ──────────────
// When bodies are delivered via the file, one cheap read-only agent confirms the
// file exists, parses, and covers every bodyless task id — so a wrong/stale path
// or a dropped id fails the run up front instead of failing N expensive worktree
// agents that each cannot find their body. Skipped when every body is inline.
const bodylessIds = WAVES.flat()
  .filter((t) => !(typeof t.body === 'string' && t.body.trim() !== ''))
  .map((t) => String(t.id))
if (wavesPath && bodylessIds.length > 0) {
  const WAVES_FILE_PREFLIGHT =
    'You are a read-only preflight agent. Read the JSON file at WAVES_FILE in the ' +
    'session repository with your file-read tool. Do NOT write, create, stage, or ' +
    'modify anything — your only output is the JSON result. Parse the file and return ' +
    '{ "ok": true, "ids": [...] } where ids lists every string value of "id" in its ' +
    'top-level "tasks" array. If the file is missing, unreadable, or not valid JSON, ' +
    'return { "ok": false, "error": "<short reason>" }. Return only the JSON object.'
  const WAVES_FILE_SCHEMA = {
    type: 'object',
    required: ['ok'],
    properties: {
      ok: { type: 'boolean' },
      ids: { type: 'array', items: { type: 'string' } },
      error: { type: 'string' },
    },
  }
  let probe
  try {
    probe = await agent(
      GUARD + '\n\n' + WAVES_FILE_PREFLIGHT + '\nWAVES_FILE: ' + wavesPath,
      { label: 'waves-file-check', model: TIER.cheap, schema: WAVES_FILE_SCHEMA })
  } catch (e) {
    throw new Error('ultrapowers: could not preflight args.wavesPath (' + wavesPath +
      '): ' + String((e && e.message) || e) + '. Refusing to run before any task.')
  }
  if (!probe || probe.ok !== true) {
    throw new Error('ultrapowers: args.wavesPath file unusable (' + wavesPath + '): ' +
      ((probe && probe.error) || 'preflight did not confirm ok') +
      '. Write it with compile_plan.py --emit-launch before launch.')
  }
  const have = new Set(Array.isArray(probe.ids) ? probe.ids.map(String) : [])
  const missing = bodylessIds.filter((id) => !have.has(id))
  if (missing.length) {
    throw new Error('ultrapowers: args.wavesPath (' + wavesPath +
      ') has no body for task id(s): ' + missing.join(', ') +
      '. Re-run compile_plan.py --emit-launch so every bodyless task is covered.')
  }
}

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
} else if (typeof setup.baselinePassed !== 'boolean') {
  // baselinePassed is required by the setup prompt but optional in the schema
  // (same class as lost-coordinates): an unknown baseline — omitted OR null,
  // the natural JSON for "unknown" — must not silently read as not-red at the
  // pre-merge gate.
  judgmentCalls.push(
    'baseline unknown — setup did not report baselinePassed; treat later test ' +
    'results with care (the suite may have been red before any task ran)'
  )
  log('setup: baseline result UNKNOWN (baselinePassed not reported)')
}

const CONCURRENCY = 16 // engine cap: up to 16 concurrent agents per run

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
// Guard: record a judgmentCall only once for the first mid-run budget deferral.
let budgetDeferred = false

for (let w = 0; w < WAVES.length; w++) {
  // Peak concurrency equals wave width (each task pipeline is internally
  // sequential), so chunk waves wider than the engine cap.
  if (budgetExhausted()) {
    WAVES[w].forEach((t) => unfinished.push(t.id + ': deferred (budget exhausted)'))
    log('wave ' + (w + 1) + ' deferred: budget exhausted')
    if (!budgetDeferred) {
      budgetDeferred = true
      judgmentCalls.push('budget exhausted mid-run — remaining work deferred to unfinished')
    }
    continue
  }
  phase('Wave ' + (w + 1))
  noteFailures()
  const results = []
  for (let off = 0; off < WAVES[w].length; off += CONCURRENCY) {
    noteFailures()
    const chunk = WAVES[w].slice(off, off + CONCURRENCY)
    if (budgetExhausted()) {
      chunk.forEach((t) => unfinished.push(t.id + ': deferred (budget exhausted mid-wave)'))
      log('wave ' + (w + 1) + ' chunk deferred: budget exhausted mid-wave')
      if (!budgetDeferred) {
        budgetDeferred = true
        judgmentCalls.push('budget exhausted mid-run — remaining work deferred to unfinished')
      }
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
    const chunkResults = await parallel(runnable.map((task) => () =>
      runTask(task, waveBaseSha, siblingLine(task, WAVES[w]))))
    for (const r of chunkResults) { results.push(r); taskResults.push(r) }
    // Fix B: run the lost-done sweep immediately after each chunk so the NEXT
    // chunk's noteFailures() sees the downgrade before dispatching intra-wave
    // dependents. A done-without-coordinates task in chunk 1 must block a
    // dependent in chunk 2 — this was missed when the sweep ran only after
    // all chunks completed.
    // Fix C: also set reviewVerdict and notes so the record is self-describing.
    const chunkLost = chunkResults.filter((r) => r && r.status === 'done' && !isMergeable(r))
    for (const r of chunkLost) {
      judgmentCalls.push('task ' + r.task + ': reported done without mergeable coordinates (branch/headSha) — branch not merged; treating as failed for dependency blocking')
      log('task ' + r.task + ': done without mergeable coordinates — treating as failed')
      r.status = 'failed'
      r.reviewVerdict = 'lost-coordinates'
      r.notes = (r.notes ? r.notes + '; ' : '') + 'reported done without mergeable coordinates — downgraded to failed'
    }
    noteFailures()
  }

  // When every task in the wave is dep-blocked/failed (no mergeable branches),
  // skip the merge — but when NO edges were supplied (not even an empty array)
  // and tasks actually ran, cascade conservatively so later waves don't build
  // on a missing base. An explicitly supplied edges: [] means the compiler
  // proved independence — take the SKIPPED-continue path instead.
  const mergeable = results.filter(isMergeable)
  if (mergeable.length === 0) {
    if (!edgesSupplied && results.length > 0) {
      // No edges supplied at all and nothing merged — conservative cascade.
      const cascadeDetail = 'no mergeable branches and no dependency edges supplied — cascading conservatively'
      blockedWaves.push({ wave: w + 1, detail: cascadeDetail })
      log('wave ' + (w + 1) + ' cascade (no edges): ' + cascadeDetail)
      for (let d = w + 1; d < WAVES.length; d++) {
        log('wave ' + (d + 1) + ' cascade-blocked by wave ' + (w + 1))
        WAVES[d].forEach((t) => unfinished.push(t.id + ': cascade-blocked by wave ' + (w + 1)))
      }
      waveMerges.push({
        wave: w + 1,
        status: 'SKIPPED',
        detail: cascadeDetail,
        branches: [],
      })
      break
    }
    waveMerges.push({
      wave: w + 1,
      status: 'SKIPPED',
      detail: 'no mergeable branches — every task in this wave failed, was blocked, was deferred, or reported done without mergeable coordinates; integration branch untouched',
      branches: [],
    })
    log('wave ' + (w + 1) + ' merge skipped: no mergeable branches')
    continue
  }

  if (budgetExhausted()) {
    waveMerges.push({
      wave: w + 1,
      status: 'DEFERRED',
      detail: 'budget exhausted before wave merge — task branches exist unmerged; rerun or redirect after raising the budget',
      branches: mergeable.map((r) => r.task),
    })
    if (!budgetDeferred) {
      budgetDeferred = true
      judgmentCalls.push('budget exhausted mid-run — remaining work deferred to unfinished')
    }
    for (let d = w + 1; d < WAVES.length; d++) {
      WAVES[d].forEach((t) => unfinished.push(t.id + ': deferred (budget exhausted before wave ' + (w + 1) + ' merge)'))
    }
    log('wave ' + (w + 1) + ' merge deferred: budget exhausted')
    break
  }
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
  if (merge.status === 'DEFERRED') {
    if (!budgetDeferred) {
      budgetDeferred = true
      judgmentCalls.push('budget exhausted mid-run — remaining work deferred to unfinished')
    }
    for (let d = w + 1; d < WAVES.length; d++) {
      WAVES[d].forEach((t) => unfinished.push(t.id + ': deferred (budget exhausted during wave ' + (w + 1) + ' merge)'))
    }
    log('wave ' + (w + 1) + ' merge deferred mid-reconciliation: budget exhausted')
    break
  }
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
      log('wave ' + (d + 1) + ' cascade-blocked by wave ' + (w + 1))
      WAVES[d].forEach((t) => unfinished.push(t.id + ': cascade-blocked by wave ' + (w + 1)))
    }
    break
  }
}

// ── Integration + completeness review ────────────────────────────────────────
phase('Integration Review')
const taskList = WAVES.flat().map((t) => t.id + ': ' + (t.title || '')).join('\n')
let review
if (budgetExhausted()) {
  judgmentCalls.push('integration review deferred: budget exhausted — verify the suite manually before merging')
  log('integration review deferred: budget exhausted')
  review = { command: undefined, testsPassed: false,
             output: 'not run — budget exhausted before integration review',
             findings: ['integration review deferred: budget exhausted — verify the suite manually before merging'] }
} else {
  try {
    const cannotVerifyChecklist = cannotVerifyItems.length
      ? ('CANNOT-VERIFY checklist (escalated by the per-task reviewers — verify each against the integrated tree): ' +
         cannotVerifyItems.map((c) => '[' + c.task + '] ' + c.requirement + ' (' + c.why + ')').join('; ') + '. ')
      : ''
    review = await agent(
      GUARD + '\n\n' + completenessPrompt(waveBaseSha, cannotVerifyChecklist) +
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
}

// cannot-verify items with no usable completeness critic must not be dropped:
// when the run recorded no merge HEAD, the critic reports BLOCKED, so the items
// surface at the gate as judgment calls instead (#2.2 error handling).
if (cannotVerifyItems.length && !waveBaseSha) {
  for (const c of cannotVerifyItems) {
    judgmentCalls.push('cannot-verify (task ' + c.task + '): ' + c.requirement +
      ' — no completeness critic ran (no merge HEAD); verify manually before the gate')
  }
}

// ── Acceptance disposition for the report. suite/waived are resolved here;
// sealed is administered deterministically at the pre-merge gate, not in the
// workflow — the engine has no shell and relaying the runner's JSON corrupts
// it (#36). ───────────────────────────────────────────────────────────────────
let acceptance = null
if (ACCEPTANCE && ACCEPTANCE.mode === 'waived') {
  acceptance = { mode: 'waived', reason: String(ACCEPTANCE.reason || ''), passed: null }
} else if (ACCEPTANCE && ACCEPTANCE.mode === 'suite') {
  // suite: verification is the committed test suite, not a held-out exam.
  // acceptance.passed mirrors the integration test result; no agent, no vault.
  acceptance = { mode: 'suite', passed: review.testsPassed,
                 reason: String(ACCEPTANCE.reason || '') }
  if (!acceptance.passed) judgmentCalls.push(
    'suite acceptance did not pass (committed test suite failed) — gate must not Approve')
} else if (ACCEPTANCE && ACCEPTANCE.mode === 'sealed') {
  // Sealed exams are administered deterministically at the pre-merge gate
  // (SKILL.md Step 5), where the main session runs run_acceptance.sh directly
  // and uses its exit code as the authority. The workflow engine cannot run a
  // shell (agent() is its only subprocess route), and relaying the runner's
  // JSON-object stdout through a cheap model corrupts it (issue #36). The
  // workflow therefore records only the disposition; it does not administer.
  acceptance = { mode: 'sealed', sealId: ACCEPTANCE.sealId, sha256: ACCEPTANCE.sha256,
                 status: 'PENDING_GATE', passed: null,
                 note: 'administered deterministically at the pre-merge gate' }
}

// ── Structured return value (matches references/report-format.md) ─────────────
return {
  integrationBranch,
  waves: WAVES.map((w) => w.map((t) => t.id)),
  dependencyEdges,
  tasks: taskResults,
  tests: { command: review.command, passed: review.testsPassed, output: review.output },
  acceptance,
  baseline,
  waveMerges,
  judgmentCalls,
  unfinished,
  completenessFindings: review.findings || [],
  blockedWaves,
}
