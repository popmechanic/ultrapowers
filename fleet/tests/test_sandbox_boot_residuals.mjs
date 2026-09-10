/**
 * Exam for #869 task 1 — the residuals are ROWS ON THE RECORD, and the run
 * files no issue.
 *
 * The claim: the sandbox writes each residual as a ledger row on the evidence
 * tag (`.ultrapowers/runs/<N>/residuals.jsonl`: `{run, task, file, line?, kind:
 * nit|unverified|deferred|structural, text, sha}`) and files no issue. The PR
 * body's `### Residuals` checklist is unchanged; what was a POST to
 * `/repos/<owner>/<repo>/issues` becomes a file beside `report.json` on the
 * branch the run already commits.
 *
 * The clauses this file pins:
 *
 *   M1  the M1 record's seven rows: seven lines, the exact key set, `run` and
 *       `sha` on every one, the seven `text` values against the same run's own
 *       PR checklist, and the seven `kind`/`task` pairs.          leg (a)
 *   M2  the kind mapping's three triggers: `cannot verify`, `could not verify`,
 *       and the path token that fills `file`/`line` — against a record whose
 *       rows have neither.                                        leg (b)
 *   M3  no item, no file: the rig's default record leaves none at all, and the
 *       parked run that opens no PR still leaves the receipt's two.  leg (c)
 *   M4  the file is committed WITH the record — the rig's `git commit` arm
 *       lists the run directory into `trees.log` at every commit, and the M1
 *       boot's LAST commit carries the name.                       leg (d)
 *   M5  no issue is filed: no `…/issues` curl of either shape, no log line, no
 *       `issues.log`, no `publish:followup` event — and the run still merges,
 *       still reaches `done`, still renders the same seven `- [ ]` lines; plus
 *       the source-level absence of the five retired names.        leg (e)
 *   M6  the two documents: `fleet/CONTRACT.md`'s record list and its
 *       `- **Publish:**` bullet, and `tests/test_docs_agree_with_code.py`'s
 *       literals — the greps of the Proof's `Run:` lines, read from here so
 *       this file grades them too. The `Run:` that runs that pytest module
 *       green is the Proof's own and is not re-run from inside this file.
 *                                                                  leg (f)
 *
 * ── the retained half: #711 task 1, the checklist in the PR body ─────────────
 *
 * The section below the M4-knobs banner is #711 task 1's exam, unchanged: the
 * seven checklist lines and their placement, the three names that are NOT
 * residuals, the empty default, the flattened newline, the missing report, and
 * the rig's two record knobs. This task changes none of it — the checklist is
 * the source the row file's `text` values are read against.
 *
 * The rig is `_sandbox_boot_helpers.mjs`, shared with the other sandbox-boot
 * sims. A boot is ~40 forks of stub shell, so every case here boots ONCE into
 * its own `makeHome()` and is memoized; the legs then ask their questions of
 * those runs.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  BASE_SHA, PLAN_LINK, RUN_DIR_PATH, RUN_PATH,
  makeHome, boot, prPosts, evidenceDir, targetDir,
  argvLines, statusOf, stream,
  runTests,
} from './_sandbox_boot_helpers.mjs'

const tests = []
const test = (name, fn) => tests.push([name, fn])

const HERE = path.dirname(fileURLToPath(import.meta.url))
/** The checkout this exam grades: `fleet/tests/` is two levels down. */
const REPO = path.resolve(HERE, '..', '..')

// ── the two M1 documents, spelled as the clause spells them ──────────────────
//
// The receipt is `ultra_gate.py`'s document with `gate_check.py`'s object one
// level down: the acks are `.gateCheck.acks[]`. Three acks, of which the middle
// one is `deferred:runtime` and therefore NOT a residual.

const M1_GATE_RECEIPT = '{"verdict":"PASS","gateCheck":{"acks":['
  + '{"type":"deferred:external","detail":"live verb record — the lobby answered only on the edge'
  + ' [structural false-green: sandbox could not execute it against the target]"},'
  + '{"type":"deferred:runtime","detail":"runtime-only-B — never listed"},'
  + '{"type":"deferred:external","detail":"usage endpoint — read only through the edge'
  + ' [structural false-green: sandbox could not execute it against the target]"}'
  + ']}}'

// The report is `run-engine.mjs`'s return object: `completenessFindings` is the
// critic's array (one `blocking` entry among the two `minor` ones), and
// `tasks[]` carries the reviewers' notes — the `failed` row's notes are its
// blocking findings and are not residuals.
const M1_REPORT = '{"stamp":"run-7","completenessFindings":['
  + '{"severity":"minor","detail":"critic-C: the exam covers the success path only"},'
  + '{"severity":"blocking","detail":"blocking-D"},'
  + '{"severity":"minor","detail":"critic-C2: no negative row for the 404"}'
  + '],"tasks":['
  + '{"task":"1","status":"done","notes":"E1 dup insert; E2 semantic miss"},'
  + '{"task":"2","status":"failed","notes":"failed-F"},'
  + '{"task":"3","status":"done","notes":"G3 comment names the wrong file"}'
  + ']}'

/** M1's checklist, verbatim and in order — every external ack, every minor
 *  critic finding, every `; `-separated reviewer note of every `done` task. */
