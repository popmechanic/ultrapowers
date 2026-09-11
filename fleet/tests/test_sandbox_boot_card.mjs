/**
 * fleet/tests/test_sandbox_boot_card.mjs — the card reads for a person.
 *
 * The claim: a fleet PR opens with the summary the operator signed, then
 * whether it is merge-ready, then the sentence they signed, then one row per
 * task saying what was promised and how it was proved; the reviewers' notes
 * are a count, and every sha and receipt is folded away below.
 *
 * The clauses this file pins, and the legs that pin them:
 *
 *   M1  the body's FIRST non-empty line is the plan's `**Summary:**` paragraph
 *       without the label, and a plan carrying no such paragraph puts
 *       `_No summary was signed with this plan._` there.               leg (a)
 *   M2  the SECOND non-empty line is the answer line — `**Merged** <sha>`,
 *       `**Merge-ready**`, `**Held:** <text>` (the merge note minus its
 *       `left open: ` prefix) or `**Parked:** <error>`.                leg (b)
 *   M3  the THIRD non-empty line is `> ` and the plan's `**Claim:**` sentence
 *       with its provenance tag removed.                              leg (c)
 *   M4  then the task table: the header `| task | claim | exam | probes |
 *       mutant | suite |`, one row per `### Task` of the plan IN PLAN ORDER,
 *       and every cell as M4 spells it — including the run whose `report.json`
 *       is absent, whose record cells are all `—` and whose card is still a
 *       card.                                                          leg (d)
 *   M5  then `Residuals: <n> from review`, and above the record only the
 *       `deferred:external` items and the items of a task row whose `actor` is
 *       `plan` — no other reviewer or critic sentence anywhere above it.
 *                                                                      leg (e)
 *   M6  then `<details><summary>Record</summary>`, carrying today's whole body
 *       in today's order, and the `Closes #<n>` lines after `</details>` as the
 *       body's last lines.                                             leg (f)
 *   M7  `fleet/CONTRACT.md`'s `- **Publish:**` bullet describes that order, and
 *       `tests/test_docs_agree_with_code.py`'s residuals-order pin reads the
 *       new order.                                                     leg (g)
 *   M8  neither `skills/ultrapowers/SKILL.md` nor `README.md` says `checks are
 *       green`, and each says `merges itself` … `own gate is green` … `main has
 *       not moved` in its own scoped range.                            leg (h)
 *
 * THE RIG is `_sandbox_boot_helpers.mjs`, and this exam reaches the card
 * through three of its knobs and one hand-written page:
 *
 *   STUB_PLAN_EXTRA    the plan text, appended to the stub plan's `# <H1>` and
 *                      `body` lines. Every case here writes its OWN plan —
 *                      its Claim, its Summary paragraph, its `### Task`
 *                      headings — rather than reading the rig's stub plan, so
 *                      no leg of this exam depends on what some other sim's
 *                      fixture happens to carry.
 *   STUB_GATE_RECEIPT  the receipt `### Checks` fences and the acks the
 *                      residuals line counts.
 *   STUB_REPORT        the report the table is read from. SET BUT EMPTY is no
 *                      report at all, which is leg (d)'s last row.
 *   www/status.json    seeded by hand for the one case M2 cannot otherwise
 *                      reach — a page whose `merged` cell already carries a
 *                      sha when the card is rendered.
 *
 * Each scenario is booted ONCE, memoised, and asked its questions afterwards;
 * the boots overlap three at a time, so this file's wall is the slowest of them
 * rather than the sum of all of them.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  HEAD_SHA, MERGE_SHA, PR_URL, PR_AUTHOR, RUN_PATH, VM_NAME, INTEGRATION_BRANCH,
  makeHome, bootAsync,
  prPosts, patches, statusOf, stream, mergePuts, evidenceDir,
  runTests,
} from './_sandbox_boot_helpers.mjs'

const tests = []
const test = (name, fn) => tests.push([name, fn])

const HERE = path.dirname(fileURLToPath(import.meta.url))
/** The checkout this exam grades: `fleet/tests/` is two levels down. */
const REPO = path.resolve(HERE, '..', '..')

// ── the plan, as this exam writes it ─────────────────────────────────────────
//
// `plan_summary`, `plan_claim` and `task_claims` all read `PLAN_FILE`, which is
// what `git show <plan>:.ultrapowers/plan.md` handed back — the rig's stub plan
// plus `STUB_PLAN_EXTRA`. So a plan here is a list of lines, and the header
// block's order is ultrawrite's: the Claim, the Summary paragraph, the Goal and
// the Closes line, then the tasks.
//
// The `Machine:` line under each task's Claim is deliberate: `task_claims`
// takes the first `**Claim:**` line after a `### Task <id>:` heading and NOT
// the clause line that follows it, so every task here has one to leave behind.

/** A plan's text, as `STUB_PLAN_EXTRA` carries it.
 *
 *  `summary` null is a plan that signed none — leg (a)'s second half. `tasks`
 *  is `[id, claim]` pairs, written in the order the card must read them. */
const planExtra = ({ claim, summary, tasks }) => {
  const out = ['']
  if (claim) out.push(`**Claim:** ${claim}`, '')
  // The paragraph ends at the next blank line, so there is one.
  if (summary) out.push(`**Summary:** ${summary}`, '')
  out.push('**Goal:** the card reads for a person', '**Closes:** #660 #668')
  for (const [id, text] of tasks) {
    out.push('', `### Task ${id}: the ${id}th task`, '', '**Type:** implementation', '',
      `**Claim:** ${text}`, `Machine: M1. this line is not part of task ${id}'s claim.`)
  }
  return out.join('\n')
}

/** The two issues every plan here closes, in the plan's own order. */
const CLOSES_LINES = ['Closes #660', 'Closes #668']

/** The summary paragraph the card opens with, and the label-less line it is. */
const SUMMARY = 'The PR opens with what I signed and folds its receipts away below.'
/** M1's fallback, for the plan that signed none. */
const NO_SUMMARY_LINE = '_No summary was signed with this plan._'

