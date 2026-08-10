# Redirect-lane derivation pair (#131 + #127) — design

**Date:** 2026-08-10
**Status:** trim-reviewed, awaiting operator review
**Acceptance:** suite
**Origin:** docket sweep (issues #131 accepted score 8, #127 accepted score 7 —
PLAN-TOGETHER cluster: both fixes land in `redirect_args.py` + its tests + one
SKILL.md bullet each). Field evidence: redirect run `wf_e5afc7c1-dd4`
(2026-08-10, home) and 3/3 foreign sessions exercising the micro-redirect lane
(julian-gate, pdf-triage, parity sweep).

## Background

The sanctioned micro-redirect lane (#115) relaunches only the amended tasks of a
gated run: the orchestrator authors `findings.json`, `redirect_args.py` applies
it to copies of the launch artifacts and emits `redirect-args.json` with
`resume: true`. Two derivation gaps surfaced in the field:

1. **#127 — the integration branch is begged for, not derived.** The helper
   requires `--integration-branch` or a `gate-receipt.json` beside the receipt,
   yet the argsFile it already loads carries `integrationBranch` (stamped at
   launch). 3/3 sessions exercising the lane stumbled on the first call —
   exactly the friction the deterministic helper exists to remove.
2. **#131 — the relaunch inherits the prior launch's `heads/` sidecar slots.**
   The redirect renumbers waves 1..k, so a prior run with more waves leaves a
   stale higher-numbered `wave-<n>` slot. The completeness critic's baked
   authority rule — "the highest-numbered wave-<n> slot is your detach target" —
   then resolves to a pre-redirect tree. In `wf_e5afc7c1-dd4` only the critic's
   mtime judgment prevented a wrong detach; the derive-don't-record sidecar was
   briefly the wrong authority. (`finalize_report.py` was unaffected — it keys
   off the report's own waves.)

Both are the same disease: a relaunch coordinate that should be **derived from
run state** is instead hand-supplied (#127) or **inherited stale** (#131). The
fix for each makes the wrong value inexpressible; neither adds a guard.

## Goal

A redirect relaunch authored through `redirect_args.py` (the only sanctioned
lane) needs **zero hand-supplied coordinates** in the common case, and cannot
present a stale `heads/` slot to any consumer of the relaunch's sidecars.

## Non-goals

- No harness JS change, no prompt re-baking, no `.mjs` sim obligation: the
  critic's detach-target rule and the merge prompts stay byte-identical — the
  fix removes the stale slot rather than teaching every consumer to detect it.
- No change to the frozen periphery (`gate_check.py`, `ultra_gate.py`,
  `run_lock.sh`, sealing).
- No namespacing of `heads/` by wf-run ID (rejected: it would touch three baked
  prompts, `finalize_report.py`, the drift pins, and the sims — a representation
  change an order of magnitude larger than the defect, and clearing at emit
  achieves the same inexpressibility).

## Design

### 1. Integration-branch derivation (#127)

`redirect_args.py` derivation order becomes:

1. `--integration-branch` flag, when supplied (explicit operator override — a
   CLI flag that is silently outranked by a recorded value would be a trap).
2. the argsFile's own `integrationBranch` (the common case: stamped at launch
   for every run the driver emitted; present on every redirect of a redirect,
   since the emitted `redirect-args.json` carries it too).
3. `gate-receipt.json` beside the receipt (legacy fallback, unchanged).
4. loud error (unchanged text).

Note this diverges from the issue's literal ordering (argsFile → flag →
receipt): the issue simultaneously says "the flag … stay[s] as override", which
the literal ordering cannot deliver. Flag-wins is the resolution — bare, with
no disagreement warning (trim review finding 3: a warning branch is a small
standing guard on a repair path; dropped).

No SKILL.md edit for this half: the micro-redirect bullet's documented
invocation is already `--receipt … --findings …` with no gate-receipt or flag
mention — the code change alone makes the documented command line correct
(trim review finding 4; the issue's proposed SKILL edit had no referent).

### 2. `heads/` cleared at emit time (#131)

As its **last step, only after `redirect-args.json` has been successfully
written**, `redirect_args.py` deletes the prior launch's `heads/` directory.
The target is pinned to the directory the relaunch's merge agents will write
into — `<dirname(receipt)>/heads/` — **independent of `--out-dir`** (trim
review finding 6: `--out-dir` redirects only the emitted files; clearing a
different directory would leave the stale slots live and silently reintroduce
the bug). Effects:

- The relaunch starts with no `heads/`; the merge/reconcile agents recreate it
  (`mkdir -p` is already in their baked prompts) and write only the redirect's
  own slots. The critic's highest-numbered-slot rule can then only resolve to a
  slot the relaunch wrote — the stale-slot state is inexpressible.
- `finalize_report.py --heads <runDir>/heads` reads the relaunch's slots, as
  now.
- A helper failure before emit (unknown task, empty instruction) leaves
  `heads/` untouched — a validation death must not strip a healthy run's
  sidecars (trim review finding 7).

Deletion, not archival (trim review finding 5): the prior slots' shas are
already durably recorded — the redirect lane runs post-gate, so
`finalize_report.py` has copied them into the finalized `report.json`, and the
task branches still resolve them — so an archive convention
(`heads-prior-<k>/`) would buy nothing but a new name. This stays inside the
helper's existing contract ("never mutates the originals"): `heads/` is run
exhaust regenerated by every launch, not a launch artifact.

**Salvage lane rider (prose only).** The Salvage bullet in SKILL.md composes
relaunch args by hand and does not run `redirect_args.py`, so it inherits the
same stale-slot hazard. Add one sentence to the Salvage bullet: before
relaunching, delete `<runDir>/heads/` the same way (the shas are already in the
finalized report). First-occurrence prose per the machinery-earned-by-recurrence
bar; if a salvage run is later observed skipping it, the helper grows a
`--salvage` mode then.

## Tests (pytest, `tests/test_redirect_args.py`)

1. argsFile carries `integrationBranch`, no flag, no gate-receipt → exit 0,
   emitted args carry that branch (the #127 acceptance test).
2. Flag supplied alongside a differing argsFile value → emitted args carry the
   flag value (bare flag-wins).
3. Neither flag nor argsFile key nor gate-receipt → loud error (the existing
   test covers this; confirm it still binds rather than duplicating it).
4. `heads/` exists with slots beside the receipt → after a successful emit,
   `heads/` is gone; with `--out-dir` pointing elsewhere, the receipt-side
   `heads/` is still the one cleared.
5. A validation failure (unknown task id) → `heads/` untouched.
6. No `heads/` → emit succeeds, nothing created.

## Acceptance

`suite` — scripts + tests + SKILL prose only; the committed pytest suite is the
verification. No harness JS is touched, so the suite-gate's `.mjs` obligation
does not arm.

## Complexity accounting

`complexityEffect: structural` for both halves (a derivation replaces a
hand-supplied input; a clear makes a stale state inexpressible). No new knobs,
no new guards, no new filesystem conventions.

## Trim review

**Author disclosure (Adds/Removes):** Adds — derivation step in
`redirect_args.py`, `heads/` clear at emit, one Salvage prose sentence, tests.
Removes — the hand-supplied `--integration-branch` requirement, the
gate-receipt hunt, the stale-slot state.

**Reviewer verdicts** (fresh-context dispatch per distilling-proposals §Trim
review; grounded in `redirect_args.py`, `finalize_report.py`, SKILL.md Step 5,
the waves.js heads span, and the existing tests):

1. argsFile derivation — OK.
2. Flag-wins reordering, divergence disclosed — OK (justified correction).
3. Disagreement warning + its test — **TRIM (narrow)**: an undeclared small
   guard. → **Adopted**: bare flag-wins; warning and test dropped.
4. SKILL.md micro-redirect edit — **TRIM (delete)**: the current bullet has no
   gate-receipt/flag mention; nothing to drop. → **Adopted**: no SKILL edit for
   the #127 half.
5. `heads-prior-<k>/` archival — **TRIM (narrow)**: deletion achieves identical
   inexpressibility with zero new concepts; the shas are already durable in the
   finalized `report.json` and the task branches. → **Adopted**: delete, not
   archive (the redirect lane runs post-gate, so the report is always finalized
   by then — the reviewer's own loss-proofing counterargument does not bind).
6. Clear-target vs `--out-dir` — **UNDERSPECIFIED**. → **Adopted**: target
   pinned to `<dirname(receipt)>/heads/`, independent of `--out-dir`; test 4
   covers it.
7. Clear ordering vs helper failure — **UNDERSPECIFIED**. → **Adopted**: clear
   is the last step, only after a successful emit; test 5 covers it.
8. Salvage prose rider — OK.
9. Non-goal (no `heads/` namespacing) — OK, "the spec's strongest structural
   judgment".
10. Loud-error test already exists — OK. → **Adopted**: test 3 reframed as
    confirm-binds.

**Reviewer grade:** `netConceptDelta: flat` as drafted; the reviewer noted
adopting trims 3–5 "would tip it to down" — all three were adopted.
