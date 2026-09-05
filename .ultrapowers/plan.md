# The implementer works against the suite

**Grammar:** claims-v1

**Claim:** After this run, an implementer on a peer-examined task works against the project's
suite, and a run's pull request carries the peer's exam and no test file the implementer
wrote for itself. (elicited)

**Goal:** Close #663. Since #653 the examiner writes the Proof `Test:` path in its own clone
and the driver lays it over the implementer's tree only after both return — so an implementer
handed `TEST COMMAND: bun test tests/x.test.ts` holds a command naming a file it cannot have,
and a role text that still says "write tests of your own that encode them" sends it to write
`tests/x.impl.test.ts` outside FILES. Walk run-5 (2026-09-05) produced three such files and
three concerns per run. The fix is two lines in two places: the implementer's TEST COMMAND
becomes the run-wide suite whenever the task's own `testCmd` names one of its Proof paths
(the exam's command stays the examiner's, the driver's, the fix round's and the reviewer's),
and step 2 of `fleet/roles/implementer.md` says the peer's exam is the task's test. Everything
here is `fleet/run-engine.mjs`, one role file and the engine sims; the laptop side, the boot
script, the janitor, the contract, the operator documents and the compiler are byte-identical
to BASE — three concurrent plans own them.

**Tech Stack:** Node 24 ESM (`fleet/run-engine.mjs`, the sims under `fleet/tests/`, each
printing `ALL TESTS PASSED`), Markdown role files under `fleet/roles/`, Python 3
(`python3 -m pytest` with `pytest-xdist`). Nothing is added to any dependency file.

**Spec:** #663 (the issue carries the design; there is no separate spec document), #653
(the driver-only handoff this corrects), #551 (the exam is written by a peer, never the
submitter).

**Parallelization rationale:** One wave, width 2. Task 1 is the engine and its sims; Task 2 is
the role text. Their Files are disjoint and neither consumes a sibling's symbol, so no edge is
derived and neither waits. Task 1's sim reads `fleet/roles/implementer.md` only to slice the
role text off the front of a prompt, so Task 2's rewording changes nothing it asserts.

## Global Constraints

- The vendored kernel is byte-identical to BASE: `skills/ultrapowers/kernel/vendor/manyana.py`
  is sha-pinned on purpose and never patched.
- Check: test "$(git hash-object skills/ultrapowers/kernel/vendor/manyana.py)" = 0e0367d23d19cdf87a047bd7f5cd814698f75fc4
- The laptop side, the sandbox boot, the lobby, the janitor, the doctor, the contract, the
  runbook, the operator skill and its first-run reference, the authoring skill, the distilling
  reference and the compiler are byte-identical to BASE — three concurrent runs own them.
- Check: test "$(git hash-object fleet/sandbox-boot.sh)" = fbe4d8dbc80d8a862f6dff86d2d946cee5eb580c
- Check: test "$(git hash-object fleet/launch.mjs)" = f47370d2badc0ef87b9d559f4e6a77f79d27d4b2
- Check: test "$(git hash-object fleet/lobby.mjs)" = 44556044708da98e6f794da8785f31f02f24638b
- Check: test "$(git hash-object fleet/janitor.mjs)" = 2de1fc707f26a06373905a8425f2ef6b67571210
- Check: test "$(git hash-object fleet/doctor.mjs)" = 7e35dcd094d24a25da7c7e4277bb983f32ff84b0
- Check: test "$(git hash-object fleet/CONTRACT.md)" = 1bf320dd7498f40e99558c397bebe669345b1cf7
- Check: test "$(git hash-object fleet/RUNBOOK.md)" = f630c6a17bfd931d702a3be675ec8a91be2aa497
- Check: test "$(git hash-object skills/ultrapowers/SKILL.md)" = 3df41c3fae22e7cf67534d9b2814aa644fb87b39
- Check: test "$(git hash-object skills/ultrapowers/references/first-run.md)" = a042dcd5485bbca9db37e0137144e9c3018b3a95
- Check: test "$(git hash-object skills/ultrawrite/SKILL.md)" = 366683a35618d97008c3004a96f16f812c49617c
- Check: test "$(git hash-object skills/ultralearn/references/distilling-proposals.md)" = c3aabdbbfdc8390e929ebe5f562d013f40eb78c7
- Check: test "$(git hash-object skills/ultrapowers/scripts/compile_plan.py)" = 18ad6070d1e0c33142710ebc107f11fe8f6765fa
- The four operator documents still agree with the code.
- Check: python3 -m pytest -q -p no:cacheprovider tests/test_docs_agree_with_code.py
- The examiner's, the reviewer's and the fix round's role texts are unchanged — the exam's
  command is theirs and stays theirs; no shouted imperative (an all-caps must, never or
  always as a whole word) is added to any file under `fleet/roles/`.
