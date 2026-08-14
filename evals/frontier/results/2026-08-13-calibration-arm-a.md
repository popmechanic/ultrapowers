# Calibration run — arm A (serialize) on contend-prod — 2026-08-13

**Status: floors MISSED — fixture resized before any counted cell. Not a counted cell** (plan Task 14 / spec §6 calibration).

## Reading

Run row (`evals/results/runs.jsonl`, `startedAt 2026-08-13T23:32:34Z`):

| field | value |
|---|---|
| engineRef | `3ac36ae` (main, post-#145) |
| armOverlap | `serialize` |
| identity | `serialize: 6 write-after-write dag_edges` — arm identity PASS |
| wallClockSec | **1237.2 (20.6 min)** |
| outputTokens | 84 342 |
| gateVerdict | PASS (0 redirect rounds, 0 false blocks) |

Per-implementer wall clocks, measured from the driven workflow's per-agent
transcripts (`wf_42c2043c-303`, first→last event timestamp per agent):

| agent | wall clock |
|---|---|
| impl task 1 (validation) | 1.3 min |
| impl task 2 (export) | 1.3 min |
| impl task 3 (ratelimit) | 2.6 min |
| impl task 4 (audit) | 1.3 min |
| reviews | 1.2–2.0 min each |
| integration | 3.0 min |

## Floors (spec §6, pre-registered)

- Every implementer ≥ 5 min: **MISS** (max observed 2.6 min).
- Arm A end-to-end ≥ 30 min: **MISS** (20.6 min).

The run is squarely in the protocol-fixed-cost regime the floors exist to
exclude: task work is ~25% of end-to-end wall clock.

## Decision

Per plan Task 14: resize `evals/fixtures/contend-prod/plan.md`'s task bodies
(~3–4× prescribed work per task — a second module per feature plus a
substantially deeper test contract) and re-run calibration before any counted
cell. The resize is **additive only**: every behavior the sealed acceptance
suite (`4d131df61152`) tests is preserved verbatim — new modules, new config
keys (the exam asserts specific keys/values, never key-set equality), no
behavior change on any exam-tested path — so the seal remains valid and the
acceptance directory is untouched.

The T14 row above stays in `runs.jsonl` as a calibration reading; it is not
an A/B interval and nothing supersedes it (`--rerun-of` is for invalid
counted cells, which this never was).

## Attempt 2 (post-resize) — infra-killed, floors still short

Re-run at `5405a1a` (row `startedAt 2026-08-14T00:04:20Z`): the driven
session lost Claude subscription access mid-run ("organization has disabled
Claude subscription access") during wave 4 — task 4's implementer died at
~1.2 min with two instant-death retries, no report, no gate verdict
(`gateVerdict: unknown`, RUN_LOCK left in the cell's throwaway repo). The
outage is the known OAuth/subscription flake class; the attempt is invalid
as a calibration end-to-end reading.

Outage diagnosis (post-hunt): the CLI authed as `marcus@vibes.diy`, whose
auto-created **personal** Max org (`0cc89f85-c644-4ff7-b4db-7d1c14aca05e`)
tripped a server-side "subscription access disabled" entitlement flag — no
admin UI exists for a personal org, so nothing operator-side could clear it
(cf. claude-code GitHub issues #63685/#82700). Resolution: CLI re-authed to
the operator's other personal Max account; same Max tier, so floor readings
remain comparable across the account switch (provenance note: attempts 1–2
ran under `marcus@vibes.diy`, later attempts under the replacement account).

The three implementers that completed are still a valid floor sample:
**1.9 min (validation) / 3.5 min (export) / 4.6 min (ratelimit)** — up from
1.3/1.3/2.6 pre-resize, still under the 5-min floor. Decision: second
additive resize round (schema gains a `compile_spec` declarative-validator
surface; export gains `to_tsv` + markdown alignment + `pad`/`sanitize_flat`;
quota gains `remaining`; audit_query gains `paginate` + `to_report`), same
seal-preserving discipline, then re-run calibration once subscription access
probes healthy.
