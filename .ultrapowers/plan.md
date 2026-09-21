# The mow, cut two: one engine — the old engine, its boot, its publish fold, its prompts and the tests that only examined them leave the tree, and the factory carries its own clone-at-base

**Grammar:** claims-v1

**Claim:** After this run there is one engine. A launch always runs the factory; the old engine, its boot, its publish fold, its prompts and the tests that only examined them are gone from the tree; the launcher offers no knob that only the old engine read; and the contract, the runbook and CLAUDE.md describe exactly what exists. If the factory fails me afterwards, the way back is a revert of this merge. (elicited)
**Summary:** This deletes the old engine now that the factory has replaced it. It exists because two engines means every reader, every document and every fix has to ask which one — and the factory has now merged its own work on this repo and on a TinyApp, through the sync server, with its gate holding (runs 36, 37, 197; n=3 self-merged runs, under your floor of five, so this is an experiment whose rollback is a revert of this merge). After it the tree is about 21,000 lines lighter and everything that remains is something a launch actually uses.

**Goal:** Cut two of the mow (map #1131; the operator's decisions of 2026-09-18 and 2026-09-21): delete the old engine and its companions, move `cloneAtBase` into `factory/`, drop the bootstrap's old-boot fallback (rollback is a revert — the operator's call of 2026-09-21), drop the launcher's two knobs the factory boot ignores, and make the documents name only what exists. The compiler and the sandbox-side Python are NOT touched here — the rule tail is its own, later cut.

**Tech Stack:** Node 24 ESM; bash; pytest for the bridge (`tests/test_fleet_suite.py` runs every `fleet/tests/test_*.mjs`).
Spec: none on disk — the handoff's mow sequence and the operator's three answers of 2026-09-21 are the brief, and everything a worker needs is in its Context. The sandbox holds no spec.

## Global Constraints

- Check: git diff --quiet $ULTRA_BASE -- skills/ultrapowers/kernel skills/ultrapowers/scripts skills/ultrawrite/scripts fleet/janitor.mjs fleet/doctor.mjs fleet/target.mjs fleet/claude-token.mjs fleet/kata-client.mjs fleet/jev-client.mjs fleet/lobby.mjs fleet/kata-hub.mjs fleet/setup-script.mjs
- What the laptop uses stays byte for byte: the janitor, the doctor, the target tool, the credential tool, the two clients, the lobby, the hub tools and the setup script. This plan deletes an engine; it does not improve the launcher's neighbours.
- Nothing that survives imports, reads or spawns a file this plan deletes; a name left only in a sentence of history is fine, a path left in code or in a test is a finding.
- Deletion is whole files. No surviving function is rewritten to remember the old engine, and no shim is left behind.

### Task 1: The old engine leaves the tree, and the factory clones at base with its own code

**Type:** implementation
**Review:** peer

**Files:**
- Create: `factory/clone.mjs`
- Modify: `factory/engine.mjs`
- Modify: `fleet/fleet-bootstrap.sh`
- Modify: `fleet/tests/test_jev_client.mjs`
- Modify: `fleet/tests/test_setup_script.mjs`
- Modify: `fleet/tests/PROBES.md`
- Modify: `tests/test_compile_plan_exam_sweep.py`
- Delete: `fleet/run-engine.mjs`
- Delete: `fleet/run-main.mjs`
- Delete: `fleet/run-worker.mjs`
- Delete: `fleet/run-waves.mjs`
- Delete: `fleet/sandbox-boot.sh`
- Delete: `fleet/publish-fold.mjs`
- Delete: `fleet/publish-fold-block.mjs`
- Delete: `fleet/facts-block.mjs`
- Delete: `fleet/failing-block.mjs`
- Delete: `fleet/engine-coverage.mjs`
- Delete: `fleet/fitness.mjs`
- Delete: `fleet/confine-hook.mjs`
- Delete: `fleet/strip-exams.sh`
- Delete: `fleet/exam-paths.mjs`
- Delete: `fleet/jev-questions.mjs`
- Delete: `fleet/roles/README.md`
- Delete: `fleet/roles/examiner.md`
- Delete: `fleet/roles/fix.md`
- Delete: `fleet/roles/implementer.md`
- Delete: `fleet/roles/reconcile.md`
- Delete: `fleet/roles/resolver.md`
- Delete: `fleet/roles/reviewer.md`
- Delete: `fleet/tests/_engine_helpers.mjs`
- Delete: `fleet/tests/_sandbox_boot_helpers.mjs`
- Delete: `fleet/tests/test_worker_kata_env.mjs`
- Delete: `fleet/tests/test_jev_questions.mjs`
- Delete: `fleet/tests/probe_addcwd_scope.mjs`
- Delete: `fleet/tests/probe_bypass_vs_hook.mjs`
- Delete: `fleet/tests/probe_confine_live.mjs`
- Delete: `fleet/tests/probe_disallowed_vs_bypass.mjs`
- Delete: `fleet/tests/probe_dontask_readonly_bash.mjs`
- Delete: `fleet/tests/probe_run_worker_live.mjs`
- Test: `fleet/tests/test_factory_clone.mjs`

**Claim:** The old engine, its boot, its publish fold, its prompts and the tests that only examined them are gone from the tree, and a launch always runs the factory. (derived)
Machine: M1. `factory/clone.mjs` exports `cloneAtBase({ repo, dest, base })`: over a real two-commit repository it leaves `dest` a git checkout whose `HEAD` is exactly `base` — the FIRST commit, not the tip — holding the first commit's file and not the second's; and called with a `base` that is not a commit of `repo` it throws.
M2. `factory/engine.mjs` imports `cloneAtBase` from `./clone.mjs`, and no file under `factory/` names `run-waves`.
M3. None of the thirty-two paths this task's Files block deletes exists, and `fleet/roles` is not a directory.
M4. `fleet/fleet-bootstrap.sh` execs `factory/boot.sh` and names no other boot: the string `sandbox-boot` is nowhere in it, and a sha whose tree carries no `factory/boot.sh` is refused with a message on stderr and a non-zero exit before anything is exec'd.
M5. No surviving file under `fleet/`, `factory/` or `tests/` imports, reads or spawns a deleted path: the bridge `python3 -m pytest -q tests/test_fleet_suite.py` exits 0, and `python3 -m pytest -q tests/test_compile_plan_exam_sweep.py` exits 0.

**Authorized-by:** the operator's signed Claim of 2026-09-21; the mow's decision of 2026-09-18 (map #1131, cut two); the operator's answer of 2026-09-21 that the rollback is a revert.

**Interfaces:**
- Consumes: none
- Produces: `cloneAtBase({ repo, dest, base, git, identity })`

**Context:** You see this task body and nothing else. **What the sibling tasks do:** one edits `fleet/launch.mjs`, one line of `factory/boot.sh` and adds a launcher sim; one edits documents only (`CLAUDE.md`, `README.md`, `fleet/CONTRACT.md`, `fleet/RUNBOOK.md`, `skills/ultrapowers/SKILL.md`, the references, `hooks/session_start.sh`). You own code and tests; do not edit a document other than `fleet/tests/PROBES.md`. **Why:** the factory (`factory/`) replaced the old engine; the old one was kept as the live rollback until the factory had merged its own work here and on a TinyApp (runs 36, 37, 197, 2026-09-21). The operator has now ruled the rollback is a revert of this merge, so nothing of the old path stays. **The one borrowed function.** `factory/engine.mjs` line 47 is `import { cloneAtBase } from '../fleet/run-waves.mjs'` — the factory's only import from the old engine. In `fleet/run-waves.mjs`, `cloneAtBase({ repo, dest, base, git = defaultGit, identity = DEFAULT_IDENTITY })` (about lines 40 to 100, with the comment block above it, `DEFAULT_IDENTITY` at about line 55 and the private `defaultGit(argv, cwd)` at about line 89) makes `dest` a clone of `repo` checked out at `base` with a committer identity set, and throws `cloneAtBase: <dest> is at <head>, not BASE <base>` when the checkout is not at `base`. Move exactly that — the function, `DEFAULT_IDENTITY`, `defaultGit` and the comment that explains why a clone and not a worktree — into a new `factory/clone.mjs` with the same exported signature, import it in `factory/engine.mjs` from `./clone.mjs`, and change nothing about how the engine calls it. Nothing else in `run-waves.mjs` is used by the factory (`makeCwdFor`, `withPatchCapture`, `patchAgainstBase`, `makeEventLog` and the rest are the old engine's). **The deletion.** The Files block lists every path; each was checked at `4315358b` for who still uses it. The old engine is a closed set: `run-main` → `run-engine` → `run-worker`/`run-waves`/`publish-fold`/`facts-block`/`failing-block`/`engine-coverage`/`exam-paths`/`jev-questions`/`confine-hook`, `sandbox-boot.sh` → `strip-exams.sh`/`publish-fold`, and `fleet/roles/*.md` are read only by `run-engine.mjs`; `fitness.mjs` has no user at all. Outside that set they are used only by the ten test-side files also listed for deletion, and by three tests that stay and are yours to trim: `fleet/tests/test_jev_client.mjs` imports `rig` and friends from `./_engine_helpers.mjs` and `runMain` from `../run-main.mjs` — keep its legs (a) and (b), which examine `fleet/jev-client.mjs` alone (its exports, its constants, its one call, and that every failure is `null` and one log line), and delete every leg and import that needs the old rig, the old engine, `run-main` or `sandbox-boot.sh` (its legs (c) to (g) and its M5 to M7 header paragraphs); `fleet/tests/test_setup_script.mjs` leg (c) reads `sandbox-boot.sh` for the engine unit's `--unit=fleet-engine-$RUN_N` line — re-aim that leg at `factory/boot.sh`, where the same unit name is set by `fleet_systemd_run --user "--unit=fleet-engine-$RUN_N"`, if the rest of the leg's assertion still holds there, and delete the leg if it does not, saying which in your hand-in note; `tests/test_compile_plan_exam_sweep.py` pins a sentence of `fleet/roles/examiner.md` (its M4 leg, a `sed … fleet/roles/examiner.md | grep` command and the test that runs it, about lines 35, 392 and 510) — delete that leg, its command and its header lines, and leave the file's other legs alone. `fleet/tests/test_sims_are_hermetic.mjs` names `_sandbox_boot_helpers.mjs` and `test_fitness.mjs` only inside string fixtures it feeds its own checker; it needs no edit — do not touch it unless the bridge goes red on it. `tests/test_fold_wave_anchor.py` and `tests/test_fold_census.py` mention old names in comments and directory fixtures only, and `tests/test_fleet_suite.py` in one comment; they need no edit. `fleet/tests/_helpers.mjs`, `_lobby_helpers.mjs` and `_readiness_helpers.mjs` stay. `fleet/tests/PROBES.md` lists the live probes: remove the six deleted ones from it and keep `probe_kata_facts.mjs`, `probe_readiness_fold_order.mjs` and `probe_substitution_in_allowed_tail.mjs` if they import nothing deleted — check, and delete any of the three that does, adding it to your hand-in note as an amendment. `fleet/package.json` keeps its one dependency: `factory/worker.mjs` imports it. **The bootstrap.** `fleet/fleet-bootstrap.sh` lines 40 to 41 are `boot="$dst/fleet/sandbox-boot.sh"` then `[ -f "$dst/factory/boot.sh" ] && boot="$dst/factory/boot.sh"`. Replace them: `boot="$dst/factory/boot.sh"`, and when that file is absent, `say` a line naming the sha and that it carries no factory boot, and `exit` non-zero — an engine sha from before the factory is no longer launchable, on purpose. Keep the script's `say` helper and its final `FLEET_ASSIGNMENT="$comment" exec "$boot" boot`. `fleet/setup-script.mjs` embeds this file's text at launch and is held byte-identical by a run-wide check; it has one comment naming `sandbox-boot.sh`, which stays. **What you must not touch:** `skills/` (the compiler, the parser, the kernel and the sandbox-side Python are a later cut), and the laptop tools a run-wide check freezes. **For the examiner:** the exam is `fleet/tests/test_factory_clone.mjs`, for M1 only: `import { cloneAtBase } from '../../factory/clone.mjs'`, make a real repository in a temp directory with two commits (`one.txt`, then `two.txt`), call `cloneAtBase({ repo, dest, base: <first sha> })`, and read `git -C dest rev-parse HEAD` and the two files' presence; then a call with `base` set to forty `0`s must throw. Every `git` child gets `env: simEnv()` from `./_helpers.mjs`. M2 to M5 are proven by the `Run:` lines. The exam ends by printing `ALL TESTS PASSED` and exiting 0, and exits non-zero on the first failed assertion.

**Proof:**
- Test: `fleet/tests/test_factory_clone.mjs`
- Run: node --check factory/engine.mjs && node --check factory/clone.mjs && bash -n fleet/fleet-bootstrap.sh
- Run: grep -q "from './clone.mjs'" factory/engine.mjs && ! grep -rl "run-waves" factory
- Run: for p in fleet/run-engine.mjs fleet/run-main.mjs fleet/run-worker.mjs fleet/run-waves.mjs fleet/sandbox-boot.sh fleet/publish-fold.mjs fleet/publish-fold-block.mjs fleet/facts-block.mjs fleet/failing-block.mjs fleet/engine-coverage.mjs fleet/fitness.mjs fleet/confine-hook.mjs fleet/strip-exams.sh fleet/exam-paths.mjs fleet/jev-questions.mjs fleet/roles fleet/tests/_engine_helpers.mjs fleet/tests/_sandbox_boot_helpers.mjs fleet/tests/test_worker_kata_env.mjs fleet/tests/test_jev_questions.mjs fleet/tests/probe_addcwd_scope.mjs fleet/tests/probe_bypass_vs_hook.mjs fleet/tests/probe_confine_live.mjs fleet/tests/probe_disallowed_vs_bypass.mjs fleet/tests/probe_dontask_readonly_bash.mjs fleet/tests/probe_run_worker_live.mjs; do test ! -e "$p" || { echo "still there: $p"; exit 1; }; done
- Run: ! grep -q "sandbox-boot" fleet/fleet-bootstrap.sh && grep -q 'factory/boot.sh' fleet/fleet-bootstrap.sh
- Run: ! grep -rlE "run-engine\.mjs|run-main\.mjs|run-worker\.mjs|run-waves\.mjs|publish-fold|facts-block|failing-block|engine-coverage|confine-hook|strip-exams|exam-paths\.mjs|jev-questions|_engine_helpers|_sandbox_boot_helpers" --include='*.mjs' --include='*.sh' fleet factory | grep -v 'fleet/tests/test_sims_are_hermetic.mjs' | grep -v node_modules | grep .
- Run: python3 -m pytest -q tests/test_fleet_suite.py
- Run: python3 -m pytest -q tests/test_compile_plan_exam_sweep.py
- Legs: (a) [M1] the clone of the two-commit repository at the first sha has `HEAD` exactly that sha, holds `one.txt` and not `two.txt`, and the call with a `base` of forty zeros throws; (b) [M2] the first and second `Run:` lines — the engine and the new module parse, the engine imports from `./clone.mjs` and nothing under `factory/` names `run-waves`; (c) [M3] the third `Run:` line — every deleted path is absent; (d) [M4] the fourth `Run:` line — the bootstrap names the factory's boot and not the old one; what it does when the file is absent is read against the diff; (e) [M5] the fifth, sixth and seventh `Run:` lines — no surviving module or script names a deleted one, the bridge over every remaining sim exits 0, and the trimmed sweep exam exits 0.

**Stale-if:**
- path-absent: `fleet/run-engine.mjs`

### Task 2: The launcher offers no knob that only the old engine read

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/launch.mjs`
- Modify: `factory/boot.sh`
- Test: `fleet/tests/test_launch_one_engine.mjs`

**Claim:** The launcher offers no knob that only the old engine read. (derived)
Machine: M1. `node fleet/launch.mjs <plan> --target a/b --base <40-hex> --tier standard` and the same with `--implementer-effort low` are each refused: a non-zero exit, a one-line message on stderr naming the flag, and nothing executed — no lobby verb, no push.
M2. `usage()` names neither `--tier` nor `--implementer-effort`, and `fleet/launch.mjs` exports neither `TIER_VALUES` nor `EFFORT_VALUES`.
M3. The assignment comment a launch composes carries `run=`, `plan=`, `target=`, `base=`, `engine=` and, under `--hold`, `hold=1` — and no `tier=` and no `effort=` key.
M4. `factory/boot.sh`'s assignment parser no longer accepts `tier` or `effort`: it treats them as it treats any key it does not know.

**Authorized-by:** the operator's signed Claim of 2026-09-21 (cut two, the launcher's two dead knobs).

**Interfaces:**
- Consumes: none
- Produces: `usage()`

**Context:** You see this task body and nothing else. **What the sibling tasks do:** one deletes the old engine's files and edits `factory/engine.mjs`, `fleet/fleet-bootstrap.sh` and three tests; one edits documents only. You share `factory/boot.sh` with nobody — the deletion task does not touch it. **Why:** `--tier standard|mostCapable` and `--implementer-effort low|medium|high` set the old engine's model tier and its implementers' effort. The factory chooses per task from its own policy file, and `factory/boot.sh` says so at about line 127: `tier` and `effort` "are accepted for the launcher's sake and acted on by nobody", and its `parse_assignment` has the arm `tier|effort) : ;;` (about line 135). With the old engine deleted the two flags do nothing. In `fleet/launch.mjs`: the `USAGE` string (about line 133) lists both flags; `TIER_VALUES` and `EFFORT_VALUES` are exported constants (about lines 141 to 147) with their comments; `parseArgs`' validation refuses a bad value for each (about lines 965 to 971); and the assignment is composed with `tier: opts.tier` and `effort: implementerEffort` (about lines 1077 to 1078). Remove all of it, so an unknown `--tier` is refused the way the launcher already refuses any flag it does not know — read how `parseArgs` treats an unknown flag and make sure these two now take that path with the flag named in the message; if `parseArgs` silently ignores unknown flags today, add the refusal for these two by name rather than changing how every unknown flag is treated, and say so in your hand-in note. Remove the `tier|effort) : ;;` arm and its comment from `factory/boot.sh`; read what `parse_assignment` does with an unknown key before you do, and keep that behaviour. Comments elsewhere in `launch.mjs` that describe the old engine's wave width (`W`, `widestWaveOf`, `fleet/run-main.mjs`, about lines 455 to 460 and 1473) and `ultra_run.py`'s test-command detection are about code that still runs on the laptop or are history; leave any whose code still exists, and delete a comment only when the code it explains is gone. Several launcher sims exist — `fleet/tests/test_launch_duplicate.mjs` and `fleet/tests/test_launch_vm_size.mjs`, built on `fleet/tests/_lobby_helpers.mjs` — read them for how a launch is driven hermetically (a stubbed lobby, a temp target repository, `simEnv()`); if either passes `--tier` or `--implementer-effort` or pins the old `USAGE` string, that pin is yours: list the file in your hand-in note as an amendment and fix it. **For the examiner:** the exam is `fleet/tests/test_launch_one_engine.mjs`, a hermetic sim in the shape of `test_launch_vm_size.mjs` — it imports `./_helpers.mjs` and `./_lobby_helpers.mjs`, never another `test_*.mjs` (`test_sims_are_hermetic.mjs` forbids a sim naming a sibling sim). For M1 drive the launcher as those sims do and assert the exit code, the stderr line naming the flag, and that the stub lobby recorded no verb; for M2 import `usage` and the module namespace; for M3 read the comment the stub lobby's `new` verb received on a good launch, with and without `--hold`. M4 is read against the diff. The exam ends by printing `ALL TESTS PASSED` and exiting 0.

**Proof:**
- Test: `fleet/tests/test_launch_one_engine.mjs`
- Guard: `fleet/tests/test_launch_one_engine.mjs`
- Run: node --check fleet/launch.mjs && bash -n factory/boot.sh
- Run: ! grep -nE "tier\|effort|TIER_VALUES|EFFORT_VALUES|implementer-effort" fleet/launch.mjs factory/boot.sh | grep .
- Legs: (a) [M1] a launch line carrying `--tier standard` exits non-zero with `--tier` on stderr and the stub lobby recorded no verb, and the same for `--implementer-effort low`; (b) [M2] `usage()` contains neither `--tier` nor `--implementer-effort`, and the module namespace has no `TIER_VALUES` and no `EFFORT_VALUES` key; (c) [M3] on a good launch the comment handed to `new` contains `run=`, `plan=`, `target=`, `base=` and `engine=` and neither `tier=` nor `effort=`, and with `--hold` it also contains `hold=1`; (d) [M4] the two `Run:` lines — both files still parse, and neither names the two knobs or their constants any more; how the boot treats an unknown key is read against the diff.

**Stale-if:**
- path-exists: `fleet/tests/test_launch_one_engine.mjs`

### Task 3: The documents name only what exists

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md`
- Modify: `fleet/CONTRACT.md`
- Modify: `fleet/RUNBOOK.md`
- Modify: `skills/ultrapowers/SKILL.md`
- Modify: `skills/ultrapowers/references/design-rationale.md`
- Modify: `skills/ultrapowers/references/plan-markers.md`
- Modify: `skills/ultrapowers/references/report-format.md`
- Modify: `hooks/session_start.sh`

