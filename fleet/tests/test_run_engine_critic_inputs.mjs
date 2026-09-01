// fleet/tests/test_run_engine_critic_inputs.mjs — #458: what the completeness
// critic is told. The driver runs the suite on the folded tree and used to keep
// the answer to itself, so the critic established pass/fail by static trace and
// then filed it as `deferred:runtime` — a deferral manufactured from an answer
// the driver already had. These assertions pin the fix: the critic prompt
// carries the driver's own post-fold suite result, named authoritative.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { makeRepo, rig, passReview, cleanCritic, criticWithFindings, doneImpl } from './_engine_helpers.mjs'
import { suiteLine, contractsBlock } from '../run-engine.mjs'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-critic-'))

// ── 1. a green run: the critic is told the suite passed ──────────────────────
{
  const repo = makeRepo(path.join(tmp, 'repo1'))
  const runDir = path.join(tmp, 'run1')
  const waves = [[
    { id: 'T1', title: 'one', files: ['one.txt'], tier: 'standard', review: 'lean',
      writes: ['one.txt'], commutes: [], body: 'task T1' },
  ]]
  const prompts = []
  const stub = (prompt, opts, cwd) => {
    prompts.push({ label: opts.label, prompt })
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') {
      fs.writeFileSync(path.join(cwd, 'one.txt'), 'x\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected: ' + opts.label)
  }
  const { run } = rig({ repo, runDir, waves, stub, stamp: 'ci1' })
  const report = await run()
  assert.equal(report.tests.passed, true, 'sim precondition: the driver-run suite went green')

  // The critic must be told the driver's own post-fold suite result — pass or fail.
  const criticPrompt = prompts.find((p) => p.label === 'integration').prompt
  assert.match(criticPrompt, /SUITE \(driver-run, post-fold\)/,
    'the critic prompt carries no suite section')
  assert.match(criticPrompt, /passed: true/,
    'the critic prompt does not state the suite verdict')
  assert.match(criticPrompt, /the authoritative result/,
    'the critic prompt does not say the driver run is authoritative')
  // The command is named too: "re-derive it by reading tests" is only refusable
  // advice if the critic knows which command produced the verdict.
  assert.match(criticPrompt, /command: bash check\.sh/,
    'the critic prompt does not name the command that produced the verdict')
  // Every pre-existing input stays, and in order (Step 4 inserts, never replaces).
  const iTasks = criticPrompt.indexOf('\n\nTasks:\n')
  const iBlocked = criticPrompt.indexOf('\nBlocked waves:\n')
  const iSuite = criticPrompt.indexOf('\nSUITE (driver-run, post-fold)')
  assert.ok(iTasks >= 0 && iBlocked > iTasks && iSuite > iBlocked,
    'the suite section must follow the task list and blocked waves, not displace them')
}

// ── 2. the failing case is carried in the same section ───────────────────────
// The section is rendered by `suiteLine`, exercised here directly: on a red
// post-fold suite the driver restores the previous head, so no ADOPTED tree
// ever carries a red result (scenario 3 pins that). The false branch is what
// the critic would be handed if one ever did — a critic told only about
// successes is a check that cannot fail, so it is pinned, not assumed.
{
  assert.equal(
    suiteLine({ passed: false, output: 'E   assert 1 == 2\n1 failed, 27 passed' }, 'python3 -m pytest -n 2'),
    '\nSUITE (driver-run, post-fold) — this is the authoritative result; ' +
    'do not re-derive it by reading tests.' +
    '\ncommand: python3 -m pytest -n 2' +
    '\npassed: false' +
    '\noutput: E   assert 1 == 2\n1 failed, 27 passed',
    'a failed suite must carry passed: false and its output')

  assert.equal(
    suiteLine({ passed: true, output: '28 passed' }, 'bash check.sh'),
    '\nSUITE (driver-run, post-fold) — this is the authoritative result; ' +
    'do not re-derive it by reading tests.' +
    '\ncommand: bash check.sh' +
    '\npassed: true',
    'a green suite states the verdict without pasting output')

  // A red output is tailed, not pasted whole: the last 500 chars, which is
  // where a pytest summary lives.
  const long = 'x'.repeat(600) + 'TAIL-MARKER'
  const rendered = suiteLine({ passed: false, output: long }, 'bash check.sh')
  assert.match(rendered, /TAIL-MARKER$/, 'the tail of the output must survive')
  assert.equal(rendered.split('\noutput: ')[1].length, 500, 'the output is tailed to 500 chars')

  assert.equal(suiteLine(null, 'bash check.sh'), '', 'no suite result renders nothing')
  assert.equal(suiteLine({ passed: true, output: 'ok' }, ''),
    '\nSUITE (driver-run, post-fold) — this is the authoritative result; ' +
    'do not re-derive it by reading tests.' +
    '\ncommand: (unknown)' +
    '\npassed: true',
    'an absent command is disclosed, not omitted')
}

