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
plan can ever exercise the mode, and the shakedown below could not exist.
**The coupling is symmetric on both branches of the A/B (§6): the relaxation
and the rubric change ship only on the pass branch** — a dark engine mode
with relaxed authoring would compile relaxed plans into pairwise-serialized
chains (worse than the contortions it retired) and widen the routing rubric
for a capability just measured as not worth shipping. The relaxation carries
a named canary (§5) because it is the unmeasured half.

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
- Kernel periphery expansion: binaries, symlinks, gitlinks, files over the
  resolver cap, renames. Guards route these to the existing path; they are
  not new capability. (Modes are carried, not expanded: base modes preserved,
  created files take their creator's mode, mode *changes* park — §2.)
- Frontier folding for non-contended waves (they keep the git-merge path) and
  for redirect waves — made **inexpressible**, not argued: `redirect_args.py`
  strips `contended` and its overlap paths from every entry it emits (§1), so
  no redirect wave can route to the fold path, and the stale-overlap-paths
  hazard (a redirect narrowing `files` without touching the tag) cannot
  exist.
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
  prompt, and the wave-prompt drift pin extracts from that single source; a
  third prompt file would be invisible to it. Rewritten for the file-read
  contract and the two narration shapes (§3).

Stays in `evals/` (modeling and probe apparatus, explicitly modeling-only):
`schedule_model.py` (its `SAME_FILE_WHYS` is the *modeled* drop rule, labeled
as such; the engine's narrower rule lives in `compile_plan.py` and is the one
evals import when measuring the engine), `shadow_fold.py`, `run_eval.py`,
`run_frontier_cell.py` (imports re-pointed). **Because the canonical compile
no longer emits the dropped edges, the modeling/probe entry points
(`run_eval.compile_fixture`, `shadow_fold`, `run_frontier_cell`) compile with
`--serialize-overlaps` to obtain the pre-drop edge set their
`same_file_edges` recovery metric is defined over — otherwise the eval line's
own denominator reads 0 circularly.** Consequences stated plainly: track
(a)'s recorded `mode`/`degrade_reason` are the switch's labels, and the eval
line permanently measures the compile mode that is no longer the engine's
default. `test_frontier_run_eval.py`'s contend assertions run under **both**
compiles — switch: ≥2 `write-after-write` edges, `mode: parallel`; canonical:
≥2 tasks carrying `contended` in one wave — so the fixture guarantee covers
the compile the engine actually runs. **Contended runs and the shadow line:**
a contended wave's adoption commit has 1+N parents (§2), and the archived-run
replay machinery excludes >2-parent chains by name in track (c) while
`shadow_fold`'s `group_chain` path would silently decompose them via
`parents[1]` alone — manufacturing false divergence in the very sensor built
to detect it. Contended waves are therefore **excluded from shadow replay by
the same named-exclusion rule, with the fold log as their replacement replay
record** (it is strictly stronger: it replays resolutions too).

New: `skills/ultrapowers/kernel/fold_wave.py` (CLI) and `kernel/FOLD_LOG.md`
(schema — referenced from `ultrapowers/SKILL.md`'s engine section, which
makes `validate_skill.py`'s link-check live for it once the check's regex
extends to `kernel/`; without a `SKILL.md` mention the extension would
validate nothing). `evals/fixtures/contend-prod/`. `--serialize-overlaps` in
`compile_plan.py`, **plumbed**: a `/ultrapowers` launch argument that
`ultra_run.py` forwards onto the `compile_plan.py` argv it builds — arm
identity in the A/B is verified from the receipt's **existing** `compile`
object (`ultra_run.py` already embeds the full compile output; no new receipt
field), §6.

Documentation surfaces that are live seams, updated with the code they
mirror: `references/dependency-analysis.md` (the degrade behavior and
`degrade_reason` wording it documents verbatim, §1b; and the Step-3
transparency fields), `ultrapowers/SKILL.md` (Step 1's `ultra_run.py`
invocation — the launch argument's operator-facing home — and Step 3's
mode/degrade rendering), and `references/report-format.md` (the new
`frontier` report section, §4).

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

**(a) The drop, and exactly which pairs it tags.** Canonical compile does
not create `write-after-write` edges for eligible pairs. The drop happens
**at construction** — the tier-3 loop skips the edge — never by post-hoc
filtering: later tiers (`ambiguous-files`, catch-all) consult reachability
through the accumulated adjacency, so an edge removed after the fact would
leave those tasks unordered against peers they must still serialize behind.
A pair is **dropped** (recorded in `dropped_pairs`, both orderings) only
when the tier-3 loop *would have created a new edge for it*: forward
document order, `(a, b)` not already in `seen` (a marker/text/interface edge
already serializes the pair — there is no `write-after-write` edge to drop,
and the pair is **not** tagged), `not would_cycle(a, b)`, **and** the pair
passes the eligibility pre-filter below. A test pins that an
ambiguous/catch-all task still serializes in a plan where a
`write-after-write` edge was dropped. One disclosed behavioral difference:
dropping edges shrinks the adjacency later `would_cycle` calls read, so an
*ineligible* pair whose forward edge is blocked today only by reachability
through now-dropped edges acquires the forward edge canonically — the pair
serializes in the opposite direction from today (no cycle; the guard still
holds). Stated, and pinned with a shape that exercises it.

**(b) The sequential-degrade flatten is deleted; the labeling predicate
keeps today's full pair iteration.** The `fully_overlapping` flatten is dead
code: whenever the predicate fires, the tier-3 loop has already created a
tournament of `write-after-write` edges, so `layer()` returns singleton
waves before the flatten runs (verified by compiling an all-overlapping plan
and inspecting `layer()`'s output; the `len(impl) == 1` trigger is equally a
no-op). Deleting the line changes no compile today. The `mode` /
`degrade_reason` labeling rule, written as code because byte-identity is
claimed — and **iterating every ordered pair, exactly as today** (iterating
only kept-edge pairs deletes the `False` terms disjoint pairs contribute and
flips ordinary plans to `sequential` in both modes; iterating "all minus
dropped" makes the empty set vacuously `True`):

```python
fully_overlapping = len(impl) > 1 and all(
    (set(a["writes"]) & set(b["writes"])
     and (a["id"], b["id"]) not in dropped_pairs)
    for a in impl for b in impl if a["id"] != b["id"])
```

`dropped_pairs` is empty under `--serialize-overlaps`, so the expression
reduces to today's **literally** — byte-identity by construction, not by
argument. Pinned on **four** shapes: all-overlapping-eligible (canonical →
one contended wave, `parallel`; switch → today's `sequential` singletons);
all-overlapping-*ineligible* (both → today's `sequential`);
shared-`Test:`-only (both → `parallel`, matching today); two-overlapping +
one-disjoint-task (both → `parallel`, matching today — the shape the
kept-pairs reading breaks). `references/dependency-analysis.md`'s degrade
wording updates with it. `complexityEffect`: simplification.

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
content, over `RESOLVER_LINE_CAP` **counted via the kernel's `split_lines`**
(imported, never re-typed; `splitlines()` disagrees with the bijection by
one on every trailing-newline file, so all three counting sites — the
pre-filter, `dispatchable()`, and any future one — count through the same
function, with the exact-cap boundary pinned), or a non-regular git object
(symlink, gitlink). This is a scheduling heuristic — don't dispatch parallel
work certain to park — not a safety guard: the runtime predicate
(`dispatchable()`, and the materialization rules) remains authoritative for
files tasks create or grow past the cap (e.g. two tasks *creating* the same
binary path are freed here and park at runtime — an expected production
fallback source, named in §5's canary). Kept-for-eligibility pairs are
recorded through the **existing** `marker_conflicts` vocabulary
(`kind: "inference"`, naming path and reason) — no new diagnostic
vocabulary, so the freeze is not touched.

**The contended tag is per-task and inline; contention is decided by
intersection.** `waves.js` has no filesystem access — knobs ride the inline
task entries, the established #89 channel (`tier`, `review`), precisely
because top-level keys and wave positions are **not stable across
relaunches** (`redirect_args.py` filters and compacts `waves` while carrying
other keys verbatim — the #131 renumbering class, cosmetically visible today
in stale `waveLabels`). Each task in a dropped pair carries
`contended: true` plus its overlap paths, and **a wave is contended iff it
contains ≥2 tasks whose recorded overlap paths intersect** — tags alone are
not enough, because two tasks tagged from *different* dropped pairs whose
partners landed elsewhere share a wave without sharing a file, and such a
wave must keep the git-merge path (the stated non-goal). `redirect_args.py`
strips `contended` and overlap paths from every entry it emits (§Non-goals).
Pinned: a `redirect_args.py` round-trip over a contended compile yields no
fold-path routing. Untagged compiles are byte-identical to today.

### 2. Kernel module and fold CLI

`kernel/fold_wave.py` is a deterministic CLI (no LLM). Because each
invocation is a fresh process, **all state lives in git plus the fold log**,
and every invocation rehydrates before acting.

- **Rehydration is a named kernel entry point** —
  `rehydrate(repo, log) -> FrontierEngine` — the repo is an explicit input:
  `fold` events reconstruct each task's `TaskState` from git (`publish`
  against the recorded `headSha`, over the scoped base built per the
  ordering contract below) and re-fold it — which also reconstructs the
  touched-path map — and `resolve` events re-apply their recorded `lines`
  **unconditionally** and are appended to the engine's event list, so the
  epoch clock reconstructs exactly. **Validity is never re-checked during
  rehydration**: the log records what actually applied, and re-running
  `apply_resolution`'s staleness check would silently skip a recorded
  resolution — the epoch pin cannot catch that, so the no-recheck rule is
  stated here as contract (today's `replay()` docstring already gives the
  reason; `replay()` becomes a thin wrapper over `rehydrate`). `base` events
  are inert for rehydration. The pin asserts the rehydrated engine's
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
  `split_lines`, so exactly one normalization exists on that path (line
  *counting* also goes through it — §1). **Scope, stated for the operator:
  this is a kernel-wide behavior change riding a frontier increment** — it
  alters `join_lines([""])` for every kernel caller, and historical eval
  artifacts (shadow runs, the cell's E2 narrations) were produced under the
  old convention; §6 carries the honesty bound. Pinned: a folded text file
  with no final newline materializes **byte-identical**. The divergence
  self-checks compare normalized manifests; byte fidelity is this pin's job,
  not theirs.
- **`fold` subcommand:** given the wave base sha and the mergeable branches
  **in task-index order** (the existing merge contract's order — completion
  order is not observable to the engine, and K1 order-independence is
  exactly what the self-check asserts, so determinism costs nothing and buys
  reproducible conflicts), folds each, appends `fold` events, and writes per
  conflict: the annotated narration to `frontier/wave-<n>/conflict-<i>.txt`
  and its `dispatchable()` verdict — including park reasons for ineligible
  conflicts and kernel-limit parks (recursion on ~1000-line files) — to the
  **conflicts index**, which is the single record of parks. **`fold` refuses
  a pre-existing fold log for its wave** — redirect relaunches renumber
  waves into the same run dir (the machinery `rmtree`s `heads/` for exactly
  this staleness class, and nothing else would guard
  `frontier/wave-<n>/`); with redirect entries stripped of `contended` this
  should never fire, and if it does, failing loud beats rehydrating a stale
  log whose resolutions apply unconditionally. **Snapshot scoping is a
  stated ordering contract:** first derive every task's touched set
  (`git diff` against the base), union them, build the scoped base
  `RepoState` from that union, **then** fold — a per-task streaming scope
  would silently misclassify a path another task later touches as an
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
  --cacheinfo <mode>,<sha>,<path>`; absent from the manifest →
  `git update-index --force-remove` (the fold manifest omits deletions;
  keying on the manifest alone would silently resurrect a task's `git rm`).
  **Modes are observed, not assumed** — the text pipeline is mode-blind
  (`--name-status` reports a chmod as `M` with identical blobs), so the mode
  source is `git ls-tree` at the relevant refs: a base-existing path keeps
  the previous integration head's mode **after verifying no task changed
  it** (any task whose head shows a different mode for the path → named
  park); a path the fold *adds* takes **its creating task's mode** (two
  creators with differing modes → named park). A folded path that cannot be
  a regular blob is a named fallback. Then `write-tree` → `git commit-tree`
  with parents = previous integration head + merged task heads. Paths
  outside the touched set are never visited — their modes, symlinks, and
  gitlinks survive because git never sees them — and `INTEGRATION_WT` stays
  checked out on the integration branch at the previous head with a clean
  status: nothing is written to the worktree until the engine's deliberate
  suite checkout (§3). Adoption mechanics are the engine's (§3).

**All CLI I/O is file-based** (#36: relaying structured payloads through
agent replies corrupts them). The CLI reads and writes under
`<runDir>/frontier/`; agents relay only paths, counts, and enum verdicts.

### 3. Engine: the contended merge path

For a contended wave, `mergeWave()` routes its **existing merge agent role**
through the contended contract — one role, two contracts, dispatched at
**`TIER.mostCapable`** for the contended contract (its duties — CLI
invocation, candidate checkout without ref movement, suite run,
adopt-or-restore — most resemble reconcile's, which already runs at
mostCapable; `TIER.cheap` stays for the plain-merge contract only: a cheap
model improvising any of those git invocations would convert the priced
fallback into a blocked wave). The contended contract is its own contiguous
`BAKE:CONTENDED_MERGE_PROMPT` block in `references/wave-merge.md` — kept
separate because the two contracts are cleanly separable and independently
pinned, not because the drift pin requires it (the wave-prompt pin matches
placeholder-split fragments in order, not contiguous text). The prompt
locates the CLI via the existing `<pluginRoot>` token that `fillPaths()`
fills (precedent: `review-package`). **It carries the `heads/`
slot-recording sentence verbatim from the existing merge contract** (`mkdir
-p <runDir>/heads`; `git rev-parse` per task and wave slot), and the
contended dispatch appends `headsSlotsLine(merged, waveIdx + 1)` exactly as
the merge dispatch does — the completeness critic treats a missing slot as
an ancestry miss and forces the run BLOCKED, so a contended prompt without
this sentence would block every contended run. **The contended branch's
`catch` routes to fallback** (the git-merge path), never into the reconcile
loop — a thrown contended dispatch has no fold log to reconcile against.

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
   branch unmoved — and the git sequence is spelled out because this text
   becomes an LLM-executed prompt, where an invalid invocation is a blocked
   wave.** The merge agent populates the worktree with the candidate's tree
   via `git read-tree -u --reset <candidate>^{tree}` (bare `read-tree -u`
   is a fatal git error) — `HEAD` and the branch ref stay at the previous
   head — runs the project suite (the same `testInstruction` duty the merge
   contract already carries), and on green adopts via
   `git reset --hard <candidate>` (a no-op on the already-matching tree;
   `merge --ff-only` would refuse over the read-tree index) and writes the
   `heads/` slots — replying `MERGED` + `headSha` so the existing call-site
   handling (`waveBaseSha`, review base) is unchanged. On red — the most
   likely fallback trigger: a resolution that folds clean but is
   semantically wrong, exactly the path the adjudication's E2 caveat named
   as unexercised — the agent **restores the worktree**
   (`git reset --hard <prevHead>` **and** `git clean -fd`, bounded to what
   the suite checkout wrote) and the wave falls back. The restore matters:
   both fallback prompts begin by verifying they are on the integration
   branch and refuse to operate otherwise, so a dirty or detached worktree
   would turn fallback into BLOCKED.

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
(§5)**. Every fallback is recorded where the engine already records failure
routing — `judgmentCalls` and the wave-merge result — there is no separate
fallback event type in the fold log (§4).

Task failure and review handling are unchanged: only mergeable results fold,
exactly as only mergeable results merge today.

### 4. Fold log schema (first-class contract)

One JSONL file per contended wave
(`<runDir>/frontier/wave-<n>/fold_log.jsonl`), self-sufficient for
rehydration given the repo (§2), **three** event types:

- `base {sha}` — first line, the wave base.
- `fold {task, headSha}` — the touched set is *derived* by re-folding from
  `headSha` at rehydration, never stored (a stored copy of a derivable fact
  invites undetectable divergence).
- `resolve {path, epoch, lines}` — the lines themselves; rehydration
  consumes them.

Conflicts and parks live in the **conflicts index** (§2); fallbacks live in
the engine's existing failure records (§3) — one fact, one record, in each
case. `report.json` gains a `frontier` section per contended wave: fold-log
path, conflicts index, self-check results, **fold-CLI wall time** (its own
line, so the first real-repo reading is not buried inside a passing E1′),
resolver transcripts verbatim (the E2 grading surface). Schema documented in
`kernel/FOLD_LOG.md` and mirrored in `references/report-format.md` — with a
**named new pin**, because the existing `test_report_runbook.py` is two
literal-token checks and has no general section cross-check to inherit: the
plan adds an assertion that every field the `frontier` section emits in
`waves.js` appears in `report-format.md`'s section documentation (the same
shape as the existing `reviewVerdict` literals check).

### 5. Authoring: ultraplan relaxation, canary, and shakedown

**This entire section ships only on the A/B pass branch (§6).**

`ultraplan/SKILL.md` stops steering authors away from same-file edits: the
three watch-item contortions (unnatural splits, chains-for-fans, Depends-on
for overlap alone) become explicitly wrong; `Files:` blocks remain required
(they are the compiler's detection input). The execution-handoff rubric's
same-file clause changes in both mirrors — whose current spellings
**differ** (`hooks/session_start.sh`: "after treating same-file edits as
dependencies"; `ultraplan/SKILL.md`: "after treating same-file `Modify`
pairs as dependencies") — so the new wording is fixed here, once, for both:
**"after treating same-file edits between tasks the compiler will not fold
as dependencies."** `tests/test_recommendation_rubric.py` does not currently
pin this clause at all; the plan **adds** it to `BRANCH_CLAUSES` (both
mirrors then carry it verbatim), rather than inheriting a pin that does not
exist.

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
- **Hard gates — not overrulable:** **arm identity verified from the
  receipt's existing `compile` object** — arm A shows zero `contended`
  entries, arm B shows ≥2 on this fixture; `ab_runner` asserts the match
  before counting the cell (the arm assignment rides an LLM-transcribed
  launch prompt; a dropped flag would silently collapse both arms to
  canonical and read E1′ ≈ 1.0×; a mismatch is an invalid interval,
  superseded via `--rerun-of`); both arms' gates green; arm B fold-log
  self-checks clean (sampled raw orders outcome-identical, replay match);
  **zero fallbacks on contended waves in arm B**; zero silent divergence;
  every park named in the conflicts index.
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
- Any hard-gate red, or E1′/E2′ miss without a recorded overrule → **the
  whole coupled increment ships dark**: the compile switch defaults to
  `--serialize-overlaps` **and §5 does not ship** (no authoring relaxation,
  no rubric change — shipping the unmeasured half alone would compile
  relaxed plans into pairwise chains and widen routing for a capability the
  A/B just declined). The result is recorded. Pass → release with the
  canonical default and §5.

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

- **pytest:** edge-drop at construction with the exact tagging rule (only
  new-edge, pre-filter-passing pairs drop and tag; a pair already
  serialized by a marker edge is neither dropped nor tagged;
  ambiguous/catch-all tasks still serialize against drop-affected peers;
  promoted-interface pairs stay serialized and untagged; the
  reachability-direction flip for ineligible pairs behind dropped chains is
  exercised and its direction pinned; the pre-filter keys on
  `writes ∪ reads`, counts lines via kernel `split_lines` with the
  exact-cap boundary pinned, and records keeps via `marker_conflicts`
  `inference`; `--serialize-overlaps` reproduces today's compile
  byte-identically), the flatten deletion with the full-iteration labeling
  predicate pinned on **four** shapes (§1b), per-task contended tagging
  (wave-contended iff ≥2 tasks with *intersecting* overlap paths — two
  tags from disjoint pairs do not route; `redirect_args.py` strips the tag,
  round-trip yields no fold routing), fold CLI (rehydration across ≥3
  process boundaries asserting epoch and touched-path equality — including
  a recorded resolve applied unconditionally, never validity-rechecked —
  `rehydrate(repo, log)` signature, task-index fold order, epoch validity,
  both narration shapes, the union-then-fold snapshot-scoping contract — a
  base-existing path touched by only one task folds as a modify, never
  add/add — fresh-log refusal on a pre-existing wave log, self-checks, log
  replay, park reasons in the conflicts index), line-convention bijection
  (no-final-newline file materializes byte-identical; `join_lines([""])`
  yields the empty file; `[]` rejected), materialization (temporary-index
  route: touched-set application, deletions reach the tree, untouched
  executable/symlink keep mode and link; **mode observation via
  `ls-tree`**: a task's chmod on a folded path parks rather than silently
  reverting, a task-created executable keeps its creator's `100755`, two
  creators with differing modes park; non-regular folded path → named
  fallback; **discarded candidate: integration ref unchanged and
  `git status --porcelain` empty afterward**), and the eval re-point
  (`test_frontier_run_eval.py` asserts the contend fixture under **both**
  compiles — pre-drop edges under the switch, `contended` tags
  canonically).
- **Harness sim:** `tests/frontier_merge.mjs` drives the contended path in
  `waves.js` with stubbed agents — clean fold, conflict→resolve,
  stale→re-narrate (markerless shape), park→fallback, budget exhaustion
  mid-loop, thrown-dispatch→fallback, candidate-suite-failure→fallback —
  asserts the contended dispatch text **contains the `heads/` slot names for
  every merged task id**, and prints the `ALL SCENARIOS PASSED` sentinel
  (the suite-gate runs it on any harness JS change; a harness change with no
  covering sim fails the gate by design).
- **Prompt pins:** `test_no_prompt_drift.py`'s hardcoded `WAVE_PROMPTS` list
  is replaced by **deriving the list from `wave-merge.md`'s BAKE blocks** —
  today a new block with a forgotten list entry ships silently unpinned,
  which is exactly how this increment's two new prompts could escape; the
  derivation deletes that failure mode (`simplification`). The rubric's
  same-file clause is **added** to `BRANCH_CLAUSES` with the reconciled
  wording (§5). The `frontier` report section gets its named
  `test_report_runbook.py` assertion (§4).
- **Fixture seal:** `contend-prod` sealed and added to `FIXTURES`.

## Release

Minor bump (architectural): both manifests to the same version, standard
release commit. The verification periphery is untouched; the compiler emits
no new diagnostic vocabulary (kept-pairs ride the existing `marker_conflicts`
`inference` kind). On an A/B miss, the release ships the engine capability
dark and none of §5 (§6).

## Trim review

Author's disclosure — **Adds:** kernel module (promoted, not new code), fold
CLI + three-event fold log (rehydration entry point, bijective line
convention, scoped snapshots, temporary-index materialization with observed
modes), contended contract of the existing merge-agent role at mostCapable
(`FOLD_SCHEMA`, `CONTENDED_MERGE_PROMPT` + resolver BAKE blocks in
`wave-merge.md`, `heads/` slot sentence, spelled-out candidate adoption
sequence), ambient-tier resolver-as-agent loop (budget-checkpointed),
compiler construction-time edge-drop with exact tagging rule + pre-filter +
per-task `contended` tag behind one plumbed switch, `contend-prod` fixture
(sealed, `FIXTURES` entry), one `.mjs` sim, §5 authoring/rubric changes +
canary (pass-branch only), receipt-derived arm-identity gate. **Removes:**
the `write-after-write` serialization default, the dead `fully_overlapping`
flatten line, `frontier_fold._visible`, the `paths` field and
`park`/`conflict`/`fallback` event types from the log (conflicts index and
engine records hold them), the hardcoded `WAVE_PROMPTS` list (derived),
`evals/frontier/` as the kernel's home, and — at authoring time — the three
documented same-file contortions.

### Round 1 (fresh-context reviewer; grade: `netConceptDelta` **up** — "nine adds against three removes; nothing makes an existing defect class inexpressible")

Fourteen findings; adopt-or-answer:

1. **Hash-only `resolve` events cannot replay** — ADOPTED. `resolve` carries
   `lines`; hash deleted; the log is self-sufficient (§4).
2. **Cross-process kernel state unspecified** — ADOPTED. Rehydration rule
   defined; pinned by a process-boundary test (§2). *(Rounds 2, 4, 5
   refined: named entry point, epoch-clock reconstruction, no validity
   re-check, `rehydrate(repo, log)` signature.)*
3. **Structured payloads through agent replies (#36)** — ADOPTED. All CLI
   I/O file-based; agents relay scalars; resolver reads its narration file
   itself (§2, §3).
4. **Whole-tree materialization destroys modes/symlinks/gitlinks** —
   ADOPTED. *(Refined through rounds 2–5 into the temporary-index route
   with observed modes.)*
5. **Python < 3.12 guard guards nothing** — ADOPTED, deleted.
6. **Guards duplicate `dispatchable()`; 400 re-typed** — ADOPTED. One
   pre-filter importing `RESOLVER_LINE_CAP`; runtime predicate
   authoritative (§1).
7. **Post-hoc edge filtering breaks later compiler tiers** — ADOPTED. Drop
   at construction; pinned (§1).
8. **`write-after-write` label ≠ "both write"** — ADOPTED. Final spelling:
   the code's `writes ∪ reads`, stated once (§1).
9. **Fold conductor duplicates the merge agent** — ADOPTED. One role, two
   contracts (§3).
10. **Fallback is a new failure mode** — ADOPTED. Cost stated;
    contended-wave fallback rate a hard gate and canary (§3, §5, §6).
11. **Relaxation is an unmeasured rigor trade without a canary** — ADOPTED
    in mechanism (canary + reversal trigger, §5); deferral
    ANSWERED-REJECTED (operator coupling decision). *(Round 5 conditioned
    §5 on the pass branch, which supersedes the standalone-shipping
    concern.)*
12. **A/B under-specified** — ADOPTED. Seal, length floors, n=1 + rerun
    policy, numeric bars (§6).
13. **Kernel promotion leaves eval dependencies undefined** — ADOPTED. Full
    enumeration (§Where it lives). *(Rounds 3–5 refined: live `SKILL.md`
    reference, `--serialize-overlaps` eval compiles, octopus exclusion.)*
14. **Founding-architecture cut; "ledger" collision** — ADOPTED (rename);
    PARTIALLY ADOPTED (three-line note kept on operator direction).

### Round 2 (fresh-context reviewer; grade **up**; 1 blocker + 11 findings)

1. **BLOCKER — sequential degrade nullifies the increment** — ADOPTED.
   *(Rounds 3–5 refined the fix: dead-flatten deletion, labeling predicate
   as code, then the full-iteration form.)*
2. **Deletions resurrected by manifest-keyed materialization** — ADOPTED
   (touched-set keying, §2).
3. **`replay()` epoch desync** — ADOPTED (`rehydrate`, §2).
4. **Fallback dead after materialize; wave test homeless** — ADOPTED
   (candidate ordering, §2–3; rounds 3–5 supplied mechanics).
5. **Kernel would import eval-only code** — ADOPTED (§Where it lives).
6. **Pre-filter missed shared `Test:` paths** — ADOPTED (§1).
7. **`MERGE_SCHEMA` can't carry contended replies** — ADOPTED
   (`FOLD_SCHEMA`, §3).
8. **No resolver budget checkpoint; tier unnamed** — ADOPTED (§3; tier
   final: ambient, round 4 trim).
9. **Modes unrepresented** — ADOPTED (§2; round 5 made modes observed).
10. **Re-narration is markerless** — ADOPTED (§2, §3).
11. **`test_fixture_seals.py` requires nothing of unlisted fixtures** —
    ADOPTED (§6).
12. **BAKE mechanics; CLI location** — ADOPTED (§3). *(Round 3 corrected
    the stated reason; round 5 replaced the hardcoded pin list with
    derivation.)*

Trims: one switch — ADOPTED; shakedown into §5 — ADOPTED; founding note —
ANSWERED-KEPT; diagnostic-vocabulary circularity — ADOPTED (existing
`inference` kind).

### Round 3 (fresh-context reviewer; grade **up**; 2 blockers + 1 structural + 10 findings)

1. **BLOCKER — tag rode the launch file (#89)** — ADOPTED (args channel).
   *(Round 4 corrected the shape to per-task inline.)*
2. **STRUCTURAL — flatten is dead code; delete it** — ADOPTED (§1b).
   *(Rounds 4–5 fixed the labeling predicate twice; final form iterates all
   pairs.)*
3. **BLOCKER — contended prompt needs the `heads/` slot sentence** —
   ADOPTED (§3).
4. **Candidate had no home; fallback couldn't bind** — ADOPTED (§2–3;
   round 5 fixed the git invocations).
5. **Final-newline normalization; self-checks blind** — ADOPTED (bijection,
   §2).
6. **Resolver prompt invisible to the wave pin from a third file** —
   ADOPTED (block in `wave-merge.md`).
7. **False constraint stated for the separate block** — ADOPTED (real
   reason stated).
8. **Whole-tree snapshot cost unpriced** — ADOPTED (scoped snapshots;
   wall-time report line).
9. **Completion order unobservable** — ADOPTED (task-index order).
10. **Three overlap-set spellings** — ADOPTED (one spelling).
11. **Switch had no plumbing** — ADOPTED (launch argument → `ultra_run.py`).
12. **`validate_skill` extension inert** — ADOPTED (live `SKILL.md`
    reference).
13. **Resolver-tier justification misstated the cell** — ADOPTED
    (superseded by round 4's ambient-tier trim).

Scope narrowing: hard gates non-overrulable — ADOPTED (§6).

### Round 4 (fresh-context reviewer; grade **up**; 2 blockers + 8 findings + 3 trims)

1. **BLOCKER — positional `contendedWaves` breaks on redirect relaunch
   (#131 class)** — ADOPTED (per-task inline tag). *(Round 5 tightened:
   intersection rule, redirect stripping.)*
2. **BLOCKER — canonical default breaks `test_frontier_run_eval.py` and
   zeroes `same_file_edges` circularly** — ADOPTED (eval entry points
   compile with the switch). *(Round 5 added the both-compiles fixture
   assertion.)*
3. **Labeling recomputation broke byte-identity on a third shape** —
   ADOPTED. *(Round 5 showed the round-4 form still broke it; final form in
   §1b.)*
4. **Contended merge tier unspecified; no `catch` behavior** — ADOPTED
   (mostCapable; catch→fallback, §3).
5. **§2/§3 contradicted on candidate construction** — ADOPTED
   (temporary-index route, §2).
6. **Scoped snapshots need union-then-fold ordering** — ADOPTED (§2).
7. **Bijection needed function pair, `[""]`, `_visible` deletion, E2
   bound** — ADOPTED (§2, §6).
8. **`rehydrate` must not re-check validity** — ADOPTED (§2).
9. **Arm identity unverified** — ADOPTED as a hard gate (§6). *(Round 5's
   T1 re-based it on the existing receipt `compile` object.)*
10. **Surface omissions: `dependency-analysis.md`, `SKILL.md`,
    `report-format.md`** — ADOPTED (§Where it lives, §1b, §4).

Trims: delete `paths` from `fold` — ADOPTED; merge `park` into the
conflicts index — ADOPTED; ambient-tier resolver for the A/B — ADOPTED
(supersedes round 3's mostCapable pin).

### Round 5 (fresh-context reviewer; grade: `netConceptDelta` **up**; found 2 blockers + 11 findings + 4 trims; loop explicitly not ended)

Thirteen findings + four trims; adopt-or-answer:

1. **BLOCKER — the round-4 kept-pairs labeling predicate flips ordinary
   plans to `sequential` in both modes** (restricting the iteration deletes
   the `False` terms disjoint pairs contribute; the alternative reading is
   vacuously `True` on the shared-`Test:` shape; both demonstrated on
   today's compiler) — ADOPTED. Final predicate iterates **all** ordered
   pairs with dropped pairs contributing `False`; reduces literally to
   today's under the switch; pin set grown to four shapes (§1b).
2. **BLOCKER — the dark-mode branch shipped the unmeasured §5 alone**
   (relaxed plans would compile into pairwise chains; the rubric change
   reaches every session and widens routing toward a declined capability) —
   ADOPTED. §5 ships only on the pass branch; stated in §Background, §5,
   §6, §Release.
3. **≥2 tags route genuinely non-contended waves** (tags from different
   dropped pairs need not overlap) — ADOPTED. Wave contended iff ≥2 tasks'
   overlap paths **intersect** (§1).
4. **"Dropped pair" was ambiguous at the tier-3 loop** (pairs already
   serialized by marker edges have no edge to drop and must not be tagged;
   plus the reachability-direction flip through dropped chains) — ADOPTED.
   Exact tagging rule stated; direction flip disclosed and pinned (§1a).
5. **`git read-tree -u` is a fatal error as written; `merge --ff-only`
   refuses over the read-tree index** — ADOPTED. Spelled-out sequence:
   `read-tree -u --reset <candidate>^{tree}`, adopt via
   `reset --hard <candidate>` (§3.3).
6. **Mode rules had no detector** (`--name-status` reports chmod as `M`
   with identical blobs; created paths have no base mode) — ADOPTED. Modes
   observed via `ls-tree` at task heads; chmod parks; created paths take
   the creator's mode; differing creators park; both pinned (§2, §Testing).
7. **`rehydrate(log)` is not a function of the log** — ADOPTED.
   `rehydrate(repo, log)`; git named as input (§2).
8. **The fold log collides across redirect rounds** (nothing `rmtree`s
   `frontier/` the way `heads/` is cleared) — ADOPTED. `fold` refuses a
   pre-existing wave log; defense-in-depth behind the redirect tag
   stripping (§2).
9. **Octopus adoption commits break `run_eval` track (c) and make
   `shadow_fold` manufacture false divergence** (`_group_chain` decomposes
   via `parents[1]` only) — ADOPTED. Contended runs excluded from shadow
   replay by the same named-exclusion rule; the fold log is their
   replacement replay record (§Where it lives).
10. **`test_report_runbook.py` has no general cross-check to inherit** —
    ADOPTED. The new assertion is named and shaped like the existing
    `reviewVerdict` literals check (§4).
11. **`test_recommendation_rubric.py` does not pin the clause, and the two
    mirrors spell it differently today** — ADOPTED. Wording reconciled at
    spec time, one spelling fixed in §5, added to `BRANCH_CLAUSES` as a new
    entry.
12. **`splitlines()` vs the bijection leaves a second counting convention
    at the cap** — ADOPTED. All counting sites go through kernel
    `split_lines`; exact-cap boundary pinned (§1).
13. **The eval re-point weakened the fixture guarantee** — ADOPTED. Both
    compiles asserted (§Where it lives, §Testing); the track-(a) label
    consequence stated in one sentence.

Trims: **T1 — delete the new receipt field** (the receipt already embeds
the full compile object; arm identity derives from `contended` entries) —
ADOPTED (§Where it lives, §6). **T2 — derive `WAVE_PROMPTS` from
`wave-merge.md`'s blocks** (deletes the silently-unpinned-new-block failure
mode; `simplification`) — ADOPTED (§Testing). **T3 — delete the `fallback`
event type** (inert for rehydration; engine records already hold it — the
same one-fact-one-record argument as `park`) — ADOPTED; the log is three
event types (§3, §4). **T4 — make redirect-round contention inexpressible**
(`redirect_args.py` strips the tag; deletes the "unless" clause and the
stale-overlap hazard) — ADOPTED (§Non-goals, §1).

Scope items put explicitly before the operator, per the reviewer: (2) §5's
coupling is now symmetric — pass-branch only (finding 2 resolved it); (3)
the bijective line convention is a **kernel-wide** behavior change riding a
frontier-gated increment — now stated as scope in §2, with the §6 honesty
bound; the operator adjudicates it at spec review rather than discovering it
at plan review.
