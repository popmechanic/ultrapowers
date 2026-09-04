# Test audit, layer 2: no fleet sim re-runs another, the two big exams split, the examiner role is pinned by its register

**Grammar:** claims-v1

**Claim:** After this run no fleet sim re-runs another sim as a subprocess, the examiner and
sandbox-boot exams are each split into files a bridge slot finishes quickly, and the examiner
role file is pinned by its register and its reply shape, not by its sentences. (elicited)

**Goal:** #612, layer 2 (the `fleet/tests/` layer). The bridge (`tests/test_fleet_suite.py`) gives
every sim one 120 s slot and one xdist unit; measured at BASE on the laptop,
`test_run_engine_examiner.mjs` takes 83.5 s — 60 of them re-executing every other
`test_run_engine*.mjs` sim as a child process, which the bridge already runs as its own item —
and `test_sandbox_boot.mjs` takes 40.9 s in one 1,387-line file. Both are the #603 flake shape
on a loaded sandbox, where the suite runs once per task exam and once at the gate. The
examiner role sim pins two sentences verbatim, which the audit's rule deletes (a string
assertion proves presence, never behaviour); its reply-shape literal and register sweeps stay.

**Tech Stack:** Node 24 ESM sims under `fleet/tests/` (`node:assert/strict`, the shared rig in
`_engine_helpers.mjs`, sentinel `ALL TESTS PASSED`), bridged by `tests/test_fleet_suite.py`
(glob `fleet/tests/test_*.mjs`, so a new file is collected without a bridge edit).

**Spec:** #612 (the audit's "Slow legs" and "Merge / de-duplicate" tables, the xdist item 1).

**Parallelization rationale:** One wave, width 3. Task 1 owns the examiner sim, Task 2 the
sandbox-boot exam, Task 3 the examiner role sim — three disjoint file sets, no consumed
behaviour. The audit's proposal to fold the examiner sim's edited-exam legs into
`test_exam_edited_patches.mjs` is not taken here: that file's frozen-digest legs are deleted
by the concurrent judging-waste plan, and its remaining legs pin `proposedPatches`, a
different assertion — so this plan leaves it alone.

## Global Constraints

- No production file changes: every file under `fleet/` other than `fleet/tests/` is
  byte-identical to BASE, and so is every file under `skills/` and `tests/`.
- Every `fleet/tests/test_*.mjs` prints `ALL TESTS PASSED` under 120 s with no network, and
  `python3 -m pytest -q tests/test_fleet_suite.py` passes.
- No sim under `fleet/tests/` spawns `node` on another `test_*.mjs`: the strings
  `execFileSync('node'` and `spawnSync(process.execPath` occur in no `fleet/tests/test_*.mjs`
  whose argument names a sibling `test_` file.

**Acceptance:** suite — the committed suite is the verification.

### Task 1: The examiner and proposed-patch sims stop re-running their siblings; the examiner exam splits in two

**Type:** implementation

**Files:**
- Modify: `fleet/tests/test_run_engine_examiner.mjs`
- Modify: `fleet/tests/test_run_engine_proposed_patch.mjs`
- Create: `fleet/tests/test_run_engine_exam_edits.mjs`

**Claim:** The examiner and proposed-patch sims no longer re-run sibling sims as subprocesses,
and the examiner exam is split into files a bridge slot finishes quickly. (derived)
Machine: M1. `fleet/tests/test_run_engine_examiner.mjs` no longer carries the block that
enumerates `test_run_engine*.mjs` siblings and runs each with `execFileSync('node', …)`
(the strings `execFileSync`, `readdirSync(dir)` over sims and `printed no pass line` are
absent), while leg (e)'s three no-exam cases (`empty proofTests`, `no proofTests key`, `null
testCmd` → no `exam:` label, `exam` key present and `null`) remain; and
`fleet/tests/test_run_engine_proposed_patch.mjs` no longer re-runs `test_run_engine_fixloop.mjs`
(the strings `execFileSync` and `test_run_engine_fixloop` are absent from it, as is the
deleted block's header `and the existing fix-round sim is untouched`) while its other
eight `// ── ` leg headers remain — exactly eight — and it prints `ALL TESTS PASSED`. M2. Legs (d), (f) and
(g) — the recorded-edit route: the implementer edits the exam and merges with `examEdited`
(the prompt literal `EXAM EDITED: t1_test.sh`), the referee blocks it (`fix-loop-exhausted`),
the fix round edits it (the label `fix:T1:1`), green-at-BASE-then-edited keeps its value
(`green-at-base`), one blob per proof path with absent recorded as `null` (the header
`absent recorded as null`), one edited path of two named (the `(g)` header) — live in
`fleet/tests/test_run_engine_exam_edits.mjs`, which carries its own copy of the local rig
(the `rolesDir` seam the shared rig lacks), and no longer in the examiner file. M3. Each of
the two files prints `ALL TESTS PASSED` as its own process, and the union of their `// ── (x)`
leg headers is exactly the original's seven labels (a)–(g), each in exactly one file. M4.
Each file completes within a `timeout 60` wall-clock bound on the sandbox — half the bridge's
120 s slot — and prints its sentinel inside that bound.

