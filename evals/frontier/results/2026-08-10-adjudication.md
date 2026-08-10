# Frontier probe — operator adjudication (2026-08-10)

Adjudicated against `docs/superpowers/specs/2026-08-09-frontier-kernel-sim-design.md`
§Success criteria, over the committed measurement run in this directory
(`rollup.md`, integration branch `ultra/integration-20260809-230414`, suite 771).

## S3 — conflict-narration grade (operator)

**Grade: usable.** Materially better fix-agent input than git conflict markers —
the delete-vs-modify and add/add narrations state what each side did rather than
presenting opaque ours/theirs blobs. Two presentation blemishes noted, neither
kernel-level: the four-way fan-in narrations repeat the accumulated block per
fold (verbose; `begin added both` label is cryptic), and one delete-vs-binary
prose line can state the opposite winner from the shipped manifest. Both tracked
in issue #132.

## Decision rule — verdict (operator)

**Shelve increment two** (live-sync probe / frontier engine), per the spec's
rule as written: K3 is `not evaluated (recovered-n=1 below floor 3)` — not
green — and the S1 makespan delta is dull (0.0% on five of six fixtures, 4.9%
on webapp, modeled durations, same-file column unexercised).

**Recorded as: shelved for lack of evidence, not disproven.** The kernel track
passed every correctness gate constructible on this corpus (K1/K2/K4, incl.
24-order fan-in permutations and a 27-order real-run replay with zero silent
divergence). Both unmeasured claims failed for corpus reasons that are
themselves findings:

- No fixture carries a same-file edge — the corpus was authored under the
  ultraplan serialization rule the frontier thesis proposes to remove, so the
  load-bearing S1 column structurally could not be exercised.
- 35/36 archived integration chains carry a reconciliation commit, so the
  strict extraction model recovers too few runs to meet the K3 floor (#133).

## Reopening trigger (defined now, so the next look is cheap)

Reopen only after a corpus fix — #133 (reconciliation-tolerant extraction
and/or foreign-repo corpora) plus at least one fixture with genuine same-file
contention — re-runs this same probe with K3 evaluable and the same-file S1
column populated, and the spec's decision rule re-adjudicates on that report.
No engine work on the frontier thesis before then.

Related issues filed from this cycle: #129 (worktree-session preflight),
#130 (review-packet trap), #131 (stale heads slots), #132 (K1 conflict-report
precision + narration polish), #133 (track-c corpus), #134 (approve moves
shared checkout).
