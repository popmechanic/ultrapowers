# Approved runs arrive ready

**Grammar:** claims-v1

**Claim:** After this run, a run the engine approved reaches me as a ready pull request whose
squash-merge keeps the plan's title, a correct tree is not parked by a leftover cache
directory, and the release suite no longer flakes on the worktree cleanup test. (elicited)

**Goal:** Close the engine-and-sandbox half of the walk-3 findings: #622 (the boot script
reads only the gate receipt's verdict, never the engine's own approval, so a run the two-move
rule approved publishes as a draft and reads `parked`), #633 (the fold commit is titled
`frontier fold wave 1`, so a plain squash-merge loses the run's title), #631's driver half
(a `__pycache__` that survives in the integration clone fails a correct task's `test ! -e`),
and #603 (the SIGTERM probe-worktree test flakes under `-n auto`). Nothing on the laptop side
is touched: `fleet/launch.mjs`, `fleet/doctor.mjs`, the compiler and the preflight are
byte-identical to BASE.

**Tech Stack:** bash (`fleet/sandbox-boot.sh` and its sims), Node 24 ESM (`fleet/run-engine.mjs`
and the sims under `fleet/tests/`, each printing `ALL TESTS PASSED`), Python 3 (the fold
kernel `skills/ultrapowers/kernel/fold_wave.py` and `python3 -m pytest` with
`pytest-xdist`), Markdown. Nothing is added to any dependency file.

**Spec:** #622, #633, #631, #603 (the issues carry the design; there is no separate spec
document).

**Parallelization rationale:** One wave, width 4. Tasks 2 and 3 both modify
`fleet/run-engine.mjs` (a `--subject` argument on the materialize call; a clean step before the
integrated `Run:` pass — two regions, text that folds), and Tasks 1 and 2 both modify
`fleet/RUNBOOK.md` (the publish paragraph; the merge sentence — text that folds). No task
consumes a sibling's symbol, so no edge is derived and no task waits. Each task's exam is a
new test file, so no two examiners write one file.

## Global Constraints

- The vendored kernel is byte-identical to BASE: `skills/ultrapowers/kernel/vendor/manyana.py`
  is sha-pinned on purpose and never patched.
- Check: test "$(git hash-object skills/ultrapowers/kernel/vendor/manyana.py)" = 0e0367d23d19cdf87a047bd7f5cd814698f75fc4
- The laptop side is untouched: `fleet/launch.mjs`, `fleet/doctor.mjs`,
  `skills/ultrapowers/scripts/compile_plan.py` and `skills/ultrapowers/scripts/ultra_run.py`
  are byte-identical to BASE.
- Check: test "$(git hash-object fleet/launch.mjs)" = 4404cdb6717ca3108da07a42b528827850647c7e
- Check: test "$(git hash-object skills/ultrapowers/scripts/compile_plan.py)" = ed54d9845f5f857a4ac24d80c78ef483239f6af3
- The existing boot, engine and kernel exams keep passing in every clone.
- Check: node fleet/tests/test_sandbox_boot.mjs | grep -q 'ALL TESTS PASSED'
- Check: node fleet/tests/test_sandbox_boot_edges.mjs | grep -q 'ALL TESTS PASSED'
- Check: node fleet/tests/test_run_engine_integrated_runs.mjs | grep -q 'ALL TESTS PASSED'
- Check: node fleet/tests/test_run_engine.mjs | grep -q 'ALL TESTS PASSED'
- Check: python3 -m pytest -q -p no:cacheprovider tests/test_fold_wave_materialize.py tests/test_fold_wave.py tests/test_docs_agree_with_code.py
- The contract's literals stay what the documents teach: the unit name, the engine directory
  and the VM name are unchanged, and the retired vocabulary of the pre-lift fleet
  (orchestrator VM, golden image, grant step, tunnel) is reintroduced nowhere —
  `tests/test_docs_agree_with_code.py` is the pin.
- No shouted imperative (an all-caps MUST, NEVER or ALWAYS as a whole word) is added to
  `fleet/CONTRACT.md` or `fleet/RUNBOOK.md`.
- No file outside a task's own Files block is edited.

**Acceptance:** suite — the committed suite is the verification.

