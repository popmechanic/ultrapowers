/**
 * fleet/tests/test_factory_audit.mjs — the exam for "A finished run's record
 * ends with one computed row naming what it should have and doesn't" (#1167).
 *
 * This file is the Proof's `Test:`, written whole at the path the Proof
 * names, against `factory/audit.mjs` before that module exists — so leg (a)
 * asserts the module is importable at all, and everything else fails as an
 * ABSENT DELIVERABLE rather than a typo until it is written.
 *
 * The Machine clauses under test, restated so a reader can map every
 * assertion back to the contract:
 *
 *   M1 — `auditRows(rows, { state, bound })` returns `{ kind: 'run:audit',
 *        state, missing }`; for any `state` other than `done`, `missing` is
 *        `[]`.
 *   M2 — for `state: 'done'`, every task with a `landing` row and no
 *        `fold:verify` row for the same `task` contributes the string
 *        `fold:verify task <id>`, in the order of the `landing` rows.
 *   M3 — for `state: 'done'` with `bound: true`, after those come:
 *        `board:close task <id>` for every landed task with no `board:close`
 *        row whose `what` is `task <id>` and whose `code` is an integer
 *        200–299; then `board:close run` under the same rule for
 *        `what: 'run'`; then `board:leave` when no `board:leave` row has
 *        `rc === 0`. With `bound: false` none of those three kinds is ever
 *        listed.
 *   M4 — the CLI `node factory/audit.mjs <events.jsonl> <state> [--bound]`
 *        reads the file as JSON lines, skips any line that fails to parse,
 *        prints exactly one line (`JSON.stringify` of the computed object),
 *        and exits 0; an unreadable file is audited as no rows, still one
 *        line, still exit 0.
 *
 * The legs, in the order they run here:
 *
 *   (a) [M1] one `landing` row, `state: 'parked'` — a non-`done` state comes
 *       back with `missing: []`, the whole object asserted by equality.
 *   (b) [M2] two `landing` rows and one `fold:verify` for only one of them,
 *       `state: 'done'` — `missing` names the unverified task, in landing
 *       order.
 *   (c) [M3] both tasks verified, three kinds of `board:close`/`board:leave`
 *       failure at once, `bound: true` — the three-item `missing` in the
 *       order M3 fixes; the same rows all-green — `[]`; the same
 *       not-all-green rows with `bound: false` — `[]`, proving the bound
 *       kinds are gated on `bound` and not merely absent by luck.
 *   (d) [M4] the CLI over a temp file holding leg (c)'s not-all-green rows
 *       plus one unparseable line, with `--bound` — one stdout line whose
 *       parse equals leg (c)'s first result exactly; the CLI over a path
 *       that does not exist — one stdout line parsing to the empty-`missing`
 *       `done` object.
 *
 * What this exam assumes of the code under test, spelled out because it is
 * the one thing a reader of the Machine clauses alone would have to guess:
 * `auditRows` is a *named* export (the Interfaces line gives its call shape
 * directly, so that's what's imported — this exam does not care whether
 * `factory/audit.mjs` *additionally* has a default export bag, per the task's
 * "the default export and the CLI live in the one file"). The CLI is reached
 * only by spawning `node factory/audit.mjs …` as a real child process — a
 * substituted direct call to `main()` in-process would leave M4's own claim
 * (a real process, a real exit code, a real single stdout line) unproven.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { simEnv } from './_helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..', '..')
const AUDIT_PATH = path.join(REPO_ROOT, 'factory', 'audit.mjs')

/** The deliverable, imported dynamically: a tree without it reports the
 *  ABSENT MODULE as an assertion of leg (a) rather than dying at load with
 *  no leg named at all. */
let audit = null
let auditImportError = null
try {
  audit = await import('../../factory/audit.mjs')
} catch (error) {
  auditImportError = error
}
assert.ok(auditImportError === null,
  '(a) [M1] `factory/audit.mjs` is importable — the module this task creates. Got: ' +
  String(auditImportError && (auditImportError.message || auditImportError)))