/** The plan-level Claim, and the line M3 makes of it: `> ` and the sentence
 *  with its provenance tag gone. */
const CLAIM = 'A fleet PR reads for a person before it reads for a machine.'
const CLAIM_LINE = `> ${CLAIM}`
/** The same sentence under the other tag M3 names. */
const QUOTED_CLAIM = 'A reader of the PR is told what was promised and how it was proved.'
const QUOTED_CLAIM_LINE = `> ${QUOTED_CLAIM}`

// ── M4's table ───────────────────────────────────────────────────────────────

const TABLE_HEADER = '| task | claim | exam | probes | mutant | suite |'

/** The five claims of the matrix plan — one task per `exam` value M4 spells,
 *  each tagged, because a tag that survived into a cell is a failing leg. */
const MATRIX_CLAIMS = [
  'The exam went red at BASE and the task turned it green.',
  'The exam went red at BASE and the task did not finish.',
  'The exam was already green at BASE.',
  'The task was blocked before it ran.',
  'The task named no exam at all.',
]
const MATRIX_TAGS = ['(derived)', '(quoted from #660)', '(derived)', '(elicited)', '(derived)']

/** The matrix plan: five tasks, in plan order. */
const MATRIX_PLAN = planExtra({
  claim: `${CLAIM} (elicited)`,
  summary: SUMMARY,
  tasks: MATRIX_CLAIMS.map((c, i) => [String(i + 1), `${c} ${MATRIX_TAGS[i]}`]),
})

/**
 * The record the matrix table is read from — one report covering every cell
 * value M4 names.
 *
 *   task 1  `exam` red + `status` done          → `red at BASE → green`
 *           two `integratedRuns`, both exit 0   → `2/2`
 *           two `stateExams`, both killed       → `killed`
 *           wave 1, whose `suite.passed` is true → `green`
 *   task 2  `exam` red + `status` failed        → `red at BASE, task failed`
 *           two runs, one non-zero              → `1/2`
 *           two `stateExams`, one `false`       → `SURVIVED`
 *           wave 2, red with an unattributed path → `red, unattributed`
 *   task 3  `exam` green-at-base                → `green at BASE`
 *           no runs, no `stateExams`            → `—`, `—`
 *           wave 3, red with NO unattributed    → `red`
 *   task 4  `exam` blocked                      → `blocked`
 *   task 5  `exam` null                         → `none`
 *           both in wave 4, which has no `suite` → `—`
 *
 * `waves` is the task ids per wave, so a task's wave is the 1-based index of
 * the list holding its id — never a cell on the row.
 */
const MATRIX_REPORT = JSON.stringify({
  stamp: 'run-7',
  tasks: [
    {
      task: '1',
      status: 'done',
      exam: 'red',
      reviewVerdict: 'pass',
      stateExams: [{ mutant_killed: true }, { mutant_killed: true }],
    },
    {
      task: '2',
      status: 'failed',
      exam: 'red',
      reviewVerdict: 'pass',
      stateExams: [{ mutant_killed: true }, { mutant_killed: false }],
    },
    { task: '3', status: 'done', exam: 'green-at-base', reviewVerdict: 'pass', stateExams: [] },
    { task: '4', status: 'blocked', exam: 'blocked', stateExams: [] },
    { task: '5', status: 'done', exam: null, reviewVerdict: 'pass', stateExams: [] },
  ],
  waves: [['1'], ['2'], ['3'], ['4', '5']],
  waveMerges: [
    { wave: 1, status: 'merged', suite: { passed: true, output: 'ok' } },
    { wave: 2, status: 'merged', suite: { passed: false, unattributed: ['tests/x.py'], output: 'red' } },
    { wave: 3, status: 'merged', suite: { passed: false, unattributed: [], output: 'red' } },
    { wave: 4, status: 'merged' },
  ],
  integratedRuns: [
    { task: '1', cmd: 'node one.mjs', exit: 0, stdout: '' },
    { task: '1', cmd: 'node two.mjs', exit: 0, stdout: '' },
    { task: '2', cmd: 'node three.mjs', exit: 0, stdout: '' },
    { task: '2', cmd: 'node four.mjs', exit: 1, stdout: '' },
  ],
})

/** The five rows that record owes the five tasks of that plan, in plan order. */
const MATRIX_ROWS = [
  `| 1 | ${MATRIX_CLAIMS[0]} | red at BASE → green | 2/2 | killed | green |`,
  `| 2 | ${MATRIX_CLAIMS[1]} | red at BASE, task failed | 1/2 | SURVIVED | red, unattributed |`,
  `| 3 | ${MATRIX_CLAIMS[2]} | green at BASE | — | — | red |`,
  `| 4 | ${MATRIX_CLAIMS[3]} | blocked | — | — | — |`,
  `| 5 | ${MATRIX_CLAIMS[4]} | none | — | — | — |`,
]

// The two-task plan of leg (d)'s ordering row, and the run with NO report at
// all. Its two Claims carry the two tags the leg names.
const TWO_CLAIMS = [
  'The first task of the plan is the first row of the table.',
  'The second task of the plan is the second row.',
]
const TWO_PLAN = planExtra({
  claim: `${CLAIM} (elicited)`,
  summary: SUMMARY,
  tasks: [['1', `${TWO_CLAIMS[0]} (derived)`], ['2', `${TWO_CLAIMS[1]} (quoted from #660)`]],
})
/** With no `report.json` there is no record cell to read, so every one is `—`
 *  and the rows are still the plan's. */
const TWO_ROWS = [
  `| 1 | ${TWO_CLAIMS[0]} | — | — | — | — |`,
  `| 2 | ${TWO_CLAIMS[1]} | — | — | — | — |`,
]

