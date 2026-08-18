# Fold-native authoring program — Phase 1 (resolver reach), Phase 2 (authoring/compiler subtraction + composition contracts), Phase 3 (engine decision rule)

_Program spec 2026-08-18, rev 2 (after trim round 1: B1 resolved via incremental fold; B2–B4 + trims 1–15 adopted-or-answered — see §Trim review). Brainstormed 2026-08-18
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
  on a thread with a 1 GiB stack 3.9 folds 40k lines in 0.3s and 100k in
  0.93s; **Python 3.11 and 3.12 fold 100k lines in the main thread with no
  crash** (trim-round-1 reviewer probe; CI runs 3.11). The crash is a
  3.9-specific C-stack behavior; retiring the cap without the big-stack
  thread is a silent crash on 3.9 for files the size of the corpus's hot
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
  real plans from 1/13 to a majority; planning cost down, read as plan word
  count and planning-session turn count on the next 10 marked plans against
  the Phase-1 baseline (wall time is not attributable across sessions — an
  observation, not a gate).

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
  `RESOLVER_PROMPT` + contended-merge STEP from `references/wave-merge.md`),
  `tests/frontier_merge.mjs` (the resolver-loop sim) + `tests/sim_workflow.mjs`.
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
(`conflict-<i>.txt`; kernel marker forms exactly as `manyana.merge_states`
emits and `_relabel` relabels: `<<<<<<< begin added|deleted frontier|<task>`
… `======= begin added|deleted <side>` segment separators … `>>>>>>> end
conflict`; `deleted` segments show lines that are *not* in the merged
content; every unmarked line is already-merged content). The engine
dispatches one resolver at a time with `RESOLVER_PROMPT` naming the narration
file and a reply file, and `cmd_resolve` applies the reply's whole-file lines
via `FrontierEngine.apply_resolution`.

Change: `cmd_fold` (now incremental — §1b) keeps writing `conflict-<i>.txt`
(the kernel's truth) **and** derives `conflict-<i>.hunks.txt` from it:

```
HUNK h1 lines 118-131 of 6412
--- context (read-only)
  <up to CONTEXT_LINES unmarked lines before>
--- conflict
<<<<<<< begin added frontier
...
>>>>>>> end conflict
--- context (read-only)
  <up to CONTEXT_LINES unmarked lines after>

HUNK h2 lines 402-409 of 6412
...
```

`CONTEXT_LINES = 40` (module constant, `fold_wave.py`). Hunk ids are
positional and stable for the life of the narration file. `conflicts.json`
entries gain `"hunksFile"` and `"hunkCount"` (additive). The resolver brief
names the hunks file and a **reply directory**; the reply is **one file per
hunk** — `reply-<i>-<m>/h1.txt`, `h2.txt`, … plus `notes.txt` — so parsing is
the kernel's own `split_lines` per file (bijective: `""` → `[]`, `"\n"` →
`[""]`, trailing-newline rule inherited), with no delimiter grammar and no
escaping. When both sides of a hunk declared `Commutes:` (Phase 2, §2b) the
hunk header carries one extra line: `contract: both sides declared these
edits commutative — union, preserve each side's internal order, do not
reorder existing lines`.

`cmd_resolve` **splices**: it re-reads `conflict-<i>.txt`, replaces each
marked block (all marker lines and all segments, inclusive) with that hunk's
reply lines, leaves every context line byte-identical, and hands the
resulting whole-file line list to the existing `apply_resolution`. Nothing
below the splice changes: log schema (three event types), `rehydrate`,
`replay`, K-gates.

Rejections (each a named reason on the CLI's stdout, routed through the
existing one-retry-then-park lane): a missing `h<k>.txt` (omitted hunk); an
extra `h<k>.txt` (unknown hunk); any reply line that is byte-equal to a
kernel marker form (`<<<<<<< begin `, `======= begin `, `>>>>>>> end
conflict` — the exact forms, never a bare `=======`, which is legal
Markdown/RST); a zero-line reply for a hunk whose conflict had content on
both sides unless `notes.txt` contains the token `delete h<k>`. Context
lines are never in the reply, so touching context is inexpressible.

