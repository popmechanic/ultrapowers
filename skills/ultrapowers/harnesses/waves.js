// skills/ultrapowers/harnesses/waves.js
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

// W1: a wave is named by (1) an orchestrator-supplied ARGS.waveLabels entry —
// compile_plan.py emits these (--emit-args / waveLabels) and SKILL.md threads
// them through — else (2) a single-task wave's own title, else (3) 'Wave N'.
// The rich shared-noun / common-directory derivation lives ONLY in
// compile_plan.py now; the engine no longer mirrors it in a second language
// (label-less launches are hand-authored Salvage/Redirect waves, where a
// plain 'Wave N' is acceptable). Used by the meta.phases mutation, the wave
// loop, and the W2 roadmap.
const deriveWaveLabel = (wave) => {
  const tasks = (Array.isArray(wave) ? wave : []).filter(Boolean)
  if (tasks.length !== 1) return ''
  const s = String(tasks[0].title || ('Task ' + tasks[0].id)).trim()
  return s.length > 56 ? s.slice(0, 55) + '…' : s
}
const waveLabel = (w) => {
  const supplied = (ARGS && Array.isArray(ARGS.waveLabels)) ? ARGS.waveLabels[w] : undefined
  if (typeof supplied === 'string' && supplied.trim()) return supplied.trim()
  return deriveWaveLabel(WAVES[w]) || ('Wave ' + (w + 1))
}

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
    'file by id; title/tier/review/testCmd are consumed by prompts; ' +
    'files feeds the FILES prompt line). Refusing to run with an ' +
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

// ── Per-project knobs (optional unless noted; defaults preserve prior behavior) ─
// testCmd:        MANDATORY (#96) — the run-wide test command, stamped by the
//                 ultra_run.py preflight from the operator knob or its detection
//                 ladder. Validated below; the harness never detects on its own.
// reviewProfile:  'lean' (default, one review pass) | 'adversarial' (two independent passes).
const testCmd = (ARGS && typeof ARGS.testCmd === 'string' && ARGS.testCmd.trim()) || undefined
// bootstrapCmd: a per-worktree setup command (e.g. install deps) the FRESH,
// worktree-isolated roles (implementer, reviewer, fix) run before testing.
// Engine worktrees are cut clean from the integration HEAD: they have no .venv,
// no node_modules. A polyglot/monorepo repo (e.g. pytest at root + `bun test` in
// app/) needs its stacks installed in each worktree before the suite can run.
// Setup also receives it (#84): it cuts the dedicated integration worktree,
// which is equally fresh, and the merge/reconcile/completeness agents run the
// suite there — they do not re-run it, setup bootstrapped their tree once.
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
// Pushed onto judgmentCalls at every budget-exhaustion checkpoint (one note per site).
const BUDGET_DEFERRED_NOTE = 'budget exhausted mid-run — remaining work deferred to unfinished'
const reviewProfile = (ARGS && ARGS.reviewProfile === 'adversarial') ? 'adversarial' : 'lean'

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

// Path args are absolute or nothing: agents run from worktrees and detached
// checkouts, so a relative (or absent) pluginRoot/runDir resolves somewhere
// different for every role. Catch it at launch rather than at first dispatch.
for (const k of ['pluginRoot', 'runDir']) {
  if (typeof ARGS[k] !== 'string' || !ARGS[k].startsWith('/')) {
    throw new Error('ultrapowers: args.' + k + ' missing or not an absolute path. ' +
      'ultra_run.py emits both keys via compile_plan.py --run-dir; a hand-authored ' +
      'salvage/redirect launch must carry them too. Refusing to launch.')
  }
}

// #96: the gate derives tests.command from the receipt; the harness copy in
// args must therefore always exist — the driver stamps it (knob or detection).
if (typeof ARGS.testCmd !== 'string' || !ARGS.testCmd.trim()) {
  throw new Error('ultrapowers: args.testCmd missing or empty. The ultra_run.py ' +
    'preflight stamps it into the argsFile — launch by spreading the receipt argsFile.')
}

// Wave phase titles are NOT injected by mutating the meta literal: the current
// harness extracts meta at parse time and does not expose it to the executing body
// (the old runtime reassignment silently no-op'd / threw there). The live progress
// tree is labeled entirely by the phase(waveLabel(w)) roadmap below, which DOES take
// effect; the meta literal at the top keeps its empty phases.

// ── GUARD — baked from references/reviewer-prompts.md (BAKE:GUARD) ────────────
const GUARD =
  'SAFETY: Operate ONLY inside the git worktree assigned to you, or — for the ' +
  "setup, merge, and reconcile roles and the completeness critic — the run's " +
  'dedicated integration worktree, which those write-side roles may modify and ' +
  'in which the critic is read-only apart from its sha-verified detach below. ' +
  'The setup role is additionally ' +
  'authorized to run git worktree add from the session repo root to CREATE that ' +
  'integration worktree: it necessarily runs before the worktree exists, and ' +
  'writes only git metadata plus the new worktree directory; creating it is the ' +
  "setup role's only permitted session-root action. Review roles (the per-task " +
  'reviewer and the completeness critic) are READ-ONLY: they read the diff or a ' +
  'detached inspection checkout and never write files, create commits, stage ' +
  'changes, check out or switch a branch, or otherwise mutate a working tree — ' +
  'their only output is their report payload; the single sanctioned exception ' +
  "is the completeness critic's sha-verified git checkout --detach INSIDE the " +
  "run's dedicated integration worktree, which releases the integration branch " +
  'for the gate and never touches the session checkout. The per-task ' +
  "reviewer's sanctioned location is the session launch directory itself, " +
  'non-isolated and read-only, judging from the pre-baked review packet (or ' +
  'the read-only object-store diff fallback) — it claims no worktree of its ' +
  'own. You operate in ' +
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
  '2. If a WORKTREE SETUP line is present, run it before building or testing: it prefers a warm dependency cache (a near-instant hardlink-clone of a prebuilt node_modules / .venv) and falls through to a real install on a cache miss, then warms the cache for sibling worktrees. The cache is an optimization only — your work is correct whether it hits or misses.',
  '3. Read and restate the acceptance criteria from the task text before touching code.',
  '4. Write or update tests that encode those criteria. Where the task specifies exact outputs — error lists and their order, JSON shapes, return values — assert the full expected value with equality, not loose containment, and cover the type edge cases the spec implies (e.g. a bool passing an int check). Confirm they fail (pnpm check or equivalent).',
  '5. Implement the minimum code to make them pass.',
  '6. Refactor for clarity without breaking tests.',
  '7. Run the full check suite one final time and confirm it is clean.',
  '8. Commit your work on your branch. The merge step integrates committed work only — git rev-parse HEAD must point at a commit that contains your final state; uncommitted or unstaged changes never reach the integration branch.',
  '',
  'Plan-supplied code that is genuinely defective: you MAY fix a defect in plan-verbatim code when the fix is task-local — never in a cross-task interface surface a sibling consumes; when in doubt, implement the plan as written and report the defect instead. Disclose every such divergence as a concerns entry prefixed plan-defect: naming the plan text you diverged from and why, and report status DONE_WITH_CONCERNS. An undisclosed divergence is a review-blocking defect.',
  '',
  'Self-verify before reporting:',
  '- Re-read the task. Confirm every stated requirement is addressed.',
  '- Generate the review packet for your BASE..HEAD first: run bash <pluginRoot>/skills/ultrapowers/scripts/review-package <BASE> <HEAD> <runDir>/review/ (your committed HEAD; the trailing slash makes the last argument a target directory receiving the default-named packet). It writes the commits and the git diff -U10 under the run scratch dir — outside anything git tracks — and echoes the packet path as its last stdout line. Report that echoed path so the reviewer reads the exact diff you produced.',
  '- Read the packet\'s ## Files changed section (the git diff --stat of your BASE..HEAD): verify no unrelated files are modified. If FILES is present, confirm every changed path is named there or is plainly required by the task text. NEVER delete a file outside FILES — if the task seems to demand it, STOP and report BLOCKED explaining why.',
  '- Confirm no secrets, no commented-out debug code, no TODOs introduced.',
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
  '1. Read the pre-baked review packet at the path the implementer reported (the commits and git diff BASE...HEAD for this task, written under the run scratch dir <runDir>/review/). Do not run git. Guarded fallback: if no packet path was reported, the file is missing, or its recorded HEAD does not match the implementer HEAD, recover the diff read-only with git diff <BASE> <HEAD> using the BASE and HEAD shas in your inputs — both commits live in the shared object store, so this needs no checkout. You run non-isolated on the shared main checkout alongside concurrent reviewers; never check out a branch or detach any tree.',
  '2. Map every acceptance criterion in the task to a concrete line or test in the diff. Flag any criterion with no corresponding evidence as a blocking issue.',
  '3. Flag anything in the diff that is NOT required by the task (scope creep, unrelated refactors, leftover debug code).',
  'When FILES (the task\'s declared file scope) is provided: a deletion of any file that exists at BASE but is not named in FILES is automatically a blocking issue; modifications outside FILES are blocking unless the task text plainly requires them.',
  '',
  'Code quality:',
  '4. Separation of concerns: each module or function has one clear responsibility; UI, logic, and data layers are not entangled.',
  '5. Error handling: all async paths have explicit error paths; no silent catch blocks; user-visible errors are meaningful.',
  '6. DRY: no copy-pasted logic that could be extracted; shared utilities are used rather than reimplemented.',
  '7. Test quality: tests assert observable behavior, not implementation details; no tests that trivially pass without exercising real logic. Where the task defines exact outputs or ordering, a loose containment assertion in place of full-value equality is a finding — minor, or blocking when it leaves an acceptance criterion unverified.',
  '8. When the diff commits a generated artifact (a baked copy, a regenerated baseline, a build output), regenerate it with its generator and byte-compare against the committed copy — never eyeball equivalence. A hand-edited artifact that reads plausibly is exactly the false green this catches.',
  '',
  'You review by reading the diff and its evidence; the implementer red green refactor cycle already ran the suite, and the suite runs again at the wave merge and on the integrated tree, so you do not re-run it here.',
  '',
  'For any requirement you cannot verify from the diff alone — it spans tasks, or it depends on unchanged code outside this diff — list it under cannotVerify with the requirement and why it is unverifiable from here, rather than crawling the repository to chase it. The completeness critic verifies these against the integrated tree.',
  '',
  'When SIBLING FILES is provided and a criterion is unsatisfiable in the diff ONLY because a sibling-owned file is absent at BASE, report a blocking issue that names the sibling file and the words "missing dependency edge" — do not instruct the implementer to create, duplicate, or delete the sibling-owned file.',
  '',
  "Plan-supplied code is not privileged: when the diff faithfully transcribes code from the approved plan and that code carries a genuine defect, report it rather than waiving it as spec-faithful. Prefix the detail plan-defect: — and route by blast radius. Task-local fix: report the finding at its true severity so the normal fix round applies it, and the fix carries the same plan-defect: disclosure. Cross-task interface surface (anything a sibling task Consumes from this task's Produces), or a boundary you cannot establish from this task's own inputs: report severity minor so it routes to the pre-merge gate — when in doubt, gate. When the diff already diverges from plan text under a disclosed plan-defect: concern, verify the disclosed fix against the criterion's intent and block only if the divergence is wrong or undisclosed — a lawful disclosed divergence is not missing evidence.",
  '',
  'Flag only issues worth fixing. Minor style nits that a linter would catch automatically are not worth flagging. Severity blocking means the task must not merge until fixed; minor is advisory.',
  '',
  'Return a single JSON object conforming to the reviewer verdict schema. No prose outside the JSON block. Your final message is your report: every line is a verdict or a finding carrying file:line evidence.',
].join('\n')

