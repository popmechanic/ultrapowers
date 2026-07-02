# Durable docket `Notes` field + triage-disposition guard (#74) — Design

_Brainstormed 2026-07-02. Closes issue #74 (both parts)._

## Problem

Two findings from the first live `/ultradocket` shakedown:

1. **Triage rationale isn't durable.** `docket_lib.serialize_docket` emits only
   the known `Entry` fields, so triage rationale ("core fix already landed, verify
   & close"; "partly landed, re-scope to the remainder") has nowhere to live and is
   destroyed on the first `accepted → planned` transition. Only the `Score` line's
   free text survives — the shakedown packed rationale into `Score` as a workaround.
2. **Disposition is guessed at triage.** Triage prose never mentions acceptance
   disposition (decided at planning, sweep step 3), yet 3 of 7 triage scorers
   guessed `sealed`, conflating acceptance-mode with "self-contained." Everything
   ultrapowers builds is actually `suite`.

## Design

### Part 1 — a durable `**Notes:**` field

Mirror the existing `Engine` field addition, in `skills/ultradocket/scripts/docket_lib.py`:

- Add `notes: str = None` to the `Entry` dataclass (last field).
- Add `Notes` to the `_FIELD` regex alternation
  (`(State|Score|Est-files|Plan|Seal|Engine|Notes)`).
- In `parse_docket`'s `flush()`, pass `notes=fields.get("Notes") or None` into `Entry(...)`.
- In `serialize_docket`, emit `**Notes:** {e.notes}` when present, **after** the
  `Engine` block — the structured lifecycle fields (Plan/Seal/Engine) stay grouped
  and `Notes` is the free-text tail.

`transition` needs **no change**: it is `dataclasses.replace(entry, state=…)`,
which already copies every other field. The bug was purely that the field did not
exist, so it was dropped on serialize. Once `Notes` is a real `Entry` field it
round-trips through every transition for free.

`Notes` is general-purpose durable annotation: it carries triage rationale now, and
gives the sweep a home for re-scope notes and the drain a home for park reasons
later — one field, no new design. Free text; no validation.

### Part 2 — keep disposition out of triage (doc-only)

In `skills/ultradocket/SKILL.md` triage-mode prose:

- Add one line: triage does **not** assign an acceptance disposition — that's decided
  at planning (sweep step 3); do not guess `sealed`/`suite`.
- Document the `**Notes:**` field in the entry-format example and instruct triage to
  record its rationale there (instead of packing it into the `Score` line).

## Testing (Acceptance: suite)

- `tests/test_docket_lib.py` — keystone regression: parse an entry **with** `Notes`,
  `transition` it `accepted → planned`, serialize, re-parse → `notes` intact (the
  exact round-trip that dropped it before). Plus a plain parse→serialize→parse
  round-trip preserving `notes`, and that a `Notes`-less entry still serializes
  without an empty `**Notes:**` line.
- `tests/test_ultradocket_skill.py` — prose-contract: the triage section states
  disposition is decided at planning / not guessed at triage.

## Non-goals

- No validation on `Notes` (free text by design).
- No change to any other field, to `transition`, or to the drain's gate.
- No version bump (release is a separate operator ritual).
