# The fold bootstraps its candidate, and the referee cannot lie by omission or leave the clone

**Grammar:** claims-v1

**Claim:** the engine runs `bootstrapCmd` in the candidate tree when the fold changed a manifest or lockfile the bootstrap reads (quoted from #825)

**Goal:** Three defects that must land before 0.3.23, bundled because each is one file plus its
own sim and none shares a file with another. #825: the first TinyApp state-exams run (run-1 on
`popmechanic/tinyapp-fixture`, 2026-09-09) had a task add `@happy-dom/global-registrator` to
`client/package.json`, pass its exam in its own bootstrapped clone, and red the wave-1 fold
candidate with `Cannot find module` — the candidate suite runs in the integration clone, whose
`node_modules` were installed at BASE, and the engine runs `bootstrapCmd` at setup, in the
examiner's clone and on re-anchor, never on the candidate. Task 1 adds the one missing site.
#818 and #819 are run-69's residuals from the mechanical referee (#816, merged as `a526641` —
this plan's BASE): `readPatch()` swallows an unreadable patch as `[]` so a failed capture is
recorded as a clean review (Task 2), and `linkProduces` lets a `files` entry resolve outside the
clone and then `import()`s it, while its timeout detail reads `killed`/`signal` that only its own
`defaultExec` sets (Task 3).
Assumptions recorded here because the operator adjudicated the Claims and the lane, not these:
(1) #825 is built as the **manifest ladder**, not the unconditional bootstrap the issue also
allows — `npm ci`, one rung of `derive_bootstrap_cmd`'s ladder, deletes `node_modules` by design
on every call, so "under a few seconds when nothing changed" is not met for every rung, while the
ladder test is one `git diff --name-only <prevHead> <candidate>` the engine already has both shas
for; the ladder is the issue's list plus `pnpm-lock.yaml` and `uv.lock`, which
`derive_bootstrap_cmd` also reads. (2) "The integration clone is bootstrapped after adoption the
same way" needs no second install: the candidate is `read-tree`'d into, tested in, and adopted
(`reset --hard`) in the one integration clone, so the install made before the suite is the
adopted tree's install — the sim pins that it is there after `MERGED`. (3) #818 takes the ticket's
default: an absent `patchPath` (`undefined`, `null`, `''`) is an error too, since the engine returns
`lost-coordinates` before the referee whenever it has no capture, so no engine path reaches
`referee()` without a patch file. (4) #819 item 2 takes the issue's second option — the non-JSON
branch names the bound it ran under when stderr is empty — so no engine change and no JSDoc
contract change is needed; the engine's `execSeam` already appends a `killed after <n>s timeout`
line to stderr on a kill, which the first-line rule carries as before. (5) All three exams are
`Guard:`ed: each pins a claim a later run's edit to the same file could break.
**Closes:** #825 #818 #819

**Tech Stack:** Node 22 ESM (`fleet/*.mjs`, `node:` modules only — `fleet/package.json` declares
no dependency), Markdown role files. The engine sim runs the real engine below the agent seam
(real git, real clones-at-BASE, real `withPatchCapture` diffs, the real fold kernel through the
real `sh` seam) with canned judgments, through `rig()` of `fleet/tests/_engine_helpers.mjs`. The
referee sims build real git checkouts under a temporary directory and call the modules directly.
The committed suite is `python3 -m pytest` from the repo root, which bridges every
`fleet/tests/test_*.mjs` through `tests/test_fleet_suite.py` (sentinel `ALL TESTS PASSED`, no
network, 300 s per file).

**Parallelization rationale:** one wave, width 3. Task 1 (`fleet/run-engine.mjs`,
`fleet/roles/reconcile.md`, a new engine sim), Task 2 (`fleet/referee.mjs`, the replay sim) and
Task 3 (`fleet/referee-linker.mjs`, the linker sim) name no common file and consume no common
symbol; the referee never imports the linker (the engine injects it), so Tasks 2 and 3 do not meet
even at import. No chain.

## Global Constraints

- Check: git diff --quiet $ULTRA_BASE -- skills/ultrapowers/scripts/gate_check.py skills/ultrapowers/scripts/ultra_gate.py skills/ultrapowers/scripts/run_acceptance.sh skills/ultrapowers/scripts/compile_plan.py
- Check: git diff --quiet $ULTRA_BASE -- fleet/roles/examiner.md fleet/roles/critic.md fleet/roles/fix.md fleet/roles/implementer.md fleet/roles/resolver.md fleet/roles/reviewer.md
- The verification periphery is frozen (0.1.0): the first Check pins the three gate scripts and the
  compiler. The second pins the roles this plan does not own — only `reconcile.md` changes, by one
  sentence.
