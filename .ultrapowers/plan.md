# Retire the factory: the Flock is the only engine

**Grammar:** claims-v1
**Claim:** After this run, every launch runs the Flock and there is no factory left to choose; a run that finishes after main moved still catches up and merges on its own, and one that can't catch up cleanly opens a draft instead. (elicited)
**Summary:** This retires the factory, the older engine, so the Flock is the only engine a run can use. The Flock has met the bar the map set for this, with 9 green runs on this repository (runs 251–261) and 5 on the radio app, and keeping two engines doubles what we maintain and test. Runs still catch up to a moved main on their own, now the Flock's way, and a conflict there opens a draft pull request rather than a guess.

**Goal:** Delete the factory engine and the old merge kernel, give the Flock its own catch-up onto a moved main, and make the docs describe one engine (map #1292 rule 8: five green Flock runs on this repository and one on a TinyApp).
**Tech Stack:** Node 22 (ESM), Python 3, bash; the Flock (`factory/flock/`), the boot (`factory/boot.sh`), Manyana (vendored).
**Spec:** map #1292 rule 8; operator picks of 2026-09-29 (a Flock catch-up; all factory-only code goes, Manyana stays).

## Global Constraints

- The Flock's own run is unchanged: only `factory/flock/weave.py` changes under `factory/flock/`, and one file is added there (`catchup.mjs`).
- The launcher still writes `kind=flock` on every assignment comment, so an engine checkout from before this run (whose boot reads a missing `kind` as the factory) still boots the Flock; the rollback for one launch is a launcher run from a checkout at this run's base with `--kind factory`.
- Code comments and docs say what is true after this run; a sentence about the factory is kept only where it is history (a run number, a reading) and says so.
- Check: python3 -m pytest -q tests/test_fleet_suite.py -k "factory_boot or factory_publish or factory_record or factory_preflight or factory_board or launch or lobby or hermetic or jev_client"
- Check: git diff --quiet $ULTRA_BASE -- factory/flock/engine.mjs factory/flock/plan.mjs factory/flock/edit_spans.mjs factory/flock/flock_board.mjs factory/flock/kata_mirror.mjs factory/flock/past.mjs factory/flock/pulls.mjs factory/flock/scope.mjs factory/flock/step_reading.mjs

### Task 1: The Flock catches a finished run up to a moved main

**Type:** implementation

**Files:**
- Create: `factory/flock/catchup.mjs`
- Modify: `factory/boot.sh`

**Claim:** A run that finishes after main moved catches up the Flock's way: a clean join whose checks pass becomes the run's new head on top of main, and a conflict or a red check leaves the run's own work untouched. (derived)
Machine: M1. With main moved on a different line than the run's, `node factory/flock/catchup.mjs --plan <p> --target <dir> --base <run base> --onto <moved tip> --run-dir <dir>` exits 0, its last stdout line is JSON with `refolded: true` and `head` equal to the target's new HEAD, that HEAD has exactly one parent, the moved tip, and the file carries both sides' lines. M2. With main moved on the run's own line, it exits non-zero, its last line has `refolded: false` and `reason: "conflict"`, the target's HEAD is still the run's own commit and the tree is clean. M3. With a clean join on which one of the plan's `Run:` probes is red, it exits non-zero with `reason: "red"` and the target's HEAD is still the run's own commit. M4. `factory/boot.sh`'s re-fold step runs `factory/flock/catchup.mjs`. M5. `factory/boot.sh` names `factory/engine.mjs` nowhere: the engine unit always runs `factory/flock/engine.mjs`, an assignment without `kind=` boots the Flock, and `kind=factory` is refused with a line saying the factory was retired.

**Authorized-by:** map #1292 rule 8; operator pick 2026-09-29 (a Flock catch-up)

**Interfaces:**
- Consumes: `workloadFromPlan(planPath) -> {tasks, check, setup, checkTimeoutMs?}`
- Produces: `factory/flock/catchup.mjs --plan --target --base --onto --run-dir`

**Context:** Today `refold_onto` in `factory/boot.sh` runs `node factory/engine.mjs --refold --plan … --target … --base … --onto … --run-dir …`, reads its exit code and its last stdout line (`json_field reason`), then force-pushes the target's HEAD. It fired on Flock runs 253 and 254, both `ok: true`. Keep that argv and that last-line JSON exactly: `{"refolded": true, "head": <sha>, "onto": <sha>}` on success, `{"refolded": false, "reason": "conflict" | "red", "onto": <sha>}` otherwise, so the boot changes only the path it runs. When called, the target is on the run's branch with the run's own commit at HEAD (a descendant of `--base`) and a clean tree, and `--onto` is fetched.
The join is the Flock's own: the weave keeper `factory/flock/weave.py` over stdin/stdout, one JSON request per line. For the paths changed on both sides (`git diff --name-only base..HEAD` and `base..onto`): write each path's base text into a temp dir and send `base {root, paths}` (paths absent at base are simply not listed), then `rewrite {agent: "run", path, content}` with the run's text and `rewrite {agent: "main", path, content}` with the moved tip's (`content: null` for a deleted path), `publish` both, and `merged {order: ["main", "run"]}`; a non-empty `realConflicts` is a conflict, otherwise `files[p]` (or deletion when `exists[p]` is false) is the result. A path changed on one side only takes that side. A path that is not UTF-8 text and differs on both sides is a conflict. On a conflict, touch nothing.
With a result: reset the branch to `--onto`, write the result, and make one commit with the engine's own identity (`user.name=flock`, `user.email=flock@ultrapowers.invalid`); then run, in the target, the plan's setup, every task's facts and the run-wide check from `workloadFromPlan` (`factory/flock/plan.mjs`; the check's limit is `checkTimeoutMs`, else 120000 ms), each with `ULTRA_BASE` set to `--onto`, since a check such as `git diff --quiet $ULTRA_BASE -- <file>` must compare against the main the work now sits on. Any red: `git reset --hard` back to the run's own commit, then print `reason: "red"`. A throwaway prototype of exactly this passed all three probe cases in about 45 lines.
The probe `fleet/tests/flock_catchup_probe.mjs` exists at base and is not edited; it builds a temp target, runs the catch-up as the boot does, and prints `CATCHUP <case> OK`.
In `factory/boot.sh`: `parse_assignment` sets `ENGINE_KIND=factory` when the comment has no `kind=` (line ~99) and accepts `flock | factory`; `run_engine` defaults `engine_entry="factory/engine.mjs"` (line ~255). After this task the entry is always `factory/flock/engine.mjs`, a missing `kind` or `kind=flock` both boot it, and `kind=factory` fails the assignment with a line naming the retirement. Comments that name `factory/engine.mjs` go too (M5's probe reads comments). The boot sims (`test_factory_boot.mjs`, `test_factory_publish.mjs`) stub the engine unit and must stay green; they are the run-wide Check.

**Proof:**
- Run: node fleet/tests/flock_catchup_probe.mjs clean [M1]
- Run: node fleet/tests/flock_catchup_probe.mjs conflict [M2]
- Run: node fleet/tests/flock_catchup_probe.mjs red [M3]
- Run: grep -q 'factory/flock/catchup.mjs' factory/boot.sh [M4]
- Run: ! grep -q 'factory/engine.mjs' factory/boot.sh [M5]
- Legs: (a) the clean case exits 0 with `refolded: true`, `head` equal to HEAD, HEAD's one parent the moved tip, and both sides' lines in the file [M1]; (b) the conflict case exits non-zero with `reason: "conflict"`, HEAD the run's commit and a clean tree [M2]; (c) the red case exits non-zero with `reason: "red"` and HEAD the run's commit [M3]; (d) the boot's re-fold step names `factory/flock/catchup.mjs` [M4]; (e) no line of `factory/boot.sh` names `factory/engine.mjs`, and the reader checks the no-`kind` default and the `kind=factory` refusal against the hunk [M5].

**Stale-if:**
- path-exists: `factory/flock/catchup.mjs`

### Task 2: The factory engine is gone and cannot be launched

**Type:** implementation

**Files:**
- Delete: `factory/engine.mjs`
- Delete: `factory/baseread.mjs`
- Delete: `factory/checks-at-base.mjs`
- Delete: `factory/clone.mjs`
- Delete: `factory/dispatch.mjs`
- Delete: `factory/facts.mjs`
- Delete: `factory/fold.mjs`
- Delete: `factory/hunks.mjs`
- Delete: `factory/judge.mjs`
- Delete: `factory/kprobe.mjs`
- Delete: `factory/measure.mjs`
- Delete: `factory/pairs.mjs`
- Delete: `factory/proofs.mjs`
- Delete: `factory/refold.mjs`
- Delete: `factory/retry.mjs`
- Delete: `factory/reverify.mjs`
- Delete: `factory/select.mjs`
- Delete: `factory/tools.mjs`
- Delete: `factory/union.mjs`
- Delete: `factory/watch.mjs`
- Delete: `factory/worker.mjs`
- Delete: `factory/roles/implement.md`
- Delete: `factory/roles/resolve.md`
- Delete: `factory/replay/README.md`
- Delete: `factory/replay/analyze_landing.py`
- Delete: `factory/replay/replay_landing.py`
- Delete: `factory/replay/sample_disagreements.py`
- Delete: `factory/replay/results/2026-09-17-landing-replay.txt`
- Delete: `factory/replay/results/handread_50.jsonl`
- Delete: `factory/replay/results/landing_out.jsonl.gz`
- Delete: `factory/replay/results/landing_summary.json`
- Delete: `fleet/tests/test_factory_referee.mjs`
- Delete: `fleet/tests/test_factory_refold_dispatch.mjs`
- Delete: `fleet/tests/test_factory_retry.mjs`
- Delete: `fleet/tests/test_factory_reverify.mjs`
- Delete: `fleet/tests/test_factory_select.mjs`
- Delete: `fleet/tests/test_factory_tools.mjs`
- Delete: `fleet/tests/test_factory_watch.mjs`
- Delete: `fleet/tests/test_factory_facts.mjs`
- Modify: `fleet/tests/test_factory_worker_gitblock.mjs`
- Modify: `fleet/tests/test_factory_boot.mjs`
- Modify: `factory/questions.json`
- Modify: `factory/policy.json`
- Modify: `fleet/launch.mjs`
- Modify: `fleet/lobby.mjs`

**Claim:** The factory's code, roles, questions, thresholds, replay tools and tests are gone, and a launch that asks for the factory is refused. (derived)
Machine: M1. None of the twenty-one factory-only modules (`engine`, `baseread`, `checks-at-base`, `clone`, `dispatch`, `facts`, `fold`, `hunks`, `judge`, `kprobe`, `measure`, `pairs`, `proofs`, `refold`, `retry`, `reverify`, `select`, `tools`, `union`, `watch`, `worker`, each `factory/<name>.mjs`) nor either role file exists. M2. `factory/replay/` holds no file other than Python bytecode. M3. `factory/questions.json`'s `sets` has exactly one key, `flock_step`. M4. `factory/policy.json`'s top-level keys are exactly `about`, `flock`, `publish` and `version`. M5. `node fleet/launch.mjs <plan> --target a/b --base <40 zeros> --kind factory` exits non-zero and says `unknown flag --kind`. M6. `fleet/tests/test_factory_worker_gitblock.mjs` names `worker.mjs` nowhere and still prints `ALL TESTS PASSED`. M7. `fleet/tests/test_factory_boot.mjs` names `factory/engine.mjs` nowhere. M8. The eight factory-only sims (`referee`, `refold_dispatch`, `retry`, `reverify`, `select`, `tools`, `watch`, `facts`, each `fleet/tests/test_factory_<name>.mjs`) are gone.

**Authorized-by:** map #1292 rule 8; operator pick 2026-09-29 (all factory-only code goes)

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** A reachability trace of base found every file deleted here reachable only from `factory/engine.mjs` (or its `refold.mjs`), and `factory/replay/` has no code users. What stays and must keep working: the Flock (`factory/flock/*`) imports `factory/gitblock.mjs`, `factory/commands.mjs` and `factory/jev-client.mjs` and reads `policy.json`'s `flock` cells and `questions.json`'s `sets.flock_step`; the boot runs `preflight.mjs`, `board.mjs`, `kata-credential.mjs`, `record.mjs` and `audit.mjs` on every run, and `record.mjs` reads `policy.json`'s `publish.self_merge` and `publish.probe` cells. So: in `questions.json` keep `version`, `about` and `sets.flock_step` (rewrite `about` to describe the one set); in `policy.json` keep `version`, `publish` and `flock` and rewrite `about` (drop `chosen` and every other section). The factory's retirement leaves Task 1's `factory/boot.sh` to that task.
`fleet/launch.mjs`: `--kind` (lines ~553–558, `DEFAULT_KIND` at ~1300) becomes an unknown flag refused by name, the same way `--tier` and `--implementer-effort` are (lines ~527–535), before the plan is read; the assignment comment still carries `kind=flock` on every launch (see Global Constraints: an older boot reads a missing `kind` as the factory). `fleet/lobby.mjs` ~500–503 keeps `kind` in the comment key order; fix its comment that says a launch without `--kind` carries no `kind=`.
`fleet/tests/test_factory_worker_gitblock.mjs` mixes two subjects: legs a–c and f–h test `findGit` from `factory/gitblock.mjs` (kept); legs d–e drive `runWorker` from `factory/worker.mjs` (deleted). Drop d–e, their helpers and every line that names `worker.mjs`, comments included. `fleet/tests/test_factory_boot.mjs` leg (d) runs `factory/engine.mjs` with no arguments and expects exit 2: point it at `factory/flock/engine.mjs`, which also exits 2 with no arguments (`engine: --plan is required`); its header comments at lines ~37, ~48 and ~74 name `factory/engine.mjs` and change with it.

**Proof:**
- Run: for f in engine baseread checks-at-base clone dispatch facts fold hunks judge kprobe measure pairs proofs refold retry reverify select tools union watch worker; do test ! -e factory/$f.mjs || exit 1; done && test ! -e factory/roles/implement.md && test ! -e factory/roles/resolve.md [M1]
- Run: test -z "$(find factory/replay -type f ! -name '*.pyc' 2>/dev/null)" [M2]
- Run: python3 -c "import json; s = json.load(open('factory/questions.json'))['sets']; assert sorted(s) == ['flock_step'], sorted(s)" [M3]
- Run: python3 -c "import json; k = sorted(json.load(open('factory/policy.json'))); assert k == ['about', 'flock', 'publish', 'version'], k" [M4]
- Run: ! node fleet/launch.mjs nope.md --target a/b --base 0000000000000000000000000000000000000000 --kind factory > /tmp/kind-refusal.txt 2>&1 && grep -q 'unknown flag --kind' /tmp/kind-refusal.txt [M5]
- Run: ! grep -q 'worker.mjs' fleet/tests/test_factory_worker_gitblock.mjs && node fleet/tests/test_factory_worker_gitblock.mjs | grep -q 'ALL TESTS PASSED' [M6]
- Run: ! grep -q 'factory/engine.mjs' fleet/tests/test_factory_boot.mjs [M7]
- Run: for f in referee refold_dispatch retry reverify select tools watch facts; do test ! -e fleet/tests/test_factory_$f.mjs || exit 1; done [M8]
- Legs: (a) each of the twenty-one modules and both role files is absent [M1]; (b) no non-bytecode file remains under `factory/replay/` [M2]; (c) the question sets are exactly `flock_step` [M3]; (d) the policy's top-level keys are exactly the four named [M4]; (e) the launcher exits non-zero on `--kind factory` and its output names `unknown flag --kind` [M5]; (f) the gitblock sim names no `worker.mjs` and passes [M6]; (g) the boot sim names no `factory/engine.mjs` [M7]; (h) each of the eight sims is absent [M8].

**Stale-if:**
- path-absent: `factory/engine.mjs`

### Task 3: The old merge kernel is gone; Manyana stays, pinned

**Type:** implementation

**Files:**
- Delete: `skills/ultrapowers/kernel/fold_wave.py`
- Delete: `skills/ultrapowers/kernel/repo_weave.py`
- Delete: `skills/ultrapowers/kernel/frontier_fold.py`
- Delete: `skills/ultrapowers/kernel/hunks.py`
- Delete: `skills/ultrapowers/kernel/FOLD_LOG.md`
- Delete: `tests/test_fold_wave_anchor.py`
- Create: `tests/test_vendor_pin.py`
- Modify: `factory/flock/weave.py`
- Modify: `skills/ultrapowers/kernel/vendor/PROVENANCE.md`

**Claim:** The factory's merge kernel is gone, the Flock's weave keeper still answers on its own, and Manyana is unchanged and still pinned. (derived)
Machine: M1. `fold_wave.py`, `repo_weave.py`, `frontier_fold.py`, `hunks.py` and `FOLD_LOG.md` under `skills/ultrapowers/kernel/`, and `tests/test_fold_wave_anchor.py`, do not exist. M2. `printf '%s\n' '{"op":"merged"}' | python3 factory/flock/weave.py` prints a line carrying `"ok": true`. M3. `factory/flock/weave.py` names `fold_wave` nowhere. M4. `skills/ultrapowers/kernel/vendor/manyana.py` still has sha256 `3c8ba319bb286aac0ca8f2d7ac355e2610eafa290d2f1e46c7eb5ff562220004`. M5. `python3 -m pytest -q tests/test_vendor_pin.py` passes, and that file pins the vendor directory's file list and a digest over its tracked bytes, as leg (g) of `tests/test_fold_wave_anchor.py` did.

**Authorized-by:** map #1292 rule 8; operator pick 2026-09-29 (the old merge kernel goes, Manyana stays)

**Interfaces:**
- Consumes: none
- Produces: `run_on_kernel_thread(fn, *args, **kwargs)`

**Context:** `factory/flock/weave.py` imports `fold_wave` (line ~41) only to call `fold_wave.run_on_kernel_thread(serve)` at the bottom (~543): it runs the server on a thread with a 1 GiB stack and a raised recursion limit (`THREAD_RECURSION_LIMIT` in `fold_wave.py`), because Manyana recurses deeply on large files. Move that helper and its constant into `weave.py` as they are, and import only `manyana` (from `kernel/vendor`, as now). Importing `fold_wave` also loaded `repo_weave`, `frontier_fold` and `hunks`; nothing else outside the factory used any of them (the factory's `fold.mjs`, deleted by a sibling, was the CLI's only caller). No line of `weave.py` may name `fold_wave`, comments included. Keep `skills/ultrapowers/kernel/__init__.py` and `vendor/`.
The vendor pin lives today in `tests/test_fold_wave_anchor.py` leg (g): `FROZEN_VENDOR_FILES` (`vendor/PROVENANCE.md`, `vendor/manyana.py`) and `FROZEN_VENDOR_DIGEST`, a digest over those tracked files' bytes. Move it into `tests/test_vendor_pin.py`. `vendor/PROVENANCE.md` says the pin lives in `tests/test_fold_wave_anchor.py` M7 leg (g): point it at the new file. Editing PROVENANCE.md changes the digest, so recompute `FROZEN_VENDOR_DIGEST` in the same change, as its re-vendoring procedure says. `manyana.py` itself is never edited (its sha256 is M4's literal, read at base).

