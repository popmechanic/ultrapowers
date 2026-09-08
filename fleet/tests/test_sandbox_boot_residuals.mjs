/**
 * Exam for #711 tasks 1 and 2 — the residuals, in the PR body and in the
 * follow-up issue that lists the same items.
 *
 * ── task 1 — the PR body carries the residuals as a checklist ───────────────
 *
 * The claim: the sandbox writes every `deferred:external` ack and every
 * non-blocking reviewer/critic finding into the PR body as a checklist. At BASE
 * the gate receipt's acks and the report's minor findings and reviewer notes
 * died on the box — the only reader was whoever opened the evidence branch. The
 * card gains a `### Residuals` section between the `### Plan` heading's link
 * line and the `Closes #` lines, one `- [ ]` line per item, and nothing at all
 * when there are no residuals.
 *
 * The clauses this file pins:
 *
 *   M1  the seven-line checklist a full receipt-plus-report run renders, in
 *       order, its placement in the body, and the three names that are NOT
 *       residuals (a `deferred:runtime` ack, a `blocking` critic finding, a
 *       `failed` task's notes).                                legs (a), (b)
 *   M2  the rig's default record has no residuals: no heading, no `- [ ]`
 *       line, and the `Closes #` lines are still the body's last.
 *                                                              legs (c), (d)
 *   M3  a newline inside a detail becomes one space on one line, and a run
 *       with no `report.json` at all still renders the receipt's items.
 *                                                              legs (e), (f)
 *   M4  the rig's two knobs: `STUB_GATE_RECEIPT` and `STUB_REPORT` write the
 *       supplied document plus one newline, an empty `STUB_REPORT` writes no
 *       file at all, and both unset are the defaults.           leg  (g)
 *
 * Task 1's leg (d) is the Proof's own `Run:` of `fleet/tests/test_sandbox_boot.mjs` —
 * its `Closes` and card legs read the same body this task changes, and the
 * driver runs that sim itself. It is not re-run from inside this file.
 *
 * ── task 2 — the run files one follow-up issue listing the same items ───────
 *
 * The claim: the run files one follow-up issue per run (`watch-item`, the
 * plan's program label) titled for the run, listing the same items with their
 * evidence sentences. The inverse of the `**Closes:**` machinery: what the
 * plan named is closed, what the run left is opened.
 *
 * The clauses this file pins:
 *
 *   M1  a green boot with the M1 record, a plan carrying `**Closes:** #660
 *       #668` and a rig answering every issue read with three labels makes,
 *       between the PR POST and the first check-runs read, exactly two issue
 *       reads and exactly one POST /issues; the payload's `title`, `labels`
 *       and `body`; the `followup: <url>` log line; and the one
 *       `publish:followup` event, after `publish:pr`.  legs (a), (b), (c)
 *   M2  no residual, no sink — the default record files nothing, and a run
 *       that opens no PR files nothing either.                legs (d), (e)
 *   M3  the sink never holds the run: a 422 POST still merges and still
 *       reaches `done`, and a 404 issue read still POSTs.     legs (f), (g)
 *   M4  a plan with no `**Closes:**` line reads no issue and POSTs with
 *       `labels` exactly `["watch-item"]`.                    leg  (h)
 *   M5  the rig's three knobs and two curl arms: the read's URL and its `say`
 *       line, the create's `say` line and `issues.log`.  legs (h), (i), (j)
 *
 * The rig is `_sandbox_boot_helpers.mjs`, shared with the other sandbox-boot
 * sims. A boot is ~40 forks of stub shell, so every case here boots ONCE into
 * its own `makeHome()` and is memoized; the legs then ask their questions of
 * those runs.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import {
  PLAN_H1, PLAN_LINK, PR_URL, RUN_DIR_PATH, RUN_PATH, TARGET,
  makeHome, boot, prPosts, evidenceDir, targetDir,
  argvLines, statusOf, stream,
  runTests,
} from './_sandbox_boot_helpers.mjs'

const tests = []
const test = (name, fn) => tests.push([name, fn])

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

// ── #711 Task 2 — the follow-up issue: its literals ──────────────────────────

/** M1's issue document: `enhancement` is not a program label and is dropped;
 *  `peer-review` and `fleet` are, and are kept in the order first seen. */
const M1_ISSUE_LABELS = '[{"name":"enhancement"},{"name":"peer-review"},{"name":"fleet"}]'
/** The two tickets `**Closes:** #660 #668` names, in the plan's order. */
const TICKETS = ['660', '668']
/** The PR's own edge, as the global constraint spells it: `fleet_curl` against
 *  `https://$GITHUB_INT_HOST/api/v3/repos/$TARGET_REPO/…`, never `gh`. */
