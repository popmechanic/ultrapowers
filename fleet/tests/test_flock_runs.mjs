#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { simEnv } from './_helpers.mjs'
import { REPO, flockTarget, task, writePlan, flockRun } from './_flock_helpers.mjs'

const fails = []
const cases = []
const test = (name, fn) => cases.push([name, fn])
const assert = (ok, why) => { if (!ok) throw new Error(why) }

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
    fs.writeFileSync(path.join(t.RUN, 'provenance.json'), JSON.stringify({ snap: 'x', hunks: [{ path: 'a.txt', lines: '5', task: '1' }], exceptions: [] }))
  }
  const r = spawnSync('node', [path.join(REPO, 'factory', 'flock', 'catchup.mjs'), '--plan', plan, '--target', t.T,
    '--base', t.base, '--onto', onto, '--run-dir', t.RUN], { encoding: 'utf8', timeout: 120000, env: simEnv({ home: t.tmp, env: t.over }) })
  const last = (r.stdout || '').trim().split('\n').pop() || ''
  let out
  try { out = JSON.parse(last) } catch { throw new Error(`last stdout line is not JSON: ${JSON.stringify(last)} (exit ${r.status}; stderr ${(r.stderr || '').slice(-400)})`) }
  const head = t.git('rev-parse', 'HEAD')
  const text = fs.readFileSync(path.join(t.T, 'a.txt'), 'utf8')
  if (CASE === 'clean' || CASE === 'remap') {
    assert(r.status === 0 && out.caughtUp === true, `exit ${r.status}, ${last}`)
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
    assert(r.status !== 0 && out.caughtUp === false && out.reason === CASE, `exit ${r.status}, ${last}`)
    assert(head === runSha, `HEAD moved to ${head}; the run's commit is ${runSha}`)
    assert(!t.git('status', '--porcelain'), 'the tree is not clean')
  }
  t.done()
})

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
  assert(JSON.stringify(prov.hunks) === JSON.stringify([{ path: 'p.py', lines: '1-4', task: '1' }]), `hunks ${JSON.stringify(prov.hunks)}`)
  assert(!('unproven' in prov) && !('coverage' in prov), `the retired coverage keys are written: ${Object.keys(prov)}`)
  t.done()
})

