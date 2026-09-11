// fleet/tests/test_run_engine_exam_concern.mjs — an `exam:` concern beside a
// still-red exam buys a reviewer, not a park.
//
// The exam is written against the task's Machine clauses, leg by leg. Every
// assertion below names the leg it belongs to and the clause it comes from, so
// a reader can map this file back to the contract:
//
//   M1 — when the pre-review pass after `fix:<id>:0` still has the exam red
//        (its `reds` carry the `the Proof's exam failed:` line) and that fix
//        round's reply is `DONE_WITH_CONCERNS` with at least one `concerns`
//        entry whose text begins `exam:`, the driver does not return
//        `reviewVerdict: 'proof-red'`; it pushes one `judgmentCalls` entry
//        containing `exam concern` and the task id, then enters review round 1
//        (`review:<id>:1` is dispatched) reading that second pass's evidence.
//   M2 — the round-1 review prompt carries, for each such entry, one line
//        `EXAM CONCERN: <entry verbatim>`, and every such line sits after the
//        `EXAM EVIDENCE:` block's header line; a review prompt of a task whose
//        fix round returned no `exam:` entry carries no line beginning
//        `EXAM CONCERN: `.
//   M3 — round 1 FIX_REQUIRED with one blocking `implementer` issue carrying a
//        `proposedPatch`, and a `fix:<id>:1` that rewrites the exam so the
//        round-2 exam exits 0: the row reads `status: 'done'`,
//        `reviewVerdict: 'fixed'`, `proofFixes: 1`, `fixIterations: 1`,
//        `examEdited` exactly that path, `coverage.tasks_merged` 1, the
//        `review:<id>:2` prompt carries `EXAM EDITED: <path>` and
//        `EXAM EDITED DIFF <path>:`, and the integration branch holds the
//        rewritten exam bytes.
//   M4 — the same run with a `fix:<id>:0` reply of `DONE` (no concerns) and the
//        exam still red ends `status: 'failed'`, `reviewVerdict: 'proof-red'`,
//        `proofFixes: 1`, with no `review:` label ever dispatched and
//        `coverage.tasks_merged` 0.
//   M5 — the same run as M3 but with a round-1 reviewer that returns `PASS` and
//        a `fix:<id>:1` that leaves the exam red ends `status: 'failed'`,
//        `reviewVerdict: 'fix-loop-exhausted'`, `examEdited` `[]`, and
//        `coverage.tasks_merged` 0.
//   M6 — `fleet/roles/reviewer.md` carries `EXAM CONCERN:` with `proposedPatch`
//        within the 600 characters that follow it (newlines read as spaces),
//        and the two named `report-format.md` table rows carry `EXAM CONCERN`.
//
// Legs: (a) M1, (b) M2, (c) M2, (d) M3, (e) M4, (f) M5, (g)(h)(i) M6.
//
// Everything below the agent seam is real (git, clones, capture, the real `sh`,
// the fold kernel, the blob shas, the red-at-BASE exam run); only the judgments
// are canned. The default `rolesDir` holds all seven role files, so the shared
// rig from `_engine_helpers.mjs` is the whole rig.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { rig, makeRepo, gitSync, passReview, cleanCritic, doneImpl } from './_engine_helpers.mjs'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-exam-concern-'))
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }))

// ── the wave entry: six-slot shaped, one Proof `Test:` path ──────────────────
const MACHINE = 'Machine: M1. The tree holds `one.txt` whose content is "from T1".'
const LEGS = '- Legs: (a) `one.txt` reads exactly "from T1" [M1]'
const BODY = '**Claim:** the tree gains one.txt\n' + MACHINE +
  '\n\n**Proof:**\n- Test: `t1_test.sh`\n' + LEGS
const entry = (over = {}) => ({
  id: 'T1', title: 'create one', files: ['one.txt'], tier: 'standard', review: 'lean',
  writes: ['one.txt'], commutes: [],
  interfaces: { consumes: [], produces: [] },
  testCmd: 'bash t1_test.sh',
  proofTests: ['t1_test.sh'],
  body: BODY,
  ...over,
})

