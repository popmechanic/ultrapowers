// fleet/tests/test_shim_main_engine_target.mjs — the exam for "the shim runs the
// engine from one clone against another" (Task 2).
//
// One sandbox, two directories. Until now `shim-main.mjs` had a single
// `REPO_DIR` that was BOTH the checkout it launched `fleet/run-main.mjs` from
// and the tree the run built, gated, sampled and published. This exam pins the
// split:
//
//   ENGINE  `/home/exedev/repo`   — the golden's baked clone, parked at
//                                   `fleet-engine`; the code that RUNS, and the
//                                   only thing the version stamp may name.
//   TARGET  `/home/exedev/target` — the fresh clone the driver pushed
//                                   `fleet-base` into; the tree the run BUILDS,
//                                   and the only thing every other read may
//                                   name.
//
// Legs, and the Machine clause each one grades:
//   (a)  M1 — the four exported constants; `REPO_DIR` is gone.
//   (b)  M2 — `oneDriverArgs({...})`'s exact argv, `--repo <repoDir>` at 3/4.
//   (c)  M3 — `invokeEngineRun`: checkout before spawn, `cwd`/`args`, and no
//             command naming the engine directory.
//   (c′) M3 — a failing checkout: the exact refusal, zero spawns.
//   (d)  M4 — `main()` stamps the ENGINE's sha and manifest version, via
//             `rev-parse fleet-engine`, and never `rev-parse fleet-base`.
//   (e)  M5 — `main()`'s receipts, branch detection, sampler and promoter all
//             resolve under the TARGET.
//
// Leg (e) is graded over two real `main()` runs, because its clauses live on
// two different bindings: the receipts/branch half runs with `invokeRun`
// injected (as the leg is written), and the sampler/promoter half needs the
// DEFAULT `invokeRun` binding — that binding is where `startLoadSampler` and
// `startEventPromoter` are wired — so it injects `spawnEngine` instead and
// drives the real `invokeEngineRun` inside `main()`. Both runs assert the same
// closing rule: after the two stamp reads, no recorded command names the engine
// repo at all.
//
// Everything git here is REAL: two throwaway repos, a real recording `exec`
// that actually shells out, a real orchestrator on a loopback port, and a real
// `git cat-file -e <sha>:<path>` to prove the published receipt dereferences in
// the target and nowhere else.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import * as shim from '../shim-main.mjs'

let passed = 0
const ok = (label) => {
  passed += 1
  console.log(`ok - ${label}`)
}

const sh = (cmd, cwd) =>
  new Promise((resolve) => {
    execFile('/bin/sh', ['-c', cmd], { cwd }, (error, stdout, stderr) =>
      resolve({
        code: typeof error?.code === 'number' ? error.code : error ? 1 : 0,
        stdout: stdout ?? '',
        stderr: stderr ?? '',
      }),
    )
  })

const STAMP = '20260902120000'
const INTEGRATION_BRANCH = `ultra/integration-${STAMP}`
const cleanups = []
const tmpdir = (prefix) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

/** A real one-commit repo carrying `<branch>` and a manifest of `<version>`. */
const mkRepo = async (prefix, version, branch) => {
  const dir = tmpdir(prefix)
  fs.mkdirSync(path.join(dir, '.claude-plugin'), { recursive: true })
  fs.writeFileSync(path.join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({ version }))
  fs.writeFileSync(path.join(dir, 'f.txt'), `${prefix}\n`)
  const init = await sh(
    'git init -q -b main . && git config user.email t@example.com && git config user.name t && ' +
      'git add -A && git -c commit.gpgsign=false commit -q -m init',
    dir,
  )
  assert.equal(init.code, 0, `fixture repo init failed: ${init.stderr}`)
  assert.equal((await sh(`git branch ${branch} main`, dir)).code, 0, `fixture branch ${branch} failed`)
  return dir
}

const writeGateReceipt = (repoDir) => {
  const runDir = path.join(repoDir, '.claude', 'ultrapowers', `run-${STAMP}`)
  fs.mkdirSync(runDir, { recursive: true })
  fs.writeFileSync(
    path.join(runDir, 'gate-receipt.json'),
    JSON.stringify({ mode: 'gate', stamp: STAMP, verdict: 'PASS' }),
  )
}

