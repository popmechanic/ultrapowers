// fleet/tests/test_run_engine_review_economy.mjs — what a reviewer-minute
// bought, and the channel that bought nothing.
//
// Two halves of one accounting question. The `cannotVerify` channel asked a
// reviewer to list what it could not judge and then paid a second agent to
// judge the list; #604 and this plan's driver-run evidence answer those
// questions with bytes, so the channel is removed rather than left to
// manufacture work. In its place the run reports the ratio it never had:
// wall-clock reviewer milliseconds against the blocking findings those minutes
// actually returned, with the pair-review premium (`r2MarginalBlocking`) broken
// out — the number that says whether a second reviewer is worth its cost.
//
// Machine clauses under test (legs (f), (g) and (h) of the Proof):
//   M6 — the `cannotVerify` channel is gone: no schema property, no
//        accumulator, no CANNOT-VERIFY checklist in the critic's prompt, no
//        no-wave-merged judgment calls, and the string does not occur in
//        `fleet/run-engine.mjs` at all.
//   M7 — `reviewEconomy: { reviewerMs, blockingFindings,
//        blockingPerReviewerMinute, pairRounds, r2MarginalBlocking }`;
//        `reviewerMs` sums every `review:` agent call measured INDIVIDUALLY (a
//        concurrent pair contributes both durations), `blockingFindings` counts
//        de-duplicated reviewer-returned blocking issues only (driver-minted
//        Run:/Check: reds excluded), the ratio is per reviewer-minute and 0
//        when no reviewer ran.
//   M8 — a run with no `proofRuns`, no `constraintChecks` and clean reviews
//        leaves every captured prompt of every role byte-identical to the same
//        run on BASE's engine, `integratedChecks` [], `proofFixes: 0` on every
//        row, and `reviewEconomy` present.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execSeam } from '../run-main.mjs'
import { makeCwdFor, withPatchCapture, defaultTaskIdOf } from '../run-waves.mjs'
import { runEngine, REVIEWER_SCHEMA } from '../run-engine.mjs'
import { rig, makeRepo, provision, passReview, cleanCritic, doneImpl } from './_engine_helpers.mjs'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-review-economy-'))
// rmSync unlinks the base tree's `skills` symlink rather than following it.
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }))
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const FLEET_DIR = fileURLToPath(new URL('..', import.meta.url))
const ROLES_DIR = fileURLToPath(new URL('../roles/', import.meta.url))
const ENGINE_SRC = fileURLToPath(new URL('../run-engine.mjs', import.meta.url))
const BASE_SHA = '2cc873fb2d040fbe081f35ff0ababc408eaa6500'

const ECONOMY_KEYS = ['blockingFindings', 'blockingPerReviewerMinute', 'pairRounds',
                      'r2MarginalBlocking', 'reviewerMs']
const mkTask = (id, files, over = {}) => ({
  id, title: id.toLowerCase(), files, tier: 'standard', review: 'lean',
  writes: files, commutes: [], proofTests: [], proofRuns: [],
  body: 'task ' + id + ' body', ...over,
})
const fileOf = (id) => (id === 'A' ? 'a.txt' : id === 'B' ? 'b.txt' : 'a.txt')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const eventsOf = (runDir) => {
  const file = path.join(runDir, 'events.jsonl')
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
}

// ── the channel is gone [M6] ─────────────────────────────────────────────────
{
  assert.ok(!Object.prototype.hasOwnProperty.call(
    REVIEWER_SCHEMA.properties.issues.items.properties, 'cannotVerify'),
    'the reviewer issue object must carry no `cannotVerify` property: ' +
    JSON.stringify(Object.keys(REVIEWER_SCHEMA.properties.issues.items.properties)))
  assert.ok(!Object.prototype.hasOwnProperty.call(REVIEWER_SCHEMA.properties, 'cannotVerify'),
    'and neither must the reply object: ' + JSON.stringify(Object.keys(REVIEWER_SCHEMA.properties)))
  // The Proof's first Run: reads the file; so does this, so the sim says the
  // same thing the command says.
  assert.ok(!fs.readFileSync(ENGINE_SRC, 'utf8').includes('cannotVerify'),
    'the string `cannotVerify` still occurs in fleet/run-engine.mjs — the schema property, ' +
    'the accumulator, the checklist and the no-wave-merged judgment calls all go')
}

