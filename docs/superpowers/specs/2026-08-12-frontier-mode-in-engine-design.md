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
   fold log — falling back to today's merge path on any guard or pre-commit
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
  for redirect waves (hand-authored, stay serialized).
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
- `evals/frontier/references/resolver-prompt.md` →
  `skills/ultrapowers/references/resolver-prompt.md` (rewritten for the
  file-read contract and the two narration shapes, §3) and baked into
  `waves.js` under `test_no_prompt_drift.py`.

Stays in `evals/` (modeling and probe apparatus, explicitly modeling-only):
`schedule_model.py` (its `SAME_FILE_WHYS` is the *modeled* drop rule, labeled
as such; the engine's narrower rule lives in `compile_plan.py` and is the one
evals import when measuring the engine), `shadow_fold.py`, `run_eval.py`,
`run_frontier_cell.py` (imports re-pointed).

New: `skills/ultrapowers/kernel/fold_wave.py` (CLI) and
`kernel/FOLD_LOG.md` (schema); `evals/fixtures/contend-prod/`;
`--serialize-overlaps` in `compile_plan.py`; an arm flag in
`evals/ab_runner.py`. `validate_skill.py`'s link-check regex extends to
`kernel/` paths (it currently validates only `references|scripts`).

## Components

### 1. Compiler: the edge-drop rule

Three coupled changes, one switch. `--serialize-overlaps` is the **single**
named switch: passed (or shipped as the default if the A/B fails), the
compiler reproduces today's output byte-identically; otherwise the canonical
rules below apply. There is no separate "guard" concept.

**(a) The drop.** Canonical compile does not create `write-after-write` edges
for eligible pairs. The drop happens **at construction** — the tier-3 loop
skips the edge — never by post-hoc filtering: later tiers (`ambiguous-files`,
catch-all) consult reachability through the accumulated adjacency, so an edge
removed after the fact would leave those tasks unordered against peers they
must still serialize behind. A test pins that an ambiguous/catch-all task
still serializes in a plan where a `write-after-write` edge was dropped.

**(b) The degrade rule becomes contention-aware.** The sequential-mode
predicate (`fully_overlapping`) reads task `writes` directly, not the edge
set, and today flattens any plan where every task pair shares a written path
into single-task waves — which would silently nullify this increment on
exactly the plans it exists for (verified by compiling an all-overlapping
variant of `contend`: `mode: sequential`, one task per wave). Canonically:
when every overlapping path in such a plan is fold-eligible, the plan
compiles to contended waves instead of degrading; `--serialize-overlaps`
restores today's degrade byte-identically. Pinned by a test compiling an
all-overlapping plan both ways. Dodging the predicate by fixture shape (an
extra disjoint task, as `contend` happens to have) is explicitly rejected: it
would green the A/B while every real fully-overlapping plan still degraded.

**(c) Label semantics**, stated precisely because the label is not the
physics:

- The drop keys on the `write-after-write` label. Its overlap set is
  `(writes ∪ Test:)` on both sides. A shared `Test:` path is a **write**
  under upstream TDD semantics (each task writes the failing test) — the
  most common real contention in this repo's own plans, and exactly what the
  fold-and-resolve path must handle, not a benign side effect.
- Pairs whose overlap edge was **promoted** to `interface` stay serialized
  and their waves are not tagged contended.
- All semantic edges survive untouched: `marker`, `text`, `interface`,
  `prose-reference`, `write-after-create` (the base to edit against must
  exist), `read-after-write`, `ambiguous-files` (unknown writes cannot be
  scheduled into contention).

Disclosure: the modeled rule (`schedule_model.SAME_FILE_WHYS`) also dropped
`write-after-create` and `ambiguous-files`. The engine rule is a strict,
deliberately conservative subset. On the contended fixture the two rules
coincide (all three dropped edges were `write-after-write`), so the measured
41% transfers; the A/B re-measures under the engine's own rule regardless.

