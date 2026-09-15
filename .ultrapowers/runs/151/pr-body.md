This is the second turn of the fold rule, taken on run-143's reading: both of that run's age-out folds carried a single task that the very next fold would have carried for free. It exists so that a finished result never pays a whole suite for its own adoption while a sibling is still being built or reviewed — the age clause now waits until nothing left in the run could release a task or end it. After this run a plan like run-67's is expected to fold three times instead of five, the record still says why every fold happened, and the sims that need a fold at every landing still get one with the same argument they pass today.

**Merge-ready**

> When I read a run's record, a finished result waits for its siblings instead of buying its own fold: a fold happens only when it lets a queued task start, ends the run, or nothing else in the run is still being built or reviewed.

| task | claim | exam | probes | mutant | suite |
|---|---|---|---|---|---|
| 1 | When I read a run's record, a finished result waits for its siblings instead of buying its own fold: the age clause fires only when nothing else in the run is still being built or reviewed. | red at BASE → green | — | — | — |

Residuals: none

<details><summary>Record</summary>

## fleet run-151 — gate-green

| | |
|---|---|
| verdict | `PASS` |
| target | `popmechanic/ultrapowers` at `41cb53b606146ee16f7904eaf0440531257426f1` |
| engine | `41cb53b606146ee16f7904eaf0440531257426f1` |
| plan | `.ultrapowers/plan.md` at `5ef5fec0826cee2a42fe6ca73d3095048d3da253` |
| branch | `ultra/integration-run-151` |
| vm | `fleet-r151-2609151823-7d8e` |

### Checks

```json
{"mode": "gate", "stamp": "run-151", "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-151/report.json", "branch": "ultra/integration-run-151", "gateCheck": {"verdict": "PASS", "checks": [{"name": "report-parse", "ok": true, "detail": ""}, {"name": "clean-tree", "ok": true, "detail": ""}, {"name": "wave-merges", "ok": true, "detail": ""}, {"name": "head-match", "ok": true, "detail": ""}, {"name": "git-verified", "ok": true, "detail": ""}, {"name": "ancestry", "ok": true, "detail": ""}, {"name": "deliverables", "ok": true, "detail": ""}], "notes": [], "repo": "/home/exedev/target"}, "gateCheckExit": 0, "suite": {"passed": true, "unattributed": [], "output": "============================= test session starts ==============================\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\nrootdir: /home/exedev/target/.claude/ultrapowers/run-run-151/clones/integration\nconfigfile: pytest.ini\ntestpaths: tests\nplugins: xdist-3.4.0\ncreated: 3/3 workers\n3 workers [228 items]\n\n........................................................................ [ 31%]\n........................................................................ [ 63%]\n........................................................................ [ 94%]\n............                                                             [100%]\n======================== 228 passed in 75.10s (0:01:15) ========================\n"}, "verdict": "PASS"}

```

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-151/.ultrapowers/runs/151/

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

https://github.com/popmechanic/ultrapowers/blob/ultra/plan/run-151/.ultrapowers/plan.md

</details>

