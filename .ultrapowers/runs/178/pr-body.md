The card files every reviewer leftover among a thousand nits, and its one rule for 'unverified' catches none of the 118 the reviewer itself labelled. This plan asks a calibrated classifier about each leftover as the card is written and puts the few it scores as act-now in a short section at the top, with the rule and the full list untouched below. You read ten lines instead of eighty; after five runs the record says whether you acted on them, and the rollback is deleting the section.

**Parked:** parked: gate verdict BLOCKED

> The PR card gains one section, "Act on these", listing rows at attention ≥ 2.5, capped at ten; the full list stays below it unchanged. Nothing gates on it.

| task | claim | exam | probes | mutant | suite |
|---|---|---|---|---|---|
| 1 | do: open a finished run's evidence tag and read `residuals.jsonl`; see: every row still carries the boot's own `kind`, and beside it a `jev` object with the classifier's status and subject, its actor, its attention score and its claim-falsity — or no `jev` at all on a row whose request failed, with one boot-log line saying so and the pull request exactly as it would have been. | red at BASE → green | — | — | — |
| 2 | do: open the run's pull request; see: above the `Residuals:` line, an `Act on these` section of at most ten rows — the residuals Jev scored at attention 2.5 or higher, highest first, each with its actor, status and subject — and nothing there at all when no row scored that high; below it, the residual count, the errands, the amendments and the record's checklist exactly as they were. | none | — | — | — |
| 3 | do: open the contract's evidence listing and its Publish bullet, and the runbook's Traps; see: the ledger row's `jev` object and the `residuals-jev.jsonl` cache named beside `residuals.jsonl`, the card's `Act on these: <q> of <n>` section described between the task table and the `Residuals:` sentence as an experiment with its rollback, and a `TypeSafe` Traps label saying how the classifier is reached and that nothing gates on it. | none | — | — | — |

Residuals: 4 from review

Amendments: none

<details><summary>Record</summary>

## fleet run-178 — parked

| | |
|---|---|
| verdict | `BLOCKED` |
| target | `popmechanic/ultrapowers` at `6104ae7e472121485d37287a5b10f501090dd838` |
| engine | `6104ae7e472121485d37287a5b10f501090dd838` |
| plan | `.ultrapowers/plan.md` at `428b58593f83b3fb9e6f185302b72d2ec913533f` |
| branch | `ultra/integration-run-178` |
| vm | `fleet-r178-2609170726-ca1b` |

### Checks

```json
{"mode": "gate", "stamp": "run-178", "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-178/report.json", "branch": "ultra/integration-run-178", "gateCheck": {"verdict": "BLOCKED", "checks": [{"name": "report-parse", "ok": true, "detail": ""}, {"name": "clean-tree", "ok": true, "detail": ""}, {"name": "wave-merges", "ok": true, "detail": ""}, {"name": "head-match", "ok": true, "detail": ""}, {"name": "git-verified", "ok": true, "detail": ""}, {"name": "ancestry", "ok": true, "detail": ""}, {"name": "deliverables", "ok": false, "detail": "failed/blocked tasks left declared deliverables unproduced: [{\"task\": \"3\", \"files\": [\"fleet/CONTRACT.md\", \"fleet/RUNBOOK.md\"]}, {\"task\": \"2\", \"files\": [\"fleet/sandbox-boot.sh\", \"fleet/tests/test_sandbox_boot_residuals.mjs\"]}]"}], "notes": [], "repo": "/home/exedev/target"}, "gateCheckExit": 1, "suite": {"passed": true, "unattributed": [], "output": "============================= test session starts ==============================\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\nrootdir: /home/exedev/target/.claude/ultrapowers/run-run-178/clones/integration\nconfigfile: pytest.ini\ntestpaths: tests\nplugins: xdist-3.4.0\ncreated: 3/3 workers\n3 workers [438 items]\n\n........................................................................ [ 16%]\n........................................................................ [ 32%]\n........................................................................ [ 49%]\n........................................................................ [ 65%]\n........................................................................ [ 82%]\n........................................................................ [ 98%]\n......                                                                   [100%]\n======================= 438 passed in 178.50s (0:02:58) ========================\n"}, "verdict": "BLOCKED"}

```

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-178/.ultrapowers/runs/178/

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

https://github.com/popmechanic/ultrapowers/blob/ultra/plan/run-178/.ultrapowers/plan.md

### Residuals

- [ ] task 1 reviewer — Observability gap in `residual_jev` (fleet/sandbox-boot.sh): the worklist is built with `residual_read jev >"$ask" 2>/dev/null || : >"$ask"`, so any failure of the reader (a python traceback, an unreadable report) silently yields an empty worklist — no request is made, every row is written without a `jev`, and the boot log says nothing. The curl path is careful to log one `jev: <name> — curl exit <n>` line per failed item (M5), so the contrast is stark: the one failure mode that loses every row's triage at once is the one that leaves no trace. Suggest dropping the `2>/dev/null`, or logging one line on the fallback branch, e.g. `residual_read jev >"$ask" 2>/dev/null || { : >"$ask"
- [ ] task 1 reviewer — log 'jev: worklist could not be built'
- [ ] task 1 reviewer — }`. Nothing in M1–M6 pins the silence, and the change stays inside this task's FILES.
- [ ] task 1 reviewer — Wall-clock note on the request loop, grounded in the design the task pins rather than in this diff's execution of it: `residual_jev` issues the k requests sequentially, each `--max-time 10`, inside `collect_evidence`, which runs on the publishing/done/fail transitions. The cache means only the first post-engine transition pays, but a classifier that has gone away (connect timeouts rather than refusals) holds that transition for up to k×10s — ~140s at the replay's ~14 findings per run — while the script's own comment gives `--max-time 10` the reason that "a classifier that has gone away must not hold a transition". No fix lies inside this task's FILES: M2 pins exactly k requests, one per item, so bounding the total would mean skipping items and would need a clause change (an aggregate budget, or a first-failure short-circuit that still caches the remaining items as failed). Recording it so the operator can decide, not asking for an edit here.

</details>

Closes #1093
