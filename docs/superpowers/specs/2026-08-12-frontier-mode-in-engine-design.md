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
narrate conflicts to a serial whole-file resolver, and replay the event log
deterministically to the shipped tree. Measured: 41% same-file-edge recovery on
the contended fixture; barrier removal itself is worth only ~4.9% mean (max
21.7%) modeled — so this increment keeps waves and changes only what the
numbers justify: the serialization rule and the merge step for waves it
affects.

The corpus finding cuts both ways: real plans show `same_file_edges = 0`
because ultraplan's authoring rules steer authors away from contention — at a
documented authoring cost (unnatural task splits, chains-for-fans, Depends-on
declared for overlap alone, engine routing lost to doc-file collisions). The
engine capability and the authoring relaxation therefore ship **coupled**:
either alone is dead weight.

## Founding architecture (north star, not this increment's scope)

The fold engine and its event ledger are the engine's future coordination
core; git is the archive and audit anchor, not the coordination medium. The
ledger — fold events, narrations, resolutions with epochs, parks, fallbacks —
is the durable record: replaying it reproduces the shipped tree exactly (the
proven G2 property). This increment installs that core as a first-class module
with the wave engine as its **first caller**. Future increments it licenses,
each individually eval-gated: event-driven dispatch (waves dissolve),
replay-based pause/resume, sketch-not-code plan bodies. Nothing here builds
those; everything here is shaped so building them adds drivers rather than
migrating formats.

## Goal

1. Plans may declare genuinely independent tasks that edit the same files;
   the compiler schedules them concurrently and the engine folds their work,
   with conflicts narrated, resolved serially, and recorded in a replayable
   ledger — falling back to today's behavior on any guard or failure.
2. An engine-vs-engine A/B on a production-scale contended fixture, full
   protocol both arms (review on, gate on), closes token cost and
   production-length parallelism before release.

## Non-goals

- Event-driven scheduling, removal of waves, chunking, or barriers.
- Any change to worktree isolation, per-task review, integration review,
  redirect machinery, pause/resume, or the frozen verification periphery
  (gates, sealing).
- Kernel periphery expansion: binaries, files over the caps, renames. Guards
  route these to the existing path; they are not new capability.
- Frontier as default for non-contended waves (they keep the git-merge path).
- Redirect waves: hand-authored, stay serialized as today.

## Where it lives

- `skills/ultrapowers/kernel/` — **new, the founding module**: vendored
  `manyana.py` (+ PROVENANCE), `repo_weave.py`, `frontier_fold.py`, the ledger
  schema doc, and a fold CLI (`fold_wave.py`). Promoted from `evals/frontier/`;
  evals import from here afterward — one copy, never re-typed.
- `skills/ultrapowers/scripts/compile_plan.py` — edge-drop rule, eligibility
  guards, contended-wave tagging.
- `skills/ultrapowers/harnesses/waves.js` — contended branch in the merge
  step; resolver prompt baked from a new
  `skills/ultrapowers/references/resolver-prompt.md` (promoted from
  `evals/frontier/references/`).
- `skills/ultraplan/SKILL.md` + `hooks/session_start.sh` — authoring-rule and
  rubric updates (mirrored, pinned).
- `evals/fixtures/contend-prod/` — the production-scale contended fixture;
  `evals/ab_runner.py` grows the arm flag.

## Components

### 1. Compiler: the edge-drop rule and eligibility guards

**Canonical compile drops `write-after-write` edges** between otherwise
independent tasks. All semantic edges survive: `marker`, `text`, `interface`,
`prose-reference`, `write-after-create` (editing a file another task creates is
a real dependency — the base to edit against does not exist yet),
`read-after-write`, and `ambiguous-files` (unknown writes cannot be guarded).

Disclosure: the modeled rule (`schedule_model.SAME_FILE_WHYS`) also dropped
`write-after-create` and `ambiguous-files`. The engine rule is a strict,
deliberately conservative subset. On the contended fixture the two rules
coincide (all three dropped edges were `write-after-write`), so the measured
41% recovery transfers; the A/B re-measures under the engine's own rule
regardless. The engine rule is defined once in `compile_plan.py`; eval code
measuring the engine imports it.

