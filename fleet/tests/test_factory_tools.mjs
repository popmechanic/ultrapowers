/**
 * fleet/tests/test_factory_tools.mjs — the exam for *a fifth tool on the
 * worker's own MCP server*: a worker stuck mid-task can call `task_facts` and
 * get back the same facts `board.factsFor` would hand the next worker, the
 * `note` tool's comment now carries a `[note]` line so that fact exists to
 * read, and the server `factoryTools` returns is still exactly
 * `createSdkMcpServer`'s own config.
 *
 * This file is the Proof's `Test: fleet/tests/test_factory_tools.mjs`, written
 * where the Proof names it. The relative import is written for THIS
 * directory: `../../` is the repository root, so `factory/tools.mjs` is
 * `../../factory/tools.mjs`.
 *
 * The Machine clauses under test, restated:
 *
 *   M1 — `factoryTools({ kata, projectId, task, candidates, board })`
 *        registers a fifth tool named `task_facts`, taking no arguments,
 *        whose handler resolves one text content block carrying
 *        `board.factsFor(task.id)`, or the text `no facts yet` when that is
 *        the empty string or `board` is absent.
 *   M2 — the `note` tool's comment body begins with the line `[note]`, so a
 *        worker's note is a fact `factsFor` renders.
 *   M3 — the returned value is still `createSdkMcpServer`'s config named
 *        `factory` whose enumerable keys are exactly `type`, `name`,
 *        `instance`.
 *
 * The Proof legs, in the Proof's own order, and where each is answered below:
 *
 *   (a) [M1] the registered tool names are exactly `note`, `hand`, `settled`,
 *            `sibling_fact`, `task_facts`; invoking `task_facts` with a fake
 *            `board.factsFor` resolving `[landing]\nb` answers a text block
 *            equal to that string and called `factsFor` with the task's id;
 *            resolving `''` answers `no facts yet`; with no `board` it
 *            answers `no facts yet`
 *   (b) [M2] invoking `note` with body `hello` calls the fake `kata.comment`
 *            once with a body exactly `[note]\nhello`
 *   (c) [M3] `Object.keys` of the returned config is exactly
 *            `['type', 'name', 'instance']` and `name` is `factory`
 *
 * ── the readings this exam is written on ────────────────────────────────────
 *
 *   • "TAKING NO ARGUMENTS" (M1) is asked two ways: `task_facts`'s own
 *     `inputSchema` shape has no fields, and its handler is invoked with a
 *     bare empty object across every leg below (and once with no argument at
 *     all) rather than a fixture of dummy input it would have to ignore.
 *   • THE TEXT CONTENT BLOCK is the shape every other handler in this file
 *     already answers — `{ content: [{ type: 'text', text }] }` — so a leg
 *     checks the WHOLE returned value against that shape by deep equality,
 *     not just its `text` field, the same way the rest of this exam holds
 *     exact shapes rather than substrings.
 *   • `board.factsFor`'s CALL ARGUMENT is checked against `task.id` — the
 *     Machine clause names `task.id` specifically, not `task.uid` or the
 *     whole `task` object, and this exam's fixture `task` carries a `uid`
 *     distinct from its `id` so a handler that passed the wrong one would be
 *     caught.
 *   • M2 names no positional argument index for `kata.comment`, only that ONE
 *     of the call's arguments is the body; this exam reads the LAST argument
 *     of the one recorded call, matching the body's position in this file's
 *     own existing `kata.comment(projectId, uid, body)` call, which M2 does
 *     not ask to change.
 *   • M3's key set is checked by SORTED deep equality — the clause fixes the
 *     set of keys, not their enumeration order — alongside a direct check
 *     that `name` is `factory`.
 *   • `candidates` IS EMPTY and `board` IS A PLAIN FAKE carrying only
 *     `factsFor`, per the Context: `factoryTools` uses nothing else off it.
 *   • THIS FILE STARTS NO PROCESS and calls no tool but `note` and
 *     `task_facts` directly through the returned config's non-enumerable
 *     `handlers`, per the Context's run-185 amendment.
 *
 * WHY THIS IS RED AT BASE. `factory/tools.mjs` does not yet destructure
 * `board`, register a `task_facts` tool, or prefix a note's body with
 * `[note]`: the tool-name leg finds four names instead of five, the
 * `task_facts` legs find no such handler at all, and the `note` leg finds a
 * bare `hello` where `[note]\nhello` is asked for — each a clause unmet, not
 * a typo or a missing fixture.
 */
import assert from 'node:assert/strict'

/** A value, cut for an assertion message. */
const show = (value) => {
  const text = typeof value === 'string' ? JSON.stringify(value) : JSON.stringify(value ?? null)
  return text && text.length > 600 ? text.slice(0, 600) + '…' : text
}

// ── the deliverable ─────────────────────────────────────────────────────────
let mod = null
let importError = null
try {
  mod = await import('../../factory/tools.mjs')
} catch (error) {
  importError = error
}

assert.equal(importError, null,
  '`factory/tools.mjs` must exist and export `factoryTools` — importing it failed: ' +
  String(importError && importError.message ? importError.message : importError))

