---
name: ultradocket
description: Use when the operator has a backlog rather than a single idea — triage open issues into a ranked docket, sweep the accepted queue into engine-tagged plans, and drain that queue through an autonomous build. Optional; the single-feature superpowers flow is unchanged when not summoned.
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
harness. Fan out over `gh issue list` and the repository. **Skip every issue
carrying a `wayfinder:*` label** — those are wayfinder decision tickets
(questions resolved by a decision, worked through their map), not build
issues; sweeping one into an implementation plan builds an answer to an
unresolved question. For each remaining open, well-defined issue, score
well-definedness, alignment to `docs/objectives.md`,
estimated blast radius (likely files), and risk; cluster duplicates and
shared root causes. Write the ranked slate to `docs/superpowers/docket.md`
using the entry format below, every entry `State: triaged`. Then present the
**docket gate**: the operator strikes, reorders, and sets a budget ceiling;
accepted entries become `State: accepted`.

Record each entry's triage rationale in the durable `**Notes:**` field (it
survives every lifecycle transition, unlike free text packed into the `Score`
line). Triage does **not** assign an acceptance disposition —
that is decided at planning (sweep step 3). Do not guess `suite`/`waived` at
triage; conflating the acceptance mode with "self-contained" is a known triage trap.

Entry format (parsed by `scripts/docket_lib.py` — the single source of truth):

