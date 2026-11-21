import fs from 'node:fs'
import path from 'node:path'

const MAX_DIFF = 50

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