assert.equal(typeof audit.auditRows, 'function',
  '(a) [M1] it exports `auditRows(rows, { state, bound })`; got ' +
  JSON.stringify(typeof audit.auditRows))

// ══════════════════════════════════════════════════════════════════════════
// (a) [M1] a non-`done` state: the whole result object, by equality
// ══════════════════════════════════════════════════════════════════════════

{
  const rows = [{ kind: 'landing', task: '1' }]
  const result = audit.auditRows(rows, { state: 'parked', bound: true })
  assert.deepEqual(result, { kind: 'run:audit', state: 'parked', missing: [] },
    '(a) [M1] `auditRows` on a `landing`-only run at `state: \'parked\'` returns ' +
    '`{ kind: \'run:audit\', state: \'parked\', missing: [] }` exactly — any state other ' +
    'than `done` computes no `missing` at all, even though a `landing` with no ' +
    '`fold:verify` exists; got ' + JSON.stringify(result))
}

// ══════════════════════════════════════════════════════════════════════════
// (b) [M2] `state: 'done'`: an unverified landing names itself, in landing order
// ══════════════════════════════════════════════════════════════════════════

{
  const rows = [
    { kind: 'landing', task: '2' },
    { kind: 'landing', task: '1' },
    { kind: 'fold:verify', task: '1', ran: true, attempt: 1 },
  ]
  const result = audit.auditRows(rows, { state: 'done', bound: false })
  assert.deepEqual(result.missing, ['fold:verify task 2'],
    '(b) [M2] two landings (task 2 then task 1), only task 1 re-verified: `missing` names ' +
    'only the unverified task, as `fold:verify task 2`, in the order the landings arrived ' +
    '(task 2 before task 1); got ' + JSON.stringify(result.missing))
}

// ══════════════════════════════════════════════════════════════════════════
// (c) [M3] both tasks verified: board:close / board:leave, bound true vs. false
// ══════════════════════════════════════════════════════════════════════════

const boundBaseRows = [
  { kind: 'landing', task: '2' },
  { kind: 'landing', task: '1' },
  { kind: 'fold:verify', task: '2', ran: true, attempt: 1 },
  { kind: 'fold:verify', task: '1', ran: true, attempt: 1 },
]

const notGreenRows = [
  ...boundBaseRows,
  { kind: 'board:close', what: 'task 2', code: 200 },
  { kind: 'board:close', what: 'task 1', code: 409 },
  { kind: 'board:close', what: 'run', code: null, skipped: 'x' },
  { kind: 'board:leave', rc: 6 },
]

const EXPECTED_NOT_GREEN_BOUND = {
  kind: 'run:audit',
  state: 'done',
  missing: ['board:close task 1', 'board:close run', 'board:leave'],
}

{
  const result = audit.auditRows(notGreenRows, { state: 'done', bound: true })
  assert.deepEqual(result, EXPECTED_NOT_GREEN_BOUND,
    '(c) [M3] both landings verified; task 2 closed 200, task 1 closed 409 (out of range), ' +
    'the run close is `code: null` with a `skipped` reason, and `board:leave rc: 6` — ' +
    '`bound: true` lists, in order, the one landed task whose close was not 200–299 ' +
    '(`board:close task 1`), then `board:close run` (the run close also failed the same ' +
    'range test), then `board:leave` (no `board:leave` row has `rc === 0`); got ' +
    JSON.stringify(result))
}

{
  const greenRows = [
    ...boundBaseRows,
    { kind: 'board:close', what: 'task 2', code: 200 },
    { kind: 'board:close', what: 'task 1', code: 200 },
    { kind: 'board:close', what: 'run', code: 200 },
    { kind: 'board:leave', rc: 0 },
  ]
  const result = audit.auditRows(greenRows, { state: 'done', bound: true })
  assert.deepEqual(result.missing, [],
    '(c) [M3] the same shape with every close at code 200 and `board:leave rc: 0`: nothing ' +
    'is missing; got ' + JSON.stringify(result.missing))
}

