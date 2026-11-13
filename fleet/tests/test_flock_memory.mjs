#!/usr/bin/env node
// The memory sim (the main-is-a-peer design, stage 2): a Flock run starts its weaves from main's
// memory and lands into it, and the catch-up joins on it. One throwaway target, three steps:
//   run 1     a first run on a target with no store: `weave:memory` begins one (via genesis),
//             `weave:store` stores the landed commit's entry, and the target's weave ref holds it;
//   catch-up  main moves beside the run (a commit made by hand) and catchup.mjs joins the run onto
//             it from the store: both sides' lines, catchup.json says joined and stored, and the
//             moved main's own entry was replayed from the commit, never from the run;
//   run 2     a second run from the caught-up commit starts from that entry (via run, one path
//             installed), and the entry it stores names every writer of a.txt's lines: both runs'
//             tasks and the hand commit.
// Prints `ALL TESTS PASSED` and exits 0, or names what differed and exits 1.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { simEnv } from './_helpers.mjs'
import { REPO, flockTarget, task, writePlan, flockRun } from './_flock_helpers.mjs'

const fail = (why) => { console.log(`MEMORY FAILED: ${why}`); process.exit(1) }
const assert = (ok, why) => { if (!ok) fail(why) }
const REF = 'refs/ultrapowers/weave/v1'
const BODY = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta']
const lines = (l) => l.join('\n') + '\n'

const t = flockTarget({ 'a.txt': lines(BODY) })
const entryOf = (rev) => {
  const tree = t.git('rev-parse', `${rev}^{tree}`)
  const hit = t.git('log', '--format=%H %s', REF).split('\n').find((l) => l.endsWith(`weave ${tree}`))
  return hit ? hit.split(' ')[0] : null
}
const meta = (entry) => JSON.parse(t.git('show', `${entry}:meta.json`))
const planFor = (word) => writePlan(t, {
  claim: `a.txt carries ${word}.`, check: 'test -f a.txt',
  tasks: [task({ id: 1, title: `Write ${word}`, files: ['Modify: `a.txt`'], claim: `a.txt carries ${word}.`, stale: 'path-absent: `a.txt`', run: `grep -q ${word} a.txt` })],
})

// ── run 1: no store yet ─────────────────────────────────────────────────────────
t.over.ULTRAPOWERS_FLEET_RUN = 'run-1'
const r1 = await flockRun(t, { plan: planFor('RUN1'), script: { 1: { 'a.txt': lines(['RUN1', ...BODY.slice(1)]) } } })
assert(r1.code === 0, `run 1 exited ${r1.code}: ${r1.out.slice(-600)}`)
const began = r1.of('weave:memory')[0]
assert(began && began.memory === true && began.via === 'genesis', `run 1's weave:memory row is ${JSON.stringify(began)}`)
const stored = r1.of('weave:store')[0]
assert(stored && stored.stored === true && stored.paths === 1, `run 1's weave:store row is ${JSON.stringify(stored)}`)
const run1 = t.git('rev-parse', 'HEAD')
assert(stored.commit === run1 && entryOf(run1) === stored.entry, `the ref holds no entry for run 1's commit (row ${JSON.stringify(stored)})`)
assert(meta(stored.entry).via === 'run', `run 1's entry is via ${meta(stored.entry).via}`)

// ── the catch-up: main moved by hand, joined from the store ─────────────────────
t.git('checkout', '-qb', 'moved', t.base)
fs.writeFileSync(path.join(t.T, 'a.txt'), lines([...BODY.slice(0, -1), 'MAIN']))
t.git('commit', '-qam', 'main moved')
const onto = t.git('rev-parse', 'HEAD')
t.git('checkout', '-q', '--detach', run1)
const c = spawnSync('node', [path.join(REPO, 'factory', 'flock', 'catchup.mjs'), '--plan', planFor('RUN1'), '--target', t.T,
  '--base', t.base, '--onto', onto, '--run-dir', t.RUN], { encoding: 'utf8', timeout: 120000, env: simEnv({ home: t.tmp, env: t.over }) })
const last = (c.stdout || '').trim().split('\n').pop() || ''
assert(c.status === 0 && JSON.parse(last).refolded === true, `the catch-up exited ${c.status}: ${last} ${(c.stderr || '').slice(-600)}`)
const caught = t.git('rev-parse', 'HEAD')
assert(fs.readFileSync(path.join(t.T, 'a.txt'), 'utf8') === lines(['RUN1', ...BODY.slice(1, -1), 'MAIN']), `a.txt after the catch-up is ${JSON.stringify(fs.readFileSync(path.join(t.T, 'a.txt'), 'utf8'))}`)
const note = JSON.parse(fs.readFileSync(path.join(t.RUN, 'catchup.json'), 'utf8'))
assert(note.memory && note.memory.joined === true && note.memory.stored === true, `catchup.json's memory is ${JSON.stringify(note.memory)}`)
assert(entryOf(onto) && meta(entryOf(onto)).via === 'replay', 'the moved main has no replayed entry')
assert(entryOf(caught) && meta(entryOf(caught)).via === 'run', 'the caught-up commit has no entry')

// ── run 2: from the caught-up commit ────────────────────────────────────────────
t.over.ULTRAPOWERS_FLEET_RUN = 'run-2'
const t2 = { ...t, base: caught, RUN: path.join(t.tmp, 'run2') }
const r2 = await flockRun(t2, { plan: planFor('RUN2'), script: { 1: { 'a.txt': lines(['RUN1', 'beta', 'gamma', 'RUN2', ...BODY.slice(4, -1), 'MAIN']) } } })
assert(r2.code === 0, `run 2 exited ${r2.code}: ${r2.out.slice(-600)}`)
const began2 = r2.of('weave:memory')[0]
assert(began2 && began2.memory === true && began2.via === 'run' && began2.installed === 1, `run 2's weave:memory row is ${JSON.stringify(began2)}`)
const stored2 = r2.of('weave:store')[0]
assert(stored2 && stored2.stored === true, `run 2's weave:store row is ${JSON.stringify(stored2)}`)
const writers = new Set(Object.values(JSON.parse(t.git('show', `${stored2.entry}:w/a.txt/.weave-auth`))).flat())
const want = ['@c:' + onto.slice(0, 12), '@r1:1', '@r2:1']
assert(JSON.stringify([...writers].sort()) === JSON.stringify(want), `a.txt's writers are ${JSON.stringify([...writers].sort())}, not ${JSON.stringify(want)}`)

t.done()
console.log('ALL TESTS PASSED')
