# The claims-v1 authoring gotchas move into ultrawrite

**Grammar:** claims-v1

**Claim:** `skills/ultrawrite/SKILL.md` (or a reference it names, e.g. `skills/ultrawrite/references/authoring-gotchas.md`, loaded by the self-review step) carries every lesson above that a compiler advisory does not already enforce, phrased as a rule with its one-line reason, so a fresh clone, a subagent author and a stranger operator get the same guidance the memory gives this one. (quoted from #683)

**Goal:** #683 — the 25 claims-v1 authoring lessons live in one operator's private memory
file; a fresh clone, a subagent author and a stranger operator cannot read it. After this run
`skills/ultrawrite/references/authoring-gotchas.md` carries every lesson the compiler does not
already enforce as a rule with its reason, and §Self-review of the skill loads it. #789 — three
of four author subagents on 2026-09-08 dispatched their gate readers in the background and the
verdicts went to the parent session; after this run §The proof gate says readers run in the
foreground, one call per task, and the author writes the record. #705 — the gate passed a
Claim whose pinned literal was arithmetically impossible; after this run the reader's one
question also asks whether every pinned literal is satisfiable under the clauses' own rules,
and self-review asks whether every pinned literal was computed. The three mechanical
candidates #683 names already exist in `compile_plan.py` at BASE (a `Run:` carrying a
backtick is a grammar refusal; `suite-total-pin` and `directory-absence-pin` are advisories),
so the compiler is untouched and the reference points at them by name. The memory file's own
reduction is the laptop's business, outside this run.
**Closes:** #683 #789 #705

**Tech Stack:** Markdown skill documents (`skills/ultrawrite/SKILL.md`, a new
`skills/ultrawrite/references/authoring-gotchas.md`); the proofs are shell (`sed`, `tr`,
`grep`, `test`) over those files plus `python3 skills/ultrapowers/scripts/validate_skill.py`
and `python3 -m pytest` on the tests that already read the skill. No code moves.

**Parallelization rationale:** wave 1 is three tasks, width 3, no chain. All three edit
`skills/ultrawrite/SKILL.md`, and same-file text edits fold; each task owns its own region so
no two land adjacent inserts at one location — Task 1 writes the new reference file and a
paragraph directly under the `## Self-review` heading (before its first bullet); Task 2
rewrites the paragraph of §The proof gate that opens `Dispatch is **per task**`; Task 3
rewrites the sentence of §The proof gate that opens `One fresh-context subagent per task`
and appends the last bullet of §Self-review. No task consumes another's runtime behaviour.

## Global Constraints

- Check: `git diff --quiet $ULTRA_BASE -- fleet/ tests/ skills/ultrapowers/`
- Check: `test "$(grep -c -w -e NEVER -e ALWAYS -e MUST skills/ultrawrite/SKILL.md)" = 0`
- The skill addresses the authoring agent in the register it already has: rules, each with the
  reason that makes it a rule, never a shouted imperative — `tests/test_ultrawrite_surface_rules_implementer_check.py`
  pins the three shouted words at zero in `SKILL.md`, and the reference keeps the same voice.
- Every lesson in `references/authoring-gotchas.md` is a rule with its one-line reason, naming
  the run or sitting that cost it; a lesson the compiler already enforces names the advisory
  species or refusal it became, so an author learns to read the compiler's line rather than
  re-learning the rule.
