# Cost-accounting method notes

## Method of record

`evals/scripts/extract_tokens.py` — parses the run session's Claude Code
transcripts directly: deduplicates streamed events by message id, adds
Task-subagent usage from `toolUseResult` records, includes workflow-engine
`agent-*.jsonl` sidecars and the second project directory created when a
session enters a worktree. Cache writes priced at 1.25x input, reads at 0.1x.

**Validation:** reproduces the Claude Code client's own session cost display
to the cent (mixed-A-1: $36.23 exactly, per-model token totals matching).

## Alternatives considered

kenn-io/agentsview v0.32.1 was evaluated as an alternative cost source on
2026-06-12 and rejected: it cannot see workflow-engine subagent transcripts
(undercounting B runs ~60%), does not roll subagent children into its
per-session number, and prices via LiteLLM's floating rate table. The tool
has been uninstalled; full evaluation details are in this file's git
history (commit 4d33b71).
