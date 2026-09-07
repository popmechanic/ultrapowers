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
 * #702 Task 2 extends the same rig with the same question about a THIRD thing
 * the run directory holds — the worker slices:
 *
 *   M1 / leg (a)      `collect_evidence` copies every
 *                     `<run dir>/transcripts/*.jsonl` into
 *                     `.ultrapowers/runs/<N>/transcripts/<same name>` byte for
 *                     byte, a run that wrote none commits none, and a completed
 *                     boot leaves exactly one `transcripts/` directory.
 *   M2                the same `ultra/evidence-run-<N>` bullet also names
 *                     `transcripts/<sessionId>.jsonl`, located by its unchanged
 *                     opening line.
 *
 * #739 Task 2 asks it of a FOURTH thing that directory holds — the gate's
 * acceptance run's own output, which the frozen receipt keeps only a 4000-char
 * tail of:
 *
 *   M1 / legs (a)(d)  `collect_evidence` copies `<run dir>/acceptance.log` into
 *                     `.ultrapowers/runs/<N>/acceptance.log` byte for byte when
 *                     the file is present — all 9000 bytes, first line the
 *                     stub's marker, `gate-receipt.json` beside it — and the
 *                     copy lives in the function's own body.
 *   M2 / leg (b)      a run whose engine wrote no `acceptance.log` commits none.
 *   M3 / leg (c)      the same `ultra/evidence-run-<N>` bullet names
 *                     `acceptance.log` and, before any other backticked name,
 *                     calls it the full stdout+stderr.
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

// ── #702 Task 2: the worker slices ride beside the receipts ──────────────────
//
// M1: `collect_evidence` copies every `<run dir>/transcripts/*.jsonl` to
// `<evidence worktree>/.ultrapowers/runs/<N>/transcripts/<same name>` byte for
// byte when the directory exists; a run whose engine wrote none commits none;
// and because the function runs at EVERY transition (and once more at `fail`),
// a completed boot leaves exactly one `transcripts/` directory — a `cp -R` of
// the directory itself nests a second one inside the first copy on the second
// pass, which leg (a) reads `readdirSync` to refuse.

/** The engine's two slice files, written under `$run_dir/transcripts/` — the
 *  same splice point and the same shape as APPROVAL_SNIPPET. */
const TRANSCRIPTS_SNIPPET = `
if [ -n "\${STUB_TRANSCRIPT_A:-}" ]; then
  mkdir -p "$run_dir/transcripts"
  printf '%s' "$STUB_TRANSCRIPT_A" >"$run_dir/transcripts/aaaa-1.jsonl"
  printf '%s' "$STUB_TRANSCRIPT_B" >"$run_dir/transcripts/bbbb-2.jsonl"
fi
`

// ── #739 Task 2: the acceptance log rides beside the gate receipt ────────────
//
// M1: `collect_evidence` copies `<run dir>/acceptance.log` — the run dir being
// `$TARGET_DIR/.claude/ultrapowers/run-$RUN_ID`, the same directory
// `gate-receipt.json` is read from — to `.ultrapowers/runs/<N>/acceptance.log`
// on the evidence worktree, BYTE FOR BYTE, when the file is present. The
// receipt keeps only a 4000-char tail of that output in `acceptance.output`
// (the verification periphery is frozen), so the log is the only place the
// whole run reads; a copy that carried a tail is not this clause.
// M2: a run whose engine wrote no `acceptance.log` commits none.
// M3: `fleet/CONTRACT.md`'s evidence bullet names it.

/** The engine's `acceptance.log`, written from an env variable with the same
 *  `printf '%s'` the two snippets above use, into the run directory and
 *  nowhere else — the path the driver tees the gate's acceptance run into. */
const ACCEPTANCE_SNIPPET = `
if [ -n "\${STUB_ACCEPTANCE_BYTES:-}" ]; then
  printf '%s' "$STUB_ACCEPTANCE_BYTES" >"$run_dir/acceptance.log"
fi
`

/** The opening marker of the stub's acceptance log — a distinct first line, so
 *  a collected file that begins anywhere else is not this run's log. */
const ACCEPTANCE_MARKER = 'ACCEPTANCE-BEGIN-5f3ab21c'
/** How long the stub's log is: longer than the receipt's 4000-char tail, so a
 *  copy of that tail is visibly not "byte for byte". */
const ACCEPTANCE_LENGTH = 9000
/** The body itself: the marker, then filler, exactly ACCEPTANCE_LENGTH bytes of
 *  ASCII and therefore exactly that many characters. */
const ACCEPTANCE_BYTES = (() => {
  let body = ACCEPTANCE_MARKER + '\n'
  for (let i = 1; body.length < ACCEPTANCE_LENGTH; i += 1) {
    body += `acceptance: fleet/tests/test_${i}.py .......... passed\n`
  }
  return body.slice(0, ACCEPTANCE_LENGTH - 1) + '\n'
})()

