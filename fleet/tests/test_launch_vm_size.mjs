/**
 * fleet/tests/test_launch_vm_size.mjs — the exam for Task 2: *a run's memory is
 * sized by the browsers it holds open, and a run with no state exam is sized as
 * today*.
 *
 * This file is the Proof's `Test: fleet/tests/test_launch_vm_size.mjs`, written
 * where the Proof names it. Every relative path below is written for THIS
 * directory: `../` is the repository's `fleet/`, `../../` is the checkout root.
 *
 * The surface is the launcher's sizing arithmetic and the three sentences that
 * document it. Nothing here drives a launch: the three exports are pure, the
 * compiled payloads are object literals in the shape `compileFor` returns, and
 * the documents of leg (e) are read off the checkout. No process is spawned, no
 * socket is opened, no file is written.
 *
 * The Machine clauses under test, restated:
 *   M1 — `browsersFor(compiled)` reads `compiled.waves` (the compiler's
 *        `launch_waves`, an array of arrays of task objects) and returns the
 *        largest count, over those arrays, of tasks in ONE wave whose
 *        `proofTests` carries a path under `tests/state-exams/`. An entry that
 *        is not an object with a `proofTests` array counts as no exam, and a
 *        compiled object with no `waves` array gives `0`.
 *   M2 — `vmSizeFor(widestWave, cap, browsers)` keeps `cpu` at
 *        `min(cap.cpu, 2 + ceil(W / 3))` for EVERY `browsers`; `memory` is
 *        `min(cap, 2 + W) GB` when `browsers` is `0` or omitted, and
 *        `min(cap, max(6, ceil(2 + 1.25 × browsers))) GB` when `browsers` is at
 *        least `1`.
 *   M3 — `sizeFromCompile(compiled, { cpuCap, memoryCap, cpu, memory })` is a
 *        pure top-level export returning `{ width, browsers, cpu, memory }`,
 *        where `width` is the length of the longest array in `compiled.waves`
 *        (at least `1`), `browsers` is `browsersFor` of the same object, and an
 *        override returns that cap value outright; `launch()` sizes every run
 *        by calling this export — one definition of it, at top level, and the
 *        call inside `launch()` passes the compiled object and the four
 *        options.
 *   M4 — `stampWidth(script, { width, browsers, cpu, memory })` writes
 *        `# fleet: width=<W> browsers=<C> — ` at the head of its note, and a
 *        launch result carries `browsers` beside `width`.
 *   M5 — the runbook's capacity paragraph, first-run's `## capacity` section
 *        and the contract's launch-order bullet say the browsers rule.
 *
 * The Proof legs, and where each is answered — every assertion below names its
 * leg and the clause it comes from, so a reader can map this file back to the
 * contract:
 *   (a) [M1] `browsersFor` of `[[A, B], [C]]` is `2`; of the payload whose only
 *       `proofTests` are `tests/state-examsx/…` and `tests/unit/…` is `0`; of
 *       `{ waves: [['1', '2']] }` is `0`; of `{}` is `0`.
 *   (b) [M2] the `cpu` column is the width formula for each of `browsers` in
 *       `0`, `2`, `8`; the no-browser memories `4GB`/`4GB`/`12GB`; and the five
 *       browser rows `(2, 2) → '6GB'`, `(4, 4) → '7GB'`, `(8, 8) → '12GB'`,
 *       `(10, 10) → '12GB'` under cap `12GB` and `(8, 8) → '8GB'` under cap
 *       `8GB`.
 *   (c) [M3] `sizeFromCompile` of a one-wave two-exam payload, the two override
 *       calls, the one-task no-exam payload — and the three readings of
 *       `../launch.mjs`'s own source that say the closure was lifted and the
 *       call site uses the export.
 *   (d) [M4] `stampWidth`'s second line, and the `browsers,` field of the
 *       object literal `launch()` resolves.
 *   (e) [M5] the first four `Run:` lines of the Proof, answered in process over
 *       the four documents.
 *
 * Imports are a namespace import on purpose: at BASE `browsersFor` and
 * `sizeFromCompile` are not exported, and a named import would fail to LINK,
 * turning every leg into one module-level error. This way the file loads and
 * each leg says which export is missing.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import * as launchModule from '../launch.mjs'

const { browsersFor, vmSizeFor, sizeFromCompile, stampWidth } = launchModule

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FLEET_DIR = path.resolve(HERE, '..')
const REPO_ROOT = path.resolve(FLEET_DIR, '..')
const LAUNCH_MJS = path.join(FLEET_DIR, 'launch.mjs')
const RUNBOOK = path.join(FLEET_DIR, 'RUNBOOK.md')
const CONTRACT = path.join(FLEET_DIR, 'CONTRACT.md')
const FIRST_RUN = path.join(REPO_ROOT, 'skills', 'ultrapowers', 'references', 'first-run.md')

/** The caps the rows below are read under: the ceiling a TinyApp fleet is told to set. */
const CAP_12 = { cpu: '6', memory: '12GB' }
/** The narrower ceiling M2's last row names. */
const CAP_8 = { cpu: '6', memory: '8GB' }

