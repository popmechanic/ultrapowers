This brings two readers of a run up to date with the engine that has driven runs since run-133: the report reference that says what each field of a finished run's report means, and the status page's projection of a task that is waiting on a sibling. It exists because run-133's examiner found both still telling the old story — the reference describing wave-loop rows the engine no longer writes, and the page calling a task "failed" while the engine was only holding it for a sibling to land. After this run a reader of a report finds the words that match the file in their hand, and a watcher of a live run sees "waiting" with the sibling's name instead of a false failure.

**Parked:** parked: gate verdict BLOCKED

> `report-format.md` describes the report the engine writes on `597c6db1`: `waveMerges` one row per epoch (`wave` = the epoch), `unfinished` for every task that never became ready with its reason, no `SKIPPED` cascade rows, no wave-position judgment call.

| task | claim | exam | probes | mutant | suite |
|---|---|---|---|---|---|
| 1 | `report-format.md` describes the report the engine writes on `597c6db1`: `waveMerges` one row per epoch (`wave` = the epoch), `unfinished` for every task that never became ready with its reason, no `SKIPPED` cascade rows, no wave-position judgment call. | none | — | — | — |
| 2 | A `driver:re-edged` event moves the task's page state to `queued` (or a new `waiting` value, decided at authoring) and records `blockedBy` beside it, so a re-edged task never reads `failed`; a `BLOCKED` `worker:end` with no `driver:re-edged` after it still reads `failed`. | red at BASE → green | — | — | — |

Residuals: none

<details><summary>Record</summary>

## fleet run-138 — parked

| | |
|---|---|
| verdict | `BLOCKED` |
| target | `popmechanic/ultrapowers` at `a94143bb79f780a63e41e751418b9a3d3a9d2db2` |
| engine | `a94143bb79f780a63e41e751418b9a3d3a9d2db2` |
| plan | `.ultrapowers/plan.md` at `c54678ca643589ecdabcd4a6fc96164ef005ef56` |
| branch | `ultra/integration-run-138` |
| vm | `fleet-r138-2609150924-1fb4` |

### Checks

```json
{"mode": "gate", "stamp": "run-138", "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-138/report.json", "branch": "ultra/integration-run-138", "gateCheck": {"verdict": "BLOCKED", "checks": [{"name": "report-parse", "ok": true, "detail": ""}, {"name": "clean-tree", "ok": true, "detail": ""}, {"name": "wave-merges", "ok": true, "detail": ""}, {"name": "head-match", "ok": true, "detail": ""}, {"name": "git-verified", "ok": true, "detail": ""}, {"name": "ancestry", "ok": true, "detail": ""}, {"name": "deliverables", "ok": false, "detail": "failed/blocked tasks left declared deliverables unproduced: [{\"task\": \"1\", \"files\": [\"skills/ultrapowers/references/report-format.md\"]}]"}], "notes": [], "repo": "/home/exedev/target"}, "gateCheckExit": 1, "suite": {"passed": true, "unattributed": [], "output": "============================= test session starts ==============================\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\nrootdir: /home/exedev/target/.claude/ultrapowers/run-run-138/clones/integration\nconfigfile: pytest.ini\ntestpaths: tests\nplugins: xdist-3.4.0\ncreated: 3/3 workers\n3 workers [154 items]\n\n........................................................................ [ 46%]\n........................................................................ [ 93%]\n..........                                                               [100%]\n============================= 154 passed in 32.30s =============================\n"}, "verdict": "BLOCKED"}

```

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-138/.ultrapowers/runs/138/

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

https://github.com/popmechanic/ultrapowers/blob/ultra/plan/run-138/.ultrapowers/plan.md

</details>

Closes #986
Closes #987
