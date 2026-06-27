# Cross-phase integration acceptance — design

**Date:** 2026-06-27 · **Status:** draft design, pre-plan (awaiting operator approval)
**Scope:** close the multi-run false-green where an effort split across several
independently-sealed `/ultrapowers` runs ships N green per-phase gates but no
review of the *cross-phase integration* (ultralearn P2). Per the G1 governor this
is **guidance, not new engine mechanism**. Doc change → **Acceptance:** suite.

---

## 0. TL;DR

ultralearn's sharpest false-green finding (a foreign run, 0.0.24): six green per-phase sealed
gates still let ~21 cross-phase integration bugs (incl. a crash) through; a holistic review
caught them. Within a **single** ultrapowers run this can't happen — the completeness
critic reviews the *whole* integrated tree. The gap is **across runs**: an effort too large
for one plan gets decomposed into several plans, each its own `/ultrapowers` run with its
own seal, and **nothing reviews the integration of the phases against each other**. The fix
is structural and cheap: ultraplan guidance that the *final* plan of a multi-plan effort
must carry an **integration-spanning acceptance** (a sealed exam or suite exercising
end-to-end / cross-phase behavior), and that N green per-phase gates never substitute for
one integrated-green gate. No new marker, no engine code — per the G1 consolidation rubric.

## 1. What I verified (grounding)

- **One acceptance per plan/run.** Every marked plan declares exactly one
  `**Acceptance:**` disposition (sealed | suite | waived); there is no per-phase or
  cross-phase acceptance concept (`ultraplan/SKILL.md` §283, the compiler's single
  `acceptance` field).
- **"Phases" are not a within-plan construct.** ultraplan explicitly forbids prose phase
  ordering ("Never write 'execute phases in order'… put a `Depends-on:` line", §184) — so a
  multi-*phase* effort is necessarily multiple *plans* / runs.
- **Single-run integration IS reviewed.** The completeness critic detaches on the run's
  integration HEAD and reviews the whole tree against the plan (`waves.js:342`). So the gap
  is strictly cross-*run*, not within-run.
- **Prior phases are already on the base branch.** When phase N runs after phases 1…N-1
  merged to `main`, phase N's integration tree already *contains* the earlier phases — what's
  missing is any instruction to verify behavior that *spans* them, and any acceptance that
  exercises it.

## 2. Why guidance, not mechanism (the G1 decision)

`complexityEffect: structural`. The tempting build is a new `## Effort Context` plan block
(phase N of M, pointer to an integration spec) that the compiler parses and the gate
surfaces — additive mechanism, parallel to `## Global Constraints`. Applying the G1 rubric:

- *Can a representation change delete the cluster?* Yes — the cluster is "people decompose
  big efforts without an integration-spanning gate." Teaching the decomposition to *always*
  end in an integration acceptance removes the whole class, no machinery.
- *Would a good engineer do this without the feature in mind?* Yes — "your last phase's
  acceptance test should exercise the end-to-end behavior" is plain good practice.

So the marker fails the gate as premature. We ship guidance now; the marker stays a
documented future option **iff** real multi-run frequency proves guidance insufficient
(evidence, not anticipation).

## 3. Design (guidance)

Add a subsection to `ultraplan/SKILL.md`, near the decomposition-shaping guidance:

> **Efforts too large for one plan.** When a spec is decomposed into several plans run as
> separate `/ultrapowers` invocations, per-phase green does **not** establish integrated
> green — each run's completeness critic sees only its own plan's tree. So:
> 1. Design the decomposition so the **final** plan carries an **integration-spanning
>    acceptance** — a sealed exam or suite whose checks exercise behavior that crosses the
>    earlier phases, run against a tree that already contains them.
> 2. Never let N green per-phase gates stand in for one integrated-green gate; an
>    integration bug lives precisely *between* phases, where no single-phase exam looks.
> 3. If the effort genuinely cannot end in an integration acceptance, say so at the final
>    gate as an explicit waiver ("cross-phase integration unverified — phases sealed
>    separately"), never silently.

## 4. Complexity accounting

| | A `## Effort Context` marker | This design (guidance) |
|---|---|---|
| New plan blocks / parser code | +1 block, +compiler parse, +gate surface | **0** |
| New standing concepts | a phase-graph notion across runs | **0** |
| Coverage of the failure | mechanical, but only if authored | structural — teaches the decomposition that prevents it |

Pure guidance; `complexityEffect: structural`; net concepts **+0**. This is the loop
practicing G1 on its own proposal.

## 5. Surfaces touched

- `ultraplan/SKILL.md` — one new guidance subsection. (No `references/plan-markers.md`
  mirror needed: this is authoring guidance, not a marker contract — confirm no pin asserts
  otherwise at plan time.)

No engine code, no compiler change, no gate change, no wall-clock cost.

## 6. Open questions

- Placement: fold into the existing "Shape the decomposition" guidance vs. a standalone
  subsection. Leaning standalone (it's about multi-*plan* efforts, a level above single-plan
  shaping).
- Should the ultrapowers Step-5 gate echo a generic "if this plan is one phase of a larger
  effort, cross-phase integration is unverified here" line? Only worth it if it can be
  conditioned on a signal — and we deliberately added no signal. Leave to the guidance.

## 7. Provenance

ultralearn distill 2026-06-27, P2. Dominant false-green theme, cross-run half (P1 shipped the
runtime-bound half via the deferredVerification channel). Sibling:
`2026-06-27-global-constraints-completeness-critic-design.md`.
