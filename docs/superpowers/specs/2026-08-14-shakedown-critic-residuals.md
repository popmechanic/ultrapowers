# Shakedown critic residuals (#147)

_Spec 2026-08-14, post-trim-review revision. Docket entry #147 (score 7.5).
Source: the §5 shakedown run's own completeness critic (run `20260814-101750`,
report.json completenessFindings) — residuals never dispositioned before the
0.2.0 release, surfaced by the 2026-08-14 sense pass. Authored under the
post-0.2.0 cycle's kickoff delegation._

## Problem (provenance: report.json completenessFindings, one line each)

1. ~~Trusted-green stamp unguarded (waves.js:2007)~~ — **ANSWERED, not built**
   (see Trim review): the shakedown plan's task-3 requirement guarded a field
   the gate explicitly treats as triage context (`SKILL.md`: "the exit code is
   the authority"); for `suite` disposition the gate re-runs the suite itself
   (`ultra_gate.py` → `run_acceptance.sh --suite-gate`, exit-code authority),
   so an evidence-free critic reply cannot ride to a merge on `tests.passed`.
   The stale requirement is recorded against #123 item 4d as answered.
2. **Critic BLOCKED fail-safe widened; the compensating branch is dead.** The
   derived-heads change moved the critic's refusal trigger to "no wave-<n>
   slot readable" (waves.js:632), which occurs whenever wave 1's merge blocks
   — and in that shape the escalated CANNOT-VERIFY checklist is dropped. The
   branch built to preserve escalations already exists at waves.js:1944 but is
   **dead**: its predicate is `!waveBaseSha`, and `waveBaseSha` is hard-gated
   non-empty from setup (waves.js:1632/1678).
3. **Critic prompt self-contradiction** (waves.js:647, baked from
   `references/wave-merge.md:260`, BAKE:COMPLETENESS_PROMPT): the trailing
   sentence says "confirming HEAD equals the recorded merge sha", re-elevating
   the value the same prompt demoted to a cross-check.
4. **Finalize-wiring self-check is half-strength**
   (tests/test_finalize_wiring.py:55-66): the red-check deletes the finalize
   needle, so only the presence assert ever fires; the ordering assert
   (`finalize_idx < gate_idx`) is unproven load-bearing.

## Design (trimmed)

1. **Revive the dead escalation-preserving branch.** Change the predicate at
   waves.js:1944 from `!waveBaseSha` to a no-wave-merged predicate
   (`mergedShas.length === 0`) so the existing branch — which folds every
   `cannotVerifyItems` entry into `judgmentCalls` — actually fires in the
   wave-1-blocked shape. A dead-condition bug fix: no new branch, no new
   channel, no new vocabulary. Covering sim scenario (required — harness JS
   behavioral change): wave-1-blocked shape ⇒ every escalated item appears in
   the report's judgment calls verbatim; mutation-checked (shadow copy with
   the predicate reverted to `!waveBaseSha` fails the scenario).
2. **One-sentence prompt fix** in `references/wave-merge.md:260` (the
   COMPLETENESS_PROMPT source): the trailing sentence names the derived
   value — "After confirming HEAD equals <derived> (the heads/-derived detach
   target), set onIntegrationHead true…" — then re-bake into waves.js. No new
   pin: COMPLETENESS_PROMPT is already in `test_no_prompt_drift.py`'s KNOWN
   set, so the corrected sentence is pinned the moment the source changes.
3. **Strengthen the wiring self-check**
   (tests/test_finalize_wiring.py): extract the presence+ordering assertion
   body into a helper both tests call; change the red-check mutation from
   *delete the finalize needle* to *move it after the gate needle*, asserting
   the ordering assert is what fires.

Non-goals: no report-assembly evidence guard (answered above); no
REVIEW_SCHEMA change; no critic-dispatch skip branch (the revived branch
preserves escalations regardless of what the critic replies; the dispatch's
other BLOCKED triggers are unchanged); no gate/periphery change.

## Verification

`tests/test_finalize_wiring.py`'s red-check demonstrably trips the ordering
assert; the new sim scenario covers the waves.js:1944 predicate change
(standing suite-gate and drift-pin obligations apply as usual).

## Trim review

_Author's original Adds/Removes disclosure:_ one report-assembly guard, one
no-merged-wave skip branch, one prompt sentence, one test strengthening;
removes the critic dispatch in the must-refuse shape. Reviewer graded the
original **netConceptDelta: up** (two additive branches + duplicate pin,
zero deletions, dead branch left standing).

_Reviewer findings (fresh-context, 2026-08-14) and adopt-or-answer:_

1. **BLOCKER — item 1 keyed off the universal reply shape** (REVIEW_SCHEMA has
   no `command` field since #96; the no-command shape is every conformant
   reply; implemented literally it reds every green). **ADOPTED** — item 1
   deleted.
2. **BLOCKER — item 1 guarded a non-authoritative field** (`gate_check.py`
   never reads `tests.passed`; suite gate re-runs the suite; the load-bearing
   self-claim is `gitVerified`, which no engine-side guard can evidence).
   **ADOPTED** — item 1 recorded as answered, not built; the underlying value
   is already delivered deterministically by the gate.
3. **TRIM — schema-level `required: ['output']` is cheaper if item 1 must
   land.** **ANSWERED** — item 1 does not land at all; the schema tweak still
   cannot distinguish fabricated output, so it buys nothing the gate does not
   already provide.
4. **KEEP finding 2 / TRIM design to the dead-predicate fix at waves.js:1944**
   (verified: `cannotVerifyItems` in memory; compensating branch exists and is
   dead; `mergedShas` is the correct predicate; enumerated all seven `review`
   consumers safe). **ADOPTED** — design item 1 is now exactly that fix; the
   skip branch (reviewer's 2b) is not built.
5. **TRIM — item 3's target is `wave-merge.md` only; the proposed
   `sim_derived_heads.mjs` extension double-pins already-pinned text.**
   **ADOPTED** — source named; second pin deleted.
6. **KEEP item 4; fix the mutation direction and name the helper extraction.**
   **ADOPTED** verbatim.
7. **TRIM — verification bullets restating CLAUDE.md standing rules.**
   **ADOPTED.**
8. **TRIM — problem section duplicated report.json at length; "no sim pins the
   sentence" was factually wrong.** **ADOPTED** — compressed; corrected.
9. **Scope reconciliation — original spec proposed two additive branches and
   deleted nothing.** **ADOPTED** — trimmed version deletes a dead predicate
   and adds zero standing branches.

_Reviewer grade of the trimmed version: **netConceptDelta: down**._
