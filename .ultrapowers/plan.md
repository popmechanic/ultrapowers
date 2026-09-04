# Exam shapes and laptop-side refusals

**Grammar:** claims-v1

**Claim:** After this run, when my plan asks for peer review on a project whose tests the
fleet cannot run, the compiler refuses and tells me why before I launch; a plan can name its
own exam runner and the fleet uses it; the launcher refuses a Go or Rust project by name
instead of letting the VM die; and the launch line shows me which engine I am about to run.
(elicited)

**Goal:** Close the laptop-side half of the walk-3 findings: #644 (peer review is silently
inert on any project whose test files match none of three hard-coded shapes), #645 (the
sandbox installs node, bun and pytest only, and a Go or Rust target dies on the VM), #631's
compiler half (an advisory for the two `Run:` shapes that are correct in a task's clone and
wrong on the fold by construction), #636 (the engine sha is main's tip and nothing says so)
and #637 (`compile_plan.py --base` wants a checkout directory and its messages do not say
so). Every change is on the laptop or in the compiler; nothing under `fleet/` but
`launch.mjs` is touched, and the sandbox's setup script is byte-identical to BASE.

**Tech Stack:** Python 3 (the compiler and the preflight, `python3 -m pytest` with
`pytest-xdist`), Node 24 ESM (`fleet/launch.mjs` and its sims under `fleet/tests/`, each
printing `ALL TESTS PASSED`), Markdown. Nothing is added to any dependency file.

**Spec:** #644, #645, #631, #636, #637 (the issues carry the design; there is no separate
spec document).

**Parallelization rationale:** One wave, width 5. Tasks 1, 3 and 5 all modify
`skills/ultrapowers/scripts/compile_plan.py`, Tasks 2 and 4 both modify `fleet/launch.mjs`,
and Tasks 1 and 3 both modify `skills/ultrawrite/SKILL.md` — every overlap is a text edit in
a distinct region (a new header parser and the exam derivation; a new proof-species render;
two message strings; a manifest check before the credential refresh; a line in the launch
render) and folds at the merge. No task consumes a sibling's symbol, so no edge is derived and
no task waits. Each task's exam is a new test file, so no two examiners write one file.

## Global Constraints

- The frozen verification periphery is byte-identical to BASE.
- Check: test "$(git hash-object skills/ultrapowers/scripts/gate_check.py)" = fc6e5dcf7c507643e603b69f605d1fd7da82d5f3
- Check: test "$(git hash-object skills/ultrapowers/scripts/ultra_gate.py)" = 949bf784a10c7414880887cddaf9132c1415de7e
- Check: test "$(git hash-object skills/ultrapowers/scripts/run_acceptance.sh)" = 8ef475ac74f0ced637201c3d801de90dd4652eea
- The sandbox's setup script is untouched: `fleet/setup-script.mjs` is byte-identical to BASE.
- Check: test "$(git hash-object fleet/setup-script.mjs)" = 1345f9e161f5eb032a687ed2f57e0ea5058b9e1e
- The existing compiler, preflight and launcher exams keep passing in every clone.
- Check: python3 -m pytest -q -p no:cacheprovider tests/test_compile_plan_task_test_cmd.py tests/test_ultra_run_task_test_cmds.py tests/test_compile_plan_proof_species.py tests/test_compile_plan_claims.py tests/test_docs_agree_with_code.py tests/test_proof_modes_documented.py tests/test_recommendation_rubric.py
- Check: node fleet/tests/test_launch.mjs | grep -q 'ALL TESTS PASSED'
- Check: node fleet/tests/test_doctor.mjs | grep -q 'ALL TESTS PASSED'
- `fleet/launch.mjs` gains no new flag: its usage string names the same flags as BASE, so
  `tests/test_docs_agree_with_code.py` keeps passing without a SKILL.md edit.
- No shouted imperative (an all-caps MUST, NEVER or ALWAYS as a whole word) is added to
  `skills/ultrawrite/SKILL.md`.
