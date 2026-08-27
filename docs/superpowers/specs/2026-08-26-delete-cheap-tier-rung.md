# Delete the `cheap` tier rung — collapse the implementer ladder to standard/most-capable (#286)

**Date:** 2026-08-26
**Issue:** #286 (#242(b)'s narrowed verdict, operator-endorsed adjudication at
popmechanic/ultrapowers#242 comment 5429023790).
**Surfaces:** `skills/ultrapowers/harnesses/waves.js`,
`skills/ultrapowers/SKILL.md`, `skills/ultrapowers/references/reviewer-prompts.md`
(un-baked §Model tiers only), `skills/ultrapowers/references/workflow-template.md`,
`skills/ultrapowers/scripts/ultra_run.py` (comment only), `tests/test_canary.py`,
`tests/sim_workflow.mjs` (+ incidental fixture-tier sweeps in other sims),
`tests/test_redirect_args.py` (fixture value).
**Frozen periphery:** untouched. **Not plan grammar:** tier is a session-derived
launch knob; `compile_plan.py` has no tier surface (verified — no consumer).

## Problem

Evidence (deduped scan, 65 local task executions): haiku 4 tasks / 0 fix
cycles, sonnet 42 / 12%, opus 19 / 16%. The `cheap` rung is 4–6% of usage with
no measurable saves; fix rates track task difficulty, not tier thinness;
#230's foreign datum does not replicate locally. The rung is dead weight in
the ladder, the derivation guidance, and the escalation logic. Absorbs
watch-item #230 (retire cheap-tier dispatch on fix/redirect work) — deleting
the rung everywhere supersedes it.

## Design

### waves.js

- `DEFAULT_TIER` → `{ standard: 'sonnet', mostCapable: 'opus' }` (cheap key
  deleted). `TIER_LADDER` → `['standard', 'mostCapable']`; `escalateTier`
  logic unchanged (unknown still → `mostCapable`).
- Setup and merge dispatches (currently `TIER.cheap`) move to a new named
  constant `UTILITY_MODEL = 'haiku'`. These are fixed engine roles, not ladder
  rungs; the adjudication rejected unforced base-cost increases, so their
  model does not change — only their naming decouples from the deleted rung.
