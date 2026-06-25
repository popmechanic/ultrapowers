# ultralearn — a feedback loop from in-practice use back into the plugin

**Status:** design (approved 2026-06-25)
**Topic:** programmatic analysis of Claude Code session transcripts to learn how
ultrapowers is actually used, and to feed that learning back into the plugin.

## Problem

The only way to learn from a real ultrapowers run today is for the operator to
copy-paste a transcript into a new session and narrate what happened. That does
not scale, and it loses the richest signal: the human↔agent dialogue around
planning, routing, and the pre-merge gate. We want a standing **sensor** that
reads runs across projects, distills what it finds into a durable ledger, and
drafts improvement proposals for human approval — a cybernetic loop whose action
step keeps a human governor, mirroring ultrapowers' own pre-merge gate.

## What we are learning (the lenses)

Five lenses, applied to every run:

1. **Friction & failure modes** — merge conflicts, blocked/cascade waves,
   fix-loop exhaustion, gate rejections, lost coordinates, operator
   interventions and re-runs.
2. **Routing & planning fit** — was ultrapowers the right call; did the routing
   recommendation match how the run actually went; were `Type`/`Depends-on`
   markers and wave shape good, or did poor marking cause serialization or
   conflicts.
3. **Operator experience** — the human's qualitative arc: confusion, surprise,
   trust/distrust, what they said at planning and at the gate, where they spent
   attention versus where the design wanted them to.
4. **Cost/effort economics** — tokens, turns, tier choices, parallelism payoff,
   wall-clock; the longitudinal trend `audit_run.py` cannot see run-to-run.
5. **Ambition frontier & emergent behaviors** *(open-ended)* — how large and
   complex the work got and still succeeded, and anything the design did not
   anticipate: self-limiting, self-correcting, or otherwise surprising agent
   behavior. Seed example: a planning agent that declined to author a full
   implementation plan in one pass, reasoning that test-driven development is
   impossible against files that do not yet exist. This lens is a free-text
   "what surprised you?" pass, not a fixed counter — it is the reason the sensor
   needs an LLM reader and not only deterministic metrics.

## Corpus

The inclusion **anchor is an actual Workflow execution**. A session counts when
it contains a real ultrapowers `Workflow` run; plan-only dead-ends are out of
scope. For each detected run we also pull in the **planning that produced the
executed plan**, which may live earlier in the same transcript *or* in a
different session entirely (you plan in one session, `/ultrapowers <plan-path>`
in another). The harvester therefore stitches by plan-path and repo, not by
assuming one session equals one story.

## Architecture (Approach A: skill-orchestrated hybrid)

```
①  HARVEST            ②  READ                ③  LEDGER            ④  DISTILL
   (Python, det.)        (subagent readers)     (Python merge)       (LLM, human-gated)
   scan all projects     per-run bundle →        abstracted          cluster ledger →
   detect real runs      findings by lens        findings appended    draft issues / spec
   slice + stitch        + open-ended            to committed         stubs → human approves
   plan↔execution        "what's novel?"         ledger; raw stays    before anything files
   → LOCAL cache         pass                    local + gitignored
```

Deterministic work is Python (testable, no LLM, no API key — honors the repo's
no-API-call rule). Qualitative reading is subagents dispatched **inside Claude
Code**, so all LLM work rides the user's subscription. Approach A evolves toward
a `waves`-style self-hosted workflow (Approach C) once the lenses stabilize;
that is explicitly deferred.

### Components & interfaces

**① Harvester** — `skills/ultralearn/scripts/harvest_runs.py`

- Input: the projects root (default `~/.claude/projects`, overridable) and a
  watermark in the local cache for incremental sweeps.
- **Detection (false-positive-safe).** A real run is identified by an actual
  `Workflow` **tool_use/tool_result**, not by string mentions — otherwise this
  very design session (which says `/ultrapowers` and `integrationBranch` dozens
  of times) would self-detect. The robust signal is a `Workflow` tool_result
  carrying a resolvable `Transcript dir:` path to a per-run `agent-*.jsonl`
  directory, corroborated by a gate report (`integrationBranch`) and waves meta.
  When the agent dir exists on disk, the run is certain.
- Per run, writes a **run bundle** to the local cache
  `.claude/ultralearn/runs/<run-id>/`:
  - `bundle.json` — identity (session uuid, project slug, timestamp, the
    `/ultrapowers <plan-path>` arg), the parsed gate report (layer 3), audit
    metrics (layer 2), origin classification (`home`/`foreign`), and pointers.
  - `slice.md` — the relevant transcript turns only: the invocation, the routing
    analysis line, the rendered wave plan, the gate exchange, plus the stitched
    planning turns. Never a full dump of an unrelated project.
- `run-id`: stable hash so re-running is idempotent.
- **Read-only and advisory by contract.** A missing dir, drifted schema, or
  unparseable transcript prints one diagnostic and skips that item; the sweep
  never crashes. (Same discipline as `audit_run.py`.)

**Planning stitcher** (within harvest) — given a run's plan-path, finds the
planning turns: first earlier in the same transcript (brainstorming /
writing-plans / ultraplan invocations and the plan authoring), else by searching
other transcripts for `Write`/`Edit` tool_uses targeting that plan-path. Records
`planningFound` and attaches the planning slice when located. Best-effort.

