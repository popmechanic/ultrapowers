# Review-Findings Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.
>
> Note: nearly every task modifies `skills/ultrapowers/workflow.js` and `tests/sim_workflow.mjs`,
> so ultrapowers' own dependency analysis would serialize them — execute this plan
> **sequentially, in task order**. Task 10 (drift markers) MUST run last: it freezes the prompt
> wording the earlier tasks change.

**Goal:** Fix all 17 findings from the 2026-06-09 code review — orchestration correctness bugs in
`workflow.js`, drift-protection gaps, skill-authoring polish, and three usefulness features
(baseline test run, deterministic redirect, run economics).

**Spec:** `docs/superpowers/specs/2026-06-09-review-findings.md` (findings F1–F17; each task below
names the findings it closes).

**Architecture:** All behavior changes land in the committed `workflow.js` and are proven by new
scenarios in the deterministic simulator (`tests/sim_workflow.mjs`), which stubs the Workflow
engine globals. Prompt-wording changes are mirrored into their source-of-truth reference docs and
locked by extending `tests/test_no_prompt_drift.py`. SKILL.md/validator changes are covered by
`tests/test_validate_skill.py` and `scripts/validate_skill.py`.

**Tech Stack:** Node 22 (simulator), Python 3.11 + pytest, Claude Code plugin/skill format.

---

### Task 1: Fail-loud launch validation — tierOverrides models + budget guard (F9, F10)

**Files:**
- Modify: `skills/ultrapowers/workflow.js:66` (after the `tierOverrides` parse), `skills/ultrapowers/workflow.js:352` (budget check)
- Modify: `tests/sim_workflow.mjs` (add `makeAgent` helper + 1 scenario)
- Modify: `skills/ultrapowers/references/workflow-template.md` (args contract: document the validation)

- [ ] **Step 1: Add the `makeAgent` stub helper to the simulator** (used by every new scenario in this plan; existing scenarios stay untouched)

Insert after the `taskIdFromLabel` function in `tests/sim_workflow.mjs`:

```js
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
```

- [ ] **Step 2: Write the failing scenario**

Add to `tests/sim_workflow.mjs` (and call it in the runner list at the bottom):

```js
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
```

- [ ] **Step 3: Run to verify it fails**

Run: `node tests/sim_workflow.mjs`
Expected: `SIM ASSERT FAILED: tierOverrideInvalid: ...` (the workflow currently accepts any override value)

- [ ] **Step 4: Implement validation in workflow.js**

Insert directly after the `tierOverrides` const (line 66):

```js
// Fail loud on a typo'd model alias: an invalid model makes every agent error
// without doing any work (verified live 2026-06-03), so catch it before launch.
const VALID_MODELS = ['haiku', 'sonnet', 'opus']
for (const k in tierOverrides) {
  if (VALID_MODELS.indexOf(tierOverrides[k]) === -1) {
    throw new Error(
      'ultrapowers: tierOverrides.' + k + ' = "' + tierOverrides[k] +
      '" is not a valid model alias (valid: haiku, sonnet, opus). Refusing to launch.'
    )
  }
}
```

- [ ] **Step 5: Fix the budget guard**

Change `workflow.js:352` from:

```js
  if (typeof budget !== 'undefined' && budget && budget.total && budget.remaining === 0) {
```

to:

```js
  if (typeof budget !== 'undefined' && budget && typeof budget.remaining === 'number' && budget.remaining <= 0) {
```

- [ ] **Step 6: Run all tests**

Run: `node tests/sim_workflow.mjs && python -m pytest tests/ -v`
Expected: `ALL SCENARIOS PASSED`, all pytest tests pass.

- [ ] **Step 7: Document in workflow-template.md**

In the "Per-project knobs" list of `references/workflow-template.md`, extend the `tierOverrides`
bullet with: "Values are validated at launch against `haiku` / `sonnet` / `opus`; an unknown alias
throws before any agent runs."

- [ ] **Step 8: Commit**

