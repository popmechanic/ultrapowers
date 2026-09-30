// The Flock's board (map #1292): the in-memory board the engine (factory/flock/engine.mjs) uses —
// Kata's verbs (ready, claim, release, park, done, reopen, post_belief, board_read, add task), no
// Kata. kata_mirror.mjs mirrors its moves onto the hub when the boot passes a record.

// Each claimer starts its walk of the ready list at its own offset, so N claimers
// do not all race for the first row.
const rotate = (xs, who) => {
  if (!xs.length) return xs
  const k = [...String(who)].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) % xs.length
  return [...xs.slice(k), ...xs.slice(0, k)]
}

// The final atlas race: each task's remaining chain, the longest run of dependent tasks from it to
// the end, itself included (atlas: 1, 4 and 10 head chains of 3). A task added later (a resolve or
// check task) has no consumers and counts 1.
export function chainLengths (tasks) {
  const consumers = new Map(tasks.map((t) => [t.id, []]))
  for (const t of tasks) for (const d of t.depends_on) consumers.get(d).push(t.id)
  const cp = new Map()
  const walk = (id) => {
    if (!cp.has(id)) cp.set(id, 1 + Math.max(0, ...consumers.get(id).map(walk)))
    return cp.get(id)
  }
  for (const t of tasks) walk(t.id)
  return cp
}

export class Board {
  constructor ({ tasks, now }) {
    this.now = now
    this.tasks = new Map(tasks.map((t) => [t.id, { ...t, state: 'ready', owner: null, notes: [], reopen: 0 }]))
    this.beliefs = []
    // the ready set is offered longest remaining chain first, each claimer's own rotation kept only among equals
    this.cp = chainLengths(tasks)
  }

  offer (list, who) {
    const len = (x) => this.cp.get(x.id) || 1
    return rotate(list, who).map((x, i) => [x, i]).sort((a, b) => len(b[0]) - len(a[0]) || a[1] - b[1]).map(([x]) => x)
  }

  allDone () { return [...this.tasks.values()].every((t) => t.state === 'done') }
  // the host's own view of what is claimable, for the settle rule
  readyNow () { return [...this.tasks.values()].filter((t) => t.state === 'ready' && t.depends_on.every((d) => this.tasks.get(d).state === 'done')) }

  async claim (agent) {
    for (const t of this.offer(this.readyNow(), agent)) {
      if (t.state !== 'ready') continue
      t.state = 'claimed'; t.owner = agent
      return t
    }
    return null
  }
  async release (t, why) { t.state = 'ready'; t.owner = null; t.notes.push(why) }
  reopen (t, why) { return this.release(t, why) }
  async park (t, why) { t.state = 'parked'; t.owner = null; t.notes.push(why) }
  async done (t) { t.state = 'done' }
  async post (b) { const x = { id: this.beliefs.length + 1, t: this.now(), ...b }; this.beliefs.push(x); return x }
  async read () {
    return {
      tasks: [...this.tasks.values()].map((t) => ({ id: t.id, title: t.title, state: t.state, owner: t.owner, depends_on: t.depends_on, notes: t.notes.slice(-2) })),
      beliefs: this.beliefs.slice(-15),
    }
  }
  async addTask (t) { this.tasks.set(t.id, t) }
}
