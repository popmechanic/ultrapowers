# Frontier production test — shadow fold + live contended A/B — design

**Date:** 2026-08-11
**Status:** trim rounds 1–9 adopted; round 10 expected terminal / operator review
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

1. **Shadow:** does the weave layer reproduce a real run's shipped tree
   from its recorded task endpoints — manifest-identical under the layer's
   normalization, zero silent divergence?
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

- Make the **K1 comparison set-based** — the issue's own recorded smaller
  candidate. The defect is the comparison, not the accumulation:
  manifests and conflict-*sets* were order-independent in every fuzz
  (0/400); only the *multiset* flipped (12/400). `conflict_keys` (and the
  test helpers' `assert_order_independent`) compare sorted lists retaining
  duplicates against `Conflict`'s declared set-shaped `(path, kind)`
  identity; the fix makes the outcome key a set. `fold`'s per-call return
  is untouched — every consumer (including the arm-B driver's per-fold
  stream) keeps the full narration record; nothing is discarded from the
  S3-graded list.
- The delete/modify kind-flip (29/500) **appears already fixed on main**:
  the committed base-derived `_text_kind` is exactly the fix the module
  docstring documents, pinned by the existing order-independence tests.
  So: commit the 29/500 seed set as a regression **expected to pass**;
  code changes only if a seed still fails — never by reintroducing a
  frontier-derived relabel, the order-sensitive move the code comment
  warns against. The 12/400 set pins the set-comparison fix the same way.
- Fold in the issue's two presentation nits, explicitly in scope: the
  lone-type-change asymmetry, and the "text wins the manifest" narration
  being wrong when the text side is a folded whole-file delete.

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
  `.claude/ultrapowers/run-<stamp>/` directory. The head source is the
  run's **finalized report(s)**, not the raw `heads/` slots:
  `finalize_report.py` copies the sidecar-derived shas into the report
  fail-loud *before* `redirect_args.py` clears `heads/` on a redirect
  relaunch, and its own comments name the report as the durable record.
  **Discovery rule (trimmed to what the artifacts show):** the head source
  is `<run-dir>/report.json`, with `--report` as the explicit override;
  nothing else in the dir is read (every raw saved result on disk —
  `workflow-result*.json` and kin — is token-reported, the exact artifact
  class this sourcing excludes). A run dir with **no** `report.json`
  parks by name as unshadowable (the SDD/inline-drain blind spot #141
  already names). Filename is **not** provenance — finalize leaves no
  stamp, and one on-disk `report.json` was never finalized and carries a
  fabricated sha tail — so the load-bearing authority is the **fail-loud
  sha-resolution + ancestry check on the selected file**, which catches
  exactly that case: any failure aborts/parks by name. **The report's
  role is exactly four things:** chain bounding, the ancestry invariant,
  task labeling, and per-wave head identification for the duration
  harvest. Only
  `status == "MERGED"` wave entries are consumed (non-MERGED headShas are
  token-reported, not file-derived).
- **Redirect-bearing runs, named posture:** pre-redirect launches are not
  recoverable from finalized reports — `redirect_args.py` deletes their
  sidecars, and the on-disk evidence shows only the final launch
  finalized. Shadow therefore covers **the final launch's finalized report
  only**, and parks every earlier launch by name as an unfinalized
  fragment — never a silent fragment claimed as the run. (No stitching
  machinery; there is nothing durable to stitch from.)
- **Chain bounding, not base derivation:** shadow's walker only *bounds*
  the integration chain — tip = the last MERGED wave head; **the lower
  bound is one rule with a named fallback:** the first two-parent merge's
  merge-base when the report-bounded walk finds one (this is the floor,
  and it keeps pre-first-merge chain commits — the engine fast-forwards
  the first branch of every wave — in `_group_chain`'s hands), else the
  earliest MERGED wave head's parent (the merge-free case, which records
  the inherited "no per-task merges" exclusion; per-task durations are
  still harvested — head identification from the report, committer times
  from git). The bounded `[(sha, parents)]` chain goes to the reused
  `_group_chain`, whose merge-base grouping is the sole authority for
  **both wave base and fold membership**: the same rule every K3 number
  used. Shadow defines no base or membership rule of its own; the
  report's `branches` field labels tasks, never selects them.
- **Fast-forwarded waves need no apparatus of their own.** A single-task
  wave fast-forwards, leaving a single-parent chain commit — exactly the
  shape the inherited #133 semantics already handle, field-validated
  across the 16 K3 runs: absorbed by the next merge wave's base when its
  merge-base contains it (the common case), folded as a named
  reconciliation pseudo-task otherwise, or trailing-cut by name after the
  last merge. An all-FF chain has no two-parent merge and hits the
  existing named exclusion ("no per-task merges — nothing to replay").
  Every disposition is named — no silent fragments — and nothing gateable
  is lost: G1's two-endpoint floor below never counted FF-wave rows.
  (Rounds 3–6 accreted a segmentation rule, an FF fold fallback, a wave-1
  park, and a two-branch floor clause here; round 7 deleted the cluster
  as machinery ahead of need.)
- **Ancestry invariant**, checked before any fold: every reported task
  head is an ancestor of its wave head; violation aborts the shadow with a
  named error (never a silent skip, never a guessed base).
- **Durations:** per-task wall-clock from committer timestamps for
  **every MERGED task in the report** — the duration harvest never needed
  the fold, so FF-wave tasks are included — as the interval from the
  prior wave head's (or chain floor's) committer time to the task tip's
  committer time — the earliest wave's interval starts at the walk's
  lower bound's committer time — reported as approximate; a task whose
  tip sits at or below the walk's lower bound reports duration
  unavailable rather than a degenerate zero. The makespan model re-runs
  with them.
  Reconciliation pseudo-tasks get no duration and are excluded
  from the re-model (they are merge machinery, not scheduled work),
  noted in the report. Journal parsing is deferred unless the first shadow
  report shows timestamps too crude to inform E1 (machinery earned by
  recurrence).
