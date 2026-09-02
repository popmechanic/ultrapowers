// fleet/tests/test_shim_main_envelope_tokens.mjs — the run row's token figure
// is the one the WORKERS' OWN ENVELOPES report; the transcript sum is used
// only when no envelope exists.
//
// The live equality this stands in for is run-47 (2026-09-01, the ledger dedup
// `1f17c57`): the same run read 239,564 output tokens from the transcripts
// (deduped by `message.id`) and 239,695 from the workers' envelopes — the two
// readings agree to within 0.06%, and the envelope figure is the primary one
// because it is what the engine itself metered (`meterOf`, run-worker.mjs)
// rather than what a transcript layout happens to expose.
//
// The reader sums `modelUsage[*].outputTokens` over every
// `<runDir>/workers/<label>/envelope.json` — NEVER the envelope's `usage`,
// which reports the last call only.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { startOrchestrator, FLEET_PATH } from '../orchestrator.mjs'
import { mintToken } from '../tokens.mjs'
import {
  main as shimMain,
  readRunEnvelopeTokens,
  sandboxIdFor,
  RUN_ARTIFACT_DIR,
} from '../shim-main.mjs'

let passed = 0
const ok = (label) => {
  passed += 1
  console.log(`ok - ${label}`)
}

const tmps = []
const tmp = (tag = 'fleet-envtok-') => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), tag))
  tmps.push(d)
  return d
}

/** Write `<runDir>/workers/<label>/envelope.json` with the given body. */
const writeEnvelope = (runDir, label, body) => {
  const dir = path.join(runDir, 'workers', label)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, 'envelope.json'),
    typeof body === 'string' ? body : JSON.stringify(body, null, 2),
  )
}

/** A transcript line in the shape Claude Code writes under the run config dir. */
const writeTranscript = (configDir, name, outs) => {
  const proj = path.join(configDir, 'projects', '-repo-x')
  fs.mkdirSync(proj, { recursive: true })
  fs.writeFileSync(
    path.join(proj, name),
    outs
      .map((o, i) =>
        JSON.stringify({ type: 'assistant', message: { id: `msg_${i}`, usage: { output_tokens: o } } }))
      .join('\n') + '\n',
  )
}

// --- (a) three envelopes, two models each: every model's outputTokens counts -
{
  const runDir = tmp()
  writeEnvelope(runDir, 'impl-1', {
    modelUsage: {
      'claude-opus-5': { outputTokens: 100, inputTokens: 9 },
      'claude-haiku-4-5': { outputTokens: 20, inputTokens: 3 },
    },
  })
  writeEnvelope(runDir, 'impl-2', {
    modelUsage: {
      'claude-opus-5': { outputTokens: 7, cacheReadInputTokens: 11 },
      'claude-sonnet-5': { outputTokens: 300 },
    },
  })
  writeEnvelope(runDir, 'critic', {
    modelUsage: {
      'claude-opus-5': { outputTokens: 1 },
      'claude-haiku-4-5': { outputTokens: 2 },
    },
  })
  assert.deepEqual(readRunEnvelopeTokens(runDir), { total: 430, files: 3 })
  ok('readRunEnvelopeTokens: sums outputTokens over every model of every envelope')
}

// --- (b) unusable envelopes count as files and add 0; `usage` is ignored -----
{
  const runDir = tmp()
  writeEnvelope(runDir, 'good', { modelUsage: { 'claude-opus-5': { outputTokens: 50 } } })
  writeEnvelope(runDir, 'no-model-usage', { type: 'result', subtype: 'success' })
  writeEnvelope(runDir, 'not-json', 'this is not JSON {')
  writeEnvelope(runDir, 'usage-only', { usage: { output_tokens: 99_999 } })
  assert.deepEqual(readRunEnvelopeTokens(runDir), { total: 50, files: 4 },
    'four envelope files; only the modelUsage one contributes — `usage` is the last call only')
  ok('readRunEnvelopeTokens: modelUsage-less, unparseable and usage-only envelopes add 0 but count')
}