### Task 1: An approved run publishes ready

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/sandbox-boot.sh`
- Modify: `fleet/CONTRACT.md`
- Modify: `fleet/RUNBOOK.md`
- Test: `fleet/tests/test_sandbox_boot_approved.mjs`

**Claim:** A run the engine approved reaches me as a ready pull request. (derived)
Machine: M1. When the engine exits 0 leaving a gate receipt whose `verdict` is `NEEDS_ACK`
and an `approve-receipt.json` in the same run directory, the boot script's outcome is
`gate-green`: the PR POST payload carries `"draft":false`, `status.json` ends at state `done`
with the PR URL, and the log carries the line `outcome: gate-green (verdict=NEEDS_ACK,
approved by the two-move rule)`. M2. The same run with no `approve-receipt.json` is `parked`
exactly as at BASE: the payload carries `"draft":true`, `status.json` ends at `parked` with
`parked: gate verdict NEEDS_ACK` as its error. M3. A gate receipt whose `verdict` is `PASS`
with no `approve-receipt.json` is `gate-green` exactly as at BASE. M4. `fleet/CONTRACT.md`
says, in the REST-call sentence, that `draft` is true unless the verdict is PASS or
`approve-receipt.json` is present, and in its Publish bullet that the PR is ready on PASS or
on the two-move rule's approval; `fleet/RUNBOOK.md`'s publish paragraph says ready on PASS or
on the two-move rule's approval; and `tests/test_docs_agree_with_code.py` passes.

**Authorized-by:** #622 ("Fix, one branch in `fleet/sandbox-boot.sh`").

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** `gate_receipt_path()` in `fleet/sandbox-boot.sh` (line ~480 at BASE) answers
the first of two locations — `$TARGET_DIR/fleet-receipts/$RUN_ID/gate-receipt.json`, then
`$(run_dir_path)/gate-receipt.json` — and `gate_verdict()` reads its `verdict` with
`json_field`; the outcome is decided at `verdict="$(gate_verdict)"; if [ "$verdict" = "PASS"
]; then outcome="gate-green"; else outcome="parked"; fi` followed by `log "outcome: $outcome
(verdict=${verdict:-none})"`, and `publish()` sets `draft=false` only for `gate-green`. The
engine writes the approval as `fs.writeFileSync(path.join(runDir, 'approve-receipt.json'),
app.stdout)` in `fleet/run-main.mjs` after `ultra_gate.py --approve` succeeds, in the same
run directory as `gate-receipt.json`; a sibling `approve_receipt_path()` mirroring
`gate_receipt_path()`'s two locations is the read. The run directory is per run, so an
approve receipt found there is this run's; the boot script does not know the engine's stamp
and does not check it. The boot sim `fleet/tests/test_sandbox_boot.mjs` (helpers in
`_sandbox_boot_helpers.mjs`: a stub bin dir, `makeHome`, `boot`, the log readers, and a stub
engine that writes `events.jsonl` and the receipts into the run directory) drives the whole
green path against stub binaries; the new sim extends the stub engine to write a `NEEDS_ACK`
gate receipt with and without an `approve-receipt.json`, and reads the POST payload, the
final `status.json` and the log the way the existing sims do. The CONTRACT sentence to change
reads `\`draft\` = true unless the verdict is PASS.` and its Publish bullet reads `ready on
PASS, a draft otherwise`; the RUNBOOK paragraph reads `ready on PASS, a draft carrying the
gate receipt otherwise`.
**BASE facts:** (generated at 13c0e15)
- `verdict` at `evals/frontier/replay_corpus.py:51` blob 7d40d74
- `done` at `fleet/run-worker.mjs:713` blob 5e4bff2
- `parked` at `fleet/tests/test_run_main.mjs:74` blob 8335fb7
- `fleet/CONTRACT.md` blob aeb181f
- `fleet/RUNBOOK.md` blob f5af3f1
- `tests/test_docs_agree_with_code.py` blob c9687c7
- `fleet/sandbox-boot.sh` blob ae3d778
- `after` at `fleet/tests/test_run_waves.mjs:222` blob 69c38f4
- `fleet/tests/test_sandbox_boot.mjs` blob ec8ba1e
- `makeHome` at `fleet/tests/_sandbox_boot_helpers.mjs:299` blob 600e712
- `boot` at `fleet/tests/_sandbox_boot_helpers.mjs:319` blob 600e712
- `pr` at `fleet/tests/test_sandbox_boot.mjs:294` blob ec8ba1e
- `fleet/tests/_sandbox_boot_helpers.mjs` blob 600e712

