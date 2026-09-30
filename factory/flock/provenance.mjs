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
    const text = linesOf(w.path)
    if (!w.after.every((l) => text.includes(l))) continue
    const line = text.findIndex((l) => w.after.includes(l)) + 1
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
