/**
 * fleet/tests/test_factory_checks_at_base.mjs — the exam for "The engine runs
 * the plan's checks once at base before the first dispatch and writes one row
 * per check" (#1195; map #1131 rule 4).
 *
 * `factory/checks-at-base.mjs` exports `checksAtBase`, a pure function: it
 * touches neither disk, git nor the network itself — everything it does goes
 * through the `clone`, `runLines` and `appendEvent` it is handed. This exam
 * drives it with recording fakes only; no rig, no child process, no disk.
 *
 * M4 — that `factory/engine.mjs` awaits `checksAtBase(` before its first
 * dispatch, and that `factory/policy.json` carries an "on" `checks_at_base`
 * cell with its four record keys — is read against the diff by the task's
 * own `Run:` proof lines (a grep and a `python3 -c` assertion), not by this
 * script; this exam covers M1, M2 and M3, the three clauses a pure-function
 * exam can actually exercise through calls and return values.
 *
 * Legs, each naming the Machine clause it comes from:
 *
 *   (a) [M1] the two-check call: `clone` once, `runLines` once with the
 *       right `lines`/`cwd`/`env.ULTRA_BASE`/`timeoutSeconds`/`sh`,
 *       `appendEvent` twice with the right rows, and the call resolves even
 *       though the first check is red;
 *   (b) [M2] `enabled: false`, and `enabled: true` with `checks: []`: none of
 *       the three fakes are ever called;
 *   (c) [M3] a `clone` that throws and a `runLines` that rejects: the call
 *       still resolves, and `appendEvent` receives no `check:line` row.
 */

import assert from 'node:assert/strict'

import { checksAtBase, default as checksAtBaseDefault } from '../../factory/checks-at-base.mjs'

const BASE = 'b'.repeat(40)
const DIR = '/tmp/checks-at-base-exam-dir'
const sh = function shSentinel () {}
const TWO_CHECKS = [
  { cmd: 'bun run typecheck', minor: false },
  { cmd: 'true', minor: true }
]

/** A recording `clone`, `runLines` and `appendEvent`, sharing one call log. */
function fakes ({ runLinesResult = [], cloneThrows = null, runLinesRejects = null } = {}) {
  const calls = { clone: 0, runLines: [], appendEvent: [] }
  const clone = () => {
    calls.clone += 1
    if (cloneThrows) throw cloneThrows
    return DIR
  }
  const runLines = async (opts) => {
    calls.runLines.push(opts)
    if (runLinesRejects) throw runLinesRejects
    return runLinesResult
  }
  const appendEvent = (row) => { calls.appendEvent.push(row) }
  return { calls, clone, runLines, appendEvent }
}

// ── the default export carries the same named function ─────────────────────
assert.equal(checksAtBaseDefault.checksAtBase, checksAtBase, 'the default export carries the named checksAtBase')

// ── a. [M1] two checks, one red one green — every argument, every row ──────
{
  const f = fakes({
    runLinesResult: [
      { cmd: 'bun run typecheck', exit: 1, tail: '' },
      { cmd: 'true', exit: 0, tail: '' }
    ]
  })
  let rejected = false
  try {
    await checksAtBase({
      checks: TWO_CHECKS, enabled: true, clone: f.clone, base: BASE, sh, timeoutSeconds: 7,
      runLines: f.runLines, appendEvent: f.appendEvent
    })
  } catch (e) {
    rejected = true
  }
  assert.equal(rejected, false, '(a) [M1] the call resolves — a red check rejects nothing')

  assert.equal(f.calls.clone, 1, '(a) [M1] clone is called exactly once')
  assert.equal(f.calls.runLines.length, 1, '(a) [M1] runLines is called exactly once')
  const call = f.calls.runLines[0]
  assert.deepEqual(call.lines, ['bun run typecheck', 'true'], '(a) [M1] lines is exactly the two cmds, in order')
  assert.equal(call.cwd, DIR, "(a) [M1] cwd is clone()'s directory")
  assert.equal(call.env.ULTRA_BASE, BASE, '(a) [M1] env.ULTRA_BASE equals base')
  assert.equal(call.timeoutSeconds, 7, '(a) [M1] timeoutSeconds is passed through')
  assert.equal(call.sh, sh, '(a) [M1] sh is the same sh, by identity')

  assert.equal(f.calls.appendEvent.length, 2, '(a) [M1] appendEvent is called exactly twice')
  const [row1, row2] = f.calls.appendEvent
  assert.equal(row1.kind, 'check:line', '(a) [M1] row one kind is check:line')
  assert.equal(row1.base, true, '(a) [M1] row one base is exactly true')
  assert.equal(row1.cmd, 'bun run typecheck', '(a) [M1] row one cmd is the first check')
  assert.equal(row1.exit, 1, '(a) [M1] row one exit is 1, the red result')
  assert.equal(row1.minor, false, '(a) [M1] row one minor is the Boolean of the first check')
  assert.equal(row2.kind, 'check:line', '(a) [M1] row two kind is check:line')
  assert.equal(row2.base, true, '(a) [M1] row two base is exactly true')
  assert.equal(row2.cmd, 'true', '(a) [M1] row two cmd is the second check')
  assert.equal(row2.exit, 0, '(a) [M1] row two exit is 0, the green result')
  assert.equal(row2.minor, true, '(a) [M1] row two minor is the Boolean of the second check')
}

