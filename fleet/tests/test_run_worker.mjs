// fleet/tests/test_run_worker.mjs — CI-safe half of #401 step 1.
//
// Two claims are being made, and they need two different tests:
//
//   1. runWorker behaves like agent()      <- HERE, plus probe_run_worker_live
//   2. waves.js's loop still works on it   <- the three tests/sim_*.mjs (step 2)
//
// The sims STUB agent(), so passing them proves the loop is intact and says
// nothing at all about whether this module matches the contract. That is why
// this file exists.
//
// Every envelope below is a VERBATIM shape from the parity ledger
// (docs/superpowers/specs/2026-08-28-claude-p-worker-parity.md), cited by repro
// id — not an invented one. The one exception is the 529 row, which is marked:
// a real 529 has never been triggered and cannot be forced without external
// load, so that row tests the MECHANISM (api_error_status carrying an HTTP
// status, which 404 demonstrated) and says so.
//
// The spawn path is exercised against a FAKE `claude` executable rather than a
// mock, so argv assembly, stdin closure, exit codes and SIGTERM are real. The
// live half — one trivial task against the real CLI — is probe_run_worker_live
// .mjs, deliberately NOT named test_* because CI has no credentials.

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  ROLES, roleForLabel, sessionIdFor, buildArgs, lastResult, classify, meterOf,
  createRunWorker, INFRA_STATUSES, CREDENTIAL_STATUSES,
} from '../run-worker.mjs'
import { isSchemaTrip } from '../run-engine.mjs'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'runworker-'))

// ── the escalation vocabulary, READ FROM waves.js, never copied ─────────────
//
// This module's retry classes reach waves.js's tier ladder as PROSE: `classify`
// produces a structured verdict, the verdict leaves through a throw, and
// waves.js:879 decides "stronger model" vs "same tier" by regexing the message
// text. That coupling is debt (see the issue this test's comment points at) and
// stage 4 should delete it by having waves.js read `err.workerVerdict.class`.
//
// The engine that consumes this vocabulary is fleet/run-engine.mjs — the pin
// holds the classifier the RUNNING engine uses, imported directly.
const SCHEMA_TRIP = { test: (s) => isSchemaTrip(s) }
assert.ok(isSchemaTrip('a schema trip'), 'sanity: the engine classifier behaves like one')
assert.ok(!isSchemaTrip('AGENT_NULL: overloaded'), 'sanity: it does not match everything')
// (The waves.js cross-pin lived here until 0.3.0 — the fallback is deleted,
// and run-engine.mjs's imported classifier is the only copy.)

// ── 1. label -> role: the whole taxonomy waves.js emits ──────────────────────
// Every one of these strings is a real label from a real call site; the line
// number is where it is constructed.
assert.equal(roleForLabel('impl:T1'), 'implementer')                      // :1107
assert.equal(roleForLabel('fix:T1:2'), 'implementer')                     // :1265
assert.equal(roleForLabel('review:T1:1'), 'reviewer')                     // :1168
assert.equal(roleForLabel('review:T1:1:2'), 'reviewer')                   // :1168 adversarial pass
assert.equal(roleForLabel('integration'), 'critic')                       // :2209
assert.equal(roleForLabel('setup'), 'writeSide')                          // :1887
assert.equal(roleForLabel('merge:wave1'), 'writeSide')                    // :1763
assert.equal(roleForLabel('merge:wave1:fold'), 'writeSide')               // :1457
assert.equal(roleForLabel('merge:wave1:apply0:1'), 'writeSide')           // :1606
assert.equal(roleForLabel('merge:wave1:adopt'), 'writeSide')              // :1684
assert.equal(roleForLabel('reconcile:wave1:1'), 'writeSide')
// Amendment 10: the resolver replies through its schema and the driver writes
// the reply directory, so the role is read-only — never write-side.
assert.equal(roleForLabel('resolve:wave1:0:1'), 'resolver')
// An undeclared label FAILS LOUD. This is the assertion that keeps the role
// table honest as waves.js changes: a new dispatch site cannot inherit a
// permissive role by omission.
assert.throws(() => roleForLabel('newthing:x'), /no role declared/)
assert.throws(() => roleForLabel(''), /label is required/)

