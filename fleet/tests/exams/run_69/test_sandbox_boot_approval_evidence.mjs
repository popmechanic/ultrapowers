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
 * #739 Task 2 extends it again, with the same question about a FOURTH thing —
 * the gate's acceptance log, of which `gate-receipt.json` keeps only a
 * 4000-char tail:
 *
 *   M1 / legs (a)(d)  `collect_evidence` copies `<run dir>/acceptance.log` into
 *                     `.ultrapowers/runs/<N>/acceptance.log` byte for byte when
 *                     it is present, beside `gate-receipt.json`.
 *   M2 / leg (b)      a run whose engine wrote none commits none.
 *   M3 / leg (c)      the same `ultra/evidence-run-<N>` bullet names
 *                     `acceptance.log` as the acceptance run's full
 *                     stdout+stderr.
 *
 * #729 Task 5 extends it once more, with the same question about a FIFTH thing
 * — the driver's REFEREE files, `<run dir>/referee/task-<id>-<n>.json`, one per
 * graded patch — and then asks the two documents to say so:
 *
 *   M1 / legs (a)(b)  `collect_evidence` copies every `<run dir>/referee/*.json`
 *                     into `.ultrapowers/runs/<N>/referee/<same name>` BYTE FOR
 *                     BYTE, file by file, so a completed boot leaves exactly
 *                     the copied names under `referee/` and NOTHING NESTED; a
 *                     run whose engine wrote no `referee/` directory commits
 *                     none; the evidence commit stages the whole run directory
 *                     (`git add -- .ultrapowers/runs/<N>`), so the new
 *                     subdirectory rides it; the script passes `bash -n`.
 *   M2 / leg (c)      `fleet/CONTRACT.md`'s `ultra/evidence-run-<N>` bullet
 *                     names `referee/task-<id>-<n>.json` with the words
 *                     `present when the engine wrote them`, and
 *                     `tests/test_docs_agree_with_code.py` still passes.
 *   M3 / leg (d)      `skills/ultrapowers/references/report-format.md`: the
 *                     `tasks[].reviewVerdict` row names `referee-red` beside
 *                     `proof-red`; the schema's `reviewEconomy` object and the
 *                     `reviewEconomy` row both name `refereeFindings`,
 *                     `refereeBlocking` and `refereeSkippedPairs`; the
 *                     `tasks[].proofFixes` row says a red command or a blocking
 *                     referee finding buys the round; and the
 *                     `deferredVerification` row's `plan-defect` clause carries
 *                     the words `per-task reviewer or the driver's referee`.
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
 * A boot is ~40 forks of stub shell, so each of the runs is booted once and
 * memoized; the legs read the same runs.
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
  gitLog, verbOf, dirOf,
  runTests,
} from '../../_sandbox_boot_helpers.mjs'

// This file lives at `fleet/tests/exams/run_69/`, so the repository root is
// four directories up and `fleet/` is three.
const HERE = path.dirname(fileURLToPath(import.meta.url))
const FLEET = path.join(HERE, '..', '..', '..')
/** The repository the Proof's `Run:` commands are run from. */
const ROOT = path.join(FLEET, '..')
const CONTRACT = path.join(FLEET, 'CONTRACT.md')
const REPORT_FORMAT = path.join(ROOT, 'skills', 'ultrapowers', 'references', 'report-format.md')

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

// ── #739 Task 2: the acceptance log rides beside the gate receipt ────────────
//
// M1: `collect_evidence` copies `<run dir>/acceptance.log` — the run dir being
// `$TARGET_DIR/.claude/ultrapowers/run-$RUN_ID`, the same directory
// `gate-receipt.json` is read from — to `.ultrapowers/runs/<N>/acceptance.log`
// on the evidence worktree, BYTE FOR BYTE, when the file is present. The gate
// receipt keeps only a 4000-char tail of the acceptance output as its summary,
// so the full stdout+stderr survives the box only on the branch: the body below
// is 9000 bytes with a distinct FIRST line, which a copy that carried a tail
// would lose.
// M2: a run whose engine wrote no `acceptance.log` commits none — the same
// WHEN-PRESENT rule `standing-approval.json` is copied under.
// M3: `fleet/CONTRACT.md`'s `ultra/evidence-run-<N>` bullet names the file as
// the acceptance run's full stdout+stderr.

