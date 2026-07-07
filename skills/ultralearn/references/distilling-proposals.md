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

## The governing rule — make the defect inexpressible, not detected

Every fix is a claim about where a defect lives. A guard claims it lives in
the world and must be caught; a structural change claims it lives in our
representation and can be made impossible. The ledger keeps ruling for the
representation — and the two age differently. A representation change is paid
once. A guard is a standing tax — one more concept to hold, one more check
that can false-red — collected from every future run; most of the engine's
observed clock bloat is these taxes compounding, not slow work. This is why
the rubric is structural-first: reactive guards accrete, and accreted
complexity breeds the next edge case — the loop chases its own tail.

So before drafting ANY fix, name what made the defect *possible* and propose
the change to that; the per-defect guard is the fallback, and on a recurring
cluster it requires a recorded `consolidationAttempted`. Twice validated: the
deterministic driver (2026-07-03) retired four guard-accreting classes at
once; the launch-file knob slots (2026-07-07) — themselves a prior cycle's
fix — became the next cycle's defect.

Two budget rules keep the portfolio honest across cycles:

- **Machinery is earned by recurrence.** A first occurrence gets a prose fix
  or a watch-item naming the recurrence that would justify a build; the build
  happens on the second occurrence. Never ship enforcement machinery around a
  prose rule that has not yet been given the chance to fail.
- **One additive guard per cycle.** Structural changes and deletions are
  unbudgeted; recommend at most one `additive-guard` for adoption per
  distill — the rest park as watch-items, however tempting.

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
