# Tier 1: the weave becomes state — persistence across waves, and the deletions it licenses

**Status:** APPROVED (operator, 2026-09-01 — §5 decided: within-run scope; delete the
pinned passage with its lockstep test edit; local 2-wave cell validation). Gate satisfied: the ≥50-fold
corpus check returned GO (`evals/frontier/results/2026-08-31-fold-corpus-validation.md`,
56 folds, 515/515 clean paths byte-identical, 56/56 deterministic).

## 1. What Tier 1 is now (re-scoped per the 2026-08-31 ground-truth refresh)

The original tier row targeted stale-ref/wrong-base retirement; Amendment 9 retired that
class structurally (clones cut at BASE; a patch cannot be an undescended head). **Tier 1's
remaining content: the per-file manyana weave persists on the integration frontier across
waves — the enabler of Tier 4 (squash with history), Tier 3 (provenance), and Tier 2
(cross-run fold).** Today `fold_wave.py` re-derives every path's state from the wave base
and discards it after materialize; wave N+1 folds with amnesia about wave N's line history.

**This tier changes no merge semantics.** The seed is a pure accelerator/substrate: a
seeded fold must land where a fresh fold lands, enforced live (§2.4). Whether a seed's
richer history should ever be allowed to *change* a merge (Cohen's better-anchoring case)
is a later-tier decision, and §2.4's divergence record is the corpus that decision will be
made from. This resolves the authority question cleanly for Tier 1: **the fold log remains
the sole durable record; blobs never enter it; `FOLD_LOG.md`'s self-sufficiency contract,
`rehydrate`, mid-wave `resolve` epochs, and the replay self-check are all untouched.**

## 2. Mechanism

1. **Write on adopt, never on fold.** After the engine ADOPTS a wave (suite green,
   `reset --hard` to the candidate — never on materialize-refused or adopt-on-red
   rollback), `fold_wave.py emit-weave` (new subcommand, called by the engine's adopt leg)
   writes each folded path's final state string as a content-addressed blob —
   `frontier/weave/blobs/<sha256(state)>` — plus one manifest `frontier/weave/manifest.json`:
   `path → {stateBlob, visibleSha}` (`visibleSha` = git blob sha of the state's visible
   lines). Reconcile-edited paths are recorded as `superseded` (expected-miss next wave),
   never left to surface as drift.
2. **Seed at the next wave's fold**: for each touched path, if the manifest entry's
   `visibleSha` equals git's blob sha at the new wave base, seed the weave from the
   persisted state instead of `initial_state(base lines)`. Any disagreement = detectable
   drift (map rule 2's addressing argument): fall back to fresh derivation and record it.
   **The park pre-scan and the incremental pass seed identically** — the pre-scan's
   superset guarantee holds only if both passes see the same inputs.
3. **Sidecar, not log.** Seed/drift/superseded/divergence records go to
   `frontier/weave/weave-events.jsonl` beside the manifest (`FOLD_LOG.md` pins exactly
   three log event types; non-merge facts ride sidecars, per the `fold_stats.json`
   precedent).
4. **The live invariant + the data it collects — shadow form (plan refinement of the
   reviewed draft; same pick, less plumbing):** the live fold path is byte-for-byte
   unchanged — fresh derivation drives every wave, so `rehydrate`, mid-wave `resolve`
   epochs, and the replay self-check need no fallback machinery at all. When the manifest
   offers a seed, the fold ALSO runs seeded **in memory, as a shadow**, and compares
   visible trees (and, on non-clean folds, conflict path sets). Identical → `seeded`
   sidecar event; different → `divergence` event carrying both visible-tree shas.
   Divergences are the measured corpus for the later-tier authority decision; zero
   divergences proves the seed pure plumbing before it ever drives a merge. K1
   order-independence is untouched — permutations run over one shared base.
5. **Scope: within-run.** The weave dir lives in the run dir (rides the evidence pull).
   Cross-run reuse — publishing blobs to the orchestrator store under the layering rule —
   is a §5 operator decision, not designed here.

Storage discipline: no size machinery. §3's numbers show no real path near any concerning
size; the watch trigger is named (first observed state >5× its visible size in a real run
→ revisit), and `update_state`'s no-op identity means content addressing dedupes untouched
waves for free.

## 3. Rule-5 measurement (ran 2026-09-01; script + results archived with the session)

Measured over the committed corpus (57 of 62 non-skipped folds rehydrated; 4 branch-mode
waves with pruned objects + 1 unresolvable base skipped and counted; 525 states), the
width-8 cell's real 15-update history, and a synthetic 20-wave hot-file replay through the
real kernel:

- **State/visible ratio after a real wave fold: median 1.17×, p90 1.26×, max 7.49×** (the
  outlier is a heavily-rewritten synthetic 2-parent fold; next-worst 2.24×). Absolute:
  median 11.1 KB, p90 76.5 KB, max 205 KB.
- **Growth is linear with small constants:** the width-8 `cli.py` (8 folds + 7
  resolutions) grew ~250 B/update to 2.0× visible; a pathological synthetic (50 KB file,
  10% rewritten every wave, 20 waves) accretes +6.2 KB/wave to ~180 KB (3.4×).

**Verdict: persistence is not size-threatened at our scales** — a full run's weave store
is tens of MB worst-case. Growth never plateaus (deleted lines retained forever), so the
watch trigger above stands in place of any ceiling machinery.

## 4. The licensed deletions

1. **ultraplan authoring prose whose failure class is retired** — same-file-contention
   steering and merge-safety choreography. Inventoried 2026-09-01 (fresh-context subagent,
   full read of both SKILL.mds, all four ultrapowers references, the hook):
   - `references/dependency-analysis.md`: **~400–450 words** of `--overlap serialize`
     semantics, serialize-only precedence rules, and the two conservative defaults
     ("serialize the scaffolding task", "do not assume concurrent writes are safe") — the
     last prose actively steering authors away from same-file concurrency. None
     test-pinned. The `--overlap serialize` *code path* stays (rollback knob, pinned by
     its own behavior tests); only its authoring documentation goes.
   - Anti-workaround argumentation duplicated three ways (`ultraplan/SKILL.md` move 3 +
     self-review bullet, `plan-markers.md` authoring rules): **~150–250 words** — keep ONE
     imperative copy (Commutes/#233/non-text rules are live contract), delete the
     argument restatements.
   - `ultraplan/SKILL.md` "Author for the resolver" (~50 words): retired class, PINNED by
     `test_ultraplan_skill.py` — deletion and test edit land in the same change or not at
     all (§5 decision).
   - **Byte-pinned, untouchable:** the routing rubric in `hooks/session_start.sh` +
     `ultraplan/SKILL.md` (`test_recommendation_rubric.py`, both legs) — class (b), live.
2. **Dead `--branch` ancestry machinery: DEFERRED, not deleted.** Trim review finding 11:
   the sitting-1 corpus replayer *replays pre-cutover folds under `--branch`* and
   exercises the ancestry refusal on the way through — deleting the mode breaks the
   standing 56-fold regression corpus. Deferral trigger, recorded on #360: the corpus is
   re-recorded patch-only, or the replayer is taught to skip branch-mode entries with a
   counted reason. Until then the dead path stays, documented as dead.
3. `references/design-rationale.md` §Step 4/4a (465 words of deleted 0.3.0 machinery):
   **split out** — rides the cutover's own deletion license (#403/#386) as its own
   commit, off this spec's footprint.
4. **NOT deleted:** `FOLD_LOG.md` precondition text (documents replayable history),
   the #314 cure (structural), `manyana.py` (never).

## 5. Decisions for the operator

1. **Cross-run blob scope** — (a) within-run only this sitting *(recommended: Tier 2's
   demand isn't here yet; the store publication designs cleanly later under the layering
   rule)*; (b) publish blobs+pointers to the orchestrator store now.
2. **The pinned "Author for the resolver" passage** — (a) delete with the lockstep test
   edit *(recommended: retired class, measured license, and it is 50 words of the exact
   prose the speedrun targets)*; (b) keep until #390 consolidates the authoring surface.
3. **Live validation shape (§6)** — (a) one local ab_runner cell on a purpose-built
   2-wave contended fixture *(recommended: cheap, same rig as the A/Bs)*; (b) a fleet
   re-drive of a chained plan (run-41).

## 6. Acceptance

`**Acceptance:** suite — the committed suite is the verification.` Plus, machine-checked:
corpus replay green with seeding on (57/57 rehydratable folds, identical trees, zero
divergence events); the engine sims green; the live validation run (§5.3) shows `seeded`
sidecar events on wave 2+ with zero `drift` and zero `divergence`.

## Trim review

Fresh-context reviewer, 2026-09-01, spec + map + kernel/engine code as inputs. Grade
before revision: **netConceptDelta up** (seven named additions vs four retired). Author's
adopt-or-answer; the revision above incorporates every adopt:

1. Seeding vs the self-sufficiency contract — **ADOPTED** (the sharpest finding): §1/§2.4
   now pin the log as sole authority, seed as pure accelerator, divergence → fresh result
   + recorded event. The authority question is deferred to the tier that needs it, with
   the divergence corpus as its evidence.
2. Replay-check fork (invariant vs canary) — **ADOPTED**: hard invariant *for this tier*,
   failure routes to fresh-result + sidecar record, never a dead wave.
3. Manifest write point — **ADOPTED**: write-on-adopt only; reconcile paths recorded
   `superseded`, a routine event never sharing a name with an alarm.
4. Events in the fold log — **ADOPTED**: sidecar `weave-events.jsonl`; the log's
   three-type pin stands.
5. `atBase` field — **ADOPTED**: dropped.
6. Pre-scan seeding symmetry — **ADOPTED**: both passes seed identically (§2.2).
7. Re-baseline ceiling — **ADOPTED**: deleted; named watch trigger instead (§2, §3).
8. Cross-run bullet as half-design — **ADOPTED**: reduced to a scope sentence + §5 option.
9. ultraplan prose deletion — keep (reviewer concurs).
10. design-rationale rider — **ADOPTED**: split to its own commit (§4.3).
11. `--branch` deletion vs the corpus replayer — **ADOPTED**: deletion DEFERRED with a
    named trigger (§4.2); the collision with sitting-1's standing machinery is real.
12. K1 claim — **ADOPTED**: one line in §2.4.
13. §5/§6 shape — keep (reviewer concurs).

Post-revision the additions are: one subcommand, one manifest, one blob dir, one sidecar
file, one invariant-with-fallback — against the serialize-prose deletions and the two
policy machineries the review itself removed (ceiling, log events). Author's reading of
the revised delta: **flat**; the reviewer's grade of the draft stands recorded above, and
the operator adjudicates.
