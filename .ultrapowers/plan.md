# The compiler accepts a quoted plan Claim, quiets its pins and names a BASE sha in a suite

**Grammar:** claims-v1

**Claim:** The plan-level Claim accepts (quoted from #NNN); a plan renders one pinned-elsewhere line per task, naming the literals and their files for the reader to weigh, with no floor or cap; and a Test: sim carrying a 40-hex sha or ULTRA_BASE draws an advisory. (elicited)

**Goal:** #755, #756 and the run-35 species named on #730 — three papercuts of the 2026-09-07
authoring sitting, all in the compiler's `--check` surface and its two companions. The gate
scripts' diagnostic vocabulary is frozen; `--check` advisories are not (CLAUDE.md §Conventions,
#730's last paragraph), and #755 is a grammar widening the compiler's own tests pin. #730 stays
open: only its run-35 species ships here, not the harvest table.
**Closes:** #755 #756

**Tech Stack:** Python 3 stdlib (`skills/ultrapowers/scripts/compile_plan.py`, 4036 lines at
BASE, blob e86ad06; `skills/ultrawrite/scripts/check_provenance.py`, blob 8156c43, which
imports the compiler by `sys.path` and swaps `gh` through `--gh`); the operator skill text
`skills/ultrawrite/SKILL.md` (blob cde4367). The suite is `python3 -m pytest` from the repo
root; `--check --renders` reads a git checkout at `--base` (default: the plan's toplevel) and
prints nothing tree-dependent without `--renders`.

**Parallelization rationale:** one wave, width 3. Three contracts over three regions of one
file: #755 is the header parse at lines 300–380 plus the provenance script; #756 is the
`pinned-elsewhere` species at lines 3127–3200 and its call at 3477–3502; the #730 advisory is a
new render block registered at its own site between the `sha-unguarded` registration (line 3610)
and `main` (line 3613) — three distinct regions, no shared list appended by two tasks (rule 4),
and no task consumes a symbol another produces, so same-file text folds and no chain is drawn.
Tasks 1 and 3 both touch `SKILL.md`, in two different paragraphs (§The document; §The proof
gate's species list) — text, folds.

## Global Constraints

- Check: `git diff --quiet $ULTRA_BASE -- skills/ultrapowers/scripts/gate_check.py skills/ultrapowers/scripts/ultra_gate.py skills/ultrapowers/scripts/run_acceptance.sh`
- Check: `git diff --quiet $ULTRA_BASE -- evals/fixtures tests/fixtures/plans/2026-09-01-511-attempt-racing.md tests/fixtures/plans/2026-09-02-papercut-drain-2.md tests/test_compile_plan_proof_runs.py`
- Check: `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrawrite`
- The frozen verification periphery is untouched (the first Check), and so is the byte-pinned
  corpus and its pin (the second, a `git diff` and nothing more): every Run-less fixture plan's
  bare `--check` output stays byte-identical to the compiler blob at the frozen sha in
  `tests/test_compile_plan_proof_runs.py` — nothing here changes a line a Run-less fixture plan
  prints, and every new render prints only under `--renders`.
- The compiler's refusal messages that stand at BASE keep their first words: a plan the BASE
  compiler refuses with a `grammar:` line is refused with a line of the same prefix.
- Each new render registers itself with its own `ADVISORY_RENDERS.append` at its own site in
  its own region of `compile_plan.py`; the three tasks touch three disjoint line ranges of that
  file, named in each task's Context.
- No committed exam reads `ULTRA_BASE` or freezes a commit sha of this repository: an exam of
  the new advisory builds its own commit in a temporary checkout and freezes that sha; the only
  commit shas in the suite are the ones there at BASE (named in Task 3's Context).
- The §The document paragraph of `skills/ultrawrite/SKILL.md` that begins "Above the first
  task:" still names the header Claim line exactly once — the pin at
  `tests/test_plan_level_claim.py:378` is the lens.

**Acceptance:** suite — the committed suite is the verification.

### Task 1: The plan-level Claim accepts a quoted tag and the provenance script resolves it

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `skills/ultrapowers/scripts/compile_plan.py`
- Modify: `skills/ultrawrite/scripts/check_provenance.py`
- Modify: `skills/ultrawrite/SKILL.md`
- Test: `tests/test_plan_level_claim.py`
- Test: `tests/test_check_provenance.py`

**Claim:** The plan-level Claim accepts `(quoted from #NNN)` as well as `(elicited)`; `check_provenance.py` string-matches a plan-level quote against the issue body exactly as it does a task-level one; ultrawrite §The document says so. (quoted from #755)
Machine: M1. A header line `**Claim:** <sentence> (quoted from #1)` above the first task
parses: parse_plan_claim returns the sentence with the tag stripped, plan_claim_violations
returns `[]`, a new plan_claim_provenance(md_text) returns the string `quoted:#1`, and the
compiler's --check on such a plan exits 0 with `PLAN OK` as its first line.
M2. A header tagged `(elicited)` returns `elicited` from plan_claim_provenance and compiles as
at BASE; a header tagged `(derived)`, a header with no tag at all, and a header that is nothing
but a `(quoted from #1)` tag are each refused by --check with a line beginning `grammar:
plan-level Claim` and a non-zero exit.
M3. The provenance script on a claims-v1 plan whose header Claim is tagged `(quoted from #1)`
reads issue 1 through the `--gh` command as `issue view 1 --json body -q .body` — at most once
for the number, shared with any task quoting the same issue — and when the whitespace-folded
header sentence is a substring of the folded body it exits 0 and its success line counts the
header among the quotes (`2 claim quotes` when one task also quotes an issue).
M4. When the folded header sentence is not a substring of the folded body the script prints
`provenance: plan-level claim is not verbatim in #1` and exits 2; when the `--gh` command fails
for that number it prints `provenance: plan-level claim quotes #1, which does not resolve` and
exits 2; a header tagged `(elicited)` costs no `--gh` invocation, as at BASE.
M5. In `skills/ultrawrite/SKILL.md`, the §The document paragraph beginning `Above the first
task:` says the plan-level Claim closes `(elicited)` or `(quoted from #NNN)` and does not
offer `(derived)` for it, and the paragraph names the header Claim line exactly once.

**Authorized-by:** #755; CLAUDE.md §Conventions (the frozen periphery is the gate scripts and
the refusal vocabulary, not the header grammar); #552 (the plan-level Claim's origin, whose
"elicited is the only tag" comment at line 302–306 is what this task retires).

**Interfaces:**
- Consumes: nothing
- Produces: `plan_claim_provenance(md_text) -> str | None`

**Context:** At BASE `PLAN_CLAIM_ELICITED_RE` (compile_plan.py:307, blob e86ad06) is
`\(elicited\)\s*$`; `parse_plan_claim` (line 352) strips it and `plan_claim_violations` (line
363) refuses a header without it with `grammar: plan-level Claim carries no provenance tag — …`
and an empty sentence with `grammar: plan-level Claim carries no operator sentence — …`. The
task-level tag regex is `CLAIM_PROVENANCE_RE` (line 272), `\((elicited|derived|quoted from
#(\d+))\)\s*$`, and the task-level provenance string shapes are `elicited`, `derived`,
`quoted:#NNN` (line 751). A plan-level `(derived)` has nothing above it to descend from, so it
stays refused; the refusal line keeps the `grammar: plan-level Claim` prefix the BASE test
`test_header_claim_without_the_elicited_tag_is_refused` (tests/test_plan_level_claim.py:163,
blob 994ffd2) matches — that test and `HEADER_ONE_LINE` (line 39) still hold. Only
`compile_plan.py` reads the plan-level tag: `extract_gate_input.py` and `--emit-args` call
`parse_plan_claim` (so do `tests/test_compile_plan_proof_species.py` and
`tests/test_compile_plan_sha_unguarded.py`, by import — its signature does not move), which
must strip the new tag as it strips the old, and `fleet/` reads no tag. In
`check_provenance.py` (blob 8156c43) `check_plan` (line 81) fetches `plan_claim` at line 90
and resolves task quotes through `issue_body(number, gh, cache)` — the cache is per number and
the task-level failure lines are `provenance: task %s claim is not verbatim in #%s` and
`provenance: task %s claim quotes #%s, which does not resolve`; the plan-level lines above are
their `plan-level claim` twins. The plan-level quote is resolved before the task loop, so the
`gh.log` of the test seam (`_fake_gh`, tests/test_check_provenance.py:78, blob 3662694: a
`/bin/sh` script that prints a canned body for a known number, exits 3 otherwise, and appends
`$*` to a log) shows exactly one `issue view 1 --json body -q .body` line for a plan whose
header and one task both quote #1. The success line at line 171–175 is `provenance: ok — <n>
claim quote(s)[, <m> derived] and <k> anchor(s) resolve`; the header quote is counted in `<n>`.
In `SKILL.md` (blob cde4367) the sentence to change is lines 21–23: "one `**Claim:**` line — the
operator's own do:/see: sentence about what they will see after the run, elicited and closed
`(elicited)` —"; `tests/test_plan_level_claim.py:378` pins that the paragraph beginning "Above
the first task:" contains `**Claim:**` exactly once, and `tests/test_ultrawrite_skill.py` runs
`validate_skill.py` on the directory and greps the skill for the name of the provenance script.
The §Self-review bullet at line 366 ("The plan carries one `**Claim:**` above the first task,
elicited.") is reworded to admit the quoted form; line 383's pin only asks that `(derived)` and
`plan-level Claim` still appear after `## Self-review`. Compile refusals keep their vocabulary:
no new `grammar:` prefix is introduced, the two BASE refusal lines gain at most a mention of the
second tag.

**Proof:**
- Test: `tests/test_plan_level_claim.py`
- Test: `tests/test_check_provenance.py`
- Run: `bash -c 'sed -n "/^Above the first task:/,/^$/p" skills/ultrawrite/SKILL.md | tr "\n" " " | grep -q "quoted from #NNN"'`
- Run: `bash -c 'sed -n "/^Above the first task:/,/^$/p" skills/ultrawrite/SKILL.md | tr "\n" " " | grep -q "(elicited)"'`
- Run: `bash -c '! sed -n "/^Above the first task:/,/^$/p" skills/ultrawrite/SKILL.md | tr "\n" " " | grep -q "(derived)"'`
- Run: `bash -c 'test "$(sed -n "/^Above the first task:/,/^$/p" skills/ultrawrite/SKILL.md | grep -o "\*\*Claim:\*\*" | wc -l | tr -d " ")" = 1'`
- Legs, under a comment naming this task (`#755 Task 1`) in each file: (a) a plan whose header
  is `**Claim:** <sentence> (quoted from #1)` gives `parse_plan_claim` the bare sentence,
  `plan_claim_violations` `[]`, `plan_claim_provenance` `quoted:#1`, and `--check` exit 0 with
  first line `PLAN OK` — a compiler that still requires `(elicited)` fails here [M1]; (b) the
  same plan with `(elicited)` gives `elicited` and compiles; the same plan with `(derived)`,
  with no tag, and with a header that is only the tag `(quoted from #1)` each make `--check`
  exit non-zero with a line beginning `grammar: plan-level Claim` — one assertion per row, so a
  compiler that admits any tag fails on the `(derived)` row and one that admits an empty quote
  fails on the tag-only row [M2]; (c) through the `_fake_gh` seam with issue 1's body carrying
  the header sentence hard-wrapped at a different column than the plan wraps it (one line break
  and a run of spaces where the plan has one space): exit 0, the success line carries `2 claim
  quotes` when task 1 also quotes #1, and the log holds exactly one line, equal to `issue view 1
  --json body -q .body` — a script that matches the raw unfolded text fails on the rewrapped
  body, and one that fetches the header and the task separately, or with other arguments, fails
  on the log [M3]; (d) with a body that carries every word of
  the header sentence but one, exit 2 and the output contains `provenance: plan-level claim is
  not verbatim in #1`; with a header quoting #7, which the fake `gh` exits 3 on, exit 2 and the
  output contains `provenance: plan-level claim quotes #7, which does not resolve`; with the
  header tagged `(elicited)` and no task quote, the log is empty — a script that resolves the
  header through the task loop reports it as `task 1` and fails the two line matches [M4];
  (e) the first `Run:` exits 0 only when the paragraph names `(quoted from #NNN)`, the second
  only when it still names `(elicited)` — a rewrite that drops the elicited form fails it — the
  third only when it does not offer `(derived)`, and the fourth only when `**Claim:**` appears
  once in it [M5].

**Stale-if:**
- path-absent: `skills/ultrawrite/scripts/check_provenance.py`
- path-absent: `tests/test_plan_level_claim.py`
- issue-closed: #755

### Task 2: pinned-elsewhere renders one line per task naming each Machine literal a code test outside every Files block asserts

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `skills/ultrapowers/scripts/compile_plan.py`
- Test: `tests/test_compile_plan_pinned_elsewhere.py`

**Claim:** `pinned-elsewhere` renders one line per task, naming each literal backticked in a Machine clause — never a path, a `<N>` placeholder or a state word the compiler already knows — together with the code test files in no task's Files that assert it, for the author and reader to weigh; no floor, no file-count threshold and no per-plan bar decides for them. (derived)
Machine: M1. A candidate span is what BASE's `_clause_spans` collects from a task's Machine
clauses — backticked, six characters or more, not ending in `/`, document order, deduped — and
no longer floor is added: `runner: None` (12 characters) asserted by one undeclared tracked probe
file draws BASE's exact line `ADVISORY proof-species: pinned-elsewhere — task 1: runner: None is
asserted in tests/test_probe.py, which is in no task's Files`, and the same literal written
unbackticked in the Machine clause, or backticked only in the operator sentence, the Context and
a leg of the Proof, draws nothing.
M2. Three kinds of candidate are skipped even when a tracked undeclared test file asserts
them, while the same file and clause position with `runner: None` draws one line: a path —
the span contains `/`, or is a bare file name (a run of word, dot and hyphen characters ending
in a dot and one to four letters); a placeholder — the span contains `<` and a later `>`; and
a state word — the span, with any surrounding single or double quotes removed, is one of the
six words booting, running, publishing, done, parked, failed (case-insensitively), while a
twelve-character word outside the six at the same position draws one line.
M3. A pinning file is a tracked test file by BASE's four shapes (under `tests/` or
`fleet/tests/`, a basename starting `test_`, or a basename containing a dot-test-dot infix)
whose extension is one of `.py`, `.js`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.jsx`, `.sh`, and that
no task's Files (Create:, Modify: or Test:) names: a `.md` under `tests/` asserting the span is
not a pinning file, a `.py` under `tests/` and a `.mjs` under `fleet/tests/` are; and no count
of pinning files silences a span — nine tracked undeclared test files asserting it are all nine
named, in path order, and with one of the nine declared as task 2's `Test:` the other eight are.
M4. A task draws at most one line, `ADVISORY proof-species: pinned-elsewhere — task <id>:
<detail>`, where `<detail>` is, for each candidate with at least one pinning file, in clause
order, `<span> is asserted in <path1>, <path2>` with the paths sorted, the candidates joined by
`; `, closed by `, which is in no task's Files` when the line names exactly one distinct file
and by `, none of which is in any task's Files` otherwise; a task none of whose candidates has a
pinning file draws no line; and three tasks carrying the same span against the same checkout
draw three lines, in task order.
M5. For each of the six plans under `tests/fixtures/plans/2026-09-07/` — acceptance-log,
boot-pipelines, evidence-page, publish-decisions, retire-closed, retire-skips — the compiler's
`--check --renders --base <repo root>` prints at most one line containing pinned-elsewhere per
task of the plan and at least one such line across the six; the acceptance-log plan's task 1
line names `testCmd` (a literal in more tracked test files than BASE's eight-file line) and the
evidence-page plan's task 1 line names `commitStates(ctx)` with
`fleet/tests/test_sandbox_boot_edges.mjs` among its files and without
`fleet/tests/test_sandbox_boot.mjs`, which that plan's Files declares; on every such line each
named span (the text before ` is asserted in ` of each `; `-separated segment) contains no `/`,
is not a bare file name, holds no `<` followed by `>`, and is none of the six state words, and
each named file is a tracked path with one of the eight code extensions, containing the span,
that no task of that plan declares; and bare `--check` on each of the six prints no such line
and exits 0.

**Authorized-by:** #756; the operator's 2026-09-07 decision on #756 (no hard caps: the
12-character floor, the file-count vocabulary threshold and the ≤ 5 bar are dropped — the
doctrine that retired every prose ceiling, CLAUDE.md §Wayfinding); #671 (the directory-prefix
skip this generalises); #656 (the species' origin: a strict-equality pin in one sibling file).

**Interfaces:**
- Consumes: nothing
- Produces: `_species_pinned_elsewhere(task_id, clauses, base, declared, exclude) -> list[str]`

**Context:** The species at BASE (compile_plan.py blob e86ad06, lines 3127–3200): `MIN_SPAN = 6`
(line 3133 — the grep-noise floor, kept: below six a span such as `src/` or `M1.` matches half
the tree as a substring), `PINNED_EVERYWHERE = 8` (line 3141 — the vocabulary threshold, which
this task deletes along with its `if len(pinning) > PINNED_EVERYWHERE: continue` at line 3189
and the comment block above it), `PINNED_ELSEWHERE_DETAIL` (line 3142), `TEST_DIR_PREFIXES`
and `_is_test_file` (lines 3145–3151), `_clause_spans` (line 3154, which drops a span ending
in `/` — #671), `_species_pinned_elsewhere` (line 3182, one line per (task, span, path),
span-major), called last per task from `_render_proof_species` (lines 3477–3502). `CODE_EXTS`
is line 2501; `_git_substring_files` (line 2545) greps every tracked file, any extension —
which is why a fixture plan under `tests/fixtures/plans/` counts as a "test file" at BASE (the
six 2026-09-07 plans, tracked at `9395cd11`, would pin one another's literals; M3's extension
rule is what stops that). The compiler holds no state-word vocabulary at BASE — the six words
are `fleet/CONTRACT.md:230`'s `state` enum, so M2's set is a new constant here. The operator's
decision (2026-09-07, recorded on #756): no hard caps — the compiler names every literal and
its files, and the author and the gate reader weigh them, the same doctrine that retired every
prose ceiling; so there is no floor above BASE's six, no file-count line, and no per-plan
bound. Measured on the six plans against the `9395cd11` tree (`git grep -F` over tracked
files, code-extension test files only, the three skips applied, the six-character floor kept):
BASE's shape prints 0 / 22 / 54 / 26 / 29 / 18 lines for acceptance-log / boot-pipelines /
evidence-page / publish-decisions / retire-closed / retire-skips; the one-line-per-task shape
prints 1 / 1 / 1 / 1 / 2 / 1 lines naming 1 / 9 / 17 / 16 / 7 + 8 / 10 literals, and the
literals range from one file (`plan_title`, `phase_refresher`, `html_url`) to dozens
(`testCmd` 29, `python3` 36, `commit` 83) — a long line is the decided shape, and the reader
decides what to make of `commit` in 83 files. The evidence-page task 1 literal
`commitStates(ctx)` is in five tracked `fleet/tests/test_sandbox_boot*.mjs` files, of which
`test_sandbox_boot.mjs` is that plan's own `Test:` — the declared filter drops it and the
other four (`_edges`, `_merge`, `_record`, `_selfmerge`) stay, which is M5's positive row;
acceptance-log task 1's `testCmd` is in 29 tracked test files and none of that plan's Files,
silent at BASE by the vocabulary line and named now. Existing pins in the exam file (blob
7f15086) this task re-scopes, each rewritten under the `#756 Task 2` comment rather than
deleted: `test_one_line_per_pinning_file_sorted_by_path` (line 303: four files are now one
line naming four paths in path order), `test_d_a_span_in_nine_tracked_test_files_draws_nothing`
(line 583: nine files are now nine paths on one line), `test_e_the_count_is_taken_before_the_declared_filter`
(line 594: with one of nine declared, the line names the other eight) and
`test_f_a_span_in_eight_tracked_test_files_draws_eight_lines` (line 609: one line naming
eight). `EXPECTED_ONE` (line 73), `pin_line` (line 84), `PIN_PATHS` (line 80, whose four paths
all carry code extensions), `test_a_backticked_span_under_six_characters_draws_nothing` (line
319), `test_b` (lines 520/531, five vs six characters — BASE's floor stands), `test_c` (lines
554/566, the trailing slash), `test_a_three_tasks_carrying_the_same_span_draw_three_lines_in_task_order`
(line 503) and every silence in the exam's BASE "three silences" block (line 331) hold
unchanged. The exam's temporary checkouts (`_repo`, line 192; `_probe_source`, line 188 —
`def test_header(): assert header() == '<literal>'` in `tests/test_probe.py`) are the shape
to extend for every new row; the exam file is itself a tracked code test file that no fixture
plan declares, so a fixture literal the exam spells whole (`commitStates(ctx)`, `testCmd`)
adds the exam to that literal's own file list — spell each as a concatenation
(`"commitStates" + "(ctx)"`) in the exam's source, and give the two-span rows a second span
absent from the tree (`wave: fold`, no tracked hit at `9395cd11`). The six fixture plans are
copies of the 2026-09-07 plans in `tests/fixtures/plans/2026-09-07/` — a subdirectory,
because every corpus glob (`tests/test_compile_plan_proof_runs.py:351`,
`tests/test_all_plans_compile.py:11`, `tests/test_compile_plan_check_constraints.py:276`,
`tests/test_compile_plan_clause_citation.py:246`) is a non-recursive `*.md` over
`tests/fixtures/plans/`, and one of the six (`boot-pipelines-survive-sigpipe`) carries no
`Run:` bullet, so in the parent directory it would join the byte-pin against the 0a3559a blob
and differ. They are tracked at BASE `9395cd11` (Stale-if below); this task neither creates
nor edits them. M5's renders run with `--base` at the repository root of the clone so the tree
the species greps is the integration tree, and its structural rows parse the line grammar M4
fixes rather than pin a count; a legacy-grammar plan and `--check` without `--renders` stay
silent as at BASE (lines 359 and 375 of the exam).

**Proof:**
- Test: `tests/test_compile_plan_pinned_elsewhere.py`
- Legs, under a comment naming this task (`#756 Task 2`): (a) the `runner: None` plan against
  the BASE `repo` fixture draws exactly `EXPECTED_ONE`; the same 12-character literal written
  unbackticked in the Machine clause, and written backticked only in the operator sentence, the
  Context and a leg of the Proof, draws nothing — a render that reads any literal anywhere in
  the task fails [M1]; (b) a slash-bearing span such as ultra/evidence-run-32 and a bare file
  name such as status-page.json, each asserted by an undeclared tracked probe file, draw
  nothing, while `runner: None` in the same file and position draws one line [M2]; (c) a span
  with a slash and a placeholder such as ultra/integration-run-<N> and a bracket-only one such
  as run <N> parked, each asserted the same way, draw nothing, while `runner: None` in the same
  file and position draws one line [M2]; (d) for each of the six state words, once bare and once
  quoted (`'publishing'`, `"failed"`), asserted the same way, nothing is drawn, while a
  non-state twelve-character word (`publishings!`) in the same position draws one line, so the
  silence is the vocabulary and not the length [M2]; (e) a tracked probe under
  `tests/fixtures/plans/` with a `.md` extension asserting `runner: None` draws nothing, while a
  `.py` probe under `tests/` and a `.mjs` probe under `fleet/tests/` asserting it draw one line
  naming both, in path order [M3]; (f) nine tracked undeclared test files asserting the span
  draw one line naming all nine in path order; the same nine with `tests/test_p1.py` declared as
  task 2's `Test:` draw one line naming the other eight and not `tests/test_p1.py`; and a single
  file named in some task's Files draws nothing — a render that silences a span above any
  file count fails the nine row [M3]; (g) a probe file asserting both `runner: None` and
  `wave: fold`, with both spans in task 1's clauses in that order, draws exactly one line
  reading `runner: None is asserted in tests/test_probe.py; wave: fold is asserted in
  tests/test_probe.py, which is in no task's Files` — a render that prints per span, or
  orders by span, fails [M4]; (h) two probe files each asserting one of the two spans draw
  exactly one line reading `runner: None is asserted in tests/test_probe.py; wave: fold is
  asserted in tests/test_probe_two.py, none of which is in any task's Files` [M4]; (i) a plan
  whose task 1 carries only `wave: fold` against the BASE `repo` fixture draws no line, and
  the three-task plan draws its three `EXPECTED_ONE`-shaped lines in task order [M4];
  (j) the acceptance-log fixture's `--check --renders --base <repo root>` run prints no more
  lines containing pinned-elsewhere than the plan has tasks, and its task 1 line names
  `testCmd` — a render keeping a file-count line fails [M5]; (k) the boot-pipelines fixture,
  the same per-task bound [M5]; (l) the evidence-page fixture, the same bound, and its task 1
  line's `commitStates(ctx)` segment names `fleet/tests/test_sandbox_boot_edges.mjs` and not
  `fleet/tests/test_sandbox_boot.mjs` — a render skipping the declared filter fails [M5];
  (m) the publish-decisions fixture, the same bound [M5]; (n) the retire-closed fixture, the
  same bound [M5]; (o) the retire-skips fixture, the same bound [M5]; (p) the six runs together
  print at least one such line — a species that went silent fails [M5]; (q) on every such line
  of the six runs, each semicolon-separated segment parses as a span, the words "is asserted
  in", and a comma-separated file list, where the span carries no slash character, does not
  match the bare-file-name shape, holds no opening angle bracket followed by a closing one
  and, quotes stripped, is none of the six state words, and each listed file is a tracked path
  of the checkout with one of the eight code extensions, whose content contains the span, and
  that no Files block of that plan names — the row fails on a path, a placeholder, a state
  word, an unnamed file or a declared file [M5]; (r) bare `--check` on
  each of the six exits 0 with no line containing pinned-elsewhere [M5].

**Stale-if:**
- path-absent: `tests/fixtures/plans/2026-09-07/2026-09-07-acceptance-log-on-the-record.md`
- path-absent: `tests/fixtures/plans/2026-09-07/2026-09-07-boot-pipelines-survive-sigpipe.md`
- path-absent: `tests/fixtures/plans/2026-09-07/2026-09-07-evidence-page-per-phase.md`
- path-absent: `tests/fixtures/plans/2026-09-07/2026-09-07-publish-decisions-as-events.md`
- path-absent: `tests/fixtures/plans/2026-09-07/2026-09-07-retire-closed-unmerged-branches.md`
- path-absent: `tests/fixtures/plans/2026-09-07/2026-09-07-retire-skips-live-runs.md`
- path-absent: `tests/test_compile_plan_pinned_elsewhere.py`
- issue-closed: #756

### Task 3: A Test: file that reads ULTRA_BASE or freezes a commit sha draws an advisory

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `skills/ultrapowers/scripts/compile_plan.py`
- Modify: `skills/ultrawrite/SKILL.md`
- Test: `tests/test_compile_plan_base_sha_in_suite.py`

**Claim:** A Test: sim carrying a 40-hex sha or ULTRA_BASE draws an advisory. (derived)
Machine: M1. Under `--check --renders`, for each claims-v1 task and each of its `Test:` paths
that is a tracked file of the checkout at `--base`, in task order then `Test:` order, the render
base-sha-in-suite prints one line `ADVISORY proof-species: base-sha-in-suite — task <id>:
<path> reads ULTRA_BASE at line <L> — a BASE comparison is a Run:, never a committed exam`
when the file contains the whole-word token ULTRA_BASE, `<L>` its first line, 1-based.
M2. For the same files, the render prints one line `ADVISORY proof-species: base-sha-in-suite
— task <id>: <path> freezes commit <sha> at line <L> — a BASE comparison is a Run:, never a
committed exam` for each distinct 40-hex literal in the file that resolves as a commit of that
checkout (git cat-file -e on the sha with a commit peel), in first-occurrence order, the sha
line before the token line when both occur in one file.
M3. The render is silent for: a 40-hex literal that names no commit of the checkout; a 39- or
41-hex run; the token or a resolving sha in a `Modify:` file, in a `Run:` command or in a
Global Constraints `Check:`; a `Test:` path that is not a tracked file; a legacy-grammar plan;
and `--check` without `--renders`.
M4. The render changes no exit code: a plan drawing both lines still prints `PLAN OK` first and
exits 0.
M5. `skills/ultrawrite/SKILL.md` names base-sha-in-suite in the §The proof gate species list
and its **Proof** slot bullet carries, in this order, the phrases `never reads ULTRA_BASE`,
`freezes a commit sha` and `BASE comparison is a` followed by the `Run:` marker — the sentence
that a committed exam never reads the token or freezes a commit sha of the repository, and a
BASE comparison is a `Run:`.

**Authorized-by:** #730 (its 2026-09-07 comment: the run-35 species, "a BASE comparison or a
commit sha inside the committed suite"); map #727 move B3 (a reader rejection whose predicate is
decidable becomes a `--check` advisory).

