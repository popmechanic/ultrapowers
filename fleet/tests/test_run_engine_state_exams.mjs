// fleet/tests/test_run_engine_state_exams.mjs — the exam learns where it is,
// and the record it leaves reaches the report and the referee.
//
// An exam the driver runs is handed no coordinates today: it cannot tell which
// task it is, which run directory to write its record under, or which pass it
// is being executed for. This file pins the four variables that answer those
// questions at every site that executes one, the report key that carries the
// record back, and the driver block that tells a referee what a killed mutant
// settled.
//
// Machine clauses under test:
//   M1 — both exam call sites (the at-BASE probe in the examiner's clone, and
//        `runExam` in the graded clone) execute the exam command with the
//        process's own environment plus `ULTRA_BASE` (the task's base sha),
//        `ULTRA_TASK` (the task id), `ULTRA_RUN_DIR` (`paths.runDir`, absolute)
//        and `ULTRA_EXAM_PASS` — `base` at the probe, the pass's `iter` as a
//        string at `runExam` (`0` pre-review, `2` at the round-2 re-execution
//        after a fix). The per-task `Run:` and `Check:` sites receive the same
//        four with the same `ULTRA_EXAM_PASS` value as the exam of that pass.
//   M2 — the integrated `Run:` pass receives `ULTRA_BASE`, `ULTRA_TASK` and
//        `ULTRA_EXAM_PASS=integrated` and NO `ULTRA_RUN_DIR`; the integrated
//        `Check:` pass receives `ULTRA_BASE` and none of the other three; the
//        suite command receives none of the four.
//   M3 — every `tasks[]` row carries `stateExams`: one element per state-exam
//        stem under `<runDir>/state-exams/task-<id>/`, read from the stem's
//        highest NUMERIC pass (never `base`), shaped
//        `{exam, store_ms, render_ms, render, mutant_killed, contract}` —
//        `render_ms` from `walls.json` only when `render` is `ran` and `null`
//        otherwise, `contract` `ok` when `contract.json`'s `breach` is null and
//        the breach string otherwise; no directory ⇒ `[]`.
//   M4 — a non-empty record whose every element is `mutant_killed: true` ends
//        the reviewer prompt with a `STATE EXAM:` block naming each element's
//        exam, its `mutant.json` path and `killed: true`, and saying duty 5 is
//        settled for those exam files and not for the implementer's own tests;
//        an empty record, or any element with `mutant_killed: false`, leaves
//        the prompt with no `STATE EXAM` text at all.
//   M5 — `skills/ultrapowers/references/report-format.md` declares `stateExams`
//        in the schema's `tasks[]` properties and in the field-reference table,
//        naming the six element keys and the highest-pass rule.
//
// M4 and leg (h) both say the reviewer prompt ENDS with the block, and the
// prompt's last block today is `REFEREE:` — so the assertions below read the
// prompt's final `\n\n`-separated block, and check separately that it follows
// the CHECK EVIDENCE block. An implementation that appends the block last
// satisfies both that clause and the seam the task's Context describes.
//
// Everything below the agent seam is real (git, clones, capture, the fold
// kernel, the real `sh`): the exam script `printenv`s the four names into the
// run directory itself and writes its own state-exam record there, so every
// environment these assertions read is the bytes of the driver's OWN execution
// and no assertion trusts a canned reply.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
// Namespace import on purpose: at BASE the module provides neither
// `stateExamsOf` nor `stateExamBlock`, and a named import would fail to LINK —
// the whole file would die with a SyntaxError that reads like a typo instead of
// like the absent implementation. The first assertions below name them instead.
import * as engineMod from '../run-engine.mjs'
import { rig, makeRepo, passReview, cleanCritic, doneImpl } from './_engine_helpers.mjs'

const { stateExamsOf, stateExamBlock } = engineMod

