# Sealed-Acceptance Deterministic Gate Administration Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Acceptance:** suite — ultrapowers' own engine/skill change; verification is its committed suite (test_run_acceptance.py + the prompt-drift and workflow-sim guards) plus a manual live shakedown. A held-out exam authored from the spec would be recursive: the thing under test is the exam administrator itself.

**Goal:** Fix [#36](https://github.com/popmechanic/ultrapowers/issues/36) by moving `sealed`-exam administration out of the no-shell workflow into the SKILL.md Step 5 pre-merge gate (where the main session runs `run_acceptance.sh` directly and treats its exit code as the authority), and fix [#37](https://github.com/popmechanic/ultrapowers/issues/37) by baking a no-code operator vouching rubric into the gate-facing surface.

**Architecture:** The workflow engine (`harnesses/waves.js`) cannot run a shell — `agent()` is its only subprocess route — so today it relays the runner's JSON-object stdout through a cheap model that corrupts it. We delete that relay: the workflow records a non-executing `PENDING_GATE` disposition, and the main Claude session administers the exam deterministically at Step 5 (it already runs Bash there). `suite`/`waived`/`null` dispositions are unchanged. The rubric is prose added to SKILL.md Step 3.

**Tech Stack:** JavaScript (the frozen Dynamic Workflow `waves.js` + its Node sim `tests/sim_workflow.mjs`), python3/pytest (drift + script tests), markdown skills/references.

**Spec:** `docs/superpowers/specs/2026-06-14-sealed-acceptance-gate-fix-design.md`

**Shared contract (restated; each task body restates what it needs):**
- The deterministic runner `skills/ultrapowers/scripts/run_acceptance.sh` is UNCHANGED. It emits one JSON object on stdout and **exits 0 iff the seal verified AND the exam passed**, non-zero for every other outcome (`SEAL_MISSING`, `SEAL_BROKEN`, red exam, runner `ERROR`).
- New workflow disposition for `sealed` mode: `{ mode: 'sealed', sealId, sha256, status: 'PENDING_GATE', passed: null, note: 'administered deterministically at the pre-merge gate' }`.
- The gate (SKILL.md Step 5) administers `sealed` by running `bash <scriptPath> <sealId> <integrationBranch> <sha256>`; exit 0 ⇒ acceptance passed; non-zero ⇒ do not Approve; the emitted JSON is rendered verbatim as receipts.

---

### Task 1: Engine — stop administering sealed exams (delete the relay)

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/harnesses/waves.js`
- Modify: `skills/ultrapowers/references/reviewer-prompts.md`
- Modify: `tests/sim_workflow.mjs`
- Modify: `tests/test_no_prompt_drift.py`

Context: the workflow's `sealed` branch currently dispatches a cheap-model `acceptance-exam` agent and regex-extracts a verdict from its `{ raw }` reply — the broken relay (#36). The Node sim (`tests/sim_workflow.mjs`, run by `tests/test_workflow_sim.py`) has six sealed/waived scenarios that assert relay internals, and the drift guard (`tests/test_no_prompt_drift.py`) pins the `BAKE:ACCEPTANCE-EXAM` prompt block. This task removes the relay and rewires those guards to the new `PENDING_GATE` disposition. The `suite` and `waived` paths are untouched.

- [ ] **Step 1: Rewrite the sim's sealed scenarios to expect PENDING_GATE**

In `tests/sim_workflow.mjs`, REPLACE the entire `scenarioAcceptanceSealedGreen` function (the block starting `// ── Scenario: acceptance-sealed-green` through its closing `}` and `console.log('scenario acceptance-sealed-green: OK')`) with:

```js
// ── Scenario: acceptance-sealed-pending — workflow records PENDING_GATE, no exam ──
// Sealed exams are administered at the gate (SKILL.md Step 5), not in the workflow.
async function scenarioAcceptanceSealedPending() {
  let examDispatched = false
  const acceptanceArg = {
    mode: 'sealed', sealId: 'abc123def456', sha256: 'ab'.repeat(32),
    scriptPath: '/fake/run_acceptance.sh',
  }
  const r = await runWorkflow({
    agent: makeAcceptanceAgent(() => { examDispatched = true; return { raw: '' } }),
    args: Object.assign({}, baseArgs, { acceptance: acceptanceArg }),
    budget: undefined,
  })
  eq(r.acceptance && r.acceptance.mode, 'sealed', 'acceptance-sealed-pending: mode is sealed')
  eq(r.acceptance && r.acceptance.status, 'PENDING_GATE', 'acceptance-sealed-pending: status is PENDING_GATE')
  eq(r.acceptance && r.acceptance.passed, null, 'acceptance-sealed-pending: passed is null (not yet administered)')
  assert(!examDispatched, 'acceptance-sealed-pending: workflow dispatches NO acceptance-exam agent')
  assert(!r.judgmentCalls.some((j) => /acceptance/.test(j)),
    'acceptance-sealed-pending: no acceptance judgmentCall before administration (got ' + JSON.stringify(r.judgmentCalls) + ')')
  console.log('scenario acceptance-sealed-pending: OK')
}
```

Then DELETE these four now-obsolete functions in full (each tested relay internals that no longer exist): `scenarioAcceptanceSealedRed`, `scenarioAcceptanceSealedUnparseable`, `scenarioAcceptanceSealedMissingPassed`, `scenarioAcceptanceSealedAgentThrows`. Leave `scenarioAcceptanceWaived`, `scenarioAcceptanceSuiteGreen`, and `scenarioAcceptanceSuiteRed` untouched, and leave the `makeAcceptanceAgent` helper in place (waived/suite/pending scenarios still use it).

In the await-call list near the end of the file, REPLACE these six lines:

```js
await scenarioAcceptanceSealedGreen()
await scenarioAcceptanceSealedRed()
await scenarioAcceptanceWaived()
await scenarioAcceptanceSealedUnparseable()
await scenarioAcceptanceSealedMissingPassed()
await scenarioAcceptanceSealedAgentThrows()
```

with:

```js
await scenarioAcceptanceSealedPending()
await scenarioAcceptanceWaived()
```

(Leave `await scenarioAcceptanceSuiteGreen()` and `await scenarioAcceptanceSuiteRed()` as they are.)

- [ ] **Step 2: Run the sim to verify it now fails**

Run: `node tests/sim_workflow.mjs`
Expected: FAIL — `acceptance-sealed-pending: status is PENDING_GATE` assertion fails, because `waves.js` still administers the exam and returns `status: 'OK', passed: true`.

- [ ] **Step 3: Replace the relay branch in `waves.js` with the PENDING_GATE disposition**

In `skills/ultrapowers/harnesses/waves.js`, REPLACE the entire `sealed` branch — the block beginning `} else if (ACCEPTANCE && ACCEPTANCE.mode === 'sealed') {` through its matching closing brace (the `phase('Acceptance')` call, the `cmd`/`try`/`catch` relay, and the trailing `if (!acceptance.passed) judgmentCalls.push(...)`) — with:

```js
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
```

In the same file, in the `meta.phases` mutation block, REMOVE the `Acceptance` phase. Change:

```js
    .concat([{ title: 'Integration Review' }, { title: 'Acceptance' }])
```

to:

```js
    .concat([{ title: 'Integration Review' }])
```

Then update the `ACCEPTANCE` arg comment (the block above `const ACCEPTANCE = ...`) so it no longer claims the workflow runs the exam. REPLACE:

```js
// acceptance: sealed-exam administration (spec 2026-06-12-sealed-acceptance).
//   { mode: 'sealed', sealId, sha256, scriptPath }  — scriptPath is the
//   absolute path to run_acceptance.sh, resolved by the orchestrator from the
//   plugin root at launch (the workflow has no filesystem introspection), or
//   { mode: 'waived', reason } or
//   { mode: 'suite', reason }. Absent → report.acceptance = null.
```

with:

```js
// acceptance: disposition carried into the report (spec 2026-06-14-sealed-acceptance-gate-fix).
//   { mode: 'sealed', sealId, sha256 }  — recorded as PENDING_GATE; the SEALED exam is
//     administered deterministically at the pre-merge gate (SKILL.md Step 5), NOT here:
//     the workflow has no shell, and relaying the runner's JSON corrupts it (#36).
//   { mode: 'waived', reason }  — static, passed: null.
//   { mode: 'suite', reason }   — passed mirrors the committed-suite result.
//   Absent → report.acceptance = null.
```

(`scriptPath` may still ride in on the arg object — the orchestrator resolves it for the gate — but the workflow no longer reads it.)

- [ ] **Step 4: Remove the now-dead BAKE:ACCEPTANCE-EXAM block and its drift pin**

In `skills/ultrapowers/references/reviewer-prompts.md`, DELETE the entire "Acceptance exam" section — the `## Acceptance exam` heading, the `<!-- BAKE:ACCEPTANCE-EXAM -->` … `<!-- /BAKE -->` block, and the now-redundant horizontal rule around it — so that a single `---` separates the preceding "Review context" material from the following `## Reviewer prompt` section. Concretely, remove these lines:

```markdown
## Acceptance exam

<!-- BAKE:ACCEPTANCE-EXAM -->
Run EXACTLY this command from the repository root and return its complete stdout verbatim in the "raw" field. Do not interpret the result, do not fix anything, do not retry, and do not run any other command. If the command cannot be executed, put the reason in "raw".
<!-- /BAKE -->

---
```

In `tests/test_no_prompt_drift.py`, remove `ACCEPTANCE-EXAM` from the two lists that name it. Change the tuple in `test_expected_blocks_present`:

```python
    for name in ("GUARD", "IMPLEMENTER_PROMPT", "REVIEWER_PROMPT",
                 "IMPLEMENTER_SCHEMA", "REVIEWER_SCHEMA", "ACCEPTANCE-EXAM"):
```

to:

```python
    for name in ("GUARD", "IMPLEMENTER_PROMPT", "REVIEWER_PROMPT",
                 "IMPLEMENTER_SCHEMA", "REVIEWER_SCHEMA"):
```

and the parametrize list:

```python
@pytest.mark.parametrize("name", ["GUARD", "IMPLEMENTER_PROMPT", "REVIEWER_PROMPT", "ACCEPTANCE-EXAM"])
```

to:

```python
@pytest.mark.parametrize("name", ["GUARD", "IMPLEMENTER_PROMPT", "REVIEWER_PROMPT"])
```

- [ ] **Step 5: Run the sim and the drift/test suite to verify green**

Run: `node tests/sim_workflow.mjs`
Expected: prints `ALL SCENARIOS PASSED` (the `acceptance-sealed-pending`, `acceptance-waived`, and both `suite` scenarios pass; no relay scenarios remain).

Run: `python3 -m pytest tests/test_no_prompt_drift.py tests/test_workflow_sim.py -q`
Expected: all PASS — the drift guard no longer looks for `ACCEPTANCE-EXAM`, and the sim subprocess prints `ALL SCENARIOS PASSED`.

- [ ] **Step 6: Commit**

```bash
git add skills/ultrapowers/harnesses/waves.js skills/ultrapowers/references/reviewer-prompts.md tests/sim_workflow.mjs tests/test_no_prompt_drift.py
git commit -m "fix: workflow records sealed acceptance as PENDING_GATE, drops the broken relay (#36)"
```

---

### Task 2: Skills + docs — gate administration and the vouching rubric

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/SKILL.md`
- Modify: `skills/ultraplan/SKILL.md`
- Modify: `skills/ultrapowers/references/report-format.md`

Context: the pre-merge gate (`ultrapowers/SKILL.md` Step 5) currently reads `acceptance.passed` from the report. With Task 1, `sealed` mode arrives as `PENDING_GATE`/`passed: null`, so the gate must now ADMINISTER the exam itself, deterministically. This task adds that administration, adds the operator vouching rubric to Step 3 (#37), points to it from ultraplan, and updates the report-format doc. No file overlap with Task 1; this is a pure prose/contract diff.

- [ ] **Step 1: Add deterministic sealed administration to the Step 5 Approve gate**

In `skills/ultrapowers/SKILL.md`, find the Step 5 **Approve** bullet (it begins `**Approve** — gate on \`tests.passed && (acceptance is null || acceptance.passed || acceptance.mode === 'waived')\``). REPLACE that gate clause and its sealed handling so it reads (keep the rest of the bullet — the `git checkout`, `sweep_worktrees.sh`, and finishing-a-development-branch handoff — exactly as it is):

