---
name: ultralearn
description: Use when the operator wants to learn from real ultrapowers runs — harvest runs across projects, read them through five lenses, accumulate a redaction-guarded observation ledger, and distill human-gated improvement proposals. Two verbs - "ultralearn" (sense) and "ultralearn distill" (propose).
---

# ultralearn — feedback loop from in-practice use

A developer tool that closes the loop from real ultrapowers runs back into the
plugin. Deterministic Python harvests and merges; subagents read. All LLM work
runs inside Claude Code — no API key, no external calls.

## Verb 1 — `ultralearn` (sense)

1. **Harvest.** Run the harvester to detect real runs and build local bundles:
   `python3 skills/ultralearn/scripts/harvest_runs.py`
   It scans `~/.claude/projects`, detects runs by an actual `Workflow`
   tool_result (not string mentions), and writes bundles to the gitignored
   cache `~/.claude/ultralearn/runs/<runId>/` (`bundle.json` + `slice.md`).
   Incremental: a watermark means re-runs only process new sessions.
2. **Read.** For each new bundle, dispatch a subagent with
   `references/reading-lenses.md` as its instructions plus the bundle's
   `bundle.json` and `slice.md`. The agent returns a JSON array of findings.
   Dispatch readers in parallel. Every reader applies all five lenses,
   including the open-ended `frontier` pass that catches emergent behavior.
3. **Merge.** Collect the findings and merge them behind the redaction guard.
   Build both bundle lookups once and pass them to `merge_findings`:
   `origin_lookup, engine_lookup = bundle_lookups("~/.claude/ultralearn")`, then
   `merge_findings(findings, "docs/superpowers/observations/ledger.jsonl", origin_lookup, engine_lookup)`.
   `origin_lookup(runId)` reads `origin` from the cached `bundle.json` (fail
   closed to `foreign`); `engine_lookup(runId)` reads `engineVersion.epoch`, so
   each ledger entry records the ultrapowers version the finding was observed
   under — letting `distill` weigh whether a finding predates a fix. Then
   `regenerate_digest(...)` rewrites `docs/superpowers/observations/ledger.md`
   (the version shows as `_(vX.Y.Z)_`). **Foreign verbatim evidence never
   lands** — the guard drops it.
   Script: `python3 skills/ultralearn/scripts/merge_ledger.py`

## Verb 2 — `ultralearn distill` (propose)

Read the accumulated `ledger.jsonl`, cluster recurring/co-occurring findings
across runs, rank by frequency × severity × novelty, and draft improvement
proposals — each mapped to a real surface (`references/*.md`, the routing hook,
ultraplan, `report-format.md`/`SKILL.md`, `README`). Weigh each finding's
`engineVersion`: a cluster seen only under versions older than the current
release may already be addressed — flag it as possibly-stale and confirm against
the current engine before proposing a fix, rather than re-solving a closed
problem. Output draft GitHub issues and/or spec stubs under
`docs/superpowers/specs/`. **Nothing is filed or committed without operator
approval** — present the drafts and let the operator choose. This human gate is
the loop's governor, mirroring the pre-merge gate.

## Privacy (two tiers — the repo is public)

- Local, gitignored (`~/.claude/ultralearn/`): raw bundles, full slices,
  verbatim evidence, watermark.
- Committed (`docs/superpowers/observations/`): abstracted findings, metrics,
  local pointers only. Runs are classified `home` (this repo — verbatim OK) or
  `foreign` (any other project — evidence must be abstracted).
