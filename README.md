# ultrapowers

**A parallel execution engine for approved [Superpowers](https://github.com/obra/superpowers) plans.**

## The bottleneck

Superpowers gives Claude Code a disciplined path from idea to merged code: brainstorm the design,
write a structured implementation plan, then execute that plan task-by-task with independent
review. The execution step, however, is serial by design. Superpowers' executors
(`subagent-driven-development`, `executing-plans`) run one task at a time, because execution
shares a single working tree — parallel tasks would trample each other's files.

Most plans don't need that caution everywhere. A six-task plan often has four tasks that touch
disjoint files, and with a sequential executor you wait for them in single file anyway.

ultrapowers is an alternative execution engine for exactly that step, built on
[**Dynamic Workflows**](https://code.claude.com/docs/en/workflows) — the orchestration engine
Anthropic recently shipped in Claude Code (research preview; you may know it as the `ultracode`
keyword), which lets one script coordinate up to 16 parallel subagents while keeping intermediate
results out of the main context window. ultrapowers reads the same approved plan, works out which
tasks can safely run at the same time, and hands the Workflow runtime a committed orchestration
script that runs them in parallel **waves** — each task in its own git worktree, each result
independently reviewed, everything merged onto one integration branch for your approval. Same
plan, same discipline, same human gates; parallel throughput on the parts of the plan that allow
it. And if you've been curious what `ultracode` can actually do, an approved plan is about the
most structured test drive it gets.

*New to Superpowers? It's a plugin that teaches Claude Code a rigorous build workflow
(brainstorm → plan → execute → review). Install it first — ultrapowers plugs into that workflow at
the "execute the plan" step: brainstorming, planning, and branch-finishing hand off to superpowers skills at runtime, while the execution-time review discipline is baked in from superpowers sources at build time (drift-tested, manually re-baked).*

## Why you might want it

- **Throughput where the plan allows it.** Independent tasks run concurrently (up to 16 agents);
  dependent tasks wait only for the prior wave to land. Plans too small or too entangled to benefit
  are detected up front and run sequentially through the same machinery (see Cost honesty below).
- **Deterministic orchestration — and deterministic compilation.** The engine is a frozen,
  version-controlled Dynamic Workflow script (`skills/ultrapowers/workflow.js`) with the review
  discipline baked in at build time and drift-tested against its reference sources. A run never
  improvises its own orchestration and never depends on live superpowers skill resolution. And for
  marked plans (see ultraplan below), the wave computation itself is no longer model judgment: an
  executable compiler (`skills/ultrapowers/scripts/compile_plan.py`) parses the plan — fence-aware —
  into waves, dispositions, and dependency edges, reserving judgment for heuristic classifications
  it explicitly flags.
- **Built for drift.** ultrapowers depends on two substrates it doesn't control: superpowers'
  plan conventions and the experimental Workflow engine. Both are tripwired. Compat tests
  (`tests/test_superpowers_compat.py`) read the *installed* superpowers plugin and fail loudly if
  the contract ultrapowers parses changes (validated against 5.1.0, attested in the skill); a
  zero-agent probe workflow launches before every real run, so engine drift becomes a clean
  sequential fallback instead of a mid-run crash.
- **Review that understands parallelism.** Each task is verified by an independent reviewer that
  diffs the work against the exact integration SHA the task built on (`BASE...HEAD`) — not against
  `main`. Without that anchor, a reviewer in wave 3 would see waves 1–2's merged work in the diff
  and flag it as scope creep. Review depth is set per task: routine tasks get one pass, high-stakes
  tasks two independent passes.
- **Nothing fails silently — and one failure costs one task.** The test suite runs once before the
  first task, so pre-existing failures aren't pinned on the wrong agent. A crashed agent call
  degrades to a single failed task instead of killing the run; a failed task blocks its declared
  dependents rather than letting them build on work that never landed; blocked tasks, merge
  conflicts, deferred work, reviewer disagreements, and autonomous judgment calls all surface in a
  structured end-of-run report — with per-task cost signals (model tier, review depth, fix rounds)
  so you can see whether the parallelism paid off.

## How a run works

You invoke **`/ultrapowers <plan-path>`** from inside the target repo. The skill then:

1. **Preflights and validates** — confirms the Workflow tool exists on this surface (falling back
   to sequential execution immediately if not), notes the installed superpowers version against the
   attested one, and checks the plan has numbered tasks with explicit file lists.
2. **Compiles waves** — marked plans go through the executable compiler (`compile_plan.py`):
   classification (`implementation`/`gate`/`release`/`manual`), dependency edges from markers and
   file overlaps, Kahn-layered waves, cycle detection, and the small-plan sequential degrade.
   Unmarked plans get the same analysis by heuristic, with every reinterpretation flagged. Gates
   compile into run configuration; release and manual tasks are deferred to a post-merge runbook —
   a headless run never pushes, deploys, or waits on a human.
3. **Shows you the wave plan** — dependency edges, wave ordering, dispositions (what was excluded
   and why), derived knobs (test command, per-task review depth). Rendered for transparency, not
   approval: choosing ultrapowers at the plan handoff (or invoking `/ultrapowers`) already
   authorized the run, so execution begins immediately.
4. **Launches the committed workflow** — after a zero-agent probe confirms the engine still behaves
   as expected, a setup agent creates the integration branch and runs the test baseline; then per
   wave: implementer agents work in isolated worktrees (anchored to the exact integration SHA they
   build on), reviewers verify each result against that `BASE` with a bounded fix loop, and a merge
   agent integrates the wave's branches in deterministic order (with capped reconciliation on
   conflict, and cascade blocking — never silent dropping — when a wave or a dependency can't be
   integrated). A crashed agent costs its task, not the run.
5. **Reports for the pre-merge gate** — a completeness critic re-reads the original plan and the
   integrated result, and you get the full report: per-task status, wave merges, blocked waves,
   test results, judgment calls, anything unfinished, plus the post-merge runbook of deferred
   release/manual steps. You approve — which sweeps the engine's worktrees deterministically
   (`scripts/sweep_worktrees.sh`) and hands off to superpowers' branch-finishing skill — or
   **redirect**: corrective re-runs go through the same engine (`resume` mode on the same branch),
   never an improvised one-off.

Two human gates, total: plan approval (before ultrapowers is involved) and pre-merge review.
Everything in between runs autonomously and headless.

Deep dive: [`skills/ultrapowers/SKILL.md`](skills/ultrapowers/SKILL.md) is the front door;
[`skills/ultrapowers/references/`](skills/ultrapowers/references/) covers dependency analysis,
the reviewer prompts and schemas, wave-merge mechanics, the report format, and the maintainer
guide for `workflow.js`.

## Authoring parallel-ready plans (ultraplan)

Superpowers plans are written for a sequential, human-in-the-loop executor;
ultrapowers executes them parallel and headless. Most plans compile cleanly anyway —
real cross-task constraints tend to be shared-file edges, which the dependency
analysis already infers — but release rituals, verification-only gate tasks, and
"execute phases in order" prose need interpretation. Two layers close that gap:

- **Markers** — additive per-task annotations defined in
  `skills/ultrapowers/references/plan-markers.md`:
  `**Type:** implementation | gate | release | manual` and
  `**Depends-on:** <task-ids>`. Sequential executors ignore them; ultrapowers
  compiles them mechanically via `scripts/compile_plan.py` — not by model
  judgment. Gates become run configuration (their suite commands inform
  `testCmd`); `release`/`manual` tasks are excluded into a **post-merge runbook**
  presented with the final report — never run headless, never silently dropped.
  (The contract also spells out the executor variance: a sequential executor runs
  those same tasks inline — continuously, without fresh human eyes — so safety rests
  on plan approval and on placing `release`/`manual` tasks last.)
- **The `ultraplan` skill** — load it alongside `superpowers:writing-plans` when
  authoring a plan destined for `/ultrapowers`. It injects the markers and the
  worktree-pure authoring rules (self-contained bodies, ordering as `Depends-on:`,
  no branch instructions, concurrency-safe tests) at writing time, replaces
  writing-plans' mandated execution header (which would otherwise steer any
  skills-obedient agent into the sequential executor), and adds `/ultrapowers` as
  a third option in the plan's execution handoff.
