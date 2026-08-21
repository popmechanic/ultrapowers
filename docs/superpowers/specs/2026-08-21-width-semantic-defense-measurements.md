# Width semantic defense — pre-registered measurement designs (#177)

**Status: MEASUREMENT DESIGN — not machinery, not a build.** Research ticket
`wayfinder:research` #177 on The Width Program map (#174). Question: does
suite+exam defense hold as execution width scales? This doc pre-registers
three measurements (metric, collection point, baseline, decision threshold —
the §2d house format of `2026-08-18-fold-native-authoring-program.md`) and
names the evidence bar that would force a stronger defense than suite+exam.
Constraints honored: the verification periphery is FROZEN (no gate behavior
changes are proposed, including as measurement); every design reads existing
receipts/logs; the single additive field proposed is sensor-side
(`audit_run.py`, explicitly outside the frozen set — it already gained
`wallSec` under program spec §1f). Docket-level context is as charted:
incremental fold of run branches into a docket frontier in arrival order,
cross-run folds uncontracted, semantic contention parks the run, post-fold
verification = full suite + that run's sealed exam against the post-fold
frontier tree (#176); park-by-default escalation with receipts carried
verbatim and batch smoke re-aimed at seams *between* plans (#181).

---

## 1. What the record already shows

### 1.1 The T15 canonicalization observation — the live semantic-miss mechanism

`evals/frontier/results/2026-08-14-t15-ab.md` §"Observation worth carrying
(not a gate item)", verbatim:

> The resolver's canonical ordering put `audit.dispatch_hook` BEFORE
> `ratelimit.dispatch_hook` in `DISPATCH_HOOKS` — so in the fold arm,
> rate-limited calls ARE audited, while every serialize run wired
> `[ratelimit, audit]`, where rejected calls are NOT audited (T14 attempt 4's
> critic finding). No contract pins the inter-task order (the plan leaves the
> four tasks unordered; the exam is deliberately order-tolerant), so both
> compositions are legal — but this is a live demonstration that **folding
> merges text deterministically while composed behavior remains
> order-sensitive**. Feeds directly into the merge-contracts idea
> (`docs/superpowers/specs/2026-08-14-fold-native-methodologies.md` item 2) as
> §5-conversation input: concurrency-safe plans eventually want declared
> composition semantics, not just declared file sets.

This is the canonical shape of a semantic miss at width: the fold was
textually clean (5/5 resolver dispatches graded clean, both gates green,
sealed exam 24/24 on both trees), yet composed *behavior* differed between
arms. It was not a defect only because nothing pinned the order. The defense
that made it visible was an A/B comparison plus a human-graded transcript —
neither exists on a production run.

### 1.2 Cell 20260819175934 — the green-but-hollow-test specimens and the cross-file specimen

Issue #170 (closed, shipped 0.2.15) records the two hollow tests from the
2026-08-19 floors run (cell `20260819175934-contend-big-A-serialize`,
`evals/results/cells/20260819175934-contend-big-A-serialize/`):

> 1. Task 1: a config-sensitivity test for `pre_create_hook` whose fixtures
>    validate identically under hardcoded defaults — an implementation
>    ignoring `config` entirely stays green.
> 2. Task 3: `assert "a" in message` where the actor name `"a"` already
>    appears in the fixed prefix `"actor"` — the actor-naming half of the
>    criterion pinned nothing.
>
> Both were caught by reviewer judgment, not by any named instruction. Under
> an operator practice with no human code review, tautological green is the
> primary residual failure mode: tests are the only intent-carrier the human
> trusts.

The same cell produced the cross-file semantic-contention specimen,
`docs/superpowers/specs/2026-08-19-phase2-design-inputs.md`:

> **Cross-file semantic contention is uncovered by design — name the
> posture.** The compiler is file-granular; semantic collisions across files
> (shared counters, ordering assumptions, suite-global state) are caught
> only by the integration suite + sealed exam post-merge. Round-2 cell
> 20260819175934 produced a live specimen (rate-limit hook's process-global
> counter making the whole suite share one budget — flagged by review, not
> by any merge machinery). Accepted posture: defended-by-verification, not
> modeled; Phase 2 should say so explicitly rather than imply coverage.

That posture was adopted into the program spec rev 7 (Phase 2 preamble,
`2026-08-18-fold-native-authoring-program.md`): cross-file semantic
contention is "**defended by verification (integration suite + sealed exam),
not modeled**". #177 exists to test whether that posture survives width.

Read together, the two specimen classes compose into the width worry: the
suite+exam defense is only as strong as its tests, and the same cell that
demonstrated cross-file semantic contention also demonstrated tests that
pass with the pinned behavior deleted. A semantic miss landing on a surface
covered only by a hollow test is the escape path. The shipped mitigation is
prompt-level (#170's reviewer test-strength dimension, in 0.2.15); the
mechanical mutation-testing gate stage was explicitly assessed as unearned
machinery (#170: "adds suite-multiples of gate wall time, touches the frozen
periphery, and defends against reviewer misses not yet observed").

### 1.3 Resolver serial share — measured

- **4.73% of output tokens** — `evals/frontier/results/2026-08-19-phase1-gate.md`
  §"Resolver token share": "11,548 of 244,369 output tokens = **4.73%**; per
  dispatch 2,936–4,396 tokens, 43.6–69.4s wall" (cell
  `20260819230047-contend-big-B-fold`, 3 dispatches on a 6,282-line file,
  hunk-scoped briefs). Supersedes the 10.0% ceiling of
  `2026-08-19-t15-resolver-token-share.md` (that doc's addendum says so).
- **3.19%** on the contend-prod mechanics cell (`20260819232720`): "Resolver
  share here: 6,860 tokens = **3.19%**" (same file).
- **Wall share, derived (labeled as derived, not recorded):** 3 dispatches ×
  43.6–69.4s ≈ 131–208s of the arm-B run's 1550.9s wall ≈ **8–13%** of run
  wall at width 4. No doc records the resolver *wall* share as a named
  number — only the per-dispatch range.
- The kernel itself is negligible: "fold CLI wall time itself 0.8s
  (negligible — the win is scheduling, not the kernel)"
  (`2026-08-14-t15-ab.md` §Honesty bounds).
- Structure that makes this a *serial* stage: resolver dispatch is one at a
  time by design (program spec §1c: "Dispatch stays serial, one resolver at a
  time"), and the incremental fold does exactly one dispatch per conflicting
  fold event — **n writers on one path → n−1 dispatches** (spec §1b /
  §Verification). So resolver serial wall grows ~linearly in contended width
  while implementer wall parallelizes — the share must grow with width unless
  auto-union (§2b consumer 3) absorbs it.

### 1.4 Straggler / makespan data at width 4

Per-implementer walls exist for three contend-big cells
(`2026-08-19-phase1-gate.md`; re-derivable from `evals/results/cells/<id>/`
transcripts by the `audit_run.py` first→last-timestamp method):

| cell | task walls (min) | max/mean (derived) |
|---|---|---|
| 20260819081902 (round 1) | 4.2, 4.5, 4.1, 7.3 | 1.45 |
| 20260819175934 (round 2) | 7.8, 7.7, 7.7, 6.2 | 1.06 |
| 20260819185801 (arm A counted) | 4.9, 7.0, 5.7, 4.6 | 1.26 |

Wave makespan = max task wall; at width 4 the observed makespan inflation
over the mean task wall is 1.06–1.45. No wider wave has ever been measured
(all counted cells are width-4 single-wave; the corpus's modeled numbers —
mean 4.9% / median 1.4% / max 21.7% barrier-removal recovery,
`2026-08-10-plan-corpus-binding.md` via program-spec §Background — are about
wave *barriers*, not within-wave stragglers).

### 1.5 Redirect and fold-rate baselines (the existing quality reads)

Program spec §Goal: engine/finding-caused redirect-round rate baseline
**1/6, 4/18, 0/8** across the 0.2.x sense passes; natural fold rate baseline
**1/13** same-file pairs (12/13 serialized by the retired
`RESOLVER_LINE_CAP`, 2026-08-18 foreign sense pass). Phase-2 §2d
pre-registers: contended-wave fold rate to a majority, redirect-round rate
flat, `composition-unpinned` manifest rows trending to zero, over ≥2 sense
passes. First production `composition-unpinned` rows landed byte-exact in
the Phase-2 mechanics re-run (`2026-08-21-phase2-mechanics.md`):
`composition-unpinned: wave 1 app/registry.py — writers 1,2,3,4; undeclared:
1,2,3,4`. The auto-union has **never fired live** ("no fixture plan declares
`Commutes:`" — same file); its coverage is 12 kernel tests including the
weave-inertness pin.

One negative result worth carrying: the contend-big exam failures in the
Phase-2 mechanics re-run were **fixture decay, not semantic misses** — "the
merge seams were perfect in both attempts while the failure moved between
unrelated feature tasks" (`2026-08-21-phase2-mechanics.md`, adjudicated,
filed #187). The record to date contains **zero confirmed semantic misses**:
11/11 graded resolver dispatches clean (T15 5/5, Phase-1 gate 3/3, mechanics
3/3), and the two near-specimens (§1.1, §1.2) were caught by grading and by
review respectively, not by suite or exam.

### 1.6 What existing artifacts already capture vs what needs a new field

Already captured, per production run (no new machinery needed):

| quantity | artifact | source |
|---|---|---|
| every fold event, conflict, park, `dispatchable`, `hunkCount`, `autoResolved` | `frontier/wave-<n>/conflicts.json` + `fold_log.jsonl` | program spec §1a/§1b; `kernel/FOLD_LOG.md` |
| largest file folded per fold call | `frontier/wave-<n>/fold_stats.json` (`maxLines`) | spec §1f; harvested by `harvest_runs.py::_frontier_max_lines` (lines 713–731) |
| fold CLI cost | report `frontier[]`: `foldCliCalls`, `foldCliWallTimeSec`, `selfChecks`, `autoResolved`, `resolverTranscripts[]` (`conflict`, `attempt`, `path`, `epoch`, `hunksFile`, `replyDir`, `status`, `notes`) | `skills/ultrapowers/references/report-format.md` (frontier row) |
| per-task wall | `audit_run.py` `wallSec` per agent + `totals.wallSecByTask` (summed across escalation retries) | `skills/ultrapowers/scripts/audit_run.py:124–146`; carried into ultralearn bundles (`harvest_runs.py:686`) |
| executed DAG (wave membership = width per wave) | `launch.json` `waves`/`edges`, harvested | `harvest_runs.py::_read_launch` (line 737); spec §1f |
| composition exposure | `judgmentCalls` `composition-unpinned:` rows → residual manifest (`residual_manifest.py` FAMILIES includes `judgmentCalls`) | spec §2b consumer 2; first live rows 2026-08-21 |
| run wall + tokens + redirect rounds (eval cells) | `evals/results/runs.jsonl` rows (`wallClockSec`, `outputTokens`, `redirectRounds`, `falseBlocks`, `gateVerdict`, `identity`); cell dirs persist transcripts (`evals/results/cells/`, #165 fixed by PR #168) | `evals/ab_runner.py:278–279` |
| gate verdicts/checks/acks per run | receipt JSON (`gate_check.py` emit: `verdict`, `checks`, `acks`) | `skills/ultrapowers/scripts/gate_check.py:33–36` |

Needs **one additive field** (sensor-side, outside the frozen periphery):

- `audit_run.py::ROLE_MARKERS` has no entry for the resolver — the baked
  resolver prompt opens "You are a merge-conflict resolver for one file in
  one wave" (`references/wave-merge.md:222`) but the marker list
  (`audit_run.py:29–42`) stops at impl/review/setup/merge/reconcile/
  integration, so resolver transcripts classify `unknown` and their
  `wallSec`/`outputTokens` are not attributable by role. The
  2026-08-19 token-share reading had to grep for the phrase by hand
  (`2026-08-19-t15-resolver-token-share.md` §Appendix). One added marker
  tuple gives resolver wall and token share in every bundle automatically.

Not recomputable from the repo: the ultralearn observation ledger is
gitignored (per `references/` doctrine and memory records; no ledger file
exists in-tree). Ledger-derived rates (redirect attribution, fold-canary
readings) are quoted here only where a spec or results doc records them; all
three designs below therefore specify **prospective** collection via sense
passes, not retrospective recomputation.

---

## 2. Measurement designs

House format (spec §2d style): metric → collection point → baseline →
pre-registered threshold, stated before any width machinery is built.

### 2a. Semantic-miss rate vs width

**Metric.** A *semantic miss* is a merge (wave fold or docket-level
cross-run fold) that is textually clean — adopted candidate, `selfChecks:
ok`, no park — whose composed behavior is wrong. Three detection strata,
counted separately per fold epoch:

- **S1 caught-by-review:** flagged by a task reviewer or completeness critic
  before the gate (the 20260819175934 global-counter class).
- **S2 caught-by-verification:** post-fold full-suite or sealed-exam failure
  attributed to the *composition* (not to any single task's own defect) —
  observable as a reconcile/fallback or redirect round whose cause names a
  cross-task interaction.
- **S3 escaped:** a defect found after gate approval (or after docket-fold
  adoption) that traces to a fold epoch where suite and exam were both green.

Rate = count per adopted fold epoch, **stratified by writer count on the
contended path** (the width proxy; derivable per conflict from
`conflicts.json` + the `composition-unpinned:` row's `writers` list) and,
at docket level, by run count folded into the frontier since last
verification. The exposure denominator (uncontracted multi-writer folds) is
exactly the `composition-unpinned` row population — already pinned,
byte-exact, and manifest-carried.

**Collection point.** No new logged field. S1: reviewer verdicts + redirect
records already in the receipt/report; attribution is a sense-pass reading
(the redirect-canary precedent — engine/finding/plan-caused labels).
S2: `judgmentCalls` + `waveMerges` fallback records + redirect rounds, read
per fold epoch against `fold_log.jsonl`. S3: issue tracker back-reference —
any defect issue that names a run stamp is joined to that run's fold log at
reading time. Prospective, ≥2 sense passes per the §2d rhythm; docket-level
rows arrive once #176 machinery exists and carries the same
`composition-unpinned` shape for cross-run folds (charted as uncontracted —
i.e., every cross-run fold is exposure).

**Baseline.** S1: 2 near-specimens ever (T15 DISPATCH_HOOKS ordering — legal
because unpinned; 20260819175934 global counter). S2: 0 observed (the only
post-fold exam reds on record were adjudicated fixture decay, #187).
S3: **0 observed** across 11/11 graded resolver dispatches and every
production fold to date. Composition exposure baseline: 100% of live
contended folds uncontracted (`undeclared: 1,2,3,4` — no plan declares
`Commutes:` yet).

**Thresholds.**
- **Any single S3 event fires the escalation bar (§3).** Pre-registered as
  an existence test, not a rate: the defense claim is categorical
  ("defended by verification"), so one counterexample defeats it.
- S2 rate rising with width stratum (more composition-caught failures on
  ≥3-writer paths than 2-writer, normalized per fold) while S3 stays 0 ⇒
  suite+exam is *holding but load-bearing*: push `Commutes:` adoption and
  the §2c author-for-the-resolver guidance; no new defense.
- `composition-unpinned` rows not trending to zero over ≥2 sense passes
  (the standing §2d read) at the same time width grows ⇒ the exposure is
  compounding; escalate the *authoring* half (contracts), still not the
  verification half.

### 2b. Resolver serial share of run wall

**Metric.** `resolverSerialShare_wall` = Σ(resolver-dispatch wall) ÷ run
wall, per run; token twin = Σ(resolver `outputTokens`) ÷ run `outputTokens`.
Secondary: dispatches per contended path vs writer count (expected n−1;
deviation means re-dispatch/rejection churn), and `autoResolved` ÷
(`autoResolved` + dispatched) — the auto-union rate, §2b consumer 3, which
is the designed absorber of this serial stage.

**Collection point.** Resolver dispatch wall/tokens come from the resolver
agent transcripts (first→last timestamp, the `collect()` method) — this is
the **one additive field**: add `("You are a merge-conflict resolver",
"resolver")` to `audit_run.py::ROLE_MARKERS` so every bundle carries
per-resolver `wallSec`/`outputTokens` keyed by role. Everything else exists:
`foldCliWallTimeSec`/`foldCliCalls` (report frontier row), `autoResolved`
(conflicts.json + report), run wall (cells: `runs.jsonl`; production runs:
whole-transcript wall via the same audit). Sensor-side only; the frozen
periphery is untouched.

**Baseline.** Tokens: **4.73%** (contend-big, width 4, 3 dispatches),
**3.19%** (contend-prod mechanics). Wall: **~8–13% derived** at width 4
(43.6–69.4s × 3 of 1550.9s) — the first sense pass should replace this
derived range with the measured number. Kernel CLI wall ~0.8s (negligible;
the serial cost is the dispatch, not the fold).

**Model to test (stated so the reading can falsify it).** Dispatches scale
as Σ over contended paths of (writers−1); implementer wall stays ~flat with
width; so share_wall(w) ≈ serial-resolver-seconds·(w−1)/run-wall — roughly
linear in contended width, offset down by the auto-union rate.

**Thresholds.**
- Median `resolverSerialShare_wall` over ≥5 contended production runs at
  writer-width ≥6 **> 15%**, OR the resolver serial wall exceeding the
  serial review/gate tail's share of run wall (the same comparator Phase 3
  uses for its 15% critical-path rule) ⇒ the serial-resolver stage binds.
  Response candidates, named only: raise auto-union coverage (contracts on
  the hot surfaces — zero-dispatch resolution already built), per-path
  parallel resolver dispatch (paths are independent by construction; the
  serial constraint is per-path epoch order, not cross-path), hunk batching
  per dispatch.
- Token share > 10% sustained (the old pre-measurement ceiling) ⇒ re-read
  the brief size term (`contendingTasksBlock` — the 56KB task-bodies term
  `2026-08-19-t15-resolver-token-share.md` shows already dominates the
  hunk-scoped brief) before touching dispatch structure.
- Below both: record and hold — 4.73%/3.19% is cheap insurance; no action.

### 2c. Straggler cost in wide waves

**Metric.** Per wave: `makespanInflation` = max(taskWall) ÷ mean(taskWall)
over the wave's tasks; `stragglerIdle` = Σ(max − taskWall_i) — the
agent-seconds the wave barrier wastes; and the empirical task-wall
distribution (min/median/max, coefficient of variation) **stratified by
wave width**. Expected-makespan-vs-width is then an order-statistics read
off the pooled distribution (E[max of w draws]/mean), checked against the
per-wave observations rather than assumed.

**Collection point.** Entirely existing: `wallSecByTask`
(`audit_run.py:143–146`, in every ultralearn bundle) joined to `launch.json`
`waves` (harvested, spec §1f — the executed DAG). Zero new fields; the
computation is a reading script over bundles, run at sense-pass time. Eval
cells: same join from `evals/results/cells/<id>/` transcripts.

**Baseline (width 4, three cells, §1.4).** makespanInflation 1.06 / 1.26 /
1.45; no width >4 observation exists. The fixture floors context matters
when reading these: task walls drift 25–35% in days on identical text
(`2026-08-19-phase1-gate.md` round 1; `2026-08-19-phase2-design-inputs.md`
"calibrated fixtures decay"), so production-plan readings, not fixture
re-runs, are the accumulating series.

**Thresholds.**
- Median makespanInflation over ≥10 real waves of width ≥6 **> 1.5×** (half
  the wave's parallel compute idle at the barrier) ⇒ the wave barrier is
  the binding cost. This read does **not** get its own build trigger: it
  feeds Phase 3's existing pre-registered rule verbatim (median *measured*
  critical-path recovery > 15% AND > the serial review/gate tail ⇒ spec
  dependency-triggered dispatch inside the wave architecture — program spec
  §Phase 3). The straggler series is the width-stratified input that rule
  says it needs (`wallSec` §1f exists for exactly this).
- Inflation flat (≤1.5) as width grows ⇒ waves stay; record the numbers as
  the reason (Phase 3's own "below the threshold" clause).
- Cross-check obligation: if inflation is high *because one task class is
  systematically long* (e.g., the adversarial-review tier), the reading must
  say so — the remedy is plan-shaping (split the long task), not engine
  work; a distribution note per reading prevents a false Phase-3 trigger.

---

## 3. The escalation bar — what would force a stronger defense than suite+exam

**The bar (pre-registered, existence-form):** one confirmed S3 event — a
semantic miss found *after* a fold was adopted with the full suite green
**and** the run's sealed exam green on the post-fold tree (at docket level:
on the post-fold frontier tree, the #176 verification exactly). That is the
categorical counterexample to the rev-7 posture sentence
("defended by verification, not modeled"). Corroborating-but-insufficient
signals, which tighten the watch without firing the bar: an S2 rate that
grows superlinearly with writer width; a hollow test (the #170 class)
found to be the *sole* cover on a surface that took a multi-writer fold —
the two specimen classes of §1.2 composing in the wild.

Why width raises the stakes: cross-run docket folds are uncontracted by
charter (#176), so every increment of docket width adds exposure that no
`Commutes:` declaration can currently reduce; and both defenses in the
current stack that caught the near-specimens (transcript grading, reviewer
judgment) are per-run human-or-prompt surfaces that do not scale with fleet
width, while suite+exam — the part that does scale — is exactly the part
the hollow-test specimens showed can be tautologically green.

**Stronger-defense candidates (named only, per the ticket — none designed
here, each with its recorded provenance):**

1. **Cross-run merge contracts** — extend `Commutes:` semantics to the
   docket frontier so cross-run folds can be declared/auto-unioned
   (`2026-08-14-fold-native-methodologies.md` item 2; the T15 observation's
   own "declared composition semantics" feed).
2. **Composition exams** — sealed cross-task/cross-run invariant exams
   owned above the task level ("exam-owned development", methodologies
   item 4; spec §2b: "Cross-task invariant *exams* remain the sealed-plan
   route (existing)") — the least-new-machinery candidate since sealing
   already exists and is opt-in.
3. **Mechanical mutation-testing gate stage** — parked with a recorded
   assessment (#170: "unearned machinery... stays parked unless an eval
   earns it"); an S3 event traced to a hollow test is precisely the eval
   that would earn it.
4. **Order-perturbation verification** — re-run suite/exam on a shuffled
   fold order's tree; motivated by the recorded gap that the completion
   self-checks are order checks on *text* ("the raw-shuffle excludes
   resolutions and replay is content-blind", program spec §2b consumer 3
   safety note) — behavior-order sensitivity is exactly what they cannot
   see.
5. **Reviewer test-strength dimension, docket-scoped** — the shipped #170
   prompt dimension re-aimed at the seams *between* plans, aligning with
   #181's batch-smoke-at-seams posture (prompt text, zero machinery).

Selection among these is out of scope for #177; per the subtraction-eval
doctrine, whichever fires must be earned by the S3 (or corroborating)
evidence above, never by the incident narrative alone.

---

## 4. Sources

- `evals/frontier/results/2026-08-14-t15-ab.md` — T15 A/B (0.640× wall,
  1.111× tokens, 5/5 resolver grades); §"Observation worth carrying" (the
  canonicalization quote, §1.1); §"Honesty bounds" (0.8s kernel wall).
- `evals/frontier/results/2026-08-19-phase1-gate.md` — E1″ 0.432 / E2″
  0.800; resolver share 4.73% and 3.19% with per-dispatch 2,936–4,396
  tokens / 43.6–69.4s wall; per-implementer walls for cells
  20260819081902 / 20260819175934 / 20260819185801; floors drift.
- `evals/frontier/results/2026-08-19-t15-resolver-token-share.md` — the
  10.0% ceiling and its supersession (addendum); the 56KB task-bodies brief
  term; the reproducible transcript-read pattern.
- `evals/frontier/results/2026-08-20-phase2-migration.md` — pinned-corpus
  reading (−3 prose-reference only).
- `evals/frontier/results/2026-08-21-phase2-mechanics.md` — first live
  `composition-unpinned` rows (byte-exact shape); auto-union never fired
  live; contend-big exam reds adjudicated fixture decay (#187).
- `docs/superpowers/specs/2026-08-18-fold-native-authoring-program.md` —
  rev-7 semantic-contention posture; §Goal baselines (redirect 1/6, 4/18,
  0/8; fold rate 1/13); §1b n−1 dispatches; §1c serial dispatch; §1f sensor
  fields; §2b consumer 3 (auto-union, content-blind replay note); §2d gate
  reads (the pre-registration format imitated here); §Phase 3 15% rule.
- `docs/superpowers/specs/2026-08-19-phase2-design-inputs.md` — cross-file
  semantic-contention specimen (cell 20260819175934); fixture-decay note;
  operator verification practice.
- `docs/superpowers/specs/2026-08-14-fold-native-methodologies.md` — merge
  contracts (item 2), exam-owned development (item 4).
- Issue #170 (github.com/popmechanic/ultrapowers) — the two hollow-test
  specimens verbatim; the mutation-testing parked assessment. #174 (map),
  #176 (docket integration, closed/charted), #181 (escalation,
  closed/charted), #187 (contend-big recalibration).
- `skills/ultrapowers/scripts/audit_run.py:29–42` (ROLE_MARKERS — no
  resolver entry), `:87–113` (`collect()` wall method), `:124–146`
  (`wallSec`, `wallSecByTask`).
- `skills/ultrapowers/references/wave-merge.md:222` (resolver prompt
  opening line — the classifiable marker).
- `skills/ultrapowers/references/report-format.md` — the `frontier[]` row
  (foldCliCalls, foldCliWallTimeSec, autoResolved, resolverTranscripts).
- `skills/ultralearn/scripts/harvest_runs.py:686, 713–731, 737–745, 995–1000`
  — wallSecByTask merge, fold_stats/maxLines, launch DAG harvest.
- `skills/ultrapowers/scripts/residual_manifest.py:34` (judgmentCalls
  family), `skills/ultrapowers/scripts/gate_check.py:33–36` (receipt shape),
  `evals/ab_runner.py:278–279` (runs.jsonl counters);
  `evals/results/runs.jsonl` row keys; `evals/results/cells/` (persisted
  transcripts, #165/PR #168).