**Authorized-by:** #612 "Slow legs" row 1 and xdist item 1 (split items over 20 s; one bridge
item is one xdist unit); #609's accretion rule (two files named for two tasks that assert the
same behaviour keep one).

**Interfaces:**
- Consumes: none
- Produces: nothing

**Context:** The file today (400 lines): prelude 1–95 (a temp `rolesDir` holding the six real
roles plus a sim `examiner.md` as `EXAMINER_TEXT`; a local `rig()` at 42–71 because
`_engine_helpers.rig` has no `rolesDir` seam; `entry()` at 79–87; `RED_AT_BASE` /
`GREEN_AT_BASE` / `examOk` at 90–95); legs (a) 97–145 dispatch order and the exam prompt,
(b) 147–172 red vs green at BASE, (c) 174–207 `unsatisfiable` and BLOCKED/null replies, (d)
209–304 the four edited-exam sub-blocks, (e) 306–343 — the three no-exam cases at 306–330
and the sibling re-exec block at 331–343 (`const sims = fs.readdirSync(dir).filter((f) =>
/^test_run_engine.*\.mjs$/.test(f) && f !== here)` … `execFileSync('node', [path.join(dir,
f)], …)` … `printed no pass line`), (f) 345–386, (g) 388–398. The re-exec duplicates the
bridge, which already runs each sim as its own item; deleting it removes ~60 s.
`test_run_engine_proposed_patch.mjs` (167 lines) re-execs `test_run_engine_fixloop.mjs` at
lines 119–124 (`execFileSync('node', [fixloop])` and a check that the output trims to `ALL
TESTS PASSED`) inside its leg (d) block — delete those lines only; its `HEADER` literal
(`PROPOSED PATCH (from the referee — …)`) and seven legs stay. The third sim that re-runs
siblings, `test_exam_edited_patches.mjs`, is the concurrent judging-waste plan's file (its
digest legs go there), so after both plans merge no sim under `fleet/tests/` re-runs
another. The new file
copies the prelude it needs (the roles dir, the local rig, `entry`, the writer helpers) and
carries legs (d), (f), (g) verbatim with their `[M4]`/`[M2, M4]` header comments; the examiner
file keeps (a), (b), (c), (e). Header comments are the form `// ── (d) … [M4] ─…`; the
bridge collects any `test_*.mjs`, so the new file needs no registration. Imports the new
file needs: `assert`, `fs`, `os`, `path`, `fileURLToPath`, the same `_engine_helpers.mjs`
names (`makeRepo`, `provision`, `doneImpl`, `passReview`, `cleanCritic`, `gitSync`) and the
engine exports the original imports. A leg (d) sub-block's dispatch-label assertions
(`exam,impl,review:1,fix:1,review:2`) and `examEdited` deep-equals are unchanged.

