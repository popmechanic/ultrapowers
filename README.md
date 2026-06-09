# ultrapowers

**A parallel execution engine for approved [Superpowers](https://github.com/obra/superpowers) plans.**

## The bottleneck

Superpowers gives Claude Code a disciplined path from idea to merged code: brainstorm the design,
write a structured implementation plan, then execute that plan task-by-task with independent
review. The execution step, however, is serial by design. Superpowers' executors
(`subagent-driven-development`, `executing-plans`) run one task at a time, because their subagents
share a single working tree — parallel tasks would trample each other's files.

Most plans don't need that caution everywhere. A six-task plan often has four tasks that touch
disjoint files, and with a sequential executor you wait for them in single file anyway.

ultrapowers is an alternative execution engine for exactly that step. It reads the same approved
plan, works out which tasks can safely run at the same time, and runs them in parallel **waves** —
each task in its own git worktree, each result independently reviewed, everything merged onto one
integration branch for your approval. Same plan, same discipline, same human gates; parallel
throughput on the parts of the plan that allow it.

*New to Superpowers? It's a plugin that teaches Claude Code a rigorous build workflow
(brainstorm → plan → execute → review). Install it first — ultrapowers plugs into that workflow at
the "execute the plan" step and reuses its skills rather than duplicating them.*

## Why you might want it

- **Throughput where the plan allows it.** Independent tasks run concurrently (up to 16 agents);
  dependent tasks wait exactly as long as they must. Plans too small or too entangled to benefit
  are detected up front and run sequentially — you don't pay parallelism overhead for nothing.
- **Deterministic orchestration.** The engine is a frozen, version-controlled script
  (`skills/ultrapowers/workflow.js`) with the review discipline baked in at build time and
  drift-tested against its reference sources. A run never improvises its own orchestration and
  never depends on live superpowers skill resolution.
- **Review that understands parallelism.** Each task is verified by an independent reviewer that
  diffs the work against the exact integration SHA the task built on (`BASE...HEAD`) — not against
  `main`. Without that anchor, a reviewer in wave 3 would see waves 1–2's merged work in the diff
  and flag it as scope creep. Review depth is set per task: routine tasks get one pass, high-stakes
  tasks two independent passes.
- **Nothing fails silently.** The test suite runs once before the first task, so pre-existing
  failures aren't pinned on the wrong agent. Blocked tasks, merge conflicts, deferred work,
  reviewer disagreements, and autonomous judgment calls all surface in a structured end-of-run
  report — with per-task cost signals (model tier, review depth, fix rounds) so you can see whether
  the parallelism paid off.

## How a run works

You invoke **`/ultrapowers <plan-path>`** from inside the target repo. The skill then:

1. **Preflights and validates** — confirms the Workflow tool exists on this surface (falling back
   to sequential execution immediately if not) and that the plan has numbered tasks with explicit
   file lists.
2. **Computes waves** — builds a dependency graph from each task's file writes and explicit
   "depends on" text, layers it into waves of safely-concurrent tasks, detects cycles, and degrades
   small or fully-overlapping plans to a single sequential wave.
3. **Shows you the wave plan** — dependency edges, wave ordering, derived knobs (test command,
   per-task review depth). You approve or revise before any tokens are spent on implementation.
4. **Launches the committed workflow** — a setup agent creates the integration branch and runs the
   test baseline; then per wave: implementer agents work in isolated worktrees, reviewers verify
   each result against its `BASE` SHA with a bounded fix loop, and a merge agent integrates the
   wave's branches in deterministic order (with capped reconciliation on conflict, and cascade
   blocking — never silent dropping — when a wave can't be integrated).
5. **Reports for the pre-merge gate** — a completeness critic re-reads the original plan and the
   integrated result, and you get the full report: per-task status, wave merges, test results,
   judgment calls, anything unfinished. You approve the integration branch or **redirect** —
   corrective re-runs go through the same engine (`resume` mode on the same branch), never an
   improvised one-off.

Three human gates, total: plan approval (before ultrapowers is involved), wave-plan approval, and
pre-merge review. Everything in between runs autonomously and headless.

Deep dive: [`skills/ultrapowers/SKILL.md`](skills/ultrapowers/SKILL.md) is the front door;
[`skills/ultrapowers/references/`](skills/ultrapowers/references/) covers dependency analysis,
the reviewer prompts and schemas, wave-merge mechanics, the report format, and the maintainer
guide for `workflow.js`.

## Install

```
/plugin marketplace add popmechanic/ultrapowers
/plugin install ultrapowers@ultrapowers
```

Superpowers must be installed alongside it — ultrapowers reuses its brainstorming, planning,
review, and branch-finishing skills.

## Environment support

`/ultrapowers` needs a surface that exposes the **Workflow** tool: the local **CLI**, **Desktop
app**, **IDE extensions**, or **`claude -p`** / the **Agent SDK** (Claude Code v2.1.154+, paid
plan). **Claude Code on the web** does not expose it (verified live), so the skill detects that at
Step 1 and falls back to `superpowers:subagent-driven-development` — sequential, but the same plan
executes either way.

## Cost honesty

Parallel waves, per-task worktrees, and independent review are token-heavy relative to a
sequential run. The payoff is wall-clock time on plans with real parallel structure. For one- or
two-task plans the engine degrades to sequential execution automatically; if your plans are
usually small or tightly coupled, superpowers' own executors are the better default and this
plugin adds little.
