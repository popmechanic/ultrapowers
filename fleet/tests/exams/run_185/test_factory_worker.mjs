/**
 * test_factory_worker.mjs — the exam for Task 1: *the worker — one `query()`
 * per dispatch, confinement as a function*.
 *
 * This file is the Proof's `Test:` (`fleet/tests/test_factory_worker.mjs`),
 * written whole at the landing path the run's EXAM PATHS line names:
 * `fleet/tests/exams/run_185/test_factory_worker.mjs`. Every path in it is
 * written for THIS directory — `../../../..` is the repository root, from
 * which `factory/worker.mjs` and `fleet/package.json` are read.
 *
 * Run: `node fleet/tests/exams/run_185/test_factory_worker.mjs`
 *
 * The Machine clauses under test, restated so a reader can map every assertion
 * back to the contract:
 *
 *   M1 — `runWorker({ cwd, prompt, systemPrompt, model, files, schema,
 *        mcpServers, maxTurns, maxBudgetUsd, onMessage }, deps)` awaits one
 *        `deps.query()` iterator to its `result` message and resolves
 *        `{ result, denials, turns, wall_ms }`, where `result` is that message
 *        and `turns` counts its `assistant` messages.
 *   M2 — the options passed to `query()` carry `settingSources: []`,
 *        `permissionMode: 'bypassPermissions'`, `cwd`, `systemPrompt`,
 *        `model`, and a `disallowedTools` list containing `Bash(git *)`,
 *        `WebFetch`, `WebSearch` and `Agent`; `outputFormat: { type:
 *        'json_schema', schema }` is present exactly when `schema` is given,
 *        and `mcpServers` is passed through when given.
 *   M3 — the options carry ONE `hooks.PreToolUse` callback which, for a tool
 *        named `Edit`, `Write`, `MultiEdit` or `NotebookEdit`, resolves
 *        `{ hookSpecificOutput: { hookEventName: 'PreToolUse',
 *        permissionDecision: 'deny', permissionDecisionReason } }` when the
 *        resolved `file_path` is outside `cwd` or not in `files`, resolves
 *        `{}` otherwise, and appends `{ tool, path }` to the `denials` the
 *        call answers on each deny.
 *   M4 — `interruptWorker(handle)` calls the iterator's `interrupt()` once and
 *        resolves what it resolves; `runWorker` answers that handle as
 *        `handle` beside the promise when called as `startWorker(...)`.
 *   M5 — `factory/worker.mjs` is 200 lines or fewer, and `fleet/package.json`
 *        lists `@anthropic-ai/claude-agent-sdk` under `dependencies`.
 *
 * The Proof's legs, and where each is answered below:
 *
 *   (a) [M1] a fake `deps.query` yielding one `system` message, three
 *            `assistant` messages and one `result`: `result` equal to that
 *            last message, `turns` equal to 3, a numeric `wall_ms`.
 *   (b) [M2] the options object the fake `query` received: `settingSources`
 *            deep-equal `[]`, `permissionMode`, `cwd`, `systemPrompt`,
 *            `model`, and `disallowedTools` containing each of the four
 *            literals.
 *   (c) [M2] without `schema` no `outputFormat`; with `schema: { type:
 *            'object' }` an `outputFormat` deep-equal to `{ type:
 *            'json_schema', schema: { type: 'object' } }`; with `mcpServers:
 *            { factory: 'x' }` that same object.
 *   (d) [M3] the captured `hooks.PreToolUse[0].hooks[0]` invoked directly, for
 *            each of the four edit tools on an outside path, for `Edit` on an
 *            inside path and on a `..` escape, and for `Read` on the outside
 *            path — with `denials` read off the value the call answered.
 *   (e) [M4] `startWorker` with a fake `query` whose returned object carries
 *            an `interrupt()` resolving `'ok'`: a `handle`, and
 *            `interruptWorker(handle)` resolving `'ok'` after exactly one
 *            call.
 *   (f) [M5] the line count of `factory/worker.mjs`, and `fleet/package.json`
 *            parsed as JSON.
 *
 * Nothing here reaches the real edge and nothing here opens a socket: `deps`
 * is the second argument of every call, so every `query()` in this file is the
 * exam's own fake. `@anthropic-ai/claude-agent-sdk` is never imported.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
/** `fleet/tests/exams/run_185` → `fleet/tests/exams` → `fleet/tests` →
 *  `fleet` → the repository root. */