/** A task object in the shape the compiler's `launch_waves` carries. */
const task = (id, proofTests) => ({
  id,
  files: [`src/${id}.ts`],
  proofTests,
  testCmd: 'npm test',
  proofRuns: [],
  proofGuards: [],
  factsheet: {}
})

/** An export the leg under test needs, named before it is called. */
const isFunction = (leg, name, value) => assert.equal(
  typeof value, 'function',
  `${leg} \`${name}\` must be exported by fleet/launch.mjs — the task's ` +
  '`Produces:` names it, and at BASE it is not there'
)

// ══════════════════════════════════════════════════════════════════════════
// (a) [M1] browsersFor: the largest per-wave count of state exams
// ══════════════════════════════════════════════════════════════════════════
{
  isFunction('(a) [M1]', 'browsersFor', browsersFor)

  // The leg's own payload: two exam-carrying tasks in wave one, one in wave
  // two. The answer is the widest wave's count, never the run's total.
  const twoThenOne = {
    waves: [
      [
        task('a', ['tests/state-exams/a.test.ts']),
        task('b', ['tests/state-exams/b.test.ts', 'tests/other.test.ts'])
      ],
      [task('c', ['tests/state-exams/c.test.ts'])]
    ]
  }
  assert.equal(browsersFor(twoThenOne), 2,
    '(a) [M1] `browsersFor` of waves `[[A, B], [C]]`, every task carrying a ' +
    '`tests/state-exams/` path, is 2 — the largest count in ONE wave, which is ' +
    'how many browsers the run may hold open at once, not the 3 it opens in total')

  // `tests/state-examsx/` is a different directory and `tests/unit/` is not one
  // either: the prefix M1 names ends in a slash.
  const neitherUnderStateExams = {
    waves: [[
      task('a', ['tests/state-examsx/a.test.ts']),
      task('b', ['tests/unit/a.test.ts'])
    ]]
  }
  assert.equal(browsersFor(neitherUnderStateExams), 0,
    '(a) [M1] a payload whose only `proofTests` are `tests/state-examsx/a.test.ts` ' +
    'and `tests/unit/a.test.ts` holds no browser open: M1 reads a path UNDER ' +
    '`tests/state-exams/`, and neither of those is one')

  assert.equal(browsersFor({ waves: [['1', '2']] }), 0,
    '(a) [M1] `{ waves: [[\'1\', \'2\']] }` — the id-string form `payload.waves` ' +
    'carries — is 0: an entry that is not an object with a `proofTests` array ' +
    'counts as no exam')

  assert.equal(browsersFor({}), 0,
    '(a) [M1] a compiled object with no `waves` array gives 0')
}

