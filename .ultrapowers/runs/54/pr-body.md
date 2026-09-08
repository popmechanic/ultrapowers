## fleet run-54 — parked

| | |
|---|---|
| verdict | `NEEDS_ACK` |
| target | `popmechanic/ultrapowers` at `d26bbdc1c1603d9865390e9890440e5c4c77422c` |
| engine | `d26bbdc1c1603d9865390e9890440e5c4c77422c` |
| plan | `.ultrapowers/plan.md` at `7a33c053da2a21b3aa5c5894d4b018b5b229bc41` |
| branch | `ultra/integration-run-54` |
| vm | `fleet-r54-2609081536-175b` |

### Checks

```json
{
  "mode": "gate",
  "stamp": "run-54",
  "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-54/report.json",
  "branch": "ultra/integration-run-54",
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
        "detail": "harvest_fleet_runs.fetch_evidence's new `gh api repos/<target>/commits/<ref>` read (Task 3, M3) \u2014 The commits-endpoint contract \u2014 that a real GitHub answer for a branch/tag ref is a commit object whose `sha` is the 40-hex commit sha \u2014 is exercised only against the exams' local `gh` stub, because the plan's global constraint freezes every exam to a stub on PATH with no socket. Call placement, ordering, the `evidence-ref.json` write and the advisory non-zero path are all executed and green; only the live API response shape is unexercised here. [structural false-green: sandbox could not execute it against the target]"
      },
      {
        "type": "deferred:plan-defect",
        "detail": "2 \u2014 plan-defect: every envelope denial is emitted TWICE on a local run directory that has both `workers/*/envelope.json` and `confine-denials.jsonl`, which is the ordinary shape of a sandbox-logs tarball whenever any worker was denied. `_confine_denials` (skills/ultralearn/scripts/harvest_fleet_runs.py) returns `envelopes + transcripts + file_lines` with no reconciliation, and `fleet/run-worker.mjs:511 recordEnvelopeDenials` already appends one `{\"source\": \"envelope\", label, role, tool, reason, toolInput}` line per `permission_denials` entry into that same `confine-denials.jsonl` \u2014 the implementer's own docstring on `_envelope_denials` says so (\"Shaped exactly as `fleet/run-worker.mjs`'s `recordEnvelopeDenials` shapes the lines it appends to `confine-denials.jsonl`\"), and the task Context says the file's lines carry `source: \"hook\"` or, since #476, `source: \"envelope\"`. So the derived envelope lines and the file's envelope echoes are the same denials counted twice. This directly defeats the counting rule the same diff writes into skills/ultralearn/references/reading-lenses.md \u2014 \"**THE SOURCES OVERLAP: count `envelope` lines when they are present, never the total.**\" \u2014 which now yields exactly 2x the true number on the runs where envelopes exist. That is the #476/#760 failure mode (\"two records, one an undisclosed subset of the other, is how a sensor lies for five runs running\") reintroduced from the other side. No Machine clause covers the both-sources-present case (M1 is envelope-only, M3 is file-only), so the exam passes while the lens number is wrong; the defect is faithfully transcribed from the plan's Context slot, which prescribes the bare concatenation, but its fix lies inside this task's own FILES. Drop the file's `source == \"envelope\"` rows when this run's envelopes were read directly. M3 stays green (its fixture has no `workers/`, so no filtering happens and the file lines pass through verbatim, including its `source: \"envelope\"` row), and so do `test_bundle_carries_the_event_summary_and_confine_denials` and `test_a_local_run_dir_bundles_exactly_as_the_base_harvester_did`, whose `_make_run_dir` has no `workers/` either. Add a leg to tests/test_harvest_fleet_runs_confine_denials.py pinning it: one envelope with one `permission_denials` entry plus a `confine-denials.jsonl` holding that same denial as an `source: \"envelope\"` line and one `source: \"hook\"` line yields two lines, exactly one of them `source == \"envelope\"`."
      }
    ],
    "repo": "/home/exedev/target"
  },
  "gateCheckExit": 2,
  "acceptance": {
    "disposition": "suite",
    "exit": 0,
    "output": "{\"sealId\": \"(suite)\", \"status\": \"OK\", \"passed\": true, \"exitCode\": 0, \"output\": \"============================= test session starts ==============================\\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\\nrootdir: /tmp/tmp.KIdObqEfqM/suite-gate\\nconfigfile: pytest.ini\\ntestpaths: tests\\nplugins: xdist-3.4.0\\ncreated: 6/6 workers\\n6 workers [1777 items]\\n\\n........................................................................ [  4%]\\n........................................................................ [  8%]\\n........................................................................ [ 12%]\\n........................................................................ [ 16%]\\n........................................................................ [ 20%]\\n........................................................................ [ 24%]\\n........................................................................ [ 28%]\\n........................................................................ [ 32%]\\n........................................................................ [ 36%]\\n........................................................................ [ 40%]\\n........................................................................ [ 44%]\\n........................................................................ [ 48%]\\n........................................................................ [ 52%]\\n........................................................................ [ 56%]\\n........................................................................ [ 60%]\\n........................................................................ [ 64%]\\n........................................................................ [ 68%]\\n........................................................................ [ 72%]\\n........................................................................ [ 76%]\\n........................................................................ [ 81%]\\n........................................................................ [ 85%]\\n........................................................................ [ 89%]\\n........................................................................ [ 93%]\\n........................................................................ [ 97%]\\n.................................................                        [100%]\\n=============================== warnings summary ===============================\\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\\ntests/test_harvest_fleet_runs.py::test_a_corrupt_tarball_among_healthy_ones_is_named_and_the_rest_land\\ntests/test_harvest_fleet_runs.py::test_an_unreadable_tarball_is_named_in_a_whole_failed_lookup_line\\ntests/test_harvest_fleet_runs.py::test_discover_unpacks_a_tarball\\n  /usr/lib/python3.12/tarfile.py:2301: DeprecationWarning: Python 3.14 will, by default, filter extracted tar archives and reject files or modify their metadata. Use the filter argument to control this behavior.\\n    warnings.warn(\\n\\n-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html\\n================= 1777 passed, 5 warnings in 276.13s (0:04:36) =================\"}\n"
  },
  "verdict": "NEEDS_ACK"
}
```

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-54/.ultrapowers/runs/54/

- acceptance.log
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

https://github.com/popmechanic/ultrapowers/blob/ultra/plan/run-54/.ultrapowers/plan.md
Closes #759
Closes #760
Closes #761
Closes #698
