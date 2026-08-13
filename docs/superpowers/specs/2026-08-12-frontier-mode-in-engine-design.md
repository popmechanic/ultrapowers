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
engine capability and the authoring relaxation are **coupled**, an operator
decision recorded at brainstorm time: without the relaxation no production
plan can ever exercise the mode. The coupling is sequenced, not simultaneous
(§5): **this plan builds and ships the engine capability dark** (default
`--overlap serialize`); the authoring relaxation, the rubric change, and the
default flip land as a **separate follow-up commit only after a passing A/B
verdict**, followed by the shakedown, then the release. A missed verdict has
nothing to revert — the unmeasured half was never on the branch. The
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
- Kernel periphery expansion: binaries, symlinks, gitlinks, files over the
  resolver cap, renames. Guards route these to the existing path; they are
  not new capability. (Modes are carried, not expanded: base modes preserved,
  created files take their creator's mode, mode *changes* park — §2.)
- Frontier folding for non-contended waves (they keep the git-merge path) and
  for **any resume-lane wave**: the contention rule (§1) carries `!resume` as
  a conjunct, so redirect, salvage, and any future resume lane can never
  fold — there is no tag to strip because there is no tag (§1).
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
evals import when measuring the engine), `shadow_fold.py`, `run_eval.py` —
all three in `evals/frontier/` — and `evals/run_frontier_cell.py` (one
level up; imports re-pointed). **Because the fold-mode compile
no longer emits the dropped edges, the modeling/probe entry points
(`run_eval.compile_fixture`, `shadow_fold._remodel` — shadow's only
compiler shell-out — and `run_frontier_cell`) compile with
`--overlap serialize` to obtain the pre-drop edge set their
`same_file_edges` recovery metric is defined over — otherwise the eval line's
own denominator reads 0 circularly.** Consequences stated plainly: track
(a)'s recorded `mode`/`degrade_reason` are the serialize labels, and the eval
line permanently measures the compile mode that is no longer the engine's
default once the follow-up flips it. `test_frontier_run_eval.py`'s contend
assertions run under **both** compiles — serialize: ≥2 `write-after-write`
edges, `mode: parallel`; fold: ≥2 tasks sharing a wave with intersecting
`files` — so the fixture guarantee covers the compile the engine actually
runs. ### Contended runs and the shadow line — a two-leg probe

New code, each leg placed where it can actually fire. A contended wave's
adoption commit has 1+N parents (§2).

- **Per-wave leg:** a parent-count probe on each merged wave head in
  `shadow_fold._build_waves`, applied **before** the group / trailing /
  absorbed dispatch — placement matters: the floor scan recognises only
  2-parent merges, so an unprobed octopus wave followed by an ordinary
  merge would be silently mislabeled `"absorbed"`. The probed wave gets the
  **existing per-wave `disposition: "excluded"` row** with an octopus
  reason; non-contended waves in the same run still shadow.
- **Whole-run leg — in `_shadow`'s existing no-floor branch (the arm that
  already assigns the exclusion name), keyed on ANY merged wave head
  having ≥3 parents:** whenever that branch is reached — the floor scan
  finding no 2-parent merge, or the root-commit path where no bound
  exists — `_build_waves` is never called and a probe living only there
  cannot fire. That happens not only for the all-contended run but for the
  **modal shakedown shape** — one contended wave plus fast-forwarded
  single-task waves (merge commits are not forced `--no-ff`, so
  single-task waves routinely fast-forward): there, *no* head has 2
  parents yet not *every* head is an octopus, so an every-head predicate
  would miss it and the run would keep the wrong whole-run name
  (`no per-task merges`). Any-head ≥3 parents → the octopus reason; no
  head ≥3 parents → the genuinely merge-free run keeps its existing name
  unchanged.

(`run_eval._group_chain`'s silent `parents[1]`-only decomposition of
≥2-parent commits is the false-divergence path the per-wave leg
forecloses.) One second-order consequence, named so it is not read as a
harvest bug: in a mixed run with an ordinary merge above the contended
wave, the floor floats above it, so the contended wave's task durations
drop out of the shadow harvest as at/below-floor. For the excluded wave
itself, the fold log is the replacement replay record (strictly stronger:
it replays resolutions too). **A third octopus surface exists and needs no
code change, only this disclosure:** archived-run recovery
(`run_eval._chain_defect` / `extract_archived_runs`) already excludes any
run whose chain carries a >2-parent commit, whole, by name — so after the
§5 default flip, K3-style archived-run coverage for contended runs shifts
to the shadow line and the fold log; it fails loudly by name today, never
silently, and restoring octopus-chain recovery would be a separate
increment.

New: `skills/ultrapowers/kernel/fold_wave.py` (CLI) and `kernel/FOLD_LOG.md`
(schema — referenced from `ultrapowers/SKILL.md`'s engine section, which
makes `validate_skill.py`'s link-check live for it once the check's regex
extends to `kernel/`; without a `SKILL.md` mention the extension would
validate nothing). `evals/fixtures/contend-prod/`. **One compile knob,
`--overlap {serialize,fold}`** on `compile_plan.py`, defaulting to a named
constant that ships `serialize` in this plan and flips to `fold` only in the
pass-branch follow-up (§5): `ultra_run.py` forwards a `/ultrapowers` launch
argument onto the compile argv, and also stamps **`--repo-root`** (from its
existing repo root) — the pre-filter needs a root to probe paths against,
and `compile_plan.py` today has neither a root argument nor any filesystem
access beyond the plan file (§1 states the hermeticity consequences).
**`evals/ab_runner.py` is a named build surface:** an arm flag threaded into
`DRIVE_PROMPT` and `build_run_plan` (today arms differ only by engine ref;
this A/B runs one ref, so the launch flag is the only arm difference), the
receipt-derived arm-identity assertion (§6), a row field recording the arm,
and the rule that an identity-failed run still **appends its row marked
invalid** — `--rerun-of` supersedes by the prior row's `startedAt`, so a
dropped row would leave it nothing to point at.

