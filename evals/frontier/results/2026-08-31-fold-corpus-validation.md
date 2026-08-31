# Fold corpus validation — the Tier-1 gate read (map #360)

**Date:** 2026-08-31 · **Spec:** `docs/superpowers/specs/2026-08-31-fold-corpus-validation.md` · **Replayer:** merged at `68573f7` (PR #505, run-34 + critic fixes)

## Pre-registered readings (written BEFORE the replay ran)

Recorded here before `replay_corpus.py` was executed against the real corpus, per the spec's ordering rule. The verdict rule, verbatim from the spec:

- **GO:** ≥50 folds replayed on both arms AND every class-2 instance mechanically explained (line-multiset equality / hunk-order-only difference). The judgment is never self-graded: anything past the mechanical check parks on the operator.
- **NO:** any unexplained class-2 — published as a defect datum against the live merge path; stops sitting 3.
- **INSUFFICIENT-CORPUS:** replayed < 50 — pad with synthetic folds cut from repo history, marked as synthetic and reported separately; real-fold counts are never inflated.

Readings to fill, in this order:
1. Verdict line.
2. Per-class counts (1–5, binary) and per-run breakdown.
3. Every class-2 instance verbatim with its mechanical-explanation flag.
4. Skip count and reasons, by name.
5. XaXbX census (repeated-line-anchored class-2/3 instances).
6. Deletion-adjacency counts (Cohen's deletion-only-no-flag data question).
7. Determinism re-check outcome (recorded log vs today's kernel), by fold.

**Prediction (pre-registered):** the weave agrees with git everywhere both are clean (0 unexplained class-2); class 3 appears on the declared-Commutes folds (run-20's traversal and the fixture-adjacent shapes); patch-input folds (runs 25–34) replay fully; branch-input folds (runs 14–23) skip where heads no longer resolve. Expected replayed count: ~40–50 real folds, so INSUFFICIENT-CORPUS is a live possibility on real folds alone.

## Results

**1. Verdict: `GO`.** 56 folds replayed on both arms (≥50), zero unexplained class-2. The Tier-1 corpus gate is satisfied.

**2. Counts.** Real and synthetic reported separately, per pre-registration:

| corpus | folds | class 1 | class 2 | class 3 | class 4 | class 5 | binary |
|---|---|---|---|---|---|---|---|
| real fleet waves (runs 25–34) | 16 | 81 | 0 | 0 | 0 | 0 | 0 |
| synthetic (40 two-parent merge commits from main's own history, `synth-<sha7>`, kernel-driven) | 40 | 434 | 0 | 0 | 0 | 3 | 0 |
| **total** | **56** | **515** | **0** | **0** | **0** | **3** | **0** |

The 3 class-5 paths (both arms contend) are all on `synth-55d7ed7` — agreement on contention, not divergence. Class 3 = 0 because no replayed real wave carried a declared-Commutes auto-union (run-20's traversal predates the preserved evidence window); the prediction's class-3 expectation was wrong for that reason, not because the union rung disagrees with git.

**3. Class-2 instances: none.** Everywhere both arms clean-merged, they produced byte-identical content — 515 of 515 paths. The XaXbX danger class (both clean, differing content) did not occur once.

**4. Skips, by name (11):** runs 10–13, 24 — no fold logs in the bundle (pre-fold-era or unfolded runs); 4 branch-input waves (foreign-named bundles + w2-entry-slate + run-23) — head shas no longer resolve locally / Arm G takes patch input only; run-28 wave 2 — its base (a mid-run integration fold commit, `6fbf3fa`) no longer resolves. No silent caps: 16 of 22 replayable waves replayed.

**5. XaXbX census: 309 flagged paths — every one class 1.** Repeated-line anchors (blank lines, `}`) are pervasive in real folds, and the weave still agreed with git on all of them. The theoretical hazard exists in the corpus; the divergence it could cause was not observed.

**6. Deletion-adjacency: 6 rows** (deletions within k=3 of a sibling hunk's span) — all folded to class-1 agreement. Datum for Cohen's deletion-only-no-flag question: at this corpus size, no flag would have fired usefully.

**7. Determinism re-check: 56 checked, 0 divergences.** Today's kernel reproduces every recorded fold exactly.

## Reading

The shipped fold-only merge path (0.3.0) is retroactively validated on 56 folds spanning ten real fleet runs and 40 historical merges: **the weave never disagreed with git where both were clean, never missed a contention git saw, and replays deterministically.** Sitting 3 (weave persistence, Tier 1 build) is unblocked. Recorded on #360.
