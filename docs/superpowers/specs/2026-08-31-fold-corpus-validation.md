# Fold corpus validation — retroactive check of the only merge path (Tier 1 gate, map #360)

**Date:** 2026-08-31 · **Map:** #360 The Merge Frontier · **Sitting:** 1 of the operator-chartered sprint (sequencing comment on #360, 2026-08-31)

## Problem

Since 0.3.0 the fold kernel is the **only** merge path (`fleet/run-waves.mjs:354` — "the engine has no branch-input mode"; the git-merge path was deleted, not ported). The cutover was licensed by runs 26/27's engine bar — but #360 Tier 1's pre-registered corpus check (**≥50 real folds where the weave's answer is checked against git's**) never ran. Every green run since has trusted the weave unvalidated, and the one known danger class — Cohen's XaXbX case, where repeated lines anchor so two branches clean-merge to a version *neither wrote* — is exactly the class a green suite can miss. Separately, the corpus material is a single copy on the orchestrator VM (#484's gap): one lost VM and the check becomes unrunnable forever.

## Ground truth (measured 2026-08-31)

- **64 real fold events** survive in `sandbox-logs.tgz` under `/home/exedev/fleet-evidence/sandbox-logs/` on the orchestrator: **43 patch-input** (runs 25–33, `--patch`, pure functions of `(base sha, patch file)`) and **21 branch-input** (runs 14–23, `--branch`, need resolvable head shas).
- Each wave's record is self-sufficient by contract (`kernel/FOLD_LOG.md` §Self-sufficiency): `fold_log.jsonl` opens with the base sha; patch tasks re-derive their tree from `patches/task-*.patch` on every call via `repo_weave.apply_patch_tree`.
- All runs in the corpus targeted this repository; bases and heads were pushed by the publish leg, so most should resolve against `origin`. Resolvability is checked, never assumed (see Deliverable B).

## Deliverable A — evidence rescue

1. `scp` every `sandbox-logs.tgz` (runs 10–33) plus the loose `fleet-evidence` files to a laptop archive directory (uncommitted; transcripts stay out of the repo).
2. Extract the **corpus subset** into the repo, committed: `evals/frontier/corpus/<runId>/wave-<n>/{fold_log.jsonl, conflicts + resolve artifacts, task-*.patch}` plus one `corpus-index.json` (runId, wave, base sha, input mode, task count). Patches and fold logs are diffs of this repo's own code — committed-safe; nothing else from the tarballs is committed. **The extractor rewrites each `fold` event's `patch` field to the corpus-relative path** (recorded paths are absolute sandbox paths and would fail `rehydrate` verbatim), and the replayer asserts `apply_patch_tree(base, patch) == recorded headSha` per fold as the corpus-integrity check — the strongest guarantee the committed corpus is the run's actual input.

This is the cheap end of #484 for the one artifact this sprint needs; it does not pre-empt #417/#487's design question about the general raw layer. **The GO/NO verdict depends only on the corpus subset** — if the full-archive `scp` stalls, Deliverable B proceeds on the corpus tarballs alone.

## Deliverable B — the replayer

`evals/frontier/replay_corpus.py` (laptop-local, deterministic, git + Python only, no model calls, no API, `kernel/vendor/manyana.py` untouched). For each corpus fold:

- **Preflight:** resolve the base sha (and, for branch-input folds, every head sha) in a scratch clone. Unresolvable folds are **skipped and counted by name** in the results doc — no silent caps.
- **Arm W (weave)** is two explicit checks:
  - (a) **the weave's answer = the record**: `frontier_fold.rehydrate` over the recorded `fold_log.jsonl` (replaying recorded resolve events deterministically — reading the log is not resolver dispatch); contention is classified from the recorded conflicts artifacts, and a path with a narrated conflict is excluded from classes 1/2 by construction, so the arm is total over contended folds (a fresh `fold` stops at the first conflict and `materialize` refuses an incomplete fold — the CLI alone cannot answer for them);
  - (b) **determinism re-check**: fresh-fold today's kernel over the same inputs and assert the conflict set (and, for clean folds, the manifest) matches the record — a divergence is its own reportable finding.
- **Arm G (git):** commit each patch on the base and three-way merge in the recorded task order, with rename detection **off** (`-X no-renames` / `merge.renames=false` — the captured patches are `--no-renames` diffs and the kernel is rename-blind; pin the strategy to `ort`). On a conflicted merge k: record the conflicted paths, complete that merge using Arm W's answer for those paths, and continue with k+1..N — later paths are compared conditioned on agreement-so-far, and no path silently drops out of the census. Binary paths are excluded from content comparison and counted (the kernel's candidate-set tiebreak has no git analogue).
- **Compare per path**, into five classes:
  1. both clean, identical content — agreement (expected bulk);
  2. **both clean, differing content — the danger class.** Every instance is dumped verbatim for hand reading;
  3. weave clean, git conflict — fold's value (expected on Commutes/auto-union; run-20's traversal should land here);
  4. weave contended, git clean — fold conservatism, counted as cost;
  5. both contended — agreement on contention.
