# Jev's authoring checks ask only what can matter

**Grammar:** claims-v1
**Claim:** When I sign a TinyApp plan, the doubts and flags Jev raises come only from checks that can catch a real problem, read against my own words, and no report carries Jev fields that nothing fills. (elicited)
**Summary:** This removes the Jev authoring checks that raised noise on radio-station: a conflict check that fires on every piece with a Remove button, a pairwise same-need check that made 140 calls for one flag, and ask text that let notes and earlier picks become doubts on your sign question (#1369, n=1 product, 468 readings). It also clears Jev leftovers from the retired factory: census columns nothing has written since run 185 and two doc lines naming readers that no longer exist. You get fewer, truer doubts when you sign, and records that report only what is measured.

**Goal:** The rest of #1369: retire `actions_conflict`, keep the ask file to the operator's words, drop the map-stage `same_need`, and clear the census's dead Jev columns and the two stale doc lines.
**Closes:** #1369
**Tech Stack:** TypeScript on Bun (the authoring checks), Python 3 (the census), Markdown
**Spec:** none — #1369; operator picks 2026-09-29 (retire the conflict check; ask file = the operator's words; drop map same-need, keep the typed-text check)

## Global Constraints

- The typed-text check (`content_branch.branches_on_text`) and the bundle-stage pairwise `same_need` stay.
- Check: python3 -m pytest -q tests/test_catch_counter.py tests/test_catch_report.py

### Task 1: Retire the conflict check and the map-stage same-need reads

**Type:** implementation

**Files:**
- Modify: `skills/ultrawrite/stories/questions.json`
- Modify: `skills/ultrawrite/stories/policy.json`
- Modify: `skills/ultrawrite/stories/jev_checks.ts`

**Claim:** When I sign a TinyApp plan, the doubts and flags Jev raises come only from checks that can catch a real problem. (derived)
Machine: M1. No file under `skills/ultrawrite/stories/` contains the string `actions_conflict`: the question is gone from `questions.json`'s `coherence` set, its threshold is gone from `policy.json`'s `flag_at`, and `jev_checks.ts` no longer reads or flags it. M2. `jev_checks.ts`'s map stage makes no pairwise `same_need` read: exactly one line of `jev_checks.ts` contains `Q.redundancy`, the bundle stage's pairwise read of pieces. M3. `jev_checks.ts` still loads, so run with no arguments it prints its usage line and exits 2.

**Authorized-by:** #1369; operator, 2026-09-29 (retire the conflict check; drop map same-need)

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** Readings from radio-station `stories/product.json` (n=1 product, 468 readings, 2026-09-28 → 29):
- **`coherence.actions_conflict`** flagged exactly the pieces with an add/remove pair (show, news, onair, staff, playlist; 7 of 22 readings) and never episode or showpage, so it carries no information. Remove the question, its `flag_at` cell, and its read and flag in the bundle stage. The other two `coherence` questions (`one_need`, `same_people`) stay.
- **The map stage's pairwise `same_need`** (the nested loop over concepts within a part, in the map stage) made 140 calls and raised 1 flag. Remove that loop. The bundle stage's pairwise loop over pieces stays, and so does the `same_need` threshold it uses.
- **`policy.json`** keeps its shape. Add one line to its `readings` array recording both removals, with `n=1 product, 468 readings, window 2026-09-28..29`.

**Proof:**
- Run: test -z "$(grep -rl actions_conflict skills/ultrawrite/stories/)" [M1]
- Run: test "$(grep -c 'Q.redundancy' skills/ultrawrite/stories/jev_checks.ts)" = 1 [M2]
- Run: bash -c 'bun skills/ultrawrite/stories/jev_checks.ts >/dev/null 2>&1; test $? = 2' [M3]
- Legs: (a) no file under the stories directory names `actions_conflict` [M1]; (b) exactly one `Q.redundancy` line is left [M2]; (c) the script still loads and exits 2 on no arguments [M3].

**Stale-if:**
- path-absent: `skills/ultrawrite/stories/jev_checks.ts`

### Task 2: The ask file holds the operator's words

**Type:** implementation

**Files:**
- Modify: `skills/ultrawrite/SKILL.md`
- Modify: `skills/ultrawrite/references/enrich.md`

**Claim:** Jev's doubts are read against my own words. (derived)
Machine: M1. `skills/ultrawrite/SKILL.md` carries the sentence `The ask file holds only the operator's own words for this plan: never notes, earlier picks or the author's lines, because Jev reads every sentence in it.` M2. `skills/ultrawrite/references/enrich.md`'s paragraph on a later plan's `--ask-file` carries the same sentence.

**Authorized-by:** #1369; operator, 2026-09-29 (ask file = the operator's words)

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** On radio-station's later plans, the `--ask-file` passed to the bundle stage held chat and note text: "Let's proceed with what listeners see.", "Next: rs4 Who may edit…" and "(Operator picks 2026-09-28: …". `ambiguity.two_apps` read each one at 0.50 to 0.62, and all four became doubts on the sign question (#1369, n=1 product). Put the sentence, byte for byte, into SKILL.md's Story planning step 2 (the step that says to save the ask verbatim to `<bundle>/ask.txt`), and into enrich.md's paragraph that says to pass the new ask with `--ask-file` (the one ending "Jev reads its sentences because they are new."). Change nothing else.

**Proof:**
- Run: grep -qF "The ask file holds only the operator's own words for this plan: never notes, earlier picks or the author's lines, because Jev reads every sentence in it." skills/ultrawrite/SKILL.md [M1]
- Run: grep -qF "The ask file holds only the operator's own words for this plan: never notes, earlier picks or the author's lines, because Jev reads every sentence in it." skills/ultrawrite/references/enrich.md [M2]
- Run: python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrawrite
- Legs: (a) SKILL.md carries the sentence exactly [M1]; (b) enrich.md carries it exactly [M2].

**Stale-if:**
- path-absent: `skills/ultrawrite/references/enrich.md`

### Task 3: The census stops reading Jev fields nothing writes

**Type:** implementation

**Files:**
- Modify: `skills/ultrawrite/scripts/authoring_census.py`
- Modify: `tests/test_authoring_census.py`

**Claim:** No report carries Jev fields that nothing fills. (derived)
Machine: M1. Neither `authoring_census.py` nor `tests/test_authoring_census.py` contains `compelled`, `plan_fault`, `magnitude`, `JEV_THRESHOLD` or `JEV_BUCKETS`: the three columns, their per-row reading of amendment rows, the two constants and the three fields on the `totals:` line are gone. M2. The census's own tests pass.

**Authorized-by:** #1369 (carried over from #1336)

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** `authoring_census.py` reads `jev.compelled`, `jev.plan_fault` and `jev.magnitude` on `driver:amendment` rows. Nothing has written those since run 185: their producer left in d8fe908f (#1281), and the factory that ran it was deleted in #1365. Every release since has printed `compelled=0/0 plan_fault=0/0 magnitude=0/0/0/0`. Remove the three columns from the table, the `totals:` line and the row builder, along with the helpers used only by them (`_bucket`, the per-row Jev reader, the two constants). Keep every other column, including `amendments` and `explain_rounds`, in its order. Update the tests' expected headers and lines to match, and delete the tests that exist only for the three fields.

**Proof:**
- Run: test -z "$(grep -lE 'compelled|plan_fault|magnitude|JEV_THRESHOLD|JEV_BUCKETS' skills/ultrawrite/scripts/authoring_census.py tests/test_authoring_census.py)" [M1]
- Run: python3 -m pytest -q tests/test_authoring_census.py [M2]
- Legs: (a) neither file names any of the three fields or the two constants [M1]; (b) the census tests pass [M2].

**Stale-if:**
- path-absent: `skills/ultrawrite/scripts/authoring_census.py`

### Task 4: Two doc lines stop naming retired Jev readers

**Type:** implementation

**Files:**
- Modify: `CLAUDE.md`
- Modify: `skills/ultrapowers/scripts/catch_counter.py`

**Claim:** No report carries Jev fields that nothing fills. (derived)
Machine: M1. `CLAUDE.md` no longer contains `gate.jev_claim`. M2. `skills/ultrapowers/scripts/catch_counter.py` no longer contains `factory/measure.mjs`.

**Authorized-by:** #1369 (carried over from #1336)

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** In `CLAUDE.md`, remove only the sentence "`gate.jev_claim` is `record-only` until five runs are joined to smoke outcomes." from the Test doctrine bullet. In `catch_counter.py`, the `_verdict_before` docstring should name it as the retired factory's `measure.mjs` (deleted in #1365); change no code line and no other sentence. `gate.jev_claim` was a factory gate. The factory, and the Jev claim reading, were deleted in #1365, so the sentence describes nothing that runs. `catch_counter.py` still reads old factory evidence, so its docstring keeps explaining the verdict row. It just shouldn't point at a path that no longer exists.

**Proof:**
- Run: bash -c '! grep -q gate.jev_claim CLAUDE.md' [M1]
- Run: bash -c '! grep -q factory/measure.mjs skills/ultrapowers/scripts/catch_counter.py' [M2]
- Legs: (a) CLAUDE.md does not name `gate.jev_claim` [M1]; (b) catch_counter.py does not name `factory/measure.mjs` [M2].

**Stale-if:**
- path-absent: `CLAUDE.md`
