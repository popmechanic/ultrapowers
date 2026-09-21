// factory/facts.mjs — the facts an exam and a task's own proof Run: lines
// already establish, read once and handed to Jev instead of guessed at from
// the diff: what a cited command's exit already settled for its clause
// (`settledCoverage`), and the observed facts themselves, capped to a byte
// budget (`observedFacts`).
//
// Pure: no board, no note, no worker text — `factory/engine.mjs`'s `measure`
// is the one caller, holding the exam's own exit and the task's own
// `proofRuns`/`runLines` before Jev is ever asked.

import { literalsOf } from './hunks.mjs'

/** M1: `clauses[i]` is settled by the run lines that cite `M<i+1>` — entry
 *  `i` is `null` when no line in `proofRunClauses` cites it, `1` when every
 *  citing line has a result in `runLines` with `exit === 0`, and `0` when
 *  any citing line has a non-zero exit or no result in `runLines` at all. */
export function settledCoverage ({ clauses, proofRunClauses, runLines }) {
  return (clauses || []).map((_clause, i) => {
    const clauseId = 'M' + (i + 1)
    const citingIdx = []
    for (let k = 0; k < (proofRunClauses || []).length; k += 1) {
      const cites = proofRunClauses[k]
      if (Array.isArray(cites) && cites.includes(clauseId)) citingIdx.push(k)
    }
    if (!citingIdx.length) return null
    for (const k of citingIdx) {
      const r = (runLines || [])[k]
      if (!r || r.exit !== 0) return 0
    }
    return 1
  })
}

/** M2/M3: the observed facts for this landing — the exam's own exit first
 *  (when `hasExam`), then one `{ kind: 'run:line', cmd, exit, cites }` per
 *  proof `Run:` line that either cites a clause (per `proofRunClauses`) or
 *  whose command contains one of the clauses' own backticked literals (>= 3
 *  characters, via `literalsOf`) — a line that does neither is left out
 *  entirely. Facts are then dropped from the end until the array's own
 *  `JSON.stringify` fits within `capBytes`. Takes exactly these seven keys:
 *  no note, no worker text, no board reading ever reaches this function. */
export function observedFacts ({ clauses, hasExam, examExit, proofRuns, proofRunClauses, runLines, capBytes }) {
  const literals = literalsOf(clauses)
  const out = []
  if (hasExam) out.push({ kind: 'exam', exit: examExit })
  const lines = proofRuns || []
  for (let k = 0; k < lines.length; k += 1) {
    const cites = (Array.isArray((proofRunClauses || [])[k])) ? proofRunClauses[k] : []
    const rl = (runLines || [])[k]
    const cmd = rl ? rl.cmd : lines[k]
    const exit = rl ? rl.exit : undefined
    const matchesLiteral = literals.some((lit) => String(cmd).includes(lit))
    if (cites.length || matchesLiteral) {
      out.push({ kind: 'run:line', cmd, exit, cites })
    }
  }
  while (out.length && Buffer.byteLength(JSON.stringify(out), 'utf8') > capBytes) {
    out.pop()
  }
  return out
}

export default { settledCoverage, observedFacts }
