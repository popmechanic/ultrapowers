// A run's provenance (#1404): what no other source holds. Git has the text and the plan has each
// task's Files and Claim, so neither is copied; this names which task wrote every changed line of
// the landed snapshot and the surprises. (The coverage pass that named the changed code no probe
// ran was retired unread, #1442.)
//
// buildProvenance({ landed, blame, events, lost }) is pure:
//   landed    {path: text} of the landed snapshot
//   blame     the weave's `blame` map: {path: [label per landed line]}: `base`, a task label `A.2`,
//             labels joined `|` when several wrote identical text, or a label with no dot (no task)
//   events    events.jsonl rows
//   lost      the snapshot's `survival` list [{path, author, by, lines}]
// answers { hunks, exceptions }. The final empty line of a text ending in a newline is not a hunk line.

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// a label's task: the text after its dot; several labels give their tasks joined `|` in label
// order; `base` or any label with no dot answers null
function taskOf (label) {
  const parts = String(label).split('|')
  if (parts.some((l) => l.indexOf('.') < 0)) return null
  return parts.map((l) => l.slice(l.indexOf('.') + 1)).join('|')
}

const span = (a, b) => (a === b ? String(a) : `${a}-${b}`)

// runs of consecutive lines (1-based) whose key is equal and not undefined, in line order
function runs (keys) {
  const out = []
  let cur = null
  keys.forEach((k, i) => {
    const n = i + 1
    if (k !== undefined && cur && cur.key === k && cur.to === n - 1) cur.to = n
    else if (k !== undefined) out.push(cur = { key: k, from: n, to: n })
    else cur = null
  })
  return out
}

export function buildProvenance ({ landed, blame, events = [], lost = [] }) {
  const paths = Object.keys(landed || {}).filter((p) => blame && Array.isArray(blame[p])).sort(cmp)
  const linesOf = (p) => String(landed[p] ?? '').split('\n')
  const hunks = [], foreign = []
  for (const p of paths) {
    const labels = blame[p]
    const text = linesOf(p)
    const tail = String(landed[p] ?? '').endsWith('\n') ? text.length - 1 : -1
    const tasks = labels.map((l, i) => (l === 'base' || i === tail ? undefined : taskOf(l)))
    for (const r of runs(tasks.map((t) => (t === null ? undefined : t)))) hunks.push({ path: p, lines: span(r.from, r.to), task: r.key })
    for (const r of runs(tasks.map((t) => (t === null ? true : undefined)))) foreign.push({ kind: 'foreign', path: p, lines: span(r.from, r.to) })
  }

  const rows = events || []
  const contested = []
  for (const w of rows.filter((e) => e.kind === 'peer:rewrite')) {
    if (!(w.path in (landed || {})) || !Array.isArray(w.after) || !w.after.length) continue
    // only the writer's own lines count: a rewrite landed when every `after` line is among them
    const text = linesOf(w.path), labels = blame[w.path] || [], own = `${w.agent}.${w.task}`
    const mine = text.map((l, i) => (String(labels[i] ?? '').split('|').includes(own) ? l : undefined))
    if (!w.after.every((l) => mine.includes(l))) continue
    const line = mine.findIndex((l) => l !== undefined && w.after.includes(l)) + 1
    const read = rows.find((e) => e.kind === 'jev:peer-rewrite' && e.path === w.path && same(e.after, w.after))
    contested.push({ kind: 'contested', path: w.path, line, wrote: w.task ?? null, over: (w.peers || []).map((l) => taskOf(l) ?? l).join('|'), jev: read ? (read.answer ?? null) : null })
  }
  contested.sort((a, b) => cmp(a.path, b.path) || a.line - b.line)
  const lostRows = (lost || []).map((e) => ({ kind: 'lost', path: e.path, author: e.author, by: e.by, lines: e.lines }))
    .sort((a, b) => cmp(a.path, b.path))
  const ordered = []
  for (const s of rows.filter((e) => e.kind === 'same-anchor')) {
    if (!(s.path in (landed || {})) || !Array.isArray(s.lines)) continue
    const text = linesOf(s.path)
    if (!s.lines.every((l) => text.includes(l))) continue
    ordered.push({ kind: 'ordered', path: s.path, anchor: s.anchor, lines: s.lines, at: s.lines.length ? text.indexOf(s.lines[0]) : -1 })
  }
  ordered.sort((a, b) => cmp(a.path, b.path) || a.at - b.at)
  for (const o of ordered) delete o.at
  return { hunks, exceptions: [...contested, ...lostRows, ...ordered, ...foreign] }
}

