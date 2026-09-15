This replaces the engine's wave barrier with a ready set: the driver keeps its slots full with whatever task's dependencies are already folded in, and folds whatever has landed whenever a slot frees. It exists because the barrier-slack reading on runs 91 to 115 found a finished task waits a quarter of an hour, on the median, for its wave to close. After this run a plan's clock is its longest dependency chain, not its widest wave, and a worker that finds its proof needs a sibling still in flight waits for that sibling instead of failing the run.

**Merge-ready**

> When I run a plan, a task starts the moment everything it depends on has been folded in, and never waits for the rest of its wave.

| task | claim | exam | probes | mutant | suite |
|---|---|---|---|---|---|
| 1 | When I run a plan, a task starts the moment everything it depends on has been folded in, and never waits for the rest of its wave. | red at BASE → green | — | — | — |
| 2 | A task whose proof needs a sibling still in flight waits for that sibling and then runs, instead of failing the run. | red at BASE → green | — | — | — |

Residuals: 23 from review

<details><summary>Record</summary>

## fleet run-133 — gate-green

| | |
|---|---|
| verdict | `PASS` |
| target | `popmechanic/ultrapowers` at `2fd301cd6591aef62abdc43df744ca3426543557` |
| engine | `2fd301cd6591aef62abdc43df744ca3426543557` |
| plan | `.ultrapowers/plan.md` at `c8b9bd41884411e56a03f7d20a7b9884a93af06c` |
| branch | `ultra/integration-run-133` |
| vm | `fleet-r133-2609150220-63f0` |

### Checks

```json
{"mode": "gate", "stamp": "run-133", "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-133/report.json", "branch": "ultra/integration-run-133", "gateCheck": {"verdict": "PASS", "checks": [{"name": "report-parse", "ok": true, "detail": ""}, {"name": "clean-tree", "ok": true, "detail": ""}, {"name": "wave-merges", "ok": true, "detail": ""}, {"name": "head-match", "ok": true, "detail": ""}, {"name": "git-verified", "ok": true, "detail": ""}, {"name": "ancestry", "ok": true, "detail": ""}, {"name": "deliverables", "ok": true, "detail": ""}], "notes": [], "repo": "/home/exedev/target"}, "gateCheckExit": 0, "suite": {"passed": true, "unattributed": [], "output": "============================= test session starts ==============================\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\nrootdir: /home/exedev/target/.claude/ultrapowers/run-run-133/clones/integration\nconfigfile: pytest.ini\ntestpaths: tests\nplugins: xdist-3.4.0\ncreated: 3/3 workers\n3 workers [151 items]\n\n........................................................................ [ 47%]\n........................................................................ [ 95%]\n.......                                                                  [100%]\n============================= 151 passed in 40.65s =============================\n"}, "verdict": "PASS"}

```

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-133/.ultrapowers/runs/133/

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

https://github.com/popmechanic/ultrapowers/blob/ultra/plan/run-133/.ultrapowers/plan.md

### Residuals

