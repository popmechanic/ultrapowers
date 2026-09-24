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
/**
 * hardEdgePreds({ dagEdges, pairsLive, proofRunHard }) -> Map<id, Set<id>>
 *
 * Which of the parser's dag_edges become a hard predecessor (an edge
 * `waitsFor` folds into `hardPreds`, not a `chain` ordering a pair verdict
 * merely measured). With `pairsLive` false, every edge the parser printed is
 * kept — the reading this file gave before `pairs.mode` existed. With
 * `pairsLive` true, only `write-after-create` edges are kept, plus
 * `proof-run` edges when `proofRunHard` is true: a probe that imports a
 * sibling's file can only run once that file lands, so a `proof-run` edge is
 * a fact, not a judgment `pairs` alone should carry — `interface` edges (and
 * `proof-run` ones when the cell is off) stay the reader's, read as a `pairs`
 * entry instead (M2's `t_changes_consumer` and, when `proof_run_hard.enabled`
 * is false, the `proof-run` label too).
 *
 * Pure: no disk. Seeding a task's own `depends_on` into the answer is the
 * caller's job — this function only ever adds the parser's dag_edges.
 */
export function hardEdgePreds ({ dagEdges = [], pairsLive, proofRunHard } = {}) {
  const preds = new Map()
  for (const edge of dagEdges || []) {
    if (pairsLive) {
      const isHardWhy = edge.why === 'write-after-create' ||
        (edge.why === 'proof-run' && proofRunHard === true)
      if (!isHardWhy) continue
    }
    if (!preds.has(edge.to)) preds.set(edge.to, new Set())
    preds.get(edge.to).add(edge.from)
  }
  return preds
}

/**
 * speculationFor({ producerDone, head, producerAnchor }) -> { mode, reason }
 *
 * Whether a consumer may start on a candidate producer, or must wait for the
 * run head to catch back up to the tree the producer's implementers were
 * cloned from. Pure and total.
 *
 * `producerDone` true answers `launch` — the producer is adopted, nothing
 * speculative about it. Otherwise, a `producerAnchor` that isn't a string
 * means the producer hasn't been dispatched at all yet, so `wait`. Otherwise,
 * `head === producerAnchor` answers `on-candidate` — the run head hasn't
 * moved since that candidate was cut, so the consumer's own tree still
 * matches it. Otherwise the head has moved on since, so `wait`, naming both
 * shas in the reason.
 */
export function speculationFor ({ producerDone, head, producerAnchor } = {}) {
  if (producerDone === true) return { mode: 'launch', reason: 'producer adopted' }
  if (typeof producerAnchor !== 'string') return { mode: 'wait', reason: 'producer not yet dispatched' }
  if (head === producerAnchor) {
    return { mode: 'on-candidate', reason: 'head unchanged since the candidate anchor ' + head }
  }
  return { mode: 'wait', reason: 'head moved from ' + producerAnchor + ' to ' + head + ' since the candidate was cut' }
}

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
