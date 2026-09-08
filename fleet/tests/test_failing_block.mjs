// fleet/tests/test_failing_block.mjs — the exam for task 1, "The failing
// test's own block, as one function": `failingBlock(text)` from
// `fleet/failing-block.mjs`.
//
// The claim: whatever shape a red suite prints — a pytest run that bridged a
// sim, a TAP run, a bare node sim — the text quoted from it begins at the
// failing test's own first failure line and stops where that test's block
// stops, and an output with no such line is quoted whole.
//
// The marker rule the clauses are read through (the ONE literal this plan
// shares with task 3's awk function — the two must agree line for line):
//   start — the first line matching
//           /^(_{3,} .+ _{3,}$|FAILED |FAIL[: ]|not ok |AssertionError)/
//   end   — the line before the first LATER line matching
//           /^(_{3,} .+ _{3,}$|={3,} |(not )?ok \d)/, or the last line of the
//           text when no later line matches
//   fallback — when no line matches the start rule, the whole text unchanged.
// The block is lines start..end joined with `\n`, with no trailing newline
// added or removed beyond what joining gives.
//
// What each clause asserts, and the leg that carries it:
//   M1 / (a) pytest-shaped: preamble, a `___ name ___` header, `E` lines one
//            of which names the leg, a `=== …` rule line, a FAILED line, a
//            summed summary and trailing padding → exactly the header line
//            through the line before the rule line.
//   M2 / (b) TAP-shaped: `not ok 2` through the line before `ok 3`; and when
//            the `not ok` line is followed only by diagnostics and a
//            `# fail 1` last line, through that last line inclusive.
//   M3 / (c) bare node sim: the `AssertionError [ERR_ASSERTION]:` line through
//            the last line (`Node.js v24.16.0`), the sim's own earlier lines
//            excluded.
//   M4 / (d) no line matches the start rule → the text back, byte for byte.
//   M5 / (e) a block over 8000 characters comes back whole — its length is the
//            block's, so no length-bounded excerpt satisfies it.
//
// Every fixture is a string literal built here: no subprocess, no pytest, so
// the exam is concurrency-safe and runs in well under a second. Each expected
// value is a slice of the same line array the fixture is built from, with the
// start and end lines named by index, so a reader can check the marker rule
// against the fixture by eye.

import assert from 'node:assert/strict'

import { failingBlock } from '../failing-block.mjs'

assert.equal(typeof failingBlock, 'function',
  '`fleet/failing-block.mjs` must export a named function `failingBlock`')

// ── (a) the pytest shape [M1] ───────────────────────────────────────────────
// The sim's own `AssertionError [ERR_ASSERTION]: leg (b) [M2]: …` line is what
// pytest quotes back one `E` line at a time; that inner leg name is the string
// the block must carry, and the preamble, the FAILED line, the summed summary
// and the trailing padding are what it must not.

const PYTEST = [
  /*  0 */ 'bringing up nodes...',
  /*  1 */ '..F                                                                      [100%]',
  /*  2 */ '=================================== FAILURES ===================================',
  /*  3 */ '_________________________ test_fleet_mjs[test_red.mjs] _________________________', // start
  /*  4 */ '[gw1] darwin -- Python 3.12.4 /usr/bin/python3',
  /*  5 */ '',
  /*  6 */ '    def test_fleet_mjs(script):',
  /*  7 */ '>       assert proc.returncode == 0, proc.stdout + proc.stderr',
  /*  8 */ 'E       AssertionError: leg (b) [M2]: expected the not ok block, got the whole file',
  /*  9 */ 'E       assert 1 == 0',
  /* 10 */ '',
  /* 11 */ 'tests/test_fleet.py:41: AssertionError', // end — the line before the rule
  /* 12 */ '=========================== short test summary info ============================', // rule
  /* 13 */ 'FAILED tests/test_fleet.py::test_fleet_mjs[test_red.mjs] - AssertionErr...',
  /* 14 */ '1 failed, 2 passed in 0.24s',
  /* 15 */ '',
  /* 16 */ 'PADDING after the summary, which no block may reach',
]
const PYTEST_HEADER = PYTEST[3]
const PYTEST_BLOCK = PYTEST.slice(3, 12).join('\n')

const pytestGot = failingBlock(PYTEST.join('\n'))
assert.equal(pytestGot, PYTEST_BLOCK,
  'leg (a) [M1]: the pytest-shaped output returns exactly the header line through the line ' +
  'before the rule line, joined with \\n')
assert.ok(pytestGot.startsWith(PYTEST_HEADER + '\n'),
  'leg (a) [M1]: … beginning at the `___ test_fleet_mjs[test_red.mjs] ___` header line')
assert.ok(pytestGot.includes('leg (b) [M2]'),
  'leg (a) [M1]: … carrying the E line that names the leg')