**Proof:**
- Test: `fleet/tests/test_sandbox_boot_approved.mjs`
- Legs: (a) with a `NEEDS_ACK` gate receipt and an `approve-receipt.json` in the run
  directory, the recorded POST payload contains `"draft":false`, the final `status.json`
  state is `done` and its `pr` is the PR URL, and the log contains `outcome: gate-green
  (verdict=NEEDS_ACK, approved by the two-move rule)` [M1]; (b) with the same gate receipt
  and no `approve-receipt.json`, the payload contains `"draft":true`, the final state is
  `parked` and its error is `parked: gate verdict NEEDS_ACK` [M2]; (c) with a `PASS` gate
  receipt and no `approve-receipt.json`, the payload contains `"draft":false` and the final
  state is `done` [M3]; (d) the sim prints `ALL TESTS PASSED`.
- Run: node fleet/tests/test_sandbox_boot_approved.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the sim's sentinel [M1] [M2] [M3].
- Run: tr '\n' ' ' < fleet/CONTRACT.md | grep -q 'unless the verdict is PASS or .approve-receipt.json. is present'
- The previous bullet is the REST-call sentence, both disjuncts, read with the file's line
  wraps joined (the dots stand for the backticks around the file name, which a Run: command
  may not carry) [M4].
- Run: tr '\n' ' ' < fleet/CONTRACT.md | grep -q "ready on PASS or on the two-move rule's approval"
- The previous bullet is the Publish bullet, wraps joined [M4].
- Run: tr '\n' ' ' < fleet/RUNBOOK.md | grep -q "ready on PASS or on the two-move rule's approval"
- The previous bullet is the RUNBOOK's publish paragraph, wraps joined [M4].
- Run: python3 -m pytest -q -p no:cacheprovider tests/test_docs_agree_with_code.py
- The previous bullet is the structural pin over the operator documents [M4].

**Stale-if:**
- path-absent: `fleet/sandbox-boot.sh`
- path-absent: `fleet/tests/_sandbox_boot_helpers.mjs`
- issue-closed: #622

### Task 2: The fold commit is titled from the plan

**Type:** implementation

**Files:**
- Modify: `skills/ultrapowers/kernel/fold_wave.py`
- Modify: `fleet/run-engine.mjs`
- Modify: `fleet/RUNBOOK.md`
- Test: `tests/test_fold_wave_subject.py`
- Test: `fleet/tests/test_run_engine_fold_subject.mjs`

**Claim:** A run's squash-merge keeps the plan's title. (derived)
Machine: M1. `fold_wave.py materialize` accepts an optional `--subject <text>`; with it, the
candidate commit's subject (`git log -1 --format=%s`) is exactly `<text>` and its body
(`%b`) is `frontier fold wave <N>`; without it the whole message is `frontier fold wave <N>`,
as at BASE. M2. When the engine's `planPath` names a file whose first line beginning `# ` is
`# <title>`, the engine passes `--subject <title>` to materialize and the integration
branch's head after wave 1 has subject `<title>` and a body containing `frontier fold wave
1`. M3. With no `planPath`, or a plan file with no line beginning `# `, the engine passes no
`--subject` and the head's subject is `frontier fold wave 1`. M4. `fleet/RUNBOOK.md` says
that a squash-merge takes the plan's title as its subject because the fold commit is titled
from the plan's H1.

