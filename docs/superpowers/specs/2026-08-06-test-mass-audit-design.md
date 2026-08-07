# Test-mass skeptical audit — the drain's 2.4:1 test ratio gets its counterweight pass

_Design for issue #106. Analysis-first: verdict every test line the
2026-07-27 drain added, delete what can only fail alongside another test, add
the two cheap coverage closers the drain's own reviewers named._

## Problem

The 2026-07-27 drain added ~1,170 test/sim lines against ~500 shipped-code
lines. The complexity doctrine's counterweight rules (machinery earned by
recurrence; the 0.1.0 lesson that pins accrete into ballast; every pin is a
standing false-red surface) demand a deliberate skeptical pass. The issue
enumerates the candidate families from the drain's own reviews — this build
executes that pass and lands the net.

## Design

### One audited sweep, verdict-first

**Scope derivation (mechanical, SHAs pinned — the release tags do not
exist):** `git diff f2efcd3..511c945 -- tests/` (release commit 0.1.12 →
release commit 0.1.13; verified: 11 files, 1,030 insertions, including
`sim_workflow.mjs` +445 and the fragile prune test) defines the audited
population — every added test function and sim scenario. Beware the
mis-stamped 0.2.0 commit (f38a9ad, same tree as 0.1.13) sitting in the
window; the endpoints above are authoritative.

**Verdict criteria, per test (recorded in a table):**

- **keep** — pins a failure with field recurrence (a ledger finding or
  issue cites it), or is the sole coverage of a live code path.
- **delete** — can only fail alongside another test (pin-of-a-pin,
  duplicate contract), or asserts implementation restatement rather than
  behavior. Each deletion requires a **one-shot bite proof**: mutate the
  subject, confirm the named surviving test goes red, record it in the
  verdict-table row (the drain's own Step-3 "prove the test bites"
  discipline — analysis-time only, no standing machinery). A named survivor
  without a bite proof is a claim, not a check.
- **fix** — the known-fragile trigger
  (`test_prune_failure_is_named_in_the_scratch_hygiene_detail`, red under
  root/Docker per the #95 reviewer): root-immune it (skip-if-root marker
  with the reason string) rather than delete — it pins a real behavior.

**The issue's named candidates get explicit verdicts:** the prune honesty
proofs and the `sim_workflow.mjs` guard self-test (pins-of-pins — delete
unless a ledger finding shows field recurrence); the post-#101 sim overlap
(the portability and reviewer-uniform scenarios both pinning "legacy
tierOverrides ignored") — routed through the same criterion as everything
else: collapse only if the bite proof shows they can only fail together,
since they may exercise different config paths.

**The two cheap coverage adds (from the drain's reviewers):**
`package-json-bun` ladder-rung coverage + its precedence vs pnpm (two
lines); `FILES_EXEMPT_MARKERS` parametrized over gate/manual/release (stops
a future narrowing from passing green).

**Where the verdicts live:** the full table goes in the **#106 closure
comment** (the canonical reversal lookup key); the deletion commit's subject
cites #106 so `git log --grep` finds it, and its message carries only a
one-line net summary. **No standing repo doc** (an audit report that
outlives its deletions is itself ballast).

### Canary (rigor trade — required)

Deleting pins trades standing verification for suite mass. canaryMetric:
the doctrine default (redirect-round rate). Reversal insurance is a rule,
not machinery: the #106 closure comment states "a sense-pass finding whose
cluster matches a deleted subject → restore that pin (table below)" — sense
passes surface regression clusters by construction, so no bespoke watch
obligation is imposed on the distill subsystem this spec does not touch.

## Surfaces

- `tests/` + `tests/sim_workflow.mjs` (deletions, the fragile-trigger fix,
  the two adds; sim edits keep the sentinel discipline — the suite-gate runs
  the sims on any harness change, and sim self-edits must keep it printing).
- Nothing else: no engine, no scripts, no docs.

## Error handling / failure modes

- A candidate deletion whose subject has no surviving coverage → verdict
  flips to keep (the criteria are the authority, not the shrink target).
- The net may be small or even positive — the issue says so itself; a
  mostly-keep verdict table is a valid outcome, not a failed audit.

## Testing

The suite itself is the harness: green before, green after, with the two
adds red-then-green (TDD on the closers). `node tests/sim_workflow.mjs`
prints its sentinel after scenario dedup.

## Trim review

**Author disclosure (Adds/Removes).** Adds: two reviewer-named coverage
closers; one root-immunity marker. Removes: duplicate/meta pins per the
verdict table (population defined mechanically); the audit itself leaves no
standing artifact.

**Reviewer verdicts** (fresh-context dispatch; saw the draft, issue #106,
and the doctrine; mandated to hunt the *inverted* failure modes of a
deletion pass): 2 trims + 4 gaps, including running git itself to prove the
draft's scope refs broken (no v0.1.12/v0.1.13 tags exist) and supplying the
verified SHA window; grade: **down**.

**Adopt-or-answer — all six adopted:**

1. Bespoke distill-watch canary → **adopted** (narrow): doctrine-default
   canary; reversal insurance is one rule in the closure comment, not an
   obligation on a subsystem this spec doesn't touch.
2. Dual-home verdict table → **adopted** (merge): full table in the #106
   closure comment only; commit carries the one-line net + the #106 cite.
3. **Gap:** broken scope refs → **adopted**: SHAs pinned
   (f2efcd3..511c945, independently re-verified: 11 files / 1,030
   insertions), mis-stamped 0.2.0 commit flagged.
4. **Gap:** survivor-naming is a claim, not a check → **adopted**: one-shot
   bite proof per deletion, recorded in the table row.
5. **Gap:** pre-judged sim collapse → **adopted**: routed through the same
   bite-proof criterion.
6. **Gap:** reversal findability → **adopted**: #106 is the canonical
   lookup key, greppable from the commit subject.

**Reviewer grade: down** — the audit leaves no standing artifact and the
system shrinks.
