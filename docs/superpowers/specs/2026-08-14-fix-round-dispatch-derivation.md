# Fix-round dispatch derivation (#146)

_Spec 2026-08-14, post-trim-review revision. Docket entry #146 (score 8).
Authored under the post-0.2.0 cycle's kickoff delegation._

## Problem — two seams, one class

Fix-round dispatch inputs trust per-agent-typed values at seams where a
cross-check or a mechanical range exists. Observed in the 2026-08-14 T14/T15
campaign (attempts 3–8) and cross-validated by three foreign field runs in the
2026-08-14 sense pass (all on the fix/redirect leg):

1. **Packet range.** The fix dispatch sets `BASE: <impl.headSha>`
   (waves.js:1133) and the baked packet step says "generate the review packet
   for your BASE..HEAD" (waves.js:290) — so a fix agent's packet diffs
   `<prior-impl-head>..<fix-head>`, hiding the implementation commit(s). One
   campaign packet exposed ~6% of the task's changed lines; three foreign runs
   show the same multi-commit truncation. Reviewers recovered by reading the
   object store each time — a packet-trusting reviewer certifies a fraction of
   the task. (The reviewer's own dispatch BASE is the wave base on every
   iteration — waves.js:1058, pinned by sim — so today the packet range and
   the reviewer's declared range silently disagree on fix rounds.)
2. **Anchor trust.** The fix agent's anchor (`BASE:`) is the model-typed
   `impl.headSha`; the campaign observed one reported sha with a correct
   7-char prefix and a fabricated tail. The prose reset-to-BASE recovery
   worked 3/3 times, but it recovers *to the typed value* — the blast radius
   of the trust, not an independent seam.

## Design (trimmed)

1. **Fix-round packet-range override (inline preamble).** The FIX ROUND
   preamble (inline engine-authored dispatch text, waves.js:1134–1138 — not a
   baked block) gains one instruction: generate the review packet as
   `review-package <waveBaseSha> <your HEAD>` — the full task range — where
   `<waveBaseSha>` is spelled into the preamble by the engine (dispatch-
   authored: the agent derives nothing; the value originates from the same
   sidecar-corroborated chain round 1 already builds on, so no new trust).
   The instruction explicitly says the packet range is *not* your `BASE:` —
   `BASE:` remains the prior-impl anchor. Failure-mode asymmetry is why the
   two values stay distinct: making `BASE:` mean the task base would send the
   baked step-1 reset (`git reset --hard <BASE>`) to the wave base and destroy
   the prior implementation; keeping the anchor and overriding only the packet
   range degrades, at worst, to today's truncated packet. No `TASK_BASE:`
   dispatch field is added (avoids a second universal base-like name and the
   `BASE: ` substring matcher hazard); no baked-prompt edit is needed for this
   item.
2. **Anchor cross-check (inline preamble).** The preamble instructs the fix
   agent to derive the prior tip mechanically before anchoring:
   `PRIOR=$(git rev-parse <impl.branch>)`; if it differs from the
   dispatch-typed sha, report BLOCKED naming both, written exactly as
   `typed prior sha <typed> != derived branch tip <derived>` — never build on
   either. Honest basis: `impl.branch` is *also* model-reported
   (IMPLEMENTER_SCHEMA), so this is a two-typed-values agreement check, not
   mechanical ground truth — it catches exactly the observed shape (correct
   branch, corrupted sha tail), a fabricated branch fails `rev-parse` loudly,
   and the residual (branch and sha both wrong yet mutually consistent) stays
   caught downstream by the merge-side heads/ derivation. `heads/task-<id>`
   cannot substitute: it is written only at wave merge, after fix rounds.
3. **Reviewer fallback belt (baked, the cycle's one additive guard).** Extend
   the reviewer prompt's existing guarded-fallback sentence (waves.js:313;
   source `references/reviewer-prompts.md`, re-baked): fall back to the
   read-only `git diff <BASE> <HEAD>` also when the packet's recorded base
   does not match your `BASE` input. Ten words in an existing sentence; makes
   any truncated or stale packet — whatever produced it — collapse to the
   full-range read the reviewers already improvised 4/4 times.

Non-goals: no new sidecar files; no first-round dispatch change.

## Verification

Fold new assertions into the existing `scenarioFixLoop`
(tests/sim_workflow.mjs:161–195), which already captures `fixPrompt`: assert
the packet-range instruction carries the wave base and the anchor-derivation
instruction carries the exact mismatch string. String assertions, no mutation
re-execution (a grep-what-you-wrote mutation check is tautological — reviewer
finding 9). Reviewer-prompt edit lands in `references/reviewer-prompts.md`
and re-bakes; drift pin covers it. Suite-gate obligations apply as standing.

## Trim review

_Author's original Adds/Removes disclosure:_ two derivation sentences +
cross-check string + universal TASK_BASE line + sim scenarios; removes
nothing; self-graded +1. Reviewer graded the original **netConceptDelta: up**
(second base-like name with round-dependent semantics, nothing retired).

_Reviewer findings (fresh-context, 2026-08-14) and adopt-or-answer:_

1. **BLOCKER — "prior branch is engine-assigned" is false** (impl.branch is
   model-reported; a plausible-existing wrong branch resolves silently).
   **ADOPTED** — design item 2 now states the two-typed-values basis and the
   exact class it catches; the silent-wrong-branch residual is named with its
   downstream catch.
2. **BLOCKER — "wave base never model-typed" is false** (setup/merge-reported,
   engine-dispatch-authored). **ADOPTED** — justification rewritten to
   dispatch-authored/no-new-trust.
3. **BLOCKER — reviewer fallback-input change restates shipped behavior**
   (reviewer BASE is the wave base every round). **ADOPTED** — clause deleted;
   the packet/reviewer range agreement is now stated as the design's effect.
4. **TRIM — seams 2 and 3 are one seam.** **ADOPTED** — collapsed to two.
5. **TRIM — the `non-empty` cross-check conditional guards an impossible
   state.** **ADOPTED** — dropped.
6. **BLOCKER — universal `TASK_BASE` vs baked round-1 sentence contradiction;
   resolve (a) universal line or (b) fix-round override.** **ADOPTED as (b)**
   — the packet-range override lives in the inline preamble only; the baked
   round-1 sentence is untouched; the concept stays local to the round where
   the defect lives. The (a)-preferring drift-pin argument is answered by the
   sim assertion on the preamble text (the preamble is engine-authored inline
   text, already outside BAKE blocks by design — finding 7).
7. **TRIM — FIX ROUND preamble is inline, not baked; state the split.**
   **ADOPTED** — only the reviewer-fallback edit (item 3) touches baked
   source.
8. **KEEP two-value split; justify by failure-mode asymmetry.** **ADOPTED**
   verbatim into design item 1.
9. **TRIM — string-grep mutation check is tautological; assert strings, skip
   mutation.** **ADOPTED.**
10. **TRIM — fold assertions into `scenarioFixLoop`, no new scenarios.**
    **ADOPTED.**
11. **TRIM — `TASK_BASE` matcher collision hazard.** **ADOPTED by
    construction** — no `TASK_BASE:` field exists in the trimmed design; the
    preamble instruction avoids emitting any new `BASE: `-suffixed line.
12. **Alternative — ten-word reviewer-fallback extension instead of
    derivation.** **ADOPTED AS A BELT, not instead** — adjudication: the
    preamble override is prevention where the defect lives (inexpressible >
    detected), the fallback extension is near-zero-cost detection that also
    covers stale packets the derivation cannot; it is this cycle's single
    additive guard. The reviewer's redundancy caution is answered by the
    distinct failure surfaces (generation vs consumption).
13. **KEEP the exact mismatch string.** **ADOPTED.**
14. **TRIM — restated non-goals and shipped-behavior sentences.** **ADOPTED**
    — non-goals cut to the two informative ones; the heads/-unavailable
    clause kept per the reviewer's own note.
15. **Scope reconciliation.** Trimmed design adds one inline instruction pair
    + one ten-word baked-sentence extension; the universal dispatch field,
    the duplicate reviewer-input change, the impossible-state conditional,
    and the mutation machinery are all gone.

_Reviewer grade of the original: **up**. The trimmed version retires the
universal field and the redundant clauses; residual delta ≈ the author's
honest +1 (the packet-range/anchor distinction), now scoped to fix rounds
only._
