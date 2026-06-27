# Deferred-verification channel — design

**Date:** 2026-06-27 · **Status:** draft design, pre-plan (awaiting operator approval)
**Scope:** generalize the report's `visualEyeballItems` field into a single
reason-tagged `deferredVerification` channel, and route its sandbox-unreachable
reasons through the gate's existing false-green acknowledgement. Closes the
runtime-bound false-green gap (ultralearn P1) **without** adding a parallel field.
Engine/skill change → **Acceptance:** suite.

---

## 0. TL;DR

The pre-merge report already carries `visualEyeballItems: string[]` — deliverables the
completeness critic found *present and structurally complete* but whose behavior is
"only confirmable in a browser." ultralearn's #1 cross-project failure mode (false-green
that merged, then crashed in the target runtime) is the **same predicate with a
different reason**: the sandbox could not execute the behavior. The naive fix adds a
second field (`runtimeBoundDeliverables`); that is pure accretion. This design instead
**parameterizes the reason** — one channel, a `reason` enum — and feeds the
sandbox-unreachable reasons into the gate disposition that already exists for
`coverage.complete: false`. Net: **0 new top-level fields, 0 new gate concepts**, and
future "sandbox can't reach X" cases slot into the enum instead of spawning fields.

## 1. Problem

### 1.1 `visualEyeballItems` is a special case of a general predicate
`references/report-format.md:66` defines `visualEyeballItems` as deliverables present
and structurally complete "but whose behavior can only be confirmed in a browser or live
UI (the 'needs a browser' channel, #4afb)." The general predicate underneath it is:

> a deliverable the completeness critic confirmed is present and structurally complete,
> but whose **behavior the sandbox could not execute** — verified-by-construction only.

"Browser" is one *reason* the sandbox can't execute it. There are others.

### 1.2 The runtime-bound false-green (the gap)
ultralearn observed (epoch 0.0.24, foreign): a run reported all-green and merged, but the
feature was broken in the target runtime in exactly its designed-against failure mode —
the defect lived in an out-of-sandbox runtime no in-engine test could reach, and the one
runtime-capable check sat *past* the merge gate as a runbook item, so the gate read green.
`visualEyeballItems` would not have caught this: the reason is "runtime," not "browser."

### 1.3 The accretion trap
Adding `runtimeBoundDeliverables` as a sibling field — and later `externalServiceItems`,
`deviceItems`, … — is the fractal-complexity pattern this repo is trying to avoid. Each is
the same concept with a different reason, but each costs a field, a presentation section,
and a gate clause.

## 2. Design

### 2.1 Replace the field with a reason-tagged channel
```jsonc
// REPLACES  "visualEyeballItems": { "type": "array", "items": { "type": "string" } }
"deferredVerification": { "type": "array", "items": { "type": "object",
  "required": ["deliverable", "reason"],
  "properties": {
    "deliverable": { "type": "string" },
    "reason": { "type": "string", "enum": ["browser", "runtime", "external", "manual"] },
    "why":  { "type": "string" }   // one line: what specifically the sandbox can't check
}}}
```

Reason semantics:
- `browser` — confirmable only in a browser/live UI (the old `visualEyeballItems`, verbatim).
- `runtime` — core behavior only reproduces in a target runtime the sandbox can't run
  (server boot, device, deploy target). **The 1.2 gap.**
- `external` — depends on a service/credential/network the sandbox can't reach.
- `manual` — requires human judgment (aesthetic, product-fit). Absorbs the
  "passed every gate yet failed the operator's actual goal" findings.

### 2.2 Gate rule — reuse, do not invent
The gate already has the exact disposition this needs. `SKILL.md` Step 5 / `report-format.md`
§7 + Approve: `coverage.complete: false` ⇒ "do NOT Approve without explicit operator
acknowledgement of the false-green." A non-empty **`runtime`** or **`external`** group is the
same kind of structural blindness — green cannot see it — so it **routes into that same
acknowledgement disposition**. `browser` and `manual` stay as the present "verify, then
approve" checklist (today's §9a behavior). One new *input* to an existing rule; no new gate
*concept*.

### 2.3 Where the field is produced
The completeness critic emits this list. Its prompt is baked into `waves.js` from
`references/reviewer-prompts.md` (anti-drift). The change is a prompt edit: instruct the
critic to tag each deferred item with its reason rather than emitting bare strings. The
budget-deferred early-return path in `waves.js` (~line 871) that sets `visualEyeballItems: []`
becomes `deferredVerification: []`.

## 3. Complexity accounting

| | Naive P1 (sibling field) | This design (parameterized) |
|---|---|---|
| New top-level report fields | +1 | **0** (`visualEyeballItems` → `deferredVerification`) |
| New gate dispositions | +1 | **0** (reuses `coverage.complete` ack) |
| Cost of the next "sandbox can't reach X" case | +1 field, +1 section, +1 clause | **+1 enum value** |
| Net standing concepts | 2 parallel specials → N | **1 parameterized concept** |

This change is complexity-*negative* relative to the two-special-case trajectory. It is the
engine modeling the consolidation discipline (prefer a representation change that deletes a
class over a guard that handles one case).

## 4. Surfaces touched (migration)

- `references/report-format.md` — schema, field reference, presentation §9a (rename +
  group by reason), and the Approve disposition wording in §7 / Approve bullet.
- `references/reviewer-prompts.md` — completeness-critic prompt: emit reason-tagged items.
  **Then re-bake `harnesses/waves.js`** per `references/workflow-template.md` and keep
  `tests/test_no_prompt_drift.py` green (never edit only the baked copy).
- `harnesses/waves.js` — the budget-deferred early-return literal; the field name in the
  returned report object.
- `skills/ultrapowers/SKILL.md` — Step 5 gate: the new `runtime`/`external` ⇒ acknowledgement input.
- Viewer/display + any test pin referencing `visualEyeballItems`.

No inner-loop (per-task / per-wave) code is touched → no wall-clock impact; this is
single-gate / single-critic logic.

## 5. Open questions

- Migration vs. additive: rename `visualEyeballItems` outright (cleaner, one breaking field
  rename) vs. keep it as a deprecated alias for one release. Recommendation: rename — the
  field is internal to the report contract, and the drift test + schema pin make the rename safe.
- Should `manual` route to acknowledgement too, or stay advisory? Leaning advisory (it is not a
  *sandbox* blindness, it is a goal-fit question) — but the "failed the operator's actual goal"
  findings argue for at least surfacing it adjacent to the gate, not buried in the runbook.

## 6. Provenance

ultralearn distill, 2026-06-27 (this session). Cluster: "false-green / sandbox-bounded gate,"
sev-3, observed through epoch 0.0.24. Sibling spec:
`2026-06-27-judgmentcalls-renarrativization-design.md`.
