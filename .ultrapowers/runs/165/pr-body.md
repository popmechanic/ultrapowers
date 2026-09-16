Today a single invisible byte reached main: an implementer wrote a string separator as the raw character instead of its two-letter escape, every test passed, the reviewer saw ordinary code, and from then on git and the fold kernel treated the engine's main file as binary, so the next run's merge onto main stalled with no one to resolve it. After this, the driver checks each patch before review for a file that was readable text and now carries that byte, and treats it as one more red on the pass, which buys the same repair round a failing test buys. The worker fixes it in seconds, the record shows the byte, and no run pays a hand merge for it.

**Merge-ready**

> A worker whose patch puts a stray control byte into a source file is told so before any reviewer reads it, and gets its one repair round to remove it, so no later merge stalls on a file the tools can no longer read as text.

| task | claim | exam | probes | mutant | suite |
|---|---|---|---|---|---|
| 1 | A worker whose patch puts a stray control byte into a source file is told so before any reviewer reads it, and gets its one repair round to remove it, so no later merge stalls on a file the tools can no longer read as text. | red at BASE → green | — | — | — |

Residuals: 1 from review

Amendments: none

<details><summary>Record</summary>

## fleet run-165 — gate-green

| | |
|---|---|
| verdict | `PASS` |
| target | `popmechanic/ultrapowers` at `4434e0687178d02cfb658ea62467e937e6eda663` |
| engine | `4434e0687178d02cfb658ea62467e937e6eda663` |
| plan | `.ultrapowers/plan.md` at `892484f9768fb16be4560dbee2897af74f66eb0d` |
| branch | `ultra/integration-run-165` |
| vm | `fleet-r165-2609161801-fdc5` |

### Checks

```json
{"mode": "gate", "stamp": "run-165", "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-165/report.json", "branch": "ultra/integration-run-165", "gateCheck": {"verdict": "PASS", "checks": [{"name": "report-parse", "ok": true, "detail": ""}, {"name": "clean-tree", "ok": true, "detail": ""}, {"name": "wave-merges", "ok": true, "detail": ""}, {"name": "head-match", "ok": true, "detail": ""}, {"name": "git-verified", "ok": true, "detail": ""}, {"name": "ancestry", "ok": true, "detail": ""}, {"name": "deliverables", "ok": true, "detail": ""}], "notes": [], "repo": "/home/exedev/target"}, "gateCheckExit": 0, "suite": {"passed": true, "unattributed": [], "output": "============================= test session starts ==============================\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\nrootdir: /home/exedev/target/.claude/ultrapowers/run-run-165/clones/integration\nconfigfile: pytest.ini\ntestpaths: tests\nplugins: xdist-3.4.0\ncreated: 3/3 workers\n3 workers [283 items]\n\n........................................................................ [ 25%]\n........................................................................ [ 50%]\n........................................................................ [ 76%]\n...................................................................      [100%]\n======================== 283 passed in 79.65s (0:01:19) ========================\n"}, "verdict": "PASS"}

```

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-165/.ultrapowers/runs/165/

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

https://github.com/popmechanic/ultrapowers/blob/ultra/plan/run-165/.ultrapowers/plan.md

### Residuals

- [ ] task 1 reviewer — `readBase` in `nulReds` (fleet/run-engine.mjs) treats every non-zero `git show <baseShaForTask>:<path>` exit as 'absent at the dispatch head', and re-encodes the blob through the utf8 string seam (`Buffer.from(String(r.stdout), 'utf8')`) rather than reading bytes. Both are safe for the rule as specified — a `0x00` survives the utf8 round-trip in both directions, and the base blob is only ever tested for NUL presence, never for an offset — and the task's Context explicitly prescribes the exit-code reading ('a path absent at the head makes `git show` exit non-zero, which is the `null` reader answer'), so this is not a divergence. The residual risk is narrow: a `git show` that fails for a reason other than absence (most plausibly a base blob larger than `execSeam`'s 64 MB `maxBuffer`, which resolves `code: 1` with empty stdout) reads as a new path, and if that path carries a `0x00` now and is not in the task's `Files`, the pass raises a false blocking red against an implementer who introduced nothing. If you want to close it inside this task's own FILES, gate on existence separately — e.g. `git cat-file -e <sha>:<path>` for the null answer, and only then read the blob — so an exec failure is distinguishable from a genuinely new path. Advisory only: the exam and all five `Run:` commands are green, and no case the plan names is affected.

</details>

Closes #1063
