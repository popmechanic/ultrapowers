# Delete the Cheap Tier Rung Implementation Plan (#286)

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Acceptance:** suite — launch-knob simplification; the coercion behavior is pinned by a covering sim scenario and the canary.

**Goal:** Collapse the implementer tier ladder to standard/most-capable; `cheap` in a launch file warns and coerces to standard (zero new control flow); setup/merge keep haiku via a named `UTILITY_MODEL`.

**Architecture:** Delete the `cheap` key from `DEFAULT_TIER`/`TIER_LADDER` in waves.js so the EXISTING unknown-tier fallback performs the coercion; rename the setup/merge dispatch model to `UTILITY_MODEL = 'haiku'`; update derivation docs; re-point tier-sensitive test fixtures and assertions.

**Tech Stack:** JS (waves.js + .mjs sims), Python (pytest pins), markdown docs.

**Spec:** docs/superpowers/specs/2026-08-26-delete-cheap-tier-rung.md

## Global Constraints

- FROZEN periphery untouched: `gate_check.py`, `ultra_gate.py`, `run_lock.sh`, sealing scripts, compiler diagnostic vocabulary — zero diff.
- No BAKE-block prompt text changes (the §Model tiers table sits outside the markers; `tests/test_no_prompt_drift.py` stays green with zero re-bake).
- `ultra_run.py` `VALID_TIERS` still accepts `"cheap"` (comment-only change there).
- After the change, `grep -n "'cheap'" skills/ultrapowers/harnesses/waves.js tests/*.mjs tests/test_redirect_args.py` hits ONLY the waves.js retirement mention in the fallback message and the one deliberate coercion-scenario fixture in `tests/sim_workflow.mjs`.
- Full suite green (`python3 -m pytest`, ≥1169) and every `.mjs` sim prints its ALL-SCENARIOS-PASSED sentinel.

---

### Task 1: waves.js two-rung ladder + test updates

**Type:** implementation
**Depends-on:** none
**Review:** adversarial

**Files:**
- Modify: `skills/ultrapowers/harnesses/waves.js`
- Modify: `tests/test_canary.py`
- Modify: `tests/sim_workflow.mjs`
- Modify: `tests/frontier_merge.mjs`
- Modify: `tests/sim_derived_heads.mjs`
- Modify: `tests/wave_ancestry_sim.mjs`
- Modify: `tests/test_redirect_args.py`

**Interfaces:**
- Produces: `UTILITY_MODEL = 'haiku'` (waves.js const; setup + merge dispatch model)
- Produces: `DEFAULT_TIER = { standard: 'sonnet', mostCapable: 'opus' }`, `TIER_LADDER = ['standard', 'mostCapable']`

- [ ] **Step 1: waves.js edits**

```js
// DEFAULT_TIER block (comment updated to the two-rung story; #20 evidence stays in reviewer-prompts.md):
const DEFAULT_TIER = { standard: 'sonnet', mostCapable: 'opus' }
const TIER = DEFAULT_TIER
// Fixed engine roles (setup, per-wave merge) are not ladder rungs — they keep
// the economical model under their own name ('cheap' rung retired, #286).
const UTILITY_MODEL = 'haiku'
```

`TIER_LADDER = ['standard', 'mostCapable']` (escalateTier logic unchanged). Replace both dispatch uses of `TIER.cheap` (merge:wave at ~:1733, setup at ~:1857) with `UTILITY_MODEL`. Unknown-tier fallback (~:1090): control flow unchanged; message becomes `'" — fell back to standard (valid: standard, mostCapable/most-capable; the cheap rung is retired, #286)'` (and the matching `log()` line keeps its wording). Update the tier-map comment at ~:849 (reviewer-prompts.md now names two tiers) and the `escalateTier` comment.

- [ ] **Step 2: test_canary.py pins**

In `test_workflow_model_tiers_use_valid_aliases`, replace `assert "cheap: 'haiku'" in wf` with:

```python
    assert "cheap: 'haiku'" not in wf          # rung retired (#286)
    assert "UTILITY_MODEL = 'haiku'" in wf     # setup/merge keep the economical model
```

(keep the standard/mostCapable asserts).

- [ ] **Step 3: sim_workflow.mjs — coercion pin (the covering sim for the new behavior)**

In the concerns/economics scenario (task A currently `tier: 'cheap'`, asserted `eq(a.tier, 'haiku', …)`): keep the fixture `tier: 'cheap'` deliberately and change the assertions to:

```js
  eq(a.tier, 'sonnet', 'economics: retired cheap tier coerced to standard (sonnet)')
  assert(r.judgmentCalls.some((j) => /A/.test(j) && /cheap/.test(j) && /retired/.test(j)),
    'economics: cheap coercion surfaced as a judgment call')
```

- [ ] **Step 4: sim_workflow.mjs — portability scenario rewrite**

The legacy `tierOverrides` scenario keeps its meaning with two-rung keys: fixture `tierOverrides: { standard: 'opus', mostCapable: 'haiku' }`; tasks A/B get `tier: 'standard'`; assertions become `eq(seen.implModels['A'], 'sonnet', 'portability: legacy tierOverrides ignored — standard stays sonnet (A)')` (same for B); C's standard/sonnet assert stays; reviewer/integration opus asserts stay.

- [ ] **Step 5: sim_workflow.mjs — escalation + reviewer-uniform scenarios re-based on standard**