```markdown
- **Approve** — gate on `tests.passed` AND the acceptance disposition. If `tests.passed` is false, do NOT hand off; present the failure and offer Redirect. For acceptance: `null` (unmarked) and `waived` always pass the acceptance gate (a waiver is recorded verbatim). `suite` passes iff `acceptance.passed` (it mirrors `tests.passed`). For `sealed` the report shows `status: PENDING_GATE` — **administer the exam now, deterministically, in this session** (the workflow could not: it has no shell, and relaying the runner's JSON through a model corrupts it — #36):

  Run `bash ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/run_acceptance.sh <sealId> <integrationBranch> <sha256>` (the `sealId`/`sha256` are the values the orchestrator carried from compile and echoed in the report's `PENDING_GATE` disposition; the script creates its own detached worktree of the branch, so it is agnostic to the current checkout). **The script's exit code is the authority:** exit 0 ⇒ acceptance passed; any non-zero exit ⇒ do NOT Approve. Render the emitted JSON object verbatim with the report — receipts, not narrative.

  A non-zero exit carries a descriptive `status`: a red exam (`status: OK, passed: false`) offers Redirect/Salvage; `SEAL_BROKEN` (vault tampered) or `SEAL_MISSING` (vault gone) offers re-seal via the ultraplan sealing step (the spec still exists) or an explicit waiver; a runner `ERROR` surfaces its reason. An operator override of a red/broken/missing exam is recorded as a waiver-with-reason in the runbook and the final report. Only when `tests.passed` AND the acceptance gate both pass:
```

