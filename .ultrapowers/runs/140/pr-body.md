This is the fold rule the Phase C reading asked for, driven again on its own: run-136 built it clean, but its patch was taken against the run's base and no longer applied once the sibling task's epoch had changed the same lines of the landing code, and the kernel refused the fold rather than resolving it. It exists so a fold is bought only when it buys something — a queued task becomes ready, the run is ending, or a result has sat unadopted for a whole suite's length — and this time it starts from the head that already carries the hub's landed and adopted states. After this run a plan with no edges folds once at the end, a chain folds exactly when its consumer can start, and the record says why each fold happened.

**Merge-ready**

> When I read a run's record, every fold either made a queued task ready, closed the run, or adopted work that had waited a full suite's length — a plan with no edges folds once, and a task lands on the hub as landed, then adopted, never as needing a human when it doesn't.

| task | claim | exam | probes | mutant | suite |
|---|---|---|---|---|---|
| 1 | When I read a run's record, every fold either made a queued task ready, closed the run, or adopted work that had waited a full suite's length — and a plan with no edges folds once. | red at BASE → green | — | — | — |

Residuals: 4 from review

<details><summary>Record</summary>

## fleet run-140 — gate-green

| | |
|---|---|
| verdict | `PASS` |
| target | `popmechanic/ultrapowers` at `3a7b834d0c63f6d5de7222a516ec1b12e58d7c54` |
| engine | `3a7b834d0c63f6d5de7222a516ec1b12e58d7c54` |
| plan | `.ultrapowers/plan.md` at `21b3dfc2a875478f8514578d0a7765b9ba1c763d` |
| branch | `ultra/integration-run-140` |
| vm | `fleet-r140-2609151005-58d6` |

### Checks

```json
{"mode": "gate", "stamp": "run-140", "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-140/report.json", "branch": "ultra/integration-run-140", "gateCheck": {"verdict": "PASS", "checks": [{"name": "report-parse", "ok": true, "detail": ""}, {"name": "clean-tree", "ok": true, "detail": ""}, {"name": "wave-merges", "ok": true, "detail": ""}, {"name": "head-match", "ok": true, "detail": ""}, {"name": "git-verified", "ok": true, "detail": ""}, {"name": "ancestry", "ok": true, "detail": ""}, {"name": "deliverables", "ok": true, "detail": ""}], "notes": [], "repo": "/home/exedev/target"}, "gateCheckExit": 0, "suite": {"passed": true, "unattributed": [], "output": "============================= test session starts ==============================\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\nrootdir: /home/exedev/target/.claude/ultrapowers/run-run-140/clones/integration\nconfigfile: pytest.ini\ntestpaths: tests\nplugins: xdist-3.4.0\ncreated: 3/3 workers\n3 workers [175 items]\n\n........................................................................ [ 41%]\n........................................................................ [ 82%]\n...............................                                          [100%]\n============================= 175 passed in 40.35s =============================\n"}, "verdict": "PASS"}

```

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-140/.ultrapowers/runs/140/

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

https://github.com/popmechanic/ultrapowers/blob/ultra/plan/run-140/.ultrapowers/plan.md

### Residuals

- [ ] task 1 reviewer — GLOBAL CONSTRAINT "Every sim keeps printing `ALL TESTS PASSED` on its last line and names no sibling sim" is in literal tension with the new exam: `fleet/tests/test_run_engine_fold_policy.mjs` leg (g) (clone lines 745–806) names three siblings as string literals — `test_run_engine_ready_set.mjs`, `test_run_engine_joined_proofs.mjs`, `test_run_engine_proof_runs.mjs` — and `readFileSync`s each. This is not the implementer's choice: the task's own Proof leg (g) requires exactly that ("read as text in the new sim, `test_run_engine_ready_set.mjs` passes `foldAgeMs: 0` in each of the eight scenarios named and not in `c1` …"), and the Context restates the constraint as "spawns no sibling sim". The constraint carries no `Check:` of its own, and the bridge (`python3 -m pytest … tests/test_fleet_suite.py`, RUN EVIDENCE exit 0, 25 passed) runs the hermeticity sim, so nothing is actually red. Recording it so the operator can reconcile the constraint's wording ("names") with the plan's reading ("spawns")
- [ ] task 1 reviewer — no edit to this tree is warranted.
- [ ] task 1 reviewer — Flake risk in the new exam's wall-clock coupling. `fleet/tests/test_run_engine_fold_policy.mjs` leg (d)/(e) (clone lines ~510–570) asserts `adoptTs - endATs <= AGED_THRESHOLD_MS + WAKE_SLACK_MS` — 300 + 1000 ms — where `adoptTs` is the `ts` of the `driver:wave-adopted` event, i.e. it is only appended after a whole real kernel fold (python3 `fold`/`resolve`/`materialize`/`emit-weave`, git ops, and the candidate suite) has completed. That leaves the fold under ~1 s of budget
- [ ] task 1 reviewer — the companion assertion `adoptTs < endBTs` leaves it under `AGED_HOLD_MS` = 2000 ms. Both are green in EXAM EVIDENCE, and the 1-second window is the plan's own number (Proof leg (e): "within one second of A's `worker:end` plus 300 ms"), so this is advisory only — but the exam runs through the bridge under `pytest -n auto`, where several sims fold concurrently, and that is where a loaded box, not the engine, becomes the reason the leg goes red. If it ever flakes, raise `WAKE_SLACK_MS` and `AGED_HOLD_MS` together (keeping `AGED_HOLD_MS > AGED_THRESHOLD_MS + WAKE_SLACK_MS`, which is what makes the leg discriminate a timer wake from a landing wake) rather than loosening the `adoptTs < endBTs` pin, which is the assertion that actually carries M5.

</details>

Closes #1006
