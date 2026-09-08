# The preflight validates knobs without the suite

**Grammar:** claims-v1

**Claim:** The preflight validates knobs without executing the whole suite (a collect-only / dry-run of the test command, or the suite scoped to the plan's own `Test:` paths), so a green run pays the suite exactly twice — the integrated pass and the frozen gate's — and the red-baseline reading moves entirely to the engine's lazy baseline. (quoted from #770)

**Goal:** #770 — the Claim above is the issue's desired-state sentence, signed by the operator
before authoring. At BASE `d26bbdc` a green run still pays the committed suite three times:
`fleet/run-main.mjs` calls `ultra_run.py --validate-knobs <argsFile>` after the tier fill, and
`validate_knobs` runs the run-wide `testCmd` on BASE in a throwaway worktree (exit 3 on red,
which run-main fails closed) before the engine has started — run-45's events put that pass
between `tiers` at 0.0 min and `provision` at 5.6. After #712 (0.3.20) the engine's own
baseline is lazy: it runs only when a wave's candidate suite is red, to tell a red BASE from a
red diff (`run-engine.mjs` `baseline:` judgment call). So the preflight pass can only ever
find a flake red on BASE, and it costs ~5.5 min per run at 4–6 vCPU. This plan makes the
preflight validate every knob it validates today — tier and review values, the bootstrap
rehearsal, every per-task exam runner — and validate the run-wide test command by its
**runner probe** (the same `--version` / `command -v` probe the per-task commands already get)
instead of by running it. The design choice inside the Claim, made by the author in the
operator's stead: the dry-run is the runner probe, not a collect-only (which only pytest has)
and not the suite scoped to the plan's `Test:` paths (which mostly do not exist at BASE). The
mechanism is a new narrow flag on the existing verb, `--no-baseline`, which `run-main.mjs`
passes; the flagless verb behaves as at BASE, so nothing in the frozen periphery moves and the
old behaviour is the rollback.
**Closes:** #770

**Tech Stack:** Python 3 (`skills/ultrapowers/scripts/ultra_run.py`, argparse, subprocess, git
worktrees; pytest under `tests/`), Node 22 ESM (`fleet/run-main.mjs`; the sim
`fleet/tests/test_run_main.mjs` drives `runMain` over an `exec` stub that plays the scripts
while git runs for real). The suite is `python3 -m pytest` from the repo root, which bridges
every `fleet/tests/test_*.mjs` through `tests/test_fleet_suite.py` (sentinel `ALL TESTS
PASSED`, no network).

**Parallelization rationale:** one wave, width 2 — both tasks `Review: peer`. Task 1 adds the
flag to the Python verb and Task 2 makes the Node driver pass it; the two share one literal,
`--no-baseline`, written into both Contexts, and neither consumes a symbol the other produces:
Task 2's sim stubs `ultra_run.py` entirely (it answers any `--validate-knobs` argv from the
stub), so it needs nothing of Task 1's runtime behaviour, and Task 1's exams invoke the script
directly. The Files blocks are disjoint, so the folded tree is the union and the live run is
their conjunction — which the committed suite (Acceptance) and the next live run establish.

## Global Constraints

- Check: `git diff --quiet $ULTRA_BASE -- skills/ultrapowers/scripts/gate_check.py skills/ultrapowers/scripts/ultra_gate.py skills/ultrapowers/scripts/run_acceptance.sh`
- Check: `git diff --quiet $ULTRA_BASE -- fleet/run-engine.mjs fleet/confine-hook.mjs skills/ultralearn/scripts/harvest_fleet_runs.py`
- The verification periphery is frozen (0.1.0) and the first Check is its pin; the second keeps
  this run off the three files concurrent runs are editing. What no command decides is the
  meaning: the gate's own acceptance suite (`run_acceptance.sh --suite-gate`) still executes on
  every run, the engine's lazy baseline (`fleet/run-engine.mjs`) is untouched and is now the only
  reader of a red BASE, and `receipt.json`'s `testCmd` is still the plan's command.
- `ultra_run.py --validate-knobs <argsFile>` **without** `--no-baseline` behaves as at BASE:
  every exit code, JSON key and verdict the existing tests pin is kept, and every test that
  stands at BASE in the files a task's Files names still holds.
