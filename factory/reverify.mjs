// factory/reverify.mjs — which adopted exams a fold's own touched paths put
// back in play.
//
// `factory/engine.mjs` folds one candidate at a time and, with
// `policy.fold.reverify.enabled` true, wants to know — right after that fold
// — which already-adopted tasks have a stake in the paths the fold just
// touched: the folded task's own exam always, plus any sibling whose `files`
// overlap. `examsTouched` is that reading, kept pure and separate from the
// engine so M1 stands as one small answer a caller can check with no clone,
// no `sh`, and no fold at all.

/**
 * The adopted tasks whose exam belongs on the folded tree: `folded` itself
 * first, then the rest of `adopted` in their own (adoption) order, filtered
 * to a task that both shares at least one path with `touched` and carries a
 * non-empty string `testCmd` — a task with nothing to run is not an exam —
 * and capped at `cap` entries overall.
 */
export function examsTouched ({ folded, touched, adopted, tasks, cap }) {
  const byId = new Map((tasks || []).map((t) => [String(t.id), t]))
  const touchedSet = new Set(touched || [])
  const foldedId = String(folded)

  const qualifies = (task) => {
    if (!task) return false
    if (typeof task.testCmd !== 'string' || task.testCmd.trim() === '') return false
    return (task.files || []).some((f) => touchedSet.has(f))
  }

  const orderedIds = [foldedId, ...(adopted || []).map(String).filter((id) => id !== foldedId)]
  const limit = Number.isInteger(cap) ? cap : Infinity

  const out = []
  for (const id of orderedIds) {
    if (out.length >= limit) break
    const task = byId.get(id)
    if (qualifies(task)) out.push(task)
  }
  return out
}

export default { examsTouched }
