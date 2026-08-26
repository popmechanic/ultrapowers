# Fold-over-git head recording (#259)

**Status:** approved framing (operator comment on #259, 2026-08-25) — build the
fold-over-git variant, not the deterministic-driver-write variant. #241 resolved
NO-GO on the queue runtime, so this is the live bounded fix for the worst
mutate-in-place smell in the repo: multiple model-compliant writers hand-
maintaining `<runDir>/heads/`, which is really a materialized view of git
ancestry.

**Acceptance:** suite (default disposition; no seal).

## Problem

Today three agent roles (merge, reconcile, contended-adopt) each carry a ~150-word
"record heads mechanically" prompt block that shell-redirects `git rev-parse`
into `<runDir>/heads/task-<id>` and `heads/wave-<n>` slots, plus a per-dispatch
`headsSlotsLine` naming the concrete slots. The completeness critic derives its
detach target as "the highest-numbered `wave-<n>` slot", and `finalize_report.py`
copies slot bytes into `report.json` headSha fields at gate time.

Two live defect classes:

1. **Misfiling** (3 harvested runs): cheap-tier agents writing `wave-1` when told
   `wave-3` — model compliance is the only thing holding the convention.
2. **Unsound resume derivation**: "highest-numbered slot" breaks under
   resume-round slot reuse; #222 papers over it by rotating `heads/` →
   `heads-<n>/` per round, but the derivation itself remains a convention the
   critic must trust.

Git already records every fact the slots duplicate: task branches are never
deleted post-merge, and the integration branch's ancestry *is* the merge history.

## Design

Git is the append-only ledger. Merge/reconcile/adopt agents stop writing
`heads/` entirely. The slots become a **derived view**, computed once by
deterministic code in `finalize_report.py` from integration-branch ancestry at
finalize time, written into the report's headSha fields (no slot files are
materialized — nothing reads them any more). The completeness critic derives its
detach target from git itself instead of from slot files.

The frozen periphery (`gate_check.py`, `ultra_gate.py`, `run_lock.sh`, sealing)
is untouched and consumes the exact same report fields.

### 1. Prompt deletions (baked sources)

In `references/wave-merge.md` (re-baked into `harnesses/waves.js` per
`references/workflow-template.md`, drift pin `tests/test_no_prompt_drift.py`):

- **MERGE_PROMPT / RECONCILE_PROMPT**: delete the entire "Before you report,
  record heads mechanically FROM THE LAUNCH DIRECTORY … re-record." block and
  the "After the heads are recorded and" prefix on the sweep sentence (sweep
  stays, now gated only on "only if you are reporting MERGED").
- **CONTENDED_MERGE_PROMPT STEP adopt**: same block deleted; the TEST_FAILED
  branch drops "and write no slots".
- **waves.js plumbing**: delete `headsSlotsLine` and every `slotsLine`
  threading (`mergeWave`, `contendedMerge` signature and dispatch sites).
- **§Derived Task Heads** prose: rewritten to describe this contract (see §5).

Agents still *report* `headSha` in their structured JSON (MERGE_SCHEMA
unchanged) — the engine uses it in-run for `waveBaseSha` (contended fold base,
review base) and the critic's recorded-vs-derived cross-check. Those values
remain what they already were post-#123: context, never authority.

### 2. Completeness critic (COMPLETENESS_PROMPT + COMPLETENESS_ANCESTRY)

- **Detach target**: instead of reading `heads/`, the critic — already required
  to cd into the integration worktree and verify `git branch --show-current`
  prints the integration branch — runs `git rev-parse HEAD` there; that value is
  `<derived>`, its detach target; then `git checkout --detach` and re-confirm.
  Correct on every resume round by construction: the integration branch tip IS
  the tree the run produced, whatever round produced it. An unresolvable
  branch/HEAD reports BLOCKED with no findings, as today.
- **Recorded cross-check**: unchanged in mechanism — `{{MERGE_HEAD_SHA}}` (the
  model-recorded merge sha) stays context; if non-empty and ≠ `<derived>`,
  BLOCKED with the mismatch finding, reworded to name "derived integration tip"
  instead of "derived heads/ slot".
- **Ancestry assertion**: `mergedShas` entries become `{task, branch}` (branch
  from the same implementer report the merge agent merged — one fewer
  transcription hop than the slot scheme, which also rooted in that name; the
  model-typed `headSha` is dropped entirely — nothing reads it under the new
  contract [trim 3]). Authority is `git rev-parse <branch>`: for each entry
  the critic resolves the branch tip itself and asserts
  `git merge-base --is-ancestor <tip> HEAD`; an unresolvable branch is treated
  exactly as an ancestry miss. `ancestryMisses` entries keep their
  `{task, headSha}` schema shape, `headSha` now carrying the resolved branch
  tip (or the resolution failure). The "Authoritative shas live in
  `<runDir>/heads/`" paragraph is replaced by "Authoritative shas live in git:
  the branch tips you resolve yourself and the integration HEAD you derived".
