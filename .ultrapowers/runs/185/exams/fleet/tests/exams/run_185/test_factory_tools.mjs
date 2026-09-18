/**
 * fleet/tests/exams/run_185/test_factory_tools.mjs — the exam for Task 3: *the
 * tools — kata in the worker's hands, in process, selecting never generating*.
 *
 * This file is the Proof's `Test: fleet/tests/test_factory_tools.mjs`, written
 * where this run's `EXAM PATHS` line lands it. Every relative path below is
 * written for THIS directory: `../../../../` is the repository root, so the
 * deliverable is `../../../../factory/tools.mjs`.
 *
 * The Machine clauses under test, restated:
 *
 *   M1 — `factoryTools({ kata, projectId, task, candidates })` returns the
 *        value of `createSdkMcpServer({ name: 'factory', tools })`, where
 *        `tools` are four `tool()` definitions named `note`, `hand`, `settled`
 *        and `sibling_fact`, and the returned config's `name` is `'factory'`.
 *   M2 — `note({ body })` calls `kata.comment(projectId, task.uid, body)` once
 *        and answers a text content block naming the comment's uid;
 *        `hand({ reason })` calls `kata.patchMetadata(projectId, task.uid,
 *        { 'work.attention': 'needs-human', 'work.attention_msg': reason })`
 *        once.
 *   M3 — `settled({ symbol, file })` with a `symbol` in `candidates` calls
 *        `kata.patchMetadata(projectId, task.uid, { 'interface.settled':
 *        <JSON string of { symbol, file, task: task.id }> })` once and answers
 *        a text block containing `settled`; with a `symbol` not in `candidates`
 *        it makes no kata call and answers a text block containing `not among`
 *        and every candidate name.
 *   M4 — `sibling_fact({ task_uid })` calls `kata.getIssue(task_uid)` once and
 *        answers a text block carrying that issue's `metadata` as JSON, and
 *        when `kata.getIssue` rejects it answers a text block beginning
 *        `no fact:` and does not reject.
 *   M5 — `factory/tools.mjs` is 200 lines or fewer.
 *
 * The Proof legs, in the Proof's own order, and where each is answered below:
 *
 *   (a) [M1] `factoryTools({ kata: <recording fake>, projectId: 'p',
 *            task: { id: '1', uid: 'u', files: [] }, candidates: ['catalog'] })`
 *            answers an object whose `name` is `'factory'` and whose `instance`
 *            lists tools named exactly `note`, `hand`, `settled`,
 *            `sibling_fact`
 *   (b) [M2] invoking `note` with `{ body: 'hi' }` makes exactly one
 *            `kata.comment('p', 'u', 'hi')` call and answers a text block
 *            containing the uid the fake returned; invoking `hand` with
 *            `{ reason: 'stuck on x' }` makes exactly one `kata.patchMetadata`
 *            call whose patch is deep-equal to `{ 'work.attention':
 *            'needs-human', 'work.attention_msg': 'stuck on x' }`
 *   (c) [M3] invoking `settled` with `{ symbol: 'catalog', file: 'w/c.py' }`
 *            makes one `patchMetadata` call whose patch has key
 *            `interface.settled` whose JSON-parsed value is deep-equal to
 *            `{ symbol: 'catalog', file: 'w/c.py', task: '1' }` and answers a
 *            text block containing `settled`; invoking it with
 *            `{ symbol: 'nope', file: 'x' }` makes no kata call and answers a
 *            text block containing `not among` and `catalog`
 *   (d) [M4] invoking `sibling_fact` with `{ task_uid: 's' }` makes one
 *            `kata.getIssue('s')` call and answers a text block whose
 *            JSON-parsed content is deep-equal to the fake issue's `metadata`;
 *            with the fake rejecting, it answers a text block beginning
 *            `no fact:` and the invocation resolves rather than rejects
 *   (e) [M5] the line count of `factory/tools.mjs` is at most 200
 *
 * Beside the legs, the clause text each leg leaves unasked is asked once, under
 * the clause it comes from and never under a leg's name: M1's "returns the
 * VALUE of `createSdkMcpServer`" (the config's own `type`), M2's "a TEXT
 * content block" for both tools, M3's "every candidate name" where there is
 * more than one, and M3's "<JSON STRING of>" for the `interface.settled` value.
 *
 * ── the readings this exam is written on ────────────────────────────────────
 *
 *   • THE FOUR TOOLS ARE REACHED THROUGH THE INSTANCE, which is the first of
 *     the two readings leg (a) offers ("read through the instance's registered
 *     tool list, or by invoking the config's tool handlers exported for the
 *     exam"). It is taken because it needs no export beyond the one
 *     `Produces:` names, so the exam grades the contract rather than a
 *     particular file's extra surface. Measured against
 *     `@anthropic-ai/claude-agent-sdk` 0.3.275: `createSdkMcpServer` answers
 *     `{ type: 'sdk', name, instance }`, and the instance's `_registeredTools`
 *     is a name → definition map whose entries carry the function `tool()` was
 *     handed, under `handler`, and calling it with `(args, extra)` answers what
 *     that function returned, verbatim. `toolsOf` below reads that map and
 *     tolerates two spellings of each half — `registeredTools` for the map and
 *     `callback` for the entry, the older MCP names — so an SDK version bump is
 *     not mistaken for a missing tool.
 *   • THIS FILE IMPORTS THE SDK NOWHERE. Whether `factory/` resolves
 *     `@anthropic-ai/claude-agent-sdk` by walking up to `fleet/node_modules` or
 *     by spelling the path is the implementer's choice, and an exam that
 *     imported the package itself would grade its own resolution too.
 *   • `factoryTools` IS CALLED SYNCHRONOUSLY. `Produces:` is
 *     `-> McpSdkServerConfigWithInstance`, not a promise of one, so an
 *     implementation that answered a promise fails leg (a) on `name` rather
 *     than being quietly awaited into passing. The four HANDLERS are awaited,
 *     because M2–M4 are calls into an async kata client.
 *   • `patchMetadata` IS PINNED ON THREE ARGUMENTS, not on its arity. Legs (b)
 *     and (c) say "whose patch is deep-equal to" and "whose patch has key",
 *     and the client's signature is `patchMetadata(projectId, uid, patch,
 *     revision)` with the revision optional; pinning a fourth argument either
 *     way would grade a choice the Proof does not make. What IS pinned is that
 *     the patch object itself deep-equals the two dotted keys flat — a nested
 *     `{ work: { attention: … } }` fails that equality, which is how
 *     CONTRACT.md's `metadata-dotted-flat` row is held live here.
 *   • "EVERY CANDIDATE NAME" IS ASKED WHERE THERE IS MORE THAN ONE. Leg (c)
 *     spells a single candidate, `catalog`, and is written with exactly that;
 *     M3's plural is asked once more below, under the clause's own name, with
 *     three candidates, so the word is measured without reshaping the leg.
 *   • LEG (e) COUNTS NEWLINES, which is exactly what the Proof's
 *     `Run: test $(wc -l < factory/tools.mjs) -le 200` counts — a file whose
 *     last line carries no newline is one `wc -l` does not count, and this exam
 *     agrees with the Run rather than with a split-and-subtract of its own.
 *   • THIS FILE SPAWNS NOTHING, opens no network, writes no path, and reads
 *     exactly one file from disk: `factory/tools.mjs`, for leg (e). The kata
 *     client is a recording fake built here; nothing below reaches a hub.
 *   • THE IMPORT IS DYNAMIC so a tree without the module reports the first
 *     assertion below rather than dying at load with a resolution error.
 *
 * WHY THIS IS RED AT BASE. `factory/tools.mjs` does not exist, so the dynamic
 * import fails and the first assertion names it as the absent deliverable.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * A value, cut for an assertion message. JavaScript builds an assertion's
 * message EAGERLY — the string is computed whether or not the assertion holds —
 * so this is total over every value the exam hands it: functions are named
 * rather than dropped, a repeat of an object already visited is `[circular]`
 * (the SDK's server config carries a whole MCP server, whose object graph has
 * cycles), and anything `JSON.stringify` still refuses falls back to `String`.
 */
