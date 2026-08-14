# Shakedown Critic Residuals (#147)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan may also be executed by `/ultrapowers`.

**Acceptance:** suite — committed pytest + the `.mjs` harness sims (suite-gate sentinel discipline) are the verification; sealing not requested (engine residuals).

**Goal:** Close #147 per the trimmed spec
(`docs/superpowers/specs/2026-08-14-shakedown-critic-residuals.md`): three
builds — revive the dead escalation-preserving branch (waves.js:1944 predicate
`!waveBaseSha` never fires; wave-1-blocked runs silently drop the per-task
reviewers' escalated CANNOT-VERIFY checklist), fix the critic prompt's
recorded-sha trailing sentence (waves.js:647 / wave-merge.md:260), and
strengthen the finalize-wiring self-check so the ordering assert is proven
load-bearing. Item 1 of the issue (trusted-green stamp) is ANSWERED, not
built — see the spec's trim review; close it in the issue comment as such.

**Authoring note (relaxed same-file rule):** Tasks 1 and 2 both modify
`skills/ultrapowers/harnesses/waves.js` (code region vs baked-prompt region)
with no logical dependency — the collision stands deliberately; the compiler
orders them.

**Tech Stack:** Node ≥18 (harness + sims), Python 3.11 + pytest. Suite:
`python3 -m pytest`; sims: `node tests/sim_workflow.mjs` (must keep printing
`ALL SCENARIOS PASSED` — the suite-gate runs it whenever harness JS changes).

**Anti-drift constraint (global):** the completeness-critic prompt is baked
from `references/wave-merge.md` (BAKE:COMPLETENESS_PROMPT) and pinned by
`tests/test_no_prompt_drift.py` — Task 2 edits the source AND the baked copy
in lockstep.

---

### Task 1: Revive the dead escalation-preserving branch

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/harnesses/waves.js`
- Modify: `tests/sim_workflow.mjs`

waves.js:1944 reads `if (cannotVerifyItems.length && !waveBaseSha)` — but
`waveBaseSha` initializes from hard-gated setup (waves.js:1632/1678) and only
ever advances to merge heads, so `!waveBaseSha` is never true and the branch
that folds escalated CANNOT-VERIFY items into `judgmentCalls` is dead. In the
wave-1-blocked shape ("no wave-<n> slot readable"), the critic refuses with
no findings and the escalations vanish.

- [ ] **Step 1:** Change the predicate to fire when no wave merged:
  `if (cannotVerifyItems.length && mergedShas.length === 0)` (`mergedShas`
  is pushed only on `status === 'MERGED'` — waves.js:1836–1841 — so it is
  the correct in-memory no-wave-merged predicate). The branch body (fold
  every escalated item into `judgmentCalls`) is unchanged.
- [ ] **Step 2:** Add a covering sim scenario to `tests/sim_workflow.mjs`:
  drive the harness through a shape where wave 1's merge is blocked (no
  MERGED wave) while a per-task reviewer escalated at least one
  CANNOT-VERIFY item; assert the report's `judgmentCalls` carries the
  escalated item's requirement text verbatim. This is a behavioral assertion
  on report content (not a text grep), so it genuinely covers the predicate:
  confirm the scenario FAILS against a shadow copy with the predicate
  reverted to `!waveBaseSha` before committing (do not commit the shadow).
- [ ] **Step 3:** `node tests/sim_workflow.mjs` → `ALL SCENARIOS PASSED`;
  `python3 -m pytest -q` → PASS.
- [ ] **Step 4:** Commit: `fix(engine): escalated CANNOT-VERIFY items survive wave-1-blocked runs — revive dead preservation branch (#147)`

---

### Task 2: Critic prompt — trailing sentence names the derived value

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/references/wave-merge.md`
- Modify: `skills/ultrapowers/harnesses/waves.js`

waves.js:647 (source `references/wave-merge.md:260`) still reads "After
confirming HEAD equals the recorded merge sha, set onIntegrationHead true…" —
re-elevating the recorded value the same prompt demoted to "context and not
authority" a few sentences earlier.

- [ ] **Step 1:** In `references/wave-merge.md`'s COMPLETENESS_PROMPT block,
  rewrite the sentence to: "After confirming HEAD equals <derived> (the
  heads/-derived detach target), set onIntegrationHead true in your result
  (false if you could not confirm it)."
- [ ] **Step 2:** Re-bake the identical wording into waves.js's completeness
  prompt per `references/workflow-template.md`. No new pin:
  COMPLETENESS_PROMPT is already in `test_no_prompt_drift.py`'s KNOWN set.
- [ ] **Step 3:** `python3 -m pytest tests/test_no_prompt_drift.py -q` →
  PASS; full suite → PASS; `node tests/sim_workflow.mjs` and
  `node tests/sim_derived_heads.mjs` → sentinels.
- [ ] **Step 4:** Commit: `fix(engine): critic prompt confirms HEAD against the derived detach target, not the recorded sha (#147)`

---

### Task 3: Finalize-wiring self-check proves the ordering assert

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `tests/test_finalize_wiring.py`

`test_pin_goes_red_if_finalize_call_is_dropped` (lines 55–66) deletes the
finalize needle from the text copy, so the presence assert
(`finalize_idx != -1`) fires first and the ordering assert
(`finalize_idx < gate_idx`) is never exercised red.

- [ ] **Step 1:** Extract the presence+ordering assertion body into a module
  helper (e.g. `_assert_finalize_precedes_gate(text)`) that both the green
  pin test and the red-check call.
- [ ] **Step 2:** Change the red-check mutation from *delete the finalize
  needle* to *move it after the gate needle* (remove it from its position
  and append it after the gate invocation line), and assert via
  `pytest.raises` message-matching that the ORDERING assert is what fires
  (the presence assert must pass on the mutated text).
- [ ] **Step 3:** Keep (or add, if simpler) a second red case for the
  deleted-needle shape asserting the presence assert fires — both halves of
  the pin now proven load-bearing.
- [ ] **Step 4:** `python3 -m pytest tests/test_finalize_wiring.py -q` →
  PASS; full suite → PASS.
- [ ] **Step 5:** Commit: `test(wiring): prove the finalize-before-gate ordering assert is load-bearing (#147)`
