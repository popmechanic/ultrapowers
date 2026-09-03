// fleet/tests/test_shim_main_gate.mjs — a self-approved NEEDS_ACK (#281 standing
// directive) must green the fleet shim, but only on THREE legs of evidence read
// from the same run directory as the machine-written gate receipt:
//
//   1. standing-approval.json  — the session declared its intent to self-approve
//      BEFORE running the approve, quoting the standing directive.
//   2. every ack in the receipt is inside the granted class
//      (deferred:runtime / deferred:external) — anything else parks.
//   3. approve-receipt.json    — the approve actually RAN (mode: 'approve',
//      matching stamp).
//   The engine itself is spawned with ULTRAPOWERS_FLEET_RUN=<runId> (Phase 0 §mechanism) — pinned here too.
//
// A bare PASS still greens unconditionally; a bare NEEDS_ACK (no sidecars) never
// greens vacuously — every leg is fail-closed.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  readGateGreen,
  GRANTED_ACK_TYPES,
  runArtifactDirs,
  findReceiptFiles,
  findGateReceiptFile,
  findRunReportFile,
  spawnEngineProcess,
  invokeEngineRun,
  oneDriverArgs,
  readRunConfigTokens,
} from '../shim-main.mjs'

let passed = 0
const ok = (label) => {
  passed += 1
  console.log(`ok - ${label}`)
}

const stamp = '20260826-120000'
const mkRun = (t, { verdict, acks = [], standing = null, approve = null }) => {
  const runDir = path.join(t, '.claude', 'ultrapowers', `run-${stamp}`)
  fs.mkdirSync(runDir, { recursive: true })
  const receiptFile = path.join(runDir, 'gate-receipt.json')
  fs.writeFileSync(receiptFile, JSON.stringify({ mode: 'gate', stamp, verdict, gateCheck: { verdict, acks } }))
  if (standing) fs.writeFileSync(path.join(runDir, 'standing-approval.json'), JSON.stringify(standing))
  if (approve) fs.writeFileSync(path.join(runDir, 'approve-receipt.json'), JSON.stringify(approve))
  return receiptFile
}
const EXT = { type: 'deferred:external', detail: 'live shape unverified' }
const RUN = { type: 'deferred:runtime', detail: 'timing-dependent' }
const STANDING = { grantedAt: 'launch directive', instruction: 'x', ackList: [] }
const APPROVE = { mode: 'approve', stamp, branch: 'ultra/integration-x', swept: {} }

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-gate-'))

// --- 1. bare PASS greens unconditionally ------------------------------------
{
  const t1 = tmp()
  assert.equal(readGateGreen(mkRun(t1, { verdict: 'PASS' })), true)
  ok('bare PASS greens')
}

// --- 2. bare BLOCKED never greens --------------------------------------------
{
  const t2 = tmp()
  assert.equal(readGateGreen(mkRun(t2, { verdict: 'BLOCKED' })), false)
  ok('BLOCKED never greens')
}

// --- 3. bare NEEDS_ACK (no sidecars at all) never greens ---------------------
{
  const t3 = tmp()
  assert.equal(readGateGreen(mkRun(t3, { verdict: 'NEEDS_ACK', acks: [EXT] })), false)
  ok('bare NEEDS_ACK never greens')
}

// --- 4. all three legs present → green ---------------------------------------
{
  const t4 = tmp()
  assert.equal(
    readGateGreen(mkRun(t4, { verdict: 'NEEDS_ACK', acks: [EXT, RUN], standing: STANDING, approve: APPROVE })),
    true,
  )
  ok('all three legs present greens')
}

// --- 5. no standing sidecar → parks -------------------------------------------
{
  const t5 = tmp()
  assert.equal(readGateGreen(mkRun(t5, { verdict: 'NEEDS_ACK', acks: [EXT], approve: APPROVE })), false)
  ok('missing standing-approval.json parks')
}

