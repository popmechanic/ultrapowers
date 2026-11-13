#!/usr/bin/env node
// The loose-path sim (#1531): a loose end whose path the run cannot read is reported as not checked,
// never counted as resolved. The base holds a.txt (`x y z`) and b.txt (`b`); task 1 writes `x WIPE z`
// into a.txt and task 2 writes an empty b.txt, which the weave reads as the file gone. Three loose ends
// are posted, and the run's last `loose-ends` row (`--loose-ends record`) reads:
//   - `./a.txt` (no file has that exact path at the base or in the settled snapshot): unchecked;
//   - `b.txt`, stale `b` (at the base, gone from the settled snapshot): resolved;
//   - `a.txt`, stale `x WIPE z` (still in the settled a.txt): open.
// Prints `ALL TESTS PASSED` and exits 0, or names what differed and exits 1.
import { flockTarget, flockRun, task, writePlan } from './_flock_helpers.mjs'

const t = flockTarget({ 'a.txt': 'x y z\n', 'b.txt': 'b\n' })
const plan = writePlan(t, {
  claim: 'a.txt carries WIPE and b.txt is gone.',
  check: 'test -f a.txt',
  tasks: [
    task({ id: 1, title: 'Wipe a', files: ['Modify: `a.txt`'], claim: 'a.txt carries WIPE.', run: 'grep -q WIPE a.txt', stale: 'path-exists: `a.txt`' }),
    task({ id: 2, title: 'Empty b', files: ['Modify: `b.txt`'], claim: 'b.txt is empty.', run: 'test ! -s b.txt', stale: 'path-exists: `b.txt`' }),
  ],
})
const r = await flockRun(t, {
  plan, args: ['--loose-ends', 'record'],
  script: { 1: { 'a.txt': 'x WIPE z\n' }, 2: { 'b.txt': '' },
    '@beliefs': [
      { task: '1', about: 'app', path: './a.txt', claim: 'a.txt by another name', stale: 'x WIPE z' },
      { task: '2', about: 'app', path: 'b.txt', claim: 'b.txt still says b', stale: 'b' },
      { task: '1', about: 'app', path: 'a.txt', claim: 'a.txt still says WIPE', stale: 'x WIPE z' },
    ] },
})
const items = r.of('loose-ends').at(-1)?.items || []
const state = (p) => items.find((x) => x.path === p)?.state
const fails = []
if (state('./a.txt') !== 'unchecked') fails.push(`(a) ./a.txt reads ${state('./a.txt')}, expected unchecked`)
if (state('b.txt') !== 'resolved') fails.push(`(b) b.txt reads ${state('b.txt')}, expected resolved`)
if (state('a.txt') !== 'open') fails.push(`(c) a.txt reads ${state('a.txt')}, expected open`)
if (fails.length) {
  console.log(`LOOSE PATH FAILED: ${fails.join('; ')}\nitems: ${JSON.stringify(items)}\n${r.out.slice(-2000)}`)
  process.exit(1)
}
t.done()
console.log('ALL TESTS PASSED')
