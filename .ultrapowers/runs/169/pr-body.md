Fixture run-23's second task built the exam helper's reload move, and the helper's own tests drive that move over pages built to fail; every such page wrote a mutant record into the task's directory exactly as a real exam does, so the driver read twelve exams with four survivors where the task had one exam whose mutant died. That misread put four hollow findings in the reviewer's brief, dispatched a reviewer the rule would have skipped, and printed `SURVIVED` on the pull request. After this the driver reads a task's mutant record through the list of state exams its plan actually names, and everything downstream of that record reads the same corrected set; a plan that names no state exam reads the directory as it does today.

**Merge-ready**

> The mutant reading a task is judged on comes only from the state exams that task's plan names, so a helper's own test rigs that run the exam machinery never show up as the task's survivors on the record, in the reviewer's brief, or on the pull request card.

| task | claim | exam | probes | mutant | suite |
|---|---|---|---|---|---|
| 1 | The mutant reading a task is judged on comes only from the state exams that task's plan names, so a helper's own test rigs that run the exam machinery never show up as the task's survivors on the record, in the reviewer's brief, or on the pull request card. | red at BASE → green | — | — | — |

Residuals: 7 from review

Amendments: none

<details><summary>Record</summary>

## fleet run-169 — gate-green

| | |
|---|---|
| verdict | `PASS` |
| target | `popmechanic/ultrapowers` at `935fe1974c7a3d2a1aff4260a5ab65067f0d680b` |
| engine | `935fe1974c7a3d2a1aff4260a5ab65067f0d680b` |
| plan | `.ultrapowers/plan.md` at `5180c3f1aaa3f23609021485067d410c421231aa` |
| branch | `ultra/integration-run-169` |
| vm | `fleet-r169-2609162321-f06a` |

### Checks

```json
{"mode": "gate", "stamp": "run-169", "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-169/report.json", "branch": "ultra/integration-run-169", "gateCheck": {"verdict": "PASS", "checks": [{"name": "report-parse", "ok": true, "detail": ""}, {"name": "clean-tree", "ok": true, "detail": ""}, {"name": "wave-merges", "ok": true, "detail": ""}, {"name": "head-match", "ok": true, "detail": ""}, {"name": "git-verified", "ok": true, "detail": ""}, {"name": "ancestry", "ok": true, "detail": ""}, {"name": "deliverables", "ok": true, "detail": ""}], "notes": [], "repo": "/home/exedev/target"}, "gateCheckExit": 0, "suite": {"passed": true, "unattributed": [], "output": "============================= test session starts ==============================\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\nrootdir: /home/exedev/target/.claude/ultrapowers/run-run-169/clones/integration\nconfigfile: pytest.ini\ntestpaths: tests\nplugins: xdist-3.4.0\ncreated: 3/3 workers\n3 workers [351 items]\n\n........................................................................ [ 20%]\n........................................................................ [ 41%]\n........................................................................ [ 61%]\n........................................................................ [ 82%]\n...............................................................          [100%]\n======================= 351 passed in 104.77s (0:01:44) ========================\n"}, "verdict": "PASS"}

```

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-169/.ultrapowers/runs/169/

- approve-receipt.json
- claude-version.txt
- engine.log
- events.jsonl
- frontier
- gate-receipt.json
- kata.jsonl
- pr-body.md
- publish-fold
- receipt.json
- report.json
- residuals.jsonl
- status.json
- transcripts

### Plan

https://github.com/popmechanic/ultrapowers/blob/ultra/plan/run-169/.ultrapowers/plan.md

### Residuals

