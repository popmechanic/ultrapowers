// A run's provenance (#1404): what no other source holds. Git has the text and the plan has each
// task's Files and Claim, so neither is copied; this names which task wrote every changed line of
// the landed snapshot, the surprises, and the changed code no probe ran.
//
// buildProvenance({ landed, blame, events, lost, coverage }) is pure:
//   landed    {path: text} of the landed snapshot
//   blame     the weave's `blame` map: {path: [label per landed line]}: `base`, a task label `A.2`,
//             labels joined `|` when several wrote identical text, or a label with no dot (no task)
//   events    events.jsonl rows
//   lost      the snapshot's `survival` list [{path, author, by, lines}]
//   coverage  {clause: {path: [lines]}} or null
// answers { hunks, exceptions, unproven }.

const CODE = /\.(py|mjs|js|cjs)$/
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

export function buildProvenance ({ landed, blame, events = [], lost = [], coverage = null }) {
  const paths = Object.keys(landed || {}).filter((p) => blame && Array.isArray(blame[p])).sort(cmp)
  const linesOf = (p) => String(landed[p] ?? '').split('\n')
  const covered = (p, n) => Object.keys(coverage || {}).filter((c) => (coverage[c][p] || []).includes(n)).sort(cmp)
  const hunks = [], foreign = [], unproven = coverage ? [] : null
  for (const p of paths) {
    const labels = blame[p]
    const tasks = labels.map((l) => (l === 'base' ? undefined : taskOf(l)))
    for (const r of runs(tasks.map((t) => (t === null ? undefined : t)))) {
      const h = { path: p, lines: span(r.from, r.to), task: r.key }
      if (coverage) {
        const cl = new Set()
        for (let n = r.from; n <= r.to; n++) for (const c of covered(p, n)) cl.add(c)
        h.clauses = [...cl].sort(cmp)
      }
      hunks.push(h)
    }
    for (const r of runs(tasks.map((t) => (t === null ? true : undefined)))) foreign.push({ kind: 'foreign', path: p, lines: span(r.from, r.to) })
    if (coverage && CODE.test(p)) {
      const bare = tasks.map((t, i) => (t != null && !covered(p, i + 1).length ? t : undefined))
      for (const r of runs(bare)) unproven.push({ path: p, lines: span(r.from, r.to), task: r.key })
    }
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
  return { hunks, exceptions: [...contested, ...lostRows, ...ordered, ...foreign], unproven }
}

// remapProvenance(prov, texts) is pure: texts {path: {from, to}} gives a path's text in the run's
// commit and in the caught-up commit. Every line span of such a path (in hunks, unproven, and the
// exceptions' `lines` span or `line`) is carried line by line through the longest common subsequence
// of the two texts' lines; a line with no match drops, and each mapped set is cut back into runs of
// consecutive lines (an entry whose lines all drop disappears). Other paths and keys are kept.
const SPAN = /^\d+(-\d+)?$/

// old line (1-based) -> new line (1-based), for the lines the LCS keeps
function lineMap (from, to) {
  const a = String(from).split('\n'), b = String(to).split('\n')
  const map = new Map()
  let s = 0
  while (s < a.length && s < b.length && a[s] === b[s]) { map.set(s + 1, s + 1); s++ }
  let ea = a.length, eb = b.length
  while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) { ea--; eb--; map.set(ea + 1, eb + 1) }
  const n = ea - s, m = eb - s
  const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) L[i][j] = a[s + i] === b[s + j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1])
  }
  for (let i = 0, j = 0; i < n && j < m;) {
    if (a[s + i] === b[s + j]) { map.set(s + i + 1, s + j + 1); i++; j++ } else if (L[i + 1][j] >= L[i][j + 1]) i++
    else j++
  }
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
  return { ...prov, hunks: remap(prov.hunks), exceptions: remap(prov.exceptions), unproven: remap(prov.unproven) }
}
