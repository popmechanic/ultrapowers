// fleet/tests/test_drive_one_plan_path.mjs — task 1: the launch refuses a plan
// path it cannot read.
//
// The claim: when the plan path on a launch line is mistyped, the command stops
// with an error naming the path it could not read, and no sandbox is cloned.
//
// Leg -> machine clause:
//   (a) assertPlanReadable(<mkdtemp>/absent.md) throws, and the thrown message
//       contains that absent path as a substring                          [M1]
//   (b) assertPlanReadable(<mkdtemp>) — an existing directory, not a regular
//       file — throws, and the thrown message contains that directory path [M2]
//   (c) assertPlanReadable(<mkdtemp>/real.md), after bytes are written to it,
//       returns and throws nothing                                        [M3]
//   (d) main([<mkdtemp>/absent.md, 'run-probe', --target o/r, --base <40-hex>],
//       { drive, readToken, exec }) rejects with an error whose message
//       contains that absent plan path — so the rejection is attributable to
//       the plan check and not to flag parsing, sha validation or the token
//       read — and the recording `drive` stub's call array has length exactly
//       0, so nothing was driven                                          [M4]
//
// Nothing here provisions, shells out or touches the network: `drive`, the
// token reader and the shell are injected, and the only disk writes are inside
// one mkdtemp dir removed before this file exits.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// A namespace import, deliberately: a missing `assertPlanReadable` must fail as
// a named assertion about the absent export rather than as an ESM link error.
import * as cli from '../drive-one.mjs'

let passed = 0
const ok = (label) => {
  passed += 1
  console.log(`ok - ${label}`)
}

// The two a launch names, exactly as `parseArgs` requires them, so leg (d)'s
// argv is well-formed everywhere except the plan path.
const TARGET = 'o/r'
const SHA = '3f'.repeat(20)

// Unique to this file, removed in the `finally` below — same-wave suites run
// concurrently on one machine.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drive-one-plan-path-'))
const ABSENT = path.join(tmp, 'absent.md')
const REAL = path.join(tmp, 'real.md')

// The throw is captured rather than matched by regex: the path is a literal
// substring of the message, and a path is not a regex.
const throwsNaming = (fn, needle, label) => {
  let error = null
  let returned
  try {
    returned = fn()
  } catch (thrown) {
    error = thrown
  }
  assert.ok(error, `${label}: expected a throw, got a return of ${JSON.stringify(returned)}`)
  assert.ok(error instanceof Error, `${label}: expected an Error, got ${JSON.stringify(String(error))}`)
  assert.ok(
    String(error.message).includes(needle),
    `${label}: the message ${JSON.stringify(error.message)} must name ${needle}`,
  )
}

try {
  // -------------------------------------------------------------------------
  // The export itself. Until `assertPlanReadable` exists there is nothing to
  // grade, and this line says so in one sentence.
  // -------------------------------------------------------------------------
  assert.equal(
    typeof cli.assertPlanReadable,
    'function',
    'fleet/drive-one.mjs must export assertPlanReadable(planPath) — the plan-path check is not implemented',
  )
  const { assertPlanReadable, main } = cli

  // -------------------------------------------------------------------------
  // (a) M1: a path that does not exist throws, and the message names it.
  // -------------------------------------------------------------------------
  {
    assert.equal(fs.existsSync(ABSENT), false, `${ABSENT} must not exist for this leg to mean anything`)
    throwsNaming(() => assertPlanReadable(ABSENT), ABSENT, '(a) an absent plan path')
    ok('(a) assertPlanReadable throws on an absent path and the message names it [M1]')
  }

  // -------------------------------------------------------------------------
  // (b) M2: an existing directory is not a readable plan; the message names it.
  // -------------------------------------------------------------------------
  {
    assert.ok(fs.statSync(tmp).isDirectory(), `${tmp} must be a directory for this leg to mean anything`)
    throwsNaming(() => assertPlanReadable(tmp), tmp, '(b) a directory in place of a plan file')
    ok('(b) assertPlanReadable throws on a directory and the message names it [M2]')
  }

  // -------------------------------------------------------------------------
  // (c) M3: a readable regular file returns, and throws nothing. This is the
  //     leg a refuse-everything stub cannot pass.
  // -------------------------------------------------------------------------
  {
    fs.writeFileSync(REAL, '# a plan\n\n### Task 1: something\n')
    assert.ok(fs.statSync(REAL).isFile() && fs.statSync(REAL).size > 0, `${REAL} must be a non-empty regular file`)
    let thrown = null
    try {
      assertPlanReadable(REAL)
    } catch (error) {
      thrown = error
    }
    assert.equal(
      thrown,
      null,
      `(c) a readable regular file must not throw, but assertPlanReadable(${REAL}) threw ${JSON.stringify(String(thrown?.message ?? thrown))}`,
    )
    ok('(c) assertPlanReadable returns without throwing on a readable regular file [M3]')
  }

  // -------------------------------------------------------------------------
  // (d) M4: the CLI stops before the drive. The argv is valid in every other
  //     respect — real target, real 40-hex base, a token reader that succeeds —
  //     so a rejection naming the plan path can only come from the plan check.
  // -------------------------------------------------------------------------
  {
    const calls = []
    const drive = async (opts) => {
      calls.push(opts)
      // A well-formed return, so a drive that IS called fails this leg on the
      // missing rejection rather than on a destructuring crash.
      return { read: { runId: opts.runId }, reportPath: '/tmp/r.json', detailPath: '/tmp/d.json' }
    }
    const readToken = () => 'fake-token'
    const exec = async () => ({ code: 0, stdout: '', stderr: '' })

    let rejection = null
    try {
      await main([ABSENT, 'run-probe', '--target', TARGET, '--base', SHA], { drive, readToken, exec })
    } catch (error) {
      rejection = error
    }
    assert.ok(rejection, '(d) main must reject when the plan path cannot be read')
    assert.ok(
      rejection instanceof Error,
      `(d) main must reject with an Error, got ${JSON.stringify(String(rejection))}`,
    )
    assert.ok(
      String(rejection.message).includes(ABSENT),
      `(d) the rejection ${JSON.stringify(rejection.message)} must name the plan path ${ABSENT}`,
    )
    assert.equal(calls.length, 0, `(d) nothing may be driven: the drive stub was called ${calls.length} time(s)`)
    ok('(d) main rejects naming the plan path and never calls drive [M4]')
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}
assert.equal(fs.existsSync(tmp), false, 'the temp dir must be removed before this file exits')

console.log(`\nALL TESTS PASSED (${passed})`)
