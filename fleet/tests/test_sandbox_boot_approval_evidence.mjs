/**
 * Exam for the approval receipts on the evidence branch: the record pushed to
 * `ultra/evidence-run-<N>` shows THAT the run was approved and HOW.
 *
 * Two files answer that question and neither rides the branch at BASE:
 * `approve-receipt.json` — `run-main.mjs` writes it into the run directory once
 * `ultra_gate.py --approve` has succeeded — and `standing-approval.json`, the
 * pre-authorization record written beside it. `collect_evidence()` copies the
 * gate receipt, `report.json`, `events.jsonl`, `receipt.json`, the engine log
 * and `status.json`; the two approvals are dropped on the box with the VM. And
 * the `done` status page says only the PR URL, so a reader of the branch cannot
 * tell a PASS from a run the two-move rule greened.
 *
 * The clauses this file pins:
 *
 *   M1 / legs (a)(b)  `collect_evidence` copies each of the two files from the
 *                     run directory into `.ultrapowers/runs/<N>/` on the
 *                     evidence worktree when it is present, BYTE FOR BYTE, and
 *                     a run that wrote neither commits neither.
 *   M2 / leg (c)      the `done` status's `phase` carries the PR URL and, after
 *                     it, `verdict=PASS`, or `approved by the two-move rule`
 *                     when a `NEEDS_ACK` verdict was greened by an
 *                     `approve-receipt.json`.
 *   M3                `fleet/CONTRACT.md`'s `ultra/evidence-run-<N>` bullet
 *                     names both files with the words `present when the engine
 *                     wrote them`. The Proof's own `sed`+`grep` is this
 *                     clause's other half; the test below reads the same bullet.
 *
 * The rig is `_sandbox_boot_helpers.mjs` — the stub bin dir, `makeHome`,
 * `boot`, `statusOf`, `evidenceDir` and `runTests` — shared with
 * `test_sandbox_boot.mjs` and `test_sandbox_boot_approved.mjs`. The one thing
 * that rig cannot do is leave an approval behind, so `approvalHome()` extends
 * its engine stub with exactly those two writes, at the paths
 * `fleet/run-main.mjs` writes them to and nowhere else. The bytes are this
 * file's own, so byte-equality is a real comparison and not two empty files
 * agreeing.
 *
 * A boot is ~40 forks of stub shell, so each of the three runs is booted once
 * and memoized; the legs read the same three runs.
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  SCRIPT, PR_URL, RUN_PATH,
  STUBS, PRELUDE, makeHome, boot,
  statusOf, evidenceDir,
  runTests,
} from './_sandbox_boot_helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CONTRACT = path.join(HERE, '..', 'CONTRACT.md')

const tests = []
const test = (name, fn) => tests.push([name, fn])

// ── the rig: an engine that leaves its approvals behind ──────────────────────

/** The last line of the shared engine stub — where the extension is spliced. */
const ENGINE_EXIT = 'exit ${STUB_ENGINE_CODE:-0}'

/**
 * The two writes `run-main.mjs` makes into `runDir`: `approve-receipt.json`
 * (the verbatim stdout of `ultra_gate.py --approve`) and
 * `standing-approval.json` (the pre-authorization record). The stub writes
 * whatever bytes the case hands it, into the run directory and nowhere else.
 */
const APPROVAL_SNIPPET = `
if [ -n "\${STUB_APPROVE_BYTES:-}" ]; then
  printf '%s' "$STUB_APPROVE_BYTES" >"$run_dir/approve-receipt.json"
fi
if [ -n "\${STUB_STANDING_BYTES:-}" ]; then
  printf '%s' "$STUB_STANDING_BYTES" >"$run_dir/standing-approval.json"
fi
`

/** Distinct, non-empty, non-trivial bytes — a copy that truncated, re-encoded
 *  or re-serialized them is not "byte for byte". */
const APPROVE_BYTES = '{\n  "stamp": "run-7",\n  "verdict": "PASS",\n  "acks": ["#649"]\n}\n'
const STANDING_BYTES =
  '{\n  "grantedAt": "launch directive",\n  "ackList": ["#649", "#650"]\n}\n'

/** The engine's run directory — where both files are written and read back
 *  from, so a green leg (a) cannot be a rig that quietly wrote nothing. */
const runDir = (ctx) => path.join(ctx.home, 'target', '.claude', 'ultrapowers', 'run-run-7')
/** The run's record on the evidence worktree — what the branch will carry. */
const evidenceRunDir = (ctx) => path.join(evidenceDir(ctx), RUN_PATH)

