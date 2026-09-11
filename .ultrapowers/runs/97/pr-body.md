This makes a running fleet visible while it runs. Today the run's page shows one word for a whole wave and the record on GitHub falls a wave behind, so a slow run and a stuck run look the same and the only way to tell them apart is to ask Shelley. After this run the page shows each task's current step and its last proof, serves the live event log, and the record catches up within two minutes or ten events, so silence means nothing is happening rather than that nothing can be seen.

**Merge-ready**

> do: open a run's page while a wave is running. see: what each task is doing right now, the last proof that ran and how it went, and the live event log; and the evidence branch is never more than two minutes or a handful of events behind the machine.

| task | claim | exam | probes | mutant | suite |
|---|---|---|---|---|---|
| 1 | While a wave runs, the run's page names what each task is doing and its last proof, serves the live event log, and the record on the evidence branch catches up within two minutes or ten events. | red at BASE → green | — | — | — |

Residuals: 6 from review

<details><summary>Record</summary>

## fleet run-97 — gate-green

| | |
|---|---|
| verdict | `NEEDS_ACK` |
| target | `popmechanic/ultrapowers` at `aad494c4496d104d036dd24652944c9cd618a2e9` |
| engine | `aad494c4496d104d036dd24652944c9cd618a2e9` |
| plan | `.ultrapowers/plan.md` at `03e571caad24dc6ba9c10c0abdbdffb3636c44d2` |
| branch | `ultra/integration-run-97` |
| vm | `fleet-r97-2609110530-cb5e` |

### Checks

```json
{"mode": "gate", "stamp": "run-97", "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-97/report.json", "branch": "ultra/integration-run-97", "gateCheck": {"verdict": "NEEDS_ACK", "checks": [{"name": "report-parse", "ok": true, "detail": ""}, {"name": "clean-tree", "ok": true, "detail": ""}, {"name": "wave-merges", "ok": true, "detail": ""}, {"name": "head-match", "ok": true, "detail": ""}, {"name": "git-verified", "ok": true, "detail": ""}, {"name": "ancestry", "ok": true, "detail": ""}, {"name": "deliverables", "ok": true, "detail": ""}], "repo": "/home/exedev/target"}, "gateCheckExit": 2, "suite": {"passed": true, "unattributed": [], "output": "============================= test session starts ==============================\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\nrootdir: /home/exedev/target/.claude/ultrapowers/run-run-97/clones/integration\nconfigfile: pytest.ini\ntestpaths: tests\nplugins: xdist-3.4.0\ncreated: 6/6 workers\n6 workers [1622 items]\n\n........................................................................ [  4%]\n........................................................................ [  8%]\n........................................................................ [ 13%]\n........................................................................ [ 17%]\n........................................................................ [ 22%]\n........................................................................ [ 26%]\n........................................................................ [ 31%]\n........................................................................ [ 35%]\n........................................................................ [ 39%]\n........................................................................ [ 44%]\n........................................................................ [ 48%]\n........................................................................ [ 53%]\n........................................................................ [ 57%]\n........................................................................ [ 62%]\n........................................................................ [ 66%]\n........................................................................ [ 71%]\n........................................................................ [ 75%]\n........................................................................ [ 79%]\n........................................................................ [ 84%]\n........................................................................ [ 88%]\n........................................................................ [ 93%]\n........................................................................ [ 97%]\n......................................                                   [100%]\n=============================== warnings summary ===============================\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\ntests/test_harvest_fleet_runs.py::test_a_corrupt_tarball_among_healthy_ones_is_named_and_the_rest_land\ntests/test_harvest_fleet_runs.py::test_an_unreadable_tarball_is_named_in_a_whole_failed_lookup_line\ntests/test_harvest_fleet_runs.py::test_discover_unpacks_a_tarball\n  /usr/lib/python3.12/tarfile.py:2301: DeprecationWarning: Python 3.14 will, by default, filter extracted tar archives and reject files or modify their metadata. Use the filter argument to control this behavior.\n    warnings.warn(\n\n-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html\n================= 1622 passed, 5 warnings in 411.00s (0:06:50) =================\n"}, "verdict": "NEEDS_ACK"}

```

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-97/.ultrapowers/runs/97/

- approve-receipt.json
- claude-version.txt
- engine.log
- events.jsonl
- gate-receipt.json
- pr-body.md
- publish-fold
- receipt.json
- referee
- report.json
- residuals.jsonl
- standing-approval.json
- status.json
- transcripts

### Plan

https://github.com/popmechanic/ultrapowers/blob/ultra/plan/run-97/.ultrapowers/plan.md

