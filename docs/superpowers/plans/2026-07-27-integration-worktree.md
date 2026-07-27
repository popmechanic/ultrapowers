# Integration Worktree (#84) Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No engine agent ever writes, branches, or detaches the operator's session checkout — integration happens in a dedicated worktree, and the frozen gate scripts stay byte-identical while their snapshot/restore rituals become inert.

**Architecture:** Rewrite the four non-reviewer choreography prompts (setup fresh/resume, merge, reconcile, completeness critic) so they operate in a dedicated integration worktree at `.claude/worktrees/wf_<stamp>-integration`. Edits happen at the source (`references/wave-merge.md`) and are re-baked into `waves.js` in the same task; sims pin the new routing. The completeness critic's existing sha-verified detach — relocated into that worktree — doubles as the branch release the frozen `ultra_gate.py --approve` checkout needs. Setup runs `bootstrapCmd` once in the fresh worktree because merge agents run the suite there.

**Tech Stack:** JavaScript (harness + `.mjs` sim), Markdown prompt source, Python 3/pytest for the pins.

**Spec:** `docs/superpowers/specs/2026-07-27-integration-worktree.md`

**Acceptance:** suite — mechanics gate: the committed pytest suite (canary + drift pins) plus the harness sims, which the suite gate runs automatically because `harnesses/*.js` changes. No seal requested.

## Global Constraints

- **FROZEN, byte-identical:** `skills/ultrapowers/scripts/gate_check.py`, `skills/ultrapowers/scripts/ultra_gate.py`, `skills/ultrapowers/scripts/run_lock.sh`, `skills/ultrapowers/scripts/run_acceptance.sh` must not change by one byte (`git diff` on them must be empty).
- **Reviewers stay non-isolated readers** — the per-task reviewer prompt's packet/object-store/read-only discipline is byte-unchanged (the A2 speed win).
- **Prompts are baked; edit the source, not the copy:** every prompt change lands in `references/wave-merge.md` AND `waves.js` together; `tests/test_canary.py` and `tests/test_no_prompt_drift.py` must stay green.
- **Sim sentinel discipline:** `tests/sim_workflow.mjs` still prints `ALL SCENARIOS PASSED` on success and exits non-zero on failure.
- **The integration worktree is stamp-named** (`.claude/worktrees/wf_<stamp>-integration`) so the repo-wide `wf_*` sweep covers it; no new cleanup machinery.
- **No changes outside** `skills/ultrapowers/harnesses/waves.js`, `skills/ultrapowers/references/wave-merge.md`, `tests/sim_workflow.mjs`, and `skills/ultrapowers/SKILL.md`.
- **No Anthropic SDK / `ANTHROPIC_API_KEY`** in any shipped or dev script (CLAUDE.md).
- Suite gate: `python3 -m pytest` green from the repo root.

---

### Task 1: Integration-worktree choreography — prompts, harness, sims

**Type:** implementation
**Depends-on:** none
**Review:** adversarial

**Files:**
- Modify: `skills/ultrapowers/harnesses/waves.js`
- Modify: `skills/ultrapowers/references/wave-merge.md`
- Test: `tests/sim_workflow.mjs`