- The knob-validate JSON line stays one JSON object on stdout, `ok` and `stage` first as at
  BASE; new keys are additive and appear only when the flag is given.
- The four operator documents name no mechanism that is not there
  (`tests/test_docs_agree_with_code.py` is the lens); at BASE none of them describes the
  preflight's suite pass, so this plan edits none of them.

**Acceptance:** suite — the committed suite is the verification.

### Task 1: The knob verb validates the test command by its runner, not by running it

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `skills/ultrapowers/scripts/ultra_run.py`
- Test: `tests/test_ultra_run.py`
- Test: `tests/test_ultra_run_task_test_cmds.py`

**Claim:** Given `--no-baseline`, the knob check finishes without running the test command, still refuses a bad tier, a dirtying bootstrap or a test runner that is not there, and without the flag it does exactly what it did before. (derived)
Machine: M1. `ultra_run.py --validate-knobs <args> --no-baseline` never executes `testCmd`:
for an args file with `bootstrapCmd` `true` and `testCmd` `echo NEVER-RAN; false` it exits 0,
its JSON line has `ok` true and no `baseline` key, and `NEVER-RAN` appears nowhere in its
stdout.
M2. Under `--no-baseline`, a non-blank `testCmd` is validated by its runner's probe — the
`TASK_RUNNERS` row whose prefix it matches, else `command -v` of its first word — run in the
probe worktree (a `wt-knob-*` path under the repository's `.claude/ultrapowers/`), and reported
as `testCmdRunner`, an object `{cmd, runner, ok}`; a runner that does not resolve, or whose
probe exits non-zero, makes `testCmdRunner.ok` false, the line's `ok` false and the exit code
1; an args file with no `testCmd` carries no `testCmdRunner` key.
M3. Under `--no-baseline` every other verdict is the BASE verdict: an unknown tier exits 1
with a `detail` naming `tier`; a `bootstrapCmd` that dirties the tree exits 1 with `treeClean`
false; an empty args object exits 0 printing the `nothing to validate` line.
M4. Without `--no-baseline` the verb behaves as at BASE: a red `testCmd` exits 3 with
`baseline.ok` false and its output in `baseline.output`, a green one exits 0 with `baseline.ok`
true, and no JSON line carries `testCmdRunner`.
M5. After every invocation, with or without the flag, no `wt-knob-*` directory remains under
`.claude/ultrapowers/` and `git worktree list` shows exactly one entry.

**Authorized-by:** #770 (enhancement, fleet); #712 (closed at 0.3.20 — the engine's baseline
is lazy, so the preflight's red-baseline reading is redundant); #116 (the pass this flag
skips) and #234 (the runner probe this flag reuses).

**Interfaces:**
- Consumes: none
- Produces: `ultra_run.py --validate-knobs <argsFile> --no-baseline` (exit 0 = knobs safe; 1 on any knob defect; never 3)

