# The sandbox-boot merge sim runs in under a minute

**Grammar:** claims-v1

**Claim:** The sandbox-boot merge sim finishes in under a minute on a four-core box, its legs drive the boot script directly instead of nesting other sims, and the full suite's longest pole is no longer this file. (elicited)

**Goal:** #768 (map #766, the Exam Lifecycle's first pruning candidate). Measured on the laptop
on 2026-09-08 at BASE `9395cd1`: `fleet/tests/test_sandbox_boot_merge.mjs` takes 307 s — 98 s
of its own 73 legs, run one after another through a synchronous `boot()`, and 208 s of leg (j)
re-running seven sibling sims as subprocesses. `tests/test_fleet_suite.py` sets its per-file
hang cap at 300 s to clear this one file, and under `-n auto` it is the floor of every full-suite
pass (four passes per run). After this run the file boots its scenarios concurrently, spawns no
`test_*.mjs`, prints the same 73 legs, and the suite bridge's comments name the sim that is
now the longest.
**Closes:** #768

**Tech Stack:** Node 22 ESM sims (`fleet/tests/*.mjs`) over the shared rig
`fleet/tests/_sandbox_boot_helpers.mjs`, which stubs `curl`/`git`/`gh`/`systemd-run`/`systemctl`
through a PATH shim and drives `fleet/sandbox-boot.sh` with `spawnSync`; the suite is
`python3 -m pytest` from the repo root, which bridges every `fleet/tests/test_*.mjs` through
`tests/test_fleet_suite.py` under `-n auto`.

**Parallelization rationale:** one task, width 1. The concurrent scenario boots, the rig's
async variant of `boot` that makes them possible, the deletion of the nested seven, and the
two comments that describe the old shape are one contract over four files, and the exam is
the one clock run that measures the whole. A second task would own nothing the first does
not need in the same patch. No chain.

## Global Constraints

- Check: `git diff --quiet $ULTRA_BASE -- fleet/run-engine.mjs fleet/run-main.mjs fleet/publish-fold.mjs fleet/publish-fold-block.mjs fleet/sandbox-boot.sh fleet/CONTRACT.md`
- Check: `bash -n fleet/sandbox-boot.sh`
- The boot script, the engine and the folder are untouched: this plan changes what the merge
  sim does with `fleet/sandbox-boot.sh`, never the script — every leg still boots it with the
  rig's stubs and `FLEET_POLL_SECONDS=0`, and no new environment knob is read by the script.
- The rig grows beside its BASE exports rather than through them: what a sibling sim imports
  today keeps its meaning, and a sibling that registers only synchronous tests is not asked
  to change.
- No sim compares the tree to BASE, reads `ULTRA_BASE`, or embeds a commit sha.

**Acceptance:** suite — the committed suite is the verification.


