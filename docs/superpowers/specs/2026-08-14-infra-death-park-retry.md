# Infra-death park-and-retry + mergeWave null-guard (#148)

_Spec 2026-08-14 (post-distill sweep), rev 2 after trim review. Issue #148.
complexityEffect: structural; netConceptDelta graded **flat** by the trim
reviewer. Surface: `skills/ultrapowers/harnesses/waves.js` (engine code, not
baked-prompt prose) + `tests/sim_workflow.mjs`._

## Problem

The engine cannot distinguish "the reviewer rejected this work" from "the
reviewer's process died," and the wave-merge path crashes outright on a dead
agent's null reply.

Grounded at HEAD `10eae33`:

1. **Merge-path crash (sev-2 class).** `agent()` *returns null* on terminal
   Overloaded (engine's own comments, waves.js:1026, :1288–1291, :1909–1911
   — it does not throw overload-worded errors), but `mergeWave`'s git-merge
   dispatch (:1469–1477) and reconcile dispatch (:1484–1492) guard **throws
   only**. A null reply reaches `merge.status` (:1478) → TypeError;
   `mergeWave` is unwrapped at its call site (:1815) → whole-run abort,
   losing every already-merged wave. The contended path already carries the
   null guards (:1292, :1399, :1417, :1443) — the asymmetry is the defect.
2. **Infra-death conflated with review failure (sev-3 class).** A dead
   reviewer (null reply → TypeError on `r1.issues`) lands in `runTask`'s
   catch, which retries the **whole pipeline once, immediately, at the same
   tier** (:954–967) — straight back into the same overload storm — then
   emits `status:'failed', reviewVerdict:'agent-error'` (:976–978) even when
   the implementation is complete and committed on a kept branch.
   `noteFailures` then cascade-blocks every transitive dependent
   (:1673–1686, :1735–1742). Field cost: six dead reviewers → seventeen
   stranded tasks → full salvage relaunch.

## Design

