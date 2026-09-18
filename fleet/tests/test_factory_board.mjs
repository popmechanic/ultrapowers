/**
 * fleet/tests/test_factory_board.mjs — the exam for *the board*: the one
 * module that talks to Kata, and never fails a run.
 *
 * This file is the Proof's `Test: fleet/tests/test_factory_board.mjs`, written
 * where the Proof names it. The deliverable is `factory/board.mjs`, imported
 * below as `../../factory/board.mjs` — `../` is `fleet/`, `../../` is the
 * repository root, and `factory/board.mjs` is where the task asks it to live.
 *
 * The Machine clauses under test, restated:
 *
 *   M1 — `makeBoard({ kata, projectId, tasks, log })`, with `tasks` the
 *        kata.json's `tasks` object, answers `{ post, factsFor, setState,
 *        states, settled }`; `post(taskId, kind, text)` calls
 *        `kata.comment(projectId, tasks[taskId].uid, '[' + kind + ']\n' + text)`
 *        once and resolves the client's answer.
 *   M2 — `factsFor(taskId)` reads the task's issue with `kata.getIssue(uid)`
 *        and resolves one string: the issue's comments whose first line is a
 *        bracketed kind, oldest first, each rendered as its kind line then its
 *        text, separated by blank lines, keeping the NEWEST whole facts that
 *        fit in 12,000 characters and prefixing `(earlier facts omitted)` when
 *        any was dropped; an issue with no such comment resolves the empty
 *        string.
 *   M3 — `setState(taskId, state)` calls `kata.patchMetadata(projectId, uid,
 *        { 'factory.state': state })`; `states()` resolves `{ <taskId>:
 *        <factory.state or null> }` for every task from
 *        `kata.listIssues(projectId)`; `settled(taskId)` resolves the parsed
 *        `interface.settled` metadata of that task's issue or `null`.
 *   M4 — every one of the five methods resolves and never rejects: when the
 *        client fails or `tasks[taskId]` is absent, the method calls `log`
 *        once with a string beginning `board:` and resolves `null`
 *        (`factsFor` resolves the empty string, `states` resolves `{}`);
 *        `makeBoard` with no `kata` answers the same five methods, each
 *        resolving that empty value without calling `log`.
 *
 * The Proof legs, in the Proof's own order, and where each is answered below:
 *
 *   (a) [M1] post + the exact five keys
 *   (b) [M2] factsFor's rendering, the empty case, and the 12,000-char cap
 *   (c) [M3] setState, states, settled
 *   (d) [M4] every method against a failing client, the missing-task case,
 *            and `makeBoard({})`
 *
 * ── the readings this exam is written on ────────────────────────────────────
 *
 *   • M2 SAYS NOTHING about which client call `settled` makes — unlike `post`,
 *     `factsFor` and `setState`/`states`, whose exact call is spelled, `settled`
 *     is specified purely by its resolved VALUE. So leg (c) never asserts a
 *     call shape for `settled`, and leg (d)'s failing-client case for
 *     `settled` makes every one of the fake's four methods reject, so the
 *     assertion holds whichever call `settled` actually makes.
 *   • "NO PARTIAL FACT" (leg (b)'s 40-fact case) is measured by reconstructing
 *     the newest-facts suffix the clause requires — facts joined by `'\n\n'`,
 *     oldest of the kept set first, ending at the newest — and finding the
 *     largest such suffix the result actually ends with; what remains in front
 *     of it must be the omission prefix and nothing else (a few characters'
 *     slack for however the module joins the prefix to the kept facts, never
 *     enough to hide a fact fragment). This is a direct reading of M2's "keeps
 *     WHOLE facts" and "separated by blank lines", not an invented format.
 *   • THIS FILE SPAWNS NOTHING. The fake client is a plain object; no network,
 *     no process. `factory/board.mjs` is never asked to run one either — the
 *     task's own Context says the driven client is a fake plain object.
 *   • THE IMPORT IS DYNAMIC so a tree without the module reports the first
 *     assertion below rather than dying at load with a resolution error.
 *
 * WHY THIS IS RED AT BASE. `factory/board.mjs` does not exist, so the dynamic
 * import fails and the first assertion names it as the absent deliverable.
 */
