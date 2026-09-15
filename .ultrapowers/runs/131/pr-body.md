This makes the kata hub hold one project per repository, so every run's tasks land in the same place and a plan can be filed twice without doubling up. It exists because the run-127 park showed a task can depend on a sibling through its proof alone, an edge nothing filed, and because per-run projects orphan their record. After this run you can relaunch a parked plan and see its open tasks resume rather than reappear, and a task whose proof runs a sibling's file waits on that sibling instead of failing red.

**Merge-ready**

> One kata project per target repository, not per run: the launcher files a run's tasks as issues into the target's project, each carrying its `Consumes:`/`Produces:` edges as `--blocked-by`, plus the edge the compiler derives from a `Run:` or `Check:` that names a path in a sibling task's Files (the seam run-127's task 1 failed on — see the 2026-09-14 comment on #810). The plan stays an idempotent seed: re-filing the same plan creates nothing twice.

| task | claim | exam | probes | mutant | suite |
|---|---|---|---|---|---|
| 1 | After this run, a task whose proof runs a file another task owns is placed after that task, and a plan whose run-wide check runs a file one task owns is refused before anything is filed. | red at BASE → green | — | — | — |
| 2 | After this run, every launch against one repository files into that repository's one kata project, filing the same plan twice creates no second issue for any task, each task's edges are on the hub as blocks links, and a launch whose run number bumps refiles under the new number without purging anything. | red at BASE → green | 5/5 | — | — |
| 3 | After this run, the janitor still reads a run's state off the hub when every run of a target shares one project. | red at BASE → green | 2/2 | — | — |
| 4 | After this run, the `kata.jsonl` a run leaves on its evidence tag holds only that run's issues and events, even though the project on the hub holds every run of the repository. | red at BASE → green | 1/1 | — | — |

Residuals: 18 from review

<details><summary>Record</summary>

## fleet run-131 — gate-green

| | |
|---|---|
| verdict | `PASS` |
| target | `popmechanic/ultrapowers` at `c3c8fa9bbf1d6a339b81a81234a41066720dd94f` |
| engine | `c3c8fa9bbf1d6a339b81a81234a41066720dd94f` |
| plan | `.ultrapowers/plan.md` at `7ca1e3428c69057206a053ccabc810f602f4a329` |
| branch | `ultra/integration-run-131` |
| vm | `fleet-r131-2609150128-02c8` |

### Checks

```json
{"mode": "gate", "stamp": "run-131", "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-131/report.json", "branch": "ultra/integration-run-131", "gateCheck": {"verdict": "PASS", "checks": [{"name": "report-parse", "ok": true, "detail": ""}, {"name": "clean-tree", "ok": true, "detail": ""}, {"name": "wave-merges", "ok": true, "detail": ""}, {"name": "head-match", "ok": true, "detail": ""}, {"name": "git-verified", "ok": true, "detail": ""}, {"name": "ancestry", "ok": true, "detail": ""}, {"name": "deliverables", "ok": true, "detail": ""}], "notes": [], "repo": "/home/exedev/target"}, "gateCheckExit": 0, "suite": {"passed": true, "unattributed": [], "output": "============================= test session starts ==============================\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\nrootdir: /home/exedev/target/.claude/ultrapowers/run-run-131/clones/integration\nconfigfile: pytest.ini\ntestpaths: tests\nplugins: xdist-3.4.0\ncreated: 4/4 workers\n4 workers [147 items]\n\n........................................................................ [ 48%]\n........................................................................ [ 97%]\n...                                                                      [100%]\n============================= 147 passed in 26.86s =============================\n"}, "verdict": "PASS"}

```

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-131/.ultrapowers/runs/131/

- approve-receipt.json
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

https://github.com/popmechanic/ultrapowers/blob/ultra/plan/run-131/.ultrapowers/plan.md

### Residuals

