# Frontier production test — shadow fold + live contended A/B — design

**Date:** 2026-08-11
**Status:** operator-approved in brainstorm; awaiting trim review
**Acceptance:** suite — dev tooling in `evals/frontier/` and `tests/`; the live
cells are runtime deliverables, like every eval run.
**Origin:** operator adjudication of
`evals/frontier/results/2026-08-10-readjudication.md` — S1 judged material
(41% same-file recovery on the contended fixture, modeled durations), which
per the increment-one decision rule unlocks this increment. Operator directive:
proceed toward a production test; staged shadow-then-live; build the AI
resolver now.

## Background

Increment one (`2026-08-09-frontier-kernel-sim-design.md`) proved the manyana
kernel offline: K1–K4 green, 16 archived runs replayed manifest-identical, and
a 41% makespan recovery on the one genuinely contended fixture — with modeled
durations, synthetic replay, and no resolver. Three gaps stand between that
report and a credible adoption case:

1. **Real-run coverage is retrospective and extraction-limited.** History
   replay excluded 20 runs; a shadow that consumes each run's recorded
   `heads/` sidecars needs no extraction semantics at all.
2. **The 41% is modeled.** No task has ever actually run in parallel with
   another task editing the same file; durations were sampled.
3. **The resolver is hypothetical.** The thesis's strongest claim — narrated
   conflicts are a better LLM input than git conflict markers — has never
   produced a resolution that a held-out suite then graded.

This increment closes all three, without touching the engine.

## Goal

Answer, with recorded evidence:

1. **Shadow:** does the weave layer reproduce a *freshly finished* real run's
   shipped tree from its recorded task endpoints, byte-for-byte, with zero
   silent divergence?
2. **Live:** when the contend fixture's three same-file tasks genuinely run in
   parallel — real implementer agents, manyana-authoritative merging, resolver
   on narrated conflicts — does the folded tree pass the fixture's sealed
   suite, and what is the *measured* wall-clock delta against the unmodified
   engine building the same plan?

## Non-goals

- No change to `skills/` — no harness JS (no `.mjs` sim obligation), no prompt
  re-baking, no hook or SKILL.md edits, no plugin version bump, no frozen
  verification periphery.
- No engine "frontier mode": arm B is a purpose-built eval driver. Engine
  integration is the *next* increment, proposable only if this one passes.
- No rename tracking beyond delete+add, no binary merging, no per-line
  frontier blame — inherited increment-one limits, unchanged.
- No multi-fixture live corpus: one contended fixture, one cell per arm
  (n=1 mechanics hard-gate; speed/quality advisory — subtraction-eval
  doctrine).
- The resolver is a test instrument, not a shipped engine component.

## Where it lives

