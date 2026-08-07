# The plan-defect lane — disclosed fixes of plan-transcribed defects instead of gate redirects

_Design for issue #112 (distill 2026-08-06 headliner). Operator decisions:
authority = reviewer + implementer (both lanes, always disclosed, never for
cross-task contracts); carries the CLI-spike isolation prose rider._

## Problem

The engine treats approved plan text as inviolable: reviewers who find a
genuine defect in plan-verbatim code are instructed (reviewer-prompts.md
§"Plan-supplied code is not privileged") to report it at severity `minor` so
it "routes to the pre-merge gate for a plan-level decision instead of a fix
round the implementer cannot resolve." The ledger shows what that costs:
25 findings across 19 runs where correctly-diagnosed defects skipped the cheap
capped fix loop and accumulated into full gate redirect relaunches — 6
findings → 2 relaunches in one run; 6 plan-defect groups → 1 redirect in
another; a wrong API field-name contract that survived three diff-only review
rounds. Redirect rounds are the engine's dominant post-launch cost, and this
routing rule is their largest single generator.

Meanwhile the deviation channel already works: implementers who deviated
proactively with disclosure (substituting a fallback-header helper the deploy
platform required; replacing an unsatisfiable plan-mandated test with a
documented equivalent) were audited and kept, every time.

## Design

### The lane

**Implementer lane.** An implementer who identifies a genuine defect in
plan-verbatim code MAY fix it while implementing, with a mandatory disclosure:
a `concerns` entry prefixed `plan-defect:` naming the plan text diverged from
and why — and the disclosure entails status `DONE_WITH_CONCERNS`, whose
existing headless downgrade path is what carries concerns into the report's
`judgmentCalls`. (The build verifies the fix-round dispatch path forwards
`plan-defect:` concerns the same way.) Undisclosed divergence remains a
blocking review finding, as today.

**Reviewer lane.** The reviewer instruction flips: a `plan-defect:` finding
whose fix is **task-local** is reported at its true severity — a blocking
defect engages the existing capped fix loop like any other blocking finding;
the fix-round implementer applies it with the same `plan-defect:` disclosure.
The same sentence also covers the mirror case so the reviewer's own
criterion-mapping step cannot mechanically block a lawful divergence: when the
diff diverges from plan text under a `plan-defect:` disclosure, verify the
disclosed fix against the criterion's intent, and block only if the divergence
is wrong or undisclosed. No new loop, no new cap, no new severity.

**The contract carve-out (both lanes).** A defect in a cross-task interface
surface — anything a sibling task `Consumes:` from this task's `Produces:` —
stays severity `minor`, gate-routed, exactly as today: a unilateral contract
fix in one worktree breaks siblings mid-wave. **Default when the boundary
cannot be established from the task's own inputs (Interfaces absent or
ambiguous): the defect is contract-level — when in doubt, gate.**

### Disclosure surfaces at the gate

Every `plan-defect:` disclosure (implementer concerns and fix-round
disclosures alike) rides the report's existing `judgmentCalls` array under the
existing **disagreement** kind ("look before approving") — no new report
field, no new kind. The existing report-format.md presentation rule that
groups judgmentCalls by kind gains a clause: within disagreement, cluster
`plan-defect:` entries — so the operator reviews all plan divergences as one
group at approval. No new presentation rule.

### Canary (rigor trade — required)

**canaryMetric: the redirect-round rate** (the doctrine default), compared
across engineVersion before and after adoption — it should fall, since
task-local plan defects stop converting into relaunches. When the next distill
decomposes the canary, two prefix-derivable diagnostics tell it why: the
per-run count of gate-routed plan-defect findings (should approach zero for
task-local defects) and the plan-defect judgmentCall count (silent-divergence
abuse shows up as reviewer-caught undisclosed divergences). A rising canary
triggers the reversal draft per the distill retrospective.

### Rider (prose-only, same surfaces)

ultraplan authoring rule, one line: spike tasks that spawn the real agent CLI
must isolate `CLAUDE_CONFIG_DIR` (or disable session persistence) — a
spike-spawned session wrote a false memory into a host project's auto-memory
(sev-3, first occurrence → prose only).