/** The engine's acceptance log, written at the path `run-main.mjs` tees the
 *  gate's acceptance run into — `path.join(runDir, 'acceptance.log')` — and
 *  nowhere else. Same splice point and same shape as APPROVAL_SNIPPET. */
const ACCEPTANCE_SNIPPET = `
if [ -n "\${STUB_ACCEPTANCE_BYTES:-}" ]; then
  printf '%s' "$STUB_ACCEPTANCE_BYTES" >"$run_dir/acceptance.log"
fi
`

/** The log's first line: a distinct opening marker. A copy that carried the
 *  receipt's 4000-char TAIL instead of the file does not begin with it. */
const ACCEPTANCE_MARKER = 'ACCEPTANCE-BEGIN-7c3f19'
/** Longer than the 4000-char tail `gate-receipt.json` keeps, by more than
 *  double, so a tail and the file cannot be confused. */
const ACCEPTANCE_SIZE = 9000

/** 9000 bytes: the marker line, filler in the suite's own shape, and a closing
 *  line — the whole of an acceptance run's stdout+stderr, as the engine left
 *  it. */
const ACCEPTANCE_BYTES = (() => {
  const head = ACCEPTANCE_MARKER + '\n'
  const foot = 'ACCEPTANCE-END-7c3f19\n'
  const line = 'run_acceptance: fleet/tests/test_sandbox_boot.mjs ok\n'
  const want = ACCEPTANCE_SIZE - head.length - foot.length
  let mid = ''
  while (mid.length < want) mid += line
  return head + mid.slice(0, want) + foot
})()

// ── #729 Task 5: the referee's files ride beside the receipts ────────────────
//
// M1: the driver's mechanical referee writes one document per graded patch at
// `<run dir>/referee/task-<id>-<n>.json` — `<id>` the task, `<n>` the number of
// fix rounds that preceded the graded patch (`-0` the pre-pass tree, `-1` after
// the first fix round). `collect_evidence` copies every one of them into
// `<evidence worktree>/.ultrapowers/runs/<N>/referee/<same name>`, BYTE FOR
// BYTE, FILE BY FILE — the same guarded loop the transcripts get, for the same
// reason: the function runs at EVERY `write_status` transition and once more at
// `fail`, so a `cp -R` of the directory nests a second `referee/` inside the
// first copy on the second pass. A run whose engine wrote no `referee/`
// directory commits none, and the evidence commit stages the WHOLE run
// directory, so the new subdirectory rides the commit that was already there.

/** The referee's two documents, written under `$run_dir/referee/` — the same
 *  splice point and the same shape as TRANSCRIPTS_SNIPPET. */
const REFEREE_SNIPPET = `
if [ -n "\${STUB_REFEREE_A:-}" ]; then
  mkdir -p "$run_dir/referee"
  printf '%s' "$STUB_REFEREE_A" >"$run_dir/referee/task-1-0.json"
  printf '%s' "$STUB_REFEREE_B" >"$run_dir/referee/task-1-1.json"
fi
`

/** The two names the engine writes: `task-<id>-<n>.json`, one per graded patch,
 *  in the order `readdirSync` sorts them. */
const REFEREE_NAMES = ['task-1-0.json', 'task-1-1.json']

/** Two distinct, non-trivial referee documents — the graded patch's findings,
 *  round 0 (blocking) and round 1 (clean). Distinct so a copy that wrote one
 *  file twice, truncated or re-serialized is not "byte for byte". */
const REFEREE_A =
  '{\n  "task": "1",\n  "round": 0,\n  "findings": [\n' +
  '    {"severity": "blocking", "detail": "src/a.ts:12 the exam was edited"},\n' +
  '    {"severity": "minor", "detail": "src/a.ts:40 unused import"}\n' +
  '  ],\n  "skippedPairs": 0\n}\n'
const REFEREE_B =
  '{\n  "task": "1",\n  "round": 1,\n  "findings": [],\n  "skippedPairs": 1\n}\n'

/** The engine's run directory — where both files are written and read back
 *  from, so a green leg (a) cannot be a rig that quietly wrote nothing. */