**Claim:** The contract, the runbook and CLAUDE.md describe exactly what exists, and say that the way back is a revert of this merge. (derived)
Machine: M1. None of the nine files names a path this plan deletes: no match for `run-engine.mjs`, `run-main.mjs`, `run-worker.mjs`, `run-waves.mjs`, `sandbox-boot.sh`, `publish-fold`, `facts-block`, `failing-block`, `engine-coverage`, `fitness.mjs`, `confine-hook`, `strip-exams`, `exam-paths.mjs`, `jev-questions` or `fleet/roles`.
M2. `CLAUDE.md`'s `## Layout` describes `fleet/` as the laptop's tools plus the bootstrap and `factory/` as the one engine, says `cloneAtBase` lives in `factory/clone.mjs`, and its `## Purpose & vision` names `factory/engine.mjs` as the engine; `fleet/RUNBOOK.md` says, in one place a reader looking for a rollback will find, that the old engine was removed on 2026-09-21, that an engine sha from before the factory is no longer launchable, and that the way back is a revert of that merge, naming the pull request.
M3. `hooks/session_start.sh` still exits 0 and still prints the routing rule; `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers` exits 0; and the surviving tests that read these documents — `tests/test_catch_report.py`, `tests/test_authoring_record.py` and the bridge `tests/test_fleet_suite.py` — exit 0.
M4. `--tier` and `--implementer-effort` appear in none of the nine files.