// Hermetic environment: the engine spreads `process.env` into every command it
// runs, so a stray `ULTRA_*` inherited from whatever launched this file would
// show up in the readings below as a fifth line. Nothing here wants them.
for (const k of Object.keys(process.env)) if (k.startsWith('ULTRA_')) delete process.env[k]

// realpath: the probe reads its cwd from the shell's $PWD, which the OS resolves
// (macOS's os.tmpdir() is /var/..., a symlink to /private/var/...), so the
// expected paths below are built from the resolved root or they never match.
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'engine-state-exams-')))
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }))
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const REPORT_FORMAT_MD = fileURLToPath(
  new URL('../../skills/ultrapowers/references/report-format.md', import.meta.url))

// ── the two symbols this task produces [M3] [M4] ────────────────────────────
// `stateExamsOf(runDir, taskId)` is the Produces: contract, and
// `stateExamBlock(rows)` is the prompt block beside `examEvidenceBlock`.
assert.equal(typeof stateExamsOf, 'function',
  'run-engine must export `stateExamsOf(runDir, taskId)` — the Produces: contract [M3]')
assert.equal(typeof stateExamBlock, 'function',
  'run-engine must export `stateExamBlock(rows)` beside examEvidenceBlock [M4]')

// ── the exam the examiner stub writes ───────────────────────────────────────
// It has no helper to call, so it IS the helper: it prints the four variables
// and its cwd into `<runDir>/probe/env-<pass>.txt`, and writes the state-exam
// record the spec's helper would write under
// `<runDir>/state-exams/task-<id>/<stem>-<pass>/`. Both are guarded on
// `ULTRA_RUN_DIR` being set, exactly as the real helper is — which is why an
// integrated pass, which is handed none, leaves nothing behind.
// `marker` keeps the exam RED at BASE and green once the implementer worked.
const EXAM_CMD = 'bash t1_test.sh'
const MUTANT_PATH = 'state-exams/expected/one-open-todo.json'
const j = (obj) => JSON.stringify(obj)
const examScript = ({ marker = 'out.txt', records = {} } = {}) => {
  const cases = Object.entries(records).map(([pass, rec]) =>
    '    ' + pass + ')\n' +
    '      d="$ULTRA_RUN_DIR/state-exams/task-$ULTRA_TASK/' + rec.stem + '-$ULTRA_EXAM_PASS"\n' +
    '      mkdir -p "$d"\n' +
    "      echo '" + j(rec.walls) + "' > \"$d/walls.json\"\n" +
    "      echo '" + j(rec.mutant) + "' > \"$d/mutant.json\"\n" +
    "      echo '" + j(rec.contract) + "' > \"$d/contract.json\"\n" +
    '      ;;\n').join('')
  return '#!/bin/bash\n' +
    'if [ -n "$ULTRA_RUN_DIR" ] && [ -n "$ULTRA_EXAM_PASS" ]; then\n' +
    '  mkdir -p "$ULTRA_RUN_DIR/probe"\n' +
    '  {\n' +
    '    echo "ULTRA_BASE=$ULTRA_BASE"\n' +
    '    echo "ULTRA_EXAM_PASS=$ULTRA_EXAM_PASS"\n' +
    '    echo "ULTRA_RUN_DIR=$ULTRA_RUN_DIR"\n' +
    '    echo "ULTRA_TASK=$ULTRA_TASK"\n' +
    '    echo "cwd=$PWD"\n' +
    '  } > "$ULTRA_RUN_DIR/probe/env-$ULTRA_EXAM_PASS.txt"\n' +
    '  if [ -n "$ULTRA_TASK" ]; then\n' +
    '    case "$ULTRA_EXAM_PASS" in\n' +
    cases +
    '    esac\n' +
    '  fi\n' +
    'fi\n' +
    '[ -f ' + marker + ' ] || exit 1\n' +
    'exit 0\n'
}

