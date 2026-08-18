# Fold-native authoring program — Phase 1 (resolver reach), Phase 2 (authoring/compiler subtraction + composition contracts), Phase 3 (engine decision rule)

_Program spec 2026-08-18, rev 1 (pre trim review). Brainstormed 2026-08-18
against `2026-08-18-rewrite-design-inputs.md` §5 (the value-ranked synthesis)
with the operator; three phases, each its own plan and release, each gated by
a pre-registered measurement. Nothing architectural is kept on principle —
including waves; every retained mechanism earns its place against the three
values (quality > tokens > clock) at each phase gate. Phase 1 and Phase 2 are
specified plan-ready; Phase 3 is a decision rule only. Frozen periphery
untouched throughout; no direct API calls; markers stay additive and
sequential-executor compatible; harness JS changes carry the sim-sentinel
obligation._

## Background — what is measured, what is recorded

- **The kernel's merge math holds** (K1–K4 pass, 305-order replay, 0 silent
  divergence; `evals/frontier/results/2026-08-10-readjudication.md`); fold CLI
  wall time is 0.8s — the win is scheduling, not the kernel.
- **T15 A/B PASS** on `contend-prod`: fold 0.640× wall, 1.111× tokens, 5/5
  resolver dispatches clean, whole-file briefs (`2026-08-14-t15-ab.md`). One
  observation carried: the resolver canonicalized `DISPATCH_HOOKS`
  alphabetically — a legal drive-by that flipped composed behavior between
  arms; text merges deterministically, composition stays order-sensitive.
- **The rule's cost is authoring-time, not compile-time**: same-file edges
  shorten the modeled makespan in 2/69 archived plans, both pre-ultraplan
  (`2026-08-10-plan-corpus-binding.md`); barrier removal recovers mean 4.9% /
  median 1.4% / max 21.7% (modeled).
- **The 0.2.x foreign sample (sense pass 2026-08-18)**: 12/13 real same-file
  pairs were serialized by `RESOLVER_LINE_CAP = 400`; a foreign plan chained
  its whole web fan on one 8.9k-line component; a home author expected a fold
  that silently serialized. The §5 relaxation (0.2.0) is partially inert; the
  cap is the lever; contention lives in big files.
- **Kernel size behavior (spike 2026-08-18, this repo, Python 3.9, macOS):**
  two-writer folds under `_recursion_headroom` — 1k lines 0.01s, 9k 0.11s
  in the main thread; **~12k lines SIGSEGV (exit 139), not `RecursionError`**;
  on a thread with a 1 GB stack 20k lines fold in 0.3s. Retiring the cap
  without a ceiling is a silent crash on files the size of the corpus's hot
  files.
- **`compile_plan.py`'s honest core is ≈350–600 of ~1,700 lines** (complexity
  review 2026-07-10); the rest is diagnostics and guards against the
  compiler's own over-inference.
- **Plan-body relaxation (2026-07-04, unbuilt)**: blanket "sketch bodies" is
  misaligned with quality-first; the scoped version (sketch glue, exact code
  for adversarial/below-top-tier/hard-to-verify) is the trial design; the
  redirect-round canary already ships for it.
- **Merge contracts** (`2026-08-14-fold-native-methodologies.md` §2 +
  counterweight) are the pre-registered §5-conversation input: "today's
  markers say who depends on whom; these would say what commutes with what."

## Goal and pre-registered outcomes (operator-approved 2026-08-18)

Move the parallel engine's value in all three areas, measured:

- **Quality** — engine/finding-caused redirect-round rate stays flat vs the
  0.2.x baseline (1/6, 4/18, 0/8); every multi-writer fold onto a
  registration surface is covered by a declared composition contract or an
  exam (mechanically: `composition-unpinned` acks trend to zero).
- **Tokens** — fold path ≤ 1.1× serialize on contended shapes (T15: 1.11 with
  whole-file briefs; hunk briefs are expected to bring it under).
- **Clock** — width-4 contended ≤ 0.6× (T15: 0.64); natural fold rate on
  real plans from 1/13 to a majority; planning wall time down by a stated
  fraction on the next N marked plans (proposed −30% median over the next
  10; the baseline recording starts in Phase 1).

## Non-goals (this program)

- Building the continuous frontier / event-driven engine before Phase 3's
  rule fires (Phase 3 is a decision rule, not a build).
- Any change to the frozen verification periphery (`ultra_gate.py`,
  `gate_check.py`, `run_lock.sh`, sealing scripts) or to per-task review,
  the pre-merge human gate, worktree isolation.
