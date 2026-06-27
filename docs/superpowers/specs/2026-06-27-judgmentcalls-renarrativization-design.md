# `judgmentCalls` re-narrativization — design

**Date:** 2026-06-27 · **Status:** draft design, pre-plan (awaiting operator approval)
**Scope:** collapse the report's `judgmentCalls` field reference — today the single
densest clause in the gate spec — into a four-kind taxonomy. Two options; the
recommended first step is **documentation-only, zero behavior change**. Engine/skill
change → **Acceptance:** suite.

---

## 0. TL;DR

`judgmentCalls: string[]` is pushed from ~20 sites in `waves.js` and documented as **one
1,059-character sentence** in `references/report-format.md:67` — the worst clause-density
spot in the spec (that file runs 0.59 parens/line). Two problems: the doc *only grows*
(every new edge case lengthens the sentence — the fractal mechanism, isolated in one
field), and severity is flattened (a benign "recovered after escalation" sits in the same
bucket as a "reviewer verdict/severity mismatch," which the operator must act on). Every
entry is already one of **four kinds** by what it asks of the operator. The recommended
fix (**C1**) re-narrativizes the *documentation* into that taxonomy with **no code or
schema change**; an optional follow-on (**C2**) makes the kinds structural so the gate can
treat the "disagreement" class as required-attention.

## 1. Problem

### 1.1 One sentence, ~15 enumerated cases
`report-format.md:67` enumerates, in a single sentence: implementer `DONE_WITH_CONCERNS`,
red baseline, reviewer verdict/severity mismatches, agent errors, budget deferrals (launch
+ first mid-run), merges without headSha, tasks done without mergeable coordinates, unknown
review depth/tier fallbacks, unknown baseline, three edge-binding cases, reviewer-no-verdict,
failed integration review, and tier escalations. New edge cases append here. This is the
accretion you can watch happen.

### 1.2 Producers are spread across ~20 sites
`grep -n judgmentCalls.push harnesses/waves.js` shows ~20 call sites. They already encode
their kind in the string prefix (`"task X: agent error …"`, `"edge A -> B: …"`,
`"run deferred: budget …"`), which is what makes C1 possible without touching them.

### 1.3 Severity is flattened
The presentation (§8: "bullet each non-obvious autonomous decision") gives an FYI and a
do-not-merge signal equal visual weight. The operator cannot triage at a glance.

## 2. The taxonomy hiding in the run-on

| Kind | Asks of the operator | Example entries |
|---|---|---|
| `autonomy` | nothing — a defensible call, FYI | escalation-recovered; fell back to default review depth/tier; convergent byte-identical output |
| `degradation` | verify the affected slice | budget-deferred; integration-review-deferred; agent-error |
| `disagreement` | **look before approving** | reviewer verdict/severity mismatch; reviewer returned no verdict; lost-coordinates; merge reported MERGED without headSha; suite-acceptance failed |
| `binding` | likely a plan typo | endpoint not in run; dependent before prerequisite; endpoints share a wave |

## 3. Options

### C1 — documentation-only re-narrativization (recommended first)
Schema and all ~20 push sites stay **byte-identical**. Rewrite only:
- `report-format.md:67` field reference: replace the 1,059-char sentence with the §2 table
  (kind → what it asks → examples).
- `report-format.md` §8 presentation: render `judgmentCalls` **grouped by kind**, using the
  existing string prefixes to bucket them; lead with `disagreement`, fold `autonomy` last.

Risk: ~zero (no code, no behavior, no schema). Payoff: kills the worst sentence in the spec;
new edge cases slot into an existing kind instead of lengthening prose; the operator gets
triage order for free. Your clause-density tripwire would register the drop on `report-format.md`.

### C2 — structural kinds (optional follow-on)
Change the schema to `judgmentCalls: { kind, note }[]`, tag each of the ~20 push sites, and
let the gate treat the **`disagreement`** class as a required-attention disposition (surface
it the way `coverage.complete: false` is surfaced, rather than as one bullet among many).
Real payoff (differential gate treatment), real cost (20 sites + tests + display + the
schema pin). Do this **only if** the kinds prove load-bearing at the gate after C1.

## 4. Recommendation

Ship **C1 now**; hold **C2** behind evidence. This sequencing is itself the discipline the
broader complexity concern asks for: *re-narrativize (cheap, reversible) before re-architecting
(expensive)*. C1 alone is expected to move `report-format.md` clause density meaningfully with
no risk surface.

## 5. Complexity accounting

| | Today | After C1 | After C2 |
|---|---|---|---|
| Doc form of the field | 1 × 1,059-char sentence | a 4-row table | a 4-row table |
| Cost of the next edge case | +1 clause to the sentence | **slots into a kind** | slots into a kind + 1 tagged push |
| Code / schema churn | — | **none** | 20 sites + schema + tests |
| Operator triage | flat | grouped by kind | gate-differentiated |

## 6. Surfaces touched

- **C1:** `references/report-format.md` only (field reference §67, presentation §8). No
  baked-prompt change, no `waves.js` change, no test churn beyond any doc-snapshot pin.
- **C2 (if pursued):** `report-format.md` schema, ~20 `judgmentCalls.push` sites in
  `harnesses/waves.js`, `SKILL.md` Step 5 (disagreement disposition), display, and schema
  pins. Note: several push sites are inside baked-prompt-adjacent code — confirm none are in
  baked prompt text before editing.

No inner-loop code is touched in either option → no wall-clock impact.

## 7. Provenance

ultralearn distill, 2026-06-27 (this session) + the complexity-accretion architecture review
that preceded it. `judgmentCalls` was identified as the single live hotspot where the
fractal-complexity concern is already true today. Sibling spec:
`2026-06-27-deferred-verification-channel-design.md`.