**Eligibility pre-filter.** A pair keeps its serializing edge when any path
in the **full overlap set** (`(writes ∪ Test:)` on both sides), where it
exists in the repo, would already fail the kernel's own dispatch predicate —
non-text content, over `RESOLVER_LINE_CAP` (imported from the kernel, never
re-typed), or a non-regular git object (symlink, gitlink). This is a
scheduling heuristic — don't dispatch parallel work certain to park — not a
safety guard: the runtime predicate (`dispatchable()`, and the
materialization rules) remains authoritative for files tasks create or grow
past the cap. Kept-for-eligibility pairs are recorded through the **existing**
`marker_conflicts` vocabulary (`kind: "inference"`, naming path and reason) —
no new diagnostic vocabulary, so the freeze is not touched.

A wave holding ≥2 tasks with overlapping writes is tagged **contended** in
the launch file with the overlap paths listed. Untagged waves compile
byte-identically to today.

### 2. Kernel module and fold CLI

`kernel/fold_wave.py` is a deterministic CLI (no LLM). Because each
invocation is a fresh process, **all state lives in git plus the fold log**,
and every invocation rehydrates before acting.

- **Rehydration is a named kernel entry point** —
  `rehydrate(log) -> FrontierEngine` — not a reuse of `replay()`: `fold`
  events recompute the task's endpoint diff from its recorded `headSha` (a
  pure function of git objects) and re-fold it; `resolve` events re-apply
  their recorded `lines` **and are appended to the engine's event list**, so
  the epoch clock and touched-path map reconstruct exactly (today's
  `replay()` skips that append — its epoch desynchronizes from the live
  engine's, which manifest equality cannot detect; `replay()` becomes a thin
  wrapper over `rehydrate`). `base`, `conflict`, `park`, and `fallback`
  events are inert for rehydration. The pin asserts the rehydrated engine's
  `epoch()` **and touched-path map** equal the live engine's across ≥3
  process boundaries — not merely the manifest.
- **`fold` subcommand:** given wave base sha and the mergeable branches in
  completion order, folds each, appends `fold` events, and writes per
  conflict: the annotated narration to `frontier/wave-<n>/conflict-<i>.txt`
  and its `dispatchable()` verdict (park reason when ineligible) to the
  conflicts index. Runs the two live self-checks the cell ran — sampled raw
  fold orders outcome-identical, and log replay reproduces the manifest —
  and reports failure as a named fallback, never a silent pass. Kernel
  limits (recursion on ~1000-line files) are caught here and become parks.
