# The red suite's record is the failing test's own block

**Grammar:** claims-v1

**Claim:** the ack/receipt text for a red suite is the failing test's own block (from its first `FAIL`/`not ok` line to its end), never a fixed-length tail (quoted from #763)

**Goal:** #763, narrowed 2026-09-08 to its part (2) — part (1), the depth-1 leg's flake row,
is moot since #712 (`1c2c89e3`) deleted the leg outright. Run-40's park text opened mid-word
because every place the engine turns a red suite into text takes a fixed-length tail of the
output: the baseline record (`tail(r.stdout + r.stderr, 2000)` in `fleet/run-engine.mjs`, then
`tail(baseline.output, 500)` into the judgment call and the critic's brief), the reconcile
agent's brief (`tail(…, 3000)`), a blocked wave's `TEST_FAILED` detail (`tail(…, 800)`), the
critic's `suiteLine` (`tail(suite.output, 500)`), and the pull-request body's `suite red` excerpt
in `fleet/sandbox-boot.sh` (`tail -n 20`). A pytest suite prints the failing test's name and the
sim's own assertion message at the TOP of that test's FAILURES block and a summary at the bottom,
so a tail keeps the summary and loses the name. Since #739 the whole output is on the record
(`acceptance.log` beside the gate receipt; `publish-fold/suite-<attempt>.txt` for the fold), so
the text a reader is shown can be the failing test's own block — from its first failure line to
where that test's block ends — and nothing else. One rule, written once as a Node helper for the
engine and once as an awk function for the boot script (a boot-script `node` call is a finding
in the boot sims: `node` is argv to `systemd-run` there and nowhere else). The gate scripts
(`gate_check.py`, `ultra_gate.py`, `run_acceptance.sh`) are frozen since 0.1.0: the gate
receipt's own 4000-char tail stays, and this plan does not touch it.
**Closes:** #763

**Tech Stack:** Node 22 ESM (`fleet/*.mjs`); bash + POSIX awk (`fleet/sandbox-boot.sh`). The engine
sims run the real engine below the agent seam (real git, real clones, real patch capture, the real
fold kernel through the real `sh` seam) with canned judgments, through `rig()` of
`fleet/tests/_engine_helpers.mjs`, whose repository's suite is `bash check.sh`. The boot sims run
the real `fleet/sandbox-boot.sh` with every external command stubbed on `PATH` through
`fleet/tests/_sandbox_boot_helpers.mjs`. The committed suite is `python3 -m pytest` from the repo
root, which bridges every `fleet/tests/test_*.mjs` through `tests/test_fleet_suite.py`
(sentinel `ALL TESTS PASSED`, no network).

**Exam command:** node {paths}

**Parallelization rationale:** two waves. Wave 1, width 2: Task 1 (the helper and its unit exam,
a new file) and Task 3 (the boot script's awk function and its sims) share no file and no symbol —
they share one literal, the marker rule, written in both Contexts. Wave 2, width 1: Task 2
consumes `failingBlock` and its sims run the real engine, which executes the helper on a red
suite's output — that is Task 1's runtime behaviour, not its shape, so the chain is owed
(rule 2). Wave 1's folded tree is green on its own: a new module with its own test, and a boot
script whose sims moved with it. A sibling plan (#762) is launched concurrently and edits
`fleet/run-engine.mjs` in the `runTask` retry region; Task 2's sites are elsewhere in the file and
are located by string, and same-file text folds.

## Global Constraints

- Check: `git diff --quiet $ULTRA_BASE -- skills/ultrapowers/scripts/gate_check.py skills/ultrapowers/scripts/ultra_gate.py skills/ultrapowers/scripts/run_acceptance.sh`
- Check: `git diff --quiet $ULTRA_BASE -- fleet/publish-fold.mjs fleet/run-main.mjs`
- The verification periphery is frozen (0.1.0); the first Check is its pin. The gate receipt's
  own tail of the acceptance run is the frozen scripts' and is not what this plan changes.
- The whole output stays on the record where it is: `<run dir>/acceptance.log` is still the
  gate suite's full output (#739) and `publish-fold/suite-<attempt>.txt` is still the fold
  suite's full stdout+stderr as `publish-fold.mjs` writes it — the second Check pins both
  writers. What changes is the excerpt a reader is shown, never the record.
- A green suite's record keeps its BASE shape and text: `report.tests`, `report.baseline`
  (`null` on an all-green run; `{ passed, output }` otherwise), `waveMerges[].suite`, and the
  green branch of `suiteLine` are as at BASE.
- No excerpt of a red suite is a fixed-length tail or head: no `.slice(-N)`, `tail(…, N)`,
  `tail -n`, `tail -c` or `head` is applied to a red suite's output on its way into a judgment
  call, a brief, a wave detail or the pull-request body.
- `fleet/sandbox-boot.sh` invokes `node` only as argv to `systemd-run`, as at BASE — the boot
  sims stub `node` and record a direct call as a `node DIRECT` finding.
- The run record stays data: no new event kind, no new report field; the existing fields keep
  their names and types.
- Every assertion that stands at BASE in the sims a task's Files names still holds, except the
  ones that task's Context names as re-scoped with what replaces them.

**Acceptance:** suite — the committed suite is the verification.

### Task 1: The failing test's own block, as one function

**Type:** implementation
**Review:** peer

**Files:**
- Create: `fleet/failing-block.mjs`
- Test: `fleet/tests/test_failing_block.mjs`

**Claim:** Whatever shape a red suite prints — a pytest run that bridged a sim, a TAP run, a bare node sim — the text quoted from it begins at the failing test's own first failure line and stops where that test's block stops, and an output with no such line is quoted whole. (derived)
Machine: M1. `failingBlock(text)` on a pytest-shaped output — a preamble, a FAILURES header line of
three-or-more underscores, a space, the test's name, a space and three-or-more underscores, then
`E` lines one of which names the leg, then a rule line of three-or-more `=` and a space, then a
`FAILED` line, a summed summary line and trailing padding — returns exactly the lines from that
header line through the line before the rule line, joined with `\n`.
M2. On a TAP-shaped output — `ok 1 - …`, then `not ok 2 - …` naming the leg, indented diagnostic
lines, then `ok 3 - …` and more — it returns exactly the lines from the `not ok 2` line through
the line before `ok 3`; and on a TAP output whose `not ok` line is followed only by diagnostic
lines and a `# fail 1` last line, it returns from the `not ok` line through that last line.
M3. On a bare node sim's output — lines the sim printed, then Node's
`AssertionError [ERR_ASSERTION]: …` line naming the leg, the stack and the `Node.js v…` last
line — it returns from the `AssertionError` line through the last line.
M4. On a text with no line matching the start rule — a green pytest summary, a bare `1`, the
empty string — it returns the text unchanged, byte for byte.
M5. On a pytest-shaped output whose block (header through the line before the rule) is longer
than 8000 characters, the returned string is that whole block — its length equals the block's,
and its first line is the header — so no length-bounded excerpt satisfies it.

**Authorized-by:** #763 (bug, verification-frontier), narrowed 2026-09-08 to part (2); #739 (the
whole output is on the record, so the excerpt can be a block).

**Interfaces:**
- Consumes: none
- Produces: `failingBlock(text: string) -> string`

**Context:** A new module `fleet/failing-block.mjs`, ESM, no imports beyond Node's own, exporting
one named function `failingBlock`. It splits the text on `\n` and applies the marker rule, which
is the ONE literal this plan shares with Task 3's awk function (the two must agree line for line):
**start** — the first line matching `/^(_{3,} .+ _{3,}$|FAILED |FAIL[: ]|not ok |AssertionError)/`;
**end** — the line before the first LATER line matching `/^(_{3,} .+ _{3,}$|={3,} |(not )?ok \d)/`,
or the last line of the text when no later line matches; **fallback** — when no line matches the
start rule the whole text is returned unchanged. The block is the lines start..end joined with
`\n`, with no trailing newline added or removed beyond what joining gives. The shapes it is
written for, measured 2026-09-08 on this machine: `python3 -m pytest -n 2 -q` on a bridge-shaped
test prints `bringing up nodes...`, a dots line, `=== FAILURES ===`, then
`___ test_fleet_mjs[test_red.mjs] ___`, a `[gw1] darwin -- Python …` line, the source excerpt, and
`E   AssertionError: <the sim's stdout+stderr, one E line per line>` — which is where the sim's
own `AssertionError [ERR_ASSERTION]: leg (b) [M2]: …` line sits — then
`=== short test summary info ===`, `FAILED tests/…::test_fleet_mjs[test_red.mjs] - AssertionErr...`
and `1 failed, 2 passed in 0.24s`; a bare `node test_red.mjs` prints the sim's own lines, then
Node's internal `run_main` frame line, `triggerUncaughtException(`, `^`, a blank line,
`AssertionError [ERR_ASSERTION]: leg (b) [M2]: …`, the diff, the stack, the `{ … }` detail and
`Node.js v24.16.0`; `node --test` prints TAP (`ok 1 - name`, `not ok 2 - name`, an indented YAML
diagnostic closed by `  ...`, and a `# fail 1` summary). The function takes no length argument and
has no default cap: the record's whole output lives beside it (`acceptance.log`,
`suite-<attempt>.txt`), so the block's size is whatever the failing test printed. The unit exam
builds each shape as a string literal in the test file (no subprocess, no pytest), so it is
concurrency-safe and runs in well under a second; its M5 fixture is a header plus enough
`E   …` lines to pass 8000 characters, then a rule, then padding.
**BASE facts:** (generated at d26bbdc)
- `E` at `fleet/tests/probe_addcwd_scope.mjs:92` blob b43a48c

**Proof:**
- Test: `fleet/tests/test_failing_block.mjs`
- Legs: (a) the pytest-shaped fixture returns exactly the header-through-pre-rule lines,
  compared with `assert.equal` against the expected string, and that string contains the leg
  name and not the padding [M1]; (b) the TAP fixture with a following `ok 3` returns exactly the
  `not ok 2`-through-pre-`ok 3` lines, and the TAP fixture ending in `# fail 1` returns from
  `not ok 2` through `# fail 1` inclusive, both by `assert.equal` [M2]; (c) the bare-node fixture
  returns from the `AssertionError [ERR_ASSERTION]:` line through `Node.js v24.16.0` inclusive,
  by `assert.equal`, and the sim's pre-assertion lines are absent from it [M3]; (d) for each of a
  green pytest summary (`28 passed in 1.02s`), the one-character text `1`, and the empty string,
  the return value is `===` the input [M4]; (e) a pytest-shaped fixture whose block exceeds
  8000 characters returns a string whose length equals that block's, whose first line is the
  header, and which contains the leg-naming line — an implementation that keeps any tail or
  head of it fails [M5].
- Run: node fleet/tests/test_failing_block.mjs | grep -q 'ALL TESTS PASSED'

**Stale-if:**
- path-exists: `fleet/failing-block.mjs`
- issue-closed: #763

### Task 2: The engine quotes the block wherever it quoted a tail

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/run-engine.mjs`
- Modify: `fleet/tests/test_run_engine_critic_inputs.mjs`
- Test: `fleet/tests/test_run_engine_red_suite_record.mjs`

**Claim:** After a run whose suite went red — on BASE, or on a wave's folded candidate — the judgment call, the critic's brief, the reconcile agent's brief and a blocked wave's detail each quote the failing test's own block and so name the failing leg, and a run whose suite stayed green records exactly what it recorded before. (derived)
Machine: M1. On a run whose suite is red at BASE and whose red output is pytest-shaped with the
leg-naming line inside the FAILURES block and trailing padding longer than every tail the engine
took at BASE, `report.baseline.output` begins with the FAILURES header line, contains the
leg-naming line, and does not contain the padding.
M2. On that run, the `report.judgmentCalls` entry beginning `baseline: the suite is RED on BASE (`
and the line of the completeness critic's brief beginning `Baseline: the suite is RED on BASE — `
each contain the leg-naming line and neither contains the padding.
M3. On a run whose wave candidate is red with that same output shape, the reconcile agent's
brief carries, after `Failing output:\n`, text that contains the leg-naming line and not the
padding.
M4. On a run whose reconcile agent returns `BLOCKED`, the wave's `waveMerges[0]` is
`TEST_FAILED` and its `detail` begins `candidate suite failed after reconcile attempts: `, contains
the leg-naming line, and does not contain the padding.
M5. `suiteLine({ passed: false, output }, cmd)` renders `\noutput: ` followed by `output` whole —
for an `output` longer than 8000 characters the text after `\noutput: ` equals it — and
`suiteLine({ passed: true, output }, cmd)` renders no `output:` line.
M6. On a run whose every wave is green, `report.baseline` is `null`, no `judgmentCalls` entry
starts with `baseline:`, `report.tests.passed` is `true`, and `report.tests.output` equals the
suite's own printed stdout+stderr for that execution.

**Authorized-by:** #763 (bug, verification-frontier), narrowed 2026-09-08 to part (2); #712 (the
baseline is lazy and runs only when a wave is red, which is why every site here is a red site).

**Interfaces:**
- Consumes: `failingBlock(text: string) -> string`
- Produces: nothing a sibling consumes — the excerpt is read by agents and the operator, never by a task

**Context:** `fleet/run-engine.mjs` imports `failingBlock` from `./failing-block.mjs` (a sibling
file created in the wave before this one) and applies it to every red suite output; `tail` stays
for everything that is not a red suite (stderr of git and the fold CLI, bootstrap failures, the
`Run:`/`Check:`/exam evidence records). The sites at BASE `d26bbdc1`, by the strings to locate them
(a sibling plan, #762, edits the `runTask` retry region of this file concurrently, so line numbers
shift — find these by text): the baseline record `baseline = { passed: r.code === 0, output:
tail(r.stdout + r.stderr, 2000) }` becomes `output: r.code === 0 ? tail(r.stdout + r.stderr,
2000) : failingBlock(r.stdout + r.stderr)` — the green record's text is unchanged; the judgment
call `'baseline: the suite is RED on BASE (' + tail(baseline.output, 500) + ')…'` and the critic
brief's `'\nBaseline: the suite is RED on BASE — ' + tail(baseline.output, 500)` each use
`baseline.output` whole (it is already the block); the reconcile dispatch's `'\n\nFailing
output:\n' + tail(suite.stdout + suite.stderr, 3000)` becomes `failingBlock(suite.stdout +
suite.stderr)`; the `TEST_FAILED` return's `detail: 'candidate suite failed after reconcile
attempts: ' + tail(suite.stdout + suite.stderr, 800)` likewise; and `suiteLine`'s red branch
`'\noutput: ' + tail(suite.output, 500)` becomes `'\noutput: ' + suite.output`. The two `MERGED`
returns keep `suite: { passed: true, output: tail(suite.stdout + suite.stderr) }` — green, and
what `report.tests.output` is built from. The one BASE pin of a tail on these sites is
`fleet/tests/test_run_engine_critic_inputs.mjs`, scenario 2: `const long = 'x'.repeat(600) +
'TAIL-MARKER'` with `assert.match(rendered, /TAIL-MARKER$/)` and `assert.equal(rendered.split('\n
output: ')[1].length, 500, 'the output is tailed to 500 chars')` — re-scope the second to
`assert.equal(rendered.split('\noutput: ')[1], long, 'the output is carried whole')` and reword
its comment; every other assertion in that file stands. `fleet/tests/test_run_engine_baseline.mjs`
pins `Object.keys(report.baseline).sort()` as `['output', 'passed']` and `typeof output ===
'string'` — both still hold, and that file is untouched. The new exam follows
`test_run_engine_baseline.mjs`'s pattern: `makeRepo(dir, { 'check.sh': … })` replaces the rig's
plain `check.sh` with one that exits 0 printing `green suite output` when no `BROKEN` file exists,
and when one exists prints the pytest shape and exits 1 — `bringing up nodes...`, `..F`,
`=== FAILURES ===`, `___ test_fleet_mjs[test_sim.mjs] ___`, `[gw1] linux -- Python 3.12`,
`E   AssertionError: scenario a ran`, `E     AssertionError [ERR_ASSERTION]: leg (b) [M2]: the
recorded text names the failing leg`, `=== short test summary info ===`,
`FAILED tests/test_fleet_suite.py::test_fleet_mjs[test_sim.mjs] - AssertionError`,
`1 failed, 2 passed in 0.24s`, then padding: forty lines of `PADDING-` followed by one hundred
`x` characters each (4,000+ characters, longer than the 2000, 3000, 800 and 500 the engine took at
BASE) — so a tail of any of those lengths keeps padding and loses the leg-naming line, and a block
keeps the line and no padding. The leg-naming line the exam searches for is the literal
`the recorded text names the failing leg`; the padding marker is `PADDING-`. The
scenarios: (i) `BROKEN` committed at BASE, implementer writes its file, reconcile stub removes
`BROKEN` and returns `FIXED`, critic stub captures its prompt — a red baseline that ends `MERGED`
(M1, M2); (ii) no `BROKEN` at BASE, the implementer stub writes `BROKEN` in its clone so the
candidate is red, the reconcile stub captures its prompt then removes `BROKEN` and returns `FIXED`
(M3); (iii) as (ii) but the reconcile stub returns `{ status: 'BLOCKED', summary: 'not fixable
here' }` (M4); (iv) all green, one task (M6). `suiteLine` is exported from `fleet/run-engine.mjs`
and is called directly for M5. Each scenario uses its own `mkdtemp` directory and its own `stamp`;
no ports, no shared fixtures. The reconcile prompt is captured by the stub on `opts.label`
starting `reconcile:`; the critic's on `opts.label === 'integration'`.
**BASE facts:** (generated at d26bbdc)
- `detail` at `fleet/doctor.mjs:621` blob f9a1174
- `output` at `fleet/lobby.mjs:247` blob 62d348b
- `fleet/run-engine.mjs` blob 3148252
- `tail` at `fleet/publish-fold.mjs:51` blob 6797792
- `runTask` at `fleet/run-engine.mjs:1608` blob 3148252
- `fleet/tests/test_run_engine_critic_inputs.mjs` blob 211f419
- `fleet/tests/test_run_engine_baseline.mjs` blob 04f9191
- `x` at `fleet/tests/test_sandbox_boot_merge.mjs:280` blob 6c66277
- `stamp` at `fleet/lobby.mjs:65` blob 62d348b
- `judgmentCalls` at `fleet/run-engine.mjs:824` blob 3148252
- `long` at `fleet/tests/test_run_engine_critic_inputs.mjs:86` blob 211f419

**Proof:**
- Test: `fleet/tests/test_run_engine_red_suite_record.mjs`
- Legs: (a) scenario (i): `report.baseline.output` starts with the FAILURES header line,
  includes the leg-naming line, and does not include `PADDING-` — an engine that records a tail
  of 2000 characters includes `PADDING-` and lacks the line [M1]; (b) scenario (i): exactly one
  `judgmentCalls` entry starts with `baseline: the suite is RED on BASE (`, it includes the
  leg-naming line and not `PADDING-`, and the critic's prompt has a line starting `Baseline: the
  suite is RED on BASE — ` that includes the leg-naming line and not `PADDING-` [M2];
  (c) scenario (ii): the captured reconcile prompt's text after `Failing output:\n` includes the
  leg-naming line and not `PADDING-`, and the wave ends `MERGED` [M3]; (d) scenario (iii):
  `report.waveMerges[0].status` is `TEST_FAILED`, its `detail` starts with `candidate suite failed
  after reconcile attempts: `, includes the leg-naming line and not `PADDING-` [M4];
  (e) `suiteLine({ passed: false, output: long }, 'bash check.sh')` with `long` of more than 8000
  characters renders text whose part after `\noutput: ` equals `long`, and `suiteLine({ passed:
  true, output: long }, 'bash check.sh')` renders no `output:` line [M5]; (f) scenario (iv):
  `report.baseline` is strictly `null`, no `judgmentCalls` entry starts with `baseline:`,
  `report.tests.passed` is `true`, and `report.tests.output` equals `green suite output\n` [M6].
- Run: node fleet/tests/test_run_engine_red_suite_record.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_run_engine_critic_inputs.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_run_engine_baseline.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_run_engine_reconcile.mjs | grep -q 'ALL TESTS PASSED'

**Stale-if:**
- path-absent: `fleet/run-engine.mjs`
- path-absent: `fleet/tests/test_run_engine_critic_inputs.mjs`
- issue-closed: #763

### Task 3: The pull request quotes the fold suite's failing block

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/sandbox-boot.sh`
- Modify: `fleet/tests/_sandbox_boot_helpers.mjs`
- Test: `fleet/tests/test_sandbox_boot_merge.mjs`

**Claim:** After a publish fold whose suite went red, the pull request's fenced excerpt is the failing test's own block from the fold's suite file — the failing leg's name is in it even when it sits far above the file's last twenty lines — and the whole file is still on the evidence branch. (derived)
Machine: M1. On a `suite red` fold whose `publish-fold/suite-1.txt` is TAP-shaped — `ok 1 - join`,
then `not ok 2 - the recorded text names the failing leg`, then more than twenty
indented diagnostic lines, then `# fail 1` as the last line — the pull request body's fenced
block contains the `not ok 2` line.
M2. That fenced block's lines are exactly `suite-1.txt`'s lines from the `not ok 2` line through
its last line, `# fail 1` included, in order, and the `ok 1 - join` line is not in the body.
M3. `publish-fold/suite-1.txt` on the evidence worktree is still the whole text — twenty-eight
lines, the first `ok 1 - join`, the last `# fail 1` — not the excerpt.
M4. On a `suite red` fold whose `suite-1.txt` has no line matching the start rule — three plain
lines — the fenced block is those three lines whole.
M5. The boot log of the `suite red` run carries no `node DIRECT` line: the excerpt is produced
by the boot script's own shell and awk.

**Authorized-by:** #763 (bug, verification-frontier), narrowed 2026-09-08 to part (2); #715 (the
publish fold, whose `suite red` section this is).