- [ ] task 1 reviewer — The new refusal is wired only into `collect_violations` (the `--check` path). `main`'s compile-path grammar bundle at compile_plan.py ~2612-2615 — where its sibling `constraint_check_violations(plan_text)` already sits — was not extended, so a plain compile or `--emit-launch` of a plan whose run-wide `- Check:` names a task-owned path still exits 0 and emits a payload. M4 is scoped to `--check`, so this is not a gap against the exam, and the Claim's "refused before anything is filed" does hold in practice because `fleet/launch.mjs:641` runs `compile_plan.py --check --base` before any lobby verb. But the asymmetry with the backtick check is a trap for any consumer that compiles without `--check`
- [ ] task 1 reviewer — one line closes it.
- [ ] task 1 reviewer — The compiler's emitted `why` labels are enumerated in two reference docs that this task's FILES do not cover: `skills/ultrapowers/references/dependency-analysis.md:83` ("Edge `why` labels emitted by the compiler: `marker`, `text`, `interface`, `write-after-create`.") and `skills/ultrapowers/references/plan-markers.md:64`. Neither lists `proof-run`. Both were already stale at BASE (neither lists `non-text-overlap` either), so this is not a regression the diff introduces alone, but the new tier widens the gap and the fix lies outside this task's FILES.
- [ ] task 1 reviewer — Inside the new `proof-run` tier, `task_files(a)` is rebuilt from four `t.get(...)` lists on every (b, cmd, a) triple, and `sorted(...)` materializes a list that is only ever tested for emptiness. This file already carries a documented fix for exactly this shape (compile_plan.py:2055, "Fix E: ... measured superlinear blowup >= 80 tasks"), which hoisted per-task state out of the O(N^2) pair loops. Hoisting the Files sets into one dict and replacing the sort with `any(...)` matches that discipline and changes no behavior.
- [ ] task 2 reviewer — unverified: cross-task edge. `fleet/janitor.mjs:332` (task 3's file, outside this task's FILES) still calls `kataProjectFor(target, run)` with two arguments, and its doc comment at ~20 still says `<owner>-<repo>-run-<N>`. With this patch's one-argument `kataProjectFor` the extra argument is simply ignored and the janitor happens to look up the new, correct project name, so nothing breaks at integration — but the janitor's call site and comment are only settled when task 3 lands. What would settle it: task 3's diff, or `node fleet/tests/test_janitor.mjs` on the merged tree.
- [ ] task 2 reviewer — `fleet/tests/test_launch_size.mjs`, fake hub `link`: the predicate `links.find((l) => l.from === fromUid && l.type === spec?.type && spec?.type === 'parent')` folds the parent test into the search, so for any non-parent type the find can never match and every repeated `blocks` link is pushed again. Harmless for that sim's legs (it only counts calls), but it no longer models the live hub's idempotent `blocks` the way the new exam's fake does, so a future leg reading that fake's link store would read duplicates. The exam's own fake (`fleet/tests/test_launch_kata_seed.mjs`) already has the correct shape — mirroring it here would remove the divergence.
- [ ] task 2 reviewer — plan-defect: the run issue's create now carries an `Idempotency-Key` (`<target>:<plan sha>:run-<N>`, as the task's Context prescribes) while keeping the body it has today — `metadata: {run, target, base, closes}` (`fleet/launch.mjs`, `fileRunOnHub`). `base` is not derived from the plan text, so relaunching the same plan text at the same N against a different `--base` replays that key with a different fingerprint and the hub answers 409 `idempotency_mismatch`, which surfaces as a `LobbyError` from `kataCall('createIssue', …)` rather than a legible refusal. No Machine clause covers the run issue's create body (M2 constrains only task creates), so this blocks nothing
- [ ] task 2 reviewer — if the sharp edge matters, the same treatment the tasks got would fix it — create the run issue with `{run, target}` only and patch `{base, closes}` on after the read.
- [ ] task 3 reviewer — unverified: cross-task edge, not settleable from this diff. `fleet/lobby.mjs`'s `kataProjectFor` now takes one argument, but `fleet/launch.mjs:1541` (sibling-owned by Task 2) still calls `kataProjectFor(target, n)` and `fleet/tests/test_launch_bump.mjs:103` pins `projectName(n) = 'popmechanic-smoke-run-' + n`, asserted at ~406 and ~480. On this task's tree alone the extra argument is silently ignored, so those launch sims go red until Task 2's matching change to `fleet/launch.mjs`, `fleet/tests/test_launch_bump.mjs` and `fleet/tests/test_launch_size.mjs` merges. This is exactly what the task text directs ("Task 2 makes the identical one-line change for the launcher, so make exactly this edit and no other in that file"), and the fix lies outside this task's FILES, so nothing here should change. What would settle it: `node fleet/tests/test_launch_bump.mjs` and `node fleet/tests/test_launch_size.mjs` on the tree with Tasks 2 and 3 both merged.
- [ ] task 3 reviewer — Test hygiene in `fleet/tests/test_janitor.mjs`: the new T3 block mutates shared module state with `LIVE_DESTS.add(dest(4))` at top level. `LIVE_DESTS` is the allow-list the closing `(g)/M5` sweep checks every leg's ssh destinations against, and run 4 appears in `LEG_A` (line 260) with state `parked` — i.e. not live — so before this change `dest(4)` was absent from the set and leg (a)'s executions were covered by `(g)/M5`. After it, an ssh into run 4's destination in leg (a) would no longer be caught by that sweep. The loosening is bounded in practice: leg (a) pins `exec.vm()` by equality at ~327-333 and both T3 legs pin theirs by equality too, so no criterion is left unverified — hence minor, not blocking. If you want the sweep kept as tight as the peer wrote it, gate the allowance per-exec (e.g. a map from exec to its own extra live destinations consulted inside the `(g)` loop) rather than widening the global set.
- [ ] task 3 reviewer — concern: sibling-interim-red: fleet/tests/test_launch_bump.mjs is red in my tree. The one-line kataProjectFor change the task told me to make in fleet/lobby.mjs also reaches fleet/launch.mjs:1541, which still calls kataProjectFor(target, n) and so now files 'popmechanic-smoke' where that sim's line 103 expects 'popmechanic-smoke-run-<N>'. Both fleet/launch.mjs and fleet/tests/test_launch_bump.mjs are sibling task 2's declared scope and task 2 makes the identical lobby.mjs edit, so I left them untouched
- [ ] task 3 reviewer — the red resolves when task 2 lands. Every other fleet sim passes.
- [ ] task 3 reviewer — concern: note: fleet/janitor.mjs's module docstring points at fleet/tests/test_janitor_hub.mjs as the hub path's exam, but no such file exists at BASE. I left the reference as-is — the task's Proof names fleet/tests/test_janitor.mjs and the peer's exam lands there.
- [ ] task 4 reviewer — Robustness, not a required criterion: `kata_assemble` (fleet/sandbox-boot.sh:1400-1417) builds the uid set defensively — a missing `run.uid` or a non-dict `tasks` simply contributes nothing — so a `$KATA_FILE` that reads as JSON but names no uid at all yields an EMPTY `mine`, the filter drops every row, the helper exits 0, and the caller's `mv` at line 1346 replaces the previously-exported whole `kata.jsonl` with a zero-byte file. Every other 'the answer did not read' path in `kata_export` deliberately keeps the previous whole export (lines 1309-1313, 1321-1325, 1341-1345)
- [ ] task 4 reviewer — an empty uid set is the same kind of unreadable record and should take the same branch. The Global Constraints' pinned `.ultrapowers/kata.json` shape always carries `run.uid`, so this is not reachable through the launcher's own record today — hence minor — but the failure mode is silent loss of the record the export exists to preserve. M1-M4 are all settled by the exam (EXAM EVIDENCE exit 0) and the CONTRACT reader (RUN EVIDENCE exit 0)
- [ ] task 4 reviewer — no criterion depends on this.
- [ ] task 4 reviewer — Prose nit in fleet/CONTRACT.md:89: the rewritten `kata.jsonl` bullet leaves a ragged short line mid-paragraph (`names no issue is exported. Exported at every`) in a document whose lines are otherwise wrapped near column 99. Content is correct and the Proof's `Run:` reader passes either way
- [ ] task 4 reviewer — only the wrap is off.

</details>

Closes #978