- Kernel periphery expansion (binaries, symlinks, gitlinks, renames): guards
  keep routing them to fallback.
- Iterative rewrite of the recursive kernel core — deferred unless the
  measured ceiling binds on a real repo (Phase 1 §1d).
- A new marker vocabulary beyond one optional `**Commutes:**` line.

## Where it lives

- Kernel/CLI: `skills/ultrapowers/kernel/{fold_wave.py,frontier_fold.py,repo_weave.py}`.
- Engine: `skills/ultrapowers/harnesses/waves.js` (resolver dispatch; baked
  `RESOLVER_PROMPT` from `references/wave-merge.md`), `tests/sim_workflow.mjs`.
- Compiler: `skills/ultrapowers/scripts/compile_plan.py`.
- Authoring: `skills/ultraplan/SKILL.md`, `skills/ultrapowers/references/plan-markers.md`,
  the two rubric legs (`hooks/session_start.sh`, ultraplan SKILL.md).
- Sensor: `skills/ultralearn/scripts/harvest_runs.py`, `references/reading-lenses.md`.
- Evals: `evals/ab_runner.py`, `evals/fixtures/contend-prod/`, new
  `evals/fixtures/contend-big/`, `evals/frontier/results/`.

---

## Phase 1 — resolver reach: make fold reach the files that carry contention

### 1a. Hunk-scoped brief — a brief-layer change; kernel and fold log untouched

Grounded: `cmd_fold` writes the kernel's annotated whole file per conflict
(`conflict-<i>.txt`, `<<<<<<< begin added frontier|<task>` … `>>>>>>>`
blocks; every unmarked line is already-merged content), the engine dispatches
one resolver at a time with `RESOLVER_PROMPT` naming the narration file and a
reply file, and `cmd_resolve` applies the reply's whole-file lines via
`FrontierEngine.apply_resolution(path, epoch, lines)`.

Change: `cmd_fold` keeps writing `conflict-<i>.txt` (the kernel's truth,
replay-relevant) **and** derives `conflict-<i>.hunks.txt` from it:

```
HUNK h1 lines 118-131 of 6412
--- context (read-only)
  <up to CONTEXT_LINES unmarked lines before>
--- conflict
<<<<<<< begin added frontier
...
>>>>>>> end added task-3
--- context (read-only)
  <up to CONTEXT_LINES unmarked lines after>

HUNK h2 lines 402-409 of 6412
...
```

`CONTEXT_LINES = 40` (module constant, `fold_wave.py`). Hunk ids are
positional and stable for the life of the narration file. `conflicts.json`
entries gain `"hunksFile"` and `"hunkCount"` (additive; readers that ignore
them keep working). The resolver brief names the hunks file as the narration
and a reply file; the reply is per-hunk, delimited text (the resolver is
text-in/text-out; no JSON-in-prose):

```
HUNK h1
<resolved lines for h1, no markers>
HUNK h2
<resolved lines for h2>
NOTES
<free text; "irreconcilable: …" here when applicable>
```

`cmd_resolve` **splices**: it re-reads `conflict-<i>.txt`, replaces each
marked block (markers inclusive) with that hunk's reply lines, leaves every
context line byte-identical, and hands the resulting whole-file line list to
the existing `apply_resolution`. Nothing below the splice changes: log
schema (three event types), `rehydrate`, `replay`, K-gates, `#143`
staleness, `_touched_at`.

Rejections (each a named reason on the CLI's stdout, routed through the
existing one-retry-then-park lane): a reply naming an unknown hunk id;
omitting a hunk; containing conflict markers; a `HUNK` block that is empty
when the conflict had content on both sides *and* NOTES does not say
`delete`. Context lines are never in the reply, so "touching context" is
inexpressible rather than detected.

Consequences, stated: (i) the resolver can no longer rewrite outside conflict
blocks — the T15 alphabetical canonicalization becomes impossible; a
resolution's reach is exactly the conflict (quality: composition stays as
authored until a contract says otherwise). Irreconcilable sides: best
in-block merge + NOTES, the current contract. (ii) Brief size is
O(conflicts × (block + 2·CONTEXT_LINES)), independent of file size — the
token target's mechanism.

### 1b. Re-narration in hunk shape

Grounded: a stale `apply_resolution` (an intervening fold or resolution
touched the path) writes a **markerless whole-file** re-narration
(`_renarration_dispatchable`, cap-gated) and the resolver "carries intent
forward"; a second staleness falls the wave back.

