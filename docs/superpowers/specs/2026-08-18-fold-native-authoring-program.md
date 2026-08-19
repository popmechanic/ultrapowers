# Fold-native authoring program — Phase 1 (resolver reach), Phase 2 (authoring/compiler subtraction + composition contracts), Phase 3 (engine decision rule)

_Program spec 2026-08-18, rev 6 — FINAL after trim review (5 rounds to terminal clean; round 5 verdict `ended`: B14 + T27 + nine wording items applied; reviewer's grade Phase 1 flat / Phase 2 down / Phase 3 flat / overall **down** — see §Trim review). Brainstormed 2026-08-18
against `2026-08-18-rewrite-design-inputs.md` §5 (the value-ranked synthesis)
with the operator; three phases, each its own plan and release, each gated by
a pre-registered measurement. Nothing architectural is kept on principle —
including waves; every retained mechanism earns its place against the three
values (quality > tokens > clock) at each phase gate. Phase 1 and Phase 2 are
specified plan-ready; Phase 3 is a decision rule only. The frozen
verification periphery (gate/seal/lock scripts) is untouched throughout;
**the compiler's diagnostic vocabulary — also frozen by CLAUDE.md, "change
only for an eval-measured regression" — does change in Phase 2, and this
spec names the licensing measurement**: it is a **measured-inert deletion**,
adjudicated by the operator — the corpus reading (§2a: 0 edges from the
deleted tiers on 97 marked plans except 3 prose-reference), plus the Phase-2
T15-rig run recording E1/E2 against the Phase-1 cell as a named `ab_runner`
"no regression" number, plus the live fold-canary — per the subtraction-eval
doctrine (delete behind a measurement gate, never argue). No direct API
calls; markers stay additive and
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
  exam (mechanically: `composition-unpinned` residual-manifest rows trend to zero).
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
- Sensor: `skills/ultralearn/scripts/harvest_runs.py`, `skills/ultrapowers/scripts/audit_run.py`,
  `references/reading-lenses.md`.
- Docs that change with the code: `skills/ultrapowers/kernel/FOLD_LOG.md`,
  `skills/ultrapowers/references/report-format.md`, and `CLAUDE.md` (the
  frozen-vocabulary paragraph gains the measured-inert-deletion clause).
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
HUNK h1 lines 118-131
--- context (read-only)
  <up to CONTEXT_LINES unmarked lines before>
--- conflict
<<<<<<< begin added frontier
...
>>>>>>> end conflict
--- context (read-only)
  <up to CONTEXT_LINES unmarked lines after>

HUNK h2 lines 402-409
...
```

Line spans index the annotated file and cover the **block only** (context
excluded). `CONTEXT_LINES = 40` (module constant,
`fold_wave.py`); context is truncated at a neighbouring block's markers when
blocks lie closer than 2·CONTEXT_LINES, so no marker line ever appears as
context. Marker side labels are `frontier`, `<task>`, or `both` (the kernel's
`added both` form). **`added both` segments are reply-owned** (they are
lines inside the block; the reply must carry them or the resolver is
dropping shared content — the prompt says so), **except the EOF case (trim
rounds 3–4, B9/B12, verified against `merge_states`):** a block terminates
only at a non-blank line present on both sides, so every `added both`
segment is whitespace-only by construction; when the file's last block ends
at EOF and its final segment is `added both`, `derive` moves **that whole
segment** (`[""]` for a file ending `\n`, `["", ""]` for `\n\n`, …) out of the
block into trailing context, so a resolver writing `x\ny\n` keeps the file's
final newline and trailing blanks; files without a final newline carry no
trailing `""` and the rule does not fire. The fuzz set includes the `\n`,
`\n\n`, and no-final-newline shapes. Only `Conflict.kind == "lines"`
and `add/add` narrations carry markers and get hunks; presence/binary kinds
have no markers and stay parked as today. If the merged content itself
contains a line byte-equal to an exact marker form (a repo whose sources
quote kernel markers), `derive` cannot delimit blocks and **parks that
conflict with a named reason** (`marker-shaped content`) rather than guess.
Hunk ids are positional and stable for the life of the
narration file; narration indices `<i>` are monotonic across the incremental
CLI calls (`resolve` appends at `next_i`, the existing re-narration
precedent). `conflicts.json`
entries gain `"hunksFile"` and `"hunkCount"` (additive). The resolver brief
names the hunks file and a **reply directory**; the reply is **one file per
hunk** — `reply-<i>-<m>/h1.txt`, `h2.txt`, … plus `notes.txt` — with a
**hunk-scoped grammar** (trim round 2: the whole-file `split_lines`
convention is wrong at hunk scope — `split_lines("")` is `[""]`, and a hunk
is an interior segment): a hunk file is a sequence of `\n`-terminated lines;
**an empty file is zero lines** (a deletion), `"a\nb\n"` is exactly `["a",
"b"]`, and a final line without `\n` is a rejection. The whole file's
final-newline status is inherited from the narration, never from a hunk.
No delimiter grammar, no escaping, no `delete` token. When both sides of a hunk declared `Commutes:` (Phase 2, §2b) the
hunk header carries one extra line: `contract: both sides declared these
edits commutative — union, preserve each side's internal order, do not
reorder existing lines`.

`cmd_resolve` **splices**: it re-reads `conflict-<i>.txt`, replaces each
marked block (all marker lines and all segments, inclusive) with that hunk's
reply lines, leaves every context line byte-identical, and hands the
resulting whole-file line list to the existing `apply_resolution`. Nothing
below the splice changes: log schema (three event types), `rehydrate`,
`replay`, K-gates.

Rejections (each a named reason on the CLI's stdout, reported by the merge
agent as the new `REJECTED` FOLD_SCHEMA status; the engine's existing
`attempt ≤ 2` structure is **re-purposed** (not removed) as the
reply-rejection retry — one resolver retry against the *same* hunks file
with the rejection reason appended to the brief, reply dir `reply-<i>-2/`,
then park → fallback; BLOCKED stays an immediate fallback as today): a
missing `h<k>.txt` (omitted hunk); an extra `h<k>.txt` (unknown hunk); a
final line without `\n`; any reply line byte-equal to a kernel marker form
(`<<<<<<< begin `, `======= begin `, `>>>>>>> end conflict` — the exact
forms, never a bare `=======`, which is legal Markdown/RST). Context lines
are never in the reply, so touching context is inexpressible. The report's
`resolverTranscripts.replyFile` becomes `replyDir` (report-format.md).

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

Change — **fold incrementally.** The wave's task list is re-supplied on
every CLI call as the same `<taskId>=<branch>:<headSha>` triples `fold`
takes today (the launch args carry them); the fold log is the authority for
what has folded: its `fold` events must be an `(id, headSha)` **prefix** of
the supplied list over the same `base` sha, else the CLI refuses (exit 2,
`log/list disagreement`). `remaining` = supplied list minus that prefix.
`complete` = **derived, never recorded**: all tasks folded ∧
`_unresolved_paths` empty.

**Park pre-scan (trim round 3):** `fold`'s first call runs today's
whole-wave fold once in-memory (0.8s, existing code, inside the big-stack
thread; no log written) and reports `parked` up front — no resolver is ever
spent on a wave that will park, and the `parked` guard stays on the fold
reply only. The pre-scan's park set is **⊇** the incremental pass's
(conservative: text-only resolutions never create parks — the reply grammar
rejects marker forms and presence/binary pairings are monotone — while a
resolution can remove a marker-shaped base line a later narration would
otherwise carry). A `RecursionError` in the pre-scan writes the kernel-limit
park entry, a log with `base` only, and exits 3. Then the incremental pass:

| call | does | stdout (JSON, one line) | exit |
|---|---|---|---|
| `fold` (first call) | pre-scan; fold in order until the first fold that opens ≥1 `lines`/`add-add` conflict, or all fold | `{clean, conflicts, dispatchable, parked, open: [{i, path, kind, epoch, hunksFile, hunkCount}], remaining: [...], complete: bool, selfChecks?}` — `conflicts`/`dispatchable` count **this stop's** `open` (never cumulative); `parked` rides the fold reply only; `selfChecks` present **only** when `complete` (run then) | 0; 2 log already exists (today's refusal, kept); 3 if `selfChecks` present and not `ok` |
| `resolve --conflict <i> --reply-dir D <triples>` | locate the narration by its `conflicts.json` index `i` (the key `open`/`waiting` already carry; `(path, epoch)` is not unique when a presence park shares the pair); grammar-check the reply (rejections above), splice, `apply_resolution` at the entry's `epoch`; if all open entries of this stop are now applied, **continue folding** to the next stop or completion. The current stop = the `conflicts.json` entries at the max narrated epoch; `waiting` = those entries whose path has no resolve event at-or-after that epoch, listed by `i` | applied + waiting: `{applied: true, waiting: [i,...]}` (count-free; other entries of the stop still open — not complete); applied + new stop: `{applied: true, conflicts, dispatchable, open: [...], remaining: [...], complete: false}` (`conflicts == dispatchable == open.length`, the fold-row rule); applied + complete: `{applied: true, open: [], remaining: [], complete: true, selfChecks}`; stale: `{applied: false, stale: true}`; rejected: `{applied: false, rejected: true, reason}` | 0; 2 stale / log-list disagreement; 3 self-check failure or a mid-pass `RecursionError` (kernel-limit park entry written — the existing precedent, not a new lane); **4 rejected** (distinct from stale so the STEP maps REJECTED vs ERROR) |
| `materialize <task-heads>` | **completeness refusal (trim round 3, B10):** refuse unless every supplied `(id, headSha)` has a matching `fold` event **and** `_unresolved_paths` is empty — a materialize issued before `complete` would otherwise build a candidate omitting every unfolded task and adopt it on a green suite | `{fallback: "incomplete fold: <n> task(s) unfolded / <m> path(s) unresolved"}` (the CLI's fallback convention; no park record) | 3 → fallback |

**STEP status mapping (baked contended-merge prompt, the engine's work-list
contract):** `parked > 0` on the fold reply ⇒ `PARKED` (order-first, as
today; the pre-scan's parks are `conflicts.json` entries with
`dispatchable: false` + a `conflict-<i>.txt` reason — the T15 "every park
named" gate reads them; a parked pre-scan writes no log and runs no
incremental pass); the engine keeps the outstanding set itself; `open`
non-empty ⇒ `CONFLICTS` with `conflicts == dispatchable == open.length`
(count authority; the missing-count guard is scoped to open-bearing
replies); `applied + waiting` ⇒ `CONFLICTS` with `open: []` and `waiting`
equal to the engine's outstanding set (count authority — the empty-`open`
guard is re-scoped to require `waiting`); `complete` ⇒ `FOLDED` with
`selfChecks`; exit 4 ⇒ `REJECTED`; any other non-zero ⇒ `ERROR`. Open
entries are `{i, path, kind, epoch, hunksFile, hunkCount}` (`narrationFile`
drops); `resolverTranscripts` gains `hunksFile` and `replyDir` (report-format
line to match), keyed on the CLI `i`, not the loop index. STEP fold,
resolve, and adopt each time their invocation; `foldCliWallTimeSec` = the
sum, `foldCliCalls` = the count of fold + resolve + materialize invocations
— both engine-side (the CLI keeps no cross-process counter).

Every narration is therefore fresh against the resolved frontier: exactly
one dispatch per conflicting fold event, no stale replies, no re-narration.
Task 1 can never conflict; the first possible stop is fold 2.

Retires: markerless whole-file re-narration, `_renarration_dispatchable`,
and re-narration as the *response* to staleness. **Kept (trim round 2, B5):
the 4-line `_touched_at`/epoch refusal in `apply_resolution`** — it is the
idempotency guard: the STEP is agent-driven, and a re-issued `resolve`
(command retried after the log append) would otherwise re-apply old
whole-file lines *after* the continued fold and silently clobber the next
task's contribution. Its response changes: stale → exit 2, a named refusal
→ fallback; no re-narration. `epoch` therefore keeps an honest meaning (the
position the resolution applies at; `_unresolved_paths`' #144 guard reads
it; replay does not). Order-independence self-checks (raw shuffle over the
*raw* folds; rehydrate-manifest replay) run at completion — inside whichever
call completes (`fold` when the wave is clean, else the last `resolve`).
`kernel/FOLD_LOG.md`'s resolve prose is rewritten to match (it is a "Where
it lives" file). Report/`frontierEntry`: `selfChecks` is sourced from the
completing reply; `foldCliWallTimeSec`/`foldCliCalls` per the STEP mapping
above.

Engine loop (`waves.js`, baked STEP-resolve prompt): the
resolve→CONFLICTS→open loop becomes a **work-list until `complete`**:
(i) when one stop opens more than one entry (distinct paths), folding
continues only after *all* open entries of that stop are applied (the
`waiting` reply); (ii) the count-authority guards (open-list vs counts)
apply to **every** open-bearing reply; the `selfChecks` guard applies to the
**completing** reply only (re-scoped from "unconditional on the fold reply"
— a stop reply carries no `selfChecks`); (iii) `FOLD_SCHEMA` gains status
`REJECTED` (reply grammar rejection → retry, distinguishable from ERROR →
fallback) and fields `hunksFile`, `remaining`, `complete`, `waiting`;
(iv) the existing budget checkpoint per dispatch and routes stay: BLOCKED
(immediate, as today), REJECTED after one retry, stale refusal, log/list
disagreement, incomplete materialize, budget exhaustion, or a self-check
failure → fallback (still live before adoption).

### 1c. Resolver prompt (baked) and dispatch

`RESOLVER_PROMPT` rewritten for the hunk shape in `references/wave-merge.md`
and re-baked into `waves.js` (`test_no_prompt_drift` pins it). Contract: read
the hunks file; for each `HUNK` write the resolved lines — carrying every
`added both` line (shared content inside the block); honor both sides'
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
  before creation (a `ValueError` from `stack_size` or a `RuntimeError` from
  `Thread.start()` — Linux under strict overcommit fails the mmap at start —
  → run in the main thread and say so on stderr), marshalling result and exception back to the main
  thread so exit codes are unchanged; inside the thread the recursion limit is set
  once to a large fixed value (`THREAD_RECURSION_LIMIT = 1_000_000`; trim
  round 3 — with a 1 GiB stack the frame count is not the constraint, and
  entry-count sizing needs states in hand before rehydrate, which folds);
  `_recursion_headroom`'s sizing retires with it. The existing `RecursionError` → kernel-limit park (exit
  3, `conflicts.json` record) remains the only ceiling. Pinned by a
  subprocess test that folds a 100k-line synthetic pair and asserts success
  (on every interpreter; on ≤3.10 the thread is what makes it true — CI is
  3.11, so the thread is exercised where `python3` ≤ 3.10) — never exit 139.
- Cap-era wording goes with the constant: `frontier_fold.py`'s module
  docstring ("<= 400 visible lines") and `_kernel_limit_entry`'s "bound"
  phrasing.
- The iterative rewrite of the recursive core is deferred; the sensor field
  (largest text file folded per run, §1f) is the trigger.

### 1e. Fixture `contend-big` and the Phase-1 gate

No new calibration campaign (T14 took 8 attempts). `evals/fixtures/contend-big/`
= `contend-prod` frozen at `486f02a` with `app/registry.py` inflated to
≈6,000 lines of realistic surrounding module (declarations, docstrings,
helpers the tasks never touch; the registration hub, its config block and
wiring section unchanged and in the same relative positions). The sealed
exam dir is a byte-identical copy (same seal id `4d131df61152`, added to
`tests/test_fixture_seals.py::FIXTURES`); the project suite is green on the
fixture's base, the sealed exam red on base (by construction) and green on
both integrated trees. Implementer floors are a **counted condition, not assumed** (trim round 3:
a 147→6,000-line module changes read cost even though the plan text is
position-relative): the arm-A re-verification run must show each
implementer ≥ its T14 floor, else the fixture is re-shaped before any
counted cell; that run is **not** the counted arm A (T14/T15 selection-bias
rule).

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

- The fold CLI writes `frontier/wave-<n>/fold_stats.json` holding the one
  fact nothing else records: `maxLines` per fold call (largest text file
  folded); `hunkCount`/`dispatchable`/`parked` are already in
  `conflicts.json`, `foldCliCalls` is engine-side (FOLD_LOG's one-fact rule).
  `harvest_runs.py` carries it into the bundle and the fold-canary lens reads
  it (a clean wave still writes it).
- Phase 3's DAG source: the harvester carries `launch.json`'s `waves` and
  `edges` (the compiled DAG the run actually executed) into the bundle.
- Per-task wall (Phase 3's measured leg needs a source — the harness has
  no timers and report.json carries no durations): `audit_run.py` gains
  `wallSec` per agent = last − first record timestamp of that agent's
  `agent-*.jsonl` (the transcript dir the harvester already audits; records
  carry per-record ISO timestamps), keyed by the existing `impl:<id>` role
  and **summed** across an id's transcripts (an auto-escalate retry leaves
  two); the harvester carries it into the bundle.
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
`write-after-create` (no base to fold a modify onto until the creator lands;
2 real edges in the corpus). **Delete** — including `read-after-write`
(trim round 3: 0 edges under either mode across 97 plans; its honest
residue, a `Test:` naming a file a sibling creates, is covered by
`Depends-on` and ultraplan's retained test-import rule; a same-wave
Test-reader/creator pair therefore routes to the fold path via `files`,
which still includes reads, and folds clean) — (write ordering and guesses): `write-after-write` and its
`fold_eligible` pre-filter (the fold path owns same-file writes;
non-text/symlink route to fallback at merge), `ambiguous-files` fan-in,
`prose-reference` / `description-inferred`, and `catch-all` (the
`- catch-all:` Files label becomes a grammar violation with a did-you-mean).
**The marker→`interface` label promotion clause stays** (trim round 4, B13:
15 of the corpus's 17 `interface` edges are promotions of a declared marker
edge; deleting the clause would fail the pre-registered migration answer);
only the undeclared-dependency finding's overlap-suppression term shrinks to
{`write-after-create`, `write-after-write`} — the latter survives under the
`serialize` rollback knob, so serialize-mode plans gain no new finding. Brace globs
(`src/{a,b}.py`) join the glob refusal (`{` added to the refused
characters) — today they are left to the deleted `ambiguous-files` tier. **A marked `**Type:** implementation` task with no
parseable path under any `Files:` label (Create/Modify/Test) becomes a
`--check`/compile refusal** (two archived marked plans carry a Test-only
implementation task and stay OK under this reading) (grammar,
alongside the glob refusal; heuristic-classified tasks in unmarked
pre-ultraplan plans are exempt — trim round 3, B11 — so the corpus pin's
OK/fail set is unchanged) — the deleted `ambiguous-files` tier was the only
thing serializing such a task, and a Files-less task is invisible to
merge-time contention detection. `Files:` blocks otherwise stay required —
reviewer-packet scope and the transparency render's *expected contention*
(now derived from same-wave `Files:` intersections directly, no
`dropped_pairs`) — and never create an edge. `--check` grammar +
did-you-mean stay. **`--overlap serialize` = the `write-after-write` tier only** (trim
round 2: the `catch-all` and Files-less refusals are parse-time and
mode-independent, so `ambiguous-files`/`catch-all` cannot survive under any
mode; `prose-reference` goes in both modes — 3 edges in 2 archived plans
under the rollback knob) until the canary reads; then it is a deletion
candidate. The `fully_overlapping` degrade (`mode: sequential` when every
pair overlaps) goes with `dropped_pairs`; the single-task degrade trigger
stays. `- none` under `Files:` on an `implementation` task is the same
refusal as no paths.
`assert_arm_identity`'s existing fold branch gains the check "every edge's
`why` ∈ the kept set" for Phase-2 cells (a compiler-version check, not an
arm check; no new named predicate).

Pins: **corpus regression** — every archived plan under `docs/superpowers/plans/`
(100 files at 0.2.14; `tests/test_all_plans_compile.py` is the existing
seat) compiles with the same PLAN OK / fail set as at 0.2.14 (the standing pin);
the per-plan **edge multiset diff by why-label** is a **one-time migration
reading** recorded under `evals/frontier/results/` (a 97-plan snapshot is
not a permanent test) against its **pre-registered answer** (measured at
rev 3 and re-verified at round 3 over the 97 marked plans, all compiling in
both modes: marker 180, interface 17, write-after-create 2, prose-reference
3 in 2 plans, read-after-write 0, ambiguous-files 0, catch-all 0;
write-after-write 35 under `serialize`, 0 under `fold`; 20 plans `mode:
sequential` under fold) — expected diff exactly "−3 prose-reference, plus
any `sequential`-mode flips from the degrade deletion"; the seven fixture
repos' compiled shapes recorded and diffed.

### 2b. Composition contracts — one additive marker, two consumers

`**Commutes:**` — optional header-block marker (own `MARKER_COMMUTES`
regex beside `Review:` **and** added to `MARKER_ISH`, else the line ends the
header block and demotes following markers), comma-separated paths that must appear in the
task's own `Files:` (else a rendered marker conflict, not an error): "my
edits to these files are order-insensitive additive registrations."
Consumers:

1. **Compiler + resolver brief** — a contended pair (same wave, intersecting
   `Files:` writes) where *both* writers declare the path →
   `declared-commutative` in the transparency render and the one-line
   `contract:` header in that path's hunks file (§1a); any writer undeclared
   → `composition-unpinned` in the render (not an edge, not a block).
2. **Report render + residual manifest** — engine-authored, deterministic:
   `contendedMerge` computes it from the wave's declared `files` overlap
   (the `fileSets` `contendedWave` already builds — declared overlap is what
   `Commutes:` is declared against) × each task's `commutes`, and appends
   one **`judgmentCalls` string** per uncontracted multi-writer path, in the
   pinned shape `composition-unpinned: wave <n> <path> — writers <A,B,...>;
   undeclared: <B,...>` (kind *disagreement*; report-format's "new cases
   slot into an existing kind"; the render, the manifest row, and the
   harvester's "rows → 0" read all key on that prefix). To tell writers from
   readers the light launch task object gains two fields, `writes`
   (creates ∪ modifies; `catchAll` precedent) and `commutes` — `files` today
   includes `Test:` reads; when `writes` is absent (hand-authored waves) the
   engine emits no composition rows and says so once in the render. The residual manifest derives its row from `judgmentCalls`
   unchanged (zero change to `residual_manifest.py`; no critic change). The
   kernel CLI receives contracts as `fold`/`resolve --commutes
   <task>=<path,...>` authored from the launch task object (launch args carry
   `commutes` per task; redirect relaunches never fold — `resume` — so
   `redirect_args.py` is untouched). "Both sides declared" for the hunk
   header: the incoming task, and **every already-folded task whose
   `diff_paths(base, head)` touches the path** (derivable from the log + git). Trim round 1: **not** a `deferredVerification` ack — that would
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
  stays (it is now the only thing that orders a `Test:` against a sibling's
  created file — `read-after-write` is deleted). `plan-markers.md` mirrors; the
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
- **Word budget as a plan acceptance number, not a committed test** (trim
  round 3: a word-count test is a ratchet — the class the 0.1.0 subtraction
  release deleted; no ledger evidence ties SKILL growth to a defect):
  ultraplan `SKILL.md` ≤ 3,400 words after the rewrite (3,805 at 0.2.14 — a
  net cut, checked in the PR); ultrapowers `SKILL.md` ≤ 2,920 (2,888 + the P6
  line).
- One sentence the rewrite must keep: with the compile-time pre-filter gone,
  non-text (binary/symlink) same-file pairs run in parallel and always fall
  back — **chain non-text same-file pairs with `Depends-on`**.
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
21.7% max) and **measured** (the same formula with the per-task `wallSec`
§1f records from agent transcripts and the launch DAG). **Rule:** if median *measured* recovery across ≥10 real
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
pins: n writers on one path → exactly n−1 dispatches, the §1b protocol
table (every stdout shape and exit), park pre-scan, `waiting` on a
multi-open stop, log-vs-list disagreement refusal, re-issued `resolve` →
stale refusal (idempotency), `materialize` incomplete refusal, self-checks
in the completing call (exit 3), EOF `added both` newline case,
marker-shaped-content park; `dispatchable` has no size term;
`_renarration_dispatchable` deleted (its tests removed, not skipped); sim scenarios in `tests/frontier_merge.mjs` (sentinel; named
inventory): scenario 3 (stale → markerless re-narration) rewritten as stale
→ fallback; 9m inverted (REJECTED → one retry; ERROR → immediate fallback);
9f stays fold-only plus the new legal shape (`CONFLICTS`, `open: []`,
`waiting == outstanding`); 9d/9o keep the FOLDED/completing scope plus a new
"CONFLICTS stop reply carries no `selfChecks` and is not checked" scenario;
9e/9g/9h/9i/9n keep; new: work-list loop to `complete`, PARKED pre-scan,
budget exhaustion mid-list, count-authority on a continued-fold reply —
mutation-verified like every existing guard; baked-prompt pins green after re-bake (RESOLVER_PROMPT
+ contended-merge STEP; `FOLD_SCHEMA` is JS-only and pinned by the sim); ab_runner `contend-big` cell +
mechanics cell recorded under `evals/frontier/results/`; harvester fields
pinned by fixture; T15-transcript token-share reading recorded before the
build (plan task 1).
Phase 2: corpus regression pin; compiler tests rewritten to the kept tiers
(deleted-tier tests removed, not skipped; `serialize` = write-after-write
pinned); marked-implementation Files-less refusal + `catch-all` label
refusal pinned; `Commutes:` grammar + two consumers + `writes` launch field
+ the `composition-unpinned:` string shape pinned; `judgmentCalls` composition
string + manifest-row derivation pin; `--commutes` CLI + args plumbing;
`fully_overlapping` degrade deletion; kept-set edge check in the fold
identity branch; migration reading recorded;
rubric two-leg pin; ultraplan validator; T15 rig mechanics re-run.
Cross-phase: the Phase-2 T15 rig run is the integration acceptance.

## Error handling

Every new failure is a named park / rejection / stale refusal in existing
lanes, or a `judgmentCalls` string; no new refusal paths beyond the two
compile-time grammar refusals; no silent greens. Rollbacks:
`--overlap serialize` (both phases); `Commutes:` optional (Phase 2).

## Release

Phase 1 → 0.3.0 (architectural: cap retired, brief shape changed). Phase 2 →
0.4.0. Both manifests, `chore(release)` commit, main CI green confirmed.

## Adds / Removes (author disclosure for trim review)

Adds (Phase 1): hunks derivation + splice in `fold_wave.py`, `CONTEXT_LINES`,
per-hunk reply files, incremental fold protocol (`remaining`/`complete`/
`waiting`, park pre-scan, materialize completeness refusal), big-stack fold
thread with a fixed recursion limit, `fold_stats.json`, `hunksFile`/`hunkCount` fields, rewritten
`RESOLVER_PROMPT` + STEP + `FOLD_SCHEMA` fields, work-list resolver loop,
`contend-big` fixture, four sensor fields (`maxLines`, launch DAG,
`wallSec`, planning word/turn counts).
Removes (Phase 1): `RESOLVER_LINE_CAP` and every size term (`dispatchable`,
`fold_eligible`, `_renarration_dispatchable`), markerless whole-file
re-narration shape, the `_touched_at`/epoch
re-narrate *response* to staleness (the 4-line epoch refusal itself is
kept as the idempotency guard; the `attempt ≤ 2` structure is re-purposed,
not removed), the "fold everything then narrate" shape, `_recursion_headroom`
sizing. (Rev 1's `KERNEL_LINE_CEILING` deleted at trim review.)
Adds (Phase 2): `Commutes:` marker + two consumers (hunk-header contract
line via `--commutes`; engine-authored `judgmentCalls` string) + the
`writes`/`commutes` launch fields, `composition-unpinned` render + manifest
row, Files-less/`catch-all`/brace-glob grammar refusals, kept-set edge check
in the fold identity branch, one-time migration reading, ultraplan
body-relaxation rule (one exception), P6 prose line.
Removes (Phase 2): compiler tiers `write-after-write` (+ pre-filter),
`ambiguous-files`, `prose-reference`/`description-inferred`, `catch-all`,
`read-after-write`, the `fully_overlapping` degrade; ultraplan
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

### Round 2 (fresh-context reviewer; grade rev 2: Phase 1 **flat** (up if B5's deletion stood), Phase 2 **down**, Phase 3 **flat**; overall **flat, trending down**; LOOP VERDICT continue)

Round-1 adoption check: B2, T1, T5, T6, T9, T10, T12–T15 landed cleanly;
B1 landed with three stale spots (retry-lane semantics, `epoch`
justification, self-checks moving into `resolve`) — all fixed in rev 3;
B4's "conflicts.json writers" was ungrounded — replaced (trim 1); T11
contradicted the parse-time refusals — resolved (B7).

Blockers — all resolved: **B5** keep the 4-line epoch refusal as the
idempotency guard, retire only the re-narrate response (ADOPTED); **B6**
hunk-scoped reply grammar (`\n`-terminated lines, empty file = zero lines,
final newline inherited from the narration; `delete` token dropped)
(ADOPTED); **B7** `serialize` = `write-after-write` only; `ambiguous-files`
/ `catch-all` deleted in both modes (ADOPTED); **B8** measured per-task wall
now has a named source — `audit_run.py wallSec` from agent transcript
timestamps, recorded from Phase 1 (ADOPTED).

Trims: 1 ADOPTED (engine-authored `judgmentCalls` string from declared
overlap × commutes; zero manifest change); 2 ADOPTED (see B7); 3 ADOPTED
(`of N` dropped, context truncation at neighbouring markers, `both` side
label); 4 ADOPTED (exam red on base); 5 ADOPTED (budgets pinned by a test;
2,920); 6 ADOPTED (`RuntimeError` fallback; CI-version note); 7 ADOPTED
(`fully_overlapping` degrade deleted, single-task trigger kept); 8 ADOPTED
(`cmd_fold --commutes`, launch/redirect args carry `commutes`); 9 ADOPTED
(pre-registered corpus diff). Under-spec fixes: `REJECTED` status,
count-authority guards on every reply, multi-open continuation rule,
monotonic `<i>`, `replyDir`, `- none` refusal, `dag-only` = compiler check,
FOLD_LOG.md in scope.

### Round 3 (fresh-context reviewer, buildability focus; grade rev 3: Phase 1 **flat**, Phase 2 **down**, Phase 3 **flat**; overall **down, conditional**; "not plan-ready for §1a/§1b" — LOOP VERDICT continue)

Round-2 adoption check: B5–B8 and trims 1–9 landed coherently; four stale
spots fixed in rev 4 — the "frozen periphery untouched" claim now names the
compiler-vocabulary change and its licensing measurement; `selfChecks`
guard re-scoped to the completing reply; `frontierEntry.selfChecks` /
`foldCliWallTimeSec` sourcing stated; `redirect_args.py` struck (redirects
never fold).

Blockers — all resolved: **B9** EOF `added both` `""` moves to trailing
context; `added both` segments are otherwise reply-owned (ADOPTED); **B10**
`materialize` completeness refusal (ADOPTED); **B11** Files-less refusal
scoped to marked implementation tasks (ADOPTED).

Trims: T16 ADOPTED (`read-after-write` deleted — 0 edges); T17 ADOPTED
(park pre-scan); T18 ADOPTED (fixed thread recursion limit, sizing retired);
T19 ADOPTED (budgets = plan acceptance numbers, no committed test); T20
ADOPTED (edge diff = one-time migration reading); T21 ADOPTED (kept-set
check in the existing fold identity branch); T22 ADOPTED; T23 ADOPTED
(floors = counted condition).

Under-specification (buildability) fixes: U1/U2 → the §1b protocol table
(every call, stdout shape, exit; `complete` derived, never recorded); U3 →
marker-shaped-content park + kinds; U4 → frontier side = already-folded
tasks touching the path; U5 → `fold_stats.json`, `wallSec` summed per id,
DAG carried into the bundle; U6 → pinned `composition-unpinned:` string +
`writes` launch field; U7 → "chain non-text same-file pairs" sentence; U8 →
block-only spans; U9 → retry against the same hunks file, `reply-<i>-2/`.

### Round 4 (fresh-context reviewer; grade rev 4: Phase 1 **flat**, Phase 2 **down**, Phase 3 **flat**; overall **down**; "Phase 1 plan-writable after B12 and the STEP mapping; Phase 2 after B13/#8/#9" — LOOP VERDICT continue)

Round-3 adoption check: B10, B11, T17–T19, T23, U1–U9 landed; stale residue
fixed in rev 5 (read-after-write "kept" in §2c and duplicated in Removes;
`_recursion_headroom` sizing listed under Phase 2; `dag-only`/edge-diff
"pin" wording; `attempt ≤ 2` removed-vs-repurposed; BLOCKED retry wording).
T22 (round 3) = strike `redirect_args.py` from commutes plumbing —
redirects relaunch with `resume: true` and never fold.

Blockers — resolved: **B12** EOF rule moves the whole whitespace-only
`added both` segment (`\n`, `\n\n`, no-newline shapes in the fuzz set)
(ADOPTED); **B13** marker→interface promotion clause kept; only the
finding's suppression term shrinks (ADOPTED).

Trims: T24 ADOPTED (`fold_stats.json` = `maxLines` only; `foldCliCalls`
engine-side); T25 ADOPTED (pre-scan park set ⊇, conservative); T26 ADOPTED
(materialize incomplete = `{fallback}` exit 3, no park record).

Under-specification fixes: STEP status mapping written (outstanding set
engine-side; `waiting` count authority; `open`⇒CONFLICTS; `complete`⇒FOLDED;
exit 4⇒REJECTED; else ERROR); STEP fold/resolve/adopt all timed, sum + count
engine-side; fold exit 2 kept; pre-scan RecursionError behavior; `resolve`
locates by `(path, epoch)`; prompt names `added both`; cap-era docstrings
owned; `MARKER_ISH`; brace globs refused; `writes`/`commutes` on the launch
object with the absent-`writes` policy; frozen-vocabulary licensing named as
a measured-inert deletion with an `ab_runner` no-regression number.

### Round 5 (fresh-context reviewer; grade rev 5: Phase 1 **flat**, Phase 2 **down**, Phase 3 **flat**; overall **down** — LOOP VERDICT **ended**: "nothing this round changes a mechanism, a contract's semantics, or a test seam beyond reconciling the spec with itself")

Round-4 adoption check: all items present. **B14** (protocol table vs STEP
mapping disagreed on the continued-fold reply's counts) — ADOPTED: the
new-stop `resolve` reply carries `conflicts`/`dispatchable`; the `waiting`
reply is count-free; the missing-count guard is scoped to open-bearing
replies. **T27** (locate by `--conflict <i>`) — ADOPTED (smaller;
`(path, epoch)` is not unique against a presence park). Wording items 1–9
applied: PARKED row + pre-scan park recording; mid-pass `RecursionError`
follows the kernel-limit precedent; stop/`waiting` derivation; open-entry
shape + `resolverTranscripts`; named sim inventory; B13 suppression term =
{write-after-create, write-after-write}; Files-less = no path under any
label; CLAUDE.md/FOLD_LOG.md/audit_run.py/report-format.md in scope;
Adds/Removes staleness. Reviewer's grounding this round strengthened two
claims: the pre-scan ⊇ property holds by kernel structure (group boundaries
ignore visibility), and every `added both` segment is whitespace-only by
construction.

Under-specification fixes (round 1): per-hunk reply files replace the delimited
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
