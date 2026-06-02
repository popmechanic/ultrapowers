# ultrapowers

ultrapowers — Superpowers' discipline, ultracode's parallel engine.

## What it is

ultrapowers ships one skill: `ultra-driven-development`. It is the autonomous, parallel drop-in replacement for `superpowers:subagent-driven-development`. Where subagent-driven-development runs tasks sequentially with a human guiding each step, `ultra-driven-development` fans approved plan tasks out across isolated git worktrees, runs them in parallel via a Dynamic Workflow, adversarially verifies each result, and integrates them onto a single branch — all without human intervention between plan approval and final review.

## Relationship to superpowers

This plugin depends on `superpowers`. Install superpowers alongside ultrapowers — ultrapowers reuses its brainstorming, writing-plans, TDD, code-review, verification, and finishing-a-development-branch skills and does not duplicate them.

ultrapowers adds only what superpowers deliberately leaves to the human: the orchestration layer that dispatches tasks in parallel, manages worktrees, and merges results.

## Install

```
/plugin marketplace add popmechanic/ultrapowers
/plugin install ultrapowers@ultrapowers
```

Make sure superpowers is already installed. ultrapowers does not install it for you.

## Usage

1. **Brainstorm** — run `superpowers:brainstorming` to explore requirements and design before touching code.
2. **Write a plan** — run `superpowers:writing-plans` to produce a structured, task-by-task implementation plan.
3. **Approve the plan** — review it with the human. This is the first human gate. Once approved, execution is autonomous.
4. **Execute** — run `ultrapowers:ultra-driven-development` with the approved plan. The skill fans tasks out to isolated worktrees, runs them in parallel, verifies each result adversarially, resolves conflicts, and integrates everything onto a shared branch.
5. **Review the integration branch** — inspect the combined result and the skill's report. This is the second human gate.
6. **Finish** — run `superpowers:finishing-a-development-branch` to merge, open a PR, or clean up worktrees as appropriate.

## Human gates

There are exactly two points where a human decision is required:

- **Plan approval** — before execution begins, a human must confirm the plan is correct and complete.
- **Pre-merge review** — after integration, a human must approve the branch before it lands in main.

Everything between those two gates — task dispatch, parallel execution, adversarial verification, conflict resolution, integration — is handled autonomously by `ultra-driven-development`.

## Cost note

Parallel execution plus adversarial verification plus per-task worktrees is token-heavy relative to a sequential run. For very small plans (one or two independent tasks), the overhead may exceed the benefit; in those cases `ultra-driven-development` automatically degrades to sequential execution to avoid unnecessary cost. For larger plans with clear task boundaries and parallelizable work, the throughput gain is substantial.
