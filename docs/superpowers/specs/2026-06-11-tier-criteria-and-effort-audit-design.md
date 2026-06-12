# Judgment-Risk Tier Criteria + Run Effort Audit — Design

**Date:** 2026-06-11
**Issue:** #20 — tier assignment by estimated scope misranks judgment-heavy tasks;
no effort telemetry to calibrate against.
**Evidence:** run `wf_df7eefdb-7b1` (the 0.0.6 batch). The three heaviest
implementations by turn count were all `cheap`-tier (task 6: 82 turns, task 7: 72,
task 9: 70 — exactly the three that drew reviewer notes), while the most-specified
`standard` task (4) was the lightest in the run (27 turns). Scope-based ranking was
inverted on the extremes; the opus reviewers were the backstop that kept the run
10/10 clean.
**Outcome:** two independent deliverables — sharpened tier criteria (docs only) and
a deterministic post-run effort-audit script — closing #20, shipped as 0.0.8.

## Part 1 — Judgment-risk tier criteria (docs only)

The "Model tiers" table in `skills/ultrapowers/references/reviewer-prompts.md`
(confirmed OUTSIDE the BAKE blocks — no re-bake needed) is reworked around
judgment-likelihood:

- **cheap** narrows to *transcription-grade* tasks: the plan supplies complete code
  the author could verify by running it, confined to 1–2 files, AND the task
  touches none of the risk classes below.
- **Risk classes** (any one bumps to `standard` regardless of diff size):
  1. **Shell/git/environment semantics** — specs there are often subtly wrong
     (run evidence: task 7's six-line bash diff hid a spec bug the implementer had
     to diagnose).
  2. **Test-pinned docs or strings** — edits that must hunt and update pins across
     files (task 9).
  3. **Anticipated deviation** — steps that say "if X differs, do Y", or specs the
     plan author could not run to verify (task 6's required carve-out).
- **standard** keeps its multi-file/integration row and gains the risk classes.
- **most-capable** unchanged (reviews, architecture, ambiguity resolution,
  fix-round re-dispatches).
- The assignment sentence under the table changes from "based on estimated scope"
  to "by estimated scope **and judgment-likelihood** — realized difficulty tracks
  spec risk, not diff size (issue #20)".

Two pointer sites change the same phrase: `SKILL.md` Step 2 ("Assign a model tier
per task … by estimated scope") and any matching wording in
`dependency-analysis.md`. Doc-pinning tests that assert the old phrasing are
updated in the same commit.

## Part 2 — `scripts/audit_run.py` (effort telemetry)

A deterministic, read-only parser. Invocation:

```
python3 ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/audit_run.py <transcript-dir>
```

`<transcript-dir>` is the engine's per-run transcript directory (printed in the
Workflow launch result as "Transcript dir:"), containing `agent-*.jsonl` files.

**Behavior:**

- For each `agent-*.jsonl`: read line-delimited JSON (malformed lines skipped);
  classify the agent's role from the FIRST user message's text using the stable
  baked-prompt phrases — "You are an implementer subagent" plus the task body's
  `### Task <id>:` heading → `impl:<id>`; "You are an independent reviewer" plus
  the heading → `review:<id>`; "Merge in this order" → `merge`; reconcile prompt
  marker → `reconcile`; setup prompt marker → `setup`; completeness prompt marker
  → `integration`; anything else → `unknown` (counted, never fatal). These phrases
  come from the baked prompts and are already anti-drift-tested, so the classifier
  inherits their stability.
- Per agent, sum assistant-message count (turns) and `usage.output_tokens`; record
  the model string from the last assistant message.
- Output: a markdown effort table (role, model, turns, output tokens) sorted by
  turns descending, followed by a **tier-misrank candidates** section: implementer
  tasks whose turns exceed 1.5× the median turns of implementers running on the
  SAME resolved model string (the transcripts carry models, not tier names — and
  grouping by model stays correct under tierOverrides remapping). This is the
  pattern that exposed tasks 6/7/9. Median over <2 same-model tasks ⇒ no flagging
  for that model (avoid single-sample noise).
- **Advisory by contract:** missing directory, no `agent-*.jsonl` files, or a
  layout the parser does not recognize prints one clear diagnostic line and exits
  **0** — the script must never block the Step-5 gate. There are no write
  operations of any kind.

**Integration points (docs):**

- `SKILL.md` Step 5 gains an optional bullet after the checkout restore: run the
  audit script against the run's transcript dir and include its table when
  presenting the report — flagged misrank candidates feed the next plan's tier
  assignments.
- `references/report-format.md`'s presentation order gains an optional "Effort
  audit" section with the same advisory caveat.

**Testing:** `tests/test_audit_run.py` builds a synthetic fixture transcript dir in
`tmp_path` (small hand-written `agent-*.jsonl` files for an implementer, a
reviewer, a merge, and one malformed line) and asserts: role classification,
turn/token sums, misrank flagging on a constructed outlier, the no-flagging rule
under 2 same-tier samples, and the advisory exit-0 behavior on a missing/empty
dir. No engine dependency: if the real engine's transcript layout drifts, the
script degrades to its advisory diagnostic (and the fixture documents the layout
we parse).

## Out of scope

- Plan-level `**Tier:**`/`**Risk:**` markers (decided against — orchestrator docs
  only).
- Implementer schema/prompt changes, any `workflow.js` edit, any re-bake.
- Automatic tier escalation at dispatch time — assignment remains orchestrator
  judgment, now better instructed and better instrumented.

## Closeout

Issue #20 closes when the work merges; version bumps to **0.0.8** per the 0.0.x
release convention.
