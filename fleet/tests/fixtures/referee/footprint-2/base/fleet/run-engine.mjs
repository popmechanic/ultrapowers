// fleet/run-engine.mjs — a ten-line stand-in for the driver's engine.
export const SEVERITY = ['blocking', 'minor']
export const ACTORS = ['implementer', 'plan']
export const runTask = (task) => ({ id: task.id, ok: true })
export const runWave = (tasks) => tasks.map(runTask)
export const verdictOf = (issues) =>
  issues.some((i) => i.severity === 'blocking') ? 'FIX_REQUIRED' : 'PASS'
export const idsOf = (tasks) => tasks.map((t) => t.id)
export default { runTask, runWave, verdictOf, idsOf }
