# Standing pre-authorization at NEEDS_ACK, recorded (#128) — design

**Date:** 2026-08-10
**Status:** trim-reviewed, awaiting operator review
**Acceptance:** suite
**Origin:** docket sweep (issue #128, accepted score 6; operator-decided
direction at distill 2026-08-09: sanction-with-recording). Field evidence:
three NEEDS_ACK→merge transitions riding an earlier standing "approve if clean"
instruction with no fresh operator turn (julian-gate ×1, parity sweep ×2); the
2026-08-09/10 frontier session's own gate showed the same emerging pattern
(operator ack-adjudication increasingly delegated to the orchestrator's drafted
recommendation).

## Background

The Step-5 gate's NEEDS_ACK verdict asks for "explicit operator
acknowledgement." In practice operators grant standing authorization early
("if the gate comes back clean apart from the usual runtime acks, approve") and
walk away — which is the autonomy objective working, not a violation. What is
missing is the **record**: today the approve receipt shows nothing about which
instruction authorized the merge or which ack list was consumed under it. The
consent was never missing — the record was.

**Frozen constraint (binding):** the approve receipt is written by
`ultra_gate.py`, which is frozen periphery. Unless the eval route is taken,
recording lives at the **orchestrator/SKILL layer** — a sidecar plus prose,
never an `ultra_gate.py` edit. (Docket note, carried from triage.)

## Design

All three changes are documentation plus one orchestrator-written sidecar
convention; no script changes, no frozen files.

### 1. SKILL.md Step 5 — the sanctioned lane

Add to the NEEDS_ACK bullet: acting on **standing pre-authorization** is
sanctioned when all of the following hold —

- the operator gave an explicit forward-looking approval instruction earlier in
  the session (or in the launch directive), quotable verbatim, **that
  addresses the ack disposition or the gate-outcome class** ("approve if clean
  apart from the usual runtime acks" qualifies; "merge when done" does not —
  it says nothing about acks). **Any ambiguity about whether an instruction
  covers this gate resolves to a fresh ack** (trim review finding 1);
- the lane covers **only** `deferredVerification` items with reason
  `runtime` or `external` (the existing report-format taxonomy — trim review
  finding 2). Explicitly outside any standing grant, always needing a fresh
  operator turn: `coverage.complete: false` acks, and any ack naming an
  operator-environment mutation or a data-integrity surface (a named-surface
  veto on top of the taxonomy anchor, same ambiguity-→-fresh-ack default);
- before running `--approve`, the orchestrator **prints the full ack list** it
  is consuming under that authorization, together with the verbatim instruction
  and where/when it was granted (rendering shape canonical in
  report-format.md — see §2);
- the orchestrator writes `run-<stamp>/standing-approval.json` first:
  `{"grantedAt": "<turn or timestamp>", "instruction": "<verbatim>",
  "ackList": [...]}`.

**Per-gate consumption** (trim review finding 3): a standing grant is consumed
per gate presentation — each gate that uses it writes a fresh sidecar listing
the acks consumed at that gate, and that consumption counts as the "explicit
operator disposition" that removes those items from the resume-gate union —
those items only, nothing more.

A NEEDS_ACK with **no** standing grant still requires a fresh operator ack —
unchanged. The Approve bullet's "only on PASS (or an acknowledged NEEDS_ACK)"
gains three words: acknowledged fresh **or via a recorded standing grant**
(trim review finding 4 — otherwise the two bullets conflict on the page where
the merge decision is made).

### 2. report-format.md — Approve rendering line (the canonical statement)

The Approve bullet gains one clause: when approval acts under a standing grant,
the rendered gate presentation includes the printed ack list + instruction (the
same content as the sidecar), so the transcript and the disk agree.
**report-format.md is the canonical home of the rendering requirement**;
SKILL.md's condition cross-references it rather than restating it (trim review
finding 6 — avoids minting a new unpinned prose mirror).

### 2a. Sense-side watch line (instruction-only)

