This closes the gap that has kept every worker silent on the tracker since Phase A landed: the roles teach the worker to write to its own issue, but the reference it needs was never handed to it. It exists because run-118's fix worker said outright that the reference was unset and skipped every kata command, and a look inside run-117's live workers confirmed the variable was missing. After this run a worker knows which issue is its own, and the next stuck task can be watched raising its hand on the hub.

**Parked:** parked: gate verdict NEEDS_ACK

> do: launch any plan and look at a running worker's environment on the sandbox. see: the worker carries the reference to its own kata issue, so the notes, stuck signals and needs-review label the roles teach can actually land on that issue.

| task | claim | exam | probes | mutant | suite |
|---|---|---|---|---|---|
| 1 | Every worker of a task whose issue is on the hub runs with `KATA_REF=<project>#<short_id>` in its environment, the launch record's task rows carry the `short_id` the launcher already holds from the create answer (`MUTATION_KEYS` has it), and the sim that pins the worker's environment reads the short id from a record shaped exactly as the launcher writes it, never from a value the sim planted. | red at BASE → green | — | — | red, unattributed |

Residuals: 10 from review

- deferred:external — Task 1 Claim, operator sentence: "launch any plan and look at a running worker's environment on the sandbox. see: the worker carries the reference to its own kata issue" — KATA_REF observed on a live implementer's environment on a real sandbox VM. — The end-to-end chain terminates at a real kata hub (https://kata.int.exe.xyz) and a provisioned sandbox, neither reachable from this read-only tree. Structurally complete and verified at the seam instead: fleet/launch.mjs:1393-1421 writes short_id into the record, fleet/run-main.mjs:437-449 and :835-836 build KATA_REF from it, and fleet/tests/test_worker_kata_ref.mjs legs (a)+(b) drive the launcher's own written bytes through run-main's envFor against a recording fake hub. [structural false-green: sandbox could not execute it against the target]
- deferred:external — Task 1 Claim, downstream consequence: "the notes, stuck signals and needs-review label the roles teach can actually land on that issue" — an actual kata write from a worker holding the new KATA_REF. — Requires a worker session posting to the live hub. The consuming side is present in the tree (fleet/roles/implementer.md, fleet/roles/fix.md, fleet/roles/examiner.md all read KATA_REF), but whether a note lands on the issue cannot be exercised here. [structural false-green: sandbox could not execute it against the target]

<details><summary>Record</summary>

## fleet run-119 — parked

| | |
|---|---|
| verdict | `NEEDS_ACK` |
| target | `popmechanic/ultrapowers` at `2f327c6f048b957e015e93c9d5b3e2cd652b610e` |
| engine | `2f327c6f048b957e015e93c9d5b3e2cd652b610e` |
| plan | `.ultrapowers/plan.md` at `7b29bee4a54441b0d6ffd9fe64debe12b6b00f70` |
| branch | `ultra/integration-run-119` |
| vm | `fleet-r119-2609131819-a624` |

### Checks

