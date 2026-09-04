// fleet/tests/test_exam_edited_patches.mjs — the exam-edited result carries its
// proposed-patch count (#561). Since run-54 task 5 a fix-round exam edit is
// recorded (`examEdited`) and folded rather than refused, so the fix-round
// cases here assert the merged row still carries the count — and since
// 2026-09-02 the before-any-review case (b) is the same rule. `examEdited` returns the same `proposedPatches`
// every other `runTaskInner` return carries: the number of blocking issues in
// the review round that carried a non-empty `proposedPatch`, and `0` when no
// review round ran before the edit. Run-52 crossed the exam route (#553) and
// the proposed-patch route (#556) in no Proof leg; these sims are that cross.
//
// Everything below the agent seam is real (git, clones, capture, the fold
// kernel, the blob shas, the red-at-BASE run); only the judgments are canned.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSeam } from '../run-main.mjs'
import { makeCwdFor, withPatchCapture, defaultTaskIdOf } from '../run-waves.mjs'
import { runEngine } from '../run-engine.mjs'
import { makeRepo, provision, passReview, cleanCritic, doneImpl } from './_engine_helpers.mjs'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-exam-pp-'))
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const REAL_ROLES = fileURLToPath(new URL('../roles/', import.meta.url))
const SIX = ['implementer', 'reviewer', 'fix', 'resolver', 'reconcile', 'critic']

// The seventh role file is not in `fleet/roles/` on every arm, and the exam is
// soft-gated on its presence — so the sims point `rolesDir` at a temp copy of
// the six plus an examiner of our own.
const rolesDir = path.join(tmp, 'roles')
fs.mkdirSync(rolesDir, { recursive: true })
for (const name of SIX) {
  fs.copyFileSync(path.join(REAL_ROLES, name + '.md'), path.join(rolesDir, name + '.md'))
}
fs.writeFileSync(path.join(rolesDir, 'examiner.md'), '# examiner (sim)\n\nYou write the exam.\n')

const PATCH1 = '--- a/x\n+++ b/x\n@@ -1 +1 @@\n-1\n+2\n'

// ── the rig: the shared one in _engine_helpers.mjs has no `rolesDir` seam ────
let seq = 0
function build({ waves, stub, testCmd = 'bash check.sh' }) {
  seq += 1
  const stamp = 'eepp' + seq
  const repo = makeRepo(path.join(tmp, 'repo-' + stamp))
  const runDir = path.join(tmp, 'run-' + stamp)
  const taskIds = waves.flat().map((t) => t.id)
  const { base, clonesDir, patchesDir } = provision({ repo, runDir, taskIds })
  const patchBase = { current: base }
  const cwdFor = makeCwdFor({ clonesDir })
  const inner = async (prompt, opts) => stub(prompt, opts, cwdFor(opts))
  const agent = withPatchCapture({
    agent: inner, clonesDir, base: () => patchBase.current, patchesDir,
    taskIdOf: defaultTaskIdOf,
  })
  const run = () => runEngine({
    args: {
      waves, edges: [], testCmd, acceptance: { mode: 'suite', reason: 'sim' }, stamp,
      integrationBranch: 'ultra/integration-' + stamp,
      dependencyEdges: [], patchInput: patchesDir, shallowLeg: false,
    },
    agent,
    parallel: (thunks) => Promise.all(thunks.map((t) => t())),
    exec: execSeam,
    paths: { repoDir: repo, runDir, clonesDir },
    log: () => {},
    rolesDir,
    patchBase,
  })
  return { run }
}

// A six-slot wave entry per task: its own `testCmd` and the `proofTests` path
// the examiner writes, which is what makes the exam dispatch at all.
const entry = (id) => ({
  id, title: 'create ' + id, files: [id + '.txt'], tier: 'standard', review: 'lean',
  writes: [id + '.txt'], commutes: [],
  testCmd: 'bash ' + id + '_test.sh',
  proofTests: [id + '_test.sh'],
  body: '**Claim:** the tree gains ' + id + '.txt\nMachine: M1. `' + id + '.txt` exists.' +
    '\n\n**Proof:**\n- Test: `' + id + '_test.sh`\n- Legs: (a) it exists [M1]',
})

// The exam the examiner leaves: red at BASE until the implementer writes the file.
const writeExam = (id, cwd) => {
  fs.writeFileSync(path.join(cwd, id + '_test.sh'), '#!/bin/bash\n[ -f ' + id + '.txt ]\n')
  return { status: 'DONE', summary: 'exam written', startHead: 'ignored' }
}
const editExam = (id, cwd) =>
  fs.writeFileSync(path.join(cwd, id + '_test.sh'), '#!/bin/bash\nexit 0 # rewritten by the graded party\n')
const doWork = (id, cwd) => fs.writeFileSync(path.join(cwd, id + '.txt'), 'from ' + id + '\n')

const fixRequired = (issues) => ({ verdict: 'FIX_REQUIRED', issues })
const patched = (detail) => fixRequired([{ severity: 'blocking', detail, proposedPatch: PATCH1 }])

// One sim: every task draws `review1` on its first review and PASS after, and
// `editsExamIn[id]` says which dispatch (if any) rewrites that task's exam.
async function sim({ ids, review1, editsExamIn }) {
  const waves = [ids.map(entry)]
  const reviews = {}
  const labels = []
  const stub = (prompt, opts, cwd) => {
    labels.push(opts.label)
    const [kind, id] = opts.label.split(':')
    if (kind === 'exam') return writeExam(id, cwd)
    if (kind === 'impl') {
      doWork(id, cwd)
      if (editsExamIn[id] === 'impl') editExam(id, cwd)
      return doneImpl(cwd)
    }
    if (kind === 'fix') {
      fs.writeFileSync(path.join(cwd, id + '.txt'), 'from ' + id + ' (fixed)\n')
      if (editsExamIn[id] === 'fix') editExam(id, cwd)
      return doneImpl(cwd)
    }
    if (kind === 'review') {
      reviews[id] = (reviews[id] || 0) + 1
      return reviews[id] === 1 ? review1 : passReview()
    }
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run } = build({ waves, stub })
  const report = await run()
  const byId = {}
  for (const t of report.tasks) byId[t.task] = t
  return { report, byId, labels }
}