// ══════════════════════════════════════════════════════════════════════════
// (b) [M2] vmSizeFor: cpu keeps the width formula, memory gains the browsers rule
// ══════════════════════════════════════════════════════════════════════════
{
  isFunction('(b) [M2]', 'vmSizeFor', vmSizeFor)

  // cpu is the width formula for EVERY browsers — the third argument moves
  // memory and nothing else.
  for (const browsers of [0, 2, 8]) {
    assert.equal(vmSizeFor(1, CAP_12, browsers).cpu, '3',
      `(b) [M2] \`vmSizeFor(1, { cpu: '6', memory: '12GB' }, ${browsers}).cpu\` is ` +
      '\'3\' — `min(cap.cpu, 2 + ceil(W / 3))`, unchanged by the browsers count')
    assert.equal(vmSizeFor(10, CAP_12, browsers).cpu, '6',
      `(b) [M2] \`vmSizeFor(10, { cpu: '6', memory: '12GB' }, ${browsers}).cpu\` is ` +
      '\'6\' — the cap, the same for every browsers count')
  }

  // browsers omitted and browsers 0 are the same reading: `min(cap, 2 + W) GB`,
  // the size a run with no state exam has today.
  assert.equal(vmSizeFor(2, CAP_12).memory, '4GB',
    '(b) [M2] `vmSizeFor(2, { cpu: \'6\', memory: \'12GB\' })` — browsers omitted — ' +
    'gives memory \'4GB\', `min(cap, 2 + W) GB` exactly as at BASE')
  assert.equal(vmSizeFor(2, CAP_12, 0).memory, '4GB',
    '(b) [M2] `vmSizeFor(2, …, 0)` gives the same \'4GB\': a run that names no ' +
    'state exam is sized exactly as at BASE')
  assert.equal(vmSizeFor(10, CAP_12, 0).memory, '12GB',
    '(b) [M2] `vmSizeFor(10, …, 0)` gives \'12GB\' — `min(12, 2 + 10)`')

  // The browsers rows: `min(cap, max(6, ceil(2 + 1.25 × C))) GB`.
  const ROWS = [
    { width: 2, browsers: 2, cap: CAP_12, memory: '6GB' },
    { width: 4, browsers: 4, cap: CAP_12, memory: '7GB' },
    { width: 8, browsers: 8, cap: CAP_12, memory: '12GB' },
    { width: 10, browsers: 10, cap: CAP_12, memory: '12GB' },
    { width: 8, browsers: 8, cap: CAP_8, memory: '8GB' }
  ]
  for (const row of ROWS) {
    assert.equal(vmSizeFor(row.width, row.cap, row.browsers).memory, row.memory,
      `(b) [M2] \`vmSizeFor(${row.width}, { cpu: '${row.cap.cpu}', memory: ` +
      `'${row.cap.memory}' }, ${row.browsers}).memory\` is '${row.memory}' — ` +
      '`min(cap, max(6, ceil(2 + 1.25 × C))) GB`, the Claim\'s floor of 6 GB and ' +
      'its ceiling of the fleet\'s own cap')
  }
}