const ROOT = path.resolve(HERE, '..', '..', '..', '..')
const WORKER_PATH = path.join(ROOT, 'factory', 'worker.mjs')
const PACKAGE_JSON_PATH = path.join(ROOT, 'fleet', 'package.json')

/** A promise that rejects rather than hanging the run, so a worker that never
 *  resolves reads as the leg that was waiting on it. */
const withTimeout = (promise, label) => Promise.race([
  promise,
  new Promise((_resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out after 10s waiting for ' + label)), 10000)
    timer.unref()
  }),
])

/** `true` when `list` holds an element deep-equal to `want` — the reading of
 *  "`denials` afterwards contains `{ tool, path }`" in leg (d). */
const containsEntry = (list, want) => (list ?? []).some((entry) => {
  try {
    assert.deepStrictEqual(entry, want)
    return true
  } catch {
    return false
  }
})

// ══════════════════════════════════════════════════════════════════════════
// The deliverable, imported dynamically: a tree without it reports the ABSENT
// MODULE as a named assertion rather than dying at load with no leg named.
// ══════════════════════════════════════════════════════════════════════════

let mod = null
let modImportError = null
try {
  mod = await import(pathToFileURL(WORKER_PATH).href)
} catch (error) {
  modImportError = error
}
assert.ok(modImportError === null,
  '(a) [M1] `factory/worker.mjs` is importable — the module this task creates. Got: ' +
  String(modImportError && (modImportError.stack || modImportError.message || modImportError)))

const { runWorker, startWorker, interruptWorker } = mod

assert.equal(typeof runWorker, 'function',
  '(a) [M1] it exports `runWorker(opts, deps)`; got ' + JSON.stringify(typeof runWorker))
assert.equal(typeof startWorker, 'function',
  '(e) [M4] it exports `startWorker(opts, deps)`; got ' + JSON.stringify(typeof startWorker))
assert.equal(typeof interruptWorker, 'function',
  '(e) [M4] it exports `interruptWorker(handle)`; got ' + JSON.stringify(typeof interruptWorker))

// ══════════════════════════════════════════════════════════════════════════
// The fake iterator `deps.query` answers with.
//
// The Context: "`deps` is the second argument and defaults to `{ query }` from
// the SDK, so an exam can drive a fake iterator that yields `system/init`, a
// few `assistant` messages, one `tool_use` whose hook the exam invokes
// directly off the captured options, and a `result`."
// ══════════════════════════════════════════════════════════════════════════

const SYSTEM_MESSAGE = { type: 'system', subtype: 'init', session_id: 'exam-session-1', tools: ['Edit', 'Write'] }
const ASSISTANT_1 = { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'reading the task' }] } }
/** The `tool_use` turn: still an `assistant` message, so it counts toward
 *  `turns`. Its hook is invoked directly off the captured options in leg (d). */
const ASSISTANT_2 = {
  type: 'assistant',
  message: {
    role: 'assistant',
    content: [{ type: 'tool_use', id: 'toolu_exam_1', name: 'Edit', input: { file_path: 'inside.txt', old_string: 'a', new_string: 'b' } }],
  },
}
const ASSISTANT_3 = { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] } }
const RESULT_MESSAGE = {
  type: 'result',
  subtype: 'success',
  is_error: false,
  num_turns: 3,
  total_cost_usd: 0.0123,
  result: 'the worker answered',
  session_id: 'exam-session-1',
}
const MESSAGES = [SYSTEM_MESSAGE, ASSISTANT_1, ASSISTANT_2, ASSISTANT_3, RESULT_MESSAGE]

