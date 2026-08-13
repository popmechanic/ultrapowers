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
   fold log — falling back to today's merge path on any guard or failure.
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
  not new capability.
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
  `skills/ultrapowers/kernel/`; their tests re-point.
- `evals/frontier/references/resolver-prompt.md` →
  `skills/ultrapowers/references/resolver-prompt.md` (rewritten for the
  file-read contract, §3) and baked into `waves.js` under
  `test_no_prompt_drift.py`.

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

**Canonical compile does not create `write-after-write` edges for eligible
pairs.** The drop happens **at construction** — the tier-3 loop skips the
edge — never by post-hoc filtering: later tiers (`ambiguous-files`,
catch-all) consult reachability through the accumulated adjacency, so an edge
removed after the fact would leave those tasks unordered against peers they
must still serialize behind. A test pins that an ambiguous/catch-all task
still serializes in a plan where a `write-after-write` edge was dropped.

Label semantics, stated precisely because the label is not the physics:

- The drop keys on the `write-after-write` label. Its overlap set is
  `(writes ∪ Test:)` on both sides — accepted conservatism — so pairs freed
  by the drop include pure reader/reader pairs sharing a fixture; that is a
  side effect, stated plainly, and safe (readers fold clean).
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

**Eligibility.** Two conditions, no more:

- `--serialize-overlaps` compiles with today's rule (the A/B's arm A and the
  escape hatch).
- A compile-time pre-filter keeps the serializing edge for a pair whose
  overlapped **written** paths (`writes ∩ writes`), where they exist in the
  repo, would already fail the kernel's own dispatch predicate — non-text
  content, or over `RESOLVER_LINE_CAP` (imported from the kernel, never
  re-typed), or a non-regular git object (symlink, gitlink, mode ≠ 100644/755
  — the fold manifest cannot represent them, §3). This is a scheduling
  heuristic — don't dispatch parallel work certain to park — not a safety
  guard: the runtime predicate (`dispatchable()`, and the materialization
  guard) remains authoritative for files tasks create or grow past the cap.

