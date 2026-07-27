# Spec: retire the tierOverrides channel (#101)

**Status:** approved design — brainstormed 2026-07-27 (docket sweep iteration 8).
Surfaces: `skills/ultrapowers/harnesses/waves.js` + `tests/sim_workflow.mjs`;
doc/reference scrub across `skills/ultrapowers/references/reviewer-prompts.md`,
`SKILL.md`, `references/workflow-template.md`, `references/dependency-analysis.md`,
`scripts/ultra_run.py`, `scripts/audit_run.py`.
Not the frozen verification periphery. A subtraction under the
subtraction-eval doctrine: mechanics hard-gated by the harness sims + suite;
no A/B quality cell (no user-exercised behavior changes).

## Problem

`args.tierOverrides` — the per-project tier-name→model remap — is
warned-against ballast:

- #89 (0.0.33) made inline wave-entry tiers the single knob channel; the
  driver's own `llmDerives` checklist warns *against* tierOverrides.
- No sensed run in the 118-run ledger has ever passed it (absent or `{}`).
- The 0.0.32 knob-drop bug family was caused by multiple knob channels;
  every surviving extra channel is standing risk of that class.
- Cost of keeping it: ~60 lines of validation/merge/pinning code, sim
  scenarios, four doc surfaces, and commentary a maintainer must hold.

Kill-switch check (per the issue): an operator workflow that actually
passes `tierOverrides` kills the candidate — none is known.

## Design

### Engine subtraction (`waves.js`)

- Delete the `tierOverrides` args extraction, the launch-time validation
  block, and `VALID_MODELS` (used only by that validation).
- `const TIER = Object.assign({}, DEFAULT_TIER, tierOverrides)` becomes
  `const TIER = DEFAULT_TIER`.
- The reviewer/completeness most-capable invariant survives as
  **unconditional**: reword the two "OVERRIDE-PROOF … tierOverrides" comments
  (at `REVIEWER_MODEL` and `reviewerModelFor`) to state the pin directly —
  reviewers and the completeness critic always run at
  `DEFAULT_TIER.mostCapable`; a weak reviewer's failure mode is the silent
  false PASS. `REVIEWER_MODEL`/`reviewerModelFor` expressions are unchanged.
- Delete the `tierOverrides` line from the args-shape comment block.

**Legacy-arg contract:** a launch that still passes `tierOverrides` gets the
same treatment as any unknown top-level args key — silently ignored,
coherently: no throw, implementer tiers map via `DEFAULT_TIER`, reviewer
stays most-capable. Pinned by sim (below).

### Sim rework (`tests/sim_workflow.mjs`)

- **Delete** `scenarioTierOverrideInvalid` (invalid model / unknown key must
  throw) — the validation it exercises is deleted.
- **Rework the portability scenario** (currently proves overrides apply to
  implementers but not reviewers): pass a legacy
  `tierOverrides: { cheap: 'opus', mostCapable: 'haiku' }` and assert it is
  **silently ignored** — no throw, implementer models come from
  `DEFAULT_TIER` (`cheap` → `haiku`, `standard` → `sonnet`), reviewer and
  completeness-critic models stay `opus`. This is the doctrine's mechanics
  gate: unknown top-level arg keys are ignored-or-rejected coherently, and
  the answer is "ignored".
- **Rework the reconcile-tier scenario**: reconcile tracks the
  implementer-side `mostCapable` — now always `DEFAULT_TIER.mostCapable`
  (`opus`) — with no overrides in args; the reviewer-stays-opus assertion
  remains.
- The `ALL SCENARIOS PASSED` sentinel and exit-code discipline are
  unchanged. Because the branch touches `harnesses/*.js`, the suite gate
  runs these sims automatically (`run_acceptance.sh --suite-gate --base`).

### Reference/doc scrub

None of the tierOverrides mentions in `reviewer-prompts.md` sit inside
`<!-- BAKE -->` blocks, so this is commentary editing — `test_no_prompt_drift.py`
stays green by construction (verify anyway).

- `references/reviewer-prompts.md`: the "built from `DEFAULT_TIER` so
  `tierOverrides` cannot weaken it" sentence and the tier-assignment
  paragraph's tierOverrides sentences become unconditional phrasing
  ("reviewers and the completeness critic always run at the default
  most-capable"); the tier table's per-task reviewer row drops
  "override-proof; `DEFAULT_TIER`-based" for "unconditional".
- `SKILL.md` Step 4 args example: drop `tierOverrides?`.
- `references/workflow-template.md`: drop the args-shape mention and the
  `args.tierOverrides` bullet; reword the two TIER-constant commentary
  passages (the tier map is the `DEFAULT_TIER` constant; the reviewer pin is
  unconditional).
- `references/dependency-analysis.md`: drop the `tierOverrides: {}` example
  line.
- `scripts/ultra_run.py` `LLM_DERIVES`: the knob warning "never a top-level
  launch key, never tierOverrides, which remaps tier names to models"
  becomes "never a top-level launch key" — the warning against a deleted
  knob is deleted with it. (The `waves[][].tier` substring the driver test
  asserts survives.)
- `scripts/audit_run.py` docstring: scrub the mention.

## Testing

Mechanics hard-gate: `python3 -m pytest` (incl. `test_no_prompt_drift.py`)
plus `node tests/sim_workflow.mjs` with the reworked scenarios — run
manually at build time and automatically by the drain's suite gate since
`harnesses/*.js` changes. No A/B eval cell: no observed workflow passes the
knob, so no user-exercised behavior changes.

## Rejected alternatives

- **Loud rejection of a legacy `tierOverrides` arg** (throw at launch):
  inconsistent with how the engine treats every other unknown args key, and
  it would keep validation code alive for a deleted concept. Silent-ignore
  matches the engine's existing contract and is pinned by sim.
- **Keeping the channel but documenting it harder**: the knob exists only
  to be warned about; documentation is the tax, not the fix.

## Collision note

`waves.js`, `ultra_run.py`, and `SKILL.md` are also touched by queued plans
(#96, #97, #99, #100, #95, #91). The docket drain serializes plans on the
integration branch in rank order; this plan lands last of the queued set
and rebases its edits onto whatever landed first.
