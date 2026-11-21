export function scopeOf ({ changed = [], files = [], written = [] }) {
  const inFiles = new Set(files)
  const wrote = new Set(written)
  const outside = new Set()
  const amended = new Set()
  for (const p of changed) {
    if (inFiles.has(p)) continue
    ;(wrote.has(p) ? amended : outside).add(p)
  }
  return { outside: [...outside].sort(), amended: [...amended].sort() }
}
