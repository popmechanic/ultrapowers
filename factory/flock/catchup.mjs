#!/usr/bin/env node
// factory/flock/catchup.mjs — the Flock's catch-up of a finished run onto a moved main.
// `node factory/flock/catchup.mjs --plan <p> [--plan-json <parse>] --target <dir> --base <run base> --onto <moved tip> --run-dir <dir>`
// The target sits on the run's branch, the run's own commit at HEAD, the tree clean. The paths
// changed on both sides are joined on main's memory (weave_store.py `join`: the run's stored entry
// merged with the moved main's, every line's identity kept) when the run has one, else by the weave
// keeper rebuilt from the three texts (weave.py); a clean join becomes one commit
// on top of --onto, which must pass the plan's setup, every task's facts and the run-wide check.
// Last stdout line: {"refolded": true, "head", "onto"} (exit 0) or {"refolded": false, "reason":
// "conflict" | "red", "onto"} (exit 1). A conflict or a red leaves the run's own commit at HEAD.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { workloadFromPlan } from './plan.mjs'
import { remapProvenance } from './provenance.mjs'
import { fileURLToPath } from 'node:url'
import { gitIn, utf8, writeFiles, startWeave, EXAM_MS, POLICY_FLOCK } from './io.mjs'

const STORE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'weave_store.py')
// one weave_store.py verb; its last stdout line as JSON, or null
const store = (...args) => {
  const r = spawnSync('python3', [STORE, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 256 * 1024 * 1024 })
  try { return JSON.parse((r.stdout || '').trimEnd().split('\n').pop()) } catch { return null }
}

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined }
const PLAN = arg('--plan'), T = arg('--target'), BASE = arg('--base'), ONTO = arg('--onto'), RUN_DIR = arg('--run-dir')
if (!PLAN || !T || !BASE || !ONTO) { console.log(JSON.stringify({ refolded: false, reason: 'usage', onto: ONTO ?? null })); process.exit(2) }

const git = (args, opts) => gitIn(T, args, { identity: true, ...opts })
const out = (args) => git(args).stdout.trim()
// A path's bytes at a rev, or null when the path is absent there.
const blob = (rev, p) => { const r = git(['cat-file', 'blob', `${rev}:${p}`], { ok: true, encoding: 'buffer' }); return r.status === 0 ? r.stdout : null }
const finish = (o, code) => { console.log(JSON.stringify({ ...o, onto: ONTO })); process.exit(code) }

const runSha = out(['rev-parse', 'HEAD'])
const changed = (a, b) => new Set(out(['diff', '--name-only', '--no-renames', a, b]).split('\n').filter(Boolean))
const ours = changed(BASE, runSha), theirs = changed(BASE, ONTO)

// path -> Buffer (the result) or null (deleted); only paths the run changed need writing over --onto.
const result = new Map()
const both = []
for (const p of ours) {
  if (!theirs.has(p)) { result.set(p, blob(runSha, p)); continue }
  const r = blob(runSha, p), m = blob(ONTO, p)
  if ((r === null && m === null) || (r && m && r.equals(m))) continue
  both.push(p)
}

// main's memory (policy flock.main.mode `memory` or `peer`): the paths the store decides are joined there, on
// the weaves the run and main really wrote; a path it does not hold (never text, or a run that began
// frozen) falls to the three-text join below, which is also the rollback (`frozen`).
let memory = null   // { file, stored }: the joined Memory, kept for the commit this catch-up makes
if (both.length && ['memory', 'peer'].includes(POLICY_FLOCK?.main?.mode)) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'catchup-memory-')), 'memory.json')
  const j = store('join', '--repo', T, '--run', runSha, '--onto', ONTO, '--remote', 'origin', '--out', file)
  if (j && j.joined) {
    const decided = new Set(j.paths)
    if (j.conflicts.some((p) => both.includes(p))) finish({ refolded: false, reason: 'conflict' }, 1)
    for (const p of both.filter((x) => decided.has(x))) {
      // absent from `files`: the join's text is the moved main's own, so nothing is written over it
      if (p in j.files) result.set(p, j.files[p] === null ? null : Buffer.from(j.files[p], 'utf8'))
    }
    both.splice(0, both.length, ...both.filter((x) => !decided.has(x)))
    memory = { file, stored: false }
  } else process.stderr.write(`catchup: no join on main's memory (${j ? j.reason : 'no answer'}), joining the three texts\n`)
}

