/**
 * fleet/tests/test_factory_record.mjs — the exam for "the boot's rows, status
 * page, pull request body and policy read are rendered by `factory/record.mjs`,
 * and the contract says what the body is".
 *
 * The claim: one small module renders every row the boot writes at the end of
 * a run, the status page it commits, the pull request body it posts and the
 * merge policy it reads — the shape of `factory/record.mjs`'s CLI, driven as a
 * child process exactly the way `factory/boot.sh` will drive it.
 *
 * Legs, each naming the Machine clause it comes from:
 *
 *   (a) [M1] `row <kind> [key=value ...]` prints one line whose keys are
 *       exactly `ts, kind, ...pairs-in-argument-order`, with a bare value
 *       (`null`/`true`/`false`/an integer) parsed to its JS type and anything
 *       else — including a value carrying a literal `"` — a JSON string.
 *   (b) [M2] `status key=value ... --events <file>` prints the thirteen-cell
 *       page in exactly the pinned key order with `tasks` last; the five
 *       optional cells given empty on the command line come back `null`
 *       alongside the always-`null` `disclosures`; `updatedAt` is a non-empty
 *       string; `tasks` is the two-row projection M2 pins over an events file
 *       holding a `landing` and a `parked` row, and is `{}` over a path that
 *       does not exist.
 *   (c) [M3] `pr-body <plan.md> --events <file>` is byte-equal, over the
 *       fixture plan and one `landing` row, to the paragraph, a blank line,
 *       the one table row, a blank line and `Closes #1222`; and, over a plan
 *       with no `**Closes:**` line and no events file, to the paragraph
 *       followed by two blank lines and nothing else.
 *   (d) [M4] `policy <policy.json>` over the repo's own `factory/policy.json`
 *       prints `1 3 120`; over a file whose `publish.self_merge` carries no
 *       `enabled` key, and over a path that does not exist, it prints
 *       `0 3 120`; every case exits 0.
 *
 * Every subcommand is driven with `execFileSync`/`spawnSync` over
 * `process.execPath` and the module's own path, `env: simEnv({ home })`
 * throughout (`test_sims_are_hermetic.mjs` names any spawn whose `env` is
 * not derived from `simEnv`). Every fixture — the plan files, the events
 * files, the policy files — is written under a fresh `fs.mkdtempSync`
 * directory, never a string-literal absolute path.
 *
 * Assumption this exam makes about the code under test: `factory/record.mjs`
 * exports nothing this exam calls in-process — every clause is measured
 * through its CLI, stdout and exit code, which is what the Machine text and
 * the Interfaces section both name. The module is resolved relative to this
 * file (`../../factory/record.mjs`) exactly as the task's own examiner note
 * requires.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

import { simEnv } from './_helpers.mjs'

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

// ── a. [M1] `row <kind> [key=value ...]` ───────────────────────────────────
{
  const r1 = run(['row', 'merge', 'code=405', 'reason=x"y'])
  assert.equal(r1.status, 0, "(a) [M1] `row merge code=405 reason=x\"y` exits 0")
  const out1 = lines(r1.stdout)
  assert.equal(out1.length, 1, '(a) [M1] exactly one line of stdout')
  const parsed1 = JSON.parse(out1[0])
  assert.deepEqual(
    Object.keys(parsed1), ['ts', 'kind', 'code', 'reason'],
    '(a) [M1] keys are exactly ts, kind, code, reason in that order'
  )
  assert.equal(typeof parsed1.ts, 'string', '(a) [M1] ts is a string')
  assert.ok(parsed1.ts.length > 0, '(a) [M1] ts is non-empty')
  assert.equal(parsed1.kind, 'merge', '(a) [M1] kind is exactly "merge"')
  assert.equal(parsed1.code, 405, '(a) [M1] code is the number 405 (bare: matches an integer)')
  assert.equal(parsed1.reason, 'x"y', '(a) [M1] reason is exactly the string x"y, quote included')

  const r2 = run(['row', 'board:leave', 'rc=0', 'ok=true', 'n=null'])
  assert.equal(r2.status, 0, '(a) [M1] `row board:leave rc=0 ok=true n=null` exits 0')
  const out2 = lines(r2.stdout)
  assert.equal(out2.length, 1, '(a) [M1] exactly one line of stdout')
  const parsed2 = JSON.parse(out2[0])
  assert.deepEqual(
    Object.keys(parsed2), ['ts', 'kind', 'rc', 'ok', 'n'],
    '(a) [M1] keys are exactly ts, kind, rc, ok, n in that order'
  )
  assert.equal(parsed2.kind, 'board:leave', '(a) [M1] kind is exactly "board:leave"')
  assert.equal(parsed2.rc, 0, '(a) [M1] rc=0 parses bare to the number 0')
  assert.equal(parsed2.ok, true, '(a) [M1] ok=true parses bare to the boolean true')
  assert.equal(parsed2.n, null, '(a) [M1] n=null parses bare to null')
}

// ── b. [M2] `status key=value ... --events <file>` ─────────────────────────
{
  const STATUS_KEYS = [
    'run', 'state', 'phase', 'pr', 'prAuthor', 'merged', 'disclosures',
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
    '(b) [M2] the thirteen keys are exactly, and in exactly, the pinned order with tasks last'
  )

  for (const key of ['pr', 'prAuthor', 'merged', 'vm', 'error', 'disclosures']) {
    assert.equal(status[key], null, `(b) [M2] ${key} is exactly null`)
  }
  assert.equal(typeof status.updatedAt, 'string', '(b) [M2] updatedAt is a string')
  assert.ok(status.updatedAt.length > 0, '(b) [M2] updatedAt is non-empty')

  const expectedTasks = {
    '1': { wave: null, state: 'folded', role: null, lastProof: null, park: null, attention: null, blockedBy: null },
    '2': { wave: null, state: 'failed', role: null, lastProof: null, park: 'r', attention: null, blockedBy: null },
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
    JSON.stringify({ kind: 'landing', task: 1, k: 1, factsExit: 0, candidateSha: 'abc' }) + '\n'
  )

  const r1 = run(['pr-body', planWithCloses, '--events', landingEvents])
  assert.equal(r1.status, 0, '(c) [M3] pr-body over the fixture plan exits 0')
  const expected1 = PARAGRAPH + '\n\n| 1 | 1 | 0 | abc |\n\nCloses #1222\n'
  assert.equal(
    r1.stdout, expected1,
    '(c) [M3] pr-body is byte-equal to the paragraph, a blank line, the one landing row, a blank line, and Closes #1222'
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

// ── d. [M4] `policy <policy.json>` ──────────────────────────────────────────
{
  const r1 = run(['policy', POLICY_JSON])
  assert.equal(r1.status, 0, "(d) [M4] policy over the repo's own factory/policy.json exits 0")
  assert.equal(
    r1.stdout, '1 3 120\n',
    "(d) [M4] policy over the repo's own factory/policy.json prints exactly '1 3 120\\n' (its publish.self_merge is enabled: true, max_refolds: 3, mergeable_wait_seconds: 120)"
  )

  const noEnabledPath = path.join(FIXTURES, 'policy-no-enabled.json')
  fs.writeFileSync(noEnabledPath, JSON.stringify({
    publish: { self_merge: { max_refolds: 9, mergeable_wait_seconds: 9 } },
  }))
  const r2 = run(['policy', noEnabledPath])
  assert.equal(r2.status, 0, '(d) [M4] policy over a self_merge object with no "enabled" key exits 0')
  assert.equal(
    r2.stdout, '0 3 120\n',
    '(d) [M4] policy over a self_merge object with no "enabled" key prints exactly \'0 3 120\\n\' — the whole read falls back, not just the missing key'
  )

  const missingPath = path.join(FIXTURES, 'no-such-policy.json')
  const r3 = run(['policy', missingPath])
  assert.equal(r3.status, 0, '(d) [M4] policy over a path that does not exist exits 0')
  assert.equal(
    r3.stdout, '0 3 120\n',
    "(d) [M4] policy over a path that does not exist prints exactly '0 3 120\\n'"
  )
}

// ── #1222 pass two: "The boot's exam drives the probe to `alive`, and the
//    boot hands its dead and misplaced pieces to their modules" — the two
//    payload subcommands `factory/record.mjs` gains so the boot no longer
//    builds either JSON body by hand (`json_escape`, gone from boot.sh).
// ────────────────────────────────────────────────────────────────────────

// ── e. [M5] `pr-payload title=… head=… base=… body=… draft=…` ──────────────
{
  // The frozen inputs Context 5 computed at BASE 2026-09-22 by running the
  // shell expression `publish` built at the time — five lines joined by
  // newline as the body, the middle line a landing row, the last carrying
  // one literal backslash.
  const frozenBody = [
    'One widget, one size.',
    '',
    '| 1 | 1 | 0 | abc |',
    '',
    'Closes #1222 back\\slash'
  ].join('\n')

  const r1 = run([
    'pr-payload',
    'title=fleet run-502: A widget that "answers" its size',
    'head=ultra/integration-run-502',
    'base=main',
    `body=${frozenBody}`,
    'draft=false'
  ])
  assert.equal(r1.status, 0, '(e) [M5] pr-payload over the frozen inputs exits 0')
  const expectedPrPayload = '{"title":"fleet run-502: A widget that \\"answers\\" its size",' +
    '"head":"ultra/integration-run-502","base":"main",' +
    '"body":"One widget, one size.\\n\\n| 1 | 1 | 0 | abc |\\n\\nCloses #1222 back\\\\slash",' +
    '"draft":false}'
  assert.equal(
    r1.stdout, expectedPrPayload + '\n',
    '(e) [M5] pr-payload prints exactly the frozen five-key JSON object (title, head, base, body, draft in that ' +
    'order, the four strings JSON-encoded, draft the bare boolean) plus a newline, byte-equal to what the shell ' +
    'expression printed at BASE — got ' + JSON.stringify(r1.stdout)
  )

  // draft is the boolean true ONLY when the token is exactly "draft=true" —
  // not on any other spelling, and never a string.
  const r2 = run(['pr-payload', 'title=t', 'head=h', 'base=b', 'body=x', 'draft=true'])
  assert.equal(r2.status, 0, '(e) [M5] pr-payload with draft=true exits 0')
  assert.equal(
    JSON.parse(r2.stdout).draft, true,
    '(e) [M5] draft=true parses to the boolean true'
  )
  const r3 = run(['pr-payload', 'title=t', 'head=h', 'base=b', 'body=x', 'draft=TRUE'])
  assert.equal(r3.status, 0, '(e) [M5] pr-payload with draft=TRUE exits 0')
  assert.equal(
    JSON.parse(r3.stdout).draft, false,
    '(e) [M5] draft=TRUE (not the exact token "draft=true") parses to the boolean false, not true'
  )
}

// ── f. [M5] `merge-payload title=… sha=…` ───────────────────────────────────
{
  const r1 = run([
    'merge-payload',
    'title=fleet run-502: A widget that "answers" its size (#7)',
    'sha=deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
  ])
  assert.equal(r1.status, 0, '(f) [M5] merge-payload over the frozen inputs exits 0')
  const expectedMergePayload = '{"merge_method":"squash",' +
    '"commit_title":"fleet run-502: A widget that \\"answers\\" its size (#7)",' +
    '"sha":"deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"}'
  assert.equal(
    r1.stdout, expectedMergePayload + '\n',
    '(f) [M5] merge-payload prints exactly the frozen three-key JSON object (merge_method, commit_title, sha ' +
    'in that order) plus a newline, byte-equal to what the shell expression printed at BASE — got ' +
    JSON.stringify(r1.stdout)
  )
}

// ── #835 pass three: "the boot deploys after its merge, checks the live URL,
//    rolls back on red, and records it" — `publish-policy` (the probe's
//    sibling read beside `policy`'s self-merge read) and the two subcommands
//    the boot's publish probe leans on so it builds no JSON by hand.
// ────────────────────────────────────────────────────────────────────────

// ── g. [M1] `publish-policy <policy.json>` ──────────────────────────────────
{
  const r1 = run(['publish-policy', POLICY_JSON])
  assert.equal(r1.status, 0, "(g) [M1] publish-policy over the repo's own factory/policy.json exits 0")
  assert.equal(
    r1.stdout, '1 600\n',
    "(g) [M1] publish-policy over the repo's own factory/policy.json prints exactly '1 600\\n' " +
    '(its publish.probe is enabled: true, timeout_seconds: 600)'
  )

  const noEnabledPath = path.join(FIXTURES, 'publish-policy-no-enabled.json')
  fs.writeFileSync(noEnabledPath, JSON.stringify({
    publish: { probe: { timeout_seconds: 30 } },
  }))
  const r2 = run(['publish-policy', noEnabledPath])
  assert.equal(r2.status, 0, '(g) [M1] publish-policy over a probe object with no "enabled" key exits 0')
  assert.equal(
    r2.stdout, '0 600\n',
    '(g) [M1] publish-policy over a probe object with no "enabled" key prints exactly \'0 600\\n\' — ' +
    'the whole read falls back, not just the missing key'
  )

  const missingPath = path.join(FIXTURES, 'no-such-publish-policy.json')
  const r3 = run(['publish-policy', missingPath])
  assert.equal(r3.status, 0, '(g) [M1] publish-policy over a path that does not exist exits 0')
  assert.equal(
    r3.stdout, '0 600\n',
    "(g) [M1] publish-policy over a path that does not exist prints exactly '0 600\\n'"
  )

  // The sibling self-merge read is untouched by the new cell.
  const r4 = run(['policy', POLICY_JSON])
  assert.equal(
    r4.stdout, '1 3 120\n',
    "(g) [M1] policy still prints '1 3 120\\n' over the repo's own factory/policy.json"
  )
}

// ── h. [M2–M4] `publish-cmds` (stdin) and `publish-json` ────────────────────
{
  const r1 = spawnSync(process.execPath, [RECORD_MJS, 'publish-cmds'], {
    encoding: 'utf8',
    env: simEnv({ home: HOME }),
    input: JSON.stringify({
      publish: {
        deploy: 'bun run --cwd server deploy',
        verify: 'bun server/probe/converge-live.ts $ULTRA_PUBLISH_URL',
        rollback: 'bunx --cwd server wrangler rollback --yes',
      },
    }),
  })
  assert.equal(r1.status, 0, '(h) [M2] publish-cmds over a full publish object exits 0')
  assert.equal(
    r1.stdout,
    'bun run --cwd server deploy\nbun server/probe/converge-live.ts $ULTRA_PUBLISH_URL\nbunx --cwd server wrangler rollback --yes\n',
    `(h) [M2] publish-cmds prints the deploy, verify and rollback commands, one per line — got ${JSON.stringify(r1.stdout)}`
  )

  const r2 = spawnSync(process.execPath, [RECORD_MJS, 'publish-cmds'], {
    encoding: 'utf8',
    env: simEnv({ home: HOME }),
    input: JSON.stringify({ publish: null }),
  })
  assert.equal(r2.status, 0, '(h) [M5] publish-cmds over a null publish exits 0')
  assert.equal(
    r2.stdout, '\n\n\n',
    `(h) [M5] publish-cmds over a null publish prints three empty lines — got ${JSON.stringify(r2.stdout)}`
  )

  const r3 = run([
    'publish-json',
    'url=https://fixture.example.workers.dev', 'published=true',
    'deployCmd=bun run --cwd server deploy', 'deployExit=0', 'deployMs=1200',
    'verifyCmd=bun server/probe/converge-live.ts https://fixture.example.workers.dev', 'verifyExit=0', 'verifyMs=300',
  ])
  assert.equal(r3.status, 0, '(h) [M2] publish-json for the green case exits 0')
  assert.deepEqual(
    JSON.parse(r3.stdout),
    {
      url: 'https://fixture.example.workers.dev',
      published: true,
      deploy: { cmd: 'bun run --cwd server deploy', exit: 0, ms: 1200 },
      verify: { cmd: 'bun server/probe/converge-live.ts https://fixture.example.workers.dev', exit: 0, ms: 300 },
      rollback: null,
    },
    '(h) [M2] publish-json for the green case is exactly url, published true, deploy, verify, rollback null'
  )

  const r4 = run([
    'publish-json',
    'url=https://fixture.example.workers.dev', 'published=false',
    'deployCmd=bun run --cwd server deploy', 'deployExit=0', 'deployMs=1200',
    'verifyCmd=bun server/probe/converge-live.ts https://fixture.example.workers.dev', 'verifyExit=1', 'verifyMs=300',
    'rollbackCmd=bunx --cwd server wrangler rollback --yes', 'rollbackExit=0',
  ])
  assert.equal(r4.status, 0, '(h) [M3] publish-json for the red/rolled-back case exits 0')
  assert.deepEqual(
    JSON.parse(r4.stdout),
    {
      url: 'https://fixture.example.workers.dev',
      published: false,
      deploy: { cmd: 'bun run --cwd server deploy', exit: 0, ms: 1200 },
      verify: { cmd: 'bun server/probe/converge-live.ts https://fixture.example.workers.dev', exit: 1, ms: 300 },
      rollback: { cmd: 'bunx --cwd server wrangler rollback --yes', exit: 0 },
    },
    '(h) [M3] publish-json for the red/rolled-back case carries a rollback object with cmd and exit only'
  )

  const r5 = run([
    'publish-json',
    'url=null', 'published=false',
    'deployCmd=bun run --cwd server deploy', 'deployExit=1', 'deployMs=50',
  ])
  assert.equal(r5.status, 0, '(h) [M4] publish-json for the deploy-failed case exits 0')
  assert.deepEqual(
    JSON.parse(r5.stdout),
    {
      url: null,
      published: false,
      deploy: { cmd: 'bun run --cwd server deploy', exit: 1, ms: 50 },
      verify: null,
      rollback: null,
    },
    '(h) [M4] publish-json for the deploy-failed case is url null, verify null, rollback null'
  )
}

console.log('ALL TESTS PASSED')
