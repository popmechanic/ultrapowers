# Told before the run

**Grammar:** claims-v1

**Claim:** After this run, the compiler tells me when a task changes the engine or a role
and so cannot be observed by its own run, and when a proof diffs or shows a sha without
guarding for its absence; and the credential's clipboard rule is pinned where it lives.
(elicited)

**Goal:** Two more things the compiler says before a reader is dispatched, and one rule pinned
where it lives. #461 (five instances by 2026-09-05: runs 31, 74, 7–9, 10 and 11 each built an
engine change and ran on the engine before it) becomes a `--renders` species: a task whose
Files write `fleet/run-engine.mjs`, `fleet/run-worker.mjs`, `fleet/run-waves.mjs` or a path
under `fleet/roles/` is told that its behaviour is first observed by the next run, so its
Proof is a sim and never a live-run claim. #572's compiler half (run-54's task 5 ran
`git diff --name-only d6efce4` and went red on the shallow-clone re-run — a depth-1 clone has no
BASE) becomes a render over `Run:` and `Check:` commands: a `git diff`, `git show`, `git log` or
`git cat-file` against a bare sha, or a `git show HEAD:<path>`, with no `git cat-file -e` or
`git rev-parse --verify` guard in the same command, is named with the guard. #618 item 1 is
decided as recorded — `codeForState` keeps rejecting a clipboard value with more than one `#`,
since skipping is the safe failure — and pinned: one comment at the site, one leg in the sim.
Advisories gate nothing (#492/#496): both new lines print only under `--renders`, so the
Run-less fixture corpus's `--check` bytes stay what leg (e) of
`tests/test_compile_plan_proof_runs.py` froze, and the five-species fixture of
`tests/test_compile_plan_proof_species.py` still prints exactly five lines. #572's authoring
half (the rule in `skills/ultrawrite/SKILL.md`) belongs to a sibling plan that owns that file
and is not here. Nothing under `fleet/` is touched except one comment in
`fleet/claude-token.mjs` and its sim.

**Tech Stack:** Python 3 (`skills/ultrapowers/scripts/compile_plan.py`, `python3 -m pytest`
with `pytest-xdist`), Node 24 ESM (`fleet/claude-token.mjs`, its sim
`fleet/tests/test_claude_token.mjs` run as `node fleet/tests/test_claude_token.mjs` with the
sentinel `ALL TESTS PASSED`). Nothing is added to any dependency file.

**Spec:** #461 (the advisory is named in its last comment, 2026-09-05), #572 (item 1, the
depth-1 leg), #618 (item 1, the decision recorded 2026-09-05: keep the strictness and pin it).
The issues carry the design; there is no separate spec document.

**Parallelization rationale:** One wave, width 3. Tasks 1 and 2 both modify
`skills/ultrapowers/scripts/compile_plan.py` at two different registration points — task 1
adds a species function beside the width species and one entry to the tuple
`_render_proof_species` walks; task 2 adds a render of its own and one `ADVISORY_RENDERS.append`
line after `check-cost`'s — text that folds, with no shared line. Task 3 touches only
`fleet/claude-token.mjs` (a comment) and its sim. No task consumes a sibling's symbol, so no
edge is derived and no task waits. Each task's exam is its own file, so no two examiners write
one file.

## Global Constraints

- The fleet, the skills and the frozen periphery owned by the four sibling plans are
  byte-identical to BASE.
