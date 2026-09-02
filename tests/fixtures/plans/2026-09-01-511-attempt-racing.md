# #511 Attempt Racing v1 — fleet/race.mjs

**Grammar:** claims-v1
**Goal:** One new fleet CLI, `fleet/race.mjs`, with two verbs — `launch` (drive one committed plan as K concurrent runs) and `judge` (mechanical winner selection over the runs' existing artifacts).
**Tech Stack:** Node ESM matching `fleet/` conventions; no new npm dependencies.
**Spec:** `docs/superpowers/specs/2026-09-01-511-attempt-racing.md`

## Global Constraints

- Only `fleet/race.mjs` and `fleet/tests/test_race.mjs` are created or modified. No engine file changes: `fleet/run-engine.mjs`, `fleet/run-main.mjs`, `fleet/run-waves.mjs`, `fleet/drive.mjs`, `fleet/drive-one.mjs`, `fleet/roles/*`, and the gate scripts are byte-identical to BASE.
- `race.mjs` never invokes `gh`. The judge's only write is the verdict appended to `race-<raceId>.json`; every other artifact it touches is read-only.
- `fleet/package.json` dependencies are unchanged.
- No token value (OAuth or GitHub) appears on argv or in any printed line; token handling rides `buildDriveOptions`' existing seam untouched.
- `fleet/tests/test_race.mjs` passes with no live drive, no network, and no git remote (`driveOne` and git subprocess calls injected), and ends by printing `ALL TESTS PASSED`.

**Acceptance:** suite — the committed suite is the verification.

Parallelization note: intentionally narrow (the escape valve) — the judge consumes the launch task's manifest reader and modifies the file it creates, so the plan is two sequential tasks. No contract-first move survives the good-engineer gate at this size.

### Task 1: The launch verb

**Type:** implementation
**Review:** adversarial

**Files:**
- Create: `fleet/race.mjs`
- Test: `fleet/tests/test_race.mjs`

**Claim:** launch the same committed plan as K concurrent runs (distinct runIds, ports, db-dirs — the #454 launch shape) (quoted from #511)
Machine: `race.mjs launch <plan> <raceId> --k 3` records the base commit and a raceId-qualified manifest, then invokes `driveOne` 3 times concurrently, each call with a distinct runId, port, dbDir, and repoDir.

**Authorized-by:** #511; spec `docs/superpowers/specs/2026-09-01-511-attempt-racing.md` §New machinery / launch

**Interfaces:**
- Consumes: `parseArgs(argv)` (from `fleet/drive-one.mjs`)
- Consumes: `buildDriveOptions(parsed, deps)` (from `fleet/drive-one.mjs`)
- Consumes: `driveOne(opts)` (from `fleet/drive.mjs`; injected in tests)
- Produces: `launchRace(argv, deps) -> Promise<{manifest, results}>`
- Produces: `readRaceManifest(evidenceDir, raceId) -> manifest`
- Produces: the manifest file `race-<raceId>.json`

**Context:** Manifest schema (the shared contract; the judge task carries the same literal): `race-<raceId>.json` in the resolved evidence dir holds `raceId`, `planPath`, `baseCommit`, `k`, `launchedAt`, `runs` (array of `{runId, port, dbDir, repoDir}`), and `dials` (the pre-registered measurement block from the spec §Measurement, values copied at launch). Allocation: run IDs are `<raceId>-a`, `-b`, `-c`; ports base+0/+1/+2; db-dirs `<base>-a/-b/-c`; repo-dirs are K fresh clones of the launch checkout, each checked out at the recorded base commit — `driveOne` resolves its base as HEAD of its own repoDir, and sharing one repoDir would race the publish leg's FETCH_HEAD window across siblings (spec finding 6). The manifest is written before any `driveOne` call so dials cannot be chosen after results are visible. Build each run's options via `parseArgs`/`buildDriveOptions` (never hand-assemble — the token read, TTL, heartbeat and publish constants live behind that seam), overriding exactly runId, port, dbDir, repoDir, and a runId-prefixed `progressLog`. Plan cleanliness is enforced by `driveOne`'s own preflight; `launchRace` only fails fast if a drive throws it. One process per race, drives in-process via Promise.all — no daemon. Follow `fleet/tests/test_drive_one.mjs`'s `deps`-injection pattern; git subprocess calls (rev-parse, clone, checkout) go through an injectable runner.

**Proof:**
- Test: `fleet/tests/test_race.mjs`
- Legs: with a stub `driveOne` and stub git runner, `launchRace` (a) writes `race-<raceId>.json` whose `baseCommit` equals the stub rev-parse output and whose `dials` block is present; (b) the manifest file exists at the moment of the first stub `driveOne` call (pre-registration); (c) the stub is called exactly K times and the calls overlap in flight (stubs resolve only after all K have started); (d) across the K option objects, runId, port, dbDir, and repoDir are pairwise distinct, runIds are `<raceId>-a/-b/-c`, and each `repoDir` was produced by the stub clone runner at `baseCommit`; (e) options are built through the real `buildDriveOptions` (assert a drive-one default such as `prBase` survives untouched); (f) a suffixed runId never equals its own raceId; (g) a `driveOne` rejection propagates as a fast failure; (h) invoking the CLI entry with argv `launch <plan> <raceId> --k 3` (same injected deps) reaches `launchRace` with k=3 and that raceId — the flag path, not just the direct call.

**Stale-if:**
- path-exists: `fleet/race.mjs`
- issue-closed: #511

### Task 2: The judge verb

**Type:** implementation
**Review:** adversarial

**Files:**
- Modify: `fleet/race.mjs`
- Test: `fleet/tests/test_race.mjs`

**Claim:** After all the attempts finish, I ask for the verdict and see the winning run named, with a per-run scorecard and the rule that decided it. (elicited)
Machine: `race.mjs judge <raceId>` refuses while any run's `gate-read-<runId>.json` is missing unless `--force` (which scores the runs that reported and marks the rest `no-record`, an automatic loss); over complete artifacts it prints the winner selected by the ordered rubric — drive status `gate-green` filter, then fewest `fix:`-labeled events, then fewest `spendObservational.ledger` tokens (falling back to `reported` tokens for all contestants, flagged in the scorecard, when any contestant's ledger is null), then lexicographic runId — and a scorecard keyed by runId naming the deciding stage, appending that verdict to `race-<raceId>.json` without altering the pre-registered `dials`.

**Authorized-by:** #511; spec `docs/superpowers/specs/2026-09-01-511-attempt-racing.md` §New machinery / judge

**Interfaces:**
- Consumes: `readRaceManifest(evidenceDir, raceId) -> manifest`
- Consumes: `runEvents(storeJson, runId)` (from `fleet/status.mjs`)
- Produces: `judgeRace(argv, deps) -> {winner, decidingStage, scorecard}`

**Context:** Manifest schema (same literal as the launch task): `race-<raceId>.json` holds `raceId`, `planPath`, `baseCommit`, `k`, `launchedAt`, `runs` (`{runId, port, dbDir, repoDir}`), `dials`; the judge appends a `verdict` object `{winner, decidingStage, scorecard}` with `scorecard` keyed by runId. Per-run inputs, all pre-existing: `gate-read-<runId>.json` and `gate-read-<runId>.detail.json` in the evidence dir (drive status, `spendObservational`, `elapsedMs`); the run's own store at `<dbDir>/fleet.db`, events read via `status.mjs`'s exported `runEvents` (sqlite access behind an injectable reader, as `status.mjs` itself does). Terminal means the gate-read file exists — green, parked, and failed drives all write it. Fix rounds = count of events whose `label` matches the engine's `fix:` prefix. Tokens = `spendObservational.ledger`; if null for any contestant, fall back to `reported` for all contestants and note it in the scorecard. Zero `gate-green` runs = race FAILED: merge nothing, print per-run verdicts and the K PRs for the operator to close. The judge never calls `gh` and never merges or closes; adoption is the operator's, driven by the printout. Do not read a decisive rubric as rubric quality — the scorecard names which stage decided precisely so n=1 is not over-read.

**Proof:**
- Test: `fleet/tests/test_race.mjs`
- Legs: over fixture manifests, gate-reads, and store JSON, `judgeRace` (a) refuses when any run's gate-read is missing, and with `--force` scores reporters and marks absentees `no-record` losses; (b) picks the sole `gate-green` run over parked/failed ones with `decidingStage` = the filter; (c) among two greens picks fewer `fix:` events with `decidingStage` naming the fix-round stage; (d) among fix-round ties picks fewer `ledger` tokens with `decidingStage` naming the token stage, and with one null ledger compares `reported` for all and flags the fallback in the scorecard; (e) among full ties picks lexicographic-least runId with `decidingStage` naming the tie-break; (f) with zero greens reports FAILED, names no winner, and lists the K PR branches; (g) the appended `verdict` leaves every pre-registered `dials` value byte-identical; (h) the scorecard is keyed by runId and each entry names its drive status, fix rounds, and tokens; (i) invoking the CLI entry with argv `judge <raceId>` (same injected deps) prints the winner runId, the deciding stage, and every runId's scorecard line on stdout — and the same CLI entry, over fixtures with one gate-read missing and no `--force`, exits non-zero with a refusal naming the missing run.

**Stale-if:**
- path-absent: `fleet/race.mjs`
- issue-closed: #511