- **Report:** `evals/frontier/results/<date>-shadow-<stamp>.md` + JSON:
  per-item disposition (`clean` / `divergent` / `conflicted` per wave;
  `absorbed` / `trailing-cut` per reconciliation event; `excluded` per
  run — congruent with the inherited dispositions the tests assert),
  every narration verbatim, the measured-duration makespan re-model.

**Target run and freshness:** shadow the next real waves-engine run in this
repo (drain or single-plan). The finalized reports are durable, so there is
no sidecar race; the only freshness requirement is that the run's commits
remain reachable (shadow before branch pruning, or on the merged history).
The script is read-only toward the repo (worktree-free; contents via
`git show`).

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
  preflight runs before the real cell, probing **the launch-instant shape
  at its real width — four concurrent trivial implementer-shaped calls,
  each inside its own concurrently-created worktree, each committing**
  (dropping contend's edges frees all four tasks at t=0; a resolver only
  runs after a completion, so it never coexists with all four and is
  subsumed); preflight failure parks the arm with the named reason.
- **Fold-on-completion:** as each task finishes, `publish` + `fold` into the
  frontier (the increment-one API). Clean fold → continue. Narrated
  conflict → resolver (component 4). Fold order is completion order.
  **Resolver dispatches are serial** — at most one in flight — so arm B's
  peak session width is ≤4 by construction even when a single fold
  narrates multiple conflicted paths (implementer-footprint drift); the
  event log still records what happened rather than assuming it.
