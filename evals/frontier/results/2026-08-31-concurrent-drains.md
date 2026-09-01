# Concurrent drains (#454) — where throughput stops scaling, and what binds first

**Status:** pre-registered protocol. Predictions below were committed BEFORE any arm ran
(sitting 2 of the merge-frontier sprint, map #360; design inputs verified in #454's
2026-08-31 comment). Results are appended after; the predictions section is never edited.

## Method

- **Payload:** every drain drives the SAME plan, `docs/superpowers/plans/2026-08-31-drainprobe.md`
  (4 independent implementation tasks contending on `evals/drainprobe/probecli/cli.py`,
  suite acceptance, compiled fold shape = 1 wave of 4). Identical plans buy exact
  comparability across arms and manufacture cross-run same-file traffic by construction —
  the deliberate Tier-2/W2b firing #360's sprint charter asks for, and #358's corpus.
- **Arms, serial:** N=1 (run-35), then N=2 (runs 36+37), then N=3 (runs 38+39+40). Each
  drain: own runId, own `--port` (8181–8185), own `--db-dir`. Launched per the RUNBOOK
  nohup shape; verified with `pgrep -af drive-one`, never by waiting on the launch ssh.
- **Substrate, fixed before any arm:** orchestrator resized 1→2 vCPU, 2→4 GB (the #454
  design-inputs comment's instruction — two-plus drivers in a 1-vCPU VM is the cheapest
  thing to get wrong). Sandboxes are stock 8-vCPU golden clones.
- **Reads:** wall per drain (drive-one stdout timestamps) and per batch; `/usage` from the
  laptop token (Keychain → `GET /api/oauth/usage`) before/between/after arms; 5-second
  `/proc/loadavg` sampler in every sandbox run dir (rides the evidence pull, #387) and on
  the orchestrator; 429/`api_retry` counts from stream-json; cache-read share per drain.
- **Stop rule (pre-registered):** stop raising N at the first arm where mean per-drain wall
  degrades more than the batch improves (per-drain wall ratio to N=1 exceeds the batch
  speedup ratio), or where `/usage` shows the window binding (>50% consumed).
- **Hazard controls:** `.github/workflows/` merge freeze for the whole window (#497); no
  PRs merged from measurement runs (all closed after reading); run IDs 35+ never reused.

## Pre-registered predictions

1. **The window does not bind.** Total `/usage` 5-h-window consumption across all six
   drains stays under 25%; no drain is starved (zero AGENT_NULL from rate exhaustion).
2. **Per-drain wall degrades slowly:** N=2 mean per-drain wall within +20% of N=1;
   N=3 within +35% of N=1. Batch throughput improves monotonically: N=3 batch wall
   ≤ 0.5 × (3 × N=1 wall).
3. **Nothing binds through N=3.** Orchestrator (2 vCPU) 1-min load < 1.5 at N=3; sandbox
   load < 2.5 of 8; zero 429/api_retry events; exe.dev steal < 5%.
4. **Tier-2/W2b trigger fires by construction** — every pair of concurrent drains writes
   the same files. The reading owed #360 is the contention's *shape* (which files, how
   divergent the concurrent edits are), not whether it fired.
5. **Cache inflation caveat, pre-registered:** identical plans share warm prefixes
   (#382), so cache-read share per drain will be ≥90%, and the measured concurrency
   advantage is an upper bound relative to a fleet driving distinct plans.

## Results (arms ran 2026-08-31 23:30 → 2026-09-01 00:31 UTC, one 5-h window)

**All six drains gate-green. The stop rule never fired. Nothing bound.**

| arm | run | launch (UTC) | gate-green | wall | spend (tok) | PR |
|---|---|---|---|---|---|---|
| N=1 | run-35 | 23:30:00 | 23:53:05 | 23m05s | 82,997 | #506 |
| N=2 | run-36 | 23:54:42 | 00:09:41 | 14m59s | 85,095 | #507 |
| N=2 | run-37 | 23:54:59 | 00:12:18 | 17m19s | 89,420 | #508 |
| N=3 | run-38 | 00:12:49 | 00:29:40 | 16m51s | 79,594 | #509 |
| N=3 | run-39 | 00:12:49 | 00:29:52 | 17m03s | 76,818 | #510 |
| N=3 | run-40 | 00:12:49 | 00:30:50 | 18m01s | 94,447 | #512 |

- **Batch wall:** N=2 = 17m36s (0.38× of 2× the N=1 wall); N=3 = 18m01s (**0.26×** of 3×).
- **Per-drain wall did not degrade at all** — it *improved*: N=2 mean 16m09s (0.70× of N=1),
  N=3 mean 17m18s (0.75× of N=1). The N=1 baseline was the slowest of all six runs; read the
  improvement as warm-prefix sharing (#382) plus run-to-run variance, not as concurrency
  speeding runs up. The pre-registered bounds (+20%/+35%) were passed with room to spare.
- **Predictions: 4/5 confirmed; prediction 1 UNVERIFIED** (see instrument caveats — the
  metered account was not the spending account; no starvation occurred, but window
  consumption was not observed). (2–3) No binder surfaced:
  orchestrator (2 vCPU post-resize) peak load **0.75**, mean 0.06 over the whole window;
  sandbox peaks 2.43–3.69 of 8 cores (full-run 5-s sampling, 1,228 samples across six runs —
  closing #387's wave-1/2 blind spot); memory peaks ~2 GB of 16; **zero** 429/rate-limit/
  api_retry events in any run's stream-json (instrument validated against 609 live event
  lines). (4) The Tier-2/W2b trigger fired by construction — six branches writing the same
  four files; tips pinned under `refs/fleet/run-3*`, corpus rescued to the evidence archive.
  (5) Cache-inflation caveat stands: identical plans shared warm prefixes, so these numbers
  are an upper bound relative to a fleet driving distinct plans.
- Spend is flat in N (76.8k–94.4k, mean 84.7k; total 508,371) — concurrency cost no extra
  tokens.

## Decision returned

**The one-run-at-a-time posture loses its evidentiary basis.** Through N=3, concurrency is
close to free: ~3× throughput per window, no per-drain degradation, no binder anywhere in the
stack, no visible window consumption. The RUNBOOK's "the window bounds width" line should be
rewritten to cite this measurement, and docket drains of independent plans (#454 comment,
scenario 1) can launch concurrently as standing practice. Where the actual ceiling is remains
unmeasured — it is above N=3, and finding it deliberately is cheap now that the launch recipe
and instrumentation exist.

**Instrument caveats, recorded:** the extra-usage credits counter reset at the Sep-1 00:00 UTC
month boundary mid-window (cross-midnight `/usage` spend deltas are invalid); and the flat 0.0
five-hour reading is now EXPLAINED, not mysterious — the operator rotates three subscriber
accounts, and the laptop Keychain token this measurement metered is a **different account**
from the orchestrator token the fleet spent on. Prediction 1 is therefore **unverified, not
confirmed**: nobody watched the spending account's window. The fix (per-account probes,
aggregated) is chartered as #513; the throughput and binder readings are unaffected.
Run-37's first spawn died on a cwd bug (multi-launch shape now recorded on #454); its
relaunch cost the N=2 arm a 17-second stagger.
