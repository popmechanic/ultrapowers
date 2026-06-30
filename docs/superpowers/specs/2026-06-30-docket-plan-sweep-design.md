# Docket continuous planning sweep

**Date:** 2026-06-30
**Status:** front-half of a two-spec arc. Refines the docket pipeline
(parts 3a+3b, shipped #35). The companion spec — the **autonomous build
drain** — supersedes and redefines part 3c (`docket-run`, deferred in #34);
it is out of scope here.

## Problem

Today `/ultradocket plan` pops a **single** `accepted` entry per invocation.
Planning a backlog therefore means re-invoking the command once per issue — a
manual cadence the operator drives by hand, so the up-front planning phase
feels like N disconnected sessions instead of one pass.

The intended docket UX is the inverse: the operator spends **all** of their
planning attention up front, as one continuous sweep, and hands off a fully
planned, sealed, **engine-tagged** queue that an autonomous drain executes at
machine speed. *Plan up front; send to the build engine.* The single-pop model
does not express that shape. This spec makes the sweep the default — and the
only — way the operator plans a docket.

## Decisions

- **The sweep is the default and only planning entry point.** Bare
  `/ultradocket plan` drains the entire `accepted` queue through back-to-back,
  pre-seeded brainstorms, in docket-rank order, until the queue is empty or the
  operator stops. There is **no single-issue form** (`plan #<id>` is removed):
  its only value over a plain `superpowers:brainstorming` session was docket
  integration, and its narrow niche — planning one accepted entry out of order
  — is covered by reorder-then-sweep. One concept, one entry point.
- **The sweep is the operator-attention phase — interactive by nature.** Each
  plan needs the operator's brainstorm and signature. The autonomy described for
  the *build* phase (engines acting, autonomous redirects, non-blocking runs)
  lives entirely in the drain (companion spec). The sweep's terminal state is a
  queue that is fully planned, sealed, and engine-tagged — nothing here ever
  executes a plan.
- **The execution engine is decided during the sweep and recorded on the
  entry.** As part of sealing each plan, the agent applies the shared
  execution-fit rubric to the finished marked plan and writes the chosen engine
  into the docket entry. The drain consumes that recorded choice; it does not
  recompute it. The decision is auditable in the docket and is made when the
  plan is freshest.
- **Minimal in-sweep controls:** continue (default), skip-park (with reason),
  stop (resume later). Reordering is a docket-file edit between sittings, not an
  in-flight verb — ordering is owned by docket rank, set at the triage gate.

## Operator journey

1. `/ultradocket` triages the backlog → ranked `docs/superpowers/docket.md`;
   the operator accepts a subset at the docket gate (unchanged, parts 3a+3b).
2. `/ultradocket plan` → **the sweep**. For each `accepted` entry in rank order:
   a pre-seeded brainstorm → plan → operator approval → seal → the entry is
   written back as `queued` with its plan path, seal, and engine. The sweep
   auto-advances to the next entry. The operator continues, skip-parks, or stops
   at any boundary.
3. When the sweep finishes (queue empty, or the operator stops), the docket
   holds a set of `queued` entries — each a complete *what + how* contract:
   issue, plan, seal, engine. This is the queue the drain (companion spec) will
   execute.

## Components

### 1. Plan mode — the continuous sweep

`skills/ultradocket/SKILL.md`, `plan` mode, rewritten from single-pop to a loop.
One iteration:

1. **Pop** the highest-rank `accepted` entry.
2. **Pre-seed** a standard `superpowers:brainstorming` session with the issue
   body, the triage notes, and the matched line(s) of `docs/objectives.md`. A
   well-defined issue is half a spec, so the interview is short.
3. **Plan** through the normal pipeline: brainstorm → `superpowers:writing-plans`
   + `ultrapowers:ultraplan` → operator approval → sealing step (part 1).
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

### 2. The `Engine` field on docket entries

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

### 3. Engine selection

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
has delegated engine choice — they review or redirect at the drain's pre-merge
gate, not per-plan during the sweep. The choice lands in the entry where it is
visible; there is no separate display step.

## Error handling

- **Issue closed/edited externally** — not re-verified during the sweep. The
  operator is present and sees the seeded issue; a stale one is skip-parked by
  hand. Re-verification belongs to the drain, where it protects an *unattended*
  build before spending execution cost (companion spec).
- **Sealing fails** — the entry stays `planned` (approved, unsealed); the sweep
  continues. The entry is surfaced for a retry on a later sweep; it is not
  `queued`, so the drain never picks up an unsealed plan.
- **Docket hand-edited into an unparseable state** — `docket_lib.parse_docket`
  fails loud naming the entry, never guesses (existing contract; now also covers
  an unknown `Engine`).

## Testing

- `docket_lib`: round-trip parse/serialize of an entry carrying `Engine`;
  `DocketError` on an unknown `Engine` value; existing lifecycle/transition
  tests unchanged. Pure pytest.
- Sweep behavior is skill-prose, exercised in the manual shakedown (consistent
  with how triage and the prior single-pop plan mode are specified — no
  committed harness; the sweep mutates the docket via `docket_lib`, not a
  workflow).

## Non-goals (this spec)

- **The autonomous build drain** — executing the queued plans, autonomous-vs-
  escalated redirect policy, non-blocking run semantics, the single pre-merge
  portfolio gate. All of it is the companion spec (redefines 3c, #34). This
  spec only *records* the engine; it never executes.
- **Auto-generated plans.** Every plan is authored interactively with the
  operator. The sweep changes the *cadence* of planning, not its authorship.
- **Changes to triage or `compile_docket`.** The `Engine` field is for the
  drain; the collision/ordering compiler is unaffected.
- **A single-issue planning command.** Removed; the sweep is the only entry
  point.
