# Worktree Creation Fails Closed (#120, narrowed) Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A non-resume launch whose integration-worktree path already exists refuses loudly at setup instead of adopting the stale directory — with the refusal shape pinned so it mechanically trips the controller's existing abort checks.

**Architecture:** One clause added to the non-resume setup prompt at its source (`references/wave-merge.md`, `BAKE:SETUP_PROMPT_CREATE`) and re-baked into `waves.js`. The refusal shape is pinned — empty `headSha`, BLOCKED string in `branch` — because the setup report schema has no status field and the controller aborts only on `!setup || setup.branch !== integrationBranch || !setup.headSha`. The `.mjs` sim proves the pinned shape aborts before any task dispatch.

**Tech Stack:** JavaScript (Workflow harness), Node `.mjs` sim, pytest drift pin.

**Acceptance:** suite — the committed pytest suite plus the armed `.mjs` sims (`harnesses/*.js` changes arm the suite-gate's JS-behavioral guard; the sim carries the behavioral proof and prints the pass sentinel).

## Global Constraints

- Operator-narrowed scope is binding: ONLY the fail-closed check at integration-worktree creation for non-resume launches. NOT in scope: HEAD-equals-base assertion, audit surfaces, new error taxonomy, any resume-prompt change, task-worktree creation (owned by the Workflow runtime, not this repo).
- No schema change: `SETUP_SCHEMA` keeps `required: ['branch','headSha']` and gains no status field. No controller logic change: the abort condition stays byte-identical.
- Anti-drift rule: edit the source block in `references/wave-merge.md`, re-bake the identical text into `waves.js`, and `tests/test_no_prompt_drift.py` must stay green.
- The new sim work must print inside the existing `ALL SCENARIOS PASSED` sentinel discipline of `tests/sim_workflow.mjs` (the suite-gate keys on exit code AND sentinel).

---

### Task 1: The fail-closed clause — source edit + re-bake

**Type:** implementation
**Review:** adversarial
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/references/wave-merge.md`
- Modify: `skills/ultrapowers/harnesses/waves.js:404-408`
- Test: `tests/test_no_prompt_drift.py`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: the non-resume setup prompt (both the source `BAKE:SETUP_PROMPT_CREATE` block and the baked `SETUP_PROMPT` create-branch in the harness) containing the fail-closed clause with the pinned refusal shape: on an existing `{{INTEGRATION_WT}}` path the agent reports `headSha` as the empty string and a `BLOCKED:`-prefixed `branch`, never a real branch/sha.

- [ ] **Step 1: Edit the source block**

In `skills/ultrapowers/references/wave-merge.md`, inside `<!-- BAKE:SETUP_PROMPT_CREATE -->`, replace the exact text

```
You are the setup agent. The engine never mutates the session checkout: create the dedicated integration worktree instead. From the session repo root run: git worktree add {{INTEGRATION_WT}} -b {{INTEGRATION_BRANCH}}{{BASE_BRANCH_ARG}}.
```

with

```
You are the setup agent. The engine never mutates the session checkout: create the dedicated integration worktree instead. First check the target path: if {{INTEGRATION_WT}} already exists — a directory of any kind, even empty — refuse: create nothing, never adopt, clear, or reuse an existing directory, and never work around a git worktree add refusal. To refuse, report headSha as the empty string and put BLOCKED: {{INTEGRATION_WT}} exists — remove it with sweep_worktrees.sh --run wf_{{STAMP}} in branch; never report a real branch name or sha for a worktree you did not create. Otherwise, from the session repo root run: git worktree add {{INTEGRATION_WT}} -b {{INTEGRATION_BRANCH}}{{BASE_BRANCH_ARG}}.
```

(`{{STAMP}}` is a new interpolation token; the block's preamble sentence listing tokens gains: `{{STAMP}}` is the run stamp.)

- [ ] **Step 2: Re-bake into waves.js**

In `skills/ultrapowers/harnesses/waves.js`, in the `SETUP_PROMPT` **non-resume** branch (the `: (...)` arm), replace

```javascript
  : ('You are the setup agent. The engine never mutates the session checkout: ' +
     'create the dedicated integration worktree instead. From the session repo root ' +
     'run: git worktree add ' + INTEGRATION_WT + ' -b ' + integrationBranch +
     (baseBranch ? (' ' + baseBranch) : '') + '. ' + setupBootstrapLine +
```

with

```javascript
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
```

(`stamp` and `INTEGRATION_WT` are existing top-level consts in the harness; no new state.)

- [ ] **Step 3: Run the drift pin**

Run: `python3 -m pytest tests/test_no_prompt_drift.py -v`
Expected: ALL PASS — the pin splits the source block on `{{TOKEN}}` and asserts the static fragments appear in order in `waves.js`, so both edits must agree or this fails naming the block.

- [ ] **Step 4: Run the existing sims (no regression)**

Run: `node tests/sim_workflow.mjs`
Expected: exit 0 and the `ALL SCENARIOS PASSED` sentinel (the prompt grew but no scenario asserts against the old create-branch text; if one does, this run names it — fix the assert to the new text, never the prompt to the old).

- [ ] **Step 5: Commit**

```bash
git add skills/ultrapowers/references/wave-merge.md skills/ultrapowers/harnesses/waves.js
git commit -m "feat(#120): non-resume setup fails closed on an existing integration-worktree path"
```

### Task 2: Sim proof — the pinned refusal shape aborts the run

**Type:** implementation
**Depends-on:** 1

**Files:**
- Modify: `tests/sim_workflow.mjs`

**Interfaces:**
- Consumes: the fail-closed clause text from the task that edits the setup prompt (asserted verbatim on the dispatched prompt).
- Produces: sim scenario `scenarioStaleWorktreeRefusal` plus one assert in the existing integration-worktree scenario; both inside the file's pass-sentinel discipline.

- [ ] **Step 1: Add the refusal-shape scenario**

In `tests/sim_workflow.mjs`, after `scenarioSetupFailure` (F1), add — mirroring F1's structure exactly:

```javascript
// ── Scenario: pinned stale-worktree refusal shape must abort (#120) ──────────
// SETUP_SCHEMA has no status field, so a refusing agent reports the pinned
// shape (BLOCKED string in branch, empty headSha) — this proves that shape
// trips the controller's EXISTING abort checks before any task dispatch.
async function scenarioStaleWorktreeRefusal() {
  let implRan = false
  let threw = false
  try {
    await runWorkflow({
      agent: makeAgent((label) => {
        if (label === 'setup') {
          return { branch: 'BLOCKED: .claude/worktrees/wf_sim-integration exists — remove it with sweep_worktrees.sh --run wf_sim', headSha: '' }
        }
        if (label.startsWith('impl:')) { implRan = true }
        return undefined
      }),
      args: baseArgs, budget: undefined,
    })
  } catch (e) {
    threw = /setup failed/.test(e.message)
  }
  assert(threw, 'staleWorktreeRefusal: the pinned refusal shape must throw')
  assert(!implRan, 'staleWorktreeRefusal: no implementer may run after a refusal')
  console.log('scenario stale-worktree-refusal: OK')
}
```

Register it in the file's scenario runner list alongside the others (same place `scenarioSetupFailure` is invoked).

- [ ] **Step 2: Add the prompt-clause assert**

In `scenarioIntegrationWorktree` (the existing prompt-capture scenario), next to the existing `intwt: setup` asserts, add:

```javascript
  // #120: the dispatched (interpolated) setup prompt carries the fail-closed
  // clause — distinct from the static drift pin, this catches broken interpolation.
  assert(prompts['setup'].includes('never adopt, clear, or reuse an existing directory'),
    'intwt: setup prompt carries the #120 fail-closed clause')
  assert(prompts['setup'].includes('report headSha as the empty string'),
    'intwt: setup prompt pins the refusal shape')
```

- [ ] **Step 3: Run the sims**

Run: `node tests/sim_workflow.mjs`
Expected: exit 0, the new scenario line `scenario stale-worktree-refusal: OK` printed, and the `ALL SCENARIOS PASSED` sentinel.

- [ ] **Step 4: Run the pytest suite (drift pin + everything)**

Run: `python3 -m pytest`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add tests/sim_workflow.mjs
git commit -m "test(#120): sim proves the pinned stale-worktree refusal shape aborts before task dispatch"
```

### Task 3: Suite gate

**Type:** gate
**Depends-on:** 1, 2

**Files:**
- Test: `tests/`

- [ ] **Step 1: Run the full suite and the harness sims**

Run: `python3 -m pytest && node tests/sim_workflow.mjs`
Expected: pytest exit 0; sim exit 0 with `ALL SCENARIOS PASSED`.
