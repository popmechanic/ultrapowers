## fleet run-40 — parked

| | |
|---|---|
| verdict | `NEEDS_ACK` |
| target | `popmechanic/ultrapowers` at `9cd8190ffb5e68b1de0eb9eac44b116ab0631d28` |
| engine | `9cd8190ffb5e68b1de0eb9eac44b116ab0631d28` |
| plan | `.ultrapowers/plan.md` at `456cd054446627b1545e5fb6e293a6dbab5b0dc6` |
| branch | `ultra/integration-run-40` |
| vm | `fleet-r40-2609072014-475e` |

### Checks

```json
{
  "mode": "gate",
  "stamp": "run-40",
  "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-40/report.json",
  "branch": "ultra/integration-run-40",
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
        "type": "deferred:external",
        "detail": "The two GitHub endpoints both tools now depend on \u2014 `gh api repos/<t>/pulls?state=all&head=<owner>:ultra/integration-run-<N>` (fleet/retire.mjs:219, fleet/janitor.mjs:393) and `gh api repos/<t>/git/matching-refs/heads/ultra/integration-run-` (fleet/janitor.mjs:385) \u2014 plus the live `gh api -X DELETE repos/<t>/git/refs/heads/ultra/integration-run-<N>` at fleet/retire.mjs:342. \u2014 By the plan's own Tech Stack every `git` and `gh` runs through the recording exec seam of fleet/tests/_lobby_helpers.mjs with `passthrough: []` \u2014 no network, nothing real runs. The suite therefore proves the tools issue the right paths and apply the right rule to canned rows, but not that GitHub's list endpoint really carries `merged_at` with no `merged` boolean, that `matching-refs` really prefix-matches into `{ ref, object.sha }` rows, or that the DELETE really removes the ref. Those shapes are grounded only on the operator's 2026-09-07 laptop read quoted in both Contexts. This is the intended design (Acceptance: suite), not a gap in the deliverable. [structural false-green: sandbox could not execute it against the target]"
      },
      {
        "type": "deferred:manual",
        "detail": "depth-1 clone of ultra/integration-run-40 \u2014 the suite passed on the full clone and failed on a depth-1 clone of ultra/integration-run-40 \u2014 CI checks out at fetch-depth 1, so the merge target will not reproduce this run's green. Either a test is coupled to repository history (fix the test) or the degradation is correct for a shallow consumer (ack it): rvest_fleet_runs.py::test_a_corrupt_tarball_among_healthy_ones_is_named_and_the_rest_land\ntests/test_harvest_fleet_runs.py::test_an_unreadable_tarball_is_named_in_a_whole_failed_lookup_line\ntests/test_harvest_fleet_runs.py::test_discover_unpacks_a_tarball\n  /usr/lib/python3.12/tarfile.py:2301: DeprecationWarning: Python 3.14 will, by default, filter extracted tar archives and reject files or modify their metadata. Use the filter argument to control this behavior.\n    warnings.warn(\n\n-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html\n=========================== short test summary info ============================\nFAILED tests/test_fleet_suite.py::test_fleet_mjs[test_sandbox_boot_merge.mjs]\n====== 1 failed, 1664 passed, 1 skipped, 5 warnings in 346.70s (0:05:46) =======\n"
      }
    ],
    "repo": "/home/exedev/target"
  },
  "gateCheckExit": 2,
  "acceptance": {
    "disposition": "suite",
    "exit": 0,
    "output": "{\"sealId\": \"(suite)\", \"status\": \"OK\", \"passed\": true, \"exitCode\": 0, \"output\": \"============================= test session starts ==============================\\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\\nrootdir: /tmp/tmp.8IS4SBeaUy/suite-gate\\nconfigfile: pytest.ini\\ntestpaths: tests\\nplugins: xdist-3.4.0\\ncreated: 4/4 workers\\n4 workers [1666 items]\\n\\n........................................................................ [  4%]\\n........................................................................ [  8%]\\n........................................................................ [ 12%]\\n........................................................................ [ 17%]\\n........................................................................ [ 21%]\\n........................................................................ [ 25%]\\n........................................................................ [ 30%]\\n........................................................................ [ 34%]\\n........................................................................ [ 38%]\\n........................................................................ [ 43%]\\n........................................................................ [ 47%]\\n........................................................................ [ 51%]\\n........................................................................ [ 56%]\\n........................................................................ [ 60%]\\n........................................................................ [ 64%]\\n........................................................................ [ 69%]\\n........................................................................ [ 73%]\\n........................................................................ [ 77%]\\n........................................................................ [ 82%]\\n........................................................................ [ 86%]\\n........................................................................ [ 90%]\\n........................................................................ [ 95%]\\n........................................................................ [ 99%]\\n..........                                                               [100%]\\n=============================== warnings summary ===============================\\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\\ntests/test_harvest_fleet_runs.py::test_a_corrupt_tarball_among_healthy_ones_is_named_and_the_rest_land\\ntests/test_harvest_fleet_runs.py::test_an_unreadable_tarball_is_named_in_a_whole_failed_lookup_line\\ntests/test_harvest_fleet_runs.py::test_discover_unpacks_a_tarball\\n  /usr/lib/python3.12/tarfile.py:2301: DeprecationWarning: Python 3.14 will, by default, filter extracted tar archives and reject files or modify their metadata. Use the filter argument to control this behavior.\\n    warnings.warn(\\n\\n-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html\\n================= 1666 passed, 5 warnings in 352.27s (0:05:52) =================\"}\n"
  },
  "verdict": "NEEDS_ACK"
}
```

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-40/.ultrapowers/runs/40/

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

https://github.com/popmechanic/ultrapowers/blob/ultra/plan/run-40/.ultrapowers/plan.md
Closes #724
