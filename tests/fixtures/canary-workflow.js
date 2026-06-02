// Dry-run authoring output for tests/fixtures/canary-plan.md.
//
// Dependency analysis (per references/dependency-analysis.md) yields:
//   - Task A creates a.txt; Task C modifies a.txt  =>  edge A -> C
//   - Task B creates b.txt, independent of A and C
//   => waves = [["Task A", "Task B"], ["Task C"]]
//
// This file is a fixture demonstrating the SHAPE the SKILL.md would author for
// the canary plan. It is NOT executed by tests — tests/test_canary.py asserts
// its structure (two waves, parallel barrier, worktree isolation, args wiring).

export const meta = {
  name: 'ultra-driven-development',
  description: 'Canary run: build the canary plan in parallel waves',
  phases: [{ title: 'Wave 1' }, { title: 'Wave 2' }],
}

const WAVES = args.waves                       // [["Task A", "Task B"], ["Task C"]]
const integrationBranch = args.integrationBranch // ultra/integration-<timestamp>

const implementerSchema = {
  type: 'object',
  required: ['status', 'summary', 'branch'],
  properties: {
    status: { enum: ['DONE', 'DONE_WITH_CONCERNS', 'NEEDS_CONTEXT', 'BLOCKED'] },
    summary: { type: 'string' },
    branch: { type: 'string' },
    headSha: { type: 'string' },
    commit: { type: 'string' },
  },
}

// Per-task pipeline: worktree-isolated implementer, then spec + quality review and
// a bounded fix loop (see references/reviewer-prompts.md). Shown collapsed here.
const runTask = (task) =>
  agent(`Implement this task exactly:\n${task.body}`, {
    label: `impl:${task.id}`,
    isolation: 'worktree',
    model: task.tier,
    schema: implementerSchema,
  })

for (let w = 0; w < WAVES.length; w++) {
  phase(`Wave ${w + 1}`)
  const results = await parallel(WAVES[w].map((task) => () => runTask(task)))
  await mergeWave(results, integrationBranch)  // non-isolated merge agent; see references/wave-merge.md
}

return await integrationReview(integrationBranch)
