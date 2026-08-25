# Process-Ordering Claims Are Non-Findings Implementation Plan (#226)

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop manufacturing the "TDD red-before-green not observable from the diff" residual row (11 zero-information `acked:process` dispositions per run; 9 ledger runs 0.0.23→0.2.16): the completeness critic and the per-task reviewer treat a claim about the *order* work was performed — which no diff can evidence — as a non-finding and omit it, while constraints about test presence and coverage still verify. Close the root cause at authoring: ultraplan tells plan authors that process-ordering rules are per-task steps, never Global Constraints.

**Architecture:** The cycle's mandatory deletion, in two prose surfaces. (T1) One clause in the `COMPLETENESS_PROMPT` block of `references/wave-merge.md` (the critic's real brief — the issue named `reviewer-prompts.md`, which is the wrong file for the critic) and one clause in `REVIEWER_PROMPT` item 7 of `references/reviewer-prompts.md` (several per-task reviewers recorded the same row), both re-baked into `harnesses/waves.js`; the phrase `what plan requirement is unmet?` is not reworded — `audit_run.py` ROLE_MARKERS keys on it. (T2) Restore the distill arm-A second half: ultraplan's `## Global Constraints` guidance gains the rule that process-ordering rules never go there (11 plans copied a TDD line into Global Constraints, which ultraplan forwards as every reviewer's lens). `plan-markers.md` carries no Global Constraints text, so there is nothing to mirror; `tests/test_ultraplan_skill.py` stays green as-is. Verify by absence of `acked:process` TDD rows in the next ultralearn bundle — no new pin, no sensor field.

**Tech Stack:** Markdown prompt sources, JavaScript string constants in `waves.js` (no logic change), pytest drift pin, Node `.mjs` sims (run by the suite-gate because `waves.js` changes).

**Spec:** GitHub issue #226 plus its docket entry `docs/superpowers/docket.md` (`### #226`). Sequenced after #223's bake; this plan bakes `waves.js` again for its own two sentences.

**Acceptance:** suite — prompt-source edits + re-bake pinned by `tests/test_no_prompt_drift.py`, skill prose pinned by `tests/test_ultraplan_skill.py`; the committed suite plus the harness `.mjs` sims are the verification, no held-out exam.

## Global Constraints

- The verification periphery is FROZEN: never touch `gate_check.py`, `ultra_gate.py`, `run_lock.sh`, `run_acceptance.sh`, `collect_seal.py`, `seal_hash.py`.
- Prompts are baked; edit the source, not the copy: wording lands in `references/wave-merge.md` / `references/reviewer-prompts.md` FIRST, then in the matching `waves.js` constant; `python3 -m pytest tests/test_no_prompt_drift.py` green at every commit.
- The exact phrase `what plan requirement is unmet?` stays byte-identical in `wave-merge.md` and `waves.js` (`tests/test_audit_run.py::test_every_role_marker_exists_in_baked_sources`).
- `waves.js` changes are string-constant edits only; the four harness sims (`node tests/sim_workflow.mjs`, `node tests/sim_derived_heads.mjs`, `node tests/frontier_merge.mjs`, `node tests/wave_ancestry_sim.mjs`) must still print their pass sentinel.
- `skills/ultraplan/SKILL.md` must keep every currently-pinned phrase (`tests/test_ultraplan_skill.py`, `tests/test_recommendation_rubric.py`) and keep passing `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultraplan`.
- No Anthropic API calls or SDK anywhere; no new dependencies.
- The full gate is `python3 -m pytest`; every task leaves it green.

---

### Task 1: Critic + reviewer briefs — process-ordering claims are non-findings; re-bake

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/references/wave-merge.md`
- Modify: `skills/ultrapowers/references/reviewer-prompts.md`
- Modify: `skills/ultrapowers/harnesses/waves.js`
- Test: `tests/test_no_prompt_drift.py`

**Interfaces:**
- Consumes: nothing from sibling tasks.
- Produces: nothing code-level.

- [ ] **Step 1: Confirm the pins are green before editing**

Run: `python3 -m pytest tests/test_no_prompt_drift.py tests/test_audit_run.py -q`
Expected: PASS (baseline).

- [ ] **Step 2: Edit the COMPLETENESS_PROMPT source**

In `skills/ultrapowers/references/wave-merge.md`, inside `<!-- BAKE:COMPLETENESS_PROMPT -->`, the sentence `List every gap, unverified claim, and untested path.` becomes exactly:

```
List every gap, unverified claim, and untested path. A claim about the order in which work was performed — that tests were written before code, that a red run preceded green, that commits came in a given sequence — is not a finding when the integrated diff cannot evidence it: omit it entirely, never as a gap, an unverified claim, or a deferredVerification item; constraints about test presence and coverage still verify.
```

Leave `what plan requirement is unmet?` and every other sentence untouched.

- [ ] **Step 3: Edit the REVIEWER_PROMPT source**

In `skills/ultrapowers/references/reviewer-prompts.md`, inside `<!-- BAKE:REVIEWER_PROMPT -->`, append to the end of code-quality item 7 (after `…leaves an acceptance criterion unverified.`) exactly:

```
 A claim about the order in which work was performed (tests before code, red before green) is not a finding: the diff cannot evidence it, so never report its absence; test presence and coverage still verify.