// --- 6. an ack outside the granted class → parks ------------------------------
{
  const t6 = tmp()
  assert.equal(
    readGateGreen(
      mkRun(t6, {
        verdict: 'NEEDS_ACK',
        acks: [EXT, { type: 'deferred:manual', detail: 'operator step' }],
        standing: STANDING,
        approve: APPROVE,
      }),
    ),
    false,
  )
  ok('manual ack outside the grant parks')
}

// --- 7. an unrelated ack type → parks -----------------------------------------
{
  const t7 = tmp()
  assert.equal(
    readGateGreen(
      mkRun(t7, {
        verdict: 'NEEDS_ACK',
        acks: [{ type: 'coverage', detail: 'incomplete' }],
        standing: STANDING,
        approve: APPROVE,
      }),
    ),
    false,
  )
  ok('coverage ack parks')
}

// --- 8. empty acks array never greens vacuously -------------------------------
{
  const t8 = tmp()
  assert.equal(
    readGateGreen(mkRun(t8, { verdict: 'NEEDS_ACK', acks: [], standing: STANDING, approve: APPROVE })),
    false,
  )
  ok('empty acks never green vacuously')
}

// --- 9. approve receipt missing → parks ---------------------------------------
{
  const t9 = tmp()
  assert.equal(readGateGreen(mkRun(t9, { verdict: 'NEEDS_ACK', acks: [EXT], standing: STANDING })), false)
  ok('missing approve-receipt.json parks')
}

// --- 10. approve receipt wrong mode → parks -----------------------------------
{
  const t10 = tmp()
  assert.equal(
    readGateGreen(
      mkRun(t10, {
        verdict: 'NEEDS_ACK',
        acks: [EXT],
        standing: STANDING,
        approve: { ...APPROVE, mode: 'teardown' },
      }),
    ),
    false,
  )
  ok('approve receipt with wrong mode parks')
}

// --- 11. approve receipt stamp mismatch → parks -------------------------------
{
  const t11 = tmp()
  assert.equal(
    readGateGreen(
      mkRun(t11, {
        verdict: 'NEEDS_ACK',
        acks: [EXT],
        standing: STANDING,
        approve: { ...APPROVE, stamp: '19990101-000000' },
      }),
    ),
    false,
  )
  ok('approve receipt stamp mismatch parks')
}

// --- 12. the engine spawns with ULTRAPOWERS_FLEET_RUN=<runId> (Phase 0 §mechanism) --
{
  const t12 = tmp()
  delete process.env.ULTRAPOWERS_FLEET_RUN
  // (a) the real spawn seam sets the variable from runId — the child reads it back itself
  assert.equal(
    await spawnEngineProcess({ command: '/bin/sh', args: ['-c', 'test "$ULTRAPOWERS_FLEET_RUN" = "run-77"'], cwd: t12, runId: 'run-77' }),
    0,
  )
  // (b) the inherited env still rides beside it (the credential lives there, #213)
  process.env.FLEET_GATE_TEST_CANARY = 'canary'
  assert.equal(
    await spawnEngineProcess({ command: '/bin/sh', args: ['-c', 'test "$FLEET_GATE_TEST_CANARY" = canary -a "$ULTRAPOWERS_FLEET_RUN" = run-77'], cwd: t12, runId: 'run-77' }),
    0,
  )
  delete process.env.FLEET_GATE_TEST_CANARY
  // (c) invokeEngineRun threads the assignment's runId to the spawn seam
  const seen = []
  const outcome = await invokeEngineRun({
    engineDir: '/engine',
    repoDir: t12,
    planPath: 'docs/plan.md',
    runId: 'run-77',
    exec: async () => ({ code: 0, stdout: '' }),
    spawnEngine: async ({ runId }) => {
      seen.push(runId)
      return 1
    },
    log: () => {},
  })
  assert.deepEqual(seen, ['run-77'])
  assert.equal(outcome.gateGreen, false)
  // (d) no runId → refused before any checkout or spawn (fail-closed, like a missing planPath)
  const calls = []
  const refused = await invokeEngineRun({
    engineDir: '/engine',
    repoDir: t12,
    planPath: 'docs/plan.md',
    exec: async (cmd) => {
      calls.push(cmd)
      return { code: 0, stdout: '' }
    },
    spawnEngine: async () => {
      calls.push('spawn')
      return 0
    },
    log: () => {},
  })
  assert.deepEqual(refused, { gateGreen: false, error: 'missing runId' })
  assert.deepEqual(calls, [])
  ok('engine spawns with ULTRAPOWERS_FLEET_RUN=<runId>; a missing runId refuses before checkout')
}