Constraint that shapes everything: workflow scripts have **no wall clock and
no timers** (`Date.now`/`setTimeout` unavailable — grep-verified zero uses
in waves.js). The issue's "delayed retry with backoff" therefore cannot
sleep; this design delivers a **single barrier-positioned retry with no
backoff schedule** — the deviation from the issue's wording is deliberate
and disclosed (delay = the remainder of the wave's own runtime).

### 1. Null-guard the wave-merge dispatches (crash class → inexpressible)

After each of the two dispatches in `mergeWave` (merge, reconcile), a null
reply is normalized exactly like the existing catch branch:

```js
if (!merge) merge = { status: 'CONFLICT', detail: 'merge agent died (null reply — terminal overload); task branches intact' }
```

This routes a dead merge agent into the existing reconcile/`DEFERRED`
machinery instead of a TypeError. Mirrors the contended path's proven
guards. No new states, no new vocabulary.

### 2. Classify infra-death by the engine-minted marker only

`isInfraFault(msg)` is **one prefix test: `msg.startsWith('AGENT_NULL')`** —
the same unforgeable-marker discipline as `isSchemaTrip`'s engine-shape
regex. No free-text Overloaded/529 matching: `agent()` returns null rather
than throwing overload-worded errors, so a text matcher could only ever
match agent-authored or incidental error text and misclassify a genuine
failure into the park lane (trim-review catch).

All **three** null-reachable dispatch sites mint the marker:
- implementer (:1026–1030) — already throws `AGENT_NULL`, unchanged;
- reviewer dispatches r1/r2 (:1073–1086) — a null reply throws `AGENT_NULL`
  before any property access;
- **fix-round implementer dispatch (:1133)** — a null fix reply currently
  passes `noteConcerns` harmlessly then TypeErrors at `impl.status`
  (:1158) with a message no classifier matches; it gets the same
  `AGENT_NULL` throw (trim-review catch — without it, a mid-storm fix-round
  death silently keeps today's storm-retry behavior).

Non-infra faults (schema trips, structural errors) keep today's behavior
byte-for-byte: one immediate retry, escalate-on-schema-trip, then failed.

### 3. Park-and-retry at the wave barrier (cascade class → contained)

For an infra-death, `runTask` returns a transient marker
`{ task, status: 'parked-infra', ... }` instead of burning its single retry
into the live storm.

**Retry-pass position and mechanics (precise, per trim review):**

- The pass runs after the wave's chunked dispatch loop completes and
  **before** the `mergeable = results.filter(isMergeable)` computation
  (:1769) — so a wave whose tasks all parked cannot take the all-SKIPPED
  branch with stranded markers.
- **Budget checkpoint first** (the codebase invariant at :1354–1355: every
  dispatch site is budget-checkpointed): if `budgetExhausted()`, parked
  tasks route to the **deferred/unfinished lane** — the budget vocabulary
  (:1712, :1727) — never `failed`, so a budget event does not cascade-block
  dependents as a failure would.
- Parked tasks retry via `parallel()` chunked at 16 (matching :1670/:1723
  concurrency discipline) — the wave's tail is one task-duration, not N.
  One retry per task (`runTaskInner`, same tier, fresh worktree — the
  proven 0.1.14 self-heal semantics).
- **Marker replacement is in-place mutation** in both `results` and
  `taskResults`, per the chunkLost precedent (:1757–1759) — the transient
  marker is overwritten by the retry's real result, so `parked-infra` can
  never appear in report.json. Retry success → result joins the merge set;
  a `judgmentCalls` entry records park + recovery. Retry death →
  `status:'failed', reviewVerdict:'agent-error'` exactly as today, and
  `noteFailures` cascades as today.

**Same-wave WaW ordering under park — documented weakening (accepted):**
today a chunk-1 failure blocks a chunk-2 same-wave dependent (Fix B,
:1747–1751); a parked chunk-1 task is neither failed nor done when chunk 2
dispatches, so the dependent runs. If the barrier retry then fails, a
dependent that would have been blocked has already run against
`waveBaseSha` (the same tree either way). Accepted trade, disclosed: the
engine records a `judgmentCalls` entry when a same-wave dependent ran while
its parent was parked and the parent's retry then failed, and the
drain-administered suite gate is the backstop for any resulting integration
gap. (Alternative — treating parked as blocking-pending — would wrongly
block dependents in the common recovery case and add an un-blocking lane;
rejected as machinery.)

**The benign-case trade, named:** a single transient death today retries
immediately, overlapped with the running wave; under park it waits for the
barrier, appending up to one task-duration to the wave. That is the
deliberate trade for storm-correctness — an immediate retry into a
provider-wide storm is the defect being fixed.

### 4. What does NOT change

- Frozen periphery untouched (gate_check.py, ultra_gate.py, run_lock.sh,
  run_acceptance.sh, sealing). Report vocabulary unchanged — frozen
  gate_check.py (report fields, :120–140) sees no new token.
- No baked-prompt text changes → no re-bake; edits stay clear of the pinned
  prompt constants (test_no_prompt_drift.py green as-is).
- Terminal-failure cascade semantics and the schema-trip escalate path are
  unchanged.

## Verification (suite disposition; sim-sentinel obligation)

New `tests/sim_workflow.mjs` scenarios (agent() mocked per scenario;
`ALL SCENARIOS PASSED` sentinel discipline):

1. Null merge reply → synthesized CONFLICT → reconcile engages; no TypeError.
2. Null reconcile reply → synthesized CONFLICT → loop terminates via the
   existing attempt cap; run survives.
3. Dead reviewer (null reply) → task parks; barrier retry succeeds → wave
   merges; **zero** failed tasks recorded; `parked-infra` absent from the
   report.
4. Park retry dies again → task failed with reviewVerdict agent-error;
   dependents blocked — today's terminal semantics asserted.
5. Null fix-round reply → AGENT_NULL classification → park lane (not a raw
   TypeError retry).
6. Budget exhausted before the retry pass → parked tasks land in the
   deferred/unfinished lane, not failed; no cascade.

The multi-chunk WaW-under-park weakening is documented-accepted, not
sim-pinned. `python3 -m pytest` green; anti-drift pin green.

## Adds / Removes (author disclosure for trim review)

- Adds: one prefix-test classifier; `AGENT_NULL` throws at the two dispatch
  sites missing them (reviewer, fix-round); null-normalization after 2
  merge dispatches; a transient `parked-infra` marker + one budget-
  checkpointed, chunk-parallel barrier retry pass; 6 sim scenarios.
- Removes: the immediate same-tier retry **for infra faults only** (all
  other faults keep it).
- Explicitly rejected: wall-clock backoff (no timers); free-text overload
  classification (forgeable); new report vocabulary (frozen consumer);
  parked-as-blocking for same-wave dependents (wrongly blocks the common
  recovery case); unbounded retry loops.

## Trim review

_Reviewer: fresh-context subagent per distilling-proposals.md §Trim review;
inputs = spec rev 1 + issue #148 + waves.js + sim_workflow.mjs. Grade and
verdicts are the reviewer's; adopt-or-answer is the author's._

1. Narrow `isInfraFault` to the AGENT_NULL prefix; the ":954–958 phrasing
   enumeration" cited by rev 1 does not exist and free-text matching is
   forgeable. **ADOPTED** (§2).
2. Fix-round dispatch (:1133) is a third uncovered null site whose
   TypeError evades any AGENT_NULL classifier. **ADOPTED** (§2, sim 5).
3. Retry-pass position/replacement under-specified. **ADOPTED**: before
   :1769; in-place mutation per chunkLost precedent (§3).
4. No budget checkpoint; exhaustion-during-park unrouted. **ADOPTED**:
   checkpoint before the pass; exhaustion → deferred/unfinished lane (§3,
   sim 6).
5. Same-wave WaW ordering under park unresolved. **ADOPTED (option a)**:
   accept + document + judgment-call disclosure; suite gate named as
   backstop; alternative rejected as machinery (§3).
6. Retry-pass parallelism and the benign-case wall-clock trade unnamed.
   **ADOPTED**: parallel() chunked at 16; trade named (§3).
7. mergeWave null-guards minimal and correct. **CONFIRMED** — unchanged.
8. Uniform infra-death routing (implementer + reviewer + fix), not
   reviewer-only. **CONFIRMED** — unchanged.
- Scope: no material expansions; the no-backoff deviation from the issue's
  wording is now disclosed in §Design. **ADOPTED**.
- **Reviewer netConceptDelta grade: flat** — additions and the removed
  infra-class immediate retry net out; nothing escapes the harness
  boundary.
