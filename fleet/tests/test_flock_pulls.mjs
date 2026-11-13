#!/usr/bin/env node
// The pull sims: the two faults of flock-baseline run-10 (2026-11-13), each as a scripted Flock run
// on a throwaway target (_flock_helpers.mjs), under the repository's own policy (pulls `narrow`).
//   whole copy  task 3's probe reads g.txt through a script, as run-10's read `atlas/geo.py` through
//               an import, so no edge is derived for it: task 1 writes g.txt and task 3 depends on it
//               in no way the plan states.
//               The builder that takes task 3 never had g.txt in a scope of its own: it did task 2
//               (held three seconds, so task 1 is done first), while task 1's builder is kept busy on
//               task 4, the head of the longer chain, which the board offers first. The change still reaches its
//               copy, as a pull row marked quiet, so its probe passes and the run settles ready.
//               When the scope also held changes back, task 3 was given back until it parked.
//   same spot   two tasks each put one line at one spot of rules.txt and the merge orders the two by
//               their text, which leaves both probes red. Each task reopened red is told of the spot:
//               its note on the board names the two insertions in rules.txt.
// Prints `ALL TESTS PASSED` and exits 0, or names what differed and exits 1.
import fs from 'node:fs'
import path from 'node:path'
import { flockTarget, task, writePlan, flockRun } from './_flock_helpers.mjs'

const fail = (why) => { console.log(`PULLS FAILED: ${why}`); process.exit(1) }
const assert = (ok, why) => { if (!ok) fail(why) }

// ── whole copy ──────────────────────────────────────────────────────────────────
{
  const t = flockTarget({ 'g.txt': 'todo\n', 'r.txt': 'none\n', 'h.txt': 'none\n', 'i.txt': 'none\n', 'j.txt': 'none\n',
    'check.sh': 'grep -q ROUTE2 r.txt && grep -q DIST g.txt\n' })
  const plan = writePlan(t, {
    claim: 'The route reads the distance.', check: 'test -f r.txt',
    tasks: [
      task({ id: 1, title: 'Write the distance', files: ['Modify: `g.txt`'], claim: 'g.txt carries DIST.', stale: 'path-absent: `g.txt`',
        run: 'grep -q DIST g.txt', iface: '- Consumes: nothing\n- Produces: `dist() -> int`' }),
      task({ id: 2, title: 'Write the first route', files: ['Modify: `r.txt`'], claim: 'r.txt carries ROUTE1.', stale: 'path-absent: `r.txt`',
        run: 'grep -q ROUTE1 r.txt', iface: '- Consumes: nothing\n- Produces: `route() -> list`' }),
      task({ id: 3, title: 'Write the second route', files: ['Modify: `r.txt`'], claim: 'r.txt carries ROUTE2 and g.txt the distance it reads.', stale: 'path-absent: `r.txt`',
        run: 'sh check.sh', iface: '- Consumes: `route() -> list`\n- Produces: none' }),
      task({ id: 4, title: 'Keep the first builder busy', files: ['Modify: `h.txt`'], claim: 'h.txt carries H.', stale: 'path-absent: `h.txt`',
        run: 'grep -q H h.txt', iface: '- Consumes: `dist() -> int`\n- Produces: `h() -> int`' }),
      task({ id: 5, title: 'Lengthen the chain', files: ['Modify: `i.txt`'], claim: 'i.txt carries I.', stale: 'path-absent: `i.txt`',
        run: 'grep -q I i.txt', iface: '- Consumes: `h() -> int`\n- Produces: `i() -> int`' }),
      task({ id: 6, title: 'Lengthen the chain again', files: ['Modify: `j.txt`'], claim: 'j.txt carries J.', stale: 'path-absent: `j.txt`',
        run: 'grep -q J j.txt', iface: '- Consumes: `i() -> int`\n- Produces: none' }),
    ],
  })
  // tasks 1 and 2 are ready at once: the first builder is offered the longer chain's head, task 1,
  // then task 4, which holds it six seconds; the second takes task 2, held three seconds, then task 3
  const r = await flockRun(t, { plan, script: {
    '@hold_ms': { 2: 3000, 4: 6000 },
    1: { 'g.txt': 'DIST\n' }, 2: { 'r.txt': 'ROUTE1\n' }, 3: { 'r.txt': 'ROUTE1\nROUTE2\n' },
    4: { 'h.txt': 'H\n' }, 5: { 'i.txt': 'I\n' }, 6: { 'j.txt': 'J\n' },
  } })
  const end = r.of('terminal')[0]
  assert(r.code === 0 && end && end.pr === 'ready', `whole copy: the run exited ${r.code} with ${JSON.stringify(end)}; parked ${JSON.stringify(r.of('task:parked'))}: ${r.out.slice(-500)}`)
  const builderOf = (id) => r.of('session:start').filter((x) => x.task === id).pop().agent
  assert(builderOf('3') !== builderOf('1') && builderOf('3') === builderOf('2'), `whole copy: the rig failed, tasks 1, 2 and 3 went to ${builderOf('1')}, ${builderOf('2')} and ${builderOf('3')}`)
  const pulls = r.of('pull').filter((x) => x.agent === builderOf('3')).flatMap((x) => x.changed)
  const g = pulls.find((c) => c.path === 'g.txt')
  assert(g && g.quiet === true, `whole copy: task 3's builder has no quiet pull of g.txt, its pulls are ${JSON.stringify(pulls)}`)
  t.done()
}

// ── same spot ───────────────────────────────────────────────────────────────────
{
  const t = flockTarget({ 'rules.txt': 'name\npeople\n' })
  const plan = writePlan(t, {
    claim: 'The rules run in order.', check: 'test -f rules.txt',
    tasks: [
      task({ id: 1, title: 'Add the range rule', files: ['Modify: `rules.txt`'], claim: 'range is the second rule.', stale: 'path-absent: `rules.txt`',
        run: 'test "$(sed -n 2p rules.txt)" = range' }),
      task({ id: 2, title: 'Add the country rule', files: ['Modify: `rules.txt`'], claim: 'country is the rule before people.', stale: 'path-absent: `rules.txt`',
        run: 'test "$(grep -B1 "^people$" rules.txt | head -1)" = country' }),
    ],
  })
  const r = await flockRun(t, { plan, script: { 1: { 'rules.txt': 'name\nrange\npeople\n' }, 2: { 'rules.txt': 'name\ncountry\npeople\n' } } })
  const spot = r.of('same-anchor')[0]
  assert(spot && spot.path === 'rules.txt' && spot.flag === 'siblings', `same spot: no same-anchor row for rules.txt: ${JSON.stringify(r.of('same-anchor'))}`)
  assert(r.of('reopen').length >= 2, `same spot: the red tasks were not reopened: ${JSON.stringify(r.of('reopen'))}`)
  const board = JSON.parse(fs.readFileSync(path.join(t.RUN, 'board.json'), 'utf8'))
  for (const id of ['1', '2']) {
    const notes = board.tasks.find((x) => x.id === id).notes
    assert(notes.some((n) => n.includes('Look here first: two insertions at one spot in rules.txt')), `same spot: task ${id}'s notes do not name the spot: ${JSON.stringify(notes)}`)
  }
  t.done()
}

console.log('ALL TESTS PASSED')