// --- 13. missing/unreadable receipt → parks -----------------------------------
{
  const t14 = tmp()
  assert.equal(readGateGreen(path.join(t14, 'nope.json')), false)
  ok('missing/unreadable receipt parks')
}

// --- 14. the directive must instruct saving the approve receipt --------------
// (STANDING_DIRECTIVE pin deleted at 0.3.0 — the two-move rule is run-main's ackDecision, code not prose.)

// --- 15. GRANTED_ACK_TYPES is exactly the #281 granted class ------------------
assert.deepEqual([...GRANTED_ACK_TYPES].sort(), ['deferred:external', 'deferred:runtime'])
ok('GRANTED_ACK_TYPES is exactly {deferred:runtime, deferred:external}')

// --- #190: discovery scoping + newest-wins ---------------------------------
{
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-scope-'))
  const dir = (name) => path.join(repo, '.claude/ultrapowers', name)
  const receipt = (name, verdict) => {
    fs.mkdirSync(dir(name), { recursive: true })
    fs.writeFileSync(path.join(dir(name), 'gate-receipt.json'), JSON.stringify({ verdict, stamp: name }))
  }
  receipt('run-20260101000000', 'PASS')   // the stale pre-run leftover
  receipt('run-20260901000000', 'PASS')   // the run's own
  receipt('run-20260902000000', 'PASS')   // an even newer one

  // newest-wins: the LAST run dir by name sort is the one discovered
  assert.equal(
    findGateReceiptFile(repo),
    path.join(repo, '.claude/ultrapowers/run-20260902000000/gate-receipt.json'),
  )

  // excludeDirs scoping: pre-run dirs are invisible to every discovery reader
  const pre = new Set(['run-20260101000000', 'run-20260901000000', 'run-20260902000000'])
  assert.equal(findGateReceiptFile(repo, undefined, { excludeDirs: pre }), '')
  assert.deepEqual(findReceiptFiles(repo, undefined, { excludeDirs: pre }), [])
  assert.deepEqual(runArtifactDirs(repo, undefined, { excludeDirs: pre }), [])
  assert.equal(findRunReportFile(repo, undefined, { excludeDirs: pre }), '')

  const preOnly = new Set(['run-20260101000000'])
  assert.deepEqual(runArtifactDirs(repo, undefined, { excludeDirs: preOnly }), [
    'run-20260901000000',
    'run-20260902000000',
  ])
  assert.equal(
    findGateReceiptFile(repo, undefined, { excludeDirs: preOnly }),
    path.join(repo, '.claude/ultrapowers/run-20260902000000/gate-receipt.json'),
  )
  fs.rmSync(repo, { recursive: true, force: true })
  ok('discovery scoping excludes pre-run dirs; newest-wins pinned (#190)')
}