- **Live K1 check, resolution-aware:** two legs. (1) Shuffled re-folds of
  the raw task set (via the reused `sampled_orders`/`fold_all` — the same
  sampling policy as every prior K1 number) are outcome-identical **to each
  other** (manifest + conflict set; resolutions excluded — raw folds can
  never equal a resolver-modified state). (2) **Deterministic event-log
  replay:** the driver records the actual completion-order sequence of fold
  and resolution events as it runs; re-running that exact sequence must
  reproduce the shipped manifest. The log also records, rather than
  legislates, whether folds paused during resolver calls — the replay
  checks what the driver actually did.
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
- **Dispatch predicate:** the resolver dispatches only on conflicts that
  **carry manyana's annotated block narration**; any conflict without one
  (binary, presence-kind one-liners) has no visible-line list for
  `resolvedFileLines` to mean anything, and parks with the reason recorded
  (G3). One rule, no kind-list to keep in sync.
- **Application validity (the one live race):** a resolution applies only
  if **no intervening fold touched its path** since the narration was
  taken; otherwise the driver re-narrates against the current frontier —
  by re-folding the conflicting endpoint idempotently (the K2 discipline:
  refold conflicts are a subset) and dispatching the fresh narration — or
  parks. Without this, a whole-file resolution computed from an older
  narration would overwrite a newer fold's contribution — and the event
  log's deterministic replay would faithfully reproduce the loss, since it
  checks determinism, not correctness.
- **Guardrails:** one retry on contract violation; second violation parks
  that path as recorded evidence (hard gate 3). Every narration, resolver
  transcript, and resolution is stored verbatim in the report for operator
  grading. The sealed suite backstops resolution *quality*: a
  plausible-but-wrong resolution reds the gate.

## Success criteria (fixed before building)

**Hard gates — any red stops the experiment with a written report:**

- **G1 (shadow fidelity):** ≥1 real run shadowed with zero silent
  divergence, **including at least one wave that folds ≥2 task endpoints**
  (a true two-parent merge wave; reconciliation pseudo-tasks and FF-wave
  rows do not count toward the floor — all-FF runs accumulate into
  results but do not satisfy it): all fold
  orders outcome-identical to each other, and every clean path (touched −
  conflicted, the K3 discipline) manifest-identical — under the weave
  layer's text normalization, manifest-to-manifest, never
  manifest-to-blob — to the shipped wave tree. Narrated conflicts that git
  merged silently are reported and do not red the gate; divergence does.
- **G2 (live mechanics):** arm B completes; the folded tree passes the
  contend sealed suite (exit 0, 9/9); the resolution-aware live K1 check
  holds (shuffled raw folds outcome-identical to each other; the recorded
  fold/resolution event log replays deterministically to the shipped
  manifest).
- **G3 (resolver honesty):** every conflict either resolves within contract
  or parks with the violation recorded — no silent fallback, no unreported
  drop (no-silent-caps). G3 is an *honesty* gate, not a quality gate:
  G3-green means nothing was hidden, not that resolutions were correct —
  correctness is the sealed suite's job (G2) and the grade is the
  operator's (E2).

**Operator-judged evidence — measured, never gated:**

- **E1:** wall-clock arm A vs arm B. Intervals pinned: arm A from cell
  launch to its pre-merge gate reporting ready; arm B from cell launch to
  sealed-suite pass. **Named confound:** arm B dispatches no per-task
  reviewer and no redirect loop, so the delta bundles (barriers removed +
  same-file edges dropped) *with* (review removed); the frontier thesis
  claims only the former. The report separates what it can (per-task
  implementation spans vs arm A's, both measured by the same
  committer-timestamp technique) and names what it cannot. The shadow
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

- `tests/test_repo_weave_report_determinism.py` — both #132 seed sets as
  regressions (12/400 pinning the set-based comparison; 29/500 expected
  to pass against the already-committed `_text_kind`); the two
  presentation-nit fixes.
- `tests/test_shadow_fold.py` — replay against a synthetic `run-<stamp>`
  directory (fabricated repo + `report.json`, two waves incl. one
  multi-task wave and one reconciliation commit); the **pre-first-merge
  reconciliation case** (non-merge commit between fork and wave-1's first
  merge — the case a naive chain walk mis-bases); a **mixed chain**
  (true-merge waves beside FF waves) and a fast-forward-only chain, each
  asserting the inherited **named dispositions** (absorbed / pseudo-task /
  trailing-cut / "no per-task merges"); the FF-task duration harvest and
  pseudo-task exclusion from the re-model (one assertion each);
  MERGED-only scoping; the no-report park and the fabricated-tail abort;
  final-launch-only shadow of a redirect-bearing run with the named park;
  ancestry-violation abort.
