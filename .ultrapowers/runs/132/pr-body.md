This teaches the engine to start a relaunch from what a parked run already got right, instead of doing every task again. It exists because the record of this month prices a park at the whole plan, and the reading on the run-98 to run-99 pair shows a re-drive pays a finished task's full cost a second time. After this run, relaunching a parked plan works only the tasks that did not finish, and the suite and gate still judge the whole tree before anything merges.

**Merge-ready**

> When I relaunch a parked plan, the tasks that already finished are folded in from the parked run's record and only the unfinished ones are worked, and the run's gate still runs on the whole tree.

| task | claim | exam | probes | mutant | suite |
|---|---|---|---|---|---|
| 1 | After this run, every task the engine closes as done carries on its issue which run adopted it and at which commit, so a later run can read that without opening the run's record. | red at BASE → green | 1/1 | — | — |
| 2 | When I relaunch a parked plan, the tasks that already finished are folded in from the parked run's record and only the unfinished ones are worked, and the run's gate still runs on the whole tree. | red at BASE → green | 3/3 | — | — |

Residuals: 7 from review

<details><summary>Record</summary>

## fleet run-132 — gate-green

| | |
|---|---|
| verdict | `PASS` |
| target | `popmechanic/ultrapowers` at `a595598a91c7d663fbbfcfcb930b55418e134753` |
| engine | `a595598a91c7d663fbbfcfcb930b55418e134753` |
| plan | `.ultrapowers/plan.md` at `dc66627c934cf1937af1331809d0ad343f2e7921` |
| branch | `ultra/integration-run-132` |
| vm | `fleet-r132-2609150148-06ad` |

### Checks

```json
{"mode": "gate", "stamp": "run-132", "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-132/report.json", "branch": "ultra/integration-run-132", "gateCheck": {"verdict": "PASS", "checks": [{"name": "report-parse", "ok": true, "detail": ""}, {"name": "clean-tree", "ok": true, "detail": ""}, {"name": "wave-merges", "ok": true, "detail": ""}, {"name": "head-match", "ok": true, "detail": ""}, {"name": "git-verified", "ok": true, "detail": ""}, {"name": "ancestry", "ok": true, "detail": ""}, {"name": "deliverables", "ok": true, "detail": ""}], "notes": [], "repo": "/home/exedev/target"}, "gateCheckExit": 0, "suite": {"passed": true, "unattributed": [], "output": "============================= test session starts ==============================\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\nrootdir: /home/exedev/target/.claude/ultrapowers/run-run-132/clones/integration\nconfigfile: pytest.ini\ntestpaths: tests\nplugins: xdist-3.4.0\ncreated: 3/3 workers\n3 workers [149 items]\n\n........................................................................ [ 48%]\n........................................................................ [ 96%]\n.....                                                                    [100%]\n============================= 149 passed in 32.29s =============================\n"}, "verdict": "PASS"}

```

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-132/.ultrapowers/runs/132/

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

https://github.com/popmechanic/ultrapowers/blob/ultra/plan/run-132/.ultrapowers/plan.md

### Residuals

- [ ] task 1 reviewer — unverified: the `null` branch of the run-number parse is implemented and now asserted by the contract, but no exam leg exercises it. `fleet/run-engine.mjs:1143` writes `Number.isFinite(n) ? n : null`, and the CONTRACT sentence this task added says `work.adopted_run` is "`null` when the stamp is not `run-<N>`" — yet every hub-driving case in fleet/tests/test_run_engine_kata_close.mjs uses `stamp: 'run-12'` (the M3 case passes no hub at all), so deleting the `: null` fallback and letting a `NaN` reach `patchMetadata` leaves the exam green. M1 only names the integer case, so this is advisory, not a missing criterion. What would settle it: a fourth block reusing `makeFakeKata` and `WAVES()` with the rig's default `stamp = 'sim'` plus the same `kataRecord`, asserting task 1's `patchMetadata` patch deep-equals `{'work.adopted_run': null, 'work.adopted_sha': SHA}` — in particular that the value is `null` and not a `NaN` the hub would have to store.
- [ ] task 2 reviewer — Scope creep in `fleet/tests/_engine_helpers.mjs`: beyond the edit the task's Context names verbatim ("The rig edit is Task 1's literal, made identically here: `kata = undefined` in `rig`'s parameters and `...(kata === undefined ? {} : { kata })` into `runEngine({...})`"), the diff also adds an `exec = execSeam` parameter and rewires `exec: execSeam` to `exec`. Nothing uses it: the exam `fleet/tests/test_run_engine_reuse.mjs` does not call the shared `rig` at all — it declares its own `reuseRig`, a full copy of `rig`'s body with the recording seam inlined. So the knob is dead code, and it is dead code in a file the sibling task edits at the same hunk with the plan's literal, which is where a wave fold would have to reconcile two different versions of the same addition. Either use the shared knob from the exam or drop it
- [ ] task 2 reviewer — the copy of `rig` is justified by `onPhase`/`onExec`/`baselineDir`, the `exec` parameter is not.
- [ ] task 2 reviewer — Global constraint (prose, no `Check:` behind it): "a hub read the reuse needs that fails, or a tag that cannot be fetched, means no reuse and the full plan runs." The tag half is honoured — a non-zero fetch refuses. The read half is not: `openKataTask` treats a *failed* read and a *mismatched* read identically — `kataCall('getissue', …)` returns `null` on any transport failure (`fleet/run-engine.mjs:1030-1039`), and `if (!issue || issue.revision !== row.revision) throw kataFatal(…)` then ends the whole run as `kata-revision-mismatch`. Because the read moved to setup for every task of every wave, one transient failure on any task's issue now aborts the run before wave 1 rather than refusing reuse and running the full plan. I read the constraint as separating the two: a null answer (the hub did not answer) should refuse reuse and let the plan run, while a revision that came back and disagrees stays fatal — which is what M1's "the mismatch rule is unchanged" preserves. Both can hold at once
- [ ] task 2 reviewer — the diff collapses them. Note this is BASE's own conflation, not one this diff introduced, which is why it is minor: `if (!issue) return` (leaving the task unreused and its sheet uncomputed) versus the existing throw on a revision that disagrees would satisfy both.
- [ ] task 2 reviewer — unverified: two legs of the Claim that this diff cannot settle on its own. (1) Cross-task — the reused set is discovered from `work.adopted_run` / `work.adopted_sha`, the keys the sibling task writes at close
- [ ] task 2 reviewer — every sim here seeds them by hand into a fake hub, so nothing in this patch shows a real relaunch reading a real stamp. What would settle it: an end-to-end run of the two tasks together on the folded tree, or the sibling's own exam landing and the pair being exercised once against a live hub. (2) The `main=`-empty case — the most likely production shape, a relaunch at exactly the parked run's base, is deliberately excluded by the exam's origin (`makeParkedOrigin` always advances main past the parked base, and the header says "the reuse fold's `main=` side is never empty"). The implementer's comment that no special case is needed is correct — `skills/ultrapowers/kernel/repo_weave.py:87` states "An empty patch is a task that changed nothing (tree == base's tree)" — and a wrong reading would only degrade to a refusal, so this is coverage rather than a defect. What would settle it: one more refusal-shaped or reuse-shaped sim with BASE equal to `report.baseSha`.

</details>

Closes #383
