// fleet/tests/test_shim_main_tokens.mjs — the run's token cost comes from the
// engine SESSION TRANSCRIPTS (the only place output-token counts exist), not
// report.json (which carries none). Two things are proven here:
//
//   1. readSessionTokens sums `output_tokens` across the run's main transcript
//      AND its subagent transcripts, keyed by a run-unique session id — so the
//      subagent spend (the majority) is counted and cloned golden warm-up
//      sessions (a different id, same project dir) are NOT.
//   2. engineArgs threads that session id to `--session-id` so the transcript
//      path is deterministic, while the bare one-arg form is unchanged.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { startOrchestrator, FLEET_PATH } from '../orchestrator.mjs'
import { mintToken } from '../tokens.mjs'
import {
  readSessionTokens,
  readSessionTokenSources,
  engineArgs,
  main as shimMain,
  sandboxIdFor,
  STANDING_DIRECTIVE,
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

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-tok-'))
const projects = path.join(home, '.claude', 'projects')
const proj = path.join(projects, '-home-exedev-repo')
const RUN = '00000000-0000-4000-8000-0000000000aa'
const WARMUP = '11111111-1111-4111-8111-111111111111'

// --- 1. before anything is written → null (observational distinction) -------
assert.equal(readSessionTokens(RUN, { home }), null)
ok('no transcript yet → null')

// --- 2. main transcript only -----------------------------------------------
writeTranscript(path.join(proj, `${RUN}.jsonl`), [100, 250, 50]) // 400
assert.equal(readSessionTokens(RUN, { home }), 400)
ok('main transcript output_tokens summed (400)')

// --- 3. subagent transcripts added ------------------------------------------
const wf = path.join(proj, RUN, 'subagents', 'workflows', 'wf_abc-1')
writeTranscript(path.join(wf, 'agent-a1.jsonl'), [1000, 500]) // 1500
writeTranscript(path.join(wf, 'agent-a2.jsonl'), [700])       //  700
// a .meta.json sibling must be ignored, not summed
fs.writeFileSync(path.join(wf, 'agent-a1.meta.json'), JSON.stringify({ note: 'not a transcript' }))
assert.equal(readSessionTokens(RUN, { home }), 400 + 1500 + 700)
ok('subagent transcripts included; .meta.json ignored (2600)')

// --- 4. a warm-up session in the SAME project dir is NOT counted -------------
writeTranscript(path.join(proj, `${WARMUP}.jsonl`), [9999])
assert.equal(readSessionTokens(RUN, { home }), 2600, 'warm-up session must not leak into the run total')
ok('cloned warm-up session ignored (still 2600)')

// --- 5. engineArgs threads the session id; bare form unchanged --------------
assert.deepEqual(engineArgs('docs/plan.md'), ['-p', `/ultrapowers docs/plan.md\n\n${STANDING_DIRECTIVE}`])
ok('engineArgs bare form carries the #280 standing directive')
assert.deepEqual(
  engineArgs('docs/plan.md', RUN),
  ['-p', `/ultrapowers docs/plan.md\n\n${STANDING_DIRECTIVE}`, '--session-id', RUN],
)
ok('engineArgs appends --session-id when given')
assert.deepEqual(engineArgs('docs/plan.md', ''), ['-p', `/ultrapowers docs/plan.md\n\n${STANDING_DIRECTIVE}`])
ok('engineArgs ignores an empty session id')

// --- #209: source-shape probe ------------------------------------------------
// `readSessionTokens` couples to the engine transcript format on two axes (the
// per-message usage shape and the on-disk layout). A drift in either reads
// FEWER tokens and never errors — a silent undercount under a spend hard-cap.
// The probe reports the SHAPE of what was read so the two shapes run-7 says
// cannot happen on a real engine run are visible rather than invisible.
const S1 = '22222222-2222-4222-8222-222222222222'
assert.deepEqual(readSessionTokenSources(S1, { home }), { total: null, mainFound: false, subagentFiles: 0 })
ok('sources: nothing on disk → total null (observational distinction kept)')

writeTranscript(path.join(proj, `${S1}.jsonl`), [100])
assert.deepEqual(readSessionTokenSources(S1, { home }), { total: 100, mainFound: true, subagentFiles: 0 })
ok('sources: main only → mainFound true, zero subagent files (the suspicious shape)')

const wf1 = path.join(proj, S1, 'subagents', 'workflows', 'wf_x-1')
writeTranscript(path.join(wf1, 'agent-b1.jsonl'), [50, 25])
assert.deepEqual(readSessionTokenSources(S1, { home }), { total: 175, mainFound: true, subagentFiles: 1 })
ok('sources: subagent files counted')

// readSessionTokens is unchanged: same totals as the sources probe
assert.equal(readSessionTokens(S1, { home }), 175)
ok('readSessionTokens delegates — no behavior change')

// The other suspicious shape: subagent transcripts with NO main transcript.
const S2 = '33333333-3333-4333-8333-333333333333'
writeTranscript(path.join(proj, S2, 'subagents', 'workflows', 'wf_y-1', 'agent-c1.jsonl'), [7])
assert.deepEqual(readSessionTokenSources(S2, { home }), { total: 7, mainFound: false, subagentFiles: 1 })
ok('sources: subagents without a main transcript → mainFound false')

// An empty session id never reaches the disk at all.
assert.deepEqual(readSessionTokenSources('', { home }), { total: null, mainFound: false, subagentFiles: 0 })
ok('sources: empty session id → the null triple')

fs.rmSync(home, { recursive: true, force: true })

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
  orch.store.setRow('budgets', runId, { capTokens: 1_000_000 })
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
