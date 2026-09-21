/**
 * fleet/tests/test_factory_boot_kata_ids.mjs — the exam for *A done run's close
 * reaches the hub — the boot reads the run's ids out of the launcher's real
 * multi-line record, and says what the hub answered*.
 *
 * This file is the Proof's `Test: fleet/tests/test_factory_boot_kata_ids.mjs`,
 * written where the Proof names it. Every relative path below is written for
 * THIS directory: `../` is the repository's `fleet/`, `../../` is the
 * checkout root.
 *
 * The surface is `factory/boot.sh`'s new verb, `kata-ids <file>`, run as a
 * child process — never `boot.sh boot` itself, and no rig against stubs: the
 * task says this in so many words ("Do not build a rig that drives `boot.sh
 * boot` against stubs — it is not needed for any clause here"). M4 (what
 * `close_run` and `board_down` log) is proved by the Proof's second and third
 * `Run:` lines — two `grep`s over the script, run by the examiner outside
 * this file, against the diff at landing — and is not re-proved here.
 *
 * The Machine clauses under test, restated:
 *   M1 — `bash factory/boot.sh kata-ids <file>`, over a file holding byte for
 *        byte the record the launcher writes (`JSON.stringify(record, null,
 *        2)` and a newline), prints exactly `33 01M32D6HP5S5B3C99ZR0T9A6NW`
 *        and a newline on stdout and exits 0: the project's integer `id`
 *        and the RUN's `uid` (never the project's `uid`, which comes first
 *        in the file).
 *   M2 — the same command over the same record on one line
 *        (`JSON.stringify(record)`) prints the same line and exits 0; over a
 *        record with no `run` object, over a file that is not JSON, and over
 *        a path that does not exist, it prints nothing on stdout and exits 1.
 *   M3 — `bash factory/boot.sh` with no argument prints a usage line on
 *        stderr and exits 2; `bash -n factory/boot.sh` exits 0.
 *   M4 — not re-examined here (see above): proved by the Proof's second and
 *        third `Run:` lines against the landed diff.
 *
 * The Proof legs, and where each is answered:
 *   (a) [M1] the pretty-printed, multi-line record — first asserted to hold
 *       more than one line — gives stdout exactly `33 01M32D6HP5S5B3C99ZR0T9A6NW\n`
 *       and status exactly 0.
 *   (b) [M2] the same record on one line gives the same stdout and status 0;
 *       a record with `run` deleted, a file holding `not json`, and a
 *       nonexistent path each give stdout exactly `''` and status exactly 1.
 *   (c) [M3] no argument gives status exactly 2 and non-empty stderr; the
 *       Proof's first `Run:` line, `bash -n factory/boot.sh`, exits 0.
 *
 * Every child process is spawned with `env: simEnv()` from `./_helpers.mjs`
 * — never `process.env` — per the house rule for a node exam that starts a
 * process.
 *
 * Assumption this exam makes about the code under test: `kata-ids` is wired
 * into the `case "${1:-}" in …` dispatch at the bottom of `factory/boot.sh`,
 * needs nothing `boot()` sets up (no network, no `$FLEET_HOME` contents) and
 * is reachable with only the file argument and a `PATH` carrying `bash` and
 * `python3` (both of which `simEnv()` provides) — exactly what the task's
 * own text promises of the verb.
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { simEnv } from './_helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..', '..')
const BOOT_SH = path.join(REPO_ROOT, 'factory', 'boot.sh')

assert.ok(fs.existsSync(BOOT_SH), `factory/boot.sh must exist at ${BOOT_SH}`)

// One environment, reused across every spawn below: `kata-ids` touches
// nothing under `$FLEET_HOME`, so a fresh sim home per call would prove
// nothing extra and only cost more `mkdtemp`s.
const ENV = simEnv()

// A scratch directory for the fixture files this exam writes — independent
// of the sim home `ENV` carries, since `kata-ids` never reads `$FLEET_HOME`.
const FIXTURE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'boot-kata-ids-'))

const writeFixture = (name, content) => {
  const file = path.join(FIXTURE_DIR, name)
  fs.writeFileSync(file, content)
  return file
}

/** The record exactly as the Proof gives it: `project.uid` precedes `run.uid`. */
const RECORD = {
  url: 'https://kata.int.exe.xyz',
  project: {
    id: 33,
    uid: '01M2HSJCAB4WXJ7C6XEG23B869',
    name: 'popmechanic-tinyapp-fixture'
  },
  run: {
    uid: '01M32D6HP5S5B3C99ZR0T9A6NW',
    revision: 1
  },
  tasks: {
    1: {
      uid: '01M32D6JPS9P9K5S5KDBHKXTRV',
      short_id: 'xtrv',
      revision: 2
    }
  }
}