for (const absent of [PYTEST[0], PYTEST[12], PYTEST[13], PYTEST[14], PYTEST[16]]) {
  assert.ok(!pytestGot.includes(absent),
    'leg (a) [M1]: … and neither the preamble, the rule line, the FAILED line, the summed ' +
    `summary nor the trailing padding: found ${JSON.stringify(absent)}`)
}
console.log('ok - (a) [M1] pytest-shaped: header through the line before the rule, leg name in, padding out')

// ── (b) the TAP shape [M2] ──────────────────────────────────────────────────
// `ok 1` is not a start (only `not ok ` is); `ok 3` is a later end-rule match,
// so the block stops at the line before it.

const TAP_FOLLOWED = [
  /*  0 */ 'TAP version 13',
  /*  1 */ '# Subtest: the first sim',
  /*  2 */ 'ok 1 - the first sim',
  /*  3 */ '  ---',
  /*  4 */ '  duration_ms: 1.203',
  /*  5 */ '  ...',
  /*  6 */ 'not ok 2 - leg (b) [M2]: the failing sim', // start
  /*  7 */ '  ---',
  /*  8 */ "  error: 'the block must start at the not ok line'",
  /*  9 */ "  code: 'ERR_ASSERTION'",
  /* 10 */ '  ...', // end — the line before `ok 3`
  /* 11 */ 'ok 3 - the third sim',
  /* 12 */ '1..3',
  /* 13 */ '# fail 1',
]
const TAP_FOLLOWED_BLOCK = TAP_FOLLOWED.slice(6, 11).join('\n')

const tapFollowedGot = failingBlock(TAP_FOLLOWED.join('\n'))
assert.equal(tapFollowedGot, TAP_FOLLOWED_BLOCK,
  'leg (b) [M2]: the TAP output with a following `ok 3` returns exactly the `not ok 2` line ' +
  'through the line before `ok 3`')
assert.ok(!tapFollowedGot.includes('ok 1 - the first sim') &&
  !tapFollowedGot.includes('ok 3 - the third sim'),
  'leg (b) [M2]: … so neither the passing subtest before it nor the one after it is in the block')
console.log('ok - (b) [M2] TAP with a following `ok 3`: not ok 2 through the line before it')

const TAP_LAST = [
  /* 0 */ 'TAP version 13',
  /* 1 */ 'ok 1 - the first sim',
  /* 2 */ 'not ok 2 - leg (b) [M2]: the failing sim', // start
  /* 3 */ '  ---',
  /* 4 */ "  error: 'the block runs to the last line'",
  /* 5 */ "  code: 'ERR_ASSERTION'",
  /* 6 */ '  ...',
  /* 7 */ '# fail 1', // end — the last line of the text
]
const TAP_LAST_BLOCK = TAP_LAST.slice(2, 8).join('\n')

const tapLastGot = failingBlock(TAP_LAST.join('\n'))
assert.equal(tapLastGot, TAP_LAST_BLOCK,
  'leg (b) [M2]: the TAP output whose `not ok` line is followed only by diagnostics and a ' +
  '`# fail 1` last line returns from the `not ok` line through that last line inclusive')
assert.ok(tapLastGot.endsWith('\n# fail 1'),
  'leg (b) [M2]: … ending on the `# fail 1` line itself')
console.log('ok - (b) [M2] TAP ending in `# fail 1`: not ok 2 through that last line')

// ── (c) the bare node sim [M3] ──────────────────────────────────────────────

const NODE_SIM = [
  /*  0 */ 'sim line one: probing the marker rule',
  /*  1 */ 'sim line two: still fine',
  /*  2 */ 'node:internal/modules/run_main:123',
  /*  3 */ '      triggerUncaughtException(',
  /*  4 */ '      ^',
  /*  5 */ '',
  /*  6 */ 'AssertionError [ERR_ASSERTION]: leg (b) [M2]: expected the block, got the whole text', // start
  /*  7 */ '    + actual - expected',
  /*  8 */ '',
  /*  9 */ "    + 'the whole text'",
  /* 10 */ "    - 'the block'",
  /* 11 */ '    at file:///tmp/test_red.mjs:12:8',
  /* 12 */ '    at ModuleJob.run (node:internal/modules/esm/module_job:274:25) {',
  /* 13 */ '  generatedMessage: false,',
  /* 14 */ "  code: 'ERR_ASSERTION',",
  /* 15 */ "  actual: 'the whole text',",
  /* 16 */ "  expected: 'the block',",
  /* 17 */ "  operator: 'strictEqual'",
  /* 18 */ '}',
  /* 19 */ '',
  /* 20 */ 'Node.js v24.16.0', // end — the last line of the text
]
const NODE_SIM_BLOCK = NODE_SIM.slice(6, 21).join('\n')