- No file outside a task's own Files block is edited; in particular `fleet/run-engine.mjs`,
  `fleet/sandbox-boot.sh`, `fleet/doctor.mjs`, `skills/ultrapowers/SKILL.md` and
  `skills/ultrapowers/references/first-run.md` are byte-identical to BASE.
- Nothing in the repository calls the Anthropic API directly or reads `ANTHROPIC_API_KEY`.
- Check: ! git grep -n 'ANTHROPIC_API_KEY' -- fleet/launch.mjs skills/ultrapowers/scripts/compile_plan.py skills/ultrapowers/scripts/ultra_run.py (minor)

**Acceptance:** suite — the committed suite is the verification.

### Task 1: The exam command — silence refused, a declared runner accepted

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `skills/ultrapowers/scripts/compile_plan.py`
- Modify: `skills/ultrapowers/scripts/ultra_run.py`
- Modify: `skills/ultrawrite/SKILL.md`
- Test: `tests/test_compile_plan_exam_command.py`
- Test: `tests/test_ultra_run_exam_command.py`

**Claim:** When my plan asks for peer review on a project whose tests the fleet cannot run,
the compiler refuses and tells me why before I launch; a plan can name its own exam runner
and the fleet uses it. (derived)
Machine: M1. `compile_plan.py --check` on a claims-v1 plan whose header carries no
`**Exam command:**` line and whose `**Review:** peer` task names a Proof `Test:` path that
matches none of the three built-in shapes (`fleet/tests/test_*.mjs`, `tests/**/*.py`,
`tests/**/*.test.ts`) exits 2 and prints a violation line that begins `exam-shape: task <id>`,
names that path, and contains the words `Exam command`. M2. The same plan with that task
unmarked (lean), and the same plan with every `Test:` path in a built-in shape, each print
`PLAN OK` and exit 0 — the refusal fires only for the pair peer-and-unmatched. M3. A header
line `**Exam command:** <template>` whose template contains the token `{paths}` exactly once
makes the emitted `waves[][].testCmd` of every task that names at least one Proof `Test:` path
equal to the template with `{paths}` replaced by that task's `Test:` paths, space-joined in
Proof order; a task naming no `Test:` path keeps `testCmd` null; and when the header line is
absent the built-in derivation answers exactly as at BASE. M4. An `**Exam command:**` line
whose template carries `{paths}` zero times or more than once is a violation beginning
`exam-command:` and `--check` exits 2. M5. `ultra_run.py --validate-knobs` probes a per-task
`testCmd` whose text starts with none of the three built-in runner prefixes
(`python3 -m pytest`, `node `, `bun test`) by whether its first whitespace-delimited word
resolves on PATH: the reported `runner` is that word, `ok` is true when it resolves and false
when it does not, and a false `ok` makes the validation exit non-zero; and for each of the
three built-in prefixes `runner_for` still answers the table's runner label with its
`--version` probe argv. M6.
`skills/ultrawrite/SKILL.md`'s `## The document` section names the `**Exam command:**` header
line and the `{paths}` token.

**Authorized-by:** #644 (decisions 1 and 2, first option: "the plan declares the exam command
as a template beside `Tech Stack:`"; "Make silence impossible first").

**Interfaces:**
- Consumes: none
- Produces: `parse_exam_command(md_text: str) -> str | None`
- Produces: `exam_command_violations(md_text: str) -> list[str]`