// ── 2. the read-only roles really are read-only ──────────────────────────────
// Not a style check: for the allowlist roles the ALLOWLIST IS THE BOUNDARY
// (parity R-w3), so an allowlist that admitted Write or a bare Bash would move
// the boundary without anyone noticing.
for (const role of ['reviewer', 'resolver', 'critic']) {
  const tools = ROLES[role].allowedTools
  assert.ok(!tools.includes('Write') && !tools.includes('Edit'), role + ' must not carry a write tool')
  assert.ok(!tools.includes('Bash'), role + ' must not carry unrestricted Bash')
  assert.equal(ROLES[role].writableRoot, null)
  assert.equal(ROLES[role].permissionMode, 'dontAsk')
}
// Amendment 10 deleted the critic's three extra git verbs: the DRIVER performs
// the detach and derives the #70 ancestry check from fold receipts, so a
// critic allowlist that regrew a git verb would silently widen a read-only
// boundary — pin the collapse.
for (const verb of ['Bash(git checkout --detach *)', 'Bash(git rev-parse *)', 'Bash(git merge-base *)']) {
  assert.ok(!ROLES.critic.allowedTools.includes(verb), 'critic regrew a deleted verb: ' + verb)
  assert.ok(!ROLES.reviewer.allowedTools.includes(verb), 'reviewer must not have ' + verb)
}
// The two verbs an implementer must never have: stash hides work from the
// engine's sha bookkeeping, push publishes it past the one human gate.
for (const role of ['implementer', 'writeSide']) {
  assert.ok(ROLES[role].disallowedTools.includes('Bash(git stash *)'))
  assert.ok(ROLES[role].disallowedTools.includes('Bash(git push *)'))
}

// ── 3. session ids: deterministic, uuid-shaped, distinct per label ───────────
const sid = sessionIdFor('run-24', 'impl:T1')
assert.match(sid, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
assert.equal(sid, sessionIdFor('run-24', 'impl:T1'))            // stable: a re-drive lands on the same transcript
assert.notEqual(sid, sessionIdFor('run-24', 'impl:T2'))
assert.notEqual(sid, sessionIdFor('run-25', 'impl:T1'))

// ── 4. argv ──────────────────────────────────────────────────────────────────
const SCHEMA = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false }
{
  const argv = buildArgs({
    opts: { label: 'impl:T1', model: 'sonnet', schema: SCHEMA },
    role: 'implementer', sessionId: sid, promptFile: '/run/roles/implementer.md',
    settings: '/run/hook.json', addDirs: ['/run/plans'], maxTurns: 40, maxBudgetUsd: 5,
  })
  const at = (f) => argv[argv.indexOf(f) + 1]
  // buildArgs returns FLAGS ONLY — no `-p` and no prompt. `--allowedTools`,
  // `--disallowedTools` and `--add-dir` are variadic, so a trailing prompt
  // positional is swallowed by whichever came last and the CLI exits 1 with no
  // envelope. Found live, not here; pinned here so it stays found.
  assert.ok(!argv.includes('-p'), 'the prompt is the value of -p, assembled in runProcess')
  assert.equal(at('--output-format'), 'json')
  assert.equal(at('--session-id'), sid)
  assert.equal(at('--model'), 'sonnet')
  assert.equal(at('--permission-mode'), 'bypassPermissions')
  assert.equal(at('--json-schema'), JSON.stringify(SCHEMA))       // inline JSON: parity R-o1
  assert.equal(at('--append-system-prompt-file'), '/run/roles/implementer.md')  // R-o11a/R-l6
  assert.equal(at('--settings'), '/run/hook.json')
  assert.equal(at('--add-dir'), '/run/plans')
  assert.equal(at('--max-turns'), '40')
  assert.equal(at('--max-budget-usd'), '5')
  assert.equal(at('--disallowedTools'), 'Bash(git stash *),Bash(git push *)')
  assert.ok(!argv.includes('--allowedTools'), 'the implementer runs the default tool set, minus two verbs')
  // The --bare substitute (R-o11c). --bare itself exits 1 "Not logged in" under
  // OAuth on every version measured (R-o11b/R-l7/R-l8, #384) — so its absence
  // here is a hard requirement, not an omission.
  assert.equal(at('--setting-sources'), 'user')
  assert.ok(argv.includes('--disable-slash-commands'))
  assert.ok(!argv.includes('--bare'), '--bare never reads OAuth: #384')
  // Cache hygiene (#382): +15.8 points of cross-clone prefix sharing.
  assert.ok(argv.includes('--exclude-dynamic-system-prompt-sections'))
  // The only flag that can silently downgrade a model. "No Sonnet-for-Opus."
  assert.ok(!argv.includes('--fallback-model'))
}
{
  // waves.js:1589 dispatches the resolver with NO `model` key, verified live and
  // deliberate — the resolver runs at the ambient model so the A/B grading cell
  // is like-for-like. Omission must stay omission.
  const argv = buildArgs({ opts: { label: 'resolve:wave1:0:1', schema: SCHEMA }, role: 'writeSide', sessionId: sid })
  assert.ok(!argv.includes('--model'), 'an absent model means omit --model, never default it')
}
{
  const argv = buildArgs({ opts: { label: 'review:T1:1', model: 'opus', schema: SCHEMA }, role: 'reviewer', sessionId: sid })
  const at = (f) => argv[argv.indexOf(f) + 1]
  assert.equal(at('--permission-mode'), 'dontAsk')
  assert.equal(at('--allowedTools'), ROLES.reviewer.allowedTools.join(','))
  assert.ok(!argv.includes('--disallowedTools'), 'an allowlist role needs no denylist — the allowlist is the boundary')
}