// Path placeholders are baked as literal <pluginRoot>/<runDir> tokens (so the
// prompt-drift pin sees source-identical text) and filled at dispatch time.
// Apply this ONLY to engine-authored text (GUARD + the baked prompts). Plan-
// authored spans — the task body, the plan's Global Constraints, its Interfaces
// — and reviewer-authored spans — the CANNOT-VERIFY checklist escalated by the
// per-task reviewers — pass through verbatim: a plan or a reviewer is free to
// quote the literal tokens (the plan that built this feature does), and
// rewriting that prose would silently hand the agent a mangled spec.
const fillPaths = (s) =>
  s.split('<pluginRoot>').join(ARGS.pluginRoot).split('<runDir>').join(ARGS.runDir)

// The completeness prompt splices reviewer-authored text into its MIDDLE, so it
// cannot simply be concatenated outside fillPaths the way globalConstraintsBlock
// is. The baked prompt carries this seam token instead (it is not a path, so
// fillPaths leaves it alone) and the dispatch site fills it AFTER substitution.
const CANNOT_VERIFY_SLOT = '{{CANNOT_VERIFY}}'
// Fill the seam with reviewer prose, verbatim. If the seam is ever missing the
// checklist is appended rather than silently dropped — losing an escalated
// CANNOT-VERIFY item would turn an unverified requirement into a false green.
const spliceCannotVerify = (prompt, checklist) =>
  prompt.indexOf(CANNOT_VERIFY_SLOT) === -1
    ? prompt + (checklist || '')
    : prompt.split(CANNOT_VERIFY_SLOT).join(checklist || '')

// Setup / merge / reconcile / completeness prompts (source: references/wave-merge.md)
// testInstruction: args.testCmd is mandatory (driver-stamped: knob or detection).
const testInstruction = 'run the project test command `' + testCmd + '`'

// The dedicated integration worktree (#84): the engine never mutates the
// session checkout. Stamp-named — the script knows args.stamp, not the
// runtime wf_<runId> — which puts it OUTSIDE the run-scoped glob
// (sweep_worktrees.sh --run <wf_runId> globs wf_<runId>-*, which can never
// match wf_<stamp>-integration). Since #108, `ultra_gate.py --approve`
// sweeps mechanically: every wf run id recorded across the stamp's gate
// calls PLUS wf_<stamp> (this worktree) — no additional SKILL.md-issued
// sweep call exists; on teardown the worktrees are kept as evidence. The
// completeness critic's sha-verified detach inside it doubles as the branch
// release the frozen ultra_gate.py --approve checkout needs (a critic that
// never detached reports BLOCKED, and a BLOCKED gate is never Approved).
const INTEGRATION_WT = '.claude/worktrees/wf_' + stamp + '-integration'

// {{BOOTSTRAP_LINE}} for the setup role — ONE sentence shared by both the fresh
// and the resume prompt. The resume path can also have to create the worktree
// (the branch survived a redirect, its worktree did not), and a freshly created
// tree has no dependencies either; "after creating it" makes the install a no-op
// on the reuse branch of that fork.
const setupBootstrapLine = bootstrapCmd
  ? ('WORKTREE SETUP: after creating it, run `' + bootstrapCmd +
     '` inside ' + INTEGRATION_WT + ' — fresh worktrees have no installed ' +
     'dependencies, and merge agents run the test suite there. ')
  : ''

const SETUP_PROMPT = resume
  ? ('You are the setup agent. The EXISTING integration branch ' + integrationBranch +
     ' must already exist; report BLOCKED if it does not, and do not create a new ' +
     'branch. Materialize its dedicated worktree: if ' + INTEGRATION_WT + ' already ' +
     'exists, check out ' + integrationBranch + ' inside it. Before that checkout, ' +
     'verify the reused worktree is clean (git status --porcelain); if it is dirty, ' +
     'report BLOCKED with the porcelain output — never absorb pre-existing dirt into ' +
     "the run's diff. If " + INTEGRATION_WT + ' does not exist, run ' +
     'git worktree add ' + INTEGRATION_WT + ' ' + integrationBranch + ' from the ' +
     'session repo root. ' + setupBootstrapLine +
     'Then establish the test baseline inside ' + INTEGRATION_WT +
     ': ' + testInstruction + ' and record whether it passes. ' +
     'Report the branch name, its HEAD sha, and the baseline result in your JSON result.')
  : ('You are the setup agent. The engine never mutates the session checkout: ' +
     'create the dedicated integration worktree instead. First check the target ' +
     'path: if ' + INTEGRATION_WT + ' already exists — a directory of any kind, ' +
     'even empty — refuse: create nothing, never adopt, clear, or reuse an ' +
     'existing directory, and never work around a git worktree add refusal. To ' +
     'refuse, report headSha as the empty string and put BLOCKED: ' +
     INTEGRATION_WT + ' exists — remove it with sweep_worktrees.sh --run wf_' +
     stamp + ' in branch; never report a real branch name or sha for a worktree ' +
     'you did not create. Otherwise, from the session repo root run: ' +
     'git worktree add ' + INTEGRATION_WT + ' -b ' + integrationBranch +
     (baseBranch ? (' ' + baseBranch) : '') + '. ' + setupBootstrapLine +
     'Then establish the test baseline inside ' + INTEGRATION_WT + ': ' +
     testInstruction + ' and record whether it passes. ' +
     'Report the branch name, its HEAD sha, and the baseline result in your JSON result.')

// #114: every sha the controller consumes used to reach it as model-typed JSON,
// so a fabricated or truncated tail defeated the ancestry check silently. The
// merge-side roles DERIVE the values instead: `git rev-parse` redirected into a
// <runDir>/heads/ slot. Both MERGE_PROMPT and RECONCILE_PROMPT report MERGED
// heads, so the sentence is baked verbatim into each — the drift pin matches a
// BAKE block against CONTIGUOUS text in this file, so a shared const would break
// it. <runDir> is a baked literal token filled by fillPaths() at dispatch.
const MERGE_PROMPT =
  'You are the wave merge agent, operating ONLY inside the dedicated integration ' +
  'worktree at ' + INTEGRATION_WT + ' — never the session main checkout. cd into ' +
  'it; echo git rev-parse HEAD and git branch --show-current; if the branch is ' +
  'not the integration branch you were asked to operate on, report BLOCKED and ' +
  'merge nothing — do not detach or move any other checkout. Merge each reported ' +
  'branch in the given task-index order (deterministic, so conflicts are ' +
  'reproducible). After all merges succeed, ' + testInstruction + '. Report ' +
  'MERGED with the final HEAD sha, or CONFLICT / TEST_FAILED with the conflict ' +
  'diff or failing output. Before you report, record heads mechanically: run ' +
  'mkdir -p <runDir>/heads, then for each task branch you merged run git ' +
  'rev-parse <branch> > <runDir>/heads/task-<taskId>, then git rev-parse HEAD > ' +
  '<runDir>/heads/wave-<waveNumber>. Shell redirection only — never type a sha ' +
  'by hand.'

