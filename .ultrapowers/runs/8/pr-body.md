## fleet run-8 — parked

| | |
|---|---|
| verdict | `NEEDS_ACK` |
| target | `popmechanic/ultrapowers` at `13c0e15721705018fb5ba2cba918af5c91811cc4` |
| engine | `13c0e15721705018fb5ba2cba918af5c91811cc4` |
| plan | `.ultrapowers/plan.md` at `2a7005955b0e4ff00345109704458b8383cc6fd8` |
| branch | `ultra/integration-run-8` |
| vm | `fleet-r8-2609042025-c427` |

### Checks

```json
{
  "mode": "gate",
  "stamp": "run-8",
  "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-8/report.json",
  "branch": "ultra/integration-run-8",
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
        "detail": "Task 2 \u2014 the launcher's toolchain refusal (`fleet/launch.mjs:306-311`, exam `fleet/tests/test_launch_toolchain.mjs`) \u2014 The refusal, and the premise it rests on (the sandbox installs node, bun and pytest only), are exercised only through the injected exec seam against a local bare repository; no VM is created and no real lobby `new` is issued in this environment, so the end-to-end \"a Go target is named on the laptop instead of dying on the box\" behaviour is proven by simulation, not by a live launch. [structural false-green: sandbox could not execute it against the target]"
      },
      {
        "type": "deferred:external",
        "detail": "Task 4 \u2014 the engine-source annotation on a real launch (`fleet/launch.mjs:497-512`, exam `fleet/tests/test_launch_engine_source.mjs`) \u2014 `defaultEngineSha` reads `git ls-remote <ENGINE_URL> HEAD` over the network; in both the exam and this review that call is answered by a fixed seam rule, so the `main-tip` annotation was never rendered against the real ultrapowers remote's tip. [structural false-green: sandbox could not execute it against the target]"
      },
      {
        "type": "deferred:plan-defect",
        "detail": "5 \u2014 plan-defect: Machine clause M2 / Proof leg (b) is not established, and cannot be by any edit inside this task's FILES. The Claim requires the same-file advisory to end `pass --base <checkout-dir> so the compiler can tell a mergeable text file from a non-text one it must order` (skills/ultrapowers/scripts/compile_plan.py:1893-1899). I confirmed the implementer's stated blocker: that line rides the bare `--check` channel (compile_plan.py:3035 calls collect_advisories with args.base, and --base is rejected under --check without --renders at :3016, so the tree_root-is-None branch is the one fixture plans take), and tests/test_compile_plan_proof_runs.py leg (e) (:384-396) compares `--check` stdout/stderr/exit byte-for-byte against the compiler blob at frozen sha 0a3559a for every fixture plan carrying no `Run:` bullet \u2014 no fixture plan carries one, and tests/fixtures/plans/2026-09-01-511-attempt-racing.md (tasks 1,2 share `fleet/race.mjs`) and tests/fixtures/plans/2026-09-02-papercut-drain-2.md (tasks 3/4/6 share `fleet/drive.mjs`, 9/10 share `fleet/RUNBOOK.md`, 7/11 share `fleet/shim-main.mjs`) both print that advisory. tests/test_compile_plan_proof_species.py:553-556 imports and re-runs that leg, and the driver's CHECK EVIDENCE ran it at exit 0 \u2014 so the freeze is live in this clone and the GLOBAL CONSTRAINT 'the existing compiler exams keep passing' forbids the M2 wording. The submission discloses this in tests/test_compile_plan_base_message.py:65-86 and in the compile_plan.py:1893 comment, and its leg (b) tests (:326-358) pin BASE's sentence instead. The disclosure is accurate, but the Claim as written is still unmet, so this parks at the gate rather than going to a fix round: the settlement is the operator's \u2014 either amend the task text to drop M2 (the checkout-dir wording then reaches the reader through the --help entry [M1] and the renders skip note [M3], both delivered), or authorize re-pinning BASE_SHA in tests/test_compile_plan_proof_runs.py:44, which is outside this task's FILES. M1 and M3 are fully delivered and exercised: --help carries `<checkout-dir>` (compile_plan.py:2467-2470, exam :307-313, Run evidence `--help | grep -q 'checkout-dir'` exit 0), and the 40-hex branch (compile_plan.py:2480-2485) matches the Context's stated test `re.fullmatch(r\"[0-9a-f]{40}\", str(base))` on a non-directory, with both named values, the absent `is not a git checkout` line, the empty-directory case and exit 0 all asserted (exam :364-417)."
      }
    ],
    "repo": "/home/exedev/target"
  },
  "gateCheckExit": 2,
  "acceptance": {
    "disposition": "suite",
    "exit": 0,
    "output": "{\"sealId\": \"(suite)\", \"status\": \"OK\", \"passed\": true, \"exitCode\": 0, \"output\": \"============================= test session starts ==============================\\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\\nrootdir: /tmp/tmp.4zlklCWvHf/suite-gate\\nconfigfile: pytest.ini\\ntestpaths: tests\\nplugins: xdist-3.4.0\\ncreated: 8/8 workers\\n8 workers [1418 items]\\n\\n........................................................................ [  5%]\\n........................................................................ [ 10%]\\n........................................................................ [ 15%]\\n........................................................................ [ 20%]\\n........................................................................ [ 25%]\\n........................................................................ [ 30%]\\n........................................................................ [ 35%]\\n........................................................................ [ 40%]\\n........................................................................ [ 45%]\\n........................................................................ [ 50%]\\n........................................................................ [ 55%]\\n........................................................................ [ 60%]\\n........................................................................ [ 66%]\\n........................................................................ [ 71%]\\n........................................................................ [ 76%]\\n........................................................................ [ 81%]\\n........................................................................ [ 86%]\\n........................................................................ [ 91%]\\n........................................................................ [ 96%]\\n..................................................                       [100%]\\n=============================== warnings summary ===============================\\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\\ntests/test_harvest_fleet_runs.py::test_a_corrupt_tarball_among_healthy_ones_is_named_and_the_rest_land\\ntests/test_harvest_fleet_runs.py::test_an_unreadable_tarball_is_named_in_a_whole_failed_lookup_line\\ntests/test_harvest_fleet_runs.py::test_discover_unpacks_a_tarball\\n  /usr/lib/python3.12/tarfile.py:2301: DeprecationWarning: Python 3.14 will, by default, filter extracted tar archives and reject files or modify their metadata. Use the filter argument to control this behavior.\\n    warnings.warn(\\n\\n-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html\\n================= 1418 passed, 5 warnings in 94.70s (0:01:34) ==================\"}\n"
  },
  "verdict": "NEEDS_ACK"
}
```

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence-run-8/.ultrapowers/runs/8/

- engine.log
- events.jsonl
- gate-receipt.json
- pr-body.md
- receipt.json
- report.json
- status.json

### Plan

https://github.com/popmechanic/ultrapowers/blob/ultra/plan-run-8/.ultrapowers/plan.md
