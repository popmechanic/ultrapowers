# Frontier mode in the shipping engine — design

Date: 2026-08-12. Follows the production-test adjudication
(`evals/frontier/results/2026-08-12-production-test.md`): G1/G2/G3 PASS, E1
material (~2× causal after protocol-asymmetry decomposition), E2 acceptable →
PROPOSE. This increment's own A/B must close the two questions that cell could
not: **token cost**, and **the parallelism ratio at production task length with
review on**.

## Background

The engine serializes any two tasks whose declared paths overlap
(`write-after-write` edges, document order). The frontier eval line proved the
alternative: fold concurrent same-file edits with the vendored manyana kernel,
narrate conflicts to a serial whole-file resolver, and replay the recorded
fold log deterministically to the shipped tree. Measured: 41% same-file-edge
recovery on the contended fixture; barrier removal itself is worth only ~4.9%
mean (max 21.7%) modeled — so this increment keeps waves and changes only what
the numbers justify: the serialization rule and the merge step for waves it
affects.

The corpus finding cuts both ways: real plans show `same_file_edges = 0`
because ultraplan's authoring rules steer authors away from contention — at a
documented authoring cost (unnatural task splits, chains-for-fans, Depends-on
declared for overlap alone, engine routing lost to doc-file collisions). The
engine capability and the authoring relaxation ship **coupled**, an operator
decision recorded at brainstorm time: without the relaxation no production
plan can ever exercise the mode, and the shakedown below could not exist. The
relaxation carries a named canary (§5) because it is the unmeasured half.

**Founding orientation (operator-directed, grants nothing):** the fold engine
and its fold log are installed as a first-class module with the wave engine as
their first caller, so that future callers — if ever separately proposed and
eval-gated — add drivers rather than migrate formats. No future capability is
licensed by this spec.

## Goal

1. Plans may declare genuinely independent tasks that edit the same files;
   the compiler schedules them concurrently and the engine folds their work,
   with conflicts narrated, resolved serially, and recorded in a replayable
   fold log — falling back to today's merge path on any guard or pre-adoption
   failure.
2. An engine-vs-engine A/B on a production-scale contended fixture, full
   protocol both arms (review on, gate on), closes token cost and
   production-length parallelism before release.

## Non-goals

- Event-driven scheduling, removal of waves, chunking, or barriers.
- Any change to worktree isolation, per-task review, integration review,
  redirect machinery, pause/resume, or the frozen verification periphery
  (gates, sealing).
- Kernel periphery expansion: binaries, symlinks, gitlinks, mode *changes*,
  files over the resolver cap, renames. Guards route these to the existing
  path; they are not new capability.
- Frontier folding for non-contended waves (they keep the git-merge path) and
  for redirect waves (hand-authored, stay serialized — and structurally so:
  the contended tag is per-task, so a filtered redirect wave loses contention
  unless ≥2 tagged tasks survive together, §1).
- ultralearn's observation ledger is untouched; "fold log" is deliberately
  not called a ledger to avoid colliding with that standing term.

## Where it lives

Moves (promotion, one copy, evals re-point their imports):

- `evals/frontier/vendor/manyana.py` + `PROVENANCE.md` →
  `skills/ultrapowers/kernel/vendor/`; the sha256 pin and the
  parse-under-running-interpreter pin in `tests/test_frontier_kernel.py`
  re-point with it.
- `evals/frontier/repo_weave.py`, `evals/frontier/frontier_fold.py` →
  `skills/ultrapowers/kernel/`; their tests re-point. `sampled_orders` and
  `fold_all` move **into the kernel** with them (the shipped self-check calls
  both; a shipped module must not import eval-only code) and
  `schedule_model.py` imports them back.
- The resolver prompt (`evals/frontier/references/resolver-prompt.md`)
  becomes a BAKE block **inside
  `skills/ultrapowers/references/wave-merge.md`** — it is a merge-path
  prompt, and `test_no_prompt_drift.py`'s `WAVE_PROMPTS` extracts from that
  single source; a third prompt file would be invisible to the pin. Rewritten
  for the file-read contract and the two narration shapes (§3).

Stays in `evals/` (modeling and probe apparatus, explicitly modeling-only):
`schedule_model.py` (its `SAME_FILE_WHYS` is the *modeled* drop rule, labeled
as such; the engine's narrower rule lives in `compile_plan.py` and is the one
evals import when measuring the engine), `shadow_fold.py`, `run_eval.py`,
`run_frontier_cell.py` (imports re-pointed). **Because the canonical compile
no longer emits the dropped edges, the modeling/probe entry points
(`run_eval.compile_fixture`, `shadow_fold`, `run_frontier_cell`) compile with
`--serialize-overlaps` to obtain the pre-drop edge set their
`same_file_edges` recovery metric is defined over — otherwise the eval line's
own denominator reads 0 circularly — and `test_frontier_run_eval.py`'s
contend assertions (`mode == "parallel"`, ≥2 `write-after-write` edges)
re-point to that compile.**

New: `skills/ultrapowers/kernel/fold_wave.py` (CLI) and `kernel/FOLD_LOG.md`
(schema — referenced from `ultrapowers/SKILL.md`'s engine section, which
makes `validate_skill.py`'s link-check live for it once the check's regex
extends to `kernel/`; without a `SKILL.md` mention the extension would
validate nothing). `evals/fixtures/contend-prod/`. `--serialize-overlaps` in
`compile_plan.py`, **plumbed**: a `/ultrapowers` launch argument that
`ultra_run.py` forwards onto the `compile_plan.py` argv it builds, recorded
in the run receipt; `evals/ab_runner.py`'s arm flag sets it for arm A and
**verifies it from the receipt** (§6).