const RECONCILE_PROMPT =
  'You are the reconciliation agent for ' + integrationBranch + ', operating ONLY ' +
  'inside the dedicated integration worktree at ' + INTEGRATION_WT + ' — never ' +
  'the session main checkout. cd into it; echo git rev-parse HEAD and git branch ' +
  '--show-current; if the branch is not the integration branch you were asked to ' +
  'operate on, report BLOCKED and merge nothing — do not detach or move any ' +
  'other checkout. You are given a merge conflict diff or failing test output. ' +
  'Resolve it on the integration branch, then ' + testInstruction + '. Report ' +
  'MERGED on success, or CONFLICT / TEST_FAILED with detail if you cannot resolve it. ' +
  'Before you report, record heads mechanically: run mkdir -p <runDir>/heads, ' +
  'then for each task branch you merged run git rev-parse <branch> > ' +
  '<runDir>/heads/task-<taskId>, then git rev-parse HEAD > ' +
  '<runDir>/heads/wave-<waveNumber>. Shell redirection only — never type a sha ' +
  'by hand.'

// The prompt constants above cannot know which tasks a given wave merged, so each
// dispatch appends the concrete slot names built from the ids/wave number in scope
// there — the agent infers nothing. Oxford-comma list, matching wave-merge.md.
const headsSlotsLine = (mergedResults, waveNumber) => {
  const slots = mergedResults.map((r) => 'heads/task-' + r.task)
  slots.push('heads/wave-' + waveNumber)
  const last = slots.pop()
  const list = slots.length > 1 ? (slots.join(', ') + ', and ' + last)
    : slots.length === 1 ? (slots[0] + ' and ' + last)
      : last
  return 'For this wave that means slots: ' + list + '.'
}

// ── Contended (frontier) merge contract — baked from references/wave-merge.md
// (BAKE:CONTENDED_MERGE_PROMPT). Built per-dispatch because the wave base is
// ENGINE-AUTHORED: waveBaseSha advances only AFTER a merge, so at dispatch time
// it is exactly the previous integration head, and the agent derives nothing.
// The CLI is located through the <pluginRoot> token fillPaths() fills (same
// precedent as review-package). The heads/ slot sentence is carried verbatim
// from MERGE_PROMPT — the completeness critic treats a missing slot as an
// ancestry miss, so a contended prompt without it would block every contended run.
// waveDir is ENGINE-AUTHORED too: cmd_fold's stdout is scalars only
// ({clean, conflicts, dispatchable, parked, selfChecks}), so foldLogPath,
// conflictsIndex and each conflict's narrationFile exist only on disk. The prompt
// names the directory and the conflict-<i>.txt convention and puts reading its
// conflicts.json in contract — otherwise the agent must either guess a path
// (dispatching a resolver at a file that does not exist) or, obeying the
// no-invention clause literally, omit `open` entirely and fall every conflicted
// wave back with empty evidence pointers.
// The four paragraphs are joined (not '\n'-concatenated inside a literal) so the
// baked text reads contiguously in source — the drift pin matches across the line
// break, and a literal \n between them would break that match.
const contendedMergePrompt = (prevHead, waveDir) => [
  'You are the wave merge agent running the contended contract, operating ONLY ' +
  'inside the dedicated integration worktree at ' + INTEGRATION_WT + ' — never ' +
  'the session main checkout. cd into it; echo git rev-parse HEAD and git branch ' +
  '--show-current; if the branch is not the integration branch you were asked to ' +
  'operate on, report BLOCKED and merge nothing — do not detach or move any ' +
  "other checkout. This wave's tasks edit the same files on purpose, so you do " +
  'not merge their branches: you drive the deterministic fold CLI at ' +
  '<pluginRoot>/skills/ultrapowers/kernel/fold_wave.py, which moves no ref and ' +
  'writes nothing into the worktree. Run every invocation from inside ' +
  INTEGRATION_WT + ' with --repo . so the CLI reads this worktree\'s repository. ' +
  'The wave base — the fold base, and <prevHead> in the sequences below — is ' +
  (prevHead || '') + "; never derive it yourself. This wave's fold directory — " +
  'the one the CLI writes its fold log, its conflicts index and its narrations ' +
  'into — is ' + (waveDir || '') + '; never derive that either. Exactly one STEP ' +
  'applies to this dispatch: the STEP line appended below names it and gives the ' +
  'exact command to run. Run that command and no other, then report its stdout ' +
  'JSON as your own fields. Reading is otherwise limited to that fold directory: ' +
  'a STEP may send you to its conflicts index conflicts.json, its fold log ' +
  'fold_log.jsonl, or a narration file, and those reads are in contract. Report ' +
  'nothing you did not either read there or read from stdout — never a count, a ' +
  'sha or a path you invented. A non-zero exit is never ' +
  'something to work around — report the failure verbatim and stop.',
  'STEP fold: report FOLDED when the CLI prints conflicts 0, CONFLICTS when it ' +
  'prints conflicts and every indexed conflict is dispatchable, PARKED when any ' +
  'conflict is not dispatchable, and ERROR on a non-zero exit or a selfChecks ' +
  'value other than ok. Copy conflicts, dispatchable, parked and selfChecks from ' +
  'the JSON. The CLI prints no paths, so take them from the fold directory it ' +
  'just wrote: report foldLogPath as ' + (waveDir || '') + '/fold_log.jsonl and ' +
  'conflictsIndex as ' + (waveDir || '') + '/conflicts.json. Time the invocation ' +
  'and report its wall clock in foldCliWallTimeSec. Then read ' + (waveDir || '') +
  '/conflicts.json — an array whose entries carry i, path, kind, dispatchable, ' +
  'reason and epoch — and for each entry whose dispatchable is true add an open ' +
  "entry carrying that entry's path, that entry's epoch, and as narrationFile " +
  'the file holding its narration, which is ' + (waveDir || '') +
  "/conflict-<i>.txt for that same entry's i.",
  'STEP resolve: report FOLDED when the CLI prints applied true. When it prints ' +
  'stale true, report CONFLICTS with exactly one open entry carrying the same ' +
  'path, the epoch the CLI returned, and its renarrationFile as narrationFile — ' +
  'that re-narration is a markerless whole file, not an annotated one. Report ' +
  'ERROR on a non-zero exit.',
  'STEP adopt: run the materialize invocation. If it prints a park or a fallback ' +
  'verdict, report CONFLICT with that reason and change nothing. Otherwise take ' +
  'the candidateSha it printed and test that candidate with the branch unmoved: ' +
  'git read-tree -u --reset <candidate>^{tree} puts the candidate\'s tree in the ' +
  'worktree while HEAD and the branch ref stay at <prevHead> (a bare read-tree -u ' +
  'is a fatal git error, and merge --ff-only would refuse over the read-tree ' +
  'index). Then ' + testInstruction + '. If it passes, adopt the candidate with ' +
  'git reset --hard <candidate> and report MERGED with that sha as headSha. ' +
  'Before you report, record heads mechanically: run mkdir -p <runDir>/heads, ' +
  'then for each task branch you merged run git rev-parse <branch> > ' +
  '<runDir>/heads/task-<taskId>, then git rev-parse HEAD > ' +
  '<runDir>/heads/wave-<waveNumber>. Shell redirection only — never type a sha ' +
  'by hand. If instead the suite fails, adopt nothing and restore the worktree — ' +
  'git reset --hard <prevHead>, then git clean -fd — then report TEST_FAILED ' +
  'with the failing output and write no slots. Do not try to fix a failing ' +
  'candidate: the engine falls the wave back to an ordinary git merge, and that ' +
  'path refuses to operate on a dirty or detached worktree.',
].join('\n')

// Baked from references/wave-merge.md (BAKE:RESOLVER_PROMPT). Rewritten from the
// production cell's no-tools text-in/text-out brief for the file-read contract:
// the resolver reads its own narration file and writes a whole-file reply, and
// must accept BOTH narration shapes (annotated, and the markerless whole-file
// body a re-narration produces — re-folding an already-folded endpoint narrates
// nothing).
const RESOLVER_PROMPT = [
  'You are a merge-conflict resolver for one file in one wave. You have no repo ' +
  'to explore and no branch to check out: read exactly the narration file named ' +
  'below, write exactly the reply file named below, and touch nothing else. ' +
  'Never run git, never edit the file under conflict, and never create a commit. ' +
  'You are assigned no worktree of your own: the narration file and the reply ' +
  'file named below are your only sanctioned locations, and reading and writing ' +
  'them is not an exception to any worktree boundary — there is no worktree ' +
  'here to be an exception to.',
  'The narration arrives in one of two shapes and you must handle both. An ' +
  'ANNOTATED narration is the whole file with conflict markers naming each side ' +
  '— frontier is the work already folded in, a task id is the incoming change — ' +
  'and every unmarked line is already-merged content. A MARKERLESS narration is ' +
  'the whole file with no markers at all: it is a re-narration of a path that ' +
  'folded again after your last reply, so nothing is left to adjudicate except ' +
  'carrying your intent forward onto the newer content. The NARRATION line ' +
  'states which shape you were given; if it disagrees with the bytes you read, ' +
  'trust the bytes.',
  'Write the complete resolved file to the reply file: every line the merged ' +
  'file should contain, top to bottom, in order, with no conflict markers, and ' +
  'nothing invented that appears in neither side nor the narration. Preserve ' +
  'lines outside the conflicted blocks exactly as the narration shows them. The ' +
  'reply file is read back byte for byte and split by the kernel\'s own line ' +
  'convention, so a trailing newline in your reply is a trailing newline in the ' +
  'merged file — match the narration\'s ending. Write the file whole; never ' +
  'append to it, and never leave it empty unless the resolved file is genuinely ' +
  'empty.',
  "Honor both sides' intent where they are compatible; where they are not, " +
  'prefer the semantics the contending task bodies describe over surface text. ' +
  'Never drop a side silently — if the two sides are irreconcilable, still write ' +
  'your best whole-file merge and say so in notes; a human reads this transcript ' +
  'verbatim. Report RESOLVED once the reply file is written, or BLOCKED with the ' +
  'reason if you could not read the narration or could not write the reply. A ' +
  'BLOCKED resolver falls the whole wave back to an ordinary git merge, which is ' +
  'a real cost — report it only when you genuinely cannot produce a file.',
].join('\n')