### Task 1: The merge sim boots its scenarios side by side and nests nothing

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/tests/test_sandbox_boot_merge.mjs`
- Modify: `fleet/tests/_sandbox_boot_helpers.mjs`
- Modify: `fleet/tests/test_sandbox_boot.mjs`
- Modify: `tests/test_fleet_suite.py`

**Claim:** `node fleet/tests/test_sandbox_boot_merge.mjs | grep -q 'ALL TESTS PASSED'` completes in under 60 s on a 4-vCPU box: each leg drives `fleet/sandbox-boot.sh` (or its functions) directly with the PATH shims, no leg spawns another `test_*.mjs` file, and legs that share no fixture run concurrently (`Promise.all` over independent legs, one temp dir each). The legs' assertions are unchanged — same claims, same shims, same ALL TESTS PASSED sentinel; the byte-pins other plans hold on this file's output lines (if any) are listed and kept. `tests/test_fleet_suite.py`'s 300 s comment is updated to name the new longest pole. (quoted from #768)
Machine: M1. `timeout 60 node fleet/tests/test_sandbox_boot_merge.mjs`, run alone in a clone on
a box of four or more cores, exits 0 and its stdout carries the line `ALL TESTS PASSED`; the
wall in whole seconds, printed beside it, is below 60. M2. No line of the merge sim outside a
comment (a line whose first non-blank characters are `//`, `/*` or `*`) contains a path
matching `test_[a-z_]*\.mjs`; neither the merge sim nor the rig contains `process.execPath`,
`process.argv[0]`, the quoted word 'node' or a `readdir` call; the only `child_process`
names either file imports are `spawn` and `spawnSync`, and every `spawn`/`spawnSync` call in
either file — there is no `execFile`, `execFileSync`, `execSync` or `fork` call — has as its
first argument the literal `'bash'` or `path.join(ctx.bin, …)`: the two files start the boot
script and the stubs on the PATH shim and nothing else. M3. The sim's stdout holds exactly 73 lines beginning `ok (`, none of which contains
`still passes on the shared rig`. M4. Row by row, the number of the sim's `ok (` lines
containing a leg tag is the number beside that tag in this table of 27 rows:
[leg (l)] 1, [legs (a)–(m)] 1, [M1 / leg (a)] 1, [M1 / leg (b)] 4, [M2 / leg (c)] 1,
[M2 / leg (d)] 1, [M1] [M2] / leg (e)] 3, [M2 / leg (f)] 1, [M2 / leg (g)] 1,
[M1] [M2] / leg (m)] 2, [M3 / leg (h)] 1, [M3 / leg (i)] 1, [M3] [M4] / leg (j)] 2,
[M4 / leg (k)] 3, [M5] 3, [M6] 3, [M7] 1, [publish-fold M1 / leg (a)] 8,
[publish-fold M2 / leg (b)] 6, [publish-fold M2 / leg (i)] 1, [publish-fold M3 / leg (c)] 3,
[publish-fold M4 / leg (d)] 4, [publish-fold M5 / leg (e)] 7, [publish-fold M6 / leg (f)] 1,
[publish-fold M7 / leg (g)] 8, [publish-fold M4 / leg (h)] 3, [publish-fold M8 / leg (j)] 2.
M5. Eight seconds after the sim is started, at least two direct children of the sim's own
`node` process are alive at once whose argv is `bash <path>/sandbox-boot.sh boot` — the boot
scripts the sim itself has spawned, not a boot's own forked subshells (whose parent is the
boot) and not a wrapper's child (whose parent is the wrapper). M6. In the suite bridge, `SLOW_FIRST[0]` is
`'test_sandbox_boot_selfmerge.mjs'`, `MJS_TIMEOUT` is still `300`, a comment line names
'test_sandbox_boot_selfmerge.mjs' beside the word longest, and the file contains none of
`re-runs seven sibling`, `re-running seven siblings`, `sum of eight sims`; and the boot sim's
`PHASE_ENV` comment no longer says `re-runs this whole exam`. M7. The rig's contract with its
other sims holds: `node fleet/tests/test_sandbox_boot_approved.mjs`, a sibling that registers
only synchronous tests with the rig's `runTests`, exits 0 with `ALL TESTS PASSED` on its stdout
and at least one line beginning `ok (`; the rig still declares `export function boot(`,
`export const green`, `export function makeHome(` and a `function runTests(` export; and the
rig's `STUBS` block — from the line `export const STUBS = {` to the line before
`export const PRELUDE` — is byte-identical to BASE's, so every shim the legs boot against is
the one they booted against before. M8. The multiset of the merge sim's assertion lines —
every line whose first non-blank characters are `assert.`, leading whitespace stripped — is
BASE's multiset (272 lines) minus exactly one line, the nested loop's
`assert.ok(String(r.stdout).includes('ALL TESTS PASSED'),`, and plus nothing.

**Authorized-by:** #768; map #766

**Interfaces:**
- Consumes: `none`
- Produces: `none`

