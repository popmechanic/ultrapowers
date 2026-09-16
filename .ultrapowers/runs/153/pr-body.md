This fixes the fleet so a third plan landing on a busy main no longer dies at its publish fold. Today the resolver's brief is handed to the worker as one command-line argument, and Linux refuses any argument over 128 KB, so a fold that has to describe everything two siblings already landed cannot start. After this run every worker prompt travels on stdin and each resolver's brief carries only its own file's contending block, written to a file the brief names, so concurrent plans keep landing however many went first.

**Merge-ready**

> A resolver gets its brief however long it is, and a fold onto a main that two siblings already landed on dispatches every resolver instead of dying on the first.

| task | claim | exam | probes | mutant | suite |
|---|---|---|---|---|---|
| 1 | A worker gets its prompt whole however long it is, and nothing prompt-sized is on the command line the worker was started with. | red at BASE → green | — | — | — |
| 2 | A publish-fold resolver is briefed on the one path it is resolving and told where to read the rest, so its brief stays short however many siblings landed first and however many paths conflicted. | red at BASE → green | — | — | — |

Residuals: 10 from review

Amendments: none

<details><summary>Record</summary>

## fleet run-153 — gate-green

| | |
|---|---|
| verdict | `PASS` |
| target | `popmechanic/ultrapowers` at `5f75eaaa59aa30801bbab19d0cb6698b3129203b` |
| engine | `5f75eaaa59aa30801bbab19d0cb6698b3129203b` |
| plan | `.ultrapowers/plan.md` at `7e9fd15377ade7959dc615e7a9fa1773f7348d2b` |
| branch | `ultra/integration-run-153` |
| vm | `fleet-r153-2609160245-09ce` |

### Checks

```json
{"mode": "gate", "stamp": "run-153", "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-153/report.json", "branch": "ultra/integration-run-153", "gateCheck": {"verdict": "PASS", "checks": [{"name": "report-parse", "ok": true, "detail": ""}, {"name": "clean-tree", "ok": true, "detail": ""}, {"name": "wave-merges", "ok": true, "detail": ""}, {"name": "head-match", "ok": true, "detail": ""}, {"name": "git-verified", "ok": true, "detail": ""}, {"name": "ancestry", "ok": true, "detail": ""}, {"name": "deliverables", "ok": true, "detail": ""}], "notes": [], "repo": "/home/exedev/target"}, "gateCheckExit": 0, "suite": {"passed": true, "unattributed": [], "output": "============================= test session starts ==============================\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\nrootdir: /home/exedev/target/.claude/ultrapowers/run-run-153/clones/integration\nconfigfile: pytest.ini\ntestpaths: tests\nplugins: xdist-3.4.0\ncreated: 3/3 workers\n3 workers [276 items]\n\n........................................................................ [ 26%]\n........................................................................ [ 52%]\n........................................................................ [ 78%]\n............................................................             [100%]\n======================== 276 passed in 84.01s (0:01:24) ========================\n"}, "verdict": "PASS"}

```

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-153/.ultrapowers/runs/153/

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

https://github.com/popmechanic/ultrapowers/blob/ultra/plan/run-153/.ultrapowers/plan.md

### Residuals