// Completeness critic prompt, built per-dispatch so it pins the critic to the
// EXACT tree the run produced (waveBaseSha = the last wave's merge.headSha).
// #29: a critic that reviews the wrong tree emits confident false findings — the
// detached checkout is immune to the integration-branch lock, and an unreadable
// detach target forces BLOCKED rather than a guessed tree. Review-role: #32.
// #123: the detach target is DERIVED from the heads/ sidecar, stated first and
// as the single authority; waveBaseSha is model-transcribed and is demoted to a
// recorded cross-check, so a fabricated sha reads as an explicit
// recorded-vs-derived mismatch instead of an unexplained BLOCKED.
// Note the missing cannotVerifyChecklist parameter: the checklist is reviewer-
// authored, so it is NOT interpolated here. The baked text carries the
// CANNOT_VERIFY_SLOT seam and the dispatch site fills it after fillPaths().
const completenessPrompt = (mergeHeadSha, mergedShas) => {
  // #70: the integration ancestry assertion. The critic is already detached on the
  // integration HEAD, so it is the one role that can cheaply prove nothing the run
  // reported as merged was silently dropped. mergedShas carries every mergeable done
  // task's recorded headSha; the critic asserts each is an ancestor of HEAD and
  // returns the misses under ancestryMisses. Omitted when nothing merged.
  const ancestryBlock = (mergedShas && mergedShas.length)
    ? (' You are also given mergedShas, the recorded head sha of every mergeable ' +
       'done task. For each entry, assert that its commit landed in this integration ' +
       'tree by running git merge-base --is-ancestor <headSha> HEAD; return under ' +
       'ancestryMisses every task whose recorded head is not an ancestor of the ' +
       'current HEAD (an empty ancestryMisses when they all are). A recorded head ' +
       'that is not an ancestor is a silently dropped task, and the controller ' +
       'treats a non-empty ancestryMisses as BLOCKED. mergedShas: ' +
       JSON.stringify(mergedShas))
    : ''
  // The two preamble lines are joined (not '\n'-concatenated) so the baked text
  // reads contiguously in source — the wave-merge.md drift pin matches across
  // the line break, and a literal \n between them would break that match.
  return (
  ['You are a REVIEW role. Do not write files, create commits, stage changes, or ' +
   'modify the tree in any way. Your only output is your findings/verdict. If the ' +
   'work is wrong, report it — never fix it.',
   'Operate ONLY inside the dedicated integration worktree at ' + INTEGRATION_WT +
   ' — cd into it before any git command; never the session main checkout; your ' +
   'verified detach there also frees the integration branch for the gate.'].join('\n') + '\n' +
  (planPath ? ('Read the original plan document at ' + planPath + ' first. ') : '') +
  'First, put yourself on the exact tree the run produced, and derive that tree — ' +
  'never detach at a sha typed into this prompt. Read <runDir>/heads/ and take ' +
  'the highest-numbered wave-<n> slot: the sha in that slot is <derived>, your ' +
  'detach target. If no wave-<n> slot there is readable, report BLOCKED and ' +
  'produce no findings — do not guess a tree. Otherwise run git checkout --detach ' +
  '<derived>, then git rev-parse HEAD and confirm it equals <derived>; if it does ' +
  'not, report BLOCKED and produce no findings. Only then cross-check the value ' +
  'the run recorded, which is context and not authority: the recorded merge sha ' +
  'is ' + (mergeHeadSha || '') + '. If that recorded value is non-empty and ' +
  'differs from <derived>, report BLOCKED with a finding that names both, written ' +
  'exactly as: recorded merge sha <recorded> != derived heads/ slot <derived>. ' +
  'Only once you are verified on that tree: what plan requirement is ' +
  'unmet? What claim is unverified? What code path is untested? ' + testInstruction +
  ', then review the integrated result against the original plan. ' + CANNOT_VERIFY_SLOT +
  'When GLOBAL CONSTRAINTS are provided, verify each one holds across the whole integrated tree, ' +
  'not task by task — a worktree-isolated per-task reviewer could only confirm its own slice; ' +
  'list any constraint the integrated result violates as a blocking gap. ' +
  'List every gap, unverified claim, and untested path. ' +
  'After confirming HEAD equals the recorded merge sha, set onIntegrationHead true in ' +
  'your result (false if you could not confirm it). Read the plan at the provided ' +
  'planPath; for every task reported failed or blocked, check whether its declared ' +
  'Create: paths exist in the tree — list any that are genuinely absent as missing ' +
  'deliverables. For any deliverable that is present and structurally complete but ' +
  'whose behavior the sandbox could not execute, list it under deferredVerification ' +
  'as an object { deliverable, reason, why }, where reason is one of ' +
  "'browser' (a live UI), 'runtime' (a target runtime the sandbox cannot run — " +
  "process boot, device, deploy target), 'external' (an unreachable " +
  "service/credential/network), or 'manual' (requires human judgment), so the gate " +
  'can route runtime/external items to an explicit acknowledgement.' + ancestryBlock +
  // #114: the shas quoted above (and in ancestryBlock) are model-transcribed —
  // a fabricated tail would pass an ancestry check against a sha that never
  // existed. The heads/ sidecars the merge-side roles derived are the authority;
  // a missing slot for a merged task is itself the failure signal.
  ' Authoritative shas live in <runDir>/heads/: read task-<id> for each merged ' +
  'task id in your inputs, and the highest-numbered wave-<n> slot is your detach ' +
  'target. Treat a missing or malformed slot for a merged task exactly as an ' +
  'ancestry miss. Sha values quoted elsewhere in this prompt are context, not ' +
  'authority.'
  )
}

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
  },
}
// The contended merge contract's fold/resolve replies. MERGE_SCHEMA is
// status/headSha/detail and cannot carry the CLI's counts, so this is its
// sibling — small scalars plus the per-conflict coordinates the engine needs to
// dispatch resolvers (all CLI payloads stay on disk; agents relay only paths,
// counts, and enum verdicts, #36). The ADOPTION reply deliberately rides
// MERGE_SCHEMA instead, so the call site's MERGED + headSha handling is unchanged.
const FOLD_SCHEMA = {
  type: 'object',
  required: ['status'],
  properties: {
    status: { enum: ['FOLDED', 'CONFLICTS', 'PARKED', 'ERROR'] },
    conflicts: { type: 'integer' },
    dispatchable: { type: 'integer' },
    parked: { type: 'integer' },
    selfChecks: { type: 'string' },
    foldLogPath: { type: 'string' },
    conflictsIndex: { type: 'string' },
    foldCliWallTimeSec: { type: 'number' },
    // One entry per conflict still open: where its narration lives and the epoch
    // the resolution must be valid against. A stale `resolve` returns exactly one
    // entry here — the markerless re-narration.
    open: { type: 'array', items: { type: 'object',
      required: ['path', 'epoch', 'narrationFile'], properties: {
      path: { type: 'string' },
      epoch: { type: 'integer' },
      narrationFile: { type: 'string' } } } },
    detail: { type: 'string' },
  },
}
const RESOLVER_SCHEMA = {
  type: 'object',
  required: ['status'],
  properties: {
    status: { enum: ['RESOLVED', 'BLOCKED'] },
    notes: { type: 'string' },
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
    testsPassed: { type: 'boolean' },
    output: { type: 'string' },
    findings: { type: 'array', items: { type: 'string' } },
    // #29: the critic's own git-verified ground truth. onIntegrationHead is true
    // iff it confirmed (via git rev-parse HEAD) it reviewed the recorded merge
    // HEAD; false means it could not — possible checkout drift. deferredVerification
    // lists deliverables present-and-structurally-complete but whose behavior the
    // sandbox could not execute, each tagged with a reason so the gate can route
    // runtime/external items to an explicit acknowledgement.
    onIntegrationHead: { type: 'boolean' },
    deferredVerification: { type: 'array', items: { type: 'object',
      required: ['deliverable', 'reason'], properties: {
      deliverable: { type: 'string' },
      reason: { type: 'string', enum: ['browser', 'runtime', 'external', 'manual'] },
      why: { type: 'string' } } } },
    // #70: the integration ancestry misses. Each entry is a mergeable done task
    // whose recorded headSha the critic could NOT confirm is an ancestor of the
    // integration HEAD (git merge-base --is-ancestor failed) — a silent drop. A
    // non-empty ancestryMisses forces the run BLOCKED (gitVerified withheld).
    ancestryMisses: { type: 'array', items: { type: 'object',
      required: ['task', 'headSha'], properties: {
      task: { type: 'string' },
      headSha: { type: 'string' } } } },
  },
}