Consequence, stated: brief size is O(conflicts × (block + 2·CONTEXT_LINES)),
independent of file size — the token target's mechanism. (The T15
alphabetical canonicalization happened *inside* the contended blocks, which
the hunk reply still owns; only the Phase-2 contract line addresses it, and
only as instruction. No stronger claim is made.) **Verify before building:**
the resolver brief also appends every wave task's full body
(`contendingTasksBlock`); the plan's first task reads the resolver token
share out of the preserved T15 transcripts so E2″ is promised from data, not
assumed.

### 1b. Incremental fold — resolve, then continue (staleness and re-narration retire)

Grounded (trim round 1, verified): the kernel annotates a *pair* at fold
time only (`repo_weave._fold_text` → `manyana.merge_states(files[p], w)`);
the frontier itself is a marker-free weave, so a "re-derived annotation" does
not exist. Worse, `cmd_fold` today folds **every** task before narrating,
so for n writers on one path conflicts 1..n−2 are stale by construction
before the first resolver runs — replies discarded, then re-narrated (as
whole files). On the program's target shape that is most dispatches wasted.

Change — **fold incrementally**: `cmd_fold` folds tasks in argv order and
**stops at the first fold that produces conflicts**; it writes the fold
events so far, the conflict narration(s) + hunks file(s), and prints the
open entries plus `"remaining": [<task ids not yet folded>]`. The engine
dispatches the resolver(s) for the open entries; `cmd_resolve` applies each
reply (splice → `apply_resolution`), then **continues folding** the remaining
tasks until the next conflicting fold (printing new open entries) or until
every task is folded (`"complete": true`). Every narration is therefore
fresh against the resolved frontier: exactly one dispatch per conflicting
fold event, no stale replies, no re-narration. The wave's task list is
re-supplied on every CLI call (it is in the launch args), and the fold log
is the authority for what has folded — `resolve` refuses (exit 2) if the log
and the supplied list disagree.

Retires: markerless whole-file re-narration, `_renarration_dispatchable`,
the `attempt ≤ 2` re-narration budget, and the `_touched_at`/epoch staleness
refusal (`#143`) — an intervening fold can no longer exist between narration
and reply because folding is suspended while a resolver is out. `epoch` stays
in the resolve event for replay determinism (the position at which the
resolution applies). Order-independence self-checks (raw shuffle over the
*raw* folds; rehydrate-manifest replay) run at completion as today.

Engine loop (`waves.js`, baked STEP-resolve prompt): the
resolve→CONFLICTS→open loop becomes a **work-list until `complete`**, with
the existing budget checkpoint per dispatch and the existing routes: a
resolver BLOCKED after its one retry, budget exhaustion, or a self-check
failure → fallback (still live before adoption). `FOLD_SCHEMA` and the
contended-merge STEP prompt gain `hunksFile`, `remaining`, `complete`.

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

### 1d. Retire the cap as a routing constant; fold on a big-stack thread

- `frontier_fold.dispatchable()` drops the size term (keeps: annotated
  narration present, text manifest content). `RESOLVER_LINE_CAP` is deleted;
  the compile-time `fold_eligible` pre-filter drops its line-count term (its
  non-text/symlink terms stay until Phase 2 deletes the tier).
- No new ceiling constant (trim round 1: nothing measured motivates one —
  3.9 on a 1 GiB thread folds 100k lines; 3.11/3.12 fold 100k in the main
  thread). Instead: `cmd_fold`/`cmd_resolve`/`cmd_materialize` run the
  kernel work on a dedicated thread with `threading.stack_size(1 GiB)` set
  before creation (a `ValueError` from `stack_size` → run in the main thread
  and say so on stderr), marshalling result and exception back to the main
  thread so exit codes are unchanged; `_recursion_headroom` stays inside the
  thread and is sized from **weave entry counts (hidden lines included)**,
  not visible lines. The existing `RecursionError` → kernel-limit park (exit
  3, `conflicts.json` record) remains the only ceiling. Pinned by a
  subprocess test that folds a 100k-line synthetic pair and asserts success
  (on every interpreter; on 3.9 the thread is what makes it true) — never
  exit 139.
