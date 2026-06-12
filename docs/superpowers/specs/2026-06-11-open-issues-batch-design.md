# Open-Issues Batch Fix — Design

**Date:** 2026-06-11
**Scope:** all eleven open GitHub issues (#8–#18), every one a deferral self-filed
during the 0.4.0 → 0.5.0 review loop. Ten get fixed; one (#17) closes as won't-fix.
**Outcome:** one implementation plan executed via /ultrapowers, then a 0.6.0 release
and issue closeout.

## Decisions

Each issue already carried a suggested fix from the review loop; the decisions below
were walked through and approved individually.

### workflow.js (skills/ultrapowers/workflow.js)

**#8 — budget exhaustion must not dispatch merge/reconcile/integration.**
`budgetExhausted()` is checked at run start, wave top, and chunk top, but not before
`mergeWave()` (line ~763), the reconcile loop inside `mergeWave()` (lines ~541–551),
or the integration review (line ~801). Fix:

- Before `mergeWave(results, w)`: if exhausted, push a `waveMerges` entry with
  `status: 'DEFERRED'` and a budget detail, defer later waves' tasks to
  `unfinished` with a budget reason, record the one-time `budgetDeferred`
  judgmentCall, and `break` — do **not** push to `blockedWaves` and do not
  attribute a merge failure.
- Inside `mergeWave()`: check before each reconcile attempt; if exhausted, return
  `{ status: 'DEFERRED', detail: 'budget exhausted before reconcile attempt N' }`.
  The caller treats `DEFERRED` like the pre-merge case above (deferral, not
  cascade-block, not a CONFLICT record).
- Before the integration review: if exhausted, skip the dispatch and synthesize
  `review = { testsPassed: false, output: 'not run — budget exhausted', findings:
  ['integration review deferred: budget exhausted — verify the suite manually'] }`
  plus a judgmentCall. The report keeps its shape.
- Report semantics: budget deferral is never recorded as a merge failure or
  cascade-block; the cause lives in `status`/judgmentCalls, not only in `detail`.
- report-format.md gains the `DEFERRED` wave-merge status alongside
  MERGED/CONFLICT/SKIPPED (this doc edit belongs to the #8 task, not the docs
  lane — it must be ordered against #16's variable sweep with a Depends-on
  marker, same as #14's doc edits).

**#9 — duplicate task ids fail loud.**
Extend the `args.waves` validation block (lines ~40–53): after shape validation,
collect ids across all waves; on a duplicate, throw
`ultrapowers: duplicate task id "<id>" across waves — task ids must be unique
(compile_plan.py enforces this; hand-authored waves must too).` Matches the
compiler's posture; protects `blockedByDep` and report keying.

**#18 — code-quality nits (items 1 and 3 only).**
Drop the dead wave-level `noteFailures()` after the chunk loop (line ~727 — the
per-chunk loop already calls it after the last chunk). Merge the two tierOverrides
validation loops (lines ~111–124) into one loop checking key then value. Item 2
(the 4-line cascade-loop duplication) is intentionally kept per the rule of three.
No behavior changes; existing sim scenarios must stay green.

### compile_plan.py (skills/ultrapowers/scripts/compile_plan.py)

**#10 — cycle errors print a concrete edge path.**
On Kahn-leftover detection (line ~485), run a DFS over the recorded edges
restricted to the unplaced members and print one concrete cycle with each edge's
`why` label, e.g. `T1 → T2 (write-after-write: src/a.py) → T1 (marker)`, in
addition to the existing member list. Update dependency-analysis.md (and any other
doc describing the cycle error) to promise the richer form.

**#11 — plural text-dependency lists parse into edges.**
Extend the punctuation-tolerant text rule to plural conjunction lists:
`depends on/after/requires Tasks 1 and 3` (also comma lists, `Tasks 1, 2 and 3`)
yields one edge per referenced task. Title- and phase-level matching is explicitly
out of scope (fragile, per the issue's own assessment). The existing
surface-as-conflict behavior remains for shapes still unparsed.

**#12 — inline `**Files:**` header values parse.**
When the `**Files:**` header line (line ~202) carries backticked paths on the line
itself, parse them as the task's files instead of falling through to
`files_ambiguous` over-serialization. Bullet-list form keeps working; a header
line with a non-backticked remainder keeps the current ambiguous treatment (with
its existing explanatory note).

### sweep_worktrees.sh (skills/ultrapowers/scripts/sweep_worktrees.sh)

**#13 — ROOT derivation survives exotic layouts.**
Replace `dirname` of `--git-common-dir` with the main worktree from
`git worktree list --porcelain | head -1` (the first `worktree <path>` record).
Fixes `--separate-git-dir` (currently dies loudly) and submodules (currently
targets the superproject's `.git` — the dangerous case).

**#14 — locked worktrees are protected by default.**
The sweep currently removes every `wf_*` worktree with `--force --force`,
overriding locks. New behavior: skip `locked` worktrees by default and report them
as kept; a new `--force` flag restores the override. Update the script header,
SKILL.md's Approve step, and report-format.md wording to match (they currently
document the always-override behavior).

### Docs

**#15 — document the fence-tracker leniency.**
No code change. Add a note to dependency-analysis.md's fence section: the
stack-based tracker treats info-stringed runs inside an open fence as nested
openers (required for balanced nested examples); on pathological *unbalanced*
trailing fences it is more lenient than strict CommonMark, which can let lines in
malformed example markdown reach scanning.

**#16 — one path variable everywhere.**
Standardize all sibling-resource references on `${CLAUDE_PLUGIN_ROOT}` (the
officially documented plugin variable), replacing `${CLAUDE_SKILL_DIR}` in
SKILL.md Steps 4a/5 and report-format.md. Note once in SKILL.md what it resolves
to (the plugin's installed root). Update every test pin that asserts the old
spelling.

### Closeout

**#17 — won't fix.** Close with a comment: real plans sit far below 100 tasks and
compile is a one-shot orchestrator cost; if dense plans ever materialize, the fix
is an incrementally maintained transitive-closure bitset (or incremental
topological order) replacing the per-pair reachability DFS.

Issues #8–#16 and #18 close when the work merges. The batch ends with a version
bump to 0.6.0 (plugin.json + release commit), following the existing release
pattern.

## Cross-cutting design

**Parallelism lanes (the plan runs via /ultrapowers, so file collisions dictate
waves).** Four lanes, parallel with each other, serialized internally:

1. `workflow.js`: #9 → #8 → #18 (same file; validation first, behavior change
   second, cosmetics last).
2. `compile_plan.py`: #10 → #11 → #12 (same file).
3. `sweep_worktrees.sh`: #13 → #14 (same file).
4. Docs: #16 (the sweep across SKILL.md / report-format.md / dependency-analysis.md)
   → #15 (its note lands in dependency-analysis.md after the variable sweep).
   #14's doc edits touch SKILL.md/report-format.md too, so the plan must order or
   scope those edits to avoid a write race with #16 (Depends-on marker).

**Testing.** Every behavior change is TDD'd and pinned:

- #8/#9: new scenarios in `tests/sim_workflow.mjs` (budget-dies-mid-wave asserting
  no merge/reconcile/integration dispatch and DEFERRED attribution; duplicate-id
  launch asserting the loud throw). #18 relies on existing scenarios staying green.
- #10/#11/#12: pytest fixtures in `tests/test_compile_plan.py` (cycle output
  asserts the edge path with why labels; plural-list plans assert the extra edges;
  inline-Files plans assert parsed paths and no ambiguous-files serialization).
- #13/#14: `tests/test_sweep_worktrees.py` additions (porcelain-derived ROOT on a
  standard layout; locked worktree kept by default, removed under `--force`).
  Exotic layouts (`--separate-git-dir`, submodule) are covered by a test where
  practical, otherwise asserted via the porcelain parse unit.
- #16: update the pinned path assertions; add one pin that greps for
  `CLAUDE_SKILL_DIR` absence so the second convention cannot creep back.
- `tests/test_no_prompt_drift.py` guards any prompt-adjacent edits as usual.

**Error handling.** House style throughout: fail loud, refuse to run on malformed
input, honest report attribution (#8's entire point is that the report must name
budget exhaustion, not a merge failure).

## Out of scope

- #17's perf work (closed won't-fix).
- #18 item 2 (cascade-loop extraction — rule of three).
- #11 title/phase fuzzy matching.
- #15 exact-CommonMark fence tracking.
