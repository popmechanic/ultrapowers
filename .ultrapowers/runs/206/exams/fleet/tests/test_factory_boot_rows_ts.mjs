// fleet/tests/test_factory_boot_rows_ts.mjs
//
// #1201: every row `event_row` writes, and the `run:audit` row, leads with
// `"ts"` in the same ISO-8601 UTC millisecond shape `appendEvent` writes.
//
// M1 — `bash factory/boot.sh event-row <file> merge code=200`, run with
//      <file> absent, exits 0 and leaves <file> holding exactly one line;
//      that line parses to an object whose first key is `ts`, whose `ts`
//      is a string with `new Date(ts).toISOString() === ts`, and which
//      still carries `kind === 'merge'` and `code === 200` (the number).
// M2 — `node factory/audit.mjs <missing path> done` exits 0 and prints
//      exactly one stdout line; that line parses to an object whose first
//      key is `ts` (same shape/check), and which still carries
//      `kind === 'run:audit'`, `state === 'done'`, `missing` an array of
//      length 0.
//
// Only node:child_process spawnSync, node:fs, node:os and node:path are
// used, per the task's examiner note. Each case gets its own fresh
// fs.mkdtempSync directory and a file path inside it that does not yet
// exist.

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BOOT_SH = path.resolve(__dirname, '../../factory/boot.sh')
const AUDIT_MJS = path.resolve(__dirname, '../../factory/audit.mjs')

let failed = false
function fail (msg) {
  failed = true
  console.error(`FAIL: ${msg}`)
}
function assertEq (actual, expected, msg) {
  if (actual !== expected) {
    fail(`${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}
function assertTrue (cond, msg) {
  if (!cond) fail(msg)
}

function nonEmptyLines (text) {
  return text.split('\n').filter((l) => l.trim() !== '')
}

// --- M1: bash factory/boot.sh event-row <file> merge code=200 ---------

{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boot-rows-ts-'))
  const file = path.join(dir, 'events.jsonl')
  assertTrue(!fs.existsSync(file), 'M1 setup: <file> must be absent before the call')

  const result = spawnSync('bash', [BOOT_SH, 'event-row', file, 'merge', 'code=200'], {
    encoding: 'utf8',
  })

  assertEq(result.status, 0, '[M1] `event-row` subprocess exit status')

  const contents = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
  const lines = nonEmptyLines(contents)
  assertEq(lines.length, 1, '[M1] <file> holds exactly one non-empty line')

  if (lines.length === 1) {
    let row
    try {
      row = JSON.parse(lines[0])
    } catch (e) {
      fail(`[M1] the line parses as JSON — ${e.message}`)
    }
    if (row && typeof row === 'object') {
      const keys = Object.keys(row)
      assertEq(keys[0], 'ts', '[M1] the row\'s first key is `ts`')
      assertEq(typeof row.ts, 'string', '[M1] `ts` is a string')
      if (typeof row.ts === 'string') {
        assertEq(
          new Date(row.ts).toISOString(),
          row.ts,
          '[M1] `ts` is ISO-8601 UTC millisecond shape (`new Date(ts).toISOString() === ts`)',
        )
      }
      assertEq(row.kind, 'merge', '[M1] the row still carries `kind === \'merge\'`')
      assertEq(row.code, 200, '[M1] the row still carries `code` as the number 200')
    }
  }
}

// --- M2: node factory/audit.mjs <missing path> done --------------------

{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-rows-ts-'))
  const missingPath = path.join(dir, 'nope', 'events.jsonl')
  assertTrue(!fs.existsSync(missingPath), 'M2 setup: the given path must not exist')

  const result = spawnSync('node', [AUDIT_MJS, missingPath, 'done'], {
    encoding: 'utf8',
  })

  assertEq(result.status, 0, '[M2] `audit.mjs` subprocess exit status')

  const lines = nonEmptyLines(result.stdout || '')
  assertEq(lines.length, 1, '[M2] stdout holds exactly one non-empty line')

  if (lines.length === 1) {
    let row
    try {
      row = JSON.parse(lines[0])
    } catch (e) {
      fail(`[M2] the line parses as JSON — ${e.message}`)
    }
    if (row && typeof row === 'object') {
      const keys = Object.keys(row)
      assertEq(keys[0], 'ts', '[M2] the row\'s first key is `ts`')
      assertEq(typeof row.ts, 'string', '[M2] `ts` is a string')
      if (typeof row.ts === 'string') {
        assertEq(
          new Date(row.ts).toISOString(),
          row.ts,
          '[M2] `ts` is ISO-8601 UTC millisecond shape (`new Date(ts).toISOString() === ts`)',
        )
      }
      assertEq(row.kind, 'run:audit', '[M2] the row still carries `kind === \'run:audit\'`')
      assertEq(row.state, 'done', '[M2] the row still carries `state === \'done\'`')
      assertTrue(Array.isArray(row.missing), '[M2] `missing` is an array')
      if (Array.isArray(row.missing)) {
        assertEq(row.missing.length, 0, '[M2] `missing` has length exactly 0')
      }
    }
  }
}

if (failed) {
  process.exit(1)
}
console.log('ALL TESTS PASSED')
process.exit(0)