- **Migration (warn + coerce — zero new control flow):** with `cheap`
  deleted from the map, the EXISTING unknown-tier fallback already does the
  work: the tier value resolves undefined → dispatch at `TIER.standard`, a
  log line, and a `judgmentCalls` entry. No new branch is added. The fallback
  message text is extended to name the retirement — "… fell back to standard
  (valid: standard, mostCapable/most-capable; 'cheap' retired, #286)" — so a
  coerced launch file is diagnosable from the run report. Note the entailed
  escalation edge: `escalateTier` on an unknown (incl. `cheap`) tier returns
  `mostCapable` (existing posture), so a capability-fixable retry of a
  coerced task escalates past `standard` — accepted, matches the current
  unknown-tier behavior.
- Comments at the tier map/ladder updated to the two-rung story; the
  historical #20 evidence line in `reviewer-prompts.md` :217 ("realized
  difficulty tracks spec risk, not diff size") is KEPT, reworded past-tense
  where it names the retired rung.

### skills/ultrapowers/SKILL.md

- :76 tier derivation: `(cheap/standard/most-capable)` → `(standard/most-capable)`;
  the transcription-grade guidance folds into `standard` (no replacement rung).
- :305 redirect amend wording: "right-size `tier` down when the fix is
  mechanical" → "right-size `tier` down to `standard` when the fix is
  mechanical" (the only down rung left).

### references (un-baked prose — no re-bake required)

- `reviewer-prompts.md` §Model tiers: delete the `cheap` row; `standard`
  becomes the floor tier ("Multi-file integration … or any transcription-grade
  task" — one merged row); prose "Setup and merge run at `cheap`" → "Setup and
  merge run at a fixed utility model (haiku)". This section sits outside the
  BAKE markers (verified: markers end at :192) so the drift pin is untouched
  by it; the pin still gates the waves.js prompt constants, which this spec
  does not edit.
- `workflow-template.md` :196/:201: same two-rung + utility-model story.
- `wave-merge.md:119` "a cheap model improvising" — generic English, not the
  tier name; unchanged.

### ultra_run.py

`VALID_TIERS` keeps accepting `"cheap"` (a redirect/salvage args file
authored under 0.2.22 must not fail preflight), with a comment naming the
retirement and #286. The coercion is kept indefinitely — its standing cost is
one set member and an already-existing fallback branch; a hard rejection MAY
be cut in a later release if the coercion ever earns a defect, but no
rejection release is pinned (trim-review adjudication — the issue's
"then reject" phase is downgraded: a breaking change with real cost buys
nothing over a visible permanent coercion).

### Tests

- `tests/test_canary.py`: replace the `"cheap: 'haiku'"` pin with pins on the
  new shape — `"standard: 'sonnet'"` present, `"cheap: 'haiku'"` absent,
  `UTILITY_MODEL = 'haiku'` present.
- `tests/sim_workflow.mjs` (suite-gate covering sim — new engine behavior):
  the economics scenario's `cheap` task now asserts the coercion — resolved
  model `sonnet` AND a `judgmentCalls` entry naming the retirement. Setup and
  merge model assertions stay `haiku`. The unknown-tier fallback scenario
  stays. Sim must keep printing its ALL-SCENARIOS-PASSED sentinel.
- **Sweep set (named):** incidental `tier: 'cheap'` fixture data goes to
  `'standard'` in `tests/sim_workflow.mjs` itself (the largest set — dozens
  of hits across scenarios), `tests/frontier_merge.mjs`,
  `tests/wave_ancestry_sim.mjs`, `tests/sim_derived_heads.mjs`, and
  `tests/test_redirect_args.py`. The one deliberate `cheap` remains in the
  coercion scenario. Any scenario asserting on `judgmentCalls` contents or
  emptiness is checked — an unswept `cheap` fixture would now emit an entry.
- **sim_workflow.mjs portability scenario** (legacy `tierOverrides` with
  `cheap`/`mostCapable` keys, asserting "cheap stays haiku"): its meaning
  ("legacy tierOverrides are ignored") survives the rung — rewrite the
  fixture to `standard`/`mostCapable` keys and assert `standard` stays
  `sonnet` despite `tierOverrides.standard: 'opus'`.
- Assertion-message prose naming "the cheap model (haiku)" for setup/merge is
  reworded to "the utility model (haiku)".

## Compatibility

Old marked plans keep compiling — tier was never plan grammar. Old LAUNCH
files (redirect-args.json, salvage-args.json, hand-kept args) carrying
`"tier": "cheap"` pass ultra_run preflight and dispatch at `standard` with a
visible judgment-call. Nothing is silently coerced — the judgmentCalls entry
rides the run report.

## Out of scope

Review marker (kept — adjudication NO-GO), full tier-knob deletion (NO-GO;
eval-route if ever), Commutes retirement (pre-registered trigger, post-W2),
reviewer/critic model pinning (already unconditionally most-capable).

## Trim review

**Author disclosure — Adds:** `UTILITY_MODEL` constant, retirement mention in
the fallback message, coercion sim scenario, canary-pin update. **Removes:**
the `cheap` rung from map/ladder/derivation guidance/tier table across four
docs, the `cheap` dispatch-tier concept, watch-item #230.

**Reviewer (fresh-context, 2026-08-26): 4 trims (1 merge, 1 narrow, 1
delete, 1 keep), 2 missed consumers, grade DOWN.** Adopt-or-answer:

- **Trim 1 (merge coercion into the existing unknown-tier fallback) —
  ADOPTED.** Zero new control flow; message extension only. Spec rewritten
  accordingly.
- **Trim 2 (drop the pinned rejection release) — ADOPTED.** Coercion kept
  indefinitely; "may reject" replaces the issue's "then reject" (divergence
  from issue text recorded here — the two-phase rejection cost a tracked
  issue and a breaking change for near-zero benefit).
- **Trim 3 (delete the SKILL.md:305 edit) — ANSWERED (kept).** The issue
  names :305 explicitly; the two-word amendment makes the only remaining
  down-rung explicit at trivial cost.
- **Trim 4 (UTILITY_MODEL) — KEPT** as specced (reviewer concurred).
- **Missed consumer 1 (portability scenario) — ADOPTED.** Rewrite defined in
  Tests.
- **Missed consumer 2 (sim_workflow's own fixture hits + assertion prose) —
  ADOPTED.** Sweep set now named; prose reworded.
- **Under-spec (keep #20 citation) — ADOPTED** (kept, reworded past-tense).
- **netConceptDelta: down** (reviewer-graded; deletions dominate).