import assert from 'node:assert/strict'

/** A value, cut for an assertion message. */
const show = (value) => {
  const text = typeof value === 'string' ? JSON.stringify(value) : JSON.stringify(value ?? null)
  return text.length > 600 ? text.slice(0, 600) + '…' : text
}

// ── the deliverable ─────────────────────────────────────────────────────────
let mod = null
let importError = null
try {
  mod = await import('../../factory/board.mjs')
} catch (error) {
  importError = error
}

assert.equal(importError, null,
  'M1: `factory/board.mjs` must exist and export `makeBoard` — importing it failed: ' +
  String(importError && importError.message ? importError.message : importError))

const { makeBoard } = mod
assert.equal(typeof makeBoard, 'function',
  'M1: `factory/board.mjs` exports `makeBoard` as a function, got ' + typeof makeBoard)

// ── a log spy ────────────────────────────────────────────────────────────────

/** Records every call it received, as the array of arguments each call got. */
const makeLogSpy = () => {
  const calls = []
  const log = (...args) => { calls.push(args) }
  return { log, calls }
}

/** True when a log spy's calls are exactly one call, its first argument a
 *  string beginning `board:` — the shape M4 requires of every failure. */
const calledOnceAsBoardLog = (calls) =>
  calls.length === 1 && typeof calls[0][0] === 'string' && calls[0][0].startsWith('board:')

// ── a fake kata client ───────────────────────────────────────────────────────

/**
 * A plain-object fake of `fleet/kata-client.mjs`'s client: records every call
 * it received (`{ name, args }`, in order) and answers from a fixed script.
 * `reject` names the methods that throw instead of answering. Never touches a
 * network; never spawns anything.
 *
 *   issues        `{ <uid>: <issue> }`, what `getIssue(uid)` answers
 *   projectIssues what `listIssues(projectId)` answers
 *   commentAnswer what `comment(...)` answers
 */
const makeFakeKata = ({ issues = {}, projectIssues = [], commentAnswer, reject = new Set() } = {}) => {
  const calls = []
  const record = (name, args) => { calls.push({ name, args }) }
  const failIfAsked = (name) => {
    if (reject.has(name)) throw new Error('fake ' + name + ' refused')
  }
  return {
    calls,
    comment: async (...args) => {
      record('comment', args)
      failIfAsked('comment')
      return commentAnswer
    },
    getIssue: async (...args) => {
      record('getIssue', args)
      failIfAsked('getIssue')
      const uid = args[0]
      return issues[uid] || { uid, comments: [], metadata: {} }
    },
    patchMetadata: async (...args) => {
      record('patchMetadata', args)
      failIfAsked('patchMetadata')
      return { ok: true }
    },
    listIssues: async (...args) => {
      record('listIssues', args)
      failIfAsked('listIssues')
      return projectIssues
    },
  }
}

const PROJECT_ID = 'proj-1'

// ── (a) [M1] post, and the exact five keys ──────────────────────────────────

