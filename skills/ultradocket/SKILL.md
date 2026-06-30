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

## Mode: run (`/ultradocket run`) — the autonomous build drain

`/ultradocket run` executes the `queued` plans. It is the machine-speed back
half of the docket: the operator kicks it off and walks away, and every plan's
outcome lands at a single end gate. **`main` is never touched unattended.**

The drain is **this agent loop** — not a headless workflow — because two of the
three engines are superpowers *skills* that run in the loop. It owns a docket
integration branch `ultra/docket-<stamp>` and walks the `queued` entries in
docket-rank order (the order `compile_docket` emits). For each entry, run one
**executor-agnostic wrapper**:

1. **Branch** off the current docket integration line HEAD.
2. **Dispatch by the entry's recorded `Engine`**, auto-advancing any
   human-in-the-loop checkpoint (see "The exam-gated auto-approve" below):
   - `ultrapowers` → run the plan through the committed waves engine: compile it
     (`compile_plan.py --emit-launch`), then launch the saved workflow **by its
     `meta.name` `ultrapowers-run`** (not `waves` — that is the harness file, and
     launching by it fails "not found") via the Workflow tool, following
     `/ultrapowers` Steps 2–4 for the engine probe, run lock, and args assembly.
     Do **not** invoke `/ultrapowers`' own Step-5 gate — the drain administers the
     sealed exam (step 3) and the docket-line merge (step 4) below instead. Waves
     self-isolates with per-task worktrees and tiers per task.
   - `subagent-driven` → invoke `superpowers:subagent-driven-development` against
     the per-plan branch.
   - `inline` → invoke `superpowers:executing-plans` against the per-plan branch.
3. **Administer the sealed exam** against the plan's branch with
   `run_acceptance.sh <sealId> <branch> <sha256>` (exit-code authority; it makes
   its own detached worktree, so it is agnostic to the current checkout).
4. **Merge or park** — the deterministic step:
   - **Green exam** → merge the plan branch into the docket integration line;
     advance the entry `queued → executed` via `docket_lib.transition`; the next
     plan branches off the new HEAD.
   - **Red exam or executor failure** → **park**: keep the branch, transition the
     entry to `parked` with a reason (the exam's `redKind` or the failure), and
     skip the plan's collision-dependents (from `compile_docket`'s collision
     graph). Disjoint plans continue.
   - **Missing/uncompilable Plan** → `compile_docket`/`plan_writes` raises a
     friendly error naming the plan; park that entry with the reason before
     spending execution cost. Never surface a raw stack trace.
5. **Auto-advance** to the next `queued` entry. Stop on an empty queue or an
   operator-set budget ceiling (a stop condition between plans where cost is
   observable; v1 builds no new cost accounting).

### The exam-gated auto-approve

The drain runs unattended over non-deterministic executors, so the keep-going
decision is split from the correctness decision, and the merge keys stay on the
deterministic side:

- **Auto-advance, don't block.** When a sequential executor reaches a checkpoint
  that would normally ask the operator to review, advance it yourself — log the
  call for the end gate — so the run never blocks. This is catastrophe-only
  autonomy: only a dependency cycle or an inability to create the integration
  branch stops the drain early.
- **Trust the exam, not "looks done."** A "finished" signal from a
  non-deterministic executor is never enough to merge. Correctness is decided by
  the plan's held-out sealed exam (`run_acceptance.sh`, exit-code authority):
  exit 0 ⇒ merge; any non-zero ⇒ park. An over-eager auto-advance therefore
  cannot land broken work on the integration line — the exam it can't touch
  gates the merge.

The drain widens the set of trusted write-side executors to include the
committed superpowers executors (`subagent-driven-development`,
`executing-plans`) alongside the `waves` registry harness. Those are fixed,
audited skills — not orchestration improvised at runtime — and the safety
guarantee holds regardless of which one wrote a branch: nothing reaches the
docket integration line, or `main`, without clearing the deterministic sealed
exam and the single end gate.

### The single end gate

When the queue drains or the budget ceiling hits, present **one** pre-merge
portfolio gate. Per entry: exam evidence (raw runner JSON), engine, cost,
disposition (`executed`/merged or `parked` + reason), and branch; plus portfolio
totals and the could-have-parallelized projection. Then the operator disposes of
the portfolio: merge the docket integration line to base, or open per-issue PRs
(mind the GitHub closing-keyword gotcha in PR bodies). Accepting the portfolio
advances merged entries `executed → verified`. Parked branches are presented for
the operator to Salvage/Redirect with full context.

The drain is **origin-agnostic**: the entry `issue` field is an opaque label,
and any `gh issue close` / comment-back is an **optional** operator post-step you
offer at the gate — never part of the drain core, which makes no GitHub calls.