/**
 * A recording `deps.query`. It answers an object that is async-iterable over
 * `messages` and — when `interrupt` is asked for — carries an `interrupt()`,
 * the shape the Context names ("The SDK's `Query` object exposes
 * `interrupt()`; capture the object `query()` returns").
 *
 * `gate`, when given, is awaited before the FIRST message, so a run can be
 * held genuinely in flight while leg (e) interrupts it.
 */
function makeFakeQuery ({ messages = MESSAGES, interrupt = false, interruptResult = 'ok', gate = null } = {}) {
  const calls = []
  const state = { interruptCalls: 0, returned: null }
  const fn = (arg) => {
    calls.push(arg)
    const returned = {
      [Symbol.asyncIterator] () {
        return (async function * () {
          if (gate) await gate
          for (const message of messages) yield message
        })()
      },
    }
    if (interrupt) {
      returned.interrupt = async () => {
        state.interruptCalls += 1
        return interruptResult
      }
    }
    state.returned = returned
    return returned
  }
  return { fn, calls, state }
}

/** A real directory on disk, so an implementation that resolves, stats or
 *  realpaths a `file_path` still sees the tree leg (d) describes. */
const CWD = fs.realpathSync(fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'factory-worker-exam-')))
fs.writeFileSync(path.join(CWD, 'inside.txt'), 'inside\n')

const PROMPT = 'implement task 1'
const SYSTEM_PROMPT = 'You implement one task in one clone.'
const MODEL = 'claude-sonnet-5'
const FILES = ['inside.txt']

/** One dispatch through a fresh fake. Returns the answered value beside the
 *  recorder, so each leg reads the options off its own call. */
async function dispatch (extra = {}, queryOptions = {}) {
  const fake = makeFakeQuery(queryOptions)
  const seen = []
  const answered = await withTimeout(runWorker({
    cwd: CWD,
    prompt: PROMPT,
    systemPrompt: SYSTEM_PROMPT,
    model: MODEL,
    files: FILES,
    maxTurns: 40,
    maxBudgetUsd: 1.5,
    onMessage: (message) => seen.push(message),
    ...extra,
  }, { query: fake.fn }), 'runWorker to resolve')
  return { answered, fake, seen }
}

// ══════════════════════════════════════════════════════════════════════════
// (a) [M1] one `deps.query()` iterator, awaited to its `result`
// ══════════════════════════════════════════════════════════════════════════

const base = await dispatch()

assert.equal(base.fake.calls.length, 1,
  '(a) [M1] `runWorker` awaits ONE `deps.query()` iterator; `query` was called ' +
  base.fake.calls.length + ' time(s)')

assert.deepStrictEqual(base.answered.result, RESULT_MESSAGE,
  '(a) [M1] `result` is the iterator\'s `result` message. Got: ' +
  JSON.stringify(base.answered.result))

assert.equal(base.answered.turns, 3,
  '(a) [M1] `turns` counts the iterator\'s `assistant` messages — three were yielded. Got: ' +
  JSON.stringify(base.answered.turns))

assert.equal(typeof base.answered.wall_ms, 'number',
  '(a) [M1] `wall_ms` is a number. Got: ' + JSON.stringify(base.answered.wall_ms))
assert.ok(Number.isFinite(base.answered.wall_ms) && base.answered.wall_ms >= 0,
  '(a) [M1] `wall_ms` is a finite, non-negative number of milliseconds. Got: ' +
  JSON.stringify(base.answered.wall_ms))

assert.ok(Array.isArray(base.answered.denials),
  '(a) [M1] the call answers `denials` as an array — empty on a run that denied nothing. Got: ' +
  JSON.stringify(base.answered.denials))
assert.deepStrictEqual(base.answered.denials, [],
  '(a) [M1] a run whose hook was never invoked answers an empty `denials`. Got: ' +
  JSON.stringify(base.answered.denials))

assert.equal(base.fake.calls[0] && base.fake.calls[0].prompt, PROMPT,
  '(a) [M1] the dispatch\'s `prompt` is the prompt `query()` is called with. Got: ' +
  JSON.stringify(base.fake.calls[0] && base.fake.calls[0].prompt))

/** The Context: "`onMessage`, when given, is called with every message the
 *  iterator yields, so the engine's supervisor reads the stream without a
 *  second consumer." */