**Context:** The flag's spelling is `--no-baseline`, a store-true option of `main`'s parser
beside `--validate-knobs`, read only on the `--validate-knobs` path and ignored by the launch
pipeline; `fleet/run-main.mjs` passes it in a sibling task, so the literal must match exactly.
At BASE `validate_knobs(args_path, root)` in `skills/ultrapowers/scripts/ultra_run.py` (from
line 290) does, in order: the tier/review shape check over `waves`, the early return
`no bootstrapCmd — nothing to validate` when neither `bootstrapCmd`, `testCmd` nor any per-task
`testCmd` is set, the probe worktree `git worktree add --detach <root>/.claude/ultrapowers/wt-knob-<pid> HEAD`,
the bootstrap rehearsal (`treeClean` from `git status --porcelain`, red short-circuits the rest
of the block), the baseline — `subprocess.run(test_cmd, shell=True, cwd=probe_wt, timeout=1800)`
guarded by `has_test and not bootstrap_red`, whose verdict is `result["baseline"]` and whose red
is the `return 3` at the end — then `probe_task_test_cmds(task_cmds, probe_wt)` into
`result["perTaskTestCmds"]`, and the worktree removal in `finally`. `runner_for(cmd)` (line 248)
returns `(runner, probe argv)`: a `TASK_RUNNERS` row (`python3 -m pytest`, `node `, `bun test`,
line 224) or `(first word, ["/bin/sh", "-c", "command -v <word>"])`; `probe_task_test_cmds`
(line 267) runs each distinct runner once in `cwd` with a 120 s timeout and yields
`{cmd, runner, ok}` per command. Under the flag the baseline block is skipped and the run-wide
`testCmd` gets that same probe, in the same worktree, reported under a separate key
`testCmdRunner` (one object, not a list — it is one command); it is not merged into
`perTaskTestCmds`, whose item count existing tests pin exactly. The early return's condition is
unchanged: a `testCmd` alone still cuts the worktree (for the probe) and removes it. Exit code
under the flag: 1 when bootstrap, any per-task runner or the test-command runner is red, else
0 — the `return 3` is unreachable with the flag because no baseline ran. The `has_bootstrap` /
`has_test` / `task_cmds` names, the single-exit funnel through `finally` (#251's SIGTERM
handler, pinned by `test_validate_knobs_removes_its_probe_worktree_on_sigterm`) and the JSON
line's `ok`/`stage` leading keys stay as they are. Existing exam helpers: `tests/test_ultra_run.py`
has `make_repo(tmp_path)` (a one-commit repo with `.claude/` ignored) and
`run_validate_knobs(repo, args_path)`; `tests/test_ultra_run_task_test_cmds.py` has
`validate(repo, args_path, env)`, `shim_env(tmp_path, name, log, exit_code=0, only_args=None)`
(a logging shim first on PATH that records its physical cwd and argv per line into `log`),
`calls(log)`, `narrow_path` and `assert_no_probe_left(repo)` — extend them with the flag rather
than duplicating them, and group the new tests under a comment naming this task and #770. At
BASE none of the four operator documents (`skills/ultrapowers/SKILL.md`,
`skills/ultrapowers/references/first-run.md`, `fleet/RUNBOOK.md`, `README.md`) mentions the
preflight's suite pass or `--validate-knobs`, so no document changes; the fixture plans under
`tests/fixtures/plans/` that mention the verb are a byte-pinned corpus and are not touched.
Other consumers of the flagless verb that must keep passing: `tests/test_ultra_run_bootstrap_cmd.py`
(asserts `baseline.ok` true after an install), `tests/test_ultra_run_exam_command.py`,
`tests/test_review_peer.py` and `tests/test_deadline_slack.py`.
**BASE facts:** (generated at d26bbdc)
- `testCmd` at `fleet/publish-fold.mjs:645` blob 6797792
- `bootstrapCmd` at `fleet/run-engine.mjs:769` blob 3148252
- `ok` at `fleet/publish-fold.mjs:113` blob 6797792
- `baseline` at `fleet/run-engine.mjs:904` blob 3148252
- `detail` at `fleet/doctor.mjs:621` blob f9a1174
- `tier` at `fleet/doctor.mjs:276` blob f9a1174
- `main` at `docs/scripts/render_post_media.py:84` blob 869c41e
- `fleet/run-main.mjs` blob 60f6e30
- `skills/ultrapowers/scripts/ultra_run.py` blob 0a23e6b
- `waves` at `fleet/tests/test_exam_edited_patches.mjs:99` blob 628c82c
- `probe_task_test_cmds` at `skills/ultrapowers/scripts/ultra_run.py:267` blob 0a23e6b
- `cwd` at `fleet/confine-hook.mjs:208` blob e0cd408
- `test_validate_knobs_removes_its_probe_worktree_on_sigterm` at `tests/test_ultra_run.py:691` blob 2b82046
- `stage` at `fleet/run-main.mjs:547` blob 60f6e30
- `tests/test_ultra_run.py` blob 2b82046
- `tests/test_ultra_run_task_test_cmds.py` blob aab28f1
- `log` at `fleet/janitor.mjs:318` blob c8d8258
- `narrow_path` at `tests/test_ultra_run_task_test_cmds.py:83` blob aab28f1
- `skills/ultrapowers/SKILL.md` blob f297964
- `skills/ultrapowers/references/first-run.md` blob 0897044
- `fleet/RUNBOOK.md` blob 0c6f461
- `README.md` blob 245f9e9
- `tests/test_ultra_run_bootstrap_cmd.py` blob d244ade
- `tests/test_ultra_run_exam_command.py` blob 5b23eb9
- `tests/test_review_peer.py` blob f9f7991
- `tests/test_deadline_slack.py` blob cd8ff21
- `run_validate_knobs` at `tests/test_ultra_run.py:153` blob 2b82046
- `test_validate_knobs_red_baseline_exits_3` at `tests/test_ultra_run.py:604` blob 2b82046
- `test_validate_knobs_green_baseline_exits_0` at `tests/test_ultra_run.py:594` blob 2b82046

