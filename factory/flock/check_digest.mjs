// The run's checks/ folder as one small row per result file (#1491), so a step whose receipt or Jev
// reading is missing can be read off the record instead of guessed at. Pure but for reading `dir`:
// file-name order; a row names the file, the copy that wrote it (the name's text after its last `@`)
// and when, and never carries the result's diff or stores. A file that is not JSON is `unreadable`.
import fs from 'node:fs'
import path from 'node:path'

export function checkDigest (dir) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((file) => {
    const p = path.join(dir, file)
    const head = { file, copy: file.slice(file.lastIndexOf('@') + 1, -'.json'.length), mtime: new Date(fs.statSync(p).mtimeMs).toISOString() }
    let r
    try { r = JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return { ...head, unreadable: true } }
    if (!r || typeof r !== 'object') return { ...head, unreadable: true }
    return { ...head, clause: r.clause, exit: r.exit, stage: r.stage, diff: Array.isArray(r.diff) }
  })
}
