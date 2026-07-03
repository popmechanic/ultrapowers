# Plan grammar `--check` — validate at authoring time, narrow the parser

**Date:** 2026-07-03
**Origin:** 2026-07-03 ultralearn sense pass distilled structural-first;
executes issue #85. Field evidence: the foreign 0.0.30 run
(`a4cf14b548134306`) hit two of the tolerance classes live ('nothing'
interface-matched as a symbol → two spurious edges → one wasted wave;
parenthetical Files annotations → the two most contended files silently
dropped from overlap inference, junk tokens in the launch payload), and the
home run (`acd2b024c36dbc5d`) showed catch-all Files clauses invisible to
conflict analysis. Ships after the authored-review-depth cycle (same day's
spec A); `--check` validates spec A's `Review:` marker.
**Acceptance:** suite

## Problem

`compile_plan.py` tolerates prose variety, and each tolerance branch has
produced its own edge class across 7+ harvested runs (issue #85): annotated
Files lines drop paths from overlap inference; placeholder interface values
(`Consumes: nothing`) parse as real one-element lists and match each other
into spurious edges; globs over-serialize; unknown Files labels silently drop
paths; catch-all clauses create writes the wave scheduler cannot see.
Tolerance corrects silently at compile time, when nobody is watching. The
structural inversion: shrink the accepted grammar and validate LOUDLY at
authoring time, when the author and the operator are both present and a fix
costs seconds.

## Design

### 1. `compile_plan.py --check <plan.md>`

A validation mode: parse the plan against the narrowed grammar, print every
violation with a did-you-mean fix, exit non-zero on any violation, exit 0 on
a clean plan. Diagnostics name the task, quote the offending line, and show
the corrected form:

```
Task 4: Files line has a trailing annotation.
  got:  - `src/lib/db.js` (only the pool init, lines 12-40)
  fix:  - `src/lib/db.js`        (move the note into the task prose)
```

ultraplan's authoring rules make `--check` the final authoring step before
any handoff; a plan is not "marked" until `--check` passes.

### 2. The narrowed grammar

- **Files bullets are backticked paths, nothing else.** One path per bullet
  under a canonical label set. Coordination notes move into task prose.
  (Rejected alternative: a sanctioned annotation syntax the parser strips —
  friendlier to hand-authors but keeps a tolerance branch alive forever;
  plans here are authored by ultraplan-following agents, so strictness is
  cheap and no information is lost.)
- **Interface placeholders parse as empty.** The known placeholder set
  (`nothing`, `none`, `n/a` — bare or with trailing prose) normalizes to an
  empty list at parse, deleting the placeholder-matching edge class at the
  representation. `--check` rejects any other value that is not a symbol
  list (backticked or bare identifier tokens separated by commas; full
  sentences are rejected).
- **Globs are rejected**; enumerate the paths.
- **Unknown Files labels are rejected** with did-you-mean to the canonical
  label set (the current silent-drop branch becomes a loud error).
- **Catch-alls are formalized.** At most one bullet per task of the form
  `- catch-all: <scope prose>`. The compiler widens that task's write set to
  conflict with every other task, forcing serial placement in the DAG — the
  placement that made the home run's Task 6 safe by luck becomes safe by
  construction. Any other non-path prose in a Files section is rejected.
- **Markers validated:** `Type:`, `Depends-on:`, `Review:` (spec A) values
  are checked against their enumerations.

### 3. Runtime parser narrowing (same cycle)

One validation path: plain `compile_plan.py` on a violating plan fails loudly
with the identical diagnostics — the checker is the parser's front door, not
a separate linter that can drift from it. Delete the tolerance branches:
annotation handling, placeholder-as-symbol parsing, silent unknown-label
drops, and the empty-token conflict messages they produced. The accepted
language becomes exactly what `references/plan-markers.md` documents, and
`plan-markers.md` is updated to document all of it (canonical Files labels,
placeholder forms, the catch-all bullet, marker value enumerations).

Historical plans in `docs/superpowers/plans/` are not migrated; compiling one
that violates the grammar now errors with actionable diagnostics instead of
silently tolerating.

### 4. Fixtures and seals

The eval fixtures (`evals/fixtures/{wide,chained,mixed,flawed,degrade}`) are
sealed (`tests/test_fixture_seals.py`). Any fixture using old grammar is
updated to canonical grammar and re-sealed; the `flawed` fixture gains the
violation cases (annotated Files line, prose placeholder, glob, unknown
label, malformed catch-all) as the natural home for `--check` rejection
tests. Re-sealing is an explicit, reviewed step in the plan — never a silent
side effect.

### 5. Regression pins

The three fresh field bugs land as named tests:

- 'nothing'-placeholder pair produces **zero** interface edges (was: two
  spurious edges and a wasted wave),
- a Files path formerly lost to annotation reaches overlap inference in its
  corrected form, and the annotated form is rejected with the extract-fix
  diagnostic (was: silent drop + junk tokens in the launch payload),
- a catch-all task conflicts with every wave-mate candidate (was: invisible
  writes, safe only on a serial tail).

## Complexity effect

Structural: correction moves upstream to authoring; runtime tolerance
branches are deleted, not added. `compileFlags` ticks 2→3 (the `--check`
flag) — the ratchet will surface it; the offset is the deleted branch cluster,
so standingConcepts nets down. Record the regenerated baseline in the
finishing pass.

## Out of scope

- Auto-fixing plans in place (`--check` diagnoses; the author edits).
- Validating unmarked (pure-superpowers) plans — `--check` targets marked
  plans; sequential executors are unaffected.
- Any change to wave semantics beyond catch-all serialization.
