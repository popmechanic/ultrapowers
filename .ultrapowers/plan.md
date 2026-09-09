# TinyApp state exams, the engine half — the exam learns where it is, the record reaches the picture

**Grammar:** claims-v1

**Claim:** After a run on a TinyApp target, the evidence link in the pull request reaches the state exams' record — the store diff, the picture and the mutant verdict, one directory per task and pass — and the report says, per task, which moves ran. (elicited)

**Goal:** Plan B of the signed spec `docs/superpowers/specs/2026-09-09-tinyapp-state-exams.md`
(map #525 The Verification Frontier; ticket #758 is its first cut and closes only after the
first run of §4.3, so this plan carries no `**Closes:**` line). The Claim is the operator's
confirmed reading of the spec's §3.6 last sentence ("the PR body's evidence link therefore
reaches the PNG: that is the operator's greenlight surface") and §3.8 item 4; it was confirmed
in the authoring session, not quoted from an issue. Plan A (the `tinyapp-exam` helper and the
fixture TinyApp, on the fixture repository) is not this plan. This plan is the seven engine
edits of spec §3.8 plus the one ultrawrite authoring rule (§3.8 last paragraph, §7 step 3, §8
Adds): (1) the exam environment contract — `ULTRA_TASK`, `ULTRA_RUN_DIR`, `ULTRA_EXAM_PASS`
beside `ULTRA_BASE` on both exam call sites and the per-task `Run:`/`Check:` sites, the
integrated exception; (2) the renderer variable — `fleet.json.render` → the setup script writes
`/etc/fleet/render.env` → boot sources it and passes `TINYAPP_RENDER_URL=${TINYAPP_RENDER_URL:-}`
as one `env` argv entry, and the launcher attaches the third integration and refuses on the
laptop when it is configured but absent; (3) `collect_evidence` copies `state-exams/` file by
file; (4) the report row `tasks[].stateExams`; (5) the eighth doctor row `render` with `render`
in `CONFIG_KEYS`; (6) the driver's `STATE EXAM:` settled block for the reviewer; (7) the five
`fleet/CONTRACT.md` edits and `report-format.md`/`first-run.md`.
**Launch note:** run-69 (#729, the mechanical referee) is in flight and edits `fleet/run-engine.mjs`,
`fleet/sandbox-boot.sh` (`collect_evidence`), `fleet/CONTRACT.md`, `report-format.md` and
`fleet/roles/reviewer.md`. This plan is authored against `29eeda47` and is launched only after
run-69 lands and 0.3.23 is released; **BASE facts are re-pinned before launch**
(`pin_base_facts.py --base <new base> --write`, then `--verify`), and every Context below names
regions and behaviours, never line numbers, so the re-pin is the only edit the new base needs.
Assumptions taken where the spec left a choice, each the least machinery: (a) the exam-stem
rule — the engine does not derive a stem from a `Test:` path; it lists the directories the
helper wrote under `state-exams/task-<id>/`, splits each name at its last `-` into
`<stem>` and `<pass>`, and reports one row per stem from its highest numeric pass — so the
engine never has to agree with the helper about how a stem is spelled; (b) `ULTRA_EXAM_PASS`
at a per-task site is the engine's own `iter` number as a string — `0` at the pre-review pass
and its repeat after `fix:<id>:0`, and the review round number at a round that re-executes —
which is `0` and `2` as the loop stands, inside the spec's `0|1|2`; (c) the boot script reads
the env file at `${FLEET_RENDER_ENV:-/etc/fleet/render.env}` — the contract's literal stays
`/etc/fleet/render.env` and the variable is the same relocatable-root device `FLEET_HOME`
already is, so a sim can plant the file; (d) the launcher's refusal text names the walk's
section (`references/first-run.md §render`) rather than the `integrations add http-proxy`
command, so no fleet script carries the string `api.cloudflare.com`; (e) the setup script and
the launcher validate the two `render` values before either is interpolated — `integration`
matches `^[a-z][a-z0-9-]*$` and `account` matches `^[A-Za-z0-9_-]+$` — a refusal, never a
sanitizing rewrite; (f) the CONTRACT's `Laptop config` bullet, which says "exactly two keys",
gains `render` (and names `account`) as part of edit 4, since a contract that lists the doctor's
`render` row and forbids the key it reads would contradict itself; (g) the `STATE EXAM:` block is
appended after the `CHECK EVIDENCE` block of the reviewer prompt and renders nothing at all for a
task with no record (the run-51 rule), so every prompt of a task without a state exam is
byte-identical to today's.

**Tech Stack:** Node 22 ESM (`fleet/*.mjs`, `node:` modules only — `fleet/package.json` declares
no dependency), bash (`fleet/sandbox-boot.sh`, the generated setup script), Markdown contract and
reference files. The engine sims run the real engine below the agent seam (real git, real
clones-at-BASE, real `withPatchCapture`, the real `sh` seam) with canned judgments through
`rig()` of `fleet/tests/_engine_helpers.mjs`, whose repository's suite is `bash check.sh`. The
boot sims run the real `fleet/sandbox-boot.sh` with every external command stubbed on `PATH`
through `fleet/tests/_sandbox_boot_helpers.mjs`. The launch sims drive the real `launch()` with
an injected `exec` seam from `fleet/tests/_lobby_helpers.mjs` against a real bare target
repository. The committed suite is `python3 -m pytest` from the repo root, which bridges every
`fleet/tests/test_*.mjs` through `tests/test_fleet_suite.py` (sentinel `ALL TESTS PASSED`, no
network).

**Parallelization rationale:** two waves. Wave 1, width 6: the engine seam with its sim (Task 1),
the boot script with its sim (Task 2), the setup script with its sim (Task 3), the doctor with
`first-run.md` and its sims (Task 4), the contract (Task 6) and the ultrawrite rule (Task 7) name
no common file and consume no common symbol; the literals they share — the four variable names
and the pass values, the `render.env` line, the `state-exams/` layout, the row shape — are written
into every Context that touches them. Wave 2, width 1: Task 5, the launcher, `Consumes:`
Task 4's `fleetConfigRender` and Task 3's widened `renderSetupScript`, and needs their runtime
behaviour, not their shape — its sim runs the real `launch()`, whose `import` of the doctor
module has to resolve the new export and whose `new` line's stdin has to carry the heredoc the
real setup-script renderer writes, so a stub of either would prove nothing about the seam. No
two tasks name one file.

## Global Constraints

- Check: git diff --quiet $ULTRA_BASE -- skills/ultrapowers/scripts/gate_check.py skills/ultrapowers/scripts/ultra_gate.py skills/ultrapowers/scripts/run_acceptance.sh skills/ultrapowers/scripts/compile_plan.py
- Check: git diff --quiet $ULTRA_BASE -- fleet/roles fleet/lobby.mjs fleet/exam-paths.mjs fleet/strip-exams.sh fleet/publish-fold.mjs
- Check: ! grep -rn 'api.cloudflare.com' fleet/run-engine.mjs fleet/sandbox-boot.sh fleet/setup-script.mjs fleet/launch.mjs fleet/doctor.mjs
- The verification periphery is frozen (0.1.0): the first Check pins the three gate scripts and
  the compiler, whose diagnostic vocabulary and task JSON are read here and never changed. The
  second pins what this plan does not own: every role file (the `STATE EXAM:` block is a driver
  block, never a role edit — spec §3.8 item 6), the lobby (nothing new rides the comment), the
  reserved exam directory and the publish fold.
- The renderer is reached only through exe.dev's edge: the one URL any fleet script writes is
  the proxy address `https://<integration>.int.exe.xyz/client/v4/accounts/<account>/browser-rendering`
  — the third Check is that no fleet script names Cloudflare's own host. No token, no bearer and
  no `ANTHROPIC_API_KEY` on any VM or in any argv; nothing is attached to `tag:fleet`.
- Amendment 10 holds: models never run git; every git command in the sims is the sim's own.

**Acceptance:** suite — the committed suite is the verification.

### Task 1: The exam learns where it is, and the record reaches the report and the referee

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/run-engine.mjs`
- Modify: `skills/ultrapowers/references/report-format.md`
- Test: `fleet/tests/test_run_engine_state_exams.mjs`

**Claim:** An exam the driver runs can tell which task it is, which run directory to write
under and which pass it is; after the run, every task row of the report carries its state-exam
record, and a referee reading a task whose every mutant was killed is told that duty 5 is
settled for that exam file. (derived)
Machine: M1. Both exam call sites — the at-BASE probe in the examiner's clone and `runExam` in
the graded clone — execute the exam command with an environment that is the process's own plus
`ULTRA_BASE` (the task's base sha), `ULTRA_TASK` (the task id), `ULTRA_RUN_DIR` (the engine's
`paths.runDir`, absolute) and `ULTRA_EXAM_PASS`, which is `base` at the probe and the pass's
`iter` number as a string at `runExam` — `0` at the pre-review pass and `2` at the round-2
re-execution after a fix; the per-task `Run:` and `Check:` sites receive the same four
variables with the same `ULTRA_EXAM_PASS` value as the exam of that pass.
M2. The integrated `Run:` pass on the integration clone receives `ULTRA_BASE`, `ULTRA_TASK`
and `ULTRA_EXAM_PASS=integrated` and no `ULTRA_RUN_DIR`; the integrated `Check:` pass receives
`ULTRA_BASE` and none of the other three; the suite command receives none of the four.
M3. Every `tasks[]` row of the report carries `stateExams`: an array with one element per
state-exam stem recorded under `<runDir>/state-exams/task-<id>/`, where a stem is a directory
name `<stem>-<pass>` split at its last `-`, the element is read from the stem's highest
numeric pass (never `base`), and the element is
`{exam: <stem>, store_ms, render_ms, render, mutant_killed, contract}` with `store_ms` and
`render` from that directory's `walls.json`, `render_ms` from `walls.json` when `render` is
`ran` and `null` otherwise, `mutant_killed` the `killed` of `mutant.json`, and `contract`
`ok` when `contract.json`'s `breach` is `null` and the breach string otherwise; a task with no
such directory carries `stateExams: []`.
M4. When a task's `stateExams` (read the same way, at the time the review prompt is built)
is non-empty and every element's `mutant_killed` is `true`, the reviewer prompt ends with a
block beginning `STATE EXAM:` that names each element's `exam`, its `mutant.json` `path` and
`killed: true` on one line per exam, and states that duty 5 is settled for the exam file(s)
named and that the implementer's own tests are not settled by it; when the record is empty or
any element's `mutant_killed` is `false`, the prompt carries no `STATE EXAM` text at all.
M5. `skills/ultrapowers/references/report-format.md` declares `stateExams` in the schema's
`tasks[]` properties and in the field-reference table, naming the six element keys and the
highest-pass rule.

**Authorized-by:** spec `docs/superpowers/specs/2026-09-09-tinyapp-state-exams.md` §3.5, §3.6,
§3.8 items 1, 4 and 6; spec review round 2 finding 1, round 3 findings 1, 5 and 6, round 4
findings 4 and 5.

**Interfaces:**
- Consumes: none
- Produces: `stateExamsOf(runDir, taskId) -> Array<{exam, store_ms, render_ms, render, mutant_killed, contract}>`

**Context:** The engine's shell seam is `sh(cmd, cwd, env)` (`shOf(exec)`), and `execSeam`
spawns with `env || process.env` — a passed env replaces the environment whole, which is why
`baseEnv(sha)` spreads `process.env` first. Today the two exam sites call `sh(examRunCmd, <dir>)`
with no env: the probe runs in `examDir` (the examiner's clone, a tree at BASE) right after the
examiner returns, and `runExam(iter)` runs in `cloneDir` at the pre-review pass (`iter` 0, and
again at 0 after the `fix:<id>:0` round) and at a review round that re-executes (round 1 reads
the pre-pass evidence; round 2 calls `runExam(2)` after `fix:<id>:1`). The per-task
`runCommands(iter)` and `runChecks(iter)` sites already pass `baseEnv(baseShaForTask)`; the
integrated sites pass `baseEnv(baseSha)` (the run base, never the adopted head — the comment
there says why, keep it). The suite (`sh(testCmd, integ)`) and the bootstrap keep the default
environment. `paths.runDir` is the engine's run directory — on the fleet
`<target>/.claude/ultrapowers/run-<N>`, the same value workers receive as `FLEET_RUN_DIR`; in
the sims it is the rig's `runDir`. Task ids are strings (`task.id`).

The record the helper (Plan A, not this repository) writes, verbatim from the spec: under
`$ULTRA_RUN_DIR/state-exams/task-$ULTRA_TASK/<exam-stem>-$ULTRA_EXAM_PASS/` the files
`store-diff.json`, `dom.html`, `screenshot.png`, `mutant.json` (`{killed: true|false, path}`),
`walls.json` (`{store_ms, render_ms, mutant_ms, render: "ran"|"skipped"}`) and `contract.json`
(`{clock: "<iso>", breach: null | "<line>"}`). The helper writes nothing when `ULTRA_RUN_DIR` is
unset, which is why the integrated `Run:` gets no `ULTRA_RUN_DIR` (M2) and why nothing is ever
written for pass `integrated`. The report row, verbatim from the spec:
`[{exam, store_ms, render_ms|null, render: "ran"|"skipped", mutant_killed, contract: "ok"|"<breach>"}]`.
The read-back is one pure function of `(runDir, taskId)` — the `Produces:` above — called once
per task row when the report is assembled (map over `taskResults` before the return object is
built, the way `missingDeliverables` is derived there; every `tasks[]` row gets the key, including
`failed` rows) and once more per review round for M4; a directory whose three JSON files are
missing or unparsable yields an element with `null` in the unreadable fields rather than a
throw. Pass ranking: the suffix after the last `-` of the directory name; `base` and any
non-numeric suffix are excluded from the ranking; a stem whose only directory is `-base` yields
no element.

The `STATE EXAM:` block is the `REFEREE:` pattern of #729 (run-69, in flight): a driver block
appended to the reviewer prompt, per task, never a role-file edit. Its shape here — the
literal the sim reads:

    STATE EXAM: the driver read this task's state-exam record and every mutant was killed, so
    duty 5 is settled for the exam file(s) named below and for nothing else — the implementer's
    own tests stay under duty 5.
    - <exam>: mutant <mutant.json path> killed: true

one `- ` line per element, and the block is joined onto the prompt after `checkEvidenceBlock`
with the same `\n\n` seam every other block uses. Export it beside `examEvidenceBlock` as
`stateExamBlock(rows)` returning `''` for an empty or not-all-killed input, so the prompt of a
task with no record is byte-identical to today's (the run-51 rule the other blocks cite).

`report-format.md` (M5) is the report contract: add `"stateExams"` to the schema JSON under
`tasks[].properties` — an array of objects with the six keys, `render_ms` typed
`["integer","null"]`, `render` an enum of `ran`/`skipped`, `mutant_killed` boolean — and one
`tasks[].stateExams` row in the field-reference table saying what each key is read from and
that the row is the highest-numbered pass, never `base`. Check every field name you write
against the JSON above before writing it; a Context that names a field the helper does not
write is the run-10 trap.

How the sim proves M1/M2 without a helper: the examiner stub writes a `t1_test.sh` whose body
`printenv`s the four names into `$ULTRA_RUN_DIR/probe/env-$ULTRA_EXAM_PASS.txt` (one
`NAME=value` line each, `cwd=$PWD` beside them) and, when `ULTRA_EXAM_PASS` is numeric, also
writes `$ULTRA_RUN_DIR/state-exams/task-$ULTRA_TASK/buy-milk-$ULTRA_EXAM_PASS/walls.json`,
`mutant.json`, `contract.json` with fixed contents — so the driver's own executions leave the
evidence the assertions read, and no assertion trusts a canned reply. One command,
`sh -c 'printenv | grep ^ULTRA_ | sort'`, serves as the task's `proofRuns[0]` and as the run's
one `constraintChecks` entry (`extraArgs`), so every site's environment is read as the
sorted `ULTRA_` lines in that command's recorded stdout — four at a per-task site, three at the
integrated `Run:`, one at the integrated `Check:`; the rig's `bash check.sh` is the suite, and a
`check.sh` that appends `printenv | grep ^ULTRA_` to a file gives the suite's negative reading
(`grep` exits 1 on no match, so end the script with `true` to keep the suite green). The integrated readings come from the same `Run:` re-executed
on the integration clone (the `driver:integrated-run` event marks it). The reviewer stub captures
every prompt whose label starts `review:` so M4 reads the real prompt bytes. `t1_test.sh` exits
non-zero until `out.txt` exists (red at BASE, green after the implementer stub writes it), the
shape `test_run_engine_exam_evidence.mjs` already uses. Isolate `CLAUDE_CONFIG_DIR` is moot —
no agent CLI is spawned; every judgment is canned.
**BASE facts:** (generated at a526641)
- `runExam` at `fleet/run-engine.mjs:1574` blob 9b84b07
- `base` at `fleet/doctor.mjs:305` blob f9a1174
- `render` at `evals/fixtures/contend-wide/reference/clitool/cli.py:26` blob 28b0cfd
- `ran` at `fleet/launch.mjs:392` blob 8cc2fc3
- `contract` at `fleet/tests/test_launch_effort.mjs:282` blob 2829aa7
- `ok` at `fleet/publish-fold.mjs:116` blob 39fbd16
- `exam` at `fleet/publish-fold.mjs:163` blob 39fbd16
- `skills/ultrapowers/references/report-format.md` blob 9357701
- `execSeam` at `fleet/run-main.mjs:178` blob 4cb8b21
- `examDir` at `fleet/run-engine.mjs:1195` blob 9b84b07
- `cloneDir` at `fleet/referee.mjs:225` blob b1da45e
- `runDir` at `fleet/run-main.mjs:588` blob 4cb8b21
- `integrated` at `fleet/tests/test_run_engine_pre_review.mjs:827` blob 9b06675
- `taskResults` at `fleet/run-engine.mjs:915` blob 9b84b07
- `missingDeliverables` at `fleet/run-engine.mjs:2664` blob 9b84b07
- `failed` at `fleet/run-engine.mjs:1057` blob 9b84b07
- `checkEvidenceBlock` at `fleet/run-engine.mjs:357` blob 9b84b07
- `examEvidenceBlock` at `fleet/run-engine.mjs:323` blob 9b84b07
- `skipped` at `fleet/referee-linker.mjs:366` blob f6374e7
- `constraintChecks` at `fleet/run-engine.mjs:872` blob 9b84b07
- `extraArgs` at `fleet/tests/test_run_engine_fold_subject.mjs:50` blob 8a38a1b
- `integratedRuns` at `fleet/run-engine.mjs:923` blob 9b84b07
- `stdout` at `fleet/run-worker.mjs:947` blob 3606982
- `integratedChecks` at `fleet/run-engine.mjs:924` blob 9b84b07
- `settled` at `fleet/referee.mjs:117` blob b1da45e
- `highest` at `fleet/launch.mjs:1049` blob 8cc2fc3
- `fleet/tests/_engine_helpers.mjs` blob 8aa0df0
- `fleet/tests/test_run_engine_exam_evidence.mjs` blob d5b39fb

**Proof:**
- Test: `fleet/tests/test_run_engine_state_exams.mjs`
- Guard: `fleet/tests/test_run_engine_state_exams.mjs`
- Run: sed -n '/"tasks": {/,/"tests": {/p' skills/ultrapowers/references/report-format.md | tr '\n' ' ' | grep -q 'stateExams.*exam.*store_ms.*render_ms.*render.*mutant_killed.*contract'
- Run: grep -E '^\| .tasks\[\]\.stateExams. \|' skills/ultrapowers/references/report-format.md | tr '\n' ' ' | grep -q 'highest.*never .base.'
- Run: node fleet/tests/test_run_engine_state_exams.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_run_engine_exam_evidence.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_run_engine_pre_review.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_run_engine_proof_runs.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_run_engine_integrated_runs.mjs | grep -q 'ALL TESTS PASSED'
- Legs: (a) the probe's file `env-base.txt` in the run dir carries `ULTRA_EXAM_PASS=base`,
  `ULTRA_TASK=T1`, `ULTRA_RUN_DIR=<the rig's runDir>`, `ULTRA_BASE=<the rig's base>` and
  `cwd=<clonesDir>/exam-T1` [M1]; (b) the pre-review pass's `env-0.txt` carries `ULTRA_EXAM_PASS=0`
  and `cwd=<clonesDir>/task-T1`, and — in a scenario whose reviewer answers FIX_REQUIRED once — a
  later `env-2.txt` carries `ULTRA_EXAM_PASS=2` and no `env-1.txt` exists [M1]; (c) with the
  task's one `Run:` and the run's one `Check:` both being the command
  `sh -c 'printenv | grep ^ULTRA_ | sort'`, the captured `review:T1:1` prompt's `RUN EVIDENCE`
  and `CHECK EVIDENCE` blocks each carry, for that command, exactly the four lines
  `ULTRA_BASE=<the rig's base>`, `ULTRA_EXAM_PASS=0`, `ULTRA_RUN_DIR=<the rig's runDir>`,
  `ULTRA_TASK=T1` in that order and no other `ULTRA_` line [M1]; (d) the `integratedRuns` entry
  for that command has `stdout` equal to exactly the three lines `ULTRA_BASE=<the rig's base>`,
  `ULTRA_EXAM_PASS=integrated`, `ULTRA_TASK=T1` — no `ULTRA_RUN_DIR` line [M2]; (e) the
  `integratedChecks` entry for that command has `stdout` equal to exactly the one line
  `ULTRA_BASE=<the rig's base>`, and a `check.sh` suite that appends `printenv | grep ^ULTRA_`
  to a file in the run dir leaves that file with zero `ULTRA_` lines after the run — none of
  the four reaches the suite [M2]; (f) with the
  exam having written `buy-milk-0` (killed true) and the probe `buy-milk-base` (killed false),
  `report.tasks[0].stateExams` deep-equals
  `[{exam:'buy-milk', store_ms: 12, render_ms: null, render:'skipped', mutant_killed: true, contract:'ok'}]`
  — the pass-0 record, not the base one — and in the fix-round scenario, where the exam writes
  `render: "ran", render_ms: 3100` only when `ULTRA_EXAM_PASS` is `2`, the element reads
  `render: 'ran', render_ms: 3100` — the highest pass wins over pass 0 [M3]; (g) a second task whose exam writes no record reports
  `stateExams: []`, and a directory whose `contract.json` carries `breach: "contract breach: https://x"`
  reports `contract: 'contract breach: https://x'` [M3]; (h) the captured `review:T1:1` prompt
  ends with a block containing `STATE EXAM:`, the line `- buy-milk: mutant state-exams/expected/one-open-todo.json killed: true`,
  the words `duty 5` and `settled`, and the phrase `own tests` [M4]; (i) the same scenario with
  `killed: false` in the pass-0 `mutant.json`, and the record-less second task of the previous
  leg but one, each capture a `review:` prompt containing no `STATE EXAM` substring [M4]; (j)
  `stateExamBlock([])` and `stateExamBlock([{mutant_killed: false, …}])` return `''` and
  `stateExamsOf(runDir, 'T9')` for an absent directory returns `[]` [M3, M4].
  (k) the schema block between `"tasks": {` and `"tests": {` names
  `stateExams` and its six keys in order, and the field-reference row for `tasks[].stateExams`
  says `highest` and `never base` [M5]; (l) the four sibling engine sims that pin the exam
  evidence, the pre-review pass, the `ULTRA_BASE` readings and the integrated-run row shape
  still print the sentinel — the widened environment and the added report key break none of
  their pins [M1, M2, M3].

**Stale-if:**
- path-absent: `fleet/tests/_engine_helpers.mjs`
- path-absent: `fleet/tests/test_run_engine_exam_evidence.mjs`

### Task 2: Boot sources the renderer address, hands it to the engine, and copies the record

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/sandbox-boot.sh`
- Test: `fleet/tests/test_sandbox_boot_state_exams.mjs`

**Claim:** A sandbox whose setup wrote the renderer address hands it to the engine as one more
environment entry, a sandbox without it still boots, and whatever the exams recorded under
`state-exams/` is on the evidence branch after every transition, file by file, nested once.
(derived)
Machine: M1. Before the engine's `systemd-run` line, `fleet/sandbox-boot.sh` sources the file at
`${FLEET_RENDER_ENV:-/etc/fleet/render.env}` when it is readable, and the engine unit's argv
carries exactly one entry beginning `TINYAPP_RENDER_URL=` among the `env` prefix's entries,
whose value is the sourced `TINYAPP_RENDER_URL` when the file set one and the empty string
when there is no file; a boot with no such file exits 0.
M2. The publish fold's `systemd-run` argv carries no entry beginning `TINYAPP_RENDER_URL=`.
M3. `collect_evidence` copies every regular file under `<run dir>/state-exams/` to the same
relative path under `<evidence worktree>/.ultrapowers/runs/<N>/state-exams/`, byte for byte,
creating directories as needed; a run whose engine wrote none commits no `state-exams/`
directory; and after a completed boot — which runs `collect_evidence` at least three times —
there is exactly one `state-exams` directory under `.ultrapowers/runs/<N>/` and no
`state-exams/state-exams`.

**Authorized-by:** spec `docs/superpowers/specs/2026-09-09-tinyapp-state-exams.md` §2 (evidence
is git; the transcripts pattern), §3.5 (process-wide inheritance), §3.6, §3.8 items 2 and 3;
spec review round 2 findings 2 and 3, round 4 findings 1 and 9.

**Interfaces:**
- Consumes: none
- Produces: nothing

**Context:** The boot script runs under `set -euo pipefail`; that is why the argv entry is
spelled `"TINYAPP_RENDER_URL=${TINYAPP_RENDER_URL:-}"` — a bare `$TINYAPP_RENDER_URL` under
`set -u` kills every boot on a fleet without the file (spec review round 4 finding 1). The
engine unit is started in `run_engine()` through `fleet_systemd_run --user --unit=fleet-engine-$RUN_N
… -- env -u CLAUDE_CONFIG_DIR "ANTHROPIC_BASE_URL=…" "CLAUDE_CODE_OAUTH_TOKEN=placeholder"
"ULTRAPOWERS_FLEET_RUN=$RUN_ID" node …`; the new entry joins that `env` prefix as one more
quoted word (a service inherits no environment from the script, so the child's variables ride
in its own argv — the comment above `run_engine` says so). The source line goes in `run_engine`
before the `systemd-run` call:
`[ -r "${FLEET_RENDER_ENV:-/etc/fleet/render.env}" ] && . "${FLEET_RENDER_ENV:-/etc/fleet/render.env}"`
— guarded so a missing file is not a failure under `set -e` (use an `if`, not a bare `&&` at
the end of a function). `FLEET_RENDER_ENV` is a relocatable root exactly like `FLEET_HOME` and
`FLEET_BIN_DIR` at the top of the script — the production path is the literal, and the
variable exists so a sim can plant the file. The file's one line is
`TINYAPP_RENDER_URL=https://<integration>.int.exe.xyz/client/v4/accounts/<account>/browser-rendering`
(written by the setup script, Task 3). The publish fold unit (`run_publish_fold`, the
`fleet-fold-$RUN_N-$attempt` unit) keeps its `env` prefix as it is — the spec says the fold
unit omits the entry (M2), and CONTRACT is amended to say so by Task 6.

`collect_evidence()` is the `# --- evidence` region: it copies a fixed list of files, then the
`transcripts/` tree FILE BY FILE (`cp "$run_dir/transcripts/"*.jsonl "$dest/transcripts/"`) —
the comment there explains that a `cp -R` of a directory onto a destination that already holds
it nests a second copy on the second transition, because the function runs at every
`write_status` transition and once more at `fail`. `state-exams/` is a tree of arbitrary depth
(`task-<id>/<stem>-<pass>/<file>`), so the copy walks regular files — e.g. `find "$run_dir/state-exams" -type f`
relative to `$run_dir`, `mkdir -p` the destination's dirname, `cp` the file — never `cp -R` of
the directory. Add the block after the transcripts block (run-69's `referee/` block, when it has
landed, sits between them; put `state-exams/` after whatever is last). The run dir is
`run_dir_path()` = `$TARGET_DIR/.claude/ultrapowers/run-$RUN_ID`; in the sim that is
`<home>/target/.claude/ultrapowers/run-run-7` (`RUN_DIR_PATH` in the helpers) and the evidence
worktree is `<home>/evidence` with `RUN_PATH` = `.ultrapowers/runs/7`.

The sim rig: `makeHome()`, `boot(ctx, ['boot'], env)` / `bootAsync`, `argvLines(ctx, 'systemd-run')`
(one tab-separated argv per unit start), `foldArgv(ctx, 1)`, `evidenceDir(ctx)`, `runDir(ctx)`
from `fleet/tests/_sandbox_boot_helpers.mjs`. Planting files under the run dir from inside the
engine stub is the pattern `test_sandbox_boot_approval_evidence.mjs` uses for transcripts: it
splices a snippet guarded by a `STUB_*` variable into the `systemd-run` stub body and rewrites
`<bin>/systemd-run` after `makeHome()`. Plant `state-exams/task-1/buy-milk-0/{walls.json,mutant.json,contract.json,store-diff.json,screenshot.png}`
(the PNG as a few bytes of non-UTF-8 content, so "byte for byte" is checked on a binary) and
`state-exams/task-1/buy-milk-base/walls.json`. The render file for M1 is written by the sim
into `<home>/render.env` and named through `FLEET_RENDER_ENV` in the boot env; the default
boot has no such variable and no such file.
**BASE facts:** (generated at a526641)
- `fleet/sandbox-boot.sh` blob bbf8124
- `env` at `fleet/launch.mjs:368` blob 8cc2fc3
- `fail` at `fleet/run-main.mjs:552` blob 4cb8b21
- `cp` at `fleet/tests/test_run_engine_pre_review.mjs:700` blob 9b06675
- `RUN_DIR_PATH` at `fleet/tests/_sandbox_boot_helpers.mjs:61` blob eee4b3b
- `RUN_PATH` at `fleet/tests/_sandbox_boot_helpers.mjs:58` blob eee4b3b
- `bootAsync` at `fleet/tests/_sandbox_boot_helpers.mjs:742` blob eee4b3b
- `fleet/tests/_sandbox_boot_helpers.mjs` blob eee4b3b
- `commitStates` at `fleet/tests/_sandbox_boot_helpers.mjs:785` blob eee4b3b
- `running` at `fleet/tests/test_sandbox_boot_merge.mjs:221` blob d980f3d
- `publishing` at `fleet/tests/test_sandbox_boot_merge.mjs:946` blob d980f3d
- `done` at `fleet/run-worker.mjs:972` blob 3606982
- `fleet/tests/test_sandbox_boot_approval_evidence.mjs` blob fefa54a

**Proof:**
- Test: `fleet/tests/test_sandbox_boot_state_exams.mjs`
- Guard: `fleet/tests/test_sandbox_boot_state_exams.mjs`
- Run: node fleet/tests/test_sandbox_boot_state_exams.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_sandbox_boot.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_sandbox_boot_approval_evidence.mjs | grep -q 'ALL TESTS PASSED'
- Run: bash -n fleet/sandbox-boot.sh
- Legs: (a) a boot with no `FLEET_RENDER_ENV` and no `/etc/fleet/render.env` reachable exits 0,
  and the `fleet-engine-7` argv carries exactly one entry equal to `TINYAPP_RENDER_URL=` [M1];
  (b) a boot with `FLEET_RENDER_ENV` naming a file whose line is
  `TINYAPP_RENDER_URL=https://browser-run.int.exe.xyz/client/v4/accounts/abc123/browser-rendering`
  carries exactly one such entry, equal to that line, in the engine argv [M1]; (c) in that same planted-file boot
  the `fleet-fold-7-1` argv carries no entry beginning `TINYAPP_RENDER_URL=` — the fold unit is
  absent from the set of argvs carrying one [M2]; (d) with the
  five planted files, every one is present under
  `<evidence>/.ultrapowers/runs/7/state-exams/task-1/buy-milk-0/` with bytes equal to the run
  dir's copy (the PNG included), `buy-milk-base/walls.json` is present too, and `readdirSync`
  of `.ultrapowers/runs/7/state-exams/` is exactly `['task-1']` with no `state-exams` entry at
  any depth below it [M3]; (e) a boot with nothing planted leaves no
  `.ultrapowers/runs/7/state-exams` path at all [M3]; (f) the planted boot's evidence commits
  number at least three (`commitStates` reads `running`, `publishing`, `done`), so the
  once-nested assertion above was made after repeated copies [M3].
  (g) the green-path boot sim and the approval-evidence sim (the transcripts
  copy and the once-nested rule for `transcripts/`) still print the sentinel, and the script
  parses [M1, M3].

**Stale-if:**
- path-absent: `fleet/tests/_sandbox_boot_helpers.mjs`
- path-absent: `fleet/tests/test_sandbox_boot_approval_evidence.mjs`

### Task 3: The setup script writes the renderer address where boot will find it

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/setup-script.mjs`
- Test: `fleet/tests/test_setup_script_render_env.mjs`

**Claim:** A setup script rendered with a renderer named installs `/etc/fleet/render.env`,
carrying the renderer's proxy address, before it starts the run; a setup script rendered
without one says nothing about a renderer and is the script it was before. (derived)
Machine: M1. `renderSetupScript({run, bootstrap, unit, render})` with
`render = {integration, account}` renders a script that carries a quoted heredoc whose body is
the single line `TINYAPP_RENDER_URL=https://<integration>.int.exe.xyz/client/v4/accounts/<account>/browser-rendering`
and, after it, a line `sudo -n install -D -m 0644 <that file> /etc/fleet/render.env`, both
before the `systemctl --user start` line; the render passes `bash -n` and is at most
`SETUP_SCRIPT_MAX_BYTES` bytes.
M2. With `render` omitted or `null`, the render contains neither the substring `render.env`
nor `TINYAPP_RENDER_URL` nor `/etc/fleet`, and is byte-identical to the render of the same
arguments without the key.
M3. A `render.integration` not matching `^[a-z][a-z0-9-]*$` or a `render.account` not matching
`^[A-Za-z0-9_-]+$` throws before any script text is built, with a message naming the offending
key.

**Authorized-by:** spec `docs/superpowers/specs/2026-09-09-tinyapp-state-exams.md` §3.8 item 2;
spec review round 2 finding 2, round 3 finding 8, round 4 finding 8; doctrine "don't vendor the
vendor" (the first-boot setup script is exe.dev's own primitive).

**Interfaces:**
- Consumes: none
- Produces: `renderSetupScript({run, bootstrap, unit, render}) -> string`

**Context:** `fleet/setup-script.mjs` renders one bash script per run, run once by exe.dev as
`exedev` with passwordless `sudo -n`, capped at `SETUP_SCRIPT_MAX_BYTES` (10240; the run-70
render is 7502 bytes at BASE, so the ~250 bytes this adds fit). It already embeds two files
through quoted heredocs — `heredocBody(tag, text)` refuses a body carrying its delimiter, and
the tags are `FLEET_BOOTSTRAP_EOF` / `FLEET_UNIT_EOF`; use a third tag of the same shape
(`FLEET_RENDER_EOF`) for the env file. `/etc/fleet/` does not exist on the image, which is why
the install is `install -D` (creates the leading directory) rather than a bare `install`. The
file is world-readable on purpose (`0644`): it carries an address, never a secret — the bearer is
injected at the edge and never leaves it (Global Constraints). The heredoc and its install go
in the `fleet files` step, after the unit template and before `systemctl --user daemon-reload`.
The URL is the proxy address and never Cloudflare's host: the third Global Constraint greps
this file for `api.cloudflare.com`, so no comment may spell it either. Keep the existing
signature's positional keys unchanged — the launcher calls
`renderSetupScript({ run: String(run), ...readFleetFiles() })` today and will add `render`
(Task 5, wave 2); the parameter is optional and defaults to `null`.

The existing sim `fleet/tests/test_setup_script.mjs` pins, among other things, that a render
for run 123456 differs from run 70's only where `70` appears, that `RUN=<n>` is the first
executable line after `set -euo pipefail`, that the last executable line is the self-delete,
and that `--env` and `FLEET_RUN` appear nowhere in the render; none of those change, and that sim
is a `Run:` below. The new sim is static: render with and without `render`, split into lines,
find the heredoc body line, the install line and the start line by index, check the order, run
`bash -n` on both renders through `spawnSync('bash', ['-n', file])`, and assert the throws of M3
with `assert.throws` on a bad integration (`Bad Name`) and a bad account (`abc/../def`).
**BASE facts:** (generated at a526641)
- `SETUP_SCRIPT_MAX_BYTES` at `fleet/setup-script.mjs:26` blob 1345f9e
- `render` at `evals/fixtures/contend-wide/reference/clitool/cli.py:26` blob 28b0cfd
- `fleet/setup-script.mjs` blob 1345f9e
- `fleet/tests/test_setup_script.mjs` blob 32f2a4d
- `bash` at `fleet/tests/test_confine_hook.mjs:177` blob a99fd41
- `account` at `fleet/doctor.mjs:211` blob f9a1174
- `fleet/fleet-bootstrap.sh` blob b930598

**Proof:**
- Test: `fleet/tests/test_setup_script_render_env.mjs`
- Guard: `fleet/tests/test_setup_script_render_env.mjs`
- Run: node fleet/tests/test_setup_script_render_env.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_setup_script.mjs | grep -q 'ALL TESTS PASSED'
- Legs: (a) with `render: {integration: 'browser-run', account: 'abc123'}` one line of the
  render is exactly
  `TINYAPP_RENDER_URL=https://browser-run.int.exe.xyz/client/v4/accounts/abc123/browser-rendering`,
  it sits between a line matching `cat <<'FLEET_RENDER_EOF' >` followed by a path, and a
  `FLEET_RENDER_EOF` line, and a later line contains `sudo -n install -D -m 0644`, names that
  same path as the install's source operand, and ends with `/etc/fleet/render.env`, whose index
  is below the index of the `systemctl --user start` line [M1]; (f) the fragment of that render
  from its `cat <<'FLEET_RENDER_EOF' >` line through its `sudo -n install` line inclusive,
  executed by `bash` in a temp dir with `sudo` defined as a function that runs its arguments
  with every `/etc/fleet` operand prefixed by `$TMP`, leaves `$TMP/etc/fleet/render.env` whose
  bytes are exactly
  `TINYAPP_RENDER_URL=https://browser-run.int.exe.xyz/client/v4/accounts/abc123/browser-rendering`
  plus one newline — the installed file carries the address, not merely a line of the script
  [M1]; (b) that render's byte length is
  at most `SETUP_SCRIPT_MAX_BYTES` and `bash -n` on it exits 0 [M1]; (c) the render without
  `render` and the render with `render: null` are byte-identical to each other and contain none
  of `render.env`, `TINYAPP_RENDER_URL`, `/etc/fleet` [M2]; (d) `render: {integration: 'Bad Name',
  account: 'abc123'}` throws with a message containing `integration`, and
  `render: {integration: 'browser-run', account: 'abc/../def'}` throws with a message containing
  `account` — and neither bad value appears in any string the renderer returned, because it
  returned none [M3].
  (e) the existing setup-script sim — the 10 KiB cap, the run literal, the
  self-delete last, no `--env` — still prints the sentinel [M1, M2].

**Stale-if:**
- path-absent: `fleet/tests/test_setup_script.mjs`
- path-absent: `fleet/fleet-bootstrap.sh`

### Task 4: The doctor's eighth row, and the walk's section for it

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/doctor.mjs`
- Modify: `skills/ultrapowers/references/first-run.md`
- Modify: `fleet/tests/test_doctor.mjs`
- Modify: `fleet/tests/test_doctor_config_keys.mjs`
- Test: `fleet/tests/test_doctor_render.mjs`

**Claim:** The doctor tells an operator whether the renderer their `fleet.json` names exists at
the edge — green and saying "not configured" when they named none, red with the walk's section
only when they named one that is not there — and a `render` key in the file no longer turns
the capacity row red. (derived)
Machine: M1. `ROW_IDS` is exactly `['exe-dev', 'capacity', 'claude', 'accounts', 'github',
'integrations', 'verb-drift', 'render']`, and `skills/ultrapowers/references/first-run.md`'s
`## ` headings are exactly that list in that order.
M2. `doctor({…, render})` answers a `render` row last: with `render` `null` or absent,
`status` `ok` and a detail beginning `not configured`; with `render.integration` present as a
name in the parsed `integrations list --json`, `status` `ok` and the detail naming it; with
`render` given and the name absent from a readable listing, `status` `missing`, `fix` `render`,
and the detail naming the integration and `~/.ultrapowers/fleet.json`; with an unreadable
listing and `render` given, `status` `missing`; and `verdict` is `ready` only when every row
including this one is `ok`.
M3. `fleetConfigRender({path})` resolves `{integration, account}` — both strings, taken from
the file's top-level `render` object — and `null` when the file is absent, not JSON, not an
object, has no `render`, or its `render` lacks either string; `render` never appears in
`result.config`.
M4. `CONFIG_KEYS` accepts `render` beside `cpu`, `memory` and `account`: `configKeys` of
`['cpu','memory','account','render']` leaves the `capacity` row `ok` with no `keys nothing
reads` in its detail, and a key outside the four still turns it `missing` with a detail
containing `keys nothing reads` and naming `cpu`, `memory`, `account` and `render` as what is
read.
M5. The CLI (`main`) passes `fleetConfigRender`'s answer for the same config path into
`doctor()`, and `renderRows` prints the eighth row after `verb-drift`.

**Authorized-by:** spec `docs/superpowers/specs/2026-09-09-tinyapp-state-exams.md` §3.8 item 5;
spec review round 2 finding 11, round 3 finding 2, round 4 finding 7;
`tests/test_docs_agree_with_code.py` (`ROW_IDS` ↔ headings).

**Interfaces:**
- Consumes: none
- Produces: `fleetConfigRender({path}) -> Promise<{integration: string, account: string} | null>`

**Context:** `fleet/doctor.mjs` imports only `node:` specifiers and no other fleet module (it
runs from the plugin cache where no `node_modules` exists) — keep that. The doctor has two row
states, `ok` and `missing`, and `verdict = rows.every(ok)`, which is why "not configured" is a
green row with that detail rather than a third state. `render` travels the way `account` does:
`fleetConfigAccount({path})` reads the file's top-level key on its own, `main()` passes it to
`doctor({…, account})`, and `loadFleetConfig` keeps answering exactly `cpu` and `memory`
(`result.config` is pinned to those two keys by `test_doctor_config_keys.mjs`). Add
`fleetConfigRender` with the same shape and a `render` option on `doctor()`. The listing is
already parsed once into `found` (`parseIntegrations`, a Map by name) for the `claude` and
`integrations` rows; the `render` row reads the same Map — presence by name is the whole
check, since an http-proxy answers nothing useful to `integrations test` (the header comment
says so). The `capacity` row's red detail today reads
`… — keys nothing reads; it reads cpu and memory only, and the launcher reads account. …`;
rework it to name `render` too, keeping the phrase `keys nothing reads` (a pin in
`test_doctor_config_keys.mjs`, which also asserts the detail names each of `cpu`, `memory`,
`account`). `FIXES` derives from `ROW_IDS`, so the new row's fix is `render` for free. Update the
header comment's row list ("Seven rows" → eight, with a `render` line) — prose, not pinned.

`skills/ultrapowers/references/first-run.md` gains a `## render` section LAST (its headings are
pinned to `ROW_IDS` in order by `tests/test_docs_agree_with_code.py`, and the opening line says
"seven rows" — make it eight). The section, in the file's own shape (what the piece is, what the
agent runs, what you do in a browser, the two or three things a newcomer would not know): the
renderer is Cloudflare Browser Run reached through an exe.dev `http-proxy` integration that
injects the Cloudflare bearer at the edge, created ONCE per account, attached to nothing:

    printf '%s' "$CF_API_TOKEN" | ssh exe.dev "integrations add http-proxy --name browser-run \
      --target https://api.cloudflare.com --bearer -"

