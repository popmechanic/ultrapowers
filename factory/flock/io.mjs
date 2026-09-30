// The Flock's shared plumbing (#1439): the engine (engine.mjs), the catch-up (catchup.mjs) and the
// boot's board CLI (../board.mjs) each wrote these once of their own.
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))

// the engine's commits and the catch-up's are authored `flock`
const IDENTITY = ['-c', 'user.name=flock', '-c', 'user.email=flock@ultrapowers.invalid']

// One git process in `dir`; its spawnSync result. A non-zero exit throws unless `ok`. `encoding`
// defaults to utf8 ('buffer' for bytes); `identity` authors as flock; `env` replaces the environment.
export function gitIn (dir, args, { encoding = 'utf8', ok = false, identity = false, env } = {}) {
  const r = spawnSync('git', [...(identity ? IDENTITY : []), '-C', dir, ...args], { encoding, env, maxBuffer: 256 * 1024 * 1024 })
  if (r.error) throw r.error
  if (r.status !== 0 && !ok) throw new Error(`git ${args.join(' ')} in ${dir} exited ${r.status}: ${r.stderr}`)
  return r
}

// A file's bytes as text: null stays null (absent), bytes that are not UTF-8 are undefined.
const UTF8 = new TextDecoder('utf-8', { fatal: true })
export const utf8 = (buf) => { if (buf === null) return null; try { return UTF8.decode(buf) } catch { return undefined } }

// Writes each [path, content] under dir, a null content deleting the path.
export function writeFiles (dir, entries) {
  for (const [p, content] of entries) {
    const f = path.join(dir, p)
    if (content === null) { fs.rmSync(f, { force: true }); continue }
    fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, content)
  }
}
// a weave snapshot's files ({files, exists}) as writeFiles entries
export const snapshotEntries = (s) => Object.entries(s.files).map(([p, text]) => [p, s.exists[p] ? text : null])

// The weave keeper (weave.py), one JSON request and one JSON answer per line, in order. `send`
// resolves the answer as it came; once the keeper exits, every pending and later send rejects.
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

// events.jsonl's rows in file order; a line that does not parse is skipped, and a missing or
// empty file gives none
export function readEventRows (file) {
  let text
  try { text = fs.readFileSync(file, 'utf8') } catch { return [] }
  const rows = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try { rows.push(JSON.parse(line)) } catch { /* a torn line is skipped */ }
  }
  return rows
}

// a kata.json record's hub address: its integer project.id and non-empty run.uid, else null
export function kataIds (doc) {
  const projectId = doc && doc.project && doc.project.id
  const runUid = doc && doc.run && doc.run.uid
  return Number.isInteger(projectId) && typeof runUid === 'string' && runUid ? { projectId, runUid } : null
}