// ===========================================================================
// (a) [M1] the two directories and the two refs are exported literals, and the
//          single `REPO_DIR` they replace is gone.
// ===========================================================================
{
  assert.equal(shim.ENGINE_DIR, '/home/exedev/repo', '(a) [M1] ENGINE_DIR is the engine clone')
  assert.equal(shim.TARGET_DIR, '/home/exedev/target', '(a) [M1] TARGET_DIR is the target clone')
  assert.equal(shim.ENGINE_REF, 'fleet-engine', '(a) [M1] ENGINE_REF is the engine ref')
  assert.equal(shim.BASE_REF, 'fleet-base', '(a) [M1] BASE_REF is unchanged')
  assert.equal(
    Object.keys(shim).includes('REPO_DIR'),
    false,
    '(a) [M1] REPO_DIR is no longer an export — one name for two directories is the bug this task removes',
  )
  ok('(a) [M1] ENGINE_DIR/TARGET_DIR/ENGINE_REF/BASE_REF exported; REPO_DIR is not')
}

// ===========================================================================
// (b) [M2] oneDriverArgs({ engineDir, repoDir, planPath, runId, overlap })
// ===========================================================================
{
  const base = { engineDir: '/engine', repoDir: '/target', planPath: 'docs/plan.md', runId: 'run-24' }

  assert.deepEqual(
    shim.oneDriverArgs(base),
    ['/engine/fleet/run-main.mjs', 'docs/plan.md', 'run-24', '--repo', '/target'],
    '(b) [M2] without overlap: the driver module comes from the ENGINE, --repo names the TARGET',
  )
  assert.deepEqual(
    shim.oneDriverArgs({ ...base, overlap: 'serialize' }),
    ['/engine/fleet/run-main.mjs', 'docs/plan.md', 'run-24', '--repo', '/target', '--overlap', 'serialize'],
    '(b) [M2] with overlap: exactly two more entries, appended after --repo',
  )
  assert.deepEqual(
    shim.oneDriverArgs({ ...base, overlap: '' }),
    ['/engine/fleet/run-main.mjs', 'docs/plan.md', 'run-24', '--repo', '/target'],
    '(b) [M2] an empty overlap is not an overlap — no --overlap pair',
  )

  const argv = shim.oneDriverArgs({ ...base, overlap: 'serialize' })
  assert.equal(argv[3], '--repo', '(b) [M2] --repo sits at index 3')
  assert.equal(argv[4], '/target', '(b) [M2] the repoDir follows it at index 4')
  ok('(b) [M2] oneDriverArgs: exact argv with and without overlap; --repo <repoDir> at 3/4')
}

