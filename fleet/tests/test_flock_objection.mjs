#!/usr/bin/env node
// The objection sim: a builder that finds its task cannot be done as the plan is written says so,
// and the task waits for the operator where a give-back would hand it round (the wrong-plans
// reading, flock-baseline run-32, 2026-11-13). Two scripted Flock runs on a throwaway target
// (_flock_helpers.mjs), one plan: task 1 writes a.txt, and task 2's session files an objection.
//   on   (the repository's policy) task 2 is claimed once and parks at once: one `objection` row,
//        one `task:parked` row marked `objected` with no give-backs, and the run ends a draft whose
//        reason is the objection in the builder's words, which the pull-request body carries.
//   off  (`--objection off`, the rollback) the same script is a give-back: task 2 is handed out
//        three times, parks on its third, and the run ends `deadlock` with no objection row.
// Prints `ALL TESTS PASSED` and exits 0, or names what differed and exits 1.
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { simEnv } from './_helpers.mjs'
import { REPO, flockTarget, task, writePlan, flockRun } from './_flock_helpers.mjs'

const fail = (why) => { console.log(`OBJECTION FAILED: ${why}`); process.exit(1) }
const assert = (ok, why) => { if (!ok) fail(why) }
const WHY = 'task 2 pins the last line as B and says it equals what task 1 wrote, which is A: no code passes both'

for (const MODE of ['on', 'off']) {
  const t = flockTarget({ 'a.txt': 'x\n', 'b.txt': 'y\n' })
  const plan = writePlan(t, {
    claim: 'a.txt carries A and b.txt carries B.', check: 'test -f a.txt',
    tasks: [
      task({ id: 1, title: 'Write A', files: ['Modify: `a.txt`'], claim: 'a.txt carries A.', stale: 'path-absent: `a.txt`', run: 'grep -q A a.txt' }),
      task({ id: 2, title: 'Write B', files: ['Modify: `b.txt`'], claim: 'b.txt carries B.', stale: 'path-absent: `b.txt`', run: 'grep -q B b.txt' }),
    ],
  })
  const r = await flockRun(t, { plan, script: { 1: { 'a.txt': 'A\n' }, '@object': { 2: WHY } }, args: MODE === 'off' ? ['--objection', 'off'] : [] })
  assert(r.rows, `${MODE}: no events.jsonl (engine exit ${r.code}): ${r.out.slice(-800)}`)
  const end = r.of('terminal').at(-1), claims = r.of('session:start').filter((x) => x.task === '2').length
  const parked = r.of('task:parked').filter((x) => x.task === '2'), objected = r.of('objection')
  assert(r.code !== 0 && end && end.pr === 'draft', `${MODE}: the run exited ${r.code} with ${JSON.stringify(end)}`)
  if (MODE === 'on') {
    assert(objected.length === 1 && objected[0].task === '2' && objected[0].reason === WHY, `on: the objection rows are ${JSON.stringify(objected)}`)
    assert(claims === 1, `on: task 2 was handed out ${claims} times, not once`)
    assert(parked.length === 1 && parked[0].objected === true && parked[0].releases === 0, `on: task 2's park rows are ${JSON.stringify(parked)}`)
    assert(end.why === `objection on task 2: ${WHY}`, `on: the run ended ${JSON.stringify(end.why)}`)
    assert(r.of('stall:objection').length === 1 && r.of('stall:deadlock').length === 0, `on: the stall rows are ${JSON.stringify(r.rows.filter((x) => String(x.kind).startsWith('stall:')).map((x) => x.kind))}`)
    const body = spawnSync('node', [path.join(REPO, 'factory', 'record.mjs'), 'pr-body', plan, '--events', path.join(t.RUN, 'events.jsonl')], { encoding: 'utf8', env: simEnv({ home: t.tmp }) }).stdout
    assert(body.includes(`**Draft:** objection on task 2: ${WHY}.`), `on: the pull-request body does not carry the objection: ${JSON.stringify(body.slice(-600))}`)
  } else {
    assert(objected.length === 0, `off: an objection row was written: ${JSON.stringify(objected)}`)
    assert(claims === 3, `off: task 2 was handed out ${claims} times, not three`)
    assert(parked.length === 1 && parked[0].releases === 3 && !parked[0].objected, `off: task 2's park rows are ${JSON.stringify(parked)}`)
    assert(end.why === 'deadlock: work left and nothing claimable', `off: the run ended ${JSON.stringify(end.why)}`)
  }
  t.done()
}

console.log('ALL TESTS PASSED')