// ── M5's residuals, the seven-item fixture ───────────────────────────────────
//
// The same two documents `test_sandbox_boot_residuals.mjs` reads — three acks
// of which the middle one is `deferred:runtime`, three critic findings of which
// the middle one is blocking, and three task rows of which the middle one
// failed — with ONE addition: the third task's row carries `actor` `plan`, so
// its reviewer piece is a plan defect and belongs above the record beside the
// two external acks.

const ACK_ONE = 'live verb record — the lobby answered only on the edge'
  + ' [structural false-green: sandbox could not execute it against the target]'
const ACK_TWO = 'usage endpoint — read only through the edge'
  + ' [structural false-green: sandbox could not execute it against the target]'

const RESIDUAL_RECEIPT = JSON.stringify({
  verdict: 'PASS',
  gateCheck: {
    acks: [
      { type: 'deferred:external', detail: ACK_ONE },
      { type: 'deferred:runtime', detail: 'runtime-only-B — never listed' },
      { type: 'deferred:external', detail: ACK_TWO },
    ],
  },
})

const CRITIC_ONE = 'critic-C: the exam covers the success path only'
const CRITIC_TWO = 'critic-C2: no negative row for the 404'
const REVIEWER_E1 = 'E1 dup insert'
const REVIEWER_E2 = 'E2 semantic miss'
const REVIEWER_G3 = 'G3 comment names the wrong file'

const RESIDUAL_REPORT = JSON.stringify({
  stamp: 'run-7',
  completenessFindings: [
    { severity: 'minor', detail: CRITIC_ONE },
    { severity: 'blocking', detail: 'blocking-D' },
    { severity: 'minor', detail: CRITIC_TWO },
  ],
  tasks: [
    { task: '1', status: 'done', exam: 'red', stateExams: [], notes: `${REVIEWER_E1}; ${REVIEWER_E2}` },
    { task: '2', status: 'failed', exam: 'red', stateExams: [], notes: 'failed-F' },
    // THE PLAN DEFECT: `actor` is `plan` only on a row a reviewer charged to
    // the plan rather than to the task, and M5 puts its items above the record.
    { task: '3', status: 'done', exam: 'green-at-base', stateExams: [], actor: 'plan', notes: REVIEWER_G3 },
  ],
})

const RESIDUAL_PLAN = planExtra({
  claim: `${CLAIM} (elicited)`,
  summary: SUMMARY,
  tasks: [['1', 'The first task. (derived)'], ['2', 'The second task. (derived)'],
    ['3', 'The third task. (derived)']],
})

/** The seven `- [ ] ` lines that record renders, in order — the whole
 *  checklist, which stays whole INSIDE the record.  [M5, M6] */
const CHECKLIST = [
  `- [ ] deferred:external — ${ACK_ONE}`,
  `- [ ] deferred:external — ${ACK_TWO}`,
  `- [ ] critic — ${CRITIC_ONE}`,
  `- [ ] critic — ${CRITIC_TWO}`,
  `- [ ] task 1 reviewer — ${REVIEWER_E1}`,
  `- [ ] task 1 reviewer — ${REVIEWER_E2}`,
  `- [ ] task 3 reviewer — ${REVIEWER_G3}`,
]
/** The count line those seven earn: every item `residual_read checklist`
 *  lists, whatever its kind.  [M5] */
const RESIDUAL_COUNT_LINE = 'Residuals: 7 from review'
/** And the only items that may appear above the record: the two external acks
 *  and the plan-actor task's piece.  [M5] */
const ACTIONABLE = [
  `- deferred:external — ${ACK_ONE}`,
  `- deferred:external — ${ACK_TWO}`,
  `- task 3 reviewer — ${REVIEWER_G3}`,
]
/** The four sentences that may NOT: the critic's two and the two pieces of a
 *  task row no reviewer charged to the plan.  [M5] */
const SUPPRESSED = [CRITIC_ONE, CRITIC_TWO, REVIEWER_E1, REVIEWER_E2]
/** What a run with no residual at all says instead.  [M5] */
const NO_RESIDUALS_LINE = 'Residuals: none'

// ── M2's four answers ────────────────────────────────────────────────────────

/** The unattributed red that holds a gate-green PR open, and the note the hold
 *  leaves — whose text, minus the `left open: ` prefix, is the answer line. */
const RED_PATH = 'tests/other.py'
const HELD_NOTE = `left open: suite red, unattributed: ${RED_PATH}`
const HELD_LINE = `**Held:** suite red, unattributed: ${RED_PATH}`
const HELD_RECEIPT = JSON.stringify({
  verdict: 'PASS',
  suite: { passed: false, unattributed: [RED_PATH], output: 'red' },
})
const HELD_REPORT = JSON.stringify({
  stamp: 'run-7',
  tests: {
    output: [
      '=================================== FAILURES ===================================',
      '_________________________ test_the_other_thing _________________________',
      '>       assert compute() == 2',
      'E       assert 1 == 2',
      '',
      'tests/other.py:4: AssertionError',
      '=========================== short test summary info ============================',
    ].join('\n'),
  },
})

const MERGE_READY_LINE = '**Merge-ready**'
const MERGED_LINE = `**Merged** ${MERGE_SHA}`

/** A one-task plan, for the cases that read only the answer line. */
const onePlan = (claim) => planExtra({
  claim,
  summary: SUMMARY,
  tasks: [['1', 'The only task of this plan. (derived)']],
})

// ── the scenarios, all in flight at once ─────────────────────────────────────
//
// A boot is ~40 forks of stub shell, so each scenario is started where it is
// declared and every leg awaits only the one it asks about. `started`
// memoises the PROMISE and settles it into a thunk, so a scenario whose boot
// failed throws inside the leg that reads it rather than tearing the process
// down while another leg is on the clock.

const started = (make) => {
  const settled = make().then((value) => () => value, (error) => () => { throw error })
  return () => settled.then((r) => r())
}

