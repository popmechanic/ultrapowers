#!/usr/bin/env node
// The Flock's run sims (#1447): the catch-up, a deleted path, the provenance record and its PR
// section, and the record-only Jev trials. Each case builds a throwaway git target in a temp dir
// (_flock_helpers.mjs); the engine runs with the scripted builder, and Jev is a local stand-in (a
// node:http server on 127.0.0.1) or off. Prints `ALL TESTS PASSED` and exits 0, or names each case
// that differed and exits 1.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { simEnv } from './_helpers.mjs'
import { REPO, flockTarget, task, writePlan, flockRun } from './_flock_helpers.mjs'

const fails = []
const cases = []
const test = (name, fn) => cases.push([name, fn])
const assert = (ok, why) => { if (!ok) throw new Error(why) }

// ── the catch-up (catchup.mjs) ─────────────────────────────────────────────────
// A base of five lines, a moved main beside it, and the run's own commit on the base.
//   clean     main changed another line: exit 0, {refolded, head}, HEAD's one parent the moved main,
//             the file carrying both sides' lines
//   conflict  main changed the run's own line: {refolded: false, reason: conflict}, HEAD the run's commit
//   red       the join is clean but the probe is red on it: {refolded: false, reason: red}
//   remap     main puts M1, M2 above `one`: provenance.json's hunk at line 5 lands at line 7
const MAIN = { clean: ['one', 'two', 'three', 'four', 'MAIN'], conflict: ['MAIN', 'two', 'three', 'four', 'five'], red: ['one', 'two', 'three', 'four', 'RED'], remap: ['M1', 'M2', 'one', 'two', 'three', 'four', 'five'] }
for (const CASE of Object.keys(MAIN)) test(`catchup ${CASE}`, () => {
  const lines = (l) => l.join('\n') + '\n'
  const t = flockTarget({ 'a.txt': lines(['one', 'two', 'three', 'four', 'five']) })
  const write = (l) => fs.writeFileSync(path.join(t.T, 'a.txt'), lines(l))
  const plan = writePlan(t, {
    claim: 'A line reads RUN after the catch-up.', check: 'test -f a.txt',
    tasks: [task({ id: 1, title: 'Mark the line', files: ['Modify: `a.txt`'], claim: 'a.txt carries RUN.', stale: 'path-absent: `a.txt`',
      run: CASE === 'red' ? 'grep -q RUN a.txt && ! grep -q RED a.txt' : 'grep -q RUN a.txt' })],
  })
  t.git('checkout', '-qb', 'moved'); write(MAIN[CASE]); t.git('commit', '-qam', 'main moved')
  const onto = t.git('rev-parse', 'HEAD')
  t.git('checkout', '-qb', 'run', t.base)
  write(CASE === 'remap' ? ['one', 'two', 'three', 'four', 'RUN'] : ['RUN', 'two', 'three', 'four', 'five'])
  t.git('commit', '-qam', 'the run')
  const runSha = t.git('rev-parse', 'HEAD')
  if (CASE === 'remap') {
    fs.mkdirSync(t.RUN)
    fs.writeFileSync(path.join(t.RUN, 'provenance.json'), JSON.stringify({ snap: 'x', hunks: [{ path: 'a.txt', lines: '5', task: '1' }], exceptions: [], unproven: null }))
  }
  const r = spawnSync('node', [path.join(REPO, 'factory', 'flock', 'catchup.mjs'), '--plan', plan, '--target', t.T,
    '--base', t.base, '--onto', onto, '--run-dir', t.RUN], { encoding: 'utf8', timeout: 120000, env: simEnv({ home: t.tmp, env: t.over }) })
  const last = (r.stdout || '').trim().split('\n').pop() || ''
  let out
  try { out = JSON.parse(last) } catch { throw new Error(`last stdout line is not JSON: ${JSON.stringify(last)} (exit ${r.status}; stderr ${(r.stderr || '').slice(-400)})`) }
  const head = t.git('rev-parse', 'HEAD')
  const text = fs.readFileSync(path.join(t.T, 'a.txt'), 'utf8')
  if (CASE === 'clean' || CASE === 'remap') {
    assert(r.status === 0 && out.refolded === true, `exit ${r.status}, ${last}`)
    assert(out.head === head, `head ${out.head} is not HEAD ${head}`)
    const parents = t.git('rev-list', '--parents', '-n', '1', 'HEAD').split(' ').slice(1)
    assert(parents.length === 1 && parents[0] === onto, `HEAD's parents are ${parents.join(',')}, not the moved main ${onto}`)
    if (CASE === 'clean') assert(/^RUN$/m.test(text) && /^MAIN$/m.test(text), `a.txt lacks one side: ${JSON.stringify(text)}`)
    else {
      assert(text === 'M1\nM2\none\ntwo\nthree\nfour\nRUN\n', `a.txt is ${JSON.stringify(text)}`)
      const prov = JSON.parse(fs.readFileSync(path.join(t.RUN, 'provenance.json'), 'utf8'))
      assert(JSON.stringify(prov.hunks) === JSON.stringify([{ path: 'a.txt', lines: '7', task: '1' }]), `hunks are ${JSON.stringify(prov.hunks)}`)
      assert(prov.caughtUp?.head === head, `caughtUp is ${JSON.stringify(prov.caughtUp)}, HEAD ${head}`)
      assert(prov.snap === 'x', 'the record lost its other keys')
    }
  } else {
    assert(r.status !== 0 && out.refolded === false && out.reason === CASE, `exit ${r.status}, ${last}`)
    assert(head === runSha, `HEAD moved to ${head}; the run's commit is ${runSha}`)
    assert(!t.git('status', '--porcelain'), 'the tree is not clean')
  }
  t.done()
})

