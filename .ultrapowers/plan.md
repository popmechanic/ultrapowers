# Gate at the task, sense at the fold — integrated proofs re-run only where the fold joined

**Grammar:** claims-v1

**Claim:** The integrated pass re-runs a task's `Run:` lines only when one of that task's Files appears in the fold's joined paths (quoted from #887)

**Summary:** After every wave, the engine today re-runs every merged task's proofs a third time on the joined tree, and a red there blocks the run. This change re-runs a task's proofs on the joined tree only when the fold actually joined one of that task's files with another task's, and reports a red there by naming the two tasks and the file instead of blocking. Runs get shorter by the minutes those repeated proofs cost, and a red on the fold reads as a fact about the join, which is what it is.

**Goal:** #887 (map #870, the one rule): the integrated pass re-runs a task's `Run:` lines only when the fold joined one of its files; a red there is reported with the pair named, never gated; `Check:` lines and the suite run on the integrated tree as today; a single-task wave re-runs nothing.

**Tech Stack:** Node 24 ESM (`fleet/run-engine.mjs`, `fleet/tests/*.mjs` sims)

**Spec:** issue #887 (its reading table of runs 76–85 and the run-78 example); every fact a worker needs is in the task's Context.

**Parallelization rationale:** one task. No wave shape to state; no chain.

**Launch base:** any main at or after run-88's merge; folds with the engine plan (which edits the same file in other functions) if both are in flight.

## Global Constraints

- No cache, no hashing, no compiler change: the joined set is computed from what the wave's tasks changed, every wave, in the engine.
- Check: node --check fleet/run-engine.mjs

**Acceptance:** suite — the committed suite is the verification.

### Task 1: The integrated pass re-runs only the joined tasks' proofs, and reports a red instead of blocking

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/run-engine.mjs`
- Modify: `fleet/tests/test_run_engine_integrated_runs.mjs`
- Modify: `fleet/tests/test_run_engine_integrated_clean.mjs`
- Modify: `fleet/tests/test_run_engine_state_exams.mjs`
- Modify: `fleet/tests/test_run_engine_proof_runs.mjs`
- Modify: `skills/ultrapowers/references/report-format.md`
- Modify: `fleet/roles/critic.md`
- Test: `fleet/tests/test_run_engine_joined_proofs.mjs`

**Claim:** The integrated pass re-runs a task's `Run:` lines only when one of that task's Files appears in the fold's joined paths (quoted from #887)
Machine: M1. After a wave is adopted, the engine computes `joined` = every path that appears in the touch set of at least two of the wave's merged tasks, where a task's touch set is its declared `files` united with the paths its captured patch changes (the `diff --git a/<p> b/<p>` headers), and records it as `waveMerges[w].joined` (an array, `[]` when none). M2. A merged task's `proofRuns` are executed on the integrated tree if and only if its touch set intersects `joined`; a single-task wave and a wave whose tasks' touch sets are pairwise disjoint execute none, and `report.integratedRuns` and the `driver:integrated-run` events carry exactly the executed commands. M3. Each `driver:integrated-run` event and each `integratedRuns` item carries `joined` (the paths of the task's touch set that are in `joined`) and `with` (the ids of the other tasks whose touch sets share them, in plan order). M4. A non-zero integrated `Run:` exit pushes no blocking finding and does not block the run: the run's report has no completeness finding whose detail begins `integrated Run:`, and `judgmentCalls` carries one line `task <id>'s proof <cmd> went red on the fold of <path> with task <other>` (paths and other ids comma-joined when several). M5. `Check:` commands still run on the integrated tree for every adopted wave with the blocking behaviour they have today, and the per-task pre-review `Run:` pass is unchanged. M6. `skills/ultrapowers/references/report-format.md`'s `integratedRuns` row and `fleet/roles/critic.md`'s INTEGRATED RUN EVIDENCE paragraph say a red integrated run is reported with the pair named and is not a blocking finding.