- **`resolve` subcommand:** applies a whole-file resolution from a file of
  lines under epoch validity (an intervening fold on the path since the
  narration's epoch → stale, re-narrate once), appending the `resolve` event
  **with the lines** — the log alone must replay. A **re-narration is a
  markerless whole-file body** (re-folding an already-folded endpoint
  narrates nothing — the cell's `_renarrate` measured this); `dispatchable()`
  is not re-applied to it, and the resolver prompt accepts both shapes.
- **`materialize` subcommand:** applies the fold outcome **over the recorded
  touched set** — for each path in the union of the fold events' `paths`,
  write the manifest entry if present, **else remove the path** (the fold
  manifest omits deletions; keying on the manifest alone would silently
  resurrect a task's `git rm`). Paths outside the touched set are never
  visited, so their modes, symlinks, and gitlinks survive untouched. Each
  folded path takes its **mode from the previous integration head** (base
  mode preserved; a mode *change* by a task is a park); a folded path that
  cannot be represented as a regular blob is a named fallback. The commit is
  a **candidate**: parents = previous integration head + merged task heads.
  It becomes the integration head — and the `heads/` slot is written — only
  after the wave test passes (§3).

**All CLI I/O is file-based** (#36: relaying structured payloads through
agent replies corrupts them). The CLI reads and writes under
`<runDir>/frontier/`; agents relay only paths, counts, and enum verdicts.

### 3. Engine: the contended merge path

For a contended wave, `mergeWave()` routes its **existing merge agent** (one
role, two paths) through the frontier sequence. The contended contract is its
own contiguous `BAKE:CONTENDED_MERGE_PROMPT` block in
`references/wave-merge.md` — a separate baked const, because the drift pin
matches contiguous text and splicing a clause into `MERGE_PROMPT` would break
it — and `WAVE_PROMPTS` in `test_no_prompt_drift.py` gains the entry. The
prompt locates the CLI via the existing `<pluginRoot>` token that
`fillPaths()` fills (precedent: `review-package`).

1. The merge agent runs `fold_wave.py fold` and replies with counts +
   verdicts + paths — small scalars under a new sibling `FOLD_SCHEMA`
   (`MERGE_SCHEMA` is `status`/`headSha`/`detail` and cannot carry them).
2. For each dispatchable conflict, `waves.js` first checks
   `budgetExhausted()` — every existing dispatch site is checkpointed, and a
   serial N-conflict loop must be too; exhaustion routes to fallback (still
   live at this point) — then dispatches **one resolver agent at a time** at
   **`TIER.mostCapable`** (the resolver is the E2 quality surface; the cheap
   merge tier would grade E2 under a different model than the cell
   measured). The resolver **reads its narration file itself** and writes
   its whole-file resolution to a reply file (a contract change from the
   cell's no-tools text-in/text-out resolver; the promoted prompt is
   rewritten for it and for both narration shapes). A merge-agent call then
   runs `resolve`; stale → re-narrate once. Serialization is by
   construction: the loop awaits each resolution. Resolver calls are
   workflow-visible agents — in the progress tree, charged to the run
   budget, transcripts recorded verbatim in the report.
3. **The wave test runs before the candidate commit is adopted.** The merge
   agent materializes the candidate, runs the project suite against it (the
   same `testInstruction` duty the merge contract already carries), and only
   on green adopts it — replying `MERGED` + `headSha` so the existing
   call-site handling (`waveBaseSha`, review base) is unchanged. A suite
   failure at this point — the most likely fallback trigger, a resolution
   that folds clean but is semantically wrong, exactly the path the
   adjudication's E2 caveat named as unexercised — discards the candidate
   and falls back.

**Fallback — live strictly before adoption, and honestly priced.** The fold
consumes task branches but never destroys them, so kernel error, ineligible
conflict, resolver parked after its retry, budget exhaustion mid-loop,
self-check failure, materialization park, or **candidate suite failure** all
route the wave to the existing git-merge + reconcile path. After a candidate
is adopted, task heads are ancestors of the integration branch and the
reconcile path can no longer bind — from there the only route is redirect,
as with any adopted merge today. And the fallback is **not** "today's
behavior arrived at late": under today's rule these tasks never ran
concurrently, so the reconcile agent (two attempts, then `blockedWaves`) is
handed a multi-task same-file collision it was never built for, with the
parallel work already spent. The fallback's real cost is a wave that can end
blocked. Accordingly, **fallback rate on contended waves is a pre-registered
hard gate in the A/B (§6) and the production canary (§5)** — not merely a
named event. Every fallback appends a `fallback` event and surfaces in
`judgmentCalls`.

Task failure and review handling are unchanged: only mergeable results fold,
exactly as only mergeable results merge today.

### 4. Fold log schema (first-class contract)

One JSONL file per contended wave
(`<runDir>/frontier/wave-<n>/fold_log.jsonl`), self-sufficient for
rehydration:

- `base {sha}` — first line, the wave base.
- `fold {task, headSha, paths}` — paths = the task's touched set (weaves ∪
  raw ∪ deleted), recorded so staleness and materialization rebuild from the
  log.
- `conflict {path, kind, narrationFile, verdict}`.
- `resolve {path, epoch, lines}` — the lines themselves; rehydration
  consumes them.
- `park {path, reason}` / `fallback {wave, reason}`.

`base`, `conflict`, `park`, `fallback` are inert for rehydration (§2).
`report.json` gains a `frontier` section per contended wave: fold-log path,
self-check results, resolver transcripts verbatim (the E2 grading surface),
parks, fallbacks. Schema documented in `kernel/FOLD_LOG.md`. No existing
report field changes shape.

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
plans with contended waves vs. the portfolio baseline. First persistence of
elevated rates flags the relaxation possibly-failed; second persistence makes
drafting the reversal (restore serialization by default, keep the engine
capability guarded) mandatory distill output. Adoption of any reversal stays
operator-gated.

**The canary's first reading is pre-release:** one real backlog plan authored
under the relaxed rule runs `/ultrapowers` end-to-end (the shakedown), and
its `frontier` report section is operator-reviewed before the release ships.
Evidence, not a gate.

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
- Hard gates: both arms' gates green; arm B fold-log self-checks clean
  (sampled raw orders outcome-identical, replay match); **zero fallbacks on
  contended waves in arm B**; zero silent divergence; every park named.
- E1′: arm B end-to-end wall clock ≤ **0.7×** arm A (the numeric bar for
  "material" — the 4-wide fixture's causal expectation is ~2×, leaving
  headroom for review overlap).
- E2′: arm B output tokens ≤ **1.25×** arm A, and any live resolutions
  graded acceptable by the operator from the verbatim transcripts.
- The operator may overrule a bar only with recorded reasoning in the
  results doc (house precedent: the E1 decomposition of 2026-08-12).
- Any hard-gate red, or E1′/E2′ miss without a recorded overrule → the
  compile switch ships defaulted to `--serialize-overlaps` (mode dark) and
  the result is recorded. Pass → release with the canonical default.

**Honesty bounds, carried into the results doc:** n = 1 is directional, not
statistical (the standing 0.1.0 constraint); and the A/B answers the
adjudication's *length* question at width 4 — width-scaling beyond that
remains modeled, and the results doc says so rather than extrapolating.

## Error handling

Stated per component above; the invariants: **every failure degrades through
a named event**, the degradation target before candidate adoption is the
existing merge/reconcile path — with its real cost stated in §3, not
euphemized — and after adoption the route is redirect, as today. A
`--serialize-overlaps` compile is byte-identical to today's. The engine never
claims a fold succeeded without the live self-checks; replay divergence is a
fallback, not a warning.

## Testing

- **pytest:** edge-drop at construction (only `write-after-write` label
  dropped; semantic edges survive; ambiguous/catch-all tasks still serialize
  against peers whose overlap edge was dropped; promoted-interface pairs stay
  serialized and untagged; the pre-filter keys on the full overlap set —
  including shared `Test:` paths — and keeps edges for non-text / over-cap /
  non-regular existing paths via existing `marker_conflicts` vocabulary;
  `--serialize-overlaps` reproduces today's compile byte-identically), the
  contention-aware degrade rule (an all-overlapping plan compiles to one
  contended wave canonically and to N single-task waves under the switch),
  contended tagging, fold CLI (rehydration across ≥3 process boundaries
  asserting epoch and touched-path equality — not manifest equality alone —
  epoch validity, both narration shapes, self-checks, log replay, park
  reasons), materialization (touched-set application: a task's deletion
  reaches the tree while an untouched executable and symlink keep mode and
  link; a folded 100755 file keeps its bit from the base; a task mode-change
  parks; non-regular folded path → named fallback; candidate discarded on
  suite failure without moving the integration head). The promoted kernel
  modules' tests move with them; the vendor sha256 + parse pins re-point.
- **Harness sim:** `tests/frontier_merge.mjs` drives the contended path in
  `waves.js` with stubbed agents — clean fold, conflict→resolve,
  stale→re-narrate (markerless shape), park→fallback, budget exhaustion
  mid-loop, candidate-suite-failure→fallback — and prints the
  `ALL SCENARIOS PASSED` sentinel (the suite-gate runs it on any harness JS
  change; a harness change with no covering sim fails the gate by design).
- **Prompt pins:** the `CONTENDED_MERGE_PROMPT` block and resolver prompt
  enter `test_no_prompt_drift.py`'s `WAVE_PROMPTS`; rubric mirror text pinned
  by `test_recommendation_rubric.py`.
- **Fixture seal:** `contend-prod` sealed and added to `FIXTURES`.

## Release

Minor bump (architectural): both manifests to the same version, standard
release commit. The verification periphery is untouched; the compiler emits
no new diagnostic vocabulary (kept-pairs ride the existing `marker_conflicts`
`inference` kind).

## Trim review

Author's disclosure — **Adds:** kernel module (promoted, not new code), fold
CLI + fold-log schema (rehydration entry point), contended branch of the
existing merge agent (`FOLD_SCHEMA`, `CONTENDED_MERGE_PROMPT` bake block),
resolver-as-agent loop (mostCapable tier, budget-checkpointed), compiler
construction-time edge-drop + contention-aware degrade rule + pre-filter +
tag behind one switch, `contend-prod` fixture (sealed, `FIXTURES` entry), one
`.mjs` sim, rubric/authoring text updates + canary, ab_runner arm flag.
**Removes:** the `write-after-write` serialization default, the
fully-overlapping sequential degrade (canonical mode), `evals/frontier/` as
the kernel's home, and — at authoring time — the three documented same-file
contortions.

### Round 1 (fresh-context reviewer; grade: `netConceptDelta` **up** — "nine adds against three removes; nothing makes an existing defect class inexpressible")

Fourteen findings; adopt-or-answer:

1. **Hash-only `resolve` events cannot replay** — ADOPTED. `resolve` carries
   `lines`; hash deleted; the log is self-sufficient (§4).
2. **Cross-process kernel state unspecified** — ADOPTED. Rehydration rule
   defined (git + fold log are the only state); pinned by a
   process-boundary test (§2). *(Round 2 corrected the mechanism: named
   `rehydrate` entry point, epoch-clock reconstruction.)*
3. **Structured payloads through agent replies (#36)** — ADOPTED. All CLI
   I/O file-based; agents relay scalars; resolver reads its narration file
   itself; prompt-contract change from the cell's resolver stated (§2, §3).
4. **Whole-tree materialization destroys modes/symlinks/gitlinks** —
   ADOPTED. Folded-paths-only application (§2). *(Round 2 corrected the
   mechanism: touched-set application, else deletions resurrect.)*
5. **Python < 3.12 guard guards nothing** (vendor patch removed the PEP 701
   line; standing parse pin under the running interpreter) — ADOPTED,
   deleted.
6. **Guards duplicate `dispatchable()`; 400 re-typed** — ADOPTED. One
   pre-filter, explicitly a scheduling heuristic, importing
   `RESOLVER_LINE_CAP`; runtime predicate authoritative (§1).
7. **Post-hoc edge filtering breaks later compiler tiers** — ADOPTED. Drop
   at construction; ambiguous/catch-all serialization pinned by test (§1).
8. **`write-after-write` label ≠ "both write"** — ADOPTED. Label vs. overlap
   set defined; promoted-interface pairs stay serialized (§1). *(Round 2
   corrected "readers fold clean" to the TDD-write reading.)*
9. **Fold conductor duplicates the merge agent** — ADOPTED. One role, two
   paths; contended branch in `wave-merge.md` (§3).
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
    link-check extended to `kernel/` (§Where it lives).
14. **Cut the Founding-architecture section; "ledger" collides with
    ultralearn's ledger** — ADOPTED for the rename (fold log, everywhere)
    and the replay overclaim (fixed via 1–2); PARTIALLY ADOPTED for the cut:
    shrunk to a three-line "Founding orientation" note that explicitly
    grants nothing — kept because the operator directed that an anti-drift
    statement of the module's founding role appear in the spec.

### Round 2 (fresh-context reviewer; grade: `netConceptDelta` **up** — "the round-1 revision added five standing terms without making any existing defect class inexpressible"; found 1 blocker + 11 findings; loop explicitly not ended)

Twelve findings + four trims; adopt-or-answer:

1. **BLOCKER — the `fully_overlapping` sequential degrade nullifies the
   increment on all-overlapping plans** (predicate reads `writes`, not
   edges; reviewer verified by compiling a modified `contend`) — ADOPTED.
   Third compiler change (§1b): degrade becomes contention-aware; switch
   restores today's degrade; pinned both ways; fixture-shape dodging
   explicitly rejected. Added to the Adds disclosure.
2. **Folded-paths-only materialization resurrects deletions** (the fold
   manifest omits deleted paths; the cell got away with it by wiping the
   tree) — ADOPTED. Materialize keys on the recorded touched set: manifest
   entry if present, else remove; deletion test added (§2, §Testing).
3. **`replay()` cannot rehydrate: the epoch clock desynchronizes** (resolve
   events not appended; manifest-equality pin cannot see it; §4's inert
   events would `KeyError`) — ADOPTED. Named `rehydrate()` entry point;
   resolve events appended; inert events stated; pin asserts epoch +
   touched-map equality (§2, §4).
4. **Fallback is dead after materialize; the wave test has no stated home**
   — ADOPTED. Candidate-commit ordering: suite runs before adoption;
   post-fold suite failure enumerated as the most likely fallback trigger;
   after adoption the only route is redirect (§2, §3).
5. **Shipped kernel would import eval-only `schedule_model`** (the
   self-check calls `sampled_orders`/`fold_all`) — ADOPTED. Both move into
   the kernel; `schedule_model` imports them back (§Where it lives).
6. **Pre-filter misses shared `Test:` paths; "readers fold clean" is wrong**
   (a shared 2,641-line test file would be freed, then park at runtime —
   against the new hard gate) — ADOPTED. Pre-filter widened to the full
   overlap set; sentence replaced with the TDD-write reading (§1).
7. **`MERGE_SCHEMA` cannot carry the contended replies** — ADOPTED. Sibling
   `FOLD_SCHEMA` for fold/resolve; materialize replies `MERGED` + `headSha`
   so existing call-site handling is unchanged (§3).
8. **No budget checkpoint in the resolver loop; resolver tier unnamed** —
   ADOPTED. Per-conflict `budgetExhausted()` check routing to
   still-live fallback; resolver pinned at `TIER.mostCapable` (§3).
9. **Modes on folded paths unrepresented** — ADOPTED. Folded paths take the
   base mode from the previous integration head; task mode-changes park; the
   executable moves into the folded set in the test (§2, §Testing).
10. **Re-narration is markerless; prompt and dispatch rules must say so** —
    ADOPTED. Stated in §2/§3; resolver prompt accepts both shapes; sim
    covers the markerless shape.
11. **`test_fixture_seals.py` requires nothing of unlisted fixtures**
    (hardcoded list) — ADOPTED. The build task adds `contend-prod` to
    `FIXTURES`; the false claim corrected (§6).
12. **Prompt-pin mechanics: contiguous BAKE block; CLI location token** —
    ADOPTED. Own `BAKE:CONTENDED_MERGE_PROMPT` block; `WAVE_PROMPTS` entry;
    `<pluginRoot>` token (§3).

Trims: **one switch, not two** — ADOPTED (§1, §6: `--serialize-overlaps` is
the single switch; a failed gate ships it as the default). **Fold shakedown
into §5** — ADOPTED (the shakedown is the canary's pre-release first
reading). **Founding orientation still deletable** — ANSWERED-KEPT, same
operator direction as round 1, on the record. **Diagnostic-vocabulary
justification is circular** — ADOPTED: kept-pairs reuse the existing
`marker_conflicts` `inference` kind; no new vocabulary, freeze untouched
(§1, §Release).

Scope reconciliation, answered: the degrade-rule change (expansion 3) is now
disclosed in the Adds list; the n=1 honesty bounds and the width-4 scope
limitation are carried into §6 per the 0.1.0 precedent (expansion 4); the §5
relaxation remains operator-recorded with its canary (expansion 2).
