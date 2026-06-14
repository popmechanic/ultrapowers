# Verification-role discipline Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Acceptance:** suite — an ultrapowers engine/skill/prompt change whose operator reads every diff; verification is the committed suite (`tests/sim_workflow.mjs` + `tests/test_no_prompt_drift.py`) plus `validate_skill.py`, not a held-out exam. The change is to the verification machinery itself.

**Goal:** Make the completeness critic provably review the exact tree the run produced, and make every review role read-only, so a "review verdict: clean" cannot come from the wrong tree or from a role that wrote the code it grades.

**Architecture:** Three independent edits to the ultrapowers skill, all enforcement-by-prompt-and-gate (the engine has no sandbox). (1) The baked completeness prompt is rebuilt per-dispatch to pin the critic to the run's merge HEAD (`waveBaseSha`) via a detached checkout + `git rev-parse` self-check, and both review prompts gain read-only language — kept in sync with their source-of-truth reference files by the existing drift test. (2) `SKILL.md` Step 5 gains a deterministic clean-checkout + integration-HEAD assertion before Approve. (3) `report-format.md` documents both new behaviors. These are design sections #1–#4 of the spec.

**Tech Stack:** Markdown skill references + a frozen JavaScript workflow (`harnesses/waves.js`), verified by Python (`pytest`) and a Node self-asserting simulation (`tests/sim_workflow.mjs`). Re-bake discipline: every prompt edit lands in the source reference first, then verbatim in `waves.js`; `tests/test_no_prompt_drift.py` asserts the two stay in sync (whole-block for `reviewer-prompts.md`, static-fragments-in-order for `wave-merge.md`'s `{{placeholder}}` blocks).

**Verification command (this repo, mirrors CI):**
```bash
python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers && \
python3 skills/ultrapowers/scripts/validate_skill.py skills/ultraplan && \
python3 -m pytest tests/ -q
```

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `skills/ultrapowers/references/wave-merge.md` | Source of truth for `COMPLETENESS_PROMPT` (and setup/merge/reconcile). Gains `{{MERGE_HEAD_SHA}}`, detach+rev-parse+BLOCKED, read-only language. | 1 |
| `skills/ultrapowers/references/reviewer-prompts.md` | Source of truth for `GUARD` + `REVIEWER_PROMPT`. GUARD clarifies the read/write split + no-foreign-primary-checkout rule; REVIEWER_PROMPT gains read-only language. | 1 |
| `skills/ultrapowers/harnesses/waves.js` | The frozen workflow. Re-bakes GUARD + REVIEWER_PROMPT verbatim; converts `COMPLETENESS_PROMPT` to a per-dispatch `completenessPrompt(mergeHeadSha)` threaded with `waveBaseSha`. | 1 |
| `tests/sim_workflow.mjs` | Self-asserting simulation. New scenario asserts the dispatched completeness prompt carries the merge HEAD + detach/rev-parse, and review prompts carry read-only language. | 1 |
| `skills/ultrapowers/SKILL.md` | Orchestrator. Step 5 gains the clean-checkout + integration-HEAD assertion before Approve. | 2 |
| `skills/ultrapowers/references/report-format.md` | Report doc. Notes the critic's BLOCKED-on-wrong-tree path and the gate's clean-checkout precondition. | 3 |
| `tests/test_no_prompt_drift.py` | **Not edited.** Derives BAKE fragments from source; the new `{{MERGE_HEAD_SHA}}` fragment rides in automatically. Must stay green (covered by Task 1's suite run). | — |

**Why Task 1 is one task, not three:** the prompt source files and their baked `waves.js` copies are bound by `test_no_prompt_drift.py` — editing a source `.md` without the matching `waves.js` re-bake turns the drift test red. `sim_workflow.mjs` tests `waves.js`'s dispatched-prompt behavior. All four files therefore move together or not at all; splitting them would force write-after-write serialization on `waves.js` and `sim_workflow.mjs` anyway. Tasks 2 and 3 touch disjoint files and depend on nothing Task 1 produces (they document/assert designed behavior, not Task 1's symbols), so all three run in parallel.

---

### Task 1: Critic operates on a verified tree, review roles are read-only

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/references/wave-merge.md` (the `<!-- BAKE:COMPLETENESS_PROMPT -->` block)
- Modify: `skills/ultrapowers/references/reviewer-prompts.md` (the `<!-- BAKE:GUARD -->` and `<!-- BAKE:REVIEWER_PROMPT -->` blocks)
- Modify: `skills/ultrapowers/harnesses/waves.js` (the `GUARD` const, `REVIEWER_PROMPT` array, `COMPLETENESS_PROMPT` const + its dispatch site)
- Test: `tests/sim_workflow.mjs` (new scenario), `tests/test_no_prompt_drift.py` (existing, must stay green)

This task implements spec sections #1 (critic on a known, verified tree), #2 (review roles read-only), and #3 (the GUARD names the linked-worktree / foreign-primary-checkout hazard). It is verified by a new self-asserting simulation scenario and by the existing anti-drift guard.

Re-bake rule for every prompt change here: edit the source reference block first, then copy the same words verbatim into `waves.js`. The drift test normalizes away markdown/punctuation/possessives and em-dashes, so the baked copy may use plain concatenation without em-dashes (it already does) — but the **words** must match in order.

Concurrency note: this task runs its suite (`pytest`, which shells out to `node tests/sim_workflow.mjs`) in its own worktree with no shared ports or on-disk fixtures — safe to run beside Tasks 2 and 3.

- [ ] **Step 1: Add a failing simulation scenario for the two behaviors**

In `tests/sim_workflow.mjs`, add this new scenario function immediately before the final block of `await scenario…()` calls (the block that ends with `console.log('ALL SCENARIOS PASSED')`):

```javascript
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
```

Then register it: in the trailing run block, add `await scenarioReviewDiscipline()` on the line immediately before `console.log('ALL SCENARIOS PASSED')`:

```javascript
await scenarioAcceptanceSuiteRed()
await scenarioReviewDiscipline()
console.log('ALL SCENARIOS PASSED')
```

- [ ] **Step 2: Run the simulation and confirm it FAILS**

Run: `node tests/sim_workflow.mjs`
Expected: FAIL — `SIM ASSERT FAILED: review-discipline: completeness prompt carries the run merge HEAD sha (...)` (the current `COMPLETENESS_PROMPT` does not interpolate `waveBaseSha`, has no detach/rev-parse instruction, and carries no read-only language).

- [ ] **Step 3: Rewrite the `COMPLETENESS_PROMPT` source block in `wave-merge.md`**

Replace the entire `<!-- BAKE:COMPLETENESS_PROMPT -->` … `<!-- /BAKE -->` block (currently the single "What plan requirement is unmet?… from the main checkout…" paragraph) with:

```
<!-- BAKE:COMPLETENESS_PROMPT -->
You are a REVIEW role. Do not write files, create commits, stage changes, or modify the tree in any way. Your only output is your findings/verdict. If the work is wrong, report it — never fix it.
{{PLAN_STEP}}First, put yourself on the exact tree the run produced: the integration HEAD is {{MERGE_HEAD_SHA}}. If that value is empty, report BLOCKED and produce no findings — do not guess a tree. Otherwise run git checkout --detach {{MERGE_HEAD_SHA}}, then git rev-parse HEAD and confirm it equals {{MERGE_HEAD_SHA}}; if it does not, report BLOCKED and produce no findings. Only once you are verified on that tree: what plan requirement is unmet? What claim is unverified? What code path is untested? {{TEST_INSTRUCTION}}, then review the integrated result against the original plan. List every gap, unverified claim, and untested path.
<!-- /BAKE -->
```

Also update the prose sentence just above the block (currently "The canonical prompt wording (`{{PLAN_STEP}}` is the optional …):") so it documents the new token:

```
The canonical prompt wording (`{{PLAN_STEP}}` is the optional "Read the original plan document at `args.planPath` first." sentence; `{{MERGE_HEAD_SHA}}` is `waveBaseSha` — the last wave's `merge.headSha` — interpolated at dispatch, empty if the run recorded no merge HEAD):
```

- [ ] **Step 4: Rewrite the `GUARD` source block in `reviewer-prompts.md`**

Replace the entire `<!-- BAKE:GUARD -->` … `<!-- /BAKE -->` block with the version that names the read/write split (review roles read-only) and the foreign-primary-checkout hazard:

```
<!-- BAKE:GUARD -->
SAFETY: Operate ONLY inside the git worktree assigned to you, or — for the setup, merge, and reconcile roles — the session repository's main checkout, which those write-side roles may modify. Review roles (the per-task reviewer and the completeness critic) are READ-ONLY: they operate on a detached checkout and never write files, create commits, stage changes, or otherwise mutate any tree — their only output is their report payload. You operate in the workflow's launch working directory, the session repository; never resolve to, check out, or detach a DIFFERENT primary checkout of the same repository — moving the user's primary checkout off its branch is a forbidden, undisclosed side effect. Before any git command, confirm the target directory exists and is a git repository. If a path is missing, empty, the literal string undefined, ambiguous, or not a git repo, STOP immediately and report BLOCKED. NEVER run git or write files in an unrelated repository, and NEVER fall back to your current working directory.
<!-- /BAKE -->
```

- [ ] **Step 5: Add read-only language to the `REVIEWER_PROMPT` source block in `reviewer-prompts.md`**

Inside the `<!-- BAKE:REVIEWER_PROMPT -->` block, insert the read-only paragraph between the first line ("You are an independent reviewer…verdict.") and the `**Mandate:**` line. The block's opening becomes:

```
<!-- BAKE:REVIEWER_PROMPT -->
You are an independent reviewer. You receive the original task text and the implementer's diff. You have no access to the Skill tool and must not consult the implementer report when forming your verdict.

You are a REVIEW role. Do not write files, create commits, stage changes, or modify the tree in any way. Your only output is your findings/verdict. If the work is wrong, report it — never fix it.

**Mandate:** verify everything independently. Do not trust the implementer report.
```

Leave the rest of the `REVIEWER_PROMPT` block (Spec compliance / Code quality / return-JSON) unchanged.

- [ ] **Step 6: Re-bake the `GUARD` const in `waves.js`**

Replace the `GUARD` const (the block beginning `const GUARD =`) with the re-baked copy (plain concatenation, em-dashes dropped — the drift test normalizes them away; it still starts with `SAFETY: Operate ONLY inside the git worktree` so the sim's per-prompt GUARD check holds):

```javascript
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
```

- [ ] **Step 7: Re-bake the `REVIEWER_PROMPT` array in `waves.js`**

In the `REVIEWER_PROMPT = [ … ]` array, insert the read-only paragraph as two new elements right after the first element (the "You are an independent reviewer…verdict." string) and its following `''`. The array head becomes:

```javascript
const REVIEWER_PROMPT = [
  'You are an independent reviewer. You receive the original task text and the implementer diff. You have no access to the Skill tool and must not consult the implementer report when forming your verdict.',
  '',
  'You are a REVIEW role. Do not write files, create commits, stage changes, or modify the tree in any way. Your only output is your findings/verdict. If the work is wrong, report it — never fix it.',
  '',
  'Mandate: verify everything independently. Do not trust the implementer report.',
  '',
  'Spec compliance:',
```

Leave the remaining array elements (numbered checks 1–8, the SIBLING FILES paragraph, the closing return-JSON line) unchanged.

- [ ] **Step 8: Re-bake `COMPLETENESS_PROMPT` as a per-dispatch function and thread `waveBaseSha`**

Replace the `COMPLETENESS_PROMPT` const (the block beginning `const COMPLETENESS_PROMPT =` through its closing line ending `untested path.'`) with a function of the merge HEAD sha:

```javascript
// Completeness critic prompt, built per-dispatch so it pins the critic to the
// EXACT tree the run produced (waveBaseSha = the last wave's merge.headSha).
// #29: a critic that reviews the wrong tree emits confident false findings — the
// detached checkout is immune to the integration-branch lock, and an empty sha
// forces BLOCKED rather than a guessed tree. Read-only review-role language: #32.
const completenessPrompt = (mergeHeadSha) =>
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
  ', then review the integrated result against the original plan. List every ' +
  'gap, unverified claim, and untested path.'
```

Then update the single dispatch site (in the "Integration + completeness review" section, the `agent(` call labelled `'integration'`). Change the prompt argument from `GUARD + '\n\n' + COMPLETENESS_PROMPT +` to call the function with the current review base:

```javascript
    review = await agent(
      GUARD + '\n\n' + completenessPrompt(waveBaseSha) +
        '\n\nTasks:\n' + taskList + '\nBlocked waves:\n' + JSON.stringify(blockedWaves) +
        (baseline.passed === false
          ? '\nBaseline: the test suite FAILED before any task ran — ' + (baseline.output || 'no output')
          : ''),
      { label: 'integration', model: REVIEWER_MODEL, schema: REVIEW_SCHEMA }
    )
```

(`waveBaseSha` at this point holds the last successful wave's `merge.headSha` — the integration HEAD — or `setup.headSha` if no wave merged, or is empty if even that was unrecorded, in which case the prompt's empty-sha branch forces BLOCKED.)

- [ ] **Step 9: Run the full verification suite and confirm GREEN**

Run:
```bash
node tests/sim_workflow.mjs && \
python3 -m pytest tests/test_no_prompt_drift.py -q && \
python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers && \
python3 skills/ultrapowers/scripts/validate_skill.py skills/ultraplan && \
python3 -m pytest tests/ -q
```
Expected: the sim prints `scenario review-discipline: OK` then `ALL SCENARIOS PASSED`; the drift test passes (source blocks match the re-baked `waves.js`); both `validate_skill.py` runs print `skill ok`; `pytest tests/` is green.

If the drift test fails, the source `.md` words and the `waves.js` words diverged — diff the normalized forms and reconcile (do not edit the test).

- [ ] **Step 10: Commit**

```bash
git add skills/ultrapowers/references/wave-merge.md skills/ultrapowers/references/reviewer-prompts.md skills/ultrapowers/harnesses/waves.js tests/sim_workflow.mjs
git commit -m "fix: pin completeness critic to verified merge HEAD; review roles read-only (#29, #32)"
```

---

### Task 2: Gate-side clean-checkout assertion in SKILL.md Step 5

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/SKILL.md` (Step 5, the pre-merge gate)

This task implements spec section #4 — the deterministic guard the misbehaving role cannot fake. It is orchestrator prose executed by the main session at the gate (the engine has no shell). Per the spec's §Testing, this is exercised by inspection at the next real run, not a unit test; its verification here is that `validate_skill.py` and `pytest tests/` stay green and the prose matches the spec. No source/baked re-bake is involved (SKILL.md is not baked into `waves.js`).

Concurrency note: this task edits only `SKILL.md` — disjoint from Tasks 1 and 3 — and runs `pytest` in its own worktree. Safe to run in parallel.

- [ ] **Step 1: Insert the clean-checkout + integration-HEAD assertion into Step 5**

In `skills/ultrapowers/SKILL.md`, find the paragraph in Step 5 that begins `**First, restore the session checkout.**` and ends `…so the work *looks* prematurely merged when it is not.` Immediately after that paragraph (before the `**Optionally, audit the run's effort**` paragraph), insert this new paragraph verbatim:

```markdown
**Then assert the session checkout is clean and on the right tree — the deterministic guard for #29/#32.** A misbehaving review role cannot police itself and the engine has no shell, so this check lives here, where the main session does have one. On the session repo, before any gate decision:

- `git status --porcelain` MUST be **empty**. A non-empty result means a role wrote outside the worktree discipline (as in #32) — that work is unreviewed by construction. Do **not** Approve: surface the diff to the human as a `BLOCKED` condition for explicit disposition; never silently absorb or `git reset` it away (silently moving trees is the very behavior #29 punished).
- The integration branch HEAD MUST **equal** the report's last merge headSha: `git rev-parse <integrationBranch>` must match `waveMerges[<last>].headSha` from the report (read the branch without checking it out — you restored `<baseBranch>` above). A mismatch means the tree on disk is not the one the run produced (checkout drift, #29) — do **not** Approve; surface the mismatch as `BLOCKED` and re-verify before any merge.

Only when the checkout is clean AND the integration HEAD matches the reported merge headSha do you proceed to the `tests.passed` / acceptance gating below.
```

- [ ] **Step 2: Verify the skill still validates and the suite is green**

Run:
```bash
python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers && \
python3 -m pytest tests/ -q
```
Expected: `skill ok`; `pytest tests/` green (no test pins SKILL.md prose, so the additive paragraph cannot regress them — this confirms the edit did not corrupt frontmatter or a cross-reference).

- [ ] **Step 3: Commit**

```bash
git add skills/ultrapowers/SKILL.md
git commit -m "fix: gate-side clean-checkout + integration-HEAD assertion before Approve (#29, #32)"
```

---

### Task 3: Document the BLOCKED-on-wrong-tree path and gate precondition

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/references/report-format.md` (the `completenessFindings` field row and the Approve presentation bullet)

This task implements spec section #5 — the report doc records the critic's `BLOCKED`-on-wrong-tree path and the gate's clean-checkout precondition. It documents designed behavior (drawn from this plan/spec, not from Task 1's or Task 2's symbols), so it carries no dependency on them and runs in parallel. Verification is `validate_skill.py` + `pytest tests/` staying green and review against the spec.

Concurrency note: this task edits only `report-format.md` — disjoint from Tasks 1 and 2 — and runs `pytest` in its own worktree. Safe to run in parallel.

- [ ] **Step 1: Document the critic's BLOCKED-on-wrong-tree path**

In `skills/ultrapowers/references/report-format.md`, find the `completenessFindings` row in the field-reference table (currently `| completenessFindings | no | Gaps found by the completeness critic — unmet plan requirements, unverified claims, untested code paths |`) and replace it with:

```markdown
| `completenessFindings` | no | Gaps found by the completeness critic — unmet plan requirements, unverified claims, untested code paths. Before producing any finding the critic detaches to the run's merge HEAD (`waveBaseSha` = `waveMerges[last].headSha`) and confirms `git rev-parse HEAD` matches it; if it cannot (detach fails, `rev-parse` mismatch, or no merge headSha was recorded) it reports **BLOCKED** and produces no findings. A BLOCKED critic is **not** a clean review — the gate must not treat empty findings from a BLOCKED critic as a pass (#29). The critic is a read-only review role: it never writes files or commits (#32). |
```

- [ ] **Step 2: Document the gate's clean-checkout precondition**

In the same file, find the **Approve** bullet in the Presentation section (it begins `- **Approve** — first gate on the report's \`tests.passed\`…`). Insert a new sentence at the start of that bullet's body, right after `- **Approve** — `:

```markdown
- **Approve** — before any gate decision, assert the session checkout is clean (`git status --porcelain` empty) and the integration branch HEAD equals `waveMerges[last].headSha`; a dirty tree or a mismatch is a `BLOCKED` condition surfaced to the human for explicit disposition, never silently merged or reset (#29/#32; the executable form is `SKILL.md` Step 5). Then first gate on the report's `tests.passed`: if false, do NOT hand off; present the failure and offer Redirect instead. If true: `git checkout <integrationBranch>` (finishing-a-development-branch verifies tests on the CURRENT checkout, and the sweep classifies 'merged' against HEAD), then run `bash ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/sweep_worktrees.sh` (the deterministic sweep — do not assume the merge agents' prompted cleanup ran; locked worktrees are kept by default (pass `--force` to remove them); concurrent runs in one repo remain unsupported), then proceed to `superpowers:finishing-a-development-branch`; the orchestrator carries the post-merge runbook and presents it again when that handoff completes.
```

(This preserves every word of the original Approve bullet; it only prepends the clean-checkout precondition sentence.)

- [ ] **Step 3: Verify the skill still validates and the suite is green**

Run:
```bash
python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers && \
python3 -m pytest tests/ -q
```
Expected: `skill ok`; `pytest tests/` green (report-format.md is a prose reference with no test pins; this confirms the edit kept references intact).

- [ ] **Step 4: Commit**

```bash
git add skills/ultrapowers/references/report-format.md
git commit -m "docs: note critic BLOCKED-on-wrong-tree path and gate clean-checkout precondition (#29, #32)"
```

---

### Task 4: Full verification suite (gate)

**Type:** gate
**Depends-on:** 1, 2, 3

The acceptance authority for this `suite`-mode plan. Not executed as a wave task; its command informs `testCmd` and is asserted at the pre-merge gate. The integration must be green on:

```bash
python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers && \
python3 skills/ultrapowers/scripts/validate_skill.py skills/ultraplan && \
python3 -m pytest tests/ -q
```

Expectations:
- Both `validate_skill.py` runs print `skill ok` (frontmatter + cross-reference integrity for the edited skill files).
- `pytest tests/` is green, including:
  - `tests/test_no_prompt_drift.py` — the re-baked GUARD / REVIEWER_PROMPT / COMPLETENESS_PROMPT match their source reference blocks (the new `{{MERGE_HEAD_SHA}}` fragment rides in automatically).
  - `tests/test_workflow_sim.py` → `tests/sim_workflow.mjs` — the new `scenario review-discipline` passes (completeness prompt carries the merge HEAD + detach/rev-parse; review prompts carry read-only language), and every existing scenario still passes.

---

## Self-Review

**1. Spec coverage:**
- §Design 1 (critic on a known, verified tree) → Task 1 Steps 3, 8 (`{{MERGE_HEAD_SHA}}`, detach-to-sha, `rev-parse` self-check, BLOCKED-on-mismatch, `waveBaseSha` threading) + Step 1 assertions. ✓
- §Design 2 (review roles read-only) → Task 1 Steps 3, 4, 5, 7, 8 (read-only language in COMPLETENESS_PROMPT + REVIEWER_PROMPT + GUARD). ✓
- §Design 3 (GUARD names the linked-worktree / foreign-primary-checkout hazard) → Task 1 Steps 4, 6. ✓
- §Design 4 (gate-side clean-checkout assertion) → Task 2. ✓
- §Components: wave-merge.md, reviewer-prompts.md, waves.js, SKILL.md, report-format.md → Tasks 1–3. sim_workflow.mjs → Task 1. test_no_prompt_drift.py → not edited (auto-rechecks), covered by Task 1/4 suite. ✓
- §"This plan's acceptance disposition" (`suite`) → declared in the header; Task 4 gate. ✓
- §Error handling (BLOCKED on detach-fail/rev-parse-mismatch/empty-sha; dirty checkout; HEAD≠headSha) → Task 1 prompt text + Task 2 gate + Task 3 docs. ✓

**2. Placeholder scan:** No "TBD"/"handle edge cases"/"add validation"/"similar to Task N" — every prompt block, const, array, and prose paragraph is given in full. ✓

**3. Type consistency:** `completenessPrompt(mergeHeadSha)` is defined (Step 8) and called as `completenessPrompt(waveBaseSha)` at the one dispatch site (Step 8). `waveBaseSha` is the existing variable (assigned from `merge.headSha`). The shared read-only sentence "You are a REVIEW role. Do not write files, create commits, stage changes, or modify the tree in any way. Your only output is your findings/verdict. If the work is wrong, report it — never fix it." is byte-identical across COMPLETENESS_PROMPT and REVIEWER_PROMPT, which is what the sim's `/REVIEW role/` + `/Do not write files/` checks rely on. ✓

**Ultraplan additions:**
- Every task carries an explicit `**Type:**`. ✓
- The only cross-task constraint is the gate (Task 4 `Depends-on: 1, 2, 3`); the three implementation tasks have `Depends-on: none` and disjoint write sets, so the compiler waves them in parallel with zero edges. ✓
- No preamble holds load-bearing coordination — each task body carries its own concurrency note and re-bake/verify instructions. ✓
- Task 4 is marked `gate` (verification only, writes nothing); there is no `release`/`manual` work in this change. ✓
- No backticked mention references a file another task *creates* — every file is a pre-existing `Modify`, so no `prose-reference` edge is inferred. ✓
- The plan carries an `**Acceptance:** suite` line. ✓