/** Three boots at a time — fork-bound work on a four-vCPU sandbox. */
const WIDTH = 3
let inFlight = 0
const waiting = []
const pump = () => {
  while (inFlight < WIDTH && waiting.length) {
    inFlight += 1
    waiting.shift()()
  }
}
const acquire = () => new Promise((admit) => { waiting.push(admit); pump() })
const release = () => { inFlight -= 1; pump() }

/**
 * A boot under `env`, started now and memoised: resolves to its home with the
 * run's result hung on it as `result`. `seed` is run against the home before
 * the boot, for the one case that needs a page on the box first.
 */
const scenario = (env, seed) => started(() => {
  const ctx = makeHome()
  if (seed) seed(ctx)
  return acquire()
    .then(() => bootAsync(ctx, ['boot'], env).finally(release))
    .then((result) => { ctx.result = result; return ctx })
})

/** The run every leg reads first: gate-green, five tasks, the matrix record,
 *  no residual at all. Its merge is never held, so its answer line is M2's
 *  `**Merge-ready**`. */
const matrix = scenario({ STUB_PLAN_EXTRA: MATRIX_PLAN, STUB_REPORT: MATRIX_REPORT })

/** The same run with a plan that signed NO summary — and whose Claim carries
 *  the other provenance tag M3 names.  [legs (a), (c)] */
const noSummary = scenario({
  STUB_PLAN_EXTRA: planExtra({
    claim: `${QUOTED_CLAIM} (quoted from #660)`,
    summary: null,
    tasks: [['1', 'The only task of this plan. (derived)']],
  }),
  STUB_REPORT: MATRIX_REPORT,
})

/** Two tasks, tagged the two ways, and NO `report.json` at all: leg (d)'s
 *  ordering row and its missing-record row in one boot. */
const twoTasks = scenario({ STUB_PLAN_EXTRA: TWO_PLAN, STUB_REPORT: '' })

/** The seven-item fixture.  [legs (e), (f)] */
const residuals = scenario({
  STUB_PLAN_EXTRA: RESIDUAL_PLAN,
  STUB_GATE_RECEIPT: RESIDUAL_RECEIPT,
  STUB_REPORT: RESIDUAL_REPORT,
})

/** The gate passed on a red no task owns: a READY PR, no PUT, and the body
 *  re-patched with the hold on it.  [legs (b), (f)] */
const held = scenario({
  STUB_PLAN_EXTRA: onePlan(`${CLAIM} (elicited)`),
  STUB_GATE_RECEIPT: HELD_RECEIPT,
  STUB_REPORT: HELD_REPORT,
})

/**
 * The one page M2's first answer needs: `merged` already carrying a sha when
 * the card is rendered.
 *
 * `render_card` runs BEFORE this run's own merge PUT — a one-attempt run keeps
 * the body it POSTed — so the `merged` cell a card can read is one a previous
 * pass over this run left on the page. `do_boot` reads `pr`, `prAuthor`,
 * `merged`, `startedAt` and `vm` off the page it finds and carries them
 * forward; a page with a `merged` sha and no `pr` is therefore a run that
 * publishes (there is no PR to be idempotent about) and does not merge again
 * (`merge_pr` returns on the sha it already holds). Nothing else about the run
 * changes.
 */
const mergedPage = (ctx) => {
  fs.mkdirSync(path.join(ctx.home, 'www'), { recursive: true })
  fs.writeFileSync(path.join(ctx.home, 'www', 'status.json'), JSON.stringify({
    run: '7', state: 'publishing', phase: 'carried forward', pr: null, prAuthor: null,
    merged: MERGE_SHA, branch: INTEGRATION_BRANCH, vm: VM_NAME,
    startedAt: '2026-09-06T00:00:00Z', updatedAt: '2026-09-06T00:00:01Z', error: null,
  }))
}
const merged = scenario(
  { STUB_PLAN_EXTRA: onePlan(`${CLAIM} (elicited)`), STUB_REPORT: MATRIX_REPORT },
  mergedPage,
)

/** A verdict short of PASS with no approve receipt: the outcome is `parked` and
 *  the PR is a draft.  [leg (b)] */
const parked = scenario({
  STUB_PLAN_EXTRA: onePlan(`${CLAIM} (elicited)`),
  STUB_VERDICT: 'NEEDS_ACK',
  STUB_REPORT: MATRIX_REPORT,
})

/** A run whose first PUT was refused for a base that moved: two fold attempts,
 *  a second PUT that took, and a body re-patched with the fold on it.
 *  [leg (f)] */
const foldAgain = scenario({
  STUB_PLAN_EXTRA: onePlan(`${CLAIM} (elicited)`),
  STUB_REPORT: MATRIX_REPORT,
  STUB_TIP: HEAD_SHA,
  STUB_MERGE_CODE: '405',
  STUB_MERGE_MESSAGE: 'Base branch was modified',
})

// ── readers ──────────────────────────────────────────────────────────────────

const why = (ctx) => `\n--- stdout\n${ctx.result.stdout}\n--- stderr\n${ctx.result.stderr}`

/** The body of the one PR this run POSTed — what GitHub was handed. */
const posted = (ctx, leg) => {
  assert.equal(ctx.result.status, 0, `${leg}: the boot did not exit 0${why(ctx)}`)
  const posts = prPosts(ctx)
  assert.equal(posts.length, 1, `${leg}: expected exactly one POST /pulls${why(ctx)}`)
  return posts[0].body
}

/** The body of the LAST PATCH this run sent — the card as it stands once the
 *  merge decision is in. */
const patched = (ctx, leg) => {
  assert.equal(ctx.result.status, 0, `${leg}: the boot did not exit 0${why(ctx)}`)
  const all = patches(ctx)
  assert.ok(all.length >= 1,
    `${leg}: this run's disposition lands after the POST, so its body is PATCHed —`
      + ` and no PATCH was sent${why(ctx)}`)
  return all[all.length - 1].body
}

const nonEmpty = (body) => body.split('\n').filter((l) => l.trim() !== '')

/** The card's first three lines, as M1, M2 and M3 count them. */
const openingOf = (body) => nonEmpty(body).slice(0, 3)