Change: on stale, `cmd_resolve` re-derives the path's annotation from the
current frontier — `repo_weave` exposes the per-path annotated merge state
(`manyana.merge_states` yields it) — and writes a **new annotated narration +
hunks file** under the next index `i` (`"renarration": true`), same
one-retry-then-fallback budget. If the re-derived state carries **no
markers**, nothing is left to adjudicate: the CLI reports `applied: true`
without dispatching (the earlier reply is moot — the later fold already
carried the content). The markerless whole-file shape and
`_renarration_dispatchable` retire. (Trim-review question, pre-asked: is a
markerless-but-changed frontier ever a case where the earlier resolver's
intent is *lost*? Answer to verify: a later fold that touched the same
lines produced its own conflict and narration; one that did not leaves the
resolved lines exactly where the splice put them.)

### 1c. Resolver prompt (baked) and dispatch

`RESOLVER_PROMPT` rewritten for the hunk shape in `references/wave-merge.md`
and re-baked into `waves.js` (`test_no_prompt_drift` pins it). Contract: read
the hunks file; for each `HUNK` write the resolved lines; honor both sides'
intent, prefer the semantics the contending task bodies describe over surface
text, never drop a side silently, nothing invented that appears in neither
side; irreconcilable → best in-block merge and say so under NOTES; RESOLVED /
BLOCKED as today. Dispatch stays serial, one resolver at a time,
`{label, schema}` with model omitted, budget checkpoint per conflict — all
unchanged.

### 1d. Retire the cap as a routing constant; add a kernel ceiling that parks

- `frontier_fold.dispatchable()` drops the size term (keeps: annotated
  narration present, text manifest content). `RESOLVER_LINE_CAP` is deleted;
  the compile-time `fold_eligible` pre-filter drops its line-count term (its
  non-text/symlink terms stay until Phase 2 deletes the tier).
- New `KERNEL_LINE_CEILING = 40_000` (per text file, `fold_wave.py`),
  checked in `cmd_fold` from `_state_max_lines` **before** any fold: over →
  the existing kernel-limit park entry (`kind: "kernel-limit"`, exit 3,
  `conflicts.json` record, wave → fallback) — never a crash.
- Folds run on a dedicated thread with a large stack
  (`threading.stack_size(STACK_BYTES)`, `STACK_BYTES = 1 GiB`, the spike's
  working value), keeping `_recursion_headroom` inside it; `cmd_resolve`
  and `cmd_materialize` rehydrate the same way. The ceiling is **pinned by a
  subprocess test**: fold a synthetic file at `KERNEL_LINE_CEILING + margin`
  → park record and exit 3, never exit 139; and a fold at `KERNEL_LINE_CEILING
  − margin` → success. The constant moves only with that test.
- The iterative rewrite of the recursive core (`pull_out_tree`) is deferred:
  Phase 1's shakedown records the largest text file folded on each real run
  (sensor field, §1f); if a real repo's hot files approach the ceiling, that
  is the trigger and it gets its own spec.

### 1e. Fixture `contend-big` and the Phase-1 gate

No new calibration campaign (T14 took 8 attempts). `evals/fixtures/contend-big/`
= `contend-prod` frozen at `486f02a` with `app/registry.py` inflated to
≈6,000 lines of realistic surrounding module (declarations, docstrings,
helpers that the tasks never touch; the registration hub, its config block
and wiring section unchanged and in the same relative positions). The sealed
exam `4d131df61152` is unchanged and must stay green on the fixture's base
(it asserts keys and behaviors, never file shape); implementer floors carry
over (same edits, same work) — the plan re-verifies with one arm-A run and
records it.

