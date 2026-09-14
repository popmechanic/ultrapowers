# The worker proves its own task — the implementer runs its own proofs, one reviewer and one fix round per task, no critic, the VM sized to the plan

**Grammar:** claims-v1

**Claim:** After this run, when I replay run-67, each implementer runs only its own task's proofs, every task gets one reviewer and one fix round, no critic runs, the VM is sized to the plan, and the run comes in well under the 25 minutes I measured today. (elicited)
**Summary:** This run changes what a fleet worker is asked to do. The implementer runs only the proofs its own task names instead of the whole suite on a shared box, each task gets one reviewer and one fix round instead of a pair and two, the integration critic is gone, and the VM is sized from the plan's widest wave. It exists because the record shows the implementer spending most of its minutes waiting on a suite pass the driver already runs, and it is the experiment #872 pre-registered: acceptance is exams and probes, the suite is a reported sensor, and the run-67 replay is the number.

**Goal:** #872 executed (map #870): acceptance = exams + probes, the suite reported not gated. This reopens #515 tier 1 (workers run task-scoped tests), which #663 reversed for every peer-reviewed task by handing the implementer the run-wide suite; it does what #547 asked (the parallelism cap goes with its sharers); it deletes the critic on the reading that its findings have no catch on record (runs 40–116), keeps one reviewer on its 22 blocking findings in 12 runs, and cuts the fix loop to one round on 27 first rounds against 9 second. Readings pre-registered on the run-67 replay (run-124 today: 24.7 min launch→approved, wave 21.7 bounded by a 15-min implementer, critic 3.0): launch→approved minutes; suite passes on the critical path; first-attempt proof-red rate and fix-round outcome; any escape a later run catches; judging share of worker minutes.
**Closes:** #872 #515 #547

**Tech Stack:** Node 20+ (`fleet/*.mjs`, sims under `fleet/tests/`), bash, markdown role files. Test command: `python3 -m pytest -n auto` from the repo root (the bridge runs the surviving sims).

**Spec:** the session record of 2026-09-13/14 (memory `record-reading-runs-40-116-2026-09-13` and `sitting-2026-09-14-clock-pass-move-1`); issues #872, #515, #663, #547, #870.

**Parallelization rationale:** one wave, width 4. The tasks are four seams — what the implementer is handed (Task 1), how a task is judged after it returns (Task 2), how big the box is (Task 3), and the boot chain's dead knob (Task 4, the leftover run-126's critic found). Tasks 1 and 2 both edit `fleet/run-engine.mjs` in different regions (the prompt composition near line 1900; the review dispatch near 2600 and the critic near 3560) and Tasks 2 and 3 both edit `fleet/run-main.mjs`; same-file text folds. No task needs another's runtime behaviour.

## Global Constraints

- The examiner, the resolver, the reconciler, the fold, the publish and the compiler are untouched: `fleet/roles/examiner.md`, `fleet/roles/reconcile.md`, `fleet/roles/resolver.md`, `fleet/publish-fold.mjs`, `fleet/run-waves.mjs`, `fleet/run-worker.mjs`, `fleet/confine-hook.mjs`, everything under `skills/ultrapowers/scripts/` and `skills/ultrapowers/kernel/` are byte-identical to BASE.
- Check: git diff --quiet $ULTRA_BASE -- fleet/roles/examiner.md fleet/roles/reconcile.md fleet/roles/resolver.md fleet/publish-fold.mjs fleet/run-waves.mjs fleet/run-worker.mjs fleet/confine-hook.mjs skills/ultrapowers/scripts skills/ultrapowers/kernel
- The driver still executes every Proof `Run:`, every exam and every Global Constraints `Check:` itself, in the task's clone and on the adopted tree, and records them as `driver:proof-run`, `driver:exam-run`, `driver:check-run` and `driver:integrated-run` exactly as at BASE: those are the acceptance, and nothing here moves them.
- Every top-level key `report.json` carries at BASE is still present with the same type after this run (`completenessFindings` stays, as an empty list; `reviewEconomy` stays, with two keys fewer), so `gate_check.py`, `ultra_gate.py`, the PR card in `fleet/sandbox-boot.sh` and the viz projection read the same shape.
- No role file shouts: a new sentence in `fleet/roles/*.md` carries no all-caps imperative.
- `fleet/sandbox-boot.sh` changes only where Task 4 names: every line its diff against BASE adds or removes carries the word `overlap` or `OVERLAP`.
- Check: test "$(git diff $ULTRA_BASE -- fleet/sandbox-boot.sh | grep '^[-+]' | grep -v '^+++\|^---' | grep -v -i overlap | wc -l | tr -d ' ')" = 0