- **BLOCKED coverage**: the BLOCKED-with-no-findings clause explicitly covers a
  *failing detach* (dirty/conflicted integration worktree on a blocked-wave
  run), not just an unresolvable branch/HEAD [flag 3].

### 3. finalize_report.py — the ancestry fold

New CLI: `--report --repo --branch <integrationBranch>` (drop `--heads`).
Envelope handling is kept: `select_target` still accepts both a top-level and a
`result.*`-wrapped `waveMerges` — SKILL.md Step 5 feeds the saved result
envelope, so this shape is load-bearing [flag 4]. Fails loudly (exit 1, naming
the fact) on every anomaly; rewrites atomically only on full success; never
falls back to token-reported values. Steps:

1. `tip := git rev-parse --verify <branch>` — unresolvable branch fails.
2. For each **MERGED** `waveMerges` entry, for each task id in its `branches`:
   the branch name comes from the report's `tasks[]` entry (absent → fail);
   `tipB := git rev-parse --verify <branch>` (unresolvable → fail); assert
   `git merge-base --is-ancestor tipB tip` (miss → fail — a task the report
   says merged but git says never landed cannot pass finalize);
   set `tasks[].headSha := tipB`.
3. **Final wave head.** When the final `waveMerges` entry's status is MERGED,
   `headSha := tip` (reconcile agents legitimately append test-fix commits
   after the last branch merge; the tip is the run's true final tree, and it
   is what the frozen head-match compares against the branch at gate time).
   **Intermediate** MERGED entries' `headSha` values are left as
   model-recorded — no mechanical consumer of an intermediate wave head exists
   anywhere in the repo (`gate_check.py` and `harvest_runs.py` read only
   `waveMerges[-1]`; salvage reads `tasks[].headSha`), so deriving them would
   be machinery without a consumer [trim 1]. report-format.md documents them
   as context, not authority.
4. **Recorded-vs-derived note.** Where a model-recorded value being
   overwritten (a merged task's `headSha`, or the final entry's) differs from
   the derived value, print a warning naming both — context for the operator,
   never blocking (blocking on it would re-elevate model tokens to authority
   and re-introduce the misfiling class as false BLOCKs).

There is **no debris check** [trim 2]: by loop construction every non-MERGED
`waveMerges` entry with a non-empty `branches` list is terminal, so any run it
could fire on already lacks `waveMerges[-1].headSha` and blocks at the frozen
wave-merges shape check; failing finalize there would only deny salvage the
derived `tasks[].headSha` values.

Round-transparency: the fold reads only the live report's waves/branches; the
final-entry tip rule and per-task branch resolution are correct on any round
by construction (the integration branch tip IS the run's tree, whatever round
produced it).

### 4. Rotation (#222) and skill text

- `rotate_round_artifacts` keeps its `isdir`-guarded `heads/` rename (it still
  handles dirs from pre-change runs); new runs simply never create `heads/`.
  Round numbering already keys off `report-<n>` as well.
- SKILL.md Step 5: finalize invocation becomes
  `--report <saved-result.json> --repo . --branch <integrationBranch>`
  (ordering pin `test_finalize_wiring.py` unchanged in spirit).
- `references/report-format.md`: headSha-provenance row rewritten (final wave
  head + merged task heads derived from git by finalize_report.py; slot
  sidecars gone); intermediate `waveMerges[].headSha` documented as
  model-recorded context, not authority; the frontier row's "`heads/` slot
  precedent" phrasing updated.
