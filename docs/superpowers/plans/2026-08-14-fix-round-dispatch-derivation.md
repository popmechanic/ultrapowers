# Fix-Round Dispatch Derivation (#146)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan may also be executed by `/ultrapowers`.

**Acceptance:** suite — committed pytest + the `.mjs` harness sims (suite-gate sentinel discipline) are the verification; sealing not requested (engine dispatch hardening).

**Goal:** Close #146 per the trimmed spec
(`docs/superpowers/specs/2026-08-14-fix-round-dispatch-derivation.md`): the
fix-round dispatch stops trusting per-agent-typed values where a cross-check
or engine-authored range exists. Two seams: (1) fix-round review packets diff
`<prior-impl-head>..<fix-head>`, hiding the implementation commits (4
independent field runs); (2) the fix anchor is the model-typed `impl.headSha`
(one observed fabricated tail). Design: a fix-round-only packet-range
override + a typed-values anchor cross-check, both in the inline FIX ROUND
preamble; plus a ten-word reviewer-fallback extension (baked) as the belt.

**Authoring note (relaxed same-file rule):** Tasks 1 and 2 both modify
`skills/ultrapowers/harnesses/waves.js` in different regions with no logical
dependency — the collision stands deliberately; the compiler orders them.

**Tech Stack:** Node ≥18 (harness + sims), Python 3.11 + pytest. Suite:
`python3 -m pytest`; sims: `node tests/sim_workflow.mjs` (must keep printing
`ALL SCENARIOS PASSED` — the suite-gate runs it whenever harness JS changes).

**Anti-drift constraint (global):** the reviewer prompt is baked from
`references/reviewer-prompts.md` (BAKE:REVIEWER_PROMPT) and pinned by
`tests/test_no_prompt_drift.py` — Task 2 edits the source AND the baked copy
in lockstep. The FIX ROUND preamble is inline engine-authored dispatch text
(waves.js:1132–1140), NOT baked — Task 1 edits waves.js only.

---

### Task 1: FIX ROUND preamble — packet-range override + anchor cross-check

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/harnesses/waves.js`

**Interfaces:**
- Produces: the two fix-round preamble instruction strings below, verbatim
  (Task 3's sim assertions grep them).

The fix-round dispatch (waves.js ~1132–1140) composes
`'BASE: ' + impl.headSha` plus the FIX ROUND paragraph. Extend that paragraph
with two instructions, using these exact sentences (engine-interpolated
values in `' + … + '` form):

1. Packet range: `' Generate your review packet for the FULL task range, not
   your BASE..HEAD: run review-package with base ' + baseSha + ' (the task
   base) and your committed HEAD. Your BASE above remains your anchor — the
   prior implementation to amend; only the packet range starts at the task
   base.'`
2. Anchor cross-check: `' Before anchoring, derive the prior tip: run
   PRIOR=$(git rev-parse ' + impl.branch + '); if PRIOR differs from the BASE
   sha above, report BLOCKED naming both, written exactly as: typed prior sha
   <typed> != derived branch tip <derived> — never build on either.'`

- [ ] **Step 1:** Apply the two sentences to the FIX ROUND preamble at the
  fix dispatch site. `baseSha` here is the wave base already in scope for the
  task (the same value the reviewer dispatch uses as its BASE); do NOT emit
  any new `BASE: `-prefixed line (matcher hazard — sim regexes match the
  `BASE: ` substring loosely).
- [ ] **Step 2:** `node tests/sim_workflow.mjs` → `ALL SCENARIOS PASSED`
  (existing scenarios must survive; Task 3 adds the new assertions);
  `python3 -m pytest -q` → PASS.
- [ ] **Step 3:** Commit: `fix(engine): fix-round dispatch — full-task packet range + typed-values anchor cross-check (#146)`

---

### Task 2: Reviewer guarded-fallback extension (the belt)

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/references/reviewer-prompts.md`
- Modify: `skills/ultrapowers/harnesses/waves.js`

The reviewer prompt's guarded fallback (waves.js:313; canonical source
`references/reviewer-prompts.md`) currently falls back to a read-only
`git diff <BASE> <HEAD>` when the packet is missing/unreported or its
recorded HEAD mismatches. Extend the trigger list with the recorded-base
check.

- [ ] **Step 1:** In `references/reviewer-prompts.md`'s reviewer-prompt
  block, extend the fallback sentence: after "or its recorded HEAD does not
  match the implementer HEAD", insert ", or its recorded base does not match
  the BASE in your inputs" (the packet's first line records its range as
  `# Review package: <base>..<head>`).
- [ ] **Step 2:** Re-bake the identical wording into waves.js's
  REVIEWER_PROMPT per `references/workflow-template.md`.
- [ ] **Step 3:** `python3 -m pytest tests/test_no_prompt_drift.py -q` → PASS;
  full suite → PASS; `node tests/sim_workflow.mjs` → sentinel.
- [ ] **Step 4:** Commit: `fix(engine): reviewer fallback also fires on packet base mismatch (#146)`

---

### Task 3: scenarioFixLoop assertions for the new preamble text

**Type:** implementation
**Depends-on:** 1

**Files:**
- Modify: `tests/sim_workflow.mjs`

**Interfaces:**
- Consumes: Task 1's two preamble instruction strings (verbatim).

- [ ] **Step 1:** In `scenarioFixLoop` (tests/sim_workflow.mjs:161–195, which
  already captures `fixPrompt`), add string assertions: (a) the packet-range
  instruction is present and carries the wave base sha the scenario dispatched
  (`sha-A` or the scenario's equivalent), i.e. the FULL-task-range sentence
  names the task base, not the prior impl head; (b) the anchor-derivation
  instruction is present and carries the exact mismatch string
  `typed prior sha <typed> != derived branch tip <derived>`; (c) the existing
  `BASE: <prior-head>` anchor line is unchanged (anchor and packet base are
  distinct values in the captured prompt). Plain string assertions — no
  shadow-copy mutation re-execution (tautological for text greps, per the
  spec's trim review).
- [ ] **Step 2:** Tighten any loose `BASE: ` matcher the new text would
  confuse only if actually confused — run the sim first; touch matchers only
  on a real false-pass/false-fail.
- [ ] **Step 3:** `node tests/sim_workflow.mjs` → `ALL SCENARIOS PASSED`;
  full suite → PASS.
- [ ] **Step 4:** Commit: `test(sim): pin fix-round packet-range + anchor cross-check dispatch text (#146)`