**Authorized-by:** the operator's signed Claim of 2026-09-21; the mow's decision of 2026-09-18 ("rewrite CONTRACT, RUNBOOK and CLAUDE.md around one engine").

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** You see this task body and nothing else. **What the sibling tasks do:** one deletes the old engine — `fleet/run-engine.mjs`, `run-main.mjs`, `run-worker.mjs`, `run-waves.mjs`, `sandbox-boot.sh`, `publish-fold.mjs` and its block, `facts-block.mjs`, `failing-block.mjs`, `engine-coverage.mjs`, `fitness.mjs`, `confine-hook.mjs`, `strip-exams.sh`, `exam-paths.mjs`, `jev-questions.mjs`, all of `fleet/roles/`, and ten test-side files that only drove them — moves `cloneAtBase` into a new `factory/clone.mjs`, and makes `fleet/fleet-bootstrap.sh` exec `factory/boot.sh` or refuse; the other removes `--tier` and `--implementer-effort` from `fleet/launch.mjs`. You edit documents and one hook's text; you touch no code a test runs, and you share no file with either sibling. **What is true after this plan, for you to write down.** There is one engine, `factory/` — `boot.sh` (the sandbox side: clone, plan, credential proof, the board's spoke, the engine as one transient unit, publish, self-merge with a re-fold when main moved, the hub closes, the two tags), `engine.mjs` (the run as search: per task an exam worker, `k` implementers, a measurement by the task's own exam command and the plan's `Run:` and `Check:` lines, selection, at most one re-dispatch, a referee when Jev asks for one, a fold through the kernel on every adoption, a fold check that re-runs the touched exams and the checks), `judge.mjs`/`questions.json`/`policy.json` (every judgment a question, every threshold a cell with its `n`, `window`, `experiment` and `rollback`), `board.mjs`, `tools.mjs`, `select.mjs`, `hunks.mjs`, `pairs.mjs`, `proofs.mjs`, `commands.mjs`, `reverify.mjs`, `union.mjs`, `dispatch.mjs`, `worker.mjs`, `clone.mjs`, `roles/` (`exam.md`, `implement.md`, `resolve.md`). `fleet/` is the laptop's tools and what a VM needs before the engine exists: `launch.mjs`, `lobby.mjs`, `doctor.mjs`, `janitor.mjs`, `retire.mjs`, `target.mjs`, `claude-token.mjs`, `kata-hub.mjs` and its setup script and unit, `kata-client.mjs`, `jev-client.mjs`, `setup-script.mjs`, `fleet-bootstrap.sh`, `fleet-run@.service`, `exe-verbs.json`, `CONTRACT.md`, `RUNBOOK.md`, and `fleet/tests/` (the launcher sims, the Jev client's, the probe's, `test_sims_are_hermetic.mjs`, the helpers, and the live probes that survive). The sandbox's parser is `skills/ultrapowers/scripts/plan_parse.py`; `compile_plan.py` is the laptop's check. The sandbox-side Python (`ultra_run.py`, `ultra_gate.py`, `gate_check.py`, `finalize_report.py`, `fleet_events.py`, `fold_census.py`) is still on the tree and no longer run by anything — say so where `CLAUDE.md` lists the skill's scripts, as owed to a later cut, rather than describing them as the run's gate. **How to edit.** Measured at `4315358b`, the lines naming a deleted path: `CLAUDE.md` 11, `fleet/CONTRACT.md` 31, `fleet/RUNBOOK.md` 4, `skills/ultrapowers/SKILL.md` 3, `report-format.md` 5, and one each in `README.md`, `design-rationale.md`, `plan-markers.md` and `hooks/session_start.sh`. Where a sentence only points at a deleted file, re-aim it at what does that job now or delete it; where a whole section of `CONTRACT.md` specifies the old engine's behaviour and nothing the factory does (its wave barrier, its reviewer and fix rounds, its publish fold, its status server, its confine hook, its role files), delete the section and leave one dated sentence in its place saying what it was and that it left with cut two — do not rewrite the factory's contract from imagination: what the factory does that the contract does not yet say is a later document's work, and a wrong literal in the contract is worse than a missing one. History may be told in words ("the wave engine that ran until 2026-09-21") but never as a path that no longer exists. `CLAUDE.md` is the agent's standing instructions: keep every doctrine bullet and every `Working with the operator` bullet as they are; edit `## Purpose & vision`, `## Commands` (drop nothing that still runs), `## Layout` and the `Conventions & gotchas` bullets that name deleted files (`Judgment prompts are data files` now means `factory/roles/*.md`; `Fleet engine sims ride the pytest suite` keeps its sentence about the bridge; `The boot serves a watcher` describes the old boot's status page — check `factory/boot.sh` for whether the factory serves one, and say what is true). `hooks/session_start.sh` prints the plan-routing rule into every session; it names the old engine once in its text — re-aim that one mention and change nothing else about what it prints or how. Do not edit `skills/ultrawrite/`: it names no deleted path. **Pins you must keep.** Surviving tests read three of these documents: `tests/test_catch_report.py` requires `fleet/RUNBOOK.md` to carry a `## Release` section, `tests/test_authoring_record.py` reads a sentence of the runbook about the authoring record, and the launcher and setup-script sims (`fleet/tests/test_launch_vm_size.mjs`, `fleet/tests/test_setup_script.mjs`) read `fleet/CONTRACT.md`'s launch-order bullet and its setup-script bullet and the runbook's celld paragraph. Read those four tests before you edit the two documents, leave what they read where it is, and run them — a `Run:` line does.