- Check: test "$(git hash-object fleet/roles/examiner.md)" = 3a8c8acf9e60d1a868db0bbfcc2226d42566bbf4
- Check: test "$(git hash-object fleet/roles/reviewer.md)" = 5e35f6d2569e5e8de68c0617156b91de2e669420
- Check: test "$(git hash-object fleet/roles/fix.md)" = d4c5f2ec9be36ef2a8c4a8ce0bfc0a8fb9ac0787
- No file outside a task's own Files block is edited.

**Acceptance:** suite — the committed suite is the verification.

### Task 1: The implementer is handed the suite, the exam keeps its command

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/run-engine.mjs`
- Modify: `fleet/tests/test_run_engine_examiner.mjs`
- Modify: `fleet/tests/test_run_engine_exam_together.mjs`
- Test: `fleet/tests/test_run_engine_implementer_suite.mjs`

**Claim:** the implementer's TEST COMMAND is the run-wide suite whenever the task's `testCmd`
names one of its Proof `Test:` paths (the exam's command stays the examiner's, the driver's
pre-review pass's and the reviewer's) (quoted from #663)
Machine: M1. For a task whose `testCmd` contains one of its `proofTests` paths, the
implementer's prompt (label `impl:<id>`) carries the line `TEST COMMAND: <workerTestCmd>` —
the run-wide command exactly as a task with no `testCmd` receives it — and no line
`TEST COMMAND: <task.testCmd>`. M2. The examiner's prompt (label `exam:<id>`) carries
`TEST COMMAND: <task.testCmd>` as at BASE, and its inputs after the role text differ from the
implementer's in that one line only: the examiner's tail with its `TEST COMMAND:` line replaced
by the implementer's `TEST COMMAND:` line is byte-equal to the implementer's tail. M3. The
exam's command is `task.testCmd` at each of the four places the driver or a referee touches
it: the examiner's red-at-BASE run executes it in `<clonesDir>/exam-<id>`; the pre-review
pass's `driver:exam-run` event (`iter: 0`) carries `cmd` equal to `task.testCmd`; the
review-round `driver:exam-run` event (`iter: 1`) carries the same `cmd`; and the reviewer's
prompt carries `EXAM EVIDENCE` with the line `$ <task.testCmd>`. M4. A task whose `testCmd`
contains none of its `proofTests` paths keeps that `testCmd` as its implementer's
`TEST COMMAND:` line, and a task with no `testCmd` receives `TEST COMMAND: <workerTestCmd>`,
both as at BASE. M5. The fix round's prompt carries `TEST COMMAND: <task.testCmd>` as at BASE,
for the pre-review repair `fix:<id>:0` and for the review-round fix `fix:<id>:1` alike — the
peer's exam is in the graded tree by then. M6. The run-wide sharer count that caps
`workerTestCmd` (#547) counts every task whose implementer is handed the run-wide command: a
wave of one task whose `testCmd` names its Proof path beside one task with no `testCmd` hands
both implementers `capWorkerParallelism(<run-wide command>, 2, cpus)`, and the same task
beside one whose `testCmd` names none of its Proof paths hands the first
`capWorkerParallelism(<run-wide command>, 1, cpus)` while the second keeps its own command.

**Authorized-by:** #663 ("Fix, two lines in one place"); #653 (the handoff whose shape makes
the exam command unrunnable in the implementer's tree); #551 (the exam is a peer's, never the
submitter's).

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** At BASE `testCmdLine(task, testCmd)` (`fleet/run-engine.mjs` line ~212) answers
`'\nTEST COMMAND: ' + (task.testCmd || testCmd)` — the task's own command whenever it has
one — and is called in three places with `workerTestCmd`: `commonInputs` (line ~799), which
both the examiner and the implementer receive after `roles.<x> + '\nBASE: ' + baseShaForTask`,
so the two prompts are byte-equal after their role texts; the pre-review repair prompt (line
~1128, label `fix:<id>:0`); and the review-round fix prompt (line ~1343, label
`fix:<id>:<iter>`). `proofTests` (line ~825) is the task's Proof `Test:` paths and
`examTestCmd` (line ~835) is `task.testCmd`; the compiler derives `task.testCmd` from those
paths (`derive_task_test_cmd`: `node <path>`, `python3 -m pytest -q <paths>`, `bun test
<paths>`, or the plan's `**Exam command:**` template with `{paths}` substituted), so "names a
Proof path" is the plain test that the `testCmd` string contains one of the `proofTests`
strings — a task whose `testCmd` was set some other way, or whose `proofTests` is empty,
keeps it. The examiner's red-at-BASE run is `sh(examTestCmd, examDir)` (line ~984); the
driver's `runExam(iter)` (line ~1075) is `sh(examTestCmd, cloneDir)` and appends
`{ kind: 'driver:exam-run', task, cmd: examTestCmd, exit, iter }` to `events.jsonl`; the
reviewer's prompt (line ~1185) ends with `examEvidenceBlock`, whose rendering is
`'\n\nEXAM EVIDENCE: …' + '\n\n$ ' + exam.cmd + '\nexit ' + exam.exit + '\n' + exam.stdout`
(line ~256). None of those four reads `commonInputs`, so the change is confined to what the
implementer's prompt says. `args.testCmd` is mandatory (line ~633, #96), so there is no
"no run-wide command" row. `workerTestCmd` (line ~585) is `capWorkerParallelism(testCmd,
runWideSharers, cpus)` where `runWideSharers` (line ~583) counts the tasks with no `testCmd`;
#547's stated rule is "divide by the workers that actually SHARE the run-wide command", and
an implementer handed the suite is one, so the same predicate that picks the implementer's
line picks the sharers — a task with its own non-Proof `testCmd` is still not one, which is
what `fleet/tests/test_run_engine_cap_width.mjs` pins (its tasks carry no `proofTests`, so
none of its expectations move). `capWorkerParallelism` touches only a command carrying
`-n auto`; `bash check.sh -n auto` is the shape that sim uses, and the helper repo's
`check.sh` ignores its arguments. Two existing sims pin the old byte-equality and move to the
new shape, never to a deleted assertion: `fleet/tests/test_run_engine_examiner.mjs` lines
~127–131 (`assert.equal(examTail, implTail, …)` and `examTail.includes('\nTEST COMMAND: bash
t1_test.sh')`) and `fleet/tests/test_run_engine_exam_together.mjs` line ~221 (the same
equality) — each becomes "equal except the TEST COMMAND line", with the examiner's line still
`bash t1_test.sh` and the implementer's `bash check.sh`. The sims build a run with
`rig({ repo, runDir, waves, stub, testCmd, extraArgs })` from `fleet/tests/_engine_helpers.mjs`
(`stub(prompt, opts, cwd)` receives the label in `opts.label` and the directory the real
`makeCwdFor` answers; `makeRepo` writes a `check.sh` that is green unless `BROKEN` exists;
the run-wide `testCmd` defaults to `bash check.sh`); a task entry is `{ id, title, files,
tier, review, writes, commutes, interfaces, testCmd, proofTests, proofRuns, body }`, the
`review:<id>:<iter>` stub sees the reviewer's prompt, and a reviewer reply carrying one
`blocking` issue buys `fix:<id>:1`. An exam script that appends `exam-run $(pwd)` to an
order file is how the examiner's clone run is observed: only `bash t1_test.sh` can write that
line, and the driver writes the sim's `events.jsonl` at `<runDir>/events.jsonl`. The fix
round's prompt keeps the exam command by design: after the handoff the Proof path is in its
tree, `fleet/roles/fix.md` tells it to run that exam, and #663 names no change there.
**BASE facts:** (generated at 4bd0f5c)
- `testCmd` at `fleet/run-engine.mjs:572` blob 762be27
- `proofTests` at `fleet/run-engine.mjs:825` blob 762be27
- `cmd` at `fleet/confine-hook.mjs:224` blob e0cd408
- `workerTestCmd` at `fleet/run-engine.mjs:585` blob 762be27
- `fleet/run-engine.mjs` blob 762be27
- `commonInputs` at `fleet/run-engine.mjs:799` blob 762be27
- `examTestCmd` at `fleet/run-engine.mjs:835` blob 762be27
- `derive_task_test_cmd` at `skills/ultrapowers/scripts/compile_plan.py:965` blob 18ad607
- `examEvidenceBlock` at `fleet/run-engine.mjs:256` blob 762be27
- `where` at `fleet/tests/test_doctor.mjs:394` blob 130b27c
- `fleet/tests/test_run_engine_cap_width.mjs` blob 9a1e799
- `capWorkerParallelism` at `fleet/run-engine.mjs:206` blob 762be27
- `fleet/tests/test_run_engine_examiner.mjs` blob e869dd4
- `fleet/tests/_engine_helpers.mjs` blob f929b25
- `makeCwdFor` at `fleet/run-waves.mjs:101` blob 350bb66
- `makeRepo` at `fleet/tests/_engine_helpers.mjs:21` blob f929b25
- `blocking` at `fleet/run-engine.mjs:1303` blob 762be27
- `fleet/roles/fix.md` blob d4c5f2e
- `T2` at `fleet/tests/test_run_engine_exam_evidence.mjs:246` blob 7ab5c73
- `fleet/tests/test_run_engine_exam_together.mjs` blob cdbb0df