**Authorized-by:** #633 ("Fix in the fold's commit message: the plan's H1 … as the subject,
`frontier fold wave <n>` in the body").

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** The commit is made in `_build_candidate(repo, prev_head, parents, wave,
touched, manifest, modes)` in `fold_wave.py` (line ~1315 at BASE) with `commit-tree … -m
"frontier fold wave %d" % wave`, called from `cmd_materialize` (line ~1429); the
`materialize` subparser (line ~1592) takes `--repo`, `--run-dir`, `--wave`, `--prev-head`,
`--task-head`/`--patch` and `--allow-unresolved`. `git commit-tree` takes several `-m`
values and joins them as paragraphs, so `-m <subject> -m "frontier fold wave N"` yields the
two-paragraph message. The `fold` subcommand is not changed. The engine calls materialize at
`runCli(['materialize', ...common, '--prev-head', prevHead, ...taskArgs])` in `foldWave`
(`fleet/run-engine.mjs` line ~1389) and holds `planPath` from `args.planPath` (line ~553);
the title is the text after `# ` on the first such line, trimmed, read once at engine start,
with a missing or unreadable file or no such line meaning no `--subject`. The kernel tests
drive the CLI through `do_materialize(repo, run_dir, wave, prev_head, branch_specs)` in
`tests/test_fold_wave.py` (an `extra` argv list is the pattern `do_fold` uses); the engine
sims build a run with `rig({ repo, runDir, waves, … })` from `fleet/tests/_engine_helpers.mjs`
and read the integration clone's git log afterwards. The RUNBOOK sentence goes in the
paragraph that says `The PR is the gate: merge it, or close it.`
**BASE facts:** (generated at 13c0e15)
- `planPath` at `fleet/launch.mjs:187` blob 4404cdb
- `fleet/RUNBOOK.md` blob f5af3f1
- `materialize` at `skills/ultrapowers/kernel/repo_weave.py:521` blob c9856c0
- `fold` at `fleet/run-engine.mjs:1246` blob 5ac1fbf
- `foldWave` at `fleet/run-engine.mjs:1207` blob 5ac1fbf
- `fleet/run-engine.mjs` blob 5ac1fbf
- `tests/test_fold_wave.py` blob 908618c
- `do_fold` at `tests/test_fold_wave.py:286` blob 908618c
- `fleet/tests/_engine_helpers.mjs` blob f929b25
- `skills/ultrapowers/kernel/fold_wave.py` blob 3a2c761

**Proof:**
- Test: `tests/test_fold_wave_subject.py`
- Test: `fleet/tests/test_run_engine_fold_subject.mjs`
- Legs: (a) a fold of one task followed by `materialize --subject 'Widget plan'` yields a
  candidate whose `%s` is `Widget plan` and whose `%b` is `frontier fold wave 1`; the same
  without `--subject` yields `%s` equal to `frontier fold wave 1` and an empty `%b` [M1]; (b)
  an engine run whose `planPath` names a file whose first line is `# Widget plan` ends with
  the integration branch head's `%s` equal to `Widget plan` and `%b` containing `frontier
  fold wave 1`, and the same for a plan file whose first line is a blank line and whose
  second line is `# Widget plan` [M2]; (c) an engine run with no `planPath` ends with the head's `%s` equal to
  `frontier fold wave 1`, and one whose plan file has no `# ` line does the same [M3]; (d)
  both exams pass.
- Run: python3 -m pytest -q -p no:cacheprovider tests/test_fold_wave_subject.py
- The previous bullet is the kernel exam [M1].
- Run: node fleet/tests/test_run_engine_fold_subject.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the engine sim's sentinel [M2] [M3].
- Run: tr '\n' ' ' < fleet/RUNBOOK.md | grep -q "squash-merge takes the plan's title as its subject"
- The previous bullet is the RUNBOOK sentence's load-bearing half, wraps joined [M4].
- Run: tr '\n' ' ' < fleet/RUNBOOK.md | grep -q "titled from the plan's H1"
- The previous bullet is the sentence's causal half, naming the H1 [M4].

**Stale-if:**
- path-absent: `skills/ultrapowers/kernel/fold_wave.py`
- path-absent: `fleet/tests/_engine_helpers.mjs`
- issue-closed: #633

### Task 3: The integration clone is swept of cache directories before the integrated proofs

**Type:** implementation

**Files:**
- Modify: `fleet/run-engine.mjs`
- Test: `fleet/tests/test_run_engine_integrated_clean.mjs`

