// factory/facts.mjs — the facts a task's own proof Run: lines and its
// selected tests already establish, read once and handed to Jev instead of
// guessed at from the diff: what a cited command's exit already settled for
// its clause (`settledCoverage`), and the observed facts themselves, capped
// to a byte budget (`observedFacts`).
//
// Pure: no board, no note, no worker text — `factory/engine.mjs`'s `measure`
// is the one caller, holding the task's own `proofRuns`/`runLines` and its
// selected tests before Jev is ever asked.

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

/** M2/M3: the observed facts for this landing — one `{ kind: 'run:line',
 *  cmd, exit, cites }` per proof `Run:` line that either cites a clause (per
 *  `proofRunClauses`) or whose command contains one of the clauses' own
 *  backticked literals (>= 3 characters, via `literalsOf`) — a line that
 *  does neither is left out entirely — followed by one `{ kind: 'test',
 *  path, exit }` per entry of `tests` (the selected tests that ran, in the
 *  order they ran). Facts are then dropped from the end until the array's
 *  own `JSON.stringify` fits within `capBytes`. No note, no worker text, no
 *  board reading ever reaches this function. */
export function observedFacts ({ clauses, proofRuns, proofRunClauses, runLines, tests, capBytes }) {
  const literals = literalsOf(clauses)
  const out = []
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
  for (const t of (tests || [])) {
    out.push({ kind: 'test', path: t.path, exit: t.exit })
  }
  while (out.length && Buffer.byteLength(JSON.stringify(out), 'utf8') > capBytes) {
    out.pop()
  }
  return out
}

/** The per-clause facts `readLanding` is asked over — one entry per clause,
 *  index `i` for `M<i+1>`: `runs` is, in proof-line order, one `{ cmd, exit }`
 *  per line whose `proofRunClauses` entry cites that clause — the same
 *  `cmd`/`exit` read `observedFacts` makes; `tests` is the entries of `tests`
 *  (the selected tests that ran) whose path is named under that clause's key
 *  in `covers` (the `{ M1: [paths], ... }` map `measure`'s selection round
 *  built), each `{ path, exit }`. */
export function clauseFacts ({ clauses, proofRuns, proofRunClauses, runLines, tests, covers }) {
  const n = (clauses || []).length
  const lines = proofRuns || []
  const testsByPath = new Map((tests || []).map((t) => [t.path, t]))
  const coversMap = covers || {}
  const out = []
  for (let i = 0; i < n; i += 1) {
    const key = 'M' + (i + 1)
    const runs = []
    for (let k = 0; k < lines.length; k += 1) {
      const cites = (proofRunClauses || [])[k]
      if (Array.isArray(cites) && cites.includes(key)) {
        const rl = (runLines || [])[k]
        const cmd = rl ? rl.cmd : lines[k]
        const exit = rl ? rl.exit : undefined
        runs.push({ cmd, exit })
      }
    }
    const clauseTests = (Array.isArray(coversMap[key]) ? coversMap[key] : []).map((p) => {
      const t = testsByPath.get(p)
      return { path: p, exit: t ? t.exit : undefined }
    })
    out.push({ runs, tests: clauseTests })
  }
  return out
}

export default { settledCoverage, observedFacts, clauseFacts }
