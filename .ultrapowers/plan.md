# Five advisories before a reader

**Grammar:** claims-v1

**Claim:** After this run, `compile_plan.py --check --renders` warns me before a reader is
dispatched when a clause replaces a literal an existing test pins outside the task's Files,
when a Global Constraints `Check:` runs a sim every task will pay for, when a prose constraint
is one a command could decide, when a task's Files list is wider than eight entries, and when a
threshold or an either/or in a clause has legs on only one side; and ultrawrite says so.
(elicited)

**Goal:** The compiler-and-ultrawrite half of the clock session (the engine half is runs 10 and
11): the gate species found by hand on 2026-09-04 become `ADVISORY` lines a regex prints
before any reader spends its one question on them — #656 (a behaviour change owns every
existing pin of it: run-8's one blocking finding), #657 (a `Check:` that runs a sim is paid by
every task on every pass: ~3 min per chain in plan B), #632's first half (a prose constraint a
command could decide parked runs 5 and 6 on acks the driver could have answered), #582 (a
19-file task hit the worker wall clock while its 3–8-file siblings finished), and the two
#616 species not yet mechanised (a threshold bracketed on one side; an either/or with a leg
for only one side). Advisories gate nothing (#492/#496): every one prints only under
`--renders`, so the Run-less fixture corpus's `--check` bytes stay what leg (e) of
`tests/test_compile_plan_proof_runs.py` froze. #632's second half (`ULTRA_BASE` in the driver's
environment) is engine work and is not here; #637's third site and #645's `package.json` rung
wait for a hand PR after run-11 merges. Nothing under `fleet/` is touched.

**Tech Stack:** Python 3 (`skills/ultrapowers/scripts/compile_plan.py`, `python3 -m pytest`
with `pytest-xdist`), Markdown (`skills/ultrawrite/SKILL.md`, validated by
`skills/ultrapowers/scripts/validate_skill.py`). Nothing is added to any dependency file.

**Spec:** #656, #657, #632 (part 1), #582, #616 (the two remaining species). The issues carry
the design; there is no separate spec document.

**Parallelization rationale:** One wave, width 5. All five tasks modify
`skills/ultrapowers/scripts/compile_plan.py`, each adding one render or one species function
beside the existing ones and one line to a registration list — text that folds. Tasks 2 and 3
both modify `skills/ultrawrite/SKILL.md` in two different paragraphs (the species list under
§The proof gate; a sentence under §Global Constraints discipline) — text that folds. No task
consumes a sibling's symbol, so no edge is derived and no task waits. Each task's exam is a
new test file, so no two examiners write one file.

## Global Constraints

- The fleet is byte-identical to BASE — runs 10 and 11 own it.
- Check: test "$(git hash-object fleet/run-engine.mjs)" = b90f2f30356dcad03049b4d2e050bfc1f9a78f14
- Check: test "$(git hash-object fleet/launch.mjs)" = 61d0e7ae4ffaba2103fa2fd507438871785f17e0
- Check: test "$(git hash-object fleet/sandbox-boot.sh)" = 6be6ef327f12bc4244d6850b58b1f9bac4b21b84
- Check: test "$(git hash-object fleet/janitor.mjs)" = e084e38b4247d028292e18bc7bb94a266c8e0fc3
- The frozen verification periphery is untouched: `skills/ultrapowers/scripts/gate_check.py`,
  `ultra_gate.py` and `run_acceptance.sh` are byte-identical to BASE, and the compiler's
  refusal vocabulary gains no word — every new line is an `ADVISORY`, printed only under
  `--renders`.
- Check: test "$(git hash-object skills/ultrapowers/scripts/ultra_gate.py)" = 949bf784a10c7414880887cddaf9132c1415de7e
- Check: test "$(git hash-object skills/ultrapowers/scripts/gate_check.py)" = fc6e5dcf7c507643e603b69f605d1fd7da82d5f3
- Check: test "$(git hash-object skills/ultrapowers/scripts/run_acceptance.sh)" = 8ef475ac74f0ced637201c3d801de90dd4652eea
- `skills/ultrawrite/SKILL.md` still validates.
- Check: python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrawrite
- No shouted imperative (an all-caps must, never or always as a whole word) is added to
  `skills/ultrawrite/SKILL.md`.