const M1_LINES = [
  '- [ ] deferred:external — live verb record — the lobby answered only on the edge'
    + ' [structural false-green: sandbox could not execute it against the target]',
  '- [ ] deferred:external — usage endpoint — read only through the edge'
    + ' [structural false-green: sandbox could not execute it against the target]',
  '- [ ] critic — critic-C: the exam covers the success path only',
  '- [ ] critic — critic-C2: no negative row for the 404',
  '- [ ] task 1 reviewer — E1 dup insert',
  '- [ ] task 1 reviewer — E2 semantic miss',
  '- [ ] task 3 reviewer — G3 comment names the wrong file',
]

/** The three names the body must not carry anywhere: the runtime ack, the
 *  blocking critic finding, the failed task's notes.  [M1] */
const NOT_RESIDUALS = ['runtime-only-B', 'blocking-D', 'failed-F']

// M3's receipt: ONE external ack whose `detail` carries a JSON `\n` escape.
const NEWLINE_GATE_RECEIPT =
  '{"verdict":"PASS","gateCheck":{"acks":[{"type":"deferred:external","detail":"line one\\nline two"}]}}'
const NEWLINE_LINE = '- [ ] deferred:external — line one line two'

// M4's two distinctive documents. `verdict` comes first in the receipt because
// `json_field` answers the FIRST match, and the run has to stay green.
const KNOB_GATE_RECEIPT = '{"verdict":"PASS","gateCheck":{"acks":[]},"marker":"knob-receipt-alpha"}'
const KNOB_REPORT = '{"stamp":"run-7","marker":"knob-report-alpha"}'

/** The rig's defaults, as the engine stub writes them at BASE. */
const DEFAULT_GATE_RECEIPT = '{"verdict":"PASS"}'
const DEFAULT_REPORT = '{"stamp":"run-7"}'

/** A plan carrying a `**Closes:**` line, for the legs that read the body's end. */
const CLOSES_EXTRA = '**Goal:** x\n**Closes:** #660 #668'
const CLOSES_LINES = ['Closes #660', 'Closes #668']

// ── #869 — the row file's literals ───────────────────────────────────────────

/** The name the file carries on the record, beside `report.json`. */
const ROWS_NAME = 'residuals.jsonl'
/** `run-<N>` for this rig's run 7 — every row's `run` cell. */
const RUN_ID = 'run-7'
/** The keys every row carries, exactly these seven and no others, sorted the
 *  way `json.dumps(row, sort_keys=True)` writes them.  [M1] */
const ROW_KEYS = ['file', 'kind', 'line', 'run', 'sha', 'task', 'text']

/** The name each of M1's seven checklist lines is rendered under — the prefix
 *  `- [ ] <name> — ` whose removal leaves the row's `text`.  [M1] */
const M1_NAMES = [
  'deferred:external', 'deferred:external', 'critic', 'critic',
  'task 1 reviewer', 'task 1 reviewer', 'task 3 reviewer',
]
/** M1's seven `kind` values, in the checklist's order: the two external acks,
 *  the two minor critic findings, the three reviewer pieces.  [M1] */
const M1_KINDS = ['deferred', 'deferred', 'structural', 'structural', 'nit', 'nit', 'nit']
/** And their seven `task` values — null for what no task owns, the row's own
 *  `task` AS A STRING for the reviewer pieces.  [M1] */
const M1_TASKS = [null, null, null, null, '1', '1', '3']

/** One checklist line's text: everything after `- [ ] <name> — `. The detail
 *  itself may carry ` — `, so only the FIRST one, after the name, is the
 *  prefix. */
const textOf = (line, name) => {
  const prefix = `- [ ] ${name} — `
  assert.ok(line.startsWith(prefix),
    `the premise: \`${line}\` is rendered under the name \`${name}\``)
  return line.slice(prefix.length)
}
/** M1's seven `text` values, read off M1's own seven checklist lines. */
const M1_TEXTS = M1_LINES.map((l, i) => textOf(l, M1_NAMES[i]))

// M2's record: no ack, no critic finding, ONE done task whose three `; `
// pieces are the two trigger phrases and one path token.
const VERIFY_GATE_RECEIPT = '{"verdict":"PASS","gateCheck":{"acks":[]}}'
const VERIFY_NOTES = 'cannot verify the render step; Could not verify the 404 row;'
  + ' sees fleet/tests/test_thing.mjs:12 twice'
const VERIFY_REPORT = '{"stamp":"run-7","tasks":['
  + `{"task":"4","status":"done","notes":"${VERIFY_NOTES}"}`
  + ']}'
/** Its three pieces, in order — the row `text` values.  [M2] */
const VERIFY_TEXTS = VERIFY_NOTES.split('; ')
/** `cannot verify`, `Could not verify` lowercased, then neither.  [M2] */
const VERIFY_KINDS = ['unverified', 'unverified', 'nit']
/** The one `/`-bearing token, and its trailing `:<digits>`.  [M2] */
const TOKEN_FILE = 'fleet/tests/test_thing.mjs'
const TOKEN_LINE = 12

/** The five names `fleet/sandbox-boot.sh` may no longer carry.  [M5] */
const RETIRED_SOURCE = [
  'file_followup', 'followup_labels', 'PROGRAM_LABELS', 'publish:followup', '/issues',
]
/** The four `fleet/CONTRACT.md` may no longer carry.  [M6] */
const RETIRED_CONTRACT = [
  'POST /repos/<owner>/<repo>/issues', 'publish:followup', 'watch-item', 'four event kinds',
]
/** The three `tests/test_docs_agree_with_code.py` may no longer carry.  [M6] */
const RETIRED_DOCS_TEST = ['FOLLOWUP_POST', 'publish:followup', 'four event kinds']

