# #511 Attempt Racing — the wide plan (nine contracts, two waves)

**Grammar:** claims-v1

**Goal:** The same race tool the run-47 plan built as a two-task chain, authored swarm-native: seven independent contracts in one wave — each its own module with its own tests, all built against one manifest-schema literal carried in every body — then the launch and judge verbs side by side in a second wave. Same operator claims, same operator-facing behaviour; the shape is the experiment. Controls: run-47 (79 min, 1 fix round, 240k tokens) and race-48's three arms (53/68/88 min, 0/1/2 fix rounds).

**Tech Stack:** Node ESM matching `fleet/` conventions; no new npm dependencies; `fleet/package.json` unchanged.

**Spec:** `docs/superpowers/specs/2026-09-01-511-attempt-racing.md` (its §Measurement dials are copied verbatim into Task 1's Context so no worker depends on reading the spec — #534)

## Global Constraints

- Only the nine `fleet/race*.mjs` modules and their `fleet/tests/test_race_*.mjs` files are created. No engine file changes: `fleet/run-engine.mjs`, `fleet/run-main.mjs`, `fleet/run-waves.mjs`, `fleet/run-worker.mjs`, `fleet/drive.mjs`, `fleet/drive-one.mjs`, `fleet/provision.mjs`, `fleet/status.mjs`, `fleet/roles/*` and the gate scripts are byte-identical to BASE.
- No module under `fleet/race*.mjs` ever invokes `gh`, merges, or closes anything; the judge's only write is the verdict appended to `race-<raceId>.json`.
- No token value (OAuth or GitHub) appears on argv or in any printed line; drive options are built only through `drive-one.mjs`'s `parseArgs`/`buildDriveOptions` seam.
- Every `fleet/tests/test_race_*.mjs` runs with no live drive, no network, no git remote, no sqlite3 binary and no sibling module that its own task did not create (`driveOne`, git subprocesses, the sqlite reader and sibling verbs are injected), finishes under the suite's 120 s per-file cap, and ends by printing `ALL TESTS PASSED`.
- The manifest schema is one literal, identical in every task body below: `race-<raceId>.json` holds `raceId`, `planPath`, `baseCommit`, `k`, `launchedAt`, `runs` (array of `{runId, port, dbDir, repoDir}`), `dials`, and — only after judging — `verdict` (`{winner, decidingStage, scorecard}`, `scorecard` keyed by runId).

**Acceptance:** suite — the committed suite is the verification.

**Parallelization rationale:** the run-47 plan invoked the escape valve ("no contract-first move survives at this size") and ran 79 minutes one worker at a time; race-48 ran the same chain three times at 53–88. Here independence is taken from the contracts: each wave-1 task produces a small module whose consumers are named only in wave 2, and the two verbs share nothing but the schema literal and the wave-1 exports. The CLI dispatches to the verbs by module name at run time (a Context literal, not a `Consumes:`), so it does not wait on them.

### Task 1: The manifest and the dials

**Type:** implementation

**Files:**
- Create: `fleet/race-manifest.mjs`
- Test: `fleet/tests/test_race_manifest.mjs`

**Claim:** The race's dials and its runs are written down in one file I can read afterwards. (elicited)
Machine: `writeRaceManifest(evidenceDir, manifest)` writes `race-<raceId>.json` carrying every schema field and the frozen `DIALS` block byte-for-byte; `readRaceManifest(evidenceDir, raceId)` returns it; `assertManifest(m)` throws naming the first missing or mis-typed field and passes a complete one; `appendVerdict(evidenceDir, raceId, verdict)` rewrites the file with a `verdict` key and leaves every pre-existing key, `dials` included, byte-identical; `writeRaceManifest` is synchronous and returns only once the file is on disk.

**Authorized-by:** #511 (closed 2026-09-01 with v1 shipped; this plan is the shape experiment authorized in the same sitting); spec `docs/superpowers/specs/2026-09-01-511-attempt-racing.md` §Measurement

**Interfaces:**
- Consumes: none
- Produces: `DIALS` (frozen object)
- Produces: `manifestPath(evidenceDir, raceId) -> string`
- Produces: `writeRaceManifest(evidenceDir, manifest) -> string`
- Produces: `readRaceManifest(evidenceDir, raceId) -> manifest`
- Produces: `assertManifest(manifest) -> manifest`
- Produces: `appendVerdict(evidenceDir, raceId, verdict) -> manifest`

**Context:** The schema literal: `race-<raceId>.json` holds `raceId`, `planPath`, `baseCommit`, `k`, `launchedAt`, `runs` (array of `{runId, port, dbDir, repoDir}`), `dials`, and after judging `verdict` (`{winner, decidingStage, scorecard}`, `scorecard` keyed by runId). The dials are pre-registered — written before any result is visible so they cannot be chosen to fit what came back — and their values are these, copied from the spec's §Measurement and recalibrated on 2026-09-01 to deduplicated output tokens: `baseline`: run-44 `{wallMinutes: 79, tokens: 287692, fixRounds: 0}`, run-45 `{wallMinutes: 62, tokens: 232635, fixRounds: 1, planTracedDefects: 2}`, run-47 `{wallMinutes: 79, tokens: 239564, fixRounds: 1, planTracedDefects: 1}`; `raceWall`: "manifest launchedAt -> max over runs of the per-run elapsedMs end"; `totalTokens`: "sum of per-run tokens across the K runs (expect about K x a single run)"; `perRun`: "per-run drive status, fix rounds, tokens"; `comparatorDecisiveness`: "which rubric stage decided — name the stage; never read 'zero ties' as rubric quality"; `winnerDefectSurface`: "the winner's post-merge defect surface — anything traced back within the next two sittings"; `rubric`: `['gate-green', 'fix-rounds', 'tokens', 'runid-lexicographic']`. That `rubric` array is the single source the comparator task reads its stage names from (Task 5 names the same four strings). Files land in the evidence dir the drive uses (`/home/exedev/fleet-evidence` by default); `evidenceDir` is always a parameter, never a constant, so tests use a temp dir. Sibling tasks in this wave create their own modules; none of them import this one — only the wave-2 verbs do.

**Proof:**
- Test: `fleet/tests/test_race_manifest.mjs`
- Legs: (a) `writeRaceManifest` then `readRaceManifest` round-trips a complete manifest deep-equal, and the on-disk `dials` text equals `JSON.stringify(DIALS)` re-serialized; (b) `DIALS` is frozen (assignment throws in strict mode) and carries `baseline['run-47'].tokens === 239564` and `rubric` deep-equal to the four strings above; (c) `assertManifest` throws naming `runs` for a manifest without it, naming `runs[1].port` for a run entry with a string port, and returns the manifest for a complete one; (d) `appendVerdict` on a manifest file leaves every pre-existing key byte-identical — for each of `raceId`, `planPath`, `baseCommit`, `k`, `launchedAt`, `runs`, `dials` the serialized value before equals the serialized value after — and adds exactly one new key, `verdict`, with `winner`, `decidingStage`, `scorecard`; (g) `writeRaceManifest` is synchronous and the file exists with the full content at the moment it returns (the test reads it back on the very next statement, and a second `writeRaceManifest` call with a different `launchedAt` observably replaces it); (e) `manifestPath` is `<evidenceDir>/race-<raceId>.json`; (f) `readRaceManifest` on a missing file throws an error naming the path.

**Stale-if:**
- path-exists: `fleet/race-manifest.mjs`

### Task 2: Run allocation

**Type:** implementation

**Files:**
- Create: `fleet/race-allocate.mjs`
- Test: `fleet/tests/test_race_allocate.mjs`

**Claim:** Each attempt gets its own name, port and folders, so three attempts never trip over each other. (elicited)
Machine: `allocateRuns({raceId, k, port, dbDir, raceDir})` returns `k` entries whose `runId` are `<raceId>-a`, `-b`, `-c`, …, `port` are `port+0..k-1`, `dbDir` are `<dbDir>-a/-b/-c`, and `repoDir` are `<raceDir>/<runId>`; every field is pairwise distinct across entries and no `runId` equals `raceId`; `k` outside `1..26` throws.

**Authorized-by:** #511; spec §New machinery / launch

**Interfaces:**
- Consumes: none
- Produces: `SUFFIXES` (`'a'..'z'`)
- Produces: `DEFAULT_K` (3)
- Produces: `MAX_K` (26)
- Produces: `runIdFor(raceId, i) -> string`
- Produces: `allocateRuns({raceId, k, port, dbDir, raceDir}) -> Array<{runId, port, dbDir, repoDir}>`

**Context:** The schema literal (the entries this module produces are the manifest's `runs`): `race-<raceId>.json` holds `raceId`, `planPath`, `baseCommit`, `k`, `launchedAt`, `runs` (array of `{runId, port, dbDir, repoDir}`), `dials`, and after judging `verdict`. Per-run repo-dirs are not a nicety: `driveOne` resolves its base as HEAD of its own `repoDir`, and siblings sharing one would race the publish leg's `FETCH_HEAD` window (#497). Run ids ride the #211 grammar (`[A-Za-z0-9][A-Za-z0-9-]*`, unique per account lifetime) — a suffixed id is a new id. `port` is a number; the drive-one default is 8180 and concurrent drains take distinct ports and db-dirs (RUNBOOK §Live W1 run). Pure function; no filesystem, no git.

**Proof:**
- Test: `fleet/tests/test_race_allocate.mjs`
- Legs: (a) `allocateRuns({raceId:'race-9', k:3, port:8180, dbDir:'/tmp/db', raceDir:'/tmp/r'})` deep-equals the three entries with ids `race-9-a/b/c`, ports 8180/8181/8182, db-dirs `/tmp/db-a/-b/-c`, repo-dirs `/tmp/r/race-9-a/-b/-c`; (b) across the entries every one of the four fields is pairwise distinct, and no `runId` equals `'race-9'`; (c) `k: 1` yields one entry and `k: 26` yields 26 with `runId` `race-9-z` last; (d) `k: 0`, `k: 27`, `k: 2.5` and `k: '3'` each throw an error containing `--k`; (e) `runIdFor('race-9', 0) === 'race-9-a'` and `runIdFor('race-9', 25) === 'race-9-z'`; (f) `DEFAULT_K === 3` and `MAX_K === 26`.

**Stale-if:**
- path-exists: `fleet/race-allocate.mjs`

### Task 3: The clone seam

**Type:** implementation
**Review:** adversarial

**Files:**
- Create: `fleet/race-clone.mjs`
- Test: `fleet/tests/test_race_clone.mjs`

**Claim:** Every attempt builds from the exact commit I raced, and can publish to GitHub like a normal run. (elicited)
Machine: `cloneAtCommit({git, sourceRepo, repoDir, baseCommit, originUrl})` runs, through the injected `git`, a clone of `sourceRepo` into `repoDir`, a detached checkout of `baseCommit`, and `remote set-url origin <originUrl>`, in that order; `originUrlOf(git, repoDir)` returns the launch checkout's `origin` URL and throws — before any clone — when it is empty or is a filesystem path; `baseCommitOf(git, repoDir)` returns the 40-hex HEAD; `resolvePlan(repoDir, planPath)` returns the repo-relative plan path and throws for a path outside the repo.

**Authorized-by:** #511; spec finding 6 (per-run clones); the run-47 review and the race-48-c critic finding (a local clone inherits a filesystem `origin` and the publish leg has nowhere to push)

**Interfaces:**
- Consumes: none
- Produces: `gitRunner(args, {cwd}) -> Promise<string>` (the default; `execFile('git', …)`)
- Produces: `baseCommitOf(git, repoDir) -> Promise<string>`
- Produces: `originUrlOf(git, repoDir) -> Promise<string>`
- Produces: `cloneAtCommit({git, sourceRepo, repoDir, baseCommit, originUrl}) -> Promise<void>`
- Produces: `resolvePlan(repoDir, planPath) -> string`

**Context:** The schema literal (this module fills `baseCommit` and each run's `repoDir`): `race-<raceId>.json` holds `raceId`, `planPath`, `baseCommit`, `k`, `launchedAt`, `runs` (array of `{runId, port, dbDir, repoDir}`), `dials`, and after judging `verdict`. The defect this task exists to make inexpressible, found twice on 2026-09-01: `git clone` of a local path sets the clone's `remote.origin.url` to that path, so a drive's publish leg (`git push origin …` from `repoDir`, then `gh pr create` with cwd `repoDir`) pushes nowhere real. `driveOne` documents that `origin` is the orchestrator clone's https remote. So: read the launch checkout's origin first, refuse an empty one or one that is itself a filesystem path (`/`-rooted, or `file://`), and re-point every clone at it. `driveOne` resolves a relative `planPath` against each run's own `repoDir` and refuses one outside the repo; `resolvePlan` mirrors that rule so the launcher fails before any clone rather than after the raceId is burned. All git goes through one injectable runner so the tests need no repository: they assert the recorded argv sequence. Sibling tasks in this wave create their own modules and do not import this one.

**Proof:**
- Test: `fleet/tests/test_race_clone.mjs`
- Legs: with a recording git stub, (a) `cloneAtCommit` records exactly three calls in order — a `clone` whose args contain `sourceRepo` and `repoDir`, a `checkout --detach <baseCommit>` with cwd `repoDir`, a `remote set-url origin <originUrl>` with cwd `repoDir` — and no call after a failing clone; (b) `originUrlOf` returns the stub's trimmed `https://github.com/x/y.git`; (c) `originUrlOf` throws, naming `origin`, for an empty stdout, for `/home/exedev/repo`, and for `file:///home/exedev/repo`, and the stub records no clone call; (d) `baseCommitOf` returns the stub's 40-hex trimmed output and throws on a non-hex reply; (e) `resolvePlan('/r', 'docs/plan.md') === 'docs/plan.md'`, `resolvePlan('/r', '/r/docs/plan.md') === 'docs/plan.md'`, and `resolvePlan('/r', '../x.md')` and `resolvePlan('/r', '/elsewhere/x.md')` each throw naming the repo-path guard; (f) `gitRunner` is exported and, called with `['--version']`, resolves to a string starting `git version` (the one live call, on the git the suite already needs).

**Stale-if:**
- path-exists: `fleet/race-clone.mjs`

### Task 4: The CLI and its argument grammar

**Type:** implementation

**Files:**
- Create: `fleet/race.mjs`
- Test: `fleet/tests/test_race_cli.mjs`

**Claim:** One command, race.mjs, with the two verbs launch and judge. (elicited)
Machine: `node fleet/race.mjs launch <plan> <raceId> [--k N] [--race-dir DIR] [drive-one flags]` calls the launch verb and `node fleet/race.mjs judge <raceId> [--force] [--evidence-dir DIR]` calls the judge verb, each verb resolved at run time through `resolveVerb(name)` — whose default imports the module named in the exported `VERB_MODULES` literal (`{launch: './race-launch.mjs', judge: './race-judge.mjs'}`) and returns its `launchRace`/`judgeRace` export — unless the verb is injected; `parseLaunchArgs(argv)` returns drive-one's parsed options plus `raceId`, `k` (default 3, integer 1..26, else a refusal naming `--k`) and `raceDir` (default `<os.tmpdir()>/fleet-race-<raceId>`); `parseJudgeArgs(argv)` returns `{raceId, evidenceDir, force}` with `evidenceDir` defaulting to drive-one's `DEFAULTS.evidenceDir`; an unknown verb, a missing verb, or a drive-one refusal prints the usage line and exits non-zero.

**Authorized-by:** #511; spec §New machinery (launch, judge)

**Interfaces:**
- Consumes: `parseArgs(argv)` (from `fleet/drive-one.mjs`)
- Consumes: `DEFAULTS` (from `fleet/drive-one.mjs`)
- Produces: `usage() -> string`
- Produces: `parseLaunchArgs(argv) -> {…parseArgs(rest), raceId, k, raceDir}`
- Produces: `parseJudgeArgs(argv) -> {raceId, evidenceDir, force}`
- Produces: `VERB_MODULES` (frozen `{launch: './race-launch.mjs', judge: './race-judge.mjs'}`)
- Produces: `resolveVerb(name, importer?) -> Promise<function>`
- Produces: `main(argv, {launch, judge, resolveVerb, stdout, stderr}) -> Promise<number>`

**Context:** The schema literal (the judge verb this CLI dispatches to appends `verdict` to it): `race-<raceId>.json` holds `raceId`, `planPath`, `baseCommit`, `k`, `launchedAt`, `runs` (array of `{runId, port, dbDir, repoDir}`), `dials`, and after judging `verdict`. Everything that is not `--k` or `--race-dir` belongs to drive-one and is parsed by its `parseArgs` (which rejects unknown flags with its own usage line and checks the runId grammar, #211) — the raceId rides in as the runId positional. The two verb modules are wave-2 siblings that do not exist while this task is built: `main` takes them as injected deps and only falls back to `resolveVerb(name)` when none are injected; `resolveVerb(name, importer = (spec) => import(spec))` looks the module up in `VERB_MODULES` and returns `(await importer(spec)).launchRace` or `.judgeRace`, so the tests prove the wiring with a recording `importer` and never load the real modules. Module names are a literal shared with Tasks 8 and 9: `race-launch.mjs` exports `launchRace(argv, deps)`, `race-judge.mjs` exports `judgeRace(argv, deps)`. `main` returns the exit code rather than calling `process.exit` itself except at the script entry (so tests can call it); the entry guards on `import.meta.url` matching `process.argv[1]`.

**Proof:**
- Test: `fleet/tests/test_race_cli.mjs`
- Legs: (a) `parseLaunchArgs(['p.md','race-9','--k','3','--port','8190'])` yields `raceId:'race-9'`, `k:3`, `port:8190`, `raceDir === path.join(os.tmpdir(), 'fleet-race-race-9')`, and `--race-dir /x` overrides it; (b) `--k` absent gives `k:3`; `--k 1` and `--k 26` are accepted as 1 and 26; `--k 0`, `--k 27`, `--k x`, and `--k` with no value each throw an error containing `--k` and the usage line; (c) `parseLaunchArgs(['p.md','race-9','--bogus'])` throws drive-one's unknown-flag refusal (the text contains `unknown flag`); (d) `parseJudgeArgs(['race-9'])` yields `force:false` and `evidenceDir === DEFAULTS.evidenceDir`; `['race-9','--force','--evidence-dir','/e']` yields `force:true`, `evidenceDir:'/e'`; a missing raceId and a second positional each throw naming `judge`; (e) `main(['launch','p.md','race-9','--k','2'], {launch: stub, judge: stub2})` calls `launch` once with those argv and never `judge`, and returns 0; `main(['judge','race-9'], …)` calls `judge` once and returns 0; (f) `main(['fly'])` and `main([])` write the usage line to the injected `stderr` and return 1 without calling either stub; a stub that throws makes `main` write the error message to `stderr` and return 1; (g) `VERB_MODULES` deep-equals `{launch: './race-launch.mjs', judge: './race-judge.mjs'}` and is frozen; `main(['launch','p.md','race-9'], {resolveVerb: stub})` with no `launch` injected calls the stub exactly once with `'launch'` and invokes the function it returns with the launch argv, and likewise `judge`; `resolveVerb('launch', importer)` with a recording `importer` calls it once with `'./race-launch.mjs'` and returns that fake module's `launchRace` export, `resolveVerb('judge', importer)` returns `judgeRace`, and `resolveVerb('fly', importer)` rejects without calling `importer`; (h) as a process, `spawnSync(process.execPath, ['fleet/race.mjs', 'fly'])` exits 1 with the usage line on stderr, and `spawnSync(process.execPath, ['fleet/race.mjs'])` exits 1 — neither path reaches the resolver, so no sibling module is loaded; (i) no test in the file statically imports `./race-launch.mjs` or `./race-judge.mjs`.

**Stale-if:**
- path-exists: `fleet/race.mjs`

### Task 5: The comparator

**Type:** implementation
**Review:** adversarial

**Files:**
- Create: `fleet/race-rubric.mjs`
- Test: `fleet/tests/test_race_rubric.mjs`

**Claim:** The winner is picked by the rule we agreed: passed the gate, then fewest fix rounds, then fewest tokens, then the name. (elicited)
Machine: `selectWinner(entries)` over entries shaped `{runId, gateGreen, fixRounds, tokens}` returns `{winner, decidingStage}` where the stages, applied in order, are the four strings of `STAGES` — `'gate-green'` (drop entries not green), `'fix-rounds'` (fewest, `null` loses), `'tokens'` (fewest, `null` loses), `'runid-lexicographic'` — and `decidingStage` names the first stage that left exactly one entry; with zero green entries it returns `{winner: null, decidingStage: 'gate-green'}`; `tokenBasis(entries)` returns `'ledger'` when every entry has a numeric `ledger`, else `'reported'` with `fallback: true`.

**Authorized-by:** #511; spec §New machinery / judge (the ordered rubric)

**Interfaces:**
- Consumes: none
- Produces: `STAGES` (frozen `['gate-green', 'fix-rounds', 'tokens', 'runid-lexicographic']`)
- Produces: `selectWinner(entries) -> {winner: string|null, decidingStage: string}`
- Produces: `tokenBasis(entries) -> {basis: 'ledger'|'reported', fallback: boolean}`
- Produces: `worstIfNull(value) -> number`

**Context:** The schema literal (the verdict this comparator decides is what the manifest gains): `race-<raceId>.json` holds `raceId`, `planPath`, `baseCommit`, `k`, `launchedAt`, `runs` (array of `{runId, port, dbDir, repoDir}`), `dials`, and after judging `verdict` (`{winner, decidingStage, scorecard}`). `STAGES` must equal the `rubric` array the manifest's dials carry (`['gate-green', 'fix-rounds', 'tokens', 'runid-lexicographic']`, Task 1's literal) — the judge verb asserts the two agree at judge time, so this module exports the strings once and never re-types them. Pure: no filesystem, no manifest reading. `worstIfNull` maps `null`/`undefined`/non-number to `Infinity` so an unknown count never wins a comparison it never entered. Do not read a decisive rubric as rubric quality; naming the stage is the whole point.

**Proof:**
- Test: `fleet/tests/test_race_rubric.mjs`
- Legs: (a) one green among parked/failed entries wins with `decidingStage: 'gate-green'`; (b) two greens with fix rounds 2 and 0 → the 0 wins, `decidingStage: 'fix-rounds'`; (c) fix-round tie, tokens 500000 vs 400000 → the 400000 wins, `decidingStage: 'tokens'`; (d) full tie → lexicographic-least `runId` wins, `decidingStage: 'runid-lexicographic'`; (e) zero greens → `{winner: null, decidingStage: 'gate-green'}`; (f) a green entry with `fixRounds: null` loses to a green with `fixRounds: 3`, and one with `tokens: null` loses to one with `tokens: 900000`; (g) `tokenBasis` returns `{basis:'ledger', fallback:false}` when all ledgers are numbers and `{basis:'reported', fallback:true}` when any ledger is null; (h) `STAGES` deep-equals the four strings and is frozen; (i) `selectWinner([])` returns `{winner: null, decidingStage: 'gate-green'}`.

**Stale-if:**
- path-exists: `fleet/race-rubric.mjs`

### Task 6: The evidence readers

**Type:** implementation
**Review:** adversarial

**Files:**
- Create: `fleet/race-evidence.mjs`
- Test: `fleet/tests/test_race_evidence.mjs`

**Claim:** The judge reads each attempt's real record, its gate result and how many fix rounds it took, and says when a record is missing. (elicited)
Machine: `readRunRecord(evidenceDir, runId)` returns `{read, detail}` from `gate-read-<runId>.json` and `gate-read-<runId>.detail.json`, each `null` when its file is missing or unparseable, plus `missing: string[]` naming which; `countFixRounds(storeJson, runId)` counts the `worker:start` rows whose `label` starts `fix:` for that run only, and returns `null` for a `null` store; `sqliteStoreJson(dbDir, exec)` runs `sqlite3 <dbDir>/fleet.db 'SELECT store FROM tinybase LIMIT 1'` through the injected `exec` and returns `null` — never throws — on a non-zero exit or unparseable output.

**Authorized-by:** #511; spec §New machinery / judge (per-run inputs); the run-47 critic's minor (an unguarded store read aborts the verdict)

**Interfaces:**
- Consumes: `runEvents(storeJson, runId)` (from `fleet/status.mjs`)
- Produces: `gateReadPath(evidenceDir, runId) -> string`
- Produces: `gateDetailPath(evidenceDir, runId) -> string`
- Produces: `readRunRecord(evidenceDir, runId) -> {read, detail, missing}`
- Produces: `sqliteStoreJson(dbDir, exec) -> Promise<object|null>`
- Produces: `countFixRounds(storeJson, runId, events?) -> number|null`
- Produces: `ledgerOf(read) -> number|null`
- Produces: `reportedOf(read) -> number|null`
- Produces: `driveStatusOf(detail) -> string|null`

**Context:** The schema literal (each `runs[i].runId` and `dbDir` here is where a record lives): `race-<raceId>.json` holds `raceId`, `planPath`, `baseCommit`, `k`, `launchedAt`, `runs` (array of `{runId, port, dbDir, repoDir}`), `dials`, and after judging `verdict`. Per-run inputs, all pre-existing and written by `driveOne`: `gate-read-<runId>.json` (`spendObservational.{reported, ledger}` — output tokens) and `gate-read-<runId>.detail.json` (`status` — `gate-green`|`parked`|`failed` — and `elapsedMs`, `pullRequest`) in the evidence dir; the run's own store at `<dbDir>/fleet.db`, whose single `store` cell is MergeableStore JSON that `status.mjs`'s exported `runEvents(storeJson, runId)` unwraps into rows `{kind, label, …}`. A fix round is one `fix:<task>:<n>` label; the engine emits a `worker:start` and a `worker:end` row per label, so count starts only (race-48's judge counted both and reported double). The per-run db-dirs default under `/tmp`, which is reapable; an unreadable store must degrade to `null` (which the comparator treats as a loss), never abort the verdict for the runs whose durable gate-reads are intact. The sqlite call goes through an injectable `exec` so no test needs the binary. Terminal means the gate-read exists — green, parked and failed drives all write it.

**Proof:**
- Test: `fleet/tests/test_race_evidence.mjs`
- Legs: (a) with both files present in a temp evidence dir, `readRunRecord` returns the parsed objects and `missing: []`; with the detail file absent, `detail: null` and `missing: ['gate-read-run-1.detail.json']`; with a corrupt read file, `read: null` and `missing` naming it; (b) `countFixRounds` over a store JSON fixture (built in the MergeableStore `[value, hlc, hash]` shape the way `test_status.mjs` builds one) holding `fix:1:1` start+end, `fix:2:1` start+end and `impl:1` rows for `run-1`, plus a `fix:9:1` row for `run-2`, returns 2 for `run-1` and 1 for `run-2`; (c) `countFixRounds(null, 'run-1') === null`; (d) `sqliteStoreJson` with an exec stub returning `{code: 0, stdout: '<json>'}` returns the parsed object; with `{code: 1}` returns `null`; with `{code: 0, stdout: 'not json'}` returns `null`; and the stub records argv `['sqlite3', '<dbDir>/fleet.db', "SELECT store FROM tinybase LIMIT 1"]`; (e) `ledgerOf`/`reportedOf` return the numbers from a gate-read and `null` when absent or non-numeric; `driveStatusOf` returns `detail.status` and `null` for a null detail; (f) the paths are `<evidenceDir>/gate-read-<runId>.json` and `<evidenceDir>/gate-read-<runId>.detail.json`.

**Stale-if:**
- path-exists: `fleet/race-evidence.mjs`

### Task 7: The printout

**Type:** implementation

**Files:**
- Create: `fleet/race-report.mjs`
- Test: `fleet/tests/test_race_report.mjs`

**Claim:** The verdict prints one line per attempt that I can read without opening anything else. (elicited)
Machine: `verdictLines({raceId, winner, decidingStage, scorecard, verdictPath})` returns the printout as an array of strings: a first line `race <raceId>: winner <runId> — decided by <stage>` (or `race <raceId>: FAILED — no attempt reached gate-green` when `winner` is null), then one `scorecardLine(entry)` per scorecard entry in runId order reading `  <runId> status=<status> fix-rounds=<n|null> tokens=<n|null> (<basis>[, ledger-fallback]) pr=#<n> <branch> verdict=<winner|lost|no-record>`, then, when there is no winner, one `prLine` per entry naming its PR for the operator to close, then `verdict: <verdictPath>`.

**Authorized-by:** #511; spec §New machinery / judge (the scorecard names the deciding stage precisely so n=1 is not over-read)

**Interfaces:**
- Consumes: none
- Produces: `scorecardLine(entry) -> string`
- Produces: `prLine(entry) -> string`
- Produces: `verdictLines(verdict) -> string[]`

**Context:** The schema literal (the `verdict` this module renders is the manifest's last key): `race-<raceId>.json` holds `raceId`, `planPath`, `baseCommit`, `k`, `launchedAt`, `runs` (array of `{runId, port, dbDir, repoDir}`), `dials`, and after judging `verdict` (`{winner, decidingStage, scorecard}`, `scorecard` keyed by runId). A scorecard entry is the literal `{runId, status, gateGreen, fixRounds, tokens, tokenBasis, tokenFallback, elapsedMs, pullRequest: {number, url, branch}|null, verdict: 'winner'|'lost'|'no-record'}` — the judge verb (a wave-2 sibling) produces it; this module only formats. Pure, no I/O; never calls `gh`; the FAILED printout lists PRs because adoption and closing are the operator's.

**Proof:**
- Test: `fleet/tests/test_race_report.mjs`
- Legs: (a) `scorecardLine` for a green winner with `fixRounds: 1`, `tokens: 267351`, `tokenBasis: 'ledger'`, `pullRequest: {number: 530, branch: 'ultra/integration-race-48-b'}` equals `  race-48-b status=gate-green fix-rounds=1 tokens=267351 (ledger) pr=#530 ultra/integration-race-48-b verdict=winner`; (b) an entry with `fixRounds: null`, `tokens: null`, `tokenFallback: true`, `pullRequest: null`, `verdict: 'no-record'` renders `fix-rounds=null`, `tokens=null`, `(reported, ledger-fallback)`, `pr=none`, `verdict=no-record`; (c) `verdictLines` with a winner yields first line `race race-48: winner race-48-b — decided by fix-rounds`, then three scorecard lines in runId order `a, b, c`, then `verdict: /e/race-race-48.json`, and no `pr` lines; (d) with `winner: null` the first line is `race race-48: FAILED — no attempt reached gate-green`, and one `prLine` per entry follows the scorecard lines, each containing the PR number and branch; (e) every line is a single line (no `\n` inside any element).

**Stale-if:**
- path-exists: `fleet/race-report.mjs`

### Task 8: The launch verb

**Type:** implementation
**Review:** adversarial

**Files:**
- Create: `fleet/race-launch.mjs`
- Test: `fleet/tests/test_race_launch.mjs`

**Claim:** launch the same committed plan as K concurrent runs (distinct runIds, ports, db-dirs — the #454 launch shape) (quoted from #511)
Machine: `launchRace(argv, deps)` parses argv with `parseLaunchArgs`, records `baseCommit` and the launch checkout's origin, writes the raceId-qualified manifest (dials included) before any drive starts, clones K repo-dirs at `baseCommit` with origin re-pointed, then invokes `driveOne` K times concurrently — each with options built through `buildDriveOptions` overriding exactly `runId`, `port`, `dbDir`, `repoDir` and a runId-prefixed `progressLog` — waits for every drive to settle, and returns `{manifest, results}` where `results[i]` is `{runId, status: 'fulfilled'|'rejected', value|reason}`; a drive rejection is reported after all K settle, never by exiting while siblings run.

**Authorized-by:** #511; spec §New machinery / launch; #535 item 1 (a rejecting drive must not orphan its siblings' VMs)

**Interfaces:**
- Consumes: `parseLaunchArgs(argv)` (from `fleet/race.mjs`)
- Consumes: `buildDriveOptions(parsed, deps)` (from `fleet/drive-one.mjs`)
- Consumes: `driveOne(opts)` (from `fleet/drive.mjs`; injected in tests)
- Consumes: `DIALS`
- Consumes: `writeRaceManifest(evidenceDir, manifest)`
- Consumes: `assertManifest(manifest)` (from `fleet/race-manifest.mjs`)
- Consumes: `allocateRuns({raceId, k, port, dbDir, raceDir})` (from `fleet/race-allocate.mjs`)
- Consumes: `baseCommitOf(git, repoDir)`
- Consumes: `originUrlOf(git, repoDir)`
- Consumes: `cloneAtCommit({git, sourceRepo, repoDir, baseCommit, originUrl})`
- Consumes: `resolvePlan(repoDir, planPath)`
- Consumes: `gitRunner` (from `fleet/race-clone.mjs`)
- Produces: `launchRace(argv, deps) -> Promise<{manifest, results}>`

**Context:** The schema literal: `race-<raceId>.json` holds `raceId`, `planPath`, `baseCommit`, `k`, `launchedAt`, `runs` (array of `{runId, port, dbDir, repoDir}`), `dials`, and after judging `verdict`. The launch checkout is `parsed.repoDir` (drive-one's `--repo-dir`, default the checkout the CLI lives in); `baseCommit` is its HEAD; `planPath` is stored repo-relative (`resolvePlan`). The manifest is written before any clone or drive so the dials cannot be chosen after results are visible. Build each run's options via `parseArgs`/`buildDriveOptions` — never hand-assemble (the token read, TTL, heartbeat and publish constants live behind that seam) — spreading the allocated `{runId, port, dbDir, repoDir}` over the parsed options and adding `progressLog: '<runId>: '`-prefixed lines to the injected `progressSink`. Plan cleanliness is `driveOne`'s own #337 preflight; this verb adds no second copy. One process per race, drives in-process (the orchestrator-dies-with-the-drive rule); settle every drive (`Promise.allSettled`) so a preflight refusal on one attempt never kills siblings mid-provision and leaves `fleet-<runId>` VMs orphaned — the defect run-47's and all three race-48 reviews flagged. This module is the wave-2 sibling `fleet/race.mjs` loads by the literal name `./race-launch.mjs`; the other wave-2 sibling, `race-judge.mjs`, shares nothing with it but the manifest.

**Proof:**
- Test: `fleet/tests/test_race_launch.mjs`
- Legs: with a stub `driveOne` and a recording git stub (rev-parse → a 40-hex sha, `remote get-url origin` → `https://github.com/x/y.git`, clones recorded), `launchRace(['docs/plan.md','race-9','--k','3','--repo-dir','/launch'], deps)` (a) writes `race-race-9.json` in the temp evidence dir whose `baseCommit` equals the stub sha, whose `planPath` is `docs/plan.md`, whose `runs` deep-equal `allocateRuns`'s three entries, and whose `dials` deep-equal `DIALS`; (b) the manifest file exists at the moment of the first stub `driveOne` call (the stub asserts it); (c) the stub is called exactly 3 times and the calls overlap in flight (each resolves only after all three have started); (d) across the three option objects `runId`, `port`, `dbDir`, `repoDir` and `progressLog` are pairwise distinct, runIds are `race-9-a/b/c`, each `progressLog` starts with its own runId, no other key differs between the three objects, and each `repoDir` was the target of a recorded clone whose sequence is clone → `checkout --detach <sha>` → `remote set-url origin https://github.com/x/y.git`; (e) every option object carries drive-one's default `prBase` untouched (built through the real `buildDriveOptions`); (f) with the second stub drive rejecting, `launchRace` still resolves after the first and third have resolved, `results[1]` is `{runId: 'race-9-b', status: 'rejected', reason}` with the stub's error as `reason`, `results[0]` and `[2]` are `{runId: 'race-9-a'|'race-9-c', status: 'fulfilled', value}` carrying the stub's resolved values, the array is in allocation order, and no `driveOne` call was skipped; (g) with the git stub returning `/home/exedev/repo` for origin, `launchRace` rejects naming `origin` and the stub `driveOne` is never called and no manifest is written; (h) the launch checkout's HEAD in (a) was read through the injected git, not from `process.cwd()` (the stub records the cwd `/launch`).

**Stale-if:**
- path-exists: `fleet/race-launch.mjs`

### Task 9: The judge verb

**Type:** implementation
**Review:** adversarial

**Files:**
- Create: `fleet/race-judge.mjs`
- Test: `fleet/tests/test_race_judge.mjs`

**Claim:** After all the attempts finish, I ask for the verdict and see the winning run named, with a per-run scorecard and the rule that decided it. (elicited)
Machine: `judgeRace(argv, deps)` parses argv with `parseJudgeArgs`, reads the manifest, refuses (throws naming the missing run) while any run's gate-read is missing unless `--force` (which scores the runs that reported and marks the rest `no-record`, an automatic loss); over the complete records it builds one scorecard entry per run — status from the detail, fix rounds from the run's store via `countFixRounds`, tokens from `ledger` (falling back to `reported` for every contestant, flagged, when any contestant's ledger is null) — asserts `STAGES` equals `manifest.dials.rubric`, selects the winner with `selectWinner`, appends `{winner, decidingStage, scorecard}` to the manifest without altering `dials`, prints `verdictLines` to the injected `stdout`, and returns the verdict.

**Authorized-by:** #511; spec §New machinery / judge

**Interfaces:**
- Consumes: `parseJudgeArgs(argv)` (from `fleet/race.mjs`)
- Consumes: `readRaceManifest(evidenceDir, raceId)`
- Consumes: `appendVerdict(evidenceDir, raceId, verdict)` (from `fleet/race-manifest.mjs`)
- Consumes: `STAGES`
- Consumes: `selectWinner(entries)`
- Consumes: `tokenBasis(entries)` (from `fleet/race-rubric.mjs`)
- Consumes: `readRunRecord(evidenceDir, runId)`
- Consumes: `sqliteStoreJson(dbDir, exec)`
- Consumes: `countFixRounds(storeJson, runId)`
- Consumes: `ledgerOf(read)`
- Consumes: `reportedOf(read)`
- Consumes: `driveStatusOf(detail)` (from `fleet/race-evidence.mjs`)
- Consumes: `verdictLines(verdict)` (from `fleet/race-report.mjs`)
- Produces: `judgeRace(argv, deps) -> Promise<{winner, decidingStage, scorecard}>`

**Context:** The schema literal: `race-<raceId>.json` holds `raceId`, `planPath`, `baseCommit`, `k`, `launchedAt`, `runs` (array of `{runId, port, dbDir, repoDir}`), `dials`, and after judging `verdict` (`{winner, decidingStage, scorecard}`, `scorecard` keyed by runId). A scorecard entry is the literal `{runId, status, gateGreen, fixRounds, tokens, tokenBasis, tokenFallback, elapsedMs, pullRequest, verdict: 'winner'|'lost'|'no-record'}` — the same literal the printout task formats. `gateGreen` is `status === 'gate-green'`. Zero green runs is a FAILED race: merge nothing, the printout lists the K PRs for the operator to close; the judge never calls `gh` and never merges or closes. An unreadable store gives `fixRounds: null` (a loss at that stage), never an abort. The rubric assertion (`STAGES` deep-equals `manifest.dials.rubric`) is what binds the pre-registered dials to the comparator actually applied. The sqlite `exec` and the store reader are injected in tests. This module is the wave-2 sibling `fleet/race.mjs` loads by the literal name `./race-judge.mjs`.

**Proof:**
- Test: `fleet/tests/test_race_judge.mjs`
- Legs: over fixture manifests, gate-reads and store JSON in a temp evidence dir with an injected store reader, `judgeRace` (a) refuses when any run's gate-read is missing, the error naming that runId, and with `--force` scores the reporters and marks the absentee `verdict: 'no-record'` with `fixRounds: null`, `tokens: null`; (b) picks the sole `gate-green` run over parked/failed ones with `decidingStage: 'gate-green'`; (c) among two greens picks fewer fix rounds (store fixtures with one vs two `fix:` start rows) with `decidingStage: 'fix-rounds'`; (d) among fix-round ties picks fewer `ledger` tokens with `decidingStage: 'tokens'`, and with one null ledger uses `reported` for all and every entry carries `tokenBasis: 'reported'`, `tokenFallback: true`; (e) among full ties picks the lexicographic-least runId with `decidingStage: 'runid-lexicographic'`; (f) with zero greens returns `winner: null`, and the injected `stdout` received a line containing `FAILED` plus one line per run naming its PR branch; (g) the appended `verdict` leaves every pre-registered `dials` value byte-identical and the scorecard is keyed by runId with each entry naming `status`, `fixRounds`, `tokens`; (h) an injected store reader that returns `null` for one run yields that run `fixRounds: null` and the verdict still completes; (i) a manifest whose `dials.rubric` differs from `STAGES` makes `judgeRace` throw naming `rubric` before writing anything; (j) the injected `stdout` received exactly the lines `verdictLines` returns for the verdict, in order.

**Stale-if:**
- path-exists: `fleet/race-judge.mjs`
