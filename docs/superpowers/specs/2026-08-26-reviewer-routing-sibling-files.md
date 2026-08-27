# Reviewer routing keyed on SIBLING FILES + FILES-footprint sibling carve-out (#285 + #245)

**Date:** 2026-08-26
**Issues:** #285 (#240's GO shape, operator-endorsed adjudication at
popmechanic/ultrapowers#240 comment 5429017966), #245 (absorbed into this spec —
operator-approved; same prompt surface, one re-bake).
**Surfaces:** `skills/ultrapowers/references/reviewer-prompts.md` (source),
`skills/ultrapowers/harnesses/waves.js` (bake), `evals/fixtures/flawed-routing/`
(new A/B fixture), `evals/frontier/results/` (A/B record).
**Frozen periphery:** untouched (no gate scripts, no sealing, no compiler
diagnostics).

## Problem

The reviewer's plan-defect routing rule (`reviewer-prompts.md:149`, landed via
#112 in 0.2.13) conflates three defect classes under "cross-task interface
surface … when in doubt, gate":

1. Fix needs a **sibling-owned file** (same wave, live worktree) → must gate;
   fixing in-worktree violates isolation. Correct today.
2. Fix is on the task's **own files; consumers are downstream** — they
   `Depends-on` this task and have not started → safe to fix now. Today these
   route `minor` → gate → critic block → full redirect round. This is where the
   avoidable rounds form (Julian evidence, 4 of 5 plans; routing failure, not
   detection failure — reviewers found the defects and mis-routed them).
3. **Two-merged-branches observability** → must gate. Correct today.

