// fleet/tests/test_race_evidence.mjs — the judge's per-run readers (#511 task 6).
//
// Every input a race verdict rests on is read here: the durable gate-read pair
// written by `driveOne`, and the run's own TinyBase store under a /tmp db-dir.
// The store is the fragile one — /tmp is reapable — so an unreadable store
// degrades to `null` (a loss to the comparator) instead of aborting the verdict
// for the runs whose gate-reads survived. No sqlite3 binary is touched: the
// call rides an injected `exec`.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  gateReadPath,
  gateDetailPath,
  readRunRecord,
  sqliteStoreJson,
  countFixRounds,
  ledgerOf,
  reportedOf,
  driveStatusOf,
} from '../race-evidence.mjs'

const tmpEvidenceDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'race-evidence-'))

const READ = {
  o1: true,
  spendObservational: { reported: 239564, ledger: 241000 },
}
const DETAIL = { runId: 'run-1', status: 'gate-green', elapsedMs: 4770000, pullRequest: null }

const writeRecord = (dir, runId, { read = READ, detail = DETAIL, corruptRead = false } = {}) => {
  if (read !== null) {
    fs.writeFileSync(gateReadPath(dir, runId), corruptRead ? '{"o1": tru' : JSON.stringify(read))
  }
  if (detail !== null) fs.writeFileSync(gateDetailPath(dir, runId), JSON.stringify(detail))
}

// (f) The paths are the ones driveOne writes — evidence dir, run-scoped names.
test('the gate-read paths are <evidenceDir>/gate-read-<runId>[.detail].json', () => {
  assert.equal(gateReadPath('/tmp/ev', 'run-1'), '/tmp/ev/gate-read-run-1.json')
  assert.equal(gateDetailPath('/tmp/ev', 'run-1'), '/tmp/ev/gate-read-run-1.detail.json')
})

// (a) Both present, detail absent, read corrupt.
test('readRunRecord returns both parsed objects and no missing names', () => {
  const dir = tmpEvidenceDir()
  writeRecord(dir, 'run-1')
  assert.deepEqual(readRunRecord(dir, 'run-1'), { read: READ, detail: DETAIL, missing: [] })
})

test('an absent detail file is null and named in missing', () => {
  const dir = tmpEvidenceDir()
  writeRecord(dir, 'run-1', { detail: null })
  assert.deepEqual(readRunRecord(dir, 'run-1'), {
    read: READ,
    detail: null,
    missing: ['gate-read-run-1.detail.json'],
  })
})

test('a corrupt read file is null and named in missing', () => {
  const dir = tmpEvidenceDir()
  writeRecord(dir, 'run-1', { corruptRead: true })
  assert.deepEqual(readRunRecord(dir, 'run-1'), {
    read: null,
    detail: DETAIL,
    missing: ['gate-read-run-1.json'],
  })
})

test('a run with no evidence at all names both files', () => {
  const dir = tmpEvidenceDir()
  assert.deepEqual(readRunRecord(dir, 'run-7'), {
    read: null,
    detail: null,
    missing: ['gate-read-run-7.json', 'gate-read-run-7.detail.json'],
  })
})

// (b) A trimmed MergeableStore shape: [tables, values], every node [value, hlc, hash]
// — built the way test_status.mjs builds one, since runEvents is what unwraps it.
const stamped = (v) => [v, 'P0Q-hlc', 12345]
const row = (runId, kind, label) =>
  stamped({ kind: stamped(kind), label: stamped(label), ts: stamped(1788245813225), runId: stamped(runId) })
const STORE = [[{
  events: stamped({
    'run-1:01AAA': row('run-1', 'worker:start', 'fix:1:1'),
    'run-1:01AAB': row('run-1', 'worker:end', 'fix:1:1'),
    'run-1:01AAC': row('run-1', 'worker:start', 'fix:2:1'),
    'run-1:01AAD': row('run-1', 'worker:end', 'fix:2:1'),
    'run-1:01AAE': row('run-1', 'worker:start', 'impl:1'),
    'run-1:01AAF': row('run-1', 'worker:end', 'impl:1'),
    'run-2:01AAG': row('run-2', 'worker:start', 'fix:9:1'),
  }),
  runs: stamped({}),
}, {}], 'hlc', 0]

