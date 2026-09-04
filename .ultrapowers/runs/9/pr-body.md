## fleet run-9 — gate-green

| | |
|---|---|
| verdict | `PASS` |
| target | `popmechanic/ultrapowers` at `cc5e24ea352cb9a48c89db276b7c184926990334` |
| engine | `cc5e24ea352cb9a48c89db276b7c184926990334` |
| plan | `.ultrapowers/plan.md` at `3423e0f2f3ec8f4b530a85d248b9a82ddb51fabf` |
| branch | `ultra/integration-run-9` |
| vm | `fleet-r9-2609042104-7be7` |

### Checks

```json
{
  "mode": "gate",
  "stamp": "run-9",
  "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-9/report.json",
  "branch": "ultra/integration-run-9",
  "gateCheck": {
    "verdict": "PASS",
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
    "acks": [],
    "repo": "/home/exedev/target"
  },
  "gateCheckExit": 0,
  "acceptance": {
    "disposition": "suite",
    "exit": 0,
    "output": "{\"sealId\": \"(suite)\", \"status\": \"OK\", \"passed\": true, \"exitCode\": 0, \"output\": \"============================= test session starts ==============================\\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\\nrootdir: /tmp/tmp.0Q0ODzZCX4/suite-gate\\nconfigfile: pytest.ini\\ntestpaths: tests\\nplugins: xdist-3.4.0\\ncreated: 8/8 workers\\n8 workers [1428 items]\\n\\n........................................................................ [  5%]\\n........................................................................ [ 10%]\\n........................................................................ [ 15%]\\n........................................................................ [ 20%]\\n........................................................................ [ 25%]\\n........................................................................ [ 30%]\\n........................................................................ [ 35%]\\n........................................................................ [ 40%]\\n........................................................................ [ 45%]\\n........................................................................ [ 50%]\\n........................................................................ [ 55%]\\n........................................................................ [ 60%]\\n........................................................................ [ 65%]\\n........................................................................ [ 70%]\\n........................................................................ [ 75%]\\n........................................................................ [ 80%]\\n........................................................................ [ 85%]\\n........................................................................ [ 90%]\\n........................................................................ [ 95%]\\n............................................................             [100%]\\n=============================== warnings summary ===============================\\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\\ntests/test_harvest_fleet_runs.py::test_a_corrupt_tarball_among_healthy_ones_is_named_and_the_rest_land\\ntests/test_harvest_fleet_runs.py::test_an_unreadable_tarball_is_named_in_a_whole_failed_lookup_line\\ntests/test_harvest_fleet_runs.py::test_discover_unpacks_a_tarball\\n  /usr/lib/python3.12/tarfile.py:2301: DeprecationWarning: Python 3.14 will, by default, filter extracted tar archives and reject files or modify their metadata. Use the filter argument to control this behavior.\\n    warnings.warn(\\n\\n-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html\\n================= 1428 passed, 5 warnings in 97.91s (0:01:37) ==================\"}\n"
  },
  "verdict": "PASS"
}
```

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence-run-9/.ultrapowers/runs/9/

- engine.log
- events.jsonl
- gate-receipt.json
- pr-body.md
- receipt.json
- report.json
- status.json

### Plan

https://github.com/popmechanic/ultrapowers/blob/ultra/plan-run-9/.ultrapowers/plan.md