assert.deepStrictEqual(base.seen, MESSAGES,
  '(a) [M1] `onMessage`, when given, is called with EVERY message the iterator yields, in order. Got ' +
  base.seen.length + ' message(s): ' + JSON.stringify(base.seen.map((m) => m && m.type)))

// ══════════════════════════════════════════════════════════════════════════
// (b) [M2] the options object the fake `query` received
// ══════════════════════════════════════════════════════════════════════════

const baseOptions = base.fake.calls[0] && base.fake.calls[0].options
assert.ok(baseOptions && typeof baseOptions === 'object',
  '(b) [M2] `query()` is called with an `options` object. Got: ' + JSON.stringify(base.fake.calls[0]))

assert.deepStrictEqual(baseOptions.settingSources, [],
  '(b) [M2] the options carry `settingSources` deep-equal to `[]` — CLAUDE.md, skills and ' +
  'project hooks off. Got: ' + JSON.stringify(baseOptions.settingSources))

assert.equal(baseOptions.permissionMode, 'bypassPermissions',
  '(b) [M2] the options carry `permissionMode: \'bypassPermissions\'`. Got: ' +
  JSON.stringify(baseOptions.permissionMode))

assert.equal(baseOptions.cwd, CWD,
  '(b) [M2] the options carry the given `cwd`. Got: ' + JSON.stringify(baseOptions.cwd))

assert.equal(baseOptions.systemPrompt, SYSTEM_PROMPT,
  '(b) [M2] the options carry the given `systemPrompt`. Got: ' + JSON.stringify(baseOptions.systemPrompt))

assert.equal(baseOptions.model, MODEL,
  '(b) [M2] the options carry the given `model`. Got: ' + JSON.stringify(baseOptions.model))

assert.ok(Array.isArray(baseOptions.disallowedTools),
  '(b) [M2] the options carry a `disallowedTools` array. Got: ' +
  JSON.stringify(baseOptions.disallowedTools))
for (const tool of ['Bash(git *)', 'WebFetch', 'WebSearch', 'Agent']) {
  assert.ok(baseOptions.disallowedTools.includes(tool),
    '(b) [M2] `disallowedTools` contains ' + JSON.stringify(tool) +
    ' — models never run git, and the worker reaches no network tool. The list read: ' +
    JSON.stringify(baseOptions.disallowedTools))
}

// ══════════════════════════════════════════════════════════════════════════
// (c) [M2] `outputFormat` exactly when `schema` is given; `mcpServers` through
// ══════════════════════════════════════════════════════════════════════════

/** Called WITHOUT `schema`: the base dispatch above. */
assert.equal(Object.prototype.hasOwnProperty.call(baseOptions, 'outputFormat'), false,
  '(c) [M2] called without `schema` the options carry NO `outputFormat` — it is present ' +
  'EXACTLY when `schema` is given. Got: ' + JSON.stringify(baseOptions.outputFormat))

const schemaed = await dispatch({ schema: { type: 'object' } })
const schemaedOptions = schemaed.fake.calls[0].options
assert.deepStrictEqual(schemaedOptions.outputFormat, { type: 'json_schema', schema: { type: 'object' } },
  '(c) [M2] called with `schema: { type: \'object\' }` the options carry `outputFormat` deep-equal ' +
  'to `{ type: \'json_schema\', schema: { type: \'object\' } }`. Got: ' +
  JSON.stringify(schemaedOptions.outputFormat))

const served = await dispatch({ mcpServers: { factory: 'x' } })
const servedOptions = served.fake.calls[0].options
assert.deepStrictEqual(servedOptions.mcpServers, { factory: 'x' },
  '(c) [M2] called with `mcpServers: { factory: \'x\' }` the options carry that same object. Got: ' +
  JSON.stringify(servedOptions.mcpServers))

// ══════════════════════════════════════════════════════════════════════════
// (d) [M3] confinement as a function — the `PreToolUse` hook, invoked directly
//
// `denials` is read off the value the call ANSWERED: M3 says the hook "appends
// `{ tool, path }` to the `denials` the call answers on each deny", so the
// array below is the live one the hook writes into.
// ══════════════════════════════════════════════════════════════════════════