- **Ride-alongs** (map rule 4), both as defined predicates over the unified diffs in hand: **XaXbX flag** — a class-2/class-3 instance whose conflicting or merged hunks' context lines contain a line occurring ≥2× in the surrounding base region (blank or `}`-only lines included); **deletion-adjacency** — task A's patch deletes base lines within k=3 lines of the base-line span of some hunk of task B's patch on the same path. Counted mechanically for Cohen's deletion-only-no-flag data question.

## Pre-registered readings (written into the results doc before the replay runs)

- **GO on the Tier-1 gate:** ≥50 folds replayed on both arms, AND every class-2 instance is **mechanically explained**: the two contents are equal as multisets of lines (pure reordering of preserved additions — the commuting-appends case), or differ only in the ordering of hunks both arms fully preserved. Anything past the mechanical check is an *unexplained* class-2 — a **NO** unless the operator personally accepts a written explanation. The judgment is never self-graded by the agent producing the results doc. A NO is published as a defect datum against the live merge path and stops sitting 3.
- **If skips drop the replayed count below 50** (plausible for pre-cutover heads, which predate the #497 ref pins): pad with synthetic folds cut from this repo's history, marked as synthetic in the results doc and reported separately — real-fold counts are never inflated.
- Class-3 count (the fold's measured value) and class-4 count (its measured cost), reported per run.
- Skip count and reasons (unresolvable shas, unreadable patches).
- Determinism re-check outcome (Arm W check b): any record-vs-today divergence, by fold.
- XaXbX census and deletion-flag counts, recorded on #360 regardless of verdict.

Results: `evals/frontier/results/<date>-fold-corpus-validation.md`, house style of `2026-08-29-base-ancestry-guard.md`.

## Acceptance

**`Acceptance:** suite` — committed tests for the replayer over a small fixture corpus (a synthetic base + 2–3 patches with one known instance of each class), riding `tests/` via the normal pytest bridge. The frozen verification periphery (`gate_check.py`, `ultra_gate.py`, `run_acceptance.sh`) is untouched; the replayer lives entirely in `evals/`.

## Non-goals

No engine or kernel changes; no weave persistence (sitting 3); no live resolver dispatch (recorded resolutions ARE replayed, via `rehydrate` — that is corpus data, not dispatch); no new guards; no general raw-layer transport design (#417/#487 own that). If the corpus verdict is NO, the response is a map entry and an operator decision — not an in-sprint fix.

## Trim review

**Author's Adds/Removes disclosure (input, not verdict):** Adds — `evals/frontier/corpus/` (committed data), `evals/frontier/replay_corpus.py` + fixture tests, one results doc, laptop evidence archive (uncommitted). Removes — nothing yet; licenses sitting 3's deletions. Touches no engine, kernel, or frozen-periphery surface.

**Reviewer:** one fresh-context subagent (inputs: spec, #360 body+comments, distilling-proposals.md §Trim review, `fold_wave.py`/`FOLD_LOG.md`/`repo_weave.py`/`run-waves.mjs:1-220`). Nine findings; adopt-or-answer:

1. **Arm W cannot materialize contended folds via the CLI** (fresh `fold` stops at first conflict; `materialize` refuses incomplete folds) — **ADOPTED**: Arm W is now `rehydrate` over the recorded log (total by construction) plus the CLI as a determinism re-check.
2. **Spec rebuilt what `rehydrate` provides without naming why a fresh drive remains** — **ADOPTED**: the arm is now two explicit checks (record = answer; fresh-fold = determinism), each reportable.
3. **Recorded patch paths are absolute sandbox paths; `rehydrate` would refuse on the laptop** — **ADOPTED**: extractor rewrites `patch` fields to corpus-relative; per-fold `apply_patch_tree == headSha` integrity assertion pre-registered.
4. **Arm G under-specified (rename detection, conflicted-merge continuation, binary paths) — manufactures spurious class-2s** — **ADOPTED**: `ort` + no-renames pinned; conflicted merges complete from Arm W's answer and continue; binaries excluded-and-counted.
5. **Class-2 "explained" was a self-graded judgment deciding GO/NO** — **ADOPTED**: mechanical equivalence check (line-multiset equality / hunk-order-only difference); anything past it parks on the operator.
6. **Silent third outcome if skips drop the count below 50** — **ADOPTED**: synthetic padding from repo history, marked and reported separately.
7. **Ride-along predicates were judgment calls** — **ADOPTED**: both defined mechanically (repeated-line context ≥2×; deletion within k=3 lines of a sibling hunk's base span).
8. **Rescue over-broad relative to the gate** — **ADOPTED** as written: verdict depends only on the corpus subset; full rescue proceeds but never blocks B.
9. **Scope reconciliation** — expansions named (rescue: chartered by the sitting-1 sequencing comment; fixture tests: `Acceptance: suite` default; class-3/4 accounting: the tier table's own clean-resolution metric, free); one over-contraction fixed ("no resolver replay" → "no live resolver dispatch").

**Reviewer's grade: `netConceptDelta: flat`** — all machinery in `evals/` behind the measurement-gate doctrine, reuses the kernel's replay seam, retires nothing yet but licenses sitting 3.