### Task 1: The implementer runs its own proofs, not the suite

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/run-engine.mjs`
- Modify: `fleet/roles/implementer.md`
- Modify: `fleet/roles/fix.md`
- Modify: `fleet/run-main.mjs`
- Modify: `fleet/CONTRACT.md`
- Test: `fleet/tests/test_run_engine_own_proofs.mjs`

**Claim:** After this run an implementer is handed its own task's proofs and iterates against those, never against the whole suite. (derived)
Machine: M1. The implementer's prompt carries no line beginning `TEST COMMAND:` and carries one `PROOFS:` block: one line per Proof `Run:` command of its task and one line per Global Constraints `Check:` command, each verbatim, in plan order, prefixed `- Run: ` and `- Check: ` respectively; a task with no `Run:` and a run with no `Check:` gets a `PROOFS:` block that says `(none — the driver runs the exam at handoff)`. M2. The fix round's prompt has the same shape as M1: no `TEST COMMAND:` line, the same `PROOFS:` block. M3. The examiner's prompt still carries its `TEST COMMAND:` line naming the exam command, unchanged from BASE. M4. `capWorkerParallelism`, `sharesRunWideCmd`, `runWideSharers` and `implTestCmdLine` are not defined in `fleet/run-engine.mjs`, and neither `fleet/roles/implementer.md` nor `fleet/roles/fix.md` contains the string `TEST COMMAND`. M5. The reconciler's prompt still carries the run-wide `TEST COMMAND:` line and no `PROOFS:` block: the fold's suite is the reconciler's signal.

**Authorized-by:** #515 (tier 1: the worker loop runs task-scoped tests), reopened after #663; #547; #872. Reading: run-67's and run-124's implementers each spent 10 to 16 of their 15 to 25 minutes on a serial full-suite pass on a shared VM, with zero red proofs.

**Interfaces:**
- Consumes: none
- Produces: `PROOFS:` — the implementer's and fix round's prompt block, `\nPROOFS:\n- Run: <cmd>\n- Check: <cmd>` lines in plan order

**Context:** At BASE the implementer's inputs are built near `fleet/run-engine.mjs:1905–1915`: `implTestCmdLine(task, workerTestCmd)` hands the implementer its own `testCmd` unless that command names a Proof `Test:` path (`namesProofTest`, ~385), in which case it hands the run-wide suite — since #653 every peer-reviewed task's command is its exam, so every implementer got the suite. `workerTestCmd` (~1425) is the run-wide command capped by `capWorkerParallelism(testCmd, runWideSharers, os.cpus().length)` (~337, ~1416–1430), which rewrote `-n auto` to `-p no:xdist` at width 10 on 4 cores and is the reason each implementer waited ten minutes. The fix round's line is `fixTestCmdLine()` (~1919). The task's `Run:` commands are `task.proofRuns` (~1946) and the run's `Check:` commands are `constraintChecks` (~1440) — both already in scope where the prompts are built. Replace the implementer's and fix round's `TEST COMMAND:` line with a `PROOFS:` block built from those two arrays; leave `testCmdLine(examCmdTask, …)` for the examiner and the reconciler's `'\nTEST COMMAND: ' + testCmd` (~3082) exactly as they are; delete the four symbols M4 names and every comment block that exists only to explain them (the #436/#547/#663 paragraphs at ~325–392 and ~1410–1430). `fleet/roles/implementer.md` rule 2 says "You iterate against the suite the TEST COMMAND runs" and rule 3 "run the test command clean one final time" — rewrite both to say the task's proofs are under `PROOFS:`, run them, and stop when they pass; rule 1's `startHead` and rule 4's commit stay. `fleet/roles/fix.md` says "run the TEST COMMAND clean" (~line 17) — same rewrite; the paragraph that says a Proof `Test:` file in the tree is the peer's exam stays. `fleet/CONTRACT.md` describes the implementer's `TEST COMMAND` where it describes worker inputs — reword that sentence to the `PROOFS:` block. `fleet/run-main.mjs:69` is a comment naming `capWorkerParallelism` — reword it, since the symbol is gone (Tasks 2 and 3 edit other regions of the same file; text folds). `fleet/run-worker.mjs` (frozen) derives `FLEET_TEST_CMD` from the first `TEST COMMAND:` line of a prompt and deletes the variable when there is none; the confine hook uses it only to deny a `pkill -f` pattern that would match the test command, so an implementer prompt without the line loses nothing — the hook still guards `claude`. The survivor sim `fleet/tests/test_run_engine_proof_runs.mjs` captures the prompts the engine builds and asserts on `driver:proof-run` events; it does not pin the `TEST COMMAND:` line, so it stays green without an edit — run it. The exam for this task is a sim in the shape of `_engine_helpers.mjs`'s `rig`: a stub `agent` that records every prompt by label, a task with two `Run:` lines and a run with one `Check:`, asserting the implementer's and fix round's prompts by M1/M2, the examiner's by M3, and — with the rig's `check.sh` made red on the folded tree once so a `reconcile:` worker is dispatched — the reconciler's by M5. The survivor sim `test_run_engine_proof_runs.mjs` is run as a `Run:` because it asserts the driver's `driver:proof-run` events, which this task must not change.

**Proof:**
- Test: `fleet/tests/test_run_engine_own_proofs.mjs`
- Guard: `fleet/tests/test_run_engine_own_proofs.mjs`
- Run: test "$(grep -c -e 'capWorkerParallelism' -e 'sharesRunWideCmd' -e 'runWideSharers' -e 'implTestCmdLine' fleet/run-engine.mjs)" = 0
- Run: test "$(grep -c 'TEST COMMAND' fleet/roles/implementer.md fleet/roles/fix.md | awk -F: '{s+=$2} END {print s}')" = 0
- Run: node fleet/tests/test_run_engine_proof_runs.mjs | grep -q 'ALL TESTS PASSED'
- Legs: (a) with a task carrying two `Run:` lines and a run carrying one `Check:`, the recorded `impl:` prompt has no `TEST COMMAND:` line and its `PROOFS:` block is exactly the three lines in order; with a task carrying none, the block is the `(none — …)` sentence [M1]; (b) after a red proof the recorded `fix:<id>:0` prompt has the same `PROOFS:` block and no `TEST COMMAND:` line [M2]; (c) the recorded `exam:` prompt carries `TEST COMMAND:` naming the exam command [M3]; (d) the four symbols are absent from the engine and `TEST COMMAND` from both role files, by the two greps [M4]; (e) with a stub whose folded-tree suite is red once, the recorded `reconcile:` prompt carries a `TEST COMMAND:` line naming the run-wide command and no `PROOFS:` block [M5].

**Stale-if:**
- path-absent: `fleet/roles/implementer.md`
- path-absent: `fleet/tests/_engine_helpers.mjs`

### Task 2: One reviewer, one fix round, no critic

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/run-engine.mjs`
- Modify: `fleet/run-main.mjs`
- Modify: `fleet/roles/README.md`
- Modify: `fleet/CONTRACT.md`
- Modify: `skills/ultrapowers/references/report-format.md`
- Modify: `fleet/tests/test_run_engine_proof_runs.mjs`
- Modify: `fleet/tests/test_run_engine_joined_proofs.mjs`
- Modify: `fleet/tests/test_run_engine_review_economy.mjs`
- Modify: `fleet/tests/test_run_engine_infra_retry.mjs`
- Delete: `fleet/roles/critic.md`
- Test: `fleet/tests/test_run_engine_one_of_each.mjs`

