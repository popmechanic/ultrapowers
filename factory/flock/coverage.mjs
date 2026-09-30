// Which lines of the code a probe's command ran. `linesRun` runs argv synchronously in cwd
// with coverage switched on for every Node process (NODE_V8_COVERAGE) and every Python
// process (a sitecustomize.py on PYTHONPATH installing sys.settrace) the command starts,
// children of `bash -lc` included, and answers { exit, lines }: lines maps each file under
// cwd (relative path, node_modules excluded) to its run line numbers, ascending.
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Only sys.settrace / threading.settrace: the sandbox's Python may be as old as 3.9.
const SITECUSTOMIZE = `
import atexit, json, os, sys, threading
_root = os.path.realpath(os.environ.get('FLOCK_COVERAGE_ROOT', ''))
_out = os.environ.get('FLOCK_COVERAGE_PY_OUT', '')
_seen = {}
_keep = {}
def _wanted(fn):
    r = _keep.get(fn)
    if r is None:
        p = os.path.realpath(fn) if fn and not fn.startswith('<') else ''
        r = bool(p) and p.startswith(_root + os.sep) and (os.sep + 'node_modules' + os.sep) not in p
        r = p if r else False
        _keep[fn] = r
    return r
def _local(frame, event, arg):
    if event == 'line':
        p = _keep.get(frame.f_code.co_filename)
        if p:
            _seen.setdefault(p, set()).add(frame.f_lineno)
    return _local
def _global(frame, event, arg):
    p = _wanted(frame.f_code.co_filename)
    if not p:
        return None
    if event == 'call' and frame.f_lineno > 0:
        _seen.setdefault(p, set()).add(frame.f_lineno)
    return _local
def _dump():
    try:
        name = os.path.join(_out, 'py-%d-%d.json' % (os.getpid(), id(_seen)))
        with open(name, 'w') as f:
            json.dump({k: sorted(v) for k, v in _seen.items()}, f)
    except Exception:
        pass
if _root and _out:
    sys.settrace(_global)
    threading.settrace(_global)
    atexit.register(_dump)
`

function lineStarts (src) {
  const starts = [0]
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') starts.push(i + 1)
  return starts
}

// A line counts as run when the innermost range covering its first non-blank character has count > 0.
function nodeLines (file, functions) {
  let src
  try { src = fs.readFileSync(file, 'utf8') } catch { return [] }
  const ranges = functions.flatMap((f) => f.ranges || [])
  const starts = lineStarts(src)
  const run = []
  for (let n = 0; n < starts.length; n++) {
    const end = n + 1 < starts.length ? starts[n + 1] : src.length
    let at = starts[n]
    while (at < end && /\s/.test(src[at])) at++
    if (at >= end) continue
    let best = null
    for (const r of ranges) {
      if (r.startOffset <= at && at < r.endOffset && (!best || r.endOffset - r.startOffset <= best.endOffset - best.startOffset)) best = r
    }
    if (best && best.count > 0) run.push(n + 1)
  }
  return run
}

function under (root, p) {
  const rel = path.relative(root, p)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null
  if (rel.split(path.sep).includes('node_modules')) return null
  return rel.split(path.sep).join('/')
}

// The temp dirs and environment one covered command runs with.
function covSetup (cwd, env) {
  const root = fs.realpathSync(cwd)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flock-cov-'))
  const nodeDir = path.join(tmp, 'node'); const pyDir = path.join(tmp, 'py'); const siteDir = path.join(tmp, 'site')
  for (const d of [nodeDir, pyDir, siteDir]) fs.mkdirSync(d)
  fs.writeFileSync(path.join(siteDir, 'sitecustomize.py'), SITECUSTOMIZE)
  const childEnv = {
    ...env,
    NODE_V8_COVERAGE: nodeDir,
    PYTHONPATH: env.PYTHONPATH ? siteDir + path.delimiter + env.PYTHONPATH : siteDir,
    FLOCK_COVERAGE_ROOT: root,
    FLOCK_COVERAGE_PY_OUT: pyDir
  }
  return { root, tmp, nodeDir, pyDir, childEnv }
}

