/**
 * fleet/tests/test_factory_boot_rows.mjs — the exam for "What the boot does at
 * the end of a run is rows — each hub close, the leave, each merge attempt and
 * re-fold — committed before the tags, with the audit row after them" (#1167).
 *
 * The Machine clauses this file is the `Test:` for, and covers in full:
 *
 *   M1 `bash factory/boot.sh event-row <file> board:close what=run code=200`
 *      appends exactly the line
 *      `{"kind":"board:close","what":"run","code":200}` and a newline to
 *      `<file>`, creating it if absent, and exits 0; a value that is an
 *      integer or the word `null`, `true` or `false` is written bare, and
 *      every other value as a JSON string.
 *   M2 `bash factory/boot.sh event-row <file> refold ok=false
 *      reason='kernel said "no"'` appends exactly
 *      `{"kind":"refold","ok":false,"reason":"kernel said \"no\""}`; two
 *      calls leave two lines, the first untouched.
 *   M3 `bash factory/boot.sh` with no argument still prints a usage line on
 *      stderr and exits 2, and `bash -n factory/boot.sh` exits 0.
 *
 * M4 and M5 are this task's other Machine clauses, but the Proof gives them
 * their own `Run:` one-liners (a `grep`/`awk` sweep of `factory/boot.sh`
 * itself) rather than a leg of this file, and this brief's `EXAM FILES` names
 * only this one path — so M4 and M5 earn no assertion here; this file is
 * legs (a), (b) and (c) of the Proof, which the Proof itself maps to M1, M2
 * and M3.
 *
 * Legs, each naming the Machine clause and Proof leg it comes from:
 *
 *   (a) [M1, Proof leg a] in a fresh temp directory, on a file that does not
 *       exist yet: `event-row <file> board:close what=run code=200` exits 0
 *       and leaves the file's bytes exactly
 *       `{"kind":"board:close","what":"run","code":200}\n` (the integer
 *       `200` written bare); a second call,
 *       `event-row <file> board:close "what=task 3" code=null "skipped=no
 *       kata.json"`, exits 0 and appends exactly
 *       `{"kind":"board:close","what":"task 3","code":null,"skipped":"no
 *       kata.json"}\n` (`null` written bare, the string values quoted) —
 *       proving the file is created when absent and grown by appending
 *       rather than truncated. A third, isolated file proves the other bare
 *       word M1 names: `event-row <file> some:kind flag=true` writes
 *       `{"kind":"some:kind","flag":true}\n` — `true` bare.
 *   (b) [M2, Proof leg b] continuing on the file from leg (a) — which already
 *       carries the two M1 lines — `event-row <file> refold ok=false
 *       "reason=kernel said \"no\""` exits 0 and appends exactly
 *       `{"kind":"refold","ok":false,"reason":"kernel said \"no\""}\n`
 *       (`false` bare, the embedded double quote escaped as `\"`); every one
 *       of the file's three lines parses with `JSON.parse`, and the file's
 *       first two lines (leg (a)'s) are byte-identical to what leg (a) left.
 *       A second, fresh file proves M2's own "two calls leave two lines, the
 *       first untouched": the same `event-row … refold …` command run twice
 *       against an empty file leaves exactly two lines, and the bytes the
 *       file held after the first call are an unchanged prefix of what it
 *       holds after the second.
 *   (c) [M3, Proof leg c] `bash factory/boot.sh` with no argument at all
 *       exits 2, writes nothing to stdout, and writes a non-empty usage line
 *       to stderr; `bash -n factory/boot.sh` exits 0.
 *
 * What this file assumes about the code under test: that `event-row` is
 * reachable as a `case "${1:-}"` arm of `factory/boot.sh`'s own dispatch (the
 * same dispatch `boot`, `kata-ids` and `kata-task-uids` already sit in) — so
 * it is invoked here exactly as the Machine clauses spell it, as
 * `bash factory/boot.sh event-row <file> <kind> [key=value ...]`, in a bare
 * child process with no other setup. Because a `key=value` argument may
 * itself carry spaces or a literal double quote (`what=task 3`,
 * `reason=kernel said "no"`), this file passes each as one element of the
 * `spawnSync` argv array — never through a shell string — which is the exact
 * per-argument text a quoted shell word like `what='task 3'` would also
 * deliver, without this file having to depend on the host's shell-quoting
 * rules to prove it. No process this file starts is asked to reach outside
 * the temp directories it makes for itself, so `env: simEnv()` — never
 * `process.env` — is all any spawn here needs.
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { simEnv } from './_helpers.mjs'

const REPO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const BOOT_SH = path.join(REPO_DIR, 'factory', 'boot.sh')

const freshDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'boot-rows-'))

/** One `bash factory/boot.sh <args...>` child, argv passed as an array — never a shell string. */
const runBoot = (args) => spawnSync('bash', [BOOT_SH, ...args], { encoding: 'utf8', env: simEnv() })

// ── (a) [M1, Proof leg a] ────────────────────────────────────────────────

const legADir = freshDir()
const legAFile = path.join(legADir, 'events.jsonl')
assert.equal(fs.existsSync(legAFile), false, '(a) setup: the target file does not exist yet')

let res = runBoot(['event-row', legAFile, 'board:close', 'what=run', 'code=200'])
assert.equal(res.status, 0,
  '(a) [M1] `event-row <absent file> board:close what=run code=200` exits 0; got ' +
  JSON.stringify({ status: res.status, stderr: res.stderr }))