```

- [ ] **Step 4: Re-bake both into `waves.js`**

In `skills/ultrapowers/harnesses/waves.js`: extend the `COMPLETENESS_PROMPT` string element `'List every gap, unverified claim, and untested path. '` with the new sentence, and extend the REVIEWER_PROMPT element beginning `'7. Test quality: tests assert observable behavior` with the new sentence — words matching the sources (formatting/punctuation is normalized by the drift test; the words must match; keep single-quoted JS strings with `\'` for apostrophes).

- [ ] **Step 5: Run the drift pin, the marker pin, the canary and the sims**

Run: `python3 -m pytest tests/test_no_prompt_drift.py tests/test_audit_run.py tests/test_canary.py -q`
Expected: PASS.
Run: `node tests/sim_workflow.mjs && node tests/sim_derived_heads.mjs && node tests/frontier_merge.mjs && node tests/wave_ancestry_sim.mjs`
Expected: each exits 0 and prints its `ALL SCENARIOS PASSED` / `ALL TESTS PASSED` sentinel.

- [ ] **Step 6: Commit**

```bash
git add skills/ultrapowers/references/wave-merge.md skills/ultrapowers/references/reviewer-prompts.md skills/ultrapowers/harnesses/waves.js
git commit -m "feat(engine): completeness critic + reviewer treat process-ordering claims as non-findings; re-bake (#226)"
```

---

### Task 2: ultraplan — process rules are per-task steps, never Global Constraints

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultraplan/SKILL.md`
- Test: `tests/test_ultraplan_skill.py`

**Interfaces:**
- Consumes: nothing from sibling tasks.
- Produces: nothing code-level.

- [ ] **Step 1: Add the rule to the Global Constraints guidance**

In `skills/ultraplan/SKILL.md`, section **Populate the v6 blocks — they are load-bearing here**, item 1 currently ends `ultrapowers forwards it to **every reviewer as its attention lens**.` Append to that item, as a continuation of the same paragraph:

```
 Process rules — TDD ordering, "write the failing test first", commit cadence — are per-task steps, never Global Constraints: forwarded as a reviewer lens they can only produce unverifiable process findings against every task, since no diff evidences the order work was done in. State what must be true of the result (tests present, behavior covered), not the order it was produced in.
```

- [ ] **Step 2: Verify the skill pins and the validator**

Run: `python3 -m pytest tests/test_ultraplan_skill.py tests/test_recommendation_rubric.py -q`
Expected: PASS.
Run: `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultraplan`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add skills/ultraplan/SKILL.md
git commit -m "docs(ultraplan): process-ordering rules are per-task steps, never Global Constraints (#226)"
```

---

### Task 3: Suite gate

**Type:** gate
**Depends-on:** 1, 2

**Files:**
- Test: `tests/`

- [ ] **Step 1: Run the full suite and the harness sims**

Run: `python3 -m pytest`
Expected: all green.
Run: `node tests/sim_workflow.mjs && node tests/sim_derived_heads.mjs && node tests/frontier_merge.mjs && node tests/wave_ancestry_sim.mjs`
Expected: each prints its pass sentinel.

---

## Operator smoke

- do: `grep -c "order in which work was performed" skills/ultrapowers/references/wave-merge.md skills/ultrapowers/references/reviewer-prompts.md skills/ultrapowers/harnesses/waves.js`
  see: `1`, `1`, `2` respectively.
- do: `grep -c "what plan requirement is unmet?" skills/ultrapowers/references/wave-merge.md skills/ultrapowers/harnesses/waves.js`
  see: `1` and `1` — the audit marker phrase is untouched.
- do: on the next real `/ultrapowers` run, open `<runDir>/residual-manifest.md`.
  see: no row of the form "TDD red-before-green not observable" — that is the canary; if it reappears, the prose failed.