// --- (c) no envelopes at all reads null, never 0 -----------------------------
{
  const absent = tmp()
  assert.deepEqual(readRunEnvelopeTokens(absent), { total: null, files: 0 },
    'no workers/ dir: the number|null shape survives')

  const empty = tmp()
  fs.mkdirSync(path.join(empty, 'workers'), { recursive: true })
  assert.deepEqual(readRunEnvelopeTokens(empty), { total: null, files: 0 },
    'an empty workers/ dir is not a zero-token run')

  const noEnvelope = tmp()
  const dir = path.join(noEnvelope, 'workers', 'impl-1')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'stdout'), 'no envelope here')
  assert.deepEqual(readRunEnvelopeTokens(noEnvelope), { total: null, files: 0 },
    'a worker dir with no envelope.json is not an envelope')
  ok('readRunEnvelopeTokens: empty or absent workers/ gives { total: null, files: 0 }')
}

// --- main(): the default reader prefers the envelopes ------------------------
// A live orchestrator + a real main() with NO `readTokens` override, so the
// default reader built at the `oneDriverConfigDir` seam is the thing under
// test. The stub `invokeRun` writes what a real engine would have written.
const runMainWithArtifacts = async ({ runId, write }) => {
  const t = tmp('fleet-envtok-main-')
  const now = Date.now()
  const { token, record } = mintToken({ sandboxId: sandboxIdFor(runId), ttlMs: 60_000, now })
  const orch = await startOrchestrator({
    port: 0,
    dbDir: path.join(t, 'db'),
    tokenRecords: [record],
    actions: { page: () => {}, revokeAndPark: () => {}, destroySandbox: () => {} },
  })
  orch.store.setRow('runs', runId, { planPath: 'p.md', sandboxId: '', status: 'pending', branch: 'fleet-run' })
  const assignmentPath = path.join(t, 'fleet-run.json')
  fs.writeFileSync(
    assignmentPath,
    JSON.stringify({ runId, token, wsUrl: `ws://127.0.0.1:${orch.port}/${FLEET_PATH}`, ttlMs: 60_000 }),
  )
  const repoDir = tmp('fleet-envtok-repo-')
  const runDir = path.join(repoDir, RUN_ARTIFACT_DIR, `run-${runId}`)
  try {
    const outcome = await shimMain({
      assignmentPath,
      repoDir,
      exec: async () => ({ code: 1, stdout: '' }),
      invokeRun: async () => {
        write(runDir)
        return { gateGreen: true }
      },
    })
    return { outcome, reported: orch.store.getCell('runs', runId, 'reportedTokens') }
  } finally {
    await orch.stop()
  }
}

// --- (d) envelopes 1,000 and transcripts 900: the row reads 1,000 ------------
{
  const { outcome, reported } = await runMainWithArtifacts({
    runId: 'run-envtok-both',
    write: (runDir) => {
      writeEnvelope(runDir, 'impl-1', {
        modelUsage: { 'claude-opus-5': { outputTokens: 600 }, 'claude-haiku-4-5': { outputTokens: 150 } },
      })
      writeEnvelope(runDir, 'critic', { modelUsage: { 'claude-opus-5': { outputTokens: 250 } } })
      writeTranscript(path.join(runDir, 'claude'), 'aaaa.jsonl', [500, 400])
    },
  })
  assert.deepEqual(outcome, { status: 'gate-green', delivered: true })
  assert.equal(reported, 1000, 'the envelope sum wins over the 900 the transcripts report')
  ok('main(): reportedTokens is the envelope sum whenever an envelope exists')
}

// --- (e) no envelopes: the transcript sum is the fallback --------------------
{
  const { outcome, reported } = await runMainWithArtifacts({
    runId: 'run-envtok-transcripts',
    write: (runDir) => {
      writeTranscript(path.join(runDir, 'claude'), 'aaaa.jsonl', [500, 400])
    },
  })
  assert.deepEqual(outcome, { status: 'gate-green', delivered: true })
  assert.equal(reported, 900, 'with no envelope the run-owned transcripts are the reading')
  ok('main(): reportedTokens falls back to the transcript sum when no envelope exists')
}

for (const d of tmps) fs.rmSync(d, { recursive: true, force: true })

console.log(`\nALL TESTS PASSED (${passed})`)