const show = (value) => {
  const seen = new WeakSet()
  const replacer = (key, item) => {
    if (typeof item === 'function') return '[function]'
    if (item && typeof item === 'object') {
      if (seen.has(item)) return '[circular]'
      seen.add(item)
    }
    return item
  }
  let text
  try {
    text = typeof value === 'string'
      ? JSON.stringify(value)
      : JSON.stringify(value ?? null, replacer)
  } catch {
    text = undefined
  }
  if (typeof text !== 'string') text = String(value)
  return text.length > 600 ? text.slice(0, 600) + '…' : text
}

/** An object named by its own keys rather than dumped — the SDK's `instance` is
 *  an entire MCP server, and no assertion message wants it spelled out. */
const brief = (value) =>
  (value && typeof value === 'object') ? '{' + Object.keys(value).join(', ') + '}' : show(value)

/** The repository root, from THIS file's landing directory. */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
/** The deliverable, as a path (leg (e)) and as a specifier (every other leg). */
const TOOLS_PATH = path.join(ROOT, 'factory', 'tools.mjs')

// ── the deliverable ─────────────────────────────────────────────────────────

let mod = null
let importError = null
try {
  mod = await import('../../../../factory/tools.mjs')
} catch (error) {
  importError = error
}

assert.equal(importError, null,
  '(a)/M1: `factory/tools.mjs` must exist and export `factoryTools` — importing it failed: ' +
  String(importError && importError.message ? importError.message : importError))

