# ultrapowers evals

A controlled comparison of plan-execution engines across **cost**, **clock time**, and
**quality**. Designed to answer three questions with attribution, not just one headline:

1. Is ultrapowers better than the serial superpowers baseline? (A vs B)
2. What does model tiering cost in quality, at constant orchestration? (B vs C)
3. What does the orchestration alone buy, at constant model spend? (A vs C)

> Once a premium frontier model (Fable) is in play, the headline question narrows from
> "which engine" to *where to spend the premium model* — see **Fable placement sweep**
> below, which reuses these fixtures and scoring machinery.

## Conditions

| ID | Engine | Models |
|----|--------|--------|
| **A** | superpowers serial executor (`superpowers:subagent-driven-development`) | session defaults (run from your normal frontier-model session — this is the incumbent workflow, priced as you actually use it) |
| **B** | `/ultrapowers` as shipped | tiered: haiku merges, sonnet implementers, opus reviewers/fixes |
| **C** | `/ultrapowers`, all-frontier execution | at the Step-3 wave-plan gate, revise derived knobs to `tierOverrides: {cheap: 'opus', standard: 'opus'}` |

All three conditions consume the **same frozen plan document** from the same baseline
commit. Plans carry `**Type:**`/`**Depends-on:**` markers, which sequential executors
ignore gracefully (see `skills/ultrapowers/references/plan-markers.md`).

## Fixtures

Five purpose-built fixture repos under `evals/fixtures/`, one per DAG regime:

