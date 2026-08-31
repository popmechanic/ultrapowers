# run-32 sandbox burst load — 16 vCPU, the second burst-resolution sample

Sampled inside the live `fleet-run-32` sandbox on 2026-08-31, every 5 s for the
whole run (519 samples, 02:04:52–02:48:23 UTC), and rescued to the laptop by a
20 s `scp` loop before `driveOne`'s teardown destroyed the box. The sandbox died
roughly 30 s after the last sample.

**Why it exists.** Same reason as `2026-08-30-run30-sandbox-burst-load/`: the
`exe.dev stat` payload `drive.mjs` harvests into `stat-run-<id>.json` is
hourly-binned and cannot see a 90-second pytest burst. This run is the direct
comparison point — run-30 at **8** vCPU, run-32 at **16** (`--sandbox-cpu 16`).

**Format.** `HH:MM:SS load1 load5 load15 claude=<n> pytest=<n>`

## What it shows

| | run-30 (8 vCPU) | run-32 (16 vCPU) |
|---|---|---|
| peak load1 | 2.25 (28% of cores) | **2.47 (15% of cores)** |
| max concurrent `pytest` procs | 5 | 12 |
| wave-1 width | 5 | 4 |
| worker test command | `-p no:xdist` | `-n 2` |

**Doubling the cores did not raise the ceiling.** Peak load rose 2.25 → 2.47
while core count went 8 → 16, so utilisation *halved*. This corroborates run-31's
finding that `--sandbox-cpu 16` buys nothing, and it is now measured at burst
resolution rather than inferred from the hourly bin.

**The control plane understated the peak by 5.6×.** The same run's
`gate-read-run-32.detail.json` reports `sandboxStat.peakCores: 0.44` against the
sampler's 2.47. That is the #452 defect, quantified on a second run.

**Peak is at the gate, not in the wave.** The 2.47 peak lands at 02:47:43, during
the driver's post-fold suite — not during wave 1's four concurrent implementers
(which peaked near 1.9). The widest part of the run is not the busiest part.

## Caveats — read before quoting a number

- **`pytest=` over-counts.** `pgrep -fc "m pytest"` also matches the implementers'
  prompt text and the bash wrappers. For the real command line, run-32's own
  worker argv shows `TEST COMMAND: python3 -m pytest -n 2` for all four wave-1
  implementers. Trust `claude=` and the load averages.
- **The raw capture needed repair.** The sampler used
  `claude=$(pgrep -c claude 2>/dev/null || echo 0)`; `pgrep -c` prints `0` *and*
  exits 1 when it finds nothing, so `|| echo 0` fired too and the field became
  `0\n0` — splitting every zero-count sample across two lines. The raw file had
  766 lines for 519 samples. `samples.txt` here is the repaired form (rejoined on
  the timestamp anchor, 519 parsed, 0 unparsed). **Two intermediate readings taken
  from the unrepaired file (1.64 and 1.87) were both wrong; 2.47 is the figure.**
  A future sampler should use `pgrep -c … 2>/dev/null; echo $?`-free arithmetic or
  `| wc -l`.