- No file outside a task's own Files block is edited.

**Acceptance:** suite — the committed suite is the verification.

### Task 1: A clause that replaces a pinned literal is told which test pins it

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `skills/ultrapowers/scripts/compile_plan.py`
- Test: `tests/test_compile_plan_pinned_elsewhere.py`

**Claim:** The compiler warns me before a reader is dispatched when a clause replaces a
literal an existing test pins outside the task's Files. (derived)
Machine: M1. Under `--check --renders --base <checkout>`, for each claims-v1 task and each
backticked span of three or more characters in its Machine clauses, when a tracked test file
under `<checkout>` — a path under `tests/` or `fleet/tests/`, or whose basename starts
`test_` or contains `.test.` — contains that span as a substring and that file is named in no
task's Files block, the compiler prints exactly one line `ADVISORY proof-species:
pinned-elsewhere — task <id>: <span> is asserted in <path>, which is in no task's Files` per
(task, span, path). M2. It is silent when the pinning file is in some task's Files, when the
span appears only in a non-test file, and when the plan is not claims-v1. M3. Without
`--renders`, and without a `--base` checkout, nothing is printed and `--check`'s exit code
and bytes are unchanged; every Run-less fixture plan's `--check` output stays byte-identical
to the compiler at the frozen sha.

**Authorized-by:** #656 ("print `ADVISORY proof-species: pinned-elsewhere — task <id>:
<literal> is asserted in <path>, which is in no task's Files`").

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** Advisory renders live in `skills/ultrapowers/scripts/compile_plan.py` as plain
functions `fn(tasks, ctx) -> [line, …]` appended to `ADVISORY_RENDERS` as `(name, fn)`;
`render_advisories` (line ~2551) builds `ctx = {"base": Path, "plan_path": Path, "tracked":
_git_tracked(base, exclude), "task_ids": set, "exclude": tuple}` and, when `base` is `None`
or not a git checkout, returns a single `renders skipped` line without calling any render.
The species render `_render_proof_species` (line ~3096) reads each task's
`claims["machine_clauses"]` (from `parse_claims_body`) and `claims["proof_legs"]`, calls each
`_species_*` function, and prints through `_species_line(species, task_id, detail)`, whose
shape `ADVISORY proof-species: %s — task %s%s: %s` is pinned by the regex in
`tests/test_compile_plan_proof_species.py`; a new species joins that render's list in the
same shape. `_git_word_files(base, word, exclude)` (line ~2532) greps tracked CODE files for a
whole word; this species wants a fixed-string substring over tracked files (`git grep -l -F`)
filtered to the test-file shapes above, since a literal like `runner: None` is not one word.
Each task dict carries `creates`, `modifies`, `writes` and `reads` (the Files block's paths;
`reads` holds the `Test:` paths), so "named in no task's Files" is the union of every task's
`writes` and `reads`. The exam builds a plan with the `_task`/`_plan`/`_sign` helpers the
species test file shows (a claims-v1 plan needs an all-pass verdict record beside it) against
a temporary git checkout it commits itself, with a `tests/test_probe.py` carrying the literal;
`test_compile_plan_proof_species.py`'s five-species fixture must stay at exactly five lines,
so this species is silent on a plan whose clauses' spans pin nothing in the base tree.
**BASE facts:** (generated at af1e7c7)
- `skills/ultrapowers/scripts/compile_plan.py` blob 65ccf30
- `render_advisories` at `skills/ultrapowers/scripts/compile_plan.py:2551` blob 65ccf30
- `_render_proof_species` at `skills/ultrapowers/scripts/compile_plan.py:3096` blob 65ccf30
- `parse_claims_body` at `skills/ultrapowers/scripts/compile_plan.py:740` blob 65ccf30
- `tests/test_compile_plan_proof_species.py` blob 4663225
- `reads` at `fleet/tests/test_claude_token.mjs:319` blob 3a21313
- `_task` at `tests/test_check_provenance.py:43` blob 3662694
- `_plan` at `tests/test_check_provenance.py:72` blob 3662694
- `_sign` at `tests/test_compile_plan_base_message.py:140` blob a8f0166
- `tests/test_compile_plan_proof_runs.py` blob 9a949c2

