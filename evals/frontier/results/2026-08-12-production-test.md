# Frontier production test — Stage 1 + Stage 2 results

Plan: `docs/superpowers/plans/2026-08-11-frontier-production-test.md` (Tasks 6–7).
Spec: `docs/superpowers/specs/2026-08-11-frontier-production-test-design.md` (§Gates, §Decision rule).
Engine ref for both arms: `aaa97b9` (main, 2026-08-12; suite 849 green).

## Stage 1 — shadow evidence (Task 6)

Six real runs shadowed across three repos (ultrapowers, Julian, skylights); one further
run (`Julian/run-20260731-145213`) excluded whole-run by name (`no per-task merges —
nothing to replay`). Zero silent divergence in every shadowed run; every unshadowable
shape parked/excluded by name. Reports: `2026-08-12-shadow-*.{md,json}` in this directory.

| run (repo) | waves (disposition/endpoints) | ≥2-endpoint clean wave | same-file edges |
| --- | --- | --- | --- |
| `run-20260801-132730` (Julian) | 1:clean/3, 2:clean/1, 3:excluded/1, 4:trailing-cut/1 | **yes (3)** | 0 |
| `run-day1-b0-bridge-0812` (skylights) | 1:clean/1, 2:clean/2 | **yes (2)** | 0 |
| `run-20260812-b2face` (Julian) | 1:absorbed/1, 2:clean/1 | no | 0 |
| `run-b1emh-20260812` (skylights) | 1:clean/1 | no | 0 |
| `run-zoho-hardening-0811` (skylights) | 1:clean/1 | no | 0 |
| `run-20260731-145213` (Julian) | excluded whole-run, by name | — | — |

**G1 (shadow fidelity): PASS.** Floor is one run with ≥1 true merge wave folding ≥2
task endpoints, zero silent divergence; two qualifying rows landed (`20260801-132730`
wave 1 = 3 endpoints; `day1-b0-bridge-0812` wave 2 = 2 endpoints), all fold orders
outcome-identical, clean paths manifest-identical to the shipped wave trees.

Side observation for E1 context: every shadowed run shows `same_file_edges = 0` and
frontier makespan exactly equal to wave makespan — real authored plans (under the
current serialization rule) present no contention for the frontier to recover. The
E1 measurement therefore rests entirely on the contended fixture below.

## Stage 2 — live A/B cells (Task 7)

Fixture: `evals/fixtures/contend` (3 tasks genuinely edit one file; no Depends-on).
Arms sequential on one machine, same engine ref.

### G2 — live mechanics

**PASS.** Arm B completed end-to-end first attempt (`status: complete`): the folded
tree passed the contend sealed suite by exit-code authority (seal `cb7073504c66`,
exit 0, **7/7** — the spec's "9/9" was a sketch-time estimate; the shipped exam has
7 rows) and the resolution-aware live K1 check held (`shuffleOutcomes: 1` — all
sampled raw fold orders outcome-identical; `replayMatches: true` — the recorded
fold/resolution event log replays deterministically to the shipped manifest).
Result head `3df4232`; raw runner JSON: `2026-08-13-frontier-cell.json`.

### G3 — resolver honesty

**PASS.** Two conflicts surfaced; both carried the annotated block narration, both
dispatched within contract (serial, whole-file, ≤400 visible lines), both resolved
on **attempt 1** and applied under the application-validity rule. Zero parks, zero
retries, zero silent drops — `parkedTasks: {}`, every dispatch recorded verbatim in
`resolverTranscript`. (Honesty gate only; correctness is G2's sealed suite and the
E2 grade below.)

### E1 — wall clock

| interval | arm A (kit) | arm B (frontier) |
| --- | --- | --- |
| end-to-end cell (launch → gate ready) | **685.6 s** | **82.9 s** |
| per-task implementer wall clock | serialized (sum ≈ cell) | 38.6 / 38.6 / 41.1 / 41.4 s |
| peak parallelism | 1 (serialized chain) | 4 |
| output tokens | 54,090 | not instrumented in the cell driver |
| gate verdict | PASS (0 redirect rounds, 0 false blocks) | PASS (sealed 7/7) |

Arm B is **8.3× faster end-to-end (−88%)** on this fixture. Confounds, named per
spec: arm A runs the full engine protocol (per-task review, wave merges, gate
ceremony) while arm B is the minimal frontier driver — the interval difference
includes protocol overhead, not merge mechanics alone; the review-loop interval
differs by arm construction. Provenance: arm A's first attempt
(`startedAt 2026-08-13T00:35:46Z`, 541.6 s) died at gate-report time on a transient
OAuth expiry and never produced a gate verdict — an invalid interval, superseded via
`--rerun-of` by the valid row (`startedAt 2026-08-13T00:48:08Z`). Arms ran
sequentially on one machine, same engine ref.

**Operator E1 materiality call:** MATERIAL — recorded with the decomposition: the parallelism ratio (~2x on this 4-wide fixture, width- and length-scaling) is the causal gain; the headline 8.3x is confounded by protocol asymmetry (arm A carries review + wave ceremony that a production frontier mode would keep). Token cost unmeasured in arm B — carried as an open question for the increment's own A/B. (Adjudicated 2026-08-12, operator concurring with the advisory assessment.)

### E2 — narrations and resolutions, verbatim

Both conflicts are genuine three-way collisions on `clitool/cli.py` (tasks 1–4 all
edit it; no Depends-on). Narrations and resolver replies verbatim from
`resolverTranscript` in the raw JSON; the sealed suite (G2) confirmed both
resolutions mechanically.