**Interfaces:**
- Consumes: none
- Produces: nothing a sibling consumes — the excerpt is read by the operator on the pull request

**Context:** `fleet/sandbox-boot.sh`'s `fold_section` (locate by the comment `The suite the fold
ran on the folded head is the whole of a`) prints, on `"$d" = "suite red"` with the file present,
a fence, `tail -n 20 "$suite"`, and a closing fence. Replace the `tail -n 20` with a shell function
`failing_block` that applies the marker rule with awk — the ONE literal this plan shares with
Task 1's Node helper (the two must agree line for line): **start** — the first line matching the
ERE `^(___+ .+ ___+$|FAILED |FAIL[: ]|not ok |AssertionError)`; **end** — the line before the first
LATER line matching `^(___+ .+ ___+$|===+ |(not )?ok [0-9])`, or the file's last line when no later
line matches; **fallback** — a file with no start line is printed whole. POSIX awk only (the
sandbox is Ubuntu's mawk; the sims run on this machine's BSD awk): no `{3,}` intervals, no
`\d`, no gawk-only functions — the two EREs above are written for both. `node` is NOT called:
in the boot sims `node` is a stub that logs `node DIRECT` and every such line is a finding, and
on the sandbox `node` is argv to `systemd-run` only. The rig: `fleet/tests/_sandbox_boot_helpers.mjs`
exports `FOLD_SUITE_TEXT` (`'FAIL fleet/tests/test_fold.py::test_join\n1 failed, 12 passed in
3.10s'`) and `FOLD_SUITE_LAST` (its last line), and the `systemd-run` stub writes
`STUB_FOLD_SUITE` to `<fold dir>/suite-<attempt>.txt` on `suite red` (`printf '%s\n'`, so the
file ends in one newline). Change `FOLD_SUITE_TEXT` to the TAP shape of M1: `ok 1 - join`, then
`not ok 2 - the recorded text names the failing leg`, then twenty-four lines each
of two spaces and `diagnostic line N` for N from 1 to 24, then `  ...`, then `# fail 1`; keep
`FOLD_SUITE_LAST` as its last line (`# fail 1`) — the merge sim's leg (d) at BASE
(`tailLine(foldRead(ctx, 'suite-1.txt'))` is in the body) still holds because the block runs to
the end of a file with no later boundary line. Every other export and stub of the helper is
untouched. `test_sandbox_boot_merge.mjs`'s `suiteRed` boot (`STUB_FOLD_DISPOSITION: 'suite red'`)
is the fixture for M1–M3 and M5; M4 boots with `STUB_FOLD_SUITE` overridden to
`'first line\nsecond line\nthird line'`. The boot log the sims read is `$FLEET_HOME/fleet-boot.log`
(`say` writes `<time> CALL <name …>` lines); the pull request body is the `body` of the one
`POST …/pulls` the fake API received (`bodyOf(ctx, leg)` in the merge sim). The fenced block in
the body is the text between the first line that is exactly three backticks after
`## Publish fold` and the next such line. `fleet/CONTRACT.md` line 62 names
`suite-<attempt>.txt` on the evidence branch and says nothing about the body's excerpt length,
so no document changes.
**BASE facts:** (generated at d26bbdc)
- `fleet/sandbox-boot.sh` blob f2adff7
- `fleet/tests/_sandbox_boot_helpers.mjs` blob bcf3734
- `FOLD_SUITE_TEXT` at `fleet/tests/_sandbox_boot_helpers.mjs:105` blob bcf3734
- `FOLD_SUITE_LAST` at `fleet/tests/_sandbox_boot_helpers.mjs:107` blob bcf3734
- `suiteRed` at `fleet/tests/test_sandbox_boot_merge.mjs:838` blob 6c66277
- `say` at `fleet/retire.mjs:372` blob 3c94125
- `body` at `fleet/claude-token.mjs:401` blob b7e8e7b
- `fleet/CONTRACT.md` blob e9965f2