// remapProvenance(prov, texts) is pure: texts {path: {from, to}} gives a path's text in the run's
// commit and in the caught-up commit. Every line span of such a path (in hunks and the
// exceptions' `lines` span or `line`) is carried line by line through the longest common subsequence
// of the two texts' lines; a line with no match drops, and each mapped set is cut back into runs of
// consecutive lines (an entry whose lines all drop disappears). A side may be null for a file absent
// there: with `to` null every entry of that path drops. Other paths and keys are kept.
const SPAN = /^\d+(-\d+)?$/

// old line (1-based) -> new line (1-based), for the lines a longest common subsequence keeps; a
// null side (the file is absent there) keeps none. Myers' diff with its middle snake, so memory
// stays linear in the two lengths and time is O((n+m)·D).
function lineMap (from, to) {
  const map = new Map()
  if (from === null || from === undefined || to === null || to === undefined) return map
  const ids = new Map()
  const id = (l) => { let v = ids.get(l); if (v === undefined) ids.set(l, v = ids.size); return v }
  const a = Int32Array.from(String(from).split('\n'), id), b = Int32Array.from(String(to).split('\n'), id)
  const match = (a0, a1, b0, b1) => {
    while (a0 < a1 && b0 < b1 && a[a0] === b[b0]) { map.set(a0 + 1, b0 + 1); a0++; b0++ }
    while (a1 > a0 && b1 > b0 && a[a1 - 1] === b[b1 - 1]) { a1--; b1--; map.set(a1 + 1, b1 + 1) }
    if (a0 === a1 || b0 === b1) return
    const [x0, y0, x1, y1] = middleSnake(a0, a1, b0, b1)
    match(a0, a0 + x0, b0, b0 + y0)
    for (let x = x0, y = y0; x < x1; x++, y++) map.set(a0 + x + 1, b0 + y + 1)
    match(a0 + x1, a1, b0 + y1, b1)
  }
  // the snake (start and end, relative to a0 and b0) a shortest edit path crosses halfway
  const middleSnake = (a0, a1, b0, b1) => {
    const N = a1 - a0, M = b1 - b0, delta = N - M, odd = (delta & 1) !== 0
    const max = Math.ceil((N + M) / 2), off = max + 1
    const vf = new Int32Array(2 * max + 3), vb = new Int32Array(2 * max + 3)
    for (let d = 0; d <= max; d++) {
      for (let k = -d; k <= d; k += 2) {
        let x = (k === -d || (k !== d && vf[off + k - 1] < vf[off + k + 1])) ? vf[off + k + 1] : vf[off + k - 1] + 1
        let y = x - k
        const xs = x, ys = y
        while (x < N && y < M && a[a0 + x] === b[b0 + y]) { x++; y++ }
        vf[off + k] = x
        const kb = delta - k
        if (odd && kb >= -(d - 1) && kb <= d - 1 && x + vb[off + kb] >= N) return [xs, ys, x, y]
      }
      for (let k = -d; k <= d; k += 2) {
        let x = (k === -d || (k !== d && vb[off + k - 1] < vb[off + k + 1])) ? vb[off + k + 1] : vb[off + k - 1] + 1
        let y = x - k
        const xs = x, ys = y
        while (x < N && y < M && a[a1 - 1 - x] === b[b1 - 1 - y]) { x++; y++ }
        vb[off + k] = x
        const kf = delta - k
        if (!odd && kf >= -d && kf <= d && x + vf[off + kf] >= N) return [N - x, M - y, N - xs, M - ys]
      }
    }
    throw new Error('no middle snake')
  }
  match(0, a.length, 0, b.length)
  return map
}

// a span through the map, as the spans of its surviving lines' runs
function mapSpan (text, map) {
  const [x, y] = String(text).split('-').map(Number)
  const got = []
  for (let n = x; n <= (y ?? x); n++) if (map.has(n)) got.push(map.get(n))
  got.sort((p, q) => p - q)
  const out = []
  for (const n of got) {
    const last = out[out.length - 1]
    if (last && n === last[1] + 1) last[1] = n
    else if (!last || n !== last[1]) out.push([n, n])
  }
  return out.map(([p, q]) => span(p, q))
}

export function remapProvenance (prov, texts) {
  const maps = new Map(Object.entries(texts || {}).map(([p, t]) => [p, lineMap(t.from, t.to)]))
  const remap = (list) => {
    if (!Array.isArray(list)) return list
    const out = []
    for (const e of list) {
      const map = e && maps.get(e.path)
      if (!map) out.push(e)
      else if (typeof e.lines === 'string' && SPAN.test(e.lines)) for (const s of mapSpan(e.lines, map)) out.push({ ...e, lines: s })
      else if (Number.isInteger(e.line)) { if (map.has(e.line)) out.push({ ...e, line: map.get(e.line) }) } else out.push(e)
    }
    return out
  }
  return { ...prov, hunks: remap(prov.hunks), exceptions: remap(prov.exceptions) }
}