const isDelimiter = (line) => /^\|[\s|:-]+\|$/.test(line.trim())

/**
 * The task table: the header's index, its rows, and the index of the first line
 * after them.
 *
 * A markdown table needs a delimiter row under its header to render at all
 * (`render_card`'s metadata table writes `|---|---|`), so one is skipped when
 * it is there; everything else beginning `|` is a row, and the rows stop at the
 * first line that does not.
 */
function tableOf(body, leg) {
  const all = body.split('\n')
  const at = all.indexOf(TABLE_HEADER)
  assert.ok(at >= 0,
    `${leg}: no line of the body is exactly M4's header\n  ${TABLE_HEADER}\n---\n${body}`)
  let i = at + 1
  if (i < all.length && isDelimiter(all[i])) i += 1
  const rows = []
  for (; i < all.length && all[i].startsWith('|'); i += 1) rows.push(all[i].trimEnd())
  return { at, rows, after: i }
}

const RECORD_OPEN = '<details><summary>Record</summary>'
const RECORD_CLOSE = '</details>'

/**
 * The body cut at the record: what is above the `<details>` line, what is
 * inside the block, and what follows `</details>`.
 */
function recordOf(body, leg) {
  const all = body.split('\n')
  const open = all.findIndex((l) => l.trim() === RECORD_OPEN)
  assert.ok(open >= 0,
    `${leg}: no line of the body is the record's opening \`${RECORD_OPEN}\`\n---\n${body}`)
  assert.equal(all.filter((l) => l.trim() === RECORD_OPEN).length, 1,
    `${leg}: exactly one line opens the record\n---\n${body}`)
  const close = all.findIndex((l, i) => i > open && l.trim() === RECORD_CLOSE)
  assert.ok(close > open,
    `${leg}: the record is opened and never closed — no \`${RECORD_CLOSE}\` after it\n---\n${body}`)
  return {
    above: all.slice(0, open),
    inside: all.slice(open + 1, close),
    below: all.slice(close + 1),
  }
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
        : `\`${needle}\` does not appear after the literal before it`
    }
    at = i + needle.length
  }
  return null
}

const readRepoFile = (rel) => {
  const f = path.join(REPO, rel)
  assert.ok(fs.existsSync(f), `${f} does not exist`)
  return fs.readFileSync(f, 'utf8')
}
/** A range of lines joined the way the Proof's `tr '\n' ' '` joins it, with
 *  runs of whitespace collapsed — so an order assertion is not an assertion
 *  about where a document wraps. */
const oneLine = (all) => all.join(' ').replace(/\s+/g, ' ').trim()

/** The lines from the first line satisfying `from` to the first line after it
 *  satisfying `to`, inclusive of the first and exclusive of the second. */
function rangeOf(text, from, to, what) {
  const all = text.split('\n')
  const start = all.findIndex(from)
  assert.ok(start >= 0, `${what}: the range's first line is not in the file`)
  const end = all.findIndex((l, i) => i > start && to(l))
  assert.ok(end > start, `${what}: the range's last line is not in the file after its first`)
  return all.slice(start, end)
}

// ═════════════════════════════════════════════════════════════════════════════
// (a) the first line is the summary the operator signed  [M1]
// ═════════════════════════════════════════════════════════════════════════════

test('the body\'s first non-empty line is the plan\'s Summary paragraph without its label  [M1 / leg (a)]', async () => {
  const ctx = await matrix()
  const leg = '(a) [M1]'
  const body = posted(ctx, leg)
  assert.equal(nonEmpty(body)[0], SUMMARY,
    `${leg} the card opens on the paragraph the plan's \`**Summary:** \` line carries, with`
      + ` the label gone and nothing of the record above it\n---\n${body}`)
  // The label itself is not what a reader is shown.
  assert.ok(!nonEmpty(body)[0].includes('**Summary:**'),
    `${leg} and the label is stripped, not printed: ${nonEmpty(body)[0]}`)
})

test('a plan that signed no Summary opens on `_No summary was signed with this plan._`  [M1 / leg (a)]', async () => {
  const ctx = await noSummary()
  const leg = '(a) [M1]'
  const body = posted(ctx, leg)
  assert.equal(nonEmpty(body)[0], NO_SUMMARY_LINE,
    `${leg} a plan with no \`**Summary:**\` paragraph puts M1's own sentence there — never the`
      + ` heading, never an empty first line\n---\n${body}`)
})

test('the card on disk is the body that was POSTed  [M1 / leg (a)]', async () => {
  const ctx = await matrix()
  const leg = '(a) [M1]'
  const body = posted(ctx, leg)
  // The premise every other leg reads through the payload: `render_card` writes
  // `<evidence dir>/pr-body.md` and `publish` sends that file.
  const file = path.join(evidenceDir(ctx), RUN_PATH, 'pr-body.md')
  assert.ok(fs.existsSync(file), `${leg} the card is written to ${file}${why(ctx)}`)
  assert.equal(fs.readFileSync(file, 'utf8').replace(/\n$/, ''), body.replace(/\n$/, ''),
    `${leg} and the POSTed body is that file, byte for byte`)
})

// ═════════════════════════════════════════════════════════════════════════════
// (b) the second line answers "is it merge-ready?"  [M2]
// ═════════════════════════════════════════════════════════════════════════════

test('a gate-green run with no note before its merge answers `**Merge-ready**`  [M2 / leg (b)]', async () => {
  const ctx = await matrix()
  const leg = '(b) [M2]'
  const body = posted(ctx, leg)
  assert.equal(nonEmpty(body)[1], MERGE_READY_LINE,
    `${leg} the verdict is PASS and no note holds the merge, so the second non-empty line is`
      + ` exactly \`${MERGE_READY_LINE}\`\n---\n${body}`)
})

