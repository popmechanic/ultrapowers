// fleet/tests/test_run_engine.mjs — the happy path of the Amendment 10 engine:
// two waves (width-2 then a dependent task), driver setup, real fold kernel,
// driver adopt + suite, read-only critic, and the full report contract.
//
// Everything below the agent seam is real (git, clones, capture, kernel); the
// judgments are canned. This is the run-26 shape plus the multi-wave case the
// live-base capture exists for.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { makeRepo, rig, gitSync, passReview, cleanCritic, doneImpl } from './_engine_helpers.mjs'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-sim-'))
const repo = makeRepo(path.join(tmp, 'repo'))
const runDir = path.join(tmp, 'run')

const waves = [
  [
    { id: 'T1', title: 'create one', files: ['one.txt'], tier: 'standard', review: 'lean', writes: ['one.txt'], commutes: [] },
    { id: 'T2', title: 'create two', files: ['two.txt'], tier: 'standard', review: 'lean', writes: ['two.txt'], commutes: [] },
  ],
  [
    { id: 'T3', title: 'extend one', files: ['one.txt'], tier: 'standard', review: 'lean', writes: ['one.txt'], commutes: [] },
  ],
]
for (const w of waves) for (const t of w) t.body = 'sim task ' + t.id

const dispatched = []
const stub = (prompt, opts, cwd) => {
  dispatched.push(opts.label)
  const kind = opts.label.split(':')[0]
  if (kind === 'impl') {
    const id = opts.label.split(':')[1]
    if (id === 'T1') fs.writeFileSync(path.join(cwd, 'one.txt'), 'from T1\n')
    if (id === 'T2') fs.writeFileSync(path.join(cwd, 'two.txt'), 'from T2\n')
    if (id === 'T3') {
      // Wave 2: the clone must already hold wave 1's adopted content — the
      // re-anchor leg is what this asserts. Extend it rather than recreate it.
      const prior = fs.readFileSync(path.join(cwd, 'one.txt'), 'utf8')
      assert.equal(prior, 'from T1\n', 'wave-2 clone was re-anchored onto the wave-1 head')
      fs.writeFileSync(path.join(cwd, 'one.txt'), prior + 'from T3\n')
    }
    return doneImpl(cwd)
  }
  if (kind === 'review') {
    // The reviewer's input is the driver-captured patch: assert the PATCH line
    // names a readable file whose diff is non-empty.
    const m = /\nPATCH: (\S+)/.exec(prompt)
    assert.ok(m, 'reviewer prompt carries a PATCH line')
    assert.ok(fs.statSync(m[1]).size > 0, 'the driver-captured patch is a real diff')
    return passReview()
  }
  if (opts.label === 'integration') return cleanCritic()
  throw new Error('unexpected dispatch: ' + opts.label)
}

const { run, integ, patchesDir } = rig({ repo, runDir, waves, edges: [['T1', 'T3']], stub, stamp: 'sim1' })
const report = await run()

// The report contract, field by field (references/report-format.md).
assert.equal(report.integrationBranch, 'ultra/integration-sim1')
assert.deepEqual(report.waves, [['T1', 'T2'], ['T3']])
assert.equal(report.tasks.length, 3)
assert.ok(report.tasks.every((t) => t.status === 'done' && t.reviewVerdict === 'clean'))
assert.ok(report.tasks.every((t) => t.patch && t.patch.startsWith(patchesDir)))
assert.equal(report.coverage.tasks_merged, 3)
assert.equal(report.coverage.complete, true)
assert.equal(report.waveMerges.length, 2)
assert.ok(report.waveMerges.every((m) => m.status === 'MERGED' && m.headSha))
assert.equal(report.tests.passed, true, 'the DRIVER ran the suite: ' + report.tests.output)
assert.equal(report.acceptance.mode, 'suite')
assert.equal(report.acceptance.passed, true)
assert.equal(report.baseline.passed, true)
assert.equal(report.gitVerified, true, 'receipt-derived gitVerified holds on a clean run')
assert.deepEqual(report.ancestryMisses, [])
assert.equal(report.frontier.length, 2, 'one frontier entry per folded wave')
assert.ok(report.frontier.every((f) => f.foldCliCalls >= 2), 'fold + materialize per wave')
assert.deepEqual(report.completenessFindings, [])
assert.deepEqual(report.blockedWaves, [])
assert.deepEqual(report.unfinished, [])

// The integrated tree really holds the composition.
const tip = gitSync(['rev-parse', 'ultra/integration-sim1'], integ)
assert.equal(tip, report.waveMerges[1].headSha)
assert.equal(gitSync(['show', tip + ':one.txt'], integ), 'from T1\nfrom T3')
assert.equal(gitSync(['show', tip + ':two.txt'], integ), 'from T2')

// Wave-2's patch was taken against the WAVE-1 head, not the original BASE:
// it must not carry two.txt or T1's creation of one.txt as its own.
const t3patch = fs.readFileSync(path.join(patchesDir, 'task-T3.patch'), 'utf8')
assert.ok(!t3patch.includes('two.txt'), 'wave-2 patch does not re-carry wave-1 work')
assert.ok(t3patch.includes('+from T3'), 'wave-2 patch carries its own change')

// No choreography agents were ever dispatched: setup, merge and adopt are
// driver code — the dispatch record contains judgments only.
assert.ok(!dispatched.some((l) => l === 'setup' || l.startsWith('merge:')),
  'no setup or merge agent dispatched: ' + dispatched.join(','))

// #366 rule 5: the role-file prose ceiling (spec §4) — ≤ 350 words each, and
// no ALL-CAPS imperative shouting (a rule that needs shouting belongs in code).
{
  const rolesDir = new URL('../roles/', import.meta.url)
  for (const f of fs.readdirSync(rolesDir)) {
    const text = fs.readFileSync(new URL(f, rolesDir), 'utf8')
    const words = text.split(/\s+/).filter(Boolean).length
    assert.ok(words <= 350, 'role file ' + f + ' is ' + words + ' words (ceiling 350)')
    assert.ok(!/\b(NEVER|ALWAYS|MUST)\b/.test(text), 'role file ' + f + ' shouts an imperative')
  }
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log('ALL TESTS PASSED')
