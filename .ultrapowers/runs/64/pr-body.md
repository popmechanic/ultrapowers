## fleet run-64 — gate-green

| | |
|---|---|
| verdict | `PASS` |
| target | `popmechanic/ultrapowers` at `1c97ba442c65d882354953d16590b1f8eb0c7a7a` |
| engine | `1c97ba442c65d882354953d16590b1f8eb0c7a7a` |
| plan | `.ultrapowers/plan.md` at `86ba6f28445d8fdb70e6b4f0a0a7607a2e180a58` |
| branch | `ultra/integration-run-64` |
| vm | `fleet-r64-2609081940-3180` |

### Checks

```json
{
  "mode": "gate",
  "stamp": "run-64",
  "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-64/report.json",
  "branch": "ultra/integration-run-64",
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
    "output": "{\"sealId\": \"(suite)\", \"status\": \"OK\", \"passed\": true, \"exitCode\": 0, \"output\": \"============================= test session starts ==============================\\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\\nrootdir: /tmp/tmp.6ncOZ0gcPe/suite-gate\\nconfigfile: pytest.ini\\ntestpaths: tests\\nplugins: xdist-3.4.0\\ncreated: 6/6 workers\\n6 workers [1835 items]\\n\\n........................................................................ [  3%]\\n........................................................................ [  7%]\\n........................................................................ [ 11%]\\n........................................................................ [ 15%]\\n........................................................................ [ 19%]\\n........................................................................ [ 23%]\\n........................................................................ [ 27%]\\n........................................................................ [ 31%]\\n........................................................................ [ 35%]\\n........................................................................ [ 39%]\\n........................................................................ [ 43%]\\n........................................................................ [ 47%]\\n........................................................................ [ 51%]\\n........................................................................ [ 54%]\\n........................................................................ [ 58%]\\n........................................................................ [ 62%]\\n........................................................................ [ 66%]\\n........................................................................ [ 70%]\\n........................................................................ [ 74%]\\n........................................................................ [ 78%]\\n........................................................................ [ 82%]\\n........................................................................ [ 86%]\\n........................................................................ [ 90%]\\n........................................................................ [ 94%]\\n........................................................................ [ 98%]\\n...................................                                      [100%]\\n=============================== warnings summary ===============================\\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\\ntests/test_harvest_fleet_runs.py::test_a_corrupt_tarball_among_healthy_ones_is_named_and_the_rest_land\\ntests/test_harvest_fleet_runs.py::test_an_unreadable_tarball_is_named_in_a_whole_failed_lookup_line\\ntests/test_harvest_fleet_runs.py::test_discover_unpacks_a_tarball\\n  /usr/lib/python3.12/tarfile.py:2301: DeprecationWarning: Python 3.14 will, by default, filter extracted tar archives and reject files or modify their metadata. Use the filter argument to control this behavior.\\n    warnings.warn(\\n\\n-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html\\n================= 1835 passed, 5 warnings in 329.55s (0:05:29) =================\"}\n"
  },
  "verdict": "PASS"
}
```

## Publish fold

- attempt 1: folded
- attempt 2: folded
- merge: left open: merge PUT answered 405 twice

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-64/.ultrapowers/runs/64/publish-fold/receipt.json

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-64/.ultrapowers/runs/64/

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

https://github.com/popmechanic/ultrapowers/blob/ultra/plan/run-64/.ultrapowers/plan.md
Closes #699
Closes #684
Closes #716
Closes #790
