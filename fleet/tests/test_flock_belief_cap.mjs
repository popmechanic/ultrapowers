#!/usr/bin/env node
// A belief's stale text is held to a length where it is recorded (#1529): a one-task scripted run
// posts two beliefs through the `@beliefs` seam, one with a 5,000-character `stale` and one with a
// 20-character `stale`. Checks the `belief` rows in events.jsonl:
//   - the long one's `stale` is at most 300 characters and is the start of what was posted;
//   - the short one's `stale` is byte-equal to what was posted.
// Prints `ALL TESTS PASSED` and exits 0, or `FAIL belief cap: ...` and exits 1.
import { flockTarget, task, writePlan, flockRun } from './_flock_helpers.mjs'

const LONG = Array.from({ length: 5000 }, (_, i) => 'abcdefghij'[i % 10]).join('')
const SHORT = 'x y z still wrong!!!'

const t = flockTarget({ 'a.txt': 'x y z\n', 'b.txt': 'b\n' })
try {
  const one = task({ id: 1, title: 'Write ONE into a.txt', files: ['Modify: `a.txt`'], claim: 'a.txt carries ONE.', run: 'grep -q ONE a.txt', stale: 'path-absent: `a.txt`' })
  const plan = writePlan(t, { claim: 'a.txt says what the task writes.', check: 'test -f a.txt', tasks: [one] })
  const r = await flockRun(t, {
    plan,
    args: ['--loose-ends', 'record'],
    script: {
      1: { 'a.txt': 'x ONE z\n' },
      '@beliefs': [
        { task: '1', about: 'app', path: 'b.txt', claim: 'b.txt holds a long stale line', stale: LONG },
        { task: '1', about: 'app', path: 'b.txt', claim: 'b.txt holds a short stale line', stale: SHORT },
      ],
    },
  })
  if (!r.rows) throw new Error(`no events.jsonl (engine exit ${r.code}): ${r.out.slice(-1500)}`)
  const rows = r.of('belief')
  const long = rows.find((b) => b.claim === 'b.txt holds a long stale line')
  const short = rows.find((b) => b.claim === 'b.txt holds a short stale line')
  if (!long || typeof long.stale !== 'string' || long.stale.length > 300 || long.stale.length === 0 || !LONG.startsWith(long.stale)) {
    throw new Error(`the long belief row's stale is ${long ? `${typeof long.stale} of length ${long.stale?.length}` : 'missing'}; belief rows: ${rows.length}`)
  }
  if (!short || short.stale !== SHORT) throw new Error(`the short belief row reads ${JSON.stringify(short)}`)
  console.log('ALL TESTS PASSED')
} catch (e) {
  console.log(`FAIL belief cap: ${e.message}`)
  process.exitCode = 1
} finally {
  t.done()
}