test('a run whose page already carries a merged sha answers `**Merged** <sha>`  [M2 / leg (b)]', async () => {
  const ctx = await merged()
  const leg = '(b) [M2]'
  const body = posted(ctx, leg)
  // The premise: the sha on the page is the one the card read, and this run
  // issued no PUT of its own.
  assert.equal(statusOf(ctx).merged, MERGE_SHA,
    `${leg} the page carries the merged sha the card had to read${why(ctx)}`)
  assert.equal(mergePuts(ctx).length, 0,
    `${leg} and this run made no merge PUT of its own${why(ctx)}`)
  assert.equal(nonEmpty(body)[1], MERGED_LINE,
    `${leg} a page whose \`merged\` cell is a sha makes the answer line \`**Merged** <sha>\` —`
      + ` the sha, not the word \`merged\`, and not \`${MERGE_READY_LINE}\`\n---\n${body}`)
})

test('a gate-green run held on an unattributed red answers `**Held:** <text>`  [M2 / leg (b)]', async () => {
  const ctx = await held()
  const leg = '(b) [M2]'
  // The hold lands after the POST, so the card that carries it is the PATCH.
  const body = patched(ctx, leg)
  assert.equal(mergePuts(ctx).length, 0,
    `${leg} the premise: an unattributed red issues no PUT${why(ctx)}`)
  assert.ok(String(statusOf(ctx).phase).endsWith(HELD_NOTE),
    `${leg} and the note this run holds is \`${HELD_NOTE}\`: ${statusOf(ctx).phase}`)
  assert.equal(nonEmpty(body)[1], HELD_LINE,
    `${leg} the answer line is the note with its \`left open: \` prefix removed, and it is a`
      + ` LINE of the card, never a \`## Held\` heading\n---\n${body}`)
  // The first render could not know the hold: M2 is read at the time the card
  // is rendered, and `patch_pr_body` is what makes it right.
  assert.equal(nonEmpty(posted(ctx, leg))[1], MERGE_READY_LINE,
    `${leg} the body POSTed before the merge decision still reads \`${MERGE_READY_LINE}\``)
})

test('a parked run answers `**Parked:** <error>`  [M2 / leg (b)]', async () => {
  const ctx = await parked()
  const leg = '(b) [M2]'
  const body = posted(ctx, leg)
  assert.equal(statusOf(ctx).state, 'parked', `${leg} the premise: the outcome is parked${why(ctx)}`)
  assert.equal(prPosts(ctx)[0].draft, true, `${leg} and its PR is a draft`)
  const line = nonEmpty(body)[1]
  // `<error>` is the status page's `error` cell, and `ERROR` is set WITH the
  // outcome — before the `write_status publishing` that precedes the publish —
  // so the cell the card read is the one the page still carries. A bare
  // `**Parked:**` is the ordering bug that move fixed, and a placeholder is not
  // M2's line.
  const error = statusOf(ctx).error
  assert.ok(error,
    `${leg} the premise: the page carries the parked \`error\` the card quotes${why(ctx)}`)
  assert.equal(line.replace(/[ \t]+$/, ''), `**Parked:** ${error}`,
    `${leg} a run that is not gate-green answers \`**Parked:** <error>\` with the page's own`
      + ` \`error\` — never a bare \`**Parked:**\`, never \`${MERGE_READY_LINE}\`:`
      + `\n  ${JSON.stringify(line)}\n---\n${body}`)
})

// ═════════════════════════════════════════════════════════════════════════════
// (c) the third line is the Claim  [M3]
// ═════════════════════════════════════════════════════════════════════════════

test('the third non-empty line is `> ` and the plan\'s Claim with `(elicited)` stripped  [M3 / leg (c)]', async () => {
  const ctx = await matrix()
  const leg = '(c) [M3]'
  const body = posted(ctx, leg)
  assert.deepEqual(openingOf(body), [SUMMARY, MERGE_READY_LINE, CLAIM_LINE],
    `${leg} the card's first three lines are the summary, the answer and the Claim — the`
      + ` Claim quoted with \`> \` and its provenance tag gone\n---\n${body}`)
})

test('a Claim tagged `(quoted from #660)` is stripped the same way  [M3 / leg (c)]', async () => {
  const ctx = await noSummary()
  const leg = '(c) [M3]'
  const body = posted(ctx, leg)
  assert.equal(nonEmpty(body)[2], QUOTED_CLAIM_LINE,
    `${leg} \`(quoted from #NNN)\` is a provenance tag too, and no tag reaches the card`
      + `\n---\n${body}`)
})

// ═════════════════════════════════════════════════════════════════════════════
// (d) the table: one row per task, every cell as M4 spells it  [M4]
// ═════════════════════════════════════════════════════════════════════════════

test('the header follows the Claim and the rows are the plan\'s tasks, every cell read from the record  [M4 / leg (d)]', async () => {
  const ctx = await matrix()
  const leg = '(d) [M4]'
  const body = posted(ctx, leg)
  const table = tableOf(body, leg)
  // The table opens where M4 puts it: after the three lines above it.
  assert.equal(nonEmpty(body)[3], TABLE_HEADER,
    `${leg} the header is the card's fourth non-empty line\n---\n${body}`)
  assert.deepEqual(table.rows, MATRIX_ROWS,
    `${leg} one row per \`### Task\` of the plan, in plan order, and each of the five cells`
      + ` read as M4 reads it — the exam's five spellings, \`<passed>/<total>\` over this`
      + ` task's \`integratedRuns\`, \`killed\`/\`SURVIVED\`/\`—\` over its \`stateExams\`,`
      + ` and the \`suite\` of the wave whose list holds its id\n---\n${body}`)
})

test('two tasks are two rows in plan order, tags stripped, and a missing report leaves every record cell `—`  [M4 / leg (d)]', async () => {
  const ctx = await twoTasks()
  const leg = '(d) [M4]'
  const body = posted(ctx, leg)
  // The premise: this run wrote no report at all.
  const report = path.join(evidenceDir(ctx), RUN_PATH, 'report.json')
  assert.ok(!fs.existsSync(report),
    `${leg} the premise: the engine left no ${report}${why(ctx)}`)
  assert.deepEqual(tableOf(body, leg).rows, TWO_ROWS,
    `${leg} the plan's two tasks are the table's two rows — \`1\` then \`2\`, their Claims`
      + ` with \`(derived)\` and \`(quoted from #660)\` gone, no third row — and a record`
      + ` nobody can read is \`—\` in every record cell\n---\n${body}`)
})