then the `render` key in `~/.ultrapowers/fleet.json`:

    {
      "cpu": "8",
      "memory": "16GB",
      "render": { "integration": "browser-run", "account": "<cloudflare account id>" }
    }

The things a newcomer would not know: `--bearer -` reads the token from stdin so it never
appears in an argv or a history; the launcher attaches the object to the run's VM at `new`
(`--integration claude-max,gh-<owner>-<repo>,browser-run`) and nothing rides `tag:fleet`; a
fleet with no `render` key is green here and its exams record the render move as `skipped`;
and the URL the sandbox uses is the proxy address `https://browser-run.int.exe.xyz/client/v4/accounts/<id>/browser-rendering`,
never Cloudflare's host. This is a document, not a fleet script, so the `integrations add`
line may name `api.cloudflare.com` here; the docs test forbids `tag:fleet` on any
`integrations add|attach` line and forbids the retired names — write neither.

The existing sims: `test_doctor.mjs` pins `EXPECTED_IDS` (the seven ids) and `ALL_OK` (a
seven-key status map deep-equalled in several groups) — both gain `render` (`'ok'` — the green
fixture passes no `render`, which is the "not configured" green). `test_doctor_config_keys.mjs`
pins the three-key acceptance and the detail wording — extend its key lists with `render` where
they enumerate what the file may carry. The new sim `test_doctor_render.mjs` drives `doctor()`
with the stub-exec pattern those files use (a map of command → `{code, stdout}`, the measured
`integrations list --json` shape with `name` and `config_summary`, `billing plan --json`,
`integrations setup github --list`, the `claude-token.mjs` reads, one `help <verb>` per verb of
a fixture record through `verbsPath`).
**BASE facts:** (generated at a526641)
- `render` at `evals/fixtures/contend-wide/reference/clitool/cli.py:26` blob 28b0cfd
- `ROW_IDS` at `fleet/doctor.mjs:66` blob f9a1174
- `status` at `fleet/claude-token.mjs:358` blob b7e8e7b
- `ok` at `fleet/publish-fold.mjs:116` blob 39fbd16
- `missing` at `fleet/referee.mjs:227` blob b1da45e
- `fix` at `fleet/tests/test_roles_peer.mjs:48` blob 4847687
- `verdict` at `evals/frontier/replay_corpus.py:51` blob 7d40d74
- `CONFIG_KEYS` at `fleet/doctor.mjs:288` blob f9a1174
- `cpu` at `fleet/launch.mjs:549` blob 8cc2fc3
- `memory` at `fleet/launch.mjs:550` blob 8cc2fc3
- `account` at `fleet/doctor.mjs:211` blob f9a1174
- `configKeys` at `fleet/doctor.mjs:784` blob f9a1174
- `capacity` at `fleet/launch.mjs:709` blob 8cc2fc3
- `main` at `docs/scripts/render_post_media.py:84` blob 869c41e
- `renderRows` at `fleet/doctor.mjs:771` blob f9a1174
- `tests/test_docs_agree_with_code.py` blob ffe9fa2
- `fleet/doctor.mjs` blob f9a1174
- `loadFleetConfig` at `fleet/doctor.mjs:136` blob f9a1174
- `found` at `fleet/doctor.mjs:737` blob f9a1174
- `parseIntegrations` at `fleet/doctor.mjs:353` blob f9a1174
- `claude` at `fleet/tests/test_doctor.mjs:462` blob 0f9de8d
- `FIXES` at `fleet/doctor.mjs:72` blob f9a1174
- `skills/ultrapowers/references/first-run.md` blob 0897044
- `skipped` at `fleet/referee-linker.mjs:366` blob f6374e7
- `EXPECTED_IDS` at `fleet/tests/test_doctor.mjs:59` blob 0f9de8d
- `ALL_OK` at `fleet/tests/test_doctor.mjs:221` blob 0f9de8d
- `name` at `fleet/doctor.mjs:363` blob f9a1174
- `stale` at `fleet/doctor.mjs:309` blob f9a1174
- `rows` at `fleet/claude-token.mjs:248` blob b7e8e7b
- `fleet/tests/test_doctor_config_keys.mjs` blob 02718de