test('countFixRounds counts fix: starts only, per run', () => {
  // race-48's judge counted starts AND ends and reported double.
  assert.equal(countFixRounds(STORE, 'run-1'), 2)
  assert.equal(countFixRounds(STORE, 'run-2'), 1)
})

test('a run with no fix rounds counts zero, not null', () => {
  assert.equal(countFixRounds(STORE, 'run-3'), 0)
})

// (c) A reaped /tmp store is null, never an exception.
test('countFixRounds over a null store is null', () => {
  assert.equal(countFixRounds(null, 'run-1'), null)
  assert.equal(countFixRounds(undefined, 'run-1'), null)
})

test('countFixRounds takes an injected events reader', () => {
  const seen = []
  const events = (storeJson, runId) => {
    seen.push([storeJson, runId])
    return [{ kind: 'worker:start', label: 'fix:4:2' }, { kind: 'worker:end', label: 'fix:4:2' }]
  }
  assert.equal(countFixRounds(STORE, 'run-1', events), 1)
  assert.deepEqual(seen, [[STORE, 'run-1']])
})

// (d) The sqlite read, entirely through the injected exec.
const execStub = (result, argvLog) => (argv) => {
  argvLog.push(argv)
  return Promise.resolve(result)
}

test('sqliteStoreJson parses the store cell and pins the argv', async () => {
  const argvLog = []
  const store = await sqliteStoreJson('/tmp/fleet-run-1', execStub({ code: 0, stdout: JSON.stringify(STORE) }, argvLog))
  assert.deepEqual(store, STORE)
  assert.deepEqual(argvLog, [['sqlite3', '/tmp/fleet-run-1/fleet.db', 'SELECT store FROM tinybase LIMIT 1']])
})

test('a non-zero sqlite exit is null, not a throw', async () => {
  assert.equal(await sqliteStoreJson('/tmp/gone', execStub({ code: 1 }, [])), null)
})

test('unparseable sqlite output is null, not a throw', async () => {
  assert.equal(await sqliteStoreJson('/tmp/gone', execStub({ code: 0, stdout: 'not json' }, [])), null)
})

test('a throwing exec is null, not a throw', async () => {
  const boom = () => Promise.reject(new Error('sqlite3: command not found'))
  assert.equal(await sqliteStoreJson('/tmp/gone', boom), null)
})

// (e) The small accessors.
test('ledgerOf and reportedOf read spendObservational', () => {
  assert.equal(ledgerOf(READ), 241000)
  assert.equal(reportedOf(READ), 239564)
})

test('a missing or non-numeric spend is null', () => {
  assert.equal(ledgerOf(null), null)
  assert.equal(reportedOf(null), null)
  assert.equal(ledgerOf({}), null)
  assert.equal(reportedOf({}), null)
  assert.equal(ledgerOf({ spendObservational: { ledger: null } }), null)
  assert.equal(reportedOf({ spendObservational: { reported: 'lots' } }), null)
  assert.equal(ledgerOf({ spendObservational: { ledger: NaN } }), null)
})

test('driveStatusOf returns the drive status, null for a null detail', () => {
  assert.equal(driveStatusOf(DETAIL), 'gate-green')
  assert.equal(driveStatusOf({ status: 'parked' }), 'parked')
  assert.equal(driveStatusOf({ status: 'failed' }), 'failed')
  assert.equal(driveStatusOf(null), null)
  assert.equal(driveStatusOf({}), null)
})

// node:test runs the registered cases after module evaluation, so a bare banner
// here would print before any assertion ran (the run-50 critic's finding). The
// runner sets a non-zero exit code on any failure; print the sentinel only on a
// clean exit, which is what tests/test_fleet_suite.py greps for.
process.on('exit', (code) => { if (code === 0) console.log('ALL TESTS PASSED') })
