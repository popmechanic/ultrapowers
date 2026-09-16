/**
 * fleet/tests/test_sandbox_boot_card_cells.mjs — the exam for run-156 task 3,
 * "The pull request card says which task no reviewer read" (#836, the
 * operator's pick of 2026-09-15: the card should say the reviewer was skipped
 * because the mutant was killed, rendered inside the EXISTING mutant cell —
 * one cell, no new column, so the CONTRACT's table header and every card of a
 * past run keep their shape).
 *
 * CLAIM. When I open the run's pull request, the task table's mutant cell
 * tells me a task's reviewer was skipped because its mutant was killed.
 *
 * Three machine clauses, read here leg by leg and nowhere else:
 *
 *   M1  on the PR body the boot POSTs, the task table row of a `report.json`
 *       task whose `stateExams` every element reads `mutant_killed: true` and
 *       whose `reviewVerdict` is `skipped-mutant-killed` carries the mutant
 *       cell `killed, reviewer skipped`                          → leg (a)
 *   M2  a row with every `mutant_killed: true` and any other `reviewVerdict`
 *       (`approve`, the rig's default) carries the cell `killed`, as at BASE;
 *       a row whose `stateExams` holds a `mutant_killed: false` element and
 *       whose `reviewVerdict` IS `skipped-mutant-killed` carries the cell
 *       `SURVIVED`, the verdict notwithstanding                  → leg (b)
 *   M3  `fleet/CONTRACT.md`'s Publish card paragraph — the one that spells
 *       `| task | claim | exam | probes | mutant | suite |` — says the mutant
 *       cell reads `killed, reviewer skipped` when the row's `reviewVerdict`
 *       is `skipped-mutant-killed`                               → leg (c)
 *
 * THREE BOOTS, NO MORE. A boot is ~40 forks of stub shell, so the legs that
 * need one share exactly three — two started here and the rig's own shared
 * green one — and each is started ONCE and awaited by everyone who reads it,
 * the shape every sandbox-boot sim uses:
 *
 *   SKIPPED   the rig's `DEFAULT_REPORT` with its `approve` verdict replaced
 *             by `skipped-mutant-killed`, its one `stateExams` element still
 *             `mutant_killed: true`. Leg (a) reads it.
 *   SURVIVED  that same report with its `mutant_killed` flipped to `false`,
 *             so the survivor stands BESIDE the skip verdict. Leg (b)'s
 *             second half reads it.
 *   DEFAULT   the rig's shared default green boot (`greenAsync`), whose one
 *             row is `approve` and `mutant_killed: true`. Leg (b)'s first half
 *             reads it.
 *
 * THE FIXTURES ARE EDITS OF THE RIG'S OWN REPORT, NOT COPIES OF IT. Each is
 * `DEFAULT_REPORT` put through `replace`, and `edit()` below asserts the
 * needle was there exactly once and that the string actually changed — so a
 * fixture that moves under this exam fails loudly here rather than quietly
 * booting the default report a second time and passing leg (b) twice.
 *
 * LEG (b) IS GREEN AT BASE, ON PURPOSE. It is M2's regression half: the card
 * at BASE already renders `killed` for the default row and `SURVIVED` for the
 * survivor, and this exam pins both so the edit M1 asks for cannot be bought
 * by keying on the verdict before the survivor check, or by moving the new
 * branch above the `SURVIVED` and dash branches. Legs (a) and (c) are the ones
 * red at BASE.
 *
 * THE ROWS ARE PINNED WHOLE. Every row assertion is an equality against the
 * entire `| … |` line, not a containment of the mutant cell, so a card that
 * bought the new cell by disturbing the claim, exam, probes or suite cell
 * fails here too.
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import {
  SCRIPT, ENV, DEFAULT_REPORT, PLAN_TASK_ID, PLAN_TASK_CLAIM,
  makeHome, bootAsync, greenAsync,
  prPosts, runTests,
} from './_sandbox_boot_helpers.mjs'

const tests = []
const test = (name, fn) => tests.push([name, fn])

/** The checkout, from the script the rig points at — `fleet/sandbox-boot.sh`. */
const ROOT = path.resolve(SCRIPT, '..', '..')

