# Harness library and ratchet

**Date:** 2026-06-12
**Part 2 of 3** of the verification-first architecture (build order: sealed-acceptance → harness-library → docket). Each part has its own spec → plan → run cycle.

## Problem

The frozen `workflow.js` is the project's most load-bearing decision: it makes
runs deterministic, accumulates bug fixes permanently (the gotcha ledger is
the argument), prevents the self-preferential-bias failure where the context
that wants work done authors its own reviewers, and makes unattended mutation
safe because the harness's failure modes are known. But the freeze as
currently implemented is a *single artifact*, which imposes a single topology:
waves → independent review → merge. Work that wants a different shape (a
portfolio drain, a design tournament) has nowhere to live without either
unfreezing (losing every protection) or contorting into waves.

This spec evolves the freeze from an artifact into a **governance policy**:
many frozen harnesses, one promotion procedure, one boundary rule.

## Decisions (made at brainstorm, 2026-06-12)

- Frozen harnesses become a **registry**; runtime intelligence *selects* a
  harness, never authors one for write-side work.
- **Read/write boundary:** phases that mutate the repo must run a registry
  harness launched by name; read-only phases (discovery, triage, research,
  scoring) may be improvised at runtime as dynamic workflows.
- **The ratchet:** new topologies are born dynamic, proven against fixtures,
  then frozen in — the same road `workflow.js` itself traveled.
- This phase ships structure, policy, and migration only. **No new harnesses**
  — the docket runner (part 3) is the ratchet's first real exercise.

## Components

### 1. Library layout

```
skills/ultrapowers/harnesses/
  waves.js          # today's workflow.js, moved verbatim (meta.name stays
                    # 'ultrapowers' — saved-workflow resolution is by meta.name,
                    # so nothing existing breaks)
  probe.js          # the engine preflight, moved
  registry.json
  candidates/       # ratchet stage — present but empty at the end of this phase
```

`registry.json` schema, one entry per harness:

```json
{
  "name": "ultrapowers",
  "file": "waves.js",
  "purpose": "plan → parallel waves → review → merge",
  "writeSide": true,
  "version": "<plugin version at last change>",
  "fixtures": "tests/test_workflow_sim.py",
  "driftTest": "tests/test_no_prompt_drift.py"
}
```

### 2. Install step

SKILL.md Step 4a changes from copying two named files to copying **every
registry entry** into `.claude/workflows/` (same idempotent overwrite
behavior; install filename = `ultra-<file>` except the existing
`ultrapowers-run.js` / `ultrapowers-probe.js` names, which are preserved for
continuity).

### 3. The boundary, codified in SKILL.md

New policy section, normative language:

- A phase that creates branches, edits files, merges, or otherwise mutates a
  repository MUST be executed by a registry harness, launched by `meta.name`.
- A phase that only reads MAY be an improvised dynamic workflow, and improvised
  workflows MUST be read-only. (Honest caveat, stated in the skill: this is
  policy enforced by prompts and review, not a sandbox. The hard guarantee is
  that nothing improvised holds the merge keys.)
- The determinism guard is restated in registry terms: never launch write-side
  work via `ultracode` or prose-requested workflows.

### 4. The ratchet (documented in `references/harness-ratchet.md`)

Promotion path for a new topology:

1. **Born dynamic** — prototyped as an improvised workflow on read-only or
   fixture-confined work.
2. **Candidate** — committed under `harnesses/candidates/<name>.js` with a
   fixture suite and an args-validation preflight (probe pattern). Candidates
   are launchable ONLY against fixture repos; the registry integrity test
   fails if SKILL.md references a candidate for real work.
3. **Promotion** — requires: fixture e2e green, prompt-pinning (drift) test
   added, args contract documented, human review of the harness source, and a
   registry entry. Promotion is a normal reviewed commit.
4. Registered harnesses change only via the same review + re-pin procedure
   (the existing re-bake discipline, generalized).

### 5. Tests

- **Registry integrity** (new): every registry entry's file exists, has a
  parseable `meta` literal whose `name` matches, and names fixture + drift
  tests that exist and collect. No candidate is referenced by SKILL.md as
  launchable.
- Existing anti-drift, compat, and workflow-sim tests updated for the new
  paths; behavior of `waves.js` is byte-identical to `workflow.js` at
  migration (enforced by a move-only diff in the migration commit).

## Error handling

- Missing/renamed harness file at install time → Step 4a aborts before launch
  with the registry entry named (never silently launches a stale copy).
- Registry/meta name mismatch → integrity test failure in CI, install-time
  warning at runtime.

## Non-goals

- No new harnesses in this phase (docket-run arrives in part 3).
- No sandbox enforcement of read-only improvised workflows.
- No change to waves.js behavior — this is a structural migration.
