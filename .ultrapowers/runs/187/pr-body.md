This is the boot for the Jev factory: the three hundred lines that let a sandbox run the new engine when a launch names it, and nothing when it does not. It exists because the engine merged inert, and a one-year inference token that serves every model call still parks every run at the old boot's credential check. You get a way to drive a real plan on the new loop by sha alone, with the old boot untouched as the rollback and the run's record written by the engine itself.

**Merge-ready**

> do: launch a plan with an engine sha that carries the factory; see: the sandbox boots the factory engine instead of the old one, the run's record lands on its evidence branch as the engine goes, and the pull request opens from the sandbox, while a launch naming any older sha boots exactly as it did yesterday.

| task | claim | exam | probes | mutant | suite |
|---|---|---|---|---|---|
| 1 | A sandbox handed a run reads what it was assigned, refuses a credential that is really dead without refusing one that is merely scoped for inference, starts the factory engine, keeps the run's record on its evidence branch while the engine works, and when the engine is done pushes the branch, opens the pull request and leaves the two tags that are the run's record. | red at BASE → green | — | — | — |
| 2 | A launch that names an engine sha carrying the factory boots the factory, and a launch naming any older sha boots exactly as it did yesterday. | red at BASE → green | — | — | — |
| 3 | The next run's examiner is told, in the brief it reads, that a node exam which starts a process passes the sim environment from the helpers file, so the exam it writes passes the hermetic sweep instead of leaving the pull request held on a red. | none | — | — | — |

Act on these: 2 of 9

- task 1 reviewer — factory/boot.sh:45-48 — `json_escape` escapes backslash, double quote, tab and newline, but leaves every other C0 control byte raw. The one place a foreign byte string reaches `status.json` is M6's failure page: `fail "${reply:0:2000}"` (line 264) puts the first 2000 characters of an arbitrary HTTP reply into `error`. A GitHub-edge reply or proxy error page with CRLF line endings leaves a raw CR inside a JSON string, which is invalid JSON — the operator's page for the very run that failed becomes unparseable. The exam's 422 fixture is 3000 `x` characters, so leg (f) never sees a control byte and EXAM EVIDENCE does not settle this. The fix stays inside the 300-line budget: one more `gsub` on the existing awk line, no new line. — attention 2.9, actor implementer, unverified / implementation
- task 1 reviewer — factory/boot.sh:168 — `tick_events` decides "the bytes differ" with `[ "$(cat "$src")" = "$(cat "$dst")" ]`. Command substitution strips trailing newlines from both sides, so a tick whose only new bytes are trailing newlines is read as no change, and each tick loads the whole event log into two shell variables. `cmp -s` compares the files themselves, is exact, and resolves through PATH like every other helper the script already uses (`cat`, `cp`, `sed`, `awk`): `if [ -f "$dst" ] && cmp -s "$src" "$dst" — attention 2.8, actor implementer, verified / implementation

Residuals: 9 from review

Amendments: none

<details><summary>Record</summary>

## fleet run-187 — gate-green

| | |
|---|---|
| verdict | `PASS` |
| target | `popmechanic/ultrapowers` at `0bea22669c3656f2a3b5596c7b407a9aa2f3a342` |
| engine | `0bea22669c3656f2a3b5596c7b407a9aa2f3a342` |
| plan | `.ultrapowers/plan.md` at `9a2829fd837f68e4ecea78dcdffad3b3013ad0e8` |
| branch | `ultra/integration-run-187` |
| vm | `fleet-r187-2609180325-2def` |

### Checks

```json
{"mode": "gate", "stamp": "run-187", "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-187/report.json", "branch": "ultra/integration-run-187", "gateCheck": {"verdict": "PASS", "checks": [{"name": "report-parse", "ok": true, "detail": ""}, {"name": "clean-tree", "ok": true, "detail": ""}, {"name": "wave-merges", "ok": true, "detail": ""}, {"name": "head-match", "ok": true, "detail": ""}, {"name": "git-verified", "ok": true, "detail": ""}, {"name": "ancestry", "ok": true, "detail": ""}, {"name": "deliverables", "ok": true, "detail": ""}], "notes": [], "repo": "/home/exedev/target"}, "gateCheckExit": 0, "suite": {"passed": true, "unattributed": [], "output": "============================= test session starts ==============================\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\nrootdir: /home/exedev/target/.claude/ultrapowers/run-run-187/clones/integration\nconfigfile: pytest.ini\ntestpaths: tests\nplugins: xdist-3.4.0\ncreated: 3/3 workers\n3 workers [462 items]\n\n........................................................................ [ 15%]\n........................................................................ [ 31%]\n........................................................................ [ 46%]\n........................................................................ [ 62%]\n........................................................................ [ 77%]\n........................................................................ [ 93%]\n..............................                                           [100%]\n======================= 462 passed in 185.51s (0:03:05) ========================\n"}, "verdict": "PASS"}

