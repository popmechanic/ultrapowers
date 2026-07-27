# Spec: harvester gate evidence + synthetic origin (#98)

**Status:** approved design — brainstormed 2026-07-27 (docket sweep iteration 2).
Surface: `skills/ultralearn/scripts/harvest_runs.py` + `merge_ledger.py`. Not the
frozen verification periphery.

## Problem

Two measurement-integrity defects in the sensing loop the distill trusts:

1. **Stale/absent gate evidence (23-run family).** `bundle.json` stores one
   `gateReport`. The scan already prefers the last `mode=="gate"` receipt in
   the session, but a run's real terminus is often not a gate receipt at all:
   approval is a separate `mode=="approve"` JSON the harvester ignores, and a
   re-gate after a context clear lands in a different session file. Observed
   three times in the 2026-07-27 pass: bundles storing a BLOCKED (false-red)
   receipt for runs that actually recovered, were approved, and merged — a
   reader scoring outcomes miscounts recovered false-reds as terminal blocks.
   Related: docket-drain runs harvest `gateReport: null` despite receipts
   existing on disk, and one launch-truncated bundle carried nothing marking
   it partial.
2. **Synthetic contamination.** 6 of the pass's 21 "field" bundles were A/B
   eval cells — temp-dir repos with pinned engine copies — classified
   `origin: foreign`. Runs designed to be easy flow into exactly the field
   statistics the distill trusts (redirect-round canary, clean-first-pass
   rate, version-fix confirmation).

## Design

### Receipt collection (`harvest_runs.py`)

`_gate_report(records)` generalizes to `_gate_evidence(records)` returning
`(reports, terminus)`:

- Collect **every** `mode=="gate"` receipt in transcript order (same anchored
  balanced-JSON scan). Each entry records `{receipt, stamp, ordinal, source}`
  where `stamp` is the receipt's own stamp field, `ordinal` is the receipt's
  position among receipts sharing that stamp (0-based, transcript order), and
  `source` is `"transcript"`.
- Also scan for terminal markers the current code ignores: a balanced JSON
  object with `mode=="approve"` (terminal: approved) or `mode=="teardown"`.
- `terminus` derivation: `"approved"` when an approve marker appears after the
  last gate receipt (or with no receipts at all); else the last receipt's
  `verdict` (`"PASS"` / `"NEEDS_ACK"` / `"BLOCKED"`); else `"unknown"`.
- The legacy pass-2 (`integrationBranch` scan for pre-driver sessions) is
  unchanged and yields a single-entry list with `ordinal` 0 when it matches.

### Disk fallback (the `gateReport: null` drain family)

When the transcript yields zero gate receipts AND the bundle has a `planPath`:
walk up from `planPath` to the repo root (nearest ancestor containing `.git`),
glob `<root>/.claude/ultrapowers/run-*/gate-receipt.json`, load each, order by
file mtime, and mark entries `source: "disk"` (stamp from the receipt or the
`run-<stamp>` dirname). Repo missing, unreadable, or no receipts → fail soft
to today's empty result. Disk receipts feed the same `terminus` derivation
(disk approve evidence does not exist, so a disk-only bundle's terminus comes
from its last receipt's verdict).

### Truncation flag

`truncated: true` on the bundle when `terminus` is `"NEEDS_ACK"`,
`"BLOCKED"`, or `"unknown"` for an engine-kind session — the harvest slice
ended before a terminal disposition, so outcome statistics must not read the
stored receipt as the run's fate. `truncated: false` for `"approved"` and
`"PASS"`.

### Bundle contract (additive, non-breaking)

- `gateReport` — unchanged meaning: the FINAL receipt (last entry's receipt),
  or `null`. Existing readers keep working.
- `gateReports` — new: the full ordered list of
  `{receipt, stamp, ordinal, source}`.
- `terminus` — new: `"approved" | "PASS" | "NEEDS_ACK" | "BLOCKED" | "unknown"`.
- `truncated` — new: boolean per the rule above.

### Synthetic origin

`classify_origin(project_slug, home_slug)` gains one rule, checked BEFORE the
home/foreign split: a slug whose encoded path lies under a system temp root —
prefix match on `-tmp-`, `-private-tmp-`, `-var-folders-`,
`-private-var-folders-` — returns `"synthetic"`. A pure function of existing
inputs: no disk access, works after the cell's temp repo is deleted. (A home
slug never has these prefixes, so precedence is safe.)

`merge_ledger.py`:

- `redact_finding` already fails closed for any non-`home` origin, so
  synthetic findings are abstracted-only automatically; no logic change, but
  the docstring names `synthetic` as a first-class origin value.
- `regenerate_digest` tags synthetic rows `_(synthetic)_` instead of
  `_(abstracted)_`.
- `bundle_lookups`' fail-closed default stays `"foreign"`.

**Documented contract for readers/distill:** field statistics (redirect-round
canary, clean-first-pass rate, version-fix confirmation) exclude
`origin: "synthetic"` rows by construction.

## Error handling

- Disk fallback fails soft (missing repo, unreadable JSON → skip file /
  empty list), never raises out of `build_bundle`.
- Malformed receipts (no verdict) are skipped by the scan exactly as today.

## Testing (`tests/test_harvest_runs.py`, `tests/test_merge_ledger.py`)

- Multi-receipt transcript: `gateReport` is the last receipt; `gateReports`
  holds all, ordered, ordinals per stamp.
- BLOCKED receipt followed by an approve marker → `terminus: "approved"`,
  `truncated: false` — the recovered-false-red case.
- BLOCKED receipt, no approve → `terminus: "BLOCKED"`, `truncated: true`.
- No receipts, planPath set, synthesized repo with two
  `run-*/gate-receipt.json` on disk → both loaded, `source: "disk"`,
  mtime-ordered; repo absent → `gateReport: null`, `truncated: true`.
- Temp-root slugs classify `synthetic`; home and foreign slugs unchanged.
- A synthetic finding merges only when `evidenceAbstracted`; digest tags it
  `_(synthetic)_`.

## Non-goals

- No distill/reader code changes (they consume the documented contract).
- No `ab_runner.py` changes — the slug rule already covers eval cells.
- No re-harvest or migration of the existing bundle cache.
- No change to the redaction guard's fail-closed posture.

## Evidence index

Distill 2026-07-27 (ledger 1088 rows / 118 runs): stale-evidence family 23
runs (3 first-BLOCKED-stored sightings this pass, one shipped to production
the same session); synthetic contamination 6 of 21 field bundles. Ledger is
local (gitignored); run IDs live in rows tagged with those clusters.