// ── a reviewer that files one anyway is simply not read [M6] + [M7] ──────────
{
  const repo = makeRepo(path.join(tmp, 'repo-cv'))
  const runDir = path.join(tmp, 'run-cv')
  const prompts = {}
  const stub = (prompt, opts, cwd) => {
    prompts[opts.label] = prompt
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') {
      fs.writeFileSync(path.join(cwd, 'a.txt'), 'from-A\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') {
      return { verdict: 'PASS', issues: [],
               cannotVerify: [{ requirement: 'x', why: 'y' }] }
    }
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run } = rig({ repo, runDir, waves: [[mkTask('A', ['a.txt'])]], stub, stamp: 're1',
                        extraArgs: { shallowLeg: false } })
  const report = await run()
  assert.equal(report.coverage.complete, true,
    'an unread extra field must not fail the task: ' + JSON.stringify(report.tasks))
  const critic = prompts['integration']
  assert.ok(!critic.includes('CANNOT-VERIFY'),
    'the critic prompt must carry no CANNOT-VERIFY checklist: ' + critic.slice(0, 1200))
  // BASE rendered each escalated item as `- [<task>] <requirement> (<why>)`.
  assert.ok(!/\[A\]\s*x\b/.test(critic) && !critic.includes('x (y)'),
    'and no escalated item line of its own: ' + critic.slice(0, 1200))
  assert.ok(!report.judgmentCalls.some((j) => String(j).includes('cannot-verify')),
    'and no cannot-verify judgment call survives: ' + JSON.stringify(report.judgmentCalls))

  // [M7] an instantly-returning reviewer still produces a finite measurement.
  const eco = report.reviewEconomy
  assert.equal(typeof eco, 'object', 'the report carries no `reviewEconomy` object')
  assert.deepEqual(Object.keys(eco).sort(), ECONOMY_KEYS,
    'reviewEconomy carries exactly the five fields: ' + JSON.stringify(Object.keys(eco)))
  assert.equal(Number.isFinite(eco.reviewerMs), true,
    'reviewerMs is a finite number: ' + JSON.stringify(eco.reviewerMs))
  assert.ok(eco.reviewerMs >= 0, 'and never negative: ' + eco.reviewerMs)
  assert.equal(eco.pairRounds, 0, 'a lean review dispatches no pair: ' + JSON.stringify(eco))
}

// ── the pair costs both durations, not the longer one [M7] ───────────────────
{
  const repo = makeRepo(path.join(tmp, 'repo-g1'))
  const runDir = path.join(tmp, 'run-g1')
  const stub = async (prompt, opts, cwd) => {
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') {
      fs.writeFileSync(path.join(cwd, 'a.txt'), 'from-A\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') {
      await sleep(opts.label.split(':')[3] === '2' ? 200 : 30)
      return passReview()
    }
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run } = rig({ repo, runDir, waves: [[mkTask('A', ['a.txt'], { review: 'peer' })]],
                        stub, stamp: 're2', extraArgs: { shallowLeg: false } })
  const report = await run()
  const eco = report.reviewEconomy
  assert.equal(report.coverage.complete, true, 'sim precondition: the task merged')
  // A per-round MAXIMUM would read about 200 here and fail this bound; the sum
  // of the two individually-measured calls reads about 230.
  assert.ok(eco.reviewerMs >= 230,
    'a concurrent pair contributes BOTH durations (30 ms + 200 ms), got: ' + eco.reviewerMs)
  assert.ok(eco.reviewerMs < 1000,
    'and only the reviewer calls, not the whole run: ' + eco.reviewerMs)
  assert.equal(eco.pairRounds, 1, 'one review round dispatched a pair: ' + JSON.stringify(eco))
  assert.equal(eco.blockingFindings, 0, 'and returned nothing blocking: ' + JSON.stringify(eco))
  assert.equal(eco.blockingPerReviewerMinute, 0, 'so the ratio is 0: ' + JSON.stringify(eco))
  assert.equal(eco.r2MarginalBlocking, 0,
    'and reviewer 2 found nothing reviewer 1 missed: ' + JSON.stringify(eco))
}