// ── the wave's shared literals ───────────────────────────────────────────────

/**
 * The verdict string Task 1's engine writes on a row whose reviewer it skipped
 * because the mutant was killed (`tasks[].reviewVerdict`). This task never
 * needs that engine — the card reads a `report.json` the rig's sim writes —
 * but the literal is the same one, and it is the literal M1 and M3 name.
 */
const SKIP_VERDICT = 'skipped-mutant-killed'
/** The rig's default verdict, which M2's first row keeps. */
const APPROVE_VERDICT = 'approve'
/** What M1 says the mutant cell reads; `killed` and `SURVIVED` are BASE's. */
const SKIPPED_CELL = 'killed, reviewer skipped'
const KILLED_CELL = 'killed'
const SURVIVED_CELL = 'SURVIVED'
/** The half of the new cell that must appear nowhere on an M2 card. */
const SKIP_PHRASE = 'reviewer skipped'

// ── the two reports this exam boots on ───────────────────────────────────────

/**
 * One `replace` of the rig's report, with the premise stated rather than
 * assumed: the needle is present EXACTLY once and the result differs. A
 * fixture that moves out from under this exam fails here, by name, instead of
 * handing some leg the default report under another variable.
 */
const edit = (source, needle, replacement, leg) => {
  const hits = source.split(needle).length - 1
  assert.equal(
    hits, 1,
    `${leg} the rig's DEFAULT_REPORT must carry \`${needle}\` exactly once — found ${hits}; `
    + `the fixture this exam was written against has moved\n${source}`,
  )
  const edited = source.replace(needle, replacement)
  assert.notEqual(
    edited, source,
    `${leg} replacing \`${needle}\` with \`${replacement}\` changed nothing`,
  )
  return edited
}

/** M1's row: every `mutant_killed: true`, and the skip verdict. */
const SKIPPED_REPORT = edit(
  DEFAULT_REPORT,
  `"reviewVerdict":"${APPROVE_VERDICT}"`,
  `"reviewVerdict":"${SKIP_VERDICT}"`,
  '(a) [M1]',
)

/** M2's second row: a `mutant_killed: false` element BESIDE the skip verdict. */
const SURVIVED_REPORT = edit(
  SKIPPED_REPORT,
  '"mutant_killed":true',
  '"mutant_killed":false',
  '(b) [M2]',
)

// ── what M1 and M2 say the table row reads ───────────────────────────────────

/**
 * The Proof's own row, character for character. The rig's plan signs ONE task
 * `1` whose Claim is `PLAN_TASK_CLAIM`, the report gives it a green `red` exam
 * on a `done` status, one `integratedRuns` entry with `exit: 0` and a green
 * `waveMerges` row — so every cell but the mutant one is fixed, and this line
 * differs from the default green card's in that cell alone.
 */
const EXPECTED_SKIPPED_ROW =
  '| 1 | The smoke target grows the one file the plan names. '
  + '| red at BASE → green | 1/1 | killed, reviewer skipped | green |'

/** The same row with the mutant cell swapped — the rendering rule, not a copy. */
const rowWith = (mutant) =>
  `| ${PLAN_TASK_ID} | ${PLAN_TASK_CLAIM} | red at BASE → green | 1/1 | ${mutant} | green |`

/** The prefix that finds the one task row of the card's table. */
const ROW_PREFIX = `| ${PLAN_TASK_ID} | `

/** The table header M3 names, and the row under it, as the card writes them. */
const TABLE_HEADER = '| task | claim | exam | probes | mutant | suite |'

// ── the two boots this exam starts ───────────────────────────────────────────

/** One green boot on `report`, started once and awaited by every reader. */
const memo = (report, what) => {
  let started = null
  return () => {
    if (!started) {
      const ctx = makeHome()
      started = bootAsync(ctx, ['boot'], { STUB_REPORT: report }).then((r) => {
        assert.equal(
          r.status, 0,
          `the ${what} run did not finish\n${r.stdout}${r.stderr}`,
        )
        return ctx
      })
    }
    return started
  }
}