// ── 5. lastResult: take the LAST result line ─────────────────────────────────
// A worker that spawns a background subagent emits TWO under stream-json — an
// interim and a final (R-o8). Which of the two --output-format json prints was
// never reproduced, so this parses defensively on both paths.
assert.equal(lastResult(''), null)
assert.equal(lastResult('   '), null)
assert.deepEqual(lastResult('{"type":"result","subtype":"success","structured_output":{"ok":true}}'),
  { type: 'result', subtype: 'success', structured_output: { ok: true } })
{
  const two = [
    '{"type":"system","subtype":"init"}',
    '{"type":"result","subtype":"success","total_cost_usd":0.0249,"structured_output":{"ok":false}}',
    '{"type":"assistant"}',
    '{"type":"result","subtype":"success","total_cost_usd":0.0291,"structured_output":{"ok":true}}',
  ].join('\n')
  assert.deepEqual(lastResult(two).structured_output, { ok: true }, 'must take the LAST result line')
  assert.equal(lastResult(two).total_cost_usd, 0.0291)
}
assert.equal(lastResult('Warning: something\nnot json at all'), null)

// ── 6. the exit-class table (spec §6, parity items 7 / 7b / 7c) ──────────────
const env = (o) => ({ type: 'result', api_error_status: null, is_error: false, ...o })

// success (R-o1)
assert.deepEqual(classify({ exitCode: 0, envelope: env({ subtype: 'success', terminal_reason: 'completed', structured_output: { ok: true } }) }),
  { outcome: 'ok', class: 'success' })

// SIGINT: exit 0 with is_error true, NOT the documented 130 (R-o7b). This is
// agent()'s FIRST null condition — it nulls on abort as well as API error.
assert.equal(classify({ exitCode: 0, envelope: env({ subtype: 'error_during_execution', is_error: true, terminal_reason: 'aborted_streaming', result: null }) }).outcome, 'null')

// SIGTERM: exit 143 and NO ENVELOPE AT ALL (R-o7a). Retryable once.
{
  const v = classify({ exitCode: 143, envelope: null })
  assert.equal(v.outcome, 'retry')
  assert.equal(v.class, 'sigterm')
}

// max_turns: exit 1 (NOT 0), api_error_status null (R-o2b/R-l3/7b). A limit we
// set ourselves is a TASK outcome -> retry with tier escalation.
{
  const v = classify({ exitCode: 1, envelope: env({ subtype: 'error_max_turns', is_error: true, terminal_reason: 'max_turns', structured_output: null }) })
  assert.equal(v.outcome, 'retry')
  assert.equal(v.class, 'max-turns')
  assert.ok(SCHEMA_TRIP.test(v.detail), 'a retry class must speak the engine\'s escalation vocabulary')
}

// budget: exit 1, api_error_status null (R-o3/R-l9). Per-worker backstop -> the
// task fails and is recorded; the wave proceeds on what completed.
{
  const v = classify({ exitCode: 1, envelope: env({ subtype: 'error_max_budget_usd', is_error: true, terminal_reason: 'budget_exhausted', structured_output: null }) })
  assert.equal(v.outcome, 'fail-task')
  assert.equal(v.class, 'budget')
}

