This run finishes the engine plan. The implementer is handed its own task's proofs instead of the whole suite, and a launch that has to take the next run number recompiles under it so its fact sheets name the right exam directory. It exists because run-127 landed three of its four tasks and left these two halves, and the first of them is the one that moves the clock.

**Merge-ready**

> After this run, when I replay run-67, each implementer runs only its own task's proofs, and a launch whose run number bumps files its sheets under the number it actually got.

| task | claim | exam | probes | mutant | suite |
|---|---|---|---|---|---|
| 1 | After this run an implementer is handed its own task's proofs and iterates against those, never against the whole suite. | red at BASE → green | — | — | — |
| 2 | After this run a launch that has to take the next run number recompiles under it, so the sheets it files on the hub name the exam directory the sandbox will actually use. | red at BASE → green | — | — | — |

Residuals: 5 from review

<details><summary>Record</summary>

## fleet run-128 — gate-green

| | |
|---|---|
| verdict | `PASS` |
| target | `popmechanic/ultrapowers` at `14bf65a604c8850a55bc7c206aade32ff2006054` |
| engine | `14bf65a604c8850a55bc7c206aade32ff2006054` |
| plan | `.ultrapowers/plan.md` at `13cd3f5a71bd791a3e00ee406d382cd3fba4a02f` |
| branch | `ultra/integration-run-128` |
| vm | `fleet-r128-2609141959-cf55` |

### Checks

```json
{"mode": "gate", "stamp": "run-128", "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-128/report.json", "branch": "ultra/integration-run-128", "gateCheck": {"verdict": "PASS", "checks": [{"name": "report-parse", "ok": true, "detail": ""}, {"name": "clean-tree", "ok": true, "detail": ""}, {"name": "wave-merges", "ok": true, "detail": ""}, {"name": "head-match", "ok": true, "detail": ""}, {"name": "git-verified", "ok": true, "detail": ""}, {"name": "ancestry", "ok": true, "detail": ""}, {"name": "deliverables", "ok": true, "detail": ""}], "notes": [], "repo": "/home/exedev/target"}, "gateCheckExit": 0, "suite": {"passed": true, "unattributed": [], "output": "============================= test session starts ==============================\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\nrootdir: /home/exedev/target/.claude/ultrapowers/run-run-128/clones/integration\nconfigfile: pytest.ini\ntestpaths: tests\nplugins: xdist-3.4.0\ncreated: 3/3 workers\n3 workers [134 items]\n\n........................................................................ [ 53%]\n..............................................................           [100%]\n============================= 134 passed in 39.76s =============================\n"}, "verdict": "PASS"}

```

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-128/.ultrapowers/runs/128/

- approve-receipt.json
- claude-version.txt
- engine.log
- events.jsonl
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

https://github.com/popmechanic/ultrapowers/blob/ultra/plan/run-128/.ultrapowers/plan.md

### Residuals

- [ ] task 1 reviewer — Examiner fallback lost the concurrency cap. At BASE the examiner's line was `testCmdLine(examCmdTask, workerTestCmd)` (fleet/run-engine.mjs:1838) — when a task has proofTests but no `testCmd` of its own, `examCmdTask` is the task itself and the line falls back to the run-wide command, which was the capped `workerTestCmd`. The diff rewrites that to `testCmdLine(examCmdTask, testCmd)`, so in that fallback the examiner is now handed the uncapped run-wide command (`-n auto` restored). The implementer had no choice: M4 requires `capWorkerParallelism`/`runWideSharers` deleted, while the Context says to leave `testCmdLine(examCmdTask, …)` 'exactly as they are' — the two cannot both hold once `workerTestCmd` is gone, and the diff resolves it the only way available and discloses the reasoning in the new comment at the `proofsBlock` site ('Nobody shares a command here'). Reachability is narrow: the compiler's `derive_task_test_cmd` gives every peer-reviewed task its own command, so the fallback is only taken by a task carrying a Proof `Test:` path and no `testCmd`. Recorded for the operator
- [ ] task 1 reviewer — no edit inside this task's FILES can restore the cap without reintroducing a symbol M4 forbids. M3 ('unchanged from BASE') is still satisfied for every task the exam and the review-economy byte-identity pin exercise — S1 asserts the examiner's single `TEST COMMAND:` line names the exam command, and `test_run_engine_review_economy.mjs` asserts every non-`impl:` prompt is byte-identical to BASE's, both green.
- [ ] task 2 reviewer — fleet/launch.mjs:1084-1103 — the billing-capacity refusal is computed from `firstSize` (the first N's compile) while the `new` verb at :1161/:1177 asks for `sizeFromCompile(plan.compiled)`, the winning N's. In production the two are equal, because `--stamp` changes only reserved exam paths and not the waves, and the comment at :1090-1092 discloses exactly that. It is worth naming anyway because this task's own exam deliberately builds a world where they differ (run-1 waves 2/10/1 -> 6/8GB, run-2 waves 2/4/1 -> 4/6GB): if a future compiler ever made the widest wave stamp-dependent, a bumped launch would issue `new` with a size the `billing plan --json` check never saw, and by then the plan branch is pushed and the hub filed, so the launcher's own Refusal is no longer available — only the lobby's raw error. No patch proposed: re-refusing after the push would trade a clean pre-mutation refusal for a post-mutation one. If you want the invariant enforced rather than assumed, the cheap form is comparing `sizeFromCompile(plan.compiled)` to `firstSize` at :1161 and refusing only when they disagree.
- [ ] task 2 reviewer — fleet/launch.mjs:1071 — `sizeFromCompile (payload)` names its parameter `payload`, but what it is handed is the whole `compilePlanForRun` answer `{ stamp, payload, waves, edges }` (:674-679), which itself has a `payload` key holding the raw compiler JSON. Inside the function `payload.waves` is the compile's normalised waves, while `payload.payload.launch_waves` is the thing the name suggests. `fileRunOnHub` calls the same object `compiled`
- [ ] task 2 reviewer — using that name here too would remove the collision.

</details>

Closes #515
Closes #547