```

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-187/.ultrapowers/runs/187/

- approve-receipt.json
- claude-version.txt
- engine.log
- events.jsonl
- exams
- frontier
- gate-receipt.json
- kata.jsonl
- pr-body.md
- publish-fold
- receipt.json
- report.json
- residuals-jev.jsonl
- residuals.jsonl
- status.json
- transcripts

### Plan

https://github.com/popmechanic/ultrapowers/blob/ultra/plan/run-187/.ultrapowers/plan.md

### Residuals

- [ ] task 1 reviewer — factory/boot.sh:45-48 — `json_escape` escapes backslash, double quote, tab and newline, but leaves every other C0 control byte raw. The one place a foreign byte string reaches `status.json` is M6's failure page: `fail "${reply:0:2000}"` (line 264) puts the first 2000 characters of an arbitrary HTTP reply into `error`. A GitHub-edge reply or proxy error page with CRLF line endings leaves a raw CR inside a JSON string, which is invalid JSON — the operator's page for the very run that failed becomes unparseable. The exam's 422 fixture is 3000 `x` characters, so leg (f) never sees a control byte and EXAM EVIDENCE does not settle this. The fix stays inside the 300-line budget: one more `gsub` on the existing awk line, no new line.
- [ ] task 1 reviewer — factory/boot.sh:168 — `tick_events` decides "the bytes differ" with `[ "$(cat "$src")" = "$(cat "$dst")" ]`. Command substitution strips trailing newlines from both sides, so a tick whose only new bytes are trailing newlines is read as no change, and each tick loads the whole event log into two shell variables. `cmp -s` compares the files themselves, is exact, and resolves through PATH like every other helper the script already uses (`cat`, `cp`, `sed`, `awk`): `if [ -f "$dst" ] && cmp -s "$src" "$dst"
- [ ] task 1 reviewer — then return 0
- [ ] task 1 reviewer — fi`. Same line count, so M9 still holds. Advisory only — leg (e) of EXAM EVIDENCE passes as written, since the engine's rows always end in a newline.
- [ ] task 1 reviewer — concern: plan-defect: the task says the immutable bootstrap clones the engine before exec'ing this boot, but names no path convention for where it lands. I chose $FLEET_HOME/engines/$ENGINE_SHA (with the engine's own fleet/ beside its factory/), reading `engine=<sha>` out of the assignment
- [ ] task 1 reviewer — boot.sh does not clone the engine itself and fails at engine_deps if that directory is absent. Sibling task 2 (popmechanic-ultrapowers#wr1m, fleet/fleet-bootstrap.sh) owns the dispatch line and must stage the engine checkout at exactly that path, or the two halves will not meet. Worth a cross-check before the first real run.
- [ ] task 1 reviewer — concern: factory/boot.sh is 300 lines against a 300-line cap — zero slack. Any future edit has to pay for itself by deleting a line. The compaction to fit went through comment density and statement joining rather than dropped behaviour, but a reviewer wanting more prose in the file will have to take code out to get it.
- [ ] task 1 reviewer — concern: The bearer probe's inconclusive-and-proceed default means a genuinely broken proxy that answers something outside the three recognised shapes costs a full engine start before anything notices. That is the task's stated trade (a probe that manufactured parks out of flakes would cost more runs than it saved), so it is implemented as specified — flagging it as the known cost, not as a defect.
- [ ] task 1 reviewer — concern: record_tags reads the evidence HEAD once at the top and pushes both tags before verifying either, so an evidence commit that lands between the read and the push would be tagged one commit short. This mirrors the old boot's shape deliberately, and nothing writes to the evidence branch concurrently at that point in the run (the relay has stopped), but it is the one ordering assumption in the function.

</details>