- The iterative rewrite of the recursive core is deferred; the sensor field
  (largest text file folded per run, §1f) is the trigger.

### 1e. Fixture `contend-big` and the Phase-1 gate

No new calibration campaign (T14 took 8 attempts). `evals/fixtures/contend-big/`
= `contend-prod` frozen at `486f02a` with `app/registry.py` inflated to
≈6,000 lines of realistic surrounding module (declarations, docstrings,
helpers the tasks never touch; the registration hub, its config block and
wiring section unchanged and in the same relative positions). The sealed
exam dir is a byte-identical copy (same seal id `4d131df61152`, added to
`tests/test_fixture_seals.py::FIXTURES`); it must stay green on the
fixture's base. Implementer floors carry over by construction (same edits,
same work); one arm-A run re-verifies them and is **not** the counted arm A
(T14/T15 selection-bias rule).

**Gate (T15 rig, `evals/ab_runner.py`, one fixture per cell):**
arm A = **`--arm-overlap serialize` at 0.2.14** on `contend-big` (trim
round 1: "0.2.14 as shipped" folds on contend-prod and fails arm identity on
contend-big — the honest control is the serialize arm on both); arm B =
Phase-1 engine, fold. Counted cells: `contend-big` A and B (carry E1″/E2″);
`contend-prod` B as a **mechanics cell** (hard gates + resolver grading;
E2 read directionally against T15's 1.111 — a T15 replication with hunk
briefs). Hard gates verbatim from T15: arm identity, both gates green with
the sealed exam green on both integrated trees, `selfChecks: ok`, zero
fallbacks on the contended wave, every park named, zero silent divergence.
**E1″ wall ≤ 0.6× and E2″ tokens ≤ 1.1× on `contend-big`.** Resolver
transcripts graded (operator, or a delegated proxy with transcripts
preserved): each hunk reply keeps both sides' intent, invents nothing,
uses notes for anything irreconcilable. Then the shakedown: the next real
plan carrying a natural big-file pair runs `/ultrapowers`; its `frontier/`
records (hunk counts, brief sizes, resolver wall, largest file) are
operator-read before release.

### 1f. Sensor baseline (starts here, read in Phase 2)

- `harvest_runs.py` reads each run's `frontier/wave-*/conflicts.json` and
  records per fold: `maxLines` (largest text file), `hunkCount`,
  `dispatchable`/`parked` counts — the fold-canary lens gains these fields.