**Interfaces:**
- Consumes: nothing from sibling tasks.
- Produces: `INTEGRATION_WT` binding in `waves.js` (`'.claude/worktrees/wf_' + stamp + '-integration'`, from the script's existing `stamp` binding); setup/merge/reconcile/completeness prompts that name that path and never instruct main-checkout mutation; setup carries `bootstrapCmd` when provided.

- [ ] **Step 1: Add the failing sim scenario**

In `tests/sim_workflow.mjs`, add a scenario (register it in the runner list next to `scenarioPortability()`):

```js
// ── Scenario: integration happens in a dedicated worktree (#84) ───────────────
// The session checkout is never branched, written, or detached by any engine
// agent: setup cuts .claude/worktrees/wf_<stamp>-integration, merge/reconcile/
// critic operate inside it, and the critic's verified detach frees the branch
// for the frozen Approve checkout.
async function scenarioIntegrationWorktree() {
  const prompts = {}
  const agent = makeAgent((label, prompt) => { prompts[label] = prompt; return undefined })
  const args = Object.assign({}, baseArgs, {
    bootstrapCmd: 'python3 -m venv .venv && .venv/bin/pip install -e .',
  })
  const r = await runWorkflow({ agent, args, budget: undefined })
  const WT = '.claude/worktrees/wf_' + baseArgs.stamp + '-integration'
  // Setup: worktree add, never a main-checkout branch creation.
  assert(prompts['setup'].includes('git worktree add ' + WT),
    'intwt: setup cuts the dedicated integration worktree')
  assert(!prompts['setup'].includes('git checkout -b'),
    'intwt: setup never creates the branch on the session checkout')
  assert(!prompts['setup'].includes('session repo main checkout'),
    'intwt: setup prompt drops the main-checkout framing')
  // Setup bootstraps the fresh worktree once (merge agents run tests there).
  assert(prompts['setup'].includes('pip install -e .'),
    'intwt: setup runs bootstrapCmd inside the integration worktree')
  // Merge + reconcile-capable prompts name the worktree, not the main checkout.
  const mergeLabel = Object.keys(prompts).find((l) => /^merge:wave/.test(l))
  assert(mergeLabel && prompts[mergeLabel].includes(WT),
    'intwt: merge agent operates inside the integration worktree')
  assert(!prompts[mergeLabel].includes('session repo main checkout'),
    'intwt: merge prompt drops the main-checkout framing')
  // Critic: detach happens INSIDE the worktree — it doubles as the branch release.
  assert(prompts['integration'].includes(WT),
    'intwt: completeness critic operates inside the integration worktree')
  assert(prompts['integration'].includes('git checkout --detach'),
    'intwt: critic still performs the sha-verified detach')
  // Reviewers keep their non-isolated read-only discipline untouched (A2).
  const reviewLabel = Object.keys(prompts).find((l) => /^review:/.test(l))
  assert(reviewLabel && !prompts[reviewLabel].includes(WT),
    'intwt: reviewer prompt is not rerouted into the worktree')
  assert(r.tasks.every((t) => t.status === 'done'), 'intwt: run completes')
  console.log('scenario integration-worktree: OK')
}
```

Add `await scenarioIntegrationWorktree()` to the runner block.

- [ ] **Step 2: Run the sim to verify it fails**

Run: `node tests/sim_workflow.mjs`
Expected: FAIL at `intwt: setup cuts the dedicated integration worktree` — today's setup prompt says `git checkout -b` on the session repo main checkout.

- [ ] **Step 3: Rewrite the prompt source (`references/wave-merge.md`)**

Replace the `<!-- BAKE:SETUP_PROMPT -->` block (the fresh-run prompt above the resume block; adjust surrounding prose accordingly):

```markdown
<!-- BAKE:SETUP_PROMPT -->
You are the setup agent. The engine never mutates the session checkout: create the dedicated integration worktree instead. From the session repo root run: git worktree add {{INTEGRATION_WT}} -b {{INTEGRATION_BRANCH}}{{BASE_BRANCH_ARG}}. {{BOOTSTRAP_LINE}}Then establish the test baseline inside {{INTEGRATION_WT}}: {{TEST_INSTRUCTION}} and record whether it passes. Report the branch name, its HEAD sha, and the baseline result in your JSON result.
<!-- /BAKE -->
```

Replace the `<!-- BAKE:SETUP_PROMPT_RESUME -->` block:

```markdown
<!-- BAKE:SETUP_PROMPT_RESUME -->
You are the setup agent. The EXISTING integration branch {{INTEGRATION_BRANCH}} must already exist; report BLOCKED if it does not, and do not create a new branch. Materialize its dedicated worktree: if {{INTEGRATION_WT}} already exists, check out {{INTEGRATION_BRANCH}} inside it; otherwise run git worktree add {{INTEGRATION_WT}} {{INTEGRATION_BRANCH}} from the session repo root. Then establish the test baseline inside {{INTEGRATION_WT}}: {{TEST_INSTRUCTION}} and record whether it passes. Report the branch name, its HEAD sha, and the baseline result in your JSON result.
<!-- /BAKE -->
```

Replace the `<!-- BAKE:MERGE_PROMPT -->` block:

```markdown
<!-- BAKE:MERGE_PROMPT -->
You are the wave merge agent, operating ONLY inside the dedicated integration worktree at {{INTEGRATION_WT}} — never the session main checkout. cd into it; echo git rev-parse HEAD and git branch --show-current; if the branch is not the integration branch you were asked to operate on, report BLOCKED and merge nothing — do not detach or move any other checkout. Merge each reported branch in the given task-index order (deterministic, so conflicts are reproducible). After all merges succeed, {{TEST_INSTRUCTION}}. Report MERGED with the final HEAD sha, or CONFLICT / TEST_FAILED with the conflict diff or failing output.
<!-- /BAKE -->
```

Replace the `<!-- BAKE:RECONCILE_PROMPT -->` block:

```markdown
<!-- BAKE:RECONCILE_PROMPT -->
You are the reconciliation agent for {{INTEGRATION_BRANCH}}, operating ONLY inside the dedicated integration worktree at {{INTEGRATION_WT}} — never the session main checkout. cd into it; echo git rev-parse HEAD and git branch --show-current; if the branch is not the integration branch you were asked to operate on, report BLOCKED and merge nothing — do not detach or move any other checkout. You are given a merge conflict diff or failing test output. Resolve it on the integration branch, then {{TEST_INSTRUCTION}}. Report MERGED on success, or CONFLICT / TEST_FAILED with detail if you cannot resolve it.
<!-- /BAKE -->
```

In the `<!-- BAKE:COMPLETENESS_PROMPT -->` block, insert after the first (read-only preamble) line:

```markdown
Operate ONLY inside the dedicated integration worktree at {{INTEGRATION_WT}} — never the session main checkout; your verified detach there also frees the integration branch for the gate.
```

(The rest of the completeness block — the sha-verified `git checkout --detach`, ancestry assertions, deferredVerification taxonomy — is unchanged.)

Update the surrounding prose in the same file: the "Worktree and Branch Facts" section gains a paragraph naming `<repo>/.claude/worktrees/wf_<stamp>-integration` as the dedicated integration worktree (stamp-based because the script knows `args.stamp`, not the runtime `wf_<runId>`; covered by the repo-wide `wf_*` sweep at Approve, not by `--run` scoping); the "Per-Wave Merge" intro sentence "(non-isolated, running in the main checkout)" becomes "(non-isolated, running in the dedicated integration worktree)"; the "Integration and Completeness Review" intro's "from the main checkout" becomes "inside the integration worktree, whose verified detach also frees the integration branch for the frozen Approve checkout".

- [ ] **Step 4: Re-bake into `waves.js`**

In `skills/ultrapowers/harnesses/waves.js`:

Add, next to the existing prompt-building bindings (after `testInstruction`):

```js
// The dedicated integration worktree (#84): the engine never mutates the
// session checkout. Stamp-named — the script knows args.stamp, not the
// runtime wf_<runId> — and covered by sweep_worktrees.sh's repo-wide wf_*
// glob at Approve. The completeness critic's sha-verified detach inside it
// doubles as the branch release the frozen ultra_gate.py --approve
// checkout needs (a critic that never detached reports BLOCKED, and a
// BLOCKED gate is never Approved).
const INTEGRATION_WT = '.claude/worktrees/wf_' + stamp + '-integration'
```

(using the script's existing `stamp` binding — the same one that names the run dir). Then rebuild the four prompt constants to the exact wave-merge.md wording with the interpolations:

```js
const SETUP_PROMPT = resume
  ? ('You are the setup agent. The EXISTING integration branch ' + integrationBranch +
     ' must already exist; report BLOCKED if it does not, and do not create a new ' +
     'branch. Materialize its dedicated worktree: if ' + INTEGRATION_WT + ' already ' +
     'exists, check out ' + integrationBranch + ' inside it; otherwise run ' +
     'git worktree add ' + INTEGRATION_WT + ' ' + integrationBranch + ' from the ' +
     'session repo root. Then establish the test baseline inside ' + INTEGRATION_WT +
     ': ' + testInstruction + ' and record whether it passes. ' +
     'Report the branch name, its HEAD sha, and the baseline result in your JSON result.')
  : ('You are the setup agent. The engine never mutates the session checkout: ' +
     'create the dedicated integration worktree instead. From the session repo root ' +
     'run: git worktree add ' + INTEGRATION_WT + ' -b ' + integrationBranch +
     (baseBranch ? (' ' + baseBranch) : '') + '. ' +
     (bootstrapCmd ? ('WORKTREE SETUP: after creating it, run `' + bootstrapCmd +
       '` inside ' + INTEGRATION_WT + ' — fresh worktrees have no installed ' +
       'dependencies, and merge agents run the test suite there. ') : '') +
     'Then establish the test baseline inside ' + INTEGRATION_WT + ': ' +
     testInstruction + ' and record whether it passes. ' +
     'Report the branch name, its HEAD sha, and the baseline result in your JSON result.')