// ── the boots ────────────────────────────────────────────────────────────────

const CASE_ENV = {
  // #711 (a), (b) — and #869's legs (a), (d), (e): the two M1 documents and a
  // plan naming two tickets, which is the run that used to file the issue.
  m1: { STUB_GATE_RECEIPT: M1_GATE_RECEIPT, STUB_REPORT: M1_REPORT, STUB_PLAN_EXTRA: CLOSES_EXTRA },
  // (c), and (g)'s "both unset": neither knob, so the stub writes its defaults.
  // #869's legs (c) and (d) read it too — the record with no residual at all.
  defaults: { STUB_PLAN_EXTRA: CLOSES_EXTRA },
  // (e): the newline detail, with the DEFAULT report (knob unset).
  newline: { STUB_GATE_RECEIPT: NEWLINE_GATE_RECEIPT, STUB_PLAN_EXTRA: CLOSES_EXTRA },
  // (f), and (g)'s empty-string case: that receipt and NO report at all.
  noReport: {
    STUB_GATE_RECEIPT: NEWLINE_GATE_RECEIPT, STUB_REPORT: '', STUB_PLAN_EXTRA: CLOSES_EXTRA,
  },
  // (g): one knob each, set to a document nothing else in the rig writes.
  knobReceipt: { STUB_GATE_RECEIPT: KNOB_GATE_RECEIPT },
  knobReport: { STUB_REPORT: KNOB_REPORT },

  // ── #869 — the kind mapping's own record  [M2] ────────────────────────────
  //
  // No ack and no critic finding, so every row here is a reviewer piece and the
  // three kinds are the mapping's three answers.
  verify: { STUB_GATE_RECEIPT: VERIFY_GATE_RECEIPT, STUB_REPORT: VERIFY_REPORT },

  // #869's leg (c): the parked run that opens no PR — engine exit 1,
  // `NEEDS_ACK`, zero commits ahead (`test_sandbox_boot.mjs`'s own no-PR
  // recipe) — carrying M1's receipt, whose two external acks are residuals with
  // no PR to hang off. The record is still committed, so the rows are still
  // written.
  parkedNoPr: {
    STUB_VERDICT: 'NEEDS_ACK',
    STUB_NO_COMMITS: '1',
    STUB_ENGINE_CODE: '1',
    STUB_GATE_RECEIPT: M1_GATE_RECEIPT,
  },
}

const BOXES = new Map()
/** One case's boot, run once and asserted to have exited 0. */
function ctxOf(key) {
  if (!BOXES.has(key)) {
    const ctx = makeHome()
    const r = boot(ctx, ['boot'], CASE_ENV[key])
    assert.equal(r.status, 0, `${key}: the boot did not exit 0\n${r.stdout}${r.stderr}`)
    BOXES.set(key, ctx)
  }
  return BOXES.get(key)
}

/** The body of the one PR this run POSTed. */
const bodyOf = (key) => {
  const posts = prPosts(ctxOf(key))
  assert.equal(posts.length, 1, `${key}: expected exactly one POST /pulls`)
  return posts[0].body
}

const HEADING = '### Residuals'
const isChecklist = (l) => l.startsWith('- [ ] ')
const isCloses = (l) => /^Closes #/.test(l)

/** Every `- [ ]` line anywhere in the body, in body order. */
const checklistLines = (body) => body.split('\n').filter(isChecklist)

/**
 * The residuals section as M1 delimits it: the lines after the `### Residuals`
 * heading, up to the next `### ` heading or the first `Closes #` line,
 * whichever comes first. Fails when there is no heading at all.
 */
function residualSection(body) {
  const all = body.split('\n')
  const at = all.indexOf(HEADING)
  assert.ok(at >= 0, `the body carries no \`${HEADING}\` heading:\n---\n${body}`)
  const out = []
  for (let i = at + 1; i < all.length; i += 1) {
    if (all[i].startsWith('### ') || isCloses(all[i])) break
    out.push(all[i])
  }
  return out
}

// ── (a) the seven lines, and where they sit  [#711 M1] ───────────────────────

test('a receipt and a report full of residuals render the seven checklist lines, in order  [#711 M1 / leg (a)]', () => {
  const body = bodyOf('m1')
  assert.deepEqual(
    residualSection(body).filter(isChecklist),
    M1_LINES,
    'the lines between `### Residuals` and the next `### ` heading or the first `Closes #`'
      + ' line are exactly M1\'s seven, in M1\'s order:\n---\n' + body,
  )
  // The same seven are the only `- [ ]` lines the body carries at all — the
  // checklist IS the residuals list.
  assert.deepEqual(checklistLines(body), M1_LINES,
    'and no other line of the body begins `- [ ] `:\n---\n' + body)
})

