#!/usr/bin/env node
// PROTOTYPE — throwaway (map #1292, ticket 4). The Flock on the laptop.
//
//   node flock/proto/host.mjs --workload widgetkit|inventory [--agents 3]
//        [--model claude-opus-5-5] [--clock 1800] [--quiet 45] [--tag r1]
//
// Question it answers: with N agents working one plan together, each on its own
// copy, merging with each other between tool batches, does the swarm settle on
// green code; what does half-finished peer work cost (gap 4); how does settling
// behave (gap 6); what load does the board take (gap 7, stand-in board).
//
// The host is code, not a model: it seeds the board, runs each agent's session,
// keeps every copy's weave (flock/proto/weave.py), merges peers after each tool
// batch, and tests every published snapshot at the edge. Agents pull their own
// work from the board and never run git.
import { query, createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { spawn, spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'
import { WORKLOADS, writeBase } from './workloads.mjs'
import { makeBoard } from './flock_board.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d }
const W = WORKLOADS[arg('workload', 'widgetkit')]
const N = Number(arg('agents', 3))
const MODEL = arg('model', 'claude-opus-5-5')
const CLOCK_MS = Number(arg('clock', 1800)) * 1000
const QUIET_MS = Number(arg('quiet', 45)) * 1000
// explicit: an agent publishes when it calls publish (and the host publishes at session end,
// released or done); batch: the host also publishes the agent's copy after every tool batch
// in which it changed (map Q4, operator 2026-09-25)
const PUBLISH = arg('publish', 'explicit')
const dirty = {}
// ticket 5 (settling): `debounce` settles once nothing can change the merged code (no live
// session, nothing ready or claimed) and the edge has tested the latest hash, after D =
// max(1 s, 2 x this run's p90 publish->edge latency). `quiet` is the rollback: the fixed window.
const SETTLE = arg('settle', 'debounce')
const MAX_REOPEN = 3
const NAMES = ['A', 'B', 'C', 'D', 'E'].slice(0, N)
const STAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const OUT = path.join(HERE, 'runs', `${W.name}-${arg('tag', 'r')}-${STAMP}`)
const T0 = Date.now()
const now = () => Date.now() - T0

fs.mkdirSync(OUT, { recursive: true })
const EV = fs.openSync(path.join(OUT, 'events.jsonl'), 'a')
const ev = (kind, o = {}) => fs.writeSync(EV, JSON.stringify({ t: now(), kind, ...o }) + '\n')
const log = (...a) => console.log(`[${(now() / 1000).toFixed(1).padStart(6)}s]`, ...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── the weave keeper ──────────────────────────────────────────────────────────
const wp = spawn('python3', [path.join(HERE, 'weave.py')], { stdio: ['pipe', 'pipe', 'inherit'] })
const waiting = []
readline.createInterface({ input: wp.stdout }).on('line', (l) => waiting.shift()(JSON.parse(l)))
const OPS = fs.openSync(path.join(OUT, 'weave-ops.jsonl'), 'a')
const weave = (o) => new Promise((res) => {
  if (['base', 'edit', 'rewrite', 'publish', 'pull'].includes(o.op)) fs.writeSync(OPS, JSON.stringify({ t: now(), ...o }) + '\n')
  waiting.push(res); wp.stdin.write(JSON.stringify(o) + '\n')
})
const must = async (o) => { const r = await weave(o); if (!r.ok) throw new Error('weave ' + o.op + ': ' + r.error); return r }

// ── files ─────────────────────────────────────────────────────────────────────
const SKIP = /(^|\/)(__pycache__|\.pytest_cache|node_modules)(\/|$)|\.pyc$/
function walk (dir, rel = '') {
  const out = []
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const p = rel ? rel + '/' + e.name : e.name
    if (SKIP.test(p)) continue
    if (e.isDirectory()) out.push(...walk(dir, p)); else out.push(p)
  }
  return out
}
const readOr = (f) => { try { return fs.readFileSync(f, 'utf8') } catch { return null } }
const BASE_DIR = path.join(OUT, 'base')
writeBase(W, BASE_DIR)
const BASE_PATHS = walk(BASE_DIR)
const agentDir = (a) => path.join(OUT, 'agents', a)
for (const a of NAMES) { fs.cpSync(BASE_DIR, agentDir(a), { recursive: true }) }
const known = Object.fromEntries(NAMES.map((a) => [a, new Set(BASE_PATHS)]))

// ── the board: the stand-in (default) or real Kata (--board kata); every op timed for gap 7 ──
const BOARD = arg('board', 'standin')
const board = await makeBoard(BOARD, { tasks: W.tasks, now, runName: path.basename(OUT), url: arg('kata-url', 'http://127.0.0.1:7777') })
const READS = new Set(['ping', 'ready', 'list', 'beliefs', 'read'])

// ── edit-location errors (gap 3 at scale): an Edit the tool refused, by why ──
const editFailures = { not_unique: 0, not_found: 0, stale: 0, other: 0 }
const failKind = (err) => /Found \d+ matches|multiple|not unique/i.test(err) ? 'not_unique'
  : /not found|did not match|no match/i.test(err) ? 'not_found'
    : /modified since|has not been read|read it first/i.test(err) ? 'stale' : 'other'

// ── facts ─────────────────────────────────────────────────────────────────────
function runFacts (cwd, task) {
  return task.facts.map((cmd) => {
    const r = spawnSync(cmd[0], cmd.slice(1), { cwd, encoding: 'utf8', timeout: 60000, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } })
    return { exit: r.status ?? 124, tail: ((r.stdout || '') + (r.stderr || '')).slice(-800) }
  })
}
const TRACE = /File "([^"]+)", line (\d+)/g
async function blame (agent, cwd, output) {
  // gap 4: whose line does a red point at? the last in-copy frame of the traceback
  const hits = [...output.matchAll(TRACE)].map((m) => [m[1], Number(m[2])]).filter(([f]) => f.startsWith(cwd + '/') || !f.startsWith('/'))
  if (!hits.length) return { cause: 'unknown' }
  const [f, line] = hits[hits.length - 1]
  const rel = f.startsWith(cwd + '/') ? f.slice(cwd.length + 1) : f
  // ticket 2 fix (a): authorship by identity (authors_keyed), not by text, which names a
  // repeated BASE line's author wrongly (research/identity/keys.log). "A|B" = both wrote it.
  const r = await weave({ op: 'authors_keyed', agent, path: rel })
  const who = r.ok ? r.authors[line - 1] : null
  const whoSet = who ? who.split('|') : []
  return { cause: !who ? 'unknown' : whoSet.includes(agent) ? 'own' : who === 'base' ? 'base' : 'peer:' + who, path: rel, line }
}

