// #1294 fact 1 — does a merge into the worktree between tool batches fight
// Claude Code's edit guard, and does a stale Write erase merged lines?
// Each arm is one SDK session in a fresh temp dir; a PostToolBatch hook plays
// "the host merges a peer's weave into this file" after the first file-changing
// (or reading, for arm D) batch.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { query } from '/Users/marcusestes/Websites/ultrapowers/fleet/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs'

const MODEL = process.env.PROBE_MODEL || 'claude-sonnet-5'
const BASE = [
  "export function price(q) {",
  "  const a = 1",
  "  const b = 1",
  "  return q * a + b",
  "}",
  "",
  "export function tax(x) {",
  "  return x * 0.1",
  "}",
  "",
].join('\n')
const PEER_LINE = '  // peer C: guard against negative quantities'

function peerMerge(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n')
  const i = lines.findIndex((l) => l.startsWith('export function tax'))
  lines.splice(i + 1, 0, PEER_LINE)          // a peer's line lands inside tax()
  fs.writeFileSync(file, lines.join('\n'))
}

const ARMS = {
  A: { desc: 'merge after the first Edit batch, no notice', trigger: 'Edit', notice: false,
    prompt: 'In app.js: first use the Edit tool to change `const a = 1` to `const a = 2`. After that edit succeeds, use the Edit tool again to change `const b = 1` to `const b = 3`. Two separate Edit calls. Do not do anything else.' },
  B: { desc: 'merge after the first Edit batch, with additionalContext', trigger: 'Edit', notice: true,
    prompt: 'In app.js: first use the Edit tool to change `const a = 1` to `const a = 2`. After that edit succeeds, use the Edit tool again to change `const b = 1` to `const b = 3`. Two separate Edit calls. Do not do anything else.' },
  C: { desc: 'merge touches a different file (control)', trigger: 'Edit', notice: false, other: true,
    prompt: 'In app.js: first use the Edit tool to change `const a = 1` to `const a = 2`. After that edit succeeds, use the Edit tool again to change `const b = 1` to `const b = 3`. Two separate Edit calls. Do not do anything else.' },
  D: { desc: 'merge after Read; then a whole-file Write', trigger: 'Read', notice: false,
    prompt: 'Read app.js. Then, in a separate step, use the Write tool (not Edit) to write the complete file back with `const a = 1` changed to `const a = 2`, reproducing everything else from what you read. Do not read the file again.' },
  E: { desc: 'merge after Read with additionalContext; then a whole-file Write', trigger: 'Read', notice: true,
    prompt: 'Read app.js. Then, in a separate step, use the Write tool (not Edit) to write the complete file back with `const a = 1` changed to `const a = 2`, reproducing everything else from what you read. Do not read the file again.' },
  H: { desc: 'Read first; merge rewrites the very line the next Edit targets', trigger: 'Edit', notice: false, hit: true,
    prompt: 'Read app.js first. Then use the Edit tool to change `const a = 1` to `const a = 2`. After that edit succeeds, use the Edit tool again to change `const b = 1` to `const b = 3`. Two separate Edit calls. Do not do anything else.' },
  I: { desc: 'same as H, with a notice naming the rewritten line', trigger: 'Edit', notice: true, hit: true,
    prompt: 'Read app.js first. Then use the Edit tool to change `const a = 1` to `const a = 2`. After that edit succeeds, use the Edit tool again to change `const b = 1` to `const b = 3`. Two separate Edit calls. Do not do anything else.' },
  F: { desc: 'Read first; merge after the Read batch; then Edit', trigger: 'Read', notice: false,
    prompt: 'Read app.js first. Then use the Edit tool to change `const a = 1` to `const a = 2`. Then use the Edit tool again to change `const b = 1` to `const b = 3`. Do not do anything else.' },
  G: { desc: 'Read first; merge after the first Edit batch; then Edit', trigger: 'Edit', notice: false,
    prompt: 'Read app.js first. Then use the Edit tool to change `const a = 1` to `const a = 2`. After that edit succeeds, use the Edit tool again to change `const b = 1` to `const b = 3`. Two separate Edit calls. Do not do anything else.' },
}

