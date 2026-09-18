/**
 * factory/dispatch.mjs — who a task waits on before its implementers start.
 *
 * Pure: no disk, no git, no network. `waitsFor` merges a task's hard
 * predecessors (depends_on plus write-after-create dag_edges) with its chain
 * predecessors (orderings a `chain` pair verdict added), hard predecessors
 * first, deduplicated so the first occurrence of an id wins. `candidate` is
 * always empty here — a placeholder a sibling task fills in later.
 */
export function waitsFor ({ taskId, hardPreds = [], chainPreds = [], policy } = {}) {
  const seen = new Set()
  const adoption = []
  for (const id of [...(hardPreds || []), ...(chainPreds || [])]) {
    if (seen.has(id)) continue
    seen.add(id)
    adoption.push(id)
  }
  return { adoption, candidate: [] }
}