const { factoryTools } = mod

assert.equal(typeof factoryTools, 'function',
  '(a)/M1: `factory/tools.mjs` exports `factoryTools` as a function, got ' + typeof factoryTools)

// ── the literals the Machine clauses and the Proof legs spell, spelled once ──

/** The `task` leg (a) hands in, `{ id, uid, files }` as the Context spells it. */
const TASK = { id: '1', uid: 'u', files: [] }
/** The `projectId` leg (a) hands in. */
const PROJECT = 'p'
/** The `candidates` leg (a) hands in. */
const CANDIDATES = ['catalog']
/** The four tool names M1 spells, sorted, for leg (a)'s equality. */
const TOOL_NAMES = ['hand', 'note', 'settled', 'sibling_fact']
/** The comment uid the fake answers — what M2 says `note`'s text must name. */
const COMMENT_UID = 'kc-9f3c22e1'
/** The sibling issue `sibling_fact` reads. Its `metadata` is what M4 says the
 *  answer carries as JSON — dotted and flat, as kata stores it. */
const SIBLING_ISSUE = {
  uid: 's',
  revision: 4,
  status: 'open',
  project_id: 'p',
  metadata: {
    'interface.settled': '{"symbol":"ledger","file":"w/l.py","task":"2"}',
    'work.attention': 'ok',
    'task.role': 'implement',
  },
}

/** The second argument an MCP tool handler is called with — the request's
 *  `extra`. A `factory` tool needs nothing from it; one is passed because the
 *  SDK passes one. */
const extra = () => ({ signal: new AbortController().signal })

/**
 * The kata client, recording. Every method answers what `fleet/kata-client.mjs`
 * answers — a mutation's projection for the three mutations, `getIssue`'s for
 * the read — and pushes `{ method, args }` onto `calls`, which is what the
 * "exactly one call" of M2, M3 and M4 is counted from.
 */
const recordingKata = ({ getIssueRejects = false } = {}) => {
  const calls = []
  return {
    calls,
    comment: async (projectId, uid, body) => {
      calls.push({ method: 'comment', args: [projectId, uid, body] })
      return { uid: COMMENT_UID, revision: 2, short_id: 'ab12', project_id: projectId }
    },
    patchMetadata: async (projectId, uid, patch, revision) => {
      calls.push({ method: 'patchMetadata', args: [projectId, uid, patch, revision] })
      return { uid, revision: 3, short_id: 'ab12', project_id: projectId }
    },
    getIssue: async (uid) => {
      calls.push({ method: 'getIssue', args: [uid] })
      if (getIssueRejects) throw new Error('kata: GET /api/v1/issues/' + uid + ' answered 404')
      return SIBLING_ISSUE
    },
    addLabel: async (projectId, uid, label) => {
      calls.push({ method: 'addLabel', args: [projectId, uid, label] })
      return { uid, revision: 3, short_id: 'ab12', project_id: projectId }
    },
  }
}

/**
 * The four handlers of one `factory` server, by name — leg (a)'s first reading,
 * "the instance's registered tool list". The map and the entry each have two
 * spellings across MCP server versions; both are read, so a version bump is not
 * read as a missing tool.
 */
