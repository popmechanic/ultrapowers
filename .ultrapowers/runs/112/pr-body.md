#830 gave the three single-dispatch judgments one bounded retry after a 60 s backoff, and held the event loop open through that wait with an `fs.watch(runDir)` handle beside an unref'd timer. Measured today at BASE (`c80279f3`): when that watch throws — EMFILE, a box without inotify, or a stub — node exits 13 mid-await and the run writes no report, which is worse than a null judgment parking cleanly. The same lane awaits two full backoffs when both halves of a review pair die, and the kept-reply condition is spelled twice. This plan replaces the watch with the timer alone (ref'd, cleared the moment the wait ends), gives a dead pair one shared backoff before both re-dispatches, and folds the two `kept` sites into one helper — with the sim gaining a throwing-`fs.watch` case, a real-timer liveness case, and a clock-free one-backoff assertion for the pair.

**Merge-ready**

> do: run a plan whose judgment dies mid-retry on a box where file-watching fails. see: the worker still gets its second try and the run still reports; a review pair that both die waits once; the kept-implementer rule is written once.

| task | claim | exam | probes | mutant | suite |
|---|---|---|---|---|---|
| 1 | After the run, a judgment whose worker died `infra` still gets its one re-dispatch on a box where `fs.watch` throws — the run reaches its report instead of dying 13 mid-wait; a review pair whose two halves both died waits the backoff once, not twice, before both are re-asked; and the engine spells the kept-implementer condition in one place. | red at BASE → green | — | — | — |

Residuals: 3 from review

<details><summary>Record</summary>

## fleet run-112 — gate-green

| | |
|---|---|
| verdict | `PASS` |
| target | `popmechanic/ultrapowers` at `17e72bc2f9274d681e833c6a2aaa9061f03c275b` |
| engine | `17e72bc2f9274d681e833c6a2aaa9061f03c275b` |
| plan | `.ultrapowers/plan.md` at `4ad67cff5b74f95a306fb52c030601e6d4ad3c68` |
| branch | `ultra/integration-run-112` |
| vm | `fleet-r112-2609120137-26c7` |

### Checks

```json
{"mode": "gate", "stamp": "run-112", "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-112/report.json", "branch": "ultra/integration-run-112", "gateCheck": {"verdict": "PASS", "checks": [{"name": "report-parse", "ok": true, "detail": ""}, {"name": "clean-tree", "ok": true, "detail": ""}, {"name": "wave-merges", "ok": true, "detail": ""}, {"name": "head-match", "ok": true, "detail": ""}, {"name": "git-verified", "ok": true, "detail": ""}, {"name": "ancestry", "ok": true, "detail": ""}, {"name": "deliverables", "ok": true, "detail": ""}], "notes": [], "repo": "/home/exedev/target"}, "gateCheckExit": 0, "suite": {"passed": true, "unattributed": [], "output": "============================= test session starts ==============================\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\nrootdir: /home/exedev/target/.claude/ultrapowers/run-run-112/clones/integration\nconfigfile: pytest.ini\ntestpaths: tests\nplugins: xdist-3.4.0\ncreated: 6/6 workers\n6 workers [1538 items]\n\n........................................................................ [  4%]\n........................................................................ [  9%]\n........................................................................ [ 14%]\n........................................................................ [ 18%]\n........................................................................ [ 23%]\n........................................................................ [ 28%]\n........................................................................ [ 32%]\n........................................................................ [ 37%]\n........................................................................ [ 42%]\n........................................................................ [ 46%]\n........................................................................ [ 51%]\n........................................................................ [ 56%]\n........................................................................ [ 60%]\n........................................................................ [ 65%]\n........................................................................ [ 70%]\n........................................................................ [ 74%]\n........................................................................ [ 79%]\n........................................................................ [ 84%]\n........................................................................ [ 88%]\n........................................................................ [ 93%]\n........................................................................ [ 98%]\n..........................                                               [100%]\n=============================== warnings summary ===============================\ntests/test_harvest_fleet_runs.py::test_discover_unpacks_a_tarball\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\ntests/test_harvest_fleet_runs.py::test_a_corrupt_tarball_among_healthy_ones_is_named_and_the_rest_land\ntests/test_harvest_fleet_runs.py::test_an_unreadable_tarball_is_named_in_a_whole_failed_lookup_line\n  /usr/lib/python3.12/tarfile.py:2301: DeprecationWarning: Python 3.14 will, by default, filter extracted tar archives and reject files or modify their metadata. Use the filter argument to control this behavior.\n    warnings.warn(\n\n-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html\n================= 1538 passed, 5 warnings in 363.12s (0:06:03) =================\n"}, "verdict": "PASS"}

```

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-112/.ultrapowers/runs/112/

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