**Proof:**
- Test: `fleet/tests/test_run_engine_implementer_suite.mjs`
- Legs: (a) with the rig's run-wide `bash check.sh` and a task `T1` whose `testCmd` is
  `bash t1_test.sh` and whose `proofTests` is `['t1_test.sh']`, the `impl:T1` prompt's only
  line beginning `TEST COMMAND: ` is exactly `TEST COMMAND: bash check.sh`, and no line of that
  prompt is `TEST COMMAND: bash t1_test.sh` [M1]; (b) the `exam:T1` prompt's only line
  beginning `TEST COMMAND: ` is exactly `TEST COMMAND: bash t1_test.sh`, the prompt opens with
  `examiner.md` verbatim, and its tail after the role text, with that one line replaced by the
  implementer's `TEST COMMAND: bash check.sh`, is byte-equal to the `impl:T1` prompt's tail
  after `implementer.md` [M2]; (c) with an examiner stub that writes a `t1_test.sh` appending
  `exam-run` and its working directory to an order file and exiting 0 only when `one.txt`
  exists, the order file holds a line whose directory is `<clonesDir>/exam-T1`, `events.jsonl`
  holds a `driver:exam-run` event for `T1` with `iter` 0 and `cmd` equal to `bash t1_test.sh`
  and one with `iter` 1 and the same `cmd`, and the `review:T1:1` prompt contains
  `EXAM EVIDENCE` followed by the line `$ bash t1_test.sh` and contains no line `$ bash
  check.sh` [M3]; (d) in a wave holding `T2` with `testCmd` `bash t2.sh` and `proofTests` `[]`
  and `T3` with no `testCmd` key, the `impl:T2` prompt's `TEST COMMAND:` line is exactly
  `TEST COMMAND: bash t2.sh` and the `impl:T3` prompt's is exactly `TEST COMMAND: bash
  check.sh` [M4]; (e) with an implementer stub that leaves `one.txt` absent so the pre-review
  exam is red, the `fix:T1:0` prompt's `TEST COMMAND:` line is exactly `TEST COMMAND: bash
  t1_test.sh`, and with a review stub whose first round returns one `blocking` issue, the
  `fix:T1:1` prompt's `TEST COMMAND:` line is the same string [M5]; (f) with the run-wide
  command `bash check.sh -n auto`, a wave of `T1` (as in the first leg) beside `T3` (no
  `testCmd`) hands both `impl:T1` and `impl:T3` the line `TEST COMMAND: ` followed by
  `capWorkerParallelism('bash check.sh -n auto', 2, os.cpus().length)`, and a wave of `T1`
  beside `T2` (`testCmd` `bash t2.sh`, `proofTests` `[]`) hands `impl:T1` the line
  `TEST COMMAND: ` followed by `capWorkerParallelism('bash check.sh -n auto', 1,
  os.cpus().length)` and `impl:T2` exactly `TEST COMMAND: bash t2.sh` [M6]; (g) the sim prints
  `ALL TESTS PASSED`.
- Run: node fleet/tests/test_run_engine_implementer_suite.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the sim's sentinel [M1] [M2] [M3] [M4] [M5] [M6].
- Run: node fleet/tests/test_run_engine_examiner.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the wave-0 examiner sim, its byte-equality pin moved to "equal except
  the TEST COMMAND line" [M1] [M2].
- Run: node fleet/tests/test_run_engine_exam_together.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the exam-together sim, its byte-equality pin moved the same way
  [M1] [M2].
- Run: node fleet/tests/test_run_engine_cap_width.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the width-cap sim, unchanged: a task with its own non-Proof `testCmd`
  is still not a sharer [M4] [M6].
- Run: node fleet/tests/test_run_engine_exam_evidence.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the exam-evidence sim, unchanged: the driver still runs the task's
  own `testCmd` and hands the referee its bytes [M3].
- Run: node fleet/tests/test_run_engine_pre_review.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the pre-review pass sim, unchanged: a task with no Proof path keeps
  the run-wide command in its fix prompt [M4] [M5].
- Run: node fleet/tests/test_run_engine_exam_fix_edit.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the fix-round edit sim, unchanged [M5].
- Run: node fleet/tests/test_run_engine_exam_edits.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the recorded-edit sim, unchanged [M3].
- Run: node fleet/tests/test_exam_edited_patches.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the patched-review sim, unchanged [M3].

**Stale-if:**
- path-absent: `fleet/tests/_engine_helpers.mjs`
- path-absent: `fleet/tests/test_run_engine_examiner.mjs`
- path-absent: `fleet/tests/test_run_engine_exam_together.mjs`
- issue-closed: #663

### Task 2: The implementer's step 2 names the peer's exam as the task's test

**Type:** implementation

**Files:**
- Modify: `fleet/roles/implementer.md`

**Claim:** step 2 says the peer's exam is the task's test — iterate against the suite, write
no test file of your own unless the task's Files name one (quoted from #663)
Machine: M1. The step-2 block of `fleet/roles/implementer.md` — the lines from the first
line beginning `2. ` up to, and not including, the next line beginning `3. `, which exists
after it — carries, with line breaks read as spaces and in this order, the phrases `exam is the task's test`, `iterate against the suite` and `write no test
file of your own unless the task's Files name one`. M2. Each of the three instructions to write tests of
its own is gone from the file, with line breaks read as spaces: `write tests of your own`,
`Confirm they fail`, and `put your own tests somewhere else`. M3. The file still carries `reserved for a peer's exam`, and the
inputs paragraph still names `TEST COMMAND` as the project's test command. M4. No shouted whole word (never, always or must in upper case) appears in the file, and
the two role sims that sweep `fleet/roles/` still pass.