// The record the sims read back. `buy-milk-base` is the probe's — killed false,
// so a read that let `base` win would flip both `mutant_killed` and the block.
// `buy-milk-0` carries a `render_ms` beside `render: "skipped"`: M3 says that
// value is dropped for `null` unless `render` is `ran`.
const baseRecord = {
  stem: 'buy-milk',
  walls: { store_ms: 1, render_ms: 7, mutant_ms: 2, render: 'skipped' },
  mutant: { killed: false, path: MUTANT_PATH },
  contract: { clock: '2026-09-09T00:00:00Z', breach: null },
}
const pass0Record = ({ killed = true, breach = null } = {}) => ({
  stem: 'buy-milk',
  walls: { store_ms: 12, render_ms: 999, mutant_ms: 4, render: 'skipped' },
  mutant: { killed, path: MUTANT_PATH },
  contract: { clock: '2026-09-09T00:00:01Z', breach },
})
// The round-2 record: the only one whose render RAN, and a store_ms of its own
// so a deep-equal proves the whole element came from pass 2 and not from 0.
const pass2Record = {
  stem: 'buy-milk',
  walls: { store_ms: 34, render_ms: 3100, mutant_ms: 5, render: 'ran' },
  mutant: { killed: true, path: MUTANT_PATH },
  contract: { clock: '2026-09-09T00:00:02Z', breach: null },
}

// ── the task entries ────────────────────────────────────────────────────────
const bodyFor = (file) => '**Claim:** the tree gains ' + file + '\n' +
  'Machine: M1. The tree holds `' + file + '`.\n\n' +
  '**Proof:**\n- Test: `t1_test.sh`\n- Legs: (a) `' + file + '` exists [M1]'
const entry = (over = {}) => ({
  id: 'T1', title: 'create out', files: ['out.txt'], tier: 'standard', review: 'lean',
  writes: ['out.txt'], commutes: [],
  interfaces: { consumes: ['`BASE_FACTS`'], produces: ['`OUT`'] },
  testCmd: EXAM_CMD, proofTests: ['t1_test.sh'], proofRuns: [],
  body: bodyFor('out.txt'),
  ...over,
})

// One command serves as the task's `Run:`, as the run's one `Check:`, and as
// the integrated re-execution of both: every site's environment is read as the
// sorted `ULTRA_` lines of its own recorded stdout.
const ENV_CMD = "sh -c 'printenv | grep ^ULTRA_ | sort'"

// ── readers ─────────────────────────────────────────────────────────────────
const envFile = (runDir, pass) => path.join(runDir, 'probe', 'env-' + pass + '.txt')
const readEnvFile = (runDir, pass) => {
  const f = envFile(runDir, pass)
  if (!fs.existsSync(f)) return null
  const map = {}
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    if (!line) continue
    const i = line.indexOf('=')
    if (i === -1) continue
    map[line.slice(0, i)] = line.slice(i + 1)
  }
  return map
}

// The prompt's evidence blocks, each from its own header to the next one, so a
// line found in one came from that block and not from a neighbour.
const HEADERS = ['RUN EVIDENCE:', 'EXAM EVIDENCE:', 'CHECK EVIDENCE:', 'REFEREE:', 'STATE EXAM:']
const blockOf = (prompt, header) => {
  const text = String(prompt || '')
  const i = text.indexOf(header)
  if (i === -1) return ''
  let end = text.length
  for (const h of HEADERS) {
    if (h === header) continue
    const k = text.indexOf(h, i + header.length)
    if (k !== -1 && k < end) end = k
  }
  return text.slice(i, end)
}
// One command's segment inside a block: everything after its `$ <cmd>` line up
// to the next quoted command. The first line is `exit <n>`, the rest is stdout.
const segmentOf = (block, cmd) => {
  const marker = '\n\n$ ' + cmd + '\n'
  const i = block.indexOf(marker)
  if (i === -1) return null
  const rest = block.slice(i + marker.length)
  const jj = rest.indexOf('\n\n$ ')
  return jj === -1 ? rest : rest.slice(0, jj)
}
const ultraLinesOf = (text) =>
  String(text || '').split('\n').filter((l) => l.startsWith('ULTRA_'))
