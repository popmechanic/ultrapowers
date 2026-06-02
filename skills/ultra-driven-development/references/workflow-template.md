# Dynamic Workflow Template

This file contains the skeleton the main agent adapts at authoring time. The main agent reads this template, fills in the `WAVES` payload (derived from dependency analysis), bakes reviewer prompts inline, and passes the result to the Workflow tool.

## Skeleton

```javascript
export const meta = {
  name: 'ultra-driven-development',
  description: 'Execute an approved plan: parallel waves, worktree isolation, adversarial review',
  phases: [ /* one entry per wave, titled "Wave N" */ ],
}
// Bake the git target as LITERALS at authoring time. Do NOT rely on `args` to carry
// REPO/integration — live validation (2026-06-02) showed `args` may not populate the
// script globals, and an undefined target makes agents fall back to the SESSION repo.
const REPO = '/absolute/path/to/target/repo'          // literal; validated to be a git repo before launch
const integrationBranch = 'ultra/integration-<stamp>' // literal (<stamp> may come via args)
const GUARD = `SAFETY: operate only inside ${REPO}; if it is missing, "undefined", or not a git repo, STOP and report BLOCKED — never fall back to your cwd.`
const WAVES = args.waves              // Task[][] from dependency-analysis
if (!Array.isArray(WAVES) || WAVES.length === 0) {
  throw new Error('WAVES missing/empty — bake waves inline or verify args before launch; never run with an undefined plan')
}
for (let w = 0; w < WAVES.length; w++) {
  phase(`Wave ${w + 1}`)
  const results = await parallel(WAVES[w].map(task => () =>
    runTask(task, REPO, GUARD)        // pipeline below; every agent prompt BEGINS with GUARD
  ))
  await mergeWave(results, REPO, integrationBranch, GUARD)   // see wave-merge.md
}
return await integrationReview(REPO, integrationBranch, GUARD) // see wave-merge.md + report-format.md
```

## Filling In the Skeleton

- **Per-task pipeline (`runTask`):** implement → spec-compliance review → code-quality review → bounded fix-loop, each `agent()` call using `isolation: 'worktree'`, the prompts/schemas from reviewer-prompts.md, and `model` tiers per role. Each implementer returns its worktree branch + HEAD sha (branch names are runtime-assigned, so the task→branch map comes from the agent).

- **Merge step (`mergeWave`):** because the script can't run git, dispatch a dedicated NON-isolated merge agent with the wave's reported branches; it merges them into the integration branch (in the main checkout) and runs tests. Details in wave-merge.md.

- **Barrier rationale:** `parallel()` per wave is a deliberate barrier — the wave must fully merge before the next starts (cross-wave dependencies). Within a wave, tasks are independent by construction.

- **Authoring instructions:** the main agent loads the superpowers discipline, bakes the reviewer-prompts.md content into each `agent()` prompt, substitutes real task text (pasted, not file refs), and **bakes the target repo path and integration branch as string literals** in the script — `args` is unreliable for these (live validation 2026-06-02). Prepend the fail-safe `GUARD` (see reviewer-prompts.md) to the top of every `agent()` prompt, and assert the plan is present before the wave loop (fail loud; never run with an undefined target).

- **Budget guard:** if `budget.total` is set, degrade model tiers / stop early and return a partial report rather than exceeding it.

## Notes on the Workflow Environment

The workflow script body has no shell or filesystem access. It cannot invoke `git`, read files, or spawn processes directly. All side-effecting work — cloning, committing, merging, running tests — must be delegated to `agent()` calls. The script itself is a pure orchestrator: it sequences barriers, maps task inputs to agent calls, and collects structured outputs.

`agent()` calls accept `{ isolation: 'worktree', schema, model, label }`. Use `isolation: 'worktree'` for implementers and reviewers so each works in an independent checkout. Omit it for the merge agent, which must operate on the shared main checkout to accumulate branches.

`parallel(thunks)` accepts an array of zero-argument functions returning promises. It resolves when all settle and returns their results in order. A rejected thunk rejects the whole barrier — handle failures inside `runTask` and return a structured error result rather than throwing.

`phase(title)` marks a progress checkpoint in the run log. Use one per wave. The `meta.phases` array should list the same titles so the UI can show expected vs. completed phases before execution starts.

`args` may carry supplementary inputs (e.g. `waves`, a timestamp), but **never the git target**: bake the absolute repo path and integration branch as literals so a failure to populate `args` cannot silently redirect git at the session repo. Assert any `args`-sourced value (e.g. `waves`) is present and well-formed before use — throw rather than proceed with `undefined`. Task objects inside `waves` must be self-contained: task title, acceptance criteria, file paths, and the baked-in reviewer prompts — no external file references the script cannot resolve.

`budget` exposes the token budget for the run. If `budget.total` is set, check remaining budget before launching each wave. If headroom is insufficient for the next wave, skip remaining waves, note which tasks were deferred in the return value, and still run `integrationReview` on whatever merged successfully.

## Model Tiers

Assign models per role at authoring time. Recommended defaults:

| Role | Tier |
|---|---|
| Implementer | large |
| Spec-compliance reviewer | medium |
| Code-quality reviewer | medium |
| Fix-loop agent | large |
| Merge agent | small |
| Integration reviewer | large |

Override tiers downward when budget pressure is detected mid-run.
