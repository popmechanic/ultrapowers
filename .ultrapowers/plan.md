# ULTRA_BASE in the run

**Grammar:** claims-v1

**Claim:** expose it to `Check:` and `Run:` commands as an environment variable (`ULTRA_BASE`, set by the engine from the wave's base — the task clone's BASE for the per-task pass, the run base for the integrated pass) so `- Check: git diff --quiet $ULTRA_BASE -- fleet/` is writable (elicited)

**Goal:** The engine half of #632 (part 2 — the compiler advisory and the ultrawrite sentence
shipped in `e030775`). A plan cannot know the sha its run starts from, so today a
byte-identity constraint has to be written as a frozen `git hash-object` literal per file.
After this run every `Run:` and `Check:` command the driver executes finds the base sha it
should diff against in `$ULTRA_BASE`: the task's own BASE in its clone, the run's base on the
adopted tree. Everything here is `fleet/run-engine.mjs` and the two existing exam files for
the `Run:` and `Check:` passes.
**Closes:** #632

**Tech Stack:** Node 24 ESM (`fleet/run-engine.mjs`; the sims under `fleet/tests/`, each
printing `ALL TESTS PASSED`, run through `python3 -m pytest tests/test_fleet_suite.py`).
Nothing is added to any dependency file.

**Spec:** #632 (the issue carries the design; there is no separate spec document).

**Parallelization rationale:** One wave, width 1. One task owns the seam and both exam files;
nothing else in the repository is touched.

## Global Constraints

- The driver's other shell runs — the suite, the bootstrap and the exam command — are not
  what changes: only the `Run:` and `Check:` executions gain the variable.
- The vendored kernel is byte-identical to BASE: `skills/ultrapowers/kernel/vendor/manyana.py`
  is sha-pinned on purpose and never patched.
- Check: test "$(git hash-object skills/ultrapowers/kernel/vendor/manyana.py)" = 0e0367d23d19cdf87a047bd7f5cd814698f75fc4
- The clone-and-capture module, the sim helper, the compiler, the contract, the runbook and
  the two skills are byte-identical to BASE — this plan is engine-only.
- Check: test "$(git hash-object fleet/run-waves.mjs)" = 350bb663dcdfa2d7cc90b85cd306e985fe359171
- Check: test "$(git hash-object fleet/tests/_engine_helpers.mjs)" = f929b25244dfd2657c99e4ed236e5ac1d1d30763
- Check: test "$(git hash-object fleet/CONTRACT.md)" = a91fa2bb3bde04fa34396f6580a11f56e6e4bd8d
- Check: test "$(git hash-object fleet/RUNBOOK.md)" = 7a45c72253c10632d1c914230df166b7d0934d70
- Check: test "$(git hash-object skills/ultrapowers/scripts/compile_plan.py)" = b546e04f843c07ea52e7a1e95e62b6f00836afec
- Check: test "$(git hash-object skills/ultrapowers/SKILL.md)" = f286d45f24924654c4f71795903d8277ba9e9035
- Check: test "$(git hash-object skills/ultrawrite/SKILL.md)" = 6a11e64f25dc02540b3d1cbe954e8e585d202d61
- No file outside the task's own Files block is edited.

**Acceptance:** suite — the committed suite is the verification.