{
  const commentAnswer = { ok: true, marker: 'comment-answer-1' }
  const fake = makeFakeKata({ commentAnswer })
  const tasks = { 2: { uid: 'U2' } }
  const { log } = makeLogSpy()
  const board = makeBoard({ kata: fake, projectId: PROJECT_ID, tasks, log })

  assert.deepEqual(Object.keys(board).sort(), ['factsFor', 'post', 'setState', 'settled', 'states'],
    '(a)/M1: `makeBoard` answers an object with keys exactly `post`, `factsFor`, `setState`, ' +
    '`states`, `settled` — got ' + show(Object.keys(board)))
  for (const name of ['post', 'factsFor', 'setState', 'states', 'settled']) {
    assert.equal(typeof board[name], 'function',
      '(a)/M1: `' + name + '` is a function, got ' + typeof board[name])
  }

  const answer = await board.post('2', 'landing', 'x')

  const commentCalls = fake.calls.filter((c) => c.name === 'comment')
  assert.equal(commentCalls.length, 1,
    '(a)/M1: `post` calls the client\'s `comment` exactly once — got ' + commentCalls.length)
  assert.deepEqual(commentCalls[0].args, [PROJECT_ID, 'U2', '[landing]\nx'],
    '(a)/M1: `post(\'2\', \'landing\', \'x\')` calls `comment(projectId, tasks[\'2\'].uid, ' +
    '\'[landing]\\nx\')` — got ' + show(commentCalls[0].args))
  assert.deepEqual(answer, commentAnswer,
    '(a)/M1: `post` resolves the client\'s answer to `comment` — got ' + show(answer))
}

// ── (b) [M2] factsFor's rendering ───────────────────────────────────────────

{
  const issues = {
    U2: {
      uid: 'U2',
      comments: [
        { body: '[exam-note]\na' },
        { body: 'plain talk' },
        { body: '[landing]\nb' },
      ],
      metadata: {},
    },
    U4: { uid: 'U4', comments: [{ body: 'plain talk' }, { body: 'still no bracket' }], metadata: {} },
  }
  const fake = makeFakeKata({ issues })
  const tasks = { 2: { uid: 'U2' }, 4: { uid: 'U4' } }
  const { log } = makeLogSpy()
  const board = makeBoard({ kata: fake, projectId: PROJECT_ID, tasks, log })

  const facts = await board.factsFor('2')
  assert.equal(facts, '[exam-note]\na\n\n[landing]\nb',
    '(b)/M2: three comments, only two bracketed, render oldest first joined by a blank line — ' +
    'got ' + show(facts))

  const getIssueCalls = fake.calls.filter((c) => c.name === 'getIssue')
  assert.equal(getIssueCalls.length, 1,
    '(b)/M2: `factsFor` reads the issue exactly once — got ' + getIssueCalls.length)
  assert.deepEqual(getIssueCalls[0].args, ['U2'],
    '(b)/M2: `factsFor(\'2\')` calls `getIssue(tasks[\'2\'].uid)` — got ' + show(getIssueCalls[0].args))

  const empty = await board.factsFor('4')
  assert.equal(empty, '',
    '(b)/M2: an issue with no bracketed comment resolves the empty string — got ' + show(empty))
}

// ── (b) [M2] the 12,000-character cap, newest whole facts kept ──────────────

