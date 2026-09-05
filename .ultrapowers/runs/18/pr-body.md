## fleet run-18 — gate-green

| | |
|---|---|
| verdict | `NEEDS_ACK` |
| target | `popmechanic/ultrapowers` at `c32c08f9129b3266de17168678fd539d0723bb76` |
| engine | `c32c08f9129b3266de17168678fd539d0723bb76` |
| plan | `.ultrapowers/plan.md` at `2d29f54d1948f9817028f4fa17cd217f2bb3ad7a` |
| branch | `ultra/integration-run-18` |
| vm | `fleet-r18-2609050931-6c2f` |

### Checks

```json
{
  "mode": "gate",
  "stamp": "run-18",
  "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-18/report.json",
  "branch": "ultra/integration-run-18",
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
        "detail": "fleet/sandbox-boot.sh \u2014 merge_pr(): the check-runs GET and the squash-merge PUT against https://github.int.exe.xyz/api/v3 \u2014 Structurally complete and fully exercised by test_sandbox_boot_merge.mjs, but only against the stubbed `curl` in fleet/tests/_sandbox_boot_helpers.mjs. The real GitHub Enterprise edge is unreachable from this environment, so the actual response shapes (check-runs pagination, conclusion vocabulary, 405/409 merge refusals) and the real squash-merge have not been observed. [structural false-green: sandbox could not execute it against the target]"
      },
      {
        "type": "deferred:external",
        "detail": "fleet/launch.mjs \u2014 the pre-launch reap calling janitor({ argv: [], exec, config: settings, now }) \u2014 Ordering, reaped/reapError plumbing and renderLaunch output are pinned by test_launch_reaps.mjs over the exec seam, but the real `ssh exe.dev \"ls 'fleet-r*' --json\"` / `rm <vm> --json` and the real `gh api` status-page read cannot be issued here \u2014 exe.dev and the target's evidence branches are not reachable. [structural false-green: sandbox could not execute it against the target]"
      },
      {
        "type": "deferred:external",
        "detail": "fleet/doctor.mjs \u2014 fleetConfigKeys/capacityRow red row through the CLI \u2014 Covered end-to-end by test_doctor_config_keys.mjs, but only under the PATH shim that fakes `ssh exe.dev \"billing plan --json\"` and `integrations list --json`. The row against a real exe.dev account and a real ~/.ultrapowers/fleet.json has not been run here. [structural false-green: sandbox could not execute it against the target]"
      }
    ],
    "repo": "/home/exedev/target"
  },
  "gateCheckExit": 2,
  "acceptance": {
    "disposition": "suite",
    "exit": 0,
    "output": "{\"sealId\": \"(suite)\", \"status\": \"OK\", \"passed\": true, \"exitCode\": 0, \"output\": \"============================= test session starts ==============================\\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\\nrootdir: /tmp/tmp.aWu2lmHf3L/suite-gate\\nconfigfile: pytest.ini\\ntestpaths: tests\\nplugins: xdist-3.4.0\\ncreated: 8/8 workers\\n8 workers [1523 items]\\n\\n........................................................................ [  4%]\\n........................................................................ [  9%]\\n........................................................................ [ 14%]\\n........................................................................ [ 18%]\\n........................................................................ [ 23%]\\n........................................................................ [ 28%]\\n........................................................................ [ 33%]\\n........................................................................ [ 37%]\\n........................................................................ [ 42%]\\n........................................................................ [ 47%]\\n........................................................................ [ 52%]\\n........................................................................ [ 56%]\\n........................................................................ [ 61%]\\n........................................................................ [ 66%]\\n........................................................................ [ 70%]\\n........................................................................ [ 75%]\\n........................................................................ [ 80%]\\n........................................................................ [ 85%]\\n........................................................................ [ 89%]\\n........................................................................ [ 94%]\\n........................................................................ [ 99%]\\n...........                                                              [100%]\\n=============================== warnings summary ===============================\\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\\ntests/test_harvest_fleet_runs.py::test_a_corrupt_tarball_among_healthy_ones_is_named_and_the_rest_land\\ntests/test_harvest_fleet_runs.py::test_an_unreadable_tarball_is_named_in_a_whole_failed_lookup_line\\ntests/test_harvest_fleet_runs.py::test_discover_unpacks_a_tarball\\n  /usr/lib/python3.12/tarfile.py:2301: DeprecationWarning: Python 3.14 will, by default, filter extracted tar archives and reject files or modify their metadata. Use the filter argument to control this behavior.\\n    warnings.warn(\\n\\n-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html\\n================= 1523 passed, 5 warnings in 103.93s (0:01:43) =================\"}\n"
  },
  "verdict": "NEEDS_ACK"
}
```

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence-run-18/.ultrapowers/runs/18/

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

https://github.com/popmechanic/ultrapowers/blob/ultra/plan-run-18/.ultrapowers/plan.md