// peer lines an agent's change removed or replaced, by identity: the fall, per peer, in the
// count of visible lines that peer wrote (an agent's own change never adds a peer's line)
async function keyedOwners (agent, rel) {
  const r = await weave({ op: 'authors_keyed', agent, path: rel })
  const c = {}
  if (!r.ok) return c
  for (const a of r.authors) if (a !== 'base' && !a.split('|').includes(agent)) c[a] = (c[a] || 0) + 1
  return c
}
function peerFall (before, after) {
  let n = 0; const peers = new Set()
  for (const [who, k] of Object.entries(before)) { const d = k - (after[who] || 0); if (d > 0) { n += d; who.split('|').forEach((x) => peers.add(x)) } }
  return { peer: n, peers: [...peers] }
}

// ── keeping a copy's weave in step with its files ─────────────────────────────
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
    const r = await must({ op: 'rewrite', agent, path: p, content: text })
    drift += 1
    ev('fallback', { agent, path: p, peer_lines: r.peer_lines_touched, deleted: text === null })
  }
  return drift
}

function editSpans (before, old, neu, all) {
  const idxs = []
  let i = before.indexOf(old)
  while (i >= 0) { idxs.push(i); if (!all) break; i = before.indexOf(old, i + old.length) }
  return idxs.reverse().map((idx) => {
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
    let h = 0
    while (h < oldLines.length && h < newLines.length && oldLines[h] === newLines[h]) h++
    let t = 0
    while (t < oldLines.length - h && t < newLines.length - h && oldLines[oldLines.length - 1 - t] === newLines[newLines.length - 1 - t]) t++
    return { vstart: ls + h, vend: ls + oldLines.length - t, lines: newLines.slice(h, newLines.length - t) }
  })
}

async function recordEditCall (agent, rel, before, edits) {
  let text = before, peerText = 0
  const owners0 = await keyedOwners(agent, rel)
  for (const e of edits) {
    for (const s of editSpans(text, e.old_string, e.new_string, e.replace_all)) {
      const r = await must({ op: 'edit', agent, path: rel, ...s })
      peerText += r.peer_lines_touched
    }
    text = e.replace_all ? text.split(e.old_string).join(e.new_string) : text.replace(e.old_string, () => e.new_string)
  }
  return { ...peerFall(owners0, await keyedOwners(agent, rel)), peerText }
}