**Authorized-by:** #663 ("step 2 says the peer's exam is the task's test — iterate against the
suite, write no test file of your own unless the task's Files name one"); #653 (which
reserved the Proof path and removed "write those tests exactly as given").

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** At BASE `fleet/roles/implementer.md` says in its inputs paragraph that TEST
COMMAND is "the project's test command" — true again once Task 1 lands, since the implementer
is handed the run-wide suite and never the exam command — and its step 2 reads "Restate what
the task requires you to prove — its acceptance criteria, or, when the body carries the
six-slot claims grammar, its Claim and the exams its Proof slot names (the Proof is the
contract you are graded by, not yours to write). Then write tests of your own that encode
them. Where the task specifies exact outputs, assert full expected values with equality, not
loose containment. Confirm they fail." Step 3 reads "Implement the minimum to make them pass,
refactor for clarity, and run the test command clean one final time." The paragraph after
step 4 begins "Every path the Proof's `Test:` line names is reserved for a peer's exam" and
ends "So put your own tests somewhere else, and expect the grading file to be one you never
saw. The missing implementation is your job; the measurement of it is not." The rewrite
keeps that paragraph's first sentence and its last two, drops "put your own tests somewhere
else", and makes step 2 say that the peer's exam is the task's test, that the implementer
iterates against the suite the TEST COMMAND runs, and that it writes no test file of its own
unless the task's Files name one; step 3's "make them pass" is reworded to fit (the suite,
not tests of its own). Register: the file addresses an agent, no shouted imperative, no
`adversarial`. `fleet/tests/test_roles_peer.mjs` sweeps every file under `fleet/roles/` for
`adversarial` and checks `README.md` lists `implementer.md`; `fleet/tests/test_roles_examiner.mjs`
pins that `examiner.md` does not carry `Implement the minimum to make them pass` — neither
reads a sentence of `implementer.md`, so both stay green through any wording that keeps the
register. The proof greps are scoped to the step-2 block (the lines from `2. ` to `3. `) so a
phrase surviving elsewhere in the file cannot satisfy them.
**BASE facts:** (generated at 4bd0f5c)
- `fleet/roles/implementer.md` blob 0a92a3d
- `fleet/tests/test_roles_peer.mjs` blob 4847687
- `README.md` blob b218e1f
- `fleet/tests/test_roles_examiner.mjs` blob b6643a7

