# Spec: field hardening from the 2026-07-07 distill — remainder (#91)

**Status:** approved design — brainstormed 2026-07-27 (docket sweep iteration 7).
Scope: issue #91 items **2, 3, 5, 6 only**. Item 1 was absorbed by #96, item 4
touches the FROZEN seal-author brief (never drained), item 7 plans together
with #96, and the issue's parked list stays parked on the
machinery-earned-by-recurrence rule.
Surfaces: `skills/ultralearn/scripts/merge_ledger.py` + `tests/test_merge_ledger.py`,
`skills/ultrapowers/scripts/compile_plan.py` + its tests,
`skills/ultrapowers/SKILL.md`, `skills/ultrapowers/references/finishing-notes.md`.
None are the frozen verification periphery.

## Problem

Four smaller adopted items from the 2026-07-07 ultralearn distill (663-row
ledger, five foreign runs at 0.0.31–0.0.32), each observed in the field:

- **(2)** `bundle_lookups(cache_dir)` never expands `~`, so the skill doc's
  own example call (`~/.claude/ultralearn`) throws on every bundle read;
  origin fails closed to `foreign` and the engine-version stamp is silently
  dropped. Privacy-safe, data-lossy: a home run in a batch is misclassified
  foreign and its non-abstracted findings dropped.
- **(3)** Files-grammar enforcement applies to every task regardless of
  disposition: `_files_violations` is a hard `SystemExit` in the compile
  path and an unconditional collector in `--check`, yet overlap inference
  (`build_edges`) only ever consumes `implementation` tasks. A
  gate/manual/release task's placeholder Files value produces pure noise —
  orchestrators manually dismissed it in 2 of 5 field runs. Classification
  currently resolves *after* the Files gate, which is the small ordering
  refactor required.
- **(5)** At a gate reached after a Salvage/Redirect relaunch, the engine
  report carries only the latest run's `deferredVerification` — a
  single-task redirect relaunch collapsed a 5-item ack list to 1; only the
  orchestrator's memory restored it. SKILL.md Step 5 has no union rule.
- **(6)** When finishing rebuilds history (rebase/squash), the shipped SHA
  no longer equals the gate-verified SHA. A rebase-only repo forced a
  post-gate rebuild that absorbed real base drift; integrity carried only
  because the agent voluntarily re-verified. finishing-notes has no
  mandatory re-verification rule, and its recommend-squash guidance is
  structurally defeated in rebase-only repos.

## Design

### 1. `bundle_lookups` expands the user path (item 2)

`cache_dir = Path(cache_dir)` becomes `Path(cache_dir).expanduser()` — one
line. A tilde-path test monkeypatches `HOME` to a temp dir, seeds a
`runs/<runId>/bundle.json` under it, and asserts `bundle_lookups("~/…")`
resolves origin and engine epoch through the tilde (today it fails closed).

### 2. Disposition-scoped Files enforcement (item 3)

Resolve dispositions **before** the Files gate, then enforce Files grammar
only where it feeds overlap inference:

- In `main`'s compile path: run `classify(t)` (stamping `t["disposition"]`)
  immediately after the duplicate-id check, before the Files-violation
  collection; collect `_files_violations(t)` only for tasks whose
  disposition is `implementation`. The later output loop reuses the stamped
  disposition instead of re-classifying.
- In `collect_violations` (`--check`): classify the parsed tasks the same
  way and skip `_files_violations` for non-`implementation` tasks. Marker
  violations, heading checks, and duplicate-id checks stay universal —
  only Files grammar is disposition-scoped.

Non-waved tasks' Files blocks become structurally incapable of emitting
violations or conflicts: they never reach overlap inference, so there is
nothing their Files text can corrupt. An unknown label, annotation, or glob
on an `implementation` task still fails exactly as loudly as today.

### 3. Resume-gate union rule (item 5, prose)

One rule added to SKILL.md Step 5, with the Salvage/Redirect bullets it
governs: a relaunch produces a fresh report, so at any gate reached via
Salvage/Redirect, present the **union** of `deferredVerification` items
across all gate reports produced on this integration branch (previous
reports live in the run's scratch under `<runDir>/`), never the latest
report's list alone. Dropping an item from the ack list requires the
operator's explicit disposition, not a relaunch side effect.

### 4. Shipped-SHA re-verification (item 6, prose)

New finishing-notes section: before the PR, compare the SHA being shipped
against the SHA the gate verified. If they differ — any rebase, squash, or
history rebuild after the gate — re-running the full committed suite AND
the plan's acceptance per its disposition (the sealed exam for `sealed`
plans) is **mandatory**, not judgment: the gate's verdict attached to a
tree that no longer exists. Note explicitly that rebase-only repos defeat
the recommend-squash guidance above it, making the rebuild-and-re-verify
path the expected one there.

## Testing

Item 1: tilde test in `tests/test_merge_ledger.py`. Item 2: in the compiler
tests — a gate task with an unknown-label Files bullet compiles clean and
passes `--check`; the identical bullet on an implementation task still
fails both paths. Items 3–4 are prose. Suite gate: `python3 -m pytest`
green.

## Rejected alternatives

- **Engine-side persistence of deferred items across resumes** (item 5):
  explicitly parked in the issue — prose rule first, machinery on
  recurrence.
- **Keeping Files enforcement universal but downgrading severity for
  non-waved tasks**: still emits the noise the field runs dismissed;
  skipping is the deletion-shaped fix — those blocks feed nothing.

## Collision note

The compiler task neighbors #96's compile/gate work and #95 touches
SKILL.md's Step 5 bullets; the docket drain serializes plans on the
integration branch in rank order, so later plans rebase onto whatever
landed first.
