# Task chains start together

**Grammar:** claims-v1

**Claim:** After this run, a task's examiner and implementer start at the same moment and the
peer's exam still grades the patch before any referee reads it, a run that reconciled still
merges under the plan's title, and the shallow-clone check runs beside the critic instead of
ahead of it. (elicited)

**Goal:** Take the three serial links off the task chain that the clock census of runs 7–9
(`docs/superpowers/observations/2026-09-04-clock-census-runs-7-8-9.md`) named: the exam ahead
of the implementer (#653, grilled 2026-09-05 — driver-only handoff, the peer's exam wins at the
Proof path, unconditional, one repair round), the depth-1 leg ahead of the critic (#654,
re-shaped: the leg's own tree sha is the fold's, so a sha-keyed skip would delete the leg; it
overlaps the critic instead), and the reconcile commit's subject (#651). Everything here is
`fleet/run-engine.mjs`, `fleet/run-waves.mjs`, the two role files and the engine sims; the
laptop side, the boot script, the janitor and the contract are byte-identical to BASE — they
are the concurrent plan's.

**Tech Stack:** Node 24 ESM (`fleet/run-engine.mjs`, `fleet/run-waves.mjs`, the sims under
`fleet/tests/`, each printing `ALL TESTS PASSED`), Markdown role files under `fleet/roles/`,
Python 3 (`python3 -m pytest` with `pytest-xdist`). Nothing is added to any dependency file.

**Spec:** #653 (the grilling record of 2026-09-05 is the issue's last comment), #654, #651
(the issues carry the design; there is no separate spec document).

**Parallelization rationale:** One wave, width 3. All three tasks modify
`fleet/run-engine.mjs` in three regions — the per-task exam/implementer dispatch (Task 1), the
depth-1 leg and critic dispatch after the wave loop (Task 2), the reconcile commit inside
`foldWave` (Task 3) — text that folds. No task consumes a sibling's symbol, so no edge is
derived and no task waits. Each task's exam is a new sim file, so no two examiners write one
file.

## Global Constraints

- The vendored kernel is byte-identical to BASE: `skills/ultrapowers/kernel/vendor/manyana.py`
  is sha-pinned on purpose and never patched.
- Check: test "$(git hash-object skills/ultrapowers/kernel/vendor/manyana.py)" = 0e0367d23d19cdf87a047bd7f5cd814698f75fc4
- The laptop side, the sandbox boot, the janitor, the lobby, the contract and the compiler are
  byte-identical to BASE — a concurrent run owns them.
- Check: test "$(git hash-object fleet/launch.mjs)" = 61d0e7ae4ffaba2103fa2fd507438871785f17e0
- Check: test "$(git hash-object fleet/sandbox-boot.sh)" = 6be6ef327f12bc4244d6850b58b1f9bac4b21b84
- Check: test "$(git hash-object fleet/run-main.mjs)" = d0a320f3937671db9ce480b450602d8f52d88080
- Check: test "$(git hash-object fleet/janitor.mjs)" = e084e38b4247d028292e18bc7bb94a266c8e0fc3
- Check: test "$(git hash-object fleet/lobby.mjs)" = 8239e763c7757adb48c99fbcd8359f7a19b29f8f
- Check: test "$(git hash-object fleet/CONTRACT.md)" = 2962f5f03177da6347519ea7472bd4aa00af5bb4
- Check: test "$(git hash-object skills/ultrapowers/scripts/compile_plan.py)" = 65ccf30820183187f373a82e7694e4b40842dc87
- The four operator documents still agree with the code.
- Check: python3 -m pytest -q -p no:cacheprovider tests/test_docs_agree_with_code.py
- The examiner's role text and the reviewer's are unchanged; no shouted imperative (an
  all-caps must, never or always as a whole word) is added to any file under `fleet/roles/`.
- Check: test "$(git hash-object fleet/roles/examiner.md)" = 3a8c8acf9e60d1a868db0bbfcc2226d42566bbf4
- Check: test "$(git hash-object fleet/roles/reviewer.md)" = 5e35f6d2569e5e8de68c0617156b91de2e669420
- No file outside a task's own Files block is edited.

