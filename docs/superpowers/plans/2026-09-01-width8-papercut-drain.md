# The width-8 papercut drain — eight independent contracts, one wave

**Grammar:** claims-v1

**Goal:** Drain eight filed, independent papercuts in one fleet run whose shape is the
measurement: every task is its own contract, so the compiler should derive no edges and the
wave should run eight wide. The run's own events give each task's chain duration; the sum of
chains is the serial estimate, the wall is the wide result.

**Tech Stack:** Node ESM in `fleet/` (no new npm dependencies; `fleet/package.json`
unchanged); Python 3 stdlib + pytest for the compiler and the `tests/` exams.

**Spec:** issues #524, #527, #385, #460, #514 (each measured record is its own spec); the
2026-09-01 run-47 bottleneck read (one agent at a time for 79 minutes on a width-1 plan) is
the rationale for driving these together rather than one at a time.

## Global Constraints

- The verification periphery stays frozen: `skills/ultrapowers/scripts/gate_check.py`,
  `ultra_gate.py`, `run_acceptance.sh` and `finalize_report.py` are byte-identical to BASE.
  Any new compiler line is an `ADVISORY grammar: ` line; `compile_plan.py --check` exit codes
  and its output on `evals/fixtures/*` and `tests/fixtures/*` are unchanged.
- No engine or role change: `fleet/run-engine.mjs`, `fleet/run-main.mjs`, `fleet/run-waves.mjs`,
  `fleet/run-worker.mjs`, `fleet/roles/*` are byte-identical to BASE.
- Every shape a sibling test already pins for the *absent-flag* case stays byte-identical:
  the sandbox assignment payload with no `overlap`, `oneDriverArgs` with no fourth argument,
  `buildDriveOptions` with no `--overlap`, and every existing PR-body section.
- Every new `fleet/tests/test_*.mjs` runs with no network, no live ssh and no `gh`, finishes
  under the suite's 120 s per-file cap, and ends by printing `ALL TESTS PASSED`.
- No token value appears on argv or in any rendered PR body; anything rendered from a
  drive error passes through the existing `scrub`.

**Acceptance:** suite — the committed suite is the verification.

**Parallelization rationale:** independence here is a property of the contracts, not the
files. Three tasks touch `fleet/drive.mjs` (3, 4, 7) and two touch `fleet/RUNBOOK.md`
(1, 3); those same-file text edits stand by design and fold at merge — this run is where the
fold earns it on real work. Each such task's Context names its siblings and the region it
owns.

### Task 1: The launch snippet detaches

**Type:** implementation

**Files:**
- Modify: `fleet/RUNBOOK.md`
- Modify: `skills/ultrapowers/SKILL.md`
- Test: `tests/test_launch_snippet_detaches.py`