Documentation surfaces that are live seams, updated with the code they
mirror: `references/dependency-analysis.md` (the degrade behavior and
`degrade_reason` wording it documents verbatim, §1b; and the Step-3
transparency fields), `ultrapowers/SKILL.md` (Step 1's `ultra_run.py`
invocation — the launch argument's operator-facing home — and Step 3's
mode/degrade rendering), and `references/report-format.md` (the new
`frontier` report section; `tests/test_report_runbook.py` cross-checks it
against what `waves.js` emits).

## Components

### 1. Compiler: the edge-drop rule

Two changes plus one deletion, behind one switch. `--serialize-overlaps` is
the **single** named switch: passed (or shipped as the default if the A/B
fails), the compiler reproduces today's output byte-identically; otherwise
the canonical rules below apply.

One vocabulary note used throughout: the compiler's overlap set for the
`write-after-write` tier is **`writes ∪ reads`** on both sides
(`writes = Create: ∪ Modify:`; `reads` is populated by `Test:` entries — a
`Test:` path parses into `reads`, and the compiler serializes on it by design
because under upstream TDD semantics each task *writes* the failing test).
Every rule below uses exactly this set; the spec deliberately has no second
spelling.

**(a) The drop.** Canonical compile does not create `write-after-write` edges
for eligible pairs. The drop happens **at construction** — the tier-3 loop
skips the edge — never by post-hoc filtering: later tiers (`ambiguous-files`,
catch-all) consult reachability through the accumulated adjacency, so an edge
removed after the fact would leave those tasks unordered against peers they
must still serialize behind. A test pins that an ambiguous/catch-all task
still serializes in a plan where a `write-after-write` edge was dropped.

**(b) The sequential-degrade flatten is deleted, not conditioned.** The
`fully_overlapping` flatten is dead code: whenever the predicate fires, the
tier-3 loop has already created a tournament of `write-after-write` edges, so
`layer()` returns singleton waves before the flatten runs (verified by
compiling an all-overlapping plan and inspecting `layer()`'s output; the
`len(impl) == 1` trigger is equally a no-op). Deleting the line changes no
compile today, and under the canonical rule, all-overlapping-but-eligible
plans then compile to a genuine contended wave with no whole-plan eligibility
cliff: ineligible pairs keep their edges and serialize pairwise while
eligible ones share a wave. The labeling rule is **written as code, not
prose**, because byte-identity is claimed and a looser prose reading breaks
it on a third compile shape (two tasks sharing only a `Test:` path carry a
`write-after-write` edge yet compile `mode: parallel` today — `writes` don't
intersect):

```
fully_overlapping = len(impl) > 1 and all(
    set(a["writes"]) & set(b["writes"])          # writes-only, as today
    for (a, b) in pairs_whose_edge_was_kept)     # restricted to kept pairs
```

