#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import util from 'node:util'
import { workloadFromPlan } from './plan.mjs'
import { Board } from './flock_board.mjs'
import { scopeOf } from './scope.mjs'
import { editSpans } from './edit_spans.mjs'
import { compactRecord } from './compact_record.mjs'
import { pullScope } from './pulls.mjs'
import { looseEnds } from './loose_ends.mjs'
import { gitIn, utf8, writeFiles, snapshotEntries, startWeave, readEventRows, POLICY_FLOCK, EXAM_MS } from './io.mjs'
import { pastItems } from './past.mjs'
import { stepReceipts, latestResults } from './step_receipts.mjs'
import { DRAWS, newParts } from './new_parts.mjs'
import { checkDigest } from './check_digest.mjs'
import { peerNote } from './peer_note.mjs'
import { buildProvenance } from './provenance.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d }
const need = (k) => { const v = arg(k); if (!v) { console.error(`engine: --${k} is required`); process.exit(2) } return v }
const PLAN = path.resolve(need('plan'))
const TARGET = path.resolve(need('target'))
const BASE_SHA = need('base')
if (!/^[0-9a-f]{40}$/.test(BASE_SHA)) { console.error('engine: --base must be a 40-hex sha'); process.exit(2) }
const RUN_DIR = path.resolve(need('run-dir'))
const BUILDER = arg('builder', 'sdk')
const SCRIPT = BUILDER.startsWith('scripted:') ? JSON.parse(fs.readFileSync(BUILDER.slice('scripted:'.length), 'utf8')) : null
if (!SCRIPT && BUILDER !== 'sdk') { console.error('engine: --builder is sdk or scripted:<json>'); process.exit(2) }
const { query, createSdkMcpServer, tool } = SCRIPT ? {} : await import('@anthropic-ai/claude-agent-sdk')
const { z } = SCRIPT ? {} : await import('zod')
const W = { name: path.basename(PLAN, '.md'), ...workloadFromPlan(PLAN, arg('plan-json')) }
for (const t of W.tasks) t.id = String(t.id)
for (const t of W.tasks) t.depends_on = t.depends_on.map(String)
const CAP = 16
const MODEL = 'claude-opus-5-5'
const CLOCK_MS = Number(arg('clock', 13800)) * 1000
const MAIN_POLL_MS = Number(arg('main-poll', POLICY_FLOCK?.main?.poll_seconds ?? 60)) * 1000
if (!Number.isFinite(MAIN_POLL_MS) || MAIN_POLL_MS < 1000) { console.error('engine: --main-poll (or flock.main.poll_seconds) is a number of seconds, 1 or more'); process.exit(2) }
const RUN_NO = (process.env.ULTRAPOWERS_FLEET_RUN || '').replace(/^run-/, '') || '?'
const touched = {}
const touch = (agent, rel) => (touched[agent] = touched[agent] || new Set()).add(rel)
const MAX_REOPEN = 3
const MAX_RELEASE = 3
const STALL_MIN = Number(POLICY_FLOCK?.stall?.minutes ?? 20)
if (!Number.isFinite(STALL_MIN) || STALL_MIN <= 0) { console.error('engine: flock.stall.minutes is a number of minutes above 0'); process.exit(2) }
const STALL_MS = (SCRIPT && Number(SCRIPT['@stall_ms'])) || STALL_MIN * 60000
const OUT = RUN_DIR
const WORK = path.join(RUN_DIR, 'work')
const T0 = Date.now()
const now = () => Date.now() - T0
const RUN_ENV = { ...process.env, PYTHONDONTWRITEBYTECODE: '1', ULTRA_BASE: BASE_SHA }
let BASE_NOW = BASE_SHA
const NOGIT = path.join(HERE, 'nogit')

fs.mkdirSync(OUT, { recursive: true })
const CHECK_OUT = path.join(OUT, 'checks')
RUN_ENV.FLOCK_CHECK_OUT = CHECK_OUT
fs.mkdirSync(CHECK_OUT, { recursive: true })
fs.rmSync(WORK, { recursive: true, force: true })
fs.mkdirSync(WORK, { recursive: true })
const EV = fs.openSync(path.join(OUT, 'events.jsonl'), 'a')
const ev = (kind, o = {}) => fs.writeSync(EV, JSON.stringify({ t: now(), kind, ...o, ts: new Date().toISOString() }) + '\n')
const log = (...a) => console.log(util.format(`[${(now() / 1000).toFixed(1).padStart(6)}s]`, ...a))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const taskOf = {}
const task_label = (agent, task) => task == null ? agent : agent + '.' + task
const LOOSE_TITLE = 'Close the loose ends builders reported'
function peerRewrites (agent, rel, rewrites) {
  for (const w of rewrites || []) {
    const mine = taskOf[agent]
    ev('peer:rewrite', { agent, task: mine && mine.id, path: rel, peers: w.peers, before: w.before, peer: w.peer, after: w.after })
  }
}

let TARGET_OBJECTS = null
function gitCopy (dir) {
  if (TARGET_OBJECTS === null) TARGET_OBJECTS = path.resolve(TARGET, git(['rev-parse', '--git-common-dir']).trim(), 'objects')
  gitIn(dir, ['init', '-q'])
  fs.writeFileSync(path.join(dir, '.git', 'objects', 'info', 'alternates'), TARGET_OBJECTS + '\n')
  gitIn(dir, ['read-tree', BASE_NOW])
  gitIn(dir, ['update-index', '-q', '--refresh'])
}
const git = (args, opts) => gitIn(TARGET, args, opts).stdout

const keeper = startWeave()
const OPS = fs.openSync(path.join(OUT, 'weave-ops.jsonl'), 'a')
const weave = (o) => {
  if (['base', 'edit', 'rewrite', 'publish', 'pull'].includes(o.op)) fs.writeSync(OPS, JSON.stringify({ t: now(), ...o }) + '\n')
  return keeper.send(o)
}
const must = async (o) => { const r = await weave(o); if (!r.ok) throw new Error('weave ' + o.op + ': ' + r.error); return r }

const SKIP = /(^|\/)(__pycache__|\.pytest_cache|node_modules|\.git)(\/|$)|\.pyc$/
function walk (dir, rel = '') {
  const out = []
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const p = rel ? rel + '/' + e.name : e.name
    if (SKIP.test(p)) continue
    if (e.isDirectory()) out.push(...walk(dir, p)); else if (isText(path.join(dir, p), p)) out.push(p)
  }
  return out
}
const textSeen = new Map()
const nonText = new Set()
function isText (abs, rel) {
  let st
  try { st = fs.statSync(abs) } catch { return false }
  if (!st.isFile()) return false
  const key = st.size + ':' + st.mtimeMs
  const seen = textSeen.get(abs)
  if (seen && seen.key === key) return seen.text
  const text = utf8(fs.readFileSync(abs)) !== undefined
  textSeen.set(abs, { key, text })
  if (!text && !nonText.has(rel)) { nonText.add(rel); if (typeof ev === 'function') ev('non-text', { path: rel }) }
  return text
}
const readOr = (f) => { try { return fs.readFileSync(f, 'utf8') } catch { return null } }
const BASE_DIR = path.join(WORK, 'base')
function writeBase (dir, sha = BASE_NOW) {
  fs.mkdirSync(dir, { recursive: true })
  const index = path.join(WORK, 'base.index')
  gitIn(TARGET, [`--work-tree=${dir}`, 'read-tree', '--reset', '-u', sha], { env: { ...process.env, GIT_INDEX_FILE: index } })
  fs.rmSync(index, { force: true })
}
writeBase(BASE_DIR)
let BASE_PATHS = walk(BASE_DIR)
let BASE_FILES = Object.fromEntries(BASE_PATHS.map((p) => [p, readOr(path.join(BASE_DIR, p))]))
const BASE_FILES_0 = BASE_FILES
const DEPS_DIR = path.join(WORK, 'deps')
let DEP_DIRS = []
const LOCK_CMD = BASE_PATHS.includes('bun.lock') || BASE_PATHS.includes('bun.lockb') ? 'bun install --frozen-lockfile'
  : BASE_PATHS.includes('package-lock.json') ? 'npm ci' : null
const SETUP = W.setup || (LOCK_CMD && ['bash', '-lc', LOCK_CMD])
if (SETUP) {
  fs.cpSync(BASE_DIR, DEPS_DIR, { recursive: true })
  const t0 = Date.now()
  const r = spawnSync(SETUP[0], SETUP.slice(1), { cwd: DEPS_DIR, encoding: 'utf8', timeout: EXAM_MS.setup, env: RUN_ENV })
  ev('setup', { cmd: SETUP[SETUP.length - 1], exit: r.status, ms: Date.now() - t0 })
  if (r.status !== 0) throw new Error('setup failed: ' + ((r.stdout || '') + (r.stderr || '')).slice(-800))
  DEP_DIRS = depDirs()
}
function depDirs () {
  return ['node_modules', ...fs.readdirSync(DEPS_DIR, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name !== 'node_modules')
    .map((e) => path.join(e.name, 'node_modules'))].filter((d) => fs.existsSync(path.join(DEPS_DIR, d)))
}
const linkDeps = (dir) => { for (const d of DEP_DIRS) { fs.rmSync(path.join(dir, d), { recursive: true, force: true }); fs.symlinkSync(path.join(DEPS_DIR, d), path.join(dir, d)) } }
const agentDir = (a) => path.join(WORK, 'agents', a)
function freshCopy (dir, s) {
  fs.rmSync(dir, { recursive: true, force: true }); fs.cpSync(BASE_DIR, dir, { recursive: true }); linkDeps(dir); gitCopy(dir)
  writeFiles(dir, snapshotEntries(s))
}
const known = {}