// invalid model: THE trap. subtype "success" with is_error true and
// api_error_status 404 (R-7b). Keying on subtype would call this a success.
{
  const v = classify({ exitCode: 1, envelope: env({ subtype: 'success', is_error: true, terminal_reason: 'api_error', api_error_status: 404, result: 'model not found' }) })
  assert.equal(v.outcome, 'fail-run')
  assert.equal(v.class, 'credential')
  assert.equal(v.status, 404)
}
for (const s of CREDENTIAL_STATUSES) {
  assert.equal(classify({ exitCode: 1, envelope: env({ is_error: true, terminal_reason: 'api_error', api_error_status: s }) }).outcome, 'fail-run')
}

// api_error with api_error_status NULL — the correction spec §6 needed, found
// live 2026-08-28 (R-p1), verbatim from the observed envelope. §6's table read
// api_error_status null as "a limit we set ourselves", i.e. a task outcome, and
// would have sent this down the is_error branch to fail-task — leaving every
// worker in the wave to burn a process discovering the same dead credential.
//
// terminal_reason names the LAYER; api_error_status names whether the request
// ever reached the API. No status means it never did, so the client refused.
{
  const v = classify({
    exitCode: 1,
    envelope: {
      type: 'result', subtype: 'success', is_error: true, terminal_reason: 'api_error',
      api_error_status: null, result: 'Not logged in · Please run /login',
      duration_api_ms: 0, num_turns: 1, total_cost_usd: 0, modelUsage: {}, stop_reason: 'stop_sequence',
    },
  })
  assert.equal(v.outcome, 'fail-run')
  assert.equal(v.class, 'credential')
  assert.match(v.detail, /Not logged in/)
}

// infra: 429/503/529 -> null -> AGENT_NULL -> the barrier-retry park lane.
//
// NOT REPRODUCED, and stated as such: a real 529 cannot be forced without
// external load. What IS observed is the mechanism — api_error_status carries
// the HTTP status of an API-layer failure, which the 404 above demonstrates —
// so this row tests that the driver keys the right FIELD, and the specific
// statuses remain a short inference from a demonstrated field.
for (const s of INFRA_STATUSES) {
  const v = classify({ exitCode: 1, envelope: env({ is_error: true, terminal_reason: 'api_error', api_error_status: s }) })
  assert.equal(v.outcome, 'null', 'infra status ' + s + ' must null, not throw')
  assert.equal(v.class, 'infra')
}

// The second trap: result === null is true of max_turns, budget_exhausted AND
// aborts. Three envelopes, same null result, three different dispositions.
{
  const outcomes = [
    classify({ exitCode: 1, envelope: env({ is_error: true, terminal_reason: 'max_turns', result: null }) }).outcome,
    classify({ exitCode: 1, envelope: env({ is_error: true, terminal_reason: 'budget_exhausted', result: null }) }).outcome,
    classify({ exitCode: 0, envelope: env({ is_error: true, terminal_reason: 'aborted_streaming', result: null }) }).outcome,
  ]
  assert.deepEqual(outcomes, ['retry', 'fail-task', 'null'], 'result === null must never be read alone')
}

// exit 0, no error, and still no typed reply -> retry, never an undefined
// handed to waves.js (which would TypeError at impl.status).
assert.equal(classify({ exitCode: 0, envelope: env({ subtype: 'success', terminal_reason: 'completed', structured_output: null }) }).outcome, 'retry')

// ── 7. spend: sum modelUsage, never `usage` ──────────────────────────────────
// `usage` reports the LAST call only; modelUsage covers the whole worker
// including any subagent it spawned (R-o8 matched the subagent transcript
// exactly). Reading `usage` would under-report a subagent-spawning worker.
{
  const m = meterOf({
    total_cost_usd: 0.0291,
    usage: { input_tokens: 9, output_tokens: 9 },
    modelUsage: {
      'claude-sonnet-5': { inputTokens: 100, outputTokens: 20, cacheReadInputTokens: 22230, cacheCreationInputTokens: 2803 },
      'claude-haiku-4-5-20251001': { inputTokens: 901, outputTokens: 10, cacheReadInputTokens: 0, cacheCreationInputTokens: 8278 },
    },
  })
  assert.equal(m.input, 1001)
  assert.equal(m.output, 30)
  assert.equal(m.cacheRead, 22230)
  assert.equal(m.cacheCreation, 11081)
  assert.equal(m.costUsd, 0.0291)
  assert.deepEqual(m.models.sort(), ['claude-haiku-4-5-20251001', 'claude-sonnet-5'])
}