**Serialization becomes a named guard, not the default.** The guard restores
the serializing edge, per overlapped pair, when any of:

- an overlapped path exists in the repo and exceeds **400 visible lines** (the
  resolver contract cap — a conflict there could not be dispatched);
- an overlapped path is non-text (binary overlap is kernel periphery);
- Python < 3.12 (manyana's PEP 701 floor) — disables the drop entirely;
- `--serialize-overlaps` is passed (the A/B's arm A, and the escape hatch).

Every guarded pair gets a loud diagnostic naming the file and reason
(additive vocabulary; the freeze permits it on these A/B numbers). A wave left
holding ≥2 tasks with overlapping writes is tagged **contended** in the launch
file, with the overlap paths listed. Untagged waves are byte-identical to
today's compile.

### 2. Kernel module and fold CLI

`kernel/fold_wave.py` (deterministic, no LLM): given the wave base sha, the
mergeable task branches, and a fold order (completion order as reported), it
computes per-task endpoint diffs, folds them via `FrontierEngine`, and writes
to the run dir: the ledger (JSONL events), and either a clean folded tree or a
conflicts file carrying each conflict's annotated narration plus its dispatch
verdict from `dispatchable()` (park reason when ineligible). It also runs the
two self-checks live, as the cell did: sampled raw fold orders
outcome-identical, and ledger replay reproduces the manifest. Either check
failing is a named fallback, never a silent pass. Runtime kernel limits
(recursion on ~1000-line files) are caught here and become parks.

A second entry point applies a resolution: whole-file lines in, epoch validity
enforced (an intervening fold on the path since narration → stale, re-narrate
once), ledger appended.

### 3. Engine: the contended merge path

For a contended wave, `mergeWave()` routes to the frontier path:

1. A **fold conductor** agent (cheap tier, like today's merge agent) runs the
   fold CLI and returns its structured result.
2. For each dispatchable conflict, `waves.js` dispatches **one resolver agent
   at a time** — prompt baked from `references/resolver-prompt.md`, narration
   inline — then a conductor call applies the reply under epoch validity.
   Stale → re-narrate once. Serialization is by construction: the loop awaits
   each resolution. Resolver calls are workflow-visible agents: in the
   progress tree, charged to the run budget, recorded verbatim in the report —
   never `claude -p` hidden inside a script.
3. On success the conductor **materializes** the folded tree as a merge commit
   on the integration branch: parents = previous integration head + the merged
   task heads, so sha/ancestry checks (the authority) see real ancestry and
   `heads/` slots and review packets keep working.

**Fallback, always live:** the fold consumes task branches but never destroys
them. Kernel error, ineligible conflict, resolver parked after its retry,
self-check failure, or materialization error → this wave falls back to the
existing git-merge + reconcile path (which serializes the conflicting work —
today's behavior, arrived at late instead of early). Every fallback is a named
ledger event surfaced in `judgmentCalls`.

Task failure and review handling are unchanged: only mergeable results fold,
exactly as only mergeable results merge today.

### 4. Ledger schema (first-class contract)

One JSONL file per run (`ledger.jsonl` in the run dir), events:
`fold {task, headSha}`, `conflict {path, kind, narration, verdict}`,
`resolve {path, epoch, linesSha}`, `park {path, reason}`,
`fallback {wave, reason}`. Resolution line content lives in the report
transcript verbatim (the E2 grading surface); the ledger carries its hash.
`report.json` gains a `frontier` section per contended wave: ledger path,
self-check results, transcript, fallbacks. Schema documented in
`kernel/LEDGER.md`; a future event-driven engine replays this schema verbatim.
No existing report field changes shape.

### 5. Authoring: ultraplan relaxation and rubric mirrors

`ultraplan/SKILL.md` stops steering authors away from same-file edits: the
three watch-item contortions (unnatural splits, chains-for-fans, Depends-on
for overlap alone) become explicitly wrong; `Files:` blocks remain required
(they are the compiler's detection input). The execution-handoff rubric's
"treating same-file edits as dependencies" clause is updated in both mirrors
(`hooks/session_start.sh`, `ultraplan/SKILL.md`) to count genuinely
independent tasks as parallel width even when files overlap;
`tests/test_recommendation_rubric.py` pins the new text.

### 6. The gating A/B and the shakedown

**Fixture:** `evals/fixtures/contend-prod/` — a realistic small application
where 4 independent tasks each deliver a real feature (multi-file,
multi-minute, with tests) and all modify one shared hot file (< 400 lines).
Pinned by a fixture-seal test like its siblings.

**Cells:** engine vs engine at the same ref, full protocol both arms — review
on, gate on — via `ab_runner.py`. Arm A compiles with `--serialize-overlaps`;
arm B compiles canonically. The only variable is the serialization rule: no
protocol asymmetry remains. Output tokens harvested identically both arms
(`_usage_output_tokens`); wall clock end-to-end.

**Pre-registered decision rule (fixed before building):**

- Hard gates: both arms' gates green; arm B ledger self-checks clean (raw
  shuffles outcome-identical, replay match); zero silent divergence; every
  park/fallback named.
- E1′ (operator-judged): arm B end-to-end wall clock materially better than
  arm A at production task length.
- E2′ (operator-judged): arm B output tokens not materially worse than arm A;
  any live resolutions graded acceptable from the verbatim transcript.
- Any red, dull E1′, or failing E2′ → the mode stays guarded off (ship
  nothing, or ship dark) and the result is recorded. Pass → release.

**Shakedown (non-gating):** before release, one real backlog plan authored
under the relaxed rule runs `/ultrapowers` end-to-end; its frontier section is
operator-reviewed. Evidence, not a gate.

## Error handling

Stated per component above; the invariant: **every failure degrades to
current behavior through a named event.** No new terminal failure modes: a
contended wave can always fall back to git-merge + reconcile; a guarded
compile is byte-identical to today's. The engine never claims a fold succeeded
without the live self-checks; replay divergence is a fallback, not a warning.

## Testing

- **pytest:** edge-drop correctness (only `write-after-write` dropped;
  semantic edges survive; each guard restores edges with its diagnostic;
  py<3.12 disables; `--serialize-overlaps` forces arm-A compile), contended
  tagging in the launch file, fold CLI (clean fold, conflict narration
  verdicts, epoch validity, self-checks, ledger replay), materialization
  ancestry. The promoted kernel modules' existing tests move with them.
- **Harness sim:** `tests/frontier_merge.mjs` drives the contended path in
  `waves.js` with stubbed agents — clean fold, conflict→resolve,
  stale→re-narrate, park→fallback — and prints the `ALL SCENARIOS PASSED`
  sentinel (the suite-gate runs it on any harness JS change; absence of a
  covering sim fails the gate by design).
- **Prompt pins:** resolver prompt enters `test_no_prompt_drift.py`; rubric
  mirror text pinned by `test_recommendation_rubric.py`.
- **Fixture seal:** `contend-prod` pinned like existing fixtures.

## Release

Minor bump (architectural): both manifests to the same version, standard
release commit. The verification periphery is untouched; compiler diagnostics
are additive and justified by the A/B measurement, per the freeze's own rule.

## Trim review

Author's disclosure — **Adds:** kernel module (promoted, not new code),
fold CLI + ledger schema, contended branch in `mergeWave`, resolver-as-agent
loop, compiler edge-drop + guards + tag, `contend-prod` fixture, one `.mjs`
sim, rubric/authoring text updates, ab_runner arm flag. **Removes:** the
`write-after-write` serialization default, `evals/frontier/` as the kernel's
home (evals import the engine's copy), and — at authoring time — the three
documented same-file contortions.

(Reviewer rounds appended below; adopt-or-answer per finding; reviewer grades
`netConceptDelta`.)