**Proof:**
- Run: `! grep -q 'execFileSync' fleet/tests/test_run_engine_examiner.mjs && ! grep -q 'readdirSync' fleet/tests/test_run_engine_examiner.mjs && ! grep -q 'printed no pass line' fleet/tests/test_run_engine_examiner.mjs && grep -q 'empty proofTests' fleet/tests/test_run_engine_examiner.mjs && grep -q 'no proofTests key' fleet/tests/test_run_engine_examiner.mjs && grep -q 'null testCmd' fleet/tests/test_run_engine_examiner.mjs && ! grep -q 'execFileSync' fleet/tests/test_run_engine_proposed_patch.mjs && ! grep -q 'test_run_engine_fixloop' fleet/tests/test_run_engine_proposed_patch.mjs && ! grep -q 'existing fix-round sim is untouched' fleet/tests/test_run_engine_proposed_patch.mjs && test "$(grep -c '^// ── ' fleet/tests/test_run_engine_proposed_patch.mjs)" = 8 && grep -q 'PROPOSED PATCH' fleet/tests/test_run_engine_proposed_patch.mjs && timeout 60 node fleet/tests/test_run_engine_proposed_patch.mjs | grep -q 'ALL TESTS PASSED'`
- Run: `test -e fleet/tests/test_run_engine_exam_edits.mjs && grep -q 'examEdited' fleet/tests/test_run_engine_exam_edits.mjs && ! grep -q 'examEdited' fleet/tests/test_run_engine_examiner.mjs && grep -q 'rolesDir' fleet/tests/test_run_engine_exam_edits.mjs && grep -q 'EXAM EDITED: t1_test.sh' fleet/tests/test_run_engine_exam_edits.mjs && grep -q 'fix-loop-exhausted' fleet/tests/test_run_engine_exam_edits.mjs && grep -q 'fix:T1:1' fleet/tests/test_run_engine_exam_edits.mjs && grep -q 'green-at-base' fleet/tests/test_run_engine_exam_edits.mjs && grep -q 'absent recorded as null' fleet/tests/test_run_engine_exam_edits.mjs && grep -q '^// ── (g)' fleet/tests/test_run_engine_exam_edits.mjs`
- Run: `test "$(cat fleet/tests/test_run_engine_examiner.mjs fleet/tests/test_run_engine_exam_edits.mjs | grep -oE '^// ── \([a-g]\)' | sort | uniq -c | awk '$1!=1' | wc -l)" = 0 && test "$(cat fleet/tests/test_run_engine_examiner.mjs fleet/tests/test_run_engine_exam_edits.mjs | grep -oE '^// ── \([a-g]\)' | sort -u | wc -l)" = 7`
- Run: `timeout 60 node fleet/tests/test_run_engine_examiner.mjs > /tmp/ex1.out && grep -q 'ALL TESTS PASSED' /tmp/ex1.out && timeout 60 node fleet/tests/test_run_engine_exam_edits.mjs > /tmp/ex2.out && grep -q 'ALL TESTS PASSED' /tmp/ex2.out`
- Legs: (a) the first Run: exits non-zero if any of the three re-exec strings
  (`execFileSync`, `readdirSync`, `printed no pass line`) survives in the examiner sim, if
  any of the three no-exam cases (`empty proofTests`, `no proofTests key`, `null testCmd`)
  is gone, if the proposed-patch sim still names `execFileSync`, `test_run_engine_fixloop` or the
  deleted block's header, if it has other than exactly eight `// ── ` leg headers (a gutted
  leg drops the count), if its `PROPOSED PATCH` header literal is gone, or if it fails to
  print its sentinel inside 60 s [M1]; (b) the second exits non-zero if the new file is absent, if it does not assert on
  `examEdited`, if the examiner file still does, if the new file lacks its own roles-dir rig,
  or if any of the six row literals (`EXAM EDITED: t1_test.sh`, `fix-loop-exhausted`,
  `fix:T1:1`, `green-at-base`, `absent recorded as null`, the `(g)` header) is missing from
  it [M2]; (c) the third exits non-zero unless the seven leg headers
  (a)–(g) appear across the two files exactly once each [M3]; (d) the fourth exits non-zero
  unless each file, run as its own process under a `timeout 60` wall-clock bound, exits 0
  inside the bound and prints the literal `ALL TESTS PASSED` — a file that exits 0 without
  the sentinel, or one that takes longer than 60 s (the original takes 83.5 s on the
  laptop), fails it [M3, M4].

**Stale-if:**
- path-absent: `fleet/tests/test_run_engine_examiner.mjs`
- path-absent: `fleet/tests/_engine_helpers.mjs`
- issue-closed: #612

