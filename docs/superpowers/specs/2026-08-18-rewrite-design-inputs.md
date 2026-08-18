# Design inputs for the plan-authoring rewrite (recorded 2026-08-18 — not built)

_A note, not a spec. The 2026-08-18 distill over the foreign 0.2.x sense
pass (3 bundles: steve-health @0.2.13, skylights @0.2.0, home drain-A @0.2.1;
ledger 1588 rows / 159 runs) produced 7 proposals. Because a plan-authoring
rewrite that changes the nature of the orchestration engine is coming, only
the orthogonal close/ops/sensor items were filed (#158, #159, #160 — spec
`2026-08-18-post-distill-close-ops-sensor.md`). Everything below is held as
input to that rewrite. Do not build from this note alone; each item re-enters
through its own brainstorm → spec → trim review when the rewrite lands._

## 1. The line-cap finding (fold engages on prose, never on hot source)

- **Observation:** across the 0.2.x sample, **12 of 13 real same-file pairs
  were serialized by `RESOLVER_LINE_CAP = 400`**
  (`skills/ultrapowers/kernel/frontier_fold.py:30`): 5 files in one web app
  (incl. an 8.9k-line component), both home pairs (twice), 1 data file. The
  single natural fold was a docs file (0.2.13; clean, critic-verified).
- **Contention lives in big files.** The skylights plan explicitly chained
  every web task via `Depends-on` because of the shared big file — the exact
  contortion the §5 relaxation (0.2.0) targeted — and a home author expected
  a fold the cap silently serialized. So the **§5 relaxation is partially
  inert in production**: the mechanism is validated (T15 A/B 0.640× wall /
  1.111× tokens; canary flat), but the cap, not the relaxation, is the lever.
- **Decision data:** sample file sizes 660–1300 lines would fold under a
  ~1500 cap; 2k–9k files would still serialize.
- **Held: P1(a) cap A/B** — a raised `RESOLVER_LINE_CAP` (or hunk-eligibility)
  arm on the contend-prod fixture through `evals/ab_runner.py`, pre-registered,
  hard gates unchanged; canary = fold-fallback rate per contended wave +
  redirect-round rate at `engineVersion ≥` the adopting release vs the
  0.2.0–0.2.13 baseline (fallbacks 0/1 fold; redirect 1/6, 4/18, 0/8). Also
  held: P1(b) ultraplan move-3 prose stating the cap so authors know which
  same-file pairs will fold, and P6 red-base prose (repair base first, then
  launch). Merge-contracts stays deferred (one fold observed, uncontested).

## 2. Do-not-port list

- **Agent-based waves-file preflight** (`preflightWavesFile` /
  `waves-file-check` role, `harnesses/waves.js` ~:1673–1735, plus its
  `WAVES_FILE_PREFLIGHT` prompt and 4 `tests/sim_workflow.mjs` scenarios).
  The deterministic driver already covers it: `ultra_run.py` stamps
  `wavesPath` from the compile it just ran and `redirect_args.py` composes
  the redirect launch file, so a wrong/stale path can no longer be authored.
  Ledger: zero wrong-path launches at ≥0.1.15; four launches killed by the
  preflight agent itself failing to emit StructuredOutput (0.1.13, 0.1.15 ×2,
  0.2.0). A guard whose only observed effect is its own false-red — do not
  carry it into the new engine.
- **#156 engine items 8–12** (barrier-retry `chunkLost` sweep, two stale
  waves.js comments, untested r1/r2 null guards, SWEEP PATHS addressing,
  multi-entry SWEEP PATHS pins) — parked; re-evaluate against the rewrite's
  engine rather than patching the old one.

## 3. Keep the ledger comparable across the rewrite

- `engineVersion` stays `{epoch, asOf, basis}` (with #160 adding the
  `plugin-cache-path` basis, never changing the shape).
- The redirect-round vocabulary (engine infra / finding / plan / elective;
  fixIterations; gate redirects; salvage) stays as-is so before/after
  comparisons across the rewrite remain possible.

## 4. Watch-items carried, not built

- #134 second recurrence point (steve-health: concurrent side session between
  approve and merge, benign by branch point) — still no data-loss event; the
  "serialize runs" note stands.
- Critic-with-data-access found a live-money bug no worktree reviewer could
  (skylights); base drift during a run (steve-health) — report-format
  watch-item, not a field.
- Manyana verdict as given: mechanism validated, production value ~inert as
  shipped under the 400-line cap; one cheap experiment (§1) away from a
  verdict.

## 5. Brainstorm synthesis (2026-08-18, later session) — value-ranked ordering

Operator direction: nothing must be kept (waves included); target specific
outcomes in **quality > tokens > clock**. Ranking every candidate change
against the three values, from measured evidence:

| change | quality | tokens | clock | evidence |
|---|---|---|---|---|
| hunk-scoped resolver briefs / retire the 400 cap | neutral | ↓ (smaller briefs) | ↑↑ width on the hot files carrying 12/13 real contention | 08-18 sample; T15 transcripts |
| merge contracts / composition exams | ↑↑ (only demonstrated fold defect class) | ~neutral | neutral | T15 `DISPATCH_HOOKS`; fold-native §2 |
| compiler subtraction (DAG = Depends-on ∪ Consumes→Produces; contention derived) | ↑ (phantom edges gone; ~1k lines of self-defense) | neutral | ↑ width; plans stop routing off the engine | complexity review 07-10; corpus 08-10 |
| scoped plan-body relaxation | neutral if scoped (07-04 verdict) | ↓ modest | ↑↑ human clock | 07-04 note; canary shipped |
| continuous frontier / no waves | risk (review semantics, resume lanes, ancestry) | ↑ risk (more dispatches) | bounded: ~5% mean / ~22% max modeled | corpus barrier column |

**Ordering adopted:** (1) resolver/cap, gated on the T15 rig → (2) composition
contracts + compiler/ultraplan subtraction + scoped body relaxation, gated on
the live fold-canary + redirect-round canary → (3) re-measure the barrier tail
on the wider plans → frontier engine only if that number earns its risk.

**Pre-registered targets (operator-approved 2026-08-18):** quality — engine/
finding-caused redirect-round rate flat vs the 0.2.x baseline; every
multi-writer fold onto a registration surface covered by a declared contract
or exam. tokens — fold ≤1.1× serialize on contended shapes (T15: 1.11 with
whole-file briefs). clock — width-4 contended ≤0.6× (T15: 0.64); natural fold
rate on real plans from 1/13 to a majority; planning wall time down by a
stated fraction on the next N plans.

Prior notes this rests on: `2026-08-12-frontier-mode-in-engine-design.md` §5/§6
+ Non-goals; `2026-08-14-fold-native-methodologies.md` (§2 + counterweight);
`evals/frontier/results/2026-08-10-plan-corpus-binding.md`,
`2026-08-14-t15-ab.md`; memory `plan-body-relaxation-idea`,
`complexity-review-2026-07`.
