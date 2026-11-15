// Every story step's receipt: what the step changed in the store, kept for
// green and red steps alike. Pure: one small row per checker result that
// carries a `diff`, in clause order, the diff cut to its first 50 entries.
import fs from 'node:fs'
import path from 'node:path'

const MAX_DIFF = 50

// The newest checker result per clause in a checks/ folder (by mtime), keyed by clause.
export function latestResults (dir) {
  const by = new Map()
  if (!fs.existsSync(dir)) return by
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const p = path.join(dir, f)
    let r
    try { r = JSON.parse(fs.readFileSync(p, 'utf8')) } catch { continue }
    if (!r || typeof r.clause !== 'string') continue
    const m = fs.statSync(p).mtimeMs
    const prev = by.get(r.clause)
    if (!prev || prev.m < m) by.set(r.clause, { m, r })
  }
  return new Map([...by].map(([k, v]) => [k, v.r]))
}


export function stepReceipts (results) {
  return [...(results || [])]
    .filter((r) => r && typeof r.clause === 'string' && Array.isArray(r.diff))
    .map((r) => ({
      clause: r.clause,
      exit: r.exit,
      stage: r.stage,
      diff: r.diff.slice(0, MAX_DIFF),
      truncated: r.diff.length > MAX_DIFF
    }))
    .sort((a, b) => (a.clause < b.clause ? -1 : a.clause > b.clause ? 1 : 0))
}
