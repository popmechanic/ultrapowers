# Engine Residuals Docket (#123/#95) — §5-Relaxation Shakedown Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan may also be executed by `/ultrapowers`.

**Acceptance:** suite — committed pytest + the `.mjs` harness sims (suite-gate sentinel discipline) are the verification; sealing not requested (residuals docket / §5 shakedown).

**Goal:** Close the in-scope residuals from #123 (items 1, 3) and #95 (items 1–4)
in one docket. This plan is also the §5-relaxation **shakedown**: it is authored
under the relaxed same-file rule — tasks 2 and 3 independently modify
`tests/sim_workflow.mjs` with no ordering marker, on purpose — so its run
produces the first real `frontier/` records the fold-relaxation canary reads.
Out of scope, staying in their issues: #123 item 2 (frozen-periphery
`gate_check.py` — eval route only), #123 item 4's finalize-mode/porcelain
smalls (ambiguous or behavior-changing; not shakedown material).

**Tech Stack:** Node ≥18 (sim harness), Python 3.11 + pytest. Suite:
`python3 -m pytest` from the repo root; sims: `node tests/sim_workflow.mjs`
(must keep printing its `ALL SCENARIOS PASSED` sentinel — the suite-gate runs
it whenever harness JS changes and requires the sentinel).

**Anti-drift constraint (global):** `waves.js` prompts are baked from
`references/wave-merge.md`; `tests/test_no_prompt_drift.py` pins them. Any
prompt change edits the reference source AND the baked copy in lockstep.

---

