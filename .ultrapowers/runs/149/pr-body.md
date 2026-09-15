This puts a weight on every number the project quotes as a reason: how many runs it was read over, and which. It exists because the record honoured "measured, never narrated" while the counts underneath were often two runs or one replay, and one default had already flipped on the one reading with a real n. After this run the project's own instructions state the floor — n on every row, no default flips under five runs or twenty tasks, a flip under that is an experiment with its rollback — every reading in the doctrine and the plan-writing skill carries its n and window, and the release census's last line names the runs it read.

**Merge-ready**

> After this run, every number the project's rules lean on tells me how many runs it was read over and which ones, so I can see a thin reading before I trust it — and nothing flips a default on fewer than five runs without calling itself an experiment and naming its way back.

| task | claim | exam | probes | mutant | suite |
|---|---|---|---|---|---|
| 1 | When I read the project's own instructions, the test-doctrine bullet states the floor — every reading carries its n and window, no default flips under five runs or twenty tasks, a flip under that is an experiment with its rollback — and names the three readings the decision was applied to, and the two readings the doctrine already leans on each say how many runs they were read over. | none | — | — | — |
| 2 | When an author reads the plan-writing skill, every number it gives as a reason says how many runs it was read over and which, the self-review tells the author to write a reading into a plan the same way and to call a thin-reading flip an experiment with its rollback, and the report reference's one-reviewer row carries the same n. | none | — | — | — |
| 3 | When I read a release's census, its last line tells me which runs it was read over, not only how many. | none | — | — | — |
| 4 | After the merge, each map that owns one of the readings says the floor on its own page, with its reading's n and window beside it, so a reader of the map sees the weight without opening the tree. | — | — | — | — |

Residuals: 5 from review

<details><summary>Record</summary>

## fleet run-149 — gate-green

| | |
|---|---|
| verdict | `PASS` |
| target | `popmechanic/ultrapowers` at `7f140639212d91432100970e8ec156a1856b25a6` |
| engine | `7f140639212d91432100970e8ec156a1856b25a6` |
| plan | `.ultrapowers/plan.md` at `1faadd3a892052f92467438b49a25b8cf6d930c7` |
| branch | `ultra/integration-run-149` |
| vm | `fleet-r149-2609151746-5093` |

### Checks

```json
{"mode": "gate", "stamp": "run-149", "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-149/report.json", "branch": "ultra/integration-run-149", "gateCheck": {"verdict": "PASS", "checks": [{"name": "report-parse", "ok": true, "detail": ""}, {"name": "clean-tree", "ok": true, "detail": ""}, {"name": "wave-merges", "ok": true, "detail": ""}, {"name": "head-match", "ok": true, "detail": ""}, {"name": "git-verified", "ok": true, "detail": ""}, {"name": "ancestry", "ok": true, "detail": ""}, {"name": "deliverables", "ok": true, "detail": ""}], "notes": [], "repo": "/home/exedev/target"}, "gateCheckExit": 0, "suite": {"passed": true, "unattributed": [], "output": "============================= test session starts ==============================\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\nrootdir: /home/exedev/target/.claude/ultrapowers/run-run-149/clones/integration\nconfigfile: pytest.ini\ntestpaths: tests\nplugins: xdist-3.4.0\ncreated: 3/3 workers\n3 workers [221 items]\n\n........................................................................ [ 32%]\n........................................................................ [ 65%]\n........................................................................ [ 97%]\n.....                                                                    [100%]\n======================== 221 passed in 61.45s (0:01:01) ========================\n"}, "verdict": "PASS"}

```

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-149/.ultrapowers/runs/149/

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

https://github.com/popmechanic/ultrapowers/blob/ultra/plan/run-149/.ultrapowers/plan.md

### Residuals

- [ ] task 2 reviewer — Prose line-wrap raggedness introduced by two of the five rewrites in `skills/ultrawrite/SKILL.md`. The §The proof gate edit leaves an orphan line `one or two tasks apiece,` (post-patch line 308) followed by a short `each of them idle behind a barrier it did not need.`, and Decomposition rule 5 leaves `(Tier 2), an effort split` (post-patch line 418) as a 27-column orphan. Both paragraphs elsewhere in the file wrap uniformly to ~92 columns, and the file is prose read by a human author. Purely cosmetic — the exam joins newlines with spaces (`tr '\n' ' '`), so rewrapping cannot change any `Run:` result, and the M7 preservation loop greps fixed substrings that survive the rewrap. Every Machine clause M1–M7 is otherwise satisfied in the diff, the two declared Files are the only paths touched, no sibling-owned path is entered, nothing is deleted, every `n=`/date/issue literal written (`n=71 runs`/`2026-09-13`/`#964`, `n=3 runs`/`runs 10–12`/`2026-09-05`, `n=1 sitting`/`9 rounds`, `n=2 runs`, `n=1 drain of 3 runs`/`#454`/`2026-09-01`) is supplied verbatim by the task's Context, and the `reviewEconomy` row stays one table line.
- [ ] task 2 reviewer — unverified: Global Constraint 1 ("every document states it the same way") is a prose constraint with no `Check:` behind it, and this diff can only settle the ultrawrite half of it. The new §Self-review bullet states three of the floor's four clauses — `n=… (window)`, the 5-run / 20-task threshold, and experiment-plus-rollback — but not the fourth ("a fact read once carries its date, not an n"), which the task's Machine clause M5 does not require either. Whether the floor reads identically across `CLAUDE.md` (sibling task 1) and this skill is a cross-task claim this patch cannot judge. What would settle it: a diff of the floor sentence as landed in `CLAUDE.md` against the §Self-review bullet on the folded integration tree.
- [ ] task 2 reviewer — The Context prescribes, and M6/M7 jointly pin, a `reviewEconomy` parenthesis that states its window twice: `eight marginal findings across 71 runs, n=71 runs through 2026-09-13, none of them one of the five real defects`. The implementer transcribed it exactly as specified, which is correct behaviour — M7's `grep -c 'eight marginal findings across 71 runs' = 1` and M6's ordered grep together leave no phrasing that avoids the repetition. Recorded as advisory only: any tightening (e.g. `eight marginal findings across 71 runs through 2026-09-13`) belongs in a follow-up that also relaxes M6, not in this diff, since the edit here would turn the exam red.
- [ ] task 1 reviewer — Floor-literal consistency (GLOBAL CONSTRAINT 1, prose, no `Check:` behind it): of the three applied readings added to the Test-doctrine bullet of `CLAUDE.md`, two carry an explicit `n=` (`#872` at `n=9 merged runs (131–140)`, `#974` at `n=71 runs`) but the middle row states the fold rule's reading as "(`#1006`, one replay)" with no `n=`. I read the constraint "every reading row carries `n=… (window)`" as covering this row too
- [ ] task 1 reviewer — the count is supplied by the task's Context ("is one replay"), so writing it as `n=1 replay` invents no number and keeps the three rows stated the same way. M2 and the second `Run:` proof are satisfied either way (grep matches `#1006` then `experiment`), so this blocks nothing — the document simply reads as if the floor it just stated exempts its own middle row.

</details>

Closes #994