// ── the conflict ledger: Manyana recomputes conflicts per merge and stores none, so the
// host keeps them: a conflict opens when a merge flags it and closes only when an agent
// says so (resolve_conflict), or at once when both sides only added lines (the union) ──
// ticket 5: the ledger is keyed by path AND region, the hash of the marked hunks' two sides
// (sorted, so a pull's merge and the edge's merge name the same region). Manyana re-flags a
// region it has already flagged on every merge; a closed region stays closed, and only a
// DIFFERENT region on the same path opens a new entry. Closing a path closes its regions.
const ledger = new Map()   // `${path}\u0000${region}` -> entry
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
  if (e) { e.seen += 1; if (!e.open) ev('conflict:reflag', { path: p, region: reg }); return }   // a stale re-flag never reopens
  if (info.addsOnly) { ev('conflict:union', { path: p, ...info, annotated: undefined }); return }
  ledger.set(p + '\u0000' + reg, { path: p, region: reg, open: true, t: now(), seen: 1, annotated: info.annotated, between: info.between })
  lastChange = now()
  ev('conflict:open', { path: p, region: reg, between: info.between })
  await board.post({ by: 'host', claim: `open conflict in ${p} between ${info.between.join(' and ')}; whoever next works there should make it say what both sides meant and call resolve_conflict`, confidence: 1 })
}
const openConflicts = () => [...new Set([...ledger.values()].filter((e) => e.open).map((e) => e.path))]
const openEntries = (p) => [...ledger.values()].filter((e) => e.open && e.path === p)
function closeEntries (p, by, note, via) {
  for (const e of openEntries(p)) {
    e.open = false; e.closed_by = by; e.closed_t = now(); e.note = String(note).slice(0, 200)
    ev('conflict:close', { path: p, region: e.region, by, note: e.note, via })
  }
  lastChange = now()
}
let lastChange = 0          // the last time the merged code's hash, a session, or the ledger changed
const live = new Set()      // agents with a session open right now
const stalls = []           // stall beliefs the host posted (attached to a draft PR)
async function stall (kind, evidence) {
  const b = await board.post({ by: 'host', claim: `stall: ${kind} ${JSON.stringify(evidence).slice(0, 300)}`, confidence: 1 })
  stalls.push({ kind, evidence, t: now() }); ev('stall', { kind, evidence }); log('STALL', kind, JSON.stringify(evidence).slice(0, 200))
  return b
}

// ── the edge: every published snapshot is tested; main takes a green, settled one ──
let edgeChain = Promise.resolve()
let lastEdge = null
const snapshots = []
let bestGreen = -1, sinceBest = 0
const edgeLatency = []      // publish -> tested, ms (the propagation delay the debounce covers)
function edge (reason) {
  const asked = now()
  edgeChain = edgeChain.then(async () => {
    const m = await must({ op: 'merged' })
    const snap = crypto.createHash('sha1').update(JSON.stringify(m.files)).digest('hex').slice(0, 10)
    if (lastEdge && lastEdge.snap === snap) {
      // ticket 5: the facts on a hash never change, but what blocks it does (a close with no
      // text change). Recompute the verdict from the ledger now: a cached `blocking` was the
      // answer after 5 of 9 closes on the record, masked each time by a later content change.
      for (const p of m.conflicts) await openConflict(p, { addsOnly: !!m.addsOnly[p], annotated: m.annotated[p], between: ['published copies'] })
      const blocking = openConflicts()
      const factsGreen = Object.values(lastEdge.perTask).every((xs) => xs.every((x) => x === 0))
      lastEdge = { ...lastEdge, t: now(), reason, blocking, green: factsGreen && lastEdge.check === 0 && !blocking.length }
      return lastEdge
    }
    lastChange = now()
    const dir = path.join(OUT, 'edge')
    fs.rmSync(dir, { recursive: true, force: true }); fs.cpSync(BASE_DIR, dir, { recursive: true })
    for (const [p, text] of Object.entries(m.files)) {
      const f = path.join(dir, p)
      if (m.exists[p]) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text) } else fs.rmSync(f, { force: true })
    }
    const perTask = {}
    for (const t of board.tasks.values()) perTask[t.id] = runFacts(dir, t).map((r) => r.exit)
    const chk = spawnSync(W.check[0], W.check.slice(1), { cwd: dir, encoding: 'utf8', timeout: 120000, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } })
    const factsGreen = Object.values(perTask).every((xs) => xs.every((x) => x === 0))
    // ticket 5: every region the edge sees goes through the ledger. The old `!ledger.has(p)`
    // let a NEW conflict on a once-closed path pass the edge unexamined.
    for (const p of m.conflicts) await openConflict(p, { addsOnly: !!m.addsOnly[p], annotated: m.annotated[p], between: ['published copies'] })
    for (const [p, fl] of Object.entries(m.sameAnchor || {})) await sameSpot(p, fl, ['published copies'], null)
    const blocking = openConflicts()
    lastEdge = { snap, t: now(), reason, perTask, check: chk.status, checkTail: ((chk.stdout || '') + (chk.stderr || '')).slice(-600), conflicts: m.conflicts, blocking, annotated: m.annotated, green: factsGreen && chk.status === 0 && !blocking.length }
    snapshots.push({ snap, t: now(), files: m.files })
    edgeLatency.push(now() - asked)
    // ticket 5: livelock, record-only. Facts rose on every new snapshot of every recorded run
    // (0 regressions over 53 edges, n=15 runs), so K snapshots with no new best is unseen: it
    // posts a stall belief and changes nothing (an experiment; rollback: delete this block).
    const g = Object.values(perTask).reduce((a, xs) => a + xs.filter((x) => x === 0).length, 0) + (chk.status === 0 ? 1 : 0)
    if (g > bestGreen) { bestGreen = g; sinceBest = 0 } else if (++sinceBest === 2 * board.tasks.size) await stall('livelock', { snap, snapshots_without_progress: sinceBest, best: bestGreen })
    ev('edge', { ...lastEdge, checkTail: undefined, annotated: undefined })
    log('edge', snap, lastEdge.green ? 'GREEN' : 'red', JSON.stringify(perTask), 'check', chk.status, m.conflicts.length ? 'conflicts ' + m.conflicts + ' (blocking: ' + (blocking.join(',') || 'none') + ')' : '')
    return lastEdge
  })
  return edgeChain
}