**Gate (T15 rig, `evals/ab_runner.py`):** arm A = **0.2.14 as shipped**
(fold default; on `contend-big` the cap serializes the pair — the honest
"today"), arm B = the Phase-1 engine; both fixtures. Hard gates verbatim
from T15: arm identity (receipt compile object; on `contend-big` arm A shows
the cap's serializing edges, arm B a contended wave routed to the fold path),
both gates green with the sealed exam green on both integrated trees, fold-log
`selfChecks: ok`, zero fallbacks on the contended wave, every park named,
zero silent divergence. **E1″ wall ≤ 0.6× on both fixtures; E2″ tokens ≤ 1.1×
on both.** Resolver transcripts graded (operator, or a delegated proxy with
transcripts preserved): each reply must show both sides' intent kept, nothing
invented, notes used for anything irreconcilable. Then the shakedown: the
next real plan carrying a natural big-file pair runs `/ultrapowers`; its
`frontier/` records (hunk counts, brief sizes, resolver wall, largest file)
are operator-read before release.

### 1f. Sensor baseline (starts here, read in Phase 2)

- `harvest_runs.py` reads each run's `frontier/wave-*/conflicts.json` and
  records per fold: `maxLines` (largest text file), `hunkCount`,
  `dispatchable`/`parked` counts — the fold-canary lens gains these fields.
- Planning wall time: for bundles where `planningFound` is true, record the
  planning session's wall (first plan-file write → launch) and the plan's
  word count, so Phase 2's planning target has a 0.2.x baseline.

### 1g. Phase-1 error handling and rollback

Every new failure is a named park or rejection in existing lanes; no new
refusal paths. Rollback = `--overlap serialize` (unchanged knob).

---

## Phase 2 — authoring/compiler subtraction, composition contracts, scoped body relaxation

Planned only after the Phase-1 gate passes and the shakedown is read.

### 2a. Compiler: keep existence, delete ordering-guesses

Grounded: `build_edges` runs `marker`, `text`, `write-after-create`,
`read-after-write`, `interface` (Consumes→Produces edge + "undeclared
dependency" finding), `prose-reference`/`description-inferred`, and the
document-order tier `write-after-write` (dropped only when fold-eligible),
`ambiguous-files`, `catch-all`.

Keep (existence dependencies): `marker`, `text`, `interface`,
`write-after-create` (no base to fold a modify onto until the creator lands),
`read-after-write` (a test that imports what a sibling writes). **Delete**
(write ordering and guesses): `write-after-write` and its `fold_eligible`
pre-filter (the fold path owns same-file writes; non-text/symlink route to
fallback at merge), `ambiguous-files` fan-in, `prose-reference` /
`description-inferred`, `catch-all`, and the overlap→`interface` label
promotion. `Files:` blocks stay required — reviewer-packet scope and the
transparency render's *expected contention* — and never create an edge.
`--check` grammar + did-you-mean stay. `--overlap` keeps `serialize` as the
rollback arm (it re-enables the `write-after-write` tier only).

Pins: **corpus regression** — every archived plan under `docs/superpowers/plans/`
compiles with the same PLAN OK / fail set as at 0.2.14 and a modeled makespan
that never lengthens (the 08-10 method, checked in as a test over the
committed corpus); the seven fixture repos' compiled shapes recorded and
diffed.

### 2b. Composition contracts — one additive marker, three consumers

`**Commutes:**` — optional header-block marker (same contiguous block as
`Type:`/`Depends-on:`/`Review:`), comma-separated paths that must appear in
the task's own `Files:` (else a marker conflict): "my edits to these files
are order-insensitive additive registrations." Consumers:

1. **Compiler** — a contended pair (same wave, intersecting `Files:` writes)
   where *both* writers declare the path → `declared-commutative` in the
   transparency render; any writer undeclared → `composition-unpinned`
   finding (rendered, not an edge, not a block).
2. **Resolver brief** — the hunks file header carries the contract line for
   the path when both sides declared it: "both sides declared these edits
   commutative: produce the union, preserve each side's internal order, do
   not reorder existing lines" — the rule that makes the T15 `DISPATCH_HOOKS`
   flip inexpressible.
3. **Report / critic** — every fold with ≥2 writers onto a path lacking a
   contract from each writer lands in `deferredVerification` as reason
   `composition-unpinned` → the same explicit-ack lane as `runtime` /
   `external` (the report-format taxonomy gains the reason; the residual
   manifest inherits it). Cross-task invariant *exams* remain the sealed-plan
   route (existing), not new machinery.

Sequential executors ignore the marker; ultraplan review audits the claim
the way it audits test contracts.

### 2c. ultraplan rewrite — one SKILL.md change, both halves

- Move 3 becomes: coupling is interfaces and existence, not files; declare
  `Commutes:` for shared registration surfaces; the three contortions stay
  named as defects. The phantom-edge rules ("describe siblings by role, not
  filename") go with the tiers they served; the test-import `Depends-on` rule
  stays (read-after-write is kept). `plan-markers.md` mirrors; the
  recommendation-rubric same-file clause updated byte-identically in both
  legs (`BRANCH_CLAUSES` pin).
- **Scoped body relaxation** (07-04 verdict), as rules not a marker: an
  `implementation` body must be interface- and test-complete; implementation
  steps may *sketch* routine glue **except** when the task is
  `Review: adversarial`, runs below the most-capable tier, or is marked
  hard-to-verify — those keep exact code. Stated as an explicit ultraplan
  override of writing-plans' "complete code in every step" (the same
  mechanism as the header override). SKILL.md word budget stated in the plan.

### 2d. Gate, baseline, rollback

Ships in the fold path (already the default); `--overlap serialize` stays as
the rollback until the canary reads. **Pre-registered reads at
`engineVersion ≥` release over ≥2 sense passes:** natural fold rate 1/13 →
majority; engine/finding-caused redirect-round rate flat vs 0.2.x baseline;
`composition-unpinned` acks trending to zero; body-relaxation's own canary
(redirect-round rate on sketched vs exact tasks). Mechanics before release:
T15 rig on `contend-prod` + `contend-big` with the new compiler (arm identity
= "0 heuristic edges" in the compile object) — this run is also the
**integration-spanning acceptance** for the multi-plan effort (Phase-1
resolver + Phase-2 compiler on one tree); corpus pin green; planning wall
target read against the Phase-1 baseline (−30% median over the next 10
marked plans, proposed).

---

## Phase 3 — decide the engine by number

After Phase 2 has run on real plans for ≥2 sense passes, re-measure the
barrier tail on the wider plans two ways: modeled (the 08-10 corpus method
over Phase-2-compiled plans) and **measured** (per-task wall from agent
transcripts: barrier idle = Σ over waves of (wave wall − mean task wall) ÷
run wall). **Rule:** if median measured barrier idle across ≥10 real Phase-2
runs exceeds **15%** *and* exceeds the serial review/gate tail, spec the
continuous frontier — evaluating first the intermediate option,
**dependency-triggered dispatch inside the wave architecture** (launch a task
the moment its true deps have merged; keep per-wave fold/merge), which
harvests most of the tail without touching review semantics or resume lanes.
Below the threshold: waves stay, and the numbers are recorded as the reason.

---

## Verification (suite disposition; sealing only on request)

Phase 1: kernel ceiling subprocess test (park/exit 3, never 139; success at
ceiling − margin); hunk derive/splice **round-trip property**
(`splice(derive(annotated), identity replies) ≡ annotated`) + fuzzed replies
(unknown/missing hunk, markers, empty block) → named rejections;
`dispatchable` has no size term; `_renarration_dispatchable` deleted;
sim scenarios (sentinel): hunk reply parse, reject → retry → park, ceiling
park, markerless re-narration auto-apply; baked-prompt pin green after
re-bake; ab_runner receipts carry both fixtures; T15 rig runs recorded under
`evals/frontier/results/`; harvester fields pinned by fixture.
Phase 2: corpus regression pin; compiler tests rewritten to the kept tiers
(deleted-tier tests removed, not skipped); `Commutes:` grammar + three
consumers pinned; report-format reason taxonomy + residual manifest pin;
rubric two-leg pin; ultraplan validator; T15 rig mechanics re-run.
Cross-phase: the Phase-2 T15 rig run is the integration acceptance.

## Error handling

Every new failure is a named park / rejection / `deferredVerification`
reason in existing lanes; no new refusal paths; no silent greens. Rollbacks:
`--overlap serialize` (both phases); `Commutes:` optional (Phase 2).

## Release

Phase 1 → 0.3.0 (architectural: cap retired, brief shape changed). Phase 2 →
0.4.0. Both manifests, `chore(release)` commit, main CI green confirmed.

## Adds / Removes (author disclosure for trim review)

Adds (Phase 1): hunks derivation + splice in `fold_wave.py`, `CONTEXT_LINES`,
`KERNEL_LINE_CEILING`, big-stack fold thread, `hunksFile`/`hunkCount` fields,
rewritten `RESOLVER_PROMPT`, `contend-big` fixture, two harvester fields.
Removes (Phase 1): `RESOLVER_LINE_CAP` and every size term (`dispatchable`,
`fold_eligible`, `_renarration_dispatchable`), markerless whole-file
re-narration shape.
Adds (Phase 2): `Commutes:` marker + three consumers, `composition-unpinned`
reason, corpus regression pin, ultraplan body-relaxation rules.
Removes (Phase 2): compiler tiers `write-after-write` (+ pre-filter),
`ambiguous-files`, `prose-reference`/`description-inferred`, `catch-all`,
overlap→interface promotion; ultraplan phantom-edge rules; ~1k lines of
compiler self-defense expected to go with them.

## Trim review

_(fresh-context rounds to diminishing returns; adopt-or-answer per round)_