const PROV_PR = {
  full: [{ hunks: [{ path: 'a.js', lines: '3-4', task: '1' }, { path: 'b.js', lines: '7', task: '2' }], exceptions: [{ kind: 'contested', path: 'a.js' }, { kind: 'lost', path: 'b.js' }] },
    '3 changed lines from 2 tasks; exceptions: 1 contested, 1 lost, 0 ordered, 0 foreign.'],
  shared: [{ hunks: [{ path: 'a.js', lines: '1', task: '1' }, { path: 'a.js', lines: '2', task: '1|2' }, { path: 'a.js', lines: '3', task: '2' }], exceptions: [] },
    '3 changed lines from 2 tasks; exceptions: 0 contested, 0 lost, 0 ordered, 0 foreign.'],
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

const word = (id, w, { iface, run } = {}) => task({ id, title: `Write ${w} into a.txt`, files: ['Modify: `a.txt`'], claim: `a.txt carries ${w}.`,
  run: run ?? `grep -q ${w} a.txt`, stale: 'path-absent: `a.txt`', iface })
const PEER_SCRIPT = { 1: { 'a.txt': 'x ONE z\n' }, 2: { 'a.txt': 'x ONEz TWO\n' }, '@hold_ms': { 2: 3000 } }
const TRIALS = {
  release: { tasks: [word(1, 'DONE')], script: {} },
  resolve: { base: 'x\n', tasks: [word(1, 'ONE'), word(2, 'TWO')], script: { 1: { 'a.txt': 'ONE\n' }, 2: { 'a.txt': 'x\nTWO\n' } } },
  reuse: { tasks: [word(1, 'ONE', { iface: '- Produces: `ONE`' }), word(2, 'TWO', { iface: '- Consumes: `ONE`' })], script: { 1: { 'a.txt': 'x ONE z\n' }, 2: { 'a.txt': 'x ONEz TWO\n' } } },
  peer: { tasks: [word(1, 'ONE'), word(2, 'TWO')], script: PEER_SCRIPT },
  'survival-restored': { tasks: [word(1, 'ONE'), word(2, 'NONE', { run: 'test -f a.txt' }), word(3, 'BACK', { run: 'grep -q ONE a.txt' })],
    script: { 1: { 'a.txt': 'x ONE z\n' }, 2: { 'a.txt': '' }, 3: { 'a.txt': 'x ONE z\n' }, '@hold_ms': { 2: 3000, 3: 6000 } } },
}

for (const [CASE, s] of Object.entries(TRIALS)) test(`peer ${CASE}`, async () => {
  const t = flockTarget({ 'a.txt': s.base ?? (s.tasks.length > 1 ? 'x y z\n' : 'x\n') })
  const plan = writePlan(t, { claim: 'a.txt says what the tasks write.', check: 'test -f a.txt', tasks: s.tasks })
  const r = await flockRun(t, { plan, script: s.script })
  assert(r.rows, `no events.jsonl (engine exit ${r.code}): ${r.out.slice(-1500)}`)
  const { of } = r
  const end = of('terminal').at(-1)
  const endsReady = () => {
    assert(end?.pr === 'ready', `expected the run to end ready, saw ${JSON.stringify(end)}`)
    assert(r.code === 0, `engine exit ${r.code} for a ready run`)
  }
  if (CASE === 'release') {
    const parked = of('task:parked').filter((x) => x.task === '1')
    assert(parked.length === 1 && parked[0].releases === 3, `expected one task:parked row for task 1 after 3 give-backs, saw ${JSON.stringify(parked)}`)
  } else if (CASE === 'resolve') {
    assert(of('resolve-task').some((x) => x.path === 'a.txt'), `the engine added no resolve task for a.txt: ${r.out.slice(-1500)}`)
  } else if (CASE === 'survival-restored') {
    const sv = of('survival')
    assert(sv.some((x) => (x.lost || []).some((e) => e.path === 'a.txt' && e.lines.includes('x ONE z'))), `survival rows: ${JSON.stringify(sv)}`)
    endsReady()
  } else {
    const pr = of('peer:rewrite')
    const want = (x) => x.path === 'a.txt' && x.task === '2' && x.peers.join() === 'A.1' && x.peer.join() === 'x ONE z' && x.before.join() === 'x y z' && x.after.join() === 'x ONEz TWO'
    assert(pr.length === 1 && want(pr[0]), `expected one peer:rewrite row over task 1's line, saw ${JSON.stringify(pr)}`)
    if (CASE === 'peer') {
      const sv = of('survival'), edges = of('edge')
      assert(edges.length && edges.every((e) => sv.filter((x) => x.snap === e.snap).length === 1), `survival snaps ${JSON.stringify(sv.map((x) => x.snap))} for edges ${JSON.stringify(edges.map((e) => e.snap))}`)
      const last = sv.find((x) => x.snap === edges.at(-1).snap)
      const lost = JSON.stringify([{ path: 'a.txt', author: 'A.1', by: 'B.2', lines: ['x ONE z'] }])
      assert(JSON.stringify(last.lost) === lost, `expected the last snapshot to lose ${lost}, saw ${JSON.stringify(last.lost)}`)
      endsReady()
    }
  }
  t.done()
})

const note = task({ id: 2, title: 'Write NOTE into b.txt', files: ['Modify: `b.txt`'], claim: 'b.txt carries NOTE.', run: 'grep -q NOTE b.txt', stale: 'path-absent: `b.txt`' })
test('loose', async () => {
  const t = flockTarget({ 'a.txt': 'x y z\n', 'b.txt': 'b\n' })
  const plan = writePlan(t, { claim: 'a.txt and b.txt say what the tasks write.', check: 'test -f a.txt', tasks: [word(1, 'WIPE'), note] })
  const why = 'a.txt wipes every folder; it should wipe only the page folder'
  const r = await flockRun(t, { plan, script: { 1: { 'a.txt': 'x WIPE z\n' }, 2: { 'b.txt': 'NOTE\n' }, 'L:loose': { 'a.txt': 'x WIPE page z\n' },
    '@beliefs': [{ task: '2', about: 'app', path: 'a.txt', claim: why, stale: 'x WIPE z' }] } })
  assert(r.rows, `no events.jsonl (engine exit ${r.code}): ${r.out.slice(-1500)}`)
  const pr = r.of('peer:rewrite').filter((x) => x.task === 'L:loose')
  assert(pr.length === 1 && pr[0].path === 'a.txt', `expected one peer:rewrite row by L:loose on a.txt, saw ${JSON.stringify(r.of('peer:rewrite'))}`)
  const body = r.of('loose-task')[0]?.body || ''
  assert(body.includes("Change only what a loose end names: leave other builders' lines as they are, and post a belief if one of them needs changing."), `the L:loose body reads ${JSON.stringify(body)}`)
  const end = r.of('terminal').at(-1)
  assert(end?.pr === 'ready' && r.code === 0 && r.of('loose:fallback').length === 0, `expected a ready run with no fallback, saw ${JSON.stringify(r.of('terminal'))} exit ${r.code}`)
  assert(t.git('show', 'HEAD:a.txt') === 'x WIPE page z', `the landed a.txt reads ${JSON.stringify(t.git('show', 'HEAD:a.txt'))}`)
  t.done()
})

test('loose-window', async () => {
  const t = flockTarget({ 'a.txt': 'x y z\n', 'b.txt': 'NOTE pending\n' })
  const plan = writePlan(t, { claim: 'a.txt and b.txt say what the tasks write.', check: 'test -f a.txt', tasks: [word(1, 'WIPE'), note] })
  const r = await flockRun(t, { plan, script: { 1: { 'a.txt': 'x WIPE z\n' }, 2: { 'b.txt': 'NOTE\n' }, 'L:loose': { 'a.txt': 'x WIPE page z\n' },
    '@stall_ms': 4000, '@hold_ms': { 2: 2000, 'L:loose': 2500 },
    '@beliefs': [{ task: '1', about: 'app', path: 'a.txt', claim: 'a.txt wipes every folder', stale: 'x WIPE z' }] } })
  assert(r.rows, `no events.jsonl (engine exit ${r.code}): ${r.out.slice(-1500)}`)
  const first = r.of('edge').find((x) => x.green), opened = r.of('loose-task')[0]
  assert(first && opened && Date.parse(opened.ts) - Date.parse(first.ts) >= 1500, `expected the cleanup to open well after the first green, saw green ${first?.ts} and loose-task ${opened?.ts}`)
  assert(r.of('stall:no-progress').length === 0 && r.of('loose:fallback').length === 0, `expected no stop and no fallback, saw ${JSON.stringify(r.rows.filter((x) => /^stall:|^loose:fallback/.test(x.kind)))}`)
  const end = r.of('terminal').at(-1)
  assert(end?.pr === 'ready' && end.snap !== opened.snap && r.code === 0, `expected a ready run past the pre-cleanup snapshot ${opened.snap}, saw ${JSON.stringify(r.of('terminal'))} exit ${r.code}`)
  assert(t.git('show', 'HEAD:a.txt') === 'x WIPE page z', `the landed a.txt reads ${JSON.stringify(t.git('show', 'HEAD:a.txt'))}`)
  t.done()
})

test('loose-stalled', async () => {
  const t = flockTarget({ 'a.txt': 'x y z\n', 'b.txt': 'b\n' })
  const plan = writePlan(t, { claim: 'a.txt and b.txt say what the tasks write.', check: 'test -f a.txt', tasks: [word(1, 'WIPE'), note] })
  const r = await flockRun(t, { plan, script: { 1: { 'a.txt': 'x WIPE z\n' }, 2: { 'b.txt': 'NOTE\n' },
    '@beliefs': [{ task: '2', about: 'app', path: 'a.txt', claim: 'a.txt wipes every folder', stale: 'x WIPE z' }] } })
  assert(r.rows, `no events.jsonl (engine exit ${r.code}): ${r.out.slice(-1500)}`)
  const pre = r.of('loose-task')[0]?.snap
  const end = r.of('terminal').at(-1)
  assert(end?.pr === 'ready' && end.snap === pre, `expected the run to end ready on the pre-cleanup snapshot ${pre}, saw ${JSON.stringify(r.of('terminal'))}`)
  assert(r.code === 0, `engine exit ${r.code} for a ready run`)
  const fb = r.of('loose:fallback')
  assert(fb.length === 1 && fb[0].snap === pre && /deadlock|no progress/.test(fb[0].why), `expected one loose:fallback row to ${pre} for the draft, saw ${JSON.stringify(fb)}`)
  assert(r.of('settled').at(-1)?.snap === pre, `expected the last settled row on ${pre}, saw ${JSON.stringify(r.of('settled'))}`)
  const pb = spawnSync('node', [path.join(REPO, 'factory', 'record.mjs'), 'pr-body', plan, '--events', path.join(t.RUN, 'events.jsonl')], { encoding: 'utf8', env: simEnv({ home: t.tmp }) })
  const lines = pb.stdout.split('\n'), at = lines.indexOf('### Loose ends')
  const want = `The cleanup was dropped: ${fb[0].why}. This lands ${pre}, the snapshot that was green before it.`
  assert(at >= 0 && lines.slice(at).some((l) => l.startsWith('- open: a.txt still contains "x WIPE z"')), `expected the Loose ends section read against the landed snapshot, it reads ${JSON.stringify(lines.slice(at, at + 6))}`)
  assert(at >= 0 && lines.slice(at).includes(want), `expected the Loose ends section to carry ${JSON.stringify(want)}, it reads ${JSON.stringify(lines.slice(at, at + 6))}`)
  t.done()
})

test('empty landing claims-v1', async () => {
  const t = flockTarget({ 'a.txt': 'todo\n' })
  const plan = writePlan(t, {
    claim: 'a.txt reads DONE.', check: 'test -f a.txt',
    tasks: [task({ id: 1, title: 'Mark the file', files: ['Modify: `a.txt`'], claim: 'a.txt reads DONE.', stale: 'path-absent: `a.txt`', run: 'test -f a.txt' })],
  })
  const r = await flockRun(t, { plan, script: { 1: {} } })
  const tail = `(exit ${r.code}; ${r.out.slice(-600)})`
  assert(r.code === 1, `a claims-v1 run that lands nothing exits 1, got ${r.code} ${tail}`)
  const empty = r.of('landing:empty')
  assert(empty.length === 1 && empty[0].grammar === 'claims-v1', `landing:empty rows: ${JSON.stringify(empty)} ${tail}`)
  assert(r.of('landing').length === 0, `landing rows: ${JSON.stringify(r.of('landing'))}`)
  assert(t.git('rev-parse', 'HEAD') === t.base, 'HEAD moved off the base')
  t.done()
})

test('loose-fallback-empty', async () => {
  const t = flockTarget({ 'a.txt': 'x WIPE z\n', 'b.txt': 'NOTE\n' })
  const plan = writePlan(t, { claim: 'a.txt and b.txt say what the tasks write.', check: 'test -f a.txt', tasks: [word(1, 'WIPE'), note] })
  const r = await flockRun(t, { plan, script: { 1: {}, 2: {},
    '@beliefs': [{ task: '2', about: 'app', path: 'a.txt', claim: 'a.txt wipes every folder', stale: 'x WIPE z' }] } })
  assert(r.rows, `no events.jsonl (engine exit ${r.code}): ${r.out.slice(-1500)}`)
  const tail = `(exit ${r.code}; ${r.out.slice(-600)})`
  assert(r.of('loose:fallback').length === 1, `expected one loose:fallback row, saw ${JSON.stringify(r.of('loose:fallback'))} ${tail}`)
  const empty = r.of('landing:empty')
  assert(empty.length === 1 && empty[0].grammar === 'claims-v1', `landing:empty rows: ${JSON.stringify(empty)} ${tail}`)
  assert(r.code === 1, `a claims-v1 run that lands nothing exits 1, got ${r.code} ${tail}`)
  t.done()
})

test('checker-cannot-run', async () => {
  const F = '```'
  const PROBE = '{"clause":"S1.1","do":[{"click":{"name":"Add","role":"button"}}],"expect":[{"unchanged":true}],"given":[],"holds_before":true,"judge":null,"layer":"ui","see":[{"count":1,"name":"Add","role":"button"}]}'
  const t = flockTarget({ 'note.txt': 'base\n' })
  const bin = path.join(t.tmp, 'bin')
  fs.mkdirSync(bin)
  fs.writeFileSync(path.join(bin, 'bun'), '#!/bin/sh\ncase "$*" in *check.ts*) echo "bun: the checker is missing" >&2; exit 127;; esac\nexit 0\n', { mode: 0o755 })
  t.over.PATH = simEnv({ bin, home: t.tmp }).PATH
  const plan = path.join(t.tmp, 'plan.md')
  fs.writeFileSync(plan, `# Sim plan

**Grammar:** stories-v1
**Stack:** tinyapp
**Plan-id:** p1
**Kind:** behaviour
**Summary:** One. Two. Three.
**Store:** \`store.js\` sha256:${'0'.repeat(64)}

## Stories

- S1: You add a note; it shows.

### Task 1: The note piece

**Piece:** note
**Depends-on-pieces:** none

**Files:**
- Create: \`client/src/pieces/note.json\`

**Purpose:** Keep notes.

**Stories:**
- S1: You add a note; it shows.

**Proof:**
${F}probe
${PROBE}
${F}
`)
  const r = await flockRun(t, { plan, script: { 1: { 'client/src/pieces/note.json': '{"root":"note","elements":{}}\n' } } })
  assert(r.rows, `no events.jsonl (engine exit ${r.code}): ${r.out.slice(-1500)}`)
  const tail = `(exit ${r.code}; ${r.out.slice(-600)})`
  assert(r.of('checker:start')[0]?.exit === 127, `expected a checker:start row with exit 127, saw ${JSON.stringify(r.of('checker:start'))} ${tail}`)
  const ends = r.of('terminal')
  assert(ends.length === 1 && ends[0].pr === 'draft' && String(ends[0].why).startsWith('the checker cannot run on this sandbox: '),
    `expected one draft terminal row naming the checker, saw ${JSON.stringify(ends)} ${tail}`)
  assert(r.of('loose:fallback').length === 0, `expected no loose:fallback, saw ${JSON.stringify(r.of('loose:fallback'))}`)
  assert(r.of('builder:open').length === 0, `expected no builder to open, saw ${JSON.stringify(r.of('builder:open'))}`)
  t.done()
})

for (const [name, fn] of cases) {
  try { await fn(); console.log(`ok   ${name}`) } catch (e) { fails.push(name); console.log(`FAIL ${name}: ${e.message}`) }
}
if (fails.length) { console.log(`${fails.length} FAILED: ${fails.join(', ')}`); process.exit(1) }
console.log('ALL TESTS PASSED')