test('`### Residuals` sits after the Plan link line and before the first `Closes #` line  [#711 M1 / leg (a)]', () => {
  const body = bodyOf('m1')
  const all = body.split('\n')

  const heading = all.indexOf(HEADING)
  assert.ok(heading >= 0, `the body carries no \`${HEADING}\` heading:\n---\n${body}`)

  const planLink = all.indexOf(PLAN_LINK)
  assert.ok(planLink >= 0, `the body carries no \`### Plan\` link line (${PLAN_LINK}):\n---\n${body}`)

  const firstCloses = all.findIndex(isCloses)
  assert.ok(firstCloses >= 0, `the body carries no \`Closes #\` line:\n---\n${body}`)

  assert.ok(heading > planLink,
    `\`${HEADING}\` (line ${heading}) must follow the Plan link line (${planLink}):\n---\n${body}`)
  assert.ok(heading < firstCloses,
    `\`${HEADING}\` (line ${heading}) must precede the first \`Closes #\` line`
      + ` (${firstCloses}):\n---\n${body}`)

  // And the `Closes #` lines are still the body's last lines — the section went
  // in above them, not after them.
  assert.deepEqual(all.slice(-2), CLOSES_LINES,
    'the two `Closes` lines are still the body\'s last two:\n---\n' + body)
})

// ── (b) what is NOT a residual  [#711 M1] ────────────────────────────────────

test('the runtime ack, the blocking finding and the failed task\'s notes appear nowhere in the body  [#711 M1 / leg (b)]', () => {
  const body = bodyOf('m1')

  // The premise, so this leg is a FILTERING claim and not an empty body: the
  // same two documents that carried the three excluded names also carried the
  // six kept items, and the body has to be showing those.
  for (const kept of ['live verb record', 'usage endpoint', 'critic-C:', 'critic-C2:',
    'E1 dup insert', 'E2 semantic miss', 'G3 comment names the wrong file']) {
    assert.ok(body.includes(kept),
      `this body must be the one carrying the residuals, and it does not name \`${kept}\`:`
        + `\n---\n${body}`)
  }

  for (const name of NOT_RESIDUALS) {
    const carrying = body.split('\n').filter((l) => l.includes(name))
    assert.deepEqual(carrying, [],
      `no line of the body may contain \`${name}\`, and these do:\n${carrying.join('\n')}`
        + `\n---\n${body}`)
  }
})

// ── (c) the default record has no residuals  [#711 M2] ───────────────────────

test('the rig\'s default receipt and report render no section and no checklist line  [#711 M2 / leg (c)]', () => {
  const body = bodyOf('defaults')
  const all = body.split('\n')
  assert.deepEqual(all.filter((l) => l === HEADING), [],
    `a run with no residuals carries no \`${HEADING}\` line at all:\n---\n${body}`)
  assert.deepEqual(checklistLines(body), [],
    'and no line begins `- [ ] `:\n---\n' + body)
  assert.deepEqual(all.slice(-2), CLOSES_LINES,
    'the body\'s last lines are still the plan\'s two `Closes` lines:\n---\n' + body)
})

// #711 task 1's leg (d) is that task's `Run: node fleet/tests/test_sandbox_boot.mjs`
// — that sim's `Closes` and card legs read this same body, and the driver runs
// it.

// ── (e) a newline inside a detail  [#711 M3] ─────────────────────────────────

test('a detail carrying a newline renders as exactly one checklist line  [#711 M3 / leg (e)]', () => {
  const body = bodyOf('newline')
  assert.deepEqual(checklistLines(body), [NEWLINE_LINE],
    'one ack whose detail holds a newline is ONE line, the break become a space:\n---\n' + body)
  assert.deepEqual(residualSection(body).filter(isChecklist), [NEWLINE_LINE],
    'and it is the section\'s only line:\n---\n' + body)
})

// ── (f) no report.json at all  [#711 M3] ─────────────────────────────────────

test('a run whose evidence holds no report.json still renders the receipt\'s one line  [#711 M3 / leg (f)]', () => {
  const ctx = ctxOf('noReport')
  const report = path.join(evidenceDir(ctx), RUN_PATH, 'report.json')
  assert.equal(fs.existsSync(report), false,
    `this run wrote no report at all, so ${report} must not exist`)

  const body = bodyOf('noReport')
  assert.deepEqual(checklistLines(body), [NEWLINE_LINE],
    'the receipt\'s single external ack is still the body\'s one checklist line:\n---\n' + body)
  assert.deepEqual(residualSection(body).filter(isChecklist), [NEWLINE_LINE],
    'under `### Residuals`:\n---\n' + body)
})

// ── (g) the rig's two knobs  [#711 M4] ───────────────────────────────────────
//
// Read through the EVIDENCE COPY the boot commits — `collect_evidence` copies
// both documents out of the run directory, so what the copy holds is what the
// engine stub wrote.

const evidenceFile = (key, name) => path.join(evidenceDir(ctxOf(key)), RUN_PATH, name)
const readEvidence = (key, name) => {
  const f = evidenceFile(key, name)
  assert.ok(fs.existsSync(f), `${key}: ${f} does not exist`)
  return fs.readFileSync(f, 'utf8')
}

test('STUB_GATE_RECEIPT writes that document and one newline  [#711 M4 / leg (g)]', () => {
  assert.equal(readEvidence('knobReceipt', 'gate-receipt.json'), `${KNOB_GATE_RECEIPT}\n`,
    'the evidence copy is the supplied string plus exactly one trailing newline')
})

test('STUB_REPORT writes that document and one newline  [#711 M4 / leg (g)]', () => {
  assert.equal(readEvidence('knobReport', 'report.json'), `${KNOB_REPORT}\n`,
    'the evidence copy is the supplied string plus exactly one trailing newline')
})