// ── one agent session on one claimed task ─────────────────────────────────────
const usage = []
let lastPublish = 0
let settled = null
const SYSTEM = `You are one of ${N} agents working on the same repository at the same time, with no one directing you.
Each agent works in its own copy. Other agents' published work is merged into your copy between your tool calls; when that happens you receive a note naming the files that changed. Re-read a file before editing it if a note says it changed.
Rules:
- Change an existing file only with the Edit tool. New files may be created any way you like. Shell commands must not overwrite, move or delete existing files.
- Never run git.
- Run tests with: python3 -m pytest -q -p no:cacheprovider
- Use the flock tools: board_read (tasks and beliefs), post_belief (tell the others something true and useful, with how sure you are), run_proof (your task's facts, on your copy), publish (share your copy's changes), release (give the task back if you are blocked), done (your task is finished).
${PUBLISH === 'batch' ? '- Your changes are published to the others automatically after each of your tool batches, finished or not; publish is still there when you want to be sure.' : '- Publish whenever your change is coherent, so the others build on it.'}
- If something fails because of another agent's unfinished work, prefer not to rewrite their lines: post a belief saying what you saw, and carry on with your own part.
- If a note says a file merged with conflict marks, look at that part of the file. When it says what both sides meant (edit it if not), call resolve_conflict for that file.
- When your task's facts pass on your copy, publish, then call done.`

async function pullInto (agent) {
  const r = await must({ op: 'pull', agent })
  const dir = agentDir(agent)
  for (const c of r.changed) {
    const f = path.join(dir, c.path)
    known[agent].add(c.path)
    if (c.exists) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, c.text) } else fs.rmSync(f, { force: true })
  }
  if (r.changed.length) ev('pull', { agent, changed: r.changed.map((c) => ({ path: c.path, from: c.from, added: c.added, removed: c.removed, conflict: c.conflict })) })
  for (const c of r.changed.filter((x) => x.conflict)) await openConflict(c.path, { addsOnly: c.addsOnly, annotated: c.annotated, between: [agent, c.from] })
  for (const s of r.sameAnchor || []) await sameSpot(s.path, s.flags, [agent, s.from], agent)
  return r.changed
}

// ── ticket 2 fix (b): two agents inserting at one spot. The kernel orders such lines by their
// text and an adds-only union hid it; the keeper now flags it (`siblings`, or `unified` when
// one side's block starts with the other's line and the kernel flags nothing). Each distinct
// spot becomes a fact on the board and a note to the agents whose copies carry it. ──
const spots = new Map()
const spotNotes = {}
async function sameSpot (p, flags, between, agent) {
  for (const f of flags || []) {
    const key = [p, f.kind, f.anchor, (f.lines || []).join('\n')].join('\u0000')
    const text = `${f.kind === 'unified' ? 'one block starts with the other\'s line' : 'two insertions'} at one spot in ${p}, after ${JSON.stringify(f.anchor)}: ${JSON.stringify(f.lines).slice(0, 200)} (by ${(f.authors || between).join(' and ')}); the merge chose their order by text, so check the order says what both meant`
    if (agent) (spotNotes[agent] = spotNotes[agent] || new Set()).add(text)
    if (spots.has(key)) continue
    spots.set(key, { p, f, t: now() })
    ev('same-anchor', { path: p, flag: f.kind, anchor: f.anchor, lines: f.lines, authors: f.authors, between })
    await board.post({ by: 'host', claim: text, confidence: 1 })
  }
}