```json
{"mode": "gate", "stamp": "run-119", "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-119/report.json", "branch": "ultra/integration-run-119", "gateCheck": {"verdict": "NEEDS_ACK", "checks": [{"name": "report-parse", "ok": true, "detail": ""}, {"name": "clean-tree", "ok": true, "detail": ""}, {"name": "wave-merges", "ok": true, "detail": ""}, {"name": "head-match", "ok": true, "detail": ""}, {"name": "git-verified", "ok": true, "detail": ""}, {"name": "ancestry", "ok": true, "detail": ""}, {"name": "deliverables", "ok": true, "detail": ""}], "notes": [], "repo": "/home/exedev/target"}, "gateCheckExit": 2, "suite": {"passed": false, "unattributed": ["fleet/tests/test_sims_are_hermetic.mjs"], "output": "t/tests/  [M4 / leg (d)]\nE             AssertionError [ERR_ASSERTION]: (d) [M4] no fleet/tests/test_*.mjs spawns another test_*.mjs or pytest \u2014 the bridge is what runs them:\nE               test_worker_kata_ref.mjs:511 (runs another sim) execFileSync(process.execPath, [path.relative(REPO_ROOT, simPath)], { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })\nE             + actual - expected\nE             \nE             + [\nE             +   \"test_worker_kata_ref.mjs:511 (runs another sim) execFileSync(process.execPath, [path.relative(REPO_ROOT, simPath)], { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })\"\nE             + ]\nE             - []\nE             \nE                 at file:///home/exedev/target/.claude/ultrapowers/run-run-119/clones/integration/fleet/tests/test_sims_are_hermetic.mjs:846:10\nE                 at file:///home/exedev/target/.claude/ultrapowers/run-run-119/clones/integration/fleet/tests/test_sims_are_hermetic.mjs:1086:5\nE             ok (1 ms) \u2014 the same sweep names each shape of a sim running another  [M4 / leg (d)]\nE             ok (1 ms) \u2014 test_run_engine_candidate_bootstrap.mjs reads its sibling list and runs none of it  [M4 / leg (e)]\nE             ok (0 ms) \u2014 test_sandbox_boot_render_env.mjs reads its sibling list and runs none of it  [M4 / leg (e)]\nE             ok (2 ms) \u2014 test_sandbox_boot_state_exams.mjs reads its sibling list and runs none of it  [M4 / leg (e)]\nE             ok (0 ms) \u2014 test_launch_render.mjs reads its sibling list and runs none of it  [M4 / leg (e)]\nE             ok (1 ms) \u2014 test_launch_test_command.mjs reads its sibling list and runs none of it  [M4 / leg (e)]\nE             ok (1 ms) \u2014 test_setup_script_render_env.mjs reads its sibling list and runs none of it  [M4 / leg (e)]\nE             ok (0 ms) \u2014 test_run_engine_state_exams.mjs reads its sibling list and runs none of it  [M4 / leg (e)]\nE             ok (1 ms) \u2014 the probe imports nothing from child_process  [M7 / leg (f)]\nE             ok (0 ms) \u2014 the fixture is swept to exactly three offenders, one per rule  [M7 / leg (g)]\nE             ok (1 ms) \u2014 the sweep reaches exams/<slug>/test_*.mjs and holds an exam to the same rules  [#890 / leg (j)]\nE             ok (0 ms) \u2014 tests/test_fleet_suite.py binds env=sim_env() on the node it runs  [M6 / leg (h)]\nE             ok (1 ms) \u2014 fleet/sandbox-boot.sh names /etc/fleet/render.env once, as its default  [M5 / leg (i)]\nE             ok (3 ms) \u2014 the boot rig pins FLEET_RENDER_ENV under every case's own home  [M5 / leg (i)]\nE             2 FAILED\nE             \nE           assert 1 == 0\nE            +  where 1 = CompletedProcess(args=['node', '/home/exedev/target/.claude/ultrapowers/run-run-119/clones/integration/tests/../fleet/...]\\nok (3 ms) \u2014 the boot rig pins FLEET_RENDER_ENV under every case\\'s own home  [M5 / leg (i)]\\n2 FAILED\\n', stderr='').returncode\n\ntests/test_fleet_suite.py:166: AssertionError\n=============================== warnings summary ===============================\ntests/test_harvest_fleet_runs.py::test_discover_unpacks_a_tarball\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\ntests/test_harvest_fleet_runs.py::test_a_corrupt_tarball_among_healthy_ones_is_named_and_the_rest_land\ntests/test_harvest_fleet_runs.py::test_an_unreadable_tarball_is_named_in_a_whole_failed_lookup_line\n  /usr/lib/python3.12/tarfile.py:2301: DeprecationWarning: Python 3.14 will, by default, filter extracted tar archives and reject files or modify their metadata. Use the filter argument to control this behavior.\n    warnings.warn(\n\n-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html\n=========================== short test summary info ============================\nFAILED tests/test_fleet_suite.py::test_fleet_mjs[test_sims_are_hermetic.mjs]\n============ 1 failed, 1563 passed, 5 warnings in 425.34s (0:07:05) ============\n"}, "verdict": "NEEDS_ACK"}

```

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-119/.ultrapowers/runs/119/

- claude-version.txt
- engine.log
- events.jsonl
- gate-receipt.json
- kata.jsonl
- pr-body.md
- publish-fold
- receipt.json
- report.json
- residuals.jsonl
- status.json
- transcripts

### Plan

https://github.com/popmechanic/ultrapowers/blob/ultra/plan/run-119/.ultrapowers/plan.md

### Residuals

