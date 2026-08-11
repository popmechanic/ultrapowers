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

Append one paragraph to step 1, immediately after the sentence describing
detection by `Workflow` tool_result (SKILL.md lines 16–17):

> Docket drains executed via the sequential engines (subagent-driven,
> inline) make no `Workflow` calls and are **invisible to this detector by
> design** — "0 new" on a drain session is correct, not a bug. Drains are
> sensed by **commissioned transcript reads**: when a drain has run since
> the last pass, dispatch reader subagents at the drain session's
> transcript with the same five lenses. Their findings enter the ledger
> through the same merge guard; with no cached bundle, origin fails closed
> to `foreign` (verbatim evidence dropped) and no `engineVersion` attaches
> — an accepted fidelity cost at this occurrence count. Promote trigger for
> a real drain detector: a sense pass where commissioned reads **miss or
> misread** drain evidence; record the miss as a ledger finding.

The merge-guard sentence is load-bearing honesty (trim-review U4): without
it the paragraph instructs a read whose findings silently misclassify — the
conservative default (redacted, versionless) is *accepted*, and a distill
degraded by that fidelity loss is itself promote-trigger-relevant evidence.

### 2. `skills/ultradocket/SKILL.md` — run mode (#142)

**2a.** Insert a **Review posture** paragraph after the wrapper's numbered
list (after step 5), immediately before the `### The exam-gated
auto-approve` heading:

> **Review posture: suite-gate authority, review by exception.** The drain
> dispatches no per-task reviewer of its own and auto-advances the
> sequential executors' built-in review checkpoints (per "The exam-gated
> auto-approve" below) — the step-3 gate is the verification. One
> exception, read from the `tasks[].review` field of the compile output the
> drain already produces: a task marked `**Review:** adversarial` gets one
> fresh independent reviewer before the plan's gate, and red findings park
> the entry exactly as a red gate does. The end gate states the posture
> used.

Two semantics notes (spec-side, deliberately not in the SKILL prose): the
`**Review:**` marker becomes engine-relative — in waves `adversarial` buys
a *second* review pass over lean's one, in a drain it buys *one* over the
default zero; and "no reviewer of its own" plus "auto-advances built-in
checkpoints" together mean posture (b) suppresses both sources of per-task
review, which is exactly the previously-silent narrowing, now declared.
The escalated set is expected to be near-empty (the rubric's risk override
routes risk-marked plans to waves) — the exception is the safety valve that
makes posture (b) acceptable, not a working lane.

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
| U1 | Escalation clause was review theater — no findings path, no reviewer inputs | **Adopted (completed, not cut)** — red findings park the entry exactly as a red gate; completing preserves the operator's chosen posture shape |
| U2 | `**Review:** adversarial` semantics silently become engine-relative; drain never told where to read the marker | **Adopted** — marker source pinned (`tasks[].review` from the drain's own compile output); semantics shift flagged spec-side |
| U3 | Insertion point 2a self-contradictory (steps 3–5 sit between the named anchors) | **Adopted** — anchored after step 5, before the heading |
| U4 | **Commissioned reads break the merge step**: no bundle ⇒ origin fails closed to `foreign` (home evidence force-redacted) + no `engineVersion` — and the paragraph institutionalized the path without saying so | **Adopted** — the paragraph now owns the conservative default as an accepted fidelity cost; a degraded distill is promote-trigger evidence |
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