**Claim:** After this run a task is reviewed once and fixed at most once, and no critic reads the finished run. (derived)
Machine: M1. Every review round dispatches exactly one worker, labeled `review:<id>:<iter>` with no trailing pass number, whatever the task's `**Review:**` value is; the `peer` value still means the task is reviewed, and `lean` still means it is not. M2. A task gets at most one fix dispatch, labeled `fix:<id>:0`; a second red after it ends the task `fix-loop-exhausted`, and no `fix:<id>:1` label is ever dispatched. M3. No worker labeled `integration` is dispatched, `fleet/roles/critic.md` is absent, and `loadRoles` reads no `critic` entry. M4. The `report.json` the engine writes carries `completenessFindings` deep-equal to `[]` and a `reviewEconomy` object with the keys `reviewerMs`, `blockingFindings` and `blockingPerReviewerMinute` and neither `pairRounds` nor `r2MarginalBlocking`; and `criticDecision` as exported by `fleet/run-main.mjs`, applied to that report, answers `{ approve: true, blocking: [] }` with the reason `0 completeness finding(s), none blocking`. M5. The four surviving engine sims `test_run_engine_proof_runs.mjs`, `test_run_engine_joined_proofs.mjs`, `test_run_engine_review_economy.mjs` and `test_run_engine_infra_retry.mjs` each print `ALL TESTS PASSED`.

