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

const HERE = path.dirname(fileURLToPath(import.meta.url))
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d }
const W = WORKLOADS[arg('workload', 'widgetkit')]
const N = Number(arg('agents', 3))
const MODEL = arg('model', 'claude-opus-5-5')
const CLOCK_MS = Number(arg('clock', 1800)) * 1000
const QUIET_MS = Number(arg('quiet', 45)) * 1000
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

// ── the board (stand-in with Kata's verbs; every op timed for gap 7) ──────────
const board = {
  tasks: new Map(W.tasks.map((t) => [t.id, { ...t, state: 'ready', owner: null, notes: [], reopen: 0 }])),
  beliefs: [],
  ops: [],
  op (name, fn) { const t = process.hrtime.bigint(); const r = fn(); this.ops.push({ name, us: Number(process.hrtime.bigint() - t) / 1000, t: now() }); return r },
  ready () { return [...this.tasks.values()].filter((t) => t.state === 'ready' && t.depends_on.every((d) => this.tasks.get(d).state === 'done')) },
  claim (agent) { return this.op('claim', () => { const t = this.ready()[0]; if (!t) return null; t.state = 'claimed'; t.owner = agent; return t }) },
  release (t, why) { this.op('release', () => { t.state = 'ready'; t.owner = null; t.notes.push(why) }) },
  done (t) { this.op('done', () => { t.state = 'done' }) },
  post (b) { return this.op('post', () => { const x = { id: this.beliefs.length + 1, t: now(), ...b }; this.beliefs.push(x); return x }) },
  read () { return this.op('read', () => ({
    tasks: [...this.tasks.values()].map((t) => ({ id: t.id, title: t.title, state: t.state, owner: t.owner, depends_on: t.depends_on, notes: t.notes.slice(-2) })),
    beliefs: this.beliefs.slice(-15),
  })) },
}

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
  const r = await weave({ op: 'authors', agent, path: rel })
  const who = r.ok ? r.authors[line - 1] : null
  return { cause: !who ? 'unknown' : who === agent ? 'own' : who === 'base' ? 'base' : 'peer:' + who, path: rel, line }
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
  let text = before, peer = 0, peers = new Set()
  for (const e of edits) {
    for (const s of editSpans(text, e.old_string, e.new_string, e.replace_all)) {
      const r = await must({ op: 'edit', agent, path: rel, ...s })
      peer += r.peer_lines_touched; r.peers.forEach((x) => peers.add(x))
    }
    text = e.replace_all ? text.split(e.old_string).join(e.new_string) : text.replace(e.old_string, () => e.new_string)
  }
  return { peer, peers: [...peers] }
}

// ── the conflict ledger: Manyana recomputes conflicts per merge and stores none, so the
// host keeps them: a conflict opens when a merge flags it and closes only when an agent
// says so (resolve_conflict), or at once when both sides only added lines (the union) ──
const ledger = new Map()
function openConflict (p, info) {
  const e = ledger.get(p)
  if (e && e.open) { e.seen += 1; return }
  if (info.addsOnly) { ev('conflict:union', { path: p, ...info, annotated: undefined }); return }
  ledger.set(p, { open: true, t: now(), seen: 1, annotated: info.annotated, between: info.between })
  ev('conflict:open', { path: p, between: info.between })
  board.post({ by: 'host', claim: `open conflict in ${p} between ${info.between.join(' and ')}; whoever next works there should make it say what both sides meant and call resolve_conflict`, confidence: 1 })
}
const openConflicts = () => [...ledger.entries()].filter(([, e]) => e.open).map(([p]) => p)