**Proof:**
- Test: `fleet/tests/test_doctor_render.mjs`
- Guard: `fleet/tests/test_doctor_render.mjs`
- Run: node fleet/tests/test_doctor_render.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_doctor.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_doctor_config_keys.mjs | grep -q 'ALL TESTS PASSED'
- Run: python3 -m pytest -q tests/test_docs_agree_with_code.py
- Run: test "$(grep -c '^## ' skills/ultrapowers/references/first-run.md)" = 8
- Run: sed -n '/^## render/,$p' skills/ultrapowers/references/first-run.md | tr '\n' ' ' | grep -q 'http-proxy.*--bearer -.*fleet.json.*browser-run.int.exe.xyz'
- Legs: (a) `[...ROW_IDS]` deep-equals the eight ids in order, and `result.rows.map(id)` of a
  green doctor is that list [M1]; (b) with no `render` option the last row is
  `{id:'render', status:'ok'}` and its detail starts `not configured`, and with `render: null`
  passed explicitly the row is the same; with
  `render: {integration:'browser-run', account:'abc'}` and a listing carrying an entry named
  `browser-run`, the row is `ok` and its detail contains `browser-run`; with the same option and
  a listing without it, the row is `missing`, `fix` is `render`, the detail contains
  `browser-run` and `fleet.json`, and `verdict` is `not-ready`; with the same option and a
  listing that is not JSON, the row is `missing` [M2]; (c) `fleetConfigRender` answers
  `{integration:'browser-run', account:'abc'}` for a file carrying that object, and `null` for
  each of: an absent path, a file of `not json`, a file `[]`, a file `{"cpu":"8"}`, a file
  `{"render":{"integration":"x"}}`, a file `{"render":"x"}`; and `result.config` of a doctor
  given `render` has exactly the keys `cpu` and `memory` [M3]; (d) `configKeys:
  ['cpu','memory','account','render']` leaves `capacity` `ok` with no `keys nothing reads`
  in its detail, and `configKeys: ['cpu','memory','render','stale']` turns it `missing` with a
  detail containing `keys nothing reads`, `stale`, and each of `cpu`, `memory`, `account`,
  `render` [M4]; (e) `renderRows` of a result whose rows are the eight ids prints `render` on
  the last line, and a `missing` render row prints the `→ references/first-run.md §render` line
  under it [M5]; (f) running `node fleet/doctor.mjs --json --config <fixture with render>` under a PATH
  shim whose `ssh` and `node` stubs answer the six reads (the CLI-driving group of
  `test_doctor_config_keys.mjs` is the pattern) with `browser-run` present in the listing prints
  a JSON whose `rows` end with `{id:'render', status:'ok', …}`, and the same run against a
  fixture without `render` ends with a `render` row whose detail starts `not configured` — the
  CLI path reads the key [M5].
  (g) the two existing doctor sims print the sentinel with their pins
  extended, the docs test that reads `ROW_IDS` against the headings passes, the walk has exactly
  eight `## ` headings, and the `## render` section — the last — names the http-proxy shape,
  the stdin bearer, the config key and the proxy URL, in that order [M1, M2].