// --- 16. the one-driver engine mode (#402) -----------------------------------
{
  const t16 = tmp()
  // (a) the launch argv is pinned, like engineArgs: the driver module from the
  // ENGINE clone, then plan and runId, then `--repo <target>` — no directive
  // rides it (ackDecision is code).
  assert.deepEqual(
    oneDriverArgs({ engineDir: '/engine', repoDir: '/repo', planPath: 'docs/plan.md', runId: 'run-24' }),
    ['/engine/fleet/run-main.mjs', 'docs/plan.md', 'run-24', '--repo', '/repo'],
  )
  // (b) engine: 'one-driver' spawns node with that argv from the ENGINE clone
  // and SKIPS the plugin install (the clone IS the engine on this path).
  const cmds = []
  const spawns = []
  const outcome = await invokeEngineRun({
    engineDir: '/engine',
    repoDir: t16,
    planPath: 'docs/plan.md',
    runId: 'run-24',
    exec: async (cmd) => { cmds.push(cmd); return { code: 0, stdout: '' } },
    spawnEngine: async (call) => { spawns.push(call); return 1 },
    log: () => {},
  })
  assert.equal(spawns.length, 1)
  assert.equal(spawns[0].command, 'node')
  assert.deepEqual(
    spawns[0].args,
    oneDriverArgs({ engineDir: '/engine', repoDir: t16, planPath: 'docs/plan.md', runId: 'run-24' }),
  )
  assert.equal(spawns[0].cwd, t16)
  assert.equal(spawns[0].runId, 'run-24')
  assert.ok(!cmds.some((c) => /plugin/.test(c)), 'no plugin install on the one-driver path')
  assert.ok(cmds.some((c) => /checkout -q fleet-base/.test(c)), 'the BASE_REF checkout still happens first')
  assert.equal(outcome.gateGreen, false, 'a non-zero driver exit is never green')
  // ((c) the claude-path fallback died at 0.3.0 — one engine, no mode key.)
  ok('one-driver mode: pinned argv, no plugin install, checkout kept')
}

// --- 17. readRunConfigTokens sums every transcript under the run config dir --
{
  const t17 = tmp()
  const configDir = path.join(t17, 'claude')
  assert.deepEqual(readRunConfigTokens(configDir), { total: null, files: 0 },
    'absent dir reads null, not 0 — the §W1d number|null shape survives')
  const proj = path.join(configDir, 'projects', '-repo-x')
  fs.mkdirSync(proj, { recursive: true })
  const line = (n) => JSON.stringify({ message: { usage: { output_tokens: n } } }) + '\n'
  fs.writeFileSync(path.join(proj, 'aaaa.jsonl'), line(10) + line(5))
  const nested = path.join(proj, 'aaaa', 'subagents')
  fs.mkdirSync(nested, { recursive: true })
  fs.writeFileSync(path.join(nested, 'agent-1.jsonl'), line(7))
  assert.deepEqual(readRunConfigTokens(configDir), { total: 22, files: 2 })
  ok('readRunConfigTokens: recursive sum keyed by the run-owned dir, null when empty')
}

// --- 18. one message, many records: counted once (2026-09-01, run-47) --------
// Claude Code writes one transcript record per streamed content block, each
// carrying the same `message.id` and the whole message's `usage`. Summing every
// record read run-47 at 582,547 output tokens against 239,564 of actual
// generation (the workers' own envelopes). Keyed by message id, last value
// wins; records with no id still count once each.
{
  const t18 = tmp()
  const configDir = path.join(t18, 'claude')
  const proj = path.join(configDir, 'projects', '-repo-y')
  fs.mkdirSync(proj, { recursive: true })
  const rec = (id, n, extra = {}) =>
    JSON.stringify({ type: 'assistant', message: { id, usage: { output_tokens: n } }, ...extra }) + '\n'
  fs.writeFileSync(path.join(proj, 'bbbb.jsonl'),
    rec('msg_1', 100) +            // text block
    rec('msg_1', 100) +            // tool_use block, same message, same usage
    rec('msg_1', 100) +            // a second tool_use block
    rec('msg_2', 40) +
    JSON.stringify({ message: { usage: { output_tokens: 3 } } }) + '\n' +   // no id: counts once
    JSON.stringify({ message: { usage: { output_tokens: 3 } } }) + '\n' +   // no id: counts again
    JSON.stringify({ type: 'user', message: { role: 'user' } }) + '\n')     // no usage: ignored
  assert.deepEqual(readRunConfigTokens(configDir), { total: 146, files: 1 },
    'three records of msg_1 count 100 once; id-less records count each; 100+40+3+3')
  ok('readRunConfigTokens: per-block records of one message are counted once (run-47 2.4x overcount)')
}

console.log(`\nALL TESTS PASSED (${passed})`)
