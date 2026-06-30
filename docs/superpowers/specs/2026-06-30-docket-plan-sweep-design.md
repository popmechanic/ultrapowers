# Docket continuous planning sweep + autonomous build drain

**Date:** 2026-06-30
**Status:** the full docket plan→build arc in one spec. Refines the docket
pipeline (parts 3a+3b, shipped #35) and **supersedes and redefines** the
deferred part 3c (`docket-run`, #34). Two halves: the **planning sweep** (the
operator-attention front half) and the **autonomous build drain** (the
machine-speed back half). Both are specified here; they ship as one plan.

## Problem

Today `/ultradocket plan` pops a **single** `accepted` entry per invocation,
and `/ultradocket run` is an unbuilt forward-reference. So the docket cannot
yet express its intended shape, which is the inverse of the manual,
one-issue-at-a-time cadence:

> The operator spends **all** of their planning attention up front, as one
> continuous sweep, and hands off a fully planned, sealed, **engine-tagged**
> queue that an autonomous drain executes at machine speed. *Plan up front;
> send to the build engine.*

Two things are missing. (1) Planning is single-pop, so the up-front phase feels
like N disconnected sessions instead of one pass. (2) There is no executor for
the resulting queue. The original 2026-06-12 docket design sketched that
executor (`docket-run`, components 5–7), but it predated a key decision: each
planned entry now records **which execution engine** the rubric chose for it.
A drain that always launched the parallel-waves engine would throw that
judgment away and pay full orchestration overhead on a one-line doc tweak. This
spec makes the sweep the default planning entry point **and** builds an
engine-aware drain that runs each plan at the weight its plan earned.

## Decisions

### The planning sweep (front half)

- **The sweep is the default and only planning entry point.** Bare
  `/ultradocket plan` drains the entire `accepted` queue through back-to-back,
  pre-seeded brainstorms, in docket-rank order, until the queue is empty or the
  operator stops. There is **no single-issue form** (`plan #<id>` is removed):
  its only value over a plain `superpowers:brainstorming` session was docket
  integration, and its narrow niche — planning one accepted entry out of order
  — is covered by reorder-then-sweep. One concept, one entry point.
- **The sweep is the operator-attention phase — interactive by nature.** Each
  plan needs the operator's brainstorm and signature. The autonomy lives
  entirely in the drain (back half). The sweep's terminal state is a queue that
  is fully planned, sealed, and engine-tagged — nothing in the sweep executes.
- **The execution engine is decided during the sweep and recorded on the
  entry.** As part of sealing each plan, the agent applies the shared
  execution-fit rubric to the finished marked plan and writes the chosen engine
  into the docket entry. The drain **consumes** that recorded choice to route
  the plan; it does not recompute it. The decision is auditable in the docket
  and is made when the plan is freshest.
- **Minimal in-sweep controls:** continue (default), skip-park (with reason),
  stop (resume later). Reordering is a docket-file edit between sittings, not an
  in-flight verb — ordering is owned by docket rank, set at the triage gate.

### The autonomous build drain (back half)

- **The drain is the `/ultradocket run` main loop, dispatching per recorded
  engine.** It is *not* a single headless workflow: two of the three engines
  (`subagent-driven`, `inline`) are superpowers *skills* that run in the agent
  loop, so the orchestrator must be the loop itself. It launches the parallel
  `waves` engine as a headless child workflow, or invokes the sequential
  superpowers executors, by the entry's `Engine`. This routes tiering-sensitive
  work (wide/risky plans → `waves`, which tiers per task) to the tiering-capable
  engine, and lets layups (narrow/trivial plans) skip the worktree-and-review
  tax they don't need.
- **Auto-approval is exam-gated, not judgment-gated.** When a sequential
  executor reaches a human-in-the-loop checkpoint, the orchestrator
  auto-advances it (catastrophe-only, logged) so the run never blocks — but a
  "looks done" from a non-deterministic executor is never trusted on its own.
  Correctness is decided by the plan's **held-out sealed exam**, administered
  deterministically (`run_acceptance.sh`, exit-code authority — the #36 rule),
  and only a green exam merges the plan to the docket integration line. The
  non-determinism is fenced off from the merge keys.
- **One pre-merge portfolio gate; `main` is never touched unattended.** The
  drain runs the whole queue without pausing for a human; every plan's outcome
  — merged or parked — lands at a single end gate where the operator disposes
  of the portfolio. An operator-set budget ceiling (reusing `compile_docket`'s
  existing `--budget-usd` input) is a stop condition between plans where cost is
  observable; v1 does not build new per-token cost accounting.
- **Red → park (v1).** A red exam parks the plan (branch kept), skips its
  collision-dependents, and continues disjoint plans; reds surface at the end
  gate, where the operator drives the existing Salvage/Redirect options.
  **Autonomous mid-drain salvage** and **cross-plan concurrent execution** are
  deliberately deferred to v2 as *measured seams* (see Non-goals) — consistent
  with how `compile_docket` already measures could-have-parallelized today but
  acts on it later.
- **The drain is origin-agnostic (the anti-coupling guard).** It consumes a
  docket and is blind to where it came from. The entry `issue` field is an
  opaque id/label; "comment back / `gh issue close`" stays an **optional**
  post-step, never core. The drain core makes no GitHub calls.

## Operator journey

1. `/ultradocket` triages the backlog → ranked `docs/superpowers/docket.md`;
   the operator accepts a subset at the docket gate (unchanged, parts 3a+3b).
2. `/ultradocket plan` → **the sweep**. For each `accepted` entry in rank order:
   a pre-seeded brainstorm → plan → operator approval → seal → the entry is
   written back as `queued` with its plan path, seal, and engine. The sweep
   auto-advances. The operator continues, skip-parks, or stops at any boundary.
3. `/ultradocket run` → **the drain**. The operator kicks it off and walks away.
   It executes each `queued` plan through its recorded engine, gates each on its
   sealed exam, stacks green plans onto a docket integration line, parks reds,
   and stops at the budget ceiling or an empty queue.
4. **One end gate.** Per plan: exam evidence, engine, cost, disposition, branch.
   The operator merges the docket line to base or opens per-issue PRs.

## Components

### Part I — The planning sweep

#### 1. Plan mode — the continuous sweep

`skills/ultradocket/SKILL.md`, `plan` mode, rewritten from single-pop to a loop.
One iteration:

1. **Pop** the highest-rank `accepted` entry.
2. **Pre-seed** a standard `superpowers:brainstorming` session with the issue
   body, the triage notes, and the matched line(s) of `docs/objectives.md`. A
   well-defined issue is half a spec, so the interview is short.
3. **Plan** through the normal pipeline: brainstorm → `superpowers:writing-plans`
   + `ultrapowers:ultraplan` → operator approval → sealing step.
4. **Write back** — in one atomic entry update: plan path, seal-id, and the
   **engine** (component 3), advancing the entry `accepted → planned → queued`
   (`planned` is the existing intermediate: approved, seal not yet issued). The
   transition goes through `docket_lib.transition`, never hand-edited prose.
5. **Auto-advance** to the next `accepted` entry.

The sweep loops until no `accepted` entry remains or the operator stops. Because
docket state is durable, a sweep may span sittings freely — stopping is simply
not continuing; resuming re-reads the remaining `accepted` entries. No new
persistence mechanism is introduced.

**In-sweep controls**, offered at each iteration boundary:

- **continue** — the default; plan the next entry.
- **skip-park** — park this entry with a reason (covers both "I don't want to
  build this" and "this issue is underspecified / needs decomposition") and
  continue. Parking goes through `docket_lib.transition` (→ `parked`).
- **stop** — end the sweep here; the remaining `accepted` entries are untouched
  and picked up on the next `/ultradocket plan`.

#### 2. The `Engine` field on docket entries

`skills/ultradocket/scripts/docket_lib.py` — the single source of truth for the
docket format — gains one field on `Entry`:

```
### #214: Stripe webhooks dropped on retry
**State:** queued
**Score:** 8.5 — revenue-reliability objective
**Est-files:** services/billing/*, lib/webhooks.py
**Plan:** docs/superpowers/plans/2026-06-14-stripe-webhook-retry.md
**Seal:** a1b2c3d4e5f6
**Engine:** ultrapowers
```

`Engine` is one of `ultrapowers | subagent-driven | inline`. The parser keeps
its existing fail-loud contract: an unknown `Engine` value raises `DocketError`
(catching a hand-edit typo before the drain chokes on it). The field is parsed,
serialized, and carried on the `Entry` dataclass; it is optional on the
dataclass and only populated once an entry reaches `queued`.

#### 3. Engine selection

The choice reuses the **existing execution-fit rubric** shared by
`hooks/session_start.sh` and `ultraplan` (pinned by
`tests/test_recommendation_rubric.py`) — it is referenced, never duplicated
(anti-drift). The agent applies it to the finished marked plan, reading the same
three signals the rubric already names — T (implementation-task count), parallel
width (a wave with ≥2 independent tasks), and risk (sealed acceptance, a
high-stakes surface, or hard-to-verify behavior) — and records the result, first
match wins: risk → `ultrapowers`; parallel width and T≥4 → `ultrapowers`; T≤2 →
`inline`; else `subagent-driven`.

This is the same decision the routing hook makes at a normal execution handoff;
here it is applied **autonomously** (no three-option prompt) because the operator
has delegated engine choice — they review or redirect at the drain's end gate,
not per-plan during the sweep. The choice lands in the entry where it is visible;
there is no separate display step.

### Part II — The autonomous build drain

#### 4. Run mode — the drain orchestrator

`skills/ultradocket/SKILL.md`, `run` mode, rewritten from a 3c forward-reference
to the drain. The orchestrator is the `/ultradocket run` agent loop. It owns a
docket integration branch `ultra/docket-<stamp>` and walks the `queued` entries
in docket-rank order (the order `compile_docket` already emits). For each entry,
**one executor-agnostic wrapper**:

1. **Branch** off the current docket integration line HEAD.
2. **Dispatch by recorded `Engine`**, auto-advancing any human checkpoint
   (catastrophe-only, logged as a judgment call):
   - `ultrapowers` → launch the committed `waves` saved workflow via the
     Workflow tool, as a headless child run (the same top-level launch
     `/ultrapowers` uses — the drain is the agent loop, not a workflow script,
     so there is no script-level nesting).
   - `subagent-driven` → invoke `superpowers:subagent-driven-development`.
   - `inline` → invoke `superpowers:executing-plans`.
   The executor produces commits on the per-plan branch. `waves` self-isolates
   with per-task worktrees and tiers per task; the sequential executors run
   against the per-plan branch the drain prepared.
3. **Administer the sealed exam** against the plan's branch via
   `run_acceptance.sh` (exit-code authority; it creates its own detached
   worktree, so it is agnostic to the current checkout).
4. **Merge or park** — the deterministic step:
   - **Green** → the drain merges the plan branch into the docket integration
     line; the entry advances `queued → executed`; the next plan branches off
     the new HEAD.
   - **Red / executor failure** → **park** (branch kept for inspection), the
     entry → `parked` with reason, and the plan's collision-dependents (from
     `compile_docket`'s collision graph) are skipped; disjoint plans continue.
5. **Auto-advance** to the next `queued` entry. Stop on an empty queue or the
   budget ceiling (a hard stop; remaining entries stay `queued`).

#### 5. The exam-gated auto-approve (the keystone)

The drain runs unattended over non-deterministic executors, so the design splits
the loop into a non-deterministic part and a deterministic part, and keeps the
merge keys on the deterministic side:

- **Non-deterministic, bounded:** the executor implements the plan. Sequential
  executors that would pause for human review are auto-advanced by the
  orchestrator — catastrophe-only, each auto-advance logged for the end gate.
  This is what makes the run non-blocking.
- **Deterministic, authoritative:** the plan's held-out sealed exam decides
  correctness. A green exam (and only a green exam) merges the plan to the
  docket line. This is the repo's standing thesis applied to the drain — *every
  claim the system makes about itself is checked by something it can't touch* —
  so an over-eager auto-approve inside a sequential executor physically cannot
  land broken work on the integration line.

**Read/write boundary note.** The drain widens the set of trusted write-side
executors from {ultrapowers registry harnesses} to {ultrapowers registry
harnesses + the committed superpowers executors}. Those executors are fixed,
audited skills, not orchestration improvised at runtime, so the boundary's
spirit (nothing *improvised* holds write keys) holds. And the safety guarantee
is preserved regardless of which executor wrote the branch: nothing reaches the
docket integration line — or `main` — without clearing the deterministic sealed
exam and the single end gate. The orchestrator's merge to the docket line is a
plain deterministic `git merge` of an exam-green branch, in the same spirit as
the existing `/ultrapowers` Step-5 Approve path.

#### 6. The single pre-merge portfolio gate

When the queue drains or the budget ceiling hits, the drain presents **one**
gate. Per entry: exam evidence (raw runner JSON), engine, cost, disposition
(`executed`/merged or `parked` + reason), and branch; plus portfolio totals and
the could-have-parallelized projection. Disposition choices: merge the docket
integration line to base, or open per-issue PRs (mind the GitHub closing-keyword
gotcha in PR bodies). Accepting the portfolio advances merged entries
`executed → verified`. Parked branches are presented for the operator to
Salvage/Redirect with full context. Per the anti-coupling guard, any
`gh issue close` / comment-back is an **optional** post-step the operator opts
into — never part of the drain core.

#### 7. `compile_docket` consumption + the #34 wiring cleanup

The drain is the first real consumer of `compile_docket`, so this plan closes
the untested-wiring cluster deferred in **#34**:

- A test invoking `compile_docket.main()` (CLI: argparse, file read, JSON print,
  `--budget-usd`) on a fixture docket.
- A test driving `compile_docket()` with the real (non-injected) resolver over
  real fixture plans.
- A queued entry whose `Plan` file is missing or uncompilable is surfaced by the
  drain as a **parked entry with a friendly reason**, not a `CalledProcessError`
  stack trace — with a test. (Today `plan_writes()` uses `check=True`.)

#### 8. Lifecycle

`triaged → accepted → planned → queued → executed → verified`; any non-terminal
state → `parked`. New movement this spec introduces: the sweep mints `queued`
(component 1); the drain advances `queued → executed` on an exam-green merge and
parks on red (component 4); the end gate advances `executed → verified`
(component 6). All transitions go through `docket_lib.transition`.

## Error handling

- **Sealing fails during the sweep** — the entry stays `planned` (approved,
  unsealed); the sweep continues. It is surfaced for a retry on a later sweep;
  it is not `queued`, so the drain never picks up an unsealed plan.
- **Issue closed/edited externally** — not re-verified during the sweep (the
  operator is present and sees the seeded issue; a stale one is skip-parked by
  hand). The drain likewise does not re-verify against an external source — it
  is origin-agnostic by design; a stale plan simply runs and is judged by its
  exam like any other.
- **Red exam mid-drain** — park the plan (branch kept), skip its
  collision-dependents, continue disjoint plans. The red kind (`assertion`
  vs `collection`, bootstrap error, seal broken/missing) rides into the entry's
  park reason and the end-gate evidence.
- **Executor dies mid-plan** — park, continue per the collision graph; the
  partial branch is kept for inspection.
- **Missing / uncompilable queued `Plan`** — parked with a friendly reason
  before execution cost is spent (#34), never a stack trace.
- **Docket hand-edited into an unparseable state** — `docket_lib.parse_docket`
  fails loud naming the entry, never guesses (existing contract; now also covers
  an unknown `Engine`).
- **Budget ceiling reached** — a hard stop; remaining entries stay `queued` and
  resume on the next `/ultradocket run`.

## Testing

- **`docket_lib`** (pure pytest): round-trip parse/serialize of an entry
  carrying `Engine`; `DocketError` on an unknown `Engine` value; existing
  lifecycle/transition tests unchanged.
- **`compile_docket` (#34 cleanup, pure pytest):** the CLI-entrypoint test, the
  real-resolver test, and the missing/uncompilable-`Plan` → parked-with-reason
  test described in component 7.
- **Sweep and drain behavior are skill-prose**, exercised in the manual
  shakedown (consistent with how triage and the prior single-pop plan mode are
  specified — no committed harness; the sweep and drain mutate the docket via
  `docket_lib` and reuse the existing `waves` / `run_acceptance.sh` machinery,
  not a new workflow). The auto-advance discipline (component 5) is the prose
  most worth pressure-testing in the shakedown.
- **Acceptance:** `suite`. This is ultrapowers' own skill/lib/doc development —
  author and operator both read the diffs; the committed suite + drift pins +
  adversarial review are the verification. No held-out exam is authored.

## Non-goals (this spec)

- **Autonomous mid-drain salvage / redirect.** v1 parks on red and surfaces
  every red at the end gate. Bounded autonomous salvage for clear-cut reds is a
  v2 enhancement, measured against the parked-reason evidence v1 produces.
- **Cross-plan concurrent execution.** v1 is sequential; the seam is *measured*
  (the `Engine` tag plus `compile_docket`'s could-have-parallelized projection),
  not built. v2 decides it on evidence.
- **Auto-generated plans.** Every plan is authored interactively with the
  operator. The sweep changes the *cadence* of planning, not its authorship.
- **GitHub coupling in the drain core.** The `issue` field is an opaque label;
  `gh` comment-back/close is an optional operator post-step. No other issue
  sources (Linear/Jira/CSV) are built — only the seam is preserved.
- **Touching `main` unattended.** Everything lands at the single end gate.
- **A single-issue planning command.** Removed; the sweep is the only entry
  point.

## Expected implementation surface

- `skills/ultradocket/scripts/docket_lib.py` — add `Engine` to `Entry`
  (optional, default `None`), parse/serialize it, validate the enum (fail loud
  on unknown). `transition` is unchanged (the two-step `accepted → planned →
  queued` falls out of its existing one-step rule).
- `skills/ultradocket/SKILL.md` — rewrite `plan` mode (the sweep, component 1)
  and `run` mode (the drain, components 4–6); update the skill `description`
  (drop "plan accepted issues one at a time"). The auto-advance and exam-gated
  merge prose is the load-bearing, tightly-worded part.
- `skills/ultradocket/scripts/compile_docket.py` — surface a missing/uncompilable
  `Plan` as a friendly error the drain can park on, rather than a raw
  `CalledProcessError` (#34).
- `tests/test_docket_lib.py` — `Engine` round-trip + unknown-value fail-loud.
- `tests/test_compile_docket.py` — the three #34 wiring tests.
- Triage and the docket entry/collision compiler are otherwise untouched.