// ── a deleted path lands as a deletion ─────────────────────────────────────────
test('delete', async () => {
  const t = flockTarget({ 'keep.txt': 'kept\n', 'gone.txt': 'gone\n' })
  const plan = writePlan(t, {
    claim: 'gone.txt is gone and keep.txt says KEPT.', check: 'test -f keep.txt',
    tasks: [task({ id: 1, title: 'Delete one file, change another', files: ['Delete: `gone.txt`', 'Modify: `keep.txt`'],
      claim: 'gone.txt does not exist and keep.txt carries KEPT.', run: 'test ! -e gone.txt && grep -q KEPT keep.txt', stale: 'path-absent: `keep.txt`' })],
  })
  const r = await flockRun(t, { plan, script: { 1: { 'gone.txt': null, 'keep.txt': 'KEPT\n' } } })
  assert(r.code === 0, `the engine exited ${r.code}; its output ends: ${r.out.slice(-600)}`)
  const head = t.git('rev-parse', 'HEAD')
  assert(head !== t.base, 'no commit landed on the target')
  const changed = t.git('diff', '--name-status', t.base, head).split('\n').sort()
  assert(JSON.stringify(changed) === JSON.stringify(['D\tgone.txt', 'M\tkeep.txt']), `the landed commit changes ${JSON.stringify(changed)}`)
  assert(!fs.existsSync(path.join(t.T, 'gone.txt')), 'gone.txt is still in the target tree')
  t.done()
})