Documentation surfaces that are live seams, updated with the code they
mirror: `references/dependency-analysis.md` — the degrade behavior and
`degrade_reason` wording (§1b), the Step-3 transparency fields, **and its
two unconditional statements of the serialization rule** (rule 3 "never
safe; serialize in document order" and the reads bullet), which this plan
makes conditional: one sentence each that under `--overlap fold` an eligible
same-file pair is scheduled concurrently and folded, runtime predicate
authoritative. `ultrapowers/SKILL.md` (Step 1's `ultra_run.py` invocation —
the launch argument's operator-facing home — and Step 3's mode/degrade
rendering). `references/report-format.md` (the new `frontier` report
section, §4).

## Components

### 1. Compiler: the edge-drop rule

Two changes plus one deletion, behind one knob. `--overlap serialize` (the
shipped default in this plan) reproduces today's output byte-identically;
`--overlap fold` (the canonical mode, default only after the pass-branch
follow-up) applies the rules below.

One vocabulary note used throughout: the compiler's overlap set for the
`write-after-write` tier is **`writes ∪ reads`** on both sides
(`writes = Create: ∪ Modify:`; `reads` is populated by `Test:` entries — a
`Test:` path parses into `reads`, and the compiler serializes on it by design
because under upstream TDD semantics each task *writes* the failing test).
Every **edge** rule below uses exactly this set; the one deliberate
exception is §1b's labeling predicate, which keeps today's narrower
writes-only intersection because byte-identity with today's label is the
claim. The overlap set is also exactly what the compiler already emits per
task as the inline `files` entry (`creates ∪ modifies ∪ reads`) — which is
why no new compiler field is needed below.

**(a) The drop.** Fold-mode compile does not create `write-after-write`
edges for eligible pairs. The drop happens **at construction** — the tier-3
loop skips the edge — never by post-hoc filtering: later tiers
(`ambiguous-files`, catch-all) consult reachability through the accumulated
adjacency, so an edge removed after the fact would leave those tasks
unordered against peers they must still serialize behind. A pair is
**dropped** (recorded in `dropped_pairs`, both orderings) only when the
tier-3 loop *would have created a new edge for it*: forward document order,
`(a, b)` not already in `seen` — which also covers pairs the interface tier
ordered first: an `interface` edge puts the pair in `seen`, so it is neither
dropped nor freed, like any pair with a pre-existing edge (there is no
"promotion" mechanism; the interface tier runs before tier 3 and never sees
a `write-after-write` edge) — `not would_cycle(a, b)`, **and** the pair
passes the eligibility pre-filter below. A test pins that an
ambiguous/catch-all task still serializes in a plan where a
`write-after-write` edge was dropped. One disclosed behavioral difference:
dropping edges shrinks the adjacency later `would_cycle` calls read, so an
*ineligible* pair whose forward edge is blocked today only by reachability
through now-dropped edges acquires the forward edge in fold mode — the pair
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

`dropped_pairs` is empty under `--overlap serialize`, so the expression
reduces to today's **literally** — byte-identity by construction, not by
argument (round-6 review verified this algebraically and on five compile
shapes, including an adversarial fifth). Pinned on **four** shapes:
all-overlapping-eligible (fold → one contended wave, `parallel`; serialize →
today's `sequential` singletons); all-overlapping-*ineligible* (both →
today's `sequential`); shared-`Test:`-only (both → `parallel`, matching
today); two-overlapping + one-disjoint-task (both → `parallel`, matching
today — the shape the kept-pairs reading breaks).
`references/dependency-analysis.md`'s degrade wording updates with it.
`complexityEffect`: simplification.

**(c) Surviving labels.** All semantic edges survive untouched: `marker`,
`text`, `interface`, `prose-reference`, `write-after-create` (the base to
edit against must exist), `read-after-write`, `ambiguous-files` (unknown
writes cannot be scheduled into contention).

Disclosure: the modeled rule (`schedule_model.SAME_FILE_WHYS`) also dropped
`write-after-create` and `ambiguous-files`. The engine rule is a strict,
deliberately conservative subset. On the contended fixture the two rules
coincide (all three dropped edges were `write-after-write`), so the measured
41% transfers; the A/B re-measures under the engine's own rule regardless.

**Eligibility pre-filter — hermetic, rooted, inert without a root, memoised
per path.** A pair keeps its serializing edge when any path in its overlap
set (`writes ∪ reads`, both sides), resolved against **`--repo-root`** and
existing there, would already fail the kernel's dispatch predicate:
non-text content, over `RESOLVER_LINE_CAP` **counted via the kernel's
`split_lines`** (both imported from the kernel — a Python import, no
subprocess; `splitlines()` disagrees with the bijection by one on every
trailing-newline file, so every counting site — the pre-filter,
`dispatchable()` — counts through the same function, with the exact-cap
boundary pinned), or a symlink (`Path.is_symlink()`). **Eligibility is
computed once per path** (memoised `path -> (ok, reason)`) and consulted per
pair — tier 3 is an O(N²) pair loop, and this file already carries a
measured fix for per-pair recomputation blowup (Fix E); the
`marker_conflicts` `inference` record is emitted **per path**, so the
diagnostic count is deterministic — and because `add_conflict` dedupes on
`(task, edge)` while a path is shared by ≥2 tasks, the per-path record
carries `task: ""` with the path and reason in the edge/note fields (the
`type_conflicts` precedent), so the dedupe key stays unique per path. **The compiler stays subprocess-free**:
gitlink detection needs git and is left to the runtime materialization
guard, which is authoritative anyway. **Without `--repo-root` the
pre-filter is inert and every pair is eligible** — a documented property,
not an accident (the eval entry points compile plan-only and rely on the
runtime predicate), safe because `dispatchable()` and the materialization
rules remain authoritative for everything the pre-filter cannot see: files
tasks create, files that grow past the cap (e.g. two tasks *creating* the
same binary path are freed here and park at runtime — an expected
production fallback source, named in §5's canary). Scope, disclosed: this
is the compiler's first filesystem access beyond the plan file; it remains
stdlib-only and subprocess-free.

**No contended tag — contention is derived, not declared.** The compiler
emits **no new field**: within a wave, two tasks with intersecting `files`
entries *are* a dropped eligible pair, by construction — every overlapping
pair that was not dropped carries an edge (write-after-write, interface,
marker, or a reachability path), and Kahn layering separates edge-connected
tasks into different waves. Under `--overlap serialize` no wave can contain
intersecting `files`, so the rule is inert on the shipped default —
pinned: a serialize compile of the contended fixture yields no wave whose
tasks' `files` intersect. The engine's routing rule (evaluated in
`mergeWave`, the #89-safe channel since `files` already rides the inline
entries and survives every relaunch verbatim):

> a wave takes the contended path iff `!resume` **and** the wave base is
> live — no prior wave reported `MERGED` without a `headSha` — **and** ≥2
> of its **mergeable results** have intersecting `files`.

The middle conjunct reuses a detection the engine already performs: a
schema-legal `MERGED`-without-`headSha` reply freezes `waveBaseSha` while
the integration branch genuinely advances — a tolerated soft failure on
the git-merge path (the next merge reconciles by content), but the
contended path builds its candidate *from* `waveBaseSha`, so a frozen base
would rewind the integration branch over the prior wave's merge and end
the run BLOCKED at the ancestry check, loud but late and expensive.
Routing such a wave to the git-merge path instead costs one boolean —
honestly noting that the route-away inherits §3's stated git-merge-path
cost for colliding branches (a reconcile agent handed work it was not
built for; a wave that can end blocked), still strictly better than a
rewound integration branch. The conjunct is the **whole** guard: it is
sticky across waves, so it also covers a contended wave that itself adopts
and reports without a `headSha`. No schema-level `headSha` requirement
rides the fold or resolve replies — those steps have nothing adopted yet,
and a required field a step cannot supply burns schema retries or invites
a fabricated sha (the production test's own lesson). Wave 1 is never
affected — setup is already hard-gated on a `headSha`.

**The join is explicit, because results do not carry `files`:** every
`runTask` return path emits `{task, status, branch, headSha, …}` and
nothing else, so a literal reading of the rule would find `r.files ===
undefined` and fail **closed** — every contended wave silently taking the
git-merge path while stubbed tests stay green. The rule is evaluated over
the **`WAVES[waveIdx]` task entries of the mergeable results**, joined by
`r.task === t.id` (`WAVES` is module-scope and the engine already reads
per-task `files` exactly this way for the review packet); a lone survivor
drops out by having no partner in the join. `!resume` covers redirect,
salvage, and any future resume lane in one conjunct (no stripping
machinery); *mergeable results* — not declared tasks — because a contended
pair that loses one task to failure or blocking review leaves a lone
survivor with nothing to contend against. Two disclosed costs of deriving
rather than declaring: routing authority moves from compiler-declared to
engine-derived (the pins hold the derivation to the compiler's semantics),
and `files` carries no writes/reads provenance — **a pair overlapping only
on a shared `Test:` path routes contended and folds nothing** (their
`git diff` touched sets are disjoint), paying the fold ceremony for a
trivially clean result: priced overhead, not a fallback source, and a
contended wave with zero conflicts in the §5 canary reads as designed, not
anomalous.

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
- **Line convention becomes a bijection over existing files; `[]` means
  absence.** Today `split_lines` drops one trailing newline and
  `join_lines` re-adds one for non-empty lists, so a folded file with no
  final newline would be silently rewritten — and both self-checks compare
  manifests built through the same normalization, so they are structurally
  blind to it (the cell and every shadow run normalized both sides). The
  new pair, written out: `split_lines(content) = content.split("\n")` and
  `join_lines(lines) = "\n".join(lines)` — a bijection between byte strings
  and line lists **for files that exist**, in which the empty file is
  `[""]`. **`[]` is not in the bijection's range and denotes absence** — it
  is load-bearing today as the deletion mark, the shared empty ancestor for
  concurrent adds, and `manifest()`'s deletion predicate, and it stays
  constructible at exactly those sites; `split_lines` never returns it, and
  the manifest never joins it because absent paths are omitted. The gain,
  now expressible: an emptied-but-present file (`[""]` → `""`) and a
  deleted file (`[]` → omitted) **stop colliding**. This changes
  materialized bytes on one live path today (`join_lines([""])`: `"\n"`
  becomes `""`) and adds a trailing `""` element to the line list of
  **every** trailing-newline file — which is what moves every line count by
  one and why all counting flows through `split_lines` (§1).
  `frontier_fold._visible` is the identity under the bijection everywhere
  except the reserved `[]` point and is **deleted**; the resolver's
  reply-file bytes are split by the kernel's own `split_lines`, so exactly
  one normalization exists on that path. One rationale comment goes stale
  with the change and is updated with it: `_base_text_untouched`'s
  docstring justifies its `deleted_marks` conjunct partly by "an empty base
  file's delete weave equals the base's own state" — under the bijection
  that collision no longer arises; the conjunct stays (it is load-bearing
  for other reasons), the sentence goes. **Scope, stated for the operator:
  this is a kernel-wide behavior change riding a frontier increment** — it
  alters the line list for every kernel caller, and historical eval
  artifacts (shadow runs, the cell's E2 narrations) were produced under the
  old convention; §6 carries the honesty bound. Pinned: a folded text file
  with no final newline materializes **byte-identical**; an emptied file
  materializes as `""`; a deleted path stays omitted from the manifest;
  `split_lines` never yields `[]`. The divergence self-checks compare
  normalized manifests; byte fidelity is this pin's job, not theirs.
- **`fold` subcommand:** given the wave base sha and the mergeable branches
  **in task-index order** (the existing merge contract's order — completion
  order is not observable to the engine, and K1 order-independence is
  exactly what the self-check asserts, so determinism costs nothing and buys
  reproducible conflicts), folds each, appends `fold` events, and writes per
  conflict: the annotated narration to `frontier/wave-<n>/conflict-<i>.txt`
  and its `dispatchable()` verdict — including park reasons for ineligible
  conflicts and kernel-limit parks (recursion on ~1000-line files) — to the
  **conflicts index**, which is the single record of parks. **`fold` refuses
  a pre-existing fold log for its wave** — resume relaunches renumber waves
  into the same run dir (the machinery `rmtree`s `heads/` for exactly this
  staleness class, and nothing else guards `frontier/wave-<n>/`); with the
  `!resume` conjunct in the routing rule (§1) this should never fire, and
  if it does, failing loud beats rehydrating a stale log whose resolutions
  apply unconditionally. The refusal also protects the original round's
  `frontier/` records, which the §5 canary harvests. **Snapshot scoping is
  a stated ordering contract:** first derive every task's touched set
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

For a contended wave (§1's three-conjunct routing rule: `!resume`, live
wave base, ≥2 mergeable results with intersecting `files`), `mergeWave()`
routes its **existing merge agent
role** through the contended contract — one role, two contracts, dispatched
at **`TIER.mostCapable`** for the contended contract (its duties — CLI
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
   The wave base — the `fold` base argument, and `<prevHead>` in the
   adoption and restore sequences below — is **engine-authored into the
   dispatch** by interpolating the module-scope `waveBaseSha` (which
   advances only *after* a merge, so at dispatch time it is exactly the
   previous integration head), the same way `headsSlotsLine` is authored;
   the agent derives nothing.
2. For each dispatchable conflict, `waves.js` first checks
   `budgetExhausted()` — every existing dispatch site is checkpointed, and a
   serial N-conflict loop must be too; exhaustion routes to fallback (still
   live at this point) — then dispatches **one resolver agent at a time**
   at the session-ambient model: concretely, an `agent()` call whose
   options are `{ label, schema }` with the `model` key **omitted**. That
   call shape is exercised nowhere in `waves.js` today (every existing
   dispatch passes an explicit `model`; the file's verified-live note
   covers accepted model *strings*, not omission), so the build task
   **live-verifies it** the way that note was earned, and the sim asserts
   the resolver dispatch's options shape — a wrong guess would throw,
   route to fallback, and redden §6's non-overrulable zero-fallback gate
   at the cost of a full production-length cell. **Fallback decision,
   made now:** if omission is rejected, the resolver dispatches at
   `TIER.standard` and the like-for-like sentence in §6's E2′ bullet is
   **removed** while a named resolver-model confound is **added** to §6's
   honesty-bounds paragraph (remove-here / add-there, resolved at build
   time before any counted cell). Rationale for ambient:
   like-for-like with the E2 the operator graded (the cell's resolver ran
   on its CLI default, no `--model` — noting honestly that CLI default
   and workflow `agent()` default are two runtimes' defaults, which the
   live verification also pins down); tier escalation is a post-A/B knob,
   not a launch-time confound. The
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
   as unexercised — the agent **restores the worktree**:
   `git reset --hard <prevHead>`, then `git clean -fd` (repo-wide over
   untracked non-ignored files by nature — since the read-tree writes no
   untracked paths, its only real targets are suite residue) — and the wave
   falls back. The restore matters: both fallback prompts begin by
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
resolver transcripts verbatim (the E2 grading surface). The on-disk
`frontier/` directory is the durable record across resume rounds (§2's
fresh-log refusal protects it; a resume round's report carries no `frontier`
section of its own, so the §5 canary harvests the directory, not the report
alone). Schema documented in `kernel/FOLD_LOG.md` and mirrored in
`references/report-format.md` — with a **named new pin**, because the
existing `test_report_runbook.py` is two literal-token checks and has no
general section cross-check to inherit: the plan adds an assertion that
every field the `frontier` section emits in `waves.js` appears in
`report-format.md`'s section documentation (the same shape as the existing
`reviewVerdict` literals check).

### 5. Authoring relaxation — the pass-branch follow-up (not in this plan)

**None of this section is built by this plan.** It is specified here so the
follow-up is mechanical, and it lands as a single follow-up commit **only
after the A/B verdict passes (§6)**, in this order: flip the `--overlap`
default constant to `fold`; apply the authoring and rubric changes below;
run the shakedown; release. A missed verdict leaves nothing to revert.

`ultraplan/SKILL.md` stops steering authors away from same-file edits: the
three watch-item contortions (unnatural splits, chains-for-fans, Depends-on
for overlap alone) become explicitly wrong; `Files:` blocks remain required
(they are the compiler's detection input). The execution-handoff rubric's
same-file clause changes in both mirrors — whose current spellings differ in
words **and markup** (`hooks/session_start.sh` is plain text;
`ultraplan/SKILL.md` uses emphasis and backticks) — so the new wording is
fixed here, once, as **plain unstyled text, byte-identical in both legs**
(the rubric pin asserts raw substring containment with no normalization):
"after treating same-file edits between tasks the compiler will not fold as
dependencies". `tests/test_recommendation_rubric.py` does not currently pin
this clause at all; the follow-up **adds** it to `BRANCH_CLAUSES`.

The relaxation is the unmeasured rigor trade, so it carries a **canary** per
house doctrine: at `engineVersion ≥` the adopting release, ultralearn sense
passes track (a) fallback rate per contended wave and (b) redirect-round
rate on plans with contended waves vs. the portfolio baseline — harvested
from the run dirs' `frontier/` directories (§4). **Expected fallback sources
are named up front** so their first occurrence reads as the priced cost, not
a regression: concurrently-created binary paths, runtime over-cap growth,
and semantic suite failures at candidate time. First persistence of
*elevated* rates flags the relaxation possibly-failed; second persistence
makes drafting the reversal (restore `serialize` as the default, keep the
engine capability guarded) mandatory distill output. Adoption of any
reversal stays operator-gated.

**The canary's first reading is the shakedown:** one real backlog plan
authored under the relaxed rule runs `/ultrapowers` end-to-end after the
follow-up lands, and its `frontier` records — including the fold-CLI
wall-time line — are operator-reviewed before the release ships. Evidence,
not a gate.

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
review on, gate on — via `ab_runner.py` (arm flag threaded per §Where it
lives). Arm A launches with `--overlap serialize`, arm B with
`--overlap fold` — both explicit, neither relying on the default. The only
variable is the serialization rule. Output tokens harvested identically both
arms (`_usage_output_tokens`); wall clock end-to-end.

**Pre-registered decision rule (fixed before building):**

- **n = 1 pair**, arms sequential on one machine, same engine ref. A run
  that dies before producing a gate verdict — **or whose receipt fails the
  arm-identity check below** — is an invalid interval, superseded via
  `--rerun-of` (the OAuth precedent; the invalid row is still appended,
  marked invalid, so `--rerun-of` has a row to supersede); a run that
  produces a verdict and passes arm identity is never re-rolled.
- **Hard gates — not overrulable:** **arm identity verified from
  `receipt.json`'s existing `compile` object, on the mechanism under
  test** — arm A shows ≥2 `dag_edges` with `why: "write-after-write"` on
  this fixture; arm B shows zero such edges and ≥2 tasks sharing a wave
  with intersecting `files`; `ab_runner` asserts the match before counting
  the cell (the arm assignment rides an LLM-transcribed launch prompt; a
  dropped flag would silently collapse the arms and read E1′ ≈ 1.0×); both
  arms' gates green; arm B fold-log self-checks clean (sampled raw orders
  outcome-identical, replay match); **zero fallbacks on contended waves in
  arm B**; **every contended-shaped wave in arm B actually took the fold
  path — no route-away** (frozen base, lone survivor): a route-away is not
  a "fallback" in the spec's vocabulary and the compiler-side arm-identity
  check cannot see it, so without this clause a partly-serialized arm B
  could read green against arm A; zero silent divergence; every park named
  in the conflicts index.
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
- Any hard-gate red, or E1′/E2′ miss without a recorded overrule → **ship
  what the branch already is**: engine capability dark (default
  `--overlap serialize`), no §5 follow-up, result recorded. Pass → the §5
  follow-up (default flip + relaxation + rubric), shakedown, release.

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
— and after adoption the route is redirect, as today. An
`--overlap serialize` compile is byte-identical to today's. The engine never
claims a fold succeeded without the live self-checks; replay divergence is a
fallback, not a warning.

## Testing

- **pytest:** edge-drop at construction with the exact drop rule (only
  new-edge, pre-filter-passing pairs drop; a pair already serialized by a
  marker or interface edge is neither dropped nor freed; ambiguous/catch-all
  tasks still serialize against drop-affected peers; the
  reachability-direction flip for ineligible pairs behind dropped chains is
  exercised and its direction pinned; the pre-filter keys on
  `writes ∪ reads` resolved against `--repo-root`, is memoised per path
  with per-path `inference` records, counts lines via kernel `split_lines`
  with the exact-cap boundary pinned, and is **inert without the root**;
  `--overlap serialize` reproduces today's compile byte-identically), the
  flatten deletion with the full-iteration labeling predicate pinned on
  **four** shapes (§1b), derived contention (a serialize compile of the
  contended fixture yields **no wave with intersecting `files`**; a fold
  compile yields one; routing fires only on ≥2 **mergeable results** with
  intersecting `files` — two tasks from disjoint dropped pairs sharing a
  wave do not route, a lone survivor of a contended pair does not route,
  and any `resume: true` launch never routes), fold CLI (rehydration across
  ≥3 process boundaries asserting epoch and touched-path equality —
  including a recorded resolve applied unconditionally, never
  validity-rechecked — `rehydrate(repo, log)` signature, task-index fold
  order, epoch validity, both narration shapes, the union-then-fold
  snapshot-scoping contract — a base-existing path touched by only one task
  folds as a modify, never add/add — fresh-log refusal on a pre-existing
  wave log, self-checks, log replay, park reasons in the conflicts index),
  line-convention bijection (no-final-newline file materializes
  byte-identical; an emptied file materializes as `""`; a deleted path
  stays omitted from the manifest; `split_lines` never yields `[]`),
  materialization (temporary-index route: touched-set application,
  deletions reach the tree, untouched executable/symlink keep mode and
  link; **mode observation via `ls-tree`**: a task's chmod on a folded path
  parks rather than silently reverting, a task-created executable keeps its
  creator's `100755`, two creators with differing modes park; non-regular
  folded path → named fallback; **discarded candidate: integration ref
  unchanged and `git status --porcelain` empty afterward**), the eval
  re-point (`test_frontier_run_eval.py` asserts the contend fixture under
  **both** compiles), and the two-leg shadow octopus probe (per-wave leg: a
  contended wave **followed by an ordinary merge wave** yields a per-wave
  `disposition: "excluded"` row — the ordering that would otherwise
  mislabel it `"absorbed"`; whole-run leg: an all-contended run — where
  `_build_waves` is never called — is excluded whole under the octopus
  reason, not `no per-task merges`, while a genuinely merge-free run keeps
  its existing name; **mixed shape:** one octopus wave plus a
  fast-forwarded single-task wave — where no head has exactly 2 parents
  but not every head is an octopus — yields the octopus reason, the shape
  an every-head predicate goes green over). The routing pin in the sim
  asserts the contended decision **joins wave task entries by result id**
  — never reads a `files` field off a result object.
- **Harness sim:** `tests/frontier_merge.mjs` drives the contended path in
  `waves.js` with stubbed agents — clean fold, conflict→resolve,
  stale→re-narrate (markerless shape), park→fallback, budget exhaustion
  mid-loop, thrown-dispatch→fallback, candidate-suite-failure→fallback,
  **frozen-base routing** (a prior wave's `MERGED`-without-`headSha`
  routes the next contended-shaped wave to the git-merge path, never the
  fold path) — asserts the contended dispatch text **contains the `heads/`
  slot names for every merged task id**, asserts the **resolver dispatch's
  options shape** (`model` omitted; `label` + `schema` present), and
  prints the `ALL SCENARIOS PASSED` sentinel
  (the suite-gate runs it on any harness JS change; a harness change with no
  covering sim fails the gate by design).
- **Prompt pins:** `test_no_prompt_drift.py`'s wave parametrization is
  **derived from `wave-merge.md`'s BAKE blocks *plus* an explicit
  known-names floor** (`assert set(KNOWN) <= set(wave_blocks())`) — the
  derivation auto-pins new blocks (today a forgotten list entry ships a new
  block silently unpinned), and the floor keeps a deleted or renamed block
  failing red (derivation alone would turn the existence check into a
  tautology and silently unpin a deleted block). The `frontier` report
  section gets its named `test_report_runbook.py` assertion (§4). (The
  rubric clause pin belongs to the §5 follow-up, not this plan.)
- **Fixture seal:** `contend-prod` sealed and added to `FIXTURES`.

## Release

This plan ships the engine capability dark: minor bump (architectural), both
manifests to the same version, standard release commit, default
`--overlap serialize`. The verification periphery is untouched; the compiler
emits no new diagnostic vocabulary (ineligible paths ride the existing
`marker_conflicts` `inference` kind). On an A/B pass, the §5 follow-up
(default flip + relaxation + rubric + shakedown) precedes the release; on a
miss, the branch releases as-is with the result recorded.

## Trim review

Author's disclosure — **Adds:** kernel module (promoted, not new code), fold
CLI + three-event fold log (rehydration entry point, bijective line
convention with `[]`-as-absence, scoped snapshots, temporary-index
materialization with observed modes), contended contract of the existing
merge-agent role at mostCapable (`FOLD_SCHEMA`, `CONTENDED_MERGE_PROMPT` +
resolver BAKE blocks in `wave-merge.md`, `heads/` slot sentence, spelled-out
candidate adoption sequence), ambient-tier resolver-as-agent loop
(budget-checkpointed), compiler construction-time edge-drop with exact drop
rule + hermetic rooted memoised pre-filter (first compiler filesystem
access, disclosed; subprocess-free) behind one `--overlap` knob, `waves.js`
derived-contention routing rule (`!resume` + live wave base +
intersecting `files` over
mergeable results — no new compiler field), shadow octopus per-wave probe,
`contend-prod` fixture (sealed, `FIXTURES` entry), one `.mjs` sim,
`ab_runner.py` arm flag + receipt-derived identity gate; §5 (relaxation +
rubric + canary + shakedown) specified here but built only as the
pass-branch follow-up. **Removes:** the `write-after-write` serialization
default (in the follow-up), the dead `fully_overlapping` flatten line,
`frontier_fold._visible`, the contended tag and overlap-paths field
(derived instead), the `paths` field and `park`/`conflict`/`fallback` event
types from the log, the hardcoded `WAVE_PROMPTS` list (derived + a
known-names floor), `evals/frontier/` as the kernel's home, and — at
authoring time, in the follow-up — the three documented same-file
contortions.

### Round 1 (fresh-context reviewer; grade: `netConceptDelta` **up**)

Fourteen findings; all ADOPTED except two PARTIALLY ADOPTED. 1
replay-broken resolve events (lines in the log, §4); 2 cross-process state
(rehydration, §2; refined rounds 2/4/5); 3 file-based CLI I/O (#36, §2–3);
4 materialization destroying modes/symlinks (refined rounds 2–5 into the
temporary-index route); 5 the dead Python-floor guard (deleted); 6
guard/`dispatchable` duplication (one pre-filter); 7 post-hoc edge
filtering (construction-time drop); 8 the overlap-set definition (final:
`writes ∪ reads`); 9 fold-conductor role merged into the merge agent; 10
fallback as a new failure mode (hard gate + canary); 11 canary required for
the relaxation (ADOPTED; deferral rejected — operator coupling; round 6
sequenced §5 out of this plan, superseding the concern); 12 A/B
under-specification (seal, floors, n=1, bars); 13 kernel-promotion
enumeration (refined rounds 3–5); 14 "ledger" renamed to fold log; the
founding note kept short on operator direction (PARTIAL).

### Round 2 (fresh-context reviewer; grade **up**; 1 blocker + 11 findings + 4 trims)

1 BLOCKER sequential degrade nullifies the increment (fix evolved rounds
3–5 into the flatten deletion + full-iteration predicate); 2 deletions
resurrected (touched-set keying); 3 epoch desync (`rehydrate`); 4 fallback
dead after materialize (candidate ordering); 5 kernel importing eval code
(moved); 6 shared-`Test:` paths (full overlap set); 7 `FOLD_SCHEMA`; 8
resolver budget checkpoint + tier (final: ambient); 9 modes (final:
observed); 10 markerless re-narration; 11 `FIXTURES` hardcoded; 12 BAKE
mechanics + `<pluginRoot>`. Trims: one switch; shakedown into §5; founding
note kept (operator); diagnostics via existing `inference` kind. All
ADOPTED.

### Round 3 (fresh-context reviewer; grade **up**; 2 blockers + 1 structural + 10 findings)

1 BLOCKER tag on the unreadable launch-file channel (#89; superseded — the
tag itself was deleted in round 7); 2 STRUCTURAL flatten is dead code —
delete (final predicate from round 5, verified round 6); 3 BLOCKER `heads/`
slot sentence; 4 candidate mechanics (final git sequence from round 5); 5
newline bijection; 6 resolver prompt into `wave-merge.md`; 7 false
BAKE-contiguity claim corrected; 8 scoped snapshots + wall-time line; 9
task-index order; 10 one overlap-set spelling; 11 switch plumbing; 12
`validate_skill` made live; 13 resolver-tier justification (superseded by
ambient). Scope: hard gates non-overrulable. All ADOPTED.

### Round 4 (fresh-context reviewer; grade **up**; 2 blockers + 8 findings + 3 trims)

1 BLOCKER positional `contendedWaves` vs redirect (#131; superseded — no
tag at all since round 7); 2 BLOCKER eval tests break + `same_file_edges`
zeroed (eval entry points compile pre-drop); 3 labeling byte-identity third
shape (superseded by round 5's final form); 4 contended tier + `catch`; 5
§2/§3 candidate contradiction (temporary index); 6 union-then-fold scoping;
7 bijection details; 8 no validity re-check; 9 arm identity as hard gate;
10 doc surfaces. Trims: `paths` deleted from `fold`; parks into the
conflicts index; ambient-tier resolver. All ADOPTED.

### Round 5 (fresh-context reviewer; grade **up**; 2 blockers + 11 findings + 4 trims)

1 BLOCKER kept-pairs predicate flips ordinary plans (final full-iteration
form, §1b); 2 BLOCKER dark-mode branch shipped unmeasured §5 alone
(conditioned; round 6 resequenced it out of the plan); 3 ≥2-tags
overcounting (superseded by derived intersection, rounds 6–7); 4 exact
drop rule + reachability-direction flip; 5 `read-tree -u` fatal /
`ff-only` refusal (corrected sequence); 6 modes have no detector (observed
via `ls-tree`); 7 `rehydrate(repo, log)`; 8 fold-log collision across
rounds (fresh-log refusal); 9 octopus breaks the shadow line (named
exclusion; rounds 6–7 made it per-wave and placed it); 10
`test_report_runbook` named pin; 11 rubric clause unpinned + mirror
spellings differ (reconciled; round 6 required plain unstyled text); 12
`splitlines()` second counting convention (all counting via `split_lines`);
13 eval re-point weakening the fixture guarantee (both compiles asserted).
Trims: receipt field deleted; `WAVE_PROMPTS` derivation (round 6 added the
floor); `fallback` event type deleted; redirect stripping (superseded by
the `!resume` conjunct). All ADOPTED.

### Round 6 (fresh-context reviewer; grade **up**; **§1b predicate VERIFIED** by construction; 2 blockers + 6 findings)

1 BLOCKER salvage lane re-enters with the tag intact (fixed as a `waves.js`
resume guard; superseded by round 7's tag deletion — the `!resume` conjunct
remains); 2 BLOCKER derived `WAVE_PROMPTS` tautology (floor added); 3
pre-filter rootless/non-hermetic (`--repo-root`, inert without it,
subprocess-free); 4 §5 had no build/revert mechanism (sequenced out as the
pass-branch follow-up; `--overlap` knob); 5 shadow exclusion run-granular
and unreachable (per-wave disposition; round 7 placed the probe); 6
contention over mergeable results; 7 §1c promotion cannot occur (folded
into the `seen` clause); 8 five coherence nits (all fixed). All ADOPTED.

### Round 7 (fresh-context reviewer; grade: `netConceptDelta` **up**; round-6 adoptions all VERIFIED — both resume lanes set `resume: true`, no stale switch spellings, inert-without-root consistent; found 1 blocker + 1 structural trim + 4 findings + 1 nit; loop explicitly not ended)

1. **STRUCTURAL TRIM — the contended tag and overlap-paths payload are
   derivable; delete both** (the compiler already emits `files =
   creates ∪ modifies ∪ reads` on every inline entry — the exact overlap
   set; Kahn layering separates every edge-connected pair, so within a
   wave, intersecting `files` ⟺ dropped eligible pair; under serialize the
   rule is inert by construction) — ADOPTED. No new compiler field; the
   engine derives contention (`!resume` + ≥2 mergeable results with
   intersecting `files`); the resume-stripping machinery, the
   "tags-alone-insufficient" sub-rule, and the pair-vs-whole-set ambiguity
   all delete; arm identity re-bases on `dag_edges` + wave shape; the
   authority trade (compiler-declared → engine-derived) disclosed and
   pinned (§1, §Non-goals, §6, §Testing).
2. **BLOCKER — "`[]` is a kernel error" breaks deletion** (`[]` is
   load-bearing at four sites as the absence/deletion mark) — ADOPTED.
   `[]` denotes absence and stays constructible; the bijection is over
   existing files; the truncate-vs-delete disambiguation claimed as the
   gain it is; `join_lines` "unconditionally" corrected; `_visible`
   identity-except-`[]` stated (§2, §Testing).
3. **The shadow octopus probe must precede the group/absorbed dispatch,
   and the all-contended run needs the right name** (floor scan recognises
   only 2-parent merges → `"absorbed"` mislabel; all-contended → wrong
   whole-run reason) — ADOPTED. Placement fixed; contended-first test
   shape added (§Where it lives, §Testing).
4. **§6 assumed `ab_runner` plumbing that does not exist** (no arm
   parameter anywhere; invalid rows must still append for `--rerun-of`) —
   ADOPTED. `ab_runner.py` named as a build surface with the exact
   threading points (§Where it lives, §6).
5. **The pre-filter was specified per pair inside an O(N²) loop** (this
   file carries a measured fix for exactly that class) — ADOPTED. Memoised
   per path; per-path `inference` records; deterministic diagnostic count
   (§1).
6. **`dependency-analysis.md`'s unconditional serialization rule becomes
   false in this plan, not the follow-up** — ADOPTED. Rule 3 and the reads
   bullet added to this plan's doc scope (§Where it lives).
7. **Nit — "at `WAVES` construction" was a temporal dead zone** — dissolved
   by finding 1 (nothing to strip; one `!resume` conjunct at the merge
   site).

### Round 8 (fresh-context reviewer; grade: `netConceptDelta` **up**; **the Kahn invariant VERIFIED AIRTIGHT** — attacked via reads-only overlaps, double-blocked orderings, resume compaction, and non-`layer()` wave assembly; `[]`-as-absence verified against all four code sites; no stale references found after seven rewrites; found 1 blocker + 1 contract gap + 1 disclosure)

1. **BLOCKER — the shadow octopus probe could not fire for an
   all-contended run** (`_find_floor` scans for exactly-2-parent merges;
   with every wave head an octopus, `_build_waves` is never called and the
   run falls through to `no per-task merges` — the §5 shakedown's most
   likely shape; a whole-run verdict cannot originate in `_build_waves` at
   all) — ADOPTED. Two-leg probe: per-wave leg stays in `_build_waves`;
   whole-run leg in `_shadow`, keyed on merged-head parent counts, never on
   `floor_source` (a merge-free run also yields `"wave-head-parent"` and
   keeps its name). The floating-floor harvest consequence (a mixed run's
   contended-wave durations drop out as at/below-floor) named so it is not
   read as a bug (§Where it lives, §Testing).
2. **Contract gap — mergeable results carry no `files`; the routing rule
   as written fails closed and ships the mode inert** (every `runTask`
   return path emits `{task, status, branch, headSha, …}` only) — ADOPTED.
   The join is stated: the rule evaluates the `WAVES[waveIdx]` task
   entries of the mergeable results, joined by `r.task === t.id`; the sim
   pin asserts the join, never a `files` read off a result (§1, §Testing).
   Related one-liner: the per-path `inference` record's field shape named
   (`task: ""`, the `type_conflicts` precedent) so `add_conflict`'s
   `(task, edge)` dedupe stays unique per path (§1).
3. **Disclosure — a pair overlapping only on a shared `Test:` path routes
   contended and folds nothing** (`files` collapses provenance; the
   touched sets are disjoint, so the wave pays the fold ceremony for a
   trivially clean result) — ADOPTED as a stated priced cost, kept in
   preference to re-introducing a declared field; a zero-conflict
   contended wave in the canary reads as designed (§1).
4. **Verified, recorded to prevent re-litigation:** the `[]` sites (all
   four), the emptied-vs-deleted resolution, `_visible`'s identity, the
   cap-count flag, `receipt["compile"]` sufficiency, `--repo-root`
   feasibility, the `schedule_model` promotion split, the `validate_skill`
   regex shape, the `FIXTURES`/`report_runbook` seams, both
   `dependency-analysis.md` statements, and the absence of stale
   references. One stale docstring named for update with the bijection
   (`_base_text_untouched`) (§2).

### Round 9 (fresh-context reviewer; grade: `netConceptDelta` **up**; round-8 adoptions #2 (files-join) and #3 (`Test:`-only disclosure) VERIFIED airtight and coherent with §5/§6; **buildability verdict: buildable as written except finding 1**; found 1 blocker + 2 minor under-specs + 3 wording nits; no scope growth)

1. **BLOCKER (new defect in round-8 adoption #1) — the whole-run octopus
   leg keyed on *every* head ≥3 parents misses the modal shakedown
   shape** (one contended wave + fast-forwarded single-task waves: no
   head has 2 parents, so `_build_waves` is never called, yet not every
   head is an octopus — neither leg fires and the run keeps
   `no per-task merges`; the all-contended §Testing pin passes under both
   spellings and cannot catch it) — ADOPTED. The leg lives in `_shadow`'s
   existing no-floor branch and keys on **any** merged head ≥3 parents;
   no-head-≥3 keeps the merge-free name; the mixed shape added to the pin
   set (§Where it lives, §Testing).
2. **A third octopus surface unnamed: `run_eval._chain_defect` whole-run
   exclusion** — ADOPTED as a one-sentence disclosure: post-flip K3
   archived-run coverage for contended runs shifts to the shadow line and
   fold log; fails loudly by name, no code change; restoration is a
   separate increment (§Where it lives).
3. **The contended prompt's wave-base / `<prevHead>` input had no named
   source** — ADOPTED. `waveBaseSha` (module-scope, advanced only after a
   merge) is engine-authored into the dispatch, `headsSlotsLine`-style;
   the agent derives nothing (§3).
4. **Wording nits** — ADOPTED, all three: the "no second spelling" claim
   scoped to edge rules with §1b's writes-only predicate named as the
   deliberate exception (§1); the two-leg probe promoted to its own
   subsection (§Where it lives); §Release's "kept-pairs" corrected to
   "ineligible paths".

### Round 10 (fresh-context reviewer; grade: `netConceptDelta` **up**; ALL round-9 adoptions VERIFIED — `merged` in scope in the no-floor branch, both routes to it covered, the two legs partition exhaustively, the modal shape resolves, K3 disclosure accurate; the `files`-join, receipt sufficiency, and ab_runner threading points re-confirmed against the code; **buildability: buildable as written except finding 1**; found 2 one-clause findings + 3 nits; no scope growth)

1. **The `waveBaseSha` invariant has one hole: the tolerated
   `MERGED`-without-`headSha` soft failure freezes the base** — survivable
   on the git-merge path (content reconciliation), but the contended path
   builds its candidate *from* the base, so a frozen base rewinds the
   integration branch over the prior wave's merge and ends the run
   BLOCKED at the ancestry check — loud, but late and expensive —
   ADOPTED, the recommended guard: a third routing conjunct (wave base
   live), `headSha` **required** in `FOLD_SCHEMA`, and the frozen-base
   routing pin in the sim; wave 1 unaffected (setup is hard-gated on
   `headSha`) (§1, §3, §Testing).
2. **"Ambient model, no tier override" named a dispatch shape no code in
   the repo exercises** (every `waves.js` dispatch passes `model`; the
   verified-live note covers strings, not omission; CLI default and
   workflow default are two runtimes' defaults; a wrong guess costs a
   full production-length cell against a non-overrulable gate) — ADOPTED.
   Concrete options shape stated (`model` omitted), live-verified by the
   build task, asserted by the sim; the fallback decision pre-stated
   (`TIER.standard` + a named resolver-model confound replacing the
   like-for-like sentence in §6's honesty bounds) (§3, §Testing).
3. **Nits** — ADOPTED, all three: `evals/run_frontier_cell.py`'s path
   disambiguated from the `evals/frontier/` trio; `shadow_fold._remodel`
   named as shadow's only compiler shell-out; the no-floor branch's
   justification broadened to cover the root-commit route (§Where it
   lives).

### Round 11 (fresh-context verification round; grade: `netConceptDelta` **up**; round-10 adoptions verified — routing-conjunct implementability (no TDZ, sticky for free), sim options-assertion precedent, `TIER.standard` exists (`sonnet`), `agent()` is the unmediated runtime global — EXCEPT the `FOLD_SCHEMA` clause, refuted; **buildability: buildable as written except finding 1 (a deletion)**; found 1 new defect + 1 gate clause + 3 nits; no scope growth)

1. **NEW DEFECT in round-10 adoption #1 — `headSha`-required on
   `FOLD_SCHEMA` is attached to a reply that cannot carry it** (the fold
   step has adopted nothing; a required field a step cannot supply burns
   schema retries or invites a fabricated sha), does not reach the
   adoption reply that matters (`MERGE_SCHEMA`, `headSha` optional), and
   correctly relocated would block *after* adoption — the worst moment;
   meanwhile the third conjunct is sticky and alone closes
   contended-after-contended — ADOPTED as the reviewer's trim: the clause
   is **deleted**; the conjunct is the whole guard; the route-away's
   inherited git-merge-path cost acknowledged in §1 (nit 2).
2. **§6's gates count fallbacks but not route-aways** (a frozen base or
   similar routing silently de-measures arm B — not a "fallback", and
   invisible to the compiler-side arm-identity check) — ADOPTED: a
   non-overrulable hard-gate clause that every contended-shaped wave in
   arm B actually took the fold path (§6).
3. **Nits** — ADOPTED, all three: §3's restatement now carries all three
   conjuncts (and the Adds disclosure likewise); §1 acknowledges the
   route-away's inherited cost; the fallback-tier wording spells out
   remove-here / add-there across §3 and §6.
