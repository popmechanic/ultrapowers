This is the reading #992 asked for after the engine rewrote its core loop on sixteen sims: three small instruments and one doc fix, none of them a gate. It exists because the doctrine that deletes a test with no catches is right, and yet the engine is changing faster than the record can catch anything — so the record must say what the sims reached, a design gate must survive the ratchet, and an owed follow-up must not depend on a sitting noticing it. After this run every merged engine change carries its own coverage reading on the evidence tag, every out-of-FILES disclosure a run could not take becomes an issue the sandbox opens beside its PR, #832's fold-order sim is back as a probe run by hand, the catch counter knows a design gate is not ballast, and the report reference speaks epoch vocabulary in its last wave-loop row.

**Parked:** parked: gate verdict BLOCKED

> After this run I can see which changed engine lines a test reached, a fix a worker couldn't make becomes a ticket next to its PR, and the scheduler's ordering check is back as something I run by hand.

| task | claim | exam | probes | mutant | suite |
|---|---|---|---|---|---|
| 1 | When a run that changed the engine merges, its record says which of the changed lines a sim actually ran and which none did — a reading beside the receipt, never a gate. | red at BASE → green | — | — | — |
| 2 | The fold-order gate is back as a probe I run by hand before any scheduler change, and the catch counter no longer lists a design gate as something to delete. | red at BASE → green | — | — | — |
| 3 | An edit a task needed but could not make — the plan froze the file — becomes a ticket the run opens beside its PR, so the follow-up stops waiting for someone to notice it in a note. | red at BASE → green | — | — | — |
| 4 | When I read the report reference, the `frontier` row speaks the same epoch language as the rest of it — an entry per epoch fold that took the contended path — and no longer names a wave loop or a serialize knob. | none | — | — | — |

Residuals: 23 from review

<details><summary>Record</summary>

## fleet run-146 — parked

| | |
|---|---|
| verdict | `BLOCKED` |
| target | `popmechanic/ultrapowers` at `8c4f493d4ad52f43ee3bf6ccd9f6c8ff125f932a` |
| engine | `8c4f493d4ad52f43ee3bf6ccd9f6c8ff125f932a` |
| plan | `.ultrapowers/plan.md` at `e1fc861529e2aa3f021447a4eade9419706feb4d` |
| branch | `ultra/integration-run-146` |
| vm | `fleet-r146-2609151710-ab15` |

### Checks

```json
{"mode": "gate", "stamp": "run-146", "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-146/report.json", "branch": "ultra/integration-run-146", "gateCheck": {"verdict": "BLOCKED", "checks": [{"name": "report-parse", "ok": true, "detail": ""}, {"name": "clean-tree", "ok": true, "detail": ""}, {"name": "wave-merges", "ok": false, "detail": "merge-sha guard unavailable \u2014 result lacks waveMerges[last].headSha (budget-exhausted or SKIPPED-only run); inspect and redirect/re-run"}, {"name": "head-match", "ok": false, "detail": "skipped \u2014 no recorded merge headSha to compare"}, {"name": "git-verified", "ok": true, "detail": ""}, {"name": "ancestry", "ok": true, "detail": ""}, {"name": "deliverables", "ok": true, "detail": ""}], "notes": [], "repo": "/home/exedev/target"}, "gateCheckExit": 1, "suite": {"passed": true, "unattributed": [], "output": "============================= test session starts ==============================\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\nrootdir: /home/exedev/target/.claude/ultrapowers/run-run-146/clones/integration\nconfigfile: pytest.ini\ntestpaths: tests\nplugins: xdist-3.4.0\ncreated: 4/4 workers\n4 workers [220 items]\n\n........................................................................ [ 32%]\n........................................................................ [ 65%]\n........................................................................ [ 98%]\n....                                                                     [100%]\n============================= 220 passed in 42.71s =============================\n"}, "verdict": "BLOCKED"}

```

## Publish fold

- attempt 1: folded

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-146/.ultrapowers/runs/146/publish-fold/receipt.json

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-146/.ultrapowers/runs/146/

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

https://github.com/popmechanic/ultrapowers/blob/ultra/plan/run-146/.ultrapowers/plan.md

### Residuals