**Authorized-by:** #872; the review reading of 2026-09-13 (22 blocking findings in 12 of 71 runs, five real code defects only the reviewer saw; the second reviewer's marginal record 8 findings, none of those five; the critic's `completenessFindings` with no catch on record; 27 first fix rounds against 9 second, runs with a fix merged 11 times and not 17); the referee deletion at #921 as the precedent for deleting a judge on its reading.

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** The pair is dispatched at `fleet/run-engine.mjs` ~2612–2645: `isPairReview(taskReviewProfile(task))` runs `timedReview` twice with `reviewOpts(1)` and `reviewOpts(2)`, merges `issues`/`verdicts`, and the infra-death branch redispatches whichever half died; `isPairReview` (~395) and `reviewProfile` (~1433, ~1480) decide whether a task is reviewed at all — keep that meaning (`peer` = reviewed, `lean` = not) and make the reviewed path a single `timedReview` with `reviewOpts()` producing the label `review:<id>:<iter>` (the `pass ? ':' + pass : ''` tail already renders nothing when `pass` is absent). `pairRounds` (~1513) and `r2MarginalBlocking` feed `reviewEconomy` (~3800) — delete both keys and their arithmetic; keep `reviewerMs`, `blockingFindings`, `blockingPerReviewerMinute`. The fix loop is `for (let iter = 1; iter <= 2; iter++)` (~2580): make it one round, so the second red after `fix:<id>:0` takes the `fix-loop-exhausted` exit that exists today. The critic is `runCritic` (~3563–3617): it builds `roles.critic + …` and dispatches `integration`; delete the function, its call, the `critic` entry `loadRoles` reads (`fleet/roles/critic.md` is deleted here, and `loadRoles` at ~315 reads every name it is given, so drop `critic` from that list), and set `completenessFindings: []` where the report is assembled (~3804) — the key stays because `run-main.mjs:292 criticDecision`, `gate_check.py`, the card's residual reader in `fleet/sandbox-boot.sh` and the viz projection all read it. In `fleet/run-main.mjs` remove the `critic: 15 * 60 * 1000` timeout row (~102) and the `'critic'` arm of the role predicate (~473); leave `criticDecision` and the `driver:critic-decision` event as they are. `fleet/roles/README.md:13` lists `critic.md` — remove the row and the sentence at ~17. `fleet/CONTRACT.md` names the critic at ~459 (`integration` carries no `KATA_REF`), ~479 (the event list, keep `driver:critic-decision` since run-main still emits it), ~577 and ~582 (residual items per reviewer/critic finding) — reword to the reviewer alone. `skills/ultrapowers/references/report-format.md` documents `reviewEconomy` (~37–39, ~102) and `completenessFindings` (~67) — drop the two keys and say the findings list is always empty since this release. The four survivor sims pin the old shape: `test_run_engine_proof_runs.mjs` filters and expects the `integration` label (~126, ~155–164, ~308, ~401, ~455 `['impl:T1', 'review:T1:1', 'integration']`, ~508, ~579, ~692, ~753, ~779) and a `review:<id>:2` label (~656); `test_run_engine_joined_proofs.mjs` reads `fleet/roles/critic.md` and dispatches `integration` (~43–61, ~118, ~348–350, ~442–450); `test_run_engine_review_economy.mjs` pins `pairRounds` and `r2MarginalBlocking`; `test_run_engine_infra_retry.mjs` pins the pair's infra redispatch and the critic's. In each, remove the legs and expectations about the second reviewer and the critic and leave every other leg byte for byte — a sim that loses a leg says so in a comment naming this task; the reviewer reads those four diffs against the exam-edit rule, so a loosened leg is a finding. Do not touch `fleet/roles/reviewer.md`: it addresses one reviewer already.