### Residuals

- [ ] critic — fleet/CONTRACT.md:309-311 (the `- **status.json:**` bullet, Task 1 slot M5 / Global Constraint 1) contradicts itself in one sentence: it says the `"tasks":` cell "is a projection of `events.jsonl` and nothing else" and then, in the same clause, "one key per task id the plan's waves or the log names". The plan's waves are read from `$(run_dir_path)/args.json`, not from `events.jsonl` — see `project_read`'s `ARGS` arm at fleet/sandbox-boot.sh:371-384 and `status_tasks` at :480-484, which is what supplies a `queued` cell and a `wave` number for a task no event has yet named. The implementation is what M2 mandates; the contract's "and nothing else" is the wrong half of the sentence and also overstates Global Constraint 1 ("nothing on the page is a fact the log does not carry") for exactly those not-yet-started tasks. Worth an issue against the wording, not a reason to hold the merge: the projector still writes nothing and invents no event kind.
- [ ] task 1 reviewer — Stale in-file narration: two comment blocks in `fleet/sandbox-boot.sh` still state the removed #723 gate as the current rule, while the code beneath them now commits on the event window. `:99-101` (the `EVIDENCE_LOCK` block) says the refresher "commits the page at every `engine:phase` it relays (#723)", and `:865` (the `push_evidence` block) opens "ONE COMMIT PER TRANSITION and one per relayed phase (#723)". The contract and the `commit_phase_evidence`/`phase_refresher` comments were updated (M5, and the diff's own new blocks), so these two are the only places left in this task's own FILES that describe the gate the patch deleted — in a script whose comments are how the rule is carried. Nothing about behaviour
- [ ] task 1 reviewer — fix is wording.
- [ ] task 1 reviewer — `fleet/CONTRACT.md`'s new `**status.json:**` prose is imprecise about the two new cells, in the one document a reader trusts for the page's shape. (1) The sub-phase sentence reads "the run's last phase event alone when no worker is open, and `<phase> · <sub>` … otherwise", but per M2/M3 — and per what the implementation does and exam leg (c) pins — a log with no open worker whose last line sorts after its last phase event still renders `<phase> · <kind>` (leg (c) asserts `sub` is `driver:wave-adopted` for exactly that prefix). The clause that selects the bare phase is "the last phase event is the log's last line", not "no worker is open". (2) The `tasks` literal types two cells as strings that the page emits unquoted: `"wave":"<n or null>"` is a JSON number (the projector writes `"wave":1`) and `"lastProof":"{cmd, exit, ts} or null"` is an object. The house convention quotes placeholders for string cells (`pr`, `merged`, `error`), so quoting these two reads as a type claim. M5's greps and `tests/test_docs_agree_with_code.py` are satisfied either way — this is accuracy, not a failing pin.
- [ ] task 1 reviewer — fleet/sandbox-boot.sh phase_refresher: the window commit now sits OUTSIDE the `if [ -n "$p" ]` branch (lines ~895-911), so on a tick where no `engine:phase` has been relayed yet the refresher commits without having written a page first — `collect_evidence` then snapshots the page left by the last transition (e.g. `engine starting`, whose `tasks` cell is `{}`), and both counters are reset, so the content that earned the commit only reaches the branch a window later. M4 does mandate the commit on that tick, so this is not a clause violation, but it weakens the Claim ("the record ... catches up") in exactly the pre-first-phase stretch where the engine can emit ten events before its first `engine:phase`. Narrow fix: write the page before deciding the commit (or keep the commit in the relay branch), e.g. `[ -n "$p" ] || page="$PHASE"` plus an unconditional `write_status running "$page"` — weigh that against #723 case (g), which asserts a run that relays nothing commits per transition only.
- [ ] task 1 reviewer — fleet/sandbox-boot.sh: each refresher tick parses the log TWICE — `project_read sub "$f" …` at line ~899 and, inside `write_status`, `status_tasks` → `project_read tasks …` at line ~512. The header comment over `project_read` says "THREE MODES, ONE WALK … a second parser for any of them would be a second answer to the same question", but two successive reads of a file the engine is appending to can disagree: one page can carry `phase` = `gate · impl:2` from the earlier read while its `tasks` cell comes from a later one where `impl:2` is already closed. One `project_read all` per tick, with the `tasks` object passed into `write_status` (extra optional arg, defaulting to `status_tasks` for the transition callers), would make one page one answer and halve the python spawns. The exam does not catch this because leg (c) polls until both cells agree.

</details>

Closes #877