- [ ] task 2 reviewer — `fleet/tests/PROBES.md` keeps the BASE sentence "The naming is the whole mechanism — CI and the suite never run these" in the very paragraph this diff rewrote, but the task's own exam `tests/test_catch_report.py` (collected by the repository's pytest suite) spawns `node fleet/tests/probe_readiness_fold_order.mjs` twice — once in `test_leg_e_probe_run` and once in `test_leg_g_unresolvable_fixture_set_is_skipped` — so CI now runs this probe on every pytest run (~7 s each in the driver's evidence). The naming mechanism still holds for the bridge (`collect_sims` globs `test_*.mjs`, `tree_test_files` globs the same, the hermetic sweep's `isSwept` reads only `test_*.mjs`/`_*.mjs` — all verified), so nothing is broken
- [ ] task 2 reviewer — the prose is what has gone stale. Grounded only in my reading of the prose constraint "a `probe_*.mjs` never joins the bridge", hence minor. Suggested fix, inside this task's own FILES: qualify the sentence in the opening paragraph, e.g. "— CI and the suite never collect these
- [ ] task 2 reviewer — the one place a probe is spawned from a graded test is the design gate's own exam." Adding a clause there does not disturb the `Run:` grep, which only needs `live measurement.*design gate` in the range from `^# fleet.tests probes` to `^The current probes:`.
- [ ] task 2 reviewer — `tests/test_catch_report.py:700` — `_assert_census`'s `assert len(lines) == 7` is stricter than anything M1 or M2 requires, and it pins the *environment* rather than the probe. M2 asks for five `wave-` lines, one `negative-control` line and `ALL TESTS PASSED` last
- [ ] task 2 reviewer — M1 asks for one stdout line per set. Today the plain run prints exactly 7 lines only because all three fixture sets under `fleet/tests/fixtures/readiness/` skip for want of a project tree — the very condition the diff's own PROBES.md entry says is temporary ("at BASE all three are, and they read again the day their project trees return"). The day one returns, `test_leg_e_probe_run` goes red on a correct probe. Suggested fix: keep the wave/control/sentinel assertions and replace the fixed count with a shape assertion — every stdout line is either one of the five `wave-` lines, the `negative-control` line, the sentinel, or a fixture-set census line — so a restored fixture set reads as one more set rather than as a failure. (Leg (g)'s run, where the ghost set is skipped by construction, can keep an exact count.)
- [ ] task 2 reviewer — The gate species ships with no carrier: after this diff the only `# catch-counter:` marker anywhere in the tree is `tests/test_fleet_suite.py:1`'s runner line, so `tree_gates` returns `[]` over this repository and `catch_table`'s `gates=` is always empty in `main`. The Claim's second clause — "the catch counter no longer lists a design gate as something to delete" — therefore changes no actual reading yet. This is not the implementer's to fix: the probe it restores is `probe_readiness_fold_order.mjs`, which `TEST_GLOBS` (`tests/test_*.py`, `fleet/tests/test_*.mjs`) never collects, so no path in this task's FILES can carry the marker, and the plausible carrier (`fleet/tests/test_sims_are_hermetic.mjs`, a model-free design gate that is a collected sim) is outside FILES. M4 only specifies `catch_report.py`'s behaviour, which the diff implements exactly and the exam's legs (a)–(c) pin, so nothing here blocks
- [ ] task 2 reviewer — the operator should know the species is dormant until a follow-up marks a file.
- [ ] task 3 reviewer — plan-defect-adjacent copy-paste gap: `disclosure_items` in `fleet/sandbox-boot.sh` renders `hit.group(2)` verbatim under a `re.S` regex whose `(.+)$` swallows newlines (the added comment says so: "newlines and all"). A `judgmentCalls` entry whose concern text carries a newline therefore renders as MORE THAN ONE line, which breaks M1's "one `- [ ] task <id> — <text>` line per matching entry" and inflates `count`, so the `publish:disclosures` event's `items` (M3) no longer counts entries but lines. The immediately adjacent reader this function is modelled on, `residual_read` (fleet/sandbox-boot.sh:2137-2139), has a `flat()` helper for exactly this reason, documented at fleet/sandbox-boot.sh:2092 ("Every item is ONE line: a newline inside a detail becomes a space, or the checklist would grow lines no reader could tick"). The new reader took the `DASH`, the `sys.stdout.buffer.write` and the shape, and left `flat` behind. The exam's fixture entries are all single-line, so leg (a) and leg (d) cannot see it.
- [ ] task 3 reviewer — `file_disclosures` is called OUTSIDE RE-ENTRY GUARD 2 (fleet/sandbox-boot.sh:3375-3383 at BASE
- [ ] task 3 reviewer — the diff adds the call after the `fi`), and its only precondition is `[ -n "$PR_URL" ]`. On a re-entry `PR_URL` is set from the status page (`PR_URL="$(read_status_field pr)"`, boot ~3220) rather than by `publish`, so a second boot of the same run — the exact case GUARD 2 exists for — files a SECOND issue with the same title and the same boxes. M1 reads "After `publish` has opened the PR" and "exactly one POST"
- [ ] task 3 reviewer — the filing has no idempotency record of its own the way the PR has the status page. This is a genuine trade-off rather than a plain defect (an unguarded call is also what lets a run that died between the POST /pulls and the filing still file on re-entry), which is why it is minor: the narrowest reading of M1 is to move the `file_disclosures` call inside the `else` arm beside `publish "$outcome"`
- [ ] task 3 reviewer — the more forgiving one is to keep it where it is and skip when the run's own `events.jsonl` already carries a `publish:disclosures` line. Neither is exercised by the exam — no leg boots a run whose status page already names a PR.
- [ ] task 3 reviewer — unverified: the new exam `fleet/tests/test_sandbox_boot_disclosures.mjs` will be swept by `fleet/tests/test_sims_are_hermetic.mjs` and collected by `tests/test_fleet_suite.py` once it lands, and neither was run in this task's RUN/EXAM/CHECK evidence (the bridge is Task 1's `Run:` line, not this task's). I read the sweep's three rules against the new file by hand and it is clean — both `spawnSync` calls take `env: ENV`, which resolves across the `./_sandbox_boot_helpers.mjs` import to `export const ENV = simEnv()` (_sandbox_boot_helpers.mjs:878)
- [ ] task 3 reviewer — no `existsSync`/`statSync`/`accessSync` call names a sibling sim
- [ ] task 3 reviewer — no literal absolute read
- [ ] task 3 reviewer — and the sibling-sim names in the header comment are blanked before any rule reads the file. What would settle it rather than argue it is `node fleet/tests/test_sims_are_hermetic.mjs` and `python3 -m pytest -q tests/test_fleet_suite.py` on the integration head after the fold.
- [ ] task 1 reviewer — fleet/engine-coverage.mjs `runSim` creates a fresh `NODE_V8_COVERAGE` directory with `fs.mkdtempSync` and never removes it. The V8 JSON is read exactly once (by `scriptGroupsIn`) and nothing else consumes it, so every reading leaks one temp directory per sim — on a real run that is 13 directories holding a full V8 coverage dump of a ~4,400-line engine (300 functions / 760 ranges per the task's own Context), left under the sandbox's temp dir on every run that changes the engine. M1 does not forbid it and the exam cannot see it, so this is advisory, not blocking. Remove the directory immediately after the groups are read
- [ ] task 1 reviewer — leg (i) only compares the recorded `cov` path strings, so deleting the directory cannot make the exam red.
- [ ] task 1 reviewer — fleet/engine-coverage.mjs's local `git` helper resolves instead of rejecting when git exits non-zero (`err && stdout === undefined ? reject : resolve`)
- [ ] task 1 reviewer — with `execFile`, a non-zero exit still yields a string `stdout`, so a `git diff` that failed outright — a bad sha, a `tree` that is not a repository — resolves to `''`, `changedLinesOf` returns `[]`, and `engineCoverage` reports `null`, which is the same answer it gives for a genuinely unchanged file. The choice is documented on the helper and `null` is the safe answer for a reading that gates nothing, so this blocks nothing
- [ ] task 1 reviewer — but the two cases are indistinguishable to a reader of `report.json`, and an engine-side `git` failure is already caught and nulled at the call site in run-engine.mjs. Consider rejecting on a non-zero exit and letting the call site's existing `catch` turn it into `null` — the outcome is unchanged, and the failure stops being silently spelled as 'no change'.
- [ ] task 1 reviewer — unverified: M1 mandates that each sim run with cwd equal to `tree`, and the engine's call site passes the integration clone (`integ`) as that tree, so the reading spawns every `fleet/tests/test_run_engine_*.mjs` with cwd set to the integration worktree after the last fold. The exam's own fixture sims demonstrate the hazard — they write `.exam-stamps/<name>.start.json` relative to `process.cwd()`, and leg (e) reads those stamps back out of `integ`. The task's Context says the real engine sims build their scratch trees under the OS temp dir, so in practice nothing should land in the worktree, and nothing here can move a sha or a report field computed before the reading
- [ ] task 1 reviewer — but this diff cannot settle whether all 13 real sims are clean. What would settle it: run the reading against the real repository once and check that `git status --porcelain` in the integration clone is byte-identical before and after. If it is not, the fix is M1's cwd clause, which lives in the task text rather than in this tree.

</details>

Closes #992
Closes #1010