// ===========================================================================
// (c) [M3] invokeEngineRun: checkout first, spawn in the TARGET, argv from
//          oneDriverArgs, and not one command naming the engine directory.
// ===========================================================================
{
  const ENGINE = '/exam-engine-clone'   // a literal no other path here contains
  const target = tmpdir('fleet-et-c-target-')
  const seq = []
  const cmds = []
  const spawns = []

  const outcome = await shim.invokeEngineRun({
    engineDir: ENGINE,
    repoDir: target,
    planPath: 'docs/plan.md',
    runId: 'run-c',
    overlap: 'serialize',
    exec: async (cmd) => {
      seq.push(`exec:${cmd}`)
      cmds.push(cmd)
      return { code: 0, stdout: '' }
    },
    spawnEngine: async (call) => {
      seq.push('spawn')
      spawns.push(call)
      return 0
    },
    startSampler: () => ({ stop: () => {} }),
    log: () => {},
  })

  assert.equal(spawns.length, 1, '(c) [M3] exactly one spawn')
  assert.equal(
    seq[0],
    `exec:git -C ${target} checkout -q fleet-base`,
    `(c) [M3] the fleet-base checkout is issued against the TARGET, before anything else; got ${JSON.stringify(seq)}`,
  )
  assert.ok(
    seq.indexOf(`exec:git -C ${target} checkout -q fleet-base`) < seq.indexOf('spawn'),
    '(c) [M3] the checkout precedes the spawn',
  )
  assert.equal(spawns[0].command, 'node', '(c) [M3] the engine is spawned with node')
  assert.equal(spawns[0].cwd, target, "(c) [M3] the spawn's cwd is the TARGET — the tree the run builds")
  assert.deepEqual(
    spawns[0].args,
    shim.oneDriverArgs({
      engineDir: ENGINE,
      repoDir: target,
      planPath: 'docs/plan.md',
      runId: 'run-c',
      overlap: 'serialize',
    }),
    '(c) [M3] the spawned argv deep-equals oneDriverArgs of the same five values',
  )
  assert.equal(
    spawns[0].args[0],
    path.join(ENGINE, 'fleet', 'run-main.mjs'),
    '(c) [M3] args[0] is the ENGINE clone\'s run-main.mjs — the one permitted mention of engineDir',
  )
  assert.deepEqual(
    cmds.filter((cmd) => cmd.includes(ENGINE)),
    [],
    `(c) [M3] no command issued names the engine directory; got ${JSON.stringify(cmds)}`,
  )
  assert.deepEqual(
    spawns[0].args.slice(1).filter((arg) => String(arg).includes(ENGINE)),
    [],
    '(c) [M3] no argv entry past args[0] names the engine directory',
  )
  assert.equal(outcome.gateGreen, false, '(c) [M3] no gate receipt in the target ⇒ never green')

  // The assignment-carried plan is the "<launch plan path>" M3 names: it is
  // materialised under the TARGET and it is what the argv carries.
  const spawns2 = []
  await shim.invokeEngineRun({
    engineDir: ENGINE,
    repoDir: target,
    planPath: 'docs/plans/some-plan.md',
    runId: 'run-c2',
    plan: { text: 'PLAN TEXT\n' },
    exec: async () => ({ code: 0, stdout: '' }),
    spawnEngine: async (call) => {
      spawns2.push(call)
      return 0
    },
    startSampler: () => ({ stop: () => {} }),
    log: () => {},
  })
  const launchPlanPath = path.join(shim.RUN_ARTIFACT_DIR, 'assignment-run-c2', 'some-plan.md')
  assert.deepEqual(
    spawns2[0].args,
    shim.oneDriverArgs({
      engineDir: ENGINE,
      repoDir: target,
      planPath: launchPlanPath,
      runId: 'run-c2',
      overlap: undefined,
    }),
    '(c) [M3] with an assignment plan the argv carries the materialised launch plan path',
  )
  assert.equal(
    fs.readFileSync(path.join(target, launchPlanPath), 'utf8'),
    'PLAN TEXT\n',
    '(c) [M3] the assignment plan lands under the TARGET',
  )
  ok('(c) [M3] invokeEngineRun: checkout → spawn, cwd/argv pinned, engineDir named only at args[0]')
}

// ===========================================================================
// (c′) [M3] a failing checkout refuses, verbatim, before any spawn.
// ===========================================================================
{
  const spawns = []
  const refused = await shim.invokeEngineRun({
    engineDir: '/exam-engine-clone',
    repoDir: '/exam-target-clone',
    planPath: 'docs/plan.md',
    runId: 'run-cprime',
    exec: async () => ({ code: 1, stdout: '' }),
    spawnEngine: async (call) => {
      spawns.push(call)
      return 0
    },
    startSampler: () => ({ stop: () => {} }),
    log: () => {},
  })
  assert.deepEqual(
    refused,
    { gateGreen: false, error: 'checkout fleet-base failed' },
    "(c′) [M3] a failed checkout returns exactly { gateGreen: false, error: 'checkout fleet-base failed' }",
  )
  assert.equal(spawns.length, 0, '(c′) [M3] and spawns nothing')
  ok("(c′) [M3] a failing fleet-base checkout returns the exact refusal with zero spawns")
}

// The orchestrator half is imported here rather than at the top of the file so
// the four pure legs above are graded first: a missing constant should read as
// the missing constant, not as whatever the transport pulls in.
const { startOrchestrator, FLEET_PATH } = await import('../orchestrator.mjs')
const { mintToken } = await import('../tokens.mjs')

// ===========================================================================
// The main() harness: a real orchestrator, a real recording exec, two real
// repos. Returns the orchestrator's view of the run row plus every command
// main() actually issued.
// ===========================================================================
const runMain = async ({ runId, engineDir, repoDir, invokeRun, spawnEngine }) => {
  const tmp = tmpdir('fleet-et-main-')
  const { token, record } = mintToken({ sandboxId: shim.sandboxIdFor(runId), ttlMs: 60_000, now: Date.now() })
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
      planPath: 'docs/plan.md',
    }),
  )
  const cmds = []
  try {
    const outcome = await shim.main({
      assignmentPath,
      engineDir,
      repoDir,
      exec: async (cmd) => {
        cmds.push(cmd)
        return await sh(cmd)
      },
      ...(invokeRun ? { invokeRun } : {}),
      ...(spawnEngine ? { spawnEngine } : {}),
      readTokens: () => 4200,
    })
    return {
      outcome,
      cmds,
      run: orch.store.getRow('runs', runId),
      receipt: orch.store.getRow('receipts', `${runId}:gate`),
      events: orch.store.getTable('events'),
    }
  } finally {
    await orch.stop()
  }
}