(The following lines of the original bullet — `git checkout <integrationBranch>` … `sweep_worktrees.sh` … `superpowers:finishing-a-development-branch` … — stay verbatim immediately after this.)

- [ ] **Step 2: Add the operator vouching rubric to the Step 3 transparency block**

In `skills/ultrapowers/SKILL.md`, immediately AFTER the Step 3 list item `6. **Acceptance disposition** — render the acceptance disposition: \`sealed <seal-id>\` or the verbatim waiver reason. The human approves it with the rest of the interpretation.`, INSERT:

```markdown

   When the disposition is `sealed`, present the exam's plain-English **coverage summary** (appended to the plan by the ultraplan sealing step) and give the operator this rubric for vouching — it needs **no code-reading**:

   > You are not judging whether the test code is correct — you can't see it and don't need to. You are checking that the coverage summary is a faithful, complete restatement of **your** spec:
   > 1. **Everything covered?** Walk the spec one requirement at a time; each should map to a row in the summary. A requirement with no matching row is a gap.
   > 2. **Invented anything?** Scan for checks the spec never asked for — an honest implementation could fail the exam for the wrong reason. Small implied edge cases are fine.
   > 3. **Your examples present?** The spec's concrete examples should appear in the exam verbatim — the sharpest checks.

   If the operator cannot vouch, the remedy is to re-seal (ultraplan sealing step) or waive explicitly — never rubber-stamp.
```

