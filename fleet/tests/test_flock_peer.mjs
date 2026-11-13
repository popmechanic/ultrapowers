#!/usr/bin/env node
// The peer sim (the main-is-a-peer design, stage 3): the target's default branch moves while a
// scripted Flock run is live, and the run takes the move in. Each case builds a throwaway target
// with a bare `origin` beside it (_flock_helpers.mjs), runs the engine looking at main every two seconds,
// and pushes one commit to origin's main from a second clone while task 2 holds the run open.
//   clean     task 1 wrote a.txt's first line; main changes its last line, changes a file that is
//             not text and adds a file. The run settles ready on the moved main: `main:moved` names
//             the tip, the landed commit's one parent is the tip, a.txt carries both lines, the
//             other two files are main's, `base` and summary.json name the tip, and the stored
//             entry names both writers of a.txt, the run's task and main's commit.
//   conflict  task 1 put a line between two lines that main deletes. The conflict opens inside the
//             run, with a resolve task for it; the scripted builder cannot resolve one, so the
//             run ends a draft, and its draft commit sits on the moved main.
//   behind    main moved before the run began. The run takes the move in before its first builder
//             opens (`main:moved` with why `start`), and settles ready on the moved main.
//   created   task 1 creates new.txt and main creates new.txt too. The merge can only put one whole
//             file after the other, so a conflict opens (`created: both`) with a resolve task for
//             it, where the run once settled ready on the two files stacked; the scripted builder
//             cannot resolve one, so the run ends a draft.
//   made in the run  two tasks of one plan each create new.txt, with no main in it. Both tasks'
//             probes run on the join, so it stays a union: no conflict opens, and the run is ready.
//   folded    task 2, held until main's last line MAIN has arrived, writes FOLDED over it, and the
//             stand-in Jev reads that edit as `loses`. Before the draft the engine looks again:
//             it shows Jev main's lines, the lost one and the whole settled file, with main's
//             commit subject as what main meant. Answered `carried`, the run ends ready.
//   dropped   the same, the second look answered `drops`: the run ends a draft.
// Prints `ALL TESTS PASSED` and exits 0, or names what differed and exits 1.
import { spawnSync } from 'node:child_process'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { simEnv } from './_helpers.mjs'
import { flockTarget, task, writePlan, flockRun } from './_flock_helpers.mjs'