`evals/frontier/` plus `tests/`. New: `shadow_fold.py`,
`run_frontier_cell.py`, `references/resolver-prompt.md`. Modified:
`repo_weave.py` (#132 fix only). Pure Python 3 stdlib; LLM work rides
headless Claude Code exactly as the A/B kit does (no Anthropic SDK, no API
key — repo rule).

## Components

### 1. Deterministic conflict reporting — the #132 fix (built first)

`repo_weave.fold`'s conflict *reports* vary with fold order at 3+ writers per
path (multiset arity; delete-vs-modify labeling), while manifests and conflict
*sets* stay order-independent. The resolver consumes these reports, so they
must be canonical. The fix normalizes at reporting time: conflicts for a path
are aggregated over the full fold sequence and emitted as a canonical set —
sorted by `(path, region-anchor, kind)`, one entry per distinct conflicted
region, labels derived from the region's final constituent actions rather
than fold-arrival order. The 12/400 failing fuzz seeds recorded in #132 become
committed regression tests; the K1 fuzz re-runs green. Merge behavior is
untouched — this is reporting shape only.

### 2. Shadow fold — `evals/frontier/shadow_fold.py`

CLI: `python3 shadow_fold.py <run-dir>` where `<run-dir>` is a
`.claude/ultrapowers/run-<stamp>/` directory carrying `heads/` sidecars
(`task-N`, `wave-N` shas) — present on every waves-engine run since the
sidecar mechanism shipped. For each wave, oldest first:

- **Base derivation (derive-don't-record):** wave k>1 folds against
  `heads/wave-(k-1)`. For wave 1, walk first-parent from `heads/wave-1`: a
  commit whose second parent is a recorded wave-1 `task-N` head is one of
  the wave's merges; once every wave-1 task head has been consumed, the next
  first-parent is the base (robust even when the base is itself a merge
  commit). Non-merge commits encountered on any wave's first-parent span are
  reconciliation events and fold as pseudo-tasks, reusing the K3 extraction
  semantics verbatim — the sidecars remove the *wave-grouping* inference
  (the lossy part that excluded 20 runs), not the reconciliation handling.
  Sanity invariant, checked before any fold: every `task-N` head is an
  ancestor of its wave head; violation aborts the shadow with a named error
  (never a silent skip).
- **Fold:** snapshot the base, publish each task head's endpoint diff,
  fold in ≥20 shuffled orders (all permutations at ≤4 tasks), assert
  manifest-identity across orders (K1 discipline) and byte-identity against
  the shipped `heads/wave-N` tree.
- **Report:** per-wave verdict (`clean` / `divergent` / `conflicted`), every
  narration verbatim, and — durations: per-task wall-clock from the run's
  workflow journal when the transcript dir is available, else committer
  timestamps on the task branches; the source is labeled per task. The
  makespan model re-runs with these measured durations.

Output: `evals/frontier/results/<date>-shadow-<stamp>.md` + JSON. The script
is read-only toward the repo (worktree-free; contents via `git show`).

### 3. Live A/B — arm A unchanged, arm B `run_frontier_cell.py`

Both arms build `evals/fixtures/contend` from the same engine ref, via the
kit's `prepare_cell` (engine worktree, seal install, project clone, workflow
seeding, session config — the #139 extraction).

**Arm A** is an ordinary kit cell: the unmodified engine builds the plan with
its same-file serialization (waves `[[1,4],[2],[3]]`). No new code.

**Arm B** replaces `drive_run` with the frontier driver:

- **Schedule:** compile the plan in the cell; drop exactly the edges whose
  `dag_edges` `why` label is `write-after-write` or `ambiguous-files`; keep
  marker and interface edges. Ready tasks dispatch immediately —
  no wave barriers.
- **Implementers:** one headless Claude Code session per task (the kit's
  launch pattern), in a per-task worktree branched from the fixture base,
  fed the task's plan body; must commit its work. Endpoint diff = branch
  HEAD vs base.
- **Fold-on-completion:** as each task finishes, `publish` + `fold` into the
  frontier. Clean fold → continue. Narrated conflict → resolver (component
  4). Fold order is completion order; the final manifest is additionally
  re-folded in 20 shuffles as a live K1 check.
- **Materialize and gate:** write the final manifest to a branch in the cell
  repo; run the fixture's sealed acceptance suite against it
  (exit-code authority, 9/9 expected).
- **Measure:** wall-clock per task and end-to-end for both arms; peak
  parallelism observed in arm B.

**Serialization with real work:** cells run in cloned sandbox repos under the
kit's isolation and credential-scrub windows; the ultrapowers checkout is
never a workbench. The two arms run sequentially (clean wall-clock
comparison on one machine).

### 4. Resolver agent — `evals/frontier/references/resolver-prompt.md`

Dispatched by the arm-B driver per narrated conflict:

- **Input (JSON):** the canonical conflict report (component 1), the
  narration block with its task labels, ±30 lines of folded context, and the
  colliding tasks' plan bodies.
- **Output contract (strict JSON):** `{"resolvedLines": [...]}` for the
  conflicted region only. No tools, no repo access, no shell — a pure
  text-to-JSON call (headless, structured output).
- **Splice-back:** the driver replaces the conflicted region's lines with
  `resolvedLines` via `update_state` on the folded file — mechanical, no
  agent judgment in the splice.
- **Guardrails:** one retry on contract violation; second violation parks
  that path as recorded evidence (hard gate 3). Every narration, resolver
  transcript, and resolution is stored verbatim in the report for operator
  grading. The sealed suite backstops resolution *quality*: a
  plausible-but-wrong resolution reds the gate.

## Success criteria (fixed before building)

**Hard gates — any red stops the experiment with a written report:**

- **G1 (shadow fidelity):** ≥1 real multi-task run shadowed with zero silent
  divergence: all fold orders manifest-identical to each other and
  byte-identical to every shipped wave tree. Narrated conflicts that git
  merged silently are reported, and do not red the gate — divergence does.
- **G2 (live mechanics):** arm B completes; the folded tree passes the
  contend sealed suite (exit 0, 9/9); the live K1 shuffle check holds on the
  final fold.
- **G3 (resolver honesty):** every conflict either resolves within contract
  or parks with the violation recorded — no silent fallback, no unreported
  drop (no-silent-caps).

**Operator-judged evidence — measured, never gated:**

- **E1:** wall-clock arm A vs arm B, plus the measured-duration makespan
  model from the shadow stage (replaces the modeled 41%).
- **E2:** every conflict narration and resolution verbatim; the operator's
  grade is recorded in the results doc (S3 discipline — never
  self-asserted).

**Decision rule:** G1–G3 green **and** the operator judges E1 material
**and** grades E2 acceptable → the engine-integration increment (frontier
mode in the shipping engine) may be proposed. Any gate red, or a dull E1, or
a failing E2 grade → stop; the report is the record either way.

## Error handling

- A dead, hung, or non-committing implementer parks its task; disjoint tasks
  continue; the report names every parked task and why.
- Shadow aborts loudly on sidecar/ancestry violations (never guesses a
  base).
- Resolver failures follow G3 — park and record.
- Kit-level failures (auth, seeding) surface exactly as the existing A/B
  kit surfaces them; `prepare_cell`'s fail-closed seeding applies to both
  arms.

## Testing

All committed tests run in the ordinary suite and CI:

- `tests/test_repo_weave_report_determinism.py` — the #132 seeds as
  regressions; canonical-report shape pins.
- `tests/test_shadow_fold.py` — replay against a synthetic `run-<stamp>`
  directory (fabricated repo with two waves incl. one multi-task wave);
  ancestry-violation abort; duration-source labeling.
- `tests/test_frontier_cell.py` — edge-drop rule (drops only
  `write-after-write`/`ambiguous-files`, keeps marker/interface edges);
  fold-on-completion ordering; resolver splice-back with a fake resolver;
  contract-violation → retry → park.
- Live cells and the shadow of a real run are runtime deliverables recorded
  in `evals/frontier/results/`, not CI.

## Trim review

Pending — this section records the adversarial trim rounds and their
adopt-or-answer dispositions before operator review.