**Proof:**
- Test: `tests/test_compile_plan_pinned_elsewhere.py`
- Legs: (a) a checkout whose tracked `tests/test_probe.py` contains `runner: None` and a plan
  whose task 1 Machine clause carries `` `runner: None` `` with Files naming only
  `app/x.py` prints exactly one line, equal to `ADVISORY proof-species: pinned-elsewhere —
  task 1: runner: None is asserted in tests/test_probe.py, which is in no task's Files`, and
  with the same literal also in tracked `fleet/tests/test_probe.mjs`, `src/foo.test.ts` and
  `lib/test_x.py` the plan yields four lines, one per pinning file, sorted by path [M1];
  (b) the same plan with `tests/test_probe.py` added to task 2's Files prints no
  `pinned-elsewhere` line, the same literal present only in `app/x.py` prints none, and a
  legacy-grammar plan prints none; and the literal in tracked `src/helpers.py` (neither a
  tests directory nor a test-shaped basename) prints none [M2]; (c) the plan run with `--check` alone, and with
  `--check --renders` and no `--base`, prints no `pinned-elsewhere` line, and the
  byte-identity assertion of `tests/test_compile_plan_proof_runs.py` (its frozen-sha comparison) still holds
  when re-run from this file [M3].
- Run: python3 -m pytest -q -p no:cacheprovider tests/test_compile_plan_pinned_elsewhere.py
- The previous bullet is the exam [M1] [M2] [M3].
- Run: python3 -m pytest -q -p no:cacheprovider tests/test_compile_plan_proof_species.py tests/test_compile_plan_proof_runs.py
- The previous bullet is the existing species and corpus pins, unchanged [M3].

**Stale-if:**
- path-absent: `tests/test_compile_plan_proof_species.py`
- issue-closed: #656

### Task 2: A `Check:` that runs a sim is named as a per-task cost

**Type:** implementation

**Files:**
- Modify: `skills/ultrapowers/scripts/compile_plan.py`
- Modify: `skills/ultrawrite/SKILL.md`
- Test: `tests/test_compile_plan_check_cost.py`

**Claim:** The compiler warns me before a reader is dispatched when a Global Constraints
`Check:` runs a sim every task will pay for, and ultrawrite says so. (derived)
Machine: M1. Under `--check --renders`, for each `- Check:` bullet whose command names a
path under `tests/` or `fleet/tests/` (a token beginning `tests/` or `fleet/tests/`, or
containing `/tests/`), the compiler prints one line `ADVISORY check-cost: <command, clipped
to 80 characters> — paid by every task on every pass; if one task owns what it tests, make it
that task's Run:`. M2. It is silent for a `Check:` naming no such path, for one ending
`(minor)`, and for a plan with no `## Global Constraints` section; the line is printed for a
legacy-grammar plan too, since a `Check:` belongs to no grammar. M3. Without `--renders`
nothing is printed and every Run-less fixture plan's `--check` output stays byte-identical to
the compiler at the frozen sha. M4. `skills/ultrawrite/SKILL.md` §Global Constraints
discipline says that a `Check:` that runs a sim is paid by every task on every pass and
belongs in the owning task's `Run:`, and its species list under §The proof gate names
`pinned-elsewhere`, `check-cost`, `prose-check`, `wide-files`, `wide-contract`,
`threshold-one-sided` and `disjunct-without-leg` after `directory-absence-pin`.

