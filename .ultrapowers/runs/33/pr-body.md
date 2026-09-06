## fleet run-33 — gate-green

| | |
|---|---|
| verdict | `NEEDS_ACK` |
| target | `popmechanic/ultrapowers` at `2d8181879992a5379ace27e84ff296e9f920ff0e` |
| engine | `59e890d97a0223d587e30c28411acb2d979ecddc` |
| plan | `.ultrapowers/plan.md` at `f82c58f08d5b48d6001cd05078f2dcee023b4559` |
| branch | `ultra/integration-run-33` |
| vm | `fleet-r33-2609062300-fbca` |

### Checks

```json
{
  "mode": "gate",
  "stamp": "run-33",
  "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-33/report.json",
  "branch": "ultra/integration-run-33",
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
        "detail": "fleet/publish-fold.mjs \u2014 the resolver dispatch against the real `claude` CLI (the `conflict parked` on BLOCKED, the twice-rejected reply, and the resolved fold) \u2014 As Context records, the CLI has no injection seam for a stub resolver, so every resolver-driven shape is asserted in-process with a stub `deps.makeAgent`. The real path \u2014 `composeAgent` -> `createRunWorker` -> the `claude` binary answering `RESOLVER_SCHEMA` under the confine hook \u2014 needs a live model and credentials and is never executed by the committed suite. The composition itself is structurally correct (labels route to the read-only `resolver` role via `roleForLabel`, cwd to `clones/integration` via `makeCwdFor`, `CLAUDE_CONFIG_DIR` to the run tree's `claude/`), but its behaviour is unexercised here. [structural false-green: sandbox could not execute it against the target]"
      },
      {
        "type": "deferred:external",
        "detail": "The plan's elicited Claim end to end \u2014 two concurrent plans touching one file both merging on their own, no 405 and no hand rebase, with the second run's evidence showing its fold onto main \u2014 The folder is the last missing piece and its own Claim (fold onto main's tip at publish) is met in the tree, but the surrounding half is the boot script's: the `fleet-fold-<N>-<attempt>` systemd unit, `push_head`'s `--force-with-lease`, the merge PUT, the 405 retry into attempt 2, and the evidence push to the target. Those need a real GitHub target, a sandbox VM and an actual cross-run race. The plan itself states #715 closes only when its Tier-2 metric is met on live runs, so this is deferred rather than a shortfall. [structural false-green: sandbox could not execute it against the target]"
      }
    ],
    "repo": "/home/exedev/target"
  },
  "gateCheckExit": 2,
  "acceptance": {
    "disposition": "suite",
    "exit": 0,
    "output": "{\"sealId\": \"(suite)\", \"status\": \"OK\", \"passed\": true, \"exitCode\": 0, \"output\": \"============================= test session starts ==============================\\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\\nrootdir: /tmp/tmp.GL7y2XOlsF/suite-gate\\nconfigfile: pytest.ini\\ntestpaths: tests\\nplugins: xdist-3.4.0\\ncreated: 4/4 workers\\n4 workers [1655 items]\\n\\n........................................................................ [  4%]\\n........................................................................ [  8%]\\n........................................................................ [ 13%]\\n........................................................................ [ 17%]\\n........................................................................ [ 21%]\\n........................................................................ [ 26%]\\n........................................................................ [ 30%]\\n........................................................................ [ 34%]\\n........................................................................ [ 39%]\\n........................................................................ [ 43%]\\n........................................................................ [ 47%]\\n........................................................................ [ 52%]\\n........................................................................ [ 56%]\\n........................................................................ [ 60%]\\n........................................................................ [ 65%]\\n........................................................................ [ 69%]\\n........................................................................ [ 73%]\\n........................................................................ [ 78%]\\n........................................................................ [ 82%]\\n........................................................................ [ 87%]\\n........................................................................ [ 91%]\\n........................................................................ [ 95%]\\n.......................................................................  [100%]\\n=============================== warnings summary ===============================\\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\\ntests/test_harvest_fleet_runs.py::test_a_corrupt_tarball_among_healthy_ones_is_named_and_the_rest_land\\ntests/test_harvest_fleet_runs.py::test_an_unreadable_tarball_is_named_in_a_whole_failed_lookup_line\\ntests/test_harvest_fleet_runs.py::test_discover_unpacks_a_tarball\\n  /usr/lib/python3.12/tarfile.py:2301: DeprecationWarning: Python 3.14 will, by default, filter extracted tar archives and reject files or modify their metadata. Use the filter argument to control this behavior.\\n    warnings.warn(\\n\\n-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html\\n================= 1655 passed, 5 warnings in 297.35s (0:04:57) =================\"}\n"
  },
  "verdict": "NEEDS_ACK"
}
```

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-33/.ultrapowers/runs/33/

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
- transcripts

### Plan

https://github.com/popmechanic/ultrapowers/blob/ultra/plan/run-33/.ultrapowers/plan.md