**Context:** WHERE THE 307 SECONDS GO, measured on 2026-09-08 on a 12-core laptop at BASE
`9395cd1` with the file run once under `/usr/bin/time` (real 306.9 s, user 65 s, sys 81 s):
98.2 s is the sum of the file's own 73 `ok (<ms> ms)` lines, and 208.4 s is the seven nested
sims of leg (j) — the `for (const sim of [...])` loop at lines 1389–1406, which
`spawnSync(process.execPath, [path.join(HERE, sim)])`s `test_sandbox_boot.mjs` (61.0 s),
`test_sandbox_boot_edges.mjs` (43.0 s), `test_sandbox_boot_record.mjs` (12.8 s),
`test_sandbox_boot_approved.mjs` (6.4 s), `test_sandbox_boot_approval_evidence.mjs` (10.8 s),
`test_sandbox_boot_effort.mjs` (8.8 s) and `test_sandbox_boot_selfmerge.mjs` (65.5 s), one after
another, each under its own `timeout: 300000`. Every one of the seven is already a file of the
suite, so the seven legs assert nothing the suite does not; they go, and M8 of #715 (`the seven
sibling boot sims still pass`) is the suite's own sentence. The other 98 s is 47 boots of
`fleet/sandbox-boot.sh` at ~2.1 s each: one green boot writes 93 log lines through ~40 forks of
stub shell, costs ~1.3 s of CPU (user+sys) and ~0.8 s of waiting (the stub engine's `sleep 0.1`
page-poll loop, `evidence_lock`'s `sleep 0.1`, pipe hand-offs). THE BOOT SCRIPT HAS NO FIXED WAIT
TO SHORTEN: `FLEET_POLL_SECONDS=0` (rig line 635) already makes `poll_attempts` count attempts and
every `sleep "$POLL_SECONDS"` (script lines 728, 1272, 1490, 1567) a `sleep 0`;
`FLEET_STATUS_INTERVAL=30` is the refresher's interval and the refresher is killed at the engine's
exit (script 686–689, its stdio redirected so its stray sleep holds no pipe); the `sleep 0.1`
loops are bounded polls on files the stubs write at once. So no knob is added to the script, and
the script is untouched — the whole gain is concurrency and the deletion. MEASURED CONCURRENCY on
the same laptop, a scratch script spawning the rig's boot with `child_process.spawn` and the
rig's exact environment: one boot alone 2.1 s; 8 boots at once 6.1 s of wall (0.77 s each);
16 at once 11.7 s (0.73 s each), all exit 0 — boots are fork-bound, so on a 4-vCPU sandbox 47
boots cost ~47 × 1.3 s / 4 ≈ 15 s of CPU-bound floor and should land in 20–35 s of wall,
against the 60 s of M1. THE SHAPE AT BASE the implementer changes: `boot(ctx, args, env)`
(rig 627–660) is `spawnSync('bash', [SCRIPT, ...args], { env: {...}, timeout: 60000 })`; the
rig's `green()` (864–871) memoises one green boot in a module-level `GREEN`; the sim's `parked()`
and `held()` (merge half, 160–178) memoise one boot each the same way; the fold half's `once`
+ `bootWith(env, expect)` (751–790) memoise 26 named scenarios (`noCommits`, `foldCrash`, …,
`merge500`), each first booted by the first leg that reads it; the merge half's legs (b)–(g),
(m) and (j) boot inline (`const ctx = makeHome(); const r = boot(ctx, ['boot'], { STUB_CHECKS: … })`);
`runTests(tests)` (rig 881–899) calls each `fn()` synchronously in registration order, prints
`ok (${Date.now() - started} ms) — ${name}` or `FAIL — ${name}` plus the stack, removes the
process-wide `tmpRoot` (`fs.mkdtempSync` at rig 600, one `home-<n>` per `makeHome()` under it,
`caseNo` a synchronous counter, so concurrent `makeHome()` calls never share a dir), and exits 1
on any failure or prints `ALL TESTS PASSED`. Every scenario's boot is independent of every
other's — each has its own `home`, `bin`, `stub/` counters, `www/status.json` and logs — so every
boot can start at once; what must NOT happen twice is a memoised scenario booting once per
concurrent reader: `green()` has 14 readers in this file, the 26 `bootWith` closures and
`parked`/`held` several each, so a memo shared by concurrent legs memoises the PROMISE of the
boot, not its result. The rig's other seven users — `test_sandbox_boot.mjs`, `_edges`,
`_record`, `_approved`, `_approval_evidence`, `_effort` and `_selfmerge`, the sims besides this
one that call `runTests` — register synchronous tests and read
`boot`/`green` synchronously; the rig's additions (an async boot, a runner that awaits a returned
promise and still runs synchronous tests in order) sit beside the existing exports, and the
existing ones keep their signatures and their synchronous behaviour, which is what M7 reads on
the smallest sibling and the suite reads on all of them. THE ASSERTIONS M8 pins: at BASE the merge sim has 272 lines beginning (after whitespace)
`assert.`, of which exactly one sits inside the nested loop (line 1403); the change from a
synchronous `boot` to an awaited one touches the lines that OBTAIN a context, never the
lines that assert on it, so every other assertion line survives verbatim — and `ctx.result`,
`r.status`, `statusOf(ctx)` and the rest keep their names. THE SHIMS M7 pins: the rig's
`STUBS` object (lines 144–592 at BASE, 449 lines from `export const STUBS = {` up to the line
before `export const PRELUDE`) is untouched by this plan — the rig grows an async boot and a
promise-aware runner, not a stub. Both are compared to `$ULTRA_BASE` in a `Run:`, which the
driver sets; no sim reads it. THE OUTPUT SHAPE M3 and M4 pin is the 73
`ok (` lines the file prints at BASE minus the seven `<sim> still passes on the shared rig`
lines (BASE prints 80); each test's NAME carries its leg tag as the bracketed suffix of the
name, `[M1 / leg (b)]` and so on — the 27 tags and their counts in M4 were read off the BASE
run's stdout. Nothing else in the tree pins this file's output lines: `git grep -n
test_sandbox_boot_merge -- tests fleet/tests` at BASE finds only prose — `tests/test_fleet_suite.py`
lines 9, 14, 49 and 60 (the `SLOW_FIRST` entry and the three comment passages that describe the
nesting), `fleet/tests/test_sandbox_boot.mjs` line 866 (the `PHASE_ENV` comment explaining its
quarter-second poll by the nesting — the poll stays, the sentence goes, which is M6), the file's
own header at line 2, and four tracked fixture plans of 2026-09-07 under the compiler's fixtures directory,
which are data for a compiler test and run nothing. The sentinel `ALL TESTS PASSED` is the
bridge's assertion (`tests/test_fleet_suite.py` line 66) and stays. M5's evidence is the process
table: the driver starts the sim in the background, sleeps eight seconds, and counts the
`bash …/sandbox-boot.sh boot` processes whose parent is the sim's node pid; measured at BASE
three times during one run the count is 1 (one `spawnSync` at a time — a boot's own forked
subshells carry the same argv but have the boot as parent and are not counted), and on the
scratch concurrent script it read 8 of 8; under the new shape it is the width of the boots in
flight, so the boots must be spawned by the sim's own process, not by a child node — the first eight
seconds of the run are boots either way, since the two `bash -n` / rig-export legs at the top
take under a second. THE SUITE BRIDGE, `tests/test_fleet_suite.py`: `SLOW_FIRST` (line 14) is
the longest-first head of the parametrisation, `MJS_TIMEOUT = 300` (line 53) is a hang cap the
issue leaves alone, and the three comment passages (lines 4–13 above `SLOW_FIRST`, the block
above `MJS_TIMEOUT`, and the one inside `test_fleet_mjs`) explain the 300 s by the nesting; after this
run they name the sim that is now the longest, `test_sandbox_boot_selfmerge.mjs` — 66.1 s on the
laptop, ahead of `test_sandbox_boot.mjs` at 61.2 s — with the walls measured, and
`test_sandbox_boot_merge.mjs` moves down the list to where its new wall puts it (the list is
ordered by measured wall, longest first, and a name absent from `fleet/tests/` simply drops out).
`tests/test_fleet_suite.py` line 60's sentence about the merge sim re-running seven siblings and
line 49's `sum of eight sims` are the phrases M6 says are gone. The `timeout` of M1 is
coreutils' on the sandbox; the legs' commands are run by the driver with `bash -lc` in the task's
clone, so the run of M1 is the only `node` process on the box during its 60 s.

**Proof:**
- Run: `start=$(date +%s) && timeout 60 node fleet/tests/test_sandbox_boot_merge.mjs > /tmp/merge-sim.out && wall=$(( $(date +%s) - start )) && printf 'merge sim wall: %s s\n' "$wall" && grep -q 'ALL TESTS PASSED' /tmp/merge-sim.out && [ "$wall" -lt 60 ]`
- Run: `! grep -nE 'test_[a-z_]*\.mjs' fleet/tests/test_sandbox_boot_merge.mjs | grep -vE '^[0-9]+:[[:space:]]*(//|/\*|\*)' | grep .`
- Run: `! grep -nE "process\.execPath|process\.argv\[0\]|['\"]node['\"]|readdir(Sync)?\(" fleet/tests/test_sandbox_boot_merge.mjs fleet/tests/_sandbox_boot_helpers.mjs`
- Run: `! grep -nE '\b(spawn|spawnSync|execFile|execFileSync|execSync|fork)\(' fleet/tests/test_sandbox_boot_merge.mjs fleet/tests/_sandbox_boot_helpers.mjs | grep -vE "\b(spawn|spawnSync)\(('bash'|path\.join\(ctx\.bin)" | grep .`
- Run: `! grep -nE 'child_process' fleet/tests/test_sandbox_boot_merge.mjs fleet/tests/_sandbox_boot_helpers.mjs | grep -vE "^[^:]+:[0-9]+:import \{ (spawn|spawnSync|spawn, spawnSync|spawnSync, spawn) \} from 'node:child_process'$" | grep .`
- Run: `test -s /tmp/merge-sim.out && grep -c '^ok (' /tmp/merge-sim.out | grep -qx 73 && ! grep -q 'still passes on the shared rig' /tmp/merge-sim.out`
- Run: `awk 'NR==FNR { need[substr($0, index($0, " ") + 1)] = $1 + 0; next } /^ok \(/ { for (t in need) if (index($0, t)) got[t]++ } END { bad = 0; for (t in need) { if (got[t] + 0 != need[t]) { print "MISMATCH " t ": want " need[t] " got " got[t] + 0; bad = 1 } else print "ok " got[t] " x " t }; exit bad }' <(printf '%s\n' '1 [leg (l)]' '1 [legs (a)–(m)]' '1 [M1 / leg (a)]' '4 [M1 / leg (b)]' '1 [M2 / leg (c)]' '1 [M2 / leg (d)]' '3 [M1] [M2] / leg (e)]' '1 [M2 / leg (f)]' '1 [M2 / leg (g)]' '2 [M1] [M2] / leg (m)]' '1 [M3 / leg (h)]' '1 [M3 / leg (i)]' '2 [M3] [M4] / leg (j)]' '3 [M4 / leg (k)]' '3 [M5]' '3 [M6]' '1 [M7]' '8 [publish-fold M1 / leg (a)]' '6 [publish-fold M2 / leg (b)]' '1 [publish-fold M2 / leg (i)]' '3 [publish-fold M3 / leg (c)]' '4 [publish-fold M4 / leg (d)]' '7 [publish-fold M5 / leg (e)]' '1 [publish-fold M6 / leg (f)]' '8 [publish-fold M7 / leg (g)]' '3 [publish-fold M4 / leg (h)]' '2 [publish-fold M8 / leg (j)]') /tmp/merge-sim.out`
- Run: `node fleet/tests/test_sandbox_boot_merge.mjs > /tmp/merge-sim-2.out & pid=$! && sleep 8 && alive=$(ps -eo ppid=,args= | awk -v p="$pid" '$1 == p && $2 == "bash" && $NF == "boot" && $3 ~ /sandbox-boot\.sh$/ { n++ } END { print n + 0 }') && printf 'boots alive at 8 s under node pid %s: %s\n' "$pid" "$alive" && wait "$pid" && grep -q 'ALL TESTS PASSED' /tmp/merge-sim-2.out && [ "$alive" -ge 2 ]`
- Run: `python3 -c "import runpy; m = runpy.run_path('tests/test_fleet_suite.py'); assert m['SLOW_FIRST'][0] == 'test_sandbox_boot_selfmerge.mjs', m['SLOW_FIRST']; assert m['MJS_TIMEOUT'] == 300, m['MJS_TIMEOUT']"`
- Run: `grep -n '^#\|^    #' tests/test_fleet_suite.py | grep 'longest' | grep -q 'test_sandbox_boot_selfmerge\.mjs' && ! grep -qE 're-runs seven sibling|re-running seven siblings|sum of eight sims' tests/test_fleet_suite.py`
- Run: `! grep -q 're-runs this whole exam' fleet/tests/test_sandbox_boot.mjs`
- Run: `node fleet/tests/test_sandbox_boot_approved.mjs > /tmp/approved-sim.out && grep -q 'ALL TESTS PASSED' /tmp/approved-sim.out && grep -q '^ok (' /tmp/approved-sim.out && grep -q '^export function boot(' fleet/tests/_sandbox_boot_helpers.mjs && grep -q '^export const green' fleet/tests/_sandbox_boot_helpers.mjs && grep -q '^export function makeHome(' fleet/tests/_sandbox_boot_helpers.mjs && grep -qE '^export (async )?function runTests\(' fleet/tests/_sandbox_boot_helpers.mjs`
- Run: `diff <(comm -3 <(git show "${ULTRA_BASE}:fleet/tests/test_sandbox_boot_merge.mjs" | grep -E '^[[:space:]]*assert\.' | sed 's/^[[:space:]]*//' | LC_ALL=C sort) <(grep -E '^[[:space:]]*assert\.' fleet/tests/test_sandbox_boot_merge.mjs | sed 's/^[[:space:]]*//' | LC_ALL=C sort)) <(printf '%s\n' "assert.ok(String(r.stdout).includes('ALL TESTS PASSED'),")`
- Run: `diff <(git show "${ULTRA_BASE}:fleet/tests/_sandbox_boot_helpers.mjs" | awk '/^export const STUBS = \{/,/^export const PRELUDE/' | sed '$d') <(awk '/^export const STUBS = \{/,/^export const PRELUDE/' fleet/tests/_sandbox_boot_helpers.mjs | sed '$d') && awk '/^export const STUBS = \{/,/^export const PRELUDE/' fleet/tests/_sandbox_boot_helpers.mjs | sed '$d' | awk 'END { print NR }' | grep -qx 449`
- Legs: (a) the first command times one run of the sim under `timeout 60` — a run that is
  still going at 60 s is killed and exits 124, a run whose stdout lacks the sentinel fails
  the grep, and a run of 60 s or more fails the last test — and prints the wall in seconds
  [M1]; (b) the second command lists every line of the merge sim naming a `test_*.mjs`
  path, drops the lines whose first non-blank characters are `//`, `/*` or `*`, and fails if
  any remain — the header comment at line 2 is excused and a surviving
  `'test_sandbox_boot_edges.mjs'` or `'test_launch.mjs'` in a spawn list is named; the third
  fails on any line of either file carrying `process.execPath`, `process.argv[0]`, a quoted
  `node` or a `readdir` call — the ways a sim path could be run or discovered without being
  spelled; the fourth lists every `spawn`/`spawnSync`/`execFile`/`execFileSync`/`execSync`/`fork`
  call in either file and fails if any is not a `spawn`/`spawnSync` whose first argument is the
  literal `'bash'` or `path.join(ctx.bin` — at BASE the nesting call
  `spawnSync(process.execPath, …)` is exactly what it names; and the fifth fails if either file
  mentions `child_process` on any line other than an import of exactly `spawn` and/or
  `spawnSync` from `node:child_process`, so `exec` or `execFile` cannot come in by another
  name [M2]; (c) the sixth command
  counts the `ok (` lines of the same run's stdout and fails unless the count is exactly 73 and
  no line carries `still passes on the shared rig` [M3]; (d) the seventh command reads the
  27-row tag table from a process substitution and, row by row, counts the `ok (` lines
  containing that row's tag, printing `MISMATCH <tag>: want <n> got <m>` for every row whose
  count differs and `ok <n> x <tag>` for every row that matches, and exits 1 if any row
  differed — a leg dropped, a loop row lost, or a tag reworded is named by its row [M4];
  (e) the eighth command starts a second run of the sim in the background, keeps its
  pid, sleeps eight seconds, and counts in `ps -eo ppid=,args=` the processes whose parent is
  that pid, whose first word is `bash`, whose second ends `sandbox-boot.sh` and whose last is
  `boot` — a boot's `$( )` subshells share its argv but have the boot as parent, and a
  `sh -c` wrapper is neither `bash` nor the parent of anything node spawned, so neither is
  counted — prints the count, waits for the run to end with the sentinel, and fails unless
  the count was at least 2; at BASE, sampled three times during a run, it reads exactly 1 [M5]; (f) the ninth
  command loads `tests/test_fleet_suite.py` as a module and fails unless `SLOW_FIRST[0]` is
  `'test_sandbox_boot_selfmerge.mjs'` and `MJS_TIMEOUT` is `300`, and the tenth fails unless a
  comment line of that file carries both `longest` and `test_sandbox_boot_selfmerge.mjs`, or if
  any of the three nesting phrases `re-runs seven sibling`, `re-running seven siblings`,
  `sum of eight sims` survives anywhere in it, and the eleventh fails if
  `fleet/tests/test_sandbox_boot.mjs` still carries `re-runs this whole exam` [M6]; (g) the
  twelfth command runs `test_sandbox_boot_approved.mjs`, a sibling on the shared rig that
  registers only synchronous tests, and fails unless it exits 0, prints the sentinel and at
  least one `ok (` line, and unless the rig still declares `boot`, `green`, `makeHome` and
  `runTests` as exports of their BASE shape — a rig whose `boot` became a promise or whose
  runner stopped running synchronous pairs fails here before the suite says so, and the
  fourteenth command diffs the `STUBS` block of the rig at `$ULTRA_BASE` against the patched
  tree's and fails on any byte changed inside it, and fails unless that block is still its 449
  lines — a shim rewritten, a knob added or a case reordered fails here [M7]; (h) the
  thirteenth command sorts the whitespace-stripped `assert.` lines of the merge sim at
  `$ULTRA_BASE` and at the patched tree, takes `comm -3` of the two multisets — every line
  present in one and not the other, duplicates counted — and fails unless that difference is
  exactly the one BASE-only line the nested loop asserted with: an assertion dropped, gutted
  to a bare pass, or reworded shows up as a BASE-only or a tree-only line and the diff is
  non-empty [M8].

**Stale-if:**
- path-absent: `fleet/tests/test_sandbox_boot_merge.mjs`
- path-absent: `fleet/tests/_sandbox_boot_helpers.mjs`
- path-absent: `fleet/tests/test_sandbox_boot.mjs`
- path-absent: `tests/test_fleet_suite.py`
- issue-closed: #768
