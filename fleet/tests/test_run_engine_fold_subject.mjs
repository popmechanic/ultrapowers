// fleet/tests/test_run_engine_fold_subject.mjs — the fold commit's subject,
// read off the integration branch (#633).
//
// The exam for Task 2's Claim: *a run's squash-merge keeps the plan's title.*
// M1 (the kernel flag) is graded in `tests/test_fold_wave_subject.py`; this
// file carries M2 and M3 — the engine's half of the wiring.
//
//   M2. When `planPath` names a file whose first line beginning `# ` is
//       `# <title>`, the engine passes `--subject <title>` to materialize and
//       the integration branch's head after wave 1 has subject `<title>` and
//       a body containing `frontier fold wave 1`.
//   M3. With no `planPath`, or a plan file with no line beginning `# `, the
//       engine passes no `--subject` and the head's subject is
//       `frontier fold wave 1`.
//
// The oracle is the real git object at the branch tip, never the engine's own
// bookkeeping: the rig is real below the agent seam (real clones, real patch
// capture, the real fold kernel through the real execSeam), so the head these
// scenarios read is the commit a live run would push.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { makeRepo, rig, gitSync, passReview, cleanCritic, doneImpl } from './_engine_helpers.mjs'

// The clause's two literals.
const TITLE = 'Widget plan'
const WAVE_1 = 'frontier fold wave 1'

const wavesFor = (id) => [[{ id, title: 'create ' + id, files: [id + '.txt'], tier: 'standard',
  review: 'lean', writes: [id + '.txt'], commutes: [], body: 'sim task ' + id }]]

const stubFor = (id) => (prompt, opts, cwd) => {
  const kind = opts.label.split(':')[0]
  if (kind === 'impl') {
    fs.writeFileSync(path.join(cwd, id + '.txt'), 'from ' + id + '\n')
    return doneImpl(cwd)
  }
  if (kind === 'review') return passReview()
  if (opts.label === 'integration') return cleanCritic()
  throw new Error('unexpected dispatch: ' + opts.label)
}

// One single-task wave, run to adoption. `plan` is the plan document's text,
// or null for a run that names no `planPath` at all. Returns the report plus
// the integration branch head's `%s`/`%b`/`%B`, git's own strings.
async function runWave({ id, stamp, plan }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-foldsubject-'))
  const repo = makeRepo(path.join(tmp, 'repo'))
  const extraArgs = {}
  if (plan !== null) {
    const planFile = path.join(tmp, 'plan.md')
    fs.writeFileSync(planFile, plan)
    extraArgs.planPath = planFile
  }
  const { run, integ } = rig({ repo, runDir: path.join(tmp, 'run'), waves: wavesFor(id),
                               stub: stubFor(id), stamp, extraArgs })
  const report = await run()
  const branch = report.integrationBranch
  const fmt = (f) => gitSync(['log', '-1', '--format=' + f, branch], integ)
  return { report, subject: fmt('%s'), body: fmt('%b'), whole: fmt('%B') }
}

// A run that did not adopt its wave leaves the branch at BASE, whose subject
// is `base` — a legible failure rather than a silently vacuous pass.
function assertAdopted(report, where) {
  assert.equal(report.waveMerges.length, 1, where + ': the run folded exactly one wave')
  assert.equal(report.waveMerges[0].status, 'MERGED',
    where + ': the wave adopted — ' + JSON.stringify(report.waveMerges[0]))
}