One line added to the ultralearn reading-lenses operator-lens cues: watch for
the standing-approval lane being used **without** its sidecar/printed record —
that recurrence is what buys an enforcement guard later (trim review finding 7:
the no-enforcement stance is only honest if some sensor can see the miss).

### 3. Implementation-time check rider (not machinery)

One of the three field observations (salvage-no-ack) may be a harvester slice
artifact: while implementing, verify the slicer preserves short human turns
(read the raw transcript for that session's salvage decision). If the turn
exists and was dropped, file the slicer bug separately; do not widen this spec.

## Non-goals

- No `ultra_gate.py` / `gate_check.py` change; no new receipt field in the
  frozen writer's output.
- No new ack taxonomy, no auto-approve logic change — the drain's exam-gated
  auto-approve is a different, already-sanctioned lane and is untouched.
- No enforcement machinery (nothing verifies the sidecar exists — this is a
  recording convention; if field evidence later shows the lane used without the
  record, that recurrence buys the guard).

## Tests

None — prose surfaces only (`SKILL.md`, `references/report-format.md`, one
line in `skills/ultralearn/references/reading-lenses.md`). The suite
disposition covers "nothing regressed"; there is no executable behavior to
pin. (If the operator prefers a pin, a one-line pytest asserting the
Step-5 section names `standing-approval.json` is cheap — default is no new
pin, per the anti-pin doctrine.)

## Acceptance

`suite` — doc-only change; the committed suite is the regression net.

## Complexity accounting

`complexityEffect: structural` (prose + one sidecar convention) — the change
records an existing practice rather than adding behavior. No knobs, no guards,
no scripts. The sidecar-for-receipt-field substitution and the exclusion
clause are expansions relative to the issue's literal text, both named in the
trim review; the exclusion clause narrows autonomy, not widens it.

## Trim review

**Author disclosure (Adds/Removes):** Adds — the sanctioned-lane definition,
one sidecar convention, one rendering clause, one sense-side watch line.
Removes — the ambiguity at the consent gate (unrecorded standing approvals).

**Reviewer verdicts** (fresh-context dispatch; grounded in issue #128,
SKILL.md Step 5, report-format.md; scrutiny brief: consent at the single human
gate, under-specification is the dangerous direction):

1. Grant definition self-judged by the merging agent; "merge when done" would
   qualify — **UNDERSPECIFIED (the central risk)**. → **Adopted**: instruction
   must address the ack disposition/gate-outcome class; ambiguity resolves to
   a fresh ack.
2. Exclusion clause floats free of the ack taxonomy — **UNDERSPECIFIED +
   EXPANSION (safe direction)**. → **Adopted**: lane anchored to
   `deferredVerification` reason `runtime`/`external` only;
   `coverage.complete: false` explicitly outside; mutation/data-integrity kept
   as a named-surface veto. Expansion kept (it narrows autonomy), now named.
3. Grant lifetime vs the resume-gate union rule — **UNDERSPECIFIED**. →
   **Adopted**: per-gate consumption, fresh sidecar per gate, consumption =
   disposition for the listed items only.
4. SKILL Approve bullet's "acknowledged" undefined against the new lane —
   **UNDERSPECIFIED (minor)**. → **Adopted**: "fresh or via a recorded
   standing grant".
5. Sidecar over receipt field — OK (faithful lateral substitution honoring the
   frozen constraint; explicitly not trimmed to print-only).
6. Same content in three places — **TRIM (weak)**. → **Adopted**:
   report-format.md is canonical; SKILL.md cross-references.
7. No-enforcement stance — OK as doctrine, honest only with a sensor. →
   **Adopted**: one watch line in the reading-lenses cues.
8. Slicer rider — OK, bounded.
9. No tests / pin declined — OK per anti-pin doctrine.
10. Scope — stayed within `structural`; expansions named.

**Reviewer grade:** `netConceptDelta: flat` — conditional on findings 1–3
being anchored to the existing ack taxonomy rather than new self-adjudicated
vocabulary; the adopted resolutions take exactly that route.
