// fleet/tests/probe_run_worker_live.mjs — the LIVE half of #401 step 1.
//
// NOT named test_*.mjs on purpose: tests/test_fleet_suite.py globs test_*.mjs
// and CI has no credentials. This one spends real tokens against a real
// `claude -p` and is run by hand:
//
//     node fleet/tests/probe_run_worker_live.mjs
//
// WHY IT EXISTS. Two claims, two tests. test_run_worker.mjs proves the module
// against a FAKE claude, and tests/sim_*.mjs prove waves.js's loop against a
// STUBBED agent(). Neither one touches the real CLI, so between them they could
// both be green while runWorker does not in fact behave like agent(). This is
// the only test that closes that gap, and it is why the port is split in two
// steps rather than one.
//
// It runs three arms against the real binary, all on haiku, all trivial:
//
//   A  a conforming reply           -> the parsed structured object
//   B  --max-turns 1 with a schema  -> exit 1, error_max_turns, retry class
//   C  a per-run CLAUDE_CONFIG_DIR  -> the --bare substitute holds end to end
//
// The overload arm (429/503/529 -> null) is ABSENT and cannot be added: a real
// 529 cannot be forced without external load. test_run_worker.mjs covers the
// mechanism against the fake; this file does not pretend to cover it live.

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRunWorker } from '../run-worker.mjs'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runworker-live-'))
const clone = path.join(root, 'clones', 'task-T1')
fs.mkdirSync(clone, { recursive: true })
fs.writeFileSync(path.join(clone, 'README.md'), 'PROBE_WORD=marmalade\n')
execFileSync('git', ['init', '-q'], { cwd: clone })

// A per-run CLAUDE_CONFIG_DIR is the point of arm C, and it also removes the
// shared-config hazard the parity work found on the orchestrator: a shared
// ~/.claude carries a user CLAUDE.md every worker would inherit (R-o6b).
//
// BUT IT IS NOT FREE, and this cost was found live 2026-08-28 (R-p2): a fresh
// CLAUDE_CONFIG_DIR LOSES THE CREDENTIAL unless the credential is in the
// environment. On the orchestrator that is fine and is how R-o6b/R-o11c passed
// — auth there is CLAUDE_CODE_OAUTH_TOKEN, which no config dir owns. On this
// laptop it is not: auth is bound to the config dir, so a fresh one returns
// exit 1 `Not logged in · Please run /login` (isolated to the config dir alone,
// with no other flag involved).
//
// So the per-run config dir the design depends on IMPLIES the worker env
// carries CLAUDE_CODE_OAUTH_TOKEN. That holds where workers actually run, and
// the laptop is a thin client (Amendment 1). Locally, arm C is SKIPPED rather
// than faked, and arms A and B run against the ambient config dir.
const hasEnvToken = !!process.env.CLAUDE_CODE_OAUTH_TOKEN
const configDir = hasEnvToken ? path.join(root, 'claude') : null
if (configDir) fs.mkdirSync(configDir, { recursive: true })

const SCHEMA = {
  type: 'object',
  properties: { word: { type: 'string' }, cwdBasename: { type: 'string' } },
  required: ['word', 'cwdBasename'],
  additionalProperties: false,
}

const events = []
const mk = (over = {}) => createRunWorker({
  runId: 'probe-' + Date.now(),
  workersDir: path.join(root, 'workers'),
  cwdFor: () => clone,
  env: {
    ...process.env,
    ...(configDir ? { CLAUDE_CONFIG_DIR: configDir, CLAUDE_CODE_PROJECT_DIR_NAME: 'probe-clone' } : {}),
    // Never set here: they would silently change the cache behaviour the whole
    // width plan rests on (#382, and the DO-NOT list).
    FORCE_PROMPT_CACHING_5M: undefined,
  },
  onEvent: (e) => events.push(e),
  ...over,
})

assert.ok(!process.env.ANTHROPIC_API_KEY, 'a distributed plugin must need no API key; unset it before probing')

const t0 = Date.now()
console.log('arm A: a conforming reply from a real claude -p …')
const outA = await mk()(
  'Read README.md in the current directory. Reply with the value of PROBE_WORD as `word`, ' +
  'and the basename of your current working directory as `cwdBasename`. Do not write any file.',
  { label: 'impl:T1', model: 'haiku', schema: SCHEMA, isolation: 'worktree' })

assert.ok(outA && typeof outA === 'object', 'arm A must return the parsed structured object, got: ' + JSON.stringify(outA))
assert.equal(outA.word, 'marmalade', 'the worker read the file in the clone it was handed')
assert.equal(outA.cwdBasename, 'task-T1', 'cwd is the clone, i.e. the isolation:worktree site is honoured by the caller-supplied clone')