const ISSUES_URL = `https://github.int.exe.xyz/api/v3/repos/${TARGET}/issues`
/** What the rig's `POST …/issues` arm answers with. */
const FOLLOWUP_URL = 'https://github.com/popmechanic/smoke/issues/9'
/** `fleet $RUN_ID residuals: $(plan_title)`. */
const FOLLOWUP_TITLE = `fleet run-7 residuals: ${PLAN_H1}`
/** `watch-item` first, then each program label once, in the order first seen. */
const M1_LABELS = ['watch-item', 'peer-review', 'fleet']
/** A run whose tickets said nothing keeps nothing but the program label. */
const BARE_LABELS = ['watch-item']

// ── the boots ────────────────────────────────────────────────────────────────

const CASE_ENV = {
  // (a), (b): the two M1 documents.
  m1: { STUB_GATE_RECEIPT: M1_GATE_RECEIPT, STUB_REPORT: M1_REPORT, STUB_PLAN_EXTRA: CLOSES_EXTRA },
  // (c), and (g)'s "both unset": neither knob, so the stub writes its defaults.
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

  // ── #711 Task 2 — the follow-up issue ──────────────────────────────────────
  //
  // Task 2's legs (d) and (e) read the `defaults` boot above — the rig's own
  // record, which has no residual and therefore no sink — so only the five
  // cases below are its own.

  // (a), (b), (c), (i), (j): the M1 record, the plan's two tickets, and a rig
  // answering every issue read with M1's three labels.
  followup: {
    STUB_GATE_RECEIPT: M1_GATE_RECEIPT,
    STUB_REPORT: M1_REPORT,
    STUB_PLAN_EXTRA: CLOSES_EXTRA,
    STUB_ISSUE_LABELS: M1_ISSUE_LABELS,
  },
  // (f): the same run, with GitHub refusing the POST.
  followup422: {
    STUB_GATE_RECEIPT: M1_GATE_RECEIPT,
    STUB_REPORT: M1_REPORT,
    STUB_PLAN_EXTRA: CLOSES_EXTRA,
    STUB_ISSUE_LABELS: M1_ISSUE_LABELS,
    STUB_ISSUE_CODE: '422',
  },
  // (g): the same run, with both issue reads answering 404.
  followupRead404: {
    STUB_GATE_RECEIPT: M1_GATE_RECEIPT,
    STUB_REPORT: M1_REPORT,
    STUB_PLAN_EXTRA: CLOSES_EXTRA,
    STUB_ISSUE_LABELS: M1_ISSUE_LABELS,
    STUB_ISSUE_READ_CODE: '404',
  },
  // (h): residuals, but a plan with no `**Closes:**` line at all — and
  // `STUB_ISSUE_LABELS` unset, so the rig's `[]` default stands.
  followupNoCloses: { STUB_GATE_RECEIPT: M1_GATE_RECEIPT, STUB_REPORT: M1_REPORT },
  // (e): the parked run that opens no PR — engine exit 1, `NEEDS_ACK`, zero
  // commits ahead (`test_sandbox_boot.mjs`'s own no-PR recipe) — carrying M1's
  // receipt, whose two external acks are residuals with no PR to hang off.
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

// ── (a) the seven lines, and where they sit  [M1] ────────────────────────────

test('a receipt and a report full of residuals render the seven checklist lines, in order  [M1 / leg (a)]', () => {
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

test('`### Residuals` sits after the Plan link line and before the first `Closes #` line  [M1 / leg (a)]', () => {
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

// ── (b) what is NOT a residual  [M1] ─────────────────────────────────────────

test('the runtime ack, the blocking finding and the failed task\'s notes appear nowhere in the body  [M1 / leg (b)]', () => {
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

// ── (c) the default record has no residuals  [M2] ────────────────────────────

test('the rig\'s default receipt and report render no section and no checklist line  [M2 / leg (c)]', () => {
  const body = bodyOf('defaults')
  const all = body.split('\n')
  assert.deepEqual(all.filter((l) => l === HEADING), [],
    `a run with no residuals carries no \`${HEADING}\` line at all:\n---\n${body}`)
  assert.deepEqual(checklistLines(body), [],
    'and no line begins `- [ ] `:\n---\n' + body)
  assert.deepEqual(all.slice(-2), CLOSES_LINES,
    'the body\'s last lines are still the plan\'s two `Closes` lines:\n---\n' + body)
})

// Task 1's leg (d) is the Proof's `Run: node fleet/tests/test_sandbox_boot.mjs`
// — that sim's `Closes` and card legs read this same body, and the driver runs
// it. (Task 2's own leg (d) is further down, with the rest of its legs.)

// ── (e) a newline inside a detail  [M3] ──────────────────────────────────────

test('a detail carrying a newline renders as exactly one checklist line  [M3 / leg (e)]', () => {
  const body = bodyOf('newline')
  assert.deepEqual(checklistLines(body), [NEWLINE_LINE],
    'one ack whose detail holds a newline is ONE line, the break become a space:\n---\n' + body)
  assert.deepEqual(residualSection(body).filter(isChecklist), [NEWLINE_LINE],
    'and it is the section\'s only line:\n---\n' + body)
})

// ── (f) no report.json at all  [M3] ──────────────────────────────────────────

test('a run whose evidence holds no report.json still renders the receipt\'s one line  [M3 / leg (f)]', () => {
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

// ── (g) the rig's two knobs  [M4] ────────────────────────────────────────────
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

test('STUB_GATE_RECEIPT writes that document and one newline  [M4 / leg (g)]', () => {
  assert.equal(readEvidence('knobReceipt', 'gate-receipt.json'), `${KNOB_GATE_RECEIPT}\n`,
    'the evidence copy is the supplied string plus exactly one trailing newline')
})

test('STUB_REPORT writes that document and one newline  [M4 / leg (g)]', () => {
  assert.equal(readEvidence('knobReport', 'report.json'), `${KNOB_REPORT}\n`,
    'the evidence copy is the supplied string plus exactly one trailing newline')
})

test('STUB_REPORT set to the empty string writes no report.json at all  [M4 / leg (g)]', () => {
  const f = evidenceFile('noReport', 'report.json')
  assert.equal(fs.existsSync(f), false,
    `an empty STUB_REPORT means NO report — not an empty one — so ${f} must be absent`)
})

test('with neither knob set the two records are the rig\'s defaults  [M4 / leg (g)]', () => {
  assert.equal(readEvidence('defaults', 'gate-receipt.json'), `${DEFAULT_GATE_RECEIPT}\n`)
  assert.equal(readEvidence('defaults', 'report.json'), `${DEFAULT_REPORT}\n`)
})

// ═════════════════════════════════════════════════════════════════════════════
// #711 Task 2 — the follow-up issue
// ═════════════════════════════════════════════════════════════════════════════
//
// The same items, a second time, where a person will find them: one issue per
// run, filed from `publish` after the `publish:pr` event and before the merge.
// The sink is never a gate — a refused POST is one log line and the run's fate
// stays the merge's.

/** One case's boot stream, timestamps already stripped by `stream`. */
const streamOf = (key) => stream(ctxOf(key))
/** How many stream lines are exactly `line`. */
const sayCount = (key, line) => streamOf(key).filter((l) => l === line).length
/** The index of the one stream line equal to `line`; fails when there is none. */
function sayAt(key, line) {
  const at = streamOf(key).indexOf(line)
  assert.ok(at >= 0,
    `${key}: the boot stream carries no \`${line}\` line:\n${streamOf(key).join('\n')}`)
  return at
}

/** `$FLEET_HOME/issues.log` — written by the rig's `POST …/issues` arm, the
 *  way `pr.log` is written by its `/pulls` arm, and ABSENT when no POST was
 *  ever made. */
const issuesLogPath = (key) => path.join(ctxOf(key).home, 'issues.log')
/** Its raw lines, `[]` when the file does not exist. */
const issuesLogLines = (key) => {
  const f = issuesLogPath(key)
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter((l) => l !== '') : []
}
/** Every POST /issues payload the run made, parsed. */
const issuePosts = (key) => issuesLogLines(key).map((l) => JSON.parse(l))

/** Every curl argv the run recorded. */
const curlArgvs = (key) => argvLines(ctxOf(key), 'curl')
/** The one https word of a curl argv. */
const urlOf = (argv) => argv.find((s) => s.startsWith('https://'))
/** The curl argv of the POST to `…/issues` (never a read, whose URL carries a
 *  number after it), or undefined. */
const issuePostArgv = (key) => curlArgvs(key).find((a) => a.some((s) => s.endsWith('/issues')))
/** The curl argvs of the issue READS, in call order. */
const issueReadArgvs = (key) =>
  curlArgvs(key).filter((a) => a.some((s) => /\/issues\/[0-9]+$/.test(s)))

/** The run's own event log — the file the engine writes and the boot script
 *  appends to, one JSON object per line, IN FILE ORDER. */
const eventsOf = (key) => {
  const f = path.join(targetDir(ctxOf(key)), RUN_DIR_PATH, 'events.jsonl')
  if (!fs.existsSync(f)) return []
  return fs.readFileSync(f, 'utf8').split('\n').filter((l) => l !== '').map((line, i) => {
    try {
      const record = JSON.parse(line)
      assert.ok(record && typeof record === 'object' && !Array.isArray(record),
        `${f} line ${i + 1} is not a JSON object: ${line}`)
      return record
    } catch (error) {
      throw new Error(`${f} line ${i + 1} is not one JSON object: ${line}\n${error}`)
    }
  })
}
/** A record less its `id`/`ts` stamp, so a leg can assert its whole content. */
const unstamped = (e) => {
  const rest = { ...e }
  delete rest.id
  delete rest.ts
  return rest
}
const followupEvents = (key) => eventsOf(key).filter((e) => e.kind === 'publish:followup')

// ── (a) two reads and one POST, between the PR and the checks  [M1] ──────────

test('the two issue reads and the one POST /issues sit after the PR POST and before the first check-runs read  [M1 / leg (a)]', () => {
  const s = streamOf('followup')
  const show = `\n---\n${s.join('\n')}`

  const prCreate = sayAt('followup', 'CALL curl pr create')
  const read660 = sayAt('followup', 'CALL curl issue read 660')
  const read668 = sayAt('followup', 'CALL curl issue read 668')
  const create = sayAt('followup', 'CALL curl issue create')
  const checks = sayAt('followup', 'CALL curl check-runs 1')

  // Exactly two reads, and they are these two, in the plan's order.
  const reads = s.filter((l) => l.startsWith('CALL curl issue read'))
  assert.deepEqual(reads, ['CALL curl issue read 660', 'CALL curl issue read 668'],
    'the tickets `**Closes:** #660 #668` names are read once each, in the plan\'s'
      + ` order and no others:${show}`)

  // Exactly one POST — one PR is one filing.
  assert.equal(sayCount('followup', 'CALL curl issue create'), 1,
    `exactly one POST …/issues is made:${show}`)

  // Where the filing sits: after the PR exists (its `html_url` is the issue
  // body's first line) and before the merge machinery starts reading checks.
  for (const [name, at] of [['issue read 660', read660], ['issue read 668', read668],
    ['issue create', create]]) {
    assert.ok(at > prCreate,
      `\`curl ${name}\` (${at}) must follow \`curl pr create\` (${prCreate}):${show}`)
    assert.ok(at < checks,
      `\`curl ${name}\` (${at}) must precede \`curl check-runs 1\` (${checks}):${show}`)
  }
  assert.ok(create > read660 && create > read668,
    `\`curl issue create\` (${create}) must follow both issue reads`
      + ` (${read660}, ${read668}) — the labels are read before they are posted:${show}`)
})

// ── (b) the POST's shape and its payload  [M1] ───────────────────────────────

test('the POST /issues is one `fleet_curl` against the PR\'s own edge, and its payload is the title, the labels and the body  [M1 / leg (b)]', () => {
  const argv = issuePostArgv('followup')
  assert.ok(argv,
    'no curl argv POSTs to …/issues; the run\'s curl calls were:\n'
      + curlArgvs('followup').map((a) => urlOf(a) || a.join(' ')).join('\n'))

  // The edge, never `gh`: `https://$GITHUB_INT_HOST/api/v3/repos/$TARGET_REPO/issues`.
  assert.equal(urlOf(argv), ISSUES_URL, `the POST goes to the PR's own edge: ${argv.join(' ')}`)

  const x = argv.indexOf('-X')
  assert.ok(x >= 0 && argv[x + 1] === 'POST', `the call carries \`-X POST\`: ${argv.join(' ')}`)
  assert.ok(
    argv.some((s, i) => s === '-H' && argv[i + 1] === 'content-type: application/json'),
    `the call carries \`-H 'content-type: application/json'\`: ${argv.join(' ')}`,
  )
  const d = argv.indexOf('-d')
  assert.ok(d >= 0 && typeof argv[d + 1] === 'string' && argv[d + 1] !== '',
    `the payload rides after \`-d\`: ${argv.join(' ')}`)

  const posts = issuePosts('followup')
  assert.equal(posts.length, 1, 'exactly one payload reached the rig\'s issues.log')
  const payload = posts[0]

  assert.equal(payload.title, FOLLOWUP_TITLE,
    'the title is `fleet $RUN_ID residuals: $(plan_title)`')
  assert.deepEqual(payload.labels, M1_LABELS,
    '`watch-item` first, then each PROGRAM label once in the order first seen —'
      + ' `enhancement` is not one and is absent: ' + JSON.stringify(payload.labels))

  // The body is the PR's URL, an empty line, then the SAME lines the PR body's
  // `### Residuals` section carries — byte for byte, in the same order.
  const L = residualSection(bodyOf('followup')).filter(isChecklist)
  assert.equal(L.length, 7,
    'the premise: this run\'s PR body carries M1\'s seven checklist lines, and it carries '
      + `${L.length}:\n${L.join('\n')}`)
  assert.deepEqual(payload.body.split('\n'), [PR_URL, '', ...L],
    'the issue body is the PR URL, an empty line, then the seven `- [ ]` lines'
      + ` verbatim:\n---\n${payload.body}`)
})

// ── (c) the log line and the event  [M1] ─────────────────────────────────────

test('a filed follow-up is one log line and one `publish:followup` event, after `publish:pr`  [M1 / leg (c)]', () => {
  const s = streamOf('followup')
  assert.ok(s.includes(`followup: ${FOLLOWUP_URL}`),
    `the boot log carries the line \`followup: ${FOLLOWUP_URL}\`:\n---\n${s.join('\n')}`)

  const all = eventsOf('followup')
  const followups = all.filter((e) => e.kind === 'publish:followup')
  assert.equal(followups.length, 1,
    'the run records exactly one `publish:followup` event:\n'
      + all.map((e) => JSON.stringify(e)).join('\n'))
  assert.deepEqual(unstamped(followups[0]), {
    kind: 'publish:followup', url: FOLLOWUP_URL, items: 7,
  }, 'the record less its `id`/`ts` stamp — `items` is the number of lines filed, an integer')

  const at = all.findIndex((e) => e.kind === 'publish:followup')
  const pr = all.findIndex((e) => e.kind === 'publish:pr')
  assert.ok(pr >= 0, 'the premise: this run recorded its `publish:pr` event')
  assert.ok(at > pr,
    `the follow-up's record (line ${at + 1}) follows the PR's (line ${pr + 1})`)
})

// ── (d) no residual, no sink  [M2] ───────────────────────────────────────────

test('the rig\'s default record files no issue at all — no read, no POST, no event  [M2 / leg (d)]', () => {
  // The premise: this run DID publish, so what is missing is the sink and not
  // the whole publish.
  assert.equal(prPosts(ctxOf('defaults')).length, 1, 'the premise: this run opened its PR')

  assert.deepEqual(streamOf('defaults').filter((l) => l.includes('curl issue')), [],
    'a run with no residuals reads no issue and creates none:\n---\n'
      + streamOf('defaults').join('\n'))
  assert.equal(fs.existsSync(issuesLogPath('defaults')), false,
    `no POST …/issues was made, so ${issuesLogPath('defaults')} must not exist`)
  assert.deepEqual(followupEvents('defaults'), [],
    'and no `publish:followup` event is appended')
})

// ── (e) a run that opens no PR files nothing  [M2] ───────────────────────────

test('a run that opens no PR files no follow-up, residuals or not  [M2 / leg (e)]', () => {
  const ctx = ctxOf('parkedNoPr')
  assert.equal(prPosts(ctx).length, 0, 'the premise: this run opened no PR')

  assert.deepEqual(stream(ctx).filter((l) => l.includes('curl issue')), [],
    'no issue is read and none is created:\n---\n' + stream(ctx).join('\n'))
  assert.equal(fs.existsSync(issuesLogPath('parkedNoPr')), false,
    `no POST …/issues was made, so ${issuesLogPath('parkedNoPr')} must not exist`)
})

// ── (f) a refused POST never holds the run  [M3] ─────────────────────────────

test('a POST answered 422 is one log line — the run still merges and still reaches `done`  [M3 / leg (f)]', () => {
  const s = streamOf('followup422')
  const show = `\n---\n${s.join('\n')}`

  assert.ok(s.includes('CALL curl pr merge'),
    `the merge PUT is made as before — the sink is never a gate:${show}`)
  assert.ok(s.includes(`followup: POST /repos/${TARGET}/issues answered 422`),
    'the refusal is exactly one log line,'
      + ` \`followup: POST /repos/${TARGET}/issues answered 422\`:${show}`)

  assert.equal(statusOf(ctxOf('followup422')).state, 'done',
    'the final status page is still `done`')
  assert.deepEqual(followupEvents('followup422'), [],
    'and nothing that was not filed is recorded as filed')
})

// ── (g) a read that answers 404 keeps nothing, and still files  [M3] ─────────

test('issue reads answered 404 still file the follow-up, with `labels` exactly `["watch-item"]`  [M3 / leg (g)]', () => {
  assert.equal(sayCount('followupRead404', 'CALL curl issue create'), 1,
    'the POST is still made when the label reads answer nothing:\n---\n'
      + streamOf('followupRead404').join('\n'))

  const posts = issuePosts('followupRead404')
  assert.equal(posts.length, 1, 'exactly one payload reached the rig\'s issues.log')
  assert.deepEqual(posts[0].labels, BARE_LABELS,
    'a read that answered non-2xx keeps nothing, so only the program label is left: '
      + JSON.stringify(posts[0].labels))
})

// ── (h) a plan that closes nothing  [M4] [M5] ────────────────────────────────

test('a plan with no `**Closes:**` line reads no issue and files with `labels` exactly `["watch-item"]`  [M4 / leg (h)]', () => {
  const s = streamOf('followupNoCloses')
  const show = `\n---\n${s.join('\n')}`

  assert.deepEqual(s.filter((l) => l.startsWith('CALL curl issue read')), [],
    `no ticket is named, so no issue is read:${show}`)
  assert.equal(sayCount('followupNoCloses', 'CALL curl issue create'), 1,
    `and the follow-up is filed all the same:${show}`)

  const posts = issuePosts('followupNoCloses')
  assert.equal(posts.length, 1, 'exactly one payload reached the rig\'s issues.log')
  assert.deepEqual(posts[0].labels, BARE_LABELS,
    'nothing was read, so `labels` is the program label alone: '
      + JSON.stringify(posts[0].labels))
  assert.equal(posts[0].title, FOLLOWUP_TITLE,
    'and the title is still `fleet $RUN_ID residuals: $(plan_title)`')
})

// ── (i) the rig's read arm: its URL and its line  [M5] ───────────────────────

test('each ticket is read at `…/repos/popmechanic/smoke/issues/<n>`, one `curl issue read` line each  [M5 / leg (i)]', () => {
  const reads = issueReadArgvs('followup')
  assert.deepEqual(reads.map(urlOf), TICKETS.map((n) => `${ISSUES_URL}/${n}`),
    'the two reads go to the edge\'s `/repos/<owner>/<repo>/issues/<n>`, in the plan\'s order:\n'
      + curlArgvs('followup').map((a) => urlOf(a) || a.join(' ')).join('\n'))

  const s = streamOf('followup')
  for (const n of TICKETS) {
    assert.equal(sayCount('followup', `CALL curl issue read ${n}`), 1,
      `the rig logs \`curl issue read ${n}\` once:\n---\n${s.join('\n')}`)
  }
  assert.equal(sayCount('followup', 'CALL curl issue create'), 1,
    `and \`curl issue create\` once:\n---\n${s.join('\n')}`)
})

// ── (j) the rig's create arm: what it appends is what was sent  [M5] ─────────

test('issues.log holds exactly the one payload the POST carried after `-d`  [M5 / leg (j)]', () => {
  const raw = issuesLogLines('followup')
  assert.equal(raw.length, 1,
    `${issuesLogPath('followup')} holds exactly one line, and holds ${raw.length}:\n`
      + raw.join('\n'))

  const argv = issuePostArgv('followup')
  assert.ok(argv, 'the premise: a curl argv POSTs to …/issues')
  const d = argv.indexOf('-d')
  assert.ok(d >= 0, `the POST carries \`-d\`: ${argv.join(' ')}`)
  assert.equal(raw[0], argv[d + 1],
    'the rig appends the payload verbatim — what the log holds is what was sent')
})

// ── the edge, not `gh` ───────────────────────────────────────────────────────

test('the follow-up is filed through curl — the `gh` stub is never reached  [global constraint]', () => {
  for (const key of ['followup', 'followup422', 'followupRead404', 'followupNoCloses']) {
    assert.deepEqual(argvLines(ctxOf(key), 'gh'), [],
      `${key}: every GitHub call is \`fleet_curl\` against the edge; \`gh\` is called nowhere`)
  }
})

runTests(tests)
