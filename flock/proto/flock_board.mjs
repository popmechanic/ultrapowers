// PROTOTYPE (map #1292, ticket 4, second pass). The board, two ways, one interface.
//
//   standin  the in-memory board of the first pass (the default): Kata's verbs, no Kata.
//   kata     a real Kata daemon over its REST API (fleet/kata-client.mjs's httpTransport,
//            no Authorization header), one project per run, one issue per task, the
//            producer→consumer edges as `blocks` links, beliefs as comments on one
//            `beliefs` issue. Every op is timed (wall, µs) for gap 7.
//
// Board tool → Kata verb:
//   ready        GET  /projects/<id>/ready?unowned=true   (open, unowned, no open `blocks` predecessor)
//   claim        POST /issues/<uid>/actions/claim {if_unowned:true}   (409 already_claimed = lost race)
//   release      POST /issues/<uid>/actions/unassign {expected_owner} + a comment with the reason
//   done         POST /issues/<uid>/actions/close {reason:done, message ≥ 40 chars, evidence, retry_protocol}
//   reopen       POST /issues/<uid>/actions/reopen + a comment (the edge found the task red)
//   post_belief  POST /issues/<beliefs uid>/comments  (the belief as JSON)
//   read_beliefs GET  /issues/<beliefs uid>  (its comments)
//   board_read   GET  /projects/<id>/issues?limit=1000 + read_beliefs
//   publish      POST /issues/<uid>/comments  ("published <snap>")
//   add task     POST /projects/<id>/issues {force_new:true}  (a resolve task)
import { httpTransport } from '../../fleet/kata-client.mjs'
import { fileURLToPath } from 'node:url'

const API = '/api/v1'

// Each claimer starts its walk of the ready list at its own offset, so N claimers
// do not all race for the first row.
const rotate = (xs, who) => {
  if (!xs.length) return xs
  const k = [...String(who)].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) % xs.length
  return [...xs.slice(k), ...xs.slice(0, k)]
}

export async function makeBoard (kind, opts) {
  if (kind === 'kata') { const b = new KataBoard(opts); await b.init(); return b }
  return new StandInBoard(opts)
}

class Timed {
  constructor (opts) {
    this.now = opts.now
    this.ops = []
    this.tasks = new Map(opts.tasks.map((t) => [t.id, { ...t, state: 'ready', owner: null, notes: [], reopen: 0 }]))
    this.beliefCount = 0
  }

  async op (name, fn) {
    const t = process.hrtime.bigint()
    try { return await fn() } finally { this.ops.push({ name, us: Number(process.hrtime.bigint() - t) / 1000, t: this.now() }) }
  }

  allDone () { return [...this.tasks.values()].every((t) => t.state === 'done') }
}

// ── the stand-in (first pass, unchanged in behaviour) ─────────────────────────
class StandInBoard extends Timed {
  constructor (opts) { super(opts); this.kind = 'standin'; this.beliefs = [] }
  readyNow () { return [...this.tasks.values()].filter((t) => t.state === 'ready' && t.depends_on.every((d) => this.tasks.get(d).state === 'done')) }
  async claim (agent) {
    const list = await this.op('ready', () => this.readyNow())
    for (const t of rotate(list, agent)) {
      const won = await this.op('claim', () => { if (t.state !== 'ready') return null; t.state = 'claimed'; t.owner = agent; return t })
      if (won) return won
      this.ops.push({ name: 'claim:lost', us: 0, t: this.now() })
    }
    return null
  }
  release (t, why) { return this.op('release', () => { t.state = 'ready'; t.owner = null; t.notes.push(why) }) }
  reopen (t, why) { return this.release(t, why) }
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

// ── real Kata ─────────────────────────────────────────────────────────────────
export class KataBoard extends Timed {
  constructor (opts) {
    super(opts)
    this.kind = 'kata'
    this.url = opts.url || 'http://127.0.0.1:7777'
    this.tr = httpTransport({ url: this.url })
    this.runName = opts.runName
    this.actor = 'flock-host'
    this.uid = new Map()   // task id -> issue uid
    this.errors = []
  }