**Proof:**
- Test: `tests/test_ultra_run.py`
- Test: `tests/test_ultra_run_task_test_cmds.py`
- Legs (in `tests/test_ultra_run.py`): (a) `run_validate_knobs` with `--no-baseline` on
  `{"bootstrapCmd": "true", "testCmd": "echo NEVER-RAN; false"}` exits 0, the parsed line has
  `ok` true and `"baseline" not in out`, and `"NEVER-RAN" not in r.stdout` [M1]; (b) the
  existing `test_validate_knobs_red_baseline_exits_3` (exit 3, `baseline.ok` false,
  `FAILING-SUITE` in `baseline.output`) and `test_validate_knobs_green_baseline_exits_0`
  (exit 0, `baseline.ok` true), unchanged, plus a new assertion on each that
  `"testCmdRunner" not in out` [M4]; (c) with the flag, `{"waves": [[{"id": "1", "tier":
  "opus", "review": "lean"}]]}` exits 1, `ok` false, `"tier" in detail` [M3]; (d) with the
  flag, `{"bootstrapCmd": "touch dirt.txt"}` exits 1 with `treeClean` false [M3]; (e) with the
  flag, `{}` exits 0 and `"nothing to validate" in r.stdout` [M3]; (f) after each of the
  previous five legs — the flagless red and green baseline runs of the second leg included,
  since those are the invocations that run a command in the worktree — `glob("wt-knob-*")` under
  `.claude/ultrapowers` is empty and `git worktree list` has one line [M5].
- Legs (in `tests/test_ultra_run_task_test_cmds.py`): (g) with the flag and a logging `node`
  shim, `{"testCmd": "node fleet/tests/test_x.mjs"}` exits 0 and the line's `testCmdRunner`
  is the one `{cmd, runner, ok}` object
  `{"cmd": "node fleet/tests/test_x.mjs", "runner": "node", "ok": True}` (a dict, not a list,
  with exactly those three keys), the shim log
  holds a `--version` call whose cwd contains `wt-knob-` and lies under the repo's
  `.claude/ultrapowers/`, and no line of the log names `test_x.mjs` [M2]; (h) with the flag,
  `{"testCmd": "no-such-runner-770 tests/"}` exits 1 with `ok` false and `testCmdRunner`
  `{"cmd": "no-such-runner-770 tests/", "runner": "no-such-runner-770", "ok": False}` [M2];
  (i) with the flag and a `node` shim that exits 3 on `--version`, `{"testCmd": "node
  fleet/tests/test_x.mjs"}` exits 1 with `testCmdRunner.ok` false [M2]; (j) with the flag,
  an args file whose entries carry per-task commands and no run-wide `testCmd` prints a line
  with `perTaskTestCmds` and no `testCmdRunner` key [M2]; (k) without the flag, the same args
  file as the first of these legs prints no `testCmdRunner` key (the flagless line keeps its
  BASE keys) [M4]; (l) `assert_no_probe_left(repo)` after each of the previous five legs [M5].
- Run: python3 -m pytest -q tests/test_ultra_run.py tests/test_ultra_run_task_test_cmds.py tests/test_ultra_run_bootstrap_cmd.py tests/test_ultra_run_exam_command.py tests/test_review_peer.py tests/test_deadline_slack.py

**Stale-if:**
- path-absent: `skills/ultrapowers/scripts/ultra_run.py`
- issue-closed: #770

