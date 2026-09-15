/**
 * fleet/tests/test_run_engine_state_exams.mjs — the exam for Task 4: *the
 * report row carries the action wall and whether the browser ran*.
 *
 * This file is the Proof's `Test: fleet/tests/test_run_engine_state_exams.mjs`,
 * written where the Proof names it. Every relative path below is written for
 * THIS directory: `../` is the repository's `fleet/`, `../../` is the checkout
 * root.
 *
 * The surface under test has no sim at BASE, so this one is built from
 * scratch: it imports `stateExamsOf` and `stateExamBlock` from
 * `../run-engine.mjs`, builds run directories under `os.tmpdir()` holding
 * `state-exams/task-1/<stem>-0/` with hand-written JSON, and reads the two
 * shipped files leg (d) grades off the checkout. It starts no process at all.
 *
 * The Machine clauses under test, restated:
 *   M1 — `stateExamsOf(runDir, taskId)` returns, per exam stem, an object with
 *        EXACTLY the keys `exam`, `store_ms`, `render_ms`, `render`,
 *        `action_ms`, `browser`, `mutant_killed`, `contract` — the six BASE
 *        keys plus two — where `action_ms` is `walls.json`'s `action_ms` when
 *        it is a number and `null` otherwise, and `browser` is `walls.json`'s
 *        `browser` when it is `'ran'` or `'skipped'` and `null` otherwise.
 *   M2 — a `walls.json` with no `action_ms` and no `browser` keys (the
 *        pre-#834 shape) yields `action_ms: null` and `browser: null` with the
 *        six BASE fields unchanged from BASE's reading; a missing or
 *        unparsable `walls.json` yields `null` in all four wall fields and
 *        still one element.
 *   M3 — `stateExamBlock(rows)` is unchanged: with rows all
 *        `mutant_killed: true` it returns the `STATE EXAM:` block naming each
 *        exam and its mutant path, and with any row not killed it returns `''`.
 *   M4 — `skills/ultrapowers/references/report-format.md`'s `stateExams`
 *        schema lists `action_ms` as `["integer","null"]` and `browser` as
 *        `["string","null"]` with enum `["ran","skipped",null]`, and its
 *        `tasks[].stateExams` prose says each element is
 *        `{ exam, store_ms, render_ms, render, action_ms, browser,
 *        mutant_killed, contract }` and says what `action_ms` and `browser`
 *        are.
 *
 * The Proof legs, and where each is answered — every assertion below names its
 * leg and the clause it comes from, so a reader can map this file back to the
 * contract:
 *   (a) [M1] the fixture's own `walls.json` (`store_ms` 545, `render_ms` 125,
 *       `action_ms` 94, `mutant_ms` 0.3, `render` `ran`, `browser` `ran`)
 *       beside `{"killed": true, "path": "todos/0/completed"}` and
 *       `{"breach": null}`: the one element's sorted keys are the eight names
 *       and its values are those readings with `contract` `ok`; with
 *       `"action_ms": null, "browser": "skipped"` the element reads `null` and
 *       `skipped`; with `"action_ms": "94"` and `"browser": "yes"` — a string
 *       that is not a number, a string that is neither verb — both are `null`.
 *       `"action_ms": 0` is a number, so it is carried as `0`.
 *   (b) [M2] the pre-#834 shape `{"store_ms": 8, "render_ms": null, "render":
 *       "skipped"}`; then no `walls.json` at all; then an unparsable one.
 *   (c) [M3] `stateExamBlock` over two killed rows, and over rows where one is
 *       not killed.
 *   (d) [M4] the second `Run:` line, asked here so the exam grades it too: the
 *       two schema lines, the eight-key prose, and no `six keys` left in the
 *       engine.
 *
 * At BASE this file is red for one reason: the engine's `stateExamsOf` drops
 * `action_ms` and `browser` (its own comment calls the row six keys), and
 * `report-format.md` documents six.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { stateExamsOf, stateExamBlock } from '../run-engine.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'engine-state-exams-')))
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }))

// ── the contract's literals, spelled once ───────────────────────────────────
// The `Produces:` key set — the six BASE keys plus the two this task adds —
// sorted, for a deep-equal on the element's own key set [M1].
const EIGHT_KEYS = ['action_ms', 'browser', 'contract', 'exam', 'mutant_killed',
  'render', 'render_ms', 'store_ms']
// The task id every run directory below is built under; `stateExamsOf` takes it
// as its second argument.
const TASK_ID = '1'

// ── the rig: a run directory of hand-written evidence ───────────────────────
// `<runDir>/state-exams/task-<id>/<stem>-0/` with the three JSON files the
// engine reads back. A value of `ABSENT` writes no file at all; a string is
// written verbatim (that is how the unparsable case is made); anything else is
// JSON-encoded. Nothing here runs an exam — the engine's reading is a pure
// function of the tree, so the tree is written by hand.
const ABSENT = Symbol('no such file')

const writeEvidence = (dir, name, value) => {
  if (value === ABSENT) return
  fs.writeFileSync(path.join(dir, name),
    typeof value === 'string' ? value : JSON.stringify(value))
}

// `stems` maps a stem to `{ walls, mutant, contract }`. Each case gets a run
// directory of its own, so `rows.length === 1` is a real reading and not an
// accident of ordering.
const runDirWith = (label, stems) => {
  const runDir = path.join(tmp, label)
  for (const [stem, files] of Object.entries(stems)) {
    const dir = path.join(runDir, 'state-exams', 'task-' + TASK_ID, stem + '-0')
    fs.mkdirSync(dir, { recursive: true })
    writeEvidence(dir, 'walls.json', files.walls)
    writeEvidence(dir, 'mutant.json', files.mutant)
    writeEvidence(dir, 'contract.json', files.contract)
  }
  return runDir
}

// The one element of a one-stem run directory, with its key set checked against
// the `Produces:` contract before any value is read [M1].
const soleRow = (leg, label, stems) => {
  const rows = stateExamsOf(runDirWith(label, stems), TASK_ID)
  assert.ok(Array.isArray(rows),
    leg + ' stateExamsOf returns an array, one element per exam stem')
  assert.equal(rows.length, 1,
    leg + ' one stem under state-exams/task-' + TASK_ID + '/ is one element, ' +
    'whatever the evidence in it reads — got ' + rows.length)
  assert.deepEqual(Object.keys(rows[0]).sort(), EIGHT_KEYS,
    leg + ' the element carries EXACTLY the eight `Produces:` keys — the six ' +
    'BASE keys plus `action_ms` and `browser`, and `mutant_path` is still ' +
    'dropped. Got: ' + JSON.stringify(Object.keys(rows[0]).sort()))
  return rows[0]
}

// The mutant and contract files most cases below carry, so the six BASE fields
// have known readings while the two new ones are the question.
const KILLED = { killed: true, path: 'todos/0/completed' }
const CLEAN = { breach: null }

// ══════════════════════════════════════════════════════════════════════════
// (a) [M1] the eight keys, and the two new readings across the three shapes
// ══════════════════════════════════════════════════════════════════════════
{
  // The fixture's own `walls.json` since run-7: an interaction exam, the
  // browser ran.
  const row = soleRow('(a) [M1]', 'a-full', {
    'todo-state': {
      walls: { store_ms: 545, render_ms: 125, action_ms: 94, mutant_ms: 0.3, render: 'ran', browser: 'ran' },
      mutant: KILLED,
      contract: CLEAN
    }
  })
  assert.deepEqual(row, {
    exam: 'todo-state',
    store_ms: 545,
    render_ms: 125,
    render: 'ran',
    action_ms: 94,
    browser: 'ran',
    mutant_killed: true,
    contract: 'ok'
  }, '(a) [M1] every value is the reading the evidence carries: `store_ms` 545, ' +
    '`render_ms` 125 (the render ran), `render` `ran`, `action_ms` 94, `browser` ' +
    '`ran`, `mutant_killed` true, `contract` `ok` for a null breach. Got: ' +
    JSON.stringify(row))
  // Spelled once more field by field, because these two are the task's claim.
  assert.equal(row.action_ms, 94,
    '(a) [M1] `action_ms` is `walls.json`\'s `action_ms` when it is a number')
  assert.equal(row.browser, 'ran',
    '(a) [M1] `browser` is `walls.json`\'s `browser` when it is `ran`')
}

{
  // A callback exam that skipped the browser: `action_ms` null in the file is
  // null on the row, and `skipped` is the other verb `browser` may carry.
  const row = soleRow('(a) [M1]', 'a-skipped', {
    'cart-state': {
      walls: { store_ms: 545, render_ms: 125, action_ms: null, mutant_ms: 0.3, render: 'ran', browser: 'skipped' },
      mutant: KILLED,
      contract: CLEAN
    }
  })
  assert.equal(row.action_ms, null,
    '(a) [M1] a `walls.json` `action_ms` of `null` is not a number, so the row ' +
    'reads `null` — got ' + JSON.stringify(row.action_ms))
  assert.equal(row.browser, 'skipped',
    '(a) [M1] `browser` is carried when it is `skipped` — got ' + JSON.stringify(row.browser))
  assert.deepEqual(row, {
    exam: 'cart-state',
    store_ms: 545,
    render_ms: 125,
    render: 'ran',
    action_ms: null,
    browser: 'skipped',
    mutant_killed: true,
    contract: 'ok'
  }, '(a) [M1] and the other six fields are unmoved by either. Got: ' + JSON.stringify(row))
}

{
  // Neither reading is what M1 names: `"94"` is a string, not a number, and
  // `"yes"` is neither `ran` nor `skipped`. Both are `null` — the engine
  // reports what it can read and `null` for what it cannot, never the raw
  // value.
  const row = soleRow('(a) [M1]', 'a-wrong-types', {
    'filters-state': {
      walls: { store_ms: 545, render_ms: 125, action_ms: '94', mutant_ms: 0.3, render: 'ran', browser: 'yes' },
      mutant: KILLED,
      contract: CLEAN
    }
  })
  assert.equal(row.action_ms, null,
    '(a) [M1] `"94"` is a string, not a number, so `action_ms` is `null` — ' +
    'got ' + JSON.stringify(row.action_ms))
  assert.equal(row.browser, null,
    '(a) [M1] `"yes"` is neither `ran` nor `skipped`, so `browser` is `null` — ' +
    'got ' + JSON.stringify(row.browser))
  assert.deepEqual(Object.keys(row).sort(), EIGHT_KEYS,
    '(a) [M1] and an unreadable wall leaves the key set alone: eight keys still')
}

{
  // `0` is a number — M1's predicate is the type, not the truth of the value,
  // so a zero-millisecond action is carried as `0` and not flattened to `null`.
  const row = soleRow('(a) [M1]', 'a-zero', {
    'zero-state': {
      walls: { store_ms: 545, render_ms: 125, action_ms: 0, mutant_ms: 0.3, render: 'ran', browser: 'ran' },
      mutant: KILLED,
      contract: CLEAN
    }
  })
  assert.equal(row.action_ms, 0,
    '(a) [M1] `action_ms` of `0` is a number, so the row carries `0` — got ' +
    JSON.stringify(row.action_ms))
}

// ══════════════════════════════════════════════════════════════════════════
// (b) [M2] the pre-#834 shape, a missing walls.json, an unparsable one
// ══════════════════════════════════════════════════════════════════════════
{
  // The shape a `walls.json` had before #834: no `action_ms` key and no
  // `browser` key at all. Both new fields are `null`, and the six BASE fields
  // read exactly as they did at BASE — including `render_ms` `null`, because
  // the render was skipped.
  const row = soleRow('(b) [M2]', 'b-pre834', {
    'legacy-state': {
      walls: { store_ms: 8, render_ms: null, render: 'skipped' },
      mutant: KILLED,
      contract: CLEAN
    }
  })
  assert.deepEqual(row, {
    exam: 'legacy-state',
    store_ms: 8,
    render_ms: null,
    render: 'skipped',
    action_ms: null,
    browser: null,
    mutant_killed: true,
    contract: 'ok'
  }, '(b) [M2] a pre-#834 `walls.json` yields `action_ms: null` and `browser: null` ' +
    'with the six BASE fields unchanged from BASE\'s reading. Got: ' + JSON.stringify(row))
}

{
  // A breach is carried verbatim and a mutant that survived is `false`: the six
  // BASE fields still read exactly as they did at BASE beside a pre-#834 file.
  const row = soleRow('(b) [M2]', 'b-pre834-breach', {
    'legacy-breach': {
      walls: { store_ms: 8, render_ms: null, render: 'skipped' },
      mutant: { killed: false, path: 'todos/1/title' },
      contract: { breach: 'todos[0].id is not a string' }
    }
  })
  assert.deepEqual(row, {
    exam: 'legacy-breach',
    store_ms: 8,
    render_ms: null,
    render: 'skipped',
    action_ms: null,
    browser: null,
    mutant_killed: false,
    contract: 'todos[0].id is not a string'
  }, '(b) [M2] `mutant_killed` false and the breach line verbatim are BASE\'s own ' +
    'reading, unchanged. Got: ' + JSON.stringify(row))
}

{
  // No `walls.json` at all: every one of the four wall fields is `null`, and
  // the element is still there — evidence, not control flow.
  const row = soleRow('(b) [M2]', 'b-missing-walls', {
    'no-walls': { walls: ABSENT, mutant: KILLED, contract: CLEAN }
  })
  assert.deepEqual(row, {
    exam: 'no-walls',
    store_ms: null,
    render_ms: null,
    render: null,
    action_ms: null,
    browser: null,
    mutant_killed: true,
    contract: 'ok'
  }, '(b) [M2] a missing `walls.json` yields `null` in all four wall fields — ' +
    '`store_ms`, `render_ms`, `render`, `action_ms`, `browser` — and still one ' +
    'element. Got: ' + JSON.stringify(row))
}

{
  // An unparsable `walls.json` reads the same way as a missing one.
  const row = soleRow('(b) [M2]', 'b-unparsable-walls', {
    'bad-walls': { walls: '{"store_ms": 8, "action_ms":', mutant: KILLED, contract: CLEAN }
  })
  assert.deepEqual(row, {
    exam: 'bad-walls',
    store_ms: null,
    render_ms: null,
    render: null,
    action_ms: null,
    browser: null,
    mutant_killed: true,
    contract: 'ok'
  }, '(b) [M2] an unparsable `walls.json` yields `null` in all four wall fields ' +
    'and still one element. Got: ' + JSON.stringify(row))
}

// ══════════════════════════════════════════════════════════════════════════
// (c) [M3] stateExamBlock is unchanged
// ══════════════════════════════════════════════════════════════════════════
{
  // The reviewer's block reads `mutant_killed` and `mutant_path` only — the two
  // new keys are none of its business — so these rows are written by hand, the
  // way the clause states them.
  const killedRows = [
    { exam: 'todo-state', mutant_killed: true, mutant_path: 'todos/0/completed' },
    { exam: 'cart-state', mutant_killed: true, mutant_path: 'cart/items/0/qty' }
  ]
  const block = stateExamBlock(killedRows)
  assert.equal(typeof block, 'string',
    '(c) [M3] stateExamBlock returns a string')
  assert.ok(block.startsWith('\n\nSTATE EXAM:'),
    '(c) [M3] with every row killed the block starts `\\n\\nSTATE EXAM:` — got: ' +
    JSON.stringify(block.slice(0, 40)))
  for (const r of killedRows) {
    assert.ok(block.includes('\n- ' + r.exam + ': mutant ' + r.mutant_path + ' killed: true'),
      '(c) [M3] the block names exam `' + r.exam + '` and its mutant path `' +
      r.mutant_path + '`. Got:\n' + block)
  }
  assert.ok(block.includes('duty 5'),
    '(c) [M3] and says what it settles — duty 5, for those exam files and nothing else')

  // Any row not killed renders nothing at all (the run-51 rule).
  assert.equal(stateExamBlock([killedRows[0], { exam: 'cart-state', mutant_killed: false, mutant_path: 'cart/items/0/qty' }]), '',
    '(c) [M3] with any row not killed the block is the empty string')
  assert.equal(stateExamBlock([{ exam: 'x', mutant_killed: null, mutant_path: 'p' }]), '',
    '(c) [M3] a row whose `mutant_killed` could not be read is not a killed row either')
  assert.equal(stateExamBlock([]), '',
    '(c) [M3] and no rows at all is the empty string, as at BASE')
}

// ══════════════════════════════════════════════════════════════════════════
// (d) [M4] the second `Run:` line: the schema, the prose, and the engine
// ══════════════════════════════════════════════════════════════════════════
{
  const doc = fs.readFileSync(
    path.join(HERE, '..', '..', 'skills', 'ultrapowers', 'references', 'report-format.md'), 'utf8')

  const ACTION_SCHEMA = '"action_ms": {"type":["integer","null"]}'
  const BROWSER_SCHEMA = '"browser": {"type":["string","null"], "enum":["ran","skipped",null]}'
  const EIGHT_PROSE = '{ exam, store_ms, render_ms, render, action_ms, browser, mutant_killed, contract }'

  assert.ok(doc.includes(ACTION_SCHEMA),
    '(d) [M4] the `stateExams` schema lists `action_ms` as ["integer","null"], ' +
    'spelled exactly `' + ACTION_SCHEMA + '` (the Proof\'s own grep)')
  assert.ok(doc.includes(BROWSER_SCHEMA),
    '(d) [M4] and `browser` as ["string","null"] with enum ["ran","skipped",null], ' +
    'spelled exactly `' + BROWSER_SCHEMA + '` (the Proof\'s own grep)')

  // Both belong to the `stateExams` item, not to some other row of the schema.
  const schemaAt = doc.indexOf('"stateExams"')
  assert.ok(schemaAt !== -1,
    '(d) [M4] the schema still carries a `stateExams` array of task rows')
  assert.ok(doc.indexOf(ACTION_SCHEMA) > schemaAt && doc.indexOf(BROWSER_SCHEMA) > schemaAt,
    '(d) [M4] and both lines sit inside that `stateExams` item, not elsewhere in the schema')

  assert.ok(doc.includes(EIGHT_PROSE),
    '(d) [M4] the prose spells each element `' + EIGHT_PROSE + '`')

  const proseRow = doc.split('\n').find((l) => l.includes('| `tasks[].stateExams` |'))
  assert.ok(proseRow,
    '(d) [M4] `report-format.md` still carries a `tasks[].stateExams` prose row')
  assert.ok(proseRow.includes(EIGHT_PROSE),
    '(d) [M4] and it is THAT row that spells the eight keys, not some other line')
  // "and says what `action_ms` and `browser` are": each name appears in the
  // eight-key list AND again where the row defines it.
  const occurrences = (hay, needle) => hay.split(needle).length - 1
  assert.ok(occurrences(proseRow, 'action_ms') >= 2,
    '(d) [M4] the row says what `action_ms` IS, beyond naming it in the eight-key ' +
    'list — it appears ' + occurrences(proseRow, 'action_ms') + ' time(s)')
  assert.ok(occurrences(proseRow, 'browser') >= 2,
    '(d) [M4] the row says what `browser` IS, beyond naming it in the eight-key ' +
    'list — it appears ' + occurrences(proseRow, 'browser') + ' time(s)')
  assert.ok(proseRow.includes('walls.json'),
    '(d) [M4] and the row still says `walls.json` is where those readings come from')

  const engine = fs.readFileSync(path.join(HERE, '..', 'run-engine.mjs'), 'utf8')
  assert.equal(occurrences(engine, 'six keys'), 0,
    '(d) [M4] no `six keys` is left in `fleet/run-engine.mjs`: the row is eight — ' +
    'found ' + occurrences(engine, 'six keys') + ' occurrence(s)')
}

console.log('ALL TESTS PASSED')
