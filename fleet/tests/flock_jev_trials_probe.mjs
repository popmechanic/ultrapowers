#!/usr/bin/env node
// The Jev trials probe: every Flock run records what Jev would have said at a task given back
// (`jev:release`) and at a merge conflict (`jev:resolve`), without changing what the run does.
// It builds a throwaway git target in a temp dir, writes a claims-v1 plan and runs the scripted
// Flock against a local stand-in Jev (a node:http server on 127.0.0.1) that answers every asked
// key {choice: 'plan_defect', confidence: 0.9} and counts requests. The case is argv[2]:
//   release  a one-task plan whose script names no files: the task is given back until it parks;
//            one jev:release row per give-back (3), each carrying the stand-in's answer, and one
//            task:parked row for task 1;
//   resolve  two tasks write into the same line of a.txt (base `x`): task 1 replaces it with ONE,
//            task 2 keeps it and adds TWO after it. Both replacing it would merge as a union (adds
//            only), which never blocks; this shape conflicts, so a resolve task is added; at least one jev:resolve row, every one for a.txt with the stand-in's answer;
//   off      the release plan with TYPESAFE_BASE_URL empty: no jev:release row, no request;
//   peer     (#1401) task 1 turns a.txt's `x y z` into `x ONE z`; task 2, held until then, writes
//            `x ONEz TWO` over task 1's line, as run-277's builder ran two of a peer's words
//            together. The stand-in answers `loses`: one peer:rewrite row and one
//            jev:peer-rewrite row naming task 1's line, and the run ends a draft;
//   peer-keeps  the same plan, the stand-in answering `keeps`: the rows, and the run ends ready.
//   survival  the peer plan, the stand-in answering `loses`: one survival row per tested snapshot,
//            the last carrying task 1's lost line; the lost line read as a loss ends the run a draft;
//   survival-keeps  the same, answering `keeps`: the run ends ready.
//   reuse    the peer script with task 2 consuming task 1's interface, so one builder A does both
//            and no hold is needed; the stand-in answers `loses`: A's second task over its first
//            task's line is one peer:rewrite row (peers `A.1`), and the run ends a draft.
// Every agent name pinned is an authorship label, `A.1` for builder A on task 1.
// Prints `JEV TRIALS <case> OK` and exits 0, or names what differed and exits 1.
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { simEnv } from './_helpers.mjs'

const CASE = process.argv[2]
if (!['release', 'resolve', 'off', 'peer', 'peer-keeps', 'survival', 'survival-keeps', 'reuse'].includes(CASE)) { console.log('usage: flock_jev_trials_probe.mjs release|resolve|off|peer|peer-keeps|survival|survival-keeps|reuse'); process.exit(2) }
const PEER = ['peer', 'peer-keeps', 'survival', 'survival-keeps', 'reuse'].includes(CASE)
const CHOICE = CASE === 'peer' || CASE === 'survival' || CASE === 'reuse' ? 'loses' : PEER ? 'keeps' : 'plan_defect'
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flock-jev-trials-'))
const T = path.join(tmp, 'target')
const RUN = path.join(tmp, 'run')
fs.mkdirSync(T)
const fail = (why) => { console.log(`JEV TRIALS ${CASE} FAILED: ${why}`); process.exit(1) }

// the stand-in Jev
let requests = 0
const server = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', () => {
    if (req.method !== 'POST' || req.url !== '/v1/systemone') { res.writeHead(404); res.end(); return }
    requests += 1
    let keys = []
    try { keys = Object.keys(JSON.parse(body).questions || {}) } catch {}
    const answers = Object.fromEntries(keys.map((k) => [k, { choice: CHOICE, confidence: 0.9 }]))
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ answers }))
  })
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const URL_ = CASE === 'off' ? '' : `http://127.0.0.1:${server.address().port}`
const ENV = simEnv({ home: tmp, env: { TYPESAFE_BASE_URL: URL_ } })

const git = (...a) => {
  const r = spawnSync('git', ['-c', 'user.name=sim', '-c', 'user.email=sim@invalid', '-c', 'init.defaultBranch=main', ...a], { cwd: T, encoding: 'utf8', env: ENV })
  if (r.status !== 0) fail(`git ${a.join(' ')}: ${r.stderr}`)
  return r.stdout.trim()
}
fs.writeFileSync(path.join(T, 'a.txt'), PEER ? 'x y z\n' : 'x\n')
git('init', '-q'); git('add', '-A'); git('commit', '-qm', 'base')
const base = git('rev-parse', 'HEAD')

