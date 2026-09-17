Every review on the record opened by asking the reviewer to fetch its own task text from a JSON file, which it tried to do with a program the sandbox refuses, wasting one to three turns per review. This plan hands the reviewer its task text directly, the way the implementer already gets it, and tells the reviewer in one sentence which instruments it has. Reviews start on the code instead of on a denial, saving about a tenth of a dollar and half a minute per review across every run.

**Merged** 357bf484e6fa4e2b913a154bc3898f442a13eda2

> Hand the reviewer its task body inline — the `inlineBody` branch — as the implementer already gets it.

| task | claim | exam | probes | mutant | suite |
|---|---|---|---|---|---|
| 1 | do: launch a plan whose task bodies ride the launch file, as every launch does; see: each of a task's four workers — its implementer, its examiner, its fix round and, first among them, its reviewer — is handed `TASK:` followed by the task's own text, and none of those four is told to go and read that text out of a JSON file; the resolver's brief over a conflicted wave is not one of the four and still names the file exactly as it did. | red at BASE → green | — | — | — |
| 2 | do: open the referee's role file; see: one sentence, up front, telling the referee it has no shell that runs a program and naming the instruments it does have, so a review starts on the diff and not on a refused command. | none | — | — | — |

Residuals: 6 from review

Amendments: 1 from workers

- task 1 — files: Edited `fleet/tests/test_run_engine_own_proofs.mjs`, the peer examiner's exam laid over at handoff (a driverOwned path), removing S16's `fs.existsSync` on `test_resolver_brief.mjs` and the sentinel read of that sibling's source, and rewriting the two block comments that described them. The path is inside my declared FILES as the task's `Test:` entry, but the content is the peer's, so the edit is declared rather than treated as ordinary scope. — The Global Constraints `Check:` is a result, not an opinion, and it stayed red until that literal left the tree. No change to `fleet/run-engine.mjs`, `run-main.mjs` or `run-worker.mjs` could satisfy it, since the rule is a source sweep over the sim files themselves. The alternative that keeps the exam byte-for-byte — assembling the sibling's name from fragments so the sweep cannot see it — would defeat the constraint instead of meeting it, so I removed the assertions and left M5's real pin in place.

<details><summary>Record</summary>

## fleet run-174 — gate-green

| | |
|---|---|
| verdict | `PASS` |
| target | `popmechanic/ultrapowers` at `766b261576990467742807da256f3a13c19d26a0` |
| engine | `766b261576990467742807da256f3a13c19d26a0` |
| plan | `.ultrapowers/plan.md` at `728e99ef85456cbbf9cbb7a5d30fe354f0d9471a` |
| branch | `ultra/integration-run-174` |
| vm | `fleet-r174-2609170705-0c26` |

### Checks

```json
{"mode": "gate", "stamp": "run-174", "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-174/report.json", "branch": "ultra/integration-run-174", "gateCheck": {"verdict": "PASS", "checks": [{"name": "report-parse", "ok": true, "detail": ""}, {"name": "clean-tree", "ok": true, "detail": ""}, {"name": "wave-merges", "ok": true, "detail": ""}, {"name": "head-match", "ok": true, "detail": ""}, {"name": "git-verified", "ok": true, "detail": ""}, {"name": "ancestry", "ok": true, "detail": ""}, {"name": "deliverables", "ok": true, "detail": ""}], "notes": [], "repo": "/home/exedev/target"}, "gateCheckExit": 0, "suite": {"passed": true, "unattributed": [], "output": "============================= test session starts ==============================\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\nrootdir: /home/exedev/target/.claude/ultrapowers/run-run-174/clones/integration\nconfigfile: pytest.ini\ntestpaths: tests\nplugins: xdist-3.4.0\ncreated: 3/3 workers\n3 workers [417 items]\n\n........................................................................ [ 17%]\n........................................................................ [ 34%]\n........................................................................ [ 51%]\n........................................................................ [ 69%]\n........................................................................ [ 86%]\n.........................................................                [100%]\n======================= 417 passed in 166.93s (0:02:46) ========================\n"}, "verdict": "PASS"}

```

## Publish fold

- attempt 1: folded
- attempt 2: folded

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-174/.ultrapowers/runs/174/publish-fold/receipt.json

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-174/.ultrapowers/runs/174/

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

https://github.com/popmechanic/ultrapowers/blob/ultra/plan/run-174/.ultrapowers/plan.md

### Residuals

- [ ] task 1 reviewer — Recorded and accepted (rule 8 / rule 9): the submission edited the peer's exam at `fleet/tests/test_run_engine_own_proofs.mjs`, dropping S16's two assertions that `fleet/tests/test_resolver_brief.mjs` still exists and still ends in the `ALL TESTS PASSED` sentinel, and rewriting the two comments describing them. That loosens assertions the peer wrote, but the exam was wrong: leg (e) [M4] of `fleet/tests/test_sims_are_hermetic.mjs:892-903` sweeps every sim for a `test_*.mjs` literal reaching an `existsSync`/`statSync`/`accessSync` call and asserts there are none — 'no surviving sim names a sibling sim, run or merely checked for existence' — and that sim is a blocking Global Constraints `Check:`. No change inside `fleet/run-engine.mjs`, `run-main.mjs` or `run-worker.mjs` could make those two lines lawful, so the pin was unsatisfiable rather than merely inconvenient, and the hunk changes only those lines and their prose. M5's real pin — the byte-for-byte equality of `waveContendingBlock({ waveTasks, wavesPath, receipts })` against the BASE render, `wavesPath` sentence included — is kept intact, and the other half of leg (e) is settled by the Proof's second `Run:` (exit 0 in RUN EVIDENCE) with the hermeticity sweep green in CHECK EVIDENCE. The AMENDMENTS entry declares exactly this and the diff bears it out. No action
- [ ] task 1 reviewer — named here because rule 8 requires the edit be stated in the review.
- [ ] task 1 reviewer — Explicit error paths: in the new hydration block in `fleet/run-engine.mjs` (added directly after the `wavesPath` line), a failure to read or parse the launch file is swallowed — `try { launch = JSON.parse(fs.readFileSync(wavesPath, 'utf8')) } catch { launch = null }` — and the run then dies in the body check below with `run-engine: task <id> has no body: not inline in args.waves and not in <path>`. That message is true but misattributes the cause: a truncated or unreadable `launch.json` reads to the operator as a malformed plan entry rather than as a bad file, where the engine elsewhere refuses loudly with the reason (`resume is not supported`, `duplicate task id`). M4 pins only the missing-entry case, so this blocks nothing and the exam is unaffected
- [ ] task 1 reviewer — carrying the caught error's text into the throw costs one variable.
- [ ] task 1 reviewer — concern: exam: the peer exam at `fleet/tests/test_run_engine_own_proofs.mjs` was green, but its S16 violated a repo-wide constraint that this task also carries as a Global Constraints `Check:` — `test_sims_are_hermetic.mjs` leg (e) [M4] forbids a sim from naming a sibling sim, run or merely checked for existence, and S16 did `fs.existsSync` on `test_resolver_brief.mjs` and read its source. The exam and the Check could not both be satisfied as written, so I edited the exam rather than the engine. The examiner's own S16 comment had already reasoned that 'an exam never runs another exam'
- [ ] task 1 reviewer — the tree's rule is one notch stronger than the reading it worked from — it may not name one either. Flagging it because an edit in a driver-owned exam path is recorded and the referee reads it as significant: this one was forced by the constraint, not by the implementation disagreeing with its grader.

</details>

Closes #1100