// ── what the second reviewer was worth [M7] ──────────────────────────────────
{
  const repo = makeRepo(path.join(tmp, 'repo-g2'))
  const runDir = path.join(tmp, 'run-g2')
  const calls = []
  const stub = async (prompt, opts, cwd) => {
    calls.push(opts.label)
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') {
      fs.writeFileSync(path.join(cwd, 'a.txt'), 'from-A\n')
      return doneImpl(cwd)
    }
    if (kind === 'fix') {
      fs.writeFileSync(path.join(cwd, 'a.txt'), 'repaired\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') {
      await sleep(30)
      const [, , round, pass] = opts.label.split(':')
      if (round !== '1') return passReview()
      const d1 = { severity: 'blocking', detail: 'd1', actor: 'implementer' }
      const d2 = { severity: 'blocking', detail: 'd2', actor: 'implementer' }
      return { verdict: 'FIX_REQUIRED', issues: pass === '2' ? [d1, d2] : [d1] }
    }
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run } = rig({ repo, runDir, waves: [[mkTask('A', ['a.txt'], { review: 'peer' })]],
                        stub, stamp: 're3', extraArgs: { shallowLeg: false } })
  const report = await run()
  const eco = report.reviewEconomy
  assert.equal(report.tasks.find((r) => r.task === 'A').reviewVerdict, 'fixed',
    'sim precondition: the fix round ran and round 2 passed')
  assert.equal(calls.filter((l) => l.startsWith('review:')).length, 4,
    'sim precondition: two pair rounds, four reviewer calls: ' + calls.join(','))

  assert.ok(eco.reviewerMs >= 120,
    'four reviewers at 30 ms each are summed, not maxed: ' + eco.reviewerMs)
  assert.ok(eco.reviewerMs < 1000, 'and nothing else is counted: ' + eco.reviewerMs)
  assert.equal(eco.blockingFindings, 2,
    '`d1` is de-duplicated across the pair, `d2` is its own: ' + JSON.stringify(eco))
  assert.equal(eco.pairRounds, 2, 'both rounds dispatched a pair: ' + JSON.stringify(eco))
  assert.equal(eco.r2MarginalBlocking, 1,
    'exactly one blocking issue was reviewer 2\'s alone (`d2`): ' + JSON.stringify(eco))
  assert.equal(eco.blockingPerReviewerMinute.toFixed(6),
    (2 / (eco.reviewerMs / 60000)).toFixed(6),
    'the ratio is blockingFindings per reviewer-MINUTE: ' + JSON.stringify(eco))
}

// ── a driver-minted red is not a reviewer's finding [M7] ─────────────────────
// The Run: is green on the pre-review pass (so the patch reaches a referee) and
// red on every review round after it — the reviewers return PASS throughout, so
// every blocking issue in the run is the driver's own.
{
  const TOGGLE = "sh -c 'if [ -e seen.txt ]; then exit 1; else : > seen.txt; fi'"
  const repo = makeRepo(path.join(tmp, 'repo-g4'))
  const runDir = path.join(tmp, 'run-g4')
  const stub = (prompt, opts, cwd) => {
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') {
      fs.writeFileSync(path.join(cwd, 'a.txt'), 'from-A\n')
      return doneImpl(cwd)
    }
    if (kind === 'fix') return doneImpl(cwd)
    if (kind === 'review') return passReview()
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run } = rig({ repo, runDir, waves: [[mkTask('A', ['a.txt'], { proofRuns: [TOGGLE] })]],
                        stub, stamp: 're4', extraArgs: { shallowLeg: false } })
  const report = await run()
  const row = report.tasks.find((r) => r.task === 'A')
  assert.ok(eventsOf(runDir).some((e) => e.kind === 'driver:proof-run' && e.exit !== 0),
    'the driver recorded a red Run: of its own (M1 ran the command once before review, so ' +
    'every round after it reads red): ' + JSON.stringify(eventsOf(runDir).map((e) => [e.kind, e.iter, e.exit])))
  assert.equal(row.reviewVerdict, 'fix-loop-exhausted',
    'and that driver-minted red drove the fix loop by itself: ' + JSON.stringify(row))
  assert.ok(report.reviewEconomy.reviewerMs >= 0,
    'the reviewers still ran and were still measured: ' + JSON.stringify(report.reviewEconomy))
  assert.equal(report.reviewEconomy.blockingFindings, 0,
    'a driver-minted Run:/Check: red is never counted as a reviewer\'s finding: ' +
    JSON.stringify(report.reviewEconomy))
}

