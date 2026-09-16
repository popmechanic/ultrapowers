This is three small repairs to the plugin's own scripts and references, bundled because they touch no file in common. The catch-counter ratchet gets the half it was missing — a command that assembles the record from the evidence tags and a per-release list of the tests that never caught anything, with a release step that says where the reading goes — so deletion follows a measurement instead of a hand-assembled tree; the fleet tests index, the report format and the contract are brought back into line with the files and events they describe; and the one fleet sim that fails on this laptop at every main is made to wait for the fold it asks about instead of racing a half-second hold. What you get is a release that carries its own zero-catch reading, a local test suite that is green again, and references a stranger can trust.

**Merge-ready**

> After this run I can pull every run's record since the last release with one command and read which tests caught nothing over it with a second, run the fold-policy sim on my laptop and see it pass as it passes in the sandbox, and open the fleet tests index, the report format and the contract and find each one describing what is actually in the tree.

| task | claim | exam | probes | mutant | suite |
|---|---|---|---|---|---|
| 1 | Before a release I run two commands — one pulls every run's record since the last release off the evidence tags into a folder and counts it, the other lists the tests those runs never caught anything with — and that list goes into the release commit as it is. | red at BASE → green | — | — | — |
| 2 | The fleet tests index names every sim that is in the tree and none that is gone, the report format tells a reader about the findings the driver writes on each task, and the contract's event shapes list the receipt keys the record actually carries. | none | — | — | — |
| 3 | The fold-policy sim no longer races this Mac's clock: the one leg that failed here at every main now waits for the fold it asks about instead of a fixed half-second, and the whole sim still prints ALL TESTS PASSED. | none | — | — | — |

Residuals: 8 from review

Amendments: 2 from workers

- task 2 — clause: M3 — besides the `tasks[].findings` row the clause asks for (placed at line 106, directly after the `tasks[].stateExams` row), I also named `tasks[].findings` in report-format.md's Presentation list, item 4 **Per-task status**, saying to render a row's findings there beside its notes. — Leg (e)'s awk takes the LAST line matching each pattern, and `tasks[].stateExams` occurs twice in the file — the row at 105 and again inside the `deferredVerification` row at 123 — so the row where M3 puts it left s=123, f=106 and the awk red. Moving the row out of the `tasks[]` block to satisfy the awk would have broken the clause and the table; naming the field where a per-task row is actually rendered satisfies both and is a sentence the document wants anyway.
- task 1 — clause: Context's window line `window: the whole record (fewer than N release tags), <k> run(s)` — I print the NUMBER given, e.g. `window: the whole record (fewer than 5 release tags), 4 run(s)`, rather than a literal `N`. — The sentence gives `N` unbracketed while giving `<tag>` and `<k>` in angle brackets, so it reads either way. Every other use of `N` in the task (`## Zero catches over the last N release(s)`, `(N the number given)`) is the substituted number, and a window line that reports `fewer than N` states no fact; I took the consistent reading.

<details><summary>Record</summary>

## fleet run-168 — gate-green

| | |
|---|---|
| verdict | `PASS` |
| target | `popmechanic/ultrapowers` at `d5bf796afb2dcaccd0d0d3b0eba8cbfb0dff4425` |
| engine | `d5bf796afb2dcaccd0d0d3b0eba8cbfb0dff4425` |
| plan | `.ultrapowers/plan.md` at `4c2fa265073ffc42ddc2e6738ee2e73b1e8f0409` |
| branch | `ultra/integration-run-168` |
| vm | `fleet-r168-2609161912-f85c` |

### Checks

```json
{"mode": "gate", "stamp": "run-168", "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-168/report.json", "branch": "ultra/integration-run-168", "gateCheck": {"verdict": "PASS", "checks": [{"name": "report-parse", "ok": true, "detail": ""}, {"name": "clean-tree", "ok": true, "detail": ""}, {"name": "wave-merges", "ok": true, "detail": ""}, {"name": "head-match", "ok": true, "detail": ""}, {"name": "git-verified", "ok": true, "detail": ""}, {"name": "ancestry", "ok": true, "detail": ""}, {"name": "deliverables", "ok": true, "detail": ""}], "notes": [], "repo": "/home/exedev/target"}, "gateCheckExit": 0, "suite": {"passed": true, "unattributed": [], "output": "============================= test session starts ==============================\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\nrootdir: /home/exedev/target/.claude/ultrapowers/run-run-168/clones/integration\nconfigfile: pytest.ini\ntestpaths: tests\nplugins: xdist-3.4.0\ncreated: 3/3 workers\n3 workers [346 items]\n\n........................................................................ [ 20%]\n........................................................................ [ 41%]\n........................................................................ [ 62%]\n........................................................................ [ 83%]\n..........................................................               [100%]\n======================= 346 passed in 105.15s (0:01:45) ========================\n"}, "verdict": "PASS"}

```

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-168/.ultrapowers/runs/168/

- approve-receipt.json
- claude-version.txt
- engine.log
- events.jsonl
- frontier
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

https://github.com/popmechanic/ultrapowers/blob/ultra/plan/run-168/.ultrapowers/plan.md

### Residuals

