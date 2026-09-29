#!/usr/bin/env node
// The Flock's catch-up: a finished run whose main moved is re-joined onto the moved tip.
// `node factory/flock/catchup.mjs --plan <p> --target <dir> --base <run base> --onto <moved tip> --run-dir <dir>`
// The target is on the run's branch, the run's own commit at HEAD, the tree clean, --onto fetched.
// The join is the weave keeper's (factory/flock/weave.py): each path changed on both sides is
// woven from base, the run's text and main's, merged in the order main, run; a path changed on
// one side takes that side. On a clean join the branch is reset to --onto, the result written
// and committed once as the engine; then the plan's setup, every task's facts and the run-wide
// check run with ULTRA_BASE=--onto. A conflict touches nothing; a red resets back to the run's commit.
// The last stdout line is the boot's answer: {"refolded": true, "head", "onto"} (exit 0) or
// {"refolded": false, "reason": "conflict" | "red", "onto"} (exit 1).
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { workloadFromPlan } from './plan.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const args = {}
for (let i = 2; i < process.argv.length; i++) {
  const m = /^--(.+)$/.exec(process.argv[i])
  if (m) args[m[1]] = process.argv[++i]
}
for (const k of ['plan', 'target', 'base', 'onto']) {
  if (!args[k]) { console.error(`catchup: --${k} is required`); process.exit(2) }
}
const T = path.resolve(args.target)
const RUN_DIR = args['run-dir'] ? path.resolve(args['run-dir']) : null
const log = (s) => {
  console.error(`catchup: ${s}`)
  if (RUN_DIR) { try { fs.mkdirSync(RUN_DIR, { recursive: true }); fs.appendFileSync(path.join(RUN_DIR, 'catchup.log'), s + '\n') } catch {} }
}
const git = (a, opts = {}) => {
  const r = spawnSync('git', ['-C', T, ...a], { encoding: opts.encoding === undefined ? 'utf8' : opts.encoding, maxBuffer: 256 * 1024 * 1024 })
  if (r.status !== 0 && !opts.ok) throw new Error(`git ${a.join(' ')}: ${r.stderr}`)
  return r
}
const rev = (r) => git(['rev-parse', '--verify', `${r}^{commit}`]).stdout.trim()
const onto = rev(args.onto)
const base = rev(args.base)
const runSha = rev('HEAD')
const answer = (o, code) => { console.log(JSON.stringify({ ...o, onto })); process.exit(code) }

// A path's bytes at a commit, or null where the path does not exist there.
const blob = (sha, p) => {
  const r = git(['cat-file', '-e', `${sha}:${p}`], { ok: true })
  if (r.status !== 0) return null
  return git(['show', `${sha}:${p}`], { encoding: 'buffer' }).stdout
}
const utf8 = (buf) => { try { return new TextDecoder('utf-8', { fatal: true }).decode(buf) } catch { return undefined } }
const changed = (a, b) => git(['diff', '--no-renames', '--name-only', '-z', a, b]).stdout.split('\0').filter(Boolean)

const runPaths = changed(base, runSha)
const mainPaths = new Set(changed(base, onto))
const result = new Map()   // path -> Buffer | null (deleted)
const both = []
for (const p of runPaths) {
  if (!mainPaths.has(p)) { result.set(p, blob(runSha, p)); continue }
  const r = blob(runSha, p), m = blob(onto, p)
  if (r === null && m === null) { result.set(p, null); continue }
  if (r !== null && m !== null && r.equals(m)) { result.set(p, r); continue }
  both.push(p)
}

if (both.length) {
  const texts = {}
  for (const p of both) {
    const b = blob(base, p), r = blob(runSha, p), m = blob(onto, p)
    const t = { base: b && utf8(b), run: r && utf8(r), main: m && utf8(m) }
    if (t.base === undefined || t.run === undefined || t.main === undefined) {
      log(`${p} is not UTF-8 text and differs on both sides`)
      answer({ refolded: false, reason: 'conflict' }, 1)
    }
    texts[p] = t
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'catchup-base-'))
  const atBase = both.filter((p) => texts[p].base !== null)
  for (const p of atBase) {
    fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true })
    fs.writeFileSync(path.join(root, p), texts[p].base)
  }
  const reqs = [{ op: 'base', root, paths: atBase }]
  for (const p of both) reqs.push({ op: 'rewrite', agent: 'run', path: p, content: texts[p].run })
  for (const p of both) reqs.push({ op: 'rewrite', agent: 'main', path: p, content: texts[p].main })
  reqs.push({ op: 'publish', agent: 'run' }, { op: 'publish', agent: 'main' }, { op: 'merged', order: ['main', 'run'] })
  const w = spawnSync('python3', [path.join(HERE, 'weave.py')], {
    input: reqs.map((r) => JSON.stringify(r)).join('\n') + '\n', encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
  })
  fs.rmSync(root, { recursive: true, force: true })
  const outs = (w.stdout || '').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
  const bad = outs.find((o) => !o.ok)
  if (w.status !== 0 || outs.length !== reqs.length || bad) {
    throw new Error(`weave keeper failed (exit ${w.status}): ${bad ? bad.error : (w.stderr || '').slice(-400)}`)
  }
  const merged = outs[outs.length - 1]
  if (merged.realConflicts.length) {
    log(`the join conflicts on ${merged.realConflicts.join(', ')}`)
    answer({ refolded: false, reason: 'conflict' }, 1)
  }
  for (const p of both) result.set(p, merged.exists[p] === false ? null : Buffer.from(merged.files[p] ?? '', 'utf8'))
}

// A clean join: the run's work, once, on top of the moved main.
git(['reset', '-q', '--hard', onto])
for (const [p, content] of result) {
  const f = path.join(T, p)
  if (content === null) { fs.rmSync(f, { force: true }); continue }
  if (!mainPaths.has(p)) { git(['checkout', runSha, '--', p]); continue }   // one side's path keeps its mode
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, content)
}
if (result.size) git(['add', '-A', '--', ...result.keys()])
const subject = git(['log', '-1', '--format=%s', runSha]).stdout.trim()
git(['-c', 'user.name=flock', '-c', 'user.email=flock@ultrapowers.invalid', 'commit', '-q', '--allow-empty', '--no-verify',
  '-m', `${subject}\n\nCaught up onto ${onto} by the Flock (was ${runSha}).`])
const head = rev('HEAD')

// Every exam, on the main the work now sits on.
const W = workloadFromPlan(args.plan)
const env = { ...process.env, ULTRA_BASE: onto }
const exams = []
if (W.setup) exams.push({ name: 'setup', cmd: W.setup, timeout: 300000 })
for (const t of W.tasks) t.facts.forEach((cmd, i) => exams.push({ name: `task ${t.id} fact ${i + 1}`, cmd, timeout: 60000 }))
if (W.check) exams.push({ name: 'check', cmd: W.check, timeout: W.checkTimeoutMs ?? 120000 })
for (const e of exams) {
  const r = spawnSync(e.cmd[0], e.cmd.slice(1), { cwd: T, encoding: 'utf8', timeout: e.timeout, env, maxBuffer: 64 * 1024 * 1024 })
  if (r.status !== 0) {
    log(`${e.name} is red on the join (exit ${r.status ?? r.signal}): ${((r.stdout || '') + (r.stderr || '')).slice(-800)}`)
    git(['reset', '-q', '--hard', runSha])
    answer({ refolded: false, reason: 'red' }, 1)
  }
}
log(`caught up onto ${onto}: ${head}`)
answer({ refolded: true, head }, 0)