test('a missing report leaves no traceback anywhere in the run  [M4 / leg (d)]', async () => {
  const ctx = await twoTasks()
  const leg = '(d) [M4]'
  assert.equal(ctx.result.status, 0, `${leg}: the boot did not exit 0${why(ctx)}`)
  const everything = [ctx.result.stdout, ctx.result.stderr, stream(ctx).join('\n')].join('\n')
  assert.ok(!everything.includes('Traceback (most recent call last)'),
    `${leg} the reader of an absent \`report.json\` answers a table of \`—\` cells, never a`
      + ` traceback:\n${everything}`)
})

// ═════════════════════════════════════════════════════════════════════════════
// (e) the residuals are a count, and only the actionable ones are above  [M5]
// ═════════════════════════════════════════════════════════════════════════════

test('the count line follows the table and lists every item review left  [M5 / leg (e)]', async () => {
  const ctx = await residuals()
  const leg = '(e) [M5]'
  const body = posted(ctx, leg)
  const table = tableOf(body, leg)
  const after = body.split('\n').slice(table.after).filter((l) => l.trim() !== '')
  assert.equal(after[0], RESIDUAL_COUNT_LINE,
    `${leg} the line after the table counts every item \`residual_read checklist\` lists —`
      + ` the two external acks, the two critic findings and the three reviewer pieces`
      + `\n---\n${body}`)
})

test('only the `deferred:external` items and the plan-actor task\'s items sit above the record  [M5 / leg (e)]', async () => {
  const ctx = await residuals()
  const leg = '(e) [M5]'
  const body = posted(ctx, leg)
  const { above } = recordOf(body, leg)
  const at = above.findIndex((l) => l.trim() === RESIDUAL_COUNT_LINE)
  assert.ok(at >= 0, `${leg} the count line sits above the record\n---\n${body}`)
  const listed = above.slice(at + 1).filter((l) => l.trim() !== '')
  assert.deepEqual(listed, ACTIONABLE,
    `${leg} exactly the two \`deferred:external\` items and the items of the task row whose`
      + ` \`actor\` is \`plan\`, each \`- <name> — <text>\`, and nothing else between the count`
      + ` line and the record\n---\n${body}`)
  // And no other `- ` line of any kind reaches the part of the body a person
  // reads first.
  assert.deepEqual(above.filter((l) => l.startsWith('- ')), ACTIONABLE,
    `${leg} and those three are the only \`- \` lines anywhere above the record`
      + `\n---\n${body}`)
})

test('no other reviewer or critic sentence appears above the record  [M5 / leg (e)]', async () => {
  const ctx = await residuals()
  const leg = '(e) [M5]'
  const body = posted(ctx, leg)
  const above = recordOf(body, leg).above.join('\n')
  for (const text of SUPPRESSED) {
    assert.ok(!above.includes(text),
      `${leg} \`${text}\` is a critic finding or a reviewer piece no task row charged to the`
        + ` plan, so it is on the record's checklist and NOWHERE above it\n--- above the`
        + ` record\n${above}`)
  }
  // It is not lost: the record still carries all seven.
  assert.deepEqual(recordOf(body, leg).inside.filter((l) => l.startsWith('- [ ] ')), CHECKLIST,
    `${leg} the whole checklist still renders inside the record\n---\n${body}`)
})

test('a run with no residual at all reads `Residuals: none`  [M5 / leg (e)]', async () => {
  const ctx = await matrix()
  const leg = '(e) [M5]'
  const body = posted(ctx, leg)
  const table = tableOf(body, leg)
  const after = body.split('\n').slice(table.after).filter((l) => l.trim() !== '')
  assert.equal(after[0], NO_RESIDUALS_LINE,
    `${leg} zero items is a line too — the reader is told there is nothing to do, not left`
      + ` to infer it from a missing line\n---\n${body}`)
})

// ═════════════════════════════════════════════════════════════════════════════
// (f) the record, folded away, in today's order  [M6]
// ═════════════════════════════════════════════════════════════════════════════

test('the record carries today\'s whole body, in today\'s order, inside the details block  [M6 / leg (f)]', async () => {
  const ctx = await residuals()
  const leg = '(f) [M6]'
  const body = posted(ctx, leg)
  const { above, inside } = recordOf(body, leg)
  const problem = outOfOrder(inside.join('\n'), [
    '## fleet ',
    '| verdict |', '| target |', '| engine |', '| plan |', '| branch |', '| vm |',
    '### Checks', '```json',
    '### Evidence',
    '### Plan',
    '### Residuals',
  ])
  assert.equal(problem, null,
    `${leg} inside the record, in order: the \`## fleet <run> — <outcome>\` heading, the six`
      + ` metadata rows, \`### Checks\` and its \`json\` fence, \`### Evidence\`, \`### Plan\``
      + ` and \`### Residuals\` — ${problem}\n--- inside the record\n${inside.join('\n')}`)
  // Nothing of the record is above it: the heading and the metadata table are
  // the first things a person must NOT be shown.
  for (const literal of ['## fleet ', '| verdict |', '```json', '### Evidence', '### Plan',
    '### Residuals']) {
    assert.ok(!above.join('\n').includes(literal),
      `${leg} \`${literal}\` belongs inside the record, and it appears above it`
        + `\n--- above the record\n${above.join('\n')}`)
  }
})

