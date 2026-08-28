# Wave width, measured — the "4 suggested" constant replaced

**Status:** measurement record. Consumed by the one-driver spec §2/§8b and the engine
intent's `## Cadence`. Supersedes Amendment 3's *"capped by a driver constant (4
suggested)"*.
**Machine:** `fleet-width`, a `cp fleet-golden` clone — **8 vCPU / 15 GB**, i.e. a real run
sandbox, not the 1-vCPU orchestrator the original datum came from. Destroyed at the end.
**Raw:** `pwidth.tgz` (27 envelopes + CPU samples), pulled before teardown.

## Why the old number did not survive contact

Amendment 3 set width from *"N=3 on a 1-vCPU/2 GB box ran clean"* and suggested **4** —
the largest width ever run, plus one. Nothing had run at 4, and the box it was measured on
is **one eighth** the size of a real sandbox.

## Method

One warmup worker first, so no arm pays a cold prefix. Then N = 2, 4, 8, 12 concurrent
`claude -p` workers, each doing a **real** investigation on the repo checked out on the
sandbox — `Read,Grep,Glob` over `fleet/`, returning a schema-validated answer. Not a
"reply ok" probe: the tool-use and file-I/O shape of an implementer, minus the edit.
A `/proc/stat` + loadavg sampler at 2 s cadence ran for the length of each arm.

## Result — flat to N=12, and nothing failed

| N | total wall | mean/worker | success | CPU % peak | CPU % mean | load peak |
|---|---|---|---|---|---|---|
| 1 (warmup) | 11.94 s | 11.94 s | 1/1 | — | — | — |
| 2 | 12.77 s | 12.07 s | **2/2** | 14 | 3 | 0.33 |
| 4 | 14.60 s | 12.22 s | **4/4** | 29 | 5 | 0.28 |
| 8 | 12.83 s | 11.66 s | **8/8** | 66 | 14 | 0.21 |
| 12 | 13.89 s | 12.98 s | **12/12** | **98** | 22 | 1.13 |

**Wall-clock is flat.** Twelve concurrent workers finish in 13.9 s against 11.9 s for one —
**+16% for 12× the work**. **Zero non-success envelopes across all 27 workers.**

**CPU peak is the only thing that moves**, and it moves linearly: 14 → 29 → 66 → **98%**,
about 8 points per worker, reaching the ceiling at N=12. Mean CPU stays at 22% and load
peaks at 1.13 on 8 cores — these workers are network-bound and bursty, not CPU-bound.

**Cache, corroborating #382 at real width:** at N=12 the mean cache read was **145,439
tokens against 2,739 created — a 98.2% share.** Every sibling read a warm prefix.

## Decision returned

**Raise the default from 4 to 8.** N=8 is the last arm with real headroom — 66% peak CPU,
load 0.21, wall-clock flat. N=12 completes cleanly but sits at the CPU ceiling with no
margin, and margin is the point of a default.

## The caveat that bounds this result

**These workers only read.** A real implementer **runs the test suite**, which is genuinely
CPU-bound in a way `Grep` is not. So this measures the *dispatch layer's* ceiling, not the
*workload's* — and for implementers the binding constraint will be test execution, which is
unmeasured here. The number to raise is the default; the thing still owed is the same arm
with a worker that runs `pytest`.

Read the table as: **the CLI and the sandbox are not the limit up to 12.** Whether the
work is depends on the work.

## A second, unplanned confirmation

`billing usage` read `avg_cpu_cores` **0.245 before the experiment and 0.245 after** — a
four-minute, 27-worker run did not move it at all. That is the RUNBOOK §Capacity caveat
demonstrated rather than asserted: `avg_cpu_cores` is a billing-cycle average, useful for
"is the account near its meter" and useless for per-run signal. Per-run resolution comes
from the sandbox's own `/proc/stat`, or from `stat <vm> --range=24h`.
