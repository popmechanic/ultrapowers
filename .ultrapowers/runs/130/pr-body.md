This is the release of the 2026-09-14 clock pass, run through the engine it releases. The test estate was cut to the files that have ever caught a defect, the pre-claims plan grammar and two unused skills are gone, the implementer runs only its own task's proofs, each task gets one reviewer and one fix round, the critic is gone, and the box is sized to the plan. Read on the same ten-task plan at the same base, launch to an approved green went from 24.7 minutes to 15.3, with the implementers' worker-minutes seven times fewer and every verdict clean.

**Merge-ready**

> After this run 0.3.28 is released: a fleet worker proves its own task, the suite is the tests that have ever caught something, and a ten-task plan comes in at fifteen minutes where it took twenty-five.

| task | claim | exam | probes | mutant | suite |
|---|---|---|---|---|---|
| 1 | The plugin's version reads 0.3.28 in both places it is written and in the project's own instructions, which still say a release is a plan the fleet runs, merged by the sandbox, then tagged by the operator. | red at BASE → green | — | — | — |

Residuals: 1 from review

<details><summary>Record</summary>

## fleet run-130 — gate-green

| | |
|---|---|
| verdict | `PASS` |
| target | `popmechanic/ultrapowers` at `690d22315650be28f65b42040d58a5008f22de9f` |
| engine | `690d22315650be28f65b42040d58a5008f22de9f` |
| plan | `.ultrapowers/plan.md` at `32842c92ecded34ff7f7cfd3b4694e12421cd30f` |
| branch | `ultra/integration-run-130` |
| vm | `fleet-r130-2609142039-241f` |

### Checks

```json
{"mode": "gate", "stamp": "run-130", "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-130/report.json", "branch": "ultra/integration-run-130", "gateCheck": {"verdict": "PASS", "checks": [{"name": "report-parse", "ok": true, "detail": ""}, {"name": "clean-tree", "ok": true, "detail": ""}, {"name": "wave-merges", "ok": true, "detail": ""}, {"name": "head-match", "ok": true, "detail": ""}, {"name": "git-verified", "ok": true, "detail": ""}, {"name": "ancestry", "ok": true, "detail": ""}, {"name": "deliverables", "ok": true, "detail": ""}], "notes": [], "repo": "/home/exedev/target"}, "gateCheckExit": 0, "suite": {"passed": true, "unattributed": [], "output": "============================= test session starts ==============================\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\nrootdir: /home/exedev/target/.claude/ultrapowers/run-run-130/clones/integration\nconfigfile: pytest.ini\ntestpaths: tests\nplugins: xdist-3.4.0\ncreated: 3/3 workers\n3 workers [144 items]\n\n........................................................................ [ 50%]\n........................................................................ [100%]\n============================= 144 passed in 40.90s =============================\n"}, "verdict": "PASS"}

```

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-130/.ultrapowers/runs/130/

- approve-receipt.json
- claude-version.txt
- engine.log
- events.jsonl
- exams
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

https://github.com/popmechanic/ultrapowers/blob/ultra/plan/run-130/.ultrapowers/plan.md

### Residuals

- [ ] task 1 reviewer — Exam `tests/exams/run_130/test_release_0_3_28.py`, `_baseline()` (patch lines 89-106): the ref chain ends in `"HEAD"`. If `ULTRA_BASE` is unset and the hard-coded `BASE_SHA` is unreachable (e.g. the exam is re-run on the evidence tag in a shallow or re-rooted clone), the baseline is read from the *current* commit, so `test_plugin_json_changes_nothing_but_the_version` and `test_marketplace_json_changes_nothing_but_the_version` compare the post-bump tree against itself and pass no matter what else those manifests gained — the M1 "no other key changes" leg silently goes vacuous rather than erroring. It does not block here: the Proof's first `Run:` reads both manifests at `$ULTRA_BASE` directly and exited 0 in RUN EVIDENCE, and the exam itself exited 0 in EXAM EVIDENCE, so M1 is established for this tree. Fix by dropping the `HEAD` last resort so an unreachable base raises the AssertionError the helper already writes.

</details>

Closes #872