### Task 2: The sandbox-boot exam splits, its harness shared

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/tests/test_sandbox_boot.mjs`
- Create: `fleet/tests/_sandbox_boot_helpers.mjs`
- Create: `fleet/tests/test_sandbox_boot_edges.mjs`

**Claim:** The sandbox-boot exam is split into files a bridge slot finishes quickly. (derived)
Machine: M1. `fleet/tests/_sandbox_boot_helpers.mjs` (a leading underscore, so the bridge's
`test_*.mjs` glob does not collect it) exports the harness the exam shares: the run's
literals (`PLAN_SHA`, `BASE_SHA`, `ENGINE_SHA`, `HEAD_SHA`, `OTHER_SHA`, `TARGET`,
`VM_NAME`, `PR_URL`, `PR_AUTHOR`, `PLAN_BRANCH`, `EVIDENCE_BRANCH`, `INTEGRATION_BRANCH`,
`RUN_PATH`, `PLAN_PATH`), the stub bin dir (`STUBS`, `PRELUDE`), `makeHome`, `boot`, and a
`runTests(tests)` runner that prints `ok (<ms> ms) — <name>` per case, prints `FAILED` and
exits 1 when a case throws, and prints `ALL TESTS PASSED` otherwise. M2. `fleet/tests/test_sandbox_boot.mjs` keeps section 1
(`the whole green path`) and section 2 (`the evidence branch`) and
`fleet/tests/test_sandbox_boot_edges.mjs` carries sections 3–10 (`the retired repository`,
`parked runs`, `refusals`, `the public-target fallback`, `the engine's own words`, `failing
before the clone`, `re-entry`, `the deadman`); every `tests.push(['<name>', …])` case of the
original is in exactly one of the two files, none is dropped, and neither file defines its
own `makeHome` or `boot`. M3. Each file prints `ALL TESTS PASSED` as its own process, and
the number of `ok (` lines the two print sum to the number the original printed. M4. Each
file completes within a `timeout 60` wall-clock bound on the sandbox — half the bridge's 120 s
slot — and prints its sentinel inside that bound.

**Authorized-by:** #612 "Slow legs" row 2 (`test_sandbox_boot.mjs` 43.1 s, 998 lines then —
1,387 now — "re-measure after run-72"; xdist item 1).

**Interfaces:**
- Consumes: none
- Produces: `runTests(tests: Array<[string, () => void]>) -> void`

**Context:** The file today: header comment 1–24, imports 26–33, `HERE`/`SCRIPT` 34–35, `// ──
the run's literals` 36–93, `// ── stub bin dir` 94–295 (`PRELUDE`, `STUBS` — one stub per
external binary, each appending to the shared `fleet-boot.log`), `// ── harness` 296–384
(`tmpRoot`, `caseNo`, `makeHome({ packageJson, nodeModules })`, `boot(ctx, args, env)`
spawning `bash sandbox-boot.sh` with `FLEET_HOME`, `FLEET_BIN_DIR`, `FLEET_POLL_SECONDS`,
`FLEET_STATUS_INTERVAL`, …), `// ── reading the git log` 385–462, then ten numbered sections
of `tests.push([...])` cases (1 at 463, 2 at 855, 3 at 1096, 4 at 1128, 5 at 1157, 6 at 1211,
7 at 1228, 8 at 1255, 9 at 1274, 10 at 1333), and `// ── run` 1368–1387 (the loop over
`tests`, `fs.rmSync(tmpRoot)`, `<n> FAILED` / `ALL TESTS PASSED`). Section 1 is 392 lines
and the bulk of the wall; sections 3–10 are ~270 lines together. `tmpRoot` and `caseNo` are
module state the harness owns — export a `makeHome` that closes over its own `tmpRoot`, and
have `runTests` remove it at the end. `_engine_helpers.mjs` and `_lobby_helpers.mjs` are the
precedent for an underscore-prefixed shared module in this directory. The exam's ordering
assertions are index comparisons within one log stream per case; moving a case between
files changes nothing about it.