// ══════════════════════════════════════════════════════════════════════════
// (c) [M3] sizeFromCompile: the pure export, its overrides, and its call site
// ══════════════════════════════════════════════════════════════════════════
{
  isFunction('(c) [M3]', 'sizeFromCompile', sizeFromCompile)

  // One wave, two tasks, each naming one state exam — a two-task TinyApp run,
  // the shape of operator decision 10.
  const twoExams = {
    stamp: 'run-1',
    payload: { waves: [['a', 'b']] },
    waves: [[
      task('a', ['tests/state-exams/a.test.ts']),
      task('b', ['tests/state-exams/b.test.ts'])
    ]],
    edges: []
  }
  assert.deepEqual(
    sizeFromCompile(twoExams, { cpuCap: '6', memoryCap: '12GB' }),
    { width: 2, browsers: 2, cpu: '3', memory: '6GB' },
    '(c) [M3] `sizeFromCompile` of a one-wave two-state-exam payload under ' +
    '`{ cpuCap: \'6\', memoryCap: \'12GB\' }` is exactly ' +
    '`{ width: 2, browsers: 2, cpu: \'3\', memory: \'6GB\' }` — the two-task ' +
    'TinyApp run the Claim sizes at 6 GB'
  )

  assert.equal(
    sizeFromCompile(twoExams, { cpuCap: '6', memoryCap: '12GB', memory: '12GB' }).memory,
    '12GB',
    '(c) [M3] the same call with `memory: \'12GB\'` in its options returns memory ' +
    '\'12GB\' — a `--memory` on the launch line is the cap value returned outright, ' +
    'not the formula\'s \'6GB\''
  )
  assert.equal(
    sizeFromCompile(twoExams, { cpuCap: '6', memoryCap: '12GB', cpu: '6' }).cpu,
    '6',
    '(c) [M3] the same call with `cpu: \'6\'` in its options returns cpu \'6\' — the ' +
    'cap value outright, not the formula\'s \'3\''
  )

  const oneNoExam = {
    stamp: 'run-1',
    payload: { waves: [['a']] },
    waves: [[task('a', ['tests/unit/a.test.ts'])]],
    edges: []
  }
  assert.deepEqual(
    sizeFromCompile(oneNoExam, { cpuCap: '6', memoryCap: '12GB' }),
    { width: 1, browsers: 0, cpu: '3', memory: '3GB' },
    '(c) [M3] a payload of one wave of one task with no state exam is ' +
    '`{ width: 1, browsers: 0, cpu: \'3\', memory: \'3GB\' }` — a run with no state ' +
    'exam is sized exactly as at BASE'
  )

  // The source readings of M3: one definition, at top level, and a call site
  // that passes the compiled object and the four options. Read from THIS file's
  // location, so the file graded is the launcher of this checkout.
  const SRC_LINES = fs.readFileSync(LAUNCH_MJS, 'utf8').split('\n')

  const definitions = SRC_LINES.filter((line) => /^export function sizeFromCompile/.test(line))
  assert.equal(definitions.length, 1,
    '(c) [M3] `fleet/launch.mjs` matches `^export function sizeFromCompile` on ' +
    `exactly one line — got ${definitions.length}: ` + JSON.stringify(definitions))

  const assignments = SRC_LINES.filter((line) => line.includes('sizeFromCompile = '))
  assert.deepEqual(assignments, [],
    '(c) [M3] `fleet/launch.mjs` matches `sizeFromCompile = ` on no line — the ' +
    'closure inside `launch()` was LIFTED, not copied beside the export. Found: ' +
    JSON.stringify(assignments))

  const launchStart = SRC_LINES.findIndex((line) => line.startsWith('export async function launch'))
  assert.ok(launchStart >= 0,
    '(c) [M3] `fleet/launch.mjs` still carries a line beginning ' +
    '`export async function launch`, which is where the call site is read from')
  const afterLaunch = SRC_LINES.slice(launchStart + 1).findIndex((line) => line.startsWith('export '))
  const launchEnd = afterLaunch < 0 ? SRC_LINES.length : launchStart + 1 + afterLaunch
  const launchBody = SRC_LINES.slice(launchStart, launchEnd)

  const callSites = launchBody.filter((line) => /sizeFromCompile\(.*compiled.*cpuCap.*memoryCap/.test(line))
  assert.ok(callSites.length >= 1,
    '(c) [M3] the text between `export async function launch` and the next line ' +
    'beginning `export ` carries a line matching ' +
    '`sizeFromCompile\\(.*compiled.*cpuCap.*memoryCap` — `launch()` sizes every run ' +
    'by calling the export with the compiled object and the four options. This is ' +
    'what fails when the closure at BASE survives or the call site does not use ' +
    'the export.')
}

// ══════════════════════════════════════════════════════════════════════════
// (d) [M4] the script header, and `browsers` beside `width` on the result
// ══════════════════════════════════════════════════════════════════════════
{
  isFunction('(d) [M4]', 'stampWidth', stampWidth)

  const stamped = stampWidth('#!/usr/bin/env bash\nx\n',
    { width: 2, browsers: 2, cpu: '3', memory: '6GB' })
  const second = String(stamped).split('\n')[1]
  assert.ok(second.startsWith('# fleet: width=2 browsers=2 — '),
    '(d) [M4] `stampWidth`\'s second line starts `# fleet: width=2 browsers=2 — ` ' +
    '— the note\'s head names the browsers beside the width. Got: ' +
    JSON.stringify(second))
  assert.ok(second.includes('--cpu 3 --memory 6GB'),
    '(d) [M4] and that same line still carries `--cpu 3 --memory 6GB`, the size ' +
    'this box was cut to. Got: ' + JSON.stringify(second))

  // A launch result carries `browsers` beside `width`: pinned as the text
  // `browsers,` on a line of its own between the `memory,` line and the
  // `width,` line of the object literal `launch()` resolves. That literal is
  // the last such pair inside `launch()`'s own text.
  const SRC_LINES = fs.readFileSync(LAUNCH_MJS, 'utf8').split('\n')
  const launchStart = SRC_LINES.findIndex((line) => line.startsWith('export async function launch'))
  const afterLaunch = SRC_LINES.slice(launchStart + 1).findIndex((line) => line.startsWith('export '))
  const launchEnd = afterLaunch < 0 ? SRC_LINES.length : launchStart + 1 + afterLaunch
  const body = SRC_LINES.slice(launchStart, launchEnd)

  const bare = (name) => (line) => new RegExp(`^\\s*${name},\\s*$`).test(line)
  const widthAt = body.map(bare('width')).lastIndexOf(true)
  assert.ok(widthAt >= 0,
    '(d) [M4] `launch()` still resolves an object literal carrying `width,` on a ' +
    'line of its own — that literal is where `browsers` joins it')
  const memoryAt = body.slice(0, widthAt).map(bare('memory')).lastIndexOf(true)
  assert.ok(memoryAt >= 0,
    '(d) [M4] and that literal still carries `memory,` on a line of its own above ' +
    'its `width,` line')
  const between = body.slice(memoryAt + 1, widthAt)
  assert.ok(between.some(bare('browsers')),
    '(d) [M4] the object literal `launch()` resolves carries `browsers,` on a line ' +
    'of its own between its `memory,` line and its `width,` line — a launch result ' +
    'carries `browsers` beside `width`. This is what a result without the field ' +
    'fails. Lines found between them: ' + JSON.stringify(between))
}

// ══════════════════════════════════════════════════════════════════════════
// (e) [M5] the four documents, read as the Proof's first four `Run:` lines read them
// ══════════════════════════════════════════════════════════════════════════
{
  // `sed -n '/<from>/,/<to>/p'`: the lines from the first match of `from`
  // through the next match of `to` after it, inclusive — then `tr '\n' ' '`.
  const sedRange = (file, from, to) => {
    const lines = fs.readFileSync(file, 'utf8').split('\n')
    const start = lines.findIndex((line) => from.test(line))
    if (start < 0) return ''
    const rel = lines.slice(start + 1).findIndex((line) => to.test(line))
    const end = rel < 0 ? lines.length : start + 1 + rel + 1
    return lines.slice(start, end).join(' ')
  }

  // The two greps, translated from BRE: `(`, `)` and `+` are literal there.
  const ORDER = /browsers.*max\(6, 2 \+ 1.25 × C\).*12GB/

  const capacityItem = sedRange(RUNBOOK, /^\*\*2\. .capacity./, /^\*\*3\. /)
  assert.match(capacityItem, ORDER,
    '(e) [M5] the runbook\'s capacity paragraph — the numbered item whose label ' +
    'line carries `the ceiling a run may ask for`, read to the `**3. ` item that ' +
    'follows — carries `browsers`, then `max(6, 2 + 1.25 × C)`, then `12GB` in ' +
    'that order: a run with state exams is sized by the browsers its widest wave ' +
    'may hold open at once, and `12GB` is the recommended ceiling for a fleet that ' +
    'runs TinyApp plans. This is the Proof\'s first `Run:`, and it is what fails ' +
    'when the document is left as at BASE.')

  const firstRunCapacity = sedRange(FIRST_RUN, /^## capacity/, /^## /)
  assert.match(firstRunCapacity, ORDER,
    '(e) [M5] `skills/ultrapowers/references/first-run.md`\'s `## capacity` ' +
    'section, read to its next heading, carries the same three in the same order ' +
    '— the Proof\'s second `Run:`.')

  const contract = fs.readFileSync(CONTRACT, 'utf8')
  assert.ok(contract.includes('fleet: width=<W> browsers=<C>'),
    '(e) [M5] `fleet/CONTRACT.md`\'s launch-order bullet names the header ' +
    '`fleet: width=<W> browsers=<C>` — the Proof\'s third `Run:`.')
  assert.ok(contract.includes('min(memory, max(6, 2 + 1.25 × C))GB'),
    '(e) [M5] and its sizing sentence carries `min(memory, max(6, 2 + 1.25 × C))GB` ' +
    'for a plan with state exams — the Proof\'s fourth `Run:`, and what fails at ' +
    'BASE, where that sentence reads only `min(memory, 2 + W)GB`.')
}

console.log('ALL TESTS PASSED')
