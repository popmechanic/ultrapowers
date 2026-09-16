This plan closes three holes in the seam between the engine and its workers, each one seen on a real run: a reconcile worker that died silently and took the epoch with it (run-20), two decisions still made by matching prose that a rename would break without a sound, and an npm package that shadowed the sandbox's own Bun under the suite. It exists because each of those turned a green-looking run into a parked one with nothing on the record to say why. After it, the record names why a worker died, the epoch gets one more chance before it is blocked, the escalation lever and the worker's role are values the code declares, and the driver's commands find the sandbox's toolchain before anything a package install dropped into the tree.

**Merge-ready**

> do: run a plan on the fleet; see: a worker that died before its first token says why on the record, a reconcile that produced no reply is asked once more before the epoch is blocked, a schema trip is escalated on the worker's own verdict class and a worker's role is the one its dispatch declared — never read off the wording of a message or a label — and every command the driver runs sees the sandbox's toolchain first on its PATH.

| task | claim | exam | probes | mutant | suite |
|---|---|---|---|---|---|
| 1 | do: read the record of a worker that exited without ever reaching the model; see: its `worker:end` line says which of two things happened — the process never started, or it ran and exited with no reply — with the exit code or errno and the last of what it wrote to stderr. | red at BASE → green | 2/2 | — | — |
| 2 | do: fold a wave whose candidate suite is red and whose reconcile worker dies without answering; see: the driver asks a fresh reconcile worker the same question once more, records that it did, and only blocks the epoch when the second one has no reply either. | red at BASE → green | 1/1 | — | — |
| 3 | do: rename or reword what a worker says when it fails; see: a schema trip still gets the stronger model and any other failure still gets the same-tier retry, because the driver reads the class the worker attached, not the sentence it wrote. | red at BASE → green | 1/1 | — | — |
| 4 | do: add a dispatch site or rename a label; see: the worker refuses to start until that site says which role it is, and the tool allowlist, permission mode and writable root it gets are the declared role's — a label's spelling decides nothing. | red at BASE → green | 2/2 | — | — |
| 5 | do: run a suite, a proof, a check or an exam through the driver on a tree whose package install dropped its own `bun` into `node_modules/.bin`; see: the command's PATH starts with the sandbox's toolchain directory, so a direct `bun` or `bunx` is the sandbox's, whatever the login profile or the tree put on PATH. | red at BASE → green | 1/1 | — | — |

Residuals: 1 from review

Amendments: none

<details><summary>Record</summary>

## fleet run-167 — gate-green

| | |
|---|---|
| verdict | `PASS` |
| target | `popmechanic/ultrapowers` at `d5bf796afb2dcaccd0d0d3b0eba8cbfb0dff4425` |
| engine | `d5bf796afb2dcaccd0d0d3b0eba8cbfb0dff4425` |
| plan | `.ultrapowers/plan.md` at `0be9e27e70c0fe5c0dea773b177f3702289d79b5` |
| branch | `ultra/integration-run-167` |
| vm | `fleet-r167-2609161911-5d82` |

### Checks

```json
{"mode": "gate", "stamp": "run-167", "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-167/report.json", "branch": "ultra/integration-run-167", "gateCheck": {"verdict": "PASS", "checks": [{"name": "report-parse", "ok": true, "detail": ""}, {"name": "clean-tree", "ok": true, "detail": ""}, {"name": "wave-merges", "ok": true, "detail": ""}, {"name": "head-match", "ok": true, "detail": ""}, {"name": "git-verified", "ok": true, "detail": ""}, {"name": "ancestry", "ok": true, "detail": ""}, {"name": "deliverables", "ok": true, "detail": ""}], "notes": [], "repo": "/home/exedev/target"}, "gateCheckExit": 0, "suite": {"passed": true, "unattributed": [], "output": "============================= test session starts ==============================\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\nrootdir: /home/exedev/target/.claude/ultrapowers/run-run-167/clones/integration\nconfigfile: pytest.ini\ntestpaths: tests\nplugins: xdist-3.4.0\ncreated: 4/4 workers\n4 workers [324 items]\n\n........................................................................ [ 22%]\n........................................................................ [ 44%]\n........................................................................ [ 66%]\n........................................................................ [ 88%]\n....................................                                     [100%]\n======================== 324 passed in 76.77s (0:01:16) ========================\n"}, "verdict": "PASS"}

```

## Publish fold

- attempt 1: folded

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-167/.ultrapowers/runs/167/publish-fold/receipt.json

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-167/.ultrapowers/runs/167/

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

https://github.com/popmechanic/ultrapowers/blob/ultra/plan/run-167/.ultrapowers/plan.md

### Residuals

- [ ] task 3 reviewer — Comment drift in fleet/run-worker.mjs: the rewritten `fail-run` paragraph (patch lines 87-91) now says the classifiers "only recognise ... a verdict class the engine escalates for", but still attributes that to `waves.js:1014` two lines above, while the sibling `default:` case in the same hunk was updated from "waves.js retries" to "the engine retries". Reading `err.workerVerdict.class` is the engine's behavior, not the legacy waves.js fallback's, so as written the comment credits the wrong component. Nothing in the Machine clauses turns on it (M3 only demands the `isSchemaTrip` token be gone, and it is), so this is advisory.

</details>

Closes #1054
Closes #410
Closes #1051