```bash
git add tests/sim_workflow.mjs skills/ultrapowers/workflow.js skills/ultrapowers/references/workflow-template.md
git commit -m "fix: validate tierOverrides models at launch; budget guard fires on <= 0"
```

---

### Task 2: Setup gate, baseline test run, and base-branch knob (F1, F15, part of F3)

**Files:**
- Modify: `skills/ultrapowers/workflow.js:142-145` (SETUP_PROMPT), `:207-211` (SETUP_SCHEMA), `:344-345` (setup dispatch), `:400-411` (report)
- Modify: `tests/sim_workflow.mjs` (2 scenarios)
- Modify: `skills/ultrapowers/references/wave-merge.md` ("Integration Branch" section)
- Modify: `skills/ultrapowers/references/report-format.md` (add `baseline` field)
- Modify: `skills/ultrapowers/SKILL.md` (Step 2: derive `baseBranch`; Step 4: pass it)

- [ ] **Step 1: Write the failing scenarios**

Add to `tests/sim_workflow.mjs`:

```js
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
```

- [ ] **Step 2: Run to verify both fail**

Run: `node tests/sim_workflow.mjs`
Expected: FAIL — setup result is currently discarded and no `baseline` field exists.

- [ ] **Step 3: Implement in workflow.js**

Add a `baseBranch` knob next to the other knobs (after `tierOverrides`, line 66):

```js
const baseBranch = (ARGS && typeof ARGS.baseBranch === 'string' && ARGS.baseBranch.trim()) || undefined
```

Replace `SETUP_PROMPT` (lines 142-145). Note `testInstruction` is declared above it already:

```js
const SETUP_PROMPT =
  'You are the setup agent on the session repo main checkout. ' +
  (baseBranch ? ('Check out the base branch ' + baseBranch + ' first. ') : '') +
  'Create the integration branch: git checkout -b ' + integrationBranch + '. Then ' +
  'establish the test baseline: ' + testInstruction + ' and record whether it passes. ' +
  'Report the branch name, its HEAD sha, and the baseline result in your JSON result.'
```

Replace `SETUP_SCHEMA` (lines 207-211):

```js
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
```

Replace the setup dispatch (line 344-345):

```js
phase('Setup')
const setup = await agent(GUARD + '\n\n' + SETUP_PROMPT, { label: 'setup', model: TIER.cheap, schema: SETUP_SCHEMA })
// F1: SKILL.md promises an abort when the integration branch cannot be created.
if (!setup || setup.branch !== integrationBranch || !setup.headSha) {
  throw new Error(
    'ultrapowers: setup failed to create integration branch ' + integrationBranch +
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
```

Add `baseline,` to the returned report object (after `tests:`, line 405).

- [ ] **Step 4: Run all tests**

Run: `node tests/sim_workflow.mjs && python -m pytest tests/ -v`
Expected: all pass (existing scenarios already stub `setup` with a matching branch + headSha).

- [ ] **Step 5: Update the docs**

`references/report-format.md`: add to the schema's properties
`"baseline": { "type": "object", "properties": { "passed": {"type":"boolean"}, "output": {"type":"string"} } }`
and a field-reference row: `baseline` / no / "Result of the test run setup performed on the
integration branch before wave 1; `passed: false` means tasks inherited a red suite." Add
"Baseline" to the Presentation list between "Wave plan" and "Per-task status".

`references/wave-merge.md` "Integration Branch" section: after the `git checkout -b` block, add:
"The setup agent first checks out `args.baseBranch` when supplied (the orchestrator derives the
repo's default branch in SKILL.md Step 2 — protects against a stale checkout left by a previous
run), runs the project test command once to establish the **baseline**, and reports
`baselinePassed`/`baselineOutput`. The workflow validates the setup report and **throws** if the
integration branch was not created."

`SKILL.md` Step 2 (derived knobs list): add a bullet:
"**`baseBranch`** — the repo's default branch (`git symbolic-ref --short refs/remotes/origin/HEAD`,
falling back to the current branch). Always set it; it anchors the integration branch and the
review diff base."
`SKILL.md` Step 4 args line: add `baseBranch` to the args object.