function approvalHome() {
  const ctx = makeHome()
  const body = STUBS['systemd-run']
  assert.ok(body.includes(ENGINE_EXIT),
    `the shared engine stub no longer ends in '${ENGINE_EXIT}' — this sim's splice is stale`)
  const file = path.join(ctx.bin, 'systemd-run')
  fs.writeFileSync(file, PRELUDE + body.replace(ENGINE_EXIT, () => APPROVAL_SNIPPET + ENGINE_EXIT))
  fs.chmodSync(file, 0o755)
  return ctx
}

const BOOTED = new Map()
/** Boot one case once and keep it: the legs below ask several questions of
 *  each of the three runs. */
function run(name, env) {
  if (!BOOTED.has(name)) {
    const ctx = approvalHome()
    const r = boot(ctx, ['boot'], env)
    assert.equal(r.status, 0, `the ${name} run must boot to completion:\n${r.stdout}${r.stderr}`)
    BOOTED.set(name, ctx)
  }
  return BOOTED.get(name)
}

/** NEEDS_ACK greened by an approve receipt — the two-move rule's run. */
const approvedRun = () =>
  run('approved', { STUB_VERDICT: 'NEEDS_ACK', STUB_APPROVE_BYTES: APPROVE_BYTES })
/** PASS, with the pre-authorization record beside the receipts. */
const standingRun = () =>
  run('standing', { STUB_VERDICT: 'PASS', STUB_STANDING_BYTES: STANDING_BYTES })
/** PASS with neither approval file — a run the engine never had to approve. */
const bareRun = () => run('bare', { STUB_VERDICT: 'PASS' })

const read = (file) => fs.readFileSync(file)

test('the boot script parses  [rig]', () => {
  assert.equal(spawnSync('bash', ['-n', SCRIPT]).status, 0)
})

// ── (a) each approval that was written is committed, byte for byte  [M1] ─────

test('the approve receipt reaches the evidence worktree byte for byte  [M1 / leg (a)]', () => {
  const ctx = approvedRun()
  const source = path.join(runDir(ctx), 'approve-receipt.json')
  const collected = path.join(evidenceRunDir(ctx), 'approve-receipt.json')

  // The rig left the approval where `run-main.mjs` leaves it.
  assert.ok(fs.existsSync(source), `the engine stub must write ${source}`)
  assert.equal(read(source).toString(), APPROVE_BYTES, 'the rig wrote the bytes it meant to')

  assert.ok(fs.existsSync(collected),
    'collect_evidence must copy approve-receipt.json into ' + RUN_PATH + ', got: ' +
      fs.readdirSync(evidenceRunDir(ctx)).join(' '))
  assert.deepEqual(read(collected), read(source),
    'the collected approve-receipt.json must be byte-equal to the run directory\'s')
  assert.equal(read(collected).toString(), APPROVE_BYTES)

  // This run wrote no standing approval, so the branch carries none: each file
  // is copied WHEN PRESENT, not conjured.
  assert.ok(!fs.existsSync(path.join(evidenceRunDir(ctx), 'standing-approval.json')),
    'a run that wrote no standing-approval.json commits none')
})

test('the standing approval reaches the evidence worktree byte for byte  [M1 / leg (a)]', () => {
  const ctx = standingRun()
  const source = path.join(runDir(ctx), 'standing-approval.json')
  const collected = path.join(evidenceRunDir(ctx), 'standing-approval.json')

  assert.ok(fs.existsSync(source), `the engine stub must write ${source}`)
  assert.equal(read(source).toString(), STANDING_BYTES, 'the rig wrote the bytes it meant to')

  assert.ok(fs.existsSync(collected),
    'collect_evidence must copy standing-approval.json into ' + RUN_PATH + ', got: ' +
      fs.readdirSync(evidenceRunDir(ctx)).join(' '))
  assert.deepEqual(read(collected), read(source),
    'the collected standing-approval.json must be byte-equal to the run directory\'s')
  assert.equal(read(collected).toString(), STANDING_BYTES)

  assert.ok(!fs.existsSync(path.join(evidenceRunDir(ctx), 'approve-receipt.json')),
    'a run that wrote no approve-receipt.json commits none')
})

// ── (b) a run that wrote neither commits neither  [M1] ───────────────────────