Escalation scenarios (escalate-recovers, escalate-bounded, escalation-classifier) re-base their fixtures `tier: 'cheap'` → `tier: 'standard'` and expected model sequences shift one rung: schema trip `['sonnet', 'opus']`, same-tier retries `['sonnet', 'sonnet']`; assertion prose updated ("first attempt ran at standard/sonnet", "schema trip escalates standard→opus"). reviewer-model-uniform scenario: tasks a/b `tier: 'standard'`; `tierOverrides` fixture keys re-pointed (`{ standard: 'sonnet', mostCapable: 'haiku' }`); assertion prose drops "cheap" ("lean standard-tier task reviewed at the uniform most-capable model"). reconcile-tier scenario: setup/merge still assert `'haiku'`; prose reworded to "the utility model (haiku)".

- [ ] **Step 6: mechanical sweep**

Replace every remaining `tier: 'cheap'` fixture value with `tier: 'standard'` in `tests/sim_workflow.mjs`, `tests/frontier_merge.mjs`, `tests/sim_derived_heads.mjs`, `tests/wave_ancestry_sim.mjs`; in `tests/test_redirect_args.py` change the findings-fixture `"tier": "cheap"` to `"tier": "standard"` (and its paired assertion if it checks the echoed value). Verify the Global-Constraints grep invariant.

- [ ] **Step 7: run**

`node tests/sim_workflow.mjs && node tests/frontier_merge.mjs && node tests/sim_derived_heads.mjs && node tests/wave_ancestry_sim.mjs` → each prints its ALL-SCENARIOS/TESTS-PASSED sentinel. `python3 -m pytest tests/test_canary.py tests/test_redirect_args.py tests/test_no_prompt_drift.py -q` → green.

- [ ] **Step 8: Commit**

```bash
git add skills/ultrapowers/harnesses/waves.js tests/test_canary.py tests/sim_workflow.mjs tests/frontier_merge.mjs tests/sim_derived_heads.mjs tests/wave_ancestry_sim.mjs tests/test_redirect_args.py
git commit -m "feat(engine): delete the cheap tier rung — two-rung ladder, UTILITY_MODEL for setup/merge, warn+coerce migration (#286)"
```

### Task 2: Derivation docs + ultra_run comment

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/SKILL.md`
- Modify: `skills/ultrapowers/references/reviewer-prompts.md`
- Modify: `skills/ultrapowers/references/workflow-template.md`
- Modify: `skills/ultrapowers/scripts/ultra_run.py`

**Interfaces:**
- Produces: two-rung derivation guidance consistent with Task 1's ladder.

- [ ] **Step 1: SKILL.md :76** — `(`cheap`/`standard`/`most-capable`)` → `(`standard`/`most-capable`)`; the same bullet's sentence otherwise unchanged. **:305** — `right-size `tier` down when the fix is mechanical` → `right-size `tier` down to `standard` when the fix is mechanical`.

- [ ] **Step 2: reviewer-prompts.md §Model tiers** (outside BAKE markers): delete the **cheap** table row; the **standard** row's "Use when" gains a leading "The floor tier — transcription-grade work included; also " before its current text. In the paragraph below, replace `Assign tier at task-dispatch time … were all cheap-tier, and exactly the three that drew reviewer notes).` sentence's tail with past-tense: `(issue #20: the three heaviest implementations in run wf_df7eefdb-7b1 all ran on the since-retired cheap rung, and exactly those three drew reviewer notes)`, and `Setup and merge run at `cheap`;` → `Setup and merge run at a fixed utility model (haiku);`.

- [ ] **Step 3: workflow-template.md :196/:201** — reword to the two-rung ladder + utility model (`reviewer-prompts.md names tiers `standard` / `most-capable`; … setup/merge at the fixed utility model haiku, reconcile/fix at `mostCapable``).

- [ ] **Step 4: ultra_run.py** — above `VALID_TIERS`, add the comment `# "cheap" stays accepted: pre-#286 launch/args files carry it; waves.js coerces it to standard with a visible judgment call.` (set membership unchanged).

- [ ] **Step 5: run** `python3 -m pytest tests/test_ultraplan_skill.py tests/test_recommendation_rubric.py tests/test_no_prompt_drift.py tests/test_ultra_run.py -q` → green (skill-text pins must not reference the deleted wording; fix any pin the grep run surfaces).

- [ ] **Step 6: Commit**

```bash
git add skills/ultrapowers/SKILL.md skills/ultrapowers/references/reviewer-prompts.md skills/ultrapowers/references/workflow-template.md skills/ultrapowers/scripts/ultra_run.py
git commit -m "docs(engine): two-rung tier derivation guidance; ultra_run cheap-acceptance comment (#286)"
```

### Task 3: Suite gate

**Type:** gate
**Depends-on:** 1, 2

`python3 -m pytest` green (≥1169); `run_acceptance.sh --suite-gate` sims all green (waves.js touched).

## Operator smoke

- do: `grep -c "cheap" skills/ultrapowers/harnesses/waves.js`
- see: a small number, every hit either generic English ("cheap, retryable", "cheaply prove") or the single retirement mention in the fallback message — no `cheap:` tier key, no `TIER.cheap`.
- do: `grep -n "standard/most-capable\|standard\`/\`most-capable" skills/ultrapowers/SKILL.md | head -2`
- see: the :76 derivation line offers exactly two rungs.
- do: `node tests/sim_workflow.mjs | grep -E "concerns-propagate|portability"`
- see: both scenarios OK — the coercion pin and the rewritten legacy-knob scenario pass.
