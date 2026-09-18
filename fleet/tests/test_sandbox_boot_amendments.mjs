/**
 * Exam for run-150 task 3 — "The record names the row and the pull request
 * lists it" (#990, decision of 2026-09-15: "the PR body lists them"; #728).
 *
 * CLAIM. When I open the run's pull request I see every amendment listed by
 * task, above the folded record, and the contract and the report reference say
 * exactly what the row is.
 *
 * Four machine clauses, read here leg by leg and nowhere else:
 *
 *   M1  `fleet/CONTRACT.md`'s evidence sub-bullet carries, directly after the
 *       paragraph beginning "The driver's own executions are three more kinds",
 *       a paragraph naming `driver:amendment` `{task, amends, what, why}` —
 *       `amends` one of `clause`, `files`, `sim` — as one event per entry of a
 *       worker's reply's `amendments`, mirrored on the task's hub issue like
 *       every `driver:` line naming a task, and `report.json`'s `amendments`
 *       list as the same rows in order, `[]` when none          → leg (d)
 *   M2  `skills/ultrapowers/references/report-format.md`'s schema gains an
 *       `"amendments"` array of objects requiring `task`, `amends`, `what`,
 *       `why` beside `judgmentCalls`, and its field table gains an
 *       `amendments` row between the `judgmentCalls` and `unfinished` rows
 *       stating that shape, that the key is present on every report (`[]` when
 *       none), that each row also draws one `judgmentCalls` line, and that it
 *       is never gated                                          → leg (f)
 *   M3  `fleet/sandbox-boot.sh`'s PR card carries, after the `Residuals:` line
 *       and its `- ` errand lines and before the
 *       `<details><summary>Record</summary>` line, one line
 *       `Amendments: <n> from workers` when the report's `amendments` holds
 *       n ≥ 1 rows, followed by a blank line and one
 *       `- task <id> — <amends>: <what> — <why>` line per row in the report's
 *       order, newlines inside a field flattened to spaces; `Amendments: none`
 *       when the list is empty, absent or the report unreadable; and
 *       `fleet/CONTRACT.md`'s Publish bullet says so, naming both lines beside
 *       the `Residuals:` sentence          → legs (a), (b), (e), (g)
 *   M4  the residual checklist, `residuals.jsonl`, the `Residuals:` count and
 *       the record block are what they were at BASE: the count and its `- `
 *       errand lines are read from the reviewers' notes alone, so a green boot
 *       carrying one `deferred:external` ack and two `amendments` rows renders
 *       `Residuals: 1 from review` and that ack's one errand line, with the
 *       `Amendments:` line AFTER the errand line and never between the two
 *                                                                → leg (c)
 *
 * TWO BOOTS, NO MORE. A boot is ~40 forks of stub shell, so the legs that need
 * one share exactly two of them and each is started once and awaited by
 * everyone who reads it — the shape `test_sandbox_boot_kata_export.mjs` and
 * `test_sandbox_boot_disclosures.mjs` both use:
 *
 *   AMENDED  the green run whose `report.json` is the rig's own
 *            `DEFAULT_REPORT` plus a two-row `amendments` array — `task 1` /
 *            `files` with a NEWLINE inside its `what`, then `task 2` /
 *            `clause` — and whose `STUB_GATE_RECEIPT` carries one
 *            `deferred:external` ack. Legs (a) and (c)'s amended half read it.
 *   DEFAULT  the rig's shared default green boot (`greenAsync`), whose report
 *            carries no `amendments` key at all and whose receipt carries no
 *            ack. Leg (b) and leg (c)'s default half read it.
 *
 * THE RECEIPT SAYS `PASS`, NOT `green`. The rig's default gate receipt is
 * `{"verdict":"PASS"}` (`bootEnv`'s `STUB_VERDICT`), and `do_boot` greens a run
 * only on `verdict = PASS` or an approve receipt beside it — a receipt spelling
 * `green` parks the run and its card opens `**Parked:**`. Legs (a) and (c) are
 * about "the green boot", so the ack rides on a `PASS` receipt, which is the
 * same receipt the rig writes by default plus the one `gateCheck.acks` entry
 * the leg is about. Nothing else about the boot changes.
 *
 * THE NEWLINE RIDES AS AN ESCAPE. The engine stub writes the report with
 * `printf '%s\n' "$STUB_REPORT"`, so a RAW newline in the environment value
 * would make the document unparsable and every card cell a dash. The report is
 * built as `DEFAULT_REPORT` with `JSON.stringify(AMENDMENTS)` spliced in, so
 * the newline is a JSON `\n` escape in the file and a real newline in the value
 * `json.load` hands the card — which is the flattening M3 asks for.
 *
 * THE CARD'S LINES ARE NOT HAND-WRITTEN. `EXPECTED_ROWS` below is M3's own
 * rendering rule applied to the fixture, so the expectation is the clause and
 * not a second copy of it. `task 2` is a row of the report that is NOT a task
 * of the stub plan, on purpose: M3 says one line per ROW in the report's order,
 * so a reader that joined the rows against the plan's task table would drop it.
 *
 * LEG (g) IS THE DRIVER'S. It names the second, third and fourth `Run:` lines —
 * the three boot sims of BASE, still green on the edited script — and the
 * bridge runs those three lines itself. This file may not:
 * `fleet/tests/test_sims_are_hermetic.mjs` M4 forbids a sim from running, or
 * even naming for an existence check, a sibling sim, and a sim that broke that
 * probe would cost the run more than the leg buys. What is left here is the
 * reading of the edited script this exam can make on its own, and the one all
 * three of them rest on: it still parses.
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import {
  SCRIPT, ENV, DEFAULT_REPORT, RUN_PATH,
  makeHome, bootAsync, greenAsync,
  prPosts, runTests,
} from './_sandbox_boot_helpers.mjs'

const tests = []
const test = (name, fn) => tests.push([name, fn])

/** The checkout, from the script the rig points at — `fleet/sandbox-boot.sh`. */
const ROOT = path.resolve(SCRIPT, '..', '..')