// ── 3. what the section means: the ADOPTED tree, not the last candidate ──────
// Wave 1 merges green, wave 2's candidate goes red and is never adopted (the
// driver resets to wave 1's head). The critic still runs, and the verdict it is
// handed describes the tree that actually exists — wave 1's, green — matching
// the report's own `tests` block rather than the discarded candidate.
{
  const repo = makeRepo(path.join(tmp, 'repo3'))
  const runDir = path.join(tmp, 'run3')
  const waves = [
    [{ id: 'T1', title: 'one', files: ['one.txt'], tier: 'standard', review: 'lean',
       writes: ['one.txt'], commutes: [], body: 'task T1' }],
    [{ id: 'T2', title: 'two', files: ['BROKEN'], tier: 'standard', review: 'lean',
       writes: ['BROKEN'], commutes: [], body: 'task T2' }],
  ]
  const prompts = []
  const stub = (prompt, opts, cwd) => {
    prompts.push({ label: opts.label, prompt })
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') {
      // T2 plants the marker check.sh fails on: a red post-fold candidate.
      fs.writeFileSync(path.join(cwd, opts.label.split(':')[1] === 'T1' ? 'one.txt' : 'BROKEN'), 'x\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    if (kind === 'reconcile') return { status: 'CANNOT_FIX', summary: 'sim: no repair' }
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected: ' + opts.label)
  }
  const { run } = rig({ repo, runDir, waves, edges: [['T1', 'T2']], stub, stamp: 'ci3' })
  const report = await run()
  assert.equal(report.waveMerges[1].status, 'TEST_FAILED', 'sim precondition: wave 2 went red')
  assert.equal(report.coverage.complete, false, 'sim precondition: the run did not complete')

  const criticPrompt = prompts.find((p) => p.label === 'integration').prompt
  assert.match(criticPrompt, /SUITE \(driver-run, post-fold\)/,
    'a partially blocked run still tells the critic the suite result')
  assert.equal(
    criticPrompt.includes('\npassed: ' + report.tests.passed),
    true,
    'the critic and the report must state the same verdict for the same tree')
  assert.match(criticPrompt, /\nBlocked waves:\n.*TEST_FAILED|candidate suite failed/,
    'the blocked wave is still reported alongside the suite verdict')
}

// ── 4. no wave merged: the synthesized finding is a typed object (#474) ──────
// The fix loop exhausts, the wave is skipped, and the critic is never
// dispatched — the engine synthesizes the finding itself. It used to be a bare
// string; it is now the same {severity, detail} shape a real critic returns.
{
  const repo = makeRepo(path.join(tmp, 'repo4'))
  const runDir = path.join(tmp, 'run4')
  const waves = [[
    { id: 'T1', title: 'one', files: ['one.txt'], tier: 'standard', review: 'lean',
      writes: ['one.txt'], commutes: [], body: 'task T1' },
  ]]
  const labels = []
  const stub = (prompt, opts, cwd) => {
    labels.push(opts.label)
    const kind = opts.label.split(':')[0]
    if (kind === 'impl' || kind === 'fix') {
      fs.writeFileSync(path.join(cwd, 'one.txt'), 'still wrong\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') return { verdict: 'FIX_REQUIRED', issues: [{ severity: 'blocking', detail: 'never right' }] }
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected: ' + opts.label)
  }
  const { run } = rig({ repo, runDir, waves, stub, stamp: 'ci4' })
  const report = await run()
  assert.equal(report.waveMerges[0].status, 'SKIPPED', 'sim precondition: nothing merged')
  assert.ok(!labels.includes('integration'), 'sim precondition: the critic was never dispatched')

  assert.equal(report.completenessFindings.length, 1)
  const f = report.completenessFindings[0]
  assert.deepEqual(Object.keys(f).sort(), ['detail', 'severity'])
  assert.equal(f.severity, 'blocking')
  assert.equal(f.detail, 'no wave merged — completeness review skipped (the tree is at BASE)')
  assert.match(f.detail, /no wave merged/)
}

// ── 5. the dead critic: the fail-closed finding is typed too (#474) ──────────
{
  const repo = makeRepo(path.join(tmp, 'repo5'))
  const runDir = path.join(tmp, 'run5')
  const waves = [[
    { id: 'T1', title: 'one', files: ['one.txt'], tier: 'standard', review: 'lean',
      writes: ['one.txt'], commutes: [], body: 'task T1' },
  ]]
  const stub = (prompt, opts, cwd) => {
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') {
      fs.writeFileSync(path.join(cwd, 'one.txt'), 'x\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    if (opts.label === 'integration') throw new Error('sim: the critic died')
    throw new Error('unexpected: ' + opts.label)
  }
  const { run } = rig({ repo, runDir, waves, stub, stamp: 'ci5' })
  const report = await run()
  assert.equal(report.waveMerges[0].status, 'MERGED', 'sim precondition: the wave did merge')
  assert.equal(report.gitVerified, false, 'a dead critic withholds gitVerified (fail-closed)')

  assert.equal(report.completenessFindings.length, 1)
  const f = report.completenessFindings[0]
  assert.deepEqual(Object.keys(f).sort(), ['detail', 'severity'])
  assert.equal(f.severity, 'blocking')
  assert.equal(f.detail,
    'integration review did not run — completeness unverified; check the tree before merging')
  assert.match(f.detail, /integration review did not run/)
}

// ── 6. a live critic's findings pass through unchanged (#474) ────────────────
// `report.completenessFindings` is `review.findings` verbatim: the shape the
// schema produced is the shape the report carries, name and position unchanged.
{
  const repo = makeRepo(path.join(tmp, 'repo6'))
  const runDir = path.join(tmp, 'run6')
  const waves = [[
    { id: 'T1', title: 'one', files: ['one.txt'], tier: 'standard', review: 'lean',
      writes: ['one.txt'], commutes: [], body: 'task T1' },
  ]]
  const findings = [
    { severity: 'blocking', detail: 'fleet/run-engine.mjs: T1 produced no export' },
    { severity: 'minor', detail: 'fleet/tests/one.txt: a stray trailing newline' },
  ]
  const stub = (prompt, opts, cwd) => {
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') {
      fs.writeFileSync(path.join(cwd, 'one.txt'), 'x\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    if (opts.label === 'integration') return criticWithFindings(findings)
    throw new Error('unexpected: ' + opts.label)
  }
  const { run } = rig({ repo, runDir, waves, stub, stamp: 'ci6' })
  const report = await run()
  assert.deepEqual(report.completenessFindings, [
    { severity: 'blocking', detail: 'fleet/run-engine.mjs: T1 produced no export' },
    { severity: 'minor', detail: 'fleet/tests/one.txt: a stray trailing newline' },
  ])
}

// ── 7. the contracts block (2026-09-01): the critic gets the signed bodies ────
// The per-task reviewers each read a full six-slot body; the critic read ids
// and titles. Post-Manyana the composition question — Produces on one task
// and Consumes on another lining up, a Context literal implemented once, every
// Proof leg owning a test — is per-slot work only the integrated view can do,
// so the critic prompt carries every body and the compiler-derived edges.
{
  const repo = makeRepo(path.join(tmp, 'repo7'))
  const runDir = path.join(tmp, 'run7')
  const t1Body = '**Claim:** the reader exists (elicited)\n**Interfaces:**\n- Produces: `readX(dir) -> manifest`\n**Proof:**\n- Legs: (a) readX returns the manifest'
  const t2Body = '**Claim:** the judge names a winner (elicited)\n**Interfaces:**\n- Consumes: `readX(dir) -> manifest`\n**Context:** manifest schema literal\n**Proof:**\n- Legs: (a) judge reads via readX'
  const waves = [
    [{ id: 'T1', title: 'one', files: ['one.txt'], tier: 'standard', review: 'lean',
       writes: ['one.txt'], commutes: [], body: t1Body,
       interfaces: { consumes: [], produces: ['`readX(dir) -> manifest`'] } }],
    [{ id: 'T2', title: 'two', files: ['two.txt'], tier: 'standard', review: 'lean',
       writes: ['two.txt'], commutes: [], body: t2Body,
       interfaces: { consumes: ['`readX(dir) -> manifest`'], produces: [] } }],
  ]
  const prompts = []
  const stub = (prompt, opts, cwd) => {
    prompts.push({ label: opts.label, prompt })
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') {
      fs.writeFileSync(path.join(cwd, opts.label.split(':')[1] === 'T1' ? 'one.txt' : 'two.txt'), 'x\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected: ' + opts.label)
  }
  const { run } = rig({ repo, runDir, waves, edges: [['T1', 'T2']], stub, stamp: 'ci7' })
  const report = await run()
  assert.equal(report.coverage.complete, true, 'sim precondition: both waves merged')

  const criticPrompt = prompts.find((p) => p.label === 'integration').prompt
  assert.match(criticPrompt, /\n\nCONTRACTS \(/, 'the critic prompt carries no CONTRACTS block')
  assert.ok(criticPrompt.includes('### Task T1: one\n' + t1Body), 'T1\'s signed body is not in the critic prompt verbatim')
  assert.ok(criticPrompt.includes('### Task T2: two\n' + t2Body), 'T2\'s signed body is not in the critic prompt verbatim')
  assert.match(criticPrompt, /DEPENDENCY EDGES \(derived by the compiler/, 'the derived edges are not named')
  assert.ok(criticPrompt.includes('\n- T1 -> T2'), 'the T1 -> T2 edge is not listed')
  assert.match(criticPrompt, /Stale-if and Authorized-by are not yours to judge/,
    'the block does not scope the slots the critic is NOT asked to judge')
  // Order: the block sits between the task list and the blocked-waves record,
  // so every pre-existing section stays where scenario 1 pinned it.
  const iTasks = criticPrompt.indexOf('\n\nTasks:\n')
  const iContracts = criticPrompt.indexOf('\n\nCONTRACTS (')
  const iBlocked = criticPrompt.indexOf('\nBlocked waves:\n')
  const iSuite = criticPrompt.indexOf('\nSUITE (driver-run, post-fold)')
  assert.ok(iTasks >= 0 && iContracts > iTasks && iBlocked > iContracts && iSuite > iBlocked,
    'CONTRACTS must follow the task list and precede blocked waves and the suite section')
  // The per-task reviewer's body and the critic's body are the same text: one
  // contract, two readers — a drift here would grade the tree against a
  // different plan than the diff was graded against.
  const reviewT2 = prompts.find((p) => p.label === 'review:T2:1').prompt
  assert.ok(reviewT2.includes(t2Body), 'sim precondition: the reviewer saw T2\'s body')
}

// ── 8. the wavesPath branch and the empty cases, as a pure function ──────────
// A live run may carry bodies only in launch.json (taskBodyBlock's pointer
// path); the critic is pointed at the same file rather than left with titles.
{
  const out = contractsBlock([[{ id: 'T9', title: 'nine' }]], [], '/run/launch.json')
  assert.match(out, /### Task T9: nine\n\(body: in \/run\/launch\.json, the "tasks" entry whose "id" is "T9"\)/,
    'a body-less task must point the critic at wavesPath')
  assert.ok(!/DEPENDENCY EDGES/.test(out), 'no edges renders no edge section')
  assert.equal(contractsBlock([], [['a', 'b']], undefined), '', 'no tasks renders nothing')
  assert.match(contractsBlock([[{ id: 'A', body: 'body A' }]], [['A', 'B'], ['bad'], null], undefined),
    /DEPENDENCY EDGES[\s\S]*\n- A -> B$/, 'malformed edges are skipped, well-formed ones listed')
  // The role file says the same thing the block says about scope — the critic
  // reads both, and they must not disagree about which slots are its to judge.
  const role = fs.readFileSync(new URL('../roles/critic.md', import.meta.url), 'utf8')
  assert.match(role, /Stale-if and Authorized-by are not yours to judge/,
    'critic.md no longer scopes the two slots the contracts block excludes')
  for (const slot of ['Claim', 'Interfaces', 'Context', 'Proof']) {
    assert.ok(role.includes(slot + ':'), 'critic.md carries no per-slot check for ' + slot)
  }
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log('ALL TESTS PASSED')
