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

function run (args) {
  const res = spawnSync(process.execPath, [RECORD_MJS, ...args], {
    encoding: 'utf8',
    env: simEnv({ home: HOME }),
  })
  return { status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' }
}

function lines (text) {
  return text.split('\n').filter((l) => l !== '')
}

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

{
  const F = '```'
  const PROBE = '{"clause":"S1.1","do":[{"click":{"name":"Add","role":"button"}}],"expect":[{"unchanged":true}],"given":[],"holds_before":true,"judge":null,"layer":"ui","see":[{"count":1,"name":"Add","role":"button"}]}'
  const storiesPlan = path.join(FIXTURES, 'stories-plan.md')
  fs.writeFileSync(storiesPlan, `# Sim plan

**Grammar:** stories-v1
**Stack:** tinyapp
**Plan-id:** p1
**Kind:** behaviour
**Summary:** One. Two. Three.
**Store:** \`store.js\` sha256:${'0'.repeat(64)}

## Stories

- S1: You add a note; it shows.

### Task 1: The note piece

**Piece:** note
**Depends-on-pieces:** none

**Files:**
- Create: \`client/src/pieces/note.json\`

**Purpose:** Keep notes.

**Stories:**
- S1: You add a note; it shows.

**Proof:**
${F}probe
${PROBE}
${F}
`)
  const edgeEvents = path.join(FIXTURES, 'edge-events.jsonl')
  fs.writeFileSync(edgeEvents, JSON.stringify({ kind: 'edge', snap: 1, perTask: { 1: [0, 1] }, check: 0 }) + '\n')
  const r = run(['pr-body', storiesPlan, '--events', edgeEvents])
  assert.equal(r.status, 0, '(e) pr-body over a stories-v1 plan with an edge row exits 0')
  assert.deepEqual(
    lines(r.stdout).filter((l) => l.startsWith('| 1 |')),
    ['| 1 | `story checker` | S1.1 | 0 |', '| 1 | `screens check` | — | 1 |'],
    '(e) the exit after the task probes is the screens check, a Receipt row of its own'
  )
}

{
  const plan = path.join(FIXTURES, 'plan-fallback.md')
  fs.writeFileSync(plan, '# A widget\n\n**Summary:** One. Two. Three.\n\n### Task 1: The widget\n')
  const fb = { kind: 'loose:fallback', snap: 3, why: 'the cleanup went red' }
  const killed = path.join(FIXTURES, 'fallback-no-terminal.jsonl')
  fs.writeFileSync(killed, JSON.stringify(fb) + '\n')
  const r1 = run(['pr-body', plan, '--events', killed])
  assert.equal(r1.status, 0, '(f) pr-body over a fallback row with no terminal row exits 0')
  assert.ok(lines(r1.stdout).includes('The run ended before its outcome was recorded.'),
    `(f) with no terminal row the body says the run ended before its outcome was recorded: ${r1.stdout}`)
  assert.ok(!r1.stdout.includes('itself drafted'), '(f) with no terminal row the body does not say the fallback was drafted')
  const drafted = path.join(FIXTURES, 'fallback-drafted.jsonl')
  fs.writeFileSync(drafted, [fb, { kind: 'terminal', pr: 'draft', snap: 3, why: 'check red' }].map((x) => JSON.stringify(x)).join('\n') + '\n')
  const r2 = run(['pr-body', plan, '--events', drafted])
  assert.ok(lines(r2.stdout).includes("The cleanup's fallback was itself drafted: check red."),
    `(f) with a draft terminal row the body names its reason: ${r2.stdout}`)
}

{
  assert.deepEqual(
    publishPolicy(POLICY_JSON),
    { selfMerge: { maxCatchups: 3, waitSeconds: 120 }, probe: { enabled: true, timeoutSeconds: 600 } },
    "(d) [M4] the repo's own factory/policy.json: 3 catch-ups, 120 s; probe enabled, 600 s"
  )
  const noEnabledPath = path.join(FIXTURES, 'policy-no-enabled.json')
  fs.writeFileSync(noEnabledPath, JSON.stringify({
    publish: { self_merge: { max_catchups: 9, mergeable_wait_seconds: 9 }, probe: { timeout_seconds: 30 } },
  }))
  assert.deepEqual(
    publishPolicy(noEnabledPath), { selfMerge: { maxCatchups: 9, waitSeconds: 9 }, probe: { enabled: false, timeoutSeconds: 600 } },
    '(d) [M4] a probe cell with no "enabled" key reads as disabled with the default budget; the self-merge bounds are the cell\'s'
  )
  assert.deepEqual(
    publishPolicy(path.join(FIXTURES, 'no-such-policy.json')), { selfMerge: { maxCatchups: 3, waitSeconds: 120 }, probe: { enabled: false, timeoutSeconds: 600 } },
    '(d) [M4] a policy path that does not exist reads as disabled with the defaults'
  )
}

console.log('ALL TESTS PASSED')
