# Referee prose sweep — "referee" names the driver's arithmetic, "reviewer" the model

**Grammar:** claims-v1

**Claim:** Every "referee" in the engine and the report format is the driver's arithmetic, and every model review agent is a "reviewer". (elicited)

**Goal:** Close #821 (the #817 residual): at #729 the word "referee" changed actor — it now names
the driver's mechanical referee (`fleet/referee.mjs`), and the model review agents are
"reviewers" — and the sentences the record reads did not all move with it. One prose task on
two files, at BASE `1130fcb85add4b22a55b63989efa6324ae40e65d`: the record-visible engine strings
(`fleet/run-engine.mjs` line 1985, the pre-review judgment call the issue names, and line 1847, the
minor-Check judgment call found beside it, which names the reviewer the same way) and the field-table rows
of `skills/ultrapowers/references/report-format.md`. Three choices were made in place of an
operator question. (1) The issue names three rows of `report-format.md` (`proofFixes`,
`blockingFindings`, the `proof-red` gloss); at BASE four more rows use "referee" for the model
reviewer — `tasks[].actor` ("dispatched no referee"), `tasks[].examEdited` ("names the paths to
the referee … the referee decides"), `integratedChecks` ("each referee was right about the tree
it read") and `deferredVerification` ("no referee can wave it through") — plus the `proofFixes`
row's own tail ("the referees then found nothing"). The Claim quantifies over the file, so the
task sweeps all of them; every bare "referee" the file keeps is qualified `driver's`,
`mechanical`, `blocking` or `still-blocking`. (2) The engine's *comments* still say "referee" for
the model reviewer in dozens of places (lines 169–194, 462–532, 1797–1802, 2049–2284 at BASE);
they are read by no record and no report, and two prompt literals (`PROPOSED_PATCH_HEADER`, shared
with the role files, and the minor-Check gloss rendered to the reviewer) do the same; the task
changes only the judgment-call strings the record carries, and the comment and prompt sweep is
left to a later ticket.
(3) `fleet/roles/reviewer.md`'s first line ("You are a referee") is left alone — the issue calls
it the operator's call, and it is not in this plan's Files. This run is also the confidence run
for the engine merged today at `ae84a2da` (#842): its task spells `- Produces: none` on purpose,
the placeholder that failed runs 74 and 77 referee-red before that fix.
**Closes:** #821

**Tech Stack:** Node ≥ 20 (`fleet/`), Python 3 (`tests/`, pytest). The committed suite is
`python3 -m pytest` (which bridges `fleet/tests/test_*.mjs`).

**Spec:** none — the plan descends from #821, whose desired-state paragraph is the contract; every
fact the worker needs is in the task's Context.

**Parallelization rationale:** one wave, width 1. The plan is one prose task on two files with
one contract; there is nothing to split and no chain.

## Global Constraints

- Check: git diff --quiet $ULTRA_BASE -- fleet/referee.mjs fleet/referee-linker.mjs fleet/roles/reviewer.md
- No behaviour changes: the engine edits are two string literals in judgment calls, and every test that ran green
  at BASE runs green after it.
- The JSON keys of the report (`refereeFindings`, `refereeBlocking`, `refereeSkippedPairs`,
  `referee-red`, `proof-red`) are unchanged in spelling — they are the mechanical referee's and
  are correct.

**Acceptance:** suite — the committed suite is the verification.

### Task 1: The word "referee" means the driver's referee in the engine string and the report format

**Type:** implementation
**Review:** lean

**Files:**
- Modify: `fleet/run-engine.mjs`
- Modify: `skills/ultrapowers/references/report-format.md`

**Claim:** Every sentence the run record carries from the engine — its judgment calls — and every row of the report format call the driver's arithmetic the "referee" and the model review agent a "reviewer". (derived)
Machine: M1. For each of the two judgment-call strings in `fleet/run-engine.mjs` that named the model reviewer "referee" at BASE — the pre-review repair call and the minor-Check call — the string now says `reviewer`: the file contains ` — one repair round before any reviewer read the patch` and ` — recorded for the reviewer, blocking nothing`, and the phrases `before any referee read` and `recorded for the referee` appear on no line of the file. The engine's comments and the prompt text it renders to workers (`PROPOSED_PATCH_HEADER`, the minor-Check gloss of the Global Constraints block) are not judgment calls and are outside this clause.
M2. The `tasks[].proofFixes` row of `skills/ultrapowers/references/report-format.md` contains `a second red pass ends the task at ` followed by the code span `proof-red` ` (a red ` `Run:` `/` `Check:` `) or ` `referee-red` ` (a still-blocking referee)` — spelled with backticks around each of those five code spans — and its tail reads `the reviewers then found nothing`; the phrases `rather than looping` and `the referees then found nothing` appear on no line of the file.
M3. The `reviewEconomy` row reads `how many blocking issues the REVIEWERS returned` and `charging the driver's findings to the reviewers flatters the ratio`; the phrases `REFEREES returned` and `to the referee flatters` appear on no line of the file.
M4. The `proof-red` gloss in the `tasks[].reviewVerdict` row reads `no reviewer was ever dispatched, because a patch whose own proof fails is not a patch a reviewer can grade`; the phrases `no referee was ever dispatched` and `a referee can grade` appear on no line of the file.
M5. For each of the four rows `tasks[].actor`, `tasks[].examEdited`, `integratedChecks` and `deferredVerification`, the model reviewer is named `reviewer`: the file contains `dispatched no reviewer (`, `names the paths to the reviewer as `, `the reviewer decides whether the exam was wrong`, `each reviewer was right about the tree it read` and `no reviewer can wave it through`, and the phrases `dispatched no referee`, `to the referee as`, `the referee decides`, `each referee was right` and `no referee can wave` appear on no line of the file.
M6. The `refereeSkippedPairs` gloss in the `reviewEconomy` row reads `because a blocking referee finding had just been repaired`, and every occurrence of the lower-case word `referee` or `referees` in `skills/ultrapowers/references/report-format.md` — at any position on a line, possessives included, the verdict token `referee-red` and camel-case keys such as `refereeFindings` excepted — is immediately preceded by one space and one of `driver's`, `mechanical`, `blocking` or `still-blocking`.
M7. `python3 -m pytest tests/test_docs_agree_with_code.py -q` exits 0.

**Authorized-by:** #821 (desired state), the #729 rename it completes, #817 (the residual it names)

**Interfaces:**
- Consumes: nothing
- Produces: none

**Context:** Prose only; the behaviour is right and stays right. At BASE
`1130fcb85add4b22a55b63989efa6324ae40e65d` (`fleet/run-engine.mjs` blob
`ec88082608d0eca81dbe56ba57b0bd660bb142e1`, `report-format.md` blob
`7a975e61624e8bd75af906a6dfdefd1b76701300`) the strings to move are these, located by phrase
rather than line number because the lines drift. Engine, line 1985, inside the `judgmentCalls.push(`
that follows `proofFixes = 1`: the literal `') — one repair round before any referee read the
patch')` — since #729 the mechanical referee has already read the patch at that point (it is often
what made the pass red), so it becomes `before any reviewer read the patch`; the sibling message at
line 2020 (`— no reviewer was dispatched`) is already right and is the wording to match. Engine, line 1847,
the minor-Check judgment call inside `noteMinorCheck`: `' — recorded for the referee, blocking nothing'`
names the model reviewer (a minor check is recorded for the per-task reviewer's attention), so it
becomes `recorded for the reviewer, blocking nothing`. Those two are the only judgment-call strings
in the file that use the word for the reviewer; the two others (`': referee ' + f.check`, line 1905,
and `the referee is still blocking`, line 2062) are the mechanical referee and stay. The word also
survives in prompt text the engine renders to workers — `PROPOSED_PATCH_HEADER` (line 172, a literal
shared with `fleet/roles/fix.md` and `reviewer.md`) and the minor-Check gloss of the Global
Constraints block (line 476) — and in comments; none of those reaches the record, and they are left
for a later ticket rather than swept here.
`report-format.md` field table: row `tasks[].proofFixes` (line 99) — `Never more than 1 — a
second red pass ends the task at \`proof-red\` rather than looping.` becomes `Never more than 1 — a
second red pass ends the task at \`proof-red\` (a red \`Run:\`/\`Check:\`) or \`referee-red\` (a
still-blocking referee).`, and its tail `the referees then found nothing` becomes `the reviewers
then found nothing`; row `reviewEconomy` (line 107) — `the REFEREES returned` becomes `the
REVIEWERS returned` and `to the referee flatters` becomes `to the reviewers flatters`; row
`tasks[].reviewVerdict` (line 92), the `proof-red` gloss — `no referee was ever dispatched` becomes
`no reviewer was ever dispatched` and `a referee can grade` becomes `a reviewer can grade`; row
`tasks[].actor` (line 93) — `dispatched no referee (` becomes `dispatched no reviewer (`; row
`tasks[].examEdited` (line 102) — `to the referee as` becomes `to the reviewer as` and `the referee
decides` becomes `the reviewer decides`; row `integratedChecks` (line 106) — `each referee was
right` becomes `each reviewer was right`; row `deferredVerification` (line 116) — `no referee can
wave it through` becomes `no reviewer can wave it through`. Every other `referee` in that file
already names the driver's referee and stays: `the driver's referee alone` (line 92), `a blocking
referee finding` (line 99), `the driver's mechanical referee` (line 107), `the driver's referee
returned` (line 116) — and one is reworded only so the rule has no exception: the `refereeSkippedPairs`
gloss (line 107) `because the referee's blocking finding had just been repaired` becomes `because a
blocking referee finding had just been repaired` — and the JSON keys `refereeFindings` / `refereeBlocking` /
`refereeSkippedPairs` (lines 40–41, 107) and the verdict `referee-red`. Nothing in `tests/` or
`fleet/tests/` pins any of the old sentences (`grep -rn` for each at BASE returns nothing; the
one near-miss, `fleet/tests/test_run_engine_exam_together.mjs` line 3, is a comment reading
`before any referee reads it` and is not this task's file). `tests/test_docs_agree_with_code.py`
pins structure, not these sentences — 27 tests, green at BASE — and is run as M7's proof that the
edit broke none of it. Table rows are single lines: keep each row on one line so the markdown
table still parses. The engine edit is one string literal and is observed by grep on the tree, never by
a live run — no sim is touched, and the string is asserted by no test at BASE. This plan's `- Produces: none` is deliberate — it is the placeholder #842
(`ae84a2da`, merged today) taught the referee's linker to read as "no symbol promised".

**Proof:**
- Run: test "$(grep -c 'before any reviewer read the patch' fleet/run-engine.mjs)" = 1 && test "$(grep -c 'before any referee read' fleet/run-engine.mjs)" = 0
- Run: test "$(grep -c 'recorded for the reviewer, blocking nothing' fleet/run-engine.mjs)" = 1 && test "$(grep -c 'recorded for the referee' fleet/run-engine.mjs)" = 0
- Run: grep -q 'a second red pass ends the task at .proof-red. (a red .Run:./.Check:.) or .referee-red. (a still-blocking referee)' skills/ultrapowers/references/report-format.md && test "$(grep -c 'or .referee-red.' skills/ultrapowers/references/report-format.md)" = 1 && grep -q 'the reviewers then found nothing' skills/ultrapowers/references/report-format.md && test "$(grep -c 'rather than looping' skills/ultrapowers/references/report-format.md)" = 0 && test "$(grep -c 'the referees then found nothing' skills/ultrapowers/references/report-format.md)" = 0
- Run: grep -q 'how many blocking issues the REVIEWERS returned' skills/ultrapowers/references/report-format.md && grep -q "charging the driver's findings to the reviewers flatters the ratio" skills/ultrapowers/references/report-format.md && test "$(grep -c 'REFEREES returned' skills/ultrapowers/references/report-format.md)" = 0 && test "$(grep -c 'to the referee flatters' skills/ultrapowers/references/report-format.md)" = 0
- Run: grep -q 'no reviewer was ever dispatched, because a patch whose own proof fails is not a patch a reviewer can grade' skills/ultrapowers/references/report-format.md && test "$(grep -c 'no referee was ever dispatched' skills/ultrapowers/references/report-format.md)" = 0 && test "$(grep -c 'a referee can grade' skills/ultrapowers/references/report-format.md)" = 0
- Run: grep -q 'dispatched no reviewer (' skills/ultrapowers/references/report-format.md && test "$(grep -c 'dispatched no referee' skills/ultrapowers/references/report-format.md)" = 0
- Run: grep -q 'names the paths to the reviewer as ' skills/ultrapowers/references/report-format.md && grep -q 'the reviewer decides whether the exam was wrong' skills/ultrapowers/references/report-format.md && test "$(grep -c 'to the referee as' skills/ultrapowers/references/report-format.md)" = 0 && test "$(grep -c 'the referee decides' skills/ultrapowers/references/report-format.md)" = 0
- Run: grep -q 'each reviewer was right about the tree it read' skills/ultrapowers/references/report-format.md && test "$(grep -c 'each referee was right' skills/ultrapowers/references/report-format.md)" = 0
- Run: grep -q 'no reviewer can wave it through' skills/ultrapowers/references/report-format.md && test "$(grep -c 'no referee can wave' skills/ultrapowers/references/report-format.md)" = 0
- Run: grep -q 'because a blocking referee finding had just been repaired' skills/ultrapowers/references/report-format.md && test "$(grep -c "the referee's blocking finding" skills/ultrapowers/references/report-format.md)" = 0 && test "$(( $(grep -oE "\breferees?\b" skills/ultrapowers/references/report-format.md | wc -l) - $(grep -o "referee-red" skills/ultrapowers/references/report-format.md | wc -l) - $(grep -oE "(driver's|mechanical|blocking|still-blocking) referees?\b" skills/ultrapowers/references/report-format.md | wc -l) ))" = 0
- Run: python3 -m pytest tests/test_docs_agree_with_code.py -q
- Legs: (a) the pre-review repair call reads `before any reviewer read the patch` on exactly one line and the old `before any referee read` is on none — the first Run [M1]; (b) the minor-Check call reads `recorded for the reviewer, blocking nothing` on exactly one line and the old `recorded for the referee` is on none — the second Run [M1]; (c) the `proofFixes` row carries the `proof-red (a red Run:/Check:) or referee-red (a still-blocking referee)` sentence, with `or referee-red` on exactly one line of the file, and the old `rather than looping` is absent — the third Run's first, second and fourth conjuncts [M2]; (d) the same row's tail reads `the reviewers then found nothing` and the old `the referees then found nothing` is absent — the third Run's third and fifth conjuncts [M2]; (e) `REVIEWERS returned` and `to the reviewers flatters the ratio` are present and `REFEREES returned` / `to the referee flatters` absent — the fourth Run [M3]; (f) the whole new `proof-red` gloss is present and both old phrases (`no referee was ever dispatched`, `a referee can grade`) absent — the fifth Run [M4]; (g) row `tasks[].actor`: `dispatched no reviewer (` present, `dispatched no referee` absent — the sixth Run [M5]; (h) row `tasks[].examEdited`: both new phrases present, both old absent — the seventh Run [M5]; (i) row `integratedChecks`: `each reviewer was right about the tree it read` present, `each referee was right` absent — the eighth Run [M5]; (j) row `deferredVerification`: `no reviewer can wave it through` present, `no referee can wave` absent — the ninth Run [M5]; (k) the `refereeSkippedPairs` gloss reads `because a blocking referee finding had just been repaired` and its old possessive form is absent, and the count of every whole-word `referee`/`referees` in the file (the word boundary falls before an apostrophe, so `referee's` counts; `refereeFindings` and its siblings do not, having no boundary after `referee`) minus the count of `referee-red` tokens minus the count of occurrences preceded by ` driver's `, ` mechanical `, ` blocking ` or ` still-blocking ` is exactly 0 — the tenth Run, which one surviving `the referee`, `a referee`, `referee's`, or a `referee` after punctuation, a backtick or a line start pushes to a positive number and so fails; on a simulated post-edit copy at BASE the three counts are 8, 2 and 6, and appending one `the referee` line makes the Run exit 1 [M6]; (l) the doc↔code structural suite exits 0 — the eleventh Run [M7].

**Stale-if:**
- sha-matches: `fleet/run-engine.mjs@ec88082608d0eca81dbe56ba57b0bd660bb142e1`
- sha-matches: `skills/ultrapowers/references/report-format.md@7a975e61624e8bd75af906a6dfdefd1b76701300`
- issue-closed: #821
