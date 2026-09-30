#!/usr/bin/env node
// The kata hub probe (not a bridged sim: the name does not match test_*.mjs).
// `node fleet/tests/flock_kata_hub_probe.mjs` builds a throwaway target in a temp dir with no remote
// and a one-task plan written as run-42.md, starts a `node:http` stub on 127.0.0.1:0 standing in for
// the hub (every POST answers 200 with a comment receipt `cu-<n>`), and runs the Flock with the
// scripted builder and `--kata-url <stub> --kata-json <record>`, no `--kata-project`. It prints one
// JSON line, last:
//   exit       the engine's exit code
//   posts      each request the stub saw: {path, key} (key: its Idempotency-Key header, or null)
//   mirror_ok  the count of `kata:mirror` event rows with ok: true and a comment_uid
//   abandoned  the sum of the `abandoned` cells of the `kata:mirror` rows (0 when none)
// `--no-run-uid` writes the record without run.uid (the engine then mirrors nothing); `--hang` makes
// the stub record each request and never answer it (the engine's own post timeout and exit wait
// bound the run; the stub's open sockets are destroyed when the engine exits).
// Prints the object even when the engine exits non-zero and exits 0; exits 1 only when it could not run.
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const NO_RUN_UID = process.argv.includes('--no-run-uid'), HANG = process.argv.includes('--hang')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flock-kata-hub-'))
const cleanup = () => fs.rmSync(tmp, { recursive: true, force: true })
const fail = (why) => { console.log(`KATA HUB PROBE FAILED: ${why}`); cleanup(); process.exit(1) }

const T = path.join(tmp, 'target')
fs.mkdirSync(T)
const git = (...a) => {
  const r = spawnSync('git', ['-c', 'user.name=probe', '-c', 'user.email=probe@invalid', '-c', 'init.defaultBranch=main', ...a], { cwd: T, encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z' } })
  if (r.status !== 0) fail(`git ${a.join(' ')} failed: ${r.stderr}`)
  return r.stdout.trim()
}
fs.writeFileSync(path.join(T, 'a.txt'), 'a\n')
git('init', '-q'); git('add', '-A'); git('commit', '-qm', 'base')
const base = git('rev-parse', 'HEAD')

const plan = path.join(tmp, 'run-42.md')
fs.writeFileSync(plan, `# Kata hub probe plan

**Grammar:** claims-v1
**Claim:** a.txt says A. (elicited)
**Summary:** One. Two. Three.
**Goal:** probe
**Tech Stack:** bash

## Global Constraints

- Check: test -f a.txt

### Task 1: Change a.txt

**Type:** implementation

**Files:**
- Modify: \`a.txt\`

**Claim:** a.txt says A. (derived)
Machine: M1. a.txt carries A.

**Authorized-by:** probe

**Interfaces:**
- Produces: none

**Context:** none

**Proof:**
- Run: grep -q A a.txt [M1]
- Legs: (a) a.txt carries A [M1].

**Stale-if:**
- path-absent: \`a.txt\`
`)
const script = path.join(tmp, 'script.json')
fs.writeFileSync(script, JSON.stringify({ 1: { 'a.txt': 'A\n' } }))
const record = path.join(tmp, 'run-42.kata.json')
fs.writeFileSync(record, JSON.stringify({ project: { id: 5, name: 'o-r' }, ...(NO_RUN_UID ? {} : { run: { uid: 'R' } }), tasks: { 1: { uid: 'T1' } } }))

const posts = []
const sockets = new Set()
const server = http.createServer((req, res) => {
  req.resume()
  req.on('end', () => {
    if (req.method !== 'POST') { res.writeHead(404); res.end(); return }
    const n = posts.length + 1
    posts.push({ path: req.url, key: req.headers['idempotency-key'] ?? null })
    if (HANG) return
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ changed: true, comment: { uid: `cu-${n}`, created_at: '2026-09-30T00:00:00Z' }, event: { id: n } }))
  })
})
server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)) })
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const hub = `http://127.0.0.1:${server.address().port}`

const runDir = path.join(tmp, 'run')
const exit = await new Promise((resolve) => {
  const child = spawn('node', [path.join(REPO, 'factory', 'flock', 'engine.mjs'), '--plan', plan, '--target', T, '--base', base,
    '--run-dir', runDir, '--builder', `scripted:${script}`, '--clock', '120', '--stall-minutes', '2',
    '--kata-url', hub, '--kata-json', record, '--kata-actor', 'engine:run-42'],
  { stdio: ['ignore', 'ignore', 'ignore'], env: { ...process.env, TYPESAFE_BASE_URL: '', ULTRAPOWERS_FLEET_RUN: 'run-42' } })
  const timer = setTimeout(() => child.kill('SIGKILL'), 180000)
  child.on('error', (e) => { clearTimeout(timer); server.close(); fail(`the engine could not start: ${e.message}`) })
  child.on('close', (code) => { clearTimeout(timer); resolve(code) })
})
for (const s of sockets) s.destroy()
server.close()

let mirrorOk = 0, abandoned = 0
try {
  for (const line of fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8').split('\n')) {
    if (!line.trim()) continue
    let row
    try { row = JSON.parse(line) } catch { continue }
    if (row.kind === 'kata:mirror' && row.ok === true && row.comment_uid) mirrorOk++
    if (row.kind === 'kata:mirror' && Number.isInteger(row.abandoned)) abandoned += row.abandoned
  }
} catch {}
console.log(JSON.stringify({ exit, posts, mirror_ok: mirrorOk, abandoned }))
cleanup()
