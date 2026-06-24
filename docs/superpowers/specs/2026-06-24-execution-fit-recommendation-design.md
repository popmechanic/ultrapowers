# Execution-Fit Recommendation — Design

**Date:** 2026-06-24
**Status:** Approved, ready for planning

## Problem

At a marked plan's execution handoff, the menu hardcodes "Ultrapowers
(recommended for marked plans)" in two lockstep places —
`hooks/session_start.sh` (the `<ultrapowers-routing>` block injected into every
session) and `skills/ultraplan/SKILL.md` (the "Execution Handoff" section). The
recommendation is a reflex: the mere existence of a marked plan crowns
ultrapowers, regardless of whether the plan's actual shape benefits from
parallelism, worktree isolation, or held-out verification.

In practice, when the agent is asked to genuinely analyze a plan, it will
sometimes conclude that subagent-driven or inline execution is the better fit —
because simple or strictly-linear plans gain nothing from ultrapowers' machinery
and pay its overhead. The reflex recommendation is therefore often wrong, and it
is dishonest in a way that erodes trust in the menu.

## Goal

Replace the reflex with a **grounded analysis** that runs at the handoff and tags
exactly one of the three options as recommended, with a one-line rationale. The
analysis must be genuinely willing to recommend *against* ultrapowers when the
plan does not benefit from it.

## Non-goals

- **The parallel-decomposition planner is out of scope.** A separate, larger idea
  surfaced during brainstorming: superpowers' planning skills decompose work for
  sequential reading, which biases plans toward artificially narrow dependency
  graphs; a parallelism-aware decomposition pass could reveal latent independence.
  That is deferred to its own brainstorm. This recommender will, once live,
  produce the evidence (how often real plans route away from ultrapowers) that
  justifies whether the planner is worth building — and will serve as its honest
  scorecard.
- **Isolation taste and autonomy preference are not modeled.** Whether the
  operator wants worktree blast-radius control, or wants to fire-and-step-away
  versus steer each step, are operator choices the agent cannot read off a plan.
  The operator always retains the final say by simply choosing a different option
  from the menu.

## Background: the two lockstep locations

The "three options" guidance is authored in two places that must stay
consistent:

1. **`hooks/session_start.sh`** — emits `<ultrapowers-routing>` as session
   context. This is the *reliable* leg: it is injected every session regardless
   of whether the model noticed the ultraplan skill. `tests/test_session_hook.py`
   pins several of its phrases (`/ultrapowers <plan-path>`,
   `subagent-driven-development`, `executing-plans`, `authorizes execution`,
   `no approval pause`). It does **not** currently pin the string
   "(recommended for marked plans)", so that framing is free to change.
2. **`skills/ultraplan/SKILL.md`** — the "Execution Handoff (third option)"
   section, the *detailed* leg the agent reads at plan-writing time.

The change touches both, kept in lockstep by a new pin test.

## The rubric (hybrid: structural spine + risk override)

