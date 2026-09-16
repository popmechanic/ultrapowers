This closes the gap run-159 fell through: a worker dispatched on an older tree said it was blocked on a sibling, that sibling had already landed by the time the worker returned, and the engine read the block as a failure rather than a reason to try again. After this, the engine compares the sibling against the tree the worker was actually handed, so a block on work that arrived later re-dispatches the task on the current tree, exactly as a block on work still in flight already waits for it. A task like run-159's task 7 lands instead of dying not-reviewed, and no run pays a relaunch for it.

**Merge-ready**

> A task whose worker reports it is blocked on a sibling that has landed since the task was sent out is sent out again on the tree that carries that sibling, instead of failing.

| task | claim | exam | probes | mutant | suite |
|---|---|---|---|---|---|
| 1 | A task whose worker reports it is blocked on a sibling that has landed since the task was sent out is sent out again on the tree that carries that sibling, instead of failing. | red at BASE → green | — | — | — |

Residuals: none

Amendments: 1 from workers

- task 1 — clause: Context's "Write the new scenario as (d.5) ... whole in the guarded file" and "the header comment's M4 restatement (lines 26–34) should be re-read": I made no edit to fleet/tests/test_run_engine_re_edge.mjs. The file is the Proof's `Test:` path, reserved for the peer's exam and laid over my tree by the driver. I built the (d.5) shape in a scratch copy at fleet/tests/_scratch_d5.mjs instead, ran it, and deleted it before committing — it is not in the diff. — The harness rule that the exam is the peer's and never mine overrides the task body's instruction to write it; a scenario I wrote there would be discarded at handoff. The scratch copy gave me the same red→green signal: against the BASE engine the (d.5a) leg fails 0 !== 1 `driver:re-edged` with B's dispatch reading the head before A's adoption and A landing during `anchorClone`; with the change both the M1 leg and the M2 plan-edge counterpart pass.

<details><summary>Record</summary>

## fleet run-163 — gate-green

| | |
|---|---|
| verdict | `PASS` |
| target | `popmechanic/ultrapowers` at `cf289581ebe2fa8dc23a8683c6d4e31c835d2ae2` |
| engine | `cf289581ebe2fa8dc23a8683c6d4e31c835d2ae2` |
| plan | `.ultrapowers/plan.md` at `8cb252db133c51d1dc669ee8c9b7946c516dc82c` |
| branch | `ultra/integration-run-163` |
| vm | `fleet-r163-2609161731-daec` |

### Checks

```json
{"mode": "gate", "stamp": "run-163", "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-163/report.json", "branch": "ultra/integration-run-163", "gateCheck": {"verdict": "PASS", "checks": [{"name": "report-parse", "ok": true, "detail": ""}, {"name": "clean-tree", "ok": true, "detail": ""}, {"name": "wave-merges", "ok": true, "detail": ""}, {"name": "head-match", "ok": true, "detail": ""}, {"name": "git-verified", "ok": true, "detail": ""}, {"name": "ancestry", "ok": true, "detail": ""}, {"name": "deliverables", "ok": true, "detail": ""}], "notes": [], "repo": "/home/exedev/target"}, "gateCheckExit": 0, "suite": {"passed": true, "unattributed": [], "output": "============================= test session starts ==============================\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\nrootdir: /home/exedev/target/.claude/ultrapowers/run-run-163/clones/integration\nconfigfile: pytest.ini\ntestpaths: tests\nplugins: xdist-3.4.0\ncreated: 3/3 workers\n3 workers [281 items]\n\n........................................................................ [ 25%]\n........................................................................ [ 51%]\n........................................................................ [ 76%]\n.................................................................        [100%]\n======================== 281 passed in 79.90s (0:01:19) ========================\n"}, "verdict": "PASS"}

```

## Publish fold

- attempt 1: conflict parked on fleet/run-engine.mjs

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-163/.ultrapowers/runs/163/publish-fold/receipt.json

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-163/.ultrapowers/runs/163/

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
- status.json
- transcripts

### Plan

https://github.com/popmechanic/ultrapowers/blob/ultra/plan/run-163/.ultrapowers/plan.md

</details>

Closes #1057
