## fleet run-29 — gate-green

| | |
|---|---|
| verdict | `NEEDS_ACK` |
| target | `popmechanic/ultrapowers` at `043b686f4489fe6fa1d804ed3e00a9362c2131e0` |
| engine | `043b686f4489fe6fa1d804ed3e00a9362c2131e0` |
| plan | `.ultrapowers/plan.md` at `725fa2d862e2c548f3744c730d939c410720ed77` |
| branch | `ultra/integration-run-29` |
| vm | `fleet-r29-2609052121-0e6a` |

### Checks

```json
{
  "mode": "gate",
  "stamp": "run-29",
  "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-29/report.json",
  "branch": "ultra/integration-run-29",
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
        "detail": "fleet/janitor.mjs \u2014 the tag-first page read and the plan-tag age against the real GitHub API \u2014 Every leg exercises `gh` through the exec seam with canned answers; the contract's premises about the live API \u2014 that the contents API resolves `?ref=` to a tag as it does a branch, that `git/ref/tags/<name>` 404s on a name with no exact match while `git/refs/` answers an array, and that `commits/<sha>` puts the committer date at `.commit.committer.date` \u2014 cannot be executed in this sandbox, which reaches no network. [structural false-green: sandbox could not execute it against the target]"
      },
      {
        "type": "deferred:external",
        "detail": "fleet/janitor.mjs \u2014 #607's two `gh api -X PUT` writes of a death to `ultra/evidence-run-<N>` \u2014 The sims answer every PUT with a canned 200; that the contents API accepts the journal write with no `sha=` and the status write with the read envelope's `sha=` on the live evidence branch is not executable here. [structural false-green: sandbox could not execute it against the target]"
      }
    ],
    "repo": "/home/exedev/target"
  },
  "gateCheckExit": 2,
  "acceptance": {
    "disposition": "suite",
    "exit": 0,
    "output": "{\"sealId\": \"(suite)\", \"status\": \"OK\", \"passed\": true, \"exitCode\": 0, \"output\": \"============================= test session starts ==============================\\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\\nrootdir: /tmp/tmp.wWvBGn8jgW/suite-gate\\nconfigfile: pytest.ini\\ntestpaths: tests\\nplugins: xdist-3.4.0\\ncreated: 4/4 workers\\n4 workers [1653 items]\\n\\n........................................................................ [  4%]\\n........................................................................ [  8%]\\n........................................................................ [ 13%]\\n........................................................................ [ 17%]\\n........................................................................ [ 21%]\\n........................................................................ [ 26%]\\n........................................................................ [ 30%]\\n........................................................................ [ 34%]\\n........................................................................ [ 39%]\\n........................................................................ [ 43%]\\n........................................................................ [ 47%]\\n........................................................................ [ 52%]\\n........................................................................ [ 56%]\\n........................................................................ [ 60%]\\n........................................................................ [ 65%]\\n........................................................................ [ 69%]\\n........................................................................ [ 74%]\\n........................................................................ [ 78%]\\n........................................................................ [ 82%]\\n........................................................................ [ 87%]\\n........................................................................ [ 91%]\\n........................................................................ [ 95%]\\n.....................................................................    [100%]\\n=============================== warnings summary ===============================\\ntests/test_harvest_fleet_runs.py::test_discover_unpacks_a_tarball\\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\\ntests/test_harvest_fleet_runs.py::test_a_corrupt_tarball_among_healthy_ones_is_named_and_the_rest_land\\ntests/test_harvest_fleet_runs.py::test_an_unreadable_tarball_is_named_in_a_whole_failed_lookup_line\\n  /usr/lib/python3.12/tarfile.py:2301: DeprecationWarning: Python 3.14 will, by default, filter extracted tar archives and reject files or modify their metadata. Use the filter argument to control this behavior.\\n    warnings.warn(\\n\\n-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html\\n================= 1653 passed, 5 warnings in 153.55s (0:02:33) =================\"}\n"
  },
  "verdict": "NEEDS_ACK"
}
```

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-29/.ultrapowers/runs/29/

- approve-receipt.json
- claude-version.txt
- engine.log
- events.jsonl
- gate-receipt.json
- pr-body.md
- receipt.json
- report.json
- standing-approval.json
- status.json

### Plan

https://github.com/popmechanic/ultrapowers/blob/ultra/plan/run-29/.ultrapowers/plan.md
