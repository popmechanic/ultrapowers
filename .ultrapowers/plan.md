# The five rules the trio paid for are written where authors and examiners read them

**Grammar:** claims-v1

**Claim:** The five rules the trio paid for are written where authors and examiners read them. (elicited)
**Summary:** This writes down five lessons from last night's three TinyApp runs in the places plan authors and exam writers actually read. Each rule cost a run a lost fold, a hollow exam or a rewritten snapshot set, and none is written anywhere yet. After this run the next TinyApp plan starts with those traps named, so nobody pays for them twice.

**Goal:** #1038: one rule row into `skills/ultrawrite/references/authoring-gotchas.md` (a `Run:` grep inside a guarded exam pins another file's wording, and wording folds), one paragraph into `fleet/roles/examiner.md` (the action form a Proof leg names is not the examiner's to change), and three rows into `skills/ultrawrite/references/greenfield-stack.md` §State exams (no schema defaults on a cell a plan adds; a plan that adds a callback, an invariant or a snapshot owns the linter's four test files; a date field is a text input) — each row carrying its reason and its run, with the two role/reference files' word counts reported on a `- Run:` and gated by nothing.
**Closes:** #1038

**Tech Stack:** Markdown prose under `skills/` and `fleet/roles/`; the role file is read at dispatch by `fleet/run-engine.mjs` as a data file, and no sim pins its wording or its word count. Suite: `python3 -m pytest`.

**Spec:** #1038 (the five rows, each with its reason and its run); #836's 2026-09-16 comment (the reviewer, not the mutant, caught run-15's hollow exam); #1019's 2026-09-15 comment (run-12's publish fold and the lost `toContain` line); #867 (the trio).

**Parallelization rationale:** one wave, width 3. Each task owns exactly one file and consumes nothing a sibling produces; the rows are independent prose and no task needs another's runtime behaviour. No chain.

## Global Constraints

- Check: git diff --quiet $ULTRA_BASE -- fleet/run-engine.mjs fleet/roles/reviewer.md fleet/roles/implementer.md fleet/roles/fix.md fleet/roles/resolver.md fleet/roles/reconcile.md skills/ultrapowers skills/ultrawrite/SKILL.md fleet/tests
- Scope is the five rows of #1038 and nothing else: the reviewer engine switch and #836's sentence deletions are a later plan, so `fleet/run-engine.mjs` and `fleet/roles/reviewer.md` are byte-identical to BASE.
- Every row is written in the register of the file it lands in — a rule sentence, its reason, and the run or comment that paid for it — and the role file keeps its one stylistic pin: no shouted imperatives (`MUST`, `NEVER`, `ALWAYS`, `DO NOT` in capitals), which it carries none of at BASE.
- The word counts of `fleet/roles/examiner.md` and `skills/ultrawrite/references/greenfield-stack.md` are reported on a task's `- Run:` (`wc -w`) and gate nothing.
- Row 2's wording never claims the mutant caught run-15's hollow exam: #836's 2026-09-16 comment reads that the mutant passed it (`mutant_killed: true`, the store move was real) and the reviewer caught it reading the exam against the Claim and the implementer's declared amendment.

### Task 1: The gotchas file gains the guarded-exam wording-pin row

**Type:** implementation
**Review:** lean

**Files:**
- Modify: `skills/ultrawrite/references/authoring-gotchas.md`

**Claim:** When I open the authoring gotchas before dispatching gate readers, the rule that a grep inside a guarded exam pins another file's wording — and that wording folds — is there as a row with its reason and its run, beside the twelve it joins. (derived)
Machine: M1. Between the heading line matching `^## The .* rows$` and the heading `## Three older lessons of the same kind`, `skills/ultrawrite/references/authoring-gotchas.md` carries one more `- **…**` row whose bold rule sentence contains, in order, `guarded exam pins another file`, `wording` and `wording folds`; whose reason names, in order, `run-13`, `set-filter.test.ts`, `leg (g)`, `lint-cli.test.ts`, `toContain`, `run-12`, `publish fold` and `#1019`; and whose remedy says, in order, `imports and calls`, `Run:` (backticked in the file) `line of the plan` and `never in the merged exam`.
M2. The heading that read `## The twelve rows` at BASE reads `## The thirteen rows`, and that heading line is the only line of the file removed relative to BASE — `git diff --numstat $ULTRA_BASE -- skills/ultrawrite/references/authoring-gotchas.md` reports exactly `1` deleted line — so every existing row and the three older lessons read exactly as they did.

