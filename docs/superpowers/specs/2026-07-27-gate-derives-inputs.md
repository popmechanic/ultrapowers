# Spec stub: the gate derives its inputs from the receipt (#96)

**Status:** stub — drafted at the 2026-07-27 ultralearn distill; expand via
brainstorm → full spec before planning. Frozen-periphery change: the
`run_acceptance.sh`/`ultra_gate.py` half moves only on `evals/ab_runner.py`
evidence (route below).

## Problem

The pre-merge gate evals two inputs it does not derive:

1. `report.tests.command` — authored by the completeness critic (an LLM), eval'd
   verbatim by `ultra_gate.py:150` → `run_acceptance.sh --suite-gate`. Observed
   arriving as prose-with-results (bash syntax error → false-red BLOCKED) on 2
   home runs at 0.1.11 (#94).
2. The suite-gate worktree environment — a fresh detached worktree with no
   dependency install, even when the run receipt carries a Step-2-validated
   `bootstrapCmd`. Observed as module-not-found false-red BLOCKED on genuinely
   green branches in 7 field runs spanning 0.0.29→0.1.11; all five 0.1.x
   sightings post-date 0.1.0 making `suite` the default disposition.

Every observed recovery was an orchestrator hand-editing the recorded command
and re-running until green — disclosed and correct each time, but a standing
"gate red → edit gate input → green" precedent (#91 item 7's hazard class).

## Fix direction (structural; one change deletes three clusters)

- **Engine side (not frozen):** `waves.js` stamps `tests.command` mechanically
  from the effective testCmd it actually dispatched (detected or knob-supplied);
  the critic's narrative lives only in `tests.output`. Prompt-source edit rides
  the bake discipline (`references/reviewer-prompts.md` → re-bake → drift pin).
- **Periphery side (frozen, eval-gated):** the suite-gate path provisions its
  worktree from `receipt.bootstrapCmd` before eval'ing the run command — shared
  implementation with the sealed/baseline path's existing bootstrap support,
  not a copy. Module-not-found reds classify as environment, not `assertion`.

`complexityEffect: structural` · `netConceptDelta: down` · `canaryMetric: null`
(rigor increases; nothing traded away).

## Acceptance route (what unfreezes the periphery)

Add a JS-project fixture to `evals/` whose cell reproduces the false-BLOCKED
deterministically today (green branch + gitignored deps + fresh worktree).
Mechanical hard gate per subtraction-eval doctrine: the cell's false-block
counter goes 1→0 under the fix; no other cell's counters regress; the harness
sims and pytest suite stay green.

## Non-goals

- No new operator knob; `bootstrapCmd` is already the single channel.
- No change to sealed/baseline acceptance (already bootstrap-aware).
- No gate-history/audit machinery (contained in #91 item 7's scope).

## Evidence index

Distill 2026-07-27: suite-gate bootstrap cluster 7 runs (sev 2–3); gate-input
edits 10 runs; tests.command prose 2 home runs. Supersedes #94; absorbs #91
item 1. Ledger is local (`docs/superpowers/observations/` gitignored); run IDs
live in the ledger rows tagged with those clusters.