// ── the report's amendment rows, and the receipt's one ack ───────────────────

/**
 * The two rows, in the shape the wave's shared literal pins:
 * `{task, amends: 'clause'|'files'|'sim', what, why}` under `report.json`'s
 * top-level `amendments`. Row one's `what` carries a newline — the field M3
 * says the card flattens — and row one's `amends` is `files` while row two's is
 * `clause`, so a card that printed one `amends` for both, or sorted the rows,
 * fails leg (a) rather than passing it by coincidence. Neither field carries an
 * em dash of its own, so the ` — ` in the expected line is unambiguously the
 * card's.
 */
const AMENDMENTS = [
  {
    task: '1',
    amends: 'files',
    what: 'the Proof named fleet/roles/nobody.md\nand the task wrote no such path',
    why: 'the FILES list carried a path this repository keeps nowhere',
  },
  {
    task: '2',
    amends: 'clause',
    what: 'M2 read the field table by its old row order',
    why: 'the row the clause named had moved one line down',
  },
]

/** The detail of the one ack the amended run's receipt carries. */
const ACK_DETAIL = 'the deploy waits on a credential'

/**
 * The report the AMENDED boot runs on: the rig's default, plus the rows. Built
 * off `DEFAULT_REPORT` so the card still renders a whole task row and the run
 * is green for every reason it is green without this task.
 */
const AMENDED_REPORT =
  `${DEFAULT_REPORT.slice(0, -1)},"amendments":${JSON.stringify(AMENDMENTS)}}`

/**
 * Its gate receipt: the verdict the rig writes by default, plus the one
 * `deferred:external` ack `residual_read` turns into the single residual leg
 * (c) counts.
 */
const AMENDED_RECEIPT = JSON.stringify({
  verdict: 'PASS',
  gateCheck: { acks: [{ type: 'deferred:external', detail: ACK_DETAIL }] },
})

// ── what M3 says the card renders ────────────────────────────────────────────

/** M3's flattening: every newline inside a field becomes one space. */
const flat = (text) => text.replace(/\r\n/g, ' ').replace(/\n/g, ' ').replace(/\r/g, ' ')

/** The count line M3 spells for n ≥ 1 rows. */
const COUNT_LINE = `Amendments: ${AMENDMENTS.length} from workers`
/** The line M3 spells for an empty, absent or unreadable list. */
const NONE_LINE = 'Amendments: none'

/** One `- task <id> — <amends>: <what> — <why>` line per row, in report order. */
const EXPECTED_ROWS = AMENDMENTS.map(
  (row) => `- task ${row.task} — ${row.amends}: ${flat(row.what)} — ${flat(row.why)}`,
)