- `skills/ultrawrite/SKILL.md` keeps every section heading it has at BASE, in order, and every
  sentence a test already pins: the `**Claim:**`-line paragraph opening `Above the first
  task:`, the six-slot Proof bullet, rule 4 of §Decomposition judgment, the species sentence
  and the compile line of §The proof gate, and §Self-review's `(derived)` and `plan-level
  Claim` words.

**Acceptance:** suite — the committed suite is the verification.

### Task 1: The authoring gotchas are a reference the self-review step loads

**Type:** implementation
**Review:** peer

**Files:**
- Create: `skills/ultrawrite/references/authoring-gotchas.md`
- Modify: `skills/ultrawrite/SKILL.md`

**Claim:** `skills/ultrawrite/SKILL.md` (or a reference it names, e.g. `skills/ultrawrite/references/authoring-gotchas.md`, loaded by the self-review step) carries every lesson above that a compiler advisory does not already enforce, phrased as a rule with its one-line reason, so a fresh clone, a subagent author and a stranger operator get the same guidance the memory gives this one. (quoted from #683)
Machine: M1. `skills/ultrawrite/references/authoring-gotchas.md` exists and carries, for
each of the eleven rows of the migration list, that row's operative phrases: row 1 `folded
tree` and `run-72`; row 2 `backtick`, `command substitution` and `run-74`; row 3 `never see
Context` and `run-75`; row 4 each of `one leg per row`, `named exclusions`, `ALL TESTS
PASSED`, `decorator`, `for each of`, `sed -n`, `two triggers`, `negative row` and `existing
fixture`; row 5 `collect-only`, `__pycache__` and `run-4,`; row 6 `own Files`, `fix round` and
`run-2,`; row 7 `plan-level Claim` and `authorship`; row 8 `git grep`, `fleet/tests/`,
`run-8`, `frozen sim` and `byte-pins`; row 9 `field name` and `run-10`; row 10
`merge(main, branch)`; row 11 `rejection rounds`, `whitespace`, `verbatim substring` and
`asterisks`.
M2. The reference carries its lessons as top-level bullets opening `- **` — the rule in
bold, its reason after it in the same bullet — and there are at least eleven such bullets.
M3. The reference names the three mechanical checks the compiler already carries — the
species `suite-total-pin` and `directory-absence-pin` and the refusal wording
`command carries a backtick` — so a lesson the compiler enforces points at the compiler's
own line.
M4. §Self-review of `skills/ultrawrite/SKILL.md` — the text from the `## Self-review` heading
to the end of the file — names `references/authoring-gotchas.md` in a paragraph that sits
directly under the heading, before the section's first `- ` bullet, and says the reference is
read before the readers are dispatched.
M5. `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrawrite` exits 0 and
prints `skill ok`, so every `references/<file>` the skill names exists.

**Authorized-by:** #683 (operator, 2026-09-05: "the claims V1 gotchas are stored in memory rather than durably in skill instruction. This is brittle."); #670 landed at `6c050bb4`, the sequencing #683 asked for.

**Interfaces:**
- Consumes: none
- Produces: `skills/ultrawrite/references/authoring-gotchas.md`