// The prompt's LAST block — blocks are joined with `\n\n` and none of them
// carries a blank line of its own.
const lastBlockOf = (prompt) => {
  const parts = String(prompt || '').trimEnd().split('\n\n')
  return parts[parts.length - 1]
}

// ── the sim rig ─────────────────────────────────────────────────────────────
let seq = 0
async function scenario({ tasks, exams, review = () => passReview(), markers = {},
                          repoFiles = {}, extraArgs = {} }) {
  seq += 1
  const stamp = 'se' + seq
  const repo = makeRepo(path.join(tmp, 'repo-' + stamp), repoFiles)
  const runDir = path.join(tmp, 'run-' + stamp)
  const calls = []
  const prompts = {}
  let reviews = 0
  const stub = (prompt, opts, cwd) => {
    calls.push(opts.label)
    prompts[opts.label] = prompt
    const kind = opts.label.split(':')[0]
    const id = opts.label.split(':')[1]
    if (kind === 'exam') {
      fs.writeFileSync(path.join(cwd, 't1_test.sh'), exams[id])
      return { status: 'DONE', summary: 'exam written' }
    }
    if (kind === 'impl') {
      fs.writeFileSync(path.join(cwd, markers[id] || 'out.txt'), 'from ' + id + '\n')
      return doneImpl(cwd)
    }
    if (kind === 'fix') return doneImpl(cwd)
    if (kind === 'review') { reviews += 1; return review(reviews, opts.label) }
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run, base, clonesDir } = rig({ repo, runDir, waves: [tasks], stub, stamp, extraArgs })
  const report = await run()
  const rowOf = (id) => report.tasks.find((t) => t.task === id)
  return { report, rowOf, calls, prompts, runDir, base, clonesDir }
}