**Proof:**
- Run: awk '/^2\. /{a=1} a&&/^3\. /{f=1} END{exit !f}' fleet/roles/implementer.md
- The previous bullet bounds the block: a line beginning with the step-3 number follows the
  line beginning with the step-2 number, so the next command's range closes there rather
  than at end of file; the leg fails when either line is absent [M1].
- Run: awk '/^2\. / && !seen {a=1; seen=1} /^3\. / {a=0} a' fleet/roles/implementer.md | tr '\n' ' ' | grep -q "exam is the task's test.*iterate against the suite.*write no test file of your own unless the task's Files name one"
- The previous bullet prints only the first step-2 block — from the first line beginning
  with the step-2 number up to and excluding the next line beginning with the step-3
  number, never reopening on a later numbered line — joins its lines with spaces, and
  requires the three phrases in order; the leg fails when any of the three is absent from
  that block or out of order, and a phrase in step 1, 3 or 4, on the step-3 line, or
  elsewhere in the file does not satisfy it [M1].
- Run: ! tr '\n' ' ' < fleet/roles/implementer.md | grep -q 'write tests of your own'
- The previous bullet is the first removed instruction: with line breaks read as spaces the
  phrase is absent from the whole file, and the leg fails when it survives anywhere in it,
  wrapped across lines or not [M2].