// ── 8. the dispatcher, against a FAKE claude executable ──────────────────────
// A real child process, so argv delivery, closed stdin, exit codes and SIGTERM
// are exercised rather than mocked. The fake reads a scenario out of the env,
// records the argv it was handed, and prints a canned envelope.
const fakeCli = path.join(tmp, 'fake-claude')
fs.writeFileSync(fakeCli, `#!/usr/bin/env node
const fs = require('fs')
fs.writeFileSync(process.env.FAKE_ARGV_OUT, JSON.stringify(process.argv.slice(2)))
// stdin must be CLOSED by the caller: an inherited stdin costs the real CLI a
// 3s "no stdin data received" wait (parity item 10). Record what we got.
fs.writeFileSync(process.env.FAKE_STDIN_OUT, String(process.stdin.isTTY ? 'tty' : (fs.fstatSync(0).isFile() || fs.fstatSync(0).isCharacterDevice() ? 'closed-or-null' : 'other')))
// EXIT IN THE FINAL WRITE'S CALLBACK, never right after a write. stdout to a
// pipe is asynchronous in Node, and process.exit() discards writes still in
// the internal queue — on a loaded machine the whole envelope vanished and the
// driver saw "no result envelope on stdout (exit 0)" (run-25's baseline red,
// the ONLY sandbox suite failure). Writes to one stream flush in order, so the
// last write's callback proves everything before it landed too.
const out = (line, code) => process.stdout.write(line + '\\n', () => process.exit(code))
const s = process.env.FAKE_SCENARIO
if (s === 'hang') { setTimeout(() => {}, 60000); process.on('SIGTERM', () => process.exit(143)); return }
if (s === 'success') { out(JSON.stringify({type:'result',subtype:'success',is_error:false,terminal_reason:'completed',api_error_status:null,structured_output:{ok:true,cwd:process.cwd()},total_cost_usd:0.01,modelUsage:{}}), 0); return }
if (s === 'overload') { out(JSON.stringify({type:'result',subtype:'success',is_error:true,terminal_reason:'api_error',api_error_status:529,result:'overloaded'}), 1); return }
if (s === 'credential') { out(JSON.stringify({type:'result',subtype:'success',is_error:true,terminal_reason:'api_error',api_error_status:401,result:'no'}), 1); return }
if (s === 'budget') { out(JSON.stringify({type:'result',subtype:'error_max_budget_usd',is_error:true,terminal_reason:'budget_exhausted',api_error_status:null,structured_output:null}), 1); return }
if (s === 'unicode') {
  // Emitted one BYTE at a time, so every multi-byte character is guaranteed to
  // straddle a chunk boundary — the condition that silently corrupts a
  // Buffer-concatenating reader.
  const payload = Buffer.from(JSON.stringify({type:'result',subtype:'success',is_error:false,terminal_reason:'completed',api_error_status:null,structured_output:{ok:true,text:'— — — ünïcødé — — —'},modelUsage:{}}), 'utf8')
  let i = 0
  const tick = () => {
    if (i >= payload.length) { process.stdout.write(Buffer.from([10]), () => process.exit(0)); return }
    process.stdout.write(payload.subarray(i, i + 1)); i++
    setImmediate(tick)
  }
  tick()
  return
}
if (s === 'maxturns') { out(JSON.stringify({type:'result',subtype:'error_max_turns',is_error:true,terminal_reason:'max_turns',api_error_status:null,structured_output:null}), 1); return }
process.exit(9)
`)
fs.chmodSync(fakeCli, 0o755)

const argvOut = path.join(tmp, 'argv.json')
const stdinOut = path.join(tmp, 'stdin.txt')
const workersDir = path.join(tmp, 'workers')
const clone = fs.mkdirSync(path.join(tmp, 'clones', 'task-T1'), { recursive: true }) || path.join(tmp, 'clones', 'task-T1')

const events = []
const mkAgent = (scenario, over = {}) => createRunWorker({
  runId: 'run-24',
  workersDir,
  cwdFor: () => clone,
  cli: fakeCli,
  env: { ...process.env, FAKE_SCENARIO: scenario, FAKE_ARGV_OUT: argvOut, FAKE_STDIN_OUT: stdinOut },
  onEvent: (e) => events.push(e),
  ...over,
})

