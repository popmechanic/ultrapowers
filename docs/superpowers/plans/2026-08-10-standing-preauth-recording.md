# Standing Pre-Authorization Recording (#128) Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Standing pre-authorization at NEEDS_ACK becomes a sanctioned, recorded lane — anchored to the existing ack taxonomy, consumed per gate, with the record written before the merge.

**Architecture:** Prose plus one sidecar convention, across three doc surfaces. The approve receipt is written by frozen `ultra_gate.py`, so the record lives at the orchestrator layer: a `standing-approval.json` sidecar per gate that uses the lane, with report-format.md holding the canonical rendering requirement and SKILL.md cross-referencing it.

**Tech Stack:** Markdown only. No scripts, no schema, no tests.

**Acceptance:** suite — doc-only change; the committed suite is the regression net (no executable behavior to pin, per the anti-pin doctrine).

## Global Constraints

- Frozen periphery untouched: no `ultra_gate.py` / `gate_check.py` edits, no new receipt field in the frozen writer's output.
- The lane covers ONLY `deferredVerification` items with reason `runtime` or `external`; `coverage.complete: false` acks and any ack naming an operator-environment mutation or a data-integrity surface always require a fresh operator turn.
- Ambiguity about whether an instruction covers a gate always resolves to a fresh ack.
- report-format.md is the canonical home of the rendering requirement; SKILL.md cross-references it, never restates it (no new prose mirror).

---

### Task 1: The sanctioned lane across three doc surfaces

**Type:** implementation
**Review:** adversarial
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/SKILL.md`
- Modify: `skills/ultrapowers/references/report-format.md`
- Modify: `skills/ultralearn/references/reading-lenses.md`

**Interfaces:**
- Consumes: nothing from other tasks (single-task plan).
- Produces: the standing-pre-authorization lane definition (SKILL.md Step 5), the canonical rendering clause (report-format.md Approve bullet), and one sense-side watch line (reading-lenses.md operator lens).

- [ ] **Step 1: SKILL.md — the NEEDS_ACK lane**

In `skills/ultrapowers/SKILL.md` Step 5, replace the exact line

```
- **2 (NEEDS_ACK)** → present the acks for explicit operator acknowledgement first.
```

with

```
- **2 (NEEDS_ACK)** → present the acks for explicit operator acknowledgement
  first. Acting on **standing pre-authorization** instead is sanctioned when ALL
  of the following hold: the operator gave an explicit forward-looking approval
  instruction earlier in the session (or in the launch directive), quotable
  verbatim, that addresses the ack disposition or the gate-outcome class
  ("approve if clean apart from the usual runtime acks" qualifies; "merge when
  done" does not — it says nothing about acks); every ack being consumed is a
  `deferredVerification` item with reason `runtime` or `external` — a
  `coverage.complete: false` ack, or any ack naming an operator-environment
  mutation or a data-integrity surface, is outside every standing grant and
  needs a fresh turn; the full ack list plus the verbatim instruction and
  where/when it was granted is rendered per the report-format.md Approve
  rendering clause; and `run-<stamp>/standing-approval.json` is written FIRST:
  `{"grantedAt": "<turn or timestamp>", "instruction": "<verbatim>",
  "ackList": [...]}`. A grant is consumed per gate presentation — each gate
  that uses it writes a fresh sidecar, and that consumption counts as the
  explicit operator disposition for the items it lists, those items only. Any
  ambiguity about whether an instruction covers this gate resolves to a fresh
  ack.
```

- [ ] **Step 2: SKILL.md — the Approve bullet's three words**

In the same Step 5, replace the exact text

```
- **Approve** — only on PASS (or an acknowledged NEEDS_ACK). Run
```

with

```
- **Approve** — only on PASS (or a NEEDS_ACK acknowledged fresh or via a
  recorded standing grant). Run
```

- [ ] **Step 3: report-format.md — the canonical rendering clause**

In `skills/ultrapowers/references/report-format.md`, in the **Approve** bullet (the line beginning `- **Approve** — before any gate decision, assert the session checkout is clean`), after the sentence ending "…require the same explicit operator acknowledgement as `coverage.complete: false` before Approve (the green suite does not cover it).", insert:

```
 When approval acts under a recorded standing grant (SKILL.md Step 5 defines
  the lane and its limits), the rendered gate presentation includes the full
  ack list being consumed plus the verbatim standing instruction and where it
  was granted — the same content as the run's `standing-approval.json`
  sidecar, so the transcript and the disk agree; this rendering clause is the
  canonical statement of that requirement.
```

- [ ] **Step 4: reading-lenses.md — the sensor line**

In `skills/ultralearn/references/reading-lenses.md`, in the numbered lens list, extend lens 3 (**operator**) by appending to its text:

```
 Watch specifically for a NEEDS_ACK approved under a claimed standing
   instruction with no printed ack list or standing-approval sidecar — that
   recurrence is what would buy an enforcement guard.
```

- [ ] **Step 5: Run the suite (pinned-prose regression net)**

Run: `python3 -m pytest`
Expected: exit 0 — proves none of the three edits landed inside a pinned span (`test_recommendation_rubric.py`, `test_no_prompt_drift.py` and friends stay green).

- [ ] **Step 6: Commit**

```bash
git add skills/ultrapowers/SKILL.md skills/ultrapowers/references/report-format.md skills/ultralearn/references/reading-lenses.md
git commit -m "docs(#128): standing pre-authorization at NEEDS_ACK — sanctioned, taxonomy-anchored, recorded per gate"
```

### Task 2: Slicer short-turn check (spec rider)

**Type:** manual
**Depends-on:** none

**Files:** (none — investigation only)

- [ ] **Step 1: Verify the salvage-no-ack observation against the raw transcript**

One of the three field observations behind this change (a salvage decision with
no visible operator reply) may be a harvester slice artifact. Read the raw
transcript for that session's salvage decision and check whether a short human
turn exists that the slicer dropped. If the turn exists and was dropped, file
the slicer bug as its own issue — do not widen this change.

### Task 3: Suite gate

**Type:** gate
**Depends-on:** 1

**Files:**
- Test: `tests/`

- [ ] **Step 1: Run the full suite**

Run: `python3 -m pytest`
Expected: exit 0, no failures.