const { factoryTools } = mod
assert.equal(typeof factoryTools, 'function',
  '`factory/tools.mjs` exports `factoryTools` as a function, got ' + typeof factoryTools)

// ── the fixtures every leg shares ────────────────────────────────────────────

/** The task fact sheet `factoryTools` closes over — `id` distinct from `uid`. */
const TASK = { id: 'task-42', uid: 'issue-uid-9001' }
const PROJECT_ID = 'proj-landing'

/** A fake `kata` recording every `comment` call's own arguments, in order. */
const fakeKata = () => {
  const commentCalls = []
  return {
    commentCalls,
    comment: async (...args) => { commentCalls.push(args); return 'comment-uid' },
    patchMetadata: async () => ({}),
    getIssue: async () => ({ metadata: {} }),
  }
}

/** A `factoryTools` config sharing the task fixtures, `kata` and `board` swappable. */
const config = (extra = {}) => ({
  kata: fakeKata(),
  projectId: PROJECT_ID,
  task: TASK,
  candidates: [],
  ...extra,
})

// ── (a) [M1] the five tool names, and `task_facts`'s own no-argument schema ──

{
  const server = factoryTools(config({ board: { factsFor: async () => '' } }))
  const names = server.tools.map((t) => t.name).slice().sort()
  const expected = ['note', 'hand', 'settled', 'sibling_fact', 'task_facts'].slice().sort()
  assert.deepEqual(names, expected,
    '(a)/M1: the registered tool names are exactly `note`, `hand`, `settled`, `sibling_fact`, ' +
    '`task_facts`: ' + show(names))

  const taskFacts = server.tools.find((t) => t.name === 'task_facts')
  assert.ok(taskFacts, '(a)/M1: a `task_facts` tool is registered')
  assert.deepEqual(Object.keys(taskFacts.inputSchema.shape ?? taskFacts.inputSchema ?? {}), [],
    '(a)/M1: `task_facts` takes no arguments — its input schema has no fields: ' +
    show(taskFacts.inputSchema))
  assert.equal(typeof server.handlers.task_facts, 'function',
    '(a)/M1: a `task_facts` handler is reachable off the returned config\'s non-enumerable ' +
    '`handlers`')
}

// ── (a) [M1] `task_facts` resolving a non-empty string ───────────────────────

{
  const calls = []
  const board = { factsFor: async (taskId) => { calls.push(taskId); return '[landing]\nb' } }
  const server = factoryTools(config({ board }))

  const result = await server.handlers.task_facts()
  assert.deepEqual(result, { content: [{ type: 'text', text: '[landing]\nb' }] },
    '(a)/M1: `task_facts`, invoked with no argument, resolves one text content block equal to ' +
    '`board.factsFor(task.id)`\'s answer: ' + show(result))
  assert.deepEqual(calls, [TASK.id],
    '(a)/M1: `task_facts` called `board.factsFor` with the task\'s id, `' + TASK.id + '`, not ' +
    'its `uid` or the whole task: ' + show(calls))
}

// ── (a) [M1] `task_facts` resolving the empty string ─────────────────────────

{
  const board = { factsFor: async () => '' }
  const server = factoryTools(config({ board }))
  const result = await server.handlers.task_facts({})
  assert.deepEqual(result, { content: [{ type: 'text', text: 'no facts yet' }] },
    '(a)/M1: `board.factsFor` resolving the empty string renders `no facts yet`: ' + show(result))
}

// ── (a) [M1] `task_facts` with no `board` at all ─────────────────────────────

{
  const server = factoryTools(config())
  assert.equal('board' in config(), false,
    '(a)/M1: the fixture carries no `board` key at all for this leg')
  const result = await server.handlers.task_facts({})
  assert.deepEqual(result, { content: [{ type: 'text', text: 'no facts yet' }] },
    '(a)/M1: with no `board`, `task_facts` renders `no facts yet`: ' + show(result))
}

// ── (b) [M2] `note`'s comment body begins with the line `[note]` ────────────

{
  const kata = fakeKata()
  const server = factoryTools(config({ kata, board: { factsFor: async () => '' } }))

  await server.handlers.note({ body: 'hello' })

  assert.equal(kata.commentCalls.length, 1,
    '(b)/M2: invoking `note` with body `hello` calls the fake `kata.comment` exactly once: got ' +
    kata.commentCalls.length + ' calls: ' + show(kata.commentCalls))

  const args = kata.commentCalls[0]
  const body = args[args.length - 1]
  assert.equal(body, '[note]\nhello',
    '(b)/M2: the `note` tool\'s comment body begins with the line `[note]` — the body passed to ' +
    '`kata.comment` is exactly `[note]\\nhello`: ' + show(body))
}

// ── (c) [M3] the returned config's own enumerable keys ───────────────────────

{
  const server = factoryTools(config({ board: { factsFor: async () => '' } }))
  const keys = Object.keys(server).slice().sort()
  assert.deepEqual(keys, ['instance', 'name', 'type'].slice().sort(),
    '(c)/M3: `Object.keys` of the returned config is exactly `type`, `name`, `instance`: ' +
    show(keys))
  assert.equal(server.name, 'factory',
    '(c)/M3: the config\'s `name` is `factory`: ' + show(server.name))
}

console.log('ALL TESTS PASSED')