const skipped = memo(SKIPPED_REPORT, 'skipped-verdict')
const survived = memo(SURVIVED_REPORT, 'survivor-beside-skip')

// ── reading the card ─────────────────────────────────────────────────────────

/** The one PR body this run POSTed, as its lines. */
const bodyLines = (ctx) => {
  const posts = prPosts(ctx)
  assert.equal(posts.length, 1, `the run opened ${posts.length} PRs, not one`)
  return String(posts[0].body).split('\n')
}

/** The card's one task row, which must be exactly one line. */
const taskRow = (lines, leg) => {
  const found = lines.filter((l) => l.startsWith(ROW_PREFIX))
  assert.equal(
    found.length, 1,
    `${leg} the card's table must carry EXACTLY ONE line starting \`${ROW_PREFIX}\` — `
    + `found ${found.length}\n${lines.join('\n')}`,
  )
  assert.ok(
    lines.includes(TABLE_HEADER),
    `${leg} the card must still carry its table header \`${TABLE_HEADER}\``,
  )
  return found[0]
}

// ── leg (a) — M1: the skipped reviewer, named in the mutant cell ─────────────

test('(a) [M1] a killed mutant whose verdict is skipped-mutant-killed renders `killed, reviewer skipped`', async () => {
  // The fixture, stated rather than assumed: every `stateExams` element of the
  // row this boot runs on reads `mutant_killed: true`, and the verdict is the
  // skip one. Without both, this leg would be leg (b)'s second half wearing
  // leg (a)'s name.
  const row = JSON.parse(SKIPPED_REPORT).tasks[0]
  assert.equal(
    row.reviewVerdict, SKIP_VERDICT,
    `(a) [M1] the fixture's row must carry \`reviewVerdict: ${SKIP_VERDICT}\``,
  )
  assert.ok(
    Array.isArray(row.stateExams) && row.stateExams.length > 0
      && row.stateExams.every((e) => e.mutant_killed === true),
    `(a) [M1] every \`stateExams\` element of the fixture must read \`mutant_killed: true\`: `
    + JSON.stringify(row.stateExams),
  )

  // And the Proof's verbatim row is the rendering rule applied to that fixture,
  // so the literal below is the clause and not a second copy of it.
  assert.equal(
    EXPECTED_SKIPPED_ROW, rowWith(SKIPPED_CELL),
    '(a) [M1] the Proof\'s verbatim row and the rig\'s plan fixture no longer agree',
  )

  const lines = bodyLines(await skipped())
  assert.equal(
    taskRow(lines, '(a) [M1]'), EXPECTED_SKIPPED_ROW,
    `(a) [M1] the row of a task whose \`stateExams\` are every \`mutant_killed: true\` and whose `
    + `\`reviewVerdict\` is \`${SKIP_VERDICT}\` must carry the mutant cell \`${SKIPPED_CELL}\` — `
    + `a card that ignores the verdict renders \`${KILLED_CELL}\`\n${lines.join('\n')}`,
  )
})

// ── leg (b) — M2: the two rows the new cell must not take ────────────────────

test('(b) [M2] the shared default green card still renders `killed`, and says `reviewer skipped` nowhere', async () => {
  // The premise: the rig's default row is the killed mutant with ANY OTHER
  // verdict — `approve`.
  const row = JSON.parse(DEFAULT_REPORT).tasks[0]
  assert.equal(
    row.reviewVerdict, APPROVE_VERDICT,
    `(b) [M2] the rig's DEFAULT_REPORT is expected to carry \`reviewVerdict: ${APPROVE_VERDICT}\``,
  )
  assert.ok(
    row.stateExams.every((e) => e.mutant_killed === true),
    '(b) [M2] the rig\'s DEFAULT_REPORT is expected to carry a killed mutant',
  )

  const lines = bodyLines(await greenAsync())
  assert.equal(
    taskRow(lines, '(b) [M2]'), rowWith(KILLED_CELL),
    `(b) [M2] a row with every \`mutant_killed: true\` and any other \`reviewVerdict\` must carry `
    + `the mutant cell \`${KILLED_CELL}\`, as at BASE\n${lines.join('\n')}`,
  )
  assert.ok(
    !lines.join('\n').includes(SKIP_PHRASE),
    `(b) [M2] the default green card must say \`${SKIP_PHRASE}\` nowhere at all\n`
    + lines.join('\n'),
  )
})

