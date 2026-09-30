#!/usr/bin/env node
// The provenance probe (#1404): buildProvenance over its fixtures, printed on one line as
// {"f1": <answer>, "f2": <answer>, "f3": <answer>, "f4": <answer>, "f4x": <answer>}. F1: a.py `x y z w`, lines 2-3 by A.1 and line 4 by B.2 over
// A.1's line (a peer rewrite Jev read as `loses`), a lost line, a same-anchor pair, and M1's
// probe running line 2. F2: F1 with line 4 labelled `C` (no task), no events, no lost, no coverage.
// F3: a.py `} x }`, B.2's `}` rewrite on line 3 and C.3's, whose writer has no line there.
// F4 (#1407): p.py `import sys`, a blank, a comment, `x = 1` and a trailing newline, all A.1's, M1
// running line 1; F4x is F4 with `executable` naming line 1 only.
import { buildProvenance } from '../../factory/flock/provenance.mjs'

const landed = { 'a.py': 'x\ny\nz\nw' }
const f1 = buildProvenance({
  landed,
  blame: { 'a.py': ['base', 'A.1', 'A.1', 'B.2'] },
  events: [
    { kind: 'peer:rewrite', agent: 'B', path: 'a.py', task: '2', peers: ['A.1'], after: ['w'] },
    { kind: 'jev:peer-rewrite', path: 'a.py', task: '2', peers: ['A.1'], after: ['w'], answer: 'loses' },
    { kind: 'same-anchor', path: 'a.py', anchor: 'x', lines: ['y', 'z'] }
  ],
  lost: [{ path: 'a.py', author: 'A.1', by: 'B.2', lines: ['q'] }],
  coverage: { M1: { 'a.py': [2] } }
})
const f2 = buildProvenance({ landed, blame: { 'a.py': ['base', 'A.1', 'A.1', 'C'] }, events: [], lost: [], coverage: null })
const f3 = buildProvenance({
  landed: { 'a.py': '}\nx\n}' },
  blame: { 'a.py': ['base', 'A.1', 'B.2'] },
  events: [
    { kind: 'peer:rewrite', agent: 'B', task: '2', path: 'a.py', peers: ['A.1'], after: ['}'] },
    { kind: 'peer:rewrite', agent: 'C', task: '3', path: 'a.py', peers: ['A.1'], after: ['}'] }
  ],
  lost: [],
  coverage: null
})
const f4in = {
  landed: { 'p.py': 'import sys\n\n# note\nx = 1\n' },
  blame: { 'p.py': ['A.1', 'A.1', 'A.1', 'A.1', 'A.1'] },
  events: [],
  lost: [],
  coverage: { M1: { 'p.py': [1] } }
}
const f4 = buildProvenance(f4in)
const f4x = buildProvenance({ ...f4in, executable: { 'p.py': [1] } })
console.log(JSON.stringify({ f1, f2, f3, f4, f4x }))