const board = new Board({ tasks: W.tasks, now })

function runFacts (cwd, task) {
  return task.facts.map((cmd) => {
    const r = spawnSync(cmd[0], cmd.slice(1), { cwd, encoding: 'utf8', timeout: EXAM_MS.fact, env: RUN_ENV })
    return { exit: r.status ?? 124, tail: ((r.stdout || '') + (r.stderr || '')).slice(-800) }
  })
}
const redOf = (res) => res.map((r, i) => ({ i, ...r })).filter((r) => r.exit !== 0)
const redText = (task, red) => red.map((r) =>
  `fact ${r.i + 1}${task.clauses ? ` (${task.clauses[r.i] ?? 'screens'})` : ''} exit ${r.exit}\n${r.tail}`).join('\n\n')

function peerOf (answers) {
  const peers = new Set()
  for (const r of answers) for (const o of r.peers || []) o.split('|').forEach((x) => peers.add(x))
  return { peer: answers.reduce((n, r) => n + (r.peer_lines_touched || 0), 0), peers: [...peers] }
}

async function syncFromDisk (agent) {
  const dir = agentDir(agent)
  const disk = walk(dir)
  for (const p of disk) known[agent].add(p)
  let drift = 0
  for (const p of known[agent]) {
    const text = readOr(path.join(dir, p))
    const view = (await must({ op: 'view', agent, path: p })).text
    const hasWeave = view !== '' || BASE_PATHS.includes(p)
    if (text === null && !hasWeave) continue
    if (text === view) continue
    const r = await must({ op: 'rewrite', agent, path: p, content: text, task: taskOf[agent]?.id })
    edited(agent, p)
    drift += 1
    ev('fallback', { agent, path: p, peer_lines: r.peer_lines_touched, deleted: text === null })
    peerRewrites(agent, p, r.peerRewrites)
  }
  return drift
}

async function recordEditCall (agent, rel, before, edits) {
  let text = before
  const answers = []
  for (const e of edits) {
    for (const s of editSpans(text, e.old_string, e.new_string, e.replace_all)) {
      const r = await must({ op: 'edit', agent, path: rel, ...s, task: taskOf[agent]?.id })
      answers.push(r)
      peerRewrites(agent, rel, r.peerRewrites)
    }
    text = e.replace_all ? text.split(e.old_string).join(e.new_string) : text.replace(e.old_string, () => e.new_string)
  }
  return peerOf(answers)
}

const ledger = new Map()
function region (annotated) {
  const hunks = []
  let side = null, cur = null
  for (const l of String(annotated || '').split('\n')) {
    if (l.startsWith('<<<<<<< begin')) { cur = { a: [], b: [] }; side = 'a'; continue }
    if (l.startsWith('======= begin')) { side = 'b'; continue }
    if (l.startsWith('>>>>>>> end')) { if (cur) hunks.push([cur.a.join('\n'), cur.b.join('\n')].sort().join('\u0001')); cur = null; side = null; continue }
    if (cur && side) cur[side].push(l)
  }
  return crypto.createHash('sha1').update(hunks.sort().join('\u0002')).digest('hex').slice(0, 10)
}
async function openConflict (p, info) {
  const reg = region(info.annotated)
  const e = ledger.get(p + '\u0000' + reg)
  if (e) { if (!e.open) ev('conflict:reflag', { path: p, region: reg }); return }
  const made = !!info.bothCreated
  if (info.addsOnly && !made) { ev('conflict:union', { path: p, ...info, annotated: undefined }); return }
  ledger.set(p + '\u0000' + reg, { path: p, region: reg, open: true, t: now(), annotated: info.annotated, between: info.between, party: info.party, made })
  lastChange = now()
  ev('conflict:open', { path: p, region: reg, between: info.between, ...(made ? { created: 'both' } : {}) })
  await board.post({ by: 'host', claim: made
    ? `open conflict in ${p}: main and a builder each created it, and the merge put one whole file after the other; whoever next works there should make it one file that says what both meant and call resolve_conflict`
    : `open conflict in ${p} between ${info.between.join(' and ')}; whoever next works there should make it say what both sides meant and call resolve_conflict` })
}
const openConflicts = () => [...new Set([...ledger.values()].filter((e) => e.open).map((e) => e.path))]
const openEntries = (p) => [...ledger.values()].filter((e) => e.open && e.path === p)
function closeEntries (p, by, note, via) {
  for (const e of openEntries(p)) {
    e.open = false; e.note = String(note).slice(0, 200)
    ev('conflict:close', { path: p, region: e.region, by, note: e.note, via })
  }
  lastChange = now()
}

const lastEditT = {}
const lastMarkedT = {}
const lastPubT = {}
const pubHeld = {}
function edited (agent, p) { (lastEditT[agent] = lastEditT[agent] || {})[p] = now() }
async function publishCopy (agent) {
  await must({ op: 'publish', agent })
  lastPublish = now(); lastPubT[agent] = now()
  for (const [p, te] of Object.entries(lastEditT[agent] || {})) {
    const text = (await must({ op: 'view', agent, path: p })).text
    ;(pubHeld[agent] = pubHeld[agent] || {})[p] = { text, held: te >= ((lastMarkedT[agent] || {})[p] ?? -1), t: now() }
  }
}
function earlyClose (m, snap) {
  for (const e of [...ledger.values()].filter((x) => x.open)) {
    if (e.party && (lastPubT[e.party] ?? -1) < e.t) continue
    const text = m.files[e.path]
    if (text === undefined) continue
    const holders = Object.entries(pubHeld).filter(([, ps]) => ps[e.path] && ps[e.path].held && ps[e.path].text === text).map(([a]) => a)
    if (!holders.length) continue
    const unflagged = !(m.conflicts.includes(e.path) && region(m.annotated[e.path]) === e.region)
    e.open = false
    e.note = `the merged text of ${e.path} is ${holders.join(' and ')}'s own published writing over both sides`
    const evidence = { snap, holders: holders.map((a) => ({ agent: a, published_t: pubHeld[a][e.path].t, last_edit_t: lastEditT[a][e.path], last_marked_t: (lastMarkedT[a] || {})[e.path] ?? null })), unflagged }
    ev('conflict:close', { path: e.path, region: e.region, by: 'host', note: e.note, via: 'early:held', evidence })
    log('early close', e.path, e.region, 'held by', holders.join(','))
    lastChange = now()
  }
}
let lastChange = 0
const live = new Set()
const stops = new Map()
const stalls = []
async function stall (kind, evidence) {
  const b = await board.post({ by: 'host', claim: `stall: ${kind} ${JSON.stringify(evidence).slice(0, 300)}` })
  stalls.push({ kind, evidence, t: now() }); ev('stall:' + kind, { evidence }); log('STALL', kind, JSON.stringify(evidence).slice(0, 200))
  return b
}