/** The card's own neighbours, as the lines they are. */
const RESIDUAL_COUNT_LINE = 'Residuals: 1 from review'
const RESIDUAL_NONE_LINE = 'Residuals: none'
/** The one errand line the ack draws at BASE, and the prefix leg (c) counts. */
const ERRAND_PREFIX = '- deferred:external'
const ERRAND_LINE = `${ERRAND_PREFIX} — ${ACK_DETAIL}`
/** The checklist item the record's `### Residuals` section carries at BASE. */
const CHECKLIST_LINE = `- [ ] deferred:external — ${ACK_DETAIL}`
/** The record's first line — everything M3 places is above it. */
const RECORD_LINE = '<details><summary>Record</summary>'
/** The record's sections, in the order they stand at BASE. */
const RECORD_SECTIONS = ['### Checks', '### Evidence', '### Plan']

// ── the two boots ────────────────────────────────────────────────────────────

let AMENDED = null
/** The green run whose report carries the two rows and whose receipt carries
 *  the one ack. Started once. */
const amended = () => {
  if (!AMENDED) {
    const ctx = makeHome()
    AMENDED = bootAsync(ctx, ['boot'], {
      STUB_REPORT: AMENDED_REPORT,
      STUB_GATE_RECEIPT: AMENDED_RECEIPT,
    }).then((r) => {
      assert.equal(r.status, 0, `the amended run did not finish\n${r.stdout}${r.stderr}`)
      return ctx
    })
  }
  return AMENDED
}

// ── reading the card ─────────────────────────────────────────────────────────

/** The one PR body this run POSTed, as its lines. */
const bodyLines = (ctx) => {
  const posts = prPosts(ctx)
  assert.equal(posts.length, 1, `the run opened ${posts.length} PRs, not one`)
  return String(posts[0].body).split('\n')
}

/** How many lines of the body are exactly `line`. */
const countExact = (lines, line) => lines.filter((l) => l === line).length
/** The index of the one line that is exactly `line`, or -1. */
const at = (lines, line) => lines.indexOf(line)

/** The evidence branch's residual ledger for this run, or '' when it wrote none. */
const residualsRaw = (ctx) => {
  const file = path.join(ctx.home, 'evidence', RUN_PATH, 'residuals.jsonl')
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
}
const residualRows = (ctx) =>
  residualsRaw(ctx).split('\n').filter(Boolean).map((l) => JSON.parse(l))

// ── leg (a) — M3: the count line, and the rows under it ──────────────────────

test('(a) [M3] the amended card carries one `Amendments: 2 from workers` line, then its two rows', async () => {
  const ctx = await amended()
  const lines = bodyLines(ctx)

  // The fixture, stated rather than assumed.
  assert.equal(
    COUNT_LINE, 'Amendments: 2 from workers',
    '(a) [M3] the fixture no longer holds the two rows this leg was written against',
  )

  assert.equal(
    countExact(lines, COUNT_LINE), 1,
    `(a) [M3] a card whose report holds ${AMENDMENTS.length} \`amendments\` rows must carry `
    + `EXACTLY ONE line \`${COUNT_LINE}\`\n${lines.join('\n')}`,
  )
  assert.equal(
    countExact(lines, NONE_LINE), 0,
    `(a) [M3] a card with rows must not also carry \`${NONE_LINE}\``,
  )

  // A blank line, then one line per row in the REPORT's order — and that block,
  // whole, is what M3 spells.
  const i = at(lines, COUNT_LINE)
  assert.deepEqual(
    lines.slice(i, i + 2 + EXPECTED_ROWS.length), [COUNT_LINE, '', ...EXPECTED_ROWS],
    '(a) [M3] the count line must be followed by a blank line and then exactly one '
    + '`- task <id> — <amends>: <what> — <why>` line per row, in the report\'s order',
  )

  // Exactly those rows and no other: no third `- task ` line anywhere in the body.
  assert.deepEqual(
    lines.filter((l) => l.startsWith('- task ')), EXPECTED_ROWS,
    '(a) [M3] the body\'s `- task ` lines must be exactly the report\'s two rows',
  )

  // The newline inside row one's `what` is rendered as a space, on one line —
  // the assertion that fails for a card that passed the field through whole.
  assert.ok(
    AMENDMENTS[0].what.includes('\n'),
    '(a) [M3] the fixture\'s first `what` no longer carries a newline',
  )
  assert.ok(
    lines.includes(EXPECTED_ROWS[0]),
    `(a) [M3] row one's \`what\` must be rendered on ONE line with its newline replaced by a `
    + `space:\n  want: ${EXPECTED_ROWS[0]}\n  got:  `
    + `${JSON.stringify(lines.filter((l) => l.startsWith('- task 1 ')))}`,
  )
  for (const piece of flat(AMENDMENTS[0].what).split(' ')) {
    assert.ok(
      EXPECTED_ROWS[0].includes(piece),
      `(a) [M3] the rig lost a word of row one's \`what\`: ${piece}`,
    )
  }
})