**Acceptance:** suite — the committed suite is the verification.

### Task 1: The examiner and the implementer start together

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/run-engine.mjs`
- Modify: `fleet/run-waves.mjs`
- Modify: `fleet/roles/implementer.md`
- Modify: `fleet/roles/fix.md`
- Modify: `fleet/tests/test_run_engine_examiner.mjs`
- Modify: `fleet/tests/test_run_engine_exam_edits.mjs`
- Modify: `fleet/tests/test_exam_edited_patches.mjs`
- Modify: `fleet/tests/test_run_engine_exam_evidence.mjs`
- Test: `fleet/tests/test_run_engine_exam_together.mjs`

**Claim:** A task's examiner and implementer start at the same moment and the peer's exam
still grades the patch before any referee reads it. (derived)
Machine: M1. For a task whose Proof names `Test:` paths and whose test command is set, the
driver dispatches `exam:<id>` and `impl:<id>` together, awaiting neither before the other: the
examiner runs in `<clonesDir>/exam-<id>`, a clone whose HEAD is the wave base and in which
the bootstrap command, when one is set, has run before the examiner is dispatched, the
implementer in `<clonesDir>/task-<id>`; the
examiner's prompt is `examiner.md` followed by the implementer's own inputs byte for byte, as
at BASE; and the examiner's capture is written to `<patchesDir>/exam-<id>.patch`, never to
`task-<id>.patch`. M2. The wave-0 verdict is decided in the examiner's clone as at BASE: `exam`
is `red`, or `green-at-base` with the judgment call `exam is green at BASE — it establishes
nothing`. M3. When both have
returned and the examiner is `DONE`, the driver copies every Proof `Test:` path the examiner
wrote over the same path in the implementer's clone, re-captures the implementer's patch so
its hunks carry the examiner's bytes, and appends one event `driver:exam-handoff` carrying
`task` and `paths` (the copied paths) before the task's first `driver:exam-run`; a red exam at
the pre-review pass still buys the one repair round, as at BASE. M4. `examEdited` is judged
against the handed-in blobs only after the handoff: an implementer that wrote its own file at
a Proof `Test:` path yields `examEdited: []` and no judgment call naming that path, while a
fix round that changes the path yields `examEdited: [<path>]` and the `EXAM EDITED: <path>`
line in the reviewer's prompt, as at BASE. M5. An examiner that returns `BLOCKED`, and one
that returns no reply at all, each leave the task unexamined: `exam` is `blocked`, no `driver:exam-handoff` and no
`driver:exam-run` event is appended for the task, and the implementer's own file at the Proof
path is what is reviewed and folded. M6. `fleet/run-waves.mjs`'s `makeCwdFor` answers
`<clonesDir>/exam-<id>` for an `exam:<id>` label and `<clonesDir>/task-<id>` for `impl:<id>`
and `fix:<id>:<n>`; `fleet/roles/implementer.md` no longer contains `already in your tree` nor
`write those tests exactly as given` and contains `reserved for a peer's exam`; and
`fleet/roles/fix.md` contains `not yours to reshape`.