// Model tiers. reviewer-prompts.md names them cheap / standard / most-capable;
// the workflow agent() API takes Claude aliases haiku / sonnet / opus. Verified
// live (2026-06-03): small/medium/large are rejected as invalid models, so the
// agent returns an error instead of doing the work. Map in ONE place here.
const DEFAULT_TIER = { cheap: 'haiku', standard: 'sonnet', mostCapable: 'opus' }
const TIER = DEFAULT_TIER
// Plans may name the top tier 'most-capable' (dependency-analysis) or 'mostCapable'
// (this map); normalize so both resolve. Unknown tiers fall back to standard.
const tierKey = (t) => (t === 'most-capable' ? 'mostCapable' : t)
// Escalate a tier name one rung for the single post-error retry; the top tier
// (and any unknown tier) retries in place, so every agent-error yields exactly
// one retry. Mirrors the DEFAULT_TIER ladder; tierKey normalizes 'most-capable'.
const TIER_LADDER = ['cheap', 'standard', 'mostCapable']
const escalateTier = (t) => {
  const i = TIER_LADDER.indexOf(tierKey(t))
  if (i === -1) return 'mostCapable'
  return TIER_LADDER[Math.min(i + 1, TIER_LADDER.length - 1)]
}
// Classify an agent() fault so the single retry uses the right lever.
// A StructuredOutput/schema contract trip is capability-fixable — a stronger
// model is the documented win. Everything else (a transient fault, or an
// Overloaded null-return surfaced as an AGENT_NULL throw) is NOT capability-
// fixable: a more-contended top tier just re-hits the wall, so retry in place.
const isSchemaTrip = (msg) =>
  /schema|structuredoutput|did not conform|required propert|invalid (?:enum|json)/i.test(msg)
// A structural fault — an import/module that resolves to nothing — usually means
// a sibling deliverable this task depends on is absent (a missing Depends-on
// edge), which no model capability fixes. Diagnose it; do NOT fail-fast.
const looksStructural = (msg) =>
  /cannot find module|module not found|no module named|importerror|cannot import|is not defined/i.test(msg)
// Review / completeness roles always run at the strongest model, unconditionally —
// a weak reviewer's failure mode is the silent false PASS, so it must never be
// downgradable. (Reconcile is a fixer, not a reviewer, so it tracks the
// implementer-side mostCapable.)
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

// The fresh-worktree bootstrap, wrapped with the warm dependency cache. The agent
// first tries `warm_cache.sh restore <lockfile> <target>` (a near-instant
// hardlink-clone of the prebuilt deps); exit 0 = hit, exit 3 = miss/lockfile
// change → fall through to the real bootstrapCmd, then `warm_cache.sh populate
// <lockfile> <source>` to warm the cache for sibling worktrees. Correctness never
// depends on the cache (#2.3a). Only the FRESH worktree roles receive this; empty
// when no bootstrapCmd was supplied.
const bootstrapLine = bootstrapCmd
  ? ('\nWORKTREE SETUP: this is a fresh worktree with no installed dependencies. ' +
     'First try the warm cache: run `bash skills/ultrapowers/scripts/warm_cache.sh restore <lockfile> <target_dir>` ' +
     '(use the dependency lockfile and the directory deps install into for this stack). ' +
     'If it exits 0 the cache hit and deps are in place. If it returns exit 3 (cache miss or lockfile change), ' +
     'run the real install before building or testing: ' + bootstrapCmd +
     ' — then warm the cache for siblings: `bash skills/ultrapowers/scripts/warm_cache.sh populate <lockfile> <source_dir>`. ' +
     'If the script itself is absent (exit 127 — it ships with the ultrapowers plugin, not the target project), skip the cache steps and just run the real install. ' +
     'The cache is an optimization only; build and test normally whether it hit or missed.')
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

// Review depth per task — an AUTHORED plan property (ultraplan `**Review:**`),
// pre-emitted by compile_plan.py into every task's `review` slot ('lean' when
// unmarked). Force-up semantics: the run-wide reviewProfile:'adversarial' escape
// hatch can only raise depth, never lower an authored adversarial.
// (The heuristic era — RISK_PATH lexicon, isRiskSurface, contract-root
// detection — is deleted: #87. The render now reports a value the engine
// actually uses, by construction.)
const taskReviewProfile = (task) =>
  (task.review === 'adversarial' || reviewProfile === 'adversarial')
    ? 'adversarial' : 'lean'

// Per-task reviewer model: uniformly most-capable, unconditionally. (The
// lean+cheap sonnet floor is deleted with the heuristics — never economize on
// the checker.)
const reviewerModelFor = () => DEFAULT_TIER.mostCapable