// ════════════════════════════════════════════════════════════════════════════
// Scenario A — one task, one `Run:`, one `Check:`, a suite that reads its own
// environment. Legs (a), (c), (d), (e), (f) first half, (h).
// ════════════════════════════════════════════════════════════════════════════
const SUITE_ENV_FILE = path.join(tmp, 'suite-env.txt')
{
  const A = await scenario({
    // T2 is here for the join (#887): the integrated `Run:` pass re-runs a
    // task's commands only when another task of the same wave touches one of
    // its paths, and T1's one path is `out.txt`. T2 declares it in its Files and
    // writes `two.txt`, so the touch sets meet in `out.txt` without two patches
    // contending for it — leg (d) then has an integrated execution to read. T2
    // carries no `proofTests`, so no second examiner is dispatched.
    tasks: [entry({ proofRuns: [ENV_CMD] }),
            entry({ id: 'T2', title: 'create two', files: ['out.txt', 'two.txt'],
                    writes: ['two.txt'], proofTests: [], proofRuns: [],
                    body: bodyFor('two.txt') })],
    markers: { T2: 'two.txt' },
    exams: {
      T1: examScript({ records: { base: baseRecord, 0: pass0Record() } }),
    },
    // The suite's own reading: it appends whatever `ULTRA_` variables it was
    // handed to a file outside the tree. `grep` exits 1 on no match, so the
    // script ends with `true` and the suite stays green.
    repoFiles: {
      'check.sh': '#!/bin/bash\nprintenv | grep ^ULTRA_ >> ' + SUITE_ENV_FILE + '\ntrue\n',
    },
    extraArgs: { constraintChecks: [{ cmd: ENV_CMD, minor: false }] },
  })
  const { report, rowOf, prompts, runDir, base, clonesDir } = A
  const row = rowOf('T1')
  assert.equal(row.status, 'done', 'sim precondition: the task merged: ' + JSON.stringify(row))
  assert.equal(row.exam, 'red', 'sim precondition: the exam is red at BASE')

  // ── leg (a): the at-BASE probe's own environment [M1] ─────────────────────
  const atBase = readEnvFile(runDir, 'base')
  assert.ok(atBase, 'the at-BASE probe wrote no ' + envFile(runDir, 'base') +
    ' — the driver handed the probe no ULTRA_RUN_DIR/ULTRA_EXAM_PASS to write it with')
  assert.deepEqual(atBase, {
    ULTRA_BASE: base,
    ULTRA_EXAM_PASS: 'base',
    ULTRA_RUN_DIR: runDir,
    ULTRA_TASK: 'T1',
    cwd: path.join(clonesDir, 'exam-T1'),
  }, 'the probe runs in the examiner\'s clone with the task\'s base sha, the task id, the ' +
     'engine\'s absolute runDir and the pass name `base`: ' + JSON.stringify(atBase))

  // ── leg (b) first half: the pre-review pass [M1] ──────────────────────────
  const pre = readEnvFile(runDir, '0')
  assert.ok(pre, 'the pre-review pass wrote no ' + envFile(runDir, '0'))
  assert.deepEqual(pre, {
    ULTRA_BASE: base,
    ULTRA_EXAM_PASS: '0',
    ULTRA_RUN_DIR: runDir,
    ULTRA_TASK: 'T1',
    cwd: path.join(clonesDir, 'task-T1'),
  }, 'the pre-review pass runs in the GRADED clone with ULTRA_EXAM_PASS=0: ' +
     JSON.stringify(pre))

  // ── leg (c): the per-task `Run:` and `Check:` sites [M1] ──────────────────
  // Round 1 reads the driver's own pass, so these are the pass-0 readings.
  const p1 = prompts['review:T1:1']
  assert.equal(typeof p1, 'string', 'sim precondition: T1 reached a reviewer')
  const EXPECTED_TASK_ENV = [
    'ULTRA_BASE=' + base,
    'ULTRA_EXAM_PASS=0',
    'ULTRA_RUN_DIR=' + runDir,
    'ULTRA_TASK=T1',
  ]
  for (const header of ['RUN EVIDENCE:', 'CHECK EVIDENCE:']) {
    const block = blockOf(p1, header)
    assert.ok(block, 'sim precondition: the review prompt carries a ' + header + ' block')
    const seg = segmentOf(block, ENV_CMD)
    assert.ok(seg !== null, header + ' quotes `' + ENV_CMD + '` verbatim: ' + block.slice(0, 400))
    assert.equal(seg.split('\n')[0], 'exit 0', header + ': the command exited 0: ' + seg)
    assert.deepEqual(ultraLinesOf(seg), EXPECTED_TASK_ENV,
      header + ' carries exactly the four variables of that pass, in sorted order and with ' +
      'no other ULTRA_ line: ' + JSON.stringify(seg))
  }

  // ── leg (d): the integrated `Run:` — three variables, no run dir [M2] ─────
  const iruns = report.integratedRuns.filter((r) => r.cmd === ENV_CMD)
  assert.equal(iruns.length, 1,
    'sim precondition: one integrated run for `' + ENV_CMD + '`: ' +
    JSON.stringify(report.integratedRuns))
  assert.equal(String(iruns[0].stdout).trim(), [
    'ULTRA_BASE=' + base,
    'ULTRA_EXAM_PASS=integrated',
    'ULTRA_TASK=T1',
  ].join('\n'), 'the integrated `Run:` is handed the run base, the task id and the pass name ' +
     '`integrated` — and no ULTRA_RUN_DIR, which is what keeps the helper from writing a ' +
     'record for a pass that has nowhere to write: ' + JSON.stringify(iruns[0].stdout))

  // ── leg (e): the integrated `Check:` and the suite [M2] ───────────────────
  const ichecks = report.integratedChecks.filter((c) => c.cmd === ENV_CMD)
  assert.equal(ichecks.length, 1,
    'sim precondition: one integrated check: ' + JSON.stringify(report.integratedChecks))
  assert.equal(String(ichecks[0].stdout).trim(), 'ULTRA_BASE=' + base,
    'the integrated `Check:` is handed ULTRA_BASE and none of the other three: ' +
    JSON.stringify(ichecks[0].stdout))
  assert.ok(fs.existsSync(SUITE_ENV_FILE),
    'sim precondition: the suite ran and appended to ' + SUITE_ENV_FILE)
  assert.deepEqual(ultraLinesOf(fs.readFileSync(SUITE_ENV_FILE, 'utf8')), [],
    'none of the four reaches the suite command: ' +
    JSON.stringify(fs.readFileSync(SUITE_ENV_FILE, 'utf8')))

  // ── leg (f) first half: the report row reads the pass-0 record [M3] ───────
  assert.deepEqual(row.stateExams, [{
    exam: 'buy-milk',
    store_ms: 12,
    render_ms: null,
    render: 'skipped',
    mutant_killed: true,
    contract: 'ok',
  }], 'the row carries the pass-0 record — not the probe\'s `buy-milk-base`, whose mutant ' +
     'was not killed — and `render_ms` is null because that pass\'s render was skipped: ' +
     JSON.stringify(row.stateExams))
  assert.ok(fs.existsSync(path.join(runDir, 'state-exams', 'task-T1', 'buy-milk-base')),
    'sim precondition: the `base` directory the read must ignore does exist')

  // ── leg (h): the STATE EXAM block the referee reads [M4] ──────────────────
  const block = lastBlockOf(p1)
  assert.ok(block.startsWith('STATE EXAM:'),
    'the reviewer prompt ENDS with a block beginning `STATE EXAM:`: ' +
    JSON.stringify(String(p1).slice(-600)))
  assert.ok(p1.indexOf('CHECK EVIDENCE:') < p1.indexOf('STATE EXAM:'),
    'and it is joined on after the CHECK EVIDENCE block')
  assert.ok(block.split('\n').includes('- buy-milk: mutant ' + MUTANT_PATH + ' killed: true'),
    'one line per element, naming the exam, its mutant.json path and killed: true: ' +
    JSON.stringify(block))
  assert.ok(block.includes('duty 5'), 'the block names duty 5: ' + JSON.stringify(block))
  assert.ok(block.includes('settled'), 'and says it is settled: ' + JSON.stringify(block))
  assert.ok(block.includes('own tests'),
    'and that the implementer\'s own tests are not settled by it: ' + JSON.stringify(block))

  // ── leg (j) third clause: an absent directory reads as [] [M3] ────────────
  assert.deepEqual(stateExamsOf(runDir, 'T9'), [],
    'a task with no state-exams directory of its own reads as []')
}