**Authorized-by:** #887; #871 decision 1 (an unattributed red is reported, not gated)

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** The integrated pass is the block in `run-engine.mjs` headed `the integrated Run: proofs (#604 (b)+(c))`, inside the wave loop after adoption: it iterates `waveTasks` (the wave's mergeable rows in plan order), runs each `proofRuns` command with `sh(cmd, integ, examEnv({ base: baseSha, task, pass: 'integrated' }))`, pushes `{ task, cmd, exit, stdout }` to `integratedRuns`, appends `driver:integrated-run` `{ task, cmd, exit, wave }`, and on a non-zero exit pushes `{ severity: 'blocking', detail: 'integrated Run: <cmd> (task <id>) exited <n> on the adopted tree' }` to `integratedFindings` plus a judgment call; `integratedFindings` is concatenated into `review.findings` before the report is built, which is what parks the run. The `Check:` loop that follows (`constraintChecks`, `driver:integrated-check`, blocking unless `minor`) is untouched. A task's captured patch is `impl.patch` on its result row (a unified diff against the task's base, produced by `patchAgainstBase` in `run-waves.mjs`); its changed paths are the `b/<path>` halves of the `diff --git a/<p> b/<p>` header lines (a deleted file still has that header). The wave's merged rows are the `results` the barrier folded (`isMergeable`), so the touch sets and `joined` are computable right where `waveTasks` is built, with no kernel read. Record `joined` on the `waveMerges` row that the adoption pushes. The judgment-call sentence is the ticket's, with the fold's file and the other task named: `task 3's proof <cmd> went red on the fold of <file> with task 2`. The critic still receives `integratedRunEvidenceBlock(integratedRuns)` (roles/critic.md says it is authoritative for the commands it lists — keep that sentence, add that a red there is a finding of the join, reported, not a block). Sims at BASE that pin the old rule, all fixtures whose tasks own disjoint files (`A → a.txt`, `B → b.txt`): `test_run_engine_integrated_runs.mjs` (leg (a) expects 3 integrated runs from two disjoint tasks; leg (c) expects a blocking finding on a red) — rewrite its fixture so both tasks' implementer stubs also write `shared.txt` (the touch sets then join on it) and turn leg (c) into the reported-not-blocked shape; `test_run_engine_integrated_clean.mjs` (M1 `driver:integrated-clean` before the first integrated run — needs a joined fixture to have a first integrated run; make its A and B both write `shared.txt`); `test_run_engine_state_exams.mjs` leg (d) (`M2`: the integrated `Run:` receives `ULTRA_EXAM_PASS=integrated` — its fixture is a single task T1, which now re-runs nothing; give it a second task whose stub writes T1's `out.txt` too, so T1 is joined and the leg holds); `test_run_engine_proof_runs.mjs` (the order pin `['impl:T1', 'proof-run', 'review:T1:1', 'proof-run']` counts the integrated execution of a single-task wave — the trailing `proof-run` goes, with the comment above it rewritten to say the integrated pass is #887's and pinned in its own sim). `test_run_main.mjs` uses `integratedRuns` only in fixture reports for ack decisions — untouched. `report-format.md` row `integratedRuns` (the sentence "A non-zero `exit` is a blocking completeness finding") — rewrite to the reported shape and add the `joined`/`with` fields. The ticket's pre-registered reading on #872: integrated proof runs per run 89 → ~0–5.

**Proof:**
- Test: `fleet/tests/test_run_engine_joined_proofs.mjs`
- Guard: `fleet/tests/test_run_engine_joined_proofs.mjs`
- Legs (the driver runs the `Test:` sim as this task's exam command; the `Run:` lines are the four rewritten sibling sims): (a) a two-task wave whose implementer stubs both write `shared.txt` (A also `a.txt`, B also `b.txt`) records `waveMerges[0].joined` equal to `['shared.txt']`; a two-task wave writing only `a.txt` and `b.txt` records `[]`; and a wave where A's declared `files` lists `shared.txt` while A's stub writes only `a.txt` and B's stub writes `shared.txt` records `['shared.txt']` too — a `joined` computed from patches alone leaves it `[]` and fails [M1]; (b) in the joined wave, with A carrying two `proofRuns` and B one, `integratedRuns` has exactly three items and three `driver:integrated-run` events, in plan order; in the disjoint wave and in a single-task wave with one `proofRuns`, both are empty and no `driver:integrated-run` event exists; and in a three-task wave where only A and B share `shared.txt` while C writes `c.txt`, C's proof is not executed on the integrated tree while A's and B's are [M2]; (c) each of the joined wave's items and events carries `joined` `['shared.txt']` and `with` `['B']` for A's and `['A']` for B's [M3]; (d) with B's proof `test ! -e shared.txt` (green in B's own clone before the fold is impossible, so use a proof green in the clone and red on the fold: A writes `marker` into `shared.txt` and B's proof is `! grep -q marker shared.txt`), the run's report has zero completeness findings whose detail begins `integrated Run:`, `report.verdict`-equivalent status is not blocked by it (the run reaches the critic and `blockedWaves` is `[]`), and `judgmentCalls` carries exactly one line equal to `task B's proof ! grep -q marker shared.txt went red on the fold of shared.txt with task A` [M4]; (e) in a separate run from leg (d), a Global Constraints `Check:` that exits 1 on the integrated tree yields exactly one blocking finding beginning `integrated Check:`, and in the joined wave of leg (b) the pre-review `driver:proof-run` events per task are one per `proofRuns` command and each precedes that task's first `review:` `worker:start` [M5]; (f) the `integratedRuns` row of `skills/ultrapowers/references/report-format.md` (the table line beginning `| `integratedRuns` |`) contains none of `blocking completeness finding`, and contains each of `joined`, `with`, `reported`, `pair` and `not a blocking`; the INTEGRATED RUN EVIDENCE paragraph of `fleet/roles/critic.md` contains `reported` and `not a blocking`; each missing or surviving literal named [M6].
- Run: node fleet/tests/test_run_engine_integrated_runs.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_run_engine_integrated_clean.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_run_engine_state_exams.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_run_engine_proof_runs.mjs | grep -q 'ALL TESTS PASSED'

**Stale-if:**
- path-absent: `fleet/tests/test_run_engine_integrated_runs.mjs`
- path-absent: `fleet/tests/_engine_helpers.mjs`