- The referee and the linker stay driver code: no model call, no network, no git write, no
  `anthropic` SDK and no `ANTHROPIC_API_KEY` anywhere in `fleet/`. A subprocess the linker spawns
  is `node` or `python3` on a file of the task's own clone, with a timeout, and nothing else — an
  entry that resolves outside the clone is never that file.
- Amendment 10 holds: models never run git; every git command in the sims is the sim's own.

**Acceptance:** suite — the committed suite is the verification.

### Task 1: The fold bootstraps a candidate whose manifest changed

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/run-engine.mjs`
- Modify: `fleet/roles/reconcile.md`
- Test: `fleet/tests/test_run_engine_candidate_bootstrap.mjs`

**Claim:** Before the candidate suite runs on a fold candidate (`run-engine.mjs` ~1143, the materialize → `testCmd` → adopt sequence), the engine runs `bootstrapCmd` in the candidate tree when the fold changed a manifest or lockfile the bootstrap reads (`package.json`, `bun.lock`, `bun.lockb`, `package-lock.json`, `pyproject.toml`, `requirements*.txt`, `pytest.ini` — the same ladder `derive_bootstrap_cmd` reads), and the integration clone is bootstrapped after adoption the same way; a bootstrap that fails there is a `judgmentCall` and the candidate is red with the bootstrap output, not a module-not-found suite line. (quoted from #825)
Machine: M1. `fleet/run-engine.mjs` exports `bootstrapManifestChanged(paths)`, a pure function of
an array of repository-relative paths that returns `true` when at least one path's basename is
one of `package.json`, `package-lock.json`, `bun.lock`, `bun.lockb`, `pnpm-lock.yaml`, `uv.lock`,
`pyproject.toml`, `pytest.ini` or matches `requirements*.txt` — at any directory depth — and
`false` otherwise, including for an empty array and for names that merely contain one of those
(`package.json.bak`, `requirements.md`).
M2. In `foldWave`'s adopt sequence, after `git read-tree -u --reset <candidate>^{tree}` into the
integration clone and before `testCmd` is run there, when `bootstrapCmd` is set and
`bootstrapManifestChanged` is `true` over the paths of `git diff --name-only <prevHead>
<candidate>`, the engine runs `bootstrapCmd` exactly once in the integration clone through the
same `sh` seam the suite runs through; with `bootstrapCmd` unset no bootstrap runs there between
the `read-tree` and the suite, and with `bootstrapCmd` set and the predicate `false` none runs
there either.
M3. When that bootstrap exits non-zero, `report.judgmentCalls` gains a line containing
`wave <N>: candidate bootstrap failed (exit <code>)`, `testCmd` is not run on that candidate, and
the failing output handed to the reconcile agent and the wave's `TEST_FAILED` detail carry the
bootstrap's stdout and stderr and none of the suite's output.
M4. The install made before the suite is the adopted tree's install: after a wave whose candidate
bootstrap ran returns `MERGED`, the module the bootstrap installed is present under the integration
clone, and no second bootstrap ran there after the adopt.
M5. `fleet/roles/reconcile.md` carries one sentence naming the project's dependency install as the
first move when a manifest or lockfile changed — the words `manifest`, `lockfile` and `install`
appear in that order within one sentence.

**Authorized-by:** #825; #758 (the spec whose first run found it); #729 (the referee's
`dependencies` settled line, which names the manifest change nothing acted on); operator doctrine
"no small measures while broken".

**Interfaces:**
- Consumes: none
- Produces: `bootstrapManifestChanged(paths: string[]) -> boolean`

**Context:** The site is `foldWave(merged, waveIdx, waveTasks, prevHead)` in
`fleet/run-engine.mjs`, in the block that begins with the comment `Materialize → candidate, then
the adopt choreography`: `const candidate = m.candidateSha`, then
`await git(['read-tree', '-u', '--reset', candidate + '^{tree}'], integ)`, then
`let suite = await sh(testCmd, integ)`, then on green `git reset --hard candidate` in `integ` and
`return { status: 'MERGED', … }`, and on red `await runBaseline(candidate)` followed by the
reconcile loop (cap 2), which hands the agent `roles.reconcile + '\nTEST COMMAND: ' + testCmd +
'\n\nFailing output:\n' + failingBlock(suite.stdout + suite.stderr)` and, when still red, returns
`{ status: 'TEST_FAILED', detail: 'candidate suite failed after reconcile attempts: ' +
failingBlock(suite.stdout + suite.stderr) }`. `bootstrapCmd` is the engine-level const read from
`args.bootstrapCmd` (a trimmed string or `undefined`); `sh(cmd, cwd)` is `bash -lc <cmd>` through
the engine's `exec` seam and resolves `{code, stdout, stderr}`; `git(argv, cwd)` throws on
non-zero; `judgmentCalls` is the run-level array the report carries as `report.judgmentCalls`. The
three existing bootstrap sites — the setup loop over every clone (`bootstrap failed in <clone>`),
`bootstrapExamClone` and the wave-2 re-anchor (`re-anchor bootstrap failed`) — each push a judgment
call on a non-zero exit and continue; the candidate site differs in M3 by making the candidate red
on the bootstrap output instead of running a suite that would fail on a missing module, so the
reconcile agent reads the install's own error. `failingBlock(text)` returns `text` unchanged when
no line matches its `START` pattern (`FAILED `, `FAIL:`, `not ok `, `AssertionError`, a
`___ x ___` rule), so a bootstrap's plain error reaches the brief whole. The wave-level result
reaches the report as `report.waveMerges[i] = {wave, status, headSha, detail, branches}`.
`prevHead` is the integration branch head the wave folds onto — BASE for wave 1, the prior
adopted head after — so `git diff --name-only prevHead candidate` in `integ` is exactly the
paths the fold changed. Match basenames at any depth: the TinyApp case was `client/package.json`.
The `derive_bootstrap_cmd` ladder in `skills/ultrapowers/scripts/ultra_run.py` reads
`package.json` with `pnpm-lock.yaml`/`bun.lock`/`bun.lockb`/`package-lock.json`, then `uv.lock`,
`pyproject.toml`, `requirements.txt`; M1's list is that ladder plus `pytest.ini` and the
`requirements*.txt` glob the issue names. The predicate is a module-level `export const` beside
`looksStructural` and `isInfraFault` — the engine already exports its small pure helpers there,
and the sim imports it from `../run-engine.mjs` the way `_engine_helpers.mjs` imports
`runEngine`. Do not touch the three existing sites and do not add a
site after the adopt: the adopt is `reset --hard` in the same `integ` directory the bootstrap and
suite ran in, and its untracked install survives (`git clean -fd` on the `TEST_FAILED` path has
no `-x`, so an ignored `node_modules` survives that too).

The sim rig, for the examiner: `rig({repo, runDir, waves, stub, testCmd, extraArgs})` in
`fleet/tests/_engine_helpers.mjs` provisions `<runDir>/clones/integration` and
`<runDir>/clones/task-<id>` at BASE and runs the real engine; `extraArgs: { bootstrapCmd: '…' }`
is how `test_run_engine_exam_together.mjs` sets the bootstrap, and the setup loop then runs it in
every clone before wave 1. `makeRepo(dir, files)` writes `check.sh` (`[ ! -f BROKEN ]`) and
`a.txt`, then every `files` entry — so a `check.sh` in `files` replaces the default. The stub
receives `(prompt, opts, cwd)`; `opts.label` is `impl:<id>`, `review:<id>:<n>`,
`reconcile:wave<N>:<attempt>` or `integration`; canned replies are `doneImpl(cwd)`,
`passReview()`, `cleanCritic()` and `{status: 'BLOCKED', summary}` for a reconcile that gives up.
The capture is `git add -A` then `git diff --cached` against the wave base, so the repo needs a
`.gitignore` naming `node_modules` or the implementer's install rides into the patch. No network
in the suite: a dependency is simulated, not fetched — a repo whose `install.sh` reads the
`dependencies` keys of `package.json` (`node -e` over `JSON.parse`) and writes
`node_modules/<name>/package.json` (`{"main":"index.js"}`) and `node_modules/<name>/index.js`
(`module.exports = 1`) for each, exiting 3 with `install broke: boom` on stderr when a dependency
is named `boom`; `check.sh` is `[ ! -f BROKEN ] && node test.mjs`; at BASE `package.json` is
`{"dependencies":{}}` and `test.mjs` is a comment. The implementer stub writes
`{"dependencies":{"leftpad":"1"}}` and `import 'leftpad'` into `test.mjs` and runs
`bash install.sh` in its own clone (as the live implementer did), so its clone is green and the
patch carries only the two tracked files; at BASE the candidate in `integ` then fails
`Cannot find module 'leftpad'` and the reconcile stub's `BLOCKED` ends the wave `TEST_FAILED`,
which is the red-at-BASE the exam shows. `install.sh` appending `$PWD` to a log file whose
absolute path the sim wrote into the script is how the legs count where the bootstrap ran: the
setup loop contributes one line per clone (integration and task), the candidate site one more
for the integration clone. `bootstrapCmd` is `bash install.sh` in every scenario; `check.sh` runs
under `bash -lc`, so `node` is the sandbox's.
**BASE facts:** (generated at a526641)
- `testCmd` at `fleet/confine-hook.mjs:302` blob cb77dc8
- `bootstrapCmd` at `fleet/run-engine.mjs:863` blob 9b84b07
- `pytest.ini` blob 251eb61
- `derive_bootstrap_cmd` at `skills/ultrapowers/scripts/ultra_run.py:111` blob 4bae654
- `fleet/run-engine.mjs` blob 9b84b07
- `foldWave` at `fleet/run-engine.mjs:2082` blob 9b84b07
- `sh` at `fleet/run-engine.mjs:790` blob 9b84b07
- `fleet/roles/reconcile.md` blob 37ea357
- `manifest` at `fleet/tests/test_weave_emit.mjs:113` blob 402e3e5
- `integ` at `fleet/publish-fold.mjs:312` blob 39fbd16
- `exec` at `fleet/publish-fold-block.mjs:69` blob 65a8466
- `judgmentCalls` at `fleet/run-engine.mjs:918` blob 9b84b07
- `bootstrapExamClone` at `fleet/run-engine.mjs:1275` blob 9b84b07
- `text` at `fleet/claude-token.mjs:211` blob b7e8e7b
- `START` at `fleet/failing-block.mjs:44` blob 4516d37
- `skills/ultrapowers/scripts/ultra_run.py` blob 4bae654
- `looksStructural` at `fleet/run-engine.mjs:97` blob 9b84b07
- `isInfraFault` at `fleet/run-engine.mjs:99` blob 9b84b07
- `runEngine` at `fleet/run-engine.mjs:777` blob 9b84b07
- `fleet/tests/_engine_helpers.mjs` blob 8aa0df0
- `files` at `fleet/referee.mjs:77` blob b1da45e
- `integration` at `fleet/run-waves.mjs:103` blob 27f25b5
- `boom` at `fleet/tests/test_referee_linker.mjs:149` blob 5eec5f2
- `extraArgs` at `fleet/tests/test_run_engine_fold_subject.mjs:50` blob 8a38a1b
- `detail` at `fleet/doctor.mjs:621` blob f9a1174
- `fleet/failing-block.mjs` blob 4516d37

**Proof:**
- Test: `fleet/tests/test_run_engine_candidate_bootstrap.mjs`
- Guard: `fleet/tests/test_run_engine_candidate_bootstrap.mjs`
- Run: node fleet/tests/test_run_engine_candidate_bootstrap.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_run_engine_reconcile.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_run_engine_exam_together.mjs | grep -q 'ALL TESTS PASSED'
- Run: tr '\n' ' ' < fleet/roles/reconcile.md | grep -qiE 'manifest[^.]*lockfile[^.]*install'
- Legs: (a) for each of `package.json`, `package-lock.json`, `bun.lock`, `bun.lockb`,
  `pnpm-lock.yaml`, `uv.lock`, `pyproject.toml`, `pytest.ini`, `requirements.txt` and
  `requirements-dev.txt`, `bootstrapManifestChanged(['client/' + name])` is `true` and
  `bootstrapManifestChanged([name])` is `true` — one assertion pair per row [M1]; (b)
  `bootstrapManifestChanged([])`, `bootstrapManifestChanged(['README.md', 'src/a.mjs'])`,
  `bootstrapManifestChanged(['package.json.bak'])`, `bootstrapManifestChanged(['requirements.md'])`
  and `bootstrapManifestChanged(['docs/pytest.ini.old'])` are each `false` [M1]; (c) the manifest
  scenario — one task whose patch adds `leftpad` to `package.json` and imports it from
  `test.mjs`, `bootstrapCmd` `bash install.sh` — ends with `report.waveMerges[0].status`
  `MERGED`, `report.tests.passed` `true`, no dispatch whose label begins `reconcile:`, and the
  install log holding lines naming the integration clone's path exactly twice — once from the
  setup loop and once from the candidate site [M2]; and the no-manifest scenario — a task whose
  patch touches only `a.txt` — ends `MERGED` with the log holding a line naming the integration
  clone's path exactly once [M2]; and a run of the manifest scenario with `bootstrapCmd` absent
  from `extraArgs` ends with the log holding no line naming the integration clone's path and no
  judgment call containing `candidate bootstrap` [M2]; (d)
  the failing scenario — the task's patch adds a dependency named `boom` — has a
  `report.judgmentCalls` entry containing `wave 1: candidate bootstrap failed (exit 3)`, a
  captured `reconcile:wave1:1` prompt whose text after `Failing output:` contains
  `install broke: boom` and does not contain `Cannot find module`, and — with the reconcile stub
  answering `BLOCKED` — `report.waveMerges[0].status` `TEST_FAILED` with `detail` containing
  `install broke: boom` and not `Cannot find module`; and the number of `check.sh` marker lines
  naming the integration clone, appended by `check.sh` to the same log, is exactly one — the
  baseline run's — so the suite never ran on the candidate [M3]; (e) after the manifest scenario's run,
  `<runDir>/clones/integration/node_modules/leftpad/index.js` exists and the log's lines naming
  the integration clone number exactly two — none was added after the adopt [M4]; (f) the fourth
  `Run:` finds `manifest`, `lockfile` and `install` in that order within one sentence of
  `fleet/roles/reconcile.md` [M5]; (g) the two sibling sims that pin the reconcile loop and the
  exam-clone bootstrap still print their sentinel [M2, M3].

**Stale-if:**
- path-absent: `fleet/tests/_engine_helpers.mjs`
- path-absent: `fleet/failing-block.mjs`
- issue-closed: #825

### Task 2: A patch the referee cannot read is a loud failure

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/referee.mjs`
- Test: `fleet/tests/test_referee_replay.mjs`
- Test: `fleet/tests/test_run_engine_referee.mjs`