- **Prose consumers of the dead convention** [flag 5], all updated in the same
  change so no operator instruction contradicts the build: SKILL.md redirect
  prose ("the relaunch's merge writes a fresh `heads/`", "never clear `heads/`
  by hand"), `redirect_args.py` docstrings making the same claim,
  `harvest_runs.py`'s "file-derived, post-#114" comment, `wave-merge.md`'s
  substitution-order paragraph and the waves.js comment naming `<runDir>` "the
  heads/ sidecar dir".

### 5. Tests

- `tests/test_finalize_report.py`: rewritten against real git fixtures — happy
  two-wave, reconcile-fixup tail (final wave = tip), dropped-task (ancestry
  miss fails), unresolvable branch, missing tasks[] branch, envelope-shaped
  report (`result.waveMerges`), intermediate-wave headSha left untouched,
  non-MERGED-last-entry untouched, MERGED-without-recorded-headSha final entry
  still gets tip.
- `tests/sim_derived_heads.mjs`: rewritten to pin the new contract — merge/
  reconcile/adopt prompts carry NO slot instructions (assert absence of
  `<runDir>/heads` in every dispatched merge-side prompt), critic prompt
  carries the git-derived detach contract and per-branch ancestry authority.
  Keeps the `ALL SCENARIOS PASSED` sentinel (suite-gate requirement).
- `tests/frontier_merge.mjs`: slot-name assertions replaced by
  no-slot-instruction assertions on the contended dispatch.
- `tests/wave_ancestry_sim.mjs`: asserts the `{task, branch}` shape and the
  new ancestry wording reach the critic.
- `tests/sim_workflow.mjs`: incidental stub text updated only if an assertion
  depends on slot wording.
- `tests/test_no_prompt_drift.py`: unchanged (same BAKE block names; content
  changes flow through source + re-bake).

## What this trades away (named honestly)

Today the `heads/wave-<n>` slot is a **merge-time snapshot**; the frozen
head-match compares it to the gate-time branch tip, so *any* movement of the
integration branch between merge and gate blocks. Under the fold, the final
MERGED wave's derived head is the tip as read at **finalize time**, so a plain
(non-merge) commit appended to the integration branch in the critic→finalize
window by an outside writer would not trip head-match. Compensating controls,
all unchanged: RUN_LOCK + clean-tree (frozen), the critic's
recorded-vs-derived cross-check at critic time (movement before the critic
diverges from the merge agent's recorded sha → BLOCKED), finalize's
per-task ancestry assertions and recorded-vs-derived warning, and head-match
still catching finalize→gate movement. The narrowed window is hypothetical (no
writer commits to the integration branch there by design — the critic
detaches, freeing the branch); the deleted failure class is live (3 harvested
runs + the unsound resume derivation). Verdict: accept.

Second named change [flag 1]: the tip rule **heals** today's
"MERGED-without-headSha" soft failure. A final wave reporting MERGED with no
recorded sha currently leaves the gate to block on the wave-merges shape check;
under the fold the final MERGED entry deterministically gets the tip, so that
degraded case becomes gate-passable (the in-run judgmentCall and `waveBaseLive`
freeze still fire). Accepted deliberately: the tip is git truth — blocking a
run because a model omitted a token the gate no longer needs would be the old
convention's failure mode, kept alive for no consumer.

Not in scope: any change to gate_check.py semantics, sealing, run_lock, or the
rotation grammar; materializing slot files (nothing reads them); deriving
intermediate wave heads (no consumer — trim 1).

## Trim review

**Author disclosure — Adds:** finalize ancestry fold (`--branch` arg, per-task
rev-parse + is-ancestor, final-entry tip rule, recorded-vs-derived warning);
critic git-derived detach + branch-resolving ancestry; `mergedShas` branch
field. **Removes:** three baked record-heads prompt blocks; `headsSlotsLine` +
all `slotsLine` threading; the slot-file grammar and `heads/` dir; the
"highest-numbered slot" critic derivation; `--heads`/`read_slot`; `mergedShas`
model-typed `headSha`.

**Reviewer verdicts** (fresh-context dispatch, 2026-08-26; grade
`netConceptDelta: down` — "down as written and further down with the trims"):

1. *Delete the `landed()` binary search for intermediate wave heads* —
   **ADOPTED.** Consumer census confirmed: `gate_check.py` and
   `harvest_runs.py` read only `waveMerges[-1]`; salvage reads
   `tasks[].headSha`. Intermediate heads stay model-recorded context (§3).
2. *Delete the debris check* — **ADOPTED.** Non-MERGED entries with branches
   are terminal by loop construction; the frozen shape check already blocks
   those runs, and failing finalize would deny salvage its derived task heads.
3. *Drop `headSha` from `mergedShas`* — **ADOPTED.** Nothing reads it under
   the new contract; `{task, branch}` is the shape (§2).
4. *Merge the warning into the fields actually overwritten* — **ADOPTED**
   (follows from 1; §3 step 4).

**Under-specification flags:** (1) tip rule heals MERGED-without-headSha —
**ADOPTED**, named in the trade-away section; (2) debris false-positive on
no-op branches — mooted by trim 2; (3) critic detach failure in a conflicted
worktree — **ADOPTED**, BLOCKED clause covers failing detach (§2); (4)
envelope shape load-bearing — **ADOPTED**, `select_target` kept + fixture
(§3, §5); (5) missed `heads/` prose consumers — **ADOPTED**, enumerated in §4.
