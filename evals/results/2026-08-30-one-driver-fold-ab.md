# Fold vs serialize on the One Driver — 2026-08-30

The registered A/B protocol, re-run on the 0.3.0 engine with the rebuilt rig
(#402 item 6). Twelve cells across six fixtures, both arms, serial, local
(`evals/ab_runner.py`, laptop subscription). Engine ref `eca7dd9`.
Rows are appended to `evals/results/runs.jsonl`; the `wide` pair comes from the
same day's operator smoke.

## Result

| fixture | fold | serialize | ratio | fold waves | ser. waves | fold tok | ser. tok | tok ratio |
|---|---|---|---|---|---|---|---|---|
| wide | 201.5s | 207.7s | 0.970 | 1 | 1 | 32,287 | 32,610 | 0.990 |
| chained | 512.7s | 537.3s | 0.954 | 5 | 5 | 37,942 | 39,230 | 0.967 |
| mixed | 457.5s | 453.7s | 1.008 | 4 | 4 | 43,446 | 42,537 | 1.021 |
| contend | 215.8s | 277.3s | 0.778 | 1 | 3 | 27,659 | 22,334 | 1.238 |
| contend-prod | 979.5s | 1468.7s | 0.667 | 1 | 4 | 186,275 | 132,597 | 1.405 |
| contend-big | 934.0s | 2611.3s | **0.358** | 1 | 4 | 212,310 | 227,456 | 0.933 |

- **Aggregate wall: 0.594×** (3301s fold vs 5556s serialize) — the registered
  2026-08-14 baseline was 0.640× on the pre-cutover engine. Fold's advantage
  survives the One Driver cutover intact.
- **Contention-only wall: 0.489×** — over the three fixtures whose wave shape
  actually differs between arms, fold runs in half the time.
- **Aggregate output tokens: 1.087×** — fold costs ~9% more tokens for that
  wall-clock win. Per-fixture the token penalty concentrates where contention
  is resolved (`contend-prod` 1.41×, `contend` 1.24×), and `contend-big`
  inverts (0.93×) — a long serialize chain re-reads more context than a
  resolved fold does.

## What the shape column proves

The three non-contention fixtures compile to **identical wave shapes in both
arms** (wide 1/1, chained 5/5, mixed 4/4). With the same shape the two cells
run the same work in the same order, so their ratios — 0.970, 0.954, 1.008 —
measure nothing but run-to-run LLM latency variance. That is the noise floor:
**±5%**. Every contention ratio (0.778, 0.667, 0.358) clears it by a wide
margin.

This doubles as the arm-identity check the old rig enforced explicitly: the
serialize arm really does serialize (3–4 waves where fold takes 1), so the
protocol is comparing two genuinely different execution geometries rather than
running the same thing twice.

## Caveat on comparability

0.640× (2026-08-14) was measured on the deleted engine with a different worker
mix; 0.594× here is a *different measurement*, not a regression or improvement
of that number. What this run establishes cleanly is fold-vs-serialize **on
today's engine**, which is the decision-relevant comparison — the default is
already fold, and it stays justified.

## Excluded fixtures

- `flawed`, `flawed-routing`, `degrade` — deliberate-defect fixtures that
  exercise the compiler's diagnostics; their historical arm rows came back
  `invalid` on arm identity.
- `webapp` — greenfield fixture: its project tree is `package.json` + README,
  and the plan creates the tests, so no baseline suite can be green at BASE.
  Knob validation refuses (correctly, in 0.3s for $0.00) under both
  `python3 -m pytest` and `npm test`. It was never in the registered A/B set
  (historical rows carry `arm=None`).

## Run conditions

All fourteen cells ended `gate-blocked` on the same `deferred:manual` ack — the
TDD red-then-green ordering, which is process-order and not observable in a
diff. That is the honest verdict for an unattended cell and does not affect the
timing or token measurement. Total spend $69.85.