**Claim:** A `patchPath` that is given and cannot be read is a loud failure, never a clean record: `readPatch` rethrows with the path in the message (`referee: cannot read the captured patch <path>: <err>`), and `referee()` rejects — the engine's pre-review pass records the task as it records any driver error, not as reviewed. (quoted from #818)
Machine: M1. `readPatch(patchPath)` in `fleet/referee.mjs`, given a non-empty string whose
`fs.readFileSync` throws, throws an `Error` whose message is
`referee: cannot read the captured patch <patchPath>: <the underlying error's message>`, and
`referee({…, patchPath})` rejects with that error.
M2. `referee()` called with `patchPath` `undefined`, `null` or `''` rejects with an `Error` whose
message contains `no captured patch` and the task id.
M3. When `referee()` rejects for either reason, nothing is written: `<runDir>/referee/` does not
exist afterwards.
M4. A readable `patchPath` behaves as before: the `clean-1` replay still yields `findings` `[]`,
and an existing zero-byte patch file yields `findings` `[]` on `clean-1` as well.
M5. In the engine, a task whose captured patch file is gone by the time the pre-review pass
reaches the referee ends in the report with `status` `failed`, `reviewVerdict` `agent-error` and
`notes` containing `cannot read the captured patch`, no `review:` dispatch is made for it, and no
`<runDir>/referee/task-<id>-*.json` exists for it — the record of a driver error, never of a
review.