The grounding is **hybrid**: a structural spine derived from the plan's own
markers, with a qualitative risk override on top. This was chosen over a
pure-structural or pure-qualitative rubric because of one asymmetry —
*parallelism is a structural fact you can count (wave width), but
verification-need is a qualitative fact you cannot read off the graph (touching
auth code, operator-can't-read-the-diff).* Each pure approach is blind to one of
these; the hybrid covers both at near-zero extra cost.

### Signals (read off the marked plan the agent just authored)

- **T** — count of `implementation` tasks. `gate`, `release`, and `manual` tasks
  do not run in waves and are excluded.
- **Parallel width** — a yes/no: is there at least one wave with ≥2 independent
  tasks, *after* treating same-file `Modify` pairs as dependencies (matching how
  the compiler nets out file contention)? Using a binary rather than a precise
  number keeps the hand-computation robust. "Paper parallelism" that collides on
  shared files does not count as width.
- **R** — risk flag, true if any of: Acceptance is `sealed` (operator cannot read
  the diff, so a held-out exam is the only trustworthy signal); the work touches a
  high-stakes surface (auth, payments, migrations, data integrity, public API); or
  behavior is hard to verify by reading.

### Decision tree (first match wins)

1. **R is true → Ultrapowers.** The override. Independent per-task review + the
   held-out sealed exam + one pre-merge gate is the value here, not speed. The
   rationale **must name the specific risk** that fired the override.
2. **width≥2 AND T≥4 → Ultrapowers.** Real parallel speedup clears the
   worktree/merge overhead.
3. **T≤2 → Inline.** Too small to spin up machinery.
4. **else → Subagent-Driven.** Linear chains, or narrow plans where parallel
   benefit does not pay; fresh-context isolation + review between tasks still
   earns its keep.

### Why this bar (Lean efficient, T≥4)

The bar in rule 2 is the only genuine tuning knob, and it is set conservatively
("Lean efficient") on purpose. The reasoning:

- **Code quality is invariant to the bar.** Every quality-critical plan is
  carried by the risk override (rule 1), which is independent of T. So the bar
  *only* governs routing for low-risk, small, parallel plans — never
  verification.
- **On exactly those plans, ultrapowers usually loses on both clock time and
  tokens.** Its fixed overhead is a whole coordinating workflow (integration
  branch, a worktree per task, setup/merge/reconcile/completeness agents, the
  gates). On a 2–3 task plan with one narrow wave, the parallel saving is at most
  ~one task's wall-clock while the overhead is several agents' — so it often
  finishes *slower* than subagent-driven and always costs more tokens. Routing
  these into ultrapowers is a strict loss.
- **The override protects the cases that matter.** Because risk routes
  independently, setting the bar high only ever trades away marginal parallelism
  on small low-risk plans.

### Accepted limitation: count, not effort

T is a proxy for task effort. A 3-task plan of three fully-independent *heavy*
tasks would genuinely benefit from ultrapowers, yet routes to subagent-driven
(T=3 < 4) — slower than ideal, but still correctly reviewed and sequential, so no
quality loss. The asymmetry favors the conservative bar: over-routing wastes
tokens and time on the *common* small plan, while under-routing costs some clock
time on the *rarer* heavy-small plan, with quality protected either way. If this
blind spot ever needs closing, the fix is a secondary override trigger ("few but
clearly-heavy, fully-independent tasks") — not a lower global bar. Out of scope
for the first version (YAGNI).

## Handoff UX

All three options stay listed, parallel-first (ultrapowers remains line 1 for
discoverability). Two changes: a one-line **analysis** precedes the menu, and the
**(recommended)** tag attaches to the analyzed winner instead of always to
ultrapowers. Example for a linear plan that routes away from ultrapowers:

```
Execution analysis: 5 implementation tasks, linear chain (no parallel width),
low risk → Subagent-Driven fits best.

1. Ultrapowers — /ultrapowers <plan-path>: parallel waves, worktree isolation,
   per-task review, one pre-merge gate. (Selecting this authorizes execution to
   begin immediately after the wave plan renders.)
2. Subagent-Driven (recommended) — superpowers:subagent-driven-development:
   sequential, fresh subagent per task, review between tasks.
3. Inline — superpowers:executing-plans: execute tasks in this session.

Which approach?
```

The "selecting ultrapowers authorizes execution / no approval pause" contract is
unchanged — it still applies whenever ultrapowers is selected, recommended or not.
The analysis line is shown (not silent) so the operator sees the basis for the
recommendation and can disagree from an informed position.

## Where it lives

- **`skills/ultraplan/SKILL.md`** — the full rubric (signals, decision tree,
  override, and how to compute parallel width by hand from the markers) goes into
  the "Execution Handoff" section, replacing the unconditional ultrapowers
  recommendation.
- **`hooks/session_start.sh`** — rule 2 of `<ultrapowers-routing>` changes from
  "ultrapowers (recommended for marked plans)" to a **compact** form of the same
  decision tree: instruct the agent to run the fit analysis at the handoff, tag
  the best-fit option as recommended, and explicitly *not* default to
  ultrapowers. The compact form carries the decision tree in shorthand so the
  reliable leg is self-contained even if the agent never reads ultraplan.

## Tests

- **New rubric-lockstep test.** The signal names (T / parallel width / R), the
  `T≥4` threshold, the three lane names (Ultrapowers / Subagent-Driven / Inline),
  and the phrase identifying the risk override all appear in *both*
  `hooks/session_start.sh` and `skills/ultraplan/SKILL.md`, so the two legs cannot
  drift apart.
- **Extend `tests/test_session_hook.py`.** Assert the hook no longer
  unconditionally crowns ultrapowers — it must contain the analysis instruction
  (e.g. the "do not default to ultrapowers" directive) — while keeping every
  existing pin green (`authorizes execution`, `no approval pause`,
  `/ultrapowers <plan-path>`, `subagent-driven-development`, `executing-plans`).
- **Existing pins stay green:** `tests/test_ultraplan_skill.py`,
  `tests/test_no_prompt_drift.py`, and the rest of the suite.

## Summary

Replace a two-place hardcoded "ultrapowers is recommended" with a hybrid rubric
that reads three signals off the marked plan (task count, parallel width, risk),
runs a four-branch decision tree (risk → Ultrapowers; wide-and-large →
Ultrapowers; tiny → Inline; else → Subagent-Driven), and renders a one-line
analysis plus a moved (recommended) tag at the handoff. The bar is set
conservatively because the risk override already carries every quality-critical
plan, so the bar only trades marginal parallelism on small low-risk plans. The
guidance lives in ultraplan (full) and the session hook (compact), kept in
lockstep by a new pin test.