// ════════════════════════════════════════════════════════════════════════════
// Scenario B — the reviewer answers FIX_REQUIRED once, so the exam is executed
// again at round 2. Legs (b) second half and (f) second half.
// ════════════════════════════════════════════════════════════════════════════
{
  const B = await scenario({
    tasks: [entry()],
    exams: {
      T1: examScript({ records: { base: baseRecord, 0: pass0Record(), 2: pass2Record } }),
    },
    review: (n) => (n === 1
      ? { verdict: 'FIX_REQUIRED',
          issues: [{ severity: 'blocking', detail: 'the referee wants one thing changed' }] }
      : passReview()),
  })
  const { rowOf, calls, runDir, base, clonesDir } = B
  assert.deepEqual(calls.filter((l) => l !== 'integration'),
    ['exam:T1', 'impl:T1', 'review:T1:1', 'fix:T1:1', 'review:T1:2'],
    'sim precondition: one blocking round-1 verdict bought the fix round: ' + calls.join(','))

  // ── leg (b): pass 0, then pass 2 — and never a pass 1 [M1] ────────────────
  const pre = readEnvFile(runDir, '0')
  assert.ok(pre, 'the pre-review pass wrote no ' + envFile(runDir, '0'))
  assert.equal(pre.ULTRA_EXAM_PASS, '0', JSON.stringify(pre))
  assert.equal(pre.cwd, path.join(clonesDir, 'task-T1'),
    'the pre-review pass runs in the graded clone: ' + JSON.stringify(pre))
  const round2 = readEnvFile(runDir, '2')
  assert.ok(round2, 'the round-2 re-execution wrote no ' + envFile(runDir, '2'))
  assert.deepEqual(round2, {
    ULTRA_BASE: base,
    ULTRA_EXAM_PASS: '2',
    ULTRA_RUN_DIR: runDir,
    ULTRA_TASK: 'T1',
    cwd: path.join(clonesDir, 'task-T1'),
  }, 'the round-2 re-execution after the fix is pass `2`, the round\'s own iter: ' +
     JSON.stringify(round2))
  assert.equal(fs.existsSync(envFile(runDir, '1')), false,
    'and there is no pass 1 at all — round 1 reads the driver\'s own pass rather than ' +
    'executing the exam again')

  // ── leg (f) second half: the highest numeric pass wins [M3] ───────────────
  const row = rowOf('T1')
  assert.deepEqual(row.stateExams, [{
    exam: 'buy-milk',
    store_ms: 34,
    render_ms: 3100,
    render: 'ran',
    mutant_killed: true,
    contract: 'ok',
  }], 'the row reads `buy-milk-2`, the stem\'s highest numeric pass, over `buy-milk-0` and ' +
     '`buy-milk-base` — and `render_ms` survives because that pass\'s render ran: ' +
     JSON.stringify(row.stateExams))
}

