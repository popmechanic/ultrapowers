#!/usr/bin/env node
// The gate Jev reading probe (#1497): which reading `skills/ultrawrite/stories/gate_jev.ts` asks,
// per policy.json `gate_reading`. It runs the script with `--record` against a local stand-in Jev
// (a node:http server on 127.0.0.1) answering every `fact:` and `caught:` question 0.9,
// `contradiction` 0.1 and `pinned` 0.1. The diet's base holds OWN (the task's own file, marked
// `"own": "modify"`) and SIB (a sibling test, unmarked). The case is argv[2]:
//   own-files  base files [OWN, SIB], the repository's policy;
//   own-only   base files [OWN], the repository's policy;
//   rollback   base files [OWN, SIB], on a copy whose gate_reading is caught "caught", own_files "read".
// Prints one JSON line {requests, asked, state_base, caught_M1, verdict, pinned, round} and exits 0;
// exits 1 only when it could not run.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const CASE = process.argv[2]
const CASES = ['own-files', 'own-only', 'rollback']
if (!CASES.includes(CASE)) { console.log(`usage: gate_jev_reading_probe.mjs ${CASES.join('|')}`); process.exit(1) }
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-jev-reading-'))
const HOME = path.join(tmp, 'home')
fs.mkdirSync(HOME)
fs.writeFileSync(path.join(HOME, 'typesafe.env'), 'TYPESAFE_API_KEY=fake-key\n')

let server
const fail = (why) => { console.error(`GATE JEV READING ${CASE} COULD NOT RUN: ${why}`); server?.close(); process.exit(1) }

// the root gate_jev.ts runs from: the repository, or for rollback a copy with both cells set back
let root = REPO
if (CASE === 'rollback') {
  root = path.join(tmp, 'repo')
  try {
    const stories = path.join(root, 'skills/ultrawrite/stories')
    fs.mkdirSync(stories, { recursive: true })
    fs.mkdirSync(path.join(root, 'factory'), { recursive: true })
    for (const f of ['gate_jev.ts', 'jev.ts', 'questions.json', 'policy.json']) {
      fs.copyFileSync(path.join(REPO, 'skills/ultrawrite/stories', f), path.join(stories, f))
    }
    fs.copyFileSync(path.join(REPO, 'factory/jev-client.mjs'), path.join(root, 'factory/jev-client.mjs'))
    const pf = path.join(stories, 'policy.json')
    const policy = JSON.parse(fs.readFileSync(pf, 'utf8'))
    policy.gate_reading = { ...(policy.gate_reading ?? {}), caught: 'caught', own_files: 'read' }
    fs.writeFileSync(pf, JSON.stringify(policy, null, 2) + '\n')
  } catch (e) { fail(`could not build the copy: ${e}`) }
}

// the stand-in Jev
const requests = []
const answer = (k) => (k.startsWith('fact:') || k.startsWith('caught:') ? 0.9 : k === 'contradiction' ? 0.1 : k === 'pinned' ? 0.1 : 0.5)
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

const OWN = {
  path: 'skills/census.mjs', status: 'present', lines: 30, headings: [],
  excerpt: "12: const ROOT = 'skills/old'", truncated: false, own: 'modify',
}
const SIB = {
  path: 'fleet/tests/census.test.mjs', status: 'present', lines: 42, headings: [],
  excerpt: "12: assert.deepEqual(paths, ['skills/old/a.md'])", truncated: false,
}
const diet = {
  task: '4', hash: 'h1',
  claim: 'The census moves to the new paths. Machine: M1. `census` prints `skills/new/a.md`. M2. `census` exits 0.',
  proof: '- Run: node census_probe.mjs text [M1]\n- Run: node census_probe.mjs exit [M2]\n- Legs: (a) it prints the new path [M1]; (b) it exits 0 [M2].',
  base: { rev: 'r0', files: CASE === 'own-only' ? [OWN] : [OWN, SIB] },
}
const dietFile = path.join(tmp, 'diet.json')
fs.writeFileSync(dietFile, JSON.stringify(diet))
const rec = path.join(tmp, 'plan.gate-verdicts.json')

const run = await new Promise((resolve) => {
  const p = spawn('bun', [path.join(root, 'skills/ultrawrite/stories/gate_jev.ts'), dietFile,
    '--record', rec, '--agent', 'pass', '--reason', 'r'], {
    cwd: root,
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
if (!requests.length) fail('no request made')
const lines = run.stdout.split('\n').filter(Boolean)
let out
try { out = JSON.parse(lines[lines.length - 1]) } catch { fail(`stdout is not JSON: ${run.stdout}`) }
let rounds
try { rounds = JSON.parse(fs.readFileSync(rec, 'utf8')).tasks?.['4']?.gate_rounds } catch (e) { fail(`no record: ${e}`) }
server.close()
const q = requests[0].questions || {}
console.log(JSON.stringify({
  requests: requests.length,
  asked: Object.keys(q).sort(),
  state_base: requests[0].state?.base ?? null,
  caught_M1: q['caught:M1'] ?? null,
  verdict: out.verdict ?? null,
  pinned: out.pinned === undefined ? null : out.pinned,
  round: Array.isArray(rounds) && rounds.length ? rounds[rounds.length - 1] : null,
}))
process.exit(0)
