# #511 Attempt Racing v1 — K whole-run races with mechanical selection

**Date:** 2026-09-01
**Ticket:** #511 (map #525 The Verification Frontier, experiment queue position 1)
**Status:** operator-approved design, spec for ultrawrite authoring

## Decision summary (operator, 2026-09-01 sitting)

- **Granularity: K whole runs.** The same committed plan launched as K independent
  `driveOne` runs (distinct runId, port, db-dir, repo-dir — the #454 scenario-2
  launch shape, measured free to N=3 at 0.26× batch wall, zero 429s). No engine
  changes; `fleet/run-engine.mjs` is untouched. Per-task racing (#522's pull)
  remains a future experiment, not this one.
- **Comparator: ordered mechanical rubric.** No comparative judge, no clock mode.
- **Spend: accept K× verification for v1.** In-run review is the comparator's
  input (fix rounds), not waste. Thinning loser verification is a later
  experiment with its own run window.
- **Losers: all PRs open; losers closed unread.** Publish leg untouched
  (#497 caution). Loser evidence bundles persist for ultralearn — a loser is
  data, not waste.
- **K = 3** for the first race.
- **First target:** a boring claims-v1 plan authored with ultrawrite from the
  remaining #524 papercuts. Single-novelty rule: the race is the novelty; the
  plan must not be.
- **Control: operator-only, explicit.** A race starts only when the operator
  asks for one by name ("race this plan"; K optional, default 3). No
  automation: the routing rubric does not offer racing, no risk tier triggers
  it, and an unattended-session authorization must name racing explicitly to
  include it. Automation criteria are a post-measurement question, decided
  after the first races are read — not designed here.

## New machinery

One new file, `fleet/race.mjs`, with two verbs. Plus its test file. Nothing else.

### `race.mjs launch <plan.md> <raceId> --k N [drive-one passthrough flags]`

1. Records the base commit once: `git rev-parse HEAD` in the checkout. Commit
   cleanliness of the plan is NOT re-verified here — `driveOne`'s own #337
   preflight is the enforcement (no second copy of that contract); race.mjs
   merely fails fast if any of the K throws it.
2. Allocates K run identities: run IDs `<raceId>-a`, `<raceId>-b`, …; ports
   base+0/+1/+2…; db-dirs `<base>-a/-b/-c`; **and per-run repo-dirs** — K
   clones of the checkout at the recorded base commit, passed as `--repo-dir`
   (already a drive-one flag). Sharing one repoDir would race the publish
   leg's fetch→rev-parse window across siblings (last-writer-wins
   `FETCH_HEAD`), which is exactly the #497 zone; per-run clones close it.
   Run-ID convention (not mechanism): bare run numbers are allocated `run-N`,
   raceId takes the next free number, and suffixing `-a/-b/-c` onto a fresh
   `run-N` cannot collide with any conventionally named prior run. Never-reuse
   remains the #211 convention, recorded in the race manifest.
3. Writes `race-<raceId>.json` into the evidence dir (raceId-qualified — the
   shared dir clobbers unqualified names, #323): raceId, plan path, base
   commit sha, K, run IDs/ports/db-dirs/repo-dirs, launch timestamp, and the
   **pre-registered dials** (§Measurement) with their baseline values.
   Written BEFORE launch so the dials cannot be chosen after the results are
   visible.
4. Builds the K option objects by importing and reusing `drive-one.mjs`'s
   `parseArgs`/`buildDriveOptions` (so token read, TTL, heartbeat, publish
   constants all come from the one seam), overriding only runId, port, dbDir,
   repoDir — and a `progressLog` prefixed with the runId, so the three
   interleaved drives are attributable on one stderr. Launches the K
   `driveOne` calls concurrently, in-process (one process per race, no
   daemon — the orchestrator-dies-with-the-drive rule holds; each drive
   starts and stops its own orchestrator).

### `race.mjs judge <raceId> [--force]`

Read-only over run artifacts; never calls `gh`. **Terminal** for a run means
its `gate-read-<runId>.json` exists in the evidence dir (green, parked, and
failed drives all write it unconditionally). Judge refuses until all K are
terminal; `--force` is the crashed-launch escape — score the runs that did
report and mark the rest `no-record` (an automatic loss), for the case where
the single race process died mid-drive and no record will ever appear.

Inputs, all pre-existing per-run artifacts:

- `gate-read-<runId>.json` + `gate-read-<runId>.detail.json` (evidence dir) —
  drive status, `spendObservational`, `elapsedMs`, receipts.
- The per-run store, `<dbDir>/fleet.db`, events table — read via
  `status.mjs`'s exported `runEvents`.

Rubric, in order:

1. **Filter: drive status `gate-green` beats everything else.** This already
   subsumes "gate PASS and no blocking critic finding" — a blocking critic
   decision refuses approval before the shim can green the run, so a separate
   critic-findings clause would send the implementer hunting an artifact
   buried in the sandbox-logs tarball for information the status carries.
   Zero greens → the race FAILS: merge nothing; print the per-run verdicts
   and the K PRs for the operator to close; evidence harvests.
2. **Fewest fix rounds:** count of events whose label matches the engine's
   `fix:` worker labels, via `runEvents` over the run's own store.
3. **Fewest tokens:** `spendObservational.ledger` from the gate-read; if the
   ledger read is null for any contestant, fall back to `reported` for all
   contestants (compare like with like) and say so in the scorecard.
4. Ties surviving all stages: lexicographic runId, stated in the output.

Output: winner + full per-run scorecard (a per-run scorecard object keyed by
runId), printed and appended to `race-<raceId>.json` without disturbing the
pre-registered dials.

Judge does not merge and does not close. Adoption is the existing
choreography, driven by the judge's printout: merge the winner's PR
(auto-merge on green as usual), close each loser's PR with a comment naming
the race and the winning run/PR. v1 leaves this to the driver
session/operator; no auto-close code.

## What does NOT change

- `fleet/run-engine.mjs`, `fleet/run-main.mjs`, `fleet/run-waves.mjs`,
  `fleet/drive.mjs` (publish leg included), roles, gate scripts (frozen
  periphery), compiler. Racing is composition, not modification.
- The fold kernel / weave: each run folds internally as today; across runs
  nothing merges — one PR wins whole. Integration branches cannot collide
  (branch = `ultra/integration-<runId>`, runIds distinct by construction).
  Tier-3 selective adoption across attempts is explicitly out of scope
  (#360 future).
- PR history: K−1 closed PRs per race is accepted cost. A loser PR's
  `Closes #N` is harmless — closing (not merging) a PR does not close issues.

## Measurement (pre-registered in race-<raceId>.json at launch)

Baseline: run-44 (66 min, 728k tok, 0 fix rounds) and run-45 (67 min, 588k
tok, 1 fix round, 2 plan-traced defects).

Dials: race wall — computed as launch timestamp → max(per-run `elapsedMs`
end), the derivation fixed here so it is computed the way it was
pre-registered; total tokens across K (expect ≈3×); per-run drive status,
fix rounds, tokens; comparator decisiveness (which rubric stage decided —
never read "zero ties" as rubric quality, name the stage); winner's
post-merge defect surface (anything traced back within the next two
sittings).

**n=1 honesty:** the first race detects catastrophe-or-not. It cannot rank
racing against single-run driving; it can only show the harness works, the
rubric decides, and nothing about K concurrent full runs breaks the substrate
beyond the measured drain shape.

## Testing

`fleet/tests/test_race.mjs` (joins the suite via `tests/test_fleet_suite.py`,
`ALL TESTS PASSED` sentinel; `driveOne` injected via a `deps` seam as in
`test_drive_one.mjs` — two-claims rule: the live probe is the first race
itself):

- Rubric unit tests over fixture gate-read/detail/event sets: green-vs-park,
  fix-round tie-break, token tie-break incl. the null-ledger fallback,
  zero-green failure, lexicographic final tie.
- Manifest round-trip: launch-written `race-<raceId>.json` fields; judge
  refuses on a missing gate-read; `--force` scores partial fields and marks
  `no-record` losses; judge appends verdict without disturbing pre-registered
  dials.
- ID/port/db-dir/repo-dir allocation distinct per run; suffixed IDs match the
  runId grammar; a suffixed ID never equals its own raceId (the decidable
  half of the convention).
- Option-building delegates to `buildDriveOptions` (assert overrides are
  exactly runId/port/dbDir/repoDir/progressLog).

## Risks / cautions carried in

- **#497:** the raced plan must not touch `.github/workflows/`; check before
  authoring the #524 slate. Per-run repo-dir clones (launch step 2) close the
  sibling `FETCH_HEAD` race in the same zone.
- Never reuse a run ID; the race manifest records allocation.
- Do not read a smooth first race as validation (n=1).

## What this retires

Nothing yet — v1 adds no review machinery (the comparator consumes existing
artifacts). The deletion it sets up: if racing survives measurement, thinning
loser verification attacks the 64–73% verification share (its own experiment
window, after #522).

## Spec review (neutral fresh-context review, 2026-09-01 — adopt-or-answer)

First spec under the neutral-review convention (operator decision this
sitting: under-specification/scope/contradiction hunting primary, trims
demoted; supersedes the adversarial trim review). 15 findings, **all 15
adopted**:

1. `gateVerdict === 'PASS'` named a field no green run emits → filter is
   drive status `gate-green`.
2. `report.json` is inside the sandbox-logs tarball, not the evidence dir →
   judge inputs restated as gate-read + detail + per-run store.
3. Zero-green path said "close all K PRs" while the adoption section said "no
   auto-close code" → judge only prints; never calls `gh`.
4. "Advisory findings" had no counted artifact → stage deleted.
5. Spend/fix-round sources named precisely: `spendObservational.ledger`
   (with null fallback rule) and `fix:`-labeled events via `runEvents`.
6. **Shared repoDir races the publish leg's fetch→rev-parse window across
   siblings (the #497 zone)** → per-run repo-dir clones at the recorded base
   commit. The review's most valuable finding.
7. "Parked/failed drive record" undefined; crashed race process would wedge
   the judge forever → terminal = gate-read exists; `--force` escape.
8. Unqualified `race.json` clobbered in the shared evidence dir →
   `race-<raceId>.json`.
9. Plan-cleanliness check would duplicate `driveOne`'s #337 preflight →
   record base sha only, let driveOne enforce.
10. Option-building seam unstated → reuse `parseArgs`/`buildDriveOptions`.
11. Interleaved stderr unattributable → runId-prefixed `progressLog`.
12. Non-collision claim not mechanically decidable → restated as the #211
    convention; test scoped to the decidable half.
13. Race-wall clock source unstated → launch ts + per-run `elapsedMs`.
14. "rowid" vocabulary invited store machinery → "scorecard object keyed by
    runId".
15. Critic-findings filter clause redundant with `gate-green` → folded into
    finding 1's restatement.