const task = (id, word, depends, iface = '- Produces: none') => `### Task ${id}: Write ${word} into a.txt

**Type:** implementation

**Files:**
- Modify: \`a.txt\`

**Claim:** a.txt says ${word}. (derived)
Machine: M1. a.txt carries ${word}.

**Authorized-by:** sim

**Interfaces:**
${iface}

**Context:** none
${depends ? '\n**Depends-on:** ' + depends + '\n' : ''}
**Proof:**
- Run: grep -q ${word} a.txt [M1]
- Legs: (a) a.txt carries ${word} [M1].

**Stale-if:**
- path-absent: \`a.txt\`
`
const header = `# Jev trials sim plan

**Grammar:** claims-v1
**Claim:** a.txt says what the tasks write. (elicited)
**Summary:** One. Two. Three.
**Goal:** sim
**Tech Stack:** bash

## Global Constraints

- Check: test -f a.txt

`
const plan = path.join(tmp, 'plan.md')
const script = path.join(tmp, 'script.json')
if (CASE === 'resolve') {
  fs.writeFileSync(plan, header + task(1, 'ONE') + '\n' + task(2, 'TWO'))
  fs.writeFileSync(script, JSON.stringify({ 1: { 'a.txt': 'ONE\n' }, 2: { 'a.txt': 'x\nTWO\n' } }))
} else if (CASE === 'reuse') {
  // task 2 consumes task 1's interface, so the one builder A does task 1, then task 2 over its line
  fs.writeFileSync(plan, header + task(1, 'ONE', null, '- Produces: `ONE`') + '\n' + task(2, 'TWO', null, '- Consumes: `ONE`'))
  fs.writeFileSync(script, JSON.stringify({ 1: { 'a.txt': 'x ONE z\n' }, 2: { 'a.txt': 'x ONEz TWO\n' } }))
} else if (PEER) {
  // two builders at once; task 2's holds until task 1 has published, then pulls and writes over its line
  fs.writeFileSync(plan, header + task(1, 'ONE') + '\n' + task(2, 'TWO'))
  fs.writeFileSync(script, JSON.stringify({ 1: { 'a.txt': 'x ONE z\n' }, 2: { 'a.txt': 'x ONEz TWO\n' }, '@hold_ms': { 2: 3000 } }))
} else {
  fs.writeFileSync(plan, header + task(1, 'DONE'))
  fs.writeFileSync(script, JSON.stringify({}))
}

const code = await new Promise((resolve) => {
  const p = spawn('node', [path.join(REPO, 'factory', 'flock', 'engine.mjs'), '--plan', plan, '--target', T, '--base', base,
    '--run-dir', RUN, '--builder', `scripted:${script}`, '--clock', '120', '--stall-minutes', '2'], { env: ENV, stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  p.stdout.on('data', (c) => { out += c }); p.stderr.on('data', (c) => { out += c })
  const kill = setTimeout(() => p.kill('SIGKILL'), 180000)
  p.on('close', (c) => { clearTimeout(kill); if (process.env.PROBE_VERBOSE) console.log(out); resolve({ c, out }) })
})
server.close()
const evPath = path.join(RUN, 'events.jsonl')
if (!fs.existsSync(evPath)) fail(`no events.jsonl (engine exit ${code.c}): ${code.out.slice(-1500)}`)
const rows = fs.readFileSync(evPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
const of = (k) => rows.filter((r) => r.kind === k)

if (CASE === 'release' || CASE === 'off') {
  const parked = of('task:parked').filter((r) => r.task === '1')
  if (parked.length !== 1) fail(`expected one task:parked row for task 1, saw ${parked.length}`)
  const rel = of('jev:release')
  if (CASE === 'off') {
    if (rel.length) fail(`expected no jev:release row, saw ${rel.length}`)
    if (requests) fail(`expected no request to the stand-in, saw ${requests}`)
  } else {
    const gives = parked[0].releases
    if (gives !== 3) fail(`expected 3 give-backs before parking, saw ${gives}`)
    if (rel.length !== gives) fail(`expected ${gives} jev:release rows, saw ${rel.length}: ${JSON.stringify(rel)}`)
    const bad = rel.filter((r) => r.task !== '1' || r.answer !== 'plan_defect' || r.confidence !== 0.9)
    if (bad.length) fail(`jev:release rows differ: ${JSON.stringify(bad)}`)
  }
} else if (PEER) {
  const pr = of('peer:rewrite'), jr = of('jev:peer-rewrite')
  const want = (r) => r.path === 'a.txt' && r.task === '2' && r.peers.join() === 'A.1' && r.peer.join() === 'x ONE z' && r.before.join() === 'x y z' && r.after.join() === 'x ONEz TWO'
  if (pr.length !== 1 || !want(pr[0])) fail(`expected one peer:rewrite row over task 1's line, saw ${JSON.stringify(pr)}`)
  if (jr.length !== 1 || !want(jr[0]) || jr[0].answer !== CHOICE) fail(`expected one jev:peer-rewrite row answered ${CHOICE}, saw ${JSON.stringify(jr)}`)
  const end = of('terminal').at(-1)
  const pr_ = CHOICE === 'loses' ? 'draft' : 'ready'
  if (CASE.startsWith('survival')) {
    const sv = of('survival'), edges = of('edge')
    const bad = edges.filter((e) => sv.filter((r) => r.snap === e.snap).length !== 1)
    if (!edges.length || bad.length) fail(`expected one survival row per edge snap, saw ${JSON.stringify(sv.map((r) => r.snap))} for edges ${JSON.stringify(edges.map((e) => e.snap))}`)
    const last = sv.find((r) => r.snap === edges.at(-1).snap)
    const want_ = JSON.stringify([{ path: 'a.txt', author: 'A.1', by: 'B.2', lines: ['x ONE z'] }])
    if (JSON.stringify(last.lost) !== want_) fail(`expected the last snapshot to lose ${want_}, saw ${JSON.stringify(last.lost)}`)
  }
  if (!end || end.pr !== pr_) fail(`expected the run to end ${pr_}, saw ${JSON.stringify(end)}`)
  if ((code.c === 0) !== (pr_ === 'ready')) fail(`engine exit ${code.c} for a ${pr_} run`)
} else {
  if (!of('resolve-task').length) fail(`the engine added no resolve task: ${code.out.slice(-1500)}`)
  const res = of('jev:resolve')
  if (!res.length) fail('no jev:resolve row')
  const bad = res.filter((r) => r.path !== 'a.txt' || r.answer !== 'plan_defect')
  if (bad.length) fail(`jev:resolve rows differ: ${JSON.stringify(bad)}`)
}
console.log(`JEV TRIALS ${CASE} OK`)
process.exit(0)
