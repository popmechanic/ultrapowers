# Spec: right-size review/safety + make the wave roadmap legible

**Date:** 2026-06-27
**Status:** design approved; plan to follow (`superpowers:writing-plans` + `ultrapowers:ultraplan`)
**Disposition:** `Acceptance: suite` — this builds ultrapowers itself; `python3 -m pytest` +
`validate_skill.py` are the verification, and the operator reads the diffs. No sealed exam.
**Provenance:** an A/B benchmark (SDD `subagent-driven-development` vs `/ultrapowers` on one plan,
n=1 directional) followed by a state-machine audit of 10 complexity points, each with an adversarial
verify that argued the opposite. All verdicts cited here SURVIVED that adversarial check. Source
artifacts: `~/crm-eval/orchestration-analysis.html` and the salvaged
`analysis-bundle.json` (per-point rationale + counterargument + grounding).

This spec carries **two co-equal objectives**, neither optional:

- **Objective 1 — right-size the review/safety stack.** Three `make-conditional` audit verdicts:
  narrow where the cost lands without removing the capability where it earns its keep.
- **Objective 2 — make the parallel-wave roadmap legible in the live progress UI.** Two operator-
  requested changes so the run shows what each wave *delivers*, all at once, instead of revealing
  generic "Wave N" labels one at a time.

---

## 1. Problem (grounded against 0.0.24)

### Objective 1 — three places the review/safety stack over-spends

1. **Double adversarial review fires on the wrong signal.** Under the `adversarial` profile the
   engine runs the SAME merged spec+quality reviewer prompt TWICE on opus, sequentially
   (`waves.js` ~681-697), then unions+dedupes findings. The two passes are byte-identical (same
   `reviewPrompt`, same override-proof opus `REVIEWER_MODEL` at ~476); only LLM sampling differs —
   a variance-reduction ensemble, not a division of labor. The trigger (SKILL.md Step 2, ~156-158)
   ties `adversarial` to *high-stakes **or** `most-capable` tier*. In the benchmark that proxy
   mis-fired: a toy app got doubled review because tasks were tagged most-capable, not because they
   were risky, and the second pass caught **0** extra findings on all 3 adversarial tasks. (A
   separate foreign run did record the 2-pass catching a real save/load wiring gap — on a
   data-layer task, not an auth/money keyword. The capability is real; the trigger is wrong.)

2. **Reviewers are pinned to opus even on trivial lean diffs.** `REVIEWER_MODEL =
   DEFAULT_TIER.mostCapable` (`waves.js` ~476), override-proof. The pin is sound where risk is real
   — and SDD agrees there (it opus-es risky reviews and its final pass). The only true divergence
   is the per-task *floor*: SDD drops to a sonnet floor for trivial single-file diffs; ultrapowers
   pays opus on every `lean` haiku-tier task. The reviewer is the model's own named "dominant token
   sink"; in the benchmark it ran full opus passes on trivial single-file modules for ~zero return,
   a major contributor to the +489,809-token gap. (Clock impact was within noise; this is a
   token/cost problem, not a speed one.)

3. **Agent-error escalation bumps the tier blindly.** On any thrown `agent()` fault a task retries
   once at the next tier up (`waves.js` runTask ~582-606; `escalateTier` ~467); a second throw
   fails the task and cascade-blocks dependents. The `try/catch` *containment* is mandatory —
   `parallel()` is fail-fast, so an uncaught throw in a 16-wide wave rejects the whole wave and
   loses the report. But the *tier bump* fires identically across throw classes the engine could
   distinguish: a schema/StructuredOutput contract trip (capability-fixable — a stronger model is
   the right lever, the documented win) vs an Overloaded null-return turned into a throw (platform
   contention — bumping to a MORE-contended top model is the wrong lever) vs a deterministic
   engine/structural fault (no model capability fixes it; e.g. an import that fails because a
   `Depends-on` edge is missing). Burning a cheap AND a top-tier agent to re-hit the same
   deterministic wall is pure waste.

### Objective 2 — the wave roadmap is invisible until each wave starts