**Proof:**
- Run: for f in fold_wave.py repo_weave.py frontier_fold.py hunks.py FOLD_LOG.md; do test ! -e skills/ultrapowers/kernel/$f || exit 1; done && test ! -e tests/test_fold_wave_anchor.py [M1]
- Run: printf '%s\n' '{"op":"merged"}' | python3 factory/flock/weave.py | grep -q '"ok": true' [M2]
- Run: ! grep -q fold_wave factory/flock/weave.py [M3]
- Run: python3 -c "import hashlib; h = hashlib.sha256(open('skills/ultrapowers/kernel/vendor/manyana.py', 'rb').read()).hexdigest(); assert h == '3c8ba319bb286aac0ca8f2d7ac355e2610eafa290d2f1e46c7eb5ff562220004', h" [M4]
- Run: python3 -m pytest -q tests/test_vendor_pin.py [M5]
- Legs: (a) each of the five kernel files and the old test is absent [M1]; (b) the weave keeper answers `"ok": true` to a `merged` request [M2]; (c) `weave.py` has no `fold_wave` [M3]; (d) Manyana's sha256 is the pinned value [M4]; (e) the new pin test passes, and the reader checks it pins the file list and the digest [M5].

**Stale-if:**
- path-absent: `skills/ultrapowers/kernel/fold_wave.py`