let edgeChain = Promise.resolve()
let lastEdge = null
const snapshots = []
let bestGreen = -1, lastRise = 0
let lastSessionEnd = -1
const edgeLatency = []
const amendedSeen = new Set()
function scopeAt (m, snap) {
  const text = (p) => p in m.files ? (m.exists[p] ? m.files[p] : '') : (BASE_FILES[p] ?? '')
  const changed = [...new Set([...Object.keys(m.files), ...BASE_PATHS])].filter((p) => text(p) !== (BASE_FILES[p] ?? ''))
  const files = [...board.tasks.values()].flatMap((t) => t.files || (String(t.id).startsWith('R:') ? [t.id.slice(2)] : []))
  const written = Object.values(lastEditT).flatMap((ps) => Object.keys(ps))
  const { outside, amended } = scopeOf({ changed, files, written })
  for (const p of amended) if (!amendedSeen.has(p)) { amendedSeen.add(p); ev('amendment', { path: p, snap }) }
  if (outside.length) { ev('scope:outside', { snap, paths: outside }); log('scope', snap, 'outside', outside.join(',')) }
  return outside
}
function textAt (snap) {
  const s = snapshots.find((x) => x.snap === snap)
  return (p) => s && p in s.files ? (s.exists[p] ? s.files[p] : null) : p in BASE_FILES ? (BASE_FILES[p] ?? null) : undefined
}
function edge (reason) {
  const asked = now()
  edgeChain = edgeChain.then(async () => {
    const m = await must({ op: 'merged' })
    const snap = crypto.createHash('sha1').update(JSON.stringify(m.files)).digest('hex').slice(0, 10)
    const outside = scopeAt(m, snap)
    if (lastEdge && lastEdge.snap === snap) {
      for (const p of m.conflicts) await openConflict(p, { addsOnly: !!m.addsOnly[p], bothCreated: !!(m.bothCreated || {})[p], annotated: m.annotated[p], between: ['published copies'] })
      earlyClose(m, snap)
      const blocking = openConflicts()
      const factsGreen = Object.values(lastEdge.perTask).every((xs) => xs.every((x) => x === 0))
      lastEdge = { ...lastEdge, t: now(), reason, blocking, outside, green: factsGreen && lastEdge.check === 0 && !blocking.length && !outside.length }
      return lastEdge
    }
    lastChange = now()
    const dir = path.join(WORK, 'edge')
    freshCopy(dir, m)
    const perTask = {}, red = []
    for (const t of board.tasks.values()) {
      const res = runFacts(dir, t)
      perTask[t.id] = res.map((r) => r.exit)
      res.forEach((r, i) => { if (r.exit !== 0) red.push({ task: t.id, clause: t.clauses ? t.clauses[i] : undefined, cmd: t.facts[i].join(' '), exit: r.exit, tail: r.tail }) })
    }
    const chk = W.check ? spawnSync(W.check[0], W.check.slice(1), { cwd: dir, encoding: 'utf8', timeout: W.checkTimeoutMs ?? 120000, env: RUN_ENV }) : { status: 0, stdout: '', stderr: '' }
    const factsGreen = Object.values(perTask).every((xs) => xs.every((x) => x === 0))
    for (const p of m.conflicts) await openConflict(p, { addsOnly: !!m.addsOnly[p], bothCreated: !!(m.bothCreated || {})[p], annotated: m.annotated[p], between: ['published copies'] })
    for (const [p, fl] of Object.entries(m.sameAnchor || {})) await sameSpot(p, fl, ['published copies'], null)
    earlyClose(m, snap)
    const blocking = openConflicts()
    lastEdge = { snap, t: now(), reason, perTask, red, check: chk.status, checkTail: ((chk.stdout || '') + (chk.stderr || '')).slice(-600), conflicts: m.conflicts, blocking, outside, annotated: m.annotated, green: factsGreen && chk.status === 0 && !blocking.length && !outside.length }
    const lost = m.lost || []
    ev('survival', { snap, lost })
    snapshots.push({ snap, t: now(), files: m.files, exists: m.exists, lost })
    edgeLatency.push(now() - asked)
    const g = Object.values(perTask).reduce((a, xs) => a + xs.filter((x) => x === 0).length, 0) + (chk.status === 0 ? 1 : 0)
    if (g > bestGreen) { bestGreen = g; lastRise = now() }
    ev('edge', { ...lastEdge, checkTail: undefined, annotated: undefined, red: undefined })
    log('edge', snap, lastEdge.green ? 'GREEN' : 'red', JSON.stringify(perTask), 'check', chk.status, m.conflicts.length ? 'conflicts ' + m.conflicts + ' (blocking: ' + (blocking.join(',') || 'none') + ')' : '')
    return lastEdge
  })
  return edgeChain
}

const usage = []
let lastPublish = 0
let settled = null
const SYSTEM = `You are one of several agents working on the same repository at the same time, with no one directing you.
Each agent works in its own copy. Other agents' published work is merged into your copy between your tool calls; when that happens you receive a note naming the files that changed. Re-read a file before editing it if a note says it changed.
Rules:
- Change an existing file only with the Edit tool. New files may be created any way you like. Shell commands must not overwrite, move or delete existing files.
- Never run git.
- Run your task's facts with run_proof: they are the tests that decide whether your task is done.
- Use the flock tools: board_read (tasks and beliefs), post_belief (tell the others something true and useful, and what it is about: \`task\` your task, \`app\` the app being built, \`engine\` the engine running this run, such as copies, checks or the board; when the belief is a loose end, something outside your task's files that your change left stale or broken, name the file as \`path\` and, when you can, the exact text still wrong there as \`stale\`), run_proof (your task's facts, on your copy), publish (share your copy's changes), wait_for (wait for a peer's work: a task done, a text in a file, a proof green), release (give the task back if you are blocked), done (your task is finished).
- To wait for another agent's work, call wait_for. Never wait with shell sleep or a polling loop: peers' work reaches your copy only between your tool calls, so a shell loop cannot see it arrive.
- Publish whenever your change is coherent, so the others build on it.
- If something fails because of another agent's unfinished work, prefer not to rewrite their lines: post a belief saying what you saw, and carry on with your own part.
- Your task's Files are where the plan expects you to write, not a fence. When the task needs a change elsewhere (a part the screens lack, a helper another file should hold), make it: it is recorded as an amendment, and nothing reverts it.
- If your task cannot be done as the plan is written, by any code (two clauses that cannot both be true, or a proof nothing can pass), call object and name the clauses: the task then waits for the operator. Say it as soon as you are sure, before trying again. A change outside your Files is code you can write, so it is never a reason to object.
- If a note says a file merged with conflict marks, look at that part of the file. When it says what both sides meant (edit it if not), call resolve_conflict for that file.
- When your task's facts pass on your copy, call done: it publishes your copy for you and closes it.`

const unsaid = {}
async function pullInto (agent, task) {
  if (task && !task.files && String(task.id).startsWith('R:')) task = { ...task, files: [task.id.slice(2)] }
  const base = new Set(BASE_PATHS)
  const created = [...new Set(Object.entries(lastEditT).filter(([a]) => a !== agent).flatMap(([, ps]) => Object.keys(ps)))].filter((p) => !base.has(p))
  const scope = task ? pullScope({ task, tasks: W.tasks, touched: [...(touched[agent] || [])], created }) : null
  const r = await must({ op: 'pull', agent })
  const dir = agentDir(agent)
  for (const c of r.changed) known[agent].add(c.path)
  writeFiles(dir, r.changed.map((c) => [c.path, c.exists ? c.text : null]))
  const quiet = (p) => !!scope && !scope.has(p)
  if (r.changed.length) ev('pull', { agent, changed: r.changed.map((c) => ({ path: c.path, from: c.from, added: c.added, removed: c.removed, conflict: c.conflict, quiet: quiet(c.path) || undefined })) })
  const mine = (unsaid[agent] = unsaid[agent] || new Map())
  for (const c of r.changed) {
    const was = mine.get(c.path)
    mine.set(c.path, was ? { ...c, added: c.added + was.added, removed: c.removed + was.removed, ...(c.conflict ? {} : { conflict: was.conflict, addsOnly: was.addsOnly, bothCreated: was.bothCreated, annotated: was.annotated }) } : c)
  }
  const told = [...mine.values()].filter((c) => !quiet(c.path))
  for (const c of told) mine.delete(c.path)
  for (const c of told.filter((x) => x.conflict)) (lastMarkedT[agent] = lastMarkedT[agent] || {})[c.path] = now()
  for (const c of told.filter((x) => x.conflict)) await openConflict(c.path, { addsOnly: c.addsOnly, bothCreated: c.bothCreated, annotated: c.annotated, between: [agent, c.from], party: agent })
  for (const s of r.sameAnchor || []) await sameSpot(s.path, s.flags, [agent, s.from], quiet(s.path) ? null : agent)
  told.all = r.changed.length
  return told
}

const spots = new Map()
const spotNotes = {}
async function sameSpot (p, flags, between, agent) {
  for (const f of flags || []) {
    const key = [p, f.kind, f.anchor, (f.lines || []).join('\n')].join('\u0000')
    const text = `${f.kind === 'unified' ? 'one block starts with the other\'s line' : 'two insertions'} at one spot in ${p}, after ${JSON.stringify(f.anchor)}: ${JSON.stringify(f.lines).slice(0, 200)} (by ${(f.authors || between).join(' and ')}); the merge chose their order by text, so check the order says what both meant`
    if (agent) (spotNotes[agent] = spotNotes[agent] || new Set()).add(text)
    if (spots.has(key)) continue
    spots.set(key, { p, f, text, t: now() })
    ev('same-anchor', { path: p, flag: f.kind, anchor: f.anchor, lines: f.lines, authors: f.authors, between })
    await board.post({ by: 'host', claim: text })
  }
}

function brief (task) {
  const deps = task.depends_on.map((d) => `task ${d} ${board.tasks.get(d)?.state ?? '?'}`)
  const mine = new Set(task.files || [])
  const bel = (board.beliefs || []).filter((b) => b.task === task.id || [...mine].some((f) => String(b.claim).includes(f)))
  return `\nBoard digest: ${deps.length ? 'the tasks you depend on: ' + deps.join(', ') + '.' : 'your task depends on no other task.'} ` +
    (bel.length ? 'Beliefs about your task or files:\n- ' + bel.slice(-5).map((b) => `${b.by}: ${b.claim}`).join('\n- ') : 'No beliefs concern your task or files.') +
    ' board_read shows the whole board if you need it.' +
    (PAST ? `\nThe previous run on this repository, run-${PAST.run}, did not finish green. What it recorded:\n` + PAST.items.map((i) => i.text).join('\n') : '')
}
async function giveBack (agent, task, why) {
  task.released = (task.released || 0) + 1
  if (task.released >= MAX_RELEASE) {
    await board.park(task, `${agent} released: ${why}`)
    ev('task:parked', { task: task.id, releases: task.released, reason: String(why).slice(0, 300) })
    await stall('released', { task: task.id, releases: task.released }); log(agent, 'parks', task.id, 'after', task.released, 'give-backs')
    return
  }
  await board.release(task, `${agent} released: ${why}`); log(agent, 'releases', task.id, '—', why)
}

