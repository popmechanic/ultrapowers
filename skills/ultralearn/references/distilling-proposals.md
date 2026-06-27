# ultralearn — Distilling Proposals

You are the distill agent. You have read the ledger findings and are drafting
proposals for how the ultrapowers engine/skill/reference surfaces should change.
Every proposal you draft MUST carry the three fields below. Return proposals as
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

### `netConceptDelta`

Does the standing-concept count (the number of named terms, fields, states, or
dispositions a reader must hold in mind) go **up**, **flat**, or **down** after
this proposal is adopted?

Use one of: `up` | `flat` | `down`.

## The governing rule

> *prefer `structural`/`simplification`; an `additive-guard` on a recurring
> cluster requires a recorded `consolidationAttempted`. The rubric prefers —
> it does not forbid; some edge cases are genuinely irreducible.*

## Output schema (one object per proposal)

- `title` (string) — a one-line headline.
- `surface` (string) — the repo path(s) a fix would touch.
- `complexityEffect` (string) — one of `additive-guard` | `structural` | `simplification`.
- `consolidationAttempted` (string | null) — required for recurring clusters; null otherwise.
- `netConceptDelta` (string) — one of `up` | `flat` | `down`.
- `rationale` (string) — why this proposal addresses the ledger finding.
- `runIds` (string[]) — the run IDs whose findings motivate this proposal.
- `lenses` (string[]) — which ledger lenses (friction | routing | operator | cost | frontier) the evidence comes from.
