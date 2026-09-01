// status.mjs: the one-shot run-position readout unwraps MergeableStore stamps
// and prints a run's events in id order (2026-09-01 papercut fix).
import assert from 'node:assert'
import test from 'node:test'
import { runEvents, renderLine } from '../status.mjs'

// A trimmed MergeableStore shape: [tables, values], every node [value, hlc, hash].
const stamped = (v) => [v, 'P0Q-hlc', 12345]
const STORE = [[{
  events: stamped({
    'run-9:01AAA': stamped({ kind: stamped('worker:start'), label: stamped('impl:1'), ts: stamped(1788245813225), runId: stamped('run-9') }),
    'run-9:01AAB': stamped({ kind: stamped('worker:end'), label: stamped('impl:1'), class: stamped('success'), ts: stamped(1788245899999), runId: stamped('run-9') }),
    'run-8:01AAC': stamped({ kind: stamped('engine:phase'), phase: stamped('Wave 1'), ts: stamped(1788245800000), runId: stamped('run-8') }),
  }),
  runs: stamped({}),
}, {}], 'hlc', 0]

test('runEvents filters to the run and unwraps every stamp', () => {
  const rows = runEvents(STORE, 'run-9')
  assert.equal(rows.length, 2)
  assert.deepEqual(rows.map((r) => r.kind), ['worker:start', 'worker:end'])
  assert.equal(rows[1].class, 'success')
})

test('another run\u2019s events never leak in', () => {
  assert.equal(runEvents(STORE, 'run-8').length, 1)
  assert.equal(runEvents(STORE, 'run-7').length, 0)
})

test('renderLine is one greppable line: time kind label class', () => {
  const [row] = runEvents(STORE, 'run-8')
  assert.match(renderLine(row), /^\d\d:\d\d engine:phase Wave 1$/)
})

console.log('ALL TESTS PASSED')