// ── provenance.json: the landed lines, and the one no probe ran (#1404) ──────────
test('provenance run', async () => {
  const t = flockTarget({ 'README.md': 'sim\n' })
  const plan = writePlan(t, {
    claim: 'p.py prints ok.', check: 'test -f p.py',
    tasks: [task({ id: 1, title: 'Write p.py', files: ['Create: `p.py`'], claim: 'python3 p.py exits 0.', run: 'python3 p.py', stale: 'path-exists: `p.py`' })],
  })
  const r = await flockRun(t, { plan, script: { 1: { 'p.py': "import sys\nif len(sys.argv) > 1:\n    print('never')\nprint('ok')" } } })
  const provPath = path.join(t.RUN, 'provenance.json')
  assert(fs.existsSync(provPath), `no provenance.json (engine exit ${r.code}): ${r.out.slice(-1500)}`)
  const prov = JSON.parse(fs.readFileSync(provPath, 'utf8'))
  assert(JSON.stringify(prov.hunks) === JSON.stringify([{ path: 'p.py', lines: '1-4', task: '1', clauses: ['M1'] }]), `hunks ${JSON.stringify(prov.hunks)}`)
  assert(JSON.stringify(prov.unproven) === JSON.stringify([{ path: 'p.py', lines: '3', task: '1' }]), `unproven ${JSON.stringify(prov.unproven)}`)
  t.done()
})

// ── the PR body's Provenance section (record.mjs pr-body --provenance) ───────────
const PROV_PR = {
  full: [{ hunks: [{ path: 'a.js', lines: '3-4', task: '1', clauses: ['M1'] }, { path: 'b.js', lines: '7', task: '2' }], exceptions: [{ kind: 'contested', path: 'a.js' }, { kind: 'lost', path: 'b.js' }], unproven: [{ path: 'b.js', lines: '7', task: '2' }] },
    '3 changed lines from 2 tasks; 1 not run by any probe; exceptions: 1 contested, 1 lost, 0 ordered, 0 foreign.'],
  partial: [{ hunks: [{ path: 'a.js', lines: '3-4', task: '1', clauses: ['M1'] }, { path: 'b.js', lines: '7', task: '2' }], exceptions: [{ kind: 'contested', path: 'a.js' }, { kind: 'lost', path: 'b.js' }], unproven: [{ path: 'b.js', lines: '7', task: '2' }], coverage: { ran: 2, timed_out: 1, skipped: 0, unmeasured: 1 } },
    '3 changed lines from 2 tasks; 1 not run by any probe (2 probes unmeasured); exceptions: 1 contested, 1 lost, 0 ordered, 0 foreign.'],
  shared: [{ hunks: [{ path: 'a.js', lines: '1', task: '1' }, { path: 'a.js', lines: '2', task: '1|2' }, { path: 'a.js', lines: '3', task: '2' }], exceptions: [], unproven: [] },
    '3 changed lines from 2 tasks; 0 not run by any probe; exceptions: 0 contested, 0 lost, 0 ordered, 0 foreign.'],
}
for (const [CASE, [record, want]] of Object.entries(PROV_PR)) test(`provenance pr ${CASE}`, () => {
  const t = flockTarget({ 'README.md': 'sim\n' })
  const plan = path.join(t.tmp, 'plan.md')
  fs.writeFileSync(plan, '# Provenance sim\n\nOne task, so the body has a plan to read.\n\n### Task 1: The one task\n\n**Type:** implementation\n\n**Proof:**\n- Run: true\n')
  const events = path.join(t.tmp, 'events.jsonl'), prov = path.join(t.tmp, 'provenance.json')
  fs.writeFileSync(events, ''); fs.writeFileSync(prov, JSON.stringify(record))
  const r = spawnSync('node', [path.join(REPO, 'factory', 'record.mjs'), 'pr-body', plan, '--events', events, '--provenance', prov], { encoding: 'utf8', env: simEnv({ home: t.tmp }) })
  assert(r.status === 0, `pr-body exited ${r.status}: ${r.stderr}`)
  const lines = r.stdout.split('\n'), at = lines.indexOf('### Provenance')
  assert(at >= 0, 'no ### Provenance heading')
  assert(lines[at + 1] === '' && lines[at + 2] === want, `the section reads ${JSON.stringify(lines.slice(at, at + 3))}`)
  t.done()
})

