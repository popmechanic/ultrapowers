#!/usr/bin/env node
// The Jev calls probe: the authoring checks (`skills/ultrawrite/stories/jev_checks.ts`) send each
// question the evidence its answer turns on, send the store once, batch what shares a state and
// ride the same client the fleet uses. It copies `skills/ultrawrite/catalog/todo-tags` (2 pieces,
// 5 actions, 1 link) to a temp dir and runs the checks against a local stand-in Jev (a node:http
// server on 127.0.0.1) that answers every asked key {noul: 0.5} and records each request's headers
// and body. The case is argv[2], the stage run:
//   bundle         the store goes once (5 questions), pieces are compared in one request (2
//                  entries), near-miss requests carry story_steps, the link request carries the
//                  summary, every request carries the key as a bearer header, and product.json
//                  saves 5 branches_on_text readings;
//   map            every request carries other_purposes (1 entry) and no top-level purpose;
//   decompose      every request carries a non-empty summary and a built_before array;
//   understanding  one request carries sentences (2 entries) with 2 questions.
// Prints `JEV CALLS <case> OK` and exits 0, or names what differed and exits 1.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const CASE = process.argv[2]
if (!['bundle', 'map', 'decompose', 'understanding'].includes(CASE)) {
  console.log('usage: jev_calls_probe.mjs bundle|map|decompose|understanding'); process.exit(2)
}
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jev-calls-'))
const COPY = path.join(tmp, 'todo-tags')
const HOME = path.join(tmp, 'home')
fs.cpSync(path.join(REPO, 'skills/ultrawrite/catalog/todo-tags'), COPY, { recursive: true })
fs.mkdirSync(HOME)
fs.writeFileSync(path.join(HOME, 'typesafe.env'), 'TYPESAFE_API_KEY=fake-key\n')

let server
const fail = (why) => { console.log(`JEV CALLS ${CASE} FAILED: ${why}`); server?.close(); process.exit(1) }

// the stand-in Jev
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

if (CASE === 'bundle') {
  const store = has('store_module')
  if (store.length !== 1) fail(`${store.length} request(s) carry store_module, expected 1`)
  if (nq(store[0]) !== 5) fail(`the store request asks ${nq(store[0])} question(s), expected 5`)
  const pieces = has('pieces')
  if (pieces.length !== 1) fail(`${pieces.length} request(s) carry pieces, expected 1`)
  if (!Array.isArray(pieces[0].body.state.pieces) || pieces[0].body.state.pieces.length !== 2) fail('the pieces request does not carry 2 entries')
  const near = has('near_miss')
  if (!near.length) fail('no request carries near_miss')
  for (const r of near) {
    if (!Array.isArray(r.body.state.story_steps) || !r.body.state.story_steps.length) fail('a near_miss request carries no story_steps')
  }
  const link = has('link')
  if (!link.length) fail('no request carries link')
  for (const r of link) {
    if (typeof r.body.state.summary !== 'string' || !r.body.state.summary) fail('a link request carries no summary string')
  }
  for (const r of requests) {
    if (r.headers.authorization !== 'Bearer fake-key') fail(`a request carries authorization ${JSON.stringify(r.headers.authorization)}`)
  }
  const product = JSON.parse(fs.readFileSync(path.join(COPY, 'product.json'), 'utf8'))
  const n = (product.readings || []).filter((x) => x.question === 'branches_on_text').length
  if (n !== 5) fail(`product.json holds ${n} branches_on_text reading(s), expected 5`)
} else if (CASE === 'map') {
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
