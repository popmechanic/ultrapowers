## fleet run-17 — gate-green

| | |
|---|---|
| verdict | `NEEDS_ACK` |
| target | `popmechanic/ultrapowers` at `c32c08f9129b3266de17168678fd539d0723bb76` |
| engine | `c32c08f9129b3266de17168678fd539d0723bb76` |
| plan | `.ultrapowers/plan.md` at `cb2c470413bb313a963e3c0602d606065c2999db` |
| branch | `ultra/integration-run-17` |
| vm | `fleet-r17-2609050926-dace` |

### Checks

```json
{
  "mode": "gate",
  "stamp": "run-17",
  "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-17/report.json",
  "branch": "ultra/integration-run-17",
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
        "detail": "Global constraint \"No file outside a task's own Files block is edited\" (whole-tree diff against BASE) \u2014 Shell access is denied in this read-only role, so I could not run a whole-tree `git diff --name-only` against BASE to enumerate every edited path myself. The 20 frozen-path `Check:` commands all exit 0 in the integrated check evidence, and structural reads of the five declared files (skills/ultrapowers/scripts/compile_plan.py, tests/test_compile_plan_engine_self_change.py, tests/test_compile_plan_sha_unguarded.py, fleet/claude-token.mjs, fleet/tests/test_claude_token.mjs) show only in-contract changes \u2014 but the negative claim over the rest of the tree rests on the per-task referees' diffs, not on anything I executed. [structural false-green: sandbox could not execute it against the target]"
      }
    ],
    "repo": "/home/exedev/target"
  },
  "gateCheckExit": 2,
  "acceptance": {
    "disposition": "suite",
    "exit": 0,
    "output": "{\"sealId\": \"(suite)\", \"status\": \"OK\", \"passed\": true, \"exitCode\": 0, \"output\": \"============================= test session starts ==============================\\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\\nrootdir: /tmp/tmp.mS67XMof77/suite-gate\\nconfigfile: pytest.ini\\ntestpaths: tests\\nplugins: xdist-3.4.0\\ncreated: 8/8 workers\\n8 workers [1585 items]\\n\\n........................................................................ [  4%]\\n........................................................................ [  9%]\\n........................................................................ [ 13%]\\n........................................................................ [ 18%]\\n........................................................................ [ 22%]\\n........................................................................ [ 27%]\\n........................................................................ [ 31%]\\n........................................................................ [ 36%]\\n........................................................................ [ 40%]\\n........................................................................ [ 45%]\\n........................................................................ [ 49%]\\n........................................................................ [ 54%]\\n........................................................................ [ 59%]\\n........................................................................ [ 63%]\\n........................................................................ [ 68%]\\n......................................................................... [ 72%]\\n......................................................................... [ 77%]\\n........................................................................ [ 81%]\\n........................................................................ [ 86%]\\n........................................................................ [ 90%]\\n........................................................................ [ 95%]\\n.......................................................................  [100%]\\n=============================== warnings summary ===============================\\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\\ntests/test_harvest_fleet_runs.py::test_a_corrupt_tarball_among_healthy_ones_is_named_and_the_rest_land\\ntests/test_harvest_fleet_runs.py::test_an_unreadable_tarball_is_named_in_a_whole_failed_lookup_line\\ntests/test_harvest_fleet_runs.py::test_discover_unpacks_a_tarball\\n  /usr/lib/python3.12/tarfile.py:2301: DeprecationWarning: Python 3.14 will, by default, filter extracted tar archives and reject files or modify their metadata. Use the filter argument to control this behavior.\\n    warnings.warn(\\n\\n-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html\\n================= 1585 passed, 5 warnings in 96.02s (0:01:36) ==================\"}\n"
  },
  "verdict": "NEEDS_ACK"
}
```

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence-run-17/.ultrapowers/runs/17/

- approve-receipt.json
- engine.log
- events.jsonl
- gate-receipt.json
- pr-body.md
- receipt.json
- report.json
- standing-approval.json
- status.json

### Plan

https://github.com/popmechanic/ultrapowers/blob/ultra/plan-run-17/.ultrapowers/plan.md