**Proof:**
- Run: ! grep -nE "run-engine\.mjs|run-main\.mjs|run-worker\.mjs|run-waves\.mjs|sandbox-boot\.sh|publish-fold|facts-block|failing-block|engine-coverage|fitness\.mjs|confine-hook|strip-exams|exam-paths\.mjs|jev-questions|fleet/roles" CLAUDE.md README.md fleet/CONTRACT.md fleet/RUNBOOK.md skills/ultrapowers/SKILL.md skills/ultrapowers/references/design-rationale.md skills/ultrapowers/references/plan-markers.md skills/ultrapowers/references/report-format.md hooks/session_start.sh | grep .
- Run: grep -q "factory/clone.mjs" CLAUDE.md && grep -q "factory/engine.mjs" CLAUDE.md && sed -n '/^## /,$p' fleet/RUNBOOK.md | tr '\n' ' ' | grep -q "2026-09-21.*revert"
- Run: bash hooks/session_start.sh >/dev/null && python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers
- Run: python3 -m pytest -q tests/test_catch_report.py tests/test_authoring_record.py tests/test_fleet_suite.py
- Run: ! grep -nE "\-\-tier|\-\-implementer-effort" CLAUDE.md README.md fleet/CONTRACT.md fleet/RUNBOOK.md skills/ultrapowers/SKILL.md skills/ultrapowers/references/design-rationale.md skills/ultrapowers/references/plan-markers.md skills/ultrapowers/references/report-format.md hooks/session_start.sh | grep .
- Legs: (a) [M1] the first `Run:` line — no document names a deleted path; (b) [M2] the second `Run:` line — `CLAUDE.md` names the factory's clone module and its engine, and the runbook carries the dated rollback sentence; what the Layout and the vision say beyond that is read against the diff; (c) [M3] the third and fourth `Run:` lines — the hook still runs, the skill still validates, and the tests that read these documents exit 0; (d) [M4] the fifth `Run:` line — neither knob is documented anywhere.

**Stale-if:**
- path-absent: `fleet/run-engine.mjs`