const objections = []
async function objectTo (agent, task, why) {
  const reason = String(why).replace(/\s+/g, ' ').trim().slice(0, 600)
  objections.push({ task: task.id, agent, reason })
  await board.park(task, `${agent} objected: ${reason}`)
  ev('objection', { task: task.id, agent, reason })
  ev('task:parked', { task: task.id, releases: task.released || 0, reason: reason.slice(0, 300), objected: true })
  await stall('objection', { task: task.id }); log(agent, 'objects to', task.id, '—', reason)
}

async function postBelief (agent, a) {
  const stale = typeof a.stale === 'string' ? a.stale.slice(0, 300) : a.stale
  const b = await board.post({ by: agent, claim: a.claim, task: a.task, about: a.about, path: a.path, stale })
  ev('belief', b)
  return b
}

async function scriptedSession (agent, task) {
  const cwd = agentDir(agent)
  const files = SCRIPT[task.id]
  ev('session:start', { agent, task: task.id, builder: 'scripted' })
  log(agent, 'claims task', task.id, '(scripted)')
  live.add(agent)
  const H = SCRIPT['@hold_ms'], hold = H && typeof H === 'object' ? H[task.id] : H
  if (hold) {
    let wake
    const held = new Promise((r) => { wake = r; setTimeout(r, hold) })
    stops.set(agent, () => wake())
    await held
    stops.delete(agent)
    if (outcome) {
      usage.push({ agent, task: task.id, turns: 0, subtype: 'scripted', cost_usd: 0 })
      ev('session:end', { agent, task: task.id, released: 'run ended', done: false })
      live.delete(agent); return
    }
    await pullInto(agent, task)
  }
  for (const b of SCRIPT['@beliefs'] || []) if (String(b.task) === String(task.id)) await postBelief(agent, b)
  const objected = (SCRIPT['@object'] || {})[task.id]
  if (objected) {
    usage.push({ agent, task: task.id, turns: 0, subtype: 'scripted', cost_usd: 0 })
    ev('session:end', { agent, task: task.id, released: false, objected, done: false })
    live.delete(agent); lastChange = now()
    await objectTo(agent, task, objected)
    return
  }
  if (files) {
    writeFiles(cwd, Object.entries(files))
    const red = redOf(runFacts(cwd, task))
    if (red.length) {
      ev('facts:red', { agent, task: task.id, at: 'scripted', exits: red.map((r) => r.exit) })
      usage.push({ agent, task: task.id, turns: 0, subtype: 'scripted', cost_usd: 0 })
      ev('session:end', { agent, task: task.id, released: 'red facts', done: false })
      live.delete(agent); lastChange = now()
      await giveBack(agent, task, 'the scripted files leave red facts: ' + redText(task, red).slice(0, 300))
      return
    }
    await syncFromDisk(agent)
    for (const [p, text] of Object.entries(SCRIPT['@unwritten'] || {})) await must({ op: 'rewrite', agent, path: p, content: text })
    await publishCopy(agent); ev('publish', { agent, task: task.id, by: 'done' })
    await board.done(task); live.delete(agent); edge('done ' + agent); log(agent, 'done', task.id)
  }
  usage.push({ agent, task: task.id, turns: 0, subtype: 'scripted', cost_usd: 0 })
  ev('session:end', { agent, task: task.id, released: files ? false : 'not scripted', done: files ? 'scripted' : false })
  live.delete(agent); lastChange = now()
  if (!files) await giveBack(agent, task, `the script names no files for task ${task.id}`)
}

