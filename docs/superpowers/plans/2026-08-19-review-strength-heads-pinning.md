# Review strength + heads-slot pinning + receipt-verbatim gate — Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Acceptance:** suite — the committed pytest suite is the verification; because `skills/ultrapowers/harnesses/waves.js` changes, the suite-gate additionally runs the `.mjs` harness sims (`tests/frontier_merge.mjs`, `tests/sim_workflow.mjs`), which must print their pass sentinel. Sealing not requested.

**Goal:** Drain three one-file hardening items from the 2026-08-19 design/incident pass: a named test-strength dimension in the reviewer brief (#170), directory-pinned heads-slot recording with a self-check in the three merge-side prompts (#173), and a receipts-not-narration render rule at the pre-merge gate (#171).

**Architecture:** Two prompt-source edits re-baked into the committed workflow (`waves.js` — sources are `references/reviewer-prompts.md` and `references/wave-merge.md`, pinned by `tests/test_no_prompt_drift.py`), plus one SKILL.md gate-step render rule. No engine logic, no schema, no script changes.

**Tech Stack:** Markdown prompt sources, Node ESM workflow constants (string concatenation), pytest anti-drift pins.

**Spec:** Issues #170, #171, #173 (each carries its full rationale and the 2026-08-19 evidence); context note `docs/superpowers/specs/2026-08-19-phase2-design-inputs.md`.

## Global Constraints

- **Prompts are baked; edit source AND copy.** `references/reviewer-prompts.md` and `references/wave-merge.md` are the sources; `harnesses/waves.js` carries the baked constants. `python3 -m pytest tests/test_no_prompt_drift.py -q` must be green at every task's end. The drift pin splits `{{PLACEHOLDER}}` tokens and matches the normalized fragments against contiguous waves.js text — a `{{INTEGRATION_WT}}` in the source corresponds to `' + INTEGRATION_WT + '` in the JS string.
- **Frozen verification periphery untouched:** never edit `skills/ultrapowers/scripts/{ultra_gate.py,gate_check.py,collect_seal.py,seal_hash.py,run_acceptance.sh,run_lock.sh}` or `finalize_report.py`.
- Harness JS changed ⇒ `node tests/frontier_merge.mjs` and `node tests/sim_workflow.mjs` must print `ALL SCENARIOS PASSED`.
- `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers` must pass after any SKILL.md edit.
- No direct Anthropic API calls, no `anthropic` SDK, no `ANTHROPIC_API_KEY`.

---

### Task 1: Reviewer brief — name test-strength as an explicit review dimension (#170)

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/references/reviewer-prompts.md`
- Modify: `skills/ultrapowers/harnesses/waves.js`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: nothing other tasks rely on (prompt text only).

Context (from #170): the 2026-08-19 floors run caught two green-but-hollow tests — a config-sensitivity test whose fixtures validate identically under hardcoded defaults, and an `assert "a" in message` where `"a"` already appears in the fixed word "actor". Both were caught by reviewer judgment with no named instruction. This task names the dimension.

- [ ] **Step 1: Edit the source.** In `skills/ultrapowers/references/reviewer-prompts.md`, inside the `<!-- BAKE:REVIEWER_PROMPT -->` block, find quality item 7, which ends:

```
… a loose containment assertion in place of full-value equality is a finding — minor, or blocking when it leaves an acceptance criterion unverified.
```

Append to the same item 7 (same line/paragraph, after that sentence):

```
Test strength: for each new or changed test, ask whether it would still pass with the behavior it names deleted — flag assertions satisfiable by accident: a substring assertion already matched by fixed message text, a fixture insensitive to the config or parameter the criterion names, an expected value derived by calling the code under test. Same severity ladder: minor, or blocking when the accidental pass leaves an acceptance criterion unverified.
```

- [ ] **Step 2: Run the drift pin to verify it fails.** `python3 -m pytest tests/test_no_prompt_drift.py -q` → FAIL (REVIEWER_PROMPT words missing from waves.js).
- [ ] **Step 3: Re-bake.** In `skills/ultrapowers/harnesses/waves.js`, locate the `REVIEWER_PROMPT` constant (search for `Test quality: tests assert observable behavior`) and append the exact Step-1 sentences to the item-7 string content, preserving the file's string-concatenation style (`'…' +` lines, single quotes, escaping any apostrophes as the file already does).
- [ ] **Step 4: Verify green.** `python3 -m pytest tests/test_no_prompt_drift.py -q` → PASS. Then `node tests/frontier_merge.mjs && node tests/sim_workflow.mjs` → both print `ALL SCENARIOS PASSED`. Then the full suite: `python3 -m pytest -q` → PASS.
- [ ] **Step 5: Commit.**

```bash
git add skills/ultrapowers/references/reviewer-prompts.md skills/ultrapowers/harnesses/waves.js
git commit -m "reviewer brief: name test-strength as an explicit review dimension (#170)"
```

---

### Task 2: Merge-side prompts — pin heads-slot recording to the integration worktree (#173)

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/references/wave-merge.md`
- Modify: `skills/ultrapowers/harnesses/waves.js`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: nothing other tasks rely on (prompt text only).

Context (from #173): a merge agent recorded the eval-baseline sha into `heads/wave-4` because a bare `git rev-parse HEAD` ran with the wrong current directory; the gate driver rewrites the report's headSha fields FROM the slots, so one bad slot blocked an otherwise-green run. Fix: no slot read may depend on ambient cwd, and the slot must agree with the reported headSha.

- [ ] **Step 1: Edit the source.** In `skills/ultrapowers/references/wave-merge.md`, the following sentence appears verbatim in THREE bake blocks — `BAKE:MERGE_PROMPT`, `BAKE:CONTENDED_MERGE_PROMPT` (inside its `STEP adopt:` line), and `BAKE:RECONCILE_PROMPT`:

```
Before you report, record heads mechanically: run mkdir -p <runDir>/heads, then for each task branch you merged run git rev-parse <branch> > <runDir>/heads/task-<taskId>, then git rev-parse HEAD > <runDir>/heads/wave-<waveNumber>. Shell redirection only — never type a sha by hand.
```

Replace it, in all three blocks identically, with:

```
Before you report, record heads mechanically: run mkdir -p <runDir>/heads, then for each task branch you merged run git -C {{INTEGRATION_WT}} rev-parse <branch> > <runDir>/heads/task-<taskId>, then git -C {{INTEGRATION_WT}} rev-parse HEAD > <runDir>/heads/wave-<waveNumber>. Shell redirection only — never type a sha by hand, and never a bare rev-parse for a slot: -C pins every read to the integration worktree, so no recorded sha can depend on your current directory. Before reporting, self-check the wave slot: cat <runDir>/heads/wave-<waveNumber> must print exactly the headSha you are about to report; on mismatch, re-record with the -C forms — a slot that disagrees with your report means a rev-parse ran in the wrong directory.
```

- [ ] **Step 2: Run the drift pin to verify it fails.** `python3 -m pytest tests/test_no_prompt_drift.py -q` → FAIL (the three wave-merge blocks' new words missing from waves.js).
- [ ] **Step 3: Re-bake all three constants.** In `skills/ultrapowers/harnesses/waves.js`, the old sentence is baked in three places (search `record heads mechanically`): the `MERGE_PROMPT` constant, the `RECONCILE_PROMPT` constant, and the contended STEP-adopt text. Apply the same replacement to each, rendering `{{INTEGRATION_WT}}` as string interpolation in the file's existing style: `'… run git -C ' + INTEGRATION_WT + ' rev-parse <branch> > …'` (match how the surrounding constant already interpolates `INTEGRATION_WT`; in the STEP-adopt builder use that scope's existing worktree-path variable exactly as its neighboring text does). Preserve the concatenation style and apostrophe escaping.
- [ ] **Step 4: Verify green.** `python3 -m pytest tests/test_no_prompt_drift.py -q` → PASS. Then `node tests/frontier_merge.mjs && node tests/sim_workflow.mjs` → both print `ALL SCENARIOS PASSED`. Then the full suite: `python3 -m pytest -q` → PASS.
- [ ] **Step 5: Commit.**

```bash
git add skills/ultrapowers/references/wave-merge.md skills/ultrapowers/harnesses/waves.js
git commit -m "merge prompts: pin heads-slot recording with git -C + report self-check (#173)"
```

---

### Task 3: Gate step — receipts, not narration (#171)

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/SKILL.md`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: nothing other tasks rely on (operator-facing render rule only).

Context (from #171): the operator consumes run outcomes as the session's summary plus UI smoke testing — so the summary must quote machine-written bytes, never paraphrase them.

- [ ] **Step 1: Edit SKILL.md.** In `skills/ultrapowers/SKILL.md`, Step 5 ("Pre-merge gate"), directly after the exit-code bullet list (the last bullet is `**1 (BLOCKED)** → present the failing checks; do **NOT** Approve.`), insert this paragraph:

```markdown
**Receipts, not narration.** Whatever the verdict, the operator-facing summary quotes machine-written bytes: copy `verdict`, every failing check's `name` and `detail`, and the acceptance `exit` plus its pass/fail line verbatim from `run-<stamp>/gate-receipt.json`, and name that file's path in the summary. Never paraphrase a receipt value the operator could read directly.
```

- [ ] **Step 2: Validate.** `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers` → passes. Then the full suite: `python3 -m pytest -q` → PASS (no pin reads this section; the validator and suite are the gate).
- [ ] **Step 3: Commit.**

```bash
git add skills/ultrapowers/SKILL.md
git commit -m "skill: gate summaries quote receipt fields verbatim (#171)"
```

---

### Task 4: Full-suite verification

**Type:** gate
**Depends-on:** 1, 2, 3

- [ ] `python3 -m pytest -q` → all green.
- [ ] `node tests/frontier_merge.mjs && node tests/sim_workflow.mjs` → both print `ALL SCENARIOS PASSED`.
- [ ] `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers` → passes.