### Task 1: Critic detach authority — heads/ sidecar first, recorded sha demoted to cross-check

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/references/wave-merge.md`
- Modify: `skills/ultrapowers/harnesses/waves.js`

**Interfaces:**
- Produces: completeness-critic prompt (canonical wording, both copies)

#123 item 1: the critic prompt front-loads a hard gate on the model-typed
`{{MERGE_HEAD_SHA}}` ("run git checkout --detach {{MERGE_HEAD_SHA}} … if it
does not, report BLOCKED") and only at the end says heads/ sidecar shas are
the authority — so a fabricated recorded sha surfaces as an unexplained
BLOCKED instead of the specific recorded-vs-derived signal, and the agent
detaches at a model-typed value.

- [ ] **Step 1:** In `references/wave-merge.md`'s canonical critic prompt (the
  block quoting "First, put yourself on the exact tree the run produced"),
  restructure the detach sequence to a single authority, in this order:
  1. The detach target is derived FIRST from the sidecar: read
     `<runDir>/heads/`, highest-numbered `wave-<n>` slot. (Keep the existing
     trailing sentence "Authoritative shas live in <runDir>/heads/ …" — move
     its authority up front; the trailing sentence may remain as the
     restatement but must no longer be the first mention.)
  2. `{{MERGE_HEAD_SHA}}` is demoted to the **recorded** value, a cross-check
     only: after detaching at the derived slot value, compare; on mismatch
     report BLOCKED with a finding that names BOTH values in the form
     `recorded merge sha <recorded> != derived heads/ slot <derived>` — the
     specific recorded-vs-derived signal, not an unexplained BLOCKED.
  3. Empty-value handling is preserved: no heads/ slot readable → BLOCKED, no
     findings, do not guess a tree (today's fail-safe direction).
- [ ] **Step 2:** Re-bake the same wording into `waves.js`'s critic prompt
  constant per `references/workflow-template.md` — byte-identical where the
  drift pin compares.
- [ ] **Step 3:** `python3 -m pytest tests/test_no_prompt_drift.py tests/test_wave_merge_prompts.py -q`
  (or the nearest prompt-pin tests) → PASS; then the full suite → PASS.
- [ ] **Step 4:** Commit: `fix(engine): critic detach authority — heads/ sidecar first, recorded sha demoted to cross-check (#123)`

---

### Task 2: Sim engineAuthoredSpan guard — subtract plan-authored blocks instead of truncating at the first marker

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `tests/sim_workflow.mjs`

#95 item 3 (reviewer-proven blind spot): `engineAuthoredSpan(prompt)`
truncates the checked span at the FIRST of `\nTASK:` / `\nGLOBAL
CONSTRAINTS:` / `\nINTERFACES:`, so engine-authored text appended AFTER the
plan-authored blocks (the FIX ROUND preamble) escapes the
no-unsubstituted-placeholder guard.

- [ ] **Step 1:** Rewrite `engineAuthoredSpan` to derive the engine-authored
  span by REMOVING the known plan-authored blocks from the prompt (each block
  spans from its marker to the next block marker or a recognized
  engine-authored boundary), keeping everything else — so engine text before
  AND after the plan blocks is checked.
- [ ] **Step 2:** Extend the existing self-probe (the `FIX ROUND — engine
  text leaking <runDir>` probe near the top): assert a literal `<runDir>`
  planted in a FIX ROUND-style suffix IS caught by the new span (this is the
  exact shape the reviewer proved escaped), and that plan-body text quoting a
  placeholder still does NOT trip the guard (the existing negative assert
  stays green).
- [ ] **Step 3:** `node tests/sim_workflow.mjs` → `ALL SCENARIOS PASSED`;
  full suite → PASS.
- [ ] **Step 4:** Commit: `test(sim): engineAuthoredSpan covers post-plan engine text — subtraction, not truncation (#95)`

---

### Task 3: Restore the no-command-field critic mutation shape

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `tests/sim_workflow.mjs`

#123 item 4d: the #106 sim merge traded away the critic-reply shape with NO
`command` field — the mutation coverage for the guard that a critic reply
missing `tests.command` (or the command field entirely) must not read as a
green test run.

- [ ] **Step 1:** Add one scenario (or extend the critic-shape scenario
  family) in which the integration critic's reply omits the `command` field
  entirely while claiming `testsPassed: true`; assert the engine treats it as
  unverified (the gate-facing result must NOT carry a trusted green — match
  the engine's actual guard semantics, asserting the specific field the guard
  sets, not a broad "it failed").
- [ ] **Step 2:** Mutation-check it: with the engine guard for the missing
  command neutralized in a shadow copy (the sim file's existing
  self-mutation-check pattern), the scenario must fail — proving the scenario
  is load-bearing.
- [ ] **Step 3:** `node tests/sim_workflow.mjs` → `ALL SCENARIOS PASSED`;
  full suite → PASS.
- [ ] **Step 4:** Commit: `test(sim): restore no-command-field critic shape with mutation check (#123)`

---

### Task 4: compile_plan --check help string + prune honest-receipt failure test

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/scripts/compile_plan.py`
- Test: `tests/test_ultra_run.py`

- [ ] **Step 1 (#95 item 1):** Update `--check`'s argparse help so the
  documented exclusion matches the enforced one (the runtime error also
  rejects `--run-dir` with `--check`; the help currently names only
  `--emit-launch`/`--emit-args`). Help text only — no behavior change; the
  compiler's diagnostic vocabulary is frozen and this is argparse help, not a
  diagnostic.
- [ ] **Step 2 (#95 item 2):** In `tests/test_ultra_run.py`, add a failing
  test for `prune_run_dirs`'s failure branch: seed a doomed run dir that
  cannot be removed (monkeypatch `shutil.rmtree` to a no-op for that path),
  then assert (a) the failed dir's name is ABSENT from the returned
  removed-list, and (b) the stage detail carries the `"; N removal failed:"`
  wording naming it. This distinguishes the honest receipt from the old
  report-the-doomed-list behavior.
- [ ] **Step 3:** Run to verify: the new test fails against a reverted
  (doomed-list) implementation and passes against the current one; full
  suite → PASS.
- [ ] **Step 4:** Commit: `fix(compiler): --check help names --run-dir exclusion; test(prune): honest-receipt failure branch (#95)`

---

### Task 5: SKILL.md salvage/redirect argsFile line + finalize-before-gate wiring pin

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/SKILL.md`
- Test: `tests/test_finalize_wiring.py`

- [ ] **Step 1 (#95 item 4):** In SKILL.md's Salvage and Redirect bullets,
  add one line each: compose relaunch args by spreading the receipt's
  `argsFile` (it carries the now-mandatory `pluginRoot`/`runDir` keys); a
  relaunch that reconstructs args from the report will be refused by the
  harness.
- [ ] **Step 2 (#123 item 3):** Create `tests/test_finalize_wiring.py`
  pinning the Task1↔Task3 wiring that is currently unpinned prose: SKILL.md's
  gate step (Step 5) contains a `finalize_report.py` invocation AND it
  appears BEFORE the `ultra_gate.py` invocation in the same step (assert
  both substrings exist and compare their indices). Keep it a text pin on
  SKILL.md — no subprocess.
- [ ] **Step 3:** Run to verify failure first (comment out the finalize line
  in a tmp copy — the pin must go red), then green on the real file; full
  suite → PASS.
- [ ] **Step 4:** Commit: `docs(skill): salvage/redirect spread argsFile; test: pin finalize-before-gate wiring (#123 #95)`

---

### Task 6: Full-suite verification

**Type:** gate

**Files:** none

- [ ] Run `python3 -m pytest` from the repo root → all green, and
  `node tests/sim_workflow.mjs` + `node tests/frontier_merge.mjs` → both
  print their ALL-PASSED sentinel. `waves.js` changed (Task 1), so the
  suite-gate will re-run the harness sims — the sentinel is the gate's
  evidence, not a courtesy.
