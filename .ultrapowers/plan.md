# The three authoring-queue rules the 2026-09-17 drain paid for, written where an author reads them

**Grammar:** claims-v1

**Claim:** do: open the authoring skill and its gotchas file after the run; see: the queue section tells an author to bundle plans that would create one path, to prefix their gate diets with the plan's own name, and the gotchas carry a sixteenth row on the shared fake that over-counts after a fold, so the next drain does not pay the three rounds the September 17 drain paid. (elicited)
**Summary:** This is the three rules the September 17 drain paid for, written into the skill that authors plans. It exists because six plans authored at once cost a resolver conflict on a file two of them created, three misfed gate verdicts from a shared scratchpad, and a red publish fold from an exam that counted calls on a shared fake. You get an authoring skill that says each rule where an author reads it, and it is the first plan the Jev factory drives on its own.

**Goal:** #1116's three rules, each in the file its sentence names: rules 1 and 2 in `skills/ultrawrite/SKILL.md` §Authoring a queue, rule 3 as the sixteenth row of `skills/ultrawrite/references/authoring-gotchas.md` with the one test that pins that file's row count moved with it. The issue also names `fleet/roles/examiner.md` for rule 3; that file is the old engine's and goes with it after five green factory runs, so it is not touched here, and the factory's own `factory/roles/exam.md` gets the sentence in a later factory plan rather than in the first plan the factory drives. Nothing under `fleet/` or `factory/` moves. Read at authoring (2026-09-18, `factory/engine.mjs` at `5afa13fe`): the factory engine executes a task's exam command only — it runs no `Run:` line and no `Check:` line and sets no `ULTRA_BASE` — so on the factory these two tasks are graded by Jev over their clauses and hunks alone, and the `Run:` lines below are the reviewer's and the operator's reading, not a gate. That is what this first run measures.
**Closes:** #1116

**Tech Stack:** Markdown prose in two skill files; Python 3 for the one pytest file that pins the gotchas row count (`tests/test_compile_plan_exam_sweep.py`). Every proof is a `Run:` line over the text.
Spec: none — the issue is the record (its three numbered paragraphs, each with the run that cost it).

**Parallelization rationale:** one wave, two wide. The two tasks share no file and each carries its own contract: the queue section and the gotchas file are read by different steps of the sitting. No chain.

## Global Constraints

- A rule is stated where the author reads it, in the register the surrounding text already uses: a reason in one sentence, the run or sitting that cost it in parentheses. No new heading, no new file.
- Check: test -n "$ULTRA_BASE" && git diff --quiet $ULTRA_BASE -- fleet factory skills/ultrapowers
- The `fleet/` and `factory/` freeze above is the rollback rule: the old engine is untouched until five green factory runs, and the factory's own files are not changed by the first plan it drives.

### Task 1: The queue section says to bundle by `Create:` paths and to prefix the gate diets

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `skills/ultrawrite/SKILL.md`

