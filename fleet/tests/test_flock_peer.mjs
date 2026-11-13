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
// Prints `ALL TESTS PASSED` and exits 0, or names what differed and exits 1.
import { spawnSync } from 'node:child_process'
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
function rig (first = lines(['RUN', ...BODY.slice(1)])) {
  const t = flockTarget({ 'a.txt': lines(BODY), 'b.txt': 'none\n', 'logo.bin': BIN })
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
      task({ id: 2, title: 'Hold the run open', files: ['Modify: `b.txt`'], claim: 'b.txt carries B.', stale: 'path-absent: `b.txt`', run: 'grep -q B b.txt' }),
    ],
  })
  // task 1 lands at once (`first` is the a.txt it writes), before the engine's first look at main;
  // task 2 holds seven seconds, the window main moves in
  const script = { '@hold_ms': { 2: 7000 }, 1: { 'a.txt': first }, 2: { 'b.txt': 'B\n' } }
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

console.log('ALL TESTS PASSED')
