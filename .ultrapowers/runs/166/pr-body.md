Today the record of how a run's edits were folded together — which files collided, what shape each collision took, and how many times a resolver was asked to settle one — is written on the sandbox and dies with it, so nobody can say whether the collisions we pay resolvers for are the trivial kind or the hard kind. After this, every run's fold record is copied onto its evidence tag beside the receipts, bounded so a runaway file can never swamp the record, and a census reads those copies back as one row per run: conflicts by shape, resolver dispatches, retries and how many were settled. That row is what lets the resolver policy be decided on a count rather than a story, and it is read from the tag long after the sandbox is gone.

**Merge-ready**

> `collect_evidence` copies `frontier/` (fold logs, conflicts index, narrations, briefs, replies) into `.ultrapowers/runs/<N>/frontier/` beside the receipts, sized (briefs and replies are small text); the boot writes `publish:pr`, `publish:hold` and `publish:merge` events per #703; `census.py` reads the fold logs and emits per run: conflicts narrated, by shape (insert-only at one anchor / deletion-only / overlapping modification / binary), resolver dispatches, retries

| task | claim | exam | probes | mutant | suite |
|---|---|---|---|---|---|
| 1 | After a run, I open its evidence tag and find, beside the receipts, every fold log, conflicts index, narration, resolver brief and resolver reply the run wrote, and the weave sidecar's manifest and event log — but never the weave's blob store, and never a single file so large it would swamp the record. | red at BASE → green | — | — | — |
| 2 | I point one script at a run's evidence directory and read one row for that run: how many conflicts its folds narrated, how many were insert-only, deletion-only, overlapping or binary, how many parked, how many resolvers were dispatched, how many of those were retries, and how many conflicts were settled. | red at BASE → green | — | — | — |

Residuals: 10 from review

Amendments: none

<details><summary>Record</summary>

## fleet run-166 — gate-green

| | |
|---|---|
| verdict | `PASS` |
| target | `popmechanic/ultrapowers` at `407ead2b11d2af017ecda1302c61ca72b1dcb721` |
| engine | `407ead2b11d2af017ecda1302c61ca72b1dcb721` |
| plan | `.ultrapowers/plan.md` at `5f06d739157a22e8f84f8fc8f3134255e1069b64` |
| branch | `ultra/integration-run-166` |
| vm | `fleet-r166-2609161828-86ab` |

### Checks

```json
{"mode": "gate", "stamp": "run-166", "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-166/report.json", "branch": "ultra/integration-run-166", "gateCheck": {"verdict": "PASS", "checks": [{"name": "report-parse", "ok": true, "detail": ""}, {"name": "clean-tree", "ok": true, "detail": ""}, {"name": "wave-merges", "ok": true, "detail": ""}, {"name": "head-match", "ok": true, "detail": ""}, {"name": "git-verified", "ok": true, "detail": ""}, {"name": "ancestry", "ok": true, "detail": ""}, {"name": "deliverables", "ok": true, "detail": ""}], "notes": [], "repo": "/home/exedev/target"}, "gateCheckExit": 0, "suite": {"passed": true, "unattributed": [], "output": "============================= test session starts ==============================\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\nrootdir: /home/exedev/target/.claude/ultrapowers/run-run-166/clones/integration\nconfigfile: pytest.ini\ntestpaths: tests\nplugins: xdist-3.4.0\ncreated: 3/3 workers\n3 workers [319 items]\n\n........................................................................ [ 22%]\n........................................................................ [ 45%]\n........................................................................ [ 67%]\n........................................................................ [ 90%]\n...............................                                          [100%]\n======================== 319 passed in 91.51s (0:01:31) ========================\n"}, "verdict": "PASS"}

```

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-166/.ultrapowers/runs/166/

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

https://github.com/popmechanic/ultrapowers/blob/ultra/plan/run-166/.ultrapowers/plan.md

### Residuals