- [ ] deferred:external — Task 1 Claim, operator sentence: "launch any plan and look at a running worker's environment on the sandbox. see: the worker carries the reference to its own kata issue" — KATA_REF observed on a live implementer's environment on a real sandbox VM. — The end-to-end chain terminates at a real kata hub (https://kata.int.exe.xyz) and a provisioned sandbox, neither reachable from this read-only tree. Structurally complete and verified at the seam instead: fleet/launch.mjs:1393-1421 writes short_id into the record, fleet/run-main.mjs:437-449 and :835-836 build KATA_REF from it, and fleet/tests/test_worker_kata_ref.mjs legs (a)+(b) drive the launcher's own written bytes through run-main's envFor against a recording fake hub. [structural false-green: sandbox could not execute it against the target]
- [ ] deferred:external — Task 1 Claim, downstream consequence: "the notes, stuck signals and needs-review label the roles teach can actually land on that issue" — an actual kata write from a worker holding the new KATA_REF. — Requires a worker session posting to the live hub. The consuming side is present in the tree (fleet/roles/implementer.md, fleet/roles/fix.md, fleet/roles/examiner.md all read KATA_REF), but whether a note lands on the issue cannot be exercised here. [structural false-green: sandbox could not execute it against the target]
- [ ] task 1 reviewer — Scope creep / dead code in `fleet/launch.mjs`: the patch adds `export { fileRunOnHub, fileRunOnHub as buildKataRecord }` after the record writer, with a comment claiming it is "Exported so a sim can drive it against a fake hub without a whole launch". No sim does: the exam `fleet/tests/test_worker_kata_ref.mjs` imports only `launch` from `../launch.mjs` and drives the writer through a full `launchIn(...)`, and `buildKataRecord` appears nowhere else in `fleet/` or `skills/`. Nothing in the task's Machine clauses or Proof legs asks for a new module export, so this widens `launch.mjs`'s public surface with a second, unused name for a private helper. Drop both names (the alias and the bare re-export) unless a later task consumes them.
- [ ] task 1 reviewer — unverified: the M5 refusal orphans what it already filed on the hub. The new `throw new Refusal(...)` sits inside `fileRunOnHub`'s create loop, after `hub.createProject` and one or more `hub.createIssue` calls have succeeded
- [ ] task 1 reviewer — the purge the launcher owns runs as `if (filed !== null) await kataPurge(filed.record)` (fleet/launch.mjs:1330) on the value `kataStep(n)` *returns*, so a throw from inside the writer never reaches it and the run's project plus its issues stay on the hub. The exam's leg (e) pins the local consequences only (no plan branch, no push, no `.ultrapowers/kata.json`, no mutating lobby verb) and cannot see hub state, and the sibling `names an edge ... between tasks it did not list` Refusal in the same function already has this shape, so this diff does not introduce the pattern — but it does add a second path to it, and M5 does not say what should happen to the filed project. What would settle it: a leg asserting the fake hub recorded a `purgeProject` call after the short_id refusal, or an explicit statement in the task that a short_id refusal leaves the project filed.
- [ ] task 1 reviewer — Scope: `fleet/launch.mjs` adds `export { fileRunOnHub, fileRunOnHub as buildKataRecord }` (patch hunk at launch.mjs, just after `fileRunOnHub`), whose own comment says it exists "so a sim can drive it against a fake hub without a whole launch" — but no sim in this diff imports either name. The task's exam `fleet/tests/test_worker_kata_ref.mjs` drives the writer through `launch()` (legs (a) and (e)), and neither `test_launch_kata.mjs` nor `test_worker_kata_env.mjs` imports it. Nothing in the Claim, M1–M5 or the Proof legs requires the module's public surface to grow, and the alias gives one function two exported names. Suggest dropping the export block
- [ ] task 1 reviewer — if a future sim wants the writer directly, export it then, under one name.
- [ ] task 1 reviewer — Exam noise: EXAM EVIDENCE for `node fleet/tests/test_worker_kata_ref.mjs` exits 0 but prints `fatal: couldn't find remote ref ultra/integration-run-7` to stderr. The source is the `execStub` git branch in `fleet/tests/test_worker_kata_ref.mjs` (leg (b)'s `runMainFlow`): `execFileSync('git', argv, { cwd: opts.cwd, env, encoding: 'utf8' })` leaves stdio at the default, so a failing child git's stderr is inherited by the exam process rather than captured into the returned `stderr` field the stub pretends to fill (`stderr: ''`). No assertion is affected — `flow.out.code === 0` is asserted and holds — but a green exam that prints `fatal:` reads as a failure to whoever runs it, and the stub's error path cannot report what it swallowed. Pin stdio on the child.
- [ ] task 1 reviewer — unverified: the Claim's outer sentence — "Every worker of a task whose issue is on the hub runs with `KATA_REF=<project>#<short_id>` in its environment" — is established here only at the `envFor` seam (leg (b) reads the seam run-main hands `makeAgent`, with the engine and `claude` stubbed). The Context's measured symptom was a live run-117/118 worker whose environment carried no `KATA_REF`
- [ ] task 1 reviewer — nothing in this diff or in RUN/EXAM EVIDENCE exercises an actual VM, so the last hop — engine → `makeAgent` → spawned worker process env — is unverified by this patch, correctly so given the global constraint that the engine and worker stay untouched. What would settle it: the first live run launched after this lands, checking that an implementer's env shows `KATA_REF=<owner>-<repo>-run-<N>#<short id>`.

</details>

Closes #963
