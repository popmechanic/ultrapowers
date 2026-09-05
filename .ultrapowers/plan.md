# The two skills say it

**Grammar:** claims-v1

**Claim:** After this run, the ultralearn spec-review brief asks for under-specification and
scope reconciliation first, and ultrawrite tells an author that exams extend one file per
behaviour surface, that a byte-identical claim needs a frozen pre-edit literal, and that a
registration is a new file, never an appended line. (elicited)

**Goal:** Two prose deliverables that three sittings decided and no document yet says. #519
(decided 2026-09-01): the trim review in `skills/ultralearn/references/distilling-proposals.md`
becomes the neutral fresh-context spec review that `CLAUDE.md` §How features are built here
already describes in one paragraph — under-specification hunting and scope reconciliation are
the mandate, trim proposals are welcome and optional, and the mechanics that never changed
(one fresh-context dispatch, inputs excluding the authoring conversation, the reviewer grading
`netConceptDelta`, adopt-or-answer in the spec, advisory never a gate) stay. #609 items 1 and
3: `skills/ultrawrite/SKILL.md` says that an exam file is one per behaviour surface, extended
by later tasks with each task's legs under a comment naming the task (plus a Self-review
line), and that a `byte-identical to BASE` or `git show HEAD:` comparison is a tautology at
the integration head, so the exam carries a frozen pre-edit literal or a full 40-hex sha
fetched with `git fetch --depth=1 origin <sha>` for depth-1 CI. #665's authoring half: N
tasks that each add one line to one list are N adjacent inserts at one location, which the
fold sends to a resolver (run-12: five appends to one `ADVISORY_RENDERS` line cost three
resolver workers, 6.6 of a 13-minute tail) — give each task its own region or file; a
registration is a new file discovered by glob, never an appended line. #609 item 2 (prose is
proved by `Run:`) already shipped and is not here; #665's kernel half (an append-only region
the fold may reorder) is #360's and is not here. Nothing under `fleet/`, nothing in
`skills/ultrapowers/`, and no hook is touched — three sibling plans own those files.

