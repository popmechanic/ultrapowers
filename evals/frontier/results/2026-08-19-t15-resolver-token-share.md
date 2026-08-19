# T15 resolver token share — a measurement-before-build reading (spec §1a)

**Status: partial measurement.** The literal source this task names —
per-dispatch resolver transcripts under the T15 fold-arm's own run
directory (`run-20260814-055932/frontier/wave-1/agent-*.jsonl`) — is not
present on this machine. §"What's missing, and why" below documents the
search. What follows is the best reading obtainable from data that *is*
still on disk (`evals/results/runs.jsonl`, `evals/results/diffs/`, the
still-frozen `contend-prod` fixture, and `evals/frontier/results/2026-08-14-t15-ab.md`
itself), with every number traced to its source and every estimate labeled
as such. The E2″ conclusion this doc exists to support (last section) does
not depend on the missing per-dispatch breakdown — it follows from data
that is present.

## What's missing, and why

The plan's Step 1 names `run-20260814-055932` as the cell run dir and says
transcripts live under its `frontier/wave-1/`. Tracing how that cell was
produced (`evals/ab_runner.py::_read_run_receipt`, line 233):
`Path(workdir) / ".claude/ultrapowers" / "run-*"` — where `workdir` is the
**A/B runner's own throwaway checkout**, created under `tempfile.mkdtemp`
(`evals/ab_runner.py` line ~426, `shutil.copytree(plan["projectDir"], run_repo)`).
`evals/results/runs.jsonl`'s arm-B row for this exact pair (`engineRef
da8ebee`, `outputTokens: 231245`, `startedAt: 2026-08-14T12:59:07Z` — the
same UTC instant as `run-20260814-055932` in Pacific) records that
`workdir` as `/var/folders/6v/75bd2ncn5gl9w8v30nq1jtjr0000gn/T/ab-run-contend-prod-B-km75czov/repo`.
That path, and its `.claude/ultrapowers/run-20260814-055932/` run dir with
it, no longer exists — checked directly (`ls`), via `mdfind` (Spotlight),
and via `tmutil listbackups` (no Time Machine access on this machine). It
is a macOS per-boot temp directory with no retention guarantee; nothing in
`ab_runner.py` copies the run dir anywhere durable before or after a cell
finishes. The `2026-08-14-t15-ab.md` doc's claim that transcripts were
"preserved in the cell... for later operator audit" describes an intent
that the runner's actual temp-dir lifecycle does not deliver — worth fixing
in `ab_runner.py` (out of scope for this doc) so the next A/B pair's
resolver transcripts survive.

One more inaccuracy while here: the plan's Step 1 says
`evals/results/2026-08-13-frontier-cell.json` "carries `outputTokens` per
arm (arm B 231,245)" alongside `runs.jsonl`. It does not — that JSON is a
**different, earlier** cell (`fixture: "contend"`, not `"contend-prod"`;
`engineRef: aaa97b9`, not `da8ebee`; 2 resolver dispatches, not 5) and
contains no `outputTokens` field at all (`grep -o '"outputTokens":[0-9]*'`
on the file returns nothing). Only `runs.jsonl` carries the number.

## What is grounded, and its source

| Quantity | Value | Source |
|---|---|---|
| Arm A (serialize) output tokens, `engineRef da8ebee` | 208,068 | `evals/results/runs.jsonl`, row `startedAt: 2026-08-14T12:12:26Z` |
| Arm B (fold) output tokens, same `engineRef` | 231,245 | `evals/results/runs.jsonl`, row `startedAt: 2026-08-14T12:59:07Z` |
| Delta (B − A) | 23,177 tokens | arithmetic |
| Delta as share of arm B total | 23,177 / 231,245 = **10.0%** | arithmetic |
| Resolver dispatch count | 5 | `2026-08-14-t15-ab.md` "Resolver grading" section |
| `app/registry.py` base size | 147 lines / 5,416 chars | `wc -l -c` on the frozen `evals/fixtures/contend-prod/project/app/registry.py` (still present, unchanged since `486f02a`) |
| `app/registry.py` final size | 169 lines (147 + 22) | `evals/results/diffs/contend-prod-B.diff`, hunks `@@ -46,6 +46,16` (+10) and `@@ -145,3 +155,15` (+12) — this diff file was committed 17 minutes after the T15 result (`5dd6d88`, same session), i.e. it is this pair's actual arm-B `registry.py` diff, not a stale one |
| Contending task-body sizes (Tasks 1–4 of `contend-prod/plan.md`) | 18,418 / 11,320 / 14,456 / 11,836 chars | measured directly off the still-frozen `evals/fixtures/contend-prod/plan.md` (`### Task N` to the next `---`) |
| Sum of all four task bodies | **56,030 chars** (≈ 55KB) | arithmetic |

The 10.0% figure is **not** the literal "sum of `message.usage.output_tokens`
over `type=="assistant"` records in the 5 resolver transcripts" the plan's
Step 2 asks for — that requires the missing transcripts. It is the total
extra output-token cost of the fold arm over an identical-`engineRef`
serialize arm on the same fixture, which per `2026-08-14-t15-ab.md`'s own
E2′ line is attributed to "resolver dispatches + re-narrations" — i.e. it
is an **upper bound** on the resolver's own share (it also includes
whatever extra dispatch/narration bookkeeping the fold path does that
serialize doesn't). Treat 10.0% as a ceiling, not a point estimate.