**Authorized-by:** #653 (grilled 2026-09-05: "Driver-only handoff … The peer's exam wins at
the Proof path … Unconditional … One repair round, as today"); #551 (peer review's rule that
the exam is written by a peer, never the submitter).

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** At BASE the examiner and the implementer share one clone: `fleet/run-engine.mjs`
(line ~788 onward) sets `cloneDir = path.join(clonesDir, 'task-' + task.id)`, dispatches
`agent(roles.examiner + '\nBASE: ' + baseShaForTask + commonInputs, { label: 'exam:' +
task.id, isolation: 'worktree', model: baseModel, schema: EXAMINER_SCHEMA })`, reads the
blobs with `blobShaOf` (`git hash-object` in `cloneDir`), runs `sh(examTestCmd, cloneDir)`
for red-at-BASE, and only then dispatches `impl:<id>` into the same directory, followed by
`await noteDrift('the implementer')`. The label-to-directory map is `makeCwdFor` in
`fleet/run-waves.mjs` (`isolation: 'worktree'` → `task-<id>` for every label
`defaultTaskIdOf` reads, which is `exam|impl|fix`), and `withPatchCapture` writes every
worktree label's diff to `<patchesDir>/task-<id>.patch` via `patchAgainstBase({ cwd, base,
out, git })` (exported) and sets `reply.headSha` from the clone's HEAD. `cloneAtBase({ repo,
dest, base })` is exported from `run-waves.mjs`; the engine holds `paths.repoDir` and the
per-wave base (`baseShaForTask`), so it can cut `exam-<id>` at dispatch time — `run-main.mjs`'s
`provisionRunTree` cuts only `integration` and `task-<id>` and is not changed. The bootstrap
loop at line ~704 runs `bootstrapCmd` in every task clone; the exam clone wants the same
treatment before its red-at-BASE run. The engine has a `parallel` seam (`args`-level, used at
line ~1646 for wave chunks) and plain `Promise.all` both work for the pair. After the pair
returns: copy the examiner's files (only paths whose recorded blob is not null — a path the
examiner declined to write is left as the implementer left it), then re-capture with
`patchAgainstBase({ cwd: cloneDir, base: baseShaForTask, out: <patchesDir>/task-<id>.patch })`
and refresh `impl.headSha` from the clone, so `hasCoordinates(impl)` and the fold see the
handed-in tree. The pre-review pass, `runExam`, `noteDrift('the fix round')`, the review rounds
and the `examEdited` field are unchanged from BASE. Deletion owed: `noteDrift('the
implementer')`, the `exam.cwd === task-<id>` and `['exam:T1', 'impl:T1', …]` label-order pins
in `test_run_engine_examiner.mjs` leg (a), case (d) "the implementer rewrites the exam it was
handed" in `test_run_engine_exam_edits.mjs`, case (b) "the first implementer edits the exam"
in `test_exam_edited_patches.mjs`, and the six-entry order pin in
`test_run_engine_exam_evidence.mjs` leg (a) (the exam's own `exam-run` line now lands between
`impl:T1` and the two post-patch runs, and the two `driver:exam-run` events are unchanged) —
each becomes its new-shape counterpart, never a deleted assertion of something still true. The
implementer's role sentence at `fleet/roles/implementer.md` line ~30 (`A Proof \`Test:\` file
already in your tree when you start is a peer's exam …`) and the step-2 parenthetical (`write
those tests exactly as given; the Proof is the contract you are graded by, not yours to
reshape`) are what M6 removes; the replacement tells the implementer the Proof `Test:` path is
reserved for a peer's exam that arrives after it finishes, so it does not write there; the
"not yours to reshape" sentence moves to `fleet/roles/fix.md`, which at BASE says nothing about
the exam. The sims build a run with `rig({ repo, runDir, waves, stub, testCmd })` from
`fleet/tests/_engine_helpers.mjs`, whose `stub(prompt, opts, cwd)` receives the directory the
real `makeCwdFor` answers — so an exam stub that writes into its `cwd` writes into the new
clone with no change to the helper — and `provision` there cuts only `task-<id>`, which is why
the engine must cut `exam-<id>` itself. A stub that returns a Promise resolved on a later tick
is how leg (a) observes that the implementer was dispatched before the examiner replied.
**BASE facts:** (generated at af1e7c7)
- `exam` at `fleet/run-engine.mjs:820` blob b90f2f3
- `task` at `fleet/run-engine.mjs:1666` blob b90f2f3
- `examEdited` at `fleet/run-engine.mjs:869` blob b90f2f3
- `blocked` at `fleet/run-engine.mjs:1330` blob b90f2f3
- `fleet/run-waves.mjs` blob 5283c07
- `makeCwdFor` at `fleet/run-waves.mjs:101` blob 5283c07
- `fleet/roles/implementer.md` blob 788b530
- `fleet/roles/fix.md` blob ace8caf
- `fleet/run-engine.mjs` blob b90f2f3
- `blobShaOf` at `fleet/run-engine.mjs:816` blob b90f2f3
- `cloneDir` at `fleet/run-engine.mjs:800` blob b90f2f3
- `defaultTaskIdOf` at `fleet/run-waves.mjs:123` blob 5283c07
- `withPatchCapture` at `fleet/run-waves.mjs:181` blob 5283c07
- `provisionRunTree` at `fleet/run-main.mjs:262` blob d0a320f
- `integration` at `fleet/run-waves.mjs:102` blob 5283c07
- `bootstrapCmd` at `fleet/run-engine.mjs:588` blob b90f2f3
- `args` at `fleet/tests/test_run_main.mjs:59` blob 8335fb7
- `runExam` at `fleet/run-engine.mjs:952` blob b90f2f3
- `fleet/tests/_engine_helpers.mjs` blob f929b25
- `cwd` at `fleet/confine-hook.mjs:208` blob e0cd408
- `provision` at `fleet/tests/_engine_helpers.mjs:38` blob f929b25
- `proofFixes` at `fleet/run-engine.mjs:908` blob b90f2f3
- `done` at `fleet/run-worker.mjs:713` blob 5e4bff2

**Proof:**
- Test: `fleet/tests/test_run_engine_exam_together.mjs`
- Legs: (a) with an examiner stub whose reply resolves only after the implementer stub has
  been dispatched, the dispatch log reads `exam:T1` then `impl:T1` before the examiner's reply
  arrives, the examiner's `cwd` is `<clonesDir>/exam-T1` and the implementer's is
  `<clonesDir>/task-T1`, `git rev-parse HEAD` in `<clonesDir>/exam-T1` is the rig's `base`,
  with `extraArgs: { bootstrapCmd: 'touch bootstrapped' }` the file `bootstrapped` exists in
  `<clonesDir>/exam-T1` at the moment the examiner stub is called, the exam prompt opens with
  `examiner.md` verbatim and its tail is byte-equal to the implementer prompt's tail,
  `<patchesDir>/exam-T1.patch` exists, and `<patchesDir>/task-T1.patch` contains a hunk for
  `t1_test.sh` [M1]; (b) an exam script that
  is red at BASE yields `exam: 'red'` and no judgment call containing `green at BASE`, and
  one that exits 0 at BASE yields `exam: 'green-at-base'` and that call, in both cases with the
  examiner's file present in `<clonesDir>/exam-T1` [M2]; (c) an implementer stub that writes
  its own `t1_test.sh` (an `exit 0` script) before the handoff: after the run the integration
  branch's `t1_test.sh` is byte-equal to the examiner's script, `events.jsonl` carries exactly
  one `driver:exam-handoff` for `T1` with `paths` equal to `['t1_test.sh']`, placed after the
  `impl:T1` dispatch and before the first `driver:exam-run`, `examEdited` is `[]`, and no
  judgment call names `t1_test.sh` [M3] [M4]; (d) an implementer that leaves the exam red on
  the handed-in tree buys exactly one `fix:T1:0` dispatch (`proofFixes` 1), and when that fix
  stub rewrites `t1_test.sh` the row's `examEdited` is `['t1_test.sh']` and the reviewer's
  prompt contains `EXAM EDITED: t1_test.sh` [M3] [M4]; (e) an examiner stub returning
  `{ status: 'BLOCKED' }`, and separately one returning `null`, each yield `exam: 'blocked'`,
  no `driver:exam-handoff` and no `driver:exam-run` event for `T1`, the implementer's own
  `t1_test.sh` on the integration branch, and a `done` row [M5]; (f) `makeCwdFor({ clonesDir })` answers `<clonesDir>/exam-T1` for `exam:T1` and
  `<clonesDir>/task-T1` for `impl:T1` and `fix:T1:0` once both directories exist [M6]; (g)
  the sim prints `ALL TESTS PASSED`.
- Run: node fleet/tests/test_run_engine_exam_together.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the sim's sentinel [M1] [M2] [M3] [M4] [M5] [M6].
- Run: node fleet/tests/test_run_engine_examiner.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the wave-0 examiner sim, its clone and order pins moved to the new
  shape [M1] [M2].
- Run: node fleet/tests/test_run_engine_exam_edits.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the recorded-edit sim, its implementer-edit case moved to the new
  shape [M4].
- Run: node fleet/tests/test_exam_edited_patches.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the patched-review sim, its first-implementer case moved to the new
  shape [M4].
- Run: node fleet/tests/test_run_engine_exam_evidence.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the exam-evidence sim, its order pin moved to the new shape [M3].
- Run: node fleet/tests/test_run_engine_exam_fix_edit.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the fix-round edit sim, unchanged: the fix round still runs in the
  task clone after the handoff [M4].
- Run: node fleet/tests/test_run_engine_pre_review.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the pre-review pass sim, unchanged [M3].
- Run: node fleet/tests/test_run_waves.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the clone and capture sim [M6].
- Run: ! grep -q 'already in your tree' fleet/roles/implementer.md
- The previous bullet is the first removed sentence [M6].
- Run: ! grep -q 'write those tests exactly as given' fleet/roles/implementer.md
- The previous bullet is the removed step-2 instruction [M6].
- Run: grep -q "reserved for a peer's exam" fleet/roles/implementer.md
- The previous bullet is the replacement sentence [M6].
- Run: grep -q 'not yours to reshape' fleet/roles/fix.md
- The previous bullet is the sentence that moved to the fix role [M6].

**Stale-if:**
- path-absent: `fleet/run-waves.mjs`
- path-absent: `fleet/tests/_engine_helpers.mjs`
- path-absent: `fleet/roles/fix.md`
- issue-closed: #653

### Task 2: The depth-1 leg runs beside the critic

**Type:** implementation

**Files:**
- Modify: `fleet/run-engine.mjs`
- Test: `fleet/tests/test_run_engine_depth1_beside_critic.mjs`

**Claim:** The shallow-clone check runs beside the critic instead of ahead of it. (derived)
Machine: M1. When a wave merged and its suite passed, the depth-1 leg and the completeness
critic are started together and both awaited: the critic's dispatch (label `integration`)
begins while the depth-1 suite is still running. M2. What each produces is as at BASE: a
history-coupled suite yields `shallowSuite.passed === false` and one `deferredVerification`
item whose `deliverable` begins `depth-1 clone of ` with `reason: 'manual'`; a green suite
yields `shallowSuite.passed === true` and no such item; in both the critic is dispatched
exactly once and its findings are in the report. M3. With `shallowLeg: false`,
`shallowSuite` is `null`, no depth-1 clone is made and the critic is dispatched once; when no
wave merged, `shallowSuite` is `null`, no depth-1 clone is made, the critic is not dispatched,
and the report carries the `no wave merged` finding, as at BASE.

**Authorized-by:** #654 (re-shaped on the operator's call 2026-09-05: "Overlap it with the
critic" — the leg's tree sha is the fold's, so the ticket's sha-keyed skip would delete the
leg; the 1.5 min is taken by concurrency instead).

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** At BASE the two are serial in `fleet/run-engine.mjs`: `phase('Depth-1 Leg')`
(line ~1819) clones `integrationBranch` at depth 1 from `file://<integ>` into
`<clonesDir>/shallow`, bootstraps it, runs `sh(testCmd, shallowDir)` and sets `shallowSuite`
and `shallowDeferred`; then `phase('Integration Review')` (line ~1863) dispatches the critic
with `agent(roles.critic + … , { label: 'integration', model: REVIEWER_MODEL, schema:
CRITIC_SCHEMA })`. Neither reads the other's result: the critic's inputs are `lastSuite`, the
plan, the contracts, the integrated Run:/Check: evidence; `shallowDeferred` is concatenated
into `deferredVerification` afterwards (line ~1977) and `shallowSuite` is a report field (line
~2036). The change is to wrap the leg in a function, start it and the critic's dispatch
together (`Promise.all` or the engine's `parallel` seam), and await both before the code that
reads either — the `criticRan` flag, the try/catch around the critic and the no-merge branch
stay as they are. The sim rig (`rig({ repo, runDir, waves, stub, testCmd, extraArgs })` in
`fleet/tests/_engine_helpers.mjs`) leaves `phase` a no-op, so the overlap is observed from the
suite command and the critic stub, not from phase events: a `check.sh` that, when `git
rev-parse --is-shallow-repository` prints `true`, appends `shallow-start` to an order file,
sleeps half a second and appends `shallow-end`, and a critic stub that appends `critic` at
dispatch — the leg is on the path exactly when `critic` lands between the two. The existing
`fleet/tests/test_run_engine_shallow.mjs` shows the history-coupled oracle (`[ "$(git rev-list
--count HEAD)" -gt 1 ]`), `twoCommitRepo`, and the `extraArgs: { shallowLeg: false }` knob.
**BASE facts:** (generated at af1e7c7)
- `integration` at `fleet/run-waves.mjs:102` blob 5283c07
- `deferredVerification` at `fleet/run-engine.mjs:1975` blob b90f2f3
- `shallowSuite` at `fleet/run-engine.mjs:1815` blob b90f2f3
- `fleet/run-engine.mjs` blob b90f2f3
- `integrationBranch` at `fleet/run-engine.mjs:557` blob b90f2f3
- `shallowDeferred` at `fleet/run-engine.mjs:1816` blob b90f2f3
- `criticRan` at `fleet/run-engine.mjs:1870` blob b90f2f3
- `fleet/tests/_engine_helpers.mjs` blob f929b25
- `critic` at `fleet/run-main.mjs:641` blob d0a320f
- `fleet/tests/test_run_engine_shallow.mjs` blob bc1cd56
- `reason` at `fleet/run-engine.mjs:1433` blob b90f2f3
- `manual` at `fleet/tests/test_run_engine_shallow.mjs:64` blob bc1cd56

**Proof:**
- Test: `fleet/tests/test_run_engine_depth1_beside_critic.mjs`
- Legs: (a) with a suite script that writes `shallow-start`, sleeps half a second and writes
  `shallow-end` to an order file only in a shallow repository, and a critic stub that writes
  `critic` to the same file when dispatched, the order file reads exactly `shallow-start`,
  `critic`, `shallow-end` after a one-task run whose full-clone suite is green [M1]; (b) a
  history-coupled suite (green on a two-commit full clone, red at depth 1) yields
  `report.shallowSuite.passed === false` and one `deferredVerification` item whose
  `deliverable` starts with `depth-1 clone of ` and whose `reason` is `manual`, and a plain
  green suite yields `passed === true` and no item whose deliverable starts that way; in both
  the `integration` label is dispatched exactly once and a critic finding returned by the stub
  appears in `report.review.findings` [M2]; (c) `extraArgs: { shallowLeg: false }` yields
  `report.shallowSuite === null`, no `<clonesDir>/shallow` directory, and the `integration`
  label dispatched exactly once, and a run whose only implementer returns `BLOCKED` (so no
  wave merges) yields `report.shallowSuite === null`, no `<clonesDir>/shallow` directory, no
  `integration` dispatch, and a `report.review.findings` entry whose `detail` contains `no
  wave merged` [M3]; (d) the sim prints `ALL TESTS PASSED`.
- Run: node fleet/tests/test_run_engine_depth1_beside_critic.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the sim's sentinel [M1] [M2] [M3].
- Run: node fleet/tests/test_run_engine_shallow.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the existing depth-1 sim, whose pins on the leg's output hold with
  the critic beside it [M2] [M3].

**Stale-if:**
- path-absent: `fleet/tests/test_run_engine_shallow.mjs`
- path-absent: `fleet/tests/_engine_helpers.mjs`
- issue-closed: #654

### Task 3: A reconciled wave keeps the plan's title

**Type:** implementation

**Files:**
- Modify: `fleet/run-engine.mjs`
- Test: `fleet/tests/test_run_engine_reconcile_subject.mjs`

**Claim:** the reconcile commit takes the same subject the materialize candidate did (the
plan's H1), with `wave <N> reconcile (attempt <k>)` in the body (quoted from #651)
Machine: M1. When a wave's candidate suite is red and a reconcile round greens it, the commit
the driver makes has subject (`git log -1 --format=%s`) equal to the plan's title when
`planPath` yields one, and body (`%b`) equal to `wave <N> reconcile (attempt <k>)`. M2. With
no plan title the whole message (`%B`, trimmed) is `wave <N> reconcile (attempt <k>)`, as at
BASE. M3. The integration branch head after a reconciled wave 1 under a plan titled `Widget
plan` has subject `Widget plan`, so a squash-merge of that head takes the plan's title.

**Authorized-by:** #651.

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** The commit is `await git(['commit', '-q', '-m', 'wave ' + waveNumber + '
reconcile (attempt ' + attempt + ')'], integ)` inside `foldWave` in `fleet/run-engine.mjs`
(line ~1546), after the reconcile agent edited the tree and before `suite = await sh(testCmd,
integ)`. The plan's title is already in scope as `planTitle` (read once at engine start, line
~608, from the first line of `planPath` beginning `# `; `undefined` when there is none) and is
what `materialize` receives as `--subject` (line ~1486). `git commit -m <a> -m <b>` joins its
values as paragraphs, so `['commit', '-q', '-m', planTitle, '-m', 'wave … reconcile (attempt
…)']` yields subject and body; with no title the single `-m` stays. The reconcile sim
`fleet/tests/test_run_engine_reconcile.mjs` shows the shape: an implementer stub that writes
`BROKEN` beside its work, a `check.sh` that fails on it, a `reconcile` stub that removes it,
and a git log read of the integration clone afterwards; the fold-subject sim
`fleet/tests/test_run_engine_fold_subject.mjs` shows how a plan file is passed (`extraArgs: {
planPath }`, a file whose first line is `# Widget plan`) and how `%s`, `%b` and `%B` are read
off the head.
**BASE facts:** (generated at af1e7c7)
- `planPath` at `fleet/launch.mjs:229` blob 61d0e7a
- `materialize` at `skills/ultrapowers/kernel/repo_weave.py:521` blob c9856c0
- `fleet/tests/test_run_engine_reconcile.mjs` blob 3e78472
- `fleet/tests/test_run_engine_fold_subject.mjs` blob 8a38a1b

**Proof:**
- Test: `fleet/tests/test_run_engine_reconcile_subject.mjs`
- Legs: (a) a one-task wave whose implementer plants `BROKEN`, whose suite fails on it and
  whose reconcile stub removes it, run with a plan file whose first line is `# Widget plan`,
  ends `MERGED` with the integration branch head's `%s` equal to `Widget plan` and `%b`
  (trimmed) equal to `wave 1 reconcile (attempt 1)` [M1] [M3]; (b) the same run with no
  `planPath` ends with the head's `%B` (trimmed) equal to `wave 1 reconcile (attempt 1)` [M2];
  (c) the sim prints `ALL TESTS PASSED`.
- Run: node fleet/tests/test_run_engine_reconcile_subject.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the sim's sentinel [M1] [M2] [M3].
- Run: node fleet/tests/test_run_engine_reconcile.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the existing reconcile sim, unchanged [M2].
- Run: node fleet/tests/test_run_engine_fold_subject.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the existing fold-subject sim, unchanged [M3].

**Stale-if:**
- path-absent: `fleet/tests/test_run_engine_reconcile.mjs`
- path-absent: `fleet/tests/test_run_engine_fold_subject.mjs`
- issue-closed: #651
