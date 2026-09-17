Three questions about a calibrated second reader cannot be answered from the tags because the input it needs only exists while a run is live. This plan has the driver record one snap judgment beside every blocking finding, every task's tier and every red suite, and act on none of it. After five runs the record says whether a second opinion, a difficulty read or a whose-red-is-it read is worth wiring in; the rollback is deleting the three appends.

**Parked:** parked: gate verdict BLOCKED

> Each is one `POST /v1/systemone` from the driver, appended to `events.jsonl` under a kind of its own, mirrored to the kata run issue like every driver row, and read by nothing in this ticket.

| task | claim | exam | probes | mutant | suite |
|---|---|---|---|---|---|
| 1 | do: run a plan on a fleet VM that carries the `typesafe` http-proxy; see: the engine can put one question set to Jev at the edge hostname and get its answers back with no key on disk or in argv, a call the edge does not answer costs one log line and nothing else, a `jev:` row lands on the task's or the run's hub issue exactly where a `driver:` row would, and on the laptop and in every sim no call is made at all. | red at BASE → green | — | — | — |
| 2 | do: run a plan where a reviewer returns a blocking finding; see: beside that finding on the record and on the task's hub issue, one `jev:finding` row carrying the finding's dedup key and Jev's four answers — borne out by the hunks it names, who must act, whether the Claim would be false, whether it is fixable inside Files in one round — while the review's verdict, its routing, the fix round and the task's status are exactly what they were without the row. | none | — | — | — |
| 3 | do: run a plan; see: beside every task on the record and on its hub issue, one `jev:tier` row at dispatch naming the tier the plan chose and Jev's difficulty read of the task text, and one more at each review dispatch carrying Jev's read of how hard the captured patch is to review — while the model every worker ran on, the reviewer's model and every task's verdict are exactly what they were without the rows. | none | — | — | — |
| 4 | do: run a plan whose fold turns a test red that no task of the plan names; see: on the record and on the run's hub issue, one `jev:suite-red` row for that fold naming each red path with Jev's read of which task's change caused it and whether it is an artifact of the harness — while the candidate is adopted, recorded and left un-reconciled exactly as it was without the row. | none | — | — | — |
| 5 | do: open `CLAUDE.md` after this run and read the no-metered-API gotcha; see: two lines at its end saying that TypeSafe at `api.typesafe.ai` is reached the same way — as the `typesafe` http-proxy at the edge, by the boot and the engine only, for judgments over prose and the hunks they name, never generation and never a fact — with no number in the bullet and nothing else in the file about it. | none | — | — | — |

Residuals: 6 from review

Amendments: none

<details><summary>Record</summary>

## fleet run-177 — parked

| | |
|---|---|
| verdict | `BLOCKED` |
| target | `popmechanic/ultrapowers` at `6104ae7e472121485d37287a5b10f501090dd838` |
| engine | `6104ae7e472121485d37287a5b10f501090dd838` |
| plan | `.ultrapowers/plan.md` at `3ababf11dc06d11e1e5143193ac97fddf6a0e306` |
| branch | `ultra/integration-run-177` |
| vm | `fleet-r177-2609170725-b673` |

### Checks

```json
{"mode": "gate", "stamp": "run-177", "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-177/report.json", "branch": "ultra/integration-run-177", "gateCheck": {"verdict": "BLOCKED", "checks": [{"name": "report-parse", "ok": true, "detail": ""}, {"name": "clean-tree", "ok": true, "detail": ""}, {"name": "wave-merges", "ok": true, "detail": ""}, {"name": "head-match", "ok": true, "detail": ""}, {"name": "git-verified", "ok": true, "detail": ""}, {"name": "ancestry", "ok": true, "detail": ""}, {"name": "deliverables", "ok": false, "detail": "failed/blocked tasks left declared deliverables unproduced: [{\"task\": \"2\", \"files\": [\"fleet/run-engine.mjs\", \"fleet/tests/test_run_engine_jev_finding.mjs\"]}, {\"task\": \"4\", \"files\": [\"fleet/run-engine.mjs\", \"fleet/tests/test_run_engine_jev_suite_red.mjs\"]}, {\"task\": \"3\", \"files\": [\"fleet/run-engine.mjs\", \"fleet/tests/test_run_engine_jev_tier.mjs\"]}]"}], "notes": [], "repo": "/home/exedev/target"}, "gateCheckExit": 1, "suite": {"passed": true, "unattributed": [], "output": "============================= test session starts ==============================\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\nrootdir: /home/exedev/target/.claude/ultrapowers/run-run-177/clones/integration\nconfigfile: pytest.ini\ntestpaths: tests\nplugins: xdist-3.4.0\ncreated: 3/3 workers\n3 workers [438 items]\n\n........................................................................ [ 16%]\n........................................................................ [ 32%]\n........................................................................ [ 49%]\n........................................................................ [ 65%]\n........................................................................ [ 82%]\n........................................................................ [ 98%]\n......                                                                   [100%]\n======================= 438 passed in 172.96s (0:02:52) ========================\n"}, "verdict": "BLOCKED"}

```

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-177/.ultrapowers/runs/177/

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