A rough sanity check on that ceiling: 5 resolver replies, each a
JSON-escaped whole-file resolution of a ~150–170 line file, cost on the
order of a few hundred output tokens apiece (the reply *content* is short —
it's mostly the model choosing where to place already-decided lines) — call
it roughly 1,500–2,500 tokens total for the five reply payloads alone, well
under the 23,177-token ceiling. The gap is consistent with the ceiling
including other fold-path-only costs (narration generation, re-narration
turns, extra tool-call bookkeeping) beyond the reply payloads themselves —
another reason 10.0% should be read as "resolver-and-friends," not
"resolver alone."

## Per-dispatch input size: narration (whole file) vs task bodies

Per Step 2's second instruction, holding narration and task-body inputs
side by side (not tokens — the transcripts that would give per-dispatch
*tokens* are the missing artifact; these are the two components of a
resolver dispatch's *brief*, sized directly off files still on disk):

- **Narration term (whole file, current/pre-hunk protocol):** the resolver
  is shown the entire annotated `app/registry.py` at each dispatch. That
  file grows from 147 lines at the first conflict to 169 lines at the last
  (the two edit sites — the `DEFAULT_CONFIG` block and the wiring section —
  are the only lines that change; everything else in the file is unmarked
  context the resolver reads regardless). In characters, that's roughly
  5,400–6,200 across the five dispatches.
- **Task-bodies term (unchanged by hunk scoping):** per the plan's own Step
  2 wording ("the appended contending-tasks block size (**all four task
  bodies**)"), every dispatch appends the full text of all four contending
  tasks' plan sections regardless of how many have actually landed by that
  epoch — a constant **56,030 chars (≈55KB)** per dispatch.

So on `contend-prod`, the task-bodies term already outweighs the
whole-file-narration term by roughly **9–10×** (56,030 vs ~5,400–6,200
chars) — the file is small enough that even the *current*, unscoped
protocol's dominant brief-size cost is the appended task text, not the
file.

## Projected hunk-scoped brief size (Σ blocks + 2×40 context lines)

`contend-prod`'s final `registry.py` diff (`evals/results/diffs/contend-prod-B.diff`)
resolves to exactly two edit sites, matching the plan's own description
("a config block... and a registration line... at the bottom"):

- **Hunk A — config block**, base lines ≈46–52 (a 7-line span becoming 17
  after the four features' +10 lines land). `CONTEXT_LINES = 40` (Task 2's
  produced constant) before and after: lines ≈6–45 before (40 lines) and
  ≈53–92 after (40 lines, no overlap with hunk B). Brief ≈ 80 context + ~15
  body ≈ **95 lines**.
- **Hunk B — wiring section**, base lines ≈145–147, at EOF (a 3-line span
  becoming 15). Context before: ≈105–144 (40 lines, no overlap with hunk
  A's). Context after: **0** — the block ends at end-of-file, so there is
  no trailing context to carry (the same EOF case Task 2's `derive` handles
  by moving any trailing `added both` segment out of the block). Brief ≈ 40
  context + ~15 body ≈ **55 lines**.

**Projected hunk-scoped total ≈ 150 lines**, against a **169-line**
whole-file narration at the same (final, most-loaded) dispatch — roughly an
**11% reduction** on this fixture. That's a small win because
`CONTEXT_LINES = 40` applied twice per hunk (80 lines) is already most of a
150–170-line file: the two hunks' context windows nearly tile the whole
file. This is exactly why Task 6 exists — `contend-big` inflates
`registry.py` to ≈6,000 lines while leaving the same two edit sites in the
same relative positions, so the same two-hunk brief stays pinned at ≈150
lines while the whole-file narration it replaces grows to ≈6,000 lines: a
≈40× reduction instead of `contend-prod`'s ≈1.1×. The task-bodies term
(56,030 chars, unaffected by hunk scoping) is untouched by any of this —
Phase 1 removes the whole-file term, not the task-body term.

## E2″ expectation for `contend-big`

Hunk briefs remove the whole-file term; the task-body term is unchanged in
Phase 1. On `contend-prod` the whole-file term was already the smaller of
the two inputs (≈6KB vs ≈55KB of task bodies), so E2″'s savings will show
up almost entirely on `contend-big`, where the same 2-hunk/~150-line brief
replaces a ≈6,000-line narration the current protocol would otherwise send
at every one of the run's resolver dispatches.

## Appendix: the reproducible read (not runnable now — input absent)

Written to `audit_run.collect`'s exact read pattern
(`skills/ultrapowers/scripts/audit_run.py` lines 82–95: `type=="assistant"`
records only, `message.usage.output_tokens`, `0` when absent) so that if
`run-20260814-055932`'s `frontier/wave-1/agent-*.jsonl` files ever surface
(a backup, a re-run under a fixed `ab_runner.py` that preserves the cell),
the real number drops straight in:

```python
import json, glob

resolver_files = []
for path in glob.glob("<cell-transcript-dir>/agent-*.jsonl"):
    if any('"merge-conflict resolver"' in ln or "merge-conflict resolver" in ln
           for ln in open(path)):
        resolver_files.append(path)

resolver_tokens = 0
for path in resolver_files:
    for line in open(path):
        try:
            d = json.loads(line)
        except json.JSONDecodeError:
            continue
        if d.get("type") != "assistant":
            continue
        usage = (d.get("message") or {}).get("usage") or {}
        resolver_tokens += usage.get("output_tokens", 0) or 0

print(resolver_tokens, "/", 231245, "=", resolver_tokens / 231245)
```