**Claim:** A correct tree is not parked by a leftover cache directory. (derived)
Machine: M1. Before the first integrated `Run:` command of a wave executes in the
integration clone, every directory named `__pycache__` or `.pytest_cache` under the clone
(outside `.git`) has been removed, and one event `driver:integrated-clean` carrying `wave` and
`removed` (the count of directories removed) is appended to `events.jsonl`. M2. A merged
task whose `Run:` is `test ! -e pkg/__pycache__` exits 0 on a run whose suite command creates
`pkg/__pycache__` every time it runs, so the run reports no completeness finding for it. M3.
Tracked files and other untracked files in the clone survive the sweep: a file `notes.txt`
the suite command creates untracked is still present when the integrated `Run:` executes.

**Authorized-by:** #631 (option (d): "the driver cleans `__pycache__` before the integrated
pass").

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** The integration clone is `const integ = path.join(clonesDir, 'integration')`
(`fleet/run-engine.mjs` line ~486); the integrated pass runs after a `MERGED` wave, `for
(const t of waveTasks) … for (const cmd of cmds) { const r = await sh(cmd, integ) …
appendEvent({ kind: 'driver:integrated-run', task, cmd, exit, wave }) }` (line ~1633), and
the suite runs in the same clone before it (`await sh(testCmd, integ)`), which is how the
cache directory gets there. The sweep is one walk of the clone that skips `.git`, removes
matching directories recursively, counts them, and appends its event before the loop; it runs
once per wave that reaches the integrated pass, and it never touches files or directories of
any other name (`git clean` is not the tool — it would take `node_modules` and every ignored
file with it). The sim `fleet/tests/test_run_engine_integrated_runs.mjs` shows the rig: `rig({
repo, runDir, waves, testCmd })` with `mkTask(id, file, { proofRuns })`, and `eventsOf(runDir)`
to read `events.jsonl`; a `testCmd` of `mkdir -p pkg/__pycache__ pkg/sub/__pycache__
.pytest_cache .git/__pycache__ && touch notes.txt && bash check.sh` plants every artifact on
every suite run.
**BASE facts:** (generated at 13c0e15)
- `wave` at `fleet/tests/test_claims_grammar.mjs:18` blob 416bf51
- `fleet/run-engine.mjs` blob 5ac1fbf
- `fleet/tests/test_run_engine_integrated_runs.mjs` blob aec720f
- `testCmd` at `fleet/run-engine.mjs:522` blob 5ac1fbf
- `proofRuns` at `fleet/run-engine.mjs:742` blob 5ac1fbf

**Proof:**
- Test: `fleet/tests/test_run_engine_integrated_clean.mjs`
- Legs: (a) after a run whose suite command plants `pkg/__pycache__`, `pkg/sub/__pycache__`,
  `.pytest_cache` and `.git/__pycache__`, `events.jsonl` carries exactly one
  `driver:integrated-clean` event for wave 1 with `removed` equal to 3, it precedes every
  `driver:integrated-run` event of that wave, and a merged task whose `proofRuns` is `['test !
  -e pkg/__pycache__ && test ! -e pkg/sub/__pycache__ && test ! -e .pytest_cache && test -e
  .git/__pycache__']` has its integrated run recorded with exit 0 — the nested one and the
  pytest cache are gone, the one under `.git` survives [M1]; (b) a merged task whose
  `proofRuns` is `['test ! -e pkg/__pycache__']` has its integrated run recorded with exit 0
  and the report carries no completeness finding naming it [M2]; (c) a task whose `proofRuns`
  is `['test -e notes.txt && test -e check.sh']` — `notes.txt` the untracked file the suite
  command touches, `check.sh` a file the rig commits at BASE — has its integrated run recorded
  with exit 0 [M3]; (d) the sim
  prints `ALL TESTS PASSED`.
- Run: node fleet/tests/test_run_engine_integrated_clean.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the sim's sentinel [M1] [M2] [M3].
- Run: node fleet/tests/test_run_engine_integrated_runs.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the existing integrated-runs sim, whose event-order pins hold with
  the new event in front of them [M1].

**Stale-if:**
- path-absent: `fleet/tests/test_run_engine_integrated_runs.mjs`
- issue-closed: #631

### Task 4: The SIGTERM probe-worktree test waits for the removal

