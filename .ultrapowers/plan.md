# Fold-again residuals: the comments, the two unread behaviours, the sibling spawns

**Grammar:** claims-v1

**Claim:** The fold-again comments say what the code does, the two behaviours nobody read are pinned by a sim that fails without them, and the merge sim stops running its siblings. (elicited)

**Goal:** Close the three residuals #801 left behind PR #800 (run-68's fold that folds again until its PUT is accepted), in one run: reword the four comments and the usage string that still describe the retired "two attempts" shape (#807), pin the `do_deadman` widening and the `FOLD_AGAIN_WAIT` boundary with legs that are red without them (#808), and take the two sibling-sim spawns out of `fleet/tests/test_sandbox_boot_merge.mjs` (#809). Behaviour of `fleet/sandbox-boot.sh` is unchanged by every task here. Three choices were made in place of a question, each the least machinery that keeps the contract: (1) #808 and #809 are two tasks in one wave, not one — they are independent contracts on one file whose regions are line-disjoint (the deadman and fold-again sections against the file's tail), and same-file text folds at the kernel; one task would serialise nothing and would carry two Claims under one hash. (2) The injectable clock advances **per fold unit** — the `systemd-run` stub's `fleet-fold-*` arm adds `STUB_CLOCK_STEP` seconds to a clock file the `date` stub reads — not per `date +%s` call, because the boot reads `date +%s` in three unrelated poll loops (`await_branch_visible`, `merge_pr`'s check poll) whose call counts are not a contract, while "one tick per fold" is the shape the clause names ("outlasts it across two folds"). (3) The deadman negative is an in-exam mutant — the exam copies `fleet/sandbox-boot.sh` with the `case "$phase_now"` block removed and runs `deadman` against the copy — rather than a `Run:` that re-runs the whole sim against a mutated tree: the deadman needs no boot, so the negative costs one bash invocation, and the script has no self-reference (`$0`, `BASH_SOURCE`) so a copy runs identically.
**Closes:** #807 #808 #809

**Tech Stack:** bash (`fleet/sandbox-boot.sh`), Node ESM sims under `fleet/tests/` driven by `python3 -m pytest tests/test_fleet_suite.py` (300 s per file, `ALL TESTS PASSED` sentinel), the stub rig `fleet/tests/_sandbox_boot_helpers.mjs`.

**Spec:** none — authored from #807, #808 and #809; each issue's `## Desired state` paragraph is the task's claim material.