- [ ] task 2 reviewer — Global constraint ("the census … never raises on a malformed record: a file it cannot read is one stderr line and a count of zero, never a traceback") — `_resolve_epochs` in `skills/ultrapowers/scripts/fold_census.py` wraps `path.read_text()` in `except FileNotFoundError` / `except OSError`, but a `fold_log.jsonl` holding invalid UTF-8 (the truncated-mid-wave evidence the module docstring says is exactly the run worth counting) raises `UnicodeDecodeError`, a `ValueError` subclass that neither clause catches — the census exits with a traceback instead of one `SWALLOW:` line and zero resolutions. `_read_index` is already safe here (its `json.loads(path.read_text())` sits under `except (OSError, ValueError)`) and `_narration` is safe via `errors="replace"`
- [ ] task 2 reviewer — only this one read is exposed. This constraint carries no `Check:` the driver ran, so it is graded minor.
- [ ] task 2 reviewer — M3 reads `dispatches` as "the number of `reply-<i>-<attempt>/` directories" in a wave, but `_totals` sums the per-conflict `dispatches` computed in `_census_conflict` from `attempts.get(i)`, so a `reply-<i>-<attempt>/` whose `<i>` matches no `conflicts.json` entry is silently uncounted — and a wave whose `conflicts.json` is unreadable (M5's `{` case) contributes 0 dispatches however many reply directories sit beside it. Every leg of the exam passes because the fixtures' reply directories all pair with entries, and M4's per-conflict `dispatches` key does require per-entry attribution, so this only shows on corrupt evidence
- [ ] task 2 reviewer — noting it rather than asking for a rewrite. If you want the literal M3 reading, count `sum(len(v) for v in attempts.values())` per wave and carry it beside the per-conflict figure.
- [ ] task 1 reviewer — Dead code added to a shared helper: `fleet/tests/_sandbox_boot_helpers.mjs` gains exported `evidenceRunDir(ctx)` and `evidenceFile(ctx, rel)`, but nothing in the tree imports them — the sim's import list is `ENV, RUN_PATH, makeHome, bootAsync, runDir, trees, stream, runTests`, and it defines its OWN local `evidenceFile` at test_sandbox_boot_fold_record.mjs (`path.join(ctx.home, 'evidence', RUN_PATH, 'frontier', rel)`). The task said the helper 'may be added ... or kept local to the sim
- [ ] task 1 reviewer — either is lawful' — doing both leaves an unused export and, worse, two functions of the same name with different contracts in the same suite: the helper's `rel` is relative to the run directory, the sim's is relative to `frontier/`. A later sim that imports the helper expecting the sim's meaning silently reads the wrong path. Drop the helper hunk (the sim is self-contained without it), or delete the local and import the helper, passing `frontier/<rel>`.
- [ ] task 1 reviewer — The once-ever memo for M3's skip line is a substring grep over the whole boot log — `grep -qF "evidence: frontier/$rel is " "$BOOT_LOG"` in `collect_evidence` (fleet/sandbox-boot.sh) — and `$BOOT_LOG` is not a private channel: the engine's combined stdout/stderr is tee'd into it (fleet/sandbox-boot.sh:1190, `2>&1 | tee -a "$ENGINE_LOG" >>"$BOOT_LOG"`), as is the systemd arm at :2028. Any engine or worker line that happens to carry `evidence: frontier/<rel> is ` — a worker quoting a boot log, a sim's own expected-string in a transcript echo — suppresses the skip line for that file for the rest of the run, and the record then names nothing at all for the file it left behind, which is the one thing M3 asks the log to carry. It also re-scans a log that grows with the whole engine transcript, once per over-cap file per transition. The exam cannot see this (its stub engine writes no such line), so the green is honest but narrow. A memo the engine cannot forge would settle it: a marker the copy owns, e.g. `printf '%s\n' "$rel" >>"$dest/.frontier-skipped"` checked with `grep -qxF`, or a `$FLEET_HOME`-local memo file, keeping the human-readable `log` line exactly as M3 spells it.
- [ ] task 1 reviewer — concern: plan-defect: the Context's helper name `evidenceFile(ctx, rel)` collided with an existing export — `_sandbox_boot_helpers.mjs` line 1213 already exports `evidenceDir(ctx) = ctx.home/evidence`, the WORKTREE root, not the run path. The run-relative directory helper is therefore named `evidenceRunDir` and `evidenceFile(ctx, rel)` keeps the name the Context spells, returning the absolute path of `.ultrapowers/runs/7/<rel>`. A peer exam that expected `evidenceFile` to return contents (the way `foldFile` does) would read absent as empty, which legs (c), (d) and (e) cannot afford.
- [ ] task 1 reviewer — concern: plan-defect: leg (g) says `at BASE the range is 164 lines`
- [ ] task 1 reviewer — at this BASE (407ead2b) the `ultra/evidence-run-<N>`-to-`**The two tags**` range is 192 lines. The count is stale, not load-bearing — the range carries neither `weave/blobs` nor `FLEET_EVIDENCE_FILE_MAX` at BASE exactly as the leg says, so the second `Run:` is red at BASE and green now. No change was made on account of it.

</details>

Closes #728
