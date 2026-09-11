# The mechanical referee is deleted whole — the reviewers own the footprint and the interfaces again

**Grammar:** claims-v1

**Claim:** do: launch a run on the merged engine and read its report. see: no task is failed or sent to a fix round by the driver's own arithmetic over the patch — the reviewers find footprint and interface issues themselves, every `peer` task buys both reviewers — and the run's record carries no `referee/` directory. (elicited)
**Summary:** The mechanical referee (#729, 0.3.23) is deleted whole, on the reading of runs 70–102: 80 findings, none escalated by a reviewer, three `referee-red` tasks all false positives, and none of the reviewers' 14 blocking findings inside the referee's six checks. After this run the engine's pre-review pass is the `Run:`/`Check:`/exam pass it was before #729, the reviewer role carries its pre-#729 footprint and interface duties, the report no longer counts referee findings, and `fleet/referee.mjs`, its linker, their sims, their 133 fixture files and the record's `referee/` copy are gone. The old shape stays in git as the rollback.

**Goal:** Delete the mechanical referee behind its measurement (#911; the reading of runs 70–102: 80 findings, 0 escalated, 3 `referee-red` all false, 14 reviewer blocking findings none overlapping; CLAUDE.md §Wayfinding "deletion is owed per guard", §Doctrine "no small measures while broken"). Everything #729 added is removed — `fleet/referee.mjs`, `fleet/referee-linker.mjs`, the engine's `runReferee`/`absorbReferee`/`refereeBlock`/`REFEREE:` block/`referee-red` verdict/pair-skip rule/`reviewEconomy` referee tallies, #910's `examLanding` hand-off, the `<runDir>/referee/` record and its evidence copy, the reviewer role's REFEREE paragraph, the report-format rows, the CONTRACT line, the three referee sims, the referee parts of eight engine sims, and the fixtures — and the reviewer's own footprint and interface duties, which #729 removed from `fleet/roles/reviewer.md`, are restored. What stays: `proofFixes` and the `proof-red` verdict (both predate #729, #713), the exam handoff and `exam-paths.mjs`, the gate's deliverables check, and every use of the word "referee" for the *reviewer* in the peer-review register (#556: `fleet/roles/README.md`, `fix.md`, `critic.md`, `reviewer.md` line 1, `audit_run.py`'s sentinel, `tests/test_roles_run_evidence.py`, `skills/ultrawrite/SKILL.md`, `authoring-gotchas.md`, and the engine's own comments about reviewers). Another plan in flight (`2026-09-11-kata-prototype-913.md`) also edits `fleet/run-engine.mjs` and `fleet/sandbox-boot.sh`; that text folds, and that plan must not consume any referee symbol — none of `referee`, `linkProduces`, `refereeBlock`, `examLanding` is available after this run.
**Closes:** #911 #861

**Tech Stack:** Node 24 ESM (`fleet/run-engine.mjs`, sims under `fleet/tests/` driven through `fleet/tests/_engine_helpers.mjs`), bash (`fleet/sandbox-boot.sh`), Markdown (`fleet/roles/reviewer.md`, `fleet/CONTRACT.md`, `skills/ultrapowers/references/report-format.md`); the sims join the suite through `tests/test_fleet_suite.py`.

**Spec:** #911 and the reading of runs 70–102 (operator decision 2026-09-11); every fact a worker needs is in its task's Context.

**Parallelization rationale:** one wave, three wide. Task 1 is the engine seam — the importer of the two modules deletes them with the import, restores the reviewer's duties, rewrites the report-format rows that document the engine's fields, and edits the eight engine sims whose pins the engine change would otherwise turn red (a sim edit rides with the change that reds it). Task 2 is the replay sim's 133 fixture files plus the hermetic probe's one leg that names the linker sim — nothing in it imports the engine, and nothing in task 1 reads it. Task 3 is the record: the CONTRACT line and the boot script's evidence copy. No task consumes a symbol of another; the only cross-task fact is a shared literal (the referee vocabulary the Global Check sweeps), carried in every Context. No chain.

## Global Constraints

- After the run, the fleet, the skills and the tests carry no trace of the mechanical referee — the module names, the `REFEREE:` prompt block, the engine symbols, the `referee-red` verdict, the `reviewEconomy` referee keys, the `referee/task-` record and the fixture directory — while every use of "referee" for the reviewer in the peer-review register (#556) stays exactly as it is.
- Check: ! grep -rnE 'referee\.mjs|referee-linker|REFEREE:|refereeBlock|runReferee|absorbReferee|referee-red|refereeFindings|refereeBlocking|refereeSkippedPairs|refereeMinors|refereeResult|refereeRepairedPair|refereeLinker|mechanical referee|driver.s referee|driver.s own arithmetic|referee/task-|fixtures/referee|examLanding' fleet skills tests --exclude-dir=node_modules --exclude-dir=exams (minor)
- Check: bash -n fleet/sandbox-boot.sh

**Acceptance:** suite — the committed suite plus per-task review is the verification.

### Task 1: The engine's pre-review pass is the proof pass again, and the reviewer owns the footprint and the interfaces

**Type:** implementation
**Review:** peer

**Files:**
- Delete: `fleet/referee.mjs`
- Delete: `fleet/referee-linker.mjs`
- Delete: `fleet/tests/test_run_engine_referee.mjs`
- Delete: `fleet/tests/test_referee_replay.mjs`
- Delete: `fleet/tests/test_referee_linker.mjs`
- Modify: `fleet/run-engine.mjs`
- Modify: `fleet/roles/reviewer.md`
- Modify: `skills/ultrapowers/references/report-format.md`
- Modify: `fleet/tests/test_run_engine_review_pair.mjs`
- Modify: `fleet/tests/test_run_engine_review_economy.mjs`
- Modify: `fleet/tests/test_run_engine_pre_review.mjs`
- Modify: `fleet/tests/test_run_engine_state_exams.mjs`
- Modify: `fleet/tests/test_run_engine_proof_runs.mjs`
- Modify: `fleet/tests/test_run_engine_integrated_runs.mjs`
- Modify: `fleet/tests/test_run_record_keys.mjs`
- Modify: `fleet/tests/test_run_engine_exam_edits.mjs`
- Test: `fleet/tests/test_run_engine_reviewer_prompt.mjs`

**Claim:** A task whose patch strays outside its FILES is not sent to a fix round by the driver: it goes straight to review, a `peer` task always gets both reviewers, and the reviewer is told — as it was before #729 — that the footprint and the interfaces are its own duties. (derived)
Machine: M1. `fleet/referee.mjs`, `fleet/referee-linker.mjs`, `fleet/tests/test_run_engine_referee.mjs`, `fleet/tests/test_referee_replay.mjs` and `fleet/tests/test_referee_linker.mjs` are absent, and `fleet/run-engine.mjs` contains none of the strings `referee.mjs`, `referee-linker`, `REFEREE:`, `refereeBlock`, `runReferee`, `absorbReferee`, `referee-red`, `refereeFindings`, `refereeBlocking`, `refereeSkippedPairs`, `examLanding`. M2. A run through the engine rig whose `peer` task `T1` has no `proofRuns`, no `constraintChecks` and no `proofTests`, and whose implementer writes both `T1.txt` and its wave sibling's `T2.txt`, dispatches no label starting `fix:`, dispatches exactly `review:T1:1:1` and `review:T1:1:2` for `T1`, merges `T1` with `status` `done` and `proofFixes` `0`, leaves no `<runDir>/referee` directory, and no prompt it dispatched contains the substring `REFEREE:`. M3. That run's report carries a `reviewEconomy` object whose sorted keys are exactly `blockingFindings`, `blockingPerReviewerMinute`, `pairRounds`, `r2MarginalBlocking`, `reviewerMs`. M4. A `peer` task with one `proofRuns` command that exits non-zero on the tree the implementer left and zero on the tree the `fix:<id>:0` round left buys exactly one `fix:<id>:0` round, then dispatches both `review:<id>:1:1` and `review:<id>:1:2`, and merges with `proofFixes` `1`. M5. `fleet/roles/reviewer.md` numbers its duties `1.` through `8.` with no gap; its duty 3 carries, in this order, `FILES is the expected footprint`, `minor`, `deleting a file present at BASE`, `blocking`, `SIBLING FILES`, `missing dependency edge`; its duty 4 carries, in this order, `GLOBAL CONSTRAINT`, `INTERFACES`, `Produces`, `Consumes`; and no line of the file begins with `REFEREE`. M6. `skills/ultrapowers/references/report-format.md` contains no occurrence of `referee` in any letter case, its `reviewEconomy` schema block names exactly the five properties of M3, and `python3 -m pytest tests/test_report_runbook.py -q` exits 0. M7. For each of `test_run_engine_review_pair.mjs`, `test_run_engine_review_economy.mjs`, `test_run_engine_pre_review.mjs`, `test_run_engine_state_exams.mjs`, `test_run_engine_proof_runs.mjs`, `test_run_engine_integrated_runs.mjs`, `test_run_record_keys.mjs`, `test_run_engine_exam_edits.mjs`, `test_roles_peer.mjs`: `node fleet/tests/<sim>` prints `ALL TESTS PASSED`; and `python3 -m pytest tests/test_roles_run_evidence.py -q` exits 0.

**Authorized-by:** #911; the reading of runs 70–102 (operator decision 2026-09-11: the mechanical referee is deleted whole); CLAUDE.md §Wayfinding "deletion is owed per guard"

**Interfaces:**
- Consumes: none
- Produces: `reviewEconomy: { reviewerMs, blockingFindings, blockingPerReviewerMinute, pairRounds, r2MarginalBlocking }`

**Context:** Read at BASE `e99ff63c` (2026-09-11). Every seam is #729's (`git show a5266417`), plus #910's `examLanding` hand-off (`00a43119`). In `fleet/run-engine.mjs`: the two imports (`import { referee } from './referee.mjs'`, `import { linkProduces } from './referee-linker.mjs'`) and the comment block above them; the exported `refereeBlock` renderer and its comment; the comment above `stateExamBlock` that calls it "the `REFEREE:` pattern of #729" (reword: a driver block appended to the reviewer prompt, per task, never a role-file edit); the `refereeFindings`/`refereeBlocking`/`refereeSkippedPairs` counters and the `refereeLinker`/`linkerFn` closure over `args.linker` (that seam is dead once the linker is gone — `run-main.mjs` and `_engine_helpers.mjs` never set it; remove it); inside `runTaskInner`, the `refereeResult`/`refereeRepairedPair` state, `runReferee`, `absorbReferee`, `refereeMinors`, the tail of `prePass` that calls `runReferee` and pushes `{ …, referee: true }` reds, the `refereeRepairedPair = reds.some(...)` line, the `proof-red`/`referee-red` verdict choice (the verdict after a second red pass is `proof-red`, unconditionally, as it was at `a5266417^`), the `iter === 2` re-grade block that returns `fix-loop-exhausted` on a referee finding, `refereeBlock(refereeResult)` in the review prompt, the `pairThisRound` rule (a pair task's round is always a pair: `isPairReview(taskReviewProfile(task))`), the `else` branch's `refereeSkippedPairs += 1`, `refereeMinors()` in the minors loop, and the three keys in the report's `reviewEconomy`. `proofFixes` and its `= 1` assignment predate #729 (#713) and stay: it still means "the pre-review pass was red once and bought a round" — for a `Run:`, `Check:` or exam. The `siblingFiles` argument threaded from `siblingFilesOf(task, WAVES[w])` through `runTask` into `runTaskInner` had the referee as its only reader; remove the parameter and `siblingFilesOf` (the `siblingLine` string the prompts carry is a different function and stays). The exam handoff's `landingOf` and `proofTests` stay — only the `examLanding:` option to the referee goes. Engine comments that say "referee" for the *reviewer* (the #551/#556 register: "the run spends most of its wall clock in referees", "charging them to the referee flatters the ratio", "the referee's attention" in `checkEvidenceBlock`, whose string `test_run_engine_pre_review.mjs` pins verbatim) are not the mechanical referee and stay. `fleet/roles/reviewer.md`: delete the paragraph beginning `REFEREE, when present` and restore the two duties #729 cut, so the list reads 1–8 without the gap it has at BASE (2, then 4). Duty 3 at `a5266417^` read: "FILES is the expected footprint, not a fence: modifying a path outside it is minor, naming that path; deleting a file present at BASE but absent from FILES is blocking. So is touching a SIBLING FILES path, or a criterion unsatisfiable only because a sibling-owned file is absent at BASE — name it and "missing dependency edge"." Restore it with one repair for #911 finding 1 — a `Delete:` bullet in the task body's Files block is a declared deletion, so write "deleting a file present at BASE that the task's Files block does not declare with a `Delete:` bullet is blocking" (the FILES line the driver renders is creates ∪ modifies ∪ reads, so the reviewer reads the declaration in the task body, not in FILES). Duty 4 at `a5266417^` read: "Gate the diff against each GLOBAL CONSTRAINT given, and against INTERFACES: the diff produces the named Produces contract with its stated types and uses each Consumes symbol as named." — restore it verbatim. `fleet/tests/test_roles_peer.mjs` and `tests/test_roles_run_evidence.py` pin reviewer.md by expression (`plan-defect:`…`blocking`…`FILES`, `red-then-green`, `unverified:`, "fix loop's, not the referee") — all survive. `skills/ultrapowers/references/report-format.md`: the `reviewEconomy` schema block (drop the three `referee*` properties), the `tasks[].reviewVerdict` row (drop the `referee-red` entry), the `tasks[].proofFixes` row (`1` when a red command bought the round; a second red pass ends the task at `proof-red`), the `reviewEconomy` row (drop the last three sentences), and the `deferredVerification` row's `plan-defect` entry ("a per-task reviewer returned a blocking issue whose actor is the plan"). `tests/test_report_runbook.py` reads `reviewVerdict` literals off the engine and requires each to be documented — `referee-red` is minted through a variable at BASE, so it is not one of them either way. The sims, each with what turns red and what to do: `test_run_engine_review_pair.mjs` — delete section 5 ("the pair rule: the referee buys the second reviewer back", `pairWave`/`pairRun` and both blocks) and the header's third bullet; `test_run_engine_review_economy.mjs` — `ECONOMY_KEYS` becomes the five sorted keys and the "eight fields" message five, and the `REFEREE_MARK`/`withoutReferee` machinery goes: `BASE_SHA` there is `2cc873fb` (0.3.11, before #729), so BASE's prompts never carried the block and the live ones no longer do — compare the prompts directly; `test_run_engine_pre_review.mjs` — leg (b) slices the prompt at `'\n\nREFEREE:'` before `endsWith(checkEvidenceBlock(...))`; with no block the prompt itself ends with that renderer's output (`stateExamBlock` renders `''` for a task with no state-exam rows), so assert on `rp` and drop the slice and the comment; `test_run_engine_state_exams.mjs` — drop `'REFEREE:'` from `HEADERS` and reword the header comment that says the prompt's last block is `REFEREE:`; `test_run_engine_proof_runs.mjs` and `test_run_engine_integrated_runs.mjs` — their `cut` helpers and comments go the same way as review_economy's (their `BASE_SHA`s are `0a3559a2` and `0e5ccfa8`, both before #729); `test_run_record_keys.mjs` — M4's list loses `fleet/referee.mjs` (leg (d) iterates `['referee.mjs', 'CONTRACT.md', 'failing-block.mjs']` and asserts each exists; drop the first, and the two header lines that name it); `test_run_engine_exam_edits.mjs` — the comment above `isExamEdit` ("since #729 the referee names a Proof `Test:` path of its own") is stale; reword it, the filter itself stays. `fleet/tests/test_run_engine_referee.mjs` imports `refereeBlock` from the engine, `fleet/tests/test_referee_replay.mjs` imports `../referee.mjs` and `fleet/tests/test_referee_linker.mjs` imports `../referee-linker.mjs` — the sims of a deleted module go with the module, so all three are this task's deletions. The exam: an engine sim through `fleet/tests/_engine_helpers.mjs` (`makeRepo`, `rig`, `doneImpl`, `passReview`, `cleanCritic`; `rig({ repo, runDir, waves, stub, stamp })` returns `{ run }` and `run()` resolves the report; the stub is `(prompt, opts, cwd)` and `opts.label` is `impl:<id>`, `fix:<id>:<n>`, `review:<id>:<round>[:<pass>]`, `integration`; a wave task is `{ id, title, files, tier: 'standard', review: 'peer', writes, commutes: [], body, proofRuns?: [...] }`; `makeRepo` seeds `a.txt`) — the shape `test_run_engine_review_pair.mjs` section 5 drives at BASE, read for the opposite outcome. It is unguarded, so it lands at `fleet/tests/exams/<slug>/` and its relative imports are written for that depth (`../../_engine_helpers.mjs`, `../../../run-engine.mjs`). For M4 the `Run:` command can be `test -e fixed.txt` with the fix stub writing that file. `fleet/tests/fixtures/referee/` (the replay sim's 133 fixture files) and `fleet/tests/test_sims_are_hermetic.mjs` (whose leg (e) asserts `test_referee_linker.mjs` exists) are a sibling task's — do not touch them; in this task's clone the fixtures are orphaned and that hermetic leg is red, and both are settled in the fold, where the sibling's edits land in the same wave.

**Proof:**
- Test: `fleet/tests/test_run_engine_reviewer_prompt.mjs`
- Legs: (a) the five `test ! -e` `Run:` lines below fail while any of the five files exists, and the negated `grep -E` line fails naming the surviving string [M1]; (b) the exam drives the two-task `peer` wave in which `impl:T1` writes `T1.txt` and `T2.txt`: no label starts `fix:`, the `review:T1` labels are exactly `['review:T1:1:1', 'review:T1:1:2']`, `T1`'s row is `status: 'done'` with `proofFixes: 0`, `fs.existsSync(path.join(runDir, 'referee'))` is false, and every captured prompt fails `includes('REFEREE:')` [M2]; (c) `Object.keys(report.reviewEconomy).sort()` deep-equals the five names, so a sixth key or a missing one fails [M3]; (d) the exam drives a `peer` task with `proofRuns: ['test -e fixed.txt']` whose `fix:T1:0` stub writes `fixed.txt`: the labels contain `fix:T1:0` exactly once, then both `review:T1:1:1` and `review:T1:1:2`, and the row is `done` with `proofFixes: 1` [M4]; (e) the reviewer.md `Run:` lines below: the numbering line compares the concatenated duty numbers to `12345678`, the two sed-scoped lines pin the operative words of duties 3 and 4 in order, and the negated grep fails on any surviving `REFEREE` line [M5]; (f) the report-format `Run:` lines: the case-insensitive count is zero, the two sed-scoped `reviewEconomy` schema-block lines pin the five property names in order and count exactly five `"<name>": {"type"` entries (eight at BASE), and the pytest line runs `test_report_runbook.py` [M6]; (g) one `Run:` line per sim, each piped into the sentinel grep, and the pytest line for `test_roles_run_evidence.py` [M7].
- Run: test ! -e fleet/referee.mjs
- Run: test ! -e fleet/referee-linker.mjs
- Run: test ! -e fleet/tests/test_run_engine_referee.mjs
- Run: test ! -e fleet/tests/test_referee_replay.mjs
- Run: test ! -e fleet/tests/test_referee_linker.mjs
- Run: ! grep -nE 'referee\.mjs|referee-linker|REFEREE:|refereeBlock|runReferee|absorbReferee|referee-red|refereeFindings|refereeBlocking|refereeSkippedPairs|examLanding' fleet/run-engine.mjs
- Run: test "$(grep -oE '^[0-9]+\. ' fleet/roles/reviewer.md | tr -d '. \n')" = 12345678
- Run: sed -n '/^3\. /,/^4\. /p' fleet/roles/reviewer.md | tr '\n' ' ' | grep -q 'FILES is the expected footprint.*minor.*deleting a file present at BASE.*blocking.*SIBLING FILES.*missing dependency edge'
- Run: sed -n '/^4\. /,/^5\. /p' fleet/roles/reviewer.md | tr '\n' ' ' | grep -q 'GLOBAL CONSTRAINT.*INTERFACES.*Produces.*Consumes'
- Run: ! grep -n '^REFEREE' fleet/roles/reviewer.md
- Run: test "$(grep -ci referee skills/ultrapowers/references/report-format.md)" = 0
- Run: sed -n '/"reviewEconomy": { "type": "object"/,/} },/p' skills/ultrapowers/references/report-format.md | tr '\n' ' ' | grep -q 'reviewerMs.*blockingFindings.*blockingPerReviewerMinute.*pairRounds.*r2MarginalBlocking'
- Run: test "$(sed -n '/"reviewEconomy": { "type": "object"/,/} },/p' skills/ultrapowers/references/report-format.md | grep -o '"[a-zA-Z0-9]*": {"type"' | wc -l)" -eq 5
- Run: python3 -m pytest tests/test_report_runbook.py -q
- Run: node fleet/tests/test_run_engine_review_pair.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_run_engine_review_economy.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_run_engine_pre_review.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_run_engine_state_exams.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_run_engine_proof_runs.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_run_engine_integrated_runs.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_run_record_keys.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_run_engine_exam_edits.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_roles_peer.mjs | grep -q 'ALL TESTS PASSED'
- Run: python3 -m pytest tests/test_roles_run_evidence.py -q

**Stale-if:**
- path-absent: `fleet/referee.mjs`
- path-absent: `fleet/tests/test_run_engine_referee.mjs`

### Task 2: The referee's fixtures are gone, the hermetic probe stops looking for the linker sim, and the suite still collects

**Type:** implementation
**Review:** lean

**Files:**
- Delete: `fleet/tests/fixtures/referee/clean-1/base/src/z.ts`
- Delete: `fleet/tests/fixtures/referee/clean-1/base/tests/z.test.ts`
- Delete: `fleet/tests/fixtures/referee/clean-1/expected.json`
- Delete: `fleet/tests/fixtures/referee/clean-1/patch.diff`
- Delete: `fleet/tests/fixtures/referee/clean-1/task.json`
- Delete: `fleet/tests/fixtures/referee/clean-2/base/docs/a.md`
- Delete: `fleet/tests/fixtures/referee/clean-2/expected.json`
- Delete: `fleet/tests/fixtures/referee/clean-2/patch.diff`
- Delete: `fleet/tests/fixtures/referee/clean-2/task.json`
- Delete: `fleet/tests/fixtures/referee/deps-1/base/package.json`
- Delete: `fleet/tests/fixtures/referee/deps-1/base/src/a.ts`
- Delete: `fleet/tests/fixtures/referee/deps-1/expected.json`
- Delete: `fleet/tests/fixtures/referee/deps-1/patch.diff`
- Delete: `fleet/tests/fixtures/referee/deps-1/task.json`
- Delete: `fleet/tests/fixtures/referee/exam-1/base/src/x.ts`
- Delete: `fleet/tests/fixtures/referee/exam-1/expected.json`
- Delete: `fleet/tests/fixtures/referee/exam-1/patch.diff`
- Delete: `fleet/tests/fixtures/referee/exam-1/task.json`
- Delete: `fleet/tests/fixtures/referee/exam-2/base/src/x.ts`
- Delete: `fleet/tests/fixtures/referee/exam-2/expected.json`
- Delete: `fleet/tests/fixtures/referee/exam-2/patch.diff`
- Delete: `fleet/tests/fixtures/referee/exam-2/task.json`
- Delete: `fleet/tests/fixtures/referee/exam-3/base/src/x.ts`
- Delete: `fleet/tests/fixtures/referee/exam-3/expected.json`
- Delete: `fleet/tests/fixtures/referee/exam-3/patch.diff`
- Delete: `fleet/tests/fixtures/referee/exam-3/task.json`
- Delete: `fleet/tests/fixtures/referee/exam-4/base/src/x.ts`
- Delete: `fleet/tests/fixtures/referee/exam-4/expected.json`
- Delete: `fleet/tests/fixtures/referee/exam-4/patch.diff`
- Delete: `fleet/tests/fixtures/referee/exam-4/task.json`
- Delete: `fleet/tests/fixtures/referee/footprint-1/base/README.md`
- Delete: `fleet/tests/fixtures/referee/footprint-1/base/src/snake.ts`
- Delete: `fleet/tests/fixtures/referee/footprint-1/base/tests/snake.test.ts`
- Delete: `fleet/tests/fixtures/referee/footprint-1/expected.json`
- Delete: `fleet/tests/fixtures/referee/footprint-1/patch.diff`
- Delete: `fleet/tests/fixtures/referee/footprint-1/task.json`
- Delete: `fleet/tests/fixtures/referee/footprint-2/base/fleet/run-engine.mjs`
- Delete: `fleet/tests/fixtures/referee/footprint-2/base/fleet/tests/test_run_engine_exam_fix_edit.mjs`
- Delete: `fleet/tests/fixtures/referee/footprint-2/expected.json`
- Delete: `fleet/tests/fixtures/referee/footprint-2/patch.diff`
- Delete: `fleet/tests/fixtures/referee/footprint-2/task.json`
- Delete: `fleet/tests/fixtures/referee/footprint-3/base/skills/ultrapowers/scripts/compile_plan.py`
- Delete: `fleet/tests/fixtures/referee/footprint-3/base/tests/test_compile_plan_engine_self_change.py`
- Delete: `fleet/tests/fixtures/referee/footprint-3/expected.json`
- Delete: `fleet/tests/fixtures/referee/footprint-3/patch.diff`
- Delete: `fleet/tests/fixtures/referee/footprint-3/task.json`
- Delete: `fleet/tests/fixtures/referee/footprint-4/base/fleet/sandbox-boot.sh`
- Delete: `fleet/tests/fixtures/referee/footprint-4/base/fleet/tests/test_sandbox_boot_merge.mjs`
- Delete: `fleet/tests/fixtures/referee/footprint-4/expected.json`
- Delete: `fleet/tests/fixtures/referee/footprint-4/patch.diff`
- Delete: `fleet/tests/fixtures/referee/footprint-4/task.json`
- Delete: `fleet/tests/fixtures/referee/footprint-5/base/README.md`
- Delete: `fleet/tests/fixtures/referee/footprint-5/base/src/kebab.ts`
- Delete: `fleet/tests/fixtures/referee/footprint-5/base/tests/kebab.test.ts`
- Delete: `fleet/tests/fixtures/referee/footprint-5/expected.json`
- Delete: `fleet/tests/fixtures/referee/footprint-5/patch.diff`
- Delete: `fleet/tests/fixtures/referee/footprint-5/task.json`
- Delete: `fleet/tests/fixtures/referee/footprint-6/base/skills/ultrapowers/SKILL.md`
- Delete: `fleet/tests/fixtures/referee/footprint-6/base/skills/ultrapowers/references/first-run.md`
- Delete: `fleet/tests/fixtures/referee/footprint-6/expected.json`
- Delete: `fleet/tests/fixtures/referee/footprint-6/patch.diff`
- Delete: `fleet/tests/fixtures/referee/footprint-6/task.json`
- Delete: `fleet/tests/fixtures/referee/footprint-7/base/fleet/janitor.mjs`
- Delete: `fleet/tests/fixtures/referee/footprint-7/base/fleet/retire.mjs`
- Delete: `fleet/tests/fixtures/referee/footprint-7/expected.json`
- Delete: `fleet/tests/fixtures/referee/footprint-7/patch.diff`
- Delete: `fleet/tests/fixtures/referee/footprint-7/task.json`
- Delete: `fleet/tests/fixtures/referee/linker-mjs-1/base/src/foo.mjs`
- Delete: `fleet/tests/fixtures/referee/linker-mjs-1/expected.json`
- Delete: `fleet/tests/fixtures/referee/linker-mjs-1/patch.diff`
- Delete: `fleet/tests/fixtures/referee/linker-mjs-1/task.json`
- Delete: `fleet/tests/fixtures/referee/linker-mjs-2/base/src/foo.mjs`
- Delete: `fleet/tests/fixtures/referee/linker-mjs-2/expected.json`
- Delete: `fleet/tests/fixtures/referee/linker-mjs-2/patch.diff`
- Delete: `fleet/tests/fixtures/referee/linker-mjs-2/task.json`
- Delete: `fleet/tests/fixtures/referee/linker-mjs-3/base/src/foo.mjs`
- Delete: `fleet/tests/fixtures/referee/linker-mjs-3/expected.json`
- Delete: `fleet/tests/fixtures/referee/linker-mjs-3/patch.diff`
- Delete: `fleet/tests/fixtures/referee/linker-mjs-3/task.json`
- Delete: `fleet/tests/fixtures/referee/linker-mjs-4/base/src/boom.mjs`
- Delete: `fleet/tests/fixtures/referee/linker-mjs-4/expected.json`
- Delete: `fleet/tests/fixtures/referee/linker-mjs-4/patch.diff`
- Delete: `fleet/tests/fixtures/referee/linker-mjs-4/task.json`
- Delete: `fleet/tests/fixtures/referee/linker-py-1/base/pkg/mod.py`
- Delete: `fleet/tests/fixtures/referee/linker-py-1/expected.json`
- Delete: `fleet/tests/fixtures/referee/linker-py-1/patch.diff`
- Delete: `fleet/tests/fixtures/referee/linker-py-1/task.json`
- Delete: `fleet/tests/fixtures/referee/linker-py-2/base/pkg/mod.py`
- Delete: `fleet/tests/fixtures/referee/linker-py-2/expected.json`
- Delete: `fleet/tests/fixtures/referee/linker-py-2/patch.diff`
- Delete: `fleet/tests/fixtures/referee/linker-py-2/task.json`
- Delete: `fleet/tests/fixtures/referee/linker-py-3/base/pkg/mod.py`
- Delete: `fleet/tests/fixtures/referee/linker-py-3/expected.json`
- Delete: `fleet/tests/fixtures/referee/linker-py-3/patch.diff`
- Delete: `fleet/tests/fixtures/referee/linker-py-3/task.json`
- Delete: `fleet/tests/fixtures/referee/linker-ts-1/base/src/foo.ts`
- Delete: `fleet/tests/fixtures/referee/linker-ts-1/expected.json`
- Delete: `fleet/tests/fixtures/referee/linker-ts-1/patch.diff`
- Delete: `fleet/tests/fixtures/referee/linker-ts-1/task.json`
- Delete: `fleet/tests/fixtures/referee/linker-ts-2/base/src/foo.ts`
- Delete: `fleet/tests/fixtures/referee/linker-ts-2/expected.json`
- Delete: `fleet/tests/fixtures/referee/linker-ts-2/patch.diff`
- Delete: `fleet/tests/fixtures/referee/linker-ts-2/task.json`
- Delete: `fleet/tests/fixtures/referee/linker-ts-3/base/src/foo.ts`
- Delete: `fleet/tests/fixtures/referee/linker-ts-3/expected.json`
- Delete: `fleet/tests/fixtures/referee/linker-ts-3/patch.diff`
- Delete: `fleet/tests/fixtures/referee/linker-ts-3/task.json`
- Delete: `fleet/tests/fixtures/referee/linker-unlinked-1/base/fleet/run-engine.mjs`
- Delete: `fleet/tests/fixtures/referee/linker-unlinked-1/expected.json`
- Delete: `fleet/tests/fixtures/referee/linker-unlinked-1/patch.diff`
- Delete: `fleet/tests/fixtures/referee/linker-unlinked-1/task.json`
- Delete: `fleet/tests/fixtures/referee/linker-unlinked-2/base/fleet/sandbox-boot.sh`
- Delete: `fleet/tests/fixtures/referee/linker-unlinked-2/expected.json`
- Delete: `fleet/tests/fixtures/referee/linker-unlinked-2/patch.diff`
- Delete: `fleet/tests/fixtures/referee/linker-unlinked-2/task.json`
- Delete: `fleet/tests/fixtures/referee/secrets-1/base/src/config.ts`
- Delete: `fleet/tests/fixtures/referee/secrets-1/expected.json`
- Delete: `fleet/tests/fixtures/referee/secrets-1/patch.diff`
- Delete: `fleet/tests/fixtures/referee/secrets-1/task.json`
- Delete: `fleet/tests/fixtures/referee/secrets-2/base/tests/config.test.ts`
- Delete: `fleet/tests/fixtures/referee/secrets-2/expected.json`
- Delete: `fleet/tests/fixtures/referee/secrets-2/patch.diff`
- Delete: `fleet/tests/fixtures/referee/secrets-2/task.json`
- Delete: `fleet/tests/fixtures/referee/testcount-1/base/src/a.py`
- Delete: `fleet/tests/fixtures/referee/testcount-1/base/tests/test_a.py`
- Delete: `fleet/tests/fixtures/referee/testcount-1/expected.json`
- Delete: `fleet/tests/fixtures/referee/testcount-1/patch.diff`
- Delete: `fleet/tests/fixtures/referee/testcount-1/task.json`
- Delete: `fleet/tests/fixtures/referee/testcount-2/base/src/a.py`
- Delete: `fleet/tests/fixtures/referee/testcount-2/base/tests/test_a.py`
- Delete: `fleet/tests/fixtures/referee/testcount-2/expected.json`
- Delete: `fleet/tests/fixtures/referee/testcount-2/patch.diff`
- Delete: `fleet/tests/fixtures/referee/testcount-2/task.json`
- Modify: `fleet/tests/test_sims_are_hermetic.mjs`
- Test: `fleet/tests/test_sim_inventory.mjs`

**Claim:** The referee's thirty fixture directories are gone from the suite, the hermetic probe no longer looks for the linker sim, and the fleet bridge still collects. (derived)
Machine: M1. `git ls-files fleet/tests/fixtures/referee` prints nothing and `fleet/tests/fixtures/referee` is not a directory. M2. `fleet/tests/test_sims_are_hermetic.mjs` contains no occurrence of `test_referee_linker`, and `node fleet/tests/test_sims_are_hermetic.mjs` prints `ALL TESTS PASSED`. M3. `python3 -m pytest tests/test_fleet_suite_collection.py -q` exits 0.

**Authorized-by:** #911; the reading of runs 70–102 (operator decision 2026-09-11: the mechanical referee is deleted whole)

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** Read at BASE `e99ff63c` (2026-09-11). The 30 fixture directories under `fleet/tests/fixtures/referee/` (133 tracked files: `task.json`, `patch.diff`, `expected.json` and a `base/` tree per directory) are read by one sim only, `fleet/tests/test_referee_replay.mjs`, which a sibling task in this wave deletes together with `fleet/referee.mjs`, `fleet/referee-linker.mjs` and `fleet/tests/test_referee_linker.mjs`; in this task's clone those files still exist, which is why this task's `Run:` lines and exam name only what this task owns — the fixture tree and the hermetic probe. `fleet/tests/test_sims_are_hermetic.mjs` sweeps every `fleet/tests/test_*.mjs` (`SWEPT`, asserted `>= 50`; 92 at BASE, 87 after this wave) and carries one named test, `'test_referee_linker.mjs drops the pytest shell-out and keeps its source pins  [M4 / leg (e)]'`, that asserts the file exists — delete that test block (its leg (e) has no other row) and any comment naming it; the probe's own `(f)` leg and the directory sweep stay. `tests/test_fleet_suite.py`'s `SLOW_FIRST` names none of the deleted sims. `tests/test_fleet_suite_collection.py` is the bridge's collection exam; it runs the bridge on a tmp tree and on the tree at hand and takes about a minute. The exam is an inventory sim: run `git ls-files` (a sim's own git read is lawful — Amendment 10 binds models, not sims) and `fs.existsSync` and assert the absence of the fixture tree, then read the probe's text; it is unguarded, so it lands at `fleet/tests/exams/<slug>/` and resolves the repository root from `import.meta.url` at that depth (three levels above `fleet/tests/exams/<slug>/`).

**Proof:**
- Test: `fleet/tests/test_sim_inventory.mjs`
- Legs: (a) the exam asserts that `execFileSync('git', ['ls-files', 'fleet/tests/fixtures/referee'])` prints an empty string and that `existsSync('fleet/tests/fixtures/referee')` is false — one surviving tracked fixture file, or the directory itself, fails it, and the `ls-files` and `test ! -d` `Run:` lines below fail the same way [M1]; (b) the exam reads `test_sims_are_hermetic.mjs` and asserts `includes('test_referee_linker')` is false, and the sentinel `Run:` line pipes the probe into `grep -q` [M2]; (c) the pytest `Run:` line runs the collection exam, red if the bridge stops collecting [M3].
- Run: test "$(git ls-files fleet/tests/fixtures/referee | wc -l)" -eq 0
- Run: test ! -d fleet/tests/fixtures/referee
- Run: ! grep -n 'test_referee_linker' fleet/tests/test_sims_are_hermetic.mjs
- Run: node fleet/tests/test_sims_are_hermetic.mjs | grep -q 'ALL TESTS PASSED'
- Run: python3 -m pytest tests/test_fleet_suite_collection.py -q

**Stale-if:**
- path-absent: `fleet/tests/fixtures/referee/clean-1/task.json`
- path-absent: `fleet/tests/test_sims_are_hermetic.mjs`

### Task 3: The record carries no referee directory

**Type:** implementation
**Review:** lean

**Files:**
- Modify: `fleet/CONTRACT.md`
- Modify: `fleet/sandbox-boot.sh`
- Test: `fleet/tests/test_sandbox_boot_evidence_copy.mjs`

**Claim:** The evidence the sandbox commits for a run carries `transcripts/` and `state-exams/` as before and never a `referee/` directory — even when the run directory holds one — and the contract no longer promises one. (derived)
Machine: M1. `fleet/CONTRACT.md` contains no line with `referee/task-` or `driver's referee`, and its evidence list still carries, in order, `transcripts/<sessionId>.jsonl` and then `state-exams/`. M2. A boot through the sandbox-boot rig whose engine stub leaves `<run_dir>/transcripts/s1.jsonl`, `<run_dir>/state-exams/task-1/buy-milk-0/walls.json` and `<run_dir>/referee/task-1-0.json` behind exits 0 and leaves, under the evidence worktree's `.ultrapowers/runs/7/`, `transcripts/s1.jsonl` and `state-exams/task-1/buy-milk-0/walls.json` byte-equal to the run directory's, and no entry named `referee` at any depth. M3. `fleet/sandbox-boot.sh` contains no occurrence of `referee` in any letter case, `bash -n fleet/sandbox-boot.sh` exits 0, and `node fleet/tests/test_sandbox_boot_state_exams.mjs` prints `ALL TESTS PASSED`. M4. `python3 -m pytest tests/test_docs_agree_with_code.py -q` exits 0.

**Authorized-by:** #911; the reading of runs 70–102 (operator decision 2026-09-11: the mechanical referee is deleted whole); `fleet/CONTRACT.md` is the authority for every record literal

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** Read at BASE `e99ff63c` (2026-09-11). `fleet/CONTRACT.md` §Literals' evidence list has one item added by #729 (`git show a5266417 -- fleet/CONTRACT.md`): the item beginning "`referee/task-<id>-<n>.json` — one per patch the driver's referee graded" through "present when the engine wrote them." — delete exactly that item; the `transcripts/` item before it and the `state-exams/` item after it stay. `fleet/sandbox-boot.sh` `collect_evidence` has one block added by #729: the six comment lines beginning "# The driver's referee writes one file per graded patch" and the `if [ -d "$run_dir/referee" ]; then … fi` copy that follows — delete that block; the `transcripts/` copy above it and the state-exams walk below it stay, and nothing else in the function changes, so a `referee/` directory the engine might leave (none will, after this wave) is simply not collected. The exam is a boot sim in the shape of `fleet/tests/test_sandbox_boot_state_exams.mjs`: `makeHome()` from `_sandbox_boot_helpers.mjs` builds a home with PATH stubs; the engine is the `STUBS['systemd-run']` script, and that sim splices a snippet in front of its `ENGINE_EXIT` line (`exit ${STUB_ENGINE_CODE:-0}`) that writes files under `$run_dir` (the run directory the stub already resolves) when an env flag is set, then `bootAsync(ctx, ['boot'], env)` runs the boot to completion and the evidence worktree is `evidenceDir(ctx)` (`<home>/evidence`) with the run's record under `RUN_PATH` (`.ultrapowers/runs/7`); `runDir(ctx)` from the helpers is the run directory. Write the exam's snippet to plant the three files named in M2 (a `transcripts/s1.jsonl` line, the `state-exams/task-1/buy-milk-0/walls.json` bytes, and `referee/task-1-0.json` holding `{}`), boot once, and read the record back; the sim at BASE is the reference for the splice, `PRELUDE`, and the byte-equal comparison. `test_sandbox_boot_state_exams.mjs` (about 4 s) grades the state-exams walk and is the `Run:` that would catch a wrong cut; `test_sandbox_boot_residuals.mjs` reads the evidence copy too. `tests/test_docs_agree_with_code.py` reads CONTRACT for the unit, the engine directory, the VM name and the two-tags bullet — none of them in the deleted item. A sibling plan in flight also edits `fleet/sandbox-boot.sh` in a different region; text folds. The exam is unguarded, so it lands at `fleet/tests/exams/<slug>/` and imports `../../_sandbox_boot_helpers.mjs` at that depth.

**Proof:**
- Test: `fleet/tests/test_sandbox_boot_evidence_copy.mjs`
- Legs: (a) the two negated CONTRACT greps fail on any surviving line, and the sed-scoped line pins `transcripts/<sessionId>.jsonl` before `state-exams/` inside §Literals, the section that holds the evidence list [M1]; (b) the exam boots the planted run and asserts the boot's status is 0, that `<evidence>/.ultrapowers/runs/7/transcripts/s1.jsonl` and `.../state-exams/task-1/buy-milk-0/walls.json` exist and are byte-equal to the run directory's, that the planted `<run_dir>/referee/task-1-0.json` does exist (so a green leg is not two absences agreeing), and that a walk of `<evidence>/.ultrapowers/runs/7/` yields no entry whose path contains `referee` — a copy block that survives makes that entry appear and fails the leg [M2]; (c) the case-insensitive count is zero, `bash -n` parses the script, and the state-exams boot sim is piped into the sentinel grep [M3]; (d) the pytest line runs the four-document structural pin [M4].
- Run: ! grep -n 'referee/task-' fleet/CONTRACT.md
- Run: ! grep -n "driver's referee" fleet/CONTRACT.md
- Run: sed -n '/^## Literals/,/^## Rules/p' fleet/CONTRACT.md | tr '\n' ' ' | grep -q 'transcripts/<sessionId>.jsonl.*state-exams/'
- Run: test "$(grep -ci referee fleet/sandbox-boot.sh)" = 0
- Run: bash -n fleet/sandbox-boot.sh
- Run: node fleet/tests/test_sandbox_boot_state_exams.mjs | grep -q 'ALL TESTS PASSED'
- Run: python3 -m pytest tests/test_docs_agree_with_code.py -q

**Stale-if:**
- path-absent: `fleet/sandbox-boot.sh`
- path-absent: `fleet/referee.mjs`