// ── the edge: every published snapshot is tested; main takes a green, settled one ──
let edgeChain = Promise.resolve()
let lastEdge = null
const snapshots = []
function edge (reason) {
  edgeChain = edgeChain.then(async () => {
    const m = await must({ op: 'merged' })
    const snap = crypto.createHash('sha1').update(JSON.stringify(m.files)).digest('hex').slice(0, 10)
    if (lastEdge && lastEdge.snap === snap) return lastEdge
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
    for (const p of m.conflicts) if (!ledger.has(p)) openConflict(p, { addsOnly: !!m.addsOnly[p], annotated: m.annotated[p], between: ['published copies'] })
    const blocking = openConflicts()
    lastEdge = { snap, t: now(), reason, perTask, check: chk.status, checkTail: ((chk.stdout || '') + (chk.stderr || '')).slice(-600), conflicts: m.conflicts, blocking, annotated: m.annotated, green: factsGreen && chk.status === 0 && !blocking.length }
    snapshots.push({ snap, t: now(), files: m.files })
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
- Publish whenever your change is coherent, so the others build on it.
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
  for (const c of r.changed.filter((x) => x.conflict)) openConflict(c.path, { addsOnly: c.addsOnly, annotated: c.annotated, between: [agent, c.from] })
  return r.changed
}

async function session (agent, task) {
  const cwd = agentDir(agent)
  const st = { released: false, done: false, redRuns: 0 }
  const pre = new Map()
  await pullInto(agent)
  const say = (text) => ({ content: [{ type: 'text', text }] })
  const tools = [
    tool('board_read', 'Read the board: every task with its state and owner, and the latest beliefs.', {}, async () => say(JSON.stringify(board.read(), null, 1))),
    tool('post_belief', 'Post a belief for the other agents: something you believe is true, how sure you are (0 to 1), and which task it concerns.',
      { claim: z.string(), confidence: z.number(), task: z.string().optional() },
      async (a) => { const b = board.post({ by: agent, claim: a.claim, confidence: a.confidence, task: a.task }); ev('belief', b); return say('posted belief ' + b.id) }),
    tool('run_proof', "Run a task's facts on your copy (default: your own task). Each fact is a command; exit 0 means it holds.",
      { task: z.string().optional() },
      async (a) => {
        const t = board.tasks.get(a.task || task.id) || task
        const res = runFacts(cwd, t)
        const red = res.filter((r) => r.exit !== 0)
        const causes = []
        for (const r of red) causes.push(await blame(agent, cwd, r.tail))
        ev('proof', { agent, task: t.id, exits: res.map((r) => r.exit), causes })
        return say(res.map((r, i) => `fact ${i + 1}: exit ${r.exit}${r.exit ? '\n' + r.tail : ''}`).join('\n'))
      }),
    tool('publish', "Publish your copy's changes so the other agents receive them.", {},
      async () => { await syncFromDisk(agent); await must({ op: 'publish', agent }); lastPublish = now(); ev('publish', { agent, task: task.id }); edge('publish ' + agent); return say('published') }),
    tool('resolve_conflict', 'Close an open conflict in a file: the text in your copy now says what both sides meant (edit it first with Edit if it did not).',
      { path: z.string(), note: z.string() },
      async (a) => {
        const e = ledger.get(a.path)
        if (!e || !e.open) return say('no open conflict in ' + a.path)
        await syncFromDisk(agent); await must({ op: 'publish', agent }); lastPublish = now()
        e.open = false; e.closed_by = agent; e.closed_t = now(); e.note = a.note
        ev('conflict:close', { path: a.path, by: agent, note: a.note.slice(0, 200) }); edge('resolve ' + agent)
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
          const r = await must({ op: 'rewrite', agent, path: rel, content: readOr(fp) }); rec = { peer: r.peer_lines_touched, peers: r.peers }; how = before == null ? 'new-file' : 'write'
        } else {
          rec = await recordEditCall(agent, rel, before, name === 'MultiEdit' ? ti.edits : [ti])
          const view = (await must({ op: 'view', agent, path: rel })).text
          if (view !== readOr(fp)) { await must({ op: 'rewrite', agent, path: rel, content: readOr(fp) }); how = 'edit-call-mismatch' }
        }
        ev('edit', { agent, task: task.id, tool: name, path: rel, how, peer_lines: rec.peer, peers: rec.peers })
        if (rec.peer) board.post({ by: 'host', claim: `${agent} changed ${rec.peer} line(s) written by ${rec.peers.join(', ')} in ${rel}`, confidence: 1, task: task.id })
      } else if (name === 'Bash') {
        const drift = await syncFromDisk(agent)
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
    PostToolBatch: [{ hooks: [async () => {
      const changed = await pullInto(agent)
      if (!changed.length) return {}
      const note = 'Peers\' published work was merged into your copy just now: ' +
        changed.map((c) => `${c.path} (+${c.added} −${c.removed}, from ${c.from}${c.conflict ? ', with conflict marks' : ''})`).join('; ') + '. Re-read before editing those files.'
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
  const killer = setTimeout(() => { q.interrupt().catch(() => {}) }, Math.max(1000, CLOCK_MS - now()))
  try { for await (const m of q) if (m.type === 'result') result = m } catch (e) { ev('session:error', { agent, error: String(e).slice(0, 300) }) }
  clearTimeout(killer)
  await syncFromDisk(agent)
  await must({ op: 'publish', agent }); lastPublish = now(); edge('session end ' + agent)
  usage.push({ agent, task: task.id, turns: result?.num_turns, usage: result?.usage, subtype: result?.subtype, cost_usd: result?.total_cost_usd || 0, wall_ms: now() - (usage.startT = usage.startT || 0) })
  ev('session:end', { agent, task: task.id, released: st.released, done: st.done, redRuns: st.redRuns, turns: result?.num_turns, usage: result?.usage })
  if (st.released) { board.release(task, `${agent} released: ${st.released}`); log(agent, 'releases', task.id, '—', st.released) } else { board.done(task); log(agent, 'done', task.id) }
}

async function agentLoop (agent) {
  while (!settled && now() < CLOCK_MS) {
    const t = board.claim(agent)
    if (!t) { await sleep(1500); continue }
    await session(agent, t)
  }
}

// ── settling ──────────────────────────────────────────────────────────────────
async function settle () {
  while (!settled && now() < CLOCK_MS) {
    await sleep(3000)
    const all = [...board.tasks.values()]
    if (!all.every((t) => t.state === 'done') || now() - lastPublish < QUIET_MS) continue
    const r = await edge('settle check')
    if (r.green) { settled = { t: now(), snap: r.snap }; ev('settled', settled); log('SETTLED on', r.snap); break }
    for (const t of all) {
      const bad = (r.perTask[t.id] || []).some((x) => x !== 0)
      if (!bad) continue
      if (t.reopen >= MAX_REOPEN) continue
      t.reopen += 1
      board.release(t, `edge snapshot ${r.snap} is red on this task's facts ${JSON.stringify(r.perTask[t.id])}; check exit ${r.check}`)
      board.post({ by: 'host', claim: `edge red on task ${t.id} at snapshot ${r.snap}`, confidence: 1, task: t.id })
      ev('reopen', { task: t.id, snap: r.snap, n: t.reopen }); log('reopen task', t.id, 'at', r.snap)
    }
    for (const p of r.blocking || []) {
      const id = 'R:' + p
      if (board.tasks.has(id) && board.tasks.get(id).state !== 'done') continue
      const prev = board.tasks.get(id)
      if (prev && prev.reopen >= MAX_REOPEN) continue
      const ann = (ledger.get(p) || {}).annotated || (r.annotated || {})[p]
      board.tasks.set(id, { id, title: 'Resolve conflict marks in ' + p, depends_on: [], state: 'ready', owner: null, notes: [], reopen: prev ? prev.reopen + 1 : 0, facts: [],
        body: `Two agents changed the same part of \`${p}\` and the merge marked it as a conflict. Here is the merged file with the conflict sections marked (<<<<<<< begin … / ======= begin … / >>>>>>> end conflict; "left" and "right" are the two sides):\n\n\`\`\`\n${ann || '(annotation unavailable)'}\n\`\`\`\n\nYour copy holds the merged text WITHOUT the markers. Make that part of \`${p}\` say what both sides meant (edit with Edit if it does not already), run the tests, then call resolve_conflict for \`${p}\` and then done.` })
      ev('resolve-task', { path: p, snap: r.snap }); log('resolve task for', p)
    }
    if (r.check !== 0 && all.every((t) => (r.perTask[t.id] || []).every((x) => x === 0))) {
      ev('red-check-only', { snap: r.snap, tail: r.checkTail }); log('check red with every fact green'); lastPublish = now()
    }
  }
}

// ── run ───────────────────────────────────────────────────────────────────────
await must({ op: 'base', root: BASE_DIR, paths: BASE_PATHS })
ev('start', { workload: W.name, agents: N, model: MODEL, clock_ms: CLOCK_MS, quiet_ms: QUIET_MS })
log(`workload ${W.name}, ${N} agents, ${MODEL}, out ${OUT}`)
await Promise.all([...NAMES.map(agentLoop), settle()])
await edgeChain
const summary = {
  workload: W.name, agents: N, model: MODEL, settled, wall_ms: now(),
  final: lastEdge && { snap: lastEdge.snap, green: lastEdge.green, perTask: lastEdge.perTask, check: lastEdge.check, conflicts: lastEdge.conflicts },
  snapshots: snapshots.length, beliefs: board.beliefs.length,
  board_ops: board.ops.length, board_op_us_p50: pct(board.ops.map((o) => o.us), 0.5), board_op_us_p90: pct(board.ops.map((o) => o.us), 0.9),
  tokens: usage.reduce((a, u) => ({ input: a.input + (u.usage?.input_tokens || 0), output: a.output + (u.usage?.output_tokens || 0), cache_read: a.cache_read + (u.usage?.cache_read_input_tokens || 0), cache_write: a.cache_write + (u.usage?.cache_creation_input_tokens || 0) }), { input: 0, output: 0, cache_read: 0, cache_write: 0 }),
  sessions: usage.length,
  cost_usd: Math.round(usage.reduce((a, u) => a + (u.cost_usd || 0), 0) * 1000) / 1000,
}
fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 1))
fs.writeFileSync(path.join(OUT, 'snapshots.json'), JSON.stringify(snapshots))
fs.writeFileSync(path.join(OUT, 'board.json'), JSON.stringify(board.read(), null, 1))
log('summary', JSON.stringify(summary))
wp.stdin.end()
process.exit(0)

function pct (xs, p) { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]) }