async function session (agent, task) {
  const cwd = agentDir(agent)
  const st = { released: false, done: false, redRuns: 0 }
  const pre = new Map()
  taskOf[agent] = task
  await pullInto(agent, task)
  if (SCRIPT) return scriptedSession(agent, task)
  const say = (text) => ({ content: [{ type: 'text', text }] })
  const tools = [
    tool('board_read', 'Read the board: every task with its state and owner, and the latest beliefs.', {}, async () => say(JSON.stringify(await board.read(), null, 1))),
    tool('post_belief', 'Post a belief for the other agents: something you believe is true, which task it concerns, and what it is about: "task" (your task), "app" (the app being built) or "engine" (the engine running this run, such as copies, checks or the board). When the belief is a loose end (something outside your task\'s files that your change left stale or broken), name the file as `path` and, when you can, the exact text still wrong there as `stale`.',
      { claim: z.string().max(300), task: z.string().optional(), about: z.enum(['task', 'app', 'engine']), path: z.string().optional(), stale: z.string().optional() },
      async (a) => { const b = await postBelief(agent, a); return say('posted belief ' + b.id) }),
    tool('run_proof', "Run a task's facts on your copy (default: your own task). Each fact is a command; exit 0 means it holds.",
      { task: z.string().optional() },
      async (a) => {
        const t = board.tasks.get(a.task || task.id) || task
        const res = runFacts(cwd, t)
        const red = res.filter((r) => r.exit !== 0)
        ev('proof', { agent, task: t.id, exits: res.map((r) => r.exit), errs: red.map((r) => (r.tail.match(/^\w*(Error|Exception)\b.*$/gm) || ['']).pop().slice(0, 160)) })
        return say(res.map((r, i) => `fact ${i + 1}: exit ${r.exit}${r.exit ? '\n' + r.tail : ''}`).join('\n'))
      }),
    tool('wait_for', 'Wait until a fact holds, while the other agents\' published work keeps merging into your copy. Use this instead of any shell sleep or polling loop. A fact is one of: a task is done (kind "task_done", task); a text or regular expression appears in a file of your copy (kind "text", path, pattern); a task\'s facts pass on your copy (kind "proof", task). Returns as soon as it holds, or after timeout_s (default 120, at most 300) with what it last saw.',
      { kind: z.enum(['task_done', 'text', 'proof']), task: z.string().optional(), path: z.string().optional(), pattern: z.string().optional(), timeout_s: z.number().optional() },
      async (a) => {
        const limit = Math.min(300, Math.max(1, a.timeout_s || 120)) * 1000
        const t0 = now()
        const merged = new Map()
        let spotted = []
        let re = null
        if (a.kind === 'text') {
          if (!a.path || !a.pattern) return say('kind "text" needs path and pattern')
          try { re = new RegExp(a.pattern, 'm') } catch { re = null }
        }
        const target = a.kind === 'text' ? null : board.tasks.get(a.task || '')
        if (a.kind !== 'text' && !target) return say('no task ' + JSON.stringify(a.task) + ' on the board')
        let proofChanged = true, last = ''
        const holds = () => {
          if (a.kind === 'task_done') { last = 'task ' + target.id + ' is ' + target.state; return target.state === 'done' }
          if (a.kind === 'text') {
            const text = readOr(path.join(cwd, a.path)) || ''
            const ok = re ? re.test(text) : text.includes(a.pattern)
            last = a.path + (ok ? ' contains ' : ' does not contain ') + JSON.stringify(a.pattern)
            return ok
          }
          if (!proofChanged) return false
          proofChanged = false
          const res = runFacts(cwd, target)
          last = `task ${target.id}'s facts on your copy: ` + res.map((r, i) => `fact ${i + 1} exit ${r.exit}`).join(', ') + (res.some((r) => r.exit) ? '\n' + res.find((r) => r.exit).tail : '')
          return res.every((r) => r.exit === 0)
        }
        await syncFromDisk(agent)
        let held = holds()
        while (!held && now() - t0 < limit && !outcome) {
          await sleep(1000)
          const changed = await pullInto(agent, task)
          for (const c of changed) merged.set(c.path, c)
          if (changed.all) proofChanged = true
          spotted.push(...(spotNotes[agent] || [])); delete spotNotes[agent]
          held = holds()
        }
        spotted = [...new Set(spotted)]
        const waited = now() - t0
        ev('wait_for', { agent, task: task.id, fact: { kind: a.kind, task: a.task, path: a.path, pattern: a.pattern }, held, waited_ms: waited, merged: [...merged.keys()] })
        return say(`${held ? 'The fact holds' : 'Timed out: the fact does not hold yet'} after ${(waited / 1000).toFixed(1)} s. ${last}` +
          (merged.size ? `\nMerged into your copy while waiting: ${[...merged.values()].map((c) => `${c.path} (from ${c.from}${c.conflict ? ', with conflict marks' : ''})`).join('; ')}. Re-read before editing those files.` : '') +
          (spotted.length ? '\nSame-spot insertions in your copy: ' + spotted.join('; ') : ''))
      }),
    tool('delete_file', 'Delete an existing file in your copy (the shell may not delete one). Give its path relative to your copy.',
      { path: z.string() },
      async (a) => {
        const fp = path.resolve(cwd, a.path || '')
        if (!fp.startsWith(cwd + '/')) return say('refused: ' + JSON.stringify(a.path) + ' is outside your copy')
        let isFile = false
        try { isFile = fs.statSync(fp).isFile() } catch { /* absent */ }
        if (!isFile) return say('refused: ' + JSON.stringify(a.path) + ' is not an existing file in your copy')
        const rel = fp.slice(cwd.length + 1)
        touch(agent, rel); known[agent].add(rel)
        fs.rmSync(fp)
        await syncFromDisk(agent)
        edited(agent, rel)
        ev('delete', { agent, task: task.id, path: rel })
        return say('deleted ' + rel)
      }),
    tool('publish', "Publish your copy's changes so the other agents receive them.", {},
      async () => { await syncFromDisk(agent); await publishCopy(agent); ev('publish', { agent, task: task.id }); edge('publish ' + agent); return say('published') }),
    tool('resolve_conflict', 'Close an open conflict in a file: the text in your copy now says what both sides meant (edit it first with Edit if it did not).',
      { path: z.string(), note: z.string() },
      async (a) => {
        if (!openEntries(a.path).length) return say('no open conflict in ' + a.path)
        await syncFromDisk(agent); await publishCopy(agent)
        closeEntries(a.path, agent, a.note, 'resolve_conflict'); edge('resolve ' + agent)
        return say('conflict in ' + a.path + ' closed and your copy published')
      }),
    tool('release', 'Give your task back to the board because you are blocked. Say why.', { reason: z.string() },
      async (a) => { st.released = a.reason; return say('released; end your turn now') }),
    tool('object', 'Say that your task cannot be done as the plan is written, by any code: two clauses that cannot both be true, or a proof nothing can pass. Name the clauses and say why. The task then waits for the operator and is not handed to another builder. When you are only blocked for now, use release.', { reason: z.string().max(600) },
      async (a) => { st.objected = a.reason; return say('objection filed; end your turn now') }),
    tool('done', 'Your task is finished: its facts pass on your copy. This publishes your copy and closes it.', { summary: z.string() },
      async (a) => {
        const red = redOf(runFacts(cwd, task))
        if (red.length) {
          st.redRuns++
          ev('facts:red', { agent, task: task.id, at: 'done', exits: red.map((r) => r.exit) })
          return say('not done: these facts fail on your copy. Fix them, run run_proof, then call done again.\n\n' + redText(task, red))
        }
        await syncFromDisk(agent); await publishCopy(agent); ev('publish', { agent, task: task.id, by: 'done' })
        st.done = a.summary; st.closed = true
        await board.done(task); live.delete(agent); edge('done ' + agent); log(agent, 'done', task.id)
        return say('published and marked done; your copy is closed to edits. End your turn now.')
      }),
  ]
  const hooks = {
    PreToolUse: [{ hooks: [async (input) => {
      const ti = input.tool_input || {}
      ev('tool', { agent, task: task.id, tool: input.tool_name, target: String(ti.file_path || ti.command || '').slice(0, 120) })
      if (['Read', 'Edit', 'MultiEdit', 'Write'].includes(input.tool_name) && ti.file_path) {
        const fp = path.resolve(cwd, ti.file_path)
        if (fp.startsWith(cwd + '/')) touch(agent, fp.slice(cwd.length + 1))
      }
      if (st.closed && ['Edit', 'MultiEdit', 'Write', 'Bash'].includes(input.tool_name)) {
        return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'your task is done and your copy is closed; end your turn' } }
      }
      if (input.tool_name === 'Bash' && /(^|[^\w.-])\/[\w./-]*\/git(?![\w./-])/.test(ti.command || '')) {
        return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'agents never run git' } }
      }
      if (input.tool_name === 'Bash') {
        const cmd = ti.command || ''
        const redirects = [...cmd.matchAll(/(?:^|[^<>&0-9])>{1,2}\s*([^\s|;&<>()]+)/g)].map((m) => m[1]).filter((t) => t !== '/dev/null' && !t.startsWith('&'))
        const overwrites = redirects.some((t) => { const f = path.resolve(cwd, t); return f.startsWith(cwd + '/') && fs.existsSync(f) })
        if (overwrites || /\bsed\s+-[a-zA-Z]*i|\bperl\s+-[a-zA-Z]*i|\b(mv|cp|rm)\s/.test(cmd)) {
          ev('deny:shell-write', { agent, task: task.id, command: cmd.slice(0, 160) })
          return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny',
            permissionDecisionReason: 'In this repository an existing file changes only through the Edit tool, so every change is recorded exactly and merges with the other agents. A shell command may create a NEW file, and may read and run anything, but may not overwrite, move or delete an existing file. Delete an existing file with the delete_file tool.' } }
        }
      }
      if (['Edit', 'MultiEdit', 'Write'].includes(input.tool_name)) {
        const fp = path.resolve(cwd, ti.file_path || '')
        if (!fp.startsWith(cwd + '/')) return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'outside your copy' } }
        await syncFromDisk(agent)
        pre.set(input.tool_use_id, readOr(fp))
      }
      if (input.tool_name === 'Bash') {
        return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', updatedInput: { ...ti, command: '{ ' + (ti.command || '') + '\n} < /dev/null' } } }
      }
      return {}
    }] }],
    PostToolUse: [{ hooks: [async (input) => {
      const ti = input.tool_input || {}
      const name = input.tool_name
      if (['Edit', 'MultiEdit', 'Write'].includes(name)) {
        const fp = path.resolve(cwd, ti.file_path)
        const rel = fp.slice(cwd.length + 1)
        known[agent].add(rel)
        const before = pre.get(input.tool_use_id)
        let rec = { peer: 0, peers: [] }, how = 'edit-call'
        if (name === 'Write' || before === null || before === undefined) {
          const r = await must({ op: 'rewrite', agent, path: rel, content: readOr(fp), task: task.id }); peerRewrites(agent, rel, r.peerRewrites); rec = peerOf([r]); how = before == null ? 'new-file' : 'write'
        } else {
          rec = await recordEditCall(agent, rel, before, name === 'MultiEdit' ? ti.edits : [ti])
          const view = (await must({ op: 'view', agent, path: rel })).text
          if (view !== readOr(fp)) { const r = await must({ op: 'rewrite', agent, path: rel, content: readOr(fp), task: task.id }); peerRewrites(agent, rel, r.peerRewrites); how = 'edit-call-mismatch' }
        }
        const own = task.files || (String(task.id).startsWith('R:') ? [task.id.slice(2)] : null)
        const outside = own ? !own.includes(rel) : false
        edited(agent, rel)
        ev('edit', { agent, task: task.id, tool: name, path: rel, how, peer_lines: rec.peer, peers: rec.peers, outside })
        if (rec.peer) await board.post({ by: 'host', claim: `${agent} changed ${rec.peer} line(s) written by ${rec.peers.join(', ')} in ${rel}`, task: task.id })
      } else if (name === 'Read' && ti.file_path) {
        const fp = path.resolve(cwd, ti.file_path)
        if (!fp.startsWith(cwd + '/')) return {}
        const rel = fp.slice(cwd.length + 1)
        const r = await weave({ op: 'authors_keyed', agent, path: rel })
        if (!r.ok) return {}
        const tasks = {}
        for (const a of new Set(r.authors.flatMap((w) => w.split('|')))) {
          const t = a.includes('.') && W.tasks.find((x) => x.id === a.slice(a.indexOf('.') + 1))
          if (t) tasks[a] = { id: t.id, title: t.title }
        }
        const note = peerNote({ path: rel, authors: r.authors, agent: task_label(agent, task.id), tasks })
        if (note) {
          ev('peer:note', { agent, task: task.id, path: rel })
          return { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: note } }
        }
      } else if (name === 'Bash') {
        await syncFromDisk(agent)
      }
      return {}
    }] }],
    PostToolBatch: [{ hooks: [async () => {
      const changed = await pullInto(agent, task)
      const spotted = [...(spotNotes[agent] || [])]; delete spotNotes[agent]
      if (!changed.length && !spotted.length) return {}
      const note = (changed.length ? 'Peers\' published work was merged into your copy just now: ' +
        changed.map((c) => `${c.path} (+${c.added} −${c.removed}, from ${c.from}${c.conflict ? ', with conflict marks' : ''})`).join('; ') + '. Re-read before editing those files.' : '') +
        (spotted.length ? ' Same-spot insertions in your copy: ' + spotted.join('; ') + '.' : '')
      return { hookSpecificOutput: { hookEventName: 'PostToolBatch', additionalContext: note } }
    }] }],
  }
  const prompt = `You are agent ${agent}. You claimed task ${task.id}: ${task.title}.\n\n${task.body}\n` +
    (task.notes.length ? `\nNotes on this task from earlier attempts:\n- ${task.notes.slice(-3).join('\n- ')}\n` : '') +
    brief(task)
  if (outcome) return
  ev('session:start', { agent, task: task.id })
  log(agent, 'claims task', task.id)
  const q = query({ prompt, options: {
    cwd, model: MODEL, settingSources: [], permissionMode: 'bypassPermissions', allowDangerouslySkipPermissions: true,
    maxTurns: 80, systemPrompt: { type: 'preset', preset: 'claude_code', append: SYSTEM },
    mcpServers: { flock: createSdkMcpServer({ name: 'flock', tools }) },
    disallowedTools: ['WebFetch', 'WebSearch', 'Task', 'Agent', 'NotebookEdit'], hooks,
    env: { ...process.env, PATH: NOGIT + path.delimiter + process.env.PATH, ENABLE_TOOL_SEARCH: 'false' },
  } })
  let result = null
  live.add(agent)
  const killer =setTimeout(() => { q.interrupt().catch(() => {}) }, Math.max(1000, CLOCK_MS - now()))
  stops.set(agent, () => q.interrupt().catch(() => {}))
  if (outcome) q.interrupt().catch(() => {})
  try { for await (const m of q) if (m.type === 'result') result = m } catch (e) { ev('session:error', { agent, error: String(e).slice(0, 300) }) }
  clearTimeout(killer); stops.delete(agent)
  if (!st.closed) { await syncFromDisk(agent); await publishCopy(agent); edge('session end ' + agent) }
  usage.push({ agent, task: task.id, turns: result?.num_turns, usage: result?.usage, subtype: result?.subtype, cost_usd: result?.total_cost_usd || 0 })
  ev('session:end', { agent, task: task.id, released: st.released, objected: st.objected, done: st.done, redRuns: st.redRuns, turns: result?.num_turns, usage: result?.usage })
  if (String(task.id).startsWith('R:') && st.done) closeEntries(task.id.slice(2), agent, st.done, 'resolve task done')
  live.delete(agent); if (!st.closed) lastChange = now()
  if (st.closed || outcome) { /* done at the done call, or the run has ended: nothing to give back */ } else if (st.objected) { await objectTo(agent, task, st.objected) } else if (st.released) { await giveBack(agent, task, st.released) } else {
    const red = redOf(runFacts(cwd, task))
    if (red.length) {
      ev('facts:red', { agent, task: task.id, at: 'session-end', exits: red.map((r) => r.exit) })
      await giveBack(agent, task, 'the session ended with red facts: ' + redText(task, red).slice(0, 300))
    } else { await board.done(task); log(agent, 'done', task.id) }
  }
}