// ── leg (h): empty evidence changes nothing [M8] ─────────────────────────────
// The byte-pin needs BASE in the object store. A depth-1 clone — the engine's
// own shallow leg and `actions/checkout`'s default — has no 2cc873f; there the
// leg has nothing to say and says so, rather than failing for a reason
// unrelated to the tree (test_run_engine_integrated_runs.mjs guards the same way).
const haveBase = (() => {
  try {
    execFileSync('git', ['cat-file', '-e', BASE_SHA + '^{commit}'],
      { cwd: REPO_ROOT, stdio: 'ignore' })
    return true
  } catch { return false }
})()
let baseRunEngine = null
if (haveBase) {
  const baseTree = path.join(tmp, 'base-tree')
  fs.cpSync(FLEET_DIR, path.join(baseTree, 'fleet'), {
    recursive: true, filter: (src) => path.basename(src) !== 'tests',
  })
  fs.writeFileSync(path.join(baseTree, 'fleet', 'run-engine.mjs'),
    execFileSync('git', ['show', BASE_SHA + ':fleet/run-engine.mjs'],
      { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }))
  fs.symlinkSync(path.join(REPO_ROOT, 'skills'), path.join(baseTree, 'skills'))
  ;({ runEngine: baseRunEngine } =
    await import(pathToFileURL(path.join(baseTree, 'fleet', 'run-engine.mjs')).href))
} else {
  console.log('[M8] BASE ' + BASE_SHA + ' is not in this clone (shallow) — the ' +
    'byte-for-byte comparison against the BASE engine is skipped')
}

const PIN_REPO = makeRepo(path.join(tmp, 'pin-repo'))
const pinRunDir = path.join(tmp, 'pin-run')
// Both engines are driven through the SAME run directory: prompts name the
// patch FILE, so a second directory would differ in bytes that are not this
// change.
async function pinRun(engine, tasks) {
  fs.rmSync(pinRunDir, { recursive: true, force: true })
  const { base, clonesDir, patchesDir } =
    provision({ repo: PIN_REPO, runDir: pinRunDir, taskIds: tasks.map((t) => t.id) })
  const patchBase = { current: base }
  const cwdFor = makeCwdFor({ clonesDir })
  const prompts = {}
  const inner = async (p, opts) => {
    const cwd = cwdFor(opts)
    prompts[opts.label] = p
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') {
      fs.writeFileSync(path.join(cwd, fileOf(opts.label.split(':')[1])), 'written\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const agent = withPatchCapture({
    agent: inner, clonesDir, base: () => patchBase.current, patchesDir, taskIdOf: defaultTaskIdOf,
  })
  const report = await engine({
    args: {
      waves: [tasks], edges: [], testCmd: 'bash check.sh',
      acceptance: { mode: 'suite', reason: 'sim' }, stamp: 'pin',
      integrationBranch: 'ultra/integration-pin', dependencyEdges: [],
      patchInput: patchesDir, shallowLeg: false,
    },
    agent,
    parallel: (thunks) => Promise.all(thunks.map((t) => t())),
    exec: execSeam,
    paths: { repoDir: PIN_REPO, runDir: pinRunDir, clonesDir },
    log: () => {},
    rolesDir: ROLES_DIR,
    patchBase,
  })
  return { prompts, report }
}
{
  const pair = () => [mkTask('A', ['a.txt']), mkTask('B', ['b.txt'])]
  const basePin = haveBase ? await pinRun(baseRunEngine, pair()) : null
  const live = await pinRun(runEngine, pair())

  assert.equal(live.report.coverage.complete, true, 'sim precondition: both tasks merged')
  assert.deepEqual(live.report.integratedChecks, [],
    'no constraintChecks leaves `integratedChecks` as [] — present, not absent')
  for (const row of live.report.tasks) {
    assert.equal(row.proofFixes, 0,
      'every task row carries proofFixes 0 when nothing was repaired: ' + JSON.stringify(row))
  }
  assert.deepEqual(Object.keys(live.report.reviewEconomy || {}).sort(), ECONOMY_KEYS,
    'and reviewEconomy is present with exactly its five fields: ' +
    JSON.stringify(live.report.reviewEconomy))

  if (basePin) {
    assert.deepEqual(Object.keys(live.prompts).sort(), Object.keys(basePin.prompts).sort(),
      'the same roles are dispatched as on BASE\'s engine')
    for (const label of Object.keys(basePin.prompts).sort()) {
      assert.equal(live.prompts[label], basePin.prompts[label],
        'an empty-evidence run must leave the ' + label +
        ' prompt byte-identical to BASE\'s (the run-51 rule)')
    }
  }
}

console.log('ALL TESTS PASSED')
