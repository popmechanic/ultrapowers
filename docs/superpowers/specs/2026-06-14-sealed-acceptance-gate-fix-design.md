# Sealed acceptance — deterministic gate administration + operator vouching rubric

**Date:** 2026-06-14
**Fixes:** [#36](https://github.com/popmechanic/ultrapowers/issues/36) (relay false-negatives every passing exam), [#37](https://github.com/popmechanic/ultrapowers/issues/37) (operator vouching rubric)
**Follows:** the 2026-06-12 sealed-acceptance design (part 1, merged) and its 2026-06-14 Task 7 live shakedown, which first exercised the relay and found it broken 6/6.

## Problem

Sealed acceptance (part 1) ships an `**Acceptance:**` contract: a held-out exam, authored from
the spec alone, hash-pinned in a vault, administered at the pre-merge gate. The deterministic
runner `run_acceptance.sh` works correctly. But the **administration** path does not.

The workflow engine (`harnesses/waves.js`) cannot run a shell — `agent()` is its only route to a
subprocess. So to administer the exam it dispatches a cheap-model (Haiku) agent told to run the
runner and relay its stdout verbatim into a `{ raw: string }` field, then extracts the verdict with
`(exam.raw || '').match(/\{[\s\S]*\}/)`. The runner's stdout is **itself a JSON object**, so the
agent is asked to embed JSON inside JSON. The Task 7 shakedown proved that Haiku reliably *unwraps*
the nested object, relaying only the inner pytest text; the regex then finds no `{`, `parsed` is
null, and the engine records `status: ERROR, passed: false`. Result: **6/6 false negatives on a
genuinely passing exam** — the gate refuses to Approve every passing run.

This is fail-safe (the unwrap can never fabricate `passed: true`, so the anti-gaming property
holds) but makes the feature **unusable on the happy path**: an operator would have to override the
gate on every run, hollowing out the verification it exists to provide.

Separately (#37): the feature's premise is that a non-coder operator can *vouch* for an exam they
cannot read, using the spec plus the author's plain-English coverage summary. The system ships the
coverage summary but **no procedure for judging it**. In the Task 7 shakedown the operator could
not vouch until handed a review rubric — without one, the human gate degrades to rubber-stamping.

## Design

### 1. Administer `sealed` exams at the gate, deterministically (#36)

Move administration of `sealed`-mode exams **out of the workflow** and **into the SKILL.md Step 5
pre-merge gate**, where the main Claude session already runs Bash (it executes `sweep_worktrees.sh`
and `git checkout` there) and already holds `sealId`, `sha256`, and the resolved `scriptPath`.

At the gate, for a `sealed` disposition, the main session runs:

```
bash <plugin-root>/skills/ultrapowers/scripts/run_acceptance.sh <sealId> <integrationBranch> <sha256>
```

- **The runner's exit code is the authority.** `run_acceptance.sh` already exits 0 iff the seal
  verified AND the exam passed, and non-zero for every other outcome (`SEAL_MISSING`, `SEAL_BROKEN`,
  red exam, runner error). Exit 0 → acceptance passes; non-zero → the gate must not Approve. No
  parsing decides the gate, so there is no model and no nested-JSON relay — nothing to mangle. The
  bug class is removed at the root, not patched.
- The runner runs from the session repo against `integrationBranch`; it creates its own detached
  worktree of that branch, so it is agnostic to whatever is currently checked out.
- The emitted JSON object is rendered **verbatim as receipts** alongside the gate decision —
  consistent with the existing "receipts, not narrative" rule.
- The vault defaults to `~/.ultrapowers/acceptance` (where the ultraplan sealing step wrote the
  real seal); no `--vault` override in normal operation.
- The gate reads `sealId`/`sha256` from the compiler's `acceptance` output, which the orchestrator
  (main session) already holds — the same source it passed into the workflow launch args — and
  re-confirmed in the report's `PENDING_GATE` disposition.

This matches the original spec's own words: exam administration is "deterministic, not agentic." The
agentic relay was an engine-side implementation accident of the workflow's no-shell constraint, not
a design requirement.

### 2. Scope of the change — only `sealed` moves

`run_acceptance.sh` itself is unchanged. The other two dispositions need no shell and stay computed
in the workflow exactly as today:

- **`suite`** — `acceptance.passed === tests.passed`; mirrors the committed suite result.
- **`waived`** — static reason, `passed: null`.
- **`null`** (unmarked plan) — unchanged.

Only the `sealed` branch of `waves.js` changes: instead of administering, the workflow emits a
non-executing disposition for the report:

```js
acceptance = { mode: 'sealed', sealId, sha256, status: 'PENDING_GATE', passed: null,
               note: 'administered deterministically at the pre-merge gate' }
```

The workflow no longer needs `scriptPath`; the gate resolves it from the plugin root.

### 3. Operator vouching rubric (#37)

Bake a fixed 3-question rubric into the operator-facing surface, framed so it requires **no
code-reading** — the operator checks that the coverage summary faithfully restates *their* spec:

1. **Everything covered?** Walk the spec one requirement at a time; each should map to a row in the
   coverage summary. A requirement with no matching row is a gap.
2. **Invented anything?** Scan the summary for checks the spec never asked for (an honest
   implementation could fail the exam for the wrong reason). Small implied edge cases are fine.
3. **Your examples present?** The spec's concrete examples should appear in the exam verbatim — the
   sharpest checks.

Framing line: *"You are not judging whether the test code is correct — you can't see it and don't
need to. You're checking that the summary is a faithful, complete restatement of your spec."*

- **Primary home:** `skills/ultrapowers/SKILL.md` Step 3 transparency block, where the operator
  approves the acceptance disposition and coverage summary before execution.
- **Pointer:** a one-line reference in the `skills/ultraplan` sealing step, so the rubric travels
  with the coverage summary it is meant to judge.

## Components touched

| File | Change |
|---|---|
| `skills/ultrapowers/harnesses/waves.js` | Delete the `sealed` relay branch (`agent()` call, regex extraction, `judgmentCalls` push). Emit the `PENDING_GATE` disposition instead. Drop `scriptPath` need; remove the now-empty `'Acceptance'` phase. |
| `skills/ultrapowers/references/reviewer-prompts.md` | Remove the `BAKE:ACCEPTANCE-EXAM` block. |
| `skills/ultrapowers/SKILL.md` | Step 5: add deterministic `sealed` administration (run script → exit-code gate → render receipts); existing `SEAL_MISSING`/`SEAL_BROKEN`/red remedies key off the script's exit + status. Step 3: add the vouching rubric. |
| `skills/ultraplan/SKILL.md` | One-line pointer to the rubric from the sealing step. |
| `skills/ultrapowers/references/report-format.md` | Document `sealed` acceptance as `PENDING_GATE` in the report; administered at the gate. |
| `tests/test_no_prompt_drift.py` | Drop `ACCEPTANCE-EXAM` from expected baked blocks. |
| `tests/test_workflow_sim.py` | Update sealed-mode expectation to `PENDING_GATE`. |

## Error handling (unchanged outcomes, now via exit code)

- **Red exam** → runner exits non-zero, `status: OK, passed: false` → gate offers Redirect/Salvage;
  operator override recorded as a waiver-with-reason.
- **`SEAL_BROKEN`** (hash mismatch / tamper) → exit 1 → gate refuses Approve; remedies: re-seal or
  waive.
- **`SEAL_MISSING`** (vault gone) → exit 1 → gate refuses Approve; remedies: re-seal from the spec
  (it still exists) or waive.
- **Runner `ERROR`** (e.g. branch worktree cannot be created) → exit 1 → gate refuses Approve,
  surfaces the reason.

All of these already produce a non-zero exit and a descriptive `status`/`output`; the gate treats
any non-zero exit identically (do not Approve) and shows the receipts.

## Testing

Lean, per the brainstorm decision:

- The deterministic core stays covered by the existing `tests/test_run_acceptance.py` (6 tests:
  hash stability, green, red, broken-seal, missing-seal, worktree cleanup). The gate calls this same
  tested script.
- pytest deltas: the drift-pin and sim updates above. `python3 -m pytest tests/ -q` stays green.
- Both `validate_skill.py skills/ultrapowers` and `... skills/ultraplan` still print `skill ok`.
- **End-to-end check:** a fresh Task-7-style live shakedown as a final manual task — re-run the
  relay probe scenario and confirm the gate now administers a passing exam green deterministically
  (the failure this whole change fixes), plus a quick tamper/red confirmation that the gate refuses.

## This plan's own acceptance disposition

The implementation plan carries **`**Acceptance:** suite`** — its verification is its own committed
test suite plus the manual shakedown. A held-out exam authored from this spec would be recursive
(the thing under test *is* the exam administrator), exactly the case the founding sealed-acceptance
plan used `suite` for.

## Non-goals

- Changing `run_acceptance.sh`, `seal_hash.py`, the vault layout, or the hashing contract.
- Changing how `suite` or `waived` dispositions are computed.
- The other open verification-integrity issues (#29, #32) and the eval-methodology issues
  (#26, #27, #28) — each gets its own spec → plan → implement cycle.
- Docket part 3c. Note only: because administration now lives in the reusable script (not in
  workflow prose), a future docket-run drain can call `run_acceptance.sh` the same way the gate
  does — the fix keeps the administrator origin-agnostic.
