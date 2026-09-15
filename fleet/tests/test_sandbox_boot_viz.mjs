/**
 * Exam for run-97 task 1 — "The page shows the fleet turning, and the record
 * keeps up" (#877, map #876 *Viz*).
 *
 * Seven machine clauses, read here leg by leg and nowhere else:
 *
 *   M1  the refresher serves `events.jsonl` beside the page — a copy through a
 *       temp file in `$WWW_DIR` and a `mv`, every tick          → leg (a)
 *   M2  `sandbox-boot.sh project <events.jsonl> [<args.json>]` prints one JSON
 *       object `{"sub":…,"tasks":{…}}`                          → legs (b), (c)
 *   M3  every page the boot script writes carries a `tasks` cell after
 *       `error`, and the refresher's `phase` carries the sub-step → leg (c)
 *   M4  the refresher commits evidence by `FLEET_COMMIT_EVENTS` lines or
 *       `FLEET_COMMIT_SECONDS` seconds, never on a tick with no new line
 *                                                               → legs (d), (e)
 *   M5  `fleet/CONTRACT.md` says M4, and the page's new cells    → leg (f)
 *   M6  `fleet/RUNBOOK.md`'s **Watch.** list says what a watcher reads → leg (g)
 *   M7  `CLAUDE.md` names map #876 `*Viz*` and never `Orrery`    → leg (h)
 *
 * THE RIG. `_sandbox_boot_helpers.mjs` as it stands, plus one knob this task
 * adds to its `systemd-run` stub's engine arm: `STUB_ENGINE_HOLD=1` makes the
 * stub engine hold — after its phase lines — until `$FLEET_HOME/stub/engine-release`
 * appears. That hold is the whole reason the live legs below can be assertions
 * instead of races: while the engine is held, THIS process is the only writer
 * of the run dir's `events.jsonl` and of `$FLEET_HOME/stub/clock`, so every
 * read it makes of the page, of the served copy and of `committed(ctx)` is a
 * read of a run whose engine has not moved.
 *
 * EVERY WAIT IS A BOUNDED POLL on a condition — never a sleep for a duration.
 * A cap that runs out is the leg's failure, and so is a boot that exited before
 * the condition held: `pollFor` says which of the two happened.
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import {
  SCRIPT, ENV, ENGINE_EVENT_LINE,
  makeHome, boot, bootAsync,
  lines, stream, statusOf, committed, commitStates, eventsFile,
  runTests,
} from './_sandbox_boot_helpers.mjs'

const tests = []
const test = (name, fn) => tests.push([name, fn])

// ── the log a leg writes ─────────────────────────────────────────────────────
//
// Ids that sort in append order and ABOVE the stub engine's own line
// (`ENGINE_EVENT_ID` = '0000000001' + sixteen zeros), because the projector
// orders by `id` and not by file position — which is what leg (b)'s
// reverse-order case exists to prove.

const evId = (n) => '0000000002' + String(n).padStart(16, '0')
/** One event line, newline included: the engine's own shape plus `id`/`ts`. */
const ev = (n, body) => `${JSON.stringify({ ...body, id: evId(n), ts: n })}\n`

const start = (n, label, role) =>
  ev(n, { kind: 'worker:start', label, role, sessionId: `s${n}`, cwd: '/w', model: 'sonnet' })
const end = (n, label, role, status = 'DONE') =>
  ev(n, {
    kind: 'worker:end', label, role, sessionId: `s${n}`, exitCode: 0, timedOut: false,
    outcome: 'ok', class: null, status, meter: null,
  })

const PROOF_CMD = 'node fleet/tests/test_alpha.mjs'
const CHECK_CMD = 'python3 -m pytest -q tests/test_docs_agree_with_code.py'
const EXAM_CMD = 'node fleet/tests/test_sandbox_boot_viz.mjs'
const ADOPTED_SHA = 'ab'.repeat(20)

/**
 * Leg (b)'s log, in `id` order — fourteen lines, the stub engine's `gate` line
 * first because a live run always has it first.
 *
 *   1 engine:phase gate          8 worker:end   review:1:0
 *   2 worker:start exam:1        9 worker:start fix:1:0
 *   3 worker:end   exam:1       10 worker:end   fix:1:0
 *   4 worker:start impl:1       11 driver:check-run task 1 exit 0
 *   5 worker:end   impl:1       12 driver:exam-run  task 1 exit 1
 *   6 driver:proof-run t1 e0    13 driver:wave-adopted wave 1 tasks ["1"]
 *   7 worker:start review:1:0   14 worker:start impl:2
 */
const B = [
  ENGINE_EVENT_LINE,
  start(2, 'exam:1', 'examiner'),
  end(3, 'exam:1', 'examiner'),
  start(4, 'impl:1', 'implementer'),
  end(5, 'impl:1', 'implementer'),
  ev(6, { kind: 'driver:proof-run', task: '1', cmd: PROOF_CMD, exit: 0, iter: 0 }),
  start(7, 'review:1:0', 'reviewer'),
  end(8, 'review:1:0', 'reviewer'),
  start(9, 'fix:1:0', 'implementer'),
  end(10, 'fix:1:0', 'implementer'),
  ev(11, { kind: 'driver:check-run', task: '1', cmd: CHECK_CMD, exit: 0, iter: 0 }),
  ev(12, { kind: 'driver:exam-run', task: '1', cmd: EXAM_CMD, exit: 1, iter: 0 }),
  ev(13, { kind: 'driver:wave-adopted', wave: 1, tasks: ['1'], headSha: ADOPTED_SHA }),
  start(14, 'impl:2', 'implementer'),
]
/** The `driver:wave-blocked` that stands in for line 13 in one case. */
const BLOCKED_13 = ev(13, { kind: 'driver:wave-blocked', wave: 1, tasks: ['1'], detail: 'x' })
/** The fifteenth line of one case: `impl:2` ended BLOCKED. */
const BLOCKED_END_15 = end(15, 'impl:2', 'implementer', 'BLOCKED')
/**
 * The sixteenth line of #987's cases, in exactly the shape `run-engine.mjs`
 * writes it (line 3659): `appendEvent({ kind: 'driver:re-edged', task: r.task,
 * blockedBy: r.blockedBy.slice() })` — `task` a string id, `blockedBy` a list
 * of string ids. Its id sorts AFTER `BLOCKED_END_15`'s, which is what makes the
 * re-edge win over the `BLOCKED` end.
 */
const RE_EDGED_16 = ev(16, { kind: 'driver:re-edged', task: '2', blockedBy: ['1'] })
/** The seventeenth line of #987 leg (d): task 2 dispatched again. */
const RESTART_17 = start(17, 'impl:2', 'implementer')