**Tech Stack:** Markdown (`skills/ultralearn/references/distilling-proposals.md`,
`skills/ultrawrite/SKILL.md`, each validated by
`skills/ultrapowers/scripts/validate_skill.py`), Python 3 (`python3 -m pytest` for the
tests that pin the skill's existing sentences). Nothing is added to any dependency file.

**Spec:** #519, #609 (items 1 and 3), #665 (shape (a), the authoring half). The issues carry
the design; there is no separate spec document.

**Parallelization rationale:** One wave, width 2. Task 1 modifies only the ultralearn
reference; Task 2 modifies only the ultrawrite skill. No Files overlap, no task consumes a
sibling's symbol, so no edge is derived and neither task waits. Neither task creates a test
file: each deliverable is prose and proves itself with `Run:` commands.

## Global Constraints

- The three sibling plans' files are byte-identical to BASE — the fleet, the operator skill,
  the compiler and the session hook are theirs.
- Check: test "$(git hash-object fleet/run-engine.mjs)" = 762be27108232d1625964d4f2c97e9f4bd7f06de
- Check: test "$(git hash-object fleet/roles/implementer.md)" = 0a92a3d5a6c43ab88710d7c93322fcacda011152
- Check: test "$(git hash-object fleet/sandbox-boot.sh)" = fbe4d8dbc80d8a862f6dff86d2d946cee5eb580c
- Check: test "$(git hash-object fleet/launch.mjs)" = f47370d2badc0ef87b9d559f4e6a77f79d27d4b2
- Check: test "$(git hash-object fleet/janitor.mjs)" = 2de1fc707f26a06373905a8425f2ef6b67571210
- Check: test "$(git hash-object fleet/doctor.mjs)" = 7e35dcd094d24a25da7c7e4277bb983f32ff84b0
- Check: test "$(git hash-object fleet/CONTRACT.md)" = 1bf320dd7498f40e99558c397bebe669345b1cf7
- Check: test "$(git hash-object fleet/RUNBOOK.md)" = f630c6a17bfd931d702a3be675ec8a91be2aa497
- Check: test "$(git hash-object skills/ultrapowers/SKILL.md)" = 3df41c3fae22e7cf67534d9b2814aa644fb87b39
- Check: test "$(git hash-object skills/ultrapowers/references/first-run.md)" = a042dcd5485bbca9db37e0137144e9c3018b3a95
- Check: test "$(git hash-object skills/ultrapowers/scripts/compile_plan.py)" = 18ad6070d1e0c33142710ebc107f11fe8f6765fa
- Check: test "$(git hash-object hooks/session_start.sh)" = a70c87d7b8bdfd853954c4786645432ddd977097
- Check: python3 -m pytest -q -p no:cacheprovider tests/test_docs_agree_with_code.py tests/test_recommendation_rubric.py tests/test_session_hook.py
- Both skills still validate.
- Check: python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrawrite
- Check: python3 skills/ultrapowers/scripts/validate_skill.py skills/ultralearn
- No shouted imperative (an all-caps must, never or always as a whole word) is added to either
  document: `skills/ultrawrite/SKILL.md` stays at zero of each, and
  `skills/ultralearn/references/distilling-proposals.md` keeps exactly the one it has (line 5,
  outside the section this plan rewrites) and gains none of the other two.
- Check: test "$(grep -ow MUST skills/ultralearn/references/distilling-proposals.md | wc -l | tr -d ' ')" = 1
- Check: ! grep -qw 'NEVER' skills/ultralearn/references/distilling-proposals.md
- Check: ! grep -qw 'ALWAYS' skills/ultralearn/references/distilling-proposals.md
- The execution-handoff rubric shared byte-for-byte between `hooks/session_start.sh` and
  `skills/ultrawrite/SKILL.md` §Execution handoff is untouched (the rubric tests above are
  the pin).
- No file outside a task's own Files block is edited.

**Acceptance:** suite — the committed suite is the verification.

### Task 1: The spec-review brief asks for thinness and scope first

**Type:** implementation

**Files:**
- Modify: `skills/ultralearn/references/distilling-proposals.md`

**Claim:** After this run, the ultralearn spec-review brief asks for under-specification and
scope reconciliation first. (derived)
Machine: M1. The section of `skills/ultralearn/references/distilling-proposals.md` that
was `## The trim review (spec approval — every spec in this repo)` is headed `## The spec
review (spec approval — every spec in this repo)`, and no heading beginning `## The trim
review` remains in the file. M2. That section's mandate names, first, under-specification
hunting, with its four named shapes — ambiguous rules an implementation cannot build as
written; missing refusal or failure semantics; unstated migration behaviour; authority
granted without an enforcement point — and, second, scope reconciliation against the
decision records, naming every expansion and flagging a decision that exists only in
conversation, and contradictions between the spec and those records. M3. Trim proposals are
optional output: the section says they are welcome but not the mandate, and the old
per-element requirement is gone — neither `Propose the trimmed version` nor `for each design
element` appears in the section. M4. The section keeps, each in its own sentence, the
mechanics #519 left unchanged: one fresh-context dispatch; inputs that exclude the authoring
conversation; the reviewer grades `netConceptDelta`; the spec carries a `## Spec review`
section with an adopt-or-answer entry for every finding; the review is advisory to the
operator and never a gate; and the section says that historical specs carry `## Trim review`
sections under the old name. M5. `validate_skill.py skills/ultralearn` still prints `skill
ok`.

**Authorized-by:** #519 ("Amend `skills/ultralearn/references/distilling-proposals.md` §The
trim review: Primary mandate: (1) under-specification hunting … (2) scope reconciliation
against the decision records … Demoted: trim proposals become optional output … Unchanged:
one fresh-context dispatch, inputs exclude the authoring conversation, reviewer grades
`netConceptDelta`, adopt-or-answer section in the spec, advisory-never-gate."); operator
decision 2026-09-01 recorded in `CLAUDE.md` §How features are built here.

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** The section to rewrite runs from the heading `## The trim review (spec approval
— every spec in this repo)` (line ~119) to the heading `## The adopted-proposal retrospective
(every distill — the cluster-died check)` (line ~149); every other section of the file is left
as it is, including the one `MUST` on line 5. Its present mandate is three numbered parts —
*Propose the trimmed version* (per design element, with under-specification as an aside),
*Reconcile scope*, *Grade `netConceptDelta`* — followed by the bounded-dispatch paragraph
and the `## Trim review` paragraph. The rewrite flips the centre of gravity, matching the one
paragraph `CLAUDE.md` §How features are built here already carries: the reviewer hunts
under-specification, scope reconciliation and contradictions, trim proposals are welcome but
not the mandate, and the spec carries a `## Spec review` section with adopt-or-answer for
every finding. Order the mandate as #519 orders it — under-specification first (the four
shapes it names are the ones the #390 review found load-bearing: the missing edge-tier table,
the gate with no verdict artifact, the provenance check that needed `gh` inside a pure
compiler, the A/B with no tie rule), scope reconciliation second (against the decision
records, naming every expansion, flagging a decision that lives only in the conversation, and
any contradiction with those records), `netConceptDelta` grading and trims after. Rename the
heading (the issue leaves the name to the author; a heading that says "trim" over a mandate
that is not trims is the dishonesty the issue names) and keep one sentence saying that
historical specs carry `## Trim review` sections — `CLAUDE.md` says the same, so an old spec's
section name still resolves. The exam below reads the section alone — `sed -n` from the new
heading to the retrospective's heading, whitespace runs squeezed to one space — and pins each sentence's operative
parts in order; the phrases inside the greps are the contract, the wording around them is
yours. Keep the section free of all-caps imperatives (the present `ONLY` and `Never` are
fine to reword or keep; the Global Constraints pin the file's shouted-word counts).
**BASE facts:** (generated at 4bd0f5c)
- `skills/ultralearn/references/distilling-proposals.md` blob c3aabdb
- `CLAUDE.md` blob 35fc0cd

**Proof:**
- Run: grep -q '^## The spec review (spec approval — every spec in this repo)$' skills/ultralearn/references/distilling-proposals.md
- The previous bullet is the new heading, exact and alone on its line [M1].
- Run: ! grep -q '^## The trim review' skills/ultralearn/references/distilling-proposals.md
- The previous bullet is the old heading, absent [M1].
- Run: sed -n '/^## The spec review/,/^## The adopted-proposal retrospective/p' skills/ultralearn/references/distilling-proposals.md | tr -s '[:space:]' ' ' | grep -qiE 'under-specification.*(reconcile scope|scope reconciliation)'
- The previous bullet reads only the section (from its heading to the next section's), whitespace runs squeezed to one space, and pins the two mandates in #519's order — under-specification before scope reconciliation [M2].
- Run: sed -n '/^## The spec review/,/^## The adopted-proposal retrospective/p' skills/ultralearn/references/distilling-proposals.md | tr -s '[:space:]' ' ' | grep -q 'ambiguous rule.*cannot build as written'
- The previous bullet is the first under-specification shape, in the section [M2].
- Run: sed -n '/^## The spec review/,/^## The adopted-proposal retrospective/p' skills/ultralearn/references/distilling-proposals.md | tr -s '[:space:]' ' ' | grep -q 'missing refusal.*failure semantics'
- The previous bullet is the second under-specification shape, in the section [M2].
- Run: sed -n '/^## The spec review/,/^## The adopted-proposal retrospective/p' skills/ultralearn/references/distilling-proposals.md | tr -s '[:space:]' ' ' | grep -q 'unstated migration behaviou\?r'
- The previous bullet is the third under-specification shape, in the section [M2].
- Run: sed -n '/^## The spec review/,/^## The adopted-proposal retrospective/p' skills/ultralearn/references/distilling-proposals.md | tr -s '[:space:]' ' ' | grep -q 'authority granted without an enforcement point'
- The previous bullet is the fourth under-specification shape, in the section [M2].
- Run: sed -n '/^## The spec review/,/^## The adopted-proposal retrospective/p' skills/ultralearn/references/distilling-proposals.md | tr -s '[:space:]' ' ' | grep -q 'scope.*against the decision records.*every expansion'
- The previous bullet is scope reconciliation against the decision records, naming every expansion, in the section [M2].
- Run: sed -n '/^## The spec review/,/^## The adopted-proposal retrospective/p' skills/ultralearn/references/distilling-proposals.md | tr -s '[:space:]' ' ' | grep -q 'decision.*only in .*conversation'
- The previous bullet is the flag for a decision that exists only in conversation, in the section [M2].
- Run: sed -n '/^## The spec review/,/^## The adopted-proposal retrospective/p' skills/ultralearn/references/distilling-proposals.md | tr -s '[:space:]' ' ' | grep -q 'contradiction'
- The previous bullet is contradictions with the decision records, named in the section [M2].
- Run: sed -n '/^## The spec review/,/^## The adopted-proposal retrospective/p' skills/ultralearn/references/distilling-proposals.md | tr -s '[:space:]' ' ' | grep -qi 'trim proposals.*welcome.*not the mandate'
- The previous bullet is the demotion sentence — trim proposals welcome but not the mandate — in the section [M3].
- Run: ! sed -n '/^## The spec review/,/^## The adopted-proposal retrospective/p' skills/ultralearn/references/distilling-proposals.md | grep -q 'Propose the trimmed version'
- The previous bullet is the old first mandate, absent from the section [M3].
- Run: ! sed -n '/^## The spec review/,/^## The adopted-proposal retrospective/p' skills/ultralearn/references/distilling-proposals.md | grep -q 'for each design element'
- The previous bullet is the old per-element requirement, absent from the section [M3].
- Run: sed -n '/^## The spec review/,/^## The adopted-proposal retrospective/p' skills/ultralearn/references/distilling-proposals.md | tr -s '[:space:]' ' ' | grep -q 'one.*fresh-context subagent'
- The previous bullet is the one fresh-context dispatch, in the section [M4].
- Run: sed -n '/^## The spec review/,/^## The adopted-proposal retrospective/p' skills/ultralearn/references/distilling-proposals.md | tr -s '[:space:]' ' ' | grep -qi 'never the authoring conversation'
- The previous bullet is the input exclusion — the authoring conversation is not an input — in the section [M4].
- Run: sed -n '/^## The spec review/,/^## The adopted-proposal retrospective/p' skills/ultralearn/references/distilling-proposals.md | tr -s '[:space:]' ' ' | grep -q 'Grade .netConceptDelta.'
- The previous bullet is the reviewer grading netConceptDelta, in the section (the dots stand for the backticks around the field name, which a Run: command may not carry) [M4].
- Run: sed -n '/^## The spec review/,/^## The adopted-proposal retrospective/p' skills/ultralearn/references/distilling-proposals.md | tr -s '[:space:]' ' ' | grep -q '.## Spec review. section.*adopt-or-answer.*every finding'
- The previous bullet is the spec's Spec review section with adopt-or-answer for every finding, in the section (the dots stand for the backticks around the heading) [M4].
- Run: sed -n '/^## The spec review/,/^## The adopted-proposal retrospective/p' skills/ultralearn/references/distilling-proposals.md | tr -s '[:space:]' ' ' | grep -q 'advisory to the operator, never a .*gate'
- The previous bullet is advisory-never-gate, in the section [M4].
- Run: sed -n '/^## The spec review/,/^## The adopted-proposal retrospective/p' skills/ultralearn/references/distilling-proposals.md | tr -s '[:space:]' ' ' | grep -q 'Historical specs carry .## Trim review. sections'
- The previous bullet is the sentence that keeps the old name findable for old specs, in the section (the dots stand for the backticks around the heading) [M4].
- Run: python3 skills/ultrapowers/scripts/validate_skill.py skills/ultralearn
- The previous bullet is the skill validator over the ultralearn skill, whose references directory holds the file [M5].

**Stale-if:**
- path-absent: `skills/ultralearn/references/distilling-proposals.md`
- issue-closed: #519

### Task 2: Ultrawrite says it — exams per surface, frozen literals, registrations as files

**Type:** implementation

**Files:**
- Modify: `skills/ultrawrite/SKILL.md`

**Claim:** After this run, ultrawrite tells an author that exams extend one file per
behaviour surface, that a byte-identical claim needs a frozen pre-edit literal, and that a
registration is a new file, never an appended line. (derived)
Machine: M1. The Proof bullet under `### The six body slots, in this order` in
`skills/ultrawrite/SKILL.md` says, in this order, that an exam file is one per behaviour
surface and named for it, that a later task on the same surface extends that file, and that
the task's legs sit under a comment naming the task. M2. The same Proof bullet says, in this
order, that a `byte-identical to BASE` or `git show HEAD:` comparison is a tautology at the
integration head, that the exam carries a frozen pre-edit literal instead, or a full 40-hex
sha, fetched with `git fetch --depth=1 origin <sha>` because CI checks out at depth 1. M3.
Rule 4 of `## Decomposition judgment` says, in this order, that N tasks each adding one line
to one list are N adjacent inserts at one location, which the fold sends to a resolver, with
run-12's count (five tasks' appends, three resolver workers), and that each task gets its own
region or file — a registration is a new file discovered by glob, never an appended line.
M4. `## Self-review` carries a line saying every exam file is named for its behaviour surface
and a task that extends one groups its legs under a comment naming the task. M5.
`validate_skill.py skills/ultrawrite` still prints `skill ok`, the skill's shouted-word
counts stay at BASE's zeros, and every existing test that reads the skill still passes:
`tests/test_ultrawrite_skill.py`, `tests/test_plan_level_claim.py`,
`tests/test_review_peer.py`, `tests/test_proof_modes_documented.py`,
`tests/test_compile_plan_check_cost.py`, `tests/test_compile_plan_prose_check.py`,
`tests/test_compile_plan_integration_hostile.py`, `tests/test_marker_contract.py`.

**Authorized-by:** #609 items 1 and 3 ("one exam file per behaviour surface, extended by
later tasks, with a task's legs grouped under a comment naming the task. Write the rule and
a Self-review line." / "the exam must carry a frozen pre-edit literal or a full 40-char sha
with `git fetch --depth=1 origin <sha>` for depth-1 CI … Add the literal half."); #665
shape (a) ("N tasks create N files and the fold sees no overlap; `ultrawrite` says so where
it says same-file text folds").

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** Three places, three sentences and one bullet, nothing else moves. (1) The
Proof bullet of the six-slot list (lines ~80–93) ends today with `A task whose deliverable
is prose proves itself with \`Run:\` commands, never with a test that matches sentences of a
document.`; the two new sentences follow it inside the same bullet — first the exam-file
rule, then the frozen-literal rule. The exam-file rule: an exam file is one per behaviour
surface and named for it (never `test_<task-noun>`), a later task on that surface extends
the file, and its legs go under a comment naming the task — five plans on 2026-09-03 left one
`fleet/tests/test_<task-noun>.mjs` per task, which is the shape this replaces; "later" means
a later wave or a later plan, because two same-wave tasks appending to one file are the
adjacent-insert shape rule 4 names. The frozen-literal rule: a `byte-identical to BASE` or
`git show HEAD:` comparison is a tautology at the integration head (HEAD there already
carries the edit), so the exam carries the value measured before the edit — a frozen
pre-edit literal such as a `git hash-object` sha written into the exam, as this plan's own
Global Constraints do — or a full 40-hex sha with `git fetch --depth=1 origin <sha>`, because
`actions/checkout` is depth-1 and a short or unfetched sha is not there (#572 carries the
sha half; the memory `fetch-by-sha is NOT a presence proof` is the trap on the other side of
it). (2) Rule 4 of `## Decomposition judgment` (lines ~248–253, `**Let same-file edits
stand.**`) gains its sentence at the end of the rule: N tasks that each add one line to one
list are N adjacent inserts at one location, which the fold sends to a resolver — run-12
(2026-09-05, PR #662): five tasks each appended one `ADVISORY_RENDERS.append((…))` line to
`compile_plan.py`, the fold dispatched three resolver workers (3.4 worker-minutes, 6.6 of the
13-minute post-review tail) to order five lines any order would have satisfied — so give each
task its own region or file: a registration is a new file discovered by glob, never an
appended line. (3) `## Self-review` (line ~313 to the end of the file) gains one bullet,
placed anywhere in the list, saying every exam file is named for its behaviour surface and a
task that extends one groups its legs under a comment naming the task. The tests that pin
this file read fixed sentences elsewhere in it — the six `**Slot:**` names in order, the
species list under §The proof gate, the two §Global Constraints discipline sentences, the
execution-handoff rubric shared with `hooks/session_start.sh` (do not edit §Execution
handoff), `(derived)` and `plan-level Claim` under §Self-review, no `**Depends-on:**` or
`**Tier:**` in marker form, no `adversarial`, and whole-word counts of the three shouted
imperatives frozen at zero — so the new sentences add text and change none. The exam below
reads each section alone (`sed -n` from its heading to the next section's, whitespace runs squeezed to one space) and
pins each sentence's operative parts in order; the phrases inside the greps are the contract,
the wording around them is yours.
**BASE facts:** (generated at 4bd0f5c)
- `skills/ultrawrite/SKILL.md` blob 366683a
- `tests/test_ultrawrite_skill.py` blob 06edf94
- `tests/test_plan_level_claim.py` blob 994ffd2
- `tests/test_review_peer.py` blob f9f7991
- `tests/test_proof_modes_documented.py` blob 9359f16
- `tests/test_compile_plan_check_cost.py` blob ccaad8d
- `tests/test_compile_plan_prose_check.py` blob 565f715
- `tests/test_compile_plan_integration_hostile.py` blob c490a06
- `tests/test_marker_contract.py` blob 6c60f39
- `hooks/session_start.sh` blob a70c87d

**Proof:**
- Run: sed -n '/^### The six body slots/,/^## Elicit the claim/p' skills/ultrawrite/SKILL.md | tr -s '[:space:]' ' ' | grep -q 'one exam file per behaviou\?r surface.*named for it.*later task.*extends.*under a comment naming the task'
- The previous bullet reads only the six-slot section (from its heading to §Elicit the claim's), whitespace runs squeezed to one space, and pins the exam-file rule's parts in order — one file per surface, named for it, a later task extends it, legs under a comment naming the task [M1].
- Run: sed -n '/^### The six body slots/,/^## Elicit the claim/p' skills/ultrawrite/SKILL.md | tr -s '[:space:]' ' ' | grep -q 'one exam file per behaviou\?r surface'
- The previous bullet is the first row of the rule on its own — one exam file per behaviour surface — in the six-slot section [M1].
- Run: sed -n '/^### The six body slots/,/^## Elicit the claim/p' skills/ultrawrite/SKILL.md | tr -s '[:space:]' ' ' | grep -q 'later task.*extends'
- The previous bullet is the second row on its own — a later task extends the file — in the six-slot section [M1].
- Run: sed -n '/^### The six body slots/,/^## Elicit the claim/p' skills/ultrawrite/SKILL.md | tr -s '[:space:]' ' ' | grep -q 'under a comment naming the task'
- The previous bullet is the third row on its own — the legs under a comment naming the task — in the six-slot section [M1].
- Run: sed -n '/^### The six body slots/,/^## Elicit the claim/p' skills/ultrawrite/SKILL.md | tr -s '[:space:]' ' ' | grep -q 'byte-identical to BASE.*git show HEAD:.*tautology at the integration head.*frozen pre-edit literal.*40-hex sha.*git fetch --depth=1 origin.*depth'
- The previous bullet reads the same section and pins the frozen-literal rule's parts in order — the two tautological shapes, the tautology, the frozen pre-edit literal, the 40-hex sha, the fetch command, and the depth-1 reason [M2].
- Run: sed -n '/^### The six body slots/,/^## Elicit the claim/p' skills/ultrawrite/SKILL.md | grep -qF -- 'git fetch --depth=1 origin <sha>'
- The previous bullet is the fetch command in the six-slot section, exactly so — a fixed-string match of the whole command with its sha placeholder, which fails on a paraphrase or a dropped depth flag [M2].
- Run: sed -n '/^## Decomposition judgment/,/^## Global Constraints discipline/p' skills/ultrawrite/SKILL.md | tr -s '[:space:]' ' ' | grep -q 'Let same-file edits stand.*adjacent inserts at one location.*resolver.*own region or file.*registration is a new file.*never an appended line'
- The previous bullet reads only §Decomposition judgment, whitespace runs squeezed to one space, and pins the new sentence inside rule 4 — after its bold title, in order: adjacent inserts at one location, the resolver, own region or file, a registration is a new file, never an appended line [M3].
- Run: sed -n '/^## Decomposition judgment/,/^## Global Constraints discipline/p' skills/ultrawrite/SKILL.md | tr -s '[:space:]' ' ' | grep -q 'run-12.*five tasks.*three resolver workers'
- The previous bullet is run-12's numbers in the same section — five tasks' appends, three resolver workers [M3].
- Run: sed -n '/^## Self-review/,$p' skills/ultrawrite/SKILL.md | tr -s '[:space:]' ' ' | grep -q 'exam file is named for its behaviou\?r surface.*comment naming the task'
- The previous bullet reads only §Self-review (from its heading to the end of the file), whitespace runs squeezed to one space, and pins the new line's two parts in order [M4].
- Run: python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrawrite
- The previous bullet is the skill validator [M5].
- Run: python3 -m pytest -q -p no:cacheprovider tests/test_proof_modes_documented.py
- The previous bullet is the shouted-word count pin (BASE's zeros for the skill, frozen at 0a3559a) and the validator, re-run from the suite [M5].
- Run: python3 -m pytest -q -p no:cacheprovider tests/test_ultrawrite_skill.py tests/test_plan_level_claim.py tests/test_review_peer.py tests/test_compile_plan_check_cost.py tests/test_compile_plan_prose_check.py tests/test_compile_plan_integration_hostile.py tests/test_marker_contract.py
- The previous bullet is every other test that reads the skill's sentences — slot order, refused markers, the species list, the two Global Constraints discipline sentences, the Self-review tail, no adversarial — unchanged and green [M5].

**Stale-if:**
- path-absent: `skills/ultrawrite/SKILL.md`
- issue-closed: #609
- issue-closed: #665