#### Conflict — task 2 vs frontier (attempt 1)

Narration as dispatched:

```
"""Tiny report CLI: parse args, list rows, print them."""
import argparse

ROWS = [("ada", 3), ("bob", 5), ("eve", 1)]


def render(row, fmt):
    name, count = row
    if fmt == "csv":
        return "%s,%d" % (name, count)
    return "%s %d" % (name, count)


def build_parser():
    parser = argparse.ArgumentParser(prog="report")
<<<<<<< begin added 2
    parser.add_argument("--format", choices=["plain", "csv"], default="plain")
======= begin added frontier
    parser.add_argument("--verbose", action="store_true", default=False)
>>>>>>> end conflict
    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    rows = list(ROWS)
<<<<<<< begin added 2
    for row in rows:
        print(render(row, args.format))
======= begin added frontier
    if args.verbose:
        print("rows: %d" % len(rows))
======= begin deleted 2
    for name, count in rows:
        print("%s %d" % (name, count))
>>>>>>> end conflict
    return 0
```

Resolved file as applied:

```python
"""Tiny report CLI: parse args, list rows, print them."""
import argparse

ROWS = [("ada", 3), ("bob", 5), ("eve", 1)]


def render(row, fmt):
    name, count = row
    if fmt == "csv":
        return "%s,%d" % (name, count)
    return "%s %d" % (name, count)


def build_parser():
    parser = argparse.ArgumentParser(prog="report")
    parser.add_argument("--format", choices=["plain", "csv"], default="plain")
    parser.add_argument("--verbose", action="store_true", default=False)
    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    rows = list(ROWS)
    if args.verbose:
        print("rows: %d" % len(rows))
    for row in rows:
        print(render(row, args.format))
    return 0
```

**Operator grade:** ACCEPTABLE — correct two-way union; both flags preserved, replaced print loop correctly dropped.

#### Conflict — task 3 vs frontier (attempt 1)

Narration as dispatched:

```
"""Tiny report CLI: parse args, list rows, print them."""
import argparse

ROWS = [("ada", 3), ("bob", 5), ("eve", 1)]
<<<<<<< begin added both


======= begin added 3
def clamp(rows, limit):
    if limit is None:
        return list(rows)
    if limit < 0:
        raise ValueError("limit must be >= 0")
    return list(rows)[:limit]


======= begin added frontier
def render(row, fmt):
    name, count = row
    if fmt == "csv":
        return "%s,%d" % (name, count)
    return "%s %d" % (name, count)


>>>>>>> end conflict
def build_parser():
    parser = argparse.ArgumentParser(prog="report")
<<<<<<< begin added frontier
    parser.add_argument("--format", choices=["plain", "csv"], default="plain")
======= begin added 3
    parser.add_argument("--limit", type=int, default=None)
======= begin added frontier
    parser.add_argument("--verbose", action="store_true", default=False)
>>>>>>> end conflict
    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
<<<<<<< begin added 3
    rows = clamp(ROWS, args.limit)
======= begin deleted 3
    rows = list(ROWS)
======= begin added frontier
    if args.verbose:
        print("rows: %d" % len(rows))
    for row in rows:
        print(render(row, args.format))
======= begin deleted 3
    if args.verbose:
        print("rows: %d" % len(rows))
======= begin deleted frontier
    for name, count in rows:
        print("%s %d" % (name, count))
>>>>>>> end conflict
    return 0
```

Resolved file as applied:

```python
"""Tiny report CLI: parse args, list rows, print them."""
import argparse

ROWS = [("ada", 3), ("bob", 5), ("eve", 1)]


def clamp(rows, limit):
    if limit is None:
        return list(rows)
    if limit < 0:
        raise ValueError("limit must be >= 0")
    return list(rows)[:limit]


def render(row, fmt):
    name, count = row
    if fmt == "csv":
        return "%s,%d" % (name, count)
    return "%s %d" % (name, count)


def build_parser():
    parser = argparse.ArgumentParser(prog="report")
    parser.add_argument("--format", choices=["plain", "csv"], default="plain")
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--verbose", action="store_true", default=False)
    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    rows = clamp(ROWS, args.limit)
    if args.verbose:
        print("rows: %d" % len(rows))
    for row in rows:
        print(render(row, args.format))
    return 0
```

**Operator grade:** ACCEPTABLE — correct three-way union; both helpers kept, all three flags present, main composed in the right order (clamp -> verbose -> render), deleted blocks not resurrected. Scope caveat recorded: a ~30-line file with semantically compatible edits; semantic-conflict, near-cap, and re-narration paths unexercised live.

## Decision (spec §Decision rule)

G1 ☑ / G2 ☑ / G3 ☑ green, operator judges E1 material ☑, grades E2 acceptable ☑ →
propose the engine-integration increment (frontier mode in the shipping engine).
Any red / dull E1 / failing E2 → stop.

**Operator adjudication:** PROPOSE — G1/G2/G3 green, E1 material (as decomposed above), E2 acceptable (with scope caveat). Per the decision rule, the engine-integration increment (frontier mode in the shipping engine) may be proposed. Next artifact: a frontier-mode spec via the standard brainstorm -> trim-review -> ultraplan cycle, whose own A/B must close the two questions this cell could not: token cost, and the parallelism ratio at production task length with review kept on. (Adjudicated 2026-08-12, operator concurring with the advisory assessment.)
