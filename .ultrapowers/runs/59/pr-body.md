## fleet run-59 — gate-green

| | |
|---|---|
| verdict | `PASS` |
| target | `popmechanic/ultrapowers` at `1c83b61ecbeb29f722dfba90198336f1dbc08296` |
| engine | `1c83b61ecbeb29f722dfba90198336f1dbc08296` |
| plan | `.ultrapowers/plan.md` at `dce78bd161baa105d954097a9eacca548187f685` |
| branch | `ultra/integration-run-59` |
| vm | `fleet-r59-2609081745-c09d` |

### Checks

```json
{
  "mode": "gate",
  "stamp": "run-59",
  "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-59/report.json",
  "branch": "ultra/integration-run-59",
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
    "output": "{\"sealId\": \"(suite)\", \"status\": \"OK\", \"passed\": true, \"exitCode\": 0, \"output\": \"============================= test session starts ==============================\\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\\nrootdir: /tmp/tmp.CfKEKfTna4/suite-gate\\nconfigfile: pytest.ini\\ntestpaths: tests\\nplugins: xdist-3.4.0\\ncreated: 6/6 workers\\n6 workers [1813 items]\\n\\n........................................................................ [  3%]\\n........................................................................ [  7%]\\n........................................................................ [ 11%]\\n........................................................................ [ 15%]\\n........................................................................ [ 19%]\\n........................................................................ [ 23%]\\n........................................................................ [ 27%]\\n........................................................................ [ 31%]\\n........................................................................ [ 35%]\\n........................................................................ [ 39%]\\n........................................................................ [ 43%]\\n........................................................................ [ 47%]\\n........................................................................ [ 51%]\\n........................................................................ [ 55%]\\n........................................................................ [ 59%]\\n........................................................................ [ 63%]\\n........................................................................ [ 67%]\\n........................................................................ [ 71%]\\n........................................................................ [ 75%]\\n........................................................................ [ 79%]\\n........................................................................ [ 83%]\\n........................................................................ [ 87%]\\n........................................................................ [ 91%]\\n........................................................................ [ 95%]\\n........................................................................ [ 99%]\\n.............                                                            [100%]\\n=============================== warnings summary ===============================\\ntests/test_harvest_fleet_runs.py::test_discover_unpacks_a_tarball\\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\\ntests/test_harvest_fleet_runs.py::test_a_corrupt_tarball_among_healthy_ones_is_named_and_the_rest_land\\ntests/test_harvest_fleet_runs.py::test_an_unreadable_tarball_is_named_in_a_whole_failed_lookup_line\\n  /usr/lib/python3.12/tarfile.py:2301: DeprecationWarning: Python 3.14 will, by default, filter extracted tar archives and reject files or modify their metadata. Use the filter argument to control this behavior.\\n    warnings.warn(\\n\\n-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html\\n================= 1813 passed, 5 warnings in 313.52s (0:05:13) =================\"}\n"
  },
  "verdict": "PASS"
}
```

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-59/.ultrapowers/runs/59/

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
- status.json
- transcripts

### Plan

https://github.com/popmechanic/ultrapowers/blob/ultra/plan/run-59/.ultrapowers/plan.md
Closes #725
