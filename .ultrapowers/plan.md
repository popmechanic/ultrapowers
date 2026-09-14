# The two halves left — the implementer runs its own proofs, and a bumped launch files its sheets under the number it got

**Grammar:** claims-v1

**Claim:** After this run, when I replay run-67, each implementer runs only its own task's proofs, and a launch whose run number bumps files its sheets under the number it actually got. (elicited)
**Summary:** This run finishes the engine plan. The implementer is handed its own task's proofs instead of the whole suite, and a launch that has to take the next run number recompiles under it so its fact sheets name the right exam directory. It exists because run-127 landed three of its four tasks and left these two halves, and the first of them is the one that moves the clock.

**Goal:** the re-drive of run-127's Task 1 (#872, #515 tier 1, #547) on the merged engine `14bf65a6`, plus the one defect run-127's Task 3 disclosed: its "compile once, before `new`" clause means a launch whose run number bumps re-files the hub's sheets under the new N without recompiling, so the sheets name the first N's exam directory. Width already reaches the engine off the box's own compile (`widestWaveOf` in `fleet/run-main.mjs`), so nothing here touches it. Readings stay #872's, on the run-67 replay that follows this run.
**Closes:** #515 #547

**Tech Stack:** Node 20+ (`fleet/*.mjs`, sims under `fleet/tests/`), markdown role files. Test command: `python3 -m pytest -n auto` from the repo root (the bridge runs the surviving sims).

**Spec:** run-127's record (`ultra/evidence/run-127`, task 1's `proof-red`, task 3's notes); the engine plan `2026-09-14-the-worker-proves-its-own-task.md` Task 1, whose text this task carries forward with the seam removed.

**Parallelization rationale:** one wave, width 2. Task 1 is the engine's prompt composition and two role files; Task 2 is the launcher's compile-and-bump path. No file is in both, and neither needs the other's runtime behaviour.

## Global Constraints

- The examiner, the reviewer, the resolver, the reconciler, the fold, the publish, the boot, the lobby and the compiler are untouched: `fleet/roles/examiner.md`, `fleet/roles/reviewer.md`, `fleet/roles/reconcile.md`, `fleet/roles/resolver.md`, `fleet/publish-fold.mjs`, `fleet/sandbox-boot.sh`, `fleet/lobby.mjs`, `fleet/run-waves.mjs`, `fleet/run-worker.mjs`, `fleet/confine-hook.mjs`, everything under `skills/ultrapowers/scripts/` and `skills/ultrapowers/kernel/` are byte-identical to BASE.
- Check: git diff --quiet $ULTRA_BASE -- fleet/roles/examiner.md fleet/roles/reviewer.md fleet/roles/reconcile.md fleet/roles/resolver.md fleet/publish-fold.mjs fleet/sandbox-boot.sh fleet/lobby.mjs fleet/run-waves.mjs fleet/run-worker.mjs fleet/confine-hook.mjs skills/ultrapowers/scripts skills/ultrapowers/kernel
- The driver still executes every Proof `Run:`, every exam and every Global Constraints `Check:` itself, in the task's clone and on the adopted tree, recorded as `driver:proof-run`, `driver:exam-run`, `driver:check-run` and `driver:integrated-run` exactly as at BASE.
- No role file shouts: a new sentence in `fleet/roles/*.md` carries no all-caps imperative.