- [ ] **Step 6: Commit**

```bash
git add skills/ultrapowers tests/sim_workflow.mjs
git commit -m "fix: gate on setup result, run baseline tests, add baseBranch knob"
```

---

### Task 3: Correct review diff base + detached reviewer checkout (F2, F3)

**Files:**
- Modify: `skills/ultrapowers/workflow.js` (IMPLEMENTER_PROMPT `:85-108`, REVIEWER_PROMPT `:113-134`, `runTask` `:248-314`, wave loop `:349-388`)
- Modify: `skills/ultrapowers/references/reviewer-prompts.md` (both BAKE blocks — wording must match or the drift test fails)
- Modify: `tests/sim_workflow.mjs` (1 scenario)

- [ ] **Step 1: Write the failing scenario**

```js
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/sim_workflow.mjs`
Expected: FAIL — no `BASE` line exists in any prompt today.

- [ ] **Step 3: Update both baked prompts in workflow.js**

In `IMPLEMENTER_PROMPT`, add to the inputs list (after the `BRANCH` line):

```js
  '- BASE: sha of the integration-branch HEAD your work builds on',
```

and replace the self-verify bullet
`'- Run git diff main (or the base branch) and verify no unrelated files are modified.',` with:

```js
  '- Run git diff BASE...HEAD (BASE is provided in your inputs) and verify no unrelated files are modified.',
```

In `REVIEWER_PROMPT`, replace spec-compliance step 1
`'1. Check out the branch identified by headSha. Run git diff main yourself.',` with:

```js
  '1. Check out the implementer HEAD sha as a DETACHED checkout (git checkout --detach <HEAD>) — the implementer branch itself is locked by its worktree, so do not check the branch out. Run git diff BASE...HEAD yourself.',
```

- [ ] **Step 4: Thread the base sha through runTask**

Change the `runTask` signature to `async function runTask(task, baseSha)`. Append the base to the
implementer dispatch (initial and fix re-dispatch): change `'\n\nTASK:\n' + task.body` to
`'\n\nBASE: ' + baseSha + '\nTASK:\n' + task.body` in both `agent(...)` calls. In the review
prompt construction, change `'\nBRANCH: ' + impl.branch + '\nHEAD: ' + impl.headSha` to
`'\nBRANCH: ' + impl.branch + '\nHEAD: ' + impl.headSha + '\nBASE: ' + baseSha`.

In the wave loop: after the setup gate (Task 2) add `let waveBaseSha = setup.headSha`; change the
parallel dispatch to `runTask(task, waveBaseSha)`; and after a successful merge
(`merge.status === 'MERGED'` — i.e. just after the `waveMerges.push`, guarded), add:

```js
  if (merge.status === 'MERGED' && merge.headSha) waveBaseSha = merge.headSha
```

- [ ] **Step 5: Re-bake reviewer-prompts.md**

Apply the same two wording changes inside the `<!-- BAKE:IMPLEMENTER_PROMPT -->` and
`<!-- BAKE:REVIEWER_PROMPT -->` blocks of `references/reviewer-prompts.md` (markdown formatting
may differ; the words must match — the drift test normalizes formatting away). Also add `BASE`
to the prose inputs list in that file's implementer section.

- [ ] **Step 6: Run all tests**

Run: `node tests/sim_workflow.mjs && python -m pytest tests/ -v`
Expected: all pass, including `test_no_prompt_drift.py` (proves the re-bake matched).

- [ ] **Step 7: Commit**

```bash
git add skills/ultrapowers tests/sim_workflow.mjs
git commit -m "fix: review against per-wave integration base, detached reviewer checkout"
```

---

### Task 4: Propagate concerns + judgmentCalls + run economics (F4, F17)

**Files:**
- Modify: `skills/ultrapowers/workflow.js` (`runTask` returns)
- Modify: `tests/sim_workflow.mjs` (1 scenario + 1 assertion in `scenarioFixLoop`)
- Modify: `skills/ultrapowers/references/report-format.md` (task fields)