/** The closing rule of leg (e), applied to whichever run issued the commands. */
const assertEngineNamedOnlyByTheStamp = (cmds, engineRepo, label) => {
  const engineCmds = cmds.filter((cmd) => cmd.includes(engineRepo))
  assert.equal(
    engineCmds.length,
    2,
    `${label} [M5] the engine repo may be named by the two stamp reads and by nothing else; got ${JSON.stringify(engineCmds)}`,
  )
  assert.match(engineCmds[0], /rev-parse fleet-engine/, `${label} [M4] the first engine command is rev-parse fleet-engine`)
  assert.match(
    engineCmds[1],
    /show fleet-engine:\.claude-plugin\/plugin\.json/,
    `${label} [M4] the second is the manifest read at the same ref`,
  )
}

// ===========================================================================
// (d) [M4] + (e) [M5] — main() with `invokeRun` injected: the stamp is the
//     ENGINE's, and receipts/branch resolve in the TARGET.
// ===========================================================================
{
  const engineRepo = await mkRepo('fleet-et-engine-', '7.7.7', 'fleet-engine')
  const targetRepo = await mkRepo('fleet-et-target-', '1.1.1', 'fleet-base')
  const engineSha = (await sh('git rev-parse fleet-engine', engineRepo)).stdout.trim()
  const targetSha = (await sh('git rev-parse fleet-base', targetRepo)).stdout.trim()
  assert.match(engineSha, /^[0-9a-f]{40}$/, 'fixture: the engine ref resolves to a real sha')
  assert.notEqual(engineSha, targetSha, 'fixture: the two repos must be distinguishable by sha')

  const runId = 'run-et-1'
  const { outcome, cmds, run, receipt } = await runMain({
    runId,
    engineDir: engineRepo,
    repoDir: targetRepo,
    // The leg's injected run: it writes the gate receipt into the TARGET's own
    // run directory and leaves the integration branch the engine would leave.
    invokeRun: async () => {
      writeGateReceipt(targetRepo)
      await sh(`git branch ${INTEGRATION_BRANCH}`, targetRepo)
      return { gateGreen: true }
    },
  })

  assert.equal(outcome.status, 'gate-green', '(d) the run completed so the publish path actually ran')

  // --- (d) [M4] the stamp is the engine's, read at fleet-engine -------------
  assert.equal(run.engineSha, engineSha, "(d) [M4] runs.<runId>.engineSha is the ENGINE repo's fleet-engine sha")
  assert.notEqual(run.engineSha, targetSha, '(d) [M4] and is not the target repo')
  assert.equal(run.pluginVersion, '7.7.7', "(d) [M4] pluginVersion is the ENGINE manifest's version, not 1.1.1")
  assert.ok(
    cmds.some((cmd) => cmd.includes(`git -C ${engineRepo} rev-parse fleet-engine`)),
    `(d) [M4] the stamp is read with rev-parse fleet-engine against the engine repo; got ${JSON.stringify(cmds)}`,
  )
  assert.deepEqual(
    cmds.filter((cmd) => /rev-parse fleet-base/.test(cmd)),
    [],
    '(d) [M4] and nothing rev-parses fleet-base any more',
  )

  // --- (e) [M5] the receipt is a pointer INTO THE TARGET --------------------
  assert.equal(run.branch, INTEGRATION_BRANCH, '(e) [M5] the published branch is the one detected in the target')
  assert.equal(
    receipt.path,
    `fleet-receipts/${runId}/gate-receipt.json`,
    '(e) [M5] the receipts row points at the copy committed on the integration branch',
  )
  assert.equal(receipt.verdict, 'PASS', '(e) [M5] the verdict is carried from the receipt the run wrote')
  assert.match(receipt.sha, /^[0-9a-f]{40}$/, '(e) [M5] the row carries a real sha')
  assert.equal(
    receipt.sha,
    (await sh(`git rev-parse ${INTEGRATION_BRANCH}`, targetRepo)).stdout.trim(),
    "(e) [M5] the sha is the TARGET's published branch tip",
  )
  assert.equal(
    (await sh(`git cat-file -e ${receipt.sha}:${receipt.path}`, targetRepo)).code,
    0,
    '(e) [M5] {sha, path} dereferences in the target repo',
  )
  assert.notEqual(
    (await sh(`git cat-file -e ${receipt.sha}:${receipt.path}`, engineRepo)).code,
    0,
    '(e) [M5] and names nothing in the engine repo',
  )

  const named = (needle, label) => {
    const cmd = cmds.find((c) => c.includes(needle))
    assert.ok(cmd, `(e) [M5] main() must issue a ${label} command; got ${JSON.stringify(cmds)}`)
    assert.ok(cmd.includes(`-C ${targetRepo}`), `(e) [M5] the ${label} command names the TARGET repo: ${cmd}`)
    assert.ok(!cmd.includes(engineRepo), `(e) [M5] the ${label} command never names the engine repo: ${cmd}`)
  }
  named('for-each-ref', 'integration-branch detection')
  named('add -f', 'receipts add')
  named('commit -q -m', 'receipts commit')

  assertEngineNamedOnlyByTheStamp(cmds, engineRepo, '(e)')
  ok('(d) [M4] main() stamps the engine at fleet-engine; (e) [M5] receipts, branch and every command stay in the target')
}