**Interfaces:**
- Consumes: nothing
- Produces: `_render_base_sha_in_suite(tasks, ctx) -> list[str]`

**Context:** Run-35 (2026-09-07): the implementer wrote `process.env.ULTRA_BASE || '00fb224…'`
into a committed sim to implement two `Run:`-assigned BASE comparisons as test legs; the peer
reviewer blocked it twice and the fix cap parked the run. This render names that shape before a
reader is dispatched — an advisory, never a refusal, because the frozen pre-edit literal the
skill teaches (`SKILL.md` lines 110–115, blob cde4367: a `git hash-object` sha or a full 40-hex
sha fetched with `--depth=1`) is the same 40-hex shape used lawfully, and the reader decides.
The render is a new block in `compile_plan.py` (blob e86ad06) between the `sha-unguarded`
registration at line 3610 and `def main` at line 3613, registered with its own
`ADVISORY_RENDERS.append(("base-sha-in-suite", _render_base_sha_in_suite))` — not an entry in
`PROOF_SPECIES` or `PROOF_FILES_SPECIES` (line 3472), which are Task 2's region and read the
task's text, not the tree. Shape to follow: `_render_sha_unguarded` (line 3591) — `ctx["base"]`
is the checkout, `ctx["tracked"]` the tracked-path set, a task's `Test:` paths are `t["reads"]`,
and `_species_line("base-sha-in-suite", t["id"], detail)` (line 3205) builds the line, so the
`ADVISORY proof-species: <species> — task <id>: <detail>` prefix is the one every species
prints. `render_advisories` (line 2569) wraps each render in try/except and skips every render
outside a checkout, and `_git(base, "cat-file", "-e", sha + "^{commit}")` (line 2507) returns
`""` on a miss, so a fixture sha such as forty `a`s is silent. Tokens: the env-var name is
matched as a whole word (`\bULTRA_BASE\b`), so `$ULTRA_BASE` and `process.env.ULTRA_BASE` both
count and `ULTRA_BASELINE` does not; a 40-hex literal is
`(?<![0-9a-fA-F])[0-9a-f]{40}(?![0-9a-fA-F])`. At BASE five suites already carry a commit sha
of this repository — `fleet/tests/test_run_engine_integrated_runs.mjs`,
`fleet/tests/test_run_engine_proof_runs.mjs`, `fleet/tests/test_run_engine_review_economy.mjs`,
`tests/test_compile_plan_proof_runs.py` and `tests/test_compile_plan_sha_unguarded.py` (the
frozen `0a3559a…` pre-edit literal), and two read the token
(`fleet/tests/test_run_engine_pre_review.mjs`, `fleet/tests/test_run_engine_proof_runs.mjs`) — a
plan naming one of them under `Test:` draws the line, which is the advisory doing its job; none
of them is touched here. The exam therefore builds its own temporary checkout (the `_repo`
shape of `tests/test_compile_plan_pinned_elsewhere.py:191`: `git init`, commit the probe
files, and read `git rev-parse HEAD` for the sha it freezes into a second probe file), and it
spells the token it plants as `"ULTRA_" + "BASE"` in its own source so the exam file, once
tracked, draws no line on itself. The pin `tests/test_compile_plan_proof_tests.py` keeps only
`PLAN OK` and `ADVISORY grammar:` lines of the claims fixture's `--check --renders` stdout
(#563), so a new species line there is not a pin break; `tests/test_compile_plan_proof_species.py`'s
five-line fixture names no tracked `Test:` file carrying either token, so it stays five lines.
In `SKILL.md`, the species list is lines 232–238 (`… `threshold-one-sided`,
`disjunct-without-leg`. Read each one …`) and the **Proof** slot bullet is lines 90–115; Task 1
edits lines 20–24 and 366 of the same file — different paragraphs, text folds.

**Proof:**
- Test: `tests/test_compile_plan_base_sha_in_suite.py`
- Run: `bash -c 'sed -n "/^The .ADVISORY proof-species:. lines/,/^$/p" skills/ultrawrite/SKILL.md | tr "\n" " " | grep -q "base-sha-in-suite"'`
- Run: `bash -c 'sed -n "/^- \*\*Proof:\*\*/,/^- \*\*Stale-if:\*\*/p" skills/ultrawrite/SKILL.md | tr "\n" " " | grep -q "never reads ULTRA_BASE.*freezes a commit sha.*BASE comparison is a .*Run:"'`
- Legs: (a) in a temporary checkout whose tracked probe under `tests/` carries the word
  ULTRA_BASELINE at its line 1, reads the token at its line 2 and again at its line 4 (the
  token built by concatenation in the exam's own source), a signed claims-v1 plan naming that
  probe under task 1's `Test:` and again under task 2's prints, under `--check --renders --base
  <that checkout>`, exactly two base-sha-in-suite lines, task 1's then task 2's, each equal to
  the verbatim `… reads ULTRA_BASE at line 2 — …` string with the path interpolated — a render
  that matches the token as a substring reports line 1, one that reports the last occurrence
  reports line 4, one that prints per occurrence prints four lines, and one that omits the line
  number or prints once per plan fails too [M1];
  (b) with a second tracked probe reading the token at its line 5 and task 1's `Test:` naming
  the second probe before the first, the two task-1 lines come in `Test:` order — the line-5
  probe first — and each carries its own line number, so a render that sorts by path or reports
  the first token line for both fails [M1]; (c) in the same checkout with its HEAD sha frozen
  into a tracked probe at its line 3, a plan naming only that probe under task 1's `Test:`
  prints exactly one line equal to the verbatim `<probe> freezes commit <that sha> at line 3 —
  …` string with the sha interpolated — a render that prints an abbreviated sha, or no line
  number, fails [M2]; (d) with that probe also carrying a second commit's full sha (a second
  commit made in the checkout) at its line 6, and the first sha repeated at its line 8, the
  probe draws exactly two sha lines — line 3's sha then line 6's, the repeat at line 8 drawing
  no third — so a render that prints per occurrence, or sorts shas, fails [M2]; (e) a probe
  carrying the checkout's sha at its line 1 and the token at its line 2 draws its sha line
  before its token line — a render that prints the token line first, or one line per file
  instead of one per finding, fails [M2]; (f) one silent row each, asserted as an empty
  base-sha-in-suite line list under `--renders`: a tracked test file carrying forty `a`s; one
  carrying the checkout's sha with one hex digit removed and one with a hex digit appended; the
  checkout's own sha and the token together in a file named only under `Modify:`; the sha inside a `Run:` command and
  `$ULTRA_BASE` inside a `- Check:` bullet with no `Test:` file carrying either; a `Test:` path
  that exists on disk but is untracked, and one that does not exist; the legacy-grammar plan
  over the same probe files; and the sha-before-token plan under bare `--check`, whose stdout has no line
  containing base-sha-in-suite [M3]; (g) the sha-before-token plan's bare `--check` and its `--renders`
  run both exit 0 with `PLAN OK` as the first stdout line — a render that raises, or that
  prints before the verdict, fails one of the two [M4]; (h) the first `Run:` exits 0 only when
  the species-list paragraph of `skills/ultrawrite/SKILL.md` names base-sha-in-suite, the second
  only when that file's Proof slot text carries `never reads ULTRA_BASE`, then `freezes a commit
  sha`, then `BASE comparison is a` and a `Run:` marker after it, in that order — a slot that
  says the token may be read in a Run:, or that drops the sha half, fails it, and a skill left at
  BASE fails both [M5].

**Stale-if:**
- path-absent: `tests/test_compile_plan_sha_unguarded.py`
- path-absent: `fleet/tests/test_run_engine_proof_runs.mjs`
- issue-closed: #730
