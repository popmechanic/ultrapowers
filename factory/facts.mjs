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

/** #1210: which clause(s) a line of exam text cites, and which of those
 *  lines "count" as evidence. A line's OWN citations are every `M<digits>`
 *  token found inside any `[...]` span of the line — `[M1]`, `[M2, M3]`,
 *  `(a) [M1] …` all cite; a line with none inherits the most recent line
 *  above it that had its own (none before the first citing line). A line
 *  COUNTS when its trimmed text opens one of the assertion-shaped prefixes,
 *  or opens `//`/`#` and has its own citations (a section heading). Answers
 *  `{ M1: '', …, M<n>: '' }` for `n = clauses.length`, each key its counting
 *  lines, trimmed, joined by `\n` — a citation past `n` attributes nothing. */
export function examAssertions ({ text, clauses }) {
  const n = (clauses || []).length
  const keys = []
  const collected = {}
  for (let i = 1; i <= n; i += 1) {
    const key = 'M' + i
    keys.push(key)
    collected[key] = []
  }
  const countPrefixes = [
    'assert', 'await assert', 'expect(', 'self.assert', 'with pytest.raises',
    'def test_', 'test(', 'it(', 'describe(',
  ]
  const bracketRe = /\[[^\]]*\]/g
  const mTokenRe = /\bM\d+\b/g
  let lastCites = []
  const lines = String(text).split('\n')
  for (const rawLine of lines) {
    const trimmed = rawLine.trim()
    const ownCites = []
    let bm
    bracketRe.lastIndex = 0
    while ((bm = bracketRe.exec(rawLine))) {
      const span = bm[0]
      let mm
      mTokenRe.lastIndex = 0
      while ((mm = mTokenRe.exec(span))) ownCites.push(mm[0])
    }
    const cites = ownCites.length ? ownCites : lastCites
    if (ownCites.length) lastCites = ownCites
    const isHeading = (trimmed.startsWith('//') || trimmed.startsWith('#')) && ownCites.length > 0
    const counts = countPrefixes.some((p) => trimmed.startsWith(p)) || isHeading
    if (!counts) continue
    for (const c of cites) {
      if (Object.prototype.hasOwnProperty.call(collected, c)) collected[c].push(trimmed)
    }
  }
  const out = {}
  for (const key of keys) out[key] = collected[key].join('\n')
  return out
}

/** #1210: the per-clause facts `readLanding` is asked over — one entry per
 *  clause, index `i` for `M<i+1>`: `exam` is `{ exit: examExit, text }` off
 *  `examAsserts` when `hasExam === true`, else exactly `null`; `runs` is,
 *  in proof-line order, one `{ cmd, exit }` per line whose `proofRunClauses`
 *  entry cites that clause — the same `cmd`/`exit` read `observedFacts`
 *  makes. Then, while the summed `exam.text.length` exceeds `capChars`
 *  (a character count, not a byte one), the entry with the longest `text`
 *  (lowest index on a tie) loses its last line, repeated until it fits. */
export function clauseFacts ({ clauses, examAsserts, hasExam, examExit, proofRuns, proofRunClauses, runLines, capChars }) {
  const n = (clauses || []).length
  const asserts = examAsserts || {}
  const lines = proofRuns || []
  const out = []
  for (let i = 0; i < n; i += 1) {
    const key = 'M' + (i + 1)
    const exam = hasExam === true ? { exit: examExit, text: asserts[key] || '' } : null
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
    out.push({ exam, runs })
  }
  const totalLen = () => out.reduce((s, e) => s + (e.exam ? e.exam.text.length : 0), 0)
  while (totalLen() > capChars) {
    let longestIdx = 0
    let longestLen = out[0] && out[0].exam ? out[0].exam.text.length : -1
    for (let i = 1; i < out.length; i += 1) {
      const len = out[i].exam ? out[i].exam.text.length : -1
      if (len > longestLen) { longestLen = len; longestIdx = i }
    }
    if (longestLen <= 0) break
    const e = out[longestIdx].exam
    const idx = e.text.lastIndexOf('\n')
    e.text = idx === -1 ? '' : e.text.slice(0, idx)
  }
  return out
}

export default { settledCoverage, observedFacts, examAssertions, clauseFacts }