- Check: test "$(git hash-object fleet/run-engine.mjs)" = 762be27108232d1625964d4f2c97e9f4bd7f06de
- Check: test "$(git hash-object fleet/run-waves.mjs)" = 350bb663dcdfa2d7cc90b85cd306e985fe359171
- Check: test "$(git hash-object fleet/run-worker.mjs)" = ae072613d281ad35529ee0865bb96bad6ef09c9c
- Check: test "$(git hash-object fleet/roles/implementer.md)" = 0a92a3d5a6c43ab88710d7c93322fcacda011152
- Check: test "$(git hash-object fleet/sandbox-boot.sh)" = fbe4d8dbc80d8a862f6dff86d2d946cee5eb580c
- Check: test "$(git hash-object fleet/launch.mjs)" = f47370d2badc0ef87b9d559f4e6a77f79d27d4b2
- Check: test "$(git hash-object fleet/lobby.mjs)" = 44556044708da98e6f794da8785f31f02f24638b
- Check: test "$(git hash-object fleet/janitor.mjs)" = 2de1fc707f26a06373905a8425f2ef6b67571210
- Check: test "$(git hash-object fleet/doctor.mjs)" = 7e35dcd094d24a25da7c7e4277bb983f32ff84b0
- Check: test "$(git hash-object fleet/CONTRACT.md)" = 1bf320dd7498f40e99558c397bebe669345b1cf7
- Check: test "$(git hash-object fleet/RUNBOOK.md)" = f630c6a17bfd931d702a3be675ec8a91be2aa497
- Check: test "$(git hash-object skills/ultrapowers/SKILL.md)" = 3df41c3fae22e7cf67534d9b2814aa644fb87b39
- Check: test "$(git hash-object skills/ultrapowers/references/first-run.md)" = a042dcd5485bbca9db37e0137144e9c3018b3a95
- Check: test "$(git hash-object skills/ultrawrite/SKILL.md)" = 366683a35618d97008c3004a96f16f812c49617c
- Check: test "$(git hash-object skills/ultralearn/references/distilling-proposals.md)" = c3aabdbbfdc8390e929ebe5f562d013f40eb78c7
- Check: test "$(git hash-object skills/ultrapowers/scripts/ultra_gate.py)" = 949bf784a10c7414880887cddaf9132c1415de7e
- Check: test "$(git hash-object skills/ultrapowers/scripts/gate_check.py)" = fc6e5dcf7c507643e603b69f605d1fd7da82d5f3
- Check: test "$(git hash-object skills/ultrapowers/scripts/run_acceptance.sh)" = 8ef475ac74f0ced637201c3d801de90dd4652eea
- Check: test "$(git hash-object skills/ultrapowers/kernel/vendor/manyana.py)" = 0e0367d23d19cdf87a047bd7f5cd814698f75fc4
- The compiler's refusal vocabulary gains no word — every new line is an `ADVISORY`, printed
  only under `--renders`, and `--check` alone exits and prints as it did at BASE.
- The credential tool's code is unchanged: with every whole-line `//` comment removed,
  `fleet/claude-token.mjs` hashes as it did at BASE.
- Check: test "$(grep -v '^ *//' fleet/claude-token.mjs | git hash-object --stdin)" = 03892f59f97668363f11dd141f61f7aae72c88cd
- No file outside a task's own Files block is edited.

**Acceptance:** suite — the committed suite is the verification.

### Task 1: A task that changes the engine is told its own run cannot see it

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `skills/ultrapowers/scripts/compile_plan.py`
- Test: `tests/test_compile_plan_engine_self_change.py`

**Claim:** The compiler tells me when a task changes the engine or a role and so cannot be
observed by its own run. (derived)
Machine: M1. Under --check --renders, for each claims-v1 task whose Create: or Modify:
entries name one of the engine paths — fleet/run-engine.mjs, fleet/run-worker.mjs,
fleet/run-waves.mjs, or any path beginning fleet/roles/ — the compiler prints, for each such
entry in sorted path order, one line `ADVISORY proof-species: engine-self-change — task <id>:
<path> shapes the workers, and the run that builds it runs the engine it started with — the
behaviour is first observed by the next run; prove it with a sim, never a live-run claim`.
M2. It is silent for a task that names an engine path only under Test:, for a task whose
writes are under fleet/ but are no engine path (fleet/launch.mjs, fleet/tests/test_run_engine.mjs),
for a legacy-grammar task that modifies fleet/run-engine.mjs, and for a claims-v1 task whose
Machine line numbers no clause. M3. Without --renders nothing is printed; every Run-less
fixture plan's --check output stays byte-identical to the compiler at the frozen sha; and the
five-species fixture of tests/test_compile_plan_proof_species.py still prints exactly its five
lines.

