# Harvester session-scoped attribution — receipts, audits, and terminus derive from what the session launched

_Design for issues #113 + #118 (distill 2026-08-06), one build. Completes #98
at multi-launch/drain scale and deletes the disk-fallback receipt sweep._

## Problem

`harvest_runs.py` attributes run evidence by ambient disk state and
first-match heuristics, not by what the harvested session actually launched:

- `_disk_gate_reports` (the fallback when the transcript prints no receipts)
  globs **every** `run-*/gate-receipt.json` in the repo — receipts from other
  sessions, including runs stamped days later. Cache audit 2026-08-06: of 142
  cached bundles, exactly 4 ever used this fallback, and they are precisely
  the four runs the sense pass flagged for misattribution (an approved run
  bundled as BLOCKED; a 9-plan drain bundled as a single-plan NEEDS_ACK with a
  receipt from 4 days later). **Observed misattribution rate among uses:
  100%.**
- `_plan_path` returns the first Workflow launch's planPath — a 9-plan drain
  session gets one plan.
- `_transcript_dir` returns one directory, so the audit covers one launch; a
  5-launch run's recorded cost was ~1/5 of session-true.
- Terminus is the last receipt's verdict unless an approve marker follows —
  BLOCKED-but-shipped runs (operator-approved environmental override, PR
  merged, live-verified) read as failures in every cross-run statistic.
- Slices carry unrelated post-run session tails (one bundle's last quarter was
  a different investigation), taxing every reader dispatch.

These distortions feed the exact statistics `distill` ranks by and the
frozen-periphery unfreeze routes trust.

## Design

### 1. The session-launch registry (the structural core)

One new extraction pass builds a registry of what the session launched, from
transcript artifacts only:

- **stamps** — from every Workflow `tool_use` whose args carry `runDir`
  (`…/run-<stamp>`), and from every printed ultra_run/ultra_gate receipt's
  `stamp` field.
- **planPaths** — from every Workflow `tool_use` args' `planPath` (not just
  the first), keyed to their stamp.

Stamps carry the whole attribution; wf run IDs are deliberately not extracted
(no consumer — trim review) and live in the slice for readers who care.
Everything downstream attributes by this registry.

### 2. Receipt attribution (#118 lands here)

