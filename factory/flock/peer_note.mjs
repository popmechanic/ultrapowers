// A builder about to edit a file is told which of its lines its peers wrote, and which task
// wrote them. authors: the weave's authors_keyed answer, one entry per visible line: 'base',
// one agent letter, or several joined by '|' (written identically by more than one agent).

const runsOf = (lines) => {
  const runs = []
  for (const n of lines) {
    const last = runs[runs.length - 1]
    if (last && last[1] === n - 1) last[1] = n
    else runs.push([n, n])
  }
  return runs.map(([a, b]) => a === b ? String(a) : `${a}-${b}`)
}
const joinAnd = (xs) => xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]

export function peerNote ({ path, authors, agent, tasks = {} }) {
  const byOwner = new Map()
  authors.forEach((who, i) => {
    if (who === 'base' || who.split('|').includes(agent)) return
    if (!byOwner.has(who)) byOwner.set(who, [])
    byOwner.get(who).push(i + 1)
  })
  if (!byOwner.size) return null
  const clauses = [...byOwner].map(([who, lines]) => {
    const t = who.includes('|') ? null : tasks[who]
    const head = lines.length === 1 ? `line ${lines[0]} was` : `lines ${joinAnd(runsOf(lines))} were`
    return `${head} written by ${who}${t ? ` (task ${t.id}: ${t.title})` : ''}`
  })
  return `In ${path}, ${clauses.join('; ')}; keep what they changed when you edit them.`
}