const EXPECT_1 = '{"kind":"board:close","what":"run","code":200}\n'
assert.equal(fs.readFileSync(legAFile, 'utf8'), EXPECT_1,
  '(a) [M1] the absent file is created and its bytes are exactly the one line, integer `200` written bare')

res = runBoot(['event-row', legAFile, 'board:close', 'what=task 3', 'code=null', 'skipped=no kata.json'])
assert.equal(res.status, 0,
  '(a) [M1] the second `event-row` call, appending to an existing file, exits 0; got ' +
  JSON.stringify({ status: res.status, stderr: res.stderr }))
const EXPECT_2 = EXPECT_1 + '{"kind":"board:close","what":"task 3","code":null,"skipped":"no kata.json"}\n'
assert.equal(fs.readFileSync(legAFile, 'utf8'), EXPECT_2,
  '(a) [M1] the second call APPENDS exactly its own line — the word `null` written bare, ' +
  'the string values `"task 3"` and `"no kata.json"` written quoted — and the first line is kept')

// M1's other bare word, `true`, on its own isolated file so it cannot perturb legs (a)/(b)'s byte checks.
const legATrueDir = freshDir()
const legATrueFile = path.join(legATrueDir, 'events.jsonl')
res = runBoot(['event-row', legATrueFile, 'some:kind', 'flag=true'])
assert.equal(res.status, 0, '(a) [M1] `event-row` with a `true` value exits 0')
assert.equal(fs.readFileSync(legATrueFile, 'utf8'), '{"kind":"some:kind","flag":true}\n',
  '(a) [M1] the word `true` is written bare, like `null` and an integer, not quoted as a string')

// ── (b) [M2, Proof leg b] ────────────────────────────────────────────────

// Continuing on leg (a)'s file, which already holds the two M1 lines.
res = runBoot(['event-row', legAFile, 'refold', 'ok=false', 'reason=kernel said "no"'])
assert.equal(res.status, 0,
  '(b) [M2] `event-row <file> refold ok=false reason=\'kernel said "no"\'` exits 0; got ' +
  JSON.stringify({ status: res.status, stderr: res.stderr }))
const EXPECT_3_LINE = '{"kind":"refold","ok":false,"reason":"kernel said \\"no\\""}\n'
const afterRefold = fs.readFileSync(legAFile, 'utf8')
assert.equal(afterRefold, EXPECT_2 + EXPECT_3_LINE,
  '(b) [M2] the call appends exactly its own line — `false` written bare, the embedded `"` escaped as `\\"` ' +
  '— and leg (a)\'s two lines are byte-unchanged ahead of it')

const linesAfterRefold = afterRefold.split('\n').filter((l) => l.length > 0)
assert.equal(linesAfterRefold.length, 3,
  '(b) [M2] the file now holds three lines: leg (a)\'s two plus this call\'s one')
for (const line of linesAfterRefold) {
  assert.doesNotThrow(() => JSON.parse(line), `(b) [M2] every line of the file parses with JSON.parse: ${line}`)
}
assert.equal(afterRefold.slice(0, EXPECT_2.length), EXPECT_2,
  '(b) [M2] the earlier lines are byte-unchanged after the refold row is appended')

// M2's own "two calls leave two lines, the first untouched", on a fresh file.
const legBDir = freshDir()
const legBFile = path.join(legBDir, 'events.jsonl')
runBoot(['event-row', legBFile, 'refold', 'ok=false', 'reason=kernel said "no"'])
const afterFirstCall = fs.readFileSync(legBFile, 'utf8')
assert.equal(afterFirstCall, EXPECT_3_LINE,
  '(b) [M2] setup: the first of the two calls writes exactly the one refold line')
runBoot(['event-row', legBFile, 'refold', 'ok=false', 'reason=kernel said "no"'])
const afterSecondCall = fs.readFileSync(legBFile, 'utf8')
const linesAfterTwoCalls = afterSecondCall.split('\n').filter((l) => l.length > 0)
assert.equal(linesAfterTwoCalls.length, 2,
  '(b) [M2] two calls of the same `event-row … refold …` command leave exactly two lines')
assert.equal(afterSecondCall.slice(0, afterFirstCall.length), afterFirstCall,
  '(b) [M2] the first line is untouched by the second call')

// ── (c) [M3, Proof leg c] ────────────────────────────────────────────────

res = runBoot([])
assert.equal(res.status, 2, '(c) [M3] `bash factory/boot.sh` with no argument exits 2; got ' + res.status)
assert.equal(res.stdout, '', '(c) [M3] the no-argument invocation writes nothing to stdout; got ' + JSON.stringify(res.stdout))
assert.ok(typeof res.stderr === 'string' && res.stderr.length > 0,
  '(c) [M3] the no-argument invocation prints a non-empty usage line on stderr; got ' + JSON.stringify(res.stderr))

const syntaxCheck = spawnSync('bash', ['-n', BOOT_SH], { encoding: 'utf8', env: simEnv() })
assert.equal(syntaxCheck.status, 0,
  '(c) [M3] `bash -n factory/boot.sh` exits 0; got ' + JSON.stringify({ status: syntaxCheck.status, stderr: syntaxCheck.stderr }))

console.log('ALL TESTS PASSED')