**Proof:**
- Test: `fleet/tests/test_run_engine_one_of_each.mjs`
- Guard: `fleet/tests/test_run_engine_one_of_each.mjs`
- Run: test ! -e fleet/roles/critic.md && test "$(grep -c -e 'runCritic' -e "roles.critic" -e 'pairRounds' -e 'r2MarginalBlocking' fleet/run-engine.mjs)" = 0
- Run: test "$(grep -c 'critic' fleet/roles/README.md)" = 0
- Run: node fleet/tests/test_run_engine_proof_runs.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_run_engine_joined_proofs.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_run_engine_review_economy.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_run_engine_infra_retry.mjs | grep -q 'ALL TESTS PASSED'
- Legs: (a) a `peer` task's recorded labels hold exactly one `review:<id>:1` and no label ending `:1:1` or `:1:2`; a `lean` task's hold none [M1]; (b) a stub that keeps a proof red through the fix round yields exactly one `fix:<id>:0` label, no `fix:<id>:1`, and the task row's `reviewVerdict` is `fix-loop-exhausted` [M2]; (c) the recorded labels never include `integration`, `critic.md` is absent, and `runCritic`/`roles.critic` are absent from the engine by grep [M3]; (d) the report the rig's run wrote has `completenessFindings` deep-equal to `[]`, `reviewEconomy` with exactly the three named keys, and `criticDecision(report)` imported from `../run-main.mjs` answers approve true, blocking `[]`, and that reason string [M4]; (e) each of the four survivor sims prints its sentinel, by the four `Run:` lines [M5].

**Stale-if:**
- path-absent: `fleet/roles/reviewer.md`
- path-absent: `fleet/tests/_engine_helpers.mjs`

### Task 3: The VM is sized to the plan, and the width is the plan's

**Type:** implementation

**Files:**
- Modify: `fleet/launch.mjs`
- Modify: `fleet/run-main.mjs`
- Modify: `fleet/RUNBOOK.md`
- Modify: `fleet/CONTRACT.md`
- Test: `fleet/tests/test_launch_size.mjs`

**Claim:** After this run a one-task plan gets a small box and a ten-task plan a bigger one, and the engine's width is the plan's widest wave, not a constant. (derived)
Machine: M1. With no `--cpu` and no `--memory` on the launch line, the `new` verb carries `--cpu C --memory MGB` where, for W the task count of the compiled plan's widest wave, C = min(cap, 2 + ceil(W / 3)) and M = min(capGB, 2 + W), and the cap is the `cpu`/`memory` pair `~/.ultrapowers/fleet.json` names or, absent, `FLEET_DEFAULTS`; so W = 1 gives `--cpu 3 --memory 3GB` and W = 10 gives `--cpu 6 --memory 8GB` under the caps 6 and 8GB. M2. An explicit `--cpu` or `--memory` on the launch line wins over the formula, and the billing-plan refusal for a value above `max_cpus`/`max_memory_gb` is unchanged. M3. The launcher compiles the plan (`compile_plan.py <plan> --stamp run-<N> --base <sha>`) once, before the `new` verb, and both the sizing and the kata filing read that one payload. M4. The engine's width bound is the plan's widest wave: `fleet/run-main.mjs` exports `widthOf(args)`, which answers `args.width` when it is a positive integer and `12` otherwise, the dispatch bound is built as `boundedParallel(widthOf(launchArgs))`, and the string `WIDTH = 12` does not occur in the file. M5. `node fleet/launch.mjs --help` still lists `[--cpu <n>] [--memory <n>GB]`, and `fleet/RUNBOOK.md`'s `## One-time setup` section says `cpu`/`memory` in `fleet.json` are the ceiling a run may ask for, not the size every run gets.