**Authorized-by:** #818; #729 spec §3.1 (the patch is the referee's sole input for the footprint
and count checks); map #727 (the referee is the first driver check and must not lie by omission).

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** `readPatch` is the module-level arrow at the top of the patch section:
`if (!patchPath) return []`, then `try { return parsePatch(fs.readFileSync(String(patchPath),
'utf8')) } catch { return [] }`. `referee()` calls it as `const patch =
readPatch(options.patchPath)` before any check runs and before the `runDir` write at the end, so a
throw there rejects the promise with nothing on disk — M3 needs no extra guard, only that the
read stays ahead of the write. M2's message names `options.task.id` (via the module's `str()`)
so the engine's judgment call for the error says which task. The engine's only caller is
`runReferee` inside the pre-review pass of `runTaskInner`; a rejection there propagates to
`runTask`'s `catch`, which pushes `task <id>: agent error …`, retries the task once at the same
tier and, on a second throw, returns `status: 'failed', reviewVerdict: 'agent-error'` with the
message in `notes` — the driver-error record the Claim names; no engine change belongs to this
task, and M5 is that existing route observed through the engine seam sim. The way to make a
captured patch vanish before the referee in a sim: the pre-review pass runs the task's
`proofRuns` commands (`bash -lc`, cwd the task clone) before `runReferee`, and the capture is
`<runDir>/patches/task-<id>.patch` while the clone is `<runDir>/clones/task-<id>`, so a task
with `proofRuns: ['rm -f "$PWD/../../patches/task-T1.patch"']` and `proofTests: []` deletes its
own capture on every pass — the retry re-captures and re-deletes, so the second throw lands the
`failed`/`agent-error` row. `test_run_engine_referee.mjs` builds tasks with `entry({...})`, runs
one wave through `rig()` and reads `r.row('T1')` and the captured dispatch labels; extend it
under a comment naming this task. No engine path reaches `referee()` without a patch file: `hasCoordinates(impl)` is `r.headSha
&& r.patch`, and a task without it returns `lost-coordinates` before the referee, so M2's rows are
reachable only from a direct caller — and the ticket's default makes them errors all the same.
The replay sim's `replay(name, over)` builds HEAD from a fixture and passes `patchPath:
over.patchPath ?? path.join(fixtureDir, 'patch.diff')`, with `runDir` a fresh scratch directory
unless `over.withoutRunDir`; a nonexistent path is `path.join(scratch('patch'), 'absent.diff')`
never written, a directory is `scratch('dir')` itself, and an empty file is one the leg writes
with `fs.writeFileSync(p, '')`. To pass `undefined` or `null` through `replay`, the leg calls
`referee()` directly with the same opts `replay` builds (its `head`, `task` and a stub linker are
all returned by an earlier `replay`), because `??` would substitute the fixture's patch. The
existing leg (n) pins that the module imports only `node:` modules and never mentions
`child_process`, `execFile`, `execSync`, `spawn` or `fetch(` — the rethrow adds none of them.
Group the new legs under a comment naming this task, after the existing legs and before the
final `console.log('ALL TESTS PASSED')`.
**BASE facts:** (generated at a526641)
- `patchPath` at `fleet/tests/test_referee_replay.mjs:493` blob 744db56
- `readPatch` at `fleet/referee.mjs:99` blob b1da45e
- `fleet/referee.mjs` blob b1da45e
- `findings` at `fleet/doctor.mjs:593` blob f9a1174
- `status` at `fleet/claude-token.mjs:358` blob b7e8e7b
- `failed` at `fleet/run-engine.mjs:1057` blob 9b84b07
- `notes` at `fleet/doctor.mjs:321` blob f9a1174
- `runReferee` at `fleet/run-engine.mjs:1631` blob 9b84b07
- `runTaskInner` at `fleet/run-engine.mjs:1099` blob 9b84b07
- `runTask` at `fleet/run-engine.mjs:2031` blob 9b84b07
- `proofRuns` at `fleet/run-engine.mjs:1200` blob 9b84b07
- `replay` at `evals/frontier/replay_corpus.py:184` blob 7d40d74
- `head` at `fleet/launch.mjs:873` blob 8cc2fc3
- `task` at `fleet/referee.mjs:462` blob b1da45e
- `fleet/tests/test_referee_replay.mjs` blob 744db56
- `fleet/tests/test_run_engine_referee.mjs` blob ae675c8
- `runDir` at `fleet/run-main.mjs:588` blob 4cb8b21
- `referee` at `fleet/referee.mjs:459` blob b1da45e
- `fleet/tests/fixtures/referee/clean-1/patch.diff` blob d5fd0b5

**Proof:**
- Test: `fleet/tests/test_referee_replay.mjs`
- Test: `fleet/tests/test_run_engine_referee.mjs`
- Guard: `fleet/tests/test_referee_replay.mjs`
- Guard: `fleet/tests/test_run_engine_referee.mjs`
- Run: node fleet/tests/test_referee_replay.mjs | tail -1 | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_run_engine_referee.mjs | grep -q 'ALL TESTS PASSED'
- Legs: (a) `replay('clean-1', {patchPath: <a path that does not exist>})` rejects with an `Error`
  whose message starts `referee: cannot read the captured patch `, contains that path, and
  contains `ENOENT`; and `<runDir>/referee` does not exist afterwards [M1, M3]; (b)
  `replay('clean-1', {patchPath: <a directory>})` rejects with a message starting
  `referee: cannot read the captured patch ` and containing that directory's path, and
  `<runDir>/referee` does not exist [M1, M3]; (c) `referee()` called with `clean-1`'s opts and
  `patchPath: undefined` rejects with a message containing `no captured patch` and the task id
  [M2]; (d) the same with `patchPath: null` [M2]; (e) the same with `patchPath: ''` [M2]; (f) for
  each of the three previous rows — `undefined`, `null`, `''` — the scratch `runDir` holds no
  `referee` directory afterwards [M3];
  (g) `replay('clean-1')` unchanged yields `findings` `[]` and writes
  `<runDir>/referee/task-<id>-0.json`, and `replay('clean-1', {patchPath: <a zero-byte file>})`
  resolves with `findings` `[]` [M4]; (h) the engine seam sim's existing scenarios, whose every
  task has a driver-captured patch, still pass — the rethrow changes nothing for a readable patch
  [M4]; (i) in `test_run_engine_referee.mjs`, one wave with a task whose `proofRuns` is
  `['rm -f "$PWD/../../patches/task-T1.patch"']` and whose implementer stub writes a file, ends
  with `r.row('T1').status` `failed`, `reviewVerdict` `agent-error`, `notes` containing
  `cannot read the captured patch` and `task-T1.patch`, no captured dispatch label beginning
  `review:`, no file matching `<runDir>/referee/task-T1-*.json`, and a `report.judgmentCalls`
  entry containing `agent error` and `cannot read the captured patch` [M5].

**Stale-if:**
- path-absent: `fleet/tests/fixtures/referee/clean-1/patch.diff`
- issue-closed: #818

### Task 3: A files entry cannot leave the clone, and the timeout detail names its bound

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/referee-linker.mjs`
- Test: `fleet/tests/test_referee_linker.mjs`

**Claim:** Before a `files` entry becomes a candidate, `abs` must equal `path.resolve(cloneDir)` or start with it plus `path.sep`; otherwise it is skipped as `<rel>: outside the clone` and no subprocess runs. (quoted from #819)
Machine: M1. In `linkProduces`, a `files` entry whose `abs = path.resolve(cloneDir, rel)` neither
equals `path.resolve(cloneDir)` nor begins with `path.resolve(cloneDir) + path.sep` is pushed to
`skipped` as `<rel>: outside the clone` before the filesystem is consulted for it and never
becomes a candidate, so `exec` is not called for it; this holds for a relative entry that climbs
out (`../escape.mjs`) and for an absolute entry alike, whether or not the file exists.
M2. When every entry is skipped, the answer is `unlinked` with a detail containing each skipped
entry's `<rel>: outside the clone`; when an in-clone candidate remains beside an escaping entry,
the answer is that candidate's own and `exec` is called exactly once, for the in-clone file.
M3. In `linkMjs` and `linkPy` (#819 item 2), a subprocess result with no JSON line whose `stderr`
is empty after trimming answers `unlinked` with the detail
`<rel>: <node|python3> produced no JSON within <timeoutMs>ms`, whatever `code` is; a result with
`killed` set keeps `<rel>: timeout after <timeoutMs>ms`, and so does a result with `signal` set; a
result with a non-empty `stderr` keeps its first line, as before.

**Authorized-by:** #819; #729 spec §3.3 and its global constraint (a subprocess the referee spawns
is `node` or `python3` on a file of the task's own clone); map #727.

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** The candidate loop in `linkProduces` is: for each `entry` of `files`, `rel` is the
entry with backslashes turned to `/`, an empty `rel` is skipped silently, an extension outside
`LINKABLE` pushes `<rel>: no linker for <ext>` to `skipped`, then `const abs =
path.resolve(cloneDir || '.', rel)` and `if (!isFile(abs)) skipped.push(rel + ': not in the
clone')`, else `candidates.push({rel, abs, ext})`; when `candidates` is empty the answer is
`unlinked` with `no linkable file among the task's files: ` + `skipped.join('; ')`. M1's test goes
between the extension test and `isFile`, against `const root = path.resolve(cloneDir || '.')`, so
an escaping entry is skipped before the filesystem is consulted (an absolute entry inside the clone
passes; `path.sep` is `/` on the sandbox and the sim). The per-language linkers are `linkMjs`
(`exec('node', ['--input-type=module', '-e', mjsScript(...)], {cwd: cloneDir, timeoutMs})`) and
`linkPy` (`exec('python3', ['-c', pyScript(abs)], …)`); each tests `res.killed || res.signal`
first for `timeout after <ms>ms`, then `jsonLine(res.stdout, key)`, and when that is null or
`res.code !== 0` answers `unlinked` with `firstLine(res.stderr) || '<prog> exited ' + res.code`.
M3 replaces only the empty-stderr fallback in those two functions; `linkTs` spawns nothing and is
untouched. The engine's own seam, `execSeam` in `fleet/run-main.mjs`, resolves `{code, stdout,
stderr, timedOut}` and on a kill appends `[execSeam] killed after <n>s timeout (#436)` to stderr,
so under the real engine a timeout already reaches the detail through the first-line rule; M3 is
for a seam-shaped exec that reports nothing. The sim's helpers: `checkoutOf({rel: body})` writes a
tree under a fresh temp directory and commits it, `mkTmp()` gives a fresh temp directory,
`link(args)` is `linkProduces` with `timeoutMs` 20000, and a throwing stub `exec` (`boom`) is the
sim's existing proof that no subprocess ran; a `recorder` stub records `{cmd, argv, opts}` and
answers `{code: 0, stdout: JSON.stringify({has: true, length: 1, names: ['foo']}) + '\n',
stderr: ''}`. For the escape legs write `escape.mjs` (`export function foo (a) { return a }`) in
the PARENT of the clone directory — `path.join(cloneDir, '..', 'escape.mjs')` after
`checkoutOf` — so that at BASE the entry resolves to an existing file, becomes a candidate and
the throwing stub fires; the sim removes it on exit. The sim ends with
`console.log(\`\nALL TESTS PASSED (${passed})\`)`, so its sentinel line begins with the sentinel
and carries a count; group the new legs under a comment naming this task, before the `cleanup()`
call.
**BASE facts:** (generated at a526641)
- `files` at `fleet/referee.mjs:77` blob b1da45e
- `abs` at `fleet/confine-hook.mjs:310` blob cb77dc8
- `linkProduces` at `fleet/referee-linker.mjs:343` blob f6374e7
- `skipped` at `fleet/referee-linker.mjs:366` blob f6374e7
- `exec` at `fleet/publish-fold-block.mjs:69` blob 65a8466
- `linkMjs` at `fleet/referee-linker.mjs:190` blob f6374e7
- `linkPy` at `fleet/referee-linker.mjs:234` blob f6374e7
- `stderr` at `fleet/tests/_sandbox_boot_helpers.mjs:749` blob eee4b3b
- `code` at `fleet/claude-token.mjs:299` blob b7e8e7b
- `entry` at `fleet/publish-fold.mjs:718` blob 39fbd16
- `rel` at `fleet/referee-linker.mjs:368` blob f6374e7
- `LINKABLE` at `fleet/referee-linker.mjs:48` blob f6374e7
- `isFile` at `fleet/referee-linker.mjs:325` blob f6374e7
- `linkTs` at `fleet/referee-linker.mjs:287` blob f6374e7
- `execSeam` at `fleet/run-main.mjs:178` blob 4cb8b21
- `fleet/run-main.mjs` blob 4cb8b21
- `boom` at `fleet/tests/test_referee_linker.mjs:149` blob 5eec5f2
- `recorder` at `fleet/tests/test_lobby.mjs:45` blob b3bd0fe
- `checkoutOf` at `fleet/tests/test_referee_linker.mjs:102` blob 5eec5f2
- `fleet/tests/test_referee_linker.mjs` blob 5eec5f2
- `status` at `fleet/claude-token.mjs:358` blob b7e8e7b
- `foo` at `fleet/tests/fixtures/referee/linker-mjs-1/base/src/foo.mjs:1` blob 1b26155
- `resolved` at `fleet/tests/test_referee_linker.mjs:316` blob 5eec5f2
- `within` at `fleet/confine-hook.mjs:63` blob cb77dc8
- `second` at `fleet/tests/test_claude_token.mjs:281` blob 15a4988
- `defaultExec` at `fleet/doctor.mjs:218` blob f9a1174
- `fleet/tests/fixtures/referee/linker-mjs-1/task.json` blob 8712432

**Proof:**
- Test: `fleet/tests/test_referee_linker.mjs`
- Guard: `fleet/tests/test_referee_linker.mjs`
- Run: node fleet/tests/test_referee_linker.mjs | tail -1 | grep -q 'ALL TESTS PASSED'
- Legs: (a) with `escape.mjs` present beside the clone directory,
  `link({bullet: '`foo(a)`', files: ['../escape.mjs'], cloneDir, exec: boom})` resolves without
  throwing to `status` `unlinked` and a detail containing `../escape.mjs: outside the clone` [M1,
  M2]; (b) the same call with `files: [<the absolute path of that escape.mjs>]` resolves to
  `unlinked` with a detail containing `outside the clone` and that absolute path [M1, M2]; (c)
  `files: ['../escape.mjs', '/etc/passwd']` with `exec: boom` resolves to `unlinked` whose detail
  contains `../escape.mjs: outside the clone` and `/etc/passwd: ` [M1, M2]; (d)
  `files: ['../escape.mjs', 'src/foo.mjs']` on a clone holding `src/foo.mjs` that exports `foo`,
  with the `recorder` exec, resolves to `resolved` and the recorder holds exactly one call whose
  argv text contains `src/foo.mjs` and not `escape.mjs` [M1, M2]; (e) `files: ['../nope.mjs']`
  where no such file exists, with `exec: boom`, resolves to `unlinked` with a detail containing
  `../nope.mjs: outside the clone` and not `not in the clone` [M1]; (f) a seam-shaped exec
  resolving `{code: null, stdout: '', stderr: ''}` on an `.mjs` candidate with `timeoutMs` 500
  resolves to `unlinked` with a detail containing `node produced no JSON within 500ms` [M3]; (g)
  the same exec on a `.py` candidate resolves to `unlinked` with a detail containing
  `python3 produced no JSON within 500ms` [M3]; (h) an exec resolving
  `{code: 1, stdout: '', stderr: '  \n'}` on an `.mjs` candidate gives a detail containing
  `within 500ms` — whitespace-only stderr is empty [M3]; (i) an exec resolving `{code: 0,
  stdout: '', stderr: '', killed: true}` gives a detail containing `timeout after 500ms` and not
  `within`, and an exec resolving `{code: null, stdout: '', stderr: '', signal: 'SIGKILL'}` gives
  the same [M3]; (j) an exec resolving `{code: 1, stdout: '', stderr: 'boom line\nsecond'}` gives
  a detail containing `boom line` and neither `within` nor `second` [M3]; (k) the existing
  hang case — a module that neither exits nor prints, under `defaultExec` with `timeoutMs`
  500 — still answers `unlinked` with `timeout` in the detail within five seconds [M3].

**Stale-if:**
- path-absent: `fleet/tests/fixtures/referee/linker-mjs-1/task.json`
- issue-closed: #819
