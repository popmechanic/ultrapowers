# Cost-accounting method notes

## Method of record

`evals/scripts/extract_tokens.py` — parses the run session's Claude Code
transcripts directly: deduplicates streamed events by message id, adds
Task-subagent usage from `toolUseResult` records, includes workflow-engine
`agent-*.jsonl` sidecars and the second project directory created when a
session enters a worktree. Cache writes priced at 1.25x input, reads at 0.1x.

**Validation:** reproduces the Claude Code client's own session cost display
to the cent (mixed-A-1: $36.23 exactly, per-model token totals matching).

## agentsview evaluated and rejected for scoring (2026-06-12)

[kenn-io/agentsview](https://github.com/kenn-io/agentsview) v0.32.1 was
evaluated as an alternative token/cost source against the three validated
sessions:

| Run | Ground truth | `session usage` (parent) | parent + children rollup |
|-----|-------------:|-------------------------:|--------------------------:|
| mixed-A-1 | $36.23 | $11.29 | $32.63 (20 sessions) |
| degrade-B-1 | $4.59 | $2.65 | $2.65 (no children indexed) |
| wide-B-1 | $6.45 | $2.63 | $2.63 (no children indexed) |

Three disqualifying findings:

1. **Workflow-engine subagents are invisible to it.** It indexes Task-tool
   child sessions (`subagents/agent-*.jsonl`) but not the workflow engine's
   nested `subagents/workflows/wf_*/agent-*.jsonl` files — which hold the
   tiered worker spend that conditions B and C exist to measure. B-run costs
   come back ~60% short.
2. **Per-session usage does not roll up children.** The headline
   `session usage` number is main-loop-only (mixed-A: $11.29 of $36.23).
3. **Pricing floats.** Rates come from LiteLLM's live table with offline
   fallback; a mid-matrix rate update would silently break cross-week
   comparability. The harness needs frozen prices.

Even the best-case manual rollup (mixed-A, all 20 children indexed and
summed) lands 10% under ground truth from pricing/accounting differences.

agentsview remains a fine local dashboard for *browsing* sessions
(`agentsview serve`); it is not used for any scored number.