**Authorized-by:** #1038 row 1; #1019's 2026-09-15 comment (run-12's publish fold: "a plan pinning another test file's wording, an authoring species (a `Run:` grep inside a guarded exam is a pin on text that folds)").

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** The row, verbatim from #1038, to be written in the file's own shape (a `- **Rule sentence.** Reason, with the run and date in parentheses` bullet, wrapped at the file's ~80-column width, backticks around code literals as the neighbouring rows use them): *A `Run:` grep inside a guarded exam pins another file's wording, and wording folds.* Run-13's `set-filter.test.ts` leg (g) grepped `lint-cli.test.ts` for the literal `toContain('setFilter')`; run-12's publish fold merged that file semantically and the literal was gone (#1019 comment, 2026-09-15). A guarded exam asserts behaviour through imports and calls; a text pin on a sibling file belongs in a `Run:` line of the plan, never in the merged exam. The runs are on popmechanic/tinyapp-fixture (the #867 trio, 2026-09-15/16). At BASE the file is 130 lines, 1451 words; its rule list is the `## The twelve rows` heading at line 16 followed by twelve `- **` rows (lines 18–114, the last one `**Expect and budget for rejection rounds …**` ending at line 114 with `(run-45, 2026-09-01).`), then `## Three older lessons of the same kind` at line 116. The new row goes last under that heading — after the `Expect and budget` row and before the `## Three older lessons` heading, separated by one blank line as the other rows are — and the heading becomes `## The thirteen rows`; the file's intro (lines 1–14) mentions no count and is untouched. The rows' reasons in this file end with the run and date in parentheses, e.g. `(run-74, 2026-09-04)`; this one closes `(run-13 and run-12, popmechanic/tinyapp-fixture, 2026-09-15; #1019)` or an equivalent that names run-13, run-12 and #1019. No sim, test or script reads this file's text (`grep -rn authoring-gotchas tests/ fleet/tests/ skills/ultrapowers/scripts/` finds nothing at BASE), so the only proof is the `Run:` lines below; every `Run:` here carries no backtick, and a `.` in a pattern stands for the backtick the file will hold.

**Proof:**
- Legs: (a) the first `Run:` below joins the rows section into one line and greps the rule sentence's three operative phrases in order — a file without the row, or with the sentence reworded away from `guarded exam` / `wording folds`, exits 1 [M1]; (b) the second `Run:` greps that section for the reason's eight anchors in order — run-13, the exam file, the leg, the sibling file, the literal's method name, run-12, the fold and the issue — so a row that names the lesson without its run fails [M1]; (c) the third `Run:` greps that section for the remedy's three halves in order, the `.` after `Run:` standing for the file's backtick [M1]; (d) the fourth `Run:` requires the heading `## The thirteen rows` to be present and `## The twelve rows` absent [M2]; (e) the fifth `Run:` reads `git diff --numstat` against `$ULTRA_BASE` for this one file and requires the deleted-line count to be exactly `1` — a rewritten or dropped existing row fails it [M2].
- Run: sed -n '/^## The .* rows$/,/^## Three older lessons/p' skills/ultrawrite/references/authoring-gotchas.md | tr '\n' ' ' | grep -q 'guarded exam pins another file.*wording.*wording folds'
- Run: sed -n '/^## The .* rows$/,/^## Three older lessons/p' skills/ultrawrite/references/authoring-gotchas.md | tr '\n' ' ' | grep -q 'run-13.*set-filter.test.ts.*leg (g).*lint-cli.test.ts.*toContain.*run-12.*publish fold.*#1019'
- Run: sed -n '/^## The .* rows$/,/^## Three older lessons/p' skills/ultrawrite/references/authoring-gotchas.md | tr '\n' ' ' | grep -q 'imports and calls.*Run:. line of the plan.*never in the merged exam'
- Run: grep -q '^## The thirteen rows$' skills/ultrawrite/references/authoring-gotchas.md && grep -c '^## The twelve rows' skills/ultrawrite/references/authoring-gotchas.md | grep -qx 0
- Run: git diff --numstat $ULTRA_BASE -- skills/ultrawrite/references/authoring-gotchas.md | awk '{d=$2} END{exit (d==1)?0:1}'

**Stale-if:**
- path-absent: `skills/ultrawrite/references/authoring-gotchas.md`
- issue-closed: #1038

### Task 2: The examiner role says a leg's action form is not its to change

**Type:** implementation
**Review:** lean