https://github.com/popmechanic/ultrapowers/blob/ultra/plan/run-177/.ultrapowers/plan.md

### Residuals

- [ ] task 1 reviewer — plan-defect: `fakeHub` in `fleet/tests/_engine_helpers.mjs` is a verbatim ~60-line duplicate of `makeFakeKata` in `fleet/tests/test_run_engine_state_handshake.mjs` (BASE lines 269-331) — identical store seeding, identical six client methods, identical `calls`/`of`/`commentsOn`/`post`, differing only in the `need()` error string ('fake hub' vs 'fake kata'). Two copies of a hub fake will drift the moment the client grows a method, and a sim that fails against one will pass against the other. This is the task's own instruction ('lifted verbatim under the new name
- [ ] task 1 reviewer — the handshake sim keeps its own copy and is not touched'), so the implementer transcribed it faithfully and the diff is correct as specified
- [ ] task 1 reviewer — the fix — deleting `makeFakeKata` and importing `fakeHub` from `./_engine_helpers.mjs` — lies in `fleet/tests/test_run_engine_state_handshake.mjs`, which is outside this task's FILES, so it is minor and belongs to a later task's text rather than this diff. Nothing to change here.
- [ ] task 1 reviewer — unverified: the global constraint 'for the same canned replies a run with the `jev` seam and a run without it dispatch the same labels in the same order and end with the same task statuses' is only half-settled by this diff. What this patch can settle, it does: `jevRow` has no caller here, so the seam appends nothing, and leg (g) of `fleet/tests/test_jev_client.mjs` runs the same one-task plan to `done` with a live `jev`, with a broken `jev` (rejecting before any dispatch) and with no `jev` at all. What it cannot settle is the label-order half once rows are actually produced — the exam compares task statuses, not the dispatched-label sequence, and no `jev:` row exists to perturb it until siblings 2 (`jev:finding`), 3 (`jev:tier`) and 4 (`jev:suite-red`) add their appends. What would settle it: a sim in one of those tasks running the same canned plan twice, once with `jev` and once without, and asserting the recorded label arrays are deep-equal, not merely that both runs finish `done`. No edit inside this task's FILES answers it.
- [ ] task 1 reviewer — concern: plan-defect: M5 and M6 pin the same env list in two different orders. M5 requires `"TYPESAFE_BASE_URL=$TYPESAFE_PROXY_URL"` directly AFTER `"ANTHROPIC_BASE_URL=$ANTHROPIC_PROXY_URL"` in fleet/sandbox-boot.sh's engine unit (so the boot reads ANTHROPIC, TYPESAFE, OAUTH), while M6 requires `TYPESAFE_BASE_URL=https://typesafe.int.exe.xyz` after `CLAUDE_CODE_OAUTH_TOKEN=placeholder` on fleet/CONTRACT.md's rendering of that same command (so the contract reads ANTHROPIC, OAUTH, TYPESAFE). Each is pinned by its own `Run:` proof, so I implemented both as written and the contract's transcription of the engine unit is deliberately not byte-identical to the command it documents. This is a disclosure, not a park — both legs pass
- [ ] task 1 reviewer — changing either to match the other would break its proof. Worth reconciling in a later plan, in whichever direction the contract prefers.

</details>

Closes #1096