**Context:** The derivation lives in `derive_task_test_cmd(proof_tests)` in
`compile_plan.py` (the three regexes `MJS_PROOF_TEST_RE`, `PY_PROOF_TEST_RE`,
`BUN_PROOF_TEST_RE` sit just above it, and the whole command is None when any path matches
none of them); the emitted wave entry sets `"testCmd": derive_task_test_cmd(...)` beside
`"proofTests"`, and `"review"` on the same entry is `peer` or `lean` (the `**Review:**`
marker, alias `adversarial` normalized to `peer`). A header line is read the way
`_plan_claim_raw` reads `**Claim:**`: the header is everything before the first task heading,
fence-aware, and the value runs to the next blank line or bold marker with wrapped lines joined
on one space. The substitution token is the literal `{paths}`; the template is otherwise the
operator's own text (`bun test {paths}`, `npx vitest run {paths}`, `go test {paths}`) and the
compiler does not inspect its first word. A refusal is a `grammar_violations` entry — the
`--check` path prints every violation, then `N violation(s)`, and exits 2; the plan-level
violations are gathered where `plan_claim_violations(plan_text)` is added to the task ones.
Both violation texts begin with their species word so a test can pin them: `exam-shape: task
<id> — Review: peer, but no exam command derives from <path>; name an **Exam command:** line in
the plan header or use a shape the table knows`, and `exam-command: the template must carry
{paths} exactly once`. A `**Review:** peer` task whose Proof names no `Test:` path at all is
not refused — its peer review is the second reviewer, and it never had an exam to lose.
In `ultra_run.py`, `TASK_RUNNERS` is a tuple of `(prefix, runner, probe_argv)` rows and
`runner_for(cmd)` returns `(None, None)` for a command matching no prefix, which
`probe_task_test_cmds` records as `{"cmd", "runner": None, "ok": False}`; the new rule replaces
that fall-through for a non-empty command: runner = the first word, probe = `["/bin/sh", "-c",
"command -v <word>"]`, verdict shared per runner as today. Each probe runs in the throwaway
worktree with the validator's existing environment; a test controls PATH by prepending a
temporary directory holding an executable stub. The engine reads `task.testCmd` as an opaque
string and is untouched by this task. The ultrawrite sentence goes in the paragraph that lists
the header lines (`**Grammar:**`, `**Claim:**`, `**Goal:**`, `**Tech Stack:**`), one or two
sentences, and the existing `tests/test_proof_modes_documented.py` still validates the skill.
**BASE facts:** (generated at 13c0e15)
- `testCmd` at `fleet/run-engine.mjs:522` blob 5ac1fbf
- `ok` at `fleet/tests/test_claude_token.mjs:48` blob 3a21313
- `runner_for` at `skills/ultrapowers/scripts/ultra_run.py:247` blob 2fca05c
- `skills/ultrawrite/SKILL.md` blob 6c9fb5d
- `_plan_claim_raw` at `skills/ultrapowers/scripts/compile_plan.py:310` blob ed54d98
- `probe_task_test_cmds` at `skills/ultrapowers/scripts/ultra_run.py:256` blob 2fca05c
- `tests/test_proof_modes_documented.py` blob 9359f16
- `skills/ultrapowers/scripts/compile_plan.py` blob ed54d98
- `skills/ultrapowers/scripts/ultra_run.py` blob 2fca05c