**Files:**
- Modify: `fleet/roles/examiner.md`

**Claim:** When an examiner reads its role before writing an exam, it is told that the action form a Proof leg names — a click, a typed key, a store call — is not its to change, and why: the one hollow exam of the trio was a click swapped for a store call, which the mutant passed and the reviewer blocked. (derived)
Machine: M1. Between the paragraph beginning `The exam is the implementer's grading` and the line beginning `Return a single JSON object`, `fleet/roles/examiner.md` carries a paragraph whose rule says, in order, `action form`, `not the examiner's to change` (the apostrophe as the file writes it), and whose remedy says, in order, `red exam that says so`, `unsatisfiable` and `never a quiet substitution`.
M2. That paragraph's reason names, in order, `run-15`, `click`, `deleteTodo`, `mutant passed`, `reviewer` and `#836`, and the file nowhere says the mutant caught, killed or blocked that exam — `grep -cE 'mutant (caught|killed|blocked)'` over the file is `0`.
M3. The file carries no shouted imperative — `grep -cE '\b(MUST|NEVER|ALWAYS|DO NOT)\b'` over it is `0`, as at BASE — and `git diff --numstat $ULTRA_BASE -- fleet/roles/examiner.md` reports `0` deleted lines, so every sentence the examiner read at BASE it still reads; `wc -w fleet/roles/examiner.md` is reported (792 at BASE) and gates nothing.

**Authorized-by:** #1038 row 2; #836's 2026-09-16 comment (run-15 task 1: "the examiner swapped the Claim's click on Delete for a direct store call … passed by the mutant … caught by the reviewer reading the exam against the Claim and the implementer's declared amendment").

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** The row, verbatim from #1038, to be written as one paragraph in the role file's own register — second person, plain sentences, no capitalised imperatives: *The action form a Proof leg names is not the examiner's to change.* Run-15's examiner replaced `{click: '.todoItem button'}` with `deleteTodo(store, '0')` because the click could not land; the mutant passed it and the reviewer blocked it (#836 comment). An action the page cannot perform is a red exam that says so, or a declared amendment — never a quiet substitution that leaves M1 unproven. The run is run-15 on popmechanic/tinyapp-fixture (the #867 trio, 2026-09-16). The reading behind it, from #836's 2026-09-16 comment and binding on the wording: the mutant *passed* that exam (`mutant_killed: true` — the store move was real, so the mutant's cell flip broke it), and it was the *reviewer*, reading the exam against the Claim and the implementer's declared amendment, that caught and blocked it; the paragraph therefore says the mutant passed it and the reviewer blocked it, and never that the mutant caught it. "Declared" in this file means the examiner's own channels, which the file already names: an `unsatisfiable: [{leg, why}]` entry for the leg (and a kata comment on `$KATA_REF` when it is set), or the implementer's declared amendment on the record — so write the remedy as: an action the page cannot perform is a red exam that says so, or an `unsatisfiable` entry naming the leg, or a declared amendment on the record, never a quiet substitution of another action that leaves the clause unproven. At BASE the file is 90 lines, 792 words; the paragraph `The exam is the implementer's grading, not the implementer's to reshape: …` is lines 39–42, the `A leg you cannot encode as written …` line is 44 and `Return a single JSON object …` is 46, with `## The issue` at 48. The new paragraph goes directly after the `The exam is the implementer's grading` paragraph (after line 42, before the `A leg you cannot encode` line), separated by blank lines as the neighbours are, so it is an insert and no BASE line is removed. `fleet/run-engine.mjs` reads this file at dispatch as data and no sim pins its wording or word count (`grep -rn examiner.md fleet/tests tests` finds nothing at BASE; `fleet/tests/test_worker_kata_env.mjs` names `examiner` only as a role id), so the only proof is the `Run:` lines below; every `Run:` carries no backtick, and a `.` in a pattern stands for the apostrophe or backtick the file will hold.