test('(a) [M3] the Amendments line sits below the Residuals line and its errand, above the record', async () => {
  const ctx = await amended()
  const lines = bodyLines(ctx)

  const residuals = at(lines, RESIDUAL_COUNT_LINE)
  const errand = lines.findIndex((l) => l.startsWith(ERRAND_PREFIX))
  const amendments = at(lines, COUNT_LINE)
  const record = at(lines, RECORD_LINE)

  assert.ok(residuals >= 0, `(a) [M3] the amended card carries no \`${RESIDUAL_COUNT_LINE}\` line`)
  assert.ok(errand >= 0, `(a) [M3] the amended card carries no \`${ERRAND_PREFIX}\` errand line`)
  assert.ok(amendments >= 0, `(a) [M3] the amended card carries no \`${COUNT_LINE}\` line`)
  assert.ok(record >= 0, `(a) [M3] the amended card carries no \`${RECORD_LINE}\` line`)

  assert.ok(
    amendments > residuals,
    `(a) [M3] the \`Amendments:\` line must come AFTER the \`Residuals:\` line `
    + `(Residuals ${residuals}, Amendments ${amendments})`,
  )
  assert.ok(
    amendments > errand,
    `(a) [M3] the \`Amendments:\` line must come AFTER the \`- \` errand lines the residual count `
    + `draws (errand ${errand}, Amendments ${amendments})`,
  )
  assert.ok(
    amendments < record,
    `(a) [M3] the \`Amendments:\` line must come BEFORE the \`${RECORD_LINE}\` line `
    + `(Amendments ${amendments}, record ${record})`,
  )
  // And so must its rows: the whole block is above the fold.
  for (const row of EXPECTED_ROWS) {
    assert.ok(
      at(lines, row) < record,
      `(a) [M3] every row line must stand above the folded record: ${row}`,
    )
  }
})

// ── leg (b) — M3: no rows, one word ──────────────────────────────────────────

test('(b) [M3] the default green card carries one `Amendments: none` line and no row', async () => {
  const ctx = await greenAsync()
  const lines = bodyLines(ctx)

  // The premise, stated rather than assumed: the rig's default report carries
  // no `amendments` key at all — the absent-list half of M3's second clause.
  assert.ok(
    !Object.prototype.hasOwnProperty.call(JSON.parse(DEFAULT_REPORT), 'amendments'),
    '(b) [M3] the rig\'s DEFAULT_REPORT is expected to carry no `amendments` key',
  )

  assert.equal(
    countExact(lines, NONE_LINE), 1,
    `(b) [M3] a card whose report names no \`amendments\` must carry EXACTLY ONE line `
    + `\`${NONE_LINE}\`\n${lines.join('\n')}`,
  )
  assert.ok(
    !/^Amendments: \d/m.test(lines.join('\n')),
    `(b) [M3] a card with no rows must carry no \`Amendments: <n> from workers\` line`,
  )
  assert.deepEqual(
    lines.filter((l) => l.startsWith('- task ')), [],
    '(b) [M3] a card with no rows must carry no `- task ` line at all',
  )

  const none = at(lines, NONE_LINE)
  const record = at(lines, RECORD_LINE)
  assert.ok(record >= 0, `(b) [M3] the default card carries no \`${RECORD_LINE}\` line`)
  assert.ok(
    none < record,
    `(b) [M3] the \`${NONE_LINE}\` line must stand above the folded record `
    + `(Amendments ${none}, record ${record})`,
  )
})

// ── leg (c) — M4: the residuals, the ledger and the record are what they were ─