Every kept-for-eligibility pair gets a loud diagnostic naming the path and
reason (additive vocabulary, justified by this increment's A/B per the
freeze's own rule). A wave holding ≥2 tasks with overlapping writes is tagged
**contended** in the launch file with the overlap paths listed. Untagged waves
compile byte-identically to today.

### 2. Kernel module and fold CLI

`kernel/fold_wave.py` is a deterministic CLI (no LLM). Because each
invocation is a fresh process, **all state lives in git plus the fold log**,
and every invocation rehydrates before acting:

- **Rehydration rule:** replay `<runDir>/frontier/wave-<n>/fold_log.jsonl`
  from the recorded wave base — `fold` events recompute the task's endpoint
  diff from its recorded `headSha` (a pure function of git objects) and
  re-fold it; `resolve` events re-apply their recorded `lines`. Epoch = event
  count; the touched-path map rebuilds from the `paths` each fold event
  records. A test pins that fold → resolve → fold across three separate
  process invocations yields the same manifest as the same sequence in one
  process.
- **`fold` subcommand:** given wave base sha and the mergeable branches in
  completion order, folds each, appends `fold` events, and writes per
  conflict: the annotated narration to
  `frontier/wave-<n>/conflict-<i>.txt` and its `dispatchable()` verdict
  (park reason when ineligible) to the conflicts index. Runs the two live
  self-checks the cell ran — sampled raw fold orders outcome-identical, and
  log replay reproduces the manifest — and reports failure as a named
  fallback, never a silent pass. Kernel limits (recursion on ~1000-line
  files) are caught here and become parks.
- **`resolve` subcommand:** applies a whole-file resolution from a file of
  lines under epoch validity (an intervening fold on the path since the
  narration's epoch → stale, re-narrate once), appending the `resolve` event
  **with the lines** — the log alone must replay.
- **`materialize` subcommand:** applies **only the folded paths** onto the
  previous integration head (never a whole-tree rewrite — untouched paths
  keep their modes, symlinks, and gitlinks exactly because git never sees
  them), commits with parents = previous integration head + merged task
  heads, and writes the `heads/` slot. A folded path that cannot be
  represented as a regular blob is a named fallback.

**All CLI I/O is file-based** (#36: relaying structured payloads through
agent replies corrupts them). The CLI reads and writes under
`<runDir>/frontier/`; agents relay only paths, counts, and enum verdicts.

### 3. Engine: the contended merge path

For a contended wave, `mergeWave()` routes its **existing merge agent** (one
role, two paths — the contended branch is added to the merge agent's contract
in `references/wave-merge.md` and baked alongside `MERGE_PROMPT`) through the
frontier sequence:

1. The merge agent runs `fold_wave.py fold` and returns counts + verdicts +
   paths (small scalars only).
2. For each dispatchable conflict, `waves.js` dispatches **one resolver agent
   at a time** — prompt baked from `references/resolver-prompt.md`; the agent
   **reads its narration file itself** and writes its whole-file resolution
   to a reply file (this is a contract change from the cell's no-tools
   text-in/text-out resolver, and the promoted prompt is rewritten for it).
   A merge-agent call then runs `resolve`; stale → re-narrate once.
   Serialization is by construction: the loop awaits each resolution.
   Resolver calls are workflow-visible agents — in the progress tree, charged
   to the run budget, transcripts recorded verbatim in the report.
3. On success the merge agent runs `materialize`; sha/ancestry checks (the
   authority) see real ancestry, and `heads/` slots and review packets keep
   working.

**Fallback — always live, and honestly priced.** The fold consumes task
branches but never destroys them, so kernel error, ineligible conflict,
resolver parked after its retry, self-check failure, or materialization guard
all route the wave to the existing git-merge + reconcile path. But this is
**not** "today's behavior arrived at late": under today's rule these tasks
never ran concurrently, so the reconcile agent (two attempts, then
`blockedWaves`) is handed a multi-task same-file collision it was never built
for, with the parallel work already spent. The fallback's real cost is a wave
that can end blocked. Accordingly, **fallback rate on contended waves is a
pre-registered hard gate in the A/B (§6) and the production canary (§5)** —
not merely a named event. Every fallback appends a `fallback` event and
surfaces in `judgmentCalls`.

Task failure and review handling are unchanged: only mergeable results fold,
exactly as only mergeable results merge today.

### 4. Fold log schema (first-class contract)

One JSONL file per contended wave
(`<runDir>/frontier/wave-<n>/fold_log.jsonl`), self-sufficient for replay:

- `base {sha}` — first line, the wave base.
- `fold {task, headSha, paths}` — paths = the task's touched set (weaves ∪
  raw ∪ deleted), recorded so staleness rebuilds from the log.
- `conflict {path, kind, narrationFile, verdict}`.
- `resolve {path, epoch, lines}` — the lines themselves; replay consumes
  them (`frontier_fold.replay` takes lines, not hashes).
- `park {path, reason}` / `fallback {wave, reason}`.

`report.json` gains a `frontier` section per contended wave: fold-log path,
self-check results, resolver transcripts verbatim (the E2 grading surface),
parks, fallbacks. Schema documented in `kernel/FOLD_LOG.md`. No existing
report field changes shape.

### 5. Authoring: ultraplan relaxation, with a canary

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

### 6. The gating A/B and the shakedown

**Fixture:** `evals/fixtures/contend-prod/` — a realistic small application
where 4 independent tasks each deliver a real feature (multi-file, with
tests) and all modify one shared hot file (< `RESOLVER_LINE_CAP` lines).
**Production length, calibrated before the cells run:** each task is sized so
its implementer runs ≥ 5 minutes, and arm A end-to-end ≥ 30 minutes — the
regime where task work, not protocol fixed cost, dominates (the prior cell's
~40 s tasks are exactly what the adjudication said cannot answer E1). If a
calibration run misses those floors, the fixture is resized before any
counted cell. Like its fixture siblings it carries a **sealed acceptance
suite** (`test_fixture_seals.py` requires it): one seal-author dispatch at
fixture-build time, priced into the plan as a task, not discovered at gate
time.

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
- Any hard-gate red, or E1′/E2′ miss without a recorded overrule → the mode
  stays guarded off (`--serialize-overlaps` behavior remains the shipped
  default via the guard) and the result is recorded. Pass → release.

**Shakedown (non-gating):** before release, one real backlog plan authored
under the relaxed rule runs `/ultrapowers` end-to-end; its `frontier` report
section is operator-reviewed. Evidence, not a gate.

## Error handling

Stated per component above; the invariants: **every failure degrades through
a named event**, and the degradation target is the existing merge/reconcile
path — with its real cost stated in §3, not euphemized. A guarded compile is
byte-identical to today's. The engine never claims a fold succeeded without
the live self-checks; replay divergence is a fallback, not a warning.

## Testing

- **pytest:** edge-drop at construction (only `write-after-write` label
  dropped; semantic edges survive; ambiguous/catch-all tasks still serialize
  against peers whose overlap edge was dropped; promoted-interface pairs stay
  serialized and untagged; the pre-filter keeps edges for non-text /
  over-cap / non-regular existing paths with diagnostics;
  `--serialize-overlaps` reproduces today's compile byte-identically),
  contended tagging, fold CLI (rehydration across ≥3 process boundaries,
  epoch validity, self-checks, log replay, park reasons), materialization
  (folded-paths-only application; a fixture repo containing an executable
  file and a symlink outside the folded set survives with mode and link
  intact; non-regular folded path → named fallback). The promoted kernel
  modules' tests move with them; the vendor sha256 + parse pins re-point.
- **Harness sim:** `tests/frontier_merge.mjs` drives the contended path in
  `waves.js` with stubbed agents — clean fold, conflict→resolve,
  stale→re-narrate, park→fallback — and prints the `ALL SCENARIOS PASSED`
  sentinel (the suite-gate runs it on any harness JS change; a harness change
  with no covering sim fails the gate by design).
- **Prompt pins:** resolver prompt and the contended merge-agent contract
  enter `test_no_prompt_drift.py`; rubric mirror text pinned by
  `test_recommendation_rubric.py`.
- **Fixture seal:** `contend-prod` sealed and pinned like existing fixtures.

## Release

Minor bump (architectural): both manifests to the same version, standard
release commit. The verification periphery is untouched; compiler diagnostics
are additive and justified by the A/B measurement, per the freeze's own rule.

## Trim review

Author's disclosure — **Adds:** kernel module (promoted, not new code), fold
CLI + fold-log schema, contended branch of the existing merge agent,
resolver-as-agent loop, compiler construction-time edge-drop + pre-filter +
tag, `contend-prod` fixture (sealed), one `.mjs` sim, rubric/authoring text
updates + canary, ab_runner arm flag. **Removes:** the `write-after-write`
serialization default, `evals/frontier/` as the kernel's home, and — at
authoring time — the three documented same-file contortions.

### Round 1 (fresh-context reviewer; grade: `netConceptDelta` **up** — "nine adds against three removes; nothing makes an existing defect class inexpressible")

Fourteen findings; adopt-or-answer:

1. **Hash-only `resolve` events cannot replay** — ADOPTED. `resolve` carries
   `lines`; hash deleted; the log is self-sufficient (§4).
2. **Cross-process kernel state unspecified** — ADOPTED. Rehydration rule
   defined (git + fold log are the only state; epoch and touched-paths
   rebuild from the log); pinned by a three-process-boundary test (§2).
3. **Structured payloads through agent replies (#36)** — ADOPTED. All CLI
   I/O file-based; agents relay scalars; resolver reads its narration file
   itself; prompt-contract change from the cell's resolver stated (§2, §3).
4. **Whole-tree materialization destroys modes/symlinks/gitlinks** —
   ADOPTED. `materialize` applies folded paths only; non-regular paths guard
   at compile (pre-filter) and fold time; mode/symlink fixture added to
   testing (§2, §Testing).
5. **Python < 3.12 guard guards nothing** (vendor patch removed the PEP 701
   line; standing parse pin under the running interpreter) — ADOPTED,
   deleted.
6. **Guards duplicate `dispatchable()`; 400 re-typed** — ADOPTED. One
   pre-filter, explicitly a scheduling heuristic, importing
   `RESOLVER_LINE_CAP`; runtime predicate authoritative (§1).
7. **Post-hoc edge filtering breaks later compiler tiers** — ADOPTED. Drop
   at construction; ambiguous/catch-all serialization pinned by test (§1).
8. **`write-after-write` label ≠ "both write"** — ADOPTED. Label vs. overlap
   set defined; promoted-interface pairs stay serialized; reader/reader
   freeing stated plainly (§1).
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

Scope reconciliation, answered: expansions (1) north-star section and (2)
authoring relaxation are operator-directed and now say so in place; (3) the
fold-log contract is no longer under-built (findings 1–2); (4) vendored code
entering the shipped plugin is now enumerated with provenance/pin/link-check
handling (finding 13); (5) guard count reduced to the two load-bearing ones
(findings 5–6).
