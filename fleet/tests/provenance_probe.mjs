#!/usr/bin/env node
// The provenance probe (#1404): buildProvenance over two fixtures, printed on one line as
// {"f1": <answer>, "f2": <answer>}. F1: a.py `x y z w`, lines 2-3 by A.1 and line 4 by B.2 over
// A.1's line (a peer rewrite Jev read as `loses`), a lost line, a same-anchor pair, and M1's
// probe running line 2. F2: F1 with line 4 labelled `C` (no task), no events, no lost, no coverage.
import { buildProvenance } from '../../factory/flock/provenance.mjs'

const landed = { 'a.py': 'x\ny\nz\nw' }
const f1 = buildProvenance({
  landed,
  blame: { 'a.py': ['base', 'A.1', 'A.1', 'B.2'] },
  events: [
    { kind: 'peer:rewrite', path: 'a.py', task: '2', peers: ['A.1'], after: ['w'] },
    { kind: 'jev:peer-rewrite', path: 'a.py', task: '2', peers: ['A.1'], after: ['w'], answer: 'loses' },
    { kind: 'same-anchor', path: 'a.py', anchor: 'x', lines: ['y', 'z'] }
  ],
  lost: [{ path: 'a.py', author: 'A.1', by: 'B.2', lines: ['q'] }],
  coverage: { M1: { 'a.py': [2] } }
})
const f2 = buildProvenance({ landed, blame: { 'a.py': ['base', 'A.1', 'A.1', 'C'] }, events: [], lost: [], coverage: null })
console.log(JSON.stringify({ f1, f2 }))