**Proof:**
- Run: `test -e fleet/tests/_sandbox_boot_helpers.mjs && test -e fleet/tests/test_sandbox_boot_edges.mjs && node -e "import('./fleet/tests/_sandbox_boot_helpers.mjs').then(m=>{for(const k of ['PLAN_SHA','BASE_SHA','ENGINE_SHA','HEAD_SHA','OTHER_SHA','TARGET','VM_NAME','PR_URL','PR_AUTHOR','PLAN_BRANCH','EVIDENCE_BRANCH','INTEGRATION_BRANCH','RUN_PATH','PLAN_PATH','STUBS','PRELUDE','makeHome','boot','runTests']) if(!(k in m)){console.error('missing export '+k);process.exit(1)}})" && ! grep -qE '(function|const|let|var)[[:space:]]+(makeHome|boot)[^A-Za-z0-9_]' fleet/tests/test_sandbox_boot.mjs && ! grep -qE '(function|const|let|var)[[:space:]]+(makeHome|boot)[^A-Za-z0-9_]' fleet/tests/test_sandbox_boot_edges.mjs && ! node -e "import('./fleet/tests/_sandbox_boot_helpers.mjs').then(m=>m.runTests([['boom',()=>{throw new Error('x')}]]))" > /tmp/sbh.out 2>&1 && grep -q 'FAILED' /tmp/sbh.out`
- Run: `grep -q 'the whole green path' fleet/tests/test_sandbox_boot.mjs && grep -q 'the evidence branch' fleet/tests/test_sandbox_boot.mjs && ! grep -q 'the whole green path' fleet/tests/test_sandbox_boot_edges.mjs && ! grep -q 'the evidence branch' fleet/tests/test_sandbox_boot_edges.mjs && for s in 'the retired repository' 'parked runs' 'refusals' 'the public-target fallback' "the engine's own words" 'failing before the clone' 're-entry' 'the deadman'; do grep -q "$s" fleet/tests/test_sandbox_boot_edges.mjs || exit 1; ! grep -q "$s" fleet/tests/test_sandbox_boot.mjs || exit 1; done`
- Run: `timeout 60 node fleet/tests/test_sandbox_boot.mjs > /tmp/sb1.out && timeout 60 node fleet/tests/test_sandbox_boot_edges.mjs > /tmp/sb2.out && grep -q 'ALL TESTS PASSED' /tmp/sb1.out && grep -q 'ALL TESTS PASSED' /tmp/sb2.out && test "$(cat /tmp/sb1.out /tmp/sb2.out | grep -c '^ok (')" = 49`
- Legs: (a) the first Run: exits non-zero if the helper or the edges file is absent, if any of
  the nineteen named exports (the fourteen run literals, `STUBS`, `PRELUDE`, `makeHome`,
  `boot`, `runTests`) is missing from the helper module, if either test file still declares
  its own `makeHome` or `boot` by `function`, `const`, `let` or `var`, or if `runTests` over
  one throwing case exits 0 or fails to print `FAILED` [M1]; (b) the second exits non-zero unless sections 1 and 2 are in the first file and
  absent from the second, and each of the eight edge sections (`the retired repository`,
  `parked runs`, `refusals`, `the public-target fallback`, `the engine's own words`,
  `failing before the clone`, `re-entry`, `the deadman`) is in the second file and absent
  from the first — a section left behind fails its own row [M2]; (c) the
  third exits non-zero unless each file, run as its own process under a `timeout 60`
  wall-clock bound, exits 0 inside the bound and prints `ALL TESTS PASSED`, and the two
  together print exactly 49 `ok (` lines — the original prints 49, one per case, so a dropped
  or duplicated case fails it, and a half that still takes the original's 41 s twice over
  fails the bound [M2, M3, M4].

**Stale-if:**
- path-absent: `fleet/sandbox-boot.sh`
- path-absent: `fleet/tests/test_sandbox_boot.mjs`
- issue-closed: #612

### Task 3: The examiner role sim keeps its shape pins and sweeps, not its sentences

**Type:** implementation

**Files:**
- Modify: `fleet/tests/test_roles_examiner.mjs`

