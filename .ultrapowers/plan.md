# The reviewer reads the exam's own run

**Grammar:** claims-v1

**Claim:** After this run, every per-task review reads the driver's own run of that task's
exam on the patched tree, so a verdict is never settled by reading the tests instead of
running them; and a patch that fails its own exam goes back for repair before any reviewer
sees it. (elicited)

**Goal:** Close #638: the per-task reviewer never sees the task's exam executed in the
task's clone — the driver runs the exam only at BASE (to prove it red), the suite runs on the
folded tree at the wave gate, and the referee settles the `Test:` legs "by reading". The
driver already executes every `Run:` and every `Check:` in the clone before and during
review and hands the referee the bytes; the exam joins that pass with the same shape: run at
`iter: 0`, red buys one repair round and a still-red task never reaches a referee, run again
fresh for each review round, and the output rides the review prompt as `EXAM EVIDENCE`.
One engine change and one paragraph in the reviewer role; nothing in the compiler, the
kernel, the boot script or the laptop side is touched.

**Tech Stack:** Node 24 ESM (`fleet/run-engine.mjs` and the sims under `fleet/tests/`,
each printing `ALL TESTS PASSED`), Markdown (`fleet/roles/reviewer.md`). Nothing is added
to any dependency file.

**Spec:** #638 (the candidate mechanism in the issue body: "the driver runs the Files block's
`Test:` paths (or the plan's testCmd scoped to them) in each clone before review and
attaches the output as RUN EVIDENCE, the way `Check:` and `Run:` already are"); Verification
Frontier map #525 (this is the run window's single novelty).

**Parallelization rationale:** One wave, width 1. The engine change and the reviewer
paragraph are one contract — the block the engine writes is the block the paragraph tells
the referee how to read — so splitting them would be a chain of two strangers with nothing
to hand between them. A one-task plan rides the fleet on the risk override: the change
touches the fix loop's termination path.

## Global Constraints

- The vendored kernel is byte-identical to BASE: `skills/ultrapowers/kernel/vendor/manyana.py`
  is sha-pinned on purpose and never patched.
- Check: test "$(git hash-object skills/ultrapowers/kernel/vendor/manyana.py)" = 0e0367d23d19cdf87a047bd7f5cd814698f75fc4
- The existing engine sims for the proof pass, the examiner and the review pair keep
  passing in every clone.
- Check: node fleet/tests/test_run_engine_proof_runs.mjs | grep -q 'ALL TESTS PASSED'
- Check: node fleet/tests/test_run_engine_pre_review.mjs | grep -q 'ALL TESTS PASSED'
- Check: node fleet/tests/test_run_engine_examiner.mjs | grep -q 'ALL TESTS PASSED'
- Check: node fleet/tests/test_run_engine_exam_edits.mjs | grep -q 'ALL TESTS PASSED'
- Check: node fleet/tests/test_run_engine_review_peer.mjs | grep -q 'ALL TESTS PASSED'
- Check: node fleet/tests/test_roles_peer.mjs | grep -q 'ALL TESTS PASSED'
- Check: node fleet/tests/test_run_engine.mjs | grep -q 'ALL TESTS PASSED'
- No shouted imperative (an all-caps MUST, NEVER or ALWAYS as a whole word) is added to
  `fleet/roles/reviewer.md`.
- No file outside the task's own Files block is edited; in particular the compiler, the
  preflight, `fleet/run-main.mjs`, `fleet/sandbox-boot.sh` and every other role file are
  byte-identical to BASE.

**Acceptance:** suite — the committed suite is the verification.

### Task 1: The exam runs in the clone, and the referee reads its bytes

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/run-engine.mjs`
- Modify: `fleet/roles/reviewer.md`
- Test: `fleet/tests/test_run_engine_exam_evidence.mjs`

**Claim:** Every per-task review reads the driver's own run of that task's exam on the
patched tree, so a verdict is never settled by reading the tests instead of running them;
and a patch that fails its own exam goes back for repair before any reviewer sees it.
(derived)
Machine: M1. For a task whose `testCmd` is a non-empty string and whose `proofTests` names
at least one path, the driver executes `testCmd` in the task's clone through its `sh` seam
after the implementer's patch and before any referee, as part of the pre-review pass
(`iter: 0`), and again once per review round (`iter: 1`, and `iter: 2` when a second round
happens), each execution recorded as `{ cmd, exit, stdout }` with stdout and stderr combined
and tail-truncated to 4,000 characters, and each appended to `events.jsonl` as one
`driver:exam-run` event carrying `task`, `cmd`, `exit` and `iter`. M2. The review prompt
carries an `EXAM EVIDENCE:` block — the command verbatim, `exit <n>`, the recorded output —
placed immediately after the `RUN EVIDENCE` block's position, and a task whose `testCmd` is
null or whose `proofTests` is empty gets no `driver:exam-run` event and no `EXAM EVIDENCE`
text anywhere in its review prompt. M3. A non-zero exit at the pre-review pass is a red
of the same standing as a red `Run:`: it is listed among the blocking issues of the one
`fix:<id>:0` round as `the Proof's exam failed: <cmd> — exit <n>` with the output, and a
task whose exam is still red after that round ends with `reviewVerdict: 'proof-red'` and no
reviewer dispatched; a non-zero exit at a review round makes that round `FIX_REQUIRED` with
a blocking issue naming the command and its exit code, whatever the reviewer's own verdict.
M4. `fleet/roles/reviewer.md` carries a paragraph that names `EXAM EVIDENCE` as the
driver's own execution of the task's exam in this task's clone on the patched tree, says an
exam whose evidence shows `exit 0` settles the legs its `Test:` paths establish so that
asking for its re-execution is not a finding, and says a non-zero one is the fix loop's.
M5. The exam at BASE and the recorded-edit rule are unchanged: `exam` still reads `red`,
`green-at-base` or `blocked` from the wave-0 run, and `examEdited` is still recorded the
same way — the existing examiner and exam-edit sims pass.

**Authorized-by:** #638; the operator's answer of 2026-09-04 ("red exams go to the fix
loop").

**Interfaces:**
- Consumes: none
- Produces: `examEvidenceBlock(exam: {cmd: string, exit: number, stdout: string} | null) -> string`

**Context:** The pass to extend is the driver's own `Run:`/`Check:` pass in
`fleet/run-engine.mjs` (comment `── the driver's own Run:/Check: pass ──`, line ~862 at
BASE): `runCommands(iter)` executes each `proofRuns` string with `sh(cmd, cloneDir)`,
records `{ cmd, exit, stdout: tail(r.stdout + r.stderr) }` and appends
`{ kind: 'driver:proof-run', task, cmd, exit, iter }`; `runChecks(iter)` is the `Check:`
twin. The pre-review pass (`prePass`, guarded today by `if (proofRuns.length ||
constraintChecks.length)`) collects `reds` with `RUN_FAIL(r)` / `CHECK_FAIL(c)` lines, buys
one `fix:<id>:0` round, repeats, and returns `reviewVerdict: 'proof-red'` when still red; the
review loop (`for (let iter = 1; iter <= 2; iter++)`) calls `runCommands(iter)` and
`runChecks(iter)` fresh each round and builds `reviewPrompt` as `roles.reviewer +
taskBodyBlock + PATCH + HEAD + BASE + filesLine + siblingsStr + globalConstraintsBlock +
interfacesLine + priorAdvisoriesBlock + [EXAM EDITED] + runEvidenceBlock(runEvidence) +
checkEvidenceBlock(checkEvidence)`, and after the verdict any non-zero `Run:` becomes a
blocking issue. The exam command is already in scope as `examTestCmd` (from `task.testCmd`,
line ~745) and the path list as `proofTests`; the guard for the exam pass is `proofTests.length
&& examTestCmd`, the same pair that dispatches the examiner. `runEvidenceBlock(runs)` (line
~238) is the model for `examEvidenceBlock`: empty input renders the empty string so a prompt
without an exam is byte-identical; the block text opens `EXAM EVIDENCE: the driver executed
this task's exam command itself, in this task's own clone, on the tree the patch above
describes — stdout and stderr combined, last 4,000 characters.` followed by `\n\n$ <cmd>\nexit
<n>\n<stdout>`. The reviewer role's paragraph goes directly after the `RUN EVIDENCE, when
present, …` paragraph in `fleet/roles/reviewer.md`, in the same register (no shouted
imperatives; the role files are read at dispatch, sizes reported and not gated). The sim
follows `fleet/tests/test_run_engine_proof_runs.mjs` (the rig, the canned agent seam whose
`kind` distinguishes `impl`, `exam`, `review`, `fix` and `critic`, the prompt capture, and
`events.jsonl` reads) and `fleet/tests/test_run_engine_examiner.mjs` (a task with `testCmd:
'bash t1_test.sh'` and `proofTests: ['t1_test.sh']`, the examiner stub writing a script that
is red at BASE); an implementer stub that writes the file the exam script checks makes the
exam green after the patch, one that does not makes it red. `sh` runs `bash -lc` with
`SHELL_TIMEOUT_MS`; `tail` is the engine's own 4,000-character truncation. Wave-0's
`atBase = await sh(examTestCmd, cloneDir)` and everything around `examEdited` stay as they
are.
**BASE facts:** (generated at cc5e24e)
- `testCmd` at `fleet/run-engine.mjs:554` blob dfed96e
- `proofTests` at `fleet/run-engine.mjs:786` blob dfed96e
- `sh` at `fleet/run-engine.mjs:501` blob dfed96e
- `task` at `fleet/run-engine.mjs:1620` blob dfed96e
- `cmd` at `fleet/confine-hook.mjs:224` blob e0cd408
- `fleet/roles/reviewer.md` blob 9384c5d
- `exam` at `fleet/run-engine.mjs:805` blob dfed96e
- `blocked` at `fleet/run-engine.mjs:1284` blob dfed96e
- `examEdited` at `fleet/run-engine.mjs:854` blob dfed96e
- `fleet/run-engine.mjs` blob dfed96e
- `proofRuns` at `fleet/run-engine.mjs:793` blob dfed96e
- `prePass` at `fleet/run-engine.mjs:955` blob dfed96e
- `reviewPrompt` at `fleet/run-engine.mjs:1027` blob dfed96e
- `examTestCmd` at `fleet/run-engine.mjs:796` blob dfed96e
- `fleet/tests/test_run_engine_proof_runs.mjs` blob 3e2a973
- `kind` at `fleet/lobby.mjs:399` blob 8239e76
- `impl` at `fleet/run-engine.mjs:869` blob dfed96e
- `review` at `fleet/run-engine.mjs:1061` blob dfed96e
- `fix` at `fleet/tests/test_roles_peer.mjs:48` blob 4847687
- `critic` at `fleet/run-main.mjs:641` blob d0a320f
- `fleet/tests/test_run_engine_examiner.mjs` blob 01312f9
- `SHELL_TIMEOUT_MS` at `fleet/run-engine.mjs:411` blob dfed96e
- `tail` at `fleet/run-engine.mjs:439` blob dfed96e

**Proof:**
- Test: `fleet/tests/test_run_engine_exam_evidence.mjs`
- Legs: (a) a task with `testCmd: 'bash t1_test.sh'` and `proofTests: ['t1_test.sh']`, an
  examiner stub writing a `t1_test.sh` that exits 0 only when `out.txt` exists, and an
  implementer stub that creates `out.txt`: `events.jsonl` carries `driver:exam-run` events
  for that task with `cmd` equal to `bash t1_test.sh`, `exit` 0, and `iter` values 0 and 1
  in that order, each after the implementer's `impl` event and the `iter: 0` one before any
  `review:` dispatch; the recorded output carries both a line the script printed to stdout
  and a distinguishable line it printed to stderr; and it is truncated at 4,000 characters
  when a script prints 5,000 [M1]; (b) the captured review prompt for that task
  contains `EXAM EVIDENCE:` followed by `$ bash t1_test.sh`, `exit 0` and the script's
  output, positioned after the `RUN EVIDENCE` text when the task also carries a `proofRuns`
  entry and before `CHECK EVIDENCE` when a `Check:` constraint is present; and a sibling
  task with `testCmd: null` and `proofTests: []` gets no `EXAM EVIDENCE:` text, no
  `driver:exam-run` event, and a review prompt with no `EXAM EVIDENCE` text anywhere in it
  [M2]; (c) with an implementer stub that does not create `out.txt`
  and a fix stub that does not either, the run dispatches one agent labelled `fix:<id>:0`
  whose prompt contains `the Proof's exam failed: bash t1_test.sh — exit 1`, dispatches no
  agent whose label begins `review:`, and the task's row reads `reviewVerdict: 'proof-red'`;
  with a fix stub that does create `out.txt`, the task reaches review with `exit 0` in its
  `EXAM EVIDENCE`; and with an implementer that creates `out.txt` but a review-round rerun
  made red by a `t1_test.sh` that also requires `round2.txt`, which only the fix stub
  creates, round 1 is `FIX_REQUIRED` with a blocking issue naming `bash t1_test.sh` and
  `exit 1` although the canned reviewer answered `PASS`, and round 2 then records a
  `driver:exam-run` event with `iter` 2 and `exit` 0 [M1] [M3]; (d) the reviewer role file's
  paragraph is read with wraps joined: it contains `EXAM EVIDENCE`, `exit 0`, and `not a
  finding` in that order [M4]; (e) the examiner and exam-edit sims pass unchanged [M5]; (f)
  the sim prints `ALL TESTS PASSED`.
- Run: node fleet/tests/test_run_engine_exam_evidence.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the new sim's sentinel [M1] [M2] [M3].
- Run: tr '\n' ' ' < fleet/roles/reviewer.md | grep -q "EXAM EVIDENCE.*in this task's clone.*exit 0.*not a finding"
- The previous bullet is the role paragraph, wraps joined, its four phrases in order — the
  definition (the driver's own run in this task's clone), the settled case, and the rule
  that a re-execution request is not a finding [M4].
- Run: tr '\n' ' ' < fleet/roles/reviewer.md | grep -q "EXAM EVIDENCE[^.]*fix loop's"
- The previous bullet is the paragraph's non-zero sentence [M4].
- Run: node fleet/tests/test_run_engine_examiner.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the wave-0 exam's own sim [M5].
- Run: node fleet/tests/test_run_engine_exam_edits.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the recorded-edit rule's sim [M5].

**Stale-if:**
- path-absent: `fleet/tests/test_run_engine_proof_runs.mjs`
- path-absent: `fleet/tests/test_run_engine_examiner.mjs`
- issue-closed: #638