// ════════════════════════════════════════════════════════════════════════════
// Scenario C — a breached contract, and a sibling task whose exam writes no
// record at all. Legs (g) and (i) second half.
// ════════════════════════════════════════════════════════════════════════════
const BREACH = 'contract breach: https://x'
{
  const T2 = entry({
    id: 'T2', title: 'create two', files: ['two.txt'], writes: ['two.txt'],
    body: bodyFor('two.txt'),
  })
  const C = await scenario({
    tasks: [entry(), T2],
    exams: {
      T1: examScript({ records: { base: baseRecord, 0: pass0Record({ breach: BREACH }) } }),
      // No `records` at all: this exam leaves nothing under state-exams/.
      T2: examScript({ marker: 'two.txt' }),
    },
    markers: { T2: 'two.txt' },
  })
  const { rowOf, prompts, runDir } = C
  assert.equal(rowOf('T1').status, 'done', 'sim precondition: T1 merged')
  assert.equal(rowOf('T2').status, 'done', 'sim precondition: T2 merged')

  // ── leg (g): the breach string, verbatim, and the empty record [M3] ───────
  assert.deepEqual(rowOf('T1').stateExams, [{
    exam: 'buy-milk',
    store_ms: 12,
    render_ms: null,
    render: 'skipped',
    mutant_killed: true,
    contract: BREACH,
  }], '`contract` is the breach string itself when contract.json\'s `breach` is not null: ' +
     JSON.stringify(rowOf('T1').stateExams))
  assert.deepEqual(rowOf('T2').stateExams, [],
    'a task whose exam wrote no record carries stateExams: [] — ' +
    JSON.stringify(rowOf('T2').stateExams))
  assert.equal(fs.existsSync(path.join(runDir, 'state-exams', 'task-T2')), false,
    'sim precondition: T2 really left no directory behind')

  // ── leg (i): an empty record buys no block [M4] ───────────────────────────
  const p2 = prompts['review:T2:1']
  assert.equal(typeof p2, 'string', 'sim precondition: T2 reached a reviewer')
  assert.ok(!p2.includes('STATE EXAM'),
    'a task with no state-exam record carries no STATE EXAM text at all: ' +
    JSON.stringify(String(p2).slice(-600)))
}