test('STUB_REPORT set to the empty string writes no report.json at all  [#711 M4 / leg (g)]', () => {
  const f = evidenceFile('noReport', 'report.json')
  assert.equal(fs.existsSync(f), false,
    `an empty STUB_REPORT means NO report — not an empty one — so ${f} must be absent`)
})

test('with neither knob set the two records are the rig\'s defaults  [#711 M4 / leg (g)]', () => {
  assert.equal(readEvidence('defaults', 'gate-receipt.json'), `${DEFAULT_GATE_RECEIPT}\n`)
  assert.equal(readEvidence('defaults', 'report.json'), `${DEFAULT_REPORT}\n`)
})

// ═════════════════════════════════════════════════════════════════════════════
// #869 task 1 — the ledger row file, and the issue that is no longer filed
// ═════════════════════════════════════════════════════════════════════════════

/** `<evidence worktree>/.ultrapowers/runs/7/residuals.jsonl` — the row file, on
 *  the record the run commits and tags. */
const rowsPath = (key) => path.join(evidenceDir(ctxOf(key)), RUN_PATH, ROWS_NAME)

/** Its rows, one parsed JSON object per line, IN FILE ORDER. Fails when the
 *  file is absent — a leg that expects none asks `fs.existsSync` instead. */
function rowsOf(key) {
  const f = rowsPath(key)
  assert.ok(fs.existsSync(f), `${key}: ${f} does not exist`)
  const raw = fs.readFileSync(f, 'utf8')
  return raw.split('\n').filter((l) => l !== '').map((line, i) => {
    let row
    try {
      row = JSON.parse(line)
    } catch (error) {
      throw new Error(`${f} line ${i + 1} is not one JSON object: ${line}\n${error}`)
    }
    assert.ok(row && typeof row === 'object' && !Array.isArray(row),
      `${f} line ${i + 1} is not a JSON object: ${line}`)
    return row
  })
}

/** A row's keys, sorted — compared against `ROW_KEYS` by equality, so a missing
 *  key and an extra one both fail. */
const keysOf = (row) => Object.keys(row).sort()
/** One cell of every row, in row order. */
const cells = (rows, key) => rows.map((r) => r[key])
/** The rows as text, for a failure a reader can act on. */
const showRows = (rows) => rows.map((r) => JSON.stringify(r)).join('\n')

// ── (a) the M1 record's seven rows  [M1] ─────────────────────────────────────

test('the M1 record leaves seven rows, each with the seven keys, `run-7` and the base sha  [M1 / leg (a)]', () => {
  const rows = rowsOf('m1')
  assert.equal(rows.length, 7,
    `${rowsPath('m1')} holds exactly seven lines, one per residual, and holds`
      + ` ${rows.length}:\n${showRows(rows)}`)

  rows.forEach((row, i) => {
    assert.deepEqual(keysOf(row), ROW_KEYS,
      `row ${i + 1} carries exactly the keys ${ROW_KEYS.join(', ')} — no more, no fewer:`
        + ` ${JSON.stringify(row)}`)
  })

  assert.deepEqual(cells(rows, 'run'), Array(7).fill(RUN_ID),
    `every row's \`run\` is \`${RUN_ID}\`:\n${showRows(rows)}`)
  assert.deepEqual(cells(rows, 'sha'), Array(7).fill(BASE_SHA),
    `every row's \`sha\` is the assignment's \`base=\` (${BASE_SHA}):\n${showRows(rows)}`)
})

test('the seven rows carry M1\'s `kind` and `task` sequences, `task` a string where a task owns it  [M1 / leg (a)]', () => {
  const rows = rowsOf('m1')
  assert.deepEqual(cells(rows, 'kind'), M1_KINDS,
    'the two external acks are `deferred`, the two minor critic findings `structural`,'
      + ` the three reviewer pieces \`nit\`:\n${showRows(rows)}`)
  // `deepEqual` under `node:assert/strict` is the strict one: a `task` of 1 as a
  // NUMBER is not `"1"`, and an absent `task` is not `null`.
  assert.deepEqual(cells(rows, 'task'), M1_TASKS,
    'what no task owns is `null`; a reviewer piece carries its row\'s `task` AS A STRING:'
      + `\n${showRows(rows)}`)
})

test('the seven rows\' `text` values are the PR body\'s seven checklist lines less their `- [ ] <name> — ` prefix  [M1 / leg (a)]', () => {
  const checklist = residualSection(bodyOf('m1')).filter(isChecklist)
  assert.deepEqual(checklist, M1_LINES,
    'the premise: this run\'s PR body carries M1\'s seven checklist lines:\n'
      + checklist.join('\n'))

  const expected = checklist.map((l, i) => textOf(l, M1_NAMES[i]))
  assert.deepEqual(expected, M1_TEXTS,
    'and stripping the name prefix off the body\'s lines is M1\'s seven texts')

  const rows = rowsOf('m1')
  assert.deepEqual(cells(rows, 'text'), expected,
    'each row\'s `text` is its checklist item\'s text — the name and the em dash gone,'
      + ` the detail's own em dashes kept:\n${showRows(rows)}`)
})

// ── (b) the kind mapping and the path token  [M2] ────────────────────────────