**Proof:**
- Test: `fleet/tests/test_sandbox_boot_merge.mjs`
- Legs: (a) on the `suiteRed` boot, the fenced block of the pull request body contains the line
  `not ok 2 - the recorded text names the failing leg` — a `tail -n 20` of a file
  whose `not ok` line is the second of twenty-eight lacks it [M1]; (b) the fenced block's lines
  deep-equal `suite-1.txt`'s lines from its `not ok 2` line through `# fail 1`, and the body
  does not contain `ok 1 - join` [M2]; (c) `<evidence>/.ultrapowers/runs/7/publish-fold/suite-1.txt`
  read from the evidence worktree has twenty-eight lines, the first `ok 1 - join` and the last
  `# fail 1` — the record is whole while the body is the excerpt [M3]; (d) a boot
  with `STUB_FOLD_SUITE` set to `first line\nsecond line\nthird line` renders a fenced block
  whose lines are exactly those three [M4]; (e) the `suiteRed` boot's `fleet-boot.log` has no
  line containing `node DIRECT` [M5].
- Run: node fleet/tests/test_sandbox_boot_merge.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_sandbox_boot_selfmerge.mjs | grep -q 'ALL TESTS PASSED'
- Run: bash -n fleet/sandbox-boot.sh

**Stale-if:**
- path-absent: `fleet/sandbox-boot.sh`
- path-absent: `fleet/tests/_sandbox_boot_helpers.mjs`
- issue-closed: #763
