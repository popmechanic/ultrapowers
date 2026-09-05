// fleet/tests/test_run_engine_reconcile_subject.mjs — the RECONCILE commit's
// subject, read off the integration branch (#651).
//
// The exam for Task 3's Claim: *the reconcile commit takes the same subject
// the materialize candidate did (the plan's H1), with `wave <N> reconcile
// (attempt <k>)` in the body.*
//
//   M1. When a wave's candidate suite is red and a reconcile round greens it,
//       the commit the driver makes has subject (`%s`) equal to the plan's
//       title when `planPath` yields one, and body (`%b`) equal to
//       `wave <N> reconcile (attempt <k>)`.
//   M2. With no plan title the whole message (`%B`, trimmed) is
//       `wave <N> reconcile (attempt <k>)`, as at BASE.
//   M3. The integration branch head after a reconciled wave 1 under a plan
//       titled `Widget plan` has subject `Widget plan`, so a squash-merge of
//       that head takes the plan's title.
//
// The oracle is the real git object at the branch tip, never the engine's own
// bookkeeping: the rig is real below the agent seam (real clones, real patch
// capture, the real fold kernel through the real execSeam), so the head these
// scenarios read is the commit a live run would push. The shape is
// `test_run_engine_reconcile.mjs`'s — an implementer stub that plants `BROKEN`
// beside its work, `makeRepo`'s `check.sh` failing on it, a `reconcile` stub
// that removes it — with `test_run_engine_fold_subject.mjs`'s plan file.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { makeRepo, rig, gitSync, passReview, cleanCritic, doneImpl } from './_engine_helpers.mjs'

// The clauses' three literals.
const TITLE = 'Widget plan'
const RECONCILE_1 = 'wave 1 reconcile (attempt 1)'

const waves = () => [[{
  id: 'T1', title: 'breaks the suite', files: ['T1.txt'], tier: 'standard', review: 'lean',
  writes: ['T1.txt'], commutes: [], body: 'task T1',
}]]

// One single-task wave whose candidate is RED and whose reconcile greens it.
// `plan` is the plan document's text, or null for a run naming no `planPath`
// at all. Returns the report plus the integration branch head's `%s`/`%b`/`%B`,
// git's own strings, and whether the reconcile agent actually ran.
async function runReconciledWave({ stamp, plan }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-recsubject-'))
  const repo = makeRepo(path.join(tmp, 'repo'))
  const extraArgs = {}
  if (plan !== null) {
    const planFile = path.join(tmp, 'plan.md')
    fs.writeFileSync(planFile, plan)
    extraArgs.planPath = planFile
  }
  const seen = { reconciled: false }
  const stub = (prompt, opts, cwd) => {
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') {
      // Real content plus the BROKEN marker check.sh fails on — the wave's
      // candidate is red, so the fold takes the reconcile route.
      fs.writeFileSync(path.join(cwd, 'T1.txt'), 'useful work\n')
      fs.writeFileSync(path.join(cwd, 'BROKEN'), 'oops\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    if (kind === 'reconcile') {
      seen.reconciled = true
      // Judgment only: fix by editing the tree — no git (the driver commits,
      // and that commit's message is what this exam grades).
      fs.rmSync(path.join(cwd, 'BROKEN'))
      return { status: 'FIXED', summary: 'removed the BROKEN marker' }
    }
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run, integ } = rig({ repo, runDir: path.join(tmp, 'run'), waves: waves(),
                               stub, stamp, extraArgs })
  const report = await run()
  const branch = report.integrationBranch
  const fmt = (f) => gitSync(['log', '-1', '--format=' + f, branch], integ)
  return { report, seen, integ, branch, subject: fmt('%s'), body: fmt('%b'), whole: fmt('%B') }
}

