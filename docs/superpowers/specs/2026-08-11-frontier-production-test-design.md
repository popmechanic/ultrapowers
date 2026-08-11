# Frontier production test — shadow fold + live contended A/B — design

**Date:** 2026-08-11
**Status:** trim round 1 adopted; awaiting further rounds / operator review
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
   `heads/` sidecars needs no wave-grouping inference at all.
2. **The 41% is modeled.** No task has ever actually run in parallel with
   another task editing the same file; durations were sampled.
3. **The resolver is hypothetical.** The thesis's strongest claim — narrated
   conflicts are a better LLM input than git conflict markers — has never
   produced a resolution that a held-out suite then graded.

This increment closes all three, without touching the engine.

## Goal

Answer, with recorded evidence:

1. **Shadow:** does the weave layer reproduce a *freshly finished* real run's
   shipped tree from its recorded task endpoints — manifest-identical under
   the layer's normalization, zero silent divergence?
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
`repo_weave.py` and `run_eval.py` (#132 fix + refactor-to-importable of the
existing replay internals; behavior pinned by existing tests). Pure Python 3
stdlib; LLM work rides headless Claude Code exactly as the A/B kit does (no
Anthropic SDK, no API key — repo rule).

## Components

### 1. Deterministic conflict reporting — the #132 fix (built first)

`repo_weave.Conflict` already declares its identity as `(path, kind)`
(`__eq__`/`__hash__`); the #132 false-reds arise because `run_eval`'s K1
comparison treats conflicts as an order-sensitive *multiset*, and because of
the delete-vs-modify pairing transition at 3+ writers. The fix is the
issue's own recorded candidates, nothing more:

- Dedupe `fold`'s returned conflicts on the declared `(path, kind)` identity
  (chosen over changing the comparison side: every consumer then sees the
  canonical shape).
- Apply the pairing-transition treatment for text deletes named in the
  issue.
- Fold in the issue's two presentation nits, explicitly in scope: the
  lone-type-change asymmetry, and the "text wins the manifest" narration
  being wrong when the text side is a folded whole-file delete.
- Commit both recorded failing seed sets (12/400 multiset; 29/500
  delete/modify) as regression tests; the K1 fuzz re-runs green.

No new reporting vocabulary: no regions, no anchors, no aggregation pass.
The resolver (component 4) consumes the existing whole-file narration, which
already marks every conflicted block; in arm B the fold order is completion
order — a fact of the run, not a sampled choice — so per-event narration is
already canonical for its consumer. Merge behavior is untouched.

### 2. Shadow fold — `evals/frontier/shadow_fold.py`

A **thin front-end to the existing replay machinery** — `run_eval`'s
`_group_chain` (reconciliation pseudo-task coalescing/absorption/
trailing-cut) and `_replay_group` (snapshot/publish, `sampled_orders` +
`fold_all`, K1 outcome-set check, K2 refold, clean = touched − conflicted
bookkeeping, manifest-normalized divergence comparison), refactored to
importable form where needed, behavior unchanged. Reuse is a code fact, not
a prose promise; the recursion-headroom guard (`_recursion_headroom`) and
the manifest-vs-manifest comparison discipline are inherited, not
re-implemented.

What shadow adds — the only new machinery:

- **CLI:** `python3 shadow_fold.py <run-dir>` where `<run-dir>` is a
  `.claude/ultrapowers/run-<stamp>/` directory carrying `heads/` sidecars
  (`task-N`, `wave-N` shas).