const confined = await dispatch()
const confinedOptions = confined.fake.calls[0].options
const denials = confined.answered.denials

assert.ok(confinedOptions.hooks && typeof confinedOptions.hooks === 'object',
  '(d) [M3] the options carry a `hooks` object. Got: ' + JSON.stringify(confinedOptions.hooks))
assert.ok(Array.isArray(confinedOptions.hooks.PreToolUse),
  '(d) [M3] the options carry `hooks.PreToolUse` as an array. Got: ' +
  JSON.stringify(confinedOptions.hooks.PreToolUse))
assert.equal(confinedOptions.hooks.PreToolUse.length, 1,
  '(d) [M3] the options carry ONE `hooks.PreToolUse` matcher. Got ' +
  confinedOptions.hooks.PreToolUse.length)
assert.ok(Array.isArray(confinedOptions.hooks.PreToolUse[0].hooks),
  '(d) [M3] `hooks.PreToolUse[0].hooks` is an array. Got: ' +
  JSON.stringify(confinedOptions.hooks.PreToolUse[0].hooks))
assert.equal(confinedOptions.hooks.PreToolUse[0].hooks.length, 1,
  '(d) [M3] ONE `hooks.PreToolUse` callback. Got ' + confinedOptions.hooks.PreToolUse[0].hooks.length)

const hook = confinedOptions.hooks.PreToolUse[0].hooks[0]
assert.equal(typeof hook, 'function',
  '(d) [M3] `hooks.PreToolUse[0].hooks[0]` is the callback. Got ' + JSON.stringify(typeof hook))

const OUTSIDE = path.join(CWD, 'outside.txt')
const INSIDE = path.join(CWD, 'inside.txt')
const ESCAPE = CWD + path.sep + '..' + path.sep + 'escape.txt'

/** Each of the four edit tools, on a path inside `cwd` but NOT in `files`. */
for (const tool of ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']) {
  const before = denials.length
  const answer = await withTimeout(
    hook({ tool_name: tool, tool_input: { file_path: OUTSIDE } }),
    'the PreToolUse hook on ' + tool)

  assert.ok(answer && answer.hookSpecificOutput,
    '(d) [M3] ' + tool + ' on a path not in `files` resolves a `hookSpecificOutput`. Got: ' +
    JSON.stringify(answer))
  assert.equal(answer.hookSpecificOutput.permissionDecision, 'deny',
    '(d) [M3] ' + tool + ' on `<cwd>/outside.txt`, with `files` of `[\'inside.txt\']`, resolves a ' +
    '`hookSpecificOutput.permissionDecision` of `\'deny\'`. Got: ' +
    JSON.stringify(answer.hookSpecificOutput.permissionDecision))
  assert.equal(answer.hookSpecificOutput.hookEventName, 'PreToolUse',
    '(d) [M3] the deny carries `hookEventName: \'PreToolUse\'`. Got: ' +
    JSON.stringify(answer.hookSpecificOutput.hookEventName))
  assert.equal(typeof answer.hookSpecificOutput.permissionDecisionReason, 'string',
    '(d) [M3] the deny carries a `permissionDecisionReason` string. Got: ' +
    JSON.stringify(answer.hookSpecificOutput.permissionDecisionReason))
  assert.ok(answer.hookSpecificOutput.permissionDecisionReason.length > 0,
    '(d) [M3] the deny\'s `permissionDecisionReason` is not empty. Got: ' +
    JSON.stringify(answer.hookSpecificOutput.permissionDecisionReason))

  assert.equal(denials.length, before + 1,
    '(d) [M3] the deny appends exactly one entry to the `denials` the call answers. Before ' +
    before + ', after ' + denials.length + ': ' + JSON.stringify(denials))
  assert.ok(containsEntry(denials, { tool, path: 'outside.txt' }),
    '(d) [M3] the call\'s `denials` afterwards contains `{ tool: ' + JSON.stringify(tool) +
    ', path: \'outside.txt\' }` — the path relative to `cwd`. The list read: ' + JSON.stringify(denials))
}

