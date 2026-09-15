This brings the report reference up to date with the engine that has driven runs since run-133, so a reader of a finished run's report finds the words that match the file in their hand. It exists because run-138 parked on this one task: its reviewer found one sentence in the rewrite that told a reader a red-baseline run carries no fold rows at all, when the engine writes exactly one, and the fix round did not repair it. After this run the reference says what each field is, including that one row, and nothing in it describes the wave loop any more.

**Parked:** parked: gate verdict NEEDS_ACK

> `report-format.md` describes the report the engine writes on `597c6db1`: `waveMerges` one row per epoch (`wave` = the epoch), `unfinished` for every task that never became ready with its reason, no `SKIPPED` cascade rows, no wave-position judgment call.

| task | claim | exam | probes | mutant | suite |
|---|---|---|---|---|---|
| 1 | `report-format.md` describes the report the engine writes on `597c6db1`: `waveMerges` one row per epoch (`wave` = the epoch), `unfinished` for every task that never became ready with its reason, no `SKIPPED` cascade rows, no wave-position judgment call. | none | — | — | — |

Residuals: 6 from review

<details><summary>Record</summary>

## fleet run-139 — parked

| | |
|---|---|
| verdict | `NEEDS_ACK` |
| target | `popmechanic/ultrapowers` at `680a6b0e8b42ab4370874bebe536e1493e3b029f` |
| engine | `680a6b0e8b42ab4370874bebe536e1493e3b029f` |
| plan | `.ultrapowers/plan.md` at `d59e1f78df4e7e38cabdc567bc5f4d3fdae1cee7` |
| branch | `ultra/integration-run-139` |
| vm | `fleet-r139-2609150939-db6c` |

### Checks

```json
{"mode": "gate", "stamp": "run-139", "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-139/report.json", "branch": "ultra/integration-run-139", "gateCheck": {"verdict": "NEEDS_ACK", "checks": [{"name": "report-parse", "ok": true, "detail": ""}, {"name": "clean-tree", "ok": true, "detail": ""}, {"name": "wave-merges", "ok": true, "detail": ""}, {"name": "head-match", "ok": true, "detail": ""}, {"name": "git-verified", "ok": true, "detail": ""}, {"name": "ancestry", "ok": true, "detail": ""}, {"name": "deliverables", "ok": true, "detail": ""}], "notes": [], "repo": "/home/exedev/target"}, "gateCheckExit": 2, "suite": {"passed": true, "unattributed": [], "output": "============================= test session starts ==============================\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\nrootdir: /home/exedev/target/.claude/ultrapowers/run-run-139/clones/integration\nconfigfile: pytest.ini\ntestpaths: tests\nplugins: xdist-3.4.0\ncreated: 3/3 workers\n3 workers [173 items]\n\n........................................................................ [ 41%]\n........................................................................ [ 83%]\n.............................                                            [100%]\n============================= 173 passed in 38.89s =============================\n"}, "verdict": "NEEDS_ACK"}

```

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-139/.ultrapowers/runs/139/

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

https://github.com/popmechanic/ultrapowers/blob/ultra/plan/run-139/.ultrapowers/plan.md

### Residuals

- [ ] task 1 reviewer — Residual wave-loop vocabulary the task's Context did not enumerate, so the diff rightly leaves it: the `frontier` row still reads "One entry per wave that took the contended merge path", "`wave` (1-based wave number)" and "every `--overlap serialize` compile, where no wave can contain intersecting `files`". Under ready-set dispatch a `frontier` entry is keyed by the same fold ordinal the rest of the file now calls an epoch, and an epoch is whatever the ready set produced, so the serialize sentence's guarantee is about the plan's layering, not about what one fold contains. Out of this task's FILES-scoped exam (no Machine clause or `Run:` touches the row)
- [ ] task 1 reviewer — worth a follow-up sweep of that row rather than an edit here.
- [ ] task 1 reviewer — The retired vocabulary this task removes from the reference survives in a consumer outside FILES: `skills/ultrapowers/scripts/gate_check.py:137` still explains the failed `wave-merges` guard as "(budget-exhausted or SKIPPED-only run)", two run shapes this engine no longer produces. The guard's behaviour is correct and matches the row's new sentence (it blocks when `waveMerges[last].headSha` is missing, which is exactly the red-baseline row's shape)
- [ ] task 1 reviewer — only the operator-facing message is stale. Not fixable inside this task's FILES.
- [ ] task 1 reviewer — plan-defect: plan-defect: the rewritten `waveMerges` row (skills/ultrapowers/references/report-format.md, the line beginning "| `waveMerges` |") ends "The array is empty only for a run interrupted before any fold ran." That "only" is false of the engine at BASE in two non-interrupted paths: `foldEpoch` returns before pushing any row when it is handed nothing (`fleet/run-engine.mjs:3697`, `if (merged.length === 0) return`) and only mergeable results ever reach `pendingResults` (`:3678`), so a run whose every task failed completes normally with an empty `waveMerges`
- [ ] task 1 reviewer — and a dependency cycle pushes the binding judgment call at `:1704` and dispatches no task at all, so nothing is captured and again no row is pushed. The wrong sentence is dictated by the task's own Context ("the array is empty only for a run interrupted before any fold"), so this is a defect faithfully transcribed from the plan — but its fix lies inside this task's own FILES and the exam does not stand in the way: M6 only forbids "may be absent" and "a red baseline leaves it empty", and the eighteenth Run:'s ordered pattern still matches a sentence that keeps "empty only" ahead of "interrupted before any fold". This is the same species of error M6 exists to remove (run-138's over-broad claim about when the array is empty), just in the other direction: a reader who finds an empty array would conclude the run was interrupted. Everything else the row now says checks out against the engine — the fold push's field list (`:3731`-`:3748`, `joined` and the conditional `suite`, no `command`), the red-baseline park's four keys (`:3513`), and the Step-5 guard that blocks on a last row with no `headSha` (`skills/ultrapowers/scripts/gate_check.py:132`).

</details>

Closes #986
