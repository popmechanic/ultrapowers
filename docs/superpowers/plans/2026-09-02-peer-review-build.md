# Peer review, built — the examiner, the collaborative referee, and four instruments (run-52)

**Grammar:** claims-v1

**Claim:** After this run, each task's test is written by a different worker before its
implementer starts, and I can see in the run report when an implementer touched its own
exam. (elicited)

**Goal:** Build map #551's machinery in one wide wave so run-53 can measure it against a
control arm: a wave-0 examiner worker writes each task's exam at BASE before its implementer
starts and the engine detects an edited exam (#553); the roles speak in the peer-review
register and referees return proposed patches the fix round receives (#556, both halves);
`Review: peer` enters the grammar (#556); the parallelism cap divides the machine among the
tasks that actually share the run-wide command (#547); the sandbox samples its own load into
the run dir (#549); a tool pins each task's BASE facts (#555); and the plan carries one
operator signature with task claims derived from it (#552). This plan is itself #554's first
measurement: its Machine clauses are numbered and every Proof leg cites the clause it
establishes, and the gate's rejection count is recorded against run-51's 24 dispatched / 11
rejected: **26 dispatched / 16 rejected over five rounds, none for an uncited clause** — every
rejection was a judgment species (a quantifier checked at one instance, relational content
checked by token presence, one register drift), which is what the mechanical closure leaves. This plan's header carries the #552 shape by hand (one elicited operator sentence);
the BASE compiler ignores the line, and Task 10 makes it parse.

**Tech Stack:** Node ESM in `fleet/` (no new npm dependencies; `fleet/package.json`
unchanged); Python 3 stdlib + pytest for the compiler, the ultrawrite scripts and the
`tests/` exams; the role files are markdown data.

**Spec:** map #551 (Peer Review) and its tickets #552, #553, #555, #556; #547; #549. Not in
this run: #545 (the remote oracle, parked behind the first sealed-exam incident), #546 (the
sizing flags exist; run-52 is driven with `--sandbox-cpu 16 --sandbox-memory 48GB`), #548
(concurrent plans), and #553's confine-hook read detector (item 2 of its design) — the blob
comparison Task 2 builds is the stronger detector (an edit is caught at capture, a read
is only a hint), so the read record is dropped rather than built twice.

**Parallelization rationale:** one wave, ten wide. Every task is its own contract with its
own exam; the compiler should derive no edge (no `Consumes:` names a sibling's `Produces:`
except none). Same-file text edits are left to fold: `fleet/run-engine.mjs` is touched by
Tasks 2, 5, 6 and 7 in four distinct regions (the wave-0 dispatch and result shape; the
reviewer schema and fix prompt; the review-profile lines; the cap width), and
`skills/ultrapowers/scripts/compile_plan.py` by Tasks 3, 6 and 10 (the wave-entry emit; the
Review marker; the header Claim). Shared literals are stated in each affected Context:
`proofTests` (Tasks 2, 3), the examiner reply shape (Tasks 1, 2), `proposedPatch` and the
`PROPOSED PATCH` block header (Tasks 4, 5), the `exam:` concerns prefix (Tasks 2, 4), `peer`
(Tasks 4, 6). No chain: no task needs a sibling's runtime behaviour, only its shape.

## Global Constraints

- The verification periphery stays frozen: `skills/ultrapowers/scripts/gate_check.py`,
  `ultra_gate.py`, `run_acceptance.sh` and `finalize_report.py` are byte-identical to BASE.
  `compile_plan.py --check` exit codes are unchanged; any new compiler line is either an
  `ADVISORY grammar: ` line or a `grammar: ` refusal on a shape that did not parse at BASE.
- `fleet/roles/*.md` contain no upper-case whole-word `NEVER`, `ALWAYS` or `MUST`, and no
  role file, skill file or reference file contains the word `adversarial` after this run
  except where a test pins the accepted-but-undocumented marker value.
- Every shape a sibling test already pins for the absent-flag or absent-key case stays
  byte-identical: a wave entry without `proofTests`, an issue without `proposedPatch`, a plan
  without a header Claim, a run whose every task carries its own `testCmd`, the
  `sandboxLogPullCommand` string, and the dispatch label sequence and report of every
  existing engine sim under `fleet/tests/test_run_engine*.mjs`.
- Every new `fleet/tests/test_*.mjs` runs with no network, no live ssh and no `gh`, finishes
  under the suite's 120 s per-file cap, and prints `ALL TESTS PASSED` only on a clean exit.
- Every new `tests/test_*.py` is offline and reads only committed files or fixtures it
  creates under a `tmp_path`.
- Models never run git (One Driver Amendment 10): blob recording, the red-at-BASE check and
  every other new git or shell step is driver `exec`, never a prompt instruction.
- No token value appears on argv or in any rendered PR body.

**Acceptance:** suite — the committed suite is the verification.

### Task 1: The examiner's role file

**Type:** implementation

**Files:**
- Create: `fleet/roles/examiner.md`
- Test: `fleet/tests/test_roles_examiner.mjs`

**Claim:** It writes the runnable exam (the Proof `Test:` file) that is red at BASE for the right reason, and reports a judgment call if a leg is unsatisfiable as written (quoted from #553)
Machine: M1. `fleet/roles/examiner.md` exists and contains, verbatim, the sentence `You are a peer writing this task's exam, not its implementation: the runnable test file(s) at the Proof \`Test:\` path(s), written against the Machine clauses and the Proof legs, and expected to fail at BASE for exactly one reason — the implementation does not exist yet.` M2. The file contains, verbatim, the sentence `A leg you cannot encode as written goes under \`unsatisfiable\` as \`{leg, why}\`; return \`BLOCKED\` only when no exam at all can be written.` M3. The file contains, verbatim, the reply shape `{status: DONE|BLOCKED, summary, startHead, unsatisfiable: [{leg, why}]}` and the sentence `Run \`git rev-parse HEAD\` first and report it verbatim as \`startHead\`.` M4. The file contains none of the words `NEVER`, `ALWAYS`, `MUST` (upper case, whole word), none of `adversarial`, and not the implementer.md sentence `Implement the minimum to make them pass`.
**Authorized-by:** #553 (map #551, item 1 of the design); #447

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** The role files are data read at dispatch by `loadRoles` (`fleet/run-engine.mjs:146-152` reads a fixed name list — a sibling task adds `examiner` to that list and dispatches the role; this task only writes the file and does not touch the engine). Sizes are reported, not gated (#496); `fleet/tests/test_run_engine.mjs:135-141` reads every file in `fleet/roles/` and refuses shouted imperatives, so the new file is covered by that pin automatically. Model the register on `fleet/roles/implementer.md` (inputs listed by name: TASK, BASE, TEST COMMAND, FILES, INTERFACES). The reply shape is a shared literal with the engine task: `{status: DONE|BLOCKED, summary, startHead, unsatisfiable: [{leg, why}]}`. The examiner runs in the task's own clone at BASE; the implementer later starts in that same clone with the exam already present, and the engine records the exam's blob shas so an implementer edit to it is detected — the role text may say the exam is the implementer's grading, not the implementer's to reshape.

**Proof:**
- Test: `fleet/tests/test_roles_examiner.mjs`
- Legs: (a) the file exists and its text contains the M1 sentence as an exact substring, and a copy of the text with the words `not its implementation` deleted fails that check (the substring test is live) [M1]; (b) the text contains the M2 sentence as an exact substring [M2]; (c) the text contains the literal `{status: DONE|BLOCKED, summary, startHead, unsatisfiable: [{leg, why}]}` exactly once and the M3 `startHead` sentence as an exact substring [M3]; (d) `/\b(NEVER|ALWAYS|MUST)\b/` does not match the text, `/adversarial/i` does not match the text, and the text does not contain `Implement the minimum to make them pass` [M4].
**Stale-if:**
- issue-closed: #553
- path-exists: `fleet/roles/examiner.md`

### Task 2: The engine dispatches a wave-0 examiner per task and detects an edited exam

**Type:** implementation
**Review:** adversarial

**Files:**
- Modify: `fleet/run-engine.mjs`
- Modify: `fleet/run-waves.mjs`
- Test: `fleet/tests/test_run_engine_examiner.mjs`

**Claim:** a fleet worker in its own clone at BASE with the task's Machine line, Proof legs, Files and Interfaces — and NOT the implementer's role (quoted from #553)
Machine: M1. For a wave entry whose `proofTests` is a non-empty array and whose `testCmd` is a non-null string, the engine dispatches, before that task's implementer, one worker labelled `exam:<id>` with `isolation: 'worktree'` (the task's own clone at BASE), a prompt of `roles.examiner` + `\nBASE: <sha>` + the TEST COMMAND, FILES, INTERFACES and TASK blocks the implementer receives, and schema `EXAMINER_SCHEMA` (`required: ['status', 'summary', 'startHead']`, `status` enum `['DONE', 'BLOCKED']`, `unsatisfiable` an array of objects requiring `leg` and `why`); `loadRoles` reads `examiner.md` alongside the six existing names and `defaultTaskIdOf('exam:T1')` is `'T1'`. M2. After the examiner returns `DONE`, the engine records, per `proofTests` path, the blob sha of that path in the clone (`git hash-object`, absent path recorded as `null`) and runs the task's `testCmd` in the clone: a non-zero exit records `exam: 'red'` on the task result, a zero exit records `exam: 'green-at-base'` plus a judgment call `task <id>: exam is green at BASE — it establishes nothing`. M3. Each `unsatisfiable` entry becomes a judgment call `task <id>: examiner: <leg> — <why>`; an examiner returning `BLOCKED` or `null` records `exam: 'blocked'` plus a judgment call and the task proceeds to its implementer without an exam. M4. After the implementer returns, and again after each fix round, any `proofTests` path whose blob sha in the clone differs from the recorded one makes the task result `{status: 'failed', reviewVerdict: 'exam-edited', exam: <as recorded>}` with a judgment call naming the path(s); no review is dispatched for it and its patch is not folded. M5. A wave entry with no `proofTests` key, an empty `proofTests`, or `testCmd` `null` dispatches no `exam:*` worker and records `exam: null`, and the dispatch label sequence, the exec sequence and the report of every existing engine sim (`fleet/tests/test_run_engine*.mjs`) are unchanged.

**Authorized-by:** #553 (map #551, items 1, 2 and 4 of the design); #447; One Driver Amendment 10 (models never run git — the blob recording and the red check are driver exec)

**Interfaces:**
- Consumes: none
- Produces: `EXAMINER_SCHEMA`

**Context:** The per-task chain is `runTaskInner` (`fleet/run-engine.mjs:536-698`): the implementer dispatch at `:560-563` builds `commonInputs` from `testCmdLine(task, workerTestCmd) + filesLine(task) + siblingsStr + globalConstraintsBlock + interfacesLine(task) + taskBodyBlock(task, wavesPath)`; the fix round is at `:674-680`; `stripUntrustedPatch` and `hasCoordinates` guard every isolated reply. `loadRoles` (`:146-152`) reads a fixed name list `['implementer', 'reviewer', 'fix', 'resolver', 'reconcile', 'critic']`; the sims pass `rolesDir` through `rig({ extraArgs })` in `fleet/tests/_engine_helpers.mjs:52-84`, so a sim that needs `examiner.md` points `rolesDir` at a temp directory holding all seven files — the real `fleet/roles/examiner.md` is a sibling task's and is not yours to write. `isolation: 'worktree'` routes to `<clonesDir>/task-<id>` via `makeCwdFor` and `defaultTaskIdOf` (`fleet/run-waves.mjs:113-137`; the regex is `/^(?:impl|fix):([^:]+)/` and gains `exam`); `withPatchCapture` (`:196-230`) then captures a patch for the exam label too — that is harmless (the implementer's later capture overwrites `task-<id>.patch` cumulatively, exam included), and the fold input is unchanged. Blob shas: `git hash-object <path>` in the clone via the engine's `exec` seam (`git` argv form, `:296-300`); use the driver's `sh(cmd, cwd)` (`:366`) for the red check, which resolves `{code, output}` and never rejects. `task.testCmd` is the per-task command (#515, `testCmdLine` at `:171-174`); `proofTests` is a new wave-entry key a sibling compiler task emits — a shared literal: `proofTests: string[]`, the Proof `Test:` paths in Proof order, `[]` when the Proof names none. The task result object shape is the one at `:653-662`; add `exam` to it in every return of `runTaskInner` (the values `'red'`, `'green-at-base'`, `'blocked'`, `null`). Judgment calls go through `judgmentCalls.push` as the surrounding code does. The report is assembled at `:1360-1420`; `report.tasks` carries the result objects verbatim, so `exam` rides without a report change. Sims: stub agents by label as `fleet/tests/test_run_engine.mjs:26-49` does; `doneImpl(cwd)` from `_engine_helpers.mjs:91` is the implementer's canned reply. The examiner's clone write is the stub writing the `proofTests` file; make the sim's `testCmd` a script that exits non-zero while the implementation file is absent and zero once present (`bash check.sh` in `makeRepo` is the pattern).

**Proof:**
- Test: `fleet/tests/test_run_engine_examiner.mjs`
- Legs: (a) a one-task wave whose entry carries `proofTests: ['t1_test.sh']` and `testCmd: 'bash t1_test.sh'` dispatches labels in the order `exam:T1`, `impl:T1`, `review:T1:1`, `integration`; the `exam:T1` dispatch has `opts.isolation === 'worktree'` and the stub's `cwd` for it equals `<clonesDir>/task-T1`; its prompt starts with the temp `examiner.md` text verbatim, does not contain `You are an implementer`, and the text after that role prefix equals, byte for byte, the text after the implementer role prefix in the `impl:T1` prompt (so the `BASE:`, `TEST COMMAND: bash t1_test.sh`, `FILES: `, `INTERFACES:` and `TASK:` blocks — the entry carries a `Consumes` and a `body` holding a Machine line and Proof legs — are the same blocks the implementer receives, and the TASK block contains that Machine line and those legs); its `opts.schema` deep-equals the exported `EXAMINER_SCHEMA`, and `EXAMINER_SCHEMA` itself has `required` deep-equal to `['status', 'summary', 'startHead']`, `properties.status.enum` deep-equal to `['DONE', 'BLOCKED']`, and `properties.unsatisfiable.items.required` deep-equal to `['leg', 'why']`; `loadRoles(tmpRolesDir).examiner` equals the temp file's text; and `defaultTaskIdOf('exam:T1') === 'T1'` [M1]; (b) with the examiner stub writing a `t1_test.sh` that exits 1 until `one.txt` exists, `report.tasks[0].exam === 'red'` and no judgment call contains `green at BASE`, and with an examiner stub writing a script that exits 0 at BASE, `report.tasks[0].exam === 'green-at-base'` and `report.judgmentCalls` contains exactly the line `task T1: exam is green at BASE — it establishes nothing` [M2]; (c) an examiner reply carrying `unsatisfiable: [{leg: '(b)', why: 'no such flag'}]` yields exactly the judgment call `task T1: examiner: (b) — no such flag`; an examiner reply `{status: 'BLOCKED', …}` and, in a separate run, an examiner stub returning `null` each yield `exam: 'blocked'`, a judgment call, and the `impl:T1` label still dispatched [M3]; (d) an implementer stub that rewrites `t1_test.sh` to `exit 0` yields `report.tasks[0].status === 'failed'`, `reviewVerdict === 'exam-edited'`, `exam === 'red'` (the value recorded before the implementer ran), no `review:T1:*` label dispatched, `coverage.tasks_merged === 0`, and a judgment call naming `t1_test.sh`; the same with the rewrite happening in the `fix:T1:1` round (the first review returns one blocking issue) yields the same verdict, with `exam === 'red'`, after the fix round; and with a green-at-base examiner and an editing implementer the failed result carries `exam === 'green-at-base'` [M4]; (e) the same rig with `proofTests: []`, with the key absent, and with `testCmd: null` each dispatch exactly `impl:T1`, `review:T1:1`, `integration` and record `exam: null`; and every file matching `fleet/tests/test_run_engine*.mjs` other than this task's own `test_run_engine_examiner.mjs`, enumerated by the test with `fs.readdirSync`, run as a child process, prints `ALL TESTS PASSED` and exits 0 [M5]; (f) with `proofTests: ['t1_test.sh', 't1_extra.sh']` and an examiner stub that writes only `t1_test.sh` (absent at BASE), the recorded blobs are the post-`DONE` sha of `t1_test.sh` and `null` for `t1_extra.sh`; an implementer that leaves `t1_test.sh` byte-identical and never creates `t1_extra.sh` merges; an implementer that creates `t1_extra.sh` is `exam-edited` with a judgment call naming `t1_extra.sh` and not `t1_test.sh`; an implementer that changes one byte of `t1_test.sh` is `exam-edited` with a judgment call naming `t1_test.sh` [M2, M4]; (g) with two `proofTests` paths both written by the examiner and an implementer that edits only the second, the judgment call names exactly the second path [M4].

**Stale-if:**
- issue-closed: #553
- path-exists: `fleet/roles/examiner.md`

### Task 3: Wave entries carry the Proof `Test:` paths

**Type:** implementation

**Files:**
- Modify: `skills/ultrapowers/scripts/compile_plan.py`
- Test: `tests/test_compile_plan_proof_tests.py`

**Claim:** The exam rides the assignment channel (quoted from #553)
Machine: M1. Every wave entry `compile_plan.py --emit-args` writes carries `proofTests`: for a claims-v1 task, the list of its Proof `Test:` paths in Proof order (the same list `testCmd` derives from), `[]` when the Proof names none; for a legacy-grammar task, `[]`. M2. Every other key and value of every wave entry of `evals/fixtures/claims/plan.md` and `evals/fixtures/wide/plan.md` is unchanged, and `--check --renders` stdout on each is unchanged.

**Authorized-by:** #553 (map #551, item 2 of the design); #515

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** The wave entry is assembled in `main` at `skills/ultrapowers/scripts/compile_plan.py:2740-2760` (`testCmd` was added there by run-51's Task 1 from `derive_task_test_cmd(t["claims"]["proof_tests_ordered"])`); `parse_claims_body` returns `proof_tests_ordered` (`:307-465`), which is exactly the list to emit. A shared literal with the engine task: the key is `proofTests`, a JSON array of strings, Proof order. `tests/test_compile_plan_task_test_cmd.py` is the sibling pin for `testCmd` and the shape to copy for a `--emit-launch`/`--emit-args` round trip through a temp plan; its leg (g) lists the entry keys at BASE — `id`, `title`, `files`, `depends_on`, `interfaces`, `tier`, `review`, `writes`, `commutes`, `testCmd` — and this task adds one.

**Proof:**
- Test: `tests/test_compile_plan_proof_tests.py`
- Legs: (a) a temp claims-v1 plan whose Proof lists `fleet/tests/test_x.mjs`, `tests/test_y.py` in that order emits `proofTests == ["fleet/tests/test_x.mjs", "tests/test_y.py"]` and `testCmd == "node fleet/tests/test_x.mjs && python3 -m pytest -q tests/test_y.py"` on the same entry [M1]; (b) a claims-v1 task whose Proof names `docs/x.md` emits `proofTests == ["docs/x.md"]` with `testCmd` `None` (the list is the Proof's, the command is only derivable for runnable shapes) [M1]; (c) a claims-v1 task with no Proof `Test:` line emits `proofTests == []` [M1]; (d) every entry of `evals/fixtures/wide/plan.md` emits `proofTests == []` [M1]; (e) `evals/fixtures/claims/plan.md` task 1 emits `proofTests == ["tests/test_widget.py"]` [M1]; (f) for each of the two fixtures, the `waves` array of the `--emit-args` file with `proofTests` deleted from every entry deep-equals a literal frozen in the test from the BASE compiler's output (recorded before this task's edit, so any other added, dropped or changed key on any entry fails it), and `compile_plan.py --check --renders` stdout on each fixture equals, byte for byte, a literal frozen the same way [M2].

**Stale-if:**
- issue-closed: #553

### Task 4: The role files speak in the peer-review register

**Type:** implementation
**Review:** adversarial

**Files:**
- Modify: `fleet/roles/reviewer.md`
- Modify: `fleet/roles/critic.md`
- Modify: `fleet/roles/fix.md`
- Modify: `fleet/roles/implementer.md`
- Modify: `fleet/roles/README.md`
- Test: `fleet/tests/test_roles_peer.mjs`

**Claim:** The reviewer's brief is rewritten in the new register: a referee checks that the submission establishes its claim by the stated exam (#518's reframe), and reports what it could not verify as a question for the editor, not a finding. (quoted from #556)
Machine: M1. No file under `fleet/roles/` contains the word `adversarial` (any case). M2. `fleet/roles/reviewer.md` contains, verbatim, the sentences `You are a referee: your job is to check that this submission establishes its claim by the stated exam, and to help it get there.`, `When you can write the fix for a \`blocking\` issue, put it in that issue's \`proposedPatch\` as a unified diff.` and `A requirement the diff cannot settle is a question for the editor: put it under \`cannotVerify\` with why, never among the findings.` M3. `fleet/roles/reviewer.md` still satisfies the two pins in `fleet/tests/test_run_engine.mjs:144-158` (the `plan-defect:` … `blocking` … `FILES` rule and the `red-then-green` / `neither a finding nor a \`cannotVerify\` entry` rule). M4. `fleet/roles/fix.md` contains, verbatim, the sentence `An issue may carry a \`PROPOSED PATCH\` from the referee: apply it when it is right; when it is not, say why in your summary.` M5. `fleet/roles/implementer.md` contains, verbatim, the sentence `A Proof \`Test:\` file already in your tree when you start is a peer's exam and your grading: run it, do not edit it, and if it is red for a reason other than the missing implementation, report that as a \`concerns\` entry prefixed \`exam:\`.` M6. `fleet/roles/critic.md` contains, verbatim, the sentence `You are the editor's completeness read of the whole submission.` and keeps its five slot-by-slot checks and the `deferredVerification` vocabulary. M7. No role file contains `NEVER`, `ALWAYS` or `MUST` as an upper-case whole word. M8. `fleet/roles/README.md` lists all seven role files — `implementer.md`, `reviewer.md`, `fix.md`, `resolver.md`, `reconcile.md`, `critic.md`, `examiner.md` — and no longer says prompts are capped at 350 words (sizes are reported, not gated — #496).
**Authorized-by:** #556 (map #551; operator decision 2026-09-02: the register is scientific peer review); #553 item 4 (the implementer receives the exam)

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** The role files are read verbatim at dispatch (`fleet/run-engine.mjs:146-152`); every existing pin on them is in `fleet/tests/test_run_engine.mjs:131-158` (no shouting; the two reviewer rules) and `fleet/tests/test_run_engine_critic_inputs.mjs:315` (reads `critic.md` — check what it asserts before rewriting the sentence it anchors on). The route for `proposedPatch` — the schema field and the fix prompt's `PROPOSED PATCH` block — is a sibling engine task's; this task writes the prose that names them. Shared literals with that sibling: the field name `proposedPatch` (a string, unified diff), the fix-prompt block header `PROPOSED PATCH`. Shared literal with the examiner tasks: the `concerns` prefix `exam:`. The current reviewer.md (`fleet/roles/reviewer.md`, 384 words) opens "You are an independent reviewer"; keep every numbered rule's substance — rules 1–7 were each bought by a run read (#344, #441, #458) — and change the stance, not the checks. `fleet/roles/README.md` is pinned by `tests/test_roles_readme.py` (read it first). CLAUDE.md §How features are built already replaced the adversarial trim review; the roles were the last place the word lived.

**Proof:**
- Test: `fleet/tests/test_roles_peer.mjs`
- Legs: (a) for every file in `fleet/roles/`, `/adversarial/i` does not match [M1]; (b) `reviewer.md` contains each of the three M2 sentences as an exact substring [M2]; (c) `/`plan-defect:`[\s\S]{0,80}blocking[\s\S]{0,80}FILES/` matches `reviewer.md`, and both `/red-then-green/` and `/neither a finding nor a `cannotVerify` entry/` match it, while each of the three regexes fails on the text of `fix.md` (the pins are not vacuous) [M3]; (d) `fix.md` contains the M4 sentence as an exact substring, exactly once [M4]; (e) `implementer.md` contains the M5 sentence as an exact substring [M5]; (f) `critic.md` contains the M6 sentence as an exact substring, contains `deferredVerification`, and contains each of the five numbered checks `1. Claim`, `2. Interfaces`, `3. Context`, `4. Proof`, `5. The cannot-verify checklist` exactly once [M6]; (g) for every file in `fleet/roles/`, `/\b(NEVER|ALWAYS|MUST)\b/` does not match [M7]; (h) `README.md` contains each of the seven filenames, does not contain `350 words`, and still contains `run-engine.mjs` and `Amendment 10` [M8].
**Stale-if:**
- issue-closed: #556

### Task 5: Referees return proposed patches and the fix round receives them

**Type:** implementation
**Review:** adversarial

**Files:**
- Modify: `fleet/run-engine.mjs`
- Test: `fleet/tests/test_run_engine_proposed_patch.mjs`

**Claim:** a referee's output is help — a proposed patch or a question for the editor — never a hunt for any feasible defect (quoted from #551)
Machine: M1. `REVIEWER_SCHEMA.properties.issues.items.properties` carries `proposedPatch: { type: 'string' }` and `required` for an issue is still exactly `['severity', 'detail']`. M2. The fix-round prompt lists each blocking issue as before and, for each blocking issue carrying a non-empty `proposedPatch`, appends directly under that issue's line a block beginning `PROPOSED PATCH (from the referee — apply it when it is right; say why not when it is not):` followed by the patch text verbatim; an issue without one gets no such block. M3. The task result carries `proposedPatches`: the number of blocking issues in the review round that carried a non-empty `proposedPatch` (`0` when none, and `0` on a clean first review). M4. With no issue carrying `proposedPatch`, the fix prompt, the dispatch sequence and the report of `fleet/tests/test_run_engine_fixloop.mjs` are unchanged except for the added `proposedPatches: 0` field.

**Authorized-by:** #551 (the map's rule: review is collaborative); #556; #232 (the second referee re-read)

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** `REVIEWER_SCHEMA` is `fleet/run-engine.mjs:84-97`; issues are merged, de-duplicated by `severity|detail` and split by severity at `:637-652`; the fix prompt is built at `:674-680` with `'\n\nBlocking issues to resolve:\n' + blocking.map((b) => '- ' + b.detail).join('\n')`. The task result shape is at `:653-662` and `:664-668`. Shared literals with the roles task: the field name `proposedPatch`; the block header `PROPOSED PATCH (from the referee — apply it when it is right; say why not when it is not):`. The pair profile concatenates two reviewers' issues (`:619-626`); a patch on either counts. Keep the dedup key as it is — two referees proposing different patches for one `detail` collapse to the first; that loss is acceptable for this run and is recorded here so the critic does not flag it. `fleet/tests/test_run_engine_fixloop.mjs` is the existing fix-round sim; its stub shape is the one to copy.

**Proof:**
- Test: `fleet/tests/test_run_engine_proposed_patch.mjs`
- Legs: (a) `REVIEWER_SCHEMA.properties.issues.items.properties.proposedPatch` deep-equals `{ type: 'string' }` and `REVIEWER_SCHEMA.properties.issues.items.required` deep-equals `['severity', 'detail']` [M1]; (b) a review stub returning two blocking issues, the first with `proposedPatch: '--- a/x\n+++ b/x\n@@ -1 +1 @@\n-1\n+2\n'` and the second without, yields a `fix:T1:1` prompt in which the header line `PROPOSED PATCH (from the referee — apply it when it is right; say why not when it is not):` occurs exactly once, immediately after the first issue's `- ` line, followed by the patch text verbatim, and the second issue's line is followed by no such header [M2]; (c) that run's `report.tasks[0].proposedPatches === 1`; a run whose first review passes clean has `proposedPatches` present and exactly `0`; a run with two blocking issues both carrying patches has exactly `2` [M3]; (d) a fix-round run whose issues carry no `proposedPatch` produces a `fix:T1:1` prompt not containing `PROPOSED PATCH`, and `node fleet/tests/test_run_engine_fixloop.mjs` prints `ALL TESTS PASSED` [M4]; (e) with three blocking issues of which only the third carries a patch, the header occurs exactly once, after the third issue's line, and with none carrying one the header is absent [M2]; (f) with two blocking issues each carrying a distinct patch, the header occurs exactly twice, each immediately after its own issue's `- ` line and followed by that issue's own patch text [M2]; (g) with one blocking issue carrying `proposedPatch: ''` and one `minor` issue carrying a non-empty patch, the fix prompt contains no header and `proposedPatches` is exactly `0` [M2, M3].

**Stale-if:**
- issue-closed: #556

### Task 6: `Review: peer` is the documented review marker

**Type:** implementation

**Files:**
- Modify: `skills/ultrapowers/scripts/compile_plan.py`
- Modify: `skills/ultrapowers/scripts/ultra_run.py`
- Modify: `skills/ultrawrite/SKILL.md`
- Modify: `skills/ultrapowers/references/plan-markers.md`
- Modify: `fleet/run-engine.mjs`
- Modify: `tests/test_compile_plan.py`
- Test: `tests/test_review_peer.py`
- Test: `fleet/tests/test_run_engine_review_peer.mjs`

**Claim:** `**Review:** adversarial` → `**Review:** peer` in the claims-v1 grammar (`compile_plan.py` accepts both for one release, emits `peer`; `ultra_run.py` VALID_REVIEWS likewise) (quoted from #556)
Machine: M1. `compile_plan.py` accepts `**Review:** peer`, `**Review:** adversarial` and `**Review:** lean`, emitting `peer` on the wave entry for both `peer` and `adversarial` (`lean` for `lean` and when unmarked), and refuses any other value naming `peer`, `adversarial` and `lean` in the error; the BASE pin `test_review_marker_emits_adversarial_slot` in `tests/test_compile_plan.py` is updated to expect `peer`. M2. `ultra_run.py`'s `VALID_REVIEWS` is exactly `{"lean", "adversarial", "peer"}` and `--validate-knobs` accepts an args file whose entries carry `review: "peer"`. M3. In `fleet/run-engine.mjs`, a task with `review: 'peer'` runs the concurrent reviewer pair exactly as `review: 'adversarial'` does (labels `review:<id>:1:1` and `review:<id>:1:2`), `args.reviewProfile: 'peer'` selects the pair run-wide, and a task with `review: 'peer'` draws no `unknown review=` judgment call. M4. `skills/ultrawrite/SKILL.md` contains the marker line `**Review:** peer` and the phrase `` `peer` or `lean` ``, `skills/ultrapowers/references/plan-markers.md` contains the phrase `` one of `peer` or `lean` ``, and neither file contains the word `adversarial`.

**Authorized-by:** #556 (map #551; nine sites at BASE)

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** The nine sites at BASE: `skills/ultrapowers/scripts/compile_plan.py:49` (comment) and `:885-887` (the refusal `if val not in ("adversarial", "lean")`), `:2744-2746` (the emit); `skills/ultrapowers/scripts/ultra_run.py:103` (`VALID_REVIEWS = {"lean", "adversarial"}`) and `:249` (a help string `lean|adversarial`); `fleet/run-engine.mjs:418` (`reviewProfile`), `:435` (`taskReviewProfile`), `:550` (the unknown-review judgment call), `:613` (the pair branch); `skills/ultrawrite/SKILL.md` (the `**Review:**` bullet and the example task's `**Review:** adversarial`); `skills/ultrapowers/references/plan-markers.md:38`. The one existing pin this task owns: `tests/test_compile_plan.py:2119-2121` (`test_review_marker_emits_adversarial_slot`, which asserts an `adversarial` marker emits `adversarial` — it now expects `peer`; the sibling refusal test at `:2130-2133` still passes because the error names all three values). Pins that must stay green and are NOT yours to edit: `tests/test_plan_check.py:71-74`, `tests/test_ultra_run.py:88` and `:179` (the engine and `--validate-knobs` still accept `adversarial` on an args entry), `fleet/tests/test_run_engine_review_pair.mjs` (the pair under `adversarial`). `tests/test_ultrawrite_skill.py` and `tests/test_recommendation_rubric.py` pin SKILL.md sentences — run them. `fleet/roles/*.md` are a sibling's; leave them.

**Proof:**
- Test: `tests/test_review_peer.py`
- Test: `fleet/tests/test_run_engine_review_peer.mjs`
- Legs: (a) a temp legacy plan with `**Review:** peer` compiles and its `--emit-args` entry has `review == "peer"`; with `**Review:** adversarial` it also has `"peer"`; with `**Review:** lean` and unmarked it has `"lean"`; `tests/test_compile_plan.py::test_review_marker_emits_adversarial_slot` asserts `"peer"` and passes; with `**Review:** paranoid` the compile exits non-zero and stderr contains `peer`, `adversarial` and `lean` [M1]; (b) `ultra_run.VALID_REVIEWS == {"lean", "adversarial", "peer"}` and `--validate-knobs` on an args file with one entry `review: "peer"` and no other knobs exits 0 [M2]; (c) an engine sim with `review: 'peer'` dispatches `review:T1:1:1` and `review:T1:1:2`, both started before either resolves (the `test_run_engine_review_pair.mjs` deadlock shape), and its `report.judgmentCalls` contains no line containing `unknown review=`; a sim with `review: 'lean'` and `extraArgs: { reviewProfile: 'peer' }` dispatches the same pair; a sim with `review: 'wat'` still records the `unknown review=` judgment call [M3]; (d) a case-insensitive search for `adversarial` in `skills/ultrawrite/SKILL.md` and in `skills/ultrapowers/references/plan-markers.md` finds exactly zero matches, SKILL.md contains the line `**Review:** peer` and the phrase `` `peer` or `lean` ``, plan-markers.md contains `` one of `peer` or `lean` ``, and `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrawrite` exits 0 [M4].

**Stale-if:**
- issue-closed: #556

### Task 7: The parallelism cap divides the machine among the tasks that share the run-wide command

**Type:** implementation

**Files:**
- Modify: `fleet/run-engine.mjs`
- Test: `fleet/tests/test_run_engine_cap_width.mjs`

**Claim:** keep the divide-by-width cap only for a plan that pins a run-wide per-task command (the legacy path) (quoted from #547)
Machine: M1. `capWorkerParallelism(cmd, width, cpus)` is unchanged. M2. The width the engine caps the run-wide `testCmd` by is the number of wave entries in the run whose `testCmd` is not a non-empty string (the tasks that will actually run the run-wide command), at least 1, instead of `args.width`. M3. When every wave entry carries its own non-empty `testCmd`, the engine logs no `worker testCmd capped for concurrency` line and the `reconcile` prompt's `TEST COMMAND:` line and the driver's own suite runs carry the run-wide `testCmd` uncapped. M4. When no entry carries its own `testCmd`, the cap width equals the number of tasks in the run, so a run of eight per-run-command tasks on eight cpus still caps `-n auto` to `-p no:xdist` (#436's arithmetic).

**Authorized-by:** #547; #515 (per-task commands shipped by run-51); #436 (the thrash guard the cap keeps)

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** The cap is computed once at `fleet/run-engine.mjs:406-416` (`workerWidth` from `args.width`, default 8; `workerTestCmd = capWorkerParallelism(testCmd, workerWidth, os.cpus().length)`; the log line at `:414`); `testCmdLine` (`:171-174`) prefers `task.testCmd` and falls back to the argument, so an implementer with its own command never sees the capped one today — the cap only matters for tasks without one. The reconcile prompt (`:962`) and every `sh(testCmd, integ)` site already use the uncapped `testCmd`; M3 pins that they stay so. `WAVES` is available at that point (`args.waves`, parsed above `:400`); count entries across all waves. The unit pin for the arithmetic is in `fleet/tests/test_run_engine.mjs` (grep `capWorkerParallelism`) — keep it green. Observable in run-53's events: the `capped for concurrency` log line is absent when every task carries `testCmd`.

**Proof:**
- Test: `fleet/tests/test_run_engine_cap_width.mjs`
- Legs: (a) `capWorkerParallelism('pytest -n auto', 8, 8) === 'pytest -p no:xdist'` and `capWorkerParallelism('pytest -n auto', 2, 8) === 'pytest -n 4'` (unchanged BASE values) [M1]; (b) a three-task sim on a rig whose `testCmd` is `bash check.sh -n auto`, with T1 carrying `testCmd: 'bash t1.sh'`, T2 carrying `testCmd: ''` and T3 carrying none, run with `extraArgs: { width: 8 }` on a host the test asserts has `os.cpus().length >= 2`, produces `impl:T2` and `impl:T3` prompts whose `TEST COMMAND:` line equals `capWorkerParallelism('bash check.sh -n auto', 2, os.cpus().length)` (computed in the test) and an `impl:T1` prompt whose line is `TEST COMMAND: bash t1.sh`; a variant with T2 also carrying a real command yields the width-1 value, which the test asserts differs from the width-2 value at that cpu count [M2]; (c) a sim where every entry carries its own `testCmd` and the run-wide command contains `-n auto` logs no line containing `capped for concurrency`, its `reconcile` prompt (forced by a red candidate suite, the `test_run_engine_reconcile.mjs` shape) carries `TEST COMMAND: <run-wide command verbatim>`, and a recording `exec` seam wrapped around the rig's shows every `bash -lc` suite invocation the driver made carrying the run-wide command verbatim [M3]; (d) a sim with no per-task `testCmd` on eight entries, on a host the test asserts has `os.cpus().length >= 2`, logs the `capped for concurrency` line carrying exactly `capWorkerParallelism(cmd, 8, os.cpus().length)` [M4].

**Stale-if:**
- issue-closed: #547

### Task 8: The sandbox samples its own load once a minute into the run dir

**Type:** implementation

**Files:**
- Modify: `fleet/shim-main.mjs`
- Test: `fleet/tests/test_shim_main_load_sampler.mjs`

**Claim:** the shim (`fleet/shim-main.mjs`) starts a sampler at engine launch — one line per minute of `/proc/loadavg`, `free -m` used/available, and process counts for `pytest` and `claude` — into `<runDir>/load.jsonl`, so it rides the existing sandbox-logs pull (quoted from #549)
Machine: M1. `fleet/shim-main.mjs` exports `startLoadSampler({ file, intervalMs, readLoadavg, readFree, listProcs, now })` which creates `file`'s directory, appends one JSON line immediately and then one every `intervalMs`, and returns `{ stop }`; each line is `{ts, load1, load5, load15, memUsedMb, memAvailMb, pytest, claude}` where the three loads come from `readLoadavg()` (the text of `/proc/loadavg`), the two memory numbers from `readFree()` (the text of `free -m`: the `Mem:` row's `used` and `available` columns), and the two counts from `listProcs()` (one line per process's full command; `pytest` counts lines containing `pytest`, `claude` counts lines whose first token's basename is `claude`); a reader that throws makes that line's fields `null` and the sampler continues. M2. After `stop()` no further line is appended. M3. `invokeEngineRun` starts the sampler on `<repoDir>/.claude/ultrapowers/run-<runId>/load.jsonl` at `intervalMs` 60000 before it calls `spawnEngine` and stops it after `spawnEngine` resolves or rejects, through an injectable `startSampler` seam defaulting to `startLoadSampler`, so a test that injects a no-op sampler sees the BASE behaviour exactly. M4. `sandboxLogPullCommand` is unchanged, so `load.jsonl` rides the bundle with the other run-dir files.

**Authorized-by:** #549; #484 (evidence off the VM); memory "Fleet CPU metric is too coarse"

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** `invokeEngineRun` is `fleet/shim-main.mjs:859-918` (seams `exec`, `spawnEngine`, `log`, `excludeDirs` as named parameters — add `startSampler` beside them); the engine spawn is `:907` (`const code = await spawnEngine({`); `RUN_ARTIFACT_DIR = '.claude/ultrapowers'` (`:37`) and `oneDriverRunDir = path.join(repoDir, RUN_ARTIFACT_DIR, \`run-${runId}\`)` is the expression at `:956` (in `main`; compute the same path inside `invokeEngineRun`). The run dir is created by the engine (`fleet/run-main.mjs:239-244`) AFTER the shim spawns it, so the sampler's own `mkdirSync(recursive)` of the run dir must be harmless to the engine's later `mkdirSync(recursive)` calls — it is. Default readers: `fs.readFileSync('/proc/loadavg', 'utf8')`, `execFileSync('free', ['-m'])`, `execFileSync('ps', ['-eo', 'args='])`; on macOS all three throw and the line carries `null`s (M1's rule), so the shim sims run anywhere. The sandbox-logs pull is `fleet/drive.mjs:51-60` — it tars `.claude/ultrapowers/run-*/` minus `clones`, so no drive change is needed; the bundle lands at `fleet-evidence/sandbox-logs/<vm>-<ts>/sandbox-logs.tgz` (`:969-970`). The shim sims (`fleet/tests/test_shim_main_*.mjs`) stub `spawnEngine` as an async function returning an exit code (`test_shim_main_gate.mjs:201,218,300`) and use a hand-rolled `passed`/`ok` counter, printing `ALL TESTS PASSED` at the end. Use a fake timer by injecting `intervalMs: 5` and `now`, not real minutes.

**Proof:**
- Test: `fleet/tests/test_shim_main_load_sampler.mjs`
- Legs: (a) with injected readers returning `'1.50 0.75 0.25 3/400 12345\n'`, a `free -m` text whose `Mem:` row reads `Mem: 15000 3000 9000 100 3000 11500`, and a process list of `['python3 -m pytest -q tests', '/usr/bin/claude -p x', 'claude', 'node fleet/run-main.mjs']`, and `intervalMs: 5`, the file holds after ~30 ms at least three lines, and the first parsed line deep-equals `{ts: <injected now>, load1: 1.5, load5: 0.75, load15: 0.25, memUsedMb: 3000, memAvailMb: 11500, pytest: 1, claude: 2}` [M1]; (b) with `readFree` throwing, the line has `memUsedMb: null`, `memAvailMb: null` and the other fields filled; with `readLoadavg` throwing, the three load fields are `null`; with `listProcs` throwing, both counts are `null`; in each case the sampler still appends a second line [M1]; (g) `startLoadSampler` called with a `file` whose parent directory does not exist creates it and writes the first line [M1]; (c) after `stop()`, waiting 30 ms adds no line (line count before equals after) [M2]; (d) `invokeEngineRun` run with a recording `startSampler` stub and a stub `spawnEngine`, both appending to one shared sequence, records the sequence `['startSampler', 'spawnEngine', 'stop']`, exactly one `startSampler` call whose `file` equals `<repoDir>/.claude/ultrapowers/run-<runId>/load.jsonl` and whose `intervalMs` equals `60000`; a `spawnEngine` that rejects still leaves the sequence ending in `stop` exactly once [M3]; (h) `invokeEngineRun` run with no `startSampler` injected, on this host, leaves `<repoDir>/.claude/ultrapowers/run-<runId>/load.jsonl` holding at least one line that parses as JSON with all eight keys present (values may be `null` off Linux) [M3]; (e) `sandboxLogPullCommand({ vmName: 'fleet-run-9', dest: '/d/x.tgz' })` equals exactly its BASE string, frozen in the test verbatim [M4]; (f) `node fleet/tests/test_shim_main_gate.mjs` and `test_shim_main_plan_assignment.mjs` still print `ALL TESTS PASSED` [M3].

**Stale-if:**
- issue-closed: #549

### Task 9: A tool pins each task's BASE facts

**Type:** implementation

**Files:**
- Create: `skills/ultrawrite/scripts/pin_base_facts.py`
- Test: `tests/test_pin_base_facts.py`

**Claim:** A `**BASE facts:**` block per task, **generated** by `compile_plan.py --base <root> --pin-facts` (or a sibling script) from every referent the task names: path, symbol, first line, blob sha at BASE. (quoted from #555)
Machine: M1. `python3 skills/ultrawrite/scripts/pin_base_facts.py <plan.md> --base <root>` prints, for every task of a claims-v1 plan, one paragraph beginning `**BASE facts:** (generated at <7-char base sha>)` followed by one fact per referent the task names that resolves at BASE, each as `\`<path>\` blob <7-char blob sha>`, or `\`<path>:<N>\` blob <sha> line <N> \`<the line's text, stripped, at most 60 chars>\`` for a line-numbered referent, or `\`<symbol>\` at \`<path>:<N>\` blob <sha>` for a backticked identifier whose first definition line (the first `git grep -n -E` hit over the code files `*.py *.mjs *.js *.ts *.sh`, in `git ls-files` order) is in a code file at BASE; a referent that does not resolve at BASE is omitted from the block (the compiler's `ADVISORY referent:` already names it). M2. `--write` rewrites the plan in place so that each task's Context slot ends with exactly one such paragraph (an existing `**BASE facts:**` paragraph is replaced, not duplicated), touching no other byte, and a second `--write` at the same base is a no-op. M3. `--verify` exits 0 when every fact in the plan's existing blocks still holds at `--base` and exits 2 printing one `stale: task <id> \`<referent>\` …` line per fact that no longer holds: a path fact whose blob sha differs or whose path is absent, a line fact whose blob sha or line text differs, a symbol fact whose blob sha differs or whose first definition is no longer at that path and line. M4. A plan that is not claims-v1 exits 0 printing one `pin_base_facts: … not a claims-v1 plan` line.

**Authorized-by:** #555 (map #551: the plan names nothing it does not Produce/Consume outside a generated block); #536; memory "A correct-sounding comment hides the defect"

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** The referent machinery to reuse, importable from `skills/ultrapowers/scripts/compile_plan.py` the way `skills/ultrawrite/scripts/check_provenance.py:30-37` imports it: `_referent_scan_lines(task)` (`:2291-2303`, every body line's backticked tokens minus fences, Files bullets and Commutes), `_path_referent(tok)` (`:2253-2269`, the normalized repo path a token names — it strips a trailing `:N` or `:N-M`, so read the line number off the raw token yourself), `_git(base, *args)` (`:2088-2098`, stdout or `''` on any failure), `_git_tracked(base)` (`:2103-2106`), `PATH_RE` (`` `([^`]+)` ``), `split_tasks`, `parse_claims_body`, `plan_grammar`, `CLAIMS_GRAMMAR`. Blob sha: `git rev-parse <base-sha>:<path>`; the base sha: `git rev-parse HEAD` in `--base`. Symbol definition search: `git grep -n -E '^(\s*(export\s+)?(async\s+)?(def|function|class|const|let)\s+<sym>\b)' -- '*.py' '*.mjs' '*.js' '*.ts' '*.sh'`, first hit. The Context slot's text is `parse_claims_body(...)["context"]`; its byte range in the body is the `ranges["Context"]` pair inside that function — recompute it from the label line (`SLOT_LABEL_RE`) rather than reaching into the function. A fence is illegal in Context (`compile_plan.py:379-391`), so the block is a plain paragraph: label line, then one `- ` bullet per fact. The ADVISORY word count on Context grows with the block; that is expected. Tests build a temp git repo with two committed files and a temp claims-v1 plan naming them (as `tests/test_check_renders.py` does for referents), so the shas are the test's own.

**Proof:**
- Test: `tests/test_pin_base_facts.py`
- Legs: (a) on a temp repo with `pkg/a.py` (four lines: line 2 is `def alpha():`, line 3 is a comment longer than 60 characters, line 4 is a second `def alpha():`) and `docs/n.md` (whose text contains the word `alpha`), a two-task claims-v1 plan whose task 1 Context names `` `pkg/a.py:2` ``, `` `docs/n.md` ``, `` `alpha` `` and `` `ghost/x.py` `` and whose task 2 Context names `` `pkg/a.py:3` `` prints exactly two paragraphs starting `**BASE facts:** (generated at <sha7>)`, in task order; the first has exactly three bullets — the `pkg/a.py:2` bullet carrying the blob sha of `pkg/a.py` and `line 2 \`def alpha():\``, the `docs/n.md` bullet carrying its blob sha, and `` `alpha` at `pkg/a.py:2` `` carrying the blob sha of `pkg/a.py` (line 2, not line 4: the first definition; and not `docs/n.md`: not a code file) — and no bullet mentions `ghost`; the second's `pkg/a.py:3` bullet carries the line text truncated to exactly 60 characters [M1]; (b) after `--write`, splicing each inserted paragraph (and the one newline before it) back out of the written file yields bytes identical to the original file, each Context slot now ends with its paragraph, `compile_plan.py --check` still prints `PLAN OK` (with a signed verdict file), and a second `--write` produces a byte-identical file [M2]; (c) after `--write`, `--verify` exits 0; after a commit that changes `pkg/a.py` line 2, `--verify` exits 2 and prints exactly three `stale:` lines — task 1's `pkg/a.py:2` fact and `alpha` fact and task 2's `pkg/a.py:3` fact, every fact sharing the changed blob — and after deleting `docs/n.md` in a further commit it prints a fourth naming `docs/n.md`; a commit that changes only `docs/n.md` makes exactly one `stale:` line, naming `docs/n.md`; and, from a fresh `--write` at a base where `pkg/a.py` is unchanged, a commit adding a new code file `aaa.py` (earlier than `pkg/a.py` in `git ls-files` order) whose line 1 is `def alpha():` makes `--verify` print exactly one `stale:` line, naming `alpha` (its first definition moved while `pkg/a.py`'s blob did not) [M3]; (g) with that `aaa.py` present at generation, the `alpha` fact names `aaa.py:1` and carries `aaa.py`'s blob sha [M1]; (f) at that moved base, `--write` again leaves task 1's Context with exactly one `**BASE facts:**` paragraph, now carrying the new base sha, the new blob sha of `pkg/a.py` and the new line-2 text, with no `docs/n.md` bullet, and `--verify` then exits 0 [M2]; (d) run on `evals/fixtures/wide/plan.md` (legacy grammar) it exits 0 printing a single line containing `not a claims-v1 plan` [M4]; (e) run on `evals/fixtures/claims/plan.md` with `--base` at this checkout it exits 0, prints exactly one `**BASE facts:**` paragraph per task heading in the fixture, in order, and every printed bullet's path exists in the tree [M1].

**Stale-if:**
- issue-closed: #555

### Task 10: One signature per plan

**Type:** implementation
**Review:** adversarial

**Files:**
- Modify: `skills/ultrapowers/scripts/compile_plan.py`
- Modify: `skills/ultrawrite/scripts/check_provenance.py`
- Modify: `skills/ultrawrite/scripts/extract_gate_input.py`
- Modify: `skills/ultrawrite/SKILL.md`
- Test: `tests/test_plan_level_claim.py`

**Claim:** A plan-level `**Claim:**` above the first task: one do:/see: sentence in the operator's words, elicited (the AskUserQuestion path), about what they will see after the run. (quoted from #552)
Machine: M1. `compile_plan.py` exports `parse_plan_claim(md_text)` returning the header's `**Claim:**` sentence (the first non-fenced `**Claim:**` line before the first task heading, wrapped continuation lines joined, the closing `(elicited)` tag stripped) or `None`; a header Claim present without a closing `(elicited)` tag is a `grammar:` refusal on both channels for a claims-v1 plan. M2. Under claims-v1, a task Claim's operator sentence may close with `(derived)` when the plan carries a header Claim — `claim_provenance` is then `"derived"` — and `(derived)` without a header Claim is refused with a `grammar:` line naming the missing plan-level Claim; `(elicited)` and `(quoted from #NNN)` behave as at BASE, and the header Claim is not part of any task's gate-input hash. M3. `check_provenance.py` counts derived claims separately, never resolves them, and its success line reads `provenance: ok — <n> claim quote(s), <m> derived and <k> anchor(s) resolve` (`<m> derived` omitted when zero, so a plan with no derived claims prints the BASE line). M4. `extract_gate_input.py --plan` (no `--task`) prints `{"claim": <header sentence>, "tasks": [{"id", "machine"}…], "hash": sha256(claim + "\x00" + machines joined by "\n")}` where `machine` is each task's Machine restatement, and exits via `SystemExit` naming the missing header Claim when there is none. M5. `--emit-args` writes `planClaim` (the sentence or `null`) at the top level of the args file and every other key is unchanged. M6. `skills/ultrawrite/SKILL.md` §The document names the header `**Claim:**` line and §Self-review says every task Claim is either the operator's words with a provenance tag or `(derived)` under a plan-level Claim.

**Authorized-by:** #552 (map #551; operator decision 2026-09-02: one operator sentence per plan); #243 (sign intent, derive the plan)

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** The header is everything before the first task heading; `plan_grammar` (`compile_plan.py:274-284`) is the fence-aware header scan to copy (`match_head` ends it). `CLAIM_PROVENANCE_RE` is `:257` (`\((elicited|quoted from #(\d+))\)\s*$`) and its use site `:585-597` inside `parse_claims_body`, which is a pure function of one task body — it cannot see the header, so thread a `plan_claim` argument (default `None`) through `parse_claims_body`, `_apply_claims_grammar` and `parse_task` (`:601`), keeping every existing call green (the default preserves BASE behaviour; `tests/test_compile_plan_claims.py` calls `parse_claims_body(body, task_id)` positionally). `gate_input_hash` (`:536`) is over Claim and Proof text only — M2 pins that `(derived)` is inside the Claim text like any other tag and the header sentence is not hashed. `check_provenance.py:79-125` is `check_plan`; its success line is `:152-153`; `operator_sentence` (`:47-55`) strips the tag with `CLAIM_PROVENANCE_RE`, so widen that regex (or a sibling) to know `derived`. `extract_gate_input.py:41-57` is `gate_input`; `main` at `:60-68` requires `--task` — make the pair mutually exclusive. The args top level today is `waves, wavesPath, edges, dependencyEdges, acceptance, waveLabels, globalConstraints, planPath` (`main`, near `:2740`). A sibling task adds `proofTests` to wave entries and another adds `peer` to the review vocabulary — both in `compile_plan.py`, other regions; the fold handles it. SKILL.md §The document is the paragraph beginning "Above the first task:"; `tests/test_ultrawrite_skill.py` pins sentences — run it. The header Claim of THIS plan is written in the #552 shape by hand and is inert to the BASE compiler; after this task it parses.

**Proof:**
- Test: `tests/test_plan_level_claim.py`
- Legs: (a) `parse_plan_claim` on a header carrying `**Claim:** After this run I can see X. (elicited)` returns `After this run I can see X.`, on a wrapped two-line sentence returns it joined by a single space, on a plan with no header `**Claim:**` line but a task body carrying `**Claim:**` returns `None`, and on a fenced `**Claim:**` inside the header returns `None` [M1]; (b) a claims-v1 plan whose header Claim lacks `(elicited)` is refused on both channels with a line starting `grammar: plan-level Claim` (through the `_refuses` shape of `tests/test_compile_plan_claims.py`) [M1]; (c) a claims-v1 plan with a header Claim and a task Claim closing `(derived)` compiles (signed), `parse_claims_body(body, "1", plan_claim="…")["claim_provenance"] == "derived"`, and its task hash equals `gate_input_hash(claim_text, proof_text)` computed without the header; the same task body with `plan_claim=None` yields a violation line starting `grammar: Claim is marked (derived) but the plan carries no plan-level Claim`; the BASE `GOOD_PLAN` of `tests/test_compile_plan_claims.py` still compiles with its `(quoted from #489)` tag, and a plan with a header Claim whose task Claims close `(elicited)` and `(quoted from #489)` compiles with `claim_provenance` `"elicited"` and `"quoted:#489"` and task hashes equal to the same bodies' hashes under a plan with no header Claim [M2]; (d) `check_provenance.py` with a stub `--gh` on a plan with one quoted claim, one derived claim and one anchor prints `provenance: ok — 1 claim quote, 1 derived and 1 anchor resolve` and exits 0; with no derived claim it prints the BASE line `provenance: ok — 1 claim quote and 1 anchor resolve` [M3]; (e) `extract_gate_input.py <plan> --plan` prints JSON whose `claim` is the header sentence, whose `tasks` lists every task id with its Machine text (the text after `Machine:` in the Claim slot), and whose `hash` equals the sha256 the test recomputes; on a plan with no header Claim it exits non-zero with a message containing `plan-level Claim`; `--plan --task 1` together exit non-zero [M4]; (f) `--emit-args` on a plan with a header Claim writes `planClaim` equal to the sentence, without one writes `null`, and the args file's other top-level keys are exactly `waves, wavesPath, edges, dependencyEdges, acceptance, waveLabels, globalConstraints, planPath` [M5]; (g) `skills/ultrawrite/SKILL.md` contains `**Claim:**` exactly once within the paragraph starting `Above the first task:`, and the text between the `## Self-review` heading and the end of the file contains `(derived)` and `plan-level Claim`, and `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrawrite` exits 0 [M6].

**Stale-if:**
- issue-closed: #552