**Proof:**
- Legs: (a) the first `Run:` scopes the file from the `The exam is the implementer` paragraph to the `Return a single JSON` line, joins it into one line and greps the rule's two operative phrases in order — a file without the paragraph, or one placed outside that span, exits 1 [M1]; (b) the second `Run:` greps that span for the remedy's three halves in order — `red exam that says so`, `unsatisfiable`, `never a quiet substitution` [M1]; (c) the third `Run:` greps that span for the reason's six anchors in order — run-15, the click, the store call's name, `mutant passed`, `reviewer`, `#836` — so a paragraph without its run fails [M2]; (d) the fourth `Run:` counts `mutant (caught|killed|blocked)` over the whole file and requires `0`, the wording #836's comment forbids [M2]; (e) the fifth `Run:` counts capitalised `MUST`, `NEVER`, `ALWAYS`, `DO NOT` over the file and requires `0` [M3]; (f) the sixth `Run:` requires `git diff --numstat` against `$ULTRA_BASE` to report `0` deleted lines for the file [M3]; (g) the seventh `Run:` prints `wc -w` of the file — reported, never gated [M3].
- Run: sed -n '/^The exam is the implementer/,/^Return a single JSON/p' fleet/roles/examiner.md | tr '\n' ' ' | grep -q 'action form.*not the examiner.s to change'
- Run: sed -n '/^The exam is the implementer/,/^Return a single JSON/p' fleet/roles/examiner.md | tr '\n' ' ' | grep -q 'red exam that says so.*unsatisfiable.*never a quiet substitution'
- Run: sed -n '/^The exam is the implementer/,/^Return a single JSON/p' fleet/roles/examiner.md | tr '\n' ' ' | grep -q 'run-15.*click.*deleteTodo.*mutant passed.*reviewer.*#836'
- Run: grep -cE 'mutant (caught|killed|blocked)' fleet/roles/examiner.md | grep -qx 0
- Run: grep -cE '\b(MUST|NEVER|ALWAYS|DO NOT)\b' fleet/roles/examiner.md | grep -qx 0
- Run: git diff --numstat $ULTRA_BASE -- fleet/roles/examiner.md | awk '{d=$2} END{exit (d==0)?0:1}'
- Run: wc -w fleet/roles/examiner.md

**Stale-if:**
- path-absent: `fleet/roles/examiner.md`
- issue-closed: #1038

### Task 3: The greenfield stack's State exams section gains the three TinyApp rows

**Type:** implementation
**Review:** lean

**Files:**
- Modify: `skills/ultrawrite/references/greenfield-stack.md`

**Claim:** When I author the next TinyApp plan and read the State exams section, the three traps the trio paid for are named there — a cell a plan adds carries no schema default, a plan that adds a callback, an invariant or a snapshot owns the linter's four test files, and a date field is a text input — each with its reason and its run. (derived)
Machine: M1. Between `## State exams` and `## The engine boundary`, `skills/ultrawrite/references/greenfield-stack.md` carries a row saying, in order, `No schema default`, `default`, `materialised`, `getContent()`, `seed`, `expected`, `5–7 files, 13–20 pins`, `three plans`, `no default`, `absent on old rows`, `byte-identical` and `#867` — the trio whose three plans measured it.
M2. The same section carries a row saying, in order, `callback`, `invariant`, `snapshot`, `owns`, the four linter test-file names `lint-cli`, `invariants`, `reachability` and `views` in that order, `containment`, `tree-computed counts`, `never to a new exact literal`, `sibling plan`, `concurrently`, `both folds`, `run-12` and `#1019` — the fold that paid for it and the comment that recorded it.
M3. The same section carries a row saying, in order, `date field is a text input`, `type`, `CDP`, `Input.insertText`, `<input type="date">` and `run-12`.
M4. `git diff --numstat $ULTRA_BASE -- skills/ultrawrite/references/greenfield-stack.md` reports `0` deleted lines, so every sentence the section held at BASE it still holds and the sections outside it are untouched; `wc -w skills/ultrawrite/references/greenfield-stack.md` is reported (1482 at BASE) and gates nothing.