- Planning cost, recorded as an observation (trim round 1: wall is not
  attributable — planning and launch often live in different sessions and
  the interval is dominated by human review turns): plan word count and
  planning-session turn count where `planningFound` is true, so Phase 2's
  planning read has a 0.2.x baseline.

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
and `read-after-write` **narrowed to `creates ∩ reads`** (trim round 1:
today's tier fires on `writes ∩ reads` including modifies of a shared test
file — that is the same class as write-after-write and belongs to the fold
path). **Delete** (write ordering and guesses): `write-after-write` and its
`fold_eligible` pre-filter (the fold path owns same-file writes;
non-text/symlink route to fallback at merge), `ambiguous-files` fan-in,
`prose-reference` / `description-inferred`, `catch-all` (the `- catch-all:`
Files label becomes a grammar violation with a did-you-mean), and the
overlap→`interface` label promotion. **An `implementation` task with no
parseable `Files:` paths becomes a `--check`/compile refusal** (grammar,
alongside the glob refusal) — the deleted `ambiguous-files` tier was the only
thing serializing such a task, and a Files-less task is invisible to
merge-time contention detection. `Files:` blocks otherwise stay required —
reviewer-packet scope and the transparency render's *expected contention*
(now derived from same-wave `Files:` intersections directly, no
`dropped_pairs`) — and never create an edge. `--check` grammar +
did-you-mean stay. **`--overlap serialize` keeps the whole legacy tier set**
(write-after-write + ambiguous-files + catch-all, byte-identical) behind the
knob until the canary reads; then it is a deletion candidate.
`assert_arm_identity` gains a `dag-only` predicate ("0 heuristic edges in
the compile object") for Phase-2 cells.

Pins: **corpus regression** — every archived plan under `docs/superpowers/plans/`
(100 files at 0.2.14; `tests/test_all_plans_compile.py` is the existing
seat) compiles with the same PLAN OK / fail set as at 0.2.14, and a recorded
per-plan **edge multiset diff by why-label** (what was dropped) is checked
in and reviewed once — the makespan clause is dropped (removing edges never
lengthens it); the seven fixture repos' compiled shapes recorded and diffed.

### 2b. Composition contracts — one additive marker, two consumers

`**Commutes:**` — optional header-block marker (own `MARKER_COMMUTES`
regex beside `Review:`), comma-separated paths that must appear in the
task's own `Files:` (else a rendered marker conflict, not an error): "my
edits to these files are order-insensitive additive registrations."
Consumers:

1. **Compiler + resolver brief** — a contended pair (same wave, intersecting
   `Files:` writes) where *both* writers declare the path →
   `declared-commutative` in the transparency render and the one-line
   `contract:` header in that path's hunks file (§1a); any writer undeclared
   → `composition-unpinned` in the render (not an edge, not a block).
2. **Report render + residual manifest** — engine-side and deterministic
   (`conflicts.json` writers × the compile object's `commutes`; no critic
   change, the critic's reason enum stays closed): every fold with ≥2
   writers onto a path lacking a contract from each writer is rendered in
   the report and lands as a **residual-manifest row** at finishing (the
   #149 contract: dispositioned `fixed | acked | filed | waived` before
   close). Trim round 1: **not** a `deferredVerification` ack — that would
   force a fresh operator turn on every uncontracted fold (the standing
   grant covers `runtime`/`external` only) and non-registration multi-writer
   folds can never honestly declare `Commutes:`, so the ack would be
   permanent friction on the common case, in tension with the fold-rate
   target. The suite/exam already gates behavior; the manifest row keeps the
   composition question visible and dispositioned.

Sensor: "unpinned folds → 0" is read from frontier records + the compile
object. Sequential executors ignore the marker; ultraplan review audits the
claim the way it audits test contracts. Cross-task invariant *exams* remain
the sealed-plan route (existing), not new machinery.

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
  `Review: adversarial` — those keep exact code (trim round 1: tier is a
  launch-time decision unobservable in the body, and "hard to verify" is
  already the criterion for marking adversarial; one observable rule). Stated
  as an explicit ultraplan override of writing-plans' "complete code in
  every step" (the same mechanism as the header override).
- **Word budget (the ratchet):** ultraplan `SKILL.md` ≤ 3,400 words after
  the rewrite (3,805 at 0.2.14 — a net cut, not a swap); ultrapowers
  `SKILL.md` ≤ 2,900 (2,888 today).
- **Carried prose (held items from the 08-18 distill):** ultrapowers
  SKILL.md Step 1 — if the fresh-worktree baseline is red for reasons
  unrelated to the plan, repair base first and re-baseline rather than
  launching red (P6, one line).
- **Do-not-port decision:** the agent-based waves-file preflight
  (`preflightWavesFile` / `waves-file-check`, ~60 lines + prompt + 4 sim
  scenarios) is a **Phase-2 deletion** — the deterministic driver stamps
  `wavesPath` and `redirect_args.py` composes relaunches, so the guarded
  defect is inexpressible and every observed failure of the stage was the
  guard itself (design-inputs §2). Not deferred to Phase 3.

### 2d. Gate, baseline, rollback

Ships in the fold path (already the default); `--overlap serialize` stays as
the rollback until the canary reads. **Pre-registered reads at
`engineVersion ≥` release over ≥2 sense passes:** contended-wave fold rate —
share of waves with ≥1 contended pair (compile object) that folded without
fallback (frontier records) — from the 0.2.x baseline (1/13 pairs) to a
majority, and contended pairs per marked plan not falling (the authoring
half); engine/finding-caused redirect-round rate flat vs 0.2.x baseline;
`composition-unpinned` manifest rows trending to zero; body-relaxation's
own canary (redirect-round rate on sketched vs exact tasks). Mechanics before release:
T15 rig on `contend-prod` + `contend-big` with the new compiler (arm identity
= "0 heuristic edges" in the compile object) — this run is also the
**integration-spanning acceptance** for the multi-plan effort (Phase-1
resolver + Phase-2 compiler on one tree); corpus pin green; planning cost
read against the Phase-1 baseline (word count / turn count, observation —
the −30% wall figure is retired as unmeasurable).

---

## Phase 3 — decide the engine by number

After Phase 2 has run on real plans for ≥2 sense passes, re-measure the
barrier tail on the wider plans with **one metric, critical-path recovery**
= (wave-schedule makespan − dependency-only makespan) ÷ wave-schedule
makespan, computed two ways: modeled (the 08-10 corpus method's duration
model over Phase-2-compiled plans — the same column as its 4.9% mean /
21.7% max) and **measured** (the same formula with actual per-task wall from
agent transcripts). **Rule:** if median *measured* recovery across ≥10 real
Phase-2 runs exceeds **15%** *and* exceeds the serial review/gate tail's
share of run wall, spec the
continuous frontier — evaluating first the intermediate option,
**dependency-triggered dispatch inside the wave architecture** (launch a task
the moment its true deps have merged; keep per-wave fold/merge), which
harvests most of the tail without touching review semantics or resume lanes.
Below the threshold: waves stay, and the numbers are recorded as the reason.

---

## Verification (suite disposition; sealing only on request)

Phase 1: big-stack subprocess test (100k-line pair folds, exit 0, on the
running interpreter — never 139); hunk derive/splice **round-trip property**
`splice(derive(A), kernel-merged block bodies) ≡ strip_markers(A)` where
`strip_markers` drops marker lines and `deleted`-segment lines (the kernel's
own merged content) + fuzzed replies (missing/extra hunk file, exact marker
forms, empty hunk without `delete`) → named rejections; incremental fold
pins: n writers on one path → exactly n−1 dispatches, `remaining`/`complete`
protocol, log-vs-list disagreement refusal, order-independence self-checks
at completion; `dispatchable` has no size term; `_renarration_dispatchable`
and the `_touched_at` staleness refusal deleted (their tests removed, not
skipped); sim scenarios in `tests/frontier_merge.mjs` (sentinel): work-list
loop to `complete`, reply reject → retry → park, BLOCKED → fallback, budget
exhaustion mid-list; baked-prompt pins green after re-bake (RESOLVER_PROMPT
+ contended-merge STEP + FOLD_SCHEMA); ab_runner `contend-big` cell +
mechanics cell recorded under `evals/frontier/results/`; harvester fields
pinned by fixture; T15-transcript token-share reading recorded before the
build (plan task 1).
Phase 2: corpus regression pin; compiler tests rewritten to the kept tiers
(deleted-tier tests removed, not skipped; `serialize` legacy set pinned
byte-identical); Files-less refusal + `catch-all` label refusal pinned;
`Commutes:` grammar + two consumers pinned; report render + residual-manifest
row pin; `dag-only` arm identity;
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
per-hunk reply files, incremental fold protocol (`remaining`/`complete`),
big-stack fold thread, `hunksFile`/`hunkCount` fields, rewritten
`RESOLVER_PROMPT` + STEP + `FOLD_SCHEMA` fields, work-list resolver loop,
`contend-big` fixture, two harvester fields.
Removes (Phase 1): `RESOLVER_LINE_CAP` and every size term (`dispatchable`,
`fold_eligible`, `_renarration_dispatchable`), markerless whole-file
re-narration shape and its `attempt ≤ 2` budget, the `_touched_at`/epoch
staleness refusal (#143 machinery), the "fold everything then narrate"
shape. (Rev 1's `KERNEL_LINE_CEILING` deleted at trim review.)
Adds (Phase 2): `Commutes:` marker + two consumers, `composition-unpinned`
render + manifest row, Files-less/`catch-all` grammar refusals, `dag-only`
arm identity, corpus edge-diff pin, ultraplan body-relaxation rule (one
exception), P6 prose line.
Removes (Phase 2): compiler tiers `write-after-write` (+ pre-filter),
`ambiguous-files`, `prose-reference`/`description-inferred`, `catch-all`,
overlap→interface promotion, `read-after-write`'s modify half; ultraplan
phantom-edge rules; the agent-based waves-file preflight (+ 4 sim
scenarios); ~1k lines of compiler self-defense expected to go with them;
ultraplan SKILL.md −400 words net.

## Trim review

Fresh-context rounds to diminishing returns; adopt-or-answer per round; the
reviewer — never the author — grades `netConceptDelta`.

### Round 1 (fresh-context reviewer; grade rev 1: Phase 1 **up**, Phase 2 **flat**, Phase 3 **flat**, overall **flat** — "trends down if T1, T7–T9 adopted and B1 resolves via (A)")

Blockers — all resolved:
- **B1** re-narration mechanism did not exist (kernel annotates a pair at fold
  time only; frontier is marker-free) and on the target shape most first-round
  replies would be stale by construction. **ADOPTED (A): incremental fold** —
  §1b rewritten; staleness/re-narration/#143 machinery retire.
- **B2** arm A mis-specified per fixture. **ADOPTED**: arm A =
  `--arm-overlap serialize` at 0.2.14; contend-big carries E1″/E2″;
  contend-prod is a mechanics cell; the floors re-verification run is not
  the counted arm A.
- **B3** `Files:` unenforced once `ambiguous-files` goes. **ADOPTED**:
  Files-less implementation task = compile/`--check` refusal (grammar lane,
  like globs).
- **B4** `composition-unpinned` as a `deferredVerification` ack collides with
  the standing grant and the fold-rate target. **ADOPTED**: render +
  residual-manifest row, engine-side, no ack (T7); consumer 2 merged into the
  hunk header line (T8).

Trims: 1 ADOPTED (no ceiling constant; big-stack thread + existing park;
100k pin); 2 ADOPTED (exact marker forms); 3 ADOPTED (marker forms
corrected, round-trip restated); 4 ADOPTED (claim dropped); 5 ADOPTED
(token-share reading from T15 transcripts is the plan's first task);
6 ADOPTED (contend-prod = mechanics cell); 7, 8 ADOPTED (see B4);
9 ADOPTED (exception set = `Review: adversarial` only); 10 ADOPTED
(`read-after-write` → `creates ∩ reads`); 11 ADOPTED (`serialize` keeps the
whole legacy tier set); 12 ADOPTED (edge-multiset diff pin; makespan clause
dropped; 100 files); 13 ADOPTED (planning wall → observation; word/turn
counts); 14 ADOPTED (one metric: critical-path recovery, modeled + measured);
15 ADOPTED (waves-file preflight = Phase-2 deletion; P6 prose carried).

Under-specification fixes: per-hunk reply files replace the delimited
grammar (bijective via `split_lines`, no escaping); STEP + `FOLD_SCHEMA`
named alongside `RESOLVER_PROMPT`; thread marshalling, `stack_size`
`ValueError` fallback, bound sized from weave entries; `contend-big` seal
copy + `FIXTURES` pin, one fixture per cell; `catch-all` label refusal,
expected-contention derivation without `dropped_pairs`, `dag-only` identity;
`MARKER_COMMUTES` + rendered conflict for a path outside own `Files:`; word
budget stated; fold-rate metric given a mechanical denominator;
`tests/frontier_merge.mjs` named. Scope note recorded: expansions beyond the
design-inputs note (big-stack thread, `contend-big`, incremental fold, two
architectural releases) each carry their evidence line above; P6 carried,
do-not-port decided, ledger comparability preserved.
