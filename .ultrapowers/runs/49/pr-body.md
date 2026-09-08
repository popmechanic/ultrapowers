## fleet run-49 — gate-green

| | |
|---|---|
| verdict | `NEEDS_ACK` |
| target | `popmechanic/ultrapowers` at `9395cd11d6b6e0e1b1e5195b5702956d6faf88f6` |
| engine | `9395cd11d6b6e0e1b1e5195b5702956d6faf88f6` |
| plan | `.ultrapowers/plan.md` at `c658d97a07fa73c4a971a85bcfa79d4bd435c10a` |
| branch | `ultra/integration-run-49` |
| vm | `fleet-r49-2609080656-e643` |

### Checks

```json
{
  "mode": "gate",
  "stamp": "run-49",
  "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-49/report.json",
  "branch": "ultra/integration-run-49",
  "gateCheck": {
    "verdict": "NEEDS_ACK",
    "checks": [
      {
        "name": "report-parse",
        "ok": true,
        "detail": ""
      },
      {
        "name": "clean-tree",
        "ok": true,
        "detail": ""
      },
      {
        "name": "wave-merges",
        "ok": true,
        "detail": ""
      },
      {
        "name": "head-match",
        "ok": true,
        "detail": ""
      },
      {
        "name": "git-verified",
        "ok": true,
        "detail": ""
      },
      {
        "name": "ancestry",
        "ok": true,
        "detail": ""
      },
      {
        "name": "deliverables",
        "ok": true,
        "detail": ""
      }
    ],
    "acks": [
      {
        "type": "deferred:runtime",
        "detail": "fleet/publish-fold.mjs \u2014 examArgvFor's non-node runner branches: ['python3','-m','pytest','-q',<exam>] for .py and ['bun','test',<exam>] for .test.ts \u2014 Leg (a) of Task 2 pins these argvs, and every live exam leg in fleet/tests/test_publish_fold.mjs runs a .mjs exam through `node`, so no committed leg ever executes a .py or .test.ts exam end to end. The parse check's python3 branch IS exercised live (Task 1 leg (f)); the exam check's pytest and bun branches are structurally complete but unexecuted here, and bun in particular only exists on the provisioned sandbox VM (fleet/setup-script.mjs), not necessarily in this environment. [structural false-green: sandbox could not execute it against the target]"
      }
    ],
    "repo": "/home/exedev/target"
  },
  "gateCheckExit": 2,
  "acceptance": {
    "disposition": "suite",
    "exit": 0,
    "output": "{\"sealId\": \"(suite)\", \"status\": \"OK\", \"passed\": true, \"exitCode\": 0, \"output\": \"============================= test session starts ==============================\\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\\nrootdir: /tmp/tmp.28W8Jdjk1e/suite-gate\\nconfigfile: pytest.ini\\ntestpaths: tests\\nplugins: xdist-3.4.0\\ncreated: 4/4 workers\\n4 workers [1666 items]\\n\\n........................................................................ [  4%]\\n........................................................................ [  8%]\\n........................................................................ [ 12%]\\n........................................................................ [ 17%]\\n........................................................................ [ 21%]\\n........................................................................ [ 25%]\\n........................................................................ [ 30%]\\n........................................................................ [ 34%]\\n........................................................................ [ 38%]\\n........................................................................ [ 43%]\\n........................................................................ [ 47%]\\n........................................................................ [ 51%]\\n........................................................................ [ 56%]\\n........................................................................ [ 60%]\\n........................................................................ [ 64%]\\n........................................................................ [ 69%]\\n........................................................................ [ 73%]\\n........................................................................ [ 77%]\\n........................................................................ [ 82%]\\n........................................................................ [ 86%]\\n........................................................................ [ 90%]\\n........................................................................ [ 95%]\\n........................................................................ [ 99%]\\n..........                                                               [100%]\\n=============================== warnings summary ===============================\\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\\ntests/test_harvest_fleet_runs.py::test_a_corrupt_tarball_among_healthy_ones_is_named_and_the_rest_land\\ntests/test_harvest_fleet_runs.py::test_an_unreadable_tarball_is_named_in_a_whole_failed_lookup_line\\ntests/test_harvest_fleet_runs.py::test_discover_unpacks_a_tarball\\n  /usr/lib/python3.12/tarfile.py:2301: DeprecationWarning: Python 3.14 will, by default, filter extracted tar archives and reject files or modify their metadata. Use the filter argument to control this behavior.\\n    warnings.warn(\\n\\n-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html\\n================= 1666 passed, 5 warnings in 378.00s (0:06:18) =================\"}\n"
  },
  "verdict": "NEEDS_ACK"
}
```

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-49/.ultrapowers/runs/49/

- acceptance.log
- approve-receipt.json
- claude-version.txt
- engine.log
- events.jsonl
- gate-receipt.json
- pr-body.md
- publish-fold
- receipt.json
- report.json
- standing-approval.json
- status.json
- transcripts

### Plan

https://github.com/popmechanic/ultrapowers/blob/ultra/plan/run-49/.ultrapowers/plan.md
Closes #751
Closes #754
Closes #757
