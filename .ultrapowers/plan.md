# Rip out the toolchain refusal

**Grammar:** claims-v1

**Claim:** `fleet/launch.mjs` carries no manifest ladder and no toolchain refusal;
`fleet/tests/test_launch_toolchain.mjs` is deleted; `launch.mjs`'s header no longer promises
the refusal; the rest of #648 (exam command, engine provenance, integration-hostile
advisories) is untouched. (elicited)

**Goal:** A pure deletion. Run-8 (PR #648, commit `cc5e24e`) shipped #645's option 1 as a
hard-coded six-rung manifest ladder in `fleet/launch.mjs` (`pytest.ini`, `pyproject.toml`
holding `[tool.pytest`, `package.json`, a `Makefile` with a `test:` rule, `go.mod`,
`Cargo.toml`) and a `Refusal` before the credential refresh and the plan push whenever the
first matching rung named a toolchain the sandbox lacks. The operator (2026-09-05): "This was
poorly implemented. Go and Rust were just meant to be examples, not specific cases. Better to
rip this plumbing out neatly and file an issue." So the ladder, its detector, the refusal and
the header paragraph that promises it leave `fleet/launch.mjs`, and the sim that exists only
to pin the refusal, `fleet/tests/test_launch_toolchain.mjs`, is deleted. Nothing is
redesigned: a target the sandbox cannot build fails on the VM with the runner's own words, as
before run-8, and #645 stays open for the general question. Everything else #648 shipped —
the `Exam command:` line and the integration-hostile advisories in `compile_plan.py`, the
exam command in `ultra_run.py`, the engine provenance on the launch line and its sim
`fleet/tests/test_launch_engine_source.mjs` — is byte-identical to BASE, and
`fleet/setup-script.mjs` is untouched. The plan-level Claim above is the issue's own
"Desired state" sentence, verbatim; the task carries it as a quoted claim.
**Closes:** #682

**Tech Stack:** Node 24 ESM (`fleet/launch.mjs`; the launch sims `fleet/tests/test_launch*.mjs`,
flat scripts that print the sentinel `ALL TESTS PASSED`, run singly as `node <file>` and
together as `node --test fleet/tests/test_launch*.mjs`, joined to the Python suite by
`tests/test_fleet_suite.py`, which globs `fleet/tests/test_*.mjs` so a deleted file simply
drops out of the list). Nothing is added to any dependency file.

**Spec:** #682 (the issue carries the design: the "Where it lives" trace and the "Desired
state" paragraph); #648 / commit `cc5e24e` is the change being reverted in part; #645 is the
question that stays open. There is no separate spec document.

**Parallelization rationale:** One wave, width 1. One task owns both files; nothing else in
the repository names the deleted symbols, so no edge is derived and nothing waits.

## Global Constraints

- The deletion is exact: the ladder, its detector, the refusal and the header paragraph that
  promises it leave `fleet/launch.mjs`, and no other line of that file changes — every other
  refusal, the engine provenance (`--engine`, `defaultEngineSha`, `ENGINE_URL`), the reap, the
  plan push and the lobby verb read as they did at BASE.
- The rest of #648 outside the fleet — the exam command and the integration-hostile
  advisories in `skills/ultrapowers/scripts/compile_plan.py`, the exam command in
  `skills/ultrapowers/scripts/ultra_run.py` — is byte-identical to BASE.
- Check: test "$(git hash-object skills/ultrapowers/scripts/compile_plan.py)" = b546e04f843c07ea52e7a1e95e62b6f00836afec
- Check: test "$(git hash-object skills/ultrapowers/scripts/ultra_run.py)" = 0a23e6b72f23cab4dd7260fb2d3fab24be26a636
- The sandbox's setup script and the lobby are untouched.
- Check: test "$(git hash-object fleet/setup-script.mjs)" = 1345f9e161f5eb032a687ed2f57e0ea5058b9e1e
- Check: test "$(git hash-object fleet/lobby.mjs)" = 2f6289f1de89b48f5090b6a40d11a3d10c34b8b4
- No file outside the task's own Files block is edited; no file is created.

**Acceptance:** suite — the committed suite is the verification.

### Task 1: The launcher carries no manifest ladder and no toolchain refusal

**Type:** implementation

**Files:**
- Modify: `fleet/launch.mjs`
- Modify: `fleet/tests/test_launch_toolchain.mjs`

**Claim:** `fleet/launch.mjs` carries no manifest ladder and no toolchain refusal;
`fleet/tests/test_launch_toolchain.mjs` is deleted; `launch.mjs`'s header no longer promises
the refusal; the rest of #648 (exam command, engine provenance, integration-hostile
advisories) is untouched. (quoted from #682)
Machine: M1. For each of the eleven tokens `TOOLCHAIN_LADDER`, `detectToolchainRung`,
'toolchain', 'rung', 'manifest', 'pytest.ini', 'pyproject.toml', 'package.json', 'Makefile',
'go.mod' and 'Cargo.toml', the number of lines of fleet/launch.mjs containing that token is
exactly 0. M2. The path fleet/tests/test_launch_toolchain.mjs is absent. M3. The leading
block comment of fleet/launch.mjs — line 1 through the first line that is exactly a space,
an asterisk and a slash — contains neither the word 'toolchain' nor the phrase 'Go, Rust'.
M4. The number of lines of fleet/launch.mjs containing the text new Refusal( is exactly 28,
one fewer than the 29 at BASE: the toolchain refusal is the one that went and no other
refusal went with it. M5. No file under fleet/, skills/ or tests/ contains the token
`TOOLCHAIN_LADDER`, and none contains the token `detectToolchainRung`. M6. The command
node --test fleet/tests/test_launch*.mjs exits 0, its summary reports fail 0 and a pass
count equal to the number of files the glob matches; and each of the five sims
fleet/tests/test_launch.mjs, fleet/tests/test_launch_effort.mjs,
fleet/tests/test_launch_engine_source.mjs, fleet/tests/test_launch_hold.mjs and
fleet/tests/test_launch_reaps.mjs, run singly as node <file>, exits 0 and prints the
sentinel ALL TESTS PASSED. M7. The engine-provenance sim fleet/tests/test_launch_engine_source.mjs
and the launch sim fleet/tests/test_launch.mjs are byte-identical to BASE: their
git hash-object values are 6e7079b7e0458b527ce3e9e20a637d68c20affe3 and
9faf40b1e3ed606b2283c829c0115a74057be9be. M8. The two files that carry #648's exam
command and its integration-hostile advisories, skills/ultrapowers/scripts/compile_plan.py
and skills/ultrapowers/scripts/ultra_run.py, are byte-identical to BASE: their
git hash-object values are b546e04f843c07ea52e7a1e95e62b6f00836afec and
0a23e6b72f23cab4dd7260fb2d3fab24be26a636.

**Authorized-by:** #682 ("Desired state": "`fleet/launch.mjs` carries no manifest ladder and
no toolchain refusal; `fleet/tests/test_launch_toolchain.mjs` is deleted"); the operator's
words of 2026-09-05 quoted in its body ("Better to rip this plumbing out neatly and file an
issue").

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** Three regions of `fleet/launch.mjs` go, and nothing else in it changes. (1) The
header paragraph at lines 43–46, the four comment lines beginning `A target whose toolchain
the sandbox lacks is a refusal for the same reason` and ending `in the VM's preflight.`, plus
the blank ` *` line that separates it from the `A refusal (exit 2)` paragraph — the header's
remaining paragraphs are untouched. (2) Lines 150–185: the doc comment beginning `The
preflight's `detect_test_cmd` ladder`, the frozen `TOOLCHAIN_LADDER` array, the doc comment
beginning `The ladder's first matching rung`, and `async function detectToolchainRung
(repoDir)` — everything between the `ORIGIN_SPELLINGS` array and `export function
targetOfOriginUrl`, leaving one blank line between them. (3) Lines 330–336 inside `launch()`:
the comment `// Say it up front (#645): …`, `const rung = await detectToolchainRung(repoDir)`
and the `if (rung?.toolchain) { throw new Refusal(…) }` block that follows the origin check
and precedes `const baseCheck`. The `fsp` import stays: it is used by the plan read
(`fsp.readFile(planPath …)`), the verdicts read and the `mkdtemp` for the plan index.
`fleet/tests/test_launch_toolchain.mjs` is deleted whole (`git rm`); its leg (f) pinned the
usage flags, which `tests/test_docs_agree_with_code.py` already pins against the four
operator documents, so nothing is lost. The launch sims are flat scripts, not `node:test`
suites; `node --test` runs each file as one test and counts it as passed when it exits 0,
so its summary lines read `pass <n>` and `fail 0`. Nothing else in the repository imports
`TOOLCHAIN_LADDER` or `detectToolchainRung` (neither is exported); the only other mentions
of the sim's name are under `docs/superpowers/plans/`, which is untracked and absent from
the sandbox. `fleet/setup-script.mjs`, `fleet/lobby.mjs`, `fleet/tests/test_launch.mjs`,
`fleet/tests/test_launch_engine_source.mjs`, `skills/ultrapowers/scripts/compile_plan.py` and
`skills/ultrapowers/scripts/ultra_run.py` are not to be touched. The `Refusal` class is `fleet/lobby.mjs`'s and stays
imported: 28 `new Refusal(` sites remain in `fleet/launch.mjs` after the one at line 333
goes.
**BASE facts:** (generated at e04154b)
- `fleet/launch.mjs` blob a2bcd04
- `fleet/tests/test_launch_toolchain.mjs` blob fce9aad
- `TOOLCHAIN_LADDER` at `fleet/launch.mjs:159` blob a2bcd04
- `detectToolchainRung` at `fleet/launch.mjs:173` blob a2bcd04
- `detect_test_cmd` at `skills/ultrapowers/scripts/ultra_run.py:55` blob 0a23e6b
- `tests/test_docs_agree_with_code.py` blob c9687c7
- `fleet/setup-script.mjs` blob 1345f9e
- `fleet/lobby.mjs` blob 2f6289f
- `fleet/tests/test_launch.mjs` blob 9faf40b
- `fleet/tests/test_launch_engine_source.mjs` blob 6e7079b
- `Refusal` at `fleet/lobby.mjs:261` blob 2f6289f

**Proof:**
- Run: test "$(grep -c 'TOOLCHAIN_LADDER' fleet/launch.mjs)" = 0
- The previous bullet is the first token row: the ladder's name is absent, exactly zero lines [M1].
- Run: test "$(grep -c 'detectToolchainRung' fleet/launch.mjs)" = 0
- The previous bullet is the second row: the detector's name is absent, exactly zero lines [M1].
- Run: test "$(grep -c 'toolchain' fleet/launch.mjs)" = 0
- The previous bullet is the third row: the word is absent, exactly zero lines — the header paragraph, the ladder's doc comment, the `toolchain:` keys and the refusal's message all carried it [M1].
- Run: test "$(grep -c 'rung' fleet/launch.mjs)" = 0
- The previous bullet is the fourth row: the token rung is absent, exactly zero lines [M1].
- Run: test "$(grep -c 'manifest' fleet/launch.mjs)" = 0
- The previous bullet is the fifth row: the token manifest is absent, exactly zero lines [M1].
- Run: test "$(grep -c 'pytest.ini' fleet/launch.mjs)" = 0
- The previous bullet is the sixth row: the first rung's manifest is absent, exactly zero lines [M1].
- Run: test "$(grep -c 'pyproject.toml' fleet/launch.mjs)" = 0
- The previous bullet is the seventh row: the second rung's manifest is absent, exactly zero lines [M1].
- Run: test "$(grep -c 'package.json' fleet/launch.mjs)" = 0
- The previous bullet is the eighth row: the third rung's manifest is absent, exactly zero lines [M1].
- Run: test "$(grep -c 'Makefile' fleet/launch.mjs)" = 0
- The previous bullet is the ninth row: the fourth rung's manifest is absent, exactly zero lines [M1].
- Run: test "$(grep -c 'go.mod' fleet/launch.mjs)" = 0
- The previous bullet is the tenth row: the fifth rung's manifest is absent, exactly zero lines [M1].
- Run: test "$(grep -c 'Cargo.toml' fleet/launch.mjs)" = 0
- The previous bullet is the eleventh row: the sixth rung's manifest is absent, exactly zero lines [M1].
- Run: test ! -e fleet/tests/test_launch_toolchain.mjs
- The previous bullet fails when the sim exists in any form; it passes only when the path is absent [M2].
- Run: test "$(awk 'NR==1,/^ \*\//' fleet/launch.mjs | grep -c 'toolchain')" = 0
- The previous bullet reads only the leading block comment, line 1 through its closing line, and finds exactly zero lines holding the word toolchain [M3].
- Run: test "$(awk 'NR==1,/^ \*\//' fleet/launch.mjs | grep -c 'Go, Rust')" = 0
- The previous bullet reads the same block and finds exactly zero lines holding the phrase Go, Rust — the paragraph that promised the refusal is absent [M3].
- Run: test "$(grep -c 'new Refusal(' fleet/launch.mjs)" = 28
- The previous bullet counts the refusal sites: exactly 28, where BASE had 29 — one gone, no other [M4].
- Run: test "$(grep -rl 'TOOLCHAIN_LADDER' fleet skills tests | wc -l | tr -d ' ')" = 0
- The previous bullet sweeps the three source trees for the ladder's name and finds no file — exactly zero [M5].
- Run: test "$(grep -rl 'detectToolchainRung' fleet skills tests | wc -l | tr -d ' ')" = 0
- The previous bullet sweeps the same trees for the detector's name and finds no file — exactly zero [M5].
- Run: out=$(node --test fleet/tests/test_launch*.mjs 2>&1) && n=$(ls fleet/tests/test_launch*.mjs | wc -l | tr -d ' ') && printf '%s\n' "$out" | grep -q "pass $n" && printf '%s\n' "$out" | grep -q 'fail 0'
- The previous bullet is the launch sims together: a non-zero exit fails the and-chain first, then the pass count must equal the glob's file count exactly, then the summary must say fail 0 [M6].
- Run: out=$(node fleet/tests/test_launch.mjs) && printf '%s\n' "$out" | grep -q 'ALL TESTS PASSED'
- The previous bullet is the launch sim singly: a non-zero exit fails it, and so does a missing sentinel [M6].
- Run: out=$(node fleet/tests/test_launch_effort.mjs) && printf '%s\n' "$out" | grep -q 'ALL TESTS PASSED'
- The previous bullet is the effort sim singly, exit code first, then the sentinel, either failing it [M6].
- Run: out=$(node fleet/tests/test_launch_engine_source.mjs) && printf '%s\n' "$out" | grep -q 'ALL TESTS PASSED'
- The previous bullet is the engine-provenance sim singly — #648's other launch-side change — exit code first, then the sentinel, either failing it [M6].
- Run: out=$(node fleet/tests/test_launch_hold.mjs) && printf '%s\n' "$out" | grep -q 'ALL TESTS PASSED'
- The previous bullet is the hold sim singly, exit code first, then the sentinel, either failing it [M6].
- Run: out=$(node fleet/tests/test_launch_reaps.mjs) && printf '%s\n' "$out" | grep -q 'ALL TESTS PASSED'
- The previous bullet is the reap sim singly, exit code first, then the sentinel, either failing it [M6].
- Run: test "$(git hash-object fleet/tests/test_launch_engine_source.mjs)" = 6e7079b7e0458b527ce3e9e20a637d68c20affe3
- The previous bullet is the engine-provenance sim's blob, exactly BASE's: any edit to it fails the comparison [M7].
- Run: test "$(git hash-object fleet/tests/test_launch.mjs)" = 9faf40b1e3ed606b2283c829c0115a74057be9be
- The previous bullet is the launch sim's blob, exactly BASE's: any edit to it fails the comparison [M7].
- Run: test "$(git hash-object skills/ultrapowers/scripts/compile_plan.py)" = b546e04f843c07ea52e7a1e95e62b6f00836afec
- The previous bullet is the compiler's blob — the Exam command line and the integration-hostile advisories live there — exactly BASE's: any edit to it fails the comparison [M8].
- Run: test "$(git hash-object skills/ultrapowers/scripts/ultra_run.py)" = 0a23e6b72f23cab4dd7260fb2d3fab24be26a636
- The previous bullet is the preflight's blob — the exam command's runtime half lives there — exactly BASE's: any edit to it fails the comparison [M8].

**Stale-if:**
- path-absent: `fleet/launch.mjs`
- path-absent: `fleet/tests/test_launch_toolchain.mjs`
- issue-closed: #682