// The exam whose third case no tree can pass: it compares `one.txt` against
// two different literals. Red at BASE (the file is absent) and red on every
// tree the implementer can write — which is what an `exam:` concern is about.
const THIRD_LINE = '[ "$(cat one.txt)" = "something else" ]'
const UNSAT_EXAM = '#!/bin/bash\n[ -f one.txt ] || exit 1\n' +
  '[ "$(cat one.txt)" = "from T1" ] || exit 1\n' + THIRD_LINE + '\n'
// The satisfiable exam: red at BASE, green once `one.txt` reads "from T1".
const SAT_EXAM = '#!/bin/bash\n[ -f one.txt ] || exit 1\n[ "$(cat one.txt)" = "from T1" ]\n'

// The fix round's claim about the exam, and the referee's patch for it.
const EXAM_CONCERN = 'exam: t1_test.sh compares one.txt against two different ' +
  'literals — cannot pass for any output'
const OTHER_CONCERN = 'out-of-FILES: sim note'
const PROPOSED_PATCH = [
  '--- a/t1_test.sh',
  '+++ b/t1_test.sh',
  '@@ -1,4 +1,3 @@',
  ' #!/bin/bash',
  ' [ -f one.txt ] || exit 1',
  '-[ "$(cat one.txt)" = "from T1" ] || exit 1',
  '-' + THIRD_LINE,
  '+[ "$(cat one.txt)" = "from T1" ]',
  '',
].join('\n')

const writeExam = (cwd, text) => fs.writeFileSync(path.join(cwd, 't1_test.sh'), text)
const writeOne = (cwd, text = 'from T1\n') => fs.writeFileSync(path.join(cwd, 'one.txt'), text)
const concernsReply = (cwd, concerns) => ({
  status: 'DONE_WITH_CONCERNS', summary: 'sim work done with concerns',
  startHead: gitSync(['rev-parse', 'HEAD'], cwd), concerns,
})
const blockingWithPatch = () => ({
  verdict: 'FIX_REQUIRED',
  issues: [{ severity: 'blocking', actor: 'implementer',
             detail: 'the third line of t1_test.sh is unsatisfiable',
             proposedPatch: PROPOSED_PATCH }],
})

// One scenario of the rig: the examiner writes `examText`, the implementer does
// `implWork`, and the three judged rounds are the caller's. Unique stamp and
// runDir per scenario, as the sibling sims do.
let seq = 0
const scenario = async ({
  examText = UNSAT_EXAM,
  implWork = (cwd) => writeOne(cwd),
  fix0 = (cwd) => concernsReply(cwd, [EXAM_CONCERN]),
  review1 = () => blockingWithPatch(),
  fix1 = (cwd) => { writeExam(cwd, SAT_EXAM); return doneImpl(cwd) },
} = {}) => {
  seq += 1
  const stamp = 'examconcern' + seq
  const repo = makeRepo(path.join(tmp, 'repo-' + stamp))
  const runDir = path.join(tmp, 'run-' + stamp)
  const labels = []
  const prompts = {}
  const stub = (prompt, opts, cwd) => {
    labels.push(opts.label)
    prompts[opts.label] = prompt
    const kind = opts.label.split(':')[0]
    if (kind === 'exam') {
      writeExam(cwd, examText)
      return { status: 'DONE', summary: 'exam written', startHead: 'ignored' }
    }
    if (kind === 'impl') { implWork(cwd); return doneImpl(cwd) }
    if (opts.label === 'fix:T1:0') return fix0(cwd)
    if (opts.label === 'review:T1:1') return review1(cwd)
    if (opts.label === 'fix:T1:1') return fix1(cwd)
    if (opts.label === 'review:T1:2') return passReview()
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run, integ } = rig({ repo, runDir, waves: [[entry()]], stub, stamp })
  const report = await run()
  return { report, labels, prompts, integ, stamp, row: report.tasks[0] }
}