| Fixture | Regime | Expected wave shape (B/C) |
|---------|--------|---------------------------|
| `wide` | 6 independent tasks — parallelism's best case | 1 wave of 6 |
| `chained` | 5 tasks in a strict dependency line — parallelism's worst case | 5 waves of 1 |
| `mixed` | realistic diamond DAG, 6 tasks | `[1,4] → [2,3] → [5] → [6]` |
| `flawed` | the `mixed` apistub task graph carried by a plan with a latent, undeclared dependency (Task 4's in-memory store must return a `schema.User` created by Task 1, yet declares `Depends-on: none`). Reuses mixed's project, reference, and held-out acceptance suite verbatim — only the plan differs. It measures the engine on *realistic (buggy) plans*, where `mixed` now measures it on *correct* ones. Promoted from the original mixed plan (#27). | `[1,4] → [2,3] → [5] → [6]` |
| `degrade` | 2 tasks with fully overlapping writes — triggers sequential fallback | sequential mode |

Each fixture contains:

- `project/` — a small working Python project with a **green baseline test suite**
- `plan.md` — the frozen, marked plan (never edit between runs)
- `acceptance/` — **held-out acceptance tests**, written alongside the plan, never
  shown to any executor. Copied in only at scoring time. This is the primary,
  un-gameable quality signal.

Verify every plan compiles to its intended shape before running anything:

```sh
python3 skills/ultrapowers/scripts/compile_plan.py evals/fixtures/wide/plan.md | python3 -m json.tool
```

## The matrix

5 fixtures x 3 conditions x 3 reps = 45 runs (capacity-safe scheduling: one run
per 5-hour window). Agentic runs are heavy-tailed:
report medians with ranges, never single runs.

Run IDs follow `<fixture>-<condition>-<rep>`, e.g. `wide-B-2`.

**Budget — API billing:** estimated **$600–900** total (B ≈ $10–18/run, A ≈ $20–30,
C ≈ $25–35; the degrade fixture runs much cheaper).

**Budget — subscription plans (Max):** marginal cash cost ≈ $0; the binding constraint
is **plan capacity**, and the 7-day limit is the ceiling that matters for a matrix this
size. The only out-of-pocket spend is the judge (`judge.py` calls the API directly with
a key): ~36 pairwise judgments ≈ **$10–30 total**.

Capacity-safe schedule:

- **One run per 5-hour window.** A run plus its scoring fits comfortably; don't stack
  condition-C runs in one window.
- **Calibrate before committing.** Run the two cheapest cells first (`degrade-B-1`,
  `wide-B-1`) and check the `/usage` weekly delta. If one B run costs more than ~4% of
  the weekly limit, spread the matrix over three weeks instead of two.
- **Abort criterion:** if the weekly limit passes 50% with matrix runs remaining, stop
  for the week — partial cells are fine, the report medians simply have fewer reps
  until you resume.
- **Order for early signal:** complete `mixed` across all three conditions first; it's
  the most representative fixture, so if results are going to be boring or broken,
  you'll know after ~9 runs.

The B-vs-C comparison doubles as the subscriber headline: same orchestration, tiered vs
all-frontier models, measured directly in weekly-limit percentage — i.e. **how much
further model tiering stretches one week of a Max plan**.

## Fable placement sweep (planned — the headline experiment)

> **Status: blocked, by design captured now.** Fable 5 is suspended under a US-government
> export-control directive (2026-06-12; Anthropic's statement: <https://www.anthropic.com/news/fable-mythos-access>),
> and the engine cannot yet *place* Fable (see Prerequisites). This section is the design
> to run the moment both clear.

The matrix above compares engines and model *tiering* on the `haiku/sonnet/opus` ladder.
Once a premium frontier model exists, the economic question is narrower and sharper:
**where in the pipeline does spending Fable's premium actually buy a _verified_ result —
and where is it wasted?** ultrapowers' tier system is precisely the instrument for that:
it assigns a model per role, so it can place Fable surgically at the verification
checkpoints (review, fix, completeness critic) while cheaper models do the mechanical
bulk (implement, merge, setup). Optimizing that placement is the point.

Fable is the new top tier — a fourth rung above opus: `haiku < sonnet < opus < fable`.
The sweep varies **where Fable sits** and scores each placement by **cost per passing
acceptance test** — i.e. *how little Fable can you spend and still pass the held-out
exams?*

### Conditions (the placement ladder)

| ID | Roles on Fable | Everything else | What it isolates |
|----|----------------|-----------------|------------------|
| **F-serial** | all roles, serial (no orchestration) | — | The incumbent: "just run the best model serially." Quality + cost ceiling, capacity floor. The thing orchestration must beat on cost-per-pass. |
| **F-floor** | none — opus at verification | haiku merge/setup, sonnet implement, opus review/fix | The no-Fable reference (≡ the matrix's tiered condition **B**). Establishes the opus baseline pass-rate. Runnable on today's engine. |
| **F-verify** | reviewers + fix-rounds + completeness critic only | haiku merge/setup, sonnet implement | **The hypothesis:** Fable only where claims are verified. Minimal Fable spend. |
| **F-build** | + implementers | haiku merge/setup | Adds Fable to generation — tests whether Fable-authored code lifts the pass-rate enough to justify the spend. |
| **F-all** | every role, parallel | — | All-Fable, orchestrated. Quality ceiling at parallel speed; cost still high. |

Same five fixtures, same held-out acceptance suites, same `score_run.py` / `report.py`
machinery and per-engine non-pooling. Each condition × 5 fixtures × 3 reps.

### Questions it answers (with attribution)

1. **Does Fable's value concentrate at verification?** `F-verify` vs `F-all` — if F-verify
   holds F-all's acceptance pass-rate, the premium belongs only at the checkpoints.
2. **Does Fable-authored code earn its cost?** `F-verify` vs `F-build`.
3. **Does any Fable placement beat the opus floor enough to justify the premium?**
   `F-verify`/`F-build`/`F-all` vs `F-floor`.
4. **The headline:** does orchestrated *surgical* Fable (`F-verify`) match *naive serial*
   Fable (`F-serial`) at a fraction of the Fable spend? That is the case for ultrapowers
   as a Fable-economy instrument.

The sharpest metric is **Fable tokens per passing acceptance test** (not just blended
USD): add a Fable-only token column to the scorer so the premium model's spend is
isolated from cheap-tier spend.

### Prerequisites (none of this runs today)

1. **Fable access restored** — currently suspended (link above); no timeline.
2. **Engine learns the Fable tier.** `waves.js` validates tier values against
   `haiku/sonnet/opus` only (`VALID_MODELS`, throws otherwise) and **hardwires the
   reviewer + completeness critic to `DEFAULT_TIER.mostCapable` (opus), override-proof.**
   So Fable cannot be named, and cannot be placed at verification, without an engine
   change: add the `fable`/`claude-fable-5` alias, and make the **verification-role model
   a first-class knob** (so `F-floor` and `F-verify` differ only in that knob). This is
   the gating engine PR.
3. **Fable pricing in `api_equiv.py`** for cost-per-pass in USD, plus the isolated
   Fable-token column.

Until (1) and (2) land, run **`F-floor`** (≡ condition B on the current `0.0.10` engine)
as the standing opus baseline; Fable placements drop in later as their own engine-version
population (`report.py` keeps them separate, never pooled).

## Protocol — one run, start to finish

1. **Prepare** a fresh working repo (acceptance tests are NOT copied in):

   ```sh
   evals/scripts/prepare_run.sh wide /tmp/eval-runs/wide-B-1
   ```

2. **Execute.** Open a Claude Code session **in the run directory** and start a timer
   (prepare records a start timestamp automatically; `score_run.py` uses it unless you
   override).
   - Condition A: invoke `superpowers:subagent-driven-development` on `docs/plans/plan.md`.
   - Condition B: `/ultrapowers docs/plans/plan.md`; approve the wave plan as proposed.
   - Condition C: `/ultrapowers docs/plans/plan.md`; at the Step-3 gate, revise knobs to
     `tierOverrides: {cheap: 'opus', standard: 'opus'}`, then approve.

   Stop the clock at the **pre-merge gate** (ultrapowers) or when the executor reports
   the plan complete (serial). Do not approve the merge / finish the branch — scoring
   happens on the integration branch.

3. **Record cost.**
   - **API billing:** run `/cost` in the session and note the USD figure (plus any
     subagent spend it reports).
   - **Subscription plans (Max):** two numbers per run. (a) Snapshot `/usage`'s
     weekly-limit percentage immediately before and after the run — pass them as
     `--weekly-pct-before/--weekly-pct-after`. (b) Pull per-model token totals from
     the session transcript (community tools like ccusage automate this) and convert
     to API-equivalent USD with `evals/scripts/api_equiv.py`; pass that as
     `--cost-usd`. The weekly-% delta is the empirical capacity cost — it composes
     into the "runs per week on a Max plan" headline in the report.

4. **Score:**

   ```sh
   python3 evals/scripts/score_run.py wide /tmp/eval-runs/wide-B-1 \
       --condition B --rep 1 --cost-usd 14.20 \
       --fix-rounds 1 --blocked-tasks 0 --redirects 0
   ```

   This runs the fixture's own suite, then the held-out acceptance suite, captures the
   `eval-baseline...HEAD` diff for the judge, and appends a row to
   `evals/results/runs.jsonl`. Pull `--fix-rounds` / `--blocked-tasks` from the
   ultrapowers end-of-run report (use 0 for condition A unless the executor reports
   retries).

### Automated execution (protocol amendment, 2026-06-13)

Conditions B and C may run unattended via `evals/scripts/night_runner.sh`
(serial queue, headless `claude -p` sessions) with two approved amendments:
(1) the human gates are scripted — the run receives standing answers (approve
the wave plan as proposed; C revises `tierOverrides` first; stop at the
pre-merge gate without merging) identical in content to the human-gated runs;
(2) per-run `weekly_pct` is null — cost comes from `extract_tokens.py`
(validated against the client's own accounting) and a single before/after
`/usage` snapshot pair reconciles each batch. Automated rows are tagged
`automated headless run` in notes. `autoscore.py` performs the mechanical
scoring. Wall clock = headless process duration. Runs stay serial — parallel
runs would contaminate the clock metric through contention.

### No Step-3 pause (protocol amendment, 2026-06-12)

Ultrapowers removed the Step-3 wave-plan approval pause: the wave plan is
rendered for transparency and the workflow launches immediately. The condition
texts above are preserved as written for the historical runs; future
repetitions map them as follows:

- **Condition B:** invoke `/ultrapowers docs/plans/plan.md` — no approval step
  exists or is needed; the wave plan executes as rendered.
- **Condition C:** there is no longer a gate at which to revise the derived
  knobs. State the override in the invocation itself, e.g.
  `/ultrapowers docs/plans/plan.md — run all-frontier: tierOverrides
  {cheap: 'opus', standard: 'opus'}`; the orchestrator translates a stated
  budget posture into `tierOverrides` at Step 2.
- The stop point is unchanged: the pre-merge gate. Do not approve the merge.

## Metrics

| Layer | Metric | Source |
|-------|--------|--------|
| Cost | USD per run | `/cost`, recorded at session end |
| Clock | seconds, launch → pre-merge gate | prepare timestamp → scoring (or `--wall-clock-s`) |
| Quality 1 | held-out acceptance pass rate | `score_run.py` (primary quality number) |
| Quality 2 | blinded pairwise judge win rate | `judge.py` (frozen rubric, randomized order) |
| Quality 3 | reliability counters: fix rounds, blocked tasks, human redirects | end-of-run report |

## Judging

Automated, blinded, pairwise:

```sh
export ANTHROPIC_API_KEY=...
python3 evals/scripts/judge.py --fixture wide --cond-a A --cond-b B
```

The judge (a fresh-context `claude-opus-4-8`) sees the plan and two anonymized diffs in
randomized order and returns a structured verdict on four criteria: correctness, plan
fidelity, scope discipline, code quality. Results append to `evals/results/judgments.jsonl`.

**Judge reliability** (no human code review — the operator is not expected to
read diffs; this replaces the original human calibration pass): two automated
checks stand in. (a) The self-pair smoke test: judging a diff against itself
must return `tie` (see `JUDGE_KICKOFF.md` step 4). (b) The order-swap
stability check:

```sh
python3 evals/scripts/judge.py --check-stability
```

re-judges every recorded pair with the two diffs presented in the opposite
order — position bias is the dominant known failure mode of pairwise LLM
judges. Results append to `evals/results/stability.jsonl`; read any flipped
verdict as a tie when interpreting win rates.

## Reporting

```sh
python3 evals/scripts/report.py
```

Emits the per-fixture × condition table, partitioned by engine version (median cost,
median clock, acceptance pass rate, suite green rate, **plan coverage**, **engine
version**, fix rounds) plus judge win rates.

## Validity notes

- The plan documents and acceptance tests are frozen **before** the first run; never
  edit them mid-matrix. If a plan turns out to be broken, fix it, bump the fixture, and
  restart that fixture's cells.

**Fixture versions.** Each fixture carries a `version.txt` recording its
generation and what changed. When a frozen plan is found broken, fix it, bump
`version.txt`, and restart that fixture's cells (per the validity rule above).
The buggy first generation may instead be *promoted* to its own fixture (see
`flawed`) so the stressor is measured deliberately rather than lost.

**Engine versions & pooling.** Every run records the engine plugin_version (a
release-bumped behavior proxy) plus its repo sha as provenance. `report.py`
partitions medians by plugin_version and never pools across versions, and flags
any population assembled from more than one sha as '(N shas)'.

**Freeze-then-complete.** Complete the remaining cells of the matrix on the
current frozen engine before merging engine-behavior changes (e.g. the
eval-driven hardening plan). The hardened engine is then run and reported as a
separate population, not merged into the frozen baseline's medians.

**Plan coverage.** Each row records `tasks_planned`/`tasks_merged`; `report.py`
shows median coverage and flags any cell that is suite-green but coverage < 100%
(green-but-incomplete) — a half-merged plan can no longer read as a clean pass.
- Condition A executes `gate` tasks inline (sequential executors treat every task as
  ordinary); ultrapowers compiles them into run config. Same verification either way.
- Wall clock is sensitive to engine load and human latency at gates; treat it as
  indicative, cost and acceptance rate as the hard numbers.
- One eval, five fixtures — this measures *this* task distribution. Real-repo validity
  is a follow-up, not a freebie.

## Micro-test loop (prompt-phrasing tuning before full runs)

The 45-cell matrix is the expensive, slow instrument. Before spending a single
matrix run on a prompt change, tune the **phrasing** with the micro-test loop —
one API call per sample, programmatic scoring, seconds and ~$0.15–0.30 per
sample:

```sh
evals/scripts/run-micro.py --variants variants.json --scorer json_object \
    --samples samples.json --n 5
```

`variants.json` is a list of `{name, instruction}` phrasings; `samples.json` is a
list of sample dicts; `--scorer` names a programmatic check (`json_object`,
`nonempty`, …) registered in `SCORERS`. The loop prints each variant's **mean**
and **variance**.

**It always runs a no-guidance control.** A `control-no-guidance` variant (empty
instruction) is injected automatically and sorted to the top. That control is the
bar every phrasing must clear: the v6 work measured that a *prohibition* on output
shape can score **below** saying nothing at all. The rule that follows —
**positive recipe, not prohibition** — is exactly what this loop is for. Use it to
tune the baked reviewer/implementer contracts (§2.4) before committing to a full
run. The model call is injected, so the scorer and aggregation are unit-tested
offline in `tests/test_run_micro.py`.

## Re-freeze protocol (when engine behavior changes)

Engine-behavior changes (new prompts, new tiering, the v6 integration) invalidate
the frozen baseline. To re-measure:

1. **Bump the engine `0.0.x` version.** The plugin version is the behavior proxy
   `report.py` partitions on; a behavior change with no version bump silently
   pools two different engines.
2. **Re-run the 45-cell matrix fresh on the new frozen version.** Do not reuse
   rows produced by an older `plugin_version`. Old rows remain valid *as that
   version's population* — historical, not current.
3. **Never pool across `plugin_version`.** `report.py` partitions medians by
   `plugin_version` and never pools across versions. Do not defeat this by hand.

The old population is not deleted; it is a different engine. Report the re-frozen
engine as its own population beside the prior one, never merged into it.

## Per-component cost-attribution (finding the hot spots)

Headline USD-per-run says *whether* a run was expensive; it does not say *where*
the cost went. Attribute cost per component using the per-role turn/output-token
proxies from `scripts/audit_run.py`. Fill one table per run (or per median cell):

| Component | Turns | Output tokens | Share of run cost | Notes |
|-----------|------:|--------------:|------------------:|-------|
| Controller (orchestration) | | | | setup + wave planning + gate decisions |
| Implementers (all tasks) | | | | the generative bulk; tiered model |
| Reviewers (per-task) | | | | always-opus; the live-git + suite-run sink |
| Final review (completeness critic) | | | | opus on the integrated tree |
| **Total** | | | **100%** | reconcile against `/cost` or `extract_tokens.py` |

Read the table for **share of run cost**, not absolute tokens: the largest share
is the first place an efficiency lever pays off. Re-fill it after any efficiency
change to confirm the share actually moved.