// ════════════════════════════════════════════════════════════════════════════
// Scenario D — the same record, with the mutant NOT killed. Leg (i) first half.
// ════════════════════════════════════════════════════════════════════════════
{
  const D = await scenario({
    tasks: [entry()],
    exams: {
      T1: examScript({ records: { base: baseRecord, 0: pass0Record({ killed: false }) } }),
    },
  })
  const { rowOf, prompts } = D
  assert.deepEqual(rowOf('T1').stateExams, [{
    exam: 'buy-milk',
    store_ms: 12,
    render_ms: null,
    render: 'skipped',
    mutant_killed: false,
    contract: 'ok',
  }], 'sim precondition: the record is there, and its mutant survived: ' +
     JSON.stringify(rowOf('T1').stateExams))
  const p1 = prompts['review:T1:1']
  assert.equal(typeof p1, 'string', 'sim precondition: T1 reached a reviewer')
  assert.ok(!p1.includes('STATE EXAM'),
    'a record with a surviving mutant carries no STATE EXAM text at all — the block says ' +
    'EVERY mutant was killed or it is not written: ' + JSON.stringify(String(p1).slice(-600)))
}

// ── leg (j): the block is a pure function of its rows [M3] [M4] ──────────────
{
  assert.equal(stateExamBlock([]), '',
    'an empty record renders nothing at all, so the prompt of a task with no record is ' +
    'byte-identical to today\'s')
  assert.equal(stateExamBlock([{
    exam: 'buy-milk', store_ms: 12, render_ms: null, render: 'skipped',
    mutant_killed: false, contract: 'ok',
  }]), '', 'and a record whose mutant survived renders nothing either')
}

// ── leg (k): the report contract names the key and the rule [M5] ────────────
{
  const md = fs.readFileSync(REPORT_FORMAT_MD, 'utf8')
  const iTasks = md.indexOf('"tasks": {')
  const iTests = md.indexOf('"tests": {', iTasks)
  assert.ok(iTasks !== -1 && iTests > iTasks,
    'sim precondition: the schema block still runs from `"tasks": {` to `"tests": {`')
  const schema = md.slice(iTasks, iTests).replace(/\n/g, ' ')
  assert.match(schema,
    /stateExams.*exam.*store_ms.*render_ms.*render.*mutant_killed.*contract/,
    'the `tasks[]` schema declares `stateExams` and its six element keys, in order: ' +
    JSON.stringify(schema.slice(0, 1200)))
  const rows = md.split('\n').filter((l) => /^\| .tasks\[\]\.stateExams. \|/.test(l))
  assert.ok(rows.length >= 1,
    'the field-reference table carries a `tasks[].stateExams` row')
  assert.ok(rows.some((r) => /highest.*never .base./.test(r)),
    'and that row says the element is the highest-numbered pass, never `base`: ' +
    JSON.stringify(rows))
}

// ── leg (l): the four sibling engine sims this task must not disturb ─────────
// [M1] [M2] [M3] — the widened environment and the added report key break none
// of the pins that already stand on the exam evidence, the pre-review pass, the
// `ULTRA_BASE` readings and the integrated-run row shape.
//
// Named, not run: the bridge in tests/test_fleet_suite.py collects every
// fleet/tests/test_*.mjs and dispatches each on a worker of its own, so a sim
// that spawned these four ran them twice and charged four walls to this name.
// The coverage the leg keeps is the names — each is still a sim on the tree, and
// its pins are graded where they live.
for (const name of ['test_run_engine_exam_evidence.mjs', 'test_run_engine_pre_review.mjs',
                    'test_run_engine_proof_runs.mjs', 'test_run_engine_integrated_runs.mjs']) {
  assert.ok(fs.existsSync(path.join(REPO_ROOT, 'fleet/tests', name)),
    'fleet/tests/' + name + ' is still a sim under fleet/tests/, collected and run by the bridge')
}

console.log('ALL TESTS PASSED')
