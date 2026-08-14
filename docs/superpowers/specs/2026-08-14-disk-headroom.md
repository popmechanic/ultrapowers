# Disk headroom: between-wave sweep + preflight check (#151)

_Spec 2026-08-14 (post-distill sweep), rev 2 after trim review. Issue #151.
complexityEffect: the preflight half is the cycle's ONE budgeted additive
guard (charged at distill); the sweep half is structural — and is an
**acknowledged reversal** of a deliberate prior subtraction (see §1).
netConceptDelta graded **up** by the trim reviewer (earned; kept to the two
irreducible mechanisms). Surfaces: `skills/ultrapowers/harnesses/waves.js` +
`references/wave-merge.md` (re-bake), `skills/ultrapowers/scripts/ultra_run.py`,
tests._

## Problem

Disk-exhaustion family, 3rd/4th occurrence, sev-2 twice. Merged tasks'
worktrees persist to end-of-run (waves.js:366–377: swept only at the
approve-time #108 sweep), so a wide plan accumulates the full
checkout+install footprint (~25GB observed) and ENOSPC lands mid-merge —
misreported as a merge CONFLICT, corrupting the integration signal and once
wedging the orchestrating session's own shell.

## Design

Two independent halves, no shared interface.

### 1. Structural: sweep just-merged worktrees at the wave barrier

**This reverses commit `bea1875`**, which removed a cleanup instruction from
MERGE_PROMPT ("cleanup is the deterministic Step-5 sweep, not a merge-prompt
step") and pinned the removal at sim_workflow.mjs:153. The old rationale no
longer holds: Step-5-only sweeping IS the growth term, and the family is at
its 3rd/4th occurrence at sev-2 — the recurrence bar that buys the reversal.
The pinning assertion is **replaced** (not merely deleted): the new sim
asserts the sweep step lists exactly the just-merged worktrees.

**Trust model (corrected by trim review):** the engine never sees the
runtime `wf_<runId>` (waves.js:366–369) — worktree paths can only derive
from the implementers' **self-reported branch names**, i.e. model-typed
input feeding `git worktree remove --force`. Two defenses, both required:

- **Engine side:** the sweepLine derives a path only from a branch matching
  `^worktree-wf_.+-[0-9]+$` by prefix-strip
  (`worktree-<x>` → `.claude/worktrees/<x>`, the mapping
  sweep_worktrees.sh:251–257 owns); a malformed name contributes nothing,
  silently. Only results the wave actually merged are listed.
- **Prompt side:** the cleanup step orders the merge agent to remove a path
  only after confirming, via `git worktree list --porcelain`, that the
  path's checked-out branch is one it merged **in this wave** — the
  per-path identity check that "after the final MERGED verdict" alone does
  not give. A path that fails the check is skipped and named in the reply's
  detail.

**Coverage set (explicit, partial-by-choice):** the step is added to
`MERGE_PROMPT` **and** `RECONCILE_PROMPT` (a reconciled wave's final MERGED
comes from the reconcile agent after the merge agent exited CONFLICT —
:1478–1493 — so the merge agent correctly didn't sweep). The **contended
path is explicitly best-effort-excluded**: adoption reports MERGED through
the contended STEP prompt, whose machinery is delicate and A/B-graded, and
the fold canary shows real-repo contended traffic is currently zero (line
cap serializes everything). Its consumed worktrees continue to wait for the
Step-5 sweep. This partial coverage is declared here, not silent.

Also in the same wave-merge.md edit: the "Worktree and Branch Facts"
paragraph (:57 — "the merge agent itself never removes worktrees") is
rewritten to match the new prompt block; leaving it would make the
reference contradict its own prompt (trim-review catch).

Branches are never touched — they carry the commits, and the frozen
approve-path sweep stays idempotent over already-removed worktrees
(`[ -e "$wt" ] || continue`, sweep_worktrees.sh:259). Resume/redirect
tolerance is one clause: a listed path that no longer exists is a skip
(waves.js:380–381 already tolerates branch-survived/worktree-gone).
`sweep_worktrees.sh --run` stays rejected mid-run (removes ALL matching
worktrees regardless of merge state — destroys blocked/parked evidence).

### 2. Additive guard: preflight free-disk check (the cycle's one)

`ultra_run.py` preflight gains a `disk-headroom` stage, **after the
`compile` stage** (it needs `compile_obj.waves` for the widest-wave width,
ultra_run.py:381–394) **and before anything expensive**:

- `shutil.disk_usage(repo_root).free` vs `estimate = widest_wave_width ×
  1.5 GiB` (hardcoded; the env knob rev 1 carried is deleted per trim
  review — a tuning surface on an advisory warn is machinery not yet earned
  by field data).
- Free ≥ estimate → ok. Free < estimate → **warn** (stage ok:true, detail
  states free vs estimate — conservative default; a tight-but-sufficient
  host must not false-block). **Block** (ok:false) only when
  `free < min(2 GiB, estimate)` — the floor never exceeds what the run
  actually needs, so a narrow run on a small host is not false-blocked by
  a floor larger than its own estimate (trim-review catch).
- Stage detail states its own verdict (the #97 receipt-honesty rule); the
  warn-as-ok:true-with-verdict-detail shape follows the existing
  `worktree-audit` stage precedent (ultra_run.py:454–456).

No other new guards this cycle — the budget is spent here.

### 3. What does NOT change

- Frozen periphery untouched: no ultra_gate.py edit (its sweep loop already
  tolerates missing worktrees); gate scripts byte-identical.
- Worktree creation, branch lifecycle, evidence-keeping for non-merged /
  blocked / parked tasks: unchanged. Contended-path machinery: unchanged.

## Verification (suite disposition; sim + re-bake obligations)

- `tests/sim_workflow.mjs`: the :153 assertion is replaced — new scenario
  asserts the merge prompt lists exactly the just-merged tasks' worktree
  paths (malformed branch contributes nothing; non-merged tasks absent) and
  the reconcile prompt carries the same step; resume tolerance (already-
  swept path) exercised. Sentinel discipline (`ALL SCENARIOS PASSED`).
- `tests/test_no_prompt_drift.py` green after the wave-merge.md re-bake.
- `tests/test_ultra_run.py`: headroom stage — ok / warn / block boundaries
  (monkeypatched disk_usage), the `min(2 GiB, estimate)` floor case,
  verdict-stating detail, stage ordering after compile.
- `python3 -m pytest` green.

## Adds / Removes (author disclosure for trim review)

- Adds: sweepLine composition (regex-narrowed) + one prompt step in two
  prompts (re-baked) + facts-paragraph rewrite; one preflight stage with a
  hardcoded estimate and a min-bounded floor; sim + pytest coverage.
- Removes: the sim assertion pinning bea1875's subtraction (replaced with
  the new-behavior pin); rev 1's env knob (deleted at trim review).
- Explicitly rejected: `sweep_worktrees.sh --run` mid-run (blunt); a
  dedicated per-wave cleanup agent (a dispatch for 3 shell commands);
  contended-path coverage (delicate machinery, zero current traffic —
  declared best-effort exclusion); the env knob (unearned tuning surface).

## Trim review

_Reviewer: fresh-context subagent per distilling-proposals.md §Trim review;
inputs = spec rev 1 + issue #151 + waves.js + wave-merge.md + ultra_run.py +
sweep_worktrees.sh. Grade and verdicts are the reviewer's; adopt-or-answer
is the author's._

1. sweepLine "engine-authored like slotsLine" claim factually wrong — paths
   derive from model-typed self-reported branches; needs regex narrowing +
   prompt-side `git worktree list --porcelain` identity check. **ADOPTED**
   (both defenses, §1).
2. Undisclosed reversal of bea1875's deliberate subtraction; the
   sim_workflow.mjs:153 assertion goes red as-written. **ADOPTED**:
   reversal acknowledged with rationale; assertion replaced (§1,
   Verification).
3. Coverage set unstated (reconcile-MERGED and contended-adoption sites
   missed). **ADOPTED (modified)**: RECONCILE_PROMPT covered;
   contended path explicitly best-effort-excluded with rationale (§1) —
   partial coverage declared, not silent.
4. wave-merge.md facts paragraph contradicts the new prompt block.
   **ADOPTED**: rewritten in the same edit (§1).
5. Delete the env knob (tunes only the warn boundary; no calibration data;
   machinery-earned-by-recurrence). **ADOPTED** (§2).
6. Floor/estimate collision on small hosts. **ADOPTED**:
   `free < min(2 GiB, estimate)` (§2).
7. Stage placement unstated. **ADOPTED**: after compile, before
   install/lock; worktree-audit warn-shape precedent (§2).
- Scope: floor = the "block" of the one budgeted guard (no expansion); env
  knob was the one true expansion — deleted; the sim-flip and facts-rewrite
  are obligations, not creep. **ADOPTED as stated.**
- **Reviewer netConceptDelta grade: up** — earned by the 3rd/4th-occurrence
  sev-2 record; trims 1+5 keep the delta to exactly the two irreducible
  mechanisms.