  async req (name, method, p, body, ok = [200, 201]) {
    return this.op(name, async () => {
      const r = await this.tr.request({ method, path: API + p, headers: {}, body })
      if (!ok.includes(r.status)) { const e = new Error(`kata ${method} ${p} answered ${r.status}: ${String(r.body).slice(0, 300)}`); e.status = r.status; e.json = r.json; throw e }
      return r.json
    })
  }

  async init () {
    await this.req('ping', 'GET', '/ping')
    const pj = await this.req('project', 'POST', '/projects', { name: 'flock-' + this.runName, actor: this.actor })
    this.pid = pj.project.id
    const mk = async (title, body, metadata) => (await this.req('create', 'POST', `/projects/${this.pid}/issues`, { title, body, actor: this.actor, metadata, force_new: true })).issue.uid
    for (const t of this.tasks.values()) this.uid.set(t.id, await mk(`task ${t.id}: ${t.title}`, t.body || t.title, { task: t.id }))
    for (const t of this.tasks.values()) {
      for (const d of t.depends_on) await this.req('link', 'POST', `/projects/${this.pid}/issues/${this.uid.get(d)}/links`, { type: 'blocks', to_ref: this.uid.get(t.id), actor: this.actor })
    }
    this.beliefsUid = await mk('beliefs', 'Every belief an agent or the host posts, one comment each.', { beliefs: true })
    this.byUid = new Map([...this.uid.entries()].map(([id, u]) => [u, id]))
  }

  issuePath (id) { return `/projects/${this.pid}/issues/${this.uid.get(id)}` }

  async claim (agent) {
    const ready = await this.req('ready', 'GET', `/projects/${this.pid}/ready?unowned=true`)
    const list = Array.isArray(ready) ? ready : (ready.issues || ready.ready || ready.items || [])
    for (const row of rotate(list, agent)) {
      const id = this.byUid.get(row.uid)
      if (!id) continue
      try {
        await this.req('claim', 'POST', this.issuePath(id) + '/actions/claim', { actor: 'agent-' + agent, if_unowned: true })
      } catch (e) { if (e.status === 409) { this.ops.push({ name: 'claim:lost', us: 0, t: this.now() }); continue } throw e }
      const t = this.tasks.get(id); t.state = 'claimed'; t.owner = agent
      return t
    }
    return null
  }

  async release (t, why) {
    await this.req('unassign', 'POST', this.issuePath(t.id) + '/actions/unassign', { actor: 'agent-' + t.owner, expected_owner: 'agent-' + t.owner })
    await this.req('comment', 'POST', this.issuePath(t.id) + '/comments', { actor: this.actor, body: 'released: ' + why })
    t.state = 'ready'; t.owner = null; t.notes.push(why)
  }

  async reopen (t, why) {
    await this.req('reopen', 'POST', this.issuePath(t.id) + '/actions/reopen', { actor: this.actor })
    await this.req('comment', 'POST', this.issuePath(t.id) + '/comments', { actor: this.actor, body: 'reopened: ' + why })
    t.state = 'ready'; t.owner = null; t.notes.push(why)
  }

  async done (t) {
    const message = `task ${t.id} done by agent ${t.owner}: its facts pass on the agent's copy and the copy is published`
    await this.req('close', 'POST', this.issuePath(t.id) + '/actions/close', { actor: 'agent-' + t.owner, reason: 'done', message, evidence: [{ type: 'test', command: 'flock run_proof task ' + t.id }], retry_protocol: 'close-v1' })
    t.state = 'done'
  }

  async publish (agent, taskId, snap) {
    if (!this.uid.has(taskId)) return
    await this.req('publish', 'POST', this.issuePath(taskId) + '/comments', { actor: 'agent-' + agent, body: 'published ' + (snap || '') })
  }

  async post (b) {
    this.beliefCount += 1
    const x = { id: this.beliefCount, t: this.now(), ...b }
    await this.req('post', 'POST', `/projects/${this.pid}/issues/${this.beliefsUid}/comments`, { actor: b.by === 'host' ? this.actor : 'agent-' + b.by, body: JSON.stringify(x) })
    return x
  }