### Task 1: The implementer runs its own proofs, not the suite

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/run-engine.mjs`
- Modify: `fleet/run-main.mjs`
- Modify: `fleet/roles/implementer.md`
- Modify: `fleet/roles/fix.md`
- Modify: `fleet/tests/test_run_engine_proof_runs.mjs`
- Modify: `fleet/tests/test_run_engine_review_economy.mjs`
- Test: `fleet/tests/test_run_engine_own_proofs.mjs`

**Claim:** After this run an implementer is handed its own task's proofs and iterates against those, never against the whole suite. (derived)
Machine: M1. The implementer's prompt carries no line beginning `TEST COMMAND:` and carries one `PROOFS:` block: one line per Proof `Run:` command of its task and one line per Global Constraints `Check:` command, each verbatim, in plan order, prefixed `- Run: ` and `- Check: ` respectively; a task with no `Run:` and a run with no `Check:` gets a `PROOFS:` block that says `(none — the driver runs the exam at handoff)`. M2. The fix round's prompt has the same shape as M1: no `TEST COMMAND:` line, the same `PROOFS:` block. M3. The examiner's prompt still carries its `TEST COMMAND:` line naming the exam command, unchanged from BASE. M4. `capWorkerParallelism`, `sharesRunWideCmd`, `runWideSharers` and `implTestCmdLine` are not defined in `fleet/run-engine.mjs`, and neither `fleet/roles/implementer.md` nor `fleet/roles/fix.md` contains the string `TEST COMMAND`. M5. The reconciler's prompt still carries the run-wide `TEST COMMAND:` line and no `PROOFS:` block. M6. The two survivor sims this task may edit, `fleet/tests/test_run_engine_proof_runs.mjs` and `fleet/tests/test_run_engine_review_economy.mjs`, each print `ALL TESTS PASSED` on the patched tree.

**Authorized-by:** run-127 task 1 (`proof-red` on a seam: its proof ran a sim a sibling owned); #515 (tier 1), reopened after #663; #547; #872. Reading: run-67's and run-124's implementers each spent 10 to 16 of their 15 to 25 minutes on a serial full-suite pass with zero red proofs.

**Interfaces:**
- Consumes: none
- Produces: `PROOFS:` — the implementer's and fix round's prompt block, `\nPROOFS:\n- Run: <cmd>\n- Check: <cmd>` lines in plan order

**Context:** At BASE (`14bf65a6`) the implementer's inputs are built at `fleet/run-engine.mjs:1839`: `implTestCmdLine(task, workerTestCmd)` (~359) hands the implementer its own `testCmd` unless that command names a Proof `Test:` path (`namesProofTest`), in which case it hands the run-wide suite — since #653 every peer-reviewed task's command is its exam, so every implementer got the suite. `workerTestCmd` (~1356–1358) is the run-wide command capped by `capWorkerParallelism(testCmd, runWideSharers, os.cpus().length)` (~315–330), the guard that made every implementer's suite serial at width 10 on 4 cores. The fix round's line is `fixTestCmdLine()` (~1843, used ~2432). The task's `Run:` commands are `task.proofRuns` and the run's `Check:` commands are `constraintChecks`, both in scope where the prompts are built. Replace the implementer's and fix round's `TEST COMMAND:` line with a `PROOFS:` block built from those two arrays; leave `testCmdLine(examCmdTask, …)` for the examiner and the reconciler's `'\nTEST COMMAND: ' + testCmd` (~2944) exactly as they are; delete the four symbols M4 names and the comment paragraphs that exist only to explain them (~315–370 and ~1350–1360), and the comment at `fleet/run-main.mjs:77` that names `capWorkerParallelism`. `fleet/roles/implementer.md` line 7 lists `TEST COMMAND (the project's test command)` among the inputs and rule 2 (~26) says "iterate against the suite the TEST COMMAND runs" — rewrite both to the `PROOFS:` block: run the proofs listed there and stop when they pass; rule 1's `startHead` and rule 4's commit stay. `fleet/roles/fix.md` says the same in its own words — bring it to the same block. `fleet/run-worker.mjs` (frozen) derives `FLEET_TEST_CMD` from the first `TEST COMMAND:` line of a prompt and deletes the variable when there is none; the confine hook uses it only to deny a `pkill -f` pattern matching the test command, so an implementer prompt without the line loses nothing, and `fleet/tests/test_worker_kata_env.mjs` pins that derivation on its own fixture prompt, untouched. **The seam run-127 failed on:** `fleet/tests/test_run_engine_proof_runs.mjs` builds probe copies of sibling sims in its loop at ~line 950, and its row (i) copies `fleet/tests/test_run_engine_review_economy.mjs`; both are survivors and both are in this task's Files now, so if either sim reads the implementer's prompt for the suite line, re-aim that leg at the `PROOFS:` block and say so in a comment naming this task — but read them first: at BASE neither contains the string `TEST COMMAND`, so the red run-127 saw may have been the pre-#974 pair and critic legs, which are gone on this base. The exam for this task is a sim in the shape of `_engine_helpers.mjs`'s `rig`: a stub `agent` that records every prompt by label, a task with two `Run:` lines and a run with one `Check:`, asserting the implementer's and fix round's prompts by M1/M2, the examiner's by M3, and — with the rig's `check.sh` made red on the folded tree once so a `reconcile:` worker is dispatched — the reconciler's by M5. Comment carriers: `grep -n` each of the four M4 symbols across `fleet/run-engine.mjs` before editing; the zero-count leg counts comments.

**Proof:**
- Test: `fleet/tests/test_run_engine_own_proofs.mjs`
- Guard: `fleet/tests/test_run_engine_own_proofs.mjs`
- Run: test "$(grep -c -e 'capWorkerParallelism' -e 'sharesRunWideCmd' -e 'runWideSharers' -e 'implTestCmdLine' fleet/run-engine.mjs)" = 0
- Run: test "$(grep -c 'TEST COMMAND' fleet/roles/implementer.md fleet/roles/fix.md | awk -F: '{s+=$2} END {print s}')" = 0
- Run: node fleet/tests/test_run_engine_proof_runs.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_run_engine_review_economy.mjs | grep -q 'ALL TESTS PASSED'
- Legs: (a) with a task carrying two `Run:` lines and a run carrying one `Check:`, the recorded `impl:` prompt has no `TEST COMMAND:` line and its `PROOFS:` block is exactly the three lines in order; with a task carrying no `Run:` and a run carrying no `Check:`, the block is the `(none — …)` sentence [M1]; (b) after a red proof the recorded `fix:<id>:0` prompt has the same `PROOFS:` block and no `TEST COMMAND:` line [M2]; (c) the recorded `exam:` prompt carries `TEST COMMAND:` naming the exam command [M3]; (d) the four symbols are absent from the engine and `TEST COMMAND` from both role files, by the two greps [M4]; (e) with a stub whose folded-tree suite is red once, the recorded `reconcile:` prompt carries a `TEST COMMAND:` line naming the run-wide command and no `PROOFS:` block [M5]; (f) both survivor sims print their sentinel on the patched tree, by the two `Run:` lines; whether a leg was dropped is the reviewer's exam-edit reading, not this exam's [M6].

**Stale-if:**
- path-absent: `fleet/roles/implementer.md`
- path-absent: `fleet/tests/_engine_helpers.mjs`

### Task 2: A bumped launch files its sheets under the number it got

**Type:** implementation

**Files:**
- Modify: `fleet/launch.mjs`
- Modify: `fleet/tests/test_launch_size.mjs`
- Test: `fleet/tests/test_launch_bump.mjs`

**Claim:** After this run a launch that has to take the next run number recompiles under it, so the sheets it files on the hub name the exam directory the sandbox will actually use. (derived)
Machine: M1. When the plan push for `ultra/plan-run-<N>` is refused and the launcher re-reads the target's highest run and bumps to N+1, it runs `compile_plan.py <plan> --stamp run-<N+1> --base <sha>` before filing the hub's project and sheets for N+1, and the sheets it files carry the N+1 stamp's exam directory (`exams/run_<N+1>/`), never `run_<N>`'s. M2. A launch that is not bumped runs exactly one stamped compile, ordered before its `new` verb, and the VM size read off that compile is unchanged from BASE. M3. On a bump, the size the `new` verb carries is computed from the recompiled payload, and the assignment comment carries `run=<N+1>`.

**Authorized-by:** run-127 task 3's disclosed divergence (`ultra/evidence/run-127`, task 3 notes): the engine plan's M3 said "compiles the plan once, before the `new` verb", and the bump path then re-files the first N's sheets under the new N.

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** At BASE `compilePlanForRun({ exec, repoDir, planPath, base, stamp })` (`fleet/launch.mjs:659`) answers `{ stamp, payload, waves, edges }`; `launch` calls it once with `stamp: run-${firstRun}` (~1054) and sizes the VM from its waves (~1057–1065); the kata filing (~1098–1114) re-files that same payload on a bump, and the comment at ~1098–1104 records why that is wrong: `--stamp` decides each task's reserved exam directory (`compile_plan.py`'s `reserved_exam_path`, `exams/<run-id>/`), so the sheets a bumped run files name the first N's directory while the box's own compile names the real one. The bump lives in `pushPlan` (~1435): a refused push re-reads `highestRunOnTarget` and tries N+1. Make the compile follow the number — one `compilePlanForRun` per attempted N, the hub filing reading the compile for that N — and keep the un-bumped launch at exactly one compile before `new`. The sizing reads the widest wave, which is the same for every stamp, so the VM size is unchanged by design; M3 pins that it is read from the recompiled payload anyway. `fleet/tests/test_launch_size.mjs` leg (c) (~lines 23–24, 275–276, 355–358) pins "exactly one `compile_plan.py … --stamp …` invocation per launch, ordered before `new`" — narrow it to the un-bumped launch it already drives, in place, with a comment naming this task; the bumped case is the new exam's. The exam drives `launch` against the fake lobby in `fleet/tests/_lobby_helpers.mjs` with a fake exec whose first `git push` of `ultra/plan-run-<N>` is refused (non-fast-forward) and whose `ls-remote` then answers N as taken, so the launcher bumps; it records every `python3 … --stamp` call and the hub filing's payload.

**Proof:**
- Test: `fleet/tests/test_launch_bump.mjs`
- Guard: `fleet/tests/test_launch_bump.mjs`
- Run: node fleet/tests/test_launch_bump.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_launch_size.mjs | grep -q 'ALL TESTS PASSED'
- Legs: the `Test:` exam is what the driver runs as this task's exam command, and the first `Run:` executes it again as a proof so its sentinel is on the record; (a) under the fake lobby with the first push refused, the fake exec records two stamped compiles, `run-<N>` then `run-<N+1>`, and the project and sheets filed on the fake hub carry `run_<N+1>` in every exam path and no `run_<N>` [M1]; (b) with no push refused, exactly one stamped compile is recorded, before the `new` verb, and the `--cpu`/`--memory` on `new` equal BASE's for the same plan; the narrowed sizing sim still prints its sentinel [M2]; (c) on the bumped launch, the `new` verb's `--comment` carries `run=<N+1>` and its `--cpu`/`--memory` equal the size computed from the second compile's waves [M3].

**Stale-if:**
- path-absent: `fleet/tests/_lobby_helpers.mjs`
- path-absent: `fleet/tests/test_launch_size.mjs`