test('(c) [M4] the amended run renders `Residuals: 1 from review` and the ack\'s one errand line', async () => {
  const ctx = await amended()
  const lines = bodyLines(ctx)

  // The count is read from the reviewers' notes and the acks ALONE: one ack,
  // one residual, whatever the report's `amendments` holds.
  assert.equal(
    countExact(lines, RESIDUAL_COUNT_LINE), 1,
    `(c) [M4] a green run with one \`deferred:external\` ack must render EXACTLY ONE line `
    + `\`${RESIDUAL_COUNT_LINE}\` — the two \`amendments\` rows are counted into no residual`
    + `\n${lines.join('\n')}`,
  )
  const errands = lines.filter((l) => l.startsWith(ERRAND_PREFIX))
  assert.deepEqual(
    errands, [ERRAND_LINE],
    `(c) [M4] the ack must draw exactly one errand line, \`${ERRAND_LINE}\``,
  )
  // The checklist a merge closes with the PR, unchanged: the ack's item, alone.
  assert.deepEqual(
    lines.filter((l) => l.startsWith('- [ ] ')), [CHECKLIST_LINE],
    '(c) [M4] the residual checklist must be the ack\'s one item and nothing else — no amendment '
    + 'is a checklist item',
  )

  // Both of them BEFORE the `Amendments:` line: never between the `Residuals:`
  // line and its errand.
  const amendments = at(lines, COUNT_LINE)
  assert.ok(amendments >= 0, `(c) [M4] the amended card carries no \`${COUNT_LINE}\` line`)
  assert.ok(
    at(lines, RESIDUAL_COUNT_LINE) < amendments && at(lines, ERRAND_LINE) < amendments,
    `(c) [M4] the \`Residuals:\` line and its errand line must BOTH stand before the `
    + `\`Amendments:\` line (Residuals ${at(lines, RESIDUAL_COUNT_LINE)}, errand `
    + `${at(lines, ERRAND_LINE)}, Amendments ${amendments})`,
  )
})

test('(c) [M4] the amended run\'s residuals.jsonl holds the one deferred row and no amendment', async () => {
  const ctx = await amended()
  const rows = residualRows(ctx)

  assert.equal(
    rows.length, 1,
    `(c) [M4] the ledger must hold EXACTLY ONE row — the ack's\n${residualsRaw(ctx)}`,
  )
  assert.equal(
    rows[0].kind, 'deferred',
    `(c) [M4] that row's \`kind\` must be \`deferred\`: ${JSON.stringify(rows[0])}`,
  )
  assert.equal(
    rows[0].text, ACK_DETAIL,
    `(c) [M4] that row's \`text\` must be the ack's detail: ${JSON.stringify(rows[0])}`,
  )

  // And no row mentioning an amendment: `residual_read` reads `gateCheck.acks`,
  // `completenessFindings` and the merged tasks' `notes`, and never `amendments`.
  const raw = residualsRaw(ctx)
  assert.ok(
    !raw.includes('amend'),
    `(c) [M4] no row of the ledger may mention an amendment at all\n${raw}`,
  )
  for (const row of AMENDMENTS) {
    for (const field of [flat(row.what), flat(row.why)]) {
      assert.ok(
        !raw.includes(field),
        `(c) [M4] no row of the ledger may carry an amendment's text: ${field}\n${raw}`,
      )
    }
  }
})

test('(c) [M4] the default run still renders `Residuals: none`, and both records are unchanged', async () => {
  const [plain, rows] = await Promise.all([greenAsync(), amended()])

  const plainLines = bodyLines(plain)
  assert.equal(
    countExact(plainLines, RESIDUAL_NONE_LINE), 1,
    `(c) [M4] the default green card must still carry EXACTLY ONE line \`${RESIDUAL_NONE_LINE}\``
    + `\n${plainLines.join('\n')}`,
  )
  assert.ok(
    !/^Residuals: \d/m.test(plainLines.join('\n')),
    '(c) [M4] the default green card must carry no `Residuals: <n> from review` line',
  )
  assert.deepEqual(
    plainLines.filter((l) => l.startsWith('- [ ] ')), [],
    '(c) [M4] the default green card must carry no checklist item',
  )

  // The record block is the same as without the key: its sections, in order,
  // in both bodies.
  for (const [what, lines] of [['default', plainLines], ['amended', bodyLines(rows)]]) {
    const record = at(lines, RECORD_LINE)
    assert.ok(record >= 0, `(c) [M4] the ${what} card carries no record block`)
    const seen = RECORD_SECTIONS.map((section) => at(lines, section))
    for (const [i, section] of RECORD_SECTIONS.entries()) {
      assert.ok(
        seen[i] > record,
        `(c) [M4] the ${what} card's \`${section}\` section must stand inside the record block`,
      )
      if (i > 0) {
        assert.ok(
          seen[i] > seen[i - 1],
          `(c) [M4] the ${what} card's record sections must read `
          + `${RECORD_SECTIONS.join(', ')} in that order — got ${JSON.stringify(seen)}`,
        )
      }
    }
  }
})