**Authorized-by:** the CPU-allocation reading of 2026-09-14 (the VM size is the only hard limit; `WIDTH` is a process constant of 12 that never read the core count; the plan's widest wave is known to the launcher from the compiled `launch_waves`); the operator's 2026-09-14 decision that sizing at launch is the elastic move exe.dev offers.

**Interfaces:**
- Consumes: none
- Produces: `vmSizeFor(widestWave, cap) -> { cpu: string, memory: string }` — exported from `fleet/launch.mjs`, pure, the formula of M1
- Produces: `widthOf(args) -> number` — exported from `fleet/run-main.mjs`, `args.width` when a positive integer, else `12`

**Context:** Today `fleet/launch.mjs:744–751` takes `cpu`/`memory` from `opts`, then `settings` (`fleet.json`), then `FLEET_DEFAULTS` (`fleet/lobby.mjs:168`, `8`/`16GB`), refuses non-integers, checks them against `billing plan --json` (~932–939) and writes them into the `new` verb (~1031). The compile that yields `launch_waves` runs inside `fileRunOnHub` (~1363–1373), which is called after `new` — move that compile up so it runs once before the verb, keep its `Refusal` messages, and pass the payload down to `fileRunOnHub` instead of recompiling there; the payload's `launch_waves` is a list of waves, each a list of tasks, and W is the largest length. Turn `settings.cpu`/`settings.memory` into the cap the formula is clamped by (an explicit `--cpu`/`--memory` still wins outright, M2) and keep every refusal. Write the chosen `width` (W) into the launch arguments the launcher already passes to the sandbox (the assignment `--comment` and the launch args file `run-main` reads) so `fleet/run-main.mjs:80 export const WIDTH = 12` becomes `export const widthOf = (args) => …` (a positive integer `args.width`, else 12) used at the `boundedParallel` call (~880) and the `width bound` log line (~866); the fallback keeps a re-drive of an older assignment booting. `fleet/RUNBOOK.md:78–86` (inside `## One-time setup`) documents `cpu`/`memory` as the size every run gets and the defaults — rewrite that paragraph for the ceiling, using the word ceiling; `fleet/CONTRACT.md`'s `new` verb line (the literal with `--cpu <cpu> --memory <memory>`) stays true and needs one sentence saying where the numbers come from. Round `ceil(W / 3)` in integers; `memory` is spelled `<int>GB` as the lobby takes it. The exam drives `launch` against the fake lobby in `fleet/tests/_lobby_helpers.mjs` (the rig the deleted launch sims used, still present) with a compile stub answering one-task and ten-task `launch_waves`, and reads the `new` argv the fake recorded.

**Proof:**
- Test: `fleet/tests/test_launch_size.mjs`
- Guard: `fleet/tests/test_launch_size.mjs`
- Run: node fleet/launch.mjs --help 2>&1 | grep -q -- '--cpu <n>' && node fleet/launch.mjs --help 2>&1 | grep -q -- '--memory <n>GB'
- Run: test "$(grep -c 'WIDTH = 12' fleet/run-main.mjs)" = 0 && grep -q 'boundedParallel(widthOf(' fleet/run-main.mjs
- Run: sed -n '/^## One-time setup/,/^## Per run/p' fleet/RUNBOOK.md | tr '\n' ' ' | grep -q -i 'ceiling'
- Legs: (a) under the fake lobby with caps `6`/`8GB`, a one-task compile stub yields a `new` argv carrying `--cpu 3 --memory 3GB` and a ten-task stub `--cpu 6 --memory 8GB`, and with no `fleet.json` the caps are `FLEET_DEFAULTS` [M1]; (b) `--cpu 2` on the launch line yields `--cpu 2` whatever the stub answers, and a value above the fake billing plan's `max_cpus` is refused with the same message as at BASE [M2]; (c) the fake exec records exactly one `compile_plan.py --stamp` invocation per launch, ordered before the `new` verb [M3]; (d) the launch arguments the fake sandbox receives carry `width` equal to the widest wave; `widthOf` imported from `../run-main.mjs` answers 4 for `{ width: 4 }`, 12 for `{}` and 12 for `{ width: 0 }`; and the call site `boundedParallel(widthOf(` is present while `WIDTH = 12` is absent, by grep [M4]; (e) `--help` still names both flags and the RUNBOOK's one-time-setup section says ceiling [M5].

**Stale-if:**
- path-absent: `fleet/tests/_lobby_helpers.mjs`
- path-absent: `fleet/lobby.mjs`

### Task 4: The overlap knob is gone from the boot chain

**Type:** implementation

**Files:**
- Modify: `fleet/sandbox-boot.sh`
- Modify: `fleet/lobby.mjs`
- Modify: `fleet/CONTRACT.md`
- Modify: `fleet/RUNBOOK.md`

**Claim:** After this run no script directly under `fleet/` reads or passes an overlap knob, and the contract and runbook no longer list `overlap=` as a comment key or `--overlap` as an engine flag. (derived)
Machine: M1. `fleet/sandbox-boot.sh` contains neither the string `overlap` nor `OVERLAP`. M2. `fleet/CONTRACT.md` and `fleet/RUNBOOK.md` contain neither `--overlap` nor `overlap=`. M3. `bash -n fleet/sandbox-boot.sh` exits 0, and the survivor sim `fleet/tests/test_sandbox_boot_viz.mjs`, which drives the boot script, prints `ALL TESTS PASSED`. M4. Across `fleet/*.sh` and `fleet/*.mjs` (not their subdirectories), a case-insensitive search for `overlap` matches exactly one file, `fleet/run-engine.mjs`, and exactly one line in it — the fold comment reading `which is precisely the overlap nobody planned for`, which names no knob.

**Authorized-by:** run-126's integration finding (2026-09-14): Task 2 of the deletion plan removed `--overlap` from the launcher, the driver and the compiler, but the boot script it froze still reads `overlap=` from the assignment comment and passes `--overlap` to an engine that now refuses unknown flags.

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** At BASE `fleet/sandbox-boot.sh:190` declares `OVERLAP=""`, `:670` reads `overlap) OVERLAP="$val" ;;` from the comment, `:682` validates `''|fold|serialize`, `:697` logs `overlap=${OVERLAP:-}` in the assignment line, and `:1161` appends `--overlap "$OVERLAP"` to the engine's argv when set — delete all five (the log line keeps its other fields). `fleet/lobby.mjs:486` lists `'overlap'` in the assignment comment's key order and `:491` is the comment naming `overlap=` among the optional keys — remove both; the launcher writes no such key since run-126. `fleet/run-engine.mjs:537` says `the overlap nobody planned for` in a comment about the fold — it names no knob and stays, and M4 pins it as the one remaining match. `fleet/CONTRACT.md:137` lists `overlap=fold|serialize` among the legal comment keys and `:309` shows `[--overlap …]` in the `run-main.mjs` argv it specifies; `fleet/RUNBOOK.md:223` says `--overlap` rides the comment to the engine — remove each. The launcher on main already writes no `overlap=` key (the deletion plan's Task 2), so nothing feeds these lines today; they are the pair that kills a run when an older installed launcher meets this engine. Touch nothing else in the boot script: a Global Constraint pins every changed line to the word.

**Proof:**
- Run: test "$(grep -c -i overlap fleet/sandbox-boot.sh)" = 0
- Run: test "$(grep -c -e '--overlap' -e 'overlap=' fleet/CONTRACT.md fleet/RUNBOOK.md | awk -F: '{s+=$2} END {print s}')" = 0
- Run: bash -n fleet/sandbox-boot.sh
- Run: node fleet/tests/test_sandbox_boot_viz.mjs | grep -q 'ALL TESTS PASSED'
- Run: test "$(grep -il overlap fleet/*.sh fleet/*.mjs | tr '\n' ' ')" = 'fleet/run-engine.mjs ' && test "$(grep -ic overlap fleet/run-engine.mjs)" = 1 && grep -i overlap fleet/run-engine.mjs | grep -q 'nobody planned for'
- Legs: (a) the case-insensitive count of `overlap` in the boot script is zero [M1]; (b) the summed count of the two spellings across the contract and the runbook is zero [M2]; (c) the script parses and the boot sim prints its sentinel [M3]; (d) the case-insensitive search over the non-recursive glob names exactly `fleet/run-engine.mjs`, whose single match is the fold comment [M4].

**Stale-if:**
- path-absent: `fleet/tests/test_sandbox_boot_viz.mjs`
