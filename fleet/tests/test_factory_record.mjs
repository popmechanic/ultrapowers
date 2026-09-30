/**
 * fleet/tests/test_factory_record.mjs — the exam for "the run's status page and
 * pull request body are rendered by `factory/record.mjs`, and the publish policy
 * is read fail-closed by `factory/publish.mjs`".
 *
 * `record.mjs`'s CLI is driven as a child process exactly the way `factory/boot.sh`
 * drives `status`; the policy read is called in-process. The rows, payloads and
 * `publish.json` the publish writes are its own JSON since #1441, and their shapes
 * are measured end to end by `test_factory_boot.mjs` (the merge PUT byte-equal,
 * the row kinds in order) and `test_factory_publish.mjs` (every probe case).
 *
 * Legs, each naming the Machine clause it comes from:
 *
 *   (b) [M2] `status key=value ... --events <file>` prints the twelve-cell
 *       page in exactly the pinned key order with `tasks` last; the five
 *       optional cells given empty on the command line come back `null`;
 *       `updatedAt` is a non-empty
 *       string; `tasks` is the two-row projection M2 pins over an events file
 *       holding a `landing` and a `parked` row, and is `{}` over a path that
 *       does not exist.
 *   (c) [M3] `pr-body <plan.md> --events <file>` is byte-equal, over the
 *       fixture plan and one `landing` row, to the paragraph, a blank line,
 *       the one table row, a blank line and `Closes #1222`; and, over a plan
 *       with no `**Closes:**` line and no events file, to the paragraph
 *       followed by two blank lines and nothing else.
 *   (d) [M4] `publishPolicy` over the repo's own `factory/policy.json` reads
 *       both cells enabled with their bounds; over cells carrying no `enabled`
 *       key, and over a path that does not exist, both read disabled with the
 *       defaults (3 refolds, 120 s, 600 s).
 *
 * Every spawn gets `env: simEnv({ home })` (`test_sims_are_hermetic.mjs` names
 * any spawn whose `env` is not derived from `simEnv`). Every fixture — the plan
 * files, the events files, the policy files — is written under a fresh
 * `fs.mkdtempSync` directory, never a string-literal absolute path.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

import { simEnv } from './_helpers.mjs'
import { publishPolicy } from '../../factory/publish.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const RECORD_MJS = path.resolve(HERE, '../../factory/record.mjs')
const POLICY_JSON = path.resolve(HERE, '../../factory/policy.json')

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'record-exam-home-'))
const FIXTURES = fs.mkdtempSync(path.join(os.tmpdir(), 'record-exam-fixtures-'))

/** Runs `node record.mjs <args>`, never throwing on a non-zero exit — every
 *  case in this exam wants to read the exit code itself. */