- [ ] task 1 reviewer — undeclared amendment: sim arrangement in `fleet/tests/test_run_engine_review_economy.mjs`. The task's Context prescribes the r169 engine runs be built like the existing `survived` leg — an `exam:` arm that writes nothing, and "if the landing changes the exam command, keep `testCmd: EXAM_CMD`" (i.e. `bash a_test.sh`). The diff does neither for legs (c) and (g): `R169_EXAM_CMD = 'bash tests/state-exams/real.test.ts'` names the Proof path itself, and the `exam:` arm writes a real green script (`R169_GREEN_EXAM`) at the landing read out of the driver's `EXAM PATHS:` line. No AMENDMENTS entry declares it. The divergence is sound and should NOT be reverted: the sim's own banner records the measurement that forced it — an `exam:` arm writing nothing leaves `examBlobs` a truthy `[[landing, null]]`, so the exam is runnable, exits 127 on the absent file and parks the task `proof-red` before any review round, which would make leg (c)'s `skipped-mutant-killed` unreachable. So the Context's hint is the thing that is wrong, not the sim
- [ ] task 1 reviewer — the legs as written assert exactly what the Proof names, plus preconditions (`examPaths`, `examRuns === [[0,0]]`, `fixes === []`) that pin the arrangement. Recorded so the operator sees the plan text's hint is defective for the next plan that reuses it
- [ ] task 1 reviewer — the only thing the worker owed here was an `amends: sim` entry.
- [ ] task 1 reviewer — Name shadowing in `fleet/tests/test_run_engine_state_exams.mjs`: the patch adds `import * as engine from '../run-engine.mjs'` at module scope while the file already binds `const engine = fs.readFileSync(path.join(HERE, '..', 'run-engine.mjs'), 'utf8')` inside the task-4 leg (d) block (~line 399). Both are legal — the block-local const shadows the namespace only within that block, and the suite is green — but inside that one block `engine` means the engine's SOURCE TEXT and everywhere else it means the module namespace, which is a trap for the next task that extends this guarded file (a `engine.stateExamStemsOf` call moved into that block reads a string's property and yields `undefined` rather than throwing). The namespace import itself is correctly justified in the added comment: a named import of an export absent at BASE is a link-time SyntaxError that would take the whole file down before leg (a) could name it. Suggested fix: rename the import binding, e.g. `import * as engineModule from '../run-engine.mjs'` and `const stemsOf = engineModule.stateExamStemsOf` in the run-169 (a) block, leaving the task-4 block's `engine` alone.
- [ ] task 1 reviewer — unverified: the Claim's third consumer — "or on the pull request card". The diff corrects `tasks[].stateExams` at `fleet/run-engine.mjs` (the scoped `stateExamsOf(runDirAbs, r.task, stateExamStemsOf(...))` call), and the task's Context asserts the card's `mutant` cell at `fleet/sandbox-boot.sh` line 2629 reads exactly that field, so no boot file changes. That chain is plausible and is why `fleet/sandbox-boot.sh` is rightly absent from FILES, but nothing in this diff touches or exercises the card: leg (c)/(g) read `report.tasks[0].stateExams` and stop there. What would settle it: a read of `fleet/sandbox-boot.sh` around line 2629 confirming the `mutant` cell is derived solely from `report.tasks[].stateExams` (no second read of `<runDir>/state-exams/task-<id>/` of its own), or a sim leg rendering the card off a scoped report. Graded minor because no edit inside this task's FILES can settle a claim about a file outside them.
- [ ] task 1 reviewer — concern: Exam-rig caveat for legs (c) and (g), also left on the kata thread — a `proofTests` entry under `tests/state-exams/` makes `examMoves` land the exam at `tests/exams/<stamp>/state-exams/real.test.ts`, and the exam handoff then carries only that landing path. A rig whose `exam:` arm writes `a_test.sh` while `testCmd` is `bash a_test.sh` therefore hands off nothing, the exam exits 127, and the task parks before the review round is reached — which would make legs (c) and (g) red for a reason that is not this patch. Dropping `testCmd` entirely, as the existing leg (c) `survived` rig does with `mkTask('A', ['a.txt'])` and no exam command, makes all three M3 runs land exactly as the Claim specifies
- [ ] task 1 reviewer — I confirmed that out of tree. This is BASE behaviour of the exam landing, unchanged here, and both legs are satisfiable — a note for the exam author, not a defect.

</details>