// ── legs (d), (e), (f) — the readers the driver runs, verbatim ───────────────

/**
 * The Proof's fifth through eighth `Run:` lines, copied character for
 * character, each beside the leg and clause it belongs to. These are the
 * driver's own readers of the two documents; running them here is what makes
 * the exam red at BASE for the documents too, and not only for the card.
 */
const READERS = [
  [
    '(d)', 'M1',
    'fleet/CONTRACT.md\'s evidence sub-bullet must carry, between the "three more kinds" '
    + 'paragraph and the `state-exams/` line, a paragraph naming '
    + '`driver:amendment` `{task, amends, what, why}`, the three `amends` values, the hub issue '
    + 'and the report\'s `amendments` list',
    "sed -n '/^    The driver.s own executions are three more kinds/,/^    .state-exams\\//p'"
    + " fleet/CONTRACT.md | tr '\\n' ' '"
    + " | grep -q 'driver:amendment.*task, amends, what, why.*clause.*files.*sim.*hub issue.*amendments'",
  ],
  [
    '(e)', 'M3',
    'fleet/CONTRACT.md\'s Publish bullet must name `Amendments: <n> from workers` and '
    + '`Amendments: none`, after its `Residuals: <n> from review` sentence',
    "sed -n '/^- \\*\\*Publish:\\*\\*/,/^- \\*\\*Integration naming:\\*\\*/p' fleet/CONTRACT.md"
    + " | tr '\\n' ' '"
    + " | grep -q 'Residuals: <n> from review.*Amendments: <n> from workers.*Amendments: none'",
  ],
  [
    '(f)', 'M2',
    'skills/ultrapowers/references/report-format.md\'s schema must carry the `amendments` array',
    'grep -q \'"amendments": { "type": "array"\' skills/ultrapowers/references/report-format.md',
  ],
  [
    '(f)', 'M2',
    'skills/ultrapowers/references/report-format.md\'s field table must carry an `amendments` row '
    + 'between the `judgmentCalls` and `unfinished` rows, naming the four fields and `never gated`',
    "sed -n '/^| .judgmentCalls. | no |/,/^| .unfinished. | yes |/p'"
    + ' skills/ultrapowers/references/report-format.md'
    + " | grep -q '^| .amendments. | no |.*task.*amends.*what.*why.*never gated'",
  ],
]

test('(d) [M1] the CONTRACT.md evidence sub-bullet names the driver:amendment event', () => {
  runReader(0)
})

test('(e) [M3] the CONTRACT.md Publish bullet names both Amendments lines', () => {
  runReader(1)
})

test('(f) [M2] the report reference carries the amendments schema and its field-table row', () => {
  runReader(2)
  runReader(3)
})

/** One reader of the table above, run the way the driver runs it. */
function runReader(index) {
  const [leg, clause, what, cmd] = READERS[index]
  const r = spawnSync('bash', ['-c', cmd], { cwd: ROOT, encoding: 'utf8', timeout: 60000, env: ENV })
  assert.equal(
    r.status, 0,
    `${leg} [${clause}] ${what}\n  $ ${cmd}\n${r.stdout || ''}${r.stderr || ''}`,
  )
}

// ── leg (g) — M3: the edited script, still a script ──────────────────────────

test('(g) [M3] the edited boot script still parses as bash', () => {
  // THE LEG ITSELF IS THE DRIVER'S. It names the Proof's second, third and
  // fourth `Run:` lines — the three boot sims of BASE, still green on the edited
  // script — and the bridge runs those three lines itself. This file may not:
  // `fleet/tests/test_sims_are_hermetic.mjs` M4 forbids a sim from running, or
  // even naming for an existence check, a sibling sim.
  //
  // What is left here is the one reading of the edited script this exam can
  // make on its own, and the one every other boot sim depends on: the script
  // the three of them source still parses. Lines spliced into `card_head`'s
  // `python3` program with an unbalanced quote fail here before they fail there.
  const script = path.relative(ROOT, SCRIPT)
  const r = spawnSync('bash', ['-n', script], { cwd: ROOT, encoding: 'utf8', timeout: 60000, env: ENV })
  assert.equal(
    r.status, 0,
    `(g) [M3] \`bash -n ${script}\` must be clean — the three boot sims the Proof re-runs all `
    + `source this file\n${r.stdout || ''}${r.stderr || ''}`,
  )
})

runTests(tests)
