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

## Results

*(appended after the arms ran — see below)*
