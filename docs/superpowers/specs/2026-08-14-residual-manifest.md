# Residual manifest at finishing (#149)

_Spec 2026-08-14 (post-distill sweep), rev 2 after trim review. Issue #149.
complexityEffect: structural (derive-don't-remember); netConceptDelta graded
**up** by the trim reviewer (honest — see Trim review). Surfaces:
`skills/ultrapowers/references/finishing-notes.md` (the contract home),
`skills/ultrapowers/references/report-format.md` (pointer only),
`skills/ultrapowers/SKILL.md`, `skills/ultradocket/SKILL.md`, one NEW
non-frozen script + tests._

## Problem

report.json is a dead-end artifact at finishing: it emits three finding
families — `completenessFindings`, `judgmentCalls`, `deferredVerification`
(report-format.md:42/48/50) — but only `deferredVerification` has any
consumer (gate_check.py:140 NEEDS_ACK path + the finishing-notes checklist).
Whether the other two survive to release/close depends on orchestrator
memory; SKILL.md:244–248 documents the dependence outright ("carry prior
items forward yourself"). Field record: four runs, consequence escalating,
including a deferred ack that predicted the #107 incident verbatim and the
#147 shakedown findings that were never dispositioned before 0.2.1 released.

## Design

One mechanical derivation plus one mechanical, non-frozen close check. No
new judgment rule: every judgment slot is filled by the orchestrator or
operator; the machine only guarantees the slot exists, is filled, and
cannot silently shrink.

### 1. New script: `skills/ultrapowers/scripts/residual_manifest.py`

Non-frozen, advisory-by-construction. Two modes:

- **Derive:** `residual_manifest.py <report.json> [more-reports...]
  [--gate-acks <standing-approval.json>]` — emits the manifest: one row per
  distinct finding across all three families, unioned across every report
  passed (resume/redirect rounds each pass their report; the union is
  computed, never remembered).
  - **Row id = `<family>-<12-hex sha256 of the normalized finding text>`**
    — content-addressed so the same finding gets the same id in every
    round and the union dedupes on id (an array index would change across
    rounds and turn the union into concatenation — trim-review catch). A
    byte-identical duplicate within one report appends `-2`, `-3` … as a
    tiebreak.
  - **Row grammar (one line per row, exactly):**
    `- <id> [<family>] <text> — disposition: <value>`
    `--check` parses exactly this grammar; anything else in the file is
    ignored as commentary.
  - **Pre-fill from records, never from judgment:** with `--gate-acks`,
    deferredVerification rows whose item carries a recorded gate ack are
    emitted pre-dispositioned `acked` — that is derivation from a durable
    record, not auto-judgment. Everything else derives with an empty
    `disposition:` slot.
- **Check:** `residual_manifest.py --check <manifest.md>` — exit 0 iff every
  row's disposition is one of `fixed | acked | filed:<ref> |
  waived:<reason>`; exit 2 naming the undispositioned rows otherwise. A
  zero-row manifest passes (vacuously; fixture-pinned). Exit-code authority
  for the close ceremony **without touching any frozen gate script**.

**Canonical location:** `<runDir>/residual-manifest.md`, beside report.json
(the drain checks each entry's own runDir manifest).

### 2. Contract home: finishing-notes.md (single home)

The existing `## Deferred-verification checklist` section **becomes** the
`## Residual manifest` section — the one place the contract lives:

- Derivation and disposition are required at run close and drain-entry
  close; the finishing summary attaches the manifest.
- **The old per-item vocabulary (`closed | still-open | needs-human`) is
  superseded and deleted**, with the mapping stated in the section:
  `closed → fixed`; `still-open → filed:<ref>` (or `waived:<reason>` —
  staying open with neither a tracking ref nor a reason is exactly the
  evaporation this exists to kill); `needs-human → acked` (operator
  acknowledged, required action named in the row text). One vocabulary,
  not two grammars for the same objects.
- report-format.md changes by **one line only**: a pointer after the field
  table — the three finding-family arrays feed the residual manifest at
  finishing (see finishing-notes.md). No new contract section there.

### 3. Prose wiring (invocation only)

- `skills/ultrapowers/SKILL.md`: the finishing step runs derive (all
  rounds' reports) and dispositions every row before close; the :244–248
  "carry prior items forward yourself" text is replaced by the derivation
  instruction. **Resume gates derive + render the union only — `--check`
  enforcement happens solely at run close** (a mid-run Redirect round must
  not pay a full disposition ceremony for judgment calls still in flight —
  trim-review catch).
- `skills/ultradocket/SKILL.md` single end gate: each entry's manifest is
  part of the evidence block; drain close runs `--check` per entry.

### 4. What does NOT change

- Frozen gate scripts byte-identical: gate_check.py's NEEDS_ACK machinery
  is not extended (verified: its acks derive from `coverage` +
  `deferredVerification` only); ultra_gate.py and run_lock.sh untouched.
  The manifest is a layer above the gate, at the ceremony the gate feeds.
- report.json's schema: unchanged (nothing new is emitted by the engine).
- No harness JS → no .mjs sim; report-format.md is not a bake source → no
  re-bake. The `tests/test_report_runbook.py` pin must stay green.

## Verification (suite disposition)

`tests/test_residual_manifest.py`: derivation from a fixture report.json
(all three families), multi-report union dedupes by content id (same
finding in two rounds → one row), tiebreak ids for byte-identical
duplicates, `--gate-acks` pre-fills only recorded items, `--check` green on
fully dispositioned + zero-row manifests, red (exit 2, names rows) on a
missing/invalid disposition. `python3 -m pytest` green including the
report-runbook pin.

## Adds / Removes (author disclosure for trim review)

- Adds: one script (+1 test file), one contract section (relocating an
  existing one), pointer line, prose wiring in two SKILL.md files, one new
  mechanical close check.
- Removes: the "carry prior items forward yourself" memory-dependence text;
  the `closed | still-open | needs-human` vocabulary (superseded with a
  stated mapping).
- Explicitly rejected: extending gate_check.py NEEDS_ACK (frozen); a new
  report.json field; auto-disposition of anything the run has no durable
  record of (pre-fill is allowed exactly for recorded gate acks).

## Trim review

_Reviewer: fresh-context subagent per distilling-proposals.md §Trim review;
inputs = spec rev 1 + issue #149 + surfaces + frozen gate_check.py. Grade
and verdicts below are the reviewer's; adopt-or-answer is the author's._

1. Stable-id includes array index → breaks union/stability. **ADOPTED**:
   content-addressed id, index only as byte-identical tiebreak (§1).
2. Contract spread over two-and-a-half homes. **ADOPTED**: finishing-notes.md
   is the single home; report-format.md reduced to a one-line pointer (§2).
3. Two disposition vocabularies for the same items. **ADOPTED**: old triple
   superseded + deleted with stated mapping (§2).
4. Double-ack vs the gate's recorded acks. **ADOPTED** (narrowed as the
   reviewer proposed): `--gate-acks` pre-fill from durable records only (§1).
5. Persistence path + parse grammar unspecified. **ADOPTED**: canonical
   `<runDir>/residual-manifest.md`; exact one-line row grammar (§1).
6. Zero-findings + mid-run scope unspecified. **ADOPTED**: vacuous pass
   pinned; resume gates derive-only, `--check` at close only (§1, §3).
7. Keep the script, both modes (reviewer's own absorption search came up
   empty). **CONFIRMED** — no change.
- Scope expansion 1 (the check is functionally a new close check despite
  "no new gate" wording). **ADOPTED**: spec now says "one new mechanical,
  non-frozen close check."
- Scope expansion 3 (gitVerified doc absorption unrelated + untestable as
  written). **ADOPTED (dropped)**: removed from this spec; the
  report-format.md:79 gitVerified doc-sweep item stays a named residue for
  a future doc pass.
- **Reviewer netConceptDelta grade: up** — honest given the four escalating
  field incidents; kept minimally-up by trims 2+3 (single home, single
  vocabulary), which this revision landed.