- `tests/test_frontier_cell.py` — edge-drop pinned to
  `schedule_model.SAME_FILE_WHYS` (imported, not re-typed);
  fold-on-completion ordering; resolver **whole-file application** with a
  fake resolver, including a file carrying two conflicted blocks in one
  narration; the resolution-aware live K1 check (shuffles identical to
  each other + deterministic event-log replay); **the application-validity
  race** (a fake-resolver case injecting an intervening fold on the
  narrated path between narration and application — must re-narrate or
  park, never apply stale); serial resolver dispatch; no-narration-kind
  park; contract-violation → retry → park; the oversize-file park.
- Existing `run_eval` tests pin that the refactor-to-importable changes no
  replay behavior — **except** the intended #132 comparison change: the
  K1 outcome key and the test helpers' order-*comparison* go set-based.
  Exact-count expectations that are order-independent by construction
  (the `len(candidates) − 1` conflict-count pins) are **preserved** as
  single-canonical-order assertions, never dropped — #132 never impugned
  the counts, only the 3+-writer multiset flip. Affected assertions are
  updated with the fix, named in its commit.
- Live cells and the shadow of a real run are runtime deliverables recorded
  in `evals/frontier/results/`, not CI.

## Trim review

**Author disclosure (Adds/Removes, refreshed after round 7):** Adds —
shadow front-end over the existing replay internals; frontier driver +
resolver (directive scope); #132 fix; measured-duration re-model
(invited-adjacent: the re-adjudication named "or measured durations");
peak-parallelism bookkeeping (minor, near-free); and from the review rounds:
the launch-instant concurrency preflight (four implementer-shaped calls in
concurrently-created worktrees), serial resolver dispatch, the 400-line
resolver cap, the dedicated branch writer, the final-launch-only redirect
posture with named parks (no-report, unshadowable dirs), the
`report.json`-only discovery with the sha/ancestry check as authority,
MERGED-only scoping, the recorded fold/resolution event log (a new durable
artifact) with its deterministic replay, and the resolution
application-validity rule. Removes — the rounds-3–6 FF apparatus
(segmentation rule, FF fold fallback, wave-1 park, floor clause), deleted
in round 7 in favor of the inherited #133 dispositions. Otherwise
quarantined in `evals/`, purchased against the structural subtraction the
frontier line exists to earn.

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

### Round 2 (fresh-context reviewer; grade: `netConceptDelta` **up** — "adopting findings 1 and 2 makes it a *smaller* up: each deletes a duplicate rule or a fragile data source")

Verdict: not yet at diminishing returns — two round-1 adoptions (T2's
literal reuse and the base-derivation text) were mutually inconsistent, and
the code showed the sidecar walk wrong on real history.

- **F1 (two contradictory base rules; the sidecar walk mis-bases on
  pre-first-merge reconciliation commits — verified against the
  `ultra/integration-20260731-155401` chain):** **ADOPTED.** Shadow's
  walker only bounds the chain; `_group_chain`'s merge-base grouping is the
  sole base authority; both duplicate base sentences deleted; the
  pre-first-merge reconciliation case added to `test_shadow_fold.py`.
- **F2 (`heads/` is redirect-fragile — `redirect_args.py` deletes it on
  every same-run relaunch; `report.json` is the durable, fail-loud record
  and also carries wave membership):** **ADOPTED.** Head source is now the
  finalized report(s); redirect-bearing runs stitch or park as partially
  shadowable with the fragment named; freshness caveat shrunk; the
  wave-membership under-specification closes via `waveMerges[].branches`.