## Surfaces

- `skills/ultrapowers/references/reviewer-prompts.md` — the flipped routing
  sentence (task-local vs contract boundary, intent-verification clause,
  when-in-doubt-gate default) in the reviewer section; the implementer-lane
  disclosure sentence (with the DONE_WITH_CONCERNS entailment) in the
  implementer section.
- `skills/ultrapowers/harnesses/waves.js` — identical baked copies
  (anti-drift re-bake; `tests/test_no_prompt_drift.py` stays green; existing
  sims cover the unchanged dispatch plumbing — no new sim assertions, the
  drift pin owns sentence fidelity).
- `skills/ultrapowers/references/report-format.md` — one clause added to the
  existing judgmentCalls grouping rule (cluster `plan-defect:` within
  disagreement).
- `skills/ultraplan/SKILL.md` or `references/plan-markers.md` — the CLI-spike
  rider line only (the authoring note about expecting divergences was trimmed
  as inert).

Not built: no schema changes (`concerns` and `judgmentCalls` already exist),
no new report fields, no new severities, no new loop machinery, no gate-script
changes (frozen periphery untouched).

## Error handling / failure modes

- Implementer discloses a divergence the reviewer judges wrong → normal
  blocking finding; the fix loop restores plan text. The lane never exempts a
  diff from review.
- Divergence without disclosure → reviewer reports it as a blocking finding
  (the instruction says so explicitly) — the abuse case is caught by the same
  reviewer who today catches plan-unfaithfulness.
- Contract-level defect mis-classified as task-local → sibling breakage
  surfaces at wave merge/completeness as today; the critic's cross-task view
  is unchanged.

## Testing

- Prompt-drift pin green across source + baked copies (the pin owns sentence
  fidelity; no third pin layer).
- Existing prose-pin tests over reviewer-prompts.md updated in the same change
  where they pin the old routing sentence.
- Existing harness sims pass on the re-bake (suite-gate runs them on any
  harnesses/*.js change).

## Trim review

**Author disclosure (Adds/Removes), as drafted.** Adds: two prompt sentences,
a gate-presentation line, an ultraplan authoring note + the rider line, sim
assertions, a three-number canary. Removes: the unconditional route-to-gate
rule (the redirect generator); the implicit "plan text may never be corrected
in-run" concept. No new fields, kinds, severities, or loops.

**Reviewer verdicts** (fresh-context dispatch; saw the draft spec, issue #112,
the doctrine, reviewer-prompts.md, report-format.md): 4 trims + **3
under-specification gaps** (the reviewer was mandated to check both failure
directions for an authority-granting spec); grade: **flat**; scope
reconciliation noted the spec correctly refused #112's first-class-note-type
request, and that the contract carve-out is justified new scope arriving
under-specified.

**Adopt-or-answer — all seven adopted:**

1. Canary tripled → **adopted** (narrow): single canary = redirect-round
   rate; the two counts demoted to distill decomposition diagnostics.
2. New sim assertions (a third pin on the same sentence) → **adopted**
   (delete): drift pin owns sentence fidelity; existing sims cover unchanged
   plumbing.
3. Inert ultraplan authoring note → **adopted** (delete): rider line only.
4. New gate-presentation rule → **adopted** (merge): one clause in the
   existing judgmentCalls grouping rule.
5. **Gap:** reviewer criterion-mapping would mechanically block lawful
   disclosed divergences → **adopted**: intent-verification clause added to
   the boundary sentence.
6. **Gap:** boundary undefined when Interfaces absent; "plan-pinned shared
   text" undefined → **adopted**: when-in-doubt-gate default stated; vague
   phrase deleted.
7. **Gap:** disclosure could miss the gate under plain DONE → **adopted**:
   plan-defect disclosure entails DONE_WITH_CONCERNS; build verifies the
   fix-round path forwards prefixed concerns.

**Reviewer grade: flat** — the routing rule and the inviolability concept go
out; the carve-out boundary comes in.