- [ ] **Step 1: Write the failing scenario**

```js
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
```

Also add to `scenarioFixLoop`, after the existing `reviewVerdict` assertion:

```js
  eq(a.fixIterations, 1, 'fixloop: one fix round recorded')
```

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/sim_workflow.mjs`
Expected: FAIL — `notes` ignores concerns; no `fixIterations`/`tier`/`review` fields.

- [ ] **Step 3: Implement in runTask**

At the top of `runTask` (after `baseModel`), collect concerns and record them:

```js
  const concerns = []
  const noteConcerns = (res) => {
    if (res && res.status === 'DONE_WITH_CONCERNS' && Array.isArray(res.concerns)) {
      for (const c of res.concerns) {
        concerns.push(c)
        judgmentCalls.push('task ' + task.id + ': ' + c)
      }
    }
  }
```

Call `noteConcerns(impl)` after the initial dispatch and after the fix re-dispatch. In the
success return, replace `notes: minors.map((m) => m.detail).join('; ')` with:

```js
               notes: minors.map((m) => m.detail)
                 .concat(concerns.map((c) => 'concern: ' + c)).join('; '),
               tier: baseModel, review: taskReviewProfile(task), fixIterations: iter - 1 }
```

Add `tier: baseModel, review: taskReviewProfile(task)` and the appropriate
`fixIterations` (`iter - 1` where `iter` is in scope; `0` for the pre-loop BLOCKED/NEEDS_CONTEXT
return; `1` for `fix-loop-exhausted` and `blocked-after-fix`) to the failure returns as well.

- [ ] **Step 4: Run all tests**

Run: `node tests/sim_workflow.mjs && python -m pytest tests/ -v`
Expected: all pass.

- [ ] **Step 5: Update report-format.md**

Add `tasks[].tier` ("resolved model alias the implementer ran at"), `tasks[].review`
(`lean`/`adversarial`), and `tasks[].fixIterations` (integer, fix rounds consumed) rows to the
field reference; mention in `judgmentCalls`'s row that implementer concerns and a red baseline
populate it. Add to the Presentation section, item 3: "include tier, review depth, and fix
iterations so the human can judge cost vs. benefit per task."

- [ ] **Step 6: Commit**

```bash
git add skills/ultrapowers tests/sim_workflow.mjs
git commit -m "fix: surface implementer concerns + per-task economics in the report"
```

---

### Task 5: Completeness critic receives the plan (F5)

**Files:**
- Modify: `skills/ultrapowers/workflow.js:64-66` (knobs), `:160-164` (COMPLETENESS_PROMPT)
- Modify: `skills/ultrapowers/SKILL.md` (Step 4 args)
- Modify: `skills/ultrapowers/references/wave-merge.md`, `references/workflow-template.md` (args contract)
- Modify: `tests/sim_workflow.mjs` (1 scenario)

- [ ] **Step 1: Write the failing scenario**

```js
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/sim_workflow.mjs`
Expected: FAIL — `planPath` is currently ignored.

- [ ] **Step 3: Implement**

Add the knob next to `baseBranch`:

```js
const planPath = (ARGS && typeof ARGS.planPath === 'string' && ARGS.planPath.trim()) || undefined
```

Change `COMPLETENESS_PROMPT` to:

```js
const COMPLETENESS_PROMPT =
  (planPath ? ('Read the original plan document at ' + planPath + ' first. ') : '') +
  'What plan requirement is unmet? What claim is unverified? What code path is ' +
  'untested? On ' + integrationBranch + ' from the main checkout, ' + testInstruction +
  ', then review the integrated result against the original plan. List every ' +
  'gap, unverified claim, and untested path.'