**Stale-if:**
- path-absent: `fleet/tests/test_doctor_config_keys.mjs`
- path-absent: `tests/test_docs_agree_with_code.py`

### Task 5: The launcher attaches the renderer and refuses on the laptop what the VM could not attach

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/launch.mjs`
- Test: `fleet/tests/test_launch_render.mjs`

**Claim:** A launch from a laptop whose `fleet.json` names a renderer that exists at the edge
binds it to the run's VM at creation and hands the sandbox its address; a launch naming one that
is not there is refused before anything is pushed or created; a laptop with no `render` launches
exactly as today. (derived)
Machine: M1. `launch()` reads `render` as `config.render ?? null` when a `config` object is
injected and as `fleetConfigRender({path: opts.config})` otherwise, and — when it is non-null
— the one `new` line's `--integration` value is `claude-max,gh-<owner>-<repo>,<render.integration>`,
the script on that call's stdin is `renderSetupScript({run, bootstrap, unit, render})` byte
for byte, and the result carries `render` equal to the object; when it is null the `new` line
is `--integration claude-max,gh-<owner>-<repo>` with nothing after, the stdin script contains
no `render.env`, and the result's `render` is `null`.
M2. With `render` non-null and no entry named `render.integration` in `integrations list --json`,
`launch()` throws a `Refusal` whose message names the integration and
`references/first-run.md §render`, after the listing read and before any plan push and any
`new`: the target's `refs/heads/ultra/plan-run-*` are unchanged and `exec.mutating()` is empty.
M3. A `render.integration` not matching `^[a-z][a-z0-9-]*$` or a `render.account` not matching
`^[A-Za-z0-9_-]+$` is a `Refusal` before any command runs, naming the offending key.
M4. `USAGE` names no `--render`: `render` is read from the config file only.

**Authorized-by:** spec `docs/superpowers/specs/2026-09-09-tinyapp-state-exams.md` §2 (the
exe-native credential shape; the #796 refusal shape), §3.8 items 2 and 7, §8 Adds; spec review
round 3 finding 3, round 4 findings 2 and 3; #796 (the launcher refuses on the laptop what the
sandbox would refuse).

**Interfaces:**
- Consumes: `fleetConfigRender({path}) -> Promise<{integration: string, account: string} | null>`
- Consumes: `renderSetupScript({run, bootstrap, unit, render}) -> string`
- Produces: nothing

**Context:** `fleet/launch.mjs` already imports `fleetConfigAccount, verbDrift` from
`./doctor.mjs` and `readFleetFiles, renderSetupScript` from `./setup-script.mjs`; the account
is read as `config.account` when a config was injected and `fleetConfigAccount({path: opts.config})`
otherwise — `render` follows that exact branch. The GitHub refusal is the shape to copy: after
`detectTestCommand`, `githubName = githubIntegrationFor(target)` is looked for in
`listIntegrations(exec)` rows by `name`, and a miss is
`throw new Refusal('launch: no <name> integration — … Build it once: node fleet/target.mjs <target>')`,
before the verb-drift preflight, the janitor, the credential refresh and the plan push. The
render refusal sits directly after it and reads the same listing (one read, not two — the
sims count `integrations list --json` reads). Its text:
`launch: ~/.ultrapowers/fleet.json names render.integration <name> but integrations list --json has no <name> — build it once per account: references/first-run.md §render`
— it names the walk, never the `integrations add http-proxy` command (Global Constraint 3
greps this file for `api.cloudflare.com`). The `new` line is built by `remoteFor(vm)` as
`--integration ${CLAUDE_INTEGRATION},${githubName}`; append `,${render.integration}` when
configured. The setup script is rendered once, before the `new` attempts:
`renderSetupScript({ run: String(run), ...readFleetFiles(), render })`. The result object gains
`render` (null or the object) beside `github`; `renderLaunch` (the printed lines) is unchanged
— `test_launch.mjs` deep-equals those lines. Shape validation (M3) happens where `--account` is
validated, before the repo is read; the two regexes are the setup script's (Task 3), copied
here so the laptop refuses what the renderer would throw on.

The sim shape is `test_launch.mjs`'s: `makeTargetRepo` (a bare origin and its clone, seeded
with `pytest.ini` so the test-command ladder passes), `makeExec({rules})` with `sshRule`s for
`integrations list --json` (`answer([...])` — rows `{name, attachments: []}`), `billing plan --json`,
`ls 'fleet-r*' --json`, `help <verb>` per verb of `fleet/exe-verbs.json`, and the `new` line
answered with a JSON row; `launch({argv, exec, config, now, sleep, refreshCredential, verbsPath})`
with a spy `refreshCredential` returning `{ok: true, out: ''}`; `exec.mutating()` lists the
mutating lobby verbs and `exec.calls` every call with its stdin `input`. A refusal's
"nothing pushed" leg reads `git -C <bare> for-each-ref refs/heads/ultra/` before and after.
**BASE facts:** (generated at a526641)
- `render` at `evals/fixtures/contend-wide/reference/clitool/cli.py:26` blob 28b0cfd
- `config` at `fleet/doctor.mjs:138` blob f9a1174
- `Refusal` at `fleet/lobby.mjs:280` blob 62d348b
- `USAGE` at `fleet/janitor.mjs:118` blob c8d8258
- `fleet/launch.mjs` blob 8cc2fc3
- `detectTestCommand` at `fleet/launch.mjs:920` blob 8cc2fc3
- `name` at `fleet/doctor.mjs:363` blob f9a1174
- `github` at `fleet/doctor.mjs:729` blob f9a1174
- `renderLaunch` at `fleet/launch.mjs:1084` blob 8cc2fc3
- `makeTargetRepo` at `fleet/tests/_lobby_helpers.mjs:135` blob 86c4674
- `pytest.ini` blob 251eb61
- `sshRule` at `fleet/tests/_lobby_helpers.mjs:38` blob 86c4674
- `fleet/exe-verbs.json` blob 465f77f
- `refreshCredential` at `fleet/tests/test_launch.mjs:280` blob 2948ac5
- `input` at `fleet/confine-hook.mjs:349` blob cb77dc8
- `integration` at `fleet/run-waves.mjs:103` blob 27f25b5
- `account` at `fleet/doctor.mjs:211` blob f9a1174
- `fleet/tests/_lobby_helpers.mjs` blob 86c4674
- `fleet/tests/test_launch.mjs` blob 2948ac5

**Proof:**
- Test: `fleet/tests/test_launch_render.mjs`
- Guard: `fleet/tests/test_launch_render.mjs`
- Run: node fleet/tests/test_launch_render.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_launch.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_launch_pins.mjs | grep -q 'ALL TESTS PASSED'
- Legs: (a) a green launch with `config: {cpu:'8', memory:'16GB', render:{integration:'browser-run', account:'abc123'}}`
  and a listing carrying `gh-popmechanic-smoke` and `browser-run` issues exactly one mutating
  verb, whose `--integration` value is `claude-max,gh-popmechanic-smoke,browser-run`, whose
  stdin equals `renderSetupScript({run:'1', ...readFleetFiles(), render})` byte for byte and
  contains `/etc/fleet/render.env`, and whose result has `render` deep-equal to the object [M1];
  (b) the same launch with `config: {cpu:'8', memory:'16GB'}` issues a `new` whose
  `--integration` value is exactly `claude-max,gh-popmechanic-smoke`, whose stdin contains no
  `render.env`, and whose result has `render` `null`; and a launch with `config: null` and
  `--config <file>` naming a file carrying `render` reads it through `fleetConfigRender` — its
  `new` line ends the value with `,browser-run` [M1]; (c) the listing without `browser-run`
  throws a `Refusal` whose message contains `browser-run` and `first-run.md §render`; the
  `integrations list --json` read happened (exactly once); `exec.mutating()` is `[]`; and the
  bare origin's `refs/heads/ultra/` refs are the same before and after [M2]; (d)
  `render: {integration:'Bad Name', account:'abc'}` and `render: {integration:'browser-run', account:'a/b'}`
  each throw a `Refusal` naming `integration` / `account` respectively, with `exec.calls`
  empty — no listing read, no push, no `new` [M3]; (e) `USAGE` contains no `--render` [M4].
  (f) the existing launch sim (the pinned `new` line of a render-less launch,
  the result keys, the rendered lines) and the plan-pin sim still print the sentinel [M1, M4].

**Stale-if:**
- path-absent: `fleet/tests/_lobby_helpers.mjs`
- path-absent: `fleet/tests/test_launch.mjs`

### Task 6: The contract declares the exam environment, the render entry, the record tree, the eighth row and the third integration

**Type:** implementation

**Files:**
- Modify: `fleet/CONTRACT.md`

**Claim:** A builder reading the fleet contract finds every literal this release introduces
declared there — the four exam variables and the pass values, the render entry on the engine's
argv and its absence from the fold's, the `state-exams/` tree on the evidence branch, the
`render` doctor row, and the optional third integration on the one `new` line. (derived)
Machine: M1. Under `## Literals` a new bullet beginning `- **Exam environment:**` names
`ULTRA_BASE`, `ULTRA_TASK`, `ULTRA_RUN_DIR` and `ULTRA_EXAM_PASS`, the values `base`, `0`, `1`,
`2` and `integrated`, and says the integrated `Run:` carries no `ULTRA_RUN_DIR` and the suite
carries none of the four.
M2. The engine's `systemd-run … env …` argv the contract spells carries
`TINYAPP_RENDER_URL=${TINYAPP_RENDER_URL:-}` between `ULTRAPOWERS_FLEET_RUN=run-N` and `node`,
and the publish-fold bullet says the fold unit omits that entry.
M3. The `ultra/evidence-run-<N>` bullet's file list names `state-exams/` as a tree of
`task-<id>/<stem>-<pass>/` directories copied file by file, present when the exams wrote it.
M4. The doctor bullet reads `eight rows` (not `five rows`), its table has a `render` row as its
last row whose green condition names `not configured` and `render.integration`, and the
`Laptop config` bullet lists `render` (an object of `integration` and `account`) and `account`
beside `cpu` and `memory` and no longer says `exactly two keys`.
M5. Both places the contract spells the `new` verb's integrations — the `Launch order` code
block and the `Integration naming` bullet — read `--integration claude-max,gh-<owner>-<repo>[,browser-run]`,
and the `Integration naming` bullet says the third name is present only when `fleet.json`
carries `render` and that nothing rides the tag.