/** `args.json` as `ultra_run.py` writes it: `waves`, a list of lists of `{id}`. */
const ARGS_JSON = `${JSON.stringify({
  waves: [[{ id: '1' }, { id: '2' }], [{ id: '3' }]],
})}\n`

/**
 * M2's cell, with M2's own defaults, so a case names only what it changes.
 *
 * #987 M3 adds `blockedBy` as the cell's LAST key, `null` for a task no
 * `driver:re-edged` event names — so every whole-object pin below reads the
 * seven-key shape the Produces line spells.
 */
const cell = (over = {}) => ({ wave: null, state: 'queued', role: null, lastProof: null, park: null, attention: null, blockedBy: null, ...over })

/** The keys of a cell, in the order the Produces line spells them (#987 M3). */
const CELL_KEYS = ['wave', 'state', 'role', 'lastProof', 'park', 'attention', 'blockedBy']

/** Leg (b)'s `tasks` for the full log WITH `args.json`. */
const TASKS_WITH_ARGS = {
  1: cell({ wave: 1, state: 'folded', lastProof: { cmd: EXAM_CMD, exit: 1, ts: 12 } }),
  2: cell({ wave: 1, state: 'implementing', role: 'impl:2' }),
  3: cell({ wave: 2, state: 'queued' }),
}
/** …and for the full log with NO `args.json`: two keys, task 2 in no wave. */
const TASKS_NO_ARGS = {
  1: cell({ wave: 1, state: 'folded', lastProof: { cmd: EXAM_CMD, exit: 1, ts: 12 } }),
  2: cell({ state: 'implementing', role: 'impl:2' }),
}

// ── the verb ────────────────────────────────────────────────────────────────

let VERB_HOME = null
/** One home for every `project` call: M2's verb is side-effect free, as
 *  `deadman` already is, so the cases share it. */
const verbHome = () => {
  if (!VERB_HOME) VERB_HOME = makeHome()
  return VERB_HOME
}

let fileNo = 0
/** Write `text` into the shared home and answer its path. */
const plant = (text, ext = 'jsonl') => {
  fileNo += 1
  const p = path.join(verbHome().home, `viz-${fileNo}.${ext}`)
  fs.writeFileSync(p, text)
  return p
}

/**
 * `bash fleet/sandbox-boot.sh project <events.jsonl> [<args.json>]`, held to
 * M2's frame: exit 0, ONE line on stdout, one JSON object, a `sub` cell and a
 * `tasks` object. Answers the parsed object.
 */
const project = (logPath, argsPath) => {
  const argv = argsPath ? ['project', logPath, argsPath] : ['project', logPath]
  const r = boot(verbHome(), argv)
  const tail = `\n--- stdout\n${r.stdout || ''}--- stderr\n${r.stderr || ''}`
  assert.equal(r.status, 0,
    `\`sandbox-boot.sh ${argv.join(' ')}\` must exit 0  [M2, Produces]${tail}`)
  const out = lines(r.stdout)
  assert.equal(out.length, 1,
    `the verb prints ONE JSON object on ONE line — a verb that prints more fails  [M2]${tail}`)
  let doc
  try {
    doc = JSON.parse(out[0])
  } catch (error) {
    assert.fail(`the one line must parse as JSON  [M2]: ${error.message}${tail}`)
  }
  assert.ok(doc && typeof doc === 'object' && !Array.isArray(doc),
    `the verb prints a JSON OBJECT  [M2]${tail}`)
  assert.ok('sub' in doc,
    `the object carries a \`sub\` cell — a verb that omits \`sub\` fails  [M2]${tail}`)
  assert.ok(doc.tasks && typeof doc.tasks === 'object' && !Array.isArray(doc.tasks),
    `the object carries a \`tasks\` object  [M2]${tail}`)
  return doc
}

// ── the bounded polls ───────────────────────────────────────────────────────

const STEP_MS = 50
const CAP = 300

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
/** A condition that throws while the thing it reads is still absent is simply
 *  not met yet. */
const safe = (fn) => {
  try {
    return fn()
  } catch {
    return false
  }
}
/** Deep equality as a predicate, so a poll waits on VALUES and never on the
 *  order a writer happened to spell its keys in. */
const same = (a, b) => {
  try {
    assert.deepEqual(a, b)
    return true
  } catch {
    return false
  }
}

/**
 * Poll `cond` every 50 ms up to `cap` times. Fails with `what` — and with the
 * leg's own `detail()` — when the cap runs out, and fails EARLY, with the same
 * sentence, when the boot exited before the condition ever held.
 */
async function pollFor(what, cond, { cap = CAP, over = () => null, detail = () => '' } = {}) {
  for (let i = 0; i < cap; i += 1) {
    if (safe(cond)) return
    const r = over()
    if (r) {
      throw new Error(
        `${what}\n  the boot exited (status ${r.status}) before it held — the engine never ` +
        `held for STUB_ENGINE_HOLD, or the behaviour is not there\n${detail()}`,
      )
    }
    await sleep(STEP_MS)
  }
  throw new Error(`${what}\n  not after ${cap} polls of ${STEP_MS} ms\n${detail()}`)
}

/** How many `status: state=running …` pages the boot has written so far. */
const runningWrites = (ctx) => stream(ctx).filter((l) => l.startsWith('status: state=running')).length

/**
 * A held boot. `body` gets the context, the promised result, a `release()` and
 * an `over()` that answers the boot's result once it has one. The engine is
 * released in `finally` whatever the body did, so a red leg does not leave a
 * stub engine polling for two minutes.
 */
async function held(env, body) {
  const ctx = makeHome()
  let over = null
  const run = bootAsync(ctx, ['boot'], { STUB_ENGINE_HOLD: '1', ...env }).then((r) => {
    over = r
    return r
  })
  const release = () => fs.writeFileSync(path.join(ctx.home, 'stub', 'engine-release'), '')
  try {
    return await body({ ctx, run, release, over: () => over })
  } finally {
    release()
    await run.catch(() => {})
  }
}

/** The run dir's `events.jsonl`, once the held engine has written its line. */
const awaitGateLine = (ctx, over) =>
  pollFor(
    'the stub engine writes its `gate` line into the run dir\'s events.jsonl',
    () => fs.readFileSync(eventsFile(ctx), 'utf8').includes('"kind":"engine:phase"'),
    { over, detail: () => stream(ctx).join('\n') },
  )

const append = (ctx, text) => fs.appendFileSync(eventsFile(ctx), text)
const servedEvents = (ctx) => path.join(ctx.home, 'www', 'events.jsonl')

