## fleet run-67 — gate-green

| | |
|---|---|
| verdict | `PASS` |
| target | `popmechanic/ultrapowers` at `1c97ba442c65d882354953d16590b1f8eb0c7a7a` |
| engine | `1c97ba442c65d882354953d16590b1f8eb0c7a7a` |
| plan | `.ultrapowers/plan.md` at `3f2a7b2c12a0b8284e6d52580989c64e12299a66` |
| branch | `ultra/integration-run-67` |
| vm | `fleet-r67-2609081947-8c5b` |

### Checks

```json
{
  "mode": "gate",
  "stamp": "run-67",
  "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-67/report.json",
  "branch": "ultra/integration-run-67",
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
    "output": "{\"sealId\": \"(suite)\", \"status\": \"OK\", \"passed\": true, \"exitCode\": 0, \"output\": \"============================= test session starts ==============================\\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\\nrootdir: /tmp/tmp.jtgMj23yvu/suite-gate\\nconfigfile: pytest.ini\\ntestpaths: tests\\nplugins: xdist-3.4.0\\ncreated: 6/6 workers\\n6 workers [1791 items]\\n\\n........................................................................ [  4%]\\n........................................................................ [  8%]\\n........................................................................ [ 12%]\\n........................................................................ [ 16%]\\n........................................................................ [ 20%]\\n........................................................................ [ 24%]\\n........................................................................ [ 28%]\\n........................................................................ [ 32%]\\n........................................................................ [ 36%]\\n........................................................................ [ 40%]\\n........................................................................ [ 44%]\\n........................................................................ [ 48%]\\n........................................................................ [ 52%]\\n........................................................................ [ 56%]\\n........................................................................ [ 60%]\\n........................................................................ [ 64%]\\n........................................................................ [ 68%]\\n........................................................................ [ 72%]\\n........................................................................ [ 76%]\\n........................................................................ [ 80%]\\n........................................................................ [ 84%]\\n........................................................................ [ 88%]\\n........................................................................ [ 92%]\\n........................................................................ [ 96%]\\n...............................................................          [100%]\\n=============================== warnings summary ===============================\\ntests/test_harvest_fleet_runs.py::test_discover_unpacks_a_tarball\\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\\ntests/test_harvest_fleet_runs.py::test_a_corrupt_tarball_among_healthy_ones_is_named_and_the_rest_land\\ntests/test_harvest_fleet_runs.py::test_an_unreadable_tarball_is_named_in_a_whole_failed_lookup_line\\n  /usr/lib/python3.12/tarfile.py:2301: DeprecationWarning: Python 3.14 will, by default, filter extracted tar archives and reject files or modify their metadata. Use the filter argument to control this behavior.\\n    warnings.warn(\\n\\n-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html\\n================= 1791 passed, 5 warnings in 299.10s (0:04:59) =================\"}\n"
  },
  "verdict": "PASS"
}
```

## Publish fold

- attempt 1: folded
- attempt 2: folded
- merge: left open: merge PUT answered 405 twice

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-67/.ultrapowers/runs/67/publish-fold/receipt.json

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-67/.ultrapowers/runs/67/

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

https://github.com/popmechanic/ultrapowers/blob/ultra/plan/run-67/.ultrapowers/plan.md
Closes #779