**Authorized-by:** spec `docs/superpowers/specs/2026-09-09-tinyapp-state-exams.md` §3.8 item 7
(the five edits), §2 (nothing rides the tag); spec review round 3 finding 4, round 4 findings 3,
6, 7 and 9; `fleet/CONTRACT.md`'s own header rule ("the contract wins").

**Interfaces:**
- Consumes: none
- Produces: nothing

**Context:** `fleet/CONTRACT.md` is the authority for every literal; `tests/test_docs_agree_with_code.py`
reads several of its bullets by shape — the `- **The two tags` bullet, the `- **Publish:**` range
up to `- **Integration naming`, the `**VM name:**` line, the `systemctl --user start
fleet-run@<N>.service` line, `/home/exedev/engines/<sha>` — and `fleet/tests/test_sandbox_boot_selfmerge.mjs`
slices the same `Publish` range. Add and reword without moving those anchors: the new
`- **Exam environment:**` bullet goes under `## Literals` directly after the `- **Comment**`
bullet; the `Integration naming` bullet keeps its opening `- **Integration naming:**` text (it
is the end anchor of the Publish range). The five regions, by their opening text: (1) the new
bullet; (2) the `- engine:` sub-bullet of the `Boot script` bullet — its `env -u CLAUDE_CONFIG_DIR
ANTHROPIC_BASE_URL=… CLAUDE_CODE_OAUTH_TOKEN=placeholder ULTRAPOWERS_FLEET_RUN=run-N node …`
line — and the `- publish fold:` sub-bullet's sentence "through the same `systemd-run` prefix
as the engine's line above", amended to say the fold's line carries no `TINYAPP_RENDER_URL`
entry; (3) the `- `ultra/evidence-run-<N>`` sub-bullet of `The three branches on the target`,
after the `transcripts/<sessionId>.jsonl` sentence (run-69 adds a `referee/` sentence there;
put `state-exams/` after whatever the branch list ends with); (4) the `- **Doctor
(`fleet/doctor.mjs`)` bullet — the count and the table — and the `- **Laptop config` bullet
with its JSON example (add `"render": { "integration": "browser-run", "account": "<id>" }` and
`"account": "<name>"` as optional keys); (5) the fenced `new` verb in `Launch order` and the
sentence in `Integration naming`. The exam-environment bullet's text, in substance: `Run:` and
`Check:` commands and the exam command run with `ULTRA_BASE` set to the base the tree was cut
at; the two exam sites and the per-task `Run:`/`Check:` sites also receive `ULTRA_TASK` (the task
id), `ULTRA_RUN_DIR` (`<target>/.claude/ultrapowers/run-<N>`, the same directory as
`FLEET_RUN_DIR`) and `ULTRA_EXAM_PASS` (`base` at the at-BASE probe, `0` at the pre-review pass,
`1`/`2` at a review round that re-executes); the integrated `Run:` receives `ULTRA_TASK` and
`ULTRA_EXAM_PASS=integrated` and no `ULTRA_RUN_DIR`; the integrated `Check:` receives only
`ULTRA_BASE`; the suite receives none. Three phrases are read back verbatim by the proof and
must appear in that bullet: the values as `` `base`, `0`, `1`, `2` `` and `` `integrated` ``;
the words `no ULTRA_RUN_DIR` with the variable in backticks; and the words
`the suite receives none of the four`. The fold sub-bullet's amendment must contain the words
`omits the TINYAPP_RENDER_URL entry` (the variable in backticks) and must not spell
`TINYAPP_RENDER_URL=` — the fold's own argv is quoted there and it does not carry the entry. The
`Integration naming` bullet must contain the words `present only when fleet.json carries render`
(both in backticks) and `nothing rides tag:fleet` (the tag in backticks). The `render` doctor row: `| `render` | `integrations list --json`
against `fleet.json`'s `render` | `not configured` when the file names none; otherwise
`render.integration` is a name in the listing |`.
**BASE facts:** (generated at a526641)
- `render` at `evals/fixtures/contend-wide/reference/clitool/cli.py:26` blob 28b0cfd
- `base` at `fleet/doctor.mjs:305` blob f9a1174
- `integrated` at `fleet/tests/test_run_engine_pre_review.mjs:827` blob 9b06675
- `integration` at `fleet/run-waves.mjs:103` blob 27f25b5
- `account` at `fleet/doctor.mjs:211` blob f9a1174
- `cpu` at `fleet/launch.mjs:549` blob 8cc2fc3
- `memory` at `fleet/launch.mjs:550` blob 8cc2fc3
- `fleet/CONTRACT.md` blob 7990429
- `tests/test_docs_agree_with_code.py` blob ffe9fa2
- `fleet/doctor.mjs` blob f9a1174
- `fleet/tests/test_sandbox_boot_selfmerge.mjs` blob 00ac21b

