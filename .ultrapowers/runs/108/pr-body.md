Today a peer-written exam case that no implementation can satisfy is a guaranteed park: the fix round may not edit the exam, and the reviewer — the one reader allowed to propose an exam patch — never sees a task whose pre-review pass stays red. This plan opens exactly one door: when the repair round's own reply says an exam case cannot pass (the `exam:` concern `fleet/roles/fix.md` already asks for), the task goes to review round 1 with that concern on the prompt, and the loop that already exists does the rest — the reviewer proposes the exam patch, the fix round applies it, the edit is recorded as `examEdited`, round 2 re-grades a green exam. A red exam still outranks every reviewer verdict, so a lazy implementer's concern buys a second independent reader, never a merge.

**Parked:** parked: gate verdict NEEDS_ACK

> If the implementer's repair-round output carries a finding that names an exam case and says it cannot pass for any output (the shape run-99's implementer wrote: "cannot pass for any report output. Its `_section` helper reads … the case then asserts the line before the note equals that same last entry"), the task goes to the referee with that finding attached, exactly as a blocking review finding would; the referee, which already owns the PROPOSED PATCH mechanism for exam edits (run-96 used it), can propose the exam fix, the implementer applies it as an `examEdited` edit (recorded, named to the referee, reviewed — the 2026-09-02 rule), and the task proceeds. A repair round that is red with no such finding parks as today.

| task | claim | exam | probes | mutant | suite |
|---|---|---|---|---|---|
| 1 | After the repair round, a task whose exam is still red and whose repair round wrote down that an exam case cannot pass goes to the reviewer with that finding on the prompt; the reviewer's proposed exam patch is applied by the fix round, recorded as `examEdited`, and the task merges — while the same red with no such finding parks `proof-red` exactly as today, and a reviewer that waves the red through still cannot merge it. | red at BASE → green | — | — | — |

Residuals: 12 from review

<details><summary>Record</summary>

## fleet run-108 — parked

| | |
|---|---|
| verdict | `NEEDS_ACK` |
| target | `popmechanic/ultrapowers` at `f5735a3aa6be17a684a917373b36c2e40dd65b48` |
| engine | `f5735a3aa6be17a684a917373b36c2e40dd65b48` |
| plan | `.ultrapowers/plan.md` at `89ce47c7d406e798c1bf8e3c3721b7ab4b357b25` |
| branch | `ultra/integration-run-108` |
| vm | `fleet-r108-2609112216-94d3` |

### Checks

```json
{"mode": "gate", "stamp": "run-108", "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-108/report.json", "branch": "ultra/integration-run-108", "gateCheck": {"verdict": "NEEDS_ACK", "checks": [{"name": "report-parse", "ok": true, "detail": ""}, {"name": "clean-tree", "ok": true, "detail": ""}, {"name": "wave-merges", "ok": true, "detail": ""}, {"name": "head-match", "ok": true, "detail": ""}, {"name": "git-verified", "ok": true, "detail": ""}, {"name": "ancestry", "ok": true, "detail": ""}, {"name": "deliverables", "ok": true, "detail": ""}], "repo": "/home/exedev/target"}, "gateCheckExit": 2, "suite": {"passed": true, "unattributed": [], "output": "============================= test session starts ==============================\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\nrootdir: /home/exedev/target/.claude/ultrapowers/run-run-108/clones/integration\nconfigfile: pytest.ini\ntestpaths: tests\nplugins: xdist-3.4.0\ncreated: 6/6 workers\n6 workers [1531 items]\n\n........................................................................ [  4%]\n........................................................................ [  9%]\n........................................................................ [ 14%]\n........................................................................ [ 18%]\n........................................................................ [ 23%]\n........................................................................ [ 28%]\n........................................................................ [ 32%]\n........................................................................ [ 37%]\n........................................................................ [ 42%]\n........................................................................ [ 47%]\n........................................................................ [ 51%]\n........................................................................ [ 56%]\n........................................................................ [ 61%]\n........................................................................ [ 65%]\n........................................................................ [ 70%]\n........................................................................ [ 75%]\n........................................................................ [ 79%]\n........................................................................ [ 84%]\n........................................................................ [ 89%]\n........................................................................ [ 94%]\n........................................................................ [ 98%]\n...................                                                      [100%]\n=============================== warnings summary ===============================\ntests/test_harvest_fleet_runs.py::test_discover_unpacks_a_tarball\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\ntests/test_harvest_fleet_runs.py::test_a_corrupt_tarball_among_healthy_ones_is_named_and_the_rest_land\ntests/test_harvest_fleet_runs.py::test_an_unreadable_tarball_is_named_in_a_whole_failed_lookup_line\n  /usr/lib/python3.12/tarfile.py:2301: DeprecationWarning: Python 3.14 will, by default, filter extracted tar archives and reject files or modify their metadata. Use the filter argument to control this behavior.\n    warnings.warn(\n\n-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html\n================= 1531 passed, 5 warnings in 357.69s (0:05:57) =================\n"}, "verdict": "NEEDS_ACK"}

```

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-108/.ultrapowers/runs/108/