const EXPECTED_LINE = '33 01M32D6HP5S5B3C99ZR0T9A6NW\n'

const runKataIds = (file) => spawnSync('bash', [BOOT_SH, 'kata-ids', file], { encoding: 'utf8', env: ENV })

// ══════════════════════════════════════════════════════════════════════════
// (a) [M1] the launcher's real, multi-line record
// ══════════════════════════════════════════════════════════════════════════
{
  const pretty = JSON.stringify(RECORD, null, 2) + '\n'
  assert.ok(pretty.split('\n').length > 1,
    '(a) [M1] the fixture built as `JSON.stringify(record, null, 2) + \'\\n\'` ' +
    'must hold more than one line — the launcher\'s real shape — or a later ' +
    'edit that quietly flattens it would go unnoticed by this exam')
  const file = writeFixture('record-pretty.json', pretty)

  const result = runKataIds(file)
  assert.equal(result.stdout, EXPECTED_LINE,
    '(a) [M1] `bash factory/boot.sh kata-ids <file>` over the launcher\'s real, ' +
    'multi-line record must print exactly `33 01M32D6HP5S5B3C99ZR0T9A6NW\\n` on ' +
    `stdout — the project's integer id and the RUN's uid, never the project's ` +
    `uid, which comes first in the file. Got: ${JSON.stringify(result.stdout)}`)
  assert.equal(result.status, 0,
    '(a) [M1] and must exit 0. Got status ' + result.status +
    (result.stderr ? `, stderr: ${result.stderr}` : ''))
}

// ══════════════════════════════════════════════════════════════════════════
// (b) [M2] one-line record (same answer), and three ways to fail
// ══════════════════════════════════════════════════════════════════════════
{
  const oneLine = JSON.stringify(RECORD)
  const file = writeFixture('record-oneline.json', oneLine)
  const result = runKataIds(file)
  assert.equal(result.stdout, EXPECTED_LINE,
    '(b) [M2] the same record written on one line (`JSON.stringify(record)`, no ' +
    'indentation) must print the same line on stdout. Got: ' +
    JSON.stringify(result.stdout))
  assert.equal(result.status, 0,
    '(b) [M2] and must exit 0 for the one-line record too. Got status ' + result.status)
}

{
  const noRun = { ...RECORD }
  delete noRun.run
  const file = writeFixture('record-no-run.json', JSON.stringify(noRun, null, 2) + '\n')
  const result = runKataIds(file)
  assert.equal(result.stdout, '',
    '(b) [M2] a record with no `run` object must print nothing on stdout. Got: ' +
    JSON.stringify(result.stdout))
  assert.equal(result.status, 1,
    '(b) [M2] and must exit 1. Got status ' + result.status)
}

{
  const file = writeFixture('not-json.txt', 'not json')
  const result = runKataIds(file)
  assert.equal(result.stdout, '',
    '(b) [M2] a file that is not JSON must print nothing on stdout. Got: ' +
    JSON.stringify(result.stdout))
  assert.equal(result.status, 1,
    '(b) [M2] and must exit 1. Got status ' + result.status)
}

{
  const missing = path.join(FIXTURE_DIR, 'does-not-exist.json')
  assert.ok(!fs.existsSync(missing), 'the "does not exist" fixture path must not exist')
  const result = runKataIds(missing)
  assert.equal(result.stdout, '',
    '(b) [M2] a path that does not exist must print nothing on stdout. Got: ' +
    JSON.stringify(result.stdout))
  assert.equal(result.status, 1,
    '(b) [M2] and must exit 1. Got status ' + result.status)
}

// ══════════════════════════════════════════════════════════════════════════
// (c) [M3] no argument: usage on stderr, exit 2 — and the Proof's `bash -n`
// ══════════════════════════════════════════════════════════════════════════
{
  const result = spawnSync('bash', [BOOT_SH], { encoding: 'utf8', env: ENV })
  assert.equal(result.status, 2,
    '(c) [M3] `bash factory/boot.sh` with no argument must exit 2. Got status ' +
    result.status)
  assert.ok(result.stderr && result.stderr.length > 0,
    '(c) [M3] and must print a non-empty usage line on stderr. Got: ' +
    JSON.stringify(result.stderr))
}

{
  // The Proof's first `Run:` line: `bash -n factory/boot.sh` exits 0.
  const result = spawnSync('bash', ['-n', BOOT_SH], { encoding: 'utf8', env: ENV })
  assert.equal(result.status, 0,
    '(c) [M3] `bash -n factory/boot.sh` — the Proof\'s first `Run:` line — must ' +
    `exit 0. Got status ${result.status}, stderr: ${result.stderr}`)
}

console.log('ALL TESTS PASSED')
