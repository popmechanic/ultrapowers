This is the second half of the receipts plan: the first run put a receipt on red exams, fold conflicts and resolver misses, built the note the judges read and wired the three engine judges to read it, but two pieces never landed — the record still writes no line of its own for a finding that blocks a task or one later shown wrong, and the run's last fold onto main still writes no receipt and briefs its resolver with no memory of an earlier attempt on the same file. Those two pieces did not fail; every one of their workers finished clean, and the driver simply never landed a task whose review came back after its wave had already folded (#1057), so they are re-run here on the merged main as a narrow plan of two tasks rather than a relaunch of seven. The reading pre-registered on the original still holds — over the next five runs (n=5 runs, the five that follow this merge) the record says how often a brief carried such a note, how often a finding cited one, and whether a judge that saw a prior failure on a file caught more or repeated less than one that did not — and a note kind no finding ever cites is deleted.

**Merge-ready**

> Every failed verification and every refuted judgment in a run leaves a receipt naming what failed, what it rested on and which files it was about, and any judge whose brief covers those files reads it before judging.

| task | claim | exam | probes | mutant | suite |
|---|---|---|---|---|---|
| A | When a review blocks a task, when a state exam lets its mutant live, and when a block is later shown wrong — by the driver's own re-run, by a referee agreeing the exam was at fault, or by a second referee clearing an exam its author left as written — the run's record carries that as its own line, saying which files it was about and what showed it. | red at BASE → green | — | — | — |
| B | When the run's last fold onto main meets a conflict, its resolver's reply and the fold's own event land on the run's record with the files named, and a resolver briefed again on a file that already conflicted is shown that receipt first. | red at BASE → green | — | — | — |

Residuals: 3 from review

Amendments: 1 from workers

- task A — clause: M1's rule that a finding whose detail names no path takes the whole sorted touch set is applied to M2's and M3's rows too, via one helper (receiptPathsOf), whose fallback is the touch set when the row's own path list comes back empty — so the hollow-exam row and the three refuted verdicts can never carry an empty paths either. — The receipt shape in fleet/CONTRACT.md and fleet/facts-block.mjs requires paths to be non-empty for a row to be a receipt at all; M2/M3 draw their paths from the exam landings, which are empty for a task whose Proof names no exam, and a row that silently stopped being a receipt would drop out of every judge's FACTS block with nothing to show for it.

<details><summary>Record</summary>

## fleet run-160 — gate-green

| | |
|---|---|
| verdict | `PASS` |
| target | `popmechanic/ultrapowers` at `80c0ef304c0410332180ee58e33a68ac8438bc0a` |
| engine | `80c0ef304c0410332180ee58e33a68ac8438bc0a` |
| plan | `.ultrapowers/plan.md` at `07128fbafb7e9a895387997c689b1d9aa402a8f9` |
| branch | `ultra/integration-run-160` |
| vm | `fleet-r160-2609161526-9a47` |

### Checks

```json
{"mode": "gate", "stamp": "run-160", "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-160/report.json", "branch": "ultra/integration-run-160", "gateCheck": {"verdict": "PASS", "checks": [{"name": "report-parse", "ok": true, "detail": ""}, {"name": "clean-tree", "ok": true, "detail": ""}, {"name": "wave-merges", "ok": true, "detail": ""}, {"name": "head-match", "ok": true, "detail": ""}, {"name": "git-verified", "ok": true, "detail": ""}, {"name": "ancestry", "ok": true, "detail": ""}, {"name": "deliverables", "ok": true, "detail": ""}], "notes": [], "repo": "/home/exedev/target"}, "gateCheckExit": 0, "suite": {"passed": true, "unattributed": [], "output": "============================= test session starts ==============================\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\nrootdir: /home/exedev/target/.claude/ultrapowers/run-run-160/clones/integration\nconfigfile: pytest.ini\ntestpaths: tests\nplugins: xdist-3.4.0\ncreated: 3/3 workers\n3 workers [281 items]\n\n........................................................................ [ 25%]\n........................................................................ [ 51%]\n........................................................................ [ 76%]\n.................................................................        [100%]\n======================== 281 passed in 82.71s (0:01:22) ========================\n"}, "verdict": "PASS"}

```

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-160/.ultrapowers/runs/160/

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

https://github.com/popmechanic/ultrapowers/blob/ultra/plan/run-160/.ultrapowers/plan.md

### Residuals

- [ ] task B reviewer — `driver:facts` is appended up front, per open conflict, instead of per resolver dispatch (fleet/publish-fold.mjs, the `for (const c of open)` loop added after the brief copy, ~line 973 of the patched file). `resolveConflicts` parks on the first conflict whose reply is not `RESOLVED`, so on a fold with two or more open conflicts that parks on conflict 1, the log gains `driver:facts` rows labelled `resolve:publish-fold:<attempt>:<i>` for conflicts 2..n whose resolver was never briefed and never ran. The wave loop's analogue (fleet/run-engine.mjs:4066-4075) appends inside the wrapper around the block builder, so its row exists exactly when a resolver was actually handed the block — which is also what the contract paragraph's own reading measures (`driver:facts` rows per dispatch, fleet/CONTRACT.md:147). Nothing in the exam covers this: every rig here has one conflict, so leg (c)'s single-row and leg (d)'s zero-row counts are unchanged by the fix. Advisory, not blocking: M3's wording ("per non-empty brief") is satisfiable either way, and production publish folds of this shape are single-conflict.
- [ ] task A reviewer — Code quality (rule 5), duplicated logic in `fleet/run-engine.mjs`: the backticked-token reading is now spelled twice in the same 30-line region. `examPathIn` (new-file ~3587) carries `token === land || (token.startsWith(land + ':') && /^:\d+(?:-\d+)?$/.test(token.slice(land.length)))`, and the new `pathsNamedIn` (~3599) repeats the identical predicate against its own candidate list. The two readings must agree by construction — `examPathIn` decides whether a blocking issue buys the exam-rejected round (#1037) and `pathsNamedIn` decides the `paths` of the `driver:finding` that records that same issue — so a later edit to one suffix rule and not the other would silently put a finding's `paths` and the rejection it bought on different files. Suggested fix, wholly inside this task's FILES: extract one `const namesPath = (token, p) => token === p || (token.startsWith(p + ':') && /^:\d+(?:-\d+)?$/.test(token.slice(p.length)))` beside `examLandings` and have both `examPathIn`'s inner loop and `pathsNamedIn`'s inner loop call it. No behaviour changes and no exam assertion moves.
- [ ] task A reviewer — concern: plan-defect: the task Context states that the rigs for every M3 case already exist in fleet/tests/test_run_engine_proof_runs.mjs — naming TOGGLE (line ~1001) as the #944 exam-red-once-then-green flaky rig and pointing at the #908 exam-concern legs. Neither is there: TOGGLE is a Run: command used by the review-economy probe copy and has the opposite polarity (green first, red second), and a grep of that file for flaky|rerun|exam: |legCannotPass|DONE_WITH_CONCERNS returns one unrelated line. I built both rigs task-locally on factsRun — FLAKY_EXAM (red, then green on the driver's re-run, via a seen.txt marker) for case (i), and an always-red exam plus a fix reply carrying an exam concern with a round-1 reviewer who upholds it for case (ii). Every leg passes as written.

</details>