// ── (a) the served log keeps up with the run dir's  [M1] ────────────────────

test('(a) every tick copies the run dir\'s events.jsonl to $WWW_DIR, twice over  [M1]', () =>
  held({ FLEET_STATUS_INTERVAL: '0.25' }, async ({ ctx, over }) => {
    await awaitGateLine(ctx, over)

    // ONE append, then the served copy must reach byte-equality on its own.
    append(ctx, start(2, 'impl:1', 'implementer'))
    const equalNow = () => {
      const mine = fs.readFileSync(eventsFile(ctx))
      const served = fs.readFileSync(servedEvents(ctx))
      return mine.equals(served)
    }
    await pollFor(
      '`$WWW_DIR/events.jsonl` must become byte-equal to the run dir\'s file after an ' +
      'append  [leg (a), M1] — a served copy that is never written exhausts this poll',
      equalNow,
      { over, detail: () => stream(ctx).join('\n') },
    )
    const first = fs.statSync(servedEvents(ctx)).size

    // A SECOND append: a copy made once and never again fails here.
    append(ctx, start(3, 'impl:2', 'implementer'))
    await pollFor(
      'and byte-equal AGAIN after a second append  [leg (a), M1] — a served copy written once ' +
      'and never again exhausts this poll',
      equalNow,
      { over, detail: () => stream(ctx).join('\n') },
    )
    const second = fs.statSync(servedEvents(ctx)).size
    assert.ok(second > first,
      `the served copy is strictly longer at the second equality than at the first  ` +
      `[leg (a), M1]: ${first} → ${second}`)
  }))

// ── (b) the projector's cells  [M2] ─────────────────────────────────────────

test('(b) the full log with args.json projects three cells and no fourth  [M2]', () => {
  const log = plant(B.join(''))
  const args = plant(ARGS_JSON, 'json')
  const doc = project(log, args)

  assert.deepEqual(doc.tasks['1'],
    { wave: 1, state: 'folded', role: null, lastProof: { cmd: EXAM_CMD, exit: 1, ts: 12 }, park: null,
      attention: null, blockedBy: null },
    'task 1: folded by the `driver:wave-adopted` that lists it, no open `worker:start` so `role` ' +
    'is null, `lastProof` the last of the three proof kinds — the exam-run — and `wave` the ' +
    '1-based index of the args.json wave holding it  [leg (b), M2]')
  assert.deepEqual(doc.tasks['2'],
    { wave: 1, state: 'implementing', role: 'impl:2', lastProof: null, park: null, attention: null,
      blockedBy: null },
    'task 2: `worker:start impl:2` with no later `worker:end` of that label  [leg (b), M2]')
  assert.deepEqual(doc.tasks['3'],
    { wave: 2, state: 'queued', role: null, lastProof: null, park: null, attention: null,
      blockedBy: null },
    'task 3: named only by args.json\'s second wave, so queued in wave 2  [leg (b), M2]')
  assert.deepEqual(Object.keys(doc.tasks).sort(), ['1', '2', '3'],
    'one key per task id the log and args.json name, and no fourth  [leg (b), M2]: ' +
    JSON.stringify(Object.keys(doc.tasks)))
  assert.deepEqual(doc.tasks, TASKS_WITH_ARGS,
    'the whole `tasks` object, cell for cell  [leg (b), M2]')
})

test('(b) each prefix of that log reads task 1 at the state its last rule fired  [M2]', () => {
  // The seven prefixes M2's state rules walk, each named by the line it ends at.
  const want = [
    [2, 'examining', null],
    [4, 'implementing', null],
    [6, 'proving', { cmd: PROOF_CMD, exit: 0, ts: 6 }],
    [7, 'reviewing', { cmd: PROOF_CMD, exit: 0, ts: 6 }],
    [9, 'fixing', { cmd: PROOF_CMD, exit: 0, ts: 6 }],
    [11, 'proving', { cmd: CHECK_CMD, exit: 0, ts: 11 }],
    [12, 'proving', { cmd: EXAM_CMD, exit: 1, ts: 12 }],
  ]
  for (const [n, state, lastProof] of want) {
    const doc = project(plant(B.slice(0, n).join('')))
    assert.equal(doc.tasks['1'].state, state,
      `the prefix ending at line ${n} reads task 1 as \`${state}\`  [leg (b), M2]: ` +
      JSON.stringify(doc.tasks['1']))
    assert.deepEqual(doc.tasks['1'].lastProof, lastProof,
      `and its \`lastProof\` is the last event of the three proof kinds at line ${n}  ` +
      '[leg (b), M2]')
  }
})

test('(b) a driver:wave-blocked parks the task it lists  [M2]', () => {
  const blocked = [...B]
  blocked[12] = BLOCKED_13
  const doc = project(plant(blocked.join('')))
  assert.equal(doc.tasks['1'].state, 'failed',
    'a `driver:wave-blocked` whose `tasks` lists the id reads `failed`  [leg (b), M2]')
  assert.equal(doc.tasks['1'].park, 'x',
    'and `park` is that event\'s `detail`  [leg (b), M2]')
  assert.equal(doc.tasks['1'].wave, 1,
    'and, with no args.json, `wave` is the blocked event\'s own  [leg (b), M2]')
})

test('(b) a worker:end impl:<id> with status BLOCKED fails the task and closes its role  [M2]', () => {
  const doc = project(plant([...B, BLOCKED_END_15].join('')))
  assert.equal(doc.tasks['2'].state, 'failed',
    'a `worker:end` `impl:2` whose `status` is BLOCKED reads `failed`  [leg (b), M2]')
  assert.equal(doc.tasks['2'].role, null,
    'and the label is no longer open, so `role` is null  [leg (b), M2]')
})

test('(b) with no args.json the log names exactly the ids its events name  [M2]', () => {
  const doc = project(plant(B.join('')))
  assert.deepEqual(Object.keys(doc.tasks).sort(), ['1', '2'],
    'exactly the keys 1 and 2  [leg (b), M2]: ' + JSON.stringify(Object.keys(doc.tasks)))
  assert.equal(doc.tasks['2'].wave, null,
    'task 2 is in no wave event and no args.json, so `wave` is null  [leg (b), M2]')
  assert.deepEqual(doc.tasks, TASKS_NO_ARGS,
    'the whole `tasks` object with no args.json  [leg (b), M2]')
})

