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
import { readSessionTokens, engineArgs } from '../shim-main.mjs'

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
assert.deepEqual(engineArgs('docs/plan.md'), ['-p', '/ultrapowers docs/plan.md'])
ok('engineArgs bare form unchanged')
assert.deepEqual(
  engineArgs('docs/plan.md', RUN),
  ['-p', '/ultrapowers docs/plan.md', '--session-id', RUN],
)
ok('engineArgs appends --session-id when given')
assert.deepEqual(engineArgs('docs/plan.md', ''), ['-p', '/ultrapowers docs/plan.md'])
ok('engineArgs ignores an empty session id')

fs.rmSync(home, { recursive: true, force: true })
console.log(`\nALL TESTS PASSED (${passed})`)
