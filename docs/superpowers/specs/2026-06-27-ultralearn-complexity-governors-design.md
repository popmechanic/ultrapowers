# ultralearn complexity governors — design

**Date:** 2026-06-27 · **Status:** draft design, pre-plan (awaiting operator approval)
**Scope:** add two governors to the ultralearn loop so that turning findings into
fixes does not, over time, accrete the engine into untenable complexity — (1) a
distill rubric that prefers *consolidation* over additive guards, and (2) a
reproducible complexity metric that makes the consolidation cadence deliberate
instead of incidental. Skill/tooling change → **Acceptance:** suite.

---

## 0. TL;DR

ultralearn is a finding *generator* — 337 findings today, more every run. Its only
governor is the human gate at `distill` (nothing files without approval). That gate
controls *whether* a fix ships, but nothing biases *what kind* of fix gets proposed, and
nothing measures the accretion. Left alone, the path of least resistance is an additive
guard per finding — the fractal-complexity failure mode. This spec adds two cheap,
self-limiting governors:

- **G1 — distill prefers consolidation.** A proposal rubric (mirroring how
  `reading-lenses.md` instructs the readers) that makes every proposal classify its
  *complexity effect* and, for any recurring cluster, attempt a *representation-change*
  framing before an additive guard.
- **G2 — complexity ratchet.** A committed-baseline metric over the gate-spec surfaces
  (the same numbers this session computed by hand), surfaced at `distill` time and pinned
  the way baked prompts are pinned — so the sawtooth of "accrete, then consolidate" becomes
  intentional and visible.

Crucially, both are designed **not to become the disease they treat**: G1 is a rubric, not
a new code path; G2 is advisory measurement, **not** a hard CI wall that blocks every edit
adding a parenthesis.

## 1. Problem