**Claim:** The examiner role file is pinned by its register and its reply shape, not by its
sentences. (derived)
Machine: M1. `fleet/tests/test_roles_examiner.mjs` no longer carries leg (a)'s verbatim
sentence `M1` with its mutation liveness check, nor leg (b)'s verbatim sentence `M2` (the
constants `M1` and `M2`, the phrases `not its implementation` and `expected to fail at BASE
for exactly one reason` are absent from the sim). M2. It keeps leg (c) — the reply-shape
literal `{status: DONE|BLOCKED, summary, unsatisfiable: [{leg, why}]}` counted exactly once
and the Amendment-10 sweep (`!/startHead|rev-parse/`) — and leg (d)'s three register sweeps
(no `NEVER`/`ALWAYS`/`MUST`, no `adversarial`, no `Implement the minimum to make them pass`),
and the `role prose size:` report to stderr. M3. The sim prints `ALL TESTS PASSED` on the
real role file; a copy of `examiner.md` with the reply-shape literal altered makes it fail,
and a copy with the word `MUST` inserted makes it fail (the liveness checks are the shape
and the register, not a sentence).

**Authorized-by:** #612 "Fourth layer: prose tests" (sentence pins delete; register sweeps and
the reply shape spelled once keep — the operator's call on the role files, #556 stance).

**Interfaces:**
- Consumes: none
- Produces: nothing

**Context:** The file today (52 lines): (a) lines 12–29 pin `M1` (`You are a peer writing this
task's exam, not its implementation: …`) and at 27–29 delete `not its implementation` from
a copy and require the pin to go red; (b) 31–34 pin `M2` (`A leg you cannot encode as
written goes under \`unsatisfiable\` as \`{leg, why}\`; return \`BLOCKED\` only when no
exam at all can be written.`); (c) 36–43 `SHAPE` (line 37) counted once and the
`startHead|rev-parse` sweep; (d) 45–49 the three sweeps; line 51 prints the word count to
stderr (reported, never gated — #496). `fleet/roles/examiner.md` is not edited by this task
and carries the shape literal once. The concurrent judging-waste plan rewrites
`test_roles_peer.mjs` on the same rule; this task touches only the examiner sim.

**Proof:**
- Run: `! grep -q 'not its implementation' fleet/tests/test_roles_examiner.mjs && ! grep -q 'exactly one reason' fleet/tests/test_roles_examiner.mjs && ! grep -qE '^const M[12] ' fleet/tests/test_roles_examiner.mjs`
- Run: `grep -q 'unsatisfiable: \[{leg, why}\]' fleet/tests/test_roles_examiner.mjs && grep -q 'startHead|rev-parse' fleet/tests/test_roles_examiner.mjs && grep -q 'NEVER|ALWAYS|MUST' fleet/tests/test_roles_examiner.mjs && grep -qi 'adversarial' fleet/tests/test_roles_examiner.mjs && grep -q 'Implement the minimum' fleet/tests/test_roles_examiner.mjs && grep -q 'role prose size:' fleet/tests/test_roles_examiner.mjs`
- Run: `node fleet/tests/test_roles_examiner.mjs | grep -q 'ALL TESTS PASSED' && d=$(mktemp -d) && cp -R fleet "$d/" && sed -i.bak 's/unsatisfiable: \[{leg, why}\]/unsatisfiable: []/' "$d/fleet/roles/examiner.md" && ! node "$d/fleet/tests/test_roles_examiner.mjs" >/dev/null 2>&1 && e=$(mktemp -d) && cp -R fleet "$e/" && printf '\nYou MUST write the exam.\n' >> "$e/fleet/roles/examiner.md" && ! node "$e/fleet/tests/test_roles_examiner.mjs" >/dev/null 2>&1`
- Legs: (a) the first Run: exits non-zero if either sentence constant or either pinned phrase
  survives [M1]; (b) the second exits non-zero if the shape literal, the Amendment-10 sweep,
  any of the three register sweeps or the `role prose size:` report is gone [M2]; (c) the
  third exits non-zero unless the sim prints `ALL TESTS PASSED` on the real role file (the
  pipe's status is the grep's), fails on a copy whose reply-shape literal was altered, and
  fails on a copy with `MUST` appended — a sweep that is computed and never asserted passes
  the real file and the mutated copy alike and fails it [M3].

**Stale-if:**
- path-absent: `fleet/roles/examiner.md`
- issue-closed: #612