const toolsOf = (config, where) => {
  const instance = config && config.instance
  assert.ok(instance && typeof instance === 'object',
    where + ': the config carries the SDK server under `instance`, got ' + brief(instance))
  const registry = instance._registeredTools ?? instance.registeredTools
  assert.ok(registry && typeof registry === 'object',
    where + ': the SDK server lists its registered tools — neither `_registeredTools` nor ' +
    '`registeredTools` is an object on the instance, so no tool list could be read: ' +
    show(Object.keys(instance)))
  const handlers = new Map()
  for (const [name, def] of Object.entries(registry)) {
    handlers.set(name, def && (def.handler ?? def.callback))
  }
  return handlers
}

/** One handler, by name, asserted callable before it is invoked. */
const handlerFor = (handlers, name, where) => {
  const handler = handlers.get(name)
  assert.equal(typeof handler, 'function',
    where + ': the tool `' + name + '` is registered with a callable handler, got ' +
    typeof handler + ' (registered: ' + show([...handlers.keys()]) + ')')
  return handler
}

/** A fresh server over a fresh fake — every case counts its own calls. */
const serverFor = (kata, candidates = CANDIDATES) =>
  factoryTools({ kata, projectId: PROJECT, task: { ...TASK }, candidates })

/** The text of a handler's answer, with the `{content: [{type: 'text', …}]}`
 *  shape the Context spells asserted on the way through. */
const textOf = (answer, where) => {
  assert.ok(answer && typeof answer === 'object',
    where + ': a handler answers an object, got ' + show(answer))
  assert.ok(Array.isArray(answer.content) && answer.content.length >= 1,
    where + ': a handler answers `{content: [...]}` with at least one block, got ' +
    show(answer))
  const block = answer.content[0]
  assert.equal(block && block.type, 'text',
    where + ': the answer\'s first content block is a TEXT block, got ' + show(block))
  assert.equal(typeof block.text, 'string',
    where + ': the text block\'s `text` is a string, got ' + show(block))
  return block.text
}

// ── (a) [M1] the config's name, and the four tools on its instance ──────────

{
  const kata = recordingKata()
  const config = serverFor(kata)

  assert.ok(config && typeof config === 'object',
    '(a)/M1: `factoryTools({kata, projectId, task, candidates})` answers an object — the value ' +
    'of `createSdkMcpServer` — got ' + brief(config))

  assert.equal(config.name, 'factory',
    '(a)/M1: the returned config\'s `name` is `factory`, got ' + show(config.name))

  const handlers = toolsOf(config, '(a)/M1')

  assert.deepEqual([...handlers.keys()].sort(), TOOL_NAMES,
    '(a)/M1: the instance lists tools named exactly `note`, `hand`, `settled` and ' +
    '`sibling_fact` — no more and no fewer — got ' + show([...handlers.keys()].sort()))

  for (const name of TOOL_NAMES) handlerFor(handlers, name, '(a)/M1')

  assert.equal(kata.calls.length, 0,
    '(a)/M1: building the server calls no kata method — a tool acts when it is invoked, not ' +
    'when it is registered: ' + show(kata.calls))
}

// ── [M1] the return is `createSdkMcpServer`'s own value, not a shape like it ─

{
  const config = serverFor(recordingKata())
  assert.equal(config.type, 'sdk',
    '[M1]: the return is the VALUE of `createSdkMcpServer({name: \'factory\', tools})`, whose ' +
    'config carries `type: \'sdk\'`; got ' + show(config.type) + ' — a hand-built object ' +
    'standing in for the SDK\'s would not be that value')
}

// ── (b) [M2] `note` comments once, and names the comment's uid ──────────────

{
  const kata = recordingKata()
  const note = handlerFor(toolsOf(serverFor(kata), '(b)/M2'), 'note', '(b)/M2')

  const answer = await note({ body: 'hi' }, extra())

  assert.equal(kata.calls.length, 1,
    '(b)/M2: invoking `note` makes EXACTLY ONE kata call, got ' + show(kata.calls))
  assert.equal(kata.calls[0].method, 'comment',
    '(b)/M2: that one call is `kata.comment`, got ' + show(kata.calls[0].method))
  assert.deepEqual(kata.calls[0].args, [PROJECT, TASK.uid, 'hi'],
    '(b)/M2: `note({body: \'hi\'})` calls `kata.comment(projectId, task.uid, body)` — ' +
    '`kata.comment(\'p\', \'u\', \'hi\')` — got ' + show(kata.calls[0].args))

  const text = textOf(answer, '(b)/M2')
  assert.ok(text.includes(COMMENT_UID),
    '(b)/M2: `note` answers a text block NAMING the comment\'s uid — the `' + COMMENT_UID +
    '` the fake `kata.comment` returned — got ' + show(text))
}