- **The SessionStart hook** (`hooks/hooks.json` + `hooks/session_start.sh`) —
  makes the routing reliable rather than probabilistic: every session starts with
  a standing rule to layer ultraplan onto `superpowers:writing-plans` and to
  offer `/ultrapowers` first at a marked plan's execution handoff. Without it,
  the handoff depends on the model noticing the ultraplan skill description at
  exactly the plan-writing moment. (Hook changes load at session start — restart
  Claude Code after installing or updating the plugin.)

Unmarked plans still run: the same compiler classifies each task against the
worktree-pure contract (no pushes, no human steps, no mutation outside the
worktree) by evidence, flags every heuristic call, and surfaces each
reinterpretation in the wave-plan transparency render (and again in the final
report) — the interpretation, not just the grouping, is auditable.

## Install

```
/plugin marketplace add popmechanic/ultrapowers
/plugin install ultrapowers@ultrapowers
```

Superpowers must be installed alongside it — ultrapowers hands off to its brainstorming, planning, and branch-finishing skills; the review discipline is baked from its sources at build time and re-baked manually when upstream changes.

## Environment support

`/ultrapowers` runs on [Dynamic Workflows](https://code.claude.com/docs/en/workflows)
(Claude Code v2.1.154+, all paid plans — Pro users enable it under `/config`), which is exposed on
the local **CLI**, **Desktop app**, **IDE extensions**, **`claude -p`**, and the **Agent SDK**.
**Claude Code on the web** does not expose the Workflow tool (verified live), so the skill detects
that at Step 1 and falls back to `superpowers:subagent-driven-development` — sequential, but the
same plan executes either way.

## Cost honesty

Parallel waves, per-task worktrees, and independent review are token-heavy relative to a
sequential run. The payoff is wall-clock time on plans with real parallel structure. Single-task and
fully-overlapping plans degrade to sequential execution automatically; if your plans are
usually small or tightly coupled, superpowers' own executors are the better default and this
plugin adds little.