const MERGE_PROMPT =
  'You are the wave merge agent, operating ONLY inside the dedicated integration ' +
  'worktree at ' + INTEGRATION_WT + ' — never the session main checkout. cd into ' +
  'it; echo git rev-parse HEAD and git branch --show-current; if the branch is ' +
  'not the integration branch you were asked to operate on, report BLOCKED and ' +
  'merge nothing — do not detach or move any other checkout. Merge each reported ' +
  'branch in the given task-index order (deterministic, so conflicts are ' +
  'reproducible). After all merges succeed, ' + testInstruction + '. Report ' +
  'MERGED with the final HEAD sha, or CONFLICT / TEST_FAILED with the conflict ' +
  'diff or failing output.'

const RECONCILE_PROMPT =
  'You are the reconciliation agent for ' + integrationBranch + ', operating ONLY ' +
  'inside the dedicated integration worktree at ' + INTEGRATION_WT + ' — never ' +
  'the session main checkout. cd into it; echo git rev-parse HEAD and git branch ' +
  '--show-current; if the branch is not the integration branch you were asked to ' +
  'operate on, report BLOCKED and merge nothing — do not detach or move any ' +
  'other checkout. You are given a merge conflict diff or failing test output. ' +
  'Resolve it on the integration branch, then ' + testInstruction + '. Report ' +
  'MERGED on success, or CONFLICT / TEST_FAILED with detail if you cannot resolve it.'
