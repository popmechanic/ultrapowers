// fleet/tests/test_shim_main_tokens.mjs — the run's token cost comes from the
// engine SESSION TRANSCRIPTS (the only place output-token counts exist), not
// report.json (which carries none). Two things are proven here:
//
//   1. readSessionTokens sums `output_tokens` across the run's main transcript
//      AND its subagent transcripts, keyed by a run-unique session id — so the
//      subagent spend (the majority) is counted and cloned golden warm-up
//      sessions (a different id, same project dir) are NOT.
//      path is deterministic, while the bare one-arg form is unchanged.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { startOrchestrator, FLEET_PATH } from '../orchestrator.mjs'
import { mintToken } from '../tokens.mjs'
import {
  main as shimMain,
  sandboxIdFor,
} from '../shim-main.mjs'

let passed = 0
const ok = (label) => {
  passed += 1
  console.log(`ok - ${label}`)
}

// A minimal transcript line in the shape Claude Code writes: an assistant
// message whose `message.usage.output_tokens` is the per-message generation.
const line = (out, extra = {}) =>
  JSON.stringify({ type: 'assistant', message: { usage: { output_tokens: out, input_tokens: 1 } }, ...extra })

const writeTranscript = (file, outs) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, outs.map((o) => line(o)).join('\n') + '\n')
}

// (Sections 1–2 — the session-transcript readers readSessionTokens /
// readSessionTokenSources — died at 0.3.0 with the claude engine session that
// wrote those transcripts. The driver's reader is readRunConfigTokens, pinned
// in test_shim_main_gate.mjs scenario 17.)

// --- #209: the main()-level sentinel cell ------------------------------------
// A live orchestrator + a real main(), with the token seams injected so no
// engine has to write a transcript into the user's home. The sentinel cell is
// read off the ORCHESTRATOR's store, i.e. after the aux publish synced.
const runMainWithSources = async ({ runId, readTokensSources }) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-sentinel-'))
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
    JSON.stringify({ runId, token, wsUrl: `ws://127.0.0.1:${orch.port}/${FLEET_PATH}`, ttlMs: 60_000 }),
  )
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-sentinel-repo-'))
  try {
    const outcome = await shimMain({
      assignmentPath,
      repoDir,
      exec: async () => ({ code: 1, stdout: '' }),
      invokeRun: async () => ({ gateGreen: true }),
      readTokens: () => 4200,
      readTokensSources,
    })
    return { outcome, sentinel: orch.store.getCell('runs', runId, 'spendSentinel') }
  } finally {
    await orch.stop()
    fs.rmSync(tmp, { recursive: true, force: true })
    fs.rmSync(repoDir, { recursive: true, force: true })
  }
}

{
  const { outcome, sentinel } = await runMainWithSources({
    runId: 'run-sentinel-suspicious',
    readTokensSources: () => ({ total: 4200, mainFound: true, subagentFiles: 0 }),
  })
  assert.deepEqual(outcome, { status: 'gate-green', delivered: true })
  assert.match(sentinel, /spend-source sentinel/)
  assert.match(sentinel, /mainFound=true subagentFiles=0/)
  ok('main(): zero subagent transcripts publishes the spendSentinel cell')
}

{
  const { outcome, sentinel } = await runMainWithSources({
    runId: 'run-sentinel-healthy',
    readTokensSources: () => ({ total: 4200, mainFound: true, subagentFiles: 3 }),
  })
  assert.deepEqual(outcome, { status: 'gate-green', delivered: true })
  assert.equal(sentinel, undefined)
  ok('main(): a healthy shape writes no sentinel cell')
}

console.log(`\nALL TESTS PASSED (${passed})`)