**Authorized-by:** #657 ("Advisory under `--check --renders`: for each `- Check:` whose
command names a path under `fleet/tests/` or `tests/` … Also worth a sentence in ultrawrite's
Global Constraints section").

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** `parse_constraint_checks(text)` (line ~1559 of `compile_plan.py`) answers the
section's `- Check:` bullets as `{"cmd", "minor"}` in order, with `(minor)` stripped and
flagged; `_clip_run(command, n=80)` (line ~2949) is the clipping the species lines use. A
plan-level render is registered like `_render_process_rules` (line ~2861: `fn(tasks, ctx)`
reading `ctx["plan_path"]`, appended to `ADVISORY_RENDERS` under its own name) — this one is
its own render `check-cost`, not a `proof-species` line, because the species line shape names
a task and a `Check:` belongs to none; the line's own prefix is `ADVISORY check-cost: `. The
ultrawrite skill's species list is the sentence beginning `The \`ADVISORY proof-species:\`
lines of \`compile_plan.py --check --renders\` name the rejection species found by hand`
(line ~193), ending `\`suite-total-pin\`, \`directory-absence-pin\`.`; the four sibling tasks
of this plan add the species this list names, and the list is edited here alone so no two
tasks rewrite one sentence. §Global Constraints discipline (line ~258) ends with the sentence
`So a constraint a command can decide is written as a Check:, never as prose — prose is where
the undecidable half goes.`; the new sentence follows it. `validate_skill.py` reads the skill's
frontmatter and structure and is a Global Constraints `Check:` of this plan.
**BASE facts:** (generated at af1e7c7)
- `skills/ultrawrite/SKILL.md` blob 967af48
- `_render_process_rules` at `skills/ultrapowers/scripts/compile_plan.py:2863` blob 65ccf30
- `tests/test_compile_plan_proof_runs.py` blob 9a949c2

**Proof:**
- Test: `tests/test_compile_plan_check_cost.py`
- Legs: (a) a plan whose Global Constraints carry `- Check: node fleet/tests/test_x.mjs |
  grep -q 'ALL TESTS PASSED'`, `- Check: python3 -m pytest -q tests/test_y.py` and `- Check:
  node packages/x/tests/y.mjs` prints exactly three `ADVISORY check-cost:` lines, in section
  order, each equal to the clipped command followed by ` — paid by every task on every pass;
  if one task owns what it tests, make it that task's Run:`, and a command longer than 80
  characters is clipped to 79 characters plus `…` [M1]; (b) `- Check: test
  -e src/x.ts`, `- Check: node fleet/tests/test_x.mjs | grep -q ok (minor)`, a plan with no
  Global Constraints section, and the same test-naming `Check:` in a legacy-grammar plan yield
  zero, zero, zero and one line respectively [M2]; (c) the two-check plan run with `--check`
  alone prints no `check-cost` line, and the byte-identity assertion of
  `tests/test_compile_plan_proof_runs.py` (its frozen-sha comparison) still holds when re-run from this file [M3].
- Run: python3 -m pytest -q -p no:cacheprovider tests/test_compile_plan_check_cost.py
- The previous bullet is the exam [M1] [M2] [M3].
- Run: python3 -m pytest -q -p no:cacheprovider tests/test_compile_plan_proof_species.py tests/test_compile_plan_proof_runs.py
- The previous bullet is the existing species and corpus pins, unchanged [M3].
- Run: sed -n '/^## Global Constraints discipline/,/^## Execution handoff/p' skills/ultrawrite/SKILL.md | tr '\n' ' ' | grep -q "paid by every task on every pass.*owning task's .Run:."
- The previous bullet reads only §Global Constraints discipline (from its heading to the next
  section's), wraps joined, and pins both halves of the new sentence in it (the dots stand for
  the backticks around Run:, which a Run: command may not carry) [M4].
- Run: tr '\n' ' ' < skills/ultrawrite/SKILL.md | grep -q 'directory-absence-pin., .pinned-elsewhere., .check-cost., .prose-check., .wide-files., .wide-contract., .threshold-one-sided., .disjunct-without-leg.'
- The previous bullet is the species list, wraps joined, with the seven new names in order
  after the last existing one (the dots stand for the backticks around each name, which a
  Run: command may not carry) [M4].
- Run: python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrawrite
- The previous bullet is the skill validator [M4].

**Stale-if:**
- path-absent: `skills/ultrawrite/SKILL.md`
- issue-closed: #657

### Task 3: A prose constraint a command could decide is told to become a `Check:`

**Type:** implementation

**Files:**
- Modify: `skills/ultrapowers/scripts/compile_plan.py`
- Modify: `skills/ultrawrite/SKILL.md`
- Test: `tests/test_compile_plan_prose_check.py`

