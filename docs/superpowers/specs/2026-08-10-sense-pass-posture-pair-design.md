# Sense-pass posture pair (#141 + #142)

_Spec 2026-08-10. One plan covers docket entries #141 and #142. Prose-only:
two SKILL.md paragraphs, no scripts, no gate changes, frozen periphery
untouched. Both are first-formal-occurrence findings from the 2026-08-10
ultralearn sense pass; per machinery-earned-by-recurrence, each gets prose,
not machinery._

## Problem

1. **#141:** `harvest_runs.py` detects runs by an actual `Workflow`
   tool_result, so the 2026-08-10 docket drain (4 plans / 9 tasks, zero
   Workflow calls — subagent-driven and inline engines) produced 0 bundles.
   The harvester's "0 new" was *correct behavior*, but nothing records that
   drains are sensed another way, so each future sense pass rediscovers the
   gap. This recurs by design: the execution-fit rubric honestly routes small
   maintenance portfolios off the waves engine.
2. **#142:** the same drain dispatched 9 implementer tasks with **zero
   independent reviewers**; the only review artifact was one orchestrator
   diff read. Outcome was clean (suite gates held, redirect canary 0), but
   the posture narrowing was silent — the drain flow nowhere declares what
   review a drain runs, and the end gate did not record what was used.

**Operator decision (recorded at brainstorm, 2026-08-10): posture (b) —
suite-gate authority with review-by-exception.** Rationale (spec-side, not
repeated in the SKILL prose): the execution-fit rubric already routes every
risk-flagged plan to the ultrapowers engine, whose waves carry built-in
per-task review; drain plans on the sequential engines are by construction
the low-risk residue; the per-plan exit-code suite gate is the correctness
authority; canary history shows implementer-caused defects ≈ 0 across the
corpus.

## Design

### 1. `skills/ultralearn/SKILL.md` — Verb 1 (sense), Harvest step (#141)

Append at the **end of step 1** (after the watermark sentence), indented as
part of the list item (an unindented paragraph would visually orphan steps
2–3):

> Sequential-engine drains (subagent-driven, inline) make no `Workflow`
> calls and are **invisible to this detector by design** — "0 new" there is
> correct, not a bug. Drains are sensed by **commissioned transcript
> reads**: after a drain, dispatch readers at the drain session's
> transcript with the same five lenses, including the redirect-round count,
> assigned to exactly one reader. Readers MUST set `evidenceAbstracted:
> true` (no bundle triggers the foreign rule), stamp `engineVersion` (plain
> version string — the repo release at drain time), and use the drain
> session id as `runId`; the merge guard then forces only `origin: foreign`
> — accepted. Promote trigger for a drain detector: a sense pass where
> commissioned reads **miss or misread** drain evidence; record the miss as
> a ledger finding.

Four clauses are load-bearing (rounds 2–3): `merge_ledger.py` drops an
unflagged non-home finding **whole** (R2-F2), so without `evidenceAbstracted`
a home-drain read silently merges zero findings and falsely trips this
paragraph's own promote trigger; without a stated `runId` two drains'
same-titled findings collide into one ledger row (R2-F3); `engineVersion`
survives the merge untouched when the lookup misses (R3-F-2), so stamping it
keeps drain findings visible to distill's staleness weighting and the
canary's version comparison — only `origin` is genuinely forced; and the
redirect-round canary is mandated per *bundle* in reading-lenses, which a
bundle-less commissioned read would silently skip (R3-U-3) — un-monitoring
exactly the population posture (b) needs watched. Accepted residual (R3-U-6):
home-drain verbatim evidence pointers degrade to shape under forced
abstraction — noted for the standing watch-item's consumer.

### 2. `skills/ultradocket/SKILL.md` — run mode (#142)

**2a.** Insert a **Review posture** paragraph after the wrapper's numbered
list (after step 5), immediately before the `### The exam-gated
auto-approve` heading:

