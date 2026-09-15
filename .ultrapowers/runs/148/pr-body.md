This is the coverage reading of #992, driven again on its own: run-146 built it clean, but its patch was taken against the run's base and no longer applied once its siblings' epochs had changed the same lines of the engine, and the kernel refused the fold rather than resolving it (#1019). It exists so that a merged engine change carries a reading of which of its changed lines a sim actually reached, named and never gated. After this run every merged engine change carries its coverage reading on the evidence tag, and the report reference has its row.

**Merge-ready**

> After this run I can see which changed engine lines a test reached.

| task | claim | exam | probes | mutant | suite |
|---|---|---|---|---|---|
| 1 | When a run that changed the engine merges, its record says which of the changed lines a sim actually ran and which none did — a reading beside the receipt, never a gate. | red at BASE → green | — | — | — |

Residuals: 2 from review

<details><summary>Record</summary>

## fleet run-148 — gate-green

| | |
|---|---|
| verdict | `PASS` |
| target | `popmechanic/ultrapowers` at `7f140639212d91432100970e8ec156a1856b25a6` |
| engine | `7f140639212d91432100970e8ec156a1856b25a6` |
| plan | `.ultrapowers/plan.md` at `88dc7ab9c4d6680c88ab4ced429e001bbc045094` |
| branch | `ultra/integration-run-148` |
| vm | `fleet-r148-2609151743-9ddf` |

### Checks

```json
{"mode": "gate", "stamp": "run-148", "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-148/report.json", "branch": "ultra/integration-run-148", "gateCheck": {"verdict": "PASS", "checks": [{"name": "report-parse", "ok": true, "detail": ""}, {"name": "clean-tree", "ok": true, "detail": ""}, {"name": "wave-merges", "ok": true, "detail": ""}, {"name": "head-match", "ok": true, "detail": ""}, {"name": "git-verified", "ok": true, "detail": ""}, {"name": "ancestry", "ok": true, "detail": ""}, {"name": "deliverables", "ok": true, "detail": ""}], "notes": [], "repo": "/home/exedev/target"}, "gateCheckExit": 0, "suite": {"passed": true, "unattributed": [], "output": "============================= test session starts ==============================\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\nrootdir: /home/exedev/target/.claude/ultrapowers/run-run-148/clones/integration\nconfigfile: pytest.ini\ntestpaths: tests\nplugins: xdist-3.4.0\ncreated: 3/3 workers\n3 workers [222 items]\n\n........................................................................ [ 32%]\n........................................................................ [ 64%]\n........................................................................ [ 97%]\n......                                                                   [100%]\n============================= 222 passed in 59.80s =============================\n"}, "verdict": "PASS"}

```

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-148/.ultrapowers/runs/148/

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

https://github.com/popmechanic/ultrapowers/blob/ultra/plan/run-148/.ultrapowers/plan.md

### Residuals

- [ ] task 1 reviewer — fleet/engine-coverage.mjs: each sim's `NODE_V8_COVERAGE` scratch directory is created with `fs.mkdtempSync` in `runSim` and never removed. The profiles are read once in `simRows` and then abandoned, so every engine-changing run leaves one V8 profile directory per sim (13 at BASE, each holding a full profile of `fleet/run-engine.mjs`) permanently under the OS temp dir. M1 requires only that the directory be fresh and under the temp dir, so this is advisory, not a criterion miss — but the reading owns those directories and nothing else will collect them.
- [ ] task 1 reviewer — fleet/run-engine.mjs: the M3 call site uses the block's catch-all (`catch { /* a reading, never a gate */ }`) as the control path for an ordinary, expected condition — a tree with no `fleet/tests` directory, which is exactly the third leg-(e) case the exam drives. `fs.readdirSync` throws ENOENT there and the swallow turns it into `null`, which is the right answer, but it means the one expected branch and every genuine fault (a `git` seam failure, a bug inside `engineCoverage`) are indistinguishable and equally silent. Making the absent directory explicit leaves the catch for actual faults.

</details>

Closes #992