### 1.1 The loop has no consolidation force
`SKILL.md` Verb 2 says distill should "cluster … rank by frequency × severity × novelty …
draft improvement proposals — each mapped to a real surface." Nothing in that instruction
distinguishes a fix that *adds a branch* from one that *removes a class of branches*. When a
cluster recurs, "add a guard for case N+1" is always the locally-cheapest proposal — and it
is exactly the move that stacks complexity fractally (the operator's stated anxiety).

### 1.2 The accretion is unmeasured
This session showed the accretion is measurable: clause density (parens/line) on
`report-format.md` = 0.59, the `judgmentCalls` field = one 1,059-char sentence, 7 distinct
embedded issue-refs, ~4,000 LOC of engine. None of these is tracked release-over-release, so
"are we getting more complex?" is answered by intuition, not data. A governor you cannot
measure is a governor you cannot enforce.

### 1.3 The trap to avoid
A naive response — a strict CI gate that fails when any gate-spec file gains a conditional —
would itself be accretion: new friction, new failure modes, new edge cases ("but this paren
is fine"). The governors must be lighter than the thing they govern.

## 2. G1 — distill prefers consolidation

### 2.1 A proposal rubric, parallel to the reading rubric
Today the readers have `references/reading-lenses.md`; the distiller has nothing equivalent.
Add `skills/ultralearn/references/distilling-proposals.md` — the rubric the distill agent
follows when drafting proposals. It requires every proposal to carry:

- **`complexityEffect`** — one of `additive-guard` | `structural` | `simplification`.
  - `additive-guard` — adds a conditional / field / rule that handles one case. *Accretes.*
  - `structural` — changes a representation so a class of cases can't occur. *Neutral/▼.*
  - `simplification` — removes a branch / field / rule. *▼.*
- **`consolidationAttempted`** — for any cluster seen in **≥3 runs** or **≥2 prior
  distills**, the proposal MUST first answer, in one line: *"can a representation change
  delete this whole cluster?"* If yes, the structural framing is the proposal and the
  additive guard is the fallback. If no, state why the guard is irreducible.
- **`netConceptDelta`** — does standing-concept count go up, flat, or down.

This is the discipline the P1 and `judgmentCalls` specs already model by hand
(`deferredVerification` is a `structural` consolidation; `judgmentCalls` C1 is a
`simplification`). G1 makes it the default, not a one-off.

### 2.2 SKILL.md hook
Verb 2's instruction gains one clause: *"draft each proposal against
`references/distilling-proposals.md`; prefer `structural`/`simplification` framings, and for
any recurring cluster record the consolidation attempt before proposing an additive guard."*

## 3. G2 — complexity ratchet

### 3.1 The metric basket (reproducible)
A new `skills/ultralearn/scripts/complexity_metric.py` computes, over a fixed set of
gate-spec surfaces (`SKILL.md`, `references/report-format.md`, and the other engine
`references/*.md`):

- `parensPerLine` per file (clause-density proxy),
- `longestRuleChars` — longest single rule-sentence (the `judgmentCalls` smell),
- `distinctIssueRefs` — count of embedded `#NN` guards,
- `engineLoc` — total lines of the engine surfaces.

It emits JSON and a one-line verdict against a committed baseline
(`skills/ultralearn/complexity-baseline.json`).

### 3.2 Ratchet semantics — soft, deliberate, not a wall
The baseline is the house pin pattern (`test_no_prompt_drift.py`,
`test_recommendation_rubric.py`): a committed expectation that a reviewed change may *update*,
but that flags an *unreviewed* regression.

- At **`distill`** time, the metric runs and is surfaced in the output: *"clause density
  on report-format.md rose 0.52 → 0.59 since the last baseline."* If any metric is over its
  baseline, distill's **top-ranked output for that surface is a consolidation pass**, not a
  new feature. This is the "make the sawtooth deliberate" mechanism.
- An **optional** `tests/test_complexity_ratchet.py` pins the baseline. It is **advisory by
  default** (asserts the baseline file is *current* and prints the deltas) rather than a hard
  fail on any increase — a hard fail would itself be friction-accretion (§1.3). A strict mode
  (fail on regression-without-baseline-bump) is available but off unless the operator opts in.
- The baseline is **re-stamped at release**, recording the metric under the shipping version —
  so the ledger's `engineVersion` and the complexity baseline tell one story: "what did this
  release cost in complexity, and was it bought down."

### 3.3 Why this is not itself fractal
G2 is ~1 script + 1 JSON + 1 optional advisory test. It adds no engine code path, no gate
disposition, no per-run behavior. It measures; it does not branch. Its cost is bounded and
its job is to *reduce* the thing it measures.

## 4. Complexity accounting

| | Today | After G1 + G2 |
|---|---|---|
| Force biasing proposal *kind* | none (additive is locally cheapest) | rubric prefers structural/simplification |
| Accretion measurement | intuition | reproducible basket + committed baseline |
| Consolidation cadence | incidental (`a87a52e`, `d2f8a7a` happened to land) | deliberate (distill prioritizes it when the ratchet is up) |
| New engine code paths | — | **0** (rubric + offline script + advisory pin) |
| Risk of governor-as-accretion | n/a | mitigated by soft-by-default (§3.2) |

## 5. Surfaces touched

- `skills/ultralearn/SKILL.md` — Verb 2 gains the rubric clause (G1) and the metric/ratchet
  step (G2).
- `skills/ultralearn/references/distilling-proposals.md` — **new** rubric (G1).
- `skills/ultralearn/scripts/complexity_metric.py` — **new** metric script (G2).
- `skills/ultralearn/complexity-baseline.json` — **new** committed baseline (G2).
- `tests/test_complexity_ratchet.py` — **new**, advisory (G2); and a small unit test for the
  metric script under the suite.
- Release procedure (`CLAUDE.md` versioning note, optional) — re-stamp the baseline at release.

No engine inner-loop code; no `waves.js` change; no wall-clock impact.

## 6. Open questions

- **Baseline ownership.** Co-locate `complexity-baseline.json` with the ultralearn skill (it
  is the governor's data) vs. with the engine it measures. Leaning: ultralearn (the governor
  owns its instrument).
- **Strict vs. advisory default.** Recommendation: advisory (§3.2). Revisit to strict only if
  the metric proves it is regularly ignored — i.e., let evidence, not fear, escalate it. (This
  is itself the G1 discipline applied to G2.)
- **Metric set.** The four-metric basket is a starting point; the script should make adding a
  metric a one-line registration, but the basket should stay small — a sprawling metric set
  would be its own accretion.
- **Scope creep guard.** G1's rubric must not grow into a gate that *blocks* additive guards
  (some edge cases genuinely are irreducible). It *prefers*, it does not *forbid*.

## 7. Provenance

The complexity-accretion architecture review in this session (2026-06-27): the operator's
concern that constant edge-case fixing stacks into an untenable codebase. These two governors
were the review's load-bearing recommendation — the move is not to stop fixing, but to make
consolidation a first-class, measured ultralearn output. Sibling specs:
`2026-06-27-deferred-verification-channel-design.md`,
`2026-06-27-judgmentcalls-renarrativization-design.md`.