async function runArm(key, rep) {
  const arm = ARMS[key]
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `guard-${key}-`))
  const file = path.join(dir, 'app.js')
  fs.writeFileSync(file, BASE)
  fs.writeFileSync(path.join(dir, 'other.js'), 'export const x = 1\n')
  let merged = false
  const calls = []
  const hooks = {
    PostToolUse: [{ hooks: [async (input) => {
      const resp = JSON.stringify(input.tool_response ?? '')
      calls.push({ tool: input.tool_name, input: JSON.stringify(input.tool_input).slice(0, 160), response: resp.slice(0, 300) })
      return {}
    }] }],
    PostToolUseFailure: [{ hooks: [async (input) => {
      calls.push({ tool: input.tool_name, failed: true, error: JSON.stringify(input.error ?? input).slice(0, 300) })
      return {}
    }] }],
    PostToolBatch: [{ hooks: [async (input) => {
      const names = (input.tool_calls || []).map((c) => c.tool_name)
      if (!merged && names.includes(arm.trigger)) {
        merged = true
        if (arm.other) fs.appendFileSync(path.join(dir, 'other.js'), 'export const y = 2\n')
        else if (arm.hit) fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('  const b = 1', '  const b = 1 + bonus(q)  // peer C'))
        else peerMerge(file)
        if (arm.notice) {
          return { hookSpecificOutput: { hookEventName: 'PostToolBatch',
            additionalContext: arm.hit ? 'The host merged a peer\'s work into app.js just now: peer C changed the line `const b = 1` to `const b = 1 + bonus(q)`. Your earlier view of app.js is out of date.' : 'The host merged a peer\'s work into app.js just now: one line was inserted inside tax(). Your earlier view of app.js is out of date.' } }
        }
      }
      return {}
    }] }],
  }
  const q = query({ prompt: arm.prompt, options: {
    cwd: dir, model: MODEL, settingSources: [], permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true, maxTurns: 12, hooks,
    allowedTools: ['Read', 'Edit', 'Write'], disallowedTools: ['Bash', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Task'],
  } })
  let result = null
  const errors = []
  for await (const m of q) {
    if (m.type === 'user' && Array.isArray(m.message?.content)) {
      for (const c of m.message.content) if (c.type === 'tool_result' && c.is_error) errors.push(String(typeof c.content === 'string' ? c.content : JSON.stringify(c.content)).slice(0, 220))
    }
    if (m.type === 'result') result = m
  }
  const final = fs.readFileSync(file, 'utf8')
  return {
    arm: key, rep, desc: arm.desc, merged,
    tools: calls.map((c) => c.tool + (c.failed ? '!' : '')).join(' '),
    reads: calls.filter((c) => c.tool === 'Read').length,
    tool_errors: errors,
    turns: result?.num_turns, in_tokens: result?.usage?.input_tokens, cache_read: result?.usage?.cache_read_input_tokens, out_tokens: result?.usage?.output_tokens,
    peer_line_kept: arm.hit ? final.includes('bonus(q)') : (final.includes(PEER_LINE) || !!arm.other), final_b: (final.match(/const b = .*/)||[''])[0],
    a2: final.includes('const a = 2'), b3: final.includes('const b = 3'),
    subtype: result?.subtype, said: String(result?.result||'').slice(0,160),
  }
}

const which = (process.argv[2] || 'ABCDE').split('')
const reps = Number(process.argv[3] || 1)
for (let r = 1; r <= reps; r++) for (const k of which) {
  try { console.log(JSON.stringify(await runArm(k, r))) } catch (e) { console.log(JSON.stringify({ arm: k, rep: r, crash: String(e).slice(0, 300) })) }
}
