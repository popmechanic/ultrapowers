# Frontier kernel + scheduler simulation — design

**Date:** 2026-08-09
**Status:** trim-reviewed, awaiting operator review
**Acceptance:** suite
**Origin:** operator-directed brainstorm — "if you were trying to take the absolute
greatest advantage of manyana and do a whole-cloth redesign of ultrapowers, what
would it look like?" This spec is the first buildable increment of that redesign:
an evidence-producing probe, not an engine change.

## Background

[manyana](https://github.com/bramcohen/manyana) (Bram Cohen, 2026, public domain)
is a ~549-line CRDT-based merge kernel for single files. Its state is a *weave* —
every line that ever existed in a file, with depth/anchor/generation metadata.
Public API: `initial_state(lines)`, `current_lines(state)`, `update_state(state,
lines)`, `merge_states(s1, s2) → (state, annotated_lines)`.

Properties the current ultrapowers architecture lacks and works around:

- **Merges never fail** and are commutative, associative, and idempotent.
- **Any subset** of divergent states merges to a well-defined result.
- Merging is a **single linear pass** — cheap enough to run constantly.
- Conflicts are **narrated** ("left deleted this block; right inserted into the
  middle of it"), not opaque ours/theirs blobs — a much stronger input format
  for an LLM resolver than git conflict markers.
- **No-interleaving guarantee** for concurrent same-point insertions.

The frontier thesis: ultrapowers' wave architecture is merge-batching — wave
barriers, same-file dependency serialization, cascade-blocking, and the ancestry
apparatus all exist because git merges are expensive, order-sensitive, and
failure-prone. A merge kernel with the properties above would dissolve those
structures: an event-driven task swarm publishing immutable weave states into a
continuously-tested merge frontier, with git demoted to a snapshot ledger.

That thesis is unproven. Per the subtraction-eval doctrine (measure, don't
argue), this increment builds the two genuinely novel components — a repo-level
weave layer and a barrier-free scheduling model — offline, and measures them
against real and fixture workloads. No engine change is proposed here; the
outcome of this probe decides whether one is ever proposed.

## Goal

Answer two questions with numbers:

1. **Kernel correctness:** does a repo-level weave layer over manyana merge real
   ultrapowers workloads correctly (order-independent, subset-sound) and legibly
   (conflict narration the operator grades as usable — see K4/S3, not
   self-asserted)?
2. **Scheduling gain:** how much wall-clock does barrier-free DAG scheduling
   recover over wave barriers on real and fixture plan shapes — including the
   width recovered by relaxing the same-file serialization rule?

## Non-goals

- No change to `skills/` — no harness JS (hence no `.mjs` sim obligation), no
  prompt re-baking, no frozen verification periphery, no plugin version bump.
- No change to CI configuration (Python stays 3.11 — see vendoring).
- No agents dispatched; no LLM calls; no Anthropic API (repo rule).
- No production merge engine, no live-sync protocol, no rename tracking beyond
  delete+add, no binary-file merging (both-modified binaries are auto-conflicts),
  no per-line task provenance inside the weave (an increment-two design item;
  see K4).
- Not a decision to adopt manyana. The deliverable is the measurement report.

## Where it lives

`evals/frontier/` — the eval quarter of the repo. Tests land in `tests/` so the
ordinary suite and CI cover them. Pure Python 3 (3.9+), stdlib only. Three
modules: `repo_weave.py`, `schedule_model.py`, `run_eval.py`.

## Components

### 1. Vendored kernel — `evals/frontier/vendor/manyana.py`

Upstream manyana with **one mechanical compatibility patch**: upstream line 123
uses PEP 701 nested same-quote f-string syntax (`f'... {['<', '>'][x]} ...'`),
which parses only on Python ≥ 3.12; CI pins 3.11 and the dev default is 3.9.
The vendored copy rewrites that one expression to pre-3.12-legal form
(hoist the subscript to a local), with no behavioral change. The sha256 pin
covers the **patched** file; `evals/frontier/vendor/PROVENANCE.md` records the
upstream URL, upstream commit sha, and the exact patch hunk, so re-vendoring is
reproducible. Any other change to the vendor requires updating the pin in the
same commit. Manyana's built-in `test*` functions are wrapped so pytest
discovers and runs them on CI's interpreter.

### 2. Repo-level weave — `evals/frontier/repo_weave.py`

The layer manyana lacks. A `RepoState` maps `path → file weave state` plus file
presence. Operations:

- `snapshot(repo, ref) → RepoState` — build a base state from a git tree
  (contents via `git show`, no checkout required).
- `publish(base: RepoState, repo, ref) → TaskState` — a task's endpoint
  contribution: per-file `update_state` against the base for modified files,
  plus add/delete records. Endpoint diffing is deliberate: states are built
  fresh per fold, never persisted across resolutions, which sidesteps manyana's
  documented squash-merge trap.
- `fold(frontier: RepoState, task: TaskState) → (RepoState, [Conflict])` —
  merge one task in. Line-level conflicts carry manyana's annotated blocks;
  the incoming side is labeled with its task ID, the other side is labeled
  `frontier` (manyana exposes no per-line blame, so attributing frontier-side
  lines to their originating tasks is out of scope — see Non-goals). Fold
  idempotency (re-folding an included task leaves the frontier unchanged) is a
  tested property, not a separate API operation. File-level conflict classes:
  add/add with differing content, delete/modify. Identical add/add folds clean.
- `manifest(state) → {path: bytes}` — the visible tree as an in-memory mapping;
  all K1/K3 comparisons are manifest-equality. A disk writer (`materialize`)
  exists solely to dump failure artifacts for inspection when a gate fails, and
  is not on any comparison path.
- Subset folds: any subset of TaskStates over a common base folds to a
  well-defined RepoState (used by bisection and by the partial-adoption claim).

### 3. Scheduling model — `evals/frontier/schedule_model.py`

Closed-form, not event-driven — under this spec's own model (durations are
schedule-independent; no contention), both makespans are arithmetic:

- **Waves makespan:** Σ over compiled waves of max(task duration in wave).
- **Frontier makespan:** longest path through the dependency DAG weighted by
  task duration.

Computed on `compile_plan.py` output (`tasks`, `dag_edges`, `waves`); the
per-edge `why` labels in `dag_edges` (e.g. `write-after-write`,
`ambiguous-files`) drive S1's split between barrier-removal recovery and
same-file-edge-removal recovery. A completion-order fold replay (any sampled
order) exercises conflict outcomes; **structural bisection** — given an
injected "red" predicate over folded subsets — locates failing task sets by
subset folds and reports probe counts.

Output: one JSON result per plan plus a single roll-up markdown report across
the corpus (the operator's decision surface).

### 4. Replay corpus and runner — `evals/frontier/run_eval.py`

Corpus construction and the eval runner in one module. Three sources:

- **(a) Plan fixtures** — the six `evals/fixtures` repos that carry a
  `plan.md` (wide / chained / mixed / flawed / degrade / webapp), compiled and
  modeled. (`jsdeps` is excluded: it has no plan; it exists for harvester/AB
  tests.) Synthetic diffs are generated per task from the plan's declared file
  footprint (created files get generated content; shared-file edits get
  distinct-region function bodies). Because these fixtures' footprints are
  largely disjoint, track (a) primarily exercises RepoState plumbing and the
  makespan model; the K1 evidence weight is carried by tracks (b) and (c).
- **(b) Same-file parallelism synthetics** — scenarios ultraplan currently
  forbids: disjoint-function edits to one file, adjacent edits, delete/modify,
  add/add, N-way fan-in to one file. This track measures what relaxing the
  serialization rule would surface. Every conflicted case's verbatim narration
  is embedded in the roll-up report for operator grading (see S3).
- **(c) Archived real runs** — integration merge history on `main` (merge
  commits of `ultra/integration-*` branches and their recorded per-task merge
  commits) yields per-task diffs and orderings, re-folded in shuffled orders.
  Correctness bar: shuffled fold orders reproduce the tree the run actually
  shipped, manifest-identical (narrated conflicts are acceptable; *silent*
  divergence from the shipped tree is a kernel failure). Runs whose
  reconciliation history makes per-task diff extraction lossy are excluded
  **and named in the report** (no-silent-caps). The report states recovered-n;
  if fewer than **3** usable runs are recovered, K3 is reported **"not
  evaluated"** — never green by vacuity. Where archives carry task durations
  they feed the makespan model; otherwise durations are sampled and reported
  as modeled, not measured.

## Success criteria (fixed before building)

**Kernel track (hard gates):**

- K1. Order-independence: for every corpus case, all sampled fold orders (all
  permutations up to 4 tasks; ≥20 random shuffles above) produce identical
  manifests and identical conflict sets.
- K2. Subset soundness: sampled subsets fold without error, and fold is
  idempotent over them (re-folding any included task leaves the frontier's
  manifest and conflict set unchanged).
- K3. Real-run fidelity: replayed runs reproduce shipped trees with zero silent
  divergence — subject to the recovered-n ≥ 3 floor above.
- K4. Same-file synthetics: zero interleaving anomalies; every conflicted case
  yields a narration naming the incoming task and its action, with the opposing
  side labeled `frontier`.

**Scheduler track (measurement, not gate):**

- S1. Report the makespan-delta distribution (frontier vs waves) across the
  corpus, split into: recovery from barrier removal alone, and additional
  recovery from dropping same-file edges (identified by `dag_edges` `why`
  labels).
- S2. Bisection: for injected **single-task** failures, localization in ≤
  ⌈log₂ n⌉ subset probes (n = folded task count) — a hard gate. For injected
  **pairwise-interaction** failures, probe counts are measured and reported,
  with no numeric gate (minimal-set isolation is not log-bounded in general).
- S3. Narration legibility is **operator-graded**: the roll-up report embeds
  every track-(b) conflicted case's verbatim narration; the operator's grade is
  recorded in the results doc. Goal 1's "legibly" resolves through this grade,
  never through the probe's own assertion.

**Decision rule:** K1–K4 green and a material S1 delta → increment two (live-sync
probe or frontier engine) may be proposed. Any K failure or a dull S1 → shelve,
with the report as the recorded evidence either way. "Material" is deliberately
left to operator judgment over the report — this probe produces the
distribution and the graded narrations, not the verdict.

## Testing

`tests/test_frontier_kernel.py`, `tests/test_frontier_sim.py`:

- Vendor pin (sha256 of the patched file) + manyana's own suite wrapped; a
  parse check on the vendored file guards the 3.9+ compatibility claim.
- repo_weave: K1/K2 property tests on small constructed repos; file-level
  conflict classes; manifest round-trip; endpoint-diff semantics.
- Seeded randomness only (fixed seeds in tests) — CI determinism.
- schedule_model: waves-vs-frontier makespan on hand-computable DAGs; bisection
  probe-count gates on constructed single-task failures; pairwise measurement
  smoke.
- run_eval: smoke-run over the plan fixtures in CI; the archived-run replay is
  operator-run locally (repo history size makes it unsuitable for CI), with its
  report committed under `evals/frontier/results/` — following the existing
  committed-eval-results convention (`docs/superpowers/` A/B results).

## Risks

- `SequenceMatcher` diff quality bounds narration quality; acceptable for a
  probe, and a finding in itself if it dominates conflict noise (S3 will show
  it).
- Manyana's "too near" conflict heuristic may over/under-flag vs git; track (b)
  measures rather than assumes.
- Extracting per-task diffs from archived integration history may be lossy for
  runs that reconciled heavily; such runs are excluded by name, and K3 carries
  a recovered-n floor rather than greening on a thin corpus.
- The makespan model is a model: it assumes task durations are
  schedule-independent (no contention effects). Reported as such.

## Trim review

*Author's Adds/Removes disclosure (input to the reviewer, not a verdict):*

- **Adds:** one vendored public-domain file (one documented compatibility
  patch, sha256-pinned) + `PROVENANCE.md`; 3 eval modules under
  `evals/frontier/`; 2 test files; a committed `results/` directory (existing
  convention). No CI changes; no `skills/` changes.
- **Removes:** nothing yet — this is a probe whose purpose is to justify (or
  kill) a later structural subtraction (wave barriers, same-file serialization,
  ancestry apparatus). `complexityEffect`: additive (eval-only, quarantined
  from the shipped engine); claimed path to `structural`/`simplification` only
  via increment two, gated on this probe's numbers.

*Reviewer: fresh-context subagent (agent ad0fa2a21effa761f), inputs = spec,
originating-proposal text (spec §Origin/§Background), trim-review doctrine,
and the referenced code surfaces. Full verdicts below; grade at end.*

**Trims — adopt-or-answer:**

1. *Event-driven simulator is closed-form arithmetic under the spec's own
   assumptions.* **Adopted.** `sim_scheduler.py` renamed/narrowed to
   `schedule_model.py`: two pure makespan functions + fold replay + bisection.
2. *`included()` is one equality, not an API operation.* **Adopted.** Dropped
   from the API; K2 restated as fold idempotency. (The future-engine inclusion
   check remains an increment-two concept.)
3. *`corpus.py` + `run_frontier_eval.py` should be one module.* **Adopted.**
   Merged into `run_eval.py`; the disclosure's "3 modules" is now true.
4. *Dual JSON+markdown per plan is duplicative.* **Adopted.** JSON per plan,
   one roll-up markdown (the operator surface).
5. *`materialize` disk writes are unnecessary for comparisons.* **Adopted with
   the reviewer's own rider:** comparisons are in-memory manifest equality;
   the disk writer is retained solely for failure artifacts, and the spec now
   says so.

**Under-specification — adopt-or-answer:**

1. *Vendored kernel doesn't parse below Python 3.12; CI pins 3.11 — verbatim
   vendor + CI coverage cannot both hold.* **Adopted (the review's best
   catch; independently reproduced on Python 3.9).** Resolution: single
   documented compatibility patch at vendor time; pin covers the patched file;
   PROVENANCE.md records upstream sha + patch hunk; CI stays 3.11; a parse
   check guards 3.9+.
2. *K4's "names the tasks involved" requires frontier-side provenance no
   component provides.* **Adopted.** K4 weakened to incoming-task attribution
   with the opposing side labeled `frontier`; per-line provenance explicitly
   deferred to increment two (Non-goals).
3. *"Legibly" was gameable/auto-green.* **Adopted.** New S3: verbatim
   narrations embedded in the report; operator grades; grade recorded.
4. *S2's log-bound was imprecise and false for interaction failures.*
   **Adopted.** Gate restricted to single-task failures at ⌈log₂ n⌉; pairwise
   measured, ungated.
5. *"Five fixtures" — seven exist.* **Adopted.** Corpus = the six plan-bearing
   fixtures including `webapp`; `jsdeps` excluded with stated reason.
6. *K3 could green on a near-empty corpus; extraction mechanism unnamed.*
   **Adopted.** Recovered-n reported; floor of 3 usable runs else "not
   evaluated"; mechanism named (integration merge history on `main`).
7. *Track (a) is near-vacuous at the weave level; synthetic diff content
   unspecified.* **Adopted.** Content specified; track (a)'s role honestly
   restated as plumbing + makespan coverage, with K1 weight on (b)/(c).

**Scope reconciliation — adopt-or-answer:**

1. *Module count understated (4 vs "~3").* **Adopted** — resolved by trim 3.
2. *Hidden CI interpreter bump.* **Adopted** — designed away by the vendor
   patch (under-spec 1); Non-goals now states CI is unchanged.
3. *Committed operator-run results are a new convention.* **Answered:** the
   convention exists — A/B eval results are committed docs
   (`docs/superpowers/`); this follows it, and the disclosure names it.

**Reviewer's netConceptDelta grade: `up`** — "a bounded, deliberately-purchased
up": real new vocabulary (weave, RepoState, fold, corpus tracks, criteria),
nothing removed yet, fully quarantined in `evals/`, purchased explicitly as
evidence toward a much larger contingent subtraction that this spec correctly
does not propose. Recorded as graded; the operator adjudicates.