  async readBeliefs () {
    const j = await this.req('beliefs', 'GET', `/issues/${this.beliefsUid}`)
    const cs = (j && (j.comments || (j.issue && j.issue.comments))) || []
    return cs.map((c) => { try { return JSON.parse(c.body) } catch { return { claim: c.body } } }).slice(-15)
  }

  async read () {
    const j = await this.req('list', 'GET', `/projects/${this.pid}/issues?limit=1000`)
    const rows = Array.isArray(j) ? j : (j.issues || [])
    const tasks = []
    for (const row of rows) {
      const id = this.byUid.get(row.uid)
      if (!id) continue
      const t = this.tasks.get(id)
      tasks.push({ id, title: t.title, state: row.status === 'closed' ? 'done' : row.owner ? 'claimed' : 'ready', owner: row.owner || null, depends_on: t.depends_on, notes: t.notes.slice(-2) })
    }
    return { tasks, beliefs: await this.readBeliefs() }
  }

  async addTask (t) {
    const prev = this.uid.get(t.id)
    if (prev) {
      await this.req('reopen', 'POST', this.issuePath(t.id) + '/actions/reopen', { actor: this.actor }, [200, 201, 409])
    } else {
      const u = (await this.req('create', 'POST', `/projects/${this.pid}/issues`, { title: t.title, body: t.body, actor: this.actor, metadata: { task: t.id }, force_new: true })).issue.uid
      this.uid.set(t.id, u); this.byUid.set(u, t.id)
    }
    this.tasks.set(t.id, t)
  }

  close () {}
}

// ── the 30-client burst (gap 7): `node flock/proto/flock_board.mjs burst --board kata|standin
//    [--clients 30] [--rounds 5] [--kata-url http://127.0.0.1:7777]`. Every client, every round:
//    claim a task (racing the others), post a belief, read the board, publish, close the task. ──
if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2] === 'burst') {
  const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d }
  const clients = Number(arg('clients', 30)); const rounds = Number(arg('rounds', 5))
  const T0 = Date.now(); const now = () => Date.now() - T0
  const tasks = Array.from({ length: clients * rounds }, (_, i) => ({ id: String(i + 1), title: 'burst task ' + (i + 1), depends_on: [], body: 'burst' }))
  const b = await makeBoard(arg('board', 'standin'), { tasks, now, runName: 'burst-' + new Date().toISOString().replace(/[:.]/g, '-'), url: arg('kata-url', 'http://127.0.0.1:7777') })
  const setupOps = b.ops.length
  const t0 = process.hrtime.bigint()
  let lost = 0, got = 0
  await Promise.all(Array.from({ length: clients }, async (_, c) => {
    const agent = 'c' + c
    for (let r = 0; r < rounds; r++) {
      const t = await b.claim(agent)
      if (!t) { lost += 1; continue }
      got += 1
      await b.post({ by: agent, claim: `client ${c} round ${r} holds task ${t.id}`, confidence: 0.5, task: t.id })
      await b.read()
      await b.publish(agent, t.id, 'snap' + r)
      await b.done(t)
    }
  }))
  const secs = Number(process.hrtime.bigint() - t0) / 1e9
  const ops = b.ops.slice(setupOps)
  const g = {}
  for (const o of ops) (g[o.name] = g[o.name] || []).push(o.us)
  const q = (xs, p) => { const s = [...xs].sort((x, y) => x - y); return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]) }
  console.log(JSON.stringify({ board: b.kind, clients, rounds, seconds: Math.round(secs * 100) / 100, ops: ops.length, ops_per_s: Math.round(ops.length / secs), claims_won: got, claim_rounds_empty: lost,
    claims_lost_races: (g['claim:lost'] || []).length, setup_ops: setupOps,
    by_op: Object.fromEntries(Object.entries(g).map(([k, xs]) => [k, { n: xs.length, p50_ms: q(xs, 0.5) / 1000, p90_ms: q(xs, 0.9) / 1000, p99_ms: q(xs, 0.99) / 1000, max_ms: q(xs, 1) / 1000 }])) }, null, 1))
}