```

- [ ] **Step 4: Run all tests**

Run: `node tests/sim_workflow.mjs && python -m pytest tests/ -v`
Expected: all pass.

- [ ] **Step 5: Update the docs**

`SKILL.md` Step 4: add `planPath: '<plan-path>'` to the args object and a sentence: "`planPath` —
the resolved plan path from Step 1, so the completeness critic reviews against the actual plan,
not just the task list." `workflow-template.md` args contract: add the `planPath` bullet.
`wave-merge.md` "Integration and Completeness Review": change "The agent receives the original
plan" to "The agent receives `args.planPath` and reads the plan from disk (agents have fs
access; the script does not)."

- [ ] **Step 6: Commit**

```bash
git add skills/ultrapowers tests/sim_workflow.mjs
git commit -m "fix: pass planPath so the completeness critic reviews against the real plan"
```

---

### Task 6: Fix-loop edge cases — verdict mismatch + NEEDS_CONTEXT after fix (F7, F8)

**Files:**
- Modify: `skills/ultrapowers/workflow.js` (`runTask` review handling `:281-312`)
- Modify: `tests/sim_workflow.mjs` (2 scenarios)

- [ ] **Step 1: Write the failing scenarios**

```js
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
```

- [ ] **Step 2: Run to verify both fail**

Run: `node tests/sim_workflow.mjs`
Expected: FAIL on both — no mismatch signal exists; NEEDS_CONTEXT proceeds to a second review.

- [ ] **Step 3: Implement**

In `runTask`, change the declaration `let issues` to `let issues, verdicts`. In the adversarial
branch, after the existing `issues = ...` line, add `verdicts = [r1.verdict, r2.verdict]`; in the
lean branch add `verdicts = [review.verdict]`. Then, inside the `blocking.length === 0` success
path, before the `return`:

```js
      if (verdicts.indexOf('FIX_REQUIRED') !== -1) {
        log('task ' + task.id + ': reviewer verdict FIX_REQUIRED but no blocking issues; merging on severity')
        judgmentCalls.push('task ' + task.id +
          ': reviewer said FIX_REQUIRED with no blocking issues — merged on the severity rule')
      }