**Claim:** The compiler warns me before a reader is dispatched when a prose constraint is one
a command could decide, and ultrawrite says so. (derived)
Machine: M1. Under `--check --renders`, for each prose bullet under `## Global Constraints`
(not a `- Check:` line) that names a backticked path or script (a backticked span containing
`/` or ending `.py`, `.mjs`, `.sh`, `.ts`, `.js` or `.md`) and carries one of the phrases
`byte-identical`, `unchanged from BASE`, `is not edited`, `are not edited`, `not changed`,
`prints ` or `exits 0`, when no `- Check:` command in the same section names that path, the
compiler prints one line `ADVISORY prose-check: \`## Global Constraints\` says "<bullet,
clipped to 90 characters>" — a command can decide this; write it as a Check: so the driver
runs it, since a prose bullet is only the referee's lens and parks the run on an ack`. M2. It
is silent when a `- Check:` in the section names the same path, when the bullet carries none
of the phrases, when the bullet names no path, and when the plan has no Global Constraints
section. M3. Without `--renders` nothing is printed and every Run-less fixture plan's
`--check` output stays byte-identical to the compiler at the frozen sha. M4.
`skills/ultrawrite/SKILL.md` §Global Constraints discipline carries one sentence saying,
in this order, that a prose bullet naming a byte-identical file or a script's output is one
the driver could have run, and to write it as a `Check:` beside the prose.

**Authorized-by:** #632 ("(1) A `compile_plan.py --check --renders` advisory in the
`process-rule` family: a prose bullet under `## Global Constraints` that names a script
invocation, `byte-identical`, `unchanged from BASE`, or a file that must not change reads as
a command — write it as `- Check:`").

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** `parse_global_constraints(text)` (line ~1549) answers the section's prose with
every `- Check:` line removed, and `parse_constraint_checks(text)` (line ~1559) the `Check:`
commands; `_render_process_rules` (line ~2861) is the shape to copy — a plan-level render
over the prose bullets, registered in `ADVISORY_RENDERS` under its own name (`prose-check`
here), with `_clip(s, n=90)` for the quoted bullet. A bullet may wrap over several lines;
join a bullet's continuation lines (lines that do not start a new `- `) before matching, or
the path and the phrase can sit on different lines. The plans this session launched carry
prose like `The laptop side … are byte-identical to BASE` directly above the `Check:` lines
that decide it — the path-named-by-a-Check: exclusion is what keeps those silent, so the
exclusion is by path, not by phrase. The §Global Constraints discipline paragraph to extend
ends `prose is where the undecidable half goes.` (line ~271); a sibling task adds a sentence
after it about sims in `Check:` lines — put this sentence after that one's position or before
it, either way in the same paragraph, and the text folds.
**BASE facts:** (generated at af1e7c7)
- `skills/ultrawrite/SKILL.md` blob 967af48
- `_render_process_rules` at `skills/ultrapowers/scripts/compile_plan.py:2863` blob 65ccf30
- `tests/test_compile_plan_proof_runs.py` blob 9a949c2

