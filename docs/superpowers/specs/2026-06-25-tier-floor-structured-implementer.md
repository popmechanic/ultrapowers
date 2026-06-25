# Tier floor for schema-constrained implementer roles

**Status:** stub (from `ultralearn distill`, 2026-06-25 — needs brainstorming before a plan)
**Surface:** `references/reviewer-prompts.md` → re-baked into `harnesses/waves.js`; `skills/ultrapowers/scripts/audit_run.py`
**Provenance:** ledger findings `c8ffdbae` (sev 3), `c5a95f2b`, `2ebd5635` — see `docs/superpowers/observations/ledger.jsonl`.

## Problem

In the ultralearn build run (`wf_3e23d73a-e46`), the Task 1 implementer at the
**cheap (haiku)** tier **completed without calling StructuredOutput even after the
engine's in-conversation nudge**, so the task failed with `agent-error`. That
cascade-blocked Task 5 and forced a full salvage cycle (re-run Task 1 at sonnet →
clean). The effort audit shows the failing agent **thrashed 42 turns — the most of
any agent in the run — for only 3,148 output tokens**: a clear "wrong tier" thrash
signature.

Two distinct gaps:

1. **Engine reliability.** haiku cannot reliably satisfy the implementer
   structured-return contract, and the failure mode (one nudge, then hard task
   failure) is expensive — it costs a whole salvage launch.
2. **Observability.** `audit_run.py`'s misrank detector only fires on a *relative*
   comparison within ≥2 same-model peers, so a lone thrashing or errored
   implementer is invisible — the very tool meant to catch tier mismatch missed
   this one.

## Candidate directions (to brainstorm)

- **Auto-escalate on contract-failure:** on a StructuredOutput-compliance
  `agent-error`, retry the task once at the next tier up (haiku→sonnet) before
  marking it failed. Highest leverage — this alone would have made the first run
  succeed outright, no salvage.
- **Haiku floor for structured roles:** never assign the cheap tier to implementer
  roles whose deliverable requires StructuredOutput; reserve haiku for
  setup/merge-style roles.
- **Absolute thrash signal in `audit_run.py`:** flag high-turns ÷ low-output
  agents and surface agent-errored tasks explicitly, independent of same-model
  peer count. (ultralearn reuses `audit()`, so this also improves the harvested
  cost lens for every future run.)

## Constraints

- The implementer/reviewer prompts are **baked** into `harnesses/waves.js` from
  `references/reviewer-prompts.md` and pinned by `tests/test_no_prompt_drift.py`.
  Edit the `references/` source and re-bake per `references/workflow-template.md` —
  never patch `waves.js` directly.
- Any retry/escalation must stay deterministic and surface as a `judgmentCall` in
  the report.

## Acceptance (to be defined at plan time)

A run whose cheap-tier implementer hits a StructuredOutput-compliance error
recovers automatically (escalated retry) instead of failing the task and
cascade-blocking dependents; `audit_run.py` flags a single-sample thrash/errored
agent.