test('`cannot verify` and `could not verify` make a piece `unverified`, anything else `nit`  [M2 / leg (b)]', () => {
  const rows = rowsOf('verify')
  assert.deepEqual(cells(rows, 'text'), VERIFY_TEXTS,
    'the premise: the one done task\'s three `; ` pieces are these three rows:\n'
      + showRows(rows))
  assert.deepEqual(cells(rows, 'kind'), VERIFY_KINDS,
    'a piece whose LOWERCASED text holds `cannot verify` is `unverified`; one holding'
      + ' `could not verify` — here written `Could not verify` — is `unverified`; a piece'
      + ` holding neither is \`nit\`:\n${showRows(rows)}`)
})

test('a piece carrying a path token fills `file` and `line`, and one with no `/` token leaves both null  [M2 / leg (b)]', () => {
  const rows = rowsOf('verify')
  assert.equal(rows.length, 3, `three pieces, three rows:\n${showRows(rows)}`)

  assert.equal(rows[2].file, TOKEN_FILE,
    '`file` is the first whitespace-delimited token carrying a `/`, its trailing'
      + ` \`:<digits>\` cut: ${JSON.stringify(rows[2])}`)
  assert.equal(rows[2].line, TOKEN_LINE,
    `\`line\` is that token's trailing \`:<digits>\` as an INTEGER: ${JSON.stringify(rows[2])}`)

  for (const i of [0, 1]) {
    assert.equal(rows[i].file, null,
      `a piece with no \`/\`-bearing token has \`file\` null: ${JSON.stringify(rows[i])}`)
    assert.equal(rows[i].line, null,
      `and \`line\` null: ${JSON.stringify(rows[i])}`)
  }

  // M1's seven texts carry no path token at all, so every one of those rows is
  // null on both cells too.
  const m1 = rowsOf('m1')
  assert.deepEqual(cells(m1, 'file'), Array(7).fill(null),
    `none of M1's seven texts carries a path token:\n${showRows(m1)}`)
  assert.deepEqual(cells(m1, 'line'), Array(7).fill(null), `and none carries a line:\n${showRows(m1)}`)
})

// ── (c) no item, no file — and a parked run still writes one  [M3] ───────────

test('the rig\'s default record leaves no residuals.jsonl at all — absent, not empty  [M3 / leg (c)]', () => {
  // The premise: this run DID commit its record, so what is missing is the row
  // file and not the whole evidence directory.
  assert.ok(fs.existsSync(evidenceFile('defaults', 'report.json')),
    'the premise: the default run copied its report onto the record')

  assert.equal(fs.existsSync(rowsPath('defaults')), false,
    `a run with no residual writes NO file — not an empty one — so ${rowsPath('defaults')}`
      + ' must not exist')
})

test('the parked run that opens no PR still leaves the receipt\'s two `deferred` rows  [M3 / leg (c)]', () => {
  const ctx = ctxOf('parkedNoPr')
  assert.equal(prPosts(ctx).length, 0, 'the premise: this run opened no PR')

  const rows = rowsOf('parkedNoPr')
  assert.equal(rows.length, 2,
    `the receipt's two \`deferred:external\` acks are two rows, and the file holds`
      + ` ${rows.length}:\n${showRows(rows)}`)
  rows.forEach((row, i) => {
    assert.deepEqual(keysOf(row), ROW_KEYS,
      `row ${i + 1} carries exactly the seven keys: ${JSON.stringify(row)}`)
  })
  assert.deepEqual(cells(rows, 'kind'), ['deferred', 'deferred'],
    `both rows are \`deferred\`:\n${showRows(rows)}`)
  assert.deepEqual(cells(rows, 'task'), [null, null],
    `neither is owned by a task:\n${showRows(rows)}`)
  assert.deepEqual(cells(rows, 'text'), M1_TEXTS.slice(0, 2),
    'their `text` values are the two external acks\' details, whole and in the receipt\'s'
      + ` order:\n${showRows(rows)}`)
  assert.deepEqual(cells(rows, 'run'), [RUN_ID, RUN_ID])
  assert.deepEqual(cells(rows, 'sha'), [BASE_SHA, BASE_SHA])
})

// ── (d) the file is committed WITH the record  [M4] ──────────────────────────
//
// `$FLEET_HOME/trees.log` is the rig's `git commit` arm listing
// `<evidence worktree>/.ultrapowers/runs/7` at EVERY commit, one space-separated
// line per commit. The LAST line is therefore the tree as the last commit left
// it — a row file written after that commit would not be in it.

const treesPath = (key) => path.join(ctxOf(key).home, 'trees.log')
/** Its lines, `[]` when the file does not exist. */
const treesLines = (key) => {
  const f = treesPath(key)
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter((l) => l !== '') : []
}
/** One line's names — the `ls` listing the arm wrote, space-separated. */
const namesIn = (line) => line.split(' ').filter((s) => s !== '')

test('the M1 boot\'s LAST commit lists residuals.jsonl in the run directory  [M4 / leg (d)]', () => {
  const all = treesLines('m1')
  assert.ok(all.length >= 1,
    `${treesPath('m1')} holds one line per commit, and this run committed — it holds none`)

  const last = namesIn(all[all.length - 1])
  assert.ok(last.includes(ROWS_NAME),
    `the tree at the last commit carries \`${ROWS_NAME}\`, and it lists:\n`
      + `${last.join(' ')}\n---\n${all.join('\n')}`)
  // The premise, so this is a claim about the ROW FILE and not about a rig arm
  // that lists everything or nothing: the record's own documents are there too.
  for (const name of ['report.json', 'gate-receipt.json', 'status.json']) {
    assert.ok(last.includes(name),
      `the premise: the last commit's tree also carries \`${name}\`:\n${last.join(' ')}`)
  }
})