// ── Per-task pipeline: implement → review → bounded fix-loop ──────────────────
// A thrown agent() call (engine fault, schema failure, transient error) must
// cost ONE task, never the run: parallel() is fail-fast, so an uncaught throw
// in a 16-wide wave would reject the whole wave and lose the report.
const resolvedModel = (name) => {
  const v = Object.prototype.hasOwnProperty.call(TIER, tierKey(name)) ? TIER[tierKey(name)] : undefined
  return (typeof v === 'string') ? v : TIER.standard
}
async function runTask(task, baseSha, siblings) {
  try {
    return await runTaskInner(task, baseSha, siblings)
  } catch (e) {
    const msg = String((e && e.message) || e)
    // Default the one retry to the SAME tier; escalate one rung ONLY for a
    // capability-fixable schema trip. Never escalate an Overloaded/null fault.
    const capabilityFixable = isSchemaTrip(msg)
    const retryTier = capabilityFixable ? escalateTier(task.tier) : (task.tier || 'standard')
    if (looksStructural(msg)) {
      judgmentCalls.push('task ' + task.id + ': agent error looks structural (' + msg +
        ') — looks like a missing Depends-on edge; a tier change will not fix it')
    }
    judgmentCalls.push('task ' + task.id + ': agent error at ' + (task.tier || 'standard') +
      ' — retrying once at ' + retryTier +
      (capabilityFixable ? ' (schema trip → escalate)' : ' (same tier)') + ': ' + msg)
    log('task ' + task.id + ' agent error — retrying at ' + retryTier)
    try {
      const res = await runTaskInner(task, baseSha, siblings, retryTier)
      judgmentCalls.push('task ' + task.id + ': recovered after ' +
        (capabilityFixable ? 'escalation to ' : 'same-tier retry at ') + retryTier)
      return res
    } catch (e2) {
      const msg2 = String((e2 && e2.message) || e2)
      judgmentCalls.push('task ' + task.id + ': agent error after ' +
        (capabilityFixable ? 'escalation to ' : 'same-tier retry at ') + retryTier + ' — ' + msg2)
      log('task ' + task.id + ' FAILED after retry: ' + msg2)
      return { task: task.id, status: 'failed', reviewVerdict: 'agent-error',
               notes: msg2, tier: resolvedModel(retryTier),
               review: taskReviewProfile(task), fixIterations: 0 }
    }
  }
}
async function runTaskInner(task, baseSha, siblings, tierOverride) {
  // Own-string lookup only: a prototype name like 'constructor' must never
  // resolve to an inherited function and ship as a model identifier. An
  // escalation retry passes tierOverride, which supersedes task.tier here.
  const tierName = (typeof tierOverride === 'string') ? tierOverride : task.tier
  const tierValue = Object.prototype.hasOwnProperty.call(TIER, tierKey(tierName))
    ? TIER[tierKey(tierName)] : undefined
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
    fillPaths(GUARD + '\n\n' + IMPLEMENTER_PROMPT) + '\n\nBASE: ' + baseSha + testCmdLine(task) + bootstrapLine + filesLine(task) + siblingsStr + globalConstraintsBlock + interfacesLine(task) + taskBodyBlock(task),
    { label: 'impl:' + task.id, isolation: 'worktree', model: baseModel, schema: IMPLEMENTER_SCHEMA }
  )
  // agent() RETURNS null (not throws) on terminal Overloaded/skip. Surface it as
  // a tagged throw so the single retry routes it to the SAME tier (it is not a
  // schema trip) instead of letting a null-deref blind-escalate a contention
  // failure to a more-contended top model.
  if (impl === null) throw new Error('AGENT_NULL: implementer agent returned null (terminal Overloaded or skipped)')
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
    const reviewPrompt = fillPaths(GUARD + '\n\n' + REVIEWER_PROMPT) +
      taskBodyBlock(task) + '\nBRANCH: ' + impl.branch + '\nHEAD: ' + impl.headSha +
      '\nBASE: ' + baseSha + filesLine(task) + siblingsStr + globalConstraintsBlock + interfacesLine(task)
    const reviewOpts = (pass) => ({
      label: 'review:' + task.id + ':' + iter + (pass ? ':' + pass : ''),
      model: reviewerModelFor(task), schema: REVIEWER_SCHEMA,
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
      return { task: task.id, status: 'done', branch: impl.branch,
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
      fillPaths(GUARD + '\n\n' + IMPLEMENTER_PROMPT) + '\n\nBASE: ' + impl.headSha + testCmdLine(task) + bootstrapLine + filesLine(task) + siblingsStr + globalConstraintsBlock + interfacesLine(task) + taskBodyBlock(task) +
        '\n\nFIX ROUND — the prior implementation of this task exists at commit ' + impl.headSha +
        ' (branch ' + impl.branch + ', locked by its own worktree — do not try to check it out).' +
        ' BASE above IS that commit: anchoring to BASE gives you the prior work to amend, not a blank slate.' +
        // The fix agent's own BASE..HEAD is only the delta on top of the prior round; a packet cut
        // from it hides the task's original implementation from the iter-2 reviewer. Anchor and
        // packet range are deliberately different refs here (#146).
        ' Generate your review packet for the FULL task range, not your BASE..HEAD: run review-package with base ' +
        baseSha + ' (the task base) and your committed HEAD. Your BASE above remains your anchor — the prior' +
        ' implementation to amend; only the packet range starts at the task base.' +
        // Typed sha vs. derived branch tip: if the engine's recorded headSha and the prior branch
        // have drifted apart, neither is a safe parent — surface it instead of guessing (#146).
        ' Before anchoring, derive the prior tip: run PRIOR=$(git rev-parse ' + impl.branch +
        '); if PRIOR differs from the BASE sha above, report BLOCKED naming both, written exactly as:' +
        ' typed prior sha <typed> != derived branch tip <derived> — never build on either.' +
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

// ── Contended (frontier) merge path ──────────────────────────────────────────
// The fold CLI, located through the <pluginRoot> token fillPaths() fills — the
// same precedent as review-package. All CLI I/O is file-based: agents relay only
// paths, counts, and enum verdicts (#36).
const KERNEL_CLI = 'python3 <pluginRoot>/skills/ultrapowers/kernel/fold_wave.py'
const frontierDir = (waveNumber) => '<runDir>/frontier/wave-' + waveNumber

// One report entry per wave that took the contended path — fallbacks included:
// the fold log and conflicts index exist either way, and the production canary
// harvests that directory, not the report alone. The key list of this builder is
// pinned against report-format.md by tests/test_report_runbook.py — every field
// emitted here must be documented there.
const frontier = []
const frontierEntry = (waveNumber, fold, transcripts) => ({
  wave: waveNumber,
  foldLogPath: (fold && fold.foldLogPath) || '',
  conflictsIndex: (fold && fold.conflictsIndex) || '',
  selfChecks: (fold && fold.selfChecks) || '',
  foldCliWallTimeSec: (fold && typeof fold.foldCliWallTimeSec === 'number')
    ? fold.foldCliWallTimeSec : null,
  resolverTranscripts: transcripts,
})

// Derived contention (spec §1): the compiler declares nothing. Two mergeable
// results whose WAVES[waveIdx] entries share a `files` path ARE a dropped
// eligible pair, by construction — every overlapping pair that was NOT dropped
// carries an edge, and Kahn layering separates edge-connected tasks into
// different waves. Under --overlap serialize (the shipped default) no wave can
// contain intersecting `files`, so this is inert there.
// The join is by `r.task === t.id`: a task result emits {task,status,branch,
// headSha,…} and no `files`, so reading `r.files` would find undefined and fail
// CLOSED — every contended wave silently taking the git-merge path with stubbed
// tests still green.
const contendedWave = (merged, waveIdx) => {
  if (resume) return false        // redirect, salvage, any future resume lane
  if (!waveBaseLive) return false // a frozen wave base would rewind the branch
  const wave = Array.isArray(WAVES[waveIdx]) ? WAVES[waveIdx] : []
  const fileSets = merged.map((r) => {
    const t = wave.find((x) => x && x.id === r.task)
    return (t && Array.isArray(t.files)) ? t.files : []
  })
  for (let i = 0; i < fileSets.length; i++) {
    for (let j = i + 1; j < fileSets.length; j++) {
      if (fileSets[i].some((f) => fileSets[j].indexOf(f) !== -1)) return true
    }
  }
  return false
}

// The contending tasks' intent, so the resolver can prefer semantics over
// surface text. PLAN-authored, so it is appended OUTSIDE fillPaths, like every
// other plan span (a plan is free to quote the literal <runDir> token).
const contendingTasksBlock = (waveTasks) => {
  const parts = waveTasks.map((t) => {
    const head = '\n- task ' + t.id + ': ' + (t.title || '') +
      ((Array.isArray(t.files) && t.files.length)
        ? (' [files: ' + t.files.join(', ') + ']') : '')
    return head + ((typeof t.body === 'string' && t.body.trim() !== '')
      ? ('\n' + t.body) : '')
  })
  return '\nCONTENDING TASKS:' + parts.join('') +
    (wavesPath
      ? ('\nTheir full verbatim task text lives in the JSON file at ' + wavesPath +
         ' — read the "tasks" array entry whose "id" matches.')
      : '')
}

// Returns the adoption result (MERGE_SCHEMA shape) when the candidate was
// adopted, or null to fall the wave back to the git-merge path. Fallback is live
// strictly before adoption: the fold consumes task branches but never destroys
// them, and the prompt restores the worktree on a red candidate, so the
// git-merge path is handed the branch and worktree exactly where it expects them.
async function contendedMerge(merged, waveIdx, slotsLine) {
  const waveNumber = waveIdx + 1
  // ENGINE-AUTHORED wave base: waveBaseSha advances only AFTER a merge, so at
  // dispatch time it is exactly the previous integration head.
  const prevHead = waveBaseSha
  const waveTasks = (Array.isArray(WAVES[waveIdx]) ? WAVES[waveIdx] : [])
    .filter((t) => t && merged.some((r) => r.task === t.id))
  const transcripts = []
  let fold = null
  // Single record point. Every fallback names its reason in judgmentCalls and the
  // log — the engine's existing failure-routing records; there is no separate
  // fallback event type in the fold log (one fact, one record).
  const finish = (outcome, reason) => {
    frontier.push(frontierEntry(waveNumber, fold, transcripts))
    if (!outcome) {
      judgmentCalls.push('wave ' + waveNumber + ': contended merge fell back to the ' +
        'git-merge path — ' + reason)
      log('wave ' + waveNumber + ' contended fallback: ' + reason)
    }
    return outcome
  }
  const dispatchMerge = (step, command, label, schema) => agent(
    fillPaths(GUARD + '\n\n' + contendedMergePrompt(prevHead, frontierDir(waveNumber)) +
      ' ' + slotsLine +
      '\nSTEP: ' + step + '. Run exactly this command, from inside ' +
      INTEGRATION_WT + ':\n' + command),
    { label: label, model: TIER.mostCapable, schema: schema })

  // Task-index order, matching the merge contract: completion order is not
  // observable to the engine, and determinism buys reproducible conflicts.
  const branchArgs = merged
    .map((r) => ' --branch ' + r.task + '=' + r.branch + ':' + r.headSha).join('')
  try {
    fold = await dispatchMerge('fold',
      KERNEL_CLI + ' fold --repo . --run-dir <runDir> --wave ' + waveNumber +
        ' --base ' + prevHead + branchArgs,
      'merge:wave' + waveNumber + ':fold', FOLD_SCHEMA)
  } catch (e) {
    return finish(null, 'fold dispatch threw: ' + String((e && e.message) || e))
  }
  // agent() RETURNS null (not throws) on a terminal Overloaded/skipped dispatch.
  // Unlike runTask, nothing wraps contendedMerge — mergeWave does not try/catch
  // its call and neither does the wave loop — so a null deref here would abort
  // the whole run and lose every already-merged wave. Fallback is the contract.
  if (!fold) return finish(null, 'fold dispatch returned no reply')
  if (fold.status === 'ERROR')
    return finish(null, 'fold reported ERROR: ' + (fold.detail || ''))
  if (fold.status === 'PARKED')
    return finish(null, 'fold parked an ineligible conflict: ' + (fold.detail || ''))
  // Unconditional: the fold STEP orders the agent to copy `selfChecks` from
  // the CLI's stdout, so an absent value is a contract violation, not a legal
  // shape — FOLD_SCHEMA requires only `status` because resolve replies share
  // it, and those never reach this call site (#145).
  if (fold.selfChecks !== 'ok')
    return finish(null, 'fold self-checks did not pass: ' +
      (fold.selfChecks || '(absent from the reply)'))
  // CONTENDED_MERGE_PROMPT's fold STEP orders the agent to copy `conflicts`
  // verbatim from the CLI's stdout for every reply — the CLI always emits it
  // for both fold verdicts, FOLDED and CONFLICTS alike (fold_wave.py:281-285;
  // 0 on a clean fold). ERROR and PARKED have already returned above, so the
  // only statuses that reach here are FOLDED and CONFLICTS, and resolve
  // replies share FOLD_SCHEMA but never reach this call site — so the check
  // below is unconditional, not FOLDED-only. A reply with no `conflicts`
  // scalar at all is not a legal shape of either verdict: it is a contract
  // violation the later count-vs-count guards below cannot catch, because
  // both of them go silent when the field is simply absent — a CONFLICTS
  // reply naming only a partial `open` list with no `conflicts` count would
  // otherwise resolve just that subset and adopt, silently dropping the rest.
  // Fall back rather than adopt a candidate whose only claim to being clean
  // is an enum with nothing behind it.
  if (typeof fold.conflicts !== 'number')
    return finish(null, 'fold reported ' + fold.status +
      ' with no conflicts count to verify against')
  // The counts are authority over the status enum: a parked conflict means the
  // frontier cannot be completed, whatever verdict the agent typed alongside it.
  if (typeof fold.parked === 'number' && fold.parked > 0)
    return finish(null, 'fold parked ' + fold.parked + ' conflict(s) — see the conflicts index')

  const open = (fold.status === 'CONFLICTS' && Array.isArray(fold.open)) ? fold.open : []
  if (fold.status === 'CONFLICTS' && open.length === 0)
    return finish(null, 'fold reported CONFLICTS but named no dispatchable conflict')
  // The counts are authority over the status enum on the OPEN side too, and this
  // is the load-bearing half: the resolver loop runs over `open`, so a FOLDED
  // verdict typed over a non-zero conflict count, or a CONFLICTS reply that lists
  // fewer open entries than it counted dispatchable, would skip resolution
  // entirely and adopt a candidate that silently drops the other task's edit on a
  // GREEN run. Nothing downstream catches that — materialize builds from the
  // engine's own manifest and the fold advances the frontier either way — and it
  // lands past the adoption boundary, where fallback is no longer live.
  // Two independent guards, because a mis-copied scalar breaks the very
  // consistency the other guard would have to assume. First: any non-zero
  // conflict total with nothing to resolve is unresolvable here, whatever the
  // status enum or dispatchable says — this catches the FOLDED-over-conflicts
  // reply, whose empty `open` makes every count-vs-count comparison agree.
  if (typeof fold.conflicts === 'number' && fold.conflicts > 0 && open.length === 0)
    return finish(null, 'fold counted ' + fold.conflicts +
      ' conflict(s) but named none to resolve')
  // Second: the named conflicts must match the count of resolvable ones. Prefer
  // the narrower count, fall back to the total when a reply omits it.
  const expectOpen = (typeof fold.dispatchable === 'number') ? fold.dispatchable
    : ((typeof fold.conflicts === 'number') ? fold.conflicts : null)
  if (expectOpen !== null && open.length !== expectOpen)
    return finish(null, 'fold named ' + open.length + ' open conflict(s) but counted ' +
      expectOpen + ' still to resolve')

  // Serial resolver loop — one agent at a time, awaited, so serialization is by
  // construction. Every existing dispatch site is budget-checkpointed and an
  // N-conflict loop must be too; exhaustion routes to fallback, still live here.
  for (let i = 0; i < open.length; i++) {
    let entry = open[i]
    for (let attempt = 1; attempt <= 2; attempt++) {
      if (budgetExhausted())
        return finish(null, 'budget exhausted before resolving conflict ' +
          (i + 1) + ' of ' + open.length)
      // Substituted at construction, not only inside the dispatch's fillPaths():
      // this same string is recorded in the resolver transcript, and that
      // transcript is the A/B grading surface. A literal <runDir> token there is
      // a path nobody can open — sitting beside a narrationFile that IS a real
      // path (it comes back from the fold reply), so the record would be half
      // resolvable. fillPaths is idempotent over an already-filled string, so the
      // dispatched prompt is byte-identical either way.
      const replyFile = fillPaths(frontierDir(waveNumber) +
        '/reply-' + (i + 1) + '-' + attempt + '.txt')
      let res
      try {
        // Verified live 2026-08-13, by this task's first build pass (scratch
        // Dynamic Workflow on this runtime; recorded in commit 887492e, salvaged
        // here): agent() ACCEPTS an options object with the `model` key omitted —
        // the probe arm { label, schema } and the control arm { label, model,
        // schema } both returned their schema-conformant reply, no error. So the
        // resolver runs at the session-ambient model: like-for-like with the
        // graded production cell, whose resolver ran on its CLI default. (The
        // spec's pre-stated fallback — dispatch at TIER.standard and amend the §6
        // honesty text — is NOT taken; omission was not rejected.) Re-verify with
        // a probe if a future runtime changes the accepted options shape, exactly
        // as the model-identifier note in references/workflow-template.md asks.
        res = await agent(
          fillPaths(GUARD + '\n\n' + RESOLVER_PROMPT +
            '\nNARRATION: ' + entry.path + ' — ' +
            (attempt === 1 ? 'ANNOTATED' : 'MARKERLESS') +
            ' — read it from ' + entry.narrationFile +
            '\nREPLY FILE: write your whole resolved file to ' + replyFile) +
            contendingTasksBlock(waveTasks),
          { label: 'resolve:wave' + waveNumber + ':' + (i + 1) + ':' + attempt,
            schema: RESOLVER_SCHEMA })
      } catch (e) {
        return finish(null, 'resolver dispatch threw on ' + entry.path + ': ' +
          String((e && e.message) || e))
      }
      // Null (terminal Overloaded/skipped) — same reason as the fold guard above:
      // no wrapper converts it, so it must route to fallback, not a TypeError.
      if (!res) return finish(null, 'resolver dispatch returned no reply on ' + entry.path)
      // Recorded verbatim: the resolver transcripts are the A/B grading surface.
      transcripts.push({ conflict: i + 1, attempt: attempt, path: entry.path,
        epoch: entry.epoch, narrationFile: entry.narrationFile,
        replyFile: replyFile, status: res.status, notes: res.notes || '' })
      if (res.status !== 'RESOLVED')
        return finish(null, 'resolver reported ' + res.status + ' on ' + entry.path)
      let applied
      try {
        applied = await dispatchMerge('resolve',
          KERNEL_CLI + ' resolve --repo . --run-dir <runDir> --wave ' + waveNumber +
            ' --path ' + entry.path + ' --epoch ' + entry.epoch +
            ' --reply-file ' + replyFile,
          'merge:wave' + waveNumber + ':apply' + (i + 1) + ':' + attempt, FOLD_SCHEMA)
      } catch (e) {
        return finish(null, 'resolve dispatch threw on ' + entry.path + ': ' +
          String((e && e.message) || e))
      }
      if (!applied)
        return finish(null, 'resolve dispatch returned no reply on ' + entry.path)
      if (applied.status === 'FOLDED') break
      // Stale: an intervening fold touched the path. Re-narrate ONCE — the
      // re-narration is a markerless whole-file body, not an annotated one.
      if (applied.status === 'CONFLICTS' && attempt === 1 &&
          Array.isArray(applied.open) && applied.open.length) {
        entry = applied.open[0]
        continue
      }
      return finish(null, 'resolution of ' + entry.path + ' not applied (' +
        applied.status + '): ' + (applied.detail || ''))
    }
  }

  const headArgs = merged.map((r) => ' --task-head ' + r.task + '=' + r.headSha).join('')
  let adopt
  try {
    adopt = await dispatchMerge('adopt',
      KERNEL_CLI + ' materialize --repo . --run-dir <runDir> --wave ' + waveNumber +
        ' --prev-head ' + prevHead + headArgs,
      'merge:wave' + waveNumber + ':adopt', MERGE_SCHEMA)
  } catch (e) {
    return finish(null, 'adoption dispatch threw: ' + String((e && e.message) || e))
  }
  // Null before adoption: the branch has not moved, so fallback is still live.
  if (!adopt) return finish(null, 'adoption dispatch returned no reply')
  // MERGED is the adoption boundary: the branch has moved, so falling back here
  // would hand the reconcile path a tree it was not promised. A MERGED without a
  // headSha rides the existing call-site branch (which freezes the review base and
  // clears waveBaseLive) exactly as it does on the git-merge path.
  if (adopt.status === 'MERGED') return finish(adopt, '')
  return finish(null, 'candidate not adopted (' + adopt.status + '): ' + (adopt.detail || ''))
}

// ── Wave merge (NON-isolated; reconciliation cap 2) ──────────────────────────
async function mergeWave(results, waveIdx) {
  // Caller guarantees ≥1 mergeable result (the SKIPPED path filters empty waves).
  const merged = results.filter(isMergeable)
  const branchList = merged
    .map((r, i) => i + '. task=' + r.task + ' branch=' + r.branch + ' sha=' + (r.headSha || ''))
    .join('\n')
  // #114: the concrete heads/ slots THIS wave must write. Engine-authored, so it
  // rides inside fillPaths() with the prompt; the ids come from control flow.
  const slotsLine = headsSlotsLine(merged, waveIdx + 1)
  if (contendedWave(merged, waveIdx)) {
    const adopted = await contendedMerge(merged, waveIdx, slotsLine)
    // Fallback (null) drops through to the git-merge path below with the branch
    // and worktree where it expects them; contendedMerge already named the reason.
    if (adopted) return adopted
  }
  let merge
  try {
    merge = await agent(
      fillPaths(GUARD + '\n\n' + MERGE_PROMPT + ' ' + slotsLine) +
        '\nMerge in this order:\n' + branchList,
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
        fillPaths(GUARD + '\n\n' + RECONCILE_PROMPT + ' ' + slotsLine) +
          '\nFailure:\n' + (merge.detail || ''),
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
    tests: { command: testCmd, passed: false, output: 'not run — budget exhausted before setup' },
    baseline: {},
    waveMerges: [],
    coverage: { tasks_merged: 0, tasks_planned: WAVES.flat().length, complete: false },
    missingDeliverables: [],
    gitVerified: false,
    deferredVerification: [],
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
// Defined here, RUN below — after the W2 roadmap pre-registration. An agent
// dispatched before any phase() call creates an implicit unnamed group
// ("Phase 0") that permanently sorts ABOVE Setup (#setup-at-bottom); running
// after the roadmap groups the preflight under the active Setup phase.
const bodylessIds = WAVES.flat()
  .filter((t) => !(typeof t.body === 'string' && t.body.trim() !== ''))
  .map((t) => String(t.id))
async function preflightWavesFile() {
  if (!(wavesPath && bodylessIds.length > 0)) return
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


// W2: pre-register every phase up front so the live roadmap shows all phases as
// pending, not one-at-a-time — and in EXECUTION ORDER. phase() is keyed by title
// — re-calling a title re-activates its existing group box (engine: same phase
// string → same group box) IN PLACE; it does not move it. The engine lists
// phases in FIRST-registration order, so the phase that runs first must be
// registered first. Setup runs first: registering it AFTER the waves (as the
// pre-register change first did) sorted the early-running Setup to the BOTTOM of
// the list (#setup-at-bottom). So register Setup first, then the waves, then
// Integration Review — and re-activate Setup just before its agent so the setup
// progress groups under it without disturbing its top position. FALLBACK (if a
// live run shows the roadmap reordering/duplicating rather than pre-listing):
// replace this block with one log() line —
//   log('Roadmap: Setup · ' + WAVES.map((_, w) => waveLabel(w)).join(' · ') + ' · Integration Review')
// and leave the per-wave phase() activation below unchanged.
phase('Setup')
for (let w = 0; w < WAVES.length; w++) phase(waveLabel(w))
phase('Integration Review')
phase('Setup')
// The wavesPath preflight runs here — after the roadmap, under the active Setup
// phase — so its agent never mints a pre-Setup "Phase 0" group (#setup-at-bottom).
await preflightWavesFile()
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
// Is waveBaseSha still the LIVE integration head? A schema-legal MERGED-without-
// headSha reply freezes it while the branch genuinely advances — a tolerated soft
// failure on the git-merge path (the next merge reconciles by content), but the
// contended path builds its candidate FROM waveBaseSha, so a frozen base would
// rewind the integration branch over the prior wave's merge and end the run
// BLOCKED at the ancestry check, loud but late and expensive. Sticky across waves
// by design, so it also covers a contended wave that itself adopts and reports
// without a headSha. Wave 1 is never affected: setup is already hard-gated on one.
let waveBaseLive = true
// #70: accumulate the recorded {task, headSha} of every mergeable done task from
// each successfully-merged wave. After the final merge the completeness critic
// asserts each headSha is an ancestor of the integration HEAD (nothing silently
// dropped); a miss forces the run BLOCKED.
const mergedShas = []
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
      judgmentCalls.push(BUDGET_DEFERRED_NOTE)
    }
    continue
  }
  phase(waveLabel(w))
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
        judgmentCalls.push(BUDGET_DEFERRED_NOTE)
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
      judgmentCalls.push(BUDGET_DEFERRED_NOTE)
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
    detail: merge.detail,
    // Task branches submitted to the merge agent — accurate whether or not the
    // merge succeeded (do not imply success: a CONFLICT wave still lists them).
    branches: results.filter(isMergeable).map((r) => r.task),
  })
  if (merge.status === 'DEFERRED') {
    if (!budgetDeferred) {
      budgetDeferred = true
      judgmentCalls.push(BUDGET_DEFERRED_NOTE)
    }
    for (let d = w + 1; d < WAVES.length; d++) {
      WAVES[d].forEach((t) => unfinished.push(t.id + ': deferred (budget exhausted during wave ' + (w + 1) + ' merge)'))
    }
    log('wave ' + (w + 1) + ' merge deferred mid-reconciliation: budget exhausted')
    break
  }
  if (merge.status === 'MERGED' && !merge.headSha) {
    // The recorded base is now behind the real integration head: no later wave
    // may take the contended path, whose candidate is built FROM that base.
    waveBaseLive = false
    judgmentCalls.push('wave ' + (w + 1) + ': merge reported MERGED without headSha — ' +
      'review base stays at ' + String(waveBaseSha).slice(0, 12) +
      '; later reviewers may see this wave\'s changes as task scope')
    log('wave ' + (w + 1) + ': MERGED without headSha; review base frozen')
  }
  if (merge.status === 'MERGED' && merge.headSha) waveBaseSha = merge.headSha
  // #70: this wave's branches landed — record their recorded head shas so the
  // completeness critic can assert each is an ancestor of the final integration HEAD.
  if (merge.status === 'MERGED') {
    mergedShas.push(...results.filter(isMergeable).map((r) => ({ task: r.task, headSha: r.headSha })))
  }
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
  review = { testsPassed: false,
             output: 'not run — budget exhausted before integration review',
             findings: ['integration review deferred: budget exhausted — verify the suite manually before merging'] }
} else {
  try {
    const cannotVerifyChecklist = cannotVerifyItems.length
      ? ('CANNOT-VERIFY checklist (escalated by the per-task reviewers — verify each against the integrated tree): ' +
         cannotVerifyItems.map((c) => '[' + c.task + '] ' + c.requirement + ' (' + c.why + ')').join('; ') + '. ')
      : ''
    // #114: the critic prompt carries <runDir> (the heads/ sidecar dir), so the
    // ENGINE-AUTHORED text flows through fillPaths like every other baked prompt.
    // The two non-engine spans stay out of that call: globalConstraintsBlock is
    // plan-authored and concatenated outside it, and the reviewer-authored
    // CANNOT-VERIFY checklist — which sits mid-prompt — is spliced into its seam
    // AFTER substitution. Either may legitimately quote a literal <runDir>; a
    // reviewer whose quoted token got rewritten would be reading mangled prose.
    review = await agent(
      spliceCannotVerify(
        fillPaths(GUARD + '\n\n' + completenessPrompt(waveBaseSha, mergedShas)),
        cannotVerifyChecklist) + globalConstraintsBlock +
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

// agent() RETURNS null (it does not throw) when a subagent dies on a terminal API
// error after retries (e.g. Overloaded) or is skipped mid-run — so the try/catch
// above, which only handles throws, lets a null review slip through to the report
// where review.testsPassed would crash the whole run AFTER every wave already
// merged. Guard it: a dead completeness critic degrades to a non-passing,
// manually-verifiable result and a judgment call, never a crash.
if (!review || typeof review !== 'object') {
  judgmentCalls.push('integration review returned no result — the completeness agent died (likely a transient API error after retries); verify the suite manually before merging')
  review = { testsPassed: false,
             output: 'integration review returned null — the completeness agent produced no result',
             findings: ['integration review returned no result — verify the suite manually before merging'] }
}

// ── Git-verified ground truth (#29) + deferred-verification channel ───────────
// gitVerified is true ONLY when the completeness critic confirmed (via its own
// git rev-parse HEAD) that it reviewed the recorded merge HEAD. A false value —
// or an absent flag from a dead/degraded critic — leaves gitVerified false, so
// the gate cannot mistake an unverified review for a clean one. deferredVerification
// carries the critic's verified-by-construction-but-not-sandbox-executable items,
// each tagged with a reason (browser/runtime/external/manual).
// ── Integration ancestry assertion (#70) ─────────────────────────────────────
// The completeness critic, detached on the integration HEAD, asserted for every
// mergeable done task's recorded headSha that `git merge-base --is-ancestor <sha>
// HEAD` succeeds. A non-empty ancestryMisses means a task the run reported as
// merged never landed in the integration tree — a silent drop. Name each and
// force the run BLOCKED: withhold gitVerified (SKILL.md Step 5 reads a false
// gitVerified as do-not-Approve) so the gate cannot mistake a lossy run for clean.
const ancestryMisses = (review && Array.isArray(review.ancestryMisses)) ? review.ancestryMisses : []
if (ancestryMisses.length) {
  for (const m of ancestryMisses) {
    judgmentCalls.push('integration ancestry miss (#70): task ' + (m && m.task) +
      ' reported merged (headSha ' + String((m && m.headSha) || '').slice(0, 12) +
      ') is NOT an ancestor of the integration HEAD — silently dropped; the run is BLOCKED, do not merge')
  }
  log('BLOCKED: ' + ancestryMisses.length + ' task(s) missing from the integration ancestry (#70)')
}

// gitVerified is true ONLY when the critic confirmed it reviewed the recorded merge
// HEAD AND no mergeable task fell out of the integration ancestry (#29 + #70).
const gitVerified = !!(review && review.onIntegrationHead) && ancestryMisses.length === 0
const deferredVerification = (review && Array.isArray(review.deferredVerification)) ? review.deferredVerification : []
if (review && review.onIntegrationHead === false)
  judgmentCalls.push('completeness critic could NOT confirm it reviewed the recorded merge HEAD — possible checkout drift (#29); verify the integration tree before merging')

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

// ── Structural coverage + missing-deliverables signals ───────────────────────
// The engine has no git, so it emits only what it can observe structurally: how
// many planned tasks actually merged, and which failed/blocked tasks left their
// declared files unproduced. A green integration suite with tasks_merged <
// tasks_planned is the false-green the gate must catch (the git tree-diff that
// confirms presence is the completeness critic's job).
const mergedBranches = new Set()
for (const wm of waveMerges) if (wm && wm.status === 'MERGED') for (const b of (wm.branches || [])) mergedBranches.add(b)
const tasksPlanned = WAVES.flat().length
const coverage = { tasks_merged: mergedBranches.size, tasks_planned: tasksPlanned,
                   complete: mergedBranches.size >= tasksPlanned }
// Build the missing-id set from BOTH sources and look up files from WAVES, not
// from taskResults: a cascade-blocked task that never ran is absent from
// taskResults, and `unfinished` carries bare ids only inside strings like
// "C: cascade-blocked by wave 2" — so parse the leading id out of each string.
const failedIds = taskResults.filter((t) => t.status === 'failed').map((t) => t.task)
const blockedIds = unfinished
  .map((u) => (typeof u === 'string' ? u.split(/[:\s]/)[0] : (u && u.task)))
  .filter(Boolean) // "C: cascade-blocked …" -> "C"
const missingIds = [...new Set([...failedIds, ...blockedIds])]
const missingDeliverables = missingIds
  .map((id) => ({ task: id, files: ((WAVES.flat().find((w) => w.id === id) || {}).files) || [] }))
  .filter((m) => m.files.length)

// ── Structured return value (matches references/report-format.md) ─────────────
return {
  integrationBranch,
  waves: WAVES.map((w) => w.map((t) => t.id)),
  dependencyEdges,
  tasks: taskResults,
  tests: { command: testCmd, passed: review.testsPassed, output: review.output },
  acceptance,
  baseline,
  waveMerges,
  frontier,
  coverage,
  missingDeliverables,
  gitVerified,
  ancestryMisses,
  deferredVerification,
  judgmentCalls,
  unfinished,
  completenessFindings: review.findings || [],
  blockedWaves,
}