async function agentLoop (agent) {
  while (!settled && !outcome && now() < CLOCK_MS) {
    const t = await board.claim(agent)
    if (!t) { await sleep(1500); continue }
    if (outcome) break
    await session(agent, t)
    lastSessionEnd = now()
  }
}

let MAIN_BRANCH = null
let mainOff = null
const MANIFEST = /(^|\/)(package\.json|bun\.lockb?|package-lock\.json|requirements[^/]*\.txt|pyproject\.toml|uv\.lock|poetry\.lock|Pipfile\.lock|Cargo\.(toml|lock)|go\.(mod|sum))$/
function followMain () {
  if (!MEMORY) return
  const ref = gitIn(TARGET, ['symbolic-ref', '-q', 'refs/remotes/origin/HEAD'], { ok: true })
  const name = ref.status === 0 ? ref.stdout.trim() : ''
  if (name.startsWith('refs/remotes/origin/')) MAIN_BRANCH = name.slice('refs/remotes/origin/'.length)
  ev('main:follow', { branch: MAIN_BRANCH, poll_ms: MAIN_POLL_MS })
}
function stopFollowing (reason, more = {}) {
  mainOff = reason
  ev('main:off', { reason, ...more }); log('main: no longer followed —', reason)
  return false
}
function mainTip () {
  const r = spawnSync('git', ['-C', TARGET, 'fetch', '-q', 'origin', `refs/heads/${MAIN_BRANCH}`], { encoding: 'utf8', timeout: 60000 })
  return r.status === 0 ? gitIn(TARGET, ['rev-parse', 'FETCH_HEAD']).stdout.trim() : null
}
function absorbMain (why) {
  if (!MAIN_BRANCH || mainOff || outcome) return Promise.resolve(false)
  const moved = edgeChain.then(() => absorb(why)).catch((e) => stopFollowing('the move could not be taken in: ' + String(e && e.message || e).slice(0, 300)))
  edgeChain = moved
  return moved
}
async function absorb (why) {
  if (mainOff || outcome) return false
  const tip = mainTip()
  if (!tip || tip === BASE_NOW) return false
  if (gitIn(TARGET, ['merge-base', '--is-ancestor', BASE_NOW, tip], { ok: true }).status !== 0) return stopFollowing('main no longer holds the commit this run is based on', { tip })
  const changed = git(['diff', '--name-only', '--no-renames', BASE_NOW, tip]).split('\n').filter(Boolean)
  const next = BASE_DIR + '.next'
  fs.rmSync(next, { recursive: true, force: true })
  writeBase(next, tip)
  const nextPaths = walk(next)
  const r = await weave({ op: 'main', repo: TARGET, commit: tip, remote: 'origin', skip: SKIP.source }).catch((e) => ({ ok: false, error: String(e) }))
  if (!r.ok || !r.moved) {
    fs.rmSync(next, { recursive: true, force: true })
    return stopFollowing(r.ok ? r.reason : String(r.error).slice(0, 300), { tip, paths: r.paths })
  }
  const from = BASE_NOW
  const wasText = new Set(BASE_PATHS), isTextNow = new Set(nextPaths)
  fs.rmSync(BASE_DIR, { recursive: true, force: true }); fs.renameSync(next, BASE_DIR)
  BASE_NOW = tip; RUN_ENV.ULTRA_BASE = tip
  BASE_PATHS = nextPaths
  BASE_FILES = Object.fromEntries(BASE_PATHS.map((p) => [p, readOr(path.join(BASE_DIR, p))]))
  git(['checkout', '-q', '--detach', tip])
  let setup = null
  if (SETUP && changed.some((p) => MANIFEST.test(p))) {
    const old = DEPS_DIR + '.old'
    fs.rmSync(old, { recursive: true, force: true }); fs.renameSync(DEPS_DIR, old)
    fs.cpSync(BASE_DIR, DEPS_DIR, { recursive: true })
    const t0 = Date.now()
    const x = spawnSync(SETUP[0], SETUP.slice(1), { cwd: DEPS_DIR, encoding: 'utf8', timeout: EXAM_MS.setup, env: RUN_ENV })
    setup = { exit: x.status, ms: Date.now() - t0 }
    ev('setup', { cmd: SETUP[SETUP.length - 1], exit: x.status, ms: setup.ms, at: tip })
    if (x.status === 0) fs.rmSync(old, { recursive: true, force: true })
    else { fs.rmSync(DEPS_DIR, { recursive: true, force: true }); fs.renameSync(old, DEPS_DIR) }
    DEP_DIRS = depDirs()
  }
  const other = changed.filter((p) => !SKIP.test(p) && !wasText.has(p) && !isTextNow.has(p))
  for (const a of pool) {
    const dir = agentDir(a)
    for (const p of other) {
      const src = path.join(BASE_DIR, p), dst = path.join(dir, p)
      fs.rmSync(dst, { recursive: true, force: true })
      if (fs.existsSync(src)) { fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.cpSync(src, dst, { verbatimSymlinks: true }) }
    }
    gitIn(dir, ['read-tree', tip]); gitIn(dir, ['update-index', '-q', '--refresh'], { ok: true })
    if (setup) linkDeps(dir)
  }
  fs.writeFileSync(path.join(OUT, 'base'), tip + '\n')
  ev('main:moved', { from, to: tip, why, changed: changed.length, woven: r.paths, other, via: r.via, setup })
  log('main moved', from.slice(0, 12), '->', tip.slice(0, 12), `(${changed.length} file(s), ${r.paths.length} merged as a peer's)`)
  await board.post({ by: 'host', claim: `main moved to ${tip.slice(0, 12)}: ${changed.length} file(s) changed there (${changed.slice(0, 8).join(', ')}${changed.length > 8 ? ', …' : ''}). They merge into every copy like a peer's work, from \`main\`` })
  lastPublish = now(); lastChange = now()
  return true
}
async function mainWatcher () {
  while (MAIN_BRANCH && !mainOff && !settled && !outcome && now() < CLOCK_MS) {
    const due = now() + MAIN_POLL_MS
    while (now() < due && !settled && !outcome) await sleep(500)
    if (await absorbMain('poll')) edge('main moved')
  }
}