- [ ] task 2 reviewer — fleet/publish-fold.mjs — `writeResolverBriefs`'s returned function silently falls back to a *constructed* path for a conflict that was never written: `(written.get(String(conflict && conflict.i)) || contendingPath(conflict && conflict.i))`. `resolveConflicts` does not only drain the `open` list it was handed — its continued-fold branch replaces the worklist wholesale (`outstanding = a.open.slice()`, fleet/run-engine.mjs ~line 990, and the conflict row carries an `epoch` precisely because the kernel opens conflicts in later epochs). A later-epoch conflict's `i` was never in the `open` array `writeResolverBriefs` iterated, so its brief names `contending-<i>-<attempt>.txt` — a file that does not exist — and tells the resolver "read it before resolving". The resolver Reads, gets ENOENT, and loses its contending context on a hunk it is still expected to resolve. (BASE degraded on the same edge — it handed later-epoch conflicts the *first* epoch's blocks — so this is a changed symptom, not a new hole, which is why it is minor rather than blocking.) The `conflict == null` fallback is the same expression and yields `contending-false-<attempt>.txt`. Fix: when `written` has no entry, emit the `MAIN PATCH FILE:` line alone. The exam stays green — legs (c) only ask for conflicts that were in `open`.
- [ ] task 2 reviewer — fleet/publish-fold.mjs step 4 — the evidence-copy loop re-derives the filename `'contending-' + c.i + '-' + attemptKey + '.txt'` that `writeResolverBriefs` owns internally via its private `contendingPath`. The two spellings agree today (`attemptKey` is already a String, so `String(attemptKey)` is a no-op), but the coupling is undeclared: if the name ever changes inside the helper, `fs.copyFileSync` throws ENOENT out of `publishFold`, and `publishFold`'s own contract is that it "REJECTS only on a fault that is not a disposition" — a receipt-copy typo would become a whole-fold fault. The Produces interface pins the helper's return to the brief function alone, so it cannot return the paths
- [ ] task 2 reviewer — exporting the name builder (e.g. `export const contendingFileName = (i, attemptKey) => ...`) and using it in both places removes the duplicate literal without changing the interface.
- [ ] task 2 reviewer — Test coverage: the exam pins `writeResolverBriefs` in isolation (leg c) and `resolveConflicts`'s dispatch (legs a, b), but nothing exercises the step-4 wiring the Context requires — that `briefsDir` is `path.join(foldRunDir, 'briefs')` (under the run directory the resolver gets as `--add-dir`, never inside a kernel-owned `frontier/wave-<a>/`), that `blockFor` is `buildContendingBlock({ repo, base, tip, run, path: p, tasks })`, that the result is passed as `contendingBlock`, and that each `contending-<i>-<attempt>.txt` is copied into `foldEvidence`. Those are all present and correct on inspection (fleet/publish-fold.mjs step 4, the `briefsDir`/`blockFor`/`block` lines and the copy loop), and the Proof names no leg for them, so this is advisory only — but a regression that pointed `briefsDir` outside the add-dir, or dropped the evidence copy the CONTRACT.md receipt now advertises, would leave the whole exam green. A sim driving `publishFold` with injected `exec`/`makeAgent` is what would settle it.
- [ ] task 1 reviewer — Stale prose left inside this task's own FILES. `fleet/run-worker.mjs` (the comment above `childEnvFor`, BASE lines 840–845, post-patch ~843–848) still asserts in the present tense that a `pkill -f` "matched the `claude -p` argv that carries that very text" — after this diff the argv carries neither the prompt nor the TEST COMMAND line, which is precisely the property M2 pins and the new sim's leg (b) proves. The task's Context reserves `childEnvFor` itself ("line 851 and everything below the spawn are untouched") and the mechanism it documents is unaffected — the hook never sees the prompt, so the worker still hands it the line — so this is prose only, and the diff already rewrote its two siblings (the `buildArgs` block and the `runProcess` block). Graded minor because no Machine clause or Run reads it.
- [ ] task 1 reviewer — `fleet/confine-hook.mjs` lines 202–208 carry the same claim this change falsifies — "The worker is a `claude -p <prompt>` process, so its argv carries the whole prompt — the role text, the FILES line, the TEST COMMAND line" — and it is the stated justification for the `pkill`/`killall` deny. The deny's behaviour is unaffected and stays fail-safe (it now refuses a pattern that could no longer match the worker, i.e. it is over-broad rather than unsound), so nothing breaks
- [ ] task 1 reviewer — but the file is pinned byte-identical to BASE by Global Constraint 1 and is outside this task's FILES, so no edit in this tree can answer it. Actor `plan`: it wants a follow-up task, not a fix round.
- [ ] task 1 reviewer — unverified: `fleet/tests/test_run_engine_infra_retry.mjs` (line ~702) is the one `test_*.mjs` that drives the REAL `createRunWorker` with the default `spawnFn` against a real fake `claude` node script (line ~657) that never reads its stdin. This diff turns that child's fd 0 from `'ignore'` into a pipe the worker writes the whole prompt to and ends. The reasoning says it is safe — a prompt of this size fits the 64 KiB pipe buffer, and an early exit raises `EPIPE` on a stdin that now has an `error` listener — but that path is not in this task's Proof `Run:` list and no RUN/EXAM/CHECK evidence covers it. What would settle it: `node fleet/tests/test_run_engine_infra_retry.mjs`. Graded minor because the diff cannot settle it by reading and it blocks nothing this task claims.
- [ ] task 1 reviewer — concern: out-of-FILES (not taken): `fleet/tests/README.md` line 8 names `test_run_worker.mjs`, which does not exist at BASE, and the index names neither `test_worker_kata_env.mjs` nor the new `test_worker_prompt_stdin.mjs`. The index is owed an entry for the prompt-transport sim and a removal of the stale row
- [ ] task 1 reviewer — the path is outside this task's FILES so the edit was not made.

</details>

Closes #1035