**Proof:**
- Run: sed -n '/^- \*\*Exam environment:\*\*/,/^- \*\*/p' fleet/CONTRACT.md | tr '\n' ' ' | grep -q 'ULTRA_BASE.*ULTRA_TASK.*ULTRA_RUN_DIR.*ULTRA_EXAM_PASS'
- Run: sed -n '/^- \*\*Exam environment:\*\*/,/^- \*\*/p' fleet/CONTRACT.md | tr '\n' ' ' | grep -q '.base., .0., .1., .2..*.integrated.'
- Run: sed -n '/^- \*\*Exam environment:\*\*/,/^- \*\*/p' fleet/CONTRACT.md | tr '\n' ' ' | grep -q 'integrated.*no .ULTRA_RUN_DIR.'
- Run: sed -n '/^- \*\*Exam environment:\*\*/,/^- \*\*/p' fleet/CONTRACT.md | tr '\n' ' ' | grep -q 'the suite receives none of the four'
- Run: sed -n '/^  - engine:/,/^  - publish fold:/p' fleet/CONTRACT.md | tr '\n' ' ' | grep -q 'ULTRAPOWERS_FLEET_RUN=run-N.*TINYAPP_RENDER_URL=\${TINYAPP_RENDER_URL:-}.*node'
- Run: sed -n '/^  - publish fold:/,/^  - after the engine:/p' fleet/CONTRACT.md | tr '\n' ' ' | grep -q 'omits the .TINYAPP_RENDER_URL. entry'
- Run: ! sed -n '/^  - publish fold:/,/^  - after the engine:/p' fleet/CONTRACT.md | grep -q 'TINYAPP_RENDER_URL='
- Run: sed -n '/ultra\/evidence-run-<N>. — the run/,/ultra\/integration-run-<N>. — the work/p' fleet/CONTRACT.md | tr '\n' ' ' | grep -q 'state-exams/.*task-<id>.*file by file'
- Run: sed -n '/^- \*\*Doctor/,/^- \*\*Janitor/p' fleet/CONTRACT.md | tr '\n' ' ' | grep -q 'eight rows'
- Run: ! sed -n '/^- \*\*Doctor/,/^- \*\*Janitor/p' fleet/CONTRACT.md | grep -q 'five rows'
- Run: sed -n '/^- \*\*Doctor/,/^- \*\*Janitor/p' fleet/CONTRACT.md | grep '^  |' | tail -1 | grep -q '| .render. |.*not configured.*render.integration'
- Run: sed -n '/^- \*\*Laptop config/,/^- \*\*Logs without/p' fleet/CONTRACT.md | tr '\n' ' ' | grep -q '"render".*"integration".*"account"'
- Run: ! sed -n '/^- \*\*Laptop config/,/^- \*\*Logs without/p' fleet/CONTRACT.md | grep -q 'exactly two keys'
- Run: test "$(grep -c -- '--integration claude-max,gh-<owner>-<repo>\[,browser-run\]' fleet/CONTRACT.md)" = 2
- Run: ! grep -q -- '--integration claude-max,gh-<owner>-<repo> ' fleet/CONTRACT.md
- Run: sed -n '/^- \*\*Integration naming/,/^- \*\*Doctor/p' fleet/CONTRACT.md | tr '\n' ' ' | grep -q 'present only when .fleet.json. carries .render.'
- Run: sed -n '/^- \*\*Integration naming/,/^- \*\*Doctor/p' fleet/CONTRACT.md | tr '\n' ' ' | grep -q 'nothing rides .tag:fleet.'
- Run: python3 -m pytest -q tests/test_docs_agree_with_code.py
- Run: node fleet/tests/test_sandbox_boot_selfmerge.mjs | grep -q 'ALL TESTS PASSED'
- Legs: (a) the `Exam environment` bullet exists — every sed range over it is empty on a
  contract without the bullet, so each grep fails — and names the four variables in order, the
  five values spelled `base`, `0`, `1`, `2` and `integrated`, the phrase `no ULTRA_RUN_DIR` after
  `integrated`, and the phrase `the suite receives none of the four` [M1]; (b) the engine
  sub-bullet's argv carries the render entry between `ULTRAPOWERS_FLEET_RUN=run-N` and `node`,
  and the publish-fold sub-bullet says `omits the TINYAPP_RENDER_URL entry` while carrying no
  `TINYAPP_RENDER_URL=` — a fold argv that included the entry fails the negative grep [M2]; (c) the evidence-branch
  sub-bullet names `state-exams/`, `task-<id>` and `file by file` [M3]; (d) the doctor bullet
  says `eight rows`, no longer `five rows`, its last table row is `render` with `not configured`
  and `render.integration`, and the laptop-config bullet names `render` with `integration` and
  `account` and no longer says `exactly two keys` [M4]; (e) the bracketed third name appears
  exactly twice, the old two-name spelling followed by a space appears nowhere, and the
  `Integration naming` bullet says `present only when fleet.json carries render` and
  `nothing rides tag:fleet` [M5]; (f) the docs test
  and the self-merge boot sim, which read the contract's anchors, still pass [M2, M4, M5].