test('(b) the same ids in reverse file order project identically  [M2]', () => {
  const forward = project(plant(B.join('')), plant(ARGS_JSON, 'json'))
  const reverse = project(plant([...B].reverse().join('')), plant(ARGS_JSON, 'json'))
  assert.deepEqual(reverse, forward,
    'the state is decided by the events read in `id` order, so a file written backwards ' +
    'projects the same object  [leg (b), M2]')
  assert.deepEqual(reverse.tasks, TASKS_WITH_ARGS,
    'and that object is still leg (b)\'s  [leg (b), M2]')
})

// ── (c) `sub`, and the page that carries it  [M2, M3] ───────────────────────

test('(c) `sub` is the open label, else the last event\'s kind, else null  [M2]', () => {
  assert.equal(project(plant(B.slice(0, 7).join(''))).sub, 'review:1:0',
    'the prefix ending at line 7 has `review:1:0` open — the most recent `worker:start` of any ' +
    'label with no later `worker:end` of that label  [leg (c), M2]')
  assert.equal(project(plant(B.slice(0, 13).join(''))).sub, 'driver:wave-adopted',
    'the prefix ending at line 13 has no open label, and its last event sorts after the last ' +
    '`engine:phase` and is not one, so `sub` is that event\'s `kind`  [leg (c), M2]')
  assert.equal(project(plant(B.join(''))).sub, 'impl:2',
    'the full log has `impl:2` open  [leg (c), M2]')
  assert.equal(project(plant(ENGINE_EVENT_LINE)).sub, null,
    'the `gate` line alone: no open label and the last event IS the `engine:phase`  [leg (c), M2]')
  assert.equal(
    project(plant(ENGINE_EVENT_LINE + ev(2, { kind: 'engine:phase', phase: 'Wave 1' }))).sub, null,
    'a second `engine:phase` is still an `engine:phase` — `sub` stays null  [leg (c), M2]')
})

test('(c) the live page carries `<phase> · <sub>` and the verb\'s own `tasks` cell  [M3]', () =>
  held({ FLEET_STATUS_INTERVAL: '0.25' }, async ({ ctx, run, release, over }) => {
    // The `engine starting` page is written BEFORE the unit, when the run dir
    // has no events file at all — M3's `{}`.
    await pollFor(
      'the `engine starting` page reaches the evidence branch  [leg (c), M3]',
      () => committed(ctx).some((p) => p.phase === 'engine starting'),
      { over, detail: () => stream(ctx).join('\n') },
    )
    const starting = committed(ctx).find((p) => p.phase === 'engine starting')
    assert.deepEqual(starting.tasks, {},
      'the page written before the engine has an absent `events.jsonl`, so its `tasks` cell is ' +
      '`{}`  [leg (c), M3]: ' + JSON.stringify(starting))

    await awaitGateLine(ctx, over)
    append(ctx, B.slice(1).join(''))

    const WANT_PHASE = 'gate · impl:2'
    await pollFor(
      `the refresher's page must read \`phase\` "${WANT_PHASE}" — the last \`engine:phase\`'s ` +
      'phase, a space, U+00B7, a space, and M2\'s `sub`; a page reading `gate` alone fails  ' +
      '[leg (c), M3]',
      () => statusOf(ctx).phase === WANT_PHASE,
      { over, detail: () => `page: ${JSON.stringify(safe(() => statusOf(ctx)))}` },
    )
    await pollFor(
      'and that page\'s `tasks` cell must deep-equal the verb\'s `tasks` for the same file; a ' +
      'page with no `tasks` cell fails  [leg (c), M3]',
      () => {
        const got = statusOf(ctx).tasks
        return got !== undefined && same(got, TASKS_NO_ARGS)
      },
      { over, detail: () => `page: ${JSON.stringify(safe(() => statusOf(ctx)))}` },
    )

    const live = statusOf(ctx)
    // The verb, run over a byte copy of the very file the page was projected
    // from — one reader, two callers.
    const copy = plant(fs.readFileSync(eventsFile(ctx), 'utf8'))
    assert.deepEqual(live.tasks, project(copy).tasks,
      'the page\'s `tasks` is the verb\'s `tasks` for the run dir\'s `events.jsonl`  ' +
      '[leg (c), M3]')
    assert.deepEqual(Object.keys(live).slice(-2), ['error', 'tasks'],
      '`tasks` is placed after `error`, and is therefore the LAST key of the page — a cell\'s ' +
      '`"state"` must never be the first `"state"` a field reader finds  [leg (c), M3]: ' +
      JSON.stringify(Object.keys(live)))
    assert.ok(stream(ctx).includes(`status: state=running phase=${WANT_PHASE}`),
      `the boot log carries the line \`status: state=running phase=${WANT_PHASE}\`  ` +
      '[leg (c), M3]:\n' + stream(ctx).join('\n'))

    // A running commit made AFTER the appends, so the comparison below is
    // against a page that saw them.
    await pollFor(
      'a `running` page carrying those tasks reaches the evidence branch  [leg (c), M3]',
      () => committed(ctx).some((p) => p.state === 'running' && same(p.tasks, TASKS_NO_ARGS)),
      { over, detail: () => JSON.stringify(committed(ctx)) },
    )

    release()
    const r = await run
    assert.equal(r.status, 0,
      'a released engine finishes the run as every green one does  [leg (c)]:\n' +
      r.stdout + r.stderr)

    const pages = committed(ctx)
    const lastRunning = [...pages].reverse().find((p) => p.state === 'running')
    const publishing = [...pages].reverse().find((p) => p.state === 'publishing')
    const done = [...pages].reverse().find((p) => p.state === 'done')
    assert.ok(publishing && done,
      'the run committed a `publishing` page and a `done` page  [leg (c)]: ' +
      JSON.stringify(pages.map((p) => p.state)))
    assert.deepEqual(publishing.tasks, lastRunning.tasks,
      'the `publishing` page carries the same `tasks` as the last `running` page  [leg (c), M3]')
    assert.deepEqual(done.tasks, lastRunning.tasks,
      'and so does the `done` page  [leg (c), M3]')
    for (const p of pages) {
      assert.deepEqual(Object.keys(p).slice(-2), ['error', 'tasks'],
        'EVERY page the boot script writes carries `tasks` last  [leg (c), M3]: ' +
        JSON.stringify(Object.keys(p)))
    }
  }))

