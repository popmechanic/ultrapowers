// fleet/tests/test_shim_main_plan_assignment.mjs — #544: the "plan at base"
// rule becomes "plan in the assignment, hash recorded in the receipt".
//
// The plan the run executes no longer has to exist in the base the driver
// pushed. When the assignment carries `plan: { text, verdicts }`, the sandbox
// MATERIALISES it into a run-owned directory after the BASE_REF checkout and
// launches the engine against that repo-relative path; `main()` stamps the
// hex SHA-256 of the plan text on the run row so the receipt names exactly the
// plan that ran.
//
// Three shapes are load-bearing and each is pinned below:
//   - the directory is `assignment-<runId>`, NOT `run-…`, so #190's
//     "the run's own directories are the ones that did not exist before
//     launch" scope never sees it as gate evidence;
//   - the writes happen AFTER the checkout (the checkout would otherwise
//     clobber or lose them);
//   - an assignment without `plan` launches byte-identically to BASE.
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { startOrchestrator, FLEET_PATH } from '../orchestrator.mjs'
import { mintToken } from '../tokens.mjs'
import {
  main as shimMain,
  invokeEngineRun,
  oneDriverArgs,
  runArtifactDirs,
  sandboxIdFor,
  RUN_ARTIFACT_DIR,
} from '../shim-main.mjs'

let passed = 0
const ok = (label) => {
  passed += 1
  console.log(`ok - ${label}`)
}

const PLAN_PATH = 'docs/plans/some-plan.md'
const ASSIGNMENT_DIR = path.join(RUN_ARTIFACT_DIR, 'assignment-r1')
const PLAN_FILE = path.join(ASSIGNMENT_DIR, 'some-plan.md')
const VERDICT_FILE = path.join(ASSIGNMENT_DIR, 'some-plan.gate-verdicts.json')

/**
 * `invokeEngineRun` over a scratch repo with both seams stubbed: the exec seam
 * greens the checkout and records the order of events, the spawn seam records
 * the argv it was handed. No process is ever started.
 */
const ENGINE_DIR = '/engine'

const runInvoke = async ({ plan, planPath = PLAN_PATH }) => {
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-plan-assign-'))
  const events = []
  const seen = (label) => {
    events.push({
      label,
      planFile: fs.existsSync(path.join(repoDir, PLAN_FILE)),
      verdictFile: fs.existsSync(path.join(repoDir, VERDICT_FILE)),
    })
  }
  let argv = null
  const outcome = await invokeEngineRun({
    engineDir: ENGINE_DIR,
    repoDir,
    planPath,
    runId: 'r1',
    ...(plan === undefined ? {} : { plan }),
    exec: async (cmd) => {
      seen(/checkout/.test(cmd) ? 'checkout' : 'exec')
      return { code: 0, stdout: '' }
    },
    spawnEngine: async (spec) => {
      seen('spawn')
      argv = spec.args
      return 0
    },
    log: () => {},
    // A no-op load sampler (#549), like every other seam here: the live one
    // would create `run-r1` to hold its load.jsonl, and (e) below is about
    // which directories the PLAN materialisation makes. Injected, this sim
    // reads exactly the behaviour it read at BASE.
    startSampler: () => ({ stop: () => {} }),
  })
  return { repoDir, events, argv, outcome, cleanup: () => fs.rmSync(repoDir, { recursive: true, force: true }) }
}

// --- (a) plan + verdicts: both files land, the argv is repo-relative --------
{
  const { repoDir, argv, cleanup } = await runInvoke({ plan: { text: 'T', verdicts: 'V' } })
  assert.equal(fs.readFileSync(path.join(repoDir, PLAN_FILE), 'utf8'), 'T')
  assert.equal(fs.readFileSync(path.join(repoDir, VERDICT_FILE), 'utf8'), 'V')
  assert.deepEqual(
    argv,
    oneDriverArgs({
      engineDir: ENGINE_DIR,
      repoDir,
      planPath: '.claude/ultrapowers/assignment-r1/some-plan.md',
      runId: 'r1',
      overlap: undefined,
    }),
  )
  assert.equal(argv[1], '.claude/ultrapowers/assignment-r1/some-plan.md')
  cleanup()
  ok('assignment plan: text + verdicts are written and the engine launches against the repo-relative copy')
}

// --- (b) verdicts:null: the plan lands, no verdict file exists --------------
{
  const { repoDir, argv, cleanup } = await runInvoke({ plan: { text: 'T', verdicts: null } })
  assert.equal(fs.readFileSync(path.join(repoDir, PLAN_FILE), 'utf8'), 'T')
  assert.equal(fs.existsSync(path.join(repoDir, VERDICT_FILE)), false)
  assert.equal(argv[1], '.claude/ultrapowers/assignment-r1/some-plan.md')
  cleanup()
  ok('assignment plan: verdicts:null writes no gate-verdicts.json')
}