**Audit-metric reuse** — extract the core of `audit_run.py` into a reusable
`audit(transcript_dir) -> dict` function; both the existing CLI and the
harvester call it, keeping one source of truth for effort metrics.

**② Reader rubric** — `skills/ultralearn/references/reading-lenses.md`

The reader prompt source. Defines the five lenses and the per-finding output
schema:

```json
{ "runId": "string", "lens": "friction|routing|operator|cost|frontier",
  "title": "string", "novelty": 0, "severity": 0,
  "evidence": "string", "evidenceAbstracted": false,
  "implication": "string", "surface": "string" }
```

`surface` names the repo area a fix would touch (`references/*.md`, the routing
hook, `ultraplan`, `report-format.md`/`SKILL.md`, `README`). For **foreign**
runs the reader MUST set `evidenceAbstracted: true` and describe the *shape* of
the behavior with identifiers and domain specifics stripped. The skill points
readers at this file directly (no baked copy), so there is no prompt-drift pin
to maintain.

**Reader dispatch** — `SKILL.md` orchestrates: run harvest, then dispatch one
subagent per new bundle with the rubric + the bundle's `slice.md` + `bundle.json`,
schema-constrained, parallel where possible. Collect findings.

**③ Ledger merge** — `skills/ultralearn/scripts/merge_ledger.py`

- Input: reader findings.
- **Redaction guard (fails closed).** If a finding's run is `foreign` and
  `evidenceAbstracted` is not true, the merge strips/rejects it — verbatim
  foreign text never enters the committed ledger. If origin cannot be
  classified, treat as foreign.
- Content-hash id per finding for idempotent dedup.
- Appends to `docs/superpowers/observations/ledger.jsonl` (source of truth) and
  regenerates `docs/superpowers/observations/ledger.md` (human digest grouped by
  lens, ranked by severity × novelty, with run counts).
- pytest-covered.

**Two-tier privacy** (mandatory — `popmechanic/ultrapowers` is a **public**
repo):

| Tier | Location | Content | Committed? |
|---|---|---|---|
| Local | `.claude/ultralearn/` (gitignored) | raw bundles, full slices, verbatim evidence, run↔finding index, watermark | no |
| Committed | `docs/superpowers/observations/ledger.jsonl` + `.md` | abstracted findings, metrics, local pointers | yes |

Origin classification: a run is **home** if its project slug is the ultrapowers
repo (including `…--claude-worktrees-*` variants) — verbatim quotes allowed; any
other project is **foreign** — evidence abstracted. The TDD-decline, from "a
different project," lands as the behavior alone, leaking nothing about that
project.

**④ Distiller** — the `ultralearn distill` verb

Reads the accumulated ledger, clusters recurring/co-occurring findings across
runs, ranks by frequency × severity × novelty, and drafts proposals each mapped
to a real improvement surface. Output: draft GitHub issues and/or spec stubs in
`docs/superpowers/specs/`. **Nothing files or commits without operator
approval** — the distiller presents drafts; the human chooses which become
issues/specs. This is the loop's governor.

## Data flow

```
~/.claude/projects/*.jsonl
  → harvest (detect, slice, stitch, classify, audit)   [Python, local cache]
  → readers (five lenses + open-ended)                 [subagents, in-session]
  → merge (redaction guard, dedup)                     [Python, committed ledger]
  → distill (cluster, rank, draft)                     [LLM, in-session]
  → proposals → human gate → issues / spec stubs
```

## Cadence

On-demand, two verbs:

- **`ultralearn`** — harvest → read → ledger. The sensor; cheap, incremental
  (watermark), run often.
- **`ultralearn distill`** — ledger → proposals. Run when you want to act.

Kept separate so reading accumulates cheaply and distillation happens
deliberately.

## Error handling

- Harvest is read-only and advisory: skip-with-diagnostic on any malformed or
  missing input; never crash a sweep.
- Detection requires a real `Workflow` tool_result (with a resolvable agent
  dir), not string mentions, to exclude dev/discussion sessions.
- Idempotency via content-hash ids and the watermark; re-runs never duplicate.
- Redaction guard fails closed (unclassifiable origin → foreign → abstracted).

## Testing

`tests/` (pytest, in CI) with small **synthetic** fixture transcripts under
`tests/fixtures/` (mirrors `evals/fixtures/`; never real personal transcripts):

- detection: a real run is found; a dev session that only *discusses*
  ultrapowers is NOT; a foreign run is classified foreign.
- slicing and plan-path stitching (same-session and cross-session).
- redaction guard: a foreign verbatim finding is rejected/stripped.
- ledger dedup/idempotency and digest generation.

`validate_skill.py` must pass on `skills/ultralearn`.

## Conventions & fit

- New skill dir `skills/ultralearn/` (working name — rename freely): `SKILL.md`,
  `scripts/`, `references/reading-lenses.md`.
- Deterministic scripts in `scripts/`, pytest in `tests/` (CI runs both).
- Reader rubric referenced directly (no baked copy → no drift pin).
- Extend `.gitignore` with `.claude/ultralearn/`.
- Versioning stays `0.0.x`; release bumps both `plugin.json` and
  `marketplace.json`.

## Out of scope / deferred (YAGNI)

- Post-run auto-harvest hook (SubagentStop/Stop) — defer until the on-demand
  flow earns it.
- Approach C (self-hosted `waves` workflow as the reader) — defer until lenses
  stabilize.
- Cross-machine or shared community ledger.