// ── #952 task 1 — "The sub-phase skips bookkeeping kinds"  [M1–M5] ──────────
//
// Five more cases at case (c)'s surface. The fourteen cases above are run-97's
// legs (a)–(h) and stand exactly as they were; these five are THIS task's own
// legs (a)–(e), and every assertion below names them `#952 leg (x)` so the two
// alphabets never read as one.
//
//   M1  a trailing `kata:write-failed` / `transcript:slice` / `engine:log` /
//       `capture:dropped` is skipped; the last `driver:*`/`worker:*` kind is
//       taken instead                                        → #952 leg (a)
//   M2  nothing but bookkeeping since the `engine:phase` → `sub` is null
//                                                            → #952 leg (b)
//   M3  the open-label rule is untouched and still wins      → #952 leg (c)
//   M4  case (c)'s three existing pins read as they do at BASE
//                                                            → #952 leg (d)
//   M5  `fleet/CONTRACT.md`'s `**status.json:**` bullet says the rule
//                                                            → #952 leg (e)

/**
 * The four bookkeeping kinds M1 names, each in the shape the engine writes it:
 * `kata:write-failed` (`run-engine.mjs` `kataCall`), `transcript:slice`
 * (`run-worker.mjs`), `engine:log` (`run-waves.mjs`) and `capture:dropped`
 * (`run-waves.mjs`). None carries a `task` or a `tasks` list, so none of them
 * names a task — they are the run's bookkeeping and not its progress.
 */
const BOOKKEEPING = {
  'kata:write-failed': (n) =>
    ev(n, { kind: 'kata:write-failed', what: 'comment', uid: 'u1', detail: 'curl exit 22' }),
  'transcript:slice': (n) =>
    ev(n, { kind: 'transcript:slice', label: 'impl:1', sessionId: 's2', bytes: 4096 }),
  'engine:log': (n) => ev(n, { kind: 'engine:log', line: 'wave 1 begins' }),
  'capture:dropped': (n) =>
    ev(n, { kind: 'capture:dropped', label: 'impl:1', paths: ['out/big.bin'] }),
}
const BOOKKEEPING_KINDS = Object.keys(BOOKKEEPING)

test('(#952 a) a trailing bookkeeping kind is skipped for the last worker kind  [M1]', () => {
  for (const kind of BOOKKEEPING_KINDS) {
    // `engine:phase`, then `impl:1` opened AND closed — so no label is open and
    // the log has moved past its last phase event — then the one trailing line.
    const log = plant([
      ENGINE_EVENT_LINE,
      start(2, 'impl:1', 'implementer'),
      end(3, 'impl:1', 'implementer'),
      BOOKKEEPING[kind](4),
    ].join(''))
    const doc = project(log)
    assert.equal(doc.sub, 'worker:end',
      `with a trailing \`${kind}\` after \`engine:phase\`, \`worker:start impl:1\` and ` +
      '`worker:end impl:1`, `sub` is `worker:end` — the kind of the last `driver:*`/`worker:*` ' +
      `event, the bookkeeping line walked past  [#952 leg (a), M1]: ${JSON.stringify(doc.sub)}`)
    assert.notEqual(doc.sub, kind,
      `and \`sub\` is NOT \`${kind}\` — a bookkeeping kind is never the run's own progress  ` +
      '[#952 leg (a), M1]')
  }
})

test('(#952 b) only bookkeeping since the engine:phase leaves `sub` null  [M2]', () => {
  const doc = project(plant([
    ENGINE_EVENT_LINE,
    BOOKKEEPING['kata:write-failed'](2),
    BOOKKEEPING['transcript:slice'](3),
  ].join('')))
  assert.equal(doc.sub, null,
    'an `engine:phase` followed only by a `kata:write-failed` and a `transcript:slice` has no ' +
    '`driver:*`/`worker:*` event after the phase at all, so `sub` is null — not the kind of the ' +
    `last line  [#952 leg (b), M2]: ${JSON.stringify(doc.sub)}`)
})

test('(#952 c) an open worker label still wins over a trailing bookkeeping line  [M3]', () => {
  const doc = project(plant([
    ENGINE_EVENT_LINE,
    start(2, 'impl:2', 'implementer'),
    BOOKKEEPING['kata:write-failed'](3),
  ].join('')))
  assert.equal(doc.sub, 'impl:2',
    '`worker:start impl:2` with no later `worker:end impl:2` is the most recent worker still ' +
    'running, and the open-label rule is untouched by M1 — so `sub` is the label `impl:2`, not ' +
    `any trailing kind  [#952 leg (c), M3]: ${JSON.stringify(doc.sub)}`)
})

test('(#952 d) case (c)\'s three pins read as they do at BASE  [M4]', () => {
  // The same three reads leg (c) above makes, restated here as this task's own
  // regression pin: the skip rule must not move any of them.
  assert.equal(project(plant(B.slice(0, 13).join(''))).sub, 'driver:wave-adopted',
    'the prefix of `B` ending at line 13 still projects `driver:wave-adopted` — a `driver:*` kind ' +
    'is progress and is taken, not skipped  [#952 leg (d), M4]')
  assert.equal(project(plant(B.join(''))).sub, 'impl:2',
    'the full fourteen-line `B` still projects the open label `impl:2`  [#952 leg (d), M4]')
  assert.equal(project(plant(ENGINE_EVENT_LINE)).sub, null,
    'the `engine:phase` line alone still projects null  [#952 leg (d), M4]')
})

test('(#952 e) the contract\'s status.json bullet states the skip rule  [M5]', () => {
  // `STATUS_BULLET` is the same `sed -n` scope case (f) below greps, so both
  // cases read the one bullet as one line. Case (f)'s own `· <sub>` and
  // eight-state greps stand unchanged and must survive this edit.
  shOk(`${STATUS_BULLET} | grep -q 'kata:\\*.*transcript:\\*.*engine:log.*capture:\\*'`,
    'the `**status.json:**` bullet\'s sub-phase sentence must name `kata:*`, `transcript:*`, ' +
    '`engine:log` and `capture:*` — in that order — as the kinds the projection skips  ' +
    '[#952 leg (e), M5]')
  shOk(`${STATUS_BULLET} | grep -q 'driver:\\*./.worker:\\*'`,
    'and must say the kind taken is the last `driver:*`/`worker:*` one  [#952 leg (e), M5]')
})