test('a PASS run that wrote neither approval commits neither  [M1 / leg (b)]', () => {
  const ctx = bareRun()
  const dir = evidenceRunDir(ctx)

  // The engine wrote no approval, at either of the two paths the boot script
  // knows about.
  for (const f of ['approve-receipt.json', 'standing-approval.json']) {
    assert.ok(!fs.existsSync(path.join(runDir(ctx), f)), `no ${f} was written for this run`)
  }

  // The evidence directory is the real one — the run's record is in it.
  assert.ok(fs.existsSync(path.join(dir, 'gate-receipt.json')),
    `${RUN_PATH}/gate-receipt.json must be collected — otherwise this leg reads the wrong directory`)
  assert.ok(fs.existsSync(path.join(dir, 'status.json')), `${RUN_PATH}/status.json must be collected`)

  for (const f of ['approve-receipt.json', 'standing-approval.json']) {
    assert.ok(!fs.existsSync(path.join(dir, f)),
      `${f} must not appear on the evidence branch of a run that never wrote it, got: ` +
        fs.readdirSync(dir).join(' '))
  }
})

// ── (c) the done page says how the run was approved  [M2] ────────────────────

/** What the `phase` cell says AFTER the PR URL, or null when it does not carry
 *  the URL at all. */
function afterPrUrl(phase) {
  const i = phase.indexOf(PR_URL)
  return i < 0 ? null : phase.slice(i + PR_URL.length)
}

test('the PASS run\'s done phase carries the PR URL and then verdict=PASS  [M2 / leg (c)]', () => {
  for (const ctx of [bareRun(), standingRun()]) {
    const status = statusOf(ctx)
    assert.equal(status.state, 'done', 'a PASS run ends done')
    const rest = afterPrUrl(status.phase)
    assert.ok(rest !== null,
      `the done phase must contain the PR URL ${PR_URL}, got: ${JSON.stringify(status.phase)}`)
    assert.ok(rest.includes('verdict=PASS'),
      'the done phase must say verdict=PASS after the PR URL, got: ' +
        JSON.stringify(status.phase))
  }
})

test('the approved NEEDS_ACK run\'s done phase carries the PR URL and then the two-move rule  [M2 / leg (c)]', () => {
  const ctx = approvedRun()
  const status = statusOf(ctx)
  assert.equal(status.state, 'done', 'a run greened by the two-move rule ends done')
  const rest = afterPrUrl(status.phase)
  assert.ok(rest !== null,
    `the done phase must contain the PR URL ${PR_URL}, got: ${JSON.stringify(status.phase)}`)
  assert.ok(rest.includes('approved by the two-move rule'),
    'the done phase of a NEEDS_ACK run greened by an approve-receipt.json must say ' +
      '`approved by the two-move rule` after the PR URL, got: ' + JSON.stringify(status.phase))
  assert.ok(!rest.includes('verdict=PASS'),
    'this run\'s verdict was NEEDS_ACK — the page does not claim PASS')
})

// ── M3: the contract names both files on the evidence branch ─────────────────

/**
 * The `ultra/evidence-run-<N>` bullet alone, wraps joined — the same slice the
 * Proof's `sed -n '/ultra\/evidence-run-<N>. — the run/,/ultra\/integration-run-<N>/p'`
 * takes, with runs of whitespace collapsed so an indented wrap reads the same
 * as an unwrapped line.
 */
function evidenceBullet() {
  const lines = fs.readFileSync(CONTRACT, 'utf8').split('\n')
  const start = lines.findIndex((l) => /ultra\/evidence-run-<N>. — the run/.test(l))
  assert.ok(start >= 0, 'CONTRACT.md must still open its evidence bullet with ' +
    '`ultra/evidence-run-<N>` — the run…')
  let end = lines.findIndex((l, i) => i > start && l.includes('ultra/integration-run-<N>'))
  if (end < 0) end = lines.length - 1
  return lines.slice(start, end + 1).join(' ').replace(/\s+/g, ' ')
}

test('CONTRACT.md\'s evidence-branch bullet names both approvals  [M3]', () => {
  const bullet = evidenceBullet()
  assert.match(bullet,
    /`approve-receipt\.json` and `standing-approval\.json`, present when the engine wrote them/,
    'the `ultra/evidence-run-<N>` bullet must name `approve-receipt.json` and ' +
      '`standing-approval.json`, present when the engine wrote them — got:\n' + bullet)
})

runTests(tests)