- [ ] **Step 3: Point to the rubric from the ultraplan sealing step**

In `skills/ultraplan/SKILL.md`, in the `## Seal the exam (after plan approval)` section, immediately AFTER the paragraph that begins `The operator may instead record \`**Acceptance:** waived` (the waiver paragraph), INSERT:

```markdown

When the operator reviews the appended coverage summary, point them to the vouching rubric in `ultrapowers` SKILL.md Step 3: they vouch by checking the summary faithfully and completely restates the spec — covered? / invented anything? / examples present? — not by reading the tests.
```

- [ ] **Step 4: Update the report-format doc for the PENDING_GATE disposition**

In `skills/ultrapowers/references/report-format.md`, find the `acceptance` row in the field table (it begins `| \`acceptance\` | no | Sealed acceptance exam result`). REPLACE the `{ mode: 'sealed', ... }` clause within that cell. Change:

```markdown
`{ mode: 'sealed', sealId, status, passed, exitCode, output }` when `run_acceptance.sh` was run — `status` is `OK`, `SEAL_MISSING`, `SEAL_BROKEN`, or `ERROR`; `passed` is a boolean. A `passed: false` result pushes a judgment call requiring the gate to NOT Approve.
```

to:

```markdown
`{ mode: 'sealed', sealId, sha256, status: 'PENDING_GATE', passed: null, note }` — the workflow does NOT administer the sealed exam (it has no shell; relaying the runner's JSON corrupts it, #36). The exam is administered deterministically at the Step 5 gate, where `run_acceptance.sh`'s exit code decides Approve and its JSON is rendered as receipts.
```

(The `enum` on the `acceptance.mode` schema line already lists `sealed`; leave it. The `passed` type is already `["boolean","null"]`; leave it.)

- [ ] **Step 5: Verify skills validate and pinned section tests pass**

Run: `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers && python3 skills/ultrapowers/scripts/validate_skill.py skills/ultraplan`
Expected: both print `skill ok`.