Transcript-printed receipts keep today's handling (already session-scoped).
`_disk_gate_reports`'s repo-wide glob is **deleted** and replaced by a
**per-stamp fallback**: only for registry stamps with no transcript-printed
receipt, read `<repo>/.claude/ultrapowers/run-<stamp>/gate-receipt.json` if
present. A receipt with a stamp outside the registry can no longer be
attached — the misattribution class becomes inexpressible — and a stamp whose
receipts already printed is never double-sourced. (The 132 cached bundles with
no receipts at all stand to gain correctly-scoped disk receipts they never
had; owned as the structural replacement #113 asked for, not a side effect.)

### 3. Multi-run bundle shape (additive, backward-compatible)

`bundle.json` gains a `runs` array grouped per stamp:
`[{stamp, planPath, gateReports, terminus}]`. Existing top-level fields keep
their meaning for single-run sessions and become "primary/aggregate" for
drains: `planPath` = first plan, `gateReports` = all matched receipts,
`terminus` = the session-level outcome (all runs `approved` → `approved`;
else the last non-approved run's terminus in transcript order — no severity
ordering to maintain). `runId` stays the session hash — reader dispatch and
`merge_ledger`'s origin/engine lookups are untouched.

### 4. Audit union

`_transcript_dir` already collects all candidate dirs and picks one; instead,
audit **every** candidate holding agent transcripts and merge into one audit
block: `agents` concatenated, totals summed. Session-true cost replaces
first-launch cost. (No per-launch breakdown — no consumer; trim review.)

### 5. Terminus honesty

Derivation order per run and session: (a) an approve/teardown `lockReleased`
marker (today's rule) or an approve-mode receipt for a registry stamp →
`approved`; (b) new: last receipt BLOCKED but the transcript later shows a
successful merge of that run's integration branch (a merge-success
tool_result naming the branch) → `approved` as well — the override is
**derivable**, not recorded: terminus `approved` with a last-receipt verdict
of BLOCKED in `runs[]`/`gateReports` is the override signature, and distill
counts overrides from that disagreement; (c) last receipt verdict otherwise.
`truncated` stays true only for NEEDS_ACK/BLOCKED/unknown.

### 6. Slice envelope

The slice ends at the last run-related artifact record (approve/teardown
marker, gate receipt, Workflow result, sweep output) — content after that
boundary is dropped. The planning head is kept in full (context readers need).
No envelope start is imposed.

## Surfaces

- `skills/ultralearn/scripts/harvest_runs.py` — all six changes.
- `tests/test_harvest_runs.py` — extended for each behavior.

Nothing else: `merge_ledger.py` and reader dispatch are untouched by
construction (additive bundle fields, stable `runId`).

## Error handling

- Registry empty (no stamps extractable) → no disk receipts attached, terminus
  from transcript receipts only, single-run shape; never a crash, and never a
  fall-back to the repo-wide glob (deleted).
- Stamp dir missing / receipt unreadable → skip silently (same soft-fail as
  today's fallback, now correctly scoped).
- Multiple planPaths for one stamp (never observed) → keep first, silently.

## Testing

Extend `tests/test_harvest_runs.py` with synthetic-transcript fixtures (the
existing pattern): registry extraction from Workflow tool_use args; disk
receipt matched by registry stamp vs. rejected when outside the registry (the
#118 regression test — a foreign `run-*` dir in the fixture repo must NOT
attach); per-stamp fallback (a stamp with transcript receipts is never
double-sourced from disk); drain shape (two stamps → two `runs[]` entries,
aggregate terminus by the all-approved/last-non-approved rule); audit union
(two transcript dirs summed into one block); override derivability (BLOCKED
receipt then merge-success record → terminus `approved`, last receipt verdict
still BLOCKED in the bundle); slice tail cut after the last artifact.

## Trim review

**Author disclosure (Adds/Removes), as drafted.** Adds: one extraction pass
(registry with stamps + wfRunIds), one bundle `runs` array + a `planPaths`
field + an `approved-override` terminus value, per-launch audit breakdowns,
test fixtures. Removes: the repo-wide receipt glob (`_disk_gate_reports`'s
sweep — #118), the single-transcript-dir audit limitation, the single-plan
assumption.

**Reviewer verdicts** (fresh-context dispatch; saw the draft spec, issues
#113 + #118, the doctrine, and `harvest_runs.py`): 6 trims; scope
reconciliation found the draft grew beyond the issues' claimed flat/down in
four places (new terminus vocabulary, redundant `planPaths`, consumer-less
per-launch breakdown, consumer-less `wfRunIds`) and named one behavior
expansion to own (disk read turning always-on); grade as drafted: **up**,
"applying the six trims … brings the design to flat and back inside its own
issues' complexity claims."

**Adopt-or-answer:**

1. `approved-override` terminus value → **adopted** (merge): detection kept,
   vocabulary dropped — override is derivable as terminus `approved` + last
   receipt BLOCKED; distill counts the disagreement.
2. Top-level `planPaths` list → **adopted** (delete): derivable from
   `runs[].planPath`.
3. Per-launch audit breakdown → **adopted** (delete): union totals only; a
   breakdown returns when a consumer exists.
4. `wfRunIds` in the registry → **adopted** (narrow to none): stamps carry
   the whole attribution; no mechanical consumer.
5. Note field for the never-observed multi-planPath stamp → **adopted**
   (narrow): keep-first, silently.
6. "Worst terminus" ordering → **adopted** (narrow): all-approved →
   `approved`, else last non-approved run's terminus; no ordering concept.

Ownership item: the registry-keyed disk read is narrowed to a **per-stamp
fallback** (consulted only for stamps with no transcript receipt) so the
deleted sweep is not replaced by an always-on second source.

**Reviewer grade after trims: flat** — matching #113's claimed `structural`
and #118's `simplification`/down.