### Task 4: The docs describe one engine

**Type:** implementation

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md`
- Modify: `fleet/CONTRACT.md`
- Modify: `fleet/RUNBOOK.md`
- Modify: `.claude/rules/factory.md`
- Modify: `skills/ultrapowers/SKILL.md`
- Modify: `skills/ultrawrite/SKILL.md`
- Modify: `hooks/session_start.sh`

**Claim:** Someone reading the docs learns there is one engine, the Flock, how a run catches up to a moved main, and nothing about launching the factory. (derived)
Machine: M1. None of `CLAUDE.md`, `README.md`, `fleet/CONTRACT.md`, `fleet/RUNBOOK.md`, `.claude/rules/factory.md`, `skills/ultrapowers/SKILL.md`, `skills/ultrawrite/SKILL.md` or `hooks/session_start.sh` names `factory/engine.mjs`, `fold_wave`, `repo_weave` or `frontier_fold`. M2. `CLAUDE.md` does not offer `--kind`. M3. `fleet/CONTRACT.md` names `factory/flock/catchup.mjs` as what the boot runs to catch a run up to a moved main. M4. `CLAUDE.md`'s Purpose says the Flock is the one engine and that the factory was retired under map #1292 rule 8, with its rollback: a launch run from a checkout made before the retirement.

**Authorized-by:** map #1292 rule 8; operator pick 2026-09-29

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** What is true after this run (the sibling tasks make it so): the boot always runs `factory/flock/engine.mjs`; an assignment with no `kind=` boots the Flock and `kind=factory` is refused; the launcher refuses `--kind` and still writes `kind=flock`; the factory's modules, roles, question sets (all but `flock_step`), policy sections (all but `publish` and `flock`), replay tools and sims are gone; the old kernel's `fold_wave.py`, `repo_weave.py`, `frontier_fold.py`, `hunks.py` and `FOLD_LOG.md` are gone, Manyana (`skills/ultrapowers/kernel/vendor/manyana.py`) stays with its pin in `tests/test_vendor_pin.py`; a run that finishes after main moved runs `factory/flock/catchup.mjs` (same argv and last-line JSON as the old `--refold`), which joins the run's work onto the new main through the weave keeper, re-runs the plan's setup, probes and check with `ULTRA_BASE` set to the new main, and on a conflict or a red check leaves the run's commit alone, so the boot opens a draft.
Where the docs say otherwise today (a trace at base): `CLAUDE.md` lines ~16–22 (two engines, `DEFAULT_KIND`), ~38 (`--kind factory` in the launch command), the Layout's kernel bullet, the "One merge, one writer" doctrine line (the fold kernel, `fold_wave`'s patches against BASE) and ~136–139; `README.md` ~96; `fleet/CONTRACT.md` ~64, ~83, ~108–109 (`kind=` absent means factory), ~299–307 (the re-fold via `factory/engine.mjs`, the engine unit's argv); `fleet/RUNBOOK.md` ~27 and its `fold_wave` mention; `.claude/rules/factory.md` ~6–9 (titled the factory engine, never names the Flock); `skills/ultrapowers/SKILL.md` ~17–18 and ~235–236; `skills/ultrawrite/SKILL.md` ~588 ("On the factory an author writes no ordering") and ~650; `hooks/session_start.sh` ~10 (a comment). Change what names retired code or the choice of engine; leave the operator's doctrine and values as they are, and keep history (a run number, a reading) marked as history.

**Proof:**
- Run: ! grep -qE 'factory/engine\.mjs|fold_wave|repo_weave|frontier_fold' CLAUDE.md README.md fleet/CONTRACT.md fleet/RUNBOOK.md .claude/rules/factory.md skills/ultrapowers/SKILL.md skills/ultrawrite/SKILL.md hooks/session_start.sh [M1]
- Run: ! grep -q -- '--kind' CLAUDE.md [M2]
- Run: grep -q 'factory/flock/catchup.mjs' fleet/CONTRACT.md [M3]
- Legs: (a) none of the eight files names any of the four retired names [M1]; (b) `CLAUDE.md` carries no `--kind` [M2]; (c) the contract names `factory/flock/catchup.mjs`, and the reader checks it is named as the catch-up the boot runs [M3]; (d) the reader checks the Purpose paragraph against M4 in the hunk [M4].

**Stale-if:**
- path-absent: `factory/flock/engine.mjs`