// ===========================================================================
// (e) [M5] continued — main() with the DEFAULT invokeRun binding (spawnEngine
//     injected), which is where the load sampler and the event promoter live.
// ===========================================================================
{
  const engineRepo = await mkRepo('fleet-et-engine2-', '7.7.7', 'fleet-engine')
  const targetRepo = await mkRepo('fleet-et-target2-', '1.1.1', 'fleet-base')
  const engineSha = (await sh('git rev-parse fleet-engine', engineRepo)).stdout.trim()

  const runId = 'run-et-2'
  const spawns = []
  const { outcome, cmds, run, events } = await runMain({
    runId,
    engineDir: engineRepo,
    repoDir: targetRepo,
    // Stands in for the engine process: it writes what a run writes, into the
    // tree it was pointed at.
    spawnEngine: async (call) => {
      spawns.push(call)
      writeGateReceipt(targetRepo)
      const runDir = path.join(targetRepo, '.claude', 'ultrapowers', `run-${runId}`)
      fs.mkdirSync(runDir, { recursive: true })
      fs.writeFileSync(
        path.join(runDir, 'events.jsonl'),
        `${JSON.stringify({ id: 'ev-target', type: 'engine:phase', phase: 'exam' })}\n`,
      )
      await sh(`git branch ${INTEGRATION_BRANCH}`, targetRepo)
      return 0
    },
  })

  assert.equal(outcome.status, 'gate-green', '(e) the default binding reached the gate receipt in the target')
  assert.equal(run.engineSha, engineSha, '(d) [M4] the stamp is the engine sha on this binding too')

  // The default binding threads both directories into invokeEngineRun.
  assert.equal(spawns.length, 1, '(e) [M3] main() spawned the engine exactly once')
  assert.equal(spawns[0].cwd, targetRepo, '(e) [M3] main() spawns with cwd = the TARGET')
  assert.deepEqual(
    spawns[0].args,
    shim.oneDriverArgs({
      engineDir: engineRepo,
      repoDir: targetRepo,
      planPath: 'docs/plan.md',
      runId,
      overlap: undefined,
    }),
    '(e) [M3] main() threads engineDir and repoDir into the launch argv',
  )

  // The sampler's file (#549) — under the target, and nowhere in the engine.
  assert.ok(
    fs.existsSync(path.join(targetRepo, '.claude', 'ultrapowers', `run-${runId}`, 'load.jsonl')),
    "(e) [M5] the load sampler writes load.jsonl under the TARGET's run directory",
  )
  assert.equal(
    fs.existsSync(path.join(engineRepo, '.claude')),
    false,
    '(e) [M5] nothing in the run writes into the engine clone',
  )

  // The promoter's file (#421): the only way to see which path it was given is
  // that the target's event reached the store.
  assert.deepEqual(
    events[`${runId}:ev-target`],
    { runId, id: 'ev-target', type: 'engine:phase', phase: 'exam' },
    `(e) [M5] the event promoter read events.jsonl under the TARGET's run directory; got ${JSON.stringify(events)}`,
  )

  assertEngineNamedOnlyByTheStamp(cmds, engineRepo, '(e)')
  ok('(e) [M5] default binding: sampler file, promoter file, spawn cwd and every command are the target')
}

for (const clean of cleanups) clean()
console.log(`\nALL TESTS PASSED (${passed})`)
