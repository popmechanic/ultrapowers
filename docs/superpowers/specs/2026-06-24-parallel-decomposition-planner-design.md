# Parallel-Decomposition Planner — Design

**Date:** 2026-06-24
**Status:** Implemented (PR #57). **Amended 2026-06-24 (post-merge):** the eval
deliverable described below — the micro-loop scorers, `evals/planning-fixtures/`,
and their tests — was **removed** so the distributed plugin requires no Anthropic
API key (those scripts called the API directly via the SDK; see PR
`chore/remove-api-eval-tooling`). The shipped planner (the ultraplan shaping phase +
justification gate + recorded rationale) is unchanged; its honesty now rests on the
in-repo mechanisms — the self-review gate, the min-work-size rule, and the
**recommender as scorecard** — not on a committed eval. The eval sections below are
retained as design history.

## Problem

Parallelizability is decided at *decomposition* time — when task boundaries and
dependencies are drawn — but `ultrapowers:ultraplan` only operates at
*annotation* time. Today ultraplan layers `Type`/`Depends-on`/`Interfaces`
markers onto whatever decomposition `superpowers:writing-plans` already produced;
it is a faithful stenographer of the plan's shape, never a reshaper.

And writing-plans has a structural bias toward *narrow*. It was built for
executors that read top-to-bottom, so a plan reads best as a linear narrative
("first the schema, then the model, then the endpoint, then the UI"). That
narrative instinct manufactures dependency edges that are not real data
dependencies — they are *reading-order* dependencies. ultraplan then encodes the
authoring habit as if it were a constraint. The latent independence in the work
is real but never surfaced, so the compiler waves it narrowly and the
recommender (see below) routes it away from parallel execution.

The fix is to make ultraplan *shape* the decomposition, not just describe it —
to reveal the independence the sequential-authoring pen glides over. ultraplan is
literally titled "Author Parallel-Ready Plans"; this change makes it finally
deliver on that name.

## Relationship to the execution-fit recommender

This is the deferred follow-on to the execution-fit recommender (spec
`2026-06-24-execution-fit-recommendation-design.md`, shipped on PR #56). The
recommender reads task count, parallel width, and risk off a marked plan and
recommends the best-fit executor. It is this feature's **honesty scorecard**: if
a "reshaped" plan still analyzes to Subagent-Driven, the shaping found no real
parallelism — in the open, at the handoff. Build order was deliberate: the
recommender ships first so it can measure the planner's output.

## Goal

ultraplan reveals genuine latent parallelism in plans it helps author, without
manufacturing artificial breadth, defended by the justification gate, the
min-work-size rule, and the recommender scorecard. (The originally-planned committed
eval was removed post-merge — see the amendment note above.)

## Non-goals

- **Forking writing-plans.** This stays a layer on top. writing-plans keeps
  ownership of plan structure, TDD steps, granularity, and File Structure;
  ultraplan adds the independence-shaping discipline that *feeds* those.
- **Engine / compiler changes.** Prompt-only. Contract-first is already
  expressible in ultraplan's existing marker machinery (a wave-0 contract task
  `Produces:` the interface; consumers `Consume:` + `Depends-on:` it), so no
  new compiler surface is required.
- **The compile-measure-revise loop** (author a plan, run the compiler to measure
  width, feed revisions back). The recommender already measures the result at the
  handoff; this heavier loop is deferred unless the lighter approach proves soft.
- **An LLM "manufacturing judge."** The eval's structural ground-truth metric
  (below) proves the honesty claim cheaply; a judge that rates each reshaping
  move's rationale is a deferred secondary check.

## Scope: reshape for parallelism, gated

The planner may reshape the work's *architecture* to unlock parallelism, not only
re-cut task boundaries over a fixed architecture. Two architectural moves are in
scope:

- **Contract-first** — where a consumer would otherwise wait on a producer, fix
  the shared interface up front as its own small early task; consumers build
  against the contract concurrently. The single highest-leverage move.
- **Seam-splitting** — where two genuinely-independent pieces of work collide on
  one file (forcing the compiler to serialize them), split the file along its
  real responsibility seam.

**The justification gate.** Every architectural move must (1) name a concrete
independence win it produces, and (2) pass *"would a good engineer make this move
even without parallelism in mind?"* A move that only pays under parallelism — an
interface introduced solely to fan out, a file split solely to dodge a collision
— fails the gate and is dropped. This gate is what keeps reshape-scope from
collapsing into manufactured complexity.

## The new ultraplan phase: "Shape the decomposition (before drawing tasks)"

A phase that runs at the start of planning and feeds writing-plans' File-Structure
step. Five moves:

1. **Map independent units.** From the spec, separate work that truly depends on
   another unit's *output* from work that merely *reads* as a sequence.
2. **Front-load contracts (contract-first).** Where a consumer would wait on a
   producer, fix the shared interface up front as its own early task that
   `Produces:` the signatures; consumers `Consume:` + `Depends-on:` it. Subject to
   the justification gate.
3. **Cut along file seams.** Draw boundaries so same-wave tasks do not `Modify`
   the same file. Where genuinely-independent work collides on one file, consider
   splitting the file along its responsibility seam. Subject to the gate.
4. **Interrogate every dependency (anti-linearization).** For each `Depends-on`
   about to be written: true data/interface dependency, or just the order it was
   thought of? Drop the authoring-order edges.
5. **Right-size against overhead.** Never split below a meaningful work-size to
   inflate width. Worktree overhead — and the recommender — reward only genuine
   independent mass. (This is the structural defense against the count-not-effort
   blind spot the recommender accepts.)

The phase is authored as a **positive recipe, not a prohibition** — the eval
harness measured that prohibitions on output shape can score *below* saying
nothing at all (`evals/README.md`, micro-test loop).

## The justification gate, enforced (a + c)

- **(c) Self-review item.** A new ultraplan self-review step lists every
  architectural move (contract task, seam-split) with its named independence win
  and drops any that fail the good-engineer test.
- **(a) Recorded rationale.** Each surviving move carries a one-line
  `**Parallelization rationale:** <named independence win>` in its task body. The
  operator audits it when reviewing the plan — the external witness the planner
  cannot touch. (Surfacing it in the compiled wave-plan render is a possible
  future enhancement requiring compiler work; v1 records it in the plan body.)

## Honesty: defense-in-depth

Three independent checks, none trusting the planner's self-assessment alone:

1. **Self-review gate (c)** drops manufactured architectural moves.
2. **Min-work-size rule (move 5)** blocks width-inflation by over-splitting.
3. **The recommender** measures real width at the handoff; a reshaped plan that
   still routes to Subagent-Driven advertises that the shaping found nothing.

The operator's plan review sits on top as the external audit of the recorded
rationales.

## Trigger and escape valve

Runs on every implementation plan (unchanged from ultraplan today), but with an
explicit *"it is correct to conclude there is no latent parallelism here and move
on"* escape. Small or inherently-linear specs are not forced into reshaping; the
gate already blocks over-shaping, and the escape valve prevents wasted effort and
manufactured complexity on plans that genuinely do not fan out.

## The eval (first-class deliverable)

A *planning* eval — it measures the plans ultraplan produces, not their execution
— so it rides the cheap micro-test loop (`evals/scripts/run-micro.py`: one API
call per sample, programmatic scoring, an auto-injected no-guidance control,
offline-unit-tested), not the heavy execution matrix.

**Two metrics, both grounded:**

- **Efficacy — width gain.** Author each spec into a marked task graph under each
  variant; compute max wave width from the produced `Type`/`Depends-on` markers.
  `ultraplan-shaped` should beat `ultraplan-current` on specs with latent
  parallelism.
- **Honesty — over-shoot vs ground truth.** Each spec-fixture declares its **true
  honest width** (the real minimum dependency structure). Genuine revelation is
  `control < shaped ≤ ground-truth`. `shaped > ground-truth` is manufacturing,
  caught **structurally** — no LLM judge required.

**How it rides the harness:**

- **Variants** (`variants.json`): `ultraplan-current` (annotate-only) vs
  `ultraplan-shaped` (the new phase). The loop's auto-injected
  `control-no-guidance` stays as the floor.
- **Samples** (`samples.json`): a small set of spec-fixtures spanning the regimes
  the execution fixtures already model — **latent-parallel** (cf. `wide`/`mixed`;
  shaped should widen), **contract-breakable** (looks serial, a contract-first
  move opens it; shaped should widen via a wave-0 contract task), and
  **inherently-linear traps** (cf. `chained`; shaped must *not* widen — the
  honesty trap). Each sample carries its spec text and declared ground-truth
  width.
- **New scorer** `wave_width` registered in `run-micro.py`'s `SCORERS`: parses the
  produced markers into a DAG, returns width and the over-shoot vs the sample's
  ground truth. Programmatic, unit-tested offline like the existing scorers.

**Success criterion.** Across reps: `shaped` width median **>** `current` on
latent/contract samples, **AND** `shaped` width **never exceeds ground-truth** on
any sample, **AND** `shaped` does **not** widen the linear traps. Efficacy and
honesty in one pass — neither provable alone.

## What changes

- **`skills/ultraplan/SKILL.md`** — add the decomposition-shaping phase, the
  self-review item, and the `**Parallelization rationale:**` convention.
- **`evals/scripts/run-micro.py`** — register the `wave_width` scorer.
- **`evals/planning-fixtures/`** — the spec-fixtures with declared ground-truth
  widths, plus the `variants.json` for current-vs-shaped.
- **`tests/test_ultraplan_skill.py`** — pin the new section's key elements (phase
  present, gate present, rationale convention present).
- **`tests/test_run_micro.py`** — extend to cover the `wave_width` scorer offline
  (no model call).

## Acceptance disposition

`suite` — building ultrapowers itself (its own planning skill + eval harness);
author and operator read every diff, and the committed pins + the eval's
structural metric are the verification. No held-out exam applies.

## Summary

Grow ultraplan from an annotator into a decomposition shaper: a five-move phase
that reveals latent independence and may reshape architecture (contract-first,
seam-splitting) under a justification gate, with surviving moves recording an
auditable rationale. Honesty is defended in depth (self-review gate, min-size
rule, recommender scorecard, operator audit). (A micro-loop eval was originally
shipped to *prove* this structurally, then removed post-merge to keep the plugin
API-key-free — see the amendment note.) All prompt work, one plan's worth, `suite`
acceptance.
