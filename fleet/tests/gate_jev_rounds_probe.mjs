#!/usr/bin/env node
// The gate rounds probe: `skills/ultrawrite/stories/gate_jev.ts --record` is the one writer of
// the gate verdict. Every round, pass or fail, sets the task's {hash, verdict, reason} and appends
// {hash, agent, jev, clauses, contradiction, pinned}. It runs the script against a local
// stand-in Jev (a node:http server on 127.0.0.1) answering every `fact:` 0.9, every `caught:` 0.1
// and `contradiction` 0.1, so Jev's verdict is fail, over a seeded record
// {"tasks": {}, "tally": {"n": 1}, "authoring": {"minutes": 1}, "history": [1]}. The case is argv[2]:
//   two-rounds  task 3 hash h1 `--agent fail --reason x`, then hash h2 `--agent pass --reason y`;
//   offline     task 3 hash h1 `--agent fail --reason x` with Jev at http://127.0.0.1:9;
//   no-reason   task 3 hash h1 `--agent fail` without `--reason`.
// Prints one JSON line {record, exits, changed}: the record after the calls, each call's exit
// code, and whether the file's bytes changed.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const CASE = process.argv[2]
if (!['two-rounds', 'offline', 'no-reason'].includes(CASE)) { console.log('usage: gate_jev_rounds_probe.mjs two-rounds|offline|no-reason'); process.exit(2) }
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-jev-rounds-'))
const HOME = path.join(tmp, 'home')
fs.mkdirSync(HOME)
fs.writeFileSync(path.join(HOME, 'typesafe.env'), 'TYPESAFE_API_KEY=fake-key\n')

// the stand-in Jev
const byPrefix = (k) => (k.startsWith('fact:') ? 0.9 : k.startsWith('caught:') ? 0.1 : k === 'contradiction' ? 0.1 : 0.5)
const server = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', () => {
    if (req.method !== 'POST' || req.url !== '/v1/systemone') { res.writeHead(404); res.end(); return }
    let json = {}
    try { json = JSON.parse(body) } catch {}
    const answers = Object.fromEntries(Object.keys(json.questions || {}).map((k) => [k, { noul: byPrefix(k) }]))
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ answers }))
  })
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const BASE = CASE === 'offline' ? 'http://127.0.0.1:9' : `http://127.0.0.1:${server.address().port}`

const gate = (args) => new Promise((resolve) => {
  const p = spawn('bun', [path.join(REPO, 'skills/ultrawrite/stories/gate_jev.ts'), ...args], {
    cwd: REPO,
    env: { ...process.env, TYPESAFE_BASE_URL: BASE, ULTRAPOWERS_HOME: HOME },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  p.stdout.resume(); p.stderr.resume()
  p.on('close', (code) => resolve(code))
})

const diet = (hash) => {
  const f = path.join(tmp, `diet-${hash}.json`)
  fs.writeFileSync(f, JSON.stringify({
    task: 3, hash,
    claim: 'The report prints its total. Machine: M1. `report` exits 0. M2. stdout is exactly `total 3`.',
    proof: '- Run: node report_probe.mjs exit [M1]\n- Run: node report_probe.mjs text [M2]\n- Legs: (a) the report exits 0 [M1]; (b) it prints the total [M2].',
  }))
  return f
}

const rec = path.join(tmp, 'plan.gate-verdicts.json')
fs.writeFileSync(rec, JSON.stringify({ tasks: {}, tally: { n: 1 }, authoring: { minutes: 1 }, history: [1] }, null, 2) + '\n')
const before = fs.readFileSync(rec)
const exits = []
if (CASE === 'two-rounds') {
  exits.push(await gate([diet('h1'), '--record', rec, '--agent', 'fail', '--reason', 'x']))
  exits.push(await gate([diet('h2'), '--record', rec, '--agent', 'pass', '--reason', 'y']))
} else if (CASE === 'offline') {
  exits.push(await gate([diet('h1'), '--record', rec, '--agent', 'fail', '--reason', 'x']))
} else {
  exits.push(await gate([diet('h1'), '--record', rec, '--agent', 'fail']))
}
server.close()
const after = fs.readFileSync(rec)
console.log(JSON.stringify({ record: JSON.parse(after.toString('utf8')), exits, changed: !before.equals(after) }))
process.exit(0)