// ── the record-only Jev trials and the peer-rewrite read ─────────────────────────
// The stand-in answers every asked key with the case's `choice` at 0.9.
//   release  a one-task plan whose script names no files: given back until it parks (3), one
//            jev:release row per give-back carrying the answer
//   off      the same with Jev off: no jev:release row, no request
//   resolve  two tasks write into the same line of a.txt: a resolve task, and jev:resolve rows for a.txt
//   peer     task 2, held until task 1 publishes `x ONE z`, writes `x ONEz TWO` over it (run-277):
//            one peer:rewrite and one jev:peer-rewrite row naming task 1's line; `loses` ends a draft
//   peer-keeps      the same answered `keeps`: the run ends ready
//   survival        the peer plan answered `loses`: one survival row per edge snapshot, the last
//                   losing task 1's line; the run ends a draft
//   survival-keeps  the same answered `keeps`: the run ends ready
//   survival-restored  task 2 deletes task 1's line and task 3 writes it back: `loses` is read, the
//                   survival row lists the line lost, and the run ends ready
//   reuse    task 2 consumes task 1's interface, so builder A does both: one peer:rewrite row (peers A.1)
let choice = null, requests = 0
const server = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', () => {
    if (req.method !== 'POST' || req.url !== '/v1/systemone') { res.writeHead(404); res.end(); return }
    requests += 1
    let keys = []
    try { keys = Object.keys(JSON.parse(body).questions || {}) } catch {}
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ answers: Object.fromEntries(keys.map((k) => [k, { choice, confidence: 0.9 }])) }))
  })
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const JEV = `http://127.0.0.1:${server.address().port}`

const word = (id, w, { iface, run } = {}) => task({ id, title: `Write ${w} into a.txt`, files: ['Modify: `a.txt`'], claim: `a.txt carries ${w}.`,
  run: run ?? `grep -q ${w} a.txt`, stale: 'path-absent: `a.txt`', iface })
const TRIALS = {
  release: { choice: 'plan_defect', tasks: [word(1, 'DONE')], script: {} },
  off: { choice: 'plan_defect', jev: '', tasks: [word(1, 'DONE')], script: {} },
  resolve: { choice: 'plan_defect', base: 'x\n', tasks: [word(1, 'ONE'), word(2, 'TWO')], script: { 1: { 'a.txt': 'ONE\n' }, 2: { 'a.txt': 'x\nTWO\n' } } },
  reuse: { choice: 'loses', tasks: [word(1, 'ONE', { iface: '- Produces: `ONE`' }), word(2, 'TWO', { iface: '- Consumes: `ONE`' })], script: { 1: { 'a.txt': 'x ONE z\n' }, 2: { 'a.txt': 'x ONEz TWO\n' } } },
  'survival-restored': { choice: 'loses', tasks: [word(1, 'ONE'), word(2, 'NONE', { run: 'test -f a.txt' }), word(3, 'BACK', { run: 'grep -q ONE a.txt' })],
    script: { 1: { 'a.txt': 'x ONE z\n' }, 2: { 'a.txt': '' }, 3: { 'a.txt': 'x ONE z\n' }, '@hold_ms': { 2: 3000, 3: 6000 } } },
}
const PEER_SCRIPT = { 1: { 'a.txt': 'x ONE z\n' }, 2: { 'a.txt': 'x ONEz TWO\n' }, '@hold_ms': { 2: 3000 } }
for (const [c, ch] of [['peer', 'loses'], ['peer-keeps', 'keeps'], ['survival', 'loses'], ['survival-keeps', 'keeps']]) TRIALS[c] = { choice: ch, tasks: [word(1, 'ONE'), word(2, 'TWO')], script: PEER_SCRIPT }

