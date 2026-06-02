# ultrapowers Design

- **Date:** 2026-06-02
- **Status:** Design approved (brainstorming complete) — awaiting spec review before planning
- **Plugin:** `ultrapowers`
- **Skill:** `ultra-driven-development`
- **Author:** marcus@vibes.diy
- **Depends on:** [`superpowers`](https://github.com/obra/superpowers) (soft dependency, no fork)

---

## Summary

`ultrapowers` is a standalone Claude Code plugin that supplies a single skill,
`ultra-driven-development`, as a drop-in alternative to `superpowers:subagent-driven-development`.
Where Superpowers executes an approved plan by dispatching subagents **sequentially**
with a **human review checkpoint between every task**, `ultra-driven-development` executes
the same plan **autonomously** via a **Dynamic Workflow** — running independent tasks
**in parallel** (each in its own git worktree), with **adversarial verification** standing
in for the human review gate, and surfacing a single **pre-merge review** at the end.

The name fuses the two things it is: Superpowers' *discipline* + ultracode/Workflows'
*parallel engine*.

## Motivation

1. **The human gate is in the wrong place for this operator.** Superpowers asks for human
   judgment between every implementation task. For a technical architect who is *not* a senior
   software engineer, those mid-implementation prompts are low-value: the plan is the right
   altitude for human review; the per-task implementation decisions are better made by the model.
   The operator currently auto-approves them, which means the gate adds latency without adding
   judgment.
2. **The model now makes better-informed low-level calls than the operator.** The operator's
   leverage is in the *research and planning* phases (where intent, constraints, and user-advocacy
   live), not in per-task implementation review.
3. **Workflows unlock safe parallel implementation, which Superpowers structurally forbids.**
   `superpowers:dispatching-parallel-agents` explicitly bans parallel *implementation*
   ("Never dispatch multiple implementation subagents in parallel (conflicts)") — a constraint
   that exists only because its host (plain subagents) cannot isolate file writes. Dynamic
   Workflows offer per-agent git-worktree isolation, removing that constraint. This is the
   single most valuable capability `ultrapowers` adds.

`ultrapowers` therefore **keeps the human in research and planning**, and makes
**execution autonomous, parallel, and adversarially verified**, with one final human
checkpoint before anything merges.

## Relationship to Superpowers

`ultrapowers` follows the dependency pattern Jesse Vincent established with
[`iterative-development`](https://github.com/prime-radiant-inc/iterative-development):
a separate plugin that depends on Superpowers by **convention**, never by forking it.

There is no machine-readable plugin dependency mechanism in Claude Code (plugin manifests
have no `dependencies` field). Coupling is expressed three ways, all soft:

1. A README line instructing the operator to install Superpowers alongside `ultrapowers`.
2. References to Superpowers skills **by namespace** (`superpowers:writing-plans`, etc.) in
   `ultra-driven-development`'s prose. The agent reads the reference and invokes the Skill tool.
3. The main agent loading Superpowers' reviewer/implementer prompt templates at runtime and
   baking their content into the workflow it authors (see *Discipline reuse*, below).

Categorization of upstream Superpowers skills (mirrors `iterative-development`'s design spec):

| Superpowers skill | ultrapowers treatment |
|---|---|
| `brainstorming` | **Reused, human-gated, upstream.** Unchanged. The operator's primary creative input. |
| `writing-plans` | **Reused, human-gated.** Produces the plan doc — the operator's primary control surface. Unchanged; **not** forked. |
| `subagent-driven-development` | **Replaced** by `ultra-driven-development`. Not invoked at runtime. |
| `executing-plans` | **Replaced** (the autonomous-workflow path supersedes inline execution). |
| `test-driven-development` | **Reused** — its discipline is baked into each implementer agent's prompt. |
| `requesting-code-review` / `receiving-code-review` | **Reused** — basis for the spec-compliance and code-quality reviewer agent prompts + their structured verdicts. |
| `verification-before-completion` | **Reused** — applied by the integration/completeness reviewer. |
| `systematic-debugging` | **Reused** — referenced by implementer agents when a task is blocked. |
| `finishing-a-development-branch` | **Reused, human-gated.** Invoked after the operator approves the pre-merge review. |
| `using-git-worktrees` | **Superseded** — the workflow manages per-agent worktrees natively. |

**No Superpowers file is copied or modified.** `ultrapowers` ships only its own one skill.

## Architecture

End-to-end flow (human gates marked 🚦):

```
🚦 superpowers:brainstorming        (human — unchanged)
        │
🚦 superpowers:writing-plans        (human approves the plan doc — primary control surface)
        │
   ultra-driven-development         (autonomous from here)
        │
        ├─ 1. Read + sanity-check the approved plan
        ├─ 2. Load Superpowers discipline (TDD, reviewers, verification) via Skill tool
        ├─ 3. Dependency pass → build task DAG → group into waves
        │       (degrade to a single sequential wave for small plans)
        ├─ 4. Author + launch a Dynamic Workflow:
        │       for each wave (sequential, barriered):
        │         run wave's tasks CONCURRENTLY, each agent.isolation = 'worktree':
        │            implement → spec-compliance review → code-quality review → bounded fix-loop
        │         merge the wave's worktrees → integration branch → run tests
        │         on merge/test failure → reconciliation agent
        │       after final wave: full test run + integration/completeness review
        │       return a STRUCTURED REPORT
        │
🚦 Pre-merge review                  (human reviews integration branch + report)
        │
🚦 superpowers:finishing-a-development-branch   (human — merge / PR / cleanup)
```

The headless constraint of Workflows is respected: after the operator approves the plan,
the only human touchpoint is **after** the workflow returns. Nothing pauses mid-run.

## Components

### 1. The `ultra-driven-development` skill (`SKILL.md`)

A flexible/process skill. Its body instructs the *main* agent (which has the Skill tool and
filesystem read access — unlike a headless workflow agent) to perform steps 1–4 above and then
present the pre-merge review. It references `superpowers:*` skills by namespace. It does **not**
itself run code; it authors and launches the workflow, then mediates the human gate.

Triggering: invoked explicitly, or when the operator says something like "execute this plan as
a workflow / go ultra" instead of following `writing-plans`' default
"use `superpowers:subagent-driven-development`" handoff line.

### 2. Dependency pass (DAG → waves)

Because `superpowers:writing-plans` plans do not encode a dependency graph, the executor infers
one from the plan: files each task creates/modifies, explicit "depends on Task N" language, and
shared modules. It produces a DAG, then groups tasks into **waves** (a wave = a set of tasks with
no unsatisfied intra-wave dependencies, runnable concurrently).

- **Conservative by default:** when dependency is ambiguous, serialize rather than risk a conflict.
- **Transparency:** the inferred wave plan is included in the final report so the operator can
  sanity-check how parallelism was chosen.
- **Small-plan degrade:** below a threshold (e.g. ≤2 tasks, or all tasks touching the same files),
  collapse to a single sequential wave — no worktree machinery, no parallel cost.

### 3. The Dynamic Workflow (authored at runtime)

A `meta` block plus a body using `phase()` per wave, `parallel()` to barrier each wave, and
per-task `agent({ isolation: 'worktree', schema, model })` pipelines. Per task:

- **implement** — agent prompt carries the full task text (pasted, not a file reference) + baked-in
  TDD discipline; returns a structured status (`DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED`).
- **spec-compliance review** — adversarial verifier: "does this match the task, nothing more/less?"
  Independent; instructed not to trust the implementer's report.
- **code-quality review** — runs only after spec-compliance passes.
- **bounded fix-loop** — on review failure, the implementer fixes; reviewer re-checks; capped
  iterations, escalating to a more capable model on repeated `BLOCKED` (Superpowers' own rule:
  never retry the same model without changes).

Model tiers per agent role: cheap for mechanical implementation, standard for integration,
most-capable for design/review (Superpowers' selection heuristic).

### 4. Wave merge + reconciliation

At each wave barrier, the wave's worktree branches merge into a single integration branch and the
test suite runs. A failed merge or failed tests spawns a **reconciliation agent** that resolves
the conflict / fixes the regression. If unresolvable within bounds, the wave is marked blocked and
surfaced in the report rather than silently dropped.

### 5. Integration / completeness review

After the final wave: a full test run plus a completeness-critic agent
(reusing `superpowers:verification-before-completion`) asking "what's missing — an unmet plan
requirement, an unverified claim, an untested path?"

### 6. Structured report

The workflow's return value. Includes: the inferred wave plan, per-task status + diffs + test
results, every judgment call the workflow made autonomously, anything it could not finish, and the
integration branch name. This is what the operator reviews at the pre-merge gate.

## Data flow

`approved plan doc` → `task DAG` → `waves[]` → (per task) `worktree branch` →
`wave integration merge` → `integration branch` → `structured report` →
**human pre-merge review** → `superpowers:finishing-a-development-branch`.

State is carried by **git** (per-task commits, worktree branches, the integration branch) and by
the workflow's structured return value — never by shared session context. Each agent's context is
constructed exactly (pasted task text + baked discipline), never inherited.

## Discipline reuse mechanism

The robust way to give headless workflow agents Superpowers' discipline, avoiding two unknowns
(whether a workflow `agent()` can call the Skill tool mid-run, and Superpowers' version-pinned
install path):

> The **main** agent — which *does* have the Skill tool — invokes the relevant `superpowers:*`
> skills/templates during authoring, extracts the discipline content, and **bakes it into the
> `agent()` prompt strings and JSON output schemas** of the workflow it writes. The workflow
> agents then need no live Skill-tool access.

This is the same move `iterative-development` makes (it inlines `(superpowers:test-driven-development)`
into its implementer prompt). The namespace reference remains as a pointer/citation, but correctness
does not depend on runtime skill resolution inside the workflow.

## Human-in-the-loop posture

- **Gates (human):** brainstorming → plan approval → **pre-merge review** → finishing-the-branch.
- **Autonomous:** everything between plan approval and the pre-merge review.
- **Escalation is catastrophe-only.** Because the workflow is headless, a `BLOCKED` task cannot ask
  the operator mid-run. It gets bounded retries with model escalation; if still blocked it is marked
  failed, dependent tasks downstream are skipped, independent tasks continue, and the failure is
  surfaced in the report. The run only aborts on total catastrophic failure (e.g. the plan is
  uninterpretable, or the workspace is broken).

## Error handling & edge cases

| Case | Behavior |
|---|---|
| Single-task plan | One implement→review→fix pipeline; no worktrees. |
| All-independent tasks | One wide wave. |
| Strict sequential chain | N waves of 1 (still autonomous, just no concurrency gain). |
| Cyclic / contradictory dependency inferred | Detect; abort to human with the offending edges. |
| Merge conflict in a wave | Reconciliation agent; if unresolvable → wave blocked, surfaced in report. |
| Integration tests fail | Reported; operator decides at the pre-merge gate. |
| Task BLOCKED after retries | Marked failed; downstream skipped; independents continue; surfaced. |
| Ambiguous dependency | Serialize (conservative). |
| Token budget low | Workflow `budget` guard: degrade model tiers / stop early and report partial. |
| Long run spanning sessions | Workflow resume is **same-session only** — documented limitation; large runs should complete in one session. |

## Testing strategy

This is a skill + a dynamically authored workflow, so testing has three layers:

1. **Skill validation** — frontmatter/structure lint, following `iterative-development`'s
   `validate_skill.py` precedent.
2. **Dry-run mode** — the skill can author the workflow script and surface it **without executing**,
   so it can be inspected (by tests and by the operator before a large run).
3. **Canary plan** — a small fixture plan with known independent + dependent tasks. Assert: the
   inferred wave grouping is correct; worktrees are created/merged; the report shape validates;
   the baked agent prompts actually contain the Superpowers discipline content.

## Scope

**In scope (v1):**

- One skill, `ultra-driven-development`, in the `ultrapowers` plugin.
- Parallel wave execution with per-agent worktree isolation.
- Adversarial spec + quality review with bounded fix-loops.
- Dependency inference, wave merge + reconciliation, integration/completeness review.
- Small-plan degrade-to-sequential.
- Structured report + pre-merge human gate.
- README documenting the Superpowers co-install requirement.

**Out of scope (deferred):**

- Forking or modifying any Superpowers file.
- Mid-run human interaction / approval (incompatible with headless workflows).
- Cross-session resume of a single run.
- A bundled marketplace (publish later, as a separate concern).
- Replacing `writing-plans` with inline decomposition (we keep the plan doc).

## Open questions & risks

1. **Dependency inference is the hard part of parallel-in-v1.** A wrong guess costs either lost
   parallelism (safe) or a merge conflict (handled, but burns tokens). Mitigated by conservatism +
   surfacing the wave plan in the report. *Needs validation against real plans.*
2. **Whether a workflow `agent()` can invoke the Skill tool mid-run is unverified.** The design
   sidesteps this by baking discipline at authoring time, but if live skill access *is* available
   it could simplify things. *To confirm experimentally.*
3. **Whether a `SKILL.md` can reliably drive `Workflow({scriptPath})`** is the core integration
   assumption. The documented opt-in path ("a skill whose instructions tell you to call Workflow")
   suggests yes; *to confirm experimentally — this is the highest-priority unknown.*
4. **Cost.** Parallel + adversarial verification + worktrees is token-heavy. The degrade-to-sequential
   path and the `budget` guard are the controls.

## Decisions log

| Decision | Choice |
|---|---|
| Packaging | Standalone executor skill (depends on Superpowers; changes nothing in it). |
| Last human gate | After plan approval, then again before merge. |
| v1 ambition | Parallel (worktree isolation, dependency waves). |
| Plan artifact | Keep `superpowers:writing-plans` as the control surface. |
| Plugin name | `ultrapowers`. |
| Skill name | `ultra-driven-development`. |
| Location | New repo at `~/Websites/ultrapowers`. |