test('(b) [M2] a survivor beside a skipped-mutant-killed verdict still renders `SURVIVED`', async () => {
  // The premise: the row carries a `mutant_killed: false` element AND the skip
  // verdict. This is the pairing a card keying on the verdict before the
  // survivor check gets wrong.
  const row = JSON.parse(SURVIVED_REPORT).tasks[0]
  assert.equal(
    row.reviewVerdict, SKIP_VERDICT,
    `(b) [M2] the survivor fixture must carry \`reviewVerdict: ${SKIP_VERDICT}\``,
  )
  assert.ok(
    row.stateExams.some((e) => e.mutant_killed === false),
    `(b) [M2] the survivor fixture must hold a \`mutant_killed: false\` element: `
    + JSON.stringify(row.stateExams),
  )

  const lines = bodyLines(await survived())
  assert.equal(
    taskRow(lines, '(b) [M2]'), rowWith(SURVIVED_CELL),
    `(b) [M2] a row whose \`stateExams\` holds a \`mutant_killed: false\` element must carry the `
    + `mutant cell \`${SURVIVED_CELL}\`, the \`${SKIP_VERDICT}\` verdict notwithstanding — the `
    + `\`SURVIVED\` branch comes first and is untouched\n${lines.join('\n')}`,
  )
  assert.ok(
    !lines.join('\n').includes(SKIP_PHRASE),
    `(b) [M2] a card whose mutant survived must say \`${SKIP_PHRASE}\` nowhere at all, whatever `
    + `the verdict reads\n${lines.join('\n')}`,
  )
})

// ── leg (c) — M3: the reader the driver runs, verbatim ───────────────────────

/**
 * The Proof's second `Run:` line, copied character for character: the
 * CONTRACT's card paragraph read from its table line to the `Residuals:`
 * sentence, folded to one line, carrying `mutant`, then `skipped-mutant-killed`,
 * then `killed, reviewer skipped`, in that order. Running it here is what makes
 * this exam red at BASE for the document too, and not only for the card.
 */
const CONTRACT_READER =
  "sed -n '/| task | claim | exam | probes | mutant | suite |/,/Residuals: <n> from review/p'"
  + " fleet/CONTRACT.md | tr '\\n' ' '"
  + " | grep -q 'mutant.*skipped-mutant-killed.*killed, reviewer skipped'"

test('(c) [M3] the CONTRACT\'s Publish card paragraph says what the mutant cell reads on a skipped reviewer', () => {
  // The paragraph exists to be read: without its table line the `sed` range is
  // empty and the grep would fail for the wrong reason.
  const contract = fs.readFileSync(path.join(ROOT, 'fleet', 'CONTRACT.md'), 'utf8')
  assert.ok(
    contract.includes(TABLE_HEADER),
    `(c) [M3] fleet/CONTRACT.md must still spell the card's table header \`${TABLE_HEADER}\``,
  )

  const r = spawnSync('bash', ['-c', CONTRACT_READER], {
    cwd: ROOT, encoding: 'utf8', timeout: 60000, env: ENV,
  })
  assert.equal(
    r.status, 0,
    `(c) [M3] the Publish card paragraph — the one spelling \`${TABLE_HEADER}\` — must say that `
    + `the mutant cell reads \`${SKIPPED_CELL}\` when the row's \`reviewVerdict\` is `
    + `\`${SKIP_VERDICT}\`, in that order and in the register the paragraph already has`
    + `\n  $ ${CONTRACT_READER}\n${r.stdout || ''}${r.stderr || ''}`,
  )
})

runTests(tests)