**Proof:**
- Test: `tests/test_compile_plan_exam_command.py`
- Test: `tests/test_ultra_run_exam_command.py`
- Legs: (a) a claims-v1 plan written to a temporary directory with one `**Review:** peer` task
  whose Proof names `Test: src/widget.test.js` and no `**Exam command:**` line: `--check` exits
  2 and its stdout carries a line beginning `exam-shape: task` that contains
  `src/widget.test.js` and `Exam command` [M1]; (b) the same plan with the `**Review:**` line
  deleted prints `PLAN OK` and exits 0, and the same plan with the path changed to
  `tests/widget.test.ts` prints `PLAN OK` and exits 0 [M2]; (c) a plan with the header line
  `**Exam command:** npx vitest run {paths}` and five tasks — one naming `Test:
  src/a.test.js` and `Test: src/b.test.js` in that order, one naming `Test: tests/c.py`, one
  naming `Test: fleet/tests/test_x.mjs`, one naming `Test: tests/a.test.ts`, one naming only a
  `Run:` — compiles with `--emit-args` to `testCmd` values `npx vitest run src/a.test.js
  src/b.test.js`, `npx vitest run tests/c.py`, `npx vitest run fleet/tests/test_x.mjs`, `npx
  vitest run tests/a.test.ts` and null respectively, and the same five tasks with the header
  line removed emit null, `python3 -m pytest -q tests/c.py`, `node fleet/tests/test_x.mjs`,
  `bun test tests/a.test.ts` and null — one row per built-in shape [M3]; (d) a header line `**Exam command:** npx vitest run` and a header line
  `**Exam command:** {paths} {paths}` each make `--check` exit 2 with a line beginning
  `exam-command:` [M4]; (e) an args file whose one task carries `testCmd: "zig test
  tests/x.zig"` validates with `ok: true` and `runner: "zig"` when a temporary directory
  holding an executable `zig` is prepended to PATH, and exits non-zero with `ok: false` and
  `runner: "zig"` when it is not; and `runner_for` answers, for `python3 -m pytest -q
  tests/x.py`, `node fleet/tests/test_x.mjs` and `bun test tests/a.test.ts` in turn, the pairs
  (`python3 -m pytest`, `[python3, -m, pytest, --version]`), (`node`, `[node, --version]`) and
  (`bun test`, `[bun, --version]`), and for `zig test tests/x.zig` a runner of `zig` [M5]; (f)
  the previous legs' pytest files pass.
- Run: python3 -m pytest -q -p no:cacheprovider tests/test_compile_plan_exam_command.py tests/test_ultra_run_exam_command.py
- The previous bullet runs both exams; a red leg fails it [M1] [M2] [M3] [M4] [M5].
- Run: sed -n '/^## The document/,/^## Task shape/p' skills/ultrawrite/SKILL.md | grep -q 'Exam command'
- The previous bullet reads only the `## The document` section, so a mention elsewhere in
  the skill does not satisfy it [M6].
- Run: sed -n '/^## The document/,/^## Task shape/p' skills/ultrawrite/SKILL.md | grep -q '{paths}'
- The previous bullet is the token half of the same section [M6].

**Stale-if:**
- path-absent: `skills/ultrapowers/scripts/compile_plan.py`
- path-absent: `skills/ultrapowers/scripts/ultra_run.py`
- issue-closed: #644

### Task 2: The launcher refuses a target whose toolchain the sandbox lacks

**Type:** implementation

**Files:**
- Modify: `fleet/launch.mjs`
- Test: `fleet/tests/test_launch_toolchain.mjs`