Run: `python3 -m pytest tests/test_orchestrator_markers.py tests/test_ultraplan_skill.py -q`
Expected: PASS. These pin Step 3/Step 5 presence (e.g. `"dispositions"`, `"tests.passed"`); the edits ADD content and keep those strings, so the pins hold. If a pin legitimately needs to include new section text, update the pin to ASSERT the new content — never delete or weaken an existing assertion to make it pass.

- [ ] **Step 6: Commit**

```bash
git add skills/ultrapowers/SKILL.md skills/ultraplan/SKILL.md skills/ultrapowers/references/report-format.md
git commit -m "feat: gate administers sealed acceptance deterministically; add operator vouching rubric (#36, #37)"
```

---

### Task 3: Full-suite verification

**Type:** gate
**Depends-on:** 1, 2

Run: `python3 -m pytest tests/ -q`
Expected: every test passes — the pre-existing suite plus the updated `test_no_prompt_drift.py` (no `ACCEPTANCE-EXAM` block), `test_workflow_sim.py` (sim prints `ALL SCENARIOS PASSED` with the `PENDING_GATE` scenario), `test_run_acceptance.py` (unchanged, 6 tests — the deterministic core the gate now calls), and the compiler/marker/skill tests.

Also: `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers` and `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultraplan` both print `skill ok`.

---

### Task 4: Live shakedown of the gate administration path

**Type:** manual
**Depends-on:** 3

Owner step (needs an interactive session; exercises the agentic/manual path no pytest covers — the same class the 2026-06-14 Task 7 shakedown found broken, now via the gate):

1. In a throwaway `/tmp` git repo, write a one-paragraph toy spec (e.g. `slugify(text)`), seal it via the ultraplan sealing step (real author subagent → vault entry, red-at-baseline, `**Acceptance:** sealed` line whose hash matches `seal_hash.py`).
2. Implement the feature so the exam would pass, then perform the **gate** administration exactly as SKILL.md Step 5 now prescribes: run `bash skills/ultrapowers/scripts/run_acceptance.sh <sealId> <branch> <sha256>` (with `--vault`/`--repo` pointing at the scratch setup) directly in the session. Confirm **exit 0** and `passed: true` — i.e. a genuinely-passing exam now administers GREEN deterministically, with no cheap-model relay in the loop (the #36 regression).
3. Tamper one byte of the vaulted suite and re-run: confirm **non-zero exit** and `status: SEAL_BROKEN`, and that the Step 5 gate would refuse Approve.
4. Confirm the Step 3 vouching rubric renders alongside the coverage summary.
5. Record the outcome in the PR description (no committed shakedown artifact required — the prior one was intentionally removed as a one-off log). File issues for anything rough.

---

## Self-review notes

- **Spec coverage:** #36 root-cause fix = Task 1 (delete relay, `PENDING_GATE`) + Task 2 Step 1 (gate administers via exit code); #37 rubric = Task 2 Steps 2–3; report-format doc = Task 2 Step 4; testing strategy (lean: reuse `test_run_acceptance.py`, update drift/sim, manual shakedown) = Tasks 1, 3, 4. Non-goals (runner/hash/vault, `suite`/`waived`, the other issues, docket 3c) are not touched.
- **Type consistency:** the `PENDING_GATE` disposition shape `{ mode, sealId, sha256, status, passed, note }` is defined identically in Task 1 (`waves.js`, sim) and documented in Task 2 (report-format). The gate command `run_acceptance.sh <sealId> <branch> <sha256>` and "exit code is the authority" are stated the same way in Task 2 Step 1 and Task 4. `scriptPath` is resolved by the orchestrator and consumed only at the gate.
- **Same-file collisions:** none. Task 1 owns `waves.js`, `reviewer-prompts.md`, `sim_workflow.mjs`, `test_no_prompt_drift.py`; Task 2 owns the two `SKILL.md` files and `report-format.md`. Waves: [1, 2] → [3] → [4 (manual, post-merge runbook)].
- **Markers:** Task 1/2 `implementation`, Task 3 `gate` (its `pytest tests/ -q` informs the run's test command; never executed as a task), Task 4 `manual` (excluded from waves, carried into the post-merge runbook). No ordering prose — all dependencies are `Depends-on:` lines.
- **Concurrency-safe:** Tasks 1 and 2 touch disjoint files and run no shared-port/shared-fixture tests; the sim and pytest invocations are self-contained.