/** `Edit` on a path inside `cwd` AND in `files`: allowed. */
const allowed = await withTimeout(
  hook({ tool_name: 'Edit', tool_input: { file_path: INSIDE } }),
  'the PreToolUse hook on an allowed Edit')
assert.deepStrictEqual(allowed, {},
  '(d) [M3] `Edit` on `<cwd>/inside.txt`, which IS in `files`, resolves `{}`. Got: ' +
  JSON.stringify(allowed))

/** `Edit` on a `..` escape: outside `cwd`, so denied. */
const escaped = await withTimeout(
  hook({ tool_name: 'Edit', tool_input: { file_path: ESCAPE } }),
  'the PreToolUse hook on a `..` escape')
assert.ok(escaped && escaped.hookSpecificOutput,
  '(d) [M3] `Edit` on `<cwd>/../escape.txt` resolves a `hookSpecificOutput`. Got: ' +
  JSON.stringify(escaped))
assert.equal(escaped.hookSpecificOutput.permissionDecision, 'deny',
  '(d) [M3] `Edit` with `file_path` `<cwd>/../escape.txt` resolves `\'deny\'` — a relative path ' +
  'beginning `..` is outside `cwd`. Got: ' + JSON.stringify(escaped.hookSpecificOutput.permissionDecision))

/** The same escape, on the ONE dispatch where only the outside-`cwd` guard can
 *  decide it: `files` here LISTS `'../escape.txt'`, so the "not in `files`"
 *  disjunct of M3 is satisfied and the deny can come from nowhere but "outside
 *  `cwd`". Without this the leg's own `files` of `['inside.txt']` leaves M3's
 *  first disjunct — the Context's "treating anything that begins `..` as
 *  outside" — unproven, a hook with no `..` check at all passing leg (d) whole. */
const escapeListed = await dispatch({ files: ['inside.txt', '../escape.txt'] })
const escapeHook = escapeListed.fake.calls[0].options.hooks.PreToolUse[0].hooks[0]
const escapeListedAnswer = await withTimeout(
  escapeHook({ tool_name: 'Edit', tool_input: { file_path: ESCAPE } }),
  'the PreToolUse hook on a listed `..` escape')
assert.ok(escapeListedAnswer && escapeListedAnswer.hookSpecificOutput,
  '(d) [M3] `Edit` on `<cwd>/../escape.txt` resolves a `hookSpecificOutput` even when `files` ' +
  'lists that path — it is outside `cwd`. Got: ' + JSON.stringify(escapeListedAnswer))
assert.equal(escapeListedAnswer.hookSpecificOutput.permissionDecision, 'deny',
  '(d) [M3] the hook denies when the resolved `file_path` is OUTSIDE `cwd`, independently of ' +
  '`files`: `<cwd>/../escape.txt` with `files` of `[\'inside.txt\', \'../escape.txt\']` resolves ' +
  '`\'deny\'`. Got: ' + JSON.stringify(escapeListedAnswer.hookSpecificOutput.permissionDecision))

/** A tool that is not one of the four: untouched, and `denials` unchanged. */
const denialsBeforeRead = denials.length
const denialsSnapshot = JSON.stringify(denials)
const read = await withTimeout(
  hook({ tool_name: 'Read', tool_input: { file_path: OUTSIDE } }),
  'the PreToolUse hook on Read')
assert.deepStrictEqual(read, {},
  '(d) [M3] `tool_name: \'Read\'` on the outside path resolves `{}` — the hook decides only for ' +
  '`Edit`, `Write`, `MultiEdit` and `NotebookEdit`. Got: ' + JSON.stringify(read))
assert.equal(denials.length, denialsBeforeRead,
  '(d) [M3] a `Read` leaves `denials` unchanged. Before ' + denialsBeforeRead + ', after ' +
  denials.length)
assert.equal(JSON.stringify(denials), denialsSnapshot,
  '(d) [M3] a `Read` appends nothing to `denials`. Got: ' + JSON.stringify(denials))