**Parallelization rationale:** one wave, width 3. Task 1 (#807) touches comments in three files; Task 2 (#808) modifies the rig and extends the merge sim; Task 3 (#809) deletes the merge sim's tail. All three write `fleet/tests/test_sandbox_boot_merge.mjs`, in line-disjoint regions (the rig banner at ~724; the deadman and fold-again sections; the `(i)(j)` block at the file's end), so the overlap is text and folds. No task consumes another's runtime behaviour, so no chain.

## Global Constraints

- `fleet/sandbox-boot.sh` changes only in comment lines — no task here alters what the boot script does.
- Check: t=$(mktemp) && git show $ULTRA_BASE:fleet/sandbox-boot.sh | grep -v '^ *#' > "$t" && grep -v '^ *#' fleet/sandbox-boot.sh | diff "$t" -
- No sim under `fleet/tests/` starts another `fleet/tests/test_*.mjs` as a child process; a sibling sim is graded by its own `tests/test_fleet_suite.py` row.
- The rig's `date` stub is transparent to every caller but the epoch read: any argv other than `+%s` is handed to the real `date`, so status pages, log stamps and the stubs' own `say` prelude are unchanged.
- Every new exam leg sits in the existing behaviour-surface file `fleet/tests/test_sandbox_boot_merge.mjs`, beside the case it extends, under a comment naming its task.

**Acceptance:** suite — the committed suite is the verification.

### Task 1: The fold-again comments describe the unbounded shape

**Type:** implementation

**Files:**
- Modify: `fleet/publish-fold.mjs`
- Modify: `fleet/sandbox-boot.sh`
- Modify: `fleet/tests/test_sandbox_boot_merge.mjs`

**Claim:** Every comment naming a count of two fold attempts in those three files describes the unbounded fold-again shape, and `publish-fold.mjs`'s usage string reads `--attempt <n>`. (quoted from #807)
Machine: M1. `fleet/publish-fold.mjs` carries the string `attempt 1|2` on no line and the string `1 or 2` on no line, and its exported `usage()` string carries `--attempt <n>`.
M2. `fleet/sandbox-boot.sh` carries the string `attempt 2's fold floors` on no line, the string `retry's own note` on no line, and the string `A second attempt lands` on no line.
M3. `fleet/tests/test_sandbox_boot_merge.mjs` carries the string `the FIRST PUT` on no line and the string `the second, default 200` on no line.
M4. The non-comment lines of `fleet/sandbox-boot.sh` are byte-identical to BASE's, and `python3 -m pytest tests/test_fleet_suite.py -k sandbox_boot_merge` passes.

**Authorized-by:** #807 (residual of #801, PR #800)

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** Prose only; every behaviour named below is already what the code does, and the comments are the specification of record for these files, which is why they are corrected rather than deleted. At BASE `3fb782b6` the five sites are: `fleet/publish-fold.mjs` line 284 (` *   attempt      1 or 2` in the doc comment of the fold function) and line 965 (the usage string `'--run-dir DIR --evidence-dir DIR --attempt 1|2'` — `parseArgs` applies no range check and `priorKeys`/`floor` handle any N; `sandbox-boot.sh`'s fold-again loop dispatches `--attempt 3`, `4`, …); `fleet/sandbox-boot.sh` lines 215–217 (`FOLD_ATTEMPTS`'s comment: "A second attempt lands its disposition AFTER the PR was opened, which is what makes the body PATCH necessary" — true of every fold-again, not only the second attempt), line 1062 (`fold_hold_note`'s comment: "the third is answered by the retry's own note" — the note is now `the fold moved nothing`, written by `do_boot`'s loop on a `tip unmoved` disposition), lines 1157–1161 (`push_head`'s header: "attempt 2's fold floors on attempt 1's candidate … the lease attempt 2 pushes under" — now attempt N floors on attempt N−1's candidate and the lease is read for every attempt from `fold_receipt pushed` / `fold_field <attempt> pushedHead`); and `fleet/tests/test_sandbox_boot_merge.mjs` lines 724–725 (the rig banner: "`STUB_MERGE_CODE` (the FIRST PUT) and `STUB_MERGE_CODE_2` (the second, default 200)" — `STUB_MERGE_CODE` is a space-separated list answering PUT n with its n-th code, the last code repeating, and `STUB_MERGE_CODE_2` overrides the second only; the fold-again banner further down the same file states this correctly). The rig banner is a comment in a file two sibling tasks also edit; this task's edit is those two lines and nothing else in that file. `grep -c` prints `0` and exits 1 on no match, so each leg wraps it in `test "$(…)" = 0`. The byte pin filters whole-line comments (`^ *#`) from both trees — the three boot-script sites are whole-line comments, so the code lines must compare equal. No test under `tests/` or `fleet/tests/` pins any of the reworded literals (checked with `git grep` at BASE: the only hits are the sites themselves).

**Proof:**
- Run: test "$(grep -c 'attempt 1|2' fleet/publish-fold.mjs)" = 0
- Run: test "$(grep -c '1 or 2' fleet/publish-fold.mjs)" = 0
- Run: node -e "import('./fleet/publish-fold.mjs').then(m => process.exit(m.usage().includes('--attempt <n>') && !m.usage().includes('1|2') ? 0 : 1))"
- Run: test "$(grep -c "attempt 2's fold floors" fleet/sandbox-boot.sh)" = 0
- Run: test "$(grep -c "retry's own note" fleet/sandbox-boot.sh)" = 0
- Run: test "$(grep -c 'A second attempt lands' fleet/sandbox-boot.sh)" = 0
- Run: test "$(grep -c 'the FIRST PUT' fleet/tests/test_sandbox_boot_merge.mjs)" = 0
- Run: test "$(grep -c 'the second, default 200' fleet/tests/test_sandbox_boot_merge.mjs)" = 0
- Run: t=$(mktemp) && git show $ULTRA_BASE:fleet/sandbox-boot.sh | grep -v '^ *#' > "$t" && grep -v '^ *#' fleet/sandbox-boot.sh | diff "$t" -
- Run: python3 -m pytest tests/test_fleet_suite.py -k sandbox_boot_merge -q
- Legs: (a) the first `Run:` exits 0 — no line of `fleet/publish-fold.mjs` carries `attempt 1|2` [M1]; (b) the second exits 0 — no line carries `1 or 2` [M1]; (c) the third exits 0 — the exported `usage()` itself, imported and called, returns a string carrying `--attempt <n>` and not `1|2`, so a comment cannot satisfy it [M1]; (d) the fourth exits 0 — no line of `fleet/sandbox-boot.sh` carries `attempt 2's fold floors` [M2]; (e) the fifth exits 0 — no line carries `retry's own note` [M2]; (f) the sixth exits 0 — no line carries `A second attempt lands` [M2]; (g) the seventh exits 0 — no line of the merge sim carries `the FIRST PUT` [M3]; (h) the eighth exits 0 — no line carries `the second, default 200` [M3]; (i) the ninth exits 0 — `diff` of the comment-stripped BASE file (`git show $ULTRA_BASE:…`, the driver sets `$ULTRA_BASE` to the run's base sha in every `Run:`'s environment) against the comment-stripped tree file is empty, so no code line of the boot script moved [M4]; (j) the tenth exits 0 — the merge sim passes under the bridge [M4].

**Stale-if:**
- issue-closed: #807
- path-absent: `fleet/publish-fold.mjs`
- path-absent: `fleet/sandbox-boot.sh`

### Task 2: The deadman widening and the fold-again window are pinned under an injectable clock

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/tests/_sandbox_boot_helpers.mjs`
- Test: `fleet/tests/test_sandbox_boot_merge.mjs`

**Claim:** The boot sim carries (a) one deadman scenario whose seeded `www/status.json` has `phase: 'publish fold (attempt 4)'` and `STUB_FOLD_ACTIVE: 'active'`, asserting `stop fleet-fold-7-3.service` and `stop fleet-fold-7-4.service` appear in `argvLines(ctx, 'systemctl')` — and its negative: with the `phase_now` block removed the leg is red; and (b) an injectable clock in `fleet/tests/_sandbox_boot_helpers.mjs` (a `date` stub the rig advances) so one case sets a small nonzero `FLEET_FOLD_AGAIN_WAIT`, outlasts it across two folds, and asserts the `after <N>s of folding again` note — the boundary measured, not the two ends. (quoted from #808)
Machine: M1. A `deadman` invocation of `fleet/sandbox-boot.sh` over a seeded page `{run: '7', state: 'running', phase: 'publish fold (attempt 4)'}` with `STUB_ENGINE_ACTIVE=active` and `STUB_FOLD_ACTIVE=active` exits 0 and records in the rig's `systemctl` argv log (`argvLines(ctx, 'systemctl')`) one `systemctl --user stop fleet-fold-7-<n>.service` for each n of 1, 2, 3 and 4, and no stop for any other `fleet-fold-7-` unit.
M2. The same invocation against a copy of `fleet/sandbox-boot.sh` from which the `case "$phase_now" in … esac` block of `do_deadman` has been removed exits 0, records the stops for `fleet-fold-7-1` and `fleet-fold-7-2`, and records no stop for `fleet-fold-7-3` and none for `fleet-fold-7-4`.
M3. The rig's `date` stub answers argv `+%s` with the real epoch plus the integer in `$FLEET_HOME/stub/clock` (0 when absent), hands any other argv to the real `date` unchanged, and the `systemd-run` stub's `fleet-fold-*` arm adds `STUB_CLOCK_STEP` seconds (default 0) to that file once per fold unit.
M4. A boot with `STUB_MERGE_CODE='405 405 405 405 200'`, `STUB_MERGE_MESSAGE='Base branch was modified'`, `FLEET_FOLD_AGAIN_WAIT=1000` and `STUB_CLOCK_STEP=600` runs exactly the three fold units `fleet-fold-7-1`, `fleet-fold-7-2`, `fleet-fold-7-3`, issues exactly three merge PUTs, and its `done` page's phase carries `left open: merge PUT answered 405 after 1000s of folding again`.

**Authorized-by:** #808 (residual of #801, PR #800; the reviewer's two "unverified" behaviours)

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** Both behaviours already exist in `fleet/sandbox-boot.sh` at BASE `3fb782b6`; this task changes only the rig and adds legs — the boot script is not in its Files. The widening: `do_deadman` (lines 2318–2370) reads `phase` off the page before overwriting it, and when it matches `publish fold (attempt <n>)` sets `folds=<n>` (floor 2), then stops `fleet-engine-7` and `fleet-fold-7-1 … -<folds>` for every unit `systemctl --user is-active` answers `active*`; the `systemctl` stub answers `is-active fleet-fold-*` with `STUB_FOLD_ACTIVE` and `fleet-engine-*` with `STUB_ENGINE_ACTIVE`. The block M2 removes is exactly the lines `phase_now="$(read_status_field phase)"` through the following `esac` (lines 2336–2341); the floor line `[ "$folds" -ge 2 ] 2>/dev/null || folds=2` stays, which is why the mutant still stops units 1 and 2. The existing `deadmanOverFold` case in the merge sim (~line 1114) is the pattern for M1: `makeHome()`, write `www/status.json` by hand (no boot needed — the deadman reads `run`, `state`, `phase`, `pr`, `prAuthor`, `merged`, `startedAt`, `vm` off the page), then `gatedBoot(ctx, ['deadman'], env)`; it seeds `phase: 'publish fold'` and lands on the `folds=2` floor, which is why it cannot see the widening. The rig needs one seam for M2: a way to run a script other than `SCRIPT` — an optional trailing `script` argument on `boot` and `bootAsync` in the helpers, defaulting to `SCRIPT`, is the least of it (the boot script has no `$0`/`BASH_SOURCE` self-reference, so a copy under `ctx.home` runs identically). The clock: `FLEET_BIN_DIR` is prefixed to `PATH` by the boot script (line 63–66), so a file named `date` in the stub bin dir is what every `date` call resolves to — the boot's `now_iso` (`date -u +%Y-%m-%dT%H:%M:%SZ`), its `log` stamps, and the stubs' own `say` prelude (`date -u +%H:%M:%SZ`) included. Two harness facts follow: the `date` stub must not call `say` or `argv` (the prelude's `say` calls `date`, which would recurse), and it must exec the real binary by absolute path (`/bin/date "$@"`) for every argv but `+%s`, because `command -v date` would find the stub. Precedent: `fleet/tests/test_setup_script.mjs` ~line 273 writes a darwin-only `date` shim of exactly this shape. The boot reads `date +%s` in `merge_pr` (`FOLD_AGAIN_SINCE="$(date +%s)"` on the first base-moved 405; `[ $(( $(date +%s) - FOLD_AGAIN_SINCE )) -ge $FOLD_AGAIN_WAIT ]` on each later one), and also as `t0` in `await_branch_visible` and the check poll — those loops read a constant offset because the clock advances only inside a fold unit, which never runs concurrently with them. The `systemd-run` stub's `fleet-fold-*` arm (helpers ~line 429) already writes `$FLEET_HOME/stub/fold-2` per unit; the tick is one more line there, and attempts 3 and 4 take its `else` branch (`STUB_FOLD_CODE` / `STUB_FOLD_DISPOSITION`, default `folded`) exactly as the existing `foldAgainFour` case (`STUB_MERGE_CODE: '405 405 405 200'`, four units) relies on. M4's arithmetic, computed: fold unit 1 (the publish fold) ticks the clock to 600 before the first PUT, so `FOLD_AGAIN_SINCE = r0 + 600`; fold 2 ticks to 1200 and PUT 2 measures `600 + Δ` seconds (Δ = real seconds between the PUTs, single digits to tens here) — under 1000, so the run folds again; fold 3 ticks to 1800 and PUT 3 measures `1200 + Δ` ≥ 1000, so `merge_pr` logs `PUT answered 405 after 1000s of folding again` and returns without raising `FOLD_AGAIN`: three units, three PUTs. The leg therefore establishes the window lies in `(600 + Δ, 1200 + Δ]` — an interval around the boundary rather than its two ends — which is what a real clock can measure; a defect that mis-measures elapsed seconds either trips at PUT 2 (two units) or never trips (the stub's fifth code merges after five units), and both are red against "exactly three". The stub's fifth code `200` is the backstop that makes "never trips" terminate. `STUB_MERGE_CODE` is a list answering PUT n with its n-th code, the last repeating; `Base branch was modified` is the lowercased-`case` arm `*"base branch was modified"*` in `merge_pr`. The existing `foldAgainWindowClosed` case (`FLEET_FOLD_AGAIN_WAIT: '0'`, two PUTs) and `foldAgainFour` (default 3600, four units) are the two ends the issue names; the new case sits beside them, after `foldAgainWindowClosed`'s test, and the deadman case sits directly after `deadmanOverFold`'s test — never at the file's tail, where a sibling task in this wave deletes the `(i)(j)` block, so the two edits stay non-adjacent. The merge sim throttles boots through `gatedBoot` (`WIDTH = 3`), and a new boot registers with `bootWith`/`started` like every other. Group the new legs under a comment naming this task (`#808`). The merge sim ran 128.9 s under `python3 -m pytest tests/test_fleet_suite.py -k sandbox_boot_merge -q` at BASE on the authoring laptop against the bridge's 300 s cap; this task adds one boot and two deadman invocations.

**Proof:**
- Test: `fleet/tests/test_sandbox_boot_merge.mjs`
- Guard: `fleet/tests/test_sandbox_boot_merge.mjs`
- Run: python3 -m pytest tests/test_fleet_suite.py -k sandbox_boot_merge -q
- Run: python3 -m pytest tests/test_fleet_suite.py -k 'sandbox_boot_exams or sandbox_boot_selfmerge or sandbox_boot_edges' -q
- Legs: (a) a deadman over the seeded `publish fold (attempt 4)` page with both `active` knobs exits 0 and `argvLines(ctx, 'systemctl')` holds `systemctl --user stop fleet-fold-7-3.service` and `systemctl --user stop fleet-fold-7-4.service`, beside the stops for `-1`, `-2` and `fleet-engine-7`, and the stop lines naming `fleet-fold-7-` are exactly those four — a fifth, such as `fleet-fold-7-5`, is absent [M1]; (b) the same seeded deadman run against the mutant copy — the `case "$phase_now"` block cut from `do_deadman`, written under `ctx.home` and run through the rig's script seam — exits 0, holds the stops for `-1` and `-2`, and holds no stop line naming `fleet-fold-7-3` and none naming `fleet-fold-7-4` [M2]; (c) invoked directly under the rig's `PATH` with `FLEET_HOME` set: with no clock file, `date +%s` answers within 5 s of `Date.now()/1000`; with `$FLEET_HOME/stub/clock` written as `600` by the case, it answers within 5 s of `Date.now()/1000 + 600`; and `date -u +%Y-%m-%dT%H:%M:%SZ` answers a string matching `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$` [M3]; (d) after the M4 boot `$FLEET_HOME/stub/clock` reads `1800` — three fold units at 600 each — and after a `foldAgainFour`-shaped boot with `STUB_CLOCK_STEP` unset, `date +%s` under that home's `PATH` answers within 5 s of `Date.now()/1000` [M3]; (e) the M4 boot's `unitsRun(ctx)` fold units are exactly `fleet-fold-7-1`, `fleet-fold-7-2`, `fleet-fold-7-3` — no `fleet-fold-7-4` — and its merge PUTs number exactly three [M4]; (f) its `done` page's `phase` includes `left open: merge PUT answered 405 after 1000s of folding again`, and the last `publish:merge` event's `detail` is `merge PUT answered 405 after 1000s of folding again` [M4]; (g) the first `Run:` exits 0 — the merge sim passes under the bridge with the new legs [M1]; (h) the second `Run:` exits 0 — the three sibling sims that share the rig still pass with the `date` stub and the script seam in it [M3].

**Stale-if:**
- issue-closed: #808
- path-absent: `fleet/tests/_sandbox_boot_helpers.mjs`
- path-absent: `fleet/sandbox-boot.sh`

### Task 3: The merge sim spawns no sibling sim

**Type:** implementation

**Files:**
- Modify: `fleet/tests/test_sandbox_boot_merge.mjs`

**Claim:** `fleet/tests/test_sandbox_boot_merge.mjs` spawns no sibling sim; legs (i)(j) are graded by the two sibling files' own suite runs (already in the bridge). (quoted from #809)
Machine: M1. No line of `fleet/tests/test_sandbox_boot_merge.mjs` carries the word `spawn`, no line carries `test_sandbox_boot_exams.mjs` or `test_sandbox_boot_selfmerge.mjs`, `node:child_process` is imported on exactly one line, `spawnSync(` occurs on exactly two lines — the `bash -n` syntax check of `SCRIPT` and the direct call of the rig's own `systemctl` stub (`spawnSync(path.join(ctx.bin, 'systemctl')`) — and no line carries `execSync`, `execFile`, `exec(` or `fork(` — so the file has no child-process route to a sibling sim.
M2. `python3 -m pytest tests/test_fleet_suite.py -k 'sandbox_boot_exams or sandbox_boot_selfmerge' -q` passes — the two siblings are graded by their own bridge rows — and `python3 -m pytest tests/test_fleet_suite.py -k sandbox_boot_merge -q` passes.
M3. `node fleet/tests/test_sandbox_boot_merge.mjs` exits 0 and prints the line `ALL TESTS PASSED` on stdout — both, under `pipefail` — and its wall is printed beside it by bash's `time`.

**Authorized-by:** #809 (residual of #801, PR #800; #612's test-ballast doctrine)

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** At BASE `3fb782b6` the block to delete is the file's tail: the `// ── (i)(j) the two other boot sims still pass on the changed rig  [M6]` banner (~line 2246), `const PASSED`, `runSim`, `assertSimPassed` and the `for (const [tag, file] of [['(i)', 'test_sandbox_boot_exams.mjs'], ['(j)', 'test_sandbox_boot_selfmerge.mjs']])` loop, ending just above `runTests(tests)` (line 2288); plus `spawn` in the `import { spawn, spawnSync } from 'node:child_process'` line (61). `spawnSync` is still used at line 255 (`bash -n` over the script). The file's header comment (M8, ~line 702) already says re-running the siblings "proved nothing the suite does not" — leave it; only the banner text of the deleted block goes with the block. Both siblings are their own rows of `tests/test_fleet_suite.py` (`collect_sims` globs every `fleet/tests/test_*.mjs`), which is what "already in the bridge" means. The wall: the merge sim ran 128.9 s at BASE under `python3 -m pytest tests/test_fleet_suite.py -k sandbox_boot_merge -q` on the authoring laptop (the issue's own reading was ~49 s + ~38 s of spawns on a different box); the drop the issue asks for (≥ 30 s) is a reading recorded on the run's evidence — the `time` line of the third `Run:` — and compared in the PR body against 128.9 s, never a `Run:` assertion on time, because a wall depends on the box. Two sibling tasks in this wave also edit this file, at the rig banner (~line 724) and beside `deadmanOverFold` / `foldAgainWindowClosed`; this task's deletion is the tail only, so the edits stay non-adjacent and fold. `grep -c` prints `0` and exits 1 on no match, so each grep leg wraps it in `test "$(…)" = 0`; `grep -w spawn` does not match `spawnSync`.

**Proof:**
- Run: test "$(grep -cw spawn fleet/tests/test_sandbox_boot_merge.mjs)" = 0
- Run: test "$(grep -c 'test_sandbox_boot_exams.mjs' fleet/tests/test_sandbox_boot_merge.mjs)" = 0
- Run: test "$(grep -c 'test_sandbox_boot_selfmerge.mjs' fleet/tests/test_sandbox_boot_merge.mjs)" = 0
- Run: test "$(grep -c 'node:child_process' fleet/tests/test_sandbox_boot_merge.mjs)" = 1
- Run: test "$(grep -c 'spawnSync(' fleet/tests/test_sandbox_boot_merge.mjs)" = 2
- Run: grep -q "spawnSync('bash', \['-n', SCRIPT\]" fleet/tests/test_sandbox_boot_merge.mjs
- Run: grep -q "spawnSync(path.join(ctx.bin, 'systemctl')" fleet/tests/test_sandbox_boot_merge.mjs
- Run: test "$(grep -cE 'execSync|execFile|exec\(|fork\(' fleet/tests/test_sandbox_boot_merge.mjs)" = 0
- Run: python3 -m pytest tests/test_fleet_suite.py -k 'sandbox_boot_exams or sandbox_boot_selfmerge' -q
- Run: python3 -m pytest tests/test_fleet_suite.py -k sandbox_boot_merge -q
- Run: bash -o pipefail -c 'time node fleet/tests/test_sandbox_boot_merge.mjs | grep -c "ALL TESTS PASSED"'
- Legs: (a) the first `Run:` exits 0 — no line of the merge sim carries the word `spawn` [M1]; (b) the second and third exit 0 — no line names either sibling sim file [M1]; (c) the fourth through eighth exit 0 — one `node:child_process` import line, exactly two `spawnSync(` lines and they are `spawnSync('bash', ['-n', SCRIPT]` and `spawnSync(path.join(ctx.bin, 'systemctl')`, and no `execSync`/`execFile`/`exec(`/`fork(` anywhere, so no constructed path can reach a sibling [M1]; (d) the ninth exits 0 — both siblings pass on their own bridge rows [M2]; (e) the tenth exits 0 — the merge sim passes under the bridge without the two cases [M2]; (f) the eleventh exits 0 under `pipefail` — so `node` itself exited 0 AND `grep -c` found the sentinel (its output carries `1`) — and a `real` line from `time` is in its output: the sim passes and its wall is on the record for the PR body [M3].

**Stale-if:**
- issue-closed: #809
- path-absent: `fleet/tests/test_sandbox_boot_merge.mjs`
