# Tier resilience: auto-escalate on agent-error + audit observability

**Status:** design (approved 2026-06-25)
**Surface:** `skills/ultrapowers/harnesses/waves.js` (harness logic), `skills/ultrapowers/scripts/audit_run.py`, a one-line note in `references/report-format.md`.
**Provenance:** ledger findings `c8ffdbae` (sev 3), `c5a95f2b`, `2ebd5635` — `docs/superpowers/observations/ledger.jsonl`; distill proposal ②; GitHub-tracked alongside #64/#65.

## Problem

In the ultralearn build run (`wf_3e23d73a-e46`), the Task 1 implementer at the
**cheap (haiku)** tier completed without calling StructuredOutput even after the
engine's in-conversation nudge. That surfaced as a thrown agent-error caught in
`runTask` (`waves.js`), which marked the task `failed` and cascade-blocked its
dependent Task 5 — forcing a whole salvage cycle (re-run Task 1 at sonnet →
clean). The effort audit shows the failing agent thrashed 42 turns — the most of
any agent — for only 3,148 output tokens.

Two gaps:

1. **Engine reliability.** A cheap-tier implementer that cannot satisfy the
   structured-return contract fails hard (one nudge, then a dead task), costing a
   salvage launch — when a single retry at a stronger tier would have recovered
   it in place.
2. **Observability.** `audit_run.py`'s misrank detector only fires on a *relative*
   comparison within ≥2 same-model peers, so a lone thrashing or errored
   implementer is invisible — the very tool meant to flag tier mismatch missed
   this one.

## Goals

- An implementer agent-error triggers exactly one automatic retry at a stronger
  tier; the run recovers without operator salvage.
- The escalation is visible and auditable (judgment call + reported tier).
- `audit_run.py` surfaces errored/escalated implementers and obvious thrash
  without needing same-model peers.

## Non-goals

- A proactive haiku floor (considered and rejected: it loses haiku's cost
  savings wholesale and does nothing if a stronger tier also trips the contract;
  reactive escalation subsumes its benefit).
- Unbounded retries or per-role retry tuning. Exactly one retry.
- Changing any baked discipline prompt (no `references/reviewer-prompts.md` or
  `wave-merge.md` change → no re-bake; `test_no_prompt_drift` stays green).

## Component ① — Auto-escalate in `waves.js`

A thrown implementer agent-error must cost one retry, not one task.

- **`escalateTier(name) -> name`** — a pure helper over the tier ladder
  `['cheap', 'standard', 'mostCapable']` (normalizing `most-capable` via the
  existing `tierKey`): returns the next tier up, or `mostCapable` for the top /
  an unknown tier. Always yields exactly one retry tier, so the top tier retries
  in place (covering transient faults, not just contract failures).
- **`runTaskInner(task, baseSha, siblings, tierOverride)`** — gains an optional
  `tierOverride` that supersedes `task.tier` when resolving the implementer
  model. The reported `economics.tier` / result `tier` reflects the tier it
  actually ran at. Reviewer/completeness roles are unaffected (they always run at
  `REVIEWER_MODEL`).
- **`runTask`** — on the first caught agent-error, retry once via
  `runTaskInner(task, baseSha, siblings, escalateTier(task.tier))`. On a second
  agent-error, return the `failed` / `agent-error` result exactly as today. The
  duplicated failed-result object is factored into a small helper
  (`agentErrorResult(task, msg, tierModel)`).
- **Recorded:** a `judgmentCall` on escalation — e.g. `"task 1: agent-error at
  haiku — retried at sonnet (succeeded)"` (or `(failed)`), plus a `log()` line.
  The successful task's reported `tier` is the escalated model, so the pre-merge
  gate sees both the escalation note and the true cost.

This is harness control-flow, edited directly in `waves.js` (only embedded
prompt *strings* are baked from `references/`; logic is not).

## Component ② — `audit_run.py` observability

Extend `audit(transcript_dir) -> dict` (and the CLI rendering) with two signals,
neither requiring same-model peers:

- **`escalatedTasks` (primary, reliable):** a task id that has more than one
  `impl:<id>` transcript (the escalated retry leaves a second `impl` transcript
  at a higher model) and/or an implementer transcript with no successful final
  result. This is what cleanly catches the haiku case (it errored).
- **`thrashCandidates` (secondary heuristic):** an implementer with
  `turns >= THRASH_MIN_TURNS` **and** `outputTokens / turns < THRASH_MAX_PER_TURN`.
  Thresholds are named module constants chosen so the run's *healthy* implementers
  are NOT flagged (the successful sonnet impl at 37 turns / ~87 tok-per-turn must
  stay clean), pinned by tests. Conservative by design — the reliable catch is
  `escalatedTasks`; this is a backstop for wrong-tier tasks that ran slow without
  erroring.

Both appear in the `audit()` dict and the CLI's markdown output. Because
ultralearn reuses `audit()`, its harvested cost lens inherits both signals.

The existing relative misrank detector is retained unchanged (it is still useful
when same-model peers exist).

## Data / report

- `report-format.md` gains a one-line note: tier escalation is recorded in
  `judgmentCalls`, and a task's reported `tier` reflects the tier it ultimately
  ran at. No schema field is added (the judgment call + existing `tier` field
  carry it).

## Error handling

- The retry is bounded to one. A second agent-error returns the same `failed`
  result the engine produces today — escalation never masks a persistent
  failure, it only recovers a transient/tier-capability one.
- `escalateTier` is total (defined for every input, including unknown tiers →
  `mostCapable`), so it cannot throw inside the catch path.

## Testing

- **`tests/sim_workflow.mjs`** (manual; the deterministic waves.js simulator):
  a new case stubs `agent()` to throw a StructuredOutput-style error on the first
  (haiku) `impl:<id>` call and succeed on the escalated (sonnet) retry; asserts
  the task ends `done`, ran at the escalated tier, and the escalation
  judgment call is recorded. A second case: two agent-errors → the task still
  ends `failed` (retry bounded to one).
- **pytest (CI)** — `audit_run.py`: `escalatedTasks` detected from a fixture
  transcript dir with two `impl:1` files at different models; `thrashCandidates`
  flags a synthetic thrasher and does NOT flag a healthy implementer; the
  existing relative-misrank behavior is unregressed.
- **`test_no_prompt_drift`** stays green (no prompt-string change).

## Acceptance

`**Acceptance:** suite` — ultrapowers self-development; the operator reads every
diff, and the committed pytest suite + the `sim_workflow.mjs` escalation case +
`test_no_prompt_drift` + adversarial review are the verification. No held-out
exam. (Note for the executor: the `sim_workflow.mjs` sims are not in CI — they
run manually via `node tests/sim_workflow.mjs`; the gate must run it explicitly.)

## Constraints

- Standard-library Python only in `audit_run.py`; no new dependencies.
- No baked-prompt edits; no `references/` re-bake.
- `waves.js` remains launch-compatible (no `args` contract change).

## Out of scope

- Proactive tier floors, multi-retry policies, per-role retry tuning.
- Any change to reviewer/completeness model selection.