**Stale-if:**
- path-absent: `tests/test_docs_agree_with_code.py`
- path-absent: `fleet/tests/test_sandbox_boot_selfmerge.mjs`

### Task 7: The authoring rule — a TinyApp plan's peer tasks name a state exam

**Type:** implementation

**Files:**
- Modify: `skills/ultrawrite/SKILL.md`
- Modify: `skills/ultrawrite/references/greenfield-stack.md`

**Claim:** An author of a TinyApp plan is told, in the skill, that every `peer` task names a
state exam, where the seeds and expected states live, and what the store module owes the
renderer's seed — and the skill still validates. (derived)
Machine: M1. `skills/ultrawrite/references/greenfield-stack.md` has a `## State exams` section
that says a TinyApp plan's `**Review:** peer` tasks name one `*.test.ts` state exam as a Proof
`Test:` path (the file imports `stateExam` from `tinyapp-exam` and declares `clock`, `seed`,
`action`, `expected`, `view`, `mutant`), that seeds live under `state-exams/seeds/` and expected
states under `state-exams/expected/` in the target as `getContent()`-shaped JSON, that the
store module honours `window.__TINYAPP_SEED__` — when present it loads that content and starts
neither the `WsSynchronizer` nor the persister — and that the render move is skipped and
recorded when `TINYAPP_RENDER_URL` is unset.
M2. Rule 7 of `## The worktree-pure contract` in `skills/ultrawrite/SKILL.md` names the state
exam (the words `state exam`) and points at `references/greenfield-stack.md`; the
`## Execution handoff — analyze, then recommend` section is byte-identical to BASE.
M3. `validate_skill.py` accepts `skills/ultrawrite`, and `tests/test_recommendation_rubric.py`
passes.

