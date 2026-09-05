## fleet run-26 — gate-green

| | |
|---|---|
| verdict | `PASS` |
| target | `popmechanic/ultrapowers` at `e04154b702407ac1efabaa22db6e21eab706a5f1` |
| engine | `e04154b702407ac1efabaa22db6e21eab706a5f1` |
| plan | `.ultrapowers/plan.md` at `420dec5b0dbaca269e8e77de2d43684a7d71db1e` |
| branch | `ultra/integration-run-26` |
| vm | `fleet-r26-2609051950-7e18` |

### Checks

```json
{
  "mode": "gate",
  "stamp": "run-26",
  "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-26/report.json",
  "branch": "ultra/integration-run-26",
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
    "output": "{\"sealId\": \"(suite)\", \"status\": \"OK\", \"passed\": true, \"exitCode\": 0, \"output\": \"============================= test session starts ==============================\\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\\nrootdir: /tmp/tmp.4WhIHQD5MP/suite-gate\\nconfigfile: pytest.ini\\ntestpaths: tests\\nplugins: xdist-3.4.0\\ncreated: 4/4 workers\\n4 workers [1618 items]\\n\\n........................................................................ [  4%]\\n........................................................................ [  8%]\\n........................................................................ [ 13%]\\n........................................................................ [ 17%]\\n........................................................................ [ 22%]\\n........................................................................ [ 26%]\\n........................................................................ [ 31%]\\n........................................................................ [ 35%]\\n........................................................................ [ 40%]\\n........................................................................ [ 44%]\\n........................................................................ [ 48%]\\n........................................................................ [ 53%]\\n........................................................................ [ 57%]\\n........................................................................ [ 62%]\\n........................................................................ [ 66%]\\n........................................................................ [ 71%]\\n........................................................................ [ 75%]\\n........................................................................ [ 80%]\\n........................................................................ [ 84%]\\n........................................................................ [ 88%]\\n........................................................................ [ 93%]\\n........................................................................ [ 97%]\\n..................................                                       [100%]\\n=============================== warnings summary ===============================\\ntests/test_harvest_fleet_runs.py::test_discover_unpacks_a_tarball\\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\\ntests/test_harvest_fleet_runs.py::test_a_corrupt_tarball_among_healthy_ones_is_named_and_the_rest_land\\ntests/test_harvest_fleet_runs.py::test_an_unreadable_tarball_is_named_in_a_whole_failed_lookup_line\\n  /usr/lib/python3.12/tarfile.py:2301: DeprecationWarning: Python 3.14 will, by default, filter extracted tar archives and reject files or modify their metadata. Use the filter argument to control this behavior.\\n    warnings.warn(\\n\\n-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html\\n================= 1618 passed, 5 warnings in 135.16s (0:02:15) =================\"}\n"
  },
  "verdict": "PASS"
}
```

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence-run-26/.ultrapowers/runs/26/

- approve-receipt.json
- engine.log
- events.jsonl
- gate-receipt.json
- pr-body.md
- receipt.json
- report.json
- status.json

### Plan

https://github.com/popmechanic/ultrapowers/blob/ultra/plan-run-26/.ultrapowers/plan.md