/** The two `Run:` legs of this task's Proof, verbatim — read from the repo
 *  root, where the Proof runs them. */
const REPO = path.join(HERE, '..', '..')
const RUN_COLLECT_EVIDENCE =
  `sed -n '/^collect_evidence()/,/^}/p' fleet/sandbox-boot.sh | grep -c 'acceptance.log'`
const RUN_CONTRACT_BULLET =
  `sed -n '/ultra\\/evidence-run-<N>. — the run/,/ultra\\/integration-run-<N>/p' ` +
  `fleet/CONTRACT.md | grep -c 'acceptance.log'`
/** What one of those pipelines printed, as a number. `grep -c` prints `0` and
 *  exits 1 when nothing matched, so the count is read off stdout. */
function grepCount(command) {
  const r = spawnSync('bash', ['-c', command], { cwd: REPO, encoding: 'utf8' })
  const n = Number(String(r.stdout).trim())
  assert.ok(Number.isInteger(n),
    `\`${command}\` must print a count, got: ${JSON.stringify(r.stdout)}${r.stderr}`)
  return n
}

/** The two names the engine writes: `<sessionId>.jsonl`, one per worker
 *  session, in the order `readdirSync` sorts them. */
const TRANSCRIPT_NAMES = ['aaaa-1.jsonl', 'bbbb-2.jsonl']

/** Two distinct, non-trivial slice bodies — the transcript's own shape, one
 *  record per line. Distinct so a copy that wrote one file twice, truncated, or
 *  re-serialized is not "byte for byte". */
const TRANSCRIPT_A =
  '{"type":"user","uuid":"u-1","sessionId":"aaaa-1","message":{"role":"user",' +
  '"content":[{"type":"text","text":"implement task 2"}]}}\n' +
  '{"type":"system","subtype":"elided","records":37}\n'
const TRANSCRIPT_B =
  '{"type":"assistant","uuid":"u-2","sessionId":"bbbb-2","message":' +
  '{"role":"assistant","model":"claude-opus-5","content":[{"type":"text",' +
  '"text":"the second worker reports"}]}}\n'

/** The engine's run directory — where both files are written and read back
 *  from, so a green leg (a) cannot be a rig that quietly wrote nothing. */
const runDir = (ctx) => path.join(ctx.home, 'target', '.claude', 'ultrapowers', 'run-run-7')
/** The run's record on the evidence worktree — what the branch will carry. */
const evidenceRunDir = (ctx) => path.join(evidenceDir(ctx), RUN_PATH)
/** The engine's `transcripts/` directory, and the copy of it on the record. */
const runTranscripts = (ctx) => path.join(runDir(ctx), 'transcripts')
const evidenceTranscripts = (ctx) => path.join(evidenceRunDir(ctx), 'transcripts')

