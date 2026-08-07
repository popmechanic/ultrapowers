# Sweep-hygiene smalls — #111 built, #109 built, #110 parked

_Design for the #110+#111+#109 cluster (post-#108 follow-ups), one iteration.
Proportionate spec: two one-line-class fixes and one park with reasoning._

## Dispositions

### #110 — WF_RUN_RE ≥2-segment shape assumption: **PARK, do not build**

Both closure directions the issue names (derive ids from on-disk `wf_*`
names at approve time; relax the pattern with a stamp-exclusion test matrix)
land in **frozen `ultra_gate.py`**. The freeze admits changes only on
eval-measured regressions; this defect has **zero occurrences** (the runtime
mints `wf_<hex8>-<n>` today; a single-segment id is hypothetical), and the
issue itself grants double mitigation ("left behind:" accounting reports
anything unswept loudly; `--audit` + the preflight advisory re-surface it).
A hypothetical shape change is weaker evidence than the incident narratives
the freeze already rejects. **Reopen trigger:** an observed runtime id that
the pattern misses (the loud left-behind accounting is exactly where it
would show).

### #111 — `--age-hours` magnitude bound: **build**

`AGE_HOURS=$((10#$AGE_HOURS))` wraps on 64-bit overflow for absurd digit
strings, inverting the report-only age filter. Fix **inside the existing
digits-only case arm** (`''|*[!0-9]*`), not as a sibling branch: add the
7-plus-digit glob alternative to the same arm and widen its one message
("requires a non-negative integer of at most 6 digits") — net-zero new
branches, no second error style. The bound is evaluated on the **raw string
before the `10#` normalization**, in the same case statement (a leading-zero
11-digit value is rejected for length, never silently normalized first).
One test asserting **both sides of the boundary**: 20 digits → usage error,
no "older than" line; `999999` (6 digits) → exit 0 with the threshold
echoed. Report-only blast radius; not a frozen file.

### #109 — stale waves.js comment: **build, source-first**

waves.js:349–351 still explains that approve-time reclamation of the
integration worktree depends on "the ADDITIONAL sweep_worktrees.sh --run
wf_<stamp> call SKILL.md issues" — false since #108 (`ultra_gate.py
--approve` sweeps `wf_<stamp>` mechanically). Rewrite the comment to state
the shipped behavior — **after the source check**: a green drift pin only
proves the pin does not cover the comment, not that the comment has no
source a future re-bake would resurrect. Build step: grep `references/`
(workflow-template.md, wave-merge.md) for the stale comment text; if it
appears in any source, fix the source and the copy together; if nowhere,
record that fact in the commit message as the license for a copy-only edit.

## Surfaces

- `skills/ultrapowers/scripts/sweep_worktrees.sh` + `tests/` (#111).
- `skills/ultrapowers/harnesses/waves.js` comment only (#109) — a harness
  file change, so the suite-gate's `.mjs` sims run and must stay green with
  their sentinel; no sim content changes (comments are invisible to sims).
- Docket: #110 → `parked`, with the reopen trigger copied into the entry's
  **durable Notes field** (the #74 mechanism) so the park is self-describing
  where the next sweep re-encounters it — never a bare `parked` state.

## Testing

One pytest for #111 asserting both boundary sides (rejection AND the
6-digit pass). #109 carries no test (comment truth is reviewed, not
executed); the no-collateral check is the suite + sims staying green.

## Trim review

**Author disclosure (Adds/Removes).** Adds: one 6-digit bound + one test; one
corrected comment. Removes: a filter-inverting overflow; a false claim inside
the engine; and (by parking) a frozen-surface change with zero-occurrence
justification.

**Reviewer verdicts** (fresh-context dispatch; saw the draft, all three
issues, the doctrine, and `sweep_worktrees.sh`): 1 trim + 4 gaps; **park
verdict on #110: sound** — verified against the script (the left-behind
accounting at sweep_worktrees.sh:319-341 enumerates on-disk `wf_*` entries
unconditionally, so a never-matched id still reports loudly); noted the file's
history of `--age-hours` shapes twice escalating past report-only, which
earns #111's build; grade: **flat**.

**Adopt-or-answer — all five adopted:**

1. Sibling validation branch → **adopted** (merge): the bound joins the
   existing case arm with one widened message — net-zero new branches.
2. **Gap:** #109 copy-only edit could be resurrected by a re-bake from an
   unchanged source → **adopted**: source-first grep step; copy-only edits
   need the recorded nowhere-in-sources license.
3. **Gap:** bound-vs-normalization ordering unstated → **adopted**: raw
   string, before `10#`, same case statement.
4. **Gap:** rejection-only test can't catch an off-by-one glob →
   **adopted**: both boundary sides in one test.
5. **Gap:** park trigger homeless → **adopted**: reopen trigger lands in the
   docket entry's durable Notes field, never a bare `parked`.

**Reviewer grade: flat.**