**Type:** implementation

**Files:**
- Modify: `tests/test_ultra_run.py`

**Claim:** The release suite no longer flakes on the worktree cleanup test. (derived)
Machine: M1. In `test_validate_knobs_removes_its_probe_worktree_on_sigterm`, after
`proc.wait` returns, a `while` loop on the clock polls `_probe_dirs(repo)` until it is
empty, bounded by a third `deadline_budget` call in the test's body, and both the
`_probe_dirs(repo) == []` assertion and the `git worktree list` assertion come after that
loop. M2. `python3 -m pytest -q -p no:cacheprovider -n 4 tests/test_ultra_run.py
tests/test_deadline_slack.py` passes twice in a row.

**Authorized-by:** #603 ("wait on the worktree's removal with a deadline rather than
asserting immediately after the signal").

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** The test is at `tests/test_ultra_run.py` line ~691 at BASE: it starts
`ultra_run.py --validate-knobs` on an args file whose `testCmd` is `sleep 30`, waits (already
bounded by `deadline_budget(15)`) for a `wt-knob-*` directory under `.claude/ultrapowers` to
appear, sends `proc.terminate()`, `proc.wait(timeout=deadline_budget(15))`, and then asserts
`_probe_dirs(repo) == []` and `"wt-knob-" not in git worktree list` at once. The flake is
load-sensitive: the SIGTERM handler's worktree removal races the parent's teardown under
xdist. The fix is the same `while time.time() < deadline and _probe_dirs(repo):
time.sleep(0.1)` shape the appearance wait already uses, with `deadline_budget` from
`tests/deadline_slack.py`; the assertions stay. `tests/test_deadline_slack.py` runs
`test_ultra_run.py` nested, which is why both files ride the M2 command. The sandbox has
`pytest-xdist` from apt, so `-n 4` is available.
**BASE facts:** (generated at 13c0e15)
- `test_validate_knobs_removes_its_probe_worktree_on_sigterm` at `tests/test_ultra_run.py:691` blob f80c137
- `deadline_budget` at `tests/deadline_slack.py:46` blob 6e0595c
- `tests/test_ultra_run.py` blob f80c137
- `testCmd` at `fleet/run-engine.mjs:522` blob 5ac1fbf
- `tests/deadline_slack.py` blob 6e0595c
- `tests/test_deadline_slack.py` blob cd8ff21

**Proof:**
- Run: test "$(sed -n '/^def test_validate_knobs_removes_its_probe_worktree_on_sigterm/,/^def /p' tests/test_ultra_run.py | grep -c 'deadline_budget')" -ge 3
- The previous bullet reads only the SIGTERM test's body: BASE has two `deadline_budget`
  calls there (the appearance wait and the `proc.wait` timeout), so a third means the
  removal poll exists [M1].
- Run: sed -n '/^def test_validate_knobs_removes_its_probe_worktree_on_sigterm/,/^def /p' tests/test_ultra_run.py | grep -A6 'proc.wait' | grep 'while time.time() < ' | grep -q '_probe_dirs(repo)'
- The previous bullet pins the poll's predicate and position: a `while` on the clock whose own
  line names `_probe_dirs(repo)`, within six lines after `proc.wait` [M1].
- Run: sed -n '/^def test_validate_knobs_removes_its_probe_worktree_on_sigterm/,/^def /p' tests/test_ultra_run.py | tr '\n' ' ' | grep -q 'proc.wait.*while time.time() < .*_probe_dirs(repo) == \[\].*"worktree", "list"'
- The previous bullet pins the order with the body's lines joined: `proc.wait`, then the poll,
  then the emptiness assertion, then the `git worktree list` read [M1].
- Run: python3 -m pytest -q -p no:cacheprovider -n 4 tests/test_ultra_run.py tests/test_deadline_slack.py && python3 -m pytest -q -p no:cacheprovider -n 4 tests/test_ultra_run.py tests/test_deadline_slack.py
- The previous bullet is the two consecutive green runs under xdist [M2].

**Stale-if:**
- path-absent: `tests/test_ultra_run.py`
- path-absent: `tests/deadline_slack.py`
- issue-closed: #603