**Proof:**
- Test: `tests/test_compile_plan_prose_check.py`
- Legs: (a) a plan whose Global Constraints carry the prose bullet `- \`fleet/launch.mjs\` is
  byte-identical to BASE.` and no `Check:` prints exactly one `ADVISORY prose-check:` line
  whose quoted text is the bullet and whose tail is ` — a command can decide this; write it
  as a Check: so the driver runs it, since a prose bullet is only the referee's lens and
  parks the run on an ack`; a section of seven bullets, one per phrase (`byte-identical`,
  `unchanged from BASE`, `is not edited`, `are not edited`, `not changed`, `prints `, `exits
  0`), each naming a distinct backticked path, yields exactly seven lines in section order;
  `- \`validate_skill.py\` prints \`skill ok\`.` (a bare script name with no slash, matched by
  its `.py` ending) yields one; a bullet wrapped over two lines with the path on the first and `unchanged from BASE` on the
  second yields one; and a bullet longer than 90 characters is quoted as its first 89
  characters plus `…` [M1]; (b) the byte-identical bullet followed by `- Check: test "$(git
  hash-object fleet/launch.mjs)" = abc` yields zero lines; `- \`src/x.ts\` is the entry
  point.` (a path and no phrase) yields zero; `- Nothing here is byte-identical by accident.`
  (a phrase and no path) yields zero; `- Every new module has a test.` yields zero; the
  byte-identical bullet placed in a task's Context slot instead of under `## Global
  Constraints` yields zero; the byte-identical bullet under Global Constraints with the path
  named only by a task's Proof `Run:` (no `- Check:` in the section) still yields one; and a
  plan with no Global Constraints section yields zero [M2]; (c) the one-bullet
  plan run with `--check` alone prints no `prose-check` line, and the byte-identity assertion
  of `tests/test_compile_plan_proof_runs.py` (its frozen-sha comparison) still holds when re-run from this file
  [M3].
- Run: python3 -m pytest -q -p no:cacheprovider tests/test_compile_plan_prose_check.py
- The previous bullet is the exam [M1] [M2] [M3].
- Run: python3 -m pytest -q -p no:cacheprovider tests/test_compile_plan_proof_species.py tests/test_compile_plan_proof_runs.py tests/test_compile_plan_check_constraints.py
- The previous bullet is the existing species, corpus and Check: pins, unchanged [M3].
- Run: sed -n '/^## Global Constraints discipline/,/^## Execution handoff/p' skills/ultrawrite/SKILL.md | tr '\n' ' ' | grep -q "byte-identical file or a script's output.*the driver could have run.*write it as a .Check:. beside the prose"
- The previous bullet reads only §Global Constraints discipline (from its heading to the next
  section's), wraps joined, and pins the sentence's three parts in order — the bullet shape it
  names (a byte-identical file or a script's output), the fact that the driver could have run
  it, and the instruction to write it as a Check: beside the prose (the dots stand for the
  backticks around Check:, which a Run: command may not carry) [M4].
- Run: python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrawrite
- The previous bullet is the skill validator [M4].

**Stale-if:**
- path-absent: `skills/ultrawrite/SKILL.md`
- issue-closed: #632

### Task 4: A wide task is named before a VM is spent on it

**Type:** implementation

**Files:**
- Modify: `skills/ultrapowers/scripts/compile_plan.py`
- Test: `tests/test_compile_plan_wide_files.py`

**Claim:** The compiler warns me before a reader is dispatched when a task's Files list is
wider than eight entries. (derived)
Machine: M1. Under `--check --renders`, a claims-v1 task whose `Create:` plus `Modify:`
entries number more than eight prints one line `ADVISORY proof-species: wide-files — task
<id>: <n> Create/Modify entries — run-55's 19-file task hit the worker wall clock while its
3–8-file siblings finished; split along a Produces symbol`, with `<n>` the count. M2. A
claims-v1 task whose Machine line numbers more than eight clauses prints one line `ADVISORY
proof-species: wide-contract — task <id>: <m> Machine clauses — one contract per task; split
along a Produces symbol`, with `<m>` the count. M3. Both are silent at eight or fewer, and
`Test:` entries do not count toward `wide-files`. M4. Without `--renders` nothing is printed
and every Run-less fixture plan's `--check` output stays byte-identical to the compiler at
the frozen sha; `tests/test_compile_plan_proof_species.py`'s five-species fixture still
prints exactly its five lines.

**Authorized-by:** #582 ("the ultrawrite proof gate reports … a task whose `Files:` list
exceeds N entries or whose machine clause carries more than M numbered parts, naming the split
it would accept"); the threshold of eight is the low end of run-55's measured knee ("between
8 and 19 files"), an advisory that gates nothing.

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** The species render `_render_proof_species` (line ~3096) calls each
`_species_*(task_id, clauses, legs, runs)` function in a list and prints through
`_species_line(species, task_id, detail)`; these two species need the task dict's `creates`
and `modifies` lists as well, so either the render passes the task through or the two live as
a sibling render registered under their own name and printing the same `proof-species` line
shape — either way every line matches the regex `tests/test_compile_plan_proof_species.py`
pins, and the existing five-species fixture (one file per task, one to three clauses) prints
no new line. `parse_machine_clauses(machine)` (line ~529) answers the numbered clauses.
`reads` holds the Files block's `Test:` paths and is not counted.
**BASE facts:** (generated at af1e7c7)
- `tests/test_compile_plan_proof_species.py` blob 4663225
- `_render_proof_species` at `skills/ultrapowers/scripts/compile_plan.py:3096` blob 65ccf30
- `reads` at `fleet/tests/test_claude_token.mjs:319` blob 3a21313
- `tests/test_compile_plan_proof_runs.py` blob 9a949c2

**Proof:**
- Test: `tests/test_compile_plan_wide_files.py`
- Legs: (a) a task with five `Create:` and four `Modify:` entries prints exactly one
  `wide-files` line equal to `ADVISORY proof-species: wide-files — task 1: 9 Create/Modify
  entries — run-55's 19-file task hit the worker wall clock while its 3–8-file siblings
  finished; split along a Produces symbol`, and one with seven `Create:` and five `Modify:`
  prints the same line with `12 Create/Modify entries` [M1]; (b) a task whose Machine line
  numbers nine clauses, each cited by a leg, prints exactly one `wide-contract` line equal to
  `ADVISORY proof-species: wide-contract — task 1: 9 Machine clauses — one contract per task;
  split along a Produces symbol`, and one with eleven clauses prints the same line with `11
  Machine clauses` [M2]; (c) a task with four `Create:`, four `Modify:` and three `Test:`
  entries prints no `wide-files` line, and one with eight clauses prints no `wide-contract`
  line [M3]; (d) a plan whose one task has nine Create/Modify entries and nine clauses, run
  with `--check` alone, prints no `wide-files` and no `wide-contract` line, the byte-identity
  assertion of `tests/test_compile_plan_proof_runs.py` (its frozen-sha comparison) still
  holds when re-run from this file, and `tests/test_compile_plan_proof_species.py` passes
  [M4].
- Run: python3 -m pytest -q -p no:cacheprovider tests/test_compile_plan_wide_files.py
- The previous bullet is the exam [M1] [M2] [M3] [M4].
- Run: python3 -m pytest -q -p no:cacheprovider tests/test_compile_plan_proof_species.py tests/test_compile_plan_proof_runs.py
- The previous bullet is the existing species and corpus pins, unchanged [M4].

**Stale-if:**
- path-absent: `tests/test_compile_plan_proof_species.py`
- issue-closed: #582

### Task 5: A one-sided threshold and a one-legged either/or are named

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `skills/ultrapowers/scripts/compile_plan.py`
- Test: `tests/test_compile_plan_one_sided.py`

**Claim:** The compiler warns me before a reader is dispatched when a threshold or an
either/or in a clause has legs on only one side. (derived)
Machine: M1. Under `--check --renders`, a Machine clause that states a numeric bound — a
number preceded by one of `over`, `more than`, `older than`, `at least`, `>=`, `>` (the
lower-bounded shapes) or `under`, `less than`, `younger than`, `at most`, `no more than`,
`within`, `<=`, `<`, `≤` (the upper-bounded shapes) — whose citing legs together contain at
least one number other than the bound itself but none on the far side of the bound (for a
lower-bounded shape, none strictly below it; for an upper-bounded shape, none strictly above
it) prints one line
`ADVISORY proof-species: threshold-one-sided — task <id>: clause M<k> bounds at <bound>; its
legs probe one side only`. M2. A Machine clause that names two backticked spans joined by
` or ` whose citing legs together contain only one of the two spans prints one line
`ADVISORY proof-species: disjunct-without-leg — task <id>: clause M<k> names \`<a>\` or
\`<b>\`; the legs name only \`<present>\``. M3. Both are silent on their repaired twins — a
bound whose legs carry a number on each side; an either/or whose legs carry both spans — and
`threshold-one-sided` is silent when the citing legs carry no number other than the bound
itself — a leg that restates `90 s` probes nothing, and that shape is `default-unpinned`'s or
`duration-without-clock`'s. M4. Without `--renders` nothing is
printed and every Run-less fixture plan's `--check` output stays byte-identical to the
compiler at the frozen sha; `tests/test_compile_plan_proof_species.py`'s five-species fixture
still prints exactly its five lines.