{
  const FACT_LEN = 1000
  const KIND_LINE = '[f]\n' // 4 characters
  const filler = (i) => String(i).padStart(3, '0').repeat((FACT_LEN - KIND_LINE.length) / 3)
  const facts = []
  for (let i = 0; i < 40; i++) facts.push(KIND_LINE + filler(i))
  for (const f of facts) assert.equal(f.length, FACT_LEN, 'exam setup: each fact is 1000 characters')

  const issues = { U5: { uid: 'U5', comments: facts.map((body) => ({ body })), metadata: {} } }
  const fake = makeFakeKata({ issues })
  const tasks = { 5: { uid: 'U5' } }
  const { log } = makeLogSpy()
  const board = makeBoard({ kata: fake, projectId: PROJECT_ID, tasks, log })

  const result = await board.factsFor('5')
  const PREFIX = '(earlier facts omitted)'

  assert.equal(typeof result, 'string', '(b)/M2: `factsFor` resolves a string — got ' + typeof result)
  assert.ok(result.length <= 12000,
    '(b)/M2: forty 1,000-character facts render at most 12,000 characters — got ' + result.length)
  assert.ok(result.startsWith(PREFIX),
    '(b)/M2: dropping any fact prefixes `(earlier facts omitted)` — got ' + show(result.slice(0, 40)))
  assert.ok(result.endsWith(facts[39]),
    '(b)/M2: the result ends with the newest fact whole')

  // "no partial fact": find the largest k such that the result ends with the
  // k newest facts, oldest-of-the-kept-set first, joined by a blank line —
  // the join M2 mandates. Whatever precedes that suffix must be the omission
  // prefix and nothing else (a few characters' slack for how the module joins
  // the prefix to the kept facts) — never enough room to hide a cut fact.
  let matchedK = 0
  for (let k = 1; k <= facts.length; k++) {
    const suffix = facts.slice(facts.length - k).join('\n\n')
    if (result.length >= suffix.length && result.endsWith(suffix)) matchedK = k
  }
  assert.ok(matchedK >= 1,
    '(b)/M2: the result ends with at least the newest whole fact, joined as M2 requires — got ' +
    show(result.slice(-200)))
  assert.ok(matchedK < facts.length,
    '(b)/M2: not all forty facts fit in 12,000 characters, so some were dropped')

  const suffix = facts.slice(facts.length - matchedK).join('\n\n')
  const leading = result.slice(0, result.length - suffix.length)
  assert.ok(leading.startsWith(PREFIX) && leading.length <= PREFIX.length + 20,
    '(b)/M2: nothing but the omission prefix (plus a small joining separator) precedes the ' +
    'kept whole facts — no partial fact leaks in front of them: leading = ' + show(leading))
}

// ── (c) [M3] setState, states, settled ──────────────────────────────────────

{
  const SETTLED_JSON = '{"symbol":"f","file":"a.py","task":"1"}'
  const metaU1 = { 'factory.state': 'adopted', 'interface.settled': SETTLED_JSON }
  const metaU2 = {}
  const issues = {
    U1: { uid: 'U1', comments: [], metadata: metaU1 },
    U2: { uid: 'U2', comments: [], metadata: metaU2 },
  }
  const projectIssues = [
    { uid: 'U1', metadata: metaU1 },
    { uid: 'U2', metadata: metaU2 },
  ]
  const fake = makeFakeKata({ issues, projectIssues })
  const tasks = { 1: { uid: 'U1' }, 2: { uid: 'U2' } }
  const { log } = makeLogSpy()
  const board = makeBoard({ kata: fake, projectId: PROJECT_ID, tasks, log })

  await board.setState('2', 'adopted')
  const patchCalls = fake.calls.filter((c) => c.name === 'patchMetadata')
  assert.equal(patchCalls.length, 1,
    '(c)/M3: `setState` calls `patchMetadata` exactly once — got ' + patchCalls.length)
  assert.deepEqual(patchCalls[0].args, [PROJECT_ID, 'U2', { 'factory.state': 'adopted' }],
    '(c)/M3: `setState(\'2\', \'adopted\')` calls `patchMetadata(projectId, tasks[\'2\'].uid, ' +
    '{ \'factory.state\': \'adopted\' })` — got ' + show(patchCalls[0].args))

  const states = await board.states()
  assert.deepEqual(states, { 1: 'adopted', 2: null },
    '(c)/M3: `states()` maps every task to its `factory.state` or `null` — got ' + show(states))
  const listCalls = fake.calls.filter((c) => c.name === 'listIssues')
  assert.equal(listCalls.length, 1,
    '(c)/M3: `states()` calls `listIssues` exactly once — got ' + listCalls.length)
  assert.deepEqual(listCalls[0].args, [PROJECT_ID],
    '(c)/M3: `states()` calls `listIssues(projectId)` — got ' + show(listCalls[0].args))

  const settled1 = await board.settled('1')
  assert.deepEqual(settled1, { symbol: 'f', file: 'a.py', task: '1' },
    '(c)/M3: `settled(\'1\')` resolves the parsed `interface.settled` metadata — got ' + show(settled1))
  const settled2 = await board.settled('2')
  assert.equal(settled2, null,
    '(c)/M3: a task whose issue carries no `interface.settled` resolves `null` — got ' + show(settled2))
}

