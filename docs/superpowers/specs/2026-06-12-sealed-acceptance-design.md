# Sealed acceptance

**Date:** 2026-06-12
**Part 1 of 3** of the verification-first architecture (build order: sealed-acceptance → harness-library → docket). Each part has its own spec → plan → run cycle.

## Problem

Ultrapowers' operator cannot read code. Every quality signal the engine currently
surfaces at the pre-merge gate — review verdicts, the report narrative — is
authored by the same system that did the work: the system grading itself. The
eval harness solved this with held-out acceptance suites ("the agents can't game
tests they never knew existed"), and that mechanism is what made its results
credible — including catching a 3/7 functional failure that the run's own
internal review had passed. That protection currently exists only in the eval.
This spec promotes it to an engine contract.

Goodhart's law is the design constraint: the spec is public (everyone aims at
it); the exam derived from the spec is hidden (the aim can't cheat). An
implementing agent with the test file in context rationally builds whatever
makes those assertions pass, not the feature.

## Decisions (made at brainstorm, 2026-06-12)

- **Authorship:** independent, spec-only. A fresh-context subagent receives
  only the spec (never the plan), authors the suite, writes it directly to the
  vault, and returns only a seal-id, red-run evidence, and a coverage summary.
  Neither the planning session nor the orchestrator ever holds the suite in
  context.
- **Enforcement:** hard gate. `acceptance.passed` is required for the Step-5
  Approve path exactly like `tests.passed`. Every marked plan must carry a seal
  or an explicit recorded waiver.
- **Red-at-baseline:** at sealing time the suite must FAIL against the
  untouched base branch — proving it tests something not yet built. A suite
  green at baseline is rejected and re-authored.
- **Integrity:** the plan records the suite's sha256. The exam runner verifies
  vault contents against that hash before administering; a mismatch is a hard
  "seal broken" failure.

## Components

### 1. The vault

`~/.ultrapowers/acceptance/<seal-id>/` — outside every repository, never in a
worktree, branch, or prompt.

```
<seal-id>/
  suite/            # the test files, in the repo's test framework
  manifest.json     # { sealId, planPath, specPath, suiteSha256, runCmd,
                    #   createdAt, baselineSha, redEvidence (truncated output),
                    #   coverage: [{criterion, tests[]}] }
```

`seal-id` = first 12 hex chars of `suiteSha256`.

### 2. Sealing step (extends the ultraplan flow)

After the human approves a plan, and before the plan is considered
execution-ready:

1. Orchestrator dispatches the **author agent** (fresh context, most-capable
   tier) with exactly: the spec text, the repo's test conventions (framework,
   how suites run, naming), the base branch name, and vault-write instructions.
   Not the plan. Not the task list.
2. The author writes the suite into the vault, creates a throwaway worktree at
   the base branch, runs the suite there, and verifies it fails. Collection
   that errors on missing modules counts as red (the feature doesn't exist);
   a suite that errors on its own syntax is the author's bug — fix and rerun.
3. The author computes the hash, writes `manifest.json`, and returns to the
   orchestrator ONLY: seal-id, sha256, red evidence snippet, coverage summary.
4. The orchestrator appends to the plan, after the header block:
   `**Acceptance:** sealed <seal-id> (sha256:<hash>)` and the coverage summary
   as a short appendix (safe to show — it is spec-derived).

Waiver syntax, for plans where the operator explicitly opts out:
`**Acceptance:** waived — <reason>`. Waivers are echoed verbatim at the
wave-plan gate, in the report, and at the pre-merge gate.

### 3. Compiler enforcement

`compile_plan.py` parses the `**Acceptance:**` line. A marked plan with
neither seal nor waiver fails compilation with a message naming this spec.
The seal-id and hash ride into the compile output so the engine can carry them.

### 4. Exam administration (deterministic, not agentic)

`skills/ultrapowers/scripts/run_acceptance.sh <seal-id> <branch> <expected-sha256>`:

1. Recomputes the vault suite hash; aborts `SEAL_BROKEN` on mismatch.
2. Creates a throwaway worktree of `<branch>`, copies the suite in, runs it,
   captures full output, removes the worktree and the copy.
3. Emits JSON: `{ sealId, passed, failed, total, exitCode, output }`.

The engine (workflow.js / the waves harness) invokes this script in its
report phase via an agent instructed to run exactly that command and return
output verbatim — receipts, not narrative. The structured report gains an
`acceptance` block.

### 5. Gate behavior (SKILL.md Step 5)

Approve requires `tests.passed && (acceptance.passed || acceptance.waived)`.
On a red exam the gate offers Redirect/Salvage, or an operator override that
is recorded as a waiver with reason in the runbook and report. Missing vault
(machine changed, vault deleted): gate fails `SEAL_MISSING`; remedies offered
are re-seal (re-author from spec — the spec still exists) or waive.

## Error handling

- **Green at baseline during sealing** → author retries with the failure
  explained; two consecutive green attempts escalate to the human (the spec
  may describe already-existing behavior).
- **Flaky exam** (pass/fail varies) → the runner runs the suite once; a rerun
  request is an operator action at the gate, and both outputs land in the
  report.
- **Seal broken / missing** → hard failure, never silently skipped.

## Threat model (stated honestly)

The seal prevents *contextual* contamination: no prompt, plan, task body, or
sibling context ever contains the exam, so no agent can teach to a test it has
never seen — including the orchestrator, which cannot leak what it never read.
It does NOT stop a hypothetical malicious agent with shell access from reading
`~/.ultrapowers` — our agents are not adversarial, and sandboxing them is out
of scope. The risks this closes are drift, self-preference, and
gaming-by-osmosis.

## Testing

- pytest: seal-line parsing in `compile_plan.py` (sealed / waived / absent).
- pytest e2e: `run_acceptance.sh` against a fixture repo — green path, red
  path, broken-seal path, missing-vault path.
- Anti-drift: the author-agent prompt and the report `acceptance` block shape
  pinned alongside the existing prompt-drift tests.
- The eval fixtures gain seals so future eval runs exercise the same contract.

## Non-goals

- Per-task seals (the exam is plan-level; tasks keep their existing reviews).
- Adversarial sandboxing of agents.
- Changing how the eval's own held-out suites work — this generalizes them.
