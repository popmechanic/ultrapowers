## fleet run-66 — gate-green

| | |
|---|---|
| verdict | `NEEDS_ACK` |
| target | `popmechanic/ultrapowers` at `1c97ba442c65d882354953d16590b1f8eb0c7a7a` |
| engine | `1c97ba442c65d882354953d16590b1f8eb0c7a7a` |
| plan | `.ultrapowers/plan.md` at `9b6c029710bba64c7f49cf6d66fdd0595ae9a31e` |
| branch | `ultra/integration-run-66` |
| vm | `fleet-r66-2609081947-2bab` |

### Checks

```json
{
  "mode": "gate",
  "stamp": "run-66",
  "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-66/report.json",
  "branch": "ultra/integration-run-66",
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
        "detail": "Task 4 \u2014 `fleet/strip-exams.sh` + `push_head`'s strip, end to end onto a live remote: the pull request carrying no `tests/exams/`|`fleet/tests/exams/` file and `ultra/evidence/run-<N>` carrying them under `.ultrapowers/runs/<N>/exams/`. \u2014 The ref-plumbing half is exercised against real git repositories (`fleet/tests/test_strip_exams.mjs`) and the call position against a stubbed boot (`fleet/tests/test_sandbox_boot_exams.mjs`), both green in the driver's suite. What cannot run here is the publish itself: the push to the GitHub remote, the PR diff a reviewer opens, and the tag `ultra/evidence/run-<N>` that the post-run retirement sweep moves onto the evidence branch head. [structural false-green: sandbox could not execute it against the target]"
      },
      {
        "type": "deferred:external",
        "detail": "Task 1 \u2014 a real examiner agent honoring the `EXAM PATHS:` line and writing its exam at the landing path (`fleet/run-engine.mjs:1057-1069`, `fleet/roles/examiner.md:25-31`). \u2014 The prompt line, the handoff, the `__init__.py` packaging and the branch state after a wave are all proven with a stub examiner that parses the line (`fleet/tests/test_run_engine_reserved_exams.mjs`). Whether a live model writes to `b` rather than the Proof path `a` \u2014 and writes its relative imports for that depth \u2014 is model behavior on a real fleet run and is not executable in this environment. [structural false-green: sandbox could not execute it against the target]"
      }
    ],
    "repo": "/home/exedev/target"
  },
  "gateCheckExit": 2,
  "acceptance": {
    "disposition": "suite",
    "exit": 0,
    "output": "{\"sealId\": \"(suite)\", \"status\": \"OK\", \"passed\": true, \"exitCode\": 0, \"output\": \"============================= test session starts ==============================\\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\\nrootdir: /tmp/tmp.wR4G6k2CDm/suite-gate\\nconfigfile: pytest.ini\\ntestpaths: tests\\nplugins: xdist-3.4.0\\ncreated: 6/6 workers\\n6 workers [1838 items]\\n\\n........................................................................ [  3%]\\n........................................................................ [  7%]\\n........................................................................ [ 11%]\\n........................................................................ [ 15%]\\n........................................................................ [ 19%]\\n........................................................................ [ 23%]\\n........................................................................ [ 27%]\\n........................................................................ [ 31%]\\n........................................................................ [ 35%]\\n........................................................................ [ 39%]\\n........................................................................ [ 43%]\\n........................................................................ [ 47%]\\n........................................................................ [ 50%]\\n........................................................................ [ 54%]\\n........................................................................ [ 58%]\\n........................................................................ [ 62%]\\n........................................................................ [ 66%]\\n........................................................................ [ 70%]\\n........................................................................ [ 74%]\\n........................................................................ [ 78%]\\n........................................................................ [ 82%]\\n........................................................................ [ 86%]\\n........................................................................ [ 90%]\\n........................................................................ [ 94%]\\n........................................................................ [ 97%]\\n......................................                                   [100%]\\n=============================== warnings summary ===============================\\ntests/test_harvest_fleet_runs.py::test_discover_unpacks_a_tarball\\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\\ntests/test_harvest_fleet_runs.py::test_a_corrupt_tarball_among_healthy_ones_is_named_and_the_rest_land\\ntests/test_harvest_fleet_runs.py::test_an_unreadable_tarball_is_named_in_a_whole_failed_lookup_line\\n  /usr/lib/python3.12/tarfile.py:2301: DeprecationWarning: Python 3.14 will, by default, filter extracted tar archives and reject files or modify their metadata. Use the filter argument to control this behavior.\\n    warnings.warn(\\n\\n-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html\\n================= 1838 passed, 5 warnings in 324.54s (0:05:24) =================\"}\n"
  },
  "verdict": "NEEDS_ACK"
}
```

## Publish fold

- attempt 1: folded
- attempt 2: folded
- merge: left open: merge PUT answered 405 twice

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-66/.ultrapowers/runs/66/publish-fold/receipt.json

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-66/.ultrapowers/runs/66/

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

https://github.com/popmechanic/ultrapowers/blob/ultra/plan/run-66/.ultrapowers/plan.md
Closes #777