Separately (#245, from the #223 Task 1 adversarial review), the FILES-footprint
wording has three defects: (1) a sibling-owned file does not exist at BASE, so
creating/writing it is textually "a modification outside FILES" → `minor`,
when the SIBLING FILES rule should govern it as blocking; (2) the "undisclosed
out-of-FILES" clause is unevaluable — the reviewer never receives the
implementer's `concerns` and is told not to consult the report; (3) unrelated
out-of-FILES edits reaching the gate as `minor` is the stated #223 trade — a
watch-item (sense pass by engineVersion ≥ 0.2.18), not a build item here.

## Design

All prose edits land in `references/reviewer-prompts.md` inside the BAKE
blocks, then are re-baked into `waves.js` per
`references/workflow-template.md` §Re-bake, with
`tests/test_no_prompt_drift.py` green. Implementer "Plan-supplied code" line
(conservative implement-then-report) stays **unchanged** — the reviewer
promotes and the fix round applies.

### Edit 1 — routing replacement (#285), REVIEWER_PROMPT block

Replace, in the "Plan-supplied code is not privileged" paragraph, the span from
"Prefix the detail `plan-defect:` — and route by blast radius." through "— when
in doubt, gate." with:

> Prefix the detail `plan-defect:`. Cross-task routing is mechanical, not a
> judgment call: report severity `minor` so the finding routes to the pre-merge
> gate ONLY when (1) applying the fix would require editing a path listed in
> `SIBLING FILES` — a same-wave sibling owns it and fixing here would violate
> worktree isolation — or (2) the defect is observable only with two or more
> merged branches present. Every other confirmed defect — including a defect in
> an interface on this task's own files whose consumers are downstream tasks —
> is reported at its true severity so the fix loop applies it now, and the fix
> carries the same `plan-defect:` disclosure; a downstream consumer has not
> started and will implement against the corrected surface.

The trailing sentence of the paragraph ("When the diff already diverges from
plan text under a disclosed `plan-defect:` concern …") is unchanged. "When in
doubt, gate" is deleted — routing is now mechanical on inputs the reviewer
already receives (`SIBLING FILES`, waves.js threads it into every reviewer
dispatch).

### Edit 2 — FILES-footprint sentence (#245 items 1+2), REVIEWER_PROMPT block

Replace the final sentence of the "When `FILES` …" item ("An undisclosed
out-of-`FILES` modification — one the implementer did not surface as an
`out-of-FILES:` concern — is itself a `minor` issue, not a blocking one.")
with:

> The out-of-`FILES` footprint is itself at most a `minor` finding, disclosed
> or not; judge the change's own content under the other items at its true
> severity. Sibling-owned paths are never footprint — the `SIBLING FILES`
> rule governs them, and creating or modifying one stays blocking.

This rewords the unevaluable disclosure clause as a severity ceiling (#245
item 2) and adds the sibling carve-out (#245 item 1).

### Edit 3 — implementer footprint bullet (#245 item 1), IMPLEMENTER_PROMPT block

In the "Read the packet's `## Files changed`" bullet, after "a modified path
outside it is allowed when the task requires it", insert "(sibling-owned paths
excepted — see `SIBLING FILES`)".

### Non-edits

- Implementer "Plan-supplied code that is genuinely defective" line: unchanged.
- Reviewer `SIBLING FILES` missing-dependency-edge paragraph: unchanged.
- Fix-loop policy (cap 2), schemas: unchanged.
- No waves.js control-flow change — prompt constants only; existing `.mjs` sims
  cover the suite-gate's harness-JS requirement (no new engine behavior).

## Verification — eval-route BEFORE ship (issue-mandated)

Per the #240 adjudication: contend/mixed will not organically exercise the
routing line, so the discriminating instrument is a new fixture.

### New fixture: `evals/fixtures/flawed-routing/`

Variant of `flawed` (apistub users API). Seeds two defects, both in
plan-verbatim code the implementer prompt tells the agent to transcribe and
report rather than fix (interface surface):

- **Class-2 seed (own-file interface defect):** a task whose body states an
  interface contract in its own text (and in its `Interfaces:` `Produces`
  block) that its plan-verbatim code contradicts, with plan-verbatim tests
  consistent with the defective code (local suite green) — e.g. `FIELDS`
  insertion order stated "name first" while the supplied literal orders email
  first, with a downstream (`Depends-on`) task consuming the order. Reviewer
  detects contract-vs-code contradiction from the task text alone. Expected:
  arm A routes `minor` → gate → redirect round; arm B reports blocking →
  fix loop applies now → no redirect round.
- **Class-1 seed (sibling-file defect):** a same-wave task pair where a
  confirmed defect's corrective edit lies in the sibling's declared file (a
  cross-file consistency criterion stated in this task's body whose fix the
  plan locates in the sibling-owned path). Expected: BOTH arms route `minor` →
  gate (no-regression leg: the new text must not promote class 1).

Flat `acceptance/test_*.py` suite (sealed on the fly by ab_runner, as
wide/chained/mixed/degrade do); the acceptance suite asserts the CORRECT
contract, so an unfixed class-2 defect surfaces as a post-approve catch.
The plan carries a sealed `**Acceptance:**` line computed with
`seal_hash.py` (mirroring `flawed`); it is NOT added to
`tests/test_fixture_seals.py`'s FIXTURES list (matching the `flawed`
precedent — that pin list covers the A/B-protocol regression fixtures).

### Cells (serial, `evals/ab_runner.py`, one per invocation)

| Cell | Fixture | Engine ref | Role |
|------|---------|------------|------|
| 1 | flawed-routing | main (`c758831`, current routing) | discriminating arm A |
| 2 | flawed-routing | feature branch (new routing) | discriminating arm B |
| 3 | contend | feature branch | regression (organic contention) |
| 4 | mixed | feature branch | regression (mixed DAG) |

Regression cells (3–4) are judged on their own hard gates within-cell —
driven run reaches the pre-merge gate with no engine crash, no fix-loop
exhaustion, no `blocked-after-fix`, and the sealed acceptance passing at the
gate — not by comparison against cross-version `runs.jsonl` history (a
prompt-constants-only change has no meaningful cross-version numeric
baseline).

### Metrics and adoption gate

Cells stop AT the pre-merge gate (ab_runner's DRIVE_PROMPT), so metrics are
gate-observable: per-seed routing outcome (which class reached the gate as a
`minor` routed finding vs was applied in the fix loop), fix-loop iterations
and exhaustions (#227 interaction), `blocked-after-fix` count, and the sealed
acceptance result at the gate (the post-approve-catch proxy). **Adopt iff**,
on flawed-routing: arm B resolves the class-2 seed in the fix loop (no
redirect needed) where arm A routes it to the gate; the class-1 seed routes
`minor` directly to the gate in BOTH arms with zero `blocked-after-fix` on
that seed (a mis-promoted class-1 surfacing as `blocked-after-fix` is
over-promotion — a gate failure, not a pass); no fix-loop exhaustion; and
regression cells green on their own gates. **Instrument precondition:** arm A
must reproduce the mis-route (class-2 finding present AND routed `minor` to
the gate). If a cell's reviewer misses a seed entirely or arm A routes it
fix-now, re-run (up to 2 re-runs per cell) or strengthen the seed and re-run
both discriminating cells — a null reading is an instrument failure, distinct
from an adoption failure. Record every cell (including re-runs) in
`evals/frontier/results/2026-08-26-routing-ab.md`. If the adoption gate
fails, the branch does not merge; findings go back to #285.

## Out of scope

- #245 item 3 (unrelated-refactor merges rising) — watch-item for the sense
  pass, no build.
- Implementer-side routing (line 52) — reviewer promotes; implementer stays
  conservative.
- Any fix-loop cap change (#227 owns that question).
- **Known residual (recorded, not built):** downstream-owned files. Condition
  (1) keys on `SIBLING FILES` (same-wave only); a promoted blocking finding
  whose fix strays into a path a downstream task will Create is caught by
  neither condition — the deleted "when in doubt, gate" was the residual catch
  for that un-establishable boundary. Watch-item for the sense pass alongside
  #245 item 3 (dual creation still conflicts at wave merge, the backstop).

## Trim review

**Author disclosure — Adds:** two-condition mechanical routing rule (replaces
blast-radius judgment vocabulary), sibling carve-out sentence, severity
ceiling reword, one permanent eval fixture, 4 A/B cells. **Removes:** "when
in doubt, gate" default, "route by blast radius" vocabulary, the unevaluable
disclosure clause.

**Reviewer (fresh-context, 2026-08-26): 2 trims, 6 under-spec flags, grade
FLAT.** Adopt-or-answer:

- **T1 (Edit-2 cap over-broad) — ADOPTED.** Reworded: the ceiling caps the
  footprint finding itself, not any finding delivered inside an out-of-FILES
  edit.
- **T2 (delete mixed regression cell) — ANSWERED (kept).** #285 names
  contend AND mixed; one regression cell's cost does not justify trimming
  below issue scope (quality > tokens).
- **U1 (arm-B class-1 semantics) — ADOPTED.** Explicit: minor-direct with
  zero blocked-after-fix on that seed; blocked-after-fix = over-promotion =
  gate failure.
- **U2 (null instrument) — ADOPTED.** Instrument precondition + re-run/
  re-seed response added, distinct from adoption failure.
- **U3 (downstream-owned files residual) — ADOPTED** as recorded watch-item
  (Out of scope).
- **U4 (fixture registration) — ADOPTED.** Sealed Acceptance line via
  seal_hash.py; not added to test_fixture_seals FIXTURES (flawed precedent).
- **U5 (baseline confound) — ADOPTED.** Cross-version comparison dropped;
  regression cells judged on within-cell hard gates.
- **U6 (absent SIBLING FILES) — ANSWERED (no prompt change).** "Editing a
  path listed in SIBLING FILES" cannot fire when the list is absent — already
  mechanical; adding the clause spends words on a ratcheted surface for no
  new information. Recorded here as the intended reading.
- **Scope note (acknowledged):** the adoption gate is deliberately 4-clause
  (a safety tightening over the issue's 2-clause shorthand); cells are 4 not
  6 (arm-A contend/mixed dropped as adding no information about a
  prompt-only change — see the regression-judgment rule above).
- **netConceptDelta: flat** (reviewer-graded; evaluability up, concept count
  even).