### Task 1: The driver hands its Run: and Check: commands the base sha

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/run-engine.mjs`
- Test: `fleet/tests/test_run_engine_proof_runs.mjs`
- Test: `fleet/tests/test_run_engine_pre_review.mjs`

**Claim:** expose it to `Check:` and `Run:` commands as an environment variable (`ULTRA_BASE`, set by the engine from the wave's base — the task clone's BASE for the per-task pass, the run base for the integrated pass) so `- Check: git diff --quiet $ULTRA_BASE -- fleet/` is writable (quoted from #632)
Machine: M1. On the driver's own pass (`iter: 0`) and on every review-round pass, each Proof
`Run:` command executes in the task's clone with `ULTRA_BASE` in its environment equal to
that task's BASE (`baseShaForTask`, a 40-hex sha): a `Run:` of `printenv ULTRA_BASE` — no
dollar sign in the command text, so only the process environment can supply the value —
records that sha in the `RUN EVIDENCE:` block, a `Run:` of `test "$ULTRA_BASE" = <that sha>`
exits 0 at every `iter`, and in wave 2 of a two-wave run the sha is wave 1's adopted head
(`waveMerges[0].headSha`), not the run base. M2. Each Global Constraints
`Check:` command in the per-task pass runs with the same `ULTRA_BASE`: `git diff --quiet
$ULTRA_BASE -- <path>` exits 0 for a tracked path the implementer left alone and non-zero for a
tracked path it edited, as the `driver:check-run` exits and the `CHECK EVIDENCE:` block
record. M3. In the integrated pass on the adopted tree, each merged task's `Run:` and each
`Check:` runs with `ULTRA_BASE` equal to the run base (`baseSha`, the sha the integration
clone was provisioned at), never the adopted head: `echo base=$ULTRA_BASE` recorded under
`report.integratedRuns` and `report.integratedChecks` is the run base in wave 1 and in wave 2
alike, and `git diff --quiet $ULTRA_BASE -- <path>` there exits non-zero for a tracked path the
wave edited and 0 for one it left alone. M4. The header comment of `fleet/run-engine.mjs`,
above its first `import`, names `ULTRA_BASE`. M5. Every existing leg of the two exam files
holds unchanged and each sim prints `ALL TESTS PASSED`.

**Authorized-by:** #632 (part 2, the engine half; part 1 shipped at `e030775`).

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** The seam is `shOf(exec)` at `fleet/run-engine.mjs` line ~462: `(cmd, cwd, env) =>
exec('bash', ['-lc', cmd], { cwd, env, timeoutMs: SHELL_TIMEOUT_MS })`, bound once as `sh =
shOf(exec)` at line ~551. The production `exec` is `execSeam` in `fleet/run-main.mjs` (line
~177), which spawns with `env: env || process.env` — so a passed env replaces the whole
environment and must be `{ ...process.env, ULTRA_BASE: sha }`, never `{ ULTRA_BASE: sha }`
alone. No call site passes an env today. The four that change: the per-task `runCommands`
(line ~1104, `sh(cmd, cloneDir)`) and `runChecks` (line ~1125, `sh(c.cmd, cloneDir)`), both
closures inside `runTaskInner(task, baseShaForTask, …)` (line ~809), whose `baseShaForTask`
is the task's BASE — `baseSha` for wave 1, the prior wave's adopted head after the re-anchor
(`waveBaseSha`, line ~1748); and the integrated loop after adopt — `sh(cmd, integ)` (line
~1917) and `sh(c.cmd, integ)` (line ~1939). For the integrated pass the value is `baseSha`
(line ~739, `git rev-parse HEAD` in the integration clone before wave 1), NOT `waveBaseSha`:
by line ~1917 it has already been advanced to `merge.headSha` (line ~1898), and a diff
against the adopted head is a tautology. In wave 1 the two values coincide; in a later wave
they do not, and the two-wave leg is what pins the difference. The suite runs (lines ~754,
~1669, ~1719, ~2027), the bootstrap runs and the exam runs (`runExam`, line ~1118; the
red-at-BASE run, line ~1025) keep the seam's default env. The header comment is the block
above `import fs` at the top of the file. Neither `fleet/run-waves.mjs` nor
`fleet/tests/_engine_helpers.mjs` needs a change: the sim rig (`rig({ repo, runDir, waves,
stub, stamp, extraArgs })`) passes `extraArgs` straight into `args` (`constraintChecks` and
`shallowLeg: false` ride there) and returns `base`, the 40-hex sha every clone was cut at;
`makeRepo` leaves `a.txt` and `check.sh` tracked at BASE, whereas `bareRepo` in
`test_run_engine_pre_review.mjs` drops `a.txt` — use `makeRepo` for the diff legs, because
`git diff <sha> -- <path>` compares the commit with the working tree and shows an untracked
file only after it is staged, so the edited path must be one tracked at BASE. A red non-minor
`Check:` buys one `fix:<id>:0` round and then ends the task `proof-red` before any referee, so
the check on the edited path must be `minor: true` for the review prompt to exist; the
untouched path's check stays non-minor. The report fields the legs read are
`report.waveMerges[i].headSha`, `report.integratedRuns[]` (`{ task, cmd, exit, stdout }`),
`report.integratedChecks[]` (`{ cmd, exit, stdout, minor }`), the `RUN EVIDENCE:` and `CHECK
EVIDENCE:` blocks of the `review:<id>:1` prompt, and the `driver:proof-run`,
`driver:check-run`, `driver:integrated-run` and `driver:integrated-check` events in
`<runDir>/events.jsonl` (no stdout on the events — output is read from the prompt and the
report). A two-wave run is `waves: [[T1], [T2]]` with distinct `files`/`writes` per task and
`edges: [['T1', 'T2']]`, as `fleet/tests/test_run_engine.mjs` shows; wave 2's clone is
re-anchored onto wave 1's adopted head by the engine. The new legs sit under a comment naming
this task in each exam file, and at BASE they are red because the variable is unset (`test
"$ULTRA_BASE" = <sha>` exits 1 and the task ends `proof-red`).
**BASE facts:** (generated at e04154b)
- `baseSha` at `fleet/run-engine.mjs:739` blob ab943ea
- `fleet/run-engine.mjs` blob ab943ea
- `runCommands` at `fleet/run-engine.mjs:1101` blob ab943ea
- `runChecks` at `fleet/run-engine.mjs:1122` blob ab943ea
- `waveBaseSha` at `fleet/run-engine.mjs:1748` blob ab943ea
- `runExam` at `fleet/run-engine.mjs:1116` blob ab943ea
- `fleet/run-waves.mjs` blob 350bb66
- `fleet/tests/_engine_helpers.mjs` blob f929b25
- `base` at `fleet/doctor.mjs:254` blob 5e0d5c9
- `makeRepo` at `fleet/tests/_engine_helpers.mjs:21` blob f929b25
- `bareRepo` at `fleet/tests/test_run_engine_pre_review.mjs:83` blob 85de3af
- `files` at `fleet/run-main.mjs:312` blob 8dcde61
- `fleet/tests/test_run_engine.mjs` blob 25a93da
- `done` at `fleet/run-worker.mjs:713` blob ae07261
- `T1` at `fleet/tests/test_run_engine_implementer_suite.mjs:77` blob 7f142f7
- `T2` at `fleet/tests/test_run_engine_exam_evidence.mjs:246` blob 7ab5c73
- `constraintChecks` at `fleet/run-engine.mjs:633` blob ab943ea
- `fleet/tests/test_run_engine_integrated_runs.mjs` blob aec720f

**Proof:**
- Test: `fleet/tests/test_run_engine_proof_runs.mjs`
- Test: `fleet/tests/test_run_engine_pre_review.mjs`
- Legs: (a) in `test_run_engine_proof_runs.mjs`, a one-task run whose Proof has two `Run:`
  commands, `printenv ULTRA_BASE` and `test "$ULTRA_BASE" = <the rig's base>`, ends `done`
  with `driver:proof-run` exits all 0 at `iter` 0 and 1 for both commands, the `RUN
  EVIDENCE:` block of `review:T1:1` carrying, under the `printenv ULTRA_BASE` command, an
  output line that is exactly the rig's `base`, and that value matching forty lowercase hex
  characters — the command text holds no `$`, so the value can only have come from the
  process environment [M1]; (b) a two-wave run,
  wave 1 `T1` and wave 2 `T2` whose `Run:` is `sh -c 'echo base=$ULTRA_BASE'`, has
  `report.waveMerges[0].headSha` unequal to the rig's `base`, the `RUN EVIDENCE:` block of
  `review:T2:1` containing `base=` followed by `waveMerges[0].headSha` and not `base=`
  followed by the rig's `base`, and the `report.integratedRuns` entry for `T2` whose stdout
  contains `base=` followed by the rig's `base` and not `waveMerges[1].headSha` [M1] [M3];
  (c) in `test_run_engine_pre_review.mjs`, a `makeRepo` run whose implementer rewrites the
  tracked `a.txt` and leaves `check.sh` alone, with `constraintChecks` `git diff --quiet
  $ULTRA_BASE -- check.sh` (non-minor) and `git diff --quiet $ULTRA_BASE -- a.txt` (minor),
  records `driver:check-run` events at `iter` 0 with exit 0 for the `check.sh` command and a
  non-zero exit for the `a.txt` command, dispatches no `fix:` round, and its `review:T1:1`
  prompt's `CHECK EVIDENCE:` block carries `exit 0` under the `check.sh` command and a
  non-zero `exit <n> (minor)` under the `a.txt` command [M2]; (d) the same run's
  `report.integratedChecks` has exit 0 for the `check.sh` command and a non-zero exit for the
  `a.txt` command, its `driver:integrated-check` events match, and a `Run:` of `sh -c 'echo
  base=$ULTRA_BASE'` on the same task has a `report.integratedRuns` stdout containing `base=`
  followed by the rig's `base` [M3]; (e) the text of `fleet/run-engine.mjs` before its first
  line beginning `import ` contains `ULTRA_BASE` [M4]; (f) both sims print
  `ALL TESTS PASSED` [M5]; (g) in `test_run_engine_pre_review.mjs`, a two-wave run (wave 1
  `T1`, wave 2 `T2`) with the non-minor check `sh -c 'echo cbase=$ULTRA_BASE'` has
  `report.waveMerges[0].headSha` unequal to the rig's `base`, the `CHECK EVIDENCE:` block of
  `review:T2:1` containing `cbase=` followed by `waveMerges[0].headSha` and not `cbase=`
  followed by the rig's `base`, the `CHECK EVIDENCE:` block of `review:T1:1` containing
  `cbase=` followed by the rig's `base`, and every `report.integratedChecks` entry for that
  command — one per adopted wave, two in all — with stdout containing `cbase=` followed by
  the rig's `base` and none containing `waveMerges[0].headSha` or `waveMerges[1].headSha`
  [M2] [M3].
- Run: node fleet/tests/test_run_engine_proof_runs.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the `Run:` sim's sentinel, its existing legs and the new ones [M1] [M3] [M5].
- Run: node fleet/tests/test_run_engine_pre_review.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the `Check:` sim's sentinel, its existing legs and the new ones [M2] [M3] [M5].
- Run: sed -n '1,/^import /p' fleet/run-engine.mjs | grep -q ULTRA_BASE
- The previous bullet is the header comment, read only above the first import line [M4].
- Run: node fleet/tests/test_run_engine_integrated_runs.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the integrated-pass sim, unchanged: the same seam with a command that does not read the variable [M3] [M5].

**Stale-if:**
- path-absent: `fleet/tests/_engine_helpers.mjs`
- path-absent: `fleet/tests/test_run_engine_integrated_runs.mjs`
- issue-closed: #632