```
### #214: Stripe webhooks dropped on retry
**State:** accepted
**Score:** 8.5 — revenue-reliability objective
**Est-files:** services/billing/*, lib/webhooks.py
**Notes:** triage rationale — durable, survives transitions (e.g. "already fixed in main, verify & close")
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
   + `ultrapowers:ultraplan` → operator approval.
   **Per-plan approval is the default contract**: the sweep pauses at each
   plan for the operator's signature before advancing — plan approval is the
   operator's control point, and they should never have to interrupt mid-sweep
   to reclaim it ([92e1c33dd33a3f12]). Batching approvals across entries is an
   explicit operator opt-in only. When the operator asks the sweep to "review
   it for me", summarize the plan against the issue's stated scope and any
   standing scope cuts, flag every deviation, and still take an explicit
   per-plan yes.
   Plans the sweep writes must carry the exact compiling Acceptance form —
   `**Acceptance:** suite — <one-line rationale>` (or the waived
   equivalent) — verified by the pipeline's existing `compile_plan.py --check`
   step; a bare `suite.` parses as `missing` and reds the drain.
4. **Choose the engine.** Apply the **shared execution-fit rubric** — the same
   one the routing hook and ultraplan use (pinned by
   `tests/test_recommendation_rubric.py`) — to the finished marked plan, and
   record the chosen engine. Do **not** restate the rubric's branch clauses
   here; reference it. The value is one of `ultrapowers | subagent-driven |
   inline`.
5. **Write back** in one atomic entry update — plan path and engine —
   advancing the entry `accepted → planned → queued` via
   `docket_lib.transition` (`planned` is the approved intermediate; the entry
   advances straight to `queued`). Never hand-edit the docket prose.
6. **Auto-advance** to the next `accepted` entry.

The sweep loops until no `accepted` entry remains or the operator stops. Docket
state is durable, so a sweep may span sittings freely: stopping is simply not
continuing; resuming re-reads the remaining `accepted` entries. No new
persistence mechanism is introduced.

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
   - `ultrapowers` → commit the plan on the docket line and `drive-one` it on the
     orchestrator (`fleet/RUNBOOK.md` §Live W1 run; the sandbox session runs the
     `/ultrapowers` §Engine, gate included); the orchestrator's PR/receipt is the
     gate. For such an entry step 3 reads that gate receipt instead of
     administering a second gate, and step 4 merges or parks on its verdict.
   - `subagent-driven` → invoke `superpowers:subagent-driven-development` against
     the per-plan branch.
   - `inline` → invoke `superpowers:executing-plans` against the per-plan branch.
3. **Administer the correctness gate** against the plan's branch, dispatched on
   the plan's disposition (its `**Acceptance:**` line, read as `acceptance.mode`
   from `compile_plan`). Each runner makes its own detached worktree (agnostic to
   the current checkout) and is exit-code authority:
   - `suite` → `run_acceptance.sh --suite-gate --branch <branch> --base <docket-integration-line-HEAD>`
     — the committed suite (`python3 -m pytest`) run on the branch; exit 0 ⇒ pass.
     Passing `--base` (the ref the plan branched from) arms the JS-behavioral
     guard: when the branch changed `skills/ultrapowers/harnesses/*.js`, the gate
     also runs the harness `.mjs` sims (exit-code + pass-sentinel authority), so a
     engine-behavioral plan cannot ride a Python-only green (issue #79). This
     is the disposition for ultrapowers' own engine/skill/doc work, which authors
     no held-out exam.
   - `waived` → no gate exists; **park for the operator** at the end gate. Never
     auto-merge unverified work.
4. **Merge or park** — the deterministic step:
   - **Green gate** → merge the plan branch into the docket integration line;
     advance the entry `queued → executed` via `docket_lib.transition`; the next
     plan branches off the new HEAD.
   - **Red gate or executor failure** → **park**: keep the branch, transition the
     entry to `parked` with a reason (the gate's `redKind` or the failure), and
     skip the plan's collision-dependents (from `compile_docket`'s collision
     graph). Disjoint plans continue.
   - **Missing/uncompilable Plan** → `compile_docket`/`plan_writes` raises a
     friendly error naming the plan; park that entry with the reason before
     spending execution cost. Never surface a raw stack trace.
5. **Auto-advance** to the next `queued` entry. Stop on an empty queue or an
   operator-set budget ceiling (a stop condition between plans where cost is
   observable; v1 builds no new cost accounting).

**Review posture: suite-gate authority, review by exception.** The drain
dispatches no per-task reviewer of its own, and its step-2 dispatch
instructs the sequential executor to skip its review passes — per-task
and final — the step-3 gate is the verification. One exception: each task
its plan marks `**Review:** adversarial` (from `launch_waves[].review`
of step 3's own `compile_plan` run — no extra compile) gets one fresh
review via `superpowers:requesting-code-review` against the diff from
docket-line HEAD plus the plan text, before the plan's gate;
Critical/Important findings park the entry exactly as a red gate does
(Minor: noted at the end gate). Posture drift after this declaration is
the recurrence that buys enforcement.

### The gate-driven auto-approve

The drain runs unattended over non-deterministic executors, so the keep-going
decision is split from the correctness decision, and the merge keys stay on the
deterministic side:

- **Auto-advance, don't block.** When a sequential executor reaches a checkpoint
  that would normally ask the operator to review, advance it yourself — log the
  call for the end gate — so the run never blocks. This is catastrophe-only
  autonomy: only a dependency cycle or an inability to create the integration
  branch stops the drain early.
- **Trust the gate, not "looks done."** A "finished" signal from a
  non-deterministic executor is never enough to merge. Correctness is decided by
  the plan's suite gate (`run_acceptance.sh --suite-gate`, exit-code authority)
  — or, for a fleet-driven entry, the orchestrator's gate receipt: exit 0 ⇒
  merge; any non-zero ⇒ park. An over-eager auto-advance therefore cannot land
  broken work on the integration line — the gate it can't touch gates the
  merge.

The drain widens the set of trusted write-side executors to include the
committed superpowers executors (`subagent-driven-development`,
`executing-plans`) alongside the `waves` registry harness. Those are fixed,
audited skills — not orchestration improvised at runtime — and the safety
guarantee holds regardless of which one wrote a branch: nothing reaches the
docket integration line, or `main`, without clearing the deterministic suite
gate and the single end gate.

### The single end gate

When the queue drains or the budget ceiling hits, present **one** pre-merge
portfolio gate. Per entry: exam evidence (raw runner JSON), engine, cost,
disposition (`executed`/merged or `parked` + reason), branch, the review
posture used (suite-gate authority, or the escalated tasks named); plus
portfolio totals and the could-have-parallelized projection. Then the operator
disposes of the portfolio: merge the docket integration line to base, or open
per-issue PRs (mind the GitHub closing-keyword gotcha in PR bodies). Accepting
the portfolio advances merged entries `executed → verified`. Parked entries are
presented with their gate evidence; a re-drive is a new run with a narrower
plan — there is no in-place salvage or redirect.

The drain is **origin-agnostic**: the entry `issue` field is an opaque label,
and any `gh issue close` / comment-back is an **optional** operator post-step you
offer at the gate — never part of the drain core, which makes no GitHub calls.