- **F3 (per-call `(path, kind)` dedupe in `fold` is a no-op against the
  cross-fold multiset flip; delete-kind fix specified only by reference;
  writers-cap lift missing):** **ADOPTED.** Dedupe moved to the
  accumulation site; the driver's consumption of the pre-dedupe per-fold
  stream made explicit; the committed seed sets named as the contract for
  the delete/modify kind-flip; the writers-cap lift added to the test
  plan.
- **F4 (live K1 undefined once a resolver has intervened — raw shuffles
  can never equal a resolver-modified state):** **ADOPTED**, in the
  stronger form: shuffles outcome-identical to each other, plus recorded
  resolutions re-applied per conflicted path converge to the shipped
  manifest. G2 restated to match.
- **F5 (whole-file contract silent on non-text conflict kinds):**
  **ADOPTED.** Non-text kinds park with reason recorded; resolver
  dispatches only on kernel-narrated text conflicts.
- **F6 (stale "splice-back" vocabulary from the deleted region design):**
  **ADOPTED.** Renamed to whole-file application throughout.
- **Bookkeeping (author disclosure predated round 1's own additions):**
  **ADOPTED.** Disclosure refreshed.

### Round 3 (fresh-context reviewer; grade: `netConceptDelta` **up** — "adopting Findings 1–3 and 6 makes it a *sounder* up at roughly flat delta")

Verdict: not yet at diminishing returns — two round-2 adoptions failed
against real artifacts (the reviewer verified all seven on-disk
`report.json` files and the most recent run's chain shape).

- **F1 (`_group_chain` blind to fast-forwarded waves — the most recent
  real run's chain is all single-parent FF commits, so the sole authority
  recovers zero waves):** **ADOPTED**, option (b): a named single-task FF
  fallback (fold the wave's one reported endpoint against the prior wave
  head), keeping `_group_chain` sole authority for multi-task waves; FF
  chain added to the test plan.
- **F2 (the convergence leg false-reds on the happy path — a clean fold
  after a resolution isn't in the recorded resolution's whole-file line
  list):** **ADOPTED.** Leg 2 replaced with deterministic event-log
  replay (the actual completion-order fold/resolution sequence re-runs to
  the shipped manifest); G2 restated; the log records fold/resolve
  synchrony instead of legislating it.
- **F3 (report `branches` reintroduced a second membership authority):**
  **ADOPTED.** Report role narrowed to bounding + ancestry + labeling;
  membership from `_group_chain` (or the F1 fallback) alone.
- **F4 (finalized-report discovery unpinned; filenames and envelope
  shapes drift in real run dirs):** **ADOPTED.** Discovery rule named
  (any JSON with `waveMerges`, both envelope shapes, `--report`
  override); ancestry + sha resolution authenticate; both shapes in the
  test fixture.
- **F5 (ancestry invariant scoped to MERGED entries — non-MERGED shas
  are token-reported):** **ADOPTED.** MERGED-only consumption, stitching
  included.
- **F6 (non-text kind enumeration wrong in detail — text-side
  delete/modify also lacks blocks):** **ADOPTED.** Enumeration deleted;
  dispatch predicate = carries manyana's annotated block narration.
- **F7 (dedupe keep-policy):** **ADOPTED.** First occurrence kept,
  reason recorded.
- **F8 (duration interval unnamed):** **ADOPTED.** Wave-base committer
  time → task-tip committer time.
- **Under-specification (resolver dispatch synchrony):** subsumed by F2's
  event log, per the reviewer's own note.

### Round 4 (fresh-context reviewer; grade: `netConceptDelta` **up** — "findings 1–3 delete machinery rather than add it")

Verdict: not yet at diminishing returns — two round-3 adoptions
contradicted a third and one round-2 adoption; both failures demonstrated
on the on-disk run artifacts.

- **F1 (FF fallback vs report-role narrowing mutually inconsistent;
  mixed merge/FF chains are the real shape — `run-20260731-155401` has
  both, and `_group_chain` would cut the FF wave as trailing):**
  **ADOPTED.** Explicit composition rule: segment the bounded chain at the
  report's MERGED headShas; merge-bearing segments → `_group_chain`
  unchanged; single-parent segments ending at a reported head → FF
  fallback; other shapes park. Report role restated as four things.
- **F2 (discovery rule authenticates raw token-reported results — a
  verified raw file passes sha + ancestry; duplicates double-shadow;
  abort semantics backwards):** **ADOPTED.** Discovery now enumerates →
  dedupes identical `waveMerges` → selects the finalized output
  (`report.json`, `--report` override); raw results are non-candidates;
  exclusion-by-name for non-selected failures; abort reserved for the
  selected candidate.
- **F3 ("one finalized report per gate" factually false on the only
  redirect-bearing run on disk — pre-redirect waves are never recoverable
  finalized):** **ADOPTED** as a trim: stitching machinery deleted;
  final-launch-only shadow + earlier launches parked by name.
- **F4 (FF fallback hollows G1 — an all-FF 3-task run satisfies the
  letter while exercising zero multi-writer folds):** **ADOPTED.** G1 now
  requires ≥1 shadowed wave folding ≥2 endpoints; all-FF runs accumulate
  but do not satisfy the floor.
- **F5 (disclosure stale again):** **ADOPTED.** Refreshed with round-3/4
  additions.
- **F6 (minors):** **ADOPTED.** "Freshly finished" trimmed; the
  `run_eval` no-behavior-change pin carves out the intended #132
  reporting change; reconciliation pseudo-tasks excluded from the
  duration re-model; G3 explicitly labeled an honesty gate, not a quality
  gate; the concurrency preflight extended to concurrent worktree
  add/commit.

### Round 5 (fresh-context reviewer; grade: `netConceptDelta` **up** — "adopting F2 and F4 makes it a smaller up: deletes three standing concepts")

Verdict: not clean — F1–F5 change mechanisms, contracts, or test seams;
the reviewer verified every reuse claim against code (F7: all confirmed)
and every artifact claim against the on-disk run dirs.

- **F1 (a wave-1 FF segment has no derivable prior head — base branch
  names move, and the only all-FF finalized run on disk hits exactly
  this):** **ADOPTED.** Wave-1 FF segments park by name; the chain floor
  is the first merge-bearing segment's merge-base. Costs nothing against
  G1, whose floor FF waves never satisfy anyway.
- **F2 (set-based K1 comparison beats accumulation-site dedupe — the
  issue's own recorded smaller candidate; deletes the keep-policy, the
  pre-dedupe-stream carve-out, and an S3 narration-loss regression):**
  **ADOPTED, reversing the round-3 F3/F7 shape.** The comparison
  (`conflict_keys`, `assert_order_independent`) goes set-based; `fold`'s
  per-call return untouched; recorded narrations get richer, not poorer.
- **F3 (the delete/modify kind-flip appears already fixed on main — the
  issue text is stale against the committed base-derived `_text_kind`;
  the bullet as written invited re-breaking it with a frontier-derived
  relabel):** **ADOPTED.** The 29/500 seed set lands as a regression
  expected to pass; code changes only if a seed still fails. The
  writers-cap-lift item dropped (the committed cap is scoping, not
  pending).
- **F4 (discovery-rule machinery is dead on the real artifacts — the
  candidate set is always `{report.json}`; and "the file finalize_report
  rewrote" is an undetectable provenance overclaim, proven by an on-disk
  never-finalized `report.json` with a fabricated sha tail):**
  **ADOPTED.** Discovery trimmed to `report.json` + `--report` override;
  the fail-loud sha/ancestry check named as the load-bearing authority
  (it catches the fabricated-tail case).
- **F5 (no-`report.json` run dirs — six exist on disk — had undefined
  behavior):** **ADOPTED.** They park by name as unshadowable (the #141
  blind spot).
- **F6 (do reconciliation pseudo-tasks count toward G1's floor?):**
  **ADOPTED.** They do not; the floor counts task endpoints.
- **Under-spec (resolution application race — an intervening fold on the
  same path between narration and application would be silently
  overwritten, and the event-log replay would faithfully reproduce the
  loss):** **ADOPTED.** Application-validity rule added: apply only if no
  intervening fold touched the path; else re-narrate or park.
- **Under-spec (preflight width below arm B's real peak):** **ADOPTED.**
  Preflight matches actual peak width (three implementers + resolver).

### Round 6 (fresh-context reviewer; grade: `netConceptDelta` **up** — "corrections, not shrinkage; deliberately purchased and honestly disclosed")

Verdict: nearly clean — no redesigns; four corrections, two touching a
mechanism or test seam. The reviewer explicitly verified round 5's
reversal left no orphaned text, re-confirmed the fabricated-tail sha on
disk, and validated the application-validity rule's composition with the
event log.

- **F1 (preflight still one short: contend's compiled DAG frees all
  *four* tasks at t=0 once same-file edges drop — task 4 has no edges at
  all; the real launch instant is four concurrent sessions + four
  concurrent worktree creations, probed together):** **ADOPTED.**
  Preflight restated as the launch-instant shape at real width; resolver
  overlap subsumed (it never coexists with all four).
- **F2 (set-based helper change would silently delete the
  `len(candidates) − 1` conflict-count pins #132 never impugned):**
  **ADOPTED.** Order-*comparison* goes set-based; exact-count pins
  preserved as single-canonical-order assertions.
- **F3 (chain-floor "i.e." undefined on all-FF chains G1 explicitly
  admits):** **ADOPTED.** Floor clause extended: no merge-bearing
  segment → earliest reported MERGED wave head (wave 1 itself parks).
- **F4 (disclosure stale, third occurrence):** **ADOPTED.** Refreshed
  through round 6, including the application-validity rule. The
  re-narration mechanism got its one clause (idempotent re-fold, the K2
  discipline).
- **Adjudicated no-change:** resolver authority (whole-file contract
  structurally bounds authority to the conflicted path; pre/post diff
  outside conflicted blocks would be machinery ahead of need at n=1 with
  verbatim recording); correct-but-token-reported shas passing the
  authority check is the stated authority model, not a gap.

### Round 7 (fresh-context reviewer; grade: `netConceptDelta` **up** — "adopting F1 makes it a materially smaller up: deletes the shadow stage's largest concept cluster")

Verdict: no correctness defect found anywhere — every reuse, artifact,
and width claim verified against code and the on-disk runs. One
mechanism-by-deletion finding, one test seam, two one-clause tightenings.

- **F1 (the FF apparatus — segmentation rule, FF fold fallback, wave-1
  park, two-branch floor clause — is machinery ahead of need: the
  inherited #133 semantics already absorb/pseudo-task/trailing-cut FF
  commits, field-validated across the 16 K3 runs, and G1's own floor
  declares FF folds un-gateable; rounds 3→6 each patched the previous
  round's FF machinery — the accretion loop the doctrine warns against):**
  **ADOPTED — the cluster is deleted.** Shadow bounds the chain and hands
  it to `_group_chain`, full stop; FF commits flow through the inherited
  named dispositions; durations for FF-wave tasks come from the report's
  labels (the harvest never needed the fold). The honest trade recorded:
  per-FF-wave "clean" verdict rows become "absorbed"/"nothing to replay" —
  rows that could never gate.
- **F2 (floor-clause ambiguity dropping derivable FF waves silently):**
  moot by F1 — the clause no longer exists; the defect is inexpressible.
- **F3 (the application-validity rule — "the one live race" — had no
  covering test):** **ADOPTED.** Fake-resolver case injecting an
  intervening fold between narration and application added to
  `test_frontier_cell.py`'s plan.
- **F4 (peak-width subsumption assumed ≤1 resolver in flight without
  legislating it — one fold can narrate multiple paths under footprint
  drift):** **ADOPTED.** Resolver dispatches are serial; peak width ≤4 by
  construction; the event log still records rather than assumes.
- **Minors:** duration re-model + pseudo-task-exclusion assertions added
  to the shadow test plan; E1's arm-A spans named as the same
  committer-timestamp technique; results-doc location already covered by
  the `evals/frontier/results/` convention.
- **Both standing under-spec seams re-adjudicated no-change** (resolver
  authority; concurrent cells), concurring with round 6.

### Round 8 (deletion-confirmation; grade: `netConceptDelta` **up** — "the smallest up of any round: shadow's concept load is now genuinely inherited")

Verdict: **the round-7 deletion is CONFIRMED SOUND** — the reviewer traced
both ground-truth chains commit-by-commit through `_group_chain` (mixed
chain: FF'd task-1 folds as a named pseudo-task, trailing FF wave
trailing-cuts by name; all-FF chain: lands in the named "no per-task
merges" exclusion; zero silent fragments) and verified G1's floor is
realistically satisfiable (23/46 reopen wave groups fold ≥2 endpoints).
The fabricated-tail sha was re-verified and found sharper than stated:
only the *task* sha is fabricated, the wave shas resolve — confirming the
per-task-head authority check is load-bearing. Serial dispatch and the
application-validity rule were confirmed complementary, not redundant.
Five one-clause residue findings, all adopted:

- **F1 (stale "wave-head segmentation" in the report-role list — the
  deleted round-4 authority):** **ADOPTED.** Renamed to per-wave head
  identification for the duration harvest (what actually remains).
- **F2 (chain floor undefined on all-FF chains; the named exclusion was
  unreachable through the stated bounding):** **ADOPTED.** Walk bounded
  below by the earliest MERGED wave head's parent; merge-free bounded
  chain → the inherited exclusion, durations still harvested; the floor
  exists only on merge-bearing chains.
- **F3 (report verdict enum lagged the dispositions):** **ADOPTED.**
  Per-wave disposition vocabulary extended to include absorbed /
  trailing-cut / excluded.
- **F4 ("FF folds are near-tautological" is false for the pseudo-task
  shape the mixed run exhibits):** **ADOPTED.** Justification replaced:
  FF-wave rows never counted toward the floor.
- **F5 (zero-interval duration degenerate when a task tip sits at the
  chain floor):** **ADOPTED.** Reports duration unavailable.

### Round 9 (fresh-context reviewer; grade: `netConceptDelta` **up** — "adopting F1 is concept-neutral-to-down: walk bound and floor merge into one rule")

Verdict: not clean, but the two findings are the last residue of a single
round-8 adoption (its walk bound), both demonstrated on on-disk chains,
both one-sentence fixes. Full-pass verification found everything else
clean, including a re-verification of the fabricated-tail sha and a third
consecutive no-change concurrence on both standing under-spec seams.

- **F1 (round-8's walk bound orphans pre-first-merge chain commits on
  merge-bearing chains — the engine FFs the first branch of every wave,
  so the first wave's first task would silently drop out of `touched` on
  the common shape; round 8's own confirmation trace had used the
  pre-round-8 bound):** **ADOPTED.** The lower bound is one rule with a
  named fallback: the first two-parent merge's merge-base when one
  exists (keeping pre-first-merge commits in `_group_chain`'s hands),
  else the earliest MERGED wave head's parent (the merge-free case).
  Walk bound and floor collapse into one rule; round-2 F1, round-8 F2,
  and the test plan become mutually consistent.
- **F2 (merge-free chains: the earliest wave's duration interval start
  was undefined, so the merge-free harvest promise was aspirational):**
  **ADOPTED.** The earliest wave's interval starts at the walk's lower
  bound's committer time; the unavailable clause re-anchored to the
  lower bound.
- **Minors:** disposition granularity labeled per unit (wave /
  reconciliation event / run); "harvested from the report" tightened to
  head-identification-from-report, committer-times-from-git.
