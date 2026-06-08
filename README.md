# ultrapowers

ultrapowers — [Superpowers](https://github.com/obra/superpowers)' senior engineering discipline, ultracode's parallel execution engine.

## What it is

ultrapowers ships one skill, `ultrapowers`, invoked as **`/ultrapowers <plan-path>`**. It is the parallel drop-in replacement for `superpowers:subagent-driven-development`. subagent-driven-development already runs autonomously and headless — it implements plan tasks one after another and does **not** pause for the human between them. What it structurally cannot do is run *implementation* tasks in parallel: it explicitly forbids that (plain subagents share one working tree and would conflict). `/ultrapowers` adds exactly that missing capability — it fans approved plan tasks out across isolated git worktrees, runs independent ones in parallel via a **committed Dynamic Workflow** (`skills/ultrapowers/workflow.js`), adversarially verifies each result, and integrates them onto a single branch — with one wave-plan approval before launch and one review at the end. Its differentiator is **parallel throughput on decomposable work, not autonomy** — superpowers already gives you that.

The orchestration ships as a frozen, version-controlled `workflow.js` with the Superpowers discipline **baked in at build time** — so a run does not re-author a script or depend on live `superpowers:*` skill resolution. That is what makes execution deterministic and keeps the two plugins decoupled at runtime (they hand off only through the plan file on disk).

## Relationship to superpowers

This plugin depends on `superpowers`. Install superpowers alongside ultrapowers — ultrapowers reuses its brainstorming, writing-plans, TDD, code-review, verification, and finishing-a-development-branch skills and does not duplicate them.

ultrapowers adds only what superpowers deliberately leaves to the human: the orchestration layer that dispatches tasks in parallel, manages worktrees, and merges results.

## Install

```
/plugin marketplace add popmechanic/ultrapowers
/plugin install ultrapowers@ultrapowers
```

Make sure superpowers is already installed. ultrapowers does not install it for you.

### Environment support

`/ultrapowers` runs a Dynamic Workflow, which requires a surface that exposes the **Workflow** tool:
the local **CLI**, **Desktop app**, **IDE extensions**, or non-interactive **`claude -p`** / the **Agent
SDK** (Claude Code v2.1.154+, paid plan). **Claude Code on the web** (the cloud/remote execution
environment) is *not* in the workflows availability list and does **not** expose the Workflow tool, so
`/ultrapowers` cannot launch there — verified live: `select:Workflow` resolves to no tool in a web
session. In that environment, fall back to `superpowers:subagent-driven-development` (sequential).

## Usage

1. **Brainstorm** — run `superpowers:brainstorming` to explore requirements and design before touching code.
2. **Write a plan** — run `superpowers:writing-plans` to produce a structured, task-by-task implementation plan.
3. **Approve the plan** — review it with the human. This is the first human gate. Once approved, execution is autonomous except for one quick wave-plan check.
4. **Execute** — run `/ultrapowers <plan-path>` from inside the target repo. The skill computes the parallel wave plan and shows it for approval (the second gate), then launches the committed workflow: tasks run in isolated worktrees, are verified adversarially, conflicts are reconciled, and everything integrates onto a shared branch.
5. **Review the integration branch** — inspect the combined result and the report. This is the third and final human gate.
6. **Finish** — run `superpowers:finishing-a-development-branch` to merge, open a PR, or clean up worktrees as appropriate.

## Human gates

There are three points where a human decision is required:

- **Plan approval** — before anything runs, a human confirms the plan (from `superpowers:writing-plans`) is correct and complete.
- **Wave-plan approval** — `/ultrapowers` computes how tasks split into parallel waves and shows that plan; a human approves it before launch, catching a bad parallelization guess before tokens are spent.
- **Pre-merge review** — after integration, a human approves the branch before it lands in main.

Everything between the wave-plan approval and the pre-merge review — task dispatch, parallel execution, adversarial verification, conflict resolution, integration — is handled autonomously by the committed workflow. If the workflow cannot run, the skill falls back to `superpowers:subagent-driven-development` (sequential) rather than improvising.

## Cost note

Parallel execution plus adversarial verification plus per-task worktrees is token-heavy relative to a sequential run. For very small plans (one or two independent tasks), the overhead may exceed the benefit; in those cases `/ultrapowers` automatically degrades to sequential execution to avoid unnecessary cost. For larger plans with clear task boundaries and parallelizable work, the throughput gain is substantial.
