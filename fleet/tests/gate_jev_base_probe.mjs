#!/usr/bin/env node
// The gate Jev base probe: when the gate reader's diet carries a `base` object (what each named
// file is at BASE), `skills/ultrawrite/stories/gate_jev.ts` hands it to Jev unchanged and asks
// `pinned`: whether a file there already pins the opposite of a clause. It runs the script against
// a local stand-in Jev (a node:http server on 127.0.0.1) answering every `fact:` and `caught:`
// question 0.9, `contradiction` 0.1 and `pinned` by case. The case is argv[2]:
//   pinned-high  a diet with base, `pinned` answered 0.9;
//   pinned-low   a diet with base, `pinned` answered 0.1;
//   no-base      the same diet without base.
// Prints one JSON line {"verdict", "pinned", "asked_pinned", "state_base"} and exits 0; exits 1
// only when it could not run.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const CASE = process.argv[2]
const PINNED = { 'pinned-high': 0.9, 'pinned-low': 0.1, 'no-base': 0.9 }
if (!(CASE in PINNED)) { console.log('usage: gate_jev_base_probe.mjs pinned-high|pinned-low|no-base'); process.exit(1) }
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-jev-base-'))
const HOME = path.join(tmp, 'home')
fs.mkdirSync(HOME)
fs.writeFileSync(path.join(HOME, 'typesafe.env'), 'TYPESAFE_API_KEY=fake-key\n')

let server
const fail = (why) => { console.error(`GATE JEV BASE ${CASE} COULD NOT RUN: ${why}`); server?.close(); process.exit(1) }

// the stand-in Jev
const requests = []
const answer = (k) => (k.startsWith('fact:') || k.startsWith('caught:') ? 0.9 : k === 'contradiction' ? 0.1 : k === 'pinned' ? PINNED[CASE] : 0.5)
server = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', () => {
    if (req.method !== 'POST' || req.url !== '/v1/systemone') { res.writeHead(404); res.end(); return }
    let json = {}
    try { json = JSON.parse(body) } catch {}
    requests.push(json)
    const answers = Object.fromEntries(Object.keys(json.questions || {}).map((k) => [k, { noul: answer(k) }]))
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ answers }))
  })
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))

const base = {
  'fleet/tests/census.test.mjs': {
    exists: true, lines: 42, headings: ['census lists the old paths'],
    excerpt: "12: assert.deepEqual(paths, ['skills/old/a.md', 'skills/old/b.md'])",
  },
}
const diet = {
  task: '4', hash: 'h1',
  claim: 'The census moves to the new paths. Machine: M1. `census` prints `skills/new/a.md`. M2. `census` exits 0.',
  proof: '- Run: node census_probe.mjs text [M1]\n- Run: node census_probe.mjs exit [M2]\n- Legs: (a) it prints the new path [M1]; (b) it exits 0 [M2].',
  ...(CASE === 'no-base' ? {} : { base }),
}
const dietFile = path.join(tmp, 'diet.json')
fs.writeFileSync(dietFile, JSON.stringify(diet))

const run = await new Promise((resolve) => {
  const p = spawn('bun', [path.join(REPO, 'skills/ultrawrite/stories/gate_jev.ts'), dietFile], {
    cwd: REPO,
    env: { ...process.env, TYPESAFE_BASE_URL: `http://127.0.0.1:${server.address().port}`, ULTRAPOWERS_HOME: HOME },
  })
  let stdout = ''
  let stderr = ''
  p.stdout.on('data', (c) => { stdout += c })
  p.stderr.on('data', (c) => { stderr += c })
  p.on('error', (e) => resolve({ code: -1, stdout, stderr: String(e) }))
  p.on('close', (code) => resolve({ code, stdout, stderr }))
})
if (run.code !== 0) fail(`gate_jev exited ${run.code}:\n${run.stdout}${run.stderr}`)
if (requests.length !== 1) fail(`${requests.length} request(s) made, expected 1`)
const lines = run.stdout.split('\n').filter(Boolean)
let out
try { out = JSON.parse(lines[lines.length - 1]) } catch { fail(`stdout is not JSON: ${run.stdout}`) }
server.close()
console.log(JSON.stringify({
  verdict: out.verdict ?? null,
  pinned: out.pinned === undefined ? null : out.pinned,
  asked_pinned: Object.hasOwn(requests[0].questions || {}, 'pinned'),
  state_base: requests[0].state?.base ?? null,
}))
process.exit(0)
