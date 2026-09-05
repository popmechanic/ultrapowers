## fleet run-12 — gate-green

| | |
|---|---|
| verdict | `NEEDS_ACK` |
| target | `popmechanic/ultrapowers` at `af1e7c70dedc3de5cbb4e9ca79af3bdb2756a701` |
| engine | `65839d74119dee2bef5f22bf72dd6d838eb2af00` |
| plan | `.ultrapowers/plan.md` at `0222fce1e485e671743fce06fa8030959cf83380` |
| branch | `ultra/integration-run-12` |
| vm | `fleet-r12-2609050734-739c` |

### Checks

```json
{
  "mode": "gate",
  "stamp": "run-12",
  "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-12/report.json",
  "branch": "ultra/integration-run-12",
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
        "detail": "Global constraint: \"No file outside a task's own Files block is edited\" (plan /home/exedev/plans/run-12.md, Global Constraints \u2014 the one constraint in that section carrying no `Check:`) \u2014 This read-only role has no shell in this environment, so I could not run `git diff --name-only` against BASE to confirm the integrated tree touches only the union of the five Files blocks (compile_plan.py, skills/ultrawrite/SKILL.md and the five new tests/test_compile_plan_*.py exams). Everything I could read is consistent with it \u2014 the five exams exist, both SKILL.md edits sit in their two named paragraphs, and every frozen-periphery hash Check: exits 0 \u2014 but the tree-wide scope assertion itself rests on the per-task referees' diffs, not on anything I executed. [structural false-green: sandbox could not execute it against the target]"
      }
    ],
    "repo": "/home/exedev/target"
  },
  "gateCheckExit": 2,
  "acceptance": {
    "disposition": "suite",
    "exit": 0,
    "output": "{\"sealId\": \"(suite)\", \"status\": \"OK\", \"passed\": true, \"exitCode\": 0, \"output\": \"============================= test session starts ==============================\\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\\nrootdir: /tmp/tmp.Yb1FnagaZg/suite-gate\\nconfigfile: pytest.ini\\ntestpaths: tests\\nplugins: xdist-3.4.0\\ncreated: 8/8 workers\\n8 workers [1510 items]\\n\\n........................................................................ [  4%]\\n........................................................................ [  9%]\\n........................................................................ [ 14%]\\n........................................................................ [ 19%]\\n........................................................................ [ 23%]\\n........................................................................ [ 28%]\\n........................................................................ [ 33%]\\n........................................................................ [ 38%]\\n........................................................................ [ 42%]\\n........................................................................ [ 47%]\\n........................................................................ [ 52%]\\n........................................................................ [ 57%]\\n........................................................................ [ 61%]\\n........................................................................ [ 66%]\\n........................................................................ [ 71%]\\n........................................................................ [ 76%]\\n........................................................................ [ 81%]\\n........................................................................ [ 85%]\\n........................................................................ [ 90%]\\n........................................................................ [ 95%]\\n......................................................................   [100%]\\n=============================== warnings summary ===============================\\ntests/test_harvest_fleet_runs.py::test_discover_unpacks_a_tarball\\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\\ntests/test_harvest_fleet_runs.py::test_a_corrupt_tarball_among_healthy_ones_is_named_and_the_rest_land\\ntests/test_harvest_fleet_runs.py::test_an_unreadable_tarball_is_named_in_a_whole_failed_lookup_line\\n  /usr/lib/python3.12/tarfile.py:2301: DeprecationWarning: Python 3.14 will, by default, filter extracted tar archives and reject files or modify their metadata. Use the filter argument to control this behavior.\\n    warnings.warn(\\n\\n-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html\\n================= 1510 passed, 5 warnings in 109.91s (0:01:49) =================\"}\n"
  },
  "verdict": "NEEDS_ACK"
}
```

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence-run-12/.ultrapowers/runs/12/

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

https://github.com/popmechanic/ultrapowers/blob/ultra/plan-run-12/.ultrapowers/plan.md
