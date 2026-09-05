# Two advisories calibrated

**Grammar:** claims-v1

**Claim:** After this run, the compiler's wide-files line fires at four entries for a task
that writes the engine or more than one sim and stays at eight for everything else, and its
pinned-elsewhere line stops naming a directory prefix or a short span that every test's
import line contains. (elicited)

**Goal:** Two `--renders` advisories of `skills/ultrapowers/scripts/compile_plan.py`, each
calibrated by the first real plan it read. #666: run-10's task 1 (eight `Modify:` entries —
`run-engine.mjs`, `run-waves.mjs`, two role files, four sim rewrites) took 24.7 implementer
minutes, 38.8 of the wave's 41.4, while its one- and two-file siblings took 2–4, and the
wide-files species (#582, more than eight entries) said nothing; the simpler of the issue's two
proposals is taken — a path-aware knee, four entries for a task writing `fleet/run-engine.mjs`
or more than one `fleet/tests/test_*.mjs` sim, eight for every other task. #671: the first plan
the pinned-elsewhere species (#656) read printed five lines for the four-character span
`src/`, a directory prefix every sibling test's import line contains; the species now skips a
span shorter than six characters, a span ending in `/`, and a span present in more than eight
tracked test files, and keeps the `runner: None` literal shape it was built for. Both stay
advisories (#492/#496): nothing refuses, `--check` alone prints and exits as at BASE, and the
Run-less fixture corpus's bytes stay what `tests/test_compile_plan_proof_runs.py` froze.
**Closes:** #666 #671

**Tech Stack:** Python 3 (`skills/ultrapowers/scripts/compile_plan.py`, `python3 -m pytest`
with `pytest-xdist`); the exams build throwaway git checkouts with the `git` binary, no network.
Nothing is added to any dependency file.

**Spec:** #666 (proposal 1, the path-aware knee — the second proposal, a measured-rate detail
string, is not taken) and #671 (the three skips and the loop question). The issues carry the
design; there is no separate spec document.

**Parallelization rationale:** One wave, width 2. Both tasks modify
`skills/ultrapowers/scripts/compile_plan.py` at disjoint regions — task 1 the width
constants beside `WIDTH_THRESHOLD` and `_species_wide_files`, task 2 the span filter beside
`MIN_SPAN` and `_species_pinned_elsewhere` — text that folds, with no shared line. Each task's
exam is its own existing file (`tests/test_compile_plan_wide_files.py`,
`tests/test_compile_plan_pinned_elsewhere.py`), so no two examiners write one file. No task
consumes a sibling's symbol, so no edge is derived and no task waits.

## Global Constraints

- The frozen verification periphery, the fleet and the skills are byte-identical to BASE.
- Check: test "$(git hash-object skills/ultrapowers/scripts/ultra_gate.py)" = 949bf784a10c7414880887cddaf9132c1415de7e
- Check: test "$(git hash-object skills/ultrapowers/scripts/gate_check.py)" = fc6e5dcf7c507643e603b69f605d1fd7da82d5f3
- Check: test "$(git hash-object skills/ultrapowers/scripts/run_acceptance.sh)" = 8ef475ac74f0ced637201c3d801de90dd4652eea
- Check: test "$(git hash-object skills/ultrapowers/kernel/vendor/manyana.py)" = 0e0367d23d19cdf87a047bd7f5cd814698f75fc4
- Check: test "$(git hash-object fleet/run-engine.mjs)" = ab943eac2ddd6433ee01be94bda59b9725b84db8
- Check: test "$(git hash-object skills/ultrawrite/SKILL.md)" = 6a11e64f25dc02540b3d1cbe954e8e585d202d61
- Check: test "$(git hash-object skills/ultrapowers/SKILL.md)" = f286d45f24924654c4f71795903d8277ba9e9035
- The compiler's refusal vocabulary gains no word and no species is added or renamed — every
  changed line is an existing `ADVISORY proof-species:` species printed only under
  `--renders`, and `--check` alone exits and prints as it did at BASE.
- No file outside a task's own Files block is edited.

**Acceptance:** suite — the committed suite is the verification.

### Task 1: The wide-files knee reads the paths

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `skills/ultrapowers/scripts/compile_plan.py`
- Test: `tests/test_compile_plan_wide_files.py`

**Claim:** a task naming `fleet/run-engine.mjs` (2,000 lines) or more than one
`fleet/tests/test_*.mjs` it must rewrite is wide at four entries; a task under `src/` with
small files keeps eight (quoted from #666)
Machine: M1. Under --check --renders, a claims-v1 task whose Create: plus Modify: entries
number more than four and include the path fleet/run-engine.mjs prints exactly one wide-files
line, equal to `ADVISORY proof-species: wide-files — task <id>: <n> Create/Modify entries, wide
at four because it writes fleet/run-engine.mjs — run-10's eight-file engine task took 24.7 min
while its one- and two-file siblings took 2–4; split along a Produces symbol`, where <n> is
the count of Create: plus Modify: entries. M2. A claims-v1 task whose Create: plus Modify:
entries number more than four, include more than one path of the shape
fleet/tests/test_<name>.mjs, and do not include fleet/run-engine.mjs prints exactly one
wide-files line, equal to `ADVISORY proof-species: wide-files — task <id>: <n> Create/Modify
entries, wide at four because it writes <k> fleet/tests/test_*.mjs sims — run-10's eight-file
engine task took 24.7 min while its one- and two-file siblings took 2–4; split along a
Produces symbol`, where <k> is the count of such paths; a task that writes fleet/run-engine.mjs
AND more than one such sim prints the M1 line and no M2 line. M3. Every other claims-v1 task
keeps the eight knee: at more than eight Create: plus Modify: entries it prints exactly the
BASE line `ADVISORY proof-species: wide-files — task <id>: <n> Create/Modify entries — run-55's
19-file task hit the worker wall clock while its 3–8-file siblings finished; split along a
Produces symbol`, and at eight or fewer it prints no wide-files line — in particular a task
whose five writes are exactly one fleet/tests/test_<name>.mjs and four app paths, a task
whose five writes are two fleet/tests/<name>_helpers.mjs paths (no test_ prefix) and three
app paths, a task whose four writes include fleet/run-engine.mjs, and a task whose four
writes are app paths and whose three Test: entries are fleet/tests/test_<name>.mjs paths all
print none. M4. The wide-contract species is unchanged, and the frozen channel is untouched:
without --renders a plan that draws the M1 line draws nothing, every Run-less fixture plan's
--check output stays byte-identical to the compiler at the frozen sha, and the five-species
fixture of tests/test_compile_plan_proof_species.py still prints exactly its five lines.

**Authorized-by:** #666 (proposal 1: "the advisory reads the paths, not only the count").

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** The proposal taken is the issue's FIRST, the path-aware knee, because it is the
simpler of the two: it changes one threshold on one species and needs no census — the second
proposal (measure implementer-minutes-per-Files-entry from runs 1–12 and print
`8 entries ≈ N min at this repo's rate`) is a measured-rate detail string that would need a
number nobody has re-measured and would rot as the fleet changes. The species lives at
`_species_wide_files` (line ~3352 of `compile_plan.py`), signature `(task, clauses) ->
[line, …]`, walked from the tuple `PROOF_WIDTH_SPECIES` inside `_render_proof_species`; its
constants sit together above it — `WIDTH_THRESHOLD = 8`, `WIDE_FILES_ADVICE`,
`WIDE_CONTRACT_ADVICE` (line ~3077). Keep `WIDTH_THRESHOLD` and the BASE advice string
byte-for-byte (M3 pins the eight-knee line verbatim, and `_species_wide_contract` reads the
same constant), and add beside them the four-knee constant and its two advice strings. The
task dict carries `creates` and `modifies` (the Files block's Create: and Modify: paths, both
lists) and `reads` (its Test: paths); the narrow knee reads `creates + modifies` only — a
Test: entry is a read and neither counts nor triggers. The engine path is the literal
`fleet/run-engine.mjs` (already the first entry of `ENGINE_PATHS`, which the
engine-self-change species reads; that species keeps printing its own line for the same task,
which is a different species and not this exam's concern — filter by species name as the
existing `_of` helper does). A sim path is one that starts with `fleet/tests/test_` and ends
with `.mjs` — a `startswith` and an `endswith`, no glob machinery; a helpers module under
that directory without the test_ prefix is not one. One line per task: the engine reason wins when both hold. Print through
`_species_line`, whose shape the regex `SPECIES_LINE_RE` in
`tests/test_compile_plan_proof_species.py` pins (`ADVISORY proof-species: <species> — task
<id>[, leg <label>]: <detail>`); the detail may carry its own em dashes, as the BASE line
already does. The exam is `tests/test_compile_plan_wide_files.py`, extended under a comment
naming this task: its `_width_plan`/`_files` helpers build tasks writing `app/c<i>.py` and
`app/m<i>.py`, so a new helper (or a `files` list passed straight to `_task`) is needed for the
engine and sim paths; its `repo` fixture is an empty checkout, which is all this species
needs; its `_of(stdout, species)` reads one species' lines and asserts every species line
matches the shared regex. The existing legs (nine entries print, eight are silent, Test:
entries do not count, `wide-contract` at nine and eleven, the `--check`-alone silence, the
frozen-sha re-run, the five-species exam) stay as they are and keep passing — they are M3 and
M4's app-path rows. Concurrency: another task in this wave also modifies `compile_plan.py`, in
the pinned-elsewhere region (`MIN_SPAN`, `_clause_spans`, `_species_pinned_elsewhere`, line
~3130–3160) — do not touch that region, and do not reorder or rename `PROOF_WIDTH_SPECIES`,
`PROOF_FILES_SPECIES` or `_render_proof_species`.
**BASE facts:** (generated at e04154b)
- `fleet/run-engine.mjs` blob ab943ea
- `_species_wide_files` at `skills/ultrapowers/scripts/compile_plan.py:3352` blob b546e04
- `_species_wide_contract` at `skills/ultrapowers/scripts/compile_plan.py:3363` blob b546e04
- `reads` at `fleet/tests/test_claude_token.mjs:319` blob d2e9a9b
- `_of` at `tests/test_compile_plan_wide_files.py:240` blob eca78f6
- `_species_line` at `skills/ultrapowers/scripts/compile_plan.py:3165` blob b546e04
- `tests/test_compile_plan_proof_species.py` blob 4663225
- `tests/test_compile_plan_wide_files.py` blob eca78f6
- `_width_plan` at `tests/test_compile_plan_wide_files.py:147` blob eca78f6
- `_files` at `tests/test_compile_plan_wide_files.py:135` blob eca78f6
- `files` at `fleet/run-main.mjs:312` blob 8dcde61
- `_task` at `tests/test_check_provenance.py:43` blob 3662694
- `repo` at `fleet/tests/test_exam_edited_patches.mjs:45` blob 048392d
- `_clause_spans` at `skills/ultrapowers/scripts/compile_plan.py:3125` blob b546e04
- `_species_pinned_elsewhere` at `skills/ultrapowers/scripts/compile_plan.py:3148` blob b546e04
- `_render_proof_species` at `skills/ultrapowers/scripts/compile_plan.py:3416` blob b546e04
- `tests/test_compile_plan_proof_runs.py` blob ce4a5ae
- `skills/ultrapowers/scripts/compile_plan.py` blob b546e04

**Proof:**
- Test: `tests/test_compile_plan_wide_files.py`
- Legs: (a) a task whose five `Modify:` entries are `fleet/run-engine.mjs` and four `app/`
  paths prints exactly one wide-files line, equal to the M1 line with `<n>` = 5; a task whose
  seven entries are `fleet/run-engine.mjs` under `Create:`, two `fleet/tests/test_<name>.mjs`
  and four `app/` paths under `Modify:` prints exactly one wide-files line, equal to the M1
  line with `<n>` = 7, and no line containing `sims`; and a task whose nine `Modify:`
  entries are `fleet/run-engine.mjs` and eight `app/` paths prints exactly one wide-files
  line, equal to the M1 line with `<n>` = 9 — not the BASE eight-knee line [M1] [M2]; (b) a task whose five
  `Modify:` entries are two `fleet/tests/test_<name>.mjs` paths and three `app/` paths prints
  exactly one wide-files line, equal to the M2 line with `<n>` = 5 and `<k>` = 2; a task whose
  six entries are three such sims and three `app/` paths prints the M2 line with `<n>` = 6
  and `<k>` = 3; and a task whose ten `Modify:` entries are two such sims and eight `app/`
  paths prints exactly one wide-files line, equal to the M2 line with `<n>` = 10 and
  `<k>` = 2 — not the BASE eight-knee line [M2]; (c) each of the following prints no wide-files line: five `Modify:`
  entries of which exactly one is `fleet/tests/test_<name>.mjs` and four are `app/` paths;
  five `Modify:` entries of which two are `fleet/tests/<name>_helpers.mjs` and three are
  `app/` paths; four `Modify:` entries of which one is `fleet/run-engine.mjs`; four `Create:`
  entries under `app/` plus three `Test:` entries `fleet/tests/test_<name>.mjs`; and the
  same four-`Modify:`-with-engine fixture one `app/` entry wider prints the M1 line with
  `<n>` = 5, so the silence at four is the threshold and not a dead render [M3]; (d) the
  existing five-`Create:`-and-four-`Modify:` app-path fixture still prints exactly the BASE
  eight-knee line with `<n>` = 9, and a task with nine `app/` entries of which one is
  `fleet/tests/test_<name>.mjs` prints that BASE line and not the M2 line [M3]; (e) the
  existing nine-clause and eleven-clause fixtures still print exactly their `wide-contract`
  lines; the first leg's five-entry engine fixture run with `--check` alone prints no `wide-files` line and
  exits 0 with `PLAN OK` as its first line; the byte-identity assertion of
  `tests/test_compile_plan_proof_runs.py` is re-run from this file and holds; and
  `tests/test_compile_plan_proof_species.py` is run from this file and passes [M4].
- Run: python3 -m pytest -q -p no:cacheprovider tests/test_compile_plan_proof_species.py tests/test_compile_plan_check_cost.py
- The previous bullet runs the five-species fixture (exactly five lines, one per registered
  species) and the species-vocabulary pins over the skill text, neither of which this task
  may move [M4].

**Stale-if:**
- path-absent: `skills/ultrapowers/scripts/compile_plan.py`
- issue-closed: #666

### Task 2: Pinned-elsewhere skips the spans that pin nothing

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `skills/ultrapowers/scripts/compile_plan.py`
- Test: `tests/test_compile_plan_pinned_elsewhere.py`

**Claim:** skip a span that is shorter than, say, six characters or that ends in `/` (a
directory) or matches a path fragment present in more than N tracked test files (a span
everyone contains pins nothing); keep the literal shape (`runner: None`) the species was
built for (quoted from #671)
Machine: M1. Under --check --renders --base <checkout>, the literal shape is kept: for a
claims-v1 task whose Machine clause carries the backticked span `runner: None` and a tracked
test file under the checkout that contains it and is named in no task's Files, the compiler
prints exactly one line, equal to `ADVISORY proof-species: pinned-elsewhere — task <id>:
runner: None is asserted in <path>, which is in no task's Files`; and when three tasks of one
plan each carry that span, it prints one such line per task, three lines in task order —
the loop is per task. M2. A span shorter than six characters draws nothing: a five-character
backticked span contained by a tracked, undeclared test file draws no pinned-elsewhere line,
while a six-character span in the same clause position and the same file draws one. M3. A
span ending in / draws nothing whatever its length: a twelve-character backticked span ending
in / contained by a tracked, undeclared test file draws no pinned-elsewhere line, while the
same span without its trailing / in the same file draws one. M4. A span present in more than
eight tracked test files draws nothing, counting tracked test files whether or not a task's
Files names them: a span contained by nine tracked test files, none declared, draws no
pinned-elsewhere line; the same span contained by nine tracked test files of which one is a
task's Test: entry draws none; and the same span contained by eight tracked test files, none
declared, draws exactly eight lines, one per file, sorted by path. M5. The frozen channel is
untouched: --check alone prints no pinned-elsewhere line and exits 0 with PLAN OK, --check
--renders with no --base checkout prints none, every Run-less fixture plan's --check output
stays byte-identical to the compiler at the frozen sha, and the five-species fixture of
tests/test_compile_plan_proof_species.py still prints exactly its five lines.

**Authorized-by:** #671 (its "Fix:" paragraph, 2026-09-05).

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** The species is `_species_pinned_elsewhere` (line ~3148 of `compile_plan.py`),
fed by `_clause_spans` (the backticked spans of a task's Machine clauses, `MIN_SPAN = 3`
and above, deduped in document order) and `_git_substring_files` (a `git grep -l -F -e
<span>` over every tracked file), filtered by `_is_test_file` and the plan-wide `declared`
set; the constants `BACKTICK_SPAN_RE`, `MIN_SPAN`, `PINNED_ELSEWHERE_DETAIL`,
`TEST_DIR_PREFIXES` sit just above it. The three skips are: raise `MIN_SPAN` to 6 (its
comment says why three was chosen — rewrite it: below six, `src/`, `'Ada'`, `M1.` are grep
noise); drop a span whose last character is `/` (a directory prefix, which an import line
contains and no test pins); and drop a span whose tracked test-file count — the
`_is_test_file` paths among the grep hits, before the `declared` filter — exceeds a new
constant pinned at 8 (`PINNED_EVERYWHERE = 8` or a name of your choosing, with its reason: a
span in more than eight test files is vocabulary, not one sibling's strict-equality pin;
eight is the line the compiler already draws for width). Measured at BASE on this repository
so the number is a calibration, not a guess: `runner: None` is in 1 tracked test file,
`deferred:external` in 3, `ultra/plan-run-` and `examEdited` in 5, `fix-loop-exhausted` in 7
— all still named — while `PLAN OK` is in 25, `claims-v1` in 29, `ALL TESTS PASSED` in 64
and `fleet/tests/` in 84, none of which a clause could replace without the implementer
grepping anyway. Keep the line text and `_species_line` shape byte-identical: the BASE exam's
leg (a) pins the `runner: None` line verbatim and stays. The loop question in #671 ("only
task 3 printed although tasks 1 and 2 carry the same clause") was reproduced at BASE against
a synthetic checkout of five `tests/<x>.test.ts` files whose import lines contain `src/`,
with the walk plan itself (its tasks 1, 2 and 3 all end their M5 with "no other module of
`src/` defines it"): the compiler prints fifteen lines, five per task, in task order — the
loop in `_render_proof_species` is per task and is not the defect; the single-task output
was a property of the plan as it stood when it was checked, not of the compiler. M1's
three-task leg pins that so the question is closed by an exam rather than a sentence. The
exam is `tests/test_compile_plan_pinned_elsewhere.py`, extended under a comment naming this
task: its `_task`/`_plan`/`_sign`/`_repo`/`_lines` helpers build a signed one- or two-task
plan and a throwaway checkout committing exactly the files given, so each leg is one `_repo`
call and one `_lines` call; `_task` takes the Files bullet lines as a list, so a declared
Test: entry is one more list element (the `TASK_2_OWNING` shape). Its module docstring and
the leg-(a) test `test_a_backticked_span_under_three_characters_draws_nothing` say "three or
more characters" and "the three-or-more bar" — rewrite both to six, keeping that test's
two-character `ok` span (still silent). Its `repo_four` fixture — the same literal in four
test-file shapes, four lines expected — stays below the eight-file line and keeps passing.
Concurrency: another task in this wave also modifies `compile_plan.py`, in the width region
(`WIDTH_THRESHOLD`, `WIDE_FILES_ADVICE`, `_species_wide_files`, line ~3077 and ~3352) — do not
touch that region, and do not reorder or rename `_render_proof_species` or the tuples it
walks.
**BASE facts:** (generated at e04154b)
- `_species_pinned_elsewhere` at `skills/ultrapowers/scripts/compile_plan.py:3148` blob b546e04
- `_clause_spans` at `skills/ultrapowers/scripts/compile_plan.py:3125` blob b546e04
- `_git_substring_files` at `skills/ultrapowers/scripts/compile_plan.py:2545` blob b546e04
- `_is_test_file` at `skills/ultrapowers/scripts/compile_plan.py:3119` blob b546e04
- `examEdited` at `fleet/run-engine.mjs:948` blob ab943ea
- `_species_line` at `skills/ultrapowers/scripts/compile_plan.py:3165` blob b546e04
- `_render_proof_species` at `skills/ultrapowers/scripts/compile_plan.py:3416` blob b546e04
- `tests/test_compile_plan_pinned_elsewhere.py` blob ab3f208
- `_task` at `tests/test_check_provenance.py:43` blob 3662694
- `_plan` at `tests/test_check_provenance.py:72` blob 3662694
- `_sign` at `tests/test_compile_plan_base_message.py:140` blob a8f0166
- `_repo` at `tests/test_compile_plan_pinned_elsewhere.py:188` blob ab3f208
- `_lines` at `evals/frontier/classify.py:48` blob fe29aaf
- `test_a_backticked_span_under_three_characters_draws_nothing` at `tests/test_compile_plan_pinned_elsewhere.py:315` blob ab3f208
- `ok` at `fleet/tests/test_claude_token.mjs:48` blob d2e9a9b
- `repo_four` at `tests/test_compile_plan_pinned_elsewhere.py:214` blob ab3f208
- `_species_wide_files` at `skills/ultrapowers/scripts/compile_plan.py:3352` blob b546e04
- `tests/test_compile_plan_proof_runs.py` blob ce4a5ae
- `skills/ultrapowers/scripts/compile_plan.py` blob b546e04

**Proof:**
- Test: `tests/test_compile_plan_pinned_elsewhere.py`
- Legs: (a) the existing single-line assertion holds — task 1's clause carrying `runner:
  None`, tracked `tests/test_probe.py` asserting it and no task's Files naming that file,
  the output's pinned-elsewhere lines are exactly the one verbatim line; and a three-task plan
  whose tasks 1, 2 and 3 each carry `runner: None` in a Machine clause, against the same
  checkout, draws exactly three pinned-elsewhere lines, the task-1, task-2 and task-3 lines
  in that order [M1]; (b) a task whose clause carries the five-character span `abcde`,
  against a checkout whose one tracked `tests/test_probe.py` contains it, draws no
  pinned-elsewhere line, and the same fixture with the span and the file's content both
  `abcdef` (six characters) draws exactly one line naming `abcdef` and
  `tests/test_probe.py` [M2]; (c) a task whose clause carries the twelve-character span
  `fleet/tests/` against a checkout whose one tracked `tests/test_probe.py` contains it draws
  no pinned-elsewhere line, and the same fixture with the span `fleet/tests` (eleven
  characters, no trailing slash) and the file containing `fleet/tests` draws exactly one line
  naming `fleet/tests` and `tests/test_probe.py` [M3]; (d) a task whose clause carries
  `runner: None` against a checkout of nine tracked test files under `tests/`, named
  test_p1.py through test_p9.py and each containing it, none declared, draws no
  pinned-elsewhere line [M4]; (e) the same nine-file checkout with the first of those files
  added as task 2's `Test:` entry draws no pinned-elsewhere line [M4]; (f) the eight-file
  checkout, test_p1.py through test_p8.py under `tests/`, none declared, draws exactly eight
  lines, one per file in path order, each equal to the M1 line with that path [M4]; (g) the
  existing `--check`-alone test (no pinned-elsewhere line, exit 0,
  `PLAN OK` first) and the existing no-`--base` test (no line) still pass, the byte-identity
  assertion of `tests/test_compile_plan_proof_runs.py` is re-run from this file and holds,
  and the five-species fixture is run by the Run: bullet below [M5].
- Run: python3 -m pytest -q -p no:cacheprovider tests/test_compile_plan_proof_species.py tests/test_compile_plan_check_cost.py
- The previous bullet runs the five-species fixture (exactly five lines, one per registered
  species) and the species-vocabulary pins over the skill text, neither of which this task
  may move [M5].

**Stale-if:**
- path-absent: `skills/ultrapowers/scripts/compile_plan.py`
- issue-closed: #671