{
  const result = audit.auditRows(notGreenRows, { state: 'done', bound: false })
  assert.deepEqual(result.missing, [],
    '(c) [M3] the exact not-all-green rows above (task 1 close out of range, run close ' +
    'skipped, `board:leave rc: 6`), but `bound: false`: none of the three bound-gated kinds ' +
    'is ever listed, even though every one of them would be missing under `bound: true` — ' +
    'got ' + JSON.stringify(result.missing))
}

// ══════════════════════════════════════════════════════════════════════════
// (d) [M4] the CLI: a real `node factory/audit.mjs` child process
// ══════════════════════════════════════════════════════════════════════════

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-exam-'))
try {
  const eventsPath = path.join(tmpDir, 'events.jsonl')
  const lines = [
    ...notGreenRows.map((row) => JSON.stringify(row)),
    'not json',
  ]
  fs.writeFileSync(eventsPath, lines.join('\n') + '\n')

  const run = spawnSync(process.execPath, [AUDIT_PATH, eventsPath, 'done', '--bound'], {
    cwd: REPO_ROOT,
    env: simEnv(),
    encoding: 'utf8',
  })

  assert.equal(run.status, 0,
    '(d) [M4] the CLI over a real events file exits 0; got status ' + JSON.stringify(run.status) +
    (run.stderr ? ', stderr: ' + run.stderr.trim().slice(-500) : ''))
  const stdoutLines = run.stdout.replace(/\n+$/, '').split('\n')
  assert.equal(stdoutLines.length, 1,
    '(d) [M4] the CLI prints exactly one stdout line; got ' + JSON.stringify(run.stdout))
  let parsed = null
  assert.doesNotThrow(() => { parsed = JSON.parse(stdoutLines[0]) },
    '(d) [M4] that one line is `JSON.stringify` of the computed object, so it parses; got ' +
    JSON.stringify(stdoutLines[0]))
  assert.deepEqual(parsed, EXPECTED_NOT_GREEN_BOUND,
    '(d) [M4] the file is read as JSON lines, skipping the one unparseable `not json` line, ' +
    'and the printed object equals what `auditRows` computes for these rows at `done` with ' +
    '`--bound` (leg (c)\'s not-all-green result); got ' + JSON.stringify(parsed))

  const missingPath = path.join(tmpDir, 'does-not-exist.jsonl')
  const runMissing = spawnSync(process.execPath, [AUDIT_PATH, missingPath, 'done'], {
    cwd: REPO_ROOT,
    env: simEnv(),
    encoding: 'utf8',
  })
  assert.equal(runMissing.status, 0,
    '(d) [M4] an unreadable (here: nonexistent) file still exits 0; got status ' +
    JSON.stringify(runMissing.status) +
    (runMissing.stderr ? ', stderr: ' + runMissing.stderr.trim().slice(-500) : ''))
  const missingLines = runMissing.stdout.replace(/\n+$/, '').split('\n')
  assert.equal(missingLines.length, 1,
    '(d) [M4] still exactly one stdout line; got ' + JSON.stringify(runMissing.stdout))
  let missingParsed = null
  assert.doesNotThrow(() => { missingParsed = JSON.parse(missingLines[0]) },
    '(d) [M4] that one line still parses as JSON; got ' + JSON.stringify(missingLines[0]))
  assert.deepEqual(missingParsed, { kind: 'run:audit', state: 'done', missing: [] },
    '(d) [M4] an unreadable file is audited as no rows at all — `{ kind: \'run:audit\', ' +
    'state: \'done\', missing: [] }`; got ' + JSON.stringify(missingParsed))
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true })
}

console.log('ALL TESTS PASSED')