```

In `completenessPrompt`, insert immediately after the read-only preamble line (`'...never fix it.\n' +`):

```js
  'Operate ONLY inside the dedicated integration worktree at ' + INTEGRATION_WT +
  ' — never the session main checkout; your verified detach there also frees the ' +
  'integration branch for the gate.\n' +
```

If the existing `bootstrapCmd` threading comment (`// The non-isolated roles (setup/merge/reconcile/completeness) operate on the session main checkout, which already has its deps, so they do not run it.`) exists, update it: setup now receives the command for the integration worktree; merge/reconcile/completeness still do not re-run it (setup bootstrapped their tree once).

- [ ] **Step 5: Run the sims and pins to green**

Run: `node tests/sim_workflow.mjs`
Expected: exit 0, `ALL SCENARIOS PASSED` — the new scenario and every existing one (existing scenarios assert result shapes, not the old prompt wording; any existing assertion that pinned the old "session repo main checkout" phrasing in these four prompts must be updated to the new worktree phrasing as part of this step, keeping its intent).

Run: `python3 -m pytest tests/test_canary.py tests/test_no_prompt_drift.py -v`
Expected: ALL PASS (wave-merge.md and waves.js were edited together; no reviewer-prompts BAKE block changed).

- [ ] **Step 6: Verify the frozen boundary and commit**

Run: `git diff --stat skills/ultrapowers/scripts/gate_check.py skills/ultrapowers/scripts/ultra_gate.py skills/ultrapowers/scripts/run_lock.sh skills/ultrapowers/scripts/run_acceptance.sh`
Expected: empty output.

```bash
git add skills/ultrapowers/harnesses/waves.js skills/ultrapowers/references/wave-merge.md tests/sim_workflow.mjs
git commit -m "feat: integration happens in a dedicated worktree — the engine never mutates the session checkout (#84)"
```

---

### Task 2: SKILL.md wording

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/SKILL.md`

**Interfaces:**
- Consumes: nothing from sibling tasks.
- Produces: nothing sibling tasks rely on (operator-facing prose).

- [ ] **Step 1: Update the Step 4 description**

In `skills/ultrapowers/SKILL.md` Step 4, replace the sentence:

```markdown
The headless workflow creates the
branch, runs/merges/reconciles each wave (16-agent cap), then reviews
completeness (`references/wave-merge.md`).
```

with:

```markdown
The headless workflow creates the
branch in a dedicated integration worktree — no engine agent ever mutates the
session checkout — runs/merges/reconciles each wave (16-agent cap), then
reviews completeness (`references/wave-merge.md`).
```

- [ ] **Step 2: Update the Step 5 restore rationale**

In Step 5, replace:

```markdown
Its first act is to restore the session checkout the run started from — the
pre-launch snapshot, not a bare `git checkout <baseBranch>` (which would strand
the gate on the integration branch).
```

with:

```markdown
Its first act is to restore the session checkout the run started from — the
pre-launch snapshot, not a bare `git checkout <baseBranch>` (which would strand
the gate on the integration branch). With integration in its dedicated
worktree the engine never moved the checkout, so this restore is normally a
no-op — it remains the fail-safe against operator-caused drift.
```

- [ ] **Step 3: Verify and commit**

Run: `grep -c "dedicated integration worktree" skills/ultrapowers/SKILL.md`
Expected: `1` or more.

```bash
git add skills/ultrapowers/SKILL.md
git commit -m "docs: SKILL.md describes dedicated-worktree integration; restore is the fail-safe no-op (#84)"
```

---

### Task 3: Suite gate

**Type:** gate
**Depends-on:** 1, 2

- [ ] **Step 1: Run the full committed suite**

Run: `python3 -m pytest`
Expected: all tests pass.

- [ ] **Step 2: Run the harness sim**

Run: `node tests/sim_workflow.mjs`
Expected: exit 0 and `ALL SCENARIOS PASSED` (the drain's suite gate also runs this automatically because `harnesses/*.js` changed).

- [ ] **Step 3: Re-verify the frozen boundary**

Run: `git diff --stat <base>...HEAD -- skills/ultrapowers/scripts/gate_check.py skills/ultrapowers/scripts/ultra_gate.py skills/ultrapowers/scripts/run_lock.sh skills/ultrapowers/scripts/run_acceptance.sh` (where `<base>` is the ref this branch grew from)
Expected: empty output — the frozen periphery is byte-identical.