**Context:** BASE is `1c97ba44` (v0.3.21). `skills/ultrawrite/references/` holds one file,
`greenfield-stack.md`, and `SKILL.md` names it once (line 276, `references/greenfield-stack.md`)
— that is the idiom for naming a reference, and `validate_skill.py` resolves every
`references/<name>.md` the body names against the skill directory and fails on a missing one.
At BASE `grep -c 'authoring-gotchas' skills/ultrawrite/SKILL.md` is `0`, and §Self-review
(line 376 to the end) is a heading followed directly by ten `- ` bullets and no paragraph.
`SKILL.md` is 3,992 words; sizes are reported, not gated (#492/#496).

The reference is loaded by the self-review step: write one short paragraph directly under
`## Self-review`, before the first bullet, saying that the author reads
`references/authoring-gotchas.md` — the lessons every claims-v1 sitting since run-45 paid
for — before the readers are dispatched, and checks the plan against each. Task 3 of this
plan appends a bullet at the END of the same section; the paragraph sits at its top, so the
two edits fold.

Two other tasks of this plan edit §The proof gate of `SKILL.md`; this task does not touch
that section.

What the compiler already enforces, so the reference points at it rather than restating it
(`compile_plan.py --check --renders` at BASE): a `Run:` or `Check:` command carrying a
backtick is a grammar REFUSAL, `grammar: Run: command carries a backtick — … the driver's
shell reads it as a command substitution (run-74)`; and the `ADVISORY proof-species:` family
is `run-chained-semicolon`, `leg-named-in-prose`, `default-unpinned`,
`universal-as-count-floor`, `duration-without-clock`, `suite-total-pin`
(`--collect-only` compared against a bare integer), `directory-absence-pin` (`test ! -e <dir>`
on a path whose last segment has no dot), `pinned-elsewhere`, `check-cost`, `prose-check`,
`wide-files`, `wide-contract`, `threshold-one-sided`, `disjunct-without-leg`,
`base-sha-in-suite`, plus the citation refusals (an uncited clause, an uncited leg, a
citation of a clause that does not exist) and the two judgment advisories (a universal or
negation clause with no leg naming what fails; an enumerated clause with fewer legs than
rows).

The migration list — the lesson text the reference carries, one bullet per row, the rule in
bold and the reason after it. The sandbox cannot read the memory file, so this is the source:

1. **Every wave leaves the folded tree green.** A wave-1 producer that deletes or renames a
   symbol whose consumers are a wave-2 rewrite turns the wave-1 folded suite red by
   construction — the old consumers still import the old name — and a doc↔code pin (doctor
   `ROW_IDS` ↔ `first-run.md` headings) split across waves does the same; the engine gates
   every wave's folded tree with the full suite, so "the consumer rewrites it next wave" is
   not a plan. Keep the old export as a shim in the producer's task, or put the consumers in
   the producer's wave and let same-file text fold; keep both halves of any pin in one wave
   (run-72, 2026-09-04).
2. **No backticks inside a `Run:` command.** The compiler strips only a whole-value backtick
   wrapper; an inner backtick reaches `bash -lc` as a command substitution and the proof exits
   127, and the fix loop cannot repair a proof it does not own, so the task dies
   `fix-loop-exhausted` with a correct patch. Grep for the word, never for the backticked
   literal. Since 0.3.10 the compiler refuses it outright: `command carries a backtick`
   (run-74, 2026-09-04).
3. **The gate readers never see Context, so read every ordered Machine clause against every
   measured fact in the same task's Context before dispatching readers.** A clause that
   started a status server before waiting for the user bus — the exact race the Context had
   measured — passed nine rounds and was caught as `plan-defect` by both referees; a clause
   that orders a `--user` call names the bus precondition (run-75, 2026-09-04).
4. **The gate's recurring rejection species, each with its fix** (19 of 33 dispatches on
   2026-09-04, 18 of 25 on 2026-09-05, every rejection correct): an ENUMERATED clause ("X, Y
   and Z are gone") needs one leg per row — a count-and-pass pin lets one row survive; a
   UNIVERSAL sentence ("no file under tests/…") with a per-file exam is rejected — sweep the
   whole tree with named exclusions, or narrow the derived Claim to the files the task owns;
   `node sim.mjs` exiting 0 is not the sentinel — pipe into `grep -q 'ALL TESTS PASSED'`;
   "finishes quickly" needs a clock (`timeout 60 node …`); a timing threshold wants both
   sides, with durations that separate sum from max; pin a decorator to its def
   (`grep -B3 'def x' | grep -q 'scope="session"'`), never with a bare presence grep; an
   enumerated VALUE list (`low|medium|high`) needs one leg per value — write the leg as
   "for each of …"; a whole-file `grep -q` for a doc sentence is rejected every time — scope
   it with `sed -n '/^## A/,/^## B/p' … | tr '\n' ' ' | grep -q 'part one.*part two'` and pin
   the sentence's operative halves in order; a clause with two triggers needs a leg per
   trigger; "no reply" and BLOCKED are two rows; two independent conditions (path AND phrase)
   need a negative row for each — a row lacking both falsifies neither; a rule that would fire
   on an existing fixture is a plan defect — read the sibling fixture before writing the
   clause; and `leg (e)` written inside another leg's prose splits the leg even when (e) is
   another file's leg — say "the previous leg" or "its frozen-sha comparison". The compiler
   names the mechanical half of these as `ADVISORY proof-species:` lines; read them before a
   reader is dispatched.
5. **Absolute collected-count pins are integration-hostile.** `test "$(pytest --collect-only
   -q | tail -1 | cut -d' ' -f1)" = 1461` passes in the task's clone and fails on the adopted
   tree, where every merged `Run:` is re-run and every sibling's deletions have folded in —
   five blocking findings on a correct tree. Pin per-file counts (`--collect-only -q <file> |
   grep -c ::`) or state the delta; never the suite total. Likewise `test ! -e tests/<dir>`
   fails on a `__pycache__` survivor in the integration clone — pin the source files. The
   compiler names both: `suite-total-pin`, `directory-absence-pin` (run-4, 2026-09-04).
6. **Every file a task must touch is in its own Files, even a sibling's one-liner.** A
   compelled edit outside Files was ruled lawful in review round 1, reverted by the fix round
   told to "resolve every blocking issue", blocked in round 2, and the task died
   `fix-loop-exhausted`; same-file text folds, so listing the file costs nothing (run-2,
   2026-09-04).
7. **Never a process or authorship sentence in the plan-level Claim.** "Every task's exam was
   written by a peer before the implementer started" parked an otherwise clean run as
   `deferred:external`: the critic reads the TREE, and no tree shows authorship order — that
   fact lives in the run record. The Claim is do:/see: about the product; the process is the
   engine's to record (walk run-3, 2026-09-04).
8. **A behaviour change owns every existing pin of it.** Before dispatch, `git grep` the
   literal a clause replaces across `tests/` and `fleet/tests/` and list every hit in the
   task's Files — an unlisted pin of the old value was run-8's one blocking finding. Two
   siblings of the same species: a clause can contradict a frozen sim the plan also names as
   a `Run:` (both cannot pass — read every sim a Proof invokes for the shape it pins before
   writing a rendering clause), and the corpus byte-pins freeze advisory TEXT, not only the
   vocabulary, so a reworded advisory line needs its frozen sha re-pinned outside the
   compiler task's Files (run-8, 2026-09-04).
9. **Check every field name a Context names against the report format.** A Context that
   wrote `report.review.findings` for what is `completenessFindings` made the examiner mark
   the leg unsatisfiable and adapt (run-10, 2026-09-05).
10. **Two concurrent runs on disjoint Files can conflict on a seam.** One run's new test drove
    the other's changed label routing, and only CI on the merge commit caught it; run the
    fleet bridge on `merge(main, branch)` before arming the second auto-merge (2026-09-05).
11. **Expect and budget for rejection rounds — a zero-streak indicts the gate, not the
    plan.** Whitespace edits to Claim or Proof change the hash and re-dispatch, even a
    line-wrap fix; re-dispatch per task as verdicts land, not per round. And the provenance
    quote is trusted to no eyeball check: a `quoted from #NNN` claim is a verbatim substring
    of the raw issue body, markdown asterisks and backticks included (run-45, 2026-09-01).

Three older lessons belong in the same file, after the eleven: **quote desired-state
sentences, never diagnosis sentences** (an issue's "today X happens" as the Claim is rendered
false by a passing exam; the skill's elicitation section says so, and the instinct to quote the
vivid line is strong); **the exam's quantifier matches the claim's** ("some swallows stay"
needs an exam asserting at least one survives, and an exam broader than the claim — any
`raise` where the claim names `FailedLookup` — fails too; loosen the claim or tighten the exam,
deliberately); and **two plan-defect species of run-45**: an exam/Files enumeration mismatch (a
glob exam over a directory the Files block under-enumerates) and a contract assuming a consumed
function's behaviour (raising vs advisory).

**Proof:**
- Legs: (a) the reference exists — the first `Run:` [M1];
  (b) for each of the eleven rows of M1, one `Run:` (the second through the twelfth) greps the
  reference for every operative phrase of that row, joined with `&&`, so a row written without
  its rule or its run fails its own command — row 10's phrase carries parentheses and is
  matched with `grep -F`, and rows 5 and 6 pin `run-4,` and `run-2,` with their commas so the
  `run-45` of row 11 and the `run-25` of no row cannot stand in for them; at BASE the file is absent and every one of them fails [M1];
  (c) the count of lines opening `- **` in the reference is at least eleven — the thirteenth
  `Run:`; a file that carries the lessons as prose paragraphs, or as fewer bullets than rows,
  fails it [M2];
  (d) the reference names `suite-total-pin`, `directory-absence-pin` and the refusal wording
  `command carries a backtick` — the fourteenth `Run:`; a file that restates rules 2 and 5
  without naming what the compiler prints fails it [M3];
  (e) the text from `## Self-review` to the end of `SKILL.md`, up to its first `- ` bullet,
  names `references/authoring-gotchas.md` and the words `before` and `dispatched` in that
  order — the fifteenth `Run:`, which cuts the section at its first bullet so a pointer added
  as a bullet or below the list fails it; at BASE the cut is the bare heading and the command
  fails [M4];
  (f) `validate_skill.py skills/ultrawrite` exits 0 and prints exactly `skill ok` — the
  sixteenth `Run:`; a `references/` name in the skill with no file behind it fails it [M5].
- Run: test -f skills/ultrawrite/references/authoring-gotchas.md
- Run: grep -q 'folded tree' skills/ultrawrite/references/authoring-gotchas.md && grep -q 'run-72' skills/ultrawrite/references/authoring-gotchas.md
- Run: grep -q 'backtick' skills/ultrawrite/references/authoring-gotchas.md && grep -q 'command substitution' skills/ultrawrite/references/authoring-gotchas.md && grep -q 'run-74' skills/ultrawrite/references/authoring-gotchas.md
- Run: grep -q 'never see Context' skills/ultrawrite/references/authoring-gotchas.md && grep -q 'run-75' skills/ultrawrite/references/authoring-gotchas.md
- Run: grep -q 'one leg per row' skills/ultrawrite/references/authoring-gotchas.md && grep -q 'named exclusions' skills/ultrawrite/references/authoring-gotchas.md && grep -q 'ALL TESTS PASSED' skills/ultrawrite/references/authoring-gotchas.md && grep -q 'decorator' skills/ultrawrite/references/authoring-gotchas.md && grep -q 'for each of' skills/ultrawrite/references/authoring-gotchas.md && grep -q 'sed -n' skills/ultrawrite/references/authoring-gotchas.md && grep -q 'two triggers' skills/ultrawrite/references/authoring-gotchas.md && grep -q 'negative row' skills/ultrawrite/references/authoring-gotchas.md && grep -q 'existing fixture' skills/ultrawrite/references/authoring-gotchas.md
- Run: grep -q 'collect-only' skills/ultrawrite/references/authoring-gotchas.md && grep -q '__pycache__' skills/ultrawrite/references/authoring-gotchas.md && grep -q 'run-4,' skills/ultrawrite/references/authoring-gotchas.md
- Run: grep -q 'own Files' skills/ultrawrite/references/authoring-gotchas.md && grep -q 'fix round' skills/ultrawrite/references/authoring-gotchas.md && grep -q 'run-2,' skills/ultrawrite/references/authoring-gotchas.md
- Run: grep -q 'plan-level Claim' skills/ultrawrite/references/authoring-gotchas.md && grep -q 'authorship' skills/ultrawrite/references/authoring-gotchas.md
- Run: grep -q 'git grep' skills/ultrawrite/references/authoring-gotchas.md && grep -q 'fleet/tests/' skills/ultrawrite/references/authoring-gotchas.md && grep -q 'run-8' skills/ultrawrite/references/authoring-gotchas.md && grep -q 'frozen sim' skills/ultrawrite/references/authoring-gotchas.md && grep -q 'byte-pins' skills/ultrawrite/references/authoring-gotchas.md
- Run: grep -q 'field name' skills/ultrawrite/references/authoring-gotchas.md && grep -q 'run-10' skills/ultrawrite/references/authoring-gotchas.md
- Run: grep -F -q 'merge(main, branch)' skills/ultrawrite/references/authoring-gotchas.md
- Run: grep -q 'rejection rounds' skills/ultrawrite/references/authoring-gotchas.md && grep -q 'whitespace' skills/ultrawrite/references/authoring-gotchas.md && grep -q 'verbatim substring' skills/ultrawrite/references/authoring-gotchas.md && grep -q 'asterisks' skills/ultrawrite/references/authoring-gotchas.md
- Run: test "$(grep -c '^- \*\*' skills/ultrawrite/references/authoring-gotchas.md)" -ge 11
- Run: grep -q 'suite-total-pin' skills/ultrawrite/references/authoring-gotchas.md && grep -q 'directory-absence-pin' skills/ultrawrite/references/authoring-gotchas.md && grep -q 'command carries a backtick' skills/ultrawrite/references/authoring-gotchas.md
- Run: sed -n '/^## Self-review/,$p' skills/ultrawrite/SKILL.md | sed '/^- /,$d' | tr -s '[:space:]' ' ' | grep -q 'references/authoring-gotchas.md.*before.*dispatched'
- Run: test "$(python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrawrite)" = "skill ok"

**Stale-if:**
- issue-closed: #683
- path-absent: `skills/ultrawrite/SKILL.md`
- path-exists: `skills/ultrawrite/references/authoring-gotchas.md`

### Task 2: The gate readers run in the foreground and the author writes the record

**Type:** implementation

**Files:**
- Modify: `skills/ultrawrite/SKILL.md`

**Claim:** `skills/ultrawrite/SKILL.md`'s reader-dispatch step says the readers are run in the foreground (`run_in_background: false`), one call per task, so the verdict returns to the author that dispatched it; and the verdicts record is written by the author from the returned verdict, never by the reader. (quoted from #789)
Machine: M1. §The proof gate of `skills/ultrawrite/SKILL.md` — the text from the
`## The proof gate` heading to the `## The worktree-pure contract` heading — says the readers
are dispatched with the Agent tool in the foreground, spelling the literal
`run_in_background: false`, and says `one call per task`, and says the verdict returns to the
author that dispatched it.
M2. The same section says the verdicts record `<plan-stem>.gate-verdicts.json` is written by
the author from the returned verdict and `never by the reader`.
M3. Both sentences sit in the paragraph of §The proof gate that opens `Dispatch is **per
task**, not per round`, and that paragraph keeps its per-task re-dispatch rule and its
2026-09-04 measurement.
M4. `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrawrite` exits 0 and
prints `skill ok`.

**Authorized-by:** #789 (observed 2026-09-08, four concurrent author subagents: three dispatched readers in the background and their verdicts reached the parent session); #553 (the reader is a fresh-context subagent).

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** BASE is `1c97ba44` (v0.3.21). At BASE, §The proof gate (`SKILL.md` lines
193–252) contains none of `run_in_background`, `foreground`, `one call per task` or
`never by the reader` — each scoped grep counts `0`. The section's paragraph opening
`Dispatch is **per task**, not per round` (lines 220–226) is the reader-dispatch step: it says
a task whose verdict lands first gets its next reader the moment its Claim or Proof is edited,
re-extract that one task, dispatch one reader for it, do not wait for the round's other
verdicts, and cites the 2026-09-04 measurement (four wide rounds took 13 of the 22 minutes).
This task rewrites that paragraph and nothing else in the section: Task 3 of this plan
rewrites the section's first sentence (`One fresh-context subagent per task, asked one
question: …`), and Task 1 writes a paragraph under `## Self-review`; the three regions are
separated by whole paragraphs, so the same-file edits fold.

What the paragraph says after this task, in the skill's own register: the reader is dispatched
with the Agent tool, `subagent_type: "general-purpose"`, `run_in_background: false`, one call
per task — several such calls may share one message, but none is backgrounded — because a
backgrounded reader's verdict is delivered to the session that spawned the author, not to the
author, who then stops to wait for a message that never comes (2026-09-08: three of four
concurrent authors, each resumed by hand with the verdict pasted in, two of them with no
`.gate-verdicts.json` written). The reader answers with its verdict line and one sentence; the
author writes `<plan-stem>.gate-verdicts.json` from that returned verdict, never the reader —
the reader sees only the extractor's output and has no plan path to write beside. The
`tests/` that read this section pin its species sentence and its compile line
(`tests/test_compile_plan_integration_hostile.py`, `tests/test_compile_plan_base_tree.py`,
`tests/test_compile_plan_check_cost.py`), none of which is in this paragraph.

**Proof:**
- Legs: (a) §The proof gate, wrapped lines joined, carries the literal
  `run_in_background: false` — the first `Run:`, a fixed-string grep; and carries
  `foreground` — the second; and carries `one call per task` — the third; and carries, in
  order, `verdict` then `returns` then `author` — the fourth; at BASE the section has none of
  the first three, so each fails there, and a sentence that names foreground without the
  literal, or the literal without saying to whom the verdict returns, fails one of the four
  [M1];
  (b) the same section carries `written by the author` and `never by the reader` in that
  order — the fifth `Run:`; a rewrite that says who runs the reader but not who writes the
  record fails it [M2];
  (c) the paragraph that opens `Dispatch is **per task**` — cut from that opening to the next
  blank line — itself carries `Agent tool`, `run_in_background: false` and `never by the
  reader` (the sixth `Run:`) and still carries `re-extract`, `one reader`, and `13 of the 22 minutes` (the
  seventh); the literals written in another paragraph of the section, or the paragraph's
  original rule dropped, fail one of the two [M3];
  (d) `validate_skill.py skills/ultrawrite` prints exactly `skill ok` — the eighth `Run:` [M4].
- Run: sed -n '/^## The proof gate/,/^## The worktree-pure contract/p' skills/ultrawrite/SKILL.md | tr -s '[:space:]' ' ' | grep -F -q 'run_in_background: false'
- Run: sed -n '/^## The proof gate/,/^## The worktree-pure contract/p' skills/ultrawrite/SKILL.md | tr -s '[:space:]' ' ' | grep -q 'foreground'
- Run: sed -n '/^## The proof gate/,/^## The worktree-pure contract/p' skills/ultrawrite/SKILL.md | tr -s '[:space:]' ' ' | grep -q 'one call per task'
- Run: sed -n '/^## The proof gate/,/^## The worktree-pure contract/p' skills/ultrawrite/SKILL.md | tr -s '[:space:]' ' ' | grep -q 'verdict.*returns.*author'
- Run: sed -n '/^## The proof gate/,/^## The worktree-pure contract/p' skills/ultrawrite/SKILL.md | tr -s '[:space:]' ' ' | grep -q 'written by the author.*never by the reader'
- Run: sed -n '/^Dispatch is \*\*per task\*\*/,/^$/p' skills/ultrawrite/SKILL.md | tr -s '[:space:]' ' ' | grep -q 'Agent tool' && sed -n '/^Dispatch is \*\*per task\*\*/,/^$/p' skills/ultrawrite/SKILL.md | tr -s '[:space:]' ' ' | grep -F -q 'run_in_background: false' && sed -n '/^Dispatch is \*\*per task\*\*/,/^$/p' skills/ultrawrite/SKILL.md | tr -s '[:space:]' ' ' | grep -q 'never by the reader'
- Run: sed -n '/^Dispatch is \*\*per task\*\*/,/^$/p' skills/ultrawrite/SKILL.md | tr -s '[:space:]' ' ' | grep -q 're-extract' && sed -n '/^Dispatch is \*\*per task\*\*/,/^$/p' skills/ultrawrite/SKILL.md | tr -s '[:space:]' ' ' | grep -q 'one reader' && sed -n '/^Dispatch is \*\*per task\*\*/,/^$/p' skills/ultrawrite/SKILL.md | tr -s '[:space:]' ' ' | grep -q '13 of the 22 minutes'
- Run: test "$(python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrawrite)" = "skill ok"

**Stale-if:**
- issue-closed: #789
- path-absent: `skills/ultrawrite/SKILL.md`

### Task 3: The reader computes every pinned literal

**Type:** implementation

**Files:**
- Modify: `skills/ultrawrite/SKILL.md`

**Claim:** The gate reader's one question gains a clause: *every concrete literal a Machine clause pins is satisfiable under the clauses' own rules — compute it.* (quoted from #705)
Machine: M1. The first sentence of §The proof gate of `skills/ultrawrite/SKILL.md` — the one
opening `One fresh-context subagent per task, asked one question:` — carries, in order, the
words `necessarily true`, `at the right layer`, `every concrete literal`, `satisfiable`, and
`compute it`, so the question the author puts to a reader asks both halves.
M2. §Self-review of `skills/ultrawrite/SKILL.md` — the text from the `## Self-review` heading
to the end of the file — carries a bullet with the words `every pinned literal was computed,
not assumed`, and that bullet is the section's last bullet.
M3. `skills/ultrawrite/scripts/extract_gate_input.py` is unchanged from BASE: its printed
payload is `{"task", "claim", "proof", "hash"}` and carries no reader question at BASE, so the
clause has no header line to join there.
M4. `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrawrite` exits 0 and
prints `skill ok`.

**Authorized-by:** #705 (walk run-10, 2026-09-05: the gate passed `countVowels('Ada Lovelace')` is `4`, which is `6` under the plan's own M1/M2, and the engine spent a run to find it); #551 (the plan is a submission; the gate as editor).

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** BASE is `1c97ba44` (v0.3.21). At BASE the first sentence of §The proof gate
(`SKILL.md` line 195) reads: `One fresh-context subagent per task, asked one question: *if
this exam passes, is the sentence necessarily true, at the right layer?* Layer mismatch means
no compile until the task is revised.` — and the section contains no `satisfiable` and no
`compute it` (scoped grep counts `0`). `extract_gate_input.py` prints
`{"task", "claim", "proof", "hash"}` for `--task` and `{"claim", "tasks", "hash"}` for
`--plan`; its module docstring describes the cap and never states the reader's question, so
the issue's conditional ("if it carries the question") is answered no at BASE — the file is
not in this task's Files and the third `Run:` pins it unchanged. §Self-review (line 376 to the
end) is ten `- ` bullets, the last of which opens `- The ` and names the `**Closes:**` line;
at BASE `computed, not assumed` is absent from the section.

This task rewrites the section's first sentence so the question reads, in the skill's italic
form, as: *if this exam passes, is the sentence necessarily true, at the right layer? And is
every concrete literal a Machine clause pins satisfiable under the clauses' own rules — compute
it.* — with one sentence of reason beside it: on walk run-10 a Claim pinned `4` vowels in `Ada
Lovelace`, `6` under its own M1/M2, and the reader passed leg shape without computing the
number; a reader asked exactly this on the re-read computed six and passed the corrected
plan. Then it appends, as the last bullet of §Self-review, a bullet saying every pinned
literal was computed, not assumed — the author ran the command or did the arithmetic at BASE
and pasted the result, never a number it expected.

Two other tasks of this plan edit `SKILL.md`: Task 2 rewrites the paragraph of §The proof
gate that opens `Dispatch is **per task**`, and Task 1 writes a paragraph directly under the
`## Self-review` heading, above the bullets. This task touches neither region: the first
sentence of §The proof gate and the last bullet of §Self-review are each separated from those
by whole paragraphs, so the three tasks' same-file edits fold. The species sentence and the
compile line of §The proof gate are pinned by `tests/test_compile_plan_integration_hostile.py`
and `tests/test_compile_plan_base_tree.py`; §Self-review's `(derived)` and `plan-level Claim`
words by `tests/test_plan_level_claim.py` — all kept.

**Proof:**
- Legs: (a) §The proof gate, wrapped lines joined and cut at its first sentence ending in
  `revised.`, carries in order `necessarily true`, `at the right layer`, `every concrete
  literal`, `satisfiable`, `compute it` — the first `Run:`; at BASE the section has no
  `satisfiable` and fails; a clause added elsewhere in the section, or one that says
  "satisfiable" without "compute it", fails it [M1];
  (b) the last `- ` bullet of §Self-review — every line from the last line opening `- ` to
  the end of the file, joined by `awk` into one bullet — carries `every pinned literal was
  computed, not assumed` — the second `Run:`; a bullet placed anywhere but last, or worded
  "checked" instead of "computed", fails it [M2];
  (c) with `$ULTRA_BASE` set — the third `Run:` fails when it is empty, so the leg cannot pass
  vacuously on an index-to-worktree diff — `git diff --quiet $ULTRA_BASE --
  skills/ultrawrite/scripts/extract_gate_input.py` exits 0; any edit to the extractor fails it
  [M3];
  (d) `validate_skill.py skills/ultrawrite` prints exactly `skill ok` — the fourth `Run:`
  [M4].
- Run: sed -n '/^## The proof gate/,/^## The worktree-pure contract/p' skills/ultrawrite/SKILL.md | tr -s '[:space:]' ' ' | sed 's/revised\..*//' | grep -q 'necessarily true.*at the right layer.*every concrete literal.*satisfiable.*compute it'
- Run: sed -n '/^## Self-review/,$p' skills/ultrawrite/SKILL.md | awk '/^- /{n++} {b[n]=b[n] " " $0} END{print b[n]}' | tr -s '[:space:]' ' ' | grep -q 'every pinned literal was computed, not assumed'
- Run: test -n "$ULTRA_BASE" && git diff --quiet "$ULTRA_BASE" -- skills/ultrawrite/scripts/extract_gate_input.py
- Run: test "$(python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrawrite)" = "skill ok"

**Stale-if:**
- issue-closed: #705
- path-absent: `skills/ultrawrite/SKILL.md`
- path-absent: `skills/ultrawrite/scripts/extract_gate_input.py`
