#!/usr/bin/env node
// The gate Jev probe: `skills/ultrawrite/stories/gate_jev.ts` records what Jev would have said at
// the proof gate beside the agent reader's verdict, and reads how often the two agreed. It runs
// the script against a local stand-in Jev (a node:http server on 127.0.0.1) that records each
// request and answers every `fact:` question 0.9, every `caught:` question 0.1 and
// `contradiction` 0.1. The case is argv[2]:
//   record     one diet (task 3, hash h1, clauses M1 and M2) read with `--record --agent pass`:
//              one request asking exactly fact/caught per clause plus contradiction, whose state
//              carries the two clauses; stdout is one JSON line with verdict fail; the seeded
//              record keeps hash, verdict and reason and gains one gate round {h1, pass, fail};
//   agreement  `--agreement` over two records (rounds pass/pass, fail/pass and fail/fail) prints
//              exactly the counts.
// Prints `GATE JEV <case> OK` and exits 0, or names what differed and exits 1.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const CASE = process.argv[2]
if (!['record', 'agreement'].includes(CASE)) { console.log('usage: gate_jev_probe.mjs record|agreement'); process.exit(2) }
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-jev-'))
const HOME = path.join(tmp, 'home')
fs.mkdirSync(HOME)
fs.writeFileSync(path.join(HOME, 'typesafe.env'), 'TYPESAFE_API_KEY=fake-key\n')

let server
const fail = (why) => { console.log(`GATE JEV ${CASE} FAILED: ${why}`); server?.close(); process.exit(1) }
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// the stand-in Jev
const requests = []
const byPrefix = (k) => (k.startsWith('fact:') ? 0.9 : k.startsWith('caught:') ? 0.1 : k === 'contradiction' ? 0.1 : 0.5)
server = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', () => {
    if (req.method !== 'POST' || req.url !== '/v1/systemone') { res.writeHead(404); res.end(); return }
    let json = {}
    try { json = JSON.parse(body) } catch {}
    requests.push({ headers: req.headers, body: json })
    const answers = Object.fromEntries(Object.keys(json.questions || {}).map((k) => [k, { noul: byPrefix(k) }]))
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ answers }))
  })
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))

const gate = (args) => new Promise((resolve) => {
  const p = spawn('bun', [path.join(REPO, 'skills/ultrawrite/stories/gate_jev.ts'), ...args], {
    cwd: REPO,
    env: { ...process.env, TYPESAFE_BASE_URL: `http://127.0.0.1:${server.address().port}`, ULTRAPOWERS_HOME: HOME },
  })
  let stdout = ''
  let stderr = ''
  p.stdout.on('data', (c) => { stdout += c })
  p.stderr.on('data', (c) => { stderr += c })
  p.on('close', (code) => resolve({ code, stdout, stderr }))
})

if (CASE === 'record') {
  const diet = path.join(tmp, 'diet.json')
  fs.writeFileSync(diet, JSON.stringify({
    task: '3', hash: 'h1', base: 'b0',
    claim: 'The report prints its total. Machine: M1. `report` exits 0. M2. stdout is exactly `total 3`.',
    proof: '- Run: node report_probe.mjs exit [M1]\n- Run: node report_probe.mjs text [M2]\n- Legs: (a) the report exits 0 [M1]; (b) it prints the total [M2].',
  }))
  const rec = path.join(tmp, 'plan.gate-verdicts.json')
  const seeded = { hash: 'h0', verdict: 'pass', reason: 'layer match: seeded' }
  fs.writeFileSync(rec, JSON.stringify({ tasks: { 3: seeded }, tally: { dispatched: 1, rejected: 0 } }, null, 2))
  const run = await gate([diet, '--record', rec, '--agent', 'pass'])
  if (run.code !== 0) fail(`gate_jev exited ${run.code}:\n${run.stdout}${run.stderr}`)
  if (requests.length !== 1) fail(`${requests.length} request(s) made, expected 1`)
  const asked = Object.keys(requests[0].body.questions || {}).sort()
  const want = ['caught:M1', 'caught:M2', 'contradiction', 'fact:M1', 'fact:M2']
  if (!same(asked, want)) fail(`the request asks ${JSON.stringify(asked)}, expected ${JSON.stringify(want)}`)
  const clauses = requests[0].body.state?.clauses
  if (!Array.isArray(clauses) || !same(clauses.map((c) => c.id), ['M1', 'M2'])) fail(`the request's clauses are ${JSON.stringify(clauses)}`)
  const lines = run.stdout.split('\n').filter(Boolean)
  if (lines.length !== 1) fail(`stdout is ${lines.length} line(s), expected 1:\n${run.stdout}`)
  let out
  try { out = JSON.parse(lines[0]) } catch { fail(`stdout is not JSON: ${lines[0]}`) }
  if (out.verdict !== 'fail') fail(`verdict ${JSON.stringify(out.verdict)}, expected "fail"`)
  const t = JSON.parse(fs.readFileSync(rec, 'utf8')).tasks?.['3']
  if (!t) fail('the record has no task 3')
  for (const k of ['hash', 'verdict', 'reason']) if (t[k] !== seeded[k]) fail(`the record's ${k} became ${JSON.stringify(t[k])}`)
  if (!same(t.gate_rounds, [{ hash: 'h1', agent: 'pass', jev: 'fail' }])) fail(`gate_rounds is ${JSON.stringify(t.gate_rounds)}`)
} else {
  const dir = path.join(tmp, 'records')
  fs.mkdirSync(dir)
  const task = (rounds) => ({ tasks: { 1: { hash: 'h', verdict: 'pass', reason: 'r', gate_rounds: rounds } } })
  fs.writeFileSync(path.join(dir, 'a.gate-verdicts.json'), JSON.stringify(task([
    { hash: 'h1', agent: 'pass', jev: 'pass' }, { hash: 'h2', agent: 'fail', jev: 'pass' }])))
  fs.writeFileSync(path.join(dir, 'b.gate-verdicts.json'), JSON.stringify(task([{ hash: 'h1', agent: 'fail', jev: 'fail' }])))
  const run = await gate(['--agreement', dir])
  if (run.code !== 0) fail(`gate_jev exited ${run.code}:\n${run.stdout}${run.stderr}`)
  const want = 'gate-jev: n=2 plans, 3 rounds, agree 2, jev-only fail 0, agent-only fail 1'
  if (run.stdout !== want + '\n') fail(`stdout is ${JSON.stringify(run.stdout)}, expected ${JSON.stringify(want)}`)
}
server.close()
console.log(`GATE JEV ${CASE} OK`)
process.exit(0)
