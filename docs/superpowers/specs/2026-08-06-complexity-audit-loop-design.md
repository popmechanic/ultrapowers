# The complexity-audit loop — value-vs-complexity checked by something the author can't touch

_Design approved in brainstorm 2026-08-06. Codifies the operator's standing
requirement: every change to ultrapowers — especially those arriving through
`ultralearn` / `ultralearn distill` — must be interrogated for whether it adds
more complexity than the value it returns, at two binding points, with the
spec-time check performed adversarially rather than self-graded._

## Problem

The complexity conviction is already encoded at two ends of the pipeline —
distill proposals carry required fields (`complexityEffect`,
`consolidationAttempted`, `canaryMetric`, `netConceptDelta`, the
one-additive-guard budget, the mandatory deletion candidate), and the ratchet
tests pin SKILL.md's word/concept budgets. The unguarded middle is the design
stage: between an approved distill proposal and the spec the operator reviews,
scope can silently re-expand, and the spec's own complexity grade is written by
its author. Case study: #114's spec grew implementer-side sidecar writes, a
provenance field, and advisory critic vocabulary beyond its proposal — graded
"netConceptDelta: flat" by its author — and only an operator challenge produced
the trimmed (merge-agent-only) version. Fourth recurrence of the family
(2026-07 paranoia-loop review, the 0.1.0 subtraction lesson, #106, #114), so
machinery is earned.

## Design

Two binding points, chosen by the operator; one new practice at each. Amended
after the first live trim review (below): the author-side ledger collapsed into
the trim-review record, the reconciliation check moved to the reviewer, the
retrospective's reversal trigger narrowed, and no new reference file is minted.

### 1. Spec approval — the adversarial trim review

Before any spec in this repo is presented for operator review, dispatch **one**
fresh-context subagent — the seal-author independence model: it sees the spec
text, the originating proposal/issue text, and
`references/distilling-proposals.md`; never the authoring conversation. Its
mandate:

- **propose the trimmed version** — what to delete, narrow, or merge;
- **reconcile scope** — did the design grow beyond the originating proposal's
  claimed `complexityEffect`/`netConceptDelta`? (independent, not self-graded);
- **grade `netConceptDelta` itself** — the author never grades their own design.

Bounded: one dispatch, no loops, no fix authority. The spec then carries a
`## Trim review` section: the author's compact Adds/Removes disclosure (input
to the reviewer, not a verdict), the reviewer's trims and grade, and an
**adopt-or-answer** line for every trim — rejections visible with reasons; the
operator adjudicates. A no-findings review is recorded as such and the spec
proceeds (advisory to the operator, never a false-red gate).

### 2. Distill — the adopted-proposal retrospective (cluster-died check)

`ultralearn distill` gains a required output section (housed in
`distilling-proposals.md`, which the distill verb already reads): for every
previously adopted proposal whose fix has shipped in a released version,
compare its target cluster's recurrence in ledger findings at
`engineVersion >=` the adopting release. A persisting cluster is flagged
**possibly-failed fix** on first persistence; a **second** persistence makes
drafting the reversal (or corrected fix) mandatory distill output — the same
recurrence bar the doctrine applies to everything else. This generalizes the
existing `canaryMetric` reverse-check from rigor trades to all adopted
proposals with a named target cluster, at instruction-only cost.

## Surfaces

- `CLAUDE.md` ("How features are built here"): one binding sentence — no spec
  reaches operator review without its trim review.
- `skills/ultralearn/references/distilling-proposals.md`: append the
  trim-reviewer dispatch brief (inputs, mandate, output shape, adopt-or-answer
  rule, the `## Trim review` section format) and the adopted-proposal
  retrospective rule.

Not built: no new files, no scripts, no tests beyond existing prose pins, no
gate changes, no per-run machinery, no agent-registry entry — the trim
reviewer is a dispatch convention documented in the doctrine file.

## Error handling / failure modes

- Trim reviewer returns nothing useful -> recorded as "trim review: no
  findings"; the spec proceeds.
- Author rejects a trim -> allowed; rejection + reason visible; operator
  adjudicates.
- Retrospective: first persistence -> flagged possibly-failed; second ->
  reversal draft mandatory; adoption stays operator-gated.

## Trim review (self-application — the first live dispatch, on this spec's draft)

**Author disclosure (Adds/Removes).** Adds: 1 CLAUDE.md sentence; 1 doctrine
append (`distilling-proposals.md`); 1 required spec section per future spec; 1
subagent dispatch per future spec; 1 required distill-output section; one named
practice ("trim review"). Removes: the self-graded-complexity seam at spec
time; the operator's recurring ad-hoc labor of raising the challenge.

**Reviewer verdicts** (fresh-context dispatch; saw the draft spec + doctrine
only): 4 trims, reviewer netConceptDelta grade **up** — "the trimmed version
delivers the claimed value at roughly half the standing concept count."

**Adopt-or-answer:**

1. *Delete the author-side Adds/Removes ledger inventory* (it reproduces the
   self-grading defect) — **partially adopted**: the inventory survives only as
   compact disclosure (reviewer input); the author's self-graded
   `netConceptDelta` is deleted — the reviewer owns the grade. Two named
   practices collapsed to one.
2. *Move the scope-reconciliation check into the reviewer's mandate* —
   **adopted** verbatim.
3. *Delete the distill retrospective as recurrence-unearned* — **rejected,
   narrowed**: the gate was operator-selected, and it codifies a check the
   sense passes already perform informally (#89 field confirmation, #90
   re-validation ×5); but the reviewer's heaviness point is taken — mandatory
   reversal drafts now trigger on **second** persistence, not first.
4. *No new reference file; append the brief to `distilling-proposals.md`* —
   **adopted**, and the SKILL.md pointer sentence was cut with it (the distill
   verb already reads the doctrine file).

**Reviewer grade stands: netConceptDelta up** — accepted deliberately on a
4-recurrence family, where the added check is the counterweight to unbounded
accretion everywhere else. Trims taken pre-review: mechanical delta accounting
(approach C) parked; pre-merge and plan-approval binding points considered and
not selected.