**Authorized-by:** #461 (last comment, 2026-09-05: "a `--renders` line: a task whose Files
name `fleet/run-engine.mjs`, `fleet/run-worker.mjs`, `fleet/run-waves.mjs` or `fleet/roles/`
is told that its behaviour is first observed by the NEXT run, so its Proof must be a sim,
never a live-run claim").

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** This species reads a task's Files, not its clauses, so it belongs beside the two
width species (`_species_wide_files`, `_species_wide_contract`, line ~3330 of
`compile_plan.py`), whose signature is `(task, clauses) -> [line, …]` and which are walked
from the tuple `PROOF_WIDTH_SPECIES` inside `_render_proof_species` (line ~3373) — add the
function there and one entry to that tuple (or a third tuple walked from the same loop); do
not append to `ADVISORY_RENDERS`, which a sibling task in this wave appends to. Registration
inside `_render_proof_species` is what gives M2 its legacy and unnumbered silence for free:
that render skips a task whose `machine_clauses` is empty. The task dict carries `creates`,
`modifies` (the Files block's Create: and Modify: paths) and `reads` (its Test: paths); the
engine paths are the three files and the `fleet/roles/` prefix — a tuple of literals and one
`startswith`, in the style of `HAND_EXECUTED_RECORDS`. Print through `_species_line`, whose
shape the regex in `tests/test_compile_plan_proof_species.py` pins; one line per matching
path, sorted. Since 0.3.5 the engine a run executes is the `engine=` sha in the VM's
assignment, cloned to `/home/exedev/engines/<sha>` before the run starts — a patch to any of
these files lands in the integration branch, not in the running process, which is why the
line says the run "runs the engine it started with". The exam builds plans with the
`_task`/`_plan`/`_sign` helpers `tests/test_compile_plan_proof_species.py` shows (a
claims-v1 plan needs an all-pass verdict record beside it) against a temporary git checkout
like that file's `repo` fixture; `_task` takes a `files` list, so a fixture task's Files
block is one argument. The five-species fixture's tasks write `app/probe_<id>.py`, so this
species is silent on it. `tests/test_check_renders.py` renders a legacy plan whose task 2
modifies `fleet/run-engine.mjs` and reads that output for `unverifiable-from-sandbox` lines
only; M2's legacy row keeps it at zero new lines.
**BASE facts:** (generated at 4bd0f5c)
- `fleet/run-engine.mjs` blob 762be27
- `fleet/run-worker.mjs` blob ae07261
- `fleet/run-waves.mjs` blob 350bb66
- `_species_wide_files` at `skills/ultrapowers/scripts/compile_plan.py:3330` blob 18ad607
- `_species_wide_contract` at `skills/ultrapowers/scripts/compile_plan.py:3341` blob 18ad607
- `_render_proof_species` at `skills/ultrapowers/scripts/compile_plan.py:3373` blob 18ad607
- `reads` at `fleet/tests/test_claude_token.mjs:319` blob 3a21313
- `_species_line` at `skills/ultrapowers/scripts/compile_plan.py:3143` blob 18ad607
- `tests/test_compile_plan_proof_species.py` blob 4663225
- `_task` at `tests/test_check_provenance.py:43` blob 3662694
- `_plan` at `tests/test_check_provenance.py:72` blob 3662694
- `_sign` at `tests/test_compile_plan_base_message.py:140` blob a8f0166
- `repo` at `fleet/tests/test_exam_edited_patches.mjs:45` blob 048392d
- `files` at `fleet/run-main.mjs:312` blob 8dcde61
- `tests/test_check_renders.py` blob 0c9186b
- `fleet/roles/implementer.md` blob 0a92a3d
- `fleet/launch.mjs` blob f47370d
- `fleet/tests/test_run_engine.mjs` blob 25a93da
- `tests/test_compile_plan_proof_runs.py` blob 9a949c2

**Proof:**
- Test: `tests/test_compile_plan_engine_self_change.py`
- Legs: (a) for each of `fleet/run-engine.mjs`, `fleet/run-worker.mjs`, `fleet/run-waves.mjs`
  and `fleet/roles/implementer.md` as a task's one `Modify:` entry, the plan prints exactly
  one `engine-self-change` line, equal to `ADVISORY proof-species: engine-self-change — task
  1: <that path> shapes the workers, and the run that builds it runs the engine it started
  with — the behaviour is first observed by the next run; prove it with a sim, never a
  live-run claim`; a task whose one `Create:` entry is `fleet/roles/newrole.md` prints the
  same line for that path; and a task modifying `fleet/run-worker.mjs` and
  `fleet/run-engine.mjs` prints exactly two lines, the `fleet/run-engine.mjs` line first
  [M1]; (b) a task with `Test: fleet/run-engine.mjs` and `Modify: app/x.py` prints no
  `engine-self-change` line; a task modifying `fleet/launch.mjs` prints none; a task
  modifying `fleet/tests/test_run_engine.mjs` prints none; a legacy-grammar plan (no
  Grammar line, a Depends-on marker and a checkbox step) whose task modifies
  `fleet/run-engine.mjs` prints none; and a claims-v1 task modifying `fleet/run-engine.mjs`
  whose Machine line numbers no clause prints none [M2]; (c) the `fleet/run-engine.mjs` plan
  run with `--check` alone prints no `engine-self-change` line and exits 0 with `PLAN OK` as
  its first line; the byte-identity assertion of `tests/test_compile_plan_proof_runs.py`
  (its frozen-sha comparison) still holds when re-run from this file; and
  `tests/test_compile_plan_proof_species.py` passes [M3].
- Run: python3 -m pytest -q -p no:cacheprovider tests/test_compile_plan_engine_self_change.py
- The previous bullet is the exam [M1] [M2] [M3].
- Run: python3 -m pytest -q -p no:cacheprovider tests/test_compile_plan_proof_species.py tests/test_compile_plan_proof_runs.py tests/test_check_renders.py
- The previous bullet is the existing species, corpus and render pins, unchanged [M3].

**Stale-if:**
- path-absent: `tests/test_compile_plan_proof_species.py`
- issue-closed: #461

### Task 2: A proof that diffs or shows a sha is told to guard for its absence

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `skills/ultrapowers/scripts/compile_plan.py`
- Test: `tests/test_compile_plan_sha_unguarded.py`

**Claim:** The compiler tells me when a proof diffs or shows a sha without guarding for its
absence. (derived)
Machine: M1. Under --check --renders, for each Proof Run: command of a claims-v1 task in
which one of the four verbs git diff, git show, git log or git cat-file is followed — after
any number of tokens beginning with a hyphen — by an operand of one of three shapes: a token
of exactly 7 to 40 characters from 0-9a-f, a token whose first 7 to 40 characters are from
0-9a-f and whose next character is a colon, or a token beginning HEAD: — and which does not
also contain the substring git cat-file -e or the substring git rev-parse --verify, the
compiler prints one line per such command, naming its first such operand, equal to
`ADVISORY sha-unguarded: task <id> Run: <command clipped to 80 characters> — <operand>
reaches for BASE, which a depth-1 clone does not hold; guard it in the same command with git
cat-file -e <sha>^{commit} or git rev-parse --verify, and skip the leg when the guard fails`,
where <sha> is those five literal characters. M2. A Check: command under the Global
Constraints section of the same shape prints the same line with `Check: <command clipped to
80 characters>` in place of `task <id> Run: <command clipped to 80 characters>`, in a
claims-v1 plan and in a legacy-grammar plan alike; a Check: ending (minor) prints none; the
Run: lines print in task order before the Check: lines in section order. M3. It is silent
for a command with one of the four verbs and no such operand, for a command whose only
sha-shaped token follows a verb outside the four, for a token of 6 hex characters and for a
token of 41 hex characters, and for a command of the M1 shape that also contains git
cat-file -e or that also contains git rev-parse --verify. M4. Without --renders nothing
is printed; every Run-less fixture plan's --check output stays byte-identical to the
compiler at the frozen sha; and the five-species fixture of
tests/test_compile_plan_proof_species.py still prints exactly its five lines.

**Authorized-by:** #572 (item 1: "a leg that diffs or shows a BASE sha guards for the sha's
absence, or it is not a leg"; "Fixed in-run with a `git cat-file -e <sha>^{commit}` guard
that skips the leg").

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** This is its own render, registered as `ADVISORY_RENDERS.append(("sha-unguarded",
_render_sha_unguarded))` directly after the `check-cost` append (line ~3430 of
`compile_plan.py`) — not a `proof-species` line, because a `Check:` belongs to no task and the
species line shape names one; a sibling task in this wave registers inside
`_render_proof_species` and never touches `ADVISORY_RENDERS`. A render is `fn(tasks, ctx) ->
[line, …]`; each task dict's `claims["proof_runs"]` holds its Run: commands verbatim, in Proof
order (absent on a legacy task), and `parse_constraint_checks(ctx["plan_path"].read_text())`
(line ~1559) answers the section's `- Check:` bullets as `{"cmd", "minor"}` in order for any
grammar. `_clip_run(command)` (line ~3136) is the 80-character clipping the species lines
use: 79 characters plus `…` when longer. The verb-then-operand read is one regex over the
whole command: the verb (`\bgit\s+(diff|show|log|cat-file)\b`), then any run of
whitespace-separated tokens starting `-` (so `--name-only`, `-1`, `--format=%H` and a bare
`--` are all skipped), then the operand token; test that token against the three shapes
(`^[0-9a-f]{7,40}$`, `^[0-9a-f]{7,40}:`, `^HEAD:`). The guard test is two substring checks
on the whole command — a `git cat-file -e d6efce4^{commit} && …` command is guarded by the
first, and the verb `cat-file` in the guard itself is the reason the guard is tested before
the verb, or the guard would flag itself. The line's tail after ` — ` is one literal in the
style of `SUITE_TOTAL_ADVICE`, with the operand substituted once at its head and the text
`<sha>` left as those five characters. A `test "$(git hash-object <path>)" = <40 hex>`
Check: — the shape this plan's own Global Constraints use — has its sha after a verb outside
the four and prints nothing. The five-species fixture's Run: commands are
`python3 scripts/probe.py; …` with no git verb, so this render is silent on it. The exam
builds plans with the `_task`/`_plan`/`_sign` helpers `tests/test_compile_plan_proof_species.py`
shows and a temporary checkout like its `repo` fixture; a Global Constraints section goes
between the header and the first task, as `tests/test_compile_plan_check_cost.py` builds one.
**BASE facts:** (generated at 4bd0f5c)
- `_render_proof_species` at `skills/ultrapowers/scripts/compile_plan.py:3373` blob 18ad607
- `_task` at `tests/test_check_provenance.py:43` blob 3662694
- `_plan` at `tests/test_check_provenance.py:72` blob 3662694
- `_sign` at `tests/test_compile_plan_base_message.py:140` blob a8f0166
- `tests/test_compile_plan_proof_species.py` blob 4663225
- `repo` at `fleet/tests/test_exam_edited_patches.mjs:45` blob 048392d
- `tests/test_compile_plan_check_cost.py` blob ccaad8d
- `tests/test_compile_plan_proof_runs.py` blob 9a949c2

**Proof:**
- Test: `tests/test_compile_plan_sha_unguarded.py`
- Legs: (a) for each of the four verbs `git diff`, `git show`, `git log` and `git cat-file`,
  a task whose one Run: is `<verb> --name-only d6efce4 -- fleet/x.mjs` prints exactly one line
  equal to `ADVISORY sha-unguarded: task 1 Run: <that command> — d6efce4 reaches for BASE,
  which a depth-1 clone does not hold; guard it in the same command with git cat-file -e
  <sha>^{commit} or git rev-parse --verify, and skip the leg when the guard fails`; for each
  of the three operand shapes — `git show 0a3559a2e0c9998553c0c725e5510e20e5802b1b` (40 hex),
  `git show d6efce4:fleet/x.mjs` and `git show HEAD:fleet/x.mjs` — one line naming
  `0a3559a2e0c9998553c0c725e5510e20e5802b1b`, `d6efce4:fleet/x.mjs` and `HEAD:fleet/x.mjs`
  respectively as the operand; `git log -1 --format=%H d6efce4` (two flag tokens between
  verb and operand) prints one line naming `d6efce4`; a command carrying two operands,
  `git diff d6efce4 0a3559a`, prints exactly one line naming `d6efce4`; a task carrying two
  Run: commands, `git show d6efce4` then `git show 0a3559a`, prints exactly two `task 1 Run:`
  lines, the `d6efce4` line first; and a Run: of 100 characters prints its first 79
  characters followed by `…` [M1]; (b) a claims-v1 plan whose
  Global Constraints carry `- Check: git diff --quiet d6efce4 -- fleet/x.mjs` prints exactly
  one line equal to `ADVISORY sha-unguarded: Check: git diff --quiet d6efce4 -- fleet/x.mjs —
  d6efce4 reaches for BASE, which a depth-1 clone does not hold; guard it in the same command
  with git cat-file -e <sha>^{commit} or git rev-parse --verify, and skip the leg when the
  guard fails`; a legacy-grammar plan (no Grammar line, a Depends-on marker and a checkbox
  step) with the same Check: prints the same line; the same Check: ending `(minor)` prints
  none; a plan whose task 1 Run: is `git show 0a3559a` and whose task 2 Run: is
  `git show d6efce4` prints exactly two lines, the `task 1 Run:` line first; a plan whose
  Global Constraints carry `- Check: git show 0a3559a` and then `- Check: git show d6efce4`
  prints exactly two lines, the `0a3559a` line first; a Check: of 100 characters prints its
  first 79 characters followed by `…`; and a plan with the `--quiet` Check: and a task 1 Run:
  `git show d6efce4` prints exactly two lines, the `task 1 Run:` line first [M2]; (c) each of
  the following, once as a task's Run: and again as a `- Check:` under Global Constraints,
  prints no `sha-unguarded` line: `git diff --quiet -- fleet/x.mjs` (a verb and no operand),
  `test "$(git hash-object fleet/x.mjs)" = 0a3559a2e0c9998553c0c725e5510e20e5802b1b` (the sha
  after a verb outside the four), `git show abc123` (6 hex),
  `git show 0a3559a2e0c9998553c0c725e5510e20e5802b1b1` (41 hex),
  `git cat-file -e d6efce4^{commit} && git diff --name-only d6efce4 -- fleet/x.mjs || true`
  (guarded by the substring git cat-file -e) and
  `git rev-parse --verify d6efce4 && git diff --name-only d6efce4 -- fleet/x.mjs || true`
  (guarded by the substring git rev-parse --verify) [M3]; (d) the four-verb plan run with `--check` alone prints no
  `sha-unguarded` line and exits 0 with `PLAN OK` as its first line; the byte-identity
  assertion of `tests/test_compile_plan_proof_runs.py` (its frozen-sha comparison) still
  holds when re-run from this file; and `tests/test_compile_plan_proof_species.py` passes
  [M4].
- Run: python3 -m pytest -q -p no:cacheprovider tests/test_compile_plan_sha_unguarded.py
- The previous bullet is the exam [M1] [M2] [M3] [M4].
- Run: python3 -m pytest -q -p no:cacheprovider tests/test_compile_plan_proof_species.py tests/test_compile_plan_proof_runs.py tests/test_check_renders.py tests/test_compile_plan_check_cost.py
- The previous bullet is the existing species, corpus, render and Check: pins, unchanged [M4].

**Stale-if:**
- path-absent: `tests/test_compile_plan_proof_species.py`
- issue-closed: #572

### Task 3: The clipboard rule is pinned where it lives

**Type:** implementation

**Files:**
- Modify: `fleet/claude-token.mjs`
- Test: `fleet/tests/test_claude_token.mjs`

**Claim:** The credential's clipboard rule is pinned where it lives. (derived)
Machine: M1. `codeForState('code#state#extra', 'state')` returns null. M2.
`codeForState('code#state', 'state')` returns `'code'`. M3. `cleanCode('code#state#extra')`
returns `'code'`, the looser first-`#` split the stricter rule departs from. M4. The
whole-line `//` comment directly above `export function codeForState` in fleet/claude-token.mjs
says, within the twelve lines above that line and in this order, that a value with more than
one # is rejected and that skipping it is the safe failure — the three phrases more than one #,
rejected and safe failure, in that order. M5. node fleet/tests/test_claude_token.mjs exits 0
and prints the sentinel ALL TESTS PASSED.

**Authorized-by:** #618 (item 1: "keep the strictness (skipping is the safe failure) and add
one comment plus one leg in `fleet/tests/test_claude_token.mjs`"; the decision recorded in its
2026-09-05 comment).

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** `codeForState(pasted, state)` (line ~78 of `fleet/claude-token.mjs`) splits the
pasted value on every `#` and answers `null` when more than two parts result, when the
fragment is absent, or when the fragment is not this login's state; `cleanCode` (line ~72)
splits on the first `#` and keeps the head. The decision is to keep that difference: a
`code#state#extra` value is not this login's `code#state` and the poll skips it — the safe
failure — until a matching value appears or `CLIPBOARD_WAIT_MS` elapses. Nothing in the code
changes: the Global Constraints hash the file with every whole-line `//` comment removed, so
the comment is added as whole lines beginning `//` (indentation allowed), never as a trailing
comment on a code line, and it sits in the comment block directly above
`export function codeForState` — the existing four-line block that begins `// Matching on the
state is what makes polling safe` — so that the twelve lines above the function still hold
it. The M4 probe reads those twelve lines joined and looks for the phrase `more than one #`
(the `#` bare, not backticked), then `rejected`, then `safe failure`, in that order; use all
three. The sim is a flat file of `await leg(…)`
blocks with `assert` from `node:assert/strict`, importing `cleanCode` by name and the module
as `CT`; `codeForState` is exported and is imported the same way. Its leg for `cleanCode`
(`the pasted code loses its #state fragment and whitespace`) is the shape to copy; the new leg
carries the three assertions of M1–M3 with the literal values `code#state#extra`,
`code#state` and `state`. The file ends by printing the leg count and `ALL TESTS PASSED`.
**BASE facts:** (generated at 4bd0f5c)
- `fleet/tests/test_claude_token.mjs` blob 3a21313
- `fleet/claude-token.mjs` blob 5f75f73
- `cleanCode` at `fleet/claude-token.mjs:72` blob 5f75f73
- `CLIPBOARD_WAIT_MS` at `fleet/claude-token.mjs:47` blob 5f75f73
- `assert` at `evals/fixtures/jsdeps/project/test/dep.test.js:2` blob 90d2afe
- `codeForState` at `fleet/claude-token.mjs:78` blob 5f75f73
- `state` at `fleet/claude-token.mjs:54` blob 5f75f73

**Proof:**
- Test: `fleet/tests/test_claude_token.mjs`
- Legs: (a) `codeForState('code#state#extra', 'state')` is asserted equal to `null` [M1];
  (b) `codeForState('code#state', 'state')` is asserted equal to `'code'` [M2]; (c)
  `cleanCode('code#state#extra')` is asserted equal to `'code'` [M3].
- Run: grep -B12 '^export function codeForState' fleet/claude-token.mjs | grep '^ *//' | tr '\n' ' ' | grep -q 'more than one #.*rejected.*safe failure'
- The previous bullet reads only the comment lines within the twelve lines directly above the
  function and pins the three phrases — the value shape, that it is rejected, and the reason —
  in order [M4].
- Run: out=$(node fleet/tests/test_claude_token.mjs) && printf '%s\n' "$out" | grep -q 'ALL TESTS PASSED'
- The previous bullet is the sim: the exit code is read first (a non-zero exit short-circuits
  the and-chain) and then the sentinel is read off the captured output [M5].

**Stale-if:**
- path-absent: `fleet/claude-token.mjs`
- issue-closed: #618