**Authorized-by:** #616 ("A threshold bracketed on one side … An enumerated disjunct with no
leg … which of the species above become `ADVISORY` lines in `compile_plan.py --check`").

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** The species functions live beside `_species_duration_without_clock` (line
~3036) in `compile_plan.py`, each `(task_id, clauses, legs, runs) -> [line, …]` using
`_citing_legs(legs, clause["id"])` and `_species_line`; a clause dict carries `id` (`M1`)
and `text`, a leg dict carries `label`, `text` and `cites`. The five-species fixture in
`tests/test_compile_plan_proof_species.py` carries `M4. The probe waits ≤ 90 s.` cited by a
leg reading `elapsed under 90 s` — the bound restated and no other number — and its
duration twin cites the same clause with `iterates 3 times` in one task and `elapsed under 90
s` in the other; so the "at least one number other than the bound" condition of M1 is what
keeps that fixture at exactly five lines and the twin silent. Read that fixture before
choosing the number regex (a number inside a backticked command such as `-n 4` is still a
number the legs carry; `3 times` in the duration twin's first task is a number other than 90
on the near side, and that task's own line is `duration-without-clock`'s, not this one's —
so a lower-bounded reading must not be applied to an upper-bounded shape). The regexes are
whole-word and case-insensitive like the existing ones; a bound's unit, when present, rides
into `<bound>` verbatim (`6 h`, `10240 bytes`).
**BASE facts:** (generated at af1e7c7)
- `within` at `fleet/confine-hook.mjs:63` blob e0cd408
- `tests/test_compile_plan_proof_species.py` blob 4663225
- `_species_duration_without_clock` at `skills/ultrapowers/scripts/compile_plan.py:3036` blob 65ccf30
- `_species_line` at `skills/ultrapowers/scripts/compile_plan.py:2958` blob 65ccf30
- `id` at `fleet/run-waves.mjs:105` blob 5283c07
- `text` at `fleet/claude-token.mjs:149` blob 5f75f73
- `tests/test_compile_plan_proof_runs.py` blob 9a949c2