test('the default boot commits no residuals.jsonl at any commit  [M4 / leg (d)]', () => {
  const all = treesLines('defaults')
  assert.ok(all.length >= 1,
    `${treesPath('defaults')} holds one line per commit, and this run committed — it holds none`)

  const carrying = all.filter((l) => namesIn(l).includes(ROWS_NAME))
  assert.deepEqual(carrying, [],
    `no commit of a run with no residual carries \`${ROWS_NAME}\`, and these do:\n`
      + carrying.join('\n'))
})

// ── (e) no issue is filed  [M5] ──────────────────────────────────────────────

/** One case's boot stream, timestamps already stripped by `stream`. */
const streamOf = (key) => stream(ctxOf(key))
/** Every curl argv the run recorded. */
const curlArgvs = (key) => argvLines(ctxOf(key), 'curl')
/** `$FLEET_HOME/issues.log` — what the rig's `POST …/issues` arm writes, and it
 *  still writes it, so an absent file is a POST that was never made. */
const issuesLogPath = (key) => path.join(ctxOf(key).home, 'issues.log')

/** The run's own event log, one JSON object per line, IN FILE ORDER. */
const eventsOf = (key) => {
  const f = path.join(targetDir(ctxOf(key)), RUN_DIR_PATH, 'events.jsonl')
  if (!fs.existsSync(f)) return []
  return fs.readFileSync(f, 'utf8').split('\n').filter((l) => l !== '').map((line, i) => {
    try {
      return JSON.parse(line)
    } catch (error) {
      throw new Error(`${f} line ${i + 1} is not one JSON object: ${line}\n${error}`)
    }
  })
}

test('the M1 run with two `**Closes:**` tickets makes no `…/issues` call of either shape  [M5 / leg (e)]', () => {
  const argvs = curlArgvs('m1')
  const show = argvs.map((a) => a.find((s) => s.startsWith('https://')) || a.join(' ')).join('\n')

  const collection = argvs.filter((a) => a.some((s) => s.endsWith('/issues')))
  assert.deepEqual(collection.map((a) => a.join(' ')), [],
    `no curl call POSTs to a \`…/issues\` collection:\n${show}`)
  const reads = argvs.filter((a) => a.some((s) => /\/issues\/[0-9]+$/.test(s)))
  assert.deepEqual(reads.map((a) => a.join(' ')), [],
    `and none reads a \`…/issues/<n>\` document — the tickets are not read for labels:\n${show}`)

  // The premise: this run DID talk to the edge, so the absence above is an
  // absence of issue calls and not of curl.
  assert.ok(argvs.some((a) => a.some((s) => s.endsWith('/pulls'))),
    `the premise: this run POSTed its PR:\n${show}`)

  // Nor through `gh`: a filing that went out another way is still a filing.
  assert.deepEqual(argvLines(ctxOf('m1'), 'gh'), [],
    'and the `gh` stub is never reached')
})

test('the M1 run\'s log carries no issue line and no `followup:` line, and writes no issues.log  [M5 / leg (e)]', () => {
  const s = streamOf('m1')
  const show = `\n---\n${s.join('\n')}`

  for (const prefix of ['CALL curl issue read', 'CALL curl issue create', 'followup:']) {
    const carrying = s.filter((l) => l.startsWith(prefix))
    assert.deepEqual(carrying, [],
      `no line of the boot log begins \`${prefix}\`:${show}`)
  }
  assert.equal(fs.existsSync(issuesLogPath('m1')), false,
    `the rig's POST arm still writes ${issuesLogPath('m1')} when a POST is made, so its`
      + ' absence is a POST that was never made')
})

test('the M1 run records no `publish:followup` event, still merges, still reaches `done`  [M5 / leg (e)]', () => {
  const all = eventsOf('m1')
  const followups = all.filter((e) => e.kind === 'publish:followup')
  assert.deepEqual(followups, [],
    'nothing that is not filed is recorded as filed:\n'
      + all.map((e) => JSON.stringify(e)).join('\n'))
  // The premise: the publish record is still written — what went is the one kind.
  assert.ok(all.some((e) => e.kind === 'publish:pr'),
    'the premise: this run recorded its `publish:pr` event')

  const s = streamOf('m1')
  assert.ok(s.includes('CALL curl pr merge'),
    `the run still makes its merge PUT:\n---\n${s.join('\n')}`)
  assert.equal(statusOf(ctxOf('m1')).state, 'done',
    'and the final status page is `done`')
})

test('the PR body still carries the same seven `- [ ]` lines under `### Residuals`  [M5 / leg (e)]', () => {
  const body = bodyOf('m1')
  assert.deepEqual(residualSection(body).filter(isChecklist), M1_LINES,
    'the checklist is unchanged by the filing that no longer happens:\n---\n' + body)
  assert.deepEqual(checklistLines(body), M1_LINES,
    'and it is still the body\'s only `- [ ] ` block:\n---\n' + body)
})

