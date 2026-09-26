// PROTOTYPE (map #1292, ticket 4). An Edit call, replayed into the weave as line spans.
//
// editSpans(before, old, neu, all) -> [{ vstart, vend, lines }], last span first, each in
// `before`'s visible line numbers, so applying them in order to the weave's copy of
// `before` yields the text the Edit tool wrote.
//
// Ticket 4 follow-up: a replace-all whose matches share a line. Each match used to become
// its own span covering the whole line, rebuilt from `before` with only that one match
// replaced, so the earlier match's span put the later match's old text back. Matches whose
// lines touch are now one group and one span, rebuilt with every match in it replaced.
// Pinned by readings/replace_all_check.mjs.
export function editSpans (before, old, neu, all) {
  const idxs = []
  let i = before.indexOf(old)
  while (i >= 0) { idxs.push(i); if (!all) break; i = before.indexOf(old, i + old.length) }
  const lineEndAt = (k) => { const e = before.indexOf('\n', k); return e < 0 ? before.length : e }
  const groups = []
  for (const idx of idxs) {
    const g = groups[groups.length - 1]
    if (g && idx <= lineEndAt(g[g.length - 1] + old.length)) g.push(idx); else groups.push([idx])
  }
  return groups.reverse().map((g) => g.length === 1 ? one(before, old, neu, g[0]) : many(before, old, neu, g, lineEndAt))
}

function trim (ls, oldLines, newLines) {
  let h = 0
  while (h < oldLines.length && h < newLines.length && oldLines[h] === newLines[h]) h++
  let t = 0
  while (t < oldLines.length - h && t < newLines.length - h && oldLines[oldLines.length - 1 - t] === newLines[newLines.length - 1 - t]) t++
  return { vstart: ls + h, vend: ls + oldLines.length - t, lines: newLines.slice(h, newLines.length - t) }
}

// one match: unchanged from the first pass
function one (before, old, neu, idx) {
  const endc = idx + old.length
  const ls = before.slice(0, idx).split('\n').length - 1
  const lineStart = before.lastIndexOf('\n', idx - 1) + 1
  let lineEnd = before.indexOf('\n', endc); if (lineEnd < 0) lineEnd = before.length
  const prefix = before.slice(lineStart, idx)
  let oldLines, newLines
  if (old.endsWith('\n') && (neu.endsWith('\n') || (neu === '' && prefix === ''))) {
    oldLines = before.slice(lineStart, endc).split('\n'); oldLines.pop()
    const s = prefix + neu
    newLines = s === '' ? [] : s.split('\n'); if (s.endsWith('\n')) newLines.pop()
  } else {
    oldLines = before.slice(lineStart, lineEnd).split('\n')
    newLines = (prefix + neu + before.slice(endc, lineEnd)).split('\n')
  }
  return trim(ls, oldLines, newLines)
}

// several matches whose lines touch: one span over their whole lines, every match replaced
function many (before, old, neu, g, lineEndAt) {
  const lineStart = before.lastIndexOf('\n', g[0] - 1) + 1
  const regionEnd = lineEndAt(g[g.length - 1] + old.length)
  const ls = before.slice(0, lineStart).split('\n').length - 1
  let s = '', at = lineStart
  for (const idx of g) { s += before.slice(at, idx) + neu; at = idx + old.length }
  s += before.slice(at, regionEnd)
  return trim(ls, before.slice(lineStart, regionEnd).split('\n'), s.split('\n'))
}