- **Base derivation (derive-don't-record):** wave k>1 folds against
  `heads/wave-(k-1)`. For wave 1, walk first-parent from `heads/wave-1`: a
  commit whose second parent is a recorded wave-1 `task-N` head is one of
  the wave's merges; once every wave-1 task head has been consumed, the
  next first-parent is the base (robust even when the base is itself a
  merge commit). Non-merge commits on any wave's first-parent span fold as
  reconciliation pseudo-tasks via the reused `_group_chain` semantics.
- **Ancestry invariant**, checked before any fold: every `task-N` head is
  an ancestor of its wave head; violation aborts the shadow with a named
  error (never a silent skip, never a guessed base).
- **Durations:** per-task wall-clock from committer timestamps on the task
  branches (always present in the data shadow already reads), reported as
  approximate; the makespan model re-runs with them. Journal parsing is
  deferred unless the first shadow report shows timestamps too crude to
  inform E1 (machinery earned by recurrence).
- **Report:** `evals/frontier/results/<date>-shadow-<stamp>.md` + JSON:
  per-wave verdict (`clean` / `divergent` / `conflicted`), every narration
  verbatim, the measured-duration makespan re-model.

**Target run and freshness:** shadow the next real waves-engine run in this
repo (drain or single-plan), running `shadow_fold.py` before any subsequent
launch — `redirect_args.py` clears prior launches' sidecars, so the window
closes at the next launch. The script is read-only toward the repo
(worktree-free; contents via `git show`).

**Fidelity floor:** G1's floor is one run, down from K3's three. Defended,
not just asserted: K3's floor guarded against extraction lossiness in the
wave-grouping inference; sidecars record the grouping directly, so the
vacuity risk the floor addressed is gone. Additional runs accumulate into
the results dir as they occur, but do not gate.

### 3. Live A/B — arm A unchanged, arm B `run_frontier_cell.py`

Both arms build `evals/fixtures/contend` from the same engine ref, via the
kit's `prepare_cell` (engine worktree, seal install, project clone, workflow
seeding, session config — the #139 extraction). The two arms run
sequentially on one machine for a clean wall-clock comparison; cells run in
cloned sandbox repos under the kit's isolation and credential-scrub windows;
the ultrapowers checkout is never a workbench.

**Arm A** is an ordinary kit cell: the unmodified engine builds the plan with
its same-file serialization (waves `[[1,4],[2],[3]]`). No new code.

**Arm B** replaces `drive_run` with the frontier driver:

- **Schedule:** compile the plan in the cell; drop same-file edges via
  `schedule_model.drop_same_file_edges` — the **same constant**
  (`SAME_FILE_WHYS = {write-after-create, write-after-write,
  ambiguous-files}`) that computed the modeled 41%, imported, never
  re-typed; keep marker and interface edges. Ready tasks dispatch
  immediately — no wave barriers.
- **Implementers:** one headless Claude Code session per task (the kit's
  launch pattern), in a per-task worktree branched from the fixture base,
  fed the task's plan body; must commit its work. Endpoint diff = branch
  HEAD vs base. Concurrent `claude -p` sessions under the cell's one
  throwaway `CLAUDE_CONFIG_DIR` is an intended-and-probed pattern: a cheap
  preflight (two trivial concurrent headless calls) runs before the real
  cell; preflight failure parks the arm with the named reason — nothing in
  the kit has run them concurrently before.
- **Fold-on-completion:** as each task finishes, `publish` + `fold` into the
  frontier (the increment-one API). Clean fold → continue. Narrated
  conflict → resolver (component 4). Fold order is completion order; the
  final state is additionally re-folded in shuffled orders via the reused
  `sampled_orders`/`fold_all` — the same sampling policy as every prior K1
  number, not a re-implementation — as a live K1 check.
- **Materialize and gate:** write the final manifest to a branch via a
  dedicated writer in the driver — a temp worktree plus `git add`/`commit`
  — not `repo_weave.materialize`, whose failure-artifact-only contract is
  untouched. Then run the fixture's sealed acceptance suite against the
  branch (exit-code authority, 9/9 expected).
- **Measure:** wall-clock per task and end-to-end for both arms, with the
  intervals pinned in E1; peak parallelism observed in arm B (near-free
  driver bookkeeping, disclosed as a minor addition).

### 4. Resolver agent — `evals/frontier/references/resolver-prompt.md`

Dispatched by the arm-B driver per narrated conflict, inside the cell's
environment (the same throwaway config and credential window as the
implementers; the scrub window closes only after the last resolver call):

- **Input (JSON):** the conflict's `(path, kind)`, the **whole annotated
  narration for the file** (manyana's marked blocks, task-labeled), and the
  colliding tasks' plan bodies.
- **Output contract (strict JSON):** `{"resolvedFileLines": [...]}` — the
  **complete visible line list for the file**. Whole-file in, whole-file
  out: `update_state(state, resolvedFileLines)` applies it directly, so
  there is no narration-region→visible-lines mapping seam where a plausible
  resolution could silently corrupt neighboring lines. Files above 400
  visible lines park instead of dispatching (contend's files are far
  smaller; the cap bounds the contract, and a parked oversize file is
  honest evidence).
- **No tools, no repo access, no shell** — a pure text-to-JSON call
  (headless, structured output).
- **Guardrails:** one retry on contract violation; second violation parks
  that path as recorded evidence (hard gate 3). Every narration, resolver
  transcript, and resolution is stored verbatim in the report for operator
  grading. The sealed suite backstops resolution *quality*: a
  plausible-but-wrong resolution reds the gate.

## Success criteria (fixed before building)

**Hard gates — any red stops the experiment with a written report:**

- **G1 (shadow fidelity):** ≥1 real multi-task run shadowed with zero silent
  divergence: all fold orders outcome-identical to each other, and every
  clean path (touched − conflicted, the K3 discipline) manifest-identical —
  under the weave layer's text normalization, manifest-to-manifest, never
  manifest-to-blob — to the shipped wave tree. Narrated conflicts that git
  merged silently are reported and do not red the gate; divergence does.
- **G2 (live mechanics):** arm B completes; the folded tree passes the
  contend sealed suite (exit 0, 9/9); the live K1 shuffle check holds on the
  final fold.
- **G3 (resolver honesty):** every conflict either resolves within contract
  or parks with the violation recorded — no silent fallback, no unreported
  drop (no-silent-caps).

**Operator-judged evidence — measured, never gated:**

- **E1:** wall-clock arm A vs arm B. Intervals pinned: arm A from cell
  launch to its pre-merge gate reporting ready; arm B from cell launch to
  sealed-suite pass. **Named confound:** arm B dispatches no per-task
  reviewer and no redirect loop, so the delta bundles (barriers removed +
  same-file edges dropped) *with* (review removed); the frontier thesis
  claims only the former. The report separates what it can (per-task
  implementation spans vs arm A's) and names what it cannot. The shadow
  stage's measured-duration makespan re-model rides alongside as the
  confound-free advisory number.
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
- Resolver failures follow G3 — park and record. Oversize files park per
  the 400-line cap.
- Kit-level failures (auth, seeding) surface exactly as the existing A/B
  kit surfaces them; `prepare_cell`'s fail-closed seeding applies to both
  arms.

## Testing

All committed tests run in the ordinary suite and CI:

- `tests/test_repo_weave_report_determinism.py` — both #132 seed sets
  (12/400, 29/500) as regressions; `(path, kind)` dedupe pins; the two
  presentation-nit fixes.
- `tests/test_shadow_fold.py` — replay against a synthetic `run-<stamp>`
  directory (fabricated repo with two waves incl. one multi-task wave and
  one reconciliation commit); the wave-1 base walk incl. a merge-commit
  base; ancestry-violation abort.
- `tests/test_frontier_cell.py` — edge-drop pinned to
  `schedule_model.SAME_FILE_WHYS` (imported, not re-typed);
  fold-on-completion ordering; resolver whole-file splice-back with a fake
  resolver, including a file carrying two conflicted blocks in one
  narration; contract-violation → retry → park; the oversize-file park.
- Existing `run_eval` tests pin that the refactor-to-importable changes no
  replay behavior.
- Live cells and the shadow of a real run are runtime deliverables recorded
  in `evals/frontier/results/`, not CI.

## Trim review

**Author disclosure (Adds/Removes):** Adds — shadow front-end over the
existing replay internals; frontier driver + resolver (directive scope);
#132 fix; measured-duration re-model (invited-adjacent: the re-adjudication
named "or measured durations"); peak-parallelism bookkeeping (minor,
near-free). Removes — nothing; quarantined in `evals/`, purchased against
the structural subtraction the frontier line exists to earn.

### Round 1 (fresh-context reviewer; grade: `netConceptDelta` **up** — "deliberately-purchased, quarantined in evals/, adopting T1–T4 shaves three to four concepts")

- **T1 (#132 fix over-designed — region/anchor vocabulary not in the code):**
  **ADOPTED.** Component 1 narrowed to the issue's recorded candidates:
  `(path, kind)` dedupe, pairing-transition treatment, both seed sets as
  regressions. Region/anchor/aggregation vocabulary deleted.
- **T2 (shadow re-specifies `_group_chain`/`_replay_group` — make reuse
  literal):** **ADOPTED.** Shadow is now specified as a thin front-end over
  the refactored-to-importable replay internals; recursion-headroom and
  manifest-comparison discipline inherited.
- **T3 (edge-drop rule drifted to two labels vs the three-label
  `SAME_FILE_WHYS` that priced the 41%):** **ADOPTED.** Single source:
  `schedule_model.drop_same_file_edges`/`SAME_FILE_WHYS`, imported by the
  driver and pinned by the test.
- **T4 (dual duration sources are machinery ahead of need):** **ADOPTED.**
  Committer timestamps only, labeled approximate; journal parsing deferred
  by recurrence.
- **T5 (name the fold-side reuse in the live K1 check):** **ADOPTED.**
  `sampled_orders`/`fold_all` named.
- **T6 (keeps: resolver scope, arm A untouched, n=1, G/E shape, error
  posture, sequential arms, peak parallelism):** no action required; peak
  parallelism disclosed in the author disclosure per the scope
  reconciliation.
- **U1 (splice-back region mapping unspecified — the silent-corruption
  seam):** **ADOPTED, by redesign.** The resolver contract is now
  whole-file-in/whole-file-out (`resolvedFileLines`), applied via
  `update_state` directly — the region→visible-lines mapping seam no longer
  exists. A 400-visible-line cap bounds the contract; oversize parks. The
  fake-resolver test covers the two-blocks-in-one-narration case.
- **U2 (#132 presentation nits silently dropped):** **ADOPTED.** Both nits
  explicitly in scope in component 1.
- **U3 (recursion headroom omitted):** **ADOPTED** via T2 inheritance,
  stated explicitly.
- **U4 (byte-identity stronger than the machinery; conflicted-path
  exemption implicit):** **ADOPTED.** G1 restated as manifest-identity
  under the layer's normalization, clean = touched − conflicted stated.
- **U5 (arm A/B confound — arm B has no review loop; clock intervals
  undefined):** **ADOPTED.** E1 names the confound, pins both intervals,
  and designates the shadow re-model as the confound-free advisory number.
  A matching arm-B review stage was **answered** (not adopted): E1 is
  advisory, and adding review to arm B buys comparability at real cost
  while destroying the "what does the frontier shape alone cost" reading;
  the named confound plus per-task spans is the cheaper honest form.
- **U6 (`materialize` contract break):** **ADOPTED.** Branch-writing is a
  dedicated driver mechanism (temp worktree + git commit);
  `materialize`'s failure-artifact-only contract untouched.
- **U7 (which run / freshness window / floor-of-1 undefended):**
  **ADOPTED.** Next real run named as target; the sidecar-clearing
  freshness window stated; the floor drop defended on extraction-lossiness
  grounds.
- **U8 (resolver env / scrub window / concurrent headless sessions never
  probed):** **ADOPTED.** Resolver runs inside the cell env; scrub closes
  after the last resolver call; concurrency preflight added with
  park-on-failure.
- **Scope reconciliation:** expansions 2 (measured durations,
  invited-adjacent) and 4 (peak parallelism) disclosed above; expansion 1
  (canonical report format) deleted per T1; drift 5 fixed per T3; shrink 6
  fixed per U2.
