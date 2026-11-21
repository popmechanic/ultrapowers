import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))

export const POLICY_FLOCK = (() => { try { return JSON.parse(fs.readFileSync(path.join(HERE, '..', 'policy.json'), 'utf8')).flock } catch { return undefined } })()
export const EXAM_MS = {
  fact: (POLICY_FLOCK?.exam?.fact_timeout_seconds ?? 60) * 1000,
  setup: (POLICY_FLOCK?.exam?.setup_timeout_seconds ?? 300) * 1000,
}

const IDENTITY = ['-c', 'user.name=flock', '-c', 'user.email=flock@ultrapowers.invalid']

export function gitIn (dir, args, { encoding = 'utf8', ok = false, identity = false, env } = {}) {
  const r = spawnSync('git', [...(identity ? IDENTITY : []), '-C', dir, ...args], { encoding, env, maxBuffer: 256 * 1024 * 1024 })
  if (r.error) throw r.error
  if (r.status !== 0 && !ok) throw new Error(`git ${args.join(' ')} in ${dir} exited ${r.status}: ${r.stderr}`)
  return r
}

const UTF8 = new TextDecoder('utf-8', { fatal: true })
export const utf8 = (buf) => { if (buf === null) return null; try { return UTF8.decode(buf) } catch { return undefined } }

export function writeFiles (dir, entries) {
  for (const [p, content] of entries) {
    const f = path.join(dir, p)
    if (content === null) { fs.rmSync(f, { force: true }); continue }
    fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, content)
  }
}
export const snapshotEntries = (s) => Object.entries(s.files).map(([p, text]) => [p, s.exists[p] ? text : null])

export function startWeave () {
  const wp = spawn('python3', [path.join(HERE, 'weave.py')], { stdio: ['pipe', 'pipe', 'inherit'] })
  const waiting = []
  let closed = false
  const rl = readline.createInterface({ input: wp.stdout })
  rl.on('line', (l) => waiting.shift().resolve(JSON.parse(l)))
  rl.on('close', () => { closed = true; for (const w of waiting.splice(0)) w.reject(new Error('weave keeper exited')) })
  return {
    send: (o) => new Promise((resolve, reject) => {
      if (closed) return reject(new Error('weave keeper exited'))
      waiting.push({ resolve, reject }); wp.stdin.write(JSON.stringify(o) + '\n')
    }),
    end: () => wp.stdin.end(),
  }
}

export function readEventRows (file) {
  let text
  try { text = fs.readFileSync(file, 'utf8') } catch { return [] }
  const rows = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try { rows.push(JSON.parse(line)) } catch {}
  }
  return rows
}

