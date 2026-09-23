/**
 * factory/kprobe.mjs — the `dispatch.k_probe` cell (#1211): one task per run,
 * the hardest by Jev's own `readTask` reading, lands from two implementers
 * instead of one, and the landing row that follows records what the probe
 * bought.
 *
 * Pure and synchronous: no `fs`, no `sh`, no import from the engine or
 * anywhere else. Both exports read only the arguments handed to them.
 */

/** A difficulty reading for one task's `difficulties[id]` entry: a finite
 *  number reads directly, an object carrying a finite `score` reads that
 *  score, and anything else (missing, a string, an object with no numeric
 *  `score`) is no reading at all — `null`. */
function readingOf(entry) {
  if (typeof entry === 'number' && Number.isFinite(entry)) return entry
  if (entry && typeof entry === 'object' && typeof entry.score === 'number' && Number.isFinite(entry.score)) {
    return entry.score
  }
  return null
}

/**
 * `kFor({ tasks, difficulties, judged, policy })` — pure, synchronous.
 *
 * With `policy.dispatch.k_probe.enabled === true`: `probe` is the id of the
 * task whose `difficulties` reading is highest (first in `tasks` order on a
 * tie), `k[probe]` is the cell's own `k`, and every other task's `k` is 1.
 * With no task readable at all, `probe` is `null` and every `k` is 1.
 *
 * With the cell absent, or present but not `enabled: true`: `probe` is
 * `null` and `k[id]` falls back to `judged[id]` when that is a positive
 * integer, else 1.
 */
export function kFor({ tasks, difficulties, judged, policy }) {
  const cell = policy && policy.dispatch && policy.dispatch.k_probe
  const k = {}

  if (cell && cell.enabled === true) {
    let probe = null
    let best = -Infinity
    for (const t of tasks) {
      const reading = readingOf(difficulties ? difficulties[t.id] : undefined)
      if (reading === null) continue
      if (probe === null || reading > best) {
        probe = t.id
        best = reading
      }
    }
    for (const t of tasks) k[t.id] = t.id === probe ? cell.k : 1
    return { probe, k }
  }

  for (const t of tasks) {
    const j = judged ? judged[t.id] : undefined
    k[t.id] = Number.isInteger(j) && j > 0 ? j : 1
  }
  return { probe: null, k }
}

/**
 * `probeRecord({ candidates, scores })` — pure, synchronous.
 *
 * Builds one `candidates` entry per input candidate (in input order),
 * carrying its `index`, `factsExit`, `claim`, `coverage` and `score`
 * (`scores[i]`). `chosen` is the `index` of the highest-scoring entry (first
 * on a tie). `margin` is the chosen score minus the highest score among the
 * other entries, `null` when there is only one candidate.
 */
export function probeRecord({ candidates, scores }) {
  const entries = candidates.map((c, i) => ({
    index: c.index,
    factsExit: c.factsExit,
    claim: c.claim,
    coverage: c.coverage,
    score: scores[i],
  }))

  let bestI = 0
  for (let i = 1; i < entries.length; i++) {
    if (entries[i].score > entries[bestI].score) bestI = i
  }

  let margin = null
  if (entries.length > 1) {
    let restBest = -Infinity
    for (let i = 0; i < entries.length; i++) {
      if (i === bestI) continue
      if (entries[i].score > restBest) restBest = entries[i].score
    }
    margin = entries[bestI].score - restBest
  }

  return { chosen: entries[bestI].index, margin, candidates: entries }
}