**Claim:** The launcher refuses a Go or Rust project by name instead of letting the VM die.
(derived)
Machine: M1. `launch()` against a `--repo` checkout whose working tree holds a `go.mod` and
none of `pytest.ini`, a `pyproject.toml` containing `[tool.pytest`, or `package.json`, throws
a `Refusal` whose message contains `toolchain go` and `go.mod`. M2. The same with a
`Cargo.toml` in place of `go.mod` throws a `Refusal` whose message contains `toolchain cargo`
and `Cargo.toml`. M3. The same with a `Makefile` carrying a line matching `^test\s*:` in
place of `go.mod` throws a `Refusal` whose message contains `toolchain make` and `Makefile`.
M4. Each of those refusals is raised before the credential refresh, before the plan commit
is pushed and before any lobby verb: the exec seam records no `git push` and no `new`
invocation. M5. A checkout holding `package.json` beside `go.mod` is not refused on the
toolchain (the ladder's earlier rung wins), and a checkout holding none of the six manifests
is not refused on the toolchain. M6. The usage string of `fleet/launch.mjs` names no new
flag.

**Authorized-by:** #645 (decision 1, "Say it up front", the recommended option).

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** The sandbox's setup script installs node, bun and `python3-pytest` only, and
the preflight's `detect_test_cmd` ladder in `skills/ultrapowers/scripts/ultra_run.py` is
wider; the launcher mirrors that ladder's order exactly, on the `--repo` working tree:
`pytest.ini` → `pyproject.toml` containing `[tool.pytest` → `package.json` → a `Makefile`
with a line matching `^test\s*:` → `go.mod` → `Cargo.toml`. The first three rungs are
toolchains the sandbox has; the last three are not, and the first rung that matches decides,
so a `package.json` beside a `go.mod` is a Node target. The check sits in `launch()` after
the argument validation block (the `Refusal`s for `--target`, `--base`, `--engine`,
`--overlap`) and the `--repo` origin check, and before `refreshCredential()` and
`commitPlan`. The message names the toolchain word, the manifest that detected it, and the
fact that the sandbox installs node, bun and pytest only, in one sentence, e.g. `launch:
the target needs toolchain go (go.mod at the checkout root) and the sandbox installs node,
bun and pytest only — the fleet builds Python, Node and Bun targets today (#645)`. The sim
`fleet/tests/test_launch.mjs` builds its fixture with `workspace()` — a bare origin and a
clone whose `origin` is spelled like a real target's — and drives `launch()` through the
exec seam that records every argv; the new sim builds the same fixture (its helpers are in
that file and in `_lobby_helpers.mjs`) and writes the manifest files into the clone before
calling `launch()`. A `Refusal` and a `LobbyError` are the two error classes `launch.mjs`
already exports.
**BASE facts:** (generated at 13c0e15)
- `pytest.ini` blob 251eb61
- `Refusal` at `fleet/lobby.mjs:261` blob 8239e76
- `fleet/launch.mjs` blob 4404cdb
- `detect_test_cmd` at `skills/ultrapowers/scripts/ultra_run.py:54` blob 2fca05c
- `skills/ultrapowers/scripts/ultra_run.py` blob 2fca05c
- `commitPlan` at `fleet/launch.mjs:396` blob 4404cdb
- `fleet/tests/test_launch.mjs` blob 9faf40b
- `origin` at `fleet/tests/_lobby_helpers.mjs:137` blob 86c4674
- `LobbyError` at `fleet/lobby.mjs:274` blob 8239e76
- `push` at `fleet/launch.mjs:308` blob 4404cdb

**Proof:**
- Test: `fleet/tests/test_launch_toolchain.mjs`
- Legs: (a) a clone with `go.mod` alone: `launch()` rejects with a `Refusal` whose message
  contains `toolchain go` and `go.mod` [M1]; (b) a clone with `Cargo.toml` alone: `Refusal`
  containing `toolchain cargo` and `Cargo.toml` [M2]; (c) a clone with a `Makefile` whose
  only rule is `test:` and nothing else: `Refusal` containing `toolchain make` and `Makefile`
  [M3]; (d) in each of the previous three legs the recorded argv list holds no entry whose
  verb is `push` and none whose verb is `new`, and the credential refresh was not invoked
  [M4]; (e) a clone with `package.json` (an empty object) beside `go.mod` reaches the plan
  push (the recorded argv holds a `push`), and a clone with no manifest at all reaches the
  plan push [M5]; (f) the sim prints `ALL TESTS PASSED`.
- Run: node fleet/tests/test_launch_toolchain.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the sim's sentinel; a red leg omits it [M1] [M2] [M3] [M4] [M5].
- Run: python3 -m pytest -q -p no:cacheprovider tests/test_docs_agree_with_code.py
- The previous bullet is the usage pin: every flag SKILL.md teaches is in the usage string and
  the string gained none it does not teach [M6].

**Stale-if:**
- path-absent: `fleet/launch.mjs`
- path-absent: `fleet/tests/test_launch.mjs`
- issue-closed: #645

### Task 3: An advisory for the two integration-hostile `Run:` shapes

**Type:** implementation

**Files:**
- Modify: `skills/ultrapowers/scripts/compile_plan.py`
- Modify: `skills/ultrawrite/SKILL.md`
- Test: `tests/test_compile_plan_integration_hostile.py`

**Claim:** a compiler advisory for the integration-hostile shapes (a `Run:` carrying
`--collect-only` with an absolute number, `test ! -e <dir>`) (quoted from #631)
Machine: M1. Under `--check --renders`, a `Run:` command whose text carries `--collect-only`
and, in the segment before its first `|`, no token containing `/` or ending in `.py`, and
that compares against a bare integer (`= <digits>`, `== <digits>` or `-eq <digits>`), draws
one line `ADVISORY proof-species: suite-total-pin — task <id>: <detail>` whose detail carries
the command's text. M2. Under `--check
--renders`, a `Run:` command of the form `test ! -e <path>` or `test ! -d <path>` whose
path's last segment carries no `.` draws one line `ADVISORY proof-species:
directory-absence-pin — task <id>: <detail>` whose detail carries the command's text. M3. A `Run:` whose collect-only
segment names a `.py` path (`pytest --collect-only -q tests/x.py | grep -c ::` compared to an
integer), and a `test ! -e` on a path whose last segment has a dot, draw neither line; and no
line of either species changes the exit code — `PLAN OK` still prints and the exit is 0.
M4. The ultrawrite skill's sentence listing the proof species names both new species.

**Authorized-by:** #631 (option (b)); the gotchas record for run-4 (absolute collected-count
pins are integration-hostile).

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** The species render lives in `compile_plan.py` around `_species_line(species,
task_id, detail, leg=None)` (line ~2830 at BASE), which formats `ADVISORY proof-species:
<species> — task <id>, leg <n>: <detail>`; the five existing species are
`run-chained-semicolon`, `leg-named-in-prose`, `default-unpinned`,
`universal-as-count-floor` and `duration-without-clock`, each appended by the same render
function that walks a task's `Run:` commands with `_clip_run` for the detail. The render is
registered under the name `proof-species` and prints only under `--renders`
(`tests/test_compile_plan_proof_species.py` shows how a plan in a temporary git checkout is
compiled with `--check --renders --base <dir>` and how a species line is asserted). The two
new species append to the same list, after the existing five, in the same walk. The why, for
the detail text: since #604 the driver re-runs every merged task's `Run:` on the adopted
tree, where every sibling's changes have folded in, so a suite total is wrong by construction
and a bare directory can survive as a `__pycache__`. The ultrawrite sentence to extend is the
one in `## The proof gate — before any compile` that begins "The `ADVISORY proof-species:`
lines of `compile_plan.py --check --renders` name the rejection species found by hand" — add
the two names to its list; `tests/test_proof_modes_documented.py` keeps validating the skill.
**BASE facts:** (generated at 13c0e15)
- `_clip_run` at `skills/ultrapowers/scripts/compile_plan.py:2823` blob ed54d98
- `tests/test_compile_plan_proof_species.py` blob 4663225
- `tests/test_proof_modes_documented.py` blob 9359f16

**Proof:**
- Test: `tests/test_compile_plan_integration_hostile.py`
- Legs: (a) a plan whose Task 1 carries `Run: test "$(python3 -m pytest --collect-only -q |
  tail -1 | cut -d' ' -f1)" = 1461` prints exactly one line that begins `ADVISORY
  proof-species: suite-total-pin — task 1: ` and whose remainder contains that whole `Run:`
  command verbatim (`test "$(python3 -m pytest --collect-only -q | tail -1 | cut -d' ' -f1)"
  = 1461`, 74 characters, under the 80-character clip), and the same with `-eq 1461` prints
  one, and the same with `== 1461` prints one [M1]; (b) a plan whose Task 1 carries `Run:
  test ! -e tests/drainprobe` prints exactly one line that begins `ADVISORY proof-species:
  directory-absence-pin — task 1: ` and whose remainder contains `test ! -e tests/drainprobe`
  verbatim, and the same with `test ! -d tests/drainprobe` prints one too [M2]; (c) a plan whose task
  carries `Run: test "$(python3 -m pytest --collect-only -q tests/test_x.py | grep -c ::)" =
  7` and `Run: test ! -e tests/drainprobe.py` prints no `suite-total-pin` line and no
  `directory-absence-pin` line, and every plan in this exam prints `PLAN OK` and exits 0 [M3].
- Run: python3 -m pytest -q -p no:cacheprovider tests/test_compile_plan_integration_hostile.py tests/test_compile_plan_proof_species.py
- The previous bullet runs the new exam beside the existing species exam, which pins the five
  species already rendered [M1] [M2] [M3].
- Run: sed -n '/^## The proof gate/,/^## The worktree-pure contract/p' skills/ultrawrite/SKILL.md | tr '\n' ' ' | grep -q 'found by hand.*suite-total-pin.*directory-absence-pin'
- The previous bullet reads only the proof-gate section, joins its wrapped lines, and requires
  both names after the phrase that opens the species sentence — a name written anywhere else
  in the skill does not satisfy it [M4].

**Stale-if:**
- path-absent: `tests/test_compile_plan_proof_species.py`
- issue-closed: #631

### Task 4: The launch line says which engine, and whether it was pinned

**Type:** implementation

**Files:**
- Modify: `fleet/launch.mjs`
- Test: `fleet/tests/test_launch_engine_source.mjs`

**Claim:** The launch line shows me which engine I am about to run. (derived)
Machine: M1. A `launch()` without `--engine` returns a result whose `engineSource` is
`"main-tip"`, and `renderLaunch(result)` carries a line reading `engine=<40-hex> (main tip;
pass --engine <40-hex> to pin)` with the sha the launcher read from `git ls-remote`. M2. A
`launch()` with `--engine <sha>` returns `engineSource` `"pinned"`, and `renderLaunch(result)`
carries a line reading `engine=<sha> (pinned)`. M3. The `--json` result object carries
`engineSource`, and the assignment comment the launcher writes is byte-identical in shape to
BASE's — `engine=<sha>` inside the comment, with no annotation — so the existing launch sim
still passes.

**Authorized-by:** #636 (option (a): "the launcher prints `engine=<sha> (main tip; pass
--engine to pin)` so it is at least visible").

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** `defaultEngineSha(exec)` in `fleet/launch.mjs` reads `git ls-remote <ENGINE_URL>
HEAD`; `launch()` sets `const engine = opts.engine ?? await defaultEngineSha(exec)`, and
`renderLaunch(result)` joins the result's fields with newlines for the non-`--json` path
(`main` writes `renderLaunch(result)` or `JSON.stringify(result)`). The comment is built by
`buildComment({ ...fields, run, plan: planSha, engine })` and the sim
`fleet/tests/test_launch.mjs` pins its exact text (`run=1 plan=… target=… base=…
engine=<sha>`), so the annotation is a separate rendered line, never part of the comment.
The sim's exec seam answers `ls-remote` with a fixed tip (see "The engine tip, when a launch
reads it rather than taking `--engine`" in that file); the new sim reuses that fixture shape.
The `result` object is what `--json` prints, so the new field rides both paths with one
assignment.
**BASE facts:** (generated at 13c0e15)
- `fleet/launch.mjs` blob 4404cdb
- `main` at `docs/scripts/render_post_media.py:84` blob 869c41e
- `fleet/tests/test_launch.mjs` blob 9faf40b
- `result` at `fleet/doctor.mjs:468` blob 7e35dcd

**Proof:**
- Test: `fleet/tests/test_launch_engine_source.mjs`
- Legs: (a) a launch whose argv carries no `--engine`: `result.engineSource` is `main-tip`,
  `result.engine` is the sha the seam answered for `ls-remote`, and `renderLaunch(result)`
  contains the line `engine=<that sha> (main tip; pass --engine <40-hex> to pin)` [M1]; (b) a
  launch with `--engine <sha>`: `result.engineSource` is `pinned` and `renderLaunch(result)`
  contains `engine=<sha> (pinned)` [M2]; (c) in both legs the recorded `new` argv's comment
  carries `engine=<sha>` followed by a space or the closing quote, never by `(` [M3]; (d) the
  sim prints `ALL TESTS PASSED`.
- Run: node fleet/tests/test_launch_engine_source.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the new sim's sentinel [M1] [M2] [M3].
- Run: node fleet/tests/test_launch.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the existing sim, whose comment pin fails if the annotation leaks
  into the comment [M3].

**Stale-if:**
- path-absent: `fleet/launch.mjs`
- issue-closed: #636

### Task 5: `--base` says it wants a checkout directory

**Type:** implementation

**Files:**
- Modify: `skills/ultrapowers/scripts/compile_plan.py`
- Test: `tests/test_compile_plan_base_message.py`

**Claim:** Fix is the message text (say `--base <checkout-dir>`), not the diagnostic
vocabulary. (quoted from #637)
Machine: M1. `compile_plan.py --help` prints, in the `--base` entry, the text `<checkout-dir>`.
M2. The same-file advisory (`ADVISORY grammar: same-file pair not classifiable without a
tree`) ends its sentence with `pass --base <checkout-dir> so the compiler can tell a mergeable
text file from a non-text one it must order`. M3. `--check --renders --base <value>` where
`<value>` is a 40-hex string that is not a directory prints `ADVISORY renders skipped:
--base wants a checkout directory, got a commit sha <value>` in place of BASE's `<value> is
not a git checkout`, and a `--base` naming a directory that is not a git checkout keeps
BASE's line; neither changes the exit code.

**Authorized-by:** #637.

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** The three strings are in `compile_plan.py`: the `--base` argparse `help=` (line
~2986 at BASE, whose text begins "the tree file-level questions resolve against"), the
same-file advisory built where `ADVISORY grammar: same-file pair not classifiable without a
tree` is formatted (line ~1893, `pass --base so the compiler can tell…`), and the two
`ADVISORY renders skipped:` returns (line ~2469: `no git checkout found for %s (pass --base)`
and `%s is not a git checkout`). The 40-hex test is `re.fullmatch(r"[0-9a-f]{40}", str(base))`
on a path that `is_dir()` answers false for. The diagnostic vocabulary — the refusal species
and the `PLAN OK` / `N violation(s)` verdict — is frozen; advisory sentences are not, and #637
says so. `tests/test_compile_plan_proof_species.py` shows a plan compiled in a temporary git
checkout with `--check --renders --base <dir>`; the same fixture, with `--base` given a
40-hex string, exercises M3.
**BASE facts:** (generated at 13c0e15)
- `tests/test_compile_plan_proof_species.py` blob 4663225
- `skills/ultrapowers/scripts/compile_plan.py` blob ed54d98

**Proof:**
- Test: `tests/test_compile_plan_base_message.py`
- Legs: (a) `compile_plan.py --help` output contains `<checkout-dir>` inside the `--base`
  entry [M1]; (b) a plan with two tasks that both `Modify:` the same path, compiled with
  `--check` and no `--base`, prints an advisory line that ends with the whole sentence
  `pass --base <checkout-dir> so the compiler can tell a mergeable text file from a non-text
  one it must order` [M2]; (c) that plan compiled with `--check --renders --base
  <40 hex zeros>` prints `ADVISORY renders skipped: --base wants a checkout directory, got a
  commit sha 0000000000000000000000000000000000000000`, prints no line containing `is not a
  git checkout`, and exits 0; the same with `--base deadbeefcafe0123456789abcdef0123456789ab`
  prints the same line echoing that value, no `is not a git checkout` line, and exits 0; and
  the same with `--base <an empty temporary directory>` prints a line ending `is not a git
  checkout` and exits 0 [M3].
- Run: python3 -m pytest -q -p no:cacheprovider tests/test_compile_plan_base_message.py
- The previous bullet runs the exam [M1] [M2] [M3].
- Run: python3 skills/ultrapowers/scripts/compile_plan.py --help | grep -q 'checkout-dir'
- The previous bullet is the help text read directly [M1].

**Stale-if:**
- path-absent: `skills/ultrapowers/scripts/compile_plan.py`
- issue-closed: #637
