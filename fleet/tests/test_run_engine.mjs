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
import { capWorkerParallelism, SHELL_TIMEOUT_MS } from '../run-engine.mjs'

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

// The two reviewer rules the run-32 evidence bought. Both are prose an LLM has
// to follow, so the pin is on the words: a trim that pays for something else
// must not quietly take these with it.
{
  const reviewer = fs.readFileSync(new URL('../roles/reviewer.md', import.meta.url), 'utf8')
  // #344 — the plan-defect rule was the ONLY rule in the file that never said
  // "blocking": every other one says it outright. Run-32: 14 of 20 findings
  // carried the `plan-defect:` prefix, four of the five shipped code defects
  // among them — five reviewers wrote out the defect AND its one-clause fix,
  // returned PASS, and it merged.
  assert.ok(/`plan-defect:`[\s\S]{0,80}blocking[\s\S]{0,80}FILES/.test(reviewer),
    'reviewer.md rule 6 no longer makes a task-local plan-defect fix blocking (#344)')
  // #441 — a diff is a result, not a history. Asking six reviewers to evidence
  // red-then-green ordering produced 25 cannotVerify entries and the single
  // deferred:manual ack that parked run-32; ordering has no answer here.
  assert.ok(/red-then-green/.test(reviewer) &&
    /neither a finding nor a `cannotVerify` entry/.test(reviewer),
    'reviewer.md rule 7 no longer excuses the reviewer from unobservable ordering (#441)')
}

// ── #436: the two bounds that go live with the golden's parallel pytest ──────
// Both are pre-golden-rebuild obligations: an unbounded suite exec burns the
// sandbox lease instead of failing, and `-n auto` per implementer oversubscribes
// the machine WIDTH times over.
{
  // 1. capWorkerParallelism divides the machine among the workers that share it.
  assert.equal(capWorkerParallelism('python3 -m pytest -n auto', 2, 8), 'python3 -m pytest -n 4',
    'width 2 on 8 cpus gets 4 workers each')
  assert.equal(capWorkerParallelism('python3 -m pytest -n auto', 1, 8), 'python3 -m pytest -n 8',
    'a lone worker keeps the whole machine')
  // At WIDTH=8 on 8 vCPU the share is 1 — xdist's own overhead is pure loss
  // there, so the plugin is disabled rather than run with one worker.
  assert.equal(capWorkerParallelism('python3 -m pytest -n auto', 8, 8), 'python3 -m pytest -p no:xdist',
    'a share of one disables xdist instead of paying its overhead')
  // Never rewrites what it does not own.
  assert.equal(capWorkerParallelism('bunx tsc --noEmit && bun test', 8, 8),
    'bunx tsc --noEmit && bun test', 'a non-pytest command is untouched')
  assert.equal(capWorkerParallelism('python3 -m pytest -n 4', 8, 8), 'python3 -m pytest -n 4',
    'an explicitly pinned -n is the plan author\'s choice, not ours')
  assert.equal(capWorkerParallelism(undefined, 8, 8), undefined, 'no testCmd stays no testCmd')

  // 2. The engine bounds its own shell execs. SHELL_TIMEOUT_MS is what stops a
  // wedged suite from consuming the lease and surfacing as an expired claim.
  assert.equal(typeof SHELL_TIMEOUT_MS, 'number')
  assert.ok(SHELL_TIMEOUT_MS >= 10 * 60 * 1000 && SHELL_TIMEOUT_MS <= 60 * 60 * 1000,
    'the suite bound must be minutes-to-an-hour, not unbounded and not a hair trigger')
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log('ALL TESTS PASSED')
