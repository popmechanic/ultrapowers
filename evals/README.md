# ultrapowers evals

A controlled comparison of plan-execution engines across **cost**, **clock time**, and
**quality**. Designed to answer three questions with attribution, not just one headline:

1. Is ultrapowers better than the serial superpowers baseline? (A vs B)
2. What does model tiering cost in quality, at constant orchestration? (B vs C)
3. What does the orchestration alone buy, at constant model spend? (A vs C)

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

Four purpose-built fixture repos under `evals/fixtures/`, one per DAG regime:

| Fixture | Regime | Expected wave shape (B/C) |
|---------|--------|---------------------------|
| `wide` | 6 independent tasks — parallelism's best case | 1 wave of 6 |
| `chained` | 5 tasks in a strict dependency line — parallelism's worst case | 5 waves of 1 |
| `mixed` | realistic diamond DAG, 6 tasks | `[1,4] → [2,3] → [5] → [6]` |
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

4 fixtures × 3 conditions × 3 repetitions = **36 runs**. Agentic runs are heavy-tailed:
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

Emits the per-fixture × condition table (median cost, median clock, acceptance pass
rate, suite green rate, fix rounds) plus judge win rates.

## Validity notes

- The plan documents and acceptance tests are frozen **before** the first run; never
  edit them mid-matrix. If a plan turns out to be broken, fix it, bump the fixture, and
  restart that fixture's cells.
- Condition A executes `gate` tasks inline (sequential executors treat every task as
  ordinary); ultrapowers compiles them into run config. Same verification either way.
- Wall clock is sensitive to engine load and human latency at gates; treat it as
  indicative, cost and acceptance rate as the hard numbers.
- One eval, four fixtures — this measures *this* task distribution. Real-repo validity
  is a follow-up, not a freebie.