The full wave plan is computed deterministically before launch (SKILL.md Step 2, rendered at
Step 3). But the frozen engine ships `meta.phases: []` (`waves.js` ~26) and labels each wave
generically with `phase('Wave ' + (w + 1))` (~1004), activating one wave at a time. So the live
progress UI never shows what a wave delivers, and never shows the *shape* of the run (how many
waves, what's pending) until it happens — even though that information already exists upstream and
just never reaches the progress panel.

---

## 2. The asymmetry, named

Every `make-conditional` verdict here rests on the same asymmetry the engine was built around: **a
weak reviewer's failure mode is the silent false PASS**, which propagates undetected because the
reviewer is the last line of defense. That is why none of these three changes is a *cut*:

- We keep the adversarial capability, the opus reviewer, and the one bounded retry — we only stop
  firing them where they demonstrably buy nothing.
- The floor never drops below **sonnet** (the deliberately-adequate floor, never haiku), and never
  applies to adversarial passes, risk surfaces, the completeness critic, reconcile, or fix rounds.
- The escalation keeps exactly one recovery attempt; we change only *which tier* that attempt uses.

The audit's adversarial-verification step also produced two **corrections to the original
prescriptions** that this spec adopts:

- It **rejects the spec-only / quality-only pass split** (the "restoration" hinted at in
  `reviewer-prompts.md` ~108-109) as a *net safety regression*: both passes are full-spectrum today,
  so the union is double-coverage per defect class; splitting gives each class a single draw and
  deletes the resampling redundancy that is the mechanism's whole justification. We narrow the
  trigger and keep both passes full-spectrum.
- For escalation it forces a **same-tier default**, treating fail-fast as opt-in only for
  provably-deterministic faults — never a blanket fail-fast that would regress into a cascade-block.

---

## 3. Design

### 3.0 The single risk signal that ties A and B together

Once the orchestrator marks `adversarial` only on genuine risk/data-layer tasks (3.1), a task with
`review === 'lean' && tier === 'cheap'` is **by construction** a trivial, non-risk task. So the
engine's reviewer floor (3.2) can key off `review` + `tier` directly, with **no separate risk flag
to thread through args**: `review === 'adversarial'` ⇒ opus wins automatically. A and B share one
classification, single-sourced in the orchestrator's adversarial/lean decision.

### 3.1 Fork A — narrow the adversarial trigger (orchestrator prose)

In **SKILL.md Step 2** (the `task.review` derivation, ~156-158), replace "high-stakes or
`most-capable` tasks warrant `adversarial`" with: mark a task `adversarial` only when it is

- on a **genuine risk surface** — sealed acceptance, or touches auth / payments / migrations /
  public-API / data-integrity (derivable from the task's `Type`/`Files`/body), **OR**
- a **foundation / data-layer** task (owns the persistence/data layer and/or has downstream
  dependents — the class that produced the one real foreign-run catch).

Tier alone never triggers it. Routine `cheap`/`standard` tasks with no risk signal stay `lean`.
Update the matching prose in **reviewer-prompts.md** (~111) and rewrite the ~103-109 "divergence
from 5.1.0" note to record the *decision*: keep both passes full-spectrum; do **not** split into
spec-only/quality-only (the audit showed the split deletes resampling redundancy). These edits are
**outside** the `<!-- BAKE -->` markers — no re-bake, no `REVIEWER_PROMPT` change.

### 3.2 Fork B — sonnet floor for trivial lean reviews (engine)

In **waves.js**, introduce a per-task reviewer-model selector built from `DEFAULT_TIER` (so it is
override-proof — `tierOverrides` can never weaken it):

```
reviewerModelFor(task) =
  (taskReviewProfile(task) === 'lean' && tierKey(task.tier) === 'cheap')
    ? DEFAULT_TIER.standard      // sonnet floor
    : DEFAULT_TIER.mostCapable   // opus
```

Use it **only** at the per-task review dispatch (~684). The **completeness critic** (~1166)
keeps the constant `REVIEWER_MODEL` (opus); **reconcile** (~812) and **fix rounds** (~762) keep
`TIER.mostCapable`. Net effect: opus stays everywhere it matters; sonnet applies only to the
lean+cheap+non-risk bucket. Floor never reaches haiku. Update the model-tier table in
**reviewer-prompts.md** (~197-205) and the model-tier mapping doc in **workflow-template.md** to
document the floor — both outside the BAKE markers, so no re-bake.

**Accepted residual risk:** the floor trusts the orchestrator's `adversarial`/`lean` classification
as the risk signal. A risk task mis-marked `lean` *and* cheap would get sonnet review — but sonnet
is the adequate floor (not weak), and the opus completeness critic still backstops the whole
integration. This is the audit's "correlated double-failure" concern, bounded to a sonnet floor.

### 3.3 Fork C — classify the escalation (engine)

In **waves.js** `runTask` (~582-606), keep the `try/catch` containment unconditionally. Change the
single retry:

- **Default to same-tier retry** (preserves the one recovery attempt without burning a top tier).
- **Escalate one rung only for capability-fixable faults** — a StructuredOutput/schema contract
  trip, detected from the error message/shape. (This is the documented win the bump exists for.)
- **Route Overloaded/null faults to same-tier**, fixing the path where an Overloaded null-return is
  turned into a throw and then blindly escalated to a more-contended top model.
- **Annotate suspected structural faults** — when the error looks like a missing import /
  module-not-found that points at an absent dependency — with a `judgmentCalls` note: *"looks like a
  missing Depends-on edge"*, so the operator sees the likely root cause at the gate. (Diagnosis
  only; we do **not** blanket fail-fast — that risks regressing into cascade-block.)

Non-prompt engine logic; no re-bake.

### 3.4 W1 — semantic wave labels (orchestrator + engine)

- **SKILL.md Step 4** synthesizes a deliverable-themed label per wave into `args.waveLabels[]`
  (a short, human-readable theme drawn from the wave's task titles/deliverables), documented in the
  **workflow-template.md** args contract.
- **waves.js** renders `phase(args.waveLabels?.[w] ?? ('Wave ' + (w + 1) + ' · ' +
  WAVES[w].map(t => t.title).join(', ')))`, truncated for wide waves. A bare "Wave N" is never
  shown alone — the title-join is the deterministic in-engine fallback when no label is passed.

### 3.5 W2 — wave roadmap preview (engine, with confirmation + fallback)

After WAVES validation and **before** `phase('Setup')` (~939), pre-register every wave's
`phase(...)` (using the same W1 label resolution) plus `Setup` and `Integration Review`, so all
appear as pending up front; the real loop re-activates each in turn.

This relies on `phase()` being keyed by title (re-calling the same title reuses the group box).
**Confirm this on a throwaway run first** — a tiny standalone Workflow `scriptPath` that
pre-registers phases then re-activates them, observing whether the display preserves order or
reorders/duplicates. (This is NOT dogfooding `/ultrapowers` — it is a phase()-semantics spike.)

- If re-registration holds order → ship the pre-registration block.
- If it reorders/duplicates → **zero-risk fallback**: emit a single `log()` roadmap line at startup
  listing all waves, and keep the per-wave `phase()` activation as today.

W1 and W2 ship together and share the label resolution.

---

## 4. Surfaces touched

| Change | Files | Baked block? |
|---|---|---|
| A — adversarial trigger | `SKILL.md` (Step 2), `references/reviewer-prompts.md` (~103-111) | No |
| B — sonnet reviewer floor | `harnesses/waves.js`, `references/reviewer-prompts.md` (~197-205), `references/workflow-template.md` | No |
| C — escalation classifier | `harnesses/waves.js` | No |
| W1 — semantic labels | `SKILL.md` (Step 4), `harnesses/waves.js`, `references/workflow-template.md` | No |
| W2 — roadmap preview | `harnesses/waves.js` | No |

**Zero re-bake property.** No edit touches a `<!-- BAKE -->` block in `reviewer-prompts.md` or
`wave-merge.md`; all prose edits land outside the markers. `tests/test_no_prompt_drift.py` stays
green by construction. (The rejected Fork-A split would have been the only re-bake trigger.)

**Same-file serialization.** `waves.js` is touched by B, C, W1, W2; `SKILL.md` by A and W1;
`reviewer-prompts.md` by A and B. Per ultraplan's worktree-pure rules, these are sequenced with
`Depends-on` edges rather than faked into parallel width.

---

## 5. Acceptance — `suite`

The committed suite is the verification (no held-out exam). The plan must keep these green and
extend them:

- **`test_no_prompt_drift.py`, `test_superpowers_compat.py`, `validate_skill.py`** — stay green.
- **New/extended source-introspection pins** (the established idiom — read `waves.js` and assert on
  content, cf. `test_review_dispatch_lean.py`):
  - **B:** `reviewerModelFor` exists, is built from `DEFAULT_TIER` (override-proof), is used at the
    per-task review dispatch, returns sonnet for lean+cheap and opus otherwise; the completeness
    critic still dispatches at the opus `REVIEWER_MODEL`.
  - **C:** the retry path defaults to same-tier; escalation is conditional on a schema/contract
    signal; an Overloaded/null fault does not escalate; the structural-fault diagnostic string is
    present.
  - **W1:** the wave-loop label reads `args.waveLabels` with the `'Wave N · '+titles` fallback.
  - **W2:** the pre-registration block (or the `log()` fallback) precedes `phase('Setup')` and emits
    every wave label + Setup + Integration Review.
- **Text-pin guards** for the prose decisions (cf. `test_recommendation_rubric.py`): SKILL.md Step 2
  no longer ties `adversarial` to tier alone; reviewer-prompts.md records "no split / full-spectrum".
- **Regression watch:** the swarm viewer/layout specs (`tests/test_swarm_*.py`, `swarm_*_spec.mjs`)
  consume phase/station data — W1/W2 must not break them.

The operator and the agent read the diffs at the gate.

---

## 6. Out of scope (noted, not implemented)

- **Fork-A diff-size gate** — skipping the 2nd adversarial pass on trivial diffs even when tagged.
  The trigger narrowing fixes the documented mis-fire; the diff-size gate adds runtime engine logic
  for a tail benefit on n=1 evidence. Defer (audit guidance: "instrument then narrow").
- **Audit item 4 — per-task worktree isolation for width-1 waves.** Touches the branch/merge model;
  the refined verdict requires narrowing isolation-skip to *leaf/terminal* width-1 singletons while
  keeping isolation for foundation tasks. Higher-risk; future.
- **Audit item 5 — sealed-acceptance friction.** Already cheap-when-off; the refined verdict is
  "narrow via lower waiver friction, not default-inversion." Lowest priority; future.

These three follow-ups are recorded so the scope boundary is explicit, not forgotten.
