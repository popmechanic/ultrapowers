# run-30 sandbox burst load — the first burst-resolution CPU data the fleet has

Sampled inside the live `fleet-run-30` sandbox on 2026-08-30, every 5 s for the
whole run (208 samples, 22:52:24–23:09:46 UTC), and copied off the box before
`driveOne`'s teardown destroyed it.

**Why it exists.** `exe.dev stat` — the source `drive.mjs:266` harvests into
`stat-run-<id>.json` — is **hourly-binned**: runs 15–29 carry n=1–10 points across
a ~50 min run, so peak-of-hourly-mean ≈ mean and a 90-second pytest burst is
invisible by construction. Both #387 (sandboxes are oversized → shrink them) and
#436 (`capWorkerParallelism`: concurrent `-n auto` suites would saturate → serialise
them) were argued from that metric, in opposite directions. Neither could be.

**Format.** `HH:MM:SS load1 load5 load15 claude=<n> pytest=<n>`

The `pytest=` column over-counts: `pgrep -fc "m pytest"` also matches the
implementers' prompt text and the bash wrappers. Trust `claude=` and the load
averages; for the real command line, the run's own record shows
`5 × python3 -m pytest -p no:xdist` under `timeout 3000`.

## Readings

```
sandbox                                8 vCPU / 16 GB, nproc 8
peak load1 overall                     2.25  (28% of 8 cores)
with all 5 implementers live (n=43)    peak 2.25, mean 1.71
steal (/proc/stat)                     0.84%   — the ~3x account overcommit was not biting
suite on this hardware                 179.4 s serial · 85.1 s -n auto (900 passed, 1 skipped)
```

**What it shows.** Five *serial* suites running concurrently — the exact burst
`capWorkerParallelism` exists to prevent — never exceeded 28% of the machine, i.e.
~0.32 cores per suite against the ~1 core per pytest process the `floor(cpus/width)`
model implicitly prices. The cap clamped implementers to `-p no:xdist`, costing each
179.4 s instead of 85.1 s per pass across 2–3 passes, to protect 72% idle.

**What it does not show.** One run, one plan shape (depth 1, width 5), on a laptop-
driven fleet. It does not establish where the ceiling is — only that it was not
reached here. #452 carries the open question; the cheap next experiment is run-31 at
`--sandbox-cpu 16` (`floor(16/5) = 3` → implementers get `-n 3`).

**How to reproduce.** `exe.dev stat` cannot do this. Ssh into the live sandbox and
sample `/proc/loadavg` on a 5 s loop, then copy the file off before teardown — it
dies with the VM otherwise.

Refs: #452, #387, #436, #426, PR #451.