const nodeGot = failingBlock(NODE_SIM.join('\n'))
assert.equal(nodeGot, NODE_SIM_BLOCK,
  'leg (c) [M3]: the bare node sim returns from the `AssertionError [ERR_ASSERTION]:` line ' +
  'through `Node.js v24.16.0` inclusive')
assert.ok(nodeGot.startsWith('AssertionError [ERR_ASSERTION]: leg (b) [M2]:') &&
  nodeGot.endsWith('Node.js v24.16.0'),
  'leg (c) [M3]: … starting on the AssertionError line and ending on the `Node.js v…` line')
for (const absent of [NODE_SIM[0], NODE_SIM[1], NODE_SIM[2], NODE_SIM[3]]) {
  assert.ok(!nodeGot.includes(absent),
    "leg (c) [M3]: … and the sim's own pre-assertion lines are absent from it: found " +
    JSON.stringify(absent))
}
console.log('ok - (c) [M3] bare node sim: AssertionError line through `Node.js v24.16.0`')

// ── (d) no start line at all [M4] ───────────────────────────────────────────

const GREEN = [
  'bringing up nodes...',
  '............                                                             [100%]',
  '',
  '28 passed in 1.02s',
].join('\n')

for (const [what, text] of [
  ['a green pytest summary', GREEN],
  ['its summary line alone', '28 passed in 1.02s'],
  ['the one-character text `1`', '1'],
  ['the empty string', ''],
]) {
  const got = failingBlock(text)
  assert.ok(got === text,
    `leg (d) [M4]: ${what} has no line matching the start rule, so it comes back unchanged, ` +
    `byte for byte — got ${JSON.stringify(got)}`)
}
console.log('ok - (d) [M4] no start line: green summary, `1` and the empty string come back unchanged')

// ── (e) the block is not length-bounded [M5] ────────────────────────────────
// A pytest-shaped fixture whose header-through-pre-rule block is longer than
// 8000 characters. The leg-naming line sits at the TOP of the block and the
// filler runs to the bottom, so an implementation that keeps a fixed head or a
// fixed tail of it fails on length, and one that keeps a tail fails on the
// header and the leg line too.

const BIG_HEADER = '________________________ test_fleet_mjs[test_big.mjs] ________________________'
const BIG_GW = '[gw1] darwin -- Python 3.12.4 /usr/bin/python3'
const BIG_LEG = 'E       AssertionError: leg (e) [M5]: the block is whatever the failing test printed'
const BIG_RULE = '=========================== short test summary info ============================'

const bigFiller = []
const bigLength = () => [BIG_HEADER, BIG_GW, BIG_LEG, ...bigFiller].join('\n').length
while (bigLength() <= 8000) {
  bigFiller.push('E       sim stdout line ' + String(bigFiller.length).padStart(4, '0') + ': ' +
    'the whole output is on the record, so the excerpt can be a block')
}

const BIG = [
  'bringing up nodes...',
  '=================================== FAILURES ===================================',
  BIG_HEADER, // start, index 2
  BIG_GW,
  BIG_LEG,
  ...bigFiller, // end — the last filler line, the line before the rule
  BIG_RULE,
  'FAILED tests/test_fleet.py::test_fleet_mjs[test_big.mjs] - AssertionErr...',
  '1 failed, 2 passed in 0.24s',
  'PADDING after the summary, which no block may reach',
]
const BIG_BLOCK = BIG.slice(2, 5 + bigFiller.length).join('\n')
assert.ok(BIG_BLOCK.length > 8000,
  `leg (e) [M5]: the fixture's own block must exceed 8000 characters, built ${BIG_BLOCK.length}`)

const bigGot = failingBlock(BIG.join('\n'))
assert.equal(bigGot.length, BIG_BLOCK.length,
  'leg (e) [M5]: the returned string is the whole block — its length equals the block\'s ' +
  `(${BIG_BLOCK.length}), so no length-bounded excerpt satisfies it`)
assert.equal(bigGot.split('\n')[0], BIG_HEADER,
  'leg (e) [M5]: … and its first line is the header, so no tail of the block satisfies it')
assert.ok(bigGot.includes(BIG_LEG),
  'leg (e) [M5]: … and it contains the leg-naming line')
assert.ok(bigGot.endsWith(bigFiller[bigFiller.length - 1]),
  'leg (e) [M5]: … and it runs to the line before the rule, so no head of the block satisfies it')
assert.ok(bigGot === BIG_BLOCK,
  'leg (e) [M5]: … and it is that block exactly, character for character')
console.log(`ok - (e) [M5] a ${BIG_BLOCK.length}-character block comes back whole`)

console.log('ALL TESTS PASSED')
