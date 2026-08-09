# Frontier kernel + scheduler simulation — design

**Date:** 2026-08-09
**Status:** draft (pre trim-review)
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
weave layer and a barrier-free scheduler — as an offline simulation, and measures
them against real and fixture workloads. No engine change is proposed here; the
outcome of this probe decides whether one is ever proposed.

## Goal

Answer two questions with numbers:

1. **Kernel correctness:** does a repo-level weave layer over manyana merge real
   ultrapowers workloads correctly (order-independent, subset-sound) and legibly
   (usable conflict narration)?
2. **Scheduling gain:** how much wall-clock does barrier-free DAG scheduling
   recover over wave barriers on real and fixture plan shapes — including the
   width recovered by relaxing the same-file serialization rule?

## Non-goals

- No change to `skills/` — no harness JS (hence no `.mjs` sim obligation), no
  prompt re-baking, no frozen verification periphery, no plugin version bump.
- No agents dispatched; no LLM calls; no Anthropic API (repo rule).
- No production merge engine, no live-sync protocol, no rename tracking beyond
  delete+add, no binary-file merging (both-modified binaries are auto-conflicts).
- Not a decision to adopt manyana. The deliverable is the measurement report.

## Where it lives

`evals/frontier/` — the eval quarter of the repo. Tests land in `tests/` so the
ordinary suite and CI cover them. Pure Python 3, stdlib only.

## Components

### 1. Vendored kernel — `evals/frontier/vendor/manyana.py`

Verbatim copy, public domain, provenance noted in a sidecar
`evals/frontier/vendor/PROVENANCE.md` (upstream URL + commit sha). Frozen by a
sha256 pin test; changes only by deliberate re-vendor with the pin updated in
the same commit. Manyana's built-in `test*` functions are wrapped so pytest
discovers and runs them.

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
  merge one task in. Line-level conflicts carry manyana's annotated blocks with
  sides relabeled to task IDs. File-level conflict classes: add/add with
  differing content, delete/modify. Identical add/add folds clean.
- `included(frontier, task) → bool` — the idempotency inclusion check:
  folding an already-included task leaves the frontier unchanged. This is the
  structural analogue of the engine's `merge-base --is-ancestor` assertion.
- `materialize(state, dir)` — write the visible tree to disk.
- Subset folds: any subset of TaskStates over a common base folds to a
  well-defined RepoState (used by bisection and by the partial-adoption claim).

### 3. Scheduler simulation — `evals/frontier/sim_scheduler.py`

Event-driven replay, no wall-clock sleeping. Inputs: a compiled plan (reusing
`skills/ultrapowers/scripts/compile_plan.py` output for tasks/edges/waves), a
per-task duration, and a per-task diff (TaskState). Two modeled executions of
the same plan:

- **Waves mode:** tasks barrier-synchronized per the compiled waves; wave
  makespan = max task duration in wave; merges fold at each barrier.
- **Frontier mode:** each task starts the instant its dependencies' states are
  published; the integrator folds states in completion order; makespan = DAG
  critical path.

Additional behavior under test: **structural bisection** — given an injected
"red" predicate over folded subsets (simulating a failing suite), locate the
minimal failing task combination by subset folds, and report probe count.

Output: one JSON + markdown report per plan: both makespans, fold outcomes,
conflict count/narrations, bisection traces.

### 4. Replay corpus — `evals/frontier/corpus.py` + `run_frontier_eval.py`

Three sources, increasing realism:

- **(a) Fixture plans** — the five `evals/fixtures` repos (wide / chained /
  mixed / flawed / degrade), compiled and simulated with synthetic diffs
  matched to each plan's declared file footprint.
- **(b) Same-file parallelism synthetics** — scenarios ultraplan currently
  forbids: disjoint-function edits to one file, adjacent edits, delete/modify,
  add/add, N-way fan-in to one file. This track measures what relaxing the
  serialization rule would surface, and grades narration quality on the cases
  that conflict.
- **(c) Archived real runs** — past integration branches in this repo's history
  record each task's merge; per-task diffs and orderings are extracted from
  that history and re-folded. Correctness bar: shuffled fold orders reproduce
  the tree the run actually shipped, byte-identical (narrated conflicts are
  acceptable; *silent* divergence from the shipped tree is a kernel failure).
  Where run archives carry task durations, they feed the makespan model;
  otherwise durations are sampled and reported as modeled, not measured.

## Success criteria (fixed before building)

**Kernel track (hard gates):**

- K1. Order-independence: for every corpus case, all sampled fold orders (all
  permutations up to 4 tasks; ≥20 random shuffles above) produce byte-identical
  materialized trees and identical conflict sets.
- K2. Subset soundness: sampled subsets fold without error and `included` is
  sound/complete over them (no false inclusion, no false exclusion).
- K3. Real-run fidelity: replayed runs reproduce shipped trees with zero silent
  divergence.
- K4. Same-file synthetics: zero interleaving anomalies; every conflicted case
  yields a narration that names the tasks and actions involved.

**Scheduler track (measurement, not gate):**

- S1. Report the makespan-delta distribution (frontier vs waves) across the
  corpus, split into: recovery from barrier removal alone, and additional
  recovery from same-file parallelism (edges dropped).
- S2. Bisection localizes injected failing combinations in ≤ ⌈log₂⌉-bounded
  subset probes on the corpus cases.

**Decision rule:** K1–K4 green and a material S1 delta → increment two (live-sync
probe or frontier engine) may be proposed. Any K failure or a dull S1 → shelve,
with the report as the recorded evidence either way. "Material" is deliberately
left to operator judgment over the report — this probe produces the
distribution, not the verdict.

## Testing

`tests/test_frontier_kernel.py`, `tests/test_frontier_sim.py`:

- Vendor pin (sha256) + manyana's own suite wrapped.
- repo_weave: K1/K2 property tests on small constructed repos; file-level
  conflict classes; `materialize` round-trip; endpoint-diff semantics.
- Seeded randomness only (fixed seeds in tests) — CI determinism.
- sim_scheduler: waves-vs-frontier makespan on hand-computable DAGs; bisection
  on constructed failure predicates.
- corpus: smoke-run over the fixture repos in CI; the archived-run replay is a
  script the operator runs locally (repo history size makes it unsuitable for
  CI), with its report committed under `evals/frontier/results/`.

## Risks

- `SequenceMatcher` diff quality bounds narration quality; acceptable for a
  probe, and a finding in itself if it dominates conflict noise.
- Manyana's "too near" conflict heuristic may over/under-flag vs git; track (b)
  measures rather than assumes.
- Extracting per-task diffs from archived integration history may be lossy for
  runs that reconciled heavily; such runs are reported as excluded, never
  silently skipped (no-silent-caps rule).
- The makespan model is a model: it assumes task durations are
  schedule-independent (no contention effects). Reported as such.

## Trim review

*Author's Adds/Removes disclosure (input to the reviewer, not a verdict):*

- **Adds:** one vendored public-domain file (frozen by pin); ~3 new eval
  modules under `evals/frontier/`; 2 new test files; a results directory.
- **Removes:** nothing yet — this is a probe whose purpose is to justify (or
  kill) a later structural subtraction (wave barriers, same-file serialization,
  ancestry apparatus). `complexityEffect`: additive (eval-only, quarantined
  from the shipped engine); claimed path to `structural`/`simplification` only
  via increment two, gated on this probe's numbers.

*Reviewer verdicts and grade: pending dispatch.*