// ── b. [M2] not enabled, or enabled with nothing to check: silence ─────────
{
  const disabled = fakes()
  await checksAtBase({
    checks: TWO_CHECKS, enabled: false, clone: disabled.clone, base: BASE, sh, timeoutSeconds: 7,
    runLines: disabled.runLines, appendEvent: disabled.appendEvent
  })
  assert.equal(disabled.calls.clone, 0, '(b) [M2] enabled: false — clone is never called')
  assert.equal(disabled.calls.runLines.length, 0, '(b) [M2] enabled: false — runLines is never called')
  assert.equal(disabled.calls.appendEvent.length, 0, '(b) [M2] enabled: false — appendEvent is never called')

  const empty = fakes()
  await checksAtBase({
    checks: [], enabled: true, clone: empty.clone, base: BASE, sh, timeoutSeconds: 7,
    runLines: empty.runLines, appendEvent: empty.appendEvent
  })
  assert.equal(empty.calls.clone, 0, '(b) [M2] checks: [] — clone is never called')
  assert.equal(empty.calls.runLines.length, 0, '(b) [M2] checks: [] — runLines is never called')
  assert.equal(empty.calls.appendEvent.length, 0, '(b) [M2] checks: [] — appendEvent is never called')
}

// ── c. [M3] a throwing clone, a rejecting runLines: still resolves ─────────
{
  const cloneThrows = fakes({ cloneThrows: new Error('exam: clone is red') })
  let rejected = false
  try {
    await checksAtBase({
      checks: TWO_CHECKS, enabled: true, clone: cloneThrows.clone, base: BASE, sh, timeoutSeconds: 7,
      runLines: cloneThrows.runLines, appendEvent: cloneThrows.appendEvent
    })
  } catch (e) {
    rejected = true
  }
  assert.equal(rejected, false, '(c) [M3] a throwing clone: the call still resolves')
  const checkRowsA = cloneThrows.calls.appendEvent.filter((r) => r.kind === 'check:line')
  assert.equal(checkRowsA.length, 0, '(c) [M3] a throwing clone: no check:line row was appended')

  const runLinesRejects = fakes({ runLinesRejects: new Error('exam: runLines is red') })
  rejected = false
  try {
    await checksAtBase({
      checks: TWO_CHECKS, enabled: true, clone: runLinesRejects.clone, base: BASE, sh, timeoutSeconds: 7,
      runLines: runLinesRejects.runLines, appendEvent: runLinesRejects.appendEvent
    })
  } catch (e) {
    rejected = true
  }
  assert.equal(rejected, false, '(c) [M3] a rejecting runLines: the call still resolves')
  const checkRowsB = runLinesRejects.calls.appendEvent.filter((r) => r.kind === 'check:line')
  assert.equal(checkRowsB.length, 0, '(c) [M3] a rejecting runLines: no check:line row was appended')
}

console.log('ALL TESTS PASSED')
