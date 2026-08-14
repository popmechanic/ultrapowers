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

## Attempt 3 (round-2 fixture) — gate BLOCKED, floors still short

Re-run at `e378c1a` (row `startedAt 2026-08-14T00:58:36Z`, CLI on the
replacement Max account): `wallClockSec 1301.2` (21.7 min), 88 343 output
tokens, arm identity PASS (`serialize: 6 write-after-write dag_edges`),
**gateVerdict BLOCKED**. Task 2 exhausted its fix loop — the reviewer blocked
twice, first on a real defect (`tabular.pad` validated `align` only after the
width short-circuit, so `to_markdown(..., align="center")` on no-padding-needed
fixtures silently passed), then on a test-contract miss (the "exact multi-line
string" markdown test derived its expected value from the same `tabular`
helpers the implementation calls — a tautology; the implementation itself was
correct). Tasks 3/4 were cascade-blocked behind the write-after-write chain and
never ran, so end-to-end is not a valid floor reading.

Per-implementer wall clocks (wf `wf_2cf3788b-be3`, first→last event
timestamp per agent):

| agent | wall clock |
|---|---|
| impl task 1 (validation+schema) | 2.9 min |
| impl task 2 (export+tabular) | 2.5 min |
| task 2 fix round | 1.8 min |
| impl tasks 3/4 | never ran (cascade-blocked) |
| reviews | 2.4–2.8 min each |

- Every implementer ≥ 5 min: **MISS** (max observed 2.9 min).
- Arm A end-to-end ≥ 30 min: **MISS** (21.7 min, and invalid anyway — BLOCKED
  with half the plan unexecuted).