// A run that did not reconcile, or did not adopt, leaves a head this exam
// would grade vacuously: the wave must have gone red, been repaired by the
// reconcile agent, and been adopted — that adopted head IS the commit under
// test.
function assertReconciledAndAdopted(report, seen, where) {
  assert.ok(seen.reconciled, where + ': the reconcile agent was dispatched (the candidate went red)')
  assert.equal(report.waveMerges.length, 1, where + ': the run folded exactly one wave')
  assert.equal(report.waveMerges[0].status, 'MERGED',
    where + ': the wave adopted — ' + JSON.stringify(report.waveMerges[0]))
  assert.ok(report.judgmentCalls.some((j) => j.includes('adopted after reconcile')),
    where + ': the head is the RECONCILE commit, not a green candidate — ' +
    JSON.stringify(report.judgmentCalls))
  assert.equal(report.tests.passed, true, where + ': the repaired candidate is green')
}

// ── 1. leg (a) [M1] [M3]: a plan whose first line is `# Widget plan` ────────
// The reconciled head's subject is the plan's title, exactly — the same
// subject materialize gave the candidate — and the wave/attempt line moved
// down into the body.
{
  const { report, seen, integ, branch, subject, body, whole } = await runReconciledWave({
    stamp: 'recsubjh1', plan: '# ' + TITLE + '\n\nThe plan body.\n',
  })
  assertReconciledAndAdopted(report, seen, 'M1 titled plan')
  assert.equal(subject, TITLE,
    'M1 leg (a): the reconcile commit\'s %s is exactly the plan\'s H1 text; got ' +
    JSON.stringify(subject))
  assert.equal(body.trim(), RECONCILE_1,
    'M1 leg (a): its %b (trimmed) is exactly ' + JSON.stringify(RECONCILE_1) +
    '; got ' + JSON.stringify(body))
  // Equality on the whole message too: a subject that merely STARTS with the
  // title, or a title appended below the wave line, is not this clause.
  assert.equal(whole.trim(), TITLE + '\n\n' + RECONCILE_1,
    'M1 leg (a): the message is the title, a blank line, then the reconcile line; got ' +
    JSON.stringify(whole))
  // M3: the head a squash-merge of the integration branch would take is this
  // very commit — the branch tip IS the adopted head, and its subject is the
  // plan's title.
  const tip = gitSync(['rev-parse', branch], integ)
  assert.equal(tip, report.waveMerges[0].headSha,
    'M3 leg (a): the integration branch tip is the adopted head')
  assert.equal(gitSync(['log', '-1', '--format=%s', tip], integ), TITLE,
    'M3 leg (a): so a squash-merge of that head takes the plan\'s title, ' +
    JSON.stringify(TITLE))
  // The reconciled tree is the one that went green: the work landed and the
  // BROKEN marker the reconcile removed is not in it.
  assert.equal(gitSync(['show', tip + ':T1.txt'], integ), 'useful work',
    'M3 leg (a): the adopted tree carries the wave\'s work')
  assert.ok(!gitSync(['ls-tree', '--name-only', tip], integ).split('\n').includes('BROKEN'),
    'M3 leg (a): and not the BROKEN marker the reconcile removed')
}

// ── 2. leg (b) [M2]: the same run with no `planPath` ────────────────────────
// Nothing to title from, so the reconcile commit's message is BASE's,
// unchanged: the wave/attempt line and nothing else.
{
  const { report, seen, subject, body, whole } = await runReconciledWave({
    stamp: 'recsubjnone', plan: null,
  })
  assertReconciledAndAdopted(report, seen, 'M2 no planPath')
  assert.equal(whole.trim(), RECONCILE_1,
    'M2 leg (b): with no planPath the whole message is ' + JSON.stringify(RECONCILE_1) +
    ', as at BASE; got ' + JSON.stringify(whole))
  assert.equal(subject, RECONCILE_1,
    'M2 leg (b): so the subject is the reconcile line itself; got ' + JSON.stringify(subject))
  assert.equal(body.trim(), '',
    'M2 leg (b): and there is no second paragraph; got ' + JSON.stringify(body))
}

// ── 3. leg (c): the sim's sentinel ─────────────────────────────────────────
console.log('ALL TESTS PASSED')
