#!/usr/bin/env node
// factory/flock/catchup.mjs — the Flock's catch-up of a finished run onto a moved main.
// `node factory/flock/catchup.mjs --plan <p> --target <dir> --base <run base> --onto <moved tip> --run-dir <dir>`
// The target sits on the run's branch, the run's own commit at HEAD, the tree clean. The paths
// changed on both sides are joined by the weave keeper (weave.py); a clean join becomes one commit
// on top of --onto, which must pass the plan's setup, every task's facts and the run-wide check.
// Last stdout line: {"refolded": true, "head", "onto"} (exit 0) or {"refolded": false, "reason":
// "conflict" | "red", "onto"} (exit 1). A conflict or a red leaves the run's own commit at HEAD.
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'
import { workloadFromPlan } from './plan.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined }
const PLAN = arg('--plan'), T = arg('--target'), BASE = arg('--base'), ONTO = arg('--onto'), RUN_DIR = arg('--run-dir')
if (!PLAN || !T || !BASE || !ONTO) { console.log(JSON.stringify({ refolded: false, reason: 'usage', onto: ONTO ?? null })); process.exit(2) }

const git = (args, opts = {}) => {
  const r = spawnSync('git', ['-c', 'user.name=flock', '-c', 'user.email=flock@ultrapowers.invalid', ...args],
    { cwd: T, maxBuffer: 256 * 1024 * 1024, ...opts })
  if (r.status !== 0 && !opts.ok) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
  return r
}
const out = (args) => git(args, { encoding: 'utf8' }).stdout.trim()
// A path's bytes at a rev, or null when the path is absent there.
const blob = (rev, p) => { const r = git(['cat-file', 'blob', `${rev}:${p}`], { ok: true }); return r.status === 0 ? r.stdout : null }
const utf8 = (buf) => { if (buf === null) return null; try { return new TextDecoder('utf-8', { fatal: true }).decode(buf) } catch { return undefined } }
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

if (both.length) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'catchup-base-'))
  const texts = []
  for (const p of both) {
    const b = utf8(blob(BASE, p)), r = utf8(blob(runSha, p)), m = utf8(blob(ONTO, p))
    if (b === undefined || r === undefined || m === undefined) finish({ refolded: false, reason: 'conflict' }, 1)
    if (b !== null) { fs.mkdirSync(path.dirname(path.join(tmp, p)), { recursive: true }); fs.writeFileSync(path.join(tmp, p), b) }
    texts.push({ p, b, r, m })
  }
  const wp = spawn('python3', [path.join(HERE, 'weave.py')], { stdio: ['pipe', 'pipe', 'inherit'] })
  const lines = readline.createInterface({ input: wp.stdout })[Symbol.asyncIterator]()
  const ask = async (req) => {
    wp.stdin.write(JSON.stringify(req) + '\n')
    const { value, done } = await lines.next()
    if (done) throw new Error('weave keeper exited')
    const res = JSON.parse(value)
    if (!res.ok) throw new Error(`weave ${req.op}: ${res.error}`)
    return res
  }
  await ask({ op: 'base', root: tmp, paths: texts.filter((t) => t.b !== null).map((t) => t.p) })
  for (const t of texts) {
    await ask({ op: 'rewrite', agent: 'run', path: t.p, content: t.r })
    await ask({ op: 'rewrite', agent: 'main', path: t.p, content: t.m })
  }
  await ask({ op: 'publish', agent: 'run' })
  await ask({ op: 'publish', agent: 'main' })
  const j = await ask({ op: 'merged', order: ['main', 'run'] })
  wp.stdin.end()
  fs.rmSync(tmp, { recursive: true, force: true })
  if ((j.realConflicts || []).length) finish({ refolded: false, reason: 'conflict' }, 1)
  for (const t of texts) {
    const gone = j.exists[t.p] === false || !(t.p in j.files)
    result.set(t.p, gone ? null : Buffer.from(j.files[t.p], 'utf8'))
  }
}

// The join is clean: one commit on --onto, then every exam of the plan with ULTRA_BASE = --onto.
git(['reset', '-q', '--hard', ONTO])
for (const [p, buf] of result) {
  const f = path.join(T, p)
  if (buf === null) { fs.rmSync(f, { force: true }); continue }
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, buf)
}
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
try { work = workloadFromPlan(PLAN) } catch (e) { back(`plan: ${e.message}`) }
const env = { ...process.env, ULTRA_BASE: ONTO }
const exam = (cmd, timeout) => {
  const r = spawnSync(cmd[0], cmd.slice(1), { cwd: T, env, encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024 })
  if (r.status !== 0) back(`${cmd.join(' ')} exited ${r.status ?? r.signal}: ${(r.stdout + r.stderr).slice(-400)}`)
}
if (work.setup) exam(work.setup, 1_800_000)
for (const t of work.tasks) for (const f of t.facts) exam(f, 120_000)
if (work.check) exam(work.check, work.checkTimeoutMs ?? 120_000)
// The exams may leave artifacts; the commit is what the boot pushes.
if (out(['rev-parse', 'HEAD']) !== head) back('an exam moved HEAD')
if (RUN_DIR) { try { fs.mkdirSync(RUN_DIR, { recursive: true }); fs.writeFileSync(path.join(RUN_DIR, 'catchup.json'), JSON.stringify({ head, onto: ONTO, run: runSha }) + '\n') } catch {} }
finish({ refolded: true, head }, 0)
