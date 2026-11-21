import fs from 'node:fs'
import path from 'node:path'

export function checkDigest (dir) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((file) => {
    const p = path.join(dir, file)
    const head = { file, copy: file.includes('@') ? file.slice(file.lastIndexOf('@') + 1, -'.json'.length) : null, mtime: new Date(fs.statSync(p).mtimeMs).toISOString() }
    let r
    try { r = JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return { ...head, unreadable: true } }
    if (!r || typeof r !== 'object') return { ...head, unreadable: true }
    return { ...head, clause: r.clause, exit: r.exit, stage: r.stage, diff: Array.isArray(r.diff) }
  })
}
