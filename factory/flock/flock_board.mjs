// The Flock's board (map #1292): the in-memory stand-in the engine (factory/flock/engine.mjs)
// uses — Kata's verbs (ready, claim, release, park, done, reopen, post_belief, board_read, publish,
// add task), no Kata. Every op is timed (wall, µs).

// Each claimer starts its walk of the ready list at its own offset, so N claimers
// do not all race for the first row.
const rotate = (xs, who) => {
  if (!xs.length) return xs
  const k = [...String(who)].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) % xs.length
  return [...xs.slice(k), ...xs.slice(0, k)]
}

export async function makeBoard (kind, opts) {
  return new StandInBoard(opts)
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

class Timed {
  constructor (opts) {
    this.now = opts.now
    this.ops = []
    this.tasks = new Map(opts.tasks.map((t) => [t.id, { ...t, state: 'ready', owner: null, notes: [], reopen: 0 }]))
    this.beliefCount = 0
    // `chain` (the default): the ready set is offered longest remaining chain first, each claimer's
    // own rotation kept only among equals. `rotate` (the rollback): the rotation alone.
    this.orderMode = opts.order || 'chain'
    this.cp = this.orderMode === 'chain' ? chainLengths(opts.tasks) : null
  }

  offer (list, who, idOf = (t) => t.id) {
    const r = rotate(list, who)
    if (!this.cp) return r
    const len = (x) => this.cp.get(idOf(x)) || 1
    return r.map((x, i) => [x, i]).sort((a, b) => len(b[0]) - len(a[0]) || a[1] - b[1]).map(([x]) => x)
  }

  async op (name, fn) {
    const t = process.hrtime.bigint()
    try { return await fn() } finally { this.ops.push({ name, us: Number(process.hrtime.bigint() - t) / 1000, t: this.now() }) }
  }

  allDone () { return [...this.tasks.values()].every((t) => t.state === 'done') }
  // the host's own view of what is claimable (the mirror its writes keep), for the settle rule
  readyNow () { return [...this.tasks.values()].filter((t) => t.state === 'ready' && t.depends_on.every((d) => this.tasks.get(d).state === 'done')) }
}

// ── the stand-in (first pass, unchanged in behaviour) ─────────────────────────
class StandInBoard extends Timed {
  constructor (opts) { super(opts); this.kind = 'standin'; this.beliefs = [] }
  async claim (agent) {
    const list = await this.op('ready', () => this.readyNow())
    for (const t of this.offer(list, agent)) {
      const won = await this.op('claim', () => { if (t.state !== 'ready') return null; t.state = 'claimed'; t.owner = agent; return t })
      if (won) return won
      this.ops.push({ name: 'claim:lost', us: 0, t: this.now() })
    }
    return null
  }
  release (t, why) { return this.op('release', () => { t.state = 'ready'; t.owner = null; t.notes.push(why) }) }
  reopen (t, why) { return this.release(t, why) }
  park (t, why) { return this.op('park', () => { t.state = 'parked'; t.owner = null; t.notes.push(why) }) }
  done (t) { return this.op('done', () => { t.state = 'done' }) }
  publish () { return this.op('publish', () => null) }
  post (b) { return this.op('post', () => { const x = { id: this.beliefs.length + 1, t: this.now(), ...b }; this.beliefs.push(x); this.beliefCount += 1; return x }) }
  read () {
    return this.op('read', () => ({
      tasks: [...this.tasks.values()].map((t) => ({ id: t.id, title: t.title, state: t.state, owner: t.owner, depends_on: t.depends_on, notes: t.notes.slice(-2) })),
      beliefs: this.beliefs.slice(-15),
    }))
  }
  addTask (t) { return this.op('add', () => { this.tasks.set(t.id, t) }) }
  close () {}
}

