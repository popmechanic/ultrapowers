This makes relaunching a plan after a failed run start clean instead of carrying three leftovers from the run before it. It exists because runs 14, 15 and 16 on the fixture app each carried one — the relaunch could not say why it redid finished work, it showed the earlier run's failure on a task that had barely started, and a task was called exhausted when the only party who could have fixed it, the peer who wrote the exam, was never asked. After this run a relaunch names the reason it reused nothing, the earlier run's marks are cleared before any worker starts, and a finding against the exam sends the exam back to its author once before the task is given up on.

**Merge-ready**

> A relaunch tells me why it reused nothing, never shows me the old run's verdict on the new run's tasks, and a review finding against an exam gives the examiner one more round before the task is called exhausted.

| task | claim | exam | probes | mutant | suite |
|---|---|---|---|---|---|
| 1 | When a relaunch cannot fold the earlier run's finished work back in, the run's record and its log say why in the fold's own words — how many conflicts, or which kernel step refused — instead of only that no head came out. | red at BASE → green | 3/3 | — | — |
| 2 | A relaunch never shows the earlier run's verdict on a task its own workers have not touched yet: a mark the earlier run left on the task's issue is cleared when the run opens the issue, and the only attention the record shows is what this run's workers raise. | red at BASE → green | 2/2 | — | — |
| 3 | When the reviewer's blocking finding is against the exam file rather than the implementation, the peer who wrote the exam gets the finding and one round to rewrite it, the rewritten exam is run and reviewed once more, and only then is the task called exhausted — and the record shows whether that round ran. | red at BASE → green | 6/6 | — | — |

Residuals: 4 from review

Amendments: 3 from workers

- task 2 — clause: M5 / leg (g): the contract sentence says the clear's patch carries "two flat keys — and it carries no others —" rather than the natural phrasing "exactly the two flat keys". — the landing exam's own contract leg asserts the string "exactly the two flat keys" occurs zero times in fleet/CONTRACT.md (it described the pre-#979 adoption patch), so the natural wording turned the first Proof command red; the meaning M5 asks for is unchanged.
- task 3 — clause: M1's `EXAM REJECTED:` block is rendered as exactly `\n\nEXAM REJECTED:\n` followed by the details one per line, with no preamble sentence between the label and the first detail — the block's meaning is spelled in `fleet/roles/examiner.md` instead. — The Global Constraint that a new worker input is one labelled block on the existing prompt, spelled in the role file that reads it, argues for the label carrying no prose of its own; it also keeps the block readable as both "`EXAM REJECTED:` followed by that detail" and "both details on separate lines".
- task 3 — clause: M2's round-2 sequence is entered even when the exam-rejected examiner dies in the agent call (the throw is caught and read as the BLOCKED round the Context already describes), rather than letting it climb to `runTask`. — A climb resets the task clone and re-enters `runTaskInner` whole, discarding a finished, captured implementation to re-earn a finding the run already holds — the same loss #762 fixed for the first examiner.

<details><summary>Record</summary>

## fleet run-157 — gate-green

| | |
|---|---|
| verdict | `PASS` |
| target | `popmechanic/ultrapowers` at `901fc874923210207e041f947407b8ea519c1ab2` |
| engine | `901fc874923210207e041f947407b8ea519c1ab2` |
| plan | `.ultrapowers/plan.md` at `1dc843f62b5d0f339f80b8f08b056c9a00218358` |
| branch | `ultra/integration-run-157` |
| vm | `fleet-r157-2609160600-ae1b` |

### Checks

```json
{"mode": "gate", "stamp": "run-157", "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-157/report.json", "branch": "ultra/integration-run-157", "gateCheck": {"verdict": "PASS", "checks": [{"name": "report-parse", "ok": true, "detail": ""}, {"name": "clean-tree", "ok": true, "detail": ""}, {"name": "wave-merges", "ok": true, "detail": ""}, {"name": "head-match", "ok": true, "detail": ""}, {"name": "git-verified", "ok": true, "detail": ""}, {"name": "ancestry", "ok": true, "detail": ""}, {"name": "deliverables", "ok": true, "detail": ""}], "notes": [], "repo": "/home/exedev/target"}, "gateCheckExit": 0, "suite": {"passed": true, "unattributed": [], "output": "============================= test session starts ==============================\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\nrootdir: /home/exedev/target/.claude/ultrapowers/run-run-157/clones/integration\nconfigfile: pytest.ini\ntestpaths: tests\nplugins: xdist-3.4.0\ncreated: 3/3 workers\n3 workers [277 items]\n\n........................................................................ [ 25%]\n........................................................................ [ 51%]\n........................................................................ [ 77%]\n.............................................................            [100%]\n======================== 277 passed in 87.61s (0:01:27) ========================\n"}, "verdict": "PASS"}

```

## Publish fold

- attempt 1: folded

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-157/.ultrapowers/runs/157/publish-fold/receipt.json

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-157/.ultrapowers/runs/157/

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

https://github.com/popmechanic/ultrapowers/blob/ultra/plan/run-157/.ultrapowers/plan.md

### Residuals

- [ ] task 1 reviewer — `fleet/CONTRACT.md:539` writes the conflicting-fold refusal as "no resolver exists at setup" while the sentence the engine actually emits — `fleet/run-engine.mjs:3223`, and the literal leg `#1037 (a)` asserts with `contains: ['no resolver exists at Setup']` — capitalises the phase name: `no resolver exists at Setup`. The global constraint makes `fleet/CONTRACT.md` the file that wins on any literal, so the one place a reader goes to check the refusal's wording is the one place it is spelled differently from the string. Nothing fails today (the Proof's third `Run:` and exam leg (e) both match on `conflict`/`materialize`/`verdict`, not on this token), which is why this is minor rather than blocking.
- [ ] task 1 reviewer — `makeParkedOrigin` in `fleet/tests/test_run_engine_reuse.mjs:299` adds `clashPatch` to its returned object, but no reader ever reaches it — the only use is the local binding at line 291, inside the function. Every other field on that object (`runPatch`, `report9`, `adoptedSha`, `sideSha`, `base`) is read through `ORIGIN.*` somewhere in the file. Dropping the field from the return keeps the origin's surface honest about what the sims consume.
- [ ] task 3 reviewer — `examEdited` is not cleared when the exam-rejected round re-hands the peer's bytes into the graded tree (fleet/run-engine.mjs, the `rejections` block around the `await handoffExam()` at ~line 3220). `handoffExam()` refreshes the drift *baseline* (`examBlobs`), and the block's own comment claims "the drift baseline refreshed so round 2's EXAM EDITED reads against what the peer left THIS round" — but the *list* `examEdited` is only ever appended to (`noteDrift`, the single call site at ~line 2879, after the `fix:<id>:0` round) and is never reset. So on a task where the pre-review repair round edited the exam AND the round-1 reviewer's blocking detail backticks the landing path (exactly what reviewer.md rule 8 asks a referee to do when an edit loosens an assertion), round 2's reviewer prompt still carries `EXAM EDITED: <path>` with an empty `EXAM EDITED DIFF` block (`examEditedDiffs` diffs `<examDir>/<p>` against `<cloneDir>/<p>`, now byte-identical), and the returned row still carries that path under `examEdited` — which CONTRACT.md defines as "the `proofTests` paths whose blob no longer matches what the examiner left", untrue after the re-handoff. No Machine clause of this task covers the interaction, and every Proof leg passes, which is why this is minor rather than blocking
- [ ] task 3 reviewer — but it misreports a fact to the round-2 referee and in the report.

</details>

Closes #1037