// ── (d) [M4] every method against a failing client ──────────────────────────

{
  const tasks = { 1: { uid: 'U1' } }
  const issues = { U1: { uid: 'U1', comments: [{ body: '[x]\ny' }], metadata: { 'interface.settled': '{"a":1}' } } }
  const projectIssues = [{ uid: 'U1', metadata: issues.U1.metadata }]

  const cases = [
    { method: 'post', args: ['1', 'k', 't'], reject: ['comment'], empty: null },
    { method: 'factsFor', args: ['1'], reject: ['getIssue'], empty: '' },
    { method: 'setState', args: ['1', 'adopted'], reject: ['patchMetadata'], empty: null },
    { method: 'states', args: [], reject: ['listIssues'], empty: {} },
    // M2 never names the call `settled` makes — reject every client method so
    // the assertion holds whichever one it is.
    { method: 'settled', args: ['1'], reject: ['comment', 'getIssue', 'patchMetadata', 'listIssues'], empty: null },
  ]

  for (const { method, args, reject, empty } of cases) {
    const fake = makeFakeKata({ issues, projectIssues, reject: new Set(reject) })
    const { log, calls } = makeLogSpy()
    const board = makeBoard({ kata: fake, projectId: PROJECT_ID, tasks, log })

    const result = await board[method](...args)
    assert.deepEqual(result, empty,
      '(d)/M4: `' + method + '` resolves rather than rejects when the client fails, with its ' +
      'empty value ' + show(empty) + ' — got ' + show(result))
    assert.ok(calledOnceAsBoardLog(calls),
      '(d)/M4: `' + method + '` calls `log` exactly once with a string beginning `board:` when ' +
      'the client fails — got ' + show(calls))
  }
}

// ── (d) [M4] a missing task, without calling the client at all ──────────────

{
  const fake = makeFakeKata({})
  const tasks = { 1: { uid: 'U1' } }
  const { log, calls } = makeLogSpy()
  const board = makeBoard({ kata: fake, projectId: PROJECT_ID, tasks, log })

  const result = await board.post('9', 'landing', 'x')
  assert.equal(result, null,
    '(d)/M4: `post` against a task id absent from `tasks` resolves `null` — got ' + show(result))
  assert.ok(calledOnceAsBoardLog(calls),
    '(d)/M4: and calls `log` exactly once with a string beginning `board:` — got ' + show(calls))
  assert.equal(fake.calls.length, 0,
    '(d)/M4: without ever calling the client — got ' + show(fake.calls))
}

// ── (d) [M4] makeBoard with no kata ──────────────────────────────────────────

{
  const noKata = makeBoard({})
  assert.deepEqual(Object.keys(noKata).sort(), ['factsFor', 'post', 'setState', 'settled', 'states'],
    '(d)/M4: `makeBoard({})` still answers the same five keys — got ' + show(Object.keys(noKata)))

  const { log, calls } = makeLogSpy()
  const board = makeBoard({ log })

  const post = await board.post('1', 'landing', 'x')
  assert.equal(post, null, '(d)/M4: with no `kata`, `post` resolves `null` — got ' + show(post))

  const facts = await board.factsFor('1')
  assert.equal(facts, '', '(d)/M4: with no `kata`, `factsFor` resolves `\'\'` — got ' + show(facts))

  const setState = await board.setState('1', 'adopted')
  assert.equal(setState, null, '(d)/M4: with no `kata`, `setState` resolves `null` — got ' + show(setState))

  const states = await board.states()
  assert.deepEqual(states, {}, '(d)/M4: with no `kata`, `states` resolves `{}` — got ' + show(states))

  const settled = await board.settled('1')
  assert.equal(settled, null, '(d)/M4: with no `kata`, `settled` resolves `null` — got ' + show(settled))

  assert.equal(calls.length, 0,
    '(d)/M4: `makeBoard` with no `kata` never calls `log` — got ' + show(calls))
}
