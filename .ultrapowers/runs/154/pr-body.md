This writes down five lessons from last night's three TinyApp runs in the places plan authors and exam writers actually read. Each rule cost a run a lost fold, a hollow exam or a rewritten snapshot set, and none is written anywhere yet. After this run the next TinyApp plan starts with those traps named, so nobody pays for them twice.

**Merge-ready**

> The five rules the trio paid for are written where authors and examiners read them.

| task | claim | exam | probes | mutant | suite |
|---|---|---|---|---|---|
| 1 | When I open the authoring gotchas before dispatching gate readers, the rule that a grep inside a guarded exam pins another file's wording — and that wording folds — is there as a row with its reason and its run, beside the twelve it joins. | none | — | — | — |
| 2 | When an examiner reads its role before writing an exam, it is told that the action form a Proof leg names — a click, a typed key, a store call — is not its to change, and why: the one hollow exam of the trio was a click swapped for a store call, which the mutant passed and the reviewer blocked. | none | — | — | — |
| 3 | When I author the next TinyApp plan and read the State exams section, the three traps the trio paid for are named there — a cell a plan adds carries no schema default, a plan that adds a callback, an invariant or a snapshot owns the linter's four test files, and a date field is a text input — each with its reason and its run. | none | — | — | — |

Residuals: 3 from review

Amendments: none

<details><summary>Record</summary>

## fleet run-154 — gate-green

| | |
|---|---|
| verdict | `PASS` |
| target | `popmechanic/ultrapowers` at `e245b71ce9370e6d32ce0cc7277694cef592fec4` |
| engine | `e245b71ce9370e6d32ce0cc7277694cef592fec4` |
| plan | `.ultrapowers/plan.md` at `c810a111226bc30c3596a5f8f1c602ad4f5003c8` |
| branch | `ultra/integration-run-154` |
| vm | `fleet-r154-2609160300-561b` |

### Checks

```json
{"mode": "gate", "stamp": "run-154", "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-154/report.json", "branch": "ultra/integration-run-154", "gateCheck": {"verdict": "PASS", "checks": [{"name": "report-parse", "ok": true, "detail": ""}, {"name": "clean-tree", "ok": true, "detail": ""}, {"name": "wave-merges", "ok": true, "detail": ""}, {"name": "head-match", "ok": true, "detail": ""}, {"name": "git-verified", "ok": true, "detail": ""}, {"name": "ancestry", "ok": true, "detail": ""}, {"name": "deliverables", "ok": true, "detail": ""}], "notes": [], "repo": "/home/exedev/target"}, "gateCheckExit": 0, "suite": {"passed": true, "unattributed": [], "output": "============================= test session starts ==============================\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\nrootdir: /home/exedev/target/.claude/ultrapowers/run-run-154/clones/integration\nconfigfile: pytest.ini\ntestpaths: tests\nplugins: xdist-3.4.0\ncreated: 3/3 workers\n3 workers [276 items]\n\n........................................................................ [ 26%]\n........................................................................ [ 52%]\n........................................................................ [ 78%]\n............................................................             [100%]\n======================== 276 passed in 83.58s (0:01:23) ========================\n"}, "verdict": "PASS"}

```

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-154/.ultrapowers/runs/154/

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

https://github.com/popmechanic/ultrapowers/blob/ultra/plan/run-154/.ultrapowers/plan.md

### Residuals

- [ ] task 3 reviewer — Style, not correctness: row 3 carries two measurement parentheticals in one sentence and repeats its scope — "(measured: 5–7 files, 13–20 pins across three plans)" and then "(measured across the three plans of the #867 trio, popmechanic/tinyapp-fixture, 2026-09-15)". The section's register (the `Two rules here are measured, not guessed.` paragraph at lines 189–195, and the `run-7 parked` sentence) states a measurement once and closes with the run. Both parentheticals are prescribed by the task's Context, so this is faithful transcription rather than a divergence, and every M1 anchor still lands if the second one is tightened to the run alone — `… round-trips byte-identical (the #867 trio, popmechanic/tinyapp-fixture, 2026-09-15).` — because `three plans` is already satisfied by `across three plans` earlier in the required order. Advisory only
- [ ] task 3 reviewer — the exam is green as written.
- [ ] task 3 reviewer — concern: Row 3's proof leg is locale-sensitive and nothing in the row's text says so. The grep matches the en dashes in `5-7 files, 13-20 pins` with `.`, which spans a 3-byte en dash only under a UTF-8 locale. It is green in this tree (C.UTF-8) and I kept the en dashes because the task text is explicit that they are the issue's and that the Run: matches them with `.` — but the identical leg run under LC_ALL=C exits 1. Recorded on the kata issue so a future red there is read as a locale, not as a missing row.

</details>

Closes #1038