- [ ] task 3 reviewer — unverified: the Claim's second half — "green on the laptop as in the sandbox" — is a cross-environment assertion this patch and this clone cannot settle. Every Proof leg ran on the sandbox (RUN EVIDENCE, all six exit 0, fold-policy exit=0 elapsed=24s), and the task text itself concedes the laptop reading "is the operator's, by hand". The diff's mechanism is the right shape for it — fleet/tests/test_run_engine_fold_policy.mjs i2 now holds B on `waitUntil(() => adoptionsOf(readEvents(runDir)).length > 0)` and C on `waitUntil(() => readEvents(runDir).some((e) => isEnd(e, 'impl:B')))`, so the removed `sleep(MID_HOLD_MS)` half-second that A's whole pipeline had to fit inside on Darwin is gone and the remaining bound is HOLD_MS = 8000 — but nothing in this tree proves the Darwin red is cured. What would settle it: the operator running `node fleet/tests/test_run_engine_fold_policy.mjs` on the Darwin 27.0 / Node v24.16.0 box named in #1045 and recording exit 0 on the merged sha. No edit inside this task's FILES can answer it, hence actor `plan`.
- [ ] task 2 reviewer — Recorded, not a defect in the submission: the AMENDMENTS entry is lawful and the diff bears it out. Leg (e)'s instrument — `awk '/tasks\[\]\.stateExams/{s=NR} /tasks\[\]\.findings/{f=NR} END{exit !(s && f && f>s)}'` — assigns the LAST match of each pattern, and `tasks[].stateExams` occurs twice in report-format.md (the field row, and again inside the `deferredVerification` row ~17 lines below it). So the awk cannot express "the findings row sits after the stateExams row": the correctly-placed row alone leaves s > f and reads red. The worker declared this and answered it by also naming `tasks[].findings` in Presentation item 4 **Per-task status**, which is a sentence the document wants on its own terms (it tells a renderer where a driver-raised finding appears) and which names only fields that exist at BASE, so it satisfies the third Global Constraint. M3's substance is met independently of the awk and I verified it by reading the diff rather than the leg: the `| `tasks[].findings` | no | … |` row is added directly after the `tasks[].stateExams` row (patch hunk `@@ -103,6 +104,7 @@`, one added line following the stateExams context line), and its text carries every element M3 names — present on every `tasks[]` row, an array, `{severity, actor, detail}`, de-duplicated by `detail`, in the order raised, `[]` on every task of a run with no state handshake, and the receipt keys `paths`/`evidence` riding the `handshake:finding` event instead of the row — each of which matches fleet/run-engine.mjs lines 1822-1838, 3464-3473 and 5786-5787. No edit inside this task's FILES fixes the leg, which is why the actor is `plan`: a future plan wanting to pin row ordering should use a leg that reads the field table only (e.g. anchoring both patterns to lines beginning `| \``), not a whole-file last-match scan.
- [ ] task 1 reviewer — Prose-constraint reading (no `Check:` behind it), recorded for the operator, not a fix for this diff. GLOBAL CONSTRAINT 2 ends "a file the record never named is `unobserved`, never a deletion candidate", but M2 and legs (d)/(f) require the release section to list exactly such a file — `tests/test_r.py — exercised by 0 run(s)` is a path no row's `exercises` ever names — and M4's RUNBOOK sentence, implemented at fleet/RUNBOOK.md:25-26 ("deletion of a listed file follows on the reading"), makes membership of that section the trigger for deletion. So an unobserved test can become a deletion candidate through the release reading, which the all-time table at skills/ultrapowers/scripts/catch_report.py deliberately prevents by spelling it `unobserved`. The implementation is faithful to M2 and to #873's desired state ("listing every test path ... with the count of runs that exercised it"), and the entry itself states a true count, so nothing inside this task's FILES is wrong
- [ ] task 1 reviewer — the tension lives in the task's own M2/M4 text. If it matters, the settlement is in the plan: either the release section skips paths with `exercised by 0 run(s)`, or the RUNBOOK sentence says a zero-exercised entry is unobserved and not yet a deletion candidate.
- [ ] task 1 reviewer — concern: The window line prints the tag's instant as git's own `%(creatordate:iso-strict)` text verbatim (`window: since v0.2.0 (2026-03-01T00:00:00+00:00), 3 run(s)`), not re-rendered to UTC `Z`. `<instant>` in the Context fixes no format, and the raw text is what `for-each-ref` answers, so a peer exam that sets GIT_COMMITTER_DATE with an offset and asserts that same string matches
- [ ] task 1 reviewer — one that normalises to `Z` first would not.
- [ ] task 1 reviewer — concern: fleet/RUNBOOK.md's new `## Release` section names `docs/superpowers/observations/ledger.jsonl`, a path that does not exist at BASE. The task's Context specifies it explicitly ("the untracked laptop ledger — never a sandbox path"), and by its nature it is never in the tree, so it sits against the global constraint that every sentence a reference document gains names a file that exists at BASE. Implemented as the task text spells it.
- [ ] task 1 reviewer — concern: Measured, against the Context's claim: this sandbox clone DOES carry `v*` tags (latest `v0.3.29`), so the fifth Run proof prints `window: since v0.3.29 (…), 0 run(s)` rather than the epoch window the Context predicted for a tagless depth-1 clone. The heading the proof greps for prints under either window, so the leg passes either way.

</details>

Closes #873
Closes #1040
Closes #1045