**Claim:** the RUNBOOK launch snippet should fully detach — `ssh -f`, `setsid`, or explicit fd redirection that actually releases the channel (quoted from #524)
Machine: every launch snippet in `fleet/RUNBOOK.md` and `skills/ultrapowers/SKILL.md` that starts `node fleet/drive-one.mjs` or `node fleet/race.mjs` over ssh starts the driver with `setsid -f`, keeps `</dev/null` and the `>… 2>&1` redirects, and carries no bare `nohup … &` job; a test reads both files and pins all of that.

**Authorized-by:** #524 item 1

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** Measured live on the orchestrator (real OpenSSH `sshd-session`, remote shell
`/bin/bash`, 2026-09-01 21:50 UTC), a 45 s child under each launch shape, wall of the
`ssh -n` client:

- A `nohup node -e … </dev/null >f 2>&1 &` — 47 s (the RUNBOOK:363 / SKILL.md:30 shape)
- E `nohup node -e … </dev/null >f 2>&1 & disown` — 47 s
- G `nohup node -e … </dev/null >f 2>&1 & exit 0` — 47 s
- D `setsid -f node -e … </dev/null >f 2>&1` — 2 s
- F `(nohup node -e … </dev/null >f 2>&1 &)` — 2 s (the RUNBOOK:250 drain shape)

So the redirects alone do not release the channel; a new session does. `setsid -f` is the
canonical form (one token, greppable, `/bin/setsid` present on the golden). The three
snippets today: `fleet/RUNBOOK.md:363` (single run), `fleet/RUNBOOK.md:250` (the drain loop,
subshell form — normalize it too), `skills/ultrapowers/SKILL.md:30` (the client's launch
line). Add the `fleet/race.mjs launch` invocation to the RUNBOOK's §Live W1 run in the same
form. Keep `mkdir -p` first and the `</dev/null` (#466 and the stdin note above the snippet
explain both). A sibling task (3) also edits `fleet/RUNBOOK.md`, in §Park triage (~:583-615);
stay inside the launch snippets.

**Proof:**
- Test: `tests/test_launch_snippet_detaches.py`
- Legs: (a) every line in either file matching `node fleet/(drive-one|race)\.mjs` inside an `ssh` command contains `setsid -f` immediately before `node`; (b) each such line still contains `</dev/null`, a stdout redirect `>` to a file path, and `2>&1`, so all three fds leave the channel; (c) neither file contains `nohup node fleet/drive-one.mjs` or `nohup node fleet/race.mjs`; (d) the count of such launch lines is at least three in `fleet/RUNBOOK.md` and at least one in `skills/ultrapowers/SKILL.md`, so a deletion cannot green the test; (e) the test carries the probe table above as its docstring so the reason survives the edit.

**Stale-if:**
- issue-closed: #524

### Task 2: `--check --renders --base` names the order it would impose

**Type:** implementation
**Review:** adversarial

**Files:**
- Modify: `skills/ultrapowers/scripts/compile_plan.py`
- Test: `tests/test_compile_plan_claims_edges.py`

**Claim:** Checking a claims-v1 plan with `--base` against a tree that holds a non-text same-file pair tells me the order it would impose, instead of nothing. (elicited)
Machine: `compile_plan.py --check --renders --base <root> <plan>` on a claims-v1 plan whose two tasks both name a path that `is_binary(root, path)` classifies non-text prints one line `ADVISORY grammar: non-text same-file pair — tasks <a> and <b> both name <path>; the compile orders <a> -> <b> (non-text-overlap)`, exits with the same code as without `--base`, and prints no such line when the shared path is text or when no path is shared.

**Authorized-by:** #524 item 2; run-44 gate receipt ack 4 (`fleet-receipts/run-44/gate-receipt.json:60`)

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** Today `--check` returns at `compile_plan.py:2226` before `build_edges` (:2369)
runs, and `claims_advisories(tasks, tree_root)` (:1246) gates its whole same-file tier on
`if tree_root is None:` (:1294) — so with `--base` the not-classifiable advisory (:1303-1309)
is suppressed and the ordering is never computed. The classifier is `is_binary(tree_root,
rel_path)` (:1424: symlink, or a NUL in the first 8192 bytes); the edge rule is Tier 2b
(:1641-1656, `add(a, b, "non-text-overlap")`, document order, cycle-guarded). The fix is
per-pair: when a tree root is supplied, ask `is_binary` per shared path and emit the positive
advisory for non-text ones; text pairs stay silent (they fold). The `--base requires
--renders` guard (:2198) and the help text (:2171-2178) may need to follow. Frozen-vocabulary
rules: new output is an `ADVISORY grammar: ` line, never a violation; rc unchanged; the
byte-pins in `tests/test_compile_plan_claims_edges.py` (`_advisories`) and
`tests/test_check_renders.py:85` on the canonical fixtures stay green. Existing helpers to
reuse: `_overlap_plan` (:347, two tasks both `Modify: assets/logo.png`), `_tree` (:360),
`_check` (:103, returns `(rc, lines)`), and the nearest pin
`test_without_a_tree_the_pair_is_unordered_and_draws_the_advisory` (:392).

**Proof:**
- Test: `tests/test_compile_plan_claims_edges.py`
- Legs: (a) binary shared path under `--check --renders --base <tree>`: exactly one advisory line containing `non-text same-file pair`, both task ids, the path, and `non-text-overlap`, with the ordering pair in document order; (b) symlink shared path: the same line; (c) text shared path: no line containing `non-text` and no `not classifiable` line; (d) the rc under `--base` equals the rc of the same plan checked without `--base`; (e) the no-`--base` case still draws the existing `not classifiable without a tree` advisory (the :392 pin stays); (f) `evals/fixtures/claims/plan.md` under `--check --renders --base` prints no `ADVISORY` line.

**Stale-if:**
- issue-closed: #524

### Task 3: The park card carries the rescue

**Type:** implementation
**Review:** adversarial

**Files:**
- Modify: `fleet/drive.mjs`
- Modify: `fleet/RUNBOOK.md`
- Test: `fleet/tests/test_drive_pr_rescue.mjs`

**Claim:** The park card for a publish-failed run should print those exact commands with the real sha/branch names, so the rescue is self-service. (quoted from #524)
Machine: when `renderPullRequestBody` is given a parked run whose `errors` carry a `push … to origin failed` or `gh pr create … failed` entry, the body contains a `## Rescue` section with one fenced `bash` block whose commands name the run's pinned ref `refs/fleet/<runId>`, the fetched tip sha, the integration branch, and the orchestrator host; a parked body without such an error, and every green body, contains no `## Rescue` section.

**Authorized-by:** #524 item 3; #497 (the run-44 comment's four-step rescue)

**Interfaces:**
- Consumes: none
- Produces: `renderPullRequestBody({ …, rescue?: { runId, tip, branch, host } })` (an optional parameter; every existing call shape unchanged)

**Context:** `renderPullRequestBody` is pure (`fleet/drive.mjs:175-283`), called once at
:1359-1371 in the publish leg; the body lands at `<evidenceDir>/pr-body-<runId>.md` (:1379).
`parkedPublish` (:1199) carries `branch` but no sha; the sha is `fetchedTip` (:1085, set
:1104-1106) and the run tip is already pinned as `refs/fleet/<runId>` (:1136-1149) — the card
must print what the drive already knows, not compute anything new. The push/`gh` failure
texts are at :1387 and :1399 and already reach the card via `errors` → `## Driver notes`; the
rescue block renders when one of those is present. The four steps, from #497's run-44
comment (prose there, never a literal block): pin the commit on the orchestrator
(`git branch -f rescue/<runId> <tip>` — or read `refs/fleet/<runId>` directly), fetch it to
the laptop over ssh (`git fetch ssh://exedev@fleet-orchestrator.exe.xyz/home/exedev/repo
refs/fleet/<runId>:refs/heads/<branch>`), push with an operator credential (`git push origin
<branch>`), open the PR by hand carrying the gate receipt (`gh pr create --head <branch>`).
Put the same block in `fleet/RUNBOOK.md` §Park triage (:601-615, "The run's tip is already
pinned") so the card and the RUNBOOK do not drift. Siblings in this wave: Task 4 also adds a
section to `renderPullRequestBody` (a runbook section, sourced elsewhere) and Task 7 threads
an option through `driveOne`; Task 1 edits the RUNBOOK's launch snippets. Add your parameter
and section without reordering the existing sections; anything rendered from `errors` is
already scrubbed. The bigger `fleet/rescue-branch.mjs` stays third-incident-gated (#497).

**Proof:**
- Test: `fleet/tests/test_drive_pr_rescue.mjs`
- Legs: calling `renderPullRequestBody` directly with the `test_drive_pr.mjs` fixture shapes, (a) parked + a `push ultra/integration-run-9 to origin failed (code 128) …` error + `rescue: { runId: 'run-9', tip: <40-hex>, branch: 'ultra/integration-run-9', host }` renders `## Rescue` with a fenced `bash` block containing `refs/fleet/run-9`, the tip sha, the branch name and the host, in that block; (b) the same with a `gh pr create … failed` error renders the block; (c) parked with neither error renders no `## Rescue`; (d) a green body with a rescue object supplied renders no `## Rescue`; (e) section order is preserved: `## Rescue` sits after `## Driver notes` and before the `Closes` lines; (f) a tip containing shell metacharacters is refused (the block is omitted and a Driver-notes line names it), never interpolated; (g) `fleet/RUNBOOK.md` contains the same four commands, matched by their verbs (`refs/fleet/`, `git fetch ssh://`, `git push origin`, `gh pr create`).

**Stale-if:**
- issue-closed: #524

### Task 4: The PR carries the post-merge runbook

**Type:** implementation
**Review:** adversarial

**Files:**
- Modify: `fleet/drive.mjs`
- Test: `fleet/tests/test_drive_pr_runbook.mjs`

**Claim:** After a fleet run, the PR tells me which release or manual tasks the plan carried, by id and title, in plan order, and says nothing when there are none. (elicited)
Machine: `renderPullRequestBody` given `runbook: [{ id, title }, …]` renders `## Post-merge runbook (N)` with one `- <id> — <title>` line per entry in the given order, and renders no such section for an empty or absent runbook; the drive fills that argument from the rescued sandbox bundle's `repo/.claude/ultrapowers/run-*/receipt.json` (`compile.post_merge_runbook` ids joined to `compile.tasks[].title`), and an unreadable bundle yields an absent runbook plus one Driver-notes line.

**Authorized-by:** #527

**Interfaces:**
- Consumes: none
- Produces: `readRunbookFromBundle(tgzPath) -> Array<{id, title}> | null`
- Produces: `renderPullRequestBody({ …, runbook?: Array<{id, title}> })` (an optional parameter; every existing call shape unchanged)

**Context:** #527 names `args.json` as the source; that is wrong — `compile_plan.py:2476-2495`
writes `args.json` and `launch.json` (:2450-2470) from the `implementation` tasks only, and
`post_merge_runbook` (:2434-2436) is exactly the `release`/`manual` set, so neither file
carries it. The runbook exists in the compiler's stdout `result` — `post_merge_runbook` ids
and `tasks[].{id,title,disposition}` (:2321-2327) — which `ultra_run.py` stores verbatim as
`receipt["compile"]` in `run-<stamp>/receipt.json` (`ultra_run.py:362-370, 430`). That file
is inside the sandbox bundle the drive pulls BEFORE teardown and before the PR body is
written (`sandboxLogPullCommand` :43-52, `pullLogsOnce` :667-685; publish :1312-1324 runs
after), at `detail.sandboxLogs` (`…/sandbox-logs/<vm>-<ts>/sandbox-logs.tgz`). Read it with
one `tar -xzO` through the injected `exec`, so the tests need no tarball on disk; a missing
bundle or missing `compile` key is `null`, not a throw. The gate receipt on the branch
carries none of this (`ultra_gate.py` writer keys: mode, stamp, reportPath, branch,
gateCheck, gateCheckExit, acceptance, verdict). Siblings in this wave: Task 3 adds a
`## Rescue` section and a `rescue` parameter to the same function, Task 7 threads an option
through `driveOne`. Add your parameter and section without reordering existing sections;
place `## Post-merge runbook` after `## Completeness-critic findings` and before
`## Receipts`. `docs/superpowers/plans/2026-09-01-511-attempt-racing.md` is a live plan
whose compiled runbook is empty — the omission case is the common one.

**Proof:**
- Test: `fleet/tests/test_drive_pr_runbook.mjs`
- Legs: calling the exports directly with the `test_drive_pr.mjs` fixture shapes, (a) `runbook: [{id:'5', title:'Deploy'}, {id:'6', title:'Rotate the key'}]` renders `## Post-merge runbook (2)` followed by `- 5 — Deploy` then `- 6 — Rotate the key`, in that order, between `## Completeness-critic findings` (or the section before it when findings are absent) and `## Receipts`; (b) `runbook: []` and an absent `runbook` render no `## Post-merge runbook` and leave the body byte-identical to today's for the P1 green fixture; (c) `readRunbookFromBundle` with an exec stub returning a `receipt.json` whose `compile.post_merge_runbook` is `["5","6"]` and whose `compile.tasks` carries ids 5 and 6 with titles returns those two entries in document order (id 6 listed before 5 in `post_merge_runbook` still renders in `tasks` order); (d) an exec stub whose tar exits non-zero returns `null`; (e) a receipt with no `compile` key returns `null`; (f) a title containing markdown is rendered verbatim, not escaped and not interpreted; (g) end to end, the way `test_drive_pr.mjs` P1 drives it: `driveOne` with the stub sandbox and an exec stub that answers the bundle's `tar -xzO … receipt.json` command with a receipt carrying `post_merge_runbook: ["5"]` and a task 5 titled `Deploy` writes a `pr-body-<runId>.md` containing `## Post-merge runbook (1)` and `- 5 — Deploy`; (h) end to end with the exec stub failing that `tar` command (non-zero exit): the written body contains no `## Post-merge runbook` section and `detail.errors` carries exactly one line naming the runbook read (`post-merge runbook:`), while the run's verdict, checks and every other section are unchanged from (g).

**Stale-if:**
- issue-closed: #527

### Task 5: The drive's diagnostics are pinned

**Type:** implementation

**Files:**
- Modify: `fleet/tests/_drive_helpers.mjs`
- Test: `fleet/tests/test_drive_diagnostics.mjs`

**Claim:** give the fixture a stderr-emitting stub and assert each diagnostic line carries it (quoted from #385)
Machine: `makeExec` accepts a per-command `stderr` and the four `execDiagnostic` call sites in `fleet/drive.mjs` (:643 `captureJson`, :685 pull sandbox logs, :1388 push, :1399 `gh pr create`) each produce a `detail.errors` line carrying that stderr text — the push and `gh` sites with the token scrubbed — and the guard-miss refusal (:503-511) is pinned as a throw for a plan absent from both `baseRef` and the working tree with an unsafe `planRel`.

**Authorized-by:** #385 items 1, 2 (item 3 landed at `b8f2fec`; items 4 and 5 are owned by Task 6, which moves the 13-series)

**Interfaces:**
- Consumes: none
- Produces: `makeExec({ …, stderr?: (cmd) => string })` (an optional stub knob; every existing call unchanged)

**Context:** `execDiagnostic` (`fleet/drive.mjs:594`) joins trimmed stdout and stderr with a
space, dropping empties; the issue counts five sites, there are four. `makeExec`
(`fleet/tests/_drive_helpers.mjs:185-208`) returns `{ code, stdout }` only — no stubbed
command has ever carried `stderr`; the only synthesized stderr in the suite is the 13e
wrapper (`test_drive.mjs:1589-1596`). Follow the wrapper precedent (`makeCaptureExec`,
`test_drive.mjs:670-681`) or add the knob to `makeExec` itself; either way the fixture's
default output stays byte-identical so every sibling sim is untouched. The guard-miss branch:
`isSafeRepoPath(planRel)` false → throw at :503-511, ahead of every read of `baseRef`; the
skip narration (`headless-fitness: … — check skipped`) at :521 is the other branch and is
already pinned by 13g. Decide refuse (the issue says it is probably right) and pin it as
such. The `.gitattributes` pin and the `docs/` invariant (items 4, 5) live in the 13-series
of `test_drive.mjs`, which Task 6 is moving in this same wave — do not edit
`fleet/tests/test_drive.mjs`. Keep the new file well under the 120 s cap: drive the
`captureJson` and pull-logs sites through `driveOne` with the stub sandbox, and the push/`gh`
sites through the publish leg the way `test_drive_pr.mjs` P4/P5 do.

**Proof:**
- Test: `fleet/tests/test_drive_diagnostics.mjs`
- Legs: with `setupDriveFixture` and a stderr-emitting stub, (a) a failing `stat` capture yields a `detail.errors` line containing the stub's stderr text; (b) a failing sandbox-log pull yields a `detail.errors` line containing it; (c) a failing push yields a line containing it with no token substring (`GITHUB_TOKEN` from the helpers) present anywhere in `detail.errors`; (d) a failing `gh pr create` likewise; (e) a plan absent at `baseRef`, absent from the working tree, with a `planRel` that fails `isSafeRepoPath`, makes `driveOne` reject with an error naming the repo-path guard, and the exec stub records zero commands; (f) `makeExec()` with no stderr knob returns objects with no `stderr` key, so the fixture default is unchanged.

**Stale-if:**
- issue-closed: #385

### Task 6: The suite's floor is no longer one file

**Type:** implementation

**Files:**
- Modify: `fleet/tests/test_drive.mjs`
- Create: `fleet/tests/test_drive_evidence.mjs`
- Create: `fleet/tests/test_drive_fitness.mjs`
- Test: `tests/test_fleet_suite_shape.py`

**Claim:** **Split it again**, the way `test_drive_lifecycle.mjs` was split off. (quoted from #460)
Machine: the scenarios of `fleet/tests/test_drive.mjs` are spread over three files under `fleet/tests/` — `test_drive.mjs`, `test_drive_evidence.mjs` and `test_drive_fitness.mjs` — with the 13-series fitness scenarios (13a–13g) all in `test_drive_fitness.mjs`, no file holding more than ten `driveOne(` call sites, and no scenario dropped; every 13-series scenario that creates `<repoDir>/docs` removes that directory, and the `.gitattributes` pin runs `git check-attr -a` on the plan path instead of `git ls-files`.

**Authorized-by:** #460; #385 items 4 and 5

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** Measured on the laptop tonight (`pytest tests/test_fleet_suite.py -n auto
--durations=8`): `test_drive.mjs` 46.8 s, `test_drive_lifecycle.mjs` 25.8 s,
`test_drive_pr.mjs` 13.4 s, suite wall 73 s — xdist schedules whole files, so the wall is
pinned by the longest file. `test_drive.mjs` is 1639 lines with 25 `driveOne(` sites;
`test_drive_lifecycle.mjs` has 16 and its header (:1-15) documents the earlier split. Every
`test_*.mjs` under `fleet/tests/` is collected by `tests/test_fleet_suite.py:5`, so new files
need no registration. The shared fixture is `setupDriveFixture()` from `_drive_helpers.mjs`;
each new file calls it once and runs `cleanup()` in its own `finally`, exactly as
`test_drive.mjs:56-75` does. Move scenarios whole, with their comments; do not rewrite
assertions. While moving the 13-series (13a-13g, `test_drive.mjs:1336-1631`): 13f
(`mkdirSync(repoDir/docs)` :1484, removes only the file :1515) and 13e (:1568 / :1629) each
leave `docs/` behind and re-violate 13d's invariant (:1475) — make each remove the directory
it created; and widen the `.gitattributes` pin (:1619-1629, `git ls-files`) to
`git check-attr -a -- <planRel>` in `repoDir`, asserting no attribute is set, which also
catches an untracked file, `.git/info/attributes` and a global `core.attributesFile`. Task 5
adds a new diagnostics file and a helper knob in this wave; it does not touch
`test_drive.mjs`. Keep each resulting file's own runtime under the 120 s cap; the point is
that none of the three is near 47 s.

**Proof:**
- Test: `tests/test_fleet_suite_shape.py`
- Legs: reading the files as text, (a) `fleet/tests/test_drive.mjs`, `test_drive_evidence.mjs` and `test_drive_fitness.mjs` all exist and are collected by the same glob `tests/test_fleet_suite.py` uses; (b) no `fleet/tests/test_*.mjs` contains more than ten `driveOne(` call sites; (c) the total count of `driveOne(` sites across the three files is 25, the count at BASE, so nothing was dropped; (d) in `test_drive_fitness.mjs` every block that contains `mkdirSync(` of a path ending in `'docs'` also contains a `rmSync(` of that same path with `recursive: true`; (e) `test_drive_fitness.mjs` contains a line with `git check-attr -a --` followed on that same line by the scenario's plan-path variable, and no file under `fleet/tests/` contains `git ls-files -- .gitattributes`; (g) every one of the seven markers `13a.` through `13g.` appears in `test_drive_fitness.mjs` and none of them appears in `test_drive.mjs` or `test_drive_evidence.mjs`; (f) each of the three files ends by printing `ALL TESTS PASSED` (the sentinel string is present in each).

**Stale-if:**
- issue-closed: #460

### Task 7: `--overlap` rides drive-one to the sandbox

**Type:** implementation
**Review:** adversarial

**Files:**
- Modify: `fleet/drive-one.mjs`
- Modify: `fleet/drive.mjs`
- Modify: `fleet/provision.mjs`
- Modify: `fleet/shim-main.mjs`
- Test: `fleet/tests/test_overlap_threading.mjs`

**Claim:** one optional field threaded drive-one → provisionRun's assignment → shim's `oneDriverArgs` (quoted from #514)
Machine: `node fleet/drive-one.mjs <plan> <runId> --overlap serialize` produces a `driveOne` option `overlap: 'serialize'`, the sandbox assignment payload carries `"overlap":"serialize"`, and `oneDriverArgs(repoDir, planPath, runId, 'serialize')` is `[…/run-main.mjs, planPath, runId, '--overlap', 'serialize']`; with the flag absent, `buildDriveOptions` carries no `overlap` key, the payload carries no `overlap` key, and `oneDriverArgs(repoDir, planPath, runId)` is byte-identical to today; any value other than `fold`/`serialize` is refused by `parseArgs` with the usage line.

**Authorized-by:** #514 (the operator chose to thread it, 2026-09-01, so fold-versus-serialize A/Bs can run on fleet substrate)

**Interfaces:**
- Consumes: none
- Produces: `oneDriverArgs(repoDir, planPath, runId, overlap?) -> string[]`
- Produces: `buildDriveOptions(parsed, deps)` with an optional `overlap` key

**Context:** The chain, hop by hop. `fleet/drive-one.mjs`: `DEFAULTS` (:23-41, no
`overlap`), `FLAGS` (:43-55, eleven entries), `parseArgs` (:64) rejects unknown flags at :77
with `usage()` (:58-62), `buildDriveOptions` (:124-141) uses the spread-only-when-set idiom
(:143, `sandboxCpu`) — copy it. `fleet/drive.mjs` `driveOne` destructures its options from
:384 (`engineEnv` :412, `provision` :424) and calls `provision({ … })` at :879-901; add
`overlap` to both. `fleet/provision.mjs` `provisionRun` (:156) validates positively per field
(:163-168, no unknown-field rejection) and builds the payload at :213 as
`{ runId, token, wsUrl, ttlMs, planPath, ...(isNonEmptyString(engine) ? { engine } : {}) }`
— the `engine` spread is the exact precedent for an optional `overlap`. `fleet/shim-main.mjs`:
`readAssignment` (:148), `main` destructures at :811-814, `invokeEngineRun` (:743, called
:893) uses `oneDriverArgs(repoDir, planPath, runId)` (:687-688, used :785). The engine side
already works: `fleet/run-main.mjs` `FLAGS['--overlap']` (:90), forwarded at :422 to
`ultra_run.py --overlap` (`ultra_run.py:107-122`, choices :279). Existing pins that must stay
green untouched: `test_drive_one.mjs:29-45, :112, :159, :186-215`; `test_shim_main_gate.mjs:286-289`
(exact argv) and :305; `test_drive_lifecycle.mjs:619` (launched command string);
`test_provision.mjs:79-85` (`no engine key when unset — old assignments stay byte-identical`);
`test_run_main.mjs:36-38`. Siblings in this wave: Tasks 3 and 4 edit `renderPullRequestBody`
in `fleet/drive.mjs` (:175-283) — your edits are the `driveOne` option list and the
`provision({…})` call only. The serialize arm is the A/B rollback knob (Amendment 9: fold is
the only merge path); the fleet default stays knobless when the flag is absent.

**Proof:**
- Test: `fleet/tests/test_overlap_threading.mjs`
- Legs: (a) `parseArgs(['p.md','run-1','--overlap','serialize']).overlap === 'serialize'` and `buildDriveOptions` of it carries `overlap: 'serialize'`; (b) `parseArgs(['p.md','run-1'])` yields an object with no `overlap` key and `buildDriveOptions` of it has no `overlap` key (`'overlap' in o === false`); (c) `parseArgs(['p.md','run-1','--overlap','fold']).overlap === 'fold'` and `buildDriveOptions` of it carries `overlap: 'fold'`; `parseArgs(['p.md','run-1','--overlap','sideways'])`, `parseArgs(['p.md','run-1','--overlap','FOLD'])` and `parseArgs(['p.md','run-1','--overlap'])` (no value) each throw an error containing `usage:`; (d) `provisionRun` with `overlap: 'serialize'` delivers a payload (parsed from the `FLEET_EOF` heredoc as `test_provision.mjs:79-85` does) with `overlap: 'serialize'`, and without it the payload has no `overlap` key and is byte-identical to the current pin's; (e) `oneDriverArgs('/repo','docs/plan.md','run-24','serialize')` deep-equals `['/repo/fleet/run-main.mjs','docs/plan.md','run-24','--overlap','serialize']` and the three-argument call deep-equals today's pinned array; (f) `invokeEngineRun` given an assignment with `overlap: 'serialize'` spawns the engine with those five argv entries, and given one without spawns exactly today's three.

**Stale-if:**
- issue-closed: #514

### Task 8: The marker contract reads headings, not fences

**Type:** implementation

**Files:**
- Modify: `skills/ultrapowers/references/plan-markers.md`
- Modify: `tests/test_marker_contract.py`
- Test: `tests/test_plan_markers_no_bake.py`

**Claim:** plan-markers.md carries no BAKE fences; the marker contract test reads the same sections by their headings. (elicited)
Machine: `skills/ultrapowers/references/plan-markers.md` contains no `BAKE` token; `tests/test_marker_contract.py` extracts the `## Marker syntax` and `## Type semantics (dispositions)` sections by heading (from the heading to the next `## ` line) and every assertion it made on the two fenced blocks holds on those sections; the string `BAKE` appears in neither file.

**Authorized-by:** the 2026-09-01 remnant sweep residue item 1 (`2553120` left the fences because the test anchored on them); 0.3.0 deleted the bake step (PR #434)

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** The four fences are `<!-- BAKE:MARKER_SYNTAX -->` (:30, with a note line added
right after it by `2553120` saying they are test anchors), `<!-- /BAKE -->` (:49),
`<!-- BAKE:TYPE_SEMANTICS -->` (:84), `<!-- /BAKE -->` (:93). `tests/test_marker_contract.py`
parses them with `MARKER = re.compile(r"<!-- BAKE:(\w+) -->(.*?)<!-- /BAKE -->", re.DOTALL)`
(:13) in `contract_blocks()` (:17-20) and reads `blocks["MARKER_SYNTAX"]` in two tests
(:27-46) and both names in `test_contract_has_bake_blocks_for_mirroring` (:74-77); every other
test in the file reads the whole document. Replace `contract_blocks()` with a
heading-sectioner keyed by the two headings that
`test_contract_keeps_the_runtime_half_intact` (:107-113) already pins, and rename the
mirroring test to say what it now checks. Delete the fences and the anchor note; keep every
sentence between them. `tests/test_check_renders.py` and the compiler never read the fences.

**Proof:**
- Test: `tests/test_plan_markers_no_bake.py`
- Legs: (a) `plan-markers.md` contains no substring `BAKE`; (b) it still contains the headings `## Marker syntax` and `## Type semantics (dispositions)`, and the `## Marker syntax` section (heading to next `## `) contains `**Review:**`, `**Commutes:**`, `own `**Files:**`` and `marker conflict`, and the `## Type semantics (dispositions)` section contains all four of `implementation`, `gate`, `release`, `manual`; (c) `tests/test_marker_contract.py` exists, contains no substring `BAKE` and no `<!--`, contains both heading strings `## Marker syntax` and `## Type semantics (dispositions)`, and defines at least thirteen `def test_` functions (its count at BASE), so a deletion or a gutting cannot green this leg; (d) running `python3 -m pytest -q tests/test_marker_contract.py` as a subprocess exits 0 against the fence-free `plan-markers.md`, and the same invocation exits non-zero when run against a temporary copy of `plan-markers.md` whose `## Marker syntax` section has had `**Commutes:**` removed (via the test module's `CONTRACT` path monkeypatched by environment or import), proving the sectioner reads the heading, not a fence; (e) the anchor note sentence `no bake step exists since 0.3.0` is gone from `plan-markers.md`.

**Stale-if:**
- path-absent: `skills/ultrapowers/references/plan-markers.md`