function covLines ({ root, nodeDir, pyDir }) {
  const sets = new Map()
  const add = (rel, nums) => {
    if (!sets.has(rel)) sets.set(rel, new Set())
    for (const n of nums) sets.get(rel).add(n)
  }
  for (const name of fs.readdirSync(nodeDir)) {
    let data
    try { data = JSON.parse(fs.readFileSync(path.join(nodeDir, name), 'utf8')) } catch { continue }
    for (const s of data.result || []) {
      if (!s.url || !s.url.startsWith('file://')) continue
      let file
      try { file = fs.realpathSync(fileURLToPath(s.url)) } catch { continue }
      const rel = under(root, file)
      if (rel) add(rel, nodeLines(file, s.functions || []))
    }
  }
  for (const name of fs.readdirSync(pyDir)) {
    let data
    try { data = JSON.parse(fs.readFileSync(path.join(pyDir, name), 'utf8')) } catch { continue }
    for (const [file, nums] of Object.entries(data)) {
      const rel = under(root, file)
      if (rel) add(rel, nums)
    }
  }
  const lines = {}
  for (const [rel, s] of [...sets].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) lines[rel] = [...s].sort((a, b) => a - b)
  return lines
}

export function linesRun ({ argv, cwd, env = process.env, timeoutMs = 60000 }) {
  const cov = covSetup(cwd, env)
  try {
    const r = spawnSync(argv[0], argv.slice(1), { cwd, env: cov.childEnv, timeout: timeoutMs, stdio: 'ignore' })
    const exit = r.error && r.error.code === 'ETIMEDOUT' ? 124 : r.status === null ? (r.signal ? 128 : 1) : r.status
    return { exit, lines: covLines(cov) }
  } finally {
    fs.rmSync(cov.tmp, { recursive: true, force: true })
  }
}

// One job ({ argv, cwd, env }) as linesRun runs it, but asynchronously and as the leader of its own
// process group: at timeoutMs the whole group is killed (grandchildren of `bash -lc` included) and
// it answers exit 124.
function linesRunAsync ({ argv, cwd, env = process.env }, timeoutMs) {
  const cov = covSetup(cwd, env)
  const done = (exit) => {
    try { return { exit, lines: covLines(cov) } } finally { fs.rmSync(cov.tmp, { recursive: true, force: true }) }
  }
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(argv[0], argv.slice(1), { cwd, env: cov.childEnv, stdio: 'ignore', detached: true })
    } catch { resolve(done(1)); return }
    let timedOut = false
    const killGroup = () => { try { process.kill(-child.pid, 'SIGKILL') } catch {} }
    const timer = setTimeout(() => { timedOut = true; killGroup() }, timeoutMs)
    let settled = false
    const finish = (exit) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      // the leader is gone; anything it left behind in its group goes too
      killGroup()
      resolve(done(exit))
    }
    child.on('error', () => finish(1))
    child.on('exit', (code, signal) => finish(timedOut ? 124 : code === null ? (signal ? 128 : 1) : code))
  })
}

// linesRunAll(jobs, { parallel, timeoutMs, budgetMs }): every job as linesRun runs it, at most
// `parallel` at once, each killed with its process group at timeoutMs (exit 124); a job not started
// within budgetMs of the call answers { exit: null, lines: {}, skipped: true } and never runs.
// Answers keep the jobs' order.
export async function linesRunAll (jobs, { parallel = 4, timeoutMs = 60000, budgetMs = 300000 } = {}) {
  const start = Date.now()
  const out = new Array(jobs.length)
  let next = 0
  const worker = async () => {
    while (next < jobs.length) {
      const i = next++
      if (Date.now() - start >= budgetMs) { out[i] = { exit: null, lines: {}, skipped: true }; continue }
      try {
        out[i] = { ...(await linesRunAsync(jobs[i], timeoutMs)), skipped: false }
      } catch {
        out[i] = { exit: 1, lines: {}, skipped: false }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(parallel, jobs.length)) }, worker))
  return out
}
