/**
 * factory/dispatch.mjs — who a task waits on before its implementers start.
 *
 * Pure: no disk, no git, no network. `waitsFor` merges a task's hard
 * predecessors (depends_on plus write-after-create dag_edges) with its chain
 * predecessors (orderings a `chain` pair verdict added).
 *
 * With `policy.speculate.on_candidate` true: `adoption` is `hardPreds`
 * (deduplicated, order-preserving) and `candidate` is the `chainPreds` that
 * are not already in `hardPreds` (also deduplicated, order-preserving) — a
 * chain predecessor a task can start against once it is merely MEASURED,
 * not yet adopted.
 *
 * With it false or absent — the answer this file gave before this split
 * existed — `adoption` is `hardPreds` then `chainPreds`, hard predecessors
 * first, deduplicated so the first occurrence of an id wins; `candidate` is
 * always `[]`.
 */
export function waitsFor ({ taskId, hardPreds = [], chainPreds = [], policy } = {}) {
  const onCandidate = Boolean(policy && policy.speculate && policy.speculate.on_candidate)
  const hard = [...(hardPreds || [])]
  const chain = [...(chainPreds || [])]

  if (onCandidate) {
    const seenHard = new Set()
    const adoption = []
    for (const id of hard) {
      if (seenHard.has(id)) continue
      seenHard.add(id)
      adoption.push(id)
    }
    const seenCand = new Set()
    const candidate = []
    for (const id of chain) {
      if (seenHard.has(id) || seenCand.has(id)) continue
      seenCand.add(id)
      candidate.push(id)
    }
    return { adoption, candidate }
  }

  const seen = new Set()
  const adoption = []
  for (const id of [...hard, ...chain]) {
    if (seen.has(id)) continue
    seen.add(id)
    adoption.push(id)
  }
  return { adoption, candidate: [] }
}
