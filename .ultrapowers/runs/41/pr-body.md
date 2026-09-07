## fleet run-41 — gate-green

| | |
|---|---|
| verdict | `NEEDS_ACK` |
| target | `popmechanic/ultrapowers` at `9cd8190ffb5e68b1de0eb9eac44b116ab0631d28` |
| engine | `9cd8190ffb5e68b1de0eb9eac44b116ab0631d28` |
| plan | `.ultrapowers/plan.md` at `bae89aa2d14fa2702a70ef6b986239ca37696578` |
| branch | `ultra/integration-run-41` |
| vm | `fleet-r41-2609072102-675b` |

### Checks

```json
{
  "mode": "gate",
  "stamp": "run-41",
  "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-41/report.json",
  "branch": "ultra/integration-run-41",
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
        "detail": "fleet/sandbox-boot.sh:362-363 \u2014 `is_target`/`is_run_n` rewritten as `[[ $1 =~ <unquoted ERE> ]]` \u2014 Task 1's Context asserts the two unquoted EREs are read identically by bash 3.2 and bash 5 (`#!/usr/bin/env bash`, so a macOS 3.2 host is in scope). The sandbox has one bash, and the committed sim runs the script only under it, so the 3.2 half of that equivalence \u2014 and the fact that no `shopt compat31` is in play there \u2014 is asserted in the plan but not executed by any leg. The bash-5 behaviour, and the agreement with the retired `grep -qE` forms on the refusal inputs, is executed: leg (c) drives `target=smoke` and `run=-7` through the real boot and confirms both still fail before any clone with an empty `git.log`. [structural false-green: sandbox could not execute it against the target]"
      }
    ],
    "repo": "/home/exedev/target"
  },
  "gateCheckExit": 2,
  "acceptance": {
    "disposition": "suite",
    "exit": 0,
    "output": "{\"sealId\": \"(suite)\", \"status\": \"OK\", \"passed\": true, \"exitCode\": 0, \"output\": \"============================= test session starts ==============================\\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\\nrootdir: /tmp/tmp.nna8wuPYCa/suite-gate\\nconfigfile: pytest.ini\\ntestpaths: tests\\nplugins: xdist-3.4.0\\ncreated: 4/4 workers\\n4 workers [1666 items]\\n\\n........................................................................ [  4%]\\n........................................................................ [  8%]\\n........................................................................ [ 12%]\\n........................................................................ [ 17%]\\n........................................................................ [ 21%]\\n........................................................................ [ 25%]\\n........................................................................ [ 30%]\\n........................................................................ [ 34%]\\n........................................................................ [ 38%]\\n........................................................................ [ 43%]\\n........................................................................ [ 47%]\\n........................................................................ [ 51%]\\n........................................................................ [ 56%]\\n........................................................................ [ 60%]\\n........................................................................ [ 64%]\\n........................................................................ [ 69%]\\n........................................................................ [ 73%]\\n........................................................................ [ 77%]\\n........................................................................ [ 82%]\\n........................................................................ [ 86%]\\n........................................................................ [ 90%]\\n........................................................................ [ 95%]\\n........................................................................ [ 99%]\\n..........                                                               [100%]\\n=============================== warnings summary ===============================\\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\\ntests/test_harvest_fleet_runs.py::test_a_corrupt_tarball_among_healthy_ones_is_named_and_the_rest_land\\ntests/test_harvest_fleet_runs.py::test_an_unreadable_tarball_is_named_in_a_whole_failed_lookup_line\\ntests/test_harvest_fleet_runs.py::test_discover_unpacks_a_tarball\\n  /usr/lib/python3.12/tarfile.py:2301: DeprecationWarning: Python 3.14 will, by default, filter extracted tar archives and reject files or modify their metadata. Use the filter argument to control this behavior.\\n    warnings.warn(\\n\\n-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html\\n================= 1666 passed, 5 warnings in 355.03s (0:05:55) =================\"}\n"
  },
  "verdict": "NEEDS_ACK"
}
```

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-41/.ultrapowers/runs/41/

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

https://github.com/popmechanic/ultrapowers/blob/ultra/plan/run-41/.ultrapowers/plan.md
Closes #738