- [ ] task 1 reviewer — Footprint: fleet/tests/test_run_engine_reuse.mjs is modified but is not in this task's FILES block. The edits are legitimate consequences of the epoch model (leg (c) now expects one epoch row because a reused task buys no epoch
- [ ] task 1 reviewer — leg (d) reads waveMerges.flatMap(m => m.branches).sort() across epochs instead of one wave row), and the file is covered by a Run: line whose evidence is exit 0, so this is footprint drift only, not a behavioural concern.
- [ ] task 1 reviewer — unverified: Footprint plus unexecuted evidence — fleet/tests/test_worker_kata_env.mjs is modified (waveMerges.length === 1 relaxed to >= 1, with every row required MERGED and flatMap(branches).sort() === ['T1','T2']) but the file is in neither this task's FILES nor any of this task's Run: lines, so no captured evidence exercises the edited assertion. The relaxation is the right shape for epochs, but nothing in this submission settles that the sim still passes. What would settle it: a Run: of `node fleet/tests/test_worker_kata_env.mjs` showing exit 0.
- [ ] task 1 reviewer — M4 fidelity: the clause says a task parked for infra is retried 'once, when a slot frees'. retryParkedInfra is reached only from the lane's `quiet` branch, which requires inFlight === 0 && foldingLanes === 0 && !epochClaimed && pendingResults.length === 0 — i.e. total quiescence of the whole run, not the first free lane. In a wide run the single retry is therefore deferred to the tail of the run and, with more than one parked task, the retries serialise through one lane, where the BASE barrier retried them in parallel. No retry is lost and leg (e) of the exam still holds (it parks one task with width 2 and sees the second impl:A start after B's adoption), so this is latency/fidelity drift rather than a missing requirement.
- [ ] task 1 reviewer — GLOBAL CONSTRAINT 3 ('the same handling of a red suite') drift: inside foldWave the unattributed-red attribution set widened from the folding wave's tasks (`Array.isArray(WAVES[waveIdx]) ? WAVES[waveIdx] : waveTasks`) to the entire plan (`PLAN.length > 0 ? PLAN : waveTasks`). A red candidate whose failure cannot be attributed to a branch now spreads the reconcile route across every planned task rather than the co-landed ones, which is strictly broader than BASE. It is disclosed in an adjacent comment and no Check: line stands behind the narrower behaviour, and the epoch's own membership (epochTasks) is still what wave-blocked and kataMark name, so the effect is confined to reconcile routing.
- [ ] task 1 reviewer — concern: out-of-FILES: fleet/tests/test_run_engine_reuse.mjs — its `c-two-waves` leg (c) is a Run: proof but is not in FILES. At BASE it asserts two waveMerges rows, the first an empty-branches row for the fully-reused wave. Under epochs a fold IS the epoch, so a reused task (folded at setup) occupies no row: there is exactly one epoch, task 2's. Re-aimed minimally to one MERGED row whose only driver:wave-adopted names ['2'], keeping the leg's real subject — that task 2's clone is cut at the reuse head — untouched.
- [ ] task 1 reviewer — concern: plan-defect: the plan's M2/M3 make an epoch a fold ordinal, which contradicts three sims' standing assumption that an epoch row exists per plan layer (reuse leg (c) above) and that tasks written in one wave row co-land (joined_proofs, proof_runs leg (b)). Resolved rather than parked: the sims now drive co-landing explicitly with a pacer task whose fold is the epoch the other tasks land inside, gated on a sentinel the exec seam writes at the kernel's `fold --wave <n>` call. Every Proof leg is satisfiable
- [ ] task 1 reviewer — this is a disclosure, not a park.
- [ ] task 1 reviewer — concern: out-of-FILES (not taken): skills/ultrapowers/references/report-format.md now carries stale prose — the red-baseline `SKIPPED` cascade and the `SKIPPED` no-mergeable-branches row no longer exist (the ready set records never-ready tasks as `unfinished` instead), and the `endpoints share a wave` binding judgment call is gone with the wave positions. Left byte-identical: it is outside FILES and joined_proofs leg (f) pins one of its rows.
- [ ] task 1 reviewer — concern: Design note, disclosed because it is observable: the epoch snapshot is taken when the fold lock is acquired (before the first fold awaits the baseline), so a result landing during a fold belongs to the next epoch. Two tasks therefore share an epoch only when both land while a fold is already running — deliberate, so a slow baseline can never sweep a later landing into epoch 1.
- [ ] task 1 reviewer — concern: out-of-FILES: fleet/tests/test_run_engine_reuse.mjs leg (d) — two assertions re-aimed from 'the wave folds both tasks' to 'each task in exactly one epoch, every epoch MERGED'. The file is outside this task's declared FILES but is one of the eight sims the Proof's Run: lines require to pass, and the previous session had already edited it (for its leg (c)). No sibling owns it.
- [ ] task 1 reviewer — concern: out-of-FILES: fleet/tests/test_worker_kata_env.mjs leg (c) — same re-aiming ('the sim folded its one wave' → every epoch adopted and both tasks named across the epochs). It is outside FILES and outside the PROOFS block, but it is in the repo's pytest suite (tests/test_fleet_suite.py) and went red under the corrected epoch semantics. No sibling owns it
- [ ] task 1 reviewer — its stated intent ('a run that never dispatched would pass the counting legs vacuously') is preserved.
- [ ] task 1 reviewer — concern: plan-defect: the task Context and the Machine clause do not say WHICH instant fixes an epoch's membership, and the previous session's reading ('the fold-lock acquisition') is the one the exam rejects. The engine and fleet/CONTRACT.md now state it explicitly: the instant the slot freed, with a landing during a fold going to the next epoch.
- [ ] task 2 reviewer — unverified: M3's production value rests on an endpoint the task's evidence does not cover. `makeKataClient.getIssue` (fleet/kata-client.mjs:225-228) issues `GET <API>/issues/<uid>`, but the Authorized-by measurement cited for `links` is of `GET /projects/<id>/issues/<uid>`. Exam leg (c) drives a stub transport that returns a literal, so it proves the projection copies `links` through — not that the endpoint the client actually calls answers `links` at all. If that path omits them, `blockingSiblingsOf` reads `[]` on every BLOCKED, every sibling-blocked task falls through to the BASE failure, and the whole re-edge loop is a silent no-op in production while the exam stays green. What would settle it: one live `getIssue` against the hub for an issue carrying a `blocks` link (or a `Run:` that curls `<API>/issues/<uid>` and greps for `links`), recorded the way the v0.17.2 measurement was.
- [ ] task 2 reviewer — unverified: nothing in the tree exercises the worker's half of the loop — `kata edit $KATA_REF --blocked-by <ref>`. The exam's fake hub calls `fileBlockedBy(UID.B, UID.A)` directly, i.e. it *assumes* the CLI files the link from the blocker's side (`from` = the sibling, `to` = me). The engine depends on exactly that orientation: `blockingSiblingsOf` skips any link whose `from` is this task's own uid, so a CLI that filed the link from the blocked side would produce zero blockers and the task would fail as at BASE. The `kata` CLI is outside this checkout, and no Run: in the Proof invokes it. What would settle it: run `kata edit <ref> --blocked-by <ref>` once against the hub and read the resulting `links` orientation back, or add the observed shape to the contract beside the `dag_edges` bullet (fleet/CONTRACT.md:182) that already records the launcher's own `blocks` convention.
- [ ] task 2 reviewer — The cycle claim in the new comment block overstates what the cap buys. `fleet/run-engine.mjs`, the re-edge header: "One re-edge per task per sibling, which is what makes a cycle of them impossible." The cap bounds re-edges per pair, but it does not prevent a cycle: if A's worker files `--blocked-by B` and B's files `--blocked-by A` (each once, each lawful), `settleResult` pushes `[B,A]` and `[A,B]` into EDGES, neither task is ever ready again, and both end as `unfinished: never became ready — a task an edge names as its predecessor never landed`. The run terminates and nothing is corrupted, so this is not a merge blocker — but it lands in exactly the state the setup-time cycle detector (fleet/run-engine.mjs:1636-1651, "a cycle is not a weak edge but a deadlock … so the run says so up front rather than leaving them in `unfinished` unexplained") was written to avoid, because a run-time edge never reaches that detector. Suggest either refusing an edge at `blockingSiblingsOf` that would close a cycle over EDGES (treat that BLOCKED as the BASE failure, with a judgmentCall naming the pair), or at minimum pushing a judgmentCall when a re-edged task is later found unready with a re-edge behind it. Failing that, soften the comment to what the cap actually promises: one wait per pair, so no task waits on the same sibling twice.
- [ ] task 2 reviewer — Dead guard on the re-anchor. `fleet/run-engine.mjs`, inside `dispatchOnce`: `if (reEdges.has(task.id) && head === baseSha) await resetTaskClone(task.id, head)`. A re-edged task is only re-dispatched once every sibling its edge names is adopted (isReady, fleet/run-engine.mjs:3471-3479), and an adoption always advances `adoptedHead` off `baseSha` (fleet/run-engine.mjs:3636) — so `head === baseSha` cannot hold on a re-dispatch, and `anchorClone` has already called `resetTaskClone` in every reachable case. Exam leg (d.1)'s `startsB[1].head === adoptedA.headSha` passes with this line deleted, so nothing covers it. Either drop the line or drop the `head === baseSha` conjunct so it is a real belt-and-braces reset (`resetTaskClone` is idempotent and is already called from `anchorClone`).
- [ ] task 2 reviewer — concern: note: fleet/sandbox-boot.sh's status projection reads a `worker:end` whose status is BLOCKED as task state `failed`, so a re-edged task reads `failed` on the page until its second `worker:start` moves it back to `implementing`. That file is byte-frozen by this run's Global Constraints, so it is left as it is
- [ ] task 2 reviewer — the state corrects itself at the re-dispatch.
- [ ] task 2 reviewer — concern: note: the same re-edge is applied to the pre-review fix round's BLOCKED reply as well as the implementer's, because fix.md is taught the same three moves by M2
- [ ] task 2 reviewer — M4's legs only exercise the implementer's branch.
- [ ] task 2 reviewer — concern: note: M4's cap (one re-edge per task per sibling) bounds repeats, not cycles — A re-edging behind B while B re-edges behind A would leave both `never became ready` rather than deadlocking the lanes, which is the existing report line for an unready task.

</details>

Closes #979