- claude-version.txt
- engine.log
- events.jsonl
- gate-receipt.json
- pr-body.md
- publish-fold
- receipt.json
- report.json
- residuals.jsonl
- status.json
- transcripts

### Plan

https://github.com/popmechanic/ultrapowers/blob/ultra/plan/run-108/.ultrapowers/plan.md

### Residuals

- [ ] critic — Task 1, Claim/M2 (prompt construction): `examConcerns` is declared at fleet/run-engine.mjs:1970 and assigned at :2069 but never cleared, so the `examConcernBlock(examConcerns)` call at :2113 — which is inside the `for (let iter = 1; iter <= 2; iter++)` loop — re-emits the `EXAM CONCERN: <entry>` lines into the `review:<id>:2` prompt as well. In the merging path (M3) round 2's exam is green, so the round-2 referee reads the fix round's 'this case cannot pass for any output' claim beside an `exit 0` EXAM EVIDENCE block, while fleet/roles/reviewer.md:82-84 tells it unconditionally that 'Either way the claim is answered by a finding, never by silence: the exam is red, and a red exam blocks whatever you return.' A round-2 referee that follows that sentence literally raises a blocking issue on a now-green exam, and at `iter === 2` that returns `fix-loop-exhausted` (fleet/run-engine.mjs:2283-2287) instead of the merge the Claim promises. The contract only pins round 1's prompt (M2) and the sim's `review:T1:2` stub is a canned `passReview()`, so no exam catches this; the fix is to scope the block to `iter === 1`, or to condition reviewer.md's 'the exam is red' clause on the evidence the round actually carries.
- [ ] task 1 reviewer — `fleet/run-engine.mjs`: the `examConcernBlock(examConcerns)` call sits inside the `for (let iter = 1
- [ ] task 1 reviewer — iter <= 2
- [ ] task 1 reviewer — iter++)` loop, so the `EXAM CONCERN:` lines are rendered in the round-2 prompt as well as round 1. M2 only asks for round 1, and by round 2 the claim is stale: `examEvidence` is a fresh `runExam(2)`, so a fix round that applied the referee's exam patch yields EXAM EVIDENCE `exit 0` with the pass-1 claim still on the prompt. The new reviewer.md passage ends "Either way the claim is answered by a finding, never by silence: the exam is red, and a red exam blocks whatever you return" — a round-2 referee reading that literally against a now-green exam returns a blocking issue, and at `iter === 2` any blocking issue returns `fix-loop-exhausted`, turning the M3 merge into a failure in production (the sim cannot catch this because `review:T1:2` is stubbed to `passReview()`). Suggested fix, one token: `examConcernBlock(iter === 1 ? examConcerns : []) +`. Alternatively qualify the reviewer.md passage with "when this round's EXAM EVIDENCE shows `exit 0` the claim is already answered — record it and move on."
- [ ] task 1 reviewer — `fleet/roles/reviewer.md`: the new passage tells the referee to raise the exam finding with actor `implementer`, but the actor rule already in the file (lines 49-56) lists "a wrong exam" among the cases that take actor `plan`. A referee that follows the older, more general sentence has a real mechanical consequence: `routeToPlan` (run-engine.mjs:2180) strips any `actor === 'plan'` issue out of `blocking`, so the referee's `proposedPatch` never reaches `fix:<id>:1` and the only blocking issue left is the driver's own `EXAM_FAIL` line with no patch attached — the exam stays red and the task ends `fix-loop-exhausted` instead of merging. The task text specifies actor `implementer`, so the diff is faithful
- [ ] task 1 reviewer — the fix is to qualify the older clause, e.g. "a wrong exam (except the `EXAM CONCERN:` case below, where the fix round holds the bytes and the finding is the implementer's)".
- [ ] task 1 reviewer — `skills/ultrapowers/references/report-format.md`, the amended `tasks[].reviewVerdict` row: it says a task on this route "reads like any reviewed task's — `clean`, `fixed` or `fix-loop-exhausted`". `clean` is unreachable here. The route is entered only when the second pre-review pass still has the exam red, and round 1 reads `examEvidence = preExam` — that same red record — so run-engine.mjs:2156 always appends a blocking issue in round 1, making `blocking.length === 0` (the `clean` return at iter 1) impossible. The enumeration is also short of `blocked-after-fix`/`lost-coordinates`, which the round-1 fix round can still produce. Suggested wording: "its row then reads like any reviewed task's — `fixed` when a fix round turns the exam green, otherwise `fix-loop-exhausted` (or whatever the fix round's own reply parks it at) — never `proof-red`, and never `clean`, since round 1's exam is red by construction." Nothing reads this row mechanically, so it blocks nothing.
- [ ] task 1 reviewer — fleet/run-engine.mjs: `examConcerns` is function-scoped and re-read on every iteration of the `for (let iter = 1
- [ ] task 1 reviewer — iter <= 2
- [ ] task 1 reviewer — iter++)` loop, so the `EXAM CONCERN:` lines are rendered into the round-2 review prompt as well as round 1. M2 only requires them on round 1, and by round 2 the claim is usually stale — `fix:<id>:1` has already applied the referee's exam patch, so the exam the round-2 reviewer reads is the repaired one. The new reviewer.md passage tells the referee that such a line must be 'answered by a finding, never by silence: the exam is red, and a red exam blocks whatever you return', which on a round-2 tree whose exam now exits 0 invites a spurious blocking issue and pushes a task that should end `done`/`fixed` toward `fix-loop-exhausted` — the very merge the task's Claim promises. The sim does not catch this because `review:T1:2` is stubbed `passReview()`. Fix: render the block only in round 1 — `examConcernBlock(iter === 1 ? examConcerns : [])` at fleet/run-engine.mjs:2107 — which keeps every leg of the exam green (legs (b) and (c) read `review:T1:1`
- [ ] task 1 reviewer — leg (d) reads `review:T1:2` only for the `EXAM EDITED` lines).
- [ ] task 1 reviewer — unverified: the Acceptance clause is `suite` — the committed suite plus per-task review — but the evidence in hand covers only this task's own exam and the three sibling sims the Proof names as `Run:` (test_run_engine_pre_review.mjs, test_run_engine_exam_edits.mjs, test_run_engine_fixloop.mjs), all exit 0. The rest of `tests/test_fleet_suite.py`'s glob over `fleet/tests/test_*.mjs` was not executed here, and this patch edits `fleet/run-engine.mjs` on the path every engine sim runs through. The regression risk is low — the new branch is gated on an `exam:` entry that no other sim produces, and `examConcernBlock([])` returns the empty string, so every other task's review prompt stays byte-identical — but only a full `python3 -m pytest tests/test_fleet_suite.py` (or the equivalent glob run) would settle it.

</details>

Closes #908