**Authorized-by:** spec `docs/superpowers/specs/2026-09-09-tinyapp-state-exams.md` §3.1, §3.2
(the seed convention is an authoring rule), §3.8 last paragraph, §7 step 3, §8 Adds; #803/#804
(the TinyApp paragraph already in `greenfield-stack.md`).

**Interfaces:**
- Consumes: none
- Produces: nothing

**Context:** `skills/ultrawrite/references/greenfield-stack.md` already carries `## The store,
and the TinyApp shape` (#803/#804: the scaffold command, the `TinyApp` word rule); the new
`## State exams` section follows it and precedes `## The engine boundary`. Its content, from
the spec: the exam file is one Bun test — the shape, verbatim, for the author to hand an
examiner in Context (the examiner receives no library docs):

    import { stateExam } from "tinyapp-exam";
    import { schema, addTodo } from "../../../src/store";   // relative to tests/exams/<slug>/, where the exam lands

    stateExam({
      clock: "2026-01-01T00:00:00Z",
      seed:     "state-exams/seeds/empty.json",
      action:   (store) => addTodo(store, "buy milk"),
      expected: "state-exams/expected/one-open-todo.json",
      view:     { selector: "li", count: 1, text: "buy milk", unchecked: true },
      mutant:   [{ table: "todos", row: "1", cell: "done", value: true }],
    });

`seed`/`expected` are `[tables, values]` (TinyBase `getContent()`), loaded with `setContent`
against the app's schema; `view` is the closed vocabulary
`{selector, count?, text?, attr?: {name, value}, checked?, unchecked?, absent?: true}`; `mutant`
is a list of `{table, row, cell, value}` / `{…, cell: absent}` / `{table, row: absent}`; the exam
lands under `tests/exams/<slug>/` so imports are written for that depth; snapshots fold as text
(two tasks editing one snapshot meet in the kernel line-wise, and the schema-typed load catches a
bad fold); the store module's `window.__TINYAPP_SEED__` branch is the plan's own task — "the
generated scaffold's store file is where the plan's Task writes this branch"; with
`TINYAPP_RENDER_URL` unset or empty the render move is `skipped` and recorded, so the exam is
still a store exam on a laptop or in CI. Say which tasks: every `**Review:** peer` task of a
TinyApp plan; a `lean` task may carry one.

`skills/ultrawrite/SKILL.md` rule 7 today reads "Greenfield targets take the Bun + TypeScript +
TinyBase defaults — … the TinyApp shape, and where the restriction stops:
`references/greenfield-stack.md`." Add one clause: a TinyApp plan's `peer` tasks name a state
exam, seeds under `state-exams/seeds/`, expected states under `state-exams/expected/`
(`references/greenfield-stack.md` §State exams). Touch nothing else in SKILL.md: the
`## Execution handoff — analyze, then recommend` section is shared with `hooks/session_start.sh`
and pinned by `tests/test_recommendation_rubric.py` (M2's byte-identical clause is that pin,
proved by the frozen-sha `Run:` below — the sha is that section's `git hash-object` at
`29eeda47`, re-pinned with the BASE facts before launch). `validate_skill.py` reads the
frontmatter and the body; a new section is fine.
**BASE facts:** (generated at a526641)
- `peer` at `fleet/run-engine.mjs:1347` blob 9b84b07
- `skills/ultrawrite/references/greenfield-stack.md` blob 101d764
- `clock` at `fleet/tests/test_claude_token.mjs:51` blob 15a4988
- `seed` at `fleet/tests/test_run_waves.mjs:308` blob 963d7e9
- `expected` at `fleet/tests/probe_addcwd_scope.mjs:49` blob b43a48c
- `skills/ultrawrite/SKILL.md` blob 0e06bbc
- `tests/test_recommendation_rubric.py` blob 4727ab6
- `skipped` at `fleet/referee-linker.mjs:366` blob f6374e7
- `hooks/session_start.sh` blob a70c87d

**Proof:**
- Run: sed -n '/^## State exams/,/^## The engine boundary/p' skills/ultrawrite/references/greenfield-stack.md | tr '\n' ' ' | grep -q 'peer.*state exam.*Test:'
- Run: sed -n '/^## State exams/,/^## The engine boundary/p' skills/ultrawrite/references/greenfield-stack.md | tr '\n' ' ' | grep -q 'stateExam.*tinyapp-exam.*clock.*seed.*action.*expected.*view.*mutant'
- Run: sed -n '/^## State exams/,/^## The engine boundary/p' skills/ultrawrite/references/greenfield-stack.md | tr '\n' ' ' | grep -q 'state-exams/seeds/.*state-exams/expected/.*getContent'
- Run: sed -n '/^## State exams/,/^## The engine boundary/p' skills/ultrawrite/references/greenfield-stack.md | tr '\n' ' ' | grep -q '__TINYAPP_SEED__.*neither.*WsSynchronizer.*persister'
- Run: sed -n '/^## State exams/,/^## The engine boundary/p' skills/ultrawrite/references/greenfield-stack.md | tr '\n' ' ' | grep -q 'TINYAPP_RENDER_URL.*skipped'
- Run: sed -n '/^7\. \*\*Greenfield/,/^## Decomposition/p' skills/ultrawrite/SKILL.md | tr '\n' ' ' | grep -q 'state exam.*greenfield-stack.md'
- Run: test "$(sed -n '/^## Execution handoff/,/^## Acceptance disposition/p' skills/ultrawrite/SKILL.md | git hash-object --stdin)" = "$(git show $ULTRA_BASE:skills/ultrawrite/SKILL.md | sed -n '/^## Execution handoff/,/^## Acceptance disposition/p' | git hash-object --stdin)"
- Run: python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrawrite
- Run: python3 -m pytest -q tests/test_recommendation_rubric.py
- Legs: (a) the `## State exams` section, read up to `## The engine boundary`, says `peer` tasks
  name a `state exam` as a `Test:`, spells the `stateExam` import from `tinyapp-exam` and the six
  fields in order, names both snapshot directories and `getContent`, states the
  `__TINYAPP_SEED__` branch starts `neither` the `WsSynchronizer` nor the `persister`, and
  names the `skipped` render move under an unset `TINYAPP_RENDER_URL` — each of the five
  scoped greps exits non-zero on the BASE file, which has no such section [M1]; (b) rule 7's
  paragraph, read up to `## Decomposition`, says `state exam` and points at
  `greenfield-stack.md` (absent from that paragraph at BASE), and the `## Execution handoff`
  section hashes to the same blob as BASE's — any byte moved there fails the equality [M2]; (c) `validate_skill.py` exits 0 on `skills/ultrawrite` and the rubric test passes
  [M3].

**Stale-if:**
- path-absent: `skills/ultrawrite/references/greenfield-stack.md`
- path-absent: `tests/test_recommendation_rubric.py`