let outcome = null
function debounceMs () {
  const xs = [...edgeLatency].sort((a, b) => a - b)
  const p90 = xs.length ? xs[Math.min(xs.length - 1, Math.floor(0.9 * xs.length))] : 500
  return Math.max(1000, 2 * p90)
}
let preLoose = null
let fellBack = false
function terminal (pr, why, r) {
  if (pr === 'draft' && preLoose && !fellBack) {
    fellBack = true
    ev('loose:fallback', { snap: preLoose.snap, from: r && r.snap, why })
    log('LOOSE FALLBACK to', preLoose.snap, why)
    settled = { t: now(), snap: preLoose.snap }; ev('settled', settled)
    pr = 'ready'; why = 'settled green before the loose-ends task; its cleanup was dropped'; r = preLoose
  }
  outcome = { pr, why, snap: r && r.snap, t: now() }
  ev('terminal', outcome); log('TERMINAL', pr, why)
}
async function settle () {
  while (!settled && !outcome && now() < CLOCK_MS) {
    await sleep(500)
    const stalled = () => now() - lastRise > STALL_MS && lastSessionEnd > lastRise
    if (stalled() && (await edgeChain, stalled())) {
      await stall('no-progress', { since_rise_ms: now() - lastRise, limit_ms: STALL_MS, best: bestGreen, live: [...live] })
      terminal('draft', `no progress: the green count has not risen for ${Math.round((now() - lastRise) / 1000)} s`, lastEdge)
      for (const stop of stops.values()) stop()
      break
    }
    const all = [...board.tasks.values()]
    const claimed = all.some((t) => t.state === 'claimed')
    if (!live.size && !claimed && !board.allDone() && !board.readyNow().length && now() - lastChange > debounceMs()) {
      if (objections.length) {
        const o = objections[0], more = objections.length - 1
        terminal('draft', `objection on task ${o.task}: ${o.reason}${more ? ` (and ${more} more)` : ''}`, lastEdge); break
      }
      await stall('deadlock', { left: all.filter((t) => t.state !== 'done').map((t) => ({ id: t.id, state: t.state, depends_on: t.depends_on })) })
      terminal('draft', 'deadlock: work left and nothing claimable', lastEdge); break
    }
    const tested = lastEdge && lastEdge.green && lastEdge.t >= lastPublish
    if (live.size || !board.allDone() || (!tested && now() - lastChange < debounceMs())) continue
    const r = await edge('settle check')
    if (r.green && await absorbMain('settle')) { edge('main moved'); continue }
    if (r.green && !board.tasks.has('L:loose')) {
      const loose = looseEnds(board.beliefs, textAt(r.snap)).filter((x) => x.state !== 'resolved')
      if (loose.length) {
        const paths = [...new Set(loose.map((x) => x.path))]
        preLoose = r
        const body = `Every task's facts and the run-wide check pass, but builders reported loose ends: things outside their tasks' files their changes left stale or broken.\n\n` +
          loose.map((x) => `- \`${x.path}\`: ${x.claim} (posted by ${x.by})${x.stale !== undefined ? `; the text still wrong there: ${JSON.stringify(x.stale)}` : ''}`).join('\n') +
          `\n\nFix each that is still wrong. Change only what a loose end names: leave other builders' lines as they are, and post a belief if one of them needs changing. If you judge one should stay as it is, leave it and post a belief saying why. Run the run-wide check, publish, then call done.`
        await board.addTask({ id: 'L:loose', title: LOOSE_TITLE, depends_on: [], state: 'ready', owner: null, notes: [], reopen: 0, facts: [], files: paths, body })
        ev('loose-task', { snap: r.snap, paths, body }); log('loose-ends task for', paths.join(','))
        lastRise = now()
        continue
      }
    }
    if (r.green) { settled = { t: now(), snap: r.snap }; ev('settled', settled); log('SETTLED on', r.snap); terminal('ready', 'settled green', r); break }
    let acted = false
    for (const t of all) {
      const bad = (r.perTask[t.id] || []).some((x) => x !== 0)
      if (!bad) continue
      if (t.reopen >= MAX_REOPEN) continue
      acted = true
      t.reopen += 1
      const here = [...spots.values()].filter((x) => (t.files || []).includes(x.p)).map((x) => x.text)
      await board.reopen(t, `edge snapshot ${r.snap} is red on this task's facts ${JSON.stringify(r.perTask[t.id])}; check exit ${r.check}` +
        (here.length ? `. Look here first: ${here.join('; ')}` : ''))
      await board.post({ by: 'host', claim: `edge red on task ${t.id} at snapshot ${r.snap}`, task: t.id })
      ev('reopen', { task: t.id, snap: r.snap, n: t.reopen }); log('reopen task', t.id, 'at', r.snap)
    }
    for (const p of r.blocking || []) {
      const id = 'R:' + p
      if (board.tasks.has(id) && board.tasks.get(id).state !== 'done') continue
      const prev = board.tasks.get(id)
      if (prev && prev.reopen >= MAX_REOPEN) continue
      acted = true
      const ann = (openEntries(p)[0] || {}).annotated || (r.annotated || {})[p]
      const made = openEntries(p).some((e) => e.made)
      await board.addTask({ id, title: 'Resolve conflict marks in ' + p, depends_on: [], state: 'ready', owner: null, notes: [], reopen: prev ? prev.reopen + 1 : 0, facts: [],
        body: `${made ? `Main and a builder each created \`${p}\` without seeing the other's, and the merge put one whole file after the other. It must become one file that keeps what main's version does and what the builder's does` : `Two agents changed the same part of \`${p}\` and the merge marked it as a conflict`}. Here is the merged file with the conflict sections marked (<<<<<<< begin … / ======= begin … / >>>>>>> end conflict; "left" and "right" are the two sides):\n\n\`\`\`\n${ann || '(annotation unavailable)'}\n\`\`\`\n\nYour copy holds the merged text WITHOUT the markers. Make that part of \`${p}\` say what both sides meant (edit with Edit if it does not already), run the tests, then call resolve_conflict for \`${p}\` and then done.` })
      ev('resolve-task', { path: p, snap: r.snap }); log('resolve task for', p)
    }
    if (W.check && r.check !== 0 && all.every((t) => (r.perTask[t.id] || []).every((x) => x === 0))) {
      ev('red-check-only', { snap: r.snap, tail: r.checkTail }); log('check red with every fact green')
      const prev = board.tasks.get('C:check')
      if (!prev || (prev.state === 'done' && prev.reopen < MAX_REOPEN)) {
        acted = true
        await stall('check_red', { snap: r.snap, tail: (r.checkTail || '').slice(-300) })
        await board.addTask({ id: 'C:check', title: 'Make the run-wide check green', depends_on: [], state: 'ready', owner: null, notes: [], reopen: prev ? prev.reopen + 1 : 0, facts: [W.check],
          body: `Every task's facts pass on the merged code, but the run-wide check does not. Its output ends:\n\n\`\`\`\n${(r.checkTail || '').slice(-600)}\n\`\`\`\n\nFix the cause (prefer not to rewrite a peer's lines; post a belief if the fix is theirs), run the check, publish, then done.` })
      }
    }
    if (!acted) {
      await stall('exhausted', { snap: r.snap, perTask: r.perTask, check: r.check, blocking: r.blocking })
      terminal('draft', 'exhausted: red or blocked with every retry spent', r); break
    }
  }
  if (!outcome) terminal('draft', 'clock', lastEdge)
}