Under `--serialize-overlaps` every edge is kept, so the predicate — and
`mode`/`degrade_reason` — are byte-identical to today's on every plan shape.
Canonically, dropped pairs leave the predicate, so a fully-overlapping
eligible plan labels `parallel`. Pinned on **three** shapes: all-overlapping
(canonical → one contended wave; switch → today's `sequential` singletons),
shared-`Test:`-only (both compiles → `parallel`, no degrade reason, matching
today), single-task (unchanged). `references/dependency-analysis.md`'s
degrade wording updates with it. `complexityEffect`: simplification.

**(c) Label semantics.** The drop keys on the `write-after-write` label.
Pairs whose overlap edge was **promoted** to `interface` stay serialized and
their waves are not tagged contended. All semantic edges survive untouched:
`marker`, `text`, `interface`, `prose-reference`, `write-after-create` (the
base to edit against must exist), `read-after-write`, `ambiguous-files`
(unknown writes cannot be scheduled into contention).

Disclosure: the modeled rule (`schedule_model.SAME_FILE_WHYS`) also dropped
`write-after-create` and `ambiguous-files`. The engine rule is a strict,
deliberately conservative subset. On the contended fixture the two rules
coincide (all three dropped edges were `write-after-write`), so the measured
41% transfers; the A/B re-measures under the engine's own rule regardless.

**Eligibility pre-filter.** A pair keeps its serializing edge when any path
in its overlap set (`writes ∪ reads`, both sides), where it exists in the
repo, would already fail the kernel's own dispatch predicate — non-text
content, over `RESOLVER_LINE_CAP` (imported from the kernel, never re-typed),
or a non-regular git object (symlink, gitlink). This is a scheduling
heuristic — don't dispatch parallel work certain to park — not a safety
guard: the runtime predicate (`dispatchable()`, and the materialization
rules) remains authoritative for files tasks create or grow past the cap
(e.g. two tasks *creating* the same binary path are freed here and park at
runtime — an expected production fallback source, named in §5's canary).
Kept-for-eligibility pairs are recorded through the **existing**
`marker_conflicts` vocabulary (`kind: "inference"`, naming path and reason) —
no new diagnostic vocabulary, so the freeze is not touched.

**The contended tag is per-task and inline.** `waves.js` has no filesystem
access — knobs ride the inline task entries, the established #89 channel
(`tier`, `review`), precisely because top-level keys and wave positions are
**not stable across relaunches**: `redirect_args.py` filters and compacts
`waves` while carrying every other args key verbatim, so a positional
per-wave array (the shape round 3 adopted) would hand a redirect wave the
*previous* wave's tag — the #131 renumbering defect class, already
cosmetically visible in stale `waveLabels` on every relaunch today. Instead
each task in a dropped pair carries `contended: true` plus its overlap
paths, and **a wave is contended iff ≥2 of its tasks carry the tag** —
filtering preserves the invariant by construction, and a one-task redirect
wave is non-contended automatically. Pinned: a `redirect_args.py` round-trip
over a contended compile yields a wave the engine does not route to the fold
path. Untagged compiles are byte-identical to today.

### 2. Kernel module and fold CLI

`kernel/fold_wave.py` is a deterministic CLI (no LLM). Because each
invocation is a fresh process, **all state lives in git plus the fold log**,
and every invocation rehydrates before acting.

- **Rehydration is a named kernel entry point** —
  `rehydrate(log) -> FrontierEngine`: `fold` events recompute the task's
  endpoint diff from its recorded `headSha` (a pure function of git objects)
  and re-fold it — which also reconstructs the touched-path map — and
  `resolve` events re-apply their recorded `lines` **unconditionally** and
  are appended to the engine's event list, so the epoch clock reconstructs
  exactly. **Validity is never re-checked during rehydration**: the log
  records what actually applied, and re-running `apply_resolution`'s
  staleness check would silently skip a recorded resolution — the epoch pin
  cannot catch that, so the no-recheck rule is stated here as contract
  (today's `replay()` docstring already gives the reason; `replay()` becomes
  a thin wrapper over `rehydrate`). `base`, `conflict`, and `fallback`
  events are inert for rehydration. The pin asserts the rehydrated engine's
  `epoch()` **and touched-path map** equal the live engine's across ≥3
  process boundaries — not merely the manifest.
- **Line convention becomes a bijection.** Today `split_lines` drops one
  trailing newline and `join_lines` unconditionally re-adds one, so a folded
  file with no final newline would be silently rewritten — and both
  self-checks compare manifests built through the same normalization, so
  they are structurally blind to it (the cell and every shadow run
  normalized both sides). The new pair, written out:
  `split_lines(content) = content.split("\n")` and
  `join_lines(lines) = "\n".join(lines)` — a bijection between byte strings
  and line lists in which the empty file is `[""]` and `[]` is not a valid
  line list (reserved; constructing it is a kernel error). This changes
  materialized bytes on one live path today: `join_lines([""])` currently
  yields `"\n"`, under the bijection `""` — pinned explicitly.
  `frontier_fold._visible` becomes the identity under the bijection and is
  **deleted**; the resolver's reply-file bytes are split by the kernel's own
  `split_lines`, so exactly one normalization exists on that path. Pinned: a
  folded text file with no final newline materializes **byte-identical**.
  The divergence self-checks compare normalized manifests; byte fidelity is
  this pin's job, not theirs.
- **`fold` subcommand:** given the wave base sha and the mergeable branches
  **in task-index order** (the existing merge contract's order — completion
  order is not observable to the engine, and K1 order-independence is
  exactly what the self-check asserts, so determinism costs nothing and buys
  reproducible conflicts), folds each, appends `fold` events, and writes per
  conflict: the annotated narration to `frontier/wave-<n>/conflict-<i>.txt`
  and its `dispatchable()` verdict — including park reasons for ineligible
  conflicts and kernel-limit parks (recursion on ~1000-line files) — to the
  **conflicts index**, which is the single record of parks (no separate
  `park` event; one fact, one record). **Snapshot scoping is a stated
  ordering contract:** first derive every task's touched set
  (`git diff --name-status` against the base), union them, build the scoped
  base `RepoState` from that union, **then** fold — a per-task streaming
  scope would silently misclassify a path another task later touches as an
  add/add instead of a modify (`task_state_from_contents` branches on
  membership in the base). Never a whole-tree `snapshot()` (one subprocess
  per file per invocation would charge O(repo) against the very wall-clock
  bar §6 registers). Runs the two live self-checks the cell ran — sampled
  raw fold orders outcome-identical, and log replay reproduces the
  manifest — and reports failure as a named fallback, never a silent pass.
- **`resolve` subcommand:** applies a whole-file resolution from a file of
  lines under epoch validity (an intervening fold on the path since the
  narration's epoch → stale, re-narrate once), appending the `resolve` event
  **with the lines** — the log alone must replay. A **re-narration is a
  markerless whole-file body** (re-folding an already-folded endpoint
  narrates nothing — the cell's `_renarrate` measured this); `dispatchable()`
  is not re-applied to it, and the resolver prompt accepts both shapes.
- **`materialize` subcommand — the temporary-index route, so the worktree is
  untouched by construction:** `GIT_INDEX_FILE=<tmp> git read-tree
  <prevHead>`, then per path in the union of the fold events' touched sets:
  present in the manifest → `git hash-object -w` + `git update-index
  --cacheinfo <mode>,<sha>,<path>` with the **mode taken from the previous
  integration head** (base mode preserved; a mode *change* by a task is a
  park; a folded path that cannot be a regular blob is a named fallback);
  absent from the manifest → `git update-index --force-remove` (the fold
  manifest omits deletions; keying on the manifest alone would silently
  resurrect a task's `git rm`). Then `write-tree` → `git commit-tree` with
  parents = previous integration head + merged task heads. Paths outside the
  touched set are never visited — their modes, symlinks, and gitlinks
  survive because git never sees them — and `INTEGRATION_WT` stays checked
  out on the integration branch at the previous head with a clean status:
  nothing is written to the worktree until the engine's deliberate suite
  checkout (§3). Adoption mechanics are the engine's (§3).

**All CLI I/O is file-based** (#36: relaying structured payloads through
agent replies corrupts them). The CLI reads and writes under
`<runDir>/frontier/`; agents relay only paths, counts, and enum verdicts.

### 3. Engine: the contended merge path

For a contended wave, `mergeWave()` routes its **existing merge agent role**
through the contended contract — one role, two contracts, dispatched at
**`TIER.mostCapable`** for the contended contract (its duties — CLI
invocation, candidate checkout without ref movement, suite run,
fast-forward-or-restore — most resemble reconcile's, which already runs at
mostCapable; `TIER.cheap` stays for the plain-merge contract only: a cheap
model improvising any of those git invocations would convert the priced
fallback into a blocked wave). The contended contract is its own contiguous
`BAKE:CONTENDED_MERGE_PROMPT` block in `references/wave-merge.md` — kept
separate because the two contracts are cleanly separable and independently
pinned, not because the drift pin requires it (the wave-prompt pin matches
placeholder-split fragments in order, not contiguous text) — and
`WAVE_PROMPTS` in `test_no_prompt_drift.py` gains entries for it and the
resolver block. The prompt locates the CLI via the existing `<pluginRoot>`
token that `fillPaths()` fills (precedent: `review-package`). **It carries
the `heads/` slot-recording sentence verbatim from the existing merge
contract** (`mkdir -p <runDir>/heads`; `git rev-parse` per task and wave
slot), and the contended dispatch appends `headsSlotsLine(merged, waveIdx +
1)` exactly as the merge dispatch does — the completeness critic treats a
missing slot as an ancestry miss and forces the run BLOCKED, so a contended
prompt without this sentence would block every contended run. **The
contended branch's `catch` routes to fallback** (the git-merge path), never
into the reconcile loop — a thrown contended dispatch has no fold log to
reconcile against.

1. The merge agent runs `fold_wave.py fold` and replies with counts +
   verdicts + paths — small scalars under a new sibling `FOLD_SCHEMA`
   (`MERGE_SCHEMA` is `status`/`headSha`/`detail` and cannot carry them).
2. For each dispatchable conflict, `waves.js` first checks
   `budgetExhausted()` — every existing dispatch site is checkpointed, and a
   serial N-conflict loop must be too; exhaustion routes to fallback (still
   live at this point) — then dispatches **one resolver agent at a time**,
   **inheriting the session-ambient model (no tier override), exactly as the
   cell's resolver did** — like-for-like with the E2 the operator graded;
   tier escalation is a post-A/B knob, not a launch-time confound. The
   resolver **reads its narration file itself** and writes its whole-file
   resolution to a reply file (a contract change from the cell's no-tools
   text-in/text-out resolver; the promoted prompt is rewritten for it and
   for both narration shapes). A merge-agent call then runs `resolve`; stale
   → re-narrate once. Serialization is by construction: the loop awaits each
   resolution. Resolver calls are workflow-visible agents — in the progress
   tree, charged to the run budget, transcripts recorded verbatim in the
   report.
3. **The wave test runs against the candidate before adoption, with the
   branch unmoved.** The merge agent checks the candidate's tree out into
   `INTEGRATION_WT` **without moving the branch ref** (`git read-tree -u`
   from the candidate), runs the project suite (the same `testInstruction`
   duty the merge contract already carries), and on green **fast-forwards
   the integration branch to the candidate** and writes the `heads/` slots —
   replying `MERGED` + `headSha` so the existing call-site handling
   (`waveBaseSha`, review base) is unchanged. On red — the most likely
   fallback trigger: a resolution that folds clean but is semantically
   wrong, exactly the path the adjudication's E2 caveat named as unexercised
   — the agent **restores the worktree** (`git reset --hard <prevHead>`
   **and** `git clean -fd`, bounded to what the suite checkout wrote) and
   the wave falls back. The restore matters: both fallback prompts begin by
   verifying they are on the integration branch and refuse to operate
   otherwise, so a dirty or detached worktree would turn fallback into
   BLOCKED.

**Fallback — live strictly before adoption, and honestly priced.** The fold
consumes task branches but never destroys them, so kernel error, ineligible
conflict, resolver parked after its retry, budget exhaustion mid-loop,
self-check failure, materialization park, a thrown contended dispatch, or
**candidate suite failure** all route the wave to the existing git-merge +
reconcile path with the integration branch and worktree exactly where that
path expects them. After adoption, task heads are ancestors of the
integration branch and the reconcile path can no longer bind — from there
the only route is redirect, as with any adopted merge today. And the
fallback is **not** "today's behavior arrived at late": under today's rule
these tasks never ran concurrently, so the reconcile agent (two attempts,
then `blockedWaves`) is handed a multi-task same-file collision it was never
built for, with the parallel work already spent. The fallback's real cost is
a wave that can end blocked. Accordingly, **fallback rate on contended waves
is a pre-registered hard gate in the A/B (§6) and the production canary
(§5)** — not merely a named event. Every fallback appends a `fallback` event
and surfaces in `judgmentCalls`.

Task failure and review handling are unchanged: only mergeable results fold,
exactly as only mergeable results merge today.

### 4. Fold log schema (first-class contract)

One JSONL file per contended wave
(`<runDir>/frontier/wave-<n>/fold_log.jsonl`), self-sufficient for
rehydration, four event types:

- `base {sha}` — first line, the wave base.
- `fold {task, headSha}` — the touched set is *derived* by re-folding from
  `headSha` at rehydration, never stored (a stored copy of a derivable fact
  invites undetectable divergence).
- `resolve {path, epoch, lines}` — the lines themselves; rehydration
  consumes them.
- `fallback {wave, reason}`.

Conflicts and parks live in the **conflicts index** (§2), not the log —
narrations, `dispatchable()` verdicts, and park reasons are one fact with
one record. `base`, `fallback` are inert for rehydration (§2). `report.json`
gains a `frontier` section per contended wave: fold-log path, conflicts
index, self-check results, **fold-CLI wall time** (its own line, so the
first real-repo reading is not buried inside a passing E1′), resolver
transcripts verbatim (the E2 grading surface), fallbacks. Schema documented
in `kernel/FOLD_LOG.md`; the section's shape mirrored in
`references/report-format.md`, whose cross-check against `waves.js`
(`test_report_runbook.py`) is a live seam.

### 5. Authoring: ultraplan relaxation, canary, and shakedown

`ultraplan/SKILL.md` stops steering authors away from same-file edits: the
three watch-item contortions (unnatural splits, chains-for-fans, Depends-on
for overlap alone) become explicitly wrong; `Files:` blocks remain required
(they are the compiler's detection input). The execution-handoff rubric's
"treating same-file edits as dependencies" clause is updated in both mirrors
(`hooks/session_start.sh`, `ultraplan/SKILL.md`);
`tests/test_recommendation_rubric.py` pins the new text.

This half is the unmeasured rigor trade, so it carries a **canary** per house
doctrine: at `engineVersion ≥` the adopting release, ultralearn sense passes
track (a) fallback rate per contended wave and (b) redirect-round rate on
plans with contended waves vs. the portfolio baseline. **Expected fallback
sources are named up front** so their first occurrence reads as the priced
cost, not a regression: concurrently-created binary paths, runtime over-cap
growth, and semantic suite failures at candidate time. First persistence of
*elevated* rates flags the relaxation possibly-failed; second persistence
makes drafting the reversal (restore serialization by default, keep the
engine capability guarded) mandatory distill output. Adoption of any reversal
stays operator-gated.

**The canary's first reading is pre-release:** one real backlog plan authored
under the relaxed rule runs `/ultrapowers` end-to-end (the shakedown), and
its `frontier` report section — including the fold-CLI wall-time line — is
operator-reviewed before the release ships. Evidence, not a gate.

### 6. The gating A/B

**Fixture:** `evals/fixtures/contend-prod/` — a realistic small application
where 4 independent tasks each deliver a real feature (multi-file, with
tests) and all modify one shared hot file (< `RESOLVER_LINE_CAP` lines).
**Production length, calibrated before the cells run:** each task is sized so
its implementer runs ≥ 5 minutes, and arm A end-to-end ≥ 30 minutes — the
regime where task work, not protocol fixed cost, dominates (the prior cell's
~40 s tasks are exactly what the adjudication said cannot answer E1). If a
calibration run misses those floors, the fixture is resized before any
counted cell. The fixture carries a **sealed acceptance suite** authored by
one seal-author dispatch at fixture-build time, priced into the plan as a
task — and the build task **adds `contend-prod` to the hardcoded `FIXTURES`
list in `test_fixture_seals.py`** (the test requires nothing of fixtures it
does not list).

**Cells:** engine vs engine at the same ref, full protocol both arms —
review on, gate on — via `ab_runner.py`. Arm A compiles with
`--serialize-overlaps`; arm B compiles canonically. The only variable is the
serialization rule. Output tokens harvested identically both arms
(`_usage_output_tokens`); wall clock end-to-end.

**Pre-registered decision rule (fixed before building):**

- **n = 1 pair**, arms sequential on one machine, same engine ref. A run
  that dies before producing a gate verdict is an invalid interval and is
  superseded via `--rerun-of` (the OAuth precedent); a run that produces a
  verdict is never re-rolled.
- **Hard gates — not overrulable:** **arm identity verified from the run
  receipt** — each cell's receipt records its compile disposition and
  `ab_runner` asserts it matches the assigned arm before counting the cell
  (the arm assignment rides an LLM-transcribed launch prompt; a dropped flag
  would silently collapse both arms to canonical and read E1′ ≈ 1.0×; a
  mismatch is an invalid interval, superseded via `--rerun-of`); both arms'
  gates green; arm B fold-log self-checks clean (sampled raw orders
  outcome-identical, replay match); **zero fallbacks on contended waves in
  arm B**; zero silent divergence; every park named in the conflicts index.
- E1′: arm B end-to-end wall clock ≤ **0.7×** arm A (the numeric bar for
  "material" — the 4-wide fixture's causal expectation is ~2×, leaving
  headroom for review overlap).
- E2′: arm B output tokens ≤ **1.25×** arm A, and any live resolutions
  graded acceptable by the operator from the verbatim transcripts. The
  resolver runs at the ambient tier both arms (§3), like-for-like with the
  graded E2 — the bar carries no pre-written excuse.
- **Only E1′/E2′ may be overruled**, and only with recorded reasoning in the
  results doc (house precedent: the E1 decomposition of 2026-08-12). Hard
  gates cannot be overruled — that lever is how an unmeasured mode would
  ship.
- Any hard-gate red, or E1′/E2′ miss without a recorded overrule → the
  compile switch ships defaulted to `--serialize-overlaps` (mode dark) and
  the result is recorded. Pass → release with the canonical default.

**Honesty bounds, carried into the results doc:** n = 1 is directional, not
statistical (the standing 0.1.0 constraint); the A/B answers the
adjudication's *length* question at width 4 — width-scaling beyond that
remains modeled; and the A/B is the **first live observation of the
bijective line convention** (§2) — the cell's E2 narrations were produced
under the old convention, so the E2 grade transfers as precedent, not as
data.

## Error handling

Stated per component above; the invariants: **every failure degrades through
a named event**, the degradation target before candidate adoption is the
existing merge/reconcile path — reached with the integration branch and
worktree exactly where that path expects them, at its real cost stated in §3
— and after adoption the route is redirect, as today. A
`--serialize-overlaps` compile is byte-identical to today's. The engine never
claims a fold succeeded without the live self-checks; replay divergence is a
fallback, not a warning.

## Testing

- **pytest:** edge-drop at construction (only `write-after-write` label
  dropped; semantic edges survive; ambiguous/catch-all tasks still serialize
  against peers whose overlap edge was dropped; promoted-interface pairs
  stay serialized and untagged; the pre-filter keys on the compiler's
  `writes ∪ reads` overlap set and keeps edges for non-text / over-cap /
  non-regular existing paths via existing `marker_conflicts` vocabulary;
  `--serialize-overlaps` reproduces today's compile byte-identically), the
  flatten deletion with the kept-pairs labeling predicate pinned on **three
  shapes** (all-overlapping both ways; shared-`Test:`-only both ways —
  `parallel` under the switch, matching today; single-task), per-task
  contended tagging (`contended` inline entries; wave-contended iff ≥2
  tagged tasks; **a `redirect_args.py` round-trip over a contended compile
  yields no fold-path routing**), fold CLI (rehydration across ≥3 process
  boundaries asserting epoch and touched-path equality — including a
  recorded resolve applied unconditionally, never validity-rechecked —
  task-index fold order, epoch validity, both narration shapes, the
  union-then-fold snapshot-scoping contract — a base-existing path touched
  by only one task folds as a modify, never add/add — self-checks, log
  replay, park reasons in the conflicts index), line-convention bijection
  (no-final-newline file materializes byte-identical; `join_lines([""])`
  yields the empty file; `[]` rejected), materialization (temporary-index
  route: touched-set application, deletions reach the tree, untouched
  executable/symlink keep mode and link, folded 100755 keeps its bit from
  the base, task mode-change parks, non-regular folded path → named
  fallback; **discarded candidate: integration ref unchanged and
  `git status --porcelain` empty afterward**), and the eval re-point
  (`test_frontier_run_eval.py` asserts against the `--serialize-overlaps`
  compile). The promoted kernel modules' tests move with them; the vendor
  sha256 + parse pins re-point.
- **Harness sim:** `tests/frontier_merge.mjs` drives the contended path in
  `waves.js` with stubbed agents — clean fold, conflict→resolve,
  stale→re-narrate (markerless shape), park→fallback, budget exhaustion
  mid-loop, thrown-dispatch→fallback, candidate-suite-failure→fallback —
  asserts the contended dispatch text **contains the `heads/` slot names for
  every merged task id**, and prints the `ALL SCENARIOS PASSED` sentinel
  (the suite-gate runs it on any harness JS change; a harness change with no
  covering sim fails the gate by design).
- **Prompt pins:** the `CONTENDED_MERGE_PROMPT` and resolver blocks in
  `wave-merge.md` enter `test_no_prompt_drift.py`'s `WAVE_PROMPTS`; rubric
  mirror text pinned by `test_recommendation_rubric.py`;
  `test_report_runbook.py` covers the `frontier` report section.
- **Fixture seal:** `contend-prod` sealed and added to `FIXTURES`.

## Release

Minor bump (architectural): both manifests to the same version, standard
release commit. The verification periphery is untouched; the compiler emits
no new diagnostic vocabulary (kept-pairs ride the existing `marker_conflicts`
`inference` kind).

## Trim review

Author's disclosure — **Adds:** kernel module (promoted, not new code), fold
CLI + four-event fold log (rehydration entry point, bijective line
convention, scoped snapshots, temporary-index materialization), contended
contract of the existing merge-agent role at mostCapable (`FOLD_SCHEMA`,
`CONTENDED_MERGE_PROMPT` + resolver BAKE blocks in `wave-merge.md`,
`heads/` slot sentence, candidate adoption mechanics), ambient-tier
resolver-as-agent loop (budget-checkpointed), compiler construction-time
edge-drop + pre-filter + per-task `contended` tag behind one plumbed switch,
`contend-prod` fixture (sealed, `FIXTURES` entry), one `.mjs` sim,
rubric/authoring text updates + canary, ab_runner arm flag with
receipt-verified arm identity. **Removes:** the `write-after-write`
serialization default, the dead `fully_overlapping` flatten line,
`frontier_fold._visible`, the `paths` field and `park`/`conflict` event
types from the log (conflicts index holds them), `evals/frontier/` as the
kernel's home, and — at authoring time — the three documented same-file
contortions.

### Round 1 (fresh-context reviewer; grade: `netConceptDelta` **up** — "nine adds against three removes; nothing makes an existing defect class inexpressible")

Fourteen findings; adopt-or-answer:

1. **Hash-only `resolve` events cannot replay** — ADOPTED. `resolve` carries
   `lines`; hash deleted; the log is self-sufficient (§4).
2. **Cross-process kernel state unspecified** — ADOPTED. Rehydration rule
   defined (git + fold log are the only state); pinned by a
   process-boundary test (§2). *(Rounds 2 and 4 corrected the mechanism:
   named `rehydrate` entry point, epoch-clock reconstruction, no validity
   re-check.)*
3. **Structured payloads through agent replies (#36)** — ADOPTED. All CLI
   I/O file-based; agents relay scalars; resolver reads its narration file
   itself; prompt-contract change from the cell's resolver stated (§2, §3).
4. **Whole-tree materialization destroys modes/symlinks/gitlinks** —
   ADOPTED. Folded-paths-only application (§2). *(Rounds 2–4 corrected the
   mechanism: touched-set application, then the temporary-index route.)*
5. **Python < 3.12 guard guards nothing** (vendor patch removed the PEP 701
   line; standing parse pin under the running interpreter) — ADOPTED,
   deleted.
6. **Guards duplicate `dispatchable()`; 400 re-typed** — ADOPTED. One
   pre-filter, explicitly a scheduling heuristic, importing
   `RESOLVER_LINE_CAP`; runtime predicate authoritative (§1).
7. **Post-hoc edge filtering breaks later compiler tiers** — ADOPTED. Drop
   at construction; ambiguous/catch-all serialization pinned by test (§1).
8. **`write-after-write` label ≠ "both write"** — ADOPTED. Label vs. overlap
   set defined; promoted-interface pairs stay serialized (§1). *(Rounds 2–3
   corrected the set twice; final: the code's `writes ∪ reads`, stated
   once.)*
9. **Fold conductor duplicates the merge agent** — ADOPTED. One role, two
   contracts; contended contract in `wave-merge.md` (§3). *(Round 4 pinned
   the contended contract's tier.)*
10. **Fallback is a new failure mode, not late-arriving old behavior** —
    ADOPTED. Cost stated; contended-wave fallback rate promoted to A/B hard
    gate and production canary (§3, §5, §6).
11. **Relaxation is an unmeasured rigor trade without a canary** — ADOPTED
    in mechanism (canary + reversal trigger, §5); the trim to *defer* §5 is
    ANSWERED-REJECTED: coupling is an operator decision recorded at
    brainstorm time — without relaxation no production plan exercises the
    mode and the shakedown cannot exist.
12. **A/B under-specified on its own two questions** — ADOPTED. Seal named
    and priced; production-length floors (≥5 min/task, ≥30 min arm A) with
    calibration-before-counting; n=1 pair with rerun policy; numeric bars
    (0.7× wall clock, 1.25× tokens) with overrule-by-recorded-reasoning
    (§6).
13. **Kernel promotion leaves eval dependencies undefined** — ADOPTED. Full
    move/stay/re-point enumeration; `schedule_model` retired to
    modeling-only with the two-rules relationship stated; `validate_skill`
    link-check extended to `kernel/` (§Where it lives). *(Round 3 made the
    extension live via a `SKILL.md` reference; round 4 added the
    `--serialize-overlaps` compile for the eval entry points.)*
14. **Cut the Founding-architecture section; "ledger" collides with
    ultralearn's ledger** — ADOPTED for the rename (fold log, everywhere)
    and the replay overclaim (fixed via 1–2); PARTIALLY ADOPTED for the cut:
    shrunk to a three-line "Founding orientation" note that explicitly
    grants nothing — kept because the operator directed that an anti-drift
    statement of the module's founding role appear in the spec.

### Round 2 (fresh-context reviewer; grade: `netConceptDelta` **up**; found 1 blocker + 11 findings; loop explicitly not ended)

Twelve findings + four trims; adopt-or-answer:

1. **BLOCKER — the `fully_overlapping` sequential degrade nullifies the
   increment on all-overlapping plans** — ADOPTED. *(Round 3 corrected the
   fix from an additive conditional to deleting the dead flatten line;
   round 4 wrote the labeling predicate as code — §1b.)*
2. **Folded-paths-only materialization resurrects deletions** — ADOPTED.
   Touched-set keying; deletion test added (§2, §Testing).
3. **`replay()` cannot rehydrate: the epoch clock desynchronizes** —
   ADOPTED. Named `rehydrate()`; resolve events appended; pin asserts epoch
   + touched-map equality (§2, §4). *(Round 4 added the no-validity-recheck
   contract.)*
4. **Fallback is dead after materialize; the wave test has no stated home**
   — ADOPTED. Candidate ordering: suite before adoption; post-fold suite
   failure a first-class trigger; after adoption, redirect only (§2, §3).
   *(Rounds 3–4 supplied the worktree and temporary-index mechanics.)*
5. **Shipped kernel would import eval-only `schedule_model`** — ADOPTED.
   `sampled_orders`/`fold_all` move into the kernel (§Where it lives).
6. **Pre-filter misses shared `Test:` paths; "readers fold clean" is wrong**
   — ADOPTED. Full overlap set; TDD-write reading (§1). *(Round 3 corrected
   the spelling to `writes ∪ reads`.)*
7. **`MERGE_SCHEMA` cannot carry the contended replies** — ADOPTED. Sibling
   `FOLD_SCHEMA`; adoption replies `MERGED` + `headSha` (§3).
8. **No budget checkpoint in the resolver loop; resolver tier unnamed** —
   ADOPTED. Per-conflict checkpoint (§3). *(Rounds 3–4 revised the tier
   decision; final: ambient, like-for-like with the cell — round 4 trim.)*
9. **Modes on folded paths unrepresented** — ADOPTED. Base mode preserved;
   mode-changes park; executable in the folded set in the test (§2,
   §Testing).
10. **Re-narration is markerless; prompt and dispatch rules must say so** —
    ADOPTED (§2, §3; sim covers the markerless shape).
11. **`test_fixture_seals.py` requires nothing of unlisted fixtures** —
    ADOPTED. Build task adds `contend-prod` to `FIXTURES` (§6).
12. **Prompt-pin mechanics; CLI location token** — ADOPTED. Own BAKE block;
    `WAVE_PROMPTS` entries; `<pluginRoot>` (§3). *(Round 3 corrected the
    stated reason and moved the resolver prompt into `wave-merge.md`.)*

Trims: **one switch** — ADOPTED. **Shakedown into §5** — ADOPTED.
**Founding orientation deletable** — ANSWERED-KEPT (operator direction).
**Diagnostic-vocabulary circularity** — ADOPTED (existing `marker_conflicts`
`inference` kind; freeze untouched).

### Round 3 (fresh-context reviewer; grade: `netConceptDelta` **up**; found 2 blockers + 1 structural + 10 findings; loop explicitly not ended)

Thirteen findings + one scope narrowing; adopt-or-answer:

1. **BLOCKER — the contended tag rode the launch file, which `waves.js`
   cannot read** (#89 class) — ADOPTED as an args-payload key. *(Round 4
   corrected the shape: per-task inline entries, not a positional per-wave
   array — see round 4 finding 1.)*
2. **STRUCTURAL — the `fully_overlapping` flatten is dead code; delete it**
   — ADOPTED. §1b is a deletion plus an explicit labeling rule;
   `complexityEffect` reclassified `simplification`; the eligibility cliff
   is gone. *(Round 4 wrote the labeling predicate as code and added the
   third pin shape.)*
3. **BLOCKER — `CONTENDED_MERGE_PROMPT` without the `heads/` slot sentence
   blocks every contended run** — ADOPTED. Slot sentence verbatim;
   `headsSlotsLine` appended; sim asserts the slot names (§3, §Testing).
4. **The candidate commit had no stated home; fallback could not bind from
   where materialize left the worktree** — ADOPTED. Branch unmoved;
   suite-then-adopt; red-path restore; pinned (§2, §3, §Testing). *(Round 4
   named the construction route: temporary index.)*
5. **Final-newline normalization silently rewrites files; self-checks are
   normalization-blind** — ADOPTED: bijective line convention;
   byte-identity pinned (§2). *(Round 4 wrote out the function pair, the
   `[""]` case, deleted `_visible`, and added the §6 honesty bound.)*
6. **The resolver prompt cannot enter `WAVE_PROMPTS` from a third file** —
   ADOPTED. Resolver block lives in `wave-merge.md` (§Where it lives).
7. **The stated reason for the separate BAKE block was factually wrong** —
   ADOPTED. Real reason stated (§3).
8. **Whole-tree `snapshot()` cost unpriced** — ADOPTED. Scoped snapshots;
   fold-CLI wall time its own report line (§2, §4, §5). *(Round 4 stated
   the union-then-fold ordering contract.)*
9. **"Completion order" is unobservable and forfeits reproducibility** —
   ADOPTED. Task-index order (§2).
10. **Three overlap-set spellings, none the code's** — ADOPTED. One
    spelling, `writes ∪ reads` (§1).
11. **`--serialize-overlaps` had no path from `ab_runner` to the compiler**
    — ADOPTED. Plumbed launch argument, receipt-recorded (§Where it lives).
    *(Round 4 made receipt verification a hard gate.)*
12. **The `validate_skill.py` extension was inert** — ADOPTED. `SKILL.md`
    references `kernel/FOLD_LOG.md` (§Where it lives).
13. **The resolver-tier justification misstated what the cell measured** —
    ADOPTED. *(Superseded by round 4's trim: ambient tier, removing the
    confound entirely; binary-create canary note kept in §5.)*

Scope narrowing: **hard gates are not overrulable; only E1′/E2′ are** —
ADOPTED (§6).

### Round 4 (fresh-context reviewer; grade: `netConceptDelta` **up** — "the round-3 revision did not move it"; found 2 blockers + 8 findings + 3 trims; loop explicitly not ended)

Ten findings + three trims; adopt-or-answer:

1. **BLOCKER — a positional `contendedWaves` array does not survive
   redirect/salvage relaunch** (`redirect_args.py` filters and compacts
   `waves` while copying other keys verbatim — the #131 renumbering class;
   stale `waveLabels` already demonstrates it cosmetically) — ADOPTED. The
   tag is per-task and inline (the #89 knob channel); a wave is contended
   iff ≥2 of its tasks carry the tag; redirect round-trip pinned (§1,
   §Non-goals, §Testing).
2. **BLOCKER — the canonical default breaks `test_frontier_run_eval.py` and
   zeroes the eval line's `same_file_edges` denominator circularly** —
   ADOPTED. Modeling/probe entry points compile with `--serialize-overlaps`;
   the test re-points (§Where it lives, §Testing).
3. **The labeling recomputation broke its own byte-identity claim on a
   third compile shape** (shared-`Test:`-only plans are `parallel` today —
   `fully_overlapping` reads writes alone) — ADOPTED. Predicate written as
   code (writes-only intersection over kept pairs); third pin shape added
   (§1b).
4. **The contended merge agent's tier was unspecified (plain merge runs at
   `TIER.cheap`); no stated `catch` behavior** — ADOPTED. Contended
   contract at mostCapable; cheap stays for plain merge; thrown contended
   dispatch routes to fallback, never reconcile (§3).
5. **§2 and §3.3 contradicted on candidate construction; `commit-tree`'s
   tree source was unnamed** — ADOPTED. The temporary-index route
   (`GIT_INDEX_FILE` read-tree / update-index / write-tree / commit-tree),
   which makes the clean-worktree pin true by construction (§2).
6. **Scoped snapshots are only correct if the base is built from the union
   of all tasks' touched sets before any fold** (per-task streaming scope
   silently converts modifies into add/adds) — ADOPTED. Union-then-fold
   stated as an ordering contract; modify-not-add/add pinned (§2,
   §Testing).
7. **The bijection needed its exact function pair, the `[""]` case, the
   deletion of `_visible`, and an E2-transfer honesty bound** — ADOPTED,
   all four (§2, §6).
8. **`rehydrate` must state that validity is never re-checked** (re-running
   the staleness check silently skips a recorded resolution; the epoch pin
   cannot catch it) — ADOPTED (§2, §Testing).
9. **Arm identity rode an LLM-transcribed prompt with nothing verifying
   it** (a dropped flag collapses both arms to canonical and ships the mode
   dark on a transcription error) — ADOPTED as a non-overrulable hard gate:
   receipt-recorded disposition asserted by `ab_runner` before a cell
   counts (§6).
10. **Surface omissions: `dependency-analysis.md`, `SKILL.md` Steps 1/3,
    `report-format.md`/`test_report_runbook.py`** — ADOPTED. All three
    named as live seams (§Where it lives, §1b, §4).

Trims: **delete `paths` from the `fold` event** (derivable by re-fold; a
stored copy invites undetectable divergence) — ADOPTED (§4). **Merge `park`
events into the conflicts index** (one fact, one record) — ADOPTED (§2, §4).
**Run the A/B's resolver at the ambient tier the cell was graded on** (a bar
that ships with its own overrule is not a bar; tier is a post-A/B knob) —
ADOPTED, superseding round 3's mostCapable pin; the E2′ pricing caveat is
deleted (§3, §6).