// success -> the PARSED STRUCTURED REPLY, not the envelope. waves.js reads
// impl.status / impl.branch / r1.issues straight off this object.
{
  const agent = mkAgent('success')
  const out = await agent('do a thing', { label: 'impl:T1', model: 'sonnet', schema: SCHEMA, isolation: 'worktree' })
  assert.deepEqual(out, { ok: true, cwd: fs.realpathSync(clone) }, 'returns structured_output, and runs in the clone it was given')
  const argv = JSON.parse(fs.readFileSync(argvOut, 'utf8'))
  // The prompt is the VALUE OF -p, first, not a trailing positional. The real
  // CLI's variadic options swallow a trailing positional and then exit 1 with
  // no envelope at all; the fake below is happy to accept one, which is exactly
  // why the live probe is a separate, mandatory arm and not a nicety.
  assert.equal(argv[0], '-p')
  assert.equal(argv[1], 'do a thing', 'the prompt goes on argv, never stdin')
  assert.notEqual(argv[argv.length - 1], 'do a thing', 'never a trailing positional after a variadic option')
  assert.notEqual(fs.readFileSync(stdinOut, 'utf8'), 'tty', 'stdin must not be a tty')
  // The run directory IS the evidence bundle (spec §5).
  const dir = path.join(workersDir, 'impl_T1')
  assert.ok(fs.existsSync(path.join(dir, 'cmd')), 'the argv is written BEFORE the process starts')
  assert.ok(fs.existsSync(path.join(dir, 'envelope.json')))
  assert.match(fs.readFileSync(path.join(dir, 'cmd'), 'utf8'), /--session-id/)
  const end = events.find((e) => e.kind === 'worker:end')
  assert.equal(end.outcome, 'ok')
  assert.equal(end.role, 'implementer')
}

// overload -> null, NEVER a throw. This is the single most load-bearing line in
// the module: waves.js turns null into AGENT_NULL at all ten sites, and
// AGENT_NULL is the ONLY signal its isInfraFault classifier trusts (:892 — it
// refuses to text-match "Overloaded" precisely because agent() returns null
// rather than throwing overload-worded errors). Throw here and the whole
// barrier-retry park lane silently stops working.
{
  const out = await mkAgent('overload')('x', { label: 'impl:T1', model: 'sonnet', schema: SCHEMA })
  assert.equal(out, null)
}

// credential -> raised, not returned: nothing downstream can succeed, and every
// later worker would burn a process to learn the same thing.
await assert.rejects(() => mkAgent('credential')('x', { label: 'impl:T1', model: 'sonnet', schema: SCHEMA }), /RUN_FATAL/)

// max_turns -> thrown with the escalation vocabulary, so waves.js's existing
// single retry picks the stronger model rather than retrying in place.
await assert.rejects(
  () => mkAgent('maxturns')('x', { label: 'impl:T1', model: 'sonnet', schema: SCHEMA }),
  (e) => /schema|structuredoutput/i.test(e.message) && e.workerVerdict.class === 'max-turns' && !e.message.startsWith('AGENT_NULL'))

// timeout -> SIGTERM -> 143 -> retryable once. The timeout path and the kill
// path are deliberately the same class, so there is one branch, not two.
{
  await assert.rejects(
    () => mkAgent('hang', { timeoutMs: 400 })('x', { label: 'impl:T1', model: 'sonnet', schema: SCHEMA }),
    (e) => e.workerVerdict.class === 'sigterm')
  const end = events.filter((e) => e.kind === 'worker:end').pop()
  assert.equal(end.timedOut, true)
  assert.equal(end.exitCode, 143)
}

// A RETRY MUST NOT OVERWRITE THE FAILURE'S EVIDENCE. waves.js's single retry
// reuses the label, and the first attempt's envelope is the interesting one —
// an evidence bundle that keeps only the recovery is not an evidence bundle.
{
  const before = fs.readdirSync(workersDir)
  await mkAgent('overload')('x', { label: 'impl:T1', model: 'sonnet', schema: SCHEMA })
  const after = fs.readdirSync(workersDir)
  assert.ok(after.length > before.length, 'a second dispatch of the same label gets its own dir')
  assert.ok(after.some((d) => /^impl_T1\.\d+$/.test(d)), 'suffixed: ' + after.join(','))
  // The first dispatch's envelope is still the successful one, untouched.
  const first = JSON.parse(fs.readFileSync(path.join(workersDir, 'impl_T1', 'envelope.json'), 'utf8'))
  assert.deepEqual(first.structured_output.ok, true, "the first attempt's envelope survived the retry")
}