await must({ op: 'base', root: BASE_DIR, paths: BASE_PATHS })
const memoryRead = await weave({ op: 'memory', repo: TARGET, commit: BASE_SHA, remote: 'origin' }).catch((e) => ({ ok: false, error: String(e) }))
const MEMORY = !!(memoryRead.ok && memoryRead.memory)
ev('weave:memory', memoryRead.ok ? { ...memoryRead, ok: undefined } : { memory: false, reason: String(memoryRead.error).slice(0, 300) })
log('memory', MEMORY ? `${memoryRead.via} entry, ${memoryRead.installed} of ${memoryRead.stored} stored paths at base` : 'none: ' + (memoryRead.reason || memoryRead.error))
ev('start', { workload: W.name, cap: CAP, model: MODEL, clock_ms: CLOCK_MS, pulls: 'narrow', chain: Object.fromEntries(board.cp) })
log(`workload ${W.name}, elastic builders (cap ${CAP}), ${MODEL}, out ${OUT}`)
let PAST = null
{
  const dir = arg('past-dir')
  if (dir) {
    try {
      const m = Number(path.basename(path.resolve(dir)))
      if (!Number.isInteger(m) || m < 1) throw new Error(`past dir ${dir} is not named by a run number`)
      const text = (f) => fs.readFileSync(path.join(dir, f), 'utf8')
      const status = JSON.parse(text('status.json'))
      const events = readEventRows(path.join(dir, 'events.jsonl'))
      let redChecks = null
      try { redChecks = JSON.parse(text('red-checks.json')) } catch { /* no red checks recorded */ }
      const items = pastItems({ status, events, redChecks })
      ev('past', { run: m, items: items ? items.length : 0 })
      if (items) {
        PAST = { run: m, items }
        fs.writeFileSync(path.join(OUT, 'past.json'), JSON.stringify(PAST, null, 2) + '\n')
      }
      log('past: run-' + m, items ? items.length + ' items' : 'finished green')
    } catch (e) { log('past: nothing read —', String(e.message || e).split('\n')[0]) }
  }
}
if (W.stories) {
  const first = W.tasks.find((t) => t.facts.length)
  const r = runFacts(SETUP ? DEPS_DIR : BASE_DIR, { facts: [first.facts[0]] })[0]
  ev('checker:start', { exit: r.exit })
  if (r.exit !== 0 && r.exit !== 1) {
    await stall('checker', { tail: r.tail.slice(-300) })
    terminal('draft', 'the checker cannot run on this sandbox: ' + r.tail.slice(-300), null)
  }
}
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const pool = []
lastRise = now()
const loops = []
let buildersMax = pool.length
const busy = (a) => live.has(a) || [...board.tasks.values()].some((t) => t.state === 'claimed' && t.owner === a)
function openBuilder () {
  const a = pool.length < 26 ? LETTERS[pool.length] : LETTERS[pool.length % 26] + Math.floor(pool.length / 26)
  fs.cpSync(BASE_DIR, agentDir(a), { recursive: true }); linkDeps(agentDir(a)); gitCopy(agentDir(a))
  known[a] = new Set(BASE_PATHS)
  pool.push(a); buildersMax = Math.max(buildersMax, pool.length)
  ev('builder:open', { agent: a, pool: pool.length, ready: board.readyNow().length, busy: pool.filter(busy).length })
  log('opens builder', a, '(pool ' + pool.length + ')')
  loops.push(agentLoop(a))
}
async function spawner () {
  while (!settled && !outcome && now() < CLOCK_MS) {
    const want = board.readyNow().length - pool.filter((a) => !busy(a)).length
    for (let i = 0; i < want && pool.length < CAP; i++) openBuilder()
    await sleep(500)
  }
}
followMain()
await absorbMain('start')
await Promise.all([spawner(), settle(), mainWatcher()])
await Promise.all(loops)
await edgeChain
for (const row of stepReceipts([...latestResults(CHECK_OUT).values()])) ev('step:receipt', row)
try { fs.writeFileSync(path.join(OUT, 'checks-digest.json'), JSON.stringify(checkDigest(CHECK_OUT), null, 1)) } catch (e) { log('engine', `checks-digest: ${e.message}`) }
const looseSnap = outcome && outcome.pr === 'ready' ? outcome.snap : lastEdge ? lastEdge.snap : null
const looseItems = looseEnds(board.beliefs, textAt(looseSnap))
ev('loose-ends', { snap: looseSnap, items: looseItems })
const addedParts = newParts(BASE_FILES[DRAWS] ?? null, textAt(looseSnap)(DRAWS))
if (addedParts.length) ev('parts:new', { snap: looseSnap, parts: addedParts })
const summary = {
  workload: W.name, builders_max: buildersMax, cap: CAP, model: MODEL, settled, wall_ms: now(),
  base: BASE_NOW,
  final: lastEdge && { snap: lastEdge.snap, green: lastEdge.green, perTask: lastEdge.perTask, check: lastEdge.check, conflicts: lastEdge.conflicts },
  snapshots: snapshots.length, beliefs: board.beliefs.length,
  loose_ends: { reported: looseItems.length, resolved: looseItems.filter((x) => x.state === 'resolved').length },
  outcome, debounce_ms: debounceMs(),
  attached: outcome && outcome.pr === 'draft' ? { stalls, open_conflicts: [...ledger.values()].filter((e) => e.open).map((e) => ({ path: e.path, region: e.region, between: e.between })), last_edge: lastEdge && { snap: lastEdge.snap, perTask: lastEdge.perTask, check: lastEdge.check } } : undefined,
  tokens: usage.reduce((a, u) => ({ input: a.input + (u.usage?.input_tokens || 0), output: a.output + (u.usage?.output_tokens || 0), cache_read: a.cache_read + (u.usage?.cache_read_input_tokens || 0), cache_write: a.cache_write + (u.usage?.cache_creation_input_tokens || 0) }), { input: 0, output: 0, cache_read: 0, cache_write: 0 }),
  sessions: usage.length,
  cost_usd: Math.round(usage.reduce((a, u) => a + (u.cost_usd || 0), 0) * 1000) / 1000,
}
fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 1))
fs.writeFileSync(path.join(OUT, 'board.json'), JSON.stringify(await board.read(), null, 1))
writeCompactRecord()
writeFailureRecord()
log('summary', JSON.stringify(summary))
const JOIN = { blame: (await weave({ op: 'blame' })).blame || {}, files: (await weave({ op: 'merged' })).files || {} }
const landed = await land()
keeper.end()
process.exit(landed)

function writeCompactRecord () {
  const lines = fs.readFileSync(path.join(OUT, 'weave-ops.jsonl'), 'utf8').split('\n')
  const rec = compactRecord(snapshots, BASE_FILES_0, lines)
  fs.writeFileSync(path.join(OUT, 'snapshots.jsonl'), rec.snapshots)
  fs.writeFileSync(path.join(OUT, 'weave-ops.digest.jsonl'), rec.digest)
}

function commitSnapshot (snap, message) {
  const s = snapshots.find((x) => x.snap === snap)
  if (!s) return null
  writeFiles(TARGET, snapshotEntries(s))
  git(['add', '-A'])
  if (!git(['status', '--porcelain']).trim()) return null
  git(['commit', '-qm', message], { identity: true })
  return git(['rev-parse', 'HEAD']).trim()
}
async function storeEntry (sha) {
  if (!MEMORY) return
  const r = await weave({ op: 'store', repo: TARGET, commit: sha, run: RUN_NO }).catch((e) => ({ ok: false, error: String(e) }))
  ev('weave:store', r.ok ? { commit: sha, ...r, ok: undefined } : { commit: sha, stored: false, reason: String(r.error).slice(0, 300) })
  log('memory', r.ok && r.stored ? `stored ${r.paths} changed path(s) for ${sha.slice(0, 12)}` : 'not stored: ' + (r.reason || r.error))
}
async function land () {
  if (outcome && outcome.pr === 'ready' && outcome.snap) {
    const sha = commitSnapshot(outcome.snap, `flock: settled ${outcome.snap}`)
    if (!sha) {
      ev('landing:empty', { snap: outcome.snap, grammar: W.grammar })
      return W.grammar === 'stories-v1' ? 0 : 1
    }
    for (const t of W.tasks) ev('landing', { task: t.id, candidateSha: sha })
    await storeEntry(sha)
    writeProvenance(outcome.snap)
    return 0
  }
  if (lastEdge) {
    const sha = commitSnapshot(lastEdge.snap, `flock: draft ${lastEdge.snap}`)
    if (sha) {
      await storeEntry(sha)
      writeProvenance(lastEdge.snap)
      for (const t of W.tasks) {
        if ((lastEdge.perTask[t.id] || []).some((x) => x !== 0)) ev('parked', { task: t.id, reason: `red at ${lastEdge.snap}` })
      }
    }
  }
  return 1
}

function writeProvenance (snap) {
  try {
    const s = snapshots.find((x) => x.snap === snap)
    if (!s) return
    const landed = Object.fromEntries(Object.entries(s.files).filter(([p]) => s.exists[p]))
    const blame = Object.fromEntries(Object.entries(JOIN.blame).filter(([p]) => p in landed && JOIN.files[p] === landed[p]))
    const events = readEventRows(path.join(OUT, 'events.jsonl'))
    const prov = buildProvenance({ landed, blame, events, lost: s.lost || [] })
    fs.writeFileSync(path.join(OUT, 'provenance.json'), JSON.stringify({ snap, ...prov }, null, 1))
  } catch (e) {
    ev('provenance:error', { snap, error: String(e && e.message || e).slice(0, 500) })
  }
}

function writeFailureRecord () {
  const LIMIT = 65536
  const rec = { snap: lastEdge ? lastEdge.snap : null, limit_bytes: LIMIT, truncated: false, red: [] }
  const cands = lastEdge ? [...(lastEdge.red || [])] : []
  if (lastEdge && W.check && lastEdge.check !== 0) cands.push({ task: 'check', cmd: W.check.join(' '), exit: lastEdge.check, tail: lastEdge.checkTail || '' })
  let size = Buffer.byteLength(JSON.stringify(rec))
  for (const c of cands) {
    const e = { ...c }
    if (c.clause) {
      const f = path.join(CHECK_OUT, `${String(c.clause).replaceAll('/', '_')}@edge.json`)
      try { if (fs.statSync(f).size <= 8192) e.checker = JSON.parse(fs.readFileSync(f, 'utf8')) } catch { /* no checker result */ }
    }
    const n = Buffer.byteLength(JSON.stringify(e)) + 1
    if (size + n > LIMIT) { rec.truncated = true; continue }
    size += n; rec.red.push(e)
  }
  fs.writeFileSync(path.join(OUT, 'red-checks.json'), JSON.stringify(rec, null, 1))
}