- Run: ! tr '\n' ' ' < fleet/roles/implementer.md | grep -q 'Confirm they fail'
- The previous bullet is the second removed instruction: with line breaks read as spaces it
  is absent from the whole file, the leg failing when it survives anywhere in it, wrapped or
  not [M2].
- Run: ! tr '\n' ' ' < fleet/roles/implementer.md | grep -q 'put your own tests somewhere else'
- The previous bullet is the third removed instruction: with line breaks read as spaces it
  is absent from the whole file, the leg failing when it survives anywhere in it, wrapped or
  not [M2].
- Run: tr '\n' ' ' < fleet/roles/implementer.md | grep -q "reserved for a peer's exam"
- The previous bullet is the kept reservation sentence [M3].
- Run: sed -n '1,/^Work red/p' fleet/roles/implementer.md | tr '\n' ' ' | grep -q "TEST COMMAND (the project's test command)"
- The previous bullet is the inputs paragraph's TEST COMMAND description, above the steps [M3].
- Run: ! grep -nE '\b(N[E]VER|A[L]WAYS|M[U]ST)\b' fleet/roles/implementer.md
- The previous bullet is the register pin: each of the three shouted words is absent as a
  whole word, and the leg fails when any one of them appears [M4].
- Run: node fleet/tests/test_roles_peer.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the roles-directory sweep [M4].
- Run: node fleet/tests/test_roles_examiner.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the examiner role sim [M4].

**Stale-if:**
- path-absent: `fleet/roles/implementer.md`
- path-absent: `fleet/tests/test_roles_peer.mjs`
- issue-closed: #663