// A SIGTERM the worker IGNORES must still end it. `timeoutMs` is a promise of a
// wall-clock deadline; without a SIGKILL escalation it is only a promise to
// ASK, and one worker that traps SIGTERM would hang the wave forever.
{
  const stubborn = path.join(tmp, 'stubborn-claude')
  fs.writeFileSync(stubborn, `#!/usr/bin/env node
process.on('SIGTERM', () => {})   // trapped and ignored, deliberately
setInterval(() => {}, 1000)
`)
  fs.chmodSync(stubborn, 0o755)
  const t0 = Date.now()
  await assert.rejects(
    () => mkAgent('hang', { cli: stubborn, timeoutMs: 300, graceMs: 300 })('x', { label: 'impl:T1', model: 'sonnet', schema: SCHEMA }),
    (e) => e.workerVerdict.class === 'sigterm')
  assert.ok(Date.now() - t0 < 5000, 'the deadline was enforced, not merely requested')
  assert.equal(events.filter((e) => e.kind === 'worker:end').pop().exitCode, 143,
    'SIGKILL is the same class as SIGTERM: killed, no envelope, retryable once')
}

// A CREDENTIAL FAILURE MUST STOP THE RUN, and a throw alone does not achieve
// that. waves.js:1014 catches every throw out of agent() by design, and its
// classifiers recognise only AGENT_NULL (isInfraFault) and schema-shaped text
// (isSchemaTrip) — so `RUN_FATAL: …` became a same-tier retry and then a failed
// task: TWO dispatches per task, each learning the same dead credential. The
// exact burn the credential row exists to prevent, doubled. The driver latches
// it on its own side and refuses to spawn.
{
  const agent = mkAgent('credential')
  await assert.rejects(() => agent('x', { label: 'impl:T1', model: 'sonnet', schema: SCHEMA }), /RUN_FATAL/)
  const spawnsBefore = fs.readdirSync(workersDir).length
  // A DIFFERENT label — i.e. another task in the same wave — must not spawn.
  await assert.rejects(
    () => agent('x', { label: 'impl:T2', model: 'sonnet', schema: SCHEMA }),
    (e) => /RUN_FATAL/.test(e.message) && /refusing to dispatch/.test(e.message))
  assert.equal(fs.readdirSync(workersDir).length, spawnsBefore,
    'a refused dispatch must not spawn a process, or write a worker dir')
  assert.ok(events.some((e) => e.kind === 'run:fatal'), 'the fatal is observable')
  assert.ok(events.some((e) => e.kind === 'worker:refused' && e.why === 'run-fatal'))
}

// A tripped per-worker budget must not be paid twice. waves.js retries any
// non-AGENT_NULL throw once, and for `budget` that means spending the
// --max-budget-usd backstop a second time to learn the same thing.
{
  const agent = mkAgent('budget')
  await assert.rejects(() => agent('x', { label: 'impl:T3', model: 'sonnet', schema: SCHEMA }),
    (e) => e.workerVerdict.class === 'budget')
  const spawnsBefore = fs.readdirSync(workersDir).length
  await assert.rejects(() => agent('x', { label: 'impl:T3', model: 'sonnet', schema: SCHEMA }),
    /already exhausted its per-worker budget/)
  assert.equal(fs.readdirSync(workersDir).length, spawnsBefore, "waves.js's retry must not respawn it")
}

// stdout is DECODED, not concatenated from Buffers. A multi-byte character
// split across a chunk boundary decodes to U+FFFD on both sides — and the
// result is still valid JSON, so lastResult parses it and the corruption is
// silent, inside structured_output. This repo's prose is full of em-dashes.
{
  const out = await mkAgent('unicode')('x', { label: 'impl:T4', model: 'sonnet', schema: SCHEMA })
  assert.equal(out.text, '— — — ünïcødé — — —', 'no U+FFFD: got ' + JSON.stringify(out.text))
  assert.ok(!JSON.stringify(out).includes('\ufffd'))
}

// A cwd that cannot be resolved is a PROGRAMMING error, not a worker outcome:
// it must fail loudly, never degrade into a null the engine reads as overload.
await assert.rejects(
  () => createRunWorker({ runId: 'r', cwdFor: () => null, cli: fakeCli })('x', { label: 'impl:T1' }),
  /refusing to run a worker in an unknown directory/)

fs.rmSync(tmp, { recursive: true, force: true })
console.log('ALL TESTS PASSED')
