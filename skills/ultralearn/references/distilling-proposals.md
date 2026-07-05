# ultralearn — Distilling Proposals

You are the distill agent. You have read the ledger findings and are drafting
proposals for how the ultrapowers engine/skill/reference surfaces should change.
Every proposal you draft MUST carry the four fields below. Return proposals as
a JSON array.

## Required proposal fields

### `complexityEffect`

One of three values — choose the one that best describes what the proposal does
to the system's total rule/field/branch count:

- **`additive-guard`** — adds a conditional, field, or rule that handles one
  case. Accretes: the surface grows. Use when the edge case is genuinely
  irreducible and the guard is the minimum viable fix.
- **`structural`** — changes a representation so a whole class of cases can no
  longer occur (removes the underlying condition rather than guarding each
  instance). Neutral-to-▼ on complexity. Prefer this framing whenever it is
  feasible.
- **`simplification`** — removes a branch, field, or rule outright. Strictly
  ▼ on complexity. Prefer this framing when the feature is redundant or the
  condition it guards has been eliminated.

### `consolidationAttempted`

**Required for any cluster that appears in ≥3 runs OR has appeared in ≥2 prior
distills.** A one-line answer to the question: *"can a representation change
delete this whole cluster?"*

- If **yes**: the structural framing is the primary proposal and the additive
  guard is the fallback. Write the structural proposal first.
- If **no**: state in one line why the guard is irreducible (e.g., "the
  variation is environmental, not representational").
- If the cluster does not meet the ≥3-run / ≥2-distill threshold, set this
  field to `null`.

### `canaryMetric`

**Required when the proposal trades authoring or verification rigor for token
or clock efficiency** — looser plan bodies, fewer or lighter review passes, a
skipped check; `null` otherwise. Name the single post-adoption number that
will tell the next distill whether the quality gamble is paying. Default: the
**redirect-round rate** — the per-run redirect-round count the sensing rubric
requires, compared across `engineVersion` before and after adoption. A rising
canary means the trade is failing; flag it and draft the reversal as a
proposal rather than letting the regression stand.

### `netConceptDelta`

Does the standing-concept count (the number of named terms, fields, states, or
dispositions a reader must hold in mind) go **up**, **flat**, or **down** after
this proposal is adopted?

Use one of: `up` | `flat` | `down`.

## The governing rule — structural-first

Before drafting ANY fix for a defect cluster, first answer: *what simpler
representation or architecture change would delete this whole class?* Draft
that answer as the primary proposal; a reactive per-defect guard is the
fallback, and on a recurring cluster it requires a recorded
`consolidationAttempted`.

Why this order is the default, not a taste: reactive guards accrete
complexity, and accreted complexity breeds the next edge case — the loop
chases its own tail. Validated in practice 2026-07-03: four recurring ledger
classes (launch-args schema guessing, pre-existing-dirt stash-dance, prose
choreography drift, wrong-cwd gate) had each drawn reactive fixes across 3–4
runs; one structural move — the deterministic driver — retired all four at
once by removing the conditions that generated them.

> *The rubric prefers — it does not forbid; some edge cases are genuinely
> irreducible (say why in one line, via `consolidationAttempted`).*

## The deletion candidate (mandatory, one per cycle)

Every distill output must include at least one `simplification` proposal — a
standing rule, guard, knob, or subsystem the evidence suggests could be removed.
The lenses are friction-biased and will never nominate a deletion on their own;
this requirement is the loop's counterweight. A weak nomination is acceptable
and still counts: state the candidate, the evidence that would justify removal,
and what currently blocks it. Ranking it last is fine; omitting it is not.

## Output schema (one object per proposal)

- `title` (string) — a one-line headline.
- `surface` (string) — the repo path(s) a fix would touch.
- `complexityEffect` (string) — one of `additive-guard` | `structural` | `simplification`.
- `consolidationAttempted` (string | null) — required for recurring clusters; null otherwise.
- `canaryMetric` (string | null) — required for rigor-for-efficiency trades; null otherwise.
- `netConceptDelta` (string) — one of `up` | `flat` | `down`.
- `rationale` (string) — why this proposal addresses the ledger finding.
- `runIds` (string[]) — the run IDs whose findings motivate this proposal.
- `lenses` (string[]) — which ledger lenses (friction | routing | operator | cost | frontier) the evidence comes from.