const fail = (why) => { console.log(`PEER FAILED: ${why}`); process.exit(1) }
const assert = (ok, why) => { if (!ok) fail(why) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const BODY = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta']
const lines = (l) => l.join('\n') + '\n'
const BIN = Buffer.from([0xff, 0xfe, 0x00, 0x01]), BIN2 = Buffer.from([0xff, 0xfe, 0x00, 0x02, 0x03])

// A target with an origin it follows, and a second clone that moves origin's main.
// `o.env` reaches the engine; `o.late` is the a.txt task 2 writes once its hold is over
function rig (first = lines(['RUN', ...BODY.slice(1)]), made = null, o = {}) {
  const t = flockTarget({ 'a.txt': lines(BODY), 'b.txt': 'none\n', 'logo.bin': BIN }, { env: o.env })
  const env = simEnv({ home: t.tmp, env: t.over })
  const sh = (cwd, ...a) => {
    const r = spawnSync('git', ['-c', 'user.name=sim', '-c', 'user.email=sim@invalid', ...a], { cwd, encoding: 'utf8', env })
    if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr}`)
    return r.stdout.trim()
  }
  const origin = path.join(t.tmp, 'origin.git'), mover = path.join(t.tmp, 'mover')
  sh(t.tmp, 'clone', '-q', '--bare', t.T, origin)
  t.git('remote', 'add', 'origin', origin); t.git('fetch', '-q', 'origin'); t.git('remote', 'set-head', 'origin', 'main')
  sh(t.tmp, 'clone', '-q', origin, mover)
  // one commit on origin's main, made of `files` ({path: text | Buffer}); its sha
  const move = (files) => {
    for (const [p, body] of Object.entries(files)) fs.writeFileSync(path.join(mover, p), body)
    sh(mover, 'add', '-A'); sh(mover, 'commit', '-qm', 'main moved'); sh(mover, 'push', '-q', 'origin', 'HEAD:main')
    return sh(mover, 'rev-parse', 'HEAD')
  }
  const plan = writePlan(t, {
    claim: 'a.txt carries RUN and b.txt carries B.', check: 'test -f a.txt',
    tasks: [
      task({ id: 1, title: 'Write the first line', files: ['Modify: `a.txt`'], claim: 'a.txt carries RUN.', stale: 'path-absent: `a.txt`', run: 'grep -q RUN a.txt' }),
      task({ id: 2, title: 'Hold the run open', files: ['Modify: `b.txt`', ...(o.late ? ['Modify: `a.txt`'] : [])], claim: 'b.txt carries B.', stale: 'path-absent: `b.txt`', run: 'grep -q B b.txt' }),
    ],
  })
  // task 1 lands at once (`first` is the a.txt it writes), before the engine's first look at main;
  // task 2 holds seven seconds, the window main moves in
  // `made`: task 1 also creates new.txt with this text
  const script = { '@hold_ms': { 2: 7000 }, 1: { 'a.txt': first, ...(made ? { 'new.txt': made } : {}) }, 2: { 'b.txt': 'B\n', ...(o.late ? { 'a.txt': o.late } : {}) } }
  return { t, move, run: () => flockRun(t, { plan, script, args: ['--main-poll', '2'] }) }
}

// ── clean ───────────────────────────────────────────────────────────────────────
{
  const { t, move, run } = rig()
  const going = run()
  await sleep(2000)
  const tip = move({ 'a.txt': lines([...BODY.slice(0, -1), 'MAIN']), 'logo.bin': BIN2, 'n.txt': 'new\n' })
  const r = await going
  const end = r.of('terminal')[0]
  assert(r.code === 0 && end && end.pr === 'ready', `clean: the run exited ${r.code} with ${JSON.stringify(end)}; main rows ${JSON.stringify([...r.of('main:follow'), ...r.of('main:moved'), ...r.of('main:off')])}: ${r.out.slice(-700)}`)
  assert(r.of('main:follow')[0]?.branch === 'main', `clean: the run follows ${JSON.stringify(r.of('main:follow'))}`)
  const moved = r.of('main:moved')
  assert(moved.length === 1 && moved[0].from === t.base && moved[0].to === tip, `clean: main:moved is ${JSON.stringify(moved)}, the tip ${tip}`)
  assert(JSON.stringify(moved[0].woven) === JSON.stringify(['a.txt', 'n.txt']) && JSON.stringify(moved[0].other) === JSON.stringify(['logo.bin']), `clean: main:moved carried ${JSON.stringify(moved[0].woven)} and ${JSON.stringify(moved[0].other)}`)
  const parents = t.git('rev-list', '--parents', '-n', '1', 'HEAD').split(' ').slice(1)
  assert(parents.length === 1 && parents[0] === tip, `clean: the landed commit's parents are ${parents.join(',')}, not the moved main ${tip}`)
  const read = (p) => fs.readFileSync(path.join(t.T, p))
  assert(read('a.txt').toString() === lines(['RUN', ...BODY.slice(1, -1), 'MAIN']), `clean: a.txt is ${JSON.stringify(read('a.txt').toString())}`)
  assert(read('logo.bin').equals(BIN2) && read('n.txt').toString() === 'new\n' && read('b.txt').toString() === 'B\n', 'clean: logo.bin, n.txt or b.txt is not what main and the run made them')
  assert(fs.readFileSync(path.join(t.RUN, 'base'), 'utf8').trim() === tip, 'clean: the run dir\'s `base` does not name the moved main')
  assert(JSON.parse(fs.readFileSync(path.join(t.RUN, 'summary.json'), 'utf8')).base === tip, 'clean: summary.json\'s base is not the moved main')
  const stored = r.of('weave:store')[0]
  assert(stored && stored.stored === true, `clean: weave:store is ${JSON.stringify(stored)}`)
  const writers = [...new Set(Object.values(JSON.parse(t.git('show', `${stored.entry}:w/a.txt/.weave-auth`))).flat())].sort()
  assert(JSON.stringify(writers) === JSON.stringify(['@c:' + tip.slice(0, 12), '@r?:1']), `clean: a.txt's writers are ${JSON.stringify(writers)}`)
  t.done()
}

// ── conflict ────────────────────────────────────────────────────────────────────
{
  const { t, move, run } = rig(lines(['alpha', 'beta', 'RUN', ...BODY.slice(2)]))
  const going = run()
  await sleep(2000)
  const tip = move({ 'a.txt': lines(['alpha', ...BODY.slice(3)]) })
  const r = await going
  const end = r.of('terminal')[0]
  assert(r.of('main:moved')[0]?.to === tip, `conflict: main:moved is ${JSON.stringify(r.of('main:moved'))}; off ${JSON.stringify(r.of('main:off'))}: ${r.out.slice(-500)}`)
  assert(r.of('conflict:open').some((c) => c.path === 'a.txt'), `conflict: no conflict opened on a.txt: ${JSON.stringify(r.of('conflict:open'))}`)
  assert(r.of('resolve-task').some((c) => c.path === 'a.txt'), `conflict: no resolve task for a.txt: ${JSON.stringify(r.of('resolve-task'))}`)
  assert(r.code !== 0 && end && end.pr === 'draft', `conflict: the run exited ${r.code} with ${JSON.stringify(end)}`)
  const parents = t.git('rev-list', '--parents', '-n', '1', 'HEAD').split(' ').slice(1)
  assert(parents.length === 1 && parents[0] === tip, `conflict: the draft commit's parents are ${parents.join(',')}, not the moved main ${tip}`)
  t.done()
}

// ── behind ──────────────────────────────────────────────────────────────────────
{
  const { t, move, run } = rig()
  const tip = move({ 'logo.bin': BIN2, 'n.txt': 'new\n' })
  const r = await run()
  const end = r.of('terminal')[0], moved = r.of('main:moved')
  assert(moved.length === 1 && moved[0].to === tip && moved[0].why === 'start', `behind: main:moved is ${JSON.stringify(moved)}; off ${JSON.stringify(r.of('main:off'))}: ${r.out.slice(-500)}`)
  assert(moved[0].t < r.of('builder:open')[0].t, 'behind: a builder opened before the move was taken in')
  assert(r.code === 0 && end && end.pr === 'ready', `behind: the run exited ${r.code} with ${JSON.stringify(end)}`)
  const parents = t.git('rev-list', '--parents', '-n', '1', 'HEAD').split(' ').slice(1)
  assert(parents.length === 1 && parents[0] === tip, `behind: the landed commit's parents are ${parents.join(',')}, not the moved main ${tip}`)
  assert(fs.readFileSync(path.join(t.T, 'n.txt'), 'utf8') === 'new\n' && fs.readFileSync(path.join(t.T, 'logo.bin')).equals(BIN2), 'behind: n.txt or logo.bin is not main\'s')
  assert(t.git('diff', '--name-only', tip, 'HEAD') === 'a.txt\nb.txt', `behind: the landed commit changes ${JSON.stringify(t.git('diff', '--name-only', tip, 'HEAD'))} over main`)
  t.done()
}

// ── created ─────────────────────────────────────────────────────────────────────
{
  const { t, move, run } = rig(undefined, 'def run():\n    return "RUN"\n')
  const going = run()
  await sleep(2000)
  const tip = move({ 'new.txt': 'def main():\n    return "MAIN"\n' })
  const r = await going
  const end = r.of('terminal')[0]
  assert(r.of('main:moved')[0]?.to === tip, `created: main:moved is ${JSON.stringify(r.of('main:moved'))}; off ${JSON.stringify(r.of('main:off'))}: ${r.out.slice(-500)}`)
  const opened = r.of('conflict:open').filter((c) => c.path === 'new.txt')
  assert(opened.length === 1 && opened[0].created === 'both', `created: the conflicts opened on new.txt are ${JSON.stringify(r.of('conflict:open'))}; unions ${JSON.stringify(r.of('conflict:union'))}`)
  assert(!r.of('conflict:union').some((c) => c.path === 'new.txt'), `created: new.txt was joined as a union: ${JSON.stringify(r.of('conflict:union'))}`)
  assert(r.of('resolve-task').some((c) => c.path === 'new.txt'), `created: no resolve task for new.txt: ${JSON.stringify(r.of('resolve-task'))}`)
  const said = JSON.parse(fs.readFileSync(path.join(t.RUN, 'board.json'), 'utf8')).beliefs.map((b) => b.claim)
  assert(said.some((c) => c.includes('open conflict in new.txt: main and a builder each created it')), `created: the board does not say both sides created the file: ${JSON.stringify(said)}`)
  assert(r.code !== 0 && end && end.pr === 'draft', `created: the run exited ${r.code} with ${JSON.stringify(end)}`)
  t.done()
}

// ── made in the run ─────────────────────────────────────────────────────────────
{
  const t = flockTarget({ 'a.txt': lines(BODY) })
  const plan = writePlan(t, {
    claim: 'new.txt carries ONE and TWO.', check: 'test -f new.txt',
    tasks: [
      task({ id: 1, title: 'Create the file one way', files: ['Create: `new.txt`'], claim: 'new.txt carries ONE.', stale: 'path-present: `new.txt`', run: 'grep -q ONE new.txt' }),
      task({ id: 2, title: 'Create the file another way', files: ['Create: `new.txt`'], claim: 'new.txt carries TWO.', stale: 'path-present: `new.txt`', run: 'grep -q TWO new.txt' }),
    ],
  })
  const r = await flockRun(t, { plan, script: { 1: { 'new.txt': 'def one():\n    return "ONE"\n' }, 2: { 'new.txt': 'def two():\n    return "TWO"\n' } } })
  const end = r.of('terminal')[0]
  assert(r.of('conflict:open').length === 0 && r.of('conflict:union').some((c) => c.path === 'new.txt'), `made in the run: opened ${JSON.stringify(r.of('conflict:open'))}, unions ${JSON.stringify(r.of('conflict:union'))}`)
  assert(r.code === 0 && end && end.pr === 'ready', `made in the run: the run exited ${r.code} with ${JSON.stringify(end)}`)
  const text = fs.readFileSync(path.join(t.T, 'new.txt'), 'utf8')
  assert(text.includes('ONE') && text.includes('TWO'), `made in the run: new.txt is ${JSON.stringify(text)}`)
  t.done()
}

// ── folded, dropped ─────────────────────────────────────────────────────────────
{
  // the stand-in Jev: each asked key answered from `answers`, at 0.9; every request body is kept
  let answers = {}
  const bodies = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      let keys = []
      try { const j = JSON.parse(body); bodies.push(j); keys = Object.keys(j.questions || {}) } catch {}
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ answers: Object.fromEntries(keys.map((k) => [k, { choice: answers[k], confidence: 0.9 }])) }))
    })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const env = { TYPESAFE_BASE_URL: `http://127.0.0.1:${server.address().port}` }
  for (const [CASE, second, pr] of [['folded', 'carried', 'ready'], ['dropped', 'drops', 'draft']]) {
    answers = { kept: 'loses', carried: second }; bodies.length = 0
    const { t, move, run } = rig(undefined, null, { env, late: lines(['RUN', ...BODY.slice(1, -1), 'FOLDED']) })
    const going = run()
    await sleep(2000)
    const tip = move({ 'a.txt': lines([...BODY.slice(0, -1), 'MAIN']) })
    const r = await going
    const end = r.of('terminal').at(-1), label = '@c:' + tip.slice(0, 12)
    const first = r.of('jev:peer-rewrite').filter((x) => x.path === 'a.txt' && (x.peer || []).includes('MAIN'))
    assert(first.length === 1 && first[0].answer === 'loses' && first[0].peers.join() === label, `${CASE}: the first read of main's line is ${JSON.stringify(r.of('jev:peer-rewrite'))}; moved ${JSON.stringify(r.of('main:moved'))}: ${r.out.slice(-500)}`)
    const again = r.of('jev:peer-settled')
    assert(again.length === 1 && again[0].answer === second && again[0].excused === (pr === 'ready') && again[0].author === label, `${CASE}: the second look is ${JSON.stringify(again)}`)
    const shown = bodies.find((b) => b.questions && b.questions.carried)?.state
    assert(shown && shown.path === 'a.txt' && JSON.stringify(shown.lost) === '["MAIN"]' && shown.theirs.includes('MAIN') && shown.settled.includes('FOLDED') && !shown.settled.includes('MAIN'), `${CASE}: Jev was shown ${JSON.stringify(shown)}`)
    assert(shown.sides.theirs.claim === 'main moved' && shown.sides.ours.title === 'Hold the run open', `${CASE}: the sides shown are ${JSON.stringify(shown.sides)}`)
    assert(end && end.pr === pr && (r.code === 0) === (pr === 'ready'), `${CASE}: the run exited ${r.code} with ${JSON.stringify(end)}`)
    t.done()
  }
  server.close()
}

console.log('ALL TESTS PASSED')
