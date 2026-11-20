// Every story step's receipt: what the step changed in the store, kept for
// green and red steps alike. Pure: one small row per checker result, in clause
// order, the diff cut to its first 50 entries. A result with no `diff` (the step
// stopped before the checker read the store, as at its `do` stage) keeps its row
// with `diff: null`, so a checked step never goes missing from the PR (#1491).
import fs from 'node:fs'
import path from 'node:path'

const MAX_DIFF = 50

// One checker result per clause in a checks/ folder, keyed by clause: the edge's own
// (`<clause>@edge.json`) when it wrote one, else the newest by mtime across every copy.
export function latestResults (dir) {
  const by = new Map()
  if (!fs.existsSync(dir)) return by
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const p = path.join(dir, f)
    let r
    try { r = JSON.parse(fs.readFileSync(p, 'utf8')) } catch { continue }
    if (!r || typeof r.clause !== 'string') continue
    const m = fs.statSync(p).mtimeMs
    const edge = f.endsWith('@edge.json')
    const prev = by.get(r.clause)
    if (!prev || (edge && !prev.edge) || (edge === prev.edge && prev.m < m)) by.set(r.clause, { m, r, edge })
  }
  return new Map([...by].map(([k, v]) => [k, v.r]))
}


export function stepReceipts (results) {
  return [...(results || [])]
    .filter((r) => r && typeof r.clause === 'string')
    .map((r) => ({
      clause: r.clause,
      exit: r.exit,
      stage: r.stage,
      diff: Array.isArray(r.diff) ? r.diff.slice(0, MAX_DIFF) : null,
      truncated: Array.isArray(r.diff) && r.diff.length > MAX_DIFF
    }))
    .sort((a, b) => (a.clause < b.clause ? -1 : a.clause > b.clause ? 1 : 0))
}