// ── #987 task 2 — "The status page reads a re-edged task as waiting, with the
//    sibling it waits on beside it"  [M1–M6] ────────────────────────────────
//
// Six more cases at the same surface. Every assertion below names them
// `#987 leg (x)`, so run-97's alphabet, #952's and this one never read as one.
//
//   M1  a `BLOCKED` `worker:end impl:2` followed by `driver:re-edged
//       {task: "2", blockedBy: ["1"]}` projects task 2 `waiting`, `blockedBy`
//       `["1"]`, `role` null                                  → #987 leg (a)
//   M2  the same log with that line removed still reads `failed`, `blockedBy`
//       null                                                  → #987 leg (b)
//   M3  EVERY cell carries a `blockedBy` key, null for a task no
//       `driver:re-edged` names, and the other six read as at BASE
//                                                             → #987 leg (c)
//   M4  a later `worker:start impl:2` moves the state to `implementing` and
//       keeps `blockedBy`                                     → #987 leg (d)
//   M5  `fleet/CONTRACT.md`'s `**status.json:**` bullet says `waiting`, names a
//       `"blockedBy":` cell, says `nine states above` and no longer `eight
//       states`                                               → #987 leg (e)
//   M6  `fleet/RUNBOOK.md`'s **Watch.** entry for `status.json` names `waiting`
//                                                             → #987 leg (f)
//
// (a)–(d) are the sim and nothing else; (e)–(f) are scoped greps of the two
// documents and are never cited as evidence of what the projection does.

/** Leg (a)'s log: the fourteen-line `B`, the BLOCKED end, the re-edge. */
const RE_EDGED_LOG = [...B, BLOCKED_END_15, RE_EDGED_16]

test('(#987 a) a driver:re-edged after a BLOCKED end reads waiting, with blockedBy  [M1]', () => {
  const doc = project(plant(RE_EDGED_LOG.join('')))
  assert.deepEqual(doc.tasks['2'], cell({ state: 'waiting', blockedBy: ['1'] }),
    'a `worker:end impl:2` with `status` BLOCKED followed by `{kind:"driver:re-edged",task:"2",' +
    'blockedBy:["1"]}` projects task 2 as `state` `waiting` with `blockedBy` `["1"]` — and `role` ' +
    'null, because the `impl:2` label the BLOCKED end closed is no longer open; a re-edged task ' +
    `never reads \`failed\`  [#987 leg (a), M1]: ${JSON.stringify(doc.tasks['2'])}`)
  assert.deepEqual(doc.tasks['2'].blockedBy, ['1'],
    'the `blockedBy` cell is the event\'s own list of sibling task ids, as strings  ' +
    `[#987 leg (a), M1]: ${JSON.stringify(doc.tasks['2'].blockedBy)}`)
  assert.equal(doc.tasks['1'].blockedBy, null,
    'and the sibling the event NAMES as a blocker is not itself blocked — task 1\'s own ' +
    `\`blockedBy\` stays null  [#987 leg (a), M1, M3]: ${JSON.stringify(doc.tasks['1'])}`)
})

test('(#987 b) the same log with no driver:re-edged still reads failed  [M2]', () => {
  const doc = project(plant([...B, BLOCKED_END_15].join('')))
  assert.deepEqual(doc.tasks['2'], cell({ state: 'failed' }),
    'with the `driver:re-edged` line removed, the `BLOCKED` `worker:end impl:2` is the last word ' +
    'on task 2: `state` `failed`, `role` null, and `blockedBy` null — the standing case (b) ' +
    'restated against the WHOLE cell, so a projection that reads every `BLOCKED` end as `waiting` ' +
    `fails here  [#987 leg (b), M2]: ${JSON.stringify(doc.tasks['2'])}`)
  assert.equal(doc.tasks['2'].blockedBy, null,
    'a task no `driver:re-edged` event names has `blockedBy` null, not `[]` and not absent  ' +
    `[#987 leg (b), M2, M3]: ${JSON.stringify(doc.tasks['2'].blockedBy)}`)
})

test('(#987 c) every cell the verb prints carries blockedBy, last and null  [M3]', () => {
  const doc = project(plant(B.join('')), plant(ARGS_JSON, 'json'))
  assert.deepEqual(doc.tasks, TASKS_WITH_ARGS,
    'the fourteen-line `B` with `args.json` projects its three cells exactly as at BASE but for ' +
    'one added key: each carries `blockedBy: null`, because no `driver:re-edged` event names any ' +
    `of them  [#987 leg (c), M3]: ${JSON.stringify(doc.tasks)}`)
  for (const tid of ['1', '2', '3']) {
    assert.deepEqual(Object.keys(doc.tasks[tid]), CELL_KEYS,
      `task ${tid}'s cell carries exactly the seven keys the Produces line spells, in that ` +
      'order — the six of BASE unchanged and `blockedBy` LAST; a cell missing the key, or ' +
      'spelling it anywhere but last, fails  [#987 leg (c), M3]: ' +
      JSON.stringify(Object.keys(doc.tasks[tid])))
    assert.equal(doc.tasks[tid].blockedBy, null,
      `and task ${tid} is named by no \`driver:re-edged\`, so its \`blockedBy\` is null — a ` +
      'non-null value on an un-edged task fails  [#987 leg (c), M3]')
  }
  const noArgs = project(plant(B.join('')))
  assert.deepEqual(noArgs.tasks, TASKS_NO_ARGS,
    'and the same log with no `args.json` reads the new shape too  [#987 leg (c), M3]: ' +
    JSON.stringify(noArgs.tasks))
})

test('(#987 d) a worker:start after the re-edge implements, and keeps blockedBy  [M4]', () => {
  const doc = project(plant([...RE_EDGED_LOG, RESTART_17].join('')))
  assert.deepEqual(doc.tasks['2'], cell({ state: 'implementing', role: 'impl:2', blockedBy: ['1'] }),
    'a `worker:start impl:2` appended after the `driver:re-edged` line moves task 2 to ' +
    '`implementing` with `role` `impl:2` through the standing start rule, while `blockedBy` is ' +
    'still `["1"]` — the record of what it waited on is kept after the re-dispatch, never ' +
    `cleared  [#987 leg (d), M4]: ${JSON.stringify(doc.tasks['2'])}`)
  assert.deepEqual(Object.keys(doc.tasks['2']), CELL_KEYS,
    'and that cell still carries the seven keys in order  [#987 leg (d), M3, M4]: ' +
    JSON.stringify(Object.keys(doc.tasks['2'])))
})

test('(#987 e) the contract\'s status.json bullet says waiting, blockedBy and nine  [M5]', () => {
  // The same `**status.json:**` bullet cases (f) and (#952 e) read, scoped from
  // its own line to the `**Publish:**` bullet — the Proof's first two `Run:`
  // lines, spelled here as the leg they are.
  shOk(`${STATUS_BULLET} | grep -q 'queued|waiting|examining'`,
    'the `**status.json:**` bullet\'s `"state":` enumeration must read ' +
    '`queued|waiting|examining|…` — `waiting` immediately after `queued`  [#987 leg (e), M5]')
  shOk(`${STATUS_BULLET} | grep -q '"blockedBy":'`,
    'and its task-cell literal must name a `"blockedBy":` cell  [#987 leg (e), M5]')
  shOk(`${STATUS_BULLET} | grep -q 'nine states above'`,
    'and the sentence that counted the states must say `nine states above`  [#987 leg (e), M5]')
  shOk(`test "$(${STATUS_BULLET_LINES} | grep -c 'eight states')" = 0`,
    'and no line of that bullet may still say `eight states` — the count moved  ' +
    '[#987 leg (e), M5]')
})