// ── legs (a), (b), (d): the route, its prompt line, and the merge ────────────
{
  const { report, labels, prompts, integ, stamp, row } = await scenario()

  // (a) [M1] the still-red exam beside an `exam:` concern reaches review round 1
  // instead of parking, and the driver says so in one judgment call.
  assert.ok(labels.includes('review:T1:1'),
    '(a)[M1] `review:T1:1` is dispatched after the `exam:` concern: ' + labels.join(','))
  assert.notEqual(row.reviewVerdict, 'proof-red',
    '(a)[M1] the row is not parked at proof-red: ' + row.notes)
  const calls = report.judgmentCalls.filter((j) => j.includes('exam concern'))
  assert.equal(calls.length, 1,
    '(a)[M1] exactly one judgment call names the exam concern: ' +
    JSON.stringify(report.judgmentCalls))
  assert.ok(calls[0].includes('T1'),
    '(a)[M1] and it names the task id: ' + calls[0])

  // (b) [M2] the round-1 prompt carries the concern verbatim on its own line,
  // after the EXAM EVIDENCE header line — the red output first, the claim about
  // it second.
  const lines = prompts['review:T1:1'].split('\n')
  const iConcern = lines.indexOf('EXAM CONCERN: ' + EXAM_CONCERN)
  const iEvidence = lines.findIndex((l) => l.startsWith('EXAM EVIDENCE:'))
  assert.ok(iConcern >= 0,
    '(b)[M2] the round-1 prompt carries the line `EXAM CONCERN: ' + EXAM_CONCERN + '`: ' +
    JSON.stringify(lines.filter((l) => l.startsWith('EXAM'))))
  assert.ok(iEvidence >= 0,
    '(b)[M2] the round-1 prompt carries the EXAM EVIDENCE block header line')
  assert.ok(iConcern > iEvidence,
    '(b)[M2] and the EXAM CONCERN line sits after it (at ' + iConcern + ' vs ' + iEvidence + ')')

  // (d) [M3] the referee's patch is bought, the fix round rewrites the exam,
  // the edit is recorded and named to the re-review, and the task merges.
  assert.equal(row.status, 'done', '(d)[M3] the row is done: ' + row.notes)
  assert.equal(row.reviewVerdict, 'fixed', '(d)[M3] reviewVerdict')
  assert.equal(row.proofFixes, 1, '(d)[M3] proofFixes')
  assert.equal(row.fixIterations, 1, '(d)[M3] fixIterations')
  assert.deepEqual(row.examEdited, ['t1_test.sh'], '(d)[M3] examEdited')
  assert.equal(report.coverage.tasks_merged, 1, '(d)[M3] tasks_merged')
  const round2 = prompts['review:T1:2'].split('\n')
  assert.ok(round2.includes('EXAM EDITED: t1_test.sh'),
    '(d)[M3] the `review:T1:2` prompt carries the line `EXAM EDITED: t1_test.sh`')
  assert.ok(round2.includes('EXAM EDITED DIFF t1_test.sh:'),
    '(d)[M3] and the line `EXAM EDITED DIFF t1_test.sh:`')
  const merged = gitSync(['show', 'ultra/integration-' + stamp + ':t1_test.sh'], integ)
  assert.ok(!merged.includes(THIRD_LINE),
    '(d)[M3] the integration branch holds the rewritten exam, without the ' +
    'unsatisfiable line: ' + JSON.stringify(merged))
}