test('the `Closes #` lines follow `</details>` as the body\'s last lines  [M6 / leg (f)]', async () => {
  const ctx = await residuals()
  const leg = '(f) [M6]'
  const body = posted(ctx, leg)
  const { below } = recordOf(body, leg)
  assert.deepEqual(below.filter((l) => l.trim() !== ''), CLOSES_LINES,
    `${leg} the self-merge closes what the plan names, so the \`Closes #\` lines are the`
      + ` body's last lines and they are OUTSIDE the record\n---\n${body}`)
})

test('the held run\'s `## Held` section is inside the record and nowhere above it  [M6 / leg (f)]', async () => {
  const ctx = await held()
  const leg = '(f) [M6]'
  const body = patched(ctx, leg)
  const { above, inside } = recordOf(body, leg)
  assert.equal(inside.filter((l) => l.trim() === '## Held').length, 1,
    `${leg} the section a held run owes its reader is still rendered, once, inside the`
      + ` record\n---\n${body}`)
  assert.equal(above.filter((l) => l.includes('## Held')).length, 0,
    `${leg} and no \`## Held\` heading is above the record — the answer line is`
      + ` \`**Held:** <text>\`\n---\n${body}`)
})

test('a two-attempt run\'s `## Publish fold` section is inside the record and nowhere above it  [M6 / leg (f)]', async () => {
  const ctx = await foldAgain()
  const leg = '(f) [M6]'
  const body = patched(ctx, leg)
  const { above, inside } = recordOf(body, leg)
  assert.ok(inside.some((l) => l.trim() === '## Publish fold'),
    `${leg} a run whose fold receipt records two attempts still renders its fold section,`
      + ` inside the record\n---\n${body}`)
  assert.equal(above.filter((l) => l.includes('## Publish fold') || l.startsWith('- merge: ')).length, 0,
    `${leg} and neither its heading nor a \`- merge: \` line is above the record`
      + `\n---\n${body}`)
})

// ═════════════════════════════════════════════════════════════════════════════
// (g) the two documents that declare the order  [M7]
// ═════════════════════════════════════════════════════════════════════════════

/** The contract's `- **Publish:**` bullet, flattened — the same range
 *  `tests/test_docs_agree_with_code.py` and the other boot sims slice. */
const publishBullet = () => oneLine(rangeOf(
  readRepoFile('fleet/CONTRACT.md'),
  (l) => l.startsWith('- **Publish:**'),
  (l) => l.startsWith('- **Integration naming'),
  '`fleet/CONTRACT.md`\'s `- **Publish:**` bullet',
))

test('the contract\'s `- **Publish:**` bullet reads the card\'s order  [M7 / leg (g)]', () => {
  const bullet = publishBullet()
  const order = [
    '**Summary:**', 'Merge-ready', TABLE_HEADER, 'Residuals:', '<details>',
    '### Residuals', 'deferred:external', 'Closes #',
  ]
  const problem = outOfOrder(bullet, order)
  assert.equal(problem, null,
    `(g) [M7] the bullet is where the PR body's sections are declared, and it declares them`
      + ` in the body's own order — ${JSON.stringify(order)} — ${problem}\n---\n${bullet}`)
})

test('the docs exam\'s residuals-order pin reads the new order  [M7 / leg (g)]', () => {
  const pin = 'Residuals:.*<details>.*### Residuals.*deferred:external.*Closes #'
  const docsTest = readRepoFile('tests/test_docs_agree_with_code.py')
  assert.ok(docsTest.includes(pin),
    `(g) [M7] \`tests/test_docs_agree_with_code.py\`'s residuals-order assertion carries the`
      + ` regex \`${pin}\`; a pin that still reads only \`### Residuals\` … \`Closes #\``
      + ` cannot tell the new order from the old`)
})

// ═════════════════════════════════════════════════════════════════════════════
// (h) the two sentences that named a check run  [M8]
// ═════════════════════════════════════════════════════════════════════════════

/** The two files the phrase is pinned out of, and the range of each that has to
 *  say what the merge really reads. */
const M8_FILES = ['skills/ultrapowers/SKILL.md', 'README.md']
const M8_LITERALS = ['merges itself', 'own gate is green', 'main has not moved']

test('neither the skill nor the README says `checks are green`  [M8 / leg (h)]', () => {
  // Both files are read before the assertion, so a survivor is named rather
  // than waiting behind the other file's fix.
  const carrying = M8_FILES.flatMap((rel) => readRepoFile(rel)
    .split('\n')
    .map((l, i) => `${rel}:${i + 1}: ${l}`)
    .filter((l) => l.includes('checks are green')))
  assert.deepEqual(carrying, [],
    `(h) [M8] the sandbox asks GitHub for no check runs — it compares main's tip to the tip it`
      + ` folded onto — so no line of either operator document may say \`checks are green\`,`
      + ` and these do:\n${carrying.join('\n')}`)
})

test('the skill\'s step 4 says `merges itself` … `own gate is green` … `main has not moved`  [M8 / leg (h)]', () => {
  const range = oneLine(rangeOf(
    readRepoFile('skills/ultrapowers/SKILL.md'),
    (l) => l.startsWith('4. **The PR is the gate.**'),
    (l) => l.startsWith('5. **Reap.**'),
    '`skills/ultrapowers/SKILL.md`\'s step 4',
  ))
  const problem = outOfOrder(range, M8_LITERALS)
  assert.equal(problem, null,
    `(h) [M8] step 4 is where the skill says how a PR merges itself, and the mechanism is the`
      + ` run's own gate and a main that has not moved — ${problem}\n---\n${range}`)
})

test('the README\'s `### 4. Build` section says the same three, in the same order  [M8 / leg (h)]', () => {
  const range = oneLine(rangeOf(
    readRepoFile('README.md'),
    (l) => l.startsWith('### 4. Build'),
    (l) => l.startsWith('### '),
    '`README.md`\'s `### 4. Build` section',
  ))
  const problem = outOfOrder(range, M8_LITERALS)
  assert.equal(problem, null,
    `(h) [M8] the README's build section tells a reader the same mechanism — ${problem}`
      + `\n---\n${range}`)
})

runTests(tests)