// ── 1. [M2] leg (b): a plan whose FIRST line is `# Widget plan` ─────────────
// The head's subject is the title, exactly; its body carries the wave line.
{
  const { report, subject, body, whole } = await runWave({
    id: 'T1', stamp: 'foldsubjh1', plan: '# ' + TITLE + '\n\nThe plan body.\n',
  })
  assertAdopted(report, 'M2 first-line H1')
  assert.equal(subject, TITLE,
    'M2: the head\'s %s is exactly the plan\'s H1 text; got ' + JSON.stringify(subject))
  assert.ok(body.includes(WAVE_1),
    'M2: the head\'s %b contains ' + JSON.stringify(WAVE_1) + '; got ' + JSON.stringify(body))
  // Equality on the whole message too: a subject that merely STARTS with the
  // title, or a title appended below the old one, is not this clause.
  assert.equal(whole.trim(), TITLE + '\n\n' + WAVE_1,
    'M2: the message is the title, a blank line, then the wave line; got ' + JSON.stringify(whole))
}

// ── 2. [M2] leg (b), second half: a blank first line, `# Widget plan` next ──
// The clause says "first line BEGINNING `# `", not "line 1" — a plan that
// opens with a blank line is titled the same way.
{
  const { report, subject, body } = await runWave({
    id: 'T2', stamp: 'foldsubjblank', plan: '\n# ' + TITLE + '\n\nThe plan body.\n',
  })
  assertAdopted(report, 'M2 blank-first-line')
  assert.equal(subject, TITLE,
    'M2: a leading blank line does not hide the H1; got ' + JSON.stringify(subject))
  assert.ok(body.includes(WAVE_1),
    'M2: the wave line still bodies the commit; got ' + JSON.stringify(body))
}

// ── 3. [M3] leg (c): no `planPath` at all ──────────────────────────────────
// Nothing to title from, so the message is BASE's, unchanged.
{
  const { report, subject, body, whole } = await runWave({
    id: 'T3', stamp: 'foldsubjnone', plan: null,
  })
  assertAdopted(report, 'M3 no planPath')
  assert.equal(subject, WAVE_1,
    'M3: with no planPath the subject is ' + JSON.stringify(WAVE_1) +
    '; got ' + JSON.stringify(subject))
  assert.equal(body.trim(), '',
    'M3: with no --subject there is no second paragraph; got ' + JSON.stringify(body))
  assert.equal(whole.trim(), WAVE_1,
    'M3: the whole message is unchanged from BASE; got ' + JSON.stringify(whole))
}

// ── 4. [M3] leg (c), second half: a plan file with no line beginning `# ` ───
// `## Sub` and `#NoSpace` do not begin with `# `, so neither titles the fold.
{
  const { report, subject, body, whole } = await runWave({
    id: 'T4', stamp: 'foldsubjnoh1',
    plan: 'Widget plan (not a heading)\n\n## A subheading\n\n#NoSpaceHere\n\nbody\n',
  })
  assertAdopted(report, 'M3 no H1 line')
  assert.equal(subject, WAVE_1,
    'M3: a plan with no `# ` line titles nothing; got ' + JSON.stringify(subject))
  assert.equal(body.trim(), '',
    'M3: and adds no second paragraph; got ' + JSON.stringify(body))
  assert.equal(whole.trim(), WAVE_1,
    'M3: the whole message is unchanged from BASE; got ' + JSON.stringify(whole))
}

// ── 5. [M3] leg (c): a `planPath` naming a file that does not exist ────────
// "a missing or unreadable file … meaning no `--subject`": the engine reads
// the plan once at start, and an absent one costs the run nothing.
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-foldsubject-missing-'))
  const repo = makeRepo(path.join(tmp, 'repo'))
  const { run, integ } = rig({ repo, runDir: path.join(tmp, 'run'), waves: wavesFor('T5'),
                               stub: stubFor('T5'), stamp: 'foldsubjmissing',
                               extraArgs: { planPath: path.join(tmp, 'no-such-plan.md') } })
  const report = await run()
  assertAdopted(report, 'M3 missing plan file')
  assert.equal(gitSync(['log', '-1', '--format=%s', report.integrationBranch], integ), WAVE_1,
    'M3: an unreadable plan file passes no --subject, so the subject is ' + JSON.stringify(WAVE_1))
}

console.log('ALL TESTS PASSED')