**Claim:** partition by `Create:` paths as well as by files — two plans that would create one path go in one bundle, or the second declares `Consumes:` on the first and launches after it. (quoted from #1116)
Machine: M1. The text of `skills/ultrawrite/SKILL.md` between the line `## Authoring a queue` and the next line beginning `## ` carries, in this order, the phrases `partition by` then `Create:` then `two plans that would create one path go in one bundle` then `Consumes:` then `launches after it`, with the phrase `Create:` appearing before `as well as by files`. M2. The same section carries the literal `<issue>-gate-<t>.json` and, in the same sentence, the word `prefix`, saying that an author's gate diet filenames carry the plan's own prefix. M3. Nothing outside that section changes: the file's line count grows by at most 12 over the file at `$ULTRA_BASE`, and the text before `## Authoring a queue` and from the next `## ` heading on is byte-identical to the file at `$ULTRA_BASE`, the run's base sha the driver sets in every `Run:`'s environment; a `Run:` reading it fails when the variable is unset.

**Authorized-by:** #1116 (rules 1 and 2, the 2026-09-17 drain: #1095/#1096's create/create pair, and author-1096's three misfed verdicts)

**Interfaces:**
- Consumes: none
- Produces: nothing

**Context:** The section at BASE is two paragraphs (lines 263–279 of the file): the first says a queue drains by partitioning by files into disjoint bundles, one author subagent per bundle; the second holds the operator to one Claim confirmation and one execute choice and says launches stay serial. Rule 1 belongs in the first paragraph, right after the sentence about same-file edits folding inside one run, because it is that sentence's exception: same-file edits fold, two creations of one path do not (#1095 and #1096 both listed `Create: fleet/jev-client.mjs`, and the operator serialized them by hand). Rule 2 belongs beside "dispatches its own fresh gate readers per task": each author's `extract_gate_input.py` output is written to the session scratchpad, and six authors writing `gate-<t>.json` collided (author-1096's round-2 readers read a sibling's diet for tasks 2–4; three verdicts discarded). The whole file is the operator-facing skill: keep the sentences in its register, with the drain named as the reason. M3's byte-identical halves are checked by the reviewer against BASE; the implementer edits only inside the section.

**Proof:**
- Run: sed -n '/^## Authoring a queue/,/^## The proof gate/p' skills/ultrawrite/SKILL.md | tr '\n' ' ' | grep -q 'partition by .Create:. paths as well as by files.*two plans that would create one path go in one bundle.*declares .Consumes:. on the first and launches after it'
- Run: sed -n '/^## Authoring a queue/,/^## The proof gate/p' skills/ultrawrite/SKILL.md | tr '\n' ' ' | grep -qE '[^.]*prefix[^.]*<issue>-gate-<t>\.json|[^.]*<issue>-gate-<t>\.json[^.]*prefix'
- Run: test -n "$ULTRA_BASE" && test $(( $(wc -l < skills/ultrawrite/SKILL.md) - $(git show $ULTRA_BASE:skills/ultrawrite/SKILL.md | wc -l) )) -le 12
- Run: test -n "$ULTRA_BASE" && diff <(sed -n '1,/^## Authoring a queue/p' skills/ultrawrite/SKILL.md) <(git show $ULTRA_BASE:skills/ultrawrite/SKILL.md | sed -n '1,/^## Authoring a queue/p')
- Run: test -n "$ULTRA_BASE" && diff <(sed -n '/^## The proof gate/,$p' skills/ultrawrite/SKILL.md) <(git show $ULTRA_BASE:skills/ultrawrite/SKILL.md | sed -n '/^## The proof gate/,$p')
- Legs: (a) the first `Run:` establishes the five phrases in order within the section, `Create:` before `as well as by files` [M1]; (b) the second establishes `<issue>-gate-<t>.json` and `prefix` in one sentence of the section [M2]; (c) the third bounds the growth at 12 lines and the fourth and fifth establish that the text before the section and from the next heading on are byte-identical to BASE; each of the three fails outright when `ULTRA_BASE` is unset, so none can pass vacuously [M3].

**Stale-if:**
- path-absent: `skills/ultrawrite/SKILL.md`

### Task 2: The gotchas carry the shared-fake row, and the row count moves with it

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `skills/ultrawrite/references/authoring-gotchas.md`
- Modify: `tests/test_compile_plan_exam_sweep.py`

**Claim:** a fake that stands in for a client sibling features also call records only the states with this exam's own shape (`note`, `amendment`) and answers null to the rest. (quoted from #1116)
Machine: M1. `skills/ultrawrite/references/authoring-gotchas.md` has a heading line exactly `## The sixteen rows` and no line `## The fifteen rows`. M2. The lines between `## The sixteen rows` and `## Three older lessons of the same kind` that begin `- **` number exactly 16. M3. One of those rows carries, in this order, `stands in for a client`, `records only the states with this exam's own shape`, `answers null to the rest`, `run-183` and `#1111`. M4. `tests/test_compile_plan_exam_sweep.py` contains no occurrence of `fifteen` and its two gotchas `Run:` strings read `## The sixteen rows` and `= 16`, and `python3 -m pytest tests/test_compile_plan_exam_sweep.py -q` exits 0.

**Authorized-by:** #1116 (rule 3, run-183's `test_run_engine_worker_notes.mjs` counting 7 asks where it pinned 3 once run-182's tier rows shared the fake; PR #1111, hand fold `f3c69320`)

**Interfaces:**
- Consumes: none
- Produces: nothing

**Context:** The gotchas file's rows section is headed `## The fifteen rows` at BASE and holds fifteen `- **…**` rows; a row is one bold lead sentence, its reason and the run that cost it in parentheses — read the fifteen for the register. The new row's lead is about the shared fake: an exam that pins an exact call count on a fake a sibling feature also calls over-counts the moment the sibling lands and the fold merges both, so the fake records only the states with this exam's own shape and answers null to the rest (run-183's worker-notes exam pinned "exactly three asks" on the one `jev.ask` fake, run-182's tier rows asked the same client at every dispatch and review, the count read 7, the publish fold went red, PR #1111, hand fold `f3c69320`; the amendments exam had the same leg, 4 ≠ 2). The heading counts what is under it, and `tests/test_compile_plan_exam_sweep.py` pins both the heading text and the count (its `RUN_GOTCHAS_ROW` and `RUN_GOTCHAS_COUNT` strings at lines 395–402, and the docstrings of the two `test_j_*` functions at 515–536 that quote `fifteen`): that test is this task's to move, in the same edit, to `sixteen` and `16`. The issue names `fleet/roles/examiner.md` too; it is the old engine's role file and is not touched by this plan (the `Check:` above freezes `fleet/`).

**Proof:**
- Run: grep -q '^## The sixteen rows$' skills/ultrawrite/references/authoring-gotchas.md
- Run: ! grep -q '^## The fifteen rows' skills/ultrawrite/references/authoring-gotchas.md
- Run: test "$(sed -n '/^## The sixteen rows/,/^## Three older/p' skills/ultrawrite/references/authoring-gotchas.md | grep -c '^- \*\*')" = 16
- Run: sed -n '/^## The sixteen rows/,/^## Three older/p' skills/ultrawrite/references/authoring-gotchas.md | tr '\n' ' ' | grep -q 'stands in for a client.*records only the states with this exam.s own shape.*answers null to the rest.*run-183.*#1111'
- Run: ! grep -qi 'fifteen' tests/test_compile_plan_exam_sweep.py
- Run: grep -q 'The sixteen rows' tests/test_compile_plan_exam_sweep.py
- Run: grep -q '= 16' tests/test_compile_plan_exam_sweep.py
- Run: python3 -m pytest tests/test_compile_plan_exam_sweep.py -q
- Legs: (a) the first two `Run:` lines establish the heading and the absence of the old one [M1]; (b) the third establishes the count of 16 [M2]; (c) the fourth establishes the row's five phrases in order [M3]; (d) the fifth, sixth and seventh establish the test file's pins moved, and the eighth that it passes [M4].

**Stale-if:**
- path-absent: `skills/ultrawrite/references/authoring-gotchas.md`
