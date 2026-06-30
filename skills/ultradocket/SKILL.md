---
name: ultradocket
description: Use when the operator has a backlog rather than a single idea — triage open issues into a ranked docket, sweep the accepted queue into sealed engine-tagged plans, and drain that queue through an autonomous build. Optional; the single-feature superpowers flow is unchanged when not summoned.
---

# Ultradocket

The docket is the portfolio layer above single-plan execution. It never
authors plans — superpowers does, interactively, with the operator. The
docket decides *which* issues are worth planning, holds their state between
sessions, and reasons about the approved plans *as a set*.

## First run: objectives

If `docs/objectives.md` does not exist, interview the operator (ten minutes,
brainstorm-style) and write it: what the business is optimizing for this
quarter, in plain English. Triage scores against whatever it currently says.
It is a versioned doc the operator edits freely.

## Mode: triage (bare `/ultradocket`)

A READ-ONLY discovery pass — it mutates nothing, so it is an improvised
dynamic workflow per the harness read/write boundary, never a committed
harness. Fan out over `gh issue list` and the repository: for each open,
well-defined issue, score well-definedness, alignment to `docs/objectives.md`,
estimated blast radius (likely files), and risk; cluster duplicates and
shared root causes. Write the ranked slate to `docs/superpowers/docket.md`
using the entry format below, every entry `State: triaged`. Then present the
**docket gate**: the operator strikes, reorders, and sets a budget ceiling;
accepted entries become `State: accepted`.

Entry format (parsed by `scripts/docket_lib.py` — the single source of truth):

```
### #214: Stripe webhooks dropped on retry
**State:** accepted
**Score:** 8.5 — revenue-reliability objective
**Est-files:** services/billing/*, lib/webhooks.py
**Plan:** docs/superpowers/plans/2026-06-14-stripe-webhook-retry.md
**Seal:** a1b2c3d4e5f6
```

Lifecycle: `triaged → accepted → planned → queued → executed → verified`; any
non-terminal state → `parked`. Transitions go through `docket_lib.transition`,
never hand-edited prose.

## Mode: plan (`/ultradocket plan`) — the continuous sweep

Bare `/ultradocket plan` is a **continuous sweep**: it drains the entire
`accepted` queue through back-to-back, pre-seeded brainstorms, in docket-rank
order, until the queue is empty or the operator stops. There is no single-issue
form — the sweep is the only planning entry point. Throughput is capped by
operator attention here, by design; everything downstream of the operator's
signature runs at machine speed in the drain (`run` mode).

One iteration:

1. **Pop** the highest-rank `accepted` entry.
2. **Pre-seed** a standard `superpowers:brainstorming` session with the issue
   body, the triage notes, and the matched line(s) of `docs/objectives.md`. A
   well-defined issue is half a spec, so the interview is short.
3. **Plan** through the normal pipeline: brainstorm → `superpowers:writing-plans`
   + `ultrapowers:ultraplan` → operator approval → the ultraplan sealing step.
4. **Choose the engine.** Apply the **shared execution-fit rubric** — the same
   one the routing hook and ultraplan use (pinned by
   `tests/test_recommendation_rubric.py`) — to the finished marked plan, and
   record the chosen engine. Do **not** restate the rubric's branch clauses
   here; reference it. The value is one of `ultrapowers | subagent-driven |
   inline`.
5. **Write back** in one atomic entry update — plan path, seal-id, and engine —
   advancing the entry `accepted → planned → queued` via `docket_lib.transition`
   (`planned` is the intermediate: approved, seal not yet issued). Never
   hand-edit the docket prose.
6. **Auto-advance** to the next `accepted` entry.

The sweep loops until no `accepted` entry remains or the operator stops. Docket
state is durable, so a sweep may span sittings freely: stopping is simply not
continuing; resuming re-reads the remaining `accepted` entries. No new
persistence mechanism is introduced.

**If sealing fails**, the entry stays `planned` (approved, unsealed) and the
sweep continues; it surfaces for a retry on a later sweep. It is never `queued`,
so the drain never picks up an unsealed plan.

**In-sweep controls**, offered at each iteration boundary:

- **continue** — the default; plan the next entry.
- **skip-park** — park this entry with a reason (covers both "I don't want to
  build this" and "this issue is underspecified / needs decomposition") via
  `docket_lib.transition` (→ `parked`), then continue.
- **stop** — end the sweep here; the remaining `accepted` entries are untouched
  and picked up on the next `/ultradocket plan`.

## Mode: run (`/ultradocket run`)

Compile and drain the queue. **Not yet implemented** — this is part 3c
(`docket-run`), the deferred write-side harness that drains the queue. Until
it lands, compile a preview with the
`compile_docket.py` tool that lives next to `docket_lib.py` in this skill's
own scripts directory and is delivered by part 2 (docket-compile). From inside
that directory, run it against the docket to see the collision-aware order,
budget, and could-have-parallelized projection for the queued plans:

    cd skills/ultradocket/scripts
    python3 compile_docket.py ../../../docs/superpowers/docket.md
