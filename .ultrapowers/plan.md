# Doctrines into the skills

**Grammar:** claims-v1

**Claim:** After this run, ultrawrite tells an author how a sitting's queue is drained — one
author per disjoint-file bundle, the issue's sentence as the Claim, a `**Closes:**` line for the
tickets and `$ULTRA_BASE` for a Check that compares against BASE — the ultrapowers client says
the launcher reaps and nothing schedules the janitor, and CLAUDE.md and the README point at the
skills instead of restating them. (elicited)

**Goal:** #670 as decided on 2026-09-05: the two doctrines #669 parked in `CLAUDE.md` move into
the skills that act on them — the parallel-authoring procedure into `skills/ultrawrite/SKILL.md`
as a `## Authoring a queue` section, the reap-at-launch / no-scheduler rule into
`skills/ultrapowers/SKILL.md` §Client step 5 — and `CLAUDE.md` keeps one line each pointing at
the skill; its "§Trim review" pointer becomes "§The spec review" (the ultralearn reference's
heading since the 2026-09-05 prose plan) and `README.md` §4. Build no longer tells the reader
to merge or close a pull request that merges itself (#660). Two authoring sentences ride along,
each the skill half of a decision whose mechanism another bundle builds: #679's `**Closes:**`
line (ultrawrite writes it directly under `**Goal:**`; the sandbox's PR body reads exactly that
line) and #632's `$ULTRA_BASE` (a `Check:`/`Run:` that compares against BASE writes it; the
driver sets it to the run's base sha). A prose plan: every proof is a `Run:` command, never a
sentence matched against itself. Nothing under `fleet/`, nothing in `first-run.md`,
`tests/test_docs_agree_with_code.py` or `skills/ultradocket/SKILL.md` is touched.
**Closes:** #670

**Tech Stack:** Markdown (`skills/ultrawrite/SKILL.md`, `skills/ultrapowers/SKILL.md`,
`CLAUDE.md`, `README.md`, each skill validated by
`skills/ultrapowers/scripts/validate_skill.py`), Python 3 (`python3 -m pytest` for the tests
that read the four documents). Nothing is added to any dependency file.

**Spec:** #670 (both halves, plus its two comments), #679 (the 2026-09-05 decision comment:
the `**Closes:**` line's literal format), #632 (part (2): `$ULTRA_BASE`). The issues carry the
design; there is no separate spec document.

**Parallelization rationale:** One wave, width 6. Tasks 1, 2 and 3 modify
`skills/ultrawrite/SKILL.md` in three different sections (a new section between §Elicit the
claim and §The proof gate; §The document plus one §Self-review bullet; §Global Constraints
discipline) — same-file text that folds at merge, no adjacent inserts at one location, since
only Task 2 touches §Self-review. Tasks 4, 5 and 6 each own one other file. No task consumes a
sibling's symbol, so no edge is derived and no task waits. No task creates a test file: every
deliverable is prose and proves itself with `Run:` commands.

## Global Constraints

- The sibling bundles' files are byte-identical to BASE — the fleet, the first-run walk, the
  docs-agree-with-code test, the compiler, the session hook and the ultradocket skill are theirs.
- Check: test "$(git hash-object fleet/run-engine.mjs)" = ab943eac2ddd6433ee01be94bda59b9725b84db8
- Check: test "$(git hash-object fleet/sandbox-boot.sh)" = 7cf62ab22f21a5664e26f9ba0c0130f4c05da01f
- Check: test "$(git hash-object fleet/launch.mjs)" = a2bcd0491f5af05f77606c747c8f4f6bc3659138
- Check: test "$(git hash-object fleet/janitor.mjs)" = 236dc2f0c4748f39326b8ba34cfc57d3ac477bf9
- Check: test "$(git hash-object hooks/session_start.sh)" = a70c87d7b8bdfd853954c4786645432ddd977097
- Check: test "$(git hash-object skills/ultrapowers/references/first-run.md)" = 61ea591f04d8465eae74eae93246bd4ef384c673
- Check: test "$(git hash-object skills/ultrapowers/scripts/compile_plan.py)" = b546e04f843c07ea52e7a1e95e62b6f00836afec
- Check: test "$(git hash-object tests/test_docs_agree_with_code.py)" = c9687c77eca8374f6caf78b5deb587f24244fe9a
- Check: test "$(git hash-object skills/ultradocket/SKILL.md)" = f46f0c7cc2db4e4978c7461005c2dde949672794
- Check: test "$(git hash-object skills/ultralearn/references/distilling-proposals.md)" = 14805df36848d5f776e64bc55cb4712b6b0982b1
- Both skills still validate.
- Check: python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrawrite
- Check: python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers
- No shouted imperative (an all-caps must, never or always as a whole word) is added to either
  skill: both stay at BASE's zero of each.
- Check: ! grep -qw 'MUST' skills/ultrawrite/SKILL.md skills/ultrapowers/SKILL.md
- Check: ! grep -qw 'NEVER' skills/ultrawrite/SKILL.md skills/ultrapowers/SKILL.md
- Check: ! grep -qw 'ALWAYS' skills/ultrawrite/SKILL.md skills/ultrapowers/SKILL.md
- The execution-handoff rubric shared byte-for-byte between `hooks/session_start.sh` and
  `skills/ultrawrite/SKILL.md` §Execution handoff is untouched: the rubric's tokens and branch
  clauses stay in both legs in their canonical order (each ultrawrite task runs
  `tests/test_recommendation_rubric.py` as its own `Run:`).
- No file outside a task's own Files block is edited.

**Acceptance:** suite — the committed suite is the verification.

### Task 1: Ultrawrite says how a queue is authored

**Type:** implementation

**Files:**
- Modify: `skills/ultrawrite/SKILL.md`

**Claim:** After this run, ultrawrite tells an author how a sitting's queue is drained — one
author per disjoint-file bundle, the issue's sentence as the Claim, the operator's two touches
per plan, launches one after another. (derived)
Machine: M1. `skills/ultrawrite/SKILL.md` carries exactly one heading `## Authoring a queue`,
and it sits after the `## Elicit the claim` heading and before the `## The proof gate` heading.
M2. That section says the queue is partitioned by files into disjoint bundles and that one
author subagent authors each bundle's plan. M3. That section says the issue's desired-state
sentence is the plan's Claim, and that grilling happens only for a `wayfinder:grilling` ticket.
M4. That section says the operator's touches are one Claim confirmation and one execute choice
per plan. M5. That section says launches stay serial, citing #667. M6.
`validate_skill.py skills/ultrawrite` prints `skill ok`, and the tests that read the skill —
`tests/test_ultrawrite_skill.py`, `tests/test_ultrawrite_surface_rules_implementer_check.py`,
`tests/test_recommendation_rubric.py`, `tests/test_proof_modes_documented.py`,
`tests/test_plan_level_claim.py`, `tests/test_compile_plan_check_cost.py`,
`tests/test_compile_plan_integration_hostile.py` — pass.

**Authorized-by:** #670 ("Move them: (1) into `skills/ultrawrite/SKILL.md` as the procedure
for a queue (a §Authoring a queue: partition by files, one author per bundle, the operator's
touches, launches stay serial — #667)"); operator doctrine 2026-09-05 recorded in `CLAUDE.md`
§Doctrine ("Author plans concurrently from the issues").

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** One new `## ` section, nothing else moves. Insert `## Authoring a queue` between
`## Elicit the claim — never draft it for countersigning` (line ~143) and `## The proof gate —
before any compile` (line ~160): the elicitation section already says the issue path quotes the
operator's words as the Claim "confirmation, not authorship", and the queue procedure is that
path applied to many issues at once. What the section says, in the skill's register (an
imperative addressed to the authoring agent, no shouted words): a sitting's queue of
well-defined issues is partitioned by FILES into disjoint bundles — two plans that would
touch one file go in one bundle, since same-file edits fold inside one run and never across
two PRs; one author subagent per bundle, each loading this skill, quoting the issue's
desired-state sentence as the Claim, pinning BASE facts, dispatching its own fresh gate
readers per task and compiling to `PLAN OK`; grilling only for a ticket labelled
`wayfinder:grilling` — an undecided choice found mid-authoring comes back as a question,
never a guess; the operator's touches are one Claim confirmation and one execute choice per
plan, asked with AskUserQuestion; launches stay serial — N plans are N launches back to back,
because concurrent launches race on the run number (#667). The reason the section may carry
in one sentence: the 2026-09-05 clock census of runs 10–12 found authoring throughput, not
the sandbox, was the first bound on how many runs could be live at once. Do not touch
`## Self-review` (a sibling task adds its bullet there in the same wave), `## Execution
handoff` (shared byte-for-byte with `hooks/session_start.sh` and pinned by
`tests/test_recommendation_rubric.py`), or the `## The proof gate` section's species sentence.
The tests that read this file pin sentences elsewhere in it — the six `**Slot:**` names in
order, the species list, the §Global Constraints discipline sentence, the "Above the first
task:" paragraph's single `**Claim:**`, and whole-word counts of the three shouted imperatives
frozen at zero — so the new section adds text and changes none. The exam below reads the
section alone (`sed -n` from its heading to §The proof gate's heading, whitespace runs
squeezed to one space) and pins each sentence's operative words; the phrases inside the greps
are the contract, the wording around them is yours.
**BASE facts:** (generated at e04154b)
- `skills/ultrawrite/SKILL.md` blob 6a11e64
- `tests/test_ultrawrite_skill.py` blob 06edf94
- `tests/test_ultrawrite_surface_rules_implementer_check.py` blob 9ec778c
- `tests/test_recommendation_rubric.py` blob 4727ab6
- `tests/test_proof_modes_documented.py` blob 9359f16
- `tests/test_plan_level_claim.py` blob 994ffd2
- `tests/test_compile_plan_check_cost.py` blob ccaad8d
- `tests/test_compile_plan_integration_hostile.py` blob c490a06
- `CLAUDE.md` blob ff1281b

**Proof:**
- Run: test "$(grep -c '^## Authoring a queue' skills/ultrawrite/SKILL.md)" = 1
- The previous bullet is the heading, exactly once [M1].
- Run: awk '/^## Elicit the claim/{a=NR} /^## Authoring a queue/{b=NR} /^## The proof gate/{c=NR} END{exit !(a && b && c && a < b && b < c)}' skills/ultrawrite/SKILL.md
- The previous bullet is the heading's position — after §Elicit the claim's heading and before §The proof gate's — and fails when any of the three is missing or out of order [M1].
- Run: sed -n '/^## Authoring a queue/,/^## The proof gate/p' skills/ultrawrite/SKILL.md | tr -s '[:space:]' ' ' | grep -qi 'partition.*by files.*disjoint bundles'
- The previous bullet reads only the new section, whitespace runs squeezed to one space, and pins the partition rule — by files, into disjoint bundles [M2].
- Run: sed -n '/^## Authoring a queue/,/^## The proof gate/p' skills/ultrawrite/SKILL.md | tr -s '[:space:]' ' ' | grep -qi 'one author subagent per bundle'
- The previous bullet is one author subagent per bundle, in the section [M2].
- Run: sed -n '/^## Authoring a queue/,/^## The proof gate/p' skills/ultrawrite/SKILL.md | tr -s '[:space:]' ' ' | grep -qi 'desired-state sentence.*is the .*Claim'
- The previous bullet is the issue's desired-state sentence as the Claim, in the section [M3].
- Run: sed -n '/^## Authoring a queue/,/^## The proof gate/p' skills/ultrawrite/SKILL.md | tr -s '[:space:]' ' ' | grep -qi 'grill.*only.*wayfinder:grilling'
- The previous bullet is grilling only for a wayfinder:grilling ticket, in the section [M3].
- Run: sed -n '/^## Authoring a queue/,/^## The proof gate/p' skills/ultrawrite/SKILL.md | tr -s '[:space:]' ' ' | grep -qi 'one Claim confirmation and one execute choice per plan'
- The previous bullet is the operator's two touches per plan, in the section [M4].
- Run: sed -n '/^## Authoring a queue/,/^## The proof gate/p' skills/ultrawrite/SKILL.md | tr -s '[:space:]' ' ' | grep -qi 'launches stay serial.*#667'
- The previous bullet is launches stay serial with its ticket, in the section [M5].
- Run: python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrawrite
- The previous bullet is the skill validator [M6].
- Run: python3 -m pytest -q -p no:cacheprovider tests/test_ultrawrite_skill.py tests/test_ultrawrite_surface_rules_implementer_check.py tests/test_recommendation_rubric.py tests/test_proof_modes_documented.py tests/test_plan_level_claim.py tests/test_compile_plan_check_cost.py tests/test_compile_plan_integration_hostile.py
- The previous bullet is every test that reads the skill's sentences — slot order, the surface rules, the rubric shared with the hook, the shouted-word zeros, the header paragraph, the discipline sentence, the species list — green [M6].

**Stale-if:**
- path-absent: `skills/ultrawrite/SKILL.md`
- issue-closed: #670

### Task 2: Ultrawrite writes the Closes line

**Type:** implementation

**Files:**
- Modify: `skills/ultrawrite/SKILL.md`

**Claim:** After this run, ultrawrite tells an author to write the tickets a plan closes as one
`**Closes:**` line directly under `**Goal:**`, which the sandbox reads to close them. (derived)
Machine: M1. `## The document` in `skills/ultrawrite/SKILL.md` says a `**Closes:**` line sits
directly under `**Goal:**`, is one line, and carries the issue numbers as `#N`, space-separated,
of the target repository only. M2. The same section says the sandbox reads exactly that line
and appends one `Closes #N` per number to the pull request body, and that a plan without the
line closes nothing. M3. `## Self-review` carries a bullet saying the `**Closes:**` line, when
present, sits directly under `**Goal:**` and names only the target repository's issues. M4.
The paragraph beginning `Above the first task:` still contains exactly one `**Claim:**`, and
`validate_skill.py skills/ultrawrite` prints `skill ok`, with
`tests/test_ultrawrite_skill.py`, `tests/test_plan_level_claim.py`,
`tests/test_recommendation_rubric.py` and `tests/test_proof_modes_documented.py` passing.

**Authorized-by:** #679, decided 2026-09-05 ("a dedicated `**Closes:**` header line … ultrawrite
writes `**Closes:** #660 #668` directly under `**Goal:**` (one line, space-separated,
target-repo numbers only); the boot's `render_card` reads exactly that line from
`.ultrapowers/plan.md` and appends one `Closes #N` per number to the PR body; a plan without
the line closes nothing … the ultrawrite sentence in R5").

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** Two places, one short paragraph and one bullet. (1) `## The document` (lines
~18–31) lists the header in order — `**Grammar:**`, `**Claim:**`, `**Goal:**`,
`**Tech Stack:**`, the spec path, `## Global Constraints`, `**Acceptance:**` — and then
describes the optional `**Exam command:**` line. Add a paragraph after those describing the
optional `**Closes:**` line the same way: it sits directly under the `**Goal:**` paragraph (the
next line), it is one line, `**Closes:** #660 #668` — the numbers space-separated, each an
issue of the TARGET repository (a bare `#N` means the target to GitHub, so a foreign target's
plan names that repository's issues, never this plugin's); the sandbox reads exactly that
line from `.ultrapowers/plan.md` and appends one `Closes #N` per number to the pull request
body, so the run's merge closes them; a plan without the line closes nothing; and the line is
free prose to the compiler — nothing parses it, so a number scraped from `**Goal:**` is
never used (the Goal line cites decisions as well as tickets, which is why the decision
rejected scraping it). Do not add a second `**Claim:**` to the paragraph that begins
`Above the first task:` — `tests/test_plan_level_claim.py` counts exactly one there. (2)
`## Self-review` (line ~331 to the end of the file) gains one bullet, placed at the end of
the list, saying the `**Closes:**` line, when present, sits directly under `**Goal:**` and
names only the target repository's issues. A sibling task inserts a new `## ` section
between §Elicit the claim and §The proof gate and another edits §Global Constraints
discipline in the same wave — leave both regions alone; same-file text folds. Keep the
register (no shouted words). The exam reads §The document alone (`sed -n` from its heading
to `## Task shape`'s, whitespace runs squeezed to one space) and the §Self-review tail; the
dots in the greps stand for the backticks a `Run:` command may not carry.
**BASE facts:** (generated at e04154b)
- `skills/ultrawrite/SKILL.md` blob 6a11e64
- `tests/test_ultrawrite_skill.py` blob 06edf94
- `tests/test_plan_level_claim.py` blob 994ffd2
- `tests/test_recommendation_rubric.py` blob 4727ab6
- `tests/test_proof_modes_documented.py` blob 9359f16

**Proof:**
- Run: sed -n '/^## The document/,/^## Task shape/p' skills/ultrawrite/SKILL.md | tr -s '[:space:]' ' ' | grep -q 'Closes:.*directly under .\*\*Goal:\*\*.'
- The previous bullet reads only §The document, whitespace runs squeezed to one space, and pins the line's place — directly under the Goal line [M1].
- Run: sed -n '/^## The document/,/^## Task shape/p' skills/ultrawrite/SKILL.md | tr -s '[:space:]' ' ' | grep -q 'Closes:.*one line'
- The previous bullet is the one-line shape, in the section [M1].
- Run: sed -n '/^## The document/,/^## Task shape/p' skills/ultrawrite/SKILL.md | tr -s '[:space:]' ' ' | grep -qF -- 'Closes:** #660 #668'
- The previous bullet is the example line with two space-separated numbers, fixed-string, in the section [M1].
- Run: sed -n '/^## The document/,/^## Task shape/p' skills/ultrawrite/SKILL.md | tr -s '[:space:]' ' ' | grep -qi 'Closes:.*target repository'
- The previous bullet is the target-repository-only rule, in the section [M1].
- Run: sed -n '/^## The document/,/^## Task shape/p' skills/ultrawrite/SKILL.md | tr -s '[:space:]' ' ' | grep -q 'sandbox reads exactly that line'
- The previous bullet is the reader — the sandbox reads exactly that line — in the section [M2].
- Run: sed -n '/^## The document/,/^## Task shape/p' skills/ultrawrite/SKILL.md | tr -s '[:space:]' ' ' | grep -q 'one .Closes #N. per number'
- The previous bullet is the PR-body shape — one Closes #N per number — in the section [M2].
- Run: sed -n '/^## The document/,/^## Task shape/p' skills/ultrawrite/SKILL.md | tr -s '[:space:]' ' ' | grep -q 'without the line closes nothing'
- The previous bullet is the absent-line case, in the section [M2].
- Run: sed -n '/^## Self-review/,$p' skills/ultrawrite/SKILL.md | tr -s '[:space:]' ' ' | grep -q 'Closes:.*directly under .\*\*Goal:\*\*.*target repository'
- The previous bullet reads only §Self-review (its heading to the end of the file), whitespace runs squeezed to one space, and pins the new bullet's two parts in order [M3].
- Run: python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrawrite
- The previous bullet is the skill validator [M4].
- Run: python3 -m pytest -q -p no:cacheprovider tests/test_ultrawrite_skill.py tests/test_plan_level_claim.py tests/test_recommendation_rubric.py tests/test_proof_modes_documented.py
- The previous bullet is the header paragraph's single Claim count, the slot order, the rubric shared with the hook and the shouted-word zeros — green [M4].

**Stale-if:**
- path-absent: `skills/ultrawrite/SKILL.md`
- issue-closed: #679

### Task 3: Ultrawrite gives a Check the run's base sha

**Type:** implementation

**Files:**
- Modify: `skills/ultrawrite/SKILL.md`

**Claim:** After this run, ultrawrite tells an author that a `Check:` or `Run:` comparing
against BASE writes `$ULTRA_BASE`, which the driver sets to the run's base sha. (derived)
Machine: M1. `## Global Constraints discipline` in `skills/ultrawrite/SKILL.md` says that a
`Check:` or `Run:` command that compares against BASE writes `$ULTRA_BASE`, and that the
driver sets it to the run's base sha. M2. The same section shows the example
`git diff --quiet $ULTRA_BASE -- fleet/`. M3. The section's existing sentences stay: it still
says a `Check:` that runs a sim is paid by every task on every pass and belongs in the owning
task's `Run:`, and `validate_skill.py skills/ultrawrite` prints `skill ok` with
`tests/test_compile_plan_check_cost.py`, `tests/test_compile_plan_prose_check.py`,
`tests/test_ultrawrite_skill.py`, `tests/test_recommendation_rubric.py` and
`tests/test_proof_modes_documented.py` passing.

**Authorized-by:** #632 part (2) ("expose it to `Check:` and `Run:` commands as an environment
variable (`ULTRA_BASE`, set by the engine from the wave's base …) so `- Check: git diff --quiet
$ULTRA_BASE -- fleet/` is writable. Document both in ultrawrite's Global Constraints section").

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** One or two sentences in one section, nothing else moves. `## Global Constraints
discipline` (lines ~278–295) ends today with the sentence that a `Check:` running a sim is
paid by every task on every pass and belongs in the owning task's `Run:`; the paragraph
before it says a prose bullet naming a byte-identical file is one the driver could have run,
"so write it as a `Check:` beside the prose". Add, after that sentence or at the paragraph's
end, that such a comparison has a base to compare against: a `Check:` or `Run:` that compares
the tree against BASE writes `$ULTRA_BASE` — the driver sets it, in the environment of every
`Check:` and `Run:` it executes, to the run's base sha (every task clone is at BASE, and the
adopted tree's pass compares against the same base) — so `- Check: git diff --quiet
$ULTRA_BASE -- fleet/` is writable without knowing the sha, where a frozen `git hash-object`
literal is the shape for a single file. The driver half of this is another bundle's task in
this same wave (engine work, #632's open part); the sentence describes the interface both
implement — the variable's name `ULTRA_BASE` and its value, the run's base sha. Write the
rule as ONE sentence that names both `Check:` and `Run:`, the comparison against BASE, the
variable, and that the driver sets it to the run's base sha, with no full stop inside it
(no "e.g."; the exam reads the rule as a single period-free span). Do not touch
`## Execution handoff` (the next section, shared byte-for-byte with `hooks/session_start.sh`),
and keep `tests/test_compile_plan_check_cost.py`'s pinned sentence — "paid by every task on
every pass … owning task's `Run:`" — intact. A sibling task inserts a new `## ` section
between §Elicit the claim and §The proof gate and another edits §The document and
§Self-review in the same wave — leave those regions alone; same-file text folds. Keep the
register (no shouted words). The exam reads the section alone (`sed -n` from its heading to
§Execution handoff's, whitespace runs squeezed to one space); the example command is pinned
as a fixed string.
**BASE facts:** (generated at e04154b)
- `skills/ultrawrite/SKILL.md` blob 6a11e64
- `tests/test_compile_plan_check_cost.py` blob ccaad8d
- `tests/test_compile_plan_prose_check.py` blob 565f715
- `tests/test_ultrawrite_skill.py` blob 06edf94
- `tests/test_recommendation_rubric.py` blob 4727ab6
- `tests/test_proof_modes_documented.py` blob 9359f16
- `hooks/session_start.sh` blob a70c87d

**Proof:**
- Run: sed -n '/^## Global Constraints discipline/,/^## Execution handoff/p' skills/ultrawrite/SKILL.md | tr -s '[:space:]' ' ' | grep -qE '(Check:|Run:)[^.]*(Check:|Run:)[^.]*compares[^.]*against BASE[^.]*ULTRA_BASE[^.]*driver sets[^.]*base sha'
- The previous bullet reads only §Global Constraints discipline, whitespace runs squeezed to one space, and pins the rule inside one sentence — no period may fall between its parts — in order: both command kinds named, a comparison against BASE, the variable, the driver setting it, the run's base sha; the section's existing sentence that names Check: and Run: carries no ULTRA_BASE, so it cannot satisfy this [M1].
- Run: sed -n '/^## Global Constraints discipline/,/^## Execution handoff/p' skills/ultrawrite/SKILL.md | tr -s '[:space:]' ' ' | grep -qE 'Check:[^.]*Run:[^.]*ULTRA_BASE|Run:[^.]*Check:[^.]*ULTRA_BASE'
- The previous bullet is both command kinds, in either order, inside the same period-free span as the variable — a sentence naming only one of the two fails it [M1].
- Run: sed -n '/^## Global Constraints discipline/,/^## Execution handoff/p' skills/ultrawrite/SKILL.md | grep -qF -- 'git diff --quiet $ULTRA_BASE -- fleet/'
- The previous bullet is the example command, fixed-string with the variable and the path, in the section [M2].
- Run: sed -n '/^## Global Constraints discipline/,/^## Execution handoff/p' skills/ultrawrite/SKILL.md | tr -s '[:space:]' ' ' | grep -q 'paid by every task on every pass.*owning task.s .Run:.'
- The previous bullet is the existing per-task-cost sentence, kept in the section — an ordered grep that fails when either half of it is dropped [M3].
- Run: python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrawrite
- The previous bullet is the skill validator [M3].
- Run: python3 -m pytest -q -p no:cacheprovider tests/test_compile_plan_check_cost.py tests/test_compile_plan_prose_check.py tests/test_ultrawrite_skill.py tests/test_recommendation_rubric.py tests/test_proof_modes_documented.py
- The previous bullet is the discipline section's pinned sentences, the slot order, the rubric shared with the hook and the shouted-word zeros — green [M3].

**Stale-if:**
- path-absent: `skills/ultrawrite/SKILL.md`
- issue-closed: #632

### Task 4: The client says the launcher reaps and nothing schedules the janitor

**Type:** implementation

**Files:**
- Modify: `skills/ultrapowers/SKILL.md`

**Claim:** After this run, the ultrapowers client says the launcher reaps at launch, the
janitor is run by hand after a sleep, and no scheduled job on this machine ever runs it. (derived)
Machine: M1. Step 5 of `## Client` in `skills/ultrapowers/SKILL.md` carries the sentence
`The launcher runs it before every launch; nothing schedules it` verbatim. M2. Step 5 says the
agent runs the janitor by hand when this machine has been asleep. M3. Step 5 says no scheduled
job or timer on this machine runs the janitor and none is to be added, citing #660, and the
word cron appears nowhere in the file. M4. `validate_skill.py skills/ultrapowers` prints
`skill ok`, and `tests/test_docs_agree_with_code.py`, `tests/test_skill_setup_section.py`
and the sim `fleet/tests/test_janitor_reap_only.mjs` pass.

**Authorized-by:** #670 ("(2) into `skills/ultrapowers/SKILL.md` §Client step 5 (the launcher
reaps; run the janitor by hand after a sleep; there is no cron) once #660 ships"); operator
doctrine 2026-09-05 recorded in `CLAUDE.md` §Doctrine ("No local scheduled process, ever").

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** One numbered step, nothing else moves. Step 5 (`5. **Reap.**`, lines ~182–185,
the last step before `## Resources`) already says the janitor removes finished runs' VMs,
that "The launcher runs it before every launch; nothing schedules it", and that the agent
runs it by hand when this machine has been asleep — #660 shipped (PR #677) with those
sentences, and the sim `fleet/tests/test_janitor_reap_only.mjs` pins two things about this
file that bind you: that sentence appears verbatim (wraps joined), and the word "cron" — in
any case — appears nowhere in the file. So the rule is said without that word: add, in the
step, that no scheduled job or timer on this machine runs the janitor and none is to be
added — a run merges its own pull request from the sandbox and the launcher runs the reap
(#660), so a local process on a timer would only be a second writer that dies when the laptop
sleeps. Keep the step's lead `5. **Reap.**` exactly (another sim slices step 4 by it), keep
`node <plugin-root>/fleet/janitor.mjs` as the command (`tests/test_docs_agree_with_code.py`
checks every `fleet/<name>.mjs` a document names exists), keep the single
`node …fleet/launch.mjs` line in step 2 untouched (the same test reads its flags against the
launcher's usage), and keep the register — no shouted words; the whole file's whole-word count
of the three shouted imperatives is pinned at zero by the Global Constraints. The exam reads
step 5 alone (`sed -n` from the line beginning `5. ` to `## Resources`, whitespace runs
squeezed to one space) and runs the sim, which prints `ALL TESTS PASSED` only when every one
of its assertions holds (exit 0 alone is not the sentinel).
**BASE facts:** (generated at e04154b)
- `skills/ultrapowers/SKILL.md` blob f286d45
- `tests/test_docs_agree_with_code.py` blob c9687c7
- `tests/test_skill_setup_section.py` blob f04518a
- `fleet/tests/test_janitor_reap_only.mjs` blob adc4ac2
- `CLAUDE.md` blob ff1281b

**Proof:**
- Run: sed -n '/^5\. /,/^## Resources/p' skills/ultrapowers/SKILL.md | tr -s '[:space:]' ' ' | grep -qF 'The launcher runs it before every launch; nothing schedules it'
- The previous bullet reads only step 5 (from its `5. ` line to the `## Resources` heading), whitespace runs squeezed to one space, and pins the sim's sentence verbatim as a fixed string — a paraphrase fails it [M1].
- Run: sed -n '/^5\. /,/^## Resources/p' skills/ultrapowers/SKILL.md | tr -s '[:space:]' ' ' | grep -qi 'by hand.*asleep'
- The previous bullet is the by-hand-after-a-sleep rule, in step 5 [M2].
- Run: sed -n '/^5\. /,/^## Resources/p' skills/ultrapowers/SKILL.md | tr -s '[:space:]' ' ' | grep -qiE 'no (scheduled job|timer)'
- The previous bullet is the rule's first half — no scheduled job or timer runs it — in step 5 [M3].
- Run: sed -n '/^5\. /,/^## Resources/p' skills/ultrapowers/SKILL.md | tr -s '[:space:]' ' ' | grep -qi 'none is to be added'
- The previous bullet is the rule's second half — none is to be added — in step 5 [M3].
- Run: sed -n '/^5\. /,/^## Resources/p' skills/ultrapowers/SKILL.md | tr -s '[:space:]' ' ' | grep -q '#660'
- The previous bullet is the ticket, in step 5 [M3].
- Run: ! grep -qi 'cron' skills/ultrapowers/SKILL.md
- The previous bullet is the forbidden word, absent from the whole file in any case [M3].
- Run: python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers
- The previous bullet is the skill validator [M4].
- Run: python3 -m pytest -q -p no:cacheprovider tests/test_docs_agree_with_code.py tests/test_skill_setup_section.py
- The previous bullet is the structural pin of the operator documents against the code — the launch line's flags, every named script exists, no retired vocabulary — and the setup-section lint, green [M4].
- Run: node fleet/tests/test_janitor_reap_only.mjs | grep -q 'ALL TESTS PASSED'
- The previous bullet is the janitor sim, which pins this file's sentence and the absence of the word cron among its assertions, printing its sentinel only when all of them hold [M4].

**Stale-if:**
- path-absent: `skills/ultrapowers/SKILL.md`
- issue-closed: #670

### Task 5: CLAUDE.md points at the skills

**Type:** implementation

**Files:**
- Modify: `CLAUDE.md`

**Claim:** After this run, CLAUDE.md's two 2026-09-05 doctrines are one line each pointing at
the skill that holds them, and its spec-review pointer names the section that exists. (derived)
Machine: M1. The `## Doctrine` bullet beginning `- **Author plans concurrently from the
issues**` is a single line that names `skills/ultrawrite/SKILL.md` — the line after it starts
a new bullet or is blank. M2. The bullet beginning `- **No local scheduled process` is a
single line that names `skills/ultrapowers/SKILL.md` — the line after it starts a new bullet
or is blank. M3. `CLAUDE.md` contains no `§Trim review`, and its pointer to the dispatch brief
reads `skills/ultralearn/references/distilling-proposals.md` §The spec review, which is a
section heading of that file. M4. The sentence that historical specs carry `## Trim review`
sections is kept.

**Authorized-by:** #670 ("Then CLAUDE.md keeps one line each pointing at the skill" and its
2026-09-05T09:18 comment: "P4's author (2026-09-05) renamed the ultralearn reference's section
to `## The spec review`; CLAUDE.md line ~222 still says "§Trim review" as the pointer to the
dispatch brief — a one-word edit outside that run's Files. Take it in the same prose plan").

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** Three edits in one file. (1) In `## Doctrine (operator, 2026-09-03/04)` the bullet
`- **Author plans concurrently from the issues** — …` (lines ~208–214, seven lines) shrinks to
one line: the bold title, then a pointer — the procedure is `skills/ultrawrite/SKILL.md`
§Authoring a queue, which a sibling task creates in this same wave (partition by files, one
author per bundle, the issue's sentence as the Claim, two operator touches per plan,
launches serial). (2) The bullet `- **No local scheduled process, ever** — …` (lines ~215–217,
three lines) shrinks to one line: the bold title, then a pointer — the rule is
`skills/ultrapowers/SKILL.md` §Client step 5 (the launcher reaps, by hand after a sleep, no
scheduled job on this machine). One line means one physical line: the exam checks that the line after each
bullet begins a new bullet or is blank; a long line is fine, a wrapped one is not. The
operator's quoted reasons may go — the skills carry the rules now — or stay inside the one
line. (3) In `## How features are built here` the parenthesis `(dispatch brief still in
`skills/ultralearn/references/distilling-proposals.md` §Trim review)` (line ~222) becomes
`§The spec review` — the heading that file has carried since the 2026-09-05 prose plan renamed
it (`## The spec review (spec approval — every spec in this repo)`, its line 119; the exam
reads that file to confirm the pointer resolves, and does not edit it). The sentence just
before it, "Historical specs carry `## Trim review` sections", stays as it is — old specs
still carry that name. Nothing else in `CLAUDE.md` moves. The dots in the greps below stand
for the backticks a `Run:` command may not carry.
**BASE facts:** (generated at e04154b)
- `skills/ultrapowers/SKILL.md` blob f286d45
- `CLAUDE.md` blob ff1281b
- `skills/ultralearn/references/distilling-proposals.md` blob 14805df
- `skills/ultrawrite/SKILL.md` blob 6a11e64

**Proof:**
- Run: grep -q '^- \*\*Author plans concurrently from the issues\*\*.*skills/ultrawrite/SKILL.md' CLAUDE.md
- The previous bullet is the first doctrine bullet's line, naming the ultrawrite skill on that same line [M1].
- Run: grep -A1 '^- \*\*Author plans concurrently from the issues\*\*' CLAUDE.md | sed -n 2p | grep -qE '^(- |$)'
- The previous bullet is the line after the first doctrine bullet — a new bullet or blank, so the bullet is one line; a wrapped continuation fails it [M1].
- Run: grep -q '^- \*\*No local scheduled process.*skills/ultrapowers/SKILL.md' CLAUDE.md
- The previous bullet is the second doctrine bullet's line, naming the ultrapowers skill on that same line [M2].
- Run: grep -A1 '^- \*\*No local scheduled process' CLAUDE.md | sed -n 2p | grep -qE '^(- |$)'
- The previous bullet is the line after the second doctrine bullet — a new bullet or blank, so the bullet is one line; a wrapped continuation fails it [M2].
- Run: ! grep -q '§Trim review' CLAUDE.md
- The previous bullet is the old pointer, absent from the whole file [M3].
- Run: grep -q 'distilling-proposals.md. §The spec review' CLAUDE.md
- The previous bullet is the new pointer — the reference's path then §The spec review [M3].
- Run: grep -q '^## The spec review' skills/ultralearn/references/distilling-proposals.md
- The previous bullet is the heading the pointer names, present in the reference (read only; the Global Constraints freeze that file's blob) [M3].
- Run: grep -q 'Historical specs carry .## Trim review. sections' CLAUDE.md
- The previous bullet is the kept sentence about historical specs [M4].

**Stale-if:**
- path-absent: `CLAUDE.md`
- issue-closed: #670

### Task 6: The README says the run merges itself unless held

**Type:** implementation

**Files:**
- Modify: `README.md`

**Claim:** After this run, the README's Build step says the run merges its own pull request
once its checks are green, and that `--hold` keeps it open for me to merge or close. (derived)
Machine: M1. `README.md` no longer says `Merge it or close it` and no longer says
`Approve it, and the sandbox` opens the pull request. M2. `### 4. Build` says the sandbox opens
the pull request, that once its checks are green the run merges it itself, and that `--hold`
on the launch keeps the pull request open for the reader to merge or close. M3. `### 4. Build`
still says the sandbox is gone when the run is over, and `tests/test_docs_agree_with_code.py`
passes.

**Authorized-by:** #670's 2026-09-05T09:31 comment ("P2's author found `README.md` ~line 211
("Merge it or close it; either way…") stale once a run merges itself — outside that run's
Files"); #660 (a run merges itself unless held, shipped in PR #677).

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** One paragraph, nothing else moves. `### 4. Build` (lines ~203–212) ends with the
paragraph "At the end you get the finished result and your second checkpoint. Approve it,
and the sandbox opens the pull request on that repository — ultrapowers itself is just one
such repository. Its body carries the gate receipt and links the evidence branch. Merge it or
close it; either way, the run is over and the sandbox is gone." Since #660 (0.3.17) there is
no approval before the PR opens and no merge by hand: when the engine is done the sandbox
opens the pull request itself, and once the PR's checks are green the run merges it — the
squash commit lands in `status.json`'s `merged` cell — unless the launch line carried
`--hold`, which keeps the pull request open for a person (a measurement run, or a reader who
wants the second checkpoint). Rewrite the paragraph to say that: the sandbox opens the pull
request on that repository (keep "ultrapowers itself is just one such repository" and the
gate-receipt/evidence-branch sentence), once its checks are green the run merges it itself,
`--hold` on the launch keeps it open for you to merge or close, and either way the run is
over and the sandbox is gone. "Your second checkpoint" may stay only as the held PR. Keep the
README's register and its line width (~100 columns); do not name any `fleet/*.mjs` that does
not exist and do not add a launch line (`tests/test_docs_agree_with_code.py` reads the
documents structurally: every named fleet script exists, no retired vocabulary). The exam
reads the section alone (`sed -n` from `### 4. Build` to `### One hazard`, whitespace runs
squeezed to one space).
**BASE facts:** (generated at e04154b)
- `README.md` blob b218e1f
- `tests/test_docs_agree_with_code.py` blob c9687c7
- `merged` at `fleet/tests/test_run_engine_conflict.mjs:56` blob 79e3105

**Proof:**
- Run: ! grep -q 'Merge it or close it' README.md
- The previous bullet is the stale sentence, absent from the whole file [M1].
- Run: ! grep -q 'Approve it, and the sandbox' README.md
- The previous bullet is the stale approval step, absent from the whole file [M1].
- Run: sed -n '/^### 4\. Build/,/^### One hazard/p' README.md | tr -s '[:space:]' ' ' | grep -q 'sandbox opens the pull request'
- The previous bullet reads only §4. Build, whitespace runs squeezed to one space, and pins that the sandbox opens the pull request [M2].
- Run: sed -n '/^### 4\. Build/,/^### One hazard/p' README.md | tr -s '[:space:]' ' ' | grep -qi 'checks are green.*merges it'
- The previous bullet is the self-merge — checks green, then the run merges it — in the section [M2].
- Run: sed -n '/^### 4\. Build/,/^### One hazard/p' README.md | tr -s '[:space:]' ' ' | grep -q -- '--hold.*merge or close'
- The previous bullet is the held case — the flag, then the pull request left for the reader to merge or close — in the section [M2].
- Run: sed -n '/^### 4\. Build/,/^### One hazard/p' README.md | tr -s '[:space:]' ' ' | grep -q 'sandbox is gone'
- The previous bullet is the ending — the sandbox is gone — still in the section [M3].
- Run: python3 -m pytest -q -p no:cacheprovider tests/test_docs_agree_with_code.py
- The previous bullet is the structural pin of the four operator documents against the code — every named script exists, no retired vocabulary — green [M3].

**Stale-if:**
- path-absent: `README.md`
- issue-closed: #670
