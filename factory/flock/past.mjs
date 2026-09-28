// A failed run's record as at most ten short items, in the order a fixer needs them.
//
// pastItems({ status, events, redChecks }) -> null when the run is done, else
// [{ kind, text, task?, about? }]: why it stopped, each red check, each agent belief
// (the host's own left out), then each stall. Pure: no I/O. `redChecks` may be null.
const MAX_TEXT = 300
const MAX_ITEMS = 10

const cut = (s) => String(s).slice(0, MAX_TEXT)

export function pastItems ({ status, events = [], redChecks = null } = {}) {
  if (status?.state === 'done') return null
  const rows = events || []
  const items = []
  const terminal = rows.filter((e) => e.kind === 'terminal').pop()
  items.push({ kind: 'stopped', text: cut(terminal ? `${terminal.pr}: ${terminal.why}` : `${status?.state}: ${status?.phase}`) })
  for (const r of redChecks?.red || []) {
    items.push({ kind: 'red-check', task: r.task, text: cut(`${r.cmd} exited ${r.exit}: ${r.tail}`) })
  }
  for (const b of rows.filter((e) => e.kind === 'belief' && e.by !== 'host')) {
    const head = `${b.by} (${b.confidence})`
    const text = b.about ? `${head} about the ${b.about}: ${b.claim}` : `${head}: ${b.claim}`
    items.push({ kind: 'belief', about: b.about, text: cut(text) })
  }
  for (const s of rows.filter((e) => typeof e.kind === 'string' && e.kind.startsWith('stall:'))) {
    const evidence = s.evidence ? ` ${JSON.stringify(s.evidence)}` : ''
    items.push({ kind: 'stall', text: cut(`${s.kind.slice('stall:'.length)}${evidence}`) })
  }
  return items.slice(0, MAX_ITEMS)
}