async function session (agent, task) {
  const cwd = agentDir(agent)
  const st = { released: false, done: false, redRuns: 0 }
  const pre = new Map()
  await pullInto(agent)
  const say = (text) => ({ content: [{ type: 'text', text }] })
  const tools = [
    tool('board_read', 'Read the board: every task with its state and owner, and the latest beliefs.', {}, async () => say(JSON.stringify(await board.read(), null, 1))),
    tool('post_belief', 'Post a belief for the other agents: something you believe is true, how sure you are (0 to 1), and which task it concerns.',
      { claim: z.string(), confidence: z.number(), task: z.string().optional() },
      async (a) => { const b = await board.post({ by: agent, claim: a.claim, confidence: a.confidence, task: a.task }); ev('belief', b); return say('posted belief ' + b.id) }),
    tool('run_proof', "Run a task's facts on your copy (default: your own task). Each fact is a command; exit 0 means it holds.",
      { task: z.string().optional() },
      async (a) => {
        const t = board.tasks.get(a.task || task.id) || task
        const res = runFacts(cwd, t)
        const red = res.filter((r) => r.exit !== 0)
        const causes = []
        for (const r of red) causes.push(await blame(agent, cwd, r.tail))
        ev('proof', { agent, task: t.id, exits: res.map((r) => r.exit), causes, errs: red.map((r) => (r.tail.match(/^\w*(Error|Exception)\b.*$/gm) || ['']).pop().slice(0, 160)) })
        return say(res.map((r, i) => `fact ${i + 1}: exit ${r.exit}${r.exit ? '\n' + r.tail : ''}`).join('\n'))
      }),
    tool('publish', "Publish your copy's changes so the other agents receive them.", {},
      async () => { await syncFromDisk(agent); await must({ op: 'publish', agent }); lastPublish = now(); ev('publish', { agent, task: task.id }); await board.publish(agent, task.id); edge('publish ' + agent); return say('published') }),
    tool('resolve_conflict', 'Close an open conflict in a file: the text in your copy now says what both sides meant (edit it first with Edit if it did not).',
      { path: z.string(), note: z.string() },
      async (a) => {
        if (!openEntries(a.path).length) return say('no open conflict in ' + a.path)
        await syncFromDisk(agent); await must({ op: 'publish', agent }); lastPublish = now()
        closeEntries(a.path, agent, a.note, 'resolve_conflict'); edge('resolve ' + agent)
        return say('conflict in ' + a.path + ' closed and your copy published')
      }),
    tool('release', 'Give your task back to the board because you are blocked. Say why.', { reason: z.string() },
      async (a) => { st.released = a.reason; return say('released; end your turn now') }),
    tool('done', 'Your task is finished: its facts pass on your copy and you have published.', { summary: z.string() },
      async (a) => { st.done = a.summary; return say('marked done; end your turn now') }),
  ]
  const hooks = {
    PreToolUse: [{ hooks: [async (input) => {
      const ti = input.tool_input || {}
      ev('tool', { agent, task: task.id, tool: input.tool_name, target: String(ti.file_path || ti.command || '').slice(0, 120) })
      if (input.tool_name === 'Bash' && /(^|[;&|(\s])git(\s|$)/.test(ti.command || '')) {
        return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'agents never run git' } }
      }
      if (input.tool_name === 'Bash') {
        const cmd = ti.command || ''
        const redirects = [...cmd.matchAll(/(?:^|[^<>&0-9])>{1,2}\s*([^\s|;&<>()]+)/g)].map((m) => m[1]).filter((t) => t !== '/dev/null' && !t.startsWith('&'))
        const overwrites = redirects.some((t) => { const f = path.resolve(cwd, t); return f.startsWith(cwd + '/') && fs.existsSync(f) })
        if (overwrites || /\bsed\s+-[a-zA-Z]*i|\bperl\s+-[a-zA-Z]*i|\b(mv|cp|rm)\s/.test(cmd)) {
          ev('deny:shell-write', { agent, task: task.id, command: cmd.slice(0, 160) })
          return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny',
            permissionDecisionReason: 'In this repository an existing file changes only through the Edit tool, so every change is recorded exactly and merges with the other agents. A shell command may create a NEW file, and may read and run anything, but may not overwrite, move or delete an existing file.' } }
        }
      }
      if (['Edit', 'MultiEdit', 'Write'].includes(input.tool_name)) {
        const fp = path.resolve(cwd, ti.file_path || '')
        if (!fp.startsWith(cwd + '/')) return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'outside your copy' } }
        await syncFromDisk(agent)
        pre.set(input.tool_use_id, readOr(fp))
      }
      return {}
    }] }],
    PostToolUse: [{ hooks: [async (input) => {
      const ti = input.tool_input || {}
      const name = input.tool_name
      ev('tool:post', { agent, tool: name })
      if (['Edit', 'MultiEdit', 'Write'].includes(name)) {
        const fp = path.resolve(cwd, ti.file_path)
        const rel = fp.slice(cwd.length + 1)
        known[agent].add(rel)
        const before = pre.get(input.tool_use_id)
        let rec = { peer: 0, peers: [] }, how = 'edit-call'
        if (name === 'Write' || before === null || before === undefined) {
          const owners0 = await keyedOwners(agent, rel)
          const r = await must({ op: 'rewrite', agent, path: rel, content: readOr(fp) }); rec = { ...peerFall(owners0, await keyedOwners(agent, rel)), peerText: r.peer_lines_touched }; how = before == null ? 'new-file' : 'write'
        } else {
          rec = await recordEditCall(agent, rel, before, name === 'MultiEdit' ? ti.edits : [ti])
          const view = (await must({ op: 'view', agent, path: rel })).text
          if (view !== readOr(fp)) { await must({ op: 'rewrite', agent, path: rel, content: readOr(fp) }); how = 'edit-call-mismatch' }
        }
        // gap 9 (open, but declared): an edit outside the editing task's own Files is an amendment
        const own = task.files || (String(task.id).startsWith('R:') ? [task.id.slice(2)] : null)
        const outside = own ? !own.includes(rel) : false
        ev('edit', { agent, task: task.id, tool: name, path: rel, how, peer_lines: rec.peer, peers: rec.peers, peer_lines_text: rec.peerText, outside })
        dirty[agent] = true
        if (rec.peer) await board.post({ by: 'host', claim: `${agent} changed ${rec.peer} line(s) written by ${rec.peers.join(', ')} in ${rel}`, confidence: 1, task: task.id })
      } else if (name === 'Bash') {
        const drift = await syncFromDisk(agent)
        if (drift) dirty[agent] = true
        const cmd = ti.command || ''
        if (/pytest/.test(cmd)) {
          const out = JSON.stringify(input.tool_response || '')
          const red = /\d+ failed|error/i.test(out) && !/\b0 failed\b/.test(out)
          ev('test', { agent, task: task.id, red, drift, cause: red ? await blame(agent, cwd, out.replace(/\\n/g, '\n').replace(/\\"/g, '"')) : null })
          if (red) st.redRuns += 1
        }
      }
      return {}
    }] }],
    PostToolUseFailure: [{ hooks: [async (input) => {
      if (['Edit', 'MultiEdit'].includes(input.tool_name) && !input.is_interrupt) {
        const kind = failKind(String(input.error || ''))
        editFailures[kind] += 1
        const ti = input.tool_input || {}
        ev('edit:fail', { agent, task: task.id, tool: input.tool_name, kind, path: String(ti.file_path || '').slice(cwd.length + 1), error: String(input.error || '').slice(0, 200), old_lines: String(ti.old_string || '').split('\n').length })
      }
      return {}
    }] }],
    PostToolBatch: [{ hooks: [async () => {
      if (PUBLISH === 'batch' && dirty[agent]) {
        await syncFromDisk(agent); await must({ op: 'publish', agent }); dirty[agent] = false
        lastPublish = now(); ev('publish', { agent, task: task.id, auto: 'batch' }); await board.publish(agent, task.id); edge('batch ' + agent)
      }
      const changed = await pullInto(agent)
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
    `\nStart with board_read.`
  ev('session:start', { agent, task: task.id })
  log(agent, 'claims task', task.id)
  const q = query({ prompt, options: {
    cwd, model: MODEL, settingSources: [], permissionMode: 'bypassPermissions', allowDangerouslySkipPermissions: true,
    maxTurns: 80, systemPrompt: { type: 'preset', preset: 'claude_code', append: SYSTEM },
    mcpServers: { flock: createSdkMcpServer({ name: 'flock', tools }) },
    disallowedTools: ['WebFetch', 'WebSearch', 'Task', 'Agent', 'NotebookEdit'], hooks,
  } })
  let result = null
  live.add(agent)
  const killer =setTimeout(() => { q.interrupt().catch(() => {}) }, Math.max(1000, CLOCK_MS - now()))
  try { for await (const m of q) if (m.type === 'result') result = m } catch (e) { ev('session:error', { agent, error: String(e).slice(0, 300) }) }
  clearTimeout(killer)
  await syncFromDisk(agent)
  await must({ op: 'publish', agent }); lastPublish = now(); edge('session end ' + agent)
  usage.push({ agent, task: task.id, turns: result?.num_turns, usage: result?.usage, subtype: result?.subtype, cost_usd: result?.total_cost_usd || 0, wall_ms: now() - (usage.startT = usage.startT || 0) })
  ev('session:end', { agent, task: task.id, released: st.released, done: st.done, redRuns: st.redRuns, turns: result?.num_turns, usage: result?.usage })
  // ticket 5: a resolve task that ends done closes its path's regions even when the resolver
  // changed nothing ("the merged text already says what both meant": run n1, 2 of 2 attempts)
  if (String(task.id).startsWith('R:') && st.done) closeEntries(task.id.slice(2), agent, st.done, 'resolve task done')
  live.delete(agent); lastChange = now()
  if (st.released) { await board.release(task, `${agent} released: ${st.released}`); log(agent, 'releases', task.id, '—', st.released) } else { await board.done(task); log(agent, 'done', task.id) }
}

async function agentLoop (agent) {
  while (!settled && !outcome && now() < CLOCK_MS) {
    const t = await board.claim(agent)
    if (!t) { await sleep(1500); continue }
    await session(agent, t)
  }
}

// ── settling ──────────────────────────────────────────────────────────────────
let outcome = null   // ticket 5: { pr: 'ready' | 'draft', why, snap }
function debounceMs () {
  const xs = [...edgeLatency].sort((a, b) => a - b)
  const p90 = xs.length ? xs[Math.min(xs.length - 1, Math.floor(0.9 * xs.length))] : 500
  return Math.max(1000, 2 * p90)
}
function terminal (pr, why, r) {
  outcome = { pr, why, snap: r && r.snap, t: now() }
  ev('terminal', outcome); log('TERMINAL', pr, why)
}
async function settle () {
  while (!settled && !outcome && now() < CLOCK_MS) {
    await sleep(SETTLE === 'quiet' ? 3000 : 500)
    const all = [...board.tasks.values()]
    if (SETTLE === 'quiet') { if (!board.allDone() || now() - lastPublish < QUIET_MS) continue } else {
      // rule S1: nothing can change the code any more. (`quiet`, the rollback, waits a fixed
      // window from the last publish CALL, which a no-change session-end publish restarts.)
      if (!live.size && !board.allDone() && !board.readyNow().length && now() - lastChange > debounceMs()) {
        // deadlock: no agent working, nothing claimable, work left. Nobody will publish again.
        await stall('deadlock', { left: all.filter((t) => t.state !== 'done').map((t) => ({ id: t.id, state: t.state, depends_on: t.depends_on })) })
        terminal('draft', 'deadlock: work left and nothing claimable', lastEdge); break
      }
      if (live.size || !board.allDone() || now() - lastChange < debounceMs()) continue
    }
    const r = await edge('settle check')
    if (r.green) { settled = { t: now(), snap: r.snap }; ev('settled', settled); log('SETTLED on', r.snap); terminal('ready', 'settled green', r); break }
    let acted = false
    for (const t of all) {
      const bad = (r.perTask[t.id] || []).some((x) => x !== 0)
      if (!bad) continue
      if (t.reopen >= MAX_REOPEN) continue
      acted = true
      t.reopen += 1
      await board.reopen(t, `edge snapshot ${r.snap} is red on this task's facts ${JSON.stringify(r.perTask[t.id])}; check exit ${r.check}`)
      await board.post({ by: 'host', claim: `edge red on task ${t.id} at snapshot ${r.snap}`, confidence: 1, task: t.id })
      ev('reopen', { task: t.id, snap: r.snap, n: t.reopen }); log('reopen task', t.id, 'at', r.snap)
    }
    for (const p of r.blocking || []) {
      const id = 'R:' + p
      if (board.tasks.has(id) && board.tasks.get(id).state !== 'done') continue
      const prev = board.tasks.get(id)
      if (prev && prev.reopen >= MAX_REOPEN) continue
      acted = true
      const ann = (openEntries(p)[0] || {}).annotated || (r.annotated || {})[p]
      await board.addTask({ id, title: 'Resolve conflict marks in ' + p, depends_on: [], state: 'ready', owner: null, notes: [], reopen: prev ? prev.reopen + 1 : 0, facts: [],
        body: `Two agents changed the same part of \`${p}\` and the merge marked it as a conflict. Here is the merged file with the conflict sections marked (<<<<<<< begin … / ======= begin … / >>>>>>> end conflict; "left" and "right" are the two sides):\n\n\`\`\`\n${ann || '(annotation unavailable)'}\n\`\`\`\n\nYour copy holds the merged text WITHOUT the markers. Make that part of \`${p}\` say what both sides meant (edit with Edit if it does not already), run the tests, then call resolve_conflict for \`${p}\` and then done.` })
      ev('resolve-task', { path: p, snap: r.snap }); log('resolve task for', p)
    }
    if (r.check !== 0 && all.every((t) => (r.perTask[t.id] || []).every((x) => x === 0))) {
      // ticket 5: the check is red with every fact green. The old loop restarted the quiet
      // window and told nobody, so the run waited for its clock. Now the check owns a task.
      ev('red-check-only', { snap: r.snap, tail: r.checkTail }); log('check red with every fact green')
      const prev = board.tasks.get('C:check')
      if (!prev || (prev.state === 'done' && prev.reopen < MAX_REOPEN)) {
        acted = true
        await stall('check_red', { snap: r.snap, tail: (r.checkTail || '').slice(-300) })
        await board.addTask({ id: 'C:check', title: 'Make the run-wide check green', depends_on: [], state: 'ready', owner: null, notes: [], reopen: prev ? prev.reopen + 1 : 0, facts: [W.check],
          body: `Every task's facts pass on the merged code, but the run-wide check does not. Its output ends:\n\n\`\`\`\n${(r.checkTail || '').slice(-600)}\n\`\`\`\n\nFix the cause (prefer not to rewrite a peer's lines; post a belief if the fix is theirs), run the check, publish, then done.` })
      }
    }
    if (!acted && SETTLE !== 'quiet') {
      // exhausted: red or blocked, and every lever (reopen, resolve task, check task) is spent.
      // Waiting for the clock buys nothing: publish the draft now with the beliefs attached.
      await stall('exhausted', { snap: r.snap, perTask: r.perTask, check: r.check, blocking: r.blocking })
      terminal('draft', 'exhausted: red or blocked with every retry spent', r); break
    }
  }
  if (!outcome) terminal('draft', 'clock', lastEdge)
}

// ── run ───────────────────────────────────────────────────────────────────────
await must({ op: 'base', root: BASE_DIR, paths: BASE_PATHS })
ev('start', { workload: W.name, agents: N, model: MODEL, clock_ms: CLOCK_MS, quiet_ms: QUIET_MS, board: BOARD, publish: PUBLISH })
log(`workload ${W.name}, ${N} agents, ${MODEL}, out ${OUT}`)
await Promise.all([...NAMES.map(agentLoop), settle()])
await edgeChain
const summary = {
  workload: W.name, agents: N, model: MODEL, settled, wall_ms: now(), publish: PUBLISH,
  final: lastEdge && { snap: lastEdge.snap, green: lastEdge.green, perTask: lastEdge.perTask, check: lastEdge.check, conflicts: lastEdge.conflicts },
  snapshots: snapshots.length, beliefs: board.beliefCount,
  // ticket 5: the terminal outcome. `ready` only from a settled green hash; anything else is a
  // draft with what the swarm believed attached, so the operator reads beliefs, not a transcript.
  outcome, settle_mode: SETTLE, debounce_ms: debounceMs(),
  attached: outcome && outcome.pr === 'draft' ? { stalls, open_conflicts: [...ledger.values()].filter((e) => e.open).map((e) => ({ path: e.path, region: e.region, between: e.between })), last_edge: lastEdge && { snap: lastEdge.snap, perTask: lastEdge.perTask, check: lastEdge.check } } : undefined,
  board_ops: board.ops.length, board_op_us_p50: pct(board.ops.map((o) => o.us), 0.5), board_op_us_p90: pct(board.ops.map((o) => o.us), 0.9),
  board: BOARD, board_by_op: byOp(board.ops),
  board_writes: board.ops.filter((o) => !READS.has(o.name)).length,
  board_writes_per_s: Math.round(board.ops.filter((o) => !READS.has(o.name)).length / (now() / 1000) * 100) / 100,
  board_peak_writes_per_s: peakPerSecond(board.ops.filter((o) => !READS.has(o.name))),
  edit_failures: editFailures,
  tokens: usage.reduce((a, u) => ({ input: a.input + (u.usage?.input_tokens || 0), output: a.output + (u.usage?.output_tokens || 0), cache_read: a.cache_read + (u.usage?.cache_read_input_tokens || 0), cache_write: a.cache_write + (u.usage?.cache_creation_input_tokens || 0) }), { input: 0, output: 0, cache_read: 0, cache_write: 0 }),
  sessions: usage.length,
  cost_usd: Math.round(usage.reduce((a, u) => a + (u.cost_usd || 0), 0) * 1000) / 1000,
}
fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 1))
fs.writeFileSync(path.join(OUT, 'snapshots.json'), JSON.stringify(snapshots))
fs.writeFileSync(path.join(OUT, 'board.json'), JSON.stringify(await board.read(), null, 1))
fs.writeFileSync(path.join(OUT, 'board-ops.json'), JSON.stringify(board.ops))
log('summary', JSON.stringify(summary))
wp.stdin.end()
process.exit(0)

function byOp (ops) {
  const g = {}
  for (const o of ops) (g[o.name] = g[o.name] || []).push(o.us)
  return Object.fromEntries(Object.entries(g).map(([k, xs]) => [k, { n: xs.length, p50_us: pct(xs, 0.5), p90_us: pct(xs, 0.9), max_us: pct(xs, 1) }]))
}
function peakPerSecond (ops) { const c = {}; for (const o of ops) { const s = Math.floor(o.t / 1000); c[s] = (c[s] || 0) + 1 } return Math.max(0, ...Object.values(c)) }
function pct (xs, p) { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]) }