### Task 2: The driver asks for knob validation without the baseline

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/run-main.mjs`
- Test: `fleet/tests/test_run_main.mjs`

**Claim:** The driver asks the knob check to skip the baseline and issues no suite command of its own before the engine starts, and a knob defect still stops the run before any clone is cut. (derived)
Machine: M1. `runMain` invokes `ultra_run.py` with `--validate-knobs`, the args file path and
`--no-baseline` — exactly one exec per run whose argv contains `--validate-knobs`, and that
argv also contains `--no-baseline`.
M2. On a green run, among the execs the driver issues before `runEngineFn` is entered, exactly
two name `ultra_run.py` — the preflight, whose argv is the plan path then `--stamp` and its
value and carries neither `--validate-knobs` nor `--no-baseline`, then the `--validate-knobs`
call — and none has the args file's `testCmd` (`true`), `sh`, `bash` or `/bin/sh` as its
command.
M3. When the `--validate-knobs` exec exits 1 with a `knob-validate` JSON line whose `detail`
names a bad tier, `runMain` returns `code` 1 and `verdict` `knob-validate-failed` with a
`detail` containing that line's `detail`, `runEngineFn` is never entered, and no `clones`
directory exists under the run dir.

**Authorized-by:** #770 (enhancement, fleet); #712 (closed at 0.3.20 — the engine's baseline
is lazy and is now the only reader of a red BASE).

**Interfaces:**
- Consumes: none
- Produces: nothing a sibling consumes — the `--no-baseline` argv is read by `ultra_run.py`, which a sibling task teaches the flag to

**Context:** The flag's spelling is `--no-baseline`; a sibling task adds it to
`ultra_run.py --validate-knobs` in the same wave, so the literal must match exactly. This task's
sentence is the driver's half of the plan Claim: the sibling's exam establishes that the flag
skips the baseline inside the script, and this exam establishes that the driver asks for it
and runs no suite command itself — the sim stubs `ultra_run.py`, so nothing here can or
should assert what happens inside the script. At BASE
`fleet/run-main.mjs` builds the call at line 601:
`exec(py, [path.join(scripts, 'ultra_run.py'), '--validate-knobs', argsFilePath], { cwd: repoDir, env: pyEnv })`,
and on a non-zero exit returns `fail('knob-validate-failed', 'ultra_run.py --validate-knobs exited ' + vk.code + ': ' + (vk.stdout || vk.stderr).slice(-500))`
(lines 603–608); the comment above that return (lines 604–606) still calls exit 3 "the
red-baseline signal" — reword it: with `--no-baseline` the verb never exits 3, and the
red-baseline reading is the engine's lazy baseline (`fleet/run-engine.mjs`, the `baseline:`
judgment call, run only when a wave's candidate suite is red). The preflight exec is built at
line 560, `[path.join(scripts, 'ultra_run.py'), planPath, '--stamp', stamp]` plus the optional
`--test-cmd` / `--bootstrap-cmd` / `--overlap` pairs, and the Python it invokes (`ultra_run.py`'s
launch pipeline, `main` from line 532) only detects and records `testCmd` into the receipt —
it never executes it; the only two sites in that script that run a knob's command are the
bootstrap rehearsal and the baseline inside `validate_knobs`, which is why the sim's stub
layer, which sees argv and nothing inside the script, is the right layer for M2 once the
preflight argv is pinned. The header comment's pipeline
line (line 10, `ultra_run.py preflight+compile → fill tiers → --validate-knobs`) may name the
flag. Provisioning (`provisionRunTree`, the `clones` directory) is step 3 and happens only
after the validate call succeeds, so a knob defect leaves no `clones` dir — the same check the
empty-plan sim already uses. The engine seam is `runEngineFn` (injected in the sim; the real
one is `runEngine` of `fleet/run-engine.mjs`, whose first event is `phase('Setup')`), which is
why the issue's sentence reads "before `engine:phase Setup`": in the sim "before the engine"
is "before `runEngineFn` is entered". `claude auth status` (line 658) is exec'd after
provisioning and before the engine — its command is `claude`, allowed by M2. The sim
`fleet/tests/test_run_main.mjs`: `makeExecStub({ repoDir, runId, gateExit, acks, waves })`
(from line 283) records every exec as `[cmd, ...argv]` into `calls`, runs `git` for real,
answers `ultra_run.py` with `--validate-knobs` at lines 308–311 (`{ code: 0, stdout: '{"ok": true}' }`),
plays the preflight by writing `args.json` (`testCmd: 'true'`) and `receipt.json`, and throws
on any unexpected command — so a driver that ran `true` before the engine would throw there,
which is M2's falsifier alongside the explicit scan of `calls`; the green flow (from line 369)
already asserts `calls.some((c) => c.includes('--validate-knobs'))`. Give the stub one more
knob (for instance `validateExit`, default 0, with a `knob-validate` JSON line on stdout when
non-zero) for M3; a `runEngineFn` that throws `must not launch` is the sim's existing idiom for
"never entered", and a flag set inside `runEngineFn` marks the boundary for M2's "before".
`fleet/tests/test_run_main_engine_dir.mjs` stubs the verb by `argv.includes('--validate-knobs')`
and needs no change; `tests/test_finalize_wiring.py` pins the `finalize_report.py` and
`ultra_gate.py` call sites in this file by their `join(scripts, …)` needles — keep them.
**BASE facts:** (generated at d26bbdc)
- `runMain` at `fleet/run-main.mjs:516` blob 60f6e30
- `testCmd` at `fleet/publish-fold.mjs:645` blob 6797792
- `sh` at `fleet/run-engine.mjs:696` blob 3148252
- `bash` at `fleet/tests/test_confine_hook.mjs:177` blob 05bbf3e
- `detail` at `fleet/doctor.mjs:621` blob f9a1174
- `code` at `fleet/claude-token.mjs:299` blob b7e8e7b
- `verdict` at `evals/frontier/replay_corpus.py:51` blob 7d40d74
- `clones` at `fleet/tests/test_sandbox_boot.mjs:134` blob 975a504
- `fleet/run-main.mjs` blob 60f6e30
- `fleet/run-engine.mjs` blob 3148252
- `provisionRunTree` at `fleet/run-main.mjs:331` blob 60f6e30
- `runEngine` at `fleet/run-engine.mjs:683` blob 3148252
- `claude` at `fleet/tests/test_doctor.mjs:462` blob 0f9de8d
- `fleet/tests/test_run_main.mjs` blob ef647cb
- `calls` at `fleet/run-engine.mjs:1662` blob 3148252
- `git` at `fleet/lobby.mjs:271` blob 62d348b
- `fleet/tests/test_run_main_engine_dir.mjs` blob 51a487e
- `tests/test_finalize_wiring.py` blob 6bfc57d

**Proof:**
- Test: `fleet/tests/test_run_main.mjs`
- Legs: (a) in the green flow, the `calls` entries whose argv includes `--validate-knobs`
  number exactly one, and that entry includes both the args file path and `--no-baseline` [M1];
  (b) in the green flow, with `runEngineFn` recording the `calls.length` at entry, the entries
  before that index that name `ultra_run.py` (by `path.basename(c[1])`) number exactly two,
  the first with `c[2]` equal to the plan path, `c[3]` equal to `--stamp` and `c[4]` the
  stamp, and including neither `--validate-knobs` nor `--no-baseline`, the second including
  `--validate-knobs`, and no entry before that index has `c[0]` equal to `true`, `sh`, `bash`
  or `/bin/sh` [M2]; (c) a flow whose stub answers
  `--validate-knobs` with exit 1 and stdout `{"ok": false, "stage": "knob-validate", "detail": "task T1: tier 'opus' is not null|cheap|standard|mostCapable"}`
  returns `code` 1, `verdict` `knob-validate-failed`, a `detail` containing `task T1: tier`,
  its `runEngineFn` (which throws `must not launch`) was never entered, and
  `fs.existsSync(path.join(runDir, 'clones'))` is false [M3].
- Run: node fleet/tests/test_run_main.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_run_main_engine_dir.mjs | grep -q 'ALL TESTS PASSED'
- Run: python3 -m pytest -q tests/test_finalize_wiring.py tests/test_docs_agree_with_code.py

**Stale-if:**
- path-absent: `fleet/run-main.mjs`
- issue-closed: #770