test('`fleet/sandbox-boot.sh` carries none of the five retired names  [M5 / leg (e)]', () => {
  const source = fs.readFileSync(path.join(REPO, 'fleet', 'sandbox-boot.sh'), 'utf8')
  const all = source.split('\n')
  for (const name of RETIRED_SOURCE) {
    const carrying = all
      .map((l, i) => [i + 1, l])
      .filter(([, l]) => l.includes(name))
      .map(([n, l]) => `${n}: ${l}`)
    assert.deepEqual(carrying, [],
      `no line of \`fleet/sandbox-boot.sh\` may carry \`${name}\`, and these do:\n`
        + carrying.join('\n'))
  }
})

// ── (f) the two documents  [M6] ──────────────────────────────────────────────
//
// The same reads the Proof's `Run:` lines make, from here: the four retired
// strings, the record-list sentence, the two orderings inside the
// `- **Publish:**` bullet, and the docs test's own literals. (The `Run:` that
// runs `tests/test_docs_agree_with_code.py` green is the Proof's own and is not
// re-run from inside this file.)

const readRepoFile = (rel) => {
  const f = path.join(REPO, rel)
  assert.ok(fs.existsSync(f), `${f} does not exist`)
  return fs.readFileSync(f, 'utf8')
}
/** The file joined on one line, the way the `Run:`s' `tr '\n' ' '` joins it. */
const oneLine = (text) => text.split('\n').join(' ')

/** The `- **Publish:**` bullet, from its own line to the `- **Integration
 *  naming` line, joined on one line — the range the Proof's two `sed -n` `Run:`
 *  lines print. */
function publishBullet(contract) {
  const all = contract.split('\n')
  const from = all.findIndex((l) => l.startsWith('- **Publish:**'))
  assert.ok(from >= 0, '`fleet/CONTRACT.md` carries no line beginning `- **Publish:**`')
  const to = all.findIndex((l, i) => i > from && l.startsWith('- **Integration naming'))
  assert.ok(to > from,
    '`fleet/CONTRACT.md` carries no line beginning `- **Integration naming` after the'
      + ' `- **Publish:**` line')
  return all.slice(from, to + 1).join(' ')
}

/** The first problem with reading `needles` in order out of `text`, or null —
 *  what `grep -q 'a.*b.*c'` answers, as a sentence. */
function outOfOrder(text, needles) {
  let at = 0
  for (const needle of needles) {
    const i = text.indexOf(needle, at)
    if (i < 0) {
      return at === 0
        ? `\`${needle}\` does not appear at all`
        : `\`${needle}\` does not appear after the name before it`
    }
    at = i + needle.length
  }
  return null
}

test('`fleet/CONTRACT.md` carries none of the four retired strings  [M6 / leg (f)]', () => {
  const contract = readRepoFile('fleet/CONTRACT.md')
  const all = contract.split('\n')
  for (const name of RETIRED_CONTRACT) {
    const carrying = all
      .map((l, i) => [i + 1, l])
      .filter(([, l]) => l.includes(name))
      .map(([n, l]) => `${n}: ${l}`)
    assert.deepEqual(carrying, [],
      `no document may name the per-run follow-up issue as a thing the fleet does, so no`
        + ` line of \`fleet/CONTRACT.md\` may carry \`${name}\`, and these do:\n`
        + carrying.join('\n'))
  }
})

test('the record list names residuals.jsonl in a sentence saying `present when`  [M6 / leg (f)]', () => {
  const joined = oneLine(readRepoFile('fleet/CONTRACT.md'))
  assert.ok(/residuals\.jsonl[^.]*present when/.test(joined),
    '`fleet/CONTRACT.md` names `residuals.jsonl` and says `present when` of it with no `.`'
      + ' between them — one sentence of the evidence-branch record list')
})

test('the `- **Publish:**` bullet reads `### Residuals` … `deferred:external` … `Closes #`, in that order  [M6 / leg (f)]', () => {
  const bullet = publishBullet(readRepoFile('fleet/CONTRACT.md'))
  const problem = outOfOrder(bullet, ['### Residuals', 'deferred:external', 'Closes #'])
  assert.equal(problem, null,
    `the bullet still describes the checklist and where it sits: ${problem}\n---\n${bullet}`)
})

test('the `- **Publish:**` bullet reads `residuals.jsonl` … `three event kinds`, in that order  [M6 / leg (f)]', () => {
  const bullet = publishBullet(readRepoFile('fleet/CONTRACT.md'))
  const problem = outOfOrder(bullet, ['residuals.jsonl', 'three event kinds'])
  assert.equal(problem, null,
    'the bullet names the row file BEFORE it counts the publish record\'s event kinds,'
      + ` and the count is three: ${problem}\n---\n${bullet}`)
})

test('`tests/test_docs_agree_with_code.py` names the two new literals and none of the three retired  [M6 / leg (f)]', () => {
  const docsTest = readRepoFile('tests/test_docs_agree_with_code.py')
  const all = docsTest.split('\n')
  for (const name of ['residuals.jsonl', 'three event kinds']) {
    assert.ok(docsTest.includes(name),
      `the docs exam reads the bullet for \`${name}\`; a docs exam that never reads it for`
        + ' the new literals pins nothing')
  }
  for (const name of RETIRED_DOCS_TEST) {
    const carrying = all
      .map((l, i) => [i + 1, l])
      .filter(([, l]) => l.includes(name))
      .map(([n, l]) => `${n}: ${l}`)
    assert.deepEqual(carrying, [],
      `no line of \`tests/test_docs_agree_with_code.py\` may carry \`${name}\`, and these do:\n`
        + carrying.join('\n'))
  }
})

runTests(tests)