const endA = events.filter((e) => e.kind === 'worker:end').pop()
assert.equal(endA.outcome, 'ok')
assert.equal(endA.exitCode, 0)
assert.ok(endA.meter.costUsd > 0, 'modelUsage/total_cost_usd came back — subscription OAuth, firstParty')
console.log('  ok:', JSON.stringify(outA), '| exit', endA.exitCode, '| $' + endA.meter.costUsd.toFixed(4),
  '| models', endA.meter.models.join(','), '| cacheRead', endA.meter.cacheRead)

console.log('arm B: --max-turns 1 with a schema -> the fail-closed envelope …')
let armB = null
try {
  await mk({ maxTurns: 1 })(
    'Do not call any tool. Reply with exactly the plain text word: hello',
    { label: 'impl:T1', model: 'haiku', schema: SCHEMA })
  throw new Error('arm B did not fail — expected error_max_turns')
} catch (e) {
  armB = e.workerVerdict
  assert.ok(armB, 'arm B threw without a workerVerdict: ' + e.message)
}
assert.equal(armB.outcome, 'retry')
assert.equal(armB.class, 'max-turns')
// The message must carry the escalation vocabulary waves.js:879 reads, or the
// retry silently stops picking the stronger model.
assert.match(armB.detail, /schema|structuredoutput/i)
const endB = events.filter((e) => e.kind === 'worker:end').pop()
assert.equal(endB.exitCode, 1, 'max_turns exits 1, not 0 — the design inputs said otherwise')
console.log('  ok: exit', endB.exitCode, '| class', armB.class)

if (!configDir) {
  console.log('arm C: SKIPPED — no CLAUDE_CODE_OAUTH_TOKEN in the env, so a per-run')
  console.log('       CLAUDE_CONFIG_DIR would lose the credential (R-p2). Run this arm on')
  console.log('       the orchestrator, where the token is the auth and the config dir is free.')
} else {
  console.log('arm C: the --bare substitute, end to end …')
  // R-o11c held for a hand-run command; this asserts the module's own flag set
  // achieves it. A fresh CLAUDE_CONFIG_DIR must have been populated with no
  // onboarding prompt, and the worker's transcript must live under it — which is
  // what makes the run directory the evidence bundle (spec §5).
  const projects = path.join(configDir, 'projects')
  assert.ok(fs.existsSync(projects), 'the per-run CLAUDE_CONFIG_DIR was never populated: ' + configDir)
  const transcripts = fs.readdirSync(projects, { recursive: true }).filter((f) => String(f).endsWith('.jsonl'))
  assert.ok(transcripts.length >= 2, 'expected a transcript per worker under the run config dir, found ' + transcripts.length)
  console.log('  ok:', transcripts.length, 'transcripts under the per-run config dir')
}

console.log('arm D: an unreachable credential is a FAILED RUN, not a failed task …')
// The correction §6 needed, exercised live: a fresh CLAUDE_CONFIG_DIR with no
// token in the env produces terminal_reason "api_error" with api_error_status
// NULL — which §6's table read as a task limit. It is not: every later worker
// would fail identically, so it must raise RUN_FATAL on the first one.
{
  const deadCfg = path.join(root, 'no-credential-here')
  fs.mkdirSync(deadCfg, { recursive: true })
  const env = { ...process.env, CLAUDE_CONFIG_DIR: deadCfg }
  delete env.CLAUDE_CODE_OAUTH_TOKEN
  delete env.ANTHROPIC_API_KEY
  await assert.rejects(
    () => mk({ env })('hi', { label: 'impl:T1', model: 'haiku' }),
    (e) => /RUN_FATAL/.test(e.message) && /reaching the API/.test(e.message),
    'an api_error with no HTTP status must fail the RUN, not the task')
  const end = events.filter((e) => e.kind === 'worker:end').pop()
  assert.equal(end.exitCode, 1)
  assert.equal(end.class, 'credential')
  console.log('  ok: exit 1, api_error_status null, classed credential -> fail-run')
}

// The evidence bundle for every arm.
const workerDirs = fs.readdirSync(path.join(root, 'workers'))
for (const d of workerDirs) {
  const files = fs.readdirSync(path.join(root, 'workers', d))
  assert.ok(files.includes('cmd') && files.includes('stdout'), d + ' is missing evidence: ' + files.join(','))
}

const totalCost = events.filter((e) => e.kind === 'worker:end' && e.meter).reduce((a, e) => a + e.meter.costUsd, 0)
console.log('\nALL PROBES PASSED — ' + workerDirs.length + ' worker dirs, $' + totalCost.toFixed(4) +
  ', ' + ((Date.now() - t0) / 1000).toFixed(1) + 's wall')
console.log('evidence: ' + root)