// ── leg (c): a fix round with no `exam:` entry gets no EXAM CONCERN line ─────
{
  // The exam is satisfiable here: red on the first pass (the implementer wrote
  // the wrong bytes), green on the second (the fix round repaired the tree).
  // Its single concern is not an `exam:` one, so the prompt carries no line.
  const { labels, prompts } = await scenario({
    examText: SAT_EXAM,
    implWork: (cwd) => writeOne(cwd, 'wrong\n'),
    fix0: (cwd) => { writeOne(cwd); return concernsReply(cwd, [OTHER_CONCERN]) },
    review1: () => passReview(),
  })
  assert.ok(labels.includes('review:T1:1'),
    '(c)[M2] a repaired pass reaches review round 1 as it always did: ' + labels.join(','))
  const carried = prompts['review:T1:1'].split('\n').filter((l) => l.startsWith('EXAM CONCERN: '))
  assert.deepEqual(carried, [],
    '(c)[M2] a fix round with no `exam:` entry carries no EXAM CONCERN line: ' +
    JSON.stringify(carried))
}

// ── leg (e): the park is unchanged when the fix round claimed nothing ────────
{
  const { report, labels, row } = await scenario({ fix0: (cwd) => doneImpl(cwd) })
  assert.equal(row.status, 'failed', '(e)[M4] the row is failed')
  assert.equal(row.reviewVerdict, 'proof-red', '(e)[M4] reviewVerdict')
  assert.equal(row.proofFixes, 1, '(e)[M4] proofFixes')
  assert.deepEqual(labels.filter((l) => l.startsWith('review:')), [],
    '(e)[M4] no reviewer was ever dispatched: ' + labels.join(','))
  assert.equal(report.coverage.tasks_merged, 0, '(e)[M4] nothing merges')
}

// ── leg (f): a reviewer that waves the red through still cannot merge it ─────
{
  const { report, row } = await scenario({
    review1: () => passReview(),
    fix1: (cwd) => doneImpl(cwd),
  })
  assert.equal(row.status, 'failed', '(f)[M5] the row is failed: ' + row.notes)
  assert.equal(row.reviewVerdict, 'fix-loop-exhausted', '(f)[M5] reviewVerdict')
  assert.deepEqual(row.examEdited, [], '(f)[M5] the exam was never edited')
  assert.equal(report.coverage.tasks_merged, 0, '(f)[M5] nothing merges')
}

// ── legs (g), (h), (i): the role file and the two report-format rows [M6] ────
const readRepoFile = (rel) => fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

{
  // (g) reviewer.md tells the referee what an EXAM CONCERN line is and what to
  // return for it — a `proposedPatch` — within the 600 characters that follow.
  const flat = readRepoFile('../roles/reviewer.md').split('\n').join(' ')
  const RE = () => new RegExp('EXAM CONCERN:.{0,600}proposedPatch')
  assert.ok(RE().test(flat),
    '(g)[M6] fleet/roles/reviewer.md matches /EXAM CONCERN:.{0,600}proposedPatch/ ' +
    'with newlines read as spaces')
  // The negative control: with the literal removed, the match is gone — so the
  // assertion above is answered by that passage and nothing else.
  assert.ok(!RE().test(flat.split('EXAM CONCERN:').join('')),
    '(g)[M6] and fails to match once its `EXAM CONCERN:` occurrences are removed')
}

{
  const doc = readRepoFile('../../skills/ultrapowers/references/report-format.md').split('\n')
  // (h)[M6] and (i)[M6] — the two rows this route changes the meaning of. The
  // selection is the Proof's own: the table row whose line begins `| ` then the
  // backticked key.
  for (const [leg, re] of [['(h)', /^\| .tasks\[\]\.reviewVerdict. \|/],
                           ['(i)', /^\| .tasks\[\]\.proofFixes. \|/]]) {
    const rows = doc.filter((l) => re.test(l))
    assert.ok(rows.length >= 1,
      leg + '[M6] at least one report-format.md row matches ' + re)
    for (const r of rows) {
      assert.ok(r.includes('EXAM CONCERN'),
        leg + '[M6] the row names EXAM CONCERN: ' + r)
    }
  }
}

console.log('ALL TESTS PASSED')