function approvalHome() {
  const ctx = makeHome()
  const body = STUBS['systemd-run']
  assert.ok(body.includes(ENGINE_EXIT),
    `the shared engine stub no longer ends in '${ENGINE_EXIT}' — this sim's splice is stale`)
  const file = path.join(ctx.bin, 'systemd-run')
  fs.writeFileSync(file, PRELUDE + body.replace(
    ENGINE_EXIT,
    () => APPROVAL_SNIPPET + TRANSCRIPTS_SNIPPET + ACCEPTANCE_SNIPPET + ENGINE_EXIT))
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
/** PASS with neither approval file — a run the engine never had to approve.
 *  It writes no `transcripts/` either, which is #702 Task 2's absence case. */
const bareRun = () => run('bare', { STUB_VERDICT: 'PASS' })
/** #702 Task 2: PASS, with two worker slices under `<run dir>/transcripts/`. */
const transcriptsRun = () => run('transcripts', {
  STUB_VERDICT: 'PASS',
  STUB_TRANSCRIPT_A: TRANSCRIPT_A,
  STUB_TRANSCRIPT_B: TRANSCRIPT_B,
})
/** #739 Task 2: PASS, with a 9000-byte `<run dir>/acceptance.log`. */
const acceptanceRun = () =>
  run('acceptance', { STUB_VERDICT: 'PASS', STUB_ACCEPTANCE_BYTES: ACCEPTANCE_BYTES })

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

// ── #702 Task 2, leg (a): the slices ride to the evidence worktree  [M1] ─────

test('every worker slice reaches the evidence worktree byte for byte  [#702 Task 2 / M1 / leg (a)]', () => {
  const ctx = transcriptsRun()

  // The rig left two slices where the engine leaves them: `<run
  // dir>/transcripts/<sessionId>.jsonl`, the layout Task 1 writes.
  assert.deepEqual(fs.readdirSync(runTranscripts(ctx)).sort(), TRANSCRIPT_NAMES,
    `the engine stub must write ${TRANSCRIPT_NAMES.join(' and ')} under ${runTranscripts(ctx)}`)
  assert.equal(read(path.join(runTranscripts(ctx), 'aaaa-1.jsonl')).toString(), TRANSCRIPT_A,
    'the rig wrote the bytes it meant to')
  assert.equal(read(path.join(runTranscripts(ctx), 'bbbb-2.jsonl')).toString(), TRANSCRIPT_B,
    'the rig wrote the bytes it meant to')

  // M1: every `<run dir>/transcripts/*.jsonl` is on the record, under the SAME
  // name, byte for byte.
  assert.ok(fs.existsSync(evidenceTranscripts(ctx)),
    `collect_evidence must copy the run's transcripts into ${RUN_PATH}/transcripts, got: ` +
      fs.readdirSync(evidenceRunDir(ctx)).join(' '))
  for (const name of TRANSCRIPT_NAMES) {
    const source = path.join(runTranscripts(ctx), name)
    const collected = path.join(evidenceTranscripts(ctx), name)
    assert.ok(fs.existsSync(collected),
      `${RUN_PATH}/transcripts/${name} must be collected, got: ` +
        fs.readdirSync(evidenceTranscripts(ctx)).join(' '))
    assert.deepEqual(read(collected), read(source),
      `the collected ${name} must be byte-equal to the run directory's`)
  }
  assert.equal(read(path.join(evidenceTranscripts(ctx), 'aaaa-1.jsonl')).toString(), TRANSCRIPT_A)
  assert.equal(read(path.join(evidenceTranscripts(ctx), 'bbbb-2.jsonl')).toString(), TRANSCRIPT_B)

  // The record is the real one — the receipts are in it beside the slices.
  assert.ok(fs.existsSync(path.join(evidenceRunDir(ctx), 'gate-receipt.json')),
    `${RUN_PATH}/gate-receipt.json must be collected — otherwise this leg reads the wrong directory`)
})

test('the copied transcripts directory holds the two names and nothing nested  [#702 Task 2 / M1 / leg (a)]', () => {
  const ctx = transcriptsRun()
  assert.ok(fs.existsSync(evidenceTranscripts(ctx)),
    `collect_evidence must leave a ${RUN_PATH}/transcripts directory on the record, got: ` +
      fs.readdirSync(evidenceRunDir(ctx)).join(' '))
  // `collect_evidence` runs at EVERY `write_status` transition. A `cp -R` of
  // the directory itself puts a second `transcripts/` inside the first copy on
  // the second pass; copying the FILES leaves exactly the two names, however
  // many times the function ran.
  assert.deepEqual(fs.readdirSync(evidenceTranscripts(ctx)).sort(), TRANSCRIPT_NAMES,
    `${RUN_PATH}/transcripts must hold exactly ${TRANSCRIPT_NAMES.join(' and ')} — a nested ` +
      '`transcripts` entry is the second transition copying the directory itself, got: ' +
      fs.readdirSync(evidenceTranscripts(ctx)).join(' '))
  assert.ok(!fs.existsSync(path.join(evidenceTranscripts(ctx), 'transcripts')),
    'no second transcripts directory is nested inside the copied one')
})

test('a run whose engine wrote no transcripts commits none  [#702 Task 2 / M1 / leg (a)]', () => {
  const ctx = bareRun()
  assert.ok(!fs.existsSync(runTranscripts(ctx)),
    'this run\'s engine wrote no transcripts directory')
  const names = fs.readdirSync(evidenceRunDir(ctx))
  assert.ok(!names.includes('transcripts'),
    'a run whose engine wrote no transcripts/ directory commits none, got: ' + names.join(' '))
})

// ── #702 Task 2: the contract names the slices  [M2] ─────────────────────────

test('CONTRACT.md\'s evidence-branch bullet names the worker slices  [#702 Task 2 / M2]', () => {
  const bullet = evidenceBullet()
  // The Proof's first `Run:` greps the file for the same literal; this reads it
  // in the one bullet M2 confines the change to, located by the SAME opening
  // line the M3 test above uses.
  assert.match(bullet, /`transcripts\/<sessionId>\.jsonl`/,
    'the `ultra/evidence-run-<N>` bullet must name `transcripts/<sessionId>.jsonl` — got:\n' +
      bullet)
})

// ── #739 Task 2, leg (a): the acceptance log rides to the record  [M1] ───────

test('the acceptance log reaches the evidence worktree byte for byte  [#739 Task 2 / M1 / leg (a)]', () => {
  const ctx = acceptanceRun()
  const source = path.join(runDir(ctx), 'acceptance.log')
  const collected = path.join(evidenceRunDir(ctx), 'acceptance.log')

  // The rig left the log where the driver tees the gate's acceptance run:
  // `<run dir>/acceptance.log`, beside the receipt the gate wrote.
  assert.ok(fs.existsSync(source), `the engine stub must write ${source}`)
  assert.equal(read(source).length, ACCEPTANCE_LENGTH,
    `the rig wrote a ${ACCEPTANCE_LENGTH}-byte log — longer than the receipt's 4000-char tail`)
  assert.equal(read(source).toString(), ACCEPTANCE_BYTES, 'the rig wrote the bytes it meant to')

  // M1: the file is on the record, under the same name, byte for byte.
  assert.ok(fs.existsSync(collected),
    'collect_evidence must copy acceptance.log into ' + RUN_PATH + ', got: ' +
      fs.readdirSync(evidenceRunDir(ctx)).join(' '))
  assert.deepEqual(read(collected), read(source),
    'the collected acceptance.log must be byte-equal to the run directory\'s')
  assert.equal(read(collected).length, ACCEPTANCE_LENGTH,
    `the collected acceptance.log must be all ${ACCEPTANCE_LENGTH} bytes — a 4000-char tail is ` +
      'the receipt\'s summary, not this file')
  assert.equal(read(collected).toString(), ACCEPTANCE_BYTES)
  assert.equal(read(collected).toString().split('\n')[0], ACCEPTANCE_MARKER,
    `the collected log's first line must be the opening marker ${ACCEPTANCE_MARKER} — a copy ` +
      'that starts anywhere else carried a tail, not the file')

  // The receipt whose 4000-char summary this log completes sits in the same
  // directory — otherwise this leg reads the wrong one.
  assert.ok(fs.existsSync(path.join(evidenceRunDir(ctx), 'gate-receipt.json')),
    `${RUN_PATH}/gate-receipt.json must be collected beside acceptance.log, got: ` +
      fs.readdirSync(evidenceRunDir(ctx)).join(' '))
})

// ── #739 Task 2, leg (b): a run that wrote none commits none  [M2] ───────────

test('a run whose engine wrote no acceptance.log commits none  [#739 Task 2 / M2 / leg (b)]', () => {
  const ctx = bareRun()
  const dir = evidenceRunDir(ctx)

  assert.ok(!fs.existsSync(path.join(runDir(ctx), 'acceptance.log')),
    'this run\'s engine wrote no acceptance.log')

  // The evidence directory is the real one — the run's record is in it.
  for (const f of ['gate-receipt.json', 'status.json']) {
    assert.ok(fs.existsSync(path.join(dir, f)),
      `${RUN_PATH}/${f} must be collected — otherwise this leg reads the wrong directory`)
  }
  assert.ok(!fs.existsSync(path.join(dir, 'acceptance.log')),
    'acceptance.log must not appear on the evidence branch of a run that never wrote it, got: ' +
      fs.readdirSync(dir).join(' '))
})

// ── #739 Task 2, leg (c): the contract names the log  [M3] ───────────────────

test('CONTRACT.md\'s evidence-branch bullet names acceptance.log  [#739 Task 2 / M3 / leg (c)]', () => {
  const bullet = evidenceBullet()
  // The name, then its description BEFORE any other backticked name: a bullet
  // that omits the name, or parks its description after some other backticked
  // file, does not match.
  assert.match(bullet, /`acceptance\.log`[^`]*full stdout\+stderr/,
    'the `ultra/evidence-run-<N>` bullet must name `acceptance.log` and then, before any other ' +
      'backticked name, say it is the gate\'s acceptance run\'s full stdout+stderr — got:\n' +
      bullet)

  // The Proof's second `Run:` reads the same span with `sed`+`grep`.
  const n = grepCount(RUN_CONTRACT_BULLET)
  assert.ok(n >= 1,
    `\`${RUN_CONTRACT_BULLET}\` must print at least 1, got ${n}`)
})

// ── #739 Task 2, leg (d): the copy is in collect_evidence itself  [M1] ───────

test('collect_evidence\'s own body names acceptance.log, and the script parses  [#739 Task 2 / M1 / leg (d)]', () => {
  // The Proof's first `Run:`: the FUNCTION BODY names the file — a comment
  // elsewhere in the script is outside this slice and does not count.
  const n = grepCount(RUN_COLLECT_EVIDENCE)
  assert.ok(n >= 1,
    `\`${RUN_COLLECT_EVIDENCE}\` must print at least 1 — the copy belongs inside ` +
      `collect_evidence, got ${n}`)
  // The same check the rig's first test makes, restated here because leg (d)
  // is the function body AND a script that still parses.
  assert.equal(spawnSync('bash', ['-n', SCRIPT]).status, 0,
    'fleet/sandbox-boot.sh must still parse')
})

runTests(tests)
