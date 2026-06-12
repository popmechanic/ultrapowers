# The docket

**Date:** 2026-06-12
**Part 3 of 3** of the verification-first architecture (build order: sealed-acceptance → harness-library → docket). Depends on both prior parts: gates run sealed exams (part 1); the drain runner is the harness ratchet's first promotion (part 2).

## Problem

Ultrapowers parallelizes *within* a plan, but real plans serialize (measured:
4 of 5 tasks colliding on one file in a representative run). Width lives at
the portfolio level: a backlog of well-defined GitHub issues is a set of
mostly-disjoint, human-authored, acceptance-bearing work items. Superpowers
has no machinery above the single planning session — nothing decides which of
forty issues deserves planning, and nothing reasons about N approved plans as
a set. The operator's overnight eval queue (`night_runner.sh`) was the crude
prototype of the missing layer.

**Explicitly retained:** superpowers authors every plan, interactively, with
the operator. The docket never generates plans. The plan remains the one
interface the operator can fully audit; throughput is capped by operator
attention at the planning step, deliberately — everything downstream of the
operator's signature runs at machine speed, nothing upstream of it should.

## Decisions (made at brainstorm, 2026-06-12)

- **Scope:** sequential portfolio execution v1, with the cross-plan
  parallelism seam *instrumented from day one* (collision graph computed,
  could-have-parallelized wall-clock recorded) so the v2 decision is
  empirical. Cross-plan concurrent execution is explicitly deferred.
- **Gate policy during a drain:** unattended with evidence. Green sealed exam
  → auto-advance (merge to the docket integration line; next run rebases on
  it). Red exam → park the branch, skip collision-dependent plans, continue
  disjoint ones. Everything lands at one morning gate. `main` is never
  touched unattended.
- **UX:** one skill, `/ultradocket`, three moods (triage / plan / run), fully
  optional — the single-feature superpowers flow is unchanged when the docket
  isn't summoned.

## Operator journey (approved at brainstorm)

1. First run in a repo: no `docs/objectives.md` → ten-minute interview drafts
   it. It is a versioned plain-English doc the operator edits freely.
2. `/ultradocket` → triage sweep → `docs/superpowers/docket.md` ranked slate →
   **docket gate**: operator strikes, reorders, sets budget ceiling.
3. `/ultradocket plan` → next accepted issue opens a standard superpowers
   brainstorm pre-seeded with issue body + triage notes + relevant objective
   (light interview; a well-defined issue is half a spec) → spec → marked plan
   → operator approval → sealing step (part 1) → docket entry updated.
4. `/ultradocket run` → portfolio compile → **portfolio gate** (order,
   collision reasoning, budget, could-have-parallelized projection) → drain,
   overnight-capable.
5. Morning: one portfolio report — per issue: exam evidence, cost,
   disposition — then merge the docket line or open per-issue PRs.

## Components

### 1. Objectives doc

`docs/objectives.md` in the target repo. Plain English. Triage scores against
whatever it currently says; no schema beyond headings.

### 2. Triage harness (improvised, read-only — legal under part 2's boundary)

Fan-out over `gh issue list` + repo: per issue, score well-definedness,
objective alignment, estimated blast radius (likely files), risk; cluster
duplicates/shared root causes; build the candidate collision graph. Output is
the docket file. Authored at runtime per the dynamic-workflows patterns; it
mutates nothing.

### 3. The docket file

`docs/superpowers/docket.md` — human-readable ranked slate; each entry carries
structured marker-style fields a deterministic parser reads (same pattern as
plan markers):

```
### #214: Stripe webhooks dropped on retry
**State:** accepted          # triaged|accepted|planned|queued|executed|verified|parked
**Score:** 8.5 — revenue-reliability objective
**Est-files:** services/billing/*, lib/webhooks.py
**Plan:** docs/superpowers/plans/2026-06-14-stripe-webhook-retry.md   # once planned
**Seal:** a1b2c3d4e5f6                                                # once sealed
```

The docket holds state between sessions; lifecycle transitions are made by
the skill's scripts, never by hand-waving prose.

### 4. Planning seeding

`/ultradocket plan` constructs the brainstorm opening context from the docket
entry and hands off to the normal superpowers → ultraplan → seal pipeline.
On completion it records plan path + seal-id into the entry and sets
`State: queued` (`planned` is the intermediate state: plan approved, seal not
yet issued — e.g. a sealing attempt that needs retry).

### 5. Portfolio compiler

`skills/ultrapowers/scripts/compile_docket.py` (deterministic, tested):
reads the docket + every queued plan's `Files:` blocks → cross-plan collision
graph → execution order (collisions sequenced, others ordered by docket rank)
→ budget ledger → could-have-parallelized projection (which plans were
provably disjoint, what the critical path would have been). Emits portfolio
JSON for the gate and the drain.

### 6. The drain: `docket-run` (second registry harness, born via the ratchet)

Frozen harness owning a docket integration branch `ultra/docket-<stamp>`. For
each plan in compiled order:

1. Launch the `ultrapowers` (waves) harness as a **child workflow** against
   the docket line (one level of nesting — waves itself never nests).
2. On child completion, administer the sealed exam via
   `run_acceptance.sh` (part 1), deterministically.
3. Green → merge the plan's integration result into the docket line; record
   evidence; next plan rebases on it.
4. Red or child failure → park (branch kept, nothing merged), mark
   collision-dependents skipped, continue disjoint plans.
5. Stop cleanly at the budget ceiling; remaining plans stay `queued`.

Per-plan wall-clock is recorded against the could-have-parallelized
projection — the v2 seam's data.

**Proven fallback** (documented in the harness's reference): the eval's
`night_runner.sh` pattern — a bash queue of headless CLI runs with scripted
gates — if child-workflow nesting misbehaves in practice.

### 7. Morning gate and portfolio report

Per issue: exam evidence (raw runner JSON), cost, status, branch; portfolio
totals; parked items with park reasons; could-have-parallelized summary.
Disposition choices: merge docket line to base, or per-issue PRs referencing
their issues (mind the GitHub closing-keyword gotcha in PR bodies). Parked
branches are presented for Redirect/Salvage per the existing Step-5 options.

## Error handling

- Issue closed/edited externally mid-docket → re-verified before its run;
  stale entries are parked with reason, not silently executed.
- Child workflow dies → park, continue per collision graph.
- Docket file hand-edited into an unparseable state → compiler fails loudly
  naming the entry, never guesses.
- Vault missing for a queued seal → that plan parks with `SEAL_MISSING`
  before any execution (cheaper than failing at its gate).

## Testing

- `compile_docket.py`: fixture dockets + plans → collision graph, ordering,
  budget, projection (pure pytest).
- `docket-run`: candidate-stage fixture e2e under the part-2 ratchet (two
  tiny fixture plans, one green one red, against a fixture repo) before
  promotion.
- Docket parser: lifecycle transitions, unparseable-entry failure.
- gh interactions mocked in tests; live `gh` exercised only in the manual
  shakedown run.

## Non-goals (v1)

- Cross-plan concurrent execution (the seam is measured, not built).
- Issue sources other than GitHub issues.
- Auto-generated plans of any kind.
- Touching `main` unattended.