```

Change the post-fix status check from `if (impl.status === 'BLOCKED')` to:

```js
    if (impl.status === 'BLOCKED' || impl.status === 'NEEDS_CONTEXT') {
```

- [ ] **Step 4: Run all tests**

Run: `node tests/sim_workflow.mjs && python -m pytest tests/ -v`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add skills/ultrapowers/workflow.js tests/sim_workflow.mjs
git commit -m "fix: flag verdict/severity mismatch; fail task on NEEDS_CONTEXT after fix"
```

---

### Task 7: Deterministic redirect — resume on the existing integration branch (F16)

**Files:**
- Modify: `skills/ultrapowers/workflow.js` (knobs + SETUP_PROMPT)
- Modify: `skills/ultrapowers/SKILL.md` (Step 5 Redirect mechanism)
- Modify: `skills/ultrapowers/references/workflow-template.md` (args contract)
- Modify: `tests/sim_workflow.mjs` (2 scenarios)

- [ ] **Step 1: Write the failing scenarios**

```js
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
```

- [ ] **Step 2: Run to verify both fail**

Run: `node tests/sim_workflow.mjs`
Expected: FAIL — `resume` is ignored; setup always creates a branch.

- [ ] **Step 3: Implement**

Add the knob (next to `planPath`):

```js
const resume = !!(ARGS && ARGS.resume === true)
if (resume && !(ARGS && typeof ARGS.integrationBranch === 'string' && ARGS.integrationBranch)) {
  throw new Error('ultrapowers: resume requires an explicit args.integrationBranch — ' +
    'pass the integration branch of the run being redirected.')
}
```

Make `SETUP_PROMPT` conditional (this builds on the Task-2 wording; keep the baseline sentences
identical in both variants):

```js
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
```

- [ ] **Step 4: Run all tests**

Run: `node tests/sim_workflow.mjs && python -m pytest tests/ -v`
Expected: all pass.

- [ ] **Step 5: Update the docs**

`SKILL.md` Step 5, Redirect bullet — replace "provide corrective instructions; re-run the
affected tasks before returning here" with:

> **Redirect** — provide corrective instructions. Build a new `waves` array containing **only the
> affected tasks** (preserving their relative order and any edges between them, with the
> corrective instructions appended to each task `body`), and relaunch the same committed
> `workflow.js` with `resume: true` and the **same** `integrationBranch`. The setup agent checks
> out the existing branch instead of creating one; redirected work merges onto it. Never
> improvise an ad-hoc re-run — this is the deterministic redirect path. Return to this gate when
> it completes.

`workflow-template.md` args contract: add the `resume` bullet (boolean; requires explicit
`integrationBranch`; setup checks out instead of creating).

- [ ] **Step 6: Commit**

```bash
git add skills/ultrapowers tests/sim_workflow.mjs
git commit -m "feat: deterministic redirect via args.resume on the existing integration branch"
```

---

### Task 8: SKILL.md — Workflow preflight, CSO description, argument-hint (F12, F13)

**Files:**
- Modify: `skills/ultrapowers/SKILL.md` (frontmatter + Step 1 + Step 6)
- Modify: `README.md` (environment-support section: mention the preflight)

- [ ] **Step 1: Rewrite the frontmatter**

```yaml
---
name: ultrapowers
description: Use when the user runs "/ultrapowers <plan-path>", asks to "execute this plan", "go ultra", "run the plan as a workflow", or wants to autonomously implement an approved Superpowers plan in parallel waves across git worktrees.
argument-hint: <plan-path>
allowed-tools: Workflow Skill Read Grep Glob Bash
---
```

(Starts with "Use when…", drops the what-it-is tail per superpowers CSO; the body's first
paragraph already states the drop-in relationship. `argument-hint` aids autocomplete.)

- [ ] **Step 2: Add the preflight to Step 1**

At the top of "Step 1 — Confirm an Approved Plan Exists", before plan resolution, add:

> **Preflight — confirm the Workflow tool exists on this surface.** The Workflow tool is an
> undocumented/experimental surface and is absent in some environments (e.g. Claude Code on the
> web). Check for it now (e.g. ToolSearch `select:Workflow`). If it is unavailable, go directly
> to Step 6 and run the fallback — do **not** perform dependency analysis or ask the human to
> approve a wave plan that cannot launch.

In Step 6, add a cross-reference sentence: "The Step-1 preflight routes here *before* any
analysis when the Workflow tool is absent."

- [ ] **Step 3: Validate and test**

Run: `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers && python -m pytest tests/ -v`
Expected: `skill ok`; all tests pass.

- [ ] **Step 4: Update README**

In "Environment support", append: "The skill preflights Workflow-tool availability at Step 1 and
falls back to `superpowers:subagent-driven-development` immediately — before computing or
presenting a wave plan."

- [ ] **Step 5: Commit**

```bash
git add skills/ultrapowers/SKILL.md README.md
git commit -m "docs: CSO description, argument-hint, and Workflow preflight at Step 1"
```

---

### Task 9: Harden validate_skill.py (F14)

**Files:**
- Modify: `skills/ultrapowers/scripts/validate_skill.py`
- Modify: `tests/test_validate_skill.py`

- [ ] **Step 1: Write the failing tests**

Add to `tests/test_validate_skill.py`:

```python
def test_bad_name_chars_fail(tmp_path):
    (tmp_path / "SKILL.md").write_text(
        "---\nname: bad name (x)\ndescription: " + "Use when testing this validator thing.\n---\nbody\n")
    code, out = run(tmp_path)
    assert code != 0 and "name" in out

def test_overlong_description_fails(tmp_path):
    (tmp_path / "SKILL.md").write_text(
        "---\nname: x\ndescription: " + "w" * 1100 + "\n---\nbody\n")
    code, out = run(tmp_path)
    assert code != 0 and "1024" in out

def test_missing_script_link_fails(tmp_path):
    (tmp_path / "SKILL.md").write_text(
        "---\nname: x\ndescription: Use when testing this validator thing.\n---\n"
        "run scripts/missing_tool.py\n")
    code, out = run(tmp_path)
    assert code != 0 and "missing_tool.py" in out
```

- [ ] **Step 2: Run to verify they fail**

Run: `python -m pytest tests/test_validate_skill.py -v`
Expected: the three new tests FAIL (validator accepts all of these today).

- [ ] **Step 3: Implement**

In `validate(skill_dir)`, after the existing `name` check, add:

```python
    name = fields.get("name", "")
    if name and not re.fullmatch(r"[A-Za-z0-9-]{1,64}", name):
        errors.append("frontmatter: 'name' must be 1-64 chars of letters, digits, hyphens")
    if len(desc) > 1024:
        errors.append("frontmatter: 'description' exceeds 1024 chars")
```

Replace the reference-link loop with one covering both directories:

```python
    for sub, ref in re.findall(r"\b(references|scripts)/([A-Za-z0-9_\-./]+\.\w+)", body):
        if not (skill_dir / sub / ref).exists():
            errors.append(f"missing referenced file: {sub}/{ref}")
```

- [ ] **Step 4: Run all tests**

Run: `python -m pytest tests/ -v && python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers`
Expected: all pass; `skill ok` (the real skill's `scripts/validate_skill.py` self-reference resolves).

- [ ] **Step 5: Commit**

```bash
git add skills/ultrapowers/scripts/validate_skill.py tests/test_validate_skill.py
git commit -m "test+harden: validator checks name format, description cap, scripts/ links"
```

---

### Task 10: Drift coverage for the wave-merge prompts + cascade doc alignment (F6, F11) — LAST

**Files:**
- Modify: `skills/ultrapowers/references/wave-merge.md` (BAKE markers + Reconciliation section)
- Modify: `tests/test_no_prompt_drift.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/test_no_prompt_drift.py`:

```python
WAVE_SOURCE = ROOT / "skills/ultrapowers/references/wave-merge.md"
PLACEHOLDER = re.compile(r"\{\{\w+\}\}")
WAVE_PROMPTS = ["SETUP_PROMPT_CREATE", "SETUP_PROMPT_RESUME", "MERGE_PROMPT",
                "RECONCILE_PROMPT", "COMPLETENESS_PROMPT"]


def wave_blocks():
    blocks = {name: body for name, body in MARKER.findall(WAVE_SOURCE.read_text())}
    assert blocks, "no <!-- BAKE:NAME --> markers found in wave-merge.md"
    return blocks


def test_wave_blocks_present():
    blocks = wave_blocks()
    for name in WAVE_PROMPTS:
        assert name in blocks, "missing BAKE marker for " + name


@pytest.mark.parametrize("name", WAVE_PROMPTS)
def test_wave_prompt_is_baked(name):
    # Blocks contain {{PLACEHOLDER}} tokens where workflow.js interpolates values;
    # assert the static fragments appear in workflow.js, in order.
    blocks = wave_blocks()
    wf = normalize(WORKFLOW.read_text())
    fragments = [normalize(f) for f in PLACEHOLDER.split(blocks[name])]
    fragments = [f for f in fragments if f]
    assert fragments, "empty source block for " + name
    pos = 0
    for frag in fragments:
        idx = wf.find(frag, pos)
        assert idx >= 0, (
            "drift: BAKE:" + name + " fragment missing or out of order in workflow.js. "
            "Re-bake per references/workflow-template.md.\nfragment (normalized):\n" + frag)
        pos = idx + len(frag)
```

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest tests/test_no_prompt_drift.py -v`
Expected: FAIL — `wave-merge.md` has no BAKE markers yet.

- [ ] **Step 3: Add the marked blocks to wave-merge.md**

In the "Integration Branch" section (final wording from Tasks 2 and 7):

```markdown
<!-- BAKE:SETUP_PROMPT_CREATE -->
You are the setup agent on the session repo main checkout. {{BASE_STEP}}Create the integration branch: git checkout -b {{INTEGRATION_BRANCH}}. Then establish the test baseline: {{TEST_INSTRUCTION}} and record whether it passes. Report the branch name, its HEAD sha, and the baseline result in your JSON result.
<!-- /BAKE -->

<!-- BAKE:SETUP_PROMPT_RESUME -->
You are the setup agent on the session repo main checkout. Check out the EXISTING integration branch {{INTEGRATION_BRANCH}} — it must already exist; report BLOCKED if it does not, and do not create a new branch. Then establish the test baseline: {{TEST_INSTRUCTION}} and record whether it passes. Report the branch name, its HEAD sha, and the baseline result in your JSON result.
<!-- /BAKE -->
```

In "Per-Wave Merge" (the lockfile-keyed detection ladder stays as explanatory prose *outside*
the marker — it documents the fallback list the prompt names):

```markdown
<!-- BAKE:MERGE_PROMPT -->
You are the wave merge agent, operating on the session repo main checkout (no worktree). Check out {{INTEGRATION_BRANCH}}. Merge each reported branch in the given task-index order (deterministic, so conflicts are reproducible). After all merges succeed, {{TEST_INSTRUCTION}}. Report MERGED with the final HEAD sha, or CONFLICT / TEST_FAILED with the conflict diff or failing output.
<!-- /BAKE -->
```

In "Reconciliation":

```markdown
<!-- BAKE:RECONCILE_PROMPT -->
You are the reconciliation agent on {{INTEGRATION_BRANCH}}. You are given a merge conflict diff or failing test output. Resolve it on the integration branch and re-run the project test command. Report MERGED on success, or CONFLICT / TEST_FAILED with detail if you cannot resolve it.
<!-- /BAKE -->
```

In "Integration and Completeness Review" (wording from Task 5):

```markdown
<!-- BAKE:COMPLETENESS_PROMPT -->
{{PLAN_STEP}}What plan requirement is unmet? What claim is unverified? What code path is untested? On {{INTEGRATION_BRANCH}} from the main checkout, {{TEST_INSTRUCTION}}, then review the integrated result against the original plan. List every gap, unverified claim, and untested path.
<!-- /BAKE -->
```

If any fragment fails the drift test, align the *doc* wording to the baked constant (the
constants were already shipped by Tasks 2, 5, 7) — iterate until green.

- [ ] **Step 4: Align the Reconciliation section with the code (F6)**

Replace the paragraph "The run continues with subsequent waves **unless** … every remaining wave
depends on it." and the bullet "Do not abort the whole run for a single blocked wave…" with:

> - When a wave's merge cannot be reconciled, the wave is marked **`blocked`** and **all later
>   waves are cascade-blocked** (recorded in `unfinished`, surfaced under `## Blocked Waves`).
>   Every later wave merges onto the same integration branch the failed wave left in an unknown
>   state, and by wave construction each wave-N+1 task depends on some wave-N task — so
>   continuing selectively would integrate onto a broken base. The committed workflow therefore
>   stops dispatching after an unrecoverable merge; nothing after the blocked wave runs.

Also update the "No Silent Caps" table row for cascade-blocking if its wording references
selective continuation.

- [ ] **Step 5: Update reviewer-prompts.md's sourcing note**

In `references/reviewer-prompts.md`, extend the drift-test sentence to: "…and
`tests/test_no_prompt_drift.py` extracts each marked block (here and in `wave-merge.md`) and
asserts it appears in `workflow.js`."

- [ ] **Step 6: Run all tests**

Run: `python -m pytest tests/ -v && node tests/sim_workflow.mjs`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add skills/ultrapowers/references tests/test_no_prompt_drift.py
git commit -m "test: drift coverage for setup/merge/reconcile/completeness prompts; align cascade-block docs"
```

---

## Final verification (after Task 10)

- [ ] Run the full suite: `python -m pytest tests/ -v && node tests/sim_workflow.mjs` — expected: all green.
- [ ] Run the validator: `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers` — expected: `skill ok`.
- [ ] Re-read the spec (`docs/superpowers/specs/2026-06-09-review-findings.md`) and confirm every finding F1–F17 maps to a landed task: F1/F15→T2, F2/F3→T2+T3, F4/F17→T4, F5→T5, F6/F11→T10, F7/F8→T6, F9/F10→T1, F12/F13→T8, F14→T9, F16→T7.
