// The scope rule (#1333). A snapshot may change only paths some task's Files names, or
// paths a builder wrote in its copy (an amendment). Pure, no I/O.
//
// scopeOf({ changed, files, written }) -> { outside, amended }, both sorted and deduplicated.
// A changed path in no task's Files goes to `amended` if some builder wrote it, else to
// `outside`; a Flock run refuses to settle while `outside` is non-empty.
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