**Proof:**
- Test: `tests/test_compile_plan_one_sided.py`
- Legs: (a) a clause `a VM older than 6 h is stale` whose only citing leg probes `7 h` prints
  exactly one line equal to `ADVISORY proof-species: threshold-one-sided — task 1: clause M1
  bounds at 6 h; its legs probe one side only`; a clause `the comment is at most 200 bytes`
  whose legs probe `150 bytes` and `199 bytes` prints one line ending `bounds at 200 bytes;
  its legs probe one side only`; for each of the lower-bounded shapes `over`, `more than`,
  `older than`, `at least`, `>=` and `>`, a clause `the count is <shape> 6 h` whose only
  citing leg probes `7 h` prints one line ending `bounds at 6 h; its legs probe one side
  only`; for each of the upper-bounded shapes `under`, `less than`, `younger than`, `at
  most`, `no more than`, `within`, `<=`, `<` and `≤`, a clause `the count is <shape> 6 h`
  whose only citing leg probes `5 h` prints one line ending `bounds at 6 h; its legs probe
  one side only`; and a clause `the probe waits ≤ 90 s` whose only citing leg reads `elapsed
  under 90 s` prints no line [M1] [M3]; (b) a clause `the type is \`github\` or the name
  starts \`gh-\`` whose legs name only `github` prints exactly one line equal to `ADVISORY
  proof-species: disjunct-without-leg — task 1: clause M1 names \`github\` or \`gh-\`; the
  legs name only \`github\`` [M2]; (c) the `6 h` clause with legs probing `5 h` and `7 h`,
  the `200 bytes` clause with legs probing `199 bytes` and `201 bytes`, the either/or with
  legs naming both spans, and a `6 h` clause whose legs carry no number each print no line of
  either species [M3]; (d) the one-sided plan run with `--check` alone prints neither line,
  the byte-identity assertion of `tests/test_compile_plan_proof_runs.py` (its frozen-sha comparison) still holds
  when re-run from this file, and `tests/test_compile_plan_proof_species.py` passes [M4].
- Run: python3 -m pytest -q -p no:cacheprovider tests/test_compile_plan_one_sided.py
- The previous bullet is the exam [M1] [M2] [M3] [M4].
- Run: python3 -m pytest -q -p no:cacheprovider tests/test_compile_plan_proof_species.py tests/test_compile_plan_proof_runs.py
- The previous bullet is the existing species and corpus pins, unchanged [M4].

**Stale-if:**
- path-absent: `tests/test_compile_plan_proof_species.py`
- issue-closed: #616