> **Review posture: suite-gate authority, review by exception.** The drain
> dispatches no per-task reviewer of its own, and its step-2 dispatch
> instructs the sequential executor to skip its review passes — per-task
> and final — the step-3 gate is the verification. One exception: each task
> its plan marks `**Review:** adversarial` (from `launch_waves[].review`
> of step 3's own `compile_plan` run — no extra compile) gets one fresh
> review via `superpowers:requesting-code-review` against the diff from
> docket-line HEAD plus the plan text, before the plan's gate;
> Critical/Important findings park the entry exactly as a red gate does
> (Minor: noted at the end gate). Posture drift after this declaration is
> the recurrence that buys enforcement.

Four semantics notes (spec-side, deliberately not in the SKILL prose):
the `**Review:**` marker becomes engine-relative — in waves `adversarial`
buys a *second* review pass over lean's one, in a drain it buys *one* over
the default zero. "Per-task **and final**" (R3-U-4): subagent-driven
development carries two review layers, and posture (b) suppresses both —
the drain's own portfolio end gate is the human review point; leaving the
final branch review formally alive would contradict both the gate-authority
framing and the observed drain. The step-3 compile read costs nothing
(R3-F-1): the drain already compiles every entry's plan to read
`acceptance.mode`, and that same stdout carries `launch_waves[].review` —
round 2's "one extra compile per escalated check" was wrong in both
directions. The escalated set is expected to be near-empty (the rubric's
risk override routes risk-marked plans to waves) — the exception is the
safety valve that makes posture (b) acceptable, not a working lane; naming
`requesting-code-review` (a fixed, audited skill) as its referent keeps the
rare escalation from re-creating the improvised-review posture #142 fixes,
one layer down. Known compliance seam (R3-U-5, accepted at occurrence #1):
the skip instruction asks the executor to bypass its own review loop and
compliance is self-reported at the end gate — the closing sentence carries
the issue's own recurrence trigger for exactly that drift.

**2b.** In "The single end gate", extend the per-entry evidence list —
"Per entry: exam evidence (raw runner JSON), engine, cost, disposition
(`executed`/merged or `parked` + reason), and branch" — with: **review
posture used (suite-gate authority, or the escalated tasks named)**.

## Constraints

- Net addition ≤ 120 words per file (the complexity cost stays visible;
  trims elsewhere welcome but not required).
- No other section of either SKILL.md changes. No test pins either file's
  prose (`test_recommendation_rubric.py` reads only the hook and ultraplan's
  SKILL.md — verified); the suite is regression cover for tooling only, so
  review of these edits is by reading, not by test.
- No scripts, no schema, no gate or harvester code: the moment either
  paragraph needs enforcement, that is the *next* occurrence's evidence, not
  this change.

## Acceptance

**Acceptance:** suite — prose-only edits; the committed suite proves the
tooling and pinned spans are unaffected; there is no behavior to exam.

## Complexity accounting

Adds two paragraphs and one list item (≤ 240 words total); deletes nothing;
zero machinery, zero knobs. No `complexityEffect` value applies — this is a
recorded-decision change, not a proposal (the schema's three values cover
proposals). The escalation exception is a conditional behavioral rule — an
additive rule in prose — adopted as part of the operator's posture decision
and completed (findings path, marker source) rather than shipped
half-specified. `netConceptDelta` graded by the trim reviewer below.

## Trim review

**Author disclosure (Adds/Removes).** Adds: one paragraph to the ultralearn
sense verb, one paragraph + one end-gate list item to the ultradocket run
mode; the escalation exception (operator-chosen posture (b) shape).
Removes: nothing. No surfaces beyond the two files the docket entries name.

**Reviewer:** fresh-context subagent (seal-author independence model),
inputs = spec + issues #141/#142 + doctrine + both SKILL files + marker/pin
verification across ultraplan, compile_plan, waves.js. Verdicts and
adjudication (operator adjudicates at spec review):

| # | Finding | Adjudication |
|---|---|---|
| T1 | Cut the ~35-word rationale clause from the posture paragraph (restates auto-approve text + the spec's own rationale) | **Adopted** — rationale lives spec-side only |
| T2 | Delete the trailing trigger-clarification clause in §1 | **Adopted** |
| T3 | Drop the pre-named `sessionKind: drain` detector schema — option-1 design smuggled into a prose fix | **Adopted** — trigger names the recurrence, not the build |
| T4 | "complexityEffect: prose-only" invents a fourth schema value | **Adopted** — states "no value applies" instead |
| T5 | Pin-verification instruction was vacuous (no test pins either file) | **Adopted** — constraint states it honestly: review by reading |
| U1 | Escalation clause was review theater — no findings path, no reviewer inputs | **Adopted (completed, not cut)** — red findings park the entry exactly as a red gate; **inputs side superseded by R2-F4** (reviewer referent named in round 2) |
| U2 | `**Review:** adversarial` semantics silently become engine-relative; drain never told where to read the marker | **Adopted; marker source superseded by R2-F1** — round 1's `tasks[].review` pin was false against the code; the real channel is `launch_waves[].review` |
| U3 | Insertion point 2a self-contradictory (steps 3–5 sit between the named anchors) | **Adopted** — anchored after step 5, before the heading |
| U4 | **Commissioned reads break the merge step**: no bundle ⇒ origin fails closed to `foreign` (home evidence force-redacted) + no `engineVersion` *[engineVersion half superseded — see R3-F-2: a stamped value survives the merge]* — and the paragraph institutionalized the path without saying so | **Adopted; description superseded by R2-F2** — round 1's "verbatim evidence dropped" understated it: unflagged findings are dropped *whole*; the fix is the readers-set-`evidenceAbstracted` clause |
| U5 | Promote-trigger miss has no recorded home | **Adopted** — "record the miss as a ledger finding" |
| U6 | Executor-skill tension: does posture (b) suppress the sequential executor's built-in review or only add none? | **Adopted** — paragraph says both, explicitly |

Rejections: none. Scope verdicts adopted: §1's mechanism sentences warranted
(one line alone is unfollowable); the end-gate item is the issue's own
demand, not growth; the escalation is the one expansion with behavioral
surface — reviewer's condition ("complete it in one clause or cut it")
satisfied by completion.

**Reviewer grade: `netConceptDelta = up` (modest, mostly legitimate)** —
naming a previously silent practice adds named concepts by construction;
T3/T4 shaved it toward flat but cannot reach it. Recorded as graded: this
pair spends concept budget to make two silent behaviors inspectable, which
is the trade the operator's triage accepted.

**Reviewer marginal-value self-assessment:** three findings change the
built artifact (U1+U2 escalation completion, U3 insertion point, U4 merge
misclassification — "the catch I'd insist on"); the rest wording and
accounting hygiene.

### Round 2 (second independent reviewer, operator-requested)

Fresh-context subagent, no knowledge of round 1's dispatch; verified every
claim against code, including a live `compile_plan.py` run on a marked
plan. Verdicts and adjudication:

| # | Finding | Adjudication |
|---|---|---|
| F1 | **FALSE against code:** round 1's `tasks[].review` field does not exist (real channel: `launch_waves[].review`, compile_plan.py:1466), and the drain holds NO compile output for sequential engines *[this half is itself false — see R3-F-1: step 3 compiles every entry]* | **Adopted; cost claim superseded by R3-F-1** — the channel was right, but "one extra compile" was wrong: drain step 3 already compiles every entry's plan for `acceptance.mode`, and that stdout carries the marker — zero extra compiles |
| F2 | **Behavior-zeroing omission:** `merge_ledger.py:27` drops unflagged non-home findings *whole*, and the reading-lenses foreign rule never fires without a bundle — commissioned reads as round-1-specified would merge zero findings and falsely trip the promote trigger | **Adopted** — readers MUST set `evidenceAbstracted: true`; load-bearing note kept in §1 |
| F3 | `runId` unspecified — same-titled findings from two drains would collide in the ledger | **Adopted** — drain session id as `runId` |
| F4 | Escalation reviewer still had no inputs (round 1 completed only the output side); the baked reviewer brief is waves-specific | **Adopted** — referent named: `superpowers:requesting-code-review` against the branch diff from docket-line HEAD + plan text |
| F5 | §1 insertion anchor self-contradictory (same defect class round 1 fixed only in §2) + un-indented paragraph would orphan list steps 2–3 | **Adopted** — anchored at end of step 1, indented |
| T-A | Marker-source clause replaced, not kept (with F1) | **Adopted** |
| T-B | The "(per exam-gated auto-approve)" citation was wrong — that section governs *operator* checkpoints, not executor reviewer passes | **Adopted** — replaced with the actual mechanism (step-2 dispatch instructs the executor to skip reviewer passes) |
| T-C | §1 word-count headroom trims to fund F2's clause | **Adopted** |
| T-D | Post-blockquote commentary duplicated the U4 table row | **Adopted** — rewritten to carry the new F2/F3 content only |

Rejections: none. Scope verdicts: both paragraphs reconciled as earned;
the escalation mechanics are the completion option (b) implies —
"completed *wrongly* (F1) and *partially* (F4)" in round 1, now corrected.

**Round-2 reviewer grade: `netConceptDelta = up`** — independent
concurrence with round 1 ("naming two silent behaviors cannot be flat; not
`down` on any reading").

**Round-2 marginal value:** three artifact-changing findings (F1, F2, F5;
F4 conditionally) — notably, two of the three were defects in round 1's
own adopted fixes.

### Round 3 (third independent reviewer, operator-requested)

Fresh-context subagent; verified by live compile of a Review-marked plan,
full merge-path read, and the requesting-code-review skill in the plugin
cache. Verdicts and adjudication:

| # | Finding | Adjudication |
|---|---|---|
| F-1 | **Round 2's own fix false in both directions:** drain step 3 already compiles every entry's plan (for `acceptance.mode`), and that stdout carries `launch_waves[].review` — the escalation read costs ZERO extra compiles, not "one per escalated check" | **Adopted** — §2a: "the `compile_plan` run step 3 already performs — no extra compile" |
| F-2 | "No `engineVersion` — accepted cost" concedes more than the code requires: the field survives the merge untouched when the lookup misses; only `origin` is forced | **Adopted** — readers stamp `engineVersion` with the running release; drain findings stay visible to distill staleness weighting + the canary's version comparison |
| U-3 | The redirect-round canary is mandated per *bundle*; a bundle-less commissioned read would silently skip it — un-monitoring exactly the population posture (b) needs watched | **Adopted** — §1: "including the mandatory redirect-round count (one per drain)" |
| U-4 | "Skip per-task reviewer passes" left subagent-driven's *final whole-branch review* formally alive — one review short of unambiguous | **Adopted** — "per-task and final"; the portfolio end gate is the human review point |
| U-5 | The spec silently dropped issue #142's own recurrence trigger; executor compliance with the skip is self-reported | **Adopted** — closing sentence restored to the SKILL paragraph; compliance seam recorded spec-side as accepted at occurrence #1 |
| U-6 | Forced abstraction degrades home-drain verbatim evidence pointers for the standing watch-item's consumer | **Adopted** — acknowledged as accepted residual in §1's notes |
| T1 | Cost-claim parenthetical replaced by the shorter true one | **Adopted** (with F-1) |
| T2 | "The end gate states the posture used" duplicated §2b | **Adopted** — deleted; word budget funded U-5's sentence |
| T3 | Both files were ~3–5 words over the spec's own ≤120 bound | **Adopted** — cured by T1/T2 trims |

Rejections: none. Scope: reconciled; the one quiet drop (the issue's
recurrence trigger) restored per U-5.

**Round-3 reviewer grade: `netConceptDelta = up`** — third independent
concurrence.

**Round-3 marginal value:** two artifact-changing findings (F-1 — itself
round 2's adopted fix; F-2) plus two one-clause completions (U-3, U-4);
the rest wording and accounting.

### Round 4 (fourth independent reviewer — the diminishing-returns check)

Fresh-context subagent; re-verified both round-3 corrections against code
(live compile: `--check` prints only PLAN OK, so drain step 3 necessarily
runs the plain compile whose stdout carries the marker; full merge-path
re-run: stamped `engineVersion` survives and renders in the digest). Both
held. Verdicts and adjudication:

| # | Finding | Adjudication |
|---|---|---|
| T4-1 | §1 breached the spec's own ≤120-word bound (126 by wc -w); round 3's "cured by trims" was false for the ultralearn file (its trims were §2-side) | **Adopted** — §1 trimmed to ≤120; counts re-verified |
| U4-1 | "One per drain" contradicts reading-lenses' per-reader canary mandate — N readers would emit N canary rows, inflating the redirect-round rate posture (b)'s safety case leans on | **Adopted** — "assigned to exactly one reader" |
| U4-2 | `engineVersion` stamp shape/referent unpinned (an epoch-object mimic would render as a dict; "running release" ambiguous mid-session) | **Adopted** — "plain version string — the repo release at drain time" |
| U4-3 | "Red findings" is not the referent skill's vocabulary (Critical/Important/Minor); multi-escalation plural unhandled | **Adopted** — Critical/Important park, Minor noted at end gate; "each task" |
| T4-2 | Two historical table rows still carry false code claims their supersessions never annotated inline | **Adopted** — bracket annotations added |

Rejections: none. Below-the-bar notes (notation, inline-engine vacuity,
digest run-count cosmetics) recorded by the reviewer, no action.

**Round-4 reviewer grade: `netConceptDelta = up`** — fourth independent
concurrence.

**Stopping decision (author, applying the pre-declared rule):** diminishing
returns reached, per the round-4 reviewer's own assessment: "round 4 found
no false mechanism claims, only arithmetic and coordination seams," and
both substantive round-3 corrections survived full code verification.
Four rounds, 35 findings, all adopted or explicitly superseded, 0 rejected;
grades: up ×4 (unanimous — the accepted trade for making two silent
behaviors inspectable).