const runDir = (ctx) => path.join(ctx.home, 'target', '.claude', 'ultrapowers', 'run-run-7')
/** The run's record on the evidence worktree — what the branch will carry. */
const evidenceRunDir = (ctx) => path.join(evidenceDir(ctx), RUN_PATH)
/** The engine's `transcripts/` directory, and the copy of it on the record. */
const runTranscripts = (ctx) => path.join(runDir(ctx), 'transcripts')
const evidenceTranscripts = (ctx) => path.join(evidenceRunDir(ctx), 'transcripts')
/** The engine's `referee/` directory, and the copy of it on the record. */
const runReferee = (ctx) => path.join(runDir(ctx), 'referee')
const evidenceReferee = (ctx) => path.join(evidenceRunDir(ctx), 'referee')

function approvalHome() {
  const ctx = makeHome()
  const body = STUBS['systemd-run']
  assert.ok(body.includes(ENGINE_EXIT),
    `the shared engine stub no longer ends in '${ENGINE_EXIT}' — this sim's splice is stale`)
  const file = path.join(ctx.bin, 'systemd-run')
  fs.writeFileSync(file, PRELUDE + body.replace(
    ENGINE_EXIT,
    () => APPROVAL_SNIPPET + TRANSCRIPTS_SNIPPET + ACCEPTANCE_SNIPPET + REFEREE_SNIPPET +
      ENGINE_EXIT))
  fs.chmodSync(file, 0o755)
  return ctx
}

const BOOTED = new Map()
/** Boot one case once and keep it: the legs below ask several questions of
 *  each of the runs. */
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
 *  It writes no `transcripts/` either, which is #702 Task 2's absence case, and
 *  no `referee/`, which is #729 Task 5's leg (b). */
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
/** #729 Task 5: PASS, with two referee documents under `<run dir>/referee/`. */
const refereeRun = () => run('referee', {
  STUB_VERDICT: 'PASS',
  STUB_REFEREE_A: REFEREE_A,
  STUB_REFEREE_B: REFEREE_B,
})

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

// ── #739 Task 2, leg (a): the acceptance log rides to the worktree  [M1] ─────

test('the acceptance log reaches the evidence worktree byte for byte  [#739 Task 2 / M1 / leg (a)]', () => {
  const ctx = acceptanceRun()
  const source = path.join(runDir(ctx), 'acceptance.log')
  const collected = path.join(evidenceRunDir(ctx), 'acceptance.log')

  // The rig left the log where the driver tees the gate's acceptance run:
  // `<run dir>/acceptance.log`, beside the receipts, and nowhere else.
  assert.ok(fs.existsSync(source), `the engine stub must write ${source}`)
  assert.equal(read(source).toString(), ACCEPTANCE_BYTES, 'the rig wrote the bytes it meant to')
  assert.equal(read(source).length, ACCEPTANCE_SIZE,
    `the rig's acceptance log is ${ACCEPTANCE_SIZE} bytes — longer than the receipt's 4000-char tail`)

  // M1: the file is on the record, under the same name, byte for byte.
  assert.ok(fs.existsSync(collected),
    'collect_evidence must copy acceptance.log into ' + RUN_PATH + ', got: ' +
      fs.readdirSync(evidenceRunDir(ctx)).join(' '))
  assert.deepEqual(read(collected), read(source),
    'the collected acceptance.log must be byte-equal to the run directory\'s')
  assert.equal(read(collected).toString(), ACCEPTANCE_BYTES)

  // BYTE FOR BYTE, said the two ways a tail would fail: the whole length, and
  // the FIRST line — the 4000-char tail `gate-receipt.json` keeps has neither.
  assert.equal(read(collected).length, ACCEPTANCE_SIZE,
    `the collected acceptance.log must be all ${ACCEPTANCE_SIZE} bytes, not a tail — got ` +
      read(collected).length)
  assert.equal(read(collected).toString().split('\n')[0], ACCEPTANCE_MARKER,
    `the collected acceptance.log's first line must be ${ACCEPTANCE_MARKER} — a copy that ` +
      'carried only the tail of the output does not begin with it')

  // The record is the real one, and the log sits IN IT — the same directory the
  // gate receipt is collected into, which is the receipt's own run directory.
  assert.ok(fs.existsSync(path.join(evidenceRunDir(ctx), 'gate-receipt.json')),
    `${RUN_PATH}/gate-receipt.json must be collected — otherwise this leg reads the wrong directory`)
  assert.equal(path.dirname(collected), path.dirname(path.join(evidenceRunDir(ctx), 'gate-receipt.json')),
    'the acceptance log is collected BESIDE gate-receipt.json')
  assert.ok(fs.existsSync(path.join(runDir(ctx), 'gate-receipt.json')),
    'the source directory is the run directory the gate receipt is read from')
})