// ── (b) [M2] `hand` patches once, with the two dotted keys flat ─────────────

{
  const kata = recordingKata()
  const hand = handlerFor(toolsOf(serverFor(kata), '(b)/M2'), 'hand', '(b)/M2')

  const answer = await hand({ reason: 'stuck on x' }, extra())

  assert.equal(kata.calls.length, 1,
    '(b)/M2: invoking `hand` makes EXACTLY ONE kata call, got ' + show(kata.calls))
  assert.equal(kata.calls[0].method, 'patchMetadata',
    '(b)/M2: that one call is `kata.patchMetadata`, got ' + show(kata.calls[0].method))

  const [projectId, uid, patch] = kata.calls[0].args
  assert.equal(projectId, PROJECT,
    '(b)/M2: `hand` patches under `projectId` — `p` — got ' + show(projectId))
  assert.equal(uid, TASK.uid,
    '(b)/M2: `hand` patches `task.uid` — `u` — got ' + show(uid))
  assert.deepEqual(patch, { 'work.attention': 'needs-human', 'work.attention_msg': 'stuck on x' },
    '(b)/M2: `hand({reason: \'stuck on x\'})` patches exactly `{\'work.attention\': ' +
    '\'needs-human\', \'work.attention_msg\': \'stuck on x\'}` — the keys dotted and FLAT, ' +
    'never nested — got ' + show(patch))

  textOf(answer, '(b)/M2 (`hand`)')
}

// ── (c) [M3] `settled` on a candidate: one patch, the JSON string, the word ──

{
  const kata = recordingKata()
  const settled = handlerFor(toolsOf(serverFor(kata), '(c)/M3'), 'settled', '(c)/M3')

  const answer = await settled({ symbol: 'catalog', file: 'w/c.py' }, extra())

  assert.equal(kata.calls.length, 1,
    '(c)/M3: `settled` on a symbol in `candidates` makes EXACTLY ONE kata call, got ' +
    show(kata.calls))
  assert.equal(kata.calls[0].method, 'patchMetadata',
    '(c)/M3: that one call is `kata.patchMetadata`, got ' + show(kata.calls[0].method))

  const [projectId, uid, patch] = kata.calls[0].args
  assert.equal(projectId, PROJECT,
    '(c)/M3: `settled` patches under `projectId` — `p` — got ' + show(projectId))
  assert.equal(uid, TASK.uid,
    '(c)/M3: `settled` patches `task.uid` — `u` — got ' + show(uid))
  assert.deepEqual(Object.keys(patch ?? {}), ['interface.settled'],
    '(c)/M3: the patch\'s keys are exactly `[\'interface.settled\']` — dotted and flat — got ' +
    show(Object.keys(patch ?? {})))

  const raw = patch['interface.settled']
  assert.equal(typeof raw, 'string',
    '[M3]: `interface.settled` is written as a JSON STRING value, not as an object — got ' +
    typeof raw + ': ' + show(raw))

  let parsed = null
  let parseError = null
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    parseError = error
  }
  assert.equal(parseError, null,
    '(c)/M3: `interface.settled`\'s value parses as JSON — ' + show(raw) + ' did not: ' +
    String(parseError && parseError.message ? parseError.message : parseError))
  assert.deepEqual(parsed, { symbol: 'catalog', file: 'w/c.py', task: '1' },
    '(c)/M3: the JSON-parsed value is deep-equal to `{symbol: \'catalog\', file: \'w/c.py\', ' +
    'task: \'1\'}` — `task` is `task.id`, not `task.uid` — got ' + show(parsed))

  const text = textOf(answer, '(c)/M3')
  assert.ok(text.includes('settled'),
    '(c)/M3: `settled` answers a text block containing `settled`, got ' + show(text))
}

// ── (c) [M3] `settled` on a symbol that is not a candidate: refused, silent ──

{
  const kata = recordingKata()
  const settled = handlerFor(toolsOf(serverFor(kata), '(c)/M3'), 'settled', '(c)/M3')

  const answer = await settled({ symbol: 'nope', file: 'x' }, extra())

  assert.deepEqual(kata.calls, [],
    '(c)/M3: `settled` on a symbol NOT in `candidates` makes NO kata call — the export it did ' +
    'not actually add is refused, not recorded — got ' + show(kata.calls))

  const text = textOf(answer, '(c)/M3')
  assert.ok(text.includes('not among'),
    '(c)/M3: the refusal answers a text block containing `not among`, got ' + show(text))
  assert.ok(text.includes('catalog'),
    '(c)/M3: the refusal names the candidate `catalog`, got ' + show(text))
}