test('(#987 f) the runbook\'s Watch entry names waiting among the states  [M6]', () => {
  shOk(`${WATCH_STATUS_ENTRY} | grep -q 'queued.*waiting.*failed'`,
    'the **Watch.** entry for `status.json`, scoped from its own line to the `events.jsonl` ' +
    'entry, must name `waiting` between `queued` and `failed` in the list of states a task cell ' +
    'can read  [#987 leg (f), M6]')
})

// ── (d) the commit window in events  [M4] ───────────────────────────────────

test('(d) the refresher commits by FLEET_COMMIT_EVENTS, once per window  [M4]', () =>
  held({
    FLEET_COMMIT_EVENTS: '4', FLEET_COMMIT_SECONDS: '3600', FLEET_STATUS_INTERVAL: '0.25',
  }, async ({ ctx, run, release, over }) => {
    await awaitGateLine(ctx, over)

    // The refresher started at zero lines. The stub's own `gate` line plus two
    // appends is THREE new lines — one short of the window.
    let mark = runningWrites(ctx)
    append(ctx, start(2, 'impl:4', 'implementer') + start(3, 'impl:5', 'implementer'))
    await pollFor(
      'two further page writes after the appends  [leg (d), M4]',
      () => runningWrites(ctx) >= mark + 2,
      { over, detail: () => stream(ctx).join('\n') },
    )
    assert.deepEqual(commitStates(ctx), ['running'],
      'three new lines against a window of four earn NO commit — only the `engine starting` ' +
      'commit stands; a refresher that commits per line fails here  [leg (d), M4]: ' +
      JSON.stringify(commitStates(ctx)))

    // The fourth line closes the window.
    append(ctx, start(4, 'impl:6', 'implementer'))
    await pollFor(
      'the fourth new line earns the second commit  [leg (d), M4] — a refresher that never ' +
      'commits, or commits only on a phase change, exhausts this poll',
      () => commitStates(ctx).length >= 2,
      { over, detail: () => JSON.stringify(commitStates(ctx)) },
    )
    assert.deepEqual(commitStates(ctx), ['running', 'running'],
      'exactly two commits at the fourth line  [leg (d), M4]: ' +
      JSON.stringify(commitStates(ctx)))
    const second = committed(ctx)[1]
    assert.deepEqual(Object.keys(second.tasks).sort(), ['4', '5', '6'],
      'the second committed page\'s `tasks` carries the appended tasks  [leg (d), M3, M4]: ' +
      JSON.stringify(second.tasks))
    assert.deepEqual(second.tasks['6'],
      { wave: null, state: 'implementing', role: 'impl:6', lastProof: null, park: null,
        attention: null, blockedBy: null },
      'including the line that closed the window  [leg (d), M3, M4]')

    // FIVE lines in ONE write: one window, one commit — not five.
    mark = runningWrites(ctx)
    append(ctx, [5, 6, 7, 8, 9].map((n) => start(n, `impl:${n + 2}`, 'implementer')).join(''))
    await pollFor(
      'the batch of five earns its commit  [leg (d), M4]',
      () => commitStates(ctx).length >= 3,
      { over, detail: () => JSON.stringify(commitStates(ctx)) },
    )
    await pollFor(
      'two further page writes after the batch  [leg (d), M4]',
      () => runningWrites(ctx) >= mark + 2,
      { over, detail: () => stream(ctx).join('\n') },
    )
    assert.deepEqual(commitStates(ctx), ['running', 'running', 'running'],
      'five lines appended in one write are ONE commit, not five  [leg (d), M4]: ' +
      JSON.stringify(commitStates(ctx)))

    release()
    const r = await run
    assert.equal(r.status, 0, 'the released run still ends 0  [leg (d)]:\n' + r.stdout + r.stderr)
    assert.deepEqual(commitStates(ctx), ['running', 'running', 'running', 'publishing', 'done'],
      'and the two transitions keep their place after the last window commit  [leg (d), M4]: ' +
      JSON.stringify(commitStates(ctx)))
  }))

// ── (e) the commit window in seconds  [M4] ──────────────────────────────────

test('(e) the refresher commits by FLEET_COMMIT_SECONDS, and never with nothing new  [M4]', () =>
  held({
    FLEET_COMMIT_EVENTS: '100', FLEET_COMMIT_SECONDS: '3600', FLEET_STATUS_INTERVAL: '0.25',
  }, async ({ ctx, run, release, over }) => {
    const clock = path.join(ctx.home, 'stub', 'clock')
    /** Move the rig's `date +%s` forward, then let two pages be written. */
    const moveTo = async (seconds) => {
      const mark = runningWrites(ctx)
      fs.writeFileSync(clock, `${seconds}\n`)
      await pollFor(
        `two further page writes after the clock moved to +${seconds}s  [leg (e), M4]`,
        () => runningWrites(ctx) >= mark + 2,
        { over, detail: () => stream(ctx).join('\n') },
      )
    }

    await awaitGateLine(ctx, over)
    let mark = runningWrites(ctx)
    append(ctx, start(2, 'impl:4', 'implementer'))
    await pollFor(
      'two further page writes after the append  [leg (e), M4]',
      () => runningWrites(ctx) >= mark + 2,
      { over, detail: () => stream(ctx).join('\n') },
    )
    assert.deepEqual(commitStates(ctx), ['running'],
      'one new line against a window of a hundred lines and an hour earns no commit yet  ' +
      '[leg (e), M4]: ' + JSON.stringify(commitStates(ctx)))

    await moveTo(1800)
    assert.deepEqual(commitStates(ctx), ['running'],
      'half the seconds window is not the window — a refresher that fires at 1800 fails here  ' +
      '[leg (e), M4]: ' + JSON.stringify(commitStates(ctx)))

    fs.writeFileSync(clock, '3600\n')
    await pollFor(
      'at `FLEET_COMMIT_SECONDS` seconds the pending line earns its commit  [leg (e), M4] — a ' +
      'refresher that reads a clock the stub does not move (anything but `date +%s`) exhausts ' +
      'this poll',
      () => commitStates(ctx).length >= 2,
      { over, detail: () => JSON.stringify(commitStates(ctx)) },
    )
    assert.deepEqual(commitStates(ctx), ['running', 'running'],
      'exactly two commits at the seconds window  [leg (e), M4]: ' +
      JSON.stringify(commitStates(ctx)))

    await moveTo(7200)
    assert.deepEqual(commitStates(ctx), ['running', 'running'],
      'another whole window with NO new line earns nothing — a tick with no new line never ' +
      'commits, whatever the clock says  [leg (e), M4]: ' + JSON.stringify(commitStates(ctx)))

    append(ctx, start(3, 'impl:5', 'implementer'))
    await pollFor(
      'one more line, the seconds window long since met, earns the third commit  [leg (e), M4]',
      () => commitStates(ctx).length >= 3,
      { over, detail: () => JSON.stringify(commitStates(ctx)) },
    )
    assert.deepEqual(commitStates(ctx), ['running', 'running', 'running'],
      'three commits, and no more  [leg (e), M4]: ' + JSON.stringify(commitStates(ctx)))

    release()
    const r = await run
    assert.equal(r.status, 0, 'the released run still ends 0  [leg (e)]:\n' + r.stdout + r.stderr)
  }))