// ── #739 Task 2, leg (b): a run that wrote none commits none  [M2] ───────────

test('a PASS run whose engine wrote no acceptance.log commits none  [#739 Task 2 / M2 / leg (b)]', () => {
  const ctx = bareRun()
  const dir = evidenceRunDir(ctx)

  assert.ok(!fs.existsSync(path.join(runDir(ctx), 'acceptance.log')),
    'this run\'s engine wrote no acceptance.log')

  // The evidence directory is the real one — the run's record is in it.
  assert.ok(fs.existsSync(path.join(dir, 'gate-receipt.json')),
    `${RUN_PATH}/gate-receipt.json must be collected — otherwise this leg reads the wrong directory`)
  assert.ok(fs.existsSync(path.join(dir, 'status.json')), `${RUN_PATH}/status.json must be collected`)

  assert.ok(!fs.existsSync(path.join(dir, 'acceptance.log')),
    'acceptance.log must not appear on the evidence branch of a run that never wrote it, got: ' +
      fs.readdirSync(dir).join(' '))
})

// ── #739 Task 2, leg (c): the contract names the log  [M3] ───────────────────

/** Run one of the Proof's `Run:` commands, verbatim, and return its count. */
function grepCount(command) {
  const r = spawnSync('bash', ['-c', command], { cwd: ROOT, encoding: 'utf8' })
  // `grep -c` exits 1 on a count of zero, so the number on stdout is the answer.
  return Number((r.stdout || '').trim() || '0')
}

/** Run one of the Proof's `Run:` commands, verbatim, from the repository root,
 *  and return `{status, stdout, stderr}`. */
function proofRun(command) {
  const r = spawnSync('bash', ['-c', command], { cwd: ROOT, encoding: 'utf8' })
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' }
}

