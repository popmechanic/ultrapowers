#!/usr/bin/env node
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const CASE = process.argv[2]
if (!['map', 'decompose', 'understanding'].includes(CASE)) {
  console.log('usage: jev_calls_probe.mjs map|decompose|understanding'); process.exit(2)
}
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jev-calls-'))
const COPY = path.join(tmp, 'product')
const HOME = path.join(tmp, 'home')
fs.cpSync(path.join(REPO, 'evals/fixtures/product'), COPY, { recursive: true })
fs.mkdirSync(HOME)
fs.writeFileSync(path.join(HOME, 'typesafe.env'), 'TYPESAFE_API_KEY=fake-key\n')

let server
const fail = (why) => { console.log(`JEV CALLS ${CASE} FAILED: ${why}`); server?.close(); process.exit(1) }

const requests = []
server = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', () => {
    if (req.method !== 'POST' || req.url !== '/v1/systemone') { res.writeHead(404); res.end(); return }
    let json = {}
    try { json = JSON.parse(body) } catch {}
    requests.push({ headers: req.headers, body: json })
    const answers = Object.fromEntries(Object.keys(json.questions || {}).map((k) => [k, { noul: 0.5 }]))
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ answers }))
  })
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))

const run = await new Promise((resolve) => {
  const p = spawn('bun', [path.join(REPO, 'skills/ultrawrite/stories/jev_checks.ts'), COPY, '--stage', CASE], {
    cwd: REPO,
    env: { ...process.env, TYPESAFE_BASE_URL: `http://127.0.0.1:${server.address().port}`, ULTRAPOWERS_HOME: HOME },
  })
  let out = ''
  p.stdout.on('data', (c) => { out += c })
  p.stderr.on('data', (c) => { out += c })
  p.on('close', (code) => resolve({ code, out }))
})
if (run.code !== 0) fail(`jev_checks exited ${run.code}:\n${run.out}`)
if (!requests.length) fail(`the stand-in received no request:\n${run.out}`)

const states = requests.map((r) => r.body.state || {})
const nq = (r) => Object.keys(r.body.questions || {}).length
const has = (k) => requests.filter((r) => r.body.state && Object.hasOwn(r.body.state, k))

for (const r of requests) {
  if (r.headers.authorization !== 'Bearer fake-key') fail(`a request carries authorization ${JSON.stringify(r.headers.authorization)}`)
}
if (CASE === 'map') {
  for (const s of states) {
    if (!Array.isArray(s.other_purposes) || s.other_purposes.length !== 1) fail(`a map request carries other_purposes ${JSON.stringify(s.other_purposes)}`)
    if (Object.hasOwn(s, 'purpose')) fail('a map request carries a top-level purpose')
  }
} else if (CASE === 'decompose') {
  for (const s of states) {
    if (typeof s.summary !== 'string' || !s.summary) fail('a decompose request carries no summary string')
    if (!Array.isArray(s.built_before)) fail('a decompose request carries no built_before array')
  }
} else {
  const sent = has('sentences')
  if (sent.length !== 1) fail(`${sent.length} request(s) carry sentences, expected 1`)
  if (!Array.isArray(sent[0].body.state.sentences) || sent[0].body.state.sentences.length !== 2) fail('the sentences request does not carry 2 entries')
  if (nq(sent[0]) !== 2) fail(`the sentences request asks ${nq(sent[0])} question(s), expected 2`)
}
server.close()
console.log(`JEV CALLS ${CASE} OK`)
process.exit(0)