for (const [CASE, s] of Object.entries(TRIALS)) test(`jev trials ${CASE}`, async () => {
  choice = s.choice; requests = 0
  const t = flockTarget({ 'a.txt': s.base ?? (s.tasks.length > 1 ? 'x y z\n' : 'x\n') }, { env: { TYPESAFE_BASE_URL: s.jev ?? JEV } })
  const plan = writePlan(t, { claim: 'a.txt says what the tasks write.', check: 'test -f a.txt', tasks: s.tasks })
  const r = await flockRun(t, { plan, script: s.script })
  assert(r.rows, `no events.jsonl (engine exit ${r.code}): ${r.out.slice(-1500)}`)
  const { of } = r
  const end = of('terminal').at(-1)
  const endsAs = (pr) => {
    assert(end?.pr === pr, `expected the run to end ${pr}, saw ${JSON.stringify(end)}`)
    assert((r.code === 0) === (pr === 'ready'), `engine exit ${r.code} for a ${pr} run`)
  }
  if (CASE === 'release' || CASE === 'off') {
    const parked = of('task:parked').filter((x) => x.task === '1')
    assert(parked.length === 1, `expected one task:parked row for task 1, saw ${parked.length}`)
    const rel = of('jev:release')
    if (CASE === 'off') assert(!rel.length && !requests, `expected no jev:release row and no request, saw ${rel.length} and ${requests}`)
    else {
      assert(parked[0].releases === 3, `expected 3 give-backs before parking, saw ${parked[0].releases}`)
      assert(rel.length === 3 && rel.every((x) => x.task === '1' && x.answer === 'plan_defect' && x.confidence === 0.9), `jev:release rows: ${JSON.stringify(rel)}`)
    }
  } else if (CASE === 'resolve') {
    assert(of('resolve-task').length, `the engine added no resolve task: ${r.out.slice(-1500)}`)
    const res = of('jev:resolve')
    assert(res.length && res.every((x) => x.path === 'a.txt' && x.answer === 'plan_defect'), `jev:resolve rows: ${JSON.stringify(res)}`)
  } else if (CASE === 'survival-restored') {
    const jr = of('jev:peer-rewrite')
    assert(jr.some((x) => x.path === 'a.txt' && x.answer === 'loses' && (x.peer || []).includes('x ONE z')), `jev:peer-rewrite rows: ${JSON.stringify(jr)}`)
    const sv = of('survival')
    assert(sv.some((x) => (x.lost || []).some((e) => e.path === 'a.txt' && e.lines.includes('x ONE z'))), `survival rows: ${JSON.stringify(sv)}`)
    endsAs('ready')
  } else {
    const pr = of('peer:rewrite'), jr = of('jev:peer-rewrite')
    const want = (x) => x.path === 'a.txt' && x.task === '2' && x.peers.join() === 'A.1' && x.peer.join() === 'x ONE z' && x.before.join() === 'x y z' && x.after.join() === 'x ONEz TWO'
    assert(pr.length === 1 && want(pr[0]), `expected one peer:rewrite row over task 1's line, saw ${JSON.stringify(pr)}`)
    assert(jr.length === 1 && want(jr[0]) && jr[0].answer === s.choice, `expected one jev:peer-rewrite row answered ${s.choice}, saw ${JSON.stringify(jr)}`)
    if (CASE.startsWith('survival')) {
      const sv = of('survival'), edges = of('edge')
      assert(edges.length && edges.every((e) => sv.filter((x) => x.snap === e.snap).length === 1), `survival snaps ${JSON.stringify(sv.map((x) => x.snap))} for edges ${JSON.stringify(edges.map((e) => e.snap))}`)
      const last = sv.find((x) => x.snap === edges.at(-1).snap)
      const lost = JSON.stringify([{ path: 'a.txt', author: 'A.1', by: 'B.2', lines: ['x ONE z'] }])
      assert(JSON.stringify(last.lost) === lost, `expected the last snapshot to lose ${lost}, saw ${JSON.stringify(last.lost)}`)
    }
    endsAs(s.choice === 'loses' ? 'draft' : 'ready')
  }
  t.done()
})

for (const [name, fn] of cases) {
  try { await fn(); console.log(`ok   ${name}`) } catch (e) { fails.push(name); console.log(`FAIL ${name}: ${e.message}`) }
}
server.close()
if (fails.length) { console.log(`${fails.length} FAILED: ${fails.join(', ')}`); process.exit(1) }
console.log('ALL TESTS PASSED')