function run (args) {
  const res = spawnSync(process.execPath, [RECORD_MJS, ...args], {
    encoding: 'utf8',
    env: simEnv({ home: HOME }),
  })
  return { status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' }
}

/** The non-empty, newline-split lines of `text`. */
function lines (text) {
  return text.split('\n').filter((l) => l !== '')
}

// ── b. [M2] `status key=value ... --events <file>` ─────────────────────────
{
  const STATUS_KEYS = [
    'run', 'state', 'phase', 'pr', 'prAuthor', 'merged',
    'branch', 'vm', 'startedAt', 'updatedAt', 'error', 'tasks',
  ]

  const eventsFile = path.join(FIXTURES, 'status-events.jsonl')
  fs.writeFileSync(
    eventsFile,
    JSON.stringify({ kind: 'landing', task: 1 }) + '\n' +
    JSON.stringify({ kind: 'parked', task: 2, reason: 'r' }) + '\n'
  )

  const r = run([
    'status',
    'run=5', 'state=done', 'phase=p',
    'pr=', 'prAuthor=', 'merged=',
    'branch=b', 'vm=', 'startedAt=s', 'error=',
    '--events', eventsFile,
  ])
  assert.equal(r.status, 0, '(b) [M2] status exits 0')
  const outLines = lines(r.stdout)
  assert.equal(outLines.length, 1, '(b) [M2] status prints exactly one line')
  const status = JSON.parse(outLines[0])

  assert.deepEqual(
    Object.keys(status), STATUS_KEYS,
    '(b) [M2] the twelve keys are exactly, and in exactly, the pinned order with tasks last'
  )

  for (const key of ['pr', 'prAuthor', 'merged', 'vm', 'error']) {
    assert.equal(status[key], null, `(b) [M2] ${key} is exactly null`)
  }
  assert.equal(typeof status.updatedAt, 'string', '(b) [M2] updatedAt is a string')
  assert.ok(status.updatedAt.length > 0, '(b) [M2] updatedAt is non-empty')

  const expectedTasks = {
    '1': { state: 'folded', park: null },
    '2': { state: 'failed', park: 'r' },
  }
  assert.deepEqual(
    status.tasks, expectedTasks,
    '(b) [M2] tasks is exactly the projection: task 1 folded/park null, task 2 failed/park "r"'
  )

  assert.equal(status.run, '5', '(b) [M2] run is the given string')
  assert.equal(status.state, 'done', '(b) [M2] state is the given string')
  assert.equal(status.phase, 'p', '(b) [M2] phase is the given string')
  assert.equal(status.branch, 'b', '(b) [M2] branch is the given string')
  assert.equal(status.startedAt, 's', '(b) [M2] startedAt is the given string')

  // tasks is {} over an events file that does not exist.
  const missingEvents = path.join(FIXTURES, 'no-such-events.jsonl')
  const r2 = run([
    'status',
    'run=5', 'state=done', 'phase=p',
    'pr=', 'prAuthor=', 'merged=',
    'branch=b', 'vm=', 'startedAt=s', 'error=',
    '--events', missingEvents,
  ])
  assert.equal(r2.status, 0, '(b) [M2] status over a missing --events file still exits 0')
  const status2 = JSON.parse(lines(r2.stdout)[0])
  assert.deepEqual(status2.tasks, {}, '(b) [M2] tasks is exactly {} over a path that does not exist')
}

// ── c. [M3] `pr-body <plan.md> --events <file>` ─────────────────────────────
{
  const PARAGRAPH = 'One widget, one size. It exists so the boot has a plan to carry. It benefits the record.'

  const planWithClosesText = [
    '# A widget that answers its size',
    '',
    '**Claim:** After this run a widget answers its size. (elicited)',
    '**Summary:** ' + PARAGRAPH,
    '',
    '**Goal:** the fixture plan a boot exam carries.',
    '**Closes:** #1222',
    '',
    '### Task 1: The widget answers its size',
    '',
  ].join('\n')
  const planWithCloses = path.join(FIXTURES, 'plan-with-closes.md')
  fs.writeFileSync(planWithCloses, planWithClosesText)

  const planNoClosesText = [
    '# A widget that answers its size',
    '',
    '**Claim:** After this run a widget answers its size. (elicited)',
    '**Summary:** ' + PARAGRAPH,
    '',
    '**Goal:** the fixture plan a boot exam carries.',
    '',
    '### Task 1: The widget answers its size',
    '',
  ].join('\n')
  const planNoCloses = path.join(FIXTURES, 'plan-no-closes.md')
  fs.writeFileSync(planNoCloses, planNoClosesText)

  const landingEvents = path.join(FIXTURES, 'pr-body-events.jsonl')
  fs.writeFileSync(
    landingEvents,
    JSON.stringify({ kind: 'landing', task: 1, candidateSha: 'abc' }) + '\n'
  )

  const r1 = run(['pr-body', planWithCloses, '--events', landingEvents])
  assert.equal(r1.status, 0, '(c) [M3] pr-body over the fixture plan exits 0')
  const expected1 = PARAGRAPH + '\n\n\nCloses #1222\n'
  assert.equal(
    r1.stdout, expected1,
    '(c) [M3] with no edge row there is no receipt: pr-body is byte-equal to the paragraph, two blank lines, and Closes #1222'
  )

  const missingEvents = path.join(FIXTURES, 'no-such-pr-body-events.jsonl')
  const r2 = run(['pr-body', planNoCloses, '--events', missingEvents])
  assert.equal(r2.status, 0, '(c) [M3] pr-body over a plan with no Closes line and no events file exits 0')
  const expected2 = PARAGRAPH + '\n\n\n'
  assert.equal(
    r2.stdout, expected2,
    '(c) [M3] with no Closes line and no events file, pr-body is byte-equal to the paragraph plus two blank lines and nothing else'
  )
}

// ── d. [M4] the publish policy, read by `factory/publish.mjs` (#1441) ────────
{
  assert.deepEqual(
    publishPolicy(POLICY_JSON),
    { selfMerge: { enabled: true, maxRefolds: 3, waitSeconds: 120 }, probe: { enabled: true, timeoutSeconds: 600 } },
    "(d) [M4] the repo's own factory/policy.json: self_merge enabled, 3 refolds, 120 s; probe enabled, 600 s"
  )
  const noEnabledPath = path.join(FIXTURES, 'policy-no-enabled.json')
  fs.writeFileSync(noEnabledPath, JSON.stringify({
    publish: { self_merge: { max_refolds: 9, mergeable_wait_seconds: 9 }, probe: { timeout_seconds: 30 } },
  }))
  const disabled = { selfMerge: { enabled: false, maxRefolds: 3, waitSeconds: 120 }, probe: { enabled: false, timeoutSeconds: 600 } }
  assert.deepEqual(
    publishPolicy(noEnabledPath), disabled,
    '(d) [M4] cells with no "enabled" key read as disabled with the defaults — the whole read falls back, not just the missing key'
  )
  assert.deepEqual(
    publishPolicy(path.join(FIXTURES, 'no-such-policy.json')), disabled,
    '(d) [M4] a policy path that does not exist reads as disabled with the defaults'
  )
}

console.log('ALL TESTS PASSED')