test('CONTRACT.md\'s evidence-branch bullet names the acceptance log  [#739 Task 2 / M3 / leg (c)]', () => {
  const bullet = evidenceBullet()
  // The name, then ITS description, before any other backticked name: a bullet
  // that omits the name, or names it with the description parked after some
  // other backticked file, does not match.
  assert.match(bullet, /`acceptance\.log`[^`]*full stdout\+stderr/,
    'the `ultra/evidence-run-<N>` bullet must name `acceptance.log` and call it the ' +
      'acceptance run\'s full stdout+stderr, before any other backticked name — got:\n' + bullet)

  // The Proof's second `Run:`, over the same span of the same file.
  const count = grepCount(
    `sed -n '/ultra\\/evidence-run-<N>. — the run/,/ultra\\/integration-run-<N>/p' ` +
      `fleet/CONTRACT.md | grep -c 'acceptance.log'`)
  assert.ok(count >= 1,
    'the Proof\'s `sed`+`grep` over the evidence bullet must count at least one ' +
      '`acceptance.log`, got: ' + count)
})

// ── #739 Task 2, leg (d): the copy is in collect_evidence itself  [M1] ───────

test('collect_evidence\'s own body names acceptance.log  [#739 Task 2 / M1 / leg (d)]', () => {
  // The Proof's first `Run:`: the FUNCTION BODY, not a comment elsewhere in the
  // script. The rig's first test above is the other half of this leg — the
  // script still parses under `bash -n`.
  const count = grepCount(
    `sed -n '/^collect_evidence()/,/^}/p' fleet/sandbox-boot.sh | grep -c 'acceptance.log'`)
  assert.ok(count >= 1,
    'the Proof\'s `sed`+`grep` over collect_evidence must count at least one ' +
      '`acceptance.log`, got: ' + count)
  assert.equal(spawnSync('bash', ['-n', SCRIPT]).status, 0,
    'the boot script still parses with the copy in it')
})

// ── #729 Task 5, leg (a): the referee's files ride to the worktree  [M1] ─────

test('every referee document reaches the evidence worktree byte for byte  [#729 Task 5 / M1 / leg (a)]', () => {
  const ctx = refereeRun()

  // The rig left two documents where the engine leaves them: `<run
  // dir>/referee/task-<id>-<n>.json` — `-0` the pre-pass tree, `-1` after the
  // first fix round.
  assert.deepEqual(fs.readdirSync(runReferee(ctx)).sort(), REFEREE_NAMES,
    `the engine stub must write ${REFEREE_NAMES.join(' and ')} under ${runReferee(ctx)}`)
  assert.equal(read(path.join(runReferee(ctx), 'task-1-0.json')).toString(), REFEREE_A,
    'the rig wrote the bytes it meant to')
  assert.equal(read(path.join(runReferee(ctx), 'task-1-1.json')).toString(), REFEREE_B,
    'the rig wrote the bytes it meant to')

  // M1: every `<run dir>/referee/*.json` is on the record, under the SAME name,
  // byte for byte.
  assert.ok(fs.existsSync(evidenceReferee(ctx)),
    `collect_evidence must copy the run's referee documents into ${RUN_PATH}/referee, got: ` +
      fs.readdirSync(evidenceRunDir(ctx)).join(' '))
  for (const name of REFEREE_NAMES) {
    const source = path.join(runReferee(ctx), name)
    const collected = path.join(evidenceReferee(ctx), name)
    assert.ok(fs.existsSync(collected),
      `${RUN_PATH}/referee/${name} must be collected, got: ` +
        fs.readdirSync(evidenceReferee(ctx)).join(' '))
    assert.deepEqual(read(collected), read(source),
      `the collected ${name} must be byte-equal to the run directory's`)
  }
  assert.equal(read(path.join(evidenceReferee(ctx), 'task-1-0.json')).toString(), REFEREE_A)
  assert.equal(read(path.join(evidenceReferee(ctx), 'task-1-1.json')).toString(), REFEREE_B)

  // BESIDE THE RECEIPTS: the record is the real one, and `referee/` is a
  // subdirectory of the same run directory `gate-receipt.json` is collected
  // into.
  const receipt = path.join(evidenceRunDir(ctx), 'gate-receipt.json')
  assert.ok(fs.existsSync(receipt),
    `${RUN_PATH}/gate-receipt.json must be collected — otherwise this leg reads the wrong directory`)
  assert.equal(path.dirname(evidenceReferee(ctx)), path.dirname(receipt),
    'the referee directory is collected BESIDE gate-receipt.json')
})

test('the copied referee directory holds the two names and nothing nested  [#729 Task 5 / M1 / leg (a)]', () => {
  const ctx = refereeRun()
  assert.ok(fs.existsSync(evidenceReferee(ctx)),
    `collect_evidence must leave a ${RUN_PATH}/referee directory on the record, got: ` +
      fs.readdirSync(evidenceRunDir(ctx)).join(' '))
  // `collect_evidence` runs at EVERY `write_status` transition and once more at
  // `fail`. A `cp -R` of the directory itself puts a second `referee/` inside
  // the first copy on the second pass; copying the FILES leaves EXACTLY the two
  // names, however many times the function ran.
  assert.deepEqual(fs.readdirSync(evidenceReferee(ctx)).sort(), REFEREE_NAMES,
    `${RUN_PATH}/referee must hold exactly ${REFEREE_NAMES.join(' and ')} — a nested ` +
      '`referee` entry is the second transition copying the directory itself, got: ' +
      fs.readdirSync(evidenceReferee(ctx)).join(' '))
  assert.ok(!fs.existsSync(path.join(evidenceReferee(ctx), 'referee')),
    'no second referee directory is nested inside the copied one')
})

test('the evidence commit stages the whole run directory  [#729 Task 5 / M1 / leg (a)]', () => {
  const ctx = refereeRun()
  // `git add -- .ultrapowers/runs/7`: the WHOLE run directory, so a new
  // subdirectory under it rides the commit that was already being made and no
  // pathspec has to learn the referee's name.
  const adds = gitLog(ctx).filter((a) => verbOf(a) === 'add')
  assert.ok(adds.length > 0, 'the run must stage its record at all — no `git add` was made')
  const pathspecs = adds.map((a) => ({
    dir: dirOf(a),
    paths: a.slice(a.indexOf('add') + 1).filter((s) => s !== '--'),
  }))
  const whole = pathspecs.filter(
    (p) => p.paths.length === 1 && p.paths[0] === RUN_PATH && p.dir === evidenceDir(ctx))
  assert.ok(whole.length > 0,
    `some \`git -C ${evidenceDir(ctx)} add -- ${RUN_PATH}\` must stage the whole run ` +
      'directory, got: ' + JSON.stringify(pathspecs))
})

// ── #729 Task 5, leg (b): a run that wrote no referee/ commits none  [M1] ────

test('a PASS run whose engine wrote no referee directory commits none  [#729 Task 5 / M1 / leg (b)]', () => {
  const ctx = bareRun()
  const dir = evidenceRunDir(ctx)

  assert.ok(!fs.existsSync(runReferee(ctx)),
    'this run\'s engine wrote no referee directory')

  // The evidence directory is the real one — the run's record is in it.
  assert.ok(fs.existsSync(path.join(dir, 'gate-receipt.json')),
    `${RUN_PATH}/gate-receipt.json must be collected — otherwise this leg reads the wrong directory`)
  assert.ok(fs.existsSync(path.join(dir, 'status.json')), `${RUN_PATH}/status.json must be collected`)

  const names = fs.readdirSync(dir)
  assert.ok(!names.includes('referee'),
    'a run whose engine wrote no referee/ directory commits none, got: ' + names.join(' '))
})

// ── #729 Task 5, leg (c): the contract names the referee's file  [M2] ────────

test('CONTRACT.md\'s evidence-branch bullet names the referee documents  [#729 Task 5 / M2 / leg (c)]', () => {
  const bullet = evidenceBullet()
  // The name, then — after its meaning — the SAME closing words the two
  // when-present names before it are given: `present when the engine wrote
  // them`. A bullet that names the file and stops does not match.
  assert.match(bullet, /`referee\/task-<id>-<n>\.json`[\s\S]*present when the engine wrote them/,
    'the `ultra/evidence-run-<N>` bullet must name `referee/task-<id>-<n>.json` and close ' +
      'with `present when the engine wrote them` — got:\n' + bullet)

  // The Proof's own `Run:`, verbatim, over the same bullet scoped from its
  // opening line to the `publish-fold` sentence.
  const r = proofRun(
    `sed -n '/ultra\\/evidence-run-<N>. — the run/,/publish-fold/p' fleet/CONTRACT.md | ` +
      `tr '\\n' ' ' | grep -q 'referee/task-<id>-<n>\\.json.*present when the engine wrote them'`)
  assert.equal(r.status, 0,
    'the Proof\'s `sed`+`tr`+`grep` over the evidence bullet must find ' +
      '`referee/task-<id>-<n>.json` before `present when the engine wrote them` — got exit ' +
      r.status)
})

test('the docs-agree suite still reads CONTRACT.md  [#729 Task 5 / M2 / leg (c)]', () => {
  // The same file carries the unit, the engine directory, the VM name and the
  // two-tags bullet that `tests/test_docs_agree_with_code.py` pins; the new
  // sentence must not disturb any of them.
  const r = proofRun('python3 -m pytest -q tests/test_docs_agree_with_code.py')
  assert.equal(r.status, 0,
    'tests/test_docs_agree_with_code.py must still pass:\n' + r.stdout + r.stderr)
})

// ── #729 Task 5, leg (d): the report format names the referee  [M3] ──────────

/** One row of `report-format.md`'s field reference, by its field name. */
function reportRow(field) {
  const lines = fs.readFileSync(REPORT_FORMAT, 'utf8').split('\n')
  const row = lines.find((l) => l.startsWith('| `' + field + '`'))
  assert.ok(row, `report-format.md must still carry a \`${field}\` row`)
  return row
}

/** The schema's `reviewEconomy` object, wraps joined — the same slice the
 *  Proof's `sed -n '/"reviewEconomy": { "type": "object"/,/"acceptance":/p'`
 *  takes, whitespace collapsed so an indented wrap reads as one line. */
function reviewEconomySchema() {
  const text = fs.readFileSync(REPORT_FORMAT, 'utf8')
  const start = text.indexOf('"reviewEconomy": { "type": "object"')
  assert.ok(start >= 0,
    'report-format.md must still open its reviewEconomy schema with ' +
      '`"reviewEconomy": { "type": "object"`')
  let end = text.indexOf('"acceptance":', start)
  if (end < 0) end = text.length
  return text.slice(start, end).replace(/\s+/g, ' ')
}

/** `haystack` names each of `needles`, in this order. */
function inOrder(haystack, needles, what) {
  let at = -1
  for (const needle of needles) {
    const i = haystack.indexOf(needle, at + 1)
    assert.ok(i > at,
      `${what} must name ${needles.map((n) => JSON.stringify(n)).join(', then ')} in that ` +
        `order — ${JSON.stringify(needle)} is missing or out of place in:\n${haystack}`)
    at = i
  }
}

test('the reviewVerdict row names referee-red after proof-red  [#729 Task 5 / M3 / leg (d)]', () => {
  const row = reportRow('tasks[].reviewVerdict')
  inOrder(row, ['proof-red', 'referee-red'], 'the `tasks[].reviewVerdict` row')

  const r = proofRun(
    `sed -n '/^| .tasks\\[\\]\\.reviewVerdict./p' ` +
      `skills/ultrapowers/references/report-format.md | grep -q 'proof-red.*referee-red'`)
  assert.equal(r.status, 0,
    'the Proof\'s `sed`+`grep` must find `proof-red` then `referee-red` on the ' +
      '`tasks[].reviewVerdict` row — got exit ' + r.status)
})

test('the reviewEconomy schema carries the three referee counters  [#729 Task 5 / M3 / leg (d)]', () => {
  const schema = reviewEconomySchema()
  // The exact spellings the Proof's grep pins, in the schema's own shape and in
  // the order the clause names them.
  inOrder(schema, [
    '"refereeFindings": {"type":"integer"}',
    '"refereeBlocking": {"type":"integer"}',
    '"refereeSkippedPairs": {"type":"integer"}',
  ], 'the schema\'s `reviewEconomy` object')

  const r = proofRun(
    `sed -n '/"reviewEconomy": { "type": "object"/,/"acceptance":/p' ` +
      `skills/ultrapowers/references/report-format.md | tr '\\n' ' ' | ` +
      `grep -q '"refereeFindings": {"type":"integer"}.*"refereeBlocking": {"type":"integer"}` +
      `.*"refereeSkippedPairs": {"type":"integer"}'`)
  assert.equal(r.status, 0,
    'the Proof\'s `sed`+`tr`+`grep` must find the three integer fields, in order, inside the ' +
      'schema\'s reviewEconomy object — got exit ' + r.status)
})

test('the reviewEconomy row names the three referee counters  [#729 Task 5 / M3 / leg (d)]', () => {
  const row = reportRow('reviewEconomy')
  inOrder(row, ['refereeFindings', 'refereeBlocking', 'refereeSkippedPairs'],
    'the `reviewEconomy` row')

  const r = proofRun(
    `sed -n '/^| .reviewEconomy./p' skills/ultrapowers/references/report-format.md | ` +
      `grep -q 'refereeFindings.*refereeBlocking.*refereeSkippedPairs'`)
  assert.equal(r.status, 0,
    'the Proof\'s `sed`+`grep` must find the three names, in order, on the `reviewEconomy` ' +
      'row — got exit ' + r.status)
})

test('the proofFixes row says what buys the round  [#729 Task 5 / M3 / leg (d)]', () => {
  const row = reportRow('tasks[].proofFixes')
  // The clause's verbatim words: a red command OR a blocking referee finding.
  assert.ok(row.includes('a red command or a blocking referee finding'),
    'the `tasks[].proofFixes` row must say `a red command or a blocking referee finding` — ' +
      'got:\n' + row)

  const r = proofRun(
    `sed -n '/^| .tasks\\[\\]\\.proofFixes./p' ` +
      `skills/ultrapowers/references/report-format.md | ` +
      `grep -q 'a red command or a blocking referee finding'`)
  assert.equal(r.status, 0,
    'the Proof\'s `sed`+`grep` must find `a red command or a blocking referee finding` on the ' +
      '`tasks[].proofFixes` row — got exit ' + r.status)
})

test('the deferredVerification row\'s plan-defect clause names both sources  [#729 Task 5 / M3 / leg (d)]', () => {
  const row = reportRow('deferredVerification')
  // The plan-defect clause, and inside it the verbatim words: the blocking
  // issue came from a per-task reviewer OR the driver's referee.
  inOrder(row, ['plan-defect', 'per-task reviewer or the driver\'s referee'],
    'the `deferredVerification` row\'s plan-defect clause')

  const r = proofRun(
    `sed -n '/^| .deferredVerification./p' ` +
      `skills/ultrapowers/references/report-format.md | ` +
      `grep -q "plan-defect.*per-task reviewer or the driver's referee"`)
  assert.equal(r.status, 0,
    'the Proof\'s `sed`+`grep` must find `plan-defect` then ' +
      '`per-task reviewer or the driver\'s referee` on the `deferredVerification` row — got ' +
      'exit ' + r.status)
})

runTests(tests)