Engine observations from the cell (not calibration findings): the fix-round
worktree was cut from the stale integration base `493705e` (implementer
detected it and `git reset --hard`ed to the task BASE — the stale-heads class
of #131), and the fix-round review packet recorded the range
`f45c990..df4fd31` (the 32-line fix commit only) instead of task-BASE→head,
omitting the whole implementation commit; the reviewer noticed and fell back
to reading the tree. The gate critic labeled the unmerged-but-reviewed task 2
branch "silently dropped", but the second review verdict was FIX_REQUIRED —
the engine correctly refused the merge; that critic wording is noise.

## Decision after attempt 3

Round-3 additive resize, two levers:

1. **Size.** Task 1 fattens hardest (a third module, `app/rules.py`
   rule-combinator layer, plus `merge_specs`/`describe_spec`/
   `spec_from_config`/`validate_collect` on schema and
   `validate_many`/`error_code`/`explain_config` on validation); task 2 gains
   `parse_csv` (a real state-machine parser), `to_html` + `escape_html`,
   `truncate`/`wrap`/`fit`/`render_row`, `EXTRA_FORMATS`/`render_any`,
   `summary_line`; task 3 gains `quota.snapshot`/`time_to_next_slot` and
   `ratelimit.retry_after`/`limit_headers`; task 4 gains
   `top_actors`/`merge_entries`/`to_csv_report`/`diff_summaries` and
   `audit.record_many`/`dropped`. All pure additions — no new registry
   wiring beyond config keys, seal `4d131df61152` untouched.
2. **Review-churn control.** Every "exact multi-line string" criterion now
   says explicitly: pin the expected value as a literal in the test; deriving
   it from the module's own helpers is a tautology and a review-blocking
   defect. This is what killed attempt 3's task 2 — the demand was implicit
   and the implementer satisfied its letter, not its point.

Sizing model: round-2 readings say implementer minutes scale roughly linearly
in prescribed modules+tests; targets are ~6 min (task 1) and ~5–5.5 min
(tasks 2–4), projecting ~38–42 min end-to-end.

## Attempt 4 (round-3 fixture, `fa693c4`) — E2E floor MET, implementer floor still short; seal defect found

Row `startedAt 2026-08-14T01:30:17Z`: `wallClockSec 2874.8` (**47.9 min ≥ 30
— the end-to-end floor clears for the first time**), 212 578 output tokens,
arm identity PASS (6 write-after-write edges). All four tasks implemented,
reviewed, and merged (two 1-iteration fix rounds, tasks 1 and 2); engine
`gateCheck` verdict **PASS** on every check.

Per-implementer wall clocks (wf `wf_4575c29d-b36`):

| agent | wall clock | floor |
|---|---|---|
| impl task 1 (validation+schema+rules) | 4.0 min | MISS |
| impl task 2 (export+tabular) | 5.9 min | **MET** |
| impl task 3 (quota+ratelimit) | 3.0 min | MISS |
| impl task 4 (audit+audit_query) | 3.5 min | MISS |
| reviews | 2.0–3.5 min | — |
| gate critic | 5.3 min | — |

**Why the row still says BLOCKED: the sealed acceptance failed 2/24** —
`test_ratelimit_dispatch_hook_ignores_reads` and `..._keys_on_actor` call
`dispatch_hook` with a minimal config `{"rate_limit_max_per_window": 1}`, and
the resize-round-1 windowed-hook contract ("reads its window from
`config["rate_limit_window_seconds"]`") makes a literal implementation
`KeyError` on it. **Resize round 1 was therefore NOT seal-preserving for this
one contract** — the defect stayed latent through attempts 1–3 because no
earlier post-resize run both merged task 3 and reached the acceptance stage.
Round-4 fix: the hook (and `limit_headers`/`retry_after`) must read window
and burst via `.get(...)` defaults (60 / 0), with an explicit minimal-config
test bullet; only `rate_limit_max_per_window` may be required. The
acceptance directory is untouched, as always — the plan text moves back to
the exam, never the reverse.

Genuine fixture-spec gaps the run's reviewers/critic surfaced, pinned as
round-4 contract bullets (they add work and remove ambiguity at once):
`quota.time_to_next_slot` crashed (`min()` on empty) at zero allowance — now
specified `float("inf")`; `parse_csv` dropped a single-column trailing empty
row — now pinned (`"a\n"` → `[{"a": ""}]`); `validate_collect` emitted a
duplicate message under combined `type:"str"`+`non_empty` rules — catalog
gains `"type_str"`, per-field checks get a fixed first-failure order (exam
untouched: `validate_fields`' name messages are unchanged); `to_tsv` header
sanitization made explicit; a `max` rule on a non-numeric value must raise
`"numeric"`, not silently pass.

Recurring engine observation (2nd occurrence, tasks 1 and 2 across attempts
3–4): the fix-round review packet records fix-commit-only ranges instead of
task-BASE→head. New this run: task 1's implementer reported a **fabricated
head sha tail** (`9fe754d4b0eba...` does not exist; the real commit is
`9fe754d21d8b...`) — the fix-round agent detected it via prefix resolution
and re-anchored; same class as the shadow-probe report.json sha-tail finding
(sha/ancestry checks are the authority, not reported strings).

## Decision after attempt 4

Round-4 resize: mandatory seal-compat fix (minimal-config hook) + fatten
task 3 hardest (`quota.usage`/`purge`, `ratelimit.status_line`/`check_many`),
task 4 next (`group_by`/`search`/`to_markdown_report`,
`audit.export_state`/`import_state`), task 1 lightly
(`diff_specs`, `describe_rules`), task 2 unchanged in size (5.9 met; only
the two ambiguity pins). Projected implementers ~5–6.5 min each,
E2E ~55 min.

## Attempt 5 (round-4 fixture, `e3f03e6`) — sealed exam GREEN, E2E floor MET, two implementers 12–36 s short

Note: an earlier attempt-5 launch was externally stopped seconds after
worktree prep (no cell, no row, nothing to supersede); this is the same
fixture relaunched on operator instruction.

Row `startedAt 2026-08-14T05:29:16Z`: `wallClockSec 3453.7` (**57.6 min ≥
30**), 253 603 output tokens, arm identity PASS (6 write-after-write edges),
**gateVerdict NEEDS_ACK** (the structural ceiling — every mechanical check
green), **sealed acceptance 24/24 PASSED** (`4d131df61152`, exit 0) — the
round-4 minimal-config fix held on first exercise.

Per-implementer wall clocks (wf `wf_a583dcf1-963`):

| agent | wall clock | floor |
|---|---|---|
| impl task 1 (validation+schema+rules) | 4.4 min | MISS (−36 s) |
| impl task 2 (export+tabular) | 7.4 min | MET |
| impl task 3 (quota+ratelimit) | 5.3 min | MET |
| impl task 4 (audit+audit_query) | 4.8 min | MISS (−12 s) |
| fix rounds (tasks 1, 4) | 1.3 / 1.6 min | — |
| reviews | 2.2–4.4 min | — |

Reviewer minors worth keeping: task-3 reviewer flagged two genuine
fixture-spec tensions — the prune-vs-reset boundary (a hit exactly at
`now - window` still counts while `time_to_next_slot` reads `0.0`) and
`X-RateLimit-Limit` ambiguity under burst (limit alone vs allowance) — both
now pinned as round-5 contract wording. Stale-worktree-base recurred on both
fix rounds (3rd run in a row; implementers self-recover via
`git reset --hard` to BASE).

## Decision after attempt 5

Round-5 micro-resize, tasks 1 and 4 only: task 1 gains
`schema.spec_to_config` (round-trip inverse) and `rules.parse_rules`
(field-mapped parser, composed end-to-end with `apply_rules`); task 4 gains
`audit_query.counts_matrix` (exact nested method→actor→count dict). Tasks 2
and 3 unchanged beyond the two reviewer-tension pins (boundary wording,
burst-header assertion). Projected: task 1 ~5.5 min, task 4 ~5.3 min, E2E
~60 min.