// ══════════════════════════════════════════════════════════════════════════
// (e) [M4] `startWorker` answers a handle; `interruptWorker` calls it once
// ══════════════════════════════════════════════════════════════════════════

let openGate = null
const gate = new Promise((resolve) => { openGate = resolve })
const interruptible = makeFakeQuery({ interrupt: true, interruptResult: 'ok', gate })

const started = startWorker({
  cwd: CWD,
  prompt: PROMPT,
  systemPrompt: SYSTEM_PROMPT,
  model: MODEL,
  files: FILES,
}, { query: interruptible.fn })

assert.ok(started && typeof started === 'object',
  '(e) [M4] `startWorker(opts, deps)` answers an object. Got: ' + JSON.stringify(started))
assert.ok(started.promise && typeof started.promise.then === 'function',
  '(e) [M4] `startWorker` answers a `promise` beside the handle. Got: ' +
  JSON.stringify(typeof (started && started.promise)))

/** One tick, so an implementation that captures the handle in the body of an
 *  async run has reached its first `await`. */
await Promise.resolve()

assert.ok(started.handle !== undefined && started.handle !== null,
  '(e) [M4] `startWorker` answers the iterator object as `handle` beside the promise. Got: ' +
  JSON.stringify(started.handle))

assert.equal(interruptible.state.interruptCalls, 0,
  '(e) [M4] nothing has called `interrupt()` before `interruptWorker` does. Got ' +
  interruptible.state.interruptCalls + ' call(s)')

const interrupted = await withTimeout(interruptWorker(started.handle), 'interruptWorker to resolve')
assert.equal(interrupted, 'ok',
  '(e) [M4] `interruptWorker(handle)` resolves what the iterator\'s `interrupt()` resolves — here ' +
  '`\'ok\'`. Got: ' + JSON.stringify(interrupted))
assert.equal(interruptible.state.interruptCalls, 1,
  '(e) [M4] `interruptWorker` calls the iterator\'s `interrupt()` EXACTLY ONCE. Got ' +
  interruptible.state.interruptCalls + ' call(s)')

openGate()
const startedAnswer = await withTimeout(started.promise, 'the startWorker promise to resolve')
assert.deepStrictEqual(startedAnswer.result, RESULT_MESSAGE,
  '(e) [M4] the promise `startWorker` answers resolves the same `{ result, denials, turns, wall_ms }` ' +
  '`runWorker` does. Got: ' + JSON.stringify(startedAnswer.result))
assert.equal(startedAnswer.turns, 3,
  '(e) [M4] and its `turns` counts the three `assistant` messages. Got: ' +
  JSON.stringify(startedAnswer.turns))

// ══════════════════════════════════════════════════════════════════════════
// (f) [M5] the line count, and the dependency line
// ══════════════════════════════════════════════════════════════════════════

const workerSource = fs.readFileSync(WORKER_PATH, 'utf8')
/** `wc -l`'s own semantics: the number of newline characters in the file —
 *  the count the Proof's `Run:` line compares against 200. */
const lineCount = (workerSource.match(/\n/g) || []).length
assert.ok(lineCount <= 200,
  '(f) [M5] `factory/worker.mjs` is 200 lines or fewer — the Proof\'s ' +
  '`test $(wc -l < factory/worker.mjs) -le 200`. Got ' + lineCount + ' lines')

const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8'))
assert.ok(pkg.dependencies && typeof pkg.dependencies === 'object',
  '(f) [M5] `fleet/package.json` has a `dependencies` object. Got: ' + JSON.stringify(pkg.dependencies))
const dep = pkg.dependencies['@anthropic-ai/claude-agent-sdk']
assert.equal(typeof dep, 'string',
  '(f) [M5] `fleet/package.json` lists `@anthropic-ai/claude-agent-sdk` under `dependencies`. Got: ' +
  JSON.stringify(dep))
assert.ok(dep.length > 0,
  '(f) [M5] the `@anthropic-ai/claude-agent-sdk` dependency is a non-empty string. Got: ' +
  JSON.stringify(dep))

fs.rmSync(CWD, { recursive: true, force: true })

console.log('ALL TESTS PASSED')
