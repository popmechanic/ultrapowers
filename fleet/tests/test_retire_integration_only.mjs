/**
 * fleet/tests/test_retire_integration_only.mjs — the exam for "Retiring a
 * product repository's leftovers deletes only the run pull-request branches
 * that were closed without merging" (#1395).
 *
 * Legs, each naming the Machine clause it comes from:
 *
 *   (a) [M1] a listing carrying `ultra/plan-run-3`, `ultra/evidence-run-3` and
 *       `ultra/integration-run-3`, the last with one closed unmerged pull
 *       request — `retire` issues exactly one mutating call, the DELETE of the
 *       integration branch: no tag POST, no PATCH, no plan or evidence DELETE.
 *
 * The rig is a recording exec stub: it answers the one `git ls-remote` and the
 * `pulls?state=all&head=` read, records every call, and opens no socket.
 */

import assert from 'node:assert/strict'

import { retire } from '../retire.mjs'

const SHA = (c) => c.repeat(40)

function recordingExec () {
  const calls = []
  const exec = async (cmd, args) => {
    calls.push([cmd, ...args])
    if (cmd === 'git' && args[0] === 'ls-remote') {
      return {
        code: 0,
        stdout: [
          `${SHA('a')}\trefs/heads/ultra/plan-run-3`,
          `${SHA('b')}\trefs/heads/ultra/evidence-run-3`,
          `${SHA('c')}\trefs/heads/ultra/integration-run-3`
        ].join('\n') + '\n',
        stderr: ''
      }
    }
    if (cmd === 'gh' && args[0] === 'api' && args.length === 2 &&
        args[1] === 'repos/o/r/pulls?state=all&head=o:ultra/integration-run-3') {
      return {
        code: 0,
        stdout: JSON.stringify([{ number: 12, state: 'closed', merged_at: null, body: '' }]),
        stderr: ''
      }
    }
    if (cmd === 'gh' && args.includes('-X')) return { code: 0, stdout: '{}', stderr: '' }
    return { code: 1, stdout: '', stderr: 'unexpected call' }
  }
  return { exec, calls }
}

const isMutating = (call) => call[0] === 'gh' && call.includes('-X') &&
  call[call.indexOf('-X') + 1] !== 'GET'

// ── (a) [M1] ─────────────────────────────────────────────────────────────────
{
  const { exec, calls } = recordingExec()
  const result = await retire({ argv: ['--target', 'o/r'], exec })

  const mutating = calls.filter(isMutating)
  assert.deepEqual(
    mutating,
    [['gh', 'api', '-X', 'DELETE', 'repos/o/r/git/refs/heads/ultra/integration-run-3']],
    '(a) [M1] exactly one mutating call, the DELETE of the integration branch'
  )
  assert.ok(!calls.some((c) => c.includes('POST')), '(a) [M1] no tag POST')
  assert.ok(!calls.some((c) => c.includes('PATCH')), '(a) [M1] no PATCH of a pull request')
  assert.ok(
    !calls.some((c) => c.some((a) => /plan-run-3|evidence-run-3/.test(String(a)))),
    '(a) [M1] nothing names the plan or evidence branch'
  )
  const listings = calls.filter((c) => c[0] === 'git' && c[1] === 'ls-remote')
  assert.equal(listings.length, 1, '(a) [M1] one ls-remote listing')
  assert.deepEqual(result.deleted, [3], '(a) [M1] run 3 is the one deleted')
  assert.deepEqual(
    result.lines,
    ['run 3: ultra/integration-run-3 deleted — PR #12 closed, not merged'],
    '(a) [M1] one line for the run'
  )
}

// ── (a) under --dry-run: the same read, and nothing mutated ──────────────────
{
  const { exec, calls } = recordingExec()
  const result = await retire({ argv: ['--target', 'o/r', '--dry-run'], exec })
  assert.deepEqual(calls.filter(isMutating), [], '(a) --dry-run mutates nothing')
  assert.deepEqual(
    result.lines,
    ['run 3: would delete ultra/integration-run-3 — PR #12 closed, not merged'],
    '(a) --dry-run says what it would do'
  )
}

console.log('ALL TESTS PASSED')