**Authorized-by:** #1038 rows 3–5; #867 (the trio: runs 12, 13 and 15 on popmechanic/tinyapp-fixture, 2026-09-15/16); #1019's 2026-09-15 comment (all four fold conflicts were the linter's own test files, which both plans had loosened differently).

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** The three rows, verbatim from #1038, to be written into `## State exams` in the section's own register (prose paragraphs, the measured reason beside the rule, code literals in backticks, wrapped at the file's ~80-column width): row 3 — *No schema defaults on a cell or value a plan adds.* A `default` is materialised into every existing row's `getContent()`, rewriting every seed and expected file (measured: 5–7 files, 13–20 pins across three plans); a cell with no default is absent on old rows and every BASE snapshot round-trips byte-identical. Row 4 — *A plan that adds a callback, an invariant or a snapshot owns the linter's four test files.* `packages/tinyapp-lint/test/{lint-cli,invariants,reachability,views}.test.ts` pin exact counts and lists; loosen them to containment and tree-computed counts, never to a new exact literal, because a sibling plan changes them concurrently (both folds of the night were these four files). Row 5 — *A date field is a text input.* The exam's `type` is CDP `Input.insertText`, which does not reach `<input type="date">` (run-12's authoring, measured). Each row closes with its run in parentheses as the section's `run-7 parked` sentence does: row 3 with `(measured across the three plans of the #867 trio, popmechanic/tinyapp-fixture, 2026-09-15)`, row 4 with `(both folds of 2026-09-15 — run-12's publish fold onto run-13's merge, #1019 comment)`, row 5 with `(run-12's authoring, measured)` as the issue has it. The runs behind them are the #867 trio on popmechanic/tinyapp-fixture, 2026-09-15/16: run-12 (due dates), run-13 (filter bar) and run-15 (undo delete); the three plans' measurements were taken at that fixture's `f24d4059` with tinybase 9.7.0; #1019's 2026-09-15 comment records run-12's publish fold as `pathsConflicted 4`, all four the linter's test files. At BASE the file is 211 lines, 1482 words; `## State exams` is line 74 and `## The engine boundary` line 200, so the section is lines 74–199 and ends with the two-line paragraph beginning `A target that exposes` and ending `before the gate readers.` (lines 197–198) followed by a blank line. The three rows go at the end of that section, after that `lint:state` paragraph and before `## The engine boundary`, as three short paragraphs (each opening with its rule sentence in bold or italics as the author of the file chooses) so the change is an insert and no BASE line is removed; the `Two rules here are measured, not guessed.` paragraph at lines 185–191 is the register to match and stays as it is. The en dashes in `5–7 files, 13–20 pins` are the issue's and the `Run:` below matches them with `.`; write `<input type="date">` inside backticks as the file does for tags. No sim, test or script reads this file's text (`grep -rn greenfield-stack tests/ fleet/tests/ skills/ultrapowers/scripts/` finds nothing at BASE), so the only proof is the `Run:` lines below; every `Run:` carries no backtick.

**Proof:**
- Legs: (a) the first `Run:` scopes the file to the State exams section, joins it into one line and greps row 3's twelve anchors in order — the rule, the mechanism, the two snapshot kinds, the measured figures, the three plans, the no-default consequence and `#867` as its run — so a section without the row, with its measurement dropped or with no run named exits 1 [M1]; (b) the second `Run:` greps that section for row 4's anchors in order — the three additions, `owns`, the four test-file names in order, the two loosenings, the forbidden new literal, the concurrent-sibling reason with `both folds`, and `run-12` and `#1019` as its run and its record — a row without its run fails [M2]; (c) the third `Run:` greps that section for row 5's anchors in order — the rule, `type`, `CDP`, `Input.insertText`, the date input tag and `run-12` [M3]; (d) the fourth `Run:` requires `git diff --numstat` against `$ULTRA_BASE` to report `0` deleted lines for the file [M4]; (e) the fifth `Run:` prints `wc -w` of the file — reported, never gated [M4].
- Run: sed -n '/^## State exams/,/^## The engine boundary/p' skills/ultrawrite/references/greenfield-stack.md | tr '\n' ' ' | grep -q 'No schema default.*default.*materialised.*getContent().*seed.*expected.*5.7 files, 13.20 pins.*three plans.*no default.*absent on old rows.*byte-identical.*#867'
- Run: sed -n '/^## State exams/,/^## The engine boundary/p' skills/ultrawrite/references/greenfield-stack.md | tr '\n' ' ' | grep -q 'callback.*invariant.*snapshot.*owns.*lint-cli.*invariants.*reachability.*views.*containment.*tree-computed counts.*never to a new exact literal.*sibling plan.*concurrently.*both folds.*run-12.*#1019'
- Run: sed -n '/^## State exams/,/^## The engine boundary/p' skills/ultrawrite/references/greenfield-stack.md | tr '\n' ' ' | grep -q 'date field is a text input.*type.*CDP.*Input.insertText.*input type=.date.*run-12'
- Run: git diff --numstat $ULTRA_BASE -- skills/ultrawrite/references/greenfield-stack.md | awk '{d=$2} END{exit (d==0)?0:1}'
- Run: wc -w skills/ultrawrite/references/greenfield-stack.md

**Stale-if:**
- path-absent: `skills/ultrawrite/references/greenfield-stack.md`
- issue-closed: #1038