https://github.com/popmechanic/ultrapowers/blob/ultra/plan/run-112/.ultrapowers/plan.md

### Residuals

- [ ] task 1 reviewer — unverified: the Acceptance is `suite`, but the evidence covers only this task's exam plus the three Proof `Run:` commands (`test_run_engine_infra_retry.mjs`, `test_run_engine_pre_review.mjs`, the grep pin). The three engine edits — `waitInfraBackoff` losing its `fs.watch` hold and `unref()`, `retryInfraNull` split into `noteInfraDeath`/`redispatchInfra`, and the pair lane's one-wait concurrent re-ask at `fleet/run-engine.mjs:2312-2319` — are engine-internal, so nothing in the diff settles the rest of `tests/test_fleet_suite.py`. Mitigating: grep across `fleet/` finds `retryInfraNull`, `infra-retry` and `infraBackoffMs` only in `fleet/run-engine.mjs` and `fleet/tests/test_run_engine_infra_retry.mjs`, and `fs.watch` only at the one line this patch deletes, so no other sim can reach the changed branches (a reviewer pair that never returns `null` never enters the new `if (r1 === null || r2 === null)` block). What would settle it: one run of `tests/test_fleet_suite.py`, which is also what joins the guarded sim to the suite through its `fleet/tests/test_*.mjs` glob.
- [ ] task 1 reviewer — unverified: the diff restructures the pair-review lane (fleet/run-engine.mjs :2329-2344 in PATCH) and re-routes both examiner `kept` sites through the new `keptReply` helper — code that other committed sims exercise (`fleet/tests/test_run_engine_review_pair.mjs`, `test_run_engine_review_peer.mjs`, `test_run_engine_examiner.mjs`, `test_run_engine_fixloop.mjs`). The Proof's `Run:` lines cover only `test_run_engine_infra_retry.mjs` and `test_run_engine_pre_review.mjs`, and the task's Acceptance is `suite`. Nothing in the diff suggests a regression — the record literals and the `driver:infra-retry` payload are byte-identical, the single-death path (`retryInfraNull`) is the BASE sequence recomposed from the three moves, and `keptReply` is the BASE expression verbatim — but the diff alone cannot settle it. What would settle it: `python3 -m pytest tests/test_fleet_suite.py` (or running the remaining `fleet/tests/test_run_engine_*.mjs` sims), green.
- [ ] task 1 reviewer — Code quality: `keptReply` (fleet/run-engine.mjs, the new line beside `hasCoordinates`) dereferences `r.status` without a null guard, while both of its neighbours in that cluster — `hasCoordinates = (r) => r && …` and `isMergeable = (r) => r && …` — are null-safe. Both current call sites are downstream of `if (impl === null) throw` (:1861 at BASE), so there is no live defect and no regression against BASE, which spelled the same unguarded dereference inline. But extracting the condition into a named helper next to two null-safe siblings invites a third caller that passes a `null` reply and gets a TypeError instead of `false`. Suggested fix, which keeps M4's one-line grep count at 1 (the fragment `DONE_WITH_CONCERNS') && hasCoordinates(` still occurs exactly once): `const keptReply = (r) => !!r && (r.status === 'DONE' || r.status === 'DONE_WITH_CONCERNS') && hasCoordinates(r)`.

</details>

Closes #857
