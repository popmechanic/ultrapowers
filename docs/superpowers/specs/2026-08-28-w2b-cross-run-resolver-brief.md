# W2b cross-run resolver brief

**Date:** 2026-08-28
**Program:** Width Program (`2026-08-21-width-program.md` §W2b, trim U4;
W2 charter = the 2026-08-27 operator comment on #189)
**Status:** design deliverable — awaiting operator endorsement; no W2b
build starts before that endorsement.

This spec is the named W2b design deliverable: the resolver brief a
docket-frontier fold dispatches when two gate-green runs' branches
conflict textually. The in-wave brief's contending-context block is
per-plan, so it cannot be reused across runs; this spec defines how the
docket-level block is rebuilt from the contending runs' plan task
bodies. "Same as in-wave" is the **contract** (hunks file in, reply
directory out, one dispatch at a time), not the brief text (trim U4).
The fold kernel CLI is consumed as a caller only; the kernel, the
engine surfaces (`harnesses/waves.js`), and the frozen periphery are
untouchable — this spec changes no code and edits no baked prompt.

## 1. Baseline — the in-wave brief, recorded

Recorded by citation, not by copy (the W3-table rule: cite the source so
an amendment cannot leave a stale second copy). The sources of truth are
the baked-prompt blocks in the ultrapowers skill's references, pinned
into `waves.js` by `tests/test_no_prompt_drift.py`:

- **Resolver contract text** — `references/wave-merge.md`
  `<!-- BAKE:RESOLVER_PROMPT -->`: no repo to explore; read exactly the
  named hunks file, write exactly the named reply directory (one file
  per HUNK plus `notes.txt`); never git, never the file under conflict;
  honor both sides' intent, prefer the semantics the contending task
  bodies describe over surface text, never drop a side silently; obey a
  HUNK header's contract line; report RESOLVED or BLOCKED.
- **Guard preamble** — `references/reviewer-prompts.md`
  `<!-- BAKE:GUARD -->`.
- **Dispatch assembly** — per `references/wave-merge.md` §The resolver
  and the engine's resolver dispatch site: the prompt is
  `GUARD + RESOLVER_PROMPT` + an engine-authored `HUNKS:` line (the
  conflicted path and its `conflict-<i>.hunks.txt`) + a `REPLY DIR:`
  line + on the single permitted retry a `PREVIOUS REPLY REJECTED:`
  line carrying the kernel's exit-4 reason — then the
  **contending-context block**, appended outside `fillPaths` because it
  is plan-authored text.
- **The in-wave contending-context block** (`contendingTasksBlock` in
  `waves.js`): the heading `CONTENDING TASKS:`, then one entry per
  merged task of the wave — `- task <id>: <title>`, with a
  `[files: …]` suffix only when the task declares a non-empty file
  list, followed by the task's inline body when present — and,
  whenever the plan was compiled with a waves file (`wavesPath` set,
  regardless of inline bodies), a pointer sending the resolver to that
  compiled JSON to read its entry by id.

Everything in that structure is per-plan at exactly two points: the
task set (one wave of one plan) and the `wavesPath` pointer (one plan's
compiled JSON). Those two points are what §2 rebuilds; every other span
is reused verbatim from the baked sources.

## 2. The docket-level contending-context

**Dispatcher.** The docket-fold driver (fleet side, orchestrator's
integration checkout) — not the run engine. It drives
`kernel/fold_wave.py` as a caller: the incoming run's branch folds onto
the docket frontier ref; a textual stop yields the same on-disk record
as in-wave (`conflicts.json`, `conflict-<i>.txt` narrations,
`conflict-<i>.hunks.txt` briefs), and the driver dispatches one
resolver at a time off the hunks file. Throughout this spec, the
**pre-fold frontier sha** is the sha the docket frontier ref held when
this run's fold began.

**Prompt reuse.** The dispatch is byte-identical to the in-wave
assembly of §1 — GUARD, RESOLVER_PROMPT, `HUNKS:`/`REPLY DIR:`/
rejection lines, same reply grammar and same single-retry rule — except
the contending-context block, which is rebuilt as follows.

**Sides and labels.** A cross-run conflict has exactly two *sides* —
the §W2b "two runs" phrasing names the sides, not a cap on how many
runs' bodies the frontier side may need:

- the **incoming side** — the gate-green run being folded. The driver
  passes the **incoming run id** as the kernel's task identifier
  (`--branch <runId>=<branch>:<headSha>`, the grammar
  `fold_wave.py`'s `_parse_branch` requires), so every HUNK labels its
  incoming side with the same run id the block's entries carry — the
  labels and the brief must agree, and §4.2 asserts it.
- the **frontier side** — every previously folded run whose fold
  commit touched the conflicted path, in fold order. Fold commits are
  identified by a `Fold-Run: <runId>` trailer; the kernel authors its
  candidate with a fixed message and is untouchable, so the driver
  adopts each fold by creating its **own adoption commit** — same tree
  as the kernel's candidate (asserted tree-equal in §4.2), parents
  `[pre-fold frontier sha, run head]`, message carrying the trailer —
  and advances the frontier ref to that commit; the kernel's
  `candidateSha` is recorded beside it in receipts. Attribution walks
  the frontier ref **first-parent only** (the fold-commit spine —
  a full walk would descend into the folded runs' un-trailered task
  commits, and history simplification would skip past tree-same fold
  merges; both misread). Per-path last-touch attribution is an
  accepted approximation at hunk granularity — a given hunk's frontier
  text may predate the newest fold — so the preamble says "most
  recently folded by", and the block carries *all* path-touching
  folded runs' selected tasks rather than only the newest (bounded by
  drain size — charter width ~2; no numeric ceiling in this design,
  revisit on evidence). The walk's boundary is the **incoming run's
  build base** (§Task selection): folds at or before it are common
  history on both sides of every hunk and cannot source frontier-side
  conflict text, so they are noise in the block — and with that
  boundary the walk needs nothing outside §4.3's re-derivation inputs.
  If any first-parent commit touching the path between that boundary
  and the pre-fold frontier sha is not `Fold-Run`-attributable
  (mainline drift between run bases, a manual commit), the brief
  cannot be rebuilt — **park the run** (§3); never dispatch with a
  half brief.

**Task selection.** For each contending run, take the run's marked plan
at the run's **build base**. For the **incoming run** that is the
merge-base of its branch with **this fold's pre-fold frontier sha**,
which equals the `fleet-base` the provisioner pushed for it whether it
dispatched off the drain's starting base or off an advanced frontier
(dependent runs serialize at dispatch, #176); the W2b build records
the resolved sha in the run's receipts at fold time, and the
merge-base derivation is the independent check (§4.2). For a
**frontier-side run** the live derivation does not hold — once folded,
its head is a second parent on the frontier spine, so a merge-base
against the *current* pre-fold sha returns the run's own head — so its
build base is the receipt sha recorded at **its own** fold time
(checked then, against its own fold's pre-fold ref), reused at brief
time. Extract each plan's tasks with the committed compiler
(`compile_plan.py` — never a second parser; its launch emission
already carries full verbatim task bodies). Select the
tasks whose declared file scope (`files`) names the conflicted path —
declared scope only, no diff-derived fallback: a run that edited a
path no task declared has already broken file discipline, and
park-by-default (#181) says park, not improvise a second selector.
A side that selects nothing, or whose selected bodies are empty, or
whose plan fails to compile at that sha, is a missing side — park.

**Block grammar.** The heading stays `CONTENDING TASKS:` — the baked
RESOLVER_PROMPT refers to "the contending task bodies" and is not
edited. Entries qualify the task with its run, because task ids collide
across plans:

```
CONTENDING TASKS:
The frontier side of each hunk was most recently folded by run
<frontier-run-id>; earlier folds by <run-ids…> also touched this
file. The incoming side — labeled <incoming-run-id> in the hunks —
is run <incoming-run-id>.
- run <frontier-run-id> task <id>: <title> [files: …]
<verbatim task body>
- run <incoming-run-id> task <id>: <title> [files: …]
<verbatim task body>
```

(The "earlier folds" sentence is omitted when exactly one frontier run
touched the path. No branch or plan path appears in the block — the
resolver has no repo, and §Execution posture bans naming filesystem
locations beyond the hunks file and reply directory; run branches and
plan paths live in the receipts instead. `[files: …]` follows the in-wave rule —
present only for a non-empty declared list, and here always non-empty
by the selection rule.) Fields per entry: run id, task id, title,
declared files, verbatim body — the in-wave field set plus the run
qualifier, nothing else. Ordering: frontier-side entries first (they
explain the text the hunks label `frontier`), in fold order oldest to
newest, then the incoming run's; within a run, plan order. Bodies are
**embedded verbatim, never pointed to**: there is no single
`wavesPath` across plans, and the assembler is deterministic driver
code, so embedding transcribes nothing through a model (the in-wave
pointer exists to spare a model relay; a program needs no such
sparing). The in-wave pointer line is therefore absent by design.

**Execution posture.** The resolver runs as a dispatched subagent whose
working directory is the fold's receipts directory — never the
orchestrator's integration checkout, whose path is never interpolated
into the prompt — with no git credential. The dispatch vehicle is a
delegated build-plan detail under two constraints: no Anthropic API
key (the no-direct-API doctrine — LLM work rides Claude Code on the
orchestrator host, e.g. `claude -p`), and no pinned resolver
model/tier (the in-wave posture: the resolver runs at the ambient
default); the hunks file and reply
directory are the only **filesystem locations** the prompt names (the
conflicted file's repo-relative name appears in the `HUNKS:` line, as
in-wave, but no location outside the fold's receipts directory does —
the §W1a move: the dispatch posture, not just the prompt text, is the
boundary).

**What the resolver may see:** its hunks file, its reply directory, and
the assembled block above. **What it is not briefed on and must not
read** (prompt discipline, as in-wave — where the resolver has
whole-repo capability and is prompt-forbidden; the cross-run posture
is strictly tighter): the repo (no git —
RESOLVER_PROMPT verbatim), either plan beyond the selected task bodies,
the other conflicts, the docket, the store, receipts, run reports, or
any charter/operator text. **What the assembler may not do:** synthesize
a contract line into any cross-run hunk header — `Commutes:` contracts
are per-plan and no contract exists across runs, so the driver invokes
the kernel with no contract; a HUNK header carrying a contract line in a
cross-run brief is a defect (§4 checks it).

## 3. The park rule

Verbatim from `2026-08-21-width-program.md` §W2b:

> Text conflicts get resolver dispatches under the same kernel contract
> as in-wave (hunks file in, reply directory out, one dispatch at a
> time, cross-run = uncontracted ⇒ semantic contention parks the run,
> no operator turn).

Operationally: every route that in-wave falls back to the ordinary
git-merge + reconcile path (the fallback list in
`references/wave-merge.md` §Fallback — cited, not copied) **parks the
run at docket level** — there is no cross-run reconcile agent (a
multi-run same-file collision is exactly the collision the reconcile
agent was never built for, and park-by-default is #181 doctrine). To
that cited list this spec adds the cross-run-novel park routes: every
missing-side condition from §2 (an un-trailered first-parent touch —
i.e. an unattributable frontier side, no task selects the path, empty
bodies, plan fails to compile). No `Commutes:`-analog route exists: a
conflict that in-wave a contract would auto-resolve is, uncontracted,
just an ordinary text conflict and gets its resolver dispatch; the
charter's "semantic contention parks" is discharged by the kernel's
own dispatchability predicate (`_verdict`'s park verdicts, exactly as
in-wave) plus the post-fold gate. Likewise a RESOLVED reply whose
`notes.txt` flags irreconcilable sides (the baked prompt's
best-merge-and-say-so instruction) **adopts as in-wave** — the catch
is §W2b's full suite plus the run's sealed-exam re-run against the
post-fold tree (or, for an unsealed run, the suite alone — sealing is
opt-in repo-wide), and red unwinds the fold and parks the run;
parking on the flag alone would be a new mechanism this design
deliberately omits. (One cited in-wave fallback route, budget
exhaustion, may be vacuous cross-run — the driver's budget, if any,
is a delegated build detail; a route that never fires parks nothing.)

The parkable unit is the **incoming run** — even when the defect
belongs to the frontier side (an unattributable touch parks every
subsequent contender on that path, a drain-wide stall the attention
surface must see: all-runs-parked fires §W2c class 1, and the drain
manifest aggregates parks per path so a repeated same-path park is
legible). Parking takes no operator turn; the park lands in the store
as a status transition and in the manifest with its receipts, and the
frontier ref is left exactly where it was pre-fold (the fold kernel
moves no ref; the unwind rule for a post-fold red suite is §W2b's,
unchanged by this spec).

## 4. Verification seam

How a future W2b build proves a dispatched brief was assembled per this
spec:

1. **Receipts carry the brief.** The driver writes each dispatch's
   fully assembled prompt verbatim to the fold receipts directory
   beside the hunks file it briefs — `resolver-brief-<i>-<attempt>.txt`,
   one file per attempt so the retry's rejection line is preserved —
   and the reply directory beside it, along with the per-run branch,
   plan path, build-base sha, and the kernel `candidateSha` each
   adoption commit was built from; receipts land in git per §W2b. The
   in-wave engine never persists its assembled prompt; the cross-run
   driver must, because this seam is the review surface trim U4
   bought.
2. **A committed fixture test** (fleet suite, joins via
   `tests/test_fleet_suite.py`) runs the assembler over a fixture pair
   of marked plans plus a synthetic conflict and asserts: (a) every
   span outside the contending block is byte-identical (whitespace-
   normalized, as the drift pin normalizes) to the baked spans
   extracted from `wave-merge.md`/`reviewer-prompts.md` — reusing the
   drift test's extraction, never a copied literal; (b) the block
   contains exactly the selected tasks' verbatim bodies, in §2's
   order, with the run-qualified grammar, and the incoming run id in
   the block matches the hunk labels; (c) no `wavesPath` pointer
   line, no branch or plan path, and no contract line anywhere in the
   brief or its hunk headers; (d) each park condition of §2/§3 parks
   on a fixture built to trigger it (an un-trailered first-parent
   touch, no-task-selects, empty body, plan-compile failure) — the fixture is also what pins the
   `Fold-Run: <runId>` trailer grammar, the adoption commit's
   tree-equality with the kernel candidate, the incoming run's
   build-base receipt sha against its merge-base derivation, and the
   first-parent-only attribution walk (a history where a naive
   `git log -- <path>` walk misreads but the first-parent spine reads
   clean, asserted on attribution output).
3. **Gate re-derivation, attempt-1 briefs only.** Each attempt-1
   receipt brief is re-derivable from `(pre-fold frontier sha,
   incoming branch sha, the contending plans at their build-base
   shas)`; the drain gate re-runs the assembler on those inputs and
   asserts equality with the receipt **after normalizing the receipts-
   directory path prefix** (the `HUNKS:`/`REPLY DIR:` lines are
   functions of where the driver ran; everything else is a function of
   the listed inputs) — the same receipts-resolvable-at-sha discipline
   as §W1d, extended to briefs. Attempt-2 briefs are excluded: their
   rejection line derives from the resolver's reply, not from those
   inputs, and §4.1 already preserves them verbatim.

## Adds / Removes (author disclosure for trim review)

Adds: this spec (design only) — the cross-run block grammar (§2), the
attribution + selection + park rules (§2–§3), and the three-part
verification seam (§4), all consumed by a future W2b build. Five
disclosed **expansions beyond the trim-U4 license** (which named a
review, not standing machinery), for operator adjudication: the
committed fixture test + gate re-derivation (§4.2–§4.3); the
`Fold-Run:` trailer + driver-authored adoption commit (§2); the
driver obligation to persist every assembled prompt plus the §4.1
receipt fields (branch, plan path, build-base sha, kernel
`candidateSha` — riding §W2b's existing receipts-land-in-git license;
the prompt persistence is the part the in-wave engine deliberately
does not carry); the
"two runs = two sides" reading that admits N frontier runs' bodies
into one brief (§2, round-1 U3); and the per-path park aggregate §3
asks of the W2c drain manifest (a new field §W2c names only
generically — delegated W2c detail). Removes: nothing. Deliberately
absent: any code, any edit to baked prompts or their sources, any
kernel/engine/periphery change, any cross-run `Commutes:` mechanism
(uncontracted is the point), any diff-derived task selection (declared
scope or park), any operator turn in the park path, any resolver
tier/model choice (the build inherits the in-wave posture: model key
omitted).

## Trim review

### Round 1 (fresh-context reviewer, 2026-08-27; grade: netConceptDelta **flat** — "the spec overwhelmingly fills in a deliverable §W2b already committed to, by citation rather than copy"; baseline claims verified against `waves.js`/`wave-merge.md`/`fold_wave.py`, park-rule quote verified verbatim)

Findings and adopt-or-answer (adoptions incorporated in the round-1
revision; three were corrected again in round 2, noted inline):

- **T1 diff-derived selection fallback — ADOPTED as deletion**:
  declared-scope-or-park (§2 Task selection); an undeclared edit is a
  file-discipline failure, park-by-default.
- **T2 §4.3 unbuildable for attempt-2 briefs — ADOPTED as narrowing**:
  gate re-derivation scoped to attempt-1; attempt-2 preserved verbatim
  by §4.1 (§4.3).
- **T3 §3 route list duplicated the in-wave fallback list — ADOPTED**:
  now cited (`wave-merge.md` §Fallback), with only the cross-run-novel
  routes enumerated (§3).
- **U1 incoming hunk label unspecified — ADOPTED**: incoming run id is
  the kernel task identifier; labels and block must agree; asserted in
  §4.2(b). (Grammar citation corrected in round 2, S1.)
- **U2 fold-commit naming required by nothing — ADOPTED**:
  `Fold-Run: <runId>` trailer specified, pinned by the §4.2 fixture;
  disclosed as an expansion (S2). (Write mechanism specified in
  round 2, U2.)
- **U3 last-touch attribution wrong per-hunk — ADOPTED (stated
  approximation)**: preamble softened to "most recently folded by";
  all path-touching folded runs' tasks included, fold-ordered; "two
  runs" read as the two *sides* (§2 Sides and labels).
- **U4 execution posture unstated — ADOPTED**: §2 Execution posture —
  cwd is the fold receipts directory, no checkout path in the prompt,
  no git credential.
- **U5 receipt clobbered on retry — ADOPTED**:
  `resolver-brief-<i>-<attempt>.txt` (§4.1).
- **U6 frontier-defect park ambiguity / drain-wide stall — ADOPTED**:
  incoming run is the parkable unit; repeated same-path parks legible
  via §W2c class 1 + per-path manifest aggregate (§3).
- **U7 "receipts record" named no field — ADOPTED**: build base
  defined by merge-base derivation, recorded sha checked against it by
  the fixture (§2, §4.2(d)). (Anchor corrected from "docket base ref"
  to the pre-fold frontier ref in round 2, U1.)
- **S1 §4.2–§4.3 exceed the U4 license — ANSWERED, kept + disclosed**:
  a brief that only a live drain could falsify would make the "own
  review before first use" clause unverifiable; the machinery is
  explicitly disclosed in Adds as an expansion for operator
  adjudication, and §4.3 narrowed per T2.
- **S2 `Fold-Run:` trailer is a new driver constraint — ANSWERED,
  kept + disclosed**: attribution (§2), the park trigger, and the
  fixture all need a pinned convention; disclosed in Adds.
- **S3 §1 misdescriptions (wavesPath pointer condition; `[files:…]`
  omission) — ADOPTED**: both sentences corrected (§1).
- **S4 park-rule quote — verified verbatim, no change.**
- **S5 remaining §1 baseline claims — verified accurate, no change.**

### Round 2 (fresh-context reviewer, 2026-08-27; grade: netConceptDelta **flat** — "every genuinely new concept buys verifiability of that same deliverable and is disclosed for adjudication"; §1 baseline re-verified, §3 quote re-verified verbatim; reviewer targeted round-1 adoptions for introduced defects and found three)

Findings and adopt-or-answer (this revision incorporates all
adoptions):

- **T1 `plan <plan-path>` in the block preamble contradicted the
  spec's own only-two-paths posture — ADOPTED as deletion**: no branch
  or plan path in the block; both live in receipts (§2 Block grammar,
  §4.1, §4.2(c)).
- **U1 round-1 build-base anchor ("docket base ref") wrong for
  dependent runs dispatched off an advanced frontier — ADOPTED as
  correction**: merge-base with the **pre-fold frontier ref** (equal
  to `fleet-base` in both dispatch regimes); "pre-fold frontier sha"
  defined once in §2 Dispatcher.
- **U2 `Fold-Run:` trailer unwritable — the kernel authors its
  candidate with a fixed message and is untouchable — ADOPTED as
  narrowing**: the driver adopts via its own tree-equal adoption
  commit carrying the trailer; kernel `candidateSha` recorded in
  receipts; tree-equality asserted by the fixture (§2, §4.1, §4.2(d)).
- **U3 attribution walk unpinned — a naive `git log -- <path>` walk
  descends into un-trailered task commits (or simplifies past
  tree-same folds) and parks every path — ADOPTED**: first-parent-only
  walk of the frontier ref, asserted by the fixture (§2, §4.2(d)).
- **U4 §4.3 inputs cannot reproduce the `HUNKS:`/`REPLY DIR:` path
  lines byte-for-byte — ADOPTED as narrowing**: equality after
  normalizing the receipts-directory path prefix (§4.3).
- **U5 N-run frontier block unbounded — ANSWERED, bound accepted and
  stated**: bounded by drain size (charter width ~2), no numeric
  ceiling, revisit on evidence (§2 Sides and labels).
- **S1 kernel `--branch` grammar misquoted — ADOPTED**:
  `<runId>=<branch>:<headSha>` per `_parse_branch` (§2).
- **S2 §3 park-rule quote — re-verified verbatim, no change.**
- **S3 §1 baseline — re-verified accurate, no change.**
- **S4 Adds disclosure incomplete (prompt-persistence obligation;
  two-sides/N-runs reading) — ADOPTED**: both listed as disclosed
  expansions (§Adds).
- **S5 "the wave's fold receipts directory" — ADOPTED**: "the fold's
  receipts directory" (§2 Execution posture).

### Round 3 (fresh-context reviewer, 2026-08-27; grade: netConceptDelta **flat** — "every round-3 finding is a correction or narrowing of already-disclosed machinery"; §1 baseline, §3 quote, and the kernel/fleet claims (`_parse_branch` grammar, fixed candidate message + parents, `fleet-base` push) all re-verified; round-2 adoptions targeted, two mechanism defects found)

Findings and adopt-or-answer (this revision incorporates all
adoptions):

- **T1 round-2 build-base formula wrong for frontier-side runs — a
  folded run's head is a second parent on the frontier spine, so a
  live merge-base against the current pre-fold sha returns the run's
  own head — ADOPTED as correction**: live derivation holds for the
  incoming run only; frontier-side build bases are the receipt shas
  recorded at their own fold time, checked then, reused at brief time
  (§2 Task selection, §4.2(d)).
- **T2 walk boundary "since the drain began" not derivable from
  §4.3's inputs — ADOPTED as narrowing**: boundary is the incoming
  run's build base; folds at or before it are common history on both
  sides and cannot source frontier-side conflict text (§2 Sides and
  labels).
- **U1 "only paths the prompt names" contradicted the byte-identical
  `HUNKS:` line, which carries the conflicted file's repo-relative
  name — ADOPTED as rewording**: only *filesystem locations*, with
  the repo-relative name excepted (§2 Execution posture, Block
  grammar).
- **U2 non-first-parent walk misfiled as a park condition — ADOPTED**:
  moved to the fixture's pins, asserted on attribution output
  (§4.2(d)).
- **S1 per-path manifest aggregate undisclosed — ADOPTED**: added to
  Adds as a delegated W2c detail.
- **S2–S5 §1 baseline, §3 quote, kernel/fleet claims, remaining
  round-2 adoptions — verified, no change.**

### Round 4 (fresh-context reviewer, 2026-08-27; grade: netConceptDelta **flat** — "round 4 adds no machinery"; round-3 adoptions re-verified defect-free — merge-base rule sound in both dispatch regimes, walk boundary sound, filesystem-locations wording matches the live dispatch; §1 baseline, §3 quote, kernel/fleet/compiler claims all re-verified)

Findings and adopt-or-answer (this revision incorporates all
adoptions):

- **U1 `Commutes:`-analog park route had no detection predicate and no
  covering fixture — ADOPTED as deletion**: the route is gone; an
  in-wave-auto-resolvable conflict is, uncontracted, an ordinary text
  conflict; "semantic contention parks" is discharged by the kernel's
  dispatchability predicate + the post-fold gate (§3).
- **U2 irreconcilable-flagged RESOLVED reply had no cross-run
  disposition — ADOPTED**: adopts as in-wave; the §W2b post-fold
  suite + sealed-exam re-run is the catch, red unwinds and parks;
  parking on the flag alone deliberately omitted (§3).
- **U3 dispatch vehicle unnamed — ADOPTED as delegated detail with
  constraints**: build-plan decision under the no-direct-API doctrine
  (`claude -p` on the orchestrator host) and no pinned resolver
  model/tier (§2 Execution posture).
- **S1 Adds count stale ("Four" over five listed) — ADOPTED**: Five
  (§Adds).
- **S2 §4.2(d) double-counted unattributable-touch and
  missing-trailer — ADOPTED**: merged to "an un-trailered
  first-parent touch" (§3, §4.2(d)).
- **S3–S7 round-3 adoptions, §1 baseline, §3 quote, kernel/fleet
  claims, scope disclosure — verified, no change.**

### Round 5 (fresh-context reviewer, 2026-08-27; grade: netConceptDelta **flat**; verdict: **CONVERGENCE — no mechanism/contract/test-seam changes proposed**; all round-4 adoptions re-verified defect-free against the kernel (`_auto_union`, `_verdict(contract=None)`), the no-direct-API doctrine, and the in-wave model-key posture; §1 baseline, §3 quote, and every kernel/fleet claim re-verified; "no trims proposed: rounds 1–4 already deleted or narrowed every candidate I could reconstruct, and re-deriving each surviving element found each load-bearing")

Findings and adopt-or-answer (wording/disclosure only — this revision
incorporates all adoptions; iteration terminates here per the
diminishing-returns rule):

- **U1 sealed-exam catch named unconditionally though sealing is
  opt-in — ADOPTED**: "or, for an unsealed run, the suite alone" (§3).
- **U2 "may not see" capability-contradicted by the receipts-dir cwd —
  ADOPTED as rewording**: "is not briefed on and must not read"
  (prompt discipline, strictly tighter than in-wave) (§2).
- **S1 Adds expansion (3) understated §4.1's receipt fields —
  ADOPTED**: fields listed, receipts-in-git license noted (§Adds).
- **S2 "no annotated narration ⇒ park" a loose gloss — ADOPTED**:
  "`_verdict`'s park verdicts, exactly as in-wave" (§3).
- **S3 budget-exhaustion route may be vacuous cross-run — ADOPTED as
  parenthetical**: driver budget is a delegated build detail (§3).
- **S4–S7 round-4 adoptions, §1 baseline, §3 quote, kernel/fleet
  claims, scope disclosure — verified, no change.**