// ── (f) (g) (h) the documents  [M5, M6, M7] ─────────────────────────────────

const ROOT = path.resolve(SCRIPT, '..', '..')
const sh = (cmd) =>
  spawnSync('bash', ['-c', cmd], { cwd: ROOT, encoding: 'utf8', timeout: 300000, env: ENV })
const shOk = (cmd, why) => {
  const r = sh(cmd)
  assert.equal(r.status, 0, `${why}\n  $ ${cmd}\n${r.stdout || ''}${r.stderr || ''}`)
}
const shNo = (cmd, why) => {
  const r = sh(cmd)
  assert.notEqual(r.status, 0, `${why}\n  $ ${cmd}\n${r.stdout || ''}${r.stderr || ''}`)
}

/** The `ultra/evidence-run-<N>` bullet, from its own line to the `ultra/integration-run-<N>` one. */
const EVIDENCE_BULLET =
  "sed -n '/ultra\\/evidence-run-<N>. — the run/,/ultra\\/integration-run-<N>. — the work/p' " +
  "fleet/CONTRACT.md | tr '\\n' ' '"
/** The `**status.json:**` bullet under §Literals, to the `**Publish:**` one. */
const STATUS_BULLET =
  "sed -n '/^- \\*\\*status\\.json:\\*\\*/,/^- \\*\\*Publish:\\*\\*/p' fleet/CONTRACT.md | tr '\\n' ' '"
/** The same bullet, LINE by line: a count of matching lines needs its newlines. */
const STATUS_BULLET_LINES =
  "sed -n '/^- \\*\\*status\\.json:\\*\\*/,/^- \\*\\*Publish:\\*\\*/p' fleet/CONTRACT.md"
/** The **Watch.** entry for `status.json`, to the `events.jsonl` entry. */
const WATCH_STATUS_ENTRY =
  "sed -n '/status\\.json. — the VM/,/events\\.jsonl. — the live/p' fleet/RUNBOOK.md | tr '\\n' ' '"

test('(f) the contract states the commit window and the page\'s new cells  [M5]', () => {
  shOk(`${EVIDENCE_BULLET} | grep -q 'FLEET_COMMIT_EVENTS.*FLEET_COMMIT_SECONDS'`,
    'the `ultra/evidence-run-<N>` bullet must name both knobs, in that order  [leg (f), M5]')
  shNo(`${EVIDENCE_BULLET} | grep -q 'engine:phase'`,
    'and must no longer say a commit is made per relayed `engine:phase`  [leg (f), M5]')

  shOk(`${STATUS_BULLET} | grep -q 'FLEET_COMMIT_EVENTS'`,
    'the `**status.json:**` bullet must name `FLEET_COMMIT_EVENTS`  [leg (f), M5]')
  shOk(`${STATUS_BULLET} | grep -q '"tasks":'`,
    'and must carry the `"tasks":` cell in its literal  [leg (f), M5]')
  shOk(`${STATUS_BULLET} | grep -q '· <sub>'`,
    'and must spell the sub-phase form `· <sub>`  [leg (f), M5]')
  for (const state of
    ['queued', 'examining', 'implementing', 'proving', 'reviewing', 'fixing', 'folded', 'failed']) {
    shOk(`${STATUS_BULLET} | grep -q '${state}'`,
      `and must name the state \`${state}\` — all eight, or the bullet does not say what a cell ` +
      'can read  [leg (f), M5]')
  }
  shNo(`${STATUS_BULLET} | grep -q 'engine:phase'`,
    'and must no longer say the commit is made at every `engine:phase`  [leg (f), M5]')

  shOk("grep 'www/status\\.json' fleet/CONTRACT.md | grep 'engine\\.log' | grep -q 'events\\.jsonl'",
    'the boot-script bullet\'s served-files line must name `events.jsonl` beside `status.json` ' +
    'and `engine.log`  [leg (f), M5]')
})

test('(g) the runbook\'s Watch list says what a watcher now reads  [M6]', () => {
  const watch = "sed -n '/^\\*\\*Watch\\.\\*\\*/,/^\\*\\*[A-Z]/p' fleet/RUNBOOK.md | tr '\\n' ' '"
  for (const [needle, why] of [
    ['sub-step', 'the page\'s `phase` names the sub-step'],
    ['tasks', 'its `tasks` cell says what each task is doing'],
    ['events.jsonl', '`https://<vm>.exe.xyz/events.jsonl` is the live log'],
    ['two minutes', 'the evidence branch is at most two minutes or ten events behind'],
  ]) {
    shOk(`${watch} | grep -q '${needle}'`,
      `the **Watch.** list must say: ${why}  [leg (g), M6]`)
  }
})

test('(h) CLAUDE.md names map #876 *Viz*, and Orrery is gone  [M7]', () => {
  const r = sh('grep -c Orrery CLAUDE.md')
  assert.equal((r.stdout || '').trim(), '0',
    'the word `Orrery` appears nowhere in CLAUDE.md — the operator renamed map #876 on ' +
    `2026-09-10  [leg (h), M7]; grep -c printed: ${JSON.stringify(r.stdout)}`)

  const v = sh("grep -c '#876 \\*Viz\\*' CLAUDE.md")
  assert.ok(Number((v.stdout || '').trim()) >= 1,
    'and the `**Open maps:**` bullet names it `#876 *Viz*`  [leg (h), M7]; grep -c printed: ' +
    JSON.stringify(v.stdout))
})

runTests(tests)