// --- (c) no plan: the argv is exactly what BASE spawned ---------------------
{
  const { repoDir, argv, cleanup } = await runInvoke({ plan: undefined })
  assert.deepEqual(
    argv,
    oneDriverArgs({ engineDir: ENGINE_DIR, repoDir, planPath: PLAN_PATH, runId: 'r1', overlap: undefined }),
  )
  assert.equal(fs.existsSync(path.join(repoDir, ASSIGNMENT_DIR)), false)
  cleanup()
  ok('no assignment plan: the spawned argv deep-equals oneDriverArgs({ engineDir, repoDir, planPath, runId })')
}

// --- (d) the writes happen AFTER the checkout ------------------------------
{
  const { events, cleanup } = await runInvoke({ plan: { text: 'T', verdicts: 'V' } })
  assert.deepEqual(
    events,
    [
      { label: 'checkout', planFile: false, verdictFile: false },
      { label: 'spawn', planFile: true, verdictFile: true },
    ],
    `expected the plan writes between the checkout and the spawn, got: ${JSON.stringify(events)}`,
  )
  cleanup()
  ok('assignment plan: the files are written after the BASE_REF checkout and before the spawn')
}

// --- (e) #190: the assignment directory is invisible to the receipt scope ---
{
  const { repoDir, cleanup } = await runInvoke({ plan: { text: 'T', verdicts: 'V' } })
  assert.equal(fs.existsSync(path.join(repoDir, ASSIGNMENT_DIR)), true)
  assert.deepEqual(runArtifactDirs(repoDir), [])
  fs.mkdirSync(path.join(repoDir, RUN_ARTIFACT_DIR, 'run-r1'), { recursive: true })
  assert.deepEqual(runArtifactDirs(repoDir), ['run-r1'])
  cleanup()
  ok('assignment-<runId> is not a run-* directory, so no gate-receipt read ever sees it')
}

// --- (f) main() stamps runs.<runId>.planSha256 -----------------------------
// A live orchestrator and the real main(), with `invokeRun` stubbed so no
// engine launches. The cell is read off the ORCHESTRATOR's store, i.e. after
// the aux publish synced.
const runMainWithPlan = async ({ runId, plan }) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-plan-sha-'))
  const now = Date.now()
  const { token, record } = mintToken({ sandboxId: sandboxIdFor(runId), ttlMs: 60_000, now })
  const orch = await startOrchestrator({
    port: 0,
    dbDir: path.join(tmp, 'db'),
    tokenRecords: [record],
    actions: { page: () => {}, revokeAndPark: () => {}, destroySandbox: () => {} },
  })
  orch.store.setRow('runs', runId, { planPath: 'p.md', sandboxId: '', status: 'pending', branch: 'fleet-run' })
  const assignmentPath = path.join(tmp, 'fleet-run.json')
  fs.writeFileSync(
    assignmentPath,
    JSON.stringify({
      runId,
      token,
      wsUrl: `ws://127.0.0.1:${orch.port}/${FLEET_PATH}`,
      ttlMs: 60_000,
      planPath: PLAN_PATH,
      ...(plan === undefined ? {} : { plan }),
    }),
  )
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-plan-sha-repo-'))
  try {
    const outcome = await shimMain({
      assignmentPath,
      repoDir,
      exec: async () => ({ code: 1, stdout: '' }),
      invokeRun: async () => ({ gateGreen: true }),
      readTokens: () => 4200,
    })
    return { outcome, planSha256: orch.store.getCell('runs', runId, 'planSha256') }
  } finally {
    await orch.stop()
    fs.rmSync(tmp, { recursive: true, force: true })
    fs.rmSync(repoDir, { recursive: true, force: true })
  }
}

{
  const { outcome, planSha256 } = await runMainWithPlan({
    runId: 'run-plan-sha',
    plan: { text: 'T', verdicts: 'V' },
  })
  assert.deepEqual(outcome, { status: 'gate-green', delivered: true })
  assert.equal(planSha256, crypto.createHash('sha256').update('T').digest('hex'))
  assert.equal(planSha256, 'e632b7095b0bf32c260fa4c539e9fd7b852d0de454e9be26f24d0d6f91d069d3')
  ok('main(): an assignment with a plan stamps runs.<runId>.planSha256 = sha256(text)')
}

{
  const { outcome, planSha256 } = await runMainWithPlan({ runId: 'run-plan-sha-absent', plan: undefined })
  assert.deepEqual(outcome, { status: 'gate-green', delivered: true })
  assert.equal(planSha256, undefined)
  ok('main(): an assignment without a plan stamps no planSha256 cell')
}

console.log(`\nALL TESTS PASSED (${passed})`)