// ── [M3] the refusal names EVERY candidate, where there is more than one ────

{
  const candidates = ['catalog', 'ledger', 'index_rows']
  const kata = recordingKata()
  const settled = handlerFor(toolsOf(serverFor(kata, candidates), '[M3]'), 'settled', '[M3]')

  const text = textOf(await settled({ symbol: 'nope', file: 'x' }, extra()), '[M3]')

  assert.deepEqual(kata.calls, [],
    '[M3]: a refusal makes no kata call whatever the candidate list, got ' + show(kata.calls))
  assert.ok(text.includes('not among'),
    '[M3]: the refusal contains `not among`, got ' + show(text))
  for (const name of candidates) {
    assert.ok(text.includes(name),
      '[M3]: the refusal names EVERY candidate — `' + name + '` is missing from ' + show(text))
  }
}

// ── (d) [M4] `sibling_fact` reads the issue and answers its metadata as JSON ─

{
  const kata = recordingKata()
  const siblingFact = handlerFor(toolsOf(serverFor(kata), '(d)/M4'), 'sibling_fact', '(d)/M4')

  const answer = await siblingFact({ task_uid: 's' }, extra())

  assert.equal(kata.calls.length, 1,
    '(d)/M4: invoking `sibling_fact` makes EXACTLY ONE kata call, got ' + show(kata.calls))
  assert.equal(kata.calls[0].method, 'getIssue',
    '(d)/M4: that one call is `kata.getIssue`, got ' + show(kata.calls[0].method))
  assert.deepEqual(kata.calls[0].args, ['s'],
    '(d)/M4: `sibling_fact({task_uid: \'s\'})` calls `kata.getIssue(\'s\')`, got ' +
    show(kata.calls[0].args))

  const text = textOf(answer, '(d)/M4')
  let parsed = null
  let parseError = null
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    parseError = error
  }
  assert.equal(parseError, null,
    '(d)/M4: `sibling_fact` answers a text block carrying the issue\'s `metadata` AS JSON — ' +
    show(text) + ' did not parse: ' +
    String(parseError && parseError.message ? parseError.message : parseError))
  assert.deepEqual(parsed, SIBLING_ISSUE.metadata,
    '(d)/M4: the JSON-parsed content is deep-equal to the fake issue\'s `metadata` — the ' +
    'issue\'s metadata and nothing else — got ' + show(parsed))
}

// ── (d) [M4] a rejecting `getIssue` answers `no fact:` and does not reject ───

{
  const kata = recordingKata({ getIssueRejects: true })
  const siblingFact = handlerFor(toolsOf(serverFor(kata), '(d)/M4'), 'sibling_fact', '(d)/M4')

  let answer = null
  let thrown = null
  try {
    answer = await siblingFact({ task_uid: 's' }, extra())
  } catch (error) {
    thrown = error
  }

  assert.equal(thrown, null,
    '(d)/M4: with `kata.getIssue` rejecting, the invocation RESOLVES rather than rejects — it ' +
    'threw: ' + String(thrown && thrown.message ? thrown.message : thrown))

  const text = textOf(answer, '(d)/M4')
  assert.ok(text.startsWith('no fact:'),
    '(d)/M4: with `kata.getIssue` rejecting, the text block BEGINS `no fact:`, got ' +
    show(text))
}

// ── (e) [M5] `factory/tools.mjs` is 200 lines or fewer ──────────────────────

{
  let source = null
  let readError = null
  try {
    source = fs.readFileSync(TOOLS_PATH, 'utf8')
  } catch (error) {
    readError = error
  }
  assert.equal(readError, null,
    '(e)/M5: `factory/tools.mjs` must exist to be measured — reading it failed: ' +
    String(readError && readError.message ? readError.message : readError))

  // Newlines, which is exactly what the Proof's
  // `Run: test $(wc -l < factory/tools.mjs) -le 200` counts.
  const lines = (source.match(/\n/g) ?? []).length
  assert.ok(lines <= 200,
    '(e)/M5: `factory/tools.mjs` is 200 lines or fewer, `wc -l` says ' + lines)
}

console.log('ALL TESTS PASSED')