const verdictOf = (t) => ({ status: t.status, reviewVerdict: t.reviewVerdict })

// ── (a) [M1] a patched review round, then a fix round that edits the exam ───
{
  const { byId, labels } = await sim({
    ids: ['T1'], review1: patched('not yet'), editsExamIn: { T1: 'fix' },
  })
  assert.ok(labels.includes('fix:T1:1'), 'the fix round ran: ' + labels.join(','))
  assert.deepEqual(verdictOf(byId.T1), { status: 'done', reviewVerdict: 'fixed' })
  assert.deepEqual(byId.T1.examEdited, ['T1_test.sh'], 'the fix-round edit is recorded, not refused (run-54 task 5)')
  assert.equal(byId.T1.proposedPatches, 1, 'the round that dispatched the fix carried one patch')
}

// ── (b) [M1] the first implementer edits the exam, before any review ────────
// Since 2026-09-02 the same rule as the fix round: recorded, reviewed, and
// the count is the review's, not a refusal's.
{
  const { byId, labels } = await sim({
    ids: ['T1'], review1: passReview(), editsExamIn: { T1: 'impl' },
  })
  assert.ok(labels.some((l) => l.startsWith('review:')), 'the review is dispatched: ' + labels.join(','))
  assert.deepEqual(verdictOf(byId.T1), { status: 'done', reviewVerdict: 'clean' })
  assert.deepEqual(byId.T1.examEdited, ['T1_test.sh'])
  assert.ok('proposedPatches' in byId.T1, 'the field is present, not absent')
  assert.equal(byId.T1.proposedPatches, 0, 'a clean review attached nothing')
}

// ── (c) [M2] the field-table row, verbatim and in the table ─────────────────
{
  const ROW = '| `tasks[].proposedPatches` | no | The number of blocking issues in the ' +
    'review round that carried a non-empty `proposedPatch`; `0` when none, on a clean ' +
    'first review, and on a task that failed before any review |'
  const doc = fs.readFileSync(path.join(REPO_ROOT, 'skills/ultrapowers/references/report-format.md'), 'utf8')
  const lines = doc.split('\n')
  const at = lines.reduce((acc, l, i) => (l === ROW ? acc.concat([i]) : acc), [])
  assert.equal(at.length, 1, 'the row appears exactly once as a whole line')

  // And inside the field-reference table: after its header row, before the
  // next heading — a substring loose in the prose is not a documented field.
  const header = lines.indexOf('| Field | Required | Description |')
  assert.ok(header !== -1, 'the field-reference table has its header row')
  const nextHeading = lines.findIndex((l, i) => i > header && l.startsWith('#'))
  assert.ok(at[0] > header && (nextHeading === -1 || at[0] < nextHeading),
    'the row sits inside the field-reference table, not in stray prose')

  // The schema block at the top of the file lists the field too.
  const open = doc.indexOf('```json')
  assert.ok(open !== -1, 'the file opens a json schema block')
  const schema = doc.slice(open, doc.indexOf('```', open + 7))
  assert.ok(schema.includes('"proposedPatches"'), 'the schema block lists proposedPatches')
}

// The two legs that used to sit here froze the digests of four sibling sims
// and re-ran each of them. A frozen digest of a file this one does not own is
// a pin that cannot fail for any reason a reader would want: it goes red for
// every edit to those files, lawful or not, and it says nothing about this
// route. Their own sims already run them; the suite runs the suite. Deleted
// under #612 — the same call that took the verbatim-sentence legs out of
// `test_roles_peer.mjs`.

// ── (f) [M1] two blocking issues, one patch: the count is patches, not issues ─
{
  const { byId } = await sim({
    ids: ['T1'],
    review1: fixRequired([
      { severity: 'blocking', detail: 'v1 is wrong', proposedPatch: PATCH1 },
      { severity: 'blocking', detail: 'v1 is also late', proposedPatch: '' },
    ]),
    editsExamIn: { T1: 'fix' },
  })
  assert.deepEqual(verdictOf(byId.T1), { status: 'done', reviewVerdict: 'fixed' })
  assert.deepEqual(byId.T1.examEdited, ['T1_test.sh'], 'the fix-round edit is recorded, not refused (run-54 task 5)')
  assert.equal(byId.T1.proposedPatches, 1, 'an empty patch is no patch — two issues, one count')
}

// ── (g) [M1] the count comes from the task's own round ──────────────────────
{
  const { byId } = await sim({
    ids: ['T1', 'T2'], review1: patched('not yet'), editsExamIn: { T1: 'fix' },
  })
  assert.deepEqual(verdictOf(byId.T1), { status: 'done', reviewVerdict: 'fixed' })
  assert.deepEqual(byId.T1.examEdited, ['T1_test.sh'], 'the fix-round edit is recorded, not refused (run-54 task 5)')
  assert.deepEqual(verdictOf(byId.T2), { status: 'done', reviewVerdict: 'fixed' })
  assert.equal(byId.T1.proposedPatches, byId.T2.proposedPatches,
    'the exam-edited task counted the same round its sibling did (both merge since run-54 task 5)')
  assert.equal(byId.T1.proposedPatches, 1)
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log('ALL TESTS PASSED')
