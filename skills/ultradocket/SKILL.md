---
name: ultradocket
description: Use when the operator has a backlog rather than a single idea — triage open GitHub issues against business objectives into a ranked docket, plan accepted issues one at a time via superpowers, and compile the approved plans into a collision-aware portfolio. The execution drain is /ultradocket run (part 3c). Optional; the single-feature superpowers flow is unchanged when not summoned.
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

## Mode: plan (`/ultradocket plan`)

Pop the next `accepted` entry (highest score). Open a normal superpowers
brainstorm pre-seeded with the issue body, the triage notes, and the relevant
line(s) of `docs/objectives.md` — a well-defined issue is half a spec, so the
interview is short. Hand off to the standard brainstorm → writing-plans →
ultraplan → sealing pipeline. On completion, record the plan path and seal
into the entry (`State: queued`; `planned` is the intermediate where the plan
is approved but the seal is not yet issued). Throughput is capped by operator
attention here, by design — everything downstream of the operator's signature
runs at machine speed.

## Mode: run (`/ultradocket run`)

Compile and drain the queue. **Not yet implemented** — this is part 3c
(`docket-run`), the write-side harness born via the ratchet that part 2's
harness library establishes. Until it lands, compile a preview with the
`compile_docket.py` tool that lives next to `docket_lib.py` in this skill's
own scripts directory and is delivered by part 2 (docket-compile). From inside
that directory, run it against the docket to see the collision-aware order,
budget, and could-have-parallelized projection for the queued plans:

    cd skills/ultradocket/scripts
    python3 compile_docket.py ../../../docs/superpowers/docket.md