if (both.length) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'catchup-base-'))
  const texts = []
  for (const p of both) {
    const b = utf8(blob(BASE, p)), r = utf8(blob(runSha, p)), m = utf8(blob(ONTO, p))
    if (b === undefined || r === undefined || m === undefined) finish({ refolded: false, reason: 'conflict' }, 1)
    texts.push({ p, b, r, m })
  }
  const keeper = startWeave()
  const ask = async (req) => {
    const res = await keeper.send(req)
    if (!res.ok) throw new Error(`weave ${req.op}: ${res.error}`)
    return res
  }
  writeFiles(tmp, texts.filter((t) => t.b !== null).map((t) => [t.p, t.b]))
  await ask({ op: 'base', root: tmp, paths: texts.filter((t) => t.b !== null).map((t) => t.p) })
  for (const t of texts) {
    await ask({ op: 'rewrite', agent: 'run', path: t.p, content: t.r })
    await ask({ op: 'rewrite', agent: 'main', path: t.p, content: t.m })
  }
  await ask({ op: 'publish', agent: 'run' })
  await ask({ op: 'publish', agent: 'main' })
  const j = await ask({ op: 'merged', order: ['main', 'run'] })
  keeper.end()
  fs.rmSync(tmp, { recursive: true, force: true })
  if ((j.conflicts || []).length) finish({ refolded: false, reason: 'conflict' }, 1)
  for (const t of texts) {
    const gone = j.exists[t.p] === false || !(t.p in j.files)
    result.set(t.p, gone ? null : Buffer.from(j.files[t.p], 'utf8'))
  }
}

// The join is clean: one commit on --onto, then every exam of the plan with ULTRA_BASE = --onto.
git(['reset', '-q', '--hard', ONTO])
writeFiles(T, result)
git(['add', '-A'])
git(['commit', '-q', '--allow-empty', '-m', `catch up onto ${ONTO.slice(0, 12)}`])
const head = out(['rev-parse', 'HEAD'])

const back = (why) => {
  process.stderr.write(`catchup: red — ${why}\n`)
  git(['reset', '-q', '--hard', runSha])
  git(['clean', '-qfd'], { ok: true })
  finish({ refolded: false, reason: 'red' }, 1)
}
let work
try { work = workloadFromPlan(PLAN, arg('--plan-json')) } catch (e) { back(`plan: ${e.message}`) }
const env = { ...process.env, ULTRA_BASE: ONTO }
const exam = (cmd, timeout) => {
  const r = spawnSync(cmd[0], cmd.slice(1), { cwd: T, env, encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024 })
  if (r.status !== 0) back(`${cmd.join(' ')} exited ${r.status ?? r.signal}: ${(r.stdout + r.stderr).slice(-400)}`)
}
// the run's own limits (EXAM_MS), so a fact red on time in the run is red here too
if (work.setup) exam(work.setup, EXAM_MS.setup)
for (const t of work.tasks) for (const f of t.facts) exam(f, EXAM_MS.fact)
if (work.check) exam(work.check, work.checkTimeoutMs ?? 120_000)
// The exams may leave artifacts; the commit is what the boot pushes.
if (out(['rev-parse', 'HEAD']) !== head) back('an exam moved HEAD')
// the caught-up commit's entry in main's memory; the publish pushes it before the merge request.
// A path the three-text join decided is not in the joined Memory, so its stored weave would not
// be the commit's text: the entry is then refused as drift, and the next reader replays the commit.
if (memory) {
  const r = store('settle', '--repo', T, '--commit', head, '--from', memory.file)
  memory.stored = !!(r && r.stored)
  if (!memory.stored) process.stderr.write(`catchup: the caught-up commit's entry was not stored (${r ? r.reason : 'no answer'})\n`)
  fs.rmSync(path.dirname(memory.file), { recursive: true, force: true })
}
if (RUN_DIR) { try { fs.mkdirSync(RUN_DIR, { recursive: true }); fs.writeFileSync(path.join(RUN_DIR, 'catchup.json'), JSON.stringify({ head, onto: ONTO, run: runSha, memory: memory ? { joined: true, stored: memory.stored } : { joined: false } }) + '\n') } catch {} }
// The record's line numbers were the run's commit's; carry them to the caught-up commit's.
const provFile = RUN_DIR && path.join(RUN_DIR, 'provenance.json')
if (provFile && fs.existsSync(provFile)) {
  try {
    const record = JSON.parse(fs.readFileSync(provFile, 'utf8'))
    // only the paths the record names, null on a side where the path is absent
    const named = new Set()
    for (const k of ['hunks', 'exceptions']) for (const e of Array.isArray(record[k]) ? record[k] : []) if (e && typeof e.path === 'string') named.add(e.path)
    const moved = changed(runSha, head)
    const texts = {}
    for (const p of named) {
      if (!moved.has(p)) continue
      const from = utf8(blob(runSha, p)), to = utf8(blob(head, p))
      if (typeof from === 'string' || typeof to === 'string') texts[p] = { from: from ?? null, to: to ?? null }
    }
    const prov = remapProvenance(record, texts)
    fs.writeFileSync(provFile, JSON.stringify({ ...prov, caughtUp: { run: runSha, head } }, null, 2) + '\n')
  } catch (e) { process.stderr.write(`catchup: provenance not remapped — ${e.message}\n`) }
}
finish({ refolded: true, head }, 0)